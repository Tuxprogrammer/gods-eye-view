# Mobile rewrite - Audit D: cross-cutting infrastructure (read-only)

Scope: Cesium viewer, input handling, build/template/CSS assembly, viewport/CSS
hygiene, a single "mobile mode" mechanism, test/lint impact, and reusable QA
scripts. No source was edited. Paths are relative to the repo root; line
numbers are from the working tree at commit 5d6b944.

## 1. Cesium viewer construction

### 1.1 Viewer options (`src/app/viewer.js:105-137`)
`createApplicationViewer({ container, creditContainer })` is the only Viewer constructor.

| Option | Value | Line |
|---|---|---|
| timeline / animation | `false` / `false` | 109-110 |
| baseLayerPicker, geocoder, homeButton, sceneModePicker, fullscreenButton, vrButton | all `false` | 111-116 |
| navigationHelpButton | `false` (so no touch/mouse help popup exists) | 115 |
| selectionIndicator / infoBox | `false` / `false` (app draws its own cards) | 118-119 |
| baseLayer | `false` (maps stack supplies layers) | 120 |
| creditContainer | caller-owned `#cesium-credits` div | 121 |
| msaaSamples | `4` (fixed; heavy on phone tile GPUs, WebGL2 only) | 122 |
| contextOptions.webgl.preserveDrawingBuffer | `true` (needed for screenshots; costs on mobile) | 123 |
| targetFrameRate | `60` (after construction) | 126 |
| globe.show | `false` (photoreal 3D tiles replace it); skyAtmosphere tuned | 127-131 |

- Not set anywhere in `src/`: `resolutionScale`, `useBrowserRecommendedResolution`,
  `scene.fxaa`, `maximumScreenSpaceError` on the main tileset. Cesium defaults
  therefore apply: `useBrowserRecommendedResolution = true` renders at CSS-pixel
  resolution (ignores devicePixelRatio), so phones already render at 1x. Adding a
  mobile `viewer.resolutionScale` or lower `msaaSamples` is a new knob, not a change.
- Grep confirms the only `maximumScreenSpaceError` write is
  `src/layers/propagation/tilesetQuality.js:64` (heatmap only). Google tileset
  cache is `cacheBytes: 1536 MiB` + `maximumCacheOverflowBytes: 1024 MiB`
  (`src/maps/google3d.js:76-79`) - unsuitable for phones; the ion path is the
  only place these are set, so a mobile override must be passed in there.
- Idle render governor: `src/renderGovernor.js:46-47` flips
  `scene.requestRenderMode`; installed at `src/app/tools.js:58-61`. Good for
  battery; hidden-tab suspension follows at `src/app/tools.js:~80`.
- Own DPR-aware canvases (independent of the Cesium canvas):
  `src/overlays/worldOverlay.js:1313`, `src/celestialRing.js:588`,
  `src/scopeMask.js:280-305` (also watches `(resolution: Ndppx)`),
  `src/layers/flights/rendering.js:1095`, `src/layers/military/rendering.js:1001`.
  Cockpit cloud pass is capped at 0.42 scale (`src/cockpitCloudEffects.js:167-179`,
  resize at 331-340).

### 1.2 Touch gestures
- No `screenSpaceCameraController.*EventTypes` are overridden except one:
  `installTrackpadPinchZoom` (`src/app/viewer.js:18-102`) appends
  `{eventType: WHEEL, modifier: CTRL}` to `zoomEventTypes` and relays Ctrl+wheel
  (trackpad pinch) from the container. It does nothing for touch.
- Therefore touch uses Cesium defaults: 1-finger drag = rotate/pan, pinch = zoom,
  2-finger drag = tilt. Desktop right-drag zoom / middle-drag tilt / Ctrl+left tilt
  are Cesium defaults and have no dedicated touch equivalents beyond the above.
- `screenSpaceCameraController.enableInputs` is toggled false by: cctvGizmo
  (`src/data/cctvGizmo.js:537,619`), localGeojsonCore drag
  (`src/data/localGeojsonCore.js:809-822`), cockpit tracking
  (`src/ui/cockpitTrackingController.js:165,235`), cctv lifecycle restore
  (`src/layers/cctv/lifecycle.js:448-449`). `src/data/trackedCamera.js:71-89`
  changes `inertiaZoom` and `minimumZoomDistance`.
- Manual-input reflex (touch works): `pointerdown` + `wheel` on the canvas cancel
  flights/animations: `src/cameraVerbs.js:1238`, `src/ui/cameraOrientationControls.js:360`,
  `src/scenes/director.js:129-132`, `src/ui/shareRestoration.js:118-125,296-300`,
  `src/data/bhoteKoshiEvent.js:45`.
- Feature pickers use `ScreenSpaceEventType.LEFT_CLICK` only (tap works):
  alpr `presentation.js:445`, bikeshare `selection.js:186`, directions `index.js:1229`,
  firms `selection.js:66`, installations `selection.js:43`, launches `lifecycle.js:43`,
  radio `interaction.js:137`, satellites `interaction.js:84`, submarineCables
  `interaction.js:21`, transit `selection.js:189`, vessels `selection.js:93`,
  scenes `interactions.js:162`, localGeojsonCore `:827`. Flights/military use
  `src/data/trackingClickGesture.js:38-96` (LEFT_DOWN/MOUSE_MOVE/LEFT_UP drag
  accounting - works with a touch because Cesium synthesizes these).

