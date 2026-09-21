import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  BROADCAST,
  channelHash,
  decodeMessage,
  decryptPayload,
  expandKey,
  keyRing,
  nodeId,
  parseTopic,
  precisionCellKm,
} from '../../../server/providers/meshtastic/decode.js';
import { readMessage } from '../../../server/providers/meshtastic/proto.js';
import {
  connectPacket,
  createMqttClient,
  splitPackets,
  subscribePacket,
} from '../../../server/providers/meshtastic/mqtt.js';
import {
  createMeshtasticStore,
  loadSqlite,
} from '../../../server/providers/meshtastic/store.js';
import {
  SEED_SERVERS,
  createServerManager,
  validateServer,
} from '../../../server/providers/meshtastic/servers.js';
import { createMeshtasticMiddleware } from '../../../server/providers/meshtastic/middleware.js';

// -- A minimal protobuf writer, only for building test packets ----------------

const varint = (value) => {
  let n = BigInt(value);
  if (n < 0n) n = BigInt.asUintN(64, n);
  const out = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) byte |= 0x80;
    out.push(byte);
  } while (n > 0n);
  return Buffer.from(out);
};
const tag = (field, wire) => varint(field * 8 + wire);
const v = (field, value) => Buffer.concat([tag(field, 0), varint(value)]);
const f32 = (field, value) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return Buffer.concat([tag(field, 5), b]);
};
const float = (field, value) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value);
  return Buffer.concat([tag(field, 5), b]);
};
const len = (field, body) =>
  Buffer.concat([
    tag(field, 2),
    varint(body.length),
    Buffer.isBuffer(body) ? body : Buffer.from(body),
  ]);
const cat = (...parts) => Buffer.concat(parts);

const position = (lat, lon, { bits = 16, alt = 30 } = {}) =>
  cat(
    f32(1, Math.round(lat * 1e7)),
    f32(2, Math.round(lon * 1e7)),
    v(3, alt),
    v(23, bits),
  );

const FROM = 0x0af87081;
const GATEWAY = '!0af87081';

/** Build an MQTT payload: a ServiceEnvelope around a MeshPacket. */
function envelope({
  port,
  payload,
  from = FROM,
  to = BROADCAST,
  id = 1234567,
  channel = 'LongFast',
  gateway = GATEWAY,
  key = expandKey('AQ=='),
  encrypt = true,
  bitfield,
  extra = Buffer.alloc(0),
}) {
  const data = cat(
    v(1, port),
    len(2, payload),
    bitfield === undefined ? Buffer.alloc(0) : v(9, bitfield),
  );
  const body = encrypt
    ? len(5, decryptPayload(key, id, from, data)) // CTR is symmetric
    : len(4, data);
  const packet = cat(
    f32(1, from),
    f32(2, to),
    v(3, encrypt ? channelHash(channel, key) : 0),
    body,
    f32(6, id),
    v(9, 3),
    v(15, 5),
    float(8, 6.5),
    v(12, -72),
    extra,
  );
  return cat(len(1, packet), len(2, channel), len(3, gateway));
}

const TOPIC = `msh/US/2/e/LongFast/${GATEWAY}`;

// -- Protocol -------------------------------------------------------------------

test('a one-byte key is the default key with its last byte raised', () => {
  const def = expandKey('AQ==');
  assert.equal(def.toString('hex'), 'd4f1bb3a20290759f0bcffabcf4e6901');
  assert.equal(expandKey('').toString('hex'), def.toString('hex'));
  assert.equal(expandKey('default').toString('hex'), def.toString('hex'));
  assert.equal(expandKey('Ag==').toString('hex'), 'd4f1bb3a20290759f0bcffabcf4e6902');
  assert.equal(expandKey(Buffer.alloc(16, 7).toString('base64')).length, 16);
  assert.equal(expandKey(Buffer.alloc(32, 7).toString('base64')).length, 32);
  assert.equal(expandKey('not a key!!'), null);
  assert.equal(expandKey(Buffer.alloc(5).toString('base64')), null);
});

