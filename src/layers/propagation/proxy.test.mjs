import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropagationMiddleware } from '../../../server/providers/propagation/middleware.js';
import { extractPropagationMap } from '../../../server/providers/propagation/extract.js';

const BAR_LEFT = 120.981;
const BAR_WIDTH = 921.447;

function fakePng(width, height) {
  const png = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

function glyphs(label) {
  return [...label]
    .map((ch) => {
      const code = ch === '-' ? 0x2212 : ch.codePointAt(0);
      return `<use xlink:href="#DejaVuSans-${code.toString(16)}"/>`;
    })
    .join('');
}

/** Mirror the structure of a real matplotlib render, with a 4..35 log scale. */
function svgFixture({
  min = 4,
  max = 35,
  labels = ['5.3', '7.0', '10.1', '14.0', '18.0', '28.0'],
  heat = fakePng(2732, 1366),
  transform = 'matrix(1 0 0 -1 0 546.4)',
  axes2 = true,
} = {}) {
  const ticks = labels
    .map((label, index) => {
      const position = Math.log(Number(label) / min) / Math.log(max / min);
      const x = (BAR_LEFT + position * BAR_WIDTH).toFixed(3);
      return `<g id="xtick_${20 + index}"><use xlink:href="#m1" id="line2d_${57 + index}" x="${x}" y="655.008"/><g id="text_${70 + index}">${glyphs(label)}</g></g>`;
    })
    .join('');
  const b64 = (buffer) => buffer.toString('base64');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="figure_1">` +
    `<path id="patch_1" d="M0 678.886h1144.848V0H0z"/><g id="axes_1">` +
    `<path id="patch_2" d="M35.305 570.542v-546.4h1092.8v546.4z"/>` +
    `<image id="image1" width="1092.8" height="546.4" x="35.305" y="-24.142"${transform ? ` transform="${transform}"` : ''} xlink:href="data:image/png;base64, ${b64(heat)}"/>` +
    `<g id="xtick_1"><use xlink:href="#m9" x="35.305" y="570"/><g id="text_1">${glyphs('-180')}</g></g></g>` +
    (axes2
      ? `<g id="axes_2"><path id="patch_29" d="M${BAR_LEFT} 655.008h${BAR_WIDTH}v-50.68H${BAR_LEFT}z"/>` +
        `<image id="image2" width="921.6" height="50.4" x="120.8" y="-604.4" transform="matrix(1 0 0 -1 0 50.4)" xlink:href="data:image/png;base64, ${b64(fakePng(2304, 126))}"/>` +
        `${ticks}</g>`
      : '') +
    `</g></svg>`
  );
}

test('extracts the heatmap, orientation and a log colour scale', () => {
  const map = extractPropagationMap(svgFixture());
  assert.equal(map.southUp, true);
  assert.equal(map.scale, 'log');
  assert.ok(Math.abs(map.range.min - 4) < 0.1, `min ${map.range.min}`);
  assert.ok(Math.abs(map.range.max - 35) < 0.3, `max ${map.range.max}`);
  assert.equal(map.ticks.length, 6);
  assert.deepEqual(
    map.ticks.map((tick) => tick.label),
    ['5.3', '7.0', '10.1', '14.0', '18.0', '28.0'],
  );
  assert.deepEqual(map.bounds, { west: -180, south: -90, east: 180, north: 90 });
  assert.equal(map.heatmap.readUInt32BE(16), 2732);
});

test('the map axes ticks are not mistaken for colour-bar ticks', () => {
  const map = extractPropagationMap(svgFixture());
  assert.ok(map.ticks.every((tick) => tick.value > 0));
});

test('an unmarked (north-up) raster is reported as such', () => {
  assert.equal(extractPropagationMap(svgFixture({ transform: '' })).southUp, false);
});

test('unrecognised layouts are rejected rather than guessed at', () => {
  for (const [name, svg] of [
    ['not svg', 'nope'],
    ['no colour bar', svgFixture({ axes2: false })],
    ['not 2:1', svgFixture({ heat: fakePng(2732, 1000) })],
    ['not a png', svgFixture({ heat: Buffer.alloc(64, 1) })],
    ['odd transform', svgFixture({ transform: 'rotate(90)' })],
    ['too few ticks', svgFixture({ labels: ['5.3'] })],
  ]) {
    assert.throws(() => extractPropagationMap(svg), /Unrecognised/, name);
  }
});

test('a linear (non-log) colour bar is refused', () => {
  const svg = svgFixture().replace(/(id="line2d_59" x=")[\d.]+/, '$1900');
  assert.throws(() => extractPropagationMap(svg), /log scale/);
});

function harness({ svg = svgFixture(), start = 1_000_000 } = {}) {
  const calls = [];
  const clock = { t: start };
  const state = { mode: 'ok', headers: {} };
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (state.mode === 'fail') throw new Error('network down');
    if (state.mode === 'notModified' && options.headers['If-None-Match'])
      return new Response(null, { status: 304 });
    return new Response(svg, {
      status: 200,
      headers: {
        'content-type': 'image/svg+xml',
        etag: '"abc"',
        'last-modified': new Date(clock.t).toUTCString(),
        expires: new Date(clock.t + 10 * 60_000).toUTCString(),
        ...state.headers,
      },
    });
  };
  const middleware = createPropagationMiddleware({
    fetchImpl,
    now: () => clock.t,
  });
  async function request(path, { method = 'GET', headers = {} } = {}) {
    const out = { status: 0, headers: {}, body: '' };
    await middleware(
      { url: path, method, headers },
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
    if (out.body && out.status === 200) out.json = JSON.parse(out.body);
    return out;
  }
  return { calls, clock, state, request };
}

test('makes no upstream request until a client asks', () => {
  const { calls } = harness();
  assert.equal(calls.length, 0);
});

test('serves a map and only the fixed upstream URL is requested', async () => {
  const { calls, request } = harness();
  const res = await request('/muf');
  assert.equal(res.status, 200);
  assert.equal(res.json.field, 'muf');
  assert.equal(res.json.stale, false);
  assert.equal(res.json.southUp, true);
  assert.equal(res.json.unit, 'MHz');
  assert.ok(res.json.heatmap.length > 10);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://prop.kc2g.com/renders/current/mufd-normal-now.svg',
  );
});

test('a held map is served without touching the upstream while fresh', async () => {
  const { calls, clock, request } = harness();
  await request('/muf');
  clock.t += 60_000;
  await request('/muf');
  await request('/muf');
  assert.equal(calls.length, 1);
});

test('after expiry it revalidates with a conditional request', async () => {
  const { calls, clock, state, request } = harness();
  await request('/fof2');
  assert.equal(calls[0].url.endsWith('fof2-normal-now.svg'), true);
  state.mode = 'notModified';
  clock.t += 16 * 60_000;
  const res = await request('/fof2');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['If-None-Match'], '"abc"');
  // Unchanged: hold off a few minutes instead of asking again immediately.
  clock.t += 60_000;
  await request('/fof2');
  assert.equal(calls.length, 2);
});

test('concurrent requests share one upstream fetch', async () => {
  const { calls, request } = harness();
  const results = await Promise.all([
    request('/muf'),
    request('/muf'),
    request('/muf'),
  ]);
  assert.equal(calls.length, 1);
  assert.ok(results.every((res) => res.status === 200));
});

test('fields are cached independently', async () => {
  const { calls, request } = harness();
  await request('/muf');
  await request('/fof2');
  assert.equal(calls.length, 2);
});

test('upstream failure serves the held map as stale, with backoff', async () => {
  const { calls, clock, state, request } = harness();
  await request('/muf');
  state.mode = 'fail';
  clock.t += 16 * 60_000;
  const res = await request('/muf');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, true);
  assert.equal(calls.length, 2);
  clock.t += 5_000;
  await request('/muf');
  assert.equal(calls.length, 2, 'backoff suppresses an immediate retry');
  clock.t += 60_000;
  await request('/muf');
  assert.equal(calls.length, 3);
});

test('a map far too old is refused instead of shown as current', async () => {
  const { clock, state, request } = harness();
  await request('/muf');
  state.mode = 'fail';
  clock.t += 7 * 60 * 60_000;
  const res = await request('/muf');
  assert.equal(res.status, 502);
});

test('with no held map an upstream failure is a 502', async () => {
  const { state, request } = harness();
  state.mode = 'fail';
  const res = await request('/muf');
  assert.equal(res.status, 502);
  assert.equal(JSON.parse(res.body).error, 'unavailable');
});

test('an unrecognised render is a 502, not a broken overlay', async () => {
  const { request } = harness({ svg: '<svg></svg>' });
  assert.equal((await request('/muf')).status, 502);
});

test('honours If-None-Match from the browser', async () => {
  const { request } = harness();
  const first = await request('/muf');
  const second = await request('/muf', {
    headers: { 'if-none-match': first.headers.ETag },
  });
  assert.equal(second.status, 304);
  assert.equal(second.body, '');
});

test('rejects unknown fields and non-GET methods', async () => {
  const { calls, request } = harness();
  assert.equal((await request('/nope')).status, 404);
  assert.equal((await request('/__proto__')).status, 404);
  assert.equal((await request('/muf', { method: 'POST' })).status, 405);
  assert.equal(calls.length, 0);
});
