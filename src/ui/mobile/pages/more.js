import { registerMobilePage } from '../sheet.js';

/** Stub owned by the more agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'more',
    title: 'More',
    icon: '⋯',
    order: 90,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'More - coming soon';
      container.append(stub);
    },
  });
}
