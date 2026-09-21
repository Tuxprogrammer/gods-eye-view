import { registerMobilePage } from '../sheet.js';

/** Stub owned by the cctv agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'cctv',
    title: 'CCTV',
    icon: '📹',
    order: 60,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'CCTV - coming soon';
      container.append(stub);
    },
  });
}
