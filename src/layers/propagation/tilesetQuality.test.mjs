import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createPropagationLayer } from './index.js';
import {
  HEATMAP_TILESET_MAX_SSE,
  createTilesetQualityGuard,
} from './tilesetQuality.js';

function fakeTileset({ dynamic = true, sse = 16 } = {}) {
  const tileset = Object.create(Cesium.Cesium3DTileset.prototype);
  Object.defineProperties(tileset, {
    dynamicScreenSpaceError: { value: dynamic, writable: true },
    maximumScreenSpaceError: { value: sse, writable: true },
    destroyed: { value: false, writable: true },
    isDestroyed: { value() {
      return this.destroyed;
    } },
  });
  return tileset;
}

function fakeScene(primitives) {
  let renders = 0;
  return {
    primitives: { length: primitives.length, get: (i) => primitives[i] },
    requestRender: () => renders++,
    get renders() {
      return renders;
    },
  };
}

test('tightens every tileset and restores exactly what it found', () => {
  const google = fakeTileset();
  const other = fakeTileset({ dynamic: false, sse: 24 });
  const scene = fakeScene([{ notATileset: true }, google, other]);
  const guard = createTilesetQualityGuard({ scene });
  assert.equal(guard.apply(), 2);
  assert.equal(google.dynamicScreenSpaceError, false);
  assert.equal(google.maximumScreenSpaceError, HEATMAP_TILESET_MAX_SSE);
  assert.equal(other.maximumScreenSpaceError, HEATMAP_TILESET_MAX_SSE);
  assert.equal(guard.active, 2);
  guard.restore();
  assert.equal(google.dynamicScreenSpaceError, true);
  assert.equal(google.maximumScreenSpaceError, 16);
  assert.equal(other.dynamicScreenSpaceError, false);
  assert.equal(other.maximumScreenSpaceError, 24);
  assert.equal(guard.active, 0);
});

test('repeated apply never records its own values as the originals', () => {
  const tileset = fakeTileset();
  const guard = createTilesetQualityGuard({ scene: fakeScene([tileset]) });
  guard.apply();
  guard.apply();
  guard.apply();
  guard.restore();
  assert.equal(tileset.dynamicScreenSpaceError, true);
  assert.equal(tileset.maximumScreenSpaceError, 16);
});

test('a tileset that is already finer is never coarsened', () => {
  const tileset = fakeTileset({ sse: 2 });
  const guard = createTilesetQualityGuard({ scene: fakeScene([tileset]) });
  guard.apply();
  assert.equal(tileset.maximumScreenSpaceError, 2);
  guard.restore();
  assert.equal(tileset.maximumScreenSpaceError, 2);
});

test('a destroyed tileset is skipped on restore, and the scene re-renders', () => {
  const tileset = fakeTileset();
  const scene = fakeScene([tileset]);
  const guard = createTilesetQualityGuard({ scene });
  guard.apply();
  tileset.destroyed = true;
  tileset.dynamicScreenSpaceError = 'untouched';
  guard.restore();
  assert.equal(tileset.dynamicScreenSpaceError, 'untouched');
  assert.equal(scene.renders, 2);
});

test('an empty or missing scene is harmless', () => {
  assert.equal(createTilesetQualityGuard({ scene: fakeScene([]) }).apply(), 0);
  assert.equal(createTilesetQualityGuard({ scene: {} }).apply(), 0);
  assert.doesNotThrow(() => createTilesetQualityGuard({ scene: null }).restore());
});

function event() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    fire() {
      for (const fn of [...listeners]) fn();
    },
  };
}

