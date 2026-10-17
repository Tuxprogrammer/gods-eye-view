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
});

/** An enum with the fork's map stacks removed, so upstream's pin holds. */
export const withoutForkMapStacks = (ids) =>
  ids.filter((id) => !FORK_MAP_STACK_IDS.includes(id));
