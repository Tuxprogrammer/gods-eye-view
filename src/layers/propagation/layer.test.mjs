import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropagationLayer } from './index.js';
import { createPropagationSource } from './source.js';

function map(field, generatedAt = 1_000_000) {
  return {
    field,
    label: field === 'muf' ? 'MUF (3000 km)' : 'foF2',
    unit: 'MHz',
    generatedAt,
    stale: false,
    southUp: true,
    range: { min: 4, max: 35 },
    ticks: [{ position: 0.5, label: '10' }],
    heatmap: 'h',
    colorbar: 'c',
  };
}

function overlaySurface() {
  return {
    shows: [],
    clears: 0,
    classification: [],
    destroyed: false,
    show(...args) {
      this.shows.push(args);
    },
    clear() {
      this.clears++;
    },
    setClassification(value) {
      this.classification.push(value);
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

function harness({ hidden = false } = {}) {
  const calls = [];
  const contourCalls = [];
  const stationCalls = [];
  const contourSurface = overlaySurface();
  const stationSurface = overlaySurface();
  const interaction = {
    refreshes: 0,
    hides: 0,
    destroyed: false,
    refresh() {
      this.refreshes++;
    },
    hide() {
      this.hides++;
    },
    destroy() {
      this.destroyed = true;
    },
  };
  const surface = {
    shows: [],
    opacity: [],
    clears: 0,
    destroyed: false,
    classification: [],
    show(prepared, opacity) {
      this.shows.push({ prepared, opacity });
    },
    setOpacity(value) {
      this.opacity.push(value);
    },
    setClassification(value) {
      this.classification.push(value);
    },
    clear() {
      this.clears++;
    },
    destroy() {
      this.destroyed = true;
    },
  };
  const state = {
    generatedAt: 1_000_000,
    fail: false,
    hold: null,
    contoursFail: false,
    stationsFail: false,
  };
  const source = {
    async getMap(field, { signal }) {
      calls.push(field);
      if (state.hold) await state.hold;
      signal.throwIfAborted();
      if (state.fail) throw new Error('offline');
      return map(field, state.generatedAt);
    },
    async getContours(field, { signal }) {
      contourCalls.push(field);
      signal.throwIfAborted();
      if (state.contoursFail) throw new Error('contours offline');
      return {
        field,
        generatedAt: state.generatedAt,
        stale: false,
        lines: [
          { value: 10, label: '10', color: null, positions: [0, 0, 1, 1] },
          { value: 14, label: '14', color: null, positions: [2, 2, 3, 3] },
        ],
      };
    },
    async getStations({ signal }) {
      stationCalls.push('stations');
      signal.throwIfAborted();
      if (state.stationsFail) throw new Error('stations offline');
      return {
        generatedAt: state.generatedAt,
        stale: false,
        stations: [
          {
            code: 'AU930',
            name: 'Austin',
            lat: 30.4,
            lon: -97.7,
            time: 1_000_000,
            fof2: 8.6,
            mufd: 28.8,
            hmf2: 241,
            confidence: 75,
            source: 'giro',
          },
          {
            code: 'MUFONLY',
            name: 'Only MUF',
            lat: 10,
            lon: 10,
            time: 1_000_000,
            fof2: null,
            mufd: 20,
            hmf2: null,
            confidence: null,
            source: 'giro',
          },
        ],
      };
    },
  };
  const listeners = new Map();
  const visibilityTarget = {
    hidden,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  const stackListeners = new Map();
  const stackTarget = {
    addEventListener: (type, fn) => stackListeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (stackListeners.get(type) === fn) stackListeners.delete(type);
    },
  };
  // Shortly after the map was generated, so it reads as current.
  const clock = { t: 1_060_000 };
  const layer = createPropagationLayer({
    source,
    visibilityTarget,
    mapStackEventTarget: stackTarget,
    now: () => clock.t,
    prepare: async (payload) => ({
      canvas: { payload },
      gradient: 'grad',
      stops: [
        [0, 0, 0],
        [255, 255, 255],
      ],
    }),
    createSurface: () => surface,
    createContourSurface: () => contourSurface,
    createStationSurface: () => stationSurface,
    createStationInteraction: () => interaction,
  });
  const viewer = { scene: { globe: { show: false } } };
  return {
    layer,
    surface,
    contourSurface,
    stationSurface,
    interaction,
    contourCalls,
    stationCalls,
    calls,
    state,
    clock,
    visibilityTarget,
    listeners,
    stackListeners,
    viewer,
  };
}

test('nothing is requested until the layer is enabled and asked to update', () => {
  const { layer, calls, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(calls.length, 0);
});

test('an update fetches the default map once and shows it', async () => {
  const { layer, calls, surface, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(await layer.update(viewer), true);
  assert.deepEqual(calls, ['muf']);
  assert.equal(surface.shows.length, 1);
  assert.equal(surface.shows[0].opacity, 0.6);
  const stats = layer.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.countLabel, 'MUF 3000');
  assert.equal(stats.lastUpdate, 1_000_000);
  assert.equal(stats.stale, false);
});

test('a hidden page does not fetch, then catches up once when shown', async () => {
  const { layer, calls, visibilityTarget, listeners, viewer } = harness({
    hidden: true,
  });
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(await layer.update(viewer), true);
  assert.equal(calls.length, 0);
  visibilityTarget.hidden = false;
  listeners.get('visibilitychange')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['muf']);
});

test('returning to a visible page does not refetch a fresh map', async () => {
  const { layer, calls, listeners, viewer, clock } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  clock.t += 60_000;
  listeners.get('visibilitychange')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  clock.t += 6 * 60_000;
  listeners.get('visibilitychange')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
});

test('disabling stops requests, releases the map and detaches listeners', async () => {
  const { layer, calls, surface, listeners, stackListeners, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  assert.ok(listeners.has('visibilitychange'));
  assert.ok(stackListeners.has('gev:map-stack-changed'));
  layer.disable(viewer);
  assert.equal(listeners.size, 0);
  assert.equal(stackListeners.size, 0);
  assert.ok(surface.clears >= 1);
  assert.equal(layer.getStats().count, 0);
  assert.equal(await layer.update(viewer), false);
  assert.equal(calls.length, 1);
});

test('turning off mid-request discards the late answer', async () => {
  const { layer, surface, state, viewer } = harness();
  let release;
  state.hold = new Promise((resolve) => {
    release = resolve;
  });
  layer.init(viewer);
  layer.enable(viewer);
  const pending = layer.update(viewer);
  layer.disable(viewer);
  release();
  await pending;
  assert.equal(surface.shows.length, 0);
});

test('selecting the other map is exclusive and fetches it', async () => {
  const { layer, calls, surface, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  const before = surface.clears;
  layer.getRowControls().chips.find((chip) => chip.id === 'field-fof2').onClick();
  assert.equal(surface.clears, before + 1, 'old map is removed at once');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['muf', 'fof2']);
  const chips = layer
    .getRowControls()
    .chips.filter((chip) => chip.id.startsWith('field-'));
  assert.deepEqual(
    chips.map((chip) => [chip.label, chip.active]),
    [
      ['MUF 3000', false],
      ['foF2', true],
    ],
  );
  assert.equal(surface.shows.at(-1).prepared.canvas.payload.field, 'fof2');
});

test('switching back shows the held map immediately', async () => {
  const { layer, surface, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  const controls = () => layer.getRowControls().chips;
  controls()[1].onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const shown = surface.shows.length;
  controls()[0].onClick();
  assert.equal(surface.shows.length, shown + 1, 'no wait for the network');
  assert.equal(surface.shows.at(-1).prepared.canvas.payload.field, 'muf');
});

test('the same map again is not decoded or redrawn', async () => {
  const { layer, surface, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  await layer.update(viewer);
  assert.equal(surface.shows.length, 1);
});

test('a newer map replaces the drawn one', async () => {
  const { layer, surface, state, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  state.generatedAt += 900_000;
  await layer.update(viewer);
  assert.equal(surface.shows.length, 2);
  assert.equal(layer.getStats().lastUpdate, 1_900_000);
});

test('opacity is remembered per map and applied live', async () => {
  const { layer, surface, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  const slider = () => layer.getRowControls().sliders[0];
  assert.equal(slider().value, 60);
  slider().onInput(90);
  assert.deepEqual(surface.opacity, [0.9]);
  assert.equal(slider().value, 90);
  layer.getRowControls().chips[1].onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slider().value, 60, 'the other map keeps its own setting');
  assert.equal(surface.shows.at(-1).opacity, 0.6);
  layer.getRowControls().chips[0].onClick();
  assert.equal(surface.shows.at(-1).opacity, 0.9);
});

test('the colour scale appears only once a map is held, for the active map', async () => {
  const { layer, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(layer.getRowControls().ramp, null);
  await layer.update(viewer);
  const { ramp } = layer.getRowControls();
  assert.equal(ramp.gradient, 'grad');
  assert.equal(ramp.caption, 'MUF (3000 km) · MHz · 4–35 (log)');
  assert.deepEqual(ramp.ticks, [{ position: 0.5, label: '10' }]);
});

test('a failure with nothing to show is unavailable and reported to the manager', async () => {
  const { layer, state, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  state.fail = true;
  assert.equal(await layer.update(viewer), false);
  const stats = layer.getStats();
  assert.equal(stats.status, 'unavailable');
  assert.equal(stats.error, 'offline');
});

test('a failure after a good map keeps showing it, marked stale when old', async () => {
  const { layer, surface, state, clock, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  state.fail = true;
  assert.equal(await layer.update(viewer), false);
  assert.equal(layer.getStats().status, 'ok');
  assert.equal(layer.getStats().stale, false);
  clock.t += 60 * 60_000;
  assert.equal(layer.getStats().stale, true);
  assert.equal(surface.clears, 0, 'the map stays on screen');
});

test('the classification follows the map-stack regime', () => {
  const { layer, surface, stackListeners, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  const listener = stackListeners.get('gev:map-stack-changed');
  listener({ detail: { activeId: 'photoreal' } });
  listener({ detail: { activeId: 'esri-imagery' } });
  assert.equal(surface.classification.length, 2);
  assert.notEqual(surface.classification[0], undefined);
});

test('destroy releases the surface', () => {
  const { layer, surface, viewer } = harness();
  layer.init(viewer);
  layer.destroy(viewer);
  assert.equal(surface.destroyed, true);
});

test('the source asks only the same-origin endpoint and validates the answer', async () => {
  const urls = [];
  const good = {
    ...map('muf'),
    generatedAt: '2026-09-20T02:55:53.000Z',
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    scale: 'log',
    heatmap: 'AAAAAAAAAAAAAAAAAAAA',
    colorbar: 'BBBBBBBBBBBBBBBBBBBB',
  };
  const source = createPropagationSource({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(good), { status: 200 });
    },
  });
  const result = await source.getMap('muf', {});
  assert.deepEqual(urls, ['/api/propagation/muf']);
  assert.equal(result.field, 'muf');
  await assert.rejects(() => source.getMap('nope', {}), /Unknown propagation map/);
  const failing = createPropagationSource({
    fetchImpl: async () => new Response('{}', { status: 502 }),
  });
  await assert.rejects(() => failing.getMap('fof2', {}), /HTTP 502/);
});

// ---- contour rings and station bubbles ----

const tick = () => new Promise((resolve) => setImmediate(resolve));
const chipById = (layer, id) =>
  layer.getRowControls().chips.find((chip) => chip.id === id);

test('rings and stations are fetched with the map, once each, and drawn', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer), true);
  assert.deepEqual(h.contourCalls, ['muf']);
  assert.deepEqual(h.stationCalls, ['stations']);
  assert.equal(h.contourSurface.shows.length, 1);
  assert.equal(h.contourSurface.shows[0][0].lines.length, 2);
  const [stations, scale] = h.stationSurface.shows[0];
  assert.deepEqual(
    stations.map((s) => s.code).sort(),
    ['AU930', 'MUFONLY'],
  );
  assert.equal(scale.field, 'muf');
  assert.equal(scale.unit, 'MHz');
  assert.deepEqual(scale.range, { min: 4, max: 35 });
  assert.equal(scale.stops.length, 2, 'bubbles use the map colour scale');
});

test('the overlay toggles report what they hold', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(chipById(h.layer, 'toggle-contours').active, true);
  assert.equal(chipById(h.layer, 'toggle-contours').breakBefore, true);
  await h.layer.update(h.viewer);
  assert.match(chipById(h.layer, 'toggle-contours').title, /2 contour lines/);
  assert.match(chipById(h.layer, 'toggle-stations').title, /2 ionosondes/);
  assert.equal(chipById(h.layer, 'toggle-contours').state, 'active');
});

test('switching rings off clears them, drops the data and stops fetching them', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  const cleared = h.contourSurface.clears;
  chipById(h.layer, 'toggle-contours').onClick();
  assert.equal(h.contourSurface.clears, cleared + 1);
  assert.equal(chipById(h.layer, 'toggle-contours').active, false);
  await h.layer.update(h.viewer);
  await h.layer.update(h.viewer);
  assert.equal(h.contourCalls.length, 1, 'an off overlay is never requested');
  assert.equal(h.stationCalls.length, 3, 'the other overlay carries on');
  chipById(h.layer, 'toggle-contours').onClick();
  await tick();
  assert.equal(h.contourCalls.length, 2, 'turning it on asks for it again');
  assert.equal(h.contourSurface.shows.length, 2);
});

test('with both overlays off only the map is requested', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  chipById(h.layer, 'toggle-contours').onClick();
  chipById(h.layer, 'toggle-stations').onClick();
  await h.layer.update(h.viewer);
  assert.deepEqual(h.calls, ['muf']);
  assert.equal(h.contourCalls.length, 0);
  assert.equal(h.stationCalls.length, 0);
  assert.equal(h.stationSurface.shows.length, 0);
});

test('an overlay failing never fails the layer or the other overlay', async () => {
  const h = harness();
  h.state.contoursFail = true;
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer), true, 'the map still succeeds');
  assert.equal(h.surface.shows.length, 1);
  assert.equal(h.stationSurface.shows.length, 1);
  assert.equal(h.layer.getStats().status, 'ok');
  const rings = chipById(h.layer, 'toggle-contours');
  assert.equal(rings.state, 'error');
  assert.match(rings.title, /contours offline/);
  h.state.contoursFail = false;
  await h.layer.update(h.viewer);
  assert.equal(chipById(h.layer, 'toggle-contours').state, 'active');
});

test('a station outage after a good load keeps the bubbles on screen', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  const clearsBefore = h.stationSurface.clears;
  const showsBefore = h.stationSurface.shows.length;
  h.state.stationsFail = true;
  await h.layer.update(h.viewer);
  assert.equal(chipById(h.layer, 'toggle-stations').state, 'active');
  assert.equal(h.stationSurface.clears, clearsBefore, 'nothing is removed');
  assert.equal(h.stationSurface.shows.length, showsBefore, 'nothing is redrawn');
});

