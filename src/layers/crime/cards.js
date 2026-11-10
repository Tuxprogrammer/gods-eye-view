/** Card model for one selected crime block. Pure: no Cesium types. */
import { formatDate, formatNumber, msg, t, tn } from '../../i18n/index.js';
import { CRIME_CATEGORIES, crimeCategory } from './categories.js';
import { offenseLine, titleCaseLocation } from './model.js';

export const CRIME_OVERLAY_SOURCE_ID = 'crime';
const CARD_CASE_LINES = 4;

/** Category labels in the UI language. */
export const CRIME_CATEGORY_LABELS = Object.freeze({
  violent: msg('Violent'),
  property: msg('Property'),
  drugs: msg('Drugs & alcohol'),
  traffic: msg('Traffic'),
  other: msg('Other'),
});

const reportDay = (epoch) =>
  formatDate(epoch, {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Chicago',
  });

/**
 * The overlay-host entry for one block. The caller adds `position`.
 * @param {object} group - From groupCrimeLocations.
 * @returns {object} World-overlay entry without `position`.
 */
export function buildCrimeCard(group) {
  const total = group.incidents.length;
  const mix = CRIME_CATEGORIES.filter(({ id }) => group.counts[id])
    .map(({ id }) =>
      t('{count} {category}', {
        count: formatNumber(group.counts[id]),
        category: t(CRIME_CATEGORY_LABELS[id]).toLowerCase(),
      }),
    )
    .join(' · ');
  const details = [
    `${tn(total, '{count} case', '{count} cases', {
      count: formatNumber(total),
    })} · ${mix}`,
  ];
  for (const incident of group.incidents.slice(0, CARD_CASE_LINES)) {
    const offense = offenseLine(incident.offenses[0]);
    const extra = incident.offenses.length - 1;
    details.push(
      `${reportDay(incident.t)} · ${offense}${extra > 0 ? ` +${extra}` : ''}`,
    );
  }
  if (total > CARD_CASE_LINES)
    details.push(
      t('+{count} more', { count: formatNumber(total - CARD_CASE_LINES) }),
    );
  details.push(t('Block-level location · weekly Madison PD reports'));
  return {
    id: `crime-card:${group.key}`,
    selected: true,
    interactive: false,
    title: t('MADISON PD · {location}', {
      location: titleCaseLocation(group.location).toUpperCase(),
    }),
    details,
    accent: crimeCategory(group.category).color,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}
