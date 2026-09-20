import { createPropagationLayer } from '../../layers/propagation/index.js';
/** Wire the propagation heatmap to the window's map-stack change events. */
export function createApplicationPropagation(options) {
  return createPropagationLayer({
    mapStackEventTarget: typeof window !== 'undefined' ? window : null,
    ...options,
  });
}
