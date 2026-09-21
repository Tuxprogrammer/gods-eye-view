import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { boundingBox, haversineKm, WHOLE_EARTH_KM } from './geo.js';

export const APRS_RETENTION_MS = 24 * 3_600_000;
const FLUSH_MS = 1_000;
const PRUNE_MS = 5 * 60_000;
/**
 * A station adds a track point once it has moved this far (GPS jitter on a
 * parked station stays under it, so a fixed station never grows a track)...
 */
const TRACK_MIN_MOVE_KM = 0.05;
/** ...and no faster than this, whatever its beacon rate. */
const TRACK_MIN_GAP_MS = 30_000;
/** Weather history is sampled (one point per 10 min), not logged per packet. */
const WEATHER_MIN_GAP_MS = 10 * 60_000;
/** A retransmitted message inside this window is the same message. */
const MESSAGE_DEDUPE_MS = 10 * 60_000;
export const MAX_STATIONS = 5000;
export const MAX_TRACK_POINTS = 400;
const MAX_QUEUE = 50_000;

/**
 * Bump when the tables or what is written into them changes. The store is a
 * 24-hour cache, so a mismatch rebuilds it rather than migrating: nothing has
 * to be deleted by hand, and old rows can never outlive a parser fix.
 */
const SCHEMA_VERSION = 1;
const TABLES = ['stations', 'positions', 'weather', 'messages'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'station',
  owner TEXT,
  lat REAL, lon REAL, alt REAL, course REAL, speed REAL,
  sym_table TEXT, sym_code TEXT,
  comment TEXT, path TEXT, dest TEXT,
  first_heard INTEGER NOT NULL,
  last_heard INTEGER NOT NULL,
  pos_at INTEGER,
  ambiguity INTEGER NOT NULL DEFAULT 0,
  packets INTEGER NOT NULL DEFAULT 0,
  trail_points INTEGER NOT NULL DEFAULT 0,
  live INTEGER NOT NULL DEFAULT 1,
  status TEXT, status_at INTEGER,
  wx TEXT, wx_at INTEGER
);
CREATE INDEX IF NOT EXISTS stations_last_heard ON stations(last_heard);
CREATE TABLE IF NOT EXISTS positions (
  station TEXT NOT NULL,
  ts INTEGER NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, alt REAL
);
CREATE INDEX IF NOT EXISTS positions_station_ts ON positions(station, ts);
CREATE INDEX IF NOT EXISTS positions_ts ON positions(ts);
CREATE TABLE IF NOT EXISTS weather (
  station TEXT NOT NULL,
  ts INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS weather_station_ts ON weather(station, ts);
CREATE INDEX IF NOT EXISTS weather_ts ON weather(ts);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  text TEXT NOT NULL,
  msgno TEXT
);
CREATE INDEX IF NOT EXISTS messages_ts ON messages(ts);
CREATE INDEX IF NOT EXISTS messages_src ON messages(src, ts);
CREATE INDEX IF NOT EXISTS messages_dst ON messages(dst, ts);
`;

/** Lazy so a runtime without node:sqlite degrades the layer instead of the server. */
export async function loadSqlite() {
  const module = await import('node:sqlite');
  return module.DatabaseSync;
}

function rowToStation(row) {
  let wx = null;
  if (row.wx) {
    try {
      wx = JSON.parse(row.wx);
    } catch {
      wx = null;
    }
  }
  return {
    id: row.id,
    kind: row.kind,
    owner: row.owner ?? null,
    lat: row.lat,
    lon: row.lon,
    alt: row.alt ?? null,
    course: row.course ?? null,
    speed: row.speed ?? null,
    symTable: row.sym_table ?? '/',
    symCode: row.sym_code ?? '.',
    comment: row.comment ?? '',
    path: row.path ?? '',
    dest: row.dest ?? '',
    firstHeard: row.first_heard,
    lastHeard: row.last_heard,
    posAt: row.pos_at ?? null,
    ambiguity: row.ambiguity ?? 0,
    packets: row.packets,
    trailPoints: row.trail_points,
    status: row.status ?? null,
    statusAt: row.status_at ?? null,
    wx,
    wxAt: row.wx_at ?? null,
  };
}

/** Case-insensitive callsign patterns: `W4*`, `*-9`, or an exact `KQ4VYY-9`. */
export function compileCallFilter(patterns) {
  const list = (patterns ?? [])
    .map((p) => String(p).trim().toUpperCase())
    .filter(Boolean);
  if (!list.length) return null;
  const regexes = list.map(
    (p) =>
      new RegExp(
        `^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      ),
  );
  return (id) => regexes.some((re) => re.test(id.toUpperCase()));
}

