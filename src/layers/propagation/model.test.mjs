import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampOpacity,
  colorbarStops,
  dominantAlpha,
  flattenHeatmapPixels,
  formatMapAge,
  formatRangeValue,
  gradientCss,
  heatmapTiles,
  normalizePropagationPayload,
  thinTicks,
} from './model.js';

function payload(overrides = {}) {
  return {
    field: 'muf',
    label: 'MUF (3000 km)',
    unit: 'MHz',
    generatedAt: '2026-09-20T02:55:53.000Z',
    fetchedAt: '2026-09-20T02:57:00.000Z',
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    southUp: true,
    scale: 'log',
    range: { min: 4, max: 35 },
    ticks: [
      { position: 0.13, value: 5.3, label: '5.3' },
      { position: 0.43, value: 10.1, label: '10.1' },
    ],
    heatmap: 'AAAAAAAAAAAAAAAAAAAA',
    colorbar: 'BBBBBBBBBBBBBBBBBBBB',
    stale: false,
    ...overrides,
  };
}

test('accepts a well-formed payload and drops decoration it does not use', () => {
  const map = normalizePropagationPayload(payload(), 'muf');
  assert.equal(map.field, 'muf');
  assert.equal(map.generatedAt, Date.parse('2026-09-20T02:55:53.000Z'));
  assert.deepEqual(map.ticks[0], { position: 0.13, label: '5.3' });
  assert.equal(map.stale, false);
});

test('rejects payloads the renderer cannot trust', () => {
  const bad = [
    ['wrong field', payload({ field: 'fof2' })],
    ['bad bounds', payload({ bounds: { west: -90, south: -90, east: 90, north: 90 } })],
    ['inverted range', payload({ range: { min: 35, max: 4 } })],
    ['non-positive range', payload({ range: { min: 0, max: 4 } })],
    ['linear scale', payload({ scale: 'linear' })],
    ['no orientation', payload({ southUp: undefined })],
    ['no heatmap', payload({ heatmap: '' })],
    ['bad time', payload({ generatedAt: 'soon' })],
    ['no ticks', payload({ ticks: null })],
  ];
  for (const [name, value] of bad)
    assert.throws(() => normalizePropagationPayload(value, 'muf'), /Malformed/, name);
  assert.throws(() => normalizePropagationPayload(null, 'muf'), /Malformed/);
});

test('out-of-range ticks are ignored, not fatal', () => {
  const map = normalizePropagationPayload(
    payload({
      ticks: [
        { position: 2, label: 'x' },
        { position: 0.5, label: '10' },
      ],
    }),
    'muf',
  );
  assert.deepEqual(map.ticks, [{ position: 0.5, label: '10' }]);
});

test('opacity is clamped and non-numbers fall back to the default', () => {
  assert.equal(clampOpacity(5), 1);
  assert.equal(clampOpacity(0), 0.1);
  assert.equal(clampOpacity(0.4), 0.4);
  assert.equal(clampOpacity('nope'), 0.6);
});

test('the baked alpha is found and ignores transparent pixels', () => {
  const rgba = new Uint8ClampedArray(4 * 500);
  for (let i = 0; i < 500; i++) rgba[i * 4 + 3] = i % 5 === 0 ? 0 : 96;
  assert.equal(dominantAlpha(rgba), 96);
  assert.equal(dominantAlpha(new Uint8ClampedArray(16)), 255);
});

test('flattening flips a south-up raster north-up and removes baked alpha', () => {
  // 1 wide, 2 tall: row 0 = south = red, row 1 = north = blue.
  const rgba = Uint8ClampedArray.from([255, 0, 0, 96, 0, 0, 255, 96]);
  const south = flattenHeatmapPixels(rgba, 1, 2, { southUp: true });
  assert.deepEqual([...south], [0, 0, 255, 255, 255, 0, 0, 255]);
  const north = flattenHeatmapPixels(rgba, 1, 2, { southUp: false });
  assert.deepEqual([...north], [255, 0, 0, 255, 0, 0, 255, 255]);
});

test('transparent source pixels stay transparent', () => {
  const rgba = Uint8ClampedArray.from([9, 9, 9, 0]);
  assert.equal(flattenHeatmapPixels(rgba, 1, 1, { southUp: false })[3], 0);
});

