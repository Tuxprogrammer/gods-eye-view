import path from 'node:path';
import { createTileCache } from './tiles/cache.js';
import { createTilesMiddleware } from './tiles/middleware.js';

/**
 * Disk-cached basemap tiles for the CARTO and OpenFreeMap map sources, at
 * /api/tiles/*. Every tile is fetched from its upstream at most once and then
 * re-served from disk.
 *
 * Configuration (environment / .env):
 *   CARTO_API_KEY         CARTO basemaps key (server-side only; VITE_CARTO_API_KEY
 *                         is honoured as a fallback name)
 *   MAP_TILE_CACHE_DIR    default .gev-cache/tiles
 *
 * @returns {import('vite').Plugin}
 */
export function mapTilesProxy() {
  const install = (server) => {
    const root =
      process.env.MAP_TILE_CACHE_DIR ||
      path.join(process.cwd(), '.gev-cache', 'tiles');
    server.middlewares.use(
      '/api/tiles',
      createTilesMiddleware({
        root,
        cache: createTileCache({ root, warn: (m) => console.warn(m) }),
        cartoKey: () =>
          process.env.CARTO_API_KEY || process.env.VITE_CARTO_API_KEY || '',
      }),
    );
  };
  return {
    name: 'map-tiles-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