test('LongFast on the default key hashes to 8, as the firmware does', () => {
  assert.equal(channelHash('LongFast', expandKey('AQ==')), 8);
});

test('the protocol part of a topic is the last /2/<kind>, whatever the root', () => {
  assert.deepEqual(parseTopic('msh/US/2/e/LongFast/!a1b2c3d4'), {
    root: 'msh/US',
    kind: 'e',
    channel: 'LongFast',
    gateway: '!a1b2c3d4',
  });
  assert.equal(parseTopic('msh/US/CA/US/2/2/e/LongFast/!069c7f3b').root, 'msh/US/CA/US/2');
  assert.equal(parseTopic('msh/US/2/json/LongFast/!a1b2c3d4').kind, 'json');
  assert.equal(parseTopic('msh/US/GA'), null);
});

test('a malformed message is null, not an exception or a wrong value', () => {
  assert.equal(readMessage(Buffer.from([0x0a, 0x05, 0x01])), null);
  assert.equal(readMessage(Buffer.from([0x00])), null);
  assert.equal(readMessage(Buffer.from('{"status":"offline"}')), null);
  assert.equal(readMessage(Buffer.alloc(0)).size, 0);
});

test('decodes an encrypted position and reads its precision', () => {
  const { event } = decodeMessage(
    TOPIC,
    envelope({ port: 3, payload: position(34.7304, -86.5861, { bits: 14 }) }),
  );
  assert.equal(event.type, 'position');
  assert.equal(event.id, GATEWAY);
  assert.equal(event.channel, 'LongFast');
  assert.equal(event.root, 'msh/US');
  assert.ok(Math.abs(event.position.lat - 34.7304) < 1e-6);
  assert.ok(Math.abs(event.position.lon + 86.5861) < 1e-6);
  assert.equal(event.position.alt, 30);
  assert.equal(event.position.precisionBits, 14);
  assert.equal(event.snr, 6.5);
  assert.equal(event.rssi, -72);
  assert.equal(event.hops, 2);
  assert.equal(precisionCellKm(14), 2.9);
  assert.equal(precisionCellKm(32), 0);
});

test('reads negative altitudes and rejects null island and out-of-range fixes', () => {
  const below = decodeMessage(
    TOPIC,
    envelope({ port: 3, payload: position(10, 10, { alt: -12 }) }),
  );
  assert.equal(below.event.position.alt, -12);
  assert.equal(
    decodeMessage(TOPIC, envelope({ port: 3, payload: position(0, 0) })).skip,
    'no-position',
  );
  assert.equal(
    decodeMessage(
      TOPIC,
      envelope({ port: 3, payload: cat(f32(1, 950_000_000), f32(2, 10)) }),
    ).skip,
    'no-position',
  );
});

test('decodes node info, telemetry, map reports and text messages', () => {
  const user = decodeMessage(
    TOPIC,
    envelope({
      port: 4,
      payload: cat(len(1, GATEWAY), len(2, 'Hilltop Router'), len(3, 'HTR'), v(5, 43), v(7, 2)),
    }),
  ).event;
  assert.deepEqual(user.user, {
    longName: 'Hilltop Router',
    shortName: 'HTR',
    hwModel: 43,
    role: 'ROUTER',
  });
  // An absent role is the default, CLIENT.
  assert.equal(
    decodeMessage(TOPIC, envelope({ port: 4, payload: len(3, 'AB') })).event.user.role,
    'CLIENT',
  );

  const telemetry = decodeMessage(
    TOPIC,
    envelope({
      port: 67,
      payload: cat(
        f32(1, 1),
        len(2, cat(v(1, 87), float(2, 4.05), float(3, 3.5), float(4, 0.4), v(5, 3600))),
        len(3, cat(float(1, 21.5), float(2, 48), float(3, 1013.2))),
      ),
    }),
  ).event.telemetry;
  assert.equal(telemetry.battery, 87);
  assert.equal(telemetry.voltage, 4.05);
  assert.equal(telemetry.channelUtil, 3.5);
  assert.equal(telemetry.tempC, 21.5);
  assert.equal(telemetry.humidity, 48);
  assert.equal(telemetry.pressureHpa, 1013.2);

  const report = decodeMessage(
    'msh/US/2/map/',
    envelope({
      port: 73,
      encrypt: false,
      payload: cat(
        len(1, 'Meshtastic 30a4'),
        len(2, '30a4'),
        v(4, 43),
        len(5, '2.5.15'),
        v(6, 1),
        v(7, 0),
        f32(9, Math.round(32.1 * 1e7)),
        f32(10, Math.round(-81.27 * 1e7)),
        v(12, 14),
      ),
    }),
  ).event.report;
  assert.equal(report.region, 'US');
  assert.equal(report.preset, 'LONG_FAST');
  assert.equal(report.firmware, '2.5.15');
  assert.equal(report.position.precisionBits, 14);

  const text = decodeMessage(
    TOPIC,
    envelope({ port: 1, payload: Buffer.from('Net check-in\u0007 tonight') }),
  ).event;
  assert.equal(text.type, 'text');
  assert.equal(text.text, 'Net check-in tonight');
  assert.equal(text.to, BROADCAST);
});

