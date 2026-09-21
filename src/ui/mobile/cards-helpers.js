/**
 * Pure helpers for the mobile card surfaces (no DOM, no Cesium), so the logic
 * that decides what a tap does can be unit tested. See pages/cards.js.
 */
import {
  MAX_VERTICES,
  MIN_VERTICES,
  finishReason,
  formatMeasure,
} from '../../annotations/drawMode.js';

/** Index reached by stepping `delta` through a ring of `length` items. */
export function stepIndex(length, at, delta) {
  if (!Number.isInteger(length) || length < 1) return -1;
  const from = Number.isInteger(at) && at >= 0 && at < length ? at : 0;
  const step = delta < 0 ? -1 : 1;
  return (((from + step) % length) + length) % length;
}

/** A downward drag on a sheet header that should dismiss it. */
export function isSwipeDismiss({ dx = 0, dy = 0, ms = 0 } = {}) {
  if (dy < 48) return false;
  if (Math.abs(dx) > dy * 0.8) return false;
  // Slow drags need a longer travel than a flick.
  return ms < 260 ? dy >= 48 : dy >= 90;
}

/**
 * The on-screen draw toolbar's state from the tool's live session.
 * `session` is `window.__gevDrawTool.session` (or null while not drawing).
 * @returns {{count:number, canUndo:boolean, canFinish:boolean, hint:string, finishLabel:string}}
 */
export function drawToolbarState(session) {
  if (!session || !Array.isArray(session.vertices)) {
    return {
      count: 0,
      canUndo: false,
      canFinish: false,
      hint: 'Tap the map to start.',
      finishLabel: 'Finish',
    };
  }
  const count = session.vertices.length;
  const shape = session.shape;
  const finishLabel = shape === 'pin' ? 'Place pin' : 'Finish';
  const reason = finishReason(session);
  let hint;
  if (count === 0) {
    hint =
      shape === 'pin'
        ? 'Tap where the pin goes.'
        : 'Tap the map to add points.';
  } else if (reason === 'too-few') {
    const need = (MIN_VERTICES[shape] || 1) - count;
    hint = `Tap ${need} more point${need === 1 ? '' : 's'}.`;
  } else if (reason === 'degenerate') {
    hint =
      shape === 'area'
        ? 'Those points are in a line. Move one off it.'
        : 'That line has no length. Tap further away.';
  } else if (reason === 'invalid') {
    hint = 'A point is off the globe. Undo it.';
  } else {
    const measure = safeMeasure(session);
    hint =
      shape === 'pin'
        ? `Tap ${finishLabel} to drop it, or tap the map to move it.`
        : `${measure ? `${measure} · ` : ''}Tap Finish when done.`;
    if (count >= MAX_VERTICES) hint += ' Point limit reached.';
  }
  return {
    count,
    canUndo: count > 0,
    canFinish: reason === 'ok',
    hint,
    finishLabel,
  };
}

function safeMeasure(session) {
  try {
    return formatMeasure(session) || '';
  } catch {
    return '';
  }
}

/** First line of the AIS HUD readout becomes the sheet title. */
export function parseVesselReadout(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const title = lines[0].replace(/^AIS:\s*/i, '');
  if (!title || title === '--') return null;
  return { title, lines: lines.slice(1) };
}
