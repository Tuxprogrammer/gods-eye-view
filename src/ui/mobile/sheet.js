/**
 * Mobile bottom sheet: a root list of section tiles plus one full-height page
 * per registered section. Pages register themselves via registerMobilePage();
 * they are mounted lazily on first open. See docs/mobile/DESIGN.md section 3.
 *
 * DOM (all created here, only visible under html[data-ui='mobile']):
 *   #mobile-sheet-backdrop, #mobile-sheet[data-state=open|closed]
 *     [data-view=root|page][data-peek=true|false][data-page=<id>]
 *     .mobile-sheet__handle, #mobile-sheet-back, #mobile-sheet-title,
 *     #mobile-sheet-close, #mobile-sheet-body >
 *       #mobile-root (button.mobile-tile[data-page]) and
 *       .mobile-page[data-page=<id>] > .mobile-page__body (mount container)
 * Events: listens `gev:mobile-open` {page}.
 */
const pages = new Map(); // id -> { def, mounted, body, section, tile }
let sheet = null; // live DOM/state once installSheet ran

const OPEN_EVENT = 'gev:mobile-open';

const sortedPages = () =>
  [...pages.values()].sort(
    (a, b) => (a.def.order ?? 100) - (b.def.order ?? 100),
  );

/** Register a sheet page. Returns { notify() } to refresh the tile summary. */
export function registerMobilePage(def) {
  if (!def?.id || typeof def.mount !== 'function') {
    throw new TypeError('registerMobilePage needs { id, mount }');
  }
  pages.set(def.id, {
    def,
    mounted: false,
    body: null,
    section: null,
    tile: null,
  });
  sheet?.renderRoot();
  return {
    notify() {
      sheet?.refreshTile(def.id);
    },
  };
}

export function getMobilePageIds() {
  return sortedPages().map((p) => p.def.id);
}

function el(doc, tag, className, attrs = {}) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
}

function iconNode(doc, icon) {
  const node = doc.createElement('span');
  node.className = 'mobile-tile__icon';
  node.setAttribute('aria-hidden', 'true');
  if (typeof icon === 'string' && /^[a-z][a-z0-9_]*$/.test(icon)) {
    node.classList.add('material-symbols-outlined');
    node.textContent = icon;
  } else if (icon && typeof icon === 'object' && icon.nodeType) {
    node.append(icon);
  } else {
    node.textContent = icon ?? '';
  }
  return node;
}

const HOME_TITLE = "God's Eye View";

