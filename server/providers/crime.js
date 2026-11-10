// /api/crime: Madison (AL) Police Department weekly incident reports,
// geocoded to the block.
//
// The city publishes one PDF a week in its Archive Center. This provider
// keeps the last year of them: it reads the archive list, fetches each
// report it has not seen (one at a time), extracts the table, and geocodes
// the block locations with the Madison County E911 locator. Parsed reports
// and geocodes live on disk, so a restart re-reads nothing.
//
// Privacy: the incident reports carry no names, and the arrest reports
// (which do) are never read. Cases involving sex offenses, children, deaths
// or missing people are not published at all, only counted.
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  readResponseBytesCapped,
  readResponseTextCapped,
} from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { providerUserAgent } from './common/userAgent.js';
import { extractPdfTextRuns } from './crime/pdfText.js';
import { parseArchiveList, parseIncidentRows } from './crime/madisonReport.js';
import { createCrimeGeocoder, locationQuery } from './crime/geocode.js';
import {
  classifyOffense,
  isSensitiveOffense,
  mostSevereCategory,
} from '../../src/layers/crime/categories.js';

const ORIGIN = 'https://www.madisonal.gov';
export const MADISON_ARCHIVE_URL = `${ORIGIN}/Archive.aspx?AMID=67`;
const reportUrl = (id) => `${ORIGIN}/ArchiveCenter/ViewFile/Item/${id}`;

const DAY_MS = 24 * 60 * 60 * 1000;
/** The layer never holds more than a year of reports. */
export const CRIME_MAX_DAYS = 365;
const DEFAULT_DAYS = 30;
const MAX_REPORTS = 60;
/** Reports are weekly; look for a new one hourly. */
const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
/** On a cold start, publish once the newest few weeks are in. */
const EARLY_PUBLISH_REPORTS = 5;
const REPORT_CACHE_VERSION = 1;
const MIB = 1024 * 1024;

const isoDay = (epoch) => new Date(epoch).toISOString().slice(0, 10);

/** Rows → cases: one entry per case number, with its charges. */
export function crimeCasesFromRows(rows) {
  const cases = new Map();
  for (const row of rows) {
    let entry = cases.get(row.caseNumber);
    if (!entry) {
      entry = {
        id: row.caseNumber,
        t: row.occurredAt,
        offenses: [],
        location: row.location,
        sensitive: false,
      };
      cases.set(row.caseNumber, entry);
    }
    entry.t = Math.min(entry.t, row.occurredAt);
    if (!entry.location && row.location) entry.location = row.location;
    if (row.incident && !entry.offenses.includes(row.incident))
      entry.offenses.push(row.incident);
    if (isSensitiveOffense(row.incident)) entry.sensitive = true;
  }
  return [...cases.values()].map((entry) => ({
    ...entry,
    category: mostSevereCategory(entry.offenses.map(classifyOffense)),
  }));
}

/** Public payload for a window of `days` ending at the newest case. */
export function crimeWindowPayload(snapshot, days) {
  const through = snapshot.through ?? 0;
  const from = through - days * DAY_MS;
  const inWindow = snapshot.cases.filter((entry) => entry.t > from);
  const incidents = [];
  let withheld = 0;
  let unmapped = 0;
  for (const entry of inWindow) {
    if (entry.sensitive) withheld++;
    else if (!entry.point) unmapped++;
    else
      incidents.push({
        id: entry.id,
        t: entry.t,
        category: entry.category,
        offenses: entry.offenses,
        location: entry.location,
        lon: entry.point.lon,
        lat: entry.point.lat,
      });
  }
  incidents.sort((a, b) => b.t - a.t);
  return {
    source: 'madison-pd',
    agency: 'Madison Police Department (AL)',
    generatedAt: snapshot.builtAt,
    days,
    from: through ? Math.max(from, snapshot.earliest ?? from) : null,
    through: through || null,
    complete: snapshot.complete,
    reportCount: snapshot.reports.length,
    failedReports: snapshot.failedReports,
    latestReport: snapshot.reports[0] || null,
    withheld,
    unmapped,
    incidents,
  };
}

