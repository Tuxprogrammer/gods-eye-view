/** Pure model, formatting and query helpers for the APRS layer. */

export const APRS_LAYER_ID = 'aprs';

/** Radius choices, centred on the point under the camera. `earth` = no limit. */
export const RADIUS_OPTIONS = Object.freeze([
  { value: '25', km: 25, label: '25 km' },
  { value: '50', km: 50, label: '50 km' },
  { value: '100', km: 100, label: '100 km' },
  { value: '250', km: 250, label: '250 km' },
  { value: '500', km: 500, label: '500 km' },
  { value: '1000', km: 1000, label: '1000 km' },
  { value: '2500', km: 2500, label: '2500 km' },
  { value: '5000', km: 5000, label: '5000 km' },
  { value: 'earth', km: null, label: 'Whole Earth' },
]);
export const DEFAULT_RADIUS = '500';

/** How recently a station must have been heard to be shown (minutes). */
export const WINDOW_OPTIONS = Object.freeze([
  { value: '10', minutes: 10, label: '10 min' },
  { value: '30', minutes: 30, label: '30 min' },
  { value: '60', minutes: 60, label: '1 hour' },
  { value: '180', minutes: 180, label: '3 hours' },
  { value: '360', minutes: 360, label: '6 hours' },
  { value: '720', minutes: 720, label: '12 hours' },
  { value: '1440', minutes: 1440, label: '24 hours' },
]);
export const DEFAULT_WINDOW = '60';

/** How far back a station's track is drawn (minutes; 0 = no tracks). */
export const TRACK_OPTIONS = Object.freeze([
  { value: '0', minutes: 0, label: 'Off' },
  { value: '15', minutes: 15, label: '15 min' },
  { value: '30', minutes: 30, label: '30 min' },
  { value: '60', minutes: 60, label: '1 hour' },
  { value: '180', minutes: 180, label: '3 hours' },
  { value: '360', minutes: 360, label: '6 hours' },
  { value: '1440', minutes: 1440, label: '24 hours' },
]);
export const DEFAULT_TRACK = '60';

export const UNIT_OPTIONS = Object.freeze([
  { value: 'imperial', label: 'Imperial' },
  { value: 'metric', label: 'Metric' },
]);
export const DEFAULT_UNITS = 'imperial';

/** Stations are re-read this often while the layer is on and the page visible. */
export const APRS_REFRESH_MS = 15_000;
/** New messages are polled this often when message pop-ups are on. */
export const MESSAGE_POLL_MS = 5_000;
/** A message pop-up stays this long, then fades. */
export const MESSAGE_POPUP_MS = 12_000;
export const MESSAGE_FADE_MS = 1_500;
export const MAX_MESSAGE_POPUPS = 6;
/** Stale when the receiver has heard nothing for this long. */
export const APRS_STALE_AFTER_MS = 5 * 60_000;
/** Above this many stations, clamping every icon to the ground costs too much. */
export const CLAMP_STATION_LIMIT = 1200;
/** Text labels are dropped above this many stations to stay legible. */
export const LABEL_STATION_LIMIT = 1500;

const pick = (options, value, fallback) =>
  options.find((option) => option.value === String(value)) ??
  options.find((option) => option.value === fallback);

export const radiusOption = (value) =>
  pick(RADIUS_OPTIONS, value, DEFAULT_RADIUS);
export const windowOption = (value) =>
  pick(WINDOW_OPTIONS, value, DEFAULT_WINDOW);
export const trackOption = (value) => pick(TRACK_OPTIONS, value, DEFAULT_TRACK);
export const unitOption = (value) => pick(UNIT_OPTIONS, value, DEFAULT_UNITS);

