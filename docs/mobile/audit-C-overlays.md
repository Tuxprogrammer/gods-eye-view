# Mobile audit C: overlays, welcome, provider settings, voice, cards, annotations, feedback

Read-only audit for the touch/small-viewport rewrite. Desktop must stay untouched. No source was edited.
Paths are relative to the repo root; `T:` = `src/ui/templates/`, `S:` = `src/ui/styles/`.

Slice owned here: `welcome.html`, `provider-settings.html`, `hud-loading.html`; `first-run.css`, `provider-settings.css`,
`overlays.css`, `voice-cost.css`, `aprs.css`, `meshtastic.css`, `propagation.css`, `bhote-koshi.css`; voice UI; location search;
share/restore; draw tool + screen annotations; station/entity cards; toasts; credit line; logo/title/FPS/splitFlap; other DOM built in `src/`.
Neighbouring slices (dock, layer panel, context rail, cockpit, cctv, radio) are only referenced where my elements live inside them.

---

## 0. Headline findings (read these first)

1. **The first-run launcher has no close button.** It dismisses only by picking a tile, ticking "Don't show this again" (durable) or pressing ESC.
   The footer's "ESC to dismiss" hint is hidden at <=620px (`first-run.css:292`), so on a phone the only exits are the four tiles. Needs an X / "Skip" control.
2. **Draw tool is mouse+keyboard only.** Finish = double-click or Enter; undo = Backspace; cancel = Esc; a Pin is placed by Enter; the rubber-band uses
   `MOUSE_MOVE`. None of these exist on touch (`src/annotations/drawTool.js:296-315`, `:356-360`, hint copy in `drawMode.js:286-302`).
   It needs explicit Undo / Finish / Cancel / Place buttons in a mobile draw sheet.
3. **Voice push-to-talk is Space-only.** The mic button is a tap toggle (open mic). Help copy ("Hold Space to speak") is wrong on touch.
   The tier (`STD/MINI`) button is 0.72rem (~11.5px) tall with 0.4rem (~6.4px) text and the cost readout is 0.4rem text (`voice-cost.css:15-63`).
   `getUserMedia` needs a secure context, so a phone hitting the dev server over LAN `http://` will land in the error tray.
4. **Hover-only surfaces:** APRS/Meshtastic/propagation hover preview cards (`pointermove`, and a held button is treated as camera drag so touch never previews),
   mission-roster hover preview (`mouseenter`/`mouseleave`, `layers/launches/panel.js:104-105`), the voice help tray (`:hover`, `command-dock-sliding.css:650`),
   frame-rate readout (backtick key only, `frameRateMonitor.js:52`), Orbit (key `O` only; `#orbit-indicator` is display-only), POI hotkeys Q/W/E/R/T shown as labels.
5. **Attribution must stay visible** (Google/Cesium ToS). `#cesium-credits` is `position:fixed; z-index:90; font-size:10px` (`foundation.css:294`) and is
   pinned by a computed-CSS test (`src/creditAttribution.test.mjs`) that models `bottom` at every width, `display/visibility/opacity`, and the dock/rail keep-out.
   Any mobile layout that moves dock/rails must re-satisfy that test or replace it deliberately. The lightbox already goes full-screen at <=575px (`foundation.css:378`).
6. **Large fixed-width, absolutely-positioned floaters** that assume a mouse and a wide canvas: Bhote Koshi event panel (330px), embedded-media callouts
   (356/280/214px with leader lines, no close button), scene "Scene actions" panel (`left:12; bottom:80`, inline styles) and data-pack cards (`right:10; bottom:70`),
   APRS/propagation cards (220-300px, follow the map every frame).
7. **iOS input zoom risk.** Most inputs here are 9-13px (`data-server-form` 9px, key-setup 0.66rem, `#location-search` 13px/0.68rem, draw label 10px, scene dialog 14px).
   iOS Safari zooms on focus below 16px. The viewport meta is `width=device-width, initial-scale=1.0` only (no `viewport-fit=cover`, no `maximum-scale`, no `env(safe-area-inset-*)` outside `#top-center-actions` at `responsive.css:32`).
8. **No `touch-action`, `pointer: coarse`, or `hover: none` rules exist anywhere** except the Bhote split handle (`bhote-koshi.css:579`, `touch-action:none`). Only viewport-width `@media` and JS `matchMedia('(max-width: 720px)')` gate mobile behaviour.
9. **Escape-only dismissals** to replace with visible controls: first-run, key-setup (has an X), APRS/prop card (has an X when pinned), flight untrack (`layers/flights/tracking.js:1111`), vessel deselect (`layers/vessels/selection.js:144`), draw cancel, credit lightbox (has a close), scene dialog (Cancel button exists).
10. **Overlay collision list is selector-pinned.** `WORLD_OVERLAY_OCCLUDER_SELECTORS` (`src/overlays/worldOverlay.js:94-118`) names `#title-bar, #style-indicator, #top-center-actions, #traffic-sync-chip, #cctv-sync-chip, #left-panel-stack, #right-context-rail, #pp-toggles, #command-dock, #gev-voice-control, #cesium-credits, .hud-*, #space-mission-panel(-host), #military-awareness-panel, #bhote-koshi-event-panel, #cockpit-*`. Renaming/removing an id silently changes where canvas cards may draw; a test (`worldOverlay.test.mjs:313-325, 1522-1525`) checks membership.

---

## 1. Z-index / stacking ladder for this slice (for sheet planning)

| z | element |
|---|---|
| 1000 | `#loading-screen` (`controls.css:267`) |
| 300 | clean-view exit (elsewhere) |
| 200 | `#toast` (`status.css:386`); `.cesium-credit-lightbox-overlay` `!important` (`foundation.css:346`) |
| 190 | `#key-setup` (`provider-settings.css:62`) |
| 175 | `#first-run-launcher` (`first-run.css:6`) |
| 150 | `#gev-voice-control` when not docked (`foundation.css:399`) |
| 142 | `#bhote-koshi-event-panel` (`bhote-koshi.css:9`) |
| 102 / 101 | `#global-loading-status` / `#traffic-sync-chip`, `#cctv-sync-chip` |
| 100 | `#title-bar`, `#style-indicator`, `#orbit-indicator` |
| 95 | `#safe-frame-overlay` |
| 90 | `#cesium-credits`; `.gev-screen-whiteboard` |
| 70 / 65 | `.aprs-card`, `.propagation-station-card` / `.aprs-popups` |
| 60 | `#key-setup-chip` |
| 31 / 30 | scene "Scene actions" panel / data-pack cards (inline) |
| 8 | `#bhote-koshi-split-line` |
| 7 / 6 / 5 / 2 / 1 | bhote media root / world overlay root / detection surface / `#intel-hud`, celestial ring / scope mask |

Modal-vs-non-modal: first-run and key-setup are `role="dialog"` but **non-modal** (page not inert; `surfaceKeyboard.js` only traps Tab/ESC). The scene sharing dialog is a real `<dialog>.showModal()`.

---

## 2. Element tables

Column key: **Def** = definition; **Desktop** / **Small** = current behaviour (`Small` = existing <=720/620/575/520 rules); **Touch problems**; **Mobile** = recommended treatment.
Treatment vocabulary: *Menu* (section in the new mobile menu), *Sheet* (bottom sheet), *Modal* (full-screen), *Stay* (remains on screen), *Shrink*, *Drop*.

### 2A. Startup and first-run

