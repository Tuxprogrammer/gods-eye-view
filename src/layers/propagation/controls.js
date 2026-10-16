import { t, tn } from '../../i18n/index.js';
import { PROPAGATION_FIELDS, formatRangeValue, thinTicks } from './model.js';

/** Chip state for an overlay toggle: it must never read ON before its data exists. */
function overlayState({ on, loading, error }, held) {
  if (!on) return 'idle';
  if (error && !held) return 'error';
  if (loading && !held) return 'loading';
  return 'active';
}

/**
 * Row controls for the layer panel: the map selector (exclusive), the overlay
 * toggles (independent), then the colour scale and opacity for the ACTIVE map
 * only. The panel hides the whole block while the layer is off, so nothing here
 * shows for an inactive layer.
 * @param {object} view Live state of the layer.
 * @param {object} actions Callbacks into the layer.
 */
export function propagationRowControls(view, actions) {
  const { activeField, loadingField, prepared, opacity } = view;
  const contours = view.contours ?? {
    on: false,
    loading: false,
    error: null,
    lines: null,
  };
  const stations = view.stations ?? {
    on: false,
    loading: false,
    error: null,
    count: null,
  };
  const chips = PROPAGATION_FIELDS.map((field) => {
    const active = field.id === activeField;
    const loading = active && loadingField === field.id && !prepared;
    return {
      id: `field-${field.id}`,
      label: field.chip,
      title: t(field.title),
      active,
      state: loading ? 'loading' : active ? 'active' : 'idle',
      busy: loading,
      onClick: () => actions.selectField(field.id),
    };
  });

  const ringsHeld = contours.lines !== null;
  const ringsState = overlayState(contours, ringsHeld);
  chips.push({
    id: 'toggle-contours',
    label: t('RINGS'),
    breakBefore: true,
    active: contours.on,
    state: ringsState,
    busy: ringsState === 'loading',
    title: contours.error
      ? t('Contour rings unavailable: {error}', { error: contours.error })
      : contours.on
        ? ringsHeld
          ? tn(
              contours.lines,
              '{count} contour line marks where the map crosses each labelled value. Click to hide.',
              '{count} contour lines mark where the map crosses each labelled value. Click to hide.',
            )
          : t('Loading contour rings…')
        : t('Show contour rings: lines that encircle the same value'),
    onClick: () => actions.setContours(!contours.on),
  });
  const stationsHeld = stations.count !== null;
  const stationsState = overlayState(stations, stationsHeld);
  chips.push({
    id: 'toggle-stations',
    label: t('STATIONS'),
    active: stations.on,
    state: stationsState,
    busy: stationsState === 'loading',
    title: stations.error
      ? t('Stations unavailable: {error}', { error: stations.error })
      : stations.on
        ? stationsHeld
          ? tn(
              stations.count,
              "{count} ionosonde reporting this quantity. Bubbles use the map's colour scale, so a bubble that matches the colour beneath it agrees with the model. Hover or click a bubble for its details; click here to hide.",
              "{count} ionosondes reporting this quantity. Bubbles use the map's colour scale, so a bubble that matches the colour beneath it agrees with the model. Hover or click a bubble for its details; click here to hide.",
            )
          : t('Loading ionosonde stations…')
        : t('Show the ionosondes whose measurements the map is built from'),
    onClick: () => actions.setStations(!stations.on),
  });

  const payload = prepared?.payload ?? null;
  const ramp =
    payload && prepared?.gradient
      ? {
          gradient: prepared.gradient,
          min: formatRangeValue(payload.range.min),
          max: formatRangeValue(payload.range.max),
          unit: payload.unit,
          caption: t('{label} · {unit} · {min}–{max} (log)', {
            label: payload.label,
            unit: payload.unit,
            min: formatRangeValue(payload.range.min),
            max: formatRangeValue(payload.range.max),
          }),
          ticks: thinTicks(payload.ticks),
        }
      : null;
  return {
    chips,
    legend: [],
    ramp,
    sliders: [
      {
        id: 'opacity',
        label: t('OPACITY'),
        min: 10,
        max: 100,
        step: 5,
        value: Math.round(opacity * 100),
        suffix: '%',
        onInput: (value) => actions.setOpacity(value / 100),
      },
    ],
  };
}