test('colour-bar stops undo the upstream white blend', () => {
  // A true colour of (100, 200, 40) blended over white at alpha 96/255.
  const a = 96 / 255;
  const blend = (c) => Math.round(255 * (1 - a) + c * a);
  const px = [blend(100), blend(200), blend(40), 255];
  const rgba = Uint8ClampedArray.from([...px, ...px]);
  const [first] = colorbarStops(rgba, 2, 1, 96, 2);
  for (const [i, want] of [100, 200, 40].entries())
    assert.ok(Math.abs(first[i] - want) <= 3, `channel ${i}: ${first[i]}`);
  // Fully opaque bars are used as they are.
  const [same] = colorbarStops(Uint8ClampedArray.from([10, 20, 30, 255]), 1, 1, 255, 1);
  assert.deepEqual(same, [10, 20, 30]);
});

test('gradient css lists every stop across the bar', () => {
  const css = gradientCss([
    [0, 0, 0],
    [255, 255, 255],
  ]);
  assert.equal(
    css,
    'linear-gradient(90deg, rgb(0, 0, 0) 0.0%, rgb(255, 255, 255) 100.0%)',
  );
});

test('tiles cover the globe exactly once, poles excluded only by a hair', () => {
  const width = 2732;
  const height = 1366;
  const tiles = heatmapTiles(width, height);
  assert.equal(tiles.length, 18);
  let area = 0;
  for (const tile of tiles) {
    area += tile.width * tile.height;
    assert.ok(tile.north <= 89.999 && tile.south >= -89.999);
    assert.ok(tile.width > 0 && tile.height > 0);
  }
  assert.equal(area, width * height);
  const west = tiles.filter((tile) => tile.west === -180);
  assert.ok(west.every((tile) => tile.x === 0));
  const northRow = tiles.filter((tile) => tile.north === 89.999);
  assert.ok(northRow.every((tile) => tile.y === 0));
});

test('crowded ticks are thinned, keeping the first of a run', () => {
  const ticks = [0.5, 0.52, 0.1, 0.12, 0.9].map((position) => ({
    position,
    label: String(position),
  }));
  assert.deepEqual(
    thinTicks(ticks).map((tick) => tick.position),
    [0.1, 0.5, 0.9],
  );
});

test('range and age labels read naturally', () => {
  assert.equal(formatRangeValue(4.0000001), '4');
  assert.equal(formatRangeValue(35.02), '35');
  assert.equal(formatRangeValue(1.5), '1.5');
  const now = Date.parse('2026-09-20T03:00:00Z');
  assert.equal(formatMapAge(now - 20_000, now), 'just now');
  assert.equal(formatMapAge(now - 12 * 60_000, now), '12 min old');
  assert.equal(formatMapAge(now - 3 * 3_600_000, now), '3 h old');
});

// ---- overlays: validation, colour mapping, label placement ----

import {
  colorAtPosition,
  contourLabelPoints,
  formatPosition,
  formatStationValue,
  nearestStation,
  normalizeContoursPayload,
  normalizeStationsPayload,
  placeCard,
  stationRows,
  stationValue,
  stationsForField,
  valuePosition,
} from './model.js';

const contours = (over = {}) => ({
  field: 'muf',
  generatedAt: '2026-09-20T02:55:53.000Z',
  stale: false,
  lines: [{ value: 10.1, label: '10.1', color: '#005767', positions: [0, 0, 1, 1] }],
  ...over,
});

test('contour payloads are validated', () => {
  const ok = normalizeContoursPayload(contours(), 'muf');
  assert.equal(ok.lines.length, 1);
  assert.equal(ok.lines[0].color, '#005767');
  const bad = [
    ['wrong field', contours({ field: 'fof2' })],
    ['no lines', contours({ lines: null })],
    ['odd coordinate count', contours({ lines: [{ value: 1, positions: [0, 0, 1] }] })],
    ['too short', contours({ lines: [{ value: 1, positions: [0, 0] }] })],
    ['non-numeric', contours({ lines: [{ value: 1, positions: [0, 0, 'x', 1] }] })],
    ['no value', contours({ lines: [{ positions: [0, 0, 1, 1] }] })],
    ['bad time', contours({ generatedAt: 'later' })],
  ];
  for (const [name, value] of bad)
    assert.throws(() => normalizeContoursPayload(value, 'muf'), /Malformed/, name);
  assert.throws(() => normalizeContoursPayload(null, 'muf'), /Malformed/);
});

const station = (over = {}) => ({
  code: 'AU930',
  name: 'Austin',
  lat: 30.4,
  lon: -97.7,
  time: 1_000_000,
  fof2: 8.6,
  mufd: 28.8,
  hmf2: 241,
  confidence: 75,
  source: 'giro',
  ...over,
});

