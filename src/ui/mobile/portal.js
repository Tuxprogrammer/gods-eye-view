/**
 * Move existing DOM into mobile surfaces without cloning (ids stay unique and
 * every id lookup / listener keeps working). A comment anchor
 * `mobile-home:<key>` marks the original spot, as cockpitDisplayPortal does.
 *
 * Lifecycle: movePanel records the move; restorePanel/restoreAll put nodes
 * back (desktop); reapplyAll re-does every recorded move (back to mobile).
 * Move nodes out BEFORE relying on the CSS that hides their old container.
 */
const entries = new Map();

function place(entry) {
  const { node, container, before, key } = entry;
  if (entry.moved) return true;
  if (!node.parentNode) return false;
  const anchor = node.ownerDocument.createComment(`mobile-home:${key}`);
  node.parentNode.insertBefore(anchor, node);
  entry.anchor = anchor;
  container.insertBefore(
    node,
    before && before.parentNode === container ? before : null,
  );
  entry.moved = true;
  return true;
}

/**
 * Move `node` into `container` (appended, or before `options.before`).
 * Idempotent per key; re-moving the same key with a new container relocates it.
 */
export function movePanel(node, container, key, options = {}) {
  if (!node || !container || !key) return false;
  const existing = entries.get(key);
  if (existing && existing.node === node) {
    if (existing.moved && existing.container === container) return true;
    if (existing.moved) restorePanel(key);
  } else if (existing) {
    restorePanel(key);
  }
  const entry = {
    key,
    node,
    container,
    before: options.before ?? null,
    moved: false,
    anchor: null,
  };
  entries.set(key, entry);
  return place(entry);
}

/** Put one node back at its anchor and forget it. */
export function restorePanel(key) {
  const entry = entries.get(key);
  if (!entry) return false;
  entries.delete(key);
  return unplace(entry);
}

function unplace(entry) {
  if (!entry.moved) return false;
  entry.moved = false;
  const { anchor, node } = entry;
  if (anchor?.parentNode) {
    anchor.parentNode.insertBefore(node, anchor);
    anchor.remove();
  }
  entry.anchor = null;
  return true;
}

/** Desktop: return every node home, keeping the records for reapplyAll. */
export function restoreAll() {
  for (const entry of [...entries.values()].reverse()) unplace(entry);
}

/** Mobile again: redo every recorded move. */
export function reapplyAll() {
  for (const entry of entries.values()) place(entry);
}

export function isPanelMoved(key) {
  return entries.get(key)?.moved === true;
}
