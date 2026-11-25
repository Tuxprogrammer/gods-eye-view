import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { installVueDom } from '../testSupport/vueDom.mjs';

let kit;
let uninstall;
before(async () => {
  uninstall = installVueDom();
  kit = await import('./forkKit.js');
});
after(() => uninstall());

test('a kit button comes back detached, with its attributes, content and native listeners', () => {
  const button = kit.kitButton(
    {
      id: 'probe',
      class: 'mobile-menu-btn',
      label: 'Menu',
      'aria-expanded': 'false',
    },
    () => kit.h('span', { class: 'bars' }),
  );
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.parentNode, null);
  assert.equal(button.type, 'button');
  assert.ok(button.classList.contains('ui-button'));
  assert.ok(button.classList.contains('mobile-menu-btn'));
  assert.equal(button.getAttribute('aria-label'), 'Menu');
  assert.equal(button.hasAttribute('title'), false, 'no tip unless asked');
  assert.ok(button.querySelector('span.bars'));
  let clicks = 0;
  button.addEventListener('click', () => clicks++);
  document.body.append(button);
  button.click();
  button.setAttribute('aria-expanded', 'true');
  assert.equal(clicks, 1);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.remove();
});

test('a text button, the close button and a glyph are the kit’s', () => {
  const cctv = kit.kitButton({ label: 'Open CCTV camera view' }, '📹');
  assert.equal(cctv.textContent, '📹');
  const close = kit.kitCloseButton({
    class: 'propagation-station-card-close',
    label: 'Close station details',
  });
  assert.ok(close.classList.contains('ui-close-button'));
  assert.ok(close.classList.contains('propagation-station-card-close'));
  assert.equal(close.getAttribute('aria-label'), 'Close station details');
  assert.equal(close.textContent, '×');
  const icon = kit.kitIcon('bolt', { class: 'mobile-tile__icon' });
  assert.equal(icon.tagName, 'SPAN');
  assert.ok(icon.classList.contains('material-symbols-outlined'));
  assert.ok(icon.classList.contains('mobile-tile__icon'));
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.textContent, 'bolt');
  assert.equal(icon.style.fontSize, '', 'sized by the caller’s CSS');
});
