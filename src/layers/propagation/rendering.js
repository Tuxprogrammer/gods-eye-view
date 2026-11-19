import {
  clampOpacity,
  colorAtPosition,
  colorbarStops,
  contourLabelPoints,
  dominantAlpha,
  flattenHeatmapPixels,
  gradientCss,
  formatStationValue,
  heatmapTiles,
  stationRows,
  stationValue,
  valuePosition,
} from './model.js';
import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf, findFrame } from '../../render/rendererOf.js';
import { createHorizonCuller } from './horizon.js';

/** Decode a base64 PNG to RGBA without colour management or premultiplication. */
async function decodePng(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: 'image/png' }),
    { premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
  );
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(
      0,
      0,
      bitmap.width,
      bitmap.height,
    );
    return { data, width, height };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Decode a payload into what the surface draws and the legend needs:
 * a north-up canvas with the upstream's baked translucency removed, and the
 * colour bar as a CSS gradient in the same true colours.
 */
export async function prepareHeatmap(payload) {
  const [heat, bar] = await Promise.all([
    decodePng(payload.heatmap),
    decodePng(payload.colorbar),
  ]);
  const alpha = dominantAlpha(heat.data);
  const pixels = flattenHeatmapPixels(heat.data, heat.width, heat.height, {
    southUp: payload.southUp,
  });
  const canvas = document.createElement('canvas');
  canvas.width = heat.width;
  canvas.height = heat.height;
  canvas
    .getContext('2d')
    .putImageData(new ImageData(pixels, heat.width, heat.height), 0, 0);
  const stops = colorbarStops(bar.data, bar.width, bar.height, alpha);
  return { canvas, gradient: gradientCss(stops), stops };
}

const render = (viewer) => findFrame(viewer)?.requestRender('propagation');

/** A canvas, or null where there is no DOM (tests). */
function newCanvas(width, height) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

let heatmapSurfaces = 0;

/**
 * The globe as textured rectangles draped onto the surface beneath them:
 * Google 3D tiles in the photoreal stack, terrain otherwise (`clampTo`). An
 * imagery layer cannot do this, because the photoreal stack hides the globe
 * entirely.
 *
 * An image fill has no colour of its own to fade it, so the opacity is baked
 * into each tile's texture: a change redraws the tiles from the prepared
 * canvas and hands them over under a new key.
 * @param {{viewer: object, classificationType?: 'tiles'|'terrain'|'both',
 *   makeCanvas?: (width: number, height: number) => object|null}} options
 */
export function createHeatmapSurface({
  viewer,
  classificationType,
  makeCanvas = newCanvas,
}) {
  const id = `propagation:heatmap:${(heatmapSurfaces += 1)}`;
  const shapes = drawOf(viewer).shapes({ id, show: false, pickable: false });
  /** @type {Array<{tile: object, texture: object}>} */
  let tiles = [];
  let source = null;
  let alpha = 1;
  let type = classificationType;
  // Every redraw of the textures is new content, so a new key.
  let version = 0;

  function paint() {
    version += 1;
    for (const { tile, texture } of tiles) {
      const context = texture.getContext('2d');
      context.clearRect(0, 0, texture.width, texture.height);
      context.globalAlpha = alpha;
      context.drawImage(
        source,
        tile.x,
        tile.y,
        tile.width,
        tile.height,
        0,
        0,
        texture.width,
        texture.height,
      );
    }
  }

  function write() {
    shapes.set(
      tiles.map(({ tile, texture }, index) => ({
        id: `propagation-heatmap:${index}`,
        geometry: {
          kind: 'rectangle',
          rect: {
            west: tile.west,
            south: tile.south,
            east: tile.east,
            north: tile.north,
          },
        },
        fill: {
          image: { canvas: texture, key: `${id}:${version}:${index}` },
        },
        height: 'clampGround',
        ...(type ? { clampTo: type } : {}),
        pickable: false,
      })),
    );
  }

  return {
    /** Replace the drawn map. Cheap: crops one prepared canvas into tiles. */
    show(prepared, opacity) {
      const { canvas } = prepared;
      source = canvas;
      alpha = clampOpacity(opacity);
      tiles = [];
      for (const tile of heatmapTiles(canvas.width, canvas.height)) {
        const texture = makeCanvas(tile.width, tile.height);
        if (texture) tiles.push({ tile, texture });
      }
      paint();
      write();
      shapes.show = tiles.length > 0;
      render(viewer);
    },
    setOpacity(opacity) {
      const next = clampOpacity(opacity);
      if (next === alpha && version > 0) return;
      alpha = next;
      if (!tiles.length) return;
      paint();
      write();
      render(viewer);
    },
    setClassification(next) {
      if (next === undefined || next === type) return;
      type = next;
      if (tiles.length) write();
      render(viewer);
    },
    setVisible(visible) {
      shapes.show = Boolean(visible) && tiles.length > 0;
      render(viewer);
    },
    clear() {
      shapes.clear();
      tiles = [];
      source = null;
      shapes.show = false;
      render(viewer);
    },
    get tileCount() {
      return tiles.length;
    },
    destroy() {
      shapes.dispose();
      tiles = [];
      source = null;
    },
  };
}