### 1.3 Credit container (required attribution - never hide)
- Created in `src/app/scene.js:46-49`: `<div id="cesium-credits">` appended to
  `document.body`, removed on teardown; passed as `creditContainer` (line 52).
  `registerDataCredits` at line 55-56; keyboard semantics via
  `configureCreditKeyboardAccess(document)` (`src/creditKeyboard.js:5-73`, called
  `src/app/scene.js:56`).
- Base style `src/ui/styles/foundation.css:294-311`: `position: fixed; bottom: 36px;
  left: 36px; z-index: 90; max-width: 90vw; white-space: nowrap; pointer-events: auto;
  font-size: 10px`. Override blocks: `command-dock.css:218-240,277`;
  `command-dock-compact.css:379`; `command-dock-trays.css:446-450,480-484`;
  ALPR-layer wrap variant `foundation.css:~320-345` (`body:has(...alpr-cameras...)`).
  Clean-view / recording keep it visible (`command-dock.css:239-240`).
- Lightbox: `.cesium-credit-lightbox-overlay` z-index 200 (`foundation.css:346`),
  `.cesium-credit-lightbox` 470px wide, `max-height: min(70dvh, 36rem)` (350-357),
  full-screen `<= 575px` (`foundation.css:378-387`). 10px text and a tiny tap
  target for `.cesium-credit-expand-link` (`foundation.css:313-322`) are a touch problem.
- Cesium re-applies inline styles to credit children each frame (comment
  `foundation.css:~389-397`); do not fight it with CSS.
- Hidden Cesium chrome (belt and braces): `foundation.css:279-289` `display:none !important`
  for toolbar/animation/timeline/bottom/fullscreen/vr/geocoder/selectionIndicator/infoBox containers.

## 2. Input handling inventory

### 2.1 Central keyboard files
- `src/ui/applicationShortcuts.js:1-48` (bubbling, ignores select/input/textarea/search):
  keys `1`-`7` = styles normal/retro/surveillance/thermal/anime/noir/snow (l.1-9);
  `Escape` = dismissSearch (l.30); `h` HUD, `o` orbit, `v` clean view, `f` layers,
  `d` cycle detection, `c` CCTV (l.31-37). All keyboard-only. Touch equivalents:
  style buttons `.style-btn` (command-dock.html), HUD/orbit/clean-view/layers/CCTV
  buttons exist in the DOM, but `cycleDetection` (d) needs verification by the
  panel audits.
- `src/ui/surfaceKeyboard.js:19-90`: capture-phase `Escape` and `Tab` focus trap.
  Escape has no touch equivalent unless the surface shows a visible close button.
- `src/ui/visualInput.js:1-2`: just re-exports `bindApplicationShortcuts` and
  `createStyleParameters` (nothing input-specific).
- `src/creditKeyboard.js:1-74`: Enter/Space activation for the credit expand link
  and lightbox close, Escape closes lightbox. Click already works on touch; this only adds keyboard.
- `src/ui/cockpitInput.js:1-70`: `Escape` exits cockpit / collapses Context or Signal
  panel (l.6-52); `c` toggles cockpit (l.57). Touch equivalents: `#cockpit-entry`
  and its exit control (verify).

### 2.2 Keyboard-only features with no touch equivalent (verify per panel)
| Feature | Where |
|---|---|
| Location POI hotkeys Q/W/E/R/T while a city is expanded | `src/ui/locationControls.js:2,45-56` (pills are clickable) |
| Push-to-talk Space (hold >= 500ms) plus keyup release | `src/voice/realtimeInputPolicy.js:1,15-16,100-106`; `src/voice/realtimeInput.js:149,394`; mic pill click toggles voice, guarded by `shouldIgnoreVoiceButtonClick` (l.113) |
| Backquote FPS monitor | `src/ui/frameRateMonitor.js:48-77` (dev diagnostic, no touch UI) |
| Escape releases tracked flight/military/satellite/bikeshare/transit/vessel; unpins APRS/propagation cards; cancels directions | flights `tracking.js:1111`, military `tracking.js:1027`, satellites `interaction.js:13`, bikeshare `selection.js:197`, transit `selection.js:112`, vessels `selection.js:145`, aprs `interaction.js:376`, propagation `stationInteraction.js:216`, directions `index.js:1191`. Touch relies on tapping empty globe or the card's own close button - audit each. |
| Draw tool: Enter finish, Escape cancel, Backspace undo vertex, double-click finish | `src/annotations/drawTool.js:296-310,360,375,432-433`; cctv calibration Enter/Escape `src/ui/cctvCalibration.js:141-146` |
| Scene playback Escape = stop | `src/ui/sceneControls.js:217-218` (scene stop button exists) |
| Shift+arrow fine step on Bhote Koshi split slider; arrow keys | `src/data/bhoteKoshiEvent.js:2586,2628` (drag handle has pointer events at 2582-2585, touch-action:none at `bhote-koshi.css:579`) |
| Dock disclosure Enter/Escape, Tab trap | `src/ui/panelDisclosure.js:38,269-296` |
| Context tab arrow-key navigation | `src/ui/contextBindings.js:9` |
| Radio tuner keyboard (arrows) and keyup | `src/ui/radioBindings.js:446,469,721,772` (pointer drag exists at 614-691, `touch-action:none` `radio.css:200`) |
| Scene shot title dblclick rename / Enter | `src/ui/scenePresentation.js:66,82` (dblclick is hard on touch) |
| Cockpit Space-holds and shortcut keyups | `src/ui/cockpitController.js:293` |

