import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { boundingBox, haversineKm, WHOLE_EARTH_KM } from '../aprs/geo.js';
import { compileCallFilter } from '../aprs/store.js';
import { BROADCAST, nodeId, precisionCellKm } from './decode.js';

export const MESH_RETENTION_MS = 24 * 3_600_000;
const FLUSH_MS = 1_000;
const PRUNE_MS = 5 * 60_000;
/** A node adds a track point after moving this far, and no faster than this. */
const TRACK_MIN_MOVE_KM = 0.1;
const TRACK_MIN_GAP_MS = 60_000;
/** Telemetry history is one point per 10 minutes per node. */
const TELEMETRY_MIN_GAP_MS = 10 * 60_000;
/** The same packet reaches us once per gateway that heard it, and per broker. */
const DEDUPE_MS = 10 * 60_000;
export const MAX_NODES = 5000;
export const MAX_TRACK_POINTS = 300;
const MAX_QUEUE = 50_000;

/**
 * Bump when the cache tables or what is written into them changes. The cache
 * is 24 hours of radio traffic, so a mismatch rebuilds it rather than
 * migrating. The `servers` and `meta` tables are configuration, not cache, and
 * are never dropped.
 */
const SCHEMA_VERSION = 1;
const CACHE_TABLES = ['nodes', 'positions', 'telemetry', 'messages'];

const CONFIG_SCHEMA = `
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  tls INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  keys TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  server TEXT NOT NULL,
  long_name TEXT, short_name TEXT, role TEXT, hw_model INTEGER,
  firmware TEXT, region TEXT, preset TEXT,
  lat REAL, lon REAL, alt REAL, precision_bits INTEGER,
  speed REAL, course REAL, pos_at INTEGER,
  first_heard INTEGER NOT NULL,
  last_heard INTEGER NOT NULL,
  packets INTEGER NOT NULL DEFAULT 0,
  trail_points INTEGER NOT NULL DEFAULT 0,
  snr REAL, rssi INTEGER, hops INTEGER, via_mqtt INTEGER NOT NULL DEFAULT 0,
  gateway TEXT, channel TEXT, root TEXT,
  battery INTEGER, voltage REAL, channel_util REAL, air_util REAL, uptime INTEGER,
  env TEXT, telem_at INTEGER
);
CREATE INDEX IF NOT EXISTS nodes_last_heard ON nodes(last_heard);
CREATE INDEX IF NOT EXISTS nodes_server ON nodes(server);
CREATE TABLE IF NOT EXISTS positions (
  node TEXT NOT NULL,
  ts INTEGER NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, alt REAL
);
CREATE INDEX IF NOT EXISTS positions_node_ts ON positions(node, ts);
CREATE INDEX IF NOT EXISTS positions_ts ON positions(ts);
CREATE TABLE IF NOT EXISTS telemetry (
  node TEXT NOT NULL,
  ts INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_node_ts ON telemetry(node, ts);
CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry(ts);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  server TEXT NOT NULL,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  channel TEXT,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_ts ON messages(ts);
CREATE INDEX IF NOT EXISTS messages_src ON messages(src, ts);
`;

/** Lazy so a runtime without node:sqlite degrades the layer instead of the server. */
export async function loadSqlite() {
  const module = await import('node:sqlite');
  return module.DatabaseSync;
}

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function rowToNode(row) {
  return {
    id: row.id,
    server: row.server,
    longName: row.long_name ?? null,
    shortName: row.short_name ?? null,
    role: row.role ?? null,
    hwModel: row.hw_model ?? null,
    firmware: row.firmware ?? null,
    region: row.region ?? null,
    preset: row.preset ?? null,
    lat: row.lat,
    lon: row.lon,
    alt: row.alt ?? null,
    precisionBits: row.precision_bits ?? null,
    precisionKm: precisionCellKm(row.precision_bits),
    speedKmh: row.speed ?? null,
    course: row.course ?? null,
    posAt: row.pos_at ?? null,
    firstHeard: row.first_heard,
    lastHeard: row.last_heard,
    packets: row.packets,
    trailPoints: row.trail_points,
    snr: row.snr ?? null,
    rssi: row.rssi ?? null,
    hops: row.hops ?? null,
    viaMqtt: Boolean(row.via_mqtt),
    gateway: row.gateway ?? null,
    channel: row.channel ?? null,
    root: row.root ?? null,
    battery: row.battery ?? null,
    voltage: row.voltage ?? null,
    channelUtil: row.channel_util ?? null,
    airUtilTx: row.air_util ?? null,
    uptime: row.uptime ?? null,
    env: parseJson(row.env, null),
    telemAt: row.telem_at ?? null,
  };
}