/** Contour lines are drawn thin and light so they read on any heat colour. */
const CONTOUR_COLOR = 'rgba(255, 255, 255, 0.85)';
const CONTOUR_WIDTH = 2;
/** Labels and bubble captions drop out beyond these camera distances (metres). */
const CONTOUR_LABEL_RANGE_M = 30_000_000;
const STATION_LABEL_RANGE_M = 7_000_000;
/** The world-overlay sources the printed levels and readings publish to. */
export const PROPAGATION_CONTOUR_LABEL_SOURCE_ID = 'propagation-contour-labels';
export const PROPAGATION_STATION_LABEL_SOURCE_ID = 'propagation-station-labels';
/** Every printed level along every ring (`CONTOUR_LABEL_MAX`) may be kept. */
const CONTOUR_LABEL_OPTIONS = Object.freeze({ cohortLimit: 420 });
const STATION_LABEL_OPTIONS = Object.freeze({ cohortLimit: 256 });
/** A reading wins the label budget over a printed level. */
const STATION_LABEL_PRIORITY = 1_000_000;

/**
 * A printed value on the ground, as a world-overlay ambient label: the host
 * places, collides and paints it, and hides it past the horizon; terrain does
 * not hide it, so it stays legible past nearby geometry.
 */
function groundLabel({
  id,
  lon,
  lat,
  text,
  accent,
  priority,
  maxDistance,
  gapPx,
}) {
  return {
    id,
    position: fromDegrees(lon, lat),
    variant: 'label',
    title: text,
    accent,
    priority,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    maxDistance,
    gapPx,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Publish `entries` to an overlay source, or clear it; no host, no labels. */
function publish(overlayHost, sourceId, entries, options) {
  if (!overlayHost) return;
  if (entries.length) {
    overlayHost.setEntries(sourceId, entries, options);
    overlayHost.setVisible?.(sourceId, true);
  } else {
    overlayHost.clearSource?.(sourceId);
    overlayHost.setVisible?.(sourceId, false);
  }
}

/** ECEF positions of a flat `[lon, lat, lon, lat, ...]` list. */
function ecefPath(flat) {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    out.push(fromDegrees(flat[i], flat[i + 1]));
  return out;
}

let contourSurfaces = 0;

/**
 * Isolines of the active map, draped onto the surface (3D tiles in the
 * photoreal stack, terrain otherwise), with the level printed repeatedly along
 * each ring through the world overlay.
 * @param {{viewer: object, classificationType?: 'tiles'|'terrain'|'both',
 *   overlayHost?: object|null}} options
 */
export function createContourSurface({
  viewer,
  classificationType,
  overlayHost = null,
}) {
  const lines = drawOf(viewer).lines({
    id: `propagation:contours:${(contourSurfaces += 1)}`,
    show: false,
    pickable: false,
  });
  let type = classificationType;
  /** @type {Array<{id: string, positions: object[]}>} */
  let paths = [];
  let labelCount = 0;

  function writeLines() {
    lines.set(
      paths.map(({ id, positions }) => ({
        id,
        positions,
        widthPx: CONTOUR_WIDTH,
        mode: 'draped',
        ...(type ? { clampTo: type } : {}),
        style: { kind: 'solid', color: CONTOUR_COLOR },
        pickable: false,
      })),
    );
  }

  function clearLabels() {
    labelCount = 0;
    publish(overlayHost, PROPAGATION_CONTOUR_LABEL_SOURCE_ID, []);
  }

  return {
    show(contours) {
      paths = contours.lines.map((line, index) => ({
        id: `propagation-contour:${index}`,
        positions: ecefPath(line.positions),
      }));
      writeLines();
      const entries = contourLabelPoints(contours.lines).map((point, index) =>
        groundLabel({
          id: `contour:${index}`,
          lon: point.lon,
          lat: point.lat,
          text: point.text,
          accent: '#ffffff',
          priority: 0,
          maxDistance: CONTOUR_LABEL_RANGE_M,
          gapPx: 2,
        }),
      );
      labelCount = entries.length;
      publish(
        overlayHost,
        PROPAGATION_CONTOUR_LABEL_SOURCE_ID,
        entries,
        CONTOUR_LABEL_OPTIONS,
      );
      lines.show = true;
      render(viewer);
    },
    setClassification(next) {
      if (next === undefined || next === type) return;
      type = next;
      if (paths.length) writeLines();
      render(viewer);
    },
    clear() {
      lines.clear();
      paths = [];
      clearLabels();
      lines.show = false;
      render(viewer);
    },
    get lineCount() {
      return paths.length;
    },
    get labelCount() {
      return labelCount;
    },
    destroy() {
      clearLabels();
      lines.dispose();
    },
  };
}

export const STATION_ID_PREFIX = 'propagation-station:';

let stationSurfaces = 0;

/**
 * Reporting ionosondes as bubbles coloured on the map's own scale, so a bubble
 * that matches the heat beneath it shows the model agrees with a measurement,
 * each with its reading printed above it through the world overlay. Bubbles
 * over the horizon are hidden; the rest can be hovered and clicked through
 * {@link createStationInteraction}.
 * @param {{viewer: object, overlayHost?: object|null}} options
 */
export function createStationSurface({ viewer, overlayHost = null }) {
  const points = drawOf(viewer).points({
    id: `propagation:stations:${(stationSurfaces += 1)}`,
    show: false,
  });
  const culler = createHorizonCuller({
    viewer,
    onChange: (flipped) => points.upsert(flipped),
  });
  /** @type {Map<string, {station: object, point: object, position: object}>} */
  let records = new Map();
  let scale = null;
  return {
    /**
     * @param {Array<object>} stations Already filtered to the active map.
     * @param {{field: string, unit: string, stops: number[][],
     *   range: {min: number, max: number}, now?: number}} next
     */
    show(stations, next) {
      const { field, stops, range } = next;
      scale = next;
      records = new Map();
      const bubbles = [];
      const captions = [];
      const tracked = [];
      for (const station of stations) {
        const value = stationValue(station, field);
        if (value === null) continue;
        const [r, g, b] = colorAtPosition(stops, valuePosition(value, range));
        const color = `rgb(${r}, ${g}, ${b})`;
        // Bubbles skip the depth test so terrain does not swallow them; the
        // horizon culler hides the far side of the planet instead.
        const point = {
          id: `${STATION_ID_PREFIX}${station.code}`,
          pos: { lon: station.lon, lat: station.lat },
          height: 'clampGround',
          pixelSize: 13,
          color,
          outlineColor: '#ffffff',
          outlineWidth: 2.5,
          disableDepthTest: Number.POSITIVE_INFINITY,
          meta: { name: `${station.name} (${station.code})` },
          show: true,
        };
        bubbles.push(point);
        captions.push(
          groundLabel({
            id: `station:${station.code}`,
            lon: station.lon,
            lat: station.lat,
            text: formatStationValue(value),
            accent: color,
            priority: STATION_LABEL_PRIORITY,
            maxDistance: STATION_LABEL_RANGE_M,
            gapPx: 9,
          }),
        );
        records.set(station.code, {
          station,
          point,
          position: fromDegrees(station.lon, station.lat),
        });
        tracked.push({ lon: station.lon, lat: station.lat, targets: [point] });
      }
      culler.set(tracked);
      points.set(bubbles);
      publish(
        overlayHost,
        PROPAGATION_STATION_LABEL_SOURCE_ID,
        captions,
        STATION_LABEL_OPTIONS,
      );
      points.show = true;
      render(viewer);
    },
    /** Details for the hover/click card, or null if the station is gone. */
    detailsFor(code, now = Date.now()) {
      const record = records.get(code);
      if (!record || !scale) return null;
      const { station, point, position } = record;
      return {
        code,
        name: station.name,
        rows: stationRows(station, scale.field, scale.unit, now),
        position,
        visible: point.show !== false,
      };
    },
    clear() {
      culler.clear();
      points.clear();
      records = new Map();
      publish(overlayHost, PROPAGATION_STATION_LABEL_SOURCE_ID, []);
      points.show = false;
      render(viewer);
    },
    get count() {
      return records.size;
    },
    destroy() {
      culler.destroy();
      publish(overlayHost, PROPAGATION_STATION_LABEL_SOURCE_ID, []);
      points.dispose();
    },
  };
}
