/**
 * Mobile voice: a 52px mic FAB (bottom-right) plus a Voice page.
 *
 * The FAB is the REAL #gev-voice-control node (built at runtime by
 * src/voice/control.js inside #command-dock, which is display:none on mobile),
 * moved to <body> by install() as soon as it exists. CSS reduces it to the mic
 * button. Tap = start/stop (the existing click handler), long-press = open the
 * Voice page. The page never moves the control's children: it MIRRORS status,
 * tier and cost (text only, no ids) and proxies taps to the real buttons, so
 * the voice controller's cached element refs stay valid.
 */
import { registerMobilePage } from '../sheet.js';
import { movePanel } from '../portal.js';
import { isMobileUi } from '../../mobileMode.js';
import {
  fabLabel,
  isSessionBusy,
  statusWord,
  voiceSupport,
} from '../voice-support.js';

const FAB_KEY = 'voice:fab';
const LONG_PRESS_MS = 500;
const ROOT_ID = 'gev-voice-control';

let handle = null;
let root = null; // the real #gev-voice-control once found
let support = { ok: true };
const listeners = new Set(); // page refreshers
let rootObserver = null;
let mutationWatcher = null;

const byId = (id) => document.getElementById(id);
const q = (selector) => root?.querySelector(selector) ?? null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function currentStatus() {
  return root?.dataset.status || 'idle';
}

function tierState() {
  const button = q('#gev-voice-tier');
  return {
    mini: button?.getAttribute('aria-pressed') === 'true',
    label: button?.textContent?.trim() || 'STD',
    note: button?.title || '',
  };
}

function costState() {
  const node = q('#gev-voice-cost-value');
  return {
    text: node?.textContent?.trim() || '~$0.00',
    level: node?.dataset.level || 'ok',
    note: node?.title || '',
  };
}

function summary() {
  if (!support.ok) return 'Needs a secure (https) connection';
  const tier = tierState();
  return `${statusWord(currentStatus())} - ${tier.label} ${costState().text}`;
}

function refreshAll() {
  if (root && isMobileUi()) {
    const status = currentStatus();
    const button = q('#gev-voice-button');
    button?.setAttribute('aria-label', fabLabel(status, support));
    root.dataset.voiceSupport = support.ok ? 'ok' : support.reason;
  }
  handle?.notify();
  for (const refresh of listeners) refresh();
}

/** Push a one-line message to the shared status strip. */
function say(text, kind = 'info', ttl = 4000) {
  window.dispatchEvent(
    new CustomEvent('gev:mobile-status', {
      detail: { text, kind, ttl, id: 'voice' },
    }),
  );
}

function openVoicePage() {
  window.dispatchEvent(
    new CustomEvent('gev:mobile-open', { detail: { page: 'voice' } }),
  );
}

