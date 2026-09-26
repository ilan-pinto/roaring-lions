# The Garage Uplift, Plan 2 (Lane B, Renderer): the Kit Mark on the Map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a unit's bought kit on the map, in a mission. Every living player unit whose type carries kit gets a small steel plate over its HP bar, with one bar per kit level (1–3). The level is the same `kitLevel` the garage and the HUD card show. It reaches the renderer from the same `upgradePrepass` loop that patches the unit types the sim runs, so the mark cannot disagree with the sim or the card. The mark goes into the existing overlay batch and costs **+0 draw calls**, measured with `renderer.info`. It scales with zoom like every other overlay. A `kit-mark` debug layer and a new gated golden scenario, `kit`, make it a mark the visual gate can see. Pixi draws nothing, and that is permanent.

**Architecture:** Most of the work is in `packages/render/src/three/`, plus a small feed in `packages/app`.
- A new pure module, `units/kit-mark.ts`, holds the approved numbers and the mark's geometry as frozen triangle lists. It has no `three` and no DOM, following `overlay-geometry.ts`'s split, and has its own tests. It also resolves the new `RendererOptions.unitKit` to one byte per sim type index.
- `ThreeRenderer.updateOverlays` pushes three triangle lists per marked unit (plate, steel, bars) into the `OverlayBatch` it already draws HP bars with, at band 4. It consults a flag for the `kit-mark` layer.
- `upgradePrepass` gains a third output, `unitKit`, from its existing loop.
- A sandbox flag, `&kit`, swaps the account's tiers for a fixed ladder before that one prepass. The gate uses it, and so does a human at the picker.
- `tools/src/perf/kit-captures.ts` (`pnpm kit:capture`) photographs the mark at zoom 0.35, 1 and 2.5 for the lead. It measures size, draw calls, triangles and p95.
- `tools/src/golden-diff` gains the `kit` scenario and its layer check.

