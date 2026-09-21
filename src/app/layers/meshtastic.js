import { createMeshtasticLayer } from '../../layers/meshtastic/index.js';
/** Wire the Meshtastic layer to the window's map-stack change events. */
export function createApplicationMeshtastic(options) {
  return createMeshtasticLayer({
    mapStackEventTarget: typeof window !== 'undefined' ? window : null,
    ...options,
  });
}
