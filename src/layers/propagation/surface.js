import * as Cesium from 'cesium';

/**
 * Which surface the heatmap must be classified onto. The photoreal stack draws
 * Google 3D tiles with the Cesium globe HIDDEN, so only the 3D-tile pass
 * applies there; every other stack shows the globe, so only terrain does.
 * The boot-time stack change is silent, so the initial answer reads the scene.
 * @param {Cesium.Scene|null|undefined} scene
 * @param {string|null|undefined} activeId MapStackController stack id, if known.
 */
export function heatmapClassificationType(scene, activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

/** Whether this classification lands on 3D tiles (so tile detail matters). */
export function classificationUsesTiles(type) {
  return (
    type === Cesium.ClassificationType.CESIUM_3D_TILE ||
    type === Cesium.ClassificationType.BOTH
  );
}
