/**
 * Mobile cards (non-page module). installMobileUi() calls install() once, in
 * mobile mode, inside a try/catch, after the sheet exists.
 *
 * What it owns (styles: styles/mobile-cards.css, all under html[data-ui=mobile]):
 *  - APRS / Meshtastic / propagation pinned cards -> bottom card sheet (CSS),
 *    plus injected Prev/Next stack buttons and swipe-down-to-dismiss.
 *  - Bhote Koshi panel -> bottom sheet with Compare / Timeline / Reports tabs;
 *    embedded media callouts -> top card with a close button, no leader line.
 *  - Draw tool -> floating toolbar (#mobile-draw-toolbar) while drawing.
 *  - Selected vessel / tracked target -> #mobile-deselect chip with a Deselect
 *    button (the keyboard-only Escape gets a button).
 *  - Meshtastic server list: delete gets a confirm sheet; add-server form
 *    becomes a full-sheet one-column form with a Close button.
 *  - Touch hit slop for every Cesium pick (cards-slop.js).
 * Scene action panels / pack credit cards are styled by CSS only.
 */
import { UI_MODE_EVENT, isMobileUi } from '../../mobileMode.js';
import { closeSheet, isSheetOpen } from '../sheet.js';
import { getActiveTrackedReadoutId } from '../../../data/trackedReadout.js';
import {
  drawToolbarState,
  isSwipeDismiss,
  parseVesselReadout,
} from '../cards-helpers.js';
import { installPickSlop } from '../cards-slop.js';

const CARD_SELECTOR = '.aprs-card, .propagation-station-card';
const MEDIA_ROOT_ID = 'bhote-koshi-embedded-media-root';
const BHOTE_TABS = [
  ['compare', 'Compare'],
  ['timeline', 'Timeline'],
  ['reports', 'Reports'],
];

let installed = false;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function button(className, label, ariaLabel) {
  const node = el('button', className, label);
  node.type = 'button';
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
  return node;
}

export function install() {
  if (installed) return;
  installed = true;
  const disposers = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  };

  installSlop(disposers, on);
  installCardEnhancer(disposers);
  installBhote(disposers);
  installServerUi(on);
  installDrawToolbar(disposers, on);
  installDeselect(disposers, on);
}

// ---------------------------------------------------------------- pick slop
function installSlop(disposers, on) {
  let undo = null;
  let cancelled = false;
  const apply = async () => {
    if (undo || !isMobileUi()) return;
    try {
      const Cesium = await import('cesium');
      if (cancelled || undo || !isMobileUi()) return;
      undo = installPickSlop(Cesium.Scene);
    } catch (error) {
      console.warn('[mobile] pick slop unavailable', error);
    }
  };
  const drop = () => {
    undo?.();
    undo = null;
  };
  on(window, UI_MODE_EVENT, (event) => {
    if (event?.detail?.mode === 'mobile') void apply();
    else drop();
  });
  disposers.push(() => {
    cancelled = true;
    drop();
  });
  void apply();
}

// -------------------------------------------- entity cards (APRS / propagation)
function enhanceCard(card) {
  if (card.dataset.mEnhanced) return;
  card.dataset.mEnhanced = '1';
  const head = card.querySelector(
    '.aprs-card-head, .propagation-station-card-head',
  );
  if (!head) return;
  const close = head.querySelector('button');
  const stack = head.querySelector('.aprs-card-stack');
  if (stack) {
    // Prev / Next replace "click again for the next" (repeat taps on a moving
    // pixel are unreliable). They only show while the stack counter shows.
    const step = (delta) =>
      card.dispatchEvent(
        new CustomEvent('gev:card-step', { detail: { delta } }),
      );
    const prev = button('m-card-nav', '‹', 'Previous station here');
    const next = button('m-card-nav', '›', 'Next station here');
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    stack.before(prev);
    stack.after(next);
  }
  // Swipe down on the header dismisses the sheet.
  let start = null;
  head.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('button')) return;
    start = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  });
  head.addEventListener('pointerup', (event) => {
    if (!start) return;
    const gesture = {
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
      ms: event.timeStamp - start.t,
    };
    start = null;
    if (isSwipeDismiss(gesture)) close?.click();
  });
  head.addEventListener('pointercancel', () => {
    start = null;
  });
}

