// This fork's OpenFreeMap raster source renders vector tiles with maplibre in
// a worker; the build must emit that worker under the names it imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maplibreWorkerPlugin } from '../../server/standalone/maplibre-worker.js';

test('the build emits the maplibre worker and its shared chunk under the names it imports', () => {
  const plugin = maplibreWorkerPlugin();
  assert.equal(plugin.apply, 'build');
  const emitted = [];
  plugin.generateBundle.call({ emitFile: (file) => emitted.push(file) });
  assert.deepEqual(emitted.map((file) => file.fileName).sort(), [
    'assets/maplibre-gl-shared.mjs',
    'assets/maplibre-gl-worker.mjs',
  ]);
  for (const file of emitted) {
    assert.equal(file.type, 'asset');
    assert.ok(file.source.length > 1000, file.fileName);
  }
  // The worker imports its sibling by this exact relative name.
  const worker = emitted.find((file) => file.fileName.endsWith('worker.mjs'));
  assert.ok(worker.source.toString().includes('./maplibre-gl-shared.mjs'));
});
