import test from 'node:test';
import assert from 'node:assert/strict';
import { contextTileSummary } from './context-summary.js';

test('context tile summary reflects the active mode', () => {
  assert.equal(contextTileSummary({ mode: 'flights' }), 'Contacts on');
  assert.equal(
    contextTileSummary({ mode: 'space-missions', rosterCount: '12 / 30D' }),
    'Space missions · 12 / 30D',
  );
  assert.equal(
    contextTileSummary({ mode: 'space-missions', rosterCount: '—' }),
    'Space missions on',
  );
  assert.match(contextTileSummary({ mode: 'none' }), /^Off/);
  assert.match(contextTileSummary(), /^Off/);
});
