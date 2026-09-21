import {
  DEFAULT_UNITS,
  MESSAGE_FADE_MS,
  MESSAGE_POLL_MS,
  MESSAGE_POPUP_MS,
  MAX_MESSAGE_POPUPS,
  RADIUS_OPTIONS,
  TRACK_OPTIONS,
  UNIT_OPTIONS,
  WINDOW_OPTIONS,
  formatAge,
  formatAltitude,
  formatCoords,
  formatDistance,
  formatSpeed,
  formatTemperature,
  formatTime,
  newMessages,
  normalizeTrack,
  popupText,
  radiusOption,
  sparklinePath,
  trackOption,
  unitOption,
  windowOption,
} from '../aprs/model.js';

/** Pure model, formatting and query helpers for the Meshtastic layer. */

export const MESHTASTIC_LAYER_ID = 'meshtastic';

export {
  MESSAGE_FADE_MS,
  MESSAGE_POLL_MS,
  MESSAGE_POPUP_MS,
  MAX_MESSAGE_POPUPS,
  RADIUS_OPTIONS,
  TRACK_OPTIONS,
  UNIT_OPTIONS,
  WINDOW_OPTIONS,
  formatAge,
  formatTime,
  newMessages,
  popupText,
  radiusOption,
  sparklinePath,
  trackOption,
  unitOption,
  windowOption,
};

export const DEFAULT_RADIUS = '500';
/** Mesh nodes beacon every 15 minutes to several hours, so the default is generous. */
export const DEFAULT_WINDOW = '180';
export const DEFAULT_TRACK = '60';

/** Nodes are re-read this often while the layer is on and the page visible. */
export const MESHTASTIC_REFRESH_MS = 15_000;
export const MESHTASTIC_STALE_AFTER_MS = 5 * 60_000;
/** Above this many nodes, clamping every icon to the ground costs too much. */
export const CLAMP_NODE_LIMIT = 1200;
export const LABEL_NODE_LIMIT = 1500;

/**
 * The layer's user settings and their defaults.
 * @typedef {object} MeshtasticSettings
 * @property {string} radius
 * @property {string} window
 * @property {string} track
 * @property {string} units
 * @property {string} filter Comma separated names / ids / `HT*` patterns.
 * @property {boolean} movingOnly
 * @property {boolean} labels
 * @property {boolean} popups Message pop-ups.
 */
export function defaultSettings() {
  return {
    radius: DEFAULT_RADIUS,
    window: DEFAULT_WINDOW,
    track: DEFAULT_TRACK,
    units: DEFAULT_UNITS,
    filter: '',
    movingOnly: false,
    labels: true,
    popups: true,
  };
}

/** Comma separated node names, ids or patterns, at most twenty. */
export function parseFilter(text) {
  return String(text ?? '')
    .split(/,/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 40)
    .slice(0, 20);
}

