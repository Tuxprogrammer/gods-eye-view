import path from 'node:path';
import { createMeshtasticMiddleware } from './meshtastic/middleware.js';
import { createServerManager } from './meshtastic/servers.js';
import { createMeshtasticStore, loadSqlite } from './meshtastic/store.js';

export { decodeMessage } from './meshtastic/decode.js';

/**
 * Meshtastic over MQTT. The server keeps a receive-only MQTT connection open
 * to every broker the person has switched on (the Meshtastic project's public
 * broker, ALmesh, and any custom broker they add), whether or not a browser is
 * looking, and streams what it can read into a 24-hour SQLite store.
 * Routes: /api/meshtastic/*.
 *
 * Nothing connects until a broker is switched on in the layer panel, so a
 * fresh install makes no outbound connection.
 *
 * Configuration (environment / .env), all optional:
 *   MESHTASTIC_DB_PATH   default .gev-cache/meshtastic/meshtastic.sqlite
 *   MESHTASTIC_DISABLED  set to 1 to turn the layer's server side off entirely
 *
 * @returns {import('vite').Plugin}
 */
export function meshtasticProxy() {
  let store = null;
  let manager = null;
  let storageError = null;
  let starting = null;
  const disabled = () => process.env.MESHTASTIC_DISABLED === '1';

  function start() {
    if (starting) return starting;
    starting = (async () => {
      if (disabled()) {
        storageError = 'Meshtastic is disabled (MESHTASTIC_DISABLED=1)';
        return;
      }
      try {
        const DatabaseSync = await loadSqlite();
        store = createMeshtasticStore({
          DatabaseSync,
          file:
            process.env.MESHTASTIC_DB_PATH ||
            path.join(
              process.cwd(),
              '.gev-cache',
              'meshtastic',
              'meshtastic.sqlite',
            ),
          warn: (message) => console.warn(message),
        });
      } catch (error) {
        storageError = `Meshtastic storage unavailable: ${error?.message || error}`;
        console.warn(`[Meshtastic] ${storageError}`);
        return;
      }
      manager = createServerManager({
        store,
        warn: (message) => console.warn(message),
      });
      manager.start();
      const on = manager.enabledIds();
      if (on.length)
        console.log(`[Meshtastic] listening to ${on.length} MQTT server(s)`);
    })();
    return starting;
  }

  function dispose() {
    manager?.dispose();
    manager = null;
    store?.close();
    store = null;
    starting = null;
  }

  const install = (server) => {
    void start();
    server.middlewares.use(
      '/api/meshtastic',
      createMeshtasticMiddleware({
        store: () => store,
        servers: () => manager,
        storageError: () => storageError,
      }),
    );
    // Vite restarts in-process on a config change; without this each reload
    // would stack another set of sockets and another database handle.
    server.httpServer?.on('close', dispose);
  };
  return {
    name: 'meshtastic-proxy',
    configureServer: install,
    configurePreviewServer: install,
    closeBundle: dispose,
  };
}
