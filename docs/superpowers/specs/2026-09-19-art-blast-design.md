# The blast — vehicle death and mortar impact (WP-A1.2, GH-172) — Design

> Art lane, Phase 1 · Weight, sub-project 2. Branch `feat/art-blast`, worktree
> `.claude/worktrees/ep-a12`, base `main@1e584bfa`.
>
> Companion plan: `docs/superpowers/plans/2026-09-19-art-blast.md`.

---

## What this is

The art-direction review's Phase 1 · Weight carries one bullet for this package, and
it is the whole and only description of the sequence:

> "one Meshy wreck per vehicle (same silhouette, burnt, turret displaced), the blast
> the lead asked for as a sequence (**flash, additive fireball, 20 s smoke column,
> scorch decal, persistent wreck**) with the swap hidden under the collapse shroud
> that already exists."

Adjacent, from the same page: "a transient point light per muzzle flash and
explosion, both free once the scene is lit", and "wire `screen_shake` and
`hit_stop_ms`, which every emitter already declares."

The lead accepted the page's proposal at G0 #14 with two conditions that shape
everything below: **"mortar shares at its own power; judge on 10 s of motion."**
So this is not only a vehicle-death package — an arcing round's impact runs the same
sequence, scaled by the number the renderer already carries for it
(`SHELL_PROFILES[kind].impactPower`) — and the acceptance instrument is a
ten-second motion capture, not a still.

The page never uses the label "Phase 1b", never names `impactPower`, and names no
timing but the 20 s. The tracking table calls this row **Open**, "Sub-project 2, next
in the queue"; vehicle wheel/track animation (sub-project 3) waits on it.

---

## What exists today

Every line here was read at `main@1e584bfa` in this worktree. The research brief is
research; these are the citations that survived checking, and in four places the code
is further along or differently shaped than the issue body implies.

**Vehicle death is already fixed, and the CLAUDE.md defect bullet describing a
three-art-style death is stale.** `packages/render/src/three/units/mesh-vehicle-death.ts`
runs a real sequence since 2026-09-15: `beginVehicleDeath` (`:142`) fades and sinks
for `MESH_DEATH_SECONDS` (0.4 s, `units/mesh-death.ts:158`); `stepVehicleDeath`
(`:193`) then reveals the GLB's own `death_root`, plays `wreck` once
(`LoopOnce` + `clampWhenFinished`), hides every live top-level node and hands back a
persistent `MeshWreck` (capped at `MAX_MESH_WRECKS = 256`, `mesh-death.ts:164`).
`ThreeRenderer.addWreck` (`:5638`) steps aside for exactly `hasWreck === true`
(`:5647`) and no wider — the comment at `:5641` records that widening it to every
`vehicleMeshTemplates` entry deletes the sprite-wreck fallback. **The persistent wreck
the page asks for ships.**

**A fireball and a smoke column already fire on every vehicle kill.** The `destroyed`
branch of `ThreeRenderer.onEvents` (`ThreeRenderer.ts:2749-2818`) computes
`isVehicleKill = !deadType.isSoft || trackKindFor(deadType.id) !== null` and calls
`explosionBursts.spawn(...)` then `smokePlumes.spawn(...)` directly, sized by
`explosionBurstPowerFromMaxHp(deadType.hp)`. This path is independent of the death
sequence above and of any authored emitter — **no light, no shake, no hit-stop, no
shroud, no scorch.**

**A pooled `PointLight` system already exists and only the muzzle flash calls it.**
`packages/render/src/three/flash-light.ts`: `FlashLightManager`, `FLASH_CAPACITY = 8`
(`:18`), lights permanently in the scene at intensity 0 because a changing light COUNT
recompiles every material. `spawn(x, z, groundY, spec, colorHex)` (`:65`) reads an
emitter's `light` block verbatim. Its one caller is `ThreeRenderer.ts:3059-3068`, the
weapon-fire path. Nothing calls it for a collapse, an impact or a kill.

**The scene has been lit since 2026-09-14** (`docs/superpowers/specs/2026-09-14-lit-renderer-design.md`)
— one `DirectionalLight` sun plus a `HemisphereLight` (`three/lighting.ts:108,126`),
`MeshStandardMaterial`, ACES tone mapping, shadows. The page's "a PointLight added
anywhere would illuminate nothing" is a quotation of the OLD palette rule and is
stale on this branch.

