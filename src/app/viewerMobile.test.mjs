import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileViewerTuning } from './viewer.js';

test('mobile tuning lowers MSAA and caps the render scale', () => {
  for (const ratio of [1, 1.5, 2, 3, 4]) {
    const tuning = mobileViewerTuning(ratio);
    assert.ok(tuning.msaaSamples <= 2);
    assert.ok(tuning.resolutionScale <= Math.min(ratio, 2));
    assert.ok(tuning.resolutionScale <= 1.5);
    assert.ok(tuning.tilesetMaximumScreenSpaceError > 16);
  }
});

test('mobile tuning tolerates a missing or broken pixel ratio', () => {
  for (const ratio of [undefined, 0, -1, Number.NaN]) {
    assert.equal(mobileViewerTuning(ratio).resolutionScale, 1);
  }
});