export function crimeProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  cacheDir = path.join(process.cwd(), '.gev-cache', 'crime'),
  geocoder = null,
} = {}) {
  const reportDir = cacheDir ? path.join(cacheDir, 'madison') : null;
  const locator =
    geocoder ||
    createCrimeGeocoder({
      fetchImpl,
      now,
      cachePath: cacheDir ? path.join(cacheDir, 'geocode.json') : null,
    });
  const memoryReports = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 1200 });
  let snapshot = null;
  let refreshing = null;
  let lastAttempt = 0;
  let lastError = null;
  let waiters = [];

  const request = (url, accept) =>
    fetchImpl(url, {
      headers: { 'User-Agent': providerUserAgent('crime'), Accept: accept },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });

  async function fetchArchiveList() {
    const response = await request(MADISON_ARCHIVE_URL, 'text/html');
    if (!response.ok) throw new Error(`archive_http_${response.status}`);
    return parseArchiveList(await readResponseTextCapped(response, 4 * MIB));
  }

  async function readCachedReport(id) {
    if (memoryReports.has(id)) return memoryReports.get(id);
    if (!reportDir) return null;
    try {
      const saved = JSON.parse(
        await readFile(path.join(reportDir, `${id}.json`), 'utf8'),
      );
      if (saved?.version !== REPORT_CACHE_VERSION || !Array.isArray(saved.rows))
        return null;
      memoryReports.set(id, saved);
      return saved;
    } catch {
      return null;
    }
  }

  async function writeCachedReport(report) {
    memoryReports.set(report.id, report);
    if (!reportDir) return;
    await mkdir(reportDir, { recursive: true });
    const target = path.join(reportDir, `${report.id}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(report));
    await rename(temporary, target);
  }

  async function loadReport(entry) {
    const cached = await readCachedReport(entry.id);
    if (cached) return cached;
    const response = await request(reportUrl(entry.id), 'application/pdf');
    if (!response.ok) throw new Error(`report_http_${response.status}`);
    const bytes = await readResponseBytesCapped(response, 20 * MIB);
    const rows = parseIncidentRows(extractPdfTextRuns(bytes));
    const report = { version: REPORT_CACHE_VERSION, ...entry, rows };
    await writeCachedReport(report);
    return report;
  }

  /** Forget reports that have aged out of the year. */
  async function prune(keepIds) {
    for (const id of memoryReports.keys())
      if (!keepIds.has(id)) memoryReports.delete(id);
    if (!reportDir) return;
    let names = [];
    try {
      names = await readdir(reportDir);
    } catch {
      return;
    }
    for (const name of names) {
      const id = Number(name.replace(/\.json$/, ''));
      if (
        name.endsWith('.json') &&
        Number.isSafeInteger(id) &&
        !keepIds.has(id)
      )
        await rm(path.join(reportDir, name), { force: true }).catch(() => {});
    }
  }

  async function publish(reports, failedReports, complete) {
    const cutoff = now() - CRIME_MAX_DAYS * DAY_MS;
    const rows = reports
      .flatMap((report) => report.rows)
      .filter(
        (row) => row.occurredAt >= cutoff && row.occurredAt <= now() + DAY_MS,
      );
    const cases = crimeCasesFromRows(rows);
    const queries = new Map(
      cases.map((entry) => [entry, locationQuery(entry.location)]),
    );
    const points = await locator.locate(
      cases
        .filter((entry) => !entry.sensitive)
        .map((entry) => queries.get(entry))
        .filter(Boolean),
    );
    for (const entry of cases)
      entry.point = entry.sensitive
        ? null
        : points.get(queries.get(entry)) || null;
    const times = cases.map((entry) => entry.t);
    snapshot = {
      builtAt: now(),
      complete,
      failedReports,
      through: times.length ? Math.max(...times) : null,
      earliest: times.length ? Math.min(...times) : null,
      reports: reports.map(({ id, title, startDate, endDate }) => ({
        id,
        title,
        startDate,
        endDate,
      })),
      cases,
    };
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  }

  async function refresh() {
    lastAttempt = now();
    try {
      const cutoffDay = isoDay(now() - CRIME_MAX_DAYS * DAY_MS);
      const wanted = (await fetchArchiveList())
        .filter(
          (entry) => (entry.endDate || entry.startDate || '') >= cutoffDay,
        )
        .slice(0, MAX_REPORTS);
      if (!wanted.length) throw new Error('madison_no_reports');
      const loaded = [];
      let failed = 0;
      for (const entry of wanted) {
        try {
          loaded.push(await loadReport(entry));
        } catch {
          failed++;
        }
        if (!snapshot && loaded.length === EARLY_PUBLISH_REPORTS)
          await publish(loaded, failed, false);
      }
      if (!loaded.length) throw new Error('madison_reports_unreadable');
      await publish(loaded, failed, true);
      await prune(new Set(wanted.map((entry) => entry.id)));
      lastError = null;
    } catch (error) {
      lastError = error;
      throw error;
    }
  }

  function ensureRefresh() {
    if (refreshing) return refreshing;
    const due = snapshot ? now() - snapshot.builtAt >= REFRESH_MS : true;
    const backoff = lastError && now() - lastAttempt < RETRY_MS;
    if (!due || (backoff && snapshot)) return null;
    refreshing = refresh().finally(() => {
      refreshing = null;
    });
    // Background refreshes report through lastError, not the caller.
    refreshing.catch(() => {});
    return refreshing;
  }

  async function firstSnapshot() {
    if (snapshot) return;
    const run = ensureRefresh();
    if (!run) throw lastError || new Error('madison_unavailable');
    await Promise.race([run, new Promise((resolve) => waiters.push(resolve))]);
  }

  async function handler(req, res) {
    const json = (status, value, stale = false) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
        ...(stale ? { 'X-Data-Stale': 'true' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/' && url.pathname !== '')
      return json(404, { error: 'unknown_route' });
    const daysParam = url.searchParams.get('days');
    const days = daysParam === null ? DEFAULT_DAYS : Number(daysParam);
    if (!Number.isInteger(days) || days < 1 || days > CRIME_MAX_DAYS)
      return json(400, { error: 'invalid_days' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      ensureRefresh();
      await firstSnapshot();
    } catch {
      // Fall through: serve whatever exists.
    }
    if (!snapshot) return json(502, { error: 'crime_unavailable' });
    const stale = Boolean(lastError);
    json(200, { ...crimeWindowPayload(snapshot, days), stale }, stale);
  }

  return {
    name: 'crime',
    configureServer({ middlewares }) {
      middlewares.use('/api/crime', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/crime', handler);
    },
  };
}