| Element / selector | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#loading-screen` + `.loader-content`, `.loader-logo`, `<h2>`, `.loader-status` | Full-screen cover while the viewer/tileset initialise; status text updated by JS (`loaderStatus`) | `T:hud-loading.html:5-11`, `S:controls.css:267-340`, `src/app/scene.js` (loaderStatus) | Fades out (0.8s); logo 128px pulsing, h2 18px/6px spacing | No @media | Uses `vh`-less `inset:0` so fine; long status strings ("Google 3D Tiles unavailable (...)") wrap unbounded; pulse animation on `.loader-status` costs battery | Stay; cap width, allow wrap, respect reduced motion; add safe-area padding |
| `#first-run-launcher` (`<aside role=dialog>`, hidden until revealed) | Mission picker; enables layers / context mode | `T:welcome.html:5-52`, `S:first-run.css:4-54`, `src/firstRunExperience.js` | Centered card 34rem, `top/left:50%`, fade+slide, non-modal, z175, `max-height: calc(100dvh - 1.5rem)` | **@media (max-width:620px)**: `top:auto; bottom:5.8rem` (sits above dock), tighter padding; `@media (max-height:620px)`: tighter rows | Bottom offset 5.8rem is a magic number tied to dock height; card is `pointer-events:none` until `.visible`; hidden by `display:none` under `ui-clean-view/recording-mode/cockpit-mode/scene-playback-mode`; **no close control**; ESC hint removed at <=620 | Modal (full-screen or 90dvh sheet) with a visible Skip/X; no dock-height coupling; keep `data-first-run-*` hooks and the four-tile order |
| `.first-run-scanline` | Decorative cyan line | `first-run.css:56` | Shown | Shown | none | Drop or keep (aria-hidden) |
| `.first-run-header` / `.first-run-kicker` "MISSION CONTROL - FIRST LAUNCH" | Kicker text | `welcome.html:7-9`, `first-run.css:70-85` | 0.58rem mono | same | 9px text | Shrink OK; decorative |
| `#first-run-title` h2 "Choose your first view" | Title (aria-labelledby) | `welcome.html:10` | `clamp(1.25rem, 2.4vw, 1.75rem)` | 1.1rem at short height | fine | Stay |
| `#first-run-description` | Owner-authored line, pinned VERBATIM incl. unspaced em dash | `welcome.html:15`, `firstRunExperience.test.mjs` (~L570) | 0.78rem | 0.72rem | Copy is test-pinned; do not reword | Stay, do not edit text |
| `.first-run-choices` (scroll region) | Only scrollable part of card; mask fade gated by `data-scrollable` | `welcome.html:16`, `first-run.css:103-125, 337-371` | Thin scrollbar, `scroll-behavior:smooth` | scrolls when card overflows | **Nested scroll** inside a fixed card; CSS scroll-driven fade (`animation-timeline`) | Remove nested scroll: four tiles fit a sheet; keep `data-scrollable` logic only if list can overflow |
| Tile `button[data-first-run-choice="contacts"]` LIVE CONTACTS | Enables contacts context | `welcome.html:17-21` | min-height 3.55rem; hover translate | 3rem / 2.7rem | Height OK (>=44px at default); `:hover` translateX is decorative; `aria-disabled` (not `disabled`) while busy | Stay, 56px+ rows |
| Tile `space-missions` SPACE MISSIONS | Opens Space Missions context mode + reveals panel | `welcome.html:22-26` | same | same | same | same |
| Tile `environmental` (`[data-first-run-environmental-title]`) | Enables earthquakes + FIRMS; label painted from `ENVIRONMENTAL_LABEL_CHOICE` | `welcome.html:27-35`, `firstRunExperience.js:38-51` | same | same | subcopy pinned to name both feeds (test) | same |
| Tile `explore` (`.first-run-explore`) | Dismiss to clean globe | `welcome.html:36-41` | subtler background | same | same | Stay; can double as the Skip control |
| `.first-run-arrow` icons | Affordance | `welcome.html` | Material Symbols `arrow_forward` | same | Icon-font glyphs must remain in the `icon_names` subset (`materialSymbolsSubset.test.mjs`) | Stay |
| `.first-run-footer`: `label.first-run-suppress` + `input[data-first-run-suppress]` "Don't show this again" | Writes durable suppression | `welcome.html:42-47`, `first-run.css:206-233` | checkbox 0.82rem (13px), label 0.62rem | same | **13px checkbox** is a tiny target; label click helps; markup pinned by `hudA11y.test.mjs:25` and `firstRunExperience.test.mjs` | Enlarge to 44px row; keep exact markup pattern or update those tests |
| `span` "ESC to dismiss" | Hint | `welcome.html:48` | shown | hidden <=620 (`first-run.css:292`) | Keyboard-only | Drop on touch |
| `.first-run-note[data-first-run-status]` (`role=status`) | Progress / error line; default text "Tip: the GEV MIC button in the dock lets you talk to the map." | `welcome.html:51`, `first-run.css:237-248` | 0.62rem | `min-height:0` at short height | Live region shares space with layout; sticky error text | Stay; tip text depends on dock mic existing on mobile |
| Show-policy (not UI) | `?welcome=0/1`, share links skip, session/durable keys | `firstRunExperience.js:1-25` | | | On a phone the session flag is set by ANY close incl. tile | Keep; consider always showing on first mobile visit |

### 2B. Provider settings ("POWER UP", dev server only)

Only exists when `/api/setup/status` answers (loopback dev server); `keySetup.js:170-190` removes chip+dialog otherwise (prod build, LAN visitors, so a phone on LAN never sees it). Keep behaviour but make it usable when opened via `?setup=1` on a tablet on localhost.

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#key-setup-chip` (button "POWER UP", `[data-key-setup-chip-label]`) | Opens dialog; label = key count; retires when all keys set | `T:provider-settings.html:5-8`, `S:provider-settings.css:7-58`, `keySetup.js:212-232` | fixed `right:0.9rem; bottom:0.9rem`, z60 | **<=620**: `bottom:5.8rem` (`provider-settings.css:355`) | 0.6rem text, padding 0.45rem 0.7rem (~26px tall); collides with dock/voice; hidden under clean/recording/cockpit/scene modes | Menu (Settings > Provider keys); drop floating chip on mobile |
| `#key-setup` dialog (`aside role=dialog`) | Key entry / removal | `provider-settings.html:9-24`, `provider-settings.css:60-101` | Centered 36rem card, `max-height: calc(100dvh - 1.5rem)`, non-modal, z190 | Same (only `min(36rem, 100vw - 2rem)`) | Non-modal; virtual keyboard resizes viewport (`dvh` helps) | Modal full-screen |
| `.key-setup-header` kicker + `button.key-setup-close[data-key-setup-close]` | Close | `provider-settings.html:11-15`, `css:134-157` | icon 1rem, padding 0.15rem (~19px) | same | **Tiny close target** | 44px close |
| `#key-setup-title`, `#key-setup-description` | Copy | `provider-settings.html:17-18` | 0.78rem | same | Long paragraph | Collapse behind "Details" |
| `.key-setup-rows[data-key-setup-rows]` | Scrollable list of rows built by `buildRow()` | `keySetup.js:66-148`, `css:182-200` | thin scrollbar | same | **Nested scroll** inside fixed card | Full-screen page scroll |
| `.key-setup-row` (section per key; `data-key-id`, `data-set`, `data-managed`) with `.key-setup-led`, `<strong>` title, `.key-setup-tier` (emoji dot, `title` tooltip), `.key-setup-exposed` "browser-side" (`title`), `.key-setup-external` "configured externally" (`title`), `a.key-setup-get` "GET KEY / MANAGE" (target=_blank), `p.key-setup-unlocks` | Status of one provider key | `keySetup.js:66-118`, `css:202-276, 362-372` | 0.5-0.7rem text | same | **Explanations live in `title` tooltips (hover-only)**: tier meaning, browser-side warning, external badge. Link is 0.58rem text | Show tooltip copy inline; 44px link |
| `.key-setup-fields input[type=password][data-env-var]` | Paste key (masked) | `keySetup.js:120-136`, `css:283-301` | 0.66rem mono | same | 10.5px font -> iOS zoom; `autocomplete=off`; paste-only UX fine | 16px font; `autocapitalize=off` |
| `button.key-setup-remove[data-key-setup-remove]` "REMOVE" | Removes saved key; **uses `window.confirm()`** | `keySetup.js:137-145, 331-345`, `css:374-395` | 0.55rem | same | ~20px target; native confirm ok on mobile | 44px target |
| `.key-setup-footer`: `button.key-setup-apply[data-key-setup-apply]` "SAVE KEYS" + "ESC to close" hint | Submit; page reloads after restart | `provider-settings.html:20-23`, `css:303-331` | 0.66rem, `aria-disabled` while busy | hint not hidden on mobile | ~28px button; ESC hint irrelevant | Sticky 48px primary button; drop hint |
| `.key-setup-note[data-key-setup-status]` (`role=status`) | Save status | `provider-settings.html:24` | | | | Stay |

### 2C. Persistent chrome, feedback, credit

