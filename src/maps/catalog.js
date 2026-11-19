/**
 * The map stacks the maps panel offers, free of renderer code: an `ion` stack's
 * `style` is the Cesium ion world imagery asset it shows (2, aerial; 3,
 * aerial with labels), the values of Cesium's `IonWorldImageryStyle`.
 */
export const MAP_STACKS = [
  {
    id: 'photoreal',
    label: 'Google 3D', // i18n-ignore: imagery product name
    shortLabel: '3D',
    kind: 'photoreal',
    requiresIon: false,
  },
  {
    id: 'bing-aerial',
    label: 'Bing Aerial', // i18n-ignore: imagery product name
    shortLabel: 'Aerial',
    kind: 'ion',
    style: 2,
    requiresIon: true,
  },
  {
    id: 'bing-labels',
    label: 'Bing Labels', // i18n-ignore: imagery product name
    shortLabel: 'Labels',
    kind: 'ion',
    style: 3,
    requiresIon: true,
  },
  {
    id: 'esri-imagery',
    label: 'Esri Satellite', // i18n-ignore: imagery product name
    shortLabel: 'SAT',
    kind: 'esri-imagery',
    requiresIon: false,
  },
  {
    id: 'osm',
    label: 'OSM', // i18n-ignore: imagery product name
    shortLabel: 'OSM',
    kind: 'osm',
    requiresIon: false,
  },
  {
    id: 'carto-positron',
    label: 'CARTO Positron', // i18n-ignore: imagery product name
    shortLabel: 'LIGHT',
    kind: 'carto',
    style: 'light_all',
    requiresIon: false,
  },
  {
    id: 'carto-dark',
    label: 'CARTO Dark Matter', // i18n-ignore: imagery product name
    shortLabel: 'DARK',
    kind: 'carto',
    style: 'dark_all',
    requiresIon: false,
  },
  {
    id: 'openfreemap-dark',
    label: 'OpenFreeMap Dark', // i18n-ignore: imagery product name
    shortLabel: 'OFM',
    kind: 'openfreemap',
    requiresIon: false,
  },
];
