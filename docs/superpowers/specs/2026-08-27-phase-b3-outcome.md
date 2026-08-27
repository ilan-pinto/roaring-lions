# Phase B3 outcome — what Phase C inherits

**Date:** 2026-08-27
**Issue:** 123
**Plan:** `docs/superpowers/plans/2026-08-27-three-renderer-phase-b3.md` (plus its addendum)
**Predecessors:** `2026-08-27-phase-b2-outcome.md`, `2026-08-26-phase-b1-outcome.md`
**Commits:** `e788150..7695088`, twenty-eight commits on `feat/three-renderer`

B3 delivered what it set out to. Under `?renderer=three` the game is now **watchable**: units
stand on the terrain, face and animate, traverse their turrets, shoot at each other with tracers
and muzzle flashes and impacts, die; buildings are their real art and take visible damage and
leave wrecks; units can be clicked, box-selected and ordered. Pixi remains the default and its
behaviour is unchanged.

It is not yet **playable**: there are no selection rings, HP bars, group badges or hover
highlights, and no fog. Those are Phase C and B4, and their absence is the honest description of
where this stops.

---

## The 300-unit gate passed, and Pixi is the backend that fails it

| units | three.js render | Pixi render |
|---|---|---|
| 65 | 0.57 ms | 2.11 ms |
| 150 | 0.48 ms | 2.94 ms |
| 300 | 0.54 ms | **5.78 ms** |
| 400 | 0.60 ms | **6.40 ms** |

