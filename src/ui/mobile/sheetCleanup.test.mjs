import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { installVueDom } from '../../testSupport/vueDom.mjs';

let uninstall;
let sheet;
before(async () => {
  uninstall = installVueDom();
  sheet = await import('./sheet.js');
});
after(() => uninstall());

test('a page mounted in the sheet is cleaned up when the sheet is disposed', () => {
  let mounted = 0;
  let cleaned = 0;
  sheet.registerMobilePage({
    id: 'cleanup-probe',
    title: 'Probe',
    icon: '·',
    order: 99,
    mount(container) {
      mounted++;
      container.append(document.createElement('p'));
      return () => cleaned++;
    },
  });
  const dispose = sheet.installSheet(document, window);
  sheet.openSheet('cleanup-probe');
  assert.equal(mounted, 1);
  assert.equal(cleaned, 0);
  dispose();
  assert.equal(cleaned, 1);
  // A second sheet mounts the page anew.
  const again = sheet.installSheet(document, window);
  sheet.openSheet('cleanup-probe');
  assert.equal(mounted, 2);
  again();
  assert.equal(cleaned, 2);
});
