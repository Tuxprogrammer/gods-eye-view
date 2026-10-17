// The fork's translation layer (src/i18n/fork/catalogs.json): the app and `npm run i18n`
// see upstream's catalogs and the fork's as one, while each file keeps only
// its own entries so upstream merges never conflict on a catalog.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getCatalog } from './index.js';
import {
  catalogPath,
  readCatalog,
  shippedLocales,
} from '../../scripts/i18n.mjs';
import {
  RETIRED_UPSTREAM_MESSAGES,
  forkCatalogErrors,
  mergeForkCatalog,
  readForkCatalog,
  writeCatalogLayers,
} from '../../scripts/i18n-fork.mjs';

const upstreamCatalog = (locale) =>
  JSON.parse(readFileSync(catalogPath(locale), 'utf8'));

test('the fork layer is not a shipped locale of its own', () => {
  assert.deepEqual(shippedLocales().sort(), ['es', 'ru']);
});

for (const locale of ['es', 'ru']) {
  test(`${locale}: the app sees both layers, upstream's file holds none of the fork's`, () => {
    const fork = readForkCatalog(locale);
    assert.ok(Object.keys(fork).length > 0, 'the fork has its own entries');
    const runtime = getCatalog(locale);
    for (const [text, value] of Object.entries(fork))
      assert.deepEqual(runtime[text], value, text);
    assert.deepEqual(forkCatalogErrors(locale, upstreamCatalog(locale)), []);
    assert.equal(
      readCatalog(locale)['Flying to Huntsville, AL...'],
      fork['Flying to Huntsville, AL...'],
    );
  });
}

test('upstream wins a shared key, and retired upstream messages are not checked', () => {
  const [retired] = RETIRED_UPSTREAM_MESSAGES;
  const [forkKey] = Object.keys(readForkCatalog('ru'));
  const merged = mergeForkCatalog('ru', {
    [forkKey]: 'upstream',
    [retired]: 'old',
  });
  assert.equal(merged[forkKey], 'upstream');
  assert.equal(Object.hasOwn(merged, retired), false);
  assert.match(
    forkCatalogErrors('ru', { [forkKey]: 'upstream' })[0],
    /in upstream's catalog now/,
  );
});

test('a prune writes each entry back to its own layer and keeps retired ones upstream', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-fork-i18n-'));
  try {
    const upstreamPath = path.join(dir, 'ru.json');
    const forkPath = path.join(dir, 'catalogs.json');
    writeFileSync(forkPath, JSON.stringify({ es: { Other: 'O' } }));
    const [retired] = RETIRED_UPSTREAM_MESSAGES;
    writeFileSync(
      upstreamPath,
      JSON.stringify({ Kept: 'К', Unused: 'Н', [retired]: 'Старое' }),
    );
    writeCatalogLayers(
      'ru',
      { Kept: 'К', 'Fork only': 'Ф' },
      upstreamPath,
      forkPath,
    );
    assert.deepEqual(JSON.parse(readFileSync(upstreamPath, 'utf8')), {
      Kept: 'К',
      [retired]: 'Старое',
    });
    assert.deepEqual(JSON.parse(readFileSync(forkPath, 'utf8')), {
      es: { Other: 'O' },
      ru: { 'Fork only': 'Ф' },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
