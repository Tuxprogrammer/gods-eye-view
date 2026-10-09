/**
 * Same-site request gate for the cost-bearing and log endpoints.
 *
 * The credential panel has its own stricter gate (`admitKeySetupRequest` in
 * keySetupCore.mjs): loopback socket + local Host + exact Origin + JSON
 * Content-Type. The four endpoints here — `/api/realtime/token` (mints an
 * OpenAI Realtime token = spends money), `/api/openai/hud-summary` (OpenAI
 * spend), `/api/google/nearby-places` (Google spend), and
 * `/api/realtime/debug-log` (appends to a local JSONL) — were previously
 * ungated, so a hostile web page open in the same browser could reach them
 * cross-site: a `fetch` carries a foreign `Origin`, and an `<img>`/navigation
 * carries NO `Origin` at all but does carry `Sec-Fetch-Site: cross-site`.
 *
 * This module is the pure core that refuses those shapes while keeping the
 * documented `HOST=0.0.0.0` LAN opt-in and non-browser loopback tools (the two
 * repo QA harnesses POST the token endpoint from Node with no Origin) working.
 * It deliberately does NOT require a loopback remote address (that belongs only
 * to the credential panel), the presence of an `Origin`, or a JSON
 * Content-Type. It touches nothing but its arguments, so every refusal below is
 * pinned by a unit assertion.
 */
/**
 * Reverse-proxy / CDN forwarding headers. Their presence means the request did
 * not originate on this machine, whatever its socket says. This module owns
 * the list for every local gate (the credential panel and /mcp import
 * `hasProxySignals`), and has no imports so it can sit in any package boundary.
 */
export const PROXY_SIGNALS = Object.freeze([
  'forwarded',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-connecting-ip',
  'cf-ray',
]);

/**
 * Whether a request carries reverse-proxy or CDN forwarding headers. `headers`
 * is keyed by lower-case header name.
 */
export function hasProxySignals(headers = {}) {
  return PROXY_SIGNALS.some(
    (name) => String(headers[name] || '').trim() !== '',
  );
}

/**
 * Compute a request's own authority (an origin string) from its protocol and
 * Host header. Unlike the credential-panel gate's localhost-restricted
 * `localAuthority`, this returns whatever Host the request actually carries —
 * the LAN opt-in serves a non-loopback Host to LAN browsers, and a same-origin
 * fetch from such a page must still match. Malformed/missing input yields null.
 * @param {string} hostHeader e.g. `req.headers.host`
 * @param {string} protocol `http:` or `https:`
 * @returns {string|null}
 */
