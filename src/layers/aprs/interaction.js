import { cardModel, chartSeries, sparklinePath } from './model.js';

/** Hover picks are throttled: a GPU pick per mouse-move event is wasteful. */
const HOVER_THROTTLE_MS = 70;
/** A press that moves further than this is a camera drag, not a click. */
const DRAG_TOLERANCE_PX = 5;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 120;
const CHART_HEIGHT = 26;

/** Keep a card of `size` inside `bounds`, preferring the lower right of `anchor`. */
export function placeCard(anchor, size, bounds, { gap = 14, margin = 8 } = {}) {
  let x = anchor.x + gap;
  if (x + size.width + margin > bounds.width) x = anchor.x - gap - size.width;
  let y = anchor.y + gap;
  if (y + size.height + margin > bounds.height)
    y = anchor.y - gap - size.height;
  return {
    x: Math.max(margin, Math.min(x, bounds.width - size.width - margin)),
    y: Math.max(margin, Math.min(y, bounds.height - size.height - margin)),
  };
}

/**
 * Hover and click on a station.
 *
 * Hovering previews the station as a small card beside the cursor, laid out
 * like aprs.fi's: heard times, the weather in prose, comment, packet path.
 * Clicking pins the card to the station (it follows as the camera moves) and
 * adds CENTER, ZOOM and a highlighted 24 h track, and — for a weather
 * station — small charts of its last day. Esc, the × button or a click
 * elsewhere closes it.
 *
 * Every string shown comes from radio packets typed by strangers, so the card
 * is built only with `textContent`; no packet text is ever parsed as HTML.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {object} options.surface The APRS surface.
 * @param {() => string} options.units
 * @param {(id: string, signal: AbortSignal) => Promise<object>} options.loadDetail
 * @param {(id: string, near: boolean) => void} options.flyTo
 */