function policyHarness({ height = 400, globeShown = false } = {}) {
  const calls = [];
  const guard = {
    active: false,
    apply() {
      this.active = true;
      calls.push('apply');
    },
    restore() {
      this.active = false;
      calls.push('restore');
    },
  };
  const camera = {
    positionCartographic: { height },
    changed: event(),
    moveEnd: event(),
  };
  const scene = { globe: { show: globeShown } };
  const stack = new EventTarget();
  const layer = createPropagationLayer({
    source: {
      getMap: async () => new Promise(() => {}),
      getContours: async () => new Promise(() => {}),
      getStations: async () => new Promise(() => {}),
    },
    mapStackEventTarget: stack,
    visibilityTarget: null,
    prepare: async () => ({ canvas: {}, gradient: '' }),
    createSurface: () => ({
      show() {},
      clear() {},
      destroy() {},
      setOpacity() {},
      setClassification() {},
    }),
    createContourSurface: () => ({
      show() {},
      clear() {},
      destroy() {},
      setClassification() {},
    }),
    createStationSurface: () => ({ show() {}, clear() {}, destroy() {} }),
    createStationInteraction: () => ({
      refresh() {},
      hide() {},
      destroy() {},
    }),
    createQualityGuard: () => guard,
  });
  const viewer = { scene, camera };
  return { layer, viewer, camera, scene, stack, calls, guard };
}

const moveTo = ({ camera }, height) => {
  camera.positionCartographic.height = height;
  camera.changed.fire();
};

test('close views keep the app default detail', () => {
  const h = policyHarness({ height: 400 });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(h.guard.active, false);
  assert.equal(h.calls.includes('apply'), false);
});

test('rising above the engage height tightens tiles; hysteresis holds it', () => {
  const h = policyHarness({ height: 400 });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  moveTo(h, 2_000_000);
  assert.equal(h.guard.active, true);
  moveTo(h, 1_200_000);
  assert.equal(h.guard.active, true, 'between the two heights: no flapping');
  moveTo(h, 900_000);
  assert.equal(h.guard.active, false);
  moveTo(h, 1_200_000);
  assert.equal(h.guard.active, false, 'must climb past the engage height again');
});

test('starting already high tightens straight away', () => {
  const h = policyHarness({ height: 18_000_000 });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(h.guard.active, true);
});

test('moveEnd also re-evaluates', () => {
  const h = policyHarness({ height: 400 });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  h.camera.positionCartographic.height = 5_000_000;
  h.camera.moveEnd.fire();
  assert.equal(h.guard.active, true);
});

test('a globe stack never needs the finer tiles', () => {
  const h = policyHarness({ height: 18_000_000, globeShown: true });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(h.guard.active, false, 'terrain classification needs no 3D tiles');
});

test('switching from photoreal to a globe stack releases the tiles', () => {
  const h = policyHarness({ height: 18_000_000 });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(h.guard.active, true);
  h.scene.globe.show = true;
  h.stack.dispatchEvent(
    Object.assign(new Event('gev:map-stack-changed'), {
      detail: { activeId: 'esri-imagery' },
    }),
  );
  assert.equal(h.guard.active, false);
  h.scene.globe.show = false;
  h.stack.dispatchEvent(
    Object.assign(new Event('gev:map-stack-changed'), {
      detail: { activeId: 'photoreal' },
    }),
  );
  assert.equal(h.guard.active, true);
});

test('disabling restores the tileset and stops watching the camera', () => {
  const h = policyHarness({ height: 18_000_000 });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(h.guard.active, true);
  assert.equal(h.camera.changed.listeners.size, 1);
  h.layer.disable(h.viewer);
  assert.equal(h.guard.active, false);
  assert.equal(h.camera.changed.listeners.size, 0);
  assert.equal(h.camera.moveEnd.listeners.size, 0);
  moveTo(h, 20_000_000);
  assert.equal(h.guard.active, false, 'a disabled layer must not touch tiles');
});

test('destroy restores the tileset', () => {
  const h = policyHarness({ height: 18_000_000 });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  h.layer.destroy(h.viewer);
  assert.equal(h.guard.active, false);
  assert.equal(h.camera.changed.listeners.size, 0);
});
