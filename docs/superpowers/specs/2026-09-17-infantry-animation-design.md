# Infantry animation — crossfades, real falls, crew walk cycles

**Date:** 2026-09-17. **Status:** design, awaiting the project lead's review.
**Where it sits:** Phase 1 of the art uplift (`docs/superpowers/specs/
2026-09-14-lit-renderer-design.md` is Phase 0, landed 2026-09-15 as v0.63.0).
Phase 1 is three sub-projects and this is the first; the other two — blasts
(vehicle death sequence, mortar impact, screen shake) and vehicle weight (hull
pitch and roll under motion, wheel pivots once Phase 3 re-exports the hulls) —
get their own specs after this one ships.

Everything here is renderer and art pipeline. **Nothing in `packages/sim`
changes**, no event is added, no tuning constant moves, and the determinism
golden hash, `pnpm playtest` and `pnpm balance` must read byte-identical before
and after.

---

## 1. What is wrong, measured

The 2026-09-14 sweep's verdict on animation was "lame", and the three causes
are each one file:

1. **Every clip change is a hard cut.** `applyMeshClip`
   (`packages/render/src/three/units/mesh-clip.ts`) stops every other action
   and calls `reset().play()` on the new one — "a simple, deterministic
   switch, matching the spike's own `applyClip`". A rifleman going from `move`
   to `idle` snaps between two poses in one frame; a burst of fire snaps him
   into and out of `fire` at every shot, because `resolveClip` (`clip.ts`)
   latches `fire` per shot.
2. **Every infantry death is a pose swap, not a fall.** `beginMeshDeath`
   (`mesh-death.ts`) plays `down` and starts a 0.4 s fade toward half opacity
   with a 3 px sink, then `stepMeshDeath` swaps to `wreck` at full opacity on
   the ground. For the sixteen kit rigs `down` and `wreck` are both the SAME
   separate prone geometry, switched in by a bone-scale swap (`rig.py`'s
   `_figure_death_parts`, `_key_death_visibility`), so a standing man becomes a
   prone one between two frames. The four Meshy bipeds SHIP with real death
   animations — `Shot_and_Blown_Back`, `Shot_and_Fall_Backward`,
   `Shot_and_Fall_Forward`, `Shot_and_Slow_Fall_Backward`,
   `Fall_Dead_from_Abdominal_Injury` — and every importer discards the motion
   and keeps only the last frame as `wreck` (`import_meshy_soldier.py`'s
   `FALL_SOURCE` comment: "read by exactly one caller now: `build_wreck_src`").
3. **Three crews slide.** `atgm_cell`, `mortar_crew` and `digger_crew` are
   built with `animates=False` and a degenerate 0.0417 s `move` with no leg
   keys (`rig.py`'s team table; `mesh_gait.test.ts`'s `GAIT_EXEMPT`). Ordered
   to move, two kneeling figures glide across the map beside their tripod.

The billboard path (`&nomesh`, Pixi) has none of these problems fixed and is
not touched: VFX and animation owe Pixi no parity since 2026-08-30.

---

## 2. Goals and non-goals

**Goals.** Transitions between clips blend instead of cut. A soldier whose
source asset supplies a death animation plays it. A soldier whose asset does
not supplies one anyway — a generic topple — so no unit in the game dies by
teleporting into a corpse. The three sliding crews stand up and walk. All of
it proved by gates that have been watched going red, and photographed
before/after at the zoom the project lead judges art at.

