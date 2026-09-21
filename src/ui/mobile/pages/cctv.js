/**
 * Mobile CCTV page. The desktop #cctv-panel is display:none in mobile (it
 * lives in the hidden right rail), so its CONTENT nodes are moved one by one
 * into this page (same nodes: cctvBindings/cctvPresentation keep their ids and
 * listeners). Moving the children rather than `.cctv-panel-inner` lets us
 * interleave mobile-only elements and avoids every `#cctv-panel.collapsed ...`
 * desktop hiding rule, without touching the panel's persisted collapsed state.
 *
 * Calibration (ADJUST world gizmo + numeric chips) is advanced and mouse-tuned,
 * so it sits behind a toggle with a desktop-recommended note; the numeric
 * chips are the touch path.
 */
import { registerMobilePage } from '../sheet.js';
import { movePanel } from '../portal.js';
import { currentCctvSummary, installCctvBridge } from '../cctv-bridge.js';

const byId = (id) => document.getElementById(id);

let page = null;
let liveCtx = null;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function mount(container, ctx) {
  liveCtx = ctx;
  container.classList.add('m-cctv');
  const inner = byId('cctv-panel')?.querySelector('.cctv-panel-inner');
  if (!inner) {
    container.append(make('p', 'm-meta', 'CCTV is unavailable.'));
    return;
  }

  const kids = [...inner.children].filter(
    (node) => !node.classList.contains('panel-header'),
  );
  const rows = kids.filter((node) => node.classList.contains('cctv-controls'));
  const frame = byId('cctv-frame-wrap');
  const badge = byId('cctv-source-badge');
  const meta = byId('cctv-meta');
  const calBlock = kids.find((node) =>
    node.classList.contains('cctv-calibration-block'),
  );
  const summaryLabel = kids.find((node) =>
    node.classList.contains('cctv-summary-label'),
  );
  const summaryText = byId('cctv-summary');

  const calToggle = make('button', 'm-btn m-cctv__cal-toggle');
  calToggle.type = 'button';
  calToggle.setAttribute('aria-expanded', 'false');
  calToggle.textContent = 'Calibration (advanced)';
  calToggle.addEventListener('click', () => {
    const open = !container.classList.contains('is-cal-open');
    container.classList.toggle('is-cal-open', open);
    calToggle.setAttribute('aria-expanded', String(open));
  });
  const calNote = make(
    'p',
    'm-meta m-cctv__note',
    'ADJUST drags a gizmo on the map and is best with a mouse (desktop recommended). On touch, tap a value below to type it. Drag the sheet handle to peek at the map while adjusting.',
  );

  // Enable/nearest first: CCTV starts off, so that is the primary action.
  const order = [
    rows[0],
    badge,
    meta,
    frame,
    ...rows.slice(1),
    calToggle,
    calNote,
    calBlock,
    summaryLabel,
    summaryText,
  ].filter(Boolean);
  order.forEach((node, index) => {
    if (kids.includes(node)) movePanel(node, container, `cctv:${index}`);
    else container.append(node);
  });
}

export function install() {
  if (page) return page;
  page = registerMobilePage({
    id: 'cctv',
    title: 'CCTV',
    icon: '📹',
    order: 60,
    summary: currentCctvSummary,
    mount,
    onShow(ctx) {
      liveCtx = ctx;
    },
    onHide() {
      liveCtx = null;
    },
  });
  installCctvBridge(page, () => liveCtx);
  return page;
}
