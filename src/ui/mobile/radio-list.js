/** Pure helpers for the mobile Radio page (station list and tile summary). */

export const RADIO_LIST_PAGE = 40;

const clean = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export function stationTitle(station) {
  return clean(station?.name) || 'Unnamed station';
}

/** "TAG · TAG / ST · CC" one-liner shown under a station name. */
export function stationSubtitle(station) {
  const tags = Array.isArray(station?.tags)
    ? station.tags.slice(0, 3).map(clean).filter(Boolean)
    : [];
  const place = [station?.state, station?.countryCode]
    .map(clean)
    .filter(Boolean)
    .join(' · ');
  return [tags.join(' · '), place].filter(Boolean).join('  /  ');
}

/**
 * Case-insensitive name/tag/place filter that keeps each station's directory
 * index (the tuner tunes by index, not id).
 * @returns {{station: object, index: number}[]}
 */
export function filterStationEntries(stations, query) {
  const list = Array.isArray(stations) ? stations : [];
  const needle = clean(query).toLowerCase();
  const entries = list.map((station, index) => ({ station, index }));
  if (!needle) return entries;
  return entries.filter(({ station }) =>
    [stationTitle(station), stationSubtitle(station)]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

/** Stable signature so the list only rebuilds when the directory changes. */
export function stationSignature(stations) {
  return (Array.isArray(stations) ? stations : [])
    .map((station) => station?.id)
    .join('|');
}

/**
 * Tile summary. `name` is the selected station name ('' when none).
 * @param {{enabled?: boolean, playing?: boolean, name?: string}} state
 */
export function radioTileSummary({ enabled, playing, name } = {}) {
  if (!enabled) return 'Off';
  const station = clean(name);
  if (!station || /^no station selected$/i.test(station))
    return 'On · pick a station';
  return playing ? `Playing · ${station}` : `On · ${station}`;
}