**Non-goals** (each is a named later step, not an omission): vehicle death
and blast effects; hull pitch and roll under motion; wheel and track motion
(the hulls have no wheel nodes to turn — `hull_rubber` is one merged mesh —
so that waits for Phase 3's re-exports); Sarim's `Walk_Forward_While_Shooting`
and `Running` (a `moveFire`/run pass is the gait design's territory); the
civilians' `Crawl` as a wounded state (the sim has no wounded state); Pixi
parity of any kind; replacing kit rigs with Meshy bipeds (Phase 3).

---

## 3. Design

### 3.1 Crossfades (D1, D2)

**D1 — `applyMeshClip` blends over 150 ms.** When the resolved clip differs
from `currentClip`, the incoming action starts playing and ramps its weight
to 1 over `MESH_CLIP_FADE_SECONDS = 0.15` while every other action with
non-zero weight ramps to 0 over the same window and is stopped when it gets
there. `currentClip` becomes the incoming clip immediately, so the no-op guard
and `applyGaitRate` (which reads `currentClip`) behave exactly as today.
`opts.once` keeps its meaning (`LoopOnce` + `clampWhenFinished`); a one-shot
clip is entered with the same fade-in and is never faded out while still
playing — the only callers of `once` are the death modules, which wait for
`.paused` before asking for the next clip.

**The weight ramp is this module's own, not `AnimationAction.fadeIn`.** Read
from three.js's source rather than assumed: `fadeIn(d)` is
`_scheduleFading(d, 0, 1)`, which overwrites the interpolant's first sample
with weight ZERO at `mixer.time`, and `PropertyMixer.apply` mixes the
accumulated pose toward the binding's ORIGINAL value by `1 − cumulativeWeight`.
So an action re-selected while it is still fading out — `move` → `idle` →
`move` inside 150 ms, which a unit arriving in formation does — would drop
the summed weight below 1 for a few frames and blend the figure toward bind
pose: on a Meshy biped that is a T-pose flash. `mesh-clip.ts` therefore keeps
a small per-player fade table (`ClipPlayer.fades`), starts every ramp from the
action's CURRENT effective weight, and advances it in a new
`advanceMeshClipFades(player, dtSeconds)` that the five mixer-stepping sites
(`updateMeshUnits`, `updateVehicleMeshes`, `stepMeshDeath`, `stepMeshEvac`,
`stepVehicleDeath`) call immediately before `mixer.update`. The invariant the
test pins: across any sequence of `applyMeshClip` calls at any spacing, the sum
of effective weights over all playing actions is 1 at every step.

**D2 — a transition that changes a scale key is a cut, decided from the
bytes.** Crossfading two clips that key different bone SCALES interpolates the
scale: a kit rig's `root` shrinking 1 → 0 while its `death_root` grows 0 → 1
over 150 ms, a figure collapsing to a point and a corpse inflating from one.
The rule is per clip pair, not per template or per clip name, because the
same mechanism is used for more than death: the sniper's `move` is a standing
rig and its `idle`/`fire` a prone one (`_sniper_rest`), vehicles' `idle` and
`wreck` key node scale (`wreck-pass.ts`), `moto_rpg` collapses its whole
machine through `m_root`, and the crew rigs in 3.4 add a third root.

At template load (`buildMeshUnitTemplate`, `buildVehicleMeshTemplate`) each
clip gets a **scale signature**: `null` if it has no `.scale` track;
otherwise the sorted `trackName=value` list of its scale tracks, provided every
scale track is constant over the clip; `"animated"` if any is not. The
signature map is carried onto the entity (`ClipPlayer.clipScale`).
`applyMeshClip` cuts — the existing stop/reset/play — when the two
signatures differ or either is `"animated"`, and crossfades otherwise. So:
kit rig `idle` ↔ `move` (both `root=1, death_root=0`) blends; kit `idle` →
`down` cuts; sniper `idle` → `move` cuts (as today); vehicle `idle` → `wreck`
cuts; Meshy `idle` ↔ `move` ↔ `fire` ↔ `down` all blend, since those files
carry no scale track at all. The scale-swap rigs therefore keep their exact
current death behaviour from this decision alone; what improves them is 3.3.

### 3.2 The supplied falls: `fall` and `fallAlt` (D3, D4)

**D3 — two new canonical clip names, `fall` and `fallAlt`, one-shot.**
`down` cannot be the fall: `resolveClip` returns `down` for `alive === 0`,
for `routed && !moving` and for `pinned`, and the last two LOOP a held
gone-to-ground pose for as long as the state lasts — this is precisely the
"suppressed soldier being blown backwards, on repeat" `import_meshy_soldier.py`
records unbinding. A fall is a transition with a beginning and an end; it
needs a name `resolveClip` never returns. Only the death module plays it.

The contract (`2026-08-28-mesh-unit-contract.md`) gains a v4 section: the
`ClipName` vocabulary becomes `idle, move, fire, down, wreck, work, moveFire,
wreckAlt, fall, fallAlt`. Semantics: `fall` starts standing (first-frame hips
height at least three-quarters of the file's own `idle` hips height; the
soldier's fall opens taller than its low-ready hold) and ends prone
(last-frame hips height ≤ 0.35 m), lasts 0.5–5.0 s (the five supplied clips
measure 2.3–4.6 s; they are kept whole), carries **no horizontal
root motion** — the hips' horizontal position is held at its first-frame
value throughout, vertical kept — and its **last frame is the `wreck` pose**:
the same source frame, re-centred the same way `build_wreck_src` already
re-centres it, so the switch from the finished fall to the persistent wreck
moves nothing. `fallAlt` pairs with `wreckAlt` identically. A file with
`fallAlt` must have `wreckAlt`; a file with `fall` must have `wreck`; `wreckAlt`
without `fallAlt` stays legal (no kit rig ships a `fallAlt`). Neither is
cyclic (`CYCLIC_CLIPS` unchanged). A team is ONE entity and dies as one, so
without help every figure in a Meshy team would fall as three clones in
perfect unison; the importer therefore **staggers the figures by 0.1 s
each** in the combined clip (figure k holds its first frame for `k × 0.1 s`,
then plays), which lengthens the clip by 0.1 s per extra figure and leaves
the last frame — every figure at its own end pose — equal to `wreck` as
required.

Which files, from the sources already on disk:

| GLB | importer | `fall` | `fallAlt` |
|---|---|---|---|
| `meshy_soldier.glb` (`inf_squad`) | `tools/import_meshy_soldier.py` | `Shot_and_Blown_Back` | — (`Side_Shot` is a hit reaction, measured, not a fall) |
| `yahalom_engineer.glb` (`yahalom_squad`) | `tools/import_meshy_yahalom.py` | `Shot_and_Fall_Backward` | `Shot_and_Fall_Forward` (+ its last frame becomes `wreckAlt`) |
| `sarim_rifles.glb` (`sarim_rifles`) | `tools/import_meshy_soldier_irregular.py` | `Shot_and_Slow_Fall_Backward` | `Shot_and_Fall_Forward` (already `wreckAlt`'s source) |

`rpg_team.glb` is a kit rig (`rig.py`, `MESH_KIT_OWNED`); the Meshy RPG
importer under `tools/units/` is a WIP whose output has never shipped, so the
RPG team topples (D5). Corrected 2026-09-17 during execution.

Each importer's `check_clip_semantics` table gains rows for the new clips
(the hips-travel and heading halves both), and the horizontal hold is done
the way `build_wreck_src` already does it for the last frame, applied to every
frame. `pnpm gait:meshes` ignores the new names (it measures only the two
locomotion clips) and `pnpm encode:meshes` mirrors them like any other clip.
`mesh-anim.ts`'s `CLIP_NAME_SET`, `sheet.ts`'s `ClipName` union and
`meshClipOrFallback` grow accordingly; the fallback chain is `fallAlt → fall →
down`, though the death module never asks for a name the file lacks. Sprite
sheets never carry the names; `Partial<Record<ClipName, ClipSpec>>` needs no
change and no schema enumerates the vocabulary (checked: nothing under
`data/schemas` names `moveFire`).

**Runtime.** `pickDeathClip(entityId, hasAlt)` (`mesh-anim.ts`) already hashes
the entity id to choose `wreck`/`wreckAlt`; it returns the pair
`{ fall: 'fall' | 'fallAlt', wreck: 'wreck' | 'wreckAlt' }` so the fall a body
plays and the corpse it becomes are always the same variant. `beginMeshDeath`
on a template with `fall`: `applyMeshClip(entity, pick.fall, { once: true })`
(a 150 ms blend out of whatever it was doing, by D1) and a new phase
`'falling'`; `stepMeshDeath` advances the mixer until that action reports
`.paused`, then hands over to the wreck exactly as the settle phase does today.

**D4 — a body that has visibly fallen is not faded and sunk afterwards.**
The 0.4 s fade-to-half plus 3 px sink is Pixi's curve, ported to soften a
sprite swap; after a real fall it would dim a corpse that is already lying in
its final pose, sink it, then pop it back to full opacity at ground height
when the wreck takes over. So on the `fall` path (and the topple path in 3.3)
the fade window is skipped: fall → hold → wreck swap → `MeshWreck`, opacity
untouched. The fade survives in exactly two places: `beginMeshEvac`
(unchanged), and a template with **no `wreck`** — the four civilians — where
after the topple the existing fade runs and the body is removed as today,
since a corpse with nothing persistent to become still has to leave the
screen somehow. `MESH_DEATH_SECONDS`, `meshDeathOpacity`, `meshDeathSinkPx`
and their tests stand; they simply stop being reached from the two new paths.
This is the one place this spec departs from the chat design ("then existing
fade/wreck"), and it is called out in the review request.

### 3.3 The generic topple for everything else (D5)

Every rigged GLB without a `fall` — the sixteen kit rigs, the four
civilians, `moto_rpg`, and the two Meshy files that swap bone trees by scale
(`sniper_team.glb`, `meshy_mortar_team.glb`) — dies by falling over.
`beginMeshDeath` on such a template enters a `'toppling'` phase instead of
playing `down`, unless the living clip already shows the corpse geometry (see
"already down" below):

- **The pose freezes.** The mixer is not advanced during the topple, so the
  figure falls in the pose it died in — a running man topples mid-stride
  rather than jogging on his side. No clip is applied; whatever was playing
  stays at its last evaluated frame, fades included.
- **Each figure pitches 90° about its own feet over 0.5 s**, angle
  `90° · p²` with `p = t / 0.5` — a body accelerates as it goes. A team is
  one entity whose figures stand up to a metre from its origin, so pitching
  the ENTITY root about the team centre would drive the front man half a
  metre into the ground and lift the rear man half a metre into the air (the
  `d → −up` half of a 90° rotation); the pivot has to be per figure. It is
  found structurally, not by name: every **parentless bone currently at
  scale 1** is a live figure root — `{prefix}_root` on a kit rig, `Hips` on
  a Meshy biped, `m_root` on the motorcycle — and each is rotated about the
  horizontal axis through the **ground point directly beneath its own
  origin** (a kit root sits at the feet already; a Meshy `Hips` projects
  down to them). Figures are staggered 0.1 s apart in traversal order, the
  same touch the importers bake into `fall`. The override is written to the
  bones after the (unadvanced) mixer, so nothing fights it.
- **Direction is away from the killer.** `ThreeRenderer.onEvents` already
  handles `destroyed` and has `e.by`; it records the killer's current
  position into two new per-entity floats beside `curX`/`curY` (`killerX`,
  `killerY`; `NaN` when `by < 0`, which is `debugKill` and tunnel collapse).
  `main.ts` calls `onEvents` synchronously after `sim.tick()` and before any
  frame, so the prune loop that hands the entity to `beginMeshDeath` always
  finds the value written. The topple direction is the horizontal vector from
  killer to victim; with no killer, straight backward relative to the unit's
  own facing.
- **When the last figure reaches 90°, the corpse swap — always a cut.** The
  bone overrides are dropped and `applyMeshClip(entity, pick.wreck, { once:
  true, cut: true })` switches to the wreck in one frame regardless of D2:
  a crossfade here would have the mixer blend the wreck's lying pose while
  the pitch override still stood the figure on its head, or leave a
  half-standing blend for 150 ms; a one-frame change between two lying
  bodies is invisible at 25 px and is what the kit rigs do today. Where the
  corpse is separate geometry (a scale swap), each corpse root that just
  became visible is **yawed about its own origin to the topple bearing** so
  its head lies where the toppled head landed — the kit prone build lies
  along local +X with the head at +X (`kit.py`'s prone branch: `head` at
  x = 0.78, boots at −0.78). An authored wreck POSE with no swap keeps its
  authored orientation. Then the normal settle → `MeshWreck`, at ground
  height, full opacity (D4). `moto_rpg` pitches as a machine, bike and riders
  together, then swaps to the fallen-machine wreck; accepted as a look, and
  a strict improvement on the instant swap.
- **Already down.** A template with `wreck` whose current clip has the same
  scale signature as `wreck` is already showing the corpse geometry — the
  sniper on overwatch, whose `idle`/`fire` are its prone rig and whose
  `wreck` is the same rig flattened — and has nothing to topple: it goes
  straight to the wreck through `applyMeshClip`, blending or cutting by D2,
  which is today's behaviour and is right for a man already lying down. The
  same sniper killed on the move (standing rig live, signature differs)
  topples. The rule is `topple iff no fall and (no wreck or
  sig(current) ≠ sig(wreck))`, and it is a proxy for "standing" that every
  shipped file satisfies; the risk list names it.
- A template with no `wreck` (civilians): after the topple, the existing fade
  window and removal, as D4 says.

The renderer's other death consumer, the billboard `dying` list, is untouched.
A dying entity that was fogged stays fogged; nothing here consults
`isExplored` earlier than the wreck creation already does.

### 3.4 Crew walk cycles (D6)

`teams.py` already knows what these crews do: `_crew_posture` keeps them
kneeling at the weapon for `idle`/`fire`, and `digger_crew` "stands for
`move` on the sniper team's precedent". The rig gets the same rule.

`_add_figure` gains a spec field `move_posture` (default `None`: one living
posture, exactly today). A figure with `posture="kneeling",
move_posture="standing"` is built with **three roots**: a standing walker
under `root` (`_standing_bones`, the same skeleton every rifleman has), the
kneeling body rigidly under a new `{prefix}_deploy_root` (one bone, the
`_death_root_bone` shape), and the prone corpse under `{prefix}_death_root`
as now. `_key_death_visibility` keys all three: `idle`/`fire` → deploy 1 /
root 0 / death 0; `move` → 0 / 1 / 0; `down`/`wreck` → 0 / 0 / 1. The team's
shared `prop` bone (the deployed launcher or mortar) is keyed 0 on `move` —
the crew carry it, and a carried tube is not modelled at 25 px (a number-to-
approve below). The digger's spoil heap is ground and stays through every
clip. `move` is then a real gait cycle sized from the unit's own
`mobility.speed_tiles_s` through `gait_amplitudes`, like every other kit
walker, and gets the per-figure phase offset every walking team has.

The three teams — `atgm_cell` (0.7 tiles/s), `mortar_crew` (0.6),
`digger_crew` (0.5) — are re-exported, then `pnpm gait:meshes` and
`pnpm encode:meshes` in that order. `mesh_gait.test.ts`'s `GAIT_EXEMPT`
shrinks to `moto_rpg` alone: its "every rigged type is either gaited or
exempt" test fails on the three stale entries (the demotion assertion doing
its job) and they are deleted; its pinned counts (12 declaring types, 15
gaited files) move to 15 and 18. The two-posture handling `measureFacing`
already has for the sniper (a joint scaled out of the clip is reported, not
read) covers a third root without change, and the per-figure ground-coverage
gate now applies to these figures.

**This step stops for the project lead's numbers before Blender runs**
(`approve-art-numbers-before-rendering`): the plan's task prints, per team,
the standing height, the stride `gait_amplitudes` computes from the speed,
whether it is capped, and the cycle length, and halts. The `blender-art`
agent takes approval from the lead directly, not relayed.

### 3.5 What the sim sees

Nothing. No new event, no new state, no read of `rng(entityId)` — the fall
variant is `hashEntityId` on the renderer side, as `wreckAlt` already is.
`killerX`/`killerY` are renderer memory written from an event the renderer
already consumes. The determinism hash, `pnpm playtest`'s table and
`pnpm balance` are byte-identical before and after, and the plan's final task
runs all three to say so.

---

## 4. Proof

Every gate below is written with its failing input constructed and run
(CLAUDE.md, "Every check gets an input that makes it fail"), and the
falsification is named in the commit that adds it.

1. **Crossfade weights** (`mesh-clip.test.ts`, new): after `applyMeshClip(A →
   B)` at t = 0, weights at t = 0.075 are 0.5/0.5 and at t = 0.15 are 0/1
   with A stopped. Re-select A at t = 0.05: the sum of effective weights is 1
   at every step to t = 0.3. Falsified by swapping the ramp for
   `action.fadeIn` — the sum reads < 1 for the re-selection case.
2. **Scale-swap cut** (`mesh-clip.test.ts`): a fixture with `idle` (root
   scale 1, death_root 0) and `down` (0/1) switches in ONE step with no
   intermediate weight; a fixture whose `idle`/`move` both key `root=1`
   blends. Falsified by removing the signature comparison — the first case
   shows a 0.5 weight at t = 0.075. `mesh-vehicle-shipped.test.ts` gains the
   assertion that every shipped vehicle `idle → wreck` is classified a cut.
3. **`fall` semantics on the shipped bytes** (`mesh_gait.test.ts`, a new
   `describe` sweeping `RIGGED_UNIT_MESHES`): for every file carrying `fall`
   or `fallAlt`, the hips' horizontal travel < 0.05 m, first-frame height
   at least 0.75 × `idle`'s, last-frame height ≤ 0.35 m, duration 0.5–5.0 s,
   and the last frame equals the paired wreck clip's pose (hips within
   0.01 m, every bone rotation within 1°). Falsified against the current
   shipped files by binding `Shot_and_Blown_Back` WITHOUT the horizontal
   hold: travel reads ≈ 3.7 m. The test also asserts which files carry the
   names (the three above and no other) so a kit rig cannot acquire a `fall`
   by accident, and that no file has `fallAlt` without `wreckAlt`.
4. **Fall path runtime** (`mesh-death.test.ts`): a fixture with `fall` plays
   it once, does not touch opacity or position.y during it, and becomes a
   wreck only after the action pauses; falsified by making the module play
   `down` — the assertion on `currentClip` reads `down`.
5. **Topple** (`mesh-death.test.ts`): a two-figure fixture without `fall`
   (two parentless roots at scale 1, one death root each at 0) has each
   figure's root pitched 22.5° at t = 0.25 s and 90° at t = 0.5 s after its
   own stagger, **the ground point beneath each root unmoved** (a point at
   the feet stays at the feet — the entity-root pivot fails this by 0.5 m),
   the mixer time unchanged through the window, the swap a single-frame
   cut, each corpse root yawed to the topple bearing, the direction reversed
   when the killer is on the other side, and the bearing facing + 180° with
   a `NaN` killer. A fixture whose `idle` and `wreck` share a scale
   signature skips the topple. Falsified by dropping the `p²` — 45° reads at
   0.25 s — and by pivoting on the entity root — the feet move.
6. **Killer plumbing** (`ThreeRenderer` test, node-side): a `destroyed`
   event with `by = 7` writes entity 7's current position; `by = −1` writes
   `NaN`.
7. **Importers** (`check_clip_semantics`, Python, at build): the new rows fail
   when the horizontal hold is removed (travel) or the clip is bound backward
   (heading); both run once red in the task's report.
8. **Crews** (`mesh_gait.test.ts`, existing sweep): the three files declare
   `rl_gait.move` matching a fresh measurement, the multiplier sits inside
   the clamp, cadence is 1–2 steps per second, every figure covers ground.
   Their exemption entries fail to be demoted before the re-export lands and
   are deleted in the same commit.
9. **Capture sheet** (`tools/src/perf/`, a `death-captures.ts` beside
   `gait-captures.ts`): the live renderer at zoom 2.5 and at the default
   zoom, each of the four Meshy types and one kit rig and one civilian,
   killed with `__lions.sim.debugKill` (and once with a real killer for the
   direction), photographed at 0, 0.15, 0.25, 0.5, 1.0 and 1.5 s after death,
   plus the three crews walking. "Before" is captured at the branch base
   commit with the same script, since two of the three changes are runtime
   code and cannot be produced by the GLB-interception trick
   `gait-captures.ts` uses. Both sheets go in the review package.
10. **Perf**: `pnpm perf:units` at the 300 checkpoint, hardware GPU
    confirmed, before and after. A crossfade evaluates two actions for
    150 ms per transition; the budget is render p95 within +0.5 ms of the
    `docs/PERFORMANCE.md` reading on the same machine, and the number goes
    into that document either way.
11. **Sim silence**: `pnpm test:determinism`, `pnpm playtest`, `pnpm balance`
    unchanged — run, not asserted.

---

## 5. Build order

The plan follows this order so every runtime step is testable against a
fixture before any asset exists, and the one step that waits on a human sits
last:

1. Crossfade ramp + scale-signature cut in `mesh-clip.ts`; the four call
   sites; tests 1–2.
2. `fall`/`fallAlt` in the vocabulary, contract v4, `pickDeathClip` pair,
   `mesh-death.ts` falling phase and D4 (fixture-driven); tests 4.
3. Topple + killer plumbing; tests 5–6.
4. The four importers bind their falls; gate 3; `pnpm encode:meshes`;
   `pnpm validate:meshes` (the added clips change no geometry, so the
   silhouette gate must stay green — a red there means an importer moved
   something else).
5. Crew rigs: `rig.py` three-root figure, numbers printed, **halt for
   approval**, then export → gait → encode; gate 8.
6. Capture sheet (before at base, after at head), perf re-measure, sim
   silence run; CLAUDE.md's "Mesh units" bullet updated (the death and
   crew-served lines both go stale).

---

## 6. Numbers to approve

| knob | proposed | why |
|---|---|---|
| crossfade window | 150 ms | the sweep's recommendation; short enough that a burst still reads as a burst |
| topple duration / angle / ease | 0.5 s / 90° / `p²` | a body accelerates; 0.5 s is between the fall clips' own ~1 s and the old 0.04 s swap |
| per-figure stagger (fall and topple) | 0.1 s | a squad is one entity and would otherwise drop as three clones in unison |
| topple direction with no killer | backward from facing | `debugKill` and tunnel collapse have no shooter |
| `fall` duration band | 0.5–5.0 s | the supplied clips measure 2.3–4.6 s, kept whole; the band rejects a static hold and an unbound idle |
| crew standing height | 1.8 m | `kit.py`'s standing figure, same as every rifleman |
| crew stride / cycle | from `gait_amplitudes(speed)` | printed per team before Blender runs; capped strides reported |
| deployed weapon on `move` | hidden | crew carry it; a tripod gliding beside a walking crew is the bug being fixed |
| capture zoom | 2.5× and default | 2.5 is the top of the clamp and how the lead judges art |
| perf budget | render p95 +0.5 ms at 300 | crossfades cost two evaluations per transition, transitions are sporadic |

---

## 7. Risks, and what is done about each

- **A Meshy fall's last frame and its wreck pose drift apart** if one
  importer re-centres and the other holds differently. Gate 3's equality
  check reads both from the same shipped bytes.
- **Summed weight < 1 for a frame** is the one visible failure mode of
  crossfading and it is a T-pose flash. Gate 1 pins the sum; the ramp is
  owned, not delegated to `fadeIn`.
- **"Already down" is a proxy.** Equal scale signatures between the living
  clip and `wreck` stand in for "the figure is already lying down". It is
  exact for every shipped file (the sniper is the only rig whose living pose
  is its corpse rig), but a future file that keys no scale at all and ships a
  static lying `wreck` with no `fall` would blend to it over 150 ms instead
  of toppling — a poor man's fall rather than a wrong one. Gate 3's
  which-files assertion is where such a file would be noticed.
- **The per-figure pivot depends on bone parentage, not bone names.** Every
  shipped rig puts its live roots at the top of the bone tree (kit, sniper,
  mortar team, motorcycle, Meshy bipeds, civilians — checked in the
  exporters), so nothing in the contract's "no bone names beyond the prefix
  convention" rule is bent. A rig that parented all its figures under one
  master bone would pivot as a block; test 5's feet-stay-put assertion is on
  the fixture, and the capture sheet is what would show it on a real file.
- **`moto_rpg`** pitches as a machine; accepted look, named above.
- **CI time**: gate 3 and the capture script add nothing to CI (the capture
  is a review instrument, run by hand like `gait-captures.ts`); gate 3 runs
  inside the existing gait spec.
