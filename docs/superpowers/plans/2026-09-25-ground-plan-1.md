# The Ground, Plan 1: Terrain, Roads and Decals (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ground one continuous surface: a splat control map with bent, 0.5-tile edges instead of per-vertex masks; a macro field that never repeats; roads drawn from a distance field as worn tracks, so diagonals join and junctions read as trampled ground; a skirt that can no longer show through relief; and one decal pool that remembers a battle as craters, scorch, oil, rubble and fading tread. Every new draw layer gets a toggle check that can fail, and a new gated `aftermath` scenario gives those checks something to photograph.

**Architecture:** Most of the work is pure, three-free maths in `packages/render/src/three/terrain/`:
- `noise.ts`: seeded value noise, fbm and a box blur.
- `road-graph.ts`: the road graph, its distance queries and the road cross-section profile.
- `control-map.ts`: the per-tile surface decision, the edge band, the ridge apron, the baked road channels, the macro field and the height-bias and macro-tint mirrors.

`GroundMaterial` (`terrain/mesh.ts`) samples two RGBA8 control textures and one R8 macro texture per fragment. Its GLSL does arithmetic only, with every constant interpolated from the TypeScript module that tests it. Walls keep one per-vertex attribute, `wallAlbedo`, because a control map cannot address a vertical face.

The decal pool is `three/decal-pool.ts`: a pure half (grid writer, radii, the sim-time clock, the per-kind alpha mirror) and a GPU half (`DecalPool`, `createDecalMaterial`). It is built as two instances: persistent with 4×4 grids, and fading with 2×2 quads. `scorch-decals.ts` and `vehicle-tracks.ts` fold into it. `ThreeRenderer` gains one private entry, `stampGroundDecal`, and every seeding site calls it: vehicle kill, shell landing, structure collapse, tread and tyre, and the `&decals` showcase. The showcase reaches the renderer through a three-only `RendererOptions.decalShowcase`, never through a `Renderer` method.

