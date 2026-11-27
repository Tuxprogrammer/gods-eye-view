/** Pure helpers for the mobile Places page (unit-tested, no DOM). */
import { t } from '../../i18n/index.js';

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
  return city || poi || t('Search places');
}

/** True when the browser can share (Web Share API level 1, url only). */
export function canWebShare(nav = globalThis.navigator) {
  return typeof nav?.share === 'function';
}
