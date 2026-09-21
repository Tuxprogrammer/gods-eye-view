import * as Cesium from 'cesium';
import {
  CATEGORY_COLORS,
  CLAMP_STATION_LIMIT,
  LABEL_STATION_LIMIT,
  stationCategory,
  stationLabel,
  SYMBOL_TILE_PX,
  symbolCell,
  symbolFor,
} from './model.js';

export const STATION_ID_PREFIX = 'aprs-station:';
/** Labels drop out beyond this camera distance (metres). */
const LABEL_RANGE_M = 400_000;
/** Icons shrink a little with distance so a continent stays readable. */
const ICON_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(2e5, 1, 1.2e7, 0.45);
/**
 * Horizon test points sit this far above the surface, so a station standing on
 * the visible limb does not flicker with the terrain beneath it.
 */
const HORIZON_ELEVATION_M = 2000;
const ICON_SIZE = 44;
/** The symbol picture inside the badge. */
const SPRITE_SIZE = 32;
const TRACK_WIDTH = 3;
const SELECTED_TRACK_COLOR = Cesium.Color.fromCssColorString('#ffe45c');
const LABEL_FONT = 'bold 12px Inter, sans-serif';

const iconCache = new Map();

/**
 * The aprs.fi symbol set (aprs-symbols by Heikki Hannikainen, OH7LZB), loaded
 * by the browser at runtime from a CDN, pinned to one commit. It is NOT
 * bundled: its licences are mixed (some share-alike, some unknown, some brand
 * logos), so this project points at it rather than redistributing it. If the
 * sheets cannot be loaded the markers keep their drawn glyphs.
 */
const SYMBOL_SHEET_URL = (n) =>
  `https://cdn.jsdelivr.net/gh/hessu/aprs-symbols@f2286a9cd43eb6ba4501250b4c39fff111e3796c/png/aprs-symbols-${SYMBOL_TILE_PX}-${n}.png`;
const symbolSheets = { state: 'idle', images: [], waiting: [] };

/** Start loading the sheets once; `onReady` runs when they are all usable. */
function whenSymbolSheets(onReady) {
  if (symbolSheets.state === 'ready') return onReady();
  if (symbolSheets.state === 'failed' || typeof Image === 'undefined') return;
  symbolSheets.waiting.push(onReady);
  if (symbolSheets.state === 'loading') return;
  symbolSheets.state = 'loading';
  let pending = 3;
  for (let n = 0; n < 3; n += 1) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      pending -= 1;
      if (pending === 0 && symbolSheets.state === 'loading') {
        symbolSheets.state = 'ready';
        for (const fn of symbolSheets.waiting.splice(0)) fn();
      }
    };
    image.onerror = () => {
      symbolSheets.state = 'failed';
      symbolSheets.waiting.length = 0;
    };
    image.src = SYMBOL_SHEET_URL(n);
    symbolSheets.images[n] = image;
  }
}

/**
 * A round badge in the category colour holding the station's symbol: the
 * aprs.fi picture when the sheets are loaded, otherwise a drawn glyph. Cached
 * by look.
 */
function iconFor(symbol, cell, color) {
  const sprite = cell && symbolSheets.state === 'ready';
  const key = sprite
    ? `s|${cell.sheet}|${cell.col}|${cell.row}|${cell.overlay?.col}|${cell.overlay?.row}|${color}`
    : `g|${symbol.glyph}|${color}`;
  let canvas = iconCache.get(key);
  if (canvas) return { key, canvas };
  canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  const c = ICON_SIZE / 2;
  ctx.beginPath();
  ctx.arc(c, c, c - 3, 0, Math.PI * 2);
  ctx.fillStyle = sprite
    ? 'rgba(255, 255, 255, 0.92)'
    : 'rgba(12, 16, 24, 0.86)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (sprite) {
    const draw = (sheet, at) =>
      ctx.drawImage(
        symbolSheets.images[sheet],
        at.col * SYMBOL_TILE_PX,
        at.row * SYMBOL_TILE_PX,
        SYMBOL_TILE_PX,
        SYMBOL_TILE_PX,
        c - SPRITE_SIZE / 2,
        c - SPRITE_SIZE / 2,
        SPRITE_SIZE,
        SPRITE_SIZE,
      );
    draw(cell.sheet, cell);
    if (cell.overlay) draw(2, cell.overlay);
  } else {
    ctx.font =
      '20px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(symbol.glyph, c, c + 1);
  }
  iconCache.set(key, canvas);
  return { key, canvas };
}

