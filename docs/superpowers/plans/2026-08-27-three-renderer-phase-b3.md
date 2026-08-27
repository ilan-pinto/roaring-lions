# three.js Renderer — Phase B3: units on the map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Units and structures drawn as instanced billboards under `?renderer=three`, depth-sorted from their feet by the depth buffer, at 300 units within frame budget.

**Architecture:** One draw call per unit type. Per-entity decisions — position, ground lift, clip, frame, facing, alpha — are made by **pure functions over plain arrays**, exactly as B2's terrain builders are, because `ThreeRenderer` cannot be constructed under `environment: 'node'`. The GPU side is an `InstancedMesh` per unit type reading a per-instance attribute set those functions produce.

**Tech Stack:** TypeScript (strict), three.js 0.170, Vitest (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-08-26-three-renderer-design.md`
**What B2 handed over (read this first):** `docs/superpowers/specs/2026-08-27-phase-b2-outcome.md`
**And its predecessor:** `docs/superpowers/specs/2026-08-26-phase-b1-outcome.md`

## Global Constraints

- **Branch:** `feat/three-renderer`, in the worktree at `.claude/worktrees/three-renderer`. Never touch the primary tree at `~/dev/roaring-lions` — other sessions work there with uncommitted files.
- **Never run** `git reset --hard`, `git checkout <branch>`, `git stash`, `git add -A`, or `git commit -a`. Stage explicit paths.
- `@lions/sim` must not change. No file under `packages/sim/`. `data/` and `assets/` must not change.
- TypeScript strict mode. No `any`. No non-null assertions.
- Green on `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:ui` at every task boundary.
- **The bundle rule, now lint-enforced from both ends.** `packages/app/src/**` (except `*.test.ts`) may not statically import `@lions/render/three`, `/terrain` or `/three-camera`; only `packages/render/src/three/**` may import `three` at all. A pure constant both backends need belongs in `project.ts`, which imports nothing.
- **`packages/render` may not import `@lions/data`** — ESLint bans it. Read JSON by relative path if you must, as `tones.ts` does.
- **Pixi stays the default renderer throughout B3.** `?renderer=three` is opt-in. Nothing a default-path player sees may change. Any edit to `renderer.ts` must be provably behaviour-neutral.
- **Shared machine.** Stop background processes by their own PID, never `pkill -f <pattern>`. Create your own browser tab and pass its `tabId` explicitly; never navigate the active tab. In this automation environment `document.visibilityState` is permanently `'hidden'` and `requestAnimationFrame` never fires — call `renderer.frame()` directly and read synchronously in the same task.
- Baseline entering B3: **993 tests / 61 files**, all green.

---

## Six rulings this plan is built on

**1. One draw call per unit type. Instanced billboards, never per-unit materials.**
`assets/sprites/` ships **3,101 PNGs at 256 px**. A `THREE.Sprite` or a per-unit material per entity means thousands of GPU textures and one draw call each — infeasible at any unit count, and unrelated to the architecture Phase F needs. Each unit type gets its frames packed into one texture (an atlas, or a `DataArrayTexture` layer per frame — the implementer chooses and justifies), drawn as a single `InstancedMesh` whose per-instance attributes carry position, frame index, facing and alpha.
*Why now:* the user's stated reason for this migration is larger maps with far more units, and this phase is gated on 300 of them. Building it the throwaway way first is waste.
*Cost if wrong:* the instancing layer is one file behind the pure decision functions; a different GPU strategy swaps it without touching them.

**2. Reuse `sheet.ts`, `clip.ts` and `anim.ts` unchanged.**
All three are already pure — `sheet.ts` and `anim.ts` import nothing, `clip.ts` imports one type — and already unit-tested. `resolveClip`, `clipOrFallback`, `cadenceScale`, `walkFps`, `phaseOffset`, `advancePhase`, `frameFileName`, `parseManifest`, `turretAxisOffset` are the animation model, and it is backend-agnostic already.
**Do not reimplement any of them.** A second clip resolver that "looks right" is how the two backends silently diverge on posture.

**3. Depth comes from the depth buffer, from the feet. `depthZ` is not ported — and neither are the two hacks built on it.**
Pixi sorts display objects on `x + y` and then patches the cases that breaks. `clearZ` lifts a garrisoned unit's sort key past its building's, and the same trick lifts a demolisher working a building's far face. **Both disappear in 3D**: a unit standing on a roof is at roof height and sorts correctly because it *is* in front; a demolisher at a building's north face is behind it, correctly, and its dust is what should read.
The four elevation debts in `CLAUDE.md` close here.
*Cost if wrong:* if a case genuinely needs an override, `renderOrder` exists — but reach for it only with a demonstrated failing case, never pre-emptively.

**4. Overlays are Phase C, not B3.** Selection rings, HP bars, group badges, hover highlights, order markers and the tutorial focus ring are not in this phase. `selection`, `unitGroup`, `hoverEntity`, `hoverStructure`, `hoverCanGarrison`, `objectiveZone` stay retained-and-unread. So does fog: `isVisible` keeps returning `true`, so enemy units are drawn regardless of contact — B4's job, and stated in the spec.
*Consequence to state plainly rather than discover:* `?renderer=three` is not playable at the end of B3. It is *watchable*. That is the phase's deliverable.

**5. The terrain rebuild is made incremental BEFORE `onEvents` is wired.**
B2 measured `rebuildTerrain()` at 114–179 ms, and Pixi marks terrain dirty on **every structure-damage event** (`renderer.ts:853`), not only on destruction. Wiring events first would give a ~150 ms full-scene stall several times a second in a firefight — a regression disguised as a feature.
*Cost if wrong:* if incremental rebuild proves harder than budgeted, the fallback is to wire only `structureDestroyed` and leave damage tint frozen — but that decision gets made with a measurement in hand, not before.

**6. Consolidate B2's duplication first, in one task, before anything is built on top of it.**
B2's outcome doc lists `hexToUnit` ×4, `levelAt` ×5, `pushQuad` ×3 closures, `rectCorners` ×2, `MARK_EPSILON` ×3, `DECOR_*` ×4, plus `structureFootprintsFor` duplicating a `ThreeRenderer` private method and `TERRAIN_THEMES` duplicating `main.ts:480-546`. Two of those were deferred *to this phase specifically* because closing them means editing `ThreeRenderer.ts`, which B2's later tasks were barred from.
B3 adds a sixth builder and a per-frame path. Consolidating after that is strictly more work.

---

## What B3 does NOT do

- **No overlays, no fog, no VFX, no trails.** Phase C and B4.
- **No mesh units.** Billboards using the existing sprites, per the spec's "billboards first". Meshes are Phase F.
- **No golden-image diff.** Phase D. B3's gates are the conformance suite, the palette guarantee, and the 300-unit measurement.
- **No `validate:assets` change.** Phase G.

---

## File Structure

| file | responsibility |
|---|---|
| `packages/render/src/three/terrain/shared.ts` | **new.** The consolidation target: `hexToUnit`, `levelAt`, `pushQuad`/`pushPolygon`, `rectCorners`, `MARK_EPSILON`, `DECOR_*`. |
| `packages/render/src/three/ground-height.ts` | **new.** Pure. `groundLevelAt(elevation, w, h, x, y)` and `groundWorldY(...)` — the three-side answer to Pixi's `groundOffset`. |
| `packages/render/src/three/units/frame-state.ts` | **new.** Pure. Per-entity decisions: interpolated position, lift, clip, frame, facing index, alpha, garrison roof offset. |
| `packages/render/src/three/units/atlas.ts` | **new.** Sheet → one GPU texture plus a frame→UV/layer index. Pure except the decode step. |
| `packages/render/src/three/units/instances.ts` | **new.** `InstancedMesh` per unit type; writes per-instance attributes from `frame-state` output. |
| `packages/render/src/three/units/pick.ts` | **new.** Pure. `pickUnit` and `unitsInScreenRect` against projected feet. |
| `packages/render/src/three/terrain/dirty.ts` | **new.** Pure. Which tiles a structure event invalidates. |
| `packages/render/src/three/ThreeRenderer.ts` | modified throughout. |
| `tools/src/perf/three-units.ts` | **new.** The 300-unit measurement harness. |

Every file above except `instances.ts`, `atlas.ts`'s decode step and `ThreeRenderer.ts` is pure and has a colocated `*.test.ts`.

---

## Task B3.1: consolidate what B2 left duplicated

**Files:**
- Create: `packages/render/src/three/terrain/shared.ts`, `shared.test.ts`
- Modify: `ground.ts`, `scatter.ts`, `grove.ts`, `buildings.ts`, `clamp.ts`, `terrain/index.ts`, `ThreeRenderer.ts`, `packages/app/src/terrain-parity.test.ts`

**Interfaces:**
- Produces: `hexToUnit(hex: string): [number, number, number]`, `levelAt(input: TerrainInput, x: number, y: number): number`, `pushPolygon(...)`, `rectCorners(...)`, `MARK_EPSILON`, `DECOR_ROAD`/`DECOR_GROVE`/`DECOR_KNOLL`/`DECOR_RIDGE`.

- [ ] **Step 1: Inventory before you move anything**

List every copy of each symbol with its file and line, and **diff the copies against each other**. B2's review found `structureFootprintsFor` byte-identical to `ThreeRenderer.structureFootprints()` and `TERRAIN_THEMES` identical across all 40 tone keys — but "identical today" is what you must verify, not assume. Any copy that has **drifted** is a finding: report which, and which version is correct, before consolidating.

Put the inventory in your report. It is the evidence that consolidation preserved behaviour.

- [ ] **Step 2: Move, then prove nothing changed**

The whole suite is the guard here — 993 tests covering four builders across five real maps. Run it after each symbol moves, not once at the end, so a regression names the symbol that caused it.

`screenOffsetToWorld` currently lives in `scatter.ts` (the grain module) while `grove.ts` and `buildings.ts` depend on it, and `WORLD_PER_LEVEL` lives in `ground.ts`. Move both to `shared.ts` or `project.ts` as appropriate — a projection primitive does not belong in the grain module.

- [ ] **Step 3: Extract `structureFootprints` and `TERRAIN_THEMES`**

`structureFootprintsFor` in `terrain-parity.test.ts` duplicates `ThreeRenderer.structureFootprints()`; `TERRAIN_THEMES` duplicates `main.ts:480-546`. Both were deferred to B3 because closing them means editing `ThreeRenderer.ts`. Give each one home and one importer path.

Note `main.ts` is in `packages/app` and cannot import from `packages/render/src/three/**` under the new lint rule. Work out where the shared themes actually belong and say why in your report — this is a dependency-direction question, not a copy-paste one.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(render): one home each for the terrain helpers B2 duplicated"
```

---

## Task B3.2: the ground-height query units need

**Files:**
- Create: `packages/render/src/three/ground-height.ts`, `ground-height.test.ts`

**Interfaces:**
- Produces: `groundLevelAt(elevation: Uint8Array | null, width: number, height: number, x: number, y: number): number` and `groundWorldY(...): number`.

B2's outcome doc, hazard 5: *there is no terrain-height query on the three side.* `ThreeRenderer.worldToScreen` omits `lift` by design — correct for the seam, useless for standing a unit on a terrace. Pixi's equivalent is `groundOffset` (`renderer.ts:706`), which reads the **containing tile** rather than interpolating the four corners, deliberately, so a unit crossing a terrace steps up rather than ramping. Match that; B2's ground mesh is terraced for the same reason and a ramping unit would float off it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { groundLevelAt, groundWorldY } from './ground-height';
import { WORLD_PER_LEVEL } from './terrain/shared';

const W = 4, H = 4;
const flat = null;
const stepped = new Uint8Array([
  0, 0, 3, 3,
  0, 0, 3, 3,
  0, 0, 3, 3,
  0, 0, 3, 3,
]);

describe('groundLevelAt', () => {
  it('is zero everywhere with no elevation layer', () => {
    expect(groundLevelAt(flat, W, H, 1.5, 2.5)).toBe(0);
  });

  it('samples the containing tile, not the nearest corner', () => {
    // Terraces, not ramps -- matching Pixi's groundOffset and B2's mesh.
    // Anywhere inside tile (1, y) is level 0; anywhere inside (2, y) is 3.
    expect(groundLevelAt(stepped, W, H, 1.01, 0.5)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 1.99, 0.5)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 2.01, 0.5)).toBe(3);
  });

  it('does not interpolate across the terrace edge', () => {
    // The failure this exists to prevent: a unit sliding smoothly up a cliff
    // face instead of stepping onto it, its feet hanging in mid-air the whole
    // way. Sampling two points either side of x = 2 must give exactly 0 and 3.
    const lo = groundLevelAt(stepped, W, H, 1.999, 1.5);
    const hi = groundLevelAt(stepped, W, H, 2.001, 1.5);
    expect(hi - lo).toBe(3);
  });

  it('clamps off-map rather than reading out of bounds', () => {
    expect(groundLevelAt(stepped, W, H, -1, -1)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 99, 99)).toBe(0);
  });
});

describe('groundWorldY', () => {
  it('converts levels to the same world height the mesh uses', () => {
    // Derived, not chosen: if these ever disagree, units float or sink.
    expect(groundWorldY(stepped, W, H, 2.5, 2.5)).toBeCloseTo(3 * WORLD_PER_LEVEL, 10);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, implement, watch it pass**

- [ ] **Step 3: Break check**

Make `groundLevelAt` interpolate between neighbours instead of sampling the containing tile. Confirm "does not interpolate across the terrace edge" fails and report what it said.

- [ ] **Step 4: Commit**

---

## Task B3.3: the per-entity frame decision, as a pure function

**Files:**
- Create: `packages/render/src/three/units/frame-state.ts`, `frame-state.test.ts`

**Interfaces:**
- Consumes: `resolveClip`, `clipOrFallback`, `cadenceScale` from `../../clip` and `../../sheet`; `walkFps`, `phaseOffset` from `../../anim`; `groundWorldY` from `../ground-height`.
- Produces:

```ts
export interface EntityFrame {
  /** three.js world position: game (x, y) -> (x, groundY + lift, y). */
  wx: number; wy: number; worldY: number;
  clip: ClipName;
  /** Index into the clip's frames, already advanced by elapsed time. */
  frame: number;
  facing: number;
  alpha: number;
  /** Screen-pixel offset for a garrisoned unit standing on a roof. */
  roofDx: number; roofDy: number;
  visible: boolean;
}

