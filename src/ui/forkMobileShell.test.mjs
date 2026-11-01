// The fork's phone UI and upstream's phone shell never run together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initMobileShell } from './forkMobileShell.js';
import { UI_MODE_EVENT } from './mobileMode.js';

function harness(mode) {
  const listeners = new Map();
  const win = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const doc = { documentElement: { dataset: { ui: mode } }, defaultView: win };
  const shells = [];
  const initShell = () => {
    const shell = {
      destroyed: false,
      sharedCollapsed: (id) => `shared:${id}`,
      setSheet: () => {},
      getSheet: () => 'layers',
      destroy() {
        this.destroyed = true;
      },
    };
    shells.push(shell);
    return shell;
  };
  const flip = (next) => {
    doc.documentElement.dataset.ui = next;
    listeners.get(UI_MODE_EVENT)?.();
  };
  const api = initMobileShell({ documentRef: doc }, { initShell });
  return { api, shells, flip, listeners };
}

test('the fork phone UI keeps upstream’s shell off', () => {
  const { api, shells } = harness('mobile');
  assert.equal(shells.length, 0);
  assert.equal(api.sharedCollapsed('data-panel'), undefined);
  assert.equal(api.getSheet(), null);
});

test('desktop runs upstream’s shell and passes its API through', () => {
  const { api, shells } = harness('desktop');
  assert.equal(shells.length, 1);
  assert.equal(api.sharedCollapsed('data-panel'), 'shared:data-panel');
  assert.equal(api.getSheet(), 'layers');
});

test('a mode flip swaps them, and destroy releases everything', () => {
  const { api, shells, flip, listeners } = harness('desktop');
  flip('mobile');
  assert.equal(shells[0].destroyed, true);
  flip('desktop');
  assert.equal(shells.length, 2);
  api.destroy();
  assert.equal(shells[1].destroyed, true);
  assert.equal(listeners.has(UI_MODE_EVENT), false);
});