/** Build the sheet once and wire it. Returns a disposer. Idempotent. */
export function installSheet(doc = document, win = window) {
  if (sheet) return sheet.dispose;
  const backdrop = el(doc, 'div', 'mobile-sheet__backdrop', {
    id: 'mobile-sheet-backdrop',
  });
  const root = el(doc, 'section', 'mobile-sheet', {
    id: 'mobile-sheet',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-label': 'Menu',
  });
  root.dataset.state = 'closed';
  root.dataset.view = 'root';
  root.dataset.peek = 'false';
  const handle = el(doc, 'button', 'mobile-sheet__handle', {
    type: 'button',
    'aria-label': 'Collapse or expand the menu',
  });
  handle.append(el(doc, 'span', 'mobile-sheet__grip'));
  const header = el(doc, 'header', 'mobile-sheet__header');
  const back = el(doc, 'button', 'mobile-sheet__back', {
    id: 'mobile-sheet-back',
    type: 'button',
    'aria-label': 'Back to menu',
  });
  back.textContent = '←';
  const logo = el(doc, 'img', 'mobile-sheet__logo', {
    src: '/logo.svg',
    alt: '',
    'aria-hidden': 'true',
  });
  const title = el(doc, 'h2', 'mobile-sheet__title', {
    id: 'mobile-sheet-title',
  });
  title.textContent = HOME_TITLE;
  const closeBtn = el(doc, 'button', 'mobile-sheet__close', {
    id: 'mobile-sheet-close',
    type: 'button',
    'aria-label': 'Close menu',
  });
  closeBtn.textContent = '✕';
  header.append(back, logo, title, closeBtn);
  const body = el(doc, 'div', 'mobile-sheet__body', {
    id: 'mobile-sheet-body',
  });
  const rootList = el(doc, 'div', 'mobile-root', { id: 'mobile-root' });
  body.append(rootList);
  root.append(handle, header, body);
  doc.body.append(backdrop, root);

  let openPage = null; // id of the visible page, null at root
  let historyPushed = false;
  let ignorePop = 0;

  const isOpen = () => root.dataset.state === 'open';

  function setPeek(on) {
    root.dataset.peek = on ? 'true' : 'false';
  }

  const ctxFor = (id) => ({
    close: () => close(),
    open: (pageId) => open(pageId),
    setTitle: (text) => {
      if (openPage === id) title.textContent = String(text ?? '');
    },
    peek: (on) => setPeek(on),
    isOpen: () => isOpen() && openPage === id,
  });

  function tileSummary(record) {
    try {
      return record.def.summary?.() ?? '';
    } catch (error) {
      console.warn('[mobile] summary failed', record.def.id, error);
      return '';
    }
  }

  function refreshTile(id) {
    const record = pages.get(id);
    const node = record?.tile?.querySelector('.mobile-tile__summary');
    if (node) node.textContent = tileSummary(record);
  }

  function renderRoot() {
    rootList.replaceChildren();
    for (const record of sortedPages()) {
      const tile = el(doc, 'button', 'mobile-tile', {
        type: 'button',
        'data-page': record.def.id,
      });
      const text = el(doc, 'span', 'mobile-tile__text');
      const name = el(doc, 'span', 'mobile-tile__title');
      name.textContent = record.def.title ?? record.def.id;
      const summary = el(doc, 'span', 'mobile-tile__summary');
      summary.textContent = tileSummary(record);
      text.append(name, summary);
      const chevron = el(doc, 'span', 'mobile-tile__chevron', {
        'aria-hidden': 'true',
      });
      chevron.textContent = '›';
      tile.append(iconNode(doc, record.def.icon), text, chevron);
      tile.addEventListener('click', () => open(record.def.id));
      record.tile = tile;
      rootList.append(tile);
    }
  }

  function mountPage(record) {
    if (record.mounted) return;
    record.mounted = true;
    const section = el(doc, 'section', 'mobile-page', {
      'data-page': record.def.id,
    });
    section.hidden = true;
    const pageBody = el(doc, 'div', 'mobile-page__body');
    section.append(pageBody);
    body.append(section);
    record.section = section;
    record.body = pageBody;
    try {
      record.def.mount(pageBody, ctxFor(record.def.id));
    } catch (error) {
      console.error('[mobile] page mount failed', record.def.id, error);
      pageBody.textContent = 'This section failed to load.';
    }
  }

  function hideCurrentPage() {
    if (!openPage) return;
    const record = pages.get(openPage);
    const id = openPage;
    openPage = null;
    if (!record) return;
    if (record.section) record.section.hidden = true;
    try {
      record.def.onHide?.(ctxFor(id));
    } catch (error) {
      console.error('[mobile] onHide failed', id, error);
    }
  }

  function showRoot() {
    hideCurrentPage();
    root.dataset.view = 'root';
    delete root.dataset.page;
    setPeek(false);
    title.textContent = HOME_TITLE;
    rootList.hidden = false;
    for (const id of pages.keys()) refreshTile(id);
    body.scrollTop = 0;
  }

  function showPage(id) {
    const record = pages.get(id);
    if (!record) return showRoot();
    if (openPage === id) return undefined;
    hideCurrentPage();
    mountPage(record);
    openPage = id;
    root.dataset.view = 'page';
    root.dataset.page = id;
    rootList.hidden = true;
    title.textContent = record.def.title ?? id;
    record.section.hidden = false;
    body.scrollTop = 0;
    try {
      record.def.onShow?.(ctxFor(id));
    } catch (error) {
      console.error('[mobile] onShow failed', id, error);
    }
    return undefined;
  }

  function menuState(expanded) {
    doc
      .getElementById('mobile-menu-btn')
      ?.setAttribute('aria-expanded', String(expanded));
  }

  function open(pageId) {
    if (!isOpen()) {
      root.dataset.state = 'open';
      backdrop.dataset.open = 'true';
      doc.documentElement.dataset.mobileSheet = 'open';
      if (!historyPushed) {
        try {
          win.history.pushState({ gevMobileSheet: true }, '');
          historyPushed = true;
        } catch {
          /* history unavailable */
        }
      }
    }
    if (pageId && pages.has(pageId)) showPage(pageId);
    else showRoot();
    menuState(true);
  }

  /** Close without touching history (used by popstate and mode flips). */
  function closeUi() {
    if (!isOpen()) return;
    hideCurrentPage();
    root.dataset.state = 'closed';
    root.dataset.view = 'root';
    setPeek(false);
    rootList.hidden = false;
    delete backdrop.dataset.open;
    delete doc.documentElement.dataset.mobileSheet;
    menuState(false);
  }

  function close() {
    if (!isOpen()) return;
    closeUi();
    if (historyPushed) {
      historyPushed = false;
      ignorePop += 1;
      try {
        win.history.back();
      } catch {
        ignorePop = 0;
      }
    }
  }

  const onPop = () => {
    if (ignorePop > 0) {
      ignorePop -= 1;
      return;
    }
    if (historyPushed) {
      historyPushed = false;
      closeUi();
    }
  };
  const onOpenEvent = (event) => {
    const page = event?.detail?.page;
    open(typeof page === 'string' ? page : undefined);
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && isOpen()) close();
  };
  // Scroll lock: while the sheet is open the page behind must not scroll or
  // rubber-band. CSS (overscroll-behavior, body overflow) does most of it; this
  // catches the gestures CSS cannot: drags that start on non-scrolling chrome
  // (handle, header) and scrollers already at their edge (iOS chains those to
  // the page). Touches inside a scroller that can still move are left alone.
  let touchY = 0;
  const scrollableAncestor = (node) => {
    for (let n = node; n && n !== root; n = n.parentElement) {
      if (n.nodeType !== 1) continue;
      const overflowY = win.getComputedStyle?.(n)?.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        n.scrollHeight > n.clientHeight + 1
      ) {
        return n;
      }
    }
    return null;
  };
  const onTouchStart = (event) => {
    touchY = event.touches?.[0]?.clientY ?? 0;
  };
  const onTouchMove = (event) => {
    if (!isOpen() || event.touches?.length !== 1 || !event.cancelable) return;
    const scroller = scrollableAncestor(event.target);
    if (!scroller) {
      event.preventDefault();
      return;
    }
    const dy = event.touches[0].clientY - touchY; // >0 = finger moving down
    const atTop = scroller.scrollTop <= 0;
    const atBottom =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    if ((dy > 0 && atTop) || (dy < 0 && atBottom)) event.preventDefault();
  };
  // Wheel / trackpad over the sheet never scrolls the page either.
  const onWheel = (event) => {
    if (isOpen() && !scrollableAncestor(event.target)) event.preventDefault();
  };
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('wheel', onWheel, { passive: false });

  const onBack = () => showRoot();
  const onHandle = () => setPeek(root.dataset.peek !== 'true');
  const onClose = () => close();

  back.addEventListener('click', onBack);
  closeBtn.addEventListener('click', onClose);
  backdrop.addEventListener('click', onClose);
  handle.addEventListener('click', onHandle);
  win.addEventListener('popstate', onPop);
  win.addEventListener(OPEN_EVENT, onOpenEvent);
  doc.addEventListener('keydown', onKey);
  renderRoot();

  function dispose() {
    closeUi();
    back.removeEventListener('click', onBack);
    closeBtn.removeEventListener('click', onClose);
    backdrop.removeEventListener('click', onClose);
    handle.removeEventListener('click', onHandle);
    win.removeEventListener('popstate', onPop);
    win.removeEventListener(OPEN_EVENT, onOpenEvent);
    doc.removeEventListener('keydown', onKey);
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('wheel', onWheel);
    backdrop.remove();
    root.remove();
    for (const record of pages.values()) {
      record.mounted = false;
      record.section = null;
      record.body = null;
      record.tile = null;
    }
    sheet = null;
  }

  sheet = { open, close, closeUi, renderRoot, refreshTile, isOpen, dispose };
  return dispose;
}

export const openSheet = (pageId) => sheet?.open(pageId);
export const closeSheet = () => sheet?.close();
/** Close without a history pop (mode flips). */
export const closeSheetSilently = () => sheet?.closeUi();
export const isSheetOpen = () => sheet?.isOpen() ?? false;