/** The scene-actions status line tells keyboard users to press Tab and Enter. */
function touchCopy(panel) {
  const status = panel.querySelector('[role="status"]');
  if (status && /Tab and Enter/.test(status.textContent))
    status.textContent = 'Tap a feature on the map, or choose an action below.';
}

function installCardEnhancer(disposers) {
  const scan = (root) => {
    for (const card of root.querySelectorAll?.(CARD_SELECTOR) ?? [])
      enhanceCard(card);
    for (const panel of root.querySelectorAll?.(
      '[data-director-interactions]',
    ) ?? [])
      touchCopy(panel);
  };
  const container = document.getElementById('cesiumContainer');
  if (!container) return;
  scan(container);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(CARD_SELECTOR)) enhanceCard(node);
        if (node.matches('[data-director-interactions]')) touchCopy(node);
        if (node.id === MEDIA_ROOT_ID) watchMediaRoot(node);
      }
    }
  });
  observer.observe(container, { childList: true });
  disposers.push(() => observer.disconnect());
}

// ------------------------------------------------------------ Bhote Koshi
function enhanceBhotePanel(panel) {
  if (panel.dataset.mTabs) return;
  panel.dataset.mTabs = '1';
  panel.dataset.mTab = 'compare';
  // 44px sliders (shared .m-range styling from mobile-base.css).
  for (const range of panel.querySelectorAll('input[type="range"]'))
    range.classList.add('m-range');
  const bar = el('div', 'm-bhote-tabs');
  bar.setAttribute('role', 'tablist');
  for (const [id, label] of BHOTE_TABS) {
    const tab = button('m-bhote-tab', label);
    tab.dataset.tab = id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(id === 'compare'));
    tab.addEventListener('click', () => {
      panel.dataset.mTab = id;
      if (id === 'reports') {
        const evidence = panel.querySelector('details.bhote-event-evidence');
        if (evidence) evidence.open = true;
      }
      for (const other of bar.children)
        other.setAttribute('aria-selected', String(other === tab));
    });
    bar.append(tab);
  }
  const anchor = panel.querySelector('.bhote-event-status-row');
  if (anchor) anchor.after(bar);
  else panel.querySelector('.bhote-event-header')?.after(bar);
}

const mediaObservers = new WeakSet();
function enhanceCallout(card) {
  if (card.dataset.mCloseAdded) return;
  const body = card.querySelector('.bhote-embedded-callout-body');
  if (!body) return;
  card.dataset.mCloseAdded = '1';
  const close = button('m-callout-close', '✕', 'Close this embedded media');
  close.addEventListener('click', () => {
    // Stop playback (hidden iframes keep playing), then hide the card. The
    // layer only re-shows media when the story moves to a different source.
    for (const frame of card.querySelectorAll('iframe'))
      frame.src = 'about:blank';
    card.dataset.mDismissed = '1';
  });
  body.append(close);
}
function watchMediaRoot(root) {
  if (mediaObservers.has(root)) return;
  mediaObservers.add(root);
  const scan = () => {
    for (const card of root.querySelectorAll('.bhote-embedded-callout'))
      enhanceCallout(card);
  };
  scan();
  new MutationObserver(scan).observe(root, { childList: true });
}

function installBhote(disposers) {
  const scan = () => {
    const panel = document.getElementById('bhote-koshi-event-panel');
    if (panel) enhanceBhotePanel(panel);
    const root = document.getElementById(MEDIA_ROOT_ID);
    if (root) watchMediaRoot(root);
  };
  scan();
  // The panel is appended to the (desktop) right rail, or to <body> when the
  // rail is missing; the media root is appended to the viewer container.
  const observer = new MutationObserver(scan);
  for (const target of [
    document.getElementById('right-context-rail'),
    document.body,
  ]) {
    if (target) observer.observe(target, { childList: true });
  }
  disposers.push(() => observer.disconnect());
}