/**
 * Hide anything on the far side of the planet.
 *
 * Icons are drawn with the depth test off so they stay legible over terrain
 * and buildings, which also means the globe no longer hides them: a station in
 * Australia would show through the Earth when looking at Europe. This is that
 * missing occlusion, done analytically against the ellipsoid, so it needs no
 * depth buffer. It runs from the camera position, only when it has moved.
 */
function createHorizon(viewer) {
  const occluder = new Cesium.EllipsoidalOccluder(
    Cesium.Ellipsoid.WGS84,
    new Cesium.Cartesian3(),
  );
  const last = new Cesium.Cartesian3(NaN, NaN, NaN);
  return {
    /** Re-test `records`; returns true when any visibility flipped. */
    update(records, force) {
      const camera = viewer.camera?.positionWC;
      if (!camera) return false;
      // Sub-kilometre movement cannot change what is over the horizon.
      if (!force && Cesium.Cartesian3.equalsEpsilon(camera, last, 0, 500))
        return false;
      Cesium.Cartesian3.clone(camera, last);
      occluder.cameraPosition = camera;
      let flipped = false;
      for (const record of records) {
        const visible = occluder.isPointVisible(record.horizonPoint);
        if (visible === record.visible) continue;
        record.visible = visible;
        flipped = true;
        record.billboard.show = visible && !record.filteredOut;
        if (record.label) record.label.show = visible && record.labelWanted;
      }
      return flipped;
    },
    isPointVisible(point) {
      const camera = viewer.camera?.positionWC;
      if (!camera) return true;
      occluder.cameraPosition = camera;
      return occluder.isPointVisible(point);
    },
    invalidate() {
      Cesium.Cartesian3.clone(new Cesium.Cartesian3(NaN, NaN, NaN), last);
    },
  };
}

/**
 * The stations, their tracks, and the selected station's 24 h track.
 *
 * Stations are primitive billboards and labels rather than entities: a
 * whole-Earth view can hold thousands, and a collection updates in place.
 */
