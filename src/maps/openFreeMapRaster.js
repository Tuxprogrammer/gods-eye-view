import * as Cesium from 'cesium';

// OpenFreeMap publishes vector tiles only. To use it as a Cesium imagery
// source each Web Mercator tile is drawn to a 512 px canvas by a single hidden
// MapLibre map, then handed to Cesium as an ordinary image. Every request
// MapLibre makes (style, vector tiles, sprites, glyphs) goes through the
// server's disk cache at /api/tiles/ofm, so upstream sees each one once.

export const OFM_STYLE_URL = '/api/tiles/ofm/style.json';
const TILE_SIZE = 512;
const RENDER_TIMEOUT_MS = 20_000;
/** Beyond this many waiting tiles, decline; Cesium re-asks for those still on screen. */
const MAX_PENDING = 6;

const absolute = (url, origin) =>
  typeof url === 'string' && url.startsWith('/') ? `${origin}${url}` : url;

/** MapLibre needs absolute URLs; the proxy's style uses same-origin paths. */
export function absolutizeStyle(style, origin) {
  const next = structuredClone(style);
  for (const source of Object.values(next.sources || {})) {
    if (Array.isArray(source.tiles))
      source.tiles = source.tiles.map((t) => absolute(t, origin));
    if (source.url) source.url = absolute(source.url, origin);
  }
  next.sprite = absolute(next.sprite, origin);
  next.glyphs = absolute(next.glyphs, origin);
  return next;
}

/** Centre of a Web Mercator tile, in degrees. */
export function tileCenter(x, y, level) {
  const n = 2 ** level;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return { lon, lat };
}

/**
 * @param {{maplibre?: object, fetchImpl?: typeof fetch, origin?: string, document?: Document}} [deps]
 */
export async function createOpenFreeMapImagery({
  maplibre,
  fetchImpl = fetch,
  origin = globalThis.location?.origin,
  document: doc = globalThis.document,
} = {}) {
  const response = await fetchImpl(OFM_STYLE_URL);
  if (!response.ok)
    throw new Error(`OpenFreeMap style unavailable (HTTP ${response.status})`);
  const style = absolutizeStyle(await response.json(), origin);
  const gl =
    maplibre || (await import('maplibre-gl').then((m) => m.default ?? m));
  if (!maplibre) {
    // Vite never emits maplibre's sibling worker module, so the default URL
    // (/assets/maplibre-gl-worker.mjs) falls through to index.html in production.
    const workerUrl = (await import('maplibre-gl/dist/maplibre-gl-worker.mjs?url')).default;
    gl.setWorkerUrl(workerUrl);
  }

  const container = doc.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${TILE_SIZE}px`,
    height: `${TILE_SIZE}px`,
    pointerEvents: 'none',
    opacity: '0',
  });
  doc.body.appendChild(container);

  const map = new gl.Map({
    container,
    style,
    center: [0, 0],
    zoom: 0,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: 1,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  await new Promise((resolve, reject) => {
    map.once('load', resolve);
    map.once('error', (event) =>
      reject(event?.error || new Error('OpenFreeMap style failed to load')),
    );
  });

  let chain = Promise.resolve();
  let pending = 0;
  let destroyed = false;

  function renderTile(x, y, level) {
    const { lon, lat } = tileCenter(x, y, level);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        map.off('idle', onIdle);
        reject(new Error('OpenFreeMap tile render timed out'));
      }, RENDER_TIMEOUT_MS);
      const onIdle = () => {
        clearTimeout(timer);
        try {
          // Copy inside the event: the drawing buffer is only guaranteed
          // until the frame is presented.
          const out = doc.createElement('canvas');
          out.width = out.height = TILE_SIZE;
          out.getContext('2d').drawImage(map.getCanvas(), 0, 0);
          resolve(out);
        } catch (error) {
          reject(error);
        }
      };
      map.once('idle', onIdle);
      map.jumpTo({ center: [lon, lat], zoom: level, bearing: 0, pitch: 0 });
      map.triggerRepaint();
    });
  }

  class OpenFreeMapImageryProvider {
    constructor() {
      this.errorEvent = new Cesium.Event();
      this.tilingScheme = new Cesium.WebMercatorTilingScheme();
      this.rectangle = this.tilingScheme.rectangle;
      this.tileWidth = TILE_SIZE;
      this.tileHeight = TILE_SIZE;
      this.minimumLevel = 0;
      this.maximumLevel = 18;
      this.tileDiscardPolicy = undefined;
      this.credit = new Cesium.Credit(
        'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
      );
      this.proxy = undefined;
      this.hasAlphaChannel = false;
    }

    requestImage(x, y, level) {
      if (destroyed || pending >= MAX_PENDING) return undefined;
      pending++;
      const run = chain.then(() =>
        destroyed ? undefined : renderTile(x, y, level),
      );
      chain = run
        .catch(() => {})
        .then(() => {
          pending--;
        });
      return run;
    }

    pickFeatures() {
      return undefined;
    }

    isDestroyed() {
      return destroyed;
    }

    destroy() {
      if (destroyed) return;
      destroyed = true;
      map.remove();
      container.remove();
    }
  }
  return new OpenFreeMapImageryProvider();
}