const serverRow = (row) => ({
  id: row.id,
  name: row.name,
  host: row.host,
  port: row.port,
  tls: Boolean(row.tls),
  username: row.username,
  password: row.password,
  topic: row.topic,
  keys: parseJson(row.keys, []),
  enabled: Boolean(row.enabled),
  position: row.position,
});

/**
 * The Meshtastic store: every node heard in the last 24 hours, its track,
 * telemetry history and text messages, in SQLite, plus the list of MQTT servers
 * to listen to.
 *
 * Writes are queued and applied in one transaction a second. Nothing older
 * than the retention window is kept.
 *
 * @param {object} options
 * @param {Function} options.DatabaseSync `node:sqlite`'s constructor.
 * @param {string} options.file Database path, or `:memory:`.
 */
export function createMeshtasticStore({
  DatabaseSync,
  file,
  now = Date.now,
  retentionMs = MESH_RETENTION_MS,
  warn = () => {},
  autoFlush = true,
}) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(CONFIG_SCHEMA);
  if (db.prepare('PRAGMA user_version').get().user_version !== SCHEMA_VERSION) {
    db.exec('BEGIN IMMEDIATE');
    for (const table of CACHE_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.exec(CACHE_SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
    try {
      db.exec('VACUUM');
    } catch {
      /* another process is writing; the space is reused either way */
    }
  } else {
    db.exec(CACHE_SCHEMA);
  }

  const statement = (sql) => db.prepare(sql);
  const touch = statement(`
    INSERT INTO nodes (id, server, first_heard, last_heard, packets,
      snr, rssi, hops, via_mqtt, gateway, channel, root)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      server = excluded.server, last_heard = excluded.last_heard,
      packets = packets + 1,
      snr = COALESCE(excluded.snr, snr), rssi = COALESCE(excluded.rssi, rssi),
      hops = COALESCE(excluded.hops, hops), via_mqtt = excluded.via_mqtt,
      gateway = COALESCE(excluded.gateway, gateway),
      channel = COALESCE(NULLIF(excluded.channel, ''), channel),
      root = excluded.root`);
  const setUser = statement(`
    UPDATE nodes SET
      long_name = COALESCE(?, long_name), short_name = COALESCE(?, short_name),
      role = COALESCE(?, role), hw_model = COALESCE(?, hw_model),
      firmware = COALESCE(?, firmware), region = COALESCE(?, region),
      preset = COALESCE(?, preset)
    WHERE id = ?`);
  const setPosition = statement(`
    UPDATE nodes SET lat = ?, lon = ?, alt = ?, precision_bits = ?,
      speed = ?, course = ?, pos_at = ? WHERE id = ?`);
  const setTelemetry = statement(`
    UPDATE nodes SET
      battery = COALESCE(?, battery), voltage = COALESCE(?, voltage),
      channel_util = COALESCE(?, channel_util), air_util = COALESCE(?, air_util),
      uptime = COALESCE(?, uptime), env = COALESCE(?, env), telem_at = ?
    WHERE id = ?`);
  const addTrailPoint = statement(
    'INSERT INTO positions (node, ts, lat, lon, alt) VALUES (?, ?, ?, ?, ?)',
  );
  const bumpTrail = statement(
    'UPDATE nodes SET trail_points = trail_points + 1 WHERE id = ?',
  );
  const addTelemetry = statement(
    'INSERT INTO telemetry (node, ts, data) VALUES (?, ?, ?)',
  );
  const addMessage = statement(
    'INSERT INTO messages (ts, server, src, dst, channel, text) VALUES (?, ?, ?, ?, ?, ?)',
  );

  /** id -> {lat, lon, ts} of the last track point written. */
  const lastTrail = new Map();
  const lastTelemetry = new Map();
  const seen = new Map();
  let queue = [];
  let dropped = 0;
  let flushTimer = null;
  let pruneTimer = null;
  let closed = false;

  function apply({ event, server, ts }) {
    // The same packet arrives once per gateway (and broker) that heard it.
    const key = `${event.from}:${event.packetId ?? ts}:${event.type}`;
    const before = seen.get(key);
    seen.set(key, ts);
    if (before !== undefined && ts - before < DEDUPE_MS) return;

    // SQLite will not bind `undefined`; an absent optional field is NULL.
    touch.run(
      event.id,
      server,
      ts,
      ts,
      event.snr ?? null,
      event.rssi ?? null,
      event.hops ?? null,
      event.viaMqtt ? 1 : 0,
      event.gateway ?? null,
      event.channel ?? null,
      event.root ?? null,
    );
    if (event.type === 'nodeinfo') {
      const u = event.user;
      setUser.run(
        u.longName,
        u.shortName,
        u.role,
        u.hwModel,
        null,
        null,
        null,
        event.id,
      );
    } else if (event.type === 'mapreport') {
      const r = event.report;
      setUser.run(
        r.longName,
        r.shortName,
        r.role,
        r.hwModel,
        r.firmware,
        r.region,
        r.preset,
        event.id,
      );
      if (r.position) applyPosition(event.id, r.position, ts);
    } else if (event.type === 'position') {
      applyPosition(event.id, event.position, ts);
    } else if (event.type === 'telemetry') {
      const t = event.telemetry;
      const env = {};
      for (const k of ['tempC', 'humidity', 'pressureHpa'])
        if (t[k] !== undefined) env[k] = t[k];
      setTelemetry.run(
        t.battery ?? null,
        t.voltage ?? null,
        t.channelUtil ?? null,
        t.airUtilTx ?? null,
        t.uptime ?? null,
        Object.keys(env).length ? JSON.stringify(env) : null,
        ts,
        event.id,
      );
      const last = lastTelemetry.get(event.id) ?? 0;
      if (ts - last >= TELEMETRY_MIN_GAP_MS) {
        addTelemetry.run(event.id, ts, JSON.stringify(t));
        lastTelemetry.set(event.id, ts);
      }
    } else if (event.type === 'text') {
      addMessage.run(
        ts,
        server,
        event.id,
        event.to === BROADCAST ? '^all' : nodeId(event.to),
        event.channel,
        event.text,
      );
    }
  }

  function applyPosition(id, p, ts) {
    setPosition.run(
      p.lat,
      p.lon,
      p.alt,
      p.precisionBits,
      p.speedKmh,
      p.course,
      ts,
      id,
    );
    const previous = lastTrail.get(id);
    const moved = previous
      ? haversineKm(previous.lat, previous.lon, p.lat, p.lon)
      : Infinity;
    const gap = previous ? ts - previous.ts : Infinity;
    if (!previous || (gap >= TRACK_MIN_GAP_MS && moved >= TRACK_MIN_MOVE_KM)) {
      addTrailPoint.run(id, ts, p.lat, p.lon, p.alt);
      bumpTrail.run(id);
      lastTrail.set(id, { lat: p.lat, lon: p.lon, ts });
    }
  }

  function flush() {
    if (!queue.length) return 0;
    const batch = queue;
    queue = [];
    let written = 0;
    db.exec('BEGIN');
    try {
      for (const item of batch) {
        try {
          apply(item);
          written += 1;
        } catch (error) {
          warn(`[Meshtastic] dropped a packet: ${error?.message || error}`);
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* nothing open */
      }
      warn(`[Meshtastic] batch write failed: ${error?.message || error}`);
      return 0;
    }
    return written;
  }

  function prune() {
    const cutoff = now() - retentionMs;
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM positions WHERE ts < ?').run(cutoff);
      db.prepare('DELETE FROM telemetry WHERE ts < ?').run(cutoff);
      db.prepare('DELETE FROM messages WHERE ts < ?').run(cutoff);
      db.prepare('DELETE FROM nodes WHERE last_heard < ?').run(cutoff);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* nothing open */
      }
      warn(`[Meshtastic] prune failed: ${error?.message || error}`);
    }
    for (const map of [lastTrail, lastTelemetry]) {
      for (const [id, value] of map) {
        const ts = typeof value === 'number' ? value : value.ts;
        if (ts < cutoff) map.delete(id);
      }
    }
    for (const [key, ts] of seen) if (ts < now() - DEDUPE_MS) seen.delete(key);
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* a busy reader; the next prune retries */
    }
  }

  if (autoFlush) {
    flushTimer = setInterval(flush, FLUSH_MS);
    flushTimer.unref?.();
    pruneTimer = setInterval(prune, PRUNE_MS);
    pruneTimer.unref?.();
  }
  prune();

  const placeholders = (list) => list.map(() => '?').join(',');

  return {
    /** Queue a decoded event from `server`; it is written on the next flush. */
    ingest(event, server, ts = now()) {
      if (closed || !event) return;
      if (queue.length >= MAX_QUEUE) {
        dropped += 1;
        return;
      }
      queue.push({ event, server, ts });
    },
    flush,
    prune,

    // -- Server configuration -------------------------------------------------

    listServers() {
      return db
        .prepare('SELECT * FROM servers ORDER BY position, rowid')
        .all()
        .map(serverRow);
    },
    getServer(id) {
      const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
      return row ? serverRow(row) : null;
    },
    saveServer(server) {
      const position =
        server.position ??
        db
          .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM servers')
          .get().n;
      db.prepare(
        `INSERT INTO servers (id, name, host, port, tls, username, password, topic, keys, enabled, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, host = excluded.host, port = excluded.port,
           tls = excluded.tls, username = excluded.username,
           password = excluded.password, topic = excluded.topic,
           keys = excluded.keys, enabled = excluded.enabled`,
      ).run(
        server.id,
        server.name,
        server.host,
        server.port,
        server.tls ? 1 : 0,
        server.username ?? '',
        server.password ?? '',
        server.topic,
        JSON.stringify(server.keys ?? []),
        server.enabled ? 1 : 0,
        position,
      );
      return this.getServer(server.id);
    },
    /** Delete a server and everything it supplied. */
    removeServer(id) {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM servers WHERE id = ?').run(id);
        db.prepare('DELETE FROM nodes WHERE server = ?').run(id);
        db.prepare('DELETE FROM messages WHERE server = ?').run(id);
        db.exec('COMMIT');
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* nothing open */
        }
        throw error;
      }
    },
    getMeta(key) {
      return (
        db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ??
        null
      );
    },
    setMeta(key, value) {
      db.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(key, String(value));
    },

    // -- Reads ------------------------------------------------------------------

    /**
     * Nodes last heard within the window from the listed servers, nearest the
     * centre first.
     * @returns {{nodes: object[], total: number, truncated: boolean}}
     */
    nodes({
      lat = 0,
      lon = 0,
      radiusKm = null,
      sinceMs,
      limit = 3000,
      serverIds = [],
      movingOnly = false,
      filter = null,
    }) {
      if (!serverIds.length) return { nodes: [], total: 0, truncated: false };
      const since = now() - Math.min(sinceMs, retentionMs);
      const where = [
        'last_heard >= ?',
        'lat IS NOT NULL',
        `server IN (${placeholders(serverIds)})`,
      ];
      const args = [since, ...serverIds];
      const whole = radiusKm === null || radiusKm >= WHOLE_EARTH_KM;
      if (!whole) {
        const box = boundingBox(lat, lon, radiusKm);
        where.push('lat BETWEEN ? AND ?');
        args.push(box.lat[0], box.lat[1]);
        if (box.lon) {
          where.push(
            box.wrap ? '(lon >= ? OR lon <= ?)' : 'lon BETWEEN ? AND ?',
          );
          args.push(box.lon[0], box.lon[1]);
        }
      }
      if (movingOnly) where.push('trail_points >= 2');
      const match = compileCallFilter(filter);
      const rows = db
        .prepare(`SELECT * FROM nodes WHERE ${where.join(' AND ')}`)
        .all(...args);
      const found = [];
      for (const row of rows) {
        if (
          match &&
          !(
            match(row.id) ||
            match(row.short_name ?? '') ||
            match(row.long_name ?? '')
          )
        )
          continue;
        const distance = haversineKm(lat, lon, row.lat, row.lon);
        if (!whole && distance > radiusKm) continue;
        found.push({ distance, row });
      }
      found.sort((a, b) => a.distance - b.distance);
      const cap = Math.min(limit, MAX_NODES);
      return {
        total: found.length,
        truncated: found.length > cap,
        nodes: found.slice(0, cap).map(({ distance, row }) => ({
          ...rowToNode(row),
          distanceKm: Math.round(distance * 10) / 10,
        })),
      };
    },

    /** Track points for nodes that have moved, oldest first, thinned to a bounded length. */
    tracks(ids, sinceMs, maxPoints = MAX_TRACK_POINTS) {
      const since = now() - Math.min(sinceMs, retentionMs);
      const out = {};
      const query = db.prepare(
        'SELECT ts, lat, lon, alt FROM positions WHERE node = ? AND ts >= ? ORDER BY ts',
      );
      for (const id of ids) {
        const points = query.all(id, since);
        if (points.length < 2) continue;
        const step = Math.ceil(points.length / maxPoints);
        out[id] = points
          .filter(
            (_, index) => index % step === 0 || index === points.length - 1,
          )
          .map((p) => [p.ts, p.lon, p.lat, p.alt ?? null]);
      }
      return out;
    },

    /** Text messages newer than `after` whose sender has a position inside the radius. */
    messages({
      after = 0,
      lat = 0,
      lon = 0,
      radiusKm = null,
      sinceMs,
      serverIds = [],
      limit = 100,
    }) {
      const latest = db
        .prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages')
        .get().id;
      if (!serverIds.length) return { messages: [], cursor: latest };
      const since = now() - Math.min(sinceMs, retentionMs);
      const rows = db
        .prepare(
          `SELECT m.id, m.ts, m.src, m.dst, m.channel, m.text,
                  s.lat AS slat, s.lon AS slon, s.short_name AS sshort, s.long_name AS slong,
                  d.short_name AS dshort, d.long_name AS dlong
           FROM messages m
           JOIN nodes s ON s.id = m.src AND s.lat IS NOT NULL
           LEFT JOIN nodes d ON d.id = m.dst
           WHERE m.id > ? AND m.ts >= ? AND m.server IN (${placeholders(serverIds)})
           ORDER BY m.id LIMIT ?`,
        )
        .all(after, since, ...serverIds, limit * 4);
      const whole = radiusKm === null || radiusKm >= WHOLE_EARTH_KM;
      const messages = [];
      for (const row of rows) {
        if (!whole && haversineKm(lat, lon, row.slat, row.slon) > radiusKm)
          continue;
        messages.push({
          id: row.id,
          ts: row.ts,
          from: row.src,
          fromLabel: row.sshort || row.slong || row.src,
          to: row.dst,
          toLabel:
            row.dst === '^all'
              ? row.channel
                ? `#${row.channel}`
                : 'everyone'
              : row.dshort || row.dlong || row.dst,
          text: row.text,
          lat: row.slat,
          lon: row.slon,
          anchoredTo: 'sender',
        });
        if (messages.length >= limit) break;
      }
      return { messages, cursor: latest };
    },

    /** Everything held for one node: state, 24 h track, telemetry history, messages. */
    detail(id) {
      const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
      if (!row) return null;
      const since = now() - retentionMs;
      const telemetry = db
        .prepare(
          'SELECT ts, data FROM telemetry WHERE node = ? AND ts >= ? ORDER BY ts LIMIT 600',
        )
        .all(id, since)
        .map((r) => {
          const data = parseJson(r.data, null);
          return data ? { ts: r.ts, ...data } : null;
        })
        .filter(Boolean);
      const messages = db
        .prepare(
          `SELECT id, ts, src, dst, channel, text FROM messages
           WHERE (src = ? OR dst = ?) AND ts >= ? ORDER BY id DESC LIMIT 20`,
        )
        .all(id, id, since)
        .reverse()
        .map((m) => ({
          id: m.id,
          ts: m.ts,
          from: m.src,
          to: m.dst,
          channel: m.channel,
          text: m.text,
        }));
      return {
        node: rowToNode(row),
        track: this.tracks([id], retentionMs)[id] ?? [],
        telemetry,
        messages,
      };
    },

    stats() {
      const count = (table) =>
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      return {
        nodes: count('nodes'),
        positions: count('positions'),
        telemetry: count('telemetry'),
        messages: count('messages'),
        queued: queue.length,
        dropped,
      };
    },

    close() {
      if (closed) return;
      flush();
      closed = true;
      clearInterval(flushTimer);
      clearInterval(pruneTimer);
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}
