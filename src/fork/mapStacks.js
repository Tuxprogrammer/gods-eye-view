// The basemaps this fork adds, as plain data with no imports: the voice schema,
// voice aliases, source chips and cable policy spread these into their own
// tables, so a new fork basemap is listed here once.

/**
 * Basemaps the fork adds to `set_map_stack`, the source chips and the cable
 * layer's 2D-globe stacks. Their definitions live in src/maps/.
 */
export const FORK_MAP_STACK_IDS = Object.freeze([
  'carto-positron',
  'carto-dark',
  'openfreemap-dark',
]);

/** Spoken and typed names for those stacks, for the voice `STACK_ALIASES`. */
export const FORK_MAP_STACK_ALIASES = Object.freeze([
  ['carto-positron', 'carto-positron'],
  ['carto positron', 'carto-positron'],
  ['positron', 'carto-positron'],
  ['carto light', 'carto-positron'],
  ['light map', 'carto-positron'],
  ['carto-dark', 'carto-dark'],
  ['carto dark', 'carto-dark'],
  ['dark matter', 'carto-dark'],
  ['openfreemap-dark', 'openfreemap-dark'],
  ['openfreemap', 'openfreemap-dark'],
  ['open free map', 'openfreemap-dark'],
  ['dark map', 'openfreemap-dark'],
]);
