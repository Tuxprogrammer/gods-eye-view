import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const BACKOFF_MS = Object.freeze([5_000, 15_000, 60_000, 300_000]);
const KEEPALIVE_S = 30;
/** Every 30 s a PINGRESP arrives at the very least; this much silence is a dead link. */
const SILENCE_MS = 100_000;
const CHECK_MS = 15_000;
/** Meshtastic packets are at most a few hundred bytes; refuse anything absurd. */
const MAX_PACKET_BYTES = 1_000_000;

const TYPE = Object.freeze({
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  SUBACK: 9,
  PINGRESP: 13,
});

const CONNACK_ERRORS = [
  null,
  'the broker does not support MQTT 3.1.1',
  'the broker rejected the client id',
  'the broker is unavailable',
  'wrong username or password',
  'not authorised (check the username and password)',
];

const utf8 = (text) => {
  const body = Buffer.from(text, 'utf8');
  const head = Buffer.alloc(2);
  head.writeUInt16BE(body.length);
  return Buffer.concat([head, body]);
};

function remainingLength(length) {
  const out = [];
  let rest = length;
  do {
    let byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return Buffer.from(out);
}

const packet = (firstByte, body) =>
  Buffer.concat([Buffer.from([firstByte]), remainingLength(body.length), body]);

export function connectPacket({ clientId, username, password, keepAlive }) {
  let flags = 0x02; // clean session
  const payload = [utf8(clientId)];
  if (username) {
    flags |= 0x80;
    payload.push(utf8(username));
    if (password) {
      flags |= 0x40;
      payload.push(utf8(password));
    }
  }
  const head = Buffer.from([
    0x00,
    0x04,
    0x4d,
    0x51,
    0x54,
    0x54,
    0x04,
    flags,
    keepAlive >> 8,
    keepAlive & 0xff,
  ]);
  return packet(TYPE.CONNECT << 4, Buffer.concat([head, ...payload]));
}

export function subscribePacket(id, filters) {
  const head = Buffer.alloc(2);
  head.writeUInt16BE(id);
  return packet(
    0x82,
    Buffer.concat([
      head,
      ...filters.flatMap((f) => [utf8(f), Buffer.from([0])]),
    ]),
  );
}

/**
 * Split whatever has arrived into complete MQTT packets. Returns the packets
 * and the unread remainder, or `error` for a stream that cannot be MQTT.
 * @param {Buffer} buffer
 * @returns {{packets: Array<{type: number, flags: number, body: Buffer}>, rest: Buffer, error?: string}}
 */
export function splitPackets(buffer) {
  const packets = [];
  let at = 0;
  while (at < buffer.length) {
    let length = 0;
    let multiplier = 1;
    let cursor = at + 1;
    let complete = false;
    for (let i = 0; i < 4; i += 1) {
      if (cursor >= buffer.length) break;
      const byte = buffer[cursor++];
      length += (byte & 0x7f) * multiplier;
      multiplier *= 128;
      if (!(byte & 0x80)) {
        complete = true;
        break;
      }
    }
    if (!complete) {
      if (cursor - at > 4)
        return { packets, rest: Buffer.alloc(0), error: 'bad packet length' };
      break;
    }
    if (length > MAX_PACKET_BYTES)
      return { packets, rest: Buffer.alloc(0), error: 'packet too large' };
    if (cursor + length > buffer.length) break;
    packets.push({
      type: buffer[at] >> 4,
      flags: buffer[at] & 0x0f,
      body: buffer.subarray(cursor, cursor + length),
    });
    at = cursor + length;
  }
  return { packets, rest: buffer.subarray(at) };
}

/**
 * A receive-only MQTT 3.1.1 subscriber that stays connected until stopped.
 *
 * It subscribes at QoS 0 and never publishes, so it adds nothing to the mesh
 * and needs no identity beyond the broker login. The client id is random per
 * connection: a broker drops the older session when the same id connects
 * again, and two servers sharing an id would kick each other off in a loop.
 *
 * @param {object} options
 * @param {string} options.host
 * @param {number} [options.port]
 * @param {boolean} [options.tls]
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string[]} options.topics Subscription filters.
 * @param {(topic: string, payload: Buffer, receivedAt: number) => void} options.onMessage
 */
export function createMqttClient({
  host,
  port,
  tls: useTls = false,
  username = '',
  password = '',
  topics,
  onMessage,
  now = Date.now,
  connect = (options) =>
    options.tls
      ? tls.connect({
          host: options.host,
          port: options.port,
          servername: options.host,
        })
      : net.createConnection({ host: options.host, port: options.port }),
  warn = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  clientIdFor = () => `gev-${randomBytes(4).toString('hex')}`,
}) {
  const targetPort = port ?? (useTls ? 8883 : 1883);
  let socket = null;
  let buffer = Buffer.alloc(0);
  let attempt = 0;
  let retryTimer = null;
  let checkTimer = null;
  let pingTimer = null;
  let stopped = true;
  let generation = 0;
  let clientId = null;
  const state = {
    status: 'idle',
    error: null,
    connectedAt: null,
    lastActivityAt: null,
    lastMessageAt: null,
    messages: 0,
    nextAttemptAt: null,
  };
  let recent = [];

  function scheduleRetry() {
    if (stopped) return;
    // A wrong password will not fix itself; retry, but slowly.
    const delay =
      state.status === 'auth-failed'
        ? BACKOFF_MS[BACKOFF_MS.length - 1]
        : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    if (state.status !== 'auth-failed') state.status = 'reconnecting';
    state.nextAttemptAt = now() + delay;
    retryTimer = setTimer(open, delay);
    retryTimer?.unref?.();
  }

  function teardown() {
    generation += 1;
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
    if (socket) {
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.destroy();
      socket = null;
    }
    buffer = Buffer.alloc(0);
  }

  function handle(item) {
    state.lastActivityAt = now();
    if (item.type === TYPE.CONNACK) {
      const code = item.body[1];
      if (code === 0) {
        state.status = 'live';
        state.error = null;
        attempt = 0;
        socket.write(subscribePacket(1, topics));
      } else {
        state.status = code === 4 || code === 5 ? 'auth-failed' : 'error';
        state.error = `Broker refused the connection: ${CONNACK_ERRORS[code] ?? `code ${code}`}`;
        teardown();
        scheduleRetry();
      }
    } else if (item.type === TYPE.SUBACK) {
      // A refusal is 0x80 per filter; the feed then stays silent, so say so.
      if (item.body.subarray(2).some((granted) => granted === 0x80)) {
        state.error = 'Broker refused the topic subscription';
      }
    } else if (item.type === TYPE.PUBLISH) {
      const qos = (item.flags >> 1) & 3;
      const topicLength = item.body.readUInt16BE(0);
      const topic = item.body.toString('utf8', 2, 2 + topicLength);
      let at = 2 + topicLength;
      if (qos > 0) {
        const id = item.body.subarray(at, at + 2);
        at += 2;
        // QoS 1 needs an acknowledgement; we only ever ask for QoS 0.
        if (qos === 1)
          socket?.write(Buffer.concat([Buffer.from([0x40, 2]), id]));
      }
      const receivedAt = now();
      state.messages += 1;
      state.lastMessageAt = receivedAt;
      recent.push(receivedAt);
      onMessage(topic, item.body.subarray(at), receivedAt);
    }
  }

  function open() {
    if (stopped) return;
    retryTimer = null;
    teardown();
    const mine = generation;
    state.status = 'connecting';
    state.nextAttemptAt = null;
    clientId = clientIdFor();
    try {
      socket = connect({ host, port: targetPort, tls: useTls });
    } catch (error) {
      state.error = error?.message || 'connect failed';
      scheduleRetry();
      return;
    }
    const created = socket;
    created.setKeepAlive?.(true, 30_000);
    created.setNoDelay?.(true);
    const onConnected = () => {
      if (mine !== generation) return;
      state.connectedAt = now();
      state.lastActivityAt = now();
      created.write(
        connectPacket({ clientId, username, password, keepAlive: KEEPALIVE_S }),
      );
      pingTimer = setInterval(() => {
        if (mine === generation) created.write(Buffer.from([0xc0, 0]));
      }, KEEPALIVE_S * 1000);
      pingTimer.unref?.();
    };
    created.on(useTls ? 'secureConnect' : 'connect', onConnected);
    created.on('data', (chunk) => {
      if (mine !== generation) return;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      const split = splitPackets(buffer);
      buffer = split.rest;
      for (const item of split.packets) {
        if (mine !== generation) return;
        try {
          handle(item);
        } catch (error) {
          warn(`[Meshtastic] ${host}: bad packet: ${error?.message || error}`);
        }
      }
      if (split.error && mine === generation) {
        state.error = split.error;
        teardown();
        scheduleRetry();
      }
    });
    created.on('error', (error) => {
      if (mine !== generation) return;
      state.error = error?.message || 'socket error';
    });
    created.on('close', () => {
      if (mine !== generation) return;
      teardown();
      if (state.status !== 'auth-failed')
        warn(
          `[Meshtastic] ${host}: connection closed${state.error ? `: ${state.error}` : ''}`,
        );
      scheduleRetry();
    });
  }

  function check() {
    if (stopped) return;
    const t = now();
    recent = recent.filter((at) => t - at < 60_000);
    if (
      socket &&
      state.lastActivityAt !== null &&
      t - state.lastActivityAt > SILENCE_MS
    ) {
      state.error = `no data for ${Math.round((t - state.lastActivityAt) / 1000)} s`;
      warn(`[Meshtastic] ${host}: link went silent; reconnecting`);
      teardown();
      scheduleRetry();
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      checkTimer = setInterval(check, CHECK_MS);
      checkTimer.unref?.();
      open();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
      clearInterval(checkTimer);
      checkTimer = null;
      // A polite goodbye lets the broker release the session at once.
      try {
        socket?.write(Buffer.from([0xe0, 0]));
      } catch {
        /* already gone */
      }
      teardown();
      state.status = 'stopped';
      state.nextAttemptAt = null;
    },
    /** Status for the panel; never includes the password. */
    snapshot() {
      const t = now();
      return {
        status: state.status,
        error: state.error,
        connectedAt: state.connectedAt,
        lastMessageAt: state.lastMessageAt,
        messagesPerMinute: recent.filter((at) => t - at < 60_000).length,
        messages: state.messages,
        nextAttemptAt: state.nextAttemptAt,
      };
    },
  };
}