test('reads cleartext packets published unencrypted', () => {
  const { event } = decodeMessage(
    'msh/US/2/c/LongFast/!0af87081',
    envelope({ port: 3, payload: position(30, -90), encrypt: false }),
  );
  assert.equal(event.type, 'position');
});

test('honours OK-to-MQTT, except for a gateway reporting its own packets', () => {
  const declined = (gateway) =>
    decodeMessage(
      TOPIC,
      envelope({ port: 3, payload: position(30, -90), bitfield: 0, gateway }),
    );
  assert.equal(declined('!deadbeef').skip, 'opt-out');
  assert.equal(declined(GATEWAY).event.type, 'position');
  // Approved, or from firmware that predates the flag.
  assert.equal(
    decodeMessage(TOPIC, envelope({ port: 3, payload: position(30, -90), bitfield: 1, gateway: '!deadbeef' }))
      .event.type,
    'position',
  );
});

test('a channel whose key is not held is reported, not guessed at', () => {
  const secret = expandKey(Buffer.alloc(16, 9).toString('base64'));
  const message = envelope({
    port: 1,
    payload: Buffer.from('hi'),
    channel: 'Private',
    key: secret,
  });
  const topic = `msh/US/2/e/Private/${GATEWAY}`;
  assert.deepEqual(decodeMessage(topic, message), {
    skip: 'private-channel',
    channelName: 'Private',
  });
  // With the key the person supplies, the same bytes are readable.
  const ring = keyRing([Buffer.alloc(16, 9).toString('base64')]);
  assert.equal(decodeMessage(topic, message, { keys: ring }).event.text, 'hi');
});

test('skips other ports, payload-less packets and JSON topics quietly', () => {
  assert.equal(decodeMessage(TOPIC, envelope({ port: 5, payload: Buffer.from([1]) })).skip, 'unsupported');
  const bare = cat(len(1, cat(f32(1, FROM), f32(2, BROADCAST), f32(6, 7))), len(2, 'LongFast'));
  assert.equal(decodeMessage(TOPIC, bare).skip, 'empty');
  assert.equal(decodeMessage('msh/US/2/json/LongFast/!1', Buffer.from('{}')).skip, 'topic');
  assert.equal(decodeMessage(TOPIC, Buffer.from('not protobuf')).skip, 'malformed');
});

// -- MQTT client ----------------------------------------------------------------

class FakeSocket extends EventEmitter {
  written = [];
  write(chunk) {
    this.written.push(Buffer.from(chunk));
  }
  destroy() {
    this.destroyed = true;
  }
  setKeepAlive() {}
  setNoDelay() {}
}

function publish(topic, payload) {
  const t = Buffer.from(topic);
  const head = Buffer.alloc(2);
  head.writeUInt16BE(t.length);
  const body = cat(head, t, payload);
  return cat(Buffer.from([0x30]), varint(body.length), body);
}

