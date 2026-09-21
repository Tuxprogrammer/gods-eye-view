/**
 * Mobile Layers page. Moves the existing #data-panel (the same node, so
 * LayerPanel's delegated listeners and every id lookup keep working) plus
 * #clear-selected-layers into the sheet; adds a search box, collapsible
 * groups and a live "N on" tile summary. Cesium layer behaviour is untouched.
 */
import { registerMobilePage } from '../sheet.js';
import { movePanel } from '../portal.js';
import { computeLayerVisibility, countMatches } from '../layers-filter.js';

const HEADING = 'h3.data-layer-group-heading';

function make(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  return node;
}

function setAttr(node, name, value) {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function countEnabledLayers(doc = document) {
  const buttons = doc.querySelectorAll('#data-toggles .data-toggle-btn');
  let on = 0;
  for (const button of buttons)
    if (button.classList.contains('active')) on += 1;
  return { on, total: buttons.length };
}

export function layersSummary(doc = document) {
  const { on, total } = countEnabledLayers(doc);
  if (!total) return '';
  return on ? `${on} on` : 'None on';
}

export function install() {
  let page = null;
  let query = '';
  const collapsed = new Set(); // in-memory only
  let list = null;
  let countLine = null;
  let emptyLine = null;
  let frame = 0;

  function applyFilter() {
    frame = 0;
    if (!list) return;
    const nodes = [...list.children];
    const items = nodes.map((node) =>
      node.matches(HEADING)
        ? { type: 'heading', key: node.textContent.trim() }
        : {
            type: 'row',
            text: `${node.querySelector('.data-name')?.textContent ?? ''} ${node.dataset.layerId ?? ''}`,
          },
    );
    const visibility = computeLayerVisibility(items, { query, collapsed });
    nodes.forEach((node, index) => {
      const state = visibility[index];
      setAttr(node, 'data-m-hide', state.hidden ? 'true' : null);
      if (items[index].type === 'heading') {
        setAttr(node, 'role', 'button');
        setAttr(node, 'tabindex', '0');
        setAttr(node, 'aria-expanded', state.collapsed ? 'false' : 'true');
        setAttr(node, 'data-m-collapsed', state.collapsed ? 'true' : null);
      }
    });
    if (emptyLine)
      emptyLine.hidden = !(
        query.trim() &&
        nodes.length &&
        !countMatches(items, visibility)
      );
    if (countLine) {
      const { on, total } = countEnabledLayers();
      countLine.textContent = total ? `${on} of ${total} layers on` : '';
    }
  }

  function schedule() {
    page?.notify();
    if (!list || frame) return;
    frame = requestAnimationFrame(applyFilter);
  }

  function toggleGroup(heading) {
    if (query.trim()) return;
    const key = heading.textContent.trim();
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    applyFilter();
  }

  function mount(container) {
    container.classList.add('m-layers');

    const toolbar = make('div', 'm-layers__toolbar');
    const search = make('input', 'm-layers__search', {
      type: 'search',
      id: 'mobile-layer-search',
      placeholder: 'Search layers',
      'aria-label': 'Search layers',
      enterkeyhint: 'search',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    });
    search.addEventListener('input', () => {
      query = search.value;
      applyFilter();
    });
    toolbar.append(search);

    const clear = document.getElementById('clear-selected-layers');
    if (clear) {
      if (!clear.querySelector('.m-btn-label')) {
        const label = make('span', 'm-btn-label');
        label.textContent = 'All off';
        clear.append(label);
      }
      clear.classList.add('m-btn', 'm-layers__clear');
      movePanel(clear, toolbar, 'clear-selected-layers');
    }

    countLine = make('p', 'm-meta m-layers__count');
    emptyLine = make('p', 'm-meta m-layers__empty');
    emptyLine.textContent = 'No layers match your search.';
    emptyLine.hidden = true;
    container.append(toolbar, countLine);

    const panel = document.getElementById('data-panel');
    if (panel) {
      movePanel(panel, container, 'data-panel');
      list = panel.querySelector('#data-toggles');
    }
    container.append(emptyLine);

    if (list) {
      list.addEventListener('click', (event) => {
        const heading = event.target.closest?.(HEADING);
        if (heading) toggleGroup(heading);
      });
      list.addEventListener('keydown', (event) => {
        const heading = event.target.closest?.(HEADING);
        if (heading && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          toggleGroup(heading);
        }
      });
      new MutationObserver(schedule).observe(list, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      applyFilter();
    }
  }

  page = registerMobilePage({
    id: 'layers',
    title: 'Layers',
    icon: '🗂',
    order: 20,
    summary: () => layersSummary(),
    mount,
    onShow: () => applyFilter(),
  });

  // Keep the tile summary live even before the page is first opened.
  const source = document.getElementById('data-toggles');
  if (source) {
    new MutationObserver(() => page.notify()).observe(source, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  return page;
}
