import { fromDegrees } from '../../geo/ellipsoid.js';
import { horizonFrom } from '../../geo/horizon.js';
import { distanceSquared } from '../../geo/vector.js';
import { findCamera, findFrame } from '../../render/rendererOf.js';

/** Sub-kilometre movement cannot change what is over the horizon. */
const MOVE_EPSILON_M = 500;

/**
 * Hide overlay items that are on the far side of the Earth.
 *
 * Bubbles and labels are drawn with the depth test off so they stay legible
 * over terrain and buildings, which also means the globe no longer hides them:
 * a station in Australia shows through the planet when looking at Europe. This
 * is the missing occlusion, done analytically (horizon test against the
 * ellipsoid), so it needs no depth buffer and costs a few dot products a frame.
 *
 * The test runs from the camera's position (the camera port's pose) before
 * each frame, only when the camera has moved, and it hands `onChange` the
 * targets whose `show` it flipped (then asks for a repaint) only when
 * something actually flipped.
 *
 * @param {{viewer: object, elevation?: number,
 *   onChange?: (flipped: object[]) => void}} options `elevation` raises each
 *   test point (metres) so a station standing on the visible horizon does not
 *   flicker on and off with the terrain beneath it.
 */
export function createHorizonCuller({ viewer, elevation = 5000, onChange }) {
  let last = null;
  /** @type {Array<{point: {x: number, y: number, z: number}, targets: object[]}>} */
  let items = [];
  let remover = null;

  function eye() {
    const position = findCamera(viewer)?.pose?.()?.position;
    return position && Number.isFinite(position.x) ? position : null;
  }

  function update(force = false) {
    const camera = eye();
    if (!camera) return;
    if (
      !force &&
      last &&
      distanceSquared(camera, last) <= MOVE_EPSILON_M * MOVE_EPSILON_M
    )
      return;
    last = { x: camera.x, y: camera.y, z: camera.z };
    const horizon = horizonFrom(camera);
    const flipped = [];
    for (const item of items) {
      const visible = horizon.isPointVisible(item.point);
      for (const target of item.targets) {
        if (target.show !== visible) {
          target.show = visible;
          flipped.push(target);
        }
      }
    }
    if (!flipped.length) return;
    onChange?.(flipped);
    findFrame(viewer)?.requestRender('propagation-horizon');
  }

  function detach() {
    remover?.();
    remover = null;
  }

  return {
    /** Replace the tracked set; each item is a surface point and its targets. */
    set(next) {
      items = next.map(({ lon, lat, targets }) => ({
        point: fromDegrees(lon, lat, elevation),
        targets,
      }));
      last = null;
      update(true);
      if (items.length && !remover)
        remover = findFrame(viewer)?.on('preRender', () => update()) ?? null;
      if (!items.length) detach();
    },
    clear() {
      items = [];
      detach();
    },
    /** Re-evaluate now, e.g. after the camera jumped. */
    refresh() {
      update(true);
    },
    destroy() {
      items = [];
      detach();
    },
  };
}
