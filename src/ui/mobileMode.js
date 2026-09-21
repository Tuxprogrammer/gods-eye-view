/**
 * The single "mobile UI" decision. `index.html` carries an inline copy of this
 * query (mobileMode.test.mjs asserts they match) so the attribute is set before
 * first paint; this module owns runtime reads and change notification.
 *
 * CSS reads only `html[data-ui='mobile']`; JS asks isMobileUi().
 * `?ui=mobile|desktop` (then localStorage 'godsEyeView.ui') beats the query.
 */
export const MOBILE_QUERY =
  '(pointer: coarse), (hover: none), (max-width: 640px)';
export const UI_STORAGE_KEY = 'godsEyeView.ui';
export const UI_MODE_EVENT = 'gev:ui-mode';

const isMode = (value) => value === 'mobile' || value === 'desktop';

/** The forced mode from `?ui=` or localStorage, or null when none applies. */
export function readUiOverride(win = window) {
  try {
    const fromUrl = new URLSearchParams(win.location.search).get('ui');
    if (isMode(fromUrl)) return fromUrl;
  } catch {
    /* no location */
  }
  try {
    const stored = win.localStorage.getItem(UI_STORAGE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    /* storage blocked */
  }
  return null;
}

/** 'mobile' | 'desktop' from the override, else the media query. */
export function resolveMobileMode(win = window) {
  const forced = readUiOverride(win);
  if (forced) return forced;
  try {
    return win.matchMedia(MOBILE_QUERY).matches ? 'mobile' : 'desktop';
  } catch {
    return 'desktop';
  }
}

/** True when the document is currently in the mobile UI mode. */
export function isMobileUi(doc = document) {
  return doc.documentElement.dataset.ui === 'mobile';
}

/**
 * Apply data-ui now and follow media-query changes. Dispatches `gev:ui-mode`
 * (detail `{mode}`) on the window when the mode flips. Returns a disposer.
 */
export function installMobileMode(doc = document, win = window) {
  const apply = () => {
    const mode = resolveMobileMode(win);
    const previous = doc.documentElement.dataset.ui;
    if (previous === mode) return;
    doc.documentElement.dataset.ui = mode;
    // The first write only mirrors the inline bootstrap; only flips notify.
    if (previous) {
      win.dispatchEvent(new CustomEvent(UI_MODE_EVENT, { detail: { mode } }));
    }
  };
  apply();
  let query = null;
  try {
    query = win.matchMedia(MOBILE_QUERY);
  } catch {
    /* no matchMedia */
  }
  if (query?.addEventListener) query.addEventListener('change', apply);
  else query?.addListener?.(apply);
  return () => {
    if (query?.removeEventListener) query.removeEventListener('change', apply);
    else query?.removeListener?.(apply);
  };
}
