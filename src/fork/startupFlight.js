/**
 * @module fork/startupFlight
 * @description Fork: the cinematic start over Huntsville, AL (U.S. Space &
 * Rocket Center / Marshall Space Flight Center). Upstream opens at planet
 * level (`applyStartView` in src/camera.js); without a shared view this fork
 * then drops to 20 km over Huntsville and flies down to the default viewport.
 * Kept as named constants so a future re-point is a one-line diff.
 */
import { toRadians } from '../geo/index.js';
import { cameraOf } from '../render/rendererOf.js';

export const FORK_START_VIEW = Object.freeze({
  lon: -86.6528,
  lat: 34.7075,
  height: 355,
  heading: 330,
  pitch: -22,
});

/** Height the fly-in starts from, straight above the start view. */
const APPROACH_HEIGHT = 20000;
/** Pause before the fly-in, so the first frames load first. */
const FLY_IN_DELAY_MS = 500;
const FLY_IN_DURATION_S = 4;

/**
 * Put the camera high over the start view, then fly down to it.
 * @returns {Function} Cancels the pending or active flight.
 */
export function flyToForkStart(viewer, view = FORK_START_VIEW) {
  const camera = cameraOf(viewer);
  const { lon, lat, height, heading = 0, pitch = -90 } = view;
  camera.setView({
    destination: { lon, lat, height: APPROACH_HEIGHT },
    orientation: { heading: 0, pitch: toRadians(-90), roll: 0 },
  });
  let flight = null;
  const timer = setTimeout(() => {
    // A camera port without flights (a headless or test renderer) stays
    // at the approach view.
    if (viewer.isDestroyed?.() || typeof camera.flyTo !== 'function') return;
    flight = camera.flyTo(
      { lon, lat, height },
      {
        orientation: {
          heading: toRadians(heading),
          pitch: toRadians(pitch),
          roll: 0,
        },
        durationS: FLY_IN_DURATION_S,
        easing: 'cubicInOut',
      },
    );
  }, FLY_IN_DELAY_MS);
  return () => {
    clearTimeout(timer);
    if (viewer.isDestroyed?.()) return;
    if (flight) flight.cancel();
    else camera.cancelFlight();
  };
}
