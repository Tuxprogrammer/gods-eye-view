import { fromDegrees } from '../../geo/ellipsoid.js';
import { hexColor } from '../../render/color.js';
import { drawOf, findFrame, findQuery } from '../../render/rendererOf.js';
import {
  createHorizon,
  documentCanvas,
  idAt,
  idsUnder,
  labelIdAt,
  stationLabelEntry,
} from '../aprs/scene.js';
import { hardwareImageUrl } from './hardware.js';
import {
  CATEGORY_COLORS,
  CLAMP_NODE_LIMIT,
  LABEL_NODE_LIMIT,
  nodeCategory,
  nodeGlyph,
  nodeLabel,
} from './model.js';

export const NODE_ID_PREFIX = 'mesh-node:';
export const MESHTASTIC_LABEL_SOURCE_ID = 'meshtastic-labels';
/** Labels drop out beyond this camera distance (metres). */
const LABEL_RANGE_M = 400_000;
/** Icons shrink a little with distance so a continent stays readable. */
const ICON_SCALE_BY_DISTANCE = Object.freeze({
  near: 2e5,
  nearValue: 1,
  far: 1.2e7,
  farValue: 0.45,
});
const HORIZON_ELEVATION_M = 2000;
const ICON_SIZE = 40;
const TRACK_WIDTH = 3;
const SELECTED_TRACK_COLOR = hexColor('#ffe45c');
const LABEL_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: LABEL_NODE_LIMIT,
  moving: false,
});

const iconCache = new Map();
/** Device picture URL -> {image, ready, waiters}; loaded once, on first use. */
const deviceImages = new Map();
/** Largest side of a device picture inside the badge. */
const DEVICE_IMAGE_SIZE = 24;

/**
 * The loaded picture for a URL, or null while it loads or if it failed.
 * `onReady` is called once the picture arrives.
 */
function deviceImage(url, onReady) {
  let held = deviceImages.get(url);
  if (!held) {
    if (typeof Image === 'undefined') return null;
    const image = new Image();
    held = { image, ready: false, waiters: new Set() };
    deviceImages.set(url, held);
    image.onload = () => {
      held.ready = image.naturalWidth > 0 && image.naturalHeight > 0;
      if (!held.ready) return;
      for (const waiter of held.waiters) waiter();
      held.waiters.clear();
    };
    image.src = url;
  }
  if (!held.ready && onReady) held.waiters.add(onReady);
  return held.ready ? held.image : null;
}

/**
 * A round badge in the role colour holding the role's glyph. A dashed ring
 * marks a position the node's channel has blurred, so a reader can tell a
 * pinpoint from a neighbourhood at a glance. Cached by look.
 */
function iconFor(node, onImageReady, createCanvas) {
  const category = nodeCategory(node);
  const approximate = node.precisionKm >= 0.5;
  const url = hardwareImageUrl(node.hwModel);
  const picture = url ? deviceImage(url, onImageReady) : null;
  const key = `${category}|${approximate ? 'approx' : 'exact'}|${picture ? url : ''}`;
  let canvas = iconCache.get(key);
  if (canvas) return { key, canvas };
  canvas = createCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;
  const c = ICON_SIZE / 2;
  ctx.beginPath();
  ctx.arc(c, c, c - 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12, 16, 24, 0.86)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = CATEGORY_COLORS[category];
  if (approximate) ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (picture) {
    const fit =
      DEVICE_IMAGE_SIZE / Math.max(picture.naturalWidth, picture.naturalHeight);
    const w = picture.naturalWidth * fit;
    const h = picture.naturalHeight * fit;
    ctx.drawImage(picture, c - w / 2, c - h / 2, w, h);
  } else {
    ctx.font =
      '18px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CATEGORY_COLORS[category];
    ctx.fillText(nodeGlyph(node), c, c + 1);
  }
  iconCache.set(key, canvas);
  return { key, canvas };
}

/**
 * The nodes, their tracks, and the selected node's 24 h track, drawn through
 * the renderer's draw port; node labels go to the world-overlay host
 * (`overlayHost`), when there is one, which places stacked nodes' labels
 * clear of each other. The records are shaped like the APRS surface's so the
 * shared hover card and message pop-ups work on it unchanged
 * (`record.station` is the node).
 */
