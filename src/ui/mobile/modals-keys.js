/**
 * Provider settings ("POWER UP") on mobile. keySetup.js only keeps the chip and
 * dialog when the loopback dev endpoint answers, so this is dev-only:
 *  - the floating chip is hidden by CSS; a "Provider keys" sheet tile (only
 *    registered when the dialog really initialised) opens the same dialog by
 *    clicking the chip, so keySetup keeps its own open/close logic;
 *  - tooltip-only explanations (tier, browser-side, configured externally,
 *    remove) are copied into visible help lines.
 */
import { registerMobilePage } from './sheet.js';

const HELP_SOURCES = [
  ['.key-setup-tier', null],
  ['.key-setup-exposed', 'Browser-side: '],
  ['.key-setup-external', 'Externally managed: '],
];

/** Pure: the help lines a row needs, from the titles keySetup put on it. */
export function collectRowHelp(row) {
  const lines = [];
  for (const [selector, prefix] of HELP_SOURCES) {
    const title = row.querySelector(selector)?.getAttribute('title');
    if (title) lines.push(`${prefix ?? ''}${title}`);
  }
  return lines;
}

function addHelp(doc, row) {
  if (row.querySelector('.key-setup-help')) return;
  const lines = collectRowHelp(row);
  if (!lines.length) return;
  const help = doc.createElement('p');
  help.className = 'key-setup-help m-meta';
  help.textContent = lines.join('. ').replace(/\.\./g, '.');
  const unlocks = row.querySelector('.key-setup-unlocks');
  if (unlocks) unlocks.after(help);
  else row.append(help);
  for (const input of row.querySelectorAll('input[data-env-var]')) {
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
  }
}

export function installKeySetup(doc = document, win = window) {
  const dialog = doc.getElementById('key-setup');
  const chip = doc.getElementById('key-setup-chip');
  if (!dialog || !chip) return () => {};

  const disposers = [];
  const rows = dialog.querySelector('[data-key-setup-rows]');
  if (rows && typeof MutationObserver === 'function') {
    const decorate = () =>
      rows
        .querySelectorAll('.key-setup-row')
        .forEach((row) => addHelp(doc, row));
    const observer = new MutationObserver(decorate);
    observer.observe(rows, { childList: true });
    decorate();
    disposers.push(() => observer.disconnect());
  }

  // Register the sheet entry once keySetup has confirmed the endpoint.
  let page = null;
  let tries = 0;
  const label = () =>
    chip.querySelector('[data-key-setup-chip-label]')?.textContent?.trim() ||
    '';
  const ready = () =>
    dialog.dataset.initialized === 'true' &&
    chip.isConnected &&
    dialog.isConnected;
  const attempt = () => {
    if (page) return;
    if (ready()) {
      page = registerMobilePage({
        id: 'provider-keys',
        title: 'Provider keys',
        icon: 'bolt',
        order: 95,
        summary: label,
        mount(container, ctx) {
          const intro = doc.createElement('p');
          intro.className = 'm-meta';
          intro.textContent =
            'Developer setting. Only available when the app runs on its own dev server (localhost); keys are saved to this machine and never leave it.';
          const open = doc.createElement('button');
          open.type = 'button';
          open.className = 'm-btn';
          open.textContent = 'Open provider keys';
          open.addEventListener('click', () => {
            ctx.close();
            (doc.getElementById('key-setup-chip') ?? chip).click();
          });
          container.append(intro, open);
        },
      });
      return;
    }
    if (++tries < 40 && chip.isConnected) timer = win.setTimeout(attempt, 500);
  };
  let timer = win.setTimeout(attempt, 250);
  disposers.push(() => win.clearTimeout(timer));
  // Keep the tile summary ("3/9 KEYS") current when the chip label changes.
  const label$ = chip.querySelector('[data-key-setup-chip-label]');
  if (label$ && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => page?.notify());
    observer.observe(label$, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    disposers.push(() => observer.disconnect());
  }
  return () => disposers.forEach((dispose) => dispose());
}
