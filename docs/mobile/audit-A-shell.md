# Mobile audit A: application shell, dock, layer panels, Display rail

Read-only audit for the planned touch/small-viewport rewrite. No source was edited.
Slice: `scene-chrome.html`, `command-dock.html`, `layer-panels.html`, `display-controls.html` and the JS/CSS behind them.
Line numbers are `file:line` at commit `5d6b944`. Template line numbers are per-file (not the concatenated `index.html`).

CSS load order matters everywhere below (`style.css`): foundation, controls, location, status, cockpit, overlays, layers, radio, propagation, aprs, meshtastic, cctv, scenes, bhote-koshi, recording, **responsive**, **command-dock**, **command-dock-compact**, **command-dock-trays**, **command-dock-sliding**, voice-cost, first-run, provider-settings.

---

## 0. Findings that shape the plan (read first)

1. **The only breakpoint logic that is JS-driven is `(max-width: 720px)`** in `leftPanelRail.js:52` and `rightPanelRail.js:55`. Below it both rails stop running the desktop lane engine (`dataset.layoutMode = 'mobile'`) and CSS (`responsive.css:2-239`) takes over. There is **no** `pointer: coarse`, `hover: none`, `orientation`, `dvh`/`svh`, or `touch-action` anywhere in the slice. Viewport meta is `width=device-width, initial-scale=1.0` (no `viewport-fit=cover`, so `env(safe-area-inset-*)` is 0; only `#top-center-actions` uses it, `responsive.css:32`).
2. **Runtime DOM differs from template DOM.** Three re-parentings happen at startup and must be preserved or replaced deliberately:
   - `voice/control.js:45-53` builds `#gev-voice-control` and puts it in `#command-dock` between `#location-bar` and `#control-panel` (it re-inserts both wings).
   - `panelLayoutController.js:183-216` (`_initRightPanelAdaptiveLayout`): moves `#pp-toggles` (top-level in the template) to the front of `#right-context-rail`, moves `#cctv-panel` out of `#left-panel-stack` into the rail (before `#global-context-panel`), and moves `#param-slider-panel` from its template slot (after the detection group) to sit after `.pp-toggle-group` containing `#detection-toggle` (the same place, but inside the rail-owned `#pp-toggles`). `#right-context-rail`, `#global-context-panel`, `#radio-panel` come from `context.html` (not this slice).
   - `cockpitDisplayPortal.js` (Cockpit mode) moves the HUD / detection / parameters / models3d groups of `#pp-toggles` into the Cockpit display panel and back, using comment anchors (`cockpit-display-home:<name>`). This is the existing precedent for "same DOM nodes, moved between surfaces"; any mobile menu should reuse that pattern (move nodes, never clone).
   - Runtime left stack therefore holds only `#data-panel` and `#scene-panel`; CSS rules for `#left-panel-stack > #cctv-panel` (`scenes.css:14-17`, `responsive.css:218-232`) are dead at runtime. Right rail = Display, CCTV, Global Context (+ Radio inside Context).
3. **Cascade traps.** Runtime always has the wings and voice pill inside `#command-dock`, so the `#control-panel`, `#location-bar`, `#gev-voice-control` rules in `responsive.css:19-24, 68-80` are **overridden** (dead) by `command-dock.css:33-41` (`#command-dock > #x`, position relative, `inset:auto`). The real small-screen dock behaviour is in `command-dock*.css` (section 3.2).
4. **The two side rails split the viewport in half on phones.** At <=720px `#left-panel-stack` is `top:70px; bottom:calc(50vh + 8px)` and `#right-context-rail` is `top:calc(50vh + 8px); bottom:calc(2vh + 7.5rem)` (`responsive.css:173-198`). On a 375x667 phone that is about 256px (left) and 193px (right) of scroll window, each with its own inner scrollers (nested scroll, section 2.C). Full-width, edge-to-edge, `pointer-events:none` container with `auto` children.
5. **Hover is already touch-aware in JS.** `createHoverDisclosure` (`panelDisclosure.js:193-207`) ignores non-mouse/pen `pointerenter/leave`; a tap on a collapsed dock wing opens it (`panelDisclosure.js:184-191`). Auto-close after outside tap relies on `focusout` + `:hover` (`panelDisclosure.js:162-172, 280-284`); `:hover` is sticky on touch, so outside-tap dismissal **needs on-device verification** (not proven here).
6. **Keyboard-only features with no on-screen equivalent** (`applicationShortcuts.js:24-41`, `locationControls.js:44-55`): `O` (toggle orbit; there is no orbit button anywhere, `locationNavigation.js:274`; orbit also auto-starts after a POI click, `locationNavigation.js:72`), `F` (toggles `#data-panel.active`, i.e. hides/shows the layers panel; no button), `Q/W/E/R/T` POI hotkeys (POI pills exist), `1-7` (buttons exist), `H` `V` `D` `C` (buttons exist), `Escape` (closes panels, dismisses search, stops scene playback `sceneControls.js:216`, cancels draw), `Enter` (search submit, finish draw). Recording mode (`setRecordingMode`) has no button; it is voice/scene-driven only.
7. **Dead drag code.** `PanelPositionControls._initPanelDrag` is defined (`panelPositionControls.js:67`) and forwarded (`shellFacade.js:911`) but **never called**, and `.panel-drag-handle.compact` does not exist in any template. No drag-only interaction exists in this slice. `panelLayoutController.js:188-194` even strips `panel-draggable`. Tests still exercise the class directly (`shellLifecycle.test.mjs:176`), so do not delete it.
8. **Mobile-relevant input hazards that exist today:** text inputs/selects with font-size < 16px (iOS focus zoom): `#location-search` 0.68rem (`command-dock-trays.css:220-223`), `.pp-select` 10px, `.pp-text-input` 10px, `#scene-select` 12px, `#cctv-camera-select`, `.data-server-*` inputs; `title=` tooltips carry information on almost every control (invisible on touch); `dblclick` used for shot rename (`scenePresentation.js:66`) and to finish a Draw shape (`drawTool.js:360`, hint in `#draw-toggle` title); `window.prompt/confirm` in Scenes (`sceneControls.js:142,155,163`); no `touch-action: manipulation` so double-tap zoom can fire on rapid button taps; `vh` units (not `dvh`) everywhere in `responsive.css`, so mobile browser chrome will mis-size the half/half rails; share uses `navigator.clipboard.writeText` only (`sharelink.js:521`), no `navigator.share`.
9. **Required attribution constraint.** `#cesium-credits` (bottom-left, `foundation.css:275`) must stay visible in every state and is modelled by a test that walks the real CSS cascade (section 6). Any mobile layout must keep clearance to it.

---

## 1. Layout facts by breakpoint (dock, rails, chrome)

Desktop (>900px): dock is a floating flex bar `bottom:2vh; left:50%`, `translateX(-50%)`, three items (LOCATION wing, voice pill, VISUAL PRESETS wing), wings 9.5-10.5rem collapsed; trays pop up above (`.dock-popover-content`, absolute, `bottom:calc(100% + .65rem)`, width 28-33rem / 25-29rem; unified with `max(34rem, ...)` in trays.css:11-12). Left rail `left:52px`, top/bottom computed by JS lane engine (`--left-stack-safe-top/bottom`), 360px wide. Right rail `right:52px`, 330px.

901-980px: `command-dock.css:254` only changes the (overridden) grid; effectively desktop dock.

<=900px (`command-dock-compact.css:391`, `command-dock-sliding.css:146,408`, `command-dock-trays.css:479`): wings 4.25rem, popover width `calc(100vw - 1.5rem)` centered on the dock, popover `bottom: calc(100% + 3rem)` (credit clearance), credits move to `bottom: calc(2vh + 5rem); left:.75rem`, voice error tray narrows.

<=720px: dock `bottom: 8px` (`command-dock.css:290`); popover `bottom: calc(100% + 2vh + 2.5rem)` (`command-dock-sliding.css:259`); `responsive.css:2` block (rails full-width, `#pp-toggles` static width 176px, `#style-indicator` hidden, `#top-center-actions` to top-right, title smaller, `#cctv-frame` 120px high, `#scene-runtime` top:16px). JS lane engines disabled for both rails.

