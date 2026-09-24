# The scene host: the diorama behind the menu — design

Date: 2026-09-24. Status: **draft, for the project lead's approval.** Package: the scene-host
bullet of shell Phase 3 (WP-S3e, GH-178, render half). Parent spec:
`docs/superpowers/specs/2026-09-16-shell-upgrade-design.md` (Decision 1, §5, §6 Phase 3, §7,
§10, D-1…D-51). Plan: `docs/superpowers/plans/2026-09-24-scene-host.md`.

## 1. What this is

§6 Phase 3's first bullet: *"a held diorama — a lit map slice with a few idle units — rendered
behind the menu column on the mission pipeline, slow parallax on mouse, the campaign screen's
no-WebGL2 fallback pattern reused (a static plate when the host cannot draw)."* The app-half
plan held it out (its R-1) because only one lane may edit `ThreeRenderer.ts` at a time and
WP-A1.3 held that file. A1.3 landed on 24 Sep (v0.78.0).

This spec settles where the host lives, what it draws, when it loads and unloads, how it
falls back, how it moves, how it is measured and what it must satisfy. Every number below is
either measured (with its conditions) or labelled a **proposal**.

In one paragraph: the host is **the mission renderer, unmodified, pointed at a real map**. The
app builds a small static `Sim` for `beit_sahwan_outskirts` with four KDF units standing in it,
hands it and the mission's own `RendererOptions` to a new door,
`@lions/render/three-front`, which drives a stock `ThreeRenderer` at 30 fps behind the menu
column. A photograph of that same frame is the poster shown while it loads and the plate kept
whenever it cannot draw. Parallax slides the picture a few pixels against the column; it never
moves the camera. Leaving the menu destroys the context outright. `ThreeRenderer.ts` gains one
additive read and nothing else.

## 2. What was measured

All figures come from a throwaway probe page (never committed) that builds exactly the diorama
proposed in §3.2 through the real `ThreeRenderer`, inside a **production build** (`vite build`
of this worktree at `2d92cbad` + `vite preview` on :5196), driven by Playwright 1.62.1 /
headless Chromium 151.0.7922.34 on an **Apple M3 Pro (12 cores, 36 GiB), macOS 26.6.2**, viewport
1920×1080 at device scale 1, quality `high`, HTTP cache disabled through CDP unless stated.
**The machine was shared with other sessions throughout**; the 1-minute load average is
printed beside each figure and ran from 13 to 185 — treat every millisecond as this machine
on that day, and the ratios as the portable part. The scripts and raw logs are in the
session scratchpad (`ep/scenehost/meas/`); the report lists them.