test('the CONNECT and SUBSCRIBE packets are valid MQTT 3.1.1', () => {
  const connect = connectPacket({ clientId: 'gev-1', username: 'meshdev', password: 'large4cats', keepAlive: 30 });
  assert.equal(connect[0], 0x10);
  assert.equal(connect.subarray(2, 10).toString('hex'), '00044d5154540 4c2'.replace(' ', ''));
  assert.ok(connect.includes(Buffer.from('gev-1')));
  assert.ok(connect.includes(Buffer.from('large4cats')));
  const subscribe = subscribePacket(1, ['msh/US/#']);
  assert.equal(subscribe[0], 0x82);
  assert.equal(subscribe[subscribe.length - 1], 0);
  assert.ok(subscribe.includes(Buffer.from('msh/US/#')));
});

test('splits a byte stream into packets, holding back a partial one', () => {
  const a = publish('a/b', Buffer.from('one'));
  const b = publish('a/c', Buffer.alloc(300, 1)); // two-byte remaining length
  const stream = cat(a, b);
  const whole = splitPackets(stream);
  assert.equal(whole.packets.length, 2);
  assert.equal(whole.rest.length, 0);
  const cut = splitPackets(stream.subarray(0, a.length + 5));
  assert.equal(cut.packets.length, 1);
  assert.equal(cut.rest.length, 5);
  assert.equal(splitPackets(Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0xff])).error, 'bad packet length');
});

function clientHarness(extra = {}) {
  const sockets = [];
  const timers = [];
  const messages = [];
  let clock = 1000;
  const client = createMqttClient({
    host: 'broker.test',
    username: 'u',
    password: 'p',
    topics: ['msh/US/#'],
    onMessage: (topic, payload) => messages.push({ topic, payload }),
    now: () => clock,
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
    clientIdFor: () => `gev-${sockets.length}`,
    ...extra,
  });
  return { client, sockets, timers, messages, tick: (ms) => (clock += ms) };
}

test('connects, subscribes after CONNACK, and delivers publishes', () => {
  const { client, sockets, messages } = clientHarness();
  client.start();
  const [socket] = sockets;
  socket.emit('connect');
  assert.equal(socket.written[0][0], 0x10);
  assert.equal(client.snapshot().status, 'connecting');
  socket.emit('data', Buffer.from([0x20, 2, 0, 0]));
  assert.equal(client.snapshot().status, 'live');
  assert.equal(socket.written[1][0], 0x82);
  // Split delivery across two chunks still yields one message.
  const wire = publish('msh/US/2/e/LongFast/!1', Buffer.from('payload'));
  socket.emit('data', wire.subarray(0, 6));
  socket.emit('data', wire.subarray(6));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].payload.toString(), 'payload');
  assert.equal(client.snapshot().messages, 1);
  client.stop();
  assert.equal(client.snapshot().status, 'stopped');
});

test('a refused login is reported as such and retried slowly', () => {
  const { client, sockets, timers } = clientHarness();
  client.start();
  sockets[0].emit('connect');
  sockets[0].emit('data', Buffer.from([0x20, 2, 0, 4]));
  const snapshot = client.snapshot();
  assert.equal(snapshot.status, 'auth-failed');
  assert.match(snapshot.error, /username or password/);
  assert.equal(timers.at(-1).ms, 300_000);
  client.stop();
});

test('a dropped connection reconnects with a fresh client id', () => {
  const { client, sockets, timers } = clientHarness();
  client.start();
  sockets[0].emit('connect');
  sockets[0].emit('data', Buffer.from([0x20, 2, 0, 0]));
  sockets[0].emit('close');
  assert.equal(client.snapshot().status, 'reconnecting');
  timers.at(-1).fn();
  assert.equal(sockets.length, 2);
  sockets[1].emit('connect');
  assert.ok(sockets[1].written[0].includes(Buffer.from('gev-1')));
  assert.ok(!sockets[0].written[0].includes(Buffer.from('gev-1')));
  client.stop();
});

// -- Store ----------------------------------------------------------------------

async function openStore(options = {}) {
  const DatabaseSync = await loadSqlite();
  let clock = 1_000_000_000;
  const store = createMeshtasticStore({
    DatabaseSync,
    file: ':memory:',
    autoFlush: false,
    now: () => clock,
    ...options,
  });
  return { store, advance: (ms) => (clock += ms), clock: () => clock };
}

