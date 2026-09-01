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
- **Overlays scale with zoom, and that is faithful.** Pixi scales its whole
  `world` container by `camera.zoom` and the overlay layer is a child of it, so
  HP bars look enormous zoomed in on BOTH backends. Verified side by side. Not a
  bug; changing it is a decision affecting both.
- **`preserveDrawingBuffer` must stay off** in shipping code. Canvas readback
  therefore returns black — that is correct, not a broken renderer.
- **A golden-image diff between the two backends exists**:
  `tools/src/golden-diff/`. `npx tsx tools/src/golden-diff/diff.ts <pixi.png>
  <three.png> <outDir>`. First clean reading was **0.128% of pixels, entirely
  edge-shaped** (antialiasing is off in three by design), no solid-interior
  mismatch. `expected-differences.ts` catalogues eight DELIBERATE divergences so
  they do not read as failures — the largest being `structureLastAlpha`, where
  **every building destruction differs** because Pixi's event ordering floors a
  combat kill's starting alpha to 0.55 and three does not.
  **It IS in CI** as of `9c76b7b` — `.github/workflows/golden-diff.yml`, its own
  workflow rather than a `gates` step, on a nightly schedule plus
  `workflow_dispatch` plus an opt-in `golden-diff` PR label. Playwright drives a
  headless Chromium (`tools/src/ci/golden-diff-gate.ts`); four scenarios now
  exist (`quiet`, `open-ground`, `vehicle`, `combat`), each with its own entry in
  `SCENARIO_BUDGETS`, and a scenario with no budget throws rather than passing
  silently.
  **The `quiet` scenario is RED and has been silently so** — measured 2026-09-01
  at HEAD `b7a2465`, twice, bit-identical: `diffPixelPct 2.564%` against a
  `1.3%` budget (`meanAbsChannelDelta 3.005` of 10, well inside). It is not
  antialiasing fringe: the diff has large SOLID-INTERIOR regions where three
  draws terracotta mesh buildings and detailed decor that Pixi has no
  counterpart for at all. The 1.3% budget was calibrated (`0.128%` GPU /
  `0.143%` headless) when three drew none of that. Because the workflow only
  runs nightly or on a label, nothing surfaced it. **Do not widen the budget to
  clear this** — that is the failure mode the gate's own header forbids. It
  needs a decision first: the project has already abandoned cross-backend parity
  for VFX and mesh units have no Pixi path at all, so the honest options are a
  re-calibration against a fresh measurement, a new `EXPECTED_DIFFERENCES` entry
  for three-only building/decor geometry (the catalogue has none for it), or
  retiring the quiet scenario.
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
- **A GLB carries zero materials.** Colour is applied at runtime from a ramp
  SLICE indexed by normal. Do not port `render_team.py`'s `ROLE_PALETTE` or
  `LIT_GAIN` into a mesh export — that table compensates for a multiply-style
  light and a toon LUT indexes instead.
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
  The other two are unchanged. E1 left three relief gaps
  of its own: VFX are not lifted to terrain height, extruded terrain cannot occlude
  units, and picking is untested mid-slope. And slope movement cost and downhill cover
  were both deliberately cut from E3's scope — slope cost in particular touches
  `FlowField.compute`, the pathing core every unit uses every tick, which is why it
  wants its own slice rather than a tuck-in. The next map to author relief — Tel
  Marum — is the first thing that meets all of these, and will read as broken rather
  than as known unless this bullet is read first. Moving raised terrain into
  `spriteLayer` (so it can occlude units) opened a new gap the same way: `trailG`,
  `fxG`, and `wreckLayer` still sit below `spriteLayer` unconditionally, so a wreck
  or tracer on ground in front of a ridge — geometry that should cover the ridge —
  is covered by it instead. Deliberately unfixed: it is cosmetic only, with no
  effect on sim truth or fog. It is no longer unreachable — Tel Marum shipped three
  missions (`tel_marum_1_recon`, `tel_marum_2_foothold`, `tel_marum_3_clearance`) and
  relief is fought over in them, not merely walked: `tel_marum_2_foothold`'s
  `approach` zone [21,22,7,5] sits astride the elevation-2 band at rows 25–26, and a
  browser walk of that mission with the task force standing in the zone showed the
  Grad's indirect fire landing there — dust-cloud impacts and a visible tracer inside
  the zone's outline — with no occlusion glitch in what was on screen at the time.
  That is not proof the sorting gap is fixed or absent — it means the condition this
  bullet describes (a wreck or tracer in front of a ridge, from the camera angles and
  moments actually checked) was not caught in the act, not that it cannot happen. The
  gap is unchanged, and so is its fix: depth-sorting wrecks and VFX against terrain,
  which is the same already-deferred "VFX are not lifted to terrain height" gap above.
  A partial fix would be worse than none, since `wreckLayer` sprites (`addWreck`,
  `renderer.ts`) carry no `zIndex` at all and would sort behind every band on the map,
  not merely their own tile's, if moved into `spriteLayer` naively.
- Tel Marum's narrow saddle is **no longer free**, and what finally priced it was terrain
  rather than fire. The corridor at x=10-11, y=12-17 is a boulder field (`b`) now, with a
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
  What remains true and is worth keeping. The obvious fire-based fix -- let the Grad at
  `battery_position` charge for the flank, since it reaches the corridor at 17 tiles and
  `rocket` is in `INDIRECT_MASK` (`sim.ts:223`) so it needs no sight of its own, while
  `sim.ts:2073` gates each shot on **per-side** identification -- was authored into
  `tel_marum_3_clearance` with a spotter at [12,4], and measured. **It does not work.** Nor
  could it have: that spotter is `sarim_rifles`, sight 9, not the 48-sight observer the
  doctrine test uses to walk the terrain, and the corridor tiles sit 9.2 to 13.2 tiles away,
  so it sees the north exit row (11,12) and nothing below it. Three runs: wide 3.5 min /
  roster 9, narrow with the spotter alive 5.2 / 6, narrow with the spotter killed at t=0
  5.1 / 6 -- the last two are the same run. Target-selection preference remains the leading
  explanation and an unproven one; anyone attempting it must first put eyes on the corridor
  that can actually see it, then re-measure before touching `selectTarget`. Two sight facts
  stand: **nothing north of the wall can see the hollow** -- 841 open tiles see [24,29] and
  not one is at y <= 17, so the hollow is dead ground twice over -- and the corridor is
  **not** watchable from its own mouth at [8,9]. Both were drawn wrong by eye first.
  `tools/src/tel_marum_doctrine.test.ts` pins all of it, the per-domain routes included,
  each one paired against the same map with the boulders turned back into '.' so that "the
  vehicle went round" cannot pass for the wrong reason.
  Two traps for anyone re-running this: isolating a unit by removing its garrison entry
  corrupts every later unit's RNG stream -- kill it at t=0 via `applyDamage` instead; and
  rerouting only `mbt_lavi` or only `ifv_namer` reproduces the wide result exactly,
  because either wins the pass fight alone.