// ------------------------------------------------ Meshtastic server list
function confirmSheet({ message, confirmLabel, onConfirm }) {
  document.getElementById('mobile-card-confirm')?.remove();
  const box = el('div', 'm-confirm');
  box.id = 'mobile-card-confirm';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', message);
  const text = el('p', 'm-confirm__text', message);
  const row = el('div', 'm-confirm__row');
  const cancel = button('m-btn', 'Cancel');
  const ok = button('m-btn m-confirm__danger', confirmLabel);
  const done = () => box.remove();
  cancel.addEventListener('click', done);
  ok.addEventListener('click', () => {
    done();
    onConfirm();
  });
  row.append(cancel, ok);
  box.append(text, row);
  document.body.append(box);
  cancel.focus({ preventScroll: true });
}

function installServerUi(on) {
  // Capture phase runs before the layer panel's delegated handler, so a bare
  // delete tap can be held for confirmation without editing layerPanel.js.
  on(
    document,
    'click',
    (event) => {
      if (!isMobileUi()) return;
      const remove = event.target?.closest?.('.data-server-remove');
      if (!remove || remove.dataset.mConfirmed) return;
      event.stopPropagation();
      event.preventDefault();
      const name =
        remove.closest('.data-server')?.querySelector('.data-server-name')
          ?.textContent || 'this server';
      confirmSheet({
        message: `Delete server "${name}"?`,
        confirmLabel: 'Delete',
        onConfirm: () => {
          remove.dataset.mConfirmed = '1';
          try {
            remove.click();
          } finally {
            delete remove.dataset.mConfirmed;
          }
        },
      });
    },
    true,
  );

  // <details> `toggle` does not bubble; capture it to set up the add form the
  // first time it opens (Close button, numeric keypad for the port).
  on(
    document,
    'toggle',
    (event) => {
      const details = event.target;
      if (!details?.matches?.('details.data-server-add')) return;
      const form = details.querySelector('.data-server-form');
      if (!form || form.dataset.mReady) return;
      form.dataset.mReady = '1';
      const bar = el('div', 'm-form-bar');
      bar.append(el('strong', 'm-form-bar__title', 'Add MQTT server'));
      const close = button('m-btn', 'Close', 'Close the add-server form');
      close.addEventListener('click', () => {
        details.open = false;
      });
      bar.append(close);
      form.prepend(bar);
      form
        .querySelector('input[name="port"]')
        ?.setAttribute('inputmode', 'numeric');
      for (const input of form.querySelectorAll('input')) {
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
      }
    },
    true,
  );
}

