import {
  coalesceProxyRequest,
  readResponseTextCapped,
} from '../common/http.js';
import { extractPropagationMap } from './extract.js';
import { extractContours, extractStations } from './overlays.js';
import {
  PROPAGATION_CONTOURS_MAX_BYTES,
  PROPAGATION_FAILURE_BACKOFF_MS,
  PROPAGATION_FETCH_TIMEOUT_MS,
  PROPAGATION_FIELDS,
  PROPAGATION_MAX_FRESH_MS,
  PROPAGATION_MAX_STALE_MS,
  PROPAGATION_MIN_RECHECK_MS,
  PROPAGATION_STATIONS_FRESH_MS,
  PROPAGATION_STATIONS_MAX_BYTES,
  PROPAGATION_STATIONS_URL,
  PROPAGATION_SVG_MAX_BYTES,
  PROPAGATION_UNCHANGED_RECHECK_MS,
  PROPAGATION_USER_AGENT,
  propagationContoursUrl,
  propagationUpstreamUrl,
} from './constants.js';

function parseHttpDate(value) {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When a held copy may next be revalidated. The upstream publishes on a fixed
 * cadence and (for the renders) sends `Expires` accordingly; honour it within
 * bounds so a clock or header oddity can neither hammer the site nor pin an
 * old copy.
 */
function freshUntil({ now, expires, lastModified, unchanged, cadenceMs }) {
  if (unchanged) return now + PROPAGATION_UNCHANGED_RECHECK_MS;
  const expected =
    expires ??
    (lastModified === null ? now + cadenceMs : lastModified + cadenceMs);
  return Math.min(
    Math.max(expected, now + PROPAGATION_MIN_RECHECK_MS),
    now + cadenceMs,
  );
}

/**
 * One upstream document, cached on demand. Nothing here runs on a timer: the
 * upstream is contacted only from `get()`, at most once per cadence window
 * (conditional GET, so an unchanged copy costs a 304), with concurrent callers
 * coalesced, a back-off after a failure, and the last good copy served stale.
 */
function createResource({
  id,
  url,
  accept,
  maxBytes,
  cadenceMs,
  build,
  fetchImpl,
  now,
}) {
  let held = null;
  let failure = null;
  const inFlight = new Map();

  async function fetchUpstream() {
    const headers = { Accept: accept, 'User-Agent': PROPAGATION_USER_AGENT };
    if (held?.etag) headers['If-None-Match'] = held.etag;
    else if (held?.lastModified)
      headers['If-Modified-Since'] = held.lastModified;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      PROPAGATION_FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: controller.signal,
        redirect: 'manual',
      });
      const at = now();
      if (response.status === 304 && held) {
        void response.body?.cancel?.().catch?.(() => {});
        held.freshUntil = freshUntil({
          now: at,
          unchanged: true,
          cadenceMs,
        });
        return held;
      }
      if (!response.ok)
        throw new Error(`Propagation upstream returned ${response.status}`);
      const text = await readResponseTextCapped(
        response,
        maxBytes,
        controller.signal,
      );
      const built = build({ text, response, now: at });
      const lastModified = parseHttpDate(response.headers.get('last-modified'));
      const payload = {
        ...built.payload,
        fetchedAt: new Date(at).toISOString(),
      };
      held = {
        generatedAt: built.generatedAt ?? lastModified ?? at,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        freshUntil: freshUntil({
          now: at,
          expires: parseHttpDate(response.headers.get('expires')),
          lastModified,
          unchanged: false,
          cadenceMs,
        }),
        bodies: {
          fresh: JSON.stringify({ ...payload, stale: false }),
          stale: JSON.stringify({ ...payload, stale: true }),
        },
      };
      return held;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id,
    /** @returns {Promise<{entry: object, stale: boolean}>} */
    async get() {
      const at = now();
      if (held && at < held.freshUntil) return { entry: held, stale: false };
      if (failure && at < failure.until) {
        if (held && at - held.generatedAt < PROPAGATION_MAX_STALE_MS)
          return { entry: held, stale: true };
        throw failure.error;
      }
      const { promise } = coalesceProxyRequest(inFlight, id, fetchUpstream);
      try {
        const fetched = await promise;
        failure = null;
        return { entry: fetched, stale: false };
      } catch (error) {
        failure = { until: now() + PROPAGATION_FAILURE_BACKOFF_MS, error };
        if (held && now() - held.generatedAt < PROPAGATION_MAX_STALE_MS)
          return { entry: held, stale: true };
        throw error;
      }
    },
  };
}