test('station payloads drop malformed rows but reject a non-payload', () => {
  const ok = normalizeStationsPayload({
    generatedAt: '2026-09-20T02:55:53.000Z',
    stations: [
      station(),
      station({ code: 'BADLAT', lat: 95 }),
      station({ code: 'BADLON', lon: 200 }),
      station({ code: 'NOTIME', time: 'x' }),
      { junk: true },
      null,
    ],
  });
  assert.deepEqual(
    ok.stations.map((s) => s.code),
    ['AU930'],
  );
  assert.throws(() => normalizeStationsPayload({ stations: [] }), /Malformed/);
  assert.throws(
    () => normalizeStationsPayload({ generatedAt: '2026-09-20T02:55:53.000Z' }),
    /Malformed/,
  );
});

test('a station contributes the value the active map shows', () => {
  const s = station({ fof2: 6.2, mufd: 21.4 });
  assert.equal(stationValue(s, 'muf'), 21.4);
  assert.equal(stationValue(s, 'fof2'), 6.2);
  assert.equal(stationValue(station({ mufd: null }), 'muf'), null);
  assert.equal(stationValue(station({ fof2: 0 }), 'fof2'), null);
});

test('stations for a map are those reporting it recently, freshest first', () => {
  const now = 10 * 3_600_000;
  const list = stationsForField(
    [
      station({ code: 'OLD', time: now - 4 * 3_600_000 }),
      station({ code: 'A', time: now - 60_000 }),
      station({ code: 'NOMUF', mufd: null, time: now - 30_000 }),
      station({ code: 'B', time: now - 30_000 }),
    ],
    'muf',
    now,
  );
  assert.deepEqual(
    list.map((s) => s.code),
    ['B', 'A'],
  );
});

test('a value maps to its place on the log colour scale', () => {
  const range = { min: 4, max: 36 };
  assert.equal(valuePosition(4, range), 0);
  assert.equal(valuePosition(36, range), 1);
  assert.ok(Math.abs(valuePosition(12, range) - 0.5) < 1e-9, 'geometric mean is the middle');
  assert.equal(valuePosition(1, range), 0, 'below the scale clamps');
  assert.equal(valuePosition(500, range), 1, 'above the scale clamps');
  assert.equal(valuePosition(-3, range), 0);
});

test('ramp colours interpolate between stops and clamp at the ends', () => {
  const stops = [
    [0, 0, 0],
    [100, 200, 50],
    [255, 255, 255],
  ];
  assert.deepEqual(colorAtPosition(stops, 0), [0, 0, 0]);
  assert.deepEqual(colorAtPosition(stops, 0.5), [100, 200, 50]);
  assert.deepEqual(colorAtPosition(stops, 0.25), [50, 100, 25]);
  assert.deepEqual(colorAtPosition(stops, 1), [255, 255, 255]);
  assert.deepEqual(colorAtPosition(stops, 7), [255, 255, 255]);
  assert.deepEqual(colorAtPosition(stops, -1), [0, 0, 0]);
  assert.deepEqual(colorAtPosition([], 0.5), [255, 255, 255]);
});

test('station values read with one decimal and no trailing zero', () => {
  assert.equal(formatStationValue(8.6), '8.6');
  assert.equal(formatStationValue(12), '12');
  assert.equal(formatStationValue(21.4999), '21.5');
  assert.equal(formatStationValue(28.8123), '28.8');
});

/** A ring along the equator: vertex n at lon n, lat 0, so arc length = vertices. */
const equator = (vertices, over = {}) => ({
  value: 14,
  label: '14',
  positions: Array.from({ length: vertices * 2 }, (_, i) => (i % 2 ? 0 : i / 2)),
  ...over,
});

test('ring labels repeat along the whole ring, first one half a spacing in', () => {
  // 100 degrees of arc at 24 degree spacing: labels at 12, 36, 60, 84.
  const points = contourLabelPoints([equator(101)]);
  assert.deepEqual(
    points.map((p) => p.lon),
    [12, 36, 60, 84],
  );
  assert.ok(points.every((p) => p.text === '14' && p.lat === 0));
});

test('a longer ring carries proportionally more labels', () => {
  const short = contourLabelPoints([equator(101)]).length;
  const long = contourLabelPoints([equator(301)]).length;
  assert.ok(long >= short * 2.5, `${long} vs ${short}`);
});

test('fragments too short to label are left bare', () => {
  assert.deepEqual(contourLabelPoints([equator(9)]), []);
  assert.equal(contourLabelPoints([equator(11)]).length, 1);
});