// ------------------------------------------------------------- draw toolbar
function installDrawToolbar(disposers, on) {
  const bar = el('div', 'm-draw');
  bar.id = 'mobile-draw-toolbar';
  bar.dataset.mobileUi = '';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Drawing tools');
  const hint = el('div', 'm-draw__hint');
  hint.setAttribute('aria-live', 'polite');
  const row = el('div', 'm-draw__row');
  const seg = el('div', 'm-draw__seg');
  seg.setAttribute('role', 'radiogroup');
  const shapes = ['area', 'line', 'pin'];
  const segButtons = shapes.map((shape) => {
    const b = button('m-draw__shape', shape[0].toUpperCase() + shape.slice(1));
    b.dataset.shape = shape;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => tool()?.setShape(shape));
    seg.append(b);
    return b;
  });
  const label = el('input', 'm-draw__label');
  label.type = 'text';
  label.maxLength = 120;
  label.placeholder = 'Label (optional)';
  label.setAttribute('aria-label', 'Label for the next shape');
  label.setAttribute('autocomplete', 'off');
  const colour = button('m-draw__colour', '●', 'Change the drawing colour');
  row.append(seg, label, colour);
  const actions = el('div', 'm-draw__actions');
  const undo = button('m-btn', 'Undo');
  const cancel = button('m-btn', 'Cancel');
  const finish = button('m-btn m-draw__finish', 'Finish');
  const exit = button('m-btn m-draw__exit', '✕', 'Exit drawing');
  actions.append(undo, cancel, finish, exit);
  bar.append(hint, row, actions);
  document.body.append(bar);
  disposers.push(() => bar.remove());

  const tool = () => window.__gevDrawTool ?? null;
  const labelInput = () => document.getElementById('draw-label-input');
  const colourSelect = () => document.getElementById('draw-color-select');

  on(label, 'input', () => {
    const target = labelInput();
    if (target) target.value = label.value;
  });
  on(undo, 'click', () => {
    // The tool's own Backspace handler owns the vertex list.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  on(cancel, 'click', () => tool()?.cancel());
  on(finish, 'click', () => void tool()?.finish());
  on(exit, 'click', () => tool()?.setActive(false));
  on(colour, 'click', () => {
    const select = colourSelect();
    if (!select?.options?.length) return;
    select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    refresh();
  });

  let wasActive = false;
  function refresh() {
    const drawing = document.body.classList.contains('gev-drawing');
    bar.hidden = !drawing || !isMobileUi();
    if (drawing && !wasActive && isSheetOpen()) closeSheet();
    wasActive = drawing;
    if (!drawing) return;
    const api = tool();
    const state = drawToolbarState(api?.session ?? null);
    hint.textContent = state.hint;
    undo.disabled = !state.canUndo;
    cancel.disabled = !state.canUndo;
    finish.disabled = !state.canFinish;
    finish.textContent = state.finishLabel;
    for (const b of segButtons) {
      b.setAttribute('aria-checked', String(api?.shape === b.dataset.shape));
    }
    const input = labelInput();
    if (
      input &&
      label.value !== input.value &&
      document.activeElement !== label
    )
      label.value = input.value;
    const select = colourSelect();
    if (select) colour.dataset.colour = select.value;
  }

  const observer = new MutationObserver(refresh);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  const hintNode = document.getElementById('draw-hint');
  if (hintNode)
    observer.observe(hintNode, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  disposers.push(() => observer.disconnect());
  refresh();
}

// ------------------------------------------------ selected vessel / target
function installDeselect(disposers, on) {
  const box = el('div', 'm-select');
  box.id = 'mobile-deselect';
  box.dataset.mobileUi = '';
  box.hidden = true;
  const text = el('div', 'm-select__text');
  const title = el('strong', 'm-select__title');
  const detail = el('div', 'm-select__detail m-meta');
  text.append(title, detail);
  const clear = button('m-btn', 'Deselect', 'Deselect the selected target');
  box.append(text, clear);
  document.body.append(box);
  disposers.push(() => box.remove());

  on(clear, 'click', () => {
    // Vessels and flights clear their selection on Escape (their only way to).
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    refresh();
  });

  function refresh() {
    if (!isMobileUi() || document.body.classList.contains('gev-drawing')) {
      box.hidden = true;
      return;
    }
    const pinnedCard = document.querySelector(
      '.aprs-card.pinned:not([hidden]), .propagation-station-card.pinned:not([hidden])',
    );
    const hud = document.getElementById('hud-ais-vessel');
    const vessel = hud?.classList.contains('active')
      ? parseVesselReadout(hud.textContent)
      : null;
    let tracked = null;
    try {
      tracked = getActiveTrackedReadoutId();
    } catch {
      tracked = null;
    }
    if (pinnedCard || (!vessel && !tracked)) {
      box.hidden = true;
      return;
    }
    title.textContent = vessel ? vessel.title : 'Target selected';
    detail.textContent = vessel
      ? vessel.lines.join(' · ')
      : 'Tap Deselect to release it';
    box.hidden = false;
  }
  const timer = window.setInterval(() => {
    if (document.visibilityState !== 'hidden') refresh();
  }, 600);
  disposers.push(() => window.clearInterval(timer));
  refresh();
}