**The collapse shroud is building-only.** `units/collapse-shroud.ts`:
`COLLAPSE_SHROUD_DURATION_MS = 2400` (`:272`), bloom over
`COLLAPSE_SHROUD_BLOOM_FRACTION = 0.08` (192 ms, `:278`), full density through
`COLLAPSE_SHROUD_HOLD_FRACTION = 0.35` (840 ms, `:286`),
`COLLAPSE_SHROUD_SWAP_DELAY_MS = 420` (`:330`), `COLLAPSE_SHROUD_CAPACITY = 6`
(`:138`). One call site: `ThreeRenderer.beginCollapseShroud` (`:6882-6901`), which
sizes the lattice from `buildingMeshBounds` (`:1064`, filled at `:4000` from the
STANDING template only) and sets `buildingMeshSwapHold` so the wreck reveal lands
inside the dense window. `VehicleMeshTemplate` (`units/mesh-vehicle.ts:141-203`)
carries `hasWreck` (`:193`) and no bounds; no `vehicleMeshBounds` map exists.

**`additive` already exists and is not GPU additive blending.**
`data/schemas/vfx_emitter.schema.json:254-258`, verbatim: *"NOT a GPU
additive/summing blend mode despite the name … true additive blending was tried and
rejected because it sums to colours no palette entry names."* The shipped behaviour
(`units/fx.ts`'s `createParticleMaterial`) makes such a layer write `vec4(vColor, 1.0)`
— an opaque hot core in the resolved palette colour. Bands 2.5 and 3.5 in
`units/render-order.ts` exist for it.

**One fully-authored blast emitter is orphaned.** `data/vfx/catastrophic_kill.json`
already declares `hit_stop_ms: 70`, `screen_shake: {amplitude_px: 9, duration_ms: 420,
falloff_tiles: 14}` and `light: {color: "vfx.fire", intensity: 3.5, radius_tiles: 7,
decay_ms: 500}` — every field this package is asked to "finally read". `catastrophic_kill`
is in the schema's `trigger` enum (`vfx_emitter.schema.json:19-41`) and
`EmitterSpec` already types all three fields (`packages/render/src/vfx/emitters.ts:54-56`).
Nothing dispatches it: `grep byName\(.catastrophic_kill` finds nothing, and
`units/explosion-burst.ts:11-36` is a comment written to explain exactly that.
**No schema change is needed anywhere in this package.**

**`shell_impact.json` gets a fireball and no column.** Its hot layer carries
`"additive": true, "mesh_burst": true`; it declares **no** `mesh_plume`, so a mortar
bomb today throws a 450 ms fireball, three authored particle layers, and nothing that
persists. `spawnShellImpactFx` (`ThreeRenderer.ts:5753`) routes it through
`spawnCollapseFx` (`:3283`) at `SHELL_PROFILES[kind].impactPower`
(`units/shells.ts`: `mortar` 0.3, `rocket` 0.45, `bolt`/`missile` 0), off the FRAME
clock (`shellHasLanded`, `:5721`), deliberately not off the sim's `impact` event.
`structure_collapse.json` already declares a fourth layer with `"mesh_plume": true`.

**Nothing draws a persistent ground decal.** The schema reserves the
`ground_decal` layer and a `persistent` flag (`vfx_emitter.schema.json:43-56`) and no
`.ts` reads either. The working precedent is `three/vehicle-tracks.ts`: a hand-built,
three-only, depth-tested ground mesh with its own ring buffer
(`TRACK_POOL_CAPACITY = 4096`, `:280`), fixed alpha (`TRACK_OPACITY = 0.35`, `:492`),
oldest-first eviction, one flat palette-colour `ShaderMaterial`
(`createTrackMaterial`, `:507`) and therefore no texture to clear an asset gate.

**Render-order bands** (`units/render-order.ts:36-50`, cite this file, not an older
CLAUDE.md copy): **-1** world/mesh buildings, **0** hull/structures, **1** turret,
**1.5** badge numeral, **2** FX, **2.5** FX additive, **3** FX-above, **3.5** FX-above
additive, **4** overlays, **5** smoke, **6** silhouette, 7–9 reserved, **10 retired**
(fog is a post pass since 2026-09-14).

**Motion capture already has a precedent, and the brief missed it.**
`tools/src/perf/death-captures.ts` is exactly the instrument this package needs,
built for the infantry-animation branch: the live renderer on a sandbox, the frame
loop frozen with `FREEZE_FRAME_LOOP_SCRIPT` (`tools/src/golden-diff/capture-protocol.ts`),
a subject killed with `sim.debugKill`, then `renderer.frame(1, FRAME_MS)` advanced by
hand and photographed at fixed `SAMPLE_SECONDS` — with `--label=before|after` and an
output root of `.superpowers/art-captures/<project>/<label>` plus a generated
`sheet.md`. It samples 0–1.5 s at zooms 1.0 and 2.5. **This is a copy-and-retarget,
not a new instrument.**

**The two clocks.** Everything this package adds runs on frame time.
`ThreeRenderer.frame(alpha, dtMs)` (`:2266`) is the single entry point and already
owns a frame-delta clamp (`frameDtMs` / `frameDtSeconds`, `:4400-4408`,
`FRAME_DT_CEILING_MS = 100`). `threeCamera()` (`:4386`) is the single place the shared
`Camera` becomes a `THREE.OrthographicCamera` (`camera.ts:91`).

---

## Direction

One sequence, dispatched from the two places a blast can originate, sharing every
piece:

```
kill / impact
  └─ flash            FlashLightManager.spawn   (exists; wired here)
  └─ fireball         ExplosionBurstManager     (exists; unchanged)
  └─ smoke column     SmokePlumeManager         (exists; 20 s window added)
  └─ scorch decal     ScorchDecalMesh           (new; vehicle-tracks.ts sibling)
  └─ shroud           CollapseShroudManager     (exists; vehicle bounds added)
  └─ shake / hit-stop BlastShake / hit-stop clamp (new; pure models)
  └─ persistent wreck MeshWreck                 (exists; untouched)
```

The vehicle half hangs the sequence on the existing `destroyed` branch. The mortar
half hangs it on `spawnShellImpactFx`, at `impactPower` — so a mortar bomb (0.3) gets
three-tenths of the light, three-tenths of the shake, a proportionally short hit-stop
and a smaller column, and a Grad rocket (0.45) gets nearly half. Direct fire
(`bolt`/`missile`, `impactPower` 0) reaches none of it, unchanged, because
`spawnShellImpactFx` returns early at `power <= 0` and bolts never reach it at all.

The authored numbers all come from one file, `data/vfx/catastrophic_kill.json`,
adopted as this sequence's emitter rather than copied into a second one.

---

## Decisions

Each records the reason, because a reason is what a later reader can check.

### The controller's rulings (binding)

**R-A — "additive fireball" is the existing on-palette `hotCore`, never GPU additive
blending.** Real `THREE.AdditiveBlending` was tried on this backend and rejected: two
overlapping `vfx.white_hot` particles at partial alpha sum to a colour no palette
entry names, and `#FFFFFF` is not in `data/palette.json`. The schema says so at
`vfx_emitter.schema.json:254-258` and `units/fx.ts` implements the replacement. The
page's wording ("additive blending") therefore reads as a request for something this
project closed deliberately; **this spec deviates from the page's literal wording and
delivers the `additive: true` hot core plus the new transient `PointLight`**, which is
what actually produces the perceptual brightness the bullet is asking for now that the
scene is lit. Reintroducing GPU additive is out of scope and would need its own G0.

**R-B — The blast dispatches through the EXISTING direct vehicle-kill path, and
`catastrophic_kill.json` is adopted rather than duplicated.** `packages/sim` is not
touched: the sim's `destroyed` event carries no catastrophic-vs-ordinary
classification and adding one would put a presentation distinction inside the tick,
against invariant 4. So the renderer keeps its own `isVehicleKill` predicate
(`ThreeRenderer.ts:2796`) and reads `emitterLibrary.byName('catastrophic_kill')` for
the authored numbers. The orphaned emitter becomes the live one — extended with the
two mesh flags it lacks (R-P), never re-authored beside a second file.

**R-C — No new wreck geometry.** The procedural charred wrecks that shipped
2026-09-15 (`pnpm wreck:meshes`, `tools/src/meshes/wreck-pass.ts`) are the persistent
wreck the page's sequence names. Per-vehicle authored damaged geometry ("same
silhouette, burnt, turret displaced") is Blender art-lane work for a later package
and is named in Out of scope.

**R-D — Frame clock for the impact fireball; hit-stop and shake are presentation
only.** `shellHasLanded` stays where it is and why it is (`ThreeRenderer.ts:5734-5757`):
the sim's `impact` resolves on a different clock and would put the fireball where the
bomb visibly is not. `hit_stop_ms` pauses INTERPOLATION in the render loop; it never
touches the 20 Hz tick, and the sim keeps ticking underneath it. `screen_shake` is a
camera offset applied at render time. Both numbers are read from the emitter JSON that
already declares them. Invariants 1 and 4 hold by construction: nothing here writes sim
state and nothing here is read by the sim.

**R-E — Before-captures first.** A still and ten seconds of motion at 2.5×, of a
vehicle death and of a mortar impact, captured with the cheapest instrument available
(a Playwright contact sheet of N frames; no video), stored git-ignored under
`.superpowers/art-captures/blast/<label>/` and attached to the PR description. The
after-set is the acceptance evidence and the lead judges on motion. The research
brief argued for a committed location instead, on the precedent of a lost
`.superpowers/` report; the controller's ruling stands and the mitigation is that the
harness writes a text `sheet.md` + `sheet.json` index whose NUMBERS (frame count,
sample times, zoom, tick, subject ids) are quoted in the task report and the PR body,
so the finding survives even if the PNGs do not.

**R-F — One `ThreeRenderer.ts` region.** Every renderer touch lands in a single task
and in three adjacent places: the `destroyed` branch (`:2749-2818`),
`spawnShellImpactFx` (`:5753-5758`), and the constructor/`frame()`/`dispose()` triple
every pooled manager already follows. `updateVehicleMeshes`' prune loop is not
touched beyond what `stepVehicleDeath` returns; `units/mesh-unit.ts` (infantry) is not
touched at all. Lane A's Tasks 15–16 (range rings, minimap albedo) then merge into
untouched regions.

**R-G — One visual bless is budgeted; `combat` reports only; bless from CI numbers.**
Never from the local darwin baseline, which has been stale since 2026-09-03. See R-L
for what was measured about whether the bless is actually needed.

**R-H — Scope is what is genuinely missing.** The light wired to the kill and impact
paths; the shake and hit-stop reads; the collapse shroud extended to vehicles; the
scorch-decal ring buffer; the smoke column to 20 s; mortar/Grad sharing at their own
`impactPower`; the captures and the harness. Everything in "What exists today" is
**not** re-implemented.

### Rulings taken while specifying

**R-I — The 20 s column needs absolute rise and fade windows, not a bigger
`durationMs`.** Measured: `SmokePlumeManager.spawn(x, y, z, yawTurns, power,
durationMs)` (`smoke-plume.ts:830`) already takes duration as a parameter, so 20 s
costs no constant change — but `step` (`:857`) computes `progress = ageMs / durationMs`
and every envelope is a FRACTION of it (`smokePlumeRiseEnvelope` `:399`,
`smokePlumeOpacity` `:422`, `smokePlumeSpread` `:440`). Passing `20_000` makes
`SMOKE_PLUME_RISE_FRACTION` (0.15) a **3.0 second** climb instead of 600 ms and
`SMOKE_PLUME_FADE_FRACTION` (0.35) a **7.0 second** fade — a column inflating in slow
motion, which is the same class of defect as the retracting plume that file's own
header photographed. So `spawn` gains optional `riseMs`/`fadeMs` and the three pure
envelope functions gain a fraction parameter defaulting to today's constant. Every
existing caller and every existing test is byte-identical by construction.

**R-J — Hit-stop is implemented inside `ThreeRenderer.frame()`, not in `main.ts`.**
The brief proposed the `main.ts`/`renderer.frame()` boundary. `packages/app/**` is the
shell programme's file by the boundary agreed on 2026-09-17
(`docs/superpowers/specs/2026-09-16-shell-upgrade-design.md:489-508`), and Lane A is
mid-flight on it. `frame(alpha, dtMs)` (`:2266`) is the one entry point and already
owns a frame-time clamp at exactly this boundary (`frameDtMs`, `:4400`), so the
hit-stop is a second clamp beside the first: hold the last `alpha`, pass `0` for
`dtMs` downstream, keep presenting frames. No `api.ts` change, no `main.ts` change,
no Pixi change. The sim keeps ticking in `main.ts` throughout, so on release a unit
resumes from current sim state — at 70 ms that is under a tenth of a tile of
catch-up at infantry speed, which the acceptance drive checks rather than assumes.

**R-K — Screen shake is applied in `threeCamera()` only, so `worldToScreen` never
shakes.** `updateDimetricCamera` (`camera.ts:91`) is fed `this.camera` — the object
`packages/app` owns and writes every frame for panning and edge-pan
(`main.ts:4132-4165`). Writing a shake into it would fight those writes and leak
presentation state back across the seam. `threeCamera()` (`ThreeRenderer.ts:4386`)
offsets a copy. The consequence is stated rather than discovered later: in-scene
overlays (band 4) shake with the world because they are scene objects, while
`worldToScreen` (`:3499`) and `screenToWorldThree` stay unshaken — so no DOM element
jitters, and a click during a shake lands on the tile the player aimed at.

**R-L — The golden visual gate cannot witness this package at all, and the bless R-G
budgets is budgeted but not expected.** Measured: `VEHICLE_SCENARIO`
(`capture-protocol.ts:416`) is `beit_sahwan_outskirts` at `targetTick: 140` with the
sandbox force parked and no orders — nothing dies and no indirect round lands, so
nothing this package draws appears in that frame. `COMBAT_SCENARIO` (`:444`) is the
only capture with real kills and wrecks, and it is `gated: false` with
`layerChecks: []` (`baseline.ts:863`) because its scene does not hold still between
two photographs. So: a red `vehicle` on this branch is a **defect** — a blast path
firing on a frame where nothing died — not drift, and must be found rather than
blessed. R-G's substance is kept unchanged: one bless budgeted, `combat` reported and
never voted, CI numbers only.

**R-M — Two new `DEBUG_LAYERS` names, exercised by the blast harness rather than by a
golden `layerChecks` entry.** `debug-layers.ts`'s own rule is that a layer resolving
to zero objects produces a zero pixel delta, which is a FAILING toggle check — so
adding `scorch` to a `layerChecks` list on a scenario that contains no blast would be
a permanent red. `DEBUG_LAYERS` gains `scorch` and `blast-light`; the blast harness
performs the hide/repaint/compare A/B at its own pinned frame with the floors it
measures and prints them. A gated `blast` scenario (a scripted kill at a pinned tick)
is named in Out of scope as the thing that would close this properly.

**R-N — The scorch decal is a `vehicle-tracks.ts`-shaped one-off at capacity 256, not
Phase 2's shared decal pool.** GH-30 ("craters, scorch, rubble, tyre marks and oil,
capped like the track pool") is Phase 2's own row and is still Open; the page never
states in one sentence that this seeds it, and building the shared pool here is
materially more scope than this package is sized for. 256 matches `MAX_MESH_WRECKS`
(`mesh-death.ts:164`) deliberately: a scorch and a wreck are one-to-one on a vehicle
kill, so a scorch outliving its wreck's eviction would be a mark with nothing under
it. It is a flat palette-colour quad through `createTrackMaterial`'s shape — no
texture, so `validate:assets` and `validate:meshes` are never opened. Render band is
the world/ground tier, not the FX tier: depth-tested, `depthWrite: false`, drawn with
the tracks.

**R-O — The vehicle shroud's bounds are measured from the LIVE nodes only.**
`new THREE.Box3().setFromObject(template.root)` on a vehicle template includes its
`death_root` child (`mesh-vehicle.ts:118, 299`), which is the charred wreck pose. That
is the exact mirror of the building rule — `buildingMeshBounds` is "measured off the
STANDING template only … the shroud has to cover the building that was there, not the
pile that replaces it" (`ThreeRenderer.ts:3995-3999`). A vehicle bounds function must
exclude `death_root` or the shroud is sized from the wrong object.

**R-P — `catastrophic_kill.json` is extended with `mesh_burst` and `mesh_plume`, and
with nothing else.** Its hot core already carries `additive: true` (R-A's on-palette
core) but no `mesh_burst`, so the moment it is dispatched it would draw stacked quads
where `structure_collapse` gets the pooled fireball. One flag on its first particle
layer and one on its second brings it in line with the path it now dispatches
through. Its `trigger` stays `catastrophic_kill`, already in the schema enum. Its
three presentation blocks are already authored and are used as authored.

**R-Q — `shell_impact.json` gains a `mesh_plume` layer and the three presentation
blocks; `structure_collapse.json` is not touched.** Measured: `shell_impact.json`
declares no `mesh_plume`, so a mortar bomb gets a fireball and no column at all
today — the blast's third element is simply missing on the mortar half. Leaving
`structure_collapse.json` alone keeps a building collapse exactly as it ships, which
the page's kept-as-good list explicitly asks for ("Smoke, the collapse shroud … Keep
all of it"), and confines this package's change to what it is for.

**R-R — Shake and hit-stop are capped per frame, rate-limited, and scale with
`impactPower`.** A Grad salvo is up to twenty rounds; twenty 70 ms freezes inside two
seconds is the engagement in slow motion. So: a frame takes the MAX of its requested
hit-stops and refuses a new one while one is running; shake takes the MAX amplitude
of its live sources rather than summing, which also keeps it inside the schema's own
`amplitude_px` ceiling of 24 without a second clamp. Both scale linearly with the
caller's power term — `impactPower` for a shell, `explosionBurstPowerFromMaxHp` for a
kill — so a mortar bomb at 0.3 asks for 21 ms and 2.7 px, not 70 and 9.

**R-S — The vehicle needs no new swap-hold; the shroud's own window already covers
its reveal.** The building path needs `buildingMeshSwapHold` because a building's
wreck swap is instantaneous. A vehicle's is not: `stepVehicleDeath` reveals the
`death_root` only after `MESH_DEATH_SECONDS` (400 ms). Spawn the shroud at the kill
instant and the reveal lands at 400 ms, inside the shroud's dense window — bloom
completes at `COLLAPSE_SHROUD_DURATION_MS * COLLAPSE_SHROUD_BLOOM_FRACTION` = 192 ms
and full density holds to `* COLLAPSE_SHROUD_HOLD_FRACTION` = 840 ms. So
`mesh-vehicle-death.ts` needs no change at all, and the timing claim is pinned as a
test rather than asserted in prose.

---

## Constraints that bind every task

Copied into the plan's Global Constraints verbatim.

- **The four invariants.** The sim ticks at a fixed 20 Hz and the renderer
  interpolates; `@lions/sim` is Q16.16 with no floating point; randomness is the
  seeded per-entity PRNG; data flows commands → sim → state + events, one way.
  **This package's diff under `packages/sim/` is empty** — `git diff --stat
  <base>..HEAD -- packages/sim` must print nothing at landing. `pnpm test:determinism`
  is in the gate line anyway, because "cannot move" is a claim and the gate is the
  evidence. Every clock touched here is the FRAME clock; no presentation value is
  ever read back by the sim.
- **The colour pipeline is not the default one and fails silently.** Every new colour
  is a `data/palette.json` key resolved at draw time through
  `ThreeRenderer.overlayColor(key, fallback)` — the pattern the muzzle-flash light
  already uses (`ThreeRenderer.ts:3059-3068`). No hex literal in renderer source, no
  raw hex in `data/vfx/*.json` (`palette_ref`, `vfx_emitter.schema.json:146-149`, no
  allowlist). A `ShaderMaterial` uniform takes `hexToLinear`, never `hexToUnit` — the
  composer's `OutputPass` encodes the whole frame to sRGB once at the end, so an
  un-linearised hex lands brighter than the palette entry authored
  (`vehicle-tracks.ts:507`'s own account).
- **Palette exemptions are named, not inferred.** The four named exemptions are the
  textured buildings, the textured vehicles, terrain albedo/shade, and the campaign
  board. **Nothing this package adds is exempt**: the decal, the light colour and the
  emitter colours are all palette keys.
- **Render-order bands come from `units/render-order.ts`**, which is the single source
  of truth. Read it before setting one. The scorch decal is ground-tier world geometry
  (depth-tested, `depthWrite: false`, drawn with the tracks), not an FX band.
- **`three` may only be imported under `packages/render/src/three/**`**, enforced by
  eslint — and the rule's `paths` entry does not catch subpath imports like
  `three/addons/...`, so keep those inside by discipline. `packages/app` reaches a
  renderer only through `packages/render/src/api.ts` or the dynamic-import doors named
  in `eslint.config.mjs`. **This package adds no door and changes no `api.ts` member.**
- **Pixi owes no parity.** VFX moved to three only on 2026-08-30 by the project
  lead's call; a three-only effect is the intended end state. `packages/render/src/renderer.ts`
  stays byte-identical to `main` and none of the new managers is reachable from it.
- **The file boundary with Lane A** (`2026-09-16-shell-upgrade-design.md:489-508`).
  This session owns `packages/render/src/three/units/mesh-*.ts`,
  `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/sheet.ts`,
  `tools/src/mesh_gait*`, `tools/units/rig.py`, the Meshy importers, `art/meshes/**`,
  `assets/meshes/**` and CLAUDE.md's "Mesh units" section. **Do not touch
  `packages/app/**`** (the shell programme's, including `main.ts` and `theme.css`) and
  **do not touch `three/units/overlays.ts` or `three/units/overlay-geometry.ts`** —
  Lane A's Tasks 15–16 hold those and wait on this landing.
- **No `any`, no non-null assertion in new code.** Strict TypeScript; tests colocated
  as `*.test.ts`; the three-side suites run under `environment: 'node'` and mock
  `WebGLRenderer` the way `ThreeRenderer.collapse.test.ts:38-55` does.
- **Every check gets an input that makes it fail — constructed, and run.** Each task
  names the mutation that turns its test red and the commit message says it was seen
  red.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test &&
  pnpm validate:data`. Plus `pnpm test:determinism` once, on the `ThreeRenderer`
  task. Nothing here needs `validate:assets`, `validate:meshes`, `validate:ui`,
  `balance` or `playtest` — no new PNG, no new GLB, no UI source, no sim change.
- **Git hygiene:** commit with explicit paths (`git add <paths>` /
  `git commit -s -- <paths>`), never `-A` — other sessions share this working tree;
  never `git checkout -- <file>`; DCO `-s`; the trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` verbatim.
- **Do not kill the dev server.** No `pkill -f vite`. The harness starts and stops its
  own server through `ensureDevServer`/`stopDevServer`
  (`tools/src/golden-diff/browser.ts`), which kills the process GROUP it created and
  nothing else.

---

## Architecture

### The sequence

**Flash.** `flashLights.spawn(x, y, groundWorldY(...), emitter.light,
overlayColor(emitter.light.color ?? 'vfx.fire', '#FFB43C'))` — literally the
muzzle-flash call at `ThreeRenderer.ts:3059-3068`, from two more sites. The spec comes
from `catastrophic_kill.json`'s `light` block for a kill and `shell_impact.json`'s for
an impact, with `intensity` and `radius_tiles` scaled by the caller's power term.
`FLASH_CAPACITY` stays 8 and is SHARED with muzzle flashes; `spawn` evicts oldest
(`flash-light.ts:83`). A blast is a rarer and larger event than a rifle shot, so it
would lose a slot to the next burst of small-arms fire — the pressure case (a dense
firefight and a kill in the same second) is worth measuring before the pool grows, and
is an open question rather than a change made blind.

**Fireball.** Unchanged. `ExplosionBurstManager` at
`EXPLOSION_BURST_DEFAULT_DURATION_MS` (450 ms), already spawned on both paths. R-A:
its hot core is the `additive: true` opaque-palette core, and the new `PointLight`
beside it is what makes it read as hot now that the scene is lit.

**Smoke column, 20 s.** `smokePlumes.spawn(..., BLAST_SMOKE_DURATION_MS)` with the
absolute rise/fade windows R-I requires: rise 600 ms (today's effective value), fade
5000 ms, hold the remaining ~14 s. `SMOKE_PLUME_CAPACITY` is 16 and evicts oldest, so
a 20 s life means at most sixteen concurrent columns — a mission that kills seventeen
vehicles inside twenty seconds drops the oldest, which is the correct failure and is
stated so nobody reads a missing column as a bug.

**Scorch decal.** A new `three/scorch-decals.ts`, structurally a small
`vehicle-tracks.ts`: one `BufferGeometry` of quads, one flat palette-colour
`ShaderMaterial`, a ring buffer of 256 with oldest-first eviction, a stamp per blast
sized from the power term, written once and never moved. Depth-tested world geometry,
so fog-of-war coverage is free — no visibility query, exactly as the tracks get it.
It samples the drawn ground through `ground-height.ts` like every other ground-lying
thing, and it is stamped from the tile CENTRE (the surface is Catmull-Rom over tile
centres since 2026-09-03; sampling a corner is a bug three other subsystems already
had and had fixed).

**Persistent wreck.** Unchanged (R-C).

**The shroud, extended to vehicles.** A `vehicleShroudBounds(template)` pure function
excluding `death_root` (R-O), a `vehicleMeshBounds` map filled where
`vehicleMeshTemplates` is (`ThreeRenderer.ts:3869`), and a
`beginVehicleCollapseShroud` mirroring `beginCollapseShroud` (`:6882`) minus the hold
(R-S). Called from the `destroyed` branch at the kill instant, so the 0.4 s fade and
the wreck reveal both happen inside the dense window.

### The light pool

One shared `FlashLightManager`, three call sites (muzzle, kill, impact). It is not
duplicated for blasts: a second pool means a second set of lights permanently in the
scene, and the light COUNT is what recompiles every material (`flash-light.ts:10`).

### Shake and hit-stop

Two pure models in one new file, `three/blast-shake.ts`, with no `THREE` import in
the pure half:

- `shakeAmplitudeAt(spec, distanceTiles, ageMs)` → px. Linear falloff to zero at
  `falloff_tiles`, linear decay to zero at `duration_ms`, scaled by the caller's
  power. The oscillation itself is a fixed-frequency sine of the shake's own age —
  a presentation clock, never a PRNG draw, so two identical replays shake identically
  without touching the seeded streams.
- `hitStopRemainingMs(state, dtMs)` → the clamp. `frame()` asks it first; while it
  returns > 0, `frame()` holds the previous `alpha` and passes `0` downstream (R-J).

Both cap per frame and refuse re-entry (R-R). The shake's px offset is converted to
world units at the current zoom and applied to the camera COPY inside `threeCamera()`
(R-K).

### The mortar/Grad sharing

`spawnShellImpactFx` (`:5753`) already reads `SHELL_PROFILES[s.kind].impactPower` and
returns early at `<= 0`. It gains the same four calls the kill branch gets, each
scaled by that one number. Nothing distinguishes mortar from Grad except the number:
`mortar` 0.3, `rocket` 0.45. `bolt` and `missile` are 0 and never reach the function
at all, because `shellHasLanded` runs over `this.shells` only and direct fire lives in
`this.bolts` (`ThreeRenderer.ts:5716-5726`).

### The harness

`tools/src/perf/blast-captures.ts`, a retarget of `death-captures.ts` (not a new
instrument): dev server up, `?sandbox=beit_sahwan_outskirts`, frame loop frozen with
`FREEZE_FRAME_LOOP_SCRIPT`, subjects spawned on the open northern band the way
`wreck-captures.ts`'s parade line does, then for each subject

1. `step()` to the moment of the kill (`sim.debugKill`) or of the impact (queue an
   indirect attack and step until `renderer` reports a shell in flight),
2. drive `renderer.frame(1, FRAME_MS)` by hand over a 10 s window,
3. screenshot every 200 ms → **50 frames per subject**, at zoom 2.5 (the lead's
   figure) plus one 1.0 establishing still,
4. write `sheet.md` + `sheet.json` with every capture condition named.

It also runs the toggle A/B for `scorch` and `blast-light` (R-M) at a pinned frame and
prints the deltas, so "the layer draws" is measured rather than eyeballed. Output root
`.superpowers/art-captures/blast/<label>/`, `--label=before|after` required (R-E).

---

## Testing and evidence

**Pure specs, node environment, no browser.** Every piece with a curve, a pool or a
buffer is a pure function with its own test:

- `smokePlumeRiseEnvelope` / `smokePlumeOpacity` under an explicit rise/fade fraction:
  the 20 s column rises in 600 ms and not 3 s, and the default-argument path is
  bit-identical to today's (pinned by re-running the existing assertions).
- `scorch-decals.ts`: the ring buffer wraps at 256 and evicts oldest; a stamp written
  is a stamp readable; `createScorchMaterial` is translucent, `depthWrite: false`, and
  its uniform is linear.
- `blast-shake.ts`: amplitude is the spec's at distance 0 and exactly 0 at
  `falloff_tiles`; it decays to 0 at `duration_ms`; two live shakes give the MAX, not
  the sum; a hit-stop requested while one runs does not extend it; `hitStopRemainingMs`
  drains by `dtMs` and floors at 0.
- `vehicleShroudBounds`: a template whose `death_root` child is larger than its live
  body reports the LIVE size (R-O), and the shroud's dense window contains
  `MESH_DEATH_SECONDS` (R-S), derived from the constants rather than restated.

**Renderer-region specs** in a new `ThreeRenderer.blast.test.ts`, under the headless
`FakeWebGLRenderer` mock `ThreeRenderer.collapse.test.ts` already proves works: a
`destroyed` event for a vehicle type spawns a flash, a shroud and a scorch; the same
event for infantry spawns none of them; `spawnShellImpactFx` at `impactPower` 0 spawns
nothing; a `bolt` never reaches it.

**The layer-toggle falsification pattern** (`three/debug-layers.ts`) is the
reference-free standard and is what proves the new art actually draws: hide the named
layer, repaint at zero elapsed time, require a calibrated pixel-delta floor. It is
texture-proof by construction — it never asks what the frame looks like, only whether
removing the layer changes it. R-M puts these checks in the blast harness rather than
in a golden `layerChecks` list, because no gated scenario contains a blast.

**The captures** (R-E) are the acceptance evidence, and per R-L they are the ONLY
visual evidence the project can currently produce for this package — the golden gate
is structurally blind to it. Before-set first, at the branch base; after-set at the
head; both in the PR description, with the `sheet.json` numbers quoted in the body.

**Capture conditions are stated with every number.** A first golden-diff run once read
6.5× high purely from screenshot downscaling and a font-load race, and the OS mouse
cursor is shared across tabs and can leak into a capture. Every figure this package
reports names its machine, GL backend, viewport, zoom and tick.

---

## Out of scope

- **Authored per-vehicle wreck geometry** ("same silhouette, burnt, turret
  displaced"). R-C. The procedural pass ships; real damaged geometry per vehicle is
  Blender art-lane work and is still Open on the tracking table.
- **Phase 2's shared decal pool (GH-30)** — craters, rubble, tyre marks, oil, and
  tracks becoming fading tread decals. R-N builds a one-off scorch; generalising it is
  Phase 2's own row.
- **Real GPU additive blending.** R-A. Closed deliberately; reopening it needs its own
  G0.
- **`heat_shimmer`.** Still read by nothing. `catastrophic_kill.json` declares it on
  its hot core and this package leaves it declared and unread, exactly as it finds it.
- **A gated `blast` visual scenario** — a scripted kill at a pinned tick on a mission
  whose scene holds still, which is what would let the golden gate see this package at
  all (R-L). Real work, its own package.
- **Growing `FLASH_CAPACITY`.** Open question below; not changed blind.
- **Any `packages/sim` change.** R-B. No catastrophic-vs-ordinary classification, no
  new event.
- **Pixi.** No parity owed; `renderer.ts` stays byte-identical.
- **Vehicle wheel/track animation** (sub-project 3). Waits on this landing.
- **Lazy per-mission GLB loading.** The 34-fetch / 25.3 MiB boot cost is real and is
  someone else's package.

---

## Open questions for the lead

Only what G0 #14 did not answer.

1. **Is `FLASH_CAPACITY = 8` enough once blasts compete with muzzle flashes for it?**
   The pool is shared and evicts oldest. A dense firefight with several guns firing
   and a vehicle dying in the same second is the pressure case and has never been
   measured. The alternatives are: leave it at 8 (a blast light can be stolen by the
   next rifle shot), raise it (every light in the scene, always, and a material
   recompile if the count is ever changed at runtime), or give a blast eviction
   priority over a muzzle flash. **Recommendation: leave it at 8, measure it in the
   after-captures, and decide with a number.**

2. **Should the 20 s column's density be lower than a building collapse's?** The
   authored value is inherited from `catastrophic_kill.json`'s particle art, and a
   column that reads correctly for 4 s may read as a permanent grey wall for 20. The
   harness's ten seconds is exactly the instrument for judging this, so this is a
   question to answer FROM the after-captures rather than before them.

3. **Does the hit-stop belong on a mortar bomb at all, or only on a vehicle kill?**
   R-R scales it to 21 ms at `impactPower` 0.3, which is barely over a frame. The
   cheaper answer is a floor below which no hit-stop fires — but where the floor sits
   is a feel judgement, and the ten-second capture of a mortar impact is what it should
   be made against.
