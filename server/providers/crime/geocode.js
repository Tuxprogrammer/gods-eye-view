// Block-level geocoding for Madison police report locations through the
// Madison County E911 address locator that the City of Huntsville GIS
// publishes (public, keyless). Results, misses included, are cached on disk:
// a block's position does not move, so each location is asked for once.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readResponseJsonCapped } from '../common/http.js';
import { providerUserAgent } from '../common/userAgent.js';

export const GEOCODE_URL =
  'https://maps.huntsvilleal.gov/server/rest/services/Locators/MadisonCountyE911/GeocodeServer/geocodeAddresses';
const BATCH_SIZE = 50;
const MIN_SCORE = 80;
const MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 20_000;
// Madison and its edges in Madison and Limestone counties. Anything the
// locator places outside this box is a same-named street elsewhere.
const BOUNDS = Object.freeze({
  west: -86.95,
  east: -86.55,
  south: 34.55,
  north: 34.9,
});

/**
 * The locator query for a report location, or null when the location is not
 * an address (mile markers, blanks, report errors).
 * "100 Block of BLOCK OF ROYAL DRIVE" → "100 ROYAL DRIVE";
 * "GARNER ST/MARTIN ST" → "GARNER ST & MARTIN ST".
 */
export function locationQuery(location) {
  let text = String(location || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.startsWith('#') || /MILE MARKER|\bMM ?\d/.test(text))
    return null;
  text = text
    .replace(
      /^(\d+) BLOCK OF (BLOCK OF )?/,
      (_, number) => `${Math.max(1, Number(number))} `,
    )
    .replace(/\s*@.*$/, '')
    .replace(/\s+SUITE\s+\S+/, '')
    .replace(/\s*\/\s*/g, ' & ')
    .replace(/(\s+(MAD|LIME|HSV|MDCO|MADISON))+$/, '')
    .trim();
  if (!/[A-Z]/.test(text) || text.length > 120) return null;
  return text;
}

const inBounds = ({ x, y }) =>
  Number.isFinite(x) &&
  Number.isFinite(y) &&
  x >= BOUNDS.west &&
  x <= BOUNDS.east &&
  y >= BOUNDS.south &&
  y <= BOUNDS.north;

/**
 * A geocoder with a disk-backed cache.
 * `locate(queries)` resolves to Map(query → {lon, lat} | null).
 */
export function createCrimeGeocoder({
  cachePath,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  timeoutMs = 30_000,
} = {}) {
  let entries = null;
  let dirty = false;

  async function load() {
    if (entries) return;
    entries = new Map();
    if (!cachePath) return;
    try {
      const saved = JSON.parse(await readFile(cachePath, 'utf8'));
      if (saved?.version === 1 && saved.entries)
        for (const [query, value] of Object.entries(saved.entries))
          entries.set(query, value);
    } catch {
      // No cache yet, or an unreadable one: start empty.
    }
  }

  async function save() {
    if (!cachePath || !dirty) return;
    dirty = false;
    while (entries.size > MAX_ENTRIES)
      entries.delete(entries.keys().next().value);
    await mkdir(path.dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }),
    );
    await rename(temporary, cachePath);
  }

  async function geocodeBatch(queries) {
    const records = queries.map((query, index) => ({
      attributes: { OBJECTID: index + 1, SingleLine: query },
    }));
    const response = await fetchImpl(GEOCODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': providerUserAgent('crime'),
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        addresses: JSON.stringify({ records }),
        outSR: '4326',
        f: 'json',
      }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`geocoder_http_${response.status}`);
    const payload = await readResponseJsonCapped(response, 4 * 1024 * 1024);
    if (payload?.error) throw new Error('geocoder_error');
    const found = new Map();
    for (const location of payload?.locations || []) {
      const index = Number(location?.attributes?.ResultID) - 1;
      const query = queries[index];
      if (query === undefined) continue;
      const score = Number(location.score ?? location.attributes?.Score);
      const point = location.location || {};
      if (score >= MIN_SCORE && inBounds(point))
        found.set(query, {
          lon: Math.round(point.x * 1e6) / 1e6,
          lat: Math.round(point.y * 1e6) / 1e6,
        });
    }
    return found;
  }

  async function locate(queries) {
    await load();
    const result = new Map();
    const pending = [];
    for (const query of new Set(queries)) {
      if (!query) continue;
      const cached = entries.get(query);
      if (cached && (!cached.miss || now() - cached.at < MISS_RETRY_MS))
        result.set(query, cached.miss ? null : cached);
      else pending.push(query);
    }
    try {
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        let found;
        try {
          found = await geocodeBatch(batch);
        } catch (error) {
          // The locator is down: map what the cache knows, cache no misses,
          // and ask again on the next refresh.
          console.warn('[crime] geocoder unavailable:', error?.message);
          break;
        }
        for (const query of batch) {
          const point = found.get(query) || null;
          entries.delete(query);
          entries.set(query, point || { miss: true, at: now() });
          dirty = true;
          result.set(query, point);
        }
      }
    } finally {
      await save().catch(() => {});
    }
    return result;
  }

  return { locate };
}
