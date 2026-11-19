import { createAprsLayer } from '../../layers/aprs/index.js';
import * as overlays from '../../overlays/worldOverlay.js';

/**
 * Wire the APRS layer to the window's map-stack change events, and its
 * station labels to the world-overlay host.
 */
export function createApplicationAprs(options) {
  return createAprsLayer({
    mapStackEventTarget: typeof window !== 'undefined' ? window : null,
    overlayHost: {
      setEntries: overlays.setOverlayEntries,
      setVisible: overlays.setOverlaySourceVisible,
      clearSource: overlays.clearOverlaySource,
      hitTest: overlays.hitTestWorldOverlay,
    },
    ...options,
  });
}
