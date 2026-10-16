import { msg, t } from '../../i18n/index.js';
import {
  CATEGORY_COLORS,
  RADIUS_OPTIONS,
  TRACK_OPTIONS,
  UNIT_OPTIONS,
  WINDOW_OPTIONS,
} from './model.js';
import { serverSummary } from './serverStatus.js';

const CATEGORY_LABELS = Object.freeze({
  client: msg('Client'),
  infrastructure: msg('Router/Repeater'),
  tracker: msg('Tracker'),
  sensor: msg('Sensor'),
});

const options = (list) =>
  list.map(({ value, label }) => ({
    value,
    label: t(label),
  }));

/**
 * Row controls for the layer panel: the list of MQTT servers (each with an
 * on/off switch, an editable topic and a delete button, plus an add form), how
 * far, how recent and how long a track to show, a name filter, the toggles, and
 * a legend that counts what is drawn by role.
 * @param {object} view Live state of the layer.
 * @param {object} actions Callbacks into the layer.
 */
export function meshtasticRowControls(view, actions) {
  const { settings, counts, servers, now } = view;
  const toggle = (id, label, key, title) => ({
    id,
    label,
    title,
    active: Boolean(settings[key]),
    state: settings[key] ? 'active' : 'idle',
    onClick: () => actions.set({ [key]: !settings[key] }),
  });
  return {
    servers: {
      heading: t('MQTT SERVERS'),
      items: servers.map((server) => ({
        id: server.id,
        name: server.name,
        title: `${server.host}:${server.port}${server.tls ? ' (TLS)' : ''}`,
        status: server.status,
        statusText: serverSummary(server, now),
        enabled: server.enabled,
        topic: server.topic,
        removeLabel: t('Delete {name}', { name: server.name }),
        onToggle: () => actions.toggleServer(server.id),
        onTopic: (topic) => actions.setServerTopic(server.id, topic),
        onRemove: () => actions.removeServer(server.id),
      })),
      onAdd: (fields) => actions.addServer(fields),
    },
    selects: [
      {
        id: 'radius',
        label: t('RADIUS'),
        title: t(
          'Nodes within this distance of the point under the view. Whole Earth shows every node on the near side of the planet.',
        ),
        value: settings.radius,
        options: options(RADIUS_OPTIONS),
        onChange: (value) => actions.set({ radius: value }),
      },
      {
        id: 'window',
        label: t('HEARD'),
        title: t('Only nodes heard within this long ago'),
        value: settings.window,
        options: options(WINDOW_OPTIONS),
        onChange: (value) => actions.set({ window: value }),
      },
      {
        id: 'track',
        label: t('TRACK'),
        title: t('How far back each moving node’s track is drawn'),
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
        id: 'filter',
        label: t('NAME'),
        title: t(
          'Show only these nodes, by short name, long name or !id. Separate with commas; * matches any run of characters, e.g. HT*, !0af87081',
        ),
        placeholder: t('all nodes · HT*, !0af87081'),
        value: settings.filter,
        onCommit: (value) => actions.set({ filter: value }),
      },
    ],
    chips: [
      toggle(
        'toggle-moving',
        t('MOVING'),
        'movingOnly',
        t('Show only nodes whose position has changed'),
      ),
      toggle(
        'toggle-labels',
        t('LABELS'),
        'labels',
        t('Print each node’s name'),
      ),
      toggle(
        'toggle-popups',
        t('MSG POPUPS'),
        'popups',
        t(
          'Pop up text messages sent by nodes inside the radius, beside the sender, then fade them out',
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