### 2.3 Hover-only, right/middle-click, drag-modifier features
- Dock tray hover-open (mouse/pen only; touch already excluded):
  `src/ui/panelDisclosure.js:193-206` (`pointerType` filter at 194-195, 203-204;
  `:hover` guard at l.167). Touch opens via click on the disclosure (`click` l.226-262).
  CSS hover reveals: `command-dock-sliding.css:456,528,650`,
  `command-dock-trays.css:53-60`. Voice help tray `.gev-voice-help-tray` opens only on
  `:hover` (`command-dock-sliding.css:650`) - **no touch path**.
- CCTV hover card (Item B): `src/layers/cctv/hover.js:8-61`, wired to `MOUSE_MOVE`
  at `src/layers/cctv/lifecycle.js:318-324` - **touch gets no hover card**; must be tap.
- APRS and propagation station cards: hover via `pointermove/pointerleave`
  (`src/layers/aprs/interaction.js:333-396`, `src/layers/propagation/stationInteraction.js:179-223`);
  click pins them, so tap works but hover preview does not.
- Launches list `mouseenter`/`mouseleave` preview: `src/layers/launches/panel.js:104-105`
  (focus/blur exist as parallel path; `launches/lifecycle.js:54` MOUSE_MOVE hover).
- Logo gaze follows pointer (`src/logoGaze.js:149,170-178`, already ignores touch).
- `title=` tooltips (hover only): 69 across templates (cockpit 15, command-dock 12,
  context 10, display-controls 16, layer-panels 11, scene-chrome 5). Notably every
  `.style-btn` carries its explanation only in `title` (`command-dock.html:16-26`).
- Draggable panels: `src/ui/panelPositionControls.js:216-283` uses pointerdown/move/up
  with `event.button !== 0` (l.221). Handle `.panel-drag-handle` has `cursor: grab`
  (`controls.css:75-82`) but **no `touch-action`** (only `bhote-koshi.css:579` and
  `radio.css:200` set it), so a touch drag would scroll/pan instead.
- Right-click/middle-click: no `contextmenu`, `auxclick`, or `event.button === 1|2`
  handlers exist in `src/`. Only Cesium defaults (right-drag zoom, middle-drag tilt,
  Ctrl+left-drag tilt); `viewer.js:44-45` adds Ctrl+wheel. No other drag modifiers
  (only `shiftKey` for slider step and shortcut vetoes).
- `wheel` listeners: `panelDisclosure.js:176` (cancels hover open), `radioBindings.js:801`
  (tuner scroll - no touch analogue except pointer drag), camera-cancel listeners in 1.2.
- Programmatic JS breakpoints (must stay in sync with CSS): `(max-width: 720px)` in
  `src/ui/leftPanelRail.js:52`, `src/ui/rightPanelRail.js:55`; `(max-width: 760px)` in
  `src/ui/cockpitLayout.js:79,100`. No `pointer: coarse`, `hover: none`, `isTouch`, or
  `visualViewport` code exists anywhere (`window.innerWidth` is used in
  `cockpitCloudEffects.js:334`, `bhoteKoshiEvent.js:2594-2595`, `cockpitLayout.js:87`).
- Reduced-motion matchMedia users: `cameraVerbs.js:148`, `bhoteKoshiEmbeddedMedia.js:622`,
  `splitFlap.js:254`, `logoGaze.js:64`, `radioControls.js:98,145`, `cockpitCloudEffects.js:217`.

## 3. Build, templates, CSS, dev server, startup

### 3.1 HTML assembly
- `index.html` (repo root; 39 lines): viewport meta `width=device-width, initial-scale=1.0`
  only (l.5). `<link rel="stylesheet" href="/style.css">` (l.8). Fonts via Google
  (l.9-16; Material Symbols is an icon-name **subset** list at l.16 - adding a new
  glyph requires adding it to `icon_names`, enforced by
  `src/materialSymbolsSubset.test.mjs`). Nine `<!-- gev:template NAME -->` markers
  (l.19-35), then `<script type="module" src="/src/main.js">` (l.37).
- `build/application-html.js:3-13` freezes `APPLICATION_TEMPLATES`
  (scene-chrome, cockpit, display-controls, command-dock, layer-panels, context,
  welcome, provider-settings, hud-loading). `expandApplicationHtml` (l.17-29)
  regex-replaces `^[ \t]*<!-- gev:template NAME -->\r?\n?` with
  `src/ui/templates/NAME.html`; unknown names throw. Plugin runs at
  `transformIndexHtml order:'pre'` (l.32-40).
