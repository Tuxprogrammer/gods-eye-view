import assert from 'node:assert/strict';
import test from 'node:test';
import { fromDegrees } from '../../geo/ellipsoid.js';
import { bindRenderer } from '../../render/rendererOf.js';
import { createHorizonCuller } from './horizon.js';

const above = (lon, lat, height) => fromDegrees(lon, lat, height);

/** A scene with a camera port (its pose) and a frame port (its preRender). */
function harness(camera, { onChange } = {}) {
  const listeners = new Set();
  let renders = 0;
  const state = { position: camera };
  const viewer = {};
  bindRenderer(viewer, {
    camera: { pose: () => ({ position: state.position }) },
    frame: {
      on(phase, fn) {
        assert.equal(phase, 'preRender');
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      requestRender() {
        renders++;
      },
    },
  });
  const flips = [];
  const culler = createHorizonCuller({
    viewer,
    onChange: (flipped) => {
      flips.push(flipped);
      onChange?.(flipped);
    },
  });
  return {
    viewer,
    culler,
    listeners,
    flips,
    state,
    get renders() {
      return renders;
    },
    frame() {
      for (const fn of [...listeners]) fn();
    },
  };
}

const europe = () => ({
  lon: 10,
  lat: 45,
  targets: [{ show: true }, { show: true }],
});
const australia = () => ({ lon: 135, lat: -25, targets: [{ show: true }] });

test('what is over the horizon is hidden, what faces the camera stays shown', () => {
  const h = harness(above(10, 45, 5_000_000));
  const eu = europe();
  const au = australia();
  h.culler.set([eu, au]);
  assert.ok(eu.targets.every((e) => e.show === true));
  assert.equal(
    au.targets[0].show,
    false,
    'a station in Australia is not seen through the Earth',
  );
  assert.deepEqual(
    h.flips,
    [[au.targets[0]]],
    'the flipped targets are handed over',
  );
});

test('the antipode is hidden however high the camera is', () => {
  const h = harness(above(10, 45, 30_000_000));
  const anti = { lon: -170, lat: -45, targets: [{ show: true }] };
  h.culler.set([anti]);
  assert.equal(anti.targets[0].show, false);
});

test('moving the camera around the globe flips what is visible', () => {
  const h = harness(above(10, 45, 5_000_000));
  const eu = europe();
  const au = australia();
  h.culler.set([eu, au]);
  h.state.position = above(135, -25, 5_000_000);
  h.frame();
  assert.equal(eu.targets[0].show, false);
  assert.equal(au.targets[0].show, true);
});

test('a repaint is requested only when something actually flipped', () => {
  const h = harness(above(10, 45, 5_000_000));
  h.culler.set([europe(), australia()]);
  const afterSet = h.renders;
  assert.ok(afterSet >= 1, 'setting hid one, which needs a repaint');
  h.state.position = above(10.5, 45.2, 5_000_000);
  h.frame();
  assert.equal(h.renders, afterSet, 'nothing crossed the horizon');
  h.state.position = above(135, -25, 5_000_000);
  h.frame();
  assert.equal(h.renders, afterSet + 1);
});

test('a sub-kilometre camera move does not re-evaluate anything', () => {
  const camera = above(10, 45, 5_000_000);
  const h = harness(camera);
  const eu = europe();
  h.culler.set([eu]);
  // Tamper with visibility by hand; an unmoved camera must leave it alone.
  eu.targets[0].show = 'sentinel';
  h.state.position = { x: camera.x + 100, y: camera.y, z: camera.z };
  h.frame();
  assert.equal(eu.targets[0].show, 'sentinel');
  h.culler.refresh();
  assert.equal(eu.targets[0].show, true, 'refresh forces the test');
});

test('a whole set is toggled together', () => {
  const h = harness(above(10, 45, 5_000_000));
  const both = {
    lon: 135,
    lat: -25,
    targets: [{ show: true }, { show: true }],
  };
  h.culler.set([both]);
  assert.deepEqual(
    both.targets.map((e) => e.show),
    [false, false],
  );
});

test('it only listens while there is something to track', () => {
  const h = harness(above(10, 45, 5_000_000));
  assert.equal(h.listeners.size, 0);
  h.culler.set([europe()]);
  assert.equal(h.listeners.size, 1);
  h.culler.set([europe(), australia()]);
  assert.equal(
    h.listeners.size,
    1,
    'replacing the set does not add a second listener',
  );
  h.culler.set([]);
  assert.equal(h.listeners.size, 0);
  h.culler.set([europe()]);
  h.culler.clear();
  assert.equal(h.listeners.size, 0);
  h.culler.set([europe()]);
  h.culler.destroy();
  assert.equal(h.listeners.size, 0);
});

test('a scene with no camera or frame port is harmless', () => {
  const culler = createHorizonCuller({ viewer: {} });
  assert.doesNotThrow(() => culler.set([europe()]));
  assert.doesNotThrow(() => culler.refresh());
});
