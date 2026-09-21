import { randomBytes } from 'node:crypto';
import { decodeMessage, expandKey, keyRing } from './decode.js';
import { createMqttClient } from './mqtt.js';

export const MAX_SERVERS = 12;
export const DEFAULT_TOPIC = 'msh/US/#';
/** The Meshtastic project's public credentials, published in its MQTT docs. */
const PUBLIC_LOGIN = Object.freeze({
  username: 'meshdev',
  password: 'large4cats',
});

/**
 * Servers offered on first run. They are added once and never re-added, so a
 * person who deletes one does not get it back. Both start switched off: the
 * person turns on what they want to listen to.
 */
export const SEED_SERVERS = Object.freeze([
  {
    id: 'global',
    name: 'Meshtastic (global)',
    host: 'mqtt.meshtastic.org',
    port: 1883,
    tls: false,
    ...PUBLIC_LOGIN,
    topic: DEFAULT_TOPIC,
    keys: [],
    enabled: false,
  },
  {
    id: 'almesh',
    name: 'ALmesh',
    host: 'mqtt.almesh.net',
    port: 1883,
    tls: false,
    ...PUBLIC_LOGIN,
    topic: DEFAULT_TOPIC,
    keys: [],
    enabled: false,
  },
]);
const SEED_FLAG = 'seeded-v1';

const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
/** A single MQTT topic filter: `#` only last, `+` only as a whole level. */
function validTopic(topic) {
  if (!topic || topic.length > 200 || /[\u0000-\u001f\s]/.test(topic))
    return false;
  const levels = topic.split('/');
  return levels.every(
    (level, index) =>
      (level === '#' ? index === levels.length - 1 : !level.includes('#')) &&
      (level === '+' || !level.includes('+')),
  );
}

/**
 * Check and normalise a server as typed into the panel. Returns the record or
 * `{error}`. `existing` supplies what a partial update leaves unchanged.
 */
export function validateServer(input, existing = null) {
  const merged = { ...existing, ...input };
  const name = String(merged.name ?? '').trim();
  const host = String(merged.host ?? '')
    .trim()
    .toLowerCase();
  const tlsOn = Boolean(merged.tls);
  const port =
    merged.port === undefined || merged.port === '' || merged.port === null
      ? tlsOn
        ? 8883
        : 1883
      : Number(merged.port);
  const topic = String(merged.topic ?? '').trim() || DEFAULT_TOPIC;
  if (!name || name.length > 40)
    return { error: 'Give the server a short name' };
  if (!HOST_PATTERN.test(host))
    return { error: 'That is not a valid host name' };
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { error: 'The port must be 1-65535' };
  if (!validTopic(topic))
    return { error: 'That is not a valid MQTT topic filter (e.g. msh/US/#)' };
  const username = String(merged.username ?? '');
  const password = String(merged.password ?? '');
  if (username.length > 128 || password.length > 128)
    return { error: 'Username or password is too long' };
  const keys = (
    Array.isArray(merged.keys)
      ? merged.keys
      : String(merged.keys ?? '').split(/[\s,]+/)
  )
    .map((key) => String(key).trim())
    .filter(Boolean);
  if (keys.length > 8) return { error: 'At most 8 channel keys' };
  if (keys.some((key) => !expandKey(key)))
    return { error: 'A channel key must be base64 (16 or 32 bytes) or AQ==' };
  return {
    server: {
      id: merged.id,
      name,
      host,
      port,
      tls: tlsOn,
      username,
      password,
      topic,
      keys,
      enabled: Boolean(merged.enabled),
    },
  };
}

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'server';

/**
 * Owns the list of MQTT servers and one live connection per enabled server.
 * The list lives in the store (so it survives restarts and the 24-hour cache
 * rebuild); the connections are a projection of it.
 *
 * @param {object} options
 * @param {object} options.store
 */
