import { createAprsLayer } from '../../layers/aprs/index.js';
/** Wire the APRS layer to the window's map-stack change events. */
export function createApplicationAprs(options) {
  return createAprsLayer({
    mapStackEventTarget: typeof window !== 'undefined' ? window : null,
    ...options,
  });
}
