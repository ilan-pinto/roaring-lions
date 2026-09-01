# CLAUDE.md

Working instructions for this repository. Read `docs/GDD.md` for *what the game is*; this file is *how to work here*.

---

## Project

**Roaring Lions** — open-source dimetric RTS in TypeScript. Deterministic simulation, data-driven content, realistic combat resolution.

Two renderer backends live behind one interface. **three.js is the default as of
Phase D (2026-08-30)**; PixiJS still ships and is reachable through
`?renderer=pixi`, which persists so it survives the links `menu.ts` builds.
See "The three.js backend" below before touching anything under
`packages/render/src/three/` — it has its own rules, and several of them invert
what the Pixi side does.

---

## The four invariants

These are load-bearing. Violating any of them silently breaks replays, determinism, or future multiplayer, and the breakage will not surface for weeks.

1. **Sim runs at a fixed 20 Hz tick.** The renderer interpolates to 60 fps. Never drive simulation from frame time.
2. **`@lions/sim` uses Q16.16 fixed-point. No floating point.** `Math.*` and `Date.*` are banned inside the sim package and enforced by lint. Use `fx.mul`, `fx.div`, `fx.sin` (LUT-based) from `@lions/sim/fixed`.
3. **All randomness comes from a seeded per-entity PRNG.** `rng(entityId)` — never a global stream, never `Math.random()`. Per-entity streams keep determinism stable when entity counts change mid-mission.
4. **Data flows one direction: commands in → sim → state + events out.** The renderer and VFX subscribe to events. Nothing outside the sim may mutate sim state.

If a task appears to require breaking one of these, stop and raise it rather than working around it.

---

## Package layout

```
packages/
  sim/      deterministic core — imports NOTHING
  render/   renderer + VFX — imports sim types read-only. `app` holds the
            `Renderer` interface (api.ts), never `PixiRenderer` directly, so a
            second backend is a new implementation rather than a rewrite.
  data/     unit/building/mission/vfx JSON + schemas
  app/      shell, input, UI, campaign ledger
tools/      render rig, asset validator, balance sim
docs/       GDD, art pipeline
```

Dependency direction is strictly one-way: `app → render → sim`, and `data` is a leaf. A PR that adds an import from `sim` to anything else is wrong by construction.

---

## Commands

```bash
pnpm install
pnpm dev              # app with hot reload
pnpm test             # unit tests
pnpm test:determinism # replay 1000 ticks from seed, assert state hash
pnpm lint
pnpm validate:data    # JSON Schema check on all content
pnpm validate:assets  # palette + silhouette gate, and sheet COMPLETENESS
pnpm validate:meshes  # the same checks for art/meshes/**, rendered headlessly
pnpm validate:ui      # no colour literals in UI source
pnpm balance          # headless battle sim, prints win rates
```

`pnpm test:determinism` must pass before any commit touching `@lions/sim`. It is the canary for invariants 2 and 3.

---

## Code conventions

- TypeScript strict mode. No `any`. No non-null assertions in sim code.
- **Struct-of-arrays over typed arrays in the sim hot loop.** No per-entity object allocation per tick — GC pauses are visible at 400 units.
- Systems are pure functions over component arrays: `(state, dt) => events`.
- Content is JSON validated against `data/schemas/`. Adding a unit means adding JSON, never engine code. If a new unit requires an engine change, that is a signal the data model is missing a concept — extend the schema.
- Tests colocate as `*.test.ts`. Combat maths requires tests; rendering does not.

---

## Adding content

**A unit:** JSON in `data/units/`, validated against `unit.schema.json`, must pass `pnpm balance` within the cost-curve tolerance band, and needs a `.blend` in `art/src/` that survives `pnpm validate:assets` (including the silhouette IoU check).

**A mission:** JSON in `data/missions/`, validated against `mission.schema.json`. Must declare its ledger contract — `requires` and `produces`. Target 5–7 minutes of play, and **the schema enforces it now** — the 25 allowance for the old 12–20 Beit Sahwan missions is gone. `target_minutes` is 5–7, capped by an `if/then/else` at the schema root rather than by a plain `maximum`, because there is exactly one exemption and it is named in the schema: `beit_sahwan_0_tutorial` at 10. The tutorial is not a campaign mission (it produces no ledger keys), its length is 13 teaching steps in `data/tutorial/beit_sahwan_0.json` rather than a timer, and its `survive_until` 600s primary is a backstop that ejects a stalled player — so 10 declares the backstop. No headless instrument can measure a step machine driven by player input, so cutting it to 7 would be fitting a number to a ceiling with nothing behind it. Nothing in the runtime reads `target_minutes` at all: it is a claim, and the schema is the only thing that checks it.

**A VFX emitter:** JSON in `data/vfx/`, validated against `vfx_emitter.schema.json`. Palette keys only, never raw hex.

**UI:** colour comes from `data/palette.json` like everything else. A Vite
plugin publishes it as `--rl-*` custom properties; `packages/app/src/ui/theme.css`
is the only file allowed to name one, mapping them to semantic tokens (`--ink`,
`--bad`, `--band-mission`). Everything else uses the semantic names or the
`.rl-good`/`.rl-bad` classes. `pnpm validate:ui` rejects a hex or `rgba()`
literal anywhere in UI source, with no allowlist — use `color-mix()` for
translucency. Fonts are self-hosted in `assets/fonts/`; never a CDN.

**A map:** JSON in `data/maps/`, validated against `map.schema.json`. A character grid (`.` open, `1`–`3` cover, `#` building, `^` rock ridge, `b` boulder field) plus named markers and zones — authorable in a text editor. The loader is `parseMap` in `@lions/data`, and `applyTerrain(map, sim)` is the one way its mechanical layer reaches a `Sim` — use it rather than writing a fourth cover loop. `^` is the only blocked tile that is not a building: impassable, sight-blocking, and with no HP, garrison or ROE penalty. `b` is the only symbol whose passability depends on WHO is asking — open ground on foot, a wall to anything wheeled or tracked — and deliberately nothing else: no cover, no sight-blocking, no HP, not destructible. T1-C gave it a `boulder` decor family, and `tel_marum` is the first (and so far only) map to author any: the corridor at x=10-11, y=12-17 plus a scree apron at x=9-12, y=18. It is carried by a second blocked mask (`blocked | boulder`) rather than by `blocked`, since `FlowField.compute` already takes the mask as a parameter; `Sim.fieldFor` keys its cache by `(goal, domain)`, and on a map with no `b` the two masks are the SAME ARRAY, so no second field is ever allocated. What counts as a vehicle is `mobility.wheeled`, an authored boolean defaulting to `!FOOT_ROLES.has(role)` — **`FOOT_ROLES` alone is wrong here**, because it contains `artillery` and `rocket_battery` is a Grad on a 6x6 truck; that unit is the one place the default is overridden in JSON, and `tools/src/boulders.test.ts` pins it against `mortar_team`, which shares the role and is genuinely foot. An optional `elevation` grid gives each tile a height 0–9, one digit per tile, same dimensions as `rows`; absent means flat. It is orthogonal to the terrain symbol on purpose — a symbol table can express ridges but not valleys. E1 stores and draws it at 10 px per level; line of sight reads it — high ground sees over lower obstacles, and every blocking tile, rock or building, stands two levels above its own ground; a low-profile obstacle like a fence never blocks sight at all, but the ground it stands on still does. Since T1-A **pathing reads it too**: `FlowField.compute` takes the elevation grid and charges `UPHILL_PER_LEVEL` (tuning.ts, 10 — one level of climb costs one extra tile of ground) per level CLIMBED, while descending is free. That asymmetry is the design: high ground is expensive to attack and cheap to withdraw from. Sight RANGE still does not. Two things about slope are counter-intuitive and were measured rather than reasoned. First, **a climb telescopes**: every monotone route to a fixed height pays the same total wherever it crosses, so slope only reorders routes over ground that rises ABOVE its destination and comes back down — a rim, a spur, a hill. Second, **inverting the sign changes no route at all**; it shifts every cost by `UPHILL_PER_LEVEL * (h(tile) - h(goal))`, a term independent of the path, so the optimal-route set is untouched and only the cost NUMBER moves. The walk tests and the relief replay all pass with the sign flipped; the mirrored cost pair in `packages/sim/src/flowfield.test.ts` is the only guard on it, and that file's header carries the measurement. `costAt` is the sign's one behavioural reader, via `selectBreachTarget`'s detour test, where slope eats up to 50 of the 100-unit `BREACH_DETOUR_SLACK` on Tel Marum. Terrain needs two levels or more to obscure ground troops, since a one-level rise sits exactly at eye level, and nothing sees further for being higher — elevation affects what you can see over, never how far.

