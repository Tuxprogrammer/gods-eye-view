import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropagationMiddleware } from '../../../server/providers/propagation/middleware.js';
import {
  extractContours,
  extractStations,
  normalizeLongitude,
} from '../../../server/providers/propagation/overlays.js';

const line = (level, coordinates, stroke = '#005767') => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: {
    'level-index': 2,
    'level-value': level,
    stroke,
    title: `${level.toFixed(2)} `,
  },
});
const collection = (...features) =>
  JSON.stringify({ type: 'FeatureCollection', features });

test('contours become flat, rounded paths with a tidy label', () => {
  const lines = extractContours(
    collection(
      line(10.1, [
        [-5, -41.0267],
        [-5.08176, -41],
        [-6, -40.67351],
      ]),
      line(10.1, [
        [80, 1],
        [81, 2],
      ]),
      line(28, [
        [1, 1],
        [2, 2],
      ]),
    ),
  );
  assert.equal(lines.length, 3, 'several features per level are kept');
  assert.deepEqual(lines[0].positions, [-5, -41.027, -5.082, -41, -6, -40.674]);
  assert.equal(lines[0].label, '10.1');
  assert.equal(lines[0].color, '#005767');
  assert.equal(lines[2].label, '28');
  assert.equal(lines[2].value, 28);
});

test('a path is broken where it would wrap the long way round the globe', () => {
  const lines = extractContours(
    collection(
      line(14, [
        [178, 10],
        [179.5, 11],
        [-179.5, 11.5],
        [-178, 12],
      ]),
    ),
  );
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].positions, [178, 10, 179.5, 11]);
  assert.deepEqual(lines[1].positions, [-179.5, 11.5, -178, 12]);
});

test('fragments too short to draw are dropped and a bad colour is ignored', () => {
  const lines = extractContours(
    collection(
      line(7, [[1, 1]]),
      line(
        18,
        [
          [1, 1],
          [2, 2],
        ],
        'red',
      ),
    ),
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].color, null);
});

test('unrecognised contour data is rejected', () => {
  const ok = [
    [1, 1],
    [2, 2],
  ];
  const cases = [
    ['not json', 'nope'],
    ['not a collection', JSON.stringify({ type: 'Feature' })],
    [
      'polygon',
      collection({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [] },
        properties: { 'level-value': 5 },
      }),
    ],
    ['no level', collection({ ...line(5, ok), properties: {} })],
    ['bad vertex', collection(line(5, [[1, 95], [2, 2]]))],
    ['non-numeric vertex', collection(line(5, [['a', 1], [2, 2]]))],
  ];
  for (const [name, text] of cases)
    assert.throws(() => extractContours(text), /Unrecognised/, name);
  const big = Array.from({ length: 61_000 }, (_, i) => [(i % 300) / 10, 1]);
  assert.throws(() => extractContours(collection(line(5, big))), /too many/);
});

const NOW = Date.parse('2026-09-20T16:00:00Z');
const row = (code, over = {}) => ({
  station: {
    code,
    name: `${code} name`,
    latitude: '30.4',
    longitude: '262.3',
    id: 1,
  },
  time: '2026-09-20T15:25:01',
  fof2: 8.6,
  mufd: 28.8,
  hmf2: 241.8,
  cs: 75,
  source: 'giro',
  ...over,
});

test('stations: longitudes are normalised and times read as UTC', () => {
  const [station] = extractStations(JSON.stringify([row('AU930')]), NOW);
  assert.equal(station.lon, -97.7);
  assert.equal(station.lat, 30.4);
  assert.equal(station.time, Date.parse('2026-09-20T15:25:01Z'));
  assert.equal(station.fof2, 8.6);
  assert.equal(station.mufd, 28.8);
  assert.equal(station.confidence, 75);
  assert.equal(normalizeLongitude(0.5), 0.5);
  assert.equal(normalizeLongitude(353.3), -6.7);
  assert.equal(normalizeLongitude(180), -180);
});

test('stations: only reporting stations with a usable value are kept, newest first', () => {
  const rows = [
    row('OLD', { time: '2026-09-19T01:00:00' }),
    row('NONE', { fof2: null, mufd: null }),
    row('ZERO', { fof2: 0, mufd: 0 }),
    row('MUFONLY', { fof2: null, time: '2026-09-20T15:00:00' }),
    row('NEW', { time: '2026-09-20T15:50:00' }),
    { station: { code: 'BADLAT', latitude: 'x', longitude: '1' }, fof2: 5 },
    { junk: true },
  ];
  const stations = extractStations(JSON.stringify(rows), NOW);
  assert.deepEqual(
    stations.map((s) => s.code),
    ['NEW', 'MUFONLY'],
  );
  assert.equal(stations[1].fof2, null);
  assert.equal(stations[1].mufd, 28.8);
});