test('switching maps refetches rings and recolours the bubbles for that quantity', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  const ringClears = h.contourSurface.clears;
  chipById(h.layer, 'field-fof2').onClick();
  assert.equal(
    h.contourSurface.clears,
    ringClears + 1,
    "the other map's rings are removed at once",
  );
  await tick();
  await tick();
  assert.deepEqual(h.contourCalls, ['muf', 'fof2']);
  const [stations, scale] = h.stationSurface.shows.at(-1);
  assert.equal(scale.field, 'fof2');
  assert.deepEqual(
    stations.map((s) => s.code),
    ['AU930'],
    'a station with no foF2 reading is not shown on the foF2 map',
  );
});

test('a page that is hidden fetches no overlays either, then catches up once', async () => {
  const h = harness({ hidden: true });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  assert.equal(h.contourCalls.length + h.stationCalls.length, 0);
  h.visibilityTarget.hidden = false;
  h.listeners.get('visibilitychange')();
  await tick();
  await tick();
  assert.deepEqual(h.contourCalls, ['muf']);
  assert.deepEqual(h.stationCalls, ['stations']);
});

test('the same overlays again are not redrawn', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  await h.layer.update(h.viewer);
  assert.equal(h.contourSurface.shows.length, 1);
  assert.equal(h.stationSurface.shows.length, 1);
});

