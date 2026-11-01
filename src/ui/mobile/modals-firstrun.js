/**
 * First-run launcher on mobile: rewrites the dock-specific tip. Closing it
 * without a keyboard is upstream's own DISMISS button (welcome.html), which
 * replaced the Skip control this module used to add.
 */
import { msg, t } from '../../i18n/index.js';

/** Upstream's tip (welcome.html), in English; the page shows it translated. */
export const DOCK_TIP = msg(
  'Tip: the GEV MIC button in the dock lets you talk to the map.',
);
export const MOBILE_TIP = msg('Tip: tap the mic button to talk to the map.');

export function installFirstRun(doc = document) {
  const root = doc.getElementById('first-run-launcher');
  if (!root) return () => {};
  const status = root.querySelector('[data-first-run-status]');
  const fixTip = () => {
    const text = status?.textContent?.trim();
    if (text === DOCK_TIP || text === t(DOCK_TIP))
      status.textContent = t(MOBILE_TIP);
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
