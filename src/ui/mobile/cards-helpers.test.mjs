import assert from 'node:assert/strict';
import test from 'node:test';
import {
  drawToolbarState,
  isSwipeDismiss,
  parseVesselReadout,
  stepIndex,
} from './cards-helpers.js';
import {
  DRILL_SLOP_PX,
  PICK_SLOP_PX,
  installPickSlop,
} from './cards-slop.js';

test('stepIndex wraps both ways and tolerates a missing current index', () => {
  assert.equal(stepIndex(3, 0, 1), 1);
  assert.equal(stepIndex(3, 2, 1), 0);
  assert.equal(stepIndex(3, 0, -1), 2);
  assert.equal(stepIndex(3, -1, 1), 1);
  assert.equal(stepIndex(0, 0, 1), -1);
});

test('isSwipeDismiss wants a mostly-vertical downward drag', () => {
  assert.equal(isSwipeDismiss({ dx: 0, dy: 60, ms: 120 }), true);
  assert.equal(isSwipeDismiss({ dx: 0, dy: 60, ms: 600 }), false);
  assert.equal(isSwipeDismiss({ dx: 0, dy: 120, ms: 600 }), true);
  assert.equal(isSwipeDismiss({ dx: 90, dy: 60, ms: 100 }), false);
  assert.equal(isSwipeDismiss({ dx: 0, dy: -80, ms: 100 }), false);
});

const V = (lon, lat) => ({ lon, lat, height: 0 });

test('drawToolbarState guides an area and only enables Finish when it can', () => {
  assert.equal(drawToolbarState(null).canFinish, false);
  const empty = drawToolbarState({ shape: 'area', vertices: [] });
  assert.equal(empty.canUndo, false);
  const two = drawToolbarState({
    shape: 'area',
    vertices: [V(0, 0), V(0, 0.01)],
  });
  assert.match(two.hint, /1 more point\./);
  assert.equal(two.canFinish, false);
  assert.equal(two.canUndo, true);
  const three = drawToolbarState({
    shape: 'area',
    vertices: [V(0, 0), V(0, 0.01), V(0.01, 0.01)],
  });
  assert.equal(three.canFinish, true);
  assert.match(three.hint, /Tap Finish/);
  assert.doesNotMatch(three.hint, /double-click|Enter|Backspace|Esc/);
});

test('a pin finishes as Place pin after one tap', () => {
  const pin = drawToolbarState({ shape: 'pin', vertices: [V(1, 1)] });
  assert.equal(pin.finishLabel, 'Place pin');
  assert.equal(pin.canFinish, true);
  assert.doesNotMatch(pin.hint, /Enter|Esc/);
});

test('parseVesselReadout drops the placeholder and splits title from detail', () => {
  assert.equal(parseVesselReadout('AIS: --'), null);
  assert.equal(parseVesselReadout(''), null);
  assert.deepEqual(parseVesselReadout('AIS: EVER GIVEN\nCARGO  SPD: 12 kn\nMMSI: 1'), {
    title: 'EVER GIVEN',
    lines: ['CARGO  SPD: 12 kn', 'MMSI: 1'],
  });
});

test('installPickSlop widens defaults, respects explicit sizes, and reverts', () => {
  const calls = [];
  class Scene {
    pick(pos, w, h) {
      calls.push(['pick', w, h]);
    }
    drillPick(pos, limit, w, h) {
      calls.push(['drill', w, h]);
    }
  }
  const original = Scene.prototype.pick;
  const undo = installPickSlop(Scene);
  const scene = new Scene();
  scene.pick({});
  scene.pick({}, 14, 14);
  scene.drillPick({}, 5);
  scene.drillPick({}, 5, 6, 6);
  scene.drillPick({}, 5, 40, 40);
  assert.deepEqual(calls, [
    ['pick', PICK_SLOP_PX, PICK_SLOP_PX],
    ['pick', 14, 14],
    ['drill', DRILL_SLOP_PX, DRILL_SLOP_PX],
    ['drill', DRILL_SLOP_PX, DRILL_SLOP_PX],
    ['drill', 40, 40],
  ]);
  // Installing twice does not stack wrappers.
  const undoAgain = installPickSlop(Scene);
  undoAgain();
  scene.pick({});
  assert.equal(calls.at(-1)[1], PICK_SLOP_PX);
  undo();
  assert.equal(Scene.prototype.pick, original);
});
