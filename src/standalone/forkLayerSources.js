// The standalone acquisition sources for this fork's layers, keyed as the
// catalog's source contracts (src/fork/manifest.js) name them.
import { createPropagationSource } from '../layers/propagation/source.js';
import { createAprsSource } from '../layers/aprs/source.js';
import { createMeshtasticSource } from '../layers/meshtastic/source.js';

export function createForkLayerSources() {
  return {
    propagation: createPropagationSource(),
    aprs: createAprsSource(),
    meshtastic: createMeshtasticSource(),
  };
}