| Element / selector | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#title-bar` (`.title-glow`, `h1`, `.title-logo.brand-logo[data-logo-gaze]` + `<img src=/logo.svg>`, `.subtitle` "NO PLACE LEFT BEHIND") | Brand/title; also carries `.radio-broadcasting` class to animate logo arcs | `T:scene-chrome.html:11-15`, `S:foundation.css:511-635` | fixed `top:32; left:36`, h1 26px/8px spacing, logo 52px, `pointer-events:none` | **<=720**: `top:20;left:20`, h1 16px, logo 36px (`responsive.css:26-53`); **<=520**: `top:14;left:16`, wordmark span + subtitle hidden (`responsive.css:242-250`, **test-pinned** `cockpitMarkup.test.mjs:250`) | Non-interactive: fine, but occupies top-left where a mobile menu button likely goes; `WORLD_OVERLAY_OCCLUDER_SELECTORS` includes `#title-bar` | Stay as compact logo-only mark; hosts the menu button or moves to it; keep `#title-bar` id and `.radio-broadcasting` class contract (radioMarkup test pins `::before/::after`) |
| `.brand-logo[data-logo-gaze]` (title logo, loader logo) | Eye follows pointer | `logoGaze.js:1-181`, `foundation.css:607-618` | `pointermove` listener on window | **Ignores `pointerType==='touch'`** (`logoGaze.js:149`) and reduced motion | none | Stay; consider stopping listener on touch devices |
| `.frame-rate-readout` (`div`, `hidden`, `title` "toggle with `") | FPS counter appended to `#title-bar` | `src/ui/frameRateMonitor.js:1-81`, `foundation.css:635`, wired `ui/displayBindings.js:59` | Toggled by backtick key only | **<=720**: becomes `position:fixed; top:52; left:20`, hides subtitle while visible (`responsive.css:55-66`) | **Keyboard-only toggle**, undiscoverable on touch | Menu toggle (Developer > FPS) that calls the same show/hide; keep `.frame-rate-readout` |
| `#style-indicator` (`ACTIVE STYLE` + `#active-style-name`) | Shows visual style | `scene-chrome.html:18-21`, `foundation.css:645` | fixed top-right | **hidden <=720** (`responsive.css:38`, test-pinned) | none | Drop from canvas; show style name in menu |
| `#toast` (`role=status`) | One-line transient messages; 2s (`shellFeedback.js:181-190`) | `scene-chrome.html:56`, `status.css:386-420` | fixed `bottom:100px; left:50%`, z200, uppercase 11px, `pointer-events:none` | No @media | `bottom:100px` collides with the mobile dock/sheets and the credit line; no tap-to-dismiss; no max-width: with `left:50%` the shrink-to-fit box is capped at ~50vw, so on a 375px phone long copy wraps into a ~185px column (uppercase, 2px tracking) | Stay; anchor above the active sheet/dock using a CSS var; `max-width: calc(100vw - 32px)`, wrap; keep `#toast` id (shellLifecycle test) |
| Toast senders (for copy audit) | "Link copied!", "Copy failed", "Location not found", "Search failed", "Fly to a POI first", "Exit cockpit to fly to a ...", "Tilted view", "North up", "CCTV ...", layer-clear messages, panel-position messages | `applicationShell.js:1374`, `ui/locationNavigation.js:90-91,276`, `navigationPolicy.js:93-136`, `cameraOrientationControls.js:325,344` | | | Mention of "panel position" messages (`panelPositionControls.js:58`) relates to drag-to-move panels which are not applicable on mobile | Review copy |
| `#global-loading-status` (`role=status`) + `#global-loading-label` (split-flap) + `#global-loading-detail` | Aggregated "LOADING LIVE DATA / LOAD COMPLETE / ACQUIRING (SHARED X)" | `scene-chrome.html:42-45`, `status.css:83-175`, `ui/shellFeedback.js:100-131` | fixed `top:74; left:50%`, 8px text, `pointer-events:none`, max-width `calc(100vw - 32px)` | No @media | 8px type; sits at `top:74` overlapping mobile header; test-pinned markup (`loadingFeedback.test.mjs:209, 244-250`) | Stay as a slim status strip under the header; >=11px; keep id/attrs |
| `#traffic-sync-chip` (`#traffic-sync-label` split-flap, `#traffic-sync-progress`) | Road-network sync chip | `scene-chrome.html:46-49`, `status.css:176-230` | fixed `top:112; left:50%` | No @media | Two chips stacked at `top:112/146` (cctv chip = other slice); 8px | Merge into the single status strip; keep ids for `shellFeedback` |
| `splitFlap` (`.gev-flap-*`) | Departure-board char flip on chip labels | `src/splitFlap.js`, `status.css` ~L230-383 | animated | honours `prefers-reduced-motion` (`splitFlap.js:250-256`) | Per-char DOM churn on live regions; cost on low-end phones | Disable animation on mobile / reduced power; text truth is preserved |
| `#safe-frame-overlay` / `#safe-frame-box` (+ `.ratio-9-16`) | Recording composition guides | `scene-chrome.html:59-61`, `overlays.css:1-65`, `ui/recordingControls.js` | full-viewport, `pointer-events:none`, `min(90vw, 90vh*16/9)` | none | purely visual; recording is a desktop use | Keep, hide when recording controls hidden on mobile |
| `#orbit-indicator` ("↻ ORBIT") | Shows orbit is active | created `ui/locationControls.js:140-150`, `overlays.css:68-96` | fixed `top:70; right:36`, 10px, `pointer-events:none` | none | Only indicator; **orbit toggle is key `O` (`applicationShortcuts.js:36`) or voice** | Add an Orbit button (Location sheet) + reposition indicator |
| `#cesium-credits` (Cesium credit line: logo, "Google Maps", "Data attribution" `.cesium-credit-expand-link`) | **Required attribution** | created `src/app/scene.js:46-49`; CSS `foundation.css:294-322`, `command-dock*.css` (many overrides: `command-dock.css:225,290-`, `command-dock-trays.css:450-495`) | fixed bottom-left `bottom:36 left:36` (ui-clean/recording keep it: `bottom:36;left:36`); compact dock: `bottom:0.75rem; left:1.5rem; max-width:calc(50vw - 15rem)`; `#intel-hud` minimal variant moves it right | **<=900**: `bottom:calc(2vh + 5rem); left:0.75rem; max-width:calc(100vw - 1.5rem)`; **<=980**: `calc(2vh + 9.5rem)` (dock stacks) | 10px text, `white-space:nowrap`, `pointer-events:auto`; the "Data attribution" tap target is ~10px high; Cesium re-writes inline styles every frame (do not fight); ALPR layer changes wrapping via `body:has(...)` | **Stay, always visible**, never inside a menu. Anchor above the bottom bar/sheet peek height with a single CSS var; >=44px tap area around "Data attribution"; re-pass `creditAttribution.test.mjs` |
| `.cesium-credit-lightbox` + `.cesium-credit-lightbox-overlay` (Data attribution dialog) | Full credit list | Cesium DOM; CSS `foundation.css:344-384` | 470px wide, `max-height: min(70dvh,36rem)`, list scrolls (nested), z200 `!important` | **<=575px**: `100% x 100%`, `max-height:100dvh` (full-screen) | Already mobile-ready; overlay above launcher (launcher uses `elementFromPoint` to yield, `firstRunExperience.js:100-130`) | Stay as-is; ensure new sheets stay under z200 |
| `configureCreditKeyboardAccess()` | Adds role/tabindex/aria + Enter/Space + Esc to credit expander and close | `src/creditKeyboard.js:1-74`, `creditKeyboard.test.mjs` | keyboard a11y | same | Touch unaffected (clicks still work); Space on the credit control is armed vs voice PTT (blur cancels) | Keep untouched |

### 2D. Intelligence HUD

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#intel-hud` (`data-variant` = tactical / operator / minimal; `.active`) | Fullscreen decorative telemetry overlay (`pointer-events:none`, z2, uppercase 10-16px) | `T:hud-loading.html:2`, DOM built `src/hud.js:176-241`, CSS `overlays.css:98-372`, `hud-*` variants in `command-dock*.css` (bottom offsets) | Corners at `36px`, `top:120/70`, bottom `180` | **<=720** (`responsive.css:86-143`): corners at 16px, edge strips hidden, bars full-width 12px inset, `.hud-top-bar top:54`, `.hud-bottom-bar bottom:90` | Covers ~all four corners of a phone canvas; text 9-13px; collides with title/menu (top) and dock/credit (bottom); 4 timers (`hud.js:248-275`) incl. 250ms DOM updates and AI summary fetch every ~15s -> battery/cost | Menu toggle (default off on phones) or "Readouts" chip opening a compact sheet with only MGRS/lat-lon/alt/summary; keep `#intel-hud` id and `hud-*` ids used by `hud.js` (`hud-mode, hud-summary, hud-timestamp, hud-rec-dot, hud-mgrs, hud-latlon, hud-gsd, hud-alt, hud-ais-vessel, hud-coll, hud-ona, hud-bottom-line`) |
| HUD pieces: `.hud-top-bar`, `.hud-corner.hud-top-left/right`, `.hud-bottom-left/right`, `.hud-left-edge/.hud-right-edge`, `.hud-bottom-bar` | Classification banner, mode, summary ("Awaiting telemetry..."), REC clock, ORB/PASS, MGRS, lat/lon, GSD/NIIRS, ALT/SUN, AIS vessel, edge metadata | `hud.js:180-240` | See variants | Edge strips hidden; others remain | Rotated 90deg text (`hud-left-edge`) unreadable/irrelevant on phone | Drop edges; group corners into one collapsible readout |
| HUD variant control `#hud-toggle`, `#hud-layout-select` | (display panel, other slice) | `display-controls.html:9-15` | | | | Coordinate with display-controls auditor |

### 2E. Voice ("GEV MIC")

