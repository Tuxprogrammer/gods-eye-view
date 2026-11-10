// Provider plugins that exist only in this fork. local.js spreads this list
// in one line, so upstream changes to local.js merge without conflicts.
import { crimeProxy } from './crime.js';

export function forkProviderPlugins() {
  return [crimeProxy()];
}
