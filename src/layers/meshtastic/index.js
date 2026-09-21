import * as Cesium from 'cesium';
import {
  MESHTASTIC_LAYER_ID,
  MESHTASTIC_REFRESH_MS,
  MESHTASTIC_STALE_AFTER_MS,
  MESSAGE_POLL_MS,
  cardModel,
  chartSeries,
  defaultSettings,
  messageLine,
  newMessages,
  nodesQuery,
  radiusOption,
  serversSummary,
  unitOption,
} from './model.js';
import { meshtasticRowControls } from './controls.js';
import { createMeshtasticSurface } from './rendering.js';
import { createStationInteraction as defaultInteraction } from '../aprs/interaction.js';
import { createMessagePopups as defaultPopups } from '../aprs/popups.js';
import { heatmapClassificationType } from '../propagation/surface.js';
export * from './model.js';
export { createMeshtasticSource } from './source.js';

/** A pan must move this fraction of the radius before the view is re-queried. */
const RECENTER_FRACTION = 0.15;
const RECENTER_MIN_KM = 5;
const MOVE_DEBOUNCE_MS = 700;
const SETTINGS_DEBOUNCE_MS = 250;
/** A burst of messages shows only the newest few, not a wall of bubbles. */
const MAX_POPUPS_PER_POLL = 3;
const FLY_RANGE_NEAR_M = 1500;
const FLY_RANGE_FAR_M = 30_000;

const toDegrees = (radians) => Cesium.Math.toDegrees(radians);

/**
 * Meshtastic on the globe: every node heard in the last day over MQTT (the
 * server keeps a 24-hour database), shown by radius, recency and role, with
 * tracks, telemetry, and pop-ups for text messages sent nearby.
 *
 * The browser only reads and edits the server list; the server holds the MQTT
 * connections whether or not this layer is on. While the layer is off nothing
 * is requested.
 */
