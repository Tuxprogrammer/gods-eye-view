/**
 * APRS packet parser (TNC2 text as delivered by APRS-IS).
 *
 * Pure and dependency-free. Everything that arrives here is text typed into
 * amateur radio gear by strangers, so the parser is strict about coordinates
 * and lengths and returns null rather than guessing.
 *
 * Output units: speed km/h, altitude metres, course degrees. Weather keeps the
 * units APRS transmits (°F, mph, inches, mbar) so nothing is converted twice.
 */

const KNOTS_TO_KMH = 1.852;
const FEET_TO_M = 0.3048;
const MAX_LINE = 1024;

/** Callsigns and object names are short and printable. */
const SOURCE_RE = /^[A-Z0-9][A-Z0-9-]{0,8}$/i;

/** Re-read latin1-decoded socket text as UTF-8 where it holds multibyte text. */
export function fixText(value) {
  const text = String(value ?? '');
  // eslint-disable-next-line no-control-regex
  if (!/[\u0080-ÿ]/.test(text)) return cleanText(text);
  return cleanText(Buffer.from(text, 'latin1').toString('utf8'));
}

function cleanText(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

const validLat = (lat) => Number.isFinite(lat) && lat >= -90 && lat <= 90;
const validLon = (lon) => Number.isFinite(lon) && lon >= -180 && lon <= 180;

/** A (0, 0) fix is a GPS with no lock, not a place. */
function validPosition(lat, lon) {
  return validLat(lat) && validLon(lon) && !(lat === 0 && lon === 0);
}

function base91(text) {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) {
    const digit = text.charCodeAt(i) - 33;
    if (digit < 0 || digit > 90) return NaN;
    value = value * 91 + digit;
  }
  return value;
}

/** `/A=001234` (feet) anywhere in a comment. Returns metres and the remainder. */
function takeAltitude(comment) {
  const match = /\/A=(-\d{5}|\d{6})/.exec(comment);
  if (!match) return { alt: null, comment };
  return {
    alt: Math.round(Number(match[1]) * FEET_TO_M),
    comment: (
      comment.slice(0, match.index) + comment.slice(match.index + 9)
    ).trim(),
  };
}

/**
 * Half the width of the masked box, in minutes, by how many digits an operator
 * blanked: 0.1', 1', 10' and 1 degree wide.
 */
const AMBIGUITY_HALF_BOX_MIN = [0, 0.05, 0.5, 5, 30];

const UNCOMPRESSED_RE =
  /^(\d{2})([\d ]{2})\.([\d ]{2})([NS])(.)(\d{3})([\d ]{2})\.([\d ]{2})([EW])(.)/s;

function parseUncompressed(body) {
  const match = UNCOMPRESSED_RE.exec(body);
  if (!match) return null;
  const blank = (text) => text.replace(/ /g, '0');
  // An operator masks their position by blanking digits from the right; the
  // honest reading is the middle of the box the position could be in.
  const ambiguity = (match[2] + match[3]).split(' ').length - 1;
  const centre = AMBIGUITY_HALF_BOX_MIN[ambiguity] ?? 0;
  let lat =
    Number(match[1]) +
    (Number(`${blank(match[2])}.${blank(match[3])}`) + centre) / 60;
  let lon =
    Number(match[6]) +
    (Number(`${blank(match[7])}.${blank(match[8])}`) + centre) / 60;
  if (match[4] === 'S') lat = -lat;
  if (match[9] === 'W') lon = -lon;
  if (!validPosition(lat, lon)) return null;
  return {
    lat,
    lon,
    symTable: match[5],
    symCode: match[10],
    ambiguity,
    rest: body.slice(19),
    compressed: false,
  };
}

function parseCompressed(body) {
  if (body.length < 13) return null;
  const table = body[0];
  const y = base91(body.slice(1, 5));
  const x = base91(body.slice(5, 9));
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  const lat = 90 - y / 380926;
  const lon = -180 + x / 190463;
  if (!validPosition(lat, lon)) return null;
  const out = {
    lat,
    lon,
    // a-j in the table position are overlay digits 0-9.
    symTable: /[a-j]/.test(table) ? String('abcdefghij'.indexOf(table)) : table,
    symCode: body[9],
    ambiguity: 0,
    rest: body.slice(13),
    compressed: true,
  };
  const c = body.charCodeAt(10) - 33;
  const s = body.charCodeAt(11) - 33;
  const type = body.charCodeAt(12) - 33;
  if (c >= 0 && c <= 89) {
    if ((type & 0x18) === 0x10) {
      out.alt = Math.round(1.002 ** (c * 91 + s) * FEET_TO_M);
    } else {
      out.course = c * 4;
      out.speed = Math.round((1.08 ** s - 1) * KNOTS_TO_KMH * 10) / 10;
    }
  }
  return out;
}

