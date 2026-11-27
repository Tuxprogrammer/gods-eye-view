/**
 * Mobile Context page: the Global Context mode buttons, the Contacts view
 * (actions + awareness list) and the Space Missions view. The nodes are the
 * SAME ones the desktop right rail owns (moved, never cloned) so contextBindings
 * / contextPresentation / the launches layer keep working unchanged.
 *
 * Why the four view blocks are moved out of #global-context-panel instead of
 * un-collapsing the panel: desktop CSS hides them with
 * `#global-context-panel.collapsed ...`; once they are no longer descendants
 * of the panel those rules simply stop matching, and the panel keeps its
 * persisted collapsed state (share links) untouched.
 */
import { t } from '../../../i18n/index.js';
import { registerMobilePage } from '../sheet.js';
import { movePanel, isPanelMoved } from '../portal.js';
import { contextTileSummary } from '../context-summary.js';
import { watch } from 'vue';
import { useSpaceMissionsStore } from '../../stores/spaceMissions.js';
import { applicationPinia } from '../../vueRuntime.js';

const byId = (id) => document.getElementById(id);

const PEEK_TARGETS = [
  '.space-mission-roster-item',
  '[data-awareness-action="focus"]',
  '.military-awareness-target:not(.unavailable)',
].join(',');

let page = null;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function summary() {
  return contextTileSummary({
    mode: byId('global-context-panel')?.getAttribute('data-context-mode'),
    rosterCount: document.querySelector('[data-mission-roster-count]')
      ?.textContent,
  });
}

/**
 * Mission detail replaces the roster: bring the sheet back to the top.
 * @returns {Function} Stops watching.
 */
function watchMissionDetail(container) {
  const host = byId('space-mission-panel-host');
  if (!host || typeof MutationObserver !== 'function') return () => {};
  const scrollTop = () => {
    const scroller = container.closest('.mobile-sheet__body');
    if (scroller) scroller.scrollTop = 0;
  };
  let watched = null;
  const detailObserver = new MutationObserver(() => {
    if (watched && !watched.hidden) scrollTop();
  });
  const watchDetail = () => {
    const detail = byId('space-mission-panel');
    if (!detail || detail === watched) return;
    watched = detail;
    detailObserver.disconnect();
    detailObserver.observe(detail, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    if (!detail.hidden) scrollTop();
  };
  const hostObserver = new MutationObserver(watchDetail);
  hostObserver.observe(host, { childList: true });
  watchDetail();
  return () => {
    hostObserver.disconnect();
    detailObserver.disconnect();
  };
}

function mount(container, ctx) {
  container.classList.add('m-context');
  let stopMissions = null;

  const modes = document.querySelector('.global-context-modes');
  const standby = byId('context-mode-standby');
  const flights = byId('context-flights-view');
  // Space Missions is a layer with its own panel; its roster and detail
  // (the host inside that panel) come here.
  const missions = byId('space-mission-panel-host');

  if (modes) movePanel(modes, container, 'context-modes');
  // The CONTACTS button explains itself only through a tooltip on desktop.
  container.append(
    make(
      'p',
      'm-meta m-context__help',
      t(
        'Contacts cycles the nearest planes, vessels and installations. Space Missions lists launches and orbital assets. Satellites track independently.',
      ),
    ),
  );
  if (standby) movePanel(standby, container, 'context-standby');
  if (flights) movePanel(flights, container, 'context-flights');
  if (missions) {
    movePanel(missions, container, 'context-missions');
    // Out of its rail panel, which hides while the layer is off, the host
    // hides itself the same way.
    const store = useSpaceMissionsStore(applicationPinia());
    stopMissions = watch(
      () => store.enabled,
      (on) => {
        missions.hidden = !on;
      },
      { immediate: true },
    );
  }

  // Selecting a contact or mission flies the camera: peek so it is visible.
  container.addEventListener('click', (event) => {
    if (event.target.closest?.(PEEK_TARGETS)) ctx.peek(true);
  });
  const stopDetail = watchMissionDetail(container);
  return () => {
    stopDetail();
    stopMissions?.();
  };
}

export function install() {
  if (page) return page;
  // #cockpit-entry is position:fixed. Inside the (transformed, hidden-when-
  // closed) sheet it would be clipped, so keep it on <body>. P-Cockpit owns
  // its final placement; it may re-move it with the same 'cockpit-entry' key.
  const entry = byId('cockpit-entry');
  if (entry && !isPanelMoved('cockpit-entry')) {
    movePanel(entry, document.body, 'cockpit-entry');
  }

  page = registerMobilePage({
    id: 'context',
    title: t('Context'),
    icon: '🌐',
    order: 50,
    summary,
    mount,
  });

  if (typeof MutationObserver === 'function') {
    const refresh = () => page.notify();
    const panel = byId('global-context-panel');
    if (panel) {
      new MutationObserver(refresh).observe(panel, {
        attributes: true,
        attributeFilter: ['data-context-mode'],
      });
    }
    const count = document.querySelector('[data-mission-roster-count]');
    if (count) {
      new MutationObserver(refresh).observe(count, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }
  return page;
}
