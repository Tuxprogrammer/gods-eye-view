import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTileCache } from './cache.js';
import { createTilesMiddleware } from './middleware.js';

const PNG = Buffer.from([137, 80, 78, 71, 1, 2, 3]);

function harness(handler, { cartoKey = 'k' } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return handler(String(url));
  };
  return { calls, fetchImpl, cartoKey };
}

async function run(setup, url) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-tiles-'));
  const cache = createTileCache({ root, fetchImpl: setup.fetchImpl });
  const middleware = createTilesMiddleware({
    cache,
    root,
    cartoKey: () => setup.cartoKey,
    fetchImpl: setup.fetchImpl,
  });
  const request = async (u) => {
    const res = {
      headers: {},
      statusCode: 0,
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(body) {
        this.body = body;
      },
    };
    await middleware({ method: 'GET', url: u }, res);
    return res;
  };
  return {
    request,
    root,
    done: () => rm(root, { recursive: true, force: true }),
  };
}

const ok = (body, type = 'image/png') =>
  new Response(body, { status: 200, headers: { 'content-type': type } });

test('a CARTO tile is fetched once, with the key, then served from disk', async () => {
  const setup = harness(() => ok(PNG));
  const { request, done } = await run(setup, '');
  const first = await request('/carto/dark_all/3/2/1.png');
  const second = await request('/carto/dark_all/3/2/1.png');
  assert.equal(first.statusCode, 200);
  assert.deepEqual(second.body, PNG);
  assert.equal(setup.calls.length, 1);
  assert.equal(
    setup.calls[0],
    'https://basemaps.cartocdn.com/dark_all/3/2/1.png?key=k',
  );
  assert.match(second.headers['Cache-Control'], /immutable/);
  await done();
});

test('concurrent requests for one missing tile share one upstream call', async () => {
  const setup = harness(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return ok(PNG);
  });
  const { request, done } = await run(setup, '');
  await Promise.all(
    Array.from({ length: 5 }, () => request('/carto/light_all/1/0/0.png')),
  );
  assert.equal(setup.calls.length, 1);
  await done();
});

test('rejects unknown styles and out-of-range or malformed coordinates', async () => {
  const setup = harness(() => ok(PNG));
  const { request, done } = await run(setup, '');
  assert.equal((await request('/carto/voyager/1/0/0.png')).statusCode, 404);
  assert.equal((await request('/carto/dark_all/1/2/0.png')).statusCode, 400);
  assert.equal((await request('/carto/dark_all/1/0/../0.png')).statusCode, 404);
  assert.equal((await request('/carto/dark_all/x/0/0.png')).statusCode, 400);
  assert.equal((await request('/nope/1/0/0.png')).statusCode, 404);
  assert.equal(setup.calls.length, 0);
  await done();
});

test('an upstream failure is not cached and is retried later', async () => {
  let fail = true;
  const setup = harness(() =>
    fail ? new Response('nope', { status: 500 }) : ok(PNG),
  );
  const { request, done } = await run(setup, '');
  assert.equal((await request('/carto/dark_all/2/1/1.png')).statusCode, 502);
  fail = false;
  assert.equal((await request('/carto/dark_all/2/1/1.png')).statusCode, 200);
  await done();
});

test('OpenFreeMap style is rewritten to the proxy and vector tiles cached by stable key', async () => {
  const style = {
    version: 8,
    sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      },
      ne2_shaded: { type: 'raster', tiles: ['https://x/{z}/{x}/{y}.png'] },
    },
    layers: [],
  };
  const setup = harness((url) => {
    if (url.endsWith('/styles/dark'))
      return ok(JSON.stringify(style), 'application/json');
    if (url.endsWith('/planet'))
      return ok(
        JSON.stringify({
          tiles: ['https://tiles.openfreemap.org/planet/V1/{z}/{x}/{y}.pbf'],
        }),
        'application/json',
      );
    if (url.includes('/planet/V1/5/3/4.pbf'))
      return ok(PNG, 'application/x-protobuf');
    if (url.includes('/planet/V1/5/9/9.pbf'))
      return new Response('', { status: 404 });
    if (url.includes('/fonts/')) return ok(PNG, 'application/x-protobuf');
    throw new Error(`unexpected ${url}`);
  });
  const { request, done } = await run(setup, '');
  const styleRes = await request('/ofm/style.json');
  const body = JSON.parse(styleRes.body);
  assert.deepEqual(body.sources.openmaptiles.tiles, [
    '/api/tiles/ofm/planet/{z}/{x}/{y}.pbf',
  ]);
  assert.equal(body.sprite, '/api/tiles/ofm/sprite/ofm');
  assert.equal(body.glyphs, '/api/tiles/ofm/fonts/{fontstack}/{range}.pbf');

  const t1 = await request('/ofm/planet/5/3/4.pbf');
  const t2 = await request('/ofm/planet/5/3/4.pbf');
  assert.equal(t1.statusCode, 200);
  assert.deepEqual(t2.body, PNG);
  assert.equal(setup.calls.filter((u) => u.includes('4.pbf')).length, 1);

  // A tile the set lacks is an empty vector tile, and is not asked for twice.
  const missing = await request('/ofm/planet/5/9/9.pbf');
  await request('/ofm/planet/5/9/9.pbf');
  assert.equal(missing.statusCode, 200);
  assert.equal(missing.body.length, 0);
  assert.equal(setup.calls.filter((u) => u.includes('9/9.pbf')).length, 1);

  const font = await request('/ofm/fonts/Noto%20Sans%20Regular/0-255.pbf');
  assert.equal(font.statusCode, 200);
  assert.equal(
    (await request('/ofm/fonts/..%2f..%2fx/0-255.pbf')).statusCode,
    400,
  );
  await done();
});

test('the OpenFreeMap style survives an upstream outage from disk', async () => {
  let up = true;
  const setup = harness(() => {
    if (!up) throw new Error('offline');
    return ok(
      JSON.stringify({ version: 8, sources: {}, layers: [] }),
      'application/json',
    );
  });
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-tiles-'));
  const make = (now) =>
    createTilesMiddleware({
      cache: createTileCache({ root, fetchImpl: setup.fetchImpl }),
      root,
      fetchImpl: setup.fetchImpl,
      now,
    });
  const call = async (mw) => {
    const res = {
      headers: {},
      setHeader() {},
      end(b) {
        this.body = b;
      },
    };
    await mw({ method: 'GET', url: '/ofm/style.json' }, res);
    return res;
  };
  assert.equal((await call(make(() => 0))).statusCode, 200);
  up = false;
  // A fresh process (empty memory) with the upstream down still gets the style.
  assert.equal((await call(make(() => 0))).statusCode, 200);
  await rm(root, { recursive: true, force: true });
});
