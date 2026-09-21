import { registerMobilePage } from '../sheet.js';

/** Stub owned by the scenes agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'scenes',
    title: 'Scenes',
    icon: '🎬',
    order: 30,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'Scenes - coming soon';
      container.append(stub);
    },
  });
}