test('longitude is scaled by latitude when measuring a ring', () => {
  // 60 degrees of longitude at 60 degrees north is only ~30 degrees of arc.
  const polar = {
    value: 10,
    label: '10',
    positions: Array.from({ length: 61 * 2 }, (_, i) => (i % 2 ? 60 : i / 2)),
  };
  const points = contourLabelPoints([polar]);
  assert.equal(points.length, 1, 'about 30 degrees of arc earns one label');
  // The first label sits 12 degrees of arc in, which is 24 degrees of longitude.
  assert.equal(points[0].lon, 24);
});

test('too many labels are thinned evenly, not truncated', () => {
  // Ten rings of different lengths, each with its own label text.
  const lines = Array.from({ length: 10 }, (_, i) =>
    equator(361 + i * 7, { value: i + 1, label: `L${i}` }),
  );
  const all = contourLabelPoints(lines, { max: 10_000 });
  const capped = contourLabelPoints(lines, { max: 20 });
  assert.equal(capped.length, 20);
  assert.ok(all.length > 100);
  // Thinning spreads the choice across rings rather than keeping only the first.
  assert.ok(new Set(capped.map((p) => p.text)).size >= 8);
});

test('the details table leads with the quantity on the map', () => {
  const now = Date.parse('2026-09-20T16:00:00Z');
  const s = station({
    name: 'Dourbes, Belgium',
    code: 'DB049',
    lat: 50.1,
    lon: 4.6,
    fof2: 6.35,
    mufd: 20.034,
    hmf2: 248.818,
    confidence: 95,
    source: 'giro',
    time: now - 12 * 60_000,
  });
  const muf = stationRows(s, 'muf', 'MHz', now);
  assert.deepEqual(muf, [
    ['Station', 'Dourbes, Belgium'],
    ['Code', 'DB049'],
    ['MUF (3000 km)', '20 MHz'],
    ['foF2', '6.4 MHz'],
    ['hmF2', '249 km'],
    ['Confidence', '95%'],
    ['Position', '50.1°N 4.6°E'],
    ['Reading', '12 min ago'],
    ['Source', 'GIRO'],
  ]);
  const fo = stationRows(s, 'fof2', 'MHz', now);
  assert.equal(fo[2][0], 'foF2');
  assert.equal(fo[3][0], 'MUF (3000 km)');
});

test('the details table omits what the station did not report', () => {
  const rows = stationRows(
    station({ mufd: null, hmf2: null, confidence: -1, source: '' }),
    'muf',
    'MHz',
    1_000_000,
  );
  const labels = rows.map(([label]) => label);
  assert.equal(labels.includes('MUF (3000 km)'), false);
  assert.equal(labels.includes('hmF2'), false);
  assert.equal(labels.includes('Confidence'), false, 'confidence -1 means unknown');
  assert.equal(labels.includes('Source'), false);
  assert.ok(labels.includes('foF2'));
});

test('positions read in compass form', () => {
  assert.equal(formatPosition(-33.9, -70.7), '33.9°S 70.7°W');
  assert.equal(formatPosition(0, 0), '0.0°N 0.0°E');
});

test('the station nearest the pointer wins, within a radius', () => {
  const points = [
    { code: 'A', x: 100, y: 100 },
    { code: 'B', x: 108, y: 100 },
    { code: 'C', x: 300, y: 300 },
  ];
  assert.equal(nearestStation(points, 106, 101).code, 'B');
  assert.equal(nearestStation(points, 100, 100).code, 'A');
  assert.equal(nearestStation(points, 200, 200), null);
  assert.equal(nearestStation(points, 100, 120, 10), null, 'radius is respected');
  assert.equal(nearestStation([], 0, 0), null);
});

test('the details card sits beside the pointer and flips at the edges', () => {
  const size = { width: 200, height: 100 };
  const bounds = { width: 1000, height: 600 };
  assert.deepEqual(placeCard({ x: 100, y: 100 }, size, bounds), { x: 114, y: 114 });
  // Near the right edge it flips to the left of the pointer.
  assert.deepEqual(placeCard({ x: 950, y: 100 }, size, bounds), { x: 736, y: 114 });
  // Near the bottom it flips above.
  assert.deepEqual(placeCard({ x: 100, y: 580 }, size, bounds), { x: 114, y: 466 });
  // A tiny viewport still keeps it on screen.
  const tiny = placeCard({ x: 10, y: 10 }, size, { width: 150, height: 90 });
  assert.ok(tiny.x >= 8 && tiny.y >= 8);
});
