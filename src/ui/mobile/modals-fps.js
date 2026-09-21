/**
 * Frame-rate readout on mobile. frameRateMonitor appends `.frame-rate-readout`
 * to #title-bar (display:none on mobile) and toggles on the backtick key only.
 * This moves the readout to <body> so it can show, and offers a button-friendly
 * toggle. Any owner's FPS button can call toggleFrameRate() or dispatch
 * window event `gev:mobile-toggle-fps`.
 */
import { movePanel } from './portal.js';

export const FPS_TOGGLE_EVENT = 'gev:mobile-toggle-fps';
const KEY = 'frame-rate-readout';

/** Same event the desktop backtick shortcut listens for. */
export function toggleFrameRate(doc = document) {
  doc.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: '`',
      code: 'Backquote',
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function installFrameRate(doc = document, win = window) {
  const host = doc.getElementById('title-bar');
  const relocate = () => {
    const readout = doc.querySelector('.frame-rate-readout');
    if (readout && readout.parentNode !== doc.body) {
      movePanel(readout, doc.body, KEY);
    }
  };
  relocate();
  let observer = null;
  if (host && typeof MutationObserver === 'function') {
    observer = new MutationObserver(relocate);
    observer.observe(host, { childList: true });
  }
  const onToggle = () => toggleFrameRate(doc);
  win.addEventListener(FPS_TOGGLE_EVENT, onToggle);
  return () => {
    observer?.disconnect();
    win.removeEventListener(FPS_TOGGLE_EVENT, onToggle);
  };
}