---

## What not to do

- Do not add a game engine, ECS library, or physics library. The sim is hand-written on purpose; determinism cannot be delegated.
- Do not add floating point to the sim, even "just for this one calculation."
- Do not let VFX, audio, or UI state influence simulation outcomes.
- Do not write mission logic as TypeScript. Missions are declarative data; if a mission needs a behaviour the schema cannot express, extend the schema.
- Do not use per-unit A* pathfinding. Flow fields only.
- Do not commit rendered sprites without their `.blend` source.
- Do not commit assets from paid packs (Synty included, even if you own a licence),
  or anything you cannot point to explicit redistribution rights for. This applies to
  audio exactly as it does to art.
- Do not ship AI-generated art without disclosing it in the PR description. Generative
  tools *are* permitted, including for assets that ship; the four `validate:assets`
  gates apply identically regardless of origin. See `CONTRIBUTING.md`.

---

## Current milestone

**M0 — done.** All four §5.7 targets pass in `pnpm balance`; the determinism hash is pinned.

**M1 — Beit Sahwan.** Three short missions, campaign ledger, ROE scoring, playable link in the README. Build order: map schema + loader → mission runtime (declarative objectives) → ledger → civilians + ROE → just-enough economy → three missions → shell UI. Design first, before code: the behaviour vocabulary (GDD §6) and the map format. No art-pipeline activation, audio, or VFX polish inside M1.

The combat model is the product. Everything else is scaffolding around it.

---

## Dev instruments

- Browser sandbox: `window.__lions.step(n)` fast-forwards n deterministic ticks; `__lions.sim` and `__lions.renderer` are exposed.
- `?sandbox=<map id>` walks **any** shipped map with a full task force placed from
  that map's own markers — no mission needed. Bare `?sandbox` still loads
  `beit_sahwan_outskirts` unchanged. Before this, checking anything visual on a new
  map meant authoring a throwaway mission and deleting it, which is how Tel Marum's
  terrain was walked. Also on `__lions`: `goto('hollow')` jumps the camera to a
  marker, `units()` lists living units with their ids and tiles, `sel([id])` sets the
  selection, and `cursorKey()` **reads back** `canvas.dataset.cursor`. That last one
  is a DOM read rather than a recomputation on purpose — the failure worth catching
  is a cursor whose logic is right and whose wiring is not, and recomputing would
  agree with the logic and tell you nothing.
- **The sandbox documents itself** — `__lions.help()`, and the same text prints to
  the console on every sandbox boot: the map that loaded, which flags are on, every
  flag available, every shipped map id, and the console API. An unrecognised URL
  parameter warns by name, which is the case that matters: `&tunel` otherwise does
  nothing at all, silently, and reads as a broken feature rather than a typo. The
  flag table (`packages/app/src/sandbox-help.ts`) is the single source for all
  three callers — `readFlags` parses from it, `sandboxHelp` prints from it,
  `unknownParams` checks against it — so a flag parsed but undocumented, or
  documented but unparsed, is not expressible. Prefer this over grepping this file.
- Three opt-in sandbox flags, each adding only what it names, so a check for one
  subsystem is not buried under three others (a fourth, `&nomesh`, is an opt-OUT
  — see "Mesh units"): `&roe` supplies flagged ground (the
  map's own `clinic`/`mosque`/`refuge` zone where it has one, otherwise a 4×4
  synthesised midway between the two anchors); `&tunnel` appends a pre-dug route
  from the hostile side toward the friendly one and adds two `yahalom_squad`;
  `&sur` adds the four Sarim units no mission fields (`sarim_rifles` ×2,
  `recoilless_team`, `manpad_team`, `rocket_battery`). Combine them —
  `?sandbox=tel_marum&tunnel&sur&roe` is the everything build, on the only map with
  relief. All three are sandbox-only: a mission brings its own zones and tunnels,
  and a dev flag must never change how a real mission scores. The synthesised route
  is NOT identified by construction — a `mark_tunnel` carrier still has to see it,
  which is the mechanic the charge cursor depends on.
- Two ROE facts a visual check needs: **only `wadi_halam_basin` contains a mosque**,
  so the protected-target X is unreachable anywhere else unless a mission declares
  `roe.flagged_zones` or `&roe` supplies one. Tel Marum's town buildings are `#`
  (`concrete`, penalty 3), so they read as the *costly* tier, not protected.
- `pnpm balance` runs the §5.7 backtest; `tools/src/backtest/urban-only.ts` is the fast urban-ratio calibration loop.
- The determinism golden hash lives in `packages/sim/src/determinism.test.ts`. It changes only when sim code or tuning changes deliberately — update it in the same commit and say why.
- Combat tuning lives in `packages/sim/src/tuning.ts`. §5.7 targets outrank §5 formula text.
- The renderer is behind an interface (`packages/render/src/api.ts`), and `main.ts`
  holds it by that type, so the compiler — not a grep — is what keeps `app` off
  backend-only members. Projection is asked for (`renderer.worldToScreen`) rather
  than recomputed: the arithmetic lives in `project.ts`, pure and tested, and is
  **not** exported from the package. `TILE_W`/`TILE_H` are, as layout constants.
- ~~`touch packages/app/src/main.ts` after adding an asset~~ — **not needed any
  more, and nobody should be told it again** (GH-147, fixed 2026-09-01). Every
  agent on this branch was passed that workaround by word of mouth; it never
  appeared here. What it worked around: `main.ts` names meshes by template
  (`new URL(\`../../../art/meshes/${id}.glb\`, import.meta.url)`), Vite rewrites
  that at TRANSFORM time into an `import.meta.glob` and bakes the directory
  LISTING into the module. Vite invalidates that listing on a file add — but only
  from a watcher event, and its watcher covers `[root, configFileDependencies,
  env files, publicDir]`, which for this app is `packages/app` and `assets/`.
  `art/` is in neither, so a new GLB was invisible: the missing key gave
  `undefined`, `new URL(undefined, …)` resolved to `/src/undefined`, the SPA
  fallback answered with `index.html` at HTTP 200, and the app died on
  `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON at
  GLTFLoader.parse` — a JSON error, in a mesh loader, naming a file nobody
  touched. `packages/app/vite-plugin-asset-watch.ts` now puts those directories
  under the watcher and Vite's own invalidation does the rest. It DERIVES them
  from the source rather than listing them, because a hand-kept list of asset
  locations is the `SPRITE_MAP` failure mode and would go stale the same silent
  way. Two consequences worth knowing: a running browser now reloads by itself
  when a GLB lands, and the six watched directories are printed at `pnpm dev`
  boot, so "is my new mesh's directory covered?" is answered by the banner.

---

## The three.js backend

**The default since Phase D.** Pixi is the escape hatch (`?renderer=pixi`), not
the baseline. The seam is `packages/render/src/api.ts`, and `main.ts` holds a
`Renderer`, never a concrete backend — so the compiler, not a grep, keeps `app`
off backend-only members. Both backends arrive by dynamic import from their own
entry points, so a player downloads only the one they run.

Two constraints that were true DURING the migration and are worth restating now
they can be misread. `renderer.ts` was frozen per phase so the cross-renderer
diff had a fixed reference; with the flip done, that freeze is no longer
load-bearing and unfreezing it is a decision someone should make deliberately
rather than assume. And **VFX no longer owe Pixi parity at all** — three-only
effects are the intended end state.