export function entityFrame(input: EntityFrameInput): EntityFrame;
```

This is where every decision in Pixi's `frame()` unit loop (`renderer.ts:1919` onward) that is **not** a draw call lives. Port it: interpolation between `prevX`/`curX` by `alpha`, the contact-level body alpha (`lvl === 2 ? 1 : lvl === 1 ? 0.65 : 0.35` for non-player sides), the garrison roof placement, the clip resolution and frame advance, the facing read via `fx.toNumber`.

**Do not port `clearZ`.** Ruling 3: the garrison and demolisher depth overrides exist because Pixi sorts on `x + y`; in three.js a unit on a roof is at roof height and a demolisher at the north face is genuinely behind. Delete the concept, and say in your report what you checked to be confident of that.

`EntityFrameInput` takes plain arrays and numbers — no `Sim`. `ThreeRenderer` assembles it.

- [ ] **Steps:** failing tests → implement → break checks → commit

Test at minimum: interpolation at `alpha` 0, 0.5 and 1; a raised tile lifting the unit; posture selection matching `resolveClip` for pinned, routed and firing; frame advance being **time-based rather than frame-count-based**, so playback is refresh-rate independent; a sheet missing a clip falling back to idle; and contact-level alpha for each of the three levels.

Break checks: make the frame advance depend on call count rather than elapsed time, and make the lift read elevation 0. Report which test caught each.

---

## Task B3.4: one texture per unit type

**Files:**
- Create: `packages/render/src/three/units/atlas.ts`, `atlas.test.ts`

**Interfaces:**
- Produces: `packSheet(sheet: SheetSpec): FramePacking` — pure, deciding *where each (clip, facing, frame) lands* — and `buildUnitTexture(basePath, sheet, packing): Promise<THREE.Texture>`, which does the loading.

The split matters: the packing decision is arithmetic and belongs under test; the decode is I/O and cannot be. `packSheet` must be callable with no DOM and no GPU.

`PARA_MOTOR` is a worked example: 16 facings × (4 idle + 1 down + 1 wreck) = 96 frames at 256 px. Say in your report what your packing does with it, what the largest shipped sheet needs, and how you stay inside a 4096 px texture limit — or why a `DataArrayTexture` is the better answer, which it may well be.

- [ ] **Steps:** failing tests → implement → commit

Test: every `(clip, facing, frame)` maps to a distinct region; no region overlaps another; the mapping is stable across calls; a sheet declaring more frames than fit fails **loudly** rather than silently overlapping.

---

## Task B3.5: units on screen

**Files:**
- Create: `packages/render/src/three/units/instances.ts`
- Modify: `ThreeRenderer.ts`

This is the task with something to look at. One `InstancedMesh` per unit type, camera-facing quads, per-instance attributes for position, frame, facing and alpha, feet on the ground.

**Two things to get right, both from B2's outcome doc:**

**Anchor at the feet, not the centre.** Depth is decided by where a unit stands. A quad centred on the entity sorts half a sprite too far back and clips into the terrain behind it.

**The billboard convention must match the trees'.** B2's groves are *baked* billboards: "right" = `screenOffsetToWorld(px, 0)`, "up" = world +Y, camera orientation frozen into static vertices. If units use `THREE.Sprite` or a shader billboard, the scene carries two conventions with different depth semantics and nothing tests that they agree. **Use the same convention, or change the trees to match, and say which you did and why.**

**And the tie the epsilons cannot arbitrate:** a unit standing at a grove tile's own anchor is an exact depth tie with the crown. B2's inter-lobe epsilons (0.005–0.04 world units) were designed for coplanar quads of *one tree* and cannot decide unit-vs-tree. Establish an explicit convention now — `renderOrder` bands, or a small feet-forward bias — and test it.

- [ ] **Steps:** implement → gate → browser verification → commit

Browser: `?sandbox=1&renderer=three` shows the task force standing on the ground, facing correctly, animating. Then Tel Marum: a unit behind a ridge is **occluded by it**, and a unit in front is not. Isolate the specific unit and the specific ridge; do not describe the scene as a whole.

---

## Task B3.6: turrets

**Files:** modify `frame-state.ts`, `instances.ts`, `atlas.ts` as needed; `ThreeRenderer.ts`.

Port the split hull/turret sheets. `turretAxisOffset(sheet, hullIndex, turretIndex)` in `sheet.ts` already gives the pixel offset between hull and turret pivots — use it; do not re-derive. `resolveTurretClip` in `clip.ts` picks the turret's own clip.

The gun truck ships 16 frames of recoiled barrels that were dead art until a bug was fixed in Pixi (`renderer.ts`'s `loadSprites` comment records it). Make sure every declared turret clip is reachable, not just idle.

- [ ] **Steps:** failing tests → implement → browser check → commit

---

## Task B3.7: structures as billboards

**Files:** create `packages/render/src/three/units/structures.ts` + test; modify `ThreeRenderer.ts`.

B2 draws every structure as a block, including those with art, deliberately — `groundTone` applies the under-structure tone to every blocked non-ridge tile because of it. **This task replaces the block with the sprite for structures that have art, and must move the ground tone with it**, or the mosque gets a dark patch under a sprite that does not cover its own footprint diamond. Pixi hit exactly this: `renderer.ts:1489-1491` paints the ground under a sprited structure for that reason, and its comment records that it was invisible while the mosque was the only sprited building and obvious once there were seven.

Structures without art keep the block. Wrecks — `drawWreckedStructures`, deferred out of B2 because it is sprite work — land here.

- [ ] **Steps:** failing tests → implement → browser check → commit

---

## Task B3.8: picking

**Files:** create `packages/render/src/three/units/pick.ts` + test; modify `ThreeRenderer.ts`.

`pickUnit` and `unitsInScreenRect` currently throw — the two members B1 deliberately left loud because an invented answer reads as "empty ground" and gets acted on.

Both are projection questions and both are pure: project each living entity's feet, compare against a point or a rect. No raycast needed, and no GL context — so both are testable headless, which is the point.

The spec assigns "`pickUnit` at known tiles, and picking mid-slope, which `CLAUDE.md` records as untested today" to Phase B. **Mid-slope is the case that matters** and Tel Marum is the only map that has one.

- [ ] **Steps:** failing tests → implement → browser check → commit

---

## Task B3.9: the terrain rebuild becomes incremental

**Files:** create `packages/render/src/three/terrain/dirty.ts` + test; modify `ThreeRenderer.ts`.

B2 measured `rebuildTerrain()` at **114–179 ms**, `buildScatter` being 97–145 ms of it. Ruling 5: this lands **before** events are wired.

`dirty.ts` is pure: given a structure event and the map, which tiles change? Everything else follows — per-structure sub-meshes, a dirty-region rebuild, or a partial attribute update, whichever the measurement supports.

- [ ] **Step 1: Measure first, and write the number down**

Record the current full-rebuild cost per map before changing anything. You are optimising against a number; produce it.

- [ ] **Steps:** measure → failing tests → implement → re-measure → commit

Report both numbers. A rebuild triggered by one structure taking damage must cost a small fraction of the full one; say what fraction you achieved.

---

## Task B3.10: wire `onEvents`

**Files:** modify `ThreeRenderer.ts`.

`onEvents()` has been a stub since B1. Wiring it closes three gaps at once: walls never darken as they take damage, destroyed structures vanish entirely rather than leaving a wreck, and terrain never reacts to anything.

Pixi sets `terrainDirty` from `onEvents` on `structureDestroyed` **and** on every damage event via `bumpStructureWear` (`renderer.ts:853`), which quantises to eight wear steps so a rifle plinking a 200 HP panel triggers a handful of redraws rather than one per round. **Port that quantisation** — it is the reason the event volume is survivable at all.

- [ ] **Steps:** failing tests → implement → browser check → commit

Browser: fire on a building under `?renderer=three` and watch it darken, then destroy it and watch the wreck appear. Measure the frame time during sustained fire and report it against Task B3.9's numbers.

---

## Task B3.11: the 300-unit gate

**Files:** create `tools/src/perf/three-units.ts`; modify nothing else.

The GDD targets 300 units. This migration exists because the user wants larger maps with far more units. **This task decides whether that is true, and it is pass/fail.**

- [ ] **Step 1: Build the harness**

A browser-driven page that stands up a `ThreeRenderer` on a real map, spawns N units, steps the sim, and reports per-frame render cost — separated from sim tick cost, so a slow tick is not mistaken for a slow renderer.

- [ ] **Step 2: Measure at 65, 150, 300 and 400**

65 is the largest currently authored mission; 300 is the target; 400 is where `CLAUDE.md` records GC pauses becoming visible. Report the curve, not just the target — a cliff between 150 and 300 is a different problem from a uniform slope.

- [ ] **Step 3: Compare against Pixi at the same counts**

The claim being tested is that three.js does this better. Measure both. If Pixi wins, that is the finding and it must be reported plainly rather than explained away.

- [ ] **Step 4: Report, and decide**

If 300 units is not within budget, **do not tune quietly** — report the number, the profile, and what would have to change. That is a phase-level finding and the user's decision.

---

## Self-review

**Spec coverage.** The spec's Phase B is "Terrain, elevation, buildings, and units drawn as camera-facing quads using the existing sprites… Real depth buffer." Terrain, elevation and buildings landed in B2; units and structure sprites land here (B3.5–B3.7), the depth buffer arrives with them, and `pickUnit`/`unitsInScreenRect` (B3.8) close the two members B1 left throwing. The spec's deferred "`isVisible` against fog" is explicitly **not** here — it needs fog, which is B4.

**B2's hazards.** Hazard 1 → B3.9 and B3.10, in that order, per ruling 5. Hazard 2 (baked damage tint) → B3.10. Hazard 3 (epsilons cannot arbitrate unit-vs-tree) → B3.5, called out explicitly. Hazard 4 (two billboard conventions) → B3.5, which must pick one. Hazard 5 (no terrain-height query) → B3.2. Hazard 6 (duplication) → B3.1, first, per ruling 6. Hazard 7 (fog has nowhere to go) is **not resolved here** — B3 keeps the baked-vertex-colour material for terrain and adds a textured material for units, so the fog decision is still open. That is a known gap and B4 owns it; it is called out so B4's author does not find it as a surprise.
Hazard 8 (the toon shader has never been compiled) stays open — B3's units are textured billboards, not toon-shaded meshes, so the first GLSL compile of `toonRampMaterial` is still Phase F's risk.

**Placeholder scan.** Tasks B3.6 through B3.11 give steps as summaries with source line references rather than full code blocks, deliberately: each is either a port of a specific existing function or a measurement task whose code depends on what the previous task built. Every *interface* is fully specified, and every task states what its tests must cover.

**Type consistency.** `EntityFrame`/`EntityFrameInput` are defined in B3.3 and consumed by B3.5–B3.7. `FramePacking` is defined in B3.4 and consumed by B3.5. `groundWorldY` (B3.2) is consumed by B3.3. `MeshData`/`TerrainInput` keep B2's definitions in `terrain/types.ts`. `shared.ts` (B3.1) is the home for everything B2 duplicated, and must exist before any later task imports from it.

**Ordering.** B3.1 and B3.2 are independent and both pure. B3.3 needs B3.2. B3.4 is independent. B3.5 needs B3.3 and B3.4 and is where anything becomes visible — task five of eleven, deliberately, so the phase produces something watchable before its infrastructure half. B3.6–B3.8 each need B3.5. B3.9 needs B3.1. B3.10 needs B3.9, per ruling 5. B3.11 needs everything.

---

# Addendum: combat feedback, pulled forward

**Added 2026-08-27, after the user reviewed the running build.** Units were visible and
selectable but nothing shot at anything: no tracers, no muzzle flashes, no hits, no deaths.
The spec puts VFX in Phase C, and on paper that ordering was right — get the world and its
inhabitants correct, then dress them. In practice every look at the build reads as broken
rather than partial.

So these three tasks run **next**, ahead of B3.6 (turrets), B3.7 (structure sprites), B3.9
(incremental terrain rebuild), B3.10 (`onEvents`) and B3.11 (the 300-unit gate).

## What the research found, and why this is cheaper than it looks

**`ParticleSystem` is already backend-agnostic.** `packages/render/src/vfx/particles.ts` has
exactly one Pixi reference — `import type { Graphics }` — which is a **type-only** import and
erases at runtime. `spawn()` and `step()` are pure struct-of-arrays maths over `Float64Array`s.
Only `draw()` is Pixi-shaped, and only in its parameter type.

`vfx/emitters.ts` (`EmitterLibrary`, `EmitterSpec`, `ParticleSpec`) and `vfx/power.ts`
(`firePower`) import nothing at all.

So the three.js backend reuses the entire particle model and writes its own draw. **Do not
reimplement particle stepping.** Two particle simulations diverging is a bug nobody can see
and everybody can feel.

## Ruling: `onEvents` splits in two, and only half needs the rebuild work

Pixi's `onEvents` (`renderer.ts:756`) handles nine kinds: `fire`, `impact`, `nearMiss`, `aps`,
`strike`, `destroyed`, `tunnelCollapsed`, `structureHit`, `structureDestroyed`.

Ruling 5 of this plan says the terrain rebuild must be made incremental before `onEvents` is
wired, because Pixi marks terrain dirty on **every structure-damage event** and a full rebuild
costs 114–179 ms. That ruling stands — **but it only binds the last two kinds.**

The other seven are pure presentation: they spawn particles, start a muzzle flash, push a
tracer, begin a death fade. **None of them touches terrain.** So combat feedback can land now,
and `structureHit`/`structureDestroyed` wait for B3.9 exactly as planned.

*Cost if wrong:* none identified. The split is along the line the events themselves draw.

---

## Task B3.12: a backend-agnostic read path for particles and tracers

**Files:**
- Modify: `packages/render/src/vfx/particles.ts`
- Create: `packages/render/src/three/units/tracers.ts` + test

**Interfaces:**
- Produces on `ParticleSystem`: `forEachLive(layerIdx, cb)` — or an equivalent read accessor —
  exposing position, colour, alpha and radius per live particle **without** naming a graphics
  library.
- Produces: `stepTracers(tracers, dt)`, `TracerModel` — the `Tracer[]`-with-ttl model from
  `renderer.ts:95` and `:2597-2601`, extracted pure.

`ParticleSystem`'s per-particle fields are private and `draw()` is the only accessor. Add a read
path rather than making the fields public: the sampling of colour, alpha and size curves
(`sampleStep`/`sampleLerp` at the top of the file) is real logic, and both backends must get the
identical answer or the same emitter looks different in each.

**This edits a file Pixi uses.** It must be provably additive — `draw()` keeps working
byte-identically, and the 1091-test suite is the guard. Run it after the change and say so.

- [ ] **Steps:** failing tests → implement → break check → commit

Test that the read path yields exactly what `draw()` would have drawn for the same state: same
positions, same sampled colour, same alpha, same radius, same layer filtering, same skip of
`alive === 0` and of `r <= 0 || alpha <= 0`.

Break check: change the curve sampling in the read path only, and confirm a test catches the
divergence between the two accessors.

---

## Task B3.13: VFX on screen

**Files:**
- Create: `packages/render/src/three/units/fx.ts` + test
- Modify: `packages/render/src/three/ThreeRenderer.ts`

`useEmitters` currently retains its argument and returns. Wire it: build the `EmitterLibrary`,
hold the `resolve` callback, and construct a `ParticleSystem` — the same `2048` capacity Pixi
uses (`renderer.ts:644`).

Draw particles and tracers in `frame()`. Instanced quads are the obvious shape, matching the
unit billboards; whatever you choose, **one draw call for all particles** is the target, for the
same reason units got one per type.

**Depth.** Pixi has two particle layers, `FX_LAYER_BELOW` and `FX_LAYER_ABOVE`, drawn either
side of the sprite layer. In three.js that is a depth question, not a layer-order one — a
particle is at a world position and the depth buffer sorts it. Say in your report how you
handled the two layers and whether the distinction survives translation.

Note `CLAUDE.md` records a known Pixi debt here: `trailG`, `fxG` and `wreckLayer` sit below
`spriteLayer` unconditionally, so a tracer in front of a ridge is covered by it. **In three.js
that debt should simply not exist.** If it does, say why.

- [ ] **Steps:** implement → gate → browser check → commit

Browser: particles must appear where Pixi's do. Compare the same emitter side by side.

---

## Task B3.14: the presentation half of `onEvents`

**Files:** modify `packages/render/src/three/ThreeRenderer.ts`; extend `frame-state.ts` if
recoil and flinch need per-entity timers.

Wire the seven presentation kinds: `fire`, `impact`, `nearMiss`, `aps`, `strike`, `destroyed`,
`tunnelCollapsed`. Port from `renderer.ts:756` onward — muzzle flash position and direction,
tracer spawn (including the "shots at buildings carry target −1: aim the tracer at the building"
case at `:759`), impact effects, the death fade in `stepDeaths`, and the recoil and flinch
decay timers `frame()` drains at its top.

**Do NOT wire `structureHit` or `structureDestroyed`.** They mark terrain dirty, and Task B3.9
must make that incremental first — a full rebuild is 114–179 ms and Pixi fires these on every
damage event. Leave them unhandled with a comment saying which task owns them.

- [ ] **Steps:** failing tests where the logic is pure → implement → browser check → commit

Browser: fire a real mission under `?renderer=three` and watch a firefight. Tracers, flashes,
impacts, deaths. Compare against Pixi at the same moment.