const pos = (id, lat, lon, extra = {}) => ({
  type: 'position',
  id,
  from: 1,
  packetId: extra.packetId ?? Math.floor(Math.random() * 1e9),
  channel: 'LongFast',
  root: 'msh/US',
  gateway: id,
  snr: 5,
  rssi: -80,
  hops: 1,
  viaMqtt: false,
  position: { lat, lon, alt: 10, precisionBits: 16, speedKmh: 0, course: null },
});

test('stores nodes, filters by radius and by enabled server, nearest first', async () => {
  const { store } = await openStore();
  store.ingest(pos('!aaaaaaaa', 34.7, -86.6), 'almesh');
  store.ingest(pos('!bbbbbbbb', 34.8, -86.7), 'almesh');
  store.ingest(pos('!cccccccc', 51.5, -0.1), 'global');
  store.flush();
  const near = store.nodes({ lat: 34.7, lon: -86.6, radiusKm: 50, sinceMs: 3_600_000, serverIds: ['almesh', 'global'] });
  assert.deepEqual(near.nodes.map((n) => n.id), ['!aaaaaaaa', '!bbbbbbbb']);
  assert.equal(near.nodes[0].precisionKm, 0.7);
  assert.equal(store.nodes({ radiusKm: null, sinceMs: 3_600_000, serverIds: ['almesh', 'global'] }).total, 3);
  // Switching a server off hides what it supplied without deleting it.
  assert.equal(store.nodes({ radiusKm: null, sinceMs: 3_600_000, serverIds: ['global'] }).total, 1);
  assert.equal(store.nodes({ radiusKm: null, sinceMs: 3_600_000, serverIds: [] }).total, 0);
  store.close();
});

test('the same packet heard through two gateways is counted once', async () => {
  const { store } = await openStore();
  const event = pos('!aaaaaaaa', 34.7, -86.6, { packetId: 42 });
  store.ingest(event, 'almesh');
  store.ingest({ ...event, gateway: '!other' }, 'global');
  store.flush();
  const [node] = store.nodes({ radiusKm: null, sinceMs: 3_600_000, serverIds: ['almesh', 'global'] }).nodes;
  assert.equal(node.packets, 1);
  store.close();
});

test('names, telemetry and a track accumulate on one node', async () => {
  const { store, advance } = await openStore();
  const id = '!aaaaaaaa';
  store.ingest(pos(id, 34.7, -86.6), 's');
  advance(120_000);
  store.ingest(pos(id, 34.71, -86.6), 's');
  advance(120_000);
  store.ingest({ ...pos(id, 34.72, -86.6), type: 'nodeinfo', user: { longName: 'Hilltop', shortName: 'HT', role: 'ROUTER', hwModel: 43 } }, 's');
  store.ingest(
    { type: 'telemetry', id, from: 1, packetId: 9, channel: 'LongFast', root: 'msh/US', viaMqtt: false, telemetry: { battery: 80, voltage: 4, tempC: 20 } },
    's',
  );
  store.flush();
  const found = store.nodes({ radiusKm: null, sinceMs: 3_600_000, serverIds: ['s'], filter: ['hill*'] });
  assert.equal(found.nodes.length, 1);
  const [node] = found.nodes;
  assert.equal(node.longName, 'Hilltop');
  assert.equal(node.role, 'ROUTER');
  assert.equal(node.battery, 80);
  assert.deepEqual(node.env, { tempC: 20 });
  assert.equal(node.trailPoints, 2);
  const detail = store.detail(id);
  assert.equal(detail.track.length, 2);
  assert.equal(detail.telemetry.length, 1);
  assert.equal(store.nodes({ radiusKm: null, sinceMs: 3_600_000, serverIds: ['s'], filter: ['zzz'] }).total, 0);
  store.close();
});

