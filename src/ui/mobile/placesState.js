/**
 * @module ui/mobile/placesState
 * @description Fork: the place the phone's Places page names as current. The
 * location controls publish only whose landmarks are shown
 * (src/ui/stores/location.js), so the page notes what it flew to itself;
 * landmarks shown later for another city (the Omnibar's place chips) name
 * that city instead. The note is reactive, so the page's card follows it.
 * A flight that opens no new landmarks (the Omnibar flying to the city
 * already open) publishes nothing, so the note stands until the next one.
 */
import { shallowRef } from 'vue';
import { CITY_POIS } from '../../cityPois.js';

const EMPTY = Object.freeze({ city: '', poi: '', cityId: null, shown: null });
const noted = shallowRef(EMPTY);

/**
 * Note a place the Places page flew to (a search, a city, a landmark).
 * @param {{city?: string, poi?: string}} place
 * @param {{poiCity?: string|null}|null} view The location presentation when
 *   the place was noted: whose landmarks were shown then.
 */
export function notePlace({ city = '', poi = '' } = {}, view = null) {
  const cityId =
    Object.entries(CITY_POIS).find(([, entry]) => entry.name === city)?.[0] ??
    null;
  noted.value = Object.freeze({
    city,
    poi,
    cityId,
    shown: view?.poiCity ?? null,
  });
}

/** The open landmarks changed after the note: none equals this. */
const CHANGED = Symbol('changed');

/**
 * Follow whose landmarks are open. Once they change after a note, any preset
 * city opened later names the current place, even the one open at the note.
 * @param {string|null} poiCity
 */
export function followShown(poiCity) {
  const note = noted.value;
  if (note.shown !== CHANGED && (poiCity ?? null) !== note.shown)
    noted.value = Object.freeze({ ...note, shown: CHANGED });
}

/**
 * The current place for a location presentation: what was noted, unless the
 * landmarks shown changed since to another preset city's.
 * @param {{poiCity?: string|null}|null} view
 * @returns {{city: string, poi: string}}
 */
export function currentPlace(view) {
  const { city, poi, cityId, shown } = noted.value;
  const now = view?.poiCity ?? null;
  if (now && now !== shown && now !== cityId && CITY_POIS[now])
    return { city: CITY_POIS[now].name, poi: '' };
  return { city, poi };
}

/** Forget what was noted (tests). */
export function resetPlaces() {
  noted.value = EMPTY;
}
