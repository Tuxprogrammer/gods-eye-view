import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardModel,
  chartSeries,
  defaultSettings,
  feedSummary,
  formatAge,
  formatSpeed,
  formatTemperature,
  normalizeMessagesPayload,
  normalizeStationsPayload,
  parseCallFilter,
  popupText,
  sparklinePath,
  stationCategory,
  stationsQuery,
  symbolCell,
  symbolFor,
} from './model.js';

const station = (extra = {}) => ({
  id: 'W4HSV',
  kind: 'station',
  lat: 34.776,
  lon: -86.6,
  symTable: '/',
  symCode: '_',
  comment: 'Huntsville WX',
  path: 'TCPXX*,qAX,CWOP-3',
  dest: 'APRS',
  firstHeard: Date.UTC(2026, 8, 20, 15, 14, 13),
  lastHeard: Date.UTC(2026, 8, 20, 17, 29, 37),
  posAt: Date.UTC(2026, 8, 20, 17, 27, 29),
  wxAt: Date.UTC(2026, 8, 20, 17, 27, 29),
  wx: {
    windDir: 211,
    windSpeedMph: 2.9,
    gustMph: 8.1,
    tempF: 91,
    humidity: 60,
    pressureMb: 1014.7,
    rain1hIn: 0,
    rain24hIn: 0.1,
    rainMidnightIn: 0,
  },
  ...extra,
});

test('the query carries radius, window, track and filters, and omits defaults', () => {
  const settings = { ...defaultSettings(), radius: 'earth', window: '60', track: '0' };
  const query = new URLSearchParams(
    stationsQuery(settings, { lat: 34.77601, lon: -86.6 }),
  );
  assert.equal(query.get('radiusKm'), 'earth');
  assert.equal(query.get('windowMin'), '60');
  assert.equal(query.get('lat'), '34.776');
  assert.equal(query.has('trackMin'), false);
  assert.equal(query.has('objects'), false);
  const busy = new URLSearchParams(
    stationsQuery(
      {
        ...defaultSettings(),
        track: '180',
        objects: false,
        weatherOnly: true,
        movingOnly: true,
        callFilter: 'w4*, kq4vyy-9',
      },
      { lat: 1, lon: 2 },
    ),
  );
  assert.equal(busy.get('trackMin'), '180');
  assert.equal(busy.get('objects'), '0');
  assert.equal(busy.get('wx'), '1');
  assert.equal(busy.get('moving'), '1');
  assert.equal(busy.get('call'), 'W4*,KQ4VYY-9');
});

test('unknown option values fall back to the defaults instead of breaking the query', () => {
  const query = new URLSearchParams(
    stationsQuery({ ...defaultSettings(), radius: 'banana', window: '7', track: 'x' }, { lat: 0, lon: 0 }),
  );
  assert.equal(query.get('radiusKm'), '500');
  assert.equal(query.get('windowMin'), '60');
});

test('call filters keep only plausible patterns, at most twenty', () => {
  assert.deepEqual(parseCallFilter(' w4*,  <script> kq4vyy '), ['W4*', 'KQ4VYY']);
  assert.equal(parseCallFilter(Array.from({ length: 40 }, (_, i) => `A${i}`).join(',')).length, 20);
  assert.deepEqual(parseCallFilter(''), []);
});

test('payload normalisation drops malformed stations and short tracks', () => {
  const payload = normalizeStationsPayload({
    generatedAt: 5,
    total: 3,
    truncated: true,
    feed: { status: 'live', packetsPerMinute: 4200 },
    stations: [
      { id: 'A', lat: 10, lon: 20 },
      { id: 'B', lat: 999, lon: 20 },
      { id: 'C', lat: 'x', lon: 1 },
      { lat: 1, lon: 1 },
    ],
    tracks: {
      A: [[1, 20, 10], [2, 21, 11], [3, 22, 12]],
      B: [[1, 20, 10]],
      C: [[1, 200, 10], [2, 21, 11]],
    },
  });
  assert.deepEqual(payload.stations.map((s) => s.id), ['A']);
  assert.equal(payload.truncated, true);
  assert.equal(payload.total, 3);
  assert.equal(payload.tracks.get('A').length, 3);
  assert.equal(payload.tracks.has('B'), false);
  assert.equal(payload.tracks.has('C'), false, 'a track with one bad point leaves one point');
  assert.equal(payload.feed.packetsPerMinute, 4200);
  assert.throws(() => normalizeStationsPayload({}), /no station list/);
});

test('message normalisation keeps only anchored, complete messages', () => {
  const payload = normalizeMessagesPayload({
    cursor: 9,
    messages: [
      { id: 1, from: 'A', to: 'B', text: 'hi', lat: 1, lon: 2, anchoredTo: 'recipient' },
      { id: 2, from: 'A', to: 'B', text: 'no position' },
    ],
  });
  assert.equal(payload.cursor, 9);
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].anchoredTo, 'recipient');
});

test('symbols map to glyphs and unknown ones still draw', () => {
  assert.equal(symbolFor('/', '_').category, 'weather');
  assert.equal(symbolFor('/', '>').label, 'Car');
  assert.equal(symbolFor('\\', '#').category, 'infrastructure');
  assert.equal(symbolFor('/', '~').glyph, '●');
});

test('category follows weather, objects and movement', () => {
  assert.equal(stationCategory(station()), 'weather');
  assert.equal(stationCategory({ ...station({ wx: null, symCode: '-' }), speed: 30 }), 'mobile');
  assert.equal(stationCategory(station({ wx: null, symCode: '-' })), 'fixed');
  assert.equal(stationCategory(station({ wx: null, symCode: '-', kind: 'object' })), 'object');
});

