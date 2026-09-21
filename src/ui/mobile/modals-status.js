/**
 * Routes the desktop feedback surfaces (#toast, #global-loading-status,
 * #traffic-sync-chip) into the single mobile status line by OBSERVING their
 * DOM, so shellFeedback.js needs no mobile branch. The originals stay in the
 * DOM (the shell keeps writing them, tests pin them) and are hidden by
 * mobile-modals.css; #mobile-status is the role=status live region users hear.
 *
 * Pure describe* functions take an element and return the message or null.
 */
export const STATUS_EVENT = 'gev:mobile-status';
export const TOAST_TTL_MS = 2400;

const text = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const hasClass = (node, name) => Boolean(node?.classList?.contains(name));

/** Toast: visible while `.visible` is set; the shell clears it after 2s. */
export function describeToast(toast) {
  if (!toast || !hasClass(toast, 'visible')) return null;
  const message = text(toast);
  if (!message) return null;
  return { text: message, kind: 'info', ttl: TOAST_TTL_MS };
}

const KIND_BY_STATE = Object.freeze({
  error: 'error',
  retry: 'warn',
  cancelled: 'warn',
  complete: 'info',
});
// The desktop CSS hides the detail span in these states; mirror that.
const LABEL_ONLY_STATES = new Set(['complete', 'cancelled', 'error']);

/** Aggregated "LOADING LIVE DATA / LOAD COMPLETE / ACQUIRING ..." strip. */
export function describeGlobalLoading(root) {
  if (!root || root.hidden) return null;
  const state = root.dataset?.state || '';
  const label = text(root.querySelector?.('#global-loading-label'));
  const detail = LABEL_ONLY_STATES.has(state)
    ? ''
    : text(root.querySelector?.('#global-loading-detail'));
  const message = [label, detail].filter(Boolean).join(' · ');
  if (!message) return null;
  return { text: message, kind: KIND_BY_STATE[state] || 'loading', ttl: 0 };
}

/** Road-network sync chip: shown while `.visible`. */
export function describeSyncChip(chip, labelId, progressId) {
  if (!chip || !hasClass(chip, 'visible')) return null;
  const label = text(chip.querySelector?.(`#${labelId}`));
  const progress = text(chip.querySelector?.(`#${progressId}`));
  const message = [label, progress].filter(Boolean).join(' ');
  if (!message) return null;
  return { text: message, kind: 'loading', ttl: 0 };
}

/**
 * Observe the three sources and dispatch gev:mobile-status. Returns a
 * disposer that also clears anything it put on the status line.
 */
export function installStatusRouting(doc = document, win = window) {
  const Observer = win.MutationObserver ?? globalThis.MutationObserver;
  const sources = [
    {
      id: 'toast',
      node: doc.getElementById('toast'),
      describe: describeToast,
      // Toasts repeat the same text; re-emit so the TTL restarts.
      always: true,
    },
    {
      id: 'global-loading',
      node: doc.getElementById('global-loading-status'),
      describe: describeGlobalLoading,
    },
    {
      id: 'traffic-sync',
      node: doc.getElementById('traffic-sync-chip'),
      describe: (chip) =>
        describeSyncChip(chip, 'traffic-sync-label', 'traffic-sync-progress'),
    },
  ].filter((source) => source.node);

  const last = new Map();
  const emit = (id, detail) =>
    win.dispatchEvent(
      new CustomEvent(STATUS_EVENT, { detail: { id, ...detail } }),
    );

  const sync = (source) => {
    const message = source.describe(source.node);
    const key = message ? `${message.kind}|${message.text}` : '';
    if (!source.always && last.get(source.id) === key) return;
    if (!message && !last.get(source.id)) return;
    last.set(source.id, key);
    if (message) emit(source.id, message);
    else emit(source.id, { text: '' });
  };

  const observers = [];
  for (const source of sources) {
    sync(source);
    if (typeof Observer !== 'function') continue;
    const observer = new Observer(() => sync(source));
    observer.observe(source.node, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'data-state'],
      childList: true,
      characterData: true,
      subtree: true,
    });
    observers.push(observer);
  }

  return () => {
    for (const observer of observers) observer.disconnect();
    for (const source of sources) {
      if (last.get(source.id)) emit(source.id, { text: '' });
    }
    last.clear();
  };
}