export function createMeshtasticSurface({
  viewer,
  classificationType = 'both',
  overlayHost = null,
  createCanvas = documentCanvas,
}) {
  const draw = drawOf(viewer);
  const icons = draw.icons({ id: 'meshtastic:nodes', show: true });
  const tracks = draw.lines({
    id: 'meshtastic:tracks',
    pickable: false,
    show: true,
  });
  const rings = draw.shapes({
    id: 'meshtastic:accuracy',
    pickable: false,
    show: true,
  });
  const horizon = createHorizon(viewer);
  /** @type {Map<string, object>} node id -> render record */
  let records = new Map();
  /** @type {Map<string, string>} node id -> drawn track signature */
  let trackSignatures = new Map();
  /** @type {Map<string, object>} line id -> line item, for re-clamping */
  let trackItems = new Map();
  let selectedTrack = false;
  let ring = false;
  let emphasised = null;
  let type = classificationType;
  let showLabels = true;
  let clamp = true;
  let remover = null;
  let destroyed = false;
  const render = () => findFrame(viewer)?.requestRender('meshtastic');

  function styleRecord(record) {
    record.icon = iconFor(record.station, restyleAll, createCanvas);
    record.category = nodeCategory(record.station);
  }

  function iconItem(record) {
    const node = record.station;
    return {
      id: `${NODE_ID_PREFIX}${node.id}`,
      pos: record.position,
      image: record.icon
        ? { canvas: record.icon.canvas, key: record.icon.key }
        : '',
      size: [ICON_SIZE, ICON_SIZE],
      anchor: 'center',
      height: clamp ? 'clampGround' : 'absolute',
      disableDepthTest: Number.POSITIVE_INFINITY,
      scaleByDistance: ICON_SCALE_BY_DISTANCE,
      scale: node.id === emphasised ? 1.3 : 1,
      show: record.visible && Boolean(record.icon),
    };
  }

  /** Node labels, one overlay entry each, while few enough are drawn. */
  function publishLabels() {
    if (!overlayHost) return;
    const wanted = showLabels && records.size <= LABEL_NODE_LIMIT;
    const entries = wanted
      ? [...records.values()].map((record) =>
          stationLabelEntry({
            id: record.station.id,
            position: record.position,
            title: nodeLabel(record.station),
            accent: CATEGORY_COLORS[record.category] ?? CATEGORY_COLORS.client,
            emphasised: record.station.id === emphasised,
            iconPx: ICON_SIZE,
            maxDistance: LABEL_RANGE_M,
          }),
        )
      : [];
    overlayHost.setEntries(
      MESHTASTIC_LABEL_SOURCE_ID,
      entries,
      LABEL_SOURCE_OPTIONS,
    );
  }

  /** A device picture finished loading: redraw the icons that wait for it. */
  function restyleAll() {
    if (destroyed) return;
    for (const record of records.values()) styleRecord(record);
    icons.upsert([...records.values()].map(iconItem));
    render();
  }

  /**
   * The hovered or pinned node's position ambiguity, as a ring on the ground.
   * A node whose channel blurs its position reports the middle of a box
   * `precisionKm` wide, and the node is somewhere inside it; the ring has that
   * box's width as its diameter. A node reporting a full-precision fix has no
   * ambiguity to show, so it gets no ring.
   */
  function applyAccuracyRing() {
    if (ring) {
      rings.clear();
      dropTracks(['accuracy-ring']);
      ring = false;
    }
    const node = emphasised ? records.get(emphasised)?.station : null;
    if (!node || !(node.precisionKm > 0)) return;
    const radiusM = (node.precisionKm * 1000) / 2;
    const css = CATEGORY_COLORS[nodeCategory(node)] ?? CATEGORY_COLORS.client;
    const dLat = radiusM / 111_195;
    const dLon =
      radiusM /
      (111_195 * Math.max(0.05, Math.cos((node.lat * Math.PI) / 180)));
    const points = [];
    for (let i = 0; i <= 96; i += 1) {
      const angle = (i / 96) * Math.PI * 2;
      points.push({
        lon: node.lon + dLon * Math.cos(angle),
        lat: node.lat + dLat * Math.sin(angle),
      });
    }
    rings.set([
      {
        id: 'accuracy-fill',
        geometry: {
          kind: 'ellipse',
          center: { lon: node.lon, lat: node.lat, height: 0 },
          semiMajor: radiusM,
          semiMinor: radiusM,
        },
        fill: hexColor(css, 0.14),
        height: 'clampGround',
        clampTo: type,
      },
    ]);
    putTracks([
      {
        id: 'accuracy-ring',
        positions: points.map((p) => fromDegrees(p.lon, p.lat)),
        widthPx: 2,
        mode: 'draped',
        clampTo: type,
        style: { kind: 'dash', color: hexColor(css, 0.95), length: 12 },
      },
    ]);
    ring = true;
  }

  const trackColor = (category) =>
    hexColor(CATEGORY_COLORS[category] ?? CATEGORY_COLORS.client, 0.85);

  function trackLine(id, points, color, widthPx) {
    return {
      id,
      positions: points.map((p) => fromDegrees(p.lon, p.lat)),
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
    /** Reconcile the drawn nodes with `nodes` (already filtered by the server). */
    show(nodes, nodeTracks) {
      clamp = nodes.length <= CLAMP_NODE_LIMIT;
      const next = new Map();
      for (const node of nodes) {
        let record = records.get(node.id);
        if (
          !record ||
          record.station.lat !== node.lat ||
          record.station.lon !== node.lon
        ) {
          record = {
            ...record,
            position: fromDegrees(node.lon, node.lat),
            horizonPoint: fromDegrees(node.lon, node.lat, HORIZON_ELEVATION_M),
            visible: record?.visible ?? true,
          };
        }
        record.station = node;
        styleRecord(record);
        next.set(node.id, record);
      }
      records = next;
      horizon.invalidate();
      horizon.update(records.values(), true);
      icons.set([...records.values()].map(iconItem));
      applyAccuracyRing();
      publishLabels();
      ensureHorizonListener();
      this.showTracks(nodeTracks);
      render();
    },

    /** Draw each node's recent track, replacing only tracks that changed. */
    showTracks(nodeTracks) {
      const wanted = new Map(
        [...(nodeTracks ?? new Map())].filter(([id]) => records.has(id)),
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
        const signature = `${points.length}:${points[points.length - 1].ts}`;
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

    /** One node's full 24 h track, highlighted, until cleared. */
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

    /** What the tracks and ring drape on: `'terrain'`, `'tiles'` or `'both'`. */
    setClassification(next) {
      if (next === undefined || next === type) return;
      type = next;
      putTracks(
        [...trackItems.values()].map((item) => ({ ...item, clampTo: next })),
      );
      applyAccuracyRing();
      render();
    },

    /** Grow the hovered/pinned node's icon. */
    setEmphasis(id) {
      if (emphasised === id) return;
      const changed = [emphasised, id]
        .map((key) => (key === null ? null : records.get(key)))
        .filter(Boolean);
      emphasised = id;
      if (changed.length) icons.upsert(changed.map(iconItem));
      applyAccuracyRing();
      publishLabels();
      render();
    },

    /** Node id under a canvas point, or null. */
    idAt(x, y) {
      return (
        labelIdAt(overlayHost, MESHTASTIC_LABEL_SOURCE_ID, x, y) ??
        idAt(findQuery(viewer), x, y, NODE_ID_PREFIX)
      );
    },

    /** Every node under a canvas point, in a fixed order, for cycling a stack. */
    idsAt(x, y) {
      const ids = idsUnder(findQuery(viewer), x, y, NODE_ID_PREFIX);
      const label = labelIdAt(overlayHost, MESHTASTIC_LABEL_SOURCE_ID, x, y);
      return label === null || ids.includes(label)
        ? ids
        : [...ids, label].sort();
    },

    /** The record for a drawn node: its data and whether it is on screen. */
    recordFor(id) {
      const record = records.get(id);
      if (!record) return null;
      return { station: record.station, visible: record.visible };
    },

    /**
     * Canvas position for a node (or, failing that, a lon/lat), or undefined
     * when it is over the horizon or off screen.
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
      rings.clear();
      trackSignatures = new Map();
      trackItems = new Map();
      selectedTrack = false;
      ring = false;
      emphasised = null;
      overlayHost?.clearSource?.(MESHTASTIC_LABEL_SOURCE_ID);
      remover?.();
      remover = null;
      render();
    },

    /** Nodes drawn, by role category. */
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
      for (const held of deviceImages.values()) held.waiters.delete(restyleAll);
      this.clear();
      icons.dispose();
      tracks.dispose();
      rings.dispose();
    },
  };
}
