import { createMeshtasticLayer } from '../../layers/meshtastic/index.js';
import * as overlays from '../../overlays/worldOverlay.js';

/**
 * Wire the Meshtastic layer to the window's map-stack change events, and its
 * station labels to the world-overlay host.
 */
export function createApplicationMeshtastic(options) {
  return createMeshtasticLayer({
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
