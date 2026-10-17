// This fork's layers, constructed in catalog order (src/fork/manifest.js
// lists the same ids). constructCatalog.js spreads them in with one call.
import { createApplicationPropagation } from './propagation.js';
import { createApplicationAprs } from './aprs.js';
import { createApplicationMeshtastic } from './meshtastic.js';

/** @param {Record<string, object>} sources The catalog's acquisition sources. */
export function createForkApplicationLayers(sources) {
  return [
    createApplicationPropagation({ source: sources.propagation }),
    createApplicationAprs({ source: sources.aprs }),
    createApplicationMeshtastic({ source: sources.meshtastic }),
  ];
}
