import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeGlobalLoading,
  describeSyncChip,
  describeToast,
  installStatusRouting,
} from './modals-status.js';
import { collectRowHelp } from './modals-keys.js';

const node = (props = {}, children = {}) => ({
  textContent: '',
  hidden: false,
  dataset: {},
  classList: { contains: (name) => (props.classes ?? []).includes(name) },
  querySelector: (selector) => children[selector.replace(/^[#.]/, '')] ?? null,
  ...props,
});

test('toast only reports while visible and non-empty', () => {
  assert.equal(describeToast(node({ textContent: 'Link copied!' })), null);
  assert.deepEqual(
    describeToast(
      node({ textContent: ' Link  copied! ', classes: ['visible'] }),
    ),
    { text: 'Link copied!', kind: 'info', ttl: 2400 },
  );
  assert.equal(describeToast(node({ classes: ['visible'] })), null);
  assert.equal(describeToast(null), null);
});

test('global loading maps states to kinds and mirrors the hidden detail', () => {
  const kids = {
    'global-loading-label': node({ textContent: 'LOADING LIVE DATA' }),
    'global-loading-detail': node({ textContent: 'FLIGHTS, VESSELS' }),
  };
  assert.deepEqual(
    describeGlobalLoading(node({ dataset: { state: 'loading' } }, kids)),
    {
      text: 'LOADING LIVE DATA · FLIGHTS, VESSELS',
      kind: 'loading',
      ttl: 0,
    },
  );
  const done = describeGlobalLoading(
    node({ dataset: { state: 'error' } }, kids),
  );
  assert.equal(done.text, 'LOADING LIVE DATA');
  assert.equal(done.kind, 'error');
  assert.equal(
    describeGlobalLoading(node({ dataset: { state: 'retry' } }, kids)).kind,
    'warn',
  );
  assert.equal(describeGlobalLoading(node({ hidden: true }, kids)), null);
});

test('sync chip needs .visible and joins label and progress', () => {
  const kids = {
    'traffic-sync-label': node({ textContent: 'syncing road network' }),
    'traffic-sync-progress': node({ textContent: '40%' }),
  };
  assert.equal(
    describeSyncChip(
      node({}, kids),
      'traffic-sync-label',
      'traffic-sync-progress',
    ),
    null,
  );
  assert.equal(
    describeSyncChip(
      node({ classes: ['visible'] }, kids),
      'traffic-sync-label',
      'traffic-sync-progress',
    ).text,
    'syncing road network 40%',
  );
});

test('router emits on change, clears when the source goes quiet, and disposes', () => {
  const toast = node({ textContent: 'Hi', classes: ['visible'] });
  const events = [];
  const win = {
    MutationObserver: undefined,
    dispatchEvent: (event) => events.push(event.detail),
  };
  const doc = { getElementById: (id) => (id === 'toast' ? toast : null) };
  const dispose = installStatusRouting(doc, win);
  assert.deepEqual(events, [
    { id: 'toast', text: 'Hi', kind: 'info', ttl: 2400 },
  ]);
  dispose();
  assert.deepEqual(events.at(-1), { id: 'toast', text: '' });
});

test('key rows: tooltip copy becomes visible help', () => {
  const titled = (title) => ({ getAttribute: () => title });
  const row = {
    querySelector: (selector) =>
      ({
        '.key-setup-tier': titled('Free key'),
        '.key-setup-exposed': titled('Runs in the browser'),
      })[selector] ?? null,
  };
  assert.deepEqual(collectRowHelp(row), [
    'Free key',
    'Browser-side: Runs in the browser',
  ]);
});
