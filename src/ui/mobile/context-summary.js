/** Pure helpers for the mobile Context page (tile summary text). */

/**
 * One-line state for the Context tile.
 * @param {{mode?: string|null, rosterCount?: string|null}} state
 *   `mode` is the value of `#global-context-panel[data-context-mode]`
 *   ('none' | 'flights' | 'space-missions').
 */
export function contextTileSummary({ mode, rosterCount } = {}) {
  if (mode === 'flights') return 'Contacts on';
  if (mode === 'space-missions') {
    const count = String(rosterCount ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return count && count !== '—'
      ? `Space missions · ${count}`
      : 'Space missions on';
  }
  return 'Off · contacts, space missions';
}
