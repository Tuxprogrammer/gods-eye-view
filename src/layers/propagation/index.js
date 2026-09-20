import {
  DEFAULT_PROPAGATION_FIELD,
  DEFAULT_PROPAGATION_OPACITY,
  DEFAULT_SHOW_CONTOURS,
  DEFAULT_SHOW_STATIONS,
  PROPAGATION_LAYER_ID,
  PROPAGATION_REFRESH_MS,
  PROPAGATION_STALE_AFTER_MS,
  clampOpacity,
  propagationField,
  stationsForField,
} from './model.js';
import { propagationRowControls } from './controls.js';
import {
  createContourSurface as defaultContourSurface,
  createHeatmapSurface,
  createStationSurface as defaultStationSurface,
  prepareHeatmap,
} from './rendering.js';
import { createStationInteraction as defaultStationInteraction } from './stationInteraction.js';
import {
  classificationUsesTiles,
  heatmapClassificationType,
} from './surface.js';
import {
  HEATMAP_TILESET_ENGAGE_HEIGHT_M,
  HEATMAP_TILESET_RELEASE_HEIGHT_M,
  createTilesetQualityGuard,
} from './tilesetQuality.js';
export * from './model.js';
export { createPropagationSource } from './source.js';

/**
 * One HF propagation heatmap draped on the surface, selectable between maps,
 * with optional contour rings and measured-station bubbles for the active map.
 *
 * Demand-driven: nothing is requested while the layer is off, and a periodic
 * refresh is skipped while the page is hidden (one catch-up fetch runs when it
 * becomes visible again). The server, in turn, only contacts the upstream when
 * asked and caches between clients.
 */
