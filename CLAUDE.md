# CLAUDE.md

Working instructions for this repository. Read `docs/GDD.md` for *what the game is*; this file is *how to work here*.

---

## Project

**Roaring Lions** — open-source dimetric RTS in TypeScript. Deterministic simulation, data-driven content, realistic combat resolution.

Two renderer backends live behind one interface. **PixiJS is still the default and
still ships**; a three.js backend runs under `?renderer=three` and is mid-migration.
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

**A mission:** JSON in `data/missions/`, validated against `mission.schema.json`. Must declare its ledger contract — `requires` and `produces`. Target 5–7 minutes of play. The schema's `maximum` is still 25 rather than 7: the four Beit Sahwan missions authored against the old 12–20 target are being brought into range one at a time, and the ceiling tightens once they are.

**A VFX emitter:** JSON in `data/vfx/`, validated against `vfx_emitter.schema.json`. Palette keys only, never raw hex.

**UI:** colour comes from `data/palette.json` like everything else. A Vite
plugin publishes it as `--rl-*` custom properties; `packages/app/src/ui/theme.css`
is the only file allowed to name one, mapping them to semantic tokens (`--ink`,
`--bad`, `--band-mission`). Everything else uses the semantic names or the
`.rl-good`/`.rl-bad` classes. `pnpm validate:ui` rejects a hex or `rgba()`
literal anywhere in UI source, with no allowlist — use `color-mix()` for
translucency. Fonts are self-hosted in `assets/fonts/`; never a CDN.

**A map:** JSON in `data/maps/`, validated against `map.schema.json`. A character grid (`.` open, `1`–`3` cover, `#` building, `^` rock ridge) plus named markers and zones — authorable in a text editor. The loader is `parseMap` in `@lions/data`, and `applyTerrain(map, sim)` is the one way its mechanical layer reaches a `Sim` — use it rather than writing a fourth cover loop. `^` is the only blocked tile that is not a building: impassable, sight-blocking, and with no HP, garrison or ROE penalty. An optional `elevation` grid gives each tile a height 0–9, one digit per tile, same dimensions as `rows`; absent means flat. It is orthogonal to the terrain symbol on purpose — a symbol table can express ridges but not valleys. E1 stores and draws it at 10 px per level; line of sight reads it — high ground sees over lower obstacles, and every blocking tile, rock or building, stands two levels above its own ground; a low-profile obstacle like a fence never blocks sight at all, but the ground it stands on still does — while sight range and pathing still do not. Terrain needs two levels or more to obscure ground troops, since a one-level rise sits exactly at eye level, and nothing sees further for being higher — elevation affects what you can see over, never how far.

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
  subsystem is not buried under three others: `&roe` supplies flagged ground (the
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

Behind `?renderer=three`. Pixi remains the default. The seam is
`packages/render/src/api.ts`, and `main.ts` holds a `Renderer`, never a concrete
backend — so the compiler, not a grep, keeps `app` off backend-only members.

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
  `renderOrder`.** Read it before setting one. Bands are: 0 hull/structures,
  1 turret, 1.5 badge numeral, 2 FX, 3 FX-above, 4 overlays, 5-9 reserved,
  10 fog. Overlays sit BELOW fog because Pixi's `unitsG` is added to `world`
  before `fogG`; an earlier version of that file said the opposite, citing Pixi
  identifiers that do not exist.
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
  Two caveats, both load-bearing: it is **not in CI** (needs Playwright, the same
  gap `playtest.ts` has), and it has **never diffed combat**, so five of the
  eight entries and the whole VFX/collapse surface are documented but not
  demonstrated.
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

Some unit types draw as rigged 3D meshes instead of billboards.
`?sandbox=<map>&renderer=three&mesh` turns it on for `inf_squad`; the flag is
backend-only and warns by name on Pixi. Pipeline: `tools/units/kit.py` (geometry)
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
  `validate_assets.py`'s IMPORTED palette/silhouette/fill checks. 29/29 pass;
  closest call 0.8669 against the 0.88 limit. Silhouette IoU compares each
  mesh against every other mesh and every other unit's sprite, EXCLUDING its
  own retired sprite -- a mesh is supposed to look like the unit it replaces.
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

- Detection is O(N²) pairs per tick — stagger evaluation before unit counts pass ~150.
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
- Mesh units have no `down`/`wreck`/`work` clips, so a mesh unit that dies has no
  death state. Not an oversight: posing the standing rig into prone was attempted
  and rendered, and it folds into a self-intersecting heap at the rotation prone
  requires. Those clips want separate geometry, the way `teams.py` already treats
  them. Invisible until something actually fights.
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
- A civilian who boards a transport and whose transport then dies before reaching the refuge is stranded forever: `stepCivilians` (`mission.ts:1112`) latches `civFled` at `:1138` — before boarding is attempted — and only queues the walk-to-refuge order on the non-boarded branch, so a civilian dropped by a dead carrier is never re-evaluated and can never satisfy `evacuate_before`. Silent — no error, the objective just never completes. Avoidable at the mission-authoring/plan level today (escort civilians with something nothing on the relevant roster can kill), but the underlying latch is wrong.
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
  mission below it with it. The gate is a manual `npx tsx` script wired into neither
  `pnpm test` nor CI, which is why "all gates green" could be said truthfully about
  the tunnel subsystem while this one was red. Two consequences outlived the fix and have
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
  reach 'failed') makes passivity lose again. **`playtest.ts` now exits 0.** It is
  still wired into neither `pnpm test` nor CI, so it still has to be run by hand --
  which is the part of this debt that has not been paid.
