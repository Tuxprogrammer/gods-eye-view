// scripts/fork-boundaries.mjs keeps the fork's hooked-in modules listed in
// every package that owns their upstream importer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FORK_IMPORTERS,
  missingForkEntries,
} from '../../scripts/fork-boundaries.mjs';

test('every package that owns an upstream hook owns the fork module it imports', () => {
  const groups = JSON.parse(
    readFileSync(
      new URL('../../scripts/package-boundaries.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(missingForkEntries(groups), []);
});

test('a new upstream package that owns a hook is reported with its anchor', () => {
  const groups = {
    'new-upstream-panel': {
      modules: ['src/ui/newPanel.js', 'src/i18n/index.js'],
    },
    unrelated: { modules: ['src/ui/other.js'] },
  };
  assert.deepEqual(missingForkEntries(groups), [
    ['new-upstream-panel', 'src/i18n/index.js', 'src/i18n/fork/catalogs.json'],
  ]);
});

test('every fork module and importer exists', () => {
  for (const [module, importers] of Object.entries(FORK_IMPORTERS))
    for (const file of [module, ...importers])
      assert.doesNotThrow(
        () => readFileSync(new URL(`../../${file}`, import.meta.url)),
        file,
      );
});
