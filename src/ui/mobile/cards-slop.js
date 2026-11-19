/**
 * Touch hit slop for the fork's own station picks. A query port pick reads a
 * 3x3 pixel window, far smaller than a fingertip, so in the mobile UI the
 * fork's layers (APRS, Meshtastic, HF propagation stations) ask for a wider
 * window through the contract (`query.pick(x, y, window)` and
 * `query.drillPick`). Every other layer gets upstream's coarse-pointer contact
 * search instead (`pickContact` in src/data/pickRegistry.js), which every
 * click handler sees as `click.hit`.
 */
export const PICK_SLOP_PX = 28;
export const DRILL_SLOP_PX = 20;

/** Whether the fork's mobile UI is on. */
const mobileUi = () =>
  globalThis.document?.documentElement?.dataset?.ui === 'mobile';

/**
 * The window a pick at a tap should read: wide in the mobile UI, the port's
 * own default (undefined) otherwise.
 * @param {{mobile?: boolean}} [options] `mobile` overrides the page's mode (tests).
 * @returns {{width: number, height: number}|undefined}
 */
export function touchPickWindow({ mobile = mobileUi() } = {}) {
  return mobile ? { width: PICK_SLOP_PX, height: PICK_SLOP_PX } : undefined;
}

/**
 * The window a drill pick reads: at least `minimum` pixels square, and at
 * least the drill slop in the mobile UI.
 * @param {number} [minimum]
 * @param {{mobile?: boolean}} [options]
 * @returns {{width: number, height: number}}
 */
export function touchDrillWindow(minimum = 0, { mobile = mobileUi() } = {}) {
  const size = Math.max(minimum, mobile ? DRILL_SLOP_PX : 0);
  return { width: size, height: size };
}