**Design and outcomes** are in `docs/superpowers/specs/`: the migration design
(`2026-08-26-three-renderer-design.md`), the palette GO/NO-GO
(`2026-08-26-phase-0-verdict.md`), phase outcomes B1-B4, the rigged-infantry
design (`2026-08-28-rigged-infantry-design.md`), its verdict
(`2026-08-28-phase-r0-verdict.md`), and the pinned mesh contract
(`2026-08-28-mesh-unit-contract.md`). Read the outcome doc for the phase before
yours; each one records what the next phase inherits.

**Rules specific to this backend, each of which has already cost a bug:**

- **`three` may only be imported under `packages/render/src/three/**`**, enforced
  by eslint. Note the rule's `paths` entry does NOT catch subpath imports like
  `three/addons/loaders/GLTFLoader.js` — keep those inside by discipline.
- **The colour pipeline is not the default one and fails silently.**
  `palette-material.ts`: LUT colours built with `setStyle(hex,
  LinearSRGBColorSpace)`, `renderer.outputColorSpace = LinearSRGBColorSpace`, the
  clear colour set through the same call (order matters — three reads
  `outputColorSpace` synchronously when `setClearColor` runs), and antialiasing
  OFF. The naive setup measured **0 of 65 colours in palette** and looked fine.
- **`units/render-order.ts` is the single source of truth for every
  `renderOrder`.** Read it before setting one. Bands are: **-1 world (mesh
  buildings)**, 0 hull/structures, 1 turret, 1.5 badge numeral, 2 FX,
  3 FX-above, 4 overlays, 5 smoke, **6 occlusion silhouette**, 7-9 reserved,
  10 fog. Overlays sit BELOW fog because Pixi's `unitsG` is added to `world`
  before `fogG`; an earlier version of that file said the opposite, citing Pixi
  identifiers that do not exist. Band -1 is the only one whose value changes
  anything for an OPAQUE mesh, where the depth buffer normally makes
  submission order irrelevant. It was added for the occlusion silhouette's
  stencil mask, back when that silhouette was a solid FILL and a unit body
  stamped the mask only where its fragment WON the depth test -- true only
  once the world had already drawn, and three.js sorts the opaque queue by
  `material.id` BEFORE `z`, so at band 0 the draw order between a unit and a
  building was decided by which GLB finished loading first (measured on
  `beit_sahwan_outskirts`: unit materials 164-167, building materials
  246-250, so units drew first and a tank behind an apartment silhouetted as
  a few slivers). **The outline retired that dependency**: the mask now means
  "a unit's footprint covers this pixel" and is stamped on `stencilZFail`
  too, so no draw order can falsify it. The band stays -- still correct,
  still free, still where a future opaque occluder belongs -- but it is no
  longer load-bearing.
- **The occlusion silhouette is an OUTLINE, not a fill** (`units/silhouette.ts`).
  An inverted hull -- the merged silhouette geometry pushed out along a welded
  per-vertex normal by a constant 2.5 SCREEN pixels at any zoom -- with the
  interior punched out by the footprint stencil above. Three things about it
  are counter-intuitive and were each measured, not reasoned. `side` must be
  `BackSide` on the mesh path: `FrontSide` only widens the silhouette where a
  face's normal is perpendicular to the view, which is a razor-thin set of
  grazing triangles half of which are culled, and it photographs as broken
  squiggles rather than an outline. The width must be constant in PIXELS, not
  world units, because `main.ts` clamps zoom to 0.35-2.5. And it is applied in
  the GLB's own object space, so it needs multiplying by `MESH_UNITS_PER_TILE`
  to undo `MESH_SCALE` -- forget that and the outline is a third as thick as
  asked for, which looks plausible and is wrong. Billboards have no hull to
  invert, so that path dilates the atlas alpha instead. Costs no extra draw
  call over the fill: measured +24 on 310, both ways.
- **Every shot that is one round draws a travelling projectile; only a STREAM
  keeps the flat tracer.** `units/shells.ts` is the whole model and it now
  serves both halves — `mortar`/`rocket` arc (GH-145), and since GH-149
  `bolt` (`apfsds`, `autocannon`) and `missile` (`atgm`, `rpg`, `heat`) fly
  the same streak with no arc and a much shorter trail. `small_arms` and
  `hmg` deliberately keep `TracerBatch`'s full-span ribbon, which is right
  for a rifle burst and was wrong for everything else. Three things about
  this are worth knowing before touching it. **The flat tracer was never
  absent from direct fire** — the complaint "direct fire has no visible
  projectile" is literally false and substantially true: photographed at
  `ad7ac3d`, a Lavi's `gun_120` drew two dead-straight lines that spanned the
  whole gap on frame 0, did not move for seven more frames, and faded. It was
  a laser that dimmed. **The brief's "~4 frames" was argued down with a
  frame-for-frame A/B and the shipped bolt lives ~13** (30 tiles/s over the
  6.7-tile engagement range measured on `beit_sahwan_outskirts`): at 4 frames
  the streak is longer than its own travel, so it reads as one shape that
  flashes — the identical failure, shorter. **There are two `ShellBatch`
  instances**, and they differ in exactly three things, none per-shell:
  `depthTest` (off for the arc, which flies 88 lift px up and was measured
  drawing behind a one-storey house; ON for a bolt at 9, where a building in
  front SHOULD hide it and cannot be in the way anyway, since direct fire
  needs LOS), the band (3 vs 2), and the colour pair. Which one a round goes
  to is `SHELL_PROFILES[kind].indirect`, read once through `isIndirectShell`.
- **An arcing round is `vfx.fire`/`vfx.ember`, not `vfx.tracer`** — the new
  `RendererOptions.shellColors`, three-only, ignored by Pixi. A landing
  mortar bomb or Grad rocket also throws `data/vfx/shell_impact.json` through
  the same `spawnCollapseFx`/`mesh_burst` path a building collapse uses, at
  `impactPower` 0.3/0.45. That fires off the FRAME clock (`shellHasLanded`),
  deliberately not off the sim's own `impact` event, which resolves on a
  different clock and would put the fireball where the bomb visibly is not.
  Note `screen_shake` in `vfx_emitter.schema.json` is still read by nothing —
  `emitters.ts` types it and no backend consumes it.
- **Overlays scale with zoom, and that is faithful.** Pixi scales its whole
  `world` container by `camera.zoom` and the overlay layer is a child of it, so
  HP bars look enormous zoomed in on BOTH backends. Verified side by side. Not a
  bug; changing it is a decision affecting both.
- **`preserveDrawingBuffer` must stay off** in shipping code. Canvas readback
  therefore returns black — that is correct, not a broken renderer.
- **The visual gate is three-vs-three against a committed baseline**:
  `pnpm golden-baseline` (`tools/src/ci/three-baseline-gate.ts`). Playwright
  captures three.js at a fixed scenario/tick/camera and diffs it against a PNG
  in `tools/golden-baselines/<envKey>/`. It runs in **ci.yml's `visual` job on
  every PR and every push to main** — 30.8 s wall clock for all four scenarios
  including booting its own dev server — plus a nightly that files a GitHub
  issue on failure. Read `tools/src/golden-diff/baseline.ts` before touching a
  threshold; four things about it are counter-intuitive and every one was
  measured.
  **`meanAbsChannelDelta` is the PRIMARY metric and pixelmatch's pixel count is
  the secondary one**, which is the reverse of how a golden-image gate is
  usually written. Colour here is quantised onto a palette, so a real
  regression moves a wide area by ONE palette step — 19/255 for the stone-grain
  scatter defect — which is under pixelmatch's 0.1 perceptual threshold.
  Re-injecting that defect into HEAD and capturing gives **`diffPixels` 0 and
  `meanAbsChannelDelta` 0.3519** on the open-ground crop. A gate written the
  usual way sees nothing.
  **Baselines are keyed to the capture environment and that is not tidiness.**
  Same machine, same commit, SwiftShader vs ANGLE/Metal: 230 px / 0.0320 on
  `quiet` alone, ~100x that scenario's run-to-run noise and enough to swallow
  the defect's own 0.0493 signal. A missing baseline for the current
  environment is **exit 3**, a distinct code, never a silent pass. Cross-OS
  portability (Linux SwiftShader vs macOS SwiftShader) is **unmeasured** — the
  committed `darwin-arm64-swiftshader` set is not a substitute for a Linux one,
  and CI's must be created by the `visual-baseline-bless` workflow.
  **Run-to-run noise is not spread over the frame**; it sits in tight clusters
  around animating mesh units and real-time VFX, and every other pixel is
  bit-identical between captures. That is why a scenario can declare a
  `region`: scoping `open-ground` to its unit-free ground crop took its noise
  from 1762 px / 0.1544 to **0 / 0.0000**. Every scenario also has an ABSOLUTE
  `targetTick` now, because a relative `step(n)` lands 18–22 ticks late and
  drifts run to run.
  **`combat` is captured, reported and does NOT vote.** Two captures of the
  same commit differ by 969–3847 px / 0.19–0.36 there; the defect reads 3231 px
  / 0.6006 — inside the noise on count and 1.7x it on magnitude. No honest
  threshold exists between them. Its frame still uploads as a CI artifact.
  **Accepting an intended change** is `pnpm golden-baseline:bless -- --reason="..."`,
  which refuses to run without the reason and writes it into `manifest.json`;
  on CI it is a `workflow_dispatch` that opens a PR with the new PNGs so a human
  sees the picture. Do not widen a threshold to clear a red run.
