import path from 'node:path';
import { createAprsClient, DEFAULT_HOST } from './aprs/client.js';
import { createAprsMiddleware } from './aprs/middleware.js';
import { createAprsStore, loadSqlite } from './aprs/store.js';

export { aprsPasscode } from './aprs/passcode.js';
export { parsePacket } from './aprs/parser.js';

/**
 * Always-on APRS-IS receiver. Unlike the demand-driven layers, this connects
 * when the server starts and streams into a 24-hour SQLite store, so there is
 * history the moment a browser asks for it. Routes: /api/aprs/*.
 *
 * Configuration (environment / .env):
 *   APRS_CALLSIGN   your callsign; the passcode is computed from it (required)
 *   APRS_IS_HOST    default noam.aprs2.net (North America)
 *   APRS_IS_PORT    default 10152 (full feed), or 14580 when a filter is set
 *   APRS_IS_FILTER  optional server-side filter, e.g. "r/34.7/-86.6/500"
 *   APRS_DB_PATH    default .gev-cache/aprs/aprs.sqlite
 *
 * @returns {import('vite').Plugin}
 */
export function aprsProxy() {
  let store = null;
  let client = null;
  let storageError = null;
  let starting = null;

  const feed = () =>
    client?.snapshot() ?? {
      status: storageError ? 'storage-unavailable' : 'starting',
      error: storageError,
    };

  function start() {
    if (starting) return starting;
    starting = (async () => {
      try {
        const DatabaseSync = await loadSqlite();
        store = createAprsStore({
          DatabaseSync,
          file:
            process.env.APRS_DB_PATH ||
            path.join(process.cwd(), '.gev-cache', 'aprs', 'aprs.sqlite'),
          warn: (message) => console.warn(message),
        });
      } catch (error) {
        storageError = `APRS storage unavailable: ${error?.message || error}`;
        console.warn(`[APRS] ${storageError}`);
        return;
      }
      client = createAprsClient({
        callsign: process.env.APRS_CALLSIGN,
        host: process.env.APRS_IS_HOST || DEFAULT_HOST,
        port: process.env.APRS_IS_PORT
          ? Number(process.env.APRS_IS_PORT)
          : undefined,
        filter: process.env.APRS_IS_FILTER || '',
        onPacket: (packet, at) => store?.ingest(packet, at),
        warn: (message) => console.warn(message),
      });
      client.start();
      const snapshot = client.snapshot();
      if (snapshot.status === 'missing-config')
        console.warn(`[APRS] ${snapshot.error}`);
      else
        console.log(
          `[APRS] receiving as ${snapshot.callsign} from ${snapshot.host}`,
        );
    })();
    return starting;
  }

  function dispose() {
    client?.stop();
    client = null;
    store?.close();
    store = null;
    starting = null;
  }

  const install = (server) => {
    void start();
    server.middlewares.use(
      '/api/aprs',
      createAprsMiddleware({
        store: () => store,
        feed,
        storageError: () => storageError,
      }),
    );
    // Vite restarts in-process on a config change; without this each reload
    // would stack another socket and another database handle.
    server.httpServer?.on('close', dispose);
  };
  return {
    name: 'aprs-proxy',
    configureServer: install,
    configurePreviewServer: install,
    closeBundle: dispose,
  };
}
