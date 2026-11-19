/**
 * What the APRS and Meshtastic layers ask of the scene, through the renderer
 * contract only: where the view is, how far apart two places are, flying to a
 * station, picks, the horizon, and station labels as world-overlay entries. Both station
 * surfaces and both layers share these, so the two networks behave alike.
 */
import { fromDegrees, toLonLatH } from '../../geo/ellipsoid.js';
import { surfaceDistance } from '../../geo/geodesic.js';
import { horizonFrom } from '../../geo/horizon.js';
import { distanceSquared, toRadians } from '../../geo/vector.js';
import { canvasOf, findCamera, findQuery } from '../../render/rendererOf.js';
import {
  touchDrillWindow,
  touchPickWindow,
} from '../../ui/mobile/cards-slop.js';

/** The mobile UI mode; labels are only pickable there. */
export function touchUi() {
  return globalThis.document?.documentElement?.dataset?.ui === 'mobile';
}

/** The point on the ground under the middle of the screen (or under the camera). */
export function viewCenter(viewer) {
  const camera = viewer ? findCamera(viewer) : null;
  if (!camera) return { lat: 0, lon: 0 };
  const canvas = canvasOf(viewer);
  if (canvas) {
    const hit =
      findQuery(viewer)?.pickEllipsoid(
        canvas.clientWidth / 2,
        canvas.clientHeight / 2,
      ) ?? null;
    const at = hit ? toLonLatH(hit) : null;
    if (at) return { lat: at.lat, lon: at.lon };
  }
  const pose = camera.pose();
  return { lat: pose.lat, lon: pose.lon };
}

/** Kilometres along the ellipsoid between two `{lat, lon}` points (degrees). */
export function kmBetween(a, b) {
  return (
    surfaceDistance(
      { lon: toRadians(a.lon), lat: toRadians(a.lat) },
      { lon: toRadians(b.lon), lat: toRadians(b.lat) },
    ) / 1000
  );
}

const FLY_RANGE_NEAR_M = 1500;
const FLY_RANGE_FAR_M = 30_000;

/** Fly to look down on a station: steeply from afar (CENTER), or close (ZOOM). */
export function flyToStation(viewer, lon, lat, near) {
  const camera = viewer ? findCamera(viewer) : null;
  if (!camera) return;
  camera.flyToBounds(
    { center: fromDegrees(lon, lat), radius: 1 },
    {
      durationS: 1.6,
      offset: {
        heading: 0,
        pitch: toRadians(near ? -35 : -70),
        range: near ? FLY_RANGE_NEAR_M : FLY_RANGE_FAR_M,
      },
    },
  );
}

/** A click reaches this many stations deep, within this many pixels. */
const STACK_LIMIT = 24;
const STACK_PICK_PX = 6;

const idWithin = (hit, prefix) =>
  typeof hit?.id === 'string' && hit.id.startsWith(prefix)
    ? hit.id.slice(prefix.length)
    : null;

/** The station id (prefix removed) on top under a canvas point, or null. */
export function idAt(query, x, y, prefix) {
  return idWithin(query?.pick(x, y, touchPickWindow()) ?? null, prefix);
}

/**
 * Every station whose item id starts with `prefix` under a canvas point,
 * prefix removed. The pick order shifts with draw order, so they come back
 * sorted by id: clicking a stack walks it in a fixed order.
 */
export function idsUnder(query, x, y, prefix) {
  const picked =
    query?.drillPick(x, y, {
      ...touchDrillWindow(STACK_PICK_PX),
      limit: STACK_LIMIT,
    }) ?? [];
  const ids = new Set();
  for (const hit of picked) {
    const id = idWithin(hit, prefix);
    if (id !== null) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Hide anything on the far side of the planet.
 *
 * Icons are drawn with the depth test off so they stay legible over terrain
 * and buildings, which also means the globe no longer hides them: a station in
 * Australia would show through the Earth when looking at Europe. This is that
 * missing occlusion, done analytically against the ellipsoid from the camera
 * position, only when it has moved more than half a kilometre. Each record
 * carries `horizonPoint` (ECEF, lifted above the ground) and gets `visible`.
 */
export function createHorizon(viewer) {
  let last = null;
  let horizon = null;
  const eye = () => (viewer ? findCamera(viewer)?.pose()?.position : null);
  return {
    /** Re-test `records`; returns the records whose visibility flipped. */
    update(records, force) {
      const camera = eye();
      if (!camera) return [];
      // Sub-kilometre movement cannot change what is over the horizon.
      if (!force && last && distanceSquared(camera, last) <= 500 ** 2)
        return [];
      last = { x: camera.x, y: camera.y, z: camera.z };
      horizon = horizonFrom(camera);
      const flipped = [];
      for (const record of records) {
        const visible = horizon.isPointVisible(record.horizonPoint);
        if (visible === record.visible) continue;
        record.visible = visible;
        flipped.push(record);
      }
      return flipped;
    },
    isPointVisible(point) {
      const camera = eye();
      return camera ? horizonFrom(camera).isPointVisible(point) : true;
    },
    invalidate() {
      last = null;
    },
  };
}

/** A canvas `width` × `height` device pixels, or null without a document. */
export function documentCanvas(width, height) {
  const canvas = globalThis.document?.createElement?.('canvas');
  if (!canvas) return null;
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Station labels as world-overlay entries: the host places them clear of
 * the icon and of each other, culls them at the horizon and past
 * `maxDistance`, and on touch makes them tap targets for their station.
 * @param {object} options
 * @param {string} options.id Station id (the entry id).
 * @param {{x: number, y: number, z: number}} options.position ECEF.
 * @param {string} options.title
 * @param {string} options.accent CSS colour.
 * @param {boolean} options.emphasised Hovered or pinned: wins the budget.
 * @param {number} options.iconPx The icon's size, so the label clears it.
 * @param {number} options.maxDistance Metres from the eye.
 */
export function stationLabelEntry({
  id,
  position,
  title,
  accent,
  emphasised,
  iconPx,
  maxDistance,
}) {
  const touch = touchUi();
  return {
    id,
    position,
    variant: 'label',
    title,
    accent,
    priority: emphasised ? Number.MAX_SAFE_INTEGER : 1,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: touch,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    maxDistance,
    placement: 'above',
    // Where the old world label sat: just over the icon's top edge.
    gapPx: Math.round(iconPx * 0.62),
  };
}

/**
 * The station id whose label is under a canvas point, on touch only (labels
 * are tap targets there), or null.
 */
export function labelIdAt(overlayHost, sourceId, x, y) {
  if (!touchUi()) return null;
  const hit = overlayHost?.hitTest?.(x, y, { sourceId }) ?? null;
  return typeof hit?.entryId === 'string' ? hit.entryId : null;
}
