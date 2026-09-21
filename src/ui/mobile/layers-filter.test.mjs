import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLayerVisibility, countMatches } from './layers-filter.js';

const items = [
  { type: 'heading', key: 'Movement' },
  { type: 'row', text: 'Flights aircraft' },
  { type: 'row', text: 'Vessels' },
  { type: 'heading', key: 'Cameras' },
  { type: 'row', text: 'CCTV' },
];

test('no query, nothing collapsed: everything visible', () => {
  const out = computeLayerVisibility(items);
  assert.ok(out.every((entry) => !entry.hidden && !entry.collapsed));
});

test('collapsed group hides its rows but keeps its heading', () => {
  const out = computeLayerVisibility(items, { collapsed: ['Movement'] });
  assert.deepEqual(
    out.map((entry) => entry.hidden),
    [false, true, true, false, false],
  );
  assert.equal(out[0].collapsed, true);
});

test('query filters rows, hides empty groups, ignores collapse', () => {
  const out = computeLayerVisibility(items, {
    query: ' cctv ',
    collapsed: new Set(['Cameras']),
  });
  assert.deepEqual(
    out.map((entry) => entry.hidden),
    [true, true, true, false, false],
  );
  assert.equal(out[3].collapsed, false);
  assert.equal(countMatches(items, out), 1);
});

test('query with no match hides everything', () => {
  const out = computeLayerVisibility(items, { query: 'zzz' });
  assert.ok(out.every((entry) => entry.hidden));
  assert.equal(countMatches(items, out), 0);
});