/**
 * The APRS-IS packet store: every station heard in the last 24 hours, its
 * track, its weather history and the messages it sent, in SQLite.
 *
 * Writes are queued and applied in one transaction a second, so a busy feed is
 * one fsync a second rather than one per packet. Nothing older than the
 * retention window is kept.
 *
 * @param {object} options
 * @param {Function} options.DatabaseSync `node:sqlite`'s constructor.
 * @param {string} options.file Database path, or `:memory:`.
 */
export function createAprsStore({
  DatabaseSync,
  file,
  now = Date.now,
  retentionMs = APRS_RETENTION_MS,
  warn = () => {},
  autoFlush = true,
}) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // Another process (a dev server beside a deployed one) may hold the file.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  if (db.prepare('PRAGMA user_version').get().user_version !== SCHEMA_VERSION) {
    db.exec('BEGIN IMMEDIATE');
    for (const table of TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
    // Dropped tables leave their pages behind; give the disk back.
    try {
      db.exec('VACUUM');
    } catch {
      /* another process is writing; the space is reused either way */
    }
  } else {
    db.exec(SCHEMA);
  }

  const statement = (sql) => db.prepare(sql);
  const upsertPosition = statement(`
    INSERT INTO stations (id, kind, owner, lat, lon, alt, course, speed, sym_table, sym_code,
      comment, path, dest, first_heard, last_heard, pos_at, packets, trail_points, live, ambiguity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind, owner = excluded.owner,
      lat = excluded.lat, lon = excluded.lon, alt = excluded.alt,
      course = excluded.course, speed = excluded.speed,
      sym_table = excluded.sym_table, sym_code = excluded.sym_code,
      comment = COALESCE(NULLIF(excluded.comment, ''), comment),
      path = excluded.path, dest = excluded.dest,
      last_heard = excluded.last_heard, pos_at = excluded.pos_at,
      packets = packets + 1, live = excluded.live,
      ambiguity = excluded.ambiguity`);
  const touch = statement(`
    INSERT INTO stations (id, kind, first_heard, last_heard, packets)
    VALUES (?, 'station', ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET last_heard = excluded.last_heard, packets = packets + 1`);
  const setWeather = statement(
    'UPDATE stations SET wx = ?, wx_at = ? WHERE id = ?',
  );
  const setStatus = statement(
    'UPDATE stations SET status = ?, status_at = ? WHERE id = ?',
  );
  const addTrailPoint = statement(
    'INSERT INTO positions (station, ts, lat, lon, alt) VALUES (?, ?, ?, ?, ?)',
  );
  const bumpTrail = statement(
    'UPDATE stations SET trail_points = trail_points + 1 WHERE id = ?',
  );
  const addWeather = statement(
    'INSERT INTO weather (station, ts, data) VALUES (?, ?, ?)',
  );
  const addMessage = statement(
    'INSERT INTO messages (ts, src, dst, text, msgno) VALUES (?, ?, ?, ?, ?)',
  );

  /** id -> {lat, lon, ts} of the last track point written. */
  const lastTrail = new Map();
  const lastWeather = new Map();
  const recentMessages = new Map();
  let queue = [];
  let dropped = 0;
  let flushTimer = null;
  let pruneTimer = null;
  let closed = false;

  function apply(item) {
    const { packet, ts } = item;
    if (packet.kind === 'position') {
      const p = packet.position;
      upsertPosition.run(
        packet.id,
        packet.object ?? 'station',
        packet.owner ?? null,
        p.lat,
        p.lon,
        p.alt,
        p.course,
        p.speed,
        p.symTable,
        p.symCode,
        p.comment,
        packet.path,
        packet.dest,
        ts,
        ts,
        ts,
        packet.live === false ? 0 : 1,
        p.ambiguity ?? 0,
      );
      const previous = lastTrail.get(packet.id);
      const moved = previous
        ? haversineKm(previous.lat, previous.lon, p.lat, p.lon)
        : Infinity;
      const gap = previous ? ts - previous.ts : Infinity;
      if (
        !previous ||
        (gap >= TRACK_MIN_GAP_MS && moved >= TRACK_MIN_MOVE_KM)
      ) {
        addTrailPoint.run(packet.id, ts, p.lat, p.lon, p.alt);
        bumpTrail.run(packet.id);
        lastTrail.set(packet.id, { lat: p.lat, lon: p.lon, ts });
      }
      if (packet.owner) touch.run(packet.owner, ts, ts);
      if (packet.wx) applyWeather(packet.id, packet.wx, ts);
    } else if (packet.kind === 'weather') {
      touch.run(packet.id, ts, ts);
      applyWeather(packet.id, packet.wx, ts);
    } else if (packet.kind === 'status') {
      touch.run(packet.id, ts, ts);
      setStatus.run(packet.status, ts, packet.id);
    } else if (packet.kind === 'message') {
      touch.run(packet.source, ts, ts);
      const { to, text, msgno } = packet.message;
      const key = `${packet.source}>${to}:${msgno ?? ''}:${text}`;
      const seen = recentMessages.get(key);
      recentMessages.set(key, ts);
      if (seen !== undefined && ts - seen < MESSAGE_DEDUPE_MS) return;
      addMessage.run(ts, packet.source, to, text, msgno);
    }
  }

  function applyWeather(id, wx, ts) {
    setWeather.run(JSON.stringify(wx), ts, id);
    const last = lastWeather.get(id) ?? 0;
    if (ts - last >= WEATHER_MIN_GAP_MS) {
      addWeather.run(id, ts, JSON.stringify(wx));
      lastWeather.set(id, ts);
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
          // One bad packet must not lose the other thousand in the batch.
          warn(`[APRS] dropped a packet: ${error?.message || error}`);
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* nothing open */
      }
      warn(`[APRS] batch write failed: ${error?.message || error}`);
      return 0;
    }
    return written;
  }

  /** Delete everything older than the retention window. */
  function prune() {
    const cutoff = now() - retentionMs;
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM positions WHERE ts < ?').run(cutoff);
      db.prepare('DELETE FROM weather WHERE ts < ?').run(cutoff);
      db.prepare('DELETE FROM messages WHERE ts < ?').run(cutoff);
      db.prepare('DELETE FROM stations WHERE last_heard < ?').run(cutoff);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* nothing open */
      }
      warn(`[APRS] prune failed: ${error?.message || error}`);
    }
    for (const map of [lastTrail, lastWeather]) {
      for (const [id, value] of map) {
        const ts = typeof value === 'number' ? value : value.ts;
        if (ts < cutoff) map.delete(id);
      }
    }
    for (const [key, ts] of recentMessages)
      if (ts < now() - MESSAGE_DEDUPE_MS) recentMessages.delete(key);
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

  return {
    /** Queue a parsed packet; it is written on the next flush. */
    ingest(packet, ts = now()) {
      if (closed || !packet || packet.kind === 'ignored') return;
      if (queue.length >= MAX_QUEUE) {
        dropped += 1;
        return;
      }
      queue.push({ packet, ts });
    },
    flush,
    prune,

    /**
     * Stations last heard within the window, nearest the centre first.
     * @returns {{stations: object[], total: number, truncated: boolean}}
     */
    stations({
      lat = 0,
      lon = 0,
      radiusKm = null,
      sinceMs,
      limit = 3000,
      objects = true,
      weatherOnly = false,
      movingOnly = false,
      calls = null,
    }) {
      const since = now() - Math.min(sinceMs, retentionMs);
      const where = ['last_heard >= ?', 'lat IS NOT NULL', 'live = 1'];
      const args = [since];
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
      if (!objects) where.push("kind = 'station'");
      if (weatherOnly) {
        where.push('wx_at >= ?');
        args.push(since);
      }
      if (movingOnly) where.push('speed >= 2');
      const match = compileCallFilter(calls);
      const rows = db
        .prepare(`SELECT * FROM stations WHERE ${where.join(' AND ')}`)
        .all(...args);
      const found = [];
      for (const row of rows) {
        if (match && !match(row.id)) continue;
        const distance = haversineKm(lat, lon, row.lat, row.lon);
        if (!whole && distance > radiusKm) continue;
        found.push({ distance, row });
      }
      found.sort((a, b) => a.distance - b.distance);
      const cap = Math.min(limit, MAX_STATIONS);
      return {
        total: found.length,
        truncated: found.length > cap,
        stations: found.slice(0, cap).map(({ distance, row }) => ({
          ...rowToStation(row),
          distanceKm: Math.round(distance * 10) / 10,
        })),
      };
    },

    /**
     * Track points for stations that have moved, oldest first, thinned to a
     * bounded length. Stations that never moved have no track.
     * @param {string[]} ids
     * @returns {Record<string, Array<[number, number, number, number|null]>>}
     */
    tracks(ids, sinceMs, maxPoints = MAX_TRACK_POINTS) {
      const since = now() - Math.min(sinceMs, retentionMs);
      const out = {};
      const query = db.prepare(
        'SELECT ts, lat, lon, alt FROM positions WHERE station = ? AND ts >= ? ORDER BY ts',
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

    /**
     * Messages newer than `after`, whose sender (or, failing that, recipient)
     * has a known position inside the radius.
     */
    messages({
      after = 0,
      lat = 0,
      lon = 0,
      radiusKm = null,
      sinceMs,
      limit = 100,
    }) {
      const since = now() - Math.min(sinceMs, retentionMs);
      const rows = db
        .prepare(
          `SELECT m.id, m.ts, m.src, m.dst, m.text,
                  s.lat AS slat, s.lon AS slon, d.lat AS dlat, d.lon AS dlon
           FROM messages m
           LEFT JOIN stations s ON s.id = m.src
           LEFT JOIN stations d ON d.id = m.dst
           WHERE m.id > ? AND m.ts >= ?
           ORDER BY m.id LIMIT ?`,
        )
        .all(after, since, limit * 4);
      const whole = radiusKm === null || radiusKm >= WHOLE_EARTH_KM;
      const messages = [];
      for (const row of rows) {
        const anchor =
          row.slat !== null && row.slat !== undefined
            ? { lat: row.slat, lon: row.slon, of: 'sender' }
            : row.dlat !== null && row.dlat !== undefined
              ? { lat: row.dlat, lon: row.dlon, of: 'recipient' }
              : null;
        if (!anchor) continue;
        if (!whole && haversineKm(lat, lon, anchor.lat, anchor.lon) > radiusKm)
          continue;
        messages.push({
          id: row.id,
          ts: row.ts,
          from: row.src,
          to: row.dst,
          text: row.text,
          lat: anchor.lat,
          lon: anchor.lon,
          anchoredTo: anchor.of,
        });
        if (messages.length >= limit) break;
      }
      const latest = db
        .prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages')
        .get();
      return { messages, cursor: latest.id };
    },

    /** Everything held for one station: state, 24 h track, weather history, messages. */
    detail(id) {
      const row = db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
      if (!row) return null;
      const since = now() - retentionMs;
      const weather = db
        .prepare(
          'SELECT ts, data FROM weather WHERE station = ? AND ts >= ? ORDER BY ts LIMIT 600',
        )
        .all(id, since)
        .map((r) => {
          try {
            return { ts: r.ts, ...JSON.parse(r.data) };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const messages = db
        .prepare(
          `SELECT id, ts, src, dst, text FROM messages
           WHERE (src = ? OR dst = ?) AND ts >= ? ORDER BY id DESC LIMIT 20`,
        )
        .all(id, id, since)
        .reverse()
        .map((m) => ({
          id: m.id,
          ts: m.ts,
          from: m.src,
          to: m.dst,
          text: m.text,
        }));
      return {
        station: rowToStation(row),
        track: this.tracks([id], retentionMs)[id] ?? [],
        weather,
        messages,
      };
    },

    stats() {
      const count = (table) =>
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      return {
        stations: count('stations'),
        positions: count('positions'),
        weather: count('weather'),
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