**Tech Stack:** TypeScript strict, three.js r170 (under `packages/render/src/three/**` only), vitest (node), Vite, Playwright (tools only). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-ground-design.md`. It is binding, and its §5 numbers table was approved as shown by the lead on 25 Sep. D8 is approved too: the olive is decimated at export, in plan 2. D1–D7 and D9–D11 take the spec's recommended defaults. This plan covers the spec's §3.1 (splat terrain), §3.2 (the road), §3.3 (the decal pool) and the plan-1 column of §4. Package: **WP-A2 (#182, with #226), plan 1 of 2.** One branch (`feat/ground`), one landing, one bless.

**Status at writing (2026-09-25).** The branch is `feat/ground`: main `e3b80317` plus the spec commit `8d525c81`. Every `file:line` below was taken at `8d525c81`. **Re-grep before editing:** `ThreeRenderer.ts` is 8,567 lines and moves under every lane.

**Execution timing.**
- `ThreeRenderer.ts` admits one lane at a time. The spec's §7 order is **A2 plan 1 → S3g plan 2 → A2 plan 2**, so S3g plan 2 waits for this plan's landing.
- If another branch holds `ThreeRenderer.ts` when a task that edits it is reached (Tasks 5, 6, 9, 12, 13, 15), stop and wait. Do not edit around it.

## Global Constraints

These are copied from the spec and CLAUDE.md, and bind every task.

**Sim, lane and imports**
- **The sim is untouched.** `/usr/bin/git diff --stat e3b80317..HEAD -- packages/sim` is **empty** at every commit.
  - The renderer reads `sim.tickCount` and the state arrays read-only, as it already does. No fade, stamp or sway writes anything back (invariant 4).
  - `pnpm test:determinism` runs in Tasks 0 and 18. The claim "cannot move the hash" is worth the measurement.
- **One lane on `ThreeRenderer.ts`.** Tasks 5, 6, 9, 12, 13 and 15 edit it, in that order. They are the **opus** tasks.
- **`three` only under `packages/render/src/three/**`.**
  - `noise.ts`, `road-graph.ts` and `control-map.ts` import nothing from `three`. They are exported through the pure `terrain/index.ts` barrel, which `packages/app` tests reach as `@lions/render/terrain`.
  - `decal-pool.ts` and `decal-showcase.ts` live in `three/` beside `scorch-decals.ts` and are not barrel-exported. Tools import them by relative path, as `blast-captures.ts` already reaches render.

**Colour, order and time**
- **The colour pipeline is not the default one** (`palette-material.ts`).
  - Every data texture here (control A, control B, macro) is `NoColorSpace`, with `LinearFilter` for magnification, `LinearMipmapLinearFilter` with generated mips for minification, `ClampToEdgeWrapping` and `flipY: false`. It is data, not colour.
  - Every colour uniform is `hexToLinear` of a hex resolved through `this.overlayColor(key, fallback)`, or through `opts.terrainTones`. It is never `hexToUnit` and never a bare literal outside those fallbacks.
  - The ratio-to-mean albedo stays, so each surface still averages to its palette tone.
- **`units/render-order.ts` is the single source of `renderOrder`.** The two decal bands are named there (Task 10) and nowhere else.
- **Sim time for every fade.** The presentation clock for decals is `presentationSimMs(sim.tickCount, alpha)`, which is (tick − 1 + alpha) × 50 ms.
  - It is never accumulated `dtMs`, so a gate capture at a pinned tick repeats.
  - `REPAINT_SCRIPT`'s `frame(1, 0)` moves nothing.

**The visual gate**
- **The visual gate is blessed, never widened.**
  - Every new check's floor is **one third of the smallest of three consecutive runs**, on both metrics, rounded down. The three readings are recorded in its `rationale`.
  - An existing floor that a change drives below its value is **a finding: stop and report it.** It is never a number to lower.
  - Task 2 names the one place this is expected to bite (`relief`/`skirt`) and what to do there.
- **Bless only from CI numbers.**
  - The local `darwin-arm64-swiftshader` baseline is stale (since 2026-09-03). Locally, every scenario is judged by an **A/B against untouched main's captures** (Task 0) with `computeDiff`, and by the layer checks, which need no baseline.
  - The real bless happens **once**, at the plan's end (Task 18), through `visual-baseline-bless` on `main`, from the `visual` job's `linux-x64-swiftshader` numbers.
- **Every check gets an input that makes it fail, constructed and run.** Each task's last step names the mutation. The commit body says it was seen red, then reverted.

**Costs, ports and processes**
- **Costs are measured, not asserted.** The budget is spec §2:
  - **+4 draw calls planned, cap +6**;
  - **≤ +1.5 ms p95** at the acceptance view;
  - `perf:units` at 300 figures **≤ 7.5 ms p95**;
  - every acceptance view **≤ 14.5 ms p95**.

  Task 1 builds the instrument, Task 0 takes the before and Task 18 the after. A miss sheds scatter density first (plan 2), never the decal pool.
- **Ports 5193–5199 for every tool run.**

  | Port | Tool |
  |---|---|
  | 5195 | `golden-baseline` |
  | 5196 | `ground:capture` |
  | 5197 | the dev server `render-frame-cost` reads |
  | 5198 | `backend-curve-gate` (`perf:units`) |
  | 5199 | `blast:capture` |
  | 5193, 5194 | spare |

  - A tool that says it is *reusing* a server on its port has found another session's tree: stop and pick the spare.
  - **Never kill a process you did not start.** No `pkill`, no `kill` by name. Stop a server you started by its own process group.

**Tests and git**
- **Pure maths goes in pure, tested functions. Rendering needs no unit tests**, and the toggle checks vote on it.
  - Each GLSL block interpolates its constants from the TypeScript export its mirror is tested against. A test pins that the shader source contains them, so the two cannot drift.
- **No `any`. No non-null assertion in new code, tests included.** Tests are colocated as `*.test.ts`.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, plus the empty `packages/sim` diff above, plus what each task names.
- **Git hygiene.**
  - Use `/usr/bin/git` by absolute path, one command per call.
  - Use `git add <paths>`, then `git commit -s -F <msgfile> -- <paths>`. Never `-A`, never `git checkout -- <file>`, never amend.
  - End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **The model tier is named per task.** Opus is for `ThreeRenderer.ts` and shaders. Sonnet is for tools, tests, data and pure modules. Haiku is for mechanical trims. The final whole-branch review is opus.

## Rulings taken while planning

Where the spec and today's code disagree, or the spec is silent, this plan rules as follows. Each ruling becomes a Deviations entry in the spec at landing (Task 18).

**Plan shape**
- **R-1: eighteen tasks, not eleven.** The brief asks for about 11 tasks at no more than 5 files each. The fold touches more than 25 existing files: seven vertex masks across `ground.ts`, `types.ts`, `mesh.ts` and four test files; two decal modules and their tests; `blast-captures`; `debug-layers`; the app's flag table; the road URL. The cap is kept, so plan 1 runs Tasks 1–18 plus a no-code Task 0. The spec's §7 tasks map as follows:

  | Spec §7 task | Plan tasks |
  |---|---|
  | 1 | 2 |
  | 2 | 3, 4 |
  | 3 | 5, 7 |
  | 4 | 5, 9 |
  | 5 | 3, 4 |
  | 6 | 6, 8, 9 |
  | 7 | 10 |
  | 8 | 11, 12, 13, 14 |
  | 9 | 12 |
  | 10 | 15, 16, 17 |
  | 11 | 1, 18 |

- **R-2: the road graph comes before the material.** The spec orders it the other way (its 5 after its 3). Doing it first lets one shader task retire the road slot's two taps together with `roadAxis`, instead of keeping `roadAxis` alive across two tasks.

**Surfaces and edges**
- **R-3: road tiles leave the vertex tone.** `groundTone` gives an `r` tile the road composite (`tones.ts:143`). If that stays, an SDF road still steps at every tile edge. So `buildGround` emits the **open wash** on road tiles (Task 7), and the road tone is mixed in the shader by the road weight (Task 6).
  - `groundTone` itself is unchanged, because scatter, buildings and structures still call it.
- **R-4: pads keep a hard edge; the band is one-sided at a terrace.** The spec's control map has no pad channel, and a pad's `underBuilding` tone is a per-tile vertex colour. Softening it would need a second tone in the shader, which is out of scope. So G3's "pads" item is not closed in plan 1: the gap is recorded, and a building stands on most of each pad.
  - Next to a pad: open ground keeps full texture to the pad's edge. Pads are excluded from the box average, not averaged in as zero.
  - Next to a ridge: rock bleeds a **0.5-tile apron onto the open side only** (spec §3.1, "Ridges"). The ridge top stays pure rock.
- **R-5: walls keep one vertex attribute, `wallAlbedo`.** It is −1 on every top (sample the control map), 0 on a building wall and 1 on a ridge wall. A vertical face sits exactly on a texel boundary, so the control map cannot tell a ridge wall from a building wall.
- **R-6: the two unnamed channels of control B.** The spec names B's knoll and road-distance channels. B.b carries **junction distance**, which the rut fade needs. B.a carries the **road-edge bend noise**, which is baked from `noise.ts` so that GLSL does arithmetic only and every noise number is unit-tested.
- **R-7: road grain shares the `uKnoll` sampler** at the road's own repeat and gain (2 tiles, 0.6).
  - The `road` slot, its two taps, `roadAxis` and `road_track_tile`'s binding retire.
  - `groundAlbedoSlotsUsed` maps a road to `knoll`, so a map with roads but no knoll still fetches the grain.
  - The JPEG and its `GROUND_ALBEDOS` entry stay on disk, unreferenced by any slot. Deleting them touches provenance, `validate_assets.py` and `ground-albedo.test.ts` (see Out of scope).
- **R-8: road tone values land in `TERRAIN_THEMES`** (`packages/app/src/terrain-themes.ts`), per D2: arid `limestone.4`, green `dust.3`. Pixi reads `tones.road` too, so Pixi's roads change colour as well. That diff is report-only, and `renderer.ts` is byte-untouched.
- **R-9: macro hue uses the spec's keys on both themes.** The pull is toward `limestone.2` on the bright side and `dust.1` on the dark side. On `green` it reads as dry patches. The lead sees it in Task 18's zoom-0.35 captures before the bless.

**Decals**
- **R-10: the persistent pool is 4×4 and the fading pool 2×2.** The spec gives both "a 4×4-vertex grid (18 tris)" and "≤ 27k tris". 5,120 decals × 18 = 92k. Only 1024 × 18 + 4096 × 2 = **26,624** meets the triangle budget. Tracks keep a quad, now sampled per corner rather than at the centre.
- **R-11: decal draw calls are net +0.** Two pools replace two meshes (`ScorchDecalMesh`, `VehicleTrackMesh`), and both pools share one material and one program. The spec's +1 is headroom; Task 18 measures it.
- **R-12: rubble seeds in the `structureDestroyed` branch**, beside `spawnCollapseFx('structure_collapse', …)` (`ThreeRenderer.ts:3766`), not inside `spawnCollapseFx`. That method also serves shell impacts and tunnel collapses, and it knows a point, not a footprint.
- **R-13: crater radius is `0.15 + power` tiles.** That reproduces both approved entries: mortar 0.3 → 0.45, Grad 0.45 → 0.6.
- **R-14: the clock.** A stamp made in `snapshot()` is dated `tickCount × 50` ms. A frame presents `(tickCount − 1 + alpha) × 50` ms, clamped at 0. The showcase is dated **0 ms**, so its fades do not depend on how many ticks the boot loop ran before the capture froze it.
- **R-15: tread stamps are 0.58 tiles long**: one 0.5-tile spacing plus a 0.08-tile feather. Neighbours overlap by exactly the feather, with complementary linear ramps. The composite peak is ≤ 35%, and the dip is ≤ 35%²/4 ≈ 3%.
- **R-16: the showcase is an option, not a method.** `RendererOptions.decalShowcase?: { x: number; y: number }` is three-only and ignored by Pixi, like `shellColors`. The app sets it from the sandbox's friendly anchor when `&decals` is on. `packages/app` gains no dependency on a backend-only member.
- **R-17: the `scorch` debug layer is removed, not aliased** (D5). `decals` hides both pools. `blast:capture`'s `LAYER_FLOORS.scorch` is renamed `decals` with its numbers kept (floors are minimums, and the layer is now a superset), and its readings are re-recorded.
- **R-18: `surfaceWorldY` is reached through `groundWorldY`.** The spec names the function `surfaceWorldY`, and it exists (`terrain/surface.ts:423`). Decals sample through `groundWorldY(retained.elevation, …)` (`ground-height.ts:98`), which dispatches to it, as every other ground-hugging layer does.
- **R-19: terrace tiles are skipped per decal centre.** A decal whose centre tile is a terrace is not stamped. A grid vertex that lands on a terrace takes the centre's height, so no decal drapes down a wall.

**Gates and textures**
- **R-20: the relief `skirt` floor.** The spec says that check is re-measured on `relief`, whose baseline carries G5. The old signal (3403 px / 0.2858) includes the G5 bands the ring removes.
  - If the fixed signal stays above the floor (1100 / 0.095), nothing changes but the rationale.
  - If it falls below, Task 2 **stops and reports** both readings to the lead: the G5 share, and the corners-only share. Lowering a minimum to clear a red is widening, and this plan does not do it on its own.
- **R-21: the control textures carry mips.** At zoom 0.35 a tile is about 22 px across, and 8 texels per tile minify 2.8:1. The spec's 1.2 MiB per map is the mip-less figure; with mips it is about 1.6 MiB. Task 18 measures it.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `tools/src/perf/ground-captures.ts` (+test), `tools/package.json`, `package.json` | `pnpm ground:capture`: views, `renderer.info`, per-layer call deltas | 1 |
| `packages/render/src/three/terrain/skirt.ts` (+test) | The skirt as a ring | 2 |
| `tools/src/golden-diff/baseline.ts` | Rationales and floors: relief `skirt` (2); `roads`, `macro` (9); `aftermath` (17) | 2, 9, 17 |
| `packages/render/src/three/terrain/noise.ts` (+test) | `latticeValue`, `valueNoise2`, `fbm2`, `boxBlur` | 3 |
| `packages/render/src/three/terrain/road-graph.ts` (+test) | `buildRoadGraph`, `roadDistanceAt`, `junctionDistanceAt`, `roadProfile`, road constants | 3 |
| `packages/render/src/three/terrain/index.ts` | Barrel exports for the three pure modules | 3, 4 |
| `packages/render/src/three/terrain/control-map.ts` (+test) | `tileSurface`, `surfaceWeightsAt`, `buildControlMap`, `heightBiased`, `buildMacroField`, `macroFactor`, `neutralTint` | 4 |
| `packages/app/src/ground-texture-slots.test.ts` | All 26 maps: control-map dimensions and classification, G2 on real data, slots; the mask walk retires | 4, 7 |
| `packages/render/src/three/terrain/mesh.ts` (+test) | `GroundMaterial` splat, macro and road GLSL; `wallAlbedo`; the `road` slot retires; `toGeometry` masks retire | 5, 6, 7 |
| `packages/render/src/three/terrain/ground.ts` (+test), `terrain/types.ts` | `wallAlbedo`; the masks, `albedoFor` and `roadAxisAt` retire; road tiles take the open wash | 5, 7 |
| `packages/render/src/three/ThreeRenderer.ts` | Upload control and macro; road uniforms; `macro`, `roads` and `decals` cases; pools; `stampGroundDecal`; seeding; showcase | 5, 6, 9, 12, 13, 15 |
| `packages/render/src/three/ThreeRenderer.ground-albedo.test.ts` | Road grain gain stashed by `ground-albedo` | 6 |
| `packages/render/src/three/terrain/scatter.ts` (+test) | The rut dashes retire | 8 |
| `packages/render/src/api.ts` | `roadTextureUrl` retires (8); `decalShowcase` (15) | 8, 15 |
| `packages/app/src/renderer-options.ts` (+test) | The road URL retires | 8 |
| `packages/app/src/terrain-themes.ts` | Road tones (D2) | 9 |
| `packages/render/src/three/debug-layers.ts` (+test) | `macro`, `roads` (9); `decals` replaces `scorch` (13) | 9, 13 |
| `packages/render/src/three/decal-pool.ts` (+test) | Pool core (10); kind shader (11) | 10, 11 |
| `packages/render/src/three/units/render-order.ts` (+test) | `DECAL_PERSISTENT_RENDER_ORDER`, `DECAL_FADING_RENDER_ORDER` | 10 |
| `packages/render/src/three/ThreeRenderer.blast.test.ts` | The decal wiring, pinned where it is wired | 12, 15 |
| `tools/src/perf/blast-captures.ts` (+test) | `scorch` → `decals` | 13 |
| `packages/render/src/three/scorch-decals.ts` (+test), `vehicle-tracks.ts` (+test) | Trimmed to their pure maths | 14 |
| `packages/render/src/three/decal-showcase.ts` (+test) | `showcaseSites`, `decalShowcase` | 15 |
| `packages/app/src/sandbox-help.ts` (+test), `packages/app/src/shell/links.test.ts`, `packages/app/src/main.ts` | `&decals` | 16 |
| `tools/src/golden-diff/capture-protocol.ts`, `tools/src/golden-diff/aftermath.test.ts` | `Scenario.sandboxFlags`, `AFTERMATH_SCENARIO`, its pin | 17 |
| `docs/PERFORMANCE.md`, `CLAUDE.md`, the spec | The record | 18 |

---

### Task 0: Entry: baselines, main's captures and main's costs

**Tier:** not a code task. Coordinator, no model spend.

- [ ] **Step 1: Check the branch point.** `/usr/bin/git log --oneline -1 origin/main` and `/usr/bin/git log --oneline -3` in `/Users/ilpinto/dev/roaring-lions-ep/ground`.
  - If main has moved and touched `packages/render/src/three/terrain/**`, `ThreeRenderer.ts`, `scorch-decals.ts`, `vehicle-tracks.ts`, `debug-layers.ts` or `tools/src/golden-diff/**`, merge it first (`/usr/bin/git merge origin/main`), then re-grep this plan's citations.
- [ ] **Step 2: Gates**, recorded in the ledger so that a later red can be attributed: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:ui`.
- [ ] **Step 3: Main's captures**, the local A/B reference for every later task: `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground/t0`.
  - The comparison against the stale darwin baseline will fail. That is expected, and its numbers are not read.
  - What is kept is `.superpowers/ground/t0/<scenario>/current.png` for all five scenarios, plus every layer-check reading the run prints. Save stdout as `.superpowers/ground/t0/gate.log`.
- [ ] **Step 4: The A/B script.** It is git-ignored scratch, written once and reused by every task:

```ts
// .superpowers/ground/ab.ts -- not product code. Usage:
//   npx tsx .superpowers/ground/ab.ts .superpowers/ground/t0 .superpowers/ground/t<N>
import { existsSync } from 'node:fs';
import { computeDiff } from '../../tools/src/golden-diff/diff';
import { BASELINES } from '../../tools/src/golden-diff/baseline';

const [before, after] = process.argv.slice(2);
if (!before || !after) throw new Error('usage: ab.ts <before-dir> <after-dir>');
for (const [id, spec] of Object.entries(BASELINES)) {
  const a = `${before}/${id}/current.png`;
  const b = `${after}/${id}/current.png`;
  if (!existsSync(a) || !existsSync(b)) {
    console.log(`${id.padEnd(12)} (missing on one side)`);
    continue;
  }
  const s = computeDiff(a, b, spec.region ? { region: spec.region } : {});
  console.log(`${id.padEnd(12)} ${String(s.diffPixels).padStart(7)} px / ${s.meanAbsChannelDelta.toFixed(4)}`);
}
```

  - Sanity check: run it on `t0` against itself. Every line must read `0 px / 0.0000`. The frame loop is frozen and the AO noise is seeded, so a capture is deterministic across processes (`baseline.ts`, `PRE_LIT`).

- [ ] **Step 5: Main's costs.** Task 1 builds the instrument, so this step runs **after Task 1 lands, against `8d525c81`**. Check the commit out in a throwaway worktree under `.superpowers/ground/t0-tree`; never `git checkout` a file in this tree.
  - `pnpm ground:capture -- --port=5196 --out=.superpowers/ground/cost-t0`.
  - `render-frame-cost` on the acceptance roster:
    - Start the dev server on 5197 in its own process group, and note the PGID.
    - Run `npx tsx tools/src/perf/render-frame-cost.ts http://127.0.0.1:5197 '?sandbox=beit_sahwan_outskirts&sur&civ'`, then the same with `'?sandbox=qarn_hadid&sur'`.
    - Stop that group.
  - `npx tsx tools/src/perf/backend-curve-gate.ts --port=5198`, which is `perf:units` up to 300 figures.
  - Record every number with its conditions (GPU string, DPR, viewport) in `.superpowers/ground/cost-t0/README.txt`.

---

### Task 1: The ground instrument, `pnpm ground:capture`

**Tier:** sonnet. The spec's §1 audit was a git-ignored script (`.superpowers/ground-spec/audit.ts` in the spec worktree). Promote it so that "costs are measured" is a command, not a transcription.

**Files:**
- Create: `tools/src/perf/ground-captures.ts`, `tools/src/perf/ground-captures.test.ts`
- Modify: `tools/package.json` (`"ground:capture": "tsx src/perf/ground-captures.ts"`), `package.json` (`"ground:capture": "pnpm --filter @lions/tools ground:capture"`)

**Interfaces:**

```ts
export interface GroundCaptureArgs { readonly port: number; readonly out: string; readonly maps: readonly string[]; readonly decals: boolean; readonly reuse: boolean }
export function parseGroundCaptureArgs(argv: readonly string[]): GroundCaptureArgs;
export interface MapView { readonly name: string; readonly x: number; readonly y: number; readonly zoom: number; readonly fog: boolean }
export function viewsFor(mapId: string, rows: readonly string[]): readonly MapView[];
export function roadCloseUp(rows: readonly string[]): [number, number] | null;
export const COST_LAYERS: readonly string[]; // ['scatter','decor','units','buildings','decals','scorch']
```

- [ ] **Step 1: Write the failing test.**

```ts
// tools/src/perf/ground-captures.test.ts
import { describe, expect, it } from 'vitest';
import { parseGroundCaptureArgs, roadCloseUp, viewsFor } from './ground-captures';

describe('parseGroundCaptureArgs', () => {
  it('defaults to port 5196 and the four audit maps', () => {
    const a = parseGroundCaptureArgs([]);
    expect(a.port).toBe(5196);
    expect(a.maps).toEqual(['beit_sahwan_outskirts', 'tel_marum', 'qarn_hadid', 'wadi_halam_basin']);
    expect(a.decals).toBe(false);
  });
  it('takes --port, --out, --maps, --decals and --reuse', () => {
    const a = parseGroundCaptureArgs(['--port=5194', '--out=x/y', '--maps=qarn_hadid', '--decals']);
    expect(a).toEqual({ port: 5194, out: 'x/y', maps: ['qarn_hadid'], decals: true, reuse: false });
    expect(parseGroundCaptureArgs(['--reuse']).reuse).toBe(true);
  });
  // The lead's server is 5177 and the tools own 5173-5182. A run that reuses
  // one of them measures another tree.
  it('refuses a port outside 5193-5199', () => {
    expect(() => parseGroundCaptureArgs(['--port=5177'])).toThrow(/5193-5199/);
    expect(() => parseGroundCaptureArgs(['--port=abc'])).toThrow(/5193-5199/);
  });
});

describe('roadCloseUp', () => {
  // The audit's rule: most road tiles within Chebyshev distance 3, ties by (y, x).
  // (3,2) sees all five of the run plus the stray at (0,0); nothing else sees six.
  it('picks the road tile with the most road inside radius 3', () => {
    const rows = ['r........', '.........', '..rrrrr..'];
    expect(roadCloseUp(rows)).toEqual([3, 2]);
  });
  it('is null on a map with no road', () => {
    expect(roadCloseUp(['...', '...'])).toBeNull();
  });
});

describe('viewsFor', () => {
  it('frames the centre at 0.35, 1 and 2.5, one fogged view, and a road close-up', () => {
    const rows = Array.from({ length: 48 }, (_, y) => (y === 20 ? 'r'.repeat(48) : '.'.repeat(48)));
    const names = viewsFor('m', rows).map((v) => v.name);
    expect(names).toEqual([
      'm-centre-z0.35-nofog',
      'm-centre-z1-nofog',
      'm-centre-z2.5-nofog',
      'm-centre-z1-fog',
      'm-road-z2.5-nofog',
    ]);
    const road = viewsFor('m', rows).find((v) => v.name.includes('road'));
    expect(road?.y).toBe(20);
  });
});
```

- [ ] **Step 2: Implement.** The pure half has four parts:
  - `parseGroundCaptureArgs`, with ports limited to 5193–5199;
  - `roadCloseUp`: the audit's rule, ties broken by `(y, x)`;
  - `viewsFor`: centre `floor(w/2), floor(h/2)`;
  - `COST_LAYERS`.

  The browser half is the audit's `boot`, `shot` and `layerCost`, with four changes:
  1. It uses `ensureDevServer(port, REPO_ROOT, 'ground-capture')` and prints whether it **started** or **reused** a server. It exits 2 on *reused* unless `--reuse` is passed.
  2. Its `STATS` read resets `gl.info` around one `frame(1, 0)` and reports `calls`, `triangles`, `textures` and `geometries`.
  3. `layerCost` skips a layer name that throws (an unknown layer on this tree) and prints `n/a`, so the same tool measures main (`scorch`) and this branch (`decals`).
  4. With `--decals`, each map boots with `&decals`. Before Task 16 the flag only warns.

  It writes `<out>/<view>.png`, `<out>/cost.json` (per view: calls, tris, textures; per layer: the call and triangle delta) and `<out>/log.txt`. It stops only the server it started (`stopDevServer(server, …)` with the handle it got back), and calls `process.exit` on both paths.
- [ ] **Step 3: Gates, run, falsify, commit.**
  - Run `pnpm ground:capture -- --port=5196 --out=.superpowers/ground/cost-t1 --maps=qarn_hadid`. Confirm it says *started*, and that `cost.json` holds five views.
  - **Falsify** `viewsFor` by dropping the 0.35 view: the test goes red. Revert.
  - Message: `feat(tools): ground:capture -- the ground's views and what each layer costs`.

---

### Task 2: The skirt becomes a ring (G5)

**Tier:** sonnet.

**Files:**
- Modify: `packages/render/src/three/terrain/skirt.ts`, `packages/render/src/three/terrain/skirt.test.ts`, `tools/src/golden-diff/baseline.ts` (relief `skirt` rationale; see R-20)

**Interfaces:** `buildSkirt(width, height)` and `skirtBounds` are unchanged. New: `export function skirtRing(width: number, height: number): { positions: Float32Array; indices: Uint16Array }`, which is pure. It gives eight vertices, the outer rectangle then the footprint `[0,w]×[0,h]`, and eight triangles, all up-facing.

- [ ] **Step 1: Write the failing tests** (added to `skirt.test.ts`; the existing ones stay).

```ts
import { skirtRing } from './skirt';

describe('skirtRing -- G5', () => {
  const tri = (r: ReturnType<typeof skirtRing>, t: number): THREE.Vector3[] =>
    [0, 1, 2].map((k) => {
      const i = r.indices[t * 3 + k];
      return new THREE.Vector3(r.positions[i * 3], r.positions[i * 3 + 1], r.positions[i * 3 + 2]);
    });

  // Catmull-Rom undershoots to -0.077 on tel_marum (spec G5), well below the
  // skirt's -0.01. So no skirt triangle may cover ANY point of the footprint:
  // that is the whole fix.
  it('covers no point strictly inside the map footprint', () => {
    const r = skirtRing(48, 40);
    for (let t = 0; t < r.indices.length / 3; t++) {
      const [a, b, c] = tri(r, t);
      const cx = (a.x + b.x + c.x) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      const inside = cx > 0 && cx < 48 && cz > 0 && cz < 40;
      expect(inside, `triangle ${t} centroid (${cx}, ${cz})`).toBe(false);
    }
  });

  it('still covers the whole margin: ring area = outer - footprint', () => {
    const r = skirtRing(48, 40);
    let area = 0;
    for (let t = 0; t < r.indices.length / 3; t++) {
      const [a, b, c] = tri(r, t);
      area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    }
    const { x0, x1, z0, z1 } = skirtBounds(48, 40);
    expect(area).toBeCloseTo((x1 - x0) * (z1 - z0) - 48 * 40, 6);
  });

  it('faces up on every triangle (FrontSide culling draws nothing otherwise)', () => {
    const r = skirtRing(12, 8);
    for (let t = 0; t < r.indices.length / 3; t++) {
      const [a, b, c] = tri(r, t);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      expect(n.y, `triangle ${t}`).toBeGreaterThan(0);
    }
  });

  it('is what buildSkirt draws', () => {
    const mesh = buildSkirt(12, 8);
    expect(mesh.geometry.getAttribute('position').count).toBe(8);
    expect(mesh.geometry.getIndex()?.count).toBe(24);
    disposeSkirt(mesh);
  });
});
```

  - Update the existing "is a flat, up-facing quad" test: the vertex count is 8, and the up-facing check loops over all eight triangles.
  - `writeSkirtUv` is unchanged. It already maps every vertex by world `(x, z)`.
- [ ] **Step 2: Implement `skirtRing`.**
  - Outer corners are `o0..o3` from `skirtBounds`. Inner corners are `i0=(0,0) i1=(w,0) i2=(w,h) i3=(0,h)`, all at `SKIRT_Y`.
  - Four trapezoids, two triangles each, wound with `pushPolygon`'s unflipped fan `(0, k+1, k)` order. That is the order `buildSkirt`'s comment explains; the test above is what proves it.
  - `buildSkirt` uses it. The header comment's "one rectangle, not a ring" paragraph becomes the G5 account: the undershoot, and why `SKIRT_Y` no longer protects the interior.
- [ ] **Step 3: Photograph the seam.** At the map edge the skirt (−0.01) meets ground that may undershoot below it.
  - Photograph `?sandbox=tel_marum` at `goto(0, 20)`, zoom 2.5, fog hidden, on port 5196, with and without the change.
  - Confirm that no background sliver appears along x = 0. If one does, report it; do not paper it over with an epsilon.
- [ ] **Step 4: Gate readings.** Run `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground/t2 --scenario=quiet,relief`, then the A/B against `t0`.
  - **Expected:** `quiet` 0 px / 0.0000. On a flat map the quad's interior was hidden under ground at y = 0 anyway. `relief` moves by the G5 bands.
  - Read the `skirt` layer check on both scenarios. **R-20:** if `relief`/`skirt` is still ≥ 1100 px / 0.095, update only its rationale: add the new three readings and note that the old signal carried G5. If it falls below, **stop** and hand the lead three numbers: the old signal, the new signal, and the new signal cropped to the frame's corners.
- [ ] **Step 5: Gates, falsify, commit.**
  - **Falsify:** make `skirtRing` emit the old full quad (outer corners, two triangles). The "covers no point inside" test goes red. Revert.
  - Message: `fix(render): the skirt is a ring, so it cannot show through relief (G5)`.

---

### Task 3: Noise and the road graph (pure)

**Tier:** sonnet.

**Files:**
- Create: `packages/render/src/three/terrain/noise.ts`, `noise.test.ts`, `road-graph.ts`, `road-graph.test.ts`
- Modify: `packages/render/src/three/terrain/index.ts` (`export * from './noise'; export * from './road-graph';`)

**Interfaces:**

```ts
// noise.ts
export function latticeValue(i: number, j: number, seed: number): number; // tileHash-based, in [-1, 1)
export function valueNoise2(x: number, z: number, cyclesPerTile: number, seed: number): number; // quintic fade
export function fbm2(x: number, z: number, periodTiles: number, octaves: number, seed: number): number;
export function boxBlur(field: Float32Array, w: number, h: number, radius: number): Float32Array; // separable, clamp-to-edge

// road-graph.ts
export interface RoadNode { readonly x: number; readonly y: number } // tile; its centre is (x + 0.5, y + 0.5)
export interface RoadGraph {
  readonly width: number; readonly height: number;
  readonly nodes: readonly RoadNode[];
  readonly edges: readonly (readonly [number, number])[];
  readonly degree: readonly number[];
  readonly incident: readonly (readonly number[])[];
  readonly nodeAt: Int32Array; // -1, or the node on that tile
}
export function buildRoadGraph(input: TerrainInput): RoadGraph;
export function isJunction(g: RoadGraph, n: number): boolean; // degree >= 3
export function roadDistanceAt(g: RoadGraph, px: number, pz: number): number; // tiles; Infinity beyond +/-2 tiles
export function junctionDistanceAt(g: RoadGraph, px: number, pz: number): number;
export const ROAD_HALF_WIDTH = 0.36, ROAD_EDGE_FALLOFF = 0.18, ROAD_EDGE_BEND = 0.08, ROAD_EDGE_BEND_CYCLES = 2;
export const SHOULDER_TILES = 0.12, SHOULDER_ALPHA = 0.4;
export const RUT_OFFSET = 0.17, RUT_WIDTH = 0.06, RUT_ALPHA = 0.35, RUT_JUNCTION_FADE = 0.4;
export const ROAD_GRAIN_TILES = 2, ROAD_GRAIN_GAIN = 0.6;
export interface RoadProfile { readonly surface: number; readonly shoulder: number; readonly rut: number }
export function roadProfile(d: number, bend: number, junctionDist: number): RoadProfile;
```

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/terrain/noise.test.ts
import { describe, expect, it } from 'vitest';
import { boxBlur, fbm2, latticeValue, valueNoise2 } from './noise';

describe('valueNoise2', () => {
  it('passes through its lattice values exactly', () => {
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) expect(valueNoise2(i / 1.5, j / 1.5, 1.5, 7)).toBeCloseTo(latticeValue(i, j, 7), 12);
  });
  it('stays inside [-1, 1] and actually varies', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 20000; k++) {
      const v = valueNoise2(k * 0.0137, k * 0.0071, 1.5, 3);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(1);
  });
  it('is a pure function of its arguments, and the seed matters', () => {
    expect(valueNoise2(3.3, 4.4, 2, 1)).toBe(valueNoise2(3.3, 4.4, 2, 1));
    let same = 0;
    for (let k = 0; k < 50; k++) if (valueNoise2(k * 0.37, 1.1, 2, 1) === valueNoise2(k * 0.37, 1.1, 2, 2)) same++;
    expect(same).toBeLessThan(5);
  });
  // The quintic fade makes the field C1 across every lattice line, so a bent
  // edge has no kinks. A linear fade breaks the slope at every line.
  it('has no slope break across a lattice line', () => {
    const h = 1e-5;
    let worst = 0;
    for (let i = 1; i <= 20; i++) {
      const x = i / 1.5;
      const z = 0.37 + i * 0.11;
      const left = (valueNoise2(x, z, 1.5, 5) - valueNoise2(x - h, z, 1.5, 5)) / h;
      const right = (valueNoise2(x + h, z, 1.5, 5) - valueNoise2(x, z, 1.5, 5)) / h;
      worst = Math.max(worst, Math.abs(left - right));
    }
    expect(worst).toBeLessThan(0.01);
  });
});

describe('fbm2', () => {
  it('stays in [-1, 1] and averages near zero', () => {
    let sum = 0;
    let n = 0;
    for (let z = 0; z < 48; z += 0.25)
      for (let x = 0; x < 48; x += 0.25) {
        const v = fbm2(x, z, 12, 3, 11);
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
        sum += v;
        n++;
      }
    expect(Math.abs(sum / n)).toBeLessThan(0.15);
  });
});

describe('boxBlur', () => {
  it('leaves a constant field constant', () => {
    const f = new Float32Array(64).fill(0.3);
    for (const v of boxBlur(f, 8, 8, 2)) expect(v).toBeCloseTo(0.3, 6);
  });
  it('is the identity at radius 0', () => {
    const f = Float32Array.from({ length: 16 }, (_, i) => i);
    expect(Array.from(boxBlur(f, 4, 4, 0))).toEqual(Array.from(f));
  });
  it('spreads an interior impulse over a (2r+1)^2 square that sums to the impulse', () => {
    const f = new Float32Array(21 * 21);
    f[10 * 21 + 10] = 1;
    const b = boxBlur(f, 21, 21, 2);
    let sum = 0;
    let nonzero = 0;
    for (const v of b) {
      sum += v;
      if (v > 0) nonzero++;
    }
    expect(sum).toBeCloseTo(1, 6);
    expect(nonzero).toBe(25);
  });
});
```

```ts
// packages/render/src/three/terrain/road-graph.test.ts
import { describe, expect, it } from 'vitest';
import { DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';
import { buildRoadGraph, isJunction, junctionDistanceAt, roadDistanceAt, roadProfile } from './road-graph';

function roads(rows: readonly string[]): TerrainInput {
  const height = rows.length;
  const width = rows[0].length;
  const decor = new Uint8Array(width * height);
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'r') decor[y * width + x] = DECOR_ROAD; }));
  return { width, height, decor, elevation: null, blocked: new Uint8Array(width * height), cover: new Uint8Array(width * height) };
}

describe('buildRoadGraph', () => {
  it('links four-neighbours, one edge per pair', () => {
    const g = buildRoadGraph(roads(['rrr']));
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
    expect(g.degree).toEqual([1, 2, 1]);
  });
  // G2: tiles touching only at a corner were beads. The diagonal is bridged
  // exactly when neither orthogonal cell between the two is road.
  it('bridges a diagonal chain into one line (G2)', () => {
    const g = buildRoadGraph(roads(['r..', '.r.', '..r']));
    expect(g.edges).toHaveLength(2);
    expect(roadDistanceAt(g, 1.0, 1.0)).toBeCloseTo(0, 6);
    expect(roadDistanceAt(g, 2.0, 2.0)).toBeCloseTo(0, 6);
  });
  it('bridges the anti-diagonal the same way', () => {
    expect(buildRoadGraph(roads(['..r', '.r.', 'r..'])).edges).toHaveLength(2);
  });
  // An L-bend already joins through its corner tile. A diagonal would add a
  // third edge and draw a filled triangle.
  it('does not cut an L-bend with a diagonal', () => {
    const g = buildRoadGraph(roads(['rr', '.r']));
    expect(g.edges).toHaveLength(2);
  });
  it('makes the centre of a crossroads its one junction', () => {
    const g = buildRoadGraph(roads(['.r.', 'rrr', '.r.']));
    const centre = g.nodeAt[1 * 3 + 1];
    expect(g.degree[centre]).toBe(4);
    expect(isJunction(g, centre)).toBe(true);
    expect(g.nodes.filter((_, i) => isJunction(g, i))).toHaveLength(1);
    expect(junctionDistanceAt(g, 1.5, 1.5)).toBe(0);
    expect(junctionDistanceAt(g, 1.5, 0.5)).toBeCloseTo(1, 6);
  });
});

describe('roadDistanceAt', () => {
  it('measures to the centreline', () => {
    const g = buildRoadGraph(roads(['...', 'rrr', '...']));
    expect(roadDistanceAt(g, 1.5, 1.5)).toBeCloseTo(0, 6);
    expect(roadDistanceAt(g, 1.5, 1.8)).toBeCloseTo(0.3, 6);
    expect(roadDistanceAt(g, 1.5, 0.5)).toBeCloseTo(1, 6);
  });
  it('treats a lone road tile as a point', () => {
    const g = buildRoadGraph(roads(['...', '.r.', '...']));
    expect(g.degree).toEqual([0]);
    expect(roadDistanceAt(g, 1.8, 1.5)).toBeCloseTo(0.3, 6);
  });
  it('is Infinity with no road within two tiles', () => {
    expect(roadDistanceAt(buildRoadGraph(roads(['...'])), 1.5, 0.5)).toBe(Infinity);
    expect(roadDistanceAt(buildRoadGraph(roads(['r......'])), 6.5, 0.5)).toBe(Infinity);
  });
});

describe('roadProfile -- spec §5, the road rows', () => {
  const far = 10;
  it('is packed surface on the centreline, with no rut and no shoulder there', () => {
    expect(roadProfile(0, 0, far)).toEqual({ surface: 1, shoulder: 0, rut: 0 });
  });
  it('wears its edge across 0.18 tile centred on the 0.36 half-width', () => {
    expect(roadProfile(0.27, 0, far).surface).toBe(1);
    expect(roadProfile(0.36, 0, far).surface).toBeCloseTo(0.5, 6);
    expect(roadProfile(0.45, 0, far).surface).toBe(0);
  });
  it('bends that edge by up to 0.08 tile', () => {
    expect(roadProfile(0.36, 1, far).surface).toBeLessThan(0.05);
    expect(roadProfile(0.36, -1, far).surface).toBeGreaterThan(0.95);
  });
  it('lays two ruts 0.17 either side of the centre, 0.06 wide, at 35%', () => {
    expect(roadProfile(0.17, 0, far).rut).toBeCloseTo(0.35, 6);
    expect(roadProfile(0.2, 0, far).rut).toBeCloseTo(0.175, 6);
    expect(roadProfile(0.1, 0, far).rut).toBe(0);
    expect(roadProfile(0.24, 0, far).rut).toBe(0);
  });
  it('fades the ruts out within 0.4 tile of a junction, so a crossroads is not rings', () => {
    expect(roadProfile(0.17, 0, 0).rut).toBe(0);
    expect(roadProfile(0.17, 0, 0.2).rut).toBeCloseTo(0.175, 6);
    expect(roadProfile(0.17, 0, 0.4).rut).toBeCloseTo(0.35, 6);
  });
  it('lays a bleached shoulder just past the edge, at most 40%, and nothing beyond it', () => {
    const s = roadProfile(0.5, 0, far).shoulder;
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThanOrEqual(0.4);
    expect(roadProfile(0.6, 0, far).shoulder).toBe(0);
    expect(roadProfile(0.2, 0, far).shoulder).toBe(0);
  });
});
```

- [ ] **Step 2: Implement.**
  - **`latticeValue(i, j, seed)`** is `tileHash(i + seed * 7919, j - seed * 6151) * 2 - 1`.
  - **`valueNoise2`** is bilinear over the four lattice values, with the fade `t³(t(6t − 15) + 10)`.
  - **`fbm2`** starts at frequency `1/periodTiles` and runs `octaves` octaves, doubling frequency and halving amplitude each time, with seed `seed + o`. It is normalised by the sum of amplitudes.
  - **`boxBlur`** is two separable passes with a running mean over `2r + 1`, and clamp-to-edge sampling.
  - **`buildRoadGraph`:**
    1. Make one node per `r` tile that is not blocked, in scan order.
    2. Add an edge to the east and south neighbours when they are road.
    3. Add a diagonal to `(x+1, y+1)` when that tile is road and neither `(x+1, y)` nor `(x, y+1)` is.
    4. Add the mirror diagonal to `(x−1, y+1)` under the same rule.

    `incident` and `degree` are derived from the edges.
  - **`roadDistanceAt`** scans nodes within ±2 tiles of `floor(p)`. It takes the point distance for a degree-0 node and the segment distance for each incident edge.
  - **`junctionDistanceAt`** takes the point distance to degree ≥ 3 nodes in the same window.
  - **`roadProfile`**, with `H = ROAD_HALF_WIDTH` and `F = ROAD_EDGE_FALLOFF`:
    - `e = d + ROAD_EDGE_BEND * bend`
    - `surface = 1 - smoothstep(H - F/2, H + F/2, e)`
    - `shoulder = SHOULDER_ALPHA * smoothstep(H - F/2, H + F/2, e) * (1 - smoothstep(H + F/2, H + F/2 + SHOULDER_TILES, e))`
    - `rut = RUT_ALPHA * (1 - smoothstep(RUT_WIDTH/2 - 0.01, RUT_WIDTH/2 + 0.01, |d - RUT_OFFSET|)) * smoothstep(0, RUT_JUNCTION_FADE, junctionDist) * surface`

    Use a local `smoothstep` that is the GLSL one exactly. Ruts read the **unbent** `d`, so they stay parallel to the centreline.
- [ ] **Step 3: Gates, falsify, commit.** Falsify three things, each seen red:
  - (a) Linear fade in `valueNoise2`: the slope-break test goes red.
  - (b) Drop the "neither orthogonal is road" condition: the L-bend test goes red.
  - (c) `RUT_JUNCTION_FADE = 0`: the junction test goes red.

  Message: `feat(render): seeded noise and the road graph -- G2's diagonals join`.

---

### Task 4: The control map, the road bake and the macro field; all 26 maps

**Tier:** sonnet.

**Files:**
- Create: `packages/render/src/three/terrain/control-map.ts`, `control-map.test.ts`
- Modify: `packages/render/src/three/terrain/index.ts` (`export * from './control-map';`), `packages/app/src/ground-texture-slots.test.ts` (add the control-map walk; the mask walk stays until Task 7)

**Interfaces:**

```ts
export const CONTROL_TEXELS_PER_TILE = 8;
export const EDGE_BAND_TILES = 0.5, EDGE_BEND_TILES = 0.2, EDGE_BEND_CYCLES_PER_TILE = 1.5, APRON_TILES = 0.5;
export const HEIGHT_BLEND = 0.15;
export const ROAD_DISTANCE_RANGE_TILES = 1;
export type SurfaceKind = 'open' | 'road' | 'rock' | 'scrub' | 'grove' | 'knoll' | 'pad';
export interface TileSurface { readonly kind: SurfaceKind; readonly strength: number }
export function tileSurface(input: TerrainInput, x: number, y: number): TileSurface;
export interface SurfaceWeights { readonly open: number; readonly rock: number; readonly scrub: number; readonly grove: number; readonly knoll: number }
export function surfaceWeightsAt(input: TerrainInput, px: number, pz: number): SurfaceWeights;
export interface ControlMap { readonly width: number; readonly height: number; readonly a: Uint8Array; readonly b: Uint8Array }
/** A: open, rock, scrub, grove. B: knoll, road distance, junction distance, road-edge bend. */
export function buildControlMap(input: TerrainInput): ControlMap;
export function heightBiased(w: readonly number[], h: readonly number[]): number[];
export const MACRO_SIZE = 256, MACRO_PERIOD_TILES = 12, MACRO_OCTAVES = 3, MACRO_BLUR_TILES = 1.5;
export const MACRO_LUMINANCE = 0.07, MACRO_HUE = 0.04;
export interface MacroField { readonly size: number; readonly data: Uint8Array }
export function macroBlurTexels(mapWidth: number): number;
export function buildMacroField(mapWidth: number, mapHeight: number): MacroField;
export function neutralTint(hex: string): [number, number, number]; // linear, luminance 1
export function macroFactor(m: number, amp: number, bright: readonly number[], dark: readonly number[]): [number, number, number];
```

`tileSurface` is the one per-tile decision. It runs in `ground.ts`'s `albedoFor` order (`ground.ts:228-243`):
- blocked: a ridge is `rock` 1, anything else is `pad` 0;
- road is `road` 1;
- grove is `grove` 1;
- knoll is `knoll` 1;
- a plain cover tier is `scrub` at `SCRUB_TIER_STRENGTH[tier-1]` (imported from `ground.ts`);
- else `open` 1.

`albedoFor` is deleted in Task 7 and its callers use this. Until then the two copies coexist, and the app test below pins that they agree on all 26 maps.

**A road tile is OPEN in control A.** The sand runs on under the road's worn edge and shoulder (R-3). The road itself comes from B.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/terrain/control-map.test.ts
import { describe, expect, it } from 'vitest';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';
import {
  buildControlMap, buildMacroField, CONTROL_TEXELS_PER_TILE as N, heightBiased, macroBlurTexels,
  macroFactor, neutralTint, tileSurface,
} from './control-map';
import { roadDistanceAt, buildRoadGraph } from './road-graph';

/** '.' open, 'r' road, 'o' grove, 'n' knoll, '1'-'3' cover, '#' pad, '^' ridge. */
function map(rows: readonly string[]): TerrainInput {
  const height = rows.length;
  const width = rows[0].length;
  const decor = new Uint8Array(width * height);
  const blocked = new Uint8Array(width * height);
  const cover = new Uint8Array(width * height);
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      const i = y * width + x;
      if (c === 'r') decor[i] = DECOR_ROAD;
      if (c === 'o') { decor[i] = DECOR_GROVE; cover[i] = 1; }
      if (c === 'n') { decor[i] = DECOR_KNOLL; cover[i] = 2; }
      if (c >= '1' && c <= '3') cover[i] = Number(c);
      if (c === '#') blocked[i] = 1;
      if (c === '^') { blocked[i] = 1; decor[i] = DECOR_RIDGE; }
    })
  );
  return { width, height, decor, elevation: null, blocked, cover };
}
/** h rows of one symbol repeated w times. */
const fill = (w: number, h: number, c: string): string[] => Array.from({ length: h }, () => c.repeat(w));
/** h copies of one authored row. */
const rowsOf = (h: number, row: string): string[] => Array.from({ length: h }, () => row);
/** Channel `c` of texture `t` at the texel containing world (x, z). */
function at(cm: ReturnType<typeof buildControlMap>, t: 'a' | 'b', x: number, z: number, c: number): number {
  const i = Math.floor(x * N);
  const j = Math.floor(z * N);
  return cm[t][(j * cm.width + i) * 4 + c];
}
const OPEN = 0, ROCK = 1, SCRUB = 2, GROVE = 3; // control A
const KNOLL = 0, ROADD = 1, JUNCD = 2, BEND = 3; // control B

describe('tileSurface -- albedoFor\'s order, one decision', () => {
  const m = map(['^#ron123.']);
  it.each([
    [0, 'rock', 1], [1, 'pad', 0], [2, 'road', 1], [3, 'grove', 1], [4, 'knoll', 1],
    [5, 'scrub', 0.4], [6, 'scrub', 0.65], [7, 'scrub', 1], [8, 'open', 1],
  ])('tile %i is %s at %f', (x, kind, strength) => {
    expect(tileSurface(m, x, 0)).toEqual({ kind, strength });
  });
});

describe('buildControlMap', () => {
  it('is 8 texels a tile, RGBA each', () => {
    const cm = buildControlMap(map(fill(6, 4, '.')));
    expect([cm.width, cm.height]).toEqual([6 * N, 4 * N]);
    expect(cm.a.length).toBe(6 * N * 4 * N * 4);
    expect(cm.b.length).toBe(cm.a.length);
  });

  it('is pure open deep in open ground', () => {
    const cm = buildControlMap(map(fill(9, 9, '.')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.5, 4.5, c))).toEqual([255, 0, 0, 0]);
    expect(at(cm, 'b', 4.5, 4.5, KNOLL)).toBe(0);
  });

  it('counts a road tile as open ground under the road', () => {
    const rows = fill(9, 9, '.');
    rows[4] = 'r'.repeat(9);
    const cm = buildControlMap(map(rows));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.44, 4.44, c))).toEqual([255, 0, 0, 0]);
  });

  // D1: the edge is 0.5 tile wide, NOT the plan's 1.5. A lone cover-1 tile's
  // core keeps its strength and nothing smears past 0.45 tile outside it.
  it('keeps a lone cover tile readable and does not smear it (D1)', () => {
    const rows = fill(9, 9, '.');
    rows[4] = '....1....';
    const cm = buildControlMap(map(rows));
    for (const x of [4.4375, 4.5625]) for (const z of [4.4375, 4.5625]) expect(at(cm, 'a', x, z, SCRUB)).toBeGreaterThanOrEqual(92);
    for (let j = 0; j < cm.height; j++)
      for (let i = 0; i < cm.width; i++) {
        const x = (i + 0.5) / N;
        const z = (j + 0.5) / N;
        // Per-axis reach is 0.25 (half band) + 0.2 (bend), so the bound is Chebyshev.
        const dx = Math.max(4 - x, 0, x - 5);
        const dz = Math.max(4 - z, 0, z - 5);
        if (Math.max(dx, dz) > 0.45) expect(cm.a[(j * cm.width + i) * 4 + SCRUB], `(${x}, ${z})`).toBe(0);
      }
  });

  it('centres the band on the tile edge, bent but never more than 0.45 tile off it', () => {
    const cm = buildControlMap(map(rowsOf(32, '......oooooo')));
    let midSum = 0;
    for (let j = 0; j < cm.height; j++) {
      const row = (x: number): number => cm.a[(j * cm.width + Math.floor(x * N)) * 4 + GROVE];
      expect(row(5.4)).toBe(0); // texel centre 5.4375: 0.5625 from the edge, past the 0.45 reach
      expect(row(6.6)).toBe(255); // texel centre 6.5625
      midSum += (row(5.9375) + row(6.0625)) / 2;
    }
    const mid = midSum / cm.height / 255;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('keeps a pad hard and the open ground beside it fully textured (R-4)', () => {
    const cm = buildControlMap(map(rowsOf(3, '...#....')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 3.5, 1.5, c))).toEqual([0, 0, 0, 0]);
    expect(at(cm, 'a', 2.9375, 1.5, OPEN)).toBe(255);
    expect(at(cm, 'a', 4.0625, 1.5, OPEN)).toBe(255);
  });

  it('keeps a ridge top pure rock and lays a 0.5-tile apron on the open side only', () => {
    const cm = buildControlMap(map(rowsOf(3, '....^^^^')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.0625, 1.5, c))).toEqual([0, 255, 0, 0]);
    expect(at(cm, 'a', 3.9375, 1.5, ROCK)).toBeGreaterThanOrEqual(102);
    expect(at(cm, 'a', 3.1875, 1.5, ROCK)).toBe(0);
    expect(at(cm, 'a', 3.1875, 1.5, OPEN)).toBe(255);
  });

  it('writes each cover tier at its own strength, and never draws a grove or knoll as scrub', () => {
    const cm = buildControlMap(map(rowsOf(4, '111222333oooonnnn')));
    expect(at(cm, 'a', 1.5, 1.5, SCRUB)).toBe(102);
    expect(at(cm, 'a', 4.5, 1.5, SCRUB)).toBe(166);
    expect(at(cm, 'a', 7.5, 1.5, SCRUB)).toBe(255);
    expect(at(cm, 'a', 10.5, 1.5, GROVE)).toBe(255);
    expect(at(cm, 'a', 10.5, 1.5, SCRUB)).toBe(0);
    expect(at(cm, 'b', 14.5, 1.5, KNOLL)).toBe(255);
    expect(at(cm, 'a', 14.5, 1.5, SCRUB)).toBe(0);
  });

  it('bakes the road distance, clamped at one tile', () => {
    const rows = fill(9, 9, '.');
    rows[4] = 'r'.repeat(9);
    const input = map(rows);
    const cm = buildControlMap(input);
    const g = buildRoadGraph(input);
    for (const [x, z] of [[4.5625, 4.5625], [2.0625, 4.8125], [3.3125, 5.0625]]) {
      const want = Math.round(Math.min(1, roadDistanceAt(g, x, z)) * 255);
      expect(at(cm, 'b', x, z, ROADD), `(${x}, ${z})`).toBe(want);
    }
    expect(at(cm, 'b', 4.5, 7.5, ROADD)).toBe(255);
    expect(at(cm, 'b', 4.5625, 4.5625, JUNCD)).toBe(255);
  });

  it('marks a crossroads in the junction channel', () => {
    const cm = buildControlMap(map(['.....', '..r..', '.rrr.', '..r..', '.....']));
    expect(at(cm, 'b', 2.5625, 2.5625, JUNCD)).toBeLessThanOrEqual(23);
  });

  it('bakes a signed edge bend that uses both halves of its byte', () => {
    const cm = buildControlMap(map(fill(16, 16, '.')));
    let lo = 255;
    let hi = 0;
    for (let k = BEND; k < cm.b.length; k += 4) {
      lo = Math.min(lo, cm.b[k]);
      hi = Math.max(hi, cm.b[k]);
    }
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(156);
  });

  it('is deterministic', () => {
    const m = map(['..1o^#rn..', '.r..2..3..']);
    const a = buildControlMap(m);
    const b = buildControlMap(m);
    expect(Array.from(a.a)).toEqual(Array.from(b.a));
    expect(Array.from(a.b)).toEqual(Array.from(b.b));
  });
});

describe('heightBiased -- the 0.15 height blend', () => {
  it('leaves a tile interior (weights 0 or 1) exactly as it was', () => {
    expect(heightBiased([1, 0, 0], [0.3, -0.2, 0.1])).toEqual([1, 0, 0]);
    expect(heightBiased([0.4, 0, 0], [0.3, 0, 0])).toEqual([0.4, 0, 0]);
  });
  it('lets the brighter texel win inside the band, and preserves the total', () => {
    const w = heightBiased([0.5, 0.5], [0.4, -0.4]);
    expect(w[0]).toBeGreaterThan(0.5);
    expect(w[0] + w[1]).toBeCloseTo(1, 9);
  });
});

describe('the macro field', () => {
  const f = buildMacroField(48, 48);
  it('is 256 x 256 R8', () => {
    expect(f.size).toBe(256);
    expect(f.data.length).toBe(256 * 256);
  });
  it('uses its whole range around a neutral middle', () => {
    let lo = 255;
    let hi = 0;
    let sum = 0;
    for (const v of f.data) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      sum += v;
    }
    expect(lo).toBeLessThanOrEqual(5);
    expect(hi).toBeGreaterThanOrEqual(250);
    expect(Math.abs(sum / f.data.length - 128)).toBeLessThan(12);
  });
  it('is low-frequency: the mean step between neighbouring texels is small', () => {
    let steps = 0;
    let n = 0;
    for (let j = 0; j < 256; j++)
      for (let i = 1; i < 256; i++) {
        steps += Math.abs(f.data[j * 256 + i] - f.data[j * 256 + i - 1]);
        n++;
      }
    expect(steps / n).toBeLessThan(6);
  });
  it('blurs by 1.5 tiles', () => {
    expect(macroBlurTexels(48)).toBe(8);
  });
  it('is deterministic', () => {
    expect(Array.from(buildMacroField(48, 48).data)).toEqual(Array.from(f.data));
  });
});

describe('macroFactor', () => {
  const bright = neutralTint('#D9C7A7'); // limestone.2
  const dark = neutralTint('#D1A668'); // dust.1
  const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  it('builds luminance-neutral tints', () => {
    expect(lum(bright)).toBeCloseTo(1, 9);
    expect(lum(dark)).toBeCloseTo(1, 9);
  });
  it('is neutral at m = 0 and at amplitude 0 (the macro layer hidden)', () => {
    expect(macroFactor(0, 1, bright, dark)).toEqual([1, 1, 1]);
    expect(macroFactor(0.8, 0, bright, dark)).toEqual([1, 1, 1]);
  });
  it('moves luminance by exactly +/-7% at the extremes', () => {
    expect(lum(macroFactor(1, 1, bright, dark))).toBeCloseTo(1.07, 9);
    expect(lum(macroFactor(-1, 1, bright, dark))).toBeCloseTo(0.93, 9);
  });
  it('pulls hue toward the dust side when dark', () => {
    const c = macroFactor(-1, 1, bright, dark);
    expect(c[0] / c[2]).toBeGreaterThan(1);
  });
});
```

  Add to `packages/app/src/ground-texture-slots.test.ts` (it already has `loadInput` and `MAP_IDS`):