test('a stationary node never grows a track', async () => {
  const { store, advance } = await openStore();
  for (let i = 0; i < 5; i += 1) {
    store.ingest(pos('!aaaaaaaa', 34.7, -86.6), 's');
    advance(120_000);
  }
  store.flush();
  assert.equal(store.detail('!aaaaaaaa').track.length, 0);
  assert.equal(store.stats().positions, 1);
  store.close();
});

test('messages anchor to the sender and only those inside the radius come back', async () => {
  const { store } = await openStore();
  store.ingest(pos('!aaaaaaaa', 34.7, -86.6), 's');
  store.ingest(pos('!cccccccc', 51.5, -0.1), 's');
  const text = (id, body, packetId, to = '^all') => ({
    type: 'text', id, from: 1, to: to === '^all' ? BROADCAST : to, packetId, channel: 'LongFast', root: 'msh/US', viaMqtt: false, text: body,
  });
  store.ingest({ ...text('!aaaaaaaa', 'hello Huntsville', 1), to: BROADCAST }, 's');
  store.ingest({ ...text('!cccccccc', 'hello London', 2), to: BROADCAST }, 's');
  store.ingest({ ...text('!dddddddd', 'no position known', 3), to: BROADCAST }, 's');
  store.flush();
  const all = store.messages({ after: 0, radiusKm: null, sinceMs: 3_600_000, serverIds: ['s'] });
  assert.deepEqual(all.messages.map((m) => m.text), ['hello Huntsville', 'hello London']);
  const local = store.messages({ after: 0, lat: 34.7, lon: -86.6, radiusKm: 100, sinceMs: 3_600_000, serverIds: ['s'] });
  assert.deepEqual(local.messages.map((m) => m.text), ['hello Huntsville']);
  assert.equal(local.messages[0].toLabel, '#LongFast');
  assert.equal(local.messages[0].anchoredTo, 'sender');
  assert.equal(store.messages({ after: all.cursor, radiusKm: null, sinceMs: 3_600_000, serverIds: ['s'] }).messages.length, 0);
  store.close();
});

test('nothing older than 24 hours survives a prune', async () => {
  const { store, advance } = await openStore();
  store.ingest(pos('!aaaaaaaa', 34.7, -86.6), 's');
  store.flush();
  advance(25 * 3_600_000);
  store.prune();
  assert.equal(store.stats().nodes, 0);
  store.close();
});

test('deleting a server removes what it supplied, and its config survives a cache rebuild', async () => {
  const { store } = await openStore();
  store.saveServer({ ...SEED_SERVERS[0] });
  store.ingest(pos('!aaaaaaaa', 34.7, -86.6), 'global');
  store.flush();
  store.removeServer('global');
  assert.equal(store.stats().nodes, 0);
  assert.equal(store.getServer('global'), null);
  store.close();
});

test('the cache is rebuilt on a schema change but the server list is kept', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-mesh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const DatabaseSync = await loadSqlite();
  const file = path.join(dir, 'm.sqlite');
  const first = createMeshtasticStore({ DatabaseSync, file, autoFlush: false });
  first.saveServer({ ...SEED_SERVERS[1], enabled: true });
  first.ingest(pos('!aaaaaaaa', 34.7, -86.6), 'almesh');
  first.close();
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA user_version = 0');
  raw.close();
  const second = createMeshtasticStore({ DatabaseSync, file, autoFlush: false });
  assert.equal(second.stats().nodes, 0);
  assert.equal(second.getServer('almesh').enabled, true);
  second.close();
});

// -- Server list ----------------------------------------------------------------

test('a server is validated the way it is typed', () => {
  const ok = validateServer({ name: 'Home', host: 'MQTT.Example.org', topic: 'msh/US/AL/#' });
  assert.equal(ok.server.host, 'mqtt.example.org');
  assert.equal(ok.server.port, 1883);
  assert.equal(validateServer({ name: 'T', host: 'a.b', tls: true }).server.port, 8883);
  assert.equal(validateServer({ name: 'T', host: 'a.b' }).server.topic, 'msh/US/#');
  for (const bad of [
    { name: '', host: 'a.b' },
    { name: 'x', host: 'not a host' },
    { name: 'x', host: 'http://a.b' },
    { name: 'x', host: 'a.b', port: 70000 },
    { name: 'x', host: 'a.b', topic: 'msh/#/US' },
    { name: 'x', host: 'a.b', topic: 'msh/U+S' },
    { name: 'x', host: 'a.b', keys: ['nope!!'] },
  ])
    assert.ok(validateServer(bad).error, JSON.stringify(bad));
});