<=620px: wings 3.25rem, wing label `max-width:2.3rem` ellipsized (`command-dock-trays.css:495-506`, labels become "LOC..."/"VIS..."), Map Source grid 3 columns (`controls.css:744`).

<=575px: Cesium credit lightbox goes full-screen (`foundation.css:378`; not a GEV control).

<=520px: title text and subtitle hidden, logo only (`responsive.css:241-251`).

Voice pill width is `8.75rem` at every width (trays.css:3 sets it unconditionally after compact.css's 11.5rem).

Computed example, 375x667 portrait: dock about 244px wide, bottom 8px, ~60px tall; left rail y=70..326; right rail y=341..534; credits about y=546..574; toast `bottom:100px`; top-center actions 5 x 36px + 4 x 8px gaps = 212px at top-right, so the 520px rule (logo only) is what prevents overlap with the title.

---

## 2. Element inventory

Column key: **Where** = file:line. **Desktop** / **Small (<=720 unless noted)**. **Touch** = problems. **Mobile** = recommended treatment (menu section names are proposals: NAV = navigation/camera, LAYERS, VIEW = visual/display, SCENES, TOOLS, MAP = map source, or "stay" = keep on screen).

### 2.A `scene-chrome.html` (always-on chrome)

| Element | What it does | Where | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#cesiumContainer` | Cesium canvas host | scene-chrome.html:1; foundation.css:106 | full-bleed abs | same | Cesium owns touch gestures; UI code only listens `pointerdown`/`wheel` on canvas to cancel orient animation (`cameraOrientationControls.js:360`) | stay; keep untouched |
| `#world-overlay-root`, `#world-overlay-canvas` | detection/label overlay canvas | :2-4; foundation.css:118 | z6, pointer-events none | same | none (no pointer events) | stay |
| `#world-overlay-actions`, `#world-overlay-action-list`, `#world-overlay-status` | a11y list of actionable map targets, visually clipped | :5-8; foundation.css:150 | 1px clipped, focusable | same | none visible | stay (a11y) |
| `#title-bar` (+ `.title-glow`, `h1`, `.title-logo`, `.subtitle`, injected `.frame-rate-readout`) | brand, FPS readout (inserted by `frameRateMonitor.js`) | :11-15; foundation.css:434 | fixed top:32 left:36 z100, pointer-events none | top:20 left:20, h1 16px, logo 36px; <=520 logo only; FPS readout `position:fixed` top:52 left:20 (`responsive.css:55`) | takes top-left safe area; frameRate node is injected so keep `#title-bar` ancestor | stay (logo only) or fold title into menu header; keep `#title-bar` id (worldOverlay occluder + `frameRateMonitor.js` + radio broadcasting class `radioControls/radioPresentation`) |
| `#style-indicator`, `#active-style-name` | shows active visual preset name | :18-21; foundation.css:602 | fixed top-right, text | `display:none` (`responsive.css:38`) | invisible on phone, so active style is not visible unless dock tray is opened | surface active style name in menu header/pill; `#active-style-name` is looked up (`shellElements.js:4`) so keep id |
| `#top-center-actions` (nav) | container for 5 round buttons | :24-41; status.css:2 | fixed top:32 centered, gap 8 | top:max(12px, safe-inset) right:16 left:auto, no transform (`responsive.css:31`) | 212px wide; buttons 36px (below 44px); `:hover` scale(1.1) is hover-styled | move buttons into NAV section or a compact FAB cluster; keep ids |
| `#clear-selected-layers` | turn off all selected data layers (async, aria-busy) | :25; `clearLayersControl.js`; status.css:12 | 36px round icon `layers_clear`, title tooltip | same | 36px target; destructive with no confirm; title-only hint; hidden during scene playback (`recording.css:31-38`) and Cockpit (`cockpit.css:1951`) | LAYERS section header action (keep id + aria-busy semantics; tests pin `clearLayersControl.js` text) |
| `#share-btn` (`.share-icon` emoji) | copy share link to clipboard, toast | :28; `applicationShell.js:1370` | 36px | same | clipboard API only; failure toast "Copy failed"; emoji glyph | menu row "Share"; consider `navigator.share` (new code only) |
| `#tilt-map-view` (`aria-pressed`) | toggle straight-down/oblique | :31; `cameraOrientationControls.js:307` | 36px, accent when pressed | same | 36px; state only on `aria-pressed` | NAV section or stay as camera FAB |
| `#north-up-view` (`.camera-compass-needle` rotates via `--camera-heading`) | reset bearing north; doubles as compass | :34; status.css:62 | 36px; needle rotated each frame (`preRender`) | same | compass is useful glanceable info: stay on screen | **stay on screen** (compass) |
| `#reset-globe-view` | fly to full-globe view | :38; `locationNavigation.js` (via `_resetGlobeBtn`) | 36px | same | 36px | NAV section (or FAB with north-up) |
| `#global-loading-status` (+ `-label`, `-detail`) | live-data loading toast/status, `aria-live` | :42-45; status.css:87 | fixed top:74 centered, z102, pointer-events none | not adjusted at <=720 (still top:74 centered; `max-width: calc(100vw - 32px)`) | may collide with title/actions row on phones | stay, reposition below top row |
| `#traffic-sync-chip`, `#traffic-sync-label`, `#traffic-sync-progress` | road-network sync chip (split-flap text) | :46-49; status.css:167 | top:112 centered, opacity 0 until `.visible` | unchanged | stacks with loading status at 74/112/146 | stay (transient) |
| `#cctv-sync-chip`, `-label`, `-progress` | CCTV frames loading chip | :50-53; status.css:190 | top:146 centered | unchanged | same | stay (transient) |
| `#toast` | 2s message toast (`shellFeedback.js:181`) | :56; status.css (bottom:100px) | fixed bottom:100 centered, z200 | unchanged; sits above the ~60px dock but under an open tray's z? (toast z200 > dock 145: it draws over an open tray) | transient text only; 2s may be too short on touch | stay; anchor above bottom bar |
| `#safe-frame-overlay`, `#safe-frame-box` | recording composition guides (API-only) | :59-61; overlays.css:2 | fixed inset 0, pointer-events none | 16:9 box `min(90vw, ...)`, 9:16 `min(58vh, 76vw)` | none | stay |

### 2.B `command-dock.html` (bottom command dock)

Wrapper: `#command-dock` (command-dock.html:2, `aria-label`, no role). Contains, at runtime, LOCATION wing, voice pill, PRESETS wing.

| Element | What it does | Where | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#command-dock` | container | command-dock.html:2; command-dock.css:2; compact.css:2; sliding.css:2,423 | fixed bottom:2vh centered, z145, no bg/border (final `sliding.css:423`) | bottom:8px, `max-width: calc(100vw - 1rem)`, wings 4.25rem (3.25rem <=620) | `has()` selectors drive transform; hidden in clean view/recording (`command-dock.css:232`, `recording.css`) and display:none in Cockpit (`cockpit.css:1939`); is a worldOverlay occluder and a right-rail obstacle | keep as the only bottom bar (voice + 2 launchers) or replace by a single bottom "menu" bar; keep `#command-dock` id (JS, worldOverlay, qa, tests) |
| `#control-panel` (VISUAL PRESETS wing, `.panel-collapsible.collapsed`) | tray for style presets + Map Source | :4; controls.css:2; sliding.css:510 | wing 10rem, tray slides up on hover 140ms/focus/click | 4.25rem/3.25rem wing; tray full width | opening by hover irrelevant; tap opens; `title` tooltips; forced collapsed at start, no persistence (`panelChrome.js:123-126`); no `.panel-collapse-btn` so `_restorePanelCollapsedState` never runs for it | VIEW section (presets) + MAP section (map source) |
| `#control-panel-toggle` (`.dock-tray-toggle`, `aria-expanded`, `aria-controls=control-panel-popover`) | disclosure button (title "VISUAL PRESETS") | :7 | full-width label, 0.58rem text | label ellipsized to 2.3rem at <=620 | text target is ~16px tall but whole wing is clickable via `panelEl` click (`panelDisclosure.js:184`); label truncated | becomes menu entry; keep `data-dock-toggle-target` semantics or replace consistently (Escape handler looks up `[data-dock-toggle-target]`) |
| `#control-panel-popover` (`.dock-popover-content`) | tray body | :14-49 | absolute above dock; opacity/visibility transition, `visibility 0s linear 180ms` on close | width `calc(100vw - 1.5rem)`, bottom `calc(100% + 2vh + 2.5rem)` | nested horizontal scroller (`.button-grid`) inside; no max-height | rehome content into a bottom sheet |
| `.dock-pin-btn[data-pin-target=control-panel]` (`<img src=/pin.svg>`, `aria-pressed`) | pin tray open | :14; sliding.css:312; panelChrome.js:158 | 2.05rem circle overhanging tray corner (top/right -1rem) | same | overhangs edge; tiny; meaningless if trays become sheets | drop on mobile (keep in DOM for share-state `pinned` field) |
| `#style-buttons` (`.button-grid`) | 7 preset buttons | :15-50; controls.css:126 | flex row, `overflow-x:auto` hidden scrollbar | same, nowrap; buttons `flex:1 1 0; min-width:3.6rem; min-height:3.7rem` in tray (about 403px of buttons in a <=375px tray) | horizontal scroll with no visible affordance; `:hover translateY(-1px)`; `.btn-key` hint hidden in dock | VIEW: presets as wrapped 4-up grid (>=44px) |
| `.style-btn[data-style=normal/retro/surveillance/thermal/anime/noir/snow]` (`.btn-icon`, `.btn-label`, `.btn-key`) | set visual preset; keys 1-7 | :16-49; `displayBindings.js:98`; visualSettings.setStyle | icon+label, key hint `display:none` in dock | same | each carries a long `title` description (hidden on touch); emoji icons | VIEW; show description as subtitle/help text since title is invisible |
| `.map-source-section`, `#map-source-label`, `#map-stack-status`, `#map-stack-chips` (`role=group`) | map provider chips (8 presented ids in `mapStackChips.js`) | :52-57; controls.css:445; mapSourceControls.js | 4-column grid, chips 9px text | 3 columns <=620 (`controls.css:744`) | ~22px chips; unavailable/ION chips explain via `title` only; status shows `3D`/short label | MAP section; chips >=44px; show unavailable reason inline |
| `.map-stack-chip` (rendered by `renderMapStackChips`) | select a map source | mapStackChips.js; controls.css:~660-700 | button, `aria-disabled` when unavailable (kept focusable) | same | tests pin state rule order (section 6) | keep classes |
| `#style-mini-status`, `#style-mini-value` | collapsed-state style readout | :60-63; controls.css:47 | `display:none !important` in dock (`command-dock.css:134-138`) | same | never visible (dead) but JS writes `#style-mini-value` | use as menu header status; keep id |
| `#location-bar` (LOCATION wing) | tray: city pills, POIs, search | :68; location.css:2; sliding.css:510 | as control-panel, left wing | as control-panel | forced collapsed at start; `panel-collapse-btn` present but hidden; opening `location-bar` collapses `control-panel` unless pinned and vice versa (`panelChrome.js:473-491`) | NAV section (Places) |
| `#location-bar-toggle` (`aria-controls=location-bar-popover`) | disclosure button | :72 | label LOCATION | ellipsized | as control-panel-toggle | as above |
| `button.panel-collapse-btn[data-collapse-target=location-bar]` ("+") | legacy collapse | :75 | hidden (`display:none !important`) | hidden | dead in dock but bound by `_initPanelChrome` | leave |
| `#location-mini-status`, `#location-mini-city`, `#location-mini-poi` | current city/POI readout | :77-80 | hidden in dock | hidden | current location text is not shown anywhere on screen today | show in menu header/status; keep ids (`shellElements.js:166-167`) |
| `#location-bar-popover` | tray body | :81-96 | as above | as above | | |
| `.dock-pin-btn[data-pin-target=location-bar]` | pin tray | :82 | see above | | | |
| `#poi-row` (`.poi-row-container`, `.poi-pill` w/ `.poi-pill-key` letter, `.poi-pill-name`) | POIs of expanded city; Q/W/E/R/T | :83; locationControls.js:73-96 | expands with max-height animation | `overflow-x:auto` single row (`compact.css:168`) | horizontal scroll; hotkey chip meaningless on touch | NAV: vertical list |
| `#location-bar-divider` | visual divider (hidden in dock) | :84 | `.visible` hidden in dock | | | leave |
| `#location-pills` (`.location-pill` per city, `button`) | fly to city preset | :86; locationControls.js:28-36; compact.css:147 | flex row, hidden scrollbar | same | horizontal scroll; pill min-height 1.75rem (28px) | NAV: wrapped chips/list |
| `#search-toggle` (`.search-toggle-btn`, emoji) | expand/collapse search input | :88; locationControls.js:56 | 1.75rem circle | same | small; expands `#location-search` via class only | NAV: always-visible search field |
| `#location-search` (`type=text`, `aria-label`) | geocode by name/coords; Enter submits | :91; locationControls.js:62; locationSearch.js | width 0 until `.expanded`, then 100% in dock; font 0.68rem | same | **font < 16px causes iOS zoom**; Enter is the only submit (no button, no `enterkeyhint`/`type=search`); Esc clears; document `keydown` skip logic when focused | NAV: full-width `type=search`, 16px font, explicit Go button |

Dock-adjacent (runtime, not in this slice but inside `#command-dock`): `#gev-voice-control` (mic pill; `voice/control.js`, styles `foundation.css:226`, `command-dock-*.css`), `.gev-voice-help-tray` (hover/focus-visible only, `sliding.css:650`), `.gev-voice-error-tray` (visibility toggled by `data-status='error'`). Help tray is hover-only.

### 2.C `layer-panels.html` (`#left-panel-stack`)

| Element | What it does | Where | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#left-panel-stack` | container for left accordion (runtime: data + scene) | layer-panels.html:1; layers.css:2 | fixed left:52, width 360, JS-computed top/bottom (26vh..), `pointer-events:none` | fixed edge-to-edge, top:70 bottom:calc(50vh+8px), `overflow-y:auto` (`responsive.css:173`), `dataset.layoutMode='mobile'` | outer scroller with inner scrollers (nested); half-viewport window; `vh` not `dvh` | remove as a floating rail; content moves to menu sheets; keep id (tests + worldOverlay + Cockpit CSS `cockpit.css:133,1959`) |
| `#data-panel` (`.panel-collapsible.collapsed.active`, `data-panel-id`) | DATA LAYERS launcher/panel | :3; layers.css:19; scenes.css:14,388 | starts collapsed; `.active` gives opacity 1 (F key toggles `.active`, hides whole panel); persisted collapse | width 260 static (`responsive.css:125-134`) | F-key hide has no UI; collapsed launcher width 176px | LAYERS section (primary) |
| `.panel-header`, `.panel-title` "DATA LAYERS", `.panel-divider` | header | :6-8 | | | | |
| `button.panel-collapse-btn[data-collapse-target=data-panel]` | expand/collapse (text `+`/`-` rewritten by JS `_syncPanelCollapseButton`, `panelChrome.js:280`) | :9 | 22x22 | same | **22px target**; glyph via textContent so CSS `content` swaps will not work | replace by full-row tap target |
| `#data-toggles` (`.data-toggle-list`) | layer rows mounted by `LayerPanel.mount` (`app/data.js:54`) | :11; layers.css:77; layerPanel.js | own scroll: `overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable`, max 620px | inside `.data-panel-inner` (max-height `min(620px, 100vh - 26vh - 72px - 36px)`) inside the stack scroller | **nested scroll region x2** (stack + list); custom scrollbar 6px; also queried by voice (`#data-toggles [data-layer-id=...]`, `gevActions.js:2794`) and `foundation.css:326` `body:has(.data-toggle-row[data-layer-id=alpr-cameras] ...)` | LAYERS section body; keep `#data-toggles` id and `[data-layer-id]` rows |
| `.data-layer-group-heading` (h3) | group titles Movement / Cameras / Infrastructure / Events / Utilities / Other layers | layerPanel.js:163; layers.css:110 | | | | keep as sticky section labels |
| `.data-toggle-row[data-layer-id]` > `.data-toggle-top` (`.data-icon`, `.data-name`, `.data-count`, `.data-toggle-btn`) + `.data-toggle-meta` | one row per layer | layerPanel.js:169-236; radio.css:597-715 | `:hover` bg; toggle button `padding:3px 10px`, 9px mono | same | **toggle ~22px tall**; `title`/aria carries feed state text; `.gev-voice-focus` highlight is voice-driven | LAYERS: row min-height 48px, full-row or 44px switch |
| `.data-toggle-btn` (states `.active`, `feed-*`, `transitioning`, `lifecycle-uncertain`; `aria-disabled`/`aria-busy`) | enable/disable layer (async single-flight) | layerPanel.js:194-226, 1006-1041 | focus ring inset | same | must stay focusable while busy (test `contextTabKeyboard`) | keep semantics |
| `.data-toggle-controls` (delegated click/input/change/submit) with `.data-toggle-chip` (8px text, ~16px tall), `.data-toggle-slider(-input/-name/-value)` (propagation.css:41), `.data-toggle-select(-input)`, `.data-toggle-text(-input)` (aprs.css:6-44), `.data-toggle-legend-item/-swatch`, `.data-toggle-ramp(-bar/-ticks/-caption)` | per-layer sub-controls (mode chips, opacity sliders, filters, legends) | layerPanel.js:238-830 | flex-wrap, `padding-left:26px` | same | **chips ~16px tall; native sliders with 3px track / 10px thumb; 10-12px selects/inputs (iOS zoom)** | LAYERS: expand-in-place detail sheet per layer; enlarge; keep delegated listeners (they hang off `.data-toggle-controls` container, so re-parenting the row is safe, re-creating it is not) |
| `.data-servers` / `.data-server*` / `details.data-server-add` + form (Meshtastic MQTT list) | add/remove/topic/toggle servers | layerPanel.js:445-620; meshtastic.css | inputs, `role=switch` toggle, `summary` | same | small `data-server-remove`; text/password/number inputs; `role=alert` error | LAYERS detail sheet |
| `.data-row-list` (`ol`, `.data-row-list-item`) | turn-by-turn directions list | layerPanel.js:334-380, 840-880; radio.css:809 | ordered list buttons | same | list buttons | LAYERS detail |
| `#cctv-panel` (`.panel-collapsible.collapsed`, moved to right rail at runtime) | CCTV camera panel | layer-panels.html:16; cctv.css; layers.css:176-203 | expanded 330px, inner scroller | full-width in rail, `#cctv-frame` 120px high (`responsive.css:152`) | inner scroller `overflow-y:auto` | dedicated CCTV sheet in TOOLS/LAYERS |
| `#cctv-frame-wrap`, `#cctv-frame` (img), `#cctv-source-badge` (`role=status`), `#cctv-meta` | live still frame, source, meta | :24-28 | 16:9 wrap | 120px img | image tap has no action | stay in sheet |
| `#cctv-enable-btn`, `#cctv-nearest-btn`, `#cctv-prev-btn`, `#cctv-camera-select`, `#cctv-next-btn`, `#cctv-focus-btn`, `#cctv-coverage-btn`, `#cctv-auto-hop-btn`, `#cctv-projection-btn`, `#cctv-quality-chip` | enable, nearest, cycle, focus, coverage, auto hop, projection, quality chip (`scene-btn` class) | :29-45; shellElements.js:113-123 | flex rows of `.scene-btn` (6px 9px pad, 9px font) | same | ~27px targets; `select` 12px; long labels toggled by JS ("COVERAGE OFF") | CCTV sheet with 44px buttons |
| `#cctv-adjust-btn` | enter world-drag calibration (title: "Drag the camera in the world: rings rotate...") | :50 | enters a mouse-drag mode on map | same | **drag-in-world handles designed for mouse; small handles** | desktop-only feature; hide/disable on touch or provide separate touch UI |
| `#cctv-cal-readout` > `.cctv-cal-value[data-cal-field=heading/pitch/fov/range/height/north/east]` | click a value to type a number (swaps to `.cctv-cal-input` 58px, 9px) | :52-59; cctv.css:100-125 | 9px mono buttons | same | tiny; keyboard entry; input 9px (iOS zoom) | inside CCTV sheet, larger; or desktop-only |
| `#cctv-calib-save-btn`, `#cctv-calib-reset-btn`, `#cctv-summary` (+ label) | save/reset calibration, scene summary text | :62-67 | | | | CCTV sheet |
| `#scene-panel` (`.panel-collapsible.collapsed`) | SCENES director | :72; scenes.css:2; recording.css | 360px, in left stack order 4 | `right/left:16px, bottom:12px, width:auto` static in stack | inner scroller + 160px shot list scroller (3 nested) | SCENES section |
| `#scene-select` | choose scene recipe | :81; scenes.css:~ | 12px select | same | select < 16px (iOS zoom) | SCENES |
| `#scene-new-btn`, `#scene-delete-btn` | create (uses `window.prompt`) / delete (uses `window.confirm`) | :82-83; sceneControls.js:142,155 | `.scene-btn` | same | blocking native dialogs (ok, but jarring) | SCENES; replace with in-sheet dialog |
| `#scene-capture-btn`, `#scene-update-shot-btn` | capture/update shot from current camera+visual state | :86-87 | | | | SCENES |
| `#scene-shot-list` (`.scene-shot-row`, `.scene-shot-label`, `.scene-shot-actions`, `.scene-shot-btn` LOAD/DEL, `.scene-shot-meta`, `.scene-shot-rename`) | shot list; label click selects, **dblclick renames**, buttons load/delete | :89; scenePresentation.js:55-120; scenes.css:200-300 | 160px max-height scroller | same | **dblclick rename (unreliable on touch; only discoverable via `title`)**, small LOAD/DEL, nested scroller | SCENES: explicit rename button |
| `#scene-start-btn`, `#scene-stop-btn`, `#scene-next-btn` | play/stop/next; Esc stops during playback | :91-93; sceneControls.js:216 | | | Esc-only stop is keyboard; a stop button exists | keep stop reachable during playback: **stay on screen while a scene runs** (playback hides camera buttons `recording.css:31`) |
| `#scene-export-btn`, `#scene-import-btn`, `#scene-download-btn`, `#scene-import-file` (hidden `input[type=file]`) | export presets JSON, import, run log | :96-99; sceneControls.js:49-57 | | | file input works on mobile; downloads OK | SCENES |
| `#scene-progress-fill` (in `.scene-progress`), `#scene-status` | progress bar text and status | :101-104 | | | | stay with playback UI |

### 2.D `display-controls.html` (`#pp-toggles`, DISPLAY rail)

`#pp-toggles` (display-controls.html:2) starts collapsed for a first-time visitor (`panelPositionControls.js:123`), is restored from storage otherwise. At runtime it lives in `#right-context-rail`. Mobile CSS: `--pp-expanded-width:176px`, `position:relative`, `.pp-toggle-group, #clean-view-toggle {width:176px}` (`responsive.css:3-13`), then `#right-context-rail > #pp-toggles {width:100%}` (`:200`). Hidden in clean view and recording (`controls.css:956`, `recording.css:8`).

| Element | What it does | Where | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `.pp-header-row` (`.pp-header-label` "DISPLAY", `.panel-divider`) | panel header | :3-7 | 42px collapsed launcher / integrated header when open | same | header row doubles as title | VIEW section header |
| `button.pp-collapse-btn.panel-collapse-btn[data-collapse-target=pp-toggles]` (glyph `◀`/`▶` set by JS) | collapse/expand | :6 | 20x20 | 20x20 (`controls.css:230`) | **20px target** | replace |
| `#hud-toggle` (`.pp-toggle-btn`, title "Intelligence HUD (H)") | HUD on/off | :9; displayControls.js:22; visualSettings.js:1521 | 38px min height button | same | key hint in title only | VIEW |
| `#hud-layout-row` > `#hud-layout-select` (Tactical/Operator/Minimal) | HUD layout | :13-20 | `.pp-select` 24px, 10px font | same | **select 10px (iOS zoom)** | VIEW: segmented control |
| `#detection-toggle` (`aria-pressed`, title "Detection Overlay (D)") | cycles detection mode OFF/CONTACTS/... (label text set by JS) | :23; visualSettings.js:1531-1547 | 38px; pulsing animation for `.panoptic/.god` | same | cycle-only button has no direct picker | VIEW |
| `#detection-slider-row`, `#detection-density-slider` (0-100 step 25), `#detection-density-value` | label density | :27-30 | `.pp-slider` 3px track | `min-width:170px` rows | **slider hit area = 3px input height**; thumb 10px | VIEW: 44px-high slider |
| `#detection-allocation-row` > `#detection-allocation-elastic`/`-weighted` (`.pp-mode-btn role=radio`, persisted) | allocation strategy | :32-37 | 22px segments | same | 22px | VIEW segmented |
| `#detection-fade-row`, `#detection-fade-slider`, `#detection-fade-value`; `#detection-opacity-row`, `#detection-opacity-slider`, `#detection-opacity-value` | keyhole fade % and outside opacity (titles carry the explanation) | :39-48 | 3px sliders | same | title-only help | VIEW |
| `#param-slider-panel` (`.active` when non-normal style), `.param-panel-header`, `.param-panel-title` "PARAMETERS", `#param-panel-collapse-btn`, `#param-sliders` (rows `.param-slider-row`: `.param-label`, `input.param-slider` 3px, `.param-value`, generated by `styleParameters.js`) | per-preset uniforms | :51-58; controls.css:~ (param panel) | display none unless `.active`; inside `#pp-toggles` it has `overflow-y:visible` (single scroll owner, test-pinned) | `max-height:min(38vh,360px)` when standalone | sliders 3px/12px thumb; auto-revealed and auto-scrolled when a preset is chosen (`visualSettings._revealStyleParameters`, `scrollTop +=`) | VIEW: below presets; the reveal logic scrolls `#pp-toggles`, so a new scroll owner must be handled |
| `#models3d-toggle` (`.active` by default, `aria-pressed`) + `#models3d-mode-row` (`.visible`) > `#models3d-mode-proximity`/`-all` (`data-mode`, `role=radio`) | 3D aircraft on/off, proximity vs all | :64-73; aircraftDisplay.js | default on | same | 22px segments | VIEW |
| `#scope-toggle` (`.active` default) + `#scope-slider-row` (`.visible`) > `#scope-feather-slider` (0-100, default 11) + `#scope-feather-value` | circular viewport mask + feather | :77-90 | | | 3px slider; consider disabling the scope on mobile (needs product decision) | VIEW |
| `#draw-toggle` (title: "click vertices, double-click or Enter to finish, Esc to cancel") | draw on world (`annotations/drawTool.js`) | :93 | | | **finish requires dblclick/Enter; cancel requires Esc** (keyboard/double-click) | TOOLS; needs touch finish/cancel buttons (new UI) |
| `#draw-mode-row` > `.pp-mode-btn[data-shape=area/line/pin]` | shape | :97-103 | | | 22px | TOOLS |
| `#draw-label-row`: `#draw-label-input` (10px, maxlength 120), `#draw-color-select` (5 options), `#draw-clear`, `#draw-hint` (aria-live) | label, colour, clear all, hint | :105-115 | | | inputs < 16px | TOOLS |
| `#celestial-toggle` (`aria-pressed`, may be `disabled`/`aria-disabled`) | full-globe celestial ring | :119 | | | | VIEW |
| `#clean-view-toggle` (title "Hide UI chrome") | adds `body.ui-clean-view` (V key) | :124; applicationShell.js:1001 | | | hides ALL chrome incl. top actions/dock (`controls.css:956`) | VIEW ("Hide controls"); pairs with exit control |
| `#bloom-toggle`, `#bloom-slider-row`, `#bloom-intensity-slider` (0-200), `#bloom-intensity-value` | bloom on/off + intensity | :129-135 | | | 3px slider | VIEW |
| `#sharpen-toggle`, `#sharpen-slider-row`, `#sharpen-intensity-slider` (default 49), `#sharpen-intensity-value` | sharpen | :139-145 | | | 3px slider | VIEW |
| `#clean-view-exit` ("EXIT CLEAN VIEW") | restore chrome; `display:none` until `body.ui-clean-view` | :149; controls.css:~890 | fixed top:18 centered, z300 | same (not adjusted) | 8px 14px padding, 10px text; only escape besides V key | **stay on screen** (must remain reachable; a mobile "hidden UI" mode needs this or an equivalent tap-to-restore) |

### 2.E Other JS-owned UI in slice files (no template)

| Item | Where | Notes |
|---|---|---|
| Layer row rendering, refresh, hidden-tab pause | `layerPanel.js:135-1060` (`document.hidden` check at :898) | re-render replaces `innerHTML` of `#data-toggles`, so any mobile wrapper must be a parent of `#data-toggles`, not a child |
| Layer service wiring | `layerBindings.js`, `layers.js` (re-export shim, 2 lines), `scenes.js` (1 line), `mapSource.js` (9 lines) | no DOM |
| Map source chips | `mapSourceControls.js`, `../mapStackChips.js` | chips rendered into `#map-stack-chips`; subscribes to `gev:map-stack-changed` |
| Style parameters | `styleParameters.js` (via `visualInput.js`) | generates rows into `#param-sliders` |
| Visual settings / effects / presets | `visualSettings.js` (1591 lines), `visualEffects.js`, `visualPresets.js` | state + DOM class toggles (`.active`, `.visible`, `aria-pressed`) on the Display ids; no layout |
| Navigation | `navigationController.js` | no DOM; camera authority |
| Camera orientation | `cameraOrientationControls.js` | binds `#tilt-map-view`, `#north-up-view`; updates `--camera-heading`, aria-labels per frame |
| Recording | `recordingControls.js` | binds `#safe-frame-*`, `#hud-layout-select`, `#hud-toggle`; toggles `body.recording-mode` |
| Panel layout/disclosure/position/rails | `panelChrome.js`, `panelDisclosure.js`, `panelLayoutController.js`, `panelPositionControls.js`, `panelRails.js`, `leftPanelRail.js`, `rightPanelRail.js`, `panelRailGeometry.js`, `panelMeasurement.js` | see sections 4-6; the rail engines observe DOM via ResizeObserver + MutationObserver on the rails and a fixed obstacle selector list (`panelLayoutController.js:10-62`) |
| Shell composition | `applicationShell.js` (StyleManager), `shellFacade.js`, `shellElements.js` (179 lines: the one id table), `shellFeedback.js` | `window` `resize` listener (`applicationShell.js:559-564`) reschedules both rails + `_syncCctvPanelViewport` |

---

## 3. Inventory: viewport / media branches in the slice

### 3.1 JS

| Where | Branch | Effect |
|---|---|---|
| `leftPanelRail.js:52` | `matchMedia('(max-width: 720px)')` | skip lane engine; `layoutMode='mobile'`; clear `--left-stack-*` and `--left-panel-allocated-height`; remove `aria-hidden` |
| `rightPanelRail.js:55` | `matchMedia('(max-width: 720px)')` (`isMobile`) | Display (`pp-toggles`) is ignored when deciding Tactical-HUD "exclusive" mode (:56-60); skip lane engine; `layoutMode='mobile'` |
| `leftPanelRail.js:66`, `rightPanelRail.js:82` | `windowRef.innerHeight` | desktop lane math (vh percentages) |
| `panelPositionControls.js:142,175,176,248,249` | `innerWidth`/`innerHeight` | drag/clamp (dead path) and `_pinPanelToRight` |
| `applicationShell.js:1430` | `innerHeight - rect.top - 12` | `_syncCctvPanelViewport` sets `maxHeight` only when CCTV is NOT in the right rail (never at runtime after re-parent) |
| `applicationShell.js:559-564` | `window.resize` | reschedule rails, CCTV viewport |
| `panelLayoutController.js:132-181` | ResizeObserver on dock trays | sets `--dock-*-pinned-height` CSS vars |
| Out of slice but same idiom | `cockpitLayout.js:79,100` `(max-width: 760px)`; `radioControls.js` reduced-motion | note the 760/720 mismatch |

No `pointer`/`hover`/`any-pointer`/`orientation`/`prefers-*` (except reduced-motion) queries exist in slice JS. The only touch-aware code is the pointer-type filter in `panelDisclosure.js:193-207`.

### 3.2 CSS `@media` (slice files)

| Where | Condition | What it changes |
|---|---|---|
| `responsive.css:2-239` | max-width 720 | rails full-width/half-height, `#pp-toggles` 176px static, `#control-panel/#location-bar/#gev-voice-control` (dead, overridden), title, top actions, style indicator, `#cctv-frame` 120px, scene panel, `#scene-runtime`, `.hud-*` |
| `responsive.css:241-251` | max-width 520 | title text/subtitle hidden |
| `command-dock.css:254` | max-width 980 | grid rearrangement (dead: `#command-dock` is `display:flex` from compact.css); credit/HUD offsets |
| `command-dock.css:290` | max-width 720 | dock `bottom:8px`, search basis 150px, padding, `#left-panel-stack {bottom: calc(50vh + 8px)}` |
| `command-dock-compact.css:391` | max-width 900 | wings 4.25rem, popover mobile width var, voice shrink |
| `command-dock-sliding.css:146`, `:408` | max-width 900 | popover width `calc(100vw - 1.5rem)`, left/right offsets, `bottom: calc(100% + 3rem)`, pinned stacking variants |
| `command-dock-sliding.css:259` | max-width 720 | popover `bottom: calc(100% + 2vh + 2.5rem)`; MUST stay after the 900 block |
| `command-dock-trays.css:479`, `:495` | max-width 900 / 620 | credit position; error tray width; wings 3.25rem, label ellipsis |
| `controls.css:744` | max-width 620 | map chips 3 columns |
| `foundation.css:378` | max-width 575 | Cesium credit lightbox full screen |
| `*.css` | `prefers-reduced-motion` | foundation:600, layers:908, status:374, sliding:663 |
| Out of slice | cockpit.css:2016 (760), bhote-koshi.css:588 (720), first-run.css:262/302, provider-settings.css:355 (620) | |

---

## 4. Persisted state (localStorage / share)

All wrapped in try/catch. There is no sessionStorage/IndexedDB in slice files.

| Key | Owner | Value | Notes |
|---|---|---|---|
| `godsEyeView.v6.panelCollapsed.<panelId>` | `panelPositionControls.js:97-137` | `'1'`/`'0'` | written on every explicit collapse. Restored only for panels having a `.panel-collapse-btn[data-collapse-target]`: `data-panel`, `cctv-panel`, `scene-panel`, `pp-toggles`, `param-slider-panel`, `location-bar` (then force-collapsed w/o persist, `panelChrome.js:127`), plus `radio-panel`, `global-context-panel` (context.html). Not written for `control-panel` (`persist:false` at start). `pp-toggles` defaults collapsed when key is absent (`:123`). A valid share link disables stored restore (`allowStored: !this._initialShareState`, `panelChrome.js:117`). |
| `godsEyeView.v8.panelPos.<panelId>` | `panelPositionControls.js:93-196` | `{left,top}` JSON | only written by the dead drag path; restored only via `_initPanelDrag` (never called). Old `godsEyeView.v6.panelPos.*` keys trigger a one-time toast |
| `godsEyeView.v8.layoutResetNotified` | `panelPositionControls.js:51-53` | `'1'` | one-time toast marker |
| `gev:detection-allocation:v1` | `visualSettings.js:35,204,562` | `ELASTIC`/`WEIGHTED` | Display allocation preference |
| Share-link panel tokens | `sharelink.js:39-47` (SHARE_PANEL_STATE_SPECS in `panelChrome.js:9-19`) | `control-panel`(c, pinnable), `location-bar`(l, pinnable), `data-panel`(d), `cctv-panel`(v), `radio-panel`(r), `scene-panel`(s), `global-context-panel`(g), `pp-toggles`(p), `param-slider-panel`(m) | `_buildSharePanelState` serializes `collapsed` (auto-collapse counted as expanded) and `pinned`. A mobile menu that replaces panel expand/collapse must keep these ids and `collapsed` class semantics readable or the share hash will change meaning. Docs pinned by `tooling/panelStorageDocs.test.mjs` |
| CSS class state (not persisted) | | `.collapsed`, `.layout-auto-collapsed`, `.dock-pinned`, `.dock-pinned-top`, `.active`, `body.ui-clean-view`, `body.recording-mode`, `body.scene-playback-mode`, `body.cockpit-mode`, `html[data-gev-style]` | |

---

## 5. Every id JS (or QA) looks up (re-parenting / duplicate-DOM safety)

**Rule:** all lookups are by `document.getElementById` at construction time, so ids must exist exactly once at startup (`cockpitMarkup.test.mjs:262` asserts single `#hud-toggle` and `#detection-toggle`). Moving nodes is safe; cloning stateful controls is not (listeners are bound to the instances; `displayBindings.js` binds once in `_initUI`).

### 5.1 `shellElements.js:readShellElements` (single lookup table, `shellElements.js:3-178`), ids in this slice

`right-context-rail, active-style-name, param-slider-panel, param-sliders, pp-toggles, bloom-toggle, bloom-slider-row, bloom-intensity-slider, bloom-intensity-value, sharpen-toggle, sharpen-slider-row, sharpen-intensity-slider, sharpen-intensity-value, hud-toggle, hud-layout-row, hud-layout-select, detection-slider-row, detection-density-slider, detection-density-value, detection-allocation-row, detection-fade-row, detection-fade-slider, detection-fade-value, detection-opacity-row, detection-opacity-slider, detection-opacity-value, celestial-toggle, scope-toggle, scope-feather-slider, scope-feather-value, map-stack-chips, map-stack-status, clean-view-toggle, clean-view-exit, data-panel, scene-panel, cctv-panel, left-panel-stack, cctv-enable-btn, cctv-nearest-btn, cctv-prev-btn, cctv-next-btn, cctv-camera-select, cctv-focus-btn, cctv-coverage-btn, cctv-auto-hop-btn, cctv-projection-btn, cctv-quality-chip, cctv-adjust-btn, cctv-cal-readout, cctv-calib-save-btn, cctv-calib-reset-btn, cctv-frame, cctv-frame-wrap, cctv-source-badge, cctv-meta, cctv-summary, share-btn, tilt-map-view, north-up-view, clear-selected-layers, global-loading-status, global-loading-label, global-loading-detail, reset-globe-view, style-buttons, traffic-sync-chip, traffic-sync-label, traffic-sync-progress, cctv-sync-chip, cctv-sync-label, cctv-sync-progress, toast, location-search, search-toggle, location-pills, poi-row, location-bar-divider, style-mini-value, location-mini-city, location-mini-poi, safe-frame-overlay, safe-frame-box, detection-toggle, models3d-toggle, models3d-mode-row`.
(Plus non-slice: radio, context, cockpit ids.) `cockpit-reset-globe` is a second reset-globe control looked up here too.

### 5.2 Lookups outside `shellElements.js`

| Id | Looked up by |
|---|---|
| `detection-allocation-elastic`, `-weighted` | `visualSettings.js:198` |
| `models3d-mode-proximity`, `-all` | `aircraftDisplay.js` |
| `scope-toggle` | `aircraftDisplay.js`, `shellElements.js` |
| `scope-feather-slider`, `detection-opacity-slider` | `scopeMask.js`, `celestialRing.js` |
| `data-panel` | `displayBindings.js:84` (F key toggles `.active`), `radioBindings.js`, `sharelink.js`, `leftPanelRail/rightPanelRail` (as panel), `voice/gevActions.js` |
| `data-toggles` | `app/data.js:54` (`presentation.mount`), `voice/gevActions.js:2794` |
| `control-panel`, `location-bar` | `panelChrome.js`, `panelLayoutController.js` (`#location-bar.dock-pinned:not(.collapsed)`), `voice/control.js:45-53`, `sharelink.js`, `voice/gevActions.js`, `voice/actionSchemas.js` |
| `control-panel-toggle`, `location-bar-toggle` | `panelDisclosure.js:63` via `[data-dock-toggle-target="<panelId>"]` and QA (`scripts/qa-map-source-tray.mjs`, `qa-location-controls.mjs`) |
| `command-dock` | `panelChrome.js`, `panelLayoutController.js:118-181`, `voice/control.js`, `overlays/worldOverlay.js`, `data/bhoteKoshiEmbeddedMedia.js` |
| `left-panel-stack` | `panelLayoutController.js:93`, `radioBindings.js`, `overlays/worldOverlay.js`, `cockpit.css` |
| `pp-toggles` | `panelLayoutController.js:95,188`, `panelPositionControls.js:24`, `rightPanelRail.js`, `visualSettings.js`, `overlays/worldOverlay.js`, `sharelink.js`, `voice/gevActions.js`, `voice/actionSchemas.js`, cockpit display portal |
| `param-slider-panel` | `panelLayoutController.js:97,207`, `panelDisclosure.js:55`, `radioBindings.js`, `sharelink.js`, `cockpit.css` |
| `cctv-panel` | `panelLayoutController.js:96,197`, `panelChrome.js`, `panelPositionControls.js`, `sharelink.js`, `cctvPresentation.js`, `voice/*` |
| `scene-panel` (+ all `scene-*` ids) | `scenePresentation.js:2-23`, `sceneSharing.js`, `sharelink.js`, `voice/*`, `bhoteKoshiEmbeddedMedia.js`; QA `qa-scene-controls.mjs`, `qa-director-sharing.mjs` |
| `detection-toggle` | `panelLayoutController.js:98`, QA |
| `draw-toggle`, `draw-mode-row`, `draw-label-row`, `draw-label-input`, `draw-color-select`, `draw-clear`, `draw-hint` | `annotations/drawTool.js` (unit test also asserts these in `display-controls.html`) |
| `hud-toggle`, `hud-layout-select` | `recordingControls.js:15-16` |
| `safe-frame-overlay`, `safe-frame-box` | `recordingControls.js:13-14` |
| `title-bar` | `frameRateMonitor.js` (injects `.frame-rate-readout`), `radioControls.js`, `radioPresentation.js` (adds `.radio-broadcasting`), `overlays/worldOverlay.js` |
| `top-center-actions`, `style-indicator`, `traffic-sync-chip`, `cctv-sync-chip` | occluder lists in `overlays/worldOverlay.js:95-103` and rail obstacle selectors `panelLayoutController.js:10-62` |
| `clear-selected-layers` | `data/lifecycle.js`, `ui/contextActions.js` |
| `toast`, `global-loading-*`, `traffic-sync-*` | `shellFeedback.js`, `scenes/director.js` |
| `world-overlay-root/-canvas/-actions/-action-list/-status` | `overlays/worldOverlay.js`; `cesiumContainer`: `app/scene.js`, `voice/realtime*.js`, QA |
| Other id lookups in slice files | `#right-context-rail`, `#global-context-panel` (`applicationShell.js:759`), `#intel-hud` (rail observers), `#cesium-credits` (obstacle + observers) |

Class/attr selectors used by JS: `.panel-collapse-btn[data-collapse-target]`, `[data-panel-id]`, `.panel-collapsible`, `.dock-pin-btn[data-pin-target]`, `.dock-popover-content`, `[data-dock-toggle-target]`, `.map-stack-chip(.active)`, `.style-btn`(+`data-style`), `.data-toggle-row[data-layer-id]`, `.pp-mode-btn`(`data-mode`,`data-shape`,`data-allocation`), `.cctv-panel-inner`, `.panel-glow` (first-child skip in `panelLayoutController.js:324`), `.pp-header-row`, `.panel-title, .pp-header-label, .location-toolbar-label` (used to build aria-labels, `panelChrome.js:298-318`).

QA scripts (`scripts/qa-*.mjs`, Playwright) drive many of these selectors and viewport sizes (`qa-map-source-tray.mjs` asserts tray bounds at 480px); they are not unit tests but will break on renames.

---

## 6. Tests that pin source/markup/CSS of this slice

Test helpers: `src/testSupport/readShellSource.mjs` concatenates `locationNavigation, cockpitCoordinator, navigationController, shareRestoration, visualSettings, panelChrome, aircraftDisplay, layerBindings, displayBindings, shellFacade, applicationShell` (all `src/ui/*.js`) into one string; `readStylesheet.mjs` inlines `style.css` `@import`s in order. Templates are read directly or via `expandApplicationHtml(index.html)`.

Files importing `readShellSource` (regex over the concatenated shell JS; new code added to those 11 files can break `[\s\S]*?` spans, so put mobile JS in a NEW module not in that list): `cameraHandoff, cctvFocusPolicy, cctvFocusRequest, cockpitMarkup, contactsDetectionPolicy, contextSessionOrdering, contextTabKeyboard, creditAttribution, data/detectionHost, data/layerState, loadingFeedback, locationReadouts, mapSourceFocus, mapStackChips, panelEscape, panelStackLayout, radioMarkup, reasonableDefaults, scenes/director, sharelink.celestial`.

Files reading the full stylesheet (`readStylesheet(style.css)`): `creditAttribution, keyboardFocusStyles, mapStackChips, panelStackLayout, rightRailPolicy, firstRunExperience, loadingFeedback, cockpitMarkup, radioMarkup, contextTabKeyboard, overlays/worldOverlay`. Appending a new stylesheet to `style.css` is visible to all of them; tests only fail on specific pins:

1. **`creditAttribution.test.mjs` (highest risk).** Parses the whole cascade and, for every rule whose *last compound selector* contains `#cesium-credits`, `#command-dock`, `#right-context-rail`, or `.dock-popover-content`, evaluates `bottom/top/inset*/margin*/height/min-height/max-height/position/transform/translate/scale/zoom/all`. It resolves media only for exact `(max-width: Npx)` conditions and **fails** on any other media condition gating such a rule (`pointer: coarse`, `orientation`, `min-width`, combined `and` queries, etc., :257-266), on nested `calc()`, `min()/max()/clamp()/env()`, `*`/`/` operators, subtractions, and unvetted custom properties (`--dock-*-pinned-height` only, :234-239) in those offsets. It also pins: dock anchor `bottom:8px` at 720 (`:561`), credit base rule has no height/padding/line-height (`:458-478`), `_updateCommandDockTrayStack` writer text (`:432-456`), `rightPanelRail.js` still contains `windowRef.matchMedia("(max-width: 720px)")` (`:479-493`), rail floor `calc(2vh + 7.5rem)`, tray clearance at widths `[1440,1024,980,900,830,800,760,721,720,700,640,600,480,375]` x heights `[500..1600]`, credit never `display:none/visibility:hidden/opacity:0`, and the `body.ui-clean-view #cesium-credits, body.recording-mode #cesium-credits {... bottom: 36px}` block. **Any mobile stylesheet that repositions the dock, tray, right rail or credit must use only `max-width` media, plain px/rem/vh terms, and keep clearance; otherwise put the overrides on different selectors/elements.**
2. `cockpitMarkup.test.mjs:245-250`: exact `@media (max-width: 720px)` block containing `#top-center-actions {right:16px; left:auto; transform:none}` and `#style-indicator {display:none}`; `@media (max-width: 520px)` with `#title-bar h1 > span:last-child, #title-bar .subtitle {display:none}`; `#top-center-actions {left:50%; display:flex; transform: translateX(-50%)}`; `body.ui-clean-view #top-center-actions`, `body.recording-mode #top-center-actions`; `body.scene-playback-mode :is(#clear-selected-layers,#tilt-map-view,#north-up-view,#reset-globe-view){display:none !important}`; button `aria-label`s on `#clear-selected-layers` and `#reset-globe-view`; single `#hud-toggle` and `#detection-toggle`; `data-cockpit-display-slot` order; obstacle selector lists in `panelLayoutController.js` (`:553-565`); `locationControls.js`/`locationSearch.js` text (`:500-540`).
3. `panelStackLayout.test.mjs:140-290`: pins rail JS text (`--left-panel-allocated-height`, preferred-panel ordering, `classList.add('collapsed','layout-auto-collapsed')`, `panelLayoutController` remove), `#left-panel-stack.layout-focus > [data-panel-id].collapsed {display:none}`, header sticky rule, `#pp-toggles:not(.collapsed) > #param-slider-panel.active {flex:0 0 auto; max-height:none; overflow-y:visible}`, `.param-slider {flex:1; min-width:0}`, `#pp-toggles:not(.collapsed) > .pp-header-row` shell rule, `#pp-toggles.collapsed .pp-header-row {width: var(--right-collapsed-width,132px)}`, Map Source `repeat(4, minmax(0,1fr))`, html order `#control-panel ... .map-source-section ... #map-stack-chips`, `.pp-header-row` markup order (`DISPLAY` label then `.panel-divider`), divider gradients, the share-state text in `panelChrome.js` (auto-collapse serializes as expanded; `_setCommandDockPanelPinState` text).
4. `rightRailPolicy.test.mjs:35-48`: `rightPanelRail.js` must keep `const isMobile = windowRef.matchMedia('(max-width: 720px)').matches`, the `(!isMobile || panel.id !== 'pp-toggles')` clause, the `aria-hidden` set, and CSS `#right-context-rail.layout-exclusive > [data-panel-id].collapsed {`.
5. `keyboardFocusStyles.test.mjs`: global `:focus-visible` outline rule with `!important`; inset rings on location pills/search; `transition: all` banned on `.panel-collapse-btn`, `#top-center-actions button`, `.data-toggle-chip`, `.scene-btn`, `.scene-shot-btn` (rule bodies looked up by exact selector text `'.panel-collapse-btn {'`, etc.); dock popover `visibility 0s linear 180ms` transition and `#command-dock #location-bar:not(.collapsed) .dock-popover-content,` opening rule with `transition-delay: 0s` (selector text must not change).
6. `mapStackChips.test.mjs`: chip hover/active/unavailable rule ORDER, no `:not(` between hover and active, `:focus-visible` ring rule on `.map-stack-chip`, html structure `<section class="map-source-section"> ... <div id="map-stack-chips" class="map-stack-chip-row" role="group" aria-label="Map source"></div>`, `id="map-source-label">MAP SOURCE<...id="map-stack-status"`, `<button id="control-panel-toggle" ... data-dock-toggle-target="control-panel" ... aria-controls="control-panel-popover"`, `panelDisclosure.js` Escape/focus text, `querySelector('.map-stack-chip.active') || panel.querySelector('.map-stack-chip')` text in shell source.
7. `panelEscape.test.mjs`: Escape wiring text in `panelChrome.js` for every collapse target; `panelDisclosure.js` behavior; location Escape clears hidden search.
8. `contextTabKeyboard.test.mjs:118-160`: `.context-mode-button` focus rules; `clearLayersControl.js` must use `aria-busy` and never set `button.disabled`.
9. `annotations/drawTool.test.mjs:60-135`: reads `display-controls.html` for the 7 draw ids + `data-shape` values; asserts draw rules exist in `controls.css` (selectors `#draw-mode-row`, `#draw-label-row`, `.pp-text-input`, `.draw-clear-btn`, `.draw-hint`, `body.gev-drawing`) and `style.css` stays a <40-line import shim with no draw styles.
10. `reasonableDefaults.test.mjs`, `data/layerState.test.mjs`: template defaults pinned (feather slider value 11, fade 7, outside 1, 3D toggle `.active` + `aria-pressed=true`, Proximity selected and `#models3d-mode-row.visible`).
11. `tooling/panelStorageDocs.test.mjs:70-120`: `layer-panels.html` must contain `<div id="cctv-panel" class="panel-collapsible collapsed"`; drives `PanelPositionControls` restore/save behavior and the documented storage keys/versions.
12. `tooling/transitQa.test.mjs:197`: reads `display-controls.html`.
13. `materialSymbolsSubset.test.mjs`: every `material-symbols-outlined` glyph named in `src/**` HTML/JS templates must be listed in `index.html`'s `icon_names` subset. **A mobile UI that adds new Material Symbol icons must also extend that list.**
14. `overlays/worldOverlay.test.mjs:467-560,1394`: reads shipped CSS for stacking (z-index ladder: panels 100-139, voice 150, toast 200, clean-view-exit 300; overlay root z6) and index markup; new fixed layers must fit the ladder.
15. `firstRunExperience.test.mjs`, `loadingFeedback.test.mjs`, `radioMarkup.test.mjs`, `cockpitMarkup.test.mjs`: read `index.html` expansion and shell source for toast/loading (`shellFeedback.js`), first-run launcher positioning vs `body.recording-mode`, radio ids. `loadingFeedback` pins `#global-loading-status` status CSS (`status.css`).
16. Unit tests over slice JS behavior (not text): `ui/panelRails.test.mjs` (mobile layout releases desktop styles for both rails: `${side} mobile layout releases desktop height/position styles and labels`, so the `(max-width: 720px)` branch and its cleanup are contract), `ui/shellLifecycle.test.mjs`, `ui/shellLifetime.test.mjs`, `ui/stateOwners.test.mjs`, `ui/displayControls.test.mjs`, `ui/sceneControls.test.mjs`, `ui/mapSourceControls.test.mjs`, `ui/layerPanel.test.mjs`, `ui/layerPanelWidgets.test.mjs`, `ui/layerKeyRequirement.test.mjs`, `ui/locationControls.test.mjs`, `ui/cameraOrientationControls.test.mjs`, `ui/visualEffects.test.mjs`, `ui/visualInput.test.mjs`, `ui/surfaceKeyboard.test.mjs`.

Safe additions: a new stylesheet placed AFTER `command-dock-sliding.css` in `style.css` is picked up by every `readStylesheet` test but is only constrained by items 1, 5, 6 (rule ORDER between hover/active), 9 (no draw styles in the shim itself), 14. A new JS file outside the 11 `readShellSource` files is invisible to regex pins. New markup in `index.html`/templates is checked by the html-order regexes in items 2, 3, 6, so add new DOM as siblings/wrappers rather than inserting between pinned neighbours (e.g. do not insert elements between `#control-panel` and `.map-source-section`).

---

## 7. Constraints/opportunities summary for the rewrite

- **Must stay on screen** (recommended): `#north-up-view` (compass), voice pill `#gev-voice-control` (mic), `#toast`, `#global-loading-status` + sync chips (transient), `#cesium-credits` (mandatory), `#clean-view-exit` (only when clean view), scene playback controls (`#scene-stop-btn`, progress/status), plus one entry point to the menu.
- **Menu sections (proposed):** NAV (Places: `#location-pills`, `#poi-row`, `#location-search`; camera: `#tilt-map-view`, `#reset-globe-view`; Share `#share-btn`), LAYERS (`#data-panel` body incl. `#data-toggles`, `#clear-selected-layers`, CCTV `#cctv-panel`), VIEW (`#style-buttons`, `#map-stack-chips`, `#pp-toggles` groups incl. `#param-slider-panel`, clean view), TOOLS (`#draw-*`, CCTV calibration), SCENES (`#scene-panel`).
- **Move nodes, do not duplicate ids.** Existing precedents: Cockpit display portal (comment-anchor restore), `panelLayoutController` right-rail re-parent, `voice/control.js` dock insertion. Lookups happen once at construction, so re-parent after `StyleManager` construction (or before, at template level) and never re-create `#data-toggles`' children externally (LayerPanel owns them).
- **Disable/replace the desktop lane engines on touch:** they already early-return at `(max-width: 720px)`; a mobile mode wider than 720px (tablets, landscape phones 721-900px) would still run the desktop rails and desktop-style dock. Tests pin the 720 literal in `rightPanelRail.js`; introduce mobile mode via a body class + new module rather than editing those literals.
- **Hard-to-touch controls** (ranked by count): 3px-track range inputs (bloom, sharpen, scope feather, detection density/fade/opacity, all `.param-slider`, layer sliders), 20-22px collapse buttons, 16-24px chips/segments/selects, title-only help, `dblclick` (shot rename, draw finish), Esc-only cancel (draw, scene playback), hover-only voice help tray, `window.prompt/confirm`, `<16px` inputs.
- **Unknowns to verify on device:** outside-tap dismissal of dock trays; safe-area insets (need `viewport-fit=cover`); `100vh` vs dynamic toolbar; whether `:has()`-driven dock transform behaves on target iOS versions; `navigator.clipboard` availability on non-HTTPS.
