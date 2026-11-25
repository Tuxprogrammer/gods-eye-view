import assert from 'node:assert/strict';
import test from 'node:test';
import { bindRenderer } from '../../render/rendererOf.js';
import { createMeshtasticLayer } from './index.js';
import { createMeshtasticSource } from './source.js';
import { meshtasticRowControls } from './controls.js';
import {
  cardModel,
  chartSeries,
  defaultSettings,
  nodeCategory,
  nodeLabel,
  nodesQuery,
  normalizeMessagesPayload,
  normalizeNodesPayload,
  normalizeServer,
} from './model.js';
import { serverSummary, serversSummary, topicWarning } from './serverStatus.js';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const server = (id, extra = {}) => ({
  id,
  name: id,
  host: `${id}.example.org`,
  port: 1883,
  topic: 'msh/US/#',
  enabled: true,
  status: 'live',
  lastMessageAt: 1000,
  messagesPerMinute: 12,
  ...extra,
});

const node = (id, extra = {}) => ({
  id,
  lat: 34.7,
  lon: -86.6,
  role: 'CLIENT',
  ...extra,
});

function payload(nodes = [node('!aaaaaaaa')], extra = {}) {
  return {
    nodes,
    tracks: new Map(),
    total: nodes.length,
    truncated: false,
    generatedAt: 1000,
    servers: [server('almesh')],
    ...extra,
  };
}

// -- Model ------------------------------------------------------------------------

test('the query is centred on the view and carries the settings', () => {
  const settings = {
    ...defaultSettings(),
    filter: 'HT*, !0af87081',
    movingOnly: true,
  };
  const query = new URLSearchParams(
    nodesQuery(settings, { lat: 34.70012, lon: -86.6 }),
  );
  assert.equal(query.get('lat'), '34.700');
  assert.equal(query.get('radiusKm'), '500');
  assert.equal(query.get('windowMin'), '180');
  assert.equal(query.get('trackMin'), '60');
  assert.equal(query.get('moving'), '1');
  assert.equal(query.get('q'), 'HT*,!0af87081');
});

test('bad rows and out-of-range fixes are dropped, not drawn', () => {
  const result = normalizeNodesPayload({
    nodes: [
      node('!a'),
      node('!b', { lat: 95 }),
      { id: '!c' },
      node('!d', { lon: 'x' }),
    ],
    tracks: {
      '!a': [
        [1, -86.6, 34.7],
        [2, -86.61, 34.71],
      ],
      '!x': [[1, 0, 0]],
    },
    servers: [
      { id: 's', name: 'S', status: 'live', enabled: true },
      { nope: 1 },
    ],
  });
  assert.deepEqual(
    result.nodes.map((n) => n.id),
    ['!a'],
  );
  assert.equal(result.tracks.get('!a').length, 2);
  assert.equal(result.tracks.has('!x'), false);
  assert.equal(result.servers.length, 1);
  assert.throws(() => normalizeNodesPayload({}), /no node list/);
  assert.equal(
    normalizeMessagesPayload({
      messages: [{ id: 1, from: '!a', text: 'hi', lat: 1, lon: 2 }],
    }).messages[0].toLabel,
    'everyone',
  );
});

test('a server row never carries a password', () => {
  const row = normalizeServer({
    id: 'x',
    name: 'X',
    password: 'hunter2',
    hasPassword: true,
  });
  assert.equal(JSON.stringify(row).includes('hunter2'), false);
});

test('roles map to categories and nodes are labelled by short name, else the id tail', () => {
  assert.equal(nodeCategory({ role: 'ROUTER' }), 'infrastructure');
  assert.equal(nodeCategory({ role: 'TRACKER' }), 'tracker');
  assert.equal(nodeCategory({ role: 'SENSOR' }), 'sensor');
  assert.equal(nodeCategory({ role: 'CLIENT_BASE' }), 'client');
  assert.equal(nodeCategory({ role: null }), 'client');
  assert.equal(nodeLabel({ id: '!0af87081', shortName: 'HT' }), 'HT');
  assert.equal(nodeLabel({ id: '!0af87081', shortName: null }), '7081');
});

