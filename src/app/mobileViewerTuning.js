/**
 * @module app/mobileViewerTuning
 * @description Fork: the phone UI's rendering budget, computed from injected
 * values only (this module never reads the UI mode). `scene.js` hands it to
 * the renderer: `msaaSamples` as the renderer's `msaa`, `resolutionScale` as
 * the quality port's `pixelRatio`, and `tilesetMaximumScreenSpaceError` to the
 * photoreal tileset before it is added.
 */

const MOBILE_MSAA_SAMPLES = 2;
const MOBILE_MAX_RESOLUTION_SCALE = 1.25;
const MOBILE_TILESET_MAX_SSE = 24;

/**
 * Rendering budget for touch devices: fewer MSAA samples, a capped render
 * scale (Cesium already renders at CSS pixels; the scale sharpens modestly and
 * never exceeds min(devicePixelRatio, 1.25)) and a slightly coarser tile SSE.
 */
export function mobileViewerTuning(devicePixelRatio = 1) {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return {
    msaaSamples: MOBILE_MSAA_SAMPLES,
    resolutionScale: Math.min(ratio, 2, MOBILE_MAX_RESOLUTION_SCALE),
    tilesetMaximumScreenSpaceError: MOBILE_TILESET_MAX_SSE,
  };
}
