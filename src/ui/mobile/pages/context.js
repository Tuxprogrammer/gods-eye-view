import { registerMobilePage } from '../sheet.js';

/** Stub owned by the context agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'context',
    title: 'Context',
    icon: '🌐',
    order: 50,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'Context - coming soon';
      container.append(stub);
    },
  });
}
