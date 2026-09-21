/**
 * Mobile cockpit: on-map control cluster plus a compact bottom drawer.
 *
 * Built once when the mobile UI activates. Nothing here is visible on desktop
 * (CSS hides every created node under html:not([data-ui='mobile'])).
 *
 * Existing cockpit nodes are MOVED (portal.js), never cloned, so every id the
 * cockpit controller / radio bindings / display portal look up stays unique:
 *   #cockpit-context, .cockpit-position-readout  -> Contact tab
 *   #cockpit-route                               -> Route tab
 *   #cockpit-signal-stream (signals/news/local)  -> Brief tab
 *   #cockpit-display-panel (CockpitDisplayPortal slots) -> Display tab
 *   #cockpit-radio-panel                         -> Radio tab
 *   #cockpit-entry                               -> body (floating COCKPIT)
 * New nodes: #mobile-cockpit-drawer, #mobile-cockpit-info (in #view-switcher),
 * #mobile-cockpit-nav (prev/next contact proxies that click the originals).
 */
import { movePanel } from './portal.js';
import { isMobileUi, UI_MODE_EVENT } from '../mobileMode.js';
import {
  COCKPIT_TABS,
  adjacentCockpitTab,
  drawerConsumesEscape,
  initialDrawerState,
  reduceDrawer,
} from './cockpit-model.js';

export const COCKPIT_MODE_EVENT = 'gev:cockpit-mode-changed';

// [portal key, selector, pane]
export const COCKPIT_MOVES = [
  ['cockpit:readout', '#cockpit-hud .cockpit-position-readout', 'contact'],
  ['cockpit:context', '#cockpit-context', 'contact'],
  ['cockpit:route', '#cockpit-route', 'route'],
  ['cockpit:brief', '#cockpit-signal-stream', 'brief'],
  ['cockpit:display', '#cockpit-display-panel', 'display'],
  ['cockpit:radio', '#cockpit-radio-panel', 'radio'],
];

const EMPTY_TEXT = {
  contact: 'Waiting for contact data from the tracked aircraft.',
  route: 'No route estimate is available for this aircraft.',
};

function make(doc, tag, className, attrs = {}) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  return node;
}

function symbol(doc, name) {
  const node = make(doc, 'span', 'material-symbols-outlined', {
    'aria-hidden': 'true',
  });
  node.textContent = name;
  return node;
}