- **To add a mobile template**: (1) create `src/ui/templates/<name>.html`;
  (2) add `<name>` to `APPLICATION_TEMPLATES`; (3) add a marker line to `index.html`;
  (4) ids must be unique across all templates (`src/tooling/applicationHtml.test.mjs:9-13`
  asserts marker count === `APPLICATION_TEMPLATES.length` and unique ids).
  `build/application-html.js` belongs to package boundary `vite-build`
  (`scripts/package-boundaries.json`), modules already listed so editing is fine.
- `build/vite.js:5-46`: `createBrowserViteConfig` = plugins `[cesium(), applicationHtmlPlugin(), ...]`,
  server host default `localhost`, port `parseInt(port) || 4173`, `allowedHosts`
  (`localhost`, `127.0.0.1`, `.local`; `true` only when host is `0.0.0.0`/`::`),
  CSP header only `frame-ancestors 'none'` (so an inline `<script>` in `index.html` is allowed),
  `X-Frame-Options: DENY`, `define` for `GOOGLE_MAPS_API_KEY`/`CESIUM_ION_TOKEN`,
  `optimizeDeps.exclude: ['maplibre-gl']`, chunk warning 1500.
- `vite.config.js` re-exports `server/standalone/vite.config.js` (loads `.env` via
  `loadEnv`, reads `HOST`/`PORT`, attaches local provider middleware and maplibre-worker plugin).
  Dev: `npm run dev` = `vite`, port 4173. For real-device testing set `HOST=0.0.0.0`
  in `.env` (currently `.env` has no HOST/PORT keys; only APRS/CARTO/GitHub values) -
  this is also the only case that opens `allowedHosts`; a phone on LAN otherwise
  gets Vite's host-block unless the hostname ends in `.local`.

### 3.2 CSS assembly
- `style.css` (repo root) is an ordered list of `@import './src/ui/styles/X.css';`:
  foundation, controls, location, status, cockpit, overlays, layers, radio, propagation,
  aprs, meshtastic, cctv, scenes, bhote-koshi, recording, responsive, command-dock,
  command-dock-compact, command-dock-trays, command-dock-sliding, voice-cost, first-run,
  provider-settings (23 files, ~12.5k lines total). Loaded by the `<link>` in index.html.
- `src/ui/styles.js` (`import '../../style.css'`) is **not imported by any file**
  (grep found no importer) - dead entry; do not rely on it.
- Existing responsive stacks: `responsive.css` (`@media (max-width:720px)` l.2,
  `(max-width:520px)` l.241), plus 620/720/760/900/980/575 blocks in
  controls/command-dock*/cockpit/first-run/provider-settings/foundation/bhote-koshi.
  Full media list: aprs/bhote/cockpit/status/layers/first-run/command-dock-sliding
  `prefers-reduced-motion`; max-width 520/575/620/720/760/900/980 and one
  `max-height: 620px` (`first-run.css:302`). No `pointer`, `hover`, `orientation`,
  `display-mode` queries.
- Stray duplicate: `bhote-koshi.css:605-615` redefines `html, body { overflow:hidden ... }` and a `*` reset.
- **To add mobile CSS**: create `src/ui/styles/mobile-*.css` and append
  `@import './src/ui/styles/mobile-*.css';` at the END of `style.css` (after
  `provider-settings.css`) so it overrides desktop rules by order; keep
  selectors prefixed with the mobile scope (Section 5). `readStylesheet` only
  understands `@import '...';` / `@import "...";` with a relative path and no
  `url()`, `layer()`, or media suffix; circular imports throw
  (`src/testSupport/readStylesheet.mjs`).

### 3.3 Test-support readers
- `src/testSupport/readShellSource.mjs:16-38`: concatenates a **fixed list** of 11
  `src/ui/*.js` files (locationNavigation, cockpitCoordinator, navigationController,
  shareRestoration, visualSettings, panelChrome, aircraftDisplay, layerBindings,
  displayBindings, shellFacade, applicationShell). `shellMethod(name)` resolves
  methods by owner class. **New mobile modules are invisible to it** unless added
  to both lists; existing tests grep this string, so do not move code out of those files.
- `src/testSupport/readStylesheet.mjs:1-18` resolves `style.css` recursively.
  Users (11 test files): creditAttribution, keyboardFocusStyles, cockpitMarkup,
  loadingFeedback, panelStackLayout, rightRailPolicy, radioMarkup, reasonableDefaults,
  firstRunExperience, mapStackChips, plus scripts `qa-map-source-tray.mjs`, `qa-firstrun-mutations.mjs`.

### 3.4 Startup camera and loading screen
- `src/main.js:1-18` creates the standalone app; on failure writes the error into
  `#loading-screen .loader-status` (red).