test('the card says a blurred position is blurred, and a precise one nothing of the kind', () => {
  const [blurred] = normalizeNodesPayload({
    nodes: [
      node('!a', {
        precisionBits: 14,
        precisionKm: 2.9,
        snr: 6.5,
        rssi: -80,
        hops: 0,
        battery: 87,
        voltage: 4.05,
        env: { tempC: 21.5 },
      }),
    ],
  }).nodes;
  const text = cardModel(blurred, 'metric', 5000)
    .lines.map((l) => l.map((s) => s.t).join(''))
    .join('\n');
  assert.match(text, /^Position within ~1\.5 km$/m);
  const feet = cardModel(
    { ...blurred, precisionKm: 0.7, precisionBits: 16 },
    'imperial',
    5000,
  ).lines.map((l) => l.map((s) => s.t).join(''));
  assert.ok(feet.includes('Position within ~1150 ft'), feet.join('|'));
  assert.equal(feet.filter((l) => /within/.test(l)).length, 1, 'one line only');
  assert.match(text, /SNR 6\.5 dB · RSSI -80 dBm · direct/);
  assert.match(text, /87% · 4.05 V/);
  assert.match(text, /21\.5°C/);
  const [precise] = normalizeNodesPayload({
    nodes: [node('!b', { precisionBits: 32, precisionKm: 0 })],
  }).nodes;
  const plain = cardModel(precise)
    .lines.map((l) => l.map((s) => s.t).join(''))
    .join('\n');
  assert.doesNotMatch(plain, /blurred|ring/);
});

test('telemetry history becomes chart series, ignoring the external-power sentinel', () => {
  const series = chartSeries({
    telemetry: [
      { ts: 1, battery: 90, voltage: 4.1 },
      { ts: 2, battery: 101, voltage: 4.0 },
      { ts: 3, battery: 80, voltage: 3.9 },
    ],
  });
  const battery = series.find((s) => s.key === 'battery');
  assert.deepEqual(
    battery.points.map((p) => p[1]),
    [90, 80],
  );
  assert.equal(series.find((s) => s.key === 'voltage').points.length, 3);
  assert.equal(
    series.find((s) => s.key === 'tempC'),
    undefined,
  );
});

test('server status lines are honest about why there is nothing', () => {
  assert.equal(
    serverSummary(server('a', { status: 'off', enabled: false })),
    'Off',
  );
  assert.equal(serverSummary(server('a'), 1000), 'Live · 12/min');
  assert.equal(
    serverSummary(server('a', { lastMessageAt: null })),
    'Connected, no traffic lately',
  );
  assert.match(
    serverSummary(
      server('a', {
        status: 'auth-failed',
        error: 'wrong username or password',
      }),
    ),
    /wrong username/,
  );
  assert.equal(serversSummary([]), 'Meshtastic MQTT');
  assert.equal(
    serversSummary([server('a', { enabled: false, status: 'off' })]),
    'Turn a server on to listen',
  );
  assert.equal(
    serversSummary([server('a'), server('b', { status: 'connecting' })], 1000),
    '1/2 servers live · 12/min',
  );
});

// -- Source -----------------------------------------------------------------------

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

test('server edits are sent as JSON and answer with the refreshed list', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({
    body: { servers: [server('x')] },
  }));
  const source = createMeshtasticSource({ fetchImpl });
  const list = await source.updateServer('x', { enabled: false });
  assert.equal(list[0].id, 'x');
  assert.equal(calls[0].url, '/api/meshtastic/servers/update');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { enabled: false, id: 'x' });
  await source.removeServer('x');
  assert.equal(calls[1].url, '/api/meshtastic/servers/delete');
  await source.addServer({ name: 'n', host: 'h' });
  assert.equal(calls[2].url, '/api/meshtastic/servers');
});

test('the server’s reason reaches the caller', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    status: 400,
    body: { error: 'That is not a valid host name' },
  }));
  await assert.rejects(
    createMeshtasticSource({ fetchImpl }).addServer({}),
    /valid host name/,
  );
});

