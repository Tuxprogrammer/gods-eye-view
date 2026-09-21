import { WHOLE_EARTH_KM } from './geo.js';
import { MAX_STATIONS } from './store.js';

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

/** `radiusKm=earth` (or anything at or past the planet's width) means no limit. */
function radiusOf(params) {
  const raw = params.get('radiusKm');
  if (raw === null || raw === 'earth') return null;
  const km = number(raw, 1, WHOLE_EARTH_KM, WHOLE_EARTH_KM);
  return km >= WHOLE_EARTH_KM ? null : km;
}

/**
 * Same-origin JSON over the APRS store.
 *   GET /stations  stations (and optional tracks) around a centre
 *   GET /messages  recent messages anchored inside the radius
 *   GET /station   one station in full
 *   GET /status    connection and storage health
 *
 * @param {{store: () => object|null, feed: () => object, storageError: () => string|null}} deps
 */
export function createAprsMiddleware({
  store,
  feed,
  storageError,
  now = Date.now,
}) {
  return (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const params = url.searchParams;
      const db = store();
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        return json(res, 200, {
          feed: feed(),
          storage: db ? db.stats() : null,
          storageError: storageError(),
        });
      }
      if (!db) {
        return json(res, 503, {
          error: storageError() || 'APRS storage is starting',
          feed: feed(),
        });
      }
      if (req.method && req.method !== 'GET')
        return json(res, 405, { error: 'GET only' });

      const lat = number(params.get('lat'), -90, 90, 0);
      const lon = number(params.get('lon'), -180, 180, 0);
      const radiusKm = radiusOf(params);
      const windowMin = number(params.get('windowMin'), 1, 1440, 60);

      if (route === '/stations') {
        const trackMin = number(params.get('trackMin'), 0, 1440, 0);
        const result = db.stations({
          lat,
          lon,
          radiusKm,
          sinceMs: windowMin * 60_000,
          limit: number(params.get('limit'), 1, MAX_STATIONS, 3000),
          objects: params.get('objects') !== '0',
          weatherOnly: params.get('wx') === '1',
          movingOnly: params.get('moving') === '1',
          calls: (params.get('call') || '').split(',').slice(0, 20),
        });
        const tracks = trackMin
          ? db.tracks(
              result.stations
                .filter((s) => s.trailPoints >= 2)
                .slice(0, 400)
                .map((s) => s.id),
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
          feed: feed(),
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
                }).cursor,
              }
            : db.messages({
                after: number(after, 0, Number.MAX_SAFE_INTEGER, 0),
                lat,
                lon,
                radiusKm,
                sinceMs: number(params.get('windowMin'), 1, 1440, 10) * 60_000,
              });
        return json(res, 200, { generatedAt: now(), ...result, feed: feed() });
      }
      if (route === '/station') {
        const id = String(params.get('id') || '').slice(0, 20);
        const detail = id ? db.detail(id) : null;
        if (!detail)
          return json(res, 404, {
            error: 'Station not heard in the last 24 hours',
          });
        return json(res, 200, { generatedAt: now(), ...detail, feed: feed() });
      }
      return json(res, 404, { error: 'Unknown APRS route' });
    } catch (error) {
      return json(res, 502, { error: error?.message || 'APRS error' });
    }
  };
}