**Tech Stack:** TypeScript strict, three.js r170, vitest (node environment, with `WebGLRenderer` faked as in every `ThreeRenderer.*.test.ts`), Vite, and Playwright (tools only). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-garage-uplift-design.md` (WP-S3g, #238). It is binding. §3.4 option A and §8 "Plan 2" are what this plan builds, §6 gives the numbers, and §9 names the gate risk it closes. The lead accepted D1–D9 at their defaults:
- **D1:** an overlay mark now, adding no draw calls per unit.
- **D2:** one summary level on the map.
- **D3:** steel `gunmetal-0`.
- **D6:** no screen-constant minimum.

Two of the spec's numbers cannot be built as written. Task 1 puts them to the lead (R-1, R-2).

**Status and entry.** This plan runs on `feat/garage-tier-mark`, cut from `main` at `165eb966`, in `/Users/ilpinto/dev/roaring-lions-ep/s3g-mark`. Plan 1 (#244, the app half, including the HUD card's kit pips) and ground plan 1 (#249) are both on `main`. Every `file:line` below was read at `165eb966`.

## Global Constraints

These bind every task. They come from the spec, CLAUDE.md and the brief.

- **Lane B, one lane in `ThreeRenderer.ts` at a time** (spec §8). Task 0 confirms no other open branch holds it, and Task 3 is the only task that edits it. Writes are confined to the following:
  - `packages/render/src/three/**` and `packages/render/src/api.ts`.
  - The app feed: `packages/app/src/{upgrade-prepass,sandbox-force,sandbox-help,main}.ts`, plus those modules' tests, `ui/sandbox-menu.test.ts` and `shell/links.test.ts`.
  - `tools/src/perf/kit-captures*`, `tools/src/golden-diff/{capture-protocol,baseline,projection,kit.test,baseline.test}.ts`, and the two `package.json` script lines.
  - The Task 8 docs.
- **Three things stay byte-identical to `165eb966` at every commit**, and each is checked with `git diff --stat 165eb966..HEAD -- <path>`, which must be EMPTY:
  - `packages/sim/**`. Invariant 4 holds: the mark reads kit from the app's options and never from sim state it did not already read.
  - `packages/render/src/renderer.ts`, the frozen Pixi backend.
  - `packages/render/src/three/units/overlays.ts`. The mark uses `OverlayBatch.triangle` as it stands (R-1).
- **`render-order.ts` is the single source.** No new band. The mark draws inside `OverlayBatch` at `OVERLAY_RENDER_ORDER` (4). Task 3 records it in that file's table, in words only.
- **Colour comes from palette keys only.** The mark uses `gunmetal.0` for steel and `shadow.0` for the outline and bars, resolved through `opts.resolveColor` once at construction, the way the chevron's `STRIPE_COLOR_KEY` is. The hex fallback beside each key follows the file's existing `overlayColor(key, fallback)` pattern. Neither key has a colour-vision variant (`variantAwareResolver` varies only `team.*`).
- **`three` is imported only under `packages/render/src/three/**`.** `kit-mark.ts` imports nothing from `three`.
- **The overlay loop allocates nothing per unit per frame.** The mark's triangle lists are frozen and cached per (radius, level). The per-type level table is rebuilt only when the sim's type count changes.
- **Pixi: nothing, permanently.** `PixiRenderer` ignores `unitKit`. That is a property of the backend, not a gap, and Task 2 pins it with a test.
- **Pure logic goes into pure, exported, tested functions.** There is no `any`, and there is no non-null assertion in new code, tests included: narrow, or throw a named fixture error.
- **Every check has an input that makes it fail, and that input has been run.** Each task's last step names its mutations. Each is applied, seen red and undone **by reverting the edit, never with `git checkout -- <file>`**. The commit body says what was seen red. A browser-only red (Tasks 5–7) is recorded in the ledger with the capture that shows it.
- **Two approval gates are hard stops.** **G-N**: the lead approves Task 1's numbers table before any geometry is committed. **G-P**: the lead approves Task 6's captures at 0.35, 1 and 2.5 before Task 7 makes the picture a gated reference. That is the "before it renders in anger" the brief asks for (R-10).
- **Servers.** Use ports **5193–5199** only, always with an explicit `--port`. Port 5177 belongs to the lead. `claimPort` refuses a busy port with exit 2, so pick the next free one. **Never kill a process you did not start, and never `pkill`.** A server you started is stopped by its own tool (`stopDevServer`), or by its own PID when it was started by hand.
- **The golden gate.** The local darwin baseline is stale (since 2026-09-03), so a local `golden-baseline` comparison is not evidence. The **layer self-checks** are: their floors are not per-environment (CLAUDE.md), so Task 7 measures `kit-mark` locally. CI's `visual` job on the PR is the evidence for the comparison. There is no local bless and no bless from this branch: after merge, the lead blesses from CI numbers, as `aftermath` was (R-6).
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, plus whatever the task names. Then check the three byte-identical paths above.
- **Git hygiene.**
  - Call `/usr/bin/git` by absolute path, one command per call.
  - Stage with `git add <paths>`, then commit with `git commit -s -F <msgfile> -- <paths>`.
  - Never use `-A`, never `git checkout -- <file>`, never amend, and never push from a task.
  - End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Size.** Each task touches at most five authored files and about 400 changed lines, tests included.
- **The ledger** is `.superpowers/garage-mark/ledger.md`. It is git-ignored and mirrored to the session scratchpad, because clean worktrees get removed. It records baselines, approvals, measurements and every seen-red.

## Rulings taken while planning

Each ruling settles a conflict between the spec, the brief and today's code, and says which way it went.

- **R-1: the mark is triangles in `OverlayBatch` (band 4), not three new cells in `ChevronBatch`'s atlas (band 1.5).** Spec §3.4, §5 and §8 name the atlas. The brief says "the existing overlay batch", at band 4. Both routes are +0 draw calls, and the spec's "at most +1 per frame" premise is wrong in both directions. In three r170 an empty batch still submits: `WebGLRenderer.js:800` returns only on `drawCount < 0`, and `WebGLBufferRenderer.render` calls `info.update` (`calls++`) for a zero-count `drawArrays`. So `ChevronBatch` already costs one call in every frame, veterans or not. What decides it is everything else the atlas route would have to change:
  - `ChevronBatch` holds **one quad per entity** (`entityCapacity * 6` vertices, `overlays.ts:885`). A kitted veteran needs two, so the atlas route must also double that capacity or drop marks silently.
  - Its atlas bakes **one** fill colour at first push (`buildChevronTexture(fillColorHex)`), and the mark needs two.
  - Veterancy's UVs would re-index from 3 cells to 6.
  - `LinearFilter` would blend steel into outline, producing texels no palette entry names.

  `OverlayBatch` is vertex-coloured, so every mark pixel is exactly one of two palette colours. `overlays.ts` stays byte-identical, because `triangle()` already takes a triangle list. The triangle count is exact, 8 + 2L per marked unit, and Task 6 asserts it. The cost is that at zoom 0.35 the mark's edges alias rather than filter. D6 already accepts "presence only" there, and the chevron's unmipmapped `LinearFilter` minification aliases too. The spec's "+4 vertices per kitted unit" is also corrected: the mark is 24 + 6L vertices (30/36/42), and a non-indexed quad is 6, not 4.
- **R-2: the mark box is 10 × 12 px at zoom 1, not §6's 10 × 10.** Three 2 px bars with two 1 px gaps are 8 px. A 1 px outline top and bottom is 2 more. A 1 px band of steel below the lowest bar and above the highest is 2 more again, for 12. At 10, the lowest bar fuses with the bottom outline, and L1 reads as a thick base rather than a bar. Task 1 puts both to the lead, with 10 × 12 recommended.
- **R-3: the placement is pinned by its bottom edge, r + 11 px above the anchor.** That is 1 px clear of the HP bar's top at r + 10, which is the spec's "just over the HP bar". At the taller box the centre moves from §3.4's (0, r+16) to (0, r+17). Task 1's tests prove the clearances at r = 7 and r = 11 against the HP bar, the veterancy chevron and the group badge.
- **R-4: the gate sees the mark through a sandbox flag, `&kit`, not plan 1's `localStorage` seed.** The brief asked which to use, and this is the decisive fact: `three-baseline-gate.ts:509` opens **one** page and drives every scenario through it. An init-script seed persists across every later `page.goto` on that origin. It would kit the Lavis in `vehicle`, and every scenario after it, and move four calibrated baselines and their floors. A URL flag is scoped to one navigation by construction. Beyond that:
  - `Scenario.sandboxFlags` already exists (added for `&decals`), so the harness needs no new mechanism.
  - The flag is what a human uses too: the picker checkbox and `__lions.help()` both come from the one `SANDBOX_FLAGS` table. The lead's approval captures and the gate therefore photograph the same state.
  - `&kit` swaps only the **tiers** handed to the one `upgradePrepass` call. The sim, the HUD card and the mark still read one object.

  What it bypasses is `accountState()`. Plan 1's tests cover that, and Task 6's "account pass" drives it end to end with plan 1's own `garageSeedScript` on a page of its own.
- **R-5: kit is per unit *type*, not per instance.** Brigade D3 makes tiers type-wide and fixed for a mission, so `unitKit` is `Record<typeId, 0|1|2|3>`. The renderer resolves an entity through `st.typeIdx`. A per-instance array would duplicate a fact the sim already keys by type.
- **R-6: `kit` is a new scenario, not `&kit` added to `vehicle`.** Adding the flag to `vehicle` would move a baseline whose four layer floors were calibrated without marks in frame, and would change fog through the sensors tier. A new scenario leaves `vehicle`'s record honest and gives the mark one witness. It costs one PNG per environment and some seconds of gate time, which Task 7 measures. As with `aftermath` (manifest reason, 2026-09-26), the PR's `visual` job reports `kit`'s "no baseline entry" while its layer self-check passes. The lead merges, then blesses from CI numbers.
- **R-7: colours are resolved once at construction**, like the chevron's. A colour-vision change applies from the next boot, which the settings hint already says. Neither key varies under it anyway.
- **R-8: Pixi is pinned, not merely left alone.** A test asserts `renderer.ts` never names `unitKit`. Porting the mark there then means deleting a test on purpose, which is the right amount of friction for a frozen file.
- **R-9: D6 is honoured.** There is no minimum size. At zoom 0.35 the mark is about 3.5 × 4.2 px, which is presence only. Plan 1's HUD card is the low-zoom read.
- **R-10: two gates, not one.** The brief asks for the numbers table in Task 1 as a gate *and* for captures before the mark renders in anger. G-N (Task 1) approves the numbers on paper, per the project's rule of approving art numbers before rendering. G-P (Task 6) approves the picture before Task 7 turns it into the gate's reference, which is the step a bless would otherwise make permanent.
- **R-11: the docs land on this branch (Task 8).** Plan 1 deferred CLAUDE.md to landing. This brief names docs as a task. If the lead prefers landing-time docs from a main worktree, Task 8's three hunks lift out whole.
- **R-12: garrisoned and airborne units carry the mark where their HP bar is.** That is the roof-lifted anchor for a garrison, and the ground anchor for an aircraft. Every overlay in the loop shares that anchor, and a mark elsewhere would read as belonging to something else.

## File structure

| File | Responsibility | Task | Est. lines |
|---|---|---|---|
| `packages/render/src/three/units/kit-mark.ts` (+test) | `KIT_MARK` (the approved numbers), colour keys, `kitPlateOutline`, `kitPlateSteel`, `kitBarRects`, `kitMarkTriangles`, `kitMarkVertexCount` (1); `kitLevelsByType` (2) | 1, 2 | 330 |
| `packages/render/src/api.ts` | `RendererOptions.unitKit` | 2 | 30 |
| `packages/render/src/three/ThreeRenderer.ts` | the draw in `updateOverlays`, the level cache, the `kit-mark` case, the overlay budget comment | 3 | 80 |
| `packages/render/src/three/ThreeRenderer.kit-mark.test.ts` | the draw, through the real `updateOverlays` | 3 | 230 |
| `packages/render/src/three/debug-layers.ts` (+test) | `kit-mark` | 3 | 50 |
| `packages/render/src/three/units/render-order.ts` | band 4's row names the mark (doc only) | 3 | 6 |
| `packages/app/src/upgrade-prepass.ts` (+test) | `unitKit` from the same loop | 4 | 60 |
| `packages/app/src/sandbox-force.ts` (+test) | `SANDBOX_KIT_LEVELS`, `sandboxKitTiers`, `bootTiers` | 4 | 130 |
| `packages/app/src/sandbox-help.ts` (+test), `ui/sandbox-menu.test.ts`, `shell/links.test.ts` | the `kit` flag | 5 | 30 |
| `packages/app/src/main.ts` | `bootTiers` before the prepass; `unitKit` into the options | 5 | 20 |
| `tools/src/perf/kit-captures.ts` (+test), `tools/package.json`, `package.json` | `pnpm kit:capture` | 6 | 400 |
| `tools/src/golden-diff/projection.ts`, `baseline.test.ts` | `tileToCapture` moved out of the test, now shared | 7 | 60 |
| `tools/src/golden-diff/capture-protocol.ts`, `baseline.ts`, `kit.test.ts` | the `kit` scenario and its layer check | 7 | 170 |
| `CLAUDE.md`, `docs/PERFORMANCE.md`, the spec | docs | 8 | 60 |

---

### Task 0: Entry, the lane, and a baseline

This is not a code task. The coordinator runs it; it needs no model.

- [ ] **Step 1: Check whether `main` has moved under this plan.** Run `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/s3g-mark fetch origin`, then `/usr/bin/git -C … log --oneline HEAD..origin/main -- packages/render/src/three/ThreeRenderer.ts packages/render/src/three/units packages/render/src/three/debug-layers.ts packages/render/src/api.ts packages/app/src/upgrade-prepass.ts packages/app/src/sandbox-force.ts packages/app/src/sandbox-help.ts packages/app/src/main.ts tools/src/golden-diff tools/golden-baselines`. If anything is listed, `/usr/bin/git merge origin/main` and re-read what moved before Task 1.
- [ ] **Step 2: Confirm the lane (spec §8).** Run `gh pr list --state open --json number,title,headRefName,files --jq '.[] | select(any(.files[]; .path == "packages/render/src/three/ThreeRenderer.ts")) | "\(.number) \(.headRefName) \(.title)"'`, and read the lane table in `docs/HANDOVER.md`. If another open branch holds `ThreeRenderer.ts`, **stop and tell the lead**. Tasks 1, 2 and 4 may proceed, because they do not touch it. Task 3 waits.
- [ ] **Step 3: Check the tree.** Run `/usr/bin/git worktree list` and `/usr/bin/git status --short`. The tree must be clean apart from this plan.
- [ ] **Step 4: Confirm plan 1's pieces exist:**
  - `grep -n "export function kitLevel" packages/data/src/upgrades.ts`;
  - `grep -n "kitByType" packages/app/src/upgrade-prepass.ts`;
  - `grep -n "export function garageSeedScript" tools/src/ui-review/garage-seed.ts`.
- [ ] **Step 5: Record baseline gates in the ledger**, so a later red can be attributed:
  - `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, with the spec count.
  - `pnpm golden-baseline -- --port=5197 --scenario=vehicle`. Its comparison is stale locally, so record only its layer self-check lines and its wall clock, which Task 7 compares against.

---

### Task 1: The numbers, approved, and the mark's geometry (G-N)

**Model:** opus. This is the overlay's geometry, and the gate ahead of it.

**Files:**
- Create: `packages/render/src/three/units/kit-mark.ts`, `packages/render/src/three/units/kit-mark.test.ts`

**Interfaces (Tasks 2, 3 and 6 consume these):**
- `type MarkPoint = readonly [number, number]`
- `type KitMarkLevel = 1 | 2 | 3`
- `const KIT_MARK: { widthPx, heightPx, bottomAboveR, bevelUpPx, bevelSweep, outlinePx, barWidthPx, barHeightPx, barGapPx, firstBarBottomPx }`
- `const KIT_COLOR_KEY = 'gunmetal.0'`, `KIT_EDGE_COLOR_KEY = 'shadow.0'`, `KIT_COLOR_FALLBACK = '#C3C7C4'`, `KIT_EDGE_COLOR_FALLBACK = '#23241F'`
- `function kitPlateOutline(): readonly MarkPoint[]`: box-local, origin at the box's top-left, y down.
- `function kitPlateSteel(): readonly MarkPoint[]`: the plate inset by `outlinePx`, with vertex i on the inset of edges i−1 and i.
- `function kitBarRects(level: KitMarkLevel): readonly (readonly [number, number, number, number])[]`: `[x0, y0, x1, y1]`, box-local.
- `interface KitMarkTriangles { readonly edge; readonly steel; readonly bars }`: frozen triangle lists (every three points are one triangle) in anchor-relative Pixi pixels (x right, y down).
- `function kitMarkTriangles(r: number, level: KitMarkLevel): KitMarkTriangles`: cached, and returns the same frozen object every call.
- `function kitMarkVertexCount(level: KitMarkLevel): number`: 24 + 6 × level.

- [ ] **Step 1: The gate (G-N).** The coordinator puts this table to the lead, with the two options for N3, and records the lead's words in the ledger. **Nothing below this step runs until the lead approves.** If the lead changes a number, change it here, in `KIT_MARK`, and in the Step 2 tests, and nowhere else.

  | # | Item | Number (recommended, A) | Reason |
  |---|---|---|---|
  | N1 | Level | `kitLevel` (`@lions/data`), unchanged: `ceil(3 × owned ÷ available)`, 0–3; the map draws 1–3 | spec §3.1, D2 |
  | N2 | Colours | steel `gunmetal.0` #C3C7C4; outline and bars `shadow.0` #23241F; alpha 1 | D3; clear of veterancy `dust.0` gold, team blue and lime selection |
  | N3 | Box at zoom 1 | **A: 10 w × 12 h px**. B: 10 × 10, the spec's own, where the lowest bar fuses with the outline | R-2 |
  | N4 | Placement | centred in x; bottom edge at r + 11 above the anchor, so the centre is (0, r + 17); r = 7 soft, 11 hard | 1 px over the HP bar's top (r + 10), R-3 |
  | N5 | Plate | outer hexagon, box-local (x right, y down): (0,12) (0,3) (1.75,0) (8.25,0) (10,3) (10,12); upper corners bevelled 1.75 across over 3, which is 14 ÷ 24, the chevron's sweep (`CHEVRON_SWEEP`, `kit-sign.ts`) | the kit family's plate, as in the garage glyph |
  | N6 | Outline | 1 px: the steel is the plate inset 1 px parallel to every edge, giving bevel inner corners (1, 3.270) (2.324, 1) (7.676, 1) (9, 3.270) | §6 "1 px shadow-0 outline" |
  | N7 | Bars | L bars in `shadow.0`, 4 × 2 px at x 3–7; bar k (k = 0 lowest) at y 8−3k … 10−3k, giving 8–10, 5–7 and 2–4; 1 px steel gaps; at least 1 px of steel to every edge | §6 "bars 2 px, 1 px gaps"; climbs like the garage glyph (bar 1 at the bottom) |
  | N8 | Who | side 0 only; L ≥ 1 only; every living own unit, selected or not | spec §3.4 |
  | N9 | On screen | 3.5 × 4.2 / 10 × 12 / 25 × 30 px at zoom 0.35 / 1 / 2.5 (±1.5 px rasterisation) | D6: no minimum; overlays scale with zoom |
  | N10 | Clearances at r = 7 / 11 | HP bar 1 / 1 px; veterancy chevron quad 1 / 1 px; group-badge disc 2.2 / 5.2 px | computed and pinned in Step 2 |
  | N11 | Cost | **+0 draw calls** (`OverlayBatch`, band 4); 8 + 2L triangles (24 + 6L ≤ 42 vertices) per marked unit | D1, R-1 |
  | N12 | Sandbox ladder (`&kit`) | L1: `inf_squad`, `apc_eitan`, `jeep_shoded`. L2: `at_team`, `ifv_namer`, `recon_drone`, `heli_peten`. L3: `mortar_team`, `mbt_lavi`, `dozer_d9` | every level on both radii (soft rifles, AT, mortar; hard APC, IFV, MBT); 5 / 5 / 4 placements |
  | N13 | Gate framing | `kit` scenario: `beit_sahwan_outskirts&kit`, camera tile (4.5, 20.5), zoom 1.5, tick 140; all 14 placements fall at x 172–892, y 306–738 of 1400 × 900 | R-4, R-6; Task 7 pins it |
  | N14 | Layer floor | a third of the smallest of three measured runs, on both metrics | the gate's own rule (`baseline.ts`) |

- [ ] **Step 2: Write the failing tests** in `packages/render/src/three/units/kit-mark.test.ts`:

```ts
// The kit mark's geometry (WP-S3g plan 2, Task 1). Every number here is the
// table the lead approved at G-N; `KIT_MARK` is its code form, and the first
// test compares them one for one so a drifted constant cannot pass as a
// reasoned one.
import { describe, expect, it } from 'vitest';
import {
  KIT_MARK,
  KIT_COLOR_KEY,
  KIT_EDGE_COLOR_KEY,
  kitBarRects,
  kitMarkTriangles,
  kitMarkVertexCount,
  kitPlateOutline,
  kitPlateSteel,
  type MarkPoint,
} from './kit-mark';
import { unitOverlayRadiusPx } from './overlays';

const RADII = [unitOverlayRadiusPx(true), unitOverlayRadiusPx(false)] as const; // 7, 11
const LEVELS = [1, 2, 3] as const;

/** Signed distance from p to the line a->b (sign depends on the side). */
function signedDistance(p: MarkPoint, a: MarkPoint, b: MarkPoint): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  return (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / Math.hypot(ex, ey);
}

function centroid(poly: readonly MarkPoint[]): MarkPoint {
  return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
}

/** How far p sits inside a convex polygon: the smallest distance to any edge
 *  line, positive inside. */
function insideDistance(p: MarkPoint, poly: readonly MarkPoint[]): number {
  const c = centroid(poly);
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    min = Math.min(min, Math.sign(signedDistance(c, a, b)) * signedDistance(p, a, b));
  }
  return min;
}

