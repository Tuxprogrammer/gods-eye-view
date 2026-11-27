/**
 * Mobile "View" page: visual presets, parameters, map source, camera, and the
 * whole Display panel (#pp-toggles) - HUD, detection, 3D, scope, draw,
 * celestial, bloom, sharpen, clean view. Existing DOM is MOVED (never cloned)
 * so every id lookup and listener keeps working.
 *
 * Also owns the always-on camera buttons: #tilt-map-view and #reset-globe-view
 * move under the compass in #mobile-top-right, next to a new Orbit button
 * (desktop has only the O key), and the clean-view exit is a transient on-map
 * button (styled in mobile-view.css). The FPS readout (backtick key) gets a
 * switch on this page and its readout moves out of the hidden #title-bar.
 */
import { t } from '../../../i18n/index.js';
import { registerMobilePage, closeSheet } from '../sheet.js';
import { movePanel, restorePanel } from '../portal.js';
import {
  pressShortcut,
  presetHelp,
  setSwitchState,
  slotForNode,
  unavailableMapNotes,
  viewSummary,
  watchForElement,
} from '../view-helpers.js';

let installed = false;
let handle = null;

const byId = (id) => document.getElementById(id);
// The Visual panel's presets and map source (VisualPresets.vue), wherever
// this page has moved them.
const visualPresets = () => document.querySelector('.visual-presets');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function heading(slot, text) {
  const node = el('h3', `mv-h mv-h--${slot}`, text);
  return node;
}

/** Observe attribute changes on `node`; returns a disposer. */
function observeAttrs(node, filter, callback) {
  if (!node || typeof MutationObserver !== 'function') return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(node, { attributes: true, attributeFilter: filter });
  return () => observer.disconnect();
}

/** Proxy button: labelled 44px control that clicks the real (icon-only) one. */
function proxyButton({ label, glyph, targetId, pressedFrom }) {
  const button = el('button', 'm-btn mv-cam-btn');
  button.type = 'button';
  const icon = el('span', 'mv-cam-btn__icon', glyph);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon, el('span', 'mv-cam-btn__label', label));
  button.addEventListener('click', () => byId(targetId)?.click());
  const sync = () => {
    const real = byId(targetId);
    if (pressedFrom && real)
      button.setAttribute(
        'aria-pressed',
        real.getAttribute('aria-pressed') === 'true' ? 'true' : 'false',
      );
  };
  if (pressedFrom) {
    sync();
    observeAttrs(byId(targetId), ['aria-pressed'], sync);
  }
  return button;
}

function switchRow(label, hint, onToggle) {
  const button = el('button', 'm-btn mv-switch');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', 'false');
  const text = el('span', 'mv-switch__text');
  text.append(el('span', 'mv-switch__label', label));
  if (hint) text.append(el('span', 'm-meta mv-switch__hint', hint));
  button.append(text, el('span', 'mv-switch__state', t('Off')));
  button.addEventListener('click', onToggle);
  return button;
}

/** Orbit round button in the on-map column (mirrors #orbit-indicator). */
function installOrbitButton(topRight) {
  let button = byId('mobile-orbit-btn');
  if (!button) {
    button = el('button', 'mv-orbit-btn');
    button.id = 'mobile-orbit-btn';
    button.type = 'button';
    button.setAttribute(
      'aria-label',
      t('Toggle orbit around the current place'),
    );
    button.setAttribute('aria-pressed', 'false');
    const glyph = el('span', 'mv-orbit-btn__glyph', '↻');
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
    button.addEventListener('click', () => pressShortcut(document, 'orbit'));
    topRight.append(button);
  }
  return button;
}

function orbitActive() {
  return byId('orbit-indicator')?.classList.contains('active') === true;
}

