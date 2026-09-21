/**
 * Mobile Scenes page. Moves the existing #scene-panel (same node, so
 * SceneControls keeps working) and #share-btn into the sheet. Adds:
 *  - in-sheet inline dialogs replacing window.prompt/confirm (NEW, DEL scene,
 *    DEL shot); the click is replayed with the answer pre-supplied,
 *  - an explicit RENAME button and touch long-press on each shot label
 *    (replaces the desktop double-click),
 *  - a transient playback bar (#mobile-scene-bar) that stays on the map while
 *    a scene runs: status text (#scene-runtime moved in), progress, STOP,
 *  - share via navigator.share when available (else the original clipboard
 *    handler runs and its toast is routed by the status owner).
 */
import { registerMobilePage } from '../sheet.js';
import { movePanel } from '../portal.js';
import {
  parsePercent,
  runWithDialogAnswers,
  scenesSummary,
} from '../scenes-bridge.js';

const STATUS_EVENT = 'gev:mobile-status';
const LONG_PRESS_MS = 520;
const LONG_PRESS_SLOP = 10;

const $ = (id) => document.getElementById(id);

function make(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  return node;
}

function status(text, kind = 'info') {
  window.dispatchEvent(
    new CustomEvent(STATUS_EVENT, { detail: { text, kind, id: 'scenes' } }),
  );
}

function readSceneState() {
  const select = $('scene-select');
  const option = select?.selectedOptions?.[0];
  return {
    running: Boolean($('scene-stop-btn') && !$('scene-stop-btn').disabled),
    sceneTitle: option?.textContent?.trim() ?? '',
    shotCount: document.querySelectorAll('#scene-shot-list .scene-shot-row')
      .length,
  };
}

