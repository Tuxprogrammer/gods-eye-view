import { t } from '../../i18n/index.js';
import {
  APRS_LAYER_ID,
  APRS_REFRESH_MS,
  APRS_STALE_AFTER_MS,
  MESSAGE_POLL_MS,
  defaultSettings,
  feedSummary,
  newMessages,
  radiusOption,
  stationsQuery,
  unitOption,
} from './model.js';
import { aprsRowControls } from './controls.js';
import { createAprsSurface } from './rendering.js';
import { createStationInteraction as defaultInteraction } from './interaction.js';
import { createMessagePopups as defaultPopups } from './popups.js';
import { findCamera } from '../../render/rendererOf.js';
import {
  flyToStation,
  kmBetween,
  viewCenter as sceneViewCenter,
} from './scene.js';
import { heatmapClassificationType } from '../propagation/surface.js';
export * from './model.js';
export { createAprsSource } from './source.js';

/** A pan must move this fraction of the radius before the view is re-queried. */
const RECENTER_FRACTION = 0.15;
const RECENTER_MIN_KM = 5;
/** Wait for the camera to settle before asking again. */
const MOVE_DEBOUNCE_MS = 700;
/** Typing in the callsign filter should not query per keystroke. */
const SETTINGS_DEBOUNCE_MS = 250;
/** A burst of messages shows only the newest few, not a wall of bubbles. */
const MAX_POPUPS_PER_POLL = 3;

/**
 * APRS-IS on the globe: every station heard in the last day (the server keeps
 * a 24-hour database), shown by radius, recency and type, with tracks, weather,
 * and pop-ups for messages sent nearby.
 *
 * The browser only reads; the server is always connected to APRS-IS whether or
 * not this layer is on. While the layer is off nothing is requested.
 */
