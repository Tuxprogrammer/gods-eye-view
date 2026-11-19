import { findGlobe } from '../../render/rendererOf.js';

/**
 * What the heatmap and its rings are draped onto (a draw item's `clampTo`).
 * The photoreal stack draws Google 3D tiles with the globe HIDDEN, so only the
 * tiles apply there; every other stack shows the globe, so only terrain does.
 * The boot-time stack change is silent, so the initial answer asks the globe
 * port whether the globe is shown (`globeVisibility`); a renderer that cannot
 * say gets both.
 * @param {object|null|undefined} viewer The scene object.
 * @param {string|null|undefined} activeId MapStackController stack id, if known.
 * @returns {'tiles'|'terrain'|'both'}
 */
export function heatmapClassificationType(viewer, activeId) {
  if (activeId === 'photoreal') return 'tiles';
  const visible = viewer ? findGlobe(viewer)?.isGlobeVisible?.() : undefined;
  if (typeof visible !== 'boolean') return 'both';
  return visible ? 'terrain' : 'tiles';
}

/** Whether this target lands on 3D tiles. */
export function classificationUsesTiles(type) {
  return type === 'tiles' || type === 'both';
}