export function createServerManager({
  store,
  now = Date.now,
  createClient = createMqttClient,
  warn = () => {},
}) {
  /** id -> {client, keys, counters} */
  const live = new Map();

  function connect(server) {
    disconnect(server.id);
    if (!server.enabled) return;
    const counters = {
      decoded: 0,
      optOuts: 0,
      unsupported: 0,
      malformed: 0,
      privateChannels: new Set(),
    };
    const keys = keyRing(server.keys);
    const client = createClient({
      host: server.host,
      port: server.port,
      tls: server.tls,
      username: server.username,
      password: server.password,
      topics: [server.topic],
      warn,
      onMessage: (topic, payload, receivedAt) => {
        const result = decodeMessage(topic, payload, { keys });
        if (result.event) {
          counters.decoded += 1;
          store.ingest(result.event, server.id, receivedAt);
        } else if (result.skip === 'opt-out') counters.optOuts += 1;
        else if (result.skip === 'private-channel') {
          if (counters.privateChannels.size < 50)
            counters.privateChannels.add(result.channelName || '?');
        } else if (result.skip === 'unsupported') counters.unsupported += 1;
        else if (result.skip === 'malformed') counters.malformed += 1;
      },
    });
    live.set(server.id, { client, counters });
    client.start();
  }

  function disconnect(id) {
    const held = live.get(id);
    if (!held) return;
    held.client.stop();
    live.delete(id);
  }

  /** What the panel may see: never the password or the channel keys. */
  function publicView(server) {
    const held = live.get(server.id);
    const snapshot = held?.client.snapshot() ?? null;
    return {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      tls: server.tls,
      username: server.username,
      hasPassword: Boolean(server.password),
      keyCount: server.keys.length,
      topic: server.topic,
      enabled: server.enabled,
      status: server.enabled ? (snapshot?.status ?? 'connecting') : 'off',
      error: snapshot?.error ?? null,
      lastMessageAt: snapshot?.lastMessageAt ?? null,
      messagesPerMinute: snapshot?.messagesPerMinute ?? 0,
      decoded: held?.counters.decoded ?? 0,
      optOuts: held?.counters.optOuts ?? 0,
      privateChannels: held ? [...held.counters.privateChannels] : [],
    };
  }

  return {
    /** Add the seed servers once, then connect everything that is switched on. */
    start() {
      if (!store.getMeta(SEED_FLAG)) {
        for (const seed of SEED_SERVERS) store.saveServer(seed);
        store.setMeta(SEED_FLAG, now());
      }
      for (const server of store.listServers()) connect(server);
    },
    list() {
      return store.listServers().map(publicView);
    },
    enabledIds() {
      return store
        .listServers()
        .filter((server) => server.enabled)
        .map((server) => server.id);
    },
    /** @returns {{server: object}|{error: string, status: number}} */
    add(input) {
      if (store.listServers().length >= MAX_SERVERS)
        return { error: `At most ${MAX_SERVERS} servers`, status: 400 };
      const checked = validateServer({
        ...input,
        id: `${slug(String(input?.name ?? ''))}-${randomBytes(3).toString('hex')}`,
        enabled: input?.enabled ?? true,
      });
      if (checked.error) return { error: checked.error, status: 400 };
      const saved = store.saveServer(checked.server);
      connect(saved);
      return { server: publicView(saved) };
    },
    update(id, patch) {
      const existing = store.getServer(id);
      if (!existing) return { error: 'No such server', status: 404 };
      // An empty password field on an edit means "leave it as it is".
      const cleaned = { ...patch };
      if (cleaned.password === undefined || cleaned.password === '')
        delete cleaned.password;
      const checked = validateServer({ ...cleaned, id }, existing);
      if (checked.error) return { error: checked.error, status: 400 };
      const saved = store.saveServer(checked.server);
      connect(saved);
      return { server: publicView(saved) };
    },
    remove(id) {
      if (!store.getServer(id)) return { error: 'No such server', status: 404 };
      disconnect(id);
      store.removeServer(id);
      return { ok: true };
    },
    dispose() {
      for (const id of [...live.keys()]) disconnect(id);
    },
  };
}
