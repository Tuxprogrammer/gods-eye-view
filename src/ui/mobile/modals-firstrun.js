/**
 * First-run launcher on mobile: adds the visible Skip control (the desktop
 * card only closes on a tile, the suppress checkbox, or ESC) and rewrites the
 * dock-specific tip. Markup, ids and data-first-run-* hooks are untouched.
 */
export const OLD_TIP_PREFIX = 'Tip: the GEV MIC button in the dock';
export const MOBILE_TIP = 'Tip: tap the mic button to talk to the map.';

/** Ask the launcher to dismiss exactly as ESC would (same code path). */
export function requestFirstRunDismiss(root, doc = document) {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  doc.dispatchEvent(event);
  // The launcher claims ESC (preventDefault) only while it is the topmost
  // surface. If something else swallowed it, never leave a dead button.
  if (!event.defaultPrevented) root.hidden = true;
}

export function installFirstRun(doc = document) {
  const root = doc.getElementById('first-run-launcher');
  if (!root) return () => {};
  const header = root.querySelector('.first-run-header');
  let skip = root.querySelector('[data-first-run-skip]');
  if (!skip && header) {
    skip = doc.createElement('button');
    skip.type = 'button';
    skip.className = 'first-run-skip';
    skip.dataset.firstRunSkip = '';
    skip.setAttribute('aria-label', 'Skip and close');
    const label = doc.createElement('span');
    label.textContent = 'SKIP';
    const icon = doc.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'close';
    skip.append(label, icon);
    skip.addEventListener('click', () => requestFirstRunDismiss(root, doc));
    header.append(skip);
  }

  const status = root.querySelector('[data-first-run-status]');
  const fixTip = () => {
    if (status?.textContent?.startsWith(OLD_TIP_PREFIX)) {
      status.textContent = MOBILE_TIP;
    }
  };
  fixTip();
  let observer = null;
  if (status && typeof MutationObserver === 'function') {
    observer = new MutationObserver(fixTip);
    observer.observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  return () => observer?.disconnect();
}