export function createStationInteraction({
  viewer,
  surface,
  units,
  loadDetail,
  flyTo,
  // Another network reuses this card with its own text, charts and wording.
  cardModel: buildCard = cardModel,
  chartSeries: buildCharts = (detail, unit) =>
    chartSeries(detail?.weather ?? [], unit),
  noun = 'APRS station',
  logTag = 'APRS',
  messageLine = (m) => `${m.from} › ${m.to}: ${m.text}`,
  now = Date.now,
  documentRef = globalThis.document,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
}) {
  const canvas = viewer.scene.canvas;
  const container = viewer.container ?? canvas.parentElement;
  const el = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const card = el('div', 'aprs-card');
  card.setAttribute('role', 'tooltip');
  card.hidden = true;
  const head = el('div', 'aprs-card-head');
  const glyph = el('span', 'aprs-card-glyph');
  const title = el('span', 'aprs-card-title');
  const close = el('button', 'aprs-card-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close station details');
  head.append(glyph, title, close);
  const body = el('div', 'aprs-card-body');
  const charts = el('div', 'aprs-card-charts');
  const messages = el('div', 'aprs-card-messages');
  const actions = el('div', 'aprs-card-actions');
  const centerButton = el('button', 'aprs-card-action', 'CENTER');
  const zoomButton = el('button', 'aprs-card-action', 'ZOOM');
  const trackButton = el('button', 'aprs-card-action', 'TRACK 24 H');
  for (const button of [centerButton, zoomButton, trackButton])
    button.type = 'button';
  actions.append(centerButton, zoomButton, trackButton);
  card.append(head, body, charts, messages, actions);
  container.appendChild(card);

  let pinnedId = null;
  let pinnedOffset = { dx: 0, dy: 0 };
  let hoverId = null;
  let pendingMove = null;
  let timer = null;
  let down = null;
  let followRemover = null;
  let detailRequest = null;
  let trackOn = false;

  const canvasPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  function renderLines(model) {
    body.replaceChildren(
      ...model.lines.map((segments) => {
        const line = el('div', 'aprs-card-line');
        for (const segment of segments)
          line.appendChild(
            el(segment.b ? 'strong' : 'span', undefined, segment.t),
          );
        return line;
      }),
    );
  }

  function renderCharts(detail) {
    const series = buildCharts(detail, units());
    charts.hidden = series.length === 0;
    charts.replaceChildren(
      ...series.map((item) => {
        const box = el('div', 'aprs-chart');
        const svg = documentRef.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
        svg.setAttribute('width', String(CHART_WIDTH));
        svg.setAttribute('height', String(CHART_HEIGHT));
        svg.setAttribute('role', 'img');
        svg.setAttribute(
          'aria-label',
          `${item.label}, last 24 hours: ${item.minText} to ${item.maxText}`,
        );
        const path = documentRef.createElementNS(SVG_NS, 'path');
        path.setAttribute(
          'd',
          sparklinePath(item.points, CHART_WIDTH, CHART_HEIGHT),
        );
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        box.append(
          el('div', 'aprs-chart-label', item.label),
          svg,
          el('div', 'aprs-chart-range', `${item.minText} – ${item.maxText}`),
        );
        return box;
      }),
    );
  }

  function renderMessages(detail) {
    const list = detail?.messages ?? [];
    messages.hidden = list.length === 0;
    messages.replaceChildren(
      ...list
        .slice(-4)
        .map((m) => el('div', 'aprs-card-message', messageLine(m))),
    );
  }

  function render(station, pinned) {
    const model = buildCard(station, units(), now());
    glyph.textContent = model.glyph;
    title.textContent = model.title;
    renderLines(model);
    card.classList.toggle('pinned', pinned);
    card.setAttribute('role', pinned ? 'dialog' : 'tooltip');
    card.setAttribute('aria-label', `${station.id} ${noun} details`);
    actions.hidden = !pinned;
    if (!pinned) {
      charts.hidden = true;
      messages.hidden = true;
    }
  }

  function place(anchor) {
    card.hidden = false;
    const spot = placeCard(
      anchor,
      { width: card.offsetWidth || 240, height: card.offsetHeight || 160 },
      { width: canvas.clientWidth, height: canvas.clientHeight },
    );
    card.style.left = `${Math.round(spot.x)}px`;
    card.style.top = `${Math.round(spot.y)}px`;
  }

  const hideCard = () => {
    card.hidden = true;
  };

  function follow() {
    if (pinnedId === null) return;
    const record = surface.recordFor(pinnedId);
    if (!record || !record.visible) return hideCard();
    const at = surface.screenPosition(
      pinnedId,
      record.station.lon,
      record.station.lat,
    );
    if (!at) return hideCard();
    place({ x: at.x + pinnedOffset.dx, y: at.y + pinnedOffset.dy });
  }

  function setTrack(on) {
    trackOn = on;
    trackButton.classList.toggle('active', on);
    trackButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) surface.clearSelectedTrack();
  }

  function unpin() {
    if (pinnedId === null) return;
    detailRequest?.abort();
    detailRequest = null;
    pinnedId = null;
    followRemover?.();
    followRemover = null;
    setTrack(false);
    surface.setEmphasis(null);
    card.classList.remove('pinned');
    hideCard();
  }

  async function fetchDetail(id) {
    detailRequest?.abort();
    const request = new AbortController();
    detailRequest = request;
    try {
      const detail = await loadDetail(id, request.signal);
      if (request.signal.aborted || pinnedId !== id) return;
      renderCharts(detail);
      renderMessages(detail);
      if (trackOn) surface.showSelectedTrack(detail.track);
      card.dataset.track = String(detail.track.length);
      pinnedDetail = detail;
      place(currentAnchor());
    } catch (error) {
      // The card still works without the extras; say nothing loud.
      if (!request.signal.aborted)
        console.warn(`[Data:${logTag}] detail:`, error);
    }
  }

  let pinnedDetail = null;
  function currentAnchor() {
    const record = pinnedId ? surface.recordFor(pinnedId) : null;
    const at = record
      ? surface.screenPosition(pinnedId, record.station.lon, record.station.lat)
      : null;
    return at
      ? { x: at.x + pinnedOffset.dx, y: at.y + pinnedOffset.dy }
      : { x: card.offsetLeft, y: card.offsetTop };
  }

  function pin(id, point) {
    const record = surface.recordFor(id);
    if (!record || !record.visible) return;
    pinnedId = id;
    pinnedDetail = null;
    render(record.station, true);
    charts.hidden = true;
    messages.hidden = true;
    surface.setEmphasis(id);
    const at = surface.screenPosition(
      id,
      record.station.lon,
      record.station.lat,
    );
    pinnedOffset = at
      ? { dx: point.x - at.x, dy: point.y - at.y }
      : { dx: 0, dy: 0 };
    place(point);
    if (!followRemover)
      followRemover = viewer.scene.postRender?.addEventListener(follow) ?? null;
    void fetchDetail(id);
  }

  function runHover() {
    timer = null;
    const event = pendingMove;
    pendingMove = null;
    if (!event) return;
    const point = canvasPoint(event);
    const id = surface.idAt(point.x, point.y);
    canvas.style.cursor = id ? 'pointer' : '';
    // A pinned card owns the display; hover only keeps the cursor honest.
    if (pinnedId !== null) return;
    const record = id ? surface.recordFor(id) : null;
    if (hoverId !== id) {
      hoverId = id;
      surface.setEmphasis(id);
    }
    if (!record || !record.visible) return hideCard();
    render(record.station, false);
    place(point);
  }

  function onMove(event) {
    // A held button is a camera drag; do not pick underneath it.
    if (event.buttons) {
      pendingMove = null;
      if (pinnedId === null) hideCard();
      return;
    }
    pendingMove = event;
    if (timer === null) timer = setTimer(runHover, HOVER_THROTTLE_MS);
  }

  function onLeave() {
    pendingMove = null;
    canvas.style.cursor = '';
    if (pinnedId === null) {
      hoverId = null;
      surface.setEmphasis(null);
      hideCard();
    }
  }

  const onDown = (event) => {
    down = canvasPoint(event);
  };

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
    const id = surface.idAt(point.x, point.y);
    if (id === null || id === pinnedId) return unpin();
    unpin();
    pin(id, point);
  }

  const onKey = (event) => {
    if (event.key === 'Escape') unpin();
  };
  centerButton.addEventListener('click', () => {
    if (pinnedId) flyTo(pinnedId, false);
  });
  zoomButton.addEventListener('click', () => {
    if (pinnedId) flyTo(pinnedId, true);
  });
  trackButton.addEventListener('click', () => {
    if (pinnedId === null) return;
    setTrack(!trackOn);
    if (trackOn) {
      if (pinnedDetail) surface.showSelectedTrack(pinnedDetail.track);
      else void fetchDetail(pinnedId);
    }
  });
  const onClose = () => unpin();

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('click', onClick);
  close.addEventListener('click', onClose);
  documentRef.addEventListener('keydown', onKey);

  return {
    /** New station data arrived: refresh the pinned card, drop it if the station is gone. */
    refresh() {
      if (pinnedId === null) return;
      const record = surface.recordFor(pinnedId);
      if (!record) return unpin();
      render(record.station, true);
      if (pinnedDetail) {
        renderCharts(pinnedDetail);
        renderMessages(pinnedDetail);
      }
    },
    /** Close everything (layer off). */
    hide() {
      unpin();
      pendingMove = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
      hoverId = null;
      canvas.style.cursor = '';
      hideCard();
    },
    get pinned() {
      return pinnedId;
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