> **STALE as of task B4.4 (fog live) — do not cite this table.** It was measured with
> `isVisible()` returning `true` unconditionally in three (see "What Phase C inherits" #1 below),
> so it understates Pixi's real advantage-loss and overstates three's edge over what fog leaves
> Pixi still drawing. The corrected numbers are a RANGE, not a point: Pixi's render/tick cost
> depends heavily on ambient CPU load in a way three's does not (Pixi's CPU-bound batching
> degrades under contention; three's instanced draws barely move) — a lightly-loaded run and a
> genuinely-loaded run (~30–60% CPU from another process) disagree by 5–25× on Pixi alone, and
> both are real. (A tab-visibility hypothesis for that gap was raised and directly refuted: both
> the low and high runs were taken in tabs with identical `hidden:true`/`hasFocus:false` state, so
> visibility is not what separates them — recorded so nobody re-chases it.) Full reasoning and
> both endpoints are in
> `.superpowers/sdd/2026-08-27-three-renderer-phase-b4/task-B4.4-report.md`. Short version: three
> is still flat and still wins decisively at every checkpoint across both load conditions — that
> verdict does not change — but the millisecond values above should not be reused for anything
> quantitative, and neither should a single number from the corrected report without its range.

three.js render cost is **flat regardless of unit count** — one draw call per unit type, 3–4% of
the 16.7 ms frame budget. Pixi's grows with N and its p95 and max exceed the frame budget at
300–400 living units.

Three things make this trustworthy rather than merely pleasant:

- **three.js is genuinely drawing.** Hull instance counts match living counts exactly; a
  framebuffer readback with units hidden versus shown changes **28% of the frame's pixels**. A
  renderer that culled everything would also have measured flat and cheap.
- **The one asymmetry favours Pixi.** `isVisible()` returns `true` in three, so it draws every
  hostile; Pixi skips unobserved ones. **Pixi is drawing fewer sprites and is still ~10× slower.**
- **The frozen-sim window contains no combat.** Pixi blows the budget on static billboards alone,
  so "misses frames under sustained fire" understates it.

**Caveat for anyone re-baselining:** the headline "300" is a 266-living measurement — `spawnUpTo`
compares lifetime spawns, not living count, so casualties are never replaced. Re-run with counts
topped to exactly 300 and 400, render cost stayed flat at 0.65–0.69 ms. The shortfall costs
nothing for three and **flatters Pixi**, whose cost scales with N.

The sim's O(N²) detection debt is empirically confirmed in the tick column — superlinear from 150
to 300 — but still under 15% of the 50 ms / 20 Hz budget at 400 units. Not the ceiling yet.

## What Phase C inherits

**1. `isVisible()` returns `true` unconditionally, and the performance table was measured in that
state.** When B4 adds fog, three's render cost falls and Pixi's relative position shifts. **Do not
re-baseline off B3's table without re-measuring both backends.**

**2. Overlay anchoring must go through `groundWorldY`, never `worldToScreen`.**
`ThreeRenderer.worldToScreen` omits `lift` by design — that is the seam's contract, and B2's
outcome doc explains why. An HP bar or selection ring positioned from it **detaches from any unit
above elevation 0**. `unitsInScreenRect` already had to solve exactly this.

**3. The render-order band table is at `three/units/render-order.ts` and must stay the single
source.** HULL 0, TURRET 1, FX 2, FX_ABOVE 3. Phase C adds rings, bars, badges, hover and a focus
ring — all of which want bands above everything — so it is the next phase that most needs the
table, and the one most likely to re-fragment it.

The reason it exists is worth reading before adding a band: turrets and FX both sat at `1` for
several tasks, and because the FX constant was module-private **no cross-module test could
exist**. A tracer in front of a turret tied on `renderOrder`, tied again on `z` (every mesh sits
at local origin), and fell through to `Object3D.id` — so the turret painted over it, while the
same tracer in front of a hull drew correctly.

**4. `structure_collapse` and grinding-dust VFX do not exist.** Pixi's `structureHit` throws
grinding and shell dust (`renderer.ts:858-878`) and its `structureDestroyed` calls `beginCollapse`
plus `spawnCollapseFx('structure_collapse')`. Neither was ported: it fell between the task that
deferred it pending the incremental rebuild and the task that wired the events. **A dozer can
grind a wall down and destroy it under `?renderer=three` with no particle feedback whatsoever.**
Both are now reachable — the events are wired and the particle system is in place.

**5. Heap is roughly double GPU VRAM, and the cheap fix is unsafe today.** 584 MB of
`DataArrayTexture` across a 20-type roster, plus three.js's retained CPU-side `Uint8Array` copies —
measured tab heap 1211 MB. Releasing `image.data` post-upload would halve it, but three.js
0.170's `onContextRestore` **resets `WebGLProperties`, making that array the only recovery path
after a GPU context loss**, and this codebase has no `webglcontextlost` handling. Handle context
loss first, then release.

Note VRAM is fixed by **type count, not living count**: a 400-unit fight and a 20-unit fight
fielding the same types pay identically.

**6. `tools/src/perf/three-units.ts` is wired into neither `pnpm test` nor CI.** That is the exact
debt shape `CLAUDE.md` records for `playtest.ts`, which went red on `main` for days and nobody
noticed. **The 300-unit claim will silently rot unless C or D wires it.**

**7. Trails meet a bigger ceiling here.** `CLAUDE.md` records `drawTrail` as O(width × height ×
routes) at 5 Hz. Budget the trail mesh against 584 MB of GPU textures plus their CPU copies, not
against Pixi's footprint.

**8. Tracer lift uses `max(groundWorldY(start), groundWorldY(end))`.** Safe and better than the
burial it replaced, but a **low-ground shooter firing up at a plateau has its tracer start the
full height difference above its own barrel** — a ribbon detached from the unit that fired it.
Per-endpoint lifting fixes that end; neither scheme handles a ridge higher than both ends, which
is why it remains a design question rather than a one-line follow-up.

## Six defects found in the Pixi renderer while porting

Each was ruled on separately. The rule that emerged: **port faithfully when diverging would show;
take the correct behaviour when it is indistinguishable at the reference condition.**

1. **The road-rut parity branch is dead code.** `renderer.ts:1527`'s
   `(cx + cyG) % 2 === 0 ? 5 : 7` — every term is even, so `rut` is always 5. Zero odd cases over
   16,000 combinations. The per-tile variation the author intended has never rendered.
   *Ported faithfully and pinned; file upstream.*
2. **The building south wall never darkens with damage.** Investigated and found **not** a defect:
   `wear` is a fade toward the ground tone, so applying it to the near-black south wall would wash
   out the building's only shadow anchor. Deliberate. *Nothing filed.*
3. **Tracer TTL is frame-count based**, so tracer lifetime halves on a 120 Hz display — the same
   class of bug `anim.ts` deliberately avoids. *Diverged from: the seconds-based version is
   identical at 60 Hz and merely correct elsewhere.*
4. **Turret bearing is gated on `!type.isSoft`**, and `isSoft` is derived from armour
   (`sim.ts:429`). `gun_truck` (12 mm) and `technical` (15 mm) are both soft *and* the only two
   sheets shipping `turretAxisPx` — so Pixi excludes exactly the vehicles with turret art. Worse
   in the other direction: `dozer_d9` and `heli_peten` are non-soft with no turret art, so Pixi
   reads a `turretFacing` its own spring never updates — **a D9 that has turned 180° flashes its
   muzzle on its mission-start bearing.** *Fixed on the three side; file upstream.*
5. **The turret `fire` clip has never rendered, in either backend.** No hull sheet with turret art
   declares a `fire` clip, and the hull's `firingTimer` gates the turret's clip selection — so
   `GUNTRUCK_TURR`'s 16 facings of recoiled-barrel frames load and are never selected. *Fixed here
   with an independent `turretFiringTimer`.*
6. **Mid-slope clicking is wrong in Pixi too** — 1.33 tiles of error at elevation 4, which already
   exceeds `pickUnit`'s own 1.2-tile radius, so **57 terrace-edge tiles are unclickable in Pixi
   today.** three now matches Pixi tile-for-tile (2059 of 2116, 97%). Going further would make
   three *better* than Pixi and re-open a divergence right before Phase D diffs them.

## On testing — the part worth carrying hardest

**Twenty-three tests across three phases have passed while checking nothing.** Every single one
was found by deliberately breaking the thing and watching which test failed. Not one was found by
reading code.

This phase's contributions to that list: a depth constant measured at 4.7e-10 NDC — literally
inoperative — while a test asserting it passed; a turret test whose name promised "returns to hull
heading" while a turret that *never* returned passed it; a break check that used identical inputs
twice and could never have failed, caught by its own author; a billboard test that would have
accepted an ellipse; a `composeTerrain` affordance built specifically so a gap could be tested,
then left untested; and a parity suite that re-implemented the *old* wiring by hand and so
asserted a composition production no longer performed.

Two standards came out of it, and they cost nothing:

1. **A guard is not a guard until you have broken the thing and watched it fail.** Name the test
   that caught it and what it said. If the break is not caught, the test is wrong, not the break.
2. **Isolate the specific thing before claiming it.** A screenshot of a region is not evidence
   about one feature in it. The strongest demonstrations here changed *world* state and reasoned
   about what the alternative could not produce — and the single most valuable browser finding of
   the phase was a texture rendering **upside-down** while every headless signal (position,
   instance count, texture dimensions, material flags) read correct.
