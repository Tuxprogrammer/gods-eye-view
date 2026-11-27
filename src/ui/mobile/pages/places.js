/**
 * Mobile Places page: the place you are at, place search, the preset cities
 * and their landmarks, Orbit (keyboard O -> button) and Share
 * (navigator.share -> copy), drawn by PlacesPage.vue over the location
 * controls the Omnibar's place chips use (src/ui/stores/location.js).
 */
import { h, render, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import { registerMobilePage } from '../sheet.js';
import { isMobileUi } from '../../mobileMode.js';
import { placesSummary } from '../places-helpers.js';
import { currentPlace, followShown } from '../placesState.js';
import { useLocationStore } from '../../stores/location.js';
import { applicationPinia } from '../../vueRuntime.js';
import PlacesPage from '../PlacesPage.vue';

let handle = null;
let orbitChipBound = false;

/** The shell binds O on document keydown; a button just replays it. */
function pressOrbitKey() {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true }),
  );
}

/** Tapping the floating "ORBIT" chip (mobile only) stops the orbit. */
function bindOrbitChip() {
  if (orbitChipBound) return;
  orbitChipBound = true;
  document.addEventListener('click', (event) => {
    if (!isMobileUi()) return;
    if (event.target?.closest?.('#orbit-indicator')) pressOrbitKey();
  });
}

export function install() {
  bindOrbitChip();
  const store = useLocationStore(applicationPinia());
  const summary = () => {
    const { city, poi } = currentPlace(store.view);
    return placesSummary(city, poi);
  };
  handle = registerMobilePage({
    id: 'places',
    title: t('Places'),
    icon: '📍',
    order: 10,
    summary,
    mount,
  });
  // Keep the root tile fresh even before the page is opened.
  store.$subscribe(() => handle?.notify());
  // Landmarks opened elsewhere (the Omnibar) after a noted place supersede it.
  watch(() => store.view?.poiCity ?? null, followShown, { flush: 'sync' });
  return handle;
}

function mount(container, ctx) {
  container.classList.add('mp-places');
  const host = document.createElement('div');
  host.className = 'mp-places-host';
  container.append(host);
  render(
    h(PlacesPage, {
      close: () => {
        handle?.notify();
        ctx.close();
      },
    }),
    host,
  );
  handle?.notify();
  return () => render(null, host);
}