/**
 * Parse a weather string; returns null unless it carries real measurements.
 * `rest` is what followed the measurements (the software tag, e.g. `.DsVP`).
 * @returns {{wx: object, rest: string}|null}
 */
function splitWeather(text) {
  let s = String(text ?? '');
  const wx = {};
  const num = (raw, scale = 1) => {
    if (raw === undefined || !/^-?\d+$/.test(raw.trim())) return null;
    return Number(raw) / scale;
  };
  const lead = /^(\d{3}|\.{3}| {3})\/(\d{3}|\.{3}| {3})/.exec(s);
  if (lead) {
    wx.windDir = num(lead[1]);
    wx.windSpeedMph = num(lead[2]);
    s = s.slice(lead[0].length);
  }
  let pos = 0;
  const take = (letter, length) => {
    if (s[pos] !== letter) return undefined;
    const raw = s.slice(pos + 1, pos + 1 + length);
    if (raw.length < length) return undefined;
    pos += 1 + length;
    return raw;
  };
  const c = take('c', 3);
  if (c !== undefined) wx.windDir = num(c);
  const sp = take('s', 3);
  if (sp !== undefined) wx.windSpeedMph = num(sp);
  const g = take('g', 3);
  if (g !== undefined) wx.gustMph = num(g);
  const t = take('t', 3);
  if (t !== undefined) wx.tempF = num(t);
  const r = take('r', 3);
  if (r !== undefined) wx.rain1hIn = num(r, 100);
  const p = take('p', 3);
  if (p !== undefined) wx.rain24hIn = num(p, 100);
  const P = take('P', 3);
  if (P !== undefined) wx.rainMidnightIn = num(P, 100);
  const h = take('h', 2);
  if (h !== undefined) {
    const humidity = num(h);
    wx.humidity = humidity === 0 ? 100 : humidity;
  }
  const b = take('b', 5);
  if (b !== undefined) wx.pressureMb = num(b, 10);
  const L = take('L', 3);
  if (L !== undefined) wx.luminosity = num(L);
  const l = take('l', 3);
  if (l !== undefined) wx.luminosity = (num(l) ?? 0) + 1000;
  // Some stations reorder fields; recover the two that matter most.
  if (wx.tempF === undefined) {
    const m = /t(-?\d{2,3})/.exec(s);
    if (m) wx.tempF = Number(m[1]);
  }
  if (wx.windSpeedMph === undefined) {
    const m = /(?:^|[^A-Za-z])s(\d{3})/.exec(s);
    if (m) wx.windSpeedMph = Number(m[1]);
  }
  for (const key of Object.keys(wx)) if (wx[key] === null) delete wx[key];
  const measured =
    wx.tempF !== undefined ||
    wx.windSpeedMph !== undefined ||
    wx.pressureMb !== undefined ||
    wx.humidity !== undefined;
  if (!measured) return null;
  const rest = s.slice(pos);
  // Guard against garbage that happens to parse as digits.
  if (wx.tempF !== undefined && (wx.tempF < -130 || wx.tempF > 150))
    return null;
  if (wx.humidity !== undefined && (wx.humidity < 0 || wx.humidity > 100))
    return null;
  if (
    wx.pressureMb !== undefined &&
    (wx.pressureMb < 300 || wx.pressureMb > 1200)
  )
    delete wx.pressureMb;
  return { wx, rest };
}

/** Parse a weather string; returns null unless it carries real measurements. */
export function parseWeather(text) {
  return splitWeather(text)?.wx ?? null;
}