function managerHarness(store) {
  const clients = [];
  const manager = createServerManager({
    store,
    createClient: (options) => {
      const client = {
        options,
        started: false,
        stopped: false,
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
        snapshot: () => ({ status: 'live', error: null, lastMessageAt: 5, messagesPerMinute: 7 }),
      };
      clients.push(client);
      return client;
    },
  });
  return { manager, clients };
}

test('the global broker and ALmesh are offered once, off, and stay deleted', async () => {
  const { store } = await openStore();
  const { manager, clients } = managerHarness(store);
  manager.start();
  const list = manager.list();
  assert.deepEqual(list.map((s) => s.id), ['global', 'almesh']);
  assert.equal(list[1].host, 'mqtt.almesh.net');
  assert.ok(list.every((s) => s.status === 'off'));
  assert.equal(clients.length, 0, 'nothing connects until a server is switched on');
  manager.remove('almesh');
  manager.dispose();
  const again = managerHarness(store);
  again.manager.start();
  assert.deepEqual(again.manager.list().map((s) => s.id), ['global']);
  store.close();
});

test('switching a server on connects it; editing the topic reconnects; off disconnects', async () => {
  const { store } = await openStore();
  const { manager, clients } = managerHarness(store);
  manager.start();
  manager.update('almesh', { enabled: true });
  assert.equal(clients.length, 1);
  assert.equal(clients[0].started, true);
  assert.equal(clients[0].options.host, 'mqtt.almesh.net');
  assert.equal(clients[0].options.username, 'meshdev');
  assert.deepEqual(manager.enabledIds(), ['almesh']);
  manager.update('almesh', { topic: 'msh/US/AL/#' });
  assert.equal(clients[0].stopped, true);
  assert.deepEqual(clients[1].options.topics, ['msh/US/AL/#']);
  assert.equal(clients[1].options.password, 'large4cats', 'an edit does not blank the password');
  manager.update('almesh', { enabled: false });
  assert.equal(clients[1].stopped, true);
  assert.equal(manager.list().find((s) => s.id === 'almesh').status, 'off');
  store.close();
});

test('a custom server is added on, listed without its secrets, and can be deleted', async () => {
  const { store } = await openStore();
  const { manager, clients } = managerHarness(store);
  manager.start();
  const added = manager.add({ name: 'My broker', host: 'mesh.example.org', username: 'me', password: 'hunter2', keys: ['Ag=='] });
  assert.equal(added.server.enabled, true);
  assert.equal(clients.length, 1);
  const shown = JSON.stringify(manager.list());
  assert.ok(!shown.includes('hunter2'));
  assert.ok(!shown.includes('Ag=='));
  const mine = manager.list().find((s) => s.name === 'My broker');
  assert.equal(mine.hasPassword, true);
  assert.equal(mine.keyCount, 1);
  assert.equal(manager.add({ name: '', host: 'x' }).status, 400);
  assert.deepEqual(manager.remove(mine.id), { ok: true });
  assert.equal(clients[0].stopped, true);
  assert.equal(manager.remove(mine.id).status, 404);
  store.close();
});

test('decoded traffic from a server reaches the store under that server', async () => {
  const { store } = await openStore();
  const { manager, clients } = managerHarness(store);
  manager.start();
  manager.update('global', { enabled: true });
  clients[0].options.onMessage(TOPIC, envelope({ port: 3, payload: position(34.7, -86.6) }), 1_000_000_000);
  clients[0].options.onMessage(TOPIC, Buffer.from('junk'), 1_000_000_000);
  store.flush();
  assert.equal(store.nodes({ radiusKm: null, sinceMs: 3_600_000, serverIds: ['global'] }).total, 1);
  assert.equal(manager.list().find((s) => s.id === 'global').decoded, 1);
  store.close();
});

