import * as Cesium from 'cesium';
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

/**
 * The globe as textured rectangles classified onto the surface beneath them:
 * Google 3D tiles in the photoreal stack, terrain otherwise. An imagery layer
 * cannot do this, because the photoreal stack hides the globe entirely.
 */
export function createHeatmapSurface({ viewer, classificationType }) {
  const dataSource = new Cesium.CustomDataSource('propagation');
  dataSource.show = false;
  viewer.dataSources.add(dataSource);
  let materials = [];
  let type = classificationType;

  const render = () => viewer.scene?.requestRender?.();

  return {
    /** Replace the drawn map. Cheap: crops one prepared canvas into tiles. */
    show(prepared, opacity) {
      dataSource.entities.removeAll();
      materials = [];
      const { canvas } = prepared;
      const color = Cesium.Color.WHITE.withAlpha(clampOpacity(opacity));
      for (const tile of heatmapTiles(canvas.width, canvas.height)) {
        const texture = document.createElement('canvas');
        texture.width = Math.max(1, tile.width);
        texture.height = Math.max(1, tile.height);
        texture
          .getContext('2d')
          .drawImage(
            canvas,
            tile.x,
            tile.y,
            tile.width,
            tile.height,
            0,
            0,
            texture.width,
            texture.height,
          );
        const material = new Cesium.ImageMaterialProperty({
          image: texture,
          transparent: true,
          color,
        });
        materials.push(material);
        dataSource.entities.add({
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
              tile.west,
              tile.south,
              tile.east,
              tile.north,
            ),
            material,
            classificationType: type,
          },
        });
      }
      dataSource.show = true;
      render();
    },
    setOpacity(opacity) {
      const color = Cesium.Color.WHITE.withAlpha(clampOpacity(opacity));
      for (const material of materials) material.color = color;
      render();
    },
    setClassification(next) {
      if (next === undefined || next === type) return;
      type = next;
      for (const entity of dataSource.entities.values)
        if (entity.rectangle) entity.rectangle.classificationType = next;
      render();
    },
    setVisible(visible) {
      dataSource.show = Boolean(visible) && materials.length > 0;
      render();
    },
    clear() {
      dataSource.entities.removeAll();
      materials = [];
      dataSource.show = false;
      render();
    },
    get tileCount() {
      return materials.length;
    },
    destroy() {
      viewer.dataSources.remove(dataSource, true);
      materials = [];
    },
  };
}

/** Contour lines are drawn thin and light so they read on any heat colour. */
const CONTOUR_COLOR = Cesium.Color.WHITE.withAlpha(0.85);
const CONTOUR_WIDTH = 2;
/** Labels and bubble captions drop out beyond these camera distances (metres). */
const CONTOUR_LABEL_RANGE_M = 30_000_000;
const STATION_LABEL_RANGE_M = 7_000_000;
/** Bold sans reads far better on busy imagery than the panel's mono weight. */
const LABEL_FONT = 'bold 13px Inter, sans-serif';

const labelBase = () => ({
  font: LABEL_FONT,
  fillColor: Cesium.Color.WHITE,
  outlineColor: Cesium.Color.BLACK.withAlpha(0.95),
  outlineWidth: 4,
  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
  // A value printed on the ground must stay legible past nearby geometry. The
  // horizon culler supplies the occlusion the depth test no longer does.
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
});

/**
 * Isolines of the active map, clamped onto the surface (3D tiles in the
 * photoreal stack, terrain otherwise), with the level printed repeatedly along
 * each ring.
 */