/** Mic-E: the latitude, message bits and hemispheres live in the destination. */
function parseMicE(dest, info) {
  const d = dest.split('-')[0];
  if (d.length < 6 || info.length < 9) return null;
  const digits = [];
  for (let i = 0; i < 6; i += 1) {
    const ch = d[i];
    let digit;
    if (ch >= '0' && ch <= '9') digit = ch.charCodeAt(0) - 48;
    else if (ch >= 'A' && ch <= 'J') digit = ch.charCodeAt(0) - 65;
    else if (ch >= 'P' && ch <= 'Y') digit = ch.charCodeAt(0) - 80;
    else if (ch === 'K' || ch === 'L' || ch === 'Z') digit = 0;
    else return null;
    digits.push(digit);
  }
  const high = (i) => d[i] >= 'P' && d[i] <= 'Z';
  const north = high(3);
  const lonOffset = high(4);
  const west = high(5);
  let lat =
    digits[0] * 10 +
    digits[1] +
    (digits[2] * 10 + digits[3] + digits[4] / 10 + digits[5] / 100) / 60;
  if (!north) lat = -lat;
  let degrees = info.charCodeAt(1) - 28;
  if (lonOffset) degrees += 100;
  if (degrees >= 190) degrees -= 190;
  else if (degrees >= 180) degrees -= 80;
  let minutes = info.charCodeAt(2) - 28;
  if (minutes >= 60) minutes -= 60;
  const hundredths = info.charCodeAt(3) - 28;
  let lon = degrees + (minutes + hundredths / 100) / 60;
  if (west) lon = -lon;
  if (!validPosition(lat, lon)) return null;
  const sp = info.charCodeAt(4) - 28;
  const dc = info.charCodeAt(5) - 28;
  const se = info.charCodeAt(6) - 28;
  let speedKnots = sp * 10 + Math.floor(dc / 10);
  let course = (dc % 10) * 100 + se;
  if (speedKnots >= 800) speedKnots -= 800;
  if (course >= 400) course -= 400;
  let rest = info.slice(9);
  let alt = null;
  const altMatch = /^(.*?)([\x21-\x7b]{3})\}/s.exec(rest);
  if (altMatch) {
    const value = base91(altMatch[2]);
    if (Number.isFinite(value)) alt = value - 10000;
    rest = altMatch[1] + rest.slice(altMatch[0].length);
  }
  return {
    lat,
    lon,
    symCode: info[7],
    symTable: info[8],
    ambiguity: 0,
    compressed: false,
    course: course >= 0 && course <= 360 ? course : null,
    speed: Math.round(speedKnots * KNOTS_TO_KMH * 10) / 10,
    alt,
    rest,
    micE: true,
  };
}

/**
 * Finish a position: course/speed and altitude extensions, then weather when
 * the symbol says this station is one.
 */
function finishPosition(parsed) {
  let { rest } = parsed;
  const out = {
    lat: parsed.lat,
    lon: parsed.lon,
    symTable: parsed.symTable,
    symCode: parsed.symCode,
    ambiguity: parsed.ambiguity,
    alt: parsed.alt ?? null,
    course: parsed.course ?? null,
    speed: parsed.speed ?? null,
    comment: '',
    wx: null,
  };
  if (parsed.symCode === '_') {
    // A weather station's course/speed slot carries the wind.
    const split = splitWeather(rest);
    out.wx = split?.wx ?? null;
    if (parsed.compressed && out.course !== null && out.speed !== null) {
      out.wx = {
        windDir: out.course,
        windSpeedMph: Math.round((out.speed / 1.609344) * 10) / 10,
        ...(out.wx ?? {}),
      };
    }
    out.course = null;
    out.speed = null;
    // The measurements are the data; only the software tag after them is a comment.
    out.comment = fixText(split ? split.rest : rest);
    return out;
  }
  if (!parsed.compressed && !parsed.micE) {
    const ext = /^(\d{3})\/(\d{3})/.exec(rest);
    if (ext) {
      const speed = Number(ext[2]) * KNOTS_TO_KMH;
      out.course = Number(ext[1]) <= 360 ? Number(ext[1]) : null;
      out.speed = Math.round(speed * 10) / 10;
      rest = rest.slice(7);
    }
  }
  const altitude = takeAltitude(rest);
  if (altitude.alt !== null) out.alt = altitude.alt;
  out.comment = fixText(altitude.comment);
  return out;
}

function parsePositionBody(body) {
  if (!body) return null;
  const first = body.charCodeAt(0);
  const parsed =
    first >= 48 && first <= 57
      ? parseUncompressed(body)
      : parseCompressed(body);
  return parsed ? finishPosition(parsed) : null;
}