export function createAprsLayer({
  source,
  mapStackEventTarget = null,
  visibilityTarget = typeof document !== 'undefined' ? document : null,
  now = Date.now,
  // The world-overlay host station labels go to; none in tests.
  overlayHost = null,
  createSurface = createAprsSurface,
  createInteraction = defaultInteraction,
  createPopups = defaultPopups,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
} = {}) {
  if (typeof source?.getStations !== 'function')
    throw new TypeError('APRS requires a station source');

  let _viewer = null;
  let _surface = null;
  let _interaction = null;
  let _popups = null;
  let _enabled = false;
  const _settings = defaultSettings();
  let _data = null;
  let _feed = null;
  let _lastError = null;
  let _lastFetchAt = 0;
  let _lastCenter = null;
  let _request = null;
  let _loading = false;
  let _cursor = null;
  let _messageRequest = null;
  let _messageTimer = null;
  let _moveTimer = null;
  let _settingsTimer = null;
  let _hiddenPending = false;
  let _cameraRemovers = [];
  let _stackListener = null;
  let _visibilityListener = null;
  let _rowControlsListener = null;

  const notify = () => _rowControlsListener?.();
  const hidden = () => Boolean(visibilityTarget?.hidden);

  /** The point on the ground under the middle of the screen (or under the camera). */
  const viewCenter = () => sceneViewCenter(_viewer);

  async function refresh() {
    if (!_enabled) return false;
    _request?.abort();
    const request = new AbortController();
    _request = request;
    _loading = true;
    notify();
    const center = viewCenter();
    try {
      const payload = await source.getStations(
        stationsQuery(_settings, center),
        {
          signal: request.signal,
        },
      );
      if (request.signal.aborted || !_enabled) return false;
      _data = payload;
      _feed = payload.feed;
      _lastCenter = center;
      _lastFetchAt = now();
      _lastError = null;
      _hiddenPending = false;
      _surface?.show(payload.stations, payload.tracks);
      _interaction?.refresh();
      return true;
    } catch (error) {
      if (request.signal.aborted || !_enabled) return false;
      console.warn('[Data:APRS] Fetch error:', error);
      _lastError = error?.message || t('APRS unavailable');
      if (error?.feed) _feed = error.feed;
      return false;
    } finally {
      if (_request === request) {
        _request = null;
        _loading = false;
      }
      notify();
    }
  }

  /** Ask now, unless the page is hidden (then once, on return). */
  function refreshSoon() {
    if (!_enabled) return;
    if (hidden()) {
      _hiddenPending = true;
      return;
    }
    void refresh();
  }

  function radiusKm() {
    return radiusOption(_settings.radius).km;
  }

  /** The pan moved far enough, or the result was capped, that a re-query would differ. */
  function viewMovedEnough() {
    if (!_lastCenter) return true;
    const km = radiusKm();
    if (km === null) return Boolean(_data?.truncated);
    const moved = kmBetween(_lastCenter, viewCenter());
    return moved >= Math.max(RECENTER_MIN_KM, km * RECENTER_FRACTION);
  }

  function onCameraSettled() {
    if (!_enabled) return;
    if (_moveTimer !== null) clearTimer(_moveTimer);
    _moveTimer = setTimer(() => {
      _moveTimer = null;
      if (viewMovedEnough()) refreshSoon();
    }, MOVE_DEBOUNCE_MS);
  }

  // -- Messages -------------------------------------------------------------

  const messageQuery = () => {
    const params = new URLSearchParams(stationsQuery(_settings, viewCenter()));
    for (const key of ['trackMin', 'objects', 'wx', 'moving', 'call'])
      params.delete(key);
    params.set('windowMin', '10');
    return params.toString();
  };

  async function pollMessages() {
    _messageTimer = null;
    if (!_enabled || !_settings.popups) return;
    if (!hidden()) {
      _messageRequest?.abort();
      const request = new AbortController();
      _messageRequest = request;
      try {
        const payload = await source.getMessages(
          { after: _cursor, query: messageQuery() },
          { signal: request.signal },
        );
        if (!request.signal.aborted && _enabled && _settings.popups) {
          if (_cursor !== null) {
            for (const message of newMessages(payload.messages, _cursor).slice(
              -MAX_POPUPS_PER_POLL,
            ))
              _popups?.show(message);
          }
          _cursor = payload.cursor;
        }
      } catch (error) {
        if (!request.signal.aborted)
          console.warn('[Data:APRS] Message poll error:', error);
      } finally {
        if (_messageRequest === request) _messageRequest = null;
      }
    }
    scheduleMessages();
  }

  function scheduleMessages() {
    if (_messageTimer !== null || !_enabled || !_settings.popups) return;
    _messageTimer = setTimer(pollMessages, MESSAGE_POLL_MS);
  }

  function startMessages() {
    // The first poll only learns where "now" is; it never replays a backlog.
    _cursor = null;
    if (_messageTimer !== null) clearTimer(_messageTimer);
    _messageTimer = null;
    if (_enabled && _settings.popups) void pollMessages();
  }

  function stopMessages() {
    _messageRequest?.abort();
    _messageRequest = null;
    if (_messageTimer !== null) clearTimer(_messageTimer);
    _messageTimer = null;
    _popups?.clear();
  }

  // -- Settings -------------------------------------------------------------

  function set(patch) {
    const before = { ..._settings };
    for (const [key, value] of Object.entries(patch))
      if (key in _settings) _settings[key] = value;
    if (_settings.units !== unitOption(_settings.units).value)
      _settings.units = unitOption(_settings.units).value;
    const changed = (...keys) =>
      keys.some((key) => before[key] !== _settings[key]);
    if (changed('labels')) _surface?.setLabels(_settings.labels);
    if (changed('popups')) {
      if (_settings.popups) startMessages();
      else stopMessages();
    }
    if (changed('units')) _interaction?.refresh();
    if (
      changed(
        'radius',
        'window',
        'track',
        'callFilter',
        'objects',
        'weatherOnly',
        'movingOnly',
      )
    ) {
      if (_settingsTimer !== null) clearTimer(_settingsTimer);
      _settingsTimer = setTimer(() => {
        _settingsTimer = null;
        refreshSoon();
      }, SETTINGS_DEBOUNCE_MS);
    }
    notify();
  }

  function flyTo(id, near) {
    const record = _surface?.recordFor(id);
    if (!record || !_viewer) return;
    flyToStation(_viewer, record.station.lon, record.station.lat, near);
  }

  // -- Lifecycle ------------------------------------------------------------

  function releaseListeners() {
    for (const remove of _cameraRemovers.splice(0)) remove();
    if (_stackListener) {
      mapStackEventTarget?.removeEventListener?.(
        'gev:map-stack-changed',
        _stackListener,
      );
      _stackListener = null;
    }
    if (_visibilityListener) {
      visibilityTarget?.removeEventListener?.(
        'visibilitychange',
        _visibilityListener,
      );
      _visibilityListener = null;
    }
  }

  function release() {
    _request?.abort();
    _request = null;
    _loading = false;
    stopMessages();
    for (const timer of [_moveTimer, _settingsTimer])
      if (timer !== null) clearTimer(timer);
    _moveTimer = null;
    _settingsTimer = null;
    _surface?.clear();
    _interaction?.hide();
    _data = null;
    _lastCenter = null;
    _hiddenPending = false;
  }

  const layer = {
    id: APRS_LAYER_ID,
    name: 'APRS',
    icon: '📻',
    source: 'APRS-IS',
    updateInterval: APRS_REFRESH_MS,

    init(viewer, { panel = null } = {}) {
      if (_viewer) throw new Error('APRS layer is already initialized');
      // The panels' handle: invalidated when the row or readout changed.
      _rowControlsListener = panel ? () => panel.invalidate() : null;
      _viewer = viewer;
      _surface = createSurface({
        viewer,
        classificationType: heatmapClassificationType(viewer),
        overlayHost,
      });
      _interaction = createInteraction({
        viewer,
        surface: _surface,
        units: () => _settings.units,
        loadDetail: (id, signal) => source.getStation(id, { signal }),
        flyTo,
        now,
      });
      _popups = createPopups({ viewer, surface: _surface });
      _enabled = false;
      console.log('[Data:APRS] Initialized');
    },

    enable() {
      _enabled = true;
      _lastError = null;
      _surface?.setLabels(_settings.labels);
      const off = _viewer
        ? findCamera(_viewer)?.on('moveEnd', onCameraSettled)
        : null;
      if (off) _cameraRemovers.push(off);
      if (mapStackEventTarget && !_stackListener) {
        _stackListener = (event) =>
          _surface?.setClassification(
            heatmapClassificationType(_viewer, event?.detail?.activeId),
          );
        mapStackEventTarget.addEventListener(
          'gev:map-stack-changed',
          _stackListener,
        );
      }
      if (visibilityTarget?.addEventListener && !_visibilityListener) {
        _visibilityListener = () => {
          if (!_enabled || hidden()) return;
          if (_hiddenPending || now() - _lastFetchAt >= APRS_REFRESH_MS)
            refreshSoon();
        };
        visibilityTarget.addEventListener(
          'visibilitychange',
          _visibilityListener,
        );
      }
      startMessages();
      refreshSoon();
    },

    disable() {
      _enabled = false;
      releaseListeners();
      release();
      _lastError = null;
      notify();
    },

    async update() {
      if (!_enabled) return false;
      if (hidden()) {
        _hiddenPending = true;
        return true;
      }
      // A feed that is down keeps the layer on: its row shows the error and
      // the next interval retries. False only when the layer went off.
      await refresh();
      return _enabled;
    },

    destroy() {
      _enabled = false;
      releaseListeners();
      release();
      _interaction?.destroy();
      _interaction = null;
      _popups?.destroy();
      _popups = null;
      _surface?.destroy();
      _surface = null;
      _viewer = null;
      _rowControlsListener = null;
    },

    getRowControls() {
      return aprsRowControls(
        {
          settings: _settings,
          counts: _surface?.categoryCounts() ?? {},
        },
        { set },
      );
    },

    getStats() {
      const count = _data?.stations.length ?? 0;
      const feed = _feed;
      const feedDown =
        feed &&
        feed.status !== 'live' &&
        feed.status !== 'connecting' &&
        feed.status !== 'reconnecting' &&
        feed.status !== 'starting';
      const quiet =
        feed?.status === 'live' &&
        feed.lastPacketAt !== null &&
        now() - feed.lastPacketAt > APRS_STALE_AFTER_MS;
      const truncated = Boolean(_data?.truncated);
      return {
        count,
        countLabel: truncated ? `${count} of ${_data.total}` : '',
        lastUpdate: _data ? _data.generatedAt : null,
        stale: Boolean(quiet),
        loading: _loading && !_data,
        // A missing callsign or dead feed is the reason there is nothing to see.
        error: _lastError ?? (feedDown ? feedSummary(feed, now()) : null),
        source: feed ? feedSummary(feed, now()) : 'APRS-IS',
        status: _lastError && !_data ? 'unavailable' : 'ok',
      };
    },
  };
  return layer;
}
