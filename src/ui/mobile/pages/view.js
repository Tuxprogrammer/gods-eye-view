import { registerMobilePage } from '../sheet.js';

/** Stub owned by the view agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'view',
    title: 'View',
    icon: '🎛',
    order: 40,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'View - coming soon';
      container.append(stub);
    },
  });
}