Voice DOM is created by `src/voice/control.js:1-72` and moved INTO `#command-dock` (`control.js:45-54`), so the dock audit owns its position; fields below are the elements themselves.

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#gev-voice-control` (`data-status` idle/connecting/listening/executing/error, `data-speaker`, `data-microphone`, `data-push-to-talk`) | Container/pill | `control.js:8-15`; CSS base `foundation.css:399-423`; docked grid `command-dock-trays.css:225-236`, `command-dock-compact.css:221-236`, `command-dock.css:~225` | Docked: `--dock-voice-width` 8.75rem (trays) / `clamp(13.5rem,17vw,15rem)` (compact), height 5.35rem, negative margins; undocked: fixed bottom-right pill | **<=720** `right:16 bottom:16 min-width:196` (undocked rule), **<=620** `--dock-voice-width: 8.75rem` | Fixed geometry with negative margins; overlaps credit corner; pinned by `creditAttribution.test.mjs` dock height (62px) | Stay as the primary floating mic FAB (bottom-right, above safe-area); status/cost inside a sheet |
| `#gev-voice-button` (mic orbit `<img src=/mic.svg>` + `.gev-mic-label` "ON/OFF") | Click = start/stop open-mic session (`sessionCommands.js:60-66`); `aria-label` mentions Space | `control.js:22-25`, `foundation.css:425`, docked `command-dock-trays.css:256-270` (2.65rem x 4.15rem; orbit 2.45rem) | Tap target OK (~42x66px docked) | same | **No hold-to-talk on touch**; `adapter.ignoreButtonClick` keyed on Space held (`realtimeSession.js`) | Large FAB with press-and-hold PTT (pointer events) + tap-to-lock; reuse `setMicrophoneEnabled`; update aria-label |
| `.gev-voice-heading` > `.gev-voice-kicker` "AI AGENT" + `#gev-voice-status` | State label (OFF/CONNECTING/LISTENING/...) | `control.js:16-21`; docked 0.43-0.46rem | ~7px text | same | Illegible at 7px | >=12px status in the sheet/FAB label |
| `.gev-voice-cost` > `button#gev-voice-tier` (STD/MINI, `aria-pressed`, `title`) | Model tier toggle, applies next session; persisted | `control.js:18-20`, `voice-cost.css:7-63`, logic `voice/realtimeCost.js:40-100` | 0.72rem x min 1.55rem | Hidden when a tray is open (`voice-cost.css:76`) | **~11.5px tall**; state explained only by `title` tooltip | Voice sheet row with segmented control + inline explanation; 44px |
| `#gev-voice-cost-value` (`data-level` ok/warn/cap; `title` details) | Running cost estimate "~$0.00" | same | 0.4rem (6.4px) | same | Unreadable; warn/cap colour only | Voice sheet: large cost + cap text |
| `.gev-voice-visualizer` (15 `span`s, `aria-hidden`) | Live waveform | `control.js:26-28`, `realtimeInput.js:200-260`, docked CSS | animated on rAF with AudioContext analyser | same | Continuous rAF + AudioContext cost on mobile | Keep (smaller, e.g. 9 bars); pause when hidden |
| `#gev-voice-detail` in `.gev-voice-readout` | Sub-status ("Hold Space to talk", "Release Space to send", errors) | `control.js:30-32`; strings in `realtimeConnection.js:179`, `realtimeController.js:294`, `realtimeInputPolicy.js:153` | 0.39-0.43rem ellipsis | same | Space wording wrong on touch | Touch-specific copy ("Hold to talk") |
| `#gev-voice-help` `.gev-voice-help-tray` (`role=tooltip`) | "Hold Space to speak - tap Space to activate focused controls" | `control.js:33-36`, `command-dock-sliding.css:602-668` | Shown on `:hover` / button `:focus-visible`, above dock, z7 | same | **Hover-only**, mentions keyboard | Drop on touch; first-use coach mark inside voice sheet |
| `.gev-voice-error-tray` (`role=alert`) + `.gev-voice-error-dismiss` "DISMISS" + `#gev-voice-error-detail` + hint | Error panel; dismiss adds `.error-dismissed` | `control.js:37-43,56-59`, `command-dock-trays.css:368-440,490` | Tray above dock, width `clamp(19rem,29vw,24rem)`, **<=900** `min(24rem, 100vw - 1.5rem)` | same | Dismiss button 0.43rem text (~14px tall); hint says "Check microphone permission and network access" | Full-width dismissible banner/sheet; add HTTPS-required explanation for LAN http |
| Push-to-talk (behaviour) | Hold Space; keydown capture on document; ignores editable/interactive targets | `voice/realtimeInput.js:53-160`, `realtimeInputPolicy.js:10-105` | Desktop | n/a | None on touch | See mic button row |
| Session lifecycle / permissions | `getUserMedia`, WebRTC, ephemeral token | `voice/realtimeConnection.js:61-125` | | | Requires secure context + user gesture; iOS audio element autoplay (`audioEl`, L133); background tab suspends audio | Test on iOS Safari/Chrome; add explicit "Enable microphone" first-run step |
| Viewport capture for voice (`realtimeViewport.js`) | Reads Cesium canvas; creates canvases | `voice/realtimeViewport.js:18-140` | | | Memory heavy at DPR 3 | Keep; cap resolution on mobile |

Persisted keys (voice): `godsEyeView.voiceCost.tier`, `godsEyeView.voiceCost.limits` (`realtimePreferences.js:11-13`), `gev-realtime-errors` (`realtimeDiagnostics.js:3`).

### 2F. Location search and location mini-status (JS-owned pieces)

Dock markup is in `command-dock.html:70-108`; the dock/tray layout is another auditor's; below are the search-specific controls owned by `location*.js`.

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#search-toggle` `.search-toggle-btn` (magnifier emoji) | Expands/collapses inline search input and focuses it | `command-dock.html:~90`, `ui/locationControls.js:58-63`, `location.css:247-270` | 32px circle | dock overrides `command-dock*.css` | Emoji glyph; 32px (<44) | Location sheet with a permanent search field |
| `#location-search` `input` (`.expanded`, `.searching`) | Free-text/coordinate geocode; **submit only on Enter key** (`locationControls.js:64-66`) | `command-dock.html:~91`, `location.css:272-303`, `command-dock-trays.css:220` (0.68rem) | Width 0 -> 180px animated; Esc dismisses (`applicationShortcuts.js:33`) | `#command-dock .location-search-wrap{flex-basis:150px}` at <=720 | 13px / 10.9px font -> iOS zoom; no submit button, no `enterkeyhint`/`type=search`, no suggestions/clear button; focus outline pinned by `keyboardFocusStyles.test.mjs:51` | Full-width field, `type=search enterkeyhint=go`, explicit Go/clear, recent list; keep id and Enter handling |
| Search pipeline `LocationSearch` (`ui/locationSearch.js`) | Cancellable geocode; publishes started/found/missing/failed/settled | `ui/locationSearch.js:1-145`, `ui/locationNavigation.js:90-91` | toasts "Location not found", "Search failed" | same | Toast-only errors | Inline result/error under field |
| `.location-pills` `button.location-pill[data-location-id]` | City presets, horizontally scrollable | `ui/locationControls.js:34-42`, `location.css:81-135` | `overflow-x:auto` hidden scrollbar | dock CSS | Horizontal scroller (nested, no scroll cue); `:hover` styles; padding 6px x 14px (~27px tall) | Vertical list / chips in Location sheet |
| `#poi-row` `.poi-pill[data-poi-index]` (`.poi-pill-key` Q W E R T, `.poi-pill-name`) | POI presets; expand row animates `max-height` | `ui/locationControls.js:86-113`, `location.css:137-240` | Hotkeys **Q/W/E/R/T** (`locationControls.js:2,49-57`) | same | Hotkey badges are meaningless on touch; 50px row cap | Drop badges on touch; list rows |
| `#location-mini-status` `#location-mini-city` / `#location-mini-poi` | Two-line "current place" readout | `command-dock.html:~78`, `locationStatus.js:1-68`, `location.css:53-80` | 9px/8px ellipsis | same | 8px text | Show as sheet header |
| `#location-bar-toggle`, `.dock-pin-btn`, `.panel-collapse-btn` | Dock tray disclosure/pin | `command-dock.html` | | | Owned by dock audit | n/a here |

