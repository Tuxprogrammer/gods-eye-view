/**
 * Touch hit slop for Cesium picking. Cesium's `scene.pick(pos)` reads a 3x3
 * pixel rectangle (radius ~1px), which is far smaller than a fingertip. Every
 * layer picks through `scene.pick` / `scene.drillPick`, so widening the default
 * on the Scene prototype gives every layer slop without editing any of them.
 * Cesium resolves a wide pick rectangle from the centre outward, so the object
 * nearest the tap wins.
 *
 * Only mobile mode installs this, and it is fully reversible (mode flips back).
 */
export const PICK_SLOP_PX = 28;
export const DRILL_SLOP_PX = 20;

/**
 * @param {{prototype: object}} SceneClass Cesium.Scene (or a test double).
 * @returns {() => void} Uninstaller.
 */
export function installPickSlop(SceneClass, options = {}) {
  const proto = SceneClass?.prototype;
  if (!proto || proto.__gevPickSlop) return () => {};
  const pickSlop = options.pick ?? PICK_SLOP_PX;
  const drillSlop = options.drill ?? DRILL_SLOP_PX;
  const originalPick = proto.pick;
  const originalDrill = proto.drillPick;
  if (typeof originalPick !== 'function') return () => {};

  proto.pick = function pickWithSlop(windowPosition, width, height) {
    // Explicit sizes (e.g. the CCTV gizmo's 14px) are the caller's decision.
    return originalPick.call(
      this,
      windowPosition,
      width ?? pickSlop,
      height ?? pickSlop,
    );
  };
  if (typeof originalDrill === 'function') {
    proto.drillPick = function drillPickWithSlop(
      windowPosition,
      limit,
      width,
      height,
    ) {
      return originalDrill.call(
        this,
        windowPosition,
        limit,
        Math.max(width ?? 0, drillSlop),
        Math.max(height ?? 0, drillSlop),
      );
    };
  }
  proto.__gevPickSlop = true;
  return () => {
    proto.pick = originalPick;
    if (originalDrill) proto.drillPick = originalDrill;
    delete proto.__gevPickSlop;
  };
}
