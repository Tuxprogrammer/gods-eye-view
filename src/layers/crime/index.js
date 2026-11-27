import { formatDate, formatNumber, msg, t } from '../../i18n/index.js';
import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf, findFrame } from '../../render/rendererOf.js';
import { CRIME_CATEGORIES, crimeCategory } from './categories.js';
import {
  CRIME_WINDOW_DAYS,
  DEFAULT_CRIME_WINDOW_DAYS,
  crimeMarkerPixels,
  groupCrimeLocations,
  titleCaseLocation,
} from './model.js';
import {
  CRIME_CATEGORY_LABELS,
  CRIME_OVERLAY_SOURCE_ID,
  buildCrimeCard,
} from './cards.js';
export { createCrimeSource } from './source.js';
export * from './model.js';
export * from './cards.js';
export * from './categories.js';

const LAYER_ID = 'crime';
const PICK_PREFIX = 'crime:';
const SET_ID = 'crime:markers';
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
// Markers stay above terrain and buildings when close, but the globe hides
// them once they are around the far side.
const DEPTH_TEST_DISTANCE_M = 50_000;
const SCALE_BY_DISTANCE = Object.freeze({
  near: 2_000,
  nearValue: 1.2,
  far: 200_000,
  farValue: 0.6,
});
const OUTLINE_COLOR = 'rgba(0, 0, 0, 0.7)';

/** A CSS hex colour (`#rrggbb`) at `alpha`, as the draw port reads colours. */
function withAlpha(hex, alpha) {
  const value = Number.parseInt(String(hex).slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha * 255];
}
const WINDOW_LABELS = Object.freeze({
  7: msg('7 days'),
  30: msg('30 days'),
  90: msg('90 days'),
  365: msg('1 year'),
});

/**
 * Madison (AL) Police Department incidents from the weekly reports, one
 * marker per block, colored by the block's most common kind of offense.
 */