/** Query string for /api/meshtastic/nodes. The centre is rounded so a tiny pan keeps the key. */
export function nodesQuery(settings, center) {
  const params = new URLSearchParams();
  params.set('lat', center.lat.toFixed(3));
  params.set('lon', center.lon.toFixed(3));
  params.set('radiusKm', String(radiusOption(settings.radius).value));
  params.set('windowMin', String(windowOption(settings.window).minutes));
  const track = trackOption(settings.track).minutes;
  if (track) params.set('trackMin', String(track));
  if (settings.movingOnly) params.set('moving', '1');
  const filter = parseFilter(settings.filter);
  if (filter.length) params.set('q', filter.join(','));
  return params.toString();
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => (typeof value === 'string' && value ? value : null);

function normalizeNode(row) {
  if (
    !row ||
    typeof row.id !== 'string' ||
    !finite(row.lat) ||
    !finite(row.lon)
  )
    return null;
  if (row.lat < -90 || row.lat > 90 || row.lon < -180 || row.lon > 180)
    return null;
  return {
    id: row.id,
    server: text(row.server),
    longName: text(row.longName),
    shortName: text(row.shortName),
    role: text(row.role),
    lat: row.lat,
    lon: row.lon,
    alt: finite(row.alt) ? row.alt : null,
    precisionBits: finite(row.precisionBits) ? row.precisionBits : null,
    precisionKm: finite(row.precisionKm) ? row.precisionKm : 0,
    speedKmh: finite(row.speedKmh) ? row.speedKmh : null,
    course: finite(row.course) ? row.course : null,
    posAt: finite(row.posAt) ? row.posAt : null,
    firstHeard: finite(row.firstHeard) ? row.firstHeard : null,
    lastHeard: finite(row.lastHeard) ? row.lastHeard : null,
    packets: finite(row.packets) ? row.packets : 0,
    snr: finite(row.snr) ? row.snr : null,
    rssi: finite(row.rssi) ? row.rssi : null,
    hops: finite(row.hops) ? row.hops : null,
    viaMqtt: Boolean(row.viaMqtt),
    gateway: text(row.gateway),
    channel: text(row.channel),
    root: text(row.root),
    firmware: text(row.firmware),
    region: text(row.region),
    preset: text(row.preset),
    battery: finite(row.battery) ? row.battery : null,
    voltage: finite(row.voltage) ? row.voltage : null,
    channelUtil: finite(row.channelUtil) ? row.channelUtil : null,
    airUtilTx: finite(row.airUtilTx) ? row.airUtilTx : null,
    uptime: finite(row.uptime) ? row.uptime : null,
    env: row.env && typeof row.env === 'object' ? row.env : null,
    telemAt: finite(row.telemAt) ? row.telemAt : null,
    distanceKm: finite(row.distanceKm) ? row.distanceKm : null,
  };
}

export { normalizeTrack };

/** One MQTT server as the panel shows it. Never carries a password. */
export function normalizeServer(row) {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    name: text(row.name) ?? row.id,
    host: text(row.host) ?? '',
    port: finite(row.port) ? row.port : 1883,
    tls: Boolean(row.tls),
    topic: text(row.topic) ?? '',
    enabled: Boolean(row.enabled),
    status: text(row.status) ?? 'unknown',
    error: text(row.error),
    lastMessageAt: finite(row.lastMessageAt) ? row.lastMessageAt : null,
    messagesPerMinute: finite(row.messagesPerMinute)
      ? row.messagesPerMinute
      : 0,
    decoded: finite(row.decoded) ? row.decoded : 0,
    optOuts: finite(row.optOuts) ? row.optOuts : 0,
    privateChannels: Array.isArray(row.privateChannels)
      ? row.privateChannels.filter((name) => typeof name === 'string')
      : [],
  };
}

export const normalizeServers = (rows) =>
  Array.isArray(rows) ? rows.map(normalizeServer).filter(Boolean) : [];

/** @returns {{nodes: object[], tracks: Map<string, object[]>, total: number, truncated: boolean, generatedAt: number, servers: object[]}} */
export function normalizeNodesPayload(payload) {
  if (!payload || !Array.isArray(payload.nodes))
    throw new Error('Meshtastic returned no node list');
  const nodes = payload.nodes.map(normalizeNode).filter(Boolean);
  const tracks = new Map();
  for (const [id, points] of Object.entries(payload.tracks ?? {})) {
    const track = normalizeTrack(points);
    if (track.length >= 2) tracks.set(id, track);
  }
  return {
    nodes,
    tracks,
    total: finite(payload.total) ? payload.total : nodes.length,
    truncated: Boolean(payload.truncated),
    generatedAt: finite(payload.generatedAt) ? payload.generatedAt : Date.now(),
    servers: normalizeServers(payload.servers),
  };
}

export function normalizeMessagesPayload(payload) {
  if (!payload || !Array.isArray(payload.messages))
    throw new Error('Meshtastic returned no message list');
  return {
    cursor: finite(payload.cursor) ? payload.cursor : 0,
    messages: payload.messages
      .filter(
        (m) =>
          m &&
          finite(m.id) &&
          typeof m.from === 'string' &&
          typeof m.text === 'string' &&
          finite(m.lat) &&
          finite(m.lon),
      )
      .map((m) => ({
        id: m.id,
        ts: finite(m.ts) ? m.ts : Date.now(),
        from: m.from,
        fromLabel: text(m.fromLabel) ?? m.from,
        to: typeof m.to === 'string' ? m.to : '^all',
        toLabel: text(m.toLabel) ?? 'everyone',
        text: m.text,
        lat: m.lat,
        lon: m.lon,
        anchoredTo: 'sender',
      })),
    servers: normalizeServers(payload.servers),
  };
}