### 2G. Sharing and share restoration

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#share-btn` (`.share-icon` emoji link) in `#top-center-actions` | Copies share URL via `navigator.clipboard.writeText`; toast "Link copied!"/"Copy failed" | `scene-chrome.html:28`, `applicationShell.js:1367-1376`, `sharelink.js:511-525`, `status.css:~168` | icon button | `#top-center-actions` moves to `right:16` at <=720 | Clipboard API needs secure context + focus (fails on LAN http); no `navigator.share` fallback; emoji icon | Menu > Share with Web Share sheet (`navigator.share`) falling back to copy; show URL if both fail |
| Live hash sync (`history.replaceState`) | Continuously rewrites `#...` state | `sharelink.js:528-539` | debounced | same | Address bar churn is fine on mobile | Keep |
| Share-restore status | `ACQUIRING / SHARED <LABEL>` (persistent) and deferred failure notices via global status, waits for `#loading-screen` `transitionend` or 1s fallback | `ui/shareRestoration.js:186-260`; pinned by `loadingFeedback.test.mjs:98-109` | | | Uses `#loading-screen` id and `transitionend` | Keep ids/logic; notices land in the mobile status strip |
| First user gesture cancels restore (`pointerdown`/`wheel` on canvas) | Prevents restore fighting a user | `shareRestoration.js:106-126, 296-301` | | Works with touch pointerdown | Pinch/drag counts as gesture (intended) | Keep |
| Scene sharing dialog `createSceneDialog()` (`dialog.director-sharing-dialog[data-director-dialog]`; buttons Cancel/Apply/Download; textareas; file inputs) | Import review/export/authoring | `ui/sceneSharing.js:1-108`, used by `scenes/sharing.js` | Real `<dialog>.showModal()`, `width:min(720px, 100vw-32px)`, `max-height: calc(100vh - 32px)`, **all inline styles**, 14px | same | `100vh` (not `dvh`) clips under mobile URL bars; buttons ~30px; file/folder `<input type=file webkitdirectory>` folder pick unsupported on iOS; downloads via temporary `<a download>` (iOS Safari share-sheet behaviour) | Full-screen modal; move inline styles to CSS; `dvh`; hide folder option on iOS |
| `mountSceneSharing` bar: `button.scene-btn` "EDIT DETAILS", "SHARE SCENE" (`div.scene-controls[data-director-authoring]`) | Appended to `#scene-panel .scene-panel-inner` | `ui/sceneSharing.js:110-137`, `scenes/sharing.js:391` | | | Lives inside scene panel (other slice) | Scene sheet |
| Scene project export/import + run metadata downloads | Anchor+Blob downloads | `scenes/director.js:1935-1955, 2038-2050`, `scenes/sharing.js:16-27` | | | iOS download UX | Use Web Share files when available |

### 2H. Draw tool and annotations

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#draw-toggle` (`aria-pressed`) in DISPLAY panel | Enter/leave draw mode; claims pointer; adds `body.gev-drawing` (crosshair cursor) | `display-controls.html:93-96`, `annotations/drawTool.js:107-`, `controls.css:826-870` | | DISPLAY panel rules | Cursor rule meaningless on touch | Draw sheet / toolbar mode |
| `#draw-mode-row` `.pp-mode-seg` buttons `[data-shape=area|line|pin]` (`role=radio`) | Choose shape | `display-controls.html:97-104`, `drawTool.js:410-425` | ~24px high | same | Small segments | 44px segmented control |
| `#draw-label-input` (maxlength 120) + `#draw-color-select` (5 colours) + `#draw-clear` | Label, colour, clear board | `display-controls.html:105-115`, `controls.css:826-857` | 24px height, 10px font | same | 10px font zoom; native select OK | 16px fields; colour swatches |
| `#draw-hint` (`aria-live`) | Guidance copy from `drawHint()` incl. "double-click or Enter to finish, Backspace undoes, Esc cancels" | `drawMode.js:286-302`, `drawTool.js:77,114` | 8px | same | **Instructs keyboard-only actions** | Replace with tap-oriented copy + buttons |
| Vertex placement | `LEFT_CLICK` adds vertex; `LEFT_DOUBLE_CLICK` finishes; `MOUSE_MOVE` rubber band; Enter/Esc/Backspace keys | `drawTool.js:356-375, 296-315` | Borrows Cesium's stock click + double-click from the viewer handler for the session (`:369-393`) | none | Double-tap conflicts with browser zoom and camera; no `MOUSE_MOVE` on touch (no preview line); Backspace/Enter/Esc unavailable; multi-touch gestures may register clicks | On-screen **Undo / Finish / Cancel / Place pin** and "tap to add" mode; consider a crosshair-centre "drop vertex" flow that avoids fat-finger error |
| Pointer ownership | `claimPointer('draw')`, else hint "X is using the pointer - close it first" | `drawTool.js:317-330` | | | Message names an internal owner id | Friendlier copy |
| `.gev-screen-whiteboard` (`div` + SVG, `pointer-events:none`, z90) | Screen-space annotation renderer: callouts (SVG `g.gev-anno-callout` text 13px), rings, arrows, areas, sketch filter | `annotations/screenAnnotationRenderer.js:693-857` (styles injected as `<style id=gev-screen-whiteboard-styles>`) | Fixed inset:0 | none | 13px callout text ok; `feTurbulence` displacement filter (`#gev-sketch`) is GPU/CPU heavy on phones; z90 same as credit line (credit z90, DOM order decides) | Keep; reduce/disable sketch filter on mobile; ensure callouts avoid new mobile chrome (they do not know about it) |
| World annotation renderer / hybrid | Canvas labels via world overlay | `annotations/worldAnnotationRenderer.js`, `hybridAnnotationRenderer.js` | | | Not DOM | none |

### 2I. Station / entity cards and pop-ups

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `.aprs-card` (`role=tooltip` -> `dialog` when pinned; `.aprs-card-head` glyph/title/`.aprs-card-stack`/`.aprs-card-close`; body lines; `.aprs-card-charts` (2-col sparklines); `.aprs-card-messages` (last 4); `.aprs-card-actions` CENTER / ZOOM / TRACK 24 H) | Station details for APRS and Meshtastic (Meshtastic reuses the same factory with its own `cardModel`) | Factory `layers/aprs/interaction.js:70-437`; CSS `aprs.css:52-190`; Meshtastic wiring `layers/meshtastic/index.js:19-20` | Hover preview follows cursor (`pointermove`, throttled 70ms); click pins, card follows the station on `postRender`; `pointer-events:none` unless pinned; min 220 / max 300px; absolute inside `viewer.container`, z70 | none | **No touch hover preview** (`event.buttons` set during touch = drag path, `interaction.js:342`); pinned card overlaps tap point/dock; `.aprs-card-close` ~22x20px; action buttons 9px text ~18px tall; `title` tooltip on stack counter ("click again for the next") hover-only; ESC closes | Bottom sheet (peek+expand) fed by the same `cardModel`; 44px actions; prev/next buttons for stack; tap map elsewhere or swipe down closes |
| Stacked-station cycling: `clickTarget(ids, pinnedId)` and `.aprs-card-stack` "N of M" | Repeated click at the same spot moves the pin through overlapping stations | `aprs/interaction.js:44-64, 273-284`; Meshtastic label fan-out in `layers/meshtastic/rendering.js` (canvas) | Click again to advance | same | Relies on repeated clicks on a moving pixel target; small counter | Explicit Prev/Next in the sheet header, plus list of stacked stations |
| `.aprs-popups` / `.aprs-popup` (`.aprs-popup-from`, text) | Fading message bubbles beside sender; max 240px; `aria-live=polite`, `role=status`; `pointer-events:none` | `layers/aprs/popups.js:20-119`, `aprs.css:191-253` | Bubbles fan upward when stacked; lifetime `MESSAGE_POPUP_MS`, fade 1.5s | none | 10px text; can fill a phone canvas; reposition per frame | Cap to 2-3, larger text, or convert to a feed strip; keep `pointer-events:none` |
| `.propagation-station-card` (`title`, close, `<table>` rows th/td) | Ionosonde station details | `layers/propagation/stationInteraction.js:44-259`, `propagation.css:64-159` | Hover preview + click pin; 190-260px | none | Same hover/close issues; `:pinned` only shows `×` (`padding:0 4px`, 14px) | Same bottom sheet as APRS |
| `.data-toggle-select` / `-select-input` (dropdowns) and `.data-toggle-text` / `-text-input` (callsign/name filter) inside layer rows | APRS / Meshtastic layer options | Built `ui/layerPanel.js:685-777`; CSS `aprs.css:1-50` | 8-9px text, `order:-2/-1` | none | 9px font; 2px padding (~18px tall); native `<select>` OK | Layer-detail sheet controls at 16px / 44px |
| `.data-servers` MQTT server list: `.data-server` rows with `.data-server-remove` (18x18 "x"), name, `.data-server-status` (dot + text), `.data-server-topic` input (commit on `change`), `.data-server-toggle` (on/off) | Manage Meshtastic MQTT servers | `layerPanel.js:453-535` (delegated handlers `:300-330`); CSS `meshtastic.css:1-140` | 8-10px text | none | **Delete is a bare 18px button next to the switch with no confirm** (`layerPanel.js:306-307` calls `onRemove` immediately); 9px inputs -> zoom; topic edit auto-commits on blur | Row -> swipe/overflow menu with confirm; 44px switch; 16px inputs |
| `details.data-server-add` "+ ADD SERVER" -> `form.data-server-form` (fields NAME, HOST, PORT, TLS, USER, PASS, TOPIC, KEYS; ADD; `.data-server-error`) | Add MQTT server | `layerPanel.js:540-630`; CSS `meshtastic.css:140-220` | 2-column grid, 9px inputs, `<summary>` 8px | none | Password + `type=number` fields tiny; `<summary>` tiny; error text 9px | Full-screen modal form, one column, labelled at 12-14px, `inputmode`, `autocomplete=off` |
| Legend `.data-toggle-legend-item`, ramp `.data-toggle-ramp` (bar/ticks/caption), sliders `.data-toggle-slider` (+input `height:12px`) | HF propagation + Meshtastic legends and range controls | `layerPanel.js:634-680, 778-827`; CSS `propagation.css:1-62` | 8px | none | **12px-high range input** is hard to drag; tick labels absolutely positioned | 44px slider tracks; move legend into a sheet |
| `.data-toggle-chip.chip-break` | Chip group spacer | `propagation.css:56-59` | | | | n/a |
| Vessel / aircraft / CCTV / transit / ALPR / bikeshare cards | Canvas-painted "card" variants via world overlay (`WORLD_OVERLAY_*`), selected via Cesium `LEFT_CLICK` + `hitTestWorldOverlay` (e.g. `layers/vessels/selection.js:60-93`); not DOM (Cesium `infoBox` disabled: `app/viewer.js:118-119`; `foundation.css:285`) | `overlays/worldOverlay.js`, `overlayTokens` fonts 10-13px (`worldOverlayTokens.js:19-25`) | Hit rect = painted rect | none | Canvas card hit targets are ~10-13px tall text; **deselect by Esc or tap empty space** (`vessels/selection.js:144`, `flights/tracking.js:1111`); accessibility twin below | Selection -> bottom sheet with identity + actions; canvas cards remain labels only; enlarge hit slop |
| `#world-overlay-actions` `#world-overlay-action-list` `#world-overlay-status` (`role=region "Visible map targets"`) | Screen-reader/keyboard twin of canvas cards: one hidden `<button>` per painted target | `scene-chrome.html:5-8`, `worldOverlay.js:1252-1272, 2370-2410`, `foundation.css:164` | Visually hidden (1px clip) | same | Not touch-reachable; VoiceOver/TalkBack users can reach it | Keep as-is (a11y); do not remove |

