// Pure data for the crime layer: payload normalization and the grouping of
// cases into one map marker per block. No Cesium, no i18n.
import { CRIME_CATEGORIES } from './categories.js';

/** Report windows the layer offers, in days. The server keeps one year. */
export const CRIME_WINDOW_DAYS = Object.freeze([7, 30, 90, 365]);
export const DEFAULT_CRIME_WINDOW_DAYS = 30;

const CATEGORY_IDS = CRIME_CATEGORIES.map((category) => category.id);
const finite = (value) => (Number.isFinite(value) ? value : null);

/** Keep the incidents the layer can draw; reject a payload that is not one. */
export function normalizeCrimePayload(payload) {
  if (!payload || !Array.isArray(payload.incidents))
    throw new Error('Malformed crime snapshot');
  const incidents = [];
  for (const raw of payload.incidents) {
    const lon = Number(raw?.lon);
    const lat = Number(raw?.lat);
    const t = Number(raw?.t);
    if (
      typeof raw?.id !== 'string' ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(t)
    )
      continue;
    incidents.push({
      id: raw.id,
      t,
      category: CATEGORY_IDS.includes(raw.category) ? raw.category : 'other',
      offenses: Array.isArray(raw.offenses)
        ? raw.offenses.filter((offense) => typeof offense === 'string')
        : [],
      location: typeof raw.location === 'string' ? raw.location : '',
      lon,
      lat,
    });
  }
  return {
    incidents,
    days: finite(payload.days),
    from: finite(payload.from),
    through: finite(payload.through),
    generatedAt: finite(payload.generatedAt),
    withheld: finite(payload.withheld) ?? 0,
    unmapped: finite(payload.unmapped) ?? 0,
    complete: payload.complete !== false,
    stale: payload.stale === true,
    agency: typeof payload.agency === 'string' ? payload.agency : '',
  };
}

/** The category with the most cases; ties go to the more severe one. */
export function dominantCategory(counts) {
  let best = 'other';
  let bestCount = 0;
  for (const id of CATEGORY_IDS)
    if ((counts[id] || 0) > bestCount) {
      best = id;
      bestCount = counts[id];
    }
  return best;
}

/**
 * One group per geocoded block: its cases newest first, counts by category,
 * and the category that colors its marker.
 * @param {Array<object>} incidents - Normalized incidents.
 * @param {Set<string>|null} [categories] - Categories to keep (null: all).
 */
export function groupCrimeLocations(incidents, categories = null) {
  const groups = new Map();
  for (const incident of incidents) {
    if (categories && !categories.has(incident.category)) continue;
    const key = `${incident.lon.toFixed(5)},${incident.lat.toFixed(5)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        lon: incident.lon,
        lat: incident.lat,
        location: incident.location,
        incidents: [],
        counts: {},
      };
      groups.set(key, group);
    }
    group.incidents.push(incident);
    group.counts[incident.category] =
      (group.counts[incident.category] || 0) + 1;
  }
  return [...groups.values()].map((group) => {
    group.incidents.sort((a, b) => b.t - a.t);
    group.category = dominantCategory(group.counts);
    return group;
  });
}

/** Marker size in pixels: grows with the case count, within 7–20 px. */
export function crimeMarkerPixels(count) {
  return Math.min(20, Math.round(6 + 2.2 * Math.sqrt(Math.max(1, count))));
}

/** "100 BLOCK OF HUGHES RD" → "100 Block of Hughes Rd". */
export function titleCaseLocation(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\bOf\b/g, 'of')
    .replace(/\b(Nw|Ne|Sw|Se)\b/g, (direction) => direction.toUpperCase());
}

/** Offense text from the report, sentence-cased and capped for a card line. */
export function offenseLine(offense, maxLength = 64) {
  const text = String(offense || '')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase())
    .replace(/\b(dui|dv|b&e|chins|thc)\b/gi, (word) => word.toUpperCase());
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