```ts
import { buildControlMap, tileSurface, CONTROL_TEXELS_PER_TILE as N } from '@lions/render/terrain';

describe('the control map on every shipped map', () => {
  it.each(MAP_IDS)('%s: 8 texels a tile, and every tile core carries its own surface', (id) => {
    const { input } = loadInput(id);
    const cm = buildControlMap(input);
    expect([cm.width, cm.height]).toEqual([input.width * N, input.height * N]);
    const channel = { open: ['a', 0], road: ['a', 0], rock: ['a', 1], scrub: ['a', 2], grove: ['a', 3], knoll: ['b', 0] } as const;
    for (let y = 0; y < input.height; y++)
      for (let x = 0; x < input.width; x++) {
        const s = tileSurface(input, x, y);
        const o = ((y * N + 3) * cm.width + (x * N + 3)) * 4;
        if (s.kind === 'pad') {
          expect(cm.a[o] + cm.a[o + 1] + cm.a[o + 2] + cm.a[o + 3] + cm.b[o], `${id} (${x},${y}) pad`).toBe(0);
          continue;
        }
        const [t, c] = channel[s.kind];
        expect(cm[t][o + c], `${id} (${x},${y}) ${s.kind}`).toBeGreaterThanOrEqual(Math.floor(0.9 * s.strength * 255));
      }
  });

  // G2 on real data: qarn_hadid's road runs diagonally from (29,28) to (24,33).
  // Every texel along that segment is within a texel's diagonal of the centreline.
  it('joins qarn_hadid\'s diagonal road into one line (G2)', () => {
    const { input } = loadInput('qarn_hadid');
    const cm = buildControlMap(input);
    for (let k = 0; k <= 40; k++) {
      const x = 29.5 - (5 * k) / 40;
      const z = 28.5 + (5 * k) / 40;
      const o = (Math.floor(z * N) * cm.width + Math.floor(x * N)) * 4;
      expect(cm.b[o + 1], `(${x.toFixed(3)}, ${z.toFixed(3)})`).toBeLessThanOrEqual(23);
    }
  });

  // The two copies of the per-tile decision agree until Task 7 deletes one.
  it.each(MAP_IDS)('%s: tileSurface agrees with buildGround\'s masks', (id) => {
    const { input, terrain } = loadInput(id);
    const mesh = buildGround(input, TERRAIN_THEMES[terrain], BACKGROUND);
    const kinds = slotsInMesh(mesh);
    const fromSurface = new Set<GroundAlbedoSlot>();
    for (let y = 0; y < input.height; y++)
      for (let x = 0; x < input.width; x++) {
        const k = tileSurface(input, x, y).kind;
        if (k === 'open') fromSurface.add('sand');
        else if (k !== 'pad') fromSurface.add(k === 'road' ? 'road' : k);
      }
    expect(fromSurface).toEqual(kinds);
  });
});
```