/** Detail payload for one node: 24 h track, telemetry history, recent messages. */
export function normalizeDetailPayload(payload) {
  const node = normalizeNode(payload?.node);
  if (!node) throw new Error('Meshtastic returned no node');
  return {
    node,
    track: normalizeTrack(payload.track),
    telemetry: Array.isArray(payload.telemetry)
      ? payload.telemetry.filter((row) => row && finite(row.ts))
      : [],
    messages: Array.isArray(payload.messages)
      ? payload.messages.filter(
          (m) => m && typeof m.from === 'string' && typeof m.text === 'string',
        )
      : [],
  };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** category -> marker colour. Meshtastic green for ordinary nodes. */
export const CATEGORY_COLORS = Object.freeze({
  client: '#67ea94',
  infrastructure: '#ffb547',
  tracker: '#43b7ff',
  sensor: '#c58bff',
});

const ROLE_CATEGORY = Object.freeze({
  ROUTER: 'infrastructure',
  ROUTER_CLIENT: 'infrastructure',
  ROUTER_LATE: 'infrastructure',
  REPEATER: 'infrastructure',
  TRACKER: 'tracker',
  TAK_TRACKER: 'tracker',
  LOST_AND_FOUND: 'tracker',
  SENSOR: 'sensor',
});

const CATEGORY_GLYPH = Object.freeze({
  client: '📱',
  infrastructure: '📡',
  tracker: '📍',
  sensor: '🌡',
});

export const nodeCategory = (node) => ROLE_CATEGORY[node.role] ?? 'client';
export const nodeGlyph = (node) => CATEGORY_GLYPH[nodeCategory(node)];

/** The short name the radio shows, else the last four hex digits of its id. */
export const nodeLabel = (node) =>
  node.shortName || node.id.replace(/^!/, '').slice(-4);

const ROLE_TEXT = Object.freeze({
  CLIENT: 'Client',
  CLIENT_MUTE: 'Client (muted)',
  CLIENT_HIDDEN: 'Client (hidden)',
  CLIENT_BASE: 'Client base',
  ROUTER: 'Router',
  ROUTER_CLIENT: 'Router + client',
  ROUTER_LATE: 'Router (late)',
  REPEATER: 'Repeater',
  TRACKER: 'Tracker',
  TAK: 'TAK',
  TAK_TRACKER: 'TAK tracker',
  SENSOR: 'Sensor',
  LOST_AND_FOUND: 'Lost and found',
});

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

/** A short range: feet or metres while small, miles or kilometres once large. */
export function formatRange(km, units) {
  if (units === 'metric') {
    return km < 1
      ? `${Math.round(km * 100) * 10} m`
      : formatDistance(km, units);
  }
  const feet = km * 3280.84;
  return feet < 5280
    ? `${Math.round(feet / 10) * 10} ft`
    : formatDistance(km, units);
}

const t = (value) => ({ t: value });
const b = (value) => ({ t: value, b: true });

const formatUptime = (seconds) => {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 360) / 10} h`;
  return `${Math.round(seconds / 8640) / 10} days`;
};

/**
 * The hover/click card: who it is, when it was heard, where (and how precisely),
 * the radio link, the device's telemetry, and how it reached us.
 * @returns {{title: string, glyph: string, lines: Array<Array<{t: string, b?: boolean}>>, hasCharts: boolean}}
 */
export function cardModel(node, units = DEFAULT_UNITS, now = Date.now()) {
  const lines = [];
  const who = [b(nodeLabel(node)), t(` · ${node.id}`)];
  if (node.role) who.push(t(` · ${ROLE_TEXT[node.role] ?? node.role}`));
  lines.push(who);
  lines.push([
    t(`${formatTime(node.firstHeard)} - ${formatTime(node.lastHeard)}`),
  ]);
  if (node.posAt !== null)
    lines.push([
      t(`Position ${formatTime(node.posAt)} (${formatAge(node.posAt, now)})`),
    ]);
  const where = [t(formatCoords(node.lat, node.lon))];
  if (node.alt !== null)
    where.push(t(' · '), b(formatAltitude(node.alt, units)));
  lines.push(where);
  // The channel's position precision is the operator's choice; say what it means.
  // One short line; the ring on the ground shows the same distance.
  if (node.precisionKm > 0)
    lines.push([
      t(`Position within ~${formatRange(node.precisionKm / 2, units)}`),
    ]);
  if (node.speedKmh !== null && node.speedKmh >= 1) {
    const move = [b(formatSpeed(node.speedKmh, units))];
    if (node.course !== null)
      move.push(t(` heading ${Math.round(node.course)}°`));
    lines.push(move);
  }
  if (node.distanceKm !== null)
    lines.push([
      t(`${formatDistance(node.distanceKm, units)} from view centre`),
    ]);

  const link = [];
  if (node.snr !== null) link.push(`SNR ${node.snr} dB`);
  if (node.rssi !== null) link.push(`RSSI ${node.rssi} dBm`);
  if (node.hops !== null)
    link.push(
      node.hops === 0
        ? 'direct'
        : `${node.hops} hop${node.hops === 1 ? '' : 's'}`,
    );
  if (link.length) lines.push([t(`Signal: ${link.join(' · ')}`)]);

  const device = [];
  if (node.battery !== null)
    device.push(node.battery > 100 ? 'powered' : `${node.battery}%`);
  if (node.voltage !== null) device.push(`${node.voltage} V`);
  if (node.channelUtil !== null) device.push(`channel ${node.channelUtil}%`);
  if (node.airUtilTx !== null) device.push(`air TX ${node.airUtilTx}%`);
  if (node.uptime !== null) device.push(`up ${formatUptime(node.uptime)}`);
  if (device.length) lines.push([t('Device: '), b(device.join(' · '))]);

  const env = node.env;
  if (env) {
    const parts = [];
    if (env.tempC !== undefined)
      parts.push(formatTemperature((env.tempC * 9) / 5 + 32, units));
    if (env.humidity !== undefined) parts.push(`${env.humidity}% RH`);
    if (env.pressureHpa !== undefined) parts.push(`${env.pressureHpa} hPa`);
    if (parts.length) lines.push([t('Sensors: '), b(parts.join(' · '))]);
  }

  const radio = [
    node.firmware && `fw ${node.firmware}`,
    node.region,
    node.preset,
  ]
    .filter(Boolean)
    .join(' · ');
  if (radio) lines.push([t(radio)]);
  const via = [];
  if (node.gateway) via.push(`via ${node.gateway}`);
  if (node.channel) via.push(`on ${node.channel}`);
  if (node.root) via.push(`(${node.root})`);
  if (via.length) lines.push([t(`Heard ${via.join(' ')}`)]);
  return {
    title: node.longName || nodeLabel(node),
    glyph: nodeGlyph(node),
    lines,
    hasCharts: false,
  };
}

const CHARTS = [
  { key: 'battery', label: 'Battery', format: (v) => `${Math.round(v)}%` },
  { key: 'voltage', label: 'Voltage', format: (v) => `${v.toFixed(2)} V` },
  {
    key: 'channelUtil',
    label: 'Channel use',
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    key: 'tempC',
    label: 'Temperature',
    format: (v, units) => formatTemperature((v * 9) / 5 + 32, units),
  },
];

/** Chart series from a node's telemetry history; a series needs two points. */
export function chartSeries(detail, units = DEFAULT_UNITS) {
  const history = detail?.telemetry ?? [];
  const out = [];
  for (const chart of CHARTS) {
    const points = history
      .filter(
        (row) =>
          finite(row[chart.key]) &&
          !(chart.key === 'battery' && row[chart.key] > 100),
      )
      .map((row) => [row.ts, row[chart.key]]);
    if (points.length < 2) continue;
    const values = points.map((p) => p[1]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    out.push({
      key: chart.key,
      label: chart.label,
      min,
      max,
      points,
      minText: chart.format(min, units),
      maxText: chart.format(max, units),
    });
  }
  return out;
}

/** `Short › #Channel: text` for the recent-messages list on the card. */
export const messageLine = (message) =>
  `${message.from} › ${message.to === '^all' ? `#${message.channel ?? 'everyone'}` : message.to}: ${message.text}`;

