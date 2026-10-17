// The fork's layer of `npm run i18n`. The fork's translations live in
// src/i18n/fork/catalogs.json ({locale: {english: translation}}) and
// src/i18n/fork/same-as-english.json, beside
// upstream's untouched locales/<code>.json and same-as-english.json, so an
// upstream merge never conflicts on a catalog. scripts/i18n.mjs reads both
// layers through these helpers and writes each entry back to its own file.
//
// A string the fork adds goes in src/i18n/fork/catalogs.json, never in
// locales/<code>.json: `npm run i18n -- --missing <code>` lists it either way.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORK_DIR = path.join(ROOT, 'src/i18n/fork');

/**
 * Upstream messages the fork's code no longer asks for. They stay in
 * upstream's catalogs (pruning them would be a conflict on every merge) and
 * are neither checked nor reported as unused.
 */
export const RETIRED_UPSTREAM_MESSAGES = Object.freeze(
  new Set([
    // src/app/controls.js flies to Huntsville instead of Austin at startup.
    'Flying to Austin, TX...',
  ]),
);

const FORK_CATALOGS = path.join(FORK_DIR, 'catalogs.json');

const readJson = (file, fallback) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;

/** The fork's own entries for a locale (empty when it has none). */
export function readForkCatalog(locale) {
  return readJson(FORK_CATALOGS, {})[locale] || {};
}

/** Upstream's catalog with the fork's entries underneath, as the app sees it. */
export function mergeForkCatalog(locale, upstream) {
  const merged = { ...readForkCatalog(locale), ...upstream };
  for (const text of RETIRED_UPSTREAM_MESSAGES) delete merged[text];
  return merged;
}

/** Fork messages a locale keeps exactly as in English, on purpose. */
export function readForkSameAsEnglish(locale) {
  return (
    readJson(path.join(FORK_DIR, 'same-as-english.json'), {})[locale] || []
  );
}

/**
 * Fork entries upstream now translates too. Upstream's wins at runtime, so the
 * fork's copy is dead weight to delete by hand.
 */
export function forkCatalogErrors(locale, upstream) {
  return Object.keys(readForkCatalog(locale))
    .filter((text) => Object.hasOwn(upstream, text))
    .map(
      (text) =>
        `"${text}" is in upstream's catalog now: drop it from src/i18n/fork/catalogs.json (${locale})`,
    );
}

/**
 * Write a pruned merged catalog back as its two layers: keys upstream's file
 * already has stay there (with its retired entries), the rest go to the fork's.
 */
export function writeCatalogLayers(
  locale,
  catalog,
  upstreamPath,
  forkPath = FORK_CATALOGS,
) {
  const upstream = JSON.parse(readFileSync(upstreamPath, 'utf8'));
  const upstreamLayer = Object.fromEntries(
    Object.entries(upstream).filter(
      ([text]) =>
        Object.hasOwn(catalog, text) || RETIRED_UPSTREAM_MESSAGES.has(text),
    ),
  );
  const forkLayer = Object.fromEntries(
    Object.entries(catalog).filter(([text]) => !Object.hasOwn(upstream, text)),
  );
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(upstreamPath, json(upstreamLayer));
  writeFileSync(
    forkPath,
    json({ ...readJson(forkPath, {}), [locale]: forkLayer }),
  );
}
