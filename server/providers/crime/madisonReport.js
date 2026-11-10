// Reads Madison (AL) Police Department weekly incident reports.
//
// The city posts each week's report as a PDF in its Archive Center. Every
// table row is one charge: a date and time, a case number, an incident
// description that may wrap over several lines, and a block-level location.
// The reports never carry names; the separate arrest reports do, and this
// module never reads those.

const CASE_NUMBER = /^\d{2}M\d{6}$/;
const DATE_START = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const TIME = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\b/i;
const HEADER_WORDS = /^(Date\/Time|Case No\.?|Incident|Location)$/i;
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const decodeEntities = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

function parseLongDate(text) {
  const match = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text || '');
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

/**
 * The weekly reports listed on an Archive Center page, newest first.
 * @returns {Array<{id: number, title: string, startDate: string|null, endDate: string|null}>}
 */
export function parseArchiveList(html) {
  const reports = [];
  const seen = new Set();
  const link = /<a\s+href="[^"]*ADID=(\d+)"[^>]*>\s*<span>([^<]*)<\/span>/gi;
  for (const [, id, rawTitle] of String(html || '').matchAll(link)) {
    const number = Number(id);
    if (!Number.isSafeInteger(number) || seen.has(number)) continue;
    seen.add(number);
    const title = decodeEntities(rawTitle).replace(/\s+/g, ' ').trim();
    const [from, to] = title.split(/\s+to\s+/i);
    reports.push({
      id: number,
      title,
      startDate: parseLongDate(from),
      endDate: parseLongDate(to),
    });
  }
  return reports.sort((a, b) => b.id - a.id);
}

/** Group x positions into columns: [{x, count}], sorted left to right. */
function columnClusters(runs, tolerance = 6) {
  const clusters = [];
  for (const run of [...runs].sort((a, b) => a.x - b.x)) {
    const last = clusters[clusters.length - 1];
    if (last && run.x - last.max <= tolerance) {
      last.max = run.x;
      last.count++;
    } else clusters.push({ x: run.x, max: run.x, count: 1 });
  }
  return clusters;
}

/** Central-time wall clock → epoch milliseconds (DST-aware). */
export function centralTimeToEpoch(year, month, day, hour, minute, second) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAt = (epoch) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      })
        .formatToParts(new Date(epoch))
        .map((part) => [part.type, part.value]),
    );
    const wall = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return wall - epoch;
  };
  let epoch = guess - offsetAt(guess);
  epoch = guess - offsetAt(epoch);
  return epoch;
}

function parseDateTime(text) {
  const date = DATE_START.exec(text);
  if (!date) return null;
  const month = Number(date[1]);
  const day = Number(date[2]);
  const year = Number(date[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hour = 0;
  let minute = 0;
  let second = 0;
  const time = TIME.exec(text.slice(date[0].length));
  if (time) {
    hour = Number(time[1]) % 12;
    if (time[4].toUpperCase() === 'PM') hour += 12;
    minute = Number(time[2]);
    second = Number(time[3] || 0);
  }
  return centralTimeToEpoch(year, month, day, hour, minute, second);
}

const joinText = (parts) => parts.join(' ').replace(/\s+/g, ' ').trim();

/**
 * Rows of one page. Throws when the page does not look like the table. A
 * short last page can have too few runs to find its columns, so it reuses
 * the previous page's (`layout`, which this updates).
 */
function pageRows(runs, layout) {
  const body = runs.filter(
    (run) =>
      !run.text.split('\t').every((cell) => HEADER_WORDS.test(cell.trim())),
  );
  const dates = body.filter((run) => DATE_START.test(run.text));
  if (!dates.length) return [];
  const dateX = Math.min(...dates.map((run) => run.x));
  const cases = body.filter((run) =>
    CASE_NUMBER.test(run.text.split('\t')[0].trim()),
  );
  if (!cases.length) throw new Error('madison_report_no_case_column');
  const caseX = Math.min(...cases.map((run) => run.x));
  if (caseX <= dateX) throw new Error('madison_report_column_order');
  // Columns right of the case number: the first is Incident, the last
  // Location. Clusters of one or two runs are page furniture.
  const right = columnClusters(body.filter((run) => run.x > caseX + 6)).filter(
    (cluster) => cluster.count >= 3,
  );
  const sameLayout =
    layout.caseX !== undefined &&
    Math.abs(layout.caseX - caseX) <= 6 &&
    Math.abs(layout.dateX - dateX) <= 6;
  if (right.length >= 2) {
    Object.assign(layout, {
      dateX,
      caseX,
      incidentX: right[0].x,
      locationX: right[right.length - 1].x,
    });
  } else if (!sameLayout) throw new Error('madison_report_columns_missing');
  const { incidentX, locationX } = layout;
  const near = (x, column) => Math.abs(x - column) <= 6;

  const tops = dates
    .filter((run) => near(run.x, dateX))
    .map((run) => run.y)
    .sort((a, b) => b - a);
  const rows = tops.map((top) => ({
    top,
    date: [],
    caseNumber: '',
    incident: [],
    location: [],
  }));
  const rowFor = (y) => {
    // Rows run top to bottom; a run belongs to the last row starting at or
    // above it (with a little slack for baseline jitter).
    let found = null;
    for (const row of rows) if (y <= row.top + 2) found = row;
    return found;
  };
  for (const run of [...body].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rowFor(run.y);
    if (!row) continue;
    const cells = run.text.split('\t').map((cell) => cell.trim());
    if (near(run.x, dateX)) {
      row.date.push(cells.join(' '));
      continue;
    }
    if (near(run.x, caseX)) {
      const first = cells.shift();
      if (CASE_NUMBER.test(first)) row.caseNumber ||= first;
      else cells.unshift(first);
      if (cells.length) row.incident.push(cells.shift());
      if (cells.length) row.location.push(cells.join(' '));
      continue;
    }
    if (near(run.x, incidentX)) {
      row.incident.push(cells.shift());
      if (cells.length) row.location.push(cells.join(' '));
      continue;
    }
    if (near(run.x, locationX)) row.location.push(cells.join(' '));
  }
  return rows.map((row) => ({
    occurredAt: parseDateTime(joinText(row.date)),
    caseNumber: row.caseNumber,
    incident: joinText(row.incident).toUpperCase(),
    location: joinText(row.location).toUpperCase(),
  }));
}

/**
 * Rows of a whole report, from `extractPdfTextRuns` output. Each row is one
 * charge; several rows can share a case number.
 * @returns {Array<{occurredAt: number|null, caseNumber: string, incident: string, location: string}>}
 */
export function parseIncidentRows(pages) {
  const rows = [];
  const layout = {};
  for (const runs of pages) rows.push(...pageRows(runs, layout));
  const usable = rows.filter(
    (row) => row.caseNumber && row.incident && Number.isFinite(row.occurredAt),
  );
  if (rows.length && usable.length < rows.length * 0.8)
    throw new Error('madison_report_rows_unreadable');
  return usable;
}
