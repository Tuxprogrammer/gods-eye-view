// Keeps this fork's own modules listed in scripts/package-boundaries.json.
//
//   node scripts/fork-boundaries.mjs           add any missing entries
//   node scripts/fork-boundaries.mjs --check   exit 1 if any are missing
//
// Upstream modules import the fork's through one-line hooks, so every package
// that owns an upstream importer must also own the fork module it imports. A
// package upstream adds later (say, one more that uses src/i18n/index.js)
// fails `npm run check:boundaries` until the fork module is listed there too;
// this script lists it. Each entry goes on the line after its importer, so the
// edit is a one-line addition beside an upstream line that rarely changes.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'scripts/package-boundaries.json');

/** Fork module → the upstream (or fork) modules that import it. */
export const FORK_IMPORTERS = Object.freeze({
  'src/ui/forkRowControls.js': ['src/ui/layerPanel.js'],
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

/** Insert one module after its anchor inside the named package's block. */
function insert(text, name, anchor, module) {
  const lines = text.split('\n');
  let current = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const block = /^ {2}"([^"]+)": \{$/.exec(line);
    if (block) current = block[1];
    if (current !== name || line.trim().replace(/,$/, '') !== `"${anchor}"`)
      continue;
    const indent = line.slice(0, line.length - line.trimStart().length);
    if (line.trimEnd().endsWith(',')) {
      lines.splice(index + 1, 0, `${indent}"${module}",`);
    } else {
      lines[index] = `${line},`;
      lines.splice(index + 1, 0, `${indent}"${module}"`);
    }
    return lines.join('\n');
  }
  throw new Error(`${name}: ${anchor} not found in ${FILE}`);
}

function main(args) {
  let text = readFileSync(FILE, 'utf8');
  const added = [];
  // Repeat: an added module's own imports may need owning in turn.
  for (;;) {
    const missing = missingForkEntries(JSON.parse(text));
    if (!missing.length) break;
    for (const [name, anchor, module] of missing) {
      text = insert(text, name, anchor, module);
      added.push(`${name}: ${module}`);
    }
  }
  if (!added.length) {
    console.log('Fork modules are listed in every package that imports them.');
    return 0;
  }
  if (args.includes('--check')) {
    console.log(
      'Missing fork boundary entries (node scripts/fork-boundaries.mjs):',
    );
    for (const entry of added) console.log(`  ${entry}`);
    return 1;
  }
  writeFileSync(FILE, text);
  for (const entry of added) console.log(`added ${entry}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
