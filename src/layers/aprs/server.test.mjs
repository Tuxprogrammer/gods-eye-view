import assert from 'node:assert/strict';
import test from 'node:test';
import { aprsPasscode, isValidCallsign } from '../../../server/providers/aprs/passcode.js';
import { parsePacket, parseWeather } from '../../../server/providers/aprs/parser.js';
import { createAprsStore, loadSqlite } from '../../../server/providers/aprs/store.js';
import { createAprsClient } from '../../../server/providers/aprs/client.js';
import { EventEmitter } from 'node:events';

const near = (actual, expected, tolerance = 0.0005) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} !~ ${expected}`);

test('passcode matches the published value for N0CALL and ignores the SSID', () => {
  assert.equal(aprsPasscode('N0CALL'), 13023);
  assert.equal(aprsPasscode('n0call-9'), 13023);
  assert.equal(isValidCallsign('KQ4VYY'), true);
  assert.equal(isValidCallsign('KQ4VYY-9'), true);
  assert.equal(isValidCallsign('not a call'), false);
  assert.equal(isValidCallsign(''), false);
});

test('parses an uncompressed position with course, speed and altitude', () => {
  const p = parsePacket(
    'N0CALL-9>APRS,TCPIP*,qAC,T2X:!4903.50N/07201.75W>088/036/A=001234Test',
  );
  assert.equal(p.kind, 'position');
  assert.equal(p.id, 'N0CALL-9');
  near(p.position.lat, 49.0583);
  near(p.position.lon, -72.0292);
  assert.equal(p.position.symTable, '/');
  assert.equal(p.position.symCode, '>');
  assert.equal(p.position.course, 88);
  near(p.position.speed, 36 * 1.852, 0.1);
  assert.equal(p.position.alt, Math.round(1234 * 0.3048));
  assert.equal(p.position.comment, 'Test');
});

test('parses a position with a timestamp and southern/eastern hemispheres', () => {
  const p = parsePacket('VK2ABC>APRS:@092345z3351.00S/15112.00E-Sydney');
  near(p.position.lat, -33.85);
  near(p.position.lon, 151.2);
});

test('parses the compressed position from the APRS specification', () => {
  const p = parsePacket('N0CALL>APRS:=/5L!!<*e7>7P[');
  near(p.position.lat, 49.5, 0.001);
  near(p.position.lon, -72.75, 0.001);
  assert.equal(p.position.symCode, '>');
});

test('parses a weather station like the one on aprs.fi', () => {
  const p = parsePacket(
    'W4HSV>APRS,TCPXX*,qAX,CWOP-3:=3446.55N/08636.00W_211/003g009t091r000p001P000h60b10147.DsVP',
  );
  assert.equal(p.kind, 'position');
  assert.equal(p.position.symCode, '_');
  assert.deepEqual(
    { ...p.wx },
    {
      windDir: 211,
      windSpeedMph: 3,
      gustMph: 9,
      tempF: 91,
      rain1hIn: 0,
      rain24hIn: 0.01,
      rainMidnightIn: 0,
      humidity: 60,
      pressureMb: 1014.7,
    },
  );
  assert.equal(p.position.course, null);
  assert.equal(p.position.comment, '.DsVP', 'only the software tag is left as the comment');
});

test('parses positionless weather and treats h00 as 100 percent', () => {
  const p = parsePacket('WX1ABC>APRS:_10090556c220s004g005t077r000p000P000h00b09720');
  assert.equal(p.kind, 'weather');
  assert.equal(p.wx.humidity, 100);
  assert.equal(p.wx.tempF, 77);
  assert.equal(p.wx.pressureMb, 972);
  assert.equal(parseWeather('hello world'), null);
  assert.equal(parseWeather('t999'), null);
});

test('parses objects, items and killed objects', () => {
  const live = parsePacket('N0CALL>APRS:;LEADER   *092345z4903.50N/07201.75W>Object');
  assert.equal(live.id, 'LEADER');
  assert.equal(live.owner, 'N0CALL');
  assert.equal(live.object, 'object');
  assert.equal(live.live, true);
  const dead = parsePacket('N0CALL>APRS:;LEADER   _092345z4903.50N/07201.75W>x');
  assert.equal(dead.live, false);
  const item = parsePacket('N0CALL>APRS:)AID #2!4903.50N/07201.75WA');
  assert.equal(item.id, 'AID #2');
  assert.equal(item.object, 'item');
});

test('parses messages, msgno, and ignores acks and telemetry definitions', () => {
  const m = parsePacket('N0CALL>APRS::KQ4VYY   :Hello there{123');
  assert.equal(m.kind, 'message');
  assert.deepEqual(m.message, { to: 'KQ4VYY', text: 'Hello there', msgno: '123' });
  assert.equal(parsePacket('N0CALL>APRS::KQ4VYY   :ack123').kind, 'ignored');
  assert.equal(parsePacket('N0CALL>APRS::KQ4VYY   :PARM.Volts,Amps').kind, 'ignored');
  const status = parsePacket('N0CALL>APRS:>On the air');
  assert.equal(status.status, 'On the air');
});

test('unwraps third-party traffic once', () => {
  const p = parsePacket(
    'IGATE>APRS,TCPIP*:}N0CALL>APRS,TCPIP,IGATE*:!4903.50N/07201.75W-hi',
  );
  assert.equal(p.id, 'N0CALL');
});

test('decodes Mic-E (self-consistent with the encoding rules)', () => {
  // Latitude 33 25.64 N, longitude 112 07.74 W, 20 kt, course 251.
  // dest: digits 3 3 2 5 6 4 with N (idx3 high), +100 lon (idx4 high), W (idx5 high)
  const dest = '332U' + 'V' + 'T'.replace('T', 'T');
  const info = '`' + String.fromCharCode(12 + 28) + String.fromCharCode(7 + 28) +
    String.fromCharCode(74 + 28) + String.fromCharCode(2 + 28) +
    String.fromCharCode(2 + 28) + String.fromCharCode(51 + 28) + '>/';
  // dest chars: '3','3','2' digits; idx3 'U'->5 & north; idx4 'V'->6 & +100; idx5 'T'->4 & west
  const p = parsePacket(`N0CALL>${dest}:${info}`);
  assert.ok(p, 'decoded');
  near(p.position.lat, 33 + 25.64 / 60, 0.001);
  near(p.position.lon, -(112 + 7.74 / 60), 0.001);
  assert.equal(p.position.symCode, '>');
  assert.equal(p.position.course, 251);
  near(p.position.speed, 20 * 1.852, 0.1);
});

