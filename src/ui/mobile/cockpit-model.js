/**
 * Pure state for the mobile cockpit drawer (no DOM). The drawer is a compact
 * bottom panel opened by the "i" button while cockpit mode is active.
 */
export const COCKPIT_TABS = Object.freeze([
  { id: 'contact', label: 'Contact' },
  { id: 'route', label: 'Route' },
  { id: 'brief', label: 'Brief' },
  { id: 'display', label: 'Display' },
  { id: 'radio', label: 'Radio' },
]);

export const DEFAULT_COCKPIT_TAB = 'contact';

export function normalizeCockpitTab(id) {
  return COCKPIT_TABS.some((tab) => tab.id === id) ? id : DEFAULT_COCKPIT_TAB;
}

export const initialDrawerState = () => ({
  open: false,
  tab: DEFAULT_COCKPIT_TAB,
});

/**
 * Actions: open {tab?}, close, toggle, select {tab} (also opens),
 * exit (cockpit ended), sheet (main menu sheet opened), escape.
 * The tab is remembered across close/open.
 */
export function reduceDrawer(state, action) {
  const type = action?.type;
  switch (type) {
    case 'open':
      return {
        open: true,
        tab: action.tab ? normalizeCockpitTab(action.tab) : state.tab,
      };
    case 'select':
      return { open: true, tab: normalizeCockpitTab(action.tab) };
    case 'toggle':
      return { ...state, open: !state.open };
    case 'close':
    case 'exit':
    case 'sheet':
    case 'escape':
      return state.open ? { ...state, open: false } : state;
    default:
      return state;
  }
}

/** Escape closes an open drawer first; otherwise cockpit's own handler runs. */
export const drawerConsumesEscape = (state) => state.open === true;

/** Arrow-key tab navigation (hardware keyboards); wraps around. */
export function adjacentCockpitTab(current, step) {
  const index = COCKPIT_TABS.findIndex((tab) => tab.id === current);
  const size = COCKPIT_TABS.length;
  const from = index < 0 ? 0 : index;
  return COCKPIT_TABS[(from + step + size) % size].id;
}
