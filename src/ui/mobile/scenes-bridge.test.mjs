import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePercent,
  runWithDialogAnswers,
  scenesSummary,
} from './scenes-bridge.js';

test('answers are supplied only during the call and restored after', () => {
  const win = { prompt: () => 'orig-p', confirm: () => 'orig-c' };
  const original = { ...win };
  const seen = runWithDialogAnswers(
    win,
    { prompt: 'My scene', confirm: true },
    () => [win.prompt('x'), win.confirm('y')],
  );
  assert.deepEqual(seen, ['My scene', true]);
  assert.equal(win.prompt, original.prompt);
  assert.equal(win.confirm, original.confirm);
});

test('restores even when the call throws; untouched slot stays', () => {
  const win = { prompt: () => 'p', confirm: () => 'c' };
  const confirm = win.confirm;
  assert.throws(() =>
    runWithDialogAnswers(win, { prompt: 'a' }, () => {
      assert.equal(win.confirm, confirm);
      throw new Error('boom');
    }),
  );
  assert.equal(win.prompt(), 'p');
});

test('summary and percent helpers', () => {
  assert.equal(scenesSummary({ running: true }), 'Playing');
  assert.equal(scenesSummary({ sceneTitle: '', shotCount: 0 }), 'No scenes');
  assert.equal(
    scenesSummary({ sceneTitle: 'Tour', shotCount: 1 }),
    'Tour · 1 shot',
  );
  assert.equal(
    scenesSummary({ sceneTitle: 'Tour', shotCount: 3 }),
    'Tour · 3 shots',
  );
  assert.equal(parsePercent('42%'), 42);
  assert.equal(parsePercent(''), 0);
  assert.equal(parsePercent('250%'), 100);
});