/**
 * Connect middleware for `/api/propagation`:
 *   GET /{muf|fof2}            heatmap raster + colour scale
 *   GET /{muf|fof2}/contours   isolines of the same field
 *   GET /stations              reporting ionosondes
 *
 * Demand-driven by construction: no timer and no startup fetch. Each route is
 * its own cached resource, so an overlay failing never affects the heatmap.
 */
export function createPropagationMiddleware({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
} = {}) {
  const shared = { fetchImpl, now };
  const resources = new Map();
  for (const field of Object.values(PROPAGATION_FIELDS)) {
    resources.set(
      field.id,
      createResource({
        ...shared,
        id: field.id,
        url: propagationUpstreamUrl(field),
        accept: 'image/svg+xml',
        maxBytes: PROPAGATION_SVG_MAX_BYTES,
        cadenceMs: PROPAGATION_MAX_FRESH_MS,
        build: ({ text, response, now: at }) => {
          const map = extractPropagationMap(text);
          const generatedAt =
            parseHttpDate(response.headers.get('last-modified')) ?? at;
          return {
            generatedAt,
            payload: {
              field: field.id,
              label: field.label,
              unit: field.unit,
              generatedAt: new Date(generatedAt).toISOString(),
              bounds: map.bounds,
              southUp: map.southUp,
              scale: map.scale,
              range: map.range,
              ticks: map.ticks,
              heatmap: map.heatmap.toString('base64'),
              colorbar: map.colorbar.toString('base64'),
            },
          };
        },
      }),
    );
    resources.set(
      `${field.id}/contours`,
      createResource({
        ...shared,
        id: `${field.id}/contours`,
        url: propagationContoursUrl(field),
        accept: 'application/geo+json, application/json',
        maxBytes: PROPAGATION_CONTOURS_MAX_BYTES,
        cadenceMs: PROPAGATION_MAX_FRESH_MS,
        build: ({ text, response, now: at }) => {
          const lines = extractContours(text);
          const generatedAt =
            parseHttpDate(response.headers.get('last-modified')) ?? at;
          return {
            generatedAt,
            payload: {
              field: field.id,
              unit: field.unit,
              generatedAt: new Date(generatedAt).toISOString(),
              lines,
            },
          };
        },
      }),
    );
  }
  resources.set(
    'stations',
    createResource({
      ...shared,
      id: 'stations',
      url: PROPAGATION_STATIONS_URL,
      accept: 'application/json',
      maxBytes: PROPAGATION_STATIONS_MAX_BYTES,
      cadenceMs: PROPAGATION_STATIONS_FRESH_MS,
      build: ({ text, now: at }) => {
        const stations = extractStations(text, at);
        const newest = stations.length ? stations[0].time : at;
        return {
          generatedAt: newest,
          payload: {
            generatedAt: new Date(newest).toISOString(),
            stations,
          },
        };
      },
    }),
  );

  function send(res, status, body, extra = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...extra,
    });
    res.end(body);
  }

  return async function propagationMiddleware(req, res) {
    const key = String(req.url || '')
      .split('?')[0]
      .replace(/^\/+|\/+$/g, '');
    const resource = resources.has(key) ? resources.get(key) : null;
    if (!resource)
      return send(res, 404, JSON.stringify({ error: 'unknown_field' }));
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(res, 405, JSON.stringify({ error: 'method_not_allowed' }), {
        Allow: 'GET, HEAD',
      });
    try {
      const { entry, stale } = await resource.get();
      const etag = `W/"${resource.id}-${entry.generatedAt}-${stale ? 's' : 'f'}"`;
      if (req.headers?.['if-none-match'] === etag)
        return send(res, 304, '', { ETag: etag });
      const body = stale ? entry.bodies.stale : entry.bodies.fresh;
      if (req.method === 'HEAD') return send(res, 200, '', { ETag: etag });
      return send(res, 200, body, { ETag: etag });
    } catch (error) {
      console.warn(
        `[Propagation] ${resource.id} unavailable: ${error?.message || error}`,
      );
      return send(
        res,
        502,
        JSON.stringify({
          error: 'unavailable',
          message: 'Propagation data is unavailable',
        }),
      );
    }
  };
}