// -- Layer ------------------------------------------------------------------------

/**
 * A scene object with the ports the layer reads bound to it: a camera that
 * stands over (34.377°, -85.944°) and says when it settles, and a query that
 * finds no ground under the screen's middle, so the view centre is the
 * camera's own point.
 */
function fakeViewer() {
  const listeners = [];
  const viewer = { listeners };
  bindRenderer(viewer, {
    canvas: { clientWidth: 100, clientHeight: 100 },
    camera: {
      pose: () => ({ lat: 34.377, lon: -85.944, height: 1e6 }),
      on(event, fn) {
        if (event !== 'moveEnd') return () => {};
        listeners.push(fn);
        return () => listeners.splice(listeners.indexOf(fn), 1);
      },
    },
    query: { pickEllipsoid: () => null },
  });
  return viewer;
}

function harness({
  getNodes,
  servers = [
    server('almesh'),
    server('global', { enabled: false, status: 'off' }),
  ],
} = {}) {
  const calls = {
    nodes: [],
    shown: [],
    updates: [],
    added: [],
    removed: [],
    popups: [],
  };
  let list = servers;
  const timers = [];
  const source = {
    getNodes: async (query) => {
      calls.nodes.push(query);
      return (getNodes ?? (() => payload(undefined, { servers: list })))(query);
    },
    getMessages: async () => ({ cursor: 1, messages: [] }),
    getNode: async () => ({}),
    updateServer: async (id, patch) => {
      calls.updates.push({ id, patch });
      list = list.map((s) =>
        s.id === id
          ? {
              ...s,
              ...patch,
              status: patch.enabled === false ? 'off' : s.status,
            }
          : s,
      );
      return list;
    },
    removeServer: async (id) => {
      calls.removed.push(id);
      list = list.filter((s) => s.id !== id);
      return list;
    },
    addServer: async (fields) => {
      calls.added.push(fields);
      if (!fields.host) throw new Error('That is not a valid host name');
      list = [...list, server('custom')];
      return list;
    },
  };
  const surface = {
    show: (nodes) => calls.shown.push(nodes),
    clear: () => calls.shown.push('clear'),
    destroy() {},
    setLabels() {},
    setClassification() {},
    categoryCounts: () => ({ client: 1 }),
    recordFor: () => null,
  };
  const layer = createMeshtasticLayer({
    source,
    visibilityTarget: null,
    createSurface: () => surface,
    createInteraction: () => ({ refresh() {}, hide() {}, destroy() {} }),
    createPopups: () => ({
      show: (m) => calls.popups.push(m),
      clear() {},
      destroy() {},
    }),
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
  assert.deepEqual(calls.nodes, []);
  layer.enable();
  await wait();
  assert.equal(calls.nodes.length, 1);
  assert.equal(layer.getStats().count, 1);
  layer.disable();
  assert.equal(calls.shown.at(-1), 'clear');
  await layer.update();
  assert.equal(calls.nodes.length, 1);
});

test('the row lists every server, and the layer says what they are doing', async () => {
  const { layer } = harness();
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  const controls = layer.getRowControls();
  assert.deepEqual(
    controls.servers.items.map((s) => s.id),
    ['almesh', 'global'],
  );
  assert.equal(controls.servers.items[1].enabled, false);
  assert.equal(layer.getStats().source, '1/1 server live · 12/min');
});

test('switching a server on or off, or deleting it, edits the list and re-queries', async () => {
  const { layer, calls } = harness();
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  const before = calls.nodes.length;
  await layer.getRowControls().servers.items[1].onToggle();
  assert.deepEqual(calls.updates.at(-1), {
    id: 'global',
    patch: { enabled: true },
  });
  await wait();
  assert.equal(calls.nodes.length, before + 1);
  await layer.getRowControls().servers.items[0].onRemove();
  assert.deepEqual(calls.removed, ['almesh']);
  assert.deepEqual(
    layer.getRowControls().servers.items.map((s) => s.id),
    ['global'],
  );
  // Editing the topic to what it already is changes nothing.
  await layer.getRowControls().servers.items[0].onTopic('msh/US/#');
  assert.equal(calls.updates.length, 1);
  await layer.getRowControls().servers.items[0].onTopic('msh/US/AL/#');
  assert.deepEqual(calls.updates.at(-1), {
    id: 'global',
    patch: { topic: 'msh/US/AL/#' },
  });
});

test('adding a server reports the server’s reason to the form, and keeps the panel honest', async () => {
  const { layer, calls } = harness();
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  await assert.rejects(
    layer.getRowControls().servers.onAdd({ name: 'x', host: '' }),
    /valid host/,
  );
  assert.equal(
    layer.getRowControls().servers.error,
    'That is not a valid host name',
  );
  await layer
    .getRowControls()
    .servers.onAdd({ name: 'x', host: 'mesh.example.org' });
  assert.equal(calls.added.length, 2);
  assert.equal(layer.getRowControls().servers.error, null);
  assert.ok(
    layer.getRowControls().servers.items.some((s) => s.id === 'custom'),
  );
});

test('a failed query keeps the last known servers so the row can say why', async () => {
  const { layer } = harness({
    getNodes: () => {
      throw Object.assign(new Error('Meshtastic storage is starting'), {
        servers: [server('almesh', { status: 'connecting' })],
      });
    },
  });
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  assert.equal(layer.getStats().status, 'unavailable');
  assert.match(layer.getStats().error, /storage is starting/);
});

test('the controls offer the same filters and toggles as APRS, less what does not apply', () => {
  const controls = meshtasticRowControls(
    {
      settings: defaultSettings(),
      counts: { client: 3, sensor: 1 },
      servers: [],
      now: 0,
    },
    { set() {} },
  );
  assert.deepEqual(
    controls.selects.map((s) => s.id),
    ['radius', 'window', 'track', 'units'],
  );
  assert.deepEqual(
    controls.chips.map((c) => c.id),
    ['toggle-moving', 'toggle-labels', 'toggle-popups'],
  );
  assert.deepEqual(
    controls.legend.map((l) => l.label),
    ['Client', 'Sensor'],
  );
});

test('the card names the hardware just above the firmware line, and says nothing when unknown', () => {
  const lines = (extra) =>
    cardModel(
      normalizeNodesPayload({
        nodes: [node('!a', { firmware: '2.5.15', region: 'US', ...extra })],
      }).nodes[0],
      'metric',
      5000,
    ).lines.map((l) => l.map((s) => s.t).join(''));
  const known = lines({ hwModel: 43 });
  const at = known.indexOf('Hardware: Heltec V3');
  assert.ok(at >= 0, known.join('|'));
  assert.match(known[at + 1], /^fw 2\.5\.15/);
  assert.ok(lines({ hwModel: 9999 }).includes('Hardware: Hardware 9999'));
  assert.ok(!lines({}).some((l) => l.startsWith('Hardware')));
  assert.ok(!lines({ hwModel: 0 }).some((l) => l.startsWith('Hardware')));
});

test('a model shared by several listed devices is named for the first, and pictured only when the image exists', async () => {
  const { hardwareName, hardwareImageUrl } = await import('./hardware.js');
  const { existsSync } = await import('node:fs');
  assert.equal(hardwareName(9), 'RAK WisBlock 4631');
  assert.equal(hardwareName(16), 'LILYGO T-LoRa T3-S3');
  assert.equal(hardwareImageUrl(13), null);
  assert.equal(hardwareImageUrl(null), null);
  for (const model of [3, 4, 7, 9, 43, 48, 58, 71, 84, 110, 89, 133]) {
    const url = hardwareImageUrl(model);
    assert.ok(url, `model ${model}`);
    assert.ok(existsSync(`public${url}`), `${url} is bundled`);
  }
});

test('a topic that can never match a Meshtastic packet is called out in the server row', () => {
  assert.equal(topicWarning('msh/US/#'), null);
  assert.equal(topicWarning('msh/US/AL/#'), null);
  assert.equal(topicWarning('msh/US/2/e/LongFast/+'), null);
  assert.equal(
    topicWarning('msh/US/2/e/LongFast/!abcd1234'),
    null,
    'an exact five-level topic is fine',
  );
  assert.match(
    topicWarning('msh/US'),
    /matches nothing: add \/#, like msh\/US\/#/,
  );
  assert.match(topicWarning(''), /matches nothing/);
  const row = {
    id: 'g',
    name: 'g',
    status: 'live',
    enabled: true,
    topic: 'msh/US',
    messagesPerMinute: 0,
    lastMessageAt: null,
  };
  assert.match(serverSummary(row, 1000), /matches nothing/);
  assert.equal(
    serverSummary({ ...row, enabled: false, status: 'off' }, 1000),
    'Off',
  );
  assert.match(
    serverSummary({ ...row, topic: 'msh/US/#' }, 1000),
    /no traffic lately/,
  );
});

test('the surface draws nodes, rings a blurred node, and labels through the world overlay', async () => {
  const { createMeshtasticSurface } = await import('./rendering.js');
  const { bindFakeDraw } = await import('../../testSupport/fakeDrawPort.mjs');
  const { fromDegrees } = await import('../../geo/ellipsoid.js');
  const viewer = {};
  const eye = fromDegrees(-86.6, 34.7, 1_000_000);
  const { draw } = bindFakeDraw(viewer, {
    camera: { pose: () => ({ position: eye, lat: 34.7, lon: -86.6 }) },
    frame: { on: () => () => {}, requestRender() {} },
    query: { project: () => ({ x: 1, y: 2 }) },
  });
  const labels = [];
  const surface = createMeshtasticSurface({
    viewer,
    classificationType: 'terrain',
    overlayHost: {
      setEntries: (source, entries) => labels.push({ source, entries }),
      clearSource: (source) => labels.push({ source, entries: [] }),
    },
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => new Proxy({}, { get: () => () => {} }),
    }),
  });
  const blurred = {
    id: '!blur',
    lat: 34.7,
    lon: -86.6,
    role: 'CLIENT',
    precisionKm: 2,
  };
  const exact = {
    id: '!fix',
    lat: 34.71,
    lon: -86.61,
    role: 'ROUTER',
    precisionKm: 0,
  };
  surface.show([blurred, exact], new Map());
  const nodes = draw.set('meshtastic:nodes');
  assert.deepEqual(
    [...nodes.items.keys()],
    ['mesh-node:!blur', 'mesh-node:!fix'],
  );
  assert.equal(nodes.items.get('mesh-node:!fix').show, true);
  assert.equal(labels.at(-1).source, 'meshtastic-labels');
  assert.equal(labels.at(-1).entries.length, 2);

  surface.setEmphasis('!blur');
  const ring = draw.set('meshtastic:accuracy').items.get('accuracy-fill');
  assert.equal(ring.geometry.semiMajor, 1000, 'the box width as diameter');
  assert.equal(ring.clampTo, 'terrain');
  const edge = draw.set('meshtastic:tracks').items.get('accuracy-ring');
  assert.equal(edge.style.kind, 'dash');
  assert.equal(edge.mode, 'draped');
  surface.setClassification('tiles');
  assert.equal(
    draw.set('meshtastic:accuracy').items.get('accuracy-fill').clampTo,
    'tiles',
  );
  assert.equal(
    draw.set('meshtastic:tracks').items.get('accuracy-ring').clampTo,
    'tiles',
  );

  surface.setEmphasis('!fix');
  assert.equal(
    draw.set('meshtastic:accuracy').items.size,
    0,
    'a precise fix gets no ring',
  );
  assert.equal(draw.set('meshtastic:tracks').items.has('accuracy-ring'), false);
  surface.destroy();
  assert.equal(draw.set('meshtastic:nodes'), undefined);
  assert.deepEqual(labels.at(-1), { source: 'meshtastic-labels', entries: [] });
});
