import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createHorizonCuller } from './horizon.js';

const above = (lon, lat, height) => Cesium.Cartesian3.fromDegrees(lon, lat, height);

function harness(camera) {
  const listeners = new Set();
  let renders = 0;
  const viewer = {
    camera: { positionWC: camera },
    scene: {
      preRender: {
        addEventListener(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      requestRender() {
        renders++;
      },
    },
  };
  const culler = createHorizonCuller({ viewer });
  return {
    viewer,
    culler,
    listeners,
    get renders() {
      return renders;
    },
    frame() {
      for (const fn of [...listeners]) fn();
    },
  };
}

const europe = () => ({ lon: 10, lat: 45, entities: [{ show: true }, { show: true }] });
const australia = () => ({ lon: 135, lat: -25, entities: [{ show: true }] });

test('what is over the horizon is hidden, what faces the camera stays shown', () => {
  const h = harness(above(10, 45, 5_000_000));
  const eu = europe();
  const au = australia();
  h.culler.set([eu, au]);
  assert.ok(eu.entities.every((e) => e.show === true));
  assert.equal(au.entities[0].show, false, 'a station in Australia is not seen through the Earth');
});

test('the antipode is hidden however high the camera is', () => {
  const h = harness(above(10, 45, 30_000_000));
  const anti = { lon: -170, lat: -45, entities: [{ show: true }] };
  h.culler.set([anti]);
  assert.equal(anti.entities[0].show, false);
});

test('moving the camera around the globe flips what is visible', () => {
  const h = harness(above(10, 45, 5_000_000));
  const eu = europe();
  const au = australia();
  h.culler.set([eu, au]);
  Cesium.Cartesian3.clone(above(135, -25, 5_000_000), h.viewer.camera.positionWC);
  h.frame();
  assert.equal(eu.entities[0].show, false);
  assert.equal(au.entities[0].show, true);
});

test('a repaint is requested only when something actually flipped', () => {
  const h = harness(above(10, 45, 5_000_000));
  h.culler.set([europe(), australia()]);
  const afterSet = h.renders;
  assert.ok(afterSet >= 1, 'setting hid one, which needs a repaint');
  Cesium.Cartesian3.clone(above(10.5, 45.2, 5_000_000), h.viewer.camera.positionWC);
  h.frame();
  assert.equal(h.renders, afterSet, 'nothing crossed the horizon');
  Cesium.Cartesian3.clone(above(135, -25, 5_000_000), h.viewer.camera.positionWC);
  h.frame();
  assert.equal(h.renders, afterSet + 1);
});

test('a sub-kilometre camera move does not re-evaluate anything', () => {
  const camera = above(10, 45, 5_000_000);
  const h = harness(camera);
  const eu = europe();
  h.culler.set([eu]);
  // Tamper with visibility by hand; an unchanged camera must leave it alone.
  eu.entities[0].show = 'sentinel';
  Cesium.Cartesian3.clone(camera, h.viewer.camera.positionWC);
  h.frame();
  assert.equal(eu.entities[0].show, 'sentinel');
  h.culler.refresh();
  assert.equal(eu.entities[0].show, true, 'refresh forces the test');
});

test('a whole set is toggled together', () => {
  const h = harness(above(10, 45, 5_000_000));
  const both = { lon: 135, lat: -25, entities: [{ show: true }, { show: true }] };
  h.culler.set([both]);
  assert.deepEqual(
    both.entities.map((e) => e.show),
    [false, false],
  );
});

test('it only listens while there is something to track', () => {
  const h = harness(above(10, 45, 5_000_000));
  assert.equal(h.listeners.size, 0);
  h.culler.set([europe()]);
  assert.equal(h.listeners.size, 1);
  h.culler.set([europe(), australia()]);
  assert.equal(h.listeners.size, 1, 'replacing the set does not add a second listener');
  h.culler.set([]);
  assert.equal(h.listeners.size, 0);
  h.culler.set([europe()]);
  h.culler.clear();
  assert.equal(h.listeners.size, 0);
  h.culler.set([europe()]);
  h.culler.destroy();
  assert.equal(h.listeners.size, 0);
});

test('a missing camera is harmless', () => {
  const culler = createHorizonCuller({
    viewer: { camera: null, scene: { preRender: { addEventListener: () => () => {} } } },
  });
  assert.doesNotThrow(() => culler.set([europe()]));
});