### 2J. Bhote Koshi event (the largest single overlay)

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#bhote-koshi-event-panel` (`aside`) mounted **inside `#right-context-rail`**, which gets `.bhote-event-active` (hides every other rail child, `bhote-koshi.css:246`) | Event reconstruction controls | Built `data/bhoteKoshiEvent.js:814-947`; CSS `bhote-koshi.css:2-31, 246-...` | `position:fixed; top: var(--right-stack-safe-top,26vh); right: var(--right-rail-x); width:min(330px, 100vw-40px); max-height: calc(100vh - top - 88px)`; z142; own scroll (scrollbar hidden) | **<=720** (`bhote-koshi.css:591-600`): `right:12; bottom:88; width:100vw-24; max-height:48vh` | Covers half the screen; nested scroll inside a rail that also scrolls (`responsive.css:196-215`); scrollbar hidden so no cue; bottom 88px magic number for dock; controls inside are 8-9px text | Full-height sheet with snap points; tabs: Compare / Timeline / Reports; keep `[data-role]`/`[data-action]` hooks |
| `.bhote-event-header` kicker, title, `button[data-action=close]` (30x30 "x") | Title + close event layer | `bhoteKoshiEvent.js:819-823` | 17px title | same | 30px close | 44px close in sheet header |
| `.bhote-event-status` chips "OBSERVED IMAGERY" / "SCHEMATIC CORRIDOR" | Provenance | `:825-828` | 9px | same | tiny | keep, wrap |
| `input[data-role=split]` range (aria "Historical reference and post-event image split") + `[data-role=split-readout]` "50 / 50", `before-date`/`after-date` | Before/after imagery split | `:829-838`, CSS `.bhote-event-range` 4px high | `cursor:ew-resize` | same | **4px-high range track** (thumb bigger natively) sharing space with vertical panel scroll | 44px track; separate from scroll region |
| `#bhote-koshi-split-line` (`div` fixed full-height) + `.bhote-koshi-split-handle` (`button role=slider`, 36px, pointer capture, arrow keys/Home/End) | Draggable vertical divider on the map | `bhoteKoshiEvent.js:2559-2624`, `bhote-koshi.css:557-590` | Handle centered, `touch-action:none` | none | Only element in slice with proper `touch-action`; handle 36px (<44); `body`-level fixed line has z8 so it sits under most chrome (may be covered by panels/sheets); relies on `document.documentElement.clientWidth` | Enlarge handle to 44px, keep vertical line; ensure sheets do not hide handle; safe-area |
| `input[data-role=progress]` (0-1000) + `[data-role=time]` + `[data-role=timeline-label]` | Reconstruction clock scrub (`input` previews, `change` commits) | `:840-846` | | | Same slider issues | 44px, sticky above sheet actions |
| Story nav: `button[data-action=previous-beat]`/`next-beat` (34px wide), `[data-role=beat-index/title/meta]` (`aria-live`) | Prev/next story beats | `:846-852` | 34 x 54px | same | 34px wide | Stay; 44px |
| `.bhote-event-actions` (3-col grid, 30px, 8px text): `play`, `play-scene` (hidden until scene), `cinematic` (`aria-pressed`), `story-replay`, `open-source`, `corridor` | Playback/camera actions | `:853-860` | 8px text truncated with ellipsis | same | 3 columns at 8px in 330px; labels truncate | 2-col 44px buttons; cinematic label swap ("RELEASE CAMERA") |
| `details.bhote-event-evidence` "FIELD REPORTS - N" + `.bhote-event-report` buttons | External source links (`window.open` noopener) | `:862-866, 883-892`, `openExternal` `:746` | | | New-tab opens on mobile may leave app | Accordion in sheet |
| `.bhote-event-credit` "GEOLOCATIONS - GEO GEORGE SHADRACH" + `[data-action=geolocation-map]` | Attribution + public map link | `:867-870` | 8px | same | 26px button | Keep attribution visible |
| `.bhote-event-caveat` | Reconstruction caveat | `:871` | 8px | same | Legibility | 11px+ |
| `#bhote-koshi-embedded-media-root` (`aria-live`, in `viewer.container`, z7) + `.bhote-embedded-callout` (leader SVG + `.bhote-embedded-callout-body` player + `footer` title/status/link) | Geo-anchored provider embeds (YouTube / Facebook / X / local clips) | `data/bhoteKoshiEmbeddedMedia.js:575-1097`, CSS `bhote-koshi.css:33-245` | Width `min(356px, 100%-36px)` (YouTube 280, portrait 214); placement avoids `#scene-panel`, `#right-context-rail`, `#command-dock` rects (`:517-566`); animated leader line; player `min(200px,34vh)`; `pointer-events:auto` on body only | none | **No close/dismiss control**; iframe players capture touch (scroll/gesture trapping); fixed px widths; provider iframes need `allow` (autoplay/fullscreen); Pinokio shell disables embeds; autoplay muted | Show embed inside the event sheet (Media tab) or a bottom sheet; `Open original` link retained; no leader lines |
| `.bhote-embedded-media-warmup` | 1px hidden preload | `bhote-koshi.css:39-47` | | | Hidden iframes still cost data on cellular | Do not warm on mobile / metered |
| Global reset at end of `bhote-koshi.css` (`* {margin:0;padding:0;box-sizing:border-box}` and `html, body {overflow:hidden; ...}`, lines 602-613) | Stray global rule living in this file | `bhote-koshi.css:602-613` | | | Body `overflow:hidden` is what prevents page scroll; moving/removing this file changes global behaviour | **Do not drop or reorder this file without relocating the reset** |

### 2K. Other DOM built in `src/` (touch-relevant)