export function installCockpitDrawer(doc = document, win = window) {
  if (doc.getElementById('mobile-cockpit-drawer')) return () => {};
  const disposers = [];
  let state = initialDrawerState();
  const cockpitActive = () => doc.body.classList.contains('cockpit-mode');

  // ---- Drawer shell ------------------------------------------------------
  const drawer = make(doc, 'section', 'm-cp', {
    id: 'mobile-cockpit-drawer',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-label': 'Cockpit details',
  });
  drawer.dataset.open = 'false';
  drawer.dataset.tab = state.tab;
  const head = make(doc, 'header', 'm-cp__head');
  const tabs = make(doc, 'div', 'm-cp__tabs', {
    role: 'tablist',
    'aria-label': 'Cockpit sections',
  });
  const tabButtons = new Map();
  const panes = new Map();
  const body = make(doc, 'div', 'm-cp__body', { id: 'mobile-cockpit-body' });
  for (const tab of COCKPIT_TABS) {
    const button = make(doc, 'button', 'm-cp__tab', {
      type: 'button',
      role: 'tab',
      id: `m-cp-tab-${tab.id}`,
      'aria-controls': `m-cp-pane-${tab.id}`,
      'data-tab': tab.id,
    });
    button.textContent = tab.label;
    tabs.append(button);
    tabButtons.set(tab.id, button);
    const pane = make(doc, 'section', 'm-cp__pane', {
      role: 'tabpanel',
      id: `m-cp-pane-${tab.id}`,
      'aria-labelledby': `m-cp-tab-${tab.id}`,
      'data-pane': tab.id,
    });
    if (EMPTY_TEXT[tab.id]) {
      const empty = make(doc, 'p', 'm-cp__empty');
      empty.textContent = EMPTY_TEXT[tab.id];
      pane.append(empty);
    }
    body.append(pane);
    panes.set(tab.id, pane);
  }
  const closeBtn = make(doc, 'button', 'm-cp__close', {
    type: 'button',
    id: 'mobile-cockpit-close',
    'aria-label': 'Close cockpit details',
  });
  closeBtn.textContent = '✕';
  head.append(tabs, closeBtn);
  drawer.append(head, body);
  doc.body.append(drawer);

  // ---- On-map controls ---------------------------------------------------
  const info = make(doc, 'button', 'm-cp-info', {
    type: 'button',
    id: 'mobile-cockpit-info',
    'aria-label': 'Cockpit details: contact, route, briefing, display, radio',
    'aria-controls': 'mobile-cockpit-drawer',
    'aria-expanded': 'false',
  });
  info.textContent = 'i';
  const switcher = doc.getElementById('view-switcher');
  if (switcher) switcher.prepend(info);
  else doc.body.append(info);

  const nav = make(doc, 'nav', 'm-cp-nav', {
    id: 'mobile-cockpit-nav',
    'aria-label': 'Contact navigation',
  });
  const navButton = (id, originalId, label, icon) => {
    const button = make(doc, 'button', 'm-cp-nav__btn', {
      type: 'button',
      id,
      'aria-label': label,
    });
    button.append(symbol(doc, icon));
    button.addEventListener('click', () =>
      doc.getElementById(originalId)?.click(),
    );
    return button;
  };
  const navLabel = make(doc, 'span', 'm-cp-nav__label');
  navLabel.textContent = 'CONTACT';
  nav.append(
    navButton(
      'mobile-cockpit-ctx-prev',
      'cockpit-context-previous',
      'Previous contact',
      'skip_previous',
    ),
    navLabel,
    navButton(
      'mobile-cockpit-ctx-next',
      'cockpit-context-next',
      'Next contact',
      'skip_next',
    ),
  );
  doc.body.append(nav);

  // ---- Move existing nodes in --------------------------------------------
  for (const [key, selector, pane] of COCKPIT_MOVES) {
    const node = doc.querySelector(selector);
    if (node) movePanel(node, panes.get(pane), key);
  }
  // Floating COCKPIT entry: its desktop parent lives in the hidden right rail.
  const entry = doc.getElementById('cockpit-entry');
  if (entry) movePanel(entry, doc.body, 'cockpit:entry');

  // ---- State -> DOM ------------------------------------------------------
  function syncEmpty() {
    tabButtons.get('contact').dataset.empty = String(
      doc.getElementById('cockpit-context')?.hidden !== false,
    );
    tabButtons.get('route').dataset.empty = String(
      doc.getElementById('cockpit-route')?.hidden !== false,
    );
  }
  function render() {
    drawer.dataset.open = String(state.open);
    drawer.dataset.tab = state.tab;
    info.setAttribute('aria-expanded', String(state.open));
    for (const [id, button] of tabButtons) {
      const selected = id === state.tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      panes.get(id).hidden = !selected;
    }
    if (state.open) doc.documentElement.dataset.mobileCockpitDrawer = 'open';
    else delete doc.documentElement.dataset.mobileCockpitDrawer;
    syncEmpty();
  }
  function dispatch(action) {
    const previous = state;
    state = reduceDrawer(state, action);
    if (state.tab !== previous.tab) body.scrollTop = 0;
    render();
  }
  render();

  // ---- Wiring ------------------------------------------------------------
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  };

  listen(info, 'click', () => dispatch({ type: 'toggle' }));
  listen(closeBtn, 'click', () => dispatch({ type: 'close' }));
  for (const [id, button] of tabButtons)
    listen(button, 'click', () => dispatch({ type: 'select', tab: id }));
  listen(tabs, 'keydown', (event) => {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = adjacentCockpitTab(state.tab, step);
    dispatch({ type: 'select', tab: next });
    tabButtons.get(next).focus({ preventScroll: true });
  });

  // Escape closes the drawer before cockpit's own handler exits cockpit.
  listen(
    doc,
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !drawerConsumesEscape(state)) return;
      if (!cockpitActive()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dispatch({ type: 'escape' });
    },
    true,
  );

  listen(win, COCKPIT_MODE_EVENT, (event) => {
    if (event?.detail?.active !== true) dispatch({ type: 'exit' });
    else syncEmpty();
  });
  listen(win, UI_MODE_EVENT, (event) => {
    if (event?.detail?.mode !== 'mobile') dispatch({ type: 'close' });
  });

  // Tapped brief controls keep focus, which would pause auto-rotate forever
  // (rotation pauses while focus is inside the panel). Release it after a tap.
  const stream = doc.getElementById('cockpit-signal-stream');
  if (stream) {
    listen(stream, 'click', (event) => {
      const button = event.target?.closest?.(
        '.cockpit-brief-tabs button, .cockpit-brief-actions button',
      );
      if (button && isMobileUi(doc)) button.blur();
    });
  }

  const Observer = win.MutationObserver;
  if (Observer) {
    // Opening the main menu sheet closes the drawer (one bottom surface).
    const sheetWatch = new Observer(() => {
      if (doc.documentElement.dataset.mobileSheet === 'open')
        dispatch({ type: 'sheet' });
    });
    sheetWatch.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['data-mobile-sheet'],
    });
    disposers.push(() => sheetWatch.disconnect());

    // Contact / route availability drives the tab hints.
    const emptyWatch = new Observer(syncEmpty);
    for (const id of ['cockpit-context', 'cockpit-route']) {
      const node = doc.getElementById(id);
      if (node)
        emptyWatch.observe(node, {
          attributes: true,
          attributeFilter: ['hidden'],
        });
    }
    disposers.push(() => emptyWatch.disconnect());

    // Cycling the vision style asks the desktop utility strip to open its
    // Display disclosure. That strip is hidden on mobile (its panels live in
    // the drawer), so close it again to leave the briefing window untouched.
    const disclosureWatch = new Observer((records) => {
      if (!isMobileUi(doc)) return;
      for (const record of records) {
        const toggle = record.target;
        if (toggle.getAttribute('aria-expanded') !== 'true') continue;
        win.setTimeout(() => {
          if (toggle.getAttribute('aria-expanded') === 'true') toggle.click();
        }, 0);
      }
    });
    for (const id of [
      'cockpit-display-toggle-btn',
      'cockpit-radio-toggle-btn',
    ]) {
      const toggle = doc.getElementById(id);
      if (toggle)
        disclosureWatch.observe(toggle, {
          attributes: true,
          attributeFilter: ['aria-expanded'],
        });
    }
    disposers.push(() => disclosureWatch.disconnect());
  }

  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
    delete doc.documentElement.dataset.mobileCockpitDrawer;
    drawer.remove();
    nav.remove();
    info.remove();
  };
}