export function createAprsSurface({ viewer, classificationType }) {
  const scene = viewer.scene;
  const billboards = scene.primitives.add(
    new Cesium.BillboardCollection({ scene }),
  );
  const labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
  const trackSource = new Cesium.CustomDataSource('aprs-tracks');
  viewer.dataSources.add(trackSource);
  const horizon = createHorizon(viewer);
  /** @type {Map<string, object>} station id -> render record */
  let records = new Map();
  /** @type {Map<string, {signature: string, entity: Cesium.Entity}>} */
  let trackEntities = new Map();
  let selectedTrack = null;
  let emphasised = null;
  let type = classificationType;
  let showLabels = true;
  let remover = null;
  const render = () => scene.requestRender?.();
  // Once the aprs.fi sheets arrive, restyle what is already drawn.
  whenSymbolSheets(() => {
    const clamp = records.size <= CLAMP_STATION_LIMIT;
    for (const record of records.values())
      styleRecord(record, record.station, clamp);
    render();
  });

  const heightReference = (clamp) =>
    clamp
      ? Cesium.HeightReference.CLAMP_TO_GROUND
      : Cesium.HeightReference.NONE;

  function styleRecord(record, station, clamp) {
    const category = stationCategory(station);
    const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.fixed;
    const symbol = symbolFor(station.symTable, station.symCode);
    const { key, canvas } = iconFor(
      symbol,
      symbolCell(station.symTable, station.symCode),
      color,
    );
    if (record.iconKey !== key) {
      record.billboard.setImage(key, canvas);
      record.iconKey = key;
    }
    record.billboard.heightReference = heightReference(clamp);
    record.category = category;
    const wanted = showLabels && records.size <= LABEL_STATION_LIMIT;
    record.labelWanted = wanted;
    if (wanted) {
      if (!record.label) {
        record.label = labels.add({
          text: stationLabel(station),
          font: LABEL_FONT,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.95),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -ICON_SIZE * 0.62),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
            0,
            LABEL_RANGE_M,
          ),
          position: record.billboard.position,
        });
      }
      record.label.heightReference = heightReference(clamp);
      record.label.show = record.visible && wanted;
    } else if (record.label) {
      labels.remove(record.label);
      record.label = null;
    }
  }

  function applyEmphasis() {
    for (const [id, record] of records)
      record.billboard.scale = id === emphasised ? 1.3 : 1;
  }

  function trackSignature(points) {
    const last = points[points.length - 1];
    return `${points.length}:${last.ts}`;
  }

  function trackColor(category) {
    return Cesium.Color.fromCssColorString(
      CATEGORY_COLORS[category] ?? CATEGORY_COLORS.mobile,
    ).withAlpha(0.85);
  }

  function ensureHorizonListener() {
    if (remover || !records.size) return;
    remover = scene.preRender?.addEventListener(() => {
      if (horizon.update(records.values(), false)) render();
    });
  }

  return {
    /**
     * Reconcile the drawn stations with `stations` (already filtered by the
     * server): add, move and restyle changed ones, drop the rest.
     * @param {object[]} stations
     * @param {Map<string, object[]>} tracks
     */
    show(stations, tracks) {
      const clamp = stations.length <= CLAMP_STATION_LIMIT;
      const next = new Map();
      // Size first: the label limit depends on how many stations are drawn.
      for (const station of stations) {
        let record = records.get(station.id);
        const position = Cesium.Cartesian3.fromDegrees(
          station.lon,
          station.lat,
        );
        if (!record) {
          record = {
            station,
            billboard: billboards.add({
              id: `${STATION_ID_PREFIX}${station.id}`,
              position,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: ICON_SCALE_BY_DISTANCE,
            }),
            label: null,
            iconKey: null,
            visible: true,
            filteredOut: false,
            labelWanted: false,
            horizonPoint: Cesium.Cartesian3.fromDegrees(
              station.lon,
              station.lat,
              HORIZON_ELEVATION_M,
            ),
            category: 'fixed',
          };
        } else if (
          record.station.lat !== station.lat ||
          record.station.lon !== station.lon
        ) {
          record.billboard.position = position;
          if (record.label) record.label.position = position;
          record.horizonPoint = Cesium.Cartesian3.fromDegrees(
            station.lon,
            station.lat,
            HORIZON_ELEVATION_M,
          );
        }
        record.station = station;
        next.set(station.id, record);
      }
      for (const [id, record] of records) {
        if (next.has(id)) continue;
        billboards.remove(record.billboard);
        if (record.label) labels.remove(record.label);
      }
      records = next;
      for (const record of records.values())
        styleRecord(record, record.station, clamp);
      applyEmphasis();
      horizon.invalidate();
      horizon.update(records.values(), true);
      ensureHorizonListener();
      this.showTracks(tracks);
      render();
    },

    /** Draw each station's recent track, replacing only tracks that changed. */
    showTracks(tracks) {
      const wanted = new Map(
        [...(tracks ?? new Map())].filter(([id]) => records.has(id)),
      );
      for (const [id, held] of trackEntities) {
        if (wanted.has(id)) continue;
        trackSource.entities.remove(held.entity);
        trackEntities.delete(id);
      }
      for (const [id, points] of wanted) {
        const signature = trackSignature(points);
        const held = trackEntities.get(id);
        if (held?.signature === signature) continue;
        if (held) trackSource.entities.remove(held.entity);
        const entity = trackSource.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(
              points.flatMap((p) => [p.lon, p.lat]),
            ),
            width: TRACK_WIDTH,
            material: trackColor(records.get(id)?.category),
            clampToGround: true,
            classificationType: type,
          },
        });
        trackEntities.set(id, { signature, entity });
      }
    },

    /** One station's full 24 h track, highlighted, until cleared. */
    showSelectedTrack(points) {
      this.clearSelectedTrack();
      if (!points || points.length < 2) return;
      selectedTrack = trackSource.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(
            points.flatMap((p) => [p.lon, p.lat]),
          ),
          width: TRACK_WIDTH + 2,
          material: SELECTED_TRACK_COLOR,
          clampToGround: true,
          classificationType: type,
        },
      });
      render();
    },
    clearSelectedTrack() {
      if (!selectedTrack) return;
      trackSource.entities.remove(selectedTrack);
      selectedTrack = null;
      render();
    },

    setLabels(on) {
      showLabels = Boolean(on);
      const clamp = records.size <= CLAMP_STATION_LIMIT;
      for (const record of records.values())
        styleRecord(record, record.station, clamp);
      horizon.invalidate();
      horizon.update(records.values(), true);
      render();
    },

    setClassification(next) {
      if (next === undefined || next === type) return;
      type = next;
      for (const held of trackEntities.values())
        held.entity.polyline.classificationType = next;
      if (selectedTrack) selectedTrack.polyline.classificationType = next;
      render();
    },

    /** Grow the hovered/pinned station's icon. */
    setEmphasis(id) {
      if (emphasised === id) return;
      emphasised = id;
      applyEmphasis();
      render();
    },

    /** Station id under a canvas point, or null. */
    idAt(x, y) {
      const picked = scene.pick(new Cesium.Cartesian2(x, y));
      const id = picked?.id;
      const text = typeof id === 'string' ? id : (id?.id ?? null);
      return typeof text === 'string' && text.startsWith(STATION_ID_PREFIX)
        ? text.slice(STATION_ID_PREFIX.length)
        : null;
    },

    /** The record for a drawn station: its data and whether it is on screen. */
    recordFor(id) {
      const record = records.get(id);
      if (!record) return null;
      return {
        station: record.station,
        visible: record.visible && record.billboard.show !== false,
      };
    },

    /**
     * Canvas position for a station (or, failing that, a lon/lat), or
     * undefined when it is over the horizon or off screen.
     */
    screenPosition(id, lon, lat) {
      const record = id ? records.get(id) : null;
      if (record && !record.visible) return undefined;
      if (!record) {
        const point = Cesium.Cartesian3.fromDegrees(
          lon,
          lat,
          HORIZON_ELEVATION_M,
        );
        if (!horizon.isPointVisible(point)) return undefined;
      }
      const position = record
        ? record.billboard.computeScreenSpacePosition?.(scene)
        : scene.cartesianToCanvasCoordinates(
            Cesium.Cartesian3.fromDegrees(lon, lat),
          );
      return position ?? undefined;
    },

    clear() {
      for (const record of records.values()) {
        billboards.remove(record.billboard);
        if (record.label) labels.remove(record.label);
      }
      records = new Map();
      trackSource.entities.removeAll();
      trackEntities = new Map();
      selectedTrack = null;
      emphasised = null;
      remover?.();
      remover = null;
      render();
    },

    /** Stations drawn, by marker category. */
    categoryCounts() {
      const counts = {};
      for (const record of records.values())
        counts[record.category] = (counts[record.category] ?? 0) + 1;
      return counts;
    },
    get count() {
      return records.size;
    },
    get trackCount() {
      return trackEntities.size;
    },

    destroy() {
      this.clear();
      scene.primitives.remove(billboards);
      scene.primitives.remove(labels);
      viewer.dataSources.remove(trackSource, true);
    },
  };
}
