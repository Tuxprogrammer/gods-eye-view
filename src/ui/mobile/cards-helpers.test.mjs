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
  touchDrillWindow,
  touchPickWindow,
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
  assert.deepEqual(
    parseVesselReadout('AIS: EVER GIVEN\nCARGO  SPD: 12 kn\nMMSI: 1'),
    {
      title: 'EVER GIVEN',
      lines: ['CARGO  SPD: 12 kn', 'MMSI: 1'],
    },
  );
});

test('touch pick windows are wide in the mobile UI and the default elsewhere', () => {
  assert.deepEqual(touchPickWindow({ mobile: true }), {
    width: PICK_SLOP_PX,
    height: PICK_SLOP_PX,
  });
  assert.equal(touchPickWindow({ mobile: false }), undefined);
  assert.deepEqual(touchDrillWindow(6, { mobile: true }), {
    width: DRILL_SLOP_PX,
    height: DRILL_SLOP_PX,
  });
  assert.deepEqual(touchDrillWindow(6, { mobile: false }), {
    width: 6,
    height: 6,
  });
  assert.deepEqual(touchDrillWindow(40, { mobile: true }), {
    width: 40,
    height: 40,
  });
});
