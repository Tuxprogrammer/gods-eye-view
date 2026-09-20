import {
  PROPAGATION_CONTOURS_MAX_FEATURES,
  PROPAGATION_CONTOURS_MAX_VERTICES,
  PROPAGATION_STATIONS_MAX,
  PROPAGATION_STATION_MAX_AGE_MS,
} from './constants.js';

/**
 * Normalisers for the two overlays that accompany a map: the site's contour
 * GeoJSON (isolines of the same field) and its ionosonde station list. Each
 * throws on anything unexpected, so a format change makes that overlay
 * unavailable instead of drawing something wrong.
 */

function fail(what, message) {
  throw new Error(`Unrecognised propagation ${what}: ${message}`);
}

const round3 = (value) => Math.round(value * 1000) / 1000;

/** Longitude as -180..180; the upstream station list uses 0..360. */
export function normalizeLongitude(lon) {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Math.round(wrapped * 1e6) / 1e6;
}

/**
 * @param {string} text GeoJSON FeatureCollection of LineString isolines.
 * @returns {Array<{value: number, label: string, color: string, positions: number[]}>}
 *   `positions` is a flat [lon, lat, lon, lat, ...] path.
 */
export function extractContours(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    fail('contours', 'not JSON');
  }
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features))
    fail('contours', 'not a FeatureCollection');
  if (json.features.length > PROPAGATION_CONTOURS_MAX_FEATURES)
    fail('contours', 'too many features');
  const lines = [];
  let vertices = 0;
  for (const feature of json.features) {
    if (feature?.geometry?.type !== 'LineString')
      fail('contours', 'not a line');
    const props = feature.properties ?? {};
    const value = Number(props['level-value']);
    if (!Number.isFinite(value) || value <= 0)
      fail('contours', 'a line has no level');
    const color = /^#[0-9a-fA-F]{6}$/.test(props.stroke) ? props.stroke : null;
    const path = feature.geometry.coordinates;
    if (!Array.isArray(path)) fail('contours', 'a line has no coordinates');
    vertices += path.length;
    if (vertices > PROPAGATION_CONTOURS_MAX_VERTICES)
      fail('contours', 'too many vertices');
    // A jump across the antimeridian would draw a line the long way round the
    // globe, so break the path there. The upstream already splits at +-180.
    let run = [];
    const flush = () => {
      if (run.length >= 4) lines.push({ value, color, positions: run });
      run = [];
    };
    let previousLon = null;
    for (const point of path) {
      const [lon, lat] = point ?? [];
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90)
        fail('contours', 'a vertex is out of range');
      if (previousLon !== null && Math.abs(lon - previousLon) > 180) flush();
      run.push(round3(lon), round3(lat));
      previousLon = lon;
    }
    flush();
  }
  return lines.map((line) => ({
    ...line,
    label: String(Math.round(line.value * 10) / 10),
  }));
}

/**
 * @param {string} text The upstream `stations.json` array.
 * @returns {Array<object>} Reporting stations, newest reading first.
 */
export function extractStations(text, now) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    fail('stations', 'not JSON');
  }
  if (!Array.isArray(rows)) fail('stations', 'not an array');
  const number = (value) =>
    value === null || value === undefined || value === ''
      ? null
      : Number.isFinite(Number(value))
        ? Number(value)
        : null;
  const stations = [];
  for (const row of rows) {
    const station = row?.station;
    const lat = number(station?.latitude);
    const lon = number(station?.longitude);
    // A malformed row is skipped; a whole file of them is the format changing.
    if (typeof station?.code !== 'string' || lat === null || lon === null)
      continue;
    if (Math.abs(lat) > 90 || lon < -180 || lon > 360) continue;
    const time = Date.parse(`${String(row.time).replace(/Z$/, '')}Z`);
    if (!Number.isFinite(time) || now - time > PROPAGATION_STATION_MAX_AGE_MS)
      continue;
    const fof2 = number(row.fof2);
    const mufd = number(row.mufd);
    if ((fof2 === null || fof2 <= 0) && (mufd === null || mufd <= 0)) continue;
    stations.push({
      code: station.code,
      name: String(station.name ?? station.code).slice(0, 80),
      lat: round3(lat),
      lon: round3(normalizeLongitude(lon)),
      time,
      fof2: fof2 !== null && fof2 > 0 ? fof2 : null,
      mufd: mufd !== null && mufd > 0 ? mufd : null,
      hmf2: number(row.hmf2),
      confidence: number(row.cs),
      source: String(row.source ?? '').slice(0, 24),
    });
    if (stations.length > PROPAGATION_STATIONS_MAX)
      fail('stations', 'too many stations');
  }
  if (rows.length > 0 && stations.length === 0 && !rows.some((r) => r?.station))
    fail('stations', 'no station rows');
  return stations.sort((a, b) => b.time - a.time);
}