- **The cross-backend Pixi-vs-three diff is now REPORT-ONLY**
  (`pnpm golden-diff:compare`, `tools/src/ci/golden-diff-gate.ts`). It exits 0
  unless a capture fails, and its `SCENARIO_BUDGETS` are kept as historical
  reference numbers, not thresholds. The project lead retired the pass/fail:
  *"retire cross-backend and rebuild it as three-vs-three."*
  Why, measured: since the mesh flip (`362bde7`) all four scenarios sat 1.8x–2.3x
  over budget with **no regression behind it** — re-capturing three with
  `&nomesh` put every one back inside budget (2.556→0.255, 7.094→2.132,
  5.426→1.312, 11.971→5.996), so 100% of the overage is the mesh path Pixi has
  no counterpart for. The budgets were last calibrated at `45a2cc1`, **124
  commits** before the flip. Recalibrating would have blessed a ~12% baseline on
  `combat`, inside which a broken mesh material or a missing unit type is
  invisible. And the harness's own `OPEN_GROUND_SCENARIO` comment already
  recorded that cross-backend **could not discriminate the scatter defect from
  its fix at all** (1.945% buggy vs 1.937% fixed, not even ordered right) while
  same-renderer separated them 34x. `EXPECTED_DIFFERENCES` never fed a pass/fail
  — it is `.length` in a message and a printed table — so adding entries could
  never have cleared the red, and correcting them is safe. Full account:
  `.superpowers/queue/golden-diff-red-report.md` and
  `.superpowers/queue/golden-three-report.md`.
  **VFX are exempt from this diff as of 2026-08-30.** The project lead's call:
  "all VFX should move to three." Pixi's VFX are legacy and are no longer owed a
  matching effect — an effect that exists only in three is the intended end
  state, not a divergence to be reconciled. This does NOT relax the freeze on
  `packages/render/src/renderer.ts`, which must still stay byte-identical to
  `main`; it removes the obligation to hold three's VFX back to what Pixi can
  match. Two consequences: `additive` and `heat_shimmer` (schema fields read by
  nothing) were deferred purely because implementing them meant touching both
  backends, and are now unblocked in three alone; and new VFX work should be
  judged on how it looks in three, not on cross-backend agreement. Capture conditions must be stated with any number from it — a
  first run read 6.5× higher purely from screenshot downscaling and a font-load
  race, and the OS mouse cursor is shared across tabs and can leak into a capture.

### Mesh units

Most unit types draw as rigged 3D meshes instead of billboards, and **this is
the default on `three` as of the mesh flip** — every type with a shipped GLB,
in every mission, with no flag. It was an opt-in `&mesh` until then, which
meant no player reached through `ui/menu.ts` ever saw a mesh: that file builds
`?mission=<id>` and never appended the flag. `&mesh` is still ACCEPTED and does
nothing, so old bookmarks and doc lines do not trip the unknown-parameter
warning. The escape hatch inverted: **`&nomesh`** walks the billboard path on
`three` (and skips the GLB downloads entirely), and `?renderer=pixi` has no
mesh path at all — not a gap to close, a permanent property of that backend.

The whole set costs **34 GLB fetches, 25.3 MiB**, loaded unconditionally at
boot rather than per mission roster — measured, and the reason a lazy per-type
load is worth doing before release. Pipeline: `tools/units/kit.py` (geometry)
→ `tools/units/rig.py` (armature + clips, authored as Python tables) →
`tools/export_mesh_team.py` → `art/meshes/<team_id>.glb` → `three/units/mesh-*.ts`.

- **`kit.py`'s "No armature." rule is now partly overturned.** Of its three
  reasons, only "blocky is enough at 25 px" fell — beaten by the project lead
  judging rigged motion better on screen. The other two stand, and reason 1 is
  why bones and clips are **authored in code and never hand-posed**, and why
  binding is rigid one-part-to-one-bone with **no weight painting**.
- Adding a part to `kit.py` makes `rig.py`'s `PART_BONE` stale. It **raises
  loudly** rather than leaving gear in bind pose. Extend it; never silence it.
- **A GLB carries zero materials — except three buildings, by the lead's
  explicit override.** Colour is applied at runtime from a ramp SLICE indexed
  by normal. Do not port `render_team.py`'s `ROLE_PALETTE` or `LIT_GAIN` into
  a mesh export — that table compensates for a multiply-style light and a
  toon LUT indexes instead.
  The exception is `house`, `apartment` and `warehouse` (and their wrecks),
  which ship their supplied Meshy `base_color` bake: *"i have provided a very
  detailed blender files and i want them to be used as is unless ill provide
  other instruction."* The opt-out is a NAMED LIST on both sides —
  `TEXTURED_BUILDING_TYPES` (`three/units/textured-building.ts`) and
  `TEXTURED_MESH_EXEMPT` (`tools/validate_mesh_assets.py`) — pinned against
  each other by `textured-building.test.ts`, which parses the Python set. A
  GLB outside the list that ships a texture **throws** rather than being
  silently upgraded. Three things a reader will otherwise get wrong:
  **the decision is per MESH, not per file** — the warehouse's roof cap is
  synthesised by `export_meshy_warehouse.py` (its source is an open-topped
  scan), has no UVs, and stays on the palette inside a textured GLB;
  **`pnpm validate:meshes` does NOT palette-check these six**, and never
  could have — `render_mesh_gate.py` repaints every building from the palette
  before rendering, so the check was measuring a stand-in, and the gate now
  prints a `NOT palette-checked` line naming them (silhouette IoU still runs);
  and **the map's `colorSpace` must be `NoColorSpace`**, because
  `GLTFLoader` stamps `SRGBColorSpace` on a baseColorTexture and this
  renderer's output is pass-through — measured on `beit_sahwan_outskirts`,
  getting that wrong drops a lit wall from rgb 67 to 51 and a shaded one from
  51 to 30 while the terrain beside it is byte-identical, and it still looks
  like a building. `metallic_roughness`/`normal` are dropped at export: there
  are no lights in this scene to consume them.
- **Mesh units are outside `validate:assets`** — no PNG, so no palette or IoU
  gate runs on them at all. Phase G is meant to fix that and has not.
- **`kit.py` changed without the sprite sheets being re-rendered**, so
  billboards and meshes can disagree until that debt is paid.
