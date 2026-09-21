# Mobile UI rewrite — shared design spec

Read this first, then your audit slice (`audit-A..D-*.md` in this folder).
Desktop UI must remain **unchanged**. Everything here is gated on `html[data-ui="mobile"]`.

## 1. Mode detection (one mechanism)

- `MOBILE_QUERY = '(pointer: coarse), (hover: none), (max-width: 640px)'`
  (any touch-primary device, any landscape phone/tablet, any narrow window).
- `src/ui/mobileMode.js` exports `MOBILE_QUERY`, `isMobileUi()`, `installMobileMode(doc, win)`;
  an inline bootstrap in `index.html` `<head>` sets `document.documentElement.dataset.ui = 'mobile'|'desktop'`
  before first paint. Override for QA/emulation: `?ui=mobile|desktop` (wins over the query).
  `window` fires `gev:ui-mode` (detail `{mode}`) when the mode flips.
- **CSS**: every mobile rule is scoped `html[data-ui='mobile'] …` and lives in `src/ui/styles/mobile-*.css`
  (appended at the END of `style.css`). No new `@media` needed. Never edit/reorder existing desktop rules
  (many tests pin them); override from mobile files instead.
- **JS**: mobile behaviour lives in NEW modules under `src/ui/mobile/`. Ask `isMobileUi()`; never call
  `matchMedia` with ad-hoc widths. Existing 720/760px gates stay untouched (pinned by tests).
- Desktop lane engines (left/right rail JS) must be inert in mobile: rails are hidden by CSS and their
  panels are moved out (below), so nothing may depend on their geometry.

## 2. Layout: "viewport first"

Always on screen in mobile (nothing else):
1. **Menu button** (44px round, top-left, safe-area aware) — opens the sheet.
2. **Compass/north button** (36px, top-right) and, when relevant, a **locate** button beneath it. Small.
3. **Mic FAB** (52px, bottom-right, above safe area) — the voice control node re-parented; status/tier/cost
   text move into the Voice page.
4. **Status line**: one 10–11px line, top-center, `pointer-events:none`, showing loading/sync/toast text
   (one owner: `#mobile-status`; toast + sync chips route through it). Fades when idle.
5. **Attribution**: `#cesium-credits` stays visible (Google/Cesium require it) but shrinks to ~9px,
   bottom-left, single line, low-opacity background. Logo becomes a 20px mark inside the menu header.
6. Transient/mode chrome only when active: scene playback stop, clean-view exit, draw toolbar,
   cockpit exit/instruments, recording safe-frame.

Everything else is a **page inside the sheet**.

## 3. The sheet (owned by Foundation agent)

`#mobile-sheet` = bottom sheet, `height: min(92dvh, …)` when open, drag-handle + close ✕, safe-area padding,
`overscroll-behavior: contain`, ONE scroll region per page (no nested scrollers; inner desktop `max-height`/
`overflow` scroll boxes are neutralised inside the sheet). Root page = a grid/list of section tiles
(≥56px rows, icon + title + one-line state). Tapping a tile opens that **page** full-height with a ← Back header.
Backdrop tap / ✕ / Android back (history) closes. Opening the sheet dims nothing important: while a page is
open the map remains visible in a peek strip (~8dvh) at the top; sheet may be collapsed to "peek" via handle
so the user can watch the map while adjusting a slider (`data-peek`: page collapses to a 30dvh bar).

### Page registry API (`src/ui/mobile/sheet.js`)
```js
registerMobilePage({
  id: 'layers',            // unique, kebab
  title: 'Layers',
  icon: 'layers',          // must be in index.html icon_names (add if needed) or use an emoji/inline svg
  order: 20,               // root list order
  summary: () => 'N on',   // optional live one-liner for the tile; call notify() to refresh
  mount(container, ctx),   // called once, lazily on first open; container is the page body
  onShow?(ctx), onHide?(ctx),
}) -> { notify() }
ctx = { close(), open(pageId), setTitle(text), peek(on), isOpen() }
```
Section agents call `registerMobilePage` from their own module; the foundation registers stub files so
no shared file is edited concurrently: each agent owns `src/ui/mobile/pages/<id>.js` + `src/ui/styles/mobile-<id>.css`.

### Moving DOM ("portal") — never clone, never duplicate ids
`src/ui/mobile/portal.js`: `movePanel(node, container, key)` leaves a comment anchor
(`mobile-home:<key>`) at the original spot and `restorePanel(key)` puts it back (same pattern as
`cockpitDisplayPortal.js`). When `gev:ui-mode` flips to desktop, everything is restored. JS lookups by id keep
working because the same nodes are reused. Cockpit portal moves children of `#pp-toggles`; if `#pp-toggles`
itself is inside the sheet that still works — Cockpit agent owns the interaction.

## 4. Look & feel tokens (`mobile-base.css`, Foundation owns)

