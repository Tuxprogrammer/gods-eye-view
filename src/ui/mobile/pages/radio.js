import { registerMobilePage } from '../sheet.js';

/** Stub owned by the radio agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'radio',
    title: 'Radio',
    icon: '📻',
    order: 70,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'Radio - coming soon';
      container.append(stub);
    },
  });
}