export function createCrimeLayer({
  source,
  overlayHost = null,
  // `(viewer, onClick) => unsubscribe`: ambient clicks over the globe, each
  // with `hit`, the contract hit under it (on a coarse pointer, the nearest
  // registered contact; src/input/dispatcher.js).
  subscribeClick = null,
  picking = null,
  pointer = null,
  followUpMs = 30_000,
} = {}) {
  if (typeof source?.getIncidents !== 'function')
    throw new TypeError('The crime layer requires an incident source');
  let viewer = null;
  let markers = null;
  let request = null;
  // While the server is still reading older weeks, look again soon rather
  // than at the next 15-minute poll.
  let followUp = null;
  let enabled = false;
  let days = DEFAULT_CRIME_WINDOW_DAYS;
  const categories = new Set(CRIME_CATEGORIES.map(({ id }) => id));
  let snapshot = null;
  let groups = new Map();
  let lastUpdate = null;
  let lastError = null;
  let stale = false;
  let unsubscribeClick = null;
  let selectedKey = null;
  let rowControlsListener = null;

  const canSelect = () => Boolean(overlayHost && subscribeClick && picking);
  const notifyRow = () => rowControlsListener?.();

  function publishCard() {
    if (!canSelect()) return;
    const group = selectedKey ? groups.get(selectedKey) : null;
    if (!group) {
      selectedKey = null;
      overlayHost.setEntries(CRIME_OVERLAY_SOURCE_ID, [], CARD_HOST_OPTIONS);
      return;
    }
    overlayHost.setEntries(
      CRIME_OVERLAY_SOURCE_ID,
      [
        {
          ...buildCrimeCard(group),
          position: fromDegrees(group.lon, group.lat),
        },
      ],
      CARD_HOST_OPTIONS,
    );
  }

  const requestRender = () => {
    if (viewer) findFrame(viewer)?.requestRender(LAYER_ID);
  };

  function render() {
    if (!markers) return;
    const next = groupCrimeLocations(snapshot?.incidents || [], categories);
    groups = new Map(next.map((group) => [group.key, group]));
    // Smaller blocks last, so a busy block never hides a quiet neighbour.
    markers.set(
      next
        .sort((a, b) => b.incidents.length - a.incidents.length)
        .map((group) => ({
          id: `${PICK_PREFIX}${group.key}`,
          pos: fromDegrees(group.lon, group.lat),
          height: 'clampGround',
          disableDepthTest: DEPTH_TEST_DISTANCE_M,
          pixelSize: crimeMarkerPixels(group.incidents.length),
          color: withAlpha(crimeCategory(group.category).color, 0.85),
          outlineColor: OUTLINE_COLOR,
          outlineWidth: 1.5,
          scaleByDistance: SCALE_BY_DISTANCE,
        })),
    );
    requestRender();
    if (selectedKey) publishCard();
  }

  function pickedKey(picked) {
    const pickId = picking.resolvePickId(picked);
    if (typeof pickId !== 'string' || !pickId.startsWith(PICK_PREFIX))
      return null;
    const key = pickId.slice(PICK_PREFIX.length);
    return groups.has(key) ? key : null;
  }

  function installClickHandler() {
    if (!canSelect() || unsubscribeClick || !viewer) return;
    picking.registerPickOwner?.(LAYER_ID, (id) =>
      String(id).startsWith(PICK_PREFIX),
    );
    unsubscribeClick = subscribeClick(viewer, (click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const picked = click.hit;
      const key = picked ? pickedKey(picked) : null;
      if (key) {
        selectedKey = key;
        publishCard();
        return;
      }
      if (picked) {
        const pickId = picking.resolvePickId(picked);
        if (pickId && picking.isOwnedByOtherLayer(LAYER_ID, pickId)) return;
      }
      if (selectedKey) {
        selectedKey = null;
        publishCard();
      }
    });
  }

  function removeClickHandler() {
    unsubscribeClick?.();
    unsubscribeClick = null;
    picking?.unregisterPickOwner?.(LAYER_ID);
  }

  function clearSelection() {
    selectedKey = null;
    overlayHost?.clearSource(CRIME_OVERLAY_SOURCE_ID);
    overlayHost?.setVisible?.(CRIME_OVERLAY_SOURCE_ID, false);
  }

  function setWindow(next) {
    if (!CRIME_WINDOW_DAYS.includes(next) || next === days) return;
    days = next;
    notifyRow();
    void layer.update();
  }

  function toggleCategory(id) {
    if (categories.has(id)) {
      // Keep at least one kind on: an empty map reads as "no crime".
      if (categories.size === 1) return;
      categories.delete(id);
    } else categories.add(id);
    render();
    notifyRow();
  }

  const layer = {
    id: LAYER_ID,
    name: 'Crime Reports',
    icon: '🚨',
    source: 'Madison PD',
    updateInterval: 15 * 60 * 1000,

    init(nextViewer, { panel = null } = {}) {
      if (viewer) throw new Error('The crime layer is already initialized');
      // The panels' handle: invalidated when the row or readout changed.
      rowControlsListener = panel ? () => panel.invalidate() : null;
      viewer = nextViewer;
      markers = drawOf(viewer).points({ id: SET_ID, show: false });
    },

    enable() {
      enabled = true;
      if (markers) markers.show = true;
      requestRender();
      overlayHost?.setVisible?.(CRIME_OVERLAY_SOURCE_ID, true);
      installClickHandler();
    },

    disable() {
      clearTimeout(followUp);
      followUp = null;
      request?.abort();
      request = null;
      enabled = false;
      if (markers) markers.show = false;
      requestRender();
      removeClickHandler();
      clearSelection();
    },

    async update() {
      if (!enabled || !markers) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const next = await source.getIncidents({
          days,
          signal: controller.signal,
        });
        if (controller.signal.aborted || request !== controller || !enabled)
          return false;
        snapshot = next;
        stale = next.stale;
        lastUpdate = Date.now();
        lastError = null;
        render();
        notifyRow();
        clearTimeout(followUp);
        followUp = next.complete
          ? null
          : setTimeout(() => {
              followUp = null;
              void layer.update();
            }, followUpMs);
        return true;
      } catch (error) {
        if (controller.signal.aborted || request !== controller || !enabled)
          return false;
        console.warn('[Data:Crime] Fetch error:', error);
        lastError = error?.message || msg('Crime reports unavailable');
        stale = false;
        notifyRow();
        // A feed that is down keeps the layer on: its row shows the error and
        // the next interval retries.
        return true;
      } finally {
        if (request === controller) request = null;
      }
    },

    destroy() {
      clearTimeout(followUp);
      followUp = null;
      request?.abort();
      request = null;
      removeClickHandler();
      clearSelection();
      markers?.dispose();
      markers = null;
      viewer = null;
      enabled = false;
      snapshot = null;
      groups = new Map();
      lastUpdate = null;
      lastError = null;
      stale = false;
    },

    /** Mapped cases in the current window and kinds, for the analyst. */
    getAnalystRecords(maxCount = 2000) {
      if (!enabled || !snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const records = [];
      for (const incident of snapshot.incidents) {
        if (records.length >= limit) break;
        if (!categories.has(incident.category)) continue;
        records.push({
          id: incident.id,
          lat: incident.lat,
          lon: incident.lon,
          category: incident.category,
          offenses: incident.offenses,
          location: titleCaseLocation(incident.location),
          reportedAt: new Date(incident.t).toISOString(),
        });
      }
      return records;
    },

    getRowControls() {
      const counts = {};
      for (const incident of snapshot?.incidents || [])
        counts[incident.category] = (counts[incident.category] || 0) + 1;
      const info = [];
      if (snapshot?.through)
        info.push(
          t('Reports through {date}', {
            date: formatDate(snapshot.through, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'America/Chicago',
            }),
          }),
        );
      if (snapshot?.withheld)
        info.push(
          t('{count} withheld for privacy', {
            count: formatNumber(snapshot.withheld),
          }),
        );
      if (snapshot?.unmapped)
        info.push(
          t('{count} not mapped', { count: formatNumber(snapshot.unmapped) }),
        );
      if (snapshot && !snapshot.complete)
        info.push(t('older weeks still loading'));
      return {
        segmented: {
          id: 'window',
          label: t('Window'),
          ariaLabel: t('Report window'),
          options: CRIME_WINDOW_DAYS.map((value) => ({
            id: `window-${value}`,
            label: t(WINDOW_LABELS[value]),
            active: value === days,
            onClick: () => setWindow(value),
          })),
        },
        chips: CRIME_CATEGORIES.map(({ id }) => ({
          id: `category-${id}`,
          label: t(CRIME_CATEGORY_LABELS[id]).toUpperCase(),
          title: t('Show or hide this kind of offense'),
          active: categories.has(id),
          state: categories.has(id) ? 'active' : 'idle',
          onClick: () => toggleCategory(id),
        })),
        legend: CRIME_CATEGORIES.map(({ id, color }, index) => ({
          label: t(CRIME_CATEGORY_LABELS[id]),
          color,
          count: counts[id] || 0,
          ...(index === 0
            ? {
                blurb: t(
                  'Cases from the weekly Madison Police Department incident reports, placed at the block. A dot takes the color of its most common kind of case. Cases involving sex offenses, children, deaths or missing persons are not shown.',
                ),
              }
            : {}),
        })),
        info: info.join(' · '),
      };
    },

    getStats() {
      return {
        count: snapshot
          ? snapshot.incidents.filter((incident) =>
              categories.has(incident.category),
            ).length
          : 0,
        lastUpdate,
        error: lastError,
        stale,
      };
    },
  };
  return layer;
}