- Lifecycle `src/app/application.js` START_ORDER `scene, controls, data, tools`
  (l.~27). Scene stage (`src/app/scene.js:26-96`) updates
  `loaderStatus.textContent` with "Configuring viewer...", "Loading Google 3D Tiles..."
  / "Loading the keyless globe...", "Initializing systems...". Controls stage
  (`src/app/controls.js:40-48`): no share state -> `flyToAustin(viewer)`
  (`src/camera.js:64-97`): `setView` 20 km overhead pitch -90, then after **500 ms**
  a 4 s `flyTo` to Huntsville (34.7075,-86.6528, alt 355 m, heading 330, pitch -22,
  roll 360deg [sic]); otherwise "Restoring shared view..." (share link).
  On a portrait phone the same heading/pitch/altitude framing is unchanged; a
  mobile rewrite might want a higher altitude, and `camera.js:57-58` constants are
  the one-line diff. `camera.js:7-32` also has austin/sf/nyc presets.
- `src/app/startupChrome.js:4-54` `startApplicationChrome`: waits for
  `styleManager.initialRestorePromise` AND a 1000 ms minimum delay
  (l.400), adds `.hidden` to `#loading-screen` (l.413; CSS transition
  opacity/visibility 0.8 s `controls.css:267-283`), then reveals first-run welcome on
  `transitionend` or a 900 ms fallback (l.414-417); also starts provider settings
  (`initKeySetup` via `src/standalone/startupChrome.js`). Loading markup:
  `src/ui/templates/hud-loading.html` (`#intel-hud`, `#loading-screen` with
  `.loader-logo`, `h2`, `.loader-status`). `src/loadingFeedback.js` (484 lines) owns
  progress feedback; `src/loadingFeedback.test.mjs:201` reads index.html.
- `#loading-screen` is `position: fixed; inset: 0; z-index: 1000`. `.loader-logo`
  128 px (`controls.css:~288`).

## 4. Viewport, safe-area, vh/dvh, overscroll, touch-action

- Viewport meta (`index.html:5`): `width=device-width, initial-scale=1.0` - **no
  `viewport-fit=cover`, no `maximum-scale`/`user-scalable`, no `interactive-widget`**.
  Without `viewport-fit=cover` `env(safe-area-inset-*)` evaluate to 0 in landscape/notch.
- `env(safe-area-inset-*)` used in only 3 places: `cockpit.css:895` (bottom),
  `cockpit.css:2023` (bottom), `responsive.css:32` (top of `#top-center-actions`).
  Nowhere else (dock, credits, panels, loader, lightbox).
- `html, body { width/height: 100%; overflow: hidden }` (`foundation.css:94-103`);
  `#cesiumContainer` absolute 100%x100% (`foundation.css:106-111`). Scrolling is
  disabled at document level: panels scroll themselves.
- 156 lines use `vh`/`dvh`/`vw`/`svh`. `100vh` (dynamic-toolbar-unsafe on iOS Safari/Chrome Android):
  `foundation.css:184` (`#cockpit-cloud-effects` height 100vh plus `100vw`),
  `bhote-koshi.css:9`, `cctv.css:11,36`, `cockpit.css:2064`, `first-run.css:14`
  (with `100dvh` fallback l.15), `layers.css:70`, `provider-settings.css:66` (with
  `100dvh` l.67), `scenes.css:11,137`. `dvh` is used at `foundation.css:357,383`,
  `first-run.css:15`, `provider-settings.css:67`. `svh`/`lvh`: none.
- `overscroll-behavior: contain`: `foundation.css:366`, `layers.css:85,257`,
  `first-run.css:111`, `provider-settings.css:188`. None on body (pull-to-refresh
  / rubber-band are not suppressed on the map).
- `touch-action`: only `bhote-koshi.css:579` and `radio.css:200` (both `none`).
  **The Cesium canvas and `.panel-drag-handle` have none**; Cesium sets its own
  `touch-action` on its widget canvas, but the app's overlay hosts
  (`#world-overlay-root`, `pointer-events:none`) are fine. `-webkit-tap-highlight-color`,
  `-webkit-touch-callout`, `text-size-adjust`: not set anywhere.
- `user-select: none`: `controls.css:77`, `foundation.css:256,517,651`, `overlays.css:79`;
  `user-select: text` `foundation.css:507`.
- `:hover` rules: 76 across styles (layers 15, cockpit 12, controls 9, radio 7,
  command-dock-sliding 7, provider-settings 5, ...). On touch, `:hover` sticks
  after tap; mobile CSS should wrap desktop hover styles or override.
- Small type/targets: many 8-10 px mono labels (`controls.css:60-70`,
  `foundation.css:302`); only 13 explicit min-height/min-width in the 10-29 px range.

## 5. Recommended ONE shared "mobile mode" mechanism

Goal: one decision, made once, before first paint, readable identically by CSS
and JS, testable without a real phone, and impossible to affect desktop.

**Decision** (single source of truth: a tiny pure module plus one inline bootstrap):