function requestAuthority(hostHeader, protocol) {
  const raw = String(hostHeader || '')
    .trim()
    .toLowerCase();
  const scheme = String(protocol || '').toLowerCase();
  if (!raw || !['http:', 'https:'].includes(scheme) || /[\s/?#@]/.test(raw))
    return null;
  try {
    return new URL(`${scheme}//${raw}`).origin;
  } catch {
    return null;
  }
}

/**
 * Parse the operator's public origins (GEV_PUBLIC_ORIGINS): the exact
 * `scheme://host[:port]` addresses a reverse proxy serves the app from, comma
 * separated. Anything that is not a bare origin (a path, a wildcard, `null`)
 * is ignored, so a typo can only narrow the list.
 * @param {string|undefined|null} value
 * @returns {string[]}
 */
export function parsePublicOrigins(value) {
  const origins = [];
  for (const entry of String(value ?? '').split(',')) {
    const raw = entry.trim();
    if (!raw || raw.includes('*')) continue;
    try {
      const url = new URL(raw);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        url.origin === raw.replace(/\/$/, '').toLowerCase()
      )
        origins.push(url.origin);
    } catch {
      /* not an origin */
    }
  }
  return [...new Set(origins)];
}

/**
 * Decide whether a request to a cost-bearing/log endpoint is same-site enough
 * to admit. Pure: no I/O, no globals.
 *
 * `publicOrigins` (from GEV_PUBLIC_ORIGINS, empty by default) is this fork's
 * opt-in for serving behind a TLS-terminating reverse proxy, where the app sees
 * plain http and the proxy's Host, so no browser Origin can equal its own
 * authority. A request whose Origin is listed passes; behind a proxy, one with
 * no Origin passes only when the browser itself says `Sec-Fetch-Site:
 * same-origin`. Every other rule below still applies.
 *
 * Policy, in order:
 *  1. any reverse-proxy / CDN signal header present (PROXY_SIGNALS) → 403;
 *  2. `Sec-Fetch-Site` present and not `same-origin` / `none` → 403 (this is
 *     what blocks `<img src=...>` and cross-site navigation, which carry no
 *     Origin but do carry `Sec-Fetch-Site: cross-site`);
 *  3. `Origin` present must exactly equal the request's own authority computed
 *     from protocol + Host — the same exact-origin comparison the credential
 *     gate uses (no userinfo, no path/search/hash). The literal string `null`
 *     is an opaque origin (sandboxed iframe / `data:` URL) and is refused;
 *  4. otherwise ok. Non-browser loopback tools and the LAN opt-in (which may
 *     carry neither `Origin` nor `Sec-Fetch-Site`) pass here.
 *
 * @param {{hostHeader?: string, protocol?: string, origin?: string, secFetchSite?: string, proxyHeaders?: Record<string,string>, publicOrigins?: string[]}} req
 * @returns {{ok: true} | {ok: false, status: 403, error: string}}
 */
export function admitSameSiteRequest({
  hostHeader,
  protocol = 'http:',
  origin,
  secFetchSite,
  proxyHeaders = {},
  publicOrigins = [],
} = {}) {
  const site = String(secFetchSite || '')
    .trim()
    .toLowerCase();
  const hasOrigin = origin !== undefined && origin !== null && origin !== '';
  const publicOrigin = hasOrigin && publicOrigins.includes(String(origin));
  // (1) A request carrying reverse-proxy / CDN forwarding headers did not
  // originate on this machine, whatever its socket says — unless the operator
  // named the proxy's public origin and the browser vouches for this request.
  if (
    hasProxySignals(proxyHeaders) &&
    !publicOrigin &&
    !(publicOrigins.length > 0 && !hasOrigin && site === 'same-origin')
  ) {
    return {
      ok: false,
      status: 403,
      error: 'Proxied requests are not accepted',
    };
  }
  // (2) The browser tells us when a request is cross-site. `none` is a typed
  // URL / bookmark; `same-origin` is the app itself. Anything else (cross-site,
  // same-site but cross-origin) is refused.
  if (site !== '' && site !== 'same-origin' && site !== 'none') {
    return {
      ok: false,
      status: 403,
      error: 'Cross-site requests are not accepted',
    };
  }
  // (3) If Origin is present it must exactly equal the request's own authority
  // (or be one of the operator's public origins).
  if (hasOrigin && !publicOrigin) {
    if (origin === 'null') {
      return {
        ok: false,
        status: 403,
        error: 'Opaque origins are not accepted',
      };
    }
    const authority = requestAuthority(hostHeader, protocol);
    let parsedOrigin;
    try {
      parsedOrigin = new URL(String(origin));
    } catch {
      return { ok: false, status: 403, error: 'Unrecognized Origin refused' };
    }
    const exactOrigin =
      parsedOrigin.username === '' &&
      parsedOrigin.password === '' &&
      parsedOrigin.pathname === '/' &&
      parsedOrigin.search === '' &&
      parsedOrigin.hash === '' &&
      parsedOrigin.origin === authority;
    if (!exactOrigin) {
      return {
        ok: false,
        status: 403,
        error: 'Cross-origin requests are not accepted',
      };
    }
  }
  return { ok: true };
}
