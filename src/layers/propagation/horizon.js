import * as Cesium from 'cesium';

/**
 * Hide overlay entities that are on the far side of the Earth.
 *
 * Bubbles and labels are drawn with the depth test off so they stay legible
 * over terrain and buildings, which also means the globe no longer hides them:
 * a station in Australia shows through the planet when looking at Europe. This
 * is the missing occlusion, done analytically (horizon test against the
 * ellipsoid), so it needs no depth buffer and costs a few dot products a frame.
 *
 * The test runs from the camera's position and only when it has moved, and it
 * asks for a repaint only when something actually flipped.
 *
 * @param {{viewer: Cesium.Viewer, elevation?: number}} options `elevation` raises
 *   each test point (metres) so a station standing on the visible horizon does
 *   not flicker on and off with the terrain beneath it.
 */
export function createHorizonCuller({ viewer, elevation = 5000 }) {
  const occluder = new Cesium.EllipsoidalOccluder(
    Cesium.Ellipsoid.WGS84,
    new Cesium.Cartesian3(),
  );
  const lastCamera = new Cesium.Cartesian3(NaN, NaN, NaN);
  /** @type {Array<{point: Cesium.Cartesian3, entities: Cesium.Entity[]}>} */
  let items = [];
  let remover = null;

  function update(force = false) {
    const camera = viewer.camera?.positionWC;
    if (!camera) return;
    // Sub-kilometre movement cannot change what is over the horizon.
    if (!force && Cesium.Cartesian3.equalsEpsilon(camera, lastCamera, 0, 500))
      return;
    Cesium.Cartesian3.clone(camera, lastCamera);
    occluder.cameraPosition = camera;
    let flipped = false;
    for (const item of items) {
      const visible = occluder.isPointVisible(item.point);
      for (const entity of item.entities) {
        if (entity.show !== visible) {
          entity.show = visible;
          flipped = true;
        }
      }
    }
    if (flipped) viewer.scene?.requestRender?.();
  }

  function detach() {
    remover?.();
    remover = null;
  }

  return {
    /** Replace the tracked set; each item is a surface point and its entities. */
    set(next) {
      items = next.map(({ lon, lat, entities }) => ({
        point: Cesium.Cartesian3.fromDegrees(lon, lat, elevation),
        entities,
      }));
      Cesium.Cartesian3.clone(new Cesium.Cartesian3(NaN, NaN, NaN), lastCamera);
      update(true);
      if (items.length && !remover)
        remover = viewer.scene?.preRender?.addEventListener(() => update());
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