/** Move the control to <body>, style it as a FAB and wire touch behaviour. */
function attachFab(node) {
  if (root === node) return;
  root = node;
  support = voiceSupport(window);
  movePanel(node, document.body, FAB_KEY);
  node.dataset.mobileFab = 'true';

  const button = q('#gev-voice-button');
  let timer = 0;
  let longFired = false;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  button?.addEventListener('pointerdown', () => {
    longFired = false;
    cancel();
    timer = window.setTimeout(() => {
      longFired = true;
      openVoicePage();
    }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    button?.addEventListener(type, cancel);
  }
  button?.addEventListener('contextmenu', (event) => {
    if (isMobileUi()) event.preventDefault();
  });
  // Capture on the root: runs before the button's own start/stop handler.
  node.addEventListener(
    'click',
    (event) => {
      if (!isMobileUi() || !event.target?.closest?.('#gev-voice-button'))
        return;
      if (longFired) {
        longFired = false;
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (!support.ok && !isSessionBusy(currentStatus())) {
        event.stopPropagation();
        event.preventDefault();
        say('Voice needs https - see the Voice page', 'warn', 5000);
        openVoicePage();
      }
    },
    true,
  );

  // Status/tier/cost text changes -> refresh tile, aria-label and page.
  mutationWatcher?.disconnect();
  let lastStatus = currentStatus();
  mutationWatcher = new MutationObserver(() => {
    const status = currentStatus();
    if (status === 'error' && lastStatus !== 'error') {
      say('Voice error - long-press the mic for details', 'error', 6000);
    }
    lastStatus = status;
    refreshAll();
  });
  mutationWatcher.observe(node, {
    attributes: true,
    attributeFilter: ['data-status', 'aria-pressed', 'data-level'],
    childList: true,
    subtree: true,
    characterData: true,
  });
  refreshAll();
}

function findAndAttach() {
  const node = byId(ROOT_ID);
  if (!node) return false;
  attachFab(node);
  return true;
}

/** Register the page and pull the mic control out of the hidden dock. */
export function install() {
  handle = registerMobilePage({
    id: 'voice',
    title: 'Voice',
    icon: '🎙',
    order: 80,
    summary,
    mount,
    onShow: refreshAll,
  });
  if (findAndAttach()) return handle;
  // voice/control.js builds the node during app init, possibly after us.
  rootObserver?.disconnect();
  rootObserver = new MutationObserver(() => {
    if (!findAndAttach()) return;
    rootObserver?.disconnect();
    rootObserver = null;
  });
  rootObserver.observe(document.body, { childList: true, subtree: true });
  // Give up after a while so a failed voice init costs nothing forever.
  window.setTimeout(() => {
    rootObserver?.disconnect();
    rootObserver = null;
  }, 60000);
  return handle;
}

function mount(container) {
  container.classList.add('mv-voice');

  const banner = el('div', 'mv-banner');
  banner.setAttribute('role', 'alert');
  banner.hidden = true;

  // Status + start/stop -------------------------------------------------
  const statusCard = el('section', 'mv-card mv-status');
  statusCard.append(el('h3', 'mv-heading', 'Status'));
  const word = el('div', 'mv-status-word');
  word.setAttribute('role', 'status');
  word.setAttribute('aria-live', 'polite');
  const detail = el('div', 'm-meta mv-detail');
  const toggle = el('button', 'm-btn mv-toggle');
  toggle.type = 'button';
  toggle.addEventListener('click', () => {
    if (!support.ok) return;
    q('#gev-voice-button')?.click();
  });
  statusCard.append(word, detail, toggle);

  // Error ---------------------------------------------------------------
  const errorCard = el('section', 'mv-card mv-error');
  errorCard.setAttribute('role', 'alert');
  errorCard.append(el('h3', 'mv-heading', 'Voice system error'));
  const errorText = el('div', 'mv-error-text');
  const errorHint = el(
    'p',
    'm-meta',
    'Check microphone permission and network access, then try again.',
  );
  const retry = el('button', 'm-btn', 'Try again');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    dismissed = false;
    q('#gev-voice-button')?.click();
  });
  const dismiss = el('button', 'm-btn', 'Dismiss');
  dismiss.type = 'button';
  let dismissed = false;
  dismiss.addEventListener('click', () => {
    dismissed = true;
    root?.classList.add('error-dismissed'); // same flag the desktop tray uses
    render();
  });
  const errorActions = el('div', 'mv-actions');
  errorActions.append(retry, dismiss);
  errorCard.append(errorText, errorHint, errorActions);

  // Tier ------------------------------------------------------------------
  const tierCard = el('section', 'mv-card mv-tier');
  tierCard.append(el('h3', 'mv-heading', 'Model tier'));
  const seg = el('div', 'mv-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Voice model tier');
  const stdBtn = el('button', 'm-btn mv-seg-btn', 'Standard');
  const miniBtn = el('button', 'm-btn mv-seg-btn', 'Mini');
  for (const [button, wantMini] of [
    [stdBtn, false],
    [miniBtn, true],
  ]) {
    button.type = 'button';
    button.addEventListener('click', () => {
      if (tierState().mini !== wantMini) q('#gev-voice-tier')?.click();
    });
    seg.append(button);
  }
  const tierNote = el('p', 'm-meta mv-note');
  tierCard.append(
    seg,
    tierNote,
    el(
      'p',
      'm-meta mv-note',
      'Standard is smarter; Mini is cheaper. A change applies to the next session.',
    ),
  );

  // Cost ------------------------------------------------------------------
  const costCard = el('section', 'mv-card mv-cost');
  costCard.append(el('h3', 'mv-heading', 'Session cost (estimate)'));
  const costValue = el('div', 'mv-cost-value');
  const costNote = el('p', 'm-meta mv-note');
  costCard.append(costValue, costNote);

  // Help ------------------------------------------------------------------
  const help = el('section', 'mv-card mv-help');
  help.append(el('h3', 'mv-heading', 'How to use'));
  const list = el('ul', 'mv-help-list');
  for (const line of [
    'Tap the mic button (bottom-right) to start. Tap it again to stop.',
    'Long-press the mic button to open this page.',
    'Just say what you want the map to do, or ask a question.',
    'The microphone is only open while the status says Listening.',
  ]) {
    list.append(el('li', 'm-meta', line));
  }
  help.append(list);

  container.append(banner, statusCard, errorCard, tierCard, costCard, help);

  function render() {
    const status = currentStatus();
    const busy = isSessionBusy(status);
    banner.hidden = support.ok;
    banner.textContent = support.message || '';
    word.textContent = statusWord(status);
    word.dataset.status = status;
    detail.textContent =
      q('#gev-voice-detail')?.textContent?.trim() || 'Voice standby';
    toggle.textContent = busy ? 'Stop voice' : 'Start voice';
    toggle.disabled = !support.ok;
    toggle.dataset.busy = String(busy);
    const isError = status === 'error' && !dismissed;
    if (status !== 'error') dismissed = false;
    errorCard.hidden = !isError;
    errorText.textContent =
      q('#gev-voice-error-detail')?.textContent?.trim() ||
      'Voice session could not be started.';
    const tier = tierState();
    stdBtn.setAttribute('aria-pressed', String(!tier.mini));
    miniBtn.setAttribute('aria-pressed', String(tier.mini));
    tierNote.textContent = tier.note;
    const cost = costState();
    costValue.textContent = cost.text;
    costValue.dataset.level = cost.level;
    costNote.textContent = cost.note;
  }

  render();
  listeners.add(render);
  return () => listeners.delete(render);
}