/**
 * The layer's user settings and their defaults.
 * @typedef {object} AprsSettings
 * @property {string} radius
 * @property {string} window
 * @property {string} track
 * @property {string} units
 * @property {string} callFilter Comma separated callsigns / `W4*` patterns.
 * @property {boolean} objects Show objects and items (storms, repeaters, events).
 * @property {boolean} weatherOnly
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
    callFilter: '',
    objects: true,
    weatherOnly: false,
    movingOnly: false,
    labels: true,
    popups: true,
  };
}

/** Comma/space separated callsign patterns, upper-cased, at most twenty. */
export function parseCallFilter(text) {
  return String(text ?? '')
    .split(/[\s,]+/)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => /^[A-Z0-9*-]{1,12}$/.test(part))
    .slice(0, 20);
}

/**
 * Query string for /api/aprs/stations. The centre is the point under the
 * camera, and is rounded so panning a few metres does not change the key.
 */
export function stationsQuery(settings, center) {
  const params = new URLSearchParams();
  params.set('lat', center.lat.toFixed(3));
  params.set('lon', center.lon.toFixed(3));
  params.set('radiusKm', String(radiusOption(settings.radius).value));
  params.set('windowMin', String(windowOption(settings.window).minutes));
  const track = trackOption(settings.track).minutes;
  if (track) params.set('trackMin', String(track));
  if (!settings.objects) params.set('objects', '0');
  if (settings.weatherOnly) params.set('wx', '1');
  if (settings.movingOnly) params.set('moving', '1');
  const calls = parseCallFilter(settings.callFilter);
  if (calls.length) params.set('call', calls.join(','));
  return params.toString();
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function normalizeStation(row) {
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
    kind: row.kind === 'object' || row.kind === 'item' ? row.kind : 'station',
    owner: typeof row.owner === 'string' ? row.owner : null,
    lat: row.lat,
    lon: row.lon,
    alt: finite(row.alt) ? row.alt : null,
    course: finite(row.course) ? row.course : null,
    speed: finite(row.speed) ? row.speed : null,
    symTable: typeof row.symTable === 'string' ? row.symTable : '/',
    symCode: typeof row.symCode === 'string' ? row.symCode : '.',
    comment: typeof row.comment === 'string' ? row.comment : '',
    path: typeof row.path === 'string' ? row.path : '',
    dest: typeof row.dest === 'string' ? row.dest : '',
    firstHeard: finite(row.firstHeard) ? row.firstHeard : null,
    lastHeard: finite(row.lastHeard) ? row.lastHeard : null,
    posAt: finite(row.posAt) ? row.posAt : null,
    ambiguity: finite(row.ambiguity) ? row.ambiguity : 0,
    packets: finite(row.packets) ? row.packets : 0,
    status: typeof row.status === 'string' ? row.status : null,
    wx: row.wx && typeof row.wx === 'object' ? row.wx : null,
    wxAt: finite(row.wxAt) ? row.wxAt : null,
    distanceKm: finite(row.distanceKm) ? row.distanceKm : null,
  };
}

/** Track rows are [ts, lon, lat, alt]; keep only well-formed points. */
export function normalizeTrack(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter(
      (p) =>
        Array.isArray(p) &&
        finite(p[0]) &&
        finite(p[1]) &&
        finite(p[2]) &&
        Math.abs(p[1]) <= 180 &&
        Math.abs(p[2]) <= 90,
    )
    .map((p) => ({ ts: p[0], lon: p[1], lat: p[2] }));
}

export function normalizeFeed(feed) {
  return {
    status: typeof feed?.status === 'string' ? feed.status : 'unknown',
    error: typeof feed?.error === 'string' ? feed.error : null,
    callsign: typeof feed?.callsign === 'string' ? feed.callsign : null,
    server: typeof feed?.server === 'string' ? feed.server : null,
    lastPacketAt: finite(feed?.lastPacketAt) ? feed.lastPacketAt : null,
    packetsPerMinute: finite(feed?.packetsPerMinute)
      ? feed.packetsPerMinute
      : 0,
  };
}

