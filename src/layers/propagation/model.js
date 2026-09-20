/** Pure model and pixel helpers for the HF propagation heatmap layer. */

export const PROPAGATION_LAYER_ID = 'propagation';

/** Selectable maps, in presentation order. Exactly one is shown at a time. */
export const PROPAGATION_FIELDS = Object.freeze([
  Object.freeze({
    id: 'muf',
    chip: 'MUF 3000',
    title: 'Maximum usable frequency for a 3000 km path',
  }),
  Object.freeze({
    id: 'fof2',
    chip: 'foF2',
    title: 'F2-layer critical frequency (vertical incidence)',
  }),
]);
export const DEFAULT_PROPAGATION_FIELD = 'muf';
export const DEFAULT_PROPAGATION_OPACITY = 0.6;
export const MIN_PROPAGATION_OPACITY = 0.1;

/** Upstream regenerates every 15 minutes; a visible layer re-asks this often. */
export const PROPAGATION_REFRESH_MS = 5 * 60_000;
/** Older than this and the layer says so rather than presenting it as current. */
export const PROPAGATION_STALE_AFTER_MS = 45 * 60_000;

/** The globe is split into ground-classified tiles of this many degrees. */
export const PROPAGATION_TILE_DEGREES = 60;
/** Poles are approached, not touched, to keep ground geometry non-degenerate. */
export const PROPAGATION_POLE_LIMIT = 89.999;

export function propagationField(id) {
  return PROPAGATION_FIELDS.find((field) => field.id === id) ?? null;
}

export function clampOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_PROPAGATION_OPACITY;
  return Math.min(1, Math.max(MIN_PROPAGATION_OPACITY, number));
}

/**
 * Accept only a payload the renderer can trust. The server already validates
 * the upstream render; this guards the boundary the browser actually depends on.
 */
export function normalizePropagationPayload(payload, expectedField) {
  const fail = () => {
    throw new Error('Malformed propagation map');
  };
  if (!payload || typeof payload !== 'object') fail();
  if (payload.field !== expectedField) fail();
  const { bounds, range, ticks } = payload;
  if (
    !bounds ||
    bounds.west !== -180 ||
    bounds.east !== 180 ||
    bounds.south !== -90 ||
    bounds.north !== 90
  )
    fail();
  if (
    !range ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    !(range.min > 0) ||
    !(range.max > range.min)
  )
    fail();
  if (payload.scale !== 'log') fail();
  if (typeof payload.southUp !== 'boolean') fail();
  if (typeof payload.heatmap !== 'string' || payload.heatmap.length < 16)
    fail();
  if (typeof payload.colorbar !== 'string' || payload.colorbar.length < 16)
    fail();
  const generatedAt = Date.parse(payload.generatedAt);
  if (!Number.isFinite(generatedAt)) fail();
  if (!Array.isArray(ticks)) fail();
  const cleanTicks = ticks
    .filter(
      (tick) =>
        tick &&
        Number.isFinite(tick.position) &&
        tick.position >= 0 &&
        tick.position <= 1 &&
        typeof tick.label === 'string',
    )
    .map(({ position, label }) => ({ position, label }));
  return {
    field: payload.field,
    label: String(payload.label || expectedField),
    unit: String(payload.unit || ''),
    generatedAt,
    stale: payload.stale === true,
    southUp: payload.southUp,
    range: { min: range.min, max: range.max },
    ticks: cleanTicks,
    heatmap: payload.heatmap,
    colorbar: payload.colorbar,
  };
}

/** The alpha value that most of the raster's opaque pixels carry. */
export function dominantAlpha(rgba) {
  const counts = new Map();
  // A stride keeps this cheap on a multi-megapixel raster and still decisive.
  for (let i = 3; i < rgba.length; i += 4 * 61) {
    const alpha = rgba[i];
    if (alpha > 0) counts.set(alpha, (counts.get(alpha) || 0) + 1);
  }
  let best = 255;
  let bestCount = 0;
  for (const [alpha, count] of counts)
    if (count > bestCount) {
      best = alpha;
      bestCount = count;
    }
  return best;
}

