/**
 * Mobile UI entry. installMobileUi() is idempotent and a no-op on desktop
 * (it only listens for a later flip to mobile). On mobile it builds the chrome
 * and sheet, then runs every owner module's install() in its own try/catch.
 * When the mode flips to desktop, the sheet closes and every moved node goes
 * home; flipping back re-applies the moves.
 */
import { installMobileMode, isMobileUi, UI_MODE_EVENT } from '../mobileMode.js';
import { installSheet, closeSheetSilently } from './sheet.js';
import { installChrome } from './chrome.js';
import { restoreAll, reapplyAll } from './portal.js';
import * as places from './pages/places.js';
import * as layers from './pages/layers.js';
import * as scenes from './pages/scenes.js';
import * as view from './pages/view.js';
import * as context from './pages/context.js';
import * as cctv from './pages/cctv.js';
import * as radio from './pages/radio.js';
import * as voice from './pages/voice.js';
import * as more from './pages/more.js';
import * as cockpit from './pages/cockpit.js';
import * as cards from './pages/cards.js';
import * as modals from './pages/modals.js';

// Sheet pages first (their order field sorts the menu), then non-page modules.
const MODULES = [
  ['places', places],
  ['layers', layers],
  ['scenes', scenes],
  ['view', view],
  ['context', context],
  ['cctv', cctv],
  ['radio', radio],
  ['voice', voice],
  ['more', more],
  ['cockpit', cockpit],
  ['cards', cards],
  ['modals', modals],
];

let installed = null;

export function installMobileUi(doc = document, win = window) {
  if (installed) return installed.dispose;
  const disposeMode = installMobileMode(doc, win);
  let active = false;
  let disposeSheet = null;
  let disposeChrome = null;

  function activate() {
    if (active) {
      reapplyAll();
      return;
    }
    active = true;
    disposeSheet = installSheet(doc, win);
    disposeChrome = installChrome(doc, win);
    for (const [name, mod] of MODULES) {
      try {
        mod.install();
      } catch (error) {
        console.error(`[mobile] ${name} install failed`, error);
      }
    }
  }

  function deactivate() {
    closeSheetSilently();
    restoreAll();
  }

  const onMode = (event) => {
    if (event?.detail?.mode === 'mobile') activate();
    else if (active) deactivate();
  };
  win.addEventListener(UI_MODE_EVENT, onMode);
  if (isMobileUi(doc)) activate();

  function dispose() {
    win.removeEventListener(UI_MODE_EVENT, onMode);
    disposeMode();
    if (active) {
      disposeChrome?.();
      disposeSheet?.();
      restoreAll();
    }
    installed = null;
  }
  installed = { dispose };
  return dispose;
}