/** @returns {{stations: object[], tracks: Map<string, object[]>, total: number, truncated: boolean, generatedAt: number, feed: object}} */
export function normalizeStationsPayload(payload) {
  if (!payload || !Array.isArray(payload.stations))
    throw new Error('APRS returned no station list');
  const stations = payload.stations.map(normalizeStation).filter(Boolean);
  const tracks = new Map();
  for (const [id, points] of Object.entries(payload.tracks ?? {})) {
    const track = normalizeTrack(points);
    if (track.length >= 2) tracks.set(id, track);
  }
  return {
    stations,
    tracks,
    total: finite(payload.total) ? payload.total : stations.length,
    truncated: Boolean(payload.truncated),
    generatedAt: finite(payload.generatedAt) ? payload.generatedAt : Date.now(),
    feed: normalizeFeed(payload.feed),
  };
}

export function normalizeMessagesPayload(payload) {
  if (!payload || !Array.isArray(payload.messages))
    throw new Error('APRS returned no message list');
  return {
    cursor: finite(payload.cursor) ? payload.cursor : 0,
    messages: payload.messages
      .filter(
        (m) =>
          m &&
          finite(m.id) &&
          typeof m.from === 'string' &&
          typeof m.to === 'string' &&
          typeof m.text === 'string' &&
          finite(m.lat) &&
          finite(m.lon),
      )
      .map((m) => ({
        id: m.id,
        ts: finite(m.ts) ? m.ts : Date.now(),
        from: m.from,
        to: m.to,
        text: m.text,
        lat: m.lat,
        lon: m.lon,
        anchoredTo: m.anchoredTo === 'recipient' ? 'recipient' : 'sender',
      })),
    feed: normalizeFeed(payload.feed),
  };
}

