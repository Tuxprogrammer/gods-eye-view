import assert from 'node:assert/strict';
import test from 'node:test';
import { fromDegrees } from '../../geo/ellipsoid.js';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';
import {
  HEATMAP_DRAPE_BELOW_M,
  HEATMAP_SHELL_ABOVE_M,
  PROPAGATION_CONTOUR_LABEL_SOURCE_ID,
  PROPAGATION_STATION_LABEL_SOURCE_ID,
  STATION_ID_PREFIX,
  createContourSurface,
  createHeatmapSurface,
  createStationSurface,
} from './rendering.js';

/** A canvas double that records what is drawn on it. */
function fakeCanvas(width, height) {
  const draws = [];
  const context = {
    globalAlpha: 1,
    clearRect() {
      draws.length = 0;
    },
    drawImage(...args) {
      draws.push({ alpha: context.globalAlpha, args });
    },
  };
  return { width, height, draws, getContext: () => context };
}

/** A scene with a fake draw port, a camera over Europe and a frame port. */
function scene() {
  const viewer = {};
  const renders = [];
  const preRender = new Set();
  const camera = { position: fromDegrees(10, 45, 2_000_000) };
  const { draw } = bindFakeDraw(viewer, {
    camera: { pose: () => ({ position: camera.position }) },
    frame: {
      on(_phase, fn) {
        preRender.add(fn);
        return () => preRender.delete(fn);
      },
      requestRender: (reason) => renders.push(reason),
    },
  });
  return { viewer, draw, renders, camera, preRender };
}

function overlayHost() {
  const sources = new Map();
  const visible = new Map();
  return {
    sources,
    visible,
    setEntries: (id, entries, options) => sources.set(id, { entries, options }),
    setVisible: (id, on) => visible.set(id, on),
    clearSource: (id) => sources.delete(id),
  };
}

const prepared = () => ({ canvas: fakeCanvas(360, 180) });

test('the heatmap drapes one image-filled rectangle per tile', () => {
  const s = scene();
  const surface = createHeatmapSurface({
    viewer: s.viewer,
    classificationType: 'terrain',
    makeCanvas: fakeCanvas,
  });
  const set = s.draw.find('propagation:heatmap');
  assert.equal(set.kind, 'shapes');
  assert.equal(set.show, false, 'nothing shows before a map');
  surface.show(prepared(), 0.6);
  assert.equal(set.show, true);
  assert.equal(set.items.size, surface.tileCount);
  assert.equal(surface.tileCount, 18, '60° tiles over the globe');
  for (const item of set.items.values()) {
    assert.equal(item.geometry.kind, 'rectangle');
    assert.equal(item.height, 'clampGround');
    assert.equal(item.clampTo, 'terrain');
    assert.equal(item.pickable, false);
    assert.ok(item.fill.image.canvas.draws.length, 'its tile is painted');
  }
  const first = set.items.get('propagation-heatmap:0');
  assert.deepEqual(first.geometry.rect, {
    west: -180,
    south: -89.999,
    east: -120,
    north: -30,
  });
  assert.equal(first.fill.image.canvas.draws[0].alpha, 0.6);
  assert.ok(s.renders.length > 0);
});

test('a new opacity repaints the tiles under new keys', () => {
  const s = scene();
  const surface = createHeatmapSurface({
    viewer: s.viewer,
    classificationType: 'terrain',
    makeCanvas: fakeCanvas,
  });
  surface.show(prepared(), 0.6);
  const set = s.draw.find('propagation:heatmap');
  const before = set.items.get('propagation-heatmap:0').fill.image.key;
  surface.setOpacity(0.9);
  const after = set.items.get('propagation-heatmap:0');
  assert.notEqual(after.fill.image.key, before, 'the renderer loads it again');
  assert.equal(after.fill.image.canvas.draws.length, 1);
  assert.equal(after.fill.image.canvas.draws[0].alpha, 0.9);
  const writes = set.writes;
  surface.setOpacity(0.9);
  assert.equal(set.writes, writes, 'the same opacity is no work');
});

test('the heatmap follows the surface it drapes onto, and clears', () => {
  const s = scene();
  const surface = createHeatmapSurface({
    viewer: s.viewer,
    classificationType: 'terrain',
    makeCanvas: fakeCanvas,
  });
  surface.show(prepared(), 0.6);
  surface.setClassification('tiles');
  const set = s.draw.find('propagation:heatmap');
  assert.ok([...set.items.values()].every((item) => item.clampTo === 'tiles'));
  surface.setVisible(false);
  assert.equal(set.show, false);
  surface.setVisible(true);
  assert.equal(set.show, true);
  surface.clear();
  assert.equal(set.items.size, 0);
  assert.equal(set.show, false);
  assert.equal(surface.tileCount, 0);
  surface.destroy();
  assert.equal(set.disposed, true);
});