- [ ] **Step 2: Implement.**
  - **`surfaceWeightsAt`:**
    1. A pad or ridge tile returns its own one-hot at once. Terraces are hard.
    2. Otherwise jitter the point: `q = p + EDGE_BEND_TILES * (valueNoise2(p, 1.5, 101), valueNoise2(p, 1.5, 202))`.
    3. For each non-terrace tile in the 3×3 around `floor(q)`, add `overlap(qx, tx) * overlap(qz, tz) * strength` to that tile's channel, where `overlap(q, t)` is the fraction of `[q − 0.25, q + 0.25]` inside `[t, t + 1]`. Road adds to `open`.
    4. Divide by the summed overlaps. That renormalisation is what keeps open ground full beside a pad.
    5. The apron: `apron = max over ridge tiles in the 3×3 of max(0, 1 − dist(q, tileRect)/APRON_TILES)`. Then `rock = apron`, and the other four are multiplied by `1 − apron`.
    6. If every overlap is 0, fall back to the tile's own one-hot.
  - **`buildControlMap`** evaluates at texel centres `((i + 0.5)/8, (j + 0.5)/8)`, with `byte(v) = round(clamp(v, 0, 1) * 255)`.
    - A: `open, rock, scrub, grove`.
    - B: `knoll`, then `min(1, roadDistanceAt/ROAD_DISTANCE_RANGE_TILES)`, then the same for `junctionDistanceAt`, then `0.5 + 0.5 * valueNoise2(p, ROAD_EDGE_BEND_CYCLES, 303)`.
    - One `buildRoadGraph` per build. Cost: 147k texels × a 3×3 walk plus ±2-tile road windows, measured in Task 5 on the largest map. It must stay under 60 ms, or `rebuildTerrain` needs a dirty region, which is reported, not built here.
  - **`heightBiased(w, h)`:** `w'_i = max(0, w_i + HEIGHT_BLEND * h_i * 4 w_i (1 − w_i))`, rescaled so that `Σw' = Σw`. It returns `w` untouched when `Σw' = 0`.
  - **`macroBlurTexels(W)`:** `round(MACRO_BLUR_TILES * MACRO_SIZE / W)`.
  - **`buildMacroField`:**
    1. At texel centres mapped to world tiles, sample `fbm2(p, MACRO_PERIOD_TILES, MACRO_OCTAVES, 404)`.
    2. `boxBlur` by `macroBlurTexels`.
    3. Normalise by the field's own `max|v|` to bytes `round(128 + 127 v)`.
  - **`neutralTint(hex)`:** `hexToLinear(hex)` divided by its Rec. 709 luminance.
  - **`macroFactor(m, amp, bright, dark)`:** `(1 + MACRO_LUMINANCE m amp) * mix(1, m ≥ 0 ? bright : dark, MACRO_HUE |m| amp)`, per channel.
- [ ] **Step 3: Gates, falsify, commit.** Falsify three things, each seen red:
  - (a) `EDGE_BAND_TILES = 1.5`, the plan's own text that D1 rejected: the lone-cover test goes red.
  - (b) Do not skip pads in the average: the pad test goes red.
  - (c) `APRON_TILES = 0`: the ridge test goes red.

  Message: `feat(render): the ground's control map, road bake and macro field (pure)`.

---

### Task 5: `GroundMaterial` splats the control map under the macro field

**Tier:** opus (a shader and `ThreeRenderer.ts`). The spec's §3.1. The `road` slot keeps its per-vertex path for this one task. Task 6 replaces it.

**Files:**
- Modify: `packages/render/src/three/terrain/mesh.ts`, `mesh.test.ts`, `ground.ts` (emit `wallAlbedo`), `types.ts` (`MeshData.wallAlbedo?: Float32Array`), `packages/render/src/three/ThreeRenderer.ts`

**Interfaces:**
- `export const WALL_ALBEDO_TOP = -1, WALL_ALBEDO_NONE = 0, WALL_ALBEDO_ROCK = 1` in `ground.ts`.
- `export function controlTextures(cm: ControlMap, macro: MacroField): { a: THREE.DataTexture; b: THREE.DataTexture; macro: THREE.DataTexture }` in `mesh.ts`, with the Global Constraints' sampler state.
- New `GroundMaterial` uniforms:
  - `uControlA`, `uControlB`, `uMacro`;
  - `uMapSize` (vec2);
  - `uMacroAmp` (1 shipped; the `macro` layer sets 0 in Task 9);
  - `uMacroBright`, `uMacroDark` (vec3).
- Defaults are 1×1 textures that mean "no albedo, no knoll, no road, neutral macro": A `(0,0,0,0)`, B `(0,255,255,128)`, macro `128`. Until the maps land, and forever if something fails, the ground draws its flat palette tone. That is the same fail-soft the slots already have.

- [ ] **Step 1: Write the failing tests** (added to `mesh.test.ts`; update the existing mask-attribute pins as noted).

```ts
import { HEIGHT_BLEND, MACRO_LUMINANCE, MACRO_HUE } from './control-map';
import { buildGround, WALL_ALBEDO_NONE, WALL_ALBEDO_ROCK, WALL_ALBEDO_TOP } from './ground';

describe('GroundMaterial samples the control map', () => {
  const src = compiledFragmentSource(new GroundMaterial()); // the file's existing onBeforeCompile harness

  it('declares the control and macro samplers, and no longer the five surface masks', () => {
    for (const u of ['uControlA', 'uControlB', 'uMacro', 'uMapSize', 'uMacroAmp']) expect(src).toContain(u);
    for (const m of ['vSandMask', 'vRockMask', 'vScrubMask', 'vGroveMask', 'vKnollMask']) expect(src).not.toContain(m);
  });
  it('carries the tested constants, not a transcription of them', () => {
    expect(src).toContain(HEIGHT_BLEND.toFixed(3));
    expect(src).toContain(MACRO_LUMINANCE.toFixed(3));
    expect(src).toContain(MACRO_HUE.toFixed(3));
  });
  it('fails soft: before any map lands, every default means "flat palette tone"', () => {
    const u = new GroundMaterial().uniforms;
    const px = (name: string): number[] => Array.from((u[name].value as THREE.DataTexture).image.data as Uint8Array);
    expect(px('uControlA')).toEqual([0, 0, 0, 0]);
    expect(px('uControlB')).toEqual([0, 255, 255, 128]);
    expect(px('uMacro')[0]).toBe(128);
    expect(u.uMacroAmp.value).toBe(1);
  });
  it('builds its textures as data, not colour', () => {
    const t = controlTextures(buildControlMap(tinyInput), buildMacroField(4, 4));
    for (const tex of [t.a, t.b, t.macro]) {
      expect(tex.colorSpace).toBe(THREE.NoColorSpace);
      expect(tex.flipY).toBe(false);
      expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
      expect(tex.generateMipmaps).toBe(true);
    }
    expect(t.macro.format).toBe(THREE.RedFormat);
  });
});

describe('wallAlbedo -- the one per-vertex surface fact left (R-5)', () => {
  it('is -1 on every top, 1 on a ridge wall, 0 on a building wall', () => {
    const data = buildGround(reliefWithRidgeAndBuilding(), TONES, BACKGROUND);
    const w = data.wallAlbedo;
    if (!w) throw new Error('buildGround emitted no wallAlbedo');
    const byKind = new Map<string, Set<number>>();
    for (let t = 0; t < data.indices.length / 3; t++) {
      const vs = [0, 1, 2].map((k) => data.indices[t * 3 + k]);
      const kind = kindOf(vertex(data, vs[0]), vertex(data, vs[1]), vertex(data, vs[2]));
      const set = byKind.get(kind) ?? new Set<number>();
      for (const v of vs) set.add(w[v]);
      byKind.set(kind, set);
    }
    for (const top of ['tile top', 'surface patch']) {
      const s = byKind.get(top);
      if (s) expect(s, top).toEqual(new Set([WALL_ALBEDO_TOP]));
    }
    const walls = new Set([...(byKind.get('east face') ?? []), ...(byKind.get('south face') ?? [])]);
    expect(walls).toEqual(new Set([WALL_ALBEDO_ROCK, WALL_ALBEDO_NONE]));
    expect(toGeometry(data).getAttribute('wallAlbedo').count).toBe(data.positions.length / 3);
  });
});
```

  - The test above uses four helpers. Write them in the test file.
    - `kindOf` and `vertex`: copy them verbatim from `ground.test.ts:29-50`.
    - `reliefWithRidgeAndBuilding()`: a 4×4 input at elevation 1, with a `^` ridge at (1,1) and a blocked building tile at (2,2), both at elevation 3, so each throws walls.
    - `compiledFragmentSource`: the file's existing pattern, which runs `onBeforeCompile` against a stub `{ vertexShader, fragmentShader, uniforms }` holding three's chunk markers.
  - Update the existing tests that pin five mask attributes in the shader, so they now pin their absence. The road's `roadMask` and `roadAxis` pins stay until Task 6.
- [ ] **Step 2: Implement.**
  - **`ground.ts`:** `pushQuad` and `pushSmoothTile` push `WALL_ALBEDO_TOP`. `pushWall` pushes `WALL_ALBEDO_ROCK` when `rock !== 0`, else `WALL_ALBEDO_NONE`. The existing mask arrays are still emitted, unused, until Task 7.
  - **`mesh.ts`, `toGeometry`:** add the `wallAlbedo` attribute.
  - **Vertex shader:** `attribute float wallAlbedo; varying float vWallAlbedo; varying vec2 vRlWorldXZ;`, with `vRlWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;` after `<begin_vertex>`.
  - **Fragment shader**, after `<color_fragment>`, replacing the five surface mixes. `rlSand` … `rlKnoll` are the existing ratio samples:

```glsl
vec2 rlCtlUv = vRlWorldXZ / uMapSize;
vec4 rlA = texture2D(uControlA, rlCtlUv);
vec4 rlB = texture2D(uControlB, rlCtlUv);
float rlTop = step(vWallAlbedo, -0.5);
// Five surface weights: open, rock, scrub, grove, knoll. A wall ignores the map.
float rlW0 = rlTop * rlA.r;
float rlW1 = rlTop * rlA.g + (1.0 - rlTop) * max(vWallAlbedo, 0.0);
float rlW2 = rlTop * rlA.b;
float rlW3 = rlTop * rlA.a;
float rlW4 = rlTop * rlB.r;
// Height blend: each weight biased by its own texel's luminance deviation, then rescaled (heightBiased).
... (the heightBiased formula, with ${HEIGHT_BLEND.toFixed(3)}) ...
vec3 rlAlbedo = vec3(1.0)
  + rlW0 * (mix(vec3(1.0), rlSand,  uSandStrength)  - 1.0)
  + rlW1 * (mix(vec3(1.0), rlRock,  uRockStrength)  - 1.0)
  + rlW2 * (mix(vec3(1.0), rlScrub, uScrubStrength) - 1.0)
  + rlW3 * (mix(vec3(1.0), rlGrove, uGroveStrength) - 1.0)
  + rlW4 * (mix(vec3(1.0), rlKnoll, uKnollStrength) - 1.0);
rlAlbedo *= mix(vec3(1.0), rlRoad, uRoadStrength * vRoadMask); // Task 6 replaces this line
float rlM = (texture2D(uMacro, rlCtlUv).r * 2.0 - 1.0) * uMacroAmp;
vec3 rlMacro = (1.0 + ${MACRO_LUMINANCE.toFixed(3)} * rlM)
  * mix(vec3(1.0), rlM >= 0.0 ? uMacroBright : uMacroDark, ${MACRO_HUE.toFixed(3)} * abs(rlM));
diffuseColor.rgb *= rlAlbedo * rlMacro;
```

    **The weighted sum is the old chain of mixes, exactly, on every tile interior.** A one-hot weight gives `mix(1, r, s)`. Scrub at weight 0.4 gives `mix(1, r, 0.4 s)`, which is today's `strength × mask`. So the only interior change is the macro factor. The file header explains this in its existing "ratio" terms.
  - **`ThreeRenderer.ts`:**
    - `composeTerrain` (`:8520`) also returns `control: buildControlMap(input)`. It uses the same `input` (the draw mask), so a live low-profile structure stays open ground.
    - `rebuildTerrain` (`:7746`) disposes the previous control textures and binds the new pair. A destroyed structure rebuilds it.
    - The macro field is built once, in the constructor, and bound.
    - `uMapSize = (sim.width, sim.height)`.
    - `uMacroBright`/`uMacroDark` are `neutralTint` of `overlayColor('limestone.2', '#D9C7A7')` and `overlayColor('dust.1', '#D1A668')`.
    - Dispose all three in `dispose()`.
- [ ] **Step 3: Measure the build.** Log `buildControlMap`'s time for `wadi_halam_basin` and `qarn_hadid` from a temporary `console.time` in a node script, not in shipping code. Record the figures in the commit body. Above 60 ms, stop and report.
- [ ] **Step 4: Look, then A/B.**
  - `pnpm ground:capture -- --port=5196 --out=.superpowers/ground/t5`. Look at `qarn_hadid-road-z2.5-nofog` (G3) and the three `centre-z0.5` views (G4). Measure G4's 16-px block-mean std in the same crop the spec used (0.6% → about 6%) and record it.
  - `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground/t5`, then the A/B against `t0`.
  - **Expected:** all four ground scenarios move (splat edges and macro), and `combat` moves (report-only).
  - Every existing layer check must still clear its floor. The one to watch is `scatter`'s `toneCheck`, because the macro survives `ground-albedo` being hidden. If any check falls below, stop and report (Global Constraints).
- [ ] **Step 5: Gates, falsify, commit.**
  - **Falsify:** change `rlTop`'s threshold so that tops read as walls (`step(vWallAlbedo, -1.5)`). Photograph it: open ground goes flat palette. Confirm that the `ground-albedo` check on `open-ground` goes red in `pnpm golden-baseline -- --port=5195 --scenario=open-ground --out-dir=.superpowers/ground/t5-falsify`. Revert.
  - Message: `feat(render): the ground splats a control map under a macro field (G3, G4, G10)`.

---

### Task 6: The road draws from its distance field (#226)

**Tier:** opus (a shader and `ThreeRenderer.ts`). The spec's §3.2.

**Files:**
- Modify: `packages/render/src/three/terrain/mesh.ts`, `mesh.test.ts`, `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/ThreeRenderer.ground-albedo.test.ts`

**Interfaces:**
- `GROUND_SLOTS` becomes `['sand', 'rock', 'scrub', 'grove', 'knoll']`. The `road` slot, `uRoad*`, `vRoadMask` and `vRoadAxis` retire.
- New uniforms:
  - `uRoadOn` (1; the `roads` layer sets 0 in Task 9);
  - `uRoadTone`, `uShoulderTone`, `uRutTone` (linear vec3);
  - `uRoadGrainTiles` (`ROAD_GRAIN_TILES`), `uRoadGrainGain` (`ROAD_GRAIN_GAIN`; stashed and zeroed by `ground-albedo`).

