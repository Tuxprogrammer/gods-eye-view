import assert from 'node:assert/strict';
import test from 'node:test';
import { createStationInteraction } from './stationInteraction.js';

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
  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const STATIONS = {
  DB049: {
    code: 'DB049',
    name: 'Dourbes, Belgium',
    rows: [
      ['Station', 'Dourbes, Belgium'],
      ['Code', 'DB049'],
      ['MUF (3000 km)', '20 MHz'],
    ],
  },
  AT138: {
    code: 'AT138',
    name: 'Athens, Greece',
    rows: [
      ['Station', 'Athens, Greece'],
      ['Code', 'AT138'],
    ],
  },
};

function harness() {
  const canvas = new FakeElement('canvas');
  const container = new FakeElement('div');
  const doc = new FakeElement('document');
  doc.createElement = (tag) => new FakeElement(tag);
  const postRender = new Set();
  const viewer = {
    container,
    clock: { currentTime: 0 },
    scene: {
      canvas,
      postRender: {
        addEventListener(fn) {
          postRender.add(fn);
          return () => postRender.delete(fn);
        },
      },
    },
  };
  const state = {
    hits: new Map(), // "x,y" -> station code
    visible: new Set(['DB049', 'AT138']),
    projected: { x: 400, y: 300 },
    picks: 0,
  };
  const surface = {
    detailsFor(code) {
      const base = STATIONS[code];
      if (!base || state.gone?.has(code)) return null;
      return { ...base, entity: { code }, visible: state.visible.has(code) };
    },
  };
  const timers = [];
  const interaction = createStationInteraction({
    viewer,
    surface,
    documentRef: doc,
    pick: (x, y) => {
      state.picks++;
      const code = state.hits.get(`${x},${y}`);
      return code ? `propagation-station:${code}` : null;
    },
    project: () => state.projected,
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => {},
  });
  const card = container.children[0];
  const flush = () => timers.splice(0).forEach((fn) => fn());
  const move = (x, y, extra = {}) =>
    canvas.dispatch('pointermove', { clientX: x, clientY: y, buttons: 0, ...extra });
  const click = (x, y) => {
    canvas.dispatch('pointerdown', { clientX: x, clientY: y });
    canvas.dispatch('click', { clientX: x, clientY: y });
  };
  return { canvas, container, doc, viewer, state, card, interaction, postRender, flush, move, click };
}

const cell = (card, row, col) =>
  card.children[1].children[0].children[row].children[col].textContent;

test('hovering a station previews its details as a table', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.move(300, 200);
  h.flush();
  assert.equal(h.card.hidden, false);
  assert.equal(h.card.children[0].children[0].textContent, 'Dourbes, Belgium');
  // The station name is the title, so the table starts at the next row.
  assert.equal(cell(h.card, 0, 0), 'Code');
  assert.equal(cell(h.card, 0, 1), 'DB049');
  assert.equal(cell(h.card, 1, 0), 'MUF (3000 km)');
  assert.equal(cell(h.card, 1, 1), '20 MHz');
  assert.equal(h.card.attributes.get('role'), 'tooltip');
  assert.equal(h.card.classList.contains('pinned'), false);
  assert.equal(h.canvas.style.cursor, 'pointer');
  assert.equal(h.card.style.left, '314px');
  assert.equal(h.card.style.top, '214px');
});

test('moving off the station hides the preview and restores the cursor', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.move(300, 200);
  h.flush();
  h.move(500, 500);
  h.flush();
  assert.equal(h.card.hidden, true);
  assert.equal(h.canvas.style.cursor, '');
});

test('hover picks are throttled', () => {
  const h = harness();
  for (let i = 0; i < 20; i++) h.move(100 + i, 100);
  assert.equal(h.state.picks, 0, 'nothing is picked until the timer fires');
  h.flush();
  assert.equal(h.state.picks, 1, 'one pick, for the latest position');
});

test('a held button is a camera drag: no picking, no preview', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.move(300, 200, { buttons: 1 });
  h.flush();
  assert.equal(h.state.picks, 0);
  assert.equal(h.card.hidden, true);
});

test('a hidden (over-the-horizon) station shows nothing', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.state.visible.delete('DB049');
  h.move(300, 200);
  h.flush();
  assert.equal(h.card.hidden, true);
});