1. New file `src/ui/mobileMode.js` (browser, in `src/ui/` so it is classified
   "renderer", no imports, prettier-formatted):
   ```
   export const MOBILE_QUERY =
     '(pointer: coarse) and (hover: none) and (max-width: 900px)';
   export function resolveMobileMode({ win = window } = {}) { /* override > query */ }
   export function installMobileMode(doc, win) /* sets html[data-ui], subscribes to change, returns disposer */
   ```
   - Rationale for the query: `(pointer: coarse) and (hover: none)` identifies
     touch-primary devices only, so a narrow desktop browser window (which is
     already served by the existing `max-width: 720px` rules) stays desktop;
     `max-width: 900px` limits it to phones and small tablets in portrait
     (landscape phones are usually 700-930 px wide; use `max-width: 932px` or
     `(max-height: 500px)` alternative if landscape phones must be included -
     decide with the panel audits).
   - Override for QA/dev and desktop-Chrome emulation: `?ui=mobile|desktop` and
     `localStorage['godsEyeView.ui']` beat the media query (puppeteer without
     `isMobile/hasTouch` emulation would never match `pointer: coarse`).
2. Inline bootstrap in `index.html` `<head>` (before the stylesheet link, ~10 lines,
   no import so it runs before module load and avoids a flash of desktop layout):
   evaluates the same override then `matchMedia(MOBILE_QUERY)` and sets
   `document.documentElement.dataset.ui = 'mobile' | 'desktop'`. A test asserts
   the string in `index.html` equals `MOBILE_QUERY` (so JS and inline copy cannot drift).
   CSP allows inline script (`build/vite.js` sends only `frame-ancestors`).
3. `installMobileMode` (called once from `src/app/scene.js` or a new early stage)
   re-evaluates on `change` of the media query, updates `data-ui`, and dispatches
   `gev:ui-mode` on `window` for JS owners. JS code asks `document.documentElement.dataset.ui === 'mobile'`
   or imports `isMobileUi()`; never call `matchMedia` with ad-hoc widths.
4. **CSS uses only the attribute**: every mobile rule is scoped
   `html[data-ui='mobile'] ...` inside `src/ui/styles/mobile-*.css`, appended at the
   end of `style.css`. No media queries are needed (so nothing depends on pointer
   query support inside CSS and desktop CSS cannot regress). Exception: pure width
   tweaks that should also apply to narrow desktop windows stay in existing files.
5. Do NOT retrofit the existing `(max-width: 720px|760px)` JS gates
   (`leftPanelRail.js:52`, `rightPanelRail.js:55`, `cockpitLayout.js:79,100`) - tests
   pin their literal strings (see Section 6). Mobile code reads `data-ui`; the
   old gates keep serving narrow desktop windows.
6. Cesium tuning is injected, not imported: `src/app/viewer.js` is package-boundary
   group `viewer` (modules: only itself; external `cesium`), so it cannot import
   `mobileMode.js`. Add optional params to `createApplicationViewer({..., mobile})`
   and pass them from `src/app/scene.js` (allowed to import ui). Candidate values:
   `msaaSamples: 0|2`, `viewer.resolutionScale`, `targetFrameRate`, a lower
   `maximumScreenSpaceError`, and smaller tile cache bytes.

Interaction with the credit pin: rules that position `#cesium-credits`,
`#command-dock`, `#right-context-rail`, `.dock-popover-content` are modelled by
`src/creditAttribution.test.mjs` (Section 6.1). Using `html[data-ui='mobile'] #cesium-credits`
will fail closed unless the test's `RECOGNIZED` set and `parseMediaCondition` are
extended and the new clearance geometry is measured. Plan that test change as
part of the rewrite; do not silently move the credit.

## 6. Tests and gates affected

### 6.1 `src/creditAttribution.test.mjs` (highest risk)
- Reads `style.css` via `readStylesheet` (l.7) and flattens rules with
  a media stack (`flattenRules` l.126). Any rule whose **final compound** contains
  `#cesium-credits`, `#command-dock`, `#right-context-rail`, or `.dock-popover-content`
  (l.192-232 `ELEMENT_KEYS`) and sets a guarded property (bottom/top/inset*/margin*/height/
  min-height/max-height/position/transform/translate/scale/zoom/all) must have
  a selector in the `RECOGNIZED` whitelist (l.196-216) or the test fails
  ("unrecognized selector positions a modelled element"). Media conditions
  must parse as exactly `(max-width: Npx)` (l.255-262); nested media is rejected
  (l.399); `!important` on guarded props rejected (l.412); shorthands `inset`/`margin`
  rejected (l.413-417); `height`/`max-height` rejected except rail (l.418-425);
  vertical `transform`, `translate`, `scale`, `zoom` rejected (l.426-431).
- Measured constants `CREDIT_HEIGHT_PX=28`, `COMPACT_DOCK_HEIGHT_PX=62` (l.28-34)
  come from qa-shots; the tray clearance pins run for widths `<= 900` (l.502) and
  the rail for `<= 720` (l.542). l.486 pins the literal
  `windowRef.matchMedia('(max-width: 720px)')` in the left rail source. l.589-595:
  no `#cesium-credits { ... }` block may contain `display:none`, `visibility:hidden`,
  `opacity:0`, and the clean-view rule text `body.ui-clean-view #cesium-credits,\n body.recording-mode #cesium-credits { bottom: 36px; }` must exist verbatim.