- [ ] **Step 1: Write the failing tests.**

```ts
// mesh.test.ts
import {
  ROAD_EDGE_BEND, ROAD_EDGE_FALLOFF, ROAD_HALF_WIDTH, RUT_ALPHA, RUT_JUNCTION_FADE, RUT_OFFSET, RUT_WIDTH,
  SHOULDER_ALPHA, SHOULDER_TILES,
} from './road-graph';

describe('the road shader (#226)', () => {
  const src = compiledFragmentSource(new GroundMaterial());
  it('has no road slot and no axis blend any more', () => {
    expect(GROUND_SLOTS).toEqual(['sand', 'rock', 'scrub', 'grove', 'knoll']);
    for (const gone of ['uRoad;', 'uRoadStrength', 'vRoadAxis', 'vRoadMask', 'rlRoadUv']) expect(src).not.toContain(gone);
  });
  it('draws surface, shoulder and ruts from control B with the tested profile constants', () => {
    for (const k of [ROAD_HALF_WIDTH, ROAD_EDGE_FALLOFF, ROAD_EDGE_BEND, SHOULDER_TILES, SHOULDER_ALPHA, RUT_OFFSET, RUT_WIDTH, RUT_ALPHA, RUT_JUNCTION_FADE])
      expect(src).toContain(k.toFixed(3));
    for (const u of ['uRoadOn', 'uRoadTone', 'uShoulderTone', 'uRutTone', 'uRoadGrainTiles', 'uRoadGrainGain']) expect(src).toContain(u);
  });
  it('takes its grain from the knoll sampler -- one shared image, no road asset (R-7)', () => {
    expect(src).toMatch(/texture2D\s*\(\s*uKnoll\s*,\s*vRlWorldXZ\s*\/\s*uRoadGrainTiles\s*\)/);
  });
  it('lets the road cover the surfaces beneath it', () => {
    expect(src).toMatch(/rlW0\s*\*=\s*\(1\.0\s*-\s*rlRoadSurf\)/);
  });
});
```

```ts
// ThreeRenderer.ground-albedo.test.ts -- beside the existing strength-stash tests
it('stashes and restores the road grain gain with the other texture terms', () => {
  const r = makeRenderer();
  const u = priv(r).groundMat.uniforms;
  expect(u.uRoadGrainGain.value).toBe(ROAD_GRAIN_GAIN);
  r.setDebugLayerVisible('ground-albedo', false);
  expect(u.uRoadGrainGain.value).toBe(0);
  r.setDebugLayerVisible('ground-albedo', true);
  expect(u.uRoadGrainGain.value).toBe(ROAD_GRAIN_GAIN);
});
it('binds the road tones as linear light from the theme and the palette', () => {
  const u = priv(makeRenderer()).groundMat.uniforms;
  expect((u.uRoadTone.value as THREE.Vector3).toArray()).toEqual(hexToLinear(TONES.road));
});
```

  - Replace the existing test "blends the road between two samples, and only the road" (`mesh.test.ts:281`). It is superseded by the first test above.
  - If `ThreeRenderer.ground-albedo.test.ts` pins six loads or six slots anywhere, make it five.
- [ ] **Step 2: Implement.** GLSL, after the surface weights and before the albedo sum:

```glsl
float rlRoadD = rlB.g * ${ROAD_DISTANCE_RANGE_TILES.toFixed(3)};
float rlJuncD = rlB.b * ${ROAD_DISTANCE_RANGE_TILES.toFixed(3)};
float rlRoadE = rlRoadD + ${ROAD_EDGE_BEND.toFixed(3)} * (rlB.a * 2.0 - 1.0);
float rlRoadSurf = uRoadOn * rlTop * (1.0 - smoothstep(H0, H1, rlRoadE));
float rlShoulder = uRoadOn * rlTop * ${SHOULDER_ALPHA.toFixed(3)} * smoothstep(H0, H1, rlRoadE) * (1.0 - smoothstep(H1, H1 + ${SHOULDER_TILES.toFixed(3)}, rlRoadE));
vec3 rlGrain = texture2D(uKnoll, vRlWorldXZ / uRoadGrainTiles).rgb / uKnollMean;
float rlGrainLum = dot(rlGrain, vec3(0.2126, 0.7152, 0.0722));
float rlRut = ${RUT_ALPHA.toFixed(3)} * (1.0 - smoothstep(RW0, RW1, abs(rlRoadD - ${RUT_OFFSET.toFixed(3)})))
  * smoothstep(0.0, ${RUT_JUNCTION_FADE.toFixed(3)}, rlJuncD) * rlRoadSurf
  * smoothstep(0.85, 1.05, rlGrainLum); // broken by the grain, the "world noise" of spec §3.2
rlW0 *= (1.0 - rlRoadSurf); rlW1 *= (1.0 - rlRoadSurf); rlW2 *= (1.0 - rlRoadSurf); rlW3 *= (1.0 - rlRoadSurf); rlW4 *= (1.0 - rlRoadSurf);
diffuseColor.rgb = mix(diffuseColor.rgb, uRoadTone, rlRoadSurf);
diffuseColor.rgb = mix(diffuseColor.rgb, uShoulderTone, rlShoulder);
diffuseColor.rgb = mix(diffuseColor.rgb, uRutTone, rlRut);
// and in the albedo sum: + rlRoadSurf * (mix(vec3(1.0), rlGrain, uRoadGrainGain) - 1.0)
```

  - `H0`/`H1` are `ROAD_HALF_WIDTH ∓ ROAD_EDGE_FALLOFF/2`, and `RW0`/`RW1` are `RUT_WIDTH/2 ∓ 0.01`, all interpolated as literals.
  - The tone mixes come before the ratio multiply, because the albedo stays a ratio.
  - This is `roadProfile` transcribed. Note in the comment that `road-graph.test.ts` is its test.
  - **`ThreeRenderer.ts`:**
    - Delete `load(this.opts.roadTextureUrl, 'road', 'road')` (`:1145`).
    - Load `knoll` when `usedSlots` has `knoll` **or** `road`. Task 7 moves that rule into `groundAlbedoSlotsUsed`.
    - Bind `uRoadTone = hexToLinear(opts.terrainTones.road)`, `uShoulderTone = hexToLinear(overlayColor('limestone.2', '#D9C7A7'))` and `uRutTone = hexToLinear(overlayColor('limestone.6', '#8C7659'))`.
    - `setGroundAlbedoOn` stashes and restores `uRoadGrainGain` beside the slot strengths.
  - Road tiles still carry the old road vertex tone until Task 7. At the road's centre the shader already paints `uRoadTone`, so for one task the edge band shows the tile's own old tone. That is interim, and nothing is blessed until Task 18.
- [ ] **Step 3: Look, then A/B.**
  - `pnpm ground:capture -- --port=5196 --out=.superpowers/ground/t6`. Look at `beit_sahwan_outskirts-road-z2.5-nofog` (G1), `qarn_hadid-centre-z1-nofog` (G2: the diagonal is one track, not beads) and the crossroads.
  - Golden A/B:
    - **Expected to move:** `quiet`, `vehicle`, and `open-ground` only if a road lies in its crop.
    - **Expected unmoved:** `relief`. The base `tel_marum` has no road; measured: 0 `r` tiles.
- [ ] **Step 4: Gates, falsify, commit.**
  - **Falsify:** bake B.g as 255 everywhere (a one-line mutation in `buildControlMap`). The roads vanish from `ground:capture`'s road view. Photograph and revert. Task 9's `roads` check is where this becomes a vote.
  - Message: `feat(render): the road is a worn track from a distance field (#226, G1, G2)`.

---

### Task 7: The vertex stream retires: masks, the road tone and the road slot

**Tier:** sonnet.

**Files:**
- Modify: `packages/render/src/three/terrain/ground.ts`, `ground.test.ts`, `types.ts`, `mesh.ts` (`toGeometry` only), `packages/app/src/ground-texture-slots.test.ts`

**Interfaces:**
- `MeshData` loses `sandMask`, `rockMask`, `roadMask`, `roadAxis`, `scrubMask`, `groveMask` and `knollMask`. `wallAlbedo` stays.
- `ground.ts` loses `albedoFor`, `Albedo`, `AlbedoArrays`, `pushAlbedo`, `roadAxisAt` and `ROAD_AXIS_*`.
- `GroundAlbedoSlot` becomes `'sand' | 'rock' | 'scrub' | 'grove' | 'knoll'`.
- `groundAlbedoSlotsUsed` walks `tileSurface`: `open` → `sand`, `road` → `sand` + `knoll` (R-7), `pad` → nothing.

- [ ] **Step 1: Write the failing tests.**

```ts
// ground.test.ts -- replacing the per-mask suites
describe('the vertex stream after the control map', () => {
  it('carries no surface masks, only wallAlbedo', () => {
    const m = buildGround(flat(4, 4), TONES, BACKGROUND);
    for (const k of ['sandMask', 'rockMask', 'roadMask', 'roadAxis', 'scrubMask', 'groveMask', 'knollMask'])
      expect((m as unknown as Record<string, unknown>)[k], k).toBeUndefined();
    expect(m.wallAlbedo?.length).toBe(m.positions.length / 3);
  });
  // R-3: the road's tone comes from the shader's distance field now. Left in the
  // vertex stream, it would step at every tile edge whatever the SDF drew.
  it('gives a road tile the open ground\'s tone', () => {
    const input = flat(3, 1);
    input.decor = Uint8Array.from([0, DECOR_ROAD, 0]);
    const m = buildGround(input, TONES, BACKGROUND);
    const colourAt = (x: number): number[] => {
      for (let v = 0; v < m.positions.length / 3; v++)
        if (m.positions[v * 3] > x + 0.1 && m.positions[v * 3] < x + 0.9) return Array.from(m.colors.slice(v * 3, v * 3 + 3));
      return [];
    };
    expect(colourAt(1)).toEqual(colourAt(0));
  });
});

describe('groundAlbedoSlotsUsed', () => {
  it('never answers "road" -- a road needs the knoll image for its grain (R-7)', () => {
    const input = flat(4, 1);
    input.decor = Uint8Array.from([0, DECOR_ROAD, DECOR_ROAD, 0]);
    expect(groundAlbedoSlotsUsed(input)).toEqual(new Set(['sand', 'knoll']));
  });
  // ...the existing cases, with 'road' replaced by 'knoll' in their expectations (`ground.test.ts:937`, `:950`).
});
```

  In `ground-texture-slots.test.ts`:
  - Delete `slotsInMesh` and the mask walk, and the Task 4 "agrees with buildGround's masks" test with them. With `albedoFor` gone, the two copies are one.
  - Keep the control-map walk.
  - Add: `groundAlbedoSlotsUsed(input)` ⊇ the set of non-zero control channels (open → `sand`, B.g < 255 → `knoll`) on all 26 maps. That is the loader's guard rail, now read off the map the material actually samples.
- [ ] **Step 2: Implement.**
  - `buildGround`:
    - drops the albedo arrays and `pushAlbedo`;
    - `tileAlbedo` goes, and `pushWall` keeps its `rock` flag for `wallAlbedo`;
    - the tone for an `r` tile is `quantise(composite(background, tones.open, 1), PALETTE_HEXES)`: `groundTone`'s own open wash, via a local helper, so `groundTone` is untouched.
  - `toGeometry` drops the seven `setAttribute` lines.
  - `groundAlbedoSlotsUsed` is rewritten over `tileSurface`.
  - `ThreeRenderer`'s `knoll`-or-`road` condition from Task 6 still compiles, and becomes redundant. Leave the simplification to Task 9, which edits that file anyway.
- [ ] **Step 3: A/B.**
  - **Expected to move:** `quiet` and `vehicle` (road tiles' edge tone).
  - **Expected unmoved:** `open-ground` and `relief`. Only unused attributes left their geometry.
- [ ] **Step 4: Gates, falsify, commit.**
  - **Falsify:** leave road tiles on `groundTone`. The road-tone test goes red. Revert.
  - Message: `refactor(render): the ground's vertex stream carries one surface fact, not seven`.

---

### Task 8: The rut dashes and the road URL retire

**Tier:** sonnet.

**Files:**
- Modify: `packages/render/src/three/terrain/scatter.ts`, `scatter.test.ts`, `packages/render/src/api.ts`, `packages/app/src/renderer-options.ts`, `packages/app/src/renderer-options.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// scatter.test.ts
it('draws no rut dashes on a road -- the ground shader owns the road now (#226)', () => {
  const input = flat(3, 1);
  input.decor = Uint8Array.from([0, DECOR_ROAD, 0]);
  const withRoad = buildScatter(input, TONES, BACKGROUND);
  const without = buildScatter(flat(3, 1), TONES, BACKGROUND);
  // Tile 1's marks, if any, are the open-ground grain the same tile gets without the road.
  expect(marksOnTile(withRoad, 1, 0)).toBe(0);
  expect(marksOnTile(without, 1, 0)).toBeGreaterThanOrEqual(0);
});
```

```ts
// renderer-options.test.ts -- in 'serves every ground texture from the deploy base'
const urls = [o.groundTextureUrl, o.rockTextureUrl, o.scrubTextureUrl, o.groveTextureUrl, o.knollTextureUrl];
// and:
it('no longer asks for a road image', () => {
  expect('roadTextureUrl' in rendererOptionsFor(arid, HIGH, '/')).toBe(false);
});
```

  - `marksOnTile` counts triangles whose centroid lies in the tile. Write it in the test file.
  - Delete the existing rut-dash assertions in `scatter.test.ts`.
  - Decide whether a road tile gets the open grain. It must not: the grain would sit on the packed surface. The test above pins "no marks".
- [ ] **Step 2: Implement.**
  - Delete the `DECOR_ROAD` branch in `buildScatter` (`scatter.ts:533-545`), and make road tiles `continue` before the open-ground grain.
  - Delete `roadTextureUrl` from `RendererOptions` (`api.ts:161`) and from `rendererOptionsFor`.
  - Update `scatter.ts`'s header list ("road ruts").
- [ ] **Step 3: A/B.** **Expected to move:** `quiet`, `vehicle`, and `open-ground` if a road is in its crop. The `scatter` layer checks must still clear their floors. If one does not, stop and report.
- [ ] **Step 4: Gates, falsify, commit.**
  - **Falsify:** restore the dash branch. The scatter test goes red. Revert.
  - Message: `refactor(render): the road's dashes and its image retire (#226)`.

---

### Task 9: The `roads` and `macro` layers, their checks and the road tones

**Tier:** opus (`ThreeRenderer.ts`).

**Files:**
- Modify: `packages/render/src/three/debug-layers.ts`, `debug-layers.test.ts`, `packages/render/src/three/ThreeRenderer.ts`, `tools/src/golden-diff/baseline.ts`, `packages/app/src/terrain-themes.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// debug-layers.test.ts
it('names the ground\'s two new contributions', () => {
  expect(DEBUG_LAYERS).toContain('macro');
  expect(DEBUG_LAYERS).toContain('roads');
});
it.each([
  ['macro', 'uMacroAmp'],
  ['roads', 'uRoadOn'],
])('%s drives %s to 0 and back, and a second hide reports nothing changed', (layer, uniform) => {
  const r = makeRenderer();
  const u = priv(r).groundMat.uniforms[uniform];
  expect(u.value).toBe(1);
  expect(r.setDebugLayerVisible(layer, false)).toBe(1);
  expect(u.value).toBe(0);
  expect(r.setDebugLayerVisible(layer, false)).toBe(0);
  expect(r.setDebugLayerVisible(layer, true)).toBe(1);
  expect(u.value).toBe(1);
});
```

  `makeRenderer` is the file's own fixture. `priv(r)` is the cast to `{ groundMat: GroundMaterial }`, written the way the file already reaches private state.
- [ ] **Step 2: Implement.**
  - **`debug-layers.ts`:** add `'macro'` and `'roads'`. Each doc paragraph says it is a plain uniform write that nothing in `frame()` re-asserts, so it holds across the gate's repaint (checked by grepping every writer of `uMacroAmp` and `uRoadOn`, the `fog` layer's own standard).
  - **`ThreeRenderer.ts`:**
    - Two cases, each returning `was === want ? 0 : 1`.
    - Simplify Task 6's `knoll`-or-`road` load condition to `usedSlots.has('knoll')`.
  - **`terrain-themes.ts` (D2, R-8):** arid `road: paletteColor('limestone.4')` (was `dust.3`); green `road: paletteColor('dust.3')` (was `dust.4`). Each carries a comment naming D2 and the saturation it fixes: G1, 0.6 → about 0.3.
- [ ] **Step 3: Measure the floors: three consecutive runs, a third of the smallest.**
  - `pnpm golden-baseline -- --port=5195 --scenario=quiet,open-ground,relief --out-dir=.superpowers/ground/t9-r<k>` for k = 1, 2, 3.
  - Read the printed toggle deltas. They should be bit-identical across runs; if not, that is a bug to find, not a band.
  - Add these entries:
    - `quiet`: `{ layer: 'roads', minDiffPixels: ⌊⅓ min px⌋, minMeanAbsChannelDelta: ⌊⅓ min delta⌋ (4 dp) }`. `quiet` frames the town crossroads (spec §3.2).
    - `open-ground` and `relief`: `{ layer: 'macro', … }` on the same rule. Macro is low-frequency, so if its pixel count reads under about 30, `minDiffPixels` is 0 and the rationale says so, as `ground-albedo`'s does.
  - Each rationale gives the three readings, the conditions (SwiftShader, frame loop frozen, the date) and the falsification below.
- [ ] **Step 4: Falsify, each seen red, then revert.**
  - (a) Initialise `uMacroAmp` to 0 in `GroundMaterial`, so the field never shows. `macro` fails on both scenarios at 0 px / 0.0000.
  - (b) Bake B.g = 255. `roads` fails on `quiet`.
  - (c) Leave `'roads'` in `DEBUG_LAYERS` but delete its `ThreeRenderer` case. The gate throws `unknown layer` in the page, which is a capture failure (exit 2), never a silent pass.
- [ ] **Step 5: A/B and commit.**
  - A/B: the road tone moves `quiet` and `vehicle`.
  - Message: `feat(render): the roads and macro layers vote, and the road takes its approved tone (D2)`.

---

### Task 10: The decal pool core: ring, conforming grid, sim-time clock

**Tier:** sonnet. The spec's §3.3, without the kind shader.

**Files:**
- Create: `packages/render/src/three/decal-pool.ts`, `packages/render/src/three/decal-pool.test.ts`
- Modify: `packages/render/src/three/units/render-order.ts`, `render-order.test.ts`

**Interfaces:**