test('rejects invalid coordinates, null island and oversized or malformed lines', () => {
  assert.equal(parsePacket('N0CALL>APRS:!9903.50N/07201.75W>'), null);
  assert.equal(parsePacket('N0CALL>APRS:!0000.00N/00000.00E>'), null);
  assert.equal(parsePacket('garbage'), null);
  assert.equal(parsePacket('#aprsc heartbeat'), null);
  assert.equal(parsePacket(`N0CALL>APRS:>${'x'.repeat(2000)}`), null);
  assert.equal(parsePacket('bad call>APRS:>hi'), null);
});

async function memoryStore(clock) {
  const DatabaseSync = await loadSqlite();
  return createAprsStore({
    DatabaseSync,
    file: ':memory:',
    now: () => clock.t,
    autoFlush: false,
  });
}

const feed = (store, line, at) => store.ingest(parsePacket(line), at);

test('store keeps stations, windows them by last heard, and prunes past 24 h', async () => {
  const clock = { t: 1_000_000_000_000 };
  const store = await memoryStore(clock);
  feed(store, 'AA1AAA>APRS:!3446.55N/08636.00W>', clock.t);
  feed(store, 'BB2BBB>APRS:!3446.55N/08636.00W>', clock.t - 3 * 3_600_000);
  feed(store, 'CC3CCC>APRS:!5100.00N/00000.00E>', clock.t);
  store.flush();
  const at = { lat: 34.776, lon: -86.6 };
  const hour = store.stations({ ...at, radiusKm: 100, sinceMs: 3_600_000 });
  assert.deepEqual(hour.stations.map((s) => s.id), ['AA1AAA']);
  const day = store.stations({ ...at, radiusKm: 100, sinceMs: 24 * 3_600_000 });
  assert.deepEqual(day.stations.map((s) => s.id).sort(), ['AA1AAA', 'BB2BBB']);
  const earth = store.stations({ ...at, radiusKm: null, sinceMs: 3_600_000 });
  assert.equal(earth.total, 2);
  assert.equal(earth.stations[0].id, 'AA1AAA');
  clock.t += 25 * 3_600_000;
  store.prune();
  assert.equal(store.stats().stations, 0);
  assert.equal(store.stats().positions, 0);
  store.close();
});