Reuse the existing HUD palette (dark glass, cyan accent) but denser and larger to touch:
`--m-tap: 44px; --m-row: 52px; --m-gap: 12px; --m-radius: 14px; --m-font: 15px (body), 12px (meta);
--m-bg: rgba(10,16,22,.94); --m-line: rgba(120,200,255,.18); --m-accent: (existing accent var)`.
Safe areas: `--m-safe-t/r/b/l: env(safe-area-inset-*)` (needs `viewport-fit=cover`). Use `dvh`, never `vh`.
Inputs/selects ≥16px font (no iOS zoom). Sliders: 44px hit height, 6px visible track, 24px thumb.
Switches/segmented controls ≥44px. `touch-action: manipulation` on all buttons. No hover-only info: every
`title=` tooltip that carries information gets a visible label or a help line in the page.
Every keyboard-only action gets an on-screen button in mobile (orbit, draw finish/undo/cancel, deselect,
first-run dismiss, push-to-talk = tap-toggle on FAB, FPS toggle).

## 5. Section → owner map (every element in the audits must land somewhere)

| Owner | Scope (files/ids are in audits) |
|---|---|
| **F Foundation** | mobileMode, index.html bootstrap+viewport-fit, tokens, top chrome (menu/compass/status/credits/logo), sheet + registry + portal, hide desktop chrome (rails, dock, title bar, style indicator, panel headers) in mobile, credit test update, Cesium mobile options via scene.js, stub files, unit tests. |
| **P-Layers** | Layers page (`#data-panel`, layer rows, sub-controls, `#clear-selected-layers`, server lists) + Scenes page (`#scene-panel`, `#scene-runtime` playback chrome, shot list, actions, share button, replace prompt/confirm/dblclick rename with touch UI). |
| **P-View** | View/Display page (`#pp-toggles` groups, param sliders, map source + style buttons + chips, visual presets wing, clean view, orbit/tilt/reset/north controls, HUD/detection, FPS toggle, recording/safe-frame). |
| **P-Places** | Places page (location wing: search, pills, POI row, city presets) + Voice (mic FAB, voice page: status/tier/cost/help/errors, tap-to-talk) + Share. |
| **P-Context** | Context page (`#right-context-rail` contents: Global Context, Contacts, Space Missions, Awareness, briefing/news), CCTV page (`#cctv-panel`, sync chip, hover card → tap sheet, calibration ADJUST flagged desktop-recommended), Radio page (tuner drag → touch-friendly, mini players). |
| **P-Cockpit** | Cockpit mode on mobile (`#cockpit-hud` and all cockpit-* windows, view switcher, exit, instruments, briefing pages/route card reachable via a cockpit sheet, vision cycler, WX/cycle toggles, display portal interaction). |
| **P-Cards** | Entity/selection cards (APRS, Meshtastic incl. server list/add form, propagation, vessels/aircraft, stacked-station cycling → bottom sheet with Prev/Next), CCTV/roster hover previews → tap, Bhote Koshi panel + media callouts, draw tool touch toolbar (finish/undo/cancel/pin), label/tap hit slop. |
| **P-Modals** | First-run launcher, welcome, provider settings (+ POWER UP), hud-loading, toast/status routing into `#mobile-status`, scene import/export dialogs, any `window.prompt/confirm/alert`, share dialogs. |

Cross-agent contracts: (a) page ids are exactly the ones above (`layers, scenes, view, places, voice, context, cctv, radio`), plus `more` (Foundation: about/credits, developer toggles, replay welcome); (b) status text goes ONLY through
`window.dispatchEvent(new CustomEvent('gev:mobile-status', {detail:{text, kind, ttl}}))`; (c) opening the sheet to a page: `window.dispatchEvent(new CustomEvent('gev:mobile-open', {detail:{page}}))`; (d) bottom-right is the mic FAB, bottom-left is attribution — nothing else lives in the bottom 56px band except transient sheets (cards) that must clear both.
If you need a change that affects another owner, **message that agent (SendMessage) or the lead**; do not edit files you don't own.

## 6. Rules for every agent

- Own only your files (listed in your brief). New files preferred over editing existing ones. Existing files may be edited ONLY for minimal, desktop-neutral hooks, and you must run the tests that pin them.
- No git commits/stash/checkout/reset — the lead commits. Do not run the full `npm test` (2+ min, shared machine); run `node --test <file>` for tests touching your area plus `node scripts/check-import-directions.mjs && node scripts/check-package-boundaries.mjs` and `npx prettier --check` on new JS (see `scripts/format.mjs`, `scripts/format-scope.json`).
- Do NOT use the Playwright MCP or open the app in a browser — a single serial live review is run by the lead. Self-review instead: re-read your diff against the audit table, confirm every id in your slice is handled, check CSS selectors match real DOM, and simulate flows by reasoning + small node/jsdom-free unit tests.
- Keep the app runnable at all times (dev server at http://localhost:4173 runs with HMR; a syntax error breaks everyone). Make edits atomic.
- When finished, reply with a **review request**: what changed, files, exact URL (`/?ui=mobile`) + steps to reach each state, per-element checklist (audit row → where handled), and known gaps. The lead runs the live review and sends back findings.
