import { registerMobilePage } from '../sheet.js';

/** Stub owned by the voice agent: replace mount() with the real page. */
export function install() {
  return registerMobilePage({
    id: 'voice',
    title: 'Voice',
    icon: '🎙',
    order: 80,
    mount(container) {
      const stub = document.createElement('p');
      stub.className = 'mobile-stub';
      stub.textContent = 'Voice - coming soon';
      container.append(stub);
    },
  });
}
