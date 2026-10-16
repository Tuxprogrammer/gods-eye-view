import { msg, t } from '../../i18n/index.js';
import {
  CATEGORY_COLORS,
  RADIUS_OPTIONS,
  TRACK_OPTIONS,
  UNIT_OPTIONS,
  WINDOW_OPTIONS,
} from './model.js';

const CATEGORY_LABELS = Object.freeze({
  weather: msg('Weather'),
  mobile: msg('Mobile'),
  fixed: msg('Fixed'),
  infrastructure: msg('Digi/Gate'),
  object: msg('Objects'),
  air: msg('Air'),
  marine: msg('Marine'),
});

const options = (list) =>
  list.map(({ value, label }) => ({
    value,
    label: t(label),
  }));

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
        label: t('RADIUS'),
        title: t(
          'Stations within this distance of the point under the view. Whole Earth shows every station on the near side of the planet.',
        ),
        value: settings.radius,
        options: options(RADIUS_OPTIONS),
        onChange: (value) => actions.set({ radius: value }),
      },
      {
        id: 'window',
        label: t('HEARD'),
        title: t('Only stations heard within this long ago'),
        value: settings.window,
        options: options(WINDOW_OPTIONS),
        onChange: (value) => actions.set({ window: value }),
      },
      {
        id: 'track',
        label: t('TRACK'),
        title: t('How far back each moving station’s track is drawn'),
        value: settings.track,
        options: options(TRACK_OPTIONS),
        onChange: (value) => actions.set({ track: value }),
      },
      {
        id: 'units',
        label: t('UNITS'),
        value: settings.units,
        options: options(UNIT_OPTIONS),
        onChange: (value) => actions.set({ units: value }),
      },
    ],
    texts: [
      {
        id: 'call',
        label: t('CALL'),
        title: t(
          'Show only these callsigns. Separate with commas; * matches any run of characters, e.g. W4*, KQ4VYY-9',
        ),
        placeholder: t('all stations · W4*, KQ4VYY-9'),
        value: settings.callFilter,
        onCommit: (value) => actions.set({ callFilter: value }),
      },
    ],
    chips: [
      toggle(
        'toggle-weather',
        t('WX ONLY'),
        'weatherOnly',
        t('Show only stations reporting weather'),
      ),
      toggle(
        'toggle-moving',
        t('MOVING'),
        'movingOnly',
        t('Show only stations that are moving'),
      ),
      toggle(
        'toggle-objects',
        t('OBJECTS'),
        'objects',
        t(
          'Show objects and items: storm reports, repeaters, events and other things stations announce',
        ),
      ),
      toggle('toggle-labels', t('LABELS'), 'labels', t('Print each callsign')),
      toggle(
        'toggle-popups',
        t('MSG POPUPS'),
        'popups',
        t(
          'Pop up messages sent by stations inside the radius, beside the sender, then fade them out',
        ),
      ),
    ],
    legend: Object.keys(CATEGORY_LABELS)
      .filter((key) => counts[key])
      .map((key) => ({
        label: t(CATEGORY_LABELS[key]),
        color: CATEGORY_COLORS[key],
        count: counts[key],
      })),
  };
}
