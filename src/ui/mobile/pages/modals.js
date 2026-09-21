/**
 * Non-page module owned by the modals agent. installMobileUi() calls install()
 * (mobile mode only, inside try/catch) after the sheet exists.
 *
 * Scope: first-run Skip, provider keys, toast / global loading / traffic-sync
 * routing into #mobile-status, FPS readout relocation. Styling lives in
 * src/ui/styles/mobile-modals.css. See docs/mobile/DESIGN.md sections 4-5.
 */
import { installStatusRouting } from '../modals-status.js';
import { installFirstRun } from '../modals-firstrun.js';
import { installKeySetup } from '../modals-keys.js';

let disposeAll = null;

export function install(doc = document, win = window) {
  if (disposeAll) return disposeAll;
  const parts = [installStatusRouting, installFirstRun, installKeySetup];
  const disposers = [];
  for (const part of parts) {
    try {
      disposers.push(part(doc, win));
    } catch (error) {
      console.error('[mobile] modals part failed', error);
    }
  }
  disposeAll = () => {
    disposers.forEach((dispose) => dispose?.());
    disposeAll = null;
  };
  return disposeAll;
}
