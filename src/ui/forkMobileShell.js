// Upstream's phone shell (mobileShell.js: a tab bar that borrows the rail
// panels into sheets) and this fork's phone UI (src/ui/mobile/, on while
// html[data-ui='mobile']) would both rearrange the same panels on a phone.
// This keeps upstream's shell running only while the fork's UI is off, and
// swaps them when the mode flips (rotation, resize, the UI mode setting).
// applicationShell.js imports initMobileShell from here instead of from
// mobileShell.js; the signature and returned API are the same.
import { initMobileShell as initUpstreamMobileShell } from './mobileShell.js';
import { isMobileUi, UI_MODE_EVENT } from './mobileMode.js';

/**
 * @param {Parameters<typeof initUpstreamMobileShell>[0]} [options]
 * @param {{initShell?: typeof initUpstreamMobileShell}} [deps] Test seam.
 */
export function initMobileShell(
  options = {},
  { initShell = initUpstreamMobileShell } = {},
) {
  const doc = options.documentRef ?? globalThis.document;
  const win = doc?.defaultView ?? globalThis.window;
  let shell = null;
  const sync = () => {
    if (isMobileUi(doc)) {
      // destroy() closes any open sheet, so borrowed panels go back first.
      shell?.destroy();
      shell = null;
    } else if (!shell) {
      shell = initShell(options);
    }
  };
  sync();
  win?.addEventListener?.(UI_MODE_EVENT, sync);
  return {
    setSheet: (sheet) => shell?.setSheet(sheet),
    getSheet: () => shell?.getSheet() ?? null,
    sharedCollapsed: (panelId) => shell?.sharedCollapsed(panelId),
    destroy() {
      win?.removeEventListener?.(UI_MODE_EVENT, sync);
      shell?.destroy();
      shell = null;
    },
  };
}