- Uses `readShellSource` (l.6/9) so the shell files still need to contain the strings it looks for.

### 6.2 Other readStylesheet / readShellSource / index.html-based tests
- `src/cockpitMarkup.test.mjs:31,73,245-250,297-304,698-710` regex-matches exact
  `@media (max-width: 720px|520px|760px)` blocks in `style.css` and
  `body.cockpit-mode #view-switcher` (bottom `max(76px, env(safe-area-inset-bottom))`,
  max-width `calc(100vw - 20px)`). Do not edit or reorder those existing blocks;
  additive `html[data-ui='mobile']` rules are safe.
- `src/keyboardFocusStyles.test.mjs` pins the global `:where(button, ...)` focus ring
  with `outline: 2px solid var(--text-primary) !important;` - mobile CSS must not
  remove the ring for keyboard focus.
- `src/rightRailPolicy.test.mjs:38` pins `const isMobile = windowRef.matchMedia('(max-width: 720px)').matches`.
- `src/ui/panelRails.test.mjs:103` mocks `matchMedia: () => ({matches: mobile})` -
  any query returns the same boolean.
- HTML-based (via `expandApplicationHtml(index.html)`): contextTabKeyboard, detectionPolicy,
  firstRunExperience (l.554,594), hudA11y, loadingFeedback (l.201), mapSourceFocus,
  mapStackChips (l.490), worldOverlay (l.467), panelStackLayout (l.267,280), radioMarkup,
  reasonableDefaults (l.49), applicationHtml. They look up existing ids/classes;
  do not rename or remove existing ids in desktop templates. Any new template
  must keep ids globally unique (`applicationHtml.test.mjs:12`).
- `src/materialSymbolsSubset.test.mjs` fails if a source uses a Material Symbols
  glyph absent from `index.html:16` `icon_names` (new mobile icons -> extend list).
- `src/tooling/panelStorageDocs.test.mjs:15-40` pins panel storage key versions in
  `src/ui/panelPositionControls.js` and docs; adding mobile panel storage keys
  should be documented without changing those constants.
- `src/browserModuleBoundary.test.mjs:9-50`: no `node:*` imports in any `src/**/*.js`.

### 6.3 Import direction / boundaries (`npm run check:boundaries`)
- `scripts/check-import-directions.mjs`: classifies `src/ui|app|standalone|overlays` and
  `src/layers/*/(index|rendering|...)` as "renderer" (l.20-24). New `src/ui/mobile*.js`
  files are renderers: they may import `src/ui` peers and `cesium`, but must never be
  imported by `source`, portable/feed-state entries, or `server/`; `src/*` may not import
  `src/main.js` or `src/standalone/*` ("Reusable module imports standalone setup",
  l.~108); no `node:` builtins in browser graph; no absolute or URL imports; no
  symlinks.
- `scripts/check-package-boundaries.mjs` + `scripts/package-boundaries.json`: each
  package export (`./application`, `./application/viewer`, ...) is built with an
  allow-list of modules. `viewer` group = `["src/app/viewer.js"]`, `application`
  group = `["src/app/application.js"]` with `external: []`, both with **no** other
  local imports allowed (`src/tooling/packageBoundaries.test.mjs:53-59`: even an
  unused import of application code fails). Consequence: `viewer.js` and
  `application.js` may not import a mobile helper; inject configuration from
  `scene.js` (see 5.6) or add the helper to the group's `modules` (and to
  `package.json` `exports` if it becomes a public entry).

### 6.4 Format gates (`npm run format:check`)
- `scripts/format-runtime.json` = `{"roots": ["src","server"]}`: every non-test
  `.js/.mjs/.cjs` file under `src/` or `server/` that is not in `.prettierignore` is
  auto-checked (`scripts/format.mjs:9-46`). **New `src/ui/mobile*.js` are formatted
  automatically and must pass Prettier** (`.prettierrc.json`: singleQuote, tabWidth 2,
  semi, `endOfLine: lf`). `.prettierignore` excludes `dist`, `qa-shots`, `.env*`,
  `*.min.js`, etc.
- `scripts/format-scope.json` is an explicit adoption list (~270+ entries) for
  everything else, including `.test.mjs`, `docs/*.md`, and `.css`
  (`style.css` and 9 of the ui styles: overlays, command-dock-trays, location,
  recording, status, layers, controls, cctv, foundation; l.258-267). **New test files
  are only checked if listed** (so add them to be consistent); new CSS is optional but
  files that are not listed are not Prettier-checked. If you want a new mobile CSS
  file/test formatted, add it explicitly. Note the scope entries for existing UI JS
  (e.g. `src/ui/applicationShortcuts.js`, `surfaceKeyboard.js`, `visualInput.js`).
- `scripts/module-analysis.mjs` is used by `check-import-directions.mjs` to parse
  imports and browser-global reads; portable modules cannot touch `window`/`document`.

### 6.5 Test runner
`npm test` -> `scripts/run-unit-tests.mjs` discovers every `src/**/*.test.mjs`, so new
tests are picked up automatically (see MEMORY: full run is 2+ min on Windows).

