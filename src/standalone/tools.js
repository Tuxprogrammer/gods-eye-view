import { createAssetDirectorySource } from '../director/packs/source.js';
import { createApplicationTools } from '../app/tools.js';
import { installMobileUi } from '../ui/mobile/index.js';
import { startStandaloneChrome } from './startupChrome.js';
export function createStandaloneTools(options) {
  const tools = createApplicationTools({
    startChrome: startStandaloneChrome,
    sceneDataPacks: {
      sources: {
        assets: createAssetDirectorySource({
          baseUrl: new URL('/scene-assets/', window.location.href).href,
        }),
      },
    },
    ...options,
  });
  // Last phase: every desktop node (dock, voice pill, rails) exists by now,
  // so mobile pages can move them. No-op on desktop.
  options.defer(installMobileUi());
  return tools;
}
