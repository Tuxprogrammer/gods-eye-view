import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CARTO_ORIGIN = 'https://basemaps.cartocdn.com';
export const OFM_ORIGIN = 'https://tiles.openfreemap.org';
const USER_AGENT = 'GodsEyeView/1.0 (+https://github.com/; map tile cache)';

/** CARTO raster styles served through this proxy (Positron / Dark Matter). */
export const CARTO_STYLES = Object.freeze(['light_all', 'dark_all']);

/** Style JSON and TileJSON can change upstream; tiles never do. */
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ZOOM = 22;

const IMMUTABLE = 'public, max-age=31536000, immutable';

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [name, value] of Object.entries(headers))
    res.setHeader(name, value);
  res.end(body);
}

const fail = (res, status, message) =>
  send(res, status, JSON.stringify({ error: message }), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

/** Integer tile coordinate within the zoom's range, or null. */
function tileCoords(z, x, y) {
  const zoom = Number(z);
  if (!/^\d+$/.test(z) || zoom > MAX_ZOOM) return null;
  const span = 2 ** zoom;
  if (!/^\d+$/.test(x) || !/^\d+$/.test(y)) return null;
  if (Number(x) >= span || Number(y) >= span) return null;
  return { z: zoom, x: Number(x), y: Number(y) };
}

const safeSegment = (value) => value.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Same-origin, disk-cached front for third-party basemaps.
 *   GET /carto/{light_all|dark_all}/{z}/{x}/{y}.png      CARTO raster tiles
 *   GET /ofm/style.json                                   OpenFreeMap dark style, rewritten to this proxy
 *   GET /ofm/planet/{z}/{x}/{y}.pbf                       OpenFreeMap vector tiles
 *   GET /ofm/ne2sr/{z}/{x}/{y}.png                        OpenFreeMap shaded-relief raster
 *   GET /ofm/sprite/ofm[@2x].{json|png}, /ofm/fonts/...   OpenFreeMap style assets
 *
 * The CARTO key stays on the server; the browser never sees it.
 *
 * @param {{cache: ReturnType<import('./cache.js').createTileCache>, root: string, cartoKey?: () => string, fetchImpl?: typeof fetch, now?: () => number}} deps
 */
export function createTilesMiddleware({
  cache,
  root,
  cartoKey = () => '',
  fetchImpl = fetch,
  now = Date.now,
}) {
  const meta = new Map(); // name -> { at, value }

  /** Fetch-and-remember upstream JSON; a stale copy beats no copy. */
  async function metadata(name, url) {
    const hit = meta.get(name);
    if (hit && now() - hit.at < METADATA_TTL_MS) return hit.value;
    const file = path.join(root, 'ofm', '_meta', `${name}.json`);
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(value)).catch(() => {});
      meta.set(name, { at: now(), value });
      return value;
    } catch (error) {
      if (hit) return hit.value;
      try {
        const value = JSON.parse(await readFile(file, 'utf8'));
        meta.set(name, { at: now() - METADATA_TTL_MS + 60_000, value });
        return value;
      } catch {
        throw error;
      }
    }
  }

  const ofmStyle = () => metadata('style', `${OFM_ORIGIN}/styles/dark`);
  const ofmPlanet = () => metadata('planet', `${OFM_ORIGIN}/planet`);

  async function serve(
    res,
    { provider, key, upstream, contentType, headers, emptyOn404 = false },
  ) {
    const result = await cache.get({
      provider,
      key,
      upstream,
      headers: { 'User-Agent': USER_AGENT, ...headers },
      contentType,
    });
    if (result.status === 200)
      return send(res, 200, result.body, {
        'Content-Type': result.contentType || contentType,
        'Content-Length': result.body.length,
        'Cache-Control': IMMUTABLE,
      });
    // Vector tiles the set does not have are empty, not an error: an empty
    // body decodes to a tile with no features, and the renderer moves on.
    if (result.status === 404 && emptyOn404)
      return send(res, 200, Buffer.alloc(0), {
        'Content-Type': contentType,
        'Content-Length': 0,
        'Cache-Control': IMMUTABLE,
      });
    if (result.status === 404) return fail(res, 404, 'No such tile');
    return fail(res, 502, 'Tile upstream unavailable');
  }

  async function rewrittenStyle() {
    const upstream = await ofmStyle();
    const style = structuredClone(upstream);
    const base = '/api/tiles/ofm';
    for (const source of Object.values(style.sources || {})) {
      if (source.type === 'vector')
        Object.assign(source, {
          url: undefined,
          tiles: [`${base}/planet/{z}/{x}/{y}.pbf`],
          maxzoom: 14,
        });
      else if (source.type === 'raster')
        source.tiles = [`${base}/ne2sr/{z}/{x}/{y}.png`];
    }
    if (style.sprite) style.sprite = `${base}/sprite/ofm`;
    if (style.glyphs) style.glyphs = `${base}/fonts/{fontstack}/{range}.pbf`;
    return style;
  }

  async function ofm(res, rest) {
    if (rest.length === 1 && rest[0] === 'style.json') {
      const style = await rewrittenStyle();
      return send(res, 200, JSON.stringify(style), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
    }
    if (rest[0] === 'planet' && rest.length === 4) {
      const m = /^(\d+)\.pbf$/.exec(rest[3]);
      const c = m && tileCoords(rest[1], rest[2], m[1]);
      if (!c) return fail(res, 400, 'Bad tile coordinates');
      // The upstream path carries a dataset version that rolls over; the cache
      // key does not, so a new planet build never re-downloads what we hold.
      const template = (await ofmPlanet()).tiles?.[0];
      if (!template) return fail(res, 502, 'OpenFreeMap TileJSON has no tiles');
      return serve(res, {
        provider: 'ofm',
        key: `planet/${c.z}/${c.x}/${c.y}.pbf`,
        upstream: template
          .replace('{z}', c.z)
          .replace('{x}', c.x)
          .replace('{y}', c.y),
        contentType: 'application/x-protobuf',
        emptyOn404: true,
      });
    }
    if (rest[0] === 'ne2sr' && rest.length === 4) {
      const m = /^(\d+)\.png$/.exec(rest[3]);
      const c = m && tileCoords(rest[1], rest[2], m[1]);
      if (!c) return fail(res, 400, 'Bad tile coordinates');
      return serve(res, {
        provider: 'ofm',
        key: `ne2sr/${c.z}/${c.x}/${c.y}.png`,
        upstream: `${OFM_ORIGIN}/natural_earth/ne2sr/${c.z}/${c.x}/${c.y}.png`,
        contentType: 'image/png',
      });
    }
    if (rest[0] === 'sprite' && rest.length === 2) {
      const m = /^ofm(@2x)?\.(json|png)$/.exec(rest[1]);
      const base = (await ofmStyle()).sprite;
      if (!m || !base) return fail(res, 404, 'Unknown sprite');
      return serve(res, {
        provider: 'ofm',
        key: `sprite/${rest[1]}`,
        upstream: `${base}${m[1] || ''}.${m[2]}`,
        contentType: m[2] === 'json' ? 'application/json' : 'image/png',
      });
    }
    if (rest[0] === 'fonts' && rest.length === 3) {
      let stack;
      try {
        stack = decodeURIComponent(rest[1]);
      } catch {
        return fail(res, 400, 'Bad font stack');
      }
      const range = /^(\d+-\d+)\.pbf$/.exec(rest[2]);
      if (!range || !/^[\w %,-]{1,120}$/.test(stack))
        return fail(res, 400, 'Bad font request');
      return serve(res, {
        provider: 'ofm',
        key: `fonts/${safeSegment(stack)}/${rest[2]}`,
        upstream: `${OFM_ORIGIN}/fonts/${encodeURIComponent(stack)}/${rest[2]}`,
        contentType: 'application/x-protobuf',
      });
    }
    return fail(res, 404, 'Unknown OpenFreeMap route');
  }

  async function carto(res, rest) {
    if (rest.length !== 4 || !CARTO_STYLES.includes(rest[0]))
      return fail(res, 404, 'Unknown CARTO style');
    const m = /^(\d+)\.png$/.exec(rest[3]);
    const c = m && tileCoords(rest[1], rest[2], m[1]);
    if (!c) return fail(res, 400, 'Bad tile coordinates');
    const key = String(cartoKey() || '').trim();
    const tile = `${rest[0]}/${c.z}/${c.x}/${c.y}.png`;
    return serve(res, {
      provider: 'carto',
      key: tile,
      // The key is not part of the cache key: a tile is the same tile.
      upstream: `${CARTO_ORIGIN}/${tile}${key ? `?key=${encodeURIComponent(key)}` : ''}`,
      contentType: 'image/png',
    });
  }

  return async (req, res) => {
    try {
      if (req.method && req.method !== 'GET' && req.method !== 'HEAD')
        return fail(res, 405, 'GET only');
      const url = new URL(req.url || '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const [provider, ...rest] = parts;
      if (provider === 'carto') return await carto(res, rest);
      if (provider === 'ofm') return await ofm(res, rest);
      return fail(res, 404, 'Unknown tile provider');
    } catch (error) {
      return fail(res, 502, error?.message || 'Tile proxy error');
    }
  };
}
