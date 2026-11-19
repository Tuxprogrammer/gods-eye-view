import { createPropagationLayer } from '../../layers/propagation/index.js';
import { overlayHost } from './overlayHost.js';
/**
 * Wire the propagation heatmap to the window's map-stack change events, and
 * its printed levels and readings to the application overlay host.
 */
export function createApplicationPropagation(options) {
  return createPropagationLayer({
    mapStackEventTarget: typeof window !== 'undefined' ? window : null,
    overlayHost,
    ...options,
  });
}