```ts
// render-order.ts
export const DECAL_PERSISTENT_RENDER_ORDER = WORLD_RENDER_ORDER; // under everything that moves
export const DECAL_FADING_RENDER_ORDER = TRAIL_RENDER_ORDER;     // tread drawn over an old crater, never over a unit

// decal-pool.ts, pure half
export type DecalKind = 'crater' | 'scorch' | 'oil' | 'rubble' | 'tread' | 'tyre';
export const DECAL_KIND_INDEX: Readonly<Record<DecalKind, number>>; // 0..5, in that order
export function isFadingKind(k: DecalKind): boolean; // tread, tyre
export const PERSISTENT_CAPACITY = 1024, FADING_CAPACITY = 4096;
export const PERSISTENT_GRID = 4, FADING_GRID = 2;
export const MS_PER_TICK = 50;
export function presentationSimMs(tickCount: number, alpha: number): number;
export function stampSimMs(tickCount: number): number;
export function gridTriangles(n: number): number;
export function writeGridIndices(out: Uint32Array, slot: number, n: number): void;
export interface GridPlacement { readonly cx: number; readonly cz: number; readonly halfLength: number; readonly halfWidth: number; readonly facingRad: number }
export function writeDecalGrid(out: Float32Array, slot: number, n: number, p: GridPlacement,
  sampleY: (x: number, z: number) => number, isTerrace: (x: number, z: number) => boolean): void;
export function writeDecalOffsets(out: Float32Array, slot: number, n: number): void;
export function craterRadiusTiles(power: number): number; // R-13
export const OIL_RADIUS_TILES = 0.5;
export function rubbleRadiusTiles(minX: number, minY: number, maxX: number, maxY: number): number;
export const TRACK_FEATHER_TILES = 0.08;
export const TRACK_STAMP_HALF_LENGTH: number; // (STAMP_SPACING_TILES + TRACK_FEATHER_TILES) / 2 = 0.29, R-15
export interface DecalStamp {
  readonly kind: DecalKind; readonly x: number; readonly z: number;
  readonly halfLength: number; readonly halfWidth: number; readonly facingRad: number;
  readonly seed: number; readonly simMs: number;
}

// GPU half
export class DecalPool {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  constructor(opts: { capacity: number; grid: number; renderOrder: number; material: THREE.Material });
  get capacity(): number;
  get liveCount(): number;
  stamp(s: DecalStamp, sampleY: (x: number, z: number) => number, isTerrace: (x: number, z: number) => boolean): void;
  dispose(): void; // geometry only; the material is shared and owned by the caller
}
```

  Per-vertex attributes: `position` (dynamic), `aOffset` (vec2, static, in [−1,1]²) and `aDecal` (vec4, dynamic: kind index, seed, `simMs/1000`, `halfLength`).

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/decal-pool.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  craterRadiusTiles, DecalPool, FADING_CAPACITY, FADING_GRID, gridTriangles, PERSISTENT_CAPACITY, PERSISTENT_GRID,
  presentationSimMs, rubbleRadiusTiles, stampSimMs, TRACK_STAMP_HALF_LENGTH, writeDecalGrid, writeDecalOffsets,
  writeGridIndices, type DecalStamp,
} from './decal-pool';
import { isAoOccluder } from './post-chain';
import { MARK_EPSILON } from './terrain/shared';
import { DECAL_FADING_RENDER_ORDER, DECAL_PERSISTENT_RENDER_ORDER } from './units/render-order';

const flat = (): number => 0;
const never = (): boolean => false;
const stamp = (over: Partial<DecalStamp> = {}): DecalStamp => ({
  kind: 'crater', x: 5, z: 5, halfLength: 0.5, halfWidth: 0.5, facingRad: 0, seed: 0.3, simMs: 0, ...over,
});

describe('the sim-time clock (R-14)', () => {
  it('presents (tick - 1 + alpha) x 50 ms, never negative', () => {
    expect(presentationSimMs(10, 1)).toBe(500);
    expect(presentationSimMs(10, 0.5)).toBe(475);
    expect(presentationSimMs(0, 0)).toBe(0);
  });
  it('dates a snapshot stamp at the tick it will be presented at alpha 1', () => {
    expect(stampSimMs(10)).toBe(presentationSimMs(10, 1));
  });
  // The gate's repaint is frame(1, 0): no ticks, so the same clock to the bit.
  it('does not move without a tick, whatever the frame time', () => {
    expect(presentationSimMs(200, 1)).toBe(presentationSimMs(200, 1));
  });
});

describe('the conforming grid', () => {
  it('is 18 triangles at 4x4 and 2 at 2x2, which is what keeps the pools under 27k (R-10)', () => {
    expect(gridTriangles(PERSISTENT_GRID)).toBe(18);
    expect(gridTriangles(FADING_GRID)).toBe(2);
    expect(PERSISTENT_CAPACITY * 18 + FADING_CAPACITY * 2).toBe(26624);
  });
  it('winds every triangle up at facing 0', () => {
    for (const n of [PERSISTENT_GRID, FADING_GRID]) {
      const pos = new Float32Array(n * n * 3);
      writeDecalGrid(pos, 0, n, { cx: 0, cz: 0, halfLength: 1, halfWidth: 1, facingRad: 0 }, flat, never);
      const idx = new Uint32Array(gridTriangles(n) * 3);
      writeGridIndices(idx, 0, n);
      for (let t = 0; t < idx.length / 3; t++) {
        const v = (k: number): THREE.Vector3 => new THREE.Vector3().fromArray(pos, idx[t * 3 + k] * 3);
        const nrm = new THREE.Vector3().subVectors(v(1), v(0)).cross(new THREE.Vector3().subVectors(v(2), v(0)));
        expect(nrm.y, `n=${n} t=${t}`).toBeGreaterThan(0);
      }
    }
  });
  it('offsets the indices by the slot', () => {
    const idx = new Uint32Array(gridTriangles(4) * 3);
    writeGridIndices(idx, 3, 4);
    expect(Math.min(...idx)).toBe(3 * 16);
    expect(Math.max(...idx)).toBe(3 * 16 + 15);
  });
  it('conforms to the ground under every vertex, lifted by MARK_EPSILON', () => {
    const pos = new Float32Array(16 * 3);
    const slope = (x: number): number => 0.1 * x;
    writeDecalGrid(pos, 0, 4, { cx: 5, cz: 5, halfLength: 1, halfWidth: 1, facingRad: 0 }, slope, never);
    for (let v = 0; v < 16; v++) expect(pos[v * 3 + 1]).toBeCloseTo(0.1 * pos[v * 3] + MARK_EPSILON, 6);
  });
  it('turns with its facing', () => {
    const pos = new Float32Array(4 * 3);
    writeDecalGrid(pos, 0, 2, { cx: 0, cz: 0, halfLength: 1, halfWidth: 0.1, facingRad: Math.PI / 2 }, flat, never);
    const zs = [0, 1, 2, 3].map((v) => pos[v * 3 + 2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 6);
  });
  // R-19: a vertex over a terrace must not climb the wall.
  it('holds a vertex over a terrace at the centre\'s height', () => {
    const pos = new Float32Array(16 * 3);
    const terraceEast = (x: number): boolean => x > 5.5;
    const tall = (x: number): number => (x > 5.5 ? 3 : 0.2);
    writeDecalGrid(pos, 0, 4, { cx: 5, cz: 5, halfLength: 1, halfWidth: 1, facingRad: 0 }, tall, terraceEast);
    for (let v = 0; v < 16; v++) expect(pos[v * 3 + 1]).toBeCloseTo(0.2 + MARK_EPSILON, 6);
  });
  it('writes offsets in the same vertex order as positions', () => {
    const off = new Float32Array(16 * 2);
    writeDecalOffsets(off, 0, 4);
    expect([off[0], off[1]]).toEqual([-1, -1]);
    expect([off[30], off[31]]).toEqual([1, 1]);
  });
});

describe('sizes -- spec §5', () => {
  it('sizes a crater at 0.45 tile for a mortar and 0.6 for a Grad (R-13)', () => {
    expect(craterRadiusTiles(0.3)).toBeCloseTo(0.45, 9);
    expect(craterRadiusTiles(0.45)).toBeCloseTo(0.6, 9);
    expect(craterRadiusTiles(0)).toBe(0);
  });
  it('spills rubble 1.2x the footprint half-diagonal', () => {
    expect(rubbleRadiusTiles(3, 3, 3, 3)).toBeCloseTo(1.2 * Math.SQRT1_2, 9);
    expect(rubbleRadiusTiles(0, 0, 2, 1)).toBeCloseTo(1.2 * 0.5 * Math.hypot(3, 2), 9);
  });
  it('makes a tread stamp one spacing plus one feather long (R-15)', () => {
    expect(2 * TRACK_STAMP_HALF_LENGTH).toBeCloseTo(0.58, 9);
  });
});

describe('DecalPool', () => {
  const material = (): THREE.Material => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  it('refuses an empty pool', () => {
    expect(() => new DecalPool({ capacity: 0, grid: 4, renderOrder: 0, material: material() })).toThrow(/capacity/);
  });
  it('grows to its capacity and never past it, evicting the oldest', () => {
    const p = new DecalPool({ capacity: 3, grid: 4, renderOrder: DECAL_PERSISTENT_RENDER_ORDER, material: material() });
    for (let k = 0; k < 4; k++) p.stamp(stamp({ x: k }), flat, never);
    expect(p.liveCount).toBe(3);
    const pos = p.mesh.geometry.getAttribute('position');
    expect(pos.getX(0)).toBeCloseTo(3 - 0.5, 6); // slot 0 now holds the fourth stamp
    expect(p.mesh.geometry.drawRange.count).toBe(3 * 18 * 3);
  });
  // The AO pre-pass and the shadow pass must never see a decal (spec §8, "AO pre-pass").
  it('stays out of the shadow and AO passes, and draws in its named band', () => {
    const p = new DecalPool({ capacity: 2, grid: 2, renderOrder: DECAL_FADING_RENDER_ORDER, material: material() });
    expect(isAoOccluder(p.mesh)).toBe(false);
    expect(p.mesh.castShadow).toBe(false);
    expect(p.mesh.receiveShadow).toBe(false);
    expect(p.mesh.frustumCulled).toBe(false);
    expect(p.mesh.renderOrder).toBe(DECAL_FADING_RENDER_ORDER);
    expect(p.mesh.geometry.getAttribute('normal')).toBeUndefined();
  });
  it('records kind, seed, date and length on every vertex', () => {
    const p = new DecalPool({ capacity: 1, grid: 2, renderOrder: 0, material: material() });
    p.stamp(stamp({ kind: 'tyre', seed: 0.25, simMs: 1500, halfLength: 0.29 }), flat, never);
    const a = p.mesh.geometry.getAttribute('aDecal');
    for (let v = 0; v < 4; v++) {
      expect(a.getX(v)).toBe(5);
      expect(a.getY(v)).toBeCloseTo(0.25, 6);
      expect(a.getZ(v)).toBeCloseTo(1.5, 6);
      expect(a.getW(v)).toBeCloseTo(0.29, 6);
    }
  });
});
```

  In `render-order.test.ts`, add a check that the two decal bands equal `WORLD_RENDER_ORDER` and `TRAIL_RENDER_ORDER` and sit below `TURRET_RENDER_ORDER`.
- [ ] **Step 2: Implement.** The file's shape follows `scorch-decals.ts`: a pure half with no `THREE.*`, then a GPU half.
  - `writeDecalGrid`:
    - Vertex `(i, j)` at `s = −1 + 2i/(n−1)` and `t = −1 + 2j/(n−1)`.
    - `x = cx + s·hl·cos f − t·hw·sin f`, `z = cz + s·hl·sin f + t·hw·cos f`.
    - `y = (isTerrace(x, z) ? sampleY(cx, cz) : sampleY(x, z)) + MARK_EPSILON`.
  - `writeGridIndices` uses the ground's own fan (`a, c, b, a, d, c`), the one `pushSmoothTile` uses.
  - `DecalPool` preallocates everything, static index included, and `setDrawRange(0, live · gridTriangles · 3)`.
- [ ] **Step 3: Gates, falsify, commit.**
  - **Falsify:** drop `isTerrace` from `writeDecalGrid`. The terrace test goes red. Revert.
  - Message: `feat(render): a conforming, sim-timed decal pool (core)`.

---

### Task 11: The kind shader

**Tier:** opus (a shader).

**Files:**
- Modify: `packages/render/src/three/decal-pool.ts`, `packages/render/src/three/decal-pool.test.ts`

**Interfaces:**

```ts
export interface DecalPalette {
  readonly craterBowl: string; readonly craterLip: string; readonly scorch: string; readonly oil: string;
  readonly rubbleA: string; readonly rubbleB: string; readonly tread: string; readonly tyre: string;
}
export const CRATER_BOWL_ALPHA = 0.4, CRATER_LIP_ALPHA = 0.25, OIL_ALPHA = 0.55, RUBBLE_ALPHA = 0.6, TRACK_ALPHA = 0.35;
export const TRACK_FADE_SEC = 180;
export const SCORCH_ALPHA = 0.45, SCORCH_EDGE_INNER = 0.55; // A1.2 as shipped, now owned here
export interface DecalSample { readonly alpha: number; readonly colour: number } // colour: index into DecalPalette order
export function decalAlpha(kind: DecalKind, s: number, t: number, seed: number, ageSec: number, halfLength: number): DecalSample;
export function createDecalMaterial(palette: DecalPalette): THREE.ShaderMaterial; // uniforms: uColors[8], uNowSec
```

`decalAlpha` is the shader's mirror, and `createDecalMaterial`'s GLSL is its transcription, with every constant interpolated from the exports above. The formulas are spec §5, in offset units, where `r = |(s, t)|`:

| Kind | Formula |
|---|---|
| crater | `r' = r·(1 + 0.04 sin(3θ + 2πseed))`; bowl `0.40·(1 − smoothstep(0.72, 0.80, r'))`; lip `0.25·smoothstep(0.76, 0.84, r')·(1 − smoothstep(0.92, 1.0, r'))`; the larger of the two wins, colour bowl 0 / lip 1 |
| scorch | `0.45·(1 − smoothstep(0.55, 1.0, r))`, colour 2. This is A1.2's fade to the byte. |
| oil | `r' = r·(1 + 0.10 sin(2θ + 2πseed))`, `0.55·(1 − smoothstep(0.70, 1.0, r'))`, colour 3 |
| rubble | cells of 0.2 r: `h = tileHash(⌊5s⌋ + 64, ⌊5t⌋ + 64 + ⌊1000·seed⌋)`; chip = `h ≥ 0.55`; `0.6·chip·(1 − smoothstep(0.75, 1.0, r))`; colour 4 when `fract(7h) < 0.5`, else 5 |
| tread, tyre | `u = s·halfLength`; feather `clamp((halfLength − |u|)/0.08, 0, 1)`; side `1 − smoothstep(0.7, 1.0, |t|)`; fade `clamp(1 − max(age, 0)/180, 0, 1)`; tread pattern `0.65 + 0.35·step(0.5, fract(u/0.06))`, tyre 1; `0.35·feather·side·fade·pattern`; colour 6 / 7 |

The GLSL `rlHash` is `tileHash` transcribed in `uint` arithmetic. Its inputs are offset to stay non-negative, so the two agree.

- [ ] **Step 1: Write the failing tests** (appended to `decal-pool.test.ts`).

```ts
import { decalAlpha, createDecalMaterial, SCORCH_ALPHA, TRACK_ALPHA, TRACK_FADE_SEC } from './decal-pool';
import { scorchRadiusTiles } from './scorch-decals';
import { hexToLinear } from './terrain/shared';

describe('decalAlpha -- spec §5, kind by kind', () => {
  it('keeps A1.2\'s scorch to the value', () => {
    expect(decalAlpha('scorch', 0, 0, 0, 0, 1).alpha).toBeCloseTo(SCORCH_ALPHA, 9);
    expect(decalAlpha('scorch', 0.55, 0, 0, 0, 1).alpha).toBeCloseTo(SCORCH_ALPHA, 9);
    expect(decalAlpha('scorch', 1, 0, 0, 0, 1).alpha).toBe(0);
    expect(scorchRadiusTiles(1)).toBe(1.6); // unchanged (spec §5, "Scorch")
  });
  it('draws a crater as a dark bowl inside a pale lip', () => {
    expect(decalAlpha('crater', 0, 0, 0, 0, 1)).toEqual({ alpha: 0.4, colour: 0 });
    const lip = decalAlpha('crater', 0.88, 0, 0, 0, 1);
    expect(lip.colour).toBe(1);
    expect(lip.alpha).toBeGreaterThan(0.2);
    expect(decalAlpha('crater', 1.1, 0, 0, 0, 1).alpha).toBe(0);
  });
  it('pools oil at 55% under the wreck', () => {
    expect(decalAlpha('oil', 0, 0, 0.5, 0, 1)).toEqual({ alpha: 0.55, colour: 3 });
    expect(decalAlpha('oil', 1.2, 0, 0.5, 0, 1).alpha).toBe(0);
  });
  it('scatters rubble as chips in both limestone tones, about half the cells', () => {
    let chips = 0;
    let cells = 0;
    const tones = new Set<number>();
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) {
        const s = (i + 0.5) / 5;
        const t = (j + 0.5) / 5;
        if (Math.hypot(s, t) > 0.7) continue;
        cells++;
        const d = decalAlpha('rubble', s, t, 0.37, 0, 1);
        if (d.alpha > 0) {
          chips++;
          tones.add(d.colour);
        }
      }
    expect(chips / cells).toBeGreaterThan(0.25);
    expect(chips / cells).toBeLessThan(0.7);
    expect(tones).toEqual(new Set([4, 5]));
  });
  it('fades tread linearly from 35% to nothing over 180 s of SIM time (D6)', () => {
    expect(decalAlpha('tyre', 0, 0, 0, 0, 0.29).alpha).toBeCloseTo(TRACK_ALPHA, 9);
    expect(decalAlpha('tyre', 0, 0, 0, TRACK_FADE_SEC / 2, 0.29).alpha).toBeCloseTo(TRACK_ALPHA / 2, 9);
    expect(decalAlpha('tyre', 0, 0, 0, TRACK_FADE_SEC, 0.29).alpha).toBe(0);
    expect(decalAlpha('tyre', 0, 0, 0, -0.05, 0.29).alpha).toBeCloseTo(TRACK_ALPHA, 9);
  });
  it('gives tread a pattern and tyre none', () => {
    const along = (k: 'tread' | 'tyre'): number[] => Array.from({ length: 20 }, (_, i) => decalAlpha(k, -0.5 + i / 20, 0, 0, 0, 0.29).alpha);
    expect(Math.min(...along('tread'))).toBeLessThan(Math.max(...along('tread')));
    expect(new Set(along('tyre').map((a) => a.toFixed(6))).size).toBe(1);
  });
  // G7, R-15: two abutting stamps never double their alpha, and the seam dips at most A^2/4.
  it('joins consecutive stamps without a seam or a double', () => {
    const hl = 0.29;
    const spacing = 0.5;
    for (let u = 0.15; u <= 0.35; u += 0.005) {
      const a = decalAlpha('tyre', u / hl, 0, 0, 0, hl).alpha;
      const b = decalAlpha('tyre', (u - spacing) / hl, 0, 0, 0, hl).alpha;
      const over = 1 - (1 - a) * (1 - b);
      expect(over, `u=${u.toFixed(3)}`).toBeLessThanOrEqual(TRACK_ALPHA + 1e-9);
      expect(over, `u=${u.toFixed(3)}`).toBeGreaterThanOrEqual(TRACK_ALPHA - (TRACK_ALPHA * TRACK_ALPHA) / 4 - 1e-9);
    }
  });
});

describe('createDecalMaterial', () => {
  const palette = { craterBowl: '#23241F', craterLip: '#E6D8BE', scorch: '#23241F', oil: '#14150F', rubbleA: '#A28C6E', rubbleB: '#75624A', tread: '#806032', tyre: '#8C7659' };
  const m = createDecalMaterial(palette);
  it('is a translucent, depth-tested, non-writing decal', () => {
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
  });
  it('takes linear colours in the palette order the kinds index', () => {
    const c = m.uniforms.uColors.value as THREE.Vector3[];
    expect(c).toHaveLength(8);
    expect(c[0].toArray()).toEqual(hexToLinear('#23241F'));
    expect(c[7].toArray()).toEqual(hexToLinear('#8C7659'));
  });
  it('carries the tested constants', () => {
    for (const k of [SCORCH_ALPHA, TRACK_ALPHA, TRACK_FADE_SEC]) expect(m.fragmentShader).toContain(k.toFixed(3));
    expect(m.uniforms.uNowSec.value).toBe(0);
  });
});
```

- [ ] **Step 2: Implement** `decalAlpha`, `createDecalMaterial` (vertex: `aOffset` → `vOffset`, `aDecal` → `vDecal`; fragment: branch on `int(vDecal.x + 0.5)`, discard at alpha 0) and `DecalPalette`.
- [ ] **Step 3: Gates, falsify, commit.**
  - **Falsify:** make the tread feather `0.04` while the stamp stays 0.58 long. The seam test goes red on the double. Revert.
  - Message: `feat(render): procedural decal kinds -- crater, scorch, oil, rubble, tread, tyre`.

---

### Task 12: Scorch and tracks fold into the pools; crater, oil and rubble seed

**Tier:** opus (`ThreeRenderer.ts`). D5, R-11, R-12.

**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/ThreeRenderer.blast.test.ts`

