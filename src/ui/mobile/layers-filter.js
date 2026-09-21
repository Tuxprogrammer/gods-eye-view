/**
 * Pure visibility rules for the mobile Layers list. The desktop LayerPanel
 * renders a flat list of group headings and layer rows; this decides which of
 * them to hide for a search query and for collapsed groups.
 *
 * items: [{ type: 'heading', key } | { type: 'row', text }] in DOM order.
 * Returns one { hidden, collapsed } per item. While a query is active, groups
 * never collapse (matches must stay reachable) and headings with no match hide.
 */
export function computeLayerVisibility(items, { query = '', collapsed } = {}) {
  const q = String(query).trim().toLowerCase();
  const closed =
    collapsed instanceof Set ? collapsed : new Set(collapsed ?? []);
  const result = items.map(() => ({ hidden: false, collapsed: false }));
  let headingIndex = -1;
  let groupKey = null;
  let groupMatches = 0;
  const closeGroup = () => {
    if (headingIndex >= 0 && q)
      result[headingIndex].hidden = groupMatches === 0;
  };
  items.forEach((item, index) => {
    if (item.type === 'heading') {
      closeGroup();
      headingIndex = index;
      groupKey = item.key;
      groupMatches = 0;
      result[index].collapsed = !q && closed.has(groupKey);
      return;
    }
    const match = !q || String(item.text).toLowerCase().includes(q);
    if (match) groupMatches += 1;
    result[index].hidden = q ? !match : closed.has(groupKey);
  });
  closeGroup();
  return result;
}

/** Number of layers whose row is not hidden by the query (for the empty state). */
export function countMatches(items, visibility) {
  return items.reduce(
    (total, item, index) =>
      total + (item.type === 'row' && !visibility[index].hidden ? 1 : 0),
    0,
  );
}