test('disabling releases both overlays and their data', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  const before = [h.contourSurface.clears, h.stationSurface.clears];
  h.layer.disable(h.viewer);
  assert.ok(h.contourSurface.clears > before[0]);
  assert.ok(h.stationSurface.clears > before[1]);
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(h.contourCalls.length, 1);
  assert.equal(h.stationCalls.length, 1);
  // Held data is gone: the row reports nothing loaded.
  assert.match(chipById(h.layer, 'toggle-contours').title, /Loading|contour/);
});

test('a map-stack change retargets the rings as well as the heatmap', () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  h.stackListeners.get('gev:map-stack-changed')({
    detail: { activeId: 'photoreal' },
  });
  assert.equal(h.contourSurface.classification.length, 1);
  assert.equal(h.surface.classification.length, 1);
});

test('destroy releases the overlay surfaces', () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.destroy(h.viewer);
  assert.equal(h.contourSurface.destroyed, true);
  assert.equal(h.stationSurface.destroyed, true);
});

test('the source asks the same-origin overlay endpoints and validates them', async () => {
  const urls = [];
  const responses = {
    '/api/propagation/muf/contours': {
      field: 'muf',
      generatedAt: '2026-09-20T02:55:53.000Z',
      lines: [{ value: 10.1, label: '10.1', color: '#005767', positions: [0, 0, 1, 1] }],
    },
    '/api/propagation/stations': {
      generatedAt: '2026-09-20T02:55:53.000Z',
      stations: [
        { code: 'AU930', name: 'Austin', lat: 30.4, lon: -97.7, time: 1, fof2: 8, mufd: 28 },
        { junk: true },
      ],
    },
  };
  const source = createPropagationSource({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(responses[url] ?? {}), { status: 200 });
    },
  });
  const contours = await source.getContours('muf', {});
  assert.equal(contours.lines.length, 1);
  const stations = await source.getStations({});
  assert.equal(stations.stations.length, 1, 'a malformed row is dropped');
  assert.deepEqual(urls, [
    '/api/propagation/muf/contours',
    '/api/propagation/stations',
  ]);
  await assert.rejects(() => source.getContours('nope', {}), /Unknown propagation map/);
  const bad = createPropagationSource({
    fetchImpl: async () => new Response(JSON.stringify({ field: 'fof2' }), { status: 200 }),
  });
  await assert.rejects(() => bad.getContours('muf', {}), /Malformed/);
  await assert.rejects(() => bad.getStations({}), /Malformed/);
});

// ---- station interaction wiring ----

test('the details card is refreshed whenever the bubbles change', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  const afterFirst = h.interaction.refreshes;
  assert.ok(afterFirst >= 1, 'a pinned card must see fresh numbers');
  chipById(h.layer, 'field-fof2').onClick();
  await tick();
  await tick();
  assert.ok(h.interaction.refreshes > afterFirst, 'a map switch changes the bubbles');
});

test('turning the layer off closes any open details card', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  const hides = h.interaction.hides;
  h.layer.disable(h.viewer);
  assert.ok(h.interaction.hides > hides);
});

test('switching stations off closes the card via the emptied bubble set', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  const before = h.interaction.refreshes;
  chipById(h.layer, 'toggle-stations').onClick();
  assert.ok(h.interaction.refreshes > before, 'refresh lets it drop a pin');
});

test('destroy tears the interaction down', () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.destroy(h.viewer);
  assert.equal(h.interaction.destroyed, true);
});
