import assert from 'node:assert/strict';
import test from 'node:test';
import { LayerPanel } from './layerPanel.js';

/** The smallest element that the panel's reconcilers touch. */
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.parent = null;
    this.attributes = new Map();
    this.textContent = '';
    this.value = '';
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
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }
}

function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = {
    activeElement: null,
    createElement: (tag) => new FakeElement(tag),
  };
  try {
    return run(globalThis.document);
  } finally {
    globalThis.document = previous;
  }
}

const opacity = (value) => ({
  id: 'opacity',
  label: 'OPACITY',
  min: 10,
  max: 100,
  step: 5,
  value,
  suffix: '%',
});
const sliderLabels = (container) =>
  container.children.filter((node) => node.className === 'data-toggle-slider');

test('a slider is created once and reused across refreshes', () =>
  withDocument(() => {
    const panel = LayerPanel.prototype;
    const container = new FakeElement('div');
    for (let i = 0; i < 5; i++) panel._syncSliders(container, [opacity(60)]);
    assert.equal(sliderLabels(container).length, 1);
    const input = sliderLabels(container)[0].children[1];
    assert.equal(input.type, 'range');
    assert.equal(input.value, '60');
    assert.equal(input.dataset.sliderId, 'opacity');
    assert.equal(sliderLabels(container)[0].children[2].textContent, '60%');
  }));

test('a slider follows the descriptor, except while it is being dragged', () =>
  withDocument((document) => {
    const panel = LayerPanel.prototype;
    const container = new FakeElement('div');
    panel._syncSliders(container, [opacity(60)]);
    const input = sliderLabels(container)[0].children[1];
    panel._syncSliders(container, [opacity(90)]);
    assert.equal(input.value, '90', 'a switched map shows its own setting');
    document.activeElement = input;
    input.value = '35';
    panel._syncSliders(container, [opacity(90)]);
    assert.equal(input.value, '35', 'a refresh must not fight the drag');
  }));

test('a slider that leaves the descriptor is removed', () =>
  withDocument(() => {
    const panel = LayerPanel.prototype;
    const container = new FakeElement('div');
    panel._syncSliders(container, [opacity(60)]);
    panel._syncSliders(container, []);
    assert.equal(sliderLabels(container).length, 0);
  }));

const ramp = (ticks = [{ position: 0.5, label: '10' }]) => ({
  gradient: 'linear-gradient(90deg, red, blue)',
  ticks,
  caption: 'MUF (3000 km) · MHz · 4–35 (log)',
});

test('the colour ramp is created once, updated in place and removed with the layer', () =>
  withDocument(() => {
    const panel = LayerPanel.prototype;
    const container = new FakeElement('div');
    for (let i = 0; i < 4; i++) panel._syncRamp(container, ramp());
    const nodes = () =>
      container.children.filter((node) => node.className === 'data-toggle-ramp');
    assert.equal(nodes().length, 1);
    const [bar, ticks, caption] = nodes()[0].children;
    assert.equal(bar.style.background, 'linear-gradient(90deg, red, blue)');
    assert.equal(caption.textContent, 'MUF (3000 km) · MHz · 4–35 (log)');
    assert.equal(ticks.children.length, 1);
    assert.equal(ticks.children[0].style.left, '50.00%');
    assert.match(bar.attributes.get('aria-label'), /Scale marks: 10/);

    const first = ticks.children[0];
    panel._syncRamp(container, ramp());
    assert.equal(ticks.children[0], first, 'unchanged ticks are not rebuilt');
    panel._syncRamp(
      container,
      ramp([
        { position: 0.1, label: '5' },
        { position: 0.9, label: '30' },
      ]),
    );
    assert.deepEqual(
      ticks.children.map((tick) => tick.textContent),
      ['5', '30'],
    );
    panel._syncRamp(container, null);
    assert.equal(nodes().length, 0);
  }));