// ---------------------------------------------------------------------------
// Row status
// ---------------------------------------------------------------------------

/** One short line for a server row. */
export function serverSummary(server, now = Date.now()) {
  switch (server.status) {
    case 'off':
      return 'Off';
    case 'live': {
      const quiet =
        server.lastMessageAt === null ||
        now - server.lastMessageAt > MESHTASTIC_STALE_AFTER_MS;
      return quiet
        ? 'Connected, no traffic lately'
        : `Live · ${server.messagesPerMinute}/min`;
    }
    case 'connecting':
    case 'reconnecting':
      return server.error ? `Reconnecting · ${server.error}` : 'Connecting…';
    case 'auth-failed':
      return server.error || 'Login refused';
    default:
      return server.error || 'Unavailable';
  }
}

/** The layer row's meta line: what the enabled servers are doing, honestly. */
export function serversSummary(servers, now = Date.now()) {
  if (!servers.length) return 'Meshtastic MQTT';
  const on = servers.filter((server) => server.enabled);
  if (!on.length) return 'Turn a server on to listen';
  const live = on.filter((server) => server.status === 'live');
  if (!live.length)
    return on.length === 1
      ? `${on[0].name}: ${serverSummary(on[0], now)}`
      : `${on.length} servers connecting…`;
  const rate = live.reduce((sum, s) => sum + s.messagesPerMinute, 0);
  return `${live.length}/${on.length} server${on.length === 1 ? '' : 's'} live · ${rate}/min`;
}
