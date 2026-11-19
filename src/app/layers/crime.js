import { createCrimeLayer } from '../../layers/crime/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { inputFor } from '../../input/dispatcher.js';

/** Wire the Madison PD crime layer into the application catalog. */
export function createApplicationCrime(options) {
  return createCrimeLayer({
    overlayHost: {
      setEntries: overlays.setOverlayEntries,
      setVisible: overlays.setOverlaySourceVisible,
      clearSource: overlays.clearOverlaySource,
      hitTest: overlays.hitTestWorldOverlay,
    },
    subscribeClick: (viewer, onClick) =>
      inputFor(viewer).onClick((event) => onClick({ pick: event.pick })),
    picking,
    pointer: { isPointerFree },
    ...options,
  });
}
