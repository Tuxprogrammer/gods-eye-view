import {
  CATEGORY_COLORS,
  RADIUS_OPTIONS,
  TRACK_OPTIONS,
  UNIT_OPTIONS,
  WINDOW_OPTIONS,
} from './model.js';

const CATEGORY_LABELS = Object.freeze({
  weather: 'Weather',
  mobile: 'Mobile',
  fixed: 'Fixed',
  infrastructure: 'Digi/Gate',
  object: 'Objects',
  air: 'Air',
  marine: 'Marine',
});

const options = (list) => list.map(({ value, label }) => ({ value, label }));

/**
 * Row controls for the layer panel: how far, how recent and how long a track
 * to show (dropdowns), a callsign filter, the type toggles, and a legend that
 * counts what is drawn by marker colour.
 * @param {object} view Live state of the layer.
 * @param {object} actions Callbacks into the layer.
 */
export function aprsRowControls(view, actions) {
  const { settings, counts } = view;
  const toggle = (id, label, key, title) => ({
    id,
    label,
    title,
    active: Boolean(settings[key]),
    state: settings[key] ? 'active' : 'idle',
    onClick: () => actions.set({ [key]: !settings[key] }),
  });
  return {
    selects: [
      {
        id: 'radius',
        label: 'RADIUS',
        title:
          'Stations within this distance of the point under the view. Whole Earth shows every station on the near side of the planet.',
        value: settings.radius,
        options: options(RADIUS_OPTIONS),
        onChange: (value) => actions.set({ radius: value }),
      },
      {
        id: 'window',
        label: 'HEARD',
        title: 'Only stations heard within this long ago',
        value: settings.window,
        options: options(WINDOW_OPTIONS),
        onChange: (value) => actions.set({ window: value }),
      },
      {
        id: 'track',
        label: 'TRACK',
        title: 'How far back each moving station’s track is drawn',
        value: settings.track,
        options: options(TRACK_OPTIONS),
        onChange: (value) => actions.set({ track: value }),
      },
      {
        id: 'units',
        label: 'UNITS',
        value: settings.units,
        options: options(UNIT_OPTIONS),
        onChange: (value) => actions.set({ units: value }),
      },
    ],
    texts: [
      {
        id: 'call',
        label: 'CALL',
        title:
          'Show only these callsigns. Separate with commas; * matches any run of characters, e.g. W4*, KQ4VYY-9',
        placeholder: 'all stations · W4*, KQ4VYY-9',
        value: settings.callFilter,
        onCommit: (value) => actions.set({ callFilter: value }),
      },
    ],
    chips: [
      toggle(
        'toggle-weather',
        'WX ONLY',
        'weatherOnly',
        'Show only stations reporting weather',
      ),
      toggle(
        'toggle-moving',
        'MOVING',
        'movingOnly',
        'Show only stations that are moving',
      ),
      toggle(
        'toggle-objects',
        'OBJECTS',
        'objects',
        'Show objects and items: storm reports, repeaters, events and other things stations announce',
      ),
      toggle('toggle-labels', 'LABELS', 'labels', 'Print each callsign'),
      toggle(
        'toggle-popups',
        'MSG POPUPS',
        'popups',
        'Pop up messages sent by stations inside the radius, beside the sender, then fade them out',
      ),
    ],
    legend: Object.keys(CATEGORY_LABELS)
      .filter((key) => counts[key])
      .map((key) => ({
        label: CATEGORY_LABELS[key],
        color: CATEGORY_COLORS[key],
        count: counts[key],
      })),
  };
}
