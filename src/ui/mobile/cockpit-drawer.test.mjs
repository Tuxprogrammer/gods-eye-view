import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COCKPIT_TABS,
  adjacentCockpitTab,
  drawerConsumesEscape,
  initialDrawerState,
  normalizeCockpitTab,
  reduceDrawer,
} from './cockpit-model.js';
import { COCKPIT_MOVES } from './cockpit-drawer.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const template = read('../templates/cockpit.html');
const css = read('../styles/mobile-cockpit.css');
const briefing = read('../cockpitBriefing.js');

test('tabs cover contact, route, brief, display and radio', () => {
  assert.deepEqual(
    COCKPIT_TABS.map((tab) => tab.id),
    ['contact', 'route', 'brief', 'display', 'radio'],
  );
  assert.equal(normalizeCockpitTab('nope'), 'contact');
  assert.equal(normalizeCockpitTab('radio'), 'radio');
});

test('drawer reducer opens, remembers the tab, and closes on exit/sheet/escape', () => {
  let state = initialDrawerState();
  assert.equal(state.open, false);
  state = reduceDrawer(state, { type: 'select', tab: 'display' });
  assert.deepEqual(state, { open: true, tab: 'display' });
  state = reduceDrawer(state, { type: 'close' });
  assert.deepEqual(state, { open: false, tab: 'display' });
  state = reduceDrawer(state, { type: 'toggle' });
  assert.deepEqual(state, { open: true, tab: 'display' });
  for (const type of ['exit', 'sheet', 'escape']) {
    assert.equal(reduceDrawer(state, { type }).open, false, type);
  }
  const closed = initialDrawerState();
  assert.equal(reduceDrawer(closed, { type: 'escape' }), closed);
  assert.equal(reduceDrawer(state, { type: 'bogus' }), state);
  assert.equal(
    reduceDrawer(closed, { type: 'open', tab: 'bad' }).tab,
    'contact',
  );
});

test('escape is consumed only while the drawer is open', () => {
  assert.equal(drawerConsumesEscape({ open: true, tab: 'contact' }), true);
  assert.equal(drawerConsumesEscape({ open: false, tab: 'contact' }), false);
});

test('arrow navigation wraps around the tabs', () => {
  assert.equal(adjacentCockpitTab('contact', -1), 'radio');
  assert.equal(adjacentCockpitTab('radio', 1), 'contact');
  assert.equal(adjacentCockpitTab('route', 1), 'brief');
});

test('every node the drawer moves exists once in the cockpit template', () => {
  for (const [, selector] of COCKPIT_MOVES) {
    const id = selector.match(/#([\w-]+)$/)?.[1];
    if (id) {
      const count = template.split(`id="${id}"`).length - 1;
      assert.equal(count, 1, `${id} must be a single owner`);
    } else {
      const cls = selector.match(/\.([\w-]+)$/)[1];
      assert.match(template, new RegExp(`class="${cls}"`), cls);
    }
  }
  for (const id of [
    'cockpit-context-previous',
    'cockpit-context-next',
    'view-switcher',
  ]) {
    assert.ok(template.includes(`id="${id}"`), id);
  }
});

test('the drawer never introduces an id the cockpit already owns', () => {
  const source = read('./cockpit-drawer.js');
  const created = [...source.matchAll(/id: '([\w-]+)'/g)].map((m) => m[1]);
  for (const id of created) {
    assert.ok(!template.includes(`id="${id}"`), id);
  }
});

test('mobile cockpit css is fully scoped and flat', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [
    ...stripped.matchAll(/(?:^|[{}])\s*([^{}@\s][^{}]*)\{/g),
  ].map((m) => m[1].trim());
  assert.ok(selectors.length > 40);
  for (const selectorList of selectors) {
    for (const selector of selectorList.split(/,\s*(?![^()]*\))/)) {
      assert.match(
        selector.trim(),
        /^html(\[data-ui='mobile'\]|:not\(\[data-ui='mobile'\]\))/,
        selector,
      );
    }
  }
  assert.doesNotMatch(stripped, /rotate[XY]\(|translateZ\(|perspective\(/);
  assert.match(stripped, /\.cockpit-help/);
});

test('brief auto-rotate ignores :hover in the mobile UI', () => {
  assert.match(
    briefing,
    /dataset\?\.ui !== 'mobile' &&\s*this\.signalStream\?\.matches\(':hover'\)/,
  );
});