test('clicking a station pins its card and follows the bubble', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.click(300, 200);
  assert.equal(h.interaction.pinned, 'DB049');
  assert.equal(h.card.classList.contains('pinned'), true);
  assert.equal(h.card.attributes.get('role'), 'dialog');
  assert.equal(h.card.hidden, false);
  assert.equal(h.postRender.size, 1);
  // The bubble moved on screen by (+100, +50); the card keeps its offset to it.
  const before = { left: h.card.style.left, top: h.card.style.top };
  h.state.projected = { x: 500, y: 350 };
  [...h.postRender].forEach((fn) => fn());
  assert.notEqual(h.card.style.left, before.left);
  assert.equal(h.card.style.left, `${parseInt(before.left, 10) + 100}px`);
  assert.equal(h.card.style.top, `${parseInt(before.top, 10) + 50}px`);
});

test('a pinned card ignores hover over other stations', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.state.hits.set('600,400', 'AT138');
  h.click(300, 200);
  h.move(600, 400);
  h.flush();
  assert.equal(h.card.children[0].children[0].textContent, 'Dourbes, Belgium');
  assert.equal(h.canvas.style.cursor, 'pointer', 'but the cursor still says clickable');
});

test('a pinned card closes by clicking it again, elsewhere, Esc, or its button', () => {
  const closers = [
    (h) => h.click(300, 200),
    (h) => h.click(50, 50),
    (h) => h.doc.dispatch('keydown', { key: 'Escape' }),
    (h) => h.card.children[0].children[1].dispatch('click'),
  ];
  for (const close of closers) {
    const h = harness();
    h.state.hits.set('300,200', 'DB049');
    h.click(300, 200);
    assert.equal(h.interaction.pinned, 'DB049');
    close(h);
    assert.equal(h.interaction.pinned, null);
    assert.equal(h.card.hidden, true);
    assert.equal(h.card.classList.contains('pinned'), false, 'no stale pin styling');
    assert.equal(h.postRender.size, 0, 'no follower is left running');
  }
});

test('other keys leave a pinned card alone', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.click(300, 200);
  h.doc.dispatch('keydown', { key: 'a' });
  assert.equal(h.interaction.pinned, 'DB049');
});

test('clicking a different station moves the pin', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.state.hits.set('600,400', 'AT138');
  h.click(300, 200);
  h.click(600, 400);
  assert.equal(h.interaction.pinned, 'AT138');
  assert.equal(h.card.children[0].children[0].textContent, 'Athens, Greece');
  assert.equal(h.postRender.size, 1);
});

test('a drag that ends on a station is not a click', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
  h.canvas.dispatch('click', { clientX: 300, clientY: 200 });
  assert.equal(h.interaction.pinned, null);
  // ...and a drag does not close an existing pin either.
  h.click(300, 200);
  h.canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
  h.canvas.dispatch('click', { clientX: 500, clientY: 500 });
  assert.equal(h.interaction.pinned, 'DB049');
});

test('the pinned card hides while its station is over the horizon, and returns', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.click(300, 200);
  h.state.visible.delete('DB049');
  [...h.postRender].forEach((fn) => fn());
  assert.equal(h.card.hidden, true);
  assert.equal(h.interaction.pinned, 'DB049', 'the pin survives');
  h.state.visible.add('DB049');
  [...h.postRender].forEach((fn) => fn());
  assert.equal(h.card.hidden, false);
});

test('refresh drops a pin whose station disappeared', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.click(300, 200);
  h.interaction.refresh();
  assert.equal(h.interaction.pinned, 'DB049');
  h.state.gone = new Set(['DB049']);
  h.interaction.refresh();
  assert.equal(h.interaction.pinned, null);
  assert.equal(h.card.hidden, true);
});

test('hide closes everything', () => {
  const h = harness();
  h.state.hits.set('300,200', 'DB049');
  h.click(300, 200);
  h.interaction.hide();
  assert.equal(h.interaction.pinned, null);
  assert.equal(h.card.hidden, true);
  assert.equal(h.canvas.style.cursor, '');
});

test('destroy removes every listener and the card', () => {
  const h = harness();
  assert.ok(h.canvas.count('click') >= 1);
  assert.equal(h.container.children.length, 1);
  h.interaction.destroy();
  for (const type of ['pointermove', 'pointerleave', 'pointerdown', 'click'])
    assert.equal(h.canvas.count(type), 0, type);
  assert.equal(h.doc.count('keydown'), 0);
  assert.equal(h.container.children.length, 0);
});

test('station text is set as text, never as markup', () => {
  const h = harness();
  STATIONS.DB049.rows[2][1] = '<img src=x onerror=alert(1)>';
  h.state.hits.set('300,200', 'DB049');
  h.move(300, 200);
  h.flush();
  assert.equal(cell(h.card, 1, 1), '<img src=x onerror=alert(1)>');
  assert.equal(h.card.children[1].children[0].children[1].children[1].children.length, 0);
  STATIONS.DB049.rows[2][1] = '20 MHz';
});