test('store builds tracks from movement and skips duplicate fixes', async () => {
  const clock = { t: 1_000_000_000_000 };
  const store = await memoryStore(clock);
  const t0 = clock.t - 30 * 60_000;
  feed(store, 'MV1CAR>APRS:!3446.55N/08636.00W>', t0);
  feed(store, 'MV1CAR>APRS:!3446.55N/08636.00W>', t0 + 30_000);
  feed(store, 'MV1CAR>APRS:!3447.55N/08636.00W>', t0 + 60_000);
  feed(store, 'MV1CAR>APRS:!3448.55N/08636.00W>', t0 + 120_000);
  feed(store, 'FX1FIX>APRS:!3446.55N/08636.00W-', t0);
  feed(store, 'FX1FIX>APRS:!3446.55N/08636.00W-', t0 + 60_000);
  store.flush();
  const { stations } = store.stations({ lat: 34.8, lon: -86.6, radiusKm: 50, sinceMs: 3_600_000 });
  const car = stations.find((s) => s.id === 'MV1CAR');
  assert.equal(car.trailPoints, 3);
  const tracks = store.tracks(stations.map((s) => s.id), 3_600_000);
  assert.equal(tracks['MV1CAR'].length, 3);
  assert.equal(tracks['FX1FIX'], undefined, 'a stationary station has no track');
  assert.deepEqual(
    store.tracks(['MV1CAR'], 90_000)['MV1CAR']?.length ?? 0,
    0,
    'the track window is honoured',
  );
  store.close();
});

test('store filters weather, objects, moving and callsign patterns', async () => {
  const clock = { t: 1_000_000_000_000 };
  const store = await memoryStore(clock);
  feed(store, 'W4HSV>APRS:=3446.55N/08636.00W_211/003g009t091r000p001P000h60b10147', clock.t);
  feed(store, 'K4CAR>APRS:!3446.55N/08636.00W>088/036', clock.t);
  feed(store, 'K4OBJ>APRS:;HAZARD   *092345z3446.55N/08636.00W>x', clock.t);
  store.flush();
  const q = { lat: 34.8, lon: -86.6, radiusKm: 100, sinceMs: 3_600_000 };
  const ids = (extra) => store.stations({ ...q, ...extra }).stations.map((s) => s.id).sort();
  assert.deepEqual(ids({ weatherOnly: true }), ['W4HSV']);
  assert.deepEqual(ids({ movingOnly: true }), ['K4CAR']);
  assert.deepEqual(ids({ objects: false }), ['K4CAR', 'W4HSV']);
  assert.deepEqual(ids({ calls: ['K4*'] }), ['K4CAR']);
  assert.deepEqual(ids({ calls: ['hazard', 'w4hsv'] }), ['HAZARD', 'W4HSV']);
  const detail = store.detail('W4HSV');
  assert.equal(detail.station.wx.tempF, 91);
  assert.equal(detail.weather.length, 1);
  assert.equal(store.detail('NOBODY'), null);
  store.close();
});

