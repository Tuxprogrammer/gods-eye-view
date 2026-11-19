// This fork's additions that upstream's count and enum pins must allow for.
// Upstream tests import from here instead of hard-coding the fork's ids. The
// ids come from src/fork/, so a new fork layer or basemap only needs the pins
// that hash or spell out the payload (actionSchemas) to be re-derived.
import { FORK_MAP_STACK_IDS } from '../fork/mapStacks.js';

export { FORK_LAYER_IDS } from '../fork/manifest.js';
export { FORK_MAP_STACK_IDS };

/**
 * The fork layers' share-link tokens. Pinned here, not read from
 * src/data/layerState.js, so a changed token fails the ledger test. They sit
 * at the far end of the two-character space so upstream's digits-first
 * allocator does not reach them.
 */
export const FORK_LAYER_STATE_TOKENS = Object.freeze({
  aprs: 'zz',
  meshtastic: 'zy',
  propagation: 'zx',
  crime: 'zw',
});

/**
 * Fork files that still reach Cesium directly, beside upstream's
 * src/render/cesiumAllowList.json: they predate the renderer contract. The
 * Cesium ratchets (src/render/noCesiumOutsideRender.test.mjs,
 * src/testSupport/viewerAccess.mjs) treat them as on that list; port a file
 * to the contract and remove it here. Sorted.
 */
export const FORK_CESIUM_FILES = Object.freeze([
  'src/layers/aprs/index.js',
  'src/layers/aprs/rendering.js',
  'src/layers/crime/index.js',
  'src/layers/meshtastic/index.js',
  'src/layers/meshtastic/rendering.js',
  'src/layers/propagation/horizon.js',
  'src/layers/propagation/rendering.js',
  'src/layers/propagation/stationInteraction.js',
  'src/layers/propagation/surface.js',
  'src/layers/propagation/tilesetQuality.js',
  'src/ui/mobile/pages/cards.js',
]);

/**
 * Fork files off that list that still reach Cesium through the viewer, with
 * how many accesses each still has, beside upstream's
 * src/render/viewerAccessAllowList.json (src/render/viewerAccess.test.mjs).
 * Counts only ever go down.
 */
export const FORK_VIEWER_ACCESS = Object.freeze({
  'src/layers/aprs/interaction.js': 5,
  'src/layers/aprs/popups.js': 6,
  'src/layers/propagation/index.js': 9,
});

/** An enum with the fork's map stacks removed, so upstream's pin holds. */
export const withoutForkMapStacks = (ids) =>
  ids.filter((id) => !FORK_MAP_STACK_IDS.includes(id));

/**
 * A copy of a Realtime tool payload with the fork's map stacks removed from
 * `set_map_stack`, so a pinned payload hash stays upstream's.
 */
export function withoutForkToolValues(tools) {
  const copy = structuredClone(tools);
  const stack = copy.find((tool) => tool.name === 'set_map_stack')?.parameters
    ?.properties?.stack;
  if (stack) stack.enum = withoutForkMapStacks(stack.enum);
  return copy;
}