| Element | What it does | Def | Desktop | Small | Touch problems | Mobile |
|---|---|---|---|---|---|---|
| `#space-mission-panel` (`aside.context-space-mission-detail`; header + close x; detail table; payload/stage tables in `.mission-table-scroll`; replay speed range `#space-mission-replay-speed`; FOCUS / REPLAY ASCENT; prev/next; SHOW ALL / DESELECT; replay transport ii / x) | Selected space mission detail, mounted in `#right-context-rail` | `layers/launches/panel.js:425-500` | Rail layout (`layers.css:271+`) | via right rail <=720 rules | Nested horizontal table scroll; 8-11px tables; overlaps context slice | Sheet (coordinate with context-rail auditor) |
| `#space-mission-roster` item hover preview | Hovering a roster row previews the launch (`mouseenter` 105) | `layers/launches/panel.js:98-130, 316` | Hover preview + keyboard focus preview | same | **Hover-only preview**; tap = select | Tap-to-preview then confirm |
| `.mission-replay-vehicle-overlay` (rocket SVG, thrust, orbit dot, callout) in `#cesiumContainer` | Replay animation overlay | `layers/launches/overlays.js:276-315` | | none | Decorative, 5 SVG ellipses animated; callout text | Keep, smaller |
| `#military-awareness-panel` (`aside`, rows + prev/next/focus buttons; page rotation timer) and `#military-awareness-direction-overlay` (compass ring, cardinal labels, 3 direction markers) | Awareness context: nearby contacts list + on-screen direction arrows | `layers/awareness/panel.js:8-250`, `rendering.js:21-72`, CSS `radio.css:321-580` | Panel inside context rail; overlay in viewer container | radio.css rules | Timer `setInterval` (`panel.js:209`) rotating pages; rows are `<button>`s (ok); hidden in cockpit | Context sheet (other auditor) |
| Scene "Scene actions" panel `section[data-director-interactions]` (buttons `[data-director-action]`, `role=status`) | Scene author-defined actions | `scenes/interactions.js:86-160` (all inline styles) | `position:absolute; left:12; bottom:80; max-width:300; max-height:40vh; overflow-y:auto; z31`, 13px | none | Fixed `bottom:80` collides with mobile dock/credit; nested scroll; copy says "Tab and Enter" | Sheet |
| Data-pack attribution cards `div[data-director-packs]` > `section[data-director-pack]` ("id - text - license", "Source" link) | Per-pack credit/licence | `scenes/dataPacks/presentation.js:4-49` (inline) | `right:10; bottom:70; max-height:40vh; z30`, 12px | none | Bottom-right stack collides with voice FAB and dock; **attribution must remain reachable** | Move into scene sheet "Credits" section AND keep a visible credit affordance |
| `.map-stack-chip` row (`mapStackChips.js:95-160`, map source selector) | Chips for map stacks | out of slice (display/map-source) | | `controls.css:744` <=620 3-col grid | | listed for completeness |
| `celestial-ring-overlay` (`celestialRing.js:425-470`), `#scope-mask` (`scopeMask.js:435`), `#cockpit-cloud-effects`, world-overlay canvas, detection surface | Non-interactive canvases | | | | Full-DPR canvases: memory/GPU on phones; `scopeMask` listens to `matchMedia('(resolution: Ndppx)')` (`:297-305`) | Consider lower DPR on mobile; not UI |
| `src/maps/openFreeMapRaster.js:56` | Offscreen container for raster tiles | | | | not user-visible | none |
| `layers/awareness`, `launches`, `firms`, `cctv` canvases | icon/label canvases | | | | not user-visible DOM | none |

---

## 3. Existing `@media` / `matchMedia` branches touching this slice

CSS `@media`:
- `first-run.css:262` `(max-width: 620px)`; `first-run.css:302` `(max-height: 620px)`; `first-run.css:373` `prefers-reduced-motion`.
- `provider-settings.css:355` `(max-width: 620px)` (chip bottom offset).
- `bhote-koshi.css:170` `prefers-reduced-motion`; `bhote-koshi.css:591` `(max-width: 720px)`.
- `aprs.css:248` `prefers-reduced-motion`.
- `foundation.css:378` `(max-width: 575px)` (credit lightbox full-screen); `foundation.css:600` reduced-motion (title logo arcs).
- `responsive.css:2` `(max-width: 720px)` (title bar, top-center-actions, style indicator hidden, FPS readout, location bar, `#gev-voice-control` right/bottom/min-width, `#gev-voice-detail`, all `.hud-*` adjustments, panels/rails); `responsive.css:242` `(max-width: 520px)` (title wordmark + subtitle hidden).
- `command-dock*.css`: `(max-width: 980px)`, `900`, `720`, `620` (credit `bottom`, dock, voice width, `.gev-voice-error-tray` width); `command-dock-sliding.css:663` reduced-motion.
- `controls.css:744` `(max-width: 620px)` (map-stack chip grid).
- `status.css:374` reduced-motion (split-flap).
- `overlays.css`, `voice-cost.css`, `meshtastic.css`, `propagation.css`: **no media queries at all**.

JS gates (all viewport-width, none pointer-based):
- `matchMedia('(max-width: 720px)')` in `ui/rightPanelRail.js:55`, `ui/leftPanelRail.js:52`; `(max-width: 760px)` in `ui/cockpitLayout.js:79,100`.
- `prefers-reduced-motion`: `splitFlap.js:254`, `logoGaze.js:64`, `cameraVerbs.js:148`, `cockpitCloudEffects.js:217`, `data/bhoteKoshiEmbeddedMedia.js:622`, `ui/radioControls.js:98,145`.
- `matchMedia('(resolution: Ndppx)')` in `scopeMask.js:297`.
- `pointerType`: `logoGaze.js:149` (skips touch), `ui/panelDisclosure.js:194-204` (hover disclosure only for mouse/pen).
- `window.innerWidth/innerHeight` reads: `data/bhoteKoshiEvent.js:2595`, `ui/panelPositionControls.js`, `ui/applicationShell.js:1430`.

## 4. Persisted keys (this slice)

| Key | Storage | Owner |
|---|---|---|
| `gev:first-run-mission:v1` | localStorage (durable suppression, only the checkbox writes) | `firstRunExperience.js:24` |
| `gev:first-run-mission-session:v1` | sessionStorage (any close) | `firstRunExperience.js:26` |
| `godsEyeView.voiceCost.tier`, `godsEyeView.voiceCost.limits` | localStorage | `voice/realtimePreferences.js:11-13` |
| `gev-realtime-errors` | localStorage (rolling 30-entry error log) | `voice/realtimeDiagnostics.js:3` |
| URL hash share params (`#...`, plus `SHARE_CREATED_AT_PARAM`); `?welcome=0/1`; `?setup=1` | URL | `sharelink.js`, `firstRunExperience.js`, `keySetup.js:370` |
| Scene project (director) | localStorage | `scenes/director.js:63` |
| `gev:layer-state:v2` (layer enables written by first-run at origin `user`) | localStorage | `data/layerState.js` (referenced in `firstRunExperience.js:50`) |
| Panel position/collapse keys (versioned) | localStorage | `ui/panelPositionControls.js` (not mine; note drag-position keys are meaningless for a mobile layout) |
| Cockpit weather flag, detection allocation | localStorage | `cockpitCloudEffects.js:245`, `ui/visualSettings.js:204` (not mine) |
| Bhote Koshi / draw / APRS / Meshtastic / propagation card state | not persisted | n/a (Meshtastic server list is server-side) |

## 5. Ids and hooks JS looks up (must survive or be re-pointed)

- First run/settings: `first-run-launcher`, `[data-first-run-choice]`, `[data-first-run-suppress]`, `[data-first-run-status]`, `[data-first-run-environmental-title]`, `.first-run-choices`; `key-setup-chip`, `key-setup`, `[data-key-setup-rows|apply|close|status|chip-label]`, `input[data-env-var]`, `[data-key-setup-remove]`.
- Chrome: `title-bar` (frame-rate monitor appends into it), `intel-hud` + the `hud-*` ids listed in 2D, `loading-screen` + `.loader-status`, `toast`, `global-loading-status`/`-label`/`-detail`, `traffic-sync-chip`/`-label`/`-progress`, `safe-frame-overlay`/`-box`, `orbit-indicator` (created, not in template), `cesium-credits` (created in `app/scene.js:46`), `#cesium-credits .cesium-credit-expand-link`, `.cesium-credit-lightbox`, `.cesium-credit-lightbox-close`.
- Voice: `gev-voice-control`, `gev-voice-button`, `gev-voice-status`, `gev-voice-detail`, `gev-voice-tier`, `gev-voice-cost-value`, `gev-voice-error-detail`, `.gev-mic-label`, `.gev-voice-help-detail`, `.gev-voice-visualizer span`, `.gev-voice-error-dismiss`, and insertion targets `command-dock`, `location-bar`, `control-panel` (`voice/control.js:45-54`). Space-key logic checks `#cesiumContainer` / `world-overlay-canvas` canvases (`realtimeInputPolicy.js:51-58`).
- Location: `location-search`, `search-toggle`, `location-pills`, `poi-row`, `location-bar-divider`, `location-mini-city`, `location-mini-poi`, plus hotkeys Q/W/E/R/T (`locationControls.js`) and global hotkeys H, O, V, F, D, C, style keys, Esc (`applicationShortcuts.js:30-40`).
- Draw: `draw-toggle`, `draw-mode-row`, `draw-label-row`, `draw-label-input`, `draw-color-select`, `draw-clear`, `draw-hint`, `.pp-mode-btn[data-shape]`; body class `gev-drawing`.
- Sharing: `share-btn`, `scene-panel` (`.scene-panel-inner`), `director-sharing-dialog`.
- Cards: `.aprs-card*` classes only (built in JS), `.aprs-popups`, `.propagation-station-card*`; layer-row hooks `.data-server*`, `.data-toggle-*` (used by `layerPanel.js` delegated handlers and `body:has(.data-toggle-row[data-layer-id='alpr-cameras'] ...)` in `foundation.css`).
- Bhote: `bhote-koshi-event-panel`, `[data-action]`, `[data-role]`, `bhote-koshi-split-line`, `.bhote-koshi-split-handle`, `bhote-koshi-embedded-media-root`, `right-context-rail.bhote-event-active`; overlay occluder selector list.
- Body-state classes that hide/alter these surfaces: `ui-clean-view`, `recording-mode`, `cockpit-mode`, `scene-playback-mode` (first-run/key-setup hide via CSS; credit stays).