test('killed objects leave the map', async () => {
  const clock = { t: 1_000_000_000_000 };
  const store = await memoryStore(clock);
  feed(store, 'K4OBJ>APRS:;HAZARD   *092345z3446.55N/08636.00W>x', clock.t);
  feed(store, 'K4OBJ>APRS:;HAZARD   _092345z3446.55N/08636.00W>x', clock.t + 1000);
  store.flush();
  assert.equal(store.stations({ lat: 34.8, lon: -86.6, radiusKm: 100, sinceMs: 3_600_000 }).total, 0);
  store.close();
});

test('messages are anchored to a known station, radius-filtered, deduped, and cursor-paged', async () => {
  const clock = { t: 1_000_000_000_000 };
  const store = await memoryStore(clock);
  feed(store, 'AA1AAA>APRS:!3446.55N/08636.00W>', clock.t);
  feed(store, 'CC3CCC>APRS:!5100.00N/00000.00E>', clock.t);
  feed(store, 'AA1AAA>APRS::CC3CCC   :hello{1', clock.t + 1);
  feed(store, 'AA1AAA>APRS::CC3CCC   :hello{1', clock.t + 2);
  feed(store, 'CC3CCC>APRS::AA1AAA   :far away{2', clock.t + 3);
  feed(store, 'ZZ9ZZZ>APRS::QQ9QQQ   :nobody known', clock.t + 4);
  store.flush();
  const at = { lat: 34.8, lon: -86.6 };
  const near100 = store.messages({ ...at, radiusKm: 100, sinceMs: 600_000 });
  assert.deepEqual(near100.messages.map((m) => m.text), ['hello']);
  assert.equal(near100.messages[0].anchoredTo, 'sender');
  const earth = store.messages({ ...at, radiusKm: null, sinceMs: 600_000 });
  assert.deepEqual(earth.messages.map((m) => m.text), ['hello', 'far away']);
  const next = store.messages({ ...at, radiusKm: null, sinceMs: 600_000, after: earth.messages[0].id });
  assert.deepEqual(next.messages.map((m) => m.text), ['far away']);
  assert.equal(next.cursor >= earth.messages[1].id, true);
  store.close();
});

test('a bad packet in a batch does not lose the rest', async () => {
  const clock = { t: 1_000_000_000_000 };
  const store = await memoryStore(clock);
  store.ingest({ kind: 'position', id: 'BAD', position: null });
  feed(store, 'AA1AAA>APRS:!3446.55N/08636.00W>', clock.t);
  store.flush();
  assert.equal(store.stats().stations, 1);
  store.close();
});