export function createContourSurface({ viewer, classificationType }) {
  const dataSource = new Cesium.CustomDataSource('propagation-contours');
  dataSource.show = false;
  viewer.dataSources.add(dataSource);
  const culler = createHorizonCuller({ viewer });
  let type = classificationType;
  const render = () => viewer.scene?.requestRender?.();
  return {
    show(contours) {
      dataSource.entities.removeAll();
      for (const line of contours.lines) {
        dataSource.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(line.positions),
            width: CONTOUR_WIDTH,
            material: CONTOUR_COLOR,
            clampToGround: true,
            classificationType: type,
          },
        });
      }
      const tracked = [];
      for (const point of contourLabelPoints(contours.lines)) {
        const entity = dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
          label: {
            ...labelBase(),
            text: point.text,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              0,
              CONTOUR_LABEL_RANGE_M,
            ),
          },
        });
        tracked.push({ lon: point.lon, lat: point.lat, entities: [entity] });
      }
      culler.set(tracked);
      dataSource.show = true;
      render();
    },
    setClassification(next) {
      if (next === undefined || next === type) return;
      type = next;
      for (const entity of dataSource.entities.values)
        if (entity.polyline) entity.polyline.classificationType = next;
      render();
    },
    clear() {
      culler.clear();
      dataSource.entities.removeAll();
      dataSource.show = false;
      render();
    },
    get lineCount() {
      return dataSource.entities.values.filter((entity) => entity.polyline)
        .length;
    },
    get labelCount() {
      return dataSource.entities.values.filter((entity) => entity.label).length;
    },
    destroy() {
      culler.destroy();
      viewer.dataSources.remove(dataSource, true);
    },
  };
}

export const STATION_ID_PREFIX = 'propagation-station:';

/**
 * Reporting ionosondes as bubbles coloured on the map's own scale, so a bubble
 * that matches the heat beneath it shows the model agrees with a measurement.
 * Stations over the horizon are hidden; the rest can be hovered and clicked
 * through {@link createStationInteraction}.
 */
export function createStationSurface({ viewer }) {
  const dataSource = new Cesium.CustomDataSource('propagation-stations');
  dataSource.show = false;
  viewer.dataSources.add(dataSource);
  const culler = createHorizonCuller({ viewer });
  /** @type {Map<string, {station: object, entity: Cesium.Entity}>} */
  let records = new Map();
  let scale = null;
  const render = () => viewer.scene?.requestRender?.();
  return {
    /**
     * @param {Array<object>} stations Already filtered to the active map.
     * @param {{field: string, unit: string, stops: number[][],
     *   range: {min: number, max: number}, now?: number}} next
     */
    show(stations, next) {
      const { field, stops, range } = next;
      scale = next;
      dataSource.entities.removeAll();
      records = new Map();
      const tracked = [];
      for (const station of stations) {
        const value = stationValue(station, field);
        if (value === null) continue;
        const [r, g, b] = colorAtPosition(stops, valuePosition(value, range));
        const entity = dataSource.entities.add({
          id: `${STATION_ID_PREFIX}${station.code}`,
          name: `${station.name} (${station.code})`,
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat),
          point: {
            pixelSize: 13,
            color: Cesium.Color.fromBytes(r, g, b, 255),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            ...labelBase(),
            text: formatStationValue(value),
            pixelOffset: new Cesium.Cartesian2(0, -21),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              0,
              STATION_LABEL_RANGE_M,
            ),
          },
        });
        records.set(station.code, { station, entity });
        tracked.push({
          lon: station.lon,
          lat: station.lat,
          entities: [entity],
        });
      }
      culler.set(tracked);
      dataSource.show = true;
      render();
    },
    /** Details for the hover/click card, or null if the station is gone. */
    detailsFor(code, now = Date.now()) {
      const record = records.get(code);
      if (!record || !scale) return null;
      const { station, entity } = record;
      return {
        code,
        name: station.name,
        rows: stationRows(station, scale.field, scale.unit, now),
        entity,
        visible: entity.show !== false,
      };
    },
    clear() {
      culler.clear();
      dataSource.entities.removeAll();
      records = new Map();
      dataSource.show = false;
      render();
    },
    get count() {
      return records.size;
    },
    destroy() {
      culler.destroy();
      viewer.dataSources.remove(dataSource, true);
    },
  };
}
