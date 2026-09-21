/**
 * Mobile Radio page. The embedded #radio-panel's content nodes are moved into
 * this page one by one (same nodes, so radioBindings / radioPresentation keep
 * mirroring state across #radio-*, #context-radio-mini-* and #cockpit-radio-*).
 * The compact dock popover (#context-radio-dock) and the cockpit strip stay
 * where they are: the dock is hidden with the desktop rail, the cockpit strip
 * belongs to the Cockpit page.
 *
 * Touch additions: a taller tuner dial (re-measured when it becomes visible),
 * 56px transport, and a searchable station list that tunes through the
 * `gev:radio-tune-to` hook in radioBindings.js.
 */
import { registerMobilePage } from '../sheet.js';
import { movePanel } from '../portal.js';
import {
  RADIO_LIST_PAGE,
  filterStationEntries,
  radioTileSummary,
  stationSignature,
  stationSubtitle,
  stationTitle,
} from '../radio-list.js';

const byId = (id) => document.getElementById(id);
const STATUS_EVENT = 'gev:mobile-status';

let page = null;
let liveCtx = null;

// Latest directory from the tuner (kept even before the page is mounted).
const directory = { stations: [], selectedId: null, signature: '' };
let renderList = () => {};

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function summary() {
  const enabled = byId('radio-enable-btn')?.classList.contains('active');
  return radioTileSummary({
    enabled: enabled === true,
    playing: byId('radio-play-btn')?.classList.contains('active') === true,
    name: byId('radio-station-name')?.textContent,
  });
}

function relayoutTuner() {
  byId('radio-tuner')?.dispatchEvent(
    new CustomEvent('gev:radio-tuner-relayout'),
  );
}

function buildStationList() {
  const section = make('section', 'm-radio__stations');
  section.hidden = true;
  const head = make('div', 'm-radio__stations-head');
  const title = make('strong', '', 'STATIONS');
  const count = make('span', 'm-meta');
  head.append(title, count);
  const search = make('input', 'm-radio__search');
  search.type = 'search';
  search.placeholder = 'Search stations';
  search.setAttribute('aria-label', 'Search stations');
  search.setAttribute('enterkeyhint', 'search');
  search.autocomplete = 'off';
  search.spellcheck = false;
  const list = make('div', 'm-radio__list');
  const more = make('button', 'm-btn m-radio__more', 'Show more');
  more.type = 'button';
  section.append(head, search, list, more);

  let shown = RADIO_LIST_PAGE;
  let signature = '';

  const highlight = () => {
    for (const row of list.children) {
      const current = row.dataset.stationId === String(directory.selectedId);
      row.classList.toggle('is-current', current);
      if (current) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
  };

  const render = (reset = false) => {
    const { stations } = directory;
    section.hidden = stations.length === 0;
    if (!stations.length) {
      list.replaceChildren();
      signature = '';
      return;
    }
    if (reset) shown = RADIO_LIST_PAGE;
    const nextSignature = `${directory.signature}|${search.value}|${shown}`;
    if (nextSignature === signature) {
      highlight();
      return;
    }
    signature = nextSignature;
    const entries = filterStationEntries(stations, search.value);
    count.textContent = search.value.trim()
      ? `${entries.length} of ${stations.length}`
      : String(stations.length);
    const rows = entries.slice(0, shown).map(({ station, index }) => {
      const row = make('button', 'm-radio__item');
      row.type = 'button';
      row.dataset.stationId = String(station.id);
      row.dataset.index = String(index);
      row.append(
        make('span', 'm-radio__item-name', stationTitle(station)),
        make('span', 'm-meta m-radio__item-meta', stationSubtitle(station)),
      );
      return row;
    });
    list.replaceChildren(...rows);
    more.hidden = entries.length <= shown;
    more.textContent = `Show more (${entries.length - shown})`;
    highlight();
  };

  list.addEventListener('click', (event) => {
    const row = event.target.closest?.('.m-radio__item');
    if (!row) return;
    byId('radio-tuner')?.dispatchEvent(
      new CustomEvent('gev:radio-tune-to', {
        detail: { index: Number(row.dataset.index) },
      }),
    );
  });
  more.addEventListener('click', () => {
    shown += RADIO_LIST_PAGE;
    render();
  });
  search.addEventListener('input', () => render(true));

  renderList = () => render();
  render();
  return section;
}

function mount(container, ctx) {
  liveCtx = ctx;
  container.classList.add('m-radio');
  const inner = byId('radio-panel')?.querySelector('.radio-panel-inner');
  if (!inner) {
    container.append(make('p', 'm-meta', 'Radio is unavailable.'));
    return;
  }

  const child = (selector) => inner.querySelector(`:scope > ${selector}`);
  const directoryRow = child('.radio-directory-row');
  const card = byId('radio-station-card');
  const tuner = byId('radio-tuner');
  const transport = child('.radio-transport');
  const volume = child('.radio-volume-row');
  const state = byId('radio-playback-state');
  const links = child('.radio-links');
  const privacy = child('.radio-privacy');

  const stations = buildStationList();
  const order = [
    directoryRow,
    card,
    tuner,
    transport,
    volume,
    state,
    stations,
    links,
    privacy,
  ].filter(Boolean);
  order.forEach((node, index) => {
    if (node === stations) container.append(node);
    else movePanel(node, container, `radio:${index}`);
  });

  // Keep the tuner tape correct whenever its dial is (re)sized or first shown.
  const dial = tuner?.querySelector('.radio-tuner-dial');
  if (dial && typeof ResizeObserver === 'function') {
    new ResizeObserver(relayoutTuner).observe(dial);
  }
}

export function install() {
  if (page) return page;
  page = registerMobilePage({
    id: 'radio',
    title: 'Radio',
    icon: '📻',
    order: 70,
    summary,
    mount,
    onShow(ctx) {
      liveCtx = ctx;
      requestAnimationFrame(relayoutTuner);
    },
    onHide() {
      liveCtx = null;
    },
  });

  const tuner = byId('radio-tuner');
  tuner?.addEventListener('gev:radio-directory', (event) => {
    const stations = event.detail?.stations ?? [];
    directory.stations = stations;
    directory.selectedId = event.detail?.selectedId ?? null;
    directory.signature = stationSignature(stations);
    renderList();
  });

  if (typeof MutationObserver === 'function') {
    const refresh = () => page.notify();
    for (const [id, options] of [
      ['radio-enable-btn', { attributes: true, attributeFilter: ['class'] }],
      ['radio-play-btn', { attributes: true, attributeFilter: ['class'] }],
      [
        'radio-station-name',
        { childList: true, characterData: true, subtree: true },
      ],
    ]) {
      const node = byId(id);
      if (node) new MutationObserver(refresh).observe(node, options);
    }
  }

  // A globe marker tap selects a station: confirm it on the status line.
  document.addEventListener('gev:radio-selected', () => {
    requestAnimationFrame(() => {
      if (liveCtx?.isOpen()) return;
      const name = byId('radio-station-name')?.textContent?.trim();
      if (!name || /^no station selected$/i.test(name)) return;
      window.dispatchEvent(
        new CustomEvent(STATUS_EVENT, {
          detail: { id: 'radio-selected', text: `Radio · ${name}`, ttl: 3000 },
        }),
      );
    });
  });
  return page;
}