test('the client logs in with the computed passcode, never transmits, and reconnects', () => {
  const sockets = [];
  const timers = [];
  const connect = () => {
    const s = new EventEmitter();
    s.written = [];
    s.write = (text) => s.written.push(text);
    s.destroy = () => s.emit('close');
    s.setKeepAlive = () => {};
    s.setNoDelay = () => {};
    sockets.push(s);
    return s;
  };
  const got = [];
  const client = createAprsClient({
    callsign: 'kq4vyy',
    random: () => 0.5,
    onPacket: (packet) => got.push(packet),
    connect,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  client.start();
  const first = sockets[0];
  first.emit('connect');
  assert.equal(first.written.length, 1);
  assert.match(first.written[0], new RegExp(`^user KQ4VYY-GN pass ${aprsPasscode('KQ4VYY')} vers `));
  assert.equal(snapshotLeaksPasscode(client, 'KQ4VYY'), false);
  first.emit('data', Buffer.from('# aprsc 2.1.19 26 Sep 2026\r\n# logresp KQ4VYY verified, server T2TEST\r\n'));
  assert.equal(client.snapshot().status, 'live');
  assert.equal(client.snapshot().server, 'T2TEST');
  first.emit('data', Buffer.from('N0CALL>APRS:!4903.50N/07201.75W>\r\nN0CALL>APRS:!4903'));
  first.emit('data', Buffer.from('.50N/07201.75W>\r\n'));
  assert.equal(got.length, 2, 'lines split across chunks are reassembled');
  first.emit('close');
  assert.equal(client.snapshot().status, 'reconnecting');
  assert.equal(timers.at(-1).ms, 5000);
  timers.at(-1).fn();
  assert.equal(sockets.length, 2);
  // Only the login line was ever written: this station is receive-only.
  assert.equal(first.written.length, 1);
  client.stop();
});

function snapshotLeaksPasscode(client, callsign) {
  return JSON.stringify(client.snapshot()).includes(String(aprsPasscode(callsign)));
}

test('a bare callsign logs in with a letter SSID no real station uses; an explicit SSID is kept', () => {
  const make = (callsign, random) =>
    createAprsClient({ callsign, random, onPacket() {}, connect: () => new EventEmitter() });
  assert.equal(make('KQ4VYY', () => 0).snapshot().callsign, 'KQ4VYY-GA');
  assert.equal(make('KQ4VYY', () => 0.999).snapshot().callsign, 'KQ4VYY-GZ');
  assert.equal(make('KQ4VYY-3', () => 0).snapshot().callsign, 'KQ4VYY-3');
});

test('the client reports a missing or invalid callsign instead of connecting', () => {
  let connected = false;
  const client = createAprsClient({
    callsign: '',
    onPacket() {},
    connect: () => {
      connected = true;
    },
  });
  client.start();
  assert.equal(client.snapshot().status, 'missing-config');
  assert.equal(connected, false);
});

test('a masked position reads as the middle of the box the operator chose', async () => {
  const at = (packet) => parsePacket(`N0CALL>APRS:${packet}`).position;
  // 4903.5_ -> the true minute is somewhere in 4903.50-4903.60 (0.1' wide).
  const one = at('!4903.5 N/07201.7 W>');
  assert.equal(one.ambiguity, 1);
  near(one.lat, 49 + 3.55 / 60, 0.00001);
  near(one.lon, -(72 + 1.75 / 60), 0.00001);
  // Blank minutes entirely: the whole degree box, so its centre.
  const four = at('!49  .  N/072  .  W>');
  assert.equal(four.ambiguity, 4);
  near(four.lat, 49.5, 0.00001);
  near(four.lon, -72.5, 0.00001);
  assert.equal(at('!4903.50N/07201.75W>').ambiguity, 0);
});

test('a database from an older schema is rebuilt, not migrated or left to be deleted by hand', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'aprs-store-'));
  const file = join(dir, 'old.sqlite');
  try {
    const DatabaseSync = await loadSqlite();
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE stations (id TEXT PRIMARY KEY, comment TEXT); INSERT INTO stations VALUES ('OLD1', '135/000g001t097raw');",
    );
    old.close();
    const store = createAprsStore({ DatabaseSync, file, autoFlush: false });
    assert.equal(store.stats().stations, 0, 'stale rows are gone');
    store.ingest(parsePacket('AA1AAA>APRS:!3446.55N/08636.00W>'), Date.now());
    store.flush();
    store.close();
    const again = createAprsStore({ DatabaseSync, file, autoFlush: false });
    assert.equal(again.stats().stations, 1, 'a current database is kept');
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fixed station beaconing for hours never grows a track', async () => {
  const clock = { t: 1_000_000_000_000 };
  const store = await memoryStore(clock);
  for (let i = 0; i < 12; i += 1)
    feed(store, 'FX1FIX>APRS:!3446.55N/08636.00W-', clock.t - (12 - i) * 600_000);
  store.flush();
  const { stations } = store.stations({ lat: 34.8, lon: -86.6, radiusKm: 50, sinceMs: 86_400_000 });
  assert.equal(stations[0].trailPoints, 1);
  assert.equal(stations[0].packets, 12);
  store.close();
});
