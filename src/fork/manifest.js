// Everything this fork adds to upstream's layer registries, as plain data.
// Upstream modules spread these into their own tables, so each fork layer is
// declared here once instead of in a dozen upstream files, and an upstream
// merge only ever meets the one-line spreads. Data only: portable, server and
// browser packages all import it, so it may depend on nothing but marker.js.
import { msg } from '../i18n/marker.js';

/**
 * The fork's layers, in catalog order, with their acquisition source contract.
 * Their share-link tokens stay inline in src/data/layerState.js, whose ledger
 * test imports that file on its own. APRS and Meshtastic are product names,
 * kept English in same-as-english.json.
 */
const LAYERS = [
  {
    id: 'propagation',
    name: msg('HF Propagation'),
    providers: ['propagation'],
    methods: ['getMap'],
  },
  {
    id: 'aprs',
    name: msg('APRS'),
    providers: ['aprs'],
    methods: ['getStations'],
  },
  {
    id: 'meshtastic',
    name: msg('Meshtastic'),
    providers: ['meshtastic'],
    methods: ['getNodes'],
  },
];

/** Layer ids in catalog order. */
export const FORK_LAYER_IDS = Object.freeze(LAYERS.map(({ id }) => id));

/** English layer names, keyed by id, for `LAYER_NAME_KEYS`. */
export const FORK_LAYER_NAME_KEYS = Object.freeze(
  Object.fromEntries(LAYERS.map(({ id, name }) => [id, name])),
);

/** Source contracts, shaped as sourceComposition.js's `contract()` builds them. */
export const FORK_SOURCE_CONTRACTS = Object.freeze(
  Object.fromEntries(
    LAYERS.map(({ id, providers, methods }) => [
      id,
      Object.freeze({
        layers: Object.freeze(providers),
        methods: Object.freeze(methods),
      }),
    ]),
  ),
);

/**
 * None of the fork's layers is voice-reachable yet; giving them aliases,
 * toggles and analyst fields is a feature of its own.
 */
export const FORK_VOICE_OFF_LAYERS = Object.freeze(
  Object.fromEntries(
    LAYERS.map(({ id }) => [id, 'fork layer, not yet wired for voice']),
  ),
);

/** Attribution for the fork's data, in the order the credits panel lists it. */
export const FORK_DATA_CREDITS = Object.freeze([
  {
    key: 'kc2g-propagation',
    html:
      'HF propagation maps (MUF 3000 km, foF2): ' +
      '<a href="https://prop.kc2g.com/" target="_blank" rel="noopener">prop.kc2g.com</a> ' +
      'from ionosonde data of the ' +
      '<a href="https://giro.uml.edu/" target="_blank" rel="noopener">Global Ionospheric Radio Observatory (GIRO)</a> ' +
      'and its contributing stations, with the IRI-2020 model',
  },
  {
    key: 'aprs-is',
    html:
      'Amateur radio positions, weather and messages: ' +
      '<a href="https://www.aprs-is.net/" target="_blank" rel="noopener">APRS-IS</a> ' +
      'network, as transmitted by licensed operators and ' +
      '<a href="http://www.cwop.org/" target="_blank" rel="noopener">CWOP</a> weather observers',
  },
  {
    key: 'aprs-symbols',
    html:
      'APRS map symbols: ' +
      '<a href="http://github.com/hessu/aprs-symbols/" target="_blank" rel="noopener">aprs-symbols</a> ' +
      'by Heikki Hannikainen (OH7LZB), the set used by aprs.fi',
  },
  {
    key: 'meshtastic-mqtt',
    html:
      'Mesh radio node positions and messages: ' +
      '<a href="https://meshtastic.org/" target="_blank" rel="noopener">Meshtastic</a> ' +
      'nodes whose operators publish to MQTT (the project’s public broker and community brokers such as ' +
      '<a href="https://almesh.net/" target="_blank" rel="noopener">ALmesh</a>)',
  },
]);
