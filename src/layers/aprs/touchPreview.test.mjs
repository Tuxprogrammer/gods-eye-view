import assert from 'node:assert/strict';
import test from 'node:test';
import { createStationInteraction } from './interaction.js';

/** The smallest element the interaction touches. */
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.style = {};
    this.children = [];
    this.parent = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.textContent = '';
    this.dataset = {};
    this.offsetWidth = 200;
    this.offsetHeight = 120;
    this.clientWidth = 1000;
    this.clientHeight = 600;
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => {
        const on = force ?? !this.classes.has(name);
        if (on) this.classes.add(name);
        else this.classes.delete(name);
      },
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node) {
    node.parent = this;
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter((n) => n !== this);
    this.parent = null;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }
}

const STATION = { id: 'STR1', lon: -86.69, lat: 34.73 };

function harness({ ui }) {
  const canvas = new FakeElement('canvas');
  const container = new FakeElement('div');
  const doc = new FakeElement('document');
  doc.createElement = (tag) => new FakeElement(tag);
  doc.documentElement = { dataset: ui ? { ui } : {} };
  const moveStart = new Set();
  const viewer = {
    container,
    camera: {
      moveStart: {
        addEventListener(fn) {
          moveStart.add(fn);
          return () => moveStart.delete(fn);
        },
      },
    },
    scene: { canvas, postRender: { addEventListener: () => () => {} } },
  };
  const hits = new Map(); // "x,y" -> station id
  const surface = {
    idAt: (x, y) => hits.get(`${x},${y}`) ?? null,
    recordFor: (id) =>
      id === STATION.id ? { station: STATION, visible: true } : null,
    screenPosition: () => ({ x: 100, y: 100 }),
    setEmphasis() {},
    clearSelectedTrack() {},
    showSelectedTrack() {},
  };
  const interaction = createStationInteraction({
    viewer,
    surface,
    documentRef: doc,
    units: () => 'metric',
    loadDetail: async () => ({ track: [], messages: [] }),
    flyTo() {},
    cardModel: () => ({
      glyph: 'S',
      title: 'Station',
      lines: [[{ t: 'line' }]],
    }),
    setTimer: () => 1,
    clearTimer() {},
  });
  hits.set('100,100', STATION.id);
  const card = container.children[0];
  const tap = (x, y, pointerType = 'touch') => {
    canvas.dispatch('pointerdown', { clientX: x, clientY: y, pointerType });
    canvas.dispatch('click', { clientX: x, clientY: y, pointerType });
  };
  return { canvas, card, interaction, moveStart, tap };
}

test('on touch a first tap previews the station, a second tap pins it', () => {
  const { card, tap } = harness({ ui: 'mobile' });
  tap(100, 100);
  assert.equal(card.hidden, false);
  assert.ok(card.classes.has('touch-preview'), 'first tap shows the tooltip');
  assert.ok(!card.classes.has('pinned'));
  tap(100, 100);
  assert.ok(card.classes.has('pinned'), 'second tap opens the full card');
  assert.ok(!card.classes.has('touch-preview'));
});

test('tapping the touch tooltip itself opens the full card', () => {
  const { card, tap } = harness({ ui: 'mobile' });
  tap(100, 100);
  card.dispatch('click', {});
  assert.ok(card.classes.has('pinned'));
  assert.ok(!card.classes.has('touch-preview'));
});

test('a tap on empty map, or the camera moving, dismisses the touch tooltip', () => {
  const first = harness({ ui: 'mobile' });
  first.tap(100, 100);
  first.tap(10, 10);
  assert.equal(first.card.hidden, true);
  assert.ok(!first.card.classes.has('touch-preview'));

  const second = harness({ ui: 'mobile' });
  second.tap(100, 100);
  for (const fn of second.moveStart) fn();
  assert.equal(second.card.hidden, true);
});

test('desktop (and a mouse click in any mode) still pins on the first click', () => {
  const desktop = harness({ ui: 'desktop' });
  desktop.tap(100, 100, 'mouse');
  assert.ok(desktop.card.classes.has('pinned'));
  assert.ok(!desktop.card.classes.has('touch-preview'));

  const touchOnDesktop = harness({ ui: 'desktop' });
  touchOnDesktop.tap(100, 100, 'touch');
  assert.ok(
    touchOnDesktop.card.classes.has('pinned'),
    'only the mobile UI previews',
  );

  const mouseOnMobile = harness({ ui: 'mobile' });
  mouseOnMobile.tap(100, 100, 'mouse');
  assert.ok(mouseOnMobile.card.classes.has('pinned'));
});