/** Split `SRC>DEST,PATH:payload`. */
function splitHeader(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const header = line.slice(0, colon);
  const gt = header.indexOf('>');
  if (gt < 1) return null;
  const source = header.slice(0, gt).toUpperCase();
  if (!SOURCE_RE.test(source)) return null;
  const [dest, ...path] = header.slice(gt + 1).split(',');
  return {
    source,
    dest: (dest ?? '').toUpperCase(),
    path: path.join(','),
    payload: line.slice(colon + 1),
  };
}

const TELEMETRY_DEFINITION = /^(PARM|UNIT|EQNS|BITS)\./;

/**
 * Parse one APRS-IS line.
 *
 * @param {string} line
 * @returns {null | {
 *   kind: 'position'|'weather'|'message'|'status'|'ignored',
 *   source: string, dest: string, path: string,
 *   id?: string, owner?: string, object?: 'object'|'item', live?: boolean,
 *   position?: object, wx?: object|null,
 *   message?: {to: string, text: string, msgno: string|null},
 *   status?: string,
 * }}
 */
export function parsePacket(line, depth = 0) {
  if (typeof line !== 'string' || !line || line.length > MAX_LINE) return null;
  if (line.startsWith('#')) return null;
  const head = splitHeader(line);
  if (!head) return null;
  const { source, dest, path, payload } = head;
  if (!payload) return null;
  const base = { source, dest, path };
  const type = payload[0];

  switch (type) {
    case '!':
    case '=': {
      const position = parsePositionBody(payload.slice(1));
      if (!position) return null;
      return {
        ...base,
        kind: 'position',
        id: source,
        position,
        wx: position.wx,
      };
    }
    case '/':
    case '@': {
      const position = parsePositionBody(payload.slice(8));
      if (!position) return null;
      return {
        ...base,
        kind: 'position',
        id: source,
        position,
        wx: position.wx,
      };
    }
    case '`':
    case "'": {
      const decoded = parseMicE(dest, payload);
      if (!decoded) return null;
      const position = finishPosition(decoded);
      return { ...base, kind: 'position', id: source, position, wx: null };
    }
    case ';': {
      // ;NAME_____*DDHHMMzPOSITION  — nine-character name, live flag, timestamp.
      if (payload.length < 18) return null;
      const name = payload.slice(1, 10).trimEnd();
      if (!name || /[\u0000-\u001f]/.test(name)) return null;
      const live = payload[10] === '*';
      const position = parsePositionBody(payload.slice(18));
      if (!position) return null;
      return {
        ...base,
        kind: 'position',
        id: fixText(name).slice(0, 9),
        owner: source,
        object: 'object',
        live,
        position,
        wx: position.wx,
      };
    }
    case ')': {
      const end = payload.slice(1, 11).search(/[!_]/);
      if (end < 3) return null;
      const name = payload.slice(1, 1 + end);
      const live = payload[1 + end] === '!';
      const position = parsePositionBody(payload.slice(2 + end));
      if (!position) return null;
      return {
        ...base,
        kind: 'position',
        id: fixText(name).slice(0, 9),
        owner: source,
        object: 'item',
        live,
        position,
        wx: position.wx,
      };
    }
    case '_': {
      const wx = parseWeather(payload.slice(9));
      if (!wx) return null;
      return { ...base, kind: 'weather', id: source, wx };
    }
    case ':': {
      if (payload.length < 12 || payload[10] !== ':') return null;
      const to = payload.slice(1, 10).trim().toUpperCase();
      let text = payload.slice(11);
      // Acks, rejections and telemetry definitions are protocol, not talk.
      if (
        /^(ack|rej)[A-Za-z0-9]{1,5}$/.test(text) ||
        TELEMETRY_DEFINITION.test(text)
      )
        return { ...base, kind: 'ignored' };
      let msgno = null;
      const brace = text.lastIndexOf('{');
      if (brace >= 0 && text.length - brace <= 7) {
        msgno = text.slice(brace + 1).trim() || null;
        text = text.slice(0, brace);
      }
      text = fixText(text);
      if (!to || !text) return { ...base, kind: 'ignored' };
      return { ...base, kind: 'message', message: { to, text, msgno } };
    }
    case '>': {
      const status = fixText(payload.slice(1));
      if (!status) return null;
      return {
        ...base,
        kind: 'status',
        id: source,
        status: status.slice(0, 200),
      };
    }
    case '}': {
      // Third-party traffic: the inner packet is the station's own report.
      if (depth >= 1) return null;
      return parsePacket(payload.slice(1), depth + 1);
    }
    default:
      return { ...base, kind: 'ignored' };
  }
}
