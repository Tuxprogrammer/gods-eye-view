import net from 'node:net';
import { aprsPasscode, isValidCallsign } from './passcode.js';
import { parsePacket } from './parser.js';

export const DEFAULT_HOST = 'noam.aprs2.net';
/** Full feed: every packet the server sees. Filtered feeds use 14580. */
export const FULL_FEED_PORT = 10152;
export const FILTERED_PORT = 14580;
const BACKOFF_MS = Object.freeze([5_000, 15_000, 60_000, 300_000]);
/** aprsc sends a `#` comment every 20 s; this much silence means a dead link. */
const SILENCE_MS = 90_000;
const CHECK_MS = 15_000;
const MAX_LINE_BYTES = 4096;
const VERSION = 'gods-eye-view 0.1';

/**
 * A receive-only APRS-IS client that stays connected for the life of the
 * server, whether or not any browser is looking.
 *
 * It logs in with the operator's callsign and computed passcode and NEVER
 * transmits a packet, so this station needs no identity on the network beyond
 * the login line. Every parsed packet goes to `onPacket`; the caller decides
 * what to do with it.
 *
 * @param {object} options
 * @param {string} options.callsign
 * @param {(packet: object, receivedAt: number) => void} options.onPacket
 */
export function createAprsClient({
  callsign,
  host = DEFAULT_HOST,
  port,
  filter = '',
  onPacket,
  now = Date.now,
  connect = (options) => net.createConnection(options),
  warn = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  random = Math.random,
}) {
  const configured = String(callsign ?? '')
    .trim()
    .toUpperCase();
  // APRS-IS drops the older connection when the same login connects again, so
  // a login must never equal one of the operator's real stations (an iGate on
  // -9, a mobile on -7) or two processes sharing a login: either would kick
  // the other off. Real stations use numeric SSIDs 0-15, so a bare callsign
  // logs in with a letter SSID (-GA .. -GZ) that no real station has; the
  // passcode ignores the SSID, and APRS-IS verifies the login. An SSID given
  // explicitly in config is used as written.
  const valid = isValidCallsign(configured);
  const login =
    valid && !configured.includes('-')
      ? `${configured}-G${String.fromCharCode(65 + Math.floor(random() * 26))}`
      : configured;
  const targetPort = port ?? (filter ? FILTERED_PORT : FULL_FEED_PORT);
  let socket = null;
  let buffer = '';
  let attempt = 0;
  let retryTimer = null;
  let checkTimer = null;
  let stopped = true;
  let generation = 0;
  const state = {
    status: 'idle',
    error: null,
    server: null,
    connectedAt: null,
    lastLineAt: null,
    lastPacketAt: null,
    packets: 0,
    nextAttemptAt: null,
  };
  /** Timestamps of recent packets, for a packets-per-minute figure. */
  let recent = [];

  function scheduleRetry() {
    if (stopped) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    state.status = 'reconnecting';
    state.nextAttemptAt = now() + delay;
    retryTimer = setTimer(open, delay);
    retryTimer?.unref?.();
  }

  function teardown() {
    generation += 1;
    if (socket) {
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.destroy();
      socket = null;
    }
    buffer = '';
  }

  function handleLine(line, receivedAt) {
    state.lastLineAt = receivedAt;
    if (line.startsWith('#')) {
      const logresp =
        /^# logresp (\S+) (verified|unverified)(?:, server (\S+))?/i.exec(line);
      if (logresp) {
        state.server = logresp[3] ?? state.server;
        if (logresp[2].toLowerCase() === 'verified') {
          state.status = 'live';
          state.error = null;
          attempt = 0;
        } else {
          state.status = 'unverified';
          state.error = 'APRS-IS did not verify the login passcode';
        }
      }
      return;
    }
    state.packets += 1;
    recent.push(receivedAt);
    const packet = parsePacket(line);
    if (!packet) return;
    state.lastPacketAt = receivedAt;
    onPacket(packet, receivedAt);
  }

  function open() {
    if (stopped) return;
    retryTimer = null;
    teardown();
    const mine = generation;
    state.status = 'connecting';
    state.nextAttemptAt = null;
    let created;
    try {
      created = connect({ host, port: targetPort });
    } catch (error) {
      state.error = error?.message || 'connect failed';
      scheduleRetry();
      return;
    }
    socket = created;
    socket.setKeepAlive?.(true, 30_000);
    socket.setNoDelay?.(true);
    socket.on('connect', () => {
      if (mine !== generation) return;
      state.connectedAt = now();
      state.lastLineAt = now();
      const filterPart = filter ? ` filter ${filter}` : '';
      socket.write(
        `user ${login} pass ${aprsPasscode(login)} vers ${VERSION}${filterPart}\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      if (mine !== generation) return;
      buffer += chunk.toString('latin1');
      const receivedAt = now();
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line) handleLine(line, receivedAt);
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > MAX_LINE_BYTES) buffer = '';
    });
    socket.on('error', (error) => {
      if (mine !== generation) return;
      state.error = error?.message || 'socket error';
    });
    socket.on('close', () => {
      if (mine !== generation) return;
      teardown();
      warn(`[APRS] connection closed${state.error ? `: ${state.error}` : ''}`);
      scheduleRetry();
    });
  }

  function check() {
    if (stopped) return;
    const t = now();
    recent = recent.filter((at) => t - at < 60_000);
    if (
      socket &&
      state.lastLineAt !== null &&
      t - state.lastLineAt > SILENCE_MS
    ) {
      state.error = `no data for ${Math.round((t - state.lastLineAt) / 1000)} s`;
      warn('[APRS] feed went silent; reconnecting');
      teardown();
      scheduleRetry();
    }
  }

  return {
    /** Begin connecting. A missing or malformed callsign is reported, not thrown. */
    start() {
      if (!stopped) return;
      if (!valid) {
        state.status = 'missing-config';
        state.error = login
          ? `APRS_CALLSIGN "${login}" is not a valid callsign`
          : 'APRS_CALLSIGN is not set';
        return;
      }
      stopped = false;
      attempt = 0;
      checkTimer = setInterval(check, CHECK_MS);
      checkTimer.unref?.();
      open();
    },
    stop() {
      stopped = true;
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
      clearInterval(checkTimer);
      checkTimer = null;
      teardown();
      if (state.status !== 'missing-config') state.status = 'stopped';
    },
    /** Snapshot for the status line; never includes the passcode. */
    snapshot() {
      const t = now();
      return {
        status: state.status,
        error: state.error,
        callsign: login || null,
        server: state.server,
        host: `${host}:${targetPort}`,
        filter: filter || null,
        connectedAt: state.connectedAt,
        lastPacketAt: state.lastPacketAt,
        packetsPerMinute: recent.filter((at) => t - at < 60_000).length,
        packets: state.packets,
        nextAttemptAt: state.nextAttemptAt,
      };
    },
  };
}
