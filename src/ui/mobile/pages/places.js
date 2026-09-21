import { registerMobilePage } from '../sheet.js';

/** Stub owned by the places agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'places',
    title: 'Places',
    icon: '📍',
    order: 10,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'Places - coming soon';
      container.append(stub);
    },
  });
}
