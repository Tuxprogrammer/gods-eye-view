// Keeps this fork's own modules listed in scripts/package-boundaries.json.
//
//   node scripts/fork-boundaries.mjs           add any missing entries
//   node scripts/fork-boundaries.mjs --check   exit 1 if any are missing
//   node scripts/fork-boundaries.mjs --relocate  move fork entries to the top
//
// Upstream modules import the fork's through one-line hooks, so every package
// that owns an upstream importer must also own the fork module it imports. A
// package upstream adds later (say, one more that uses src/i18n/index.js)
// fails `npm run check:boundaries` until the fork module is listed there too;
// this script lists it. Each entry goes first in its package's module list:
// upstream appends to the end of those lists, so an entry there is a one-line
// addition no upstream change sits next to. `--relocate` moves fork entries
// written anywhere else (by hand, or by an older version of this script) there.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'scripts/package-boundaries.json');

/** Fork module → the upstream (or fork) modules that import it. */
export const FORK_IMPORTERS = Object.freeze({
  'src/ui/forkRowControls.js': [
    'src/ui/layerPanel.js',
    'src/ui/layerPanel/ForkRowControls.vue',
  ],
  'src/ui/layerPanel/ForkRowControls.vue': ['src/ui/layerPanel/LayerRows.vue'],
  'src/fork/manifest.js': [
    'src/app/sourceComposition.js',
    'src/ui/layerNames.js',
    'src/voice/layerManifest.js',
    'src/data/dataCredits.js',
  ],
  'src/fork/mapStacks.js': [
    'src/voice/actionSchemas.js',
    'src/voice/gevActions.js',
    'src/mapStackChips.js',
    'src/layers/submarineCables/policy.js',
  ],
  'src/app/layers/fork.js': ['src/app/constructCatalog.js'],
  'src/standalone/forkLayerSources.js': ['src/standalone/layerSources.js'],
  'src/i18n/fork/catalogs.json': ['src/i18n/index.js'],
  'src/ui/forkMobileShell.js': ['src/ui/applicationShell.js'],
  'src/ui/mobileMode.js': ['src/ui/forkMobileShell.js'],
  // The manifest's only import.
  'src/i18n/marker.js': ['src/fork/manifest.js'],
});

/** Every [package, anchor, module] entry the boundaries file lacks. */
export function missingForkEntries(groups) {
  const missing = [];
  for (const [name, group] of Object.entries(groups)) {
    const modules = group.modules || [];
    for (const [module, importers] of Object.entries(FORK_IMPORTERS)) {
      const anchor = importers.find((importer) => modules.includes(importer));
      if (anchor && !modules.includes(module))
        missing.push([name, anchor, module]);
    }
  }
  return missing;
}

/** Fork-owned modules and trees: the entries `--relocate` moves to the top. */
const FORK_OWNED_PATHS = Object.freeze([
  ...Object.keys(FORK_IMPORTERS).filter((m) => m !== 'src/i18n/marker.js'),
  'src/layers/aprs/',
  'src/layers/meshtastic/',
  'src/layers/propagation/',
  'src/app/layers/aprs.js',
  'src/app/layers/meshtastic.js',
  'src/app/layers/propagation.js',
  'src/maps/openFreeMapRaster.js',
  'server/providers/openai/base-url.js',
]);
const isForkOwned = (module) =>
  FORK_OWNED_PATHS.some((owned) =>
    owned.endsWith('/') ? module.startsWith(owned) : module === owned,
  );

/** The line range [modulesLine, closingLine] of a package's module list. */
function moduleList(lines, name) {
  let current = null;
  for (let index = 0; index < lines.length; index++) {
    const block = /^ {2}"([^"]+)": \{$/.exec(lines[index]);
    if (block) current = block[1];
    if (current !== name || !/^\s*"modules": \[/.test(lines[index])) continue;
    if (lines[index].trimEnd().endsWith('],')) return [index, index];
    let end = index + 1;
    while (!/^\s*\],?$/.test(lines[end])) end++;
    return [index, end];
  }
  throw new Error(`${name}: no module list in ${FILE}`);
}

/**
 * Rewrite one package's module list as Prettier prints it: on one line when
 * that fits in 80 columns, otherwise one entry per line.
 */
function writeList(lines, name, modules) {
  const [start, end] = moduleList(lines, name);
  const indent = lines[start].slice(0, lines[start].search(/\S/));
  const oneLine = `${indent}"modules": [${modules.map((m) => JSON.stringify(m)).join(', ')}],`;
  const multiline = [
    `${indent}"modules": [`,
    ...modules.map(
      (m, i) =>
        `${indent}  ${JSON.stringify(m)}${i < modules.length - 1 ? ',' : ''}`,
    ),
    `${indent}],`,
  ];
  // Prettier keeps a list that was already expanded expanded only if it must.
  lines.splice(
    start,
    end - start + 1,
    ...(oneLine.length <= 80 ? [oneLine] : multiline),
  );
}

function main(args) {
  const lines = readFileSync(FILE, 'utf8').split('\n');
  const groups = () => JSON.parse(lines.join('\n'));
  const changed = [];
  if (args.includes('--relocate')) {
    for (const [name, group] of Object.entries(groups())) {
      const modules = group.modules || [];
      const fork = modules.filter(isForkOwned);
      const rest = modules.filter((m) => !isForkOwned(m));
      const next = [...fork, ...rest];
      if (next.some((m, i) => m !== modules[i])) {
        writeList(lines, name, next);
        changed.push(`moved ${name}: ${fork.join(', ')}`);
      }
    }
  }
  // Repeat: an added module's own imports may need owning in turn.
  for (;;) {
    const missing = missingForkEntries(groups());
    if (!missing.length) break;
    for (const [name, , module] of missing) {
      const modules = groups()[name].modules;
      const owned = modules.filter(isForkOwned).length;
      // After the package's other fork entries, ahead of all upstream ones.
      const at = isForkOwned(module) ? owned : modules.length;
      writeList(lines, name, [
        ...modules.slice(0, at),
        module,
        ...modules.slice(at),
      ]);
      changed.push(`added ${name}: ${module}`);
    }
  }
  if (!changed.length) {
    console.log('Fork modules are listed in every package that imports them.');
    return 0;
  }
  if (args.includes('--check')) {
    console.log(
      'Fork boundary entries need fixing (node scripts/fork-boundaries.mjs):',
    );
    for (const entry of changed) console.log(`  ${entry}`);
    return 1;
  }
  writeFileSync(FILE, lines.join('\n'));
  for (const entry of changed) console.log(entry);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
