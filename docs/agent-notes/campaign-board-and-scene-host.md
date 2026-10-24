# The campaign board and the menu scene host

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 2079-2236, section "The campaign board / The scene host" -->

### The campaign board

`?campaign` draws `art/meshes/campaign/sahar_basin.glb` as a rotating 3D diorama
on `three` (`packages/render/src/three/campaign/`, reached from `app` by a
DYNAMIC import of `@lions/render/three-campaign` -- named in eslint's bundle
rule like the other four doors). **The flat PNG board is the FALLBACK**, for
three named causes, each warning by name: no WebGL2 (probed with a throwaway
canvas BEFORE the dynamic import, so a browser that cannot draw it never
downloads 609 kB of three), a GLB that will not load, and a scene graph that
fails the campaign contract -- plus a world with no diorama GLB at all.
`worldmap.ts` and `data/campaign/world.json` are unchanged. Until WP-A3.3 the
flat board was ALSO the whole of the Pixi path, which is why a renderer choice
used to decide it; that choice is gone (`?renderer=` is ignored, and a stale
`localStorage['lions.renderer']` is removed at boot, `retired-keys.ts`).

Six things about it are counter-intuitive and each was measured.
**The camera does not move; the BOARD turns**, under `camera.ts`'s own
`VIEW_DIRECTION` -- so this screen and the mission share a camera, and
`uLightDir` stays fixed in WORLD space (`mat3(modelMatrix) * normal`, not the
view-space `normalMatrix` every other material here uses). An orbiting camera
with a view-space light nails the shading to the screen and the board reads as
a texture sliding over a shape that is not moving.
**The frustum is fitted ONCE for the worst yaw**, so the board never changes
size as it turns; a per-frame fit wastes no screen and makes a hex slab swell
and shrink as it rotates.
**Fit the FOOTPRINT, not the bounding box.** A hexagon's box has four corners
with no board under them: fitting the 28-point plan hull instead of the 8 box
corners takes the half-height from 0.45070 to 0.36066 -- the board draws
**1.25x larger** in the same frame, at both 1140/641 and 16/9.
**`outland_scenery` still must never take a REGION tint** (it carries the
diorama's base and rim), but leaving it at the untouched bake was measured
wrong the other way -- photographed at 1440x900 the eastern desert was the
brightest, most saturated ground on screen, louder than the one region a fresh
campaign can play. Scenery is drained to sit below `empty` and above `locked`.
**The shade term is SMOOTH here and banded in `texturedBuildingMaterial`**, on
purpose: a building's facets break on real edges, and three hard bands across a
hillside draw contour terraces that are not in the source.
**Antialiasing is ON**, and since Phase 0 that is no longer unique — the
mission renderer antialiases too (SMAA in the composer, plus the raw
renderer's own MSAA for the composer-less path). Its silhouette is a rotating
hex rim, the worst place aliasing could land.
**The board is on the lit pipeline since 2026-10-01 (S3a, GH-180, PR #332).**
It renders sRGB with ACES tone mapping at exposure 1.0, lit by `lighting.ts`'s
own `DAY_LIGHTS` sun and hemisphere with a 2048 shadow map fitted to the board,
so it reads like the same assets in a mission. The lights sit in the scene
OUTSIDE the board's pivot, so the light stays fixed in world space while the
board turns -- the same rule `uLightDir` used to enforce by hand. Kept: the
transparent canvas, antialiasing, the region tints, the drained
`outland_scenery`, the fixed camera and every flat-PNG fallback path.

A click on locked ground **says why**, into an `aria-live` line. That is not
polish: the ground is one canvas, so a click that resolved to nothing and
printed nothing is indistinguishable from a broken screen. Hover is gated on
"is this really a control", measured -- hovering the live region moves 43,848
canvas pixels (7.52%), hovering a locked one moves **0**. Town pins are DOM
anchors positioned from the view's own projection, never sprites: a canvas
cannot be tabbed into. Full account, with all 27 test falsifications:
`.superpowers/queue/kedem-map-screen-report.md`.

Two traps found while building it, neither specific to this screen.
**eslint walks your build output.** A browser check here means `vite build
--outDir <somewhere>`, and this tree had two sessions doing it at once:
`dist-campaign` and `dist-cursorverify` together made `pnpm lint` red with
**8,631 errors**, every one `no-undef` on a minified bundle. `**/dist-*/**` and
`.superpowers/**` are ignored now, alongside `**/dist/**`.
**`window.localStorage` in this vitest jsdom config WAS a bare `{}`** -- no
`getItem`, no `setItem`, no `length` -- under vitest 4 on Node 25 (CI's Node 22
always had jsdom's real `Storage`). Since vitest 5 (#574 step 2) Node 25 reads
a real `Storage` too, measured; a spec that needs a counting store still
installs its own. Any UI code reaching it must still guard
(`retired-keys.ts`'s `forgetRetiredKeys` does, which is also right for a real
browser with site data blocked, where the property access itself throws). It
made `worldmap.test.ts`'s "does not write to localStorage" test **unable to
fail** -- it compared `window.localStorage.length` before and after, both
`undefined` -- until WP-A3.3 gave it a Map-backed store that counts writes
(falsified: a `setItem` in `worldMap()` turns it red).

### The scene host

`packages/render/src/three/front/scene-host.ts` is a new door,
`@lions/render/three-front`, named in eslint's bundle rule beside the other
five -- **a stock `ThreeRenderer` pointed at a real map, never a "menu mode"**
threaded through that file. It drives a never-ticked `Sim`
(`data/front/menu_diorama.json`, four KDF units on `beit_sahwan_outskirts`)
through the mission's own `RendererOptions`, capped at 30 fps, behind the
menu column -- and **lives on `/` only**: it is part of the menu screen's own
disposer, so `/` -> `/settings` -> `/` leaves no host on settings and a fresh
one remounts on return, with no reload.

**The door never calls `loseContext()` itself.** Since #219,
`ThreeRenderer.dispose()` already releases its own context
(`three/context-release.ts`: `dispose()`, then `forceContextLoss()`, skipped
if already lost), so `release()` calls `renderer.dispose()` and nothing
else. Do not reintroduce an explicit `loseContext()` call; that was the
pre-#219 design. What a re-added one does depends on its shape, measured on
SwiftShader: `getExtension('WEBGL_lose_context')` asked AFTER `dispose()`
returns `null` on the lost context, so that line is silent dead code; a
handle taken BEFORE `dispose()` and called after it logs `WebGL:
INVALID_OPERATION: loseContext: context already lost` as a WARNING. `ui:routes`
collects warnings around all three of its scene-host leaves (live, mid-load,
mid-construct) and fails on any matching
`/WebGL|loseContext|scene host|DRACO|Worker/i`, bar SwiftShader's own `GPU
stall due to ReadPixels` note, exempt by its full text; the held-handle
re-add was seen red in all three.

**`.rl-scene-host` carries `data-host`** (`pending` -> `live` | `plate`, or
`off`) **and five siblings**: `-reason`, `-motion` (`animate` | `held`),
`-camera`/`-zoom` (reported by the door through `onCamera`, never
recomputed), and `-ms` (mount to terminal state). `window.__lions` is never
defined on the menu route -- `ui:routes` asserts exactly that -- which is why
the visual gate freezes the frame loop inside its own `async` IIFE
(`FREEZE_FRAME_LOOP_STATEMENTS`, not the `_SCRIPT` variant, which reads
`__lions.sim.tickCount`) rather than its usual one-liner.

**Reduced motion, save-data, no WebGL2 and every failure get the plate**,
never a held live frame: reduced motion because the plate already IS a held
frame of the same diorama. **Reduced motion gates parallax off on its own,
whatever the path** (`ui/scene-host.ts`: `decided.path !== 'off' && !reduced`)
-- D-54's rule. It was written for Pixi + reduced motion, which read plate
reason `pixi` and slid (`36f74025`); the `pixi` reason went with the backend
(WP-A3.3), so reduced motion now outranks every other mount-time reason, but
parallax still keys off the preference, never the reason, and a plate held for
save-data or a failure at default motion still slides by design (spec §3.5).

**`pnpm plate:host`** (`tools/src/perf/host-plate-capture.ts`)
re-photographs `assets/ui/menu_host_plate.jpg` after any edit to
`menu_diorama.json` -- a re-staged diorama and a stale plate cannot be caught
by eye at review time. `pnpm validate:data` fails by name if the file the
JSON's `plate` field names is missing on disk.

**The gate votes three ways on this screen**, in `checkMenuSceneHost`
(`tools/src/golden-diff/screens-check.ts`, run right after
`checkCampaignBoard`): *path* (`data-host` reaches `live`), *contribution*
(hiding the host's canvas must move the flanks past a measured floor --
30.4426, a third of three identical 91.3279 readings), and *register* (the
host's LIVE frame against the mission's own frame of the same map at the
host's own camera and zoom, mean Y and S within 10% -- not the plate). The
two photographing votes, and `ui:shots`' `01-menu`, first wait (bounded, never
throwing) for `.rl-scene-host__plate` to come off: `live` is stamped at the
START of the 400 ms crossfade and a CSS transition ignores the frame freeze.
Cost: 41.7 s inside a 165 s local `pnpm golden-baseline` run, almost all of it
the register vote's own mission boot -- inherent to the camera-for-camera
design, not waste.

**A SwiftShader tool that clicks off a LIVE menu needs ~20 s of headroom** for
that click: Task 6 measured a 17.1 s menu -> campaign click locally, and
CI's SwiftShader is slower. No landing run recorded `data-host-motion` reaching `held` (`ui:routes` leg
(a) now prints it at `live` and again at the leave click, with the click's
duration). And spec §10's memory budgets -- <= 900 MB while live,
<= 60 MB within 1 s of leaving -- were never measured as memory: the landing
checked only the `isContextLost()` proxy (`ui:routes` leg (a) and (c)), which
says the context was released, not what the GPU process holds.

`ui:routes`/`ui:shots` already take `--port` (landed on `main` via #214; see
the paragraph above, ~:306) -- nothing new here.

---
