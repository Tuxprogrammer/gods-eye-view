import { WHOLE_EARTH_KM } from '../aprs/geo.js';
import { MAX_NODES } from './store.js';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

const number = (value, min, max, fallback) => {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

function radiusOf(params) {
  const raw = params.get('radiusKm');
  if (raw === null || raw === 'earth') return null;
  const km = number(raw, 1, WHOLE_EARTH_KM, WHOLE_EARTH_KM);
  return km >= WHOLE_EARTH_KM ? null : km;
}

const MAX_BODY_BYTES = 16 * 1024;

/**
 * A JSON request body, refusing anything that a web page on another origin
 * could have sent: changing the server list needs `application/json` (which a
 * cross-origin form cannot send without a preflight) and a same-origin
 * `Origin`, when the browser supplies one.
 */
async function readJsonBody(req) {
  const type = String(req.headers?.['content-type'] ?? '');
  if (!/^application\/json\b/i.test(type))
    throw Object.assign(new Error('Send application/json'), { status: 415 });
  const origin = req.headers?.origin;
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* falls through to the refusal */
    }
    if (host !== req.headers?.host)
      throw Object.assign(new Error('Cross-origin request refused'), {
        status: 403,
      });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error('Body must be a JSON object'), {
      status: 400,
    });
  }
}

/**
 * Same-origin JSON over the Meshtastic store and server list.
 *   GET  /nodes     nodes (and optional tracks) around a centre
 *   GET  /messages  recent text messages anchored inside the radius
 *   GET  /node      one node in full
 *   GET  /status    servers, connection and storage health
 *   GET  /servers   the server list (never with passwords or keys)
 *   POST /servers, /servers/update, /servers/delete   manage the list
 *
 * @param {{store: () => object|null, servers: () => object|null, storageError: () => string|null}} deps
 */
export function createMeshtasticMiddleware({
  store,
  servers,
  storageError,
  now = Date.now,
}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const params = url.searchParams;
      const db = store();
      const manager = servers();
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        return json(res, 200, {
          servers: manager?.list() ?? [],
          storage: db ? db.stats() : null,
          storageError: storageError(),
        });
      }
      if (!db || !manager) {
        return json(res, 503, {
          error: storageError() || 'Meshtastic storage is starting',
          servers: [],
        });
      }

      if (route.startsWith('/servers') && req.method === 'POST') {
        const body = await readJsonBody(req);
        let result;
        if (route === '/servers') result = manager.add(body);
        else if (route === '/servers/update')
          result = manager.update(String(body.id ?? ''), body);
        else if (route === '/servers/delete')
          result = manager.remove(String(body.id ?? ''));
        else return json(res, 404, { error: 'Unknown Meshtastic route' });
        if (result.error)
          return json(res, result.status, { error: result.error });
        return json(res, 200, { ...result, servers: manager.list() });
      }
      if (req.method && req.method !== 'GET')
        return json(res, 405, { error: 'Method not allowed' });

      if (route === '/servers')
        return json(res, 200, { servers: manager.list() });

      const lat = number(params.get('lat'), -90, 90, 0);
      const lon = number(params.get('lon'), -180, 180, 0);
      const radiusKm = radiusOf(params);
      const windowMin = number(params.get('windowMin'), 1, 1440, 60);
      const serverIds = manager.enabledIds();

      if (route === '/nodes') {
        const trackMin = number(params.get('trackMin'), 0, 1440, 0);
        const result = db.nodes({
          lat,
          lon,
          radiusKm,
          sinceMs: windowMin * 60_000,
          limit: number(params.get('limit'), 1, MAX_NODES, 3000),
          serverIds,
          movingOnly: params.get('moving') === '1',
          filter: (params.get('q') || '').split(',').slice(0, 20),
        });
        const tracks = trackMin
          ? db.tracks(
              result.nodes
                .filter((n) => n.trailPoints >= 2)
                .slice(0, 400)
                .map((n) => n.id),
              trackMin * 60_000,
            )
          : {};
        return json(res, 200, {
          generatedAt: now(),
          center: { lat, lon },
          radiusKm,
          windowMin,
          ...result,
          tracks,
          servers: manager.list(),
        });
      }
      if (route === '/messages') {
        // With no cursor the caller only learns where "now" is; it is not
        // handed a backlog to replay as if it had just happened.
        const after = params.get('after');
        const result =
          after === null
            ? {
                messages: [],
                cursor: db.messages({
                  after: Number.MAX_SAFE_INTEGER,
                  sinceMs: 1,
                  serverIds,
                }).cursor,
              }
            : db.messages({
                after: number(after, 0, Number.MAX_SAFE_INTEGER, 0),
                lat,
                lon,
                radiusKm,
                sinceMs: number(params.get('windowMin'), 1, 1440, 10) * 60_000,
                serverIds,
              });
        return json(res, 200, {
          generatedAt: now(),
          ...result,
          servers: manager.list(),
        });
      }
      if (route === '/node') {
        const id = String(params.get('id') || '').slice(0, 12);
        const detail = id ? db.detail(id) : null;
        if (!detail)
          return json(res, 404, {
            error: 'Node not heard in the last 24 hours',
          });
        return json(res, 200, { generatedAt: now(), ...detail });
      }
      return json(res, 404, { error: 'Unknown Meshtastic route' });
    } catch (error) {
      return json(res, error?.status ?? 502, {
        error: error?.message || 'Meshtastic error',
      });
    }
  };
}
