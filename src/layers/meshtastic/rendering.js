import * as Cesium from 'cesium';
import { createHorizon, idsUnder } from '../aprs/rendering.js';
import { hardwareImageUrl } from './hardware.js';
import {
  CATEGORY_COLORS,
  CLAMP_NODE_LIMIT,
  LABEL_NODE_LIMIT,
  nodeCategory,
  nodeGlyph,
  nodeLabel,
  spreadLabels,
} from './model.js';

export const NODE_ID_PREFIX = 'mesh-node:';
/** Labels drop out beyond this camera distance (metres). */
const LABEL_RANGE_M = 400_000;
/** Icons shrink a little with distance so a continent stays readable. */
const ICON_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(2e5, 1, 1.2e7, 0.45);
const HORIZON_ELEVATION_M = 2000;
const ICON_SIZE = 40;
const TRACK_WIDTH = 3;
const SELECTED_TRACK_COLOR = Cesium.Color.fromCssColorString('#ffe45c');
const LABEL_FONT = 'bold 12px Inter, sans-serif';
/** Stacked labels are re-fanned this long after the camera stops changing. */
const LABEL_LAYOUT_MS = 120;
const LABEL_HORIZONTAL = {
  left: Cesium.HorizontalOrigin.LEFT,
  center: Cesium.HorizontalOrigin.CENTER,
  right: Cesium.HorizontalOrigin.RIGHT,
};
const LABEL_VERTICAL = {
  top: Cesium.VerticalOrigin.TOP,
  center: Cesium.VerticalOrigin.CENTER,
  bottom: Cesium.VerticalOrigin.BOTTOM,
};
const LABEL_HOME_OFFSET = new Cesium.Cartesian2(0, -ICON_SIZE * 0.62);

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
function iconFor(node, onImageReady) {
  const category = nodeCategory(node);
  const approximate = node.precisionKm >= 0.5;
  const url = hardwareImageUrl(node.hwModel);
  const picture = url ? deviceImage(url, onImageReady) : null;
  const key = `${category}|${approximate ? 'approx' : 'exact'}|${picture ? url : ''}`;
  let canvas = iconCache.get(key);
  if (canvas) return { key, canvas };
  canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
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
 * The nodes, their tracks, and the selected node's 24 h track.
 *
 * Nodes are primitive billboards and labels rather than entities: a
 * whole-Earth view can hold thousands, and a collection updates in place. The
 * records are shaped like the APRS surface's so the shared hover card and
 * message pop-ups work on it unchanged (`record.station` is the node).
 */
export function createMeshtasticSurface({ viewer, classificationType }) {
  const scene = viewer.scene;
  const billboards = scene.primitives.add(
    new Cesium.BillboardCollection({ scene }),
  );
  const labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
  const trackSource = new Cesium.CustomDataSource('meshtastic-tracks');
  viewer.dataSources.add(trackSource);
  const horizon = createHorizon(viewer);
  /** @type {Map<string, object>} node id -> render record */
  let records = new Map();
  /** @type {Map<string, {signature: string, entity: Cesium.Entity}>} */
  let trackEntities = new Map();
  let selectedTrack = null;
  let ring = null;
  let emphasised = null;
  let type = classificationType;
  let showLabels = true;
  let remover = null;
  let destroyed = false;
  let layoutTimer = null;
  let cameraRemover = null;
  let moveEndRemover = null;
  const layoutScratch = new Cesium.Cartesian2();
  const render = () => scene.requestRender?.();

  const heightReference = (clamp) =>
    clamp
      ? Cesium.HeightReference.CLAMP_TO_GROUND
      : Cesium.HeightReference.NONE;

  function styleRecord(record, node, clamp) {
    const { key, canvas } = iconFor(node, restyleAll);
    if (record.iconKey !== key) {
      record.billboard.setImage(key, canvas);
      record.iconKey = key;
    }
    record.billboard.heightReference = heightReference(clamp);
    record.category = nodeCategory(node);
    const wanted = showLabels && records.size <= LABEL_NODE_LIMIT;
    record.labelWanted = wanted;
    if (wanted) {
      if (!record.label) {
        record.label = labels.add({
          text: nodeLabel(node),
          font: LABEL_FONT,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.95),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: LABEL_HOME_OFFSET,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
            0,
            LABEL_RANGE_M,
          ),
          position: record.billboard.position,
        });
        record.labelSlot = null;
      } else if (record.label.text !== nodeLabel(node)) {
        record.label.text = nodeLabel(node);
      }
      record.label.heightReference = heightReference(clamp);
      record.label.show = record.visible && wanted;
    } else if (record.label) {
      labels.remove(record.label);
      record.label = null;
    }
  }

  /**
   * Fan the labels of overlapping icons out around their dots so stacked nodes
   * stay readable. Screen positions change with the camera, so this runs again
   * once it settles; a node on its own keeps its label above the dot.
   */
  function layoutLabels() {
    layoutTimer = null;
    if (destroyed) return;
    const points = [];
    for (const [id, record] of records) {
      if (!record.label || !record.label.show) continue;
      const at = scene.cartesianToCanvasCoordinates(
        record.billboard.position,
        layoutScratch,
      );
      if (at) points.push({ id, x: at.x, y: at.y });
    }
    const slots = spreadLabels(points);
    let changed = false;
    for (const [id, record] of records) {
      if (!record.label) continue;
      const slot = slots.get(id) ?? null;
      const key = slot ? `${slot.dx},${slot.dy},${slot.h},${slot.v}` : '';
      if (record.labelSlot === key) continue;
      record.labelSlot = key;
      record.label.pixelOffset = slot
        ? new Cesium.Cartesian2(slot.dx, slot.dy)
        : LABEL_HOME_OFFSET;
      record.label.horizontalOrigin = slot
        ? LABEL_HORIZONTAL[slot.h]
        : Cesium.HorizontalOrigin.CENTER;
      record.label.verticalOrigin = slot
        ? LABEL_VERTICAL[slot.v]
        : Cesium.VerticalOrigin.BOTTOM;
      changed = true;
    }
    if (changed) render();
  }

  function scheduleLabelLayout() {
    if (layoutTimer !== null || destroyed) return;
    layoutTimer = setTimeout(layoutLabels, LABEL_LAYOUT_MS);
  }

  function ensureLabelLayoutListener() {
    if (cameraRemover || !records.size) return;
    cameraRemover =
      viewer.camera?.changed?.addEventListener(scheduleLabelLayout);
    moveEndRemover =
      viewer.camera?.moveEnd?.addEventListener(scheduleLabelLayout);
  }

  /** A device picture finished loading: redraw the icons that wait for it. */
  function restyleAll() {
    if (destroyed) return;
    const clamp = records.size <= CLAMP_NODE_LIMIT;
    for (const record of records.values())
      styleRecord(record, record.station, clamp);
    render();
  }

  function applyEmphasis() {
    for (const [id, record] of records)
      record.billboard.scale = id === emphasised ? 1.3 : 1;
    applyAccuracyRing();
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
      trackSource.entities.remove(ring.fill);
      trackSource.entities.remove(ring.line);
      ring = null;
    }
    const node = emphasised ? records.get(emphasised)?.station : null;
    if (!node || !(node.precisionKm > 0)) return;
    const radiusM = (node.precisionKm * 1000) / 2;
    const color = Cesium.Color.fromCssColorString(
      CATEGORY_COLORS[nodeCategory(node)] ?? CATEGORY_COLORS.client,
    );
    const centre = Cesium.Cartesian3.fromDegrees(node.lon, node.lat);
    const dLat = radiusM / 111_195;
    const dLon =
      radiusM /
      (111_195 * Math.max(0.05, Math.cos((node.lat * Math.PI) / 180)));
    const points = [];
    for (let i = 0; i <= 96; i += 1) {
      const angle = (i / 96) * Math.PI * 2;
      points.push(
        node.lon + dLon * Math.cos(angle),
        node.lat + dLat * Math.sin(angle),
      );
    }
    ring = {
      fill: trackSource.entities.add({
        position: centre,
        ellipse: {
          semiMajorAxis: radiusM,
          semiMinorAxis: radiusM,
          material: color.withAlpha(0.14),
          classificationType: type,
        },
      }),
      line: trackSource.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(points),
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: color.withAlpha(0.95),
            dashLength: 12,
          }),
          clampToGround: true,
          classificationType: type,
        },
      }),
    };
  }

  const trackSignature = (points) =>
    `${points.length}:${points[points.length - 1].ts}`;

  const trackColor = (category) =>
    Cesium.Color.fromCssColorString(
      CATEGORY_COLORS[category] ?? CATEGORY_COLORS.client,
    ).withAlpha(0.85);

  function ensureHorizonListener() {
    if (remover || !records.size) return;
    remover = scene.preRender?.addEventListener(() => {
      if (horizon.update(records.values(), false)) render();
    });
  }

  return {
    /** Reconcile the drawn nodes with `nodes` (already filtered by the server). */
    show(nodes, tracks) {
      const clamp = nodes.length <= CLAMP_NODE_LIMIT;
      const next = new Map();
      for (const node of nodes) {
        let record = records.get(node.id);
        const position = Cesium.Cartesian3.fromDegrees(node.lon, node.lat);
        if (!record) {
          record = {
            station: node,
            billboard: billboards.add({
              id: `${NODE_ID_PREFIX}${node.id}`,
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
              node.lon,
              node.lat,
              HORIZON_ELEVATION_M,
            ),
            category: 'client',
          };
        } else if (
          record.station.lat !== node.lat ||
          record.station.lon !== node.lon
        ) {
          record.billboard.position = position;
          if (record.label) record.label.position = position;
          record.horizonPoint = Cesium.Cartesian3.fromDegrees(
            node.lon,
            node.lat,
            HORIZON_ELEVATION_M,
          );
        }
        record.station = node;
        next.set(node.id, record);
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
      ensureLabelLayoutListener();
      scheduleLabelLayout();
      this.showTracks(tracks);
      render();
    },

    /** Draw each node's recent track, replacing only tracks that changed. */
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

    /** One node's full 24 h track, highlighted, until cleared. */
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
      const clamp = records.size <= CLAMP_NODE_LIMIT;
      for (const record of records.values())
        styleRecord(record, record.station, clamp);
      horizon.invalidate();
      horizon.update(records.values(), true);
      scheduleLabelLayout();
      render();
    },

    setClassification(next) {
      if (next === undefined || next === type) return;
      type = next;
      for (const held of trackEntities.values())
        held.entity.polyline.classificationType = next;
      if (selectedTrack) selectedTrack.polyline.classificationType = next;
      applyAccuracyRing();
      render();
    },

    /** Grow the hovered/pinned node's icon. */
    setEmphasis(id) {
      if (emphasised === id) return;
      emphasised = id;
      applyEmphasis();
      render();
    },

    /** Node id under a canvas point, or null. */
    idAt(x, y) {
      const picked = scene.pick(new Cesium.Cartesian2(x, y));
      const id = picked?.id;
      const text = typeof id === 'string' ? id : (id?.id ?? null);
      return typeof text === 'string' && text.startsWith(NODE_ID_PREFIX)
        ? text.slice(NODE_ID_PREFIX.length)
        : null;
    },

    /** Every node under a canvas point, in a fixed order, for cycling a stack. */
    idsAt(x, y) {
      return idsUnder(scene, x, y, NODE_ID_PREFIX);
    },

    /** The record for a drawn node: its data and whether it is on screen. */
    recordFor(id) {
      const record = records.get(id);
      if (!record) return null;
      return {
        station: record.station,
        visible: record.visible && record.billboard.show !== false,
      };
    },

    /**
     * Canvas position for a node (or, failing that, a lon/lat), or undefined
     * when it is over the horizon or off screen.
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
      ring = null;
      emphasised = null;
      remover?.();
      remover = null;
      cameraRemover?.();
      cameraRemover = null;
      moveEndRemover?.();
      moveEndRemover = null;
      if (layoutTimer !== null) clearTimeout(layoutTimer);
      layoutTimer = null;
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
      return trackEntities.size;
    },

    destroy() {
      destroyed = true;
      for (const held of deviceImages.values()) held.waiters.delete(restyleAll);
      this.clear();
      scene.primitives.remove(billboards);
      scene.primitives.remove(labels);
      viewer.dataSources.remove(trackSource, true);
    },
  };
}
