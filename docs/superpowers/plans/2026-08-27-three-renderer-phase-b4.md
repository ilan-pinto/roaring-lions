# three.js Renderer — Phase B4: fog, and the last of the combat feedback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `isVisible` tells the truth under `?renderer=three` — unobserved ground and everything standing on it are hidden — and a building being ground down finally throws dust.

**Architecture:** Fog is a **separate overlay layer**, exactly as Pixi has it. The fog *computation* is pure and testable; the fog *mesh* is one more instanced quad set in the three.js scene, drawn above everything.

**Tech Stack:** TypeScript (strict), three.js 0.170, Vitest (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-08-26-three-renderer-design.md`
**What B3 handed over (read this first):** `docs/superpowers/specs/2026-08-27-phase-b3-outcome.md`

## Global Constraints

- **Branch:** `feat/three-renderer`, in the worktree at `.claude/worktrees/three-renderer`. Never touch the primary tree at `~/dev/roaring-lions`.
- **Never run** `git reset --hard`, `git checkout <branch>`, `git stash`, `git add -A`, or `git commit -a`. Stage explicit paths.
- `@lions/sim` must not change. No file under `packages/sim/`. `data/` and `assets/` must not change. **`renderer.ts` must not change** — it is the source, read-only.
- TypeScript strict mode. No `any`. **No non-null assertions**, production or test — lint does not fully enforce this and three have slipped through across the last two phases.
- Only `packages/render/src/three/**` may import `three`; `packages/render` may not import `@lions/data`; **`ThreeRenderer` must stay out of every barrel** — that regression put 464 kB of three.js in the default player's main chunk through all of Phase B1.
- **The render-order band table at `three/units/render-order.ts` is the single source.** HULL 0, TURRET 1, FX 2, FX_ABOVE 3. Fog needs a band above all of them; add it there, not locally. Turrets and FX silently collided at band 1 for several tasks because one constant was module-private, so no cross-module test could exist.
- Green on `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:ui` at every task boundary.
- **Pixi stays the default renderer.** `?sandbox=1` must be unchanged.
- **Shared machine.** Stop background processes by their own PID, never a pattern kill. Create your own browser tab with an explicit `tabId`. `document.visibilityState` is permanently `'hidden'` in this automation environment and `requestAnimationFrame` may not fire — call `renderer.frame()` directly and read synchronously.
- Baseline entering B4: **1213 tests / 72 files**, all green.

---

## Three rulings this plan is built on

**1. Phase B2's worry about fog was misplaced, and this plan corrects it.** That outcome doc says *"Fog has nowhere to go... colour reaches the GPU only as a baked vertex attribute through one shared `MeshBasicMaterial`. Per-tile fog needs either the 150 ms rebuild or a replacement shader sampling a fog texture — which must also preserve Phase 0's palette-exactness proof. Decide in B3, not B4."*

B3 did not decide it, and it turns out not to need deciding. **Pixi does not tint terrain to make fog.** `fogG` is a separate `Graphics` added to `world` *last* (`renderer.ts:551`), drawing a `#0A0A08` diamond over every non-visible tile — alpha 1 for never-seen, 0.55 for explored. It sits above terrain *and* units, which is what makes "unobserved ground and anything standing on it are hidden together" true.

So fog in three.js is one more mesh with a high render order. No shader, no rebuild, no palette question beyond the one already answered — `#0A0A08` is `shadow.2`, a palette entry, and its alpha blend is the same inherited-from-Pixi situation unit sprites already have.
*Cost if wrong:* none. This is strictly less work than the doc feared.

**2. The fog computation is pure and belongs outside `ThreeRenderer`.** `updateFog` and `hasSight` currently read `this.sim` directly, but everything they need is plain arrays: dimensions, `alive`, `side`, `typeIdx`, `posX`, `posY`, sight radius, `blocked`, and a `lowProfile` predicate. Extracted, the whole fog model becomes testable in `environment: 'node'` — which matters because `ThreeRenderer` constructs a `WebGLRenderer` and cannot be built there, and because fog is the one subsystem where a subtle error is invisible until a player complains that an enemy appeared out of nowhere.

**3. The last combat-feedback gap is pulled into this phase.** Destroying a structure produces **no particle burst at all** under `?renderer=three`, and a dozer grinding a wall throws no dust. It belongs to Phase C by scope, but it was pulled forward for the same reason Phase B3's combat tasks were: it is the visible thing the user asked for, and every part it needs — the particle system, the wired events, the emitter library — is already in place.

---

## What B4 does NOT do

- **No overlays.** Selection rings, HP bars, group badges, hover highlights, order markers and the tutorial focus ring are Phase C. `?renderer=three` becomes *honest to look at* in this phase, not playable.
- **No trails.** The tunnel-mark layer is Phase C, and `CLAUDE.md` records `drawTrail` as its own scaling debt.
- **No golden-image diff.** Phase D. But this phase is what makes that diff meaningful, since a diff taken while one renderer hides fogged units and the other does not differs everywhere fog applies.

---

## Task B4.1: the fog model, as pure functions

**Files:**
- Create: `packages/render/src/three/fog.ts`, `fog.test.ts`

**Interfaces:**
- Produces:
  - `computeFog(prev: Uint8Array, input: FogInput): Uint8Array` — per tile 0 never seen, 1 explored, 2 in sight now.
  - `hasSight(blocked: Uint8Array, w: number, isLowProfile: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number): boolean`
  - `isFogVisible(fog: Uint8Array, w: number, h: number, wx: number, wy: number): boolean`

Port from `renderer.ts:1020-1085`. Three details that are load-bearing and easy to lose:

- **Decay before reveal.** Every tile at 2 drops to 1 *first*, then living player units re-reveal. Explored is monotonic — a tile never returns to 0.
- **Only side 0 reveals**, and only living units.
- **`hasSight` is Bresenham over `blocked`, with a `lowProfile` exemption.** The comment at `:1080` explains why: a chest-high wall casts no fog shadow because the sim lets sight and fire cross it, and without the exemption "the compound's own garrison would be shooting at men the fog swears they cannot see."

- [ ] **Steps:** failing tests → implement → break checks → commit

Break checks, reporting which test caught each:
1. Reveal without decaying first (fog never dims when a unit walks away).
2. Let side 1 reveal.
3. Drop the `lowProfile` exemption.

Test the radius boundary specifically — `updateFog` scans a square of `ceil(sight)` then rejects on squared distance, so a tile at the corner of the scan box must not be revealed.

---

## Task B4.2: fog on screen, and `isVisible` starts telling the truth

**Files:**
- Create: `packages/render/src/three/fog-mesh.ts` + test
- Modify: `packages/render/src/three/ThreeRenderer.ts`, `three/units/render-order.ts`

Build the fog overlay: one quad per non-visible tile, `#0A0A08`, alpha 1 at fog level 0 and 0.55 at level 1, at the tile's own ground height. Add a `FOG` band above `FX_ABOVE` in the shared table.

Then wire `isVisible` to read the fog array, and run `computeFog` on the same cadence Pixi uses — `renderer.ts:733`, every fourth `snapshot()`, i.e. 5 Hz.

**Two things that change the moment this lands:**

- **Hostile units start disappearing.** `entityFrame` already carries the contact-level alpha, and Pixi's frame loop skips a non-player unit entirely when `!isVisible`. That skip becomes live here for the first time.
- **The fog quads must lift with the terrain.** Pixi's `drawFog` uses `groundOffset`; use `groundWorldY`. A fog quad at world Y 0 on a raised tile is *inside* the terrain and invisible — the exact failure particles hit in Phase B3, where the effect was buried rather than misplaced.

- [ ] **Steps:** implement → gate → browser check → commit

Browser: fog covers unexplored ground, dims explored ground, and hides a hostile standing in it. Walk a unit forward and watch the fog open. **Isolate the specific claim** — a Phase B2 task reported an effect "rendering distinctly" while it was occluded the whole time, because the observer described the scene rather than the feature.

---

## Task B4.3: a building that dies should look like it

**Files:** modify `packages/render/src/three/ThreeRenderer.ts`

Port the two missing effects from `renderer.ts`:

- **Grinding and shell dust on `structureHit`** — `:858-878`, using `isGrindingHit` and the `structPuffTick` cadence.
- **`spawnCollapseFx('structure_collapse')` on `structureDestroyed`**, alongside `beginCollapse`.

Everything needed is already present: the events are wired, `ParticleSystem` is running with the emitter library loaded, and `spawnCollapseFx` exists — `ThreeRenderer.ts:907` currently invokes it only for `tunnel_collapse`.

- [ ] **Steps:** implement → browser check → commit

Browser: grind a wall with a dozer and watch dust; destroy a building and watch it collapse. Compare against Pixi at the same moment.

---

## Task B4.4: re-measure the gate, and stop it rotting

**Files:** modify `tools/src/perf/three-units.ts`; add a CI or `pnpm` entry point.

**The 300-unit result was measured with `isVisible` returning `true` unconditionally**, so three.js was drawing every hostile while Pixi skipped its own fogged units. Now that fog is live, three draws fewer units and the comparison shifts — in three's favour, but the number is no longer the one that was reported.

Re-run the curve at 65 / 150 / 300 / 400 for both backends and publish the corrected table.

**Then wire the harness so the claim cannot silently rot.** `CLAUDE.md` records exactly this failure for `playtest.ts`: a manual gate, in neither `pnpm test` nor CI, that went red on `main` for days while everyone believed it was green. A performance harness that needs a browser cannot join `pnpm test` directly — so decide what it *can* join, and say why the choice actually catches a regression rather than merely existing.

- [ ] **Steps:** re-measure → wire → commit

---

## Self-review

**Spec coverage.** The spec assigns fog to Phase C; Phase B1's plan moved it into B, with the reason recorded — `isVisible` decides what is *drawn*, and Phase D's golden-image diff is worthless while the two backends disagree about what to draw. This plan honours that. The spec's remaining Phase C scope after B4 is overlays, trails, order markers and the tutorial focus ring.

**B3's inheritance.** Hazard 1 (`isVisible` unconditional, table measured in that state) → B4.2 and B4.4. Hazard 4 (`structure_collapse` and dust absent) → B4.3. Hazard 6 (the harness wired to nothing) → B4.4. Hazard 2 (overlay anchoring must use `groundWorldY`) applies to the fog mesh here and is called out in B4.2. Hazards 3, 5, 7 and 8 — the band table, the CPU-side texture retention, trails, and the tracer-lift design question — are **not** touched by this phase and carry forward unchanged.

**A divergence worth recording rather than fixing.** The renderer's `hasSight` is a flat Bresenham over `blocked`; `CLAUDE.md` records that the *sim's* line of sight reads elevation, so high ground sees over lower obstacles. **The fog model and the sight model therefore disagree on relief**, and Tel Marum is where that becomes visible. It is a pre-existing Pixi divergence, not something this port introduces, and porting it faithfully preserves it. Do not fix it here — but do not lose it either.

**Type consistency.** `FogInput` is defined in B4.1 and consumed by B4.2. `groundWorldY` comes from `three/ground-height.ts`; the band table from `three/units/render-order.ts`. Nothing new is introduced that a later task must rename.

**Ordering.** B4.1 is pure and independent. B4.2 needs it. B4.3 is independent of both and could run any time. B4.4 needs B4.2, since the whole point is measuring with fog live.
