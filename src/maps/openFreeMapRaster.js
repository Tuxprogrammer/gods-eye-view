// Fork. OpenFreeMap publishes vector tiles only. To use it as globe imagery
// each Web Mercator tile is drawn to a 512 px canvas by a single hidden
// MapLibre map, then handed to the renderer's globe port as PNG bytes
// (`fetchTile` of an `xyz` spec, src/render/contract/globe.d.ts). Every request
// MapLibre makes (style, vector tiles, sprites, glyphs) goes through the
// server's disk cache at /api/tiles/ofm, so upstream sees each one once.

export const OFM_STYLE_URL = '/api/tiles/ofm/style.json';
const TILE_SIZE = 512;
const RENDER_TIMEOUT_MS = 20_000;
/** Tiles waiting at once; the renderer asks for the rest later. */
const MAX_PENDING = 6;
const MAX_LEVEL = 18;

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
 * One hidden MapLibre map that draws OpenFreeMap tiles, one at a time.
 * @param {{maplibre?: object, fetchImpl?: typeof fetch, origin?: string, document?: Document}} [deps]
 * @returns {Promise<{renderTile: (x: number, y: number, level: number) => Promise<HTMLCanvasElement>, destroy: () => void}>}
 */
export async function createOpenFreeMapTileRenderer({
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
  try {
    await new Promise((resolve, reject) => {
      map.once('load', resolve);
      map.once('error', (event) =>
        reject(event?.error || new Error('OpenFreeMap style failed to load')),
      );
    });
  } catch (error) {
    map.remove();
    container.remove();
    throw error;
  }

  let chain = Promise.resolve();
  let destroyed = false;

  function draw(x, y, level) {
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

  return {
    /** Tiles draw one after another: the one map moves to each in turn. */
    renderTile(x, y, level) {
      if (destroyed) return Promise.reject(new Error('destroyed'));
      const run = chain.then(() => draw(x, y, level));
      chain = run.catch(() => {});
      return run;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      map.remove();
      container.remove();
    },
  };
}

/** The page's one tile renderer, made when the stack is first shown. */
let shared = null;

function sharedRenderer() {
  if (!shared) {
    const made = createOpenFreeMapTileRenderer();
    shared = made;
    // A renderer that failed to start is tried again next time.
    made.catch(() => {
      if (shared === made) shared = null;
    });
  }
  return shared;
}

const canvasBytes = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? blob.arrayBuffer().then(resolve, reject)
          : reject(new Error('OpenFreeMap tile could not be encoded')),
      'image/png',
    ),
  );

/**
 * The OpenFreeMap Dark stack's imagery spec for the globe port. Rejects when
 * the style cannot load, so the stack falls back to OSM.
 * @param {{renderer?: Promise<object>}} [options] A tile renderer (tests).
 */
export async function openFreeMapImagerySpec({
  renderer = sharedRenderer(),
} = {}) {
  const tiles = await renderer;
  return Object.freeze({
    kind: 'xyz',
    // Never fetched: `fetchTile` draws each tile instead.
    url: '/api/tiles/ofm/raster/{z}/{x}/{y}.png',
    tiling: 'webMercator',
    minLevel: 0,
    maxLevel: MAX_LEVEL,
    tileSize: TILE_SIZE,
    maxConcurrentRequests: MAX_PENDING,
    credit: { text: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap' },
    async fetchTile({ tile, signal }) {
      signal?.throwIfAborted();
      const canvas = await tiles.renderTile(tile.x, tile.y, tile.level);
      signal?.throwIfAborted();
      return { bytes: await canvasBytes(canvas), contentType: 'image/png' };
    },
  });
}

/**
 * A CARTO raster basemap's imagery spec ('light_all' = Positron, 'dark_all'
 * = Dark Matter), pulled through the server's permanent tile cache so each
 * tile is requested from CARTO once. The API key lives on the server.
 */
export function cartoImagerySpec(style) {
  return Object.freeze({
    kind: 'xyz',
    url: `/api/tiles/carto/${style}/{z}/{x}/{y}.png`,
    tiling: 'webMercator',
    minLevel: 0,
    maxLevel: 20,
    credit: { text: '© OpenStreetMap contributors © CARTO' },
  });
}

/** The fork's imagery kinds, spread into the globe map engine's own. */
export const FORK_GLOBE_IMAGERY = Object.freeze({
  carto: cartoImagerySpec,
  openfreemap: () => openFreeMapImagerySpec(),
});
