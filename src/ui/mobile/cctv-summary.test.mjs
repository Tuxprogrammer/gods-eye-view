import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cctvTileSummary,
  describeCctvActive,
  describeCctvSync,
} from './cctv-summary.js';

test('cctv tile summary', () => {
  assert.equal(cctvTileSummary({ enabled: false, camera: 'x' }), 'Off');
  assert.equal(
    cctvTileSummary({ enabled: true, camera: '  London · A1 ' }),
    'On · London · A1',
  );
  assert.match(cctvTileSummary({ enabled: true }), /tap a camera/);
});

test('sync chip mirrors only while visible', () => {
  assert.equal(describeCctvSync({ visible: false, label: 'x' }), null);
  assert.equal(describeCctvSync({ visible: true, label: ' ', progress: '' }), null);
  assert.deepEqual(
    describeCctvSync({
      visible: true,
      label: 'loading frames',
      progress: '3/40',
    }),
    { text: 'loading frames 3/40', kind: 'loading', ttl: 0 },
  );
});

test('active camera announcement', () => {
  assert.equal(describeCctvActive(''), null);
  assert.match(describeCctvActive('Leeds · Bridge').text, /Leeds · Bridge/);
});