**Interfaces** (private, reached by the test the way `BlastPrivate` does):
- `decalsPersistent: DecalPool`, `decalsFading: DecalPool`, `decalMaterial: THREE.ShaderMaterial`.
- `stampGroundDecal(s: DecalStamp): boolean` **is the one entry.** It:
  - returns `false` when the centre tile is a terrace (R-19);
  - routes `tread`/`tyre` to `decalsFading` and everything else to `decalsPersistent`;
  - samples through `groundWorldY(this.retained.elevation, w, h, x, z)`, with `isTerrace` read from the retained surface.

- [ ] **Step 1: Write the failing tests.**
  - In `ThreeRenderer.blast.test.ts`:
    - `BlastPrivate.scorchDecals` becomes `decalsPersistent: { liveCount: number }` and `decalsFading: { liveCount: number }`, plus `stampGroundDecal(s: DecalStamp): boolean` and `decalMaterial: THREE.ShaderMaterial`.
    - Existing expectations change: a vehicle kill now stamps **2** (scorch and oil); "never stamps more than the pool holds" reads `PERSISTENT_CAPACITY`; a mortar landing stamps **2** (crater and scorch).
  - Then add:

```ts
describe('the ground remembers (spec §3.3)', () => {
  it('puts scorch and oil under a killed vehicle, through the one entry', () => {
    const { r, priv } = harness();
    const spy = vi.spyOn(priv, 'stampGroundDecal');
    killVehicle(r, 'mbt_lavi', 10, 10);
    expect(spy.mock.calls.map(([s]) => s.kind).sort()).toEqual(['oil', 'scorch']);
    expect(spy.mock.calls.find(([s]) => s.kind === 'oil')?.[0].halfLength).toBe(OIL_RADIUS_TILES);
  });
  it('leaves a crater where a mortar bomb lands, sized by its power', () => {
    const { r, priv } = harness();
    const spy = vi.spyOn(priv, 'stampGroundDecal');
    landShell(r, 'mortar', 12, 12);
    const crater = spy.mock.calls.find(([s]) => s.kind === 'crater')?.[0];
    expect(crater?.halfLength).toBeCloseTo(0.45, 9);
  });
  it('spills rubble over a collapsed structure\'s footprint (R-12)', () => {
    const { r, priv } = harness();
    const spy = vi.spyOn(priv, 'stampGroundDecal');
    destroyStructure(r, { minX: 4, minY: 4, maxX: 5, maxY: 4 });
    const rubble = spy.mock.calls.find(([s]) => s.kind === 'rubble')?.[0];
    expect(rubble?.halfLength).toBeCloseTo(rubbleRadiusTiles(4, 4, 5, 4), 9);
  });
  it('lays tread behind a tracked vehicle and tyre behind a wheeled one, into the fading pool', () => {
    const { r, priv } = harness();
    driveOneTile(r, 'mbt_lavi');
    driveOneTile(r, 'jeep_shoded');
    expect(priv.decalsFading.liveCount).toBeGreaterThan(0);
    expect(priv.decalsPersistent.liveCount).toBe(0);
  });
  it('stamps nothing on a terrace (R-19)', () => {
    const { priv } = harness({ terraceAt: [7, 7] });
    expect(priv.stampGroundDecal({ kind: 'crater', x: 7.5, z: 7.5, halfLength: 0.5, halfWidth: 0.5, facingRad: 0, seed: 0, simMs: 0 })).toBe(false);
    expect(priv.decalsPersistent.liveCount).toBe(0);
  });
  // Sim time, not frame time: the gate's repaint and a long frame alike leave fades where they are.
  it('ages tracks on the sim clock only', () => {
    const { r, priv, sim } = harness();
    r.frame(1, 0);
    const t0 = priv.decalMaterial.uniforms.uNowSec.value;
    r.frame(1, 5000);
    expect(priv.decalMaterial.uniforms.uNowSec.value).toBe(t0);
    sim.tick();
    r.snapshot();
    r.frame(1, 0);
    expect(priv.decalMaterial.uniforms.uNowSec.value).toBeCloseTo(t0 + 0.05, 9);
  });
  it('keeps both pools out of the shadow and AO passes', () => {
    const { priv } = harness();
    for (const p of [priv.decalsPersistent, priv.decalsFading]) {
      const mesh = (p as unknown as { mesh: THREE.Mesh }).mesh;
      expect(isAoOccluder(mesh)).toBe(false);
      expect(mesh.castShadow).toBe(false);
    }
  });
});
```

  - New imports:
    - from `./decal-pool`: `OIL_RADIUS_TILES`, `PERSISTENT_CAPACITY`, `rubbleRadiusTiles` and `type DecalStamp`;
    - `isAoOccluder` from `./post-chain`.
  - `harness`, `killVehicle`, `landShell`, `destroyStructure` and `driveOneTile` extend the file's existing fixture: its fake `WebGLRenderer`, `makeOpts`, a small `Sim` and hand-built `SimEvent`s.
  - `landShell` pushes a `ShellModel` whose flight ends within one frame, then calls `frame(1, flightMs)`.
  - `destroyStructure` adds a structure through `sim.addStructure` and feeds `{ kind: 'structureDestroyed', … }` to `onEvents`.
  - `driveOneTile` spawns the type, snapshots, moves `posX` one tile by the sim's own command path over ten ticks, and snapshots each tick.
- [ ] **Step 2: Implement.**
  - **Construct** one `decalMaterial` from a `DecalPalette` resolved by `overlayColor`:

    | Palette slot | Key |
    |---|---|
    | craterBowl | `shadow.0` |
    | craterLip | `limestone.1` |
    | scorch | `shadow.0` |
    | oil | `shadow.1` |
    | rubbleA | `limestone.5` |
    | rubbleB | `limestone.7` |
    | tread | `opts.terrainTones.rut` |
    | tyre | `limestone.6` |

    Then build the two pools on it, one per band. Add both meshes where `scorchDecals.mesh` was added (`:2211`).
  - **Replace every use:**
    - The vehicle-kill `scorchDecals.stamp` (`:3686`) becomes two `stampGroundDecal` calls: scorch at `scorchRadiusTiles(killPower)`, oil at `OIL_RADIUS_TILES`.
    - `spawnShellImpactFx` (`:7003`) becomes crater at `craterRadiusTiles(power)`, then scorch.
    - The `structureDestroyed` branch (`:3766`) adds rubble at `(bx, by)` with `rubbleRadiusTiles(min…, max…)`.
    - `snapshot()`'s `vehicleTrackMesh.stamp` (`:3433`) becomes one `stampGroundDecal` per `trackStampCenters` centre: `kind: kind === 'tracked' ? 'tread' : 'tyre'`, `halfLength: TRACK_STAMP_HALF_LENGTH`, `halfWidth: TRACK_FOOTPRINT[kind].halfWidthTiles`, `facingRad: facingNorm·2π`, `simMs: stampSimMs(this.sim.tickCount)`.
    - Every persistent stamp is dated `stampSimMs(this.sim.tickCount)`.
    - Seeds are `tileHash(⌊8x⌋, ⌊8z⌋ + 977·kindIndex)`, which is presentation only.
  - **`frame()`:** `decalMaterial.uniforms.uNowSec.value = presentationSimMs(this.sim.tickCount, alpha) / 1000`. Delete `trackClockMs`, its field and `vehicleTrackMesh.update` (`:2848-2851`).
  - **The `scorch` debug case** (`:3006`) now hides `decalsPersistent.mesh`. That is interim; Task 13 renames it.
  - **`dispose()`** disposes both pools and the material once.
  - Remove the `ScorchDecalMesh`, `SCORCH_CAPACITY`, `VehicleTrackMesh` and `TRACK_POOL_CAPACITY` imports.
- [ ] **Step 3: Look, then A/B.**
  - Run the spec's aftermath protocol (`&sur`, eight attack-moves 250 ticks apart, then 600 ticks) through `ground:capture`'s audit views, or by hand on port 5196.
  - Photograph `beit_sahwan_outskirts-settled-z1` and `-z2.5` and `qarn_hadid-settled-z2.5`. Look for craters, oil under wrecks, rubble at collapses, and tread without planks (G6, G7).
  - Golden A/B: **expected** 0 px on all four gated scenarios, because no gated scene has combat or driving. `combat` moves (report-only).
- [ ] **Step 4: Gates, falsify, commit.**
  - **Falsify:** route `tread` to the persistent pool. The tread test goes red, and so does the fading `liveCount`. Revert.
  - Message: `feat(render): one decal pool remembers the battle -- craters, oil, rubble; scorch and tracks fold in (D5)`.

---

### Task 13: `decals` replaces `scorch`

**Tier:** opus (`ThreeRenderer.ts`). D5, R-17.

**Files:**
- Modify: `packages/render/src/three/debug-layers.ts`, `debug-layers.test.ts`, `packages/render/src/three/ThreeRenderer.ts`, `tools/src/perf/blast-captures.ts`, `blast-captures.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// debug-layers.test.ts -- replacing the 'scorch' tests at :344-366
it('names the decal pool as one layer, and no longer knows "scorch"', () => {
  expect(DEBUG_LAYERS).toContain('decals');
  expect(isDebugLayer('scorch')).toBe(false);
  expect(() => makeRenderer().setDebugLayerVisible('scorch', false)).toThrow(/unknown layer "scorch"/);
});
it('hides both pools with one name', () => {
  const r = makeRenderer();
  expect(r.setDebugLayerVisible('decals', false)).toBe(2);
  expect(r.setDebugLayerVisible('decals', true)).toBe(2);
});
```

  In `blast-captures.test.ts`, change every `'scorch'` to `'decals'` and `LAYER_FLOORS.scorch` to `LAYER_FLOORS.decals`.
- [ ] **Step 2: Implement.**
  - `DEBUG_LAYERS`: `'scorch'` becomes `'decals'`. The doc paragraph is rewritten: two meshes, and no per-frame writer of `.visible` (checked by grep).
  - The `ThreeRenderer` case becomes `setObjectsVisible(visible, decalsPersistent.mesh, decalsFading.mesh)`.
  - In `blast-captures.ts`, rename the key and every layer string. The floor numbers are kept.
- [ ] **Step 3: Re-record the blast readings.** Run `pnpm blast:capture -- --port=5199` three times and append the three `decals` readings per subject to the `LAYER_FLOORS.decals` rationale. They should read at or above the scorch-only figures, because the layer now includes oil. If any is below its floor, stop and report.
- [ ] **Step 4: Gates, falsify, commit.**
  - **Falsify:** return `setObjectsVisible(visible, decalsPersistent.mesh)` only. The "both pools" test goes red on the count. Revert.
  - Message: `refactor(render): the decals layer replaces scorch (D5)`.

---

### Task 14: The retired decal classes

**Tier:** haiku. Mechanical.

**Files:**
- Modify: `packages/render/src/three/scorch-decals.ts`, `scorch-decals.test.ts`, `packages/render/src/three/vehicle-tracks.ts`, `vehicle-tracks.test.ts`

- [ ] **Step 1:** In `scorch-decals.ts`, delete `ScorchDecalMesh`, `createScorchMaterial`, `writeScorchVertices`, `writeScorchOffsets`, `SCORCH_CAPACITY`, `SCORCH_OPACITY` and `DEFAULT_COLOR`. Keep `scorchRadiusTiles` and `SCORCH_RADIUS_TILES_AT_FULL_POWER`. The header becomes a paragraph: the pool is `decal-pool.ts`, and its fade constants live there (`SCORCH_ALPHA`, `SCORCH_EDGE_INNER`).
- [ ] **Step 2:** In `vehicle-tracks.ts`, delete `VehicleTrackMesh`, `createTrackMaterial`, `writeTrackMarkVertices`, `collapseTrackMarkVertices`, `sweepExpiredTrackSlots`, `TRACK_POOL_CAPACITY`, `TRACK_PERSIST_MS` and `TRACK_OPACITY`. Keep the table, the footprint, the spacing, `stepTrackAccum`, `trackStampCenters` and `trackMarkCorners`. Correct the header's clock paragraph: it is sim time now (`decal-pool.ts`, R-14).
- [ ] **Step 3:** Delete exactly the tests of the deleted symbols, and nothing else. `pnpm test` must stay green with no new skips. `rg -n "ScorchDecalMesh|VehicleTrackMesh|trackClockMs|TRACK_PERSIST_MS" packages tools` must return nothing.
- [ ] **Step 4: Gates and commit.** Message: `refactor(render): scorch-decals and vehicle-tracks keep only their maths`.

---

### Task 15: The showcase

**Tier:** opus (`ThreeRenderer.ts`). D4, R-16.

**Files:**
- Create: `packages/render/src/three/decal-showcase.ts`, `packages/render/src/three/decal-showcase.test.ts`
- Modify: `packages/render/src/api.ts` (`decalShowcase?: { readonly x: number; readonly y: number }`, documented as three-only and sandbox-only), `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/ThreeRenderer.blast.test.ts`

**Interfaces:**

```ts
export type ShowcaseSiteKind = 'flat' | 'relief' | 'road';
export interface ShowcaseSite { readonly kind: ShowcaseSiteKind; readonly x: number; readonly y: number } // a tile
export const SHOWCASE_RING: readonly [number, number]; // [4, 9] tiles from the anchor
export const SHOWCASE_POWERS: readonly [number, number, number]; // [0.3, 0.45, 1]
export function showcaseSites(input: TerrainInput, surface: TerrainSurface, anchor: { x: number; y: number }): readonly ShowcaseSite[];
export function decalShowcase(sites: readonly ShowcaseSite[]): readonly DecalStamp[];
```

**Site selection.** Every site lies in the ring, at a distance from the anchor's tile centre between 4 and 9, and each is at least 4 tiles from the sites already chosen. Ties are broken by `(distance, y, x)`.
- **road:** an unblocked `r` tile.
- **relief:** an `open` tile whose `surfaceNormal` y is < 0.98, the steepest first. There is none on a flat surface.
- **flat:** an `open` tile with normal y ≥ 0.999 and all eight neighbours `open`.

**Stamps per site.**
- A 3 × 4 lattice at a 1-tile pitch, centred on the site: columns are `SHOWCASE_POWERS`; rows are crater, scorch, oil and rubble. Rubble takes the 1×1, 2×2 and 3×3 footprints by column.
- A tread run and a tyre run of 6 stamps each at spacing 0.5, through the site: tread east-west, tyre north-south.
- Every stamp has `simMs: 0` (R-14) and seed `tileHash(site.x·31 + k, site.y·17 + k)`.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/decal-showcase.test.ts
import { describe, expect, it } from 'vitest';
import { buildTerrainSurface } from './terrain/surface';
import { DECOR_ROAD } from './terrain/shared';
import type { TerrainInput } from './terrain/types';
import { decalShowcase, SHOWCASE_POWERS, showcaseSites } from './decal-showcase';

function world(): TerrainInput {
  const w = 30;
  const h = 30;
  const decor = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) decor[8 * w + x] = DECOR_ROAD; // a road along y = 8
  const elevation = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 20; x < w; x++) elevation[y * w + x] = Math.min(4, x - 19); // a slope in the east
  return { width: w, height: h, decor, elevation, blocked: new Uint8Array(w * h), cover: new Uint8Array(w * h) };
}
const anchor = { x: 15, y: 15 };

describe('showcaseSites', () => {
  const input = world();
  const sites = showcaseSites(input, buildTerrainSurface(input), anchor);
  it('finds a flat, a relief and a road site', () => {
    expect(sites.map((s) => s.kind).sort()).toEqual(['flat', 'relief', 'road']);
  });
  it('keeps every site in the ring and the sites apart', () => {
    for (const s of sites) {
      const d = Math.hypot(s.x + 0.5 - (anchor.x + 0.5), s.y + 0.5 - (anchor.y + 0.5));
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThanOrEqual(9);
    }
    for (const a of sites) for (const b of sites) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(4);
  });
  it('puts the road site on the road', () => {
    expect(sites.find((s) => s.kind === 'road')?.y).toBe(8);
  });
  it('omits the relief site on a flat map', () => {
    const flat = { ...world(), elevation: null };
    expect(showcaseSites(flat, buildTerrainSurface(flat), anchor).map((s) => s.kind)).not.toContain('relief');
  });
  it('is deterministic', () => {
    expect(showcaseSites(input, buildTerrainSurface(input), anchor)).toEqual(sites);
  });
});

describe('decalShowcase', () => {
  const stamps = decalShowcase([{ kind: 'flat', x: 5, y: 5 }, { kind: 'road', x: 12, y: 8 }, { kind: 'relief', x: 22, y: 12 }]);
  it('stamps every kind at every site, three sizes each', () => {
    expect(stamps).toHaveLength(3 * (12 + 12));
    for (const kind of ['crater', 'scorch', 'oil', 'rubble'] as const) expect(stamps.filter((s) => s.kind === kind)).toHaveLength(9);
    expect(stamps.filter((s) => s.kind === 'tread')).toHaveLength(18);
    expect(stamps.filter((s) => s.kind === 'tyre')).toHaveLength(18);
    expect(SHOWCASE_POWERS).toEqual([0.3, 0.45, 1]);
  });
  it('dates every stamp at 0 ms, so a capture at a pinned tick repeats (R-14)', () => {
    expect(new Set(stamps.map((s) => s.simMs))).toEqual(new Set([0]));
  });
});
```

  In `ThreeRenderer.blast.test.ts`:

```ts
it('stamps the showcase on the first frame, through the entry the event path calls (D4)', () => {
  const { r, priv } = harness({ decalShowcase: { x: 15, y: 15 } });
  const spy = vi.spyOn(priv, 'stampGroundDecal');
  r.frame(1, 16);
  // At least one site (12 persistent + 12 tread/tyre), every kind present.
  const first = spy.mock.calls.length;
  expect(first).toBeGreaterThanOrEqual(24);
  expect(new Set(spy.mock.calls.map(([s]) => s.kind))).toEqual(new Set(['crater', 'scorch', 'oil', 'rubble', 'tread', 'tyre']));
  expect(new Set(spy.mock.calls.map(([s]) => s.simMs))).toEqual(new Set([0]));
  // Once only.
  r.frame(1, 16);
  r.frame(1, 16);
  expect(spy.mock.calls.length).toBe(first);
});
it('stamps nothing without the option', () => {
  const { r, priv } = harness();
  r.frame(1, 16);
  expect(priv.decalsPersistent.liveCount + priv.decalsFading.liveCount).toBe(0);
});
```

- [ ] **Step 2: Implement.** `ThreeRenderer` keeps `showcasePending = opts.decalShowcase !== undefined`. At the first `frame()` after the terrain has been built, it runs `for (const s of decalShowcase(showcaseSites(input, this.retained.elevation, anchor))) this.stampGroundDecal(s)` once and clears the flag. `input` is the same one `composeTerrain` uses.
- [ ] **Step 3: Gates, falsify, commit.**
  - **Falsify:** stamp the showcase straight into `decalsPersistent.stamp`, bypassing the entry. The spy test goes red. Revert.
  - Message: `feat(render): a fixed decal showcase through the event path's own entry (D4)`.

---

### Task 16: The `&decals` sandbox flag

**Tier:** sonnet.

