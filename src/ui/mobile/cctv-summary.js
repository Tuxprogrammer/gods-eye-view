/** Pure helpers for the mobile CCTV page (tile summary, sync chip mirror). */

const clean = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Tile summary: "Off", "On" or "On · <camera>".
 * @param {{enabled?: boolean, camera?: string}} state
 */
export function cctvTileSummary({ enabled, camera } = {}) {
  if (!enabled) return 'Off';
  const name = clean(camera);
  return name ? `On · ${name}` : 'On · tap a camera on the map';
}

/**
 * Status-line message for the CCTV frame-loading chip, or null when the chip
 * is not showing. The desktop chip is `.visible` while loading.
 * @param {{visible?: boolean, label?: string, progress?: string}} chip
 */
export function describeCctvSync({ visible, label, progress } = {}) {
  if (!visible) return null;
  const text = [clean(label), clean(progress)].filter(Boolean).join(' ');
  return text ? { text, kind: 'loading', ttl: 0 } : null;
}

/** Status-line message when the active camera changes (tap on the globe). */
export function describeCctvActive(camera) {
  const name = clean(camera);
  return name
    ? { text: `CCTV · ${name} · tap the camera button to view`, ttl: 3500 }
    : null;
}