/**
 * Turn the upstream raster into display pixels: north-up rows, full alpha where
 * the source has data. The upstream bakes a constant translucency into the PNG
 * (its colours are the true ramp, only the alpha is baked), which would make the
 * user's opacity control unable to exceed roughly 38%.
 * @param {Uint8ClampedArray|Uint8Array} rgba Source pixels, row-major RGBA.
 * @param {number} width
 * @param {number} height
 * @param {{southUp: boolean}} options `southUp`: source row 0 is the south edge.
 */
export function flattenHeatmapPixels(rgba, width, height, { southUp }) {
  const out = new Uint8ClampedArray(rgba.length);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const from = (southUp ? height - 1 - row : row) * rowBytes;
    const to = row * rowBytes;
    for (let x = 0; x < rowBytes; x += 4) {
      out[to + x] = rgba[from + x];
      out[to + x + 1] = rgba[from + x + 1];
      out[to + x + 2] = rgba[from + x + 2];
      out[to + x + 3] = rgba[from + x + 3] > 0 ? 255 : 0;
    }
  }
  return out;
}

/**
 * True colours of the colour bar. The upstream bar is the ramp pre-blended over
 * white at the heatmap's baked alpha, so undo that blend to match what is drawn.
 * @returns {Array<[number, number, number]>} `stops` evenly spaced colours.
 */
export function colorbarStops(rgba, width, height, alpha, stops = 24) {
  const row = Math.floor(height / 2);
  const a = alpha >= 254 ? 1 : alpha / 255;
  const out = [];
  for (let i = 0; i < stops; i++) {
    const along = stops > 1 ? i / (stops - 1) : 0;
    const x = Math.min(width - 1, Math.round(along * (width - 1)));
    const at = (row * width + x) * 4;
    const channel = (offset) =>
      Math.round(
        Math.min(255, Math.max(0, (rgba[at + offset] - 255 * (1 - a)) / a)),
      );
    out.push([channel(0), channel(1), channel(2)]);
  }
  return out;
}