export function createPropagationLayer({
  source,
  mapStackEventTarget = null,
  visibilityTarget = typeof document !== 'undefined' ? document : null,
  now = Date.now,
  prepare = prepareHeatmap,
  createSurface = createHeatmapSurface,
  createContourSurface = defaultContourSurface,
  createStationSurface = defaultStationSurface,
  createStationInteraction = defaultStationInteraction,
  createQualityGuard = createTilesetQualityGuard,
} = {}) {
  if (typeof source?.getMap !== 'function')
    throw new TypeError('Propagation requires a map source');

  let _viewer = null;
  let _surface = null;
  let _contourSurface = null;
  let _stationSurface = null;
  let _stationInteraction = null;
  let _quality = null;
  let _classification = null;
  let _cameraRemovers = [];
  let _enabled = false;
  let _activeField = DEFAULT_PROPAGATION_FIELD;
  const _opacity = new Map();
  /** field id -> {payload, gradient, canvas}; released whenever the layer is off. */
  const _prepared = new Map();
  /** field id -> normalized contour payload; only while rings are switched on. */
  const _contours = new Map();
  /** Normalized station payload; only while bubbles are switched on. */
  let _stationData = null;
  let _showContours = DEFAULT_SHOW_CONTOURS;
  let _showStations = DEFAULT_SHOW_STATIONS;
  let _contourRequest = null;
  let _stationRequest = null;
  let _contourLoading = false;
  let _stationLoading = false;
  let _contourError = null;
  let _stationError = null;
  let _request = null;
  let _loadingField = null;
  let _lastError = null;
  let _hiddenPending = false;
  let _lastFetchAt = 0;
  let _rowControlsListener = null;
  let _stackListener = null;
  let _visibilityListener = null;

  const opacityFor = (field) =>
    _opacity.get(field) ?? DEFAULT_PROPAGATION_OPACITY;
  const notify = () => _rowControlsListener?.();
  const hidden = () => Boolean(visibilityTarget?.hidden);

  function applyActive() {
    const prepared = _prepared.get(_activeField);
    if (!_surface || !prepared) return;
    _surface.show(prepared, opacityFor(_activeField));
  }

  function applyContours() {
    const held = _showContours ? _contours.get(_activeField) : null;
    if (held) _contourSurface?.show(held);
    else _contourSurface?.clear();
  }

  /** Bubbles are coloured on the ACTIVE map's scale, so they need its stops. */
  function applyStations() {
    const prepared = _prepared.get(_activeField);
    const list =
      _showStations && _stationData && prepared?.stops
        ? stationsForField(_stationData.stations, _activeField, now())
        : [];
    if (!list.length) {
      _stationSurface?.clear();
      _stationInteraction?.refresh();
      return;
    }
    _stationSurface?.show(list, {
      field: _activeField,
      unit: prepared.payload.unit,
      stops: prepared.stops,
      range: prepared.payload.range,
      now: now(),
    });
    _stationInteraction?.refresh();
  }

  /** Fetch the contour rings for `field`. Never throws; failure stays here. */
  async function loadContours(field) {
    if (!_enabled || !_showContours) return true;
    _contourRequest?.abort();
    const request = new AbortController();
    _contourRequest = request;
    _contourLoading = true;
    notify();
    try {
      const payload = await source.getContours(field, {
        signal: request.signal,
      });
      if (
        request.signal.aborted ||
        !_enabled ||
        !_showContours ||
        field !== _activeField
      )
        return false;
      const held = _contours.get(field);
      _contours.set(field, payload);
      _contourError = null;
      // The same ring set again needs no redraw of thousands of vertices.
      if (!held || held.generatedAt !== payload.generatedAt) applyContours();
      return true;
    } catch (error) {
      if (request.signal.aborted || !_enabled) return false;
      console.warn('[Data:Propagation] Contour fetch error:', error);
      _contourError = error?.message || 'Contours unavailable';
      return false;
    } finally {
      if (_contourRequest === request) {
        _contourRequest = null;
        _contourLoading = false;
      }
      notify();
    }
  }

  /** Fetch the reporting stations. Never throws; failure stays here. */
  async function loadStations() {
    if (!_enabled || !_showStations) return true;
    _stationRequest?.abort();
    const request = new AbortController();
    _stationRequest = request;
    _stationLoading = true;
    notify();
    try {
      const payload = await source.getStations({ signal: request.signal });
      if (request.signal.aborted || !_enabled || !_showStations) return false;
      const held = _stationData;
      _stationData = payload;
      _stationError = null;
      if (!held || held.generatedAt !== payload.generatedAt) applyStations();
      return true;
    } catch (error) {
      if (request.signal.aborted || !_enabled) return false;
      console.warn('[Data:Propagation] Station fetch error:', error);
      _stationError = error?.message || 'Stations unavailable';
      return false;
    } finally {
      if (_stationRequest === request) {
        _stationRequest = null;
        _stationLoading = false;
      }
      notify();
    }
  }

  /** Fetch the map for `field` and show it if it is still the active one. */
  async function load(field) {
    _request?.abort();
    const request = new AbortController();
    _request = request;
    _loadingField = field;
    notify();
    try {
      const payload = await source.getMap(field, { signal: request.signal });
      if (request.signal.aborted || !_enabled || field !== _activeField)
        return false;
      const held = _prepared.get(field);
      let changed = false;
      if (held && held.payload.generatedAt === payload.generatedAt) {
        // Same map again (the server answered from cache): keep the decoded
        // raster, and only track the freshness flag.
        held.payload = payload;
      } else {
        const { canvas, gradient, stops } = await prepare(payload);
        if (request.signal.aborted || !_enabled || field !== _activeField)
          return false;
        _prepared.set(field, { payload, canvas, gradient, stops });
        changed = true;
      }
      _lastFetchAt = now();
      _lastError = null;
      _hiddenPending = false;
      if (changed) {
        applyActive();
        applyStations();
      }
      return true;
    } catch (error) {
      if (request.signal.aborted || !_enabled) return false;
      console.warn('[Data:Propagation] Fetch error:', error);
      _lastError = error?.message || 'Propagation map unavailable';
      return false;
    } finally {
      if (_request === request) {
        _request = null;
        _loadingField = null;
      }
      notify();
    }
  }

  /** Map plus whichever overlays are on, in parallel; the map decides success. */
  async function refreshAll(field) {
    const [ok] = await Promise.all([
      load(field),
      loadContours(field),
      loadStations(),
    ]);
    return ok;
  }

  function selectField(id) {
    if (!propagationField(id) || id === _activeField) return;
    _request?.abort();
    _contourRequest?.abort();
    _activeField = id;
    _lastError = null;
    _contourError = null;
    // A map already held for this field shows immediately; either way the
    // server is asked again, which answers from its cache when nothing is new.
    if (_prepared.has(id)) applyActive();
    else _surface?.clear();
    // Rings belong to one map, and bubbles are coloured on its scale.
    applyContours();
    applyStations();
    notify();
    if (_enabled && !hidden()) void refreshAll(id);
    else if (_enabled) _hiddenPending = true;
  }

  function setOpacity(value) {
    const opacity = clampOpacity(value);
    _opacity.set(_activeField, opacity);
    _surface?.setOpacity(opacity);
    notify();
  }

  function setContours(on) {
    const next = Boolean(on);
    if (next === _showContours) return;
    _showContours = next;
    if (!next) {
      // Off means nothing is fetched or held for it.
      _contourRequest?.abort();
      _contourRequest = null;
      _contourLoading = false;
      _contourError = null;
      _contours.clear();
      applyContours();
    } else if (_enabled) {
      if (hidden()) _hiddenPending = true;
      else void loadContours(_activeField);
    }
    notify();
  }

  function setStations(on) {
    const next = Boolean(on);
    if (next === _showStations) return;
    _showStations = next;
    if (!next) {
      _stationRequest?.abort();
      _stationRequest = null;
      _stationLoading = false;
      _stationError = null;
      _stationData = null;
      applyStations();
    } else if (_enabled) {
      if (hidden()) _hiddenPending = true;
      else void loadStations();
    }
    notify();
  }

  /**
   * Photoreal classification needs fine tiles, but only from high up; globe
   * stacks never do. Called on enable, stack change and camera movement.
   */
  function syncTileQuality() {
    if (!_quality) return;
    const height = _viewer?.camera?.positionCartographic?.height;
    const limit = _quality.active
      ? HEATMAP_TILESET_RELEASE_HEIGHT_M
      : HEATMAP_TILESET_ENGAGE_HEIGHT_M;
    const tighten =
      _enabled &&
      classificationUsesTiles(_classification) &&
      (Number.isFinite(height) ? height >= limit : true);
    if (tighten) _quality.apply();
    else _quality.restore();
  }

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
    _loadingField = null;
    _contourRequest?.abort();
    _contourRequest = null;
    _stationRequest?.abort();
    _stationRequest = null;
    _contourLoading = false;
    _stationLoading = false;
    _contourError = null;
    _stationError = null;
    _hiddenPending = false;
    _surface?.clear();
    _contourSurface?.clear();
    _stationSurface?.clear();
    _stationInteraction?.hide();
    // Decoded rasters are large; a layer that is off holds none of them.
    _prepared.clear();
    _contours.clear();
    _stationData = null;
  }

  const layer = {
    id: PROPAGATION_LAYER_ID,
    name: 'HF Propagation',
    icon: '📡',
    source: 'GIRO ionosondes · kc2g',
    updateInterval: PROPAGATION_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Propagation layer is already initialized');
      _viewer = viewer;
      _surface = createSurface({
        viewer,
        classificationType: heatmapClassificationType(viewer.scene),
      });
      _contourSurface = createContourSurface({
        viewer,
        classificationType: heatmapClassificationType(viewer.scene),
      });
      _stationSurface = createStationSurface({ viewer });
      _stationInteraction = createStationInteraction({
        viewer,
        surface: _stationSurface,
        now,
      });
      _quality = createQualityGuard({ scene: viewer.scene });
      _enabled = false;
      console.log('[Data:Propagation] Initialized');
    },

    enable() {
      _enabled = true;
      _lastError = null;
      _classification = heatmapClassificationType(_viewer?.scene);
      if (_viewer?.camera && !_cameraRemovers.length) {
        for (const event of [_viewer.camera.changed, _viewer.camera.moveEnd])
          if (event?.addEventListener)
            _cameraRemovers.push(event.addEventListener(syncTileQuality));
      }
      syncTileQuality();
      if (mapStackEventTarget && !_stackListener) {
        _stackListener = (event) => {
          const type = heatmapClassificationType(
            _viewer?.scene,
            event?.detail?.activeId,
          );
          _classification = type;
          _surface?.setClassification(type);
          _contourSurface?.setClassification(type);
          syncTileQuality();
        };
        mapStackEventTarget.addEventListener(
          'gev:map-stack-changed',
          _stackListener,
        );
      }
      if (visibilityTarget?.addEventListener && !_visibilityListener) {
        _visibilityListener = () => {
          if (!_enabled || hidden()) return;
          // Catch up once on return, instead of having polled while unseen.
          if (_hiddenPending || now() - _lastFetchAt >= PROPAGATION_REFRESH_MS)
            void refreshAll(_activeField);
        };
        visibilityTarget.addEventListener(
          'visibilitychange',
          _visibilityListener,
        );
      }
    },

    disable() {
      _enabled = false;
      _quality?.restore();
      releaseListeners();
      release();
      _lastError = null;
      notify();
    },

    async update() {
      if (!_enabled) return false;
      // Nobody is looking at the page: do not ask for a map.
      if (hidden()) {
        _hiddenPending = true;
        return true;
      }
      const ok = await refreshAll(_activeField);
      // A superseded request (field switched, layer turned off) is not a failure.
      return ok || !_lastError;
    },

    destroy() {
      _enabled = false;
      _quality?.restore();
      _quality = null;
      releaseListeners();
      release();
      _prepared.clear();
      _surface?.destroy();
      _surface = null;
      _contourSurface?.destroy();
      _contourSurface = null;
      _stationInteraction?.destroy();
      _stationInteraction = null;
      _stationSurface?.destroy();
      _stationSurface = null;
      _viewer = null;
      _rowControlsListener = null;
    },

    getRowControls() {
      const prepared = _prepared.get(_activeField) ?? null;
      return propagationRowControls(
        {
          activeField: _activeField,
          loadingField: _loadingField,
          prepared: prepared && {
            payload: prepared.payload,
            gradient: prepared.gradient,
          },
          opacity: opacityFor(_activeField),
          contours: {
            on: _showContours,
            loading: _contourLoading,
            error: _contourError,
            lines: _contours.get(_activeField)?.lines.length ?? null,
          },
          stations: {
            on: _showStations,
            loading: _stationLoading,
            error: _stationError,
            count: _stationData
              ? stationsForField(_stationData.stations, _activeField, now())
                  .length
              : null,
          },
        },
        { selectField, setOpacity, setContours, setStations },
      );
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getStats() {
      const prepared = _prepared.get(_activeField) ?? null;
      const payload = prepared?.payload ?? null;
      const field = propagationField(_activeField);
      const old =
        payload && now() - payload.generatedAt > PROPAGATION_STALE_AFTER_MS;
      return {
        count: payload ? 1 : 0,
        countLabel: payload ? field.chip : '',
        // The map's own generation time, so the row reads as the map's age.
        lastUpdate: payload ? payload.generatedAt : null,
        stale: Boolean(payload && (payload.stale || old)),
        loading: _loadingField !== null && !payload,
        error: _lastError,
        status: _lastError && !payload ? 'unavailable' : 'ok',
      };
    },
  };
  return layer;
}
