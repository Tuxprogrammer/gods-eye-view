import assert from 'node:assert/strict';
import test from 'node:test';
import { createAprsLayer } from './index.js';
import { clickTarget } from './interaction.js';
import { createAprsSource } from './source.js';
import { aprsRowControls } from './controls.js';
import { createMessagePopups } from './popups.js';
import { defaultSettings } from './model.js';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function station(id, extra = {}) {
  return { id, lat: 34.7, lon: -86.6, symTable: '/', symCode: '>', ...extra };
}

function payload(stations = [station('AA1AAA')], extra = {}) {
  return {
    stations,
    tracks: new Map(),
    total: stations.length,
    truncated: false,
    generatedAt: 1000,
    feed: { status: 'live', packetsPerMinute: 4000, lastPacketAt: 1000 },
    ...extra,
  };
}

/** A viewer just real enough for the layer's own camera reads. */
function fakeViewer() {
  const listeners = [];
  return {
    listeners,
    camera: {
      pickEllipsoid: () => undefined,
      positionCartographic: { latitude: 0.6, longitude: -1.5 },
      moveEnd: {
        addEventListener(fn) {
          listeners.push(fn);
          return () => listeners.splice(listeners.indexOf(fn), 1);
        },
      },
    },
    scene: { canvas: { clientWidth: 100, clientHeight: 100 } },
  };
}

function harness({ getStations, getMessages } = {}) {
  const calls = { stations: [], messages: [], shown: [], popups: [] };
  const timers = [];
  const source = {
    getStations: async (query, options) => {
      calls.stations.push(query);
      return (getStations ?? (() => payload()))(query, options);
    },
    getMessages: async (args) => {
      calls.messages.push(args);
      return (getMessages ?? (() => ({ cursor: 5, messages: [] })))(args);
    },
    getStation: async () => ({ station: station('AA1AAA'), track: [], weather: [], messages: [] }),
  };
  const surface = {
    show: (list, tracks) => calls.shown.push({ list, tracks }),
    clear: () => calls.shown.push('clear'),
    destroy() {},
    setLabels() {},
    setClassification() {},
    categoryCounts: () => ({ mobile: calls.shown.at(-1)?.list?.length ?? 0 }),
    recordFor: () => null,
  };
  const interaction = { refresh() {}, hide() {}, destroy() {} };
  const popups = { show: (m) => calls.popups.push(m), clear() {}, destroy() {} };
  const layer = createAprsLayer({
    source,
    visibilityTarget: null,
    createSurface: () => surface,
    createInteraction: () => interaction,
    createPopups: () => popups,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
    now: () => 1000,
  });
  return { layer, calls, timers };
}

test('nothing is requested until the layer is on, and nothing after it is off', async () => {
  const { layer, calls } = harness();
  layer.init(fakeViewer());
  assert.deepEqual(calls.stations, []);
  layer.enable();
  await wait();
  assert.equal(calls.stations.length, 1);
  layer.disable();
  assert.equal(calls.shown.at(-1), 'clear');
  await layer.update();
  assert.equal(calls.stations.length, 1);
});

test('the first query is centred on the view and uses the default window and radius', async () => {
  const { layer, calls } = harness();
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  const query = new URLSearchParams(calls.stations[0]);
  assert.equal(query.get('radiusKm'), '500');
  assert.equal(query.get('windowMin'), '60');
  assert.ok(Math.abs(Number(query.get('lat')) - 34.377) < 0.01);
  assert.equal(layer.getStats().count, 1);
});

test('changing radius, window or track re-queries after a short debounce', async () => {
  const { layer, calls, timers } = harness();
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  const before = calls.stations.length;
  const controls = layer.getRowControls();
  controls.selects.find((s) => s.id === 'radius').onChange('earth');
  controls.selects.find((s) => s.id === 'window').onChange('1440');
  controls.selects.find((s) => s.id === 'track').onChange('180');
  assert.equal(calls.stations.length, before, 'debounced, not immediate');
  timers.filter((t) => t.ms === 250).at(-1).fn();
  await wait();
  assert.equal(calls.stations.length, before + 1);
  const query = new URLSearchParams(calls.stations.at(-1));
  assert.equal(query.get('radiusKm'), 'earth');
  assert.equal(query.get('windowMin'), '1440');
  assert.equal(query.get('trackMin'), '180');
});

