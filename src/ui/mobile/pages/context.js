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
import { registerMobilePage } from '../sheet.js';
import { movePanel, isPanelMoved } from '../portal.js';
import { contextTileSummary } from '../context-summary.js';

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

/** Mission detail replaces the roster: bring the sheet back to the top. */
function watchMissionDetail(container) {
  const host = byId('space-mission-panel-host');
  if (!host || typeof MutationObserver !== 'function') return;
  const scrollTop = () => {
    const scroller = container.closest('.mobile-sheet__body');
    if (scroller) scroller.scrollTop = 0;
  };
  const watchDetail = () => {
    const detail = byId('space-mission-panel');
    if (!detail || detail.dataset.mobileWatched) return;
    detail.dataset.mobileWatched = 'true';
    new MutationObserver(() => {
      if (!detail.hidden) scrollTop();
    }).observe(detail, { attributes: true, attributeFilter: ['hidden'] });
    if (!detail.hidden) scrollTop();
  };
  new MutationObserver(watchDetail).observe(host, { childList: true });
  watchDetail();
}

function mount(container, ctx) {
  container.classList.add('m-context');

  const modes = document.querySelector('.global-context-modes');
  const standby = byId('context-mode-standby');
  const flights = byId('context-flights-view');
  const missions = byId('context-missions-view');

  if (modes) movePanel(modes, container, 'context-modes');
  // The CONTACTS button explains itself only through a tooltip on desktop.
  container.append(
    make(
      'p',
      'm-meta m-context__help',
      'Contacts cycles the nearest planes, vessels and installations. Space Missions lists launches and orbital assets. Satellites track independently.',
    ),
  );
  if (standby) movePanel(standby, container, 'context-standby');
  if (flights) movePanel(flights, container, 'context-flights');
  if (missions) movePanel(missions, container, 'context-missions');

  // Selecting a contact or mission flies the camera: peek so it is visible.
  container.addEventListener('click', (event) => {
    if (event.target.closest?.(PEEK_TARGETS)) ctx.peek(true);
  });
  watchMissionDetail(container);
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
    title: 'Context',
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
