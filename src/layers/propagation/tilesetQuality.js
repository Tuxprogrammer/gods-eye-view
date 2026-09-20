import * as Cesium from 'cesium';

/**
 * Keep the 3D-tile surface fine enough for the heatmap to classify onto it.
 *
 * Investigation (Andes at 3,000 km, whole Earth at 18,000 km) showed the
 * untinted patches and dark holes track the Google tileset's level of detail,
 * not the overlay's geometry or texture: with dynamic screen-space error on,
 * coarse tiles are chosen that the classification pass does not tint reliably;
 * turning it off cleans the regional view, and a lower maximum error cleans the
 * whole-Earth view. The same artifacts appear with a plain colour material and
 * with any classification volume height, so they cannot be fixed in the overlay.
 *
 * The cost is more tile detail requested while the layer is on, so the change
 * is scoped to it: originals are remembered per tileset and restored on release.
 */
export const HEATMAP_TILESET_MAX_SSE = 6;
/**
 * Close views were clean at the app's default detail (artifacts began between
 * ~2,400 and ~3,000 km), so the finer tiles are only requested from high up.
 * Engage above the first height and release below the second, so a camera
 * hovering near the threshold does not flap the tileset between settings.
 */
export const HEATMAP_TILESET_ENGAGE_HEIGHT_M = 1_500_000;
export const HEATMAP_TILESET_RELEASE_HEIGHT_M = 1_000_000;

/** The 3D tilesets currently in the scene, via the public collection API. */
function sceneTilesets(scene) {
  const collection = scene?.primitives;
  const found = [];
  const count = Number(collection?.length) || 0;
  for (let i = 0; i < count; i++) {
    const primitive = collection.get(i);
    if (primitive instanceof Cesium.Cesium3DTileset) found.push(primitive);
  }
  return found;
}

/**
 * @param {{scene: Cesium.Scene, maximumScreenSpaceError?: number}} options
 * @returns {{apply: () => number, restore: () => void, readonly active: number}}
 */
export function createTilesetQualityGuard({
  scene,
  maximumScreenSpaceError = HEATMAP_TILESET_MAX_SSE,
}) {
  /** @type {Map<Cesium.Cesium3DTileset, {dynamic: boolean, sse: number}>} */
  const originals = new Map();

  const render = () => scene?.requestRender?.();

  return {
    /** Tighten every tileset in the scene; safe to call repeatedly. */
    apply() {
      for (const tileset of sceneTilesets(scene)) {
        if (!originals.has(tileset)) {
          originals.set(tileset, {
            dynamic: tileset.dynamicScreenSpaceError,
            sse: tileset.maximumScreenSpaceError,
          });
        }
        tileset.dynamicScreenSpaceError = false;
        // Never coarsen a tileset someone already made finer.
        tileset.maximumScreenSpaceError = Math.min(
          originals.get(tileset).sse,
          maximumScreenSpaceError,
        );
      }
      render();
      return originals.size;
    },
    /** Put every touched tileset back exactly as it was found. */
    restore() {
      for (const [tileset, original] of originals) {
        if (tileset.isDestroyed?.()) continue;
        tileset.dynamicScreenSpaceError = original.dynamic;
        tileset.maximumScreenSpaceError = original.sse;
      }
      originals.clear();
      render();
    },
    get active() {
      return originals.size;
    },
  };
}
