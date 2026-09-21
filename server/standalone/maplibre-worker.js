import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * maplibre-gl runs its tile work in a module worker, `maplibre-gl-worker.mjs`,
 * which imports its sibling `./maplibre-gl-shared.mjs`. Vite bundles neither,
 * so a production build has no /assets/maplibre-gl-worker.mjs and the browser
 * gets the app's index.html for both: the worker dies and a map that needs it
 * (OpenFreeMap Dark) never loads. Emit the two files under their own names in
 * assets/, where maplibre looks for them, and the default worker URL just works.
 */
const WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

export function maplibreWorkerPlugin() {
  return {
    name: 'maplibre-worker-assets',
    apply: 'build',
    generateBundle() {
      const require = createRequire(import.meta.url);
      // The package's exports only offer an `import` condition, so find it by its
      // (exported) package.json rather than by resolving the entry point.
      const dist = join(
        dirname(require.resolve('maplibre-gl/package.json')),
        'dist',
      );
      for (const file of WORKER_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/${file}`,
          source: readFileSync(join(dist, file)),
        });
      }
    },
  };
}