function polygonArea(poly: readonly MarkPoint[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function listArea(tris: readonly MarkPoint[]): number {
  let s = 0;
  for (let i = 0; i < tris.length; i += 3) s += polygonArea([tris[i], tris[i + 1], tris[i + 2]]);
  return s;
}

function bbox(points: readonly MarkPoint[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

describe('the approved numbers (G-N)', () => {
  it('match the table the lead approved, number for number', () => {
    expect(KIT_MARK).toEqual({
      widthPx: 10,
      heightPx: 12,
      bottomAboveR: 11,
      bevelUpPx: 3,
      bevelSweep: 14 / 24,
      outlinePx: 1,
      barWidthPx: 4,
      barHeightPx: 2,
      barGapPx: 1,
      firstBarBottomPx: 10,
    });
    expect(KIT_COLOR_KEY).toBe('gunmetal.0');
    expect(KIT_EDGE_COLOR_KEY).toBe('shadow.0');
  });
});

describe('kitPlateOutline', () => {
  it('is the 10 x 12 box with its two upper corners bevelled', () => {
    expect(kitPlateOutline()).toEqual([
      [0, 12],
      [0, 3],
      [1.75, 0],
      [8.25, 0],
      [10, 3],
      [10, 12],
    ]);
  });

  it('bevels at the chevron sweep: 14 across for every 24 up', () => {
    const [, a, b] = kitPlateOutline();
    expect((b[0] - a[0]) / (a[1] - b[1])).toBeCloseTo(14 / 24, 12);
  });
});

describe('kitPlateSteel', () => {
  it('lies exactly one outline width inside every edge of the plate', () => {
    const outer = kitPlateOutline();
    const inner = kitPlateSteel();
    expect(inner).toHaveLength(outer.length);
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i];
      const b = outer[(i + 1) % outer.length];
      expect(Math.abs(signedDistance(inner[i], a, b)), `inner ${i} vs edge ${i}`).toBeCloseTo(1, 9);
      expect(Math.abs(signedDistance(inner[(i + 1) % inner.length], a, b)), `inner ${i + 1} vs edge ${i}`).toBeCloseTo(1, 9);
    }
  });

  it('reads the bevel inner corners the table quotes', () => {
    const s = kitPlateSteel();
    expect(s[1][0]).toBeCloseTo(1, 9);
    expect(s[1][1]).toBeCloseTo(3.2703, 3);
    expect(s[2][0]).toBeCloseTo(2.3244, 3);
    expect(s[2][1]).toBeCloseTo(1, 9);
  });
});

describe('kitBarRects', () => {
  it('draws one bar per level, climbing from the bottom, 2 px tall with 1 px gaps', () => {
    expect(kitBarRects(1)).toEqual([[3, 8, 7, 10]]);
    expect(kitBarRects(2)).toEqual([
      [3, 8, 7, 10],
      [3, 5, 7, 7],
    ]);
    expect(kitBarRects(3)).toEqual([
      [3, 8, 7, 10],
      [3, 5, 7, 7],
      [3, 2, 7, 4],
    ]);
  });

  it('leaves at least one pixel of steel between every bar and the outline', () => {
    const steel = kitPlateSteel();
    for (const [x0, y0, x1, y1] of kitBarRects(3)) {
      for (const corner of [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ] as const) {
        expect(insideDistance(corner, steel), `bar corner ${corner.join(',')}`).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    }
  });
});

describe('kitMarkTriangles', () => {
  it.each(RADII)('at r = %i covers exactly the plate, the steel and the bars', (r) => {
    for (const level of LEVELS) {
      const t = kitMarkTriangles(r, level);
      for (const list of [t.edge, t.steel, t.bars]) expect(list.length % 3).toBe(0);
      expect(listArea(t.edge)).toBeCloseTo(polygonArea(kitPlateOutline()), 9);
      expect(listArea(t.steel)).toBeCloseTo(polygonArea(kitPlateSteel()), 9);
      expect(listArea(t.bars)).toBeCloseTo(level * KIT_MARK.barWidthPx * KIT_MARK.barHeightPx, 9);
      expect(t.edge.length + t.steel.length + t.bars.length).toBe(kitMarkVertexCount(level));
    }
  });

  it('costs 24 vertices plus 6 a bar: 30, 36, 42', () => {
    expect(LEVELS.map(kitMarkVertexCount)).toEqual([30, 36, 42]);
  });

  it.each(RADII)('at r = %i sits centred, its bottom one pixel above the HP bar', (r) => {
    const b = bbox(kitMarkTriangles(r, 3).edge);
    expect(b).toEqual({ minX: -5, maxX: 5, minY: -(r + 23), maxY: -(r + 11) });
    // The HP bar is `rect(anchor, -12, -(r + 10), 12, -(r + 7))`: its top is y = -(r + 10).
    expect(-(r + 10) - b.maxY).toBe(1);
  });

  it.each(RADII)('at r = %i clears the veterancy chevron and the group badge', (r) => {
    const b = bbox(kitMarkTriangles(r, 3).edge);
    // Chevron: a 12 x 12 quad centred (r + 4) right, (r + 4) up; its top edge is y = -(r + 10).
    expect(-(r + 4) - 6 - b.maxY).toBeGreaterThanOrEqual(1);
    // Badge: a disc of radius 7 centred (-(r + 4), -(r + 4)).
    const cx = -(r + 4);
    const cy = -(r + 4);
    const nx = Math.min(Math.max(cx, b.minX), b.maxX);
    const ny = Math.min(Math.max(cy, b.minY), b.maxY);
    expect(Math.hypot(cx - nx, cy - ny) - 7).toBeGreaterThanOrEqual(2);
  });

  it('draws 3.5 x 4.2, 10 x 12 and 25 x 30 px at zoom 0.35, 1 and 2.5', () => {
    const b = bbox(kitMarkTriangles(7, 1).edge);
    const sizes = [0.35, 1, 2.5].map((z) => [(b.maxX - b.minX) * z, (b.maxY - b.minY) * z]);
    expect(sizes[0][0]).toBeCloseTo(3.5, 9);
    expect(sizes[0][1]).toBeCloseTo(4.2, 9);
    expect(sizes.slice(1)).toEqual([
      [10, 12],
      [25, 30],
    ]);
  });

  it('returns the same frozen lists every call, so the overlay loop allocates nothing per unit', () => {
    expect(kitMarkTriangles(7, 2)).toBe(kitMarkTriangles(7, 2));
    expect(Object.isFrozen(kitMarkTriangles(11, 3).bars)).toBe(true);
    expect(Object.isFrozen(kitMarkTriangles(11, 3).bars[0])).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests; they fail** because the module does not exist. Command: `pnpm --filter @lions/render test -- kit-mark`.
- [ ] **Step 4: Write `kit-mark.ts`.** The top comment says what the mark is (spec §3.4 A, D1–D3, D6), why it is pure (`overlay-geometry.ts`'s split), the pixel convention (anchor-relative, x right, y down, at zoom 1), and that `KIT_MARK` is G-N's table. Body:

```ts
export type MarkPoint = readonly [number, number];
export type KitMarkLevel = 1 | 2 | 3;

/** G-N's table, as code. Box-local numbers are measured from the box's
 *  top-left, y down; `bottomAboveR` is how far the box's bottom edge sits
 *  above the anchor, as an offset from the overlay radius r. */
export const KIT_MARK = Object.freeze({
  widthPx: 10,
  heightPx: 12,
  bottomAboveR: 11,
  bevelUpPx: 3,
  /** `mark.ts`'s chevron: 14 across for every 24 up (`CHEVRON_SWEEP`, `kit-sign.ts`). */
  bevelSweep: 14 / 24,
  outlinePx: 1,
  barWidthPx: 4,
  barHeightPx: 2,
  barGapPx: 1,
  firstBarBottomPx: 10,
});

export const KIT_COLOR_KEY = 'gunmetal.0';
export const KIT_EDGE_COLOR_KEY = 'shadow.0';
export const KIT_COLOR_FALLBACK = '#C3C7C4';
export const KIT_EDGE_COLOR_FALLBACK = '#23241F';

export interface KitMarkTriangles {
  readonly edge: readonly MarkPoint[];
  readonly steel: readonly MarkPoint[];
  readonly bars: readonly MarkPoint[];
}

export function kitPlateOutline(): readonly MarkPoint[] {
  const { widthPx: w, heightPx: h, bevelUpPx: b, bevelSweep: s } = KIT_MARK;
  const run = b * s;
  return [[0, h], [0, b], [run, 0], [w - run, 0], [w, b], [w, h]];
}

/** Every edge of a convex polygon moved `d` inward, and neighbours
 *  intersected: vertex i lies on the inset of edges i-1 and i. The inward
 *  side is found from the centroid, so winding does not matter. */
function insetConvex(poly: readonly MarkPoint[], d: number): MarkPoint[] {
  const n = poly.length;
  const cx = poly.reduce((s, p) => s + p[0], 0) / n;
  const cy = poly.reduce((s, p) => s + p[1], 0) / n;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny);
    nx /= len;
    ny /= len;
    if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny, c: nx * a[0] + ny * a[1] + d };
  });
  return lines.map((l, i) => {
    const k = lines[(i - 1 + n) % n];
    const det = k.nx * l.ny - k.ny * l.nx;
    return [(k.c * l.ny - k.ny * l.c) / det, (k.nx * l.c - k.c * l.nx) / det] as const;
  });
}

export function kitPlateSteel(): readonly MarkPoint[] {
  return insetConvex(kitPlateOutline(), KIT_MARK.outlinePx);
}

export function kitBarRects(level: KitMarkLevel): readonly (readonly [number, number, number, number])[] {
  const { widthPx: w, barWidthPx: bw, barHeightPx: bh, barGapPx: g, firstBarBottomPx: y0 } = KIT_MARK;
  const x0 = (w - bw) / 2;
  const out: (readonly [number, number, number, number])[] = [];
  for (let k = 0; k < level; k++) {
    const bottom = y0 - k * (bh + g);
    out.push([x0, bottom - bh, x0 + bw, bottom]);
  }
  return out;
}

export function kitMarkVertexCount(level: KitMarkLevel): number {
  return 2 * 3 * (6 - 2) + 6 * level;
}

function fan(poly: readonly MarkPoint[]): MarkPoint[] {
  const out: MarkPoint[] = [];
  for (let i = 1; i < poly.length - 1; i++) out.push(poly[0], poly[i], poly[i + 1]);
  return out;
}

function rectTriangles([x0, y0, x1, y1]: readonly [number, number, number, number]): MarkPoint[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]];
}

/** Box-local to anchor-relative: centred in x, bottom edge r + bottomAboveR up. */
function place(points: readonly MarkPoint[], r: number): readonly MarkPoint[] {
  const top = -(r + KIT_MARK.bottomAboveR + KIT_MARK.heightPx);
  return Object.freeze(points.map(([x, y]) => Object.freeze([x - KIT_MARK.widthPx / 2, top + y] as const)));
}

const cache = new Map<string, KitMarkTriangles>();

export function kitMarkTriangles(r: number, level: KitMarkLevel): KitMarkTriangles {
  const key = `${r}:${level}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const built: KitMarkTriangles = Object.freeze({
    edge: place(fan(kitPlateOutline()), r),
    steel: place(fan(kitPlateSteel()), r),
    bars: place(kitBarRects(level).flatMap(rectTriangles), r),
  });
  cache.set(key, built);
  return built;
}
```

- [ ] **Step 5: Run the tests; they pass.** Then run the gates line.
- [ ] **Step 6: Falsify, then commit.** Each of these must be seen red, then undone by reverting the edit:
  - (a) `bevelSweep: 2 / 3`. The table test and the sweep test go red.
  - (b) `insetConvex(..., 0)`. The one-width test goes red.
  - (c) `firstBarBottomPx: 11`, so bars touch the outline. The steel-margin test and the table test go red.
  - (d) `bottomAboveR: 10`. The HP-bar test (0 px gap) goes red.
  - (e) `fan` stops one triangle short (`i < poly.length - 2`). Both area tests go red.
  - (f) Drop the cache. The identity test goes red.

  Commit the two paths with the message `feat(render): the kit mark's approved numbers and its geometry, pure (WP-S3g plan 2 T1, G-N)`. The body quotes the lead's approval from the ledger.

---

### Task 2: `RendererOptions.unitKit`, resolved per type, and Pixi pinned

**Model:** sonnet. This is a type, a lookup and a pin.

**Files:**
- Modify: `packages/render/src/api.ts`, `packages/render/src/three/units/kit-mark.ts`, `packages/render/src/three/units/kit-mark.test.ts`

**Interfaces:**
- `RendererOptions.unitKit?: Readonly<Record<string, 0 | 1 | 2 | 3>>`. It is spelled inline rather than as `KitLevel`, because `@lions/render` does not depend on `@lions/data` and must not start to. It is structurally identical, so Task 5's assignment from `upgradePrepass` typechecks, and that typecheck is the guard.
- `function kitLevelsByType(typeIds: readonly string[], unitKit: Readonly<Record<string, number>> | undefined): Uint8Array`: one byte per sim type index. A type the record does not name reads 0, and so does any value other than an integer 1–3.

- [ ] **Step 1: Write the failing tests.** Append to `kit-mark.test.ts`, and add `kitLevelsByType` to its import plus `readFileSync`, `path` and `fileURLToPath`:

```ts
describe('kitLevelsByType', () => {
  it("resolves each sim type index to its type's level", () => {
    expect([...kitLevelsByType(['inf_squad', 'mbt_lavi', 'militia_cell'], { inf_squad: 1, mbt_lavi: 3 })]).toEqual([1, 3, 0]);
  });

  it('is all zero with no option: a renderer built without one draws no mark', () => {
    expect([...kitLevelsByType(['inf_squad', 'mbt_lavi'], undefined)]).toEqual([0, 0]);
  });

  it('draws nothing for a value that is not a level, rather than a wrong mark', () => {
    expect([...kitLevelsByType(['a', 'b', 'c', 'd', 'e'], { a: 4, b: -1, c: 1.5, d: Number.NaN, e: 0 })]).toEqual([0, 0, 0, 0, 0]);
  });

  it("reads only the record's own keys, never an inherited one", () => {
    const inherited = Object.create({ inf_squad: 2 }) as Record<string, number>;
    expect([...kitLevelsByType(['inf_squad'], inherited)]).toEqual([0]);
  });
});

describe('the Pixi backend', () => {
  it('never reads unitKit: the mark is three-only, permanently (spec §3.4, R-8)', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer.ts'), 'utf8');
    expect(src).not.toContain('unitKit');
  });
});
```

- [ ] **Step 2: Run the tests; they fail** on the missing export. The Pixi pin passes already, which is the point of a pin.
- [ ] **Step 3: Implement.**
  - In `kit-mark.ts`:

```ts
/** `RendererOptions.unitKit` as one byte per sim type index, rebuilt by the
 *  caller when the sim's type count changes. Own keys only, and only an
 *  integer 1-3 is a level: anything else draws no mark, never a wrong one. */
export function kitLevelsByType(
  typeIds: readonly string[],
  unitKit: Readonly<Record<string, number>> | undefined
): Uint8Array {
  const out = new Uint8Array(typeIds.length);
  if (unitKit === undefined) return out;
  typeIds.forEach((id, i) => {
    if (!Object.prototype.hasOwnProperty.call(unitKit, id)) return;
    const v = unitKit[id];
    if (v === 1 || v === 2 || v === 3) out[i] = v;
  });
  return out;
}
```

  - In `api.ts`, after `decalShowcase`, add the field with a doc comment in this file's register. The comment says:
    - it is the kit level each unit **type** carries this mission (spec §3.4, D1/D2; brigade D3: type-wide, fixed for the mission);
    - the app fills it from `upgradePrepass`, the same loop that patches the types the sim runs and feeds the HUD card, so the three cannot disagree;
    - only side 0 is marked;
    - it is optional, and absent means no mark;
    - it is three-only, and `PixiRenderer` ignores it permanently, pinned by `kit-mark.test.ts` (R-8).

  - In `api.ts`'s header count: "thirteen properties (two optional)" is already stale. Leave it alone; Task 8 does not chase it either.
- [ ] **Step 4: Run the tests; they pass.** Run the gates line.
- [ ] **Step 5: Falsify, then commit.** Each must be seen red, then undone:
  - (a) Accept any positive integer (`v >= 1 ? Math.min(v, 3)`). The "not a level" test goes red.
  - (b) Replace the own-key check with `unitKit[id]`. The inherited test goes red.
  - (c) Add `// unitKit` to `renderer.ts`. The Pixi pin goes red; revert it by undoing the edit, and `git diff --stat 165eb966..HEAD -- packages/render/src/renderer.ts` is empty again.

  Commit the three paths with the message `feat(render): RendererOptions.unitKit, one level per unit type, three-only (WP-S3g plan 2 T2)`.

---

### Task 3: The mark on the map, and its `kit-mark` layer

**Model:** opus. This is `ThreeRenderer.ts` and the overlay pass.

**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/debug-layers.ts`, `packages/render/src/three/debug-layers.test.ts`, `packages/render/src/three/units/render-order.ts` (doc only)
- Create: `packages/render/src/three/ThreeRenderer.kit-mark.test.ts`

**Interfaces:**
- `ThreeRenderer` private fields:
  - `kitByTypeIdx: Uint8Array`
  - `kitMarkDebugHidden: boolean`
  - `kitSteelHex: string`
  - `kitEdgeHex: string`
- `ThreeRenderer` private method: `kitLevelOf(typeIdx: number): number`.
- `DEBUG_LAYERS` gains `'kit-mark'`. `setDebugLayerVisible('kit-mark', v)` returns 1 when it changed and 0 when it was already so (`vignette`'s shape).

- [ ] **Step 1: Write the failing draw tests** in `ThreeRenderer.kit-mark.test.ts`:

```ts
/**
 * The kit mark on the map (WP-S3g plan 2, Task 3), pinned through the REAL
 * `updateOverlays`: the failure worth catching is a mark whose geometry is
 * right (Task 1) and whose wiring is not. The draw hands `OverlayBatch.triangle`
 * the frozen lists `kitMarkTriangles` returns, so the kit's calls are found by
 * IDENTITY among everything else the pass pushes.
 *
 * Harness copied from `ThreeRenderer.route.test.ts`: a faked `WebGLRenderer`,
 * and `renderer.snapshot()` driving the interpolation buffers.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { ChevronBatch, OverlayBatch } from './units/overlays';
import { KIT_COLOR_KEY, KIT_EDGE_COLOR_KEY, kitMarkTriangles, type KitMarkLevel, type MarkPoint } from './units/kit-mark';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
};

const STEEL = '#C3C7C4';
const EDGE = '#23241F';
const OTHER = '#8E9491';

function makeOpts(unitKit?: RendererOptions['unitKit']): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
    resolveColor: (key) => (key === KIT_COLOR_KEY ? STEEL : key === KIT_EDGE_COLOR_KEY ? EDGE : OTHER),
    ...(unitKit ? { unitKit } : {}),
  };
}

/** Soft (front armour 10 mm < 30 mm, `SOFT_ARMOR_LIMIT`), so r = 7. */
const RIFLES: UnitTypeJson = {
  id: 'inf_squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
};
/** Hard, so r = 11; a real key in every closed table this backend consults. */
const DOZER: UnitTypeJson = {
  id: 'dozer_d9',
  role: 'engineer',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

interface Privates {
  overlayBatch: OverlayBatch;
  chevronBatch: ChevronBatch;
  fog: Uint8Array;
  updateOverlays(alpha: number): void;
}

interface Spawn {
  readonly type: 'rifles' | 'dozer';
  readonly side: number;
  readonly veterancy?: number;
}

function setUp(unitKit: RendererOptions['unitKit'], spawns: readonly Spawn[], capacity = 8) {
  const sim = new Sim({ seed: 1, width: 48, height: 48, capacity });
  const rifles = sim.addUnitType(RIFLES);
  const dozer = sim.addUnitType(DOZER);
  const ids = spawns.map((s, k) =>
    sim.spawn(
      s.type === 'rifles' ? rifles : dozer,
      s.side,
      fx.from(1.5 + (k % 11) * 2),
      fx.from(1.5 + Math.floor(k / 11) * 2),
      0,
      s.veterancy ?? 0
    )
  );
  const renderer = new ThreeRenderer(sim, makeOpts(unitKit));
  const priv = renderer as unknown as Privates;
  renderer.snapshot();
  renderer.snapshot();
  priv.fog.fill(2); // every tile visible, after the snapshots: a side-1 unit reaches the overlay pass
  const triangle = vi.spyOn(priv.overlayBatch, 'triangle');
  const rect = vi.spyOn(priv.overlayBatch, 'rect');
  return { sim, renderer, priv, ids, triangle, rect };
}

type TriangleCall = [readonly [number, number, number], readonly (readonly [number, number])[], string, number];

/** The kit's own calls, found by identity with the frozen lists. */
function kitCalls(calls: readonly TriangleCall[], r: number, level: KitMarkLevel): TriangleCall[] {
  const t = kitMarkTriangles(r, level);
  const mine: readonly (readonly MarkPoint[])[] = [t.edge, t.steel, t.bars];
  return calls.filter(([, pts]) => mine.includes(pts));
}

const steelCalls = (calls: readonly TriangleCall[]): number => calls.filter(([, , c]) => c === STEEL).length;

describe('the kit mark on the map (WP-S3g plan 2)', () => {
  it("draws a level-2 dozer's plate, steel and two bars, in that order and those colours", () => {
    const { priv, triangle } = setUp({ dozer_d9: 2 }, [{ type: 'dozer', side: 0 }]);
    priv.updateOverlays(1);
    const t = kitMarkTriangles(11, 2);
    const calls = kitCalls(triangle.mock.calls as TriangleCall[], 11, 2);
    expect(calls.map(([, pts, color, alpha]) => [pts, color, alpha])).toEqual([
      [t.edge, EDGE, 1],
      [t.steel, STEEL, 1],
      [t.bars, EDGE, 1],
    ]);
  });

  it('uses the soft radius for infantry', () => {
    const { priv, triangle } = setUp({ inf_squad: 1 }, [{ type: 'rifles', side: 0 }]);
    priv.updateOverlays(1);
    const calls = triangle.mock.calls as TriangleCall[];
    expect(kitCalls(calls, 7, 1)).toHaveLength(3);
    expect(kitCalls(calls, 11, 1)).toHaveLength(0);
  });

  it('anchors the mark where the HP bar is anchored', () => {
    const { priv, triangle, rect } = setUp({ dozer_d9: 3 }, [{ type: 'dozer', side: 0 }]);
    priv.updateOverlays(1);
    const hpAnchor = rect.mock.calls[0][0];
    for (const [anchor] of kitCalls(triangle.mock.calls as TriangleCall[], 11, 3)) expect(anchor).toEqual(hpAnchor);
  });

  it('draws nothing at level 0, for a type the option does not name, or with no option', () => {
    for (const kit of [{ dozer_d9: 0 as const }, { inf_squad: 3 as const }, undefined]) {
      const { priv, triangle } = setUp(kit, [{ type: 'dozer', side: 0 }]);
      priv.updateOverlays(1);
      expect(steelCalls(triangle.mock.calls as TriangleCall[]), JSON.stringify(kit)).toBe(0);
    }
  });

  it("never marks another side's unit, even one in plain sight", () => {
    const { priv, triangle, rect } = setUp({ dozer_d9: 3 }, [
      { type: 'rifles', side: 0 },
      { type: 'dozer', side: 1 },
    ]);
    priv.updateOverlays(1);
    // Precondition, asserted: both units reached the pass -- two HP-bar
    // backgrounds, told from the full-health fill (same span) by alpha 0.8.
    expect(rect.mock.calls.filter((c) => c[1] === -12 && c[3] === 12 && c[6] === 0.8)).toHaveLength(2);
    expect(steelCalls(triangle.mock.calls as TriangleCall[])).toBe(0);
  });

  it('hides with the kit-mark layer and nothing else, and comes back', () => {
    const { renderer, priv, triangle, rect } = setUp({ dozer_d9: 1 }, [{ type: 'dozer', side: 0 }]);
    expect(renderer.setDebugLayerVisible('kit-mark', false)).toBe(1);
    priv.updateOverlays(1);
    expect(steelCalls(triangle.mock.calls as TriangleCall[])).toBe(0);
    expect(rect).toHaveBeenCalled(); // the HP bar shares the batch and still draws
    expect(renderer.setDebugLayerVisible('kit-mark', true)).toBe(1);
    triangle.mockClear();
    priv.updateOverlays(1);
    expect(steelCalls(triangle.mock.calls as TriangleCall[])).toBe(1);
  });

  it('gives a veteran both registers: the gold chevron and the steel plate', () => {
    const { priv, triangle } = setUp({ dozer_d9: 3 }, [{ type: 'dozer', side: 0, veterancy: 2 }]);
    const push = vi.spyOn(priv.chevronBatch, 'push');
    priv.updateOverlays(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][5]).toBe(2);
    expect(kitCalls(triangle.mock.calls as TriangleCall[], 11, 3)).toHaveLength(3);
  });

  it('resolves a type registered after the renderer was built', () => {
    const { sim, renderer, priv, triangle } = setUp({ dozer_d9: 1, at_team: 2 }, [{ type: 'dozer', side: 0 }]);
    // A real id (closed tables), soft like the rifles, registered late.
    const late = sim.addUnitType({ ...RIFLES, id: 'at_team' });
    sim.spawn(late, 0, fx.from(9.5), fx.from(9.5));
    renderer.snapshot();
    renderer.snapshot();
    priv.updateOverlays(1);
    expect(kitCalls(triangle.mock.calls as TriangleCall[], 7, 2)).toHaveLength(3);
  });

  it('fits the overlay budget with every own unit selected, grouped and marked at level 3', () => {
    const N = 200;
    const spawns: Spawn[] = Array.from({ length: N }, () => ({ type: 'rifles', side: 0 }));
    const { renderer, priv, ids } = setUp({ inf_squad: 3 }, spawns, N);
    renderer.selection = [...ids];
    for (const id of ids) renderer.unitGroup[id] = 1;
    priv.updateOverlays(1);
    const soup = (priv.overlayBatch as unknown as { soup: { count: number; capacity: number } }).soup;
    // HP background 6 + fill 6 + selection ring 96 + badge 48 + mark 42 = 198 a unit.
    expect(soup.count).toBe(N * 198);
    expect(soup.count).toBeLessThan(soup.capacity);
  });
});
```

  Add to `debug-layers.test.ts`, inside `describe('DEBUG_LAYERS')`:

```ts
  it('names the kit mark, and hides it with a flag, not a mesh: HP bars share its batch', () => {
    expect(DEBUG_LAYERS).toContain('kit-mark');
    const r = makeRenderer();
    const i = internals(r);
    expect(r.setDebugLayerVisible('kit-mark', false)).toBe(1);
    expect(i.overlayBatch.mesh.visible).toBe(true);
    expect(r.setDebugLayerVisible('kit-mark', false)).toBe(0);
    expect(r.setDebugLayerVisible('kit-mark', true)).toBe(1);
    r.dispose();
  });
```

  The 200-unit test places 11 units a row on the 48 × 48 map, which gives 19 rows. Do not lower N: below 190 units, the 8,192-vertex slack hides mutation (e). If registering a type late throws in a closed table, pick another real KDF id rather than dropping the test.

- [ ] **Step 2: Run the tests; they fail.** Command: `pnpm --filter @lions/render test -- ThreeRenderer.kit-mark debug-layers`. The `soup.count` equality may also be off by the HP fill: a full-health unit draws it. If the harness shows 192 (no fill) or 204 (a suppression bar), read which overlay differs and fix the **comment and the number together**, never the budget.
- [ ] **Step 3: Implement in `ThreeRenderer.ts`.**
  1. Import `kitLevelsByType`, `kitMarkTriangles`, `KIT_COLOR_KEY`, `KIT_EDGE_COLOR_KEY`, `KIT_COLOR_FALLBACK` and `KIT_EDGE_COLOR_FALLBACK` from `./units/kit-mark`.
  2. Add the fields beside `chevronBatch`, each with a doc comment. `kitMarkDebugHidden`'s comment names the `units` rule and why it applies: the mark shares `OverlayBatch` with every HP bar, so a mesh `visible` would hide those too.
  3. In the constructor, resolve both colours next to the chevron's (`opts.resolveColor ? opts.resolveColor(KIT_COLOR_KEY) : KIT_COLOR_FALLBACK`, and the same for the edge key).
  4. Add the method:

```ts
  /** `opts.unitKit` for one sim type index. The table is rebuilt only when the
   *  sim's type count changes -- in practice once, on the first frame, since
   *  `bootBattlefield` registers every type before it builds the renderer. */
  private kitLevelOf(typeIdx: number): number {
    const types = this.sim.unitTypes;
    if (this.kitByTypeIdx.length !== types.length) {
      this.kitByTypeIdx = kitLevelsByType(types.map((t) => t.id), this.opts.unitKit);
    }
    return this.kitByTypeIdx[typeIdx] ?? 0;
  }
```

  5. In `updateOverlays`, directly after the veterancy chevron block (`ThreeRenderer.ts:7567-7570` at `165eb966`), still inside the per-entity loop:

```ts
      // Kit mark (WP-S3g plan 2; spec §3.4 A, D1-D3, D6): the type's summary
      // level as a steel plate over the HP bar, one bar per level. Triangles in
      // THIS batch (band 4) -- +0 draw calls, exact palette pixels (R-1). Own
      // units only; zoom-scaled like every overlay here. Skipped under the
      // `kit-mark` debug layer, which is a flag for the reason its field says.
      if (side === 0 && !this.kitMarkDebugHidden) {
        const level = this.kitLevelOf(st.typeIdx[i]);
        if (level === 1 || level === 2 || level === 3) {
          const t = kitMarkTriangles(r, level);
          this.overlayBatch.triangle(anchor, t.edge, this.kitEdgeHex, 1);
          this.overlayBatch.triangle(anchor, t.steel, this.kitSteelHex, 1);
          this.overlayBatch.triangle(anchor, t.bars, this.kitEdgeHex, 1);
        }
      }
```

  6. In `setDebugLayerVisible`, add the case before `default`:

```ts
      case 'kit-mark': {
        // `units`' rule, not `overlays`': the mark is triangles inside
        // `OverlayBatch`, which also carries every HP bar, suppression bar and
        // ring, so hiding the mesh would hide all of them. A flag the overlay
        // pass consults instead; the pass rebuilds the batch every frame, so it
        // holds across the gate's repaint by construction.
        const was = !this.kitMarkDebugHidden;
        this.kitMarkDebugHidden = !visible;
        return was === visible ? 0 : 1;
      }
```

  7. Update `OVERLAY_VERTICES_PER_ENTITY`'s doc comment (`ThreeRenderer.ts:710-724`) to the new arithmetic: 12 + 6 + 96 + 48 + 42 = 204 at most for a selected, grouped, suppressed unit at level 3. That fits the pooled `capacity × 200 + 8192` up to a capacity of 2,048, and `main.ts` runs 256. **Leave the value at 200.** Say in the comment that kill pips (2 × 48) and the air shadow (48) were never in the old "114 worst case" either, and that this is recorded, not fixed (Out of scope).
- [ ] **Step 4: Update `debug-layers.ts` and `render-order.ts`.**
  - `debug-layers.ts`: append `'kit-mark'` to `DEBUG_LAYERS`. Add a paragraph in the file's register saying what it hides (the steel plate and its bars on every own kitted unit), why it is a flag (the `units` rule; the batch is shared), and which scenario judges it (`kit`, Task 7). Add "the kit mark" to the `overlays` paragraph's list, since that layer hides it too.
  - `render-order.ts`: in the band-4 row, add "the kit mark (WP-S3g plan 2)" to `OverlayBatch`'s list. In the band-1.5 row, add one sentence: the kit mark is deliberately **not** a textured quad; it is vertex-coloured triangles at band 4, and `units/kit-mark.ts` has the reason. No constant changes.
- [ ] **Step 5: Run the tests; they pass.** Then run the gates line, and confirm `overlays.ts` and `renderer.ts` are byte-identical.
- [ ] **Step 6: Falsify, then commit.** Each must be seen red, then undone:
  - (a) Drop `side === 0 &&`. "never marks another side's unit" goes red.
  - (b) Drop `!this.kitMarkDebugHidden &&`. Both layer tests go red.
  - (c) Use `kitMarkTriangles(11, level)` for every unit. "soft radius" goes red.
  - (d) Push bars before steel. The order test goes red.
  - (e) `OVERLAY_VERTICES_PER_ENTITY = 150`. The budget test goes red (39,600 > 38,192).
  - (f) Build `kitByTypeIdx` once in the constructor with no length check. "registered after" goes red.
  - (g) Implement the case as `setObjectsVisible(visible, this.overlayBatch.mesh)`. The debug-layers test goes red.

  Commit the five paths with the message `feat(render): the kit mark over every own kitted unit, +0 draw calls, and its kit-mark layer (WP-S3g plan 2 T3)`.

---

### Task 4: The feed: `unitKit` from the one prepass, and the sandbox ladder

**Model:** sonnet. These are pure functions beside plan 1's.

**Files:**
- Modify: `packages/app/src/upgrade-prepass.ts`, `packages/app/src/upgrade-prepass.test.ts`, `packages/app/src/sandbox-force.ts`, `packages/app/src/sandbox-force.test.ts`

**Interfaces (Task 5 consumes these, and Task 7 reads the ladder):**
- `UpgradePrepass<T>.unitKit: Readonly<Record<string, KitLevel>>`: every KDF type, from the same loop and the same per-type tiers as `registered` and `kitByType`.
- `const SANDBOX_KIT_LEVELS: Readonly<Record<string, 1 | 2 | 3>>`: N12.
- `function sandboxKitTiers(roster: readonly UpgradableUnit[]): Record<string, Record<string, number>>`: every track of a laddered type at its level, clamped to the track's length.
- `function bootTiers(account: Readonly<Record<string, Readonly<Record<string, number>>>>, boot: { readonly mission: boolean; readonly kitFlag: boolean }, roster: readonly UpgradableUnit[]): Readonly<Record<string, Readonly<Record<string, number>>>>`: the account, except in a sandbox under `&kit`.

- [ ] **Step 1: Write the failing tests.**
  - Append to `upgrade-prepass.test.ts`, and add `kitLevel` to its `@lions/data` import:

```ts
  it('hands the renderer the level the card shows, for every KDF type and no other', () => {
    const { kitByType, unitKit } = upgradePrepass(roster, owned);
    expect(Object.keys(unitKit).sort()).toEqual([...kitByType.keys()].sort());
    for (const [id, summary] of kitByType) expect(unitKit[id], id).toBe(summary.level);
    expect(unitKit.mbt_lavi).toBe(kitLevel(units.mbt_lavi, owned.mbt_lavi));
  });

  it('reads the audit seed as the spec did: Lavi 3, rifles 1, AT 1, and the sim runs that Lavi', () => {
    const seed = {
      inf_squad: { armour: 2, sensors: 1 },
      at_team: { firepower: 1 },
      mbt_lavi: { armour: 3, sensors: 3, firepower: 3 },
    };
    const { unitKit, registered } = upgradePrepass(roster, seed);
    expect([unitKit.mbt_lavi, unitKit.inf_squad, unitKit.at_team, unitKit.ifv_namer]).toEqual([3, 1, 1, 0]);
    // Spec §1 F2: 3000 -> 3750 on the maxed Lavi. The mark and the sim read one object.
    expect(registered.find((u) => u.id === 'mbt_lavi')?.hull.hp).toBe(3750);
  });
```

  - Append to `sandbox-force.test.ts`, importing `units` and `kitLevel` from `@lions/data` and the three new exports:

```ts
describe('the &kit ladder (N12)', () => {
  const roster = Object.values(units);

  it('covers every type the sandbox force fields, and nothing else', () => {
    expect(Object.keys(SANDBOX_KIT_LEVELS).sort()).toEqual([...new Set(SANDBOX_KDF.map(([id]) => id))].sort());
  });

  it('puts each level on at least four placements, so one frame shows all three', () => {
    const count = [0, 0, 0, 0];
    for (const [id] of SANDBOX_KDF) count[SANDBOX_KIT_LEVELS[id] ?? 0]++;
    expect(count[0]).toBe(0);
    expect(count.slice(1).every((n) => n >= 4)).toBe(true);
  });

  it('makes tiers that read back as exactly the ladder level, so sim, card and mark agree', () => {
    const tiers = sandboxKitTiers(roster);
    expect(Object.keys(tiers).sort()).toEqual(Object.keys(SANDBOX_KIT_LEVELS).sort());
    for (const [id, level] of Object.entries(SANDBOX_KIT_LEVELS)) {
      const unit = roster.find((u) => u.id === id);
      if (unit === undefined) throw new Error(`fixture: no unit "${id}" in @lions/data`);
      expect(kitLevel(unit, tiers[id] ?? {}), id).toBe(level);
    }
  });
});

describe('bootTiers', () => {
  const roster = Object.values(units);
  const account = { mbt_lavi: { armour: 1 } };

  it('is the account on a mission, whatever the URL says', () => {
    expect(bootTiers(account, { mission: true, kitFlag: true }, roster)).toBe(account);
  });

  it('is the account in a sandbox without &kit', () => {
    expect(bootTiers(account, { mission: false, kitFlag: false }, roster)).toBe(account);
  });

  it('is the ladder, not the account, in a sandbox with &kit', () => {
    expect(bootTiers(account, { mission: false, kitFlag: true }, roster)).toEqual(sandboxKitTiers(roster));
  });
});
```

- [ ] **Step 2: Run the tests; they fail** on the missing exports. Command: `pnpm --filter @lions/app test -- upgrade-prepass sandbox-force`.
- [ ] **Step 3: Implement.**
  - `upgrade-prepass.ts`: add `unitKit` to the interface, with a doc comment ("the renderer's mark, from the same summary the card draws"). In the KDF branch, `const summary = kitSummary(u, tiers); kitByType.set(u.id, summary); unitKit[u.id] = summary.level;`, and return it. Import `KitLevel` as a type from `@lions/data`. Extend the header's two-outputs paragraph to three.
  - `sandbox-force.ts`: add `import type { UpgradableUnit } from '@lions/data';`, then:

```ts
/** `&kit` (sandbox only, WP-S3g plan 2): a fixed kit level per type the
 *  sandbox force fields, so one frame shows all three levels on both overlay
 *  radii -- soft rifles, AT and mortar; hard APC, IFV and MBT (N12). The gate's
 *  `kit` scenario photographs exactly this. */
export const SANDBOX_KIT_LEVELS: Readonly<Record<string, 1 | 2 | 3>> = {
  inf_squad: 1,
  apc_eitan: 1,
  jeep_shoded: 1,
  at_team: 2,
  ifv_namer: 2,
  recon_drone: 2,
  heli_peten: 2,
  mortar_team: 3,
  mbt_lavi: 3,
  dozer_d9: 3,
};

/** Every track of a laddered type at its level, clamped to the track's length.
 *  Uniform tiers read back as exactly that level for three-tier tracks, which
 *  every shipped KDF track is -- the test above holds it to that. */
export function sandboxKitTiers(roster: readonly UpgradableUnit[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const u of roster) {
    if (!Object.prototype.hasOwnProperty.call(SANDBOX_KIT_LEVELS, u.id)) continue;
    const level = SANDBOX_KIT_LEVELS[u.id];
    const tiers: Record<string, number> = {};
    for (const [name, track] of Object.entries(u.upgrades ?? {})) tiers[name] = Math.min(level, track.tiers.length);
    out[u.id] = tiers;
  }
  return out;
}

/** The tiers a battlefield boots with -- handed to the ONE `upgradePrepass`
 *  call, so the sim, the HUD card and the mark always read the same object.
 *  The account's, except a sandbox under `&kit`, which REPLACES it with the
 *  ladder (the gate boots a fresh account anyway, and a mixed state would be a
 *  picture nobody can reproduce). A mission never takes the ladder: a dev flag
 *  must not change how a real mission plays. */
export function bootTiers(
  account: Readonly<Record<string, Readonly<Record<string, number>>>>,
  boot: { readonly mission: boolean; readonly kitFlag: boolean },
  roster: readonly UpgradableUnit[]
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return !boot.mission && boot.kitFlag ? sandboxKitTiers(roster) : account;
}
```

- [ ] **Step 4: Run the tests; they pass.** Run the gates line.
- [ ] **Step 5: Falsify, then commit.** Each must be seen red, then undone:
  - (a) `bootTiers` ignores `boot.mission`. The mission test goes red.
  - (b) `sandboxKitTiers` sets only `armour`. The read-back test goes red.
  - (c) Delete `mortar_team` from the ladder. The coverage test goes red.
  - (d) `unitKit[u.id] = kitLevel(u, {})`. Both prepass tests go red.

  Commit the four paths with the message `feat(app): unitKit from the one upgrade prepass, and the sandbox's kit ladder (WP-S3g plan 2 T4)`.

---

### Task 5: The `&kit` flag, and the options wired

**Model:** sonnet.

**Files:**
- Modify: `packages/app/src/sandbox-help.ts`, `packages/app/src/sandbox-help.test.ts`, `packages/app/src/ui/sandbox-menu.test.ts`, `packages/app/src/shell/links.test.ts`, `packages/app/src/main.ts`

**Interfaces:**
- `SandboxFlagName` gains `'kit'`.
- `SANDBOX_FLAGS` gains `{ name: 'kit', blurb: 'the sandbox force pre-kitted, level 1–3 by type — the kit mark and the HUD card to walk' }`. The blurb is dev-tool English (`menu.ts:393`'s `i18n-ok`) and names no `&` spelling, per the `nomesh` blurb's own rule.

- [ ] **Step 1: Write the failing tests.**
  - `sandbox-help.test.ts`, beside the `&decals` test:

```ts
  it('reads &kit, off by default, and does not warn about it', () => {
    expect(readFlags(new URLSearchParams('?sandbox=beit_sahwan_outskirts&kit')).kit).toBe(true);
    expect(readFlags(new URLSearchParams('?sandbox=beit_sahwan_outskirts')).kit).toBe(false);
    expect(unknownParams(new URLSearchParams('?sandbox=beit_sahwan_outskirts&kit'))).toEqual([]);
    expect(sandboxUrl('beit_sahwan_outskirts', { kit: true })).toBe('?sandbox=beit_sahwan_outskirts&kit');
  });
```

  - `ui/sandbox-menu.test.ts` (the literal at `:153-161`) and `shell/links.test.ts` (`:58-66`): add `kit: false,` after `decals: false,`. These two literals are `readFlags`' full output, and the new key is what makes them fail first.
- [ ] **Step 2: Run the tests; they fail.** Command: `pnpm --filter @lions/app test -- sandbox-help sandbox-menu links`.
- [ ] **Step 3: Implement.**
  - `sandbox-help.ts`: add the name and the table entry.
  - `main.ts`, in `bootBattlefield`: import `bootTiers` beside the sandbox-force imports, and replace `const prepass = upgradePrepass(Object.values(units), ownedTiers);` (`main.ts:1252`) with:

```ts
  const roster = Object.values(units);
  /** `&kit` (sandbox only, WP-S3g plan 2) swaps the account's tiers for the
   *  fixed ladder BEFORE the one prepass, so the swap reaches the sim, the HUD
   *  card and the map mark together; a mission never takes it (`bootTiers`). */
  const bootKit = bootTiers(ownedTiers, { mission: req.missionId !== null, kitFlag: readFlags(params).kit }, roster);
  const prepass = upgradePrepass(roster, bootKit);
```

  - Then, in the `opts` literal (`main.ts:1625`), after the `rendererOptionsFor(...)` spread, add `unitKit: prepass.unitKit,` with a one-line comment: the same loop as the sim's types and the HUD card's kit.
- [ ] **Step 4: Run the tests; they pass.** Run the gates line and `pnpm test:determinism` (the sim is untouched, so this is a control).
- [ ] **Step 5: Look, by driving the UI.** Console shortcuts skip the code that breaks.
  - Start a dev server by hand with `PORT=5195 pnpm --filter @lions/app dev`, in the background, and record its PID in the ledger.
  - In the browser, open `/free-play` (the picker), tick the new `kit` box, choose `beit_sahwan_outskirts`, and launch.
  - Confirm:
    - Every own unit carries a steel mark over its HP bar: three bars on the Lavis, mortar and D9; two on the Namers, AT team, drone and Apache; one on the rifles, Eitan and jeep.
    - Clicking a Lavi shows plan 1's HUD card with pips 3/3/3 and `+750 kit`, which is the same number the sim runs (3750).
    - The banner and `__lions.help()` list `kit` as on.
  - Then open `/mission/beit_sahwan_1_recon?kit` on a fresh account. There must be no mark on anything.
  - Screenshot both into `.superpowers/garage-mark/t5/`.
  - Stop the server by its PID.
- [ ] **Step 6: Falsify, then commit.** Each must be seen red, then undone:
  - (a) Remove `kit: false` from one literal. That spec goes red.
  - (b) Browser: drop `unitKit: prepass.unitKit`. Every mark vanishes while the HUD card still shows L3. This is a visual red, captured to `t5/red-no-feed.png`.
  - (c) Browser: pass `mission: false` always. The recon mission draws the ladder's marks, captured to `t5/red-mission.png`.

  Commit the five paths with the message `feat(app): the &kit sandbox flag, and unitKit in the renderer options (WP-S3g plan 2 T5)`.

---

### Task 6: `pnpm kit:capture`: the picture at three zooms, the cost, and the lead's approval (G-P)

**Model:** sonnet. This is a capture instrument in the shape of `ground:capture`.

**Files:**
- Create: `tools/src/perf/kit-captures.ts`, `tools/src/perf/kit-captures.test.ts`
- Modify: `tools/package.json` (`"kit:capture": "tsx src/perf/kit-captures.ts"`), `package.json` (`"kit:capture": "pnpm --filter @lions/tools kit:capture"`)

**Interfaces (pure half, all exported):**
- `diffMask(a: Uint8Array, b: Uint8Array, width: number, height: number): Uint8Array`: 1 where any of R, G or B differs; alpha is ignored.
- `interface Blob { x0: number; y0: number; x1: number; y1: number; count: number }`
- `blobs(mask: Uint8Array, width: number, height: number): Blob[]`: 8-connected, in scan order.
- `markSizeVerdict(found: readonly Blob[], zoom: number): { ok: boolean; medianW: number; medianH: number; expectW: number; expectH: number }`: medians within ±1.5 px of `KIT_MARK × zoom`.
- `expectedTriangleDelta(levels: readonly number[]): number`: Σ (8 + 2L) over levels 1–3.
- `callsVerdict(shown: { calls: number; triangles: number }, hidden: { calls: number; triangles: number }): { ok: boolean; dCalls: number; dTriangles: number }`: D1, where `ok` iff `dCalls === 0`.
- `upscaleNearest(data: Uint8Array, width: number, height: number, k: number): Uint8Array`
- `KIT_MARK_PX` imported **as text**: `tools` must not import `@lions/render` (eslint), so the pure half reads `widthPx`/`heightPx` out of `kit-mark.ts` the way `baseline.test.ts`'s `renderConstant` reads `project.ts`, and throws if they move.

- [ ] **Step 1: Write the failing tests** in `kit-captures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  blobs,
  callsVerdict,
  diffMask,
  expectedTriangleDelta,
  KIT_MARK_PX,
  markSizeVerdict,
  upscaleNearest,
} from './kit-captures';

describe('KIT_MARK_PX', () => {
  it("reads the approved box out of the renderer's own source", () => {
    expect(KIT_MARK_PX).toEqual({ widthPx: 10, heightPx: 12 });
  });
});

describe('diffMask', () => {
  it('marks a pixel where any colour channel differs, and ignores alpha', () => {
    const a = Uint8Array.from([10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255]);
    const b = Uint8Array.from([10, 10, 10, 0, 10, 11, 10, 255, 10, 10, 10, 255]);
    expect([...diffMask(a, b, 3, 1)]).toEqual([0, 1, 0]);
  });
});

describe('blobs', () => {
  it('finds two separate marks and their boxes', () => {
    const w = 12;
    const h = 6;
    const mask = new Uint8Array(w * h);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2], [8, 3], [9, 3], [9, 4]]) mask[y * w + x] = 1;
    expect(blobs(mask, w, h)).toEqual([
      { x0: 1, y0: 1, x1: 2, y1: 2, count: 4 },
      { x0: 8, y0: 3, x1: 9, y1: 4, count: 3 },
    ]);
  });

  it('joins diagonal neighbours -- a bevel is a diagonal', () => {
    const mask = Uint8Array.from([1, 0, 0, 1]);
    expect(blobs(mask, 2, 2)).toEqual([{ x0: 0, y0: 0, x1: 1, y1: 1, count: 2 }]);
  });
});

describe('markSizeVerdict', () => {
  const box = (w: number, h: number) => ({ x0: 0, y0: 0, x1: w - 1, y1: h - 1, count: w * h });

  it('passes the approved 10 x 12 at zoom 1, within a pixel and a half', () => {
    expect(markSizeVerdict([box(10, 12), box(11, 13)], 1).ok).toBe(true);
  });

  it('passes 25 x 30 at zoom 2.5 and about 3.5 x 4.2 at zoom 0.35', () => {
    expect(markSizeVerdict([box(25, 30)], 2.5).ok).toBe(true);
    expect(markSizeVerdict([box(4, 4), box(3, 5)], 0.35).ok).toBe(true);
  });

  it("fails the spec's original 10 x 10, the one number G-N changed", () => {
    expect(markSizeVerdict([box(10, 10)], 1).ok).toBe(false);
  });

  it('fails when no mark was found at all', () => {
    expect(markSizeVerdict([], 1).ok).toBe(false);
  });
});

describe('expectedTriangleDelta', () => {
  it('is 8 + 2L per marked unit, and nothing for level 0', () => {
    expect(expectedTriangleDelta([1, 2, 3, 0])).toBe(10 + 12 + 14);
  });
});

describe('callsVerdict (D1)', () => {
  it('passes only an unchanged draw-call count', () => {
    expect(callsVerdict({ calls: 214, triangles: 90_000 }, { calls: 214, triangles: 89_800 })).toEqual({
      ok: true,
      dCalls: 0,
      dTriangles: 200,
    });
    expect(callsVerdict({ calls: 215, triangles: 90_000 }, { calls: 214, triangles: 89_800 }).ok).toBe(false);
  });
});

describe('upscaleNearest', () => {
  it('repeats each pixel k x k, so the lead judges the mark zoomed in without resampling blur', () => {
    const px = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]);
    const up = upscaleNearest(px, 2, 1, 2);
    expect([...up.slice(0, 16)]).toEqual([1, 2, 3, 255, 1, 2, 3, 255, 4, 5, 6, 255, 4, 5, 6, 255]);
    expect(up.length).toBe(2 * 2 * 2 * 1 * 4);
  });
});
```

- [ ] **Step 2: Run the tests; they fail** because the module does not exist. Command: `pnpm --filter @lions/tools test -- kit-captures`.
- [ ] **Step 3: Implement the pure half, then the browser half.** The browser half follows `ground-captures.ts`:
  - Use `ensureDevServer`/`stopDevServer` from `../golden-diff/browser`.
  - Print STARTED or REUSED, and exit 2 on REUSED without `--reuse`.
  - Use `gpuLaunchArgs()` so the GPU is hardware, and warn by name if it is SwiftShader.
  - Use `FREEZE_FRAME_LOOP_SCRIPT` and `hideHudExceptCanvas`.
  - Read the stats with `STATS_SCRIPT`'s shape: `r.renderer.info`, `autoReset = false`, `reset`, `frame(1, 0)`, then read.

  The CLI is `pnpm kit:capture -- --port=5196 --out=.superpowers/garage-mark/t6 [--reuse] [--runs=3]`. What it does:
  1. **The `&kit` pass.** Open `/?sandbox=beit_sahwan_outskirts&kit&renderer=three`, step to tick 140, and send the camera to (4.5, 20.5). For each zoom in 0.35, 1 and 2.5:
     - `frame(1, 0)` twice, then screenshot `z<zoom>-shown.png`.
     - Read stats.
     - `setDebugLayerVisible('kit-mark', false)`, `frame(1, 0)`, then screenshot `z<zoom>-hidden.png`.
     - Read stats, then restore the layer.
     - Compute `diffMask` → `blobs` → `markSizeVerdict`, and `callsVerdict`.
     - Assert `dTriangles === expectedTriangleDelta(levels)`, where `levels` is read in the page from `__lions.sim.state` (living, side 0) through the renderer's own `kitLevelOf`. This is private and reached like `r.renderer`. It reads the table the pass draws from; it does not recompute it.
     - At 2.5 only, write `z2.5-level<L>-x8.png`: a 40 × 48 px crop centred on one blob of each level, taken from the level each blob's unit carries, upscaled ×8 with `upscaleNearest`.
     - Read the median RGB of the steel pixels (the brighter of the blob's two dominant colours at 2.5) and of the nearest HP-bar background, and print both beside their palette values. This is report-only: the HP bar is the control. If both are off by the same amount, the post chain moved both and the mark is faithful.
  2. **Cost.** At each zoom, run `--runs` interleaved pairs, shown then hidden. Each is 30 warm-up frames, then 240 timed `frame(1, 16)` for the CPU p95 and 120 `gl.finish`-bracketed frames for the GPU p95. This is `render-frame-cost.ts`'s loop and its context checks, copied with credit, not imported: that file is a script with top-level effects.
  3. **The account pass (R-4).** Open a new page via `browser.newPage()`, its own context, so its storage cannot leak. `addInitScript(garageSeedScript())` goes on it, then `/?sandbox=beit_sahwan_outskirts&renderer=three` with **no** `&kit`. Assert, through `kitLevelOf` per living side-0 unit: `mbt_lavi` 3, `inf_squad` 1, `at_team` 1, and every other type 0. Assert that the toggle diff at zoom 1 finds a blob. This drives plan 1's real `accountState()` → `upgradePrepass` → `unitKit` path end to end.
  4. **Output.** Write `kit-report.json` (every number above, plus the GPU string, viewport, DPR, commit and run count) and print a table.

  **Exit codes:**
  - 1 if any `callsVerdict` fails, the triangle delta mismatches, a size verdict fails, or the account pass disagrees.
  - 2 for usage or a busy port.
  - 0 otherwise.

  p95 has **no threshold**. It is reported with the spread of the hidden runs, and a shown − hidden median outside that spread is written into the report as `p95: OUTSIDE NOISE` for the lead to read, rather than being given an invented number.
- [ ] **Step 4: Run it.** Run `pnpm kit:capture -- --port=5196 --out=.superpowers/garage-mark/t6`. It must exit 0. Copy the table into the ledger.
- [ ] **Step 5: The gate (G-P).** The coordinator sends the lead:
  - `z0.35-shown.png`, `z1-shown.png` and `z2.5-shown.png`;
  - the three ×8 level crops;
  - the size, calls and triangles table;
  - the steel and HP-bar colour reads.

  Record the lead's words. **Task 7 does not start until the lead approves the picture.** If the lead changes a number, go back to Task 1's table and re-run Tasks 1, 3 and 6. The change lands in `KIT_MARK` alone.
- [ ] **Step 6: Falsify, then commit.** Each must be seen red, then undone:
  - (a) `blobs` 4-connected. The diagonal test goes red.
  - (b) `markSizeVerdict` tolerance 3. The 10 × 10 test goes red.
  - (c) `expectedTriangleDelta` counts level 0 as 8. That test goes red.
  - (d) Browser: in `ThreeRenderer.ts`, push the steel list twice. The run exits 1 on the triangle delta, which is recorded in the ledger. Revert, and confirm `git diff` on `ThreeRenderer.ts` is empty against Task 3's commit.

  Commit the four paths with the message `feat(tools): pnpm kit:capture -- the kit mark at three zooms, its cost, and the account path (WP-S3g plan 2 T6, G-P)`. The body carries the calls, triangles and p95 table and the lead's approval.

---

### Task 7: The gate sees the mark: the `kit` scenario and its layer check

**Model:** sonnet.

**Files:**
- Create: `tools/src/golden-diff/projection.ts`, `tools/src/golden-diff/kit.test.ts`
- Modify: `tools/src/golden-diff/baseline.test.ts` (import the moved helpers), `tools/src/golden-diff/capture-protocol.ts`, `tools/src/golden-diff/baseline.ts`

**Interfaces:**
- `projection.ts` exports `renderConstant(name: string): number` and `tileToCapture(x, y, height, cam)`. Both move verbatim out of `baseline.test.ts:269-309`, with their comments, so a second framing test reads the same projection instead of a copy. `baseline.test.ts` imports them, and its `RELIEF_SCENARIO framing` block is otherwise unchanged.
- `KIT_SCENARIO: Scenario`, inserted in `SCENARIOS` before `COMBAT_SCENARIO`.
- `BASELINES.kit: BaselineSpec`, gated, with one layer check: `kit-mark`.

- [ ] **Step 1: Write the failing test** in `kit.test.ts`:

```ts
// WP-S3g plan 2, Task 7: the `kit` scenario is the only gated frame with a
// kitted unit in it -- every other scenario boots a fresh account (spec §9).
// This is its pure, Node-only half: the URL the app parses, the framing
// against the sandbox's own anchors and the ladder, and the one layer it
// declares.
import { describe, expect, it } from 'vitest';
import { maps, parseMap } from '@lions/data';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { SANDBOX_KDF, SANDBOX_KIT_LEVELS } from '../../../packages/app/src/sandbox-force';
import { CAPTURE_VIEWPORT, KIT_SCENARIO, SCENARIOS, threeUrl } from './capture-protocol';
import { BASELINES, isGated } from './baseline';
import { tileToCapture } from './projection';

describe('the kit scenario frames the kitted sandbox force', () => {
  const json = maps.beit_sahwan_outskirts;
  const map = parseMap(json);
  const [ax, ay] = sandboxAnchors(json).friendly;
  const cam = {
    x: KIT_SCENARIO.cameraTile?.[0] ?? Number.NaN,
    y: KIT_SCENARIO.cameraTile?.[1] ?? Number.NaN,
    zoom: KIT_SCENARIO.zoom ?? 1,
  };

  it('boots beit_sahwan_outskirts with &kit and nothing the app would warn about', () => {
    const url = new URL(threeUrl(5195, KIT_SCENARIO));
    expect(url.searchParams.get('sandbox')).toBe('beit_sahwan_outskirts');
    expect(url.searchParams.has('kit')).toBe(true);
    expect(unknownParams(url.searchParams)).toEqual([]);
  });

  it('frames every kit level on at least one unit, well inside the frame', () => {
    // 100 px of margin: `main.ts`'s `open()` may nudge a placement off a
    // blocked tile, and a tile is 48 px across at zoom 1.5.
    const MARGIN = 100;
    const framed = new Set<number>();
    for (const [id, dx, dy] of SANDBOX_KDF) {
      const x = ax + dx + 0.5;
      const y = ay + dy + 0.5;
      const h = map.elevation[Math.floor(y) * map.width + Math.floor(x)] ?? 0;
      const p = tileToCapture(x, y, h, cam);
      const inside =
        p.x >= MARGIN &&
        p.y >= MARGIN &&
        p.x <= CAPTURE_VIEWPORT.width - MARGIN &&
        p.y <= CAPTURE_VIEWPORT.height - MARGIN;
      if (inside) framed.add(SANDBOX_KIT_LEVELS[id] ?? 0);
    }
    expect([...framed].sort()).toEqual([1, 2, 3]);
  });

  it('pins the tick, the zoom and no orders: a still frame, marks 15 x 18 px', () => {
    expect(KIT_SCENARIO.targetTick).toBe(140);
    expect(KIT_SCENARIO.zoom).toBe(1.5);
    expect(KIT_SCENARIO.orders).toBeUndefined();
  });

  it('is gated and declares kit-mark, which no other scenario can witness', () => {
    expect(SCENARIOS).toContain(KIT_SCENARIO);
    expect(isGated(BASELINES.kit)).toBe(true);
    expect((BASELINES.kit.layerChecks ?? []).map((c) => c.layer)).toEqual(['kit-mark']);
    for (const [id, spec] of Object.entries(BASELINES)) {
      if (id === 'kit') continue;
      expect((spec.layerChecks ?? []).map((c) => c.layer), id).not.toContain('kit-mark');
    }
  });
});
```

- [ ] **Step 2: Run the tests; they fail** on the missing `KIT_SCENARIO` and `projection.ts`. `baseline.test.ts`'s own "SCENARIOS equals BASELINES" check fails as well, once the scenario exists without its entry.
- [ ] **Step 3: Implement the scenario and a provisional entry.**
  - `projection.ts`: move `renderConstant` and `tileToCapture` out of `baseline.test.ts`, and make `baseline.test.ts` import them.
  - `capture-protocol.ts`: add the scenario, with a doc comment covering what it frames and why it is its own scenario (R-6), why a flag and not a seed (R-4, naming `three-baseline-gate.ts:509`'s single page), and why zoom 1.5 (all 14 placements inside at ≥ 162 px from every edge, and marks at 15 × 18 px):

```ts
export const KIT_SCENARIO: Scenario = {
  id: 'kit',
  description:
    'beit_sahwan_outskirts sandbox force under &kit, zoom 1.5, tick 140 -- every own unit carries its ' +
    "type's kit mark, levels 1-3 on both overlay radii. The only frame with a kitted unit in it.",
  sandboxMap: 'beit_sahwan_outskirts',
  sandboxFlags: ['kit'],
  cameraTile: [4.5, 20.5],
  ticks: 140, // unused when targetTick is set
  targetTick: 140,
  zoom: 1.5,
};
```

  - `baseline.ts`: add `kit` with `region: null`, **provisional** thresholds `maxDiffPixels: 300`, `maxMeanAbsChannelDelta: 0.02` (`vehicle`'s, the nearest framing), and a `kit-mark` check with floors `minDiffPixels: 1` and `minMeanAbsChannelDelta: 0.0001`. Its rationale reads `PROVISIONAL -- Task 7 Step 4`. The floors stay provisional only until Step 4, which replaces them in the same commit.
- [ ] **Step 4: Measure, then set the numbers.** Measure on this machine, with SwiftShader through the gate's own browser. Every run is its own fresh process.
  1. **The layer signal: three runs.** Run `pnpm golden-baseline -- --port=5197 --scenario=kit` three times. With no darwin `kit` baseline, each exits 3, which is correct. Each still prints the `kit-mark` self-check delta. Record all three `diffPixels / meanAbsChannelDelta` pairs. **Floors = a third of the smallest, on both metrics, rounded down to a readable number** (N14, the file's rule).
  2. **Noise: at least ten runs.** Run `pnpm golden-baseline:bless -- --port=5197 --scenario=kit --baseline-dir=<scratchpad>/kit-provisional --reason="provisional, local noise only"` once, into a scratch directory that is never committed. Then run ten comparisons against it with the same `--baseline-dir`. If the noise sits inside `vehicle`'s measured band (5–157 px / 0.0029–0.0069), keep 300 / 0.02. If it does not, **stop and report**. Never widen a threshold to clear a run, and remember that a bimodal reading is a bug to find, not a band to widen.
  3. **The repaint control must read 0 px / 0.0000**, the global hard zero. A drifting control is a bug to find (`baseline.ts`'s rule).
  4. **Wall clock.** Record the full gate before (Task 0) and after, three runs each.
  5. **Write the rationales.** Write both rationales in `baseline.ts`'s register, carrying the conditions, the sample sizes, every reading and the falsification from Step 6(d).
- [ ] **Step 5: Run the tests; they pass.** Run the gates line.
- [ ] **Step 6: Falsify, then commit.** Each must be seen red, then undone:
  - (a) `zoom: 3`. The framing test goes red.
  - (b) `sandboxFlags: []`. The URL test goes red.
  - (c) Declare `kit-mark` on `vehicle`. The last test goes red.
  - (d) Browser: make `kitLevelOf` return 0. The gate's `kit-mark` check reads about 0 px / 0.0000 and FAILs, exit 1. Quote the numbers in the rationale.
  - (e) Set `minDiffPixels` to three times the measured signal. The self-check FAILs, which proves the floor votes. Revert.

  Commit the five paths with the message `test(visual): the kit scenario and its kit-mark layer check -- the gate can see the mark (WP-S3g plan 2 T7)`. The body states that CI's `visual` job will report `kit: no baseline entry` until the lead blesses from CI numbers after merge, as `aftermath` was, and that the `kit-mark` self-check votes meanwhile.

---

### Task 8: Docs

**Model:** sonnet.

**Files:**
- Modify: `CLAUDE.md`, `docs/PERFORMANCE.md`, `docs/superpowers/specs/2026-09-25-garage-uplift-design.md`

- [ ] **Step 1: `CLAUDE.md`.**
  - Under "The three.js backend", add one bullet on the kit mark. It covers:
    - what the mark is and where it draws (`OverlayBatch`, band 4, **not** `ChevronBatch`, R-1);
    - the measured +0 draw calls and 8 + 2L triangles, with Task 6's numbers and conditions;
    - that `unitKit` is per type, from `upgradePrepass`, the loop that also patches the sim's types and feeds the HUD card;
    - side 0 only, and zoom-scaled (D6);
    - **Pixi never**, pinned by a test (R-8);
    - that `kit-mark` is a flag layer (the `units` rule);
    - that `kit` is the only gated scenario with a kitted unit.
  - In "Dev instruments", add one sentence for `&kit` to the flag-reasoning list: it replaces the account's tiers, mission never, and the gate uses it because the gate's single page would carry a storage seed into every later scenario.
  - Change nothing else.
- [ ] **Step 2: `docs/PERFORMANCE.md`.** Add a "Kit mark (WP-S3g plan 2)" section. It gives Task 6's table (calls, triangles and p95 per zoom, with run count and spread), the GPU string, the viewport, the DPR, the commit, and the arithmetic for 300 marked units (12,600 extra vertices a frame, in the batch already rebuilt every frame).
- [ ] **Step 3: The spec.** Update the status line to "plan 2 built on `feat/garage-tier-mark`". Under §8's plan 2 bullet, add one line naming R-1 (overlay batch, not atlas cells), R-2 (10 × 12) and R-4 (the `&kit` flag), and pointing to this plan's Rulings.
- [ ] **Step 4: Check the numbers, and falsify.** For every figure quoted in `PERFORMANCE.md` and `CLAUDE.md`, run a one-line check against `.superpowers/garage-mark/t6/kit-report.json`: `node -e` reading both and asserting each quoted number appears in the report. Seen red: change one quoted digit, and the check names it. Revert.
- [ ] **Step 5: Commit** the three paths with the message `docs: the kit mark -- +0 draw calls measured, Pixi never, the kit scenario (WP-S3g plan 2 T8)`. If the lead lands docs from a main worktree instead (R-11), this commit's three hunks lift out whole.

---

## Out of scope

- **Kit parts on the meshes: plan 3, lane B (art), after the October Meshy credits.** It covers:
  - the kit numbers per vehicle (spec §6: at least 10% of hull plan area, at most 1 new primitive, target 0);
  - Blender kits for the eight vehicle types, the variant picked at load, and `validate:meshes` on variants;
  - `plates:units --kit` and the kitted plates;
  - the close-up rig and the 49 close-ups;
  - Meshy for genuinely new parts only, announced with a credit estimate first;
  - the lead's word on palette geometry inside the four textured Meshy vehicles (spec §9);
  - provenance and disclosure.
- **Pixi.** This is not deferred; it is a permanent property of that backend (R-8).
- **A screen-constant minimum size** for the mark. D6 is no.
- **Enemy kit, and per-instance kit.** Only the player's brigade buys kit (plan 1's `upgradePrepass`), and tiers are type-wide (brigade D3).
- **The HUD card's kit pips**, which plan 1 Task 13 already landed.
- **Spec §4 "Comparison"**, which is plan 1's open question 1.
- **The pre-existing overlay worst case.** Kill pips (2 × 48) and the air shadow (48) were never in `OVERLAY_VERTICES_PER_ENTITY`'s "114" arithmetic. A selected, grouped vehicle with both pips already exceeds 200 on its own and leans on the pooled slack. Task 3 records it and does not change the budget.
- **Filtered or mipmapped overlay minification at zoom 0.35.** It applies to the chevron, the numerals and the HP bars alike.
- **The bless.** The lead blesses from CI numbers after merge, not from this branch.
- **`packages/sim/**`, `renderer.ts` (Pixi) and `overlays.ts`**, which stay byte-identical.

## Self-review

**Spec coverage.**

| Spec item | Task |
|---|---|
| §2 goal 1: kit is visible on the map | 3 (draw), 5 (wired), 6 (seen at three zooms) |
| §2 goal 4: two registers apart (gold chevron vs steel plate) | 1 (`gunmetal.0` / `shadow.0`, a plate not a chevron), 3 (both on one veteran, side by side) |
| §3.4 `RendererOptions.unitKit: Record<typeId, 0\|1\|2\|3>` | 2 |
| §3.4 "the sim is untouched; Pixi ignores it" | Global Constraints (byte-identical checks), 2 (Pixi pin) |
| §3.4 A: +0 draw calls per unit | 3 (in `OverlayBatch`), 6 (`renderer.info`, Δcalls = 0 asserted) |
| §3.4 A: legibility 3.5 / 10 / 25 px at 0.35 / 1 / 2.5 | 1 (N9 pinned), 6 (measured blob sizes, ×8 crops) |
| §3.4 placement (0, r+16), clear of badge, chevron and HP bar at r = 7 and 11; side 0 only | 1 (clearances; R-3's r + 17 for the taller box), 3 (side guard) |
| §3.4 the HUD card as the low-zoom read | plan 1 T13 (landed); R-9 |
| §5 kit overlay atlas cells, "built like `buildChevronTexture`" | **replaced** by 1's pure triangle geometry (R-1) |
| §6 kit colour, overlay mark size, bars, on-screen sizes, kit level | 1 (N2–N9; N3 changed to 10 × 12 by R-2, for the lead) |
| §8 plan 2: unitKit and the app feed | 2, 4, 5 |
| §8 plan 2: atlas cells, overlay draw and placement, colour through `resolveColor` | 1, 3 (R-1, R-7) |
| §8 plan 2: a `kit` debug layer with a visible-toggle check | 3 (`kit-mark`), 7 (gated check, a third of the smallest of three runs) |
| §8 plan 2: draw calls measured unchanged (`renderer.info`) | 6 |
| §8 plan 2: captures at 0.35 / 1 / 2.5 | 6 (G-P) |
| §8 plan 2: docs | 8 |
| §9 "the golden gate cannot see the mark" | 5 (`&kit`), 7 (`kit` scenario, R-4, R-6) |
| D1, D2, D3, D6 | 3, 4 (one level from `kitSummary.level`), 1, 1 and 6 |

**Every check has an input that makes it fail**, named in its task:
- Task 1: 6
- Task 2: 3
- Task 3: 7
- Task 4: 4
- Task 5: 3 (two in the browser)
- Task 6: 4 (one in the browser)
- Task 7: 5 (two in the browser)
- Task 8: 1

**Type consistency.**
- `MarkPoint`, `KitMarkLevel`, `KIT_MARK`, the colour keys, `kitMarkTriangles` and `kitMarkVertexCount` (Task 1) are consumed by Task 3 by name. Task 6 reads `KIT_MARK`'s box as text, because `tools` may not import `@lions/render`.
- `kitLevelsByType` (Task 2) is `ThreeRenderer.kitLevelOf`'s only builder (Task 3).
- `RendererOptions.unitKit`'s inline `0 | 1 | 2 | 3` (Task 2) is assigned from `UpgradePrepass.unitKit: Record<string, KitLevel>` (Task 4) in `main.ts` (Task 5). The two unions are identical, and `pnpm typecheck` is the guard.
- `SANDBOX_KIT_LEVELS` (Task 4) is read by Task 7's framing test and Task 6's expectations.
- `bootTiers` (Task 4) is `main.ts`'s one call site (Task 5).
- `DEBUG_LAYERS`' `'kit-mark'` (Task 3) is read as text by `baseline.test.ts`'s existing "names only layers the renderer can toggle", which covers Task 7's declaration.

**Placeholder scan.**
- Four values are set by measurement, and each says how:
  - Task 3's `soup.count` per unit (198, with the rule for correcting it);
  - Task 7's floors (a third of the smallest of three runs);
  - Task 7's noise thresholds (at least ten runs, stop if outside `vehicle`'s band);
  - Task 6's p95 (reported with its spread, no invented threshold).
- Task 6's browser half is specified step by step rather than written out. It is harness code in `ground-captures.ts`'s established shape, and every vote and exit code is named.
- No TBD remains.

**Model tiering.**
- **Opus:** Task 1 (the overlay's geometry and the gate) and Task 3 (`ThreeRenderer.ts`), plus the final whole-branch review.
- **Sonnet:** Tasks 2, 4, 5, 6, 7 and 8, each with its tests written out.

Nothing inherits opus by default.

## Execution order

0 → 1 (**G-N**) → 2 → 3 → 4 → 5 → 6 (**G-P**) → 7 → 8, serially, on this one branch.

- Task 1 waits for the lead's numbers. Nothing is committed before G-N.
- Tasks 2 and 4 are independent: render versus app. They stay serial anyway, because parallel agents race on the git index.
- Task 3 is the only task in `ThreeRenderer.ts`. If Task 0 found the lane held, run 1 → 2 → 4, and hold 3 until the lane is free.
- Task 5 follows Task 3 on purpose. Its browser falsification (drop the feed and watch every mark vanish) needs a renderer that draws.
- Task 7 waits for G-P. Its scenario makes the approved picture the gate's reference, and an unapproved picture must not become one.
- Tasks 1–3 are the renderer floor, drawing only for a caller that passes `unitKit`. Tasks 4–5 turn it on. Tasks 6–8 prove it, gate it and write it down.
