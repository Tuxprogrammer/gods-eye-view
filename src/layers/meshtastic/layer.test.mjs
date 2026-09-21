import assert from 'node:assert/strict';
import test from 'node:test';
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
  serverSummary,
  serversSummary,
} from './model.js';
import { LayerPanel } from '../../ui/layerPanel.js';

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
  const settings = { ...defaultSettings(), filter: 'HT*, !0af87081', movingOnly: true };
  const query = new URLSearchParams(nodesQuery(settings, { lat: 34.70012, lon: -86.6 }));
  assert.equal(query.get('lat'), '34.700');
  assert.equal(query.get('radiusKm'), '500');
  assert.equal(query.get('windowMin'), '180');
  assert.equal(query.get('trackMin'), '60');
  assert.equal(query.get('moving'), '1');
  assert.equal(query.get('q'), 'HT*,!0af87081');
});

test('bad rows and out-of-range fixes are dropped, not drawn', () => {
  const result = normalizeNodesPayload({
    nodes: [node('!a'), node('!b', { lat: 95 }), { id: '!c' }, node('!d', { lon: 'x' })],
    tracks: { '!a': [[1, -86.6, 34.7], [2, -86.61, 34.71]], '!x': [[1, 0, 0]] },
    servers: [{ id: 's', name: 'S', status: 'live', enabled: true }, { nope: 1 }],
  });
  assert.deepEqual(result.nodes.map((n) => n.id), ['!a']);
  assert.equal(result.tracks.get('!a').length, 2);
  assert.equal(result.tracks.has('!x'), false);
  assert.equal(result.servers.length, 1);
  assert.throws(() => normalizeNodesPayload({}), /no node list/);
  assert.equal(normalizeMessagesPayload({ messages: [{ id: 1, from: '!a', text: 'hi', lat: 1, lon: 2 }] }).messages[0].toLabel, 'everyone');
});

test('a server row never carries a password', () => {
  const row = normalizeServer({ id: 'x', name: 'X', password: 'hunter2', hasPassword: true });
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
    nodes: [node('!a', { precisionBits: 14, precisionKm: 2.9, snr: 6.5, rssi: -80, hops: 0, battery: 87, voltage: 4.05, env: { tempC: 21.5 } })],
  }).nodes;
  const text = cardModel(blurred, 'metric', 5000).lines.map((l) => l.map((s) => s.t).join('')).join('\n');
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
  const [precise] = normalizeNodesPayload({ nodes: [node('!b', { precisionBits: 32, precisionKm: 0 })] }).nodes;
  const plain = cardModel(precise).lines.map((l) => l.map((s) => s.t).join('')).join('\n');
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
  assert.deepEqual(battery.points.map((p) => p[1]), [90, 80]);
  assert.equal(series.find((s) => s.key === 'voltage').points.length, 3);
  assert.equal(series.find((s) => s.key === 'tempC'), undefined);
});

test('server status lines are honest about why there is nothing', () => {
  assert.equal(serverSummary(server('a', { status: 'off', enabled: false })), 'Off');
  assert.equal(serverSummary(server('a'), 1000), 'Live · 12/min');
  assert.equal(serverSummary(server('a', { lastMessageAt: null })), 'Connected, no traffic lately');
  assert.match(serverSummary(server('a', { status: 'auth-failed', error: 'wrong username or password' })), /wrong username/);
  assert.equal(serversSummary([]), 'Meshtastic MQTT');
  assert.equal(serversSummary([server('a', { enabled: false, status: 'off' })]), 'Turn a server on to listen');
  assert.equal(serversSummary([server('a'), server('b', { status: 'connecting' })], 1000), '1/2 servers live · 12/min');
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
  const { fetchImpl, calls } = fakeFetch(() => ({ body: { servers: [server('x')] } }));
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
  const { fetchImpl } = fakeFetch(() => ({ status: 400, body: { error: 'That is not a valid host name' } }));
  await assert.rejects(createMeshtasticSource({ fetchImpl }).addServer({}), /valid host name/);
});

// -- Layer ------------------------------------------------------------------------

function fakeViewer() {
  return {
    camera: {
      pickEllipsoid: () => undefined,
      positionCartographic: { latitude: 0.6, longitude: -1.5 },
      moveEnd: { addEventListener: () => () => {} },
    },
    scene: { canvas: { clientWidth: 100, clientHeight: 100 } },
  };
}

function harness({ getNodes, servers = [server('almesh'), server('global', { enabled: false, status: 'off' })] } = {}) {
  const calls = { nodes: [], shown: [], updates: [], added: [], removed: [], popups: [] };
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
          ? { ...s, ...patch, status: patch.enabled === false ? 'off' : s.status }
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
    createPopups: () => ({ show: (m) => calls.popups.push(m), clear() {}, destroy() {} }),
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
  assert.deepEqual(controls.servers.items.map((s) => s.id), ['almesh', 'global']);
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
  assert.deepEqual(calls.updates.at(-1), { id: 'global', patch: { enabled: true } });
  await wait();
  assert.equal(calls.nodes.length, before + 1);
  await layer.getRowControls().servers.items[0].onRemove();
  assert.deepEqual(calls.removed, ['almesh']);
  assert.deepEqual(layer.getRowControls().servers.items.map((s) => s.id), ['global']);
  // Editing the topic to what it already is changes nothing.
  await layer.getRowControls().servers.items[0].onTopic('msh/US/#');
  assert.equal(calls.updates.length, 1);
  await layer.getRowControls().servers.items[0].onTopic('msh/US/AL/#');
  assert.deepEqual(calls.updates.at(-1), { id: 'global', patch: { topic: 'msh/US/AL/#' } });
});