export function install() {
  if (installed) return handle;
  installed = true;

  const topRight = byId('mobile-top-right');
  if (topRight) {
    // Compass is first (foundation); tilt, reset, orbit follow.
    movePanel(byId('tilt-map-view'), topRight, 'tilt-map-view');
    movePanel(byId('reset-globe-view'), topRight, 'reset-globe-view');
    const orbit = installOrbitButton(topRight);
    watchForElement(
      document.body,
      () => byId('orbit-indicator'),
      (indicator) => {
        const sync = () =>
          orbit.setAttribute('aria-pressed', String(orbitActive()));
        sync();
        observeAttrs(indicator, ['class'], sync);
      },
      { once: true },
    );
  }

  // FPS readout is injected into #title-bar (display:none on mobile): adopt
  // it into <body> so the switch on the page has something to show.
  let fpsReadout = null;
  const fpsListeners = new Set();
  const notifyFps = () => fpsListeners.forEach((fn) => fn());
  const titleBar = byId('title-bar');
  watchForElement(
    titleBar,
    () => titleBar?.querySelector('.frame-rate-readout'),
    (readout) => {
      if (fpsReadout && fpsReadout !== readout) {
        restorePanel('frame-rate-readout');
        fpsReadout.remove();
      }
      fpsReadout = readout;
      readout.classList.add('mv-fps-readout');
      movePanel(readout, document.body, 'frame-rate-readout');
      observeAttrs(readout, ['hidden'], notifyFps);
      notifyFps();
    },
  );

  // Clean view hides every control: close the sheet so the map is visible.
  if (typeof MutationObserver === 'function') {
    let wasClean = document.body.classList.contains('ui-clean-view');
    new MutationObserver(() => {
      const clean = document.body.classList.contains('ui-clean-view');
      if (clean && !wasClean) closeSheet();
      wasClean = clean;
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  handle = registerMobilePage({
    id: 'view',
    title: t('View'),
    icon: '🎛',
    order: 40,
    summary: () =>
      viewSummary({
        style: byId('active-style-name')?.textContent,
        source: visualPresets()?.querySelector('.visual-presets__status')
          ?.textContent,
      }),
    mount(container, ctx) {
      return mountView(container, ctx, {
        fpsListeners,
        getFps: () => fpsReadout,
      });
    },
  });

  // Keep the tile line live (active style / map source change from anywhere).
  if (typeof MutationObserver === 'function') {
    const refresh = () => handle.notify();
    const follow = (node) =>
      new MutationObserver(refresh).observe(node, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    const style = byId('active-style-name');
    if (style) follow(style);
    // The map source badge is the Visual panel's, which may render later.
    watchForElement(
      document.body,
      () => visualPresets()?.querySelector('.visual-presets__status'),
      (status) => {
        follow(status);
        refresh();
      },
      { subtree: true, once: true },
    );
  }
  return handle;
}

/** Build the View page; returns the cleanup the sheet runs on dispose. */
function mountView(container, ctx, { fpsListeners, getFps }) {
  container.classList.add('mv-page');
  const stops = [];

  // 1. Visual style presets and map source: the Visual panel's own section
  // (VisualPresets.vue, inside #pp-toggles), moved to the top of the page,
  // with the text a touch screen cannot show as a tip: the active preset's
  // description and the reason each unavailable map source is unavailable.
  container.append(heading('style', 'Visual style'));
  const presets = visualPresets();
  if (presets) movePanel(presets, container, 'view-visual-presets');
  const help = el('p', 'm-meta mv-style-help');
  help.setAttribute('aria-live', 'polite');
  const note = el('p', 'm-meta mv-map-note');
  container.append(help, note);
  const syncPresets = () => {
    const active =
      presets?.querySelector('.visual-presets__style.active') ??
      presets?.querySelector('.visual-presets__style');
    const { name, description } = presetHelp(active);
    help.replaceChildren();
    if (name) help.append(el('strong', 'mv-style-help__name', name));
    if (description) help.append(` — ${description}`);
    const lines = unavailableMapNotes(
      presets?.querySelectorAll('.visual-presets__chip'),
    );
    note.textContent = lines.join('\n');
    note.hidden = lines.length === 0;
  };
  syncPresets();
  if (presets && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(syncPresets);
    observer.observe(presets, {
      attributes: true,
      attributeFilter: ['class', 'aria-disabled', 'title'],
      childList: true,
      subtree: true,
    });
    stops.push(() => observer.disconnect());
  }

  // 3. Camera.
  container.append(heading('camera', 'Camera'));
  const cam = el('div', 'mv-camera');
  const orbit = proxyButton({
    label: t('Orbit'),
    glyph: '↻',
    targetId: 'mobile-orbit-btn',
    pressedFrom: true,
  });
  const tilt = proxyButton({
    label: t('Tilt'),
    glyph: '◢',
    targetId: 'tilt-map-view',
    pressedFrom: true,
  });
  const north = proxyButton({
    label: t('North up'),
    glyph: 'N',
    targetId: 'north-up-view',
  });
  const globe = proxyButton({
    label: t('Full globe'),
    glyph: '○',
    targetId: 'reset-globe-view',
  });
  cam.append(orbit, tilt, north, globe);
  container.append(cam);
  container.append(
    el(
      'p',
      'm-meta mv-camera-note',
      'Orbit circles the current place - fly to a place first. These also sit under the compass.',
    ),
  );

  // 4. Display panel: same #pp-toggles node, shell neutralised by CSS
  //    (display: contents) so groups flow into this page's single scroller.
  container.append(heading('display', 'Display & effects'));
  const pp = byId('pp-toggles');
  if (pp) {
    // The groups sit in the panel body; Vue adds some (sky, frame rate)
    // later, so they are slotted again when the body's children change.
    const body = pp.querySelector('.pp-panel-body') ?? pp;
    const slotGroups = () => {
      for (const child of Array.from(body.children)) {
        const slot = slotForNode(child);
        if (slot && child.dataset.mvSlot !== slot) child.dataset.mvSlot = slot;
      }
    };
    slotGroups();
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(slotGroups);
      observer.observe(body, { childList: true });
      stops.push(() => observer.disconnect());
    }
    movePanel(pp, container, 'view-pp-toggles');
  }
  const cleanHint = el(
    'p',
    'm-meta mv-clean-hint',
    'Clean UI hides every control. Tap EXIT CLEAN VIEW at the top of the screen to bring them back.',
  );
  cleanHint.dataset.mvSlot = 'clean-hint';
  container.append(cleanHint);
  // The sheet also closes from the body-class observer; this covers the
  // toggle being pressed while already peeked.
  const cleanToggle = byId('clean-view-toggle');
  const closeOnClean = () => ctx.close();
  cleanToggle?.addEventListener('click', closeOnClean);
  stops.push(() => cleanToggle?.removeEventListener('click', closeOnClean));

  // 5. FPS readout switch.
  const fps = switchRow(
    'Frame-rate readout',
    'Shows FPS at the top-left of the map.',
    () => pressShortcut(document, 'fps'),
  );
  fps.dataset.mvSlot = 'fps';
  const syncFps = () => setSwitchState(fps, getFps()?.hidden === false);
  fpsListeners.add(syncFps);
  stops.push(() => fpsListeners.delete(syncFps));
  syncFps();
  container.append(fps);
  return () => {
    for (const stop of stops.splice(0)) stop();
  };
}
