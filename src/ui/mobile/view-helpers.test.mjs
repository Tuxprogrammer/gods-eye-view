import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GROUP_SLOTS,
  KEY_ACTIONS,
  pressShortcut,
  presetHelp,
  setSwitchState,
  slotForNode,
  titleCase,
  unavailableMapNotes,
  viewSummary,
  watchForElement,
} from './view-helpers.js';

class FakeKeyboardEvent {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init);
  }
}

test('pressShortcut dispatches the orbit and FPS keys on the document', () => {
  const seen = [];
  const doc = { dispatchEvent: (event) => seen.push(event) };
  const win = { KeyboardEvent: FakeKeyboardEvent };
  assert.equal(pressShortcut(doc, 'orbit', win), true);
  assert.equal(pressShortcut(doc, 'fps', win), true);
  assert.equal(pressShortcut(doc, 'nope', win), false);
  assert.deepEqual(
    seen.map((e) => [e.type, e.key, e.code, e.bubbles]),
    [
      ['keydown', 'o', 'KeyO', true],
      ['keydown', '`', 'Backquote', true],
    ],
  );
  assert.equal(KEY_ACTIONS.fps.key, '`');
});

test('viewSummary and titleCase', () => {
  assert.equal(titleCase('NORMAL'), 'Normal');
  assert.equal(viewSummary({ style: 'THERMAL', source: '3D' }), 'Thermal · 3D');
  assert.equal(viewSummary({ style: 'CRT' }), 'CRT');
  assert.equal(viewSummary({}), '');
});

function fakeNode(attrs = {}, { classes = [], children = {} } = {}) {
  return {
    getAttribute: (name) => attrs[name] ?? null,
    classList: { contains: (name) => classes.includes(name) },
    querySelector: (selector) => children[selector] ?? null,
  };
}

test('presetHelp exposes the title= description as visible text', () => {
  const button = fakeNode(
    { title: 'Simulate night-vision goggles.' },
    { children: { '.btn-label': { textContent: ' NVG ' } } },
  );
  assert.deepEqual(presetHelp(button), {
    name: 'NVG',
    description: 'Simulate night-vision goggles.',
  });
  assert.deepEqual(presetHelp(null), { name: '', description: '' });
});

test('unavailableMapNotes lists every unavailable chip with its reason', () => {
  const chip = (label, title, unavailable) =>
    fakeNode(
      { title, 'aria-disabled': String(unavailable) },
      {
        classes: unavailable ? ['unavailable'] : [],
        children: { '.map-stack-chip-label': { textContent: label } },
      },
    );
  const notes = unavailableMapNotes([
    chip('OSM', 'OSM', false),
    chip('Bing Aerial', 'Needs a Cesium ion token', true),
    chip('Photoreal', 'Photoreal', true),
  ]);
  assert.deepEqual(notes, [
    'Bing Aerial: Needs a Cesium ion token',
    'Photoreal: unavailable',
  ]);
  assert.deepEqual(unavailableMapNotes(null), []);
});

test('setSwitchState uses aria-checked for switches, aria-pressed otherwise', () => {
  const make = (role) => {
    const attrs = role ? { role } : {};
    const state = { textContent: '' };
    return {
      attrs,
      state,
      getAttribute: (n) => attrs[n] ?? null,
      setAttribute: (n, v) => {
        attrs[n] = v;
      },
      querySelector: () => state,
    };
  };
  const sw = make('switch');
  setSwitchState(sw, true);
  assert.equal(sw.attrs['aria-checked'], 'true');
  assert.equal(sw.state.textContent, 'On');
  const plain = make(null);
  setSwitchState(plain, false);
  assert.equal(plain.attrs['aria-pressed'], 'false');
  assert.equal(plain.state.textContent, 'Off');
});

test('slotForNode maps Display groups and the parameter panel to slots', () => {
  const group = (id) => ({
    nodeType: 1,
    id: '',
    querySelector: (selector) => (selector === `#${id}` ? {} : null),
  });
  for (const [id, slot] of Object.entries(GROUP_SLOTS)) {
    assert.equal(slotForNode(group(id)), slot);
  }
  assert.equal(
    slotForNode({ nodeType: 1, id: 'param-slider-panel' }),
    'params',
  );
  assert.equal(slotForNode({ nodeType: 1, id: 'clean-view-toggle' }), 'clean');
  assert.equal(
    slotForNode({ nodeType: 1, id: 'x', querySelector: () => null }),
    '',
  );
  assert.equal(slotForNode(null), '');
});

test('watchForElement fires immediately, then on replacement, and stops', () => {
  let current = null;
  let callback = null;
  let disconnected = false;
  class FakeObserver {
    constructor(cb) {
      callback = cb;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  }
  const found = [];
  const stop = watchForElement(
    {},
    () => current,
    (node) => found.push(node),
    { MutationObserverCtor: FakeObserver },
  );
  assert.deepEqual(found, []);
  current = { id: 'a' };
  callback();
  callback();
  current = { id: 'b' };
  callback();
  assert.deepEqual(
    found.map((n) => n.id),
    ['a', 'b'],
  );
  stop();
  assert.equal(disconnected, true);

  // once: disconnects after the first hit
  let onceDisconnected = false;
  class OnceObserver {
    constructor(cb) {
      callback = cb;
    }
    observe() {}
    disconnect() {
      onceDisconnected = true;
    }
  }
  current = null;
  const hits = [];
  watchForElement(
    {},
    () => current,
    (n) => hits.push(n),
    {
      once: true,
      MutationObserverCtor: OnceObserver,
    },
  );
  current = { id: 'c' };
  callback();
  assert.equal(hits.length, 1);
  assert.equal(onceDisconnected, true);
});