## 7. Existing QA scripts (puppeteer, not Playwright)

All 57 `scripts/qa-*.mjs` use `puppeteer` (devDependency `^25.10.0`); none use Playwright.
Common pattern: `process.env.QA_BASE_URL || 'http://localhost:4173'`, launch args
`--no-sandbox` plus SwiftShader (`--use-gl=angle --use-angle=swiftshader`; Metal on macOS),
collect `pageerror`, `check(name, ok, detail)` with exit code. The dev server must
already be running (`npm run dev`); scripts never start it. Only `qa-map-source-tray.mjs`
uses `page.touchscreen.tap` (l.1190-1193); no script sets `isMobile`/`hasTouch`.
Screenshots: `qa-shots/` (gitignored by `.prettierignore`); `scripts/shot-sink.mjs` (:4399) collects canvas grabs.

Panel-touching scripts and their existing narrow viewports (best reuse candidates):

| Script | Panels covered | Viewports already used |
|---|---|---|
| `qa-map-source-tray.mjs` (`npm run qa:map-source-tray`) | dock map tray, coarse-pointer tap, credit clearance | 1000x900, 620x900 |
| `qa-radio.mjs` | radio tuner, context dock | 1440x900, 560x760 |
| `qa-attribution-b12.mjs` | credit + dock at narrow width | 1440x900, 560x760 |
| `qa-cockpit-utility.mjs`, `qa-cockpit-plates.mjs` | cockpit utility controls, plates | 1440x900 |
| `qa-scene-controls.mjs` | scenes panel | 1440x900, **390x844** |
| `qa-camera-controls.mjs` | camera orientation controls (compass/tilt) | 1440x900, **390x844** |
| `qa-director-sharing.mjs` | director/share panel | 1440x900, **390x844** |
| `qa-firstrun.mjs`, `qa-firstrun-mutations.mjs` | welcome dialog, readStylesheet-based | 1440x900, 375 wide |
| `qa-location-controls.mjs`, `qa-map-source-controls.mjs`, `qa-visual-input.mjs`, `qa-visual-effects.mjs` | location, map source, style/effect buttons | 1440x900, 620x900 |
| `qa-layer-panel.mjs`, `qa-ui-disposal.mjs`, `qa-application.mjs` | layer panel, listener disposal, app lifecycle | default |
| `qa-draw-tool.mjs` | DISPLAY > Draw | 1280x860, 560 wide |
| `qa-voice-routing.mjs`, `qa-voice-wav.mjs` | voice control / push-to-talk | 1500x950, 1440x900 |
| `qa-transit*.mjs` (`qa:transit`), `qa-directions.mjs`, `qa-cctv-v2.mjs`, `qa-radio.mjs` | layer panels/cards | 1280-1920 wide |
| `qa-failstate-b10.mjs`, `qa-l9-matrix.mjs`, `qa-perf.mjs` | failure states, matrix, FPS | 1280x800 / 1440x900 |

Recommendation for verification: parametrize a shared helper (or copy the
`qa-scene-controls.mjs` / `qa-camera-controls.mjs` 390x844 pattern) with
`page.emulate`/`setViewport({ width: 390, height: 844, deviceScaleFactor: 3,
isMobile: true, hasTouch: true })` plus the `?ui=mobile` override, then reuse
`qa-map-source-tray`, `qa-attribution-b12`, `qa-radio`, `qa-firstrun`,
`qa-location-controls`, `qa-scene-controls`, `qa-camera-controls`, `qa-draw-tool`
as regression checks. Remote-device testing needs `HOST=0.0.0.0` in `.env`.

## 8. Risks and open questions for the rewrite

1. Credit line must remain visible, tappable (currently 10 px) and not clipped by
   safe-area or the bottom sheet; requires updating `creditAttribution.test.mjs` with
   a measured mobile constant (Section 6.1).
2. `viewport-fit=cover` and `env(safe-area-inset-*)` are absent almost everywhere;
   adding `viewport-fit=cover` to `index.html:5` also affects desktop meta (harmless,
   but pinned by no test).
3. `100vh` usages (Section 4) will overflow behind mobile browser chrome; use `dvh`
   only inside `html[data-ui='mobile']` rules to leave desktop unchanged.
4. Hover-only surfaces without a touch path: voice help tray, CCTV hover card,
   launches/APRS/propagation hover previews, all `title` tooltips.
5. Keyboard-only actions (Section 2.2) - add visible buttons or gestures in mobile
   chrome for: cycle detection (d), cockpit exit (Esc), release tracking (Esc), draw
   Enter/Backspace/Escape, scene stop, PTT (hold on mic pill).
6. Panels' drag handles lack `touch-action`; if mobile keeps them draggable set
   `touch-action: none` on `.panel-drag-handle` only under `data-ui='mobile'` (or
   disable drag on mobile).
7. Battery/GPU: consider mobile Cesium params via injected options (5.6), and
   `preserveDrawingBuffer` (`viewer.js:123`) only when recording/screenshots are needed.