**Files:**
- Modify: `packages/app/src/sandbox-help.ts`, `sandbox-help.test.ts`, `packages/app/src/shell/links.test.ts` (its `Record<SandboxFlagName, boolean>` literal gains `decals: false`), `packages/app/src/main.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// sandbox-help.test.ts
it('reads &decals, off by default', () => {
  expect(readFlags(new URLSearchParams('?sandbox=qarn_hadid&decals')).decals).toBe(true);
  expect(readFlags(new URLSearchParams('?sandbox=qarn_hadid')).decals).toBe(false);
});
it('builds and accepts the aftermath scenario\'s URL', () => {
  expect(sandboxUrl('qarn_hadid', { decals: true })).toBe('?sandbox=qarn_hadid&decals');
  expect(unknownParams(new URLSearchParams('?sandbox=qarn_hadid&decals&renderer=three'))).toEqual([]);
});
```

- [ ] **Step 2: Implement.**
  - `SandboxFlagName` gains `'decals'`.
  - `SANDBOX_FLAGS` gains `{ name: 'decals', blurb: 'a fixed showcase of every ground mark -- craters, scorch, oil, rubble, tread and tyre -- near the friendly anchor' }`. The blurb is visible on the Free play screen, so no `&` in it (`sandbox-help.ts:42`).
  - In `main.ts`, after `rendererOptionsFor` (`:1595`):

```ts
const wantDecals = flags.decals;
// ...
const opts: RendererOptions = {
  ...rendererOptionsFor(map, { colorVision: cvdVariant, quality: req.settings.get().video.quality }, BASE),
  // Sandbox only: a mission brings its own battle, and a dev flag must never change how one looks.
  ...(!mission && wantDecals ? { decalShowcase: { x: anchors.friendly[0], y: anchors.friendly[1] } } : {}),
};
```

- [ ] **Step 3: Gates, falsify, commit.**
  - **Falsify:** drop the `!mission &&` guard. Nothing unit-tests `main.ts`, so this is checked by driving the UI: `?mission=beit_sahwan_1_recon&decals` on port 5196 must show no showcase (memory: verify UI features by driving the UI). Revert.
  - Message: `feat(app): &decals stamps the ground-mark showcase in the sandbox`.

---

### Task 17: The `aftermath` scenario and its four checks

**Tier:** sonnet.

**Files:**
- Modify: `tools/src/golden-diff/capture-protocol.ts`, `tools/src/golden-diff/baseline.ts`
- Create: `tools/src/golden-diff/aftermath.test.ts`

**Interfaces:**
- `Scenario.sandboxFlags?: readonly string[]`. `sceneParam` appends `&<flag>` for each, in order.
- `export const AFTERMATH_SCENARIO: Scenario` is added to `SCENARIOS` after `RELIEF_SCENARIO`.

- [ ] **Step 1: Find the frame.**
  - On port 5196, boot `?sandbox=qarn_hadid&decals`.
  - Read the three showcase sites. The pure function answers this, so compute it in the test below first.
  - Frame their centroid at zoom 1. Confirm by photograph that all three sites and both the diagonal road and the hollow rim are in frame.
  - Confirm the id of the sandbox `recon_drone` with `__lions.units()` (it is 11 on `tel_marum`; re-check here).
  - Choose `targetTick: 300` and `orders.atTick: 20`: a move of the drone to the centroid, so fog lifts over the showcase. That is the same reason `RELIEF_SCENARIO` gives.
- [ ] **Step 2: Write the failing test.**

```ts
// tools/src/golden-diff/aftermath.test.ts
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap } from '@lions/data';
import { buildTerrainSurface } from '../../../packages/render/src/three/terrain/surface';
import { showcaseSites } from '../../../packages/render/src/three/decal-showcase';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { AFTERMATH_SCENARIO, SCENARIOS, threeUrl } from './capture-protocol';
import { BASELINES, isGated } from './baseline';

describe('the aftermath scenario frames the showcase it exists for', () => {
  const pm = parseMap(maps.qarn_hadid);
  const sim = new Sim({ seed: 1, width: pm.width, height: pm.height, capacity: 64 });
  applyTerrain(pm, sim);
  const input = { width: pm.width, height: pm.height, decor: pm.decor, elevation: pm.elevation, blocked: sim.blocked, cover: sim.cover };
  const [ax, ay] = sandboxAnchors(maps.qarn_hadid).friendly;
  const sites = showcaseSites(input, buildTerrainSurface(input), { x: ax, y: ay });

  it('finds all three sites on qarn_hadid', () => {
    expect(sites.map((s) => s.kind).sort()).toEqual(['flat', 'relief', 'road']);
  });
  it('points its camera at their centroid', () => {
    const cx = sites.reduce((a, s) => a + s.x + 0.5, 0) / sites.length;
    const cy = sites.reduce((a, s) => a + s.y + 0.5, 0) / sites.length;
    expect(AFTERMATH_SCENARIO.cameraTile).toEqual([Math.round(cx * 2) / 2, Math.round(cy * 2) / 2]);
  });
  it('boots qarn_hadid with &decals and nothing the app would warn about', () => {
    const url = new URL(threeUrl(5195, AFTERMATH_SCENARIO));
    expect(url.searchParams.get('sandbox')).toBe('qarn_hadid');
    expect(url.searchParams.has('decals')).toBe(true);
    expect(unknownParams(url.searchParams)).toEqual([]);
  });
  it('is gated and carries decals, roads, macro and scatter (D4)', () => {
    expect(SCENARIOS).toContain(AFTERMATH_SCENARIO);
    const spec = BASELINES.aftermath;
    expect(isGated(spec)).toBe(true);
    expect((spec.layerChecks ?? []).map((c) => c.layer).sort()).toEqual(['decals', 'macro', 'roads', 'scatter']);
  });
});
```

- [ ] **Step 3: Implement.** Add `AFTERMATH_SCENARIO` with a comment in `RELIEF_SCENARIO`'s style: why this map, why `&decals`, why the drone, why tick 300. Add `BASELINES.aftermath` with `region: null`.
- [ ] **Step 4: Measure.** Run `pnpm golden-baseline -- --port=5195 --scenario=aftermath --out-dir=.superpowers/ground/t17-r<k>`, for k = 1 to 5.
  - **Noise:** diff the five captures pairwise with `ab.ts`-style `computeDiff`. If it reads 0 px / 0.0000 as on `relief`, take `relief`'s ceilings (40 / 0.004) and state that. If it does not, find the wall-clock content, since the frame loop is frozen and every fade is on sim time. **A bimodal reading is a bug to find, not a band.**
  - **Floors:** a third of the smallest of the first three runs, for `decals`, `roads`, `macro` and `scatter`, with all readings in the rationales.
  - Record the gate's added wall-clock time. The spec estimates about 7 s and 75 KiB a baseline set.
- [ ] **Step 5: Falsify, each seen red, then revert.**
  - (a) Comment out the showcase call in `ThreeRenderer`. `decals` fails at 0 px.
  - (b) Bake B.g = 255. `roads` fails.
  - (c) `uMacroAmp` initialised to 0. `macro` fails.
  - (d) `buildScatter` returns empty. `scatter` fails.

  With no darwin baseline for `aftermath`, each red is the layer check's, which is exactly what must be able to fail on a runner with no baseline.
- [ ] **Step 6: Commit.** Message: `feat(tools): the aftermath scenario -- the gate sees the ground remember a battle`.

---

### Task 18: Costs, the zoom-0.35 captures, the record and bless 1

**Tier:** sonnet for measurement, haiku for the prose; opus reviews the whole branch before the push.

**Files:**
- Modify: `docs/PERFORMANCE.md` (a new section, "The ground, plan 1 (WP-A2)"), `CLAUDE.md` (under "The three.js backend"), `docs/superpowers/specs/2026-09-25-ground-design.md` (status line; Deviations R-1 to R-21)

- [ ] **Step 1: Costs, after.** Run the same commands as Task 0 Step 5 on this branch's HEAD, same ports, same machine, same day if possible.
  - `pnpm ground:capture -- --port=5196 --out=.superpowers/ground/cost-t18`, then again with `--decals` for the aftermath view.
  - `render-frame-cost` on both rosters.
  - `backend-curve-gate --port=5198`.

  Build the table: calls and tris per view, before → after; p95 before → after; 300-figure p95.

  | Check | Budget | Expected |
  |---|---|---|
  | Calls | ≤ +4 planned, cap +6 | terrain +0, decals net +0 (R-11) |
  | Acceptance p95 | ≤ +1.5 ms, every view ≤ 14.5 ms | |
  | `perf:units` at 300 | ≤ 7.5 ms p95 | |
  | Decal tris | ≤ 26,624 at full pools (R-10) | |
  | Control and macro memory | | about 1.6 MiB a map (R-21), read from `renderer.info.memory` |

  Prove the AO and shadow exclusion on the real renderer: hiding `decals` on the aftermath view moves `calls` by exactly the number of pools drawn, which is 2 (main pass only). **A miss on any budget is reported to the lead before bless, with the layer that caused it.** It is not traded silently.
- [ ] **Step 2: Captures for the lead.**
  - `ground:capture` gives each map at zoom 0.35. The two legibility levers, D1 and D2, are judged there (spec §8).
  - Put the before/after pairs at 0.35, 1 and 2.5 for `beit_sahwan_outskirts`, `qarn_hadid` (roads, relief, the diagonal) and `wadi_halam_basin` (the green macro, R-9) in `.superpowers/ground/review/`, and hand them over.
  - **Bless waits for the lead's word on these.**
- [ ] **Step 3: The record.**
  - **CLAUDE.md**, "The three.js backend", only what a later agent would get wrong:
    - The ground reads a control map, not masks. `wallAlbedo` is the one vertex surface fact. Terraces are hard, and ridges have an apron.
    - Road tone lives in the shader, so a road tile's vertex colour is the open wash (R-3).
    - Road grain shares `uKnoll` (R-7).
    - The decal pool: two instances, sim time, `stampGroundDecal` as the one entry, `&decals` as the showcase.
    - The gate: now six scenarios, with `macro`, `roads` and `decals` checks, and `scorch` gone.

    Numbers go with their conditions. Edit it as a section, never wholesale.
  - **PERFORMANCE.md:** Step 1's table with its conditions.
  - **The spec:** the status line becomes `plan 1 landed <sha>`, and Deviations list R-1 to R-21 with what was measured.
- [ ] **Step 4: Final gates.** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:ui && pnpm validate:assets && pnpm playtest`. `git diff --stat e3b80317..HEAD -- packages/sim` is empty.
- [ ] **Step 5: Push, read CI, then bless once.**
  1. Push `feat/ground` and open the PR. The body lists the scenarios expected to move and why:

     | Scenario | Moves by |
     |---|---|
     | `quiet` | splat edges, macro, road SDF and tone, dashes retired |
     | `open-ground` | splat and macro; roads only if in crop |
     | `vehicle` | macro, road; tracks only if something drove |
     | `relief` | the skirt fix (G5), the ridge apron, macro |
     | `aftermath` | new; "no baseline entry" until blessed |
     | `combat` | report-only |

     The body also names the AI-art disclosure: none, since every mark here is procedural.
  2. Read the PR's `visual` job with `gh run view <id> --log`. Grep the `[golden-diff]` block, and download the `visual-baseline-output` artifact. For each moving scenario, confirm that the diff pixels sit on the ground: not the HUD strip, not units. Confirm that every layer check (old and new) passes on `linux-x64-swiftshader`. Write the numbers into the PR.
  3. **The lead merges.** Then, once, from main: `gh workflow run visual-baseline-bless.yml --ref main -f reason="WP-A2 plan 1 (<sha>): splat control map, macro field, road SDF (#226), skirt ring (G5), decal pool; new gated scenario aftermath. Moves quiet, open-ground, vehicle, relief; creates aftermath. Layer checks macro/roads/decals added, scorch retired."`
  4. When it lands, push an empty commit so CI runs on the Actions-authored baseline. Then run `gh run list` until `visual` is green. One bless in flight at a time: S3g plan 2 does not bless until this one is green.

---

## Self-review

**Spec coverage.**

| Spec item | Task |
|---|---|
| §3.1 control map, 8 texels a tile, A and B | 4, 5 |
| §3.1 edges: 0.5-tile band, noise ±0.2 at 1.5 cycles/tile, height blend 0.15; D1 split | 4 (maths and tests), 5 (GLSL) |
| §3.1 macro field: 256², fbm 3 octaves, period 12, ±7%, hue ±0.04, blur 1.5 | 4, 5; check 9 |
| §3.1 ridges (G10), scree apron | 4, 5 |
| §3.1 skirt ring (G5); `skirt` re-measured on relief | 2 (R-20) |
| §3.1 cost: +0 calls, 7 → 10 taps, 1.2 MiB | 5; measured in 18 (R-21) |
| §3.1 gate: `ground-albedo` unchanged; `macro` on open-ground and relief | 5, 9 |
| §3.2 road graph, four-neighbour plus diagonal rule (G2) | 3, 4 (G2 on real data) |
| §3.2 SDF baked into control B | 4 (R-6) |
| §3.2 surface, worn bent edge, shoulder, ruts, junction fade | 3 (profile), 6 (GLSL) |
| §3.2 grain reuses `knoll_scree_tile`; `road_track_tile` and dashes retire | 6, 7, 8 (R-7) |
| §3.2 road tone D2 | 9 (R-8) |
| §3.2 `roads` check on `quiet` and `aftermath` | 9, 17 |
| §3.3 one pool class, two instances, 1024 / 4096, oldest evicted | 10 (R-10) |
| §3.3 conforming grid on the surface; terraces skipped | 10 (R-18, R-19) |
| §3.3 procedural SDF kinds, no texture; feathered track stamps (G7) | 11 (R-15) |
| §3.3 scorch and tracks fold in (D5) | 12, 13, 14 |
| §3.3 crater at `shellHasLanded`, oil under a kill, rubble at collapse | 12 (R-12, R-13) |
| §3.3 sim-time clock | 10, 12 (R-14) |
| §3.3 cost: +1 call main pass only, ≤ 27k tris; AO and shadow exclusion proven | 10 (unit), 18 (`renderer.info`) (R-11) |
| §3.3 gate: `decals` replaces `scorch`; `&decals` through the event entry; gated `aftermath` with decals, roads, macro and scatter (D4) | 13, 15, 16, 17 |
| §4 plan-1 column: which scenarios move | 18 Step 5 |
| §5 numbers | constants in 3, 4, 10 and 11, each pinned by a test |
| §8 legibility at 0.35 before bless 1 | 18 Step 2 |
| §8 perf acceptance | 0, 18 |
| G1–G7, G10 | 6, 6, 5, 5, 2, 12, 11–12, 5. G8, G9 and G11 are plan 2. |

**Every check has an input that makes it fail**, named in its task:

| Task | Mutations |
|---|---|
| 1 | a dropped view |
| 2 | the old quad |
| 3 | linear fade, L-bend diagonal, zero junction fade |
| 4 | band 1.5, pads averaged, no apron |
| 5 | tops read as walls → `ground-albedo` red |
| 6 | B.g = 255, photographed |
| 7 | road tone left in the vertex |
| 8 | dashes restored |
| 9 | amplitude 0, B.g = 255, missing case |
| 10 | no terrace guard |
| 11 | a short feather |
| 12 | tread to the persistent pool |
| 13 | one pool hidden |
| 15 | entry bypassed |
| 16 | mission guard dropped, driven in the UI |
| 17 | four product mutations against four new checks |

**Placeholder scan.**
- Numbers left to measurement, and how each is set:
  - Every new layer-check floor: a third of the smallest of three runs, in Tasks 9 and 17.
  - `aftermath`'s ceilings: `relief`'s if its noise reads 0, else found and explained, never widened.
  - `aftermath`'s `cameraTile`, `targetTick` and drone id: computed and pinned by `aftermath.test.ts`.
  - The relief `skirt` outcome: R-20's stop condition.
- Bodies specified by steps rather than written out:
  - `ground-captures.ts`'s browser half (a promotion of the spec's audit script);
  - the GLSL blocks in Tasks 5, 6 and 11, each a transcription of a tested TypeScript mirror whose constants it interpolates;
  - Task 12's wiring, whose behaviour is pinned by the spy tests.
- No "TBD", no "similar to Task N" and no unnamed file.

**Type consistency.**
- `TerrainInput`, `TerrainSurface` and `MeshData` are `terrain/types.ts`'s and `terrain/surface.ts`'s throughout.
- `ControlMap` and `MacroField` (Task 4) are consumed by `controlTextures` (Task 5).
- `RoadGraph` and `roadProfile` (Task 3) are consumed by `buildControlMap` (Task 4) and transcribed in Task 6.
- `DecalKind`, `DecalStamp` and `DecalPool` (Task 10) and `DecalPalette` (Task 11) are consumed in Tasks 12 and 15.
- `ShowcaseSite` (Task 15) is consumed by `aftermath.test.ts` (Task 17).
- `RendererOptions.decalShowcase` (Task 15) is set by `main.ts` (Task 16).
- `SandboxFlagName` gains `'decals'` in Task 16, and `links.test.ts`'s total literal is updated in the same task, so the compiler catches a miss.
- `GroundAlbedoSlot` loses `'road'` in Task 7, and `GROUND_SLOTS` loses it in Task 6. `mesh.test.ts`'s agreement pin is relaxed to a subset in Task 6 and holds as equality again after Task 7.
- `DEBUG_LAYERS` gains `macro` and `roads` in Task 9, and swaps `scorch` for `decals` in Task 13.

**Model tiering.**
- **Opus:** Tasks 5, 6, 9, 11, 12, 13 and 15 (shaders and `ThreeRenderer.ts`), plus the final review.
- **Sonnet:** Tasks 1, 2, 3, 4, 7, 8, 10, 16, 17 and 18's measurement.
- **Haiku:** Task 14 and 18's prose.

Nothing inherits opus by default.

**R-n → Deviations at landing.** R-1 to R-21, in order, in the spec (Task 18).

## Out of scope

- **Plan 2** (spec §3.4–§3.6, its tasks 1–11): clustered scatter and the grain trims (D9); the props Blender kit and its `props` batch and check; desert crowns; the **olive LOD decimated at export (D8, approved)**; sway on the sim clock and the `wind` check; haze in the fog pass and the `haze` check; the `timeOfDay` presets with `&tod` (D10, D11); `perf:units` at 300 after the scatter; bless 2. Plan 2 runs after S3g plan 2 (spec §7).
- **The Meshy swaps, not before October's credits, and each only after the lead's go:**
  - the road's packed-dirt grain (D3, ≤ 45 credits, about $0.90), which replaces the one `uKnoll` road sample and nothing else;
  - the wrecked-car prop on a failed Blender review (D7, 30 credits).
- **Pads' soft edge (R-4):** the rest of G3. It needs the pad tone in the shader.
- **Deleting `road_track_tile.jpg`** and its `GROUND_ALBEDOS` entry, `validate_assets.py` line, `ground-albedo.test.ts` row and provenance (R-7). This is a follow-up with its own asset-gate run.
- **The ditch's 38k tris a segment** (spec §8), the next ground cost after the olive.
- **Pixi parity** for any of this. The report-only diff moves with R-8.
- **`packages/sim/**`**, which stays untouched.

## Execution order

0 → 1 → (Task 0 Step 5, costs on `8d525c81`) → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18.

- Tasks 2 and 3 are independent of each other, and Task 10 is independent of Tasks 5–9. They may run in parallel worktrees if the ledger tracks them. Everything that edits `ThreeRenderer.ts` (5, 6, 9, 12, 13, 15) runs strictly in that order, one at a time.
- **Stop conditions, each reported to the lead with numbers rather than worked around:**
  - R-20's relief `skirt` floor;
  - an existing layer check driven under its floor (Tasks 5, 8 and 13);
  - `buildControlMap` above 60 ms (Task 5);
  - any budget missed in Task 18.
- The lead's word on the zoom-0.35 captures gates the bless (Task 18 Step 2).
- The bless is last, once, from CI numbers.
