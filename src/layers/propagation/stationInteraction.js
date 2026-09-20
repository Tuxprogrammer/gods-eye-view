import * as Cesium from 'cesium';
import { placeCard } from './model.js';
import { STATION_ID_PREFIX } from './rendering.js';

/** Hover picks are throttled: a GPU pick per mouse-move event is wasteful. */
const HOVER_THROTTLE_MS = 70;
/** A press that moves further than this is a camera drag, not a click. */
const DRAG_TOLERANCE_PX = 5;

/**
 * Hover and click on a station bubble.
 *
 * Hovering previews the station's details as a small table beside the cursor;
 * clicking pins that card to the station (it follows the bubble as the camera
 * moves) until it is closed with the button, Esc, or a click elsewhere.
 *
 * The card is plain DOM inside the viewer's container, so it needs nothing from
 * the app's own overlay system, and every input is a listener that is removed
 * again on `destroy()`.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {{detailsFor: Function}} options.surface The station surface.
 * @param {Function} [options.pick] `(x, y) => station entity id | null`.
 * @param {Function} [options.project] `(entity) => {x, y} | undefined`.
 */
export function createStationInteraction({
  viewer,
  surface,
  now = Date.now,
  documentRef = globalThis.document,
  pick = (x, y) => {
    const picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
    const id = picked?.id;
    return typeof id === 'string' ? id : (id?.id ?? null);
  },
  project = (entity) => {
    const position = entity.position?.getValue(viewer.clock.currentTime);
    return position
      ? viewer.scene.cartesianToCanvasCoordinates(position)
      : undefined;
  },
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
}) {
  const canvas = viewer.scene.canvas;
  const container = viewer.container ?? canvas.parentElement;

  const card = documentRef.createElement('div');
  card.className = 'propagation-station-card';
  card.setAttribute('role', 'tooltip');
  card.hidden = true;
  const head = documentRef.createElement('div');
  head.className = 'propagation-station-card-head';
  const title = documentRef.createElement('span');
  title.className = 'propagation-station-card-title';
  const close = documentRef.createElement('button');
  close.type = 'button';
  close.className = 'propagation-station-card-close';
  close.setAttribute('aria-label', 'Close station details');
  close.textContent = '×';
  head.append(title, close);
  const table = documentRef.createElement('table');
  table.className = 'propagation-station-card-table';
  const body = documentRef.createElement('tbody');
  table.appendChild(body);
  card.append(head, table);
  container.appendChild(card);

  let pinnedCode = null;
  let pinnedOffset = { dx: 0, dy: 0 };
  let pendingMove = null;
  let timer = null;
  let down = null;
  let followRemover = null;

  const canvasPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const codeAt = (point) => {
    const id = pick(point.x, point.y);
    return typeof id === 'string' && id.startsWith(STATION_ID_PREFIX)
      ? id.slice(STATION_ID_PREFIX.length)
      : null;
  };

  function render(details, pinned) {
    title.textContent = details.name;
    body.replaceChildren(
      ...details.rows
        .filter(([label]) => label !== 'Station')
        .map(([label, value]) => {
          const row = documentRef.createElement('tr');
          const th = documentRef.createElement('th');
          th.scope = 'row';
          th.textContent = label;
          const td = documentRef.createElement('td');
          td.textContent = value;
          row.append(th, td);
          return row;
        }),
    );
    card.classList.toggle('pinned', pinned);
    card.setAttribute('role', pinned ? 'dialog' : 'tooltip');
    card.setAttribute('aria-label', `${details.name} ionosonde details`);
  }

  function place(anchor) {
    card.hidden = false;
    const spot = placeCard(
      anchor,
      { width: card.offsetWidth || 220, height: card.offsetHeight || 180 },
      { width: canvas.clientWidth, height: canvas.clientHeight },
    );
    card.style.left = `${Math.round(spot.x)}px`;
    card.style.top = `${Math.round(spot.y)}px`;
  }

  function hideCard() {
    card.hidden = true;
  }

  function follow() {
    if (pinnedCode === null) return;
    const details = surface.detailsFor(pinnedCode, now());
    if (!details || !details.visible) {
      // Behind the planet for now: keep the pin, hide the card.
      hideCard();
      return;
    }
    const at = project(details.entity);
    if (!at) return hideCard();
    place({ x: at.x + pinnedOffset.dx, y: at.y + pinnedOffset.dy });
  }

  function unpin() {
    if (pinnedCode === null) return;
    pinnedCode = null;
    followRemover?.();
    followRemover = null;
    card.classList.toggle('pinned', false);
    hideCard();
  }

  function pin(code, point) {
    const details = surface.detailsFor(code, now());
    if (!details || !details.visible) return;
    pinnedCode = code;
    render(details, true);
    const at = project(details.entity);
    pinnedOffset = at
      ? { dx: point.x - at.x, dy: point.y - at.y }
      : { dx: 0, dy: 0 };
    place(point);
    if (!followRemover)
      followRemover = viewer.scene.postRender?.addEventListener(follow) ?? null;
  }

  function runHover() {
    timer = null;
    const event = pendingMove;
    pendingMove = null;
    if (!event) return;
    const point = canvasPoint(event);
    const code = codeAt(point);
    canvas.style.cursor = code ? 'pointer' : '';
    // A pinned card owns the display; hover only keeps the cursor honest.
    if (pinnedCode !== null) return;
    const details = code ? surface.detailsFor(code, now()) : null;
    if (!details || !details.visible) return hideCard();
    render(details, false);
    place(point);
  }

  function onMove(event) {
    // A held button is a camera drag; do not pick underneath it.
    if (event.buttons) {
      pendingMove = null;
      if (pinnedCode === null) hideCard();
      return;
    }
    pendingMove = event;
    if (timer === null) timer = setTimer(runHover, HOVER_THROTTLE_MS);
  }

  function onLeave() {
    pendingMove = null;
    canvas.style.cursor = '';
    if (pinnedCode === null) hideCard();
  }

  function onDown(event) {
    down = canvasPoint(event);
  }

  function onClick(event) {
    const point = canvasPoint(event);
    if (
      down &&
      Math.hypot(point.x - down.x, point.y - down.y) > DRAG_TOLERANCE_PX
    ) {
      down = null;
      return;
    }
    down = null;
    const code = codeAt(point);
    if (code === null) return unpin();
    if (code === pinnedCode) return unpin();
    unpin();
    pin(code, point);
  }

  function onKey(event) {
    if (event.key === 'Escape') unpin();
  }

  const onClose = () => unpin();

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('click', onClick);
  close.addEventListener('click', onClose);
  documentRef.addEventListener('keydown', onKey);

  return {
    /** Data changed: drop a pin whose station vanished, refresh its numbers. */
    refresh() {
      if (pinnedCode === null) return;
      const details = surface.detailsFor(pinnedCode, now());
      if (!details) return unpin();
      render(details, true);
    },
    /** Close everything (layer off). */
    hide() {
      unpin();
      pendingMove = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
      canvas.style.cursor = '';
      hideCard();
    },
    get pinned() {
      return pinnedCode;
    },
    destroy() {
      this.hide();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('click', onClick);
      close.removeEventListener('click', onClose);
      documentRef.removeEventListener('keydown', onKey);
      card.remove();
    },
  };
}
