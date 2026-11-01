import * as Cesium from 'cesium';

// Default startup viewport — U.S. Space & Rocket Center / Marshall Space
// Flight Center, Huntsville, AL. Overridden from the original Austin, TX
// default at Spencer's request; kept as named constants (rather than
// inline in flyToAustin below) so a future re-point is a one-line diff.
const DEFAULT_LAT = 34.7075;
const DEFAULT_LON = -86.6528;
const DEFAULT_ALT = 355;
const DEFAULT_HEADING = 330;
const DEFAULT_PITCH = -22;
const DEFAULT_ROLL = 360;

/**
 * Set camera to the default startup viewport on load with a cinematic fly-in.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToAustin(viewer) {
  // Start from a high altitude, then fly down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(DEFAULT_LON, DEFAULT_LAT, 20000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        DEFAULT_LON,
        DEFAULT_LAT,
        DEFAULT_ALT,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(DEFAULT_HEADING),
        pitch: Cesium.Math.toRadians(DEFAULT_PITCH),
        roll: Cesium.Math.toRadians(DEFAULT_ROLL),
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
  return () => {
    clearTimeout(timer);
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}