export function createMeshtasticLayer({
  source,
  mapStackEventTarget = null,
  visibilityTarget = typeof document !== 'undefined' ? document : null,
  now = Date.now,
  createSurface = createMeshtasticSurface,
  createInteraction = defaultInteraction,
  createPopups = defaultPopups,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
} = {}) {
  if (typeof source?.getNodes !== 'function')
    throw new TypeError('Meshtastic requires a node source');

  let _viewer = null;
  let _surface = null;
  let _interaction = null;
  let _popups = null;
  let _enabled = false;
  const _settings = defaultSettings();
  let _data = null;
  let _servers = [];
  let _lastError = null;
  let _serverError = null;
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
  function viewCenter() {
    const camera = _viewer?.camera;
    const canvas = _viewer?.scene?.canvas;
    if (!camera) return { lat: 0, lon: 0 };
    let cartographic = null;
    if (canvas) {
      const hit = camera.pickEllipsoid(
        new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
        _viewer.scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84,
      );
      if (hit) cartographic = Cesium.Cartographic.fromCartesian(hit);
    }
    cartographic ??= camera.positionCartographic;
    return {
      lat: toDegrees(cartographic.latitude),
      lon: toDegrees(cartographic.longitude),
    };
  }

  function kmBetween(a, b) {
    const p = Cesium.Cartographic.fromDegrees(a.lon, a.lat);
    const q = Cesium.Cartographic.fromDegrees(b.lon, b.lat);
    return new Cesium.EllipsoidGeodesic(p, q).surfaceDistance / 1000;
  }

  async function refresh() {
    if (!_enabled) return false;
    _request?.abort();
    const request = new AbortController();
    _request = request;
    _loading = true;
    notify();
    const center = viewCenter();
    try {
      const payload = await source.getNodes(nodesQuery(_settings, center), {
        signal: request.signal,
      });
      if (request.signal.aborted || !_enabled) return false;
      _data = payload;
      _servers = payload.servers;
      _lastCenter = center;
      _lastFetchAt = now();
      _lastError = null;
      _hiddenPending = false;
      _surface?.show(payload.nodes, payload.tracks);
      _interaction?.refresh();
      return true;
    } catch (error) {
      if (request.signal.aborted || !_enabled) return false;
      console.warn('[Data:Meshtastic] Fetch error:', error);
      _lastError = error?.message || 'Meshtastic unavailable';
      if (error?.servers?.length) _servers = error.servers;
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

  const radiusKm = () => radiusOption(_settings.radius).km;

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
    const params = new URLSearchParams(nodesQuery(_settings, viewCenter()));
    for (const key of ['trackMin', 'moving', 'q']) params.delete(key);
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
          console.warn('[Data:Meshtastic] Message poll error:', error);
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
    if (changed('radius', 'window', 'track', 'filter', 'movingOnly')) {
      if (_settingsTimer !== null) clearTimer(_settingsTimer);
      _settingsTimer = setTimer(() => {
        _settingsTimer = null;
        refreshSoon();
      }, SETTINGS_DEBOUNCE_MS);
    }
    notify();
  }

  // -- MQTT servers ---------------------------------------------------------

  /**
   * Run a server-list edit; the server answers with the refreshed list. A
   * failure is shown, not thrown at the panel, except for the add form which
   * shows it beside its own fields.
   */
  async function editServers(action, { rethrow = false } = {}) {
    _serverError = null;
    try {
      _servers = await action();
      // Stored nodes come and go with the servers, and so does what is "now".
      startMessages();
      refreshSoon();
    } catch (error) {
      _serverError = error?.message || 'Could not update the server list';
      if (error?.servers?.length) _servers = error.servers;
      if (rethrow) throw error;
    } finally {
      notify();
    }
  }

  const serverActions = {
    toggleServer(id) {
      const server = _servers.find((entry) => entry.id === id);
      if (!server) return Promise.resolve();
      return editServers(() =>
        source.updateServer(id, { enabled: !server.enabled }),
      );
    },
    setServerTopic(id, topic) {
      const server = _servers.find((entry) => entry.id === id);
      if (!server || server.topic === String(topic).trim())
        return Promise.resolve();
      return editServers(() => source.updateServer(id, { topic }));
    },
    removeServer(id) {
      return editServers(() => source.removeServer(id));
    },
    addServer(fields) {
      return editServers(() => source.addServer(fields), { rethrow: true });
    },
  };

  function flyTo(id, near) {
    const record = _surface?.recordFor(id);
    if (!record || !_viewer) return;
    const { lon, lat } = record.station;
    _viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat), 1),
      {
        duration: 1.6,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(near ? -35 : -70),
          near ? FLY_RANGE_NEAR_M : FLY_RANGE_FAR_M,
        ),
      },
    );
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
    id: MESHTASTIC_LAYER_ID,
    name: 'Meshtastic',
    icon: '📶',
    source: 'Meshtastic MQTT',
    updateInterval: MESHTASTIC_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Meshtastic layer is already initialized');
      _viewer = viewer;
      _surface = createSurface({
        viewer,
        classificationType: heatmapClassificationType(viewer.scene),
      });
      _interaction = createInteraction({
        viewer,
        surface: _surface,
        units: () => _settings.units,
        loadDetail: (id, signal) => source.getNode(id, { signal }),
        flyTo,
        cardModel,
        chartSeries,
        noun: 'Meshtastic node',
        logTag: 'Meshtastic',
        messageLine,
        now,
      });
      _popups = createPopups({ viewer, surface: _surface });
      _enabled = false;
      console.log('[Data:Meshtastic] Initialized');
    },

    enable() {
      _enabled = true;
      _lastError = null;
      _surface?.setLabels(_settings.labels);
      if (_viewer?.camera?.moveEnd?.addEventListener)
        _cameraRemovers.push(
          _viewer.camera.moveEnd.addEventListener(onCameraSettled),
        );
      if (mapStackEventTarget && !_stackListener) {
        _stackListener = (event) =>
          _surface?.setClassification(
            heatmapClassificationType(_viewer?.scene, event?.detail?.activeId),
          );
        mapStackEventTarget.addEventListener(
          'gev:map-stack-changed',
          _stackListener,
        );
      }
      if (visibilityTarget?.addEventListener && !_visibilityListener) {
        _visibilityListener = () => {
          if (!_enabled || hidden()) return;
          if (_hiddenPending || now() - _lastFetchAt >= MESHTASTIC_REFRESH_MS)
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
      const ok = await refresh();
      return ok || !_lastError;
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
      const controls = meshtasticRowControls(
        {
          settings: _settings,
          counts: _surface?.categoryCounts() ?? {},
          servers: _servers,
          now: now(),
        },
        { set, ...serverActions },
      );
      controls.servers.error = _serverError;
      return controls;
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getStats() {
      const count = _data?.nodes.length ?? 0;
      const anyOn = _servers.some((server) => server.enabled);
      const live = _servers.filter((server) => server.status === 'live');
      const quiet =
        live.length > 0 &&
        live.every(
          (server) =>
            server.lastMessageAt === null ||
            now() - server.lastMessageAt > MESHTASTIC_STALE_AFTER_MS,
        );
      const truncated = Boolean(_data?.truncated);
      return {
        count,
        countLabel: truncated ? `${count} of ${_data.total}` : '',
        lastUpdate: _data ? _data.generatedAt : null,
        stale: Boolean(anyOn && quiet),
        loading: _loading && !_data,
        error: _lastError,
        source: serversSummary(_servers, now()),
        status: _lastError && !_data ? 'unavailable' : 'ok',
      };
    },
  };
  return layer;
}
