import { createDecipheriv } from 'node:crypto';
import {
  bytes,
  float32,
  int32,
  last,
  message,
  num,
  readMessage,
  sfixed32,
  str,
} from './proto.js';

/**
 * Meshtastic's public default channel key (the one "AQ==" stands for). It is
 * published in the firmware and the docs and is what every default-configured
 * channel uses, so reading with it is reading what the network broadcasts to
 * anyone. Private channels have their own key, which this layer never has
 * unless the person adding the server types it in.
 */
const DEFAULT_PSK = Buffer.from('d4f1bb3a20290759f0bcffabcf4e6901', 'hex');

export const PORT = Object.freeze({
  TEXT: 1,
  POSITION: 3,
  NODEINFO: 4,
  TELEMETRY: 67,
  MAP_REPORT: 73,
});

export const BROADCAST = 0xffffffff;

/** Config.DeviceConfig.Role */
const ROLES = [
  'CLIENT',
  'CLIENT_MUTE',
  'ROUTER',
  'ROUTER_CLIENT',
  'REPEATER',
  'TRACKER',
  'SENSOR',
  'TAK',
  'CLIENT_HIDDEN',
  'LOST_AND_FOUND',
  'TAK_TRACKER',
  'ROUTER_LATE',
  'CLIENT_BASE',
];
const REGIONS = [
  'UNSET',
  'US',
  'EU_433',
  'EU_868',
  'CN',
  'JP',
  'ANZ',
  'KR',
  'TW',
  'RU',
  'IN',
  'NZ_865',
  'TH',
  'LORA_24',
  'UA_433',
  'UA_868',
  'MY_433',
  'MY_919',
  'SG_923',
  'PH_433',
  'PH_868',
  'PH_915',
];
const PRESETS = [
  'LONG_FAST',
  'LONG_SLOW',
  'VERY_LONG_SLOW',
  'MEDIUM_SLOW',
  'MEDIUM_FAST',
  'SHORT_SLOW',
  'SHORT_FAST',
  'LONG_MODERATE',
  'SHORT_TURBO',
];

export const nodeId = (number) =>
  `!${(number >>> 0).toString(16).padStart(8, '0')}`;

/**
 * A channel key from what a person types: base64 (`AQ==`, a 16- or 32-byte
 * key), `default`, or empty. A one-byte key N stands for the default key with
 * its last byte raised by N-1, which is how the firmware defines the short
 * forms. Returns null when it is not a usable key.
 * @returns {Buffer|null}
 */
export function expandKey(text) {
  const clean = String(text ?? '').trim();
  if (!clean || clean.toLowerCase() === 'default') return DEFAULT_PSK;
  // Accept the URL-safe alphabet the apps print.
  const raw = Buffer.from(
    clean.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  );
  if (raw.length === 1 && raw[0] >= 1) {
    const key = Buffer.from(DEFAULT_PSK);
    key[15] = (key[15] + raw[0] - 1) & 0xff;
    return key;
  }
  return raw.length === 16 || raw.length === 32 ? raw : null;
}

/** The one-byte channel hash a packet carries: name XOR key, byte by byte. */
export function channelHash(name, key) {
  let hash = 0;
  for (const byte of Buffer.from(name, 'utf8')) hash ^= byte;
  for (const byte of key) hash ^= byte;
  return hash & 0xff;
}