test('stations: a non-array is the format changing', () => {
  assert.throws(() => extractStations('{}', NOW), /Unrecognised/);
  assert.throws(() => extractStations('nope', NOW), /Unrecognised/);
  assert.deepEqual(extractStations('[]', NOW), []);
});

function harness({ svgFails = true } = {}) {
  const calls = [];
  const state = { contours: 'ok', stations: 'ok' };
  const clock = { t: NOW };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('.svg'))
      return svgFails
        ? new Response('<svg></svg>', { status: 200 })
        : new Response('x', { status: 500 });
    if (url.endsWith('.geojson')) {
      if (state.contours === 'fail') return new Response('x', { status: 500 });
      return new Response(
        collection(
          line(10.1, [
            [1, 1],
            [2, 2],
          ]),
        ),
        {
          status: 200,
          headers: {
            'last-modified': new Date(clock.t).toUTCString(),
            etag: '"c1"',
          },
        },
      );
    }
    if (url.endsWith('stations.json')) {
      if (state.stations === 'fail') return new Response('x', { status: 500 });
      return new Response(JSON.stringify([row('AU930')]), { status: 200 });
    }
    return new Response('?', { status: 404 });
  };
  const middleware = createPropagationMiddleware({
    fetchImpl,
    now: () => clock.t,
  });
  async function request(path, { headers = {} } = {}) {
    const out = { status: 0, headers: {}, body: '' };
    await middleware(
      { url: path, method: 'GET', headers },
      {
        writeHead(status, head) {
          out.status = status;
          out.headers = head;
        },
        end(body) {
          out.body = body;
        },
      },
    );
    if (out.status === 200) out.json = JSON.parse(out.body);
    return out;
  }
  return { calls, clock, state, request };
}

test('the contours route asks only for that field\'s GeoJSON', async () => {
  const { calls, request } = harness();
  const res = await request('/fof2/contours');
  assert.equal(res.status, 200);
  assert.equal(res.json.field, 'fof2');
  assert.equal(res.json.stale, false);
  assert.equal(res.json.lines.length, 1);
  assert.deepEqual(calls, [
    'https://prop.kc2g.com/renders/current/fof2-normal-now.geojson',
  ]);
});

test('the stations route asks only for the station list, once for everyone', async () => {
  const { calls, request } = harness();
  const [a, b] = await Promise.all([
    request('/stations'),
    request('/stations'),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.json.stations[0].code, 'AU930');
  assert.deepEqual(calls, ['https://prop.kc2g.com/api/stations.json']);
});

test('each overlay is its own cache: none is fetched until asked for', async () => {
  const { calls, request } = harness();
  await request('/muf/contours');
  assert.equal(calls.length, 1);
  await request('/muf/contours');
  assert.equal(calls.length, 1, 'fresh copy is not refetched');
  await request('/stations');
  assert.equal(calls.length, 2);
});

test('a failing overlay never breaks the map or the other overlay', async () => {
  const { state, request } = harness({ svgFails: true });
  state.contours = 'fail';
  assert.equal((await request('/muf/contours')).status, 502);
  assert.equal((await request('/stations')).status, 200);
  // And the reverse: the map is unrecognisable, the overlays still serve.
  assert.equal((await request('/muf')).status, 502);
  state.contours = 'ok';
  assert.equal((await request('/fof2/contours')).status, 200);
});

test('an overlay serves its last copy stale after a failure, with backoff', async () => {
  const { calls, clock, state, request } = harness();
  await request('/stations');
  state.stations = 'fail';
  clock.t += 11 * 60_000;
  const stale = await request('/stations');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  const before = calls.length;
  clock.t += 5_000;
  await request('/stations');
  assert.equal(calls.length, before, 'backoff suppresses an immediate retry');
});

test('unknown overlay routes are 404 and touch nothing', async () => {
  const { calls, request } = harness();
  assert.equal((await request('/nope/contours')).status, 404);
  assert.equal((await request('/muf/other')).status, 404);
  assert.equal((await request('/stations/x')).status, 404);
  assert.equal(calls.length, 0);
});
