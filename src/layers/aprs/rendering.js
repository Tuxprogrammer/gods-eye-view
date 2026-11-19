import { fromDegrees } from '../../geo/ellipsoid.js';
import { hexColor } from '../../render/color.js';
import { drawOf, findFrame, findQuery } from '../../render/rendererOf.js';
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
import {
  createHorizon,
  documentCanvas,
  idAt,
  idsUnder,
  labelIdAt,
  stationLabelEntry,
} from './scene.js';

export const STATION_ID_PREFIX = 'aprs-station:';
export const APRS_LABEL_SOURCE_ID = 'aprs-labels';
export { touchUi } from './scene.js';

/** Labels drop out beyond this camera distance (metres). */
const LABEL_RANGE_M = 400_000;
/** Icons shrink a little with distance so a continent stays readable. */
const ICON_SCALE_BY_DISTANCE = Object.freeze({
  near: 2e5,
  nearValue: 1,
  far: 1.2e7,
  farValue: 0.45,
});
/**
 * Horizon test points sit this far above the surface, so a station standing on
 * the visible limb does not flicker with the terrain beneath it.
 */
const HORIZON_ELEVATION_M = 2000;
const ICON_SIZE = 44;
/** The symbol picture inside the badge. */
const SPRITE_SIZE = 32;
const TRACK_WIDTH = 3;
const SELECTED_TRACK_COLOR = hexColor('#ffe45c');
const LABEL_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: LABEL_STATION_LIMIT,
  moving: false,
});

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
function iconFor(symbol, cell, color, createCanvas) {
  const sprite = cell && symbolSheets.state === 'ready';
  const key = sprite
    ? `s|${cell.sheet}|${cell.col}|${cell.row}|${cell.overlay?.col}|${cell.overlay?.row}|${color}`
    : `g|${symbol.glyph}|${color}`;
  let canvas = iconCache.get(key);
  if (canvas) return { key, canvas };
  canvas = createCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;
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

/** Packed ECEF positions of a `{lon, lat}` point list, on the ellipsoid. */
const trackPositions = (points) => points.map((p) => fromDegrees(p.lon, p.lat));

/**
 * The stations, their tracks, and the selected station's 24 h track, drawn
 * through the renderer's draw port; station labels go to the world-overlay
 * host (`overlayHost`), when there is one.
 *
 * A whole-Earth view can hold thousands of stations, so each change writes
 * only the items it touched.
 */
export function createAprsSurface({
  viewer,
  classificationType = 'both',
  overlayHost = null,
  createCanvas = documentCanvas,
}) {
  const draw = drawOf(viewer);
  const icons = draw.icons({ id: 'aprs:stations', show: true });
  const tracks = draw.lines({
    id: 'aprs:tracks',
    pickable: false,
    show: true,
  });
  const horizon = createHorizon(viewer);
  /** @type {Map<string, object>} station id -> render record */
  let records = new Map();
  /** @type {Map<string, string>} station id -> drawn track signature */
  let trackSignatures = new Map();
  /** @type {Map<string, object>} line id -> line item, for re-clamping */
  let trackItems = new Map();
  let selectedTrack = false;
  let emphasised = null;
  let type = classificationType;
  let showLabels = true;
  let clamp = true;
  let remover = null;
  let destroyed = false;
  const render = () => findFrame(viewer)?.requestRender('aprs');
  // Once the aprs.fi sheets arrive, restyle what is already drawn.
  whenSymbolSheets(() => {
    if (destroyed) return;
    for (const record of records.values()) styleRecord(record);
    icons.upsert([...records.values()].map(iconItem));
    render();
  });

  function styleRecord(record) {
    const { station } = record;
    const category = stationCategory(station);
    const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.fixed;
    record.icon = iconFor(
      symbolFor(station.symTable, station.symCode),
      symbolCell(station.symTable, station.symCode),
      color,
      createCanvas,
    );
    record.category = category;
    record.color = color;
  }

  function iconItem(record) {
    const { station } = record;
    return {
      id: `${STATION_ID_PREFIX}${station.id}`,
      pos: record.position,
      image: record.icon
        ? { canvas: record.icon.canvas, key: record.icon.key }
        : '',
      size: [ICON_SIZE, ICON_SIZE],
      anchor: 'center',
      height: clamp ? 'clampGround' : 'absolute',
      disableDepthTest: Number.POSITIVE_INFINITY,
      scaleByDistance: ICON_SCALE_BY_DISTANCE,
      scale: station.id === emphasised ? 1.3 : 1,
      show: record.visible && Boolean(record.icon),
    };
  }

  /** Station labels, one overlay entry each, while few enough are drawn. */
  function publishLabels() {
    if (!overlayHost) return;
    const wanted = showLabels && records.size <= LABEL_STATION_LIMIT;
    const entries = wanted
      ? [...records.values()].map((record) =>
          stationLabelEntry({
            id: record.station.id,
            position: record.position,
            title: stationLabel(record.station),
            accent: record.color,
            emphasised: record.station.id === emphasised,
            iconPx: ICON_SIZE,
            maxDistance: LABEL_RANGE_M,
          }),
        )
      : [];
    overlayHost.setEntries(APRS_LABEL_SOURCE_ID, entries, LABEL_SOURCE_OPTIONS);
  }

  function trackColor(category) {
    return hexColor(CATEGORY_COLORS[category] ?? CATEGORY_COLORS.mobile, 0.85);
  }

  function trackLine(id, points, color, widthPx) {
    return {
      id,
      positions: trackPositions(points),
      widthPx,
      mode: 'draped',
      clampTo: type,
      style: { kind: 'solid', color },
    };
  }

  function putTracks(items) {
    for (const item of items) trackItems.set(item.id, item);
    if (items.length) tracks.upsert(items);
  }

  function dropTracks(ids) {
    for (const id of ids) trackItems.delete(id);
    if (ids.length) tracks.remove(ids);
  }

  function ensureHorizonListener() {
    if (remover || !records.size) return;
    remover =
      findFrame(viewer)?.on('preRender', () => {
        const flipped = horizon.update(records.values(), false);
        if (!flipped.length) return;
        icons.upsert(flipped.map(iconItem));
        render();
      }) ?? null;
  }

  return {
    /**
     * Reconcile the drawn stations with `stations` (already filtered by the
     * server): add, move and restyle changed ones, drop the rest.
     * @param {object[]} stations
     * @param {Map<string, object[]>} stationTracks
     */
    show(stations, stationTracks) {
      clamp = stations.length <= CLAMP_STATION_LIMIT;
      const next = new Map();
      for (const station of stations) {
        let record = records.get(station.id);
        if (
          !record ||
          record.station.lat !== station.lat ||
          record.station.lon !== station.lon
        ) {
          record = {
            ...record,
            position: fromDegrees(station.lon, station.lat),
            horizonPoint: fromDegrees(
              station.lon,
              station.lat,
              HORIZON_ELEVATION_M,
            ),
            visible: record?.visible ?? true,
          };
        }
        record.station = station;
        styleRecord(record);
        next.set(station.id, record);
      }
      records = next;
      horizon.invalidate();
      horizon.update(records.values(), true);
      icons.set([...records.values()].map(iconItem));
      publishLabels();
      ensureHorizonListener();
      this.showTracks(stationTracks);
      render();
    },

    /** Draw each station's recent track, replacing only tracks that changed. */
    showTracks(stationTracks) {
      const wanted = new Map(
        [...(stationTracks ?? new Map())].filter(([id]) => records.has(id)),
      );
      const gone = [];
      for (const id of trackSignatures.keys()) {
        if (wanted.has(id)) continue;
        trackSignatures.delete(id);
        gone.push(`track:${id}`);
      }
      dropTracks(gone);
      const changed = [];
      for (const [id, points] of wanted) {
        const signature = trackSignature(points);
        if (trackSignatures.get(id) === signature) continue;
        trackSignatures.set(id, signature);
        changed.push(
          trackLine(
            `track:${id}`,
            points,
            trackColor(records.get(id)?.category),
            TRACK_WIDTH,
          ),
        );
      }
      putTracks(changed);
    },

    /** One station's full 24 h track, highlighted, until cleared. */
    showSelectedTrack(points) {
      this.clearSelectedTrack();
      if (!points || points.length < 2) return;
      putTracks([
        trackLine('selected', points, SELECTED_TRACK_COLOR, TRACK_WIDTH + 2),
      ]);
      selectedTrack = true;
      render();
    },
    clearSelectedTrack() {
      if (!selectedTrack) return;
      dropTracks(['selected']);
      selectedTrack = false;
      render();
    },

    setLabels(on) {
      showLabels = Boolean(on);
      publishLabels();
      render();
    },

    /** What the tracks drape on: `'terrain'`, `'tiles'` or `'both'`. */
    setClassification(next) {
      if (next === undefined || next === type) return;
      type = next;
      putTracks(
        [...trackItems.values()].map((item) => ({ ...item, clampTo: next })),
      );
      render();
    },

    /** Grow the hovered/pinned station's icon. */
    setEmphasis(id) {
      if (emphasised === id) return;
      const changed = [emphasised, id]
        .map((key) => (key === null ? null : records.get(key)))
        .filter(Boolean);
      emphasised = id;
      if (changed.length) icons.upsert(changed.map(iconItem));
      publishLabels();
      render();
    },

    /** Station id under a canvas point, or null. */
    idAt(x, y) {
      return (
        labelIdAt(overlayHost, APRS_LABEL_SOURCE_ID, x, y) ??
        idAt(findQuery(viewer), x, y, STATION_ID_PREFIX)
      );
    },

    /** Every station under a canvas point, in a fixed order, for cycling a stack. */
    idsAt(x, y) {
      const ids = idsUnder(findQuery(viewer), x, y, STATION_ID_PREFIX);
      const label = labelIdAt(overlayHost, APRS_LABEL_SOURCE_ID, x, y);
      return label === null || ids.includes(label)
        ? ids
        : [...ids, label].sort();
    },

    /** The record for a drawn station: its data and whether it is on screen. */
    recordFor(id) {
      const record = records.get(id);
      if (!record) return null;
      return { station: record.station, visible: record.visible };
    },

    /**
     * Canvas position for a station (or, failing that, a lon/lat), or
     * undefined when it is over the horizon or off screen.
     */
    screenPosition(id, lon, lat) {
      const record = id ? records.get(id) : null;
      if (record && !record.visible) return undefined;
      if (
        !record &&
        !horizon.isPointVisible(fromDegrees(lon, lat, HORIZON_ELEVATION_M))
      )
        return undefined;
      const position = record ? record.position : fromDegrees(lon, lat);
      return findQuery(viewer)?.project(position) ?? undefined;
    },

    clear() {
      records = new Map();
      icons.clear();
      tracks.clear();
      trackSignatures = new Map();
      trackItems = new Map();
      selectedTrack = false;
      emphasised = null;
      overlayHost?.clearSource?.(APRS_LABEL_SOURCE_ID);
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
      return trackSignatures.size;
    },

    destroy() {
      destroyed = true;
      this.clear();
      icons.dispose();
      tracks.dispose();
    },
  };
}

function trackSignature(points) {
  const last = points[points.length - 1];
  return `${points.length}:${last.ts}`;
}
