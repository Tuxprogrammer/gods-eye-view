import {
  MAX_MESSAGE_POPUPS,
  MESSAGE_FADE_MS,
  MESSAGE_POPUP_MS,
  popupText,
} from './model.js';

/**
 * Message pop-ups: when a station inside the configured radius sends a
 * message, a small bubble appears beside that station, follows it as the
 * camera moves, and fades out after a short time. A bubble whose station is
 * over the horizon is simply not shown; it still expires on schedule.
 *
 * Bubbles carry text from radio packets, so they are built with `textContent`
 * only, and never intercept the pointer.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {{screenPosition: Function}} options.surface
 */
export function createMessagePopups({
  viewer,
  surface,
  lifetimeMs = MESSAGE_POPUP_MS,
  fadeMs = MESSAGE_FADE_MS,
  maxPopups = MAX_MESSAGE_POPUPS,
  documentRef = globalThis.document,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
}) {
  const container = viewer.container ?? viewer.scene.canvas.parentElement;
  const layer = documentRef.createElement('div');
  layer.className = 'aprs-popups';
  layer.setAttribute('aria-live', 'polite');
  container.appendChild(layer);

  /** @type {Array<{message: object, node: HTMLElement, timers: number[]}>} */
  let popups = [];
  let remover = null;

  function reposition() {
    let stacked = new Map();
    for (const popup of popups) {
      const { message, node } = popup;
      const at = surface.screenPosition(
        message.anchoredTo === 'sender' ? message.from : message.to,
        message.lon,
        message.lat,
      );
      if (!at) {
        node.style.visibility = 'hidden';
        continue;
      }
      // Bubbles anchored to the same spot fan upward rather than overlap.
      const key = `${Math.round(at.x / 40)}:${Math.round(at.y / 40)}`;
      const level = stacked.get(key) ?? 0;
      stacked.set(key, level + 1);
      node.style.visibility = 'visible';
      node.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y - 34 - level * (node.offsetHeight + 4))}px) translate(-50%, -100%)`;
    }
  }

  function ensureLoop() {
    if (remover || !popups.length) return;
    remover = viewer.scene.postRender?.addEventListener(reposition) ?? null;
  }

  function drop(popup) {
    for (const id of popup.timers) clearTimer(id);
    popup.node.remove();
    popups = popups.filter((entry) => entry !== popup);
    if (!popups.length) {
      remover?.();
      remover = null;
    }
  }

  return {
    /** Show one message; the oldest bubble is retired first if there are too many. */
    show(message) {
      while (popups.length >= maxPopups) drop(popups[0]);
      const node = documentRef.createElement('div');
      node.className = 'aprs-popup';
      node.setAttribute('role', 'status');
      const from = documentRef.createElement('div');
      from.className = 'aprs-popup-from';
      from.textContent = `${message.from} › ${message.to}`;
      const text = documentRef.createElement('div');
      text.className = 'aprs-popup-text';
      text.textContent = popupText(message.text);
      node.append(from, text);
      layer.appendChild(node);
      const popup = { message, node, timers: [] };
      popups.push(popup);
      popup.timers.push(
        setTimer(
          () => node.classList.add('fading'),
          Math.max(0, lifetimeMs - fadeMs),
        ),
        setTimer(() => drop(popup), lifetimeMs),
      );
      ensureLoop();
      reposition();
      viewer.scene.requestRender?.();
      return popup;
    },
    clear() {
      for (const popup of [...popups]) drop(popup);
    },
    get count() {
      return popups.length;
    },
    destroy() {
      this.clear();
      layer.remove();
    },
  };
}