- **Mesh units ARE gated now** -- `pnpm validate:meshes` (`tools/render_mesh_gate
  .py` + `validate_mesh_assets.py`) renders every `art/meshes/**/*.glb`
  headlessly through `render_rig.py`'s own rig and runs
  `validate_assets.py`'s IMPORTED palette/silhouette/fill checks. Silhouette IoU
  compares each mesh against every other mesh and every other unit's sprite,
  EXCLUDING its own retired sprite -- a mesh is supposed to look like the unit it
  replaces. **It is in CI** (`8304f6b`, ci.yml's `gates` job), and CI really can
  run headless Blender: the workflow downloads Blender 5.2.0 linux-x64 from
  download.blender.org and that URL is live (HTTP 200, verified 2026-09-01) --
  this is a real gate, not a green-looking no-op. Current state measured
  2026-09-01: **passes in 31.69s**, "46 mesh unit(s) rendered and checked against
  36 sprite unit(s); 21 decor mesh(es) checked against the mesh contract
  directly" -- the "29/29" this line used to carry is long stale. Locally it
  needs Blender on PATH or `--blender`/`BLENDER_BIN` (a macOS `Blender.app` is
  found by the default candidate list); with none it fails loudly rather than
  skipping. Two traps when running it in a **shared worktree**: it walks
  `art/meshes/` with no filter and no ignore of untracked files, so another
  session's scratch `.glb` will fail YOUR run (observed -- a stray
  `zz_throwaway.glb`, a copy of `digger_crew`, produced
  `silhouette collision: digger_crew (mesh) vs zz_throwaway (mesh) IoU=1.000
  (limit 0.88)`); and there is no `--meshes` flag to point it elsewhere, so
  `git status art/meshes/` is the first thing to check when it goes red.
- **Art existing is not art drawing.** `packages/app/src/main.ts`'s
  `SPRITE_MAP` is what queues a sheet for loading, and a unit type absent from
  it never loads anything. Three complete, gate-passing sheets shipped and drew
  NOTHING because of this. No gate catches it. Check `SPRITE_MAP` when adding a
  unit.
- **`render_team.py --probe` used to overwrite shipped sprites** with
  unquantized renders (~10% of pixels, file sizes doubling) -- the PNG half of
  the same defect `229aad5` fixed for manifests. Fixed: probe output goes to
  `.superpowers/probe/`. If you touch that path, re-prove `git status` stays
  clean after a probe run.
- **The elevation debts above were finally walked on `tel_marum` (2026-08-29)
  and four of the five are not what the bullet implies.** Extruded terrain
  fails to occlude units IDENTICALLY in both backends (neither does volumetric
  occlusion); mid-slope picking works in both; the wreck/fx sorting gap
  produced no visible artifact even staged at the map's steepest 4-level drop;
  and `raySmoke` is shared sim code that cannot diverge by backend. The one
  real divergence runs the OTHER way: Pixi's tracers and puffs ignore
  elevation (`renderer.ts:2599`, a flat `isoY(...)-4`) while three's
  `TracerBatch` lifts by the higher endpoint's ground height. Three is
  correct there and Pixi is not.
- **A renderer choice persists per ORIGIN, not per tab** (`renderer-choice.ts`,
  `localStorage['lions.renderer']`). Two tabs open on the same origin fight
  over it -- observed live. Harmless between agents; a real hazard for a player
  with two tabs.

---

## Known scaling debts

- Detection is O(N²) pairs per tick. **The "~150 units" figure this line used to
  carry was a guess and it was wrong by an order of magnitude** — measured
  2026-08-30 (`docs/PERFORMANCE.md`, "Sim tick cost"), the 300-unit GDD target
  runs at **2.08 ms, 4.2% of the 50 ms budget**, and the budget is not crossed
  until ~1,700–2,100 living units. Nothing needs staggering today.
  Two corrections worth carrying when it eventually does. **`selectTarget`
  (`sim.ts:2603`) is a SECOND O(N²) scan** — every living shooter scans every
  entity for every weapon slot, every tick — and together with `stepDetection`
  it owns 85–95% of tick cost at every checkpoint. Those two are the targets,
  not the trail scan below. And **every per-tick scan bounds on `this.count`,
  the LIFETIME spawn count, never decremented** — so a freshly-spawned
  2,100-unit world costs 58 ms where the same `this.count` battle-worn costs
  39 ms. Attrition makes the sim faster, and a long mission with heavy churn
  keeps paying for units that died an hour ago.
