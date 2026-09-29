# WP-A4 readability remainder (GH-186). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only the units that matter carry an HP bar, and a selected unit is marked by a ring on the ground in its team colour:
- an HP bar draws only when its unit is damaged, selected or hovered;
- selection is a terrain-conforming ground ring in the team colour, not a screen-space billboard ellipse;
- the occlusion outline stays exactly as it is.

**Architecture:**
- **The HP rule is a pure predicate.** `hpBarVisible` lives in `units/overlays.ts` and is called from the existing HP-bar block of `ThreeRenderer.updateOverlays` (`ThreeRenderer.ts:7773`).
- **The ring is a new `SelectionRingBatch`** in `units/selection-ring.ts`. It is one non-instanced mesh, rewritten every frame. It reuses the decal pool's pure conforming-grid maths (`writeDecalGrid`, `writeDecalOffsets`, `writeGridIndices`, `gridTriangles` from `decal-maths.ts`) but not `DecalPool` itself, whose multiply blend and sim-time ring buffer are wrong for this (spec §1).
- **Ring sizes and alphas are one table**, `units/readability.ts`. It is pure, needs no `THREE`, and is the only place a number approved at G-NUM lives.
- **What is untouched:** the `Renderer` seam (`api.ts`), `main.ts`, Pixi (`renderer.ts`) and `packages/sim/**`.

**Tech stack:** TypeScript strict, vitest (node environment; `THREE` objects construct under node, as `fx.test.ts` does), Playwright for the mock sheet and the drive, and the existing `tools/src/perf/render-frame-cost.ts`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-a4-readability-design.md`. §1 holds the measured current state, §3 the numbers table, §4 the gate effect and §5 the perf budget.

**Base:** branch `feat/a4-readability`, cut from `main` `1035b18c` (v0.89.1). Worktree `/Users/ilpinto/dev/roaring-lions-ep/a4`.

**Order and the gates:**
1. **Task 1** measures the footprints and writes the numbers module, then **stops at gate G-NUM**. The lead approves the §3 table before anything is rendered.
2. **Task 2** (HP rule) and **Task 3** (ring batch, unwired) start after G-NUM and may run in parallel. They touch different files, apart from Task 2's small edit to `ThreeRenderer.ts`.
3. **Task 4** builds the mock sheet from the approved numbers and **stops at gate G-MOCK**.
4. **Task 5** wires the ring into the renderer, only after G-MOCK.
5. **Task 6** handles the visual-gate precondition and measures the move locally.
6. **Task 7** lands.

---

## Pre-flight: open questions (spec §6)

**Default:** if the lead gives no answer, take the recommended ruling and record it in the Task 7 HANDOVER entry.

| # | Question | Recommended |
|---|---|---|
| Q1 | Ring in team colour or control-group colour? | Team. Group colour stays on the badge. |
| Q2 | Should any damage show the bar, or only below 95%? | Any damage. |
| Q3 | Should the suppression bar follow the HP rule? | No. It keeps its own `> 0.02` rule. |
| Q4 | Halo on the ring? | On, unless the mock shows it muddy. |
| Q5 | HP bar width per class? | No. 24 px everywhere. |
| Q6 | Add a gate witness for the ring? | Not in A4. Record the gap. |
| Q7 | Garrisoned units keep the billboard ring at roof height? | Yes. |
| Q8 | A hover linger? | No (0 ms). |

---

## Global Constraints

- **The sim is untouched.** At landing, `git diff --stat 1035b18c..HEAD -- packages/sim` is empty, and `pnpm test:determinism`, `pnpm balance` and `pnpm playtest` are unchanged.
- **Three-only.** `packages/render/src/renderer.ts` stays byte-identical, and Pixi owes no parity (CLAUDE.md). `api.ts` does not change: both hover fields already cross the seam.
- **No status marks in the world** (the lead, 27 Sep). A4 restyles two marks that already exist. The HP-bar frame and the ring halo are part of that restyle, so they appear on the Task 4 mock and are built only after G-MOCK. Nothing else is added to the world. If anyone proposes another in-world element mid-plan, it becomes a new plan, not a task here.
- **Numbers before rendering** (memory: "approve art numbers before rendering"). Only Task 1 may introduce a number. Every later task imports it from `units/readability.ts`, and no later task retypes a literal.
- **Colour comes from the palette.**
  - Ring: `opts.teamColors[side]`, which is already colour-vision-variant aware.
  - Halo and bar frame: `shadow.1`, through `this.overlayColor`/`hexToLinear`.
  - No hex literal outside the existing `overlayColor` fallback arguments.
- **Render order.** Every `renderOrder` comes from `units/render-order.ts`, and the new `SELECTION_RING_RENDER_ORDER` is added there with its ordering pinned in a test.
- **Strict TypeScript.** No `any`. No non-null assertions outside tests. Tests are colocated `*.test.ts`.
- **Every check is seen red.** Each task names mutations that must turn a named test red, and the commit message quotes the red line.
- **Drive the real UI** for anything visible (memory: "verify UI features by driving the UI").
  - Select with a real left-click and a real box-drag on the canvas, and hover with real pointer moves. Never set `renderer.selection` or `__lions.sel(...)` in the drive. `sel` is allowed only in the perf harness and the mock capture, where the selection is scaffolding, not the thing under test.
  - Never `pkill` vite. Use the dev server that is already running, or `preview_start` from this worktree (memory: preview_start is pinned to the launch directory).
  - Force a frame before any read-back, because rAF is throttled in a hidden tab.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test`. Add `pnpm golden-baseline` locally in Tasks 5 and 6, **for its report only**. Never bless locally: the darwin baseline is stale (memory: "bless the visual baseline from CI numbers only").