const contours = {
  lines: [
    {
      value: 10,
      label: '10',
      positions: [-40, 0, -20, 0, 0, 0, 20, 0, 40, 0],
    },
  ],
};

test('contour rings are draped lines, their levels overlay labels', () => {
  const s = scene();
  const host = overlayHost();
  const surface = createContourSurface({
    viewer: s.viewer,
    classificationType: 'tiles',
    overlayHost: host,
  });
  surface.show(contours);
  const set = s.draw.find('propagation:contours');
  assert.equal(set.kind, 'lines');
  assert.equal(set.show, true);
  const line = set.items.get('propagation-contour:0');
  assert.equal(line.mode, 'draped');
  assert.equal(line.clampTo, 'tiles');
  assert.equal(line.positions.length, 5);
  assert.equal(surface.lineCount, 1);
  const labels = host.sources.get(PROPAGATION_CONTOUR_LABEL_SOURCE_ID);
  assert.ok(labels.entries.length > 0);
  assert.equal(surface.labelCount, labels.entries.length);
  const [label] = labels.entries;
  assert.equal(label.variant, 'label');
  assert.equal(label.collisionGroup, 'ambient-label');
  assert.equal(label.horizonCull, true);
  assert.equal(label.terrainOcclusion, false);
  assert.equal(label.maxDistance, 30_000_000);
  assert.equal(host.visible.get(PROPAGATION_CONTOUR_LABEL_SOURCE_ID), true);
  surface.setClassification('terrain');
  assert.equal(set.items.get('propagation-contour:0').clampTo, 'terrain');
  surface.clear();
  assert.equal(set.items.size, 0);
  assert.equal(host.sources.has(PROPAGATION_CONTOUR_LABEL_SOURCE_ID), false);
  assert.equal(host.visible.get(PROPAGATION_CONTOUR_LABEL_SOURCE_ID), false);
});

test('without an overlay host the rings are drawn unlabelled', () => {
  const s = scene();
  const surface = createContourSurface({ viewer: s.viewer });
  assert.doesNotThrow(() => surface.show(contours));
  assert.equal(surface.lineCount, 1);
});

const stations = [
  { code: 'DB049', name: 'Dourbes', lon: 4.6, lat: 50.1, mufd: 20 },
  { code: 'WP937', name: 'Wallops', lon: -75.5, lat: 37.9, mufd: 25 },
  { code: 'NONE', name: 'No reading', lon: 0, lat: 0, mufd: null },
];
const stationScale = {
  field: 'muf',
  unit: 'MHz',
  stops: [
    [0, 0, 255],
    [255, 0, 0],
  ],
  range: { min: 4, max: 35 },
};

