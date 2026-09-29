import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.m?js$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name)
      ? [full]
      : [];
  });
}

// vite-plugin-cesium rewrites `import('cesium')` to the global `Cesium`, so
// `const Cesium = await import('cesium')` becomes a self-reference that throws
// a TDZ ReferenceError in production builds while dev and tests still pass.
test('no dynamic cesium import is bound to a local named Cesium', () => {
  const pattern =
    /\b(?:const|let|var)\s+Cesium\s*=\s*(?:await\s+)?import\(\s*['"]cesium['"]\s*\)/;
  const hits = sourceFiles(path.join(root, 'src'))
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).replaceAll('\\', '/'));
  assert.deepEqual(hits, []);
});
