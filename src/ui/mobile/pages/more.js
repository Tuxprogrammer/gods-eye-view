import pkg from '../../../../package.json' with { type: 'json' };
import { registerMobilePage } from '../sheet.js';
import { UI_STORAGE_KEY } from '../../mobileMode.js';

/**
 * "More" page: About/credits, Welcome replay, Developer toggles and the
 * Desktop UI switch. Owned by Foundation.
 */

const APP_NAME = "God's Eye View";
const GIZMO_DEBUG_KEY = '__gevGizmoDebug';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function group(title) {
  const section = el('section', 'mobile-more__group');
  section.append(el('h3', 'mobile-more__heading', title));
  return section;
}

function action(label, hint, onClick) {
  const button = el('button', 'm-btn mobile-more__action');
  button.type = 'button';
  const name = el('span', 'mobile-more__action-name', label);
  button.append(name);
  if (hint) button.append(el('span', 'm-meta mobile-more__action-hint', hint));
  button.addEventListener('click', onClick);
  return button;
}

function toggle(label, hint, checked, onChange) {
  const row = el('label', 'm-row mobile-more__toggle');
  const text = el('span', 'mobile-more__toggle-text');
  text.append(el('span', '', label));
  if (hint) text.append(el('span', 'm-meta', hint));
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(text, input);
  return row;
}

/** Same URL with `key=value` set (other params, path and hash preserved). */
export function withParam(href, key, value) {
  const url = new URL(href);
  url.searchParams.set(key, value);
  return url.toString();
}

/** Open Cesium's own attribution lightbox (the "Data attribution" link). */
export function openCreditLightbox(doc = document) {
  const link = doc.querySelector('#cesium-credits .cesium-credit-expand-link');
  if (!link) return false;
  link.click();
  return true;
}

export function switchToDesktopUi(win = window) {
  try {
    win.localStorage.setItem(UI_STORAGE_KEY, 'desktop');
  } catch {
    /* storage blocked: the ?ui= param below still wins */
  }
  win.location.assign(withParam(win.location.href, 'ui', 'desktop'));
}

export function replayWelcome(win = window) {
  win.location.assign(withParam(win.location.href, 'welcome', '1'));
}

export function install() {
  return registerMobilePage({
    id: 'more',
    title: 'More',
    icon: '⋯',
    order: 90,
    summary: () => `v${pkg.version}`,
    mount(container, ctx) {
      const about = group('About');
      const brand = el('div', 'mobile-more__brand');
      const logo = el('img', 'mobile-more__logo');
      logo.src = '/logo.svg';
      logo.alt = '';
      logo.width = 20;
      logo.height = 20;
      const name = el('span', 'mobile-more__name', APP_NAME);
      const version = el('span', 'm-meta', `Version ${pkg.version}`);
      brand.append(logo, name, version);
      const credits = action(
        'Data attribution',
        'Map, imagery and data credits',
        () => {
          ctx.close();
          // Let the sheet slide away first; the lightbox is a full overlay.
          setTimeout(() => {
            if (!openCreditLightbox()) {
              window.dispatchEvent(
                new CustomEvent('gev:mobile-status', {
                  detail: {
                    text: 'Attribution is not loaded yet',
                    kind: 'warn',
                  },
                }),
              );
            }
          }, 250);
        },
      );
      about.append(brand, credits);

      const welcome = group('Welcome');
      welcome.append(
        action('Replay welcome', 'Show the first-run mission launcher', () =>
          replayWelcome(),
        ),
      );

      const dev = group('Developer');
      dev.append(
        toggle(
          'Gizmo debug tracing',
          'Console logging for the CCTV calibration gizmo',
          Boolean(window[GIZMO_DEBUG_KEY]),
          (on) => {
            window[GIZMO_DEBUG_KEY] = on;
          },
        ),
        action('Reload app', 'Restart with the current settings', () =>
          window.location.reload(),
        ),
      );

      const ui = group('Interface');
      ui.append(
        action(
          'Switch to desktop UI',
          'Reloads with the full desktop layout. Add ?ui=mobile to come back.',
          () => switchToDesktopUi(),
        ),
      );

      container.append(about, welcome, dev, ui);
    },
  });
}