- Rigged mesh units cap out around **420-460** of the same infantry type, measured
  against a real export on a real `WebGLRenderer` with hardware acceleration
  confirmed, across repeated runs. That clears the GDD's 300-unit target with
  margin, so it is not blocking. The bottleneck is **draw-call submission**
  (74-84% of `renderer.render()`), NOT `AnimationMixer` update and NOT
  bone-matrix computation — which matters, because it means vertex count is
  comparatively cheap (the rifle went 144 → 612 verts for zero new draw calls)
  and the remedy is fewer submissions rather than simpler geometry. `SkinnedMesh`
  does **not** instance in three.js: `InstancedMesh` and skinning do not compose,
  so N units is N × (meshes per team) draw calls. The known remedy for pushing
  past the ceiling is a vertex animation texture — bake clips into a texture,
  drop runtime skinning, use `InstancedMesh` with a per-instance time offset;
  VRAM cost is small (~22-130 MB against the existing 584 MB sprite budget).
  **Unresolved before VAT could ship:** R0's "no band crawl" result was measured
  against continuous real-time skinning, not against VAT's baked-and-lerped
  normals, and the toon ramp is indexed BY NORMAL — so that finding needs
  re-verifying, not assuming. Harness: `tools/src/perf/three-units.ts`.
  **Re-measured 2026-08-30 against this branch's HEAD** (three.js now the
  default renderer; vehicle/building meshes, rigged infantry, and continuous
  vehicle dust/exhaust FX all draw) — see `docs/PERFORMANCE.md`, which is now
  the durable home for this evidence (the prior report lived only in a
  gitignored `.superpowers/` file, unreachable outside the session that
  produced it — `docs/superpowers/specs/2026-08-29-phase-d-todo.md` item #11).
  Same stand-in harness, real hardware GPU confirmed via
  `WEBGL_debug_renderer_info` (headless Chromium defaults to software
  SwiftShader rendering and must be launched with explicit ANGLE/Metal args to
  avoid it — a confound that cost one full mismeasurement while producing this
  note, recorded in the doc as a worked example of "state capture conditions
  with every number"), reproduced across two runs: the render budget is
  crossed around **~1,150 figures**, not lower than 420-460 — the original
  figure holds, with more margin than previously recorded, not less. The
  billboard-vs-real-shipped-mesh comparison (a quarter of a mixed 400-unit
  roster swapped from billboard to real `art/meshes/` GLBs) adds at most
  ~1ms of p95 frame time at 320 living units, nowhere near either budget.
- ~~Mesh units have no `down`/`wreck`/`work` clips~~ — **stale for INFANTRY since
  `233f683`, and the debt has moved to vehicles.** The prediction in the old text
  was right and was acted on: FK-folding the standing rig into prone did produce a
  self-intersecting heap, so `rig.py`'s `_figure_death_parts` calls
  `kit.figure(posture="prone")` for SEPARATE geometry, binds it rigidly to a
  per-figure `{prefix}_death_root`, and every clip keys both roots' scale (1/0
  living, 0/1 dead). All sixteen infantry team GLBs now carry `down` and `wreck`
  (`moto_rpg` carries `wreck` only — a motorcycle cannot go prone;
  `yahalom_engineer` also carries `work`), civilians carry `down`, and
  `units/mesh-death.ts` plays them: 0.4 s fade, then a persistent `MeshWreck`.
  Verified 2026-09-01 both from the shipped bytes and on screen — a killed
  `inf_squad` on `?sandbox=beit_sahwan_outskirts` leaves three prone figures beside
  a standing squad.
  **What has NO death state is a mesh VEHICLE**, and the failure is worse than
  "nothing draws". `art/meshes/vehicles/*.glb` declare zero animations, and
  `updateVehicleMeshes` skips `alive[i] === 0` and prunes the clone in the SAME
  frame — so at t=0 the 3D mesh vanishes. What replaces it is a BILLBOARD:
  `ThreeRenderer.addWreck` excludes `meshUnitTemplates.has(typeId)` but **not**
  `vehicleMeshTemplates`, so a mesh-drawn vehicle still gets a `UnitWreck`. The
  sequence a player sees, measured at zoom 1.6 and 2.2 on the default renderer, is
  three art styles in half a second: 3D mesh → a flat 2D sprite of the INTACT
  vehicle fading over 0.4 s (`stepDeaths` falls `down` back to `idle` for a sheet
  with no `down`, which is every mesh vehicle's sheet but `PARA_MOTOR`'s) → the 2D
  `wreck` sprite. For
  `mbt_lavi` there is no third step at all: `TNK_HULL`'s manifest declares no
  `clips` key, so `clipOrFallback(sheet,'wreck') !== 'wreck'` and a destroyed Lavi
  leaves only `updateOverlays`' grey cross on bare ground. Do NOT "fix" this by
  adding `vehicleMeshTemplates` to that `addWreck` guard on its own — that deletes
  the sprite wreck and leaves nothing, which is strictly worse. It needs a real
  mesh wreck first. The asset mechanism is proven and the two Blender traps are
  measured (see `.superpowers/queue/mesh-death-report.md`); what is missing is
  wreck GEOMETRY for a currently-shipped vehicle. The only vehicle in the tree that
  ever had any is the D9 — `d9.blend` carries seven `WRECK_` parts (collapsed cab,
  blade off, stack down) that `export_mesh_vehicle.py` deletes at export — and
  `31c9799` replaced `dozer_d9.glb` with a Meshy-sourced export, so
  `export_mesh_vehicle.py` now produces no shipped asset but `apc_eitan.glb`.
- Tunnels are implemented (`feat/tunnel-subsystem`): routes are map data, a digger
  advances one and leaves surface spoil, stocked fighters surface at the vent to fire a
  volley and submerge, and a `yahalom_squad` charge collapses a route. Both content keys
  are wired: a placement's `digs` assigns its body as a route's digger, and a
  `mark_tunnel` unit with a sight line to a route identifies it — spoil or no spoil —
  so an authored mission can dig, find, and collapse a route end to end (the mission
  runtime tests prove the chain from JSON alone). The Beit Sahwan subterranean
  mission (#91) now exists — `data/missions/beit_sahwan_4_subterranean.json`, the
  first content to use the `subterranean` phase. `tunnel_travel` remains unit data
  only.
- The trail-detection scan is O(routes × living units × sight²) per tick
  (`trailStrengthFor`), on top of detection's existing O(N²) — and `markerSeesRoute`
  is the same shape again for `mark_tunnel` carriers, though it stops scanning a
  route once identified. At the largest authored
  mission (65 units) that is ~10⁵ extra array probes a tick — immaterial now, real at the
  GDD's 300-unit target, and it wants staggering at the same time detection does.
  `drawTrail` is O(width × height × routes) at 5 Hz and belongs in the same sweep.
- ~~A civilian who boards a transport and whose transport then dies before reaching the refuge is stranded forever~~ — **fixed.** `stepCivilians` latched `civFled` before boarding was attempted and then skipped that civilian on every later tick, so one dropped by a dead carrier had no order and no way back into the loop, and could never satisfy `evacuate_before`. It is now re-ordered to the refuge when it has actually stopped — riding and walking are both left alone as progress, and an evacuated civilian is already `alive = 0`. A civilian standing on the refuge marker and still uncounted means that mission's marker sits outside its own evacuation zone, which is an authoring fault and is deliberately NOT re-ordered (it would queue one dead command per tick). Guard: `mission.test.ts`, "re-orders a civilian whose transport died".
- `starting_force` never consults a unit's `unlock` gate — `spawnPlacement` has no equivalent of the `buildBlockedReason` check `requestBuild` makes. Missions rely on this: Wadi Halam V hands out a `dozer_d9` (ROE 60) and a `demo_squad` (ROE 50) unconditionally, and Wadi Halam I–V all field a `recon_drone` (35) or an `ifv_namer` (40) a fresh campaign has not earned. Whether that is a feature or a hole is undecided; what matters is that resolving it in the obvious direction would silently strip Wadi Halam V of both demolishers, so the `seconds` deadline on its `raze` primary is what keeps that a lost mission rather than a stuck one.
- `mission.schema.json`'s wave `from` promises "Spawn point or tunnel id. Tunnels
  keep producing until located and collapsed", but `mission.ts:1307` resolves `from`
  through `markerPos` only — a tunnel id there is an unknown marker. Tunnel-sourced
  reinforcement waves do not exist. Beit Sahwan IV works around it with `in_tunnel`
  garrisons that vent, which is the loop the subsystem was built around; the schema
  text should either be corrected or the feature built.
- `intel.marked_positions` cannot pre-reveal a tunnel route, and after the
  subsystem's playtest it should not: it reveals units by tag (`mission.ts:942`),
  exempts buried placements deliberately, and tunnel visibility is live — a route is
  identified only while a `mark_tunnel` carrier holds a sight line, so anything
  revealed at t=0 decays to unknown unwatched. GDD §4's "thorough recon → tunnel
  mouths pre-marked" is therefore not literal, and Beit Sahwan IV honours the
  contract through the surface ambushers instead.
- `tools/src/backtest/playtest.ts` was crashing on `main` from `d46b926` until
  `b604032` and nobody noticed. Its `run()` never registered the map's tunnels with
  the `Sim`, so the moment Beit Sahwan II gained a `digs`/`in_tunnel` placement the
  whole chain died at that mission with `unknown tunnel "bs_tn_west"`, taking every
  mission below it with it. The gate was then a manual `npx tsx` script wired into
  neither `pnpm test` nor CI, which is why "all gates green" could be said truthfully
  about the tunnel subsystem while this one was red. **It is wired now** (`c05de3c`,
  `pnpm playtest` in ci.yml's `gates` job), so that particular silence cannot recur. Two consequences outlived the fix and have
  SINCE BEEN RESOLVED (see below): `beit_sahwan_breach (passive control)` returned
  VICTORY where its own comment demands DEFEAT, and `beit_sahwan_3_clearance` returned
  DEFEAT. Neither was a tunnel-era regression — checking out `066445f` (main before any tunnel code) and
  running the harness there reproduces both failures byte-identically, so the crash
  merely hid `beit_sahwan_3_clearance` for about two days, no more.
  Both are now fixed. The clearance mission lost 55 of
  its 61 points to eleven deductions for firing into the clinic -- 107 rounds of the
  Namers' `cannon_30`, which arms the zone penalty at `collateral_risk >= 0.3` where
  rifles, `coax_mg` and the Eitan's `rws_50` do not; the plan was careless, not the
  floor, and keeping the armour off the zone takes it to ROE 94. First Light's control
  did NOT fail because the mission had gone soft: scaling the waves from 36 attackers
  to 131 walked the passive run's survivors from 9 to 2 and no further while killing
  the scripted plan outright, because `survive_until` completes if anything is alive
  and sitting still is the correct answer to a siege. `3122340` had dropped
  `evac_settlements` -- the only objective requiring anyone to leave the compound --
  while leaving all eleven civilians on the map; restoring it as a primary
  (`checkEnd` reads only primaries, and `evacuate_before` is the one type that can
  reach 'failed') makes passivity lose again. **`playtest.ts` now exits 0, and it is
  wired into CI** — `pnpm playtest` in ci.yml's `gates` job since `c05de3c`. It runs
  in **4.07s** measured (no browser, no GPU, no Blender), which is why it sits on
  every push next to `pnpm balance` rather than behind a schedule the way
  golden-diff does. Not in `pnpm test`: it is a CLI harness that prints a table, not
  a vitest spec, and `pnpm test` (18.65s, 2012 specs) stays the fast inner loop.
  **What it can and cannot fail on, measured 2026-09-01.** Falsified by hand:
  setting `beit_sahwan_3_clearance`'s `take_town` hold from 20s to 1500s pushes the
  run past the harness's own 20-minute ceiling and it goes red —
  `beit_sahwan_3_clearance: FAILED — expected VICTORY, got ONGOING`, exit 1.
  But the same break at 900s took that mission from **2.5 min to 17.2 min — a 7x
  blowout, 3.4x its own `target_minutes` — and the gate stayed GREEN, exit 0.**
  The assertion is `result === expect` and nothing else, so the only duration
  failure it can express is "did not finish inside 20 minutes". A mission can
  degrade several-fold and CI will not notice. Closing that means giving the
  harness a per-mission duration ceiling, which is a design call, not a tidy-up —
  see the next bullet for why tying it to `target_minutes` is the wrong shape.
- A scripted plan in `playtest.ts` proves a mission WINNABLE; it does not measure how
  long the mission takes. The plans are optimal-play proofs, and tuning enemy volume
  until the scripted clock reaches `target_minutes` would produce missions no real
  player could finish. **Re-measured across all thirteen plans (GH-84, 2026-09-01);
  the "eight of nine, band 0.51–1.00" reading this bullet used to carry is retired.**
  It predated Tel Marum and had silently omitted `beit_sahwan_3_clearance`, and worse,
  it pooled two populations that do not belong in one band. What separates them is
  whether a primary makes the player ENDURE a clock. A `hold_for` or `survive_until`
  `seconds` is a floor on mission length; a `raze`, `collapse` or `evacuate_before`
  `seconds` is the opposite — a deadline, a ceiling on the allowance — so it does not
  set length and does not belong in this split.
  The seven missions with an endure-clock all land **0.70–1.00 of target, and 0.0–2.1
  minutes above their own floor**: `beit_sahwan_breach` 1.00 (floor 5.0, plan +0.0),
  `wadi_halam_3_counterraid` 0.93 (+0.6), `beit_sahwan_2_foothold` 0.87 (+1.1),
  `wadi_halam_5_depot` 0.87 (+2.1, the extra being the raze that precedes the hold),
  `wadi_halam_1_fords` 0.80 (+0.8), `wadi_halam_2_laager` 0.80 (+0.6),
  `tel_marum_2_foothold` 0.70 (+0.2). The plan does not beat these missions quickly —
  it runs the timer out and leaves. That is why the ratio is informative there, and why
  it tracks a real player: it is the same clock for both.
  The other six have no endure-clock and scatter 0.10–0.87 — `wadi_halam_4_village`
  0.87, `tel_marum_3_clearance` 0.50, `beit_sahwan_3_clearance` 0.36,
  `beit_sahwan_4_subterranean` 0.22, `tel_marum_1_recon` 0.13, `beit_sahwan_1_recon`
  0.10 — because each plan *hardcodes the answer the mission is about*. The recon plans
  fly the drone to the six positions by waypoint; IV drives a `mark_tunnel` carrier
  straight at a route it is not supposed to know; the clearance plans go straight to the
  HVT. The plan holds perfect information and the player does not, so its clock is a
  floor with the puzzle removed. **A low ratio on one of these six is not evidence of
  anything and must not be tuned against.** `wadi_halam_4_village` at 0.87 is why the
  scatter is scatter and not a second band: a search mission is not *required* to read
  low, so a high one is not reassurance either.
  What has NOT changed: stepping the real runtime and reading
  `runtime.result` and `objectiveList` is still the only instrument that measures
  duration at all, there is still nothing headless between the optimal-play proof and
  a fully-passive walk, and therefore **no real-player duration has ever been measured
  for any mission** — every `target_minutes` in the tree is design intent that survived
  a floor check, including Beit Sahwan IV's 6.
  One consequence of the 5–7 ceiling worth knowing before authoring: `target_minutes`
  cannot express a sequential-timer worst case. `wadi_halam_5_depot` gates `raze` at
  300s and then holds for 240s *after* it comes down — a 9-minute mechanical ceiling
  behind a declaration of 7, which the optimal plan reaches in 6.1 only because it
  razes fast.
- The elevation milestone (E1–E3) closed with three things left inert, dormant only
  because every shipped map was flat and each first reachable the moment a map
  authored relief. **`raySmoke` is no longer one of them.** A screen is now a column
  `SMOKE_RISE` levels tall standing on its OWN tile's ground, tested with `losRay`'s
  own cross-multiplied comparison, so a line passing above the plume is not obscured
  by it: on Tel Marum an observer on the western shoulder (20,16) now sees the bench
  at (24,26) across five tiles of screen his sight line clears by more than a level,
  while the same screen still stops a line drawn along the basin floor dead. Two
  things about it are load-bearing and neither is obvious. **`SMOKE_RISE` (2) MUST
  stay strictly above `EYE_HEIGHT`**, the mirror of the `EYE_HEIGHT < BLOCK_RISE`
  coupling: on flat ground the sight line sits at exactly `EYE_HEIGHT` above every
  tile, so a shorter plume never reaches it and smoke goes inert on every shipped map
  at once (falsified by hand — at 1, four pre-existing flat-ground smoke tests go
  red). And it equals `BLOCK_RISE` deliberately, so the authoring rule is the terrain
  sentence again: **smoke obscures what a building obscures, from the same places**,
  and high ground that sees over the rooftops sees over the smoke. Taller would make
  smoke a better wall than a wall. The fix is bit-identical on flat ground by
  construction, which is why **no golden hash moved and neither did `pnpm balance` or
  `playtest.ts`** — and that silence is not a blind test: the golden replay lays no
  smoke, and **no shipped mission or playtest plan lays any either**, since `smoke` is
  reachable only from the player's UI. The replay guard for smoke over non-uniform
  relief therefore lives in `smoke.test.ts`, not in `determinism.test.ts`. One clause
  of the old bullet was never reproducible and is retired rather than fixed: “smoke
  sitting on a peak will not blanket the valley below” described nothing the code did
  — the height-blind version was uniformly OVER-permissive, so every behavioural
  change from this fix is smoke ceasing to block, never starting to. `raySmoke` still
  runs before `losRay`'s loop, and that is harmless: a ray terrain blocks returns -1
  either way. Pinned by `packages/sim/src/smoke.test.ts` (`smoke and elevation`) and
  `tools/src/tel_marum_smoke.test.ts`, which also pins the map elevations it argues
  from — (24,26) reads as plain basin by eye and is two levels up.
  **The other two were walked on 2026-09-01 and neither survives as written.** Both
  were Pixi-era statements that stopped being true when three became the default,
  and both now read as live bugs to anyone who trusts this file.
  **"VFX are not lifted to terrain height", and the wreck/tracer sorting gap it
  opened, are Pixi-only.** In `three` all four layers — trails, fx, fx-above and
  wrecks — are already lifted to their own tile's ground height. The artifact was
  staged deliberately at Tel Marum's steepest drop and behind its only building,
  photographed reproducing blatantly in Pixi, and photographed drawing correctly in
  three at the identical staging. Nothing was changed because there was nothing to
  change. The Pixi half stays broken on purpose: `renderer.ts` is frozen, VFX owe it
  no parity since 2026-08-30, and `renderer.ts:2599`'s flat `isoY(...)-4` is the
  legacy path. The warning that a partial fix would be worse than none — `wreckLayer`
  sprites (`addWreck`) carry no `zIndex` at all and would sort behind every band on
  the map, not merely their own tile's — still applies to anyone who reaches for
  Pixi, and is the reason not to.
  **"Extruded terrain cannot occlude units" is backwards for `three`.** It occludes
  them through the real depth buffer, decisively — up to 85% of an infantryman.
  More usefully: the occluded-unit silhouette (band 6) **already covers terrain,
  unmodified**. It fires on every terrain-occluded tile above its ~10% threshold and
  on none of the 126 unoccluded tiles sampled. There is nothing to extend, and a
  design that set out to extend it would be rebuilding something that works.
  Picking mid-slope was separately measured working in both backends. E3's cut scope
  is the only part of that original list still standing, and slope cost has since
  shipped (T1-A).
  **One real defect came out of that walk. It is fixed, and the fix is worth
  knowing about because it could not be one number.** A unit standing in Tel Marum's
  boulder field was 48–79% hidden by the boulder decor and got no silhouette at all
  — infantry taking cover in boulders became genuinely invisible, which is worse
  than the building case the feature was built for. The cause was the depth bias,
  as reported (draw order was tested and falsified). The bias, a constant 0.75
  world units, had been sized for the FILL era's billboard artefact and never
  resized: it is larger than the **0.612** of depth a single-axis neighbouring tile
  is worth, so it swallowed every occluder nearer than about a tile and a quarter —
  a boulder sharing a unit's own tile included. Across `tel_marum`'s 1550 open
  tiles, **ten** hid 25–73% of a rifleman and outlined none of it; all ten were in
  the boulder field.
  **The two silhouette paths now carry different biases, deliberately.** The MESH
  path's artefact is the outline ring, whose size is the outline's own width — a
  fixed number of SCREEN pixels, so 7x wider in world units at zoom 0.35 than at
  2.5. Its bias is therefore `2.5 x silhouetteOutlineWorldWidth(zoom)`, retuned per
  frame; the multiple is 2 by derivation (this camera's 30-degree pitch means a ring
  fragment `d` below the feet sits over ground `2d` nearer) plus a measured margin.
  The BILLBOARD path's artefact is the ground-clipped QUAD, fixed in world units
  because a sprite's world size does not change with zoom, so it keeps the 0.75
  constant — applying the mesh number there was measured to grow 5–126 false pixels
  at a rifleman's feet. Only the GLSL is shared. Nothing is lost by the split:
  **`&nomesh` draws no decor at all**, so the boulder case cannot arise on it.
  One pre-existing defect was found while proving that and is NOT fixed: on
  `&nomesh` at the shipped 0.75, a billboard `mbt_lavi` on open flat ground already
  draws 75–432 false silhouette pixels along its hull base, at every zoom.
  Photographed. Clearing it needs ~1.1 world units, which would swallow real
  occluders a tile and a half out — a worse trade, so it is recorded rather than
  traded blind. See `.superpowers/queue/boulder-silhouette-report.md`.
- Tel Marum's narrow saddle is **closed to armour and still the cheaper road on foot**, and
  what priced the armour half was terrain rather than fire. The corridor at x=10-11, y=12-17 is a boulder field (`b`) now, with a
  small scree apron on the valley floor at its mouth (x=9-12, y=18): open ground on foot, a
  wall to anything wheeled or tracked. Measured through the real `FlowField` on the shipped
  map, crossing the wall there costs a rifleman **8 tiles** before and after, and a vehicle
  **8 -> 28**, because the only remaining gap in the wall is the guarded wide saddle. The
  whole flank route start line -> corridor -> battery is **48 tiles on foot** against 38
  through the pass, and **no route at all** for armour. The shortest route to the battery is
  **38 for both domains, unchanged** -- the mission's own axis was deliberately not touched,
  and if that number ever moves the field has leaked onto it. Committing the whole force to
  one route is therefore structurally impossible: the split the design always wanted is
  enforced by the ground instead of hoped for.
  Two figures this bullet used to carry were wrong and are corrected. The flank is **+10
  tiles (38 vs 48)**, not +9 (38 vs 47) -- measured five ways, every waypoint through the
  corridor gives 48; `tel_marum_3_clearance`'s briefing said nine and now says ten. And
  **no sight fact moved**, because `b` is deliberately not sight-blocking: every `sees()`
  assertion in `tools/src/tel_marum_doctrine.test.ts` passed unchanged when the field
  landed. `pnpm balance`, the golden determinism hash and all nineteen `playtest.ts` lines
  are identical before and after -- no shipped plan ever drove a vehicle up the corridor
  (mission I's drone is `domain: air` and flies over boulders), so the field costs the
  optimal-play proofs nothing and closes an exploit they never used.
  The fire-based half is now settled, and not in the direction this bullet used to point.
  Measured over ten seeds with the armour's orders held byte-identical in both arms and only
  the foot's route changed (`tools/src/backtest/saddle-price.ts`): through the pass costs
  **1.20 losses a run**, up the corridor **0.30**, on the same 3.54-minute clock. The pass
  kills the men -- seven of those twelve deaths are the `mortar_team` -- and the corridor
  kills nobody on foot at all; its three deaths over ten seeds are every one of them armour,
  lost in the pass fight the foot walked away from.
  The authored answer -- let the Grad at `battery_position` charge for it, since it reaches
  the corridor at 17 tiles and `rocket` is in `INDIRECT_MASK` (`sim.ts:244`) so it needs no
  sight of its own, while `selectTarget` (`sim.ts:2887`) gates each shot on **per-side**
  identification -- still does not work, and **`selectTarget` is not why.** That was the
  recorded leading explanation and it is now disproved: hand the Sarim side contact and the
  battery shells the man in the corridor on its very next reload, three rounds in two
  minutes, every time. Its rule is `hurts` first and then nearest, so a flanker is not
  immune, only LAST IN THE QUEUE -- with a decoy at [24,13] the battery spends three rockets
  killing that and turns west on the fourth. Both halves are pinned as behaviour, not prose,
  in `tel_marum_doctrine.test.ts`.
  What actually fails is the observer, and it is geometry rather than tuning. **Every post
  that can see the corridor stands inside the corridor's own weapons.** The only sightlines
  into a straight slot in a rock wall run along its axis, so distance along that axis IS the
  standoff: at `sarim_rifles`' sight 9 the best standoff for seeing even ONE of the twelve
  corridor tiles is 9.0 and for ten of them 4.0, against an 8-tile rifle and `at_team`'s
  9-tile Spike. `tm_spotter_narrow` at [12,4] sees **2 of 12** -- the north exit row and
  nothing below it, exactly as its briefing says -- and moving it to the best sight-9 post
  ([11,8], 10 of 12) changes the mission by **nothing at all**: 0.30 either way, because the
  flank shoots it off its hill at 48 s instead of 59 s. Nor does a longer lens help:
  `manpad_team` is the roster's best standing eye at sight 12 and still buys only 9.2 tiles
  of standoff for half the corridor, and every observer variant measured -- moved rifleman,
  manpad at 6/12, manpad seeing all twelve -- returns **0.30, unchanged**. The ceiling shows
  the idea is sound and merely unreachable: unkillable permanent contact on the corridor
  takes it to **1.20, exactly level with the pass**, and turns the corridor's dead into
  infantry. The binding constraint is `grad_122`'s `rof_per_min: 2` -- one round per 30 s --
  against a battery dead by ~155 s in every plan that presses the pass. Nothing that can
  watch a two-tile defile lives the ninety seconds three rounds would take. **So do not add
  a spotter**, and do not read the shipped one as broken content: it buys the Grad exactly
  the one round at the corridor exit that the briefing promises. Closing the rest needs
  something that SHOOTS the corridor rather than something that watches it, which is a
  design call and not a bug. A trigger cannot do it either -- the schema's `do` vocabulary
  is commit/withdraw_to/spawn/reinforce/dismount, with no reveal, so it would take
  `mission.ts`.
  Two sight facts stand unchanged: **nothing north of the wall can see the hollow** -- 841
  open tiles see [24,29] and not one is at y <= 17, so the hollow is dead ground twice over
  -- and the corridor is **not** watchable from its own mouth at [8,9]. Both were drawn
  wrong by eye first. `tools/src/tel_marum_doctrine.test.ts` pins all of it, the per-domain
  routes included, each one paired against the same map with the boulders turned back into
  '.' so that "the vehicle went round" cannot pass for the wrong reason.
  Three traps for anyone re-running this. Isolating a unit by removing its garrison entry
  corrupts every later unit's RNG stream -- kill it at t=0 with `debugKill` (`applyDamage`
  is private), or mutate the entry in place at the same array index, which leaves entity ids
  and streams untouched. Rerouting only `mbt_lavi` or only `ifv_namer` reproduces the wide
  result exactly, because either wins the pass fight alone. And the earlier "wide 3.5 /
  narrow 5.2 / narrow-with-the-spotter-dead 5.1" reading is retired: those runs held the
  flank at a waypoint until t=130 s, some 90 s later than a direct order puts it in the
  corridor, so they measured the halt and not the route.
