/**
 * CCTV glue for the mobile UI (observes the desktop DOM; no desktop code
 * changes). Three jobs:
 *  1. mirror the floating #cctv-sync-chip into the single status line,
 *  2. announce the active camera when one is tapped on the globe,
 *  3. keep a small round "camera" button in #mobile-top-right that opens the
 *     CCTV page while a camera is active (the tap replacement for the desktop
 *     hover card / auto-expanding panel).
 */
import {
  describeCctvActive,
  describeCctvSync,
  cctvTileSummary,
} from './cctv-summary.js';

const STATUS_EVENT = 'gev:mobile-status';
const OPEN_EVENT = 'gev:mobile-open';
const byId = (id) => document.getElementById(id);

export function selectedCameraName() {
  const select = byId('cctv-camera-select');
  if (!select || select.selectedIndex < 0) return '';
  return select.options[select.selectedIndex]?.textContent ?? '';
}

export function cctvEnabled() {
  return byId('cctv-enable-btn')?.classList.contains('active') === true;
}

export function currentCctvSummary() {
  return cctvTileSummary({
    enabled: cctvEnabled(),
    camera: selectedCameraName(),
  });
}

/** Observe `node` and call `fn` (coalesced to one call per frame). */
function observe(node, options, fn) {
  if (!node || typeof MutationObserver !== 'function') return null;
  let queued = false;
  const run = () => {
    queued = false;
    fn();
  };
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else Promise.resolve().then(run);
  });
  observer.observe(node, options);
  return observer;
}

/**
 * @param {{ notify(): void }} page Registered page handle (tile refresh).
 * @param {() => ({ peek(on: boolean): void, isOpen(): boolean } | null)} getCtx
 */
export function installCctvBridge(page, getCtx) {
  const emit = (detail) =>
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail }));

  // 1. Sync chip -> status line --------------------------------------------
  const chip = byId('cctv-sync-chip');
  let lastSync = '';
  const syncStatus = () => {
    const message = describeCctvSync({
      visible: chip?.classList.contains('visible'),
      label: byId('cctv-sync-label')?.textContent,
      progress: byId('cctv-sync-progress')?.textContent,
    });
    const key = message ? message.text : '';
    if (key === lastSync) return;
    lastSync = key;
    emit(
      message ? { id: 'cctv-sync', ...message } : { id: 'cctv-sync', text: '' },
    );
  };
  observe(
    chip,
    {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      characterData: true,
      subtree: true,
    },
    syncStatus,
  );

  // 2 + 3. Active camera: announcement + top-right button --------------------
  const button = document.createElement('button');
  button.id = 'mobile-cctv-btn';
  button.type = 'button';
  button.hidden = true;
  button.setAttribute('aria-label', 'Open CCTV camera view');
  button.textContent = '📹';
  button.addEventListener('click', () =>
    window.dispatchEvent(
      new CustomEvent(OPEN_EVENT, { detail: { page: 'cctv' } }),
    ),
  );
  byId('mobile-top-right')?.append(button);

  let lastCamera = '';
  const syncCamera = () => {
    const enabled = cctvEnabled();
    const camera = enabled ? selectedCameraName() : '';
    button.hidden = !camera;
    page.notify();
    if (camera && camera !== lastCamera && !getCtx()?.isOpen()) {
      const message = describeCctvActive(camera);
      if (message) emit({ id: 'cctv-active', ...message });
    }
    lastCamera = camera;
  };
  for (const [id, options] of [
    ['cctv-enable-btn', { attributes: true, attributeFilter: ['class'] }],
    ['cctv-meta', { childList: true, characterData: true, subtree: true }],
    ['cctv-camera-select', { childList: true }],
  ]) {
    observe(byId(id), options, syncCamera);
  }
  syncCamera();

  // ADJUST drags a gizmo on the globe: peek so the map stays usable.
  const adjust = byId('cctv-adjust-btn');
  let adjustOn = adjust?.classList.contains('active') === true;
  observe(adjust, { attributes: true, attributeFilter: ['class'] }, () => {
    const now = adjust.classList.contains('active');
    const ctx = getCtx();
    if (now && !adjustOn && ctx?.isOpen()) ctx.peek(true);
    adjustOn = now;
  });
}
