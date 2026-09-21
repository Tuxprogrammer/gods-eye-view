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
  button.append(text, el('span', 'mv-switch__state', 'Off'));
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
    button.setAttribute('aria-label', 'Toggle orbit around the current place');
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
    title: 'View',
    icon: '🎛',
    order: 40,
    summary: () =>
      viewSummary({
        style: byId('active-style-name')?.textContent,
        source: byId('map-stack-status')?.textContent,
      }),
    mount(container, ctx) {
      mountView(container, ctx, { fpsListeners, getFps: () => fpsReadout });
    },
  });

  // Keep the tile line live (active style / map source change from anywhere).
  if (typeof MutationObserver === 'function') {
    const refresh = () => handle.notify();
    for (const id of ['active-style-name', 'map-stack-status']) {
      const node = byId(id);
      if (node)
        new MutationObserver(refresh).observe(node, {
          childList: true,
          characterData: true,
          subtree: true,
        });
    }
  }
  return handle;
}

function mountView(container, ctx, { fpsListeners, getFps }) {
  container.classList.add('mv-page');

  // 1. Visual style presets (+ visible description, since title= is hidden).
  container.append(heading('style', 'Visual style'));
  const styleButtons = byId('style-buttons');
  if (styleButtons) movePanel(styleButtons, container, 'view-style-buttons');
  const help = el('p', 'm-meta mv-style-help');
  help.setAttribute('aria-live', 'polite');
  container.append(help);
  const syncHelp = () => {
    const active =
      styleButtons?.querySelector('.style-btn.active') ??
      styleButtons?.querySelector('.style-btn');
    const { name, description } = presetHelp(active);
    help.replaceChildren();
    if (name) help.append(el('strong', 'mv-style-help__name', name));
    if (description) help.append(` — ${description}`);
  };
  syncHelp();
  if (styleButtons && typeof MutationObserver === 'function') {
    new MutationObserver(syncHelp).observe(styleButtons, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
  }

  // 2. Map source chips (+ inline reason for unavailable ones).
  const mapSection = document.querySelector('.map-source-section');
  if (mapSection) {
    movePanel(mapSection, container, 'view-map-source');
    const note = el('p', 'm-meta mv-map-note');
    mapSection.append(note);
    const chips = byId('map-stack-chips');
    const syncNote = () => {
      const lines = unavailableMapNotes(chips?.children);
      note.textContent = lines.join('\n');
      note.hidden = lines.length === 0;
    };
    syncNote();
    if (chips && typeof MutationObserver === 'function')
      new MutationObserver(syncNote).observe(chips, { childList: true });
  }

  // 3. Camera.
  container.append(heading('camera', 'Camera'));
  const cam = el('div', 'mv-camera');
  const orbit = proxyButton({
    label: 'Orbit',
    glyph: '↻',
    targetId: 'mobile-orbit-btn',
    pressedFrom: true,
  });
  const tilt = proxyButton({
    label: 'Tilt',
    glyph: '◢',
    targetId: 'tilt-map-view',
    pressedFrom: true,
  });
  const north = proxyButton({
    label: 'North up',
    glyph: 'N',
    targetId: 'north-up-view',
  });
  const globe = proxyButton({
    label: 'Full globe',
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
    for (const child of Array.from(pp.children)) {
      const slot = slotForNode(child);
      if (slot) child.dataset.mvSlot = slot;
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
  byId('clean-view-toggle')?.addEventListener('click', () => {
    // The sheet also closes from the body-class observer; this covers the
    // toggle being pressed while already peeked.
    ctx.close();
  });

  // 5. FPS readout switch.
  const fps = switchRow(
    'Frame-rate readout',
    'Shows FPS at the top-left of the map.',
    () => pressShortcut(document, 'fps'),
  );
  fps.dataset.mvSlot = 'fps';
  const syncFps = () => setSwitchState(fps, getFps()?.hidden === false);
  fpsListeners.add(syncFps);
  syncFps();
  container.append(fps);
}