test('a whole-Earth view is only re-queried on pan when the result was capped', async () => {
  const { layer, calls, timers } = harness({
    getStations: () => payload([station('A')], { truncated: false }),
  });
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  layer.getRowControls().selects.find((s) => s.id === 'radius').onChange('earth');
  timers.filter((t) => t.ms === 250).at(-1).fn();
  await wait();
  const before = calls.stations.length;
  timers.filter((t) => t.ms === 700).at(-1)?.fn();
  await wait();
  assert.equal(calls.stations.length, before);
});

test('the toggles change the query and the popup toggle stops message polling', async () => {
  const { layer, calls, timers } = harness();
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  assert.equal(calls.messages.length, 1, 'first poll only learns the cursor');
  assert.equal(calls.messages[0].after, null);
  layer.getRowControls().chips.find((c) => c.id === 'toggle-weather').onClick();
  timers.filter((t) => t.ms === 250).at(-1).fn();
  await wait();
  assert.equal(new URLSearchParams(calls.stations.at(-1)).get('wx'), '1');
  layer.getRowControls().chips.find((c) => c.id === 'toggle-popups').onClick();
  const polls = calls.messages.length;
  for (const timer of timers.filter((t) => t.ms === 5000)) timer.fn();
  await wait();
  assert.equal(calls.messages.length, polls, 'no polling with pop-ups off');
});

test('new messages pop up, an initial backlog never does, and a burst is capped', async () => {
  let response = { cursor: 10, messages: [] };
  const { layer, calls, timers } = harness({ getMessages: () => response });
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  assert.equal(calls.popups.length, 0);
  const message = (id) => ({ id, from: 'A', to: 'B', text: `m${id}`, lat: 1, lon: 2, anchoredTo: 'sender' });
  response = { cursor: 16, messages: [11, 12, 13, 14, 15, 16].map(message) };
  timers.filter((t) => t.ms === 5000).at(-1).fn();
  await wait();
  assert.deepEqual(calls.popups.map((m) => m.id), [14, 15, 16]);
  assert.equal(calls.messages.at(-1).after, 10);
});

test('a failed fetch is reported with the feed reason and clears on recovery', async () => {
  let fail = true;
  const { layer } = harness({
    getStations: () => {
      if (fail) {
        const error = new Error('APRS_CALLSIGN is not set');
        error.feed = { status: 'missing-config', error: 'APRS_CALLSIGN is not set' };
        throw error;
      }
      return payload();
    },
  });
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  const stats = layer.getStats();
  assert.equal(stats.status, 'unavailable');
  assert.match(stats.error, /APRS_CALLSIGN/);
  fail = false;
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().status, 'ok');
  assert.equal(layer.getStats().error, null);
});

test('a capped result is labelled as such', async () => {
  const { layer } = harness({
    getStations: () => payload([station('A')], { total: 9000, truncated: true }),
  });
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  assert.equal(layer.getStats().countLabel, '1 of 9000');
});

test('row controls expose every user setting', () => {
  const controls = aprsRowControls({ settings: defaultSettings(), counts: { weather: 3 } }, { set() {} });
  assert.deepEqual(controls.selects.map((s) => s.id), ['radius', 'window', 'track', 'units']);
  assert.ok(controls.selects[0].options.some((o) => o.value === 'earth'));
  assert.deepEqual(controls.texts.map((t) => t.id), ['call']);
  assert.deepEqual(
    controls.chips.map((c) => c.id),
    ['toggle-weather', 'toggle-moving', 'toggle-objects', 'toggle-labels', 'toggle-popups'],
  );
  assert.deepEqual(controls.legend.map((l) => [l.label, l.count]), [['Weather', 3]]);
});

test('the source reads the same-origin API and surfaces the server reason on failure', async () => {
  const seen = [];
  const source = createAprsSource({
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.includes('stations'))
        return { ok: false, status: 503, json: async () => ({ error: 'APRS storage is starting', feed: { status: 'starting' } }) };
      return { ok: true, status: 200, json: async () => ({ cursor: 3, messages: [] }) };
    },
  });
  await assert.rejects(source.getStations('lat=1'), (error) => {
    assert.equal(error.message, 'APRS storage is starting');
    assert.equal(error.feed.status, 'starting');
    return true;
  });
  await source.getMessages({ after: null, query: 'lat=1&radiusKm=50' });
  await source.getMessages({ after: 7, query: 'lat=1' });
  assert.equal(seen[0], '/api/aprs/stations?lat=1');
  assert.ok(!seen[1].includes('after='), 'no cursor on the first poll');
  assert.ok(seen[2].includes('after=7'));
});

