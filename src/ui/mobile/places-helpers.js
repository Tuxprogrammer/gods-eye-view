/** Pure helpers for the mobile Places page (unit-tested, no DOM). */

/** "📍 Location: Tokyo" -> "Tokyo"; empty/"--" -> "". */
export function cleanCityLine(text) {
  const raw = String(text ?? '')
    .replace(/^\s*📍\s*/u, '')
    .replace(/^\s*location:\s*/i, '')
    .trim();
  return /^-*$/.test(raw) ? '' : raw;
}

/** "Landmark: Eiffel Tower" -> "Eiffel Tower"; empty/"--" -> "". */
export function cleanPoiLine(text) {
  const raw = String(text ?? '')
    .replace(/^\s*landmark:\s*/i, '')
    .trim();
  return /^-*$/.test(raw) ? '' : raw;
}

/** One-line tile summary for the sheet root. */
export function placesSummary(cityText, poiText) {
  const city = cleanCityLine(cityText);
  const poi = cleanPoiLine(poiText);
  if (city && poi) return `${city} - ${poi}`;
  return city || poi || 'Search or pick a city';
}

/**
 * Decide the inline message once a search settled. The shell reports failures
 * only through the toast, so the page reads the toast text.
 * @returns {{kind: 'error'|'ok', text: string}}
 */
export function classifySearchOutcome(toastText, cityText) {
  const toast = String(toastText ?? '').trim();
  if (/not found/i.test(toast))
    return { kind: 'error', text: 'No match. Try a city name or lat, lon.' };
  if (/failed/i.test(toast))
    return { kind: 'error', text: 'Search failed. Check your connection.' };
  const city = cleanCityLine(cityText);
  return { kind: 'ok', text: city ? `Flying to ${city}` : 'Flying there' };
}

/** True when the browser can share (Web Share API level 1, url only). */
export function canWebShare(nav = globalThis.navigator) {
  return typeof nav?.share === 'function';
}