export function gradientCss(stops) {
  const last = Math.max(1, stops.length - 1);
  const parts = stops.map(
    ([r, g, b], i) => `rgb(${r}, ${g}, ${b}) ${((i / last) * 100).toFixed(1)}%`,
  );
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/**
 * Tile the globe for ground classification. Coordinates are degrees; source
 * pixel rectangles refer to the NORTH-UP flattened raster.
 */
export function heatmapTiles(
  width,
  height,
  degrees = PROPAGATION_TILE_DEGREES,
) {
  const tiles = [];
  for (let west = -180; west < 180; west += degrees) {
    for (let south = -90; south < 90; south += degrees) {
      const east = west + degrees;
      const north = south + degrees;
      const left = Math.round(((west + 180) / 360) * width);
      const right = Math.round(((east + 180) / 360) * width);
      const top = Math.round(((90 - north) / 180) * height);
      const bottom = Math.round(((90 - south) / 180) * height);
      tiles.push({
        west,
        south: Math.max(south, -PROPAGATION_POLE_LIMIT),
        east,
        north: Math.min(north, PROPAGATION_POLE_LIMIT),
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      });
    }
  }
  return tiles;
}

/** Human age of a map, for the row's status line. */
export function formatMapAge(generatedAt, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - generatedAt) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} min old`;
  return `${Math.round(minutes / 60)} h old`;
}

/**
 * Drop tick labels that would overprint a neighbour on a narrow legend bar.
 * Ticks are positions in 0..1 along the bar; the first of a crowded run wins.
 */
export function thinTicks(ticks, minGap = 0.14) {
  const kept = [];
  for (const tick of [...ticks].sort((a, b) => a.position - b.position)) {
    const previous = kept[kept.length - 1];
    if (!previous || tick.position - previous.position >= minGap)
      kept.push(tick);
  }
  return kept;
}

/** Concise value label for a legend end, e.g. 4 -> "4", 35 -> "35", 1.5 -> "1.5". */
export function formatRangeValue(value) {
  return Number.isInteger(value) || Math.abs(value - Math.round(value)) < 0.05
    ? String(Math.round(value))
    : value.toFixed(1);
}

/** Overlays that accompany the active map. */
export const DEFAULT_SHOW_CONTOURS = true;
export const DEFAULT_SHOW_STATIONS = true;
/** A station older than this is not shown as reporting (the server also filters). */
export const STATION_MAX_AGE_MS = 3 * 60 * 60_000;
/** Contour labels repeat along a ring this often (degrees of arc), up to a cap. */
export const CONTOUR_LABEL_SPACING_DEG = 24;
export const CONTOUR_LABEL_MIN_LENGTH_DEG = 10;
export const CONTOUR_LABEL_MAX = 420;

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

/** Contour payload the renderer can trust; throws on anything malformed. */
export function normalizeContoursPayload(payload, expectedField) {
  const fail = () => {
    throw new Error('Malformed propagation contours');
  };
  if (!payload || typeof payload !== 'object') fail();
  if (payload.field !== expectedField) fail();
  const generatedAt = Date.parse(payload.generatedAt);
  if (!Number.isFinite(generatedAt) || !Array.isArray(payload.lines)) fail();
  const lines = [];
  for (const line of payload.lines) {
    const { value, positions } = line ?? {};
    if (!isFiniteNumber(value) || !Array.isArray(positions)) fail();
    if (positions.length < 4 || positions.length % 2 !== 0) fail();
    if (!positions.every(isFiniteNumber)) fail();
    lines.push({
      value,
      label: typeof line.label === 'string' ? line.label : String(value),
      color: typeof line.color === 'string' ? line.color : null,
      positions,
    });
  }
  return {
    field: payload.field,
    generatedAt,
    stale: payload.stale === true,
    lines,
  };
}

/** Station payload the renderer can trust; malformed rows are dropped. */
export function normalizeStationsPayload(payload) {
  const fail = () => {
    throw new Error('Malformed propagation stations');
  };
  if (!payload || typeof payload !== 'object') fail();
  const generatedAt = Date.parse(payload.generatedAt);
  if (!Number.isFinite(generatedAt) || !Array.isArray(payload.stations)) fail();
  const stations = [];
  for (const row of payload.stations) {
    if (
      !row ||
      typeof row.code !== 'string' ||
      !isFiniteNumber(row.lat) ||
      !isFiniteNumber(row.lon) ||
      Math.abs(row.lat) > 90 ||
      Math.abs(row.lon) > 180 ||
      !isFiniteNumber(row.time)
    )
      continue;
    stations.push({
      code: row.code,
      name: typeof row.name === 'string' ? row.name : row.code,
      lat: row.lat,
      lon: row.lon,
      time: row.time,
      fof2: isFiniteNumber(row.fof2) ? row.fof2 : null,
      mufd: isFiniteNumber(row.mufd) ? row.mufd : null,
      hmf2: isFiniteNumber(row.hmf2) ? row.hmf2 : null,
      confidence: isFiniteNumber(row.confidence) ? row.confidence : null,
      source: typeof row.source === 'string' ? row.source : '',
    });
  }
  return { generatedAt, stale: payload.stale === true, stations };
}

/** The measured value a station contributes to the given map. */
export function stationValue(station, field) {
  const value = field === 'muf' ? station.mufd : station.fof2;
  return isFiniteNumber(value) && value > 0 ? value : null;
}

/** Stations that report the active map's quantity, freshest first. */
export function stationsForField(stations, field, now = Date.now()) {
  return stations
    .filter(
      (station) =>
        stationValue(station, field) !== null &&
        now - station.time <= STATION_MAX_AGE_MS,
    )
    .sort((a, b) => b.time - a.time);
}

/** Position 0..1 of a value on the map's logarithmic colour scale. */
export function valuePosition(value, range) {
  const t = Math.log(value / range.min) / Math.log(range.max / range.min);
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}

/** Colour of the ramp at position `t` (0..1), interpolated between stops. */
export function colorAtPosition(stops, t) {
  if (!stops.length) return [255, 255, 255];
  const at = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const low = Math.floor(at);
  const high = Math.min(stops.length - 1, low + 1);
  const mix = at - low;
  return [0, 1, 2].map((i) =>
    Math.round(stops[low][i] + (stops[high][i] - stops[low][i]) * mix),
  );
}

/**
 * Where to print contour values: repeated along every ring, so wherever you look
 * a ring says what it is. Spacing is measured along the path in degrees of arc
 * (longitude scaled by latitude), the first label sits half a spacing in, and
 * short fragments are left bare rather than crowded. If the total would be too
 * many for a scene, the set is thinned evenly.
 * @returns {Array<{lon: number, lat: number, text: string}>}
 */
export function contourLabelPoints(
  lines,
  {
    spacing = CONTOUR_LABEL_SPACING_DEG,
    minLength = CONTOUR_LABEL_MIN_LENGTH_DEG,
    max = CONTOUR_LABEL_MAX,
  } = {},
) {
  const rad = Math.PI / 180;
  const points = [];
  for (const line of lines) {
    const { positions } = line;
    const vertices = positions.length / 2;
    const steps = new Array(vertices).fill(0);
    let total = 0;
    for (let i = 1; i < vertices; i++) {
      const dLat = positions[i * 2 + 1] - positions[i * 2 - 1];
      const midLat = (positions[i * 2 + 1] + positions[i * 2 - 1]) / 2;
      const dLon =
        (positions[i * 2] - positions[i * 2 - 2]) * Math.cos(midLat * rad);
      steps[i] = Math.hypot(dLat, dLon);
      total += steps[i];
    }
    if (total < minLength) continue;
    let travelled = 0;
    let next = Math.min(spacing, total) / 2;
    for (let i = 1; i < vertices; i++) {
      travelled += steps[i];
      while (travelled >= next) {
        points.push({
          lon: positions[i * 2],
          lat: positions[i * 2 + 1],
          text: line.label,
        });
        next += spacing;
      }
    }
  }
  if (points.length <= max) return points;
  const stride = points.length / max;
  return Array.from({ length: max }, (_, i) => points[Math.floor(i * stride)]);
}

/** "8.6", "28.8", "12" — one decimal, dropping a trailing zero. */
export function formatStationValue(value) {
  return String(Math.round(value * 10) / 10);
}

const SOURCE_LABELS = Object.freeze({
  giro: 'GIRO',
  giro_fastchar: 'GIRO (fast scaling)',
  noaa: 'NOAA',
  ingv: 'INGV',
  'aus-sws': 'Australian SWS',
});

/** "50.1°N 4.6°E" */
export function formatPosition(lat, lon) {
  const ns = lat < 0 ? 'S' : 'N';
  const ew = lon < 0 ? 'W' : 'E';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/**
 * The details table for one station, as [label, value] rows. The quantity the
 * active map shows comes first.
 */
export function stationRows(station, field, unit, now = Date.now()) {
  const suffix = unit ? ` ${unit}` : '';
  const value = (v) => `${formatStationValue(v)}${suffix}`;
  const muf = ['MUF (3000 km)', station.mufd];
  const fo = ['foF2', station.fof2];
  const [primary, secondary] = field === 'muf' ? [muf, fo] : [fo, muf];
  const rows = [
    ['Station', station.name],
    ['Code', station.code],
  ];
  if (isFiniteNumber(primary[1])) rows.push([primary[0], value(primary[1])]);
  if (isFiniteNumber(secondary[1]))
    rows.push([secondary[0], value(secondary[1])]);
  if (isFiniteNumber(station.hmf2))
    rows.push(['hmF2', `${Math.round(station.hmf2)} km`]);
  if (isFiniteNumber(station.confidence) && station.confidence >= 0)
    rows.push(['Confidence', `${Math.round(station.confidence)}%`]);
  rows.push(['Position', formatPosition(station.lat, station.lon)]);
  rows.push([
    'Reading',
    formatMapAge(station.time, now).replace(' old', ' ago'),
  ]);
  if (station.source)
    rows.push(['Source', SOURCE_LABELS[station.source] ?? station.source]);
  return rows;
}

/**
 * The station under a screen point, if any is close enough to count as pointed
 * at. Screen projection is cheap and, unlike a GPU pick, unaffected by depth.
 * @param {Array<{code: string, x: number, y: number}>} points
 */
export function nearestStation(points, x, y, radius = 14) {
  let best = null;
  let bestDistance = radius;
  for (const point of points) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Where to put a details card of `size` beside an anchor point, inside
 * `bounds`: right and below by default, flipping to the other side of the
 * anchor when it would overflow.
 */
export function placeCard(anchor, size, bounds, { gap = 14, margin = 8 } = {}) {
  let x = anchor.x + gap;
  if (x + size.width + margin > bounds.width) x = anchor.x - gap - size.width;
  let y = anchor.y + gap;
  if (y + size.height + margin > bounds.height)
    y = anchor.y - gap - size.height;
  return {
    x: Math.max(margin, Math.min(x, bounds.width - size.width - margin)),
    y: Math.max(margin, Math.min(y, bounds.height - size.height - margin)),
  };
}
