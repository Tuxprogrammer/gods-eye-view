import { registerMobilePage } from '../sheet.js';

/** Stub owned by the layers agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'layers',
    title: 'Layers',
    icon: '🗂',
    order: 20,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'Layers - coming soon';
      container.append(stub);
    },
  });
}
