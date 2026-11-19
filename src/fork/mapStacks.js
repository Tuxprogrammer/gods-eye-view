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

/** On-map credits of those stacks (src/maps/defaultSources.js). */
export const CARTO_ATTRIBUTION_HTML =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
export const OPENFREEMAP_ATTRIBUTION_HTML =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