- **Git.**
  - Stage explicit paths only: `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, never `git checkout -- <file>`.
  - Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Do not push. The lead merges.

---

## File structure

| File | Role | Task |
|---|---|---|
| `tools/src/perf/unit-footprints.ts` (+test) | **New.** Reads each shipped unit GLB's `POSITION` accessor min/max straight from the GLB JSON chunk (no three) and prints the half-diagonal footprint per ring class | 1 |
| `packages/render/src/three/units/readability.ts` (+test) | **New.** `RingClass`, `ringClassOf`, `SELECTION_RING`, `HP_BAR`; the §3 numbers, nothing else | 1 |
| `packages/render/src/three/units/overlays.ts` (+test) | `hpBarVisible`, `HpVisibilityInput` | 2 |
| `packages/render/src/three/ThreeRenderer.ts` | HP rule and frame (2); ring wiring, billboard fallback, debug layer (5) | 2, 5 |
| `packages/render/src/three/ThreeRenderer.midspawn.test.ts` | Its anti-vacuity "resident tank's HP bar WAS drawn" now needs a damaged or selected resident | 2 |
| `packages/render/src/three/units/selection-ring.ts` (+test) | **New.** `SelectionRingBatch`, `createSelectionRingMaterial`, `writeRingAttributes` | 3 |
| `packages/render/src/three/units/render-order.ts` (+test) | `SELECTION_RING_RENDER_ORDER = 0.5` | 3 |
| `.superpowers/a4-mock/` (git-ignored) | `gen.ts`, `sheet.html`, `sheet.png`, `sheet-x4.png` | 4 |
| `packages/render/src/three/debug-layers.ts` (+test) | The `overlays` layer also hides the ring mesh | 5 |
| `tools/src/perf/render-frame-cost.ts` | Optional `--select-all` so the ring's CPU cost is measured | 5 |
| `data/palette.json` | `group.role` note: the badge only, no longer the selection ring (Q1) | 5 |
| `tools/src/golden-diff/capture-protocol.ts`, `baseline.ts` (+tests) | Assert `selection.length === 0`, `hoverEntity === -1` and `rangeRingPreview === -1` at capture | 6 |
| `docs/HANDOVER.md` | The landing entry | 7 |

---

## Task 1: Measure footprints, write the numbers module (gate G-NUM)

**Model:** sonnet. The measurement is mechanical, and the judgement belongs to the lead at the gate.

**Files:**
- `tools/src/perf/unit-footprints.ts` and its test
- `packages/render/src/three/units/readability.ts` and its test

**Interfaces (produced):**

```ts
// readability.ts
export type RingClass = 'foot' | 'light' | 'armour' | 'air';
/** isAir first, then wheeled && isSoft -> light, wheeled -> armour, else foot. */
export function ringClassOf(t: { isAir: boolean; wheeled: boolean; isSoft: boolean }): RingClass;
export const SELECTION_RING: {
  readonly radiusTiles: Readonly<Record<RingClass, number>>; // outer edge of the core
  readonly thicknessTiles: number;   // 0.06
  readonly minThicknessPx: number;   // 1.5, screen px
  readonly featherTiles: number;     // 0.015
  readonly coreAlpha: number;        // 0.9
  readonly haloTiles: number;        // 0.03, outside only
  readonly haloAlpha: number;        // 0.35; 0 means off (Q4)
  readonly capacity: number;         // 256
};
export const HP_BAR: { readonly widthPx: 24; readonly heightPx: 3; readonly framePx: 1; readonly frameAlpha: 0.8 };
```

- [ ] **Step 1: Write the footprint tool.** Parse the GLB header, then the JSON chunk. For every mesh primitive, take the `POSITION` accessor `min`/`max` and apply each node's scale from the scene graph. Multiply by `MESH_SCALE` (`units/mesh-anim.ts:80`), imported rather than retyped. Report the half-diagonal in tiles.
  - Group the units by `ringClassOf`, reading `isAir`/`wheeled`/`isSoft` through the same loader the sim uses (`@lions/data`).
  - Print one row per unit and the maximum per class.
  - Test it on a GLB built by `mesh-fixture.ts`'s `buildFixtureGlb` with a known 2 × 1 box: it must report `√(1² + 0.5²) · MESH_SCALE`.
- [ ] **Step 2: Write the failing tests for `readability.ts`.**

```ts
it('classifies by the sim\'s own flags, air first', () => {
  expect(ringClassOf({ isAir: true, wheeled: true, isSoft: true })).toBe('air');
  expect(ringClassOf({ isAir: false, wheeled: true, isSoft: true })).toBe('light');
  expect(ringClassOf({ isAir: false, wheeled: true, isSoft: false })).toBe('armour');
  expect(ringClassOf({ isAir: false, wheeled: false, isSoft: true })).toBe('foot');
});
it('rocket_battery is light (authored wheeled, armour 10 < SOFT_ARMOR_LIMIT), mortar_team is foot', () => { /* load both from data/units */ });
it('every class ring clears 1.15x its measured largest footprint', () => { /* reads the tool's exported table */ });
it('the thickness floor holds at the zoom clamp', () => {
  expect(Math.max(SELECTION_RING.thicknessTiles * 45.25 * 0.35, SELECTION_RING.minThicknessPx)).toBeGreaterThanOrEqual(1.5);
});
```

- [ ] **Step 3: See red, then implement.** Start from spec §3's proposed values. Where the measured `1.15 × footprint` exceeds a class value, raise that value (never lower one), and say so in the G-NUM note.
- [ ] **Step 4: Falsify.** Each mutation must turn the named test red:
  - Set `radiusTiles.armour = 0.40` (today's ring): "clears 1.15x" fails for `mbt_lavi`.
  - Swap the air and light checks in `ringClassOf`: "air first" fails.
  - Set `minThicknessPx = 0`: "floor holds" fails.
- [ ] **Step 5: Commit** both modules, wired nowhere. Message: `feat(render): A4 readability numbers and unit footprints (GH-186)`.
- [ ] **Step 6: GATE G-NUM.** Send the lead the spec §3 table, with the measured footprint column filled in and any raised rows marked, plus Q1, Q2, Q4 and Q5. **Stop.** Nothing renders until the numbers are approved. If the lead changes a number, change it only in `readability.ts` and re-run Step 4.

---

## Task 2: The HP bar visibility rule and frame (after G-NUM)

**Model:** sonnet.

**Files:**
- `units/overlays.ts` and `overlays.test.ts`
- `ThreeRenderer.ts` (the block at `:7773-7786`)
- `ThreeRenderer.midspawn.test.ts`
- A new `ThreeRenderer.hp-visibility.test.ts`, built on the `ThreeRenderer.route.test.ts` fixture pattern: real `updateOverlays`, spy on `overlayBatch.rect`

**Interfaces (produced):**

```ts
// overlays.ts
export interface HpVisibilityInput {
  readonly hpRaw: number; readonly maxHpRaw: number;   // Q16.16, compared raw -- no toNumber
  readonly selected: boolean; readonly hostileHover: boolean; readonly friendlyHover: boolean;
}
export function hpBarVisible(v: HpVisibilityInput): boolean;
```

- [ ] **Step 1: Write the failing tests.**
  - Pure: full health with no flags → false; one raw unit of damage → true; each of the three flags alone → true.
  - Renderer: a sandbox with a full-health tank, a damaged tank, and a selected rifle squad. After one `frame()`, bar rects are anchored at the damaged tank and the selected squad, and none at the healthy tank.
  - Then set `renderer.hoverEntity` to an observed hostile, and `rangeRingPreview` to the healthy tank. Each now gets a bar.
  - Frame: every drawn bar is exactly three rects (frame, backing, fill), and the frame is `HP_BAR.widthPx + 2 * HP_BAR.framePx` wide.
- [ ] **Step 2: See red. Implement.** The predicate goes in `overlays.ts`. The renderer calls it with `st.hp[i]`, `type.hp`, `this.selection.includes(i)`, `i === this.hoverEntity` and `i === (this.rangeRingPreview ?? -1)`. Leave suppression, pips, badge and chevron exactly where they are.
- [ ] **Step 3: Repair `midspawn`'s anti-vacuity honestly.** Give the resident tank one point of damage in the fixture, so "its HP bar WAS drawn" still has teeth. Do not delete the assertion.
- [ ] **Step 4: Falsify.** Each mutation must turn the named test red:
  - `return true` in `hpBarVisible`: "full health with no flags draws no bar" fails.
  - Compare with `toNumber(hp) < toNumber(max) - 0.5`: "one raw unit of damage" fails.
  - Drop the `friendlyHover` term: the `rangeRingPreview` case fails.
  - Revert `midspawn`'s fixture change: its anti-vacuity fails. That proves the repair was needed rather than cosmetic.
- [ ] **Step 5: Drive.** On `?sandbox=beit_sahwan_outskirts&sur`:
  - At zoom 1.0, no friendly bar shows.
  - Hover a Lavi with the real pointer, and its bar appears. Move off it, and the bar goes.
  - Click-select a squad, and its bar shows. Deselect with an empty-ground click, and it goes.
  - Order the Lavi into Sarim fire and wait for a hit: the bar stays up after deselection.
  - Take screenshots at zoom 1.0 and 1.6.
- [ ] **Step 6: Commit.** Message: `feat(render): HP bars only when damaged, selected or hovered (GH-186)`.

---

## Task 3: `SelectionRingBatch`, built and tested, not wired (after G-NUM)

**Model:** opus. The shader annulus, the pixel floor and the conformance trade are judgement calls.

**Files:**
- `units/selection-ring.ts` and its test
- `units/render-order.ts` and its test

**Interfaces (produced):**

```ts
export const SELECTION_RING_RENDER_ORDER = 0.5; // render-order.ts
export interface RingPlacement { readonly x: number; readonly z: number; readonly radiusTiles: number; readonly color: readonly [number, number, number] }
export class SelectionRingBatch {
  readonly mesh: THREE.Mesh;
  constructor(opts: { capacity: number; resolveShadow: () => readonly [number, number, number] });
  beginFrame(): void;
  /** false when full -- the caller then draws the billboard fallback. */
  push(p: RingPlacement, sampleY: (x: number, z: number) => number): boolean;
  endFrame(zoom: number): void; // sets drawRange, mesh.visible = count > 0, uPxPerTile from zoom
  dispose(): void;
}
```

- [ ] **Step 1: Write the failing tests.**
  - `push` writes an `n = 4` grid whose vertices are `writeDecalGrid`'s own output, cross-checked by calling it directly on the same placement.
  - The half-extent is `radiusTiles + haloTiles + featherTiles`, so the halo is never clipped by the quad.
  - Colour is repeated per vertex. On flat ground every `y` equals `sampleY + MARK_EPSILON`.
  - `endFrame` at count 0 sets `mesh.visible === false`, which is what makes the perf claim "+1 draw call only while selected" true.
  - A push past `capacity` returns `false` and draws nothing.
  - Material: `depthTest` true, `depthWrite` false, `transparent` true, `polygonOffsetFactor/Units` equal `DECAL_POLYGON_OFFSET_*`, `castShadow`/`receiveShadow` false.
  - The fragment string contains every `SELECTION_RING` constant through `glslFloat` (the `decal-pool.test.ts` precedent), and no hex literal. `glslFloat` is private at `decal-pool.ts:377`: export it from there rather than copying it.
  - `render-order.test.ts`: `DECAL_FADING_RENDER_ORDER < SELECTION_RING_RENDER_ORDER < TURRET_RENDER_ORDER`.
- [ ] **Step 2: See red. Implement.**
  - The shader computes `d = length(aOffset) * halfExtent`, in world tiles.
  - The core runs from `R - w` to `R`, where `w = max(thicknessTiles, minThicknessPx / uPxPerTile)`, with smoothstep feathers.
  - The halo is the band outside `R`, at `haloAlpha`, in `shadow.1`.
  - Output premultiplied "over". The shader is unlit: there is no light uniform and no fog read. The post chain's fog pass dims it like the ground under it.
- [ ] **Step 3: Falsify.** Each mutation must turn the named test red:
  - Set `depthTest: false`: the material test fails.
  - Drop `mesh.visible = count > 0`: the count-0 test fails.
  - Retype `0.06` as a literal in the GLSL: the `glslFloat` test fails.
  - Set the render order to 1: the ordering test fails.
- [ ] **Step 4: Commit** it unwired. Message: `feat(render): selection ground ring batch, unwired (GH-186)`.

---

## Task 4: Mock sheet at gameplay zoom and ×4 (gate G-MOCK)

**Model:** opus. The task makes the lead's decision material.

**Files:** `.superpowers/a4-mock/`, git-ignored scratch. Nothing is committed.

- [ ] **Step 1: Capture the real frames with Playwright** from the running dev server:
  - `?sandbox=beit_sahwan_outskirts&sur`, on sand;
  - `?sandbox=wadi_halam_basin`, on green ground;
  - the same sand scene with `colorVision` set to deuteranopia.

  Take each at zoom 1.0 and 1.6, at device scale 1 (`sheet.png`) and 4 (`sheet-x4.png`), with `__lions.renderer.setDebugLayerVisible('overlays', false)`. `sel` is scaffolding here: select a mixed group of an `inf_squad`, a `jeep_shoded`, an `mbt_lavi` and the `recon_drone`, There is no sim damage hook (`sim.ts` has `debugKill` and `debugSuppress` only), so a damaged bar is composited in Step 2.
- [ ] **Step 2: Composite the candidates in SVG** over each frame, positioned by `renderer.worldToScreen` and sized from `readability.ts`, imported rather than retyped (the pinned-feedback `gen.ts` pattern). World radius `R` projects to an ellipse `R · 45.25 · zoom` by half that. Rows:
  1. **Today**, for comparison: the real overlays on, nothing composited.
  2. **Proposed:** the approved radii, thickness, alpha and halo; HP bars only on the damaged and selected units; the 1 px frame.
  3. **Halo off** (Q4).
  4. **Group colour instead of team colour** (Q1).

  Label the flat-ground approximation on the sheet. Conformance on slopes is proved in Task 5's drive on `tel_marum`, not here. Draw the damaged bar from the numbers on one named unit, and label it composited.
- [ ] **Step 3: GATE G-MOCK.** Publish `sheet.html`, with both PNGs embedded, as a private Artifact. Send the lead the link and Q1 and Q4. **Stop.** Task 5 waits for the answer.

---

## Task 5: Wire the ring (after G-MOCK), drive it, and measure it

**Model:** sonnet.

**Files:**
- `ThreeRenderer.ts`
- `debug-layers.ts` and its test
- `tools/src/perf/render-frame-cost.ts`
- `data/palette.json` (`group.role`)
- A new `ThreeRenderer.selection-ring.test.ts`

- [ ] **Step 1: Write the failing tests** (renderer fixture):
  - A selected unit on open ground pushes exactly one ring and no `ellipseRing` billboard. Its radius is `SELECTION_RING.radiusTiles[ringClassOf(type)]`, and its colour is `teamColors[side]`.
  - A garrisoned selected unit pushes no ring and one billboard `ellipseRing` at roof height (Q7).
  - With capacity 2 and 3 selected, 2 rings and 1 billboard are drawn: the fallback.
  - With no selection, the mesh is not visible.
  - `setDebugLayerVisible('overlays', false)` hides the ring mesh too, and the count returned includes it.
- [ ] **Step 2: See red. Wire it.**
  - Construct the batch where `decalsFading` is built (`:2268`), and parent it beside the decal meshes.
  - In `updateOverlays`, replace the `:7838-7843` billboard for non-garrisoned units with `selectionRing.push(...)`. Keep the billboard for garrisoned units and for a `false` return.
  - Call `endFrame(this.camera.zoom)` after the loop, using the same `this.decalSampleY` field the decals use.
- [ ] **Step 3: Falsify.** Each mutation must turn the named test red:
  - Leave the old billboard in as well: "no `ellipseRing` billboard" fails.
  - Colour the ring from `groupColor`: the team colour test fails (unless the lead ruled Q1 = group, in which case invert this).
  - Remove the garrison branch: the roof test fails.
- [ ] **Step 4: Drive the real UI.**
  - `?sandbox=beit_sahwan_outskirts&sur` at zoom 1.0 and 1.6: click-select one of each class; box-drag the whole force; assign group 1 (Ctrl+1) and reselect with 1; garrison a squad in a house and select it.
  - `?sandbox=tel_marum`: select a unit on the western shoulder slope and one in the boulder corridor. The ring must lie on the ground with no clipping, and the outline must still show through the boulder decor.
  - Place a unit behind the apartment block: the ring is occluded, and the outline and HP bar remain.
  - Screenshot every case. Record whether stacked rings in a tight formation are unreadable, which is the issue's "sub-tile spread only if needed" condition. Record it; do not build a spread.
- [ ] **Step 5: Measure.** Add `--select-all` to `render-frame-cost.ts`: it calls `__lions.sel` on every living unit before timing. Run it with and without the flag on `?sandbox=beit_sahwan_outskirts&sur&civ`, and report median and p95 `cpu` and `gpu` alongside N selected. **Budget: ≤ 0.25 ms p95 added at 100 rings**, scaled linearly from N. If it is over, add the per-entity position cache in `SelectionRingBatch` and re-measure in the same task. Also count draw calls from `renderer.info.render.calls` with and without a selection: the expected difference is exactly +1.
- [ ] **Step 6: Update `palette.json`'s `group.role`** to say it colours the badge only. Run `pnpm validate:data`.
- [ ] **Step 7: Commit.** Message: `feat(render): selection is a ground ring in team colour (GH-186)`.

---

## Task 6: Visual-gate precondition, and the expected move measured

**Model:** sonnet.

**Files:**
- `tools/src/golden-diff/capture-protocol.ts`
- `baseline.ts` and `baseline.test.ts`

- [ ] **Step 1: Write the failing test.** The capture script asserts, after its final `step()`, that `renderer.selection.length === 0`, that `renderer.hoverEntity === -1`, and that `(renderer.rangeRingPreview ?? -1) === -1`. It throws a named error otherwise. Test the generated script string the way `baseline.test.ts` already tests `FREEZE_FRAME_LOOP_STATEMENTS`.
- [ ] **Step 2: Implement it.** Extend the stated precondition comment at `baseline.ts:264` to name `hoverEntity`, since a hover now draws a bar.
- [ ] **Step 3: Falsify.** Delete the `hoverEntity` clause: the test fails.
- [ ] **Step 4: Run `pnpm golden-baseline` locally**, for its report only. Record per scenario whether it moved.
  - Expected: `vehicle` and `relief` move; `quiet`, `open-ground` and `aftermath` hold; all layer checks pass.
  - Anything else moving is a finding. Stop and report it; do not explain it away.
  - Do not bless.
- [ ] **Step 5: Commit.** Message: `test(gate): capture asserts no selection and no hover (GH-186)`.

---

## Task 7: Land

**Model:** haiku.

- [ ] Confirm `git diff --stat 1035b18c..HEAD -- packages/sim packages/render/src/renderer.ts packages/render/src/api.ts` is empty, and that `pnpm test:determinism`, `pnpm balance` and `pnpm playtest` are unchanged.
- [ ] Run the full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`.
- [ ] Add a `docs/HANDOVER.md` §1/§4 entry covering:
  - the G-NUM and G-MOCK rulings, with the lead's words and dates;
  - every Q-default taken;
  - the Task 5 perf numbers and the draw-call delta;
  - the formation-spread finding;
  - the Q6 gap: the ring has no gate witness.
- [ ] Post a comment on GH-186 with the drive screenshots.
- [ ] Open the PR only when the lead asks. The PR's `visual` job should be red on `vehicle` and `relief` only. Bless once, from those CI numbers, through `visual-baseline-bless`, with one bless in flight at a time. State in the PR body that no AI-generated art is involved.