/** Playback chrome: exists from install() so it works with the sheet closed. */
function installPlaybackBar() {
  const stop = $('scene-stop-btn');
  const runtime = $('scene-runtime');
  const fill = $('scene-progress-fill');
  const bar = make('div', 'm-scene-bar', {
    id: 'mobile-scene-bar',
    role: 'region',
    'aria-label': 'Scene playback',
  });
  bar.hidden = true;
  const text = make('div', 'm-scene-bar__text');
  const track = make('div', 'm-scene-bar__track');
  const meter = make('div', 'm-scene-bar__fill');
  track.append(meter);
  const stopBtn = make('button', 'm-btn m-scene-bar__stop', {
    type: 'button',
    'aria-label': 'Stop scene playback',
  });
  stopBtn.textContent = '■ Stop';
  stopBtn.addEventListener('click', () => {
    const target = $('scene-stop-btn');
    if (target && !target.disabled) target.click();
  });
  const main = make('div', 'm-scene-bar__main');
  main.append(text, track);
  bar.append(main, stopBtn);
  document.body.append(bar);
  if (runtime) movePanel(runtime, text, 'scene-runtime');

  const sync = () => {
    const playing =
      document.body.classList.contains('scene-playback-mode') ||
      Boolean(stop && !stop.disabled);
    bar.hidden = !playing;
    meter.style.width = `${parsePercent(fill?.style?.width)}%`;
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  if (stop)
    observer.observe(stop, { attributes: true, attributeFilter: ['disabled'] });
  if (fill)
    observer.observe(fill, {
      attributes: true,
      attributeFilter: ['style'],
      childList: true,
      characterData: true,
    });
  sync();
}

export function install() {
  let page = null;
  let ctx = null;
  let dialog = null;
  let bypass = false;

  function closeDialog() {
    dialog?.remove();
    dialog = null;
  }

  /** Show an inline prompt/confirm. onOk receives the typed value. */
  function ask(container, { message, value, okLabel, danger, onOk }) {
    closeDialog();
    dialog = make('form', 'm-dialog', {
      role: 'alertdialog',
      'aria-label': message,
    });
    const label = make('p', 'm-dialog__message');
    label.textContent = message;
    dialog.append(label);
    let input = null;
    if (value !== undefined) {
      input = make('input', 'm-dialog__input', {
        type: 'text',
        'aria-label': message,
        maxlength: '120',
        enterkeyhint: 'done',
      });
      input.value = value;
      dialog.append(input);
    }
    const actions = make('div', 'm-dialog__actions');
    const cancel = make('button', 'm-btn', { type: 'button' });
    cancel.textContent = 'Cancel';
    const ok = make(
      'button',
      `m-btn m-dialog__ok${danger ? ' m-dialog__ok--danger' : ''}`,
      { type: 'submit' },
    );
    ok.textContent = okLabel;
    actions.append(cancel, ok);
    dialog.append(actions);
    cancel.addEventListener('click', closeDialog);
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeDialog();
      }
    });
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      const answer = input ? input.value.trim() : '';
      if (input && !answer) return;
      closeDialog();
      onOk(answer);
    });
    container.prepend(dialog);
    (input ?? ok).focus();
    input?.select();
  }

  function replay(button, answers) {
    bypass = true;
    try {
      runWithDialogAnswers(window, answers, () => button.click());
    } finally {
      bypass = false;
    }
  }

  function interceptClick(event, container) {
    if (bypass) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Share: native sheet when available; otherwise the original clipboard path.
    const share = target.closest('#share-btn');
    if (share) {
      if (!navigator.share || !window.location.hash) return;
      event.preventDefault();
      event.stopPropagation();
      navigator
        .share({ title: "God's Eye View", url: window.location.href })
        .then(() => status('Shared'))
        .catch((error) => {
          if (error?.name === 'AbortError') return;
          bypass = true;
          try {
            share.click();
          } finally {
            bypass = false;
          }
        });
      return;
    }

    const newBtn = target.closest('#scene-new-btn');
    if (newBtn) {
      event.preventDefault();
      event.stopPropagation();
      const count = $('scene-select')?.options?.length ?? 0;
      ask(container, {
        message: 'New scene name',
        value: `Scene ${count + 1}`,
        okLabel: 'Create',
        onOk: (name) => replay(newBtn, { prompt: name }),
      });
      return;
    }

    const delScene = target.closest('#scene-delete-btn');
    if (delScene) {
      event.preventDefault();
      event.stopPropagation();
      const title = $('scene-select')?.selectedOptions?.[0]?.textContent ?? '';
      ask(container, {
        message: `Delete scene "${title}" and all its shots?`,
        okLabel: 'Delete',
        danger: true,
        onOk: () => replay(delScene, { confirm: true }),
      });
      return;
    }

    const delShot = target.closest('.scene-shot-danger');
    if (delShot) {
      event.preventDefault();
      event.stopPropagation();
      const name =
        delShot
          .closest('.scene-shot-row')
          ?.querySelector('.scene-shot-label')
          ?.textContent?.trim() ?? 'this shot';
      ask(container, {
        message: `Delete shot "${name}"?`,
        okLabel: 'Delete',
        danger: true,
        onOk: () => replay(delShot, { confirm: true }),
      });
      return;
    }

    // Running a scene: get the sheet out of the way so it is watchable.
    const start = target.closest('#scene-start-btn');
    if (start && !start.disabled) setTimeout(() => ctx?.close(), 0);
    // Loading a shot: peek so the camera move is visible.
    if (
      target.closest(
        '.scene-shot-btn:not(.scene-shot-danger):not(.m-rename-btn)',
      )
    )
      ctx?.peek(true);
  }

  // Shot rows are re-rendered by SceneControls; decorate them after each render.
  function decorateRows(list) {
    for (const row of list.querySelectorAll('.scene-shot-row')) {
      const label = row.querySelector('.scene-shot-label');
      const actions = row.querySelector('.scene-shot-actions');
      if (!label || !actions || actions.querySelector('.m-rename-btn'))
        continue;
      label.title = 'Long-press or tap RENAME to rename';
      const rename = make('button', 'scene-shot-btn m-rename-btn', {
        type: 'button',
        'aria-label': 'Rename shot',
      });
      rename.textContent = 'RENAME';
      rename.addEventListener('click', () => startRename(label));
      actions.insertBefore(rename, actions.querySelector('.scene-shot-danger'));
    }
  }

  function startRename(label) {
    if (label.querySelector('input')) return;
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }

  function bindLongPress(list) {
    let timer = 0;
    let origin = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
      origin = null;
    };
    list.addEventListener('pointerdown', (event) => {
      const label = event.target.closest?.('.scene-shot-label');
      if (!label || event.pointerType === 'mouse') return;
      origin = { x: event.clientX, y: event.clientY };
      timer = window.setTimeout(() => {
        timer = 0;
        startRename(label);
      }, LONG_PRESS_MS);
    });
    list.addEventListener('pointermove', (event) => {
      if (
        origin &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >
          LONG_PRESS_SLOP
      )
        cancel();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'])
      list.addEventListener(type, cancel);
  }

  function mount(container, pageCtx) {
    ctx = pageCtx;
    container.classList.add('m-scenes');

    const shareBtn = $('share-btn');
    if (shareBtn) {
      if (!shareBtn.querySelector('.m-btn-label')) {
        const label = make('span', 'm-btn-label');
        label.textContent = 'Share this view';
        shareBtn.append(label);
      }
      shareBtn.classList.add('m-btn', 'm-scenes__share');
      movePanel(shareBtn, container, 'share-btn');
    }
    const panel = $('scene-panel');
    if (panel) movePanel(panel, container, 'scene-panel');

    container.addEventListener(
      'click',
      (event) => interceptClick(event, container),
      true,
    );

    const list = $('scene-shot-list');
    if (list) {
      decorateRows(list);
      new MutationObserver(() => decorateRows(list)).observe(list, {
        childList: true,
      });
      bindLongPress(list);
    }
  }

  page = registerMobilePage({
    id: 'scenes',
    title: 'Scenes',
    icon: '🎬',
    order: 30,
    summary: () => scenesSummary(readSceneState()),
    mount,
    onHide: () => closeDialog(),
  });

  installPlaybackBar();

  // Keep the tile summary live while the sheet is closed.
  const refresh = () => page.notify();
  const observer = new MutationObserver(refresh);
  for (const id of ['scene-select', 'scene-shot-list']) {
    const node = $(id);
    if (node) observer.observe(node, { childList: true });
  }
  const stop = $('scene-stop-btn');
  if (stop)
    observer.observe(stop, { attributes: true, attributeFilter: ['disabled'] });
  return page;
}