/** AES-CTR with the nonce Meshtastic derives from the packet id and sender. */
export function decryptPayload(key, packetId, fromNumber, encrypted) {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64LE(BigInt(packetId >>> 0), 0);
  iv.writeUInt32LE(fromNumber >>> 0, 8);
  const decipher = createDecipheriv(
    key.length === 32 ? 'aes-256-ctr' : 'aes-128-ctr',
    key,
    iv,
  );
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Keys a server's channels may use: the default key first, then any the person supplied. */
export function keyRing(texts = []) {
  const keys = [DEFAULT_PSK];
  for (const text of texts) {
    const key = expandKey(text);
    if (key && !keys.some((known) => known.equals(key))) keys.push(key);
  }
  return keys;
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

const sanitizeText = (buffer) =>
  buffer
    .toString('utf8')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

/**
 * The size of the box a position of `bits` precision could be anywhere in, in
 * kilometres. Meshtastic keeps only the top `bits` of the 32-bit coordinate
 * (units of 1e-7 degree) when the channel asks for a blurred position.
 */
export function precisionCellKm(bits) {
  if (!finite(bits) || bits <= 0 || bits >= 32) return 0;
  return Math.round(2 ** (32 - bits) * 1e-7 * 111.195 * 10) / 10;
}

function readPosition(fields) {
  const latI = sfixed32(fields, 1);
  const lonI = sfixed32(fields, 2);
  if (latI === undefined || lonI === undefined) return null;
  if (latI === 0 && lonI === 0) return null;
  const lat = latI * 1e-7;
  const lon = lonI * 1e-7;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const bits = num(fields, 23, 0);
  const speed = num(fields, 15);
  const track = num(fields, 16);
  return {
    lat,
    lon,
    alt: int32(fields, 3) ?? null,
    precisionBits: bits > 0 && bits < 32 ? bits : 32,
    speedKmh: finite(speed) ? Math.round(speed * 3.6 * 10) / 10 : null,
    course: finite(track) && track > 0 ? Math.round(track / 1e5) : null,
  };
}

function readUser(fields) {
  const role = num(fields, 7);
  return {
    longName: str(fields, 2) || null,
    shortName: str(fields, 3) || null,
    hwModel: num(fields, 5) ?? null,
    // proto3 omits the default, which is CLIENT.
    role: ROLES[role ?? 0] ?? `ROLE_${role}`,
  };
}

function readTelemetry(fields) {
  const out = {};
  const device = message(fields, 2);
  if (device) {
    const battery = num(device, 1);
    const voltage = float32(device, 2);
    const channelUtil = float32(device, 3);
    const airUtil = float32(device, 4);
    const uptime = num(device, 5);
    // 101 is the firmware's "powered from an external supply" sentinel.
    if (finite(battery)) out.battery = battery;
    if (finite(voltage) && voltage > 0 && voltage < 100)
      out.voltage = Math.round(voltage * 100) / 100;
    if (finite(channelUtil) && channelUtil >= 0 && channelUtil <= 100)
      out.channelUtil = Math.round(channelUtil * 10) / 10;
    if (finite(airUtil) && airUtil >= 0 && airUtil <= 100)
      out.airUtilTx = Math.round(airUtil * 10) / 10;
    if (finite(uptime)) out.uptime = uptime;
  }
  const env = message(fields, 3);
  if (env) {
    const temperature = float32(env, 1);
    const humidity = float32(env, 2);
    const pressure = float32(env, 3);
    if (finite(temperature) && temperature > -90 && temperature < 150)
      out.tempC = Math.round(temperature * 10) / 10;
    if (finite(humidity) && humidity >= 0 && humidity <= 100)
      out.humidity = Math.round(humidity);
    if (finite(pressure) && pressure > 300 && pressure < 1200)
      out.pressureHpa = Math.round(pressure * 10) / 10;
  }
  return Object.keys(out).length ? out : null;
}

function readMapReport(fields) {
  const latI = sfixed32(fields, 9);
  const lonI = sfixed32(fields, 10);
  const role = num(fields, 3);
  const region = num(fields, 6);
  const preset = num(fields, 7);
  const bits = num(fields, 12, 0);
  const report = {
    longName: str(fields, 1) || null,
    shortName: str(fields, 2) || null,
    role: ROLES[role ?? 0] ?? `ROLE_${role}`,
    hwModel: num(fields, 4) ?? null,
    firmware: str(fields, 5) || null,
    region: region !== undefined ? (REGIONS[region] ?? null) : null,
    preset: preset !== undefined ? (PRESETS[preset] ?? null) : null,
    position: null,
  };
  if (
    latI !== undefined &&
    lonI !== undefined &&
    !(latI === 0 && lonI === 0) &&
    Math.abs(latI * 1e-7) <= 90 &&
    Math.abs(lonI * 1e-7) <= 180
  )
    report.position = {
      lat: latI * 1e-7,
      lon: lonI * 1e-7,
      alt: int32(fields, 11) ?? null,
      precisionBits: bits > 0 && bits < 32 ? bits : 32,
      speedKmh: null,
      course: null,
    };
  return report;
}

/** `msh/US/2/e/LongFast/!a1b2c3d4` -> root, kind, channel and gateway parts. */
export function parseTopic(topic) {
  // A root may itself contain `/2/` (`msh/US/CA/US/2/2/e/...`), so the LAST
  // `/2/<kind>` is the protocol part.
  let found = null;
  for (const match of topic.matchAll(/\/2\/(e|c|map|json|stat)(?=\/|$)/g))
    found = match;
  if (!found) return null;
  const rest = topic.slice(found.index + 3).split('/');
  return {
    root: topic.slice(0, found.index),
    kind: rest[0],
    channel: rest[1] ?? null,
    gateway: rest[rest.length - 1] || null,
  };
}

/**
 * Turn one MQTT message into something worth storing, or say why not.
 *
 * `{skip}` reasons: `topic` (not a protobuf topic), `malformed`,
 * `private-channel` (encrypted with a key we do not hold), `opt-out` (the
 * sender did not approve MQTT upload), `unsupported` (a port we do not show),
 * `no-position`.
 *
 * @param {string} topic
 * @param {Buffer} payload
 * @param {{keys?: Buffer[]}} [options]
 * @returns {{skip: string, channel?: string}|{event: object}}
 */
export function decodeMessage(topic, payload, { keys = keyRing() } = {}) {
  const parts = parseTopic(topic);
  if (
    !parts ||
    (parts.kind !== 'e' && parts.kind !== 'c' && parts.kind !== 'map')
  )
    return { skip: 'topic' };
  const envelope = readMessage(payload);
  const packet = message(envelope, 1);
  if (!envelope || !packet) return { skip: 'malformed' };
  const from = num(packet, 1);
  const to = num(packet, 2, BROADCAST);
  const packetId = num(packet, 6);
  if (!finite(from) || from === 0) return { skip: 'malformed' };
  const channelName = str(envelope, 2) || parts.channel || '';
  const gateway = str(envelope, 3) || parts.gateway || null;

  let data = message(packet, 4);
  if (!data) {
    const encrypted = bytes(packet, 5);
    // The public broker strips the payload of ports it does not pass on.
    if (!encrypted) return { skip: 'empty' };
    if (!finite(packetId)) return { skip: 'malformed' };
    // A public-key encrypted direct message is between two people, not a channel.
    if (last(packet, 17) === 1) return { skip: 'private-channel', channelName };
    const hash = num(packet, 3, -1);
    const key = keys.find(
      (candidate) => channelHash(channelName, candidate) === hash,
    );
    if (!key) return { skip: 'private-channel', channelName };
    data = readMessage(decryptPayload(key, packetId, from, encrypted));
    if (!data) return { skip: 'private-channel', channelName };
  }

  const port = num(data, 1);
  if (
    ![
      PORT.TEXT,
      PORT.POSITION,
      PORT.NODEINFO,
      PORT.TELEMETRY,
      PORT.MAP_REPORT,
    ].includes(port)
  )
    return { skip: 'unsupported' };

  // "OK to MQTT": a node that has not approved upload is not shown. A gateway's
  // own packets are exempt: its operator set up the uplink themselves.
  const bitfield = num(data, 9);
  const own = gateway === nodeId(from);
  if (bitfield !== undefined && !(bitfield & 1) && !own)
    return { skip: 'opt-out' };

  const payloadBytes = bytes(data, 2) ?? Buffer.alloc(0);
  // proto3 omits a zero: an absent hop_limit is 0; an absent hop_start is unknown.
  const hopLimit = num(packet, 9, 0);
  const hopStart = num(packet, 15);
  const snr = float32(packet, 8);
  const rssi = int32(packet, 12);
  const meta = {
    from,
    id: nodeId(from),
    to,
    packetId: packetId ?? null,
    channel: channelName,
    root: parts.root,
    gateway,
    snr: finite(snr) && snr !== 0 ? Math.round(snr * 10) / 10 : null,
    rssi: finite(rssi) && rssi !== 0 ? rssi : null,
    hops:
      finite(hopStart) && finite(hopLimit) && hopStart >= hopLimit
        ? hopStart - hopLimit
        : null,
    viaMqtt: last(packet, 14) === 1,
  };

  if (port === PORT.TEXT) {
    const text = sanitizeText(payloadBytes);
    return text
      ? { event: { type: 'text', ...meta, text } }
      : { skip: 'malformed' };
  }
  if (port === PORT.POSITION) {
    const fields = readMessage(payloadBytes);
    const position = fields && readPosition(fields);
    return position
      ? { event: { type: 'position', ...meta, position } }
      : { skip: 'no-position' };
  }
  if (port === PORT.NODEINFO) {
    const fields = readMessage(payloadBytes);
    return fields
      ? { event: { type: 'nodeinfo', ...meta, user: readUser(fields) } }
      : { skip: 'malformed' };
  }
  if (port === PORT.TELEMETRY) {
    const fields = readMessage(payloadBytes);
    const telemetry = fields && readTelemetry(fields);
    return telemetry
      ? { event: { type: 'telemetry', ...meta, telemetry } }
      : { skip: 'malformed' };
  }
  const fields = readMessage(payloadBytes);
  return fields
    ? { event: { type: 'mapreport', ...meta, report: readMapReport(fields) } }
    : { skip: 'malformed' };
}
