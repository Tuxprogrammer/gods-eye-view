/**
 * Mobile Places page: the command dock's LOCATION wing as one scrolling page.
 * Reuses the SAME nodes (never clones): #location-mini-status, #location-search,
 * #location-pills, #poi-row are moved in via portal.js, so LocationControls,
 * LocationSearch and the Q/W/E/R/T hotkeys keep working untouched.
 * Also hosts Orbit (keyboard O -> button) and Share (navigator.share -> copy).
 */
import { registerMobilePage } from '../sheet.js';
import { movePanel } from '../portal.js';
import { isMobileUi } from '../../mobileMode.js';
import {
  canWebShare,
  classifySearchOutcome,
  placesSummary,
} from '../places-helpers.js';

const PAGE_KEY = 'places';
let handle = null;
let orbitChipBound = false;

const byId = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The shell binds O on document keydown; a button just replays it. */
function pressOrbitKey() {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true }),
  );
}

function orbitActive() {
  return byId('orbit-indicator')?.classList.contains('active') === true;
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

function observe(node, options, callback) {
  if (!node) return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(node, options);
  return () => observer.disconnect();
}

export function install() {
  bindOrbitChip();
  handle = registerMobilePage({
    id: 'places',
    title: 'Places',
    icon: '📍',
    order: 10,
    summary: () =>
      placesSummary(
        byId('location-mini-city')?.textContent,
        byId('location-mini-poi')?.textContent,
      ),
    mount,
  });
  // Keep the root tile fresh even before the page is opened.
  const notify = () => handle?.notify();
  observe(
    byId('location-mini-status'),
    { childList: true, subtree: true, characterData: true },
    notify,
  );
  return handle;
}

function mount(container, ctx) {
  container.classList.add('mp-places');

  // 1. Current place ------------------------------------------------------
  const here = el('section', 'mp-card mp-here');
  here.append(el('h3', 'mp-heading', 'Current place'));
  const status = byId('location-mini-status');
  if (status) movePanel(status, here, `${PAGE_KEY}:status`);

  // 2. Search ---------------------------------------------------------------
  const search = el('section', 'mp-card mp-search');
  search.append(el('h3', 'mp-heading', 'Search'));
  const input = byId('location-search');
  const box = el('div', 'mp-search-box');
  if (input) {
    input.setAttribute('enterkeyhint', 'search');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('placeholder', 'City, address, or lat, lon');
    input.classList.add('expanded');
    movePanel(input, box, `${PAGE_KEY}:search`);
  }
  const clear = el('button', 'm-btn mp-clear', '✕');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Clear search');
  clear.hidden = true;
  const go = el('button', 'm-btn mp-go', 'Go');
  go.type = 'button';
  go.setAttribute('aria-label', 'Search location');
  box.append(clear, go);
  const message = el('p', 'm-meta mp-message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  search.append(box, message);

  const setMessage = (kind, text) => {
    message.textContent = text;
    message.dataset.kind = kind;
  };
  const submit = () => {
    if (!input || !input.value.trim()) {
      setMessage('error', 'Type a place first.');
      input?.focus();
      return;
    }
    setMessage('info', 'Searching...');
    // The shell submits on Enter keydown; replay it so there is one code path.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    input.blur(); // dismiss the soft keyboard so the map is visible
  };
  go.addEventListener('click', submit);
  clear.addEventListener('click', () => {
    if (!input) return;
    input.value = '';
    clear.hidden = true;
    setMessage('info', '');
    input.focus();
  });
  input?.addEventListener('input', () => {
    clear.hidden = !input.value;
  });
  // "Searching" class is set by LocationSearch and cleared when it settles.
  let wasSearching = false;
  const stopSearchWatch = observe(
    input,
    { attributes: true, attributeFilter: ['class'] },
    () => {
      const searching = input.classList.contains('searching');
      if (searching) setMessage('info', 'Searching...');
      else if (wasSearching) {
        const toast = byId('toast');
        const outcome = classifySearchOutcome(
          toast?.classList.contains('visible') ? toast.textContent : '',
          byId('location-mini-city')?.textContent,
        );
        setMessage(outcome.kind, outcome.text);
        if (outcome.kind === 'ok') ctx.close();
      }
      wasSearching = searching;
    },
  );

  // 3. Cities ------------------------------------------------------------------
  const cities = el('section', 'mp-card mp-cities');
  cities.append(el('h3', 'mp-heading', 'Cities'));
  const pills = byId('location-pills');
  if (pills) movePanel(pills, cities, `${PAGE_KEY}:pills`);

  // 4. Landmarks ---------------------------------------------------------------
  const pois = el('section', 'mp-card mp-pois');
  pois.append(el('h3', 'mp-heading', 'Landmarks'));
  const poiRow = byId('poi-row');
  if (poiRow) {
    movePanel(poiRow, pois, `${PAGE_KEY}:pois`);
    // A landmark tap flies the camera: reveal the map. (Bubbles after the
    // pill's own handler, so navigation has already started.)
    poiRow.addEventListener('click', (event) => {
      if (event.target?.closest?.('.poi-pill')) ctx.close();
    });
  }
  pois.append(
    el('p', 'm-meta mp-hint', 'Pick a city above to list its landmarks.'),
  );
  // A city tap fills #poi-row: bring the landmarks into view.
  pills?.addEventListener('click', (event) => {
    if (event.target?.closest?.('.location-pill'))
      requestAnimationFrame(() =>
        pois.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
      );
  });

  // 5. Tools: orbit + share ------------------------------------------------
  const tools = el('section', 'mp-card mp-tools');
  tools.append(el('h3', 'mp-heading', 'Camera and sharing'));
  const orbit = el('button', 'm-btn mp-tool', '↻ Orbit landmark');
  orbit.type = 'button';
  orbit.setAttribute('aria-pressed', String(orbitActive()));
  orbit.addEventListener('click', () => {
    pressOrbitKey();
    // The shell toggles synchronously; sync after it ran.
    queueMicrotask(syncOrbit);
  });
  const orbitNote = el(
    'p',
    'm-meta mp-hint-line',
    'Circles the last landmark you flew to. Tap the ORBIT chip on the map to stop.',
  );
  const share = el('button', 'm-btn mp-tool', 'Share this view');
  share.type = 'button';
  const shareOut = el('input', 'mp-share-url');
  shareOut.type = 'text';
  shareOut.readOnly = true;
  shareOut.hidden = true;
  shareOut.setAttribute('aria-label', 'Share link');
  shareOut.addEventListener('focus', () => shareOut.select());
  const shareNote = el('p', 'm-meta mp-hint-line');
  share.addEventListener('click', async () => {
    shareNote.textContent = '';
    shareOut.hidden = true;
    const url = window.location.href;
    if (canWebShare()) {
      try {
        await navigator.share({ title: "God's Eye View", url });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    // The existing share button owns link building + clipboard + toast.
    byId('share-btn')?.click();
    if (!window.isSecureContext || !navigator.clipboard) {
      shareOut.value = url;
      shareOut.hidden = false;
      shareNote.textContent =
        'Copying is blocked on this connection. Press and hold the link to copy it.';
    }
  });
  tools.append(orbit, orbitNote, share, shareOut, shareNote);

  function syncOrbit() {
    const on = orbitActive();
    orbit.setAttribute('aria-pressed', String(on));
    orbit.textContent = on ? '↻ Stop orbit' : '↻ Orbit landmark';
  }
  const stopOrbitWatch = observe(
    byId('orbit-indicator'),
    { attributes: true, attributeFilter: ['class'] },
    syncOrbit,
  );

  container.append(here, search, cities, pois, tools);
  syncOrbit();
  handle?.notify();
  return () => {
    stopSearchWatch();
    stopOrbitWatch();
  };
}