test('station bubbles are points coloured on the scale, readings overlay labels', () => {
  const s = scene();
  const host = overlayHost();
  const surface = createStationSurface({ viewer: s.viewer, overlayHost: host });
  surface.show(stations, stationScale);
  const set = s.draw.find('propagation:stations');
  assert.equal(set.kind, 'points');
  assert.equal(surface.count, 2, 'a station without a reading is left out');
  const bubble = set.items.get(`${STATION_ID_PREFIX}DB049`);
  assert.equal(bubble.height, 'clampGround');
  assert.equal(bubble.disableDepthTest, Number.POSITIVE_INFINITY);
  assert.match(bubble.color, /^rgb\(/);
  const labels = host.sources.get(PROPAGATION_STATION_LABEL_SOURCE_ID);
  assert.equal(labels.entries.length, 2);
  assert.equal(labels.entries[0].placement, 'above');
  assert.equal(labels.entries[0].maxDistance, 7_000_000);
  assert.equal(labels.entries[0].accent, bubble.color);
});

test('a bubble over the horizon is hidden, and its card says so', () => {
  const s = scene();
  const surface = createStationSurface({ viewer: s.viewer });
  surface.show(stations, stationScale);
  const set = s.draw.find('propagation:stations');
  // From over Europe, Wallops (Virginia) is beyond the limb.
  assert.equal(set.items.get(`${STATION_ID_PREFIX}DB049`).show, true);
  assert.equal(set.items.get(`${STATION_ID_PREFIX}WP937`).show, false);
  assert.equal(surface.detailsFor('DB049').visible, true);
  assert.equal(surface.detailsFor('WP937').visible, false);
  // The camera moves over Virginia: both flip, written live.
  s.camera.position = fromDegrees(-75, 38, 2_000_000);
  for (const fn of [...s.preRender]) fn();
  assert.equal(set.items.get(`${STATION_ID_PREFIX}DB049`).show, false);
  assert.equal(set.items.get(`${STATION_ID_PREFIX}WP937`).show, true);
  assert.equal(surface.detailsFor('WP937').visible, true);
});

test('station details carry the rows and the place to project', () => {
  const s = scene();
  const surface = createStationSurface({ viewer: s.viewer });
  surface.show(stations, stationScale);
  const details = surface.detailsFor('DB049', 0);
  assert.equal(details.name, 'Dourbes');
  assert.ok(details.rows.length > 0);
  assert.deepEqual(details.position, fromDegrees(4.6, 50.1));
  assert.equal(surface.detailsFor('NONE'), null);
});

test('clearing and destroying the stations release the set and the labels', () => {
  const s = scene();
  const host = overlayHost();
  const surface = createStationSurface({ viewer: s.viewer, overlayHost: host });
  surface.show(stations, stationScale);
  surface.clear();
  const set = s.draw.find('propagation:stations');
  assert.equal(set.items.size, 0);
  assert.equal(set.show, false);
  assert.equal(surface.count, 0);
  assert.equal(host.sources.has(PROPAGATION_STATION_LABEL_SOURCE_ID), false);
  assert.equal(s.preRender.size, 0, 'nothing is culled with nothing drawn');
  surface.destroy();
  assert.equal(set.disposed, true);
});

test('from high up the heatmap is a raster shell, draped again closer in', () => {
  const viewer = {};
  const moves = new Set();
  let height = 6_000_000;
  const { draw } = bindFakeDraw(viewer, {
    camera: {
      pose: () => ({ height }),
      on(event, fn) {
        assert.equal(event, 'changed');
        moves.add(fn);
        return () => moves.delete(fn);
      },
    },
    frame: { on: () => () => {}, requestRender() {} },
  });
  const fields = [];
  draw.field = (spec) => {
    const field = {
      spec: { ...spec },
      show: true,
      disposed: false,
      update(patch) {
        Object.assign(field.spec, patch);
      },
      dispose() {
        field.disposed = true;
      },
    };
    fields.push(field);
    return field;
  };
  const moveTo = (next) => {
    height = next;
    for (const fn of [...moves]) fn();
  };
  const surface = createHeatmapSurface({
    viewer,
    classificationType: 'tiles',
    makeCanvas: fakeCanvas,
  });
  const shapes = draw.find('propagation:heatmap');
  const map = prepared();
  surface.show(map, 0.6);
  assert.equal(surface.mode, 'shell');
  assert.equal(fields.length, 1);
  const [shell] = fields;
  assert.equal(shell.spec.kind, 'rasterShell');
  assert.equal(shell.spec.image.canvas, map.canvas);
  assert.deepEqual(shell.spec.rectangle, {
    west: -180,
    south: -90,
    east: 180,
    north: 90,
  });
  assert.equal(shell.spec.alpha, 0.6);
  assert.equal(shell.show, true);
  assert.equal(shapes.show, false, 'the draped tiles wait underneath');

  // The shell fades through its own alpha.
  surface.setOpacity(0.3);
  assert.equal(shell.spec.alpha, 0.3);

  // Between the two heights nothing switches; below the lower one it drapes.
  moveTo(HEATMAP_DRAPE_BELOW_M + 1);
  assert.equal(surface.mode, 'shell');
  moveTo(HEATMAP_DRAPE_BELOW_M - 1);
  assert.equal(surface.mode, 'drape');
  assert.equal(shell.show, false);
  assert.equal(shapes.show, true);
  moveTo(HEATMAP_SHELL_ABOVE_M - 1);
  assert.equal(surface.mode, 'drape');
  moveTo(HEATMAP_SHELL_ABOVE_M + 1);
  assert.equal(surface.mode, 'shell');
  assert.equal(shell.show, true);

  // A new map re-images the same shell; hiding hides both.
  const next = prepared();
  surface.show(next, 0.3);
  assert.equal(fields.length, 1);
  assert.equal(shell.spec.image.canvas, next.canvas);
  surface.setVisible(false);
  assert.equal(shell.show, false);
  assert.equal(shapes.show, false);

  surface.destroy();
  assert.equal(shell.disposed, true);
  assert.equal(moves.size, 0, 'the camera listener goes with it');
});