/** Detail payload for one station (weather history, 24 h track, messages). */
export function normalizeDetailPayload(payload) {
  const station = normalizeStation(payload?.station);
  if (!station) throw new Error('APRS returned no station');
  return {
    station,
    track: normalizeTrack(payload.track),
    weather: Array.isArray(payload.weather)
      ? payload.weather.filter((w) => w && finite(w.ts))
      : [],
    messages: Array.isArray(payload.messages)
      ? payload.messages.filter(
          (m) => m && typeof m.from === 'string' && typeof m.text === 'string',
        )
      : [],
  };
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

/** category -> marker colour. Chosen to stay legible over imagery. */
export const CATEGORY_COLORS = Object.freeze({
  weather: '#3fa7ff',
  mobile: '#43d17a',
  fixed: '#c8d3e0',
  infrastructure: '#ffb547',
  object: '#c58bff',
  air: '#5be4e4',
  marine: '#4f7cff',
});

/** APRS symbol code -> [glyph, description, category], primary then alternate table. */
const PRIMARY = {
  '!': ['🚓', 'Police', 'mobile'],
  '#': ['📶', 'Digipeater', 'infrastructure'],
  $: ['☎', 'Phone', 'fixed'],
  "'": ['✈', 'Small aircraft', 'air'],
  '-': ['🏠', 'House', 'fixed'],
  '<': ['🏍', 'Motorcycle', 'mobile'],
  '>': ['🚗', 'Car', 'mobile'],
  '?': ['🖥', 'Server', 'infrastructure'],
  O: ['🎈', 'Balloon', 'air'],
  R: ['🚐', 'Recreational vehicle', 'mobile'],
  U: ['🚌', 'Bus', 'mobile'],
  X: ['🚁', 'Helicopter', 'air'],
  '[': ['🏃', 'Runner', 'mobile'],
  '^': ['✈', 'Aircraft', 'air'],
  _: ['☁', 'Weather station', 'weather'],
  a: ['🚑', 'Ambulance', 'mobile'],
  b: ['🚲', 'Bicycle', 'mobile'],
  f: ['🚒', 'Fire truck', 'mobile'],
  j: ['🚙', 'Jeep', 'mobile'],
  k: ['🚚', 'Truck', 'mobile'],
  r: ['📡', 'Antenna', 'infrastructure'],
  s: ['🚢', 'Ship', 'marine'],
  u: ['🚛', 'Truck', 'mobile'],
  v: ['🚐', 'Van', 'mobile'],
  y: ['📡', 'Yagi', 'infrastructure'],
  Y: ['⛵', 'Yacht', 'marine'],
  '/': ['●', 'Point', 'fixed'],
};
const ALTERNATE = {
  '#': ['📶', 'Digipeater', 'infrastructure'],
  '&': ['🌐', 'Gateway', 'infrastructure'],
  '-': ['🏠', 'House', 'fixed'],
  '>': ['🚗', 'Car', 'mobile'],
  _: ['☁', 'Weather station', 'weather'],
  W: ['⛈', 'Weather service', 'weather'],
  I: ['🌐', 'TCP/IP station', 'infrastructure'],
  n: ['📶', 'Network node', 'infrastructure'],
  0: ['○', 'Circle', 'fixed'],
  '^': ['✈', 'Aircraft', 'air'],
  k: ['🚙', 'SUV', 'mobile'],
  s: ['🛥', 'Boat', 'marine'],
  '`': ['📡', 'Dish antenna', 'infrastructure'],
  '!': ['⚠', 'Emergency', 'object'],
  '<': ['🏳', 'Advisory', 'object'],
};

/**
 * A station's marker: glyph, description and category. Unknown symbols still
 * draw (as a dot in the fixed colour) rather than vanishing.
 */
export function symbolFor(table, code) {
  const map = table === '/' ? PRIMARY : ALTERNATE;
  const hit = map[code] ?? ['●', 'Station', 'fixed'];
  return { glyph: hit[0], label: hit[1], category: hit[2] };
}

/** aprs-symbols sprite sheets: 16 columns of square tiles, indexed by ASCII code - 33. */
export const SYMBOL_SHEET_COLUMNS = 16;
export const SYMBOL_TILE_PX = 64;

const cellOf = (charCode) => {
  const index = charCode - 33;
  return {
    col: index % SYMBOL_SHEET_COLUMNS,
    row: Math.floor(index / SYMBOL_SHEET_COLUMNS),
  };
};

/**
 * Where a symbol is on the aprs.fi sprite sheets, or null when the sheets have
 * no picture for it (the caller then falls back to a drawn glyph).
 * `sheet` 0 is the primary table, 1 the alternate; an overlay character
 * (A-Z, 0-9 in the table position) is drawn from sheet 2 over the alternate
 * symbol.
 * @returns {{sheet: 0|1, col: number, row: number, overlay: {col: number, row: number}|null}|null}
 */
export function symbolCell(table, code) {
  const codePoint = String(code ?? '').charCodeAt(0);
  if (!(codePoint >= 33 && codePoint <= 126)) return null;
  if (table === '/') return { sheet: 0, ...cellOf(codePoint), overlay: null };
  if (table === '\\') return { sheet: 1, ...cellOf(codePoint), overlay: null };
  if (/^[0-9A-Z]$/.test(String(table)))
    return {
      sheet: 1,
      ...cellOf(codePoint),
      overlay: cellOf(String(table).charCodeAt(0)),
    };
  return null;
}

/** The category that decides a marker's colour. */
export function stationCategory(station) {
  if (station.wx || station.symCode === '_') return 'weather';
  if (station.kind !== 'station') return 'object';
  const symbol = symbolFor(station.symTable, station.symCode);
  if (symbol.category === 'fixed' && (station.speed ?? 0) >= 2) return 'mobile';
  return symbol.category;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

/** `2026-09-20 12:29:37` in the viewer's local time, as aprs.fi prints it. */
export function formatTime(ms) {
  if (!finite(ms)) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `4 min ago`, `2 h 5 min ago`. */
export function formatAge(ms, now = Date.now()) {
  if (!finite(ms)) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''} ago`;
}

export function formatCoords(lat, lon) {
  return `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}`;
}

const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const formatSpeed = (kmh, units) =>
  units === 'metric' ? `${round(kmh)} km/h` : `${round(kmh / 1.609344)} MPH`;
export const formatDistance = (km, units) =>
  units === 'metric' ? `${round(km)} km` : `${round(km / 1.609344)} mi`;
export const formatAltitude = (m, units) =>
  units === 'metric' ? `${Math.round(m)} m` : `${Math.round(m / 0.3048)} ft`;
const fahrenheitToC = (f) => ((f - 32) * 5) / 9;
export const formatTemperature = (f, units) =>
  units === 'metric' ? `${round(fahrenheitToC(f))}°C` : `${Math.round(f)}°F`;
export const formatWind = (mph, units) =>
  units === 'metric' ? `${round(mph * 0.44704)} m/s` : `${round(mph)} MPH`;
export const formatRain = (inches, units) =>
  units === 'metric' ? `${round(inches * 25.4)} mm` : `${round(inches)} inches`;
export const formatPressure = (mb) => `${round(mb)} mbar`;

/** How wide the box is around a position the operator chose to blur (km). */
const AMBIGUITY_KM = [0, 0.2, 2, 19, 111];

/** One line of the details card: an array of `{t, b}` text segments (b = bold). */
const text = (t) => ({ t });
const bold = (t) => ({ t, b: true });

/**
 * The hover/click card, laid out like aprs.fi's: first–last heard, what was
 * last heard, the weather in prose, the comment, and the packet path.
 * @returns {{title: string, glyph: string, lines: Array<Array<{t: string, b?: boolean}>>,
 *   hasCharts: boolean}}
 */
export function cardModel(station, units = DEFAULT_UNITS, now = Date.now()) {
  const symbol = symbolFor(station.symTable, station.symCode);
  const lines = [];
  lines.push([
    text(
      `${formatTime(station.firstHeard)} - ${formatTime(station.lastHeard)}`,
    ),
  ]);
  const wx = station.wx;
  if (wx) {
    const line = [
      text('Temperature '),
      bold(wx.tempF !== undefined ? formatTemperature(wx.tempF, units) : '—'),
    ];
    if (wx.humidity !== undefined)
      line.push(text(' Humidity '), bold(`${wx.humidity}%`));
    if (wx.pressureMb !== undefined)
      line.push(text(' Pressure '), bold(formatPressure(wx.pressureMb)));
    lines.push([text(`Weather ${formatTime(station.wxAt)}`)]);
    lines.push(line);
    if (wx.windSpeedMph !== undefined) {
      const wind = [
        text('Wind '),
        bold(
          `${wx.windDir !== undefined ? `${Math.round(wx.windDir)}° ` : ''}${formatWind(wx.windSpeedMph, units)}`,
        ),
      ];
      if (wx.gustMph !== undefined)
        wind.push(
          text(' (Gusts '),
          bold(formatWind(wx.gustMph, units)),
          text(')'),
        );
      lines.push(wind);
    }
    if (wx.rain1hIn !== undefined || wx.rain24hIn !== undefined) {
      const rain = [text('Rain ')];
      const parts = [
        [wx.rain1hIn, '/1h'],
        [wx.rain24hIn, '/24h'],
        [wx.rainMidnightIn, '/since midnight'],
      ].filter(([value]) => value !== undefined);
      parts.forEach(([value, suffix], index) => {
        if (index) rain.push(text(' '));
        rain.push(bold(formatRain(value, units)), text(suffix));
      });
      lines.push(rain);
    }
  } else if (station.posAt !== null) {
    lines.push([
      text(
        `Position ${formatTime(station.posAt)} (${formatAge(station.posAt, now)})`,
      ),
    ]);
  }
  const where = [text(formatCoords(station.lat, station.lon))];
  if (station.ambiguity > 0)
    where.push(
      text(
        ` (operator-masked: within ~${AMBIGUITY_KM[station.ambiguity] ?? 111} km)`,
      ),
    );
  if (station.alt !== null)
    where.push(text(' · '), bold(formatAltitude(station.alt, units)));
  lines.push(where);
  if (station.speed !== null && station.speed >= 1) {
    const move = [bold(formatSpeed(station.speed, units))];
    if (station.course !== null)
      move.push(text(` heading ${Math.round(station.course)}°`));
    lines.push(move);
  }
  if (station.distanceKm !== null)
    lines.push([
      text(`${formatDistance(station.distanceKm, units)} from view centre`),
    ]);
  if (station.comment) lines.push([text(station.comment)]);
  if (station.status) lines.push([text(`Status: ${station.status}`)]);
  if (station.kind !== 'station')
    lines.push([
      text(
        `${station.kind === 'item' ? 'Item' : 'Object'} from ${station.owner ?? 'unknown'}`,
      ),
    ]);
  if (station.dest || station.path)
    lines.push([
      text(
        `[${station.dest || 'APRS'}${station.path ? ` via ${station.path}` : ''}]`,
      ),
    ]);
  return {
    title: station.id,
    glyph: symbol.glyph,
    lines,
    hasCharts: Boolean(wx),
  };
}

// ---------------------------------------------------------------------------
// Weather charts
// ---------------------------------------------------------------------------

const CHARTS = [
  { key: 'tempF', label: 'Temperature', format: formatTemperature },
  { key: 'pressureMb', label: 'Pressure', format: (v) => formatPressure(v) },
  { key: 'humidity', label: 'Humidity', format: (v) => `${Math.round(v)}%` },
  { key: 'windSpeedMph', label: 'Wind', format: formatWind },
];

/**
 * Chart series from a station's 24 h weather history. A series needs two
 * points to be worth drawing.
 * @returns {Array<{key: string, label: string, min: number, max: number,
 *   points: Array<[number, number]>, minText: string, maxText: string}>}
 */
export function chartSeries(history, units = DEFAULT_UNITS) {
  const out = [];
  for (const chart of CHARTS) {
    const points = history
      .filter((row) => finite(row[chart.key]))
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

/** SVG path for a series scaled to a `width` × `height` box (y grows down). */
export function sparklinePath(points, width, height) {
  if (points.length < 2) return '';
  const t0 = points[0][0];
  const span = Math.max(1, points[points.length - 1][0] - t0);
  const values = points.map((p) => p[1]);
  const min = Math.min(...values);
  const range = Math.max(1e-9, Math.max(...values) - min);
  return points
    .map(([t, v], index) => {
      const x = ((t - t0) / span) * width;
      const y = height - ((v - min) / range) * height;
      return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Row status
// ---------------------------------------------------------------------------

/** One honest line about the receiver, for the panel's row. */
export function feedSummary(feed, now = Date.now()) {
  switch (feed.status) {
    case 'live':
      return feed.lastPacketAt && now - feed.lastPacketAt > APRS_STALE_AFTER_MS
        ? 'APRS-IS connected, but no packets lately'
        : `APRS-IS live · ${feed.packetsPerMinute}/min${feed.server ? ` · ${feed.server}` : ''}`;
    case 'missing-config':
      return feed.error || 'Set APRS_CALLSIGN to receive APRS';
    case 'connecting':
    case 'reconnecting':
    case 'starting':
      return 'Connecting to APRS-IS…';
    case 'unverified':
      return 'APRS-IS did not verify the login';
    case 'storage-unavailable':
      return feed.error || 'APRS storage unavailable';
    default:
      return feed.error || 'APRS-IS unavailable';
  }
}

/** Where a station's own label goes: callsign, without the SSID clutter for objects. */
export const stationLabel = (station) => station.id;

/** Cursor-based de-duplication for popups: only messages newer than `cursor`. */
export function newMessages(messages, cursor) {
  return messages.filter((message) => message.id > cursor);
}

/** Is `text` safe to show? It always is as text; this only trims for display. */
export function popupText(text, max = 160) {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
