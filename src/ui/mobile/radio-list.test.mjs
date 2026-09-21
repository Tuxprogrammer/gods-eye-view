import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterStationEntries,
  radioTileSummary,
  stationSignature,
  stationSubtitle,
  stationTitle,
} from './radio-list.js';

const stations = [
  { id: 'a', name: 'Jazz FM', tags: ['jazz', 'music'], countryCode: 'GB' },
  { id: 'b', name: 'News 24', tags: ['news'], state: 'TX', countryCode: 'US' },
  { id: 'c', name: '', tags: [] },
];

test('titles and subtitles are cleaned', () => {
  assert.equal(stationTitle(stations[2]), 'Unnamed station');
  assert.equal(stationSubtitle(stations[0]), 'jazz · music  /  GB');
  assert.equal(stationSubtitle(stations[1]), 'news  /  TX · US');
  assert.equal(stationSubtitle(stations[2]), '');
});

test('filter keeps directory indexes for tuning', () => {
  assert.deepEqual(
    filterStationEntries(stations, 'news').map((e) => e.index),
    [1],
  );
  assert.deepEqual(
    filterStationEntries(stations, '').map((e) => e.index),
    [0, 1, 2],
  );
  assert.deepEqual(filterStationEntries(stations, 'gb').map((e) => e.index), [0]);
  assert.deepEqual(filterStationEntries(null, 'x'), []);
});

test('signature tracks station order', () => {
  assert.equal(stationSignature(stations), 'a|b|c');
  assert.equal(stationSignature(null), '');
});

test('radio tile summary', () => {
  assert.equal(radioTileSummary({ enabled: false }), 'Off');
  assert.equal(
    radioTileSummary({ enabled: true, name: 'NO STATION SELECTED' }),
    'On · pick a station',
  );
  assert.equal(
    radioTileSummary({ enabled: true, playing: true, name: 'Jazz FM' }),
    'Playing · Jazz FM',
  );
  assert.equal(
    radioTileSummary({ enabled: true, playing: false, name: 'Jazz FM' }),
    'On · Jazz FM',
  );
});