| # | Quantity | Result | Conditions |
|---|---|---|---|
| M1 | GLB bytes for the slice | **6.49 MiB** on the wire (buildings 2.88: apartment 772 KiB, hall 730, house 728, clinic 710, shanty 6; decor 0.04; units 3.56: `mbt_lavi` 2.37 MiB, `inf_squad` 1.01, `apc_eitan` 0.18) | CDP `loadingFinished`, identical in every cold run; also summed from `assets/meshes/` |
| M2 | Ground textures | **2.90 MiB**, 5 files (the renderer skips the rock slot on this map) | same |
| M3 | JS the host needs | three core chunk 614,403 B (158,120 gz) + `ThreeRenderer` chunk 295,957 B (109,575 gz) — **the same two chunks a three mission loads**; Draco decoder 0.24 MiB | `vite build` output of this worktree |
| M4 | Menu usable (nav in the DOM) | **45–78 ms** after navigation, 5 runs | cold, Metal, load 26–28 |
| M5 | Time to first diorama frame, cold | **1.05–1.43 s** from module start (5 runs); first `frame()` alone 0.87–1.11 s | Metal, load 16–19 |
| M6 | …warm cache | **1.08–1.31 s** (4 runs, 0 bytes fetched) | Metal, load 13–20 |
| M7 | …20 Mbit/s, 20 ms RTT | **4.18–4.46 s**; ground textures land **4.43–4.62 s**, i.e. *after* the first frame | Metal, cold, CDP throttle, load 16–18 |
| M8 | …CI's rasteriser | **1.33–1.73 s** (3 runs) | SwiftShader, cold, load 21–30 |
| M9 | What the first frame costs | 442–542 ms full; 421–431 without ground textures; 172–232 without meshes; 165–167 with neither; `compileAsync` first does not remove it (first frame still 469–581 ms). **It is dominated by the meshes (geometry and the textured buildings' bakes), not by shader compile**, and it is one synchronous main-thread stall | Metal, 3 runs each, load 33–34 |
| M10 | Steady frame, GPU-synchronous (`frame()` + `gl.finish`) | **15.2–18.4 ms mean, p95 33.6–34.3** at `high`; 6.5–7.2 ms mean at `low` | Metal, 80 frames, load 24–59 |
| M11 | What a frame cap buys | uncapped (asked for 60) reached only **20.8–21.8 fps** at `high` (GPU-bound under load); cap 30 held **28.8–30.3 fps** at 5.9–6.0 ms `frame()` CPU; cap 20 held 20.0–20.3 | Metal, 4 s loops |
| M12 | CI's steady frame | **~920 ms mean** per frame; a capped loop drew under one frame in 4 s | SwiftShader, 1400×900, load 39–43 |
| M13 | Does an idle second context slow the mission? | mission-like renderer (same map, 10 units): **15.0–17.9 ms** mean with the host's context alive and not drawing, **15.3–16.6 ms** after disposing it (with or without the explicit loss) — inside run-to-run noise at this load | Metal, 3 runs × 2 variants, load 50–96 |
| M14 | Does an idle second context cost memory? | GPU process `phys_footprint`: blank page **11 MB**; host drawing **563–840 MB**; after `ThreeRenderer.dispose()` **437–450 MB**; after `WEBGL_lose_context.loseContext()` **41–43 MB** (3 runs) | Metal, macOS `footprint`, load 131–185 |
| M15 | Does `dispose()` release the context? | **No.** `isContextLost()` is `false` after `ThreeRenderer.dispose()` in 3 of 3 runs, `true` after an explicit `loseContext()`; the explicit loss logs nothing to the console on Metal or SwiftShader | three r170's `WebGLRenderer.dispose()` does not call `forceContextLoss()` |
| M16 | Colour register (§8's metric) | host frame **Y 0.2382 / S 0.3000**; mission (sandbox, same map, same camera and zoom, fog revealed, HUD hidden) **Y 0.2423 / S 0.2985** — **ΔY −1.7%, ΔS +0.5%**. Host at `low` quality Y 0.2375; host on SwiftShader Y 0.2385; host without units Y 0.2428 | Metal, 1920×1080 |
| M17 | …what the metric actually sees | the SAME pipeline at a different framing (zoom 1.0) reads **ΔY +17.1%, ΔS −11.6%**; a different camera (the sandbox force, zoom 1.0) with fog of war on reads **ΔY −30.6%** — fog's own share was not isolated; the shipped `menu_plate.jpg` **ΔY +30.1%, ΔS −9.9%** | same frames |
| M18 | Plate file size, this framing | 2560×1440 JPEG q80 **429 KiB** (q86 542, WebP q80 226); 1920×1080 q80 260 KiB | PIL, progressive, optimised |
| M19 | The frame stays on the map | camera (28,22) at the zoom law keeps only **0.17 tiles** between the frame's corner and the map edge at 16:9; **(27,22) keeps ≥ 1.17 tiles** at 1280×800, 1366×768, 1920×1080, 2560×1440, 3440×1440, 1600×1200 and 2560×1600 | `screenToWorldFlat` (`project.ts`), bleed included |

Three things the table settles that were open. **Two live contexts cost memory, not frame
time** (M13, M14): ~0.4 GB each on this machine, held until something releases them.
**`ThreeRenderer.dispose()` does not release the context** (M15): it frees 114–403 MB of
what the frame used and leaves ~440 MB held — its own comments say `renderer.dispose()`
"forces context loss", which three r170 does not do. And **the colour
register metric measures framing and fog far more than pipeline** (M16, M17): the same
renderer at two zooms differs by 17%, so the acceptance can only be run camera-for-camera.

Not measured, and labelled so wherever used: parallax cost (argued in §3.5), anything on a
discrete GPU or on Windows, a real player's network, and how any of this *feels* in motion —
the parent spec's §7(b) motion capture is still owed before Phase 3's acceptance.

## 3. Decisions

### 3.1 Where it lives — a thin door over a stock `ThreeRenderer`

**Decided:** `packages/render/src/three/front/` is a new door, `@lions/render/three-front`,
named in eslint's bundle rule beside the other five. It does not render anything itself: it
constructs a stock `ThreeRenderer` against a `Sim` the app built, loads the slice's meshes
through that renderer's own public loaders, turns off two debug layers (`overlays`, `fog`),
frames the camera and runs a capped frame loop. **`ThreeRenderer.ts` gains exactly one
additive method, `groundTexturesSettled(): Promise<void>`** (§3.3), and no menu mode.

Why not a separate small renderer sharing `lighting.ts`, the materials and the GLB loaders:
"the same ground" is not three modules, it is the whole of `ThreeRenderer`'s composition — the
ground mesh and its six albedo slots, scatter, the grove shader, decor placement, the textured
building templates, the skirt, the fog pass's off-map fade (D-1), GTAO, SMAA, `OutputPass`'s
ACES and the vignette. Reassembling that list is a second pipeline, which is the "second art
track" Decision 1 rejected, and M16/M17 show what the register check can and cannot see: a
copied pipeline that drifted in one pass would move the mean by less than the framing does.

Why not a menu mode threaded through `ThreeRenderer`: it is 435 KB, shared by both lanes, and
every later change to it would have to reason about a presentation mode it does not otherwise
have. Everything the host needs is already public: the loaders, `init`, `frame`, `camera`,
`setDebugLayerVisible`, `canvas`, `dispose`.

Why a door at all rather than the app driving `ThreeRenderer` the way `main.ts` does: the glue
touches backend-only things — the canvas's `WEBGL_lose_context`, the debug layers, a frame loop
keyed to render cost — and `packages/app` holds renderers by the `Renderer` interface
everywhere except one branch of `bootBattlefield`. The door returns a four-member view and keeps
it that way. It imports `ThreeRenderer` statically, so Rollup shares the three core and
`ThreeRenderer` chunks with `@lions/render/three` (M3): **the host downloads no JavaScript a
three mission would not, and warms that cache for it.**

### 3.2 What it draws

**Decided (numbers in §10 for approval):**

- **Map `beit_sahwan_outskirts`**, drawn whole through the normal terrain and decor code and
  framed by the camera — never a cropped copy of its rows, which would be a second map that
  drifts. It is the map of the campaign's first mission (`beit_sahwan_1_recon`), whose
  roster includes all three unit types below, so **every byte the host fetches (M1, M2) is a
  byte that mission needs** and the service worker already caches per version. It is also the
  Phase 0 key art's map, so the look the player has already seen continues.
- **Four units, all KDF, side 0:** `mbt_lavi`, `apc_eitan` and two `inf_squad`, standing as a
  small muster on open ground north-west of the town, facing 144°. Two vehicle meshes and one
  rigged mesh file: 3.56 MiB of the 6.49. No hostile: a menu is not a fight, and a hostile
  under a fog-revealed camera would draw its occlusion silhouette.
- **Idle clips:** none new. The static `Sim` is **never ticked**, so every unit is a
  stationary living unit and the renderer plays the `idle` state each GLB already ships;
  presentation clocks (`frame(alpha, dtMs)`) drive the mixers, the vehicles' ambient exhaust
  and the grove's wind sway. No tick means no RNG draw, no event and no determinism surface.
  The units are spawned **before** the renderer is constructed, so `init()`'s own double
  `snapshot()` seeds them — the D-44 "drawn at (0, 0) until tick 3" shape, which
  `Renderer.reseed()` is being added to fix, cannot arise here.
- **Camera:** the mission's own fixed dimetric camera (`camera.ts`, `VIEW_DIRECTION`) — **yaw
  0**, because the sun (`lighting.ts`) is keyed to that azimuth ("135 is the camera's LEFT")
  and billboards are drawn for it. Target **(27, 22)**, zoom by a cover law over the host's
  own layer: `zoom = 1.6 × max(layerW / 1920, layerH / 1080)`. The law makes every aspect show
  the same world width or height as the 1920×1080 reference and crop the rest, exactly what
  `object-fit: cover` does to the plate — so poster and live frame agree at any size. (27, 22)
  rather than the (28, 22) photographed during measurement because M19 found 0.17 tiles of
  margin at the latter; a pinned test keeps ≥ 1 tile at seven viewports.
- **Composition around the column.** `.rl-menu` is centred and 92% opaque (`--panel-bg`), so
  the middle third of the frame is under it. The framing puts the muster in the upper-left
  flank and an apartment block in each flank, with the hall and houses under the column. The
  column's position is a layout question this spec does not decide (Q2).
- **Same lighting, same materials, same ground** by construction: the host's `RendererOptions`
  come from the same function the mission's do (`rendererOptionsFor`, extracted from
  `bootBattlefield` in the plan's Task 2), including the player's quality preset and team
  colour variant. What differs from a mission is only what a menu has no use for: overlays off,
  fog revealed (`uRevealAll`, which keeps D-1's off-map fade running), no HUD.
- **The diorama is data.** `data/front/menu_diorama.json` against a new
  `diorama.schema.json`: map id, camera target, reference zoom, placements in the mission
  schema's own `{unit, at, facing_deg}` shape, and the plate's path. Re-staging the menu is a
  JSON edit, which is CLAUDE.md's content rule.

### 3.3 Lifecycle

**Decided:**

1. **The menu paints first, with the plate already behind it.** After `showMenu` has appended
   its column it mounts a `.rl-scene-host` element under it, decides the path (§3.4 — the
   narrow test reads the column's box, so it runs after the column is laid out) and, on every
   path but `off`, shows the plate `<img>` as a poster (the image is a photograph of the live
   frame, §3.6). The menu's nav is in the DOM 45–78 ms after navigation (M4); the live path's
   work starts after that, at the first idle callback (500 ms timeout).
2. **No context while bytes are on the network.** The door first `fetch()`es every GLB and the
   Draco decoder into the HTTP cache under the host's `AbortSignal`, and constructs the
   `ThreeRenderer` only when they are all in. At 20 Mbit/s that phase is ~3 s of M7's 4.2–4.5,
   and a player who leaves during it leaves nothing to release. Whatever it fetched is still a
   warm cache for the mission they left to.
3. **Reveal on a complete frame.** Construct, load (from cache), `setDecor`, `setElevation`,
   `init`, layers off, camera framed, one synchronous `frame()`, then
   **`await renderer.groundTexturesSettled()`**, then a second `frame()`, then resolve. The
   new method exists because M7 shows the textures land after the first frame on a slow link:
   revealing on the first frame would show flat palette ground and pop the sand in a moment
   later. It resolves when every ground-texture load `init()` started has been applied or has
   failed (a failure is already fail-soft there), and never rejects. The app then crossfades
   the canvas over the poster (400 ms) and removes the poster.
4. **The first frame stalls the main thread once, and that is accepted for now.** M9: one
   0.44–1.45 s synchronous `frame()` (range over all runs at loads 13–34), dominated by the
   meshes.
   A click during it waits. Starting after the menu's entrance puts it where a player is
   reading; spreading the upload over idle frames would need a second `ThreeRenderer` change
   and is Q4.
5. **30 fps, and hold when the machine cannot afford it.** The loop draws when
   `now − lastDraw ≥ 1000/30 − 1`. After the first draw, the door watches three draw intervals;
   if their median exceeds 2.5 × the period (83 ms) it **holds**: it stops the loop and keeps
   the last frame. M10–M12 put the two populations far apart — Metal at cap 30 draws every
   33 ms, SwiftShader takes ~920 ms. Held, the host still redraws once on a resize (the
   canvas clears when `fitToHost` resizes it) and parallax keeps working (§3.5). This is also
   what keeps CI's `ui:routes` and `ui:shots` from clicking through a menu that repaints at
   one frame a second.
6. **Disposed with the menu, and the context destroyed.** The host is part of the menu
   screen's disposer. The router unmounts the old screen synchronously before mounting the next
   (`Router.mountLocation`), so the host is gone before a mission's or the campaign board's
   renderer is constructed — **two contexts never coexist by construction**. `dispose` aborts
   the signal, stops the loop, calls `ThreeRenderer.dispose()`, then
   **`canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()`**, then
   removes the canvas. M14/M15 are why the explicit loss is not optional: without it the
   context keeps ~440 MB of GPU memory until garbage collection finds it. An abort that
   arrives while a load is in flight disposes at once rather than at the next await, and every
   later rejection is swallowed silently (`ui:routes` fails on any console error).
7. **The menu route only.** Settings, saves, credits and the free-play picker are also column
   screens, but each is its own screen with its own disposer, and a host that outlived them
   would have to live outside the stage the router clears — the body-mounted-chrome problem
   D-10 and `ui:routes` exist for. Returning to the menu re-mounts: the poster shows at once
   from cache and the live frame follows in ~1.1–1.3 s warm (M6). Whether those screens should
   sit on the plate is Q3.
8. **A deadline for the reveal: 15 s** from the host's mount. Past it the plate stays, the load
   is aborted and the host says so. M5–M8 put the reveal at 1.0–1.9 s locally and 4.2–4.6 s at
   20 Mbit/s; 15 s is ~3× the throttled figure and ~9× CI's local rasteriser, so the gate's
   check (§3.6) does not flake on a slow runner, while a 5 Mbit/s player (~16 s for 10 MiB)
   keeps the plate.

### 3.4 Fallbacks

One pure decision, `hostPath`, evaluated at mount in this order. Every non-live path writes
its reason to the DOM (§3.6); every `plate` path also warns once by name in the console, and
`off` does not — on a phone it is the expected state, not a failure:

| Condition | Path | Reason | Why |
|---|---|---|---|
| column covers more than 70% of the viewport width | `off` | `narrow` | on a phone the flanks are a few pixels: fetching a plate, let alone a scene, for them is waste |
| `?renderer=pixi` (query or the persisted choice) | `plate` | `pixi` | the campaign board's argument applies unchanged: `?renderer=pixi` is the hatch a player reaches for when three has failed them, and it persists per origin, so loading three behind it for the menu would ignore them. The plate costs no second backend and keeps the composed menu composed; "nothing" would put back the empty page Phase 3 exists to remove |
| `prefers-reduced-motion: reduce`, or `settings.accessibility.motion === 'reduce'` | `plate` | `reduced-motion` | the plate IS the held frame (§3.6 photographs it from the host), so a live held frame would spend a three download, ~10 MiB and a ~0.5 GB context to show the same still. No parallax either |
| `navigator.connection.saveData` | `plate` | `save-data` | the live host is ~10 MiB on the wire |
| no WebGL2 (a throwaway-canvas probe, run only if every row above passed, before the dynamic import — the board's pattern) | `plate` | `no-webgl2` | a browser that cannot draw it must not download 268 KB gz of three |
| the door rejects (GLB fetch or parse, `init`, anything) | `plate` | `load-failed` | nothing on the menu is worth an error screen |
| the deadline passes first | `plate` | `deadline` | §3.3 (8) |
| otherwise | `live` | — | |

The WebGL2 probe runs last so that a Pixi, reduced-motion or save-data player never creates
even a throwaway context — a test pins that the probe is not called on those paths.

### 3.5 Parallax

**Decided:** the picture moves, the camera does not. The host's layer (poster and canvas
together) is oversized by `--host-bleed` on every side and translated by
`translate3d(calc(var(--host-dx) * var(--host-bleed)), calc(var(--host-dy) * var(--host-bleed)), 0)`,
where `--host-dx/dy` are unitless in [−1, 1] and move **against** the pointer (the scene is
seen through the column like a window).

- **Why not the camera.** The camera is orthographic: panning it translates every projected
  point by the same screen offset, so a camera pan and a picture translation are the same
  image at the frame's edges, and the pan costs a full render (M10: 15–18 ms of GPU) per mouse
  move. The translation is a compositor transform — no WebGL work, independent of the frame
  cap, and it works identically on the plate and on a held frame. Depth parallax would need a
  yaw or a perspective camera, and either breaks §3.2's lighting and billboard argument.
- **Amplitude** `--host-bleed: 0.75rem` — 12 px at `--ui-scale` 1, 13.8 px at 1920, 16.8 px at
  2560. A rem, so it follows the one UI scale (§5 of the parent spec) and no px enters UI CSS.
- **Easing:** exponential approach, time constant 700 ms (`easeToward`), `dt` clamped to
  100 ms like every other clock here; the easing loop runs only while the offset is unsettled
  (> 0.001) and uses the bare global `requestAnimationFrame`, so
  `FREEZE_FRAME_LOOP_STATEMENTS` freezes it with everything else.
- **Who gets it:** mouse only (`pointerType === 'mouse'`). Touch and pen never move it, the
  keyboard never needs it, and nothing is lost: parallax carries no information, so there is
  no affordance to be denied (Phase 4's "no hover-only affordance"). The host is
  `aria-hidden="true"` and `pointer-events: none`; it can never take a click or a Tab stop.
  Pointer leaving the window eases back to centre. Reduced motion never mounts it.

Amplitude and time constant are **proposals judged on motion, not on stills** — the parent
spec's motion capture (§7(b)) is where they are confirmed.

### 3.6 Instrumentation

**The DOM says what the host did.** `.rl-scene-host` carries:

- `data-host`: `pending` → `live` | `plate`; or `off`. `pending` is a fourth, transient value
  beside the brief's three: without it `plate` would mean both "the poster, while loading" and
  "the plate, for good", and every instrument would have to guess which.
- `data-host-reason`: the §3.4 reason on `plate` and `off`.
- `data-host-motion`: `animate` | `held` while live.
- `data-host-camera` (`"27,22"`) and `data-host-zoom`: the values the door actually handed the
  renderer, reported by the door's `onCamera` each time it sets them, never recomputed by the
  reader — the `cursorKey()` rule.
- `data-host-ms`: mount to terminal state, so every CI log carries the reveal time.

`window.__lions` stays undefined on the menu; `ui:routes` asserts exactly that.

**The plate is photographed from the host.** `pnpm plate:host`
(`tools/src/perf/host-plate-capture.ts`, its own port, `--port` overridable) opens `/` at
2560×1440, waits for `data-host=live`, sets `--host-bleed` to 0 and waits for the redraw that
resize causes, hides `.rl-menu`, freezes the frame loop and screenshots, writing `assets/ui/menu_host_plate.jpg` (q80, ~430 KiB,
M18). Plate and live frame therefore cannot diverge in composition; a re-staged
`menu_diorama.json` is re-photographed by one command. The Phase 0 banner inside the column,
`assets/ui/menu_plate.jpg` and `pnpm plate:capture` retire with it (Q1).

**The visual gate is unaffected, confirmed.** Its four gated scenarios are `sandbox=` URLs
and `combat` a `mission=` one (`tools/src/golden-diff/baseline.ts`); none mounts the menu, and
the gate's only screen check loads `?campaign`. The plan's refactors (`rendererOptionsFor`,
`meshPlanFor`) change the mission's code path and not its values, so the gate running GREEN
with no bless is their evidence. **No bless is budgeted.**

**The screens check gains the menu** (§7 of the parent spec), as three votes in
`tools/src/golden-diff/screens-check.ts`, run by `pnpm golden-baseline` before the scenarios:

1. *Path* — on a WebGL2 runner, `data-host` must reach `live` (60 s wait); `plate` fails and
   prints its reason and the console, exactly as `checkCampaignBoard` does for `flat`.
2. *Contribution* — freeze the frame loop, screenshot, hide the host canvas, screenshot: the
   mean absolute channel delta over the two flanks (outside `.rl-menu`'s box) must exceed a
   floor set at one third of the measured signal. Reference-free and texture-proof, the
   visible-toggle A/B's own logic: a lost or black canvas, or a poster left in place under it,
   fails.
3. *Register* — §3.7's measurement, as a vote. At the same camera, M16's noise is ≤ 2% on
   every variation tried (quality, rasteriser, units), against a 10% bar.

**`ui:routes` gains two legs:** the host's canvas must report `isContextLost() === true` after
the menu is left (a reference taken before leaving), and a leave clicked within 100 ms of
landing — mid-prefetch — must leave no canvas, no error and no warning. **`ui:shots`** waits
for a terminal `data-host` before `01-menu` and adds `01b-menu-plate` under emulated
reduced motion.

**A port hazard found while measuring**, and fixed in the plan: `ui:routes` and
`plate:capture` both default to :5177 and `ui:shots` to :5176, and `ensureDevServer`
*reuses* whatever answers on its port. Both ports were held by other sessions' servers during
this work (5177 is the lead's). A run from a worktree would have photographed another tree
and reported on it. `routes-check.ts` and `shoot.ts` gain `--port`.

### 3.7 Acceptance — "one colour register", as a measurement

§6 Phase 3: *"the plate's and the mission's mean luminance and saturation within 10% of each
other."* Made runnable:

- **Mean luminance** is mean relative luminance *Y* (Rec. 709 weights on linearised sRGB,
  WCAG's definition) over the frame. **Mean saturation** is mean HSV saturation
  `(max − min) / max` on sRGB-encoded values, skipping pixels with `max < 0.02`.
- **Captured camera-for-camera:** the menu at 1920×1080 with `.rl-menu` hidden and the host
  `live`; then the sandbox of the diorama's map (`/free-play/beit_sahwan_outskirts`) with the
  camera set to the host's own `data-host-camera` and `data-host-zoom`, overlays off, fog
  revealed, `hideHudExceptCanvas`, a zero-time repaint.
- **Pass:** `|Y_host − Y_mission| / Y_mission ≤ 0.10` and the same for S. Measured today
  −1.7% and +0.5% (M16).
- **Why camera-for-camera, and what this does and does not prove.** M17: the same renderer at
  a different zoom is 17% apart, and a different camera with fog on 31%. So a comparison across
  framings measures composition, and one across fog states measures fog as well.
  Camera-for-camera it catches what it should — a host that stopped sharing the pipeline: its own options, the wrong
  terrain theme, fog left on, an output colour space — and it does not claim to judge the
  board or the briefing, which are the art lane's half of Phase 3's clause. The app half's
  plan could not meet it; this one meets it for the menu when the plan's Task 8 vote is green.

## 4. Architecture

```
packages/app                                         packages/render/src/three/front
─────────────────────────────────────────────        ──────────────────────────────────────
main.ts  mountMenu(host, req)                        scene-host.ts  (door: @lions/render/three-front)
  └ showMenu(stage, { backdrop })                      mountSceneHost(host, opts) → SceneHostView
      └ ui/scene-host.ts  sceneHost(stage, column, deps)  1 prefetch GLBs + decoder (abortable)
          ├ ui/scene-host-model.ts (pure)                2 new ThreeRenderer(sim, options)
          │   hostPath · hostStep · parallaxTarget        3 load meshes · setDecor · setElevation
          │   easeToward                                  4 init · layers off · camera
          ├ front/diorama.ts  buildDioramaWorld()         5 frame · groundTexturesSettled · frame
          │   Sim + meshPlanFor + rendererOptionsFor      6 capped loop · motionVerdict · resize
          ├ front/framing.ts  hostZoom (pure)             7 dispose → loseContext
          └ import('@lions/render/three-front')        cadence.ts (pure) drawDue · motionVerdict
renderer-options.ts  rendererOptionsFor  ◄── also bootBattlefield
mesh-catalogue.ts    meshPlanFor · meshManifestFor ◄── also bootBattlefield
data/front/menu_diorama.json  (+ diorama.schema.json, @lions/data `menuDiorama`)
```

Data flows one way: the app builds a `Sim` and spawns into it through its own API at
construction — the same thing `bootBattlefield` does — and hands it over; nothing ticks it and
nothing writes to it afterwards (invariant 4). `packages/render` imports sim types and receives
a `Sim` instance, as `ThreeRenderer` already does; it never imports `@lions/data`.

The app restates the door's signature (`MountSceneHostView`) and assigns the real
`mountSceneHost` into it inside the dynamic-import helper, so `tsc` compares the two at that
line — `worldmap3d.ts`'s pattern for `@lions/render/three-campaign`.

The door's surface:

```ts
export interface SceneHostMeshes {
  readonly rigged: readonly { id: string; urls: readonly string[]; faction: MeshFaction }[];
  readonly vehicles: readonly { id: string; url: string }[];
  readonly buildings: readonly { id: string; url: string }[];
  readonly decor: ReadonlyMap<string, string>;
}
export interface SceneHostOptions {
  readonly sim: Sim;
  readonly renderer: RendererOptions;          // rendererOptionsFor(map, settings, BASE)
  readonly meshes: SceneHostMeshes;
  readonly decor: Uint8Array;
  readonly elevation: Uint8Array;
  readonly emitters: { list: EmitterSpec[]; resolve: (key: string) => string };
  readonly camera: { readonly x: number; readonly y: number };
  readonly zoomFor: (layerW: number, layerH: number) => number;
  readonly fpsCap?: number;                     // default HOST_FPS_CAP, 30
  readonly signal: AbortSignal;
  readonly onMotion?: (m: SceneHostMotion) => void;
  /** Every camera the door hands the renderer -- at the first frame and on every resize. */
  readonly onCamera?: (c: { readonly x: number; readonly y: number; readonly zoom: number }) => void;
}
export type SceneHostMotion = 'animate' | 'held';
export interface SceneHostView {
  readonly canvas: HTMLCanvasElement;
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly motion: SceneHostMotion;
  dispose(): void;
}
export function mountSceneHost(host: HTMLElement, opts: SceneHostOptions): Promise<SceneHostView>;
```

## 5. The lifecycle as a state machine

`hostStep(state, event) → { state, effects }`, pure, in `ui/scene-host-model.ts`:

| From | Event | To | Effects |
|---|---|---|---|
| `pending` | `ready` | `live` | `reveal` |
| `pending` | `failed(reason)` | `plate` | `keep-plate`, `warn(reason)` |
| `pending` | `deadline` | `plate` | `keep-plate`, `abort`, `warn('deadline')` |
| `plate` | `ready` (late) | `plate` | `dispose-view` |
| `live` | `deadline` | `live` | — |
| `live` / `plate` / `pending` / `off` | `dispose` | `disposed` | `abort`, `dispose-view` |
| `disposed` | `ready` (late) | `disposed` | `dispose-view` |
| `disposed` | any other | `disposed` | — |

`off` is entered only at mount (§3.4) and leaves only by `dispose`. The DOM layer is a thin
executor of `effects`; every branch a leak could hide in is a table row with a test.

## 6. Dependencies and schedule

- **`fix/renderer-reseed`** is adding `Renderer.reseed()` and editing `ThreeRenderer.ts` and
  `packages/app/src/mission-start.ts` now. The plan's first task merges `origin/main` after it
  lands and re-reads `ThreeRenderer.init`, `snapshot` and whatever `reseed` became before the
  door is written; nothing here assumes that code's current shape. The host spawns before it
  constructs, so it does not need `reseed`.
- **`ThreeRenderer.ts` is touched once, additively** (Task 3), after that merge, with no other
  lane on the file — spec §10's rule.
- **G1 (#165, due 2 Oct) decides nothing this depends on.** Its six items are Meshy credits,
  the style bible, the glyph sheet, the board's re-author, vehicle weight numbers and the
  portrait rig. The host uses shipped assets only and costs no Meshy credit; it improves
  whenever the style bible's art lands, by construction. The only thing it waits on is this
  spec's approval and §10's numbers.
- Lanes: `packages/render/src/three/front/**` and the one `ThreeRenderer.ts` method are render
  work; `packages/app/**`, `data/front/**`, `tools/**` instruments are lane A. One branch, one
  landing, merged after `origin/main`.

## 7. Out of scope

- A host behind settings, saves, credits and free play (Q3); the campaign board's own
  diorama and its basin re-author (Decision 2, art lane); key art beyond the menu's plate.
- Spreading the first frame's upload over idle frames (Q4).
- Fixing `ThreeRenderer.dispose()` and `mountWorldView`'s dispose to release their contexts
  (Q5) — the host does not rely on either.
- Moving the menu column (Q2); any HUD, sim or mission change. `packages/sim` is untouched.

## 8. Open questions for the lead

1. **Retire the banner inside the column, `menu_plate.jpg` and `pnpm plate:capture`?** With a
   diorama behind the column, a second picture of the same world inside it is the same image
   twice, and `plate:host` produces a better still for any other use (a 2560×1440 frame, not a
   2200×900 crop). **Recommend: yes, in the plan's Task 5.** If the lead wants the banner, the
   host still ships and the plan drops that one change.
2. **Where should the column sit now that something is behind it?** D-8 kept the centred column
   because "the scene host it would compose against does not exist yet". A centred column
   hides the middle third of the diorama; a left column would free a single wide stage.
   **Recommend: keep it centred for this landing** (the framing is composed around it) and
   decide from `ui:shots` of both, taken after the host lands. It is a `theme.css` change in
   lane A, not a host change.
3. **Should settings, saves, credits and free play sit on the plate?** One CSS background, no
   GPU, one register across every column screen. **Recommend: yes, as a small lane-A follow-up
   after this lands**; not a live host (§3.3 (7)).
4. **Accept the one first-frame stall (0.44–1.45 s, M9)?** The alternative is a second
   `ThreeRenderer` change that uploads textures and geometry across idle frames
   (`initTexture`), which also shortens every mission's first frame. **Recommend: accept now;
   measure again at landing; raise it with the render lane if a player notices.**
5. **`ThreeRenderer.dispose()` releases no GPU memory (M14, M15), and its comments say it
   does.** Every soft leave of a mission holds ~0.4 GB until garbage collection finds the
   context; the campaign board's `mountWorldView` disposes through the same three call and
   should behave the same (not separately measured). **Recommend: a one-line render-lane follow-up
   (`this.renderer.forceContextLoss()` after `this.renderer.dispose()`, and the same in
   `world-view.ts`), with `ui:routes` gaining the same lost-context assertion this plan adds for
   the host.** Not folded in here: it changes mission teardown and deserves its own review.
6. **Approve §10's numbers before the plate is photographed** (the repository's "numbers
   before rendering" rule). The plan's Tasks 1–5 run on the proposed values; Task 6 photographs
   only after approval.

## 9. Deviations from the brief and the parent spec (to become D-52 onward at landing)

- **R-1** The host needs `ThreeRenderer.ts` for one additive read (`groundTexturesSettled`),
  not zero and not a menu mode (§3.1).
- **R-2** Pixi gets the plate, not nothing (§3.4).
- **R-3** Reduced motion gets the plate, not a held live frame (§3.4).
- **R-4** `data-host` has a fourth, transient value, `pending` (§3.6).
- **R-5** The host lives on `/` only (§3.3 (7)).
- **R-6** Parallax moves the picture, not the camera (§3.5).
- **R-7** No WebGL context exists while the slice is on the network (§3.3 (2)).
- **R-8** The camera target is (27, 22), moved one tile from the measured capture by the
  margin test (M19).
- **R-9** `ui:routes` and `ui:shots` gain `--port`; `plate:host` takes a free port, 5183
  (§3.6).
- **R-10** The colour-register acceptance is camera-for-camera, and is a vote in the screens
  check rather than a one-off reading (§3.7).

## 10. Numbers to approve

| Knob | Proposed | Why |
|---|---|---|
| Map | `beit_sahwan_outskirts` | first campaign mission's map: every byte is a prefetch (M1, M2); the Phase 0 key art's map |
| Camera target | tile (27, 22) | the muster in the upper-left flank, an apartment in each flank; ≥ 1.17 tiles of map margin at seven viewports (M19) |
| Camera yaw | 0 (the mission's azimuth) | the sun and the billboards are keyed to it (§3.2) |
| Zoom | 1.6 at a 1920×1080 layer; `1.6 × max(W/1920, H/1080)` of the layer otherwise (1.641 at 1920×1080 with bleed, 2.183 at 2560×1440) | 1.0 showed the map's corners (captured); 1.6 reads as a diorama; the cover law matches the plate's `object-fit: cover` |
| Units | 4: `mbt_lavi` (17,21), `apc_eitan` (14,22), `inf_squad` (18,23) and (16,24), all `facing_deg` 144 | three types mission 1 fields; 3.56 MiB of meshes |
| Idle | the `idle` each GLB ships; the `Sim` never ticks | no new clip, no determinism surface |
| Quality | the player's own preset, as for a mission | one register; AO/SMAA moved the mean by 0.3% (M16) and are the player's choice anyway |
| Frame cap | 30 fps | cap 30 held 28.8–30.3 fps where uncapped managed 21 at `high` (M11) |
| Hold rule | median of 3 draw intervals after the first > 2.5 × 33.3 ms (83 ms) → hold | Metal 33 ms vs SwiftShader ~920 ms (M11, M12) |
| Start | first idle callback after the menu mounts, 500 ms timeout | menu nav at 45–78 ms (M4); the stall of M9 lands after the entrance |
| Load deadline | 15 s from mount, then the plate stays | 1.0–1.9 s local, 4.2–4.6 s at 20 Mbit/s, 1.3–1.7 s SwiftShader (M5–M8) |
| Crossfade | 400 ms opacity, poster removed after | proposal |
| Parallax amplitude | `--host-bleed: 0.75rem` (12 / 13.8 / 16.8 px at scale 1 / 1.15 / 1.4) | proposal, judged on motion |
| Parallax easing | exponential, τ = 700 ms, `dt` ≤ 100 ms | proposal, judged on motion |
| Narrow cut-off | `off` when `.rl-menu` is wider than 70% of the viewport | proposal |
| Plate | `assets/ui/menu_host_plate.jpg`, 2560×1440, JPEG q80 progressive | 429 KiB for this framing (M18) |
| Memory while live | ≤ 900 MB GPU `phys_footprint` at 1920×1080 `high` on the reference machine | measured 563–840 MB (M14) |
| Memory after leaving | ≤ 60 MB within 1 s of dispose | measured 41–43 MB after the explicit loss vs 437–450 MB without (M14) |
| Register tolerance | ≤ 10% relative on mean Y and mean S, camera-for-camera | the parent spec's figure; measured −1.7% / +0.5% (M16) |
