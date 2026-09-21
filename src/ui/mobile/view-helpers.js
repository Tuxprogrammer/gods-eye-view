/**
 * Pure-ish helpers for the mobile View page. Kept free of module state so they
 * can be unit-tested with a tiny fake document (view-helpers.test.mjs).
 */

/** Keyboard shortcuts that have no on-screen control on desktop. */
export const KEY_ACTIONS = Object.freeze({
  orbit: Object.freeze({ key: 'o', code: 'KeyO' }),
  fps: Object.freeze({ key: '`', code: 'Backquote' }),
});

/**
 * Fire a shortcut on `doc` exactly like the keyboard would. The desktop
 * handlers listen on `document` and ignore form-control targets, so the target
 * is the document itself. Returns true when a key event was dispatched.
 */
export function pressShortcut(doc, name, win = doc?.defaultView ?? window) {
  const spec = KEY_ACTIONS[name];
  const Ctor = win?.KeyboardEvent ?? globalThis.KeyboardEvent;
  if (!spec || !doc || typeof Ctor !== 'function') return false;
  doc.dispatchEvent(
    new Ctor('keydown', {
      key: spec.key,
      code: spec.code,
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

/** "NORMAL" -> "Normal"; empty stays empty. */
export function titleCase(text) {
  const value = String(text ?? '').trim();
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** One-line tile summary: "Normal · 3D". */
export function viewSummary({ style, source } = {}) {
  const parts = [];
  const styleName = String(style ?? '').trim();
  const sourceName = String(source ?? '').trim();
  if (styleName)
    parts.push(styleName.length <= 4 ? styleName : titleCase(styleName));
  if (sourceName) parts.push(sourceName);
  return parts.join(' · ');
}

/** Name + long description of a preset button (title= is invisible on touch). */
export function presetHelp(button) {
  if (!button) return { name: '', description: '' };
  const label = button.querySelector?.('.btn-label')?.textContent ?? '';
  return {
    name: label.trim(),
    description: String(button.getAttribute?.('title') ?? '').trim(),
  };
}

/** Reasons for every unavailable map chip, as visible text lines. */
export function unavailableMapNotes(chips) {
  const notes = [];
  for (const chip of Array.from(chips ?? [])) {
    const unavailable =
      chip.classList?.contains('unavailable') ||
      chip.getAttribute?.('aria-disabled') === 'true';
    if (!unavailable) continue;
    const label = chip.querySelector?.('.map-stack-chip-label')?.textContent;
    const reason = String(chip.getAttribute?.('title') ?? '').trim();
    if (label && reason && reason !== label) notes.push(`${label}: ${reason}`);
    else if (label) notes.push(`${label}: unavailable`);
  }
  return notes;
}

/** Mirror a boolean onto a switch/toggle button. */
export function setSwitchState(button, on) {
  if (!button) return;
  const value = on ? 'true' : 'false';
  if (button.getAttribute('role') === 'switch')
    button.setAttribute('aria-checked', value);
  else button.setAttribute('aria-pressed', value);
  const state = button.querySelector?.('.mv-switch__state');
  if (state) state.textContent = on ? 'On' : 'Off';
}

/**
 * Call `onFound(el)` now if `find()` returns an element, otherwise as soon as
 * one appears (watching `root` child lists; direct children only unless
 * `subtree`). `onFound` runs again when the element is replaced, unless
 * `once`. Returns a disposer.
 */
export function watchForElement(
  root,
  find,
  onFound,
  { subtree = false, once = false, MutationObserverCtor } = {},
) {
  let current = null;
  let observer = null;
  const stop = () => {
    observer?.disconnect();
    observer = null;
  };
  const check = () => {
    const next = find();
    if (next && next !== current) {
      current = next;
      onFound(next);
      if (once) stop();
    }
  };
  check();
  if (once && current) return stop;
  const Ctor = MutationObserverCtor ?? globalThis.MutationObserver;
  if (typeof Ctor !== 'function' || !root) return stop;
  observer = new Ctor(check);
  observer.observe(root, { childList: true, subtree });
  return stop;
}

/** Group id-of-first-control -> slot name (CSS orders the page by slot). */
export const GROUP_SLOTS = Object.freeze({
  'hud-toggle': 'hud',
  'detection-toggle': 'detect',
  'models3d-toggle': 'models',
  'scope-toggle': 'scope',
  'celestial-toggle': 'celestial',
  'bloom-toggle': 'bloom',
  'sharpen-toggle': 'sharpen',
  'draw-toggle': 'draw',
  'clean-view-toggle': 'clean',
});

/** Slot for a child of #pp-toggles, or '' when it is not an ordered group. */
export function slotForNode(node) {
  if (!node || node.nodeType !== 1) return '';
  if (node.id === 'param-slider-panel') return 'params';
  for (const id of Object.keys(GROUP_SLOTS)) {
    if (node.id === id || node.querySelector?.(`#${id}`))
      return GROUP_SLOTS[id];
  }
  return '';
}
