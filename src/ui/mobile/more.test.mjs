import assert from 'node:assert/strict';
import test from 'node:test';
import { switchToDesktopUi, withParam } from './pages/more.js';

test('withParam keeps the rest of the URL', () => {
  assert.equal(
    withParam('https://x.test/app?a=1&ui=mobile#h', 'ui', 'desktop'),
    'https://x.test/app?a=1&ui=desktop#h',
  );
  assert.equal(
    withParam('https://x.test/', 'welcome', '1'),
    'https://x.test/?welcome=1',
  );
});

test('the desktop switch stores the choice and reloads with ?ui=desktop', () => {
  const stored = {};
  let target = '';
  switchToDesktopUi({
    localStorage: { setItem: (k, v) => (stored[k] = v) },
    location: {
      href: 'https://x.test/?ui=mobile',
      assign: (u) => (target = u),
    },
  });
  assert.equal(stored['godsEyeView.ui'], 'desktop');
  assert.equal(target, 'https://x.test/?ui=desktop');
});
