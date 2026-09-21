import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  MOBILE_QUERY,
  isMobileUi,
  installMobileMode,
  resolveMobileMode,
} from './mobileMode.js';

function fakeWindow({ search = '', stored = null, matches = false } = {}) {
  const listeners = new Map();
  const queryListeners = new Set();
  const win = {
    location: { search },
    localStorage: { getItem: () => stored },
    matchMedia: (query) => {
      assert.equal(query, MOBILE_QUERY);
      return {
        get matches() {
          return win.matches;
        },
        addEventListener: (_, fn) => queryListeners.add(fn),
        removeEventListener: (_, fn) => queryListeners.delete(fn),
      };
    },
    dispatchEvent(event) {
      (listeners.get(event.type) ?? []).forEach((fn) => fn(event));
    },
    on: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    matches,
    flip(value) {
      win.matches = value;
      queryListeners.forEach((fn) => fn());
    },
  };
  return win;
}
const fakeDoc = () => ({ documentElement: { dataset: {} } });

test('index.html inline bootstrap query equals MOBILE_QUERY', () => {
  const html = fs.readFileSync(
    new URL('../../index.html', import.meta.url),
    'utf8',
  );
  const match = html.match(/MOBILE_QUERY\s*=\s*'([^']+)'/);
  assert.ok(match, 'index.html must define the inline MOBILE_QUERY');
  assert.equal(match[1], MOBILE_QUERY);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(html, /width=device-width, initial-scale=1\.0/);
});

test('override beats storage beats the media query', () => {
  assert.equal(resolveMobileMode(fakeWindow({ matches: true })), 'mobile');
  assert.equal(resolveMobileMode(fakeWindow({ matches: false })), 'desktop');
  assert.equal(
    resolveMobileMode(fakeWindow({ matches: false, stored: 'mobile' })),
    'mobile',
  );
  assert.equal(
    resolveMobileMode(
      fakeWindow({ matches: true, stored: 'mobile', search: '?ui=desktop' }),
    ),
    'desktop',
  );
  assert.equal(
    resolveMobileMode(fakeWindow({ matches: true, stored: 'bogus' })),
    'mobile',
  );
});

test('installMobileMode sets data-ui and notifies only on flips', () => {
  const doc = fakeDoc();
  const win = fakeWindow({ matches: false });
  const seen = [];
  win.on('gev:ui-mode', (event) => seen.push(event.detail.mode));
  globalThis.CustomEvent ??= class extends Event {
    constructor(type, init) {
      super(type);
      this.detail = init?.detail;
    }
  };
  const dispose = installMobileMode(doc, win);
  assert.equal(doc.documentElement.dataset.ui, 'desktop');
  assert.equal(isMobileUi(doc), false);
  assert.deepEqual(seen, []);
  win.flip(true);
  assert.equal(isMobileUi(doc), true);
  win.flip(false);
  assert.deepEqual(seen, ['mobile', 'desktop']);
  dispose();
  win.flip(true);
  assert.deepEqual(seen, ['mobile', 'desktop']);
});