## 6. Tests that pin source text / CSS in this slice (will fail on a rewrite unless updated deliberately)

| Test | Pins |
|---|---|
| `src/creditAttribution.test.mjs` | Models `style.css` cascade: `#cesium-credits` base rule (font-size 10px, `white-space:nowrap`, no height/padding), dock `bottom` at 720/800, minimal-HUD variant equals ordinary, credit never `display:none/visibility:hidden/opacity:0`, clean-view/recording `bottom:36px`, tray and rail clearance at every width (measured `CREDIT_HEIGHT_PX=28`, `COMPACT_DOCK_HEIGHT_PX=62`, `MIN_CLEARANCE_PX=8`, `WIDTHS`); also asserts `rightPanelRail.js` keys off `(max-width: 720px)` (`:486-487`) |
| `src/creditKeyboard.test.mjs` | `configureCreditKeyboardAccess` roles/tabindex/aria/Enter/Space/Esc behaviour |
| `src/firstRunExperience.test.mjs` | Markup order and count of `data-first-run-choice` (4: contacts, space-missions, environmental, explore); verbatim description line; environmental subcopy mentions earthquakes and fires; checkbox/aria markup; `role=status` note; CSS: `pointer-events` base/visible, `display:flex`, `max-height: calc(100dvh`, `[hidden]{display:none}`, `.first-run-choices{min-height:0; overflow-y:auto}`, scroll-fade gated on `data-scrollable`, own `prefers-reduced-motion` block naming `#first-run-launcher` and `.first-run-choices`, hide rules for `ui-clean-view`/`recording-mode` and equality with `EXCLUSIVE_SURFACE_CLASSES`; lightbox z200 vs launcher z175; source shape of `isTopmost`/`coveredByOverlay`; `docs/CURRENT-STATE.md` text |
| `src/hudA11y.test.mjs` | `first-run-suppress` label+checkbox markup regex; HUD control input names |
| `src/loadingFeedback.test.mjs` | `#global-loading-status` markup (`role=status aria-live=polite aria-atomic=true hidden`), CSS for complete/cancelled/error states, `#traffic-sync-progress:empty{display:none}`, `shareRestoration.js` handler source text (acquiring notice, `transitionend`, 1000ms fallback) |
| `src/cockpitMarkup.test.mjs` | `<=520px` `#title-bar h1 > span:last-child, #title-bar .subtitle {display:none}`; `<=720px` `#style-indicator{display:none}` and `#top-center-actions` right/left/transform; `#top-center-actions` desktop centering; ids `clear-selected-layers`, `reset-globe-view`; scene-playback hides |
| `src/radioMarkup.test.mjs` | `#title-bar.radio-broadcasting .title-logo::before/::after` |
| `src/keyboardFocusStyles.test.mjs` | Focus ring rules for `.poi-pill`, `.search-toggle-btn`, `#location-search` |
| `src/overlays/worldOverlay.test.mjs` | `WORLD_OVERLAY_OCCLUDER_SELECTORS` contents and stacking model incl. `#title-bar`, `#traffic-sync-chip` |
| `src/materialSymbolsSubset.test.mjs` | Every Material Symbols glyph named in templates/JS is in `index.html` `icon_names` (welcome tile icons: `radar`, `rocket_launch`, `local_fire_department`, `public`, `arrow_forward`, `bolt`, `close`, `draw`, ...) |
| `src/reasonableDefaults.test.mjs` | Scope feather/fade slider defaults in markup (display panel) |
| `src/tooling/applicationHtml.test.mjs` | Template expansion (`gev:template`), ids unique, `first-run-launcher` present; `index.html` keeps `<!-- gev:template welcome/provider-settings/hud-loading -->` order |
| `src/annotations/drawTool.test.mjs`, `drawToolBehaviour.test.mjs`, `screenAnnotationRenderer.test.mjs`, `drawMode.test.mjs` | Draw session logic, hint text, ids in display-controls markup |
| `src/layers/aprs/*.test.mjs`, `layers/meshtastic/*.test.mjs`, `layers/propagation/*.test.mjs` | Card model, `placeCard`, `clickTarget`, popups, controls schema (not CSS) |
| `src/data/bhoteKoshiEvent.test.mjs`, `bhoteKoshiEmbeddedMedia.test.mjs`, `bhoteKoshiLocator.test.mjs` | Panel markup (`[data-action]`, `[data-role]`), split handle, placement; heavy DOM-shape assertions (78/14/57 source-text hits) |
| `src/ui/shellLifecycle.test.mjs`, `shellLifetime.test.mjs` | Presence of `global-loading-status`, `toast`, etc. in the shell fixture |
| `src/panelStackLayout.test.mjs`, `rightRailPolicy.test.mjs`, `panelEscape.test.mjs` | Rail/panel policy tied to `style.css` and `(max-width: 720px)` (neighbouring slices but constrain overlays that live in the rail: Bhote panel, space mission, awareness) |
| `src/voice/*.test.mjs` | Voice logic; no CSS text pins (control markup only via `session.test.mjs` fixtures) |

`style.css` is a pure `@import` list (`style.css:1-23`); order is significant (`bhote-koshi.css` before `responsive.css` before `command-dock*.css`; `voice-cost`, `first-run`, `provider-settings` last). Several tests (`readStylesheet`) flatten it, so a new `mobile.css` must be added to this list and rule order for credit/dock must remain modelable.

---

## 7. Recommended mobile treatment (summary by destination)

**Stay on screen (compact, always):** logo mark; `#cesium-credits` (required); one slim status strip (merge global-loading + traffic/cctv chips; `#toast` re-anchored above bottom bar); FAB mic; orbit indicator when active; safe-frame only in recording.

**Menu sections (new):** Share (Web Share + copy), Draw (opens draw toolbar), Readouts/HUD (toggle + variant), Developer (FPS, safe frame), Provider keys (dev only), Welcome/launcher replay, About/credits shortcut (lightbox stays Cesium-owned).

**Bottom sheets:** entity/station selection card (APRS, Meshtastic, propagation, vessels/aircraft), stacked-station chooser with Prev/Next, voice details (status, tier, cost, errors), location search + presets, Bhote Koshi event (tabs; media inside), scene actions and pack credits, layer options for Meshtastic/APRS/propagation (16px controls, 44px sliders).

**Full-screen modals:** first-run launcher (with Skip/X), provider keys, add-MQTT-server form, scene import/export dialog (convert inline styles to CSS, use `dvh`).

**Drop on touch:** ESC/Space/Backspace/Enter hint copy, hotkey badges (Q W E R T), scanline, hover previews, HUD edge strips, style indicator, floating POWER UP chip, leader lines on media callouts, `.data-server-remove` bare button (replace with confirm menu).

**Technical prerequisites to decide early:**
1. Add `viewport-fit=cover` and use `env(safe-area-inset-*)`; consider `interactive-widget` for keyboards.
2. Introduce a shared mobile breakpoint/`(pointer: coarse)` query and stop relying on ad-hoc 520/575/620/720/760/900/980 widths (this slice alone uses 520, 575, 620, 720, 900, 980).
3. Provide one CSS var for "bottom chrome height" so toast, credit, first-run, FAB and scene panels stop hard-coding `5.8rem`, `88px`, `100px`, `80px`, `70px`, `calc(2vh + 5rem)`; keep the credit clearance model provable for `creditAttribution.test.mjs`.
4. Replace all keyboard-only affordances with buttons before removing hint copy: draw finish/undo/cancel/pin, orbit, FPS, flight/vessel deselect, first-run dismiss, PTT.
5. Touch pick fidelity: hover-only APRS/Meshtastic/propagation/roster previews need a tap-to-select path (already exists via `click`) plus a larger hit slop; verify canvas `click` fires after a Cesium tap.
6. Secure-context requirements: mic (`getUserMedia`), clipboard, share; LAN-http dev testing on phones will fail voice and copy.
7. Keep the `WORLD_OVERLAY_OCCLUDER_SELECTORS` list in step with any new chrome (sheets, FAB), otherwise canvas cards paint under or over them.