test('message pop-ups fade, expire, follow the sender, cap their number and never parse HTML', () => {
  const nodes = [];
  class Node {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.style = {};
      this.classList = { add: (c) => (this.className += ` ${c}`) };
      this.className = '';
      this.textContent = '';
      this.offsetHeight = 30;
    }
    setAttribute() {}
    append(...kids) {
      this.children.push(...kids);
    }
    appendChild(kid) {
      this.children.push(kid);
      nodes.push(kid);
      return kid;
    }
    remove() {
      this.removed = true;
    }
  }
  const documentRef = { createElement: (tag) => new Node(tag) };
  const timers = [];
  let projected = { x: 100, y: 200 };
  const viewer = {
    container: new Node('div'),
    scene: {
      postRender: { addEventListener: () => () => {} },
      requestRender() {},
    },
  };
  const popups = createMessagePopups({
    viewer,
    surface: { screenPosition: () => projected },
    documentRef,
    maxPopups: 2,
    lifetimeMs: 10_000,
    fadeMs: 1_000,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  const msg = (id, text = 'hello') => ({ id, from: 'A', to: 'B', text, lat: 1, lon: 2, anchoredTo: 'sender' });
  popups.show(msg(1, '<img src=x onerror=alert(1)>'));
  const bubble = viewer.container.children[0].children[0];
  assert.equal(bubble.children[1].textContent, '<img src=x onerror=alert(1)>', 'text is data, not markup');
  assert.deepEqual(timers.map((t) => t.ms), [9000, 10000]);
  assert.match(bubble.style.transform, /translate\(100px, /);
  timers[0].fn();
  assert.match(bubble.className, /fading/);
  timers[1].fn();
  assert.equal(popups.count, 0);
  assert.equal(bubble.removed, true);
  popups.show(msg(2));
  popups.show(msg(3));
  popups.show(msg(4));
  assert.equal(popups.count, 2, 'the oldest bubble makes way');
  projected = undefined;
  popups.show(msg(5));
  const last = viewer.container.children[0].children.at(-1);
  assert.equal(last.style.visibility, 'hidden', 'over the horizon: hidden, still expires');
  popups.destroy();
  assert.equal(popups.count, 0);
});

test('clicking a stack of stations walks through it and wraps; a lone station toggles', () => {
  assert.deepEqual(clickTarget([], 'a'), { action: 'unpin' });
  assert.deepEqual(clickTarget(['a'], null), { action: 'pin', id: 'a', index: 1, count: 1 });
  assert.deepEqual(clickTarget(['a'], 'a'), { action: 'unpin' });
  const stack = ['a', 'b', 'c'];
  assert.deepEqual(clickTarget(stack, null), { action: 'pin', id: 'a', index: 1, count: 3 });
  assert.deepEqual(clickTarget(stack, 'a'), { action: 'pin', id: 'b', index: 2, count: 3 });
  assert.deepEqual(clickTarget(stack, 'c'), { action: 'pin', id: 'a', index: 1, count: 3 });
  // Something pinned elsewhere starts the walk at the top of this stack.
  assert.deepEqual(clickTarget(stack, 'z'), { action: 'pin', id: 'a', index: 1, count: 3 });
});

test('the stack pick keeps only stations of one layer, once each, in a fixed order', async () => {
  const { idsUnder } = await import('./rendering.js');
  const seen = [];
  const scene = {
    drillPick: (at, limit, w, h) => {
      seen.push({ x: at.x, y: at.y, limit, w, h });
      return [
        { id: 'aprs-station:W2' },
        { id: { id: 'aprs-station:W1' } },
        { id: 'aprs-station:W2' },
        { id: 'mesh-node:!abc' },
        {},
      ];
    },
  };
  assert.deepEqual(idsUnder(scene, 10, 20, 'aprs-station:'), ['W1', 'W2']);
  assert.deepEqual(idsUnder(scene, 10, 20, 'mesh-node:'), ['!abc']);
  assert.equal(seen[0].x, 10);
  assert.ok(seen[0].limit > 1 && seen[0].w > 1, 'reaches past the top station');
});
