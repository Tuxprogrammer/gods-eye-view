import { MAP_STACKS } from './catalog.js';
import { photorealUnavailableReason } from './availability.js';
import { keySetupRequirement } from '../keySetupCore.mjs';
import {
  createOsmImagery,
  createEsriImagery,
  createIonImagery,
  createCartoImagery,
  ESRI_ATTRIBUTION_HTML,
  CARTO_ATTRIBUTION_HTML,
  OPENFREEMAP_ATTRIBUTION_HTML,
} from './imagery.js';
import { createOpenFreeMapImagery } from './openFreeMapRaster.js';
import { createWorldTerrain, createKeylessTerrain } from './terrain.js';

/** Select sources and setup guidance without putting provider branches in the controller. */
export function createDefaultMapSources({
  googleTileset = null,
  cesiumToken = '',
  googleApiKey = '',
} = {}) {
  const ionToken = String(cesiumToken || '').trim();
  const hasIon = Boolean(ionToken);
  const hasGoogle = Boolean(String(googleApiKey || '').trim());
  const terrain = {
    id: hasIon ? 'world' : 'keyless',
    create: hasIon
      ? (request) => createWorldTerrain(ionToken, request)
      : createKeylessTerrain,
  };
  return {
    defaultId: googleTileset ? 'photoreal' : 'esri-imagery',
    unknownId: 'photoreal',
    recoveryId: googleTileset ? 'photoreal' : null,
    state: { hasCesiumIonToken: hasIon },
    sources: MAP_STACKS.map((descriptor) => {
      const common = {
        descriptor,
        available: !descriptor.requiresIon || hasIon,
        unavailableReason: descriptor.requiresIon
          ? keySetupRequirement('cesium-ion')
          : null,
      };
      if (descriptor.kind === 'photoreal')
        return {
          ...common,
          available: Boolean(googleTileset),
          unavailableReason: photorealUnavailableReason(hasIon || hasGoogle),
          tileset: googleTileset,
        };
      const imageryByKind = {
        ion: () => createIonImagery(descriptor.style, ionToken),
        osm: createOsmImagery,
        carto: () => createCartoImagery(descriptor.style),
        openfreemap: () => createOpenFreeMapImagery(),
      };
      const imagery = imageryByKind[descriptor.kind] || createEsriImagery;
      const fallbackToOsm = (name, credit) => ({
        credit,
        constructionFallback: {
          id: 'osm',
          message: `${name} is unavailable; using OSM`,
        },
        tileFailureFallback: {
          id: 'osm',
          threshold: 2,
          message: `${name} tile requests failed; using OSM`,
        },
      });
      const extras =
        descriptor.id === 'esri-imagery'
          ? fallbackToOsm('Esri Satellite', ESRI_ATTRIBUTION_HTML)
          : descriptor.kind === 'carto'
            ? fallbackToOsm(descriptor.label, CARTO_ATTRIBUTION_HTML)
            : descriptor.kind === 'openfreemap'
              ? fallbackToOsm(descriptor.label, OPENFREEMAP_ATTRIBUTION_HTML)
              : {};
      return { ...common, imagery, terrain, ...extras };
    }),
  };
}