test('adding a server reports the server’s reason to the form, and keeps the panel honest', async () => {
  const { layer, calls } = harness();
  layer.init(fakeViewer());
  layer.enable();
  await wait();
  await assert.rejects(layer.getRowControls().servers.onAdd({ name: 'x', host: '' }), /valid host/);
  assert.equal(layer.getRowControls().servers.error, 'That is not a valid host name');
  await layer.getRowControls().servers.onAdd({ name: 'x', host: 'mesh.example.org' });
  assert.equal(calls.added.length, 2);
  assert.equal(layer.getRowControls().servers.error, null);
  assert.ok(layer.getRowControls().servers.items.some((s) => s.id === 'custom'));
});

test('a failed query keeps the last known servers so the row can say why', async () => {
  const { layer } = harness({
    getNodes: () => {
      throw Object.assign(new Error('Meshtastic storage is starting'), { servers: [server('almesh', { status: 'connecting' })] });
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
    { settings: defaultSettings(), counts: { client: 3, sensor: 1 }, servers: [], now: 0 },
    { set() {} },
  );
  assert.deepEqual(controls.selects.map((s) => s.id), ['radius', 'window', 'track', 'units']);
  assert.deepEqual(controls.chips.map((c) => c.id), ['toggle-moving', 'toggle-labels', 'toggle-popups']);
  assert.deepEqual(controls.legend.map((l) => l.label), ['Client', 'Sensor']);
});

// -- Panel widget -------------------------------------------------------------------

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.attributes = new Map();
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    const el = this;
    this.classList = {
      toggle(name, on) {
        const set = new Set(String(el.className).split(/\s+/).filter(Boolean));
        if (on) set.add(name);
        else set.delete(name);
        el.className = [...set].join(' ');
      },
    };
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get nextSibling() {
    const i = this.parent?.children.indexOf(this) ?? -1;
    return i >= 0 ? (this.parent.children[i + 1] ?? null) : null;
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node) {
    node.remove();
    node.parent = this;
    this.children.push(node);
    return node;
  }
  insertBefore(node, anchor) {
    node.remove();
    node.parent = this;
    const at = anchor ? this.children.indexOf(anchor) : -1;
    if (at < 0) this.children.push(node);
    else this.children.splice(at, 0, node);
    return node;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((n) => n !== this);
    this.parent = null;
  }
}

function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = { activeElement: null, createElement: (tag) => new FakeElement(tag) };
  try {
    return run();
  } finally {
    globalThis.document = previous;
  }
}

const item = (id, extra = {}) => ({
  id,
  name: id,
  title: `${id}.example.org:1883`,
  status: 'live',
  statusText: 'Live · 12/min',
  enabled: true,
  topic: 'msh/US/#',
  removeLabel: `Delete ${id}`,
  ...extra,
});

test('the server list is built once, with the delete button first, and kept in order across refreshes', () =>
  withDocument(() => {
    const panel = LayerPanel.prototype;
    const container = new FakeElement('div');
    for (let i = 0; i < 4; i += 1)
      panel._syncServers(container, { heading: 'MQTT SERVERS', items: [item('global'), item('almesh')] });
    const block = container.children.find((c) => c.className === 'data-servers');
    assert.equal(container.children.length, 1);
    const list = block.children[1];
    assert.deepEqual(list.children.map((n) => n.dataset.serverId), ['global', 'almesh']);
    const [remove, body, toggle] = list.children[0].children;
    assert.equal(remove.className, 'data-server-remove');
    assert.equal(remove.attributes.get('aria-label'), 'Delete global');
    assert.equal(toggle.textContent, 'ON');
    assert.equal(body.children[2].value, 'msh/US/#');
    const form = block.children[2];
    panel._syncServers(container, {
      heading: 'MQTT SERVERS',
      items: [item('almesh', { enabled: false, statusText: 'Off', status: 'off' }), item('mine')],
      error: 'nope',
    });
    assert.equal(block.children[2], form, 'the add form survives refreshes');
    assert.deepEqual(list.children.map((n) => n.dataset.serverId), ['almesh', 'mine']);
    assert.equal(list.children[0].children[2].textContent, 'OFF');
    assert.equal(block.children[3].textContent, 'nope');
    assert.equal(block.children[3].hidden, false);
    panel._syncServers(container, null);
    assert.equal(container.children.length, 0);
  }));

test('a topic being typed is not overwritten by a refresh', () =>
  withDocument(() => {
    const panel = LayerPanel.prototype;
    const container = new FakeElement('div');
    panel._syncServers(container, { items: [item('global')] });
    const topic = container.children[0].children[1].children[0].children[1].children[2];
    globalThis.document.activeElement = topic;
    topic.value = 'msh/US/AL/#';
    panel._syncServers(container, { items: [item('global')] });
    assert.equal(topic.value, 'msh/US/AL/#');
  }));
