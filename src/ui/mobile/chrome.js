/**
 * Always-on mobile chrome: Menu button (top-left), the top-right button column
 * (`#mobile-top-right`, compass first; other owners may movePanel() small
 * buttons into it) and the status line `#mobile-status`.
 *
 * Status contract (the ONLY way to show transient text on mobile):
 *   window.dispatchEvent(new CustomEvent('gev:mobile-status',
 *     { detail: { text, kind, ttl, id } }))
 *   text  - string; '' clears that id
 *   kind  - 'info' (default) | 'warn' | 'error' | 'loading'
 *   ttl   - ms before it fades (default 4000; 0 = stays until cleared)
 *   id    - optional key so one source can replace/clear its own message
 */
import { movePanel, restorePanel } from './portal.js';
import { openSheet, isSheetOpen, closeSheet } from './sheet.js';

export const STATUS_EVENT = 'gev:mobile-status';
const DEFAULT_TTL = 4000;

export function installChrome(doc = document, win = window) {
  const disposers = [];

  const menu = doc.createElement('button');
  menu.id = 'mobile-menu-btn';
  menu.type = 'button';
  menu.className = 'mobile-menu-btn';
  menu.setAttribute('aria-label', 'Menu');
  menu.setAttribute('aria-controls', 'mobile-sheet');
  menu.setAttribute('aria-expanded', 'false');
  const bars = doc.createElement('span');
  bars.className = 'mobile-menu-btn__bars';
  bars.setAttribute('aria-hidden', 'true');
  menu.append(bars);
  const onMenu = () => (isSheetOpen() ? closeSheet() : openSheet());
  menu.addEventListener('click', onMenu);

  const topRight = doc.createElement('div');
  topRight.id = 'mobile-top-right';
  topRight.className = 'mobile-top-right';

  const status = doc.createElement('div');
  status.id = 'mobile-status';
  status.className = 'mobile-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  for (const node of [menu, topRight, status]) node.dataset.mobileUi = '';
  doc.body.append(menu, topRight, status);

  // Compass: reuse the existing node so cameraOrientationControls keeps
  // working. The rest of #top-center-actions is moved by the page owners.
  const compass = doc.getElementById('north-up-view');
  if (compass) movePanel(compass, topRight, 'north-up-view');

  // Status line ---------------------------------------------------------
  const messages = new Map(); // id -> { text, kind, timer }
  let order = [];
  const render = () => {
    const key = order[order.length - 1];
    const message = key === undefined ? null : messages.get(key);
    status.textContent = message?.text ?? '';
    if (message) {
      status.dataset.kind = message.kind;
      status.dataset.active = 'true';
    } else {
      delete status.dataset.active;
    }
  };
  const drop = (id) => {
    const existing = messages.get(id);
    if (existing?.timer) win.clearTimeout(existing.timer);
    messages.delete(id);
    order = order.filter((key) => key !== id);
  };
  const onStatus = (event) => {
    const detail = event?.detail ?? {};
    const id = detail.id ?? 'default';
    const text = typeof detail.text === 'string' ? detail.text.trim() : '';
    drop(id);
    if (text) {
      const ttl = Number.isFinite(detail.ttl) ? detail.ttl : DEFAULT_TTL;
      const entry = { text, kind: detail.kind || 'info', timer: 0 };
      if (ttl > 0) {
        entry.timer = win.setTimeout(() => {
          drop(id);
          render();
        }, ttl);
      }
      messages.set(id, entry);
      order.push(id);
    }
    render();
  };
  win.addEventListener(STATUS_EVENT, onStatus);

  disposers.push(() => {
    menu.removeEventListener('click', onMenu);
    win.removeEventListener(STATUS_EVENT, onStatus);
    for (const id of [...messages.keys()]) drop(id);
    restorePanel('north-up-view');
    menu.remove();
    topRight.remove();
    status.remove();
  });
  return () => disposers.forEach((dispose) => dispose());
}