test('the details card reads like aprs.fi: heard span, weather in prose, path', () => {
  const card = cardModel(station({ distanceKm: 12.3 }), 'imperial', Date.UTC(2026, 8, 20, 17, 30));
  const text = card.lines.map((line) => line.map((s) => s.t).join(''));
  assert.equal(card.title, 'W4HSV');
  assert.match(text[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d - \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.ok(text.includes('Temperature 91°F Humidity 60% Pressure 1014.7 mbar'));
  assert.ok(text.includes('Wind 211° 2.9 MPH (Gusts 8.1 MPH)'));
  assert.ok(text.includes('Rain 0 inches/1h 0.1 inches/24h 0 inches/since midnight'));
  assert.ok(text.some((line) => line.includes('7.6 mi from view centre')));
  assert.ok(text.includes('Huntsville WX'));
  assert.ok(text.at(-1) === '[APRS via TCPXX*,qAX,CWOP-3]');
  assert.equal(card.hasCharts, true);
  const bold = card.lines.flat().filter((s) => s.b).map((s) => s.t);
  assert.ok(bold.includes('91°F'));
});

test('metric units convert on display only', () => {
  const card = cardModel(station(), 'metric');
  const text = card.lines.map((line) => line.map((s) => s.t).join('')).join('\n');
  assert.match(text, /Temperature 32\.8°C/);
  assert.match(text, /Wind 211° 1\.3 m\/s/);
  assert.equal(formatSpeed(100, 'metric'), '100 km/h');
  assert.equal(formatSpeed(160.9344, 'imperial'), '100 MPH');
  assert.equal(formatTemperature(32, 'metric'), '0°C');
});

test('a moving station shows speed and heading; a fixed one does not', () => {
  const moving = cardModel(station({ wx: null, symCode: '>', speed: 80.4672, course: 90 }));
  const text = moving.lines.map((l) => l.map((s) => s.t).join(''));
  assert.ok(text.includes('50 MPH heading 90°'));
  const still = cardModel(station({ wx: null, symCode: '-', speed: 0 }));
  assert.equal(still.lines.flat().some((s) => /heading/.test(s.t)), false);
});

test('weather charts need two points and report their range', () => {
  const history = [
    { ts: 0, tempF: 50, pressureMb: 1000 },
    { ts: 600_000, tempF: 70, pressureMb: 1010 },
    { ts: 1_200_000, tempF: 60 },
  ];
  const series = chartSeries(history, 'imperial');
  assert.deepEqual(series.map((s) => s.key), ['tempF', 'pressureMb']);
  assert.equal(series[0].minText, '50°F');
  assert.equal(series[0].maxText, '70°F');
  assert.deepEqual(chartSeries([{ ts: 0, tempF: 1 }]), []);
  const path = sparklinePath(series[0].points, 100, 20);
  assert.match(path, /^M0\.0 20\.0 L50\.0 0\.0 L100\.0 10\.0$/);
  assert.equal(sparklinePath([[0, 1]], 100, 20), '');
});

test('the feed summary is honest about each failure', () => {
  const now = 1_000_000;
  assert.match(feedSummary({ status: 'live', packetsPerMinute: 4000, server: 'T2X', lastPacketAt: now }, now), /live · 4000\/min · T2X/);
  assert.match(feedSummary({ status: 'live', lastPacketAt: now - 600_000 }, now), /no packets lately/);
  assert.match(feedSummary({ status: 'missing-config', error: 'APRS_CALLSIGN is not set' }), /APRS_CALLSIGN/);
  assert.match(feedSummary({ status: 'reconnecting' }), /Connecting/);
  assert.match(feedSummary({ status: 'unverified' }), /did not verify/);
});

test('ages and pop-up text', () => {
  assert.equal(formatAge(0, 30_000), '30 s ago');
  assert.equal(formatAge(0, 125 * 60_000), '2 h 5 min ago');
  assert.equal(popupText('  a\n\n b  '), 'a b');
  assert.equal(popupText('x'.repeat(500)).length, 160);
});

test('an operator-masked position is labelled as such on the card', () => {
  const masked = cardModel(station({ wx: null, symCode: '-', ambiguity: 3 }));
  const text = masked.lines.map((l) => l.map((s) => s.t).join(''));
  assert.ok(text.some((line) => line.includes('operator-masked: within ~19 km')));
  const exact = cardModel(station({ wx: null, symCode: '-' }));
  assert.equal(exact.lines.flat().some((s) => /masked/.test(s.t)), false);
});

test('symbols map onto the aprs.fi sprite sheets', () => {
  // Row 0 of the primary sheet runs from '!' (33): '#' is the third tile.
  assert.deepEqual(symbolCell('/', '#'), { sheet: 0, col: 2, row: 0, overlay: null });
  assert.deepEqual(symbolCell('/', '>'), { sheet: 0, col: 13, row: 1, overlay: null });
  assert.deepEqual(symbolCell('/', '_'), { sheet: 0, col: 14, row: 3, overlay: null });
  assert.deepEqual(symbolCell('\\', '#'), { sheet: 1, col: 2, row: 0, overlay: null });
  // An overlay character picks its own tile from the overlay sheet.
  assert.deepEqual(symbolCell('A', '#'), { sheet: 1, col: 2, row: 0, overlay: { col: 0, row: 2 } });
  assert.deepEqual(symbolCell('0', '_').overlay, { col: 15, row: 0 });
  assert.equal(symbolCell('~', '#'), null, 'an unknown table has no picture');
  assert.equal(symbolCell('/', ' '), null);
  assert.equal(symbolCell('/', ''), null);
});