// -- HTTP -------------------------------------------------------------------------

function call(handler, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
    Object.assign(req, { method, url, headers });
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
      },
      end(text) {
        resolve({ status: this.statusCode, body: JSON.parse(text) });
      },
    };
    handler(req, res);
  });
}

test('changing the server list needs same-origin JSON', async () => {
  const { store } = await openStore();
  const { manager } = managerHarness(store);
  manager.start();
  const handler = createMeshtasticMiddleware({ store: () => store, servers: () => manager, storageError: () => null });
  const json = { 'content-type': 'application/json', host: 'localhost:5173' };
  const add = JSON.stringify({ name: 'Mine', host: 'mesh.example.org' });
  assert.equal((await call(handler, { method: 'POST', url: '/servers', headers: { host: 'localhost:5173' }, body: add })).status, 415);
  assert.equal(
    (await call(handler, { method: 'POST', url: '/servers', headers: { ...json, origin: 'https://evil.example' }, body: add })).status,
    403,
  );
  const ok = await call(handler, { method: 'POST', url: '/servers', headers: { ...json, origin: 'http://localhost:5173' }, body: add });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.servers.length, 3);
  assert.equal((await call(handler, { method: 'POST', url: '/servers', headers: json, body: '[1]' })).status, 400);
  assert.equal((await call(handler, { method: 'POST', url: '/servers/delete', headers: json, body: JSON.stringify({ id: 'nope' }) })).status, 404);
  const listed = await call(handler, { url: '/servers' });
  assert.ok(!JSON.stringify(listed.body).includes('large4cats'));
  store.close();
});

test('the node, message and detail routes answer over the store', async () => {
  const { store } = await openStore();
  const { manager } = managerHarness(store);
  manager.start();
  manager.update('almesh', { enabled: true });
  store.ingest(pos('!aaaaaaaa', 34.7, -86.6), 'almesh');
  store.flush();
  const handler = createMeshtasticMiddleware({ store: () => store, servers: () => manager, storageError: () => null });
  const nodes = await call(handler, { url: '/nodes?lat=34.7&lon=-86.6&radiusKm=100&windowMin=60' });
  assert.equal(nodes.body.nodes.length, 1);
  assert.equal(nodes.body.servers.length, 2);
  const primed = await call(handler, { url: '/messages' });
  assert.deepEqual(primed.body.messages, []);
  assert.equal((await call(handler, { url: '/node?id=!aaaaaaaa' })).body.node.id, '!aaaaaaaa');
  assert.equal((await call(handler, { url: '/node?id=!zzzzzzzz' })).status, 404);
  const status = await call(handler, { url: '/status' });
  assert.equal(status.body.storage.nodes, 1);
  store.close();
});

test('node ids are the firmware `!` plus eight hex digits', () => {
  assert.equal(nodeId(0x0af87081), '!0af87081');
  assert.equal(nodeId(0xffffffff), '!ffffffff');
  assert.equal(nodeId(1), '!00000001');
});

test('server list changes work behind a reverse proxy that rewrites Host', async () => {
  const { store } = await openStore();
  const { manager } = managerHarness(store);
  manager.start();
  const handler = createMeshtasticMiddleware({ store: () => store, servers: () => manager, storageError: () => null });
  // nginx's default Host is the upstream address, not the public name.
  const proxied = { 'content-type': 'application/json', host: '10.1.2.10:4173' };
  const add = JSON.stringify({ name: 'Mine', host: 'mesh.example.org' });
  const post = (headers) => call(handler, { method: 'POST', url: '/servers', headers: { ...proxied, ...headers }, body: add });
  assert.equal((await post({ origin: 'https://gev.example.net' })).status, 403);
  assert.equal((await post({ origin: 'https://gev.example.net', 'x-forwarded-host': 'gev.example.net' })).status, 200);
  assert.equal((await post({ origin: 'https://gev.example.net', 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal((await post({ origin: 'https://gev.example.net', 'sec-fetch-site': 'cross-site', 'x-forwarded-host': 'gev.example.net' })).status, 403);
  store.close();
});