- A scripted plan in `playtest.ts` proves a mission WINNABLE; it does not measure how
  long the mission takes. The plans are optimal-play proofs, and tuning enemy volume
  until the scripted clock reaches `target_minutes` would produce missions no real
  player could finish. Measured against every mission's declared `target_minutes`,
  eight of nine plans land close to it — between 0.51 and 1.00 of target — and only
  one is a real outlier: `beit_sahwan_1_recon` declares 10 and its plan wins in 0.7
  (ratio 0.07). `beit_sahwan_4_subterranean` declares 6 and its plan wins in 1.1
  (ratio 0.18) — the second-largest gap, and the only *combat* mission where the
  scripted clock and the target diverge this far; the other seven combat missions
  (`beit_sahwan_breach` 1.00, `wadi_halam_5_depot` 0.98, `wadi_halam_3_counterraid`
  0.93, `wadi_halam_4_village` 0.87, `wadi_halam_1_fords` 0.80, `wadi_halam_2_laager`
  0.80, `beit_sahwan_2_foothold` 0.51) all sit inside that 0.51–1.00 band.
  `beit_sahwan_1_recon` is a recon mission, not a fight, and behaves differently by
  nature. #84's method — stepping the real runtime and reading `runtime.result` and
  `objectiveList` — remains the only instrument that measures duration, and there is
  nothing headless between the optimal-play proof and a fully-passive walk. Beit
  Sahwan IV's own `target_minutes: 6` stands unverified for this reason and belongs
  to #84's set of unresolved predecessors.
- The elevation milestone (E1–E3) closes with three things left inert, every one of
  them dormant only because every shipped map is flat and every one of them first
  reachable the moment a map authors relief. `raySmoke` (`packages/sim/src/sim.ts:1771`)
  never reads elevation, and `losRay` calls it at `:1816` before any height reasoning
  runs — so smoke pooled in a valley will block a ray passing six levels above it, and
  smoke sitting on a peak will not blanket the valley below. E1 left three relief gaps
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
  effect on sim truth or fog; it is unreachable today because Tel Marum has no
  missions and nothing fights in front of relief yet; and a correct fix means
  depth-sorting wrecks and VFX against terrain, which is the same already-deferred
  "VFX are not lifted to terrain height" gap above — a partial fix would be worse
  than none, since `wreckLayer` sprites (`addWreck`, `renderer.ts`) carry no
  `zIndex` at all and would sort behind every band on the map, not merely their
  own tile's, if moved into `spriteLayer` naively.
- Tel Marum's two saddles are supposed to be unequal — narrow costs time, wide costs vehicles —
  but driving the real `Sim` from all eighteen overwatch tiles found the narrow saddle costs
  neither: a hollow → west flank → narrow saddle → battery route never crosses a tile either
  overwatch pocket can both see and reach at the `atgm_cell`'s 10-tile Kornet range, for a total
  cost of +9 tiles (38 vs 47). Not a terrain bug — the ground is correct and stays as authored —
  but the doctrine never fires until a Tel Marum mission charges for that route some other way:
  a reinforcement wave, an objective timer, or a west-flank spotter.
