# Field works: KDF constructible buildings and militia equivalents (FW, #277). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Engineers raise four KDF support buildings anywhere on open ground, paid in mission logistics and built under fire:
- a medic station;
- an outpost;
- an intel centre;
- a workshop.

Mission authors place four militia equivalents as targets and positions. The enemy never builds.

**Spec:** `docs/superpowers/specs/2026-09-29-field-works-design.md`. §9 (G-NUM), §6 treatment B (G-MOCK) and the Q1–Q16 answers are binding. Section numbers below (§n) are the spec's.

**Architecture:**
- **Placement is a command (invariant 4).**
  - `MissionRuntime.requestConstruct` checks the allow list, the count, the unlock, the price, the builders and `sim.placementReason`.
  - It then queues `construct`. The sim re-checks at `applyCommands`.
  - A site becomes a structure when it is **staked** (Q4), and completes by `stProgress`.
- **One data concept: an `aura` block on a structure type,** with three scopes:
  - `area`, a list, read by the new `stepAuras`;
  - `garrison`, read at the call sites through `garrisonedIn`;
  - `sensor`, a second observer loop in `stepDetection`.

  A new building is JSON.
- **Pathing reuses collapse.** Staking calls `addStructure`, cancelling calls the new `removeStructure`, and a wreck calls `destroyStructure`. Each does one `recomputeFields`, which Task 3 measures first.
- **Render and app:**
  - a gridded footprint pad and dashed aura rings, through the existing `OverlayBatch.dashedEllipseRing` (#281);
  - a "Field works" group in the reinforcements dock;
  - a HUD status chip. No world status marks.

**Tech stack:** TypeScript strict, vitest, JSON Schema (ajv 2020), `tools/validate_data.mjs`, headless Blender and the Meshy CLI (Task 12 only). No new dependencies.

**Base:**
- Branch `feat/field-works`, cut from `main` at Stage 4 kickoff.
- Worktrees under `/Users/ilpinto/dev/roaring-lions-ep/fw-*` (see "Worktrees").
- Run `pnpm install` once per worktree.
- Line numbers in the spec have drifted since `9623d500`. Locate code by symbol, never by line.

---

## Prerequisites and lead decisions (before Task 1)

- **P1, #281.** `OverlayBatch.dashedEllipseRing` and `DashedRingStyle` must be on `main`:
  `grep -n "dashedEllipseRing(" packages/render/src/three/units/overlays.ts`.
  Task 9 does not start without them. It inherits #281's open "fog dims the ring" ruling, whatever the lead decides.
- **P2, E6 (#274).** The placed charge also extends the per-structure SoA and moves the hash. One sim-guard stream runs both (spec R6).
  - The lead orders them at kickoff.
  - Whichever lands second rebases onto the other's re-pin, and re-pins once more with its reason.
- **L1, #280's shape** (Q16, "#280 decides"). Two options:
  - **(a) Recommended: the field.** `aura.garrison.supp_cover`, absent by default, so every shipped building keeps today's rule. No hash move, and `playtest` stays byte-identical.
  - **(b) A sim-wide rule.** Occupants read their structure's protection. This moves `playtest`, and the golden hash if the golden replay garrisons.

  Under (b), Task 1 grows a step: the per-type values, and the `playtest` agent's re-pin.
- **L2, the Meshy spend.** 210 credits planned, 420 ceiling (§8), from the October credits. Task 12 Step 2 waits on it.
- **L3, construction states.** 4 KDF construction states, not 8: militia works are never built. Zero credits either way.
- **L4, construct carriers.** `beit_sahwan_2_foothold`, `deir_amun_2_foothold` and `khan_rafid_2_foothold` field no `demo_squad` in `starting_force`. The options:
  - add one (this moves their `playtest` lines at Task 15);
  - or accept that a fresh campaign cannot build there until `demo_squad` unlocks (R8).
- **L5, Tel Marum.** No militia OP in `tel_marum_3_clearance` without the `fw-op-saddle` probe **and** a lead design call (§5).

---

## Global Constraints

- **The four invariants** (CLAUDE.md):
  1. **20 Hz fixed tick.** The aura cadence is `tickCount % AURA_CADENCE_TICKS === 0`, never frame time.
  2. **Q16.16 only in `@lions/sim`.** No `Math.*` or `Date.*` (lint enforces it). JSON floats cross into fixed point once, at load, through `fx.from`: the sanctioned boundary.
     - Refund arithmetic is integer: `(cost * (ONE - progress)) >> 16`.
     - `buildStep` is `(ONE / (build_time_s * 20)) | 0`.
  3. **Per-entity PRNG.** Construction draws no random numbers. Builder choice, displacement and tie-breaks go by lowest id.
  4. **Commands in, events out.** The app reaches the sim only through `MissionRuntime.request*`, and reads through read-only views plus the pure `placementReason`.
     - The render never writes sim state.
     - The feed and the chips are driven by events and state reads.
- **Determinism hash re-pin rules:**
  - Two golden pins live in `packages/sim/src/determinism.test.ts`: the flat replay (`2109596329`) and the relief replay (`1425295494`). Find them with `grep -n "hash()).toBe(" packages/sim/src/*.test.ts`.
  - **Task 2 is the one planned move of both.** It lands in the commit that adds the hashed arrays, with a dated comment giving the reason and `Was <n>.`, in the file's existing style.
  - **Tasks 1 and 3–7 must leave both pins unmoved.** No shipped content uses field works, so a move means an FW path is live without FW content. That is a bug to find, never a re-pin. The one exception is L1 = (b) at Task 1.
  - **Every new hashed array gets a coverage test.** `hash covers <name>` flips one element and expects a different hash. The mutation is deleting its `hashArray` line.
  - `pnpm test:determinism` runs before every commit that touches `packages/sim`.
- **Balance and playtest:**
  - **`pnpm balance`** is byte-identical to `main` at every task: it names six unit ids and no structures. Diff it against a `main` run kept in the session scratchpad. A difference stops the task.
  - **`pnpm playtest`** is byte-identical through Task 14. Task 15 is its planned move: the `playtest` agent re-runs each adopting mission's plan ladder, and re-pins `LADDER_CREDITS` and `GATES` only with a reason. The one other move is L1 = (b).
- **No colour literals:**
  - UI uses semantic tokens and `color-mix()` only; `pnpm validate:ui` has no allowlist.
  - Render colours are palette keys through `overlayColor(KEY, FALLBACK)`, the refuge ring's pattern. Each new fallback hex is pinned equal to `data/palette.json` by a test.
  - The new keys: `team.kedem` (pad and aura ring), `team.hostile` (invalid pad), `dust.6` (tunnel ring; `dust` has seven entries).
- **`three` imports only under `packages/render/src/three/**`.** Eslint does not catch subpath imports such as `three/addons/...`, so keep those inside by discipline.
  - `packages/app` never imports `three`.
  - The Pixi `renderer.ts` stays frozen: new `Renderer` seam members are optional and Pixi ignores them.
- **`units/render-order.ts` is the single source of `renderOrder`.**
  - The pad, the aura rings and the tunnel ring join band 4 (`OVERLAY_RENDER_ORDER`) through `OverlayBatch`. No new band.
  - Task 9 adds them to that file's band-4 row.
  - The construction mesh is a building (`WORLD_RENDER_ORDER`, -1), like every mesh building.
- **No status marks in the world.** Radii show only while placing, hovered or selected. Status goes on the HUD unit card.
- **Every check is seen red.** Each task names its mutations. The commit message quotes the red line.
- **Strict TypeScript.** No `any`, and no non-null assertions in sim code. Tests are colocated as `*.test.ts`. Struct-of-arrays in the hot loop, with no per-tick allocation.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data`. Each task adds its own.
- **Git** (house rules):
  - Stage explicit paths: `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, and never `git checkout -- <file>`.
  - End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Do not push; the lead merges. Never `pkill` vite.

---

## Worktrees and lanes

| worktree | lane | tasks | touches | parallel with |
|---|---|---|---|---|
| `fw-sim` | C (sim-guard) | 1 → 2 → 3 → 4 → 5 → 6 → 7, strictly in order | `packages/sim/**` only | all of the rows below |
| `fw-data` | C (data) | 8 | `data/schemas`, `data/structures.json`, `data/units/kdf/{demo_squad,dozer_d9}.json`, `tools/validate_data.mjs` | everything; merges after 7 |
| `fw-render` | A | 9, then 13 | `packages/render/**`; 13 also `app/src/mesh-catalogue.ts`, `art/meshes/buildings/**` | 1–8, 10–12 |
| `fw-app` | A | 10 → 11 | `packages/app/src/{ui,i18n,main.ts,sandbox-help.ts}` | 1–9, 12 |
| `fw-art` | B | 12 | `art/meshy/**`, `art/blend/**`, `tools/units/rig.py`, `docs/ASSET_PROVENANCE.md` | everything (October onward) |
| `fw-main` | — | 14 → 15 → 16 | `tools/src/backtest/**`, `data/missions/**`, docs | after every row above merges |

- **Why lane C is one stream.** Tasks 1–7 all edit `sim.ts`. So do E6's tasks (P2).
- **Merge order constraints:**
  - Task 10 codes against the Task 5 interfaces below. It may start from them, but merges after 5.
  - Task 11 needs 5, 8, 9 and 10.
  - Task 13 needs 4 and 12.
- **Shared file:** `en.json` is touched by 10 and 11 only, which run in the same worktree.

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/structures.ts` (+`structures.test.ts`) | `StructureTypeJson`/`StructureType`: `side`, `aura`, `buildable`; the parse | 1, 2, 4, 6, 7 |
| `packages/sim/src/sim.ts` | FW state block, targeting, `removeStructure`, construction, `stepAuras`, the sensor | 1–7 |
| `packages/sim/src/tuning.ts` | `AURA_CADENCE_TICKS`, `MAX_SITES`, `MAX_BUILDERS`, `STAKE_HP_FRAC` | 2, 4, 6 |
| `packages/sim/src/mission.ts` (+`mission.test.ts`) | `structures[].side`, `field_works`, `requestConstruct`, `constructReason`, refunds, the `works` event | 2, 5 |
| `packages/sim/src/{garrison,construct,auras,sensor}.test.ts` | **New.** Per-system specs | 1, 4, 6, 7 |
| `packages/sim/src/determinism.test.ts` | The Task 2 re-pin and the hash-coverage tests | 2 |
| `tools/src/perf/recompute-fields.ts`, `docs/PERFORMANCE.md` | **New.** `pnpm perf:recompute`, and the measured row | 3 |
| `data/schemas/{structure,mission,unit}.schema.json`, `data/schemas/common.schema.json` | Schema additions; `unlock` hoisted to shared `$defs` | 8 |
| `data/structures.json`, `data/units/kdf/{demo_squad,dozer_d9}.json`, `tools/validate_data.mjs` | Eight types, `construct`, the validator rules | 8 |
| `packages/render/src/api.ts`, `three/ThreeRenderer.ts`, `three/units/overlays.ts` (+test), `three/units/render-order.ts`, `three/fog.ts` (+test) | Pad, aura rings, `extraObservers` | 9 |
| `packages/app/src/ui/{dock-model,production,works-model,mark}.ts` (+tests), `i18n/en.json` | Dock group and the pure placement model | 10 |
| `packages/app/src/main.ts`, `ui/hud.ts` (+test), `sandbox-help.ts` | Placement flow, works card, chips, feed, `&works` | 11 |
| `art/meshy/*`, `art/blend/buildings/*`, `tools/units/rig.py` | Sources, and the `demo_squad` `work` clip | 12 |
| `art/meshes/buildings/*.glb`, `app/src/mesh-catalogue.ts`, `three/units/{mesh-building,textured-building}.ts` (+tests) | Export and wiring, the construction state, the builder clip | 13 |
| `tools/src/backtest/field-works-probes.ts` (+test), `tools/src/fw_tunnel_radius.test.ts`, `docs/campaign/field_works/probes.md` | The §9 probes and bands | 14 |
| `data/missions/*.json`, `tools/src/backtest/playtest.ts` | Allow lists, militia placements, a `works` plan step | 15 |

---

## Task 1 (lane C): #280, garrison suppression cover

**Agent:** `sim-guard`, sonnet. **Depends:** L1. **Closes:** #280 (under L1 = (a)).

**Files:** `structures.ts`, `sim.ts` (`applySuppression`), new `garrison.test.ts`.

**Interfaces:**
```ts
// structures.ts: the minimal slice of the aura block; Task 6 widens it
export interface StructureGarrisonEffectJson { supp_cover?: number }        // integer 0-3
export interface StructureAuraJson { garrison?: StructureGarrisonEffectJson }
export interface StructureTypeJson { /* … */ aura?: StructureAuraJson }
export interface StructureType { /* … */ garrisonSuppCover: number }        // -1 = read the tile (today's rule)
// sim.ts applySuppression, coverProtects branch:
//   g = garrisonedIn[target];
//   cov = (g >= 0 && types[stTypeIdx[g]].garrisonSuppCover >= 0) ? that value : cover[tile]
```

- [ ] **Step 1: Write the failing tests** in `garrison.test.ts`. They use fixture types declared in the test, not `data/`.
  - A garrisoned occupant of a 2×2 whose type sets `supp_cover` 3 takes a suppression of `amount × suppResFactor × COVER_SUPP[3]`. Compute the expected value from the literal `0.09`, not from `COVER_SUPP` (the oracle rule).
  - Without the field, the occupant takes `× COVER_SUPP[0]`, the same as on `main`.
  - A non-garrisoned unit beside the building is unchanged.
  - `coverProtects = false` still ignores both (crew shock).
  - Scenario: 3 `inf_squad` in a 2×2 with `supp_cover` 3 against a light militia raid, over 10 fixed seeds. The garrison must kill more than 0. Without the field, it kills 0: #280's measured defect.
- [ ] **Step 2: Implement.** Parse with `json.aura?.garrison?.supp_cover ?? -1`.
- [ ] **Step 3: See it red.**
  - Drop the `g >= 0` guard: the neighbour assertion fails.
  - Read `cover[tile]` unconditionally: the 0.09 assertion fails.
- [ ] **Step 4: Gates.** Common gates, plus `test:determinism` (**unmoved**), `balance` and `playtest` (**byte-identical**). No visual bless. Under L1 = (b), add the per-type values and the `playtest` agent's re-pin as a second commit.

## Task 2 (lane C): the FW state block, owners, and owned-structure targeting (**the hash re-pin**)

**Agent:** `sim-guard`, opus (determinism review). **Depends:** 1, P2.

**Files:** `structures.ts`, `sim.ts`, `tuning.ts`, `mission.ts` (`raiseMissionStructures`), `determinism.test.ts`, `structures.test.ts`.

**Interfaces.** Declare **every** FW hashed array here, even those later tasks write:
```ts
// tuning.ts
export const MAX_SITES = 8;
export const AURA_CADENCE_TICKS = 10;   // N13
// structures.ts
StructureTypeJson.side?: -1 | 0 | 1;   StructureType.side: number   // default -1
// sim.ts, per structure (MAX_STRUCTURES)
readonly stSide = new Int8Array(MAX_STRUCTURES).fill(-1);
readonly stKnown = new Uint8Array(2 * MAX_STRUCTURES);         // [side*MAX_STRUCTURES + s], a latch
readonly stProgress = new Int32Array(MAX_STRUCTURES);          // ONE for every raised structure
// the site table (Task 4 writes it)
siteAlive: Uint8Array(MAX_SITES); siteType: Int16Array; siteX, siteY: Int32Array;
siteSide: Int8Array; siteStructure: Int32Array (fill -1)
// per unit (capacity); spawn initialises every column
buildSite: Int8Array (fill -1)                                  // Task 4
auraHealRate, auraHealCap, auraCompAt, auraRepairTicks: Int32Array; auraAccMult: Int32Array (fill ONE)  // Task 6
addStructure(typeIdx: number, tiles: readonly number[], opts?: { side?: number; progress?: Fx }): number
readonly structures: { /* existing */ side: Int8Array; progress: Int32Array };
readonly works: { alive: Uint8Array; type: Int16Array; x: Int32Array; y: Int32Array; side: Int8Array; structure: Int32Array };
// mission.ts MissionJson.structures[] item gains side?: -1 | 0 | 1  (overrides the type's)
```
`hash()` folds, after `stOccupants`: `stSide`, `stKnown`, `stProgress`, the six site columns, `buildSite`, then the five aura arrays.

- [ ] **Step 1: Write the failing tests.**
  - **Latch.** A side-1 structure is not in `stKnown[0]` until a side-0 unit has LOS to one of its footprint tiles within sight. It stays set after LOS is lost.
  - **Neutral structures** (-1) never latch.
  - **`selectStructureTarget`:**
    - it takes a living side-1 structure with `stKnown[0]` set, in the fallback slot only (no unit target);
    - it does not take the structure without the latch;
    - it does not take a `PROTECTED_ROE` side-1 type;
    - an unoccupied neutral house is still never shot.
  - **Runtime.** `structures: [{ type: 'house', at, side: 1 }]` raises `stSide` 1. With no `side`, it takes the type's default.
  - **Coverage.** `hash covers <array>` for each of the 14 arrays.
- [ ] **Step 2: Implement.**
  - The latch pass runs at the end of `stepDetection`, only for owned structures not yet known, and stops once set. It uses `detectionPair`'s `losRay`, with the structure as the ray's end structure.
- [ ] **Step 3: Re-pin both golden pins,** each with a dated comment:
  - it is FW (#277)'s state block;
  - every array is hashed now, so that Tasks 3–7 move nothing;
  - `stProgress` is ONE for every raised structure;
  - `Was 2109596329.` / `Was 1425295494.`
- [ ] **Step 4: See it red.**
  - Delete each `hashArray` line: its coverage test fails.
  - Drop the latch check in `selectStructureTarget`: "not without the latch" fails.
  - Drop the `PROTECTED_ROE` test: the protected case fails.
- [ ] **Step 5: Gates.** Common gates plus `test:determinism` (**moved, re-pinned here**). `balance` and `playtest` are byte-identical: the hash is not an output of either. No bless.

## Task 3 (lane C): measure the recompute; `removeStructure`; lazy invalidation if needed

**Agent:** `perf-analyst` for the measurement, `sim-guard` for the code; sonnet. **Depends:** 2.

**Files:** `sim.ts`, `structures.test.ts`, `flowfield.test.ts`, new `tools/src/perf/recompute-fields.ts`, `tools/package.json` (`"perf:recompute"`), `docs/PERFORMANCE.md`.

**Interfaces:**
```ts
/** Unblock without rubble, cover change, collapse shock or garrison kill; one recomputeFields.
 *  Throws if stOccupants[s] > 0 (nobody can be inside an unfinished building). */
removeStructure(s: number): void
```

- [ ] **Step 1: Measure.** `pnpm perf:recompute`:
  - fill all 128 fields (`MAX_FLOW_FIELDS`) on a 48×48 shipped map;
  - time `addStructure` of a 2×2 over 50 runs;
  - print the median and the p95.

  Record the row in `docs/PERFORMANCE.md` under "Sim tick cost". Timing lives in `tools/`, never in `sim`.
- [ ] **Step 2: Write the failing `removeStructure` tests.**
  - After the call, the tiles are open in both masks, `cover` is unchanged, there is no `structureDestroyed` event and no suppression nearby.
  - `destroyStructure` on the same footprint does write rubble. This is the contrast test.
- [ ] **Step 3: Lazy invalidation, only if the median is over 10 ms** (§2):
  - `recomputeFields` recomputes the fields some living unit's `fieldRef` points at;
  - it drops the rest from `fieldByGoal`, so `fieldFor` recomputes them on demand.

  Test: after a stake, every cached field equals a fresh `FlowField.compute` on `maskFor(d)`. A dropped field re-requested also equals a fresh one. Compare the Int32 arrays in full. If the median is 10 ms or less, record "not needed" with the number.
- [ ] **Step 4: See it red.**
  - Make `removeStructure` skip `syncVehicleTile`: a vehicle-mask assertion fails on a boulder map fixture.
  - Under lazy: skip recomputing a referenced field, and the equality test fails.
- [ ] **Step 5: Gates.** Common gates plus `test:determinism` (**unmoved**), `balance` and `playtest` (identical). No bless.

## Task 4 (lane C): construction in the sim

**Agent:** `sim-guard`, opus. **Depends:** 3.

**Files:** `sim.ts`, `structures.ts`, `tuning.ts`, new `construct.test.ts`, `tunnels.test.ts`.

**Interfaces:**
```ts
// UnitType
canConstruct: boolean;           // abilities.includes('construct')
constructRate: Fx;               // fx.from(json.construct_rate ?? 1)
// StructureType
buildable: { costLogistics: number; costIntel: number; buildStep: Fx; fw: number; fh: number } | null
// tuning.ts
export const BUILD_RANGE_SQ = DEMO_RANGE_SQ;  export const MAX_BUILDERS = 2;
export const STAKE_HP_FRAC = 6554;             // 0.1
// Command
| { kind: 'construct'; ids: number[]; structType: number; x: number; y: number }
| { kind: 'cancelConstruct'; site: number }
// SimEvent (add to the exhaustiveness guard)
| { kind: 'constructQueued'; tick: number; site: number; structType: number; x: number; y: number; builder: number }
| { kind: 'constructRefused'; tick: number; structType: number; x: number; y: number; reason: PlacementRefusal | 'no_site_slot' }
| { kind: 'constructStaked'; tick: number; site: number; structure: number }
| { kind: 'structureComplete'; tick: number; site: number; structure: number }
| { kind: 'constructCancelled'; tick: number; site: number; structure: number /* -1 unstaked */; progress: Fx }
export type PlacementRefusal = 'off_map' | 'blocked' | 'no_footing' | 'not_level' | 'overlap' | 'seals_passage';
placementReason(structType: number, tx: number, ty: number, side: number): PlacementRefusal | null  // pure
isConstructing(id: number): boolean   // contributed progress this tick; the render's `work` clip
```

**Rules, in order** (§1):
1. The footprint is inside the map. Every tile has `blocked === 0` (else `blocked`) and `boulder === 0` (else `no_footing`).
2. Every tile is at one `elevation` level (Q6).
3. No overlap with a structure **or a pending site**.
4. No seal (Q5):
   - label the foot mask's 4-connected open components with pending sites treated as blocked;
   - add the footprint and flood from one open 4-neighbour of it;
   - refuse if any open 4-neighbour sharing that pre-label goes unreached.
   - The scratch `Int32Array`s are preallocated on the `Sim`, never per call, and never hashed.

Roads, groves and knolls are allowed. Tunnels are not a rule.

**Lifecycle:**
- **On accept:**
  - write a site row;
  - set `buildSite[id] = site` for each builder, and move it to the nearest open tile 4-adjacent to the footprint through `fieldFor`;
  - any later order to that id clears `buildSite`.
- **Staking** happens on the first builder within `BUILD_RANGE_SQ` of a footprint tile centre:
  - it waits while any living surface enemy or civilian stands on the footprint;
  - a friendly non-builder is moved to the nearest open tile (the `exitTile` rule);
  - then `addStructure(…, { side, progress: 0 })` with `stHp = stMaxHp × STAKE_HP_FRAC`.
- **Each tick after staking:**
  - up to `MAX_BUILDERS` qualifying builders, lowest id first: alive, in range, not moving, not pinned, not garrisoned;
  - each adds `fx.mul(buildStep, constructRate)`;
  - HP rises by `stMaxHp × 0.9 × delta`, capped at max;
  - at `stProgress >= ONE`: clamp to ONE, emit `structureComplete`, free the site row.
- **Garrison** into a structure with `stProgress < ONE` is refused.
- **Cancel:**
  - unstaked: free the row;
  - staked: `removeStructure`, and emit `progress`;
  - complete: ignored.
- **A wreck** frees the row through `destroyStructure`, which is unchanged.
- **Vent fix (Q7):** `stepSurfacing` writes a vent position under a standing structure as `exitTile(s)` instead.

- [ ] **Step 1: Write the failing tests** (`construct.test.ts`).
  - **Placement:** each refusal code on a constructed 12×12 fixture. The seal fixture is a 2-wide corridor that a 2×2 closes. A pending site counts for overlap and for sealing. A road tile is allowed.
  - **Staking:**
    - tiles are not blocked before a builder arrives (Q4);
    - staking calls `recomputeFields` exactly once (spy);
    - an enemy on the pad delays staking, and a friendly one is displaced.
  - **Progress,** with the expected ticks computed by hand in a comment from integer `buildStep`, never by calling it:
    - medic 20 s, 1 builder: 403 ticks;
    - 2 builders: 202;
    - D9 at ×1.5: 269, if `fx.mul` truncates. Pin whatever the hand arithmetic says.
    - A third builder adds nothing. A pinned, moving or garrisoned builder adds nothing.
    - Progress persists when the builder dies, and a second engineer resumes.
  - **Cancel:** unstaked, and staked at a progress of 0.9 (the event carries `progress`, and the tiles open).
  - **Refusal:** two overlapping `construct` commands in one frame: the second is refused with `overlap`.
  - **Wreck mid-build:** rubble appears and the row is freed.
  - **Vent:** a vent under a standing 2×2 surfaces its fighters at `exitTile` (in `tunnels.test.ts`).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.**
  - Drop the pending-site term from rule 3: the overlap test fails.
  - Skip the seal flood: the corridor test fails.
  - Use `<=` for `MAX_BUILDERS`: the third-builder test fails.
  - Stake at order time: the Q4 test fails.
- [ ] **Step 4: Gates.** Common gates plus `test:determinism` (**unmoved**), `balance` and `playtest` (identical). No bless.

## Task 5 (lane C): the runtime (`requestConstruct`, allow list, refunds, events)

**Agent:** `sim-guard`, sonnet. **Depends:** 4.

**Files:** `mission.ts`, `mission.test.ts`.

**Interfaces.** These are frozen here, and Task 10 codes against them:
```ts
// MissionJson
field_works?: Record<string, number>;                       // type id → max (default 1 where listed; schema max 2)
export type WorksRefusal = 'not_listed' | 'none_left' | 'locked' | 'unaffordable' | 'needs_engineers' | PlacementRefusal;
export interface WorksOffer { typeId: string; name: string; max: number; left: number; logistics: number; intel: number }
worksOffers(): readonly WorksOffer[];                        // [] when field_works is absent
constructReason(typeId: string, tx?: number, ty?: number): WorksRefusal | null   // pure; no tile = the dock tile's state
requestConstruct(typeId: string, tx: number, ty: number, builders?: readonly number[]): boolean
requestCancelWorks(site: number): boolean
// MissionEvent (and MissionEventKindsAreExhaustive)
| { kind: 'works'; tick: number; phase: 'started' | 'complete' | 'destroyed' | 'cancelled' | 'refused';
    typeId: string; site: number; builder: number; refund: number }
```

- **Builders:**
  - the passed ids that are `canConstruct`, alive, side 0 and on the surface;
  - otherwise the nearest idle carrier to the footprint centre, ties by id;
  - otherwise `needs_engineers`.
- **Costs:** the price and one count are deducted on request. `refused` and `cancelled` return the count. The refund is `(cost × (ONE − progress)) >> 16`, which is 100% unstaked.
- **Unlock:** `buildable.unlock` goes through `unlockReason`, as in `buildBlockedReason`.
- **Destroyed:** a `structureDestroyed` event on a side-0 works structure maps to `works destroyed`.
- **ROE:** a works type has `roe_penalty` 0, so the ROE branch charges nothing when the player levels its own.

- [ ] **Step 1: Write the failing tests.**
  - `field_works` absent: `worksOffers()` is `[]`, and every request is `not_listed`.
  - With 1 allowed: the second request is `none_left`, and a cancel restores it.
  - `locked`, `unaffordable` and `needs_engineers` each on a fixture.
  - Refunds, as integer literals:
    - a 90%-built outpost (progress `58982`) refunds exactly **35** (N10);
    - an unstaked site refunds the full 350;
    - a refused command refunds the price and the count.
  - An own works wreck charges 0 ROE.
  - A contact with `observer: -1` credits nobody. This is Q10, already guarded by `mission.ts`'s `observer >= 0`. Pin it.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.**
  - Compute the refund with `fx.mul`: 35 still passes, so also pin the 30% case (245) and the 1-tick case.
  - Skip the count restore on refusal: its test fails.
- [ ] **Step 4: Gates.** Common gates plus `test:determinism` (**unmoved**), `balance` and `playtest` (identical). No bless.

## Task 6 (lane C): the `aura` parse, `stepAuras`, heal/repair/components/accuracy, garrison range and sight

**Agent:** `sim-guard`, opus. **Depends:** 5.

**Files:** `structures.ts`, `sim.ts` (`stepAuras` between `stepGarrison` and `stepUpkeep`; `stepUpkeep`; `hitFactors`; `selectTarget`; the falloff; `detectionPair`), new `auras.test.ts`, `garrison.test.ts`.

**Interfaces:**
```ts
export interface AreaEffectJson { radius: number; affects: 'foot' | 'vehicle' | 'any'; heal_per_s?: number;
  heal_cap?: number; repair_per_s?: number; repair_components_s?: number; accuracy_mult?: number }
StructureAuraJson += { area?: AreaEffectJson[]; garrison?: { range_bonus?; sight_bonus?; supp_cover? } }
interface AreaEffect { radiusSq: Fx; affects: 0 | 1 | 2; healRate: Fx; healCap: Fx; compTicks: number; accMult: Fx }
StructureType.aura: { area: AreaEffect[]; rangeBonus: Fx; sightBonus: Fx } // supp_cover stays garrisonSuppCover
// load: healRate = fx.from((heal_per_s ?? repair_per_s) / TICKS_PER_SECOND)  // 0.010 → 33 raw; 0.0075 → 25
```

- **`stepAuras`,** run when `tickCount % AURA_CADENCE_TICKS === 0`:
  - Reset every unit: rate 0, cap 0, `compAt` 0, `accMult` ONE.
  - For each structure with `stAlive`, `stProgress === ONE` and `stSide` in {0, 1}, for each area effect, for each unit that is:
    - of the owner's side, alive, on the surface, not garrisoned, not carried, not air;
    - in the matching domain;
    - within `radiusSq` of the centroid;

    take the **max** of rate, cap and `accMult`, and the **min non-zero** of `compTicks`.
- **`stepUpkeep`,** after `REGEN_DELAY_TICKS`:
  - `rate = max(REGEN_FRAC × hp, auraHealRate × hp)` and `cap = max(REGEN_CAP, auraHealCap)`.
  - If `auraCompAt[i] > 0` and the unit took no damage this tick, `auraRepairTicks++`; otherwise reset it.
  - At `>= auraCompAt`, clear `mobilityKilled` and `firepowerKilled`.
- **`hitFactors`:** `accuracy × (1 + vet × VET_ACC_BONUS) × auraAccMult`, capped at ONE.
- **Garrison.** When `garrisonedIn >= 0` and the weapon is not in `INDIRECT_MASK`:
  - range is `(w.range + rangeBonus)²` at the call site;
  - the falloff reads the bonused effective range;
  - sight in `detectionPair` is `(sight + sightBonus)²`.
- **Exposure.** Expose `auraHealRate` and `auraCompAt` on the read-only state view for the HUD chip.

- [ ] **Step 1: Write the failing tests** (every constant from a literal):
  - **Conversions:** the medic rate is 33 raw, the militia clinic's 25, and ×1.06 is 69468.
  - **Medic:**
    - an `inf_squad` at 30% inside radius 4 waits 200 ticks, then heals at 33/tick×hp to full;
    - outside the radius it caps at 0.7 at the field rate;
    - a vehicle in the medic radius gets field regen only;
    - two overlapping medics give the same rate as one;
    - no effect while `stProgress < ONE`, after destruction, for the other side, or for a garrisoned unit.
  - **Cadence:** a unit entering the radius at tick 10k+1 gets the rate at 10k+10, not before.
  - **Workshop:**
    - a Lavi at 30% reaches full on the tick computed by hand;
    - `mobilityKilled` clears after 600 covered, undamaged ticks, and a hit at tick 599 restarts the count;
    - an air unit is excluded.
  - **Accuracy:** a vet-0 unit in a ×1.06 area has the same `hitFactors.accuracy` as a vet-1 unit outside it ("one veterancy level"), and it is capped at ONE.
  - **Garrison:**
    - a rifle (range 8) garrisoned with +1 selects a target at 8.5 tiles, and ungarrisoned it does not;
    - a garrisoned mortar gets no bonus;
    - with sight +2, a garrisoned squad detects at 9.5 tiles;
    - with +0.5, the militia firing position reaches 7.5 and not 8.
- [ ] **Step 2: Implement.** No per-tick allocation: the effects are flat arrays built at load.
- [ ] **Step 3: See it red.**
  - Sum instead of max: the overlap test fails.
  - Drop the progress guard: the unfinished test fails.
  - Include indirect weapons: the mortar test fails.
  - Convert through `fx.div`: 32 ≠ 33.
  - Drop the air exclusion: the air test fails.
- [ ] **Step 4: Gates.** Common gates plus `test:determinism` (**unmoved**), `balance` and `playtest` (identical). No bless.

## Task 7 (lane C): sensor structures (units and tunnels)

**Agent:** `sim-guard`, opus. **Depends:** 6.

**Files:** `structures.ts`, `sim.ts` (`stepDetection`, the tunnel route loop, `detectionPair` refactor), new `sensor.test.ts`, `tunnels.test.ts`.

**Interfaces:**
```ts
StructureAuraJson += { sensor?: { sight: number; optics: number; tunnel_radius?: number } }
StructureType.aura.sensor: { sightSq: Fx; optics: Fx; tunnelRadiusSq: Fx } | null
private readonly stRouteMask = new Uint16Array(MAX_STRUCTURES);  // cached at completion; NOT hashed (derived from immutable tnTiles)
// SimEvent 'contact' and 'tunnelContact' gain: observerStructure?: number   (observer === -1 when structure-sourced)
private detectionFrom(ox: Fx, oy: Fx, oSide: number, sightSq: Fx, optics: Fx, originStructure: number, tgt: number): DetectionDebug
```

- `detectionPair(obs, tgt)` becomes a thin call to `detectionFrom`. For units it must be bit-identical, and both golden pins unmoved prove it.
- A second observer loop runs over complete sensor structures of sides 0 and 1. It feeds the same `contact` array, with `bestObserver` −1 and the structure id kept for the event.
- **Routes,** on completion: set bit `r` of `stRouteMask` if any `tnTiles` tile lies within `tunnelRadiusSq` of the centroid. There is **no LOS test**.
- **Route loop order:** the sensor mask → `identifyTunnelTo(s, r, -1)` with `observerStructure`; else `markerSeeingRoute`; else the spoil ladder.
- **Held, not latched:** after the structure falls, contact decays down the existing ladder.

- [ ] **Step 1: Write the failing tests.**
  - An intel centre (sight 10, optics 1.0) identifies a still militia in cover 2 at 9 tiles. Pin the measured tick, spec ≈ 27 s. It never sees at 10.5.
  - An unfinished or destroyed centre sees nothing.
  - The contact event has `observer: -1` and `observerStructure: s`.
  - **Tunnels:**
    - a route tile at 9.9 tiles behind a `^` ridge is identified on the first tick after completion;
    - one at 10.1 is not;
    - after the centre's destruction the state reaches `lost` within the ladder's tick count (≈322; compute it from the constants in a comment).
  - **Militia OP** (sight 9, optics 1.2, no tunnel radius): a side-1 mortar engages a KDF squad that only the OP sees. That is the `INDIRECT_MASK` side identification: a spotter with no new rule.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.**
  - Add a `losRay` to the route path: the ridge test fails.
  - Set `observer = s`: the observer test fails.
  - Drop the progress guard: the unfinished test fails.
  - Latch the route: the decay test fails.
- [ ] **Step 4: Gates.** Common gates plus `test:determinism` (**unmoved**, the refactor's proof), `balance` and `playtest` (identical), and `perf:units` at 300 (sensor cost ≤ 0.05 ms, §7). No bless.

## Task 8 (lane C, data): schemas, `structures.json`, carriers, validator rules

**Agent:** `content-validator`, sonnet. **Depends:** the Task 2/4/6/7 field names (above). It may run in parallel with Tasks 3–7, and merges after Task 7.

**Files:** `data/schemas/{structure,unit,mission}.schema.json`, new `data/schemas/common.schema.json`, `data/structures.json`, `data/units/kdf/demo_squad.json`, `data/units/kdf/dozer_d9.json`, `tools/validate_data.mjs`.

- **`structure.schema.json`:** `side`, `buildable`, `aura` with `$defs` `area_effect` / `garrison_effect` / `sensor_effect`, and `construction_mesh`, exactly as §4 with its ranges.
  - Hoist `unlock` from `unit.schema.json` into `common.schema.json#/$defs/unlock` and register it with ajv. Never duplicate it.
- **`unit.schema.json`:** `construct` in the ability enum, and `construct_rate` (0.5–2, default 1).
  - `demo_squad` gains `construct`;
  - `dozer_d9` gains `construct` and `construct_rate: 1.5`.
- **`mission.schema.json`:**
  - `field_works` (`additionalProperties: integer 0–2`);
  - `structures[].side` (−1/0/1).
- **`structures.json`, eight types, with §9's numbers verbatim:**

  | id | symbol | side | HP/tile | slots | cost / time | aura |
  |---|---|---|---|---|---|---|
  | `kdf_medic_station` | M | 0 | 200 | 0 | 250 / 20 s | area foot r4, heal 0.010, cap 1.0 |
  | `kdf_outpost` | O | 0 | 400 | 3 | 350 / 30 s | garrison +1 / +2 / `supp_cover` 3 |
  | `kdf_intel_centre` | I | 0 | 250 | 0 | 400 / 40 s | sensor 10 / 1.0 / tunnel 10 |
  | `kdf_workshop` | W | 0 | 300 | 0 | 300 / 30 s | area vehicle r4, repair 0.010, components 30; area any r4, ×1.06 |
  | `militia_field_clinic` | C | 1 | 200 | 0 | — | area foot r3, heal 0.0075, cap 1.0; `roe_penalty` 6 |
  | `militia_firing_position` | F | 1 | 300 | 3 | — | garrison +0.5 / +1 / `supp_cover` 3 |
  | `militia_observation_post` | P | 1 | 300 (1×1) | 0 | — | sensor 9 / 1.2 |
  | `militia_weapons_workshop` | X | 1 | 300 | 0 | — | area vehicle r4, repair 0.0075, components 45; area any r4, ×1.06 |

  Every KDF type has `roe_penalty` 0 and `footprint` [2, 2].
- **`validate_data.mjs` rules**, each with a named red fixture:
  1. `buildable` requires `side` 0.
  2. Each `field_works` key is a `buildable` type.
  3. A mission with `field_works` fields a `construct` carrier in `starting_force` (a warning for production-only, per R8/L4).
  4. **No type with `aura.sensor.tunnel_radius > 0` in a mission that authors a `digs` or `in_tunnel` placement.** This is the lead's rule, keyed on the field rather than the id.
  5. The new symbols are neither terrain symbols nor used by any shipped map row.

- [ ] **Step 1:** Add the fixtures and see rules 1–5 red; then add the content.
- [ ] **Step 2: Gates.** `validate:data`, common gates, `balance` (identical: abilities are unpriced), and `playtest` (identical: no mission lists works). `validate:meshes` and `validate:assets` must still pass with the new ids unwired. If either demands a `BLD_<ID>` sheet, stop and raise it; do not exempt it silently. No bless.

## Task 9 (lane A, render): the footprint pad, dashed aura rings, fog observers

**Agent:** `render-vfx`, sonnet. **Depends:** P1 only. It may start on day 1.

**Files:** `packages/render/src/api.ts`, `three/ThreeRenderer.ts`, `three/units/overlays.ts` (+test), `three/units/render-order.ts`, `three/fog.ts` (+test).

**Interfaces:**
```ts
// api.ts: optional on the seam (Pixi frozen and ignores them); main.ts writes them unconditionally
export interface PlacementPreview { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly valid: boolean } // tiles, top-left
export interface AuraRingView { readonly cx: number; readonly cy: number; readonly radius: number; readonly style: 'dashed' | 'dotted' } // tiles
placementPreview?: PlacementPreview | null;
auraRingPreview?: readonly AuraRingView[];
// overlays.ts
export const AURA_RING_STYLE: DashedRingStyle = { widthPx: 2, dashPx: 7, gapPx: 5 };  // REFUGE_RING_STYLE's lengths
export const AURA_RING_EDGE_STYLE: DashedRingStyle;     // the refuge under-stroke pattern, measured necessary on sand
export const AURA_TUNNEL_RING_STYLE: DashedRingStyle = { widthPx: 2, dashPx: 2, gapPx: 4 };
export const AURA_TUNNEL_RING_OFFSET_PX = 4;            // outside a coincident sight ring (§6.3)
export const AURA_RING_ALPHA = 0.7; export const PAD_ALPHA = 0.38; export const PAD_INVALID_ALPHA = 0.6;
export const AURA_RING_COLOR_KEY = 'team.kedem'; export const AURA_TUNNEL_RING_COLOR_KEY = 'dust.6';
export const PAD_INVALID_COLOR_KEY = 'team.hostile';
export function padGridLines(x: number, y: number, w: number, h: number): readonly [WorldPoint, WorldPoint][] // (w+1)+(h+1) lines
// fog.ts
FogInput.extraObservers?: readonly { x: number; y: number; sight: number }[]   // tiles
```

- **Rings** draw through **`OverlayBatch.dashedEllipseRing`** only: no new primitive, and none of `ellipseRing` or `ellipseAnnulusFill`. They go after the refuge ring, under-stroke first, radius through `tileRadiusToEllipsePx`.
- **The pad** is `lineWorld` segments from `padGridLines`: the tile grid, flat, with no volume and no fill (treatment B).
- **Fog.** `recomputeFog` fills `extraObservers` from `this.sim`:
  - complete side-0 sensor structures (centroid, sight);
  - garrisoned side-0 units in a type with a sight bonus (sight plus bonus).

  `computeFog` reveals from them exactly as it does from a unit.

- [ ] **Step 1: Write the failing tests.**
  - `padGridLines(0, 0, 2, 2)` has 6 lines with the right ends; a 1×1 has 4.
  - `dashedEllipseRing` is called once per ring per style (spy), and a `dotted` ring's radius is offset by the named constant.
  - Every fallback hex equals its `data/palette.json` entry.
  - `computeFog` with one extra observer at sight 10 marks the tiles at 9.9 visible and at 10.1 not; with none, it is byte-equal to today.
- [ ] **Step 2: Implement,** and add the pad, the aura rings and the tunnel ring to `render-order.ts`'s band-4 row.
- [ ] **Step 3: See it red.**
  - Swap the dotted style for the dashed one: the style spy fails.
  - Drop the offset: the offset test fails.
  - Ignore `extraObservers`: the fog test fails.
- [ ] **Step 4: Gates.** Common gates plus `validate:ui`. `golden-baseline`: **no bless expected**, because nothing arms in a capture. If CI moves anyway, investigate before any bless, and bless from CI numbers only (`visual-baseline-bless`).

## Task 10 (lane A, app): the "Field works" dock group and the pure placement model

**Agent:** sonnet. **Depends:** the Task 5 interfaces. It may start from them, and merges after 5 and 9.

**Files:** `packages/app/src/ui/dock-model.ts` (+test), `ui/production.ts` (+test, jsdom), new `ui/works-model.ts` (+test), `ui/mark.ts`, `i18n/en.json`.

**Interfaces:**
```ts
// production.ts
export type SupportKind = 'sweep' | 'strike' | { readonly works: string };
export function isWorksKind(k: SupportKind | null): k is { readonly works: string };
export function sameSupport(a: SupportKind | null, b: SupportKind | null): boolean;   // replaces `===` everywhere
// dock-model.ts
export interface WorksTileState { typeId: string; state: 'ready' | 'locked' | 'unaffordable' | 'none_left' | 'needs_engineers';
  left: number; max: number; logistics: number }
export function worksTileState(offer: WorksOffer, reason: WorksRefusal | null): WorksTileState;
// works-model.ts (pure; main.ts stays thin)
export function worksPreview(type: { fw: number; fh: number; area: readonly { radius: number }[];
  sensor: { sight: number; tunnelRadius: number } | null }, tx: number, ty: number, reason: WorksRefusal | null):
  { pad: PlacementPreview; rings: AuraRingView[]; tooltipKey: string | null };
export function refusalKey(r: WorksRefusal): string;   // 'works.refuse.<code>'
```

- **Tile:** the mark (four new `mark.ts` SVGs, `currentColor`), the ▣ logistics price, `left/max`, and the lock states.
- **The group** goes after the support tiles, only when `worksOffers().length > 0`.
- **Strings:**
  - `dock.works.label`, `dock.works.left`, `dock.lock.engineers`, `dock.lock.noneLeft`;
  - `works.refuse.{off_map,blocked,no_footing,not_level,overlap,seals_passage}`, reading "occupied", "not level", "would seal the passage" and so on;
  - `works.<id>.blurb` for the four KDF types, ≤ 96 characters, a role and never a stat;
  - `feed.works.{started,complete,destroyed,cancelled,refused}`;
  - `hud.card.chip.{medic,workshop}` ("Medic: healing", "Workshop: repairing");
  - `hud.works.cancel` ("Cancel works (refund {n})").

- [ ] **Step 1: Write the failing tests.**
  - With no offers the dock has no group, and its DOM is equal to today's for a mission without `field_works`.
  - Each tile state renders its lock word.
  - `sameSupport({works:'a'}, {works:'a'})` is true, and false against `'strike'`.
  - `worksPreview` for the intel centre returns a dashed ring at 10 and a dotted ring at 10. For the medic it returns one dashed ring at 4.
  - `valid` is false for any reason, and `tooltipKey` maps.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.**
  - Use `===` in `sameSupport`: its test fails.
  - Emit a fill: none exists to call, so assert that the preview has no `fill` key.
  - Show the group for empty offers: the DOM-equality test fails.
- [ ] **Step 4: Gates.** Common gates plus `validate:ui`. No bless.

## Task 11 (lane A, app): the placement flow, works card, chips, feed, `&works`

**Agent:** sonnet. **Depends:** 5, 8, 9, 10.

**Files:** `packages/app/src/main.ts`, `ui/hud.ts` (+test), `sandbox-help.ts`.

- **Arming.** `armedSupport` widens to `SupportKind | null`. Arming works disarms an armed order and vice versa, as `armedOrder`/`armedSupport` do today. `anyArmed` and `escapeTarget` cover it: Escape and right-click disarm (#268).
- **Hover.** Snap to the tile under the cursor (top-left anchor, drawn centred). Recompute only when the tile changes:
  - `runtime.constructReason(typeId, tx, ty)` and `worksPreview(...)`;
  - then `renderer.placementPreview` and `renderer.auraRingPreview`;
  - the refusal goes into the cursor tooltip.
- **Click:** `runtime.requestConstruct(typeId, tx, ty, selectedConstructIds)`. The key stays armed on Shift-click. The engineer's acknowledgement reuses the move/ack voice family.
- **Selection:**
  - with nothing armed, a click on an own works site or unfinished structure sets `selectedWorks` (a site id);
  - the card shows the name, progress %, and **Cancel works (refund N)** → `requestCancelWorks`;
  - a complete works shows its rings only, and has no cancel (§0: no sell).
- **Rings** show while armed, or for a hovered/selected own works structure, including hovered militia works once identified (`hoverStructure`). Never otherwise.
- **Chips.** The own unit card shows `hud.card.chip.medic` when the unit is foot, `auraHealRate > REGEN_FRAC` and HP is below max; `…workshop` for a vehicle.
- **Feed.** `describeMissionEvent` handles `works`, and escapes the type's display name.
- **`&works`** in `sandbox-help.ts`'s table ("every buildable type ×2 and one `demo_squad`, sandbox only"), wired where the sandbox flags are applied.

- [ ] **Step 1: Write the failing tests.**
  - A hud jsdom test: the card chip appears only in the stated condition, and the cancel button shows the refund from `(cost × (ONE − p)) >> 16`.
  - A test that `describeMissionEvent` escapes a `<b>` in a structure name.
  - `sandbox-help` lists `works` (its four callers read the one table).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.**
  - Show the chip at `>= REGEN_FRAC`: field regen alone lights it, and the test fails.
  - Drop the escape: the escape test fails.
- [ ] **Step 4: Walk the real UI** (drive it; no console shortcuts). On `?sandbox=beit_sahwan_outskirts&works`:
  - place a medic station (a valid, then an invalid pad);
  - Shift-place, cancel, and rebuild;
  - hover it complete.

  Photograph: the pad valid and invalid, the rings, the card, the chip. Run `pnpm ui:routes`.
- [ ] **Step 5: Gates.** Common gates plus `validate:ui` and `ui:routes`. No bless: captures never pass `&works`.

## Task 12 (lane B, art): Meshy, Blender states, the `demo_squad` `work` clip. **Gate: L2**

**Agent:** `blender-art`, opus for judgement and haiku for gate runs. **Depends:** L2, L3. It may run from October.

**Files:** `art/meshy/<slug>-<date>-<id>/`, `art/blend/buildings/*`, `tools/units/rig.py` (`TEAM_CLIP_ADD`), `art/meshes/units/demo_squad.glb` (re-export; already claimed), `docs/ASSET_PROVENANCE.md`.

- [ ] **Step 0: Numbers table per building** (bible §4 step 0): footprint, height, polycount, roles, faction, palette or textured (Q11: KDF palette olive, militia textured). The lead approves it before anything renders.
- [ ] **Step 1: Estimate and announce.** `pnpm meshy -- estimate …` for:
  - the 4 KDF types (preview + texture + remesh, 35 each = 140);
  - the militia OP and weapons workshop (70).

  Planned **210**, ceiling **420**. **Wait for the lead's go.** Announce every call with its cost.
- [ ] **Step 2: Generate** one preview per concept; re-roll only inside the ceiling.
- [ ] **Step 3: Blender, 0 credits:**
  - the clinic and firing position kit-bashed from `clinic.glb`/`shanty.glb` plus sandbag parts;
  - 8 wrecks (the existing `_wreck` pattern);
  - **4** KDF construction states: the lower half, plus one shared scaffold-and-pallet kit;
  - a `glass` role on the intel centre's cabin, so its facing can be judged.
- [ ] **Step 4: The `work` clip on `demo_squad`** through `rig.py`. The mesh gates, gait included, must stay green. Until Task 13, `meshClipOrFallback` plays `idle`.
- [ ] **Step 5: Commit only the sources and the downloads, plus the `demo_squad` GLB.** Committing `art/meshes/buildings/kdf_*`/`militia_*` would fail `mesh-catalogue.test.ts`'s orphan check, so Task 13 exports them.
- [ ] **Step 6: Gates.** `validate:meshes` (check `git status art/meshes/` for strangers first), `validate:assets`, `encode:meshes -- --check`. Provenance ids and the AI-art disclosure text go to Task 16's PR. The `demo_squad` re-export may touch captures that show it: no bless expected, and investigate any move before blessing.

## Task 13 (lane A/B, render): export and wire the meshes; the construction state; the builder's clip

**Agent:** `render-vfx`, sonnet. **Depends:** 4, 12.

**Files:** `art/meshes/buildings/*.glb` (8 standing, 8 `_wreck`, 4 `_construction`), `packages/app/src/mesh-catalogue.ts` (+test), `three/units/mesh-building.ts`, `three/units/textured-building.ts` (+test), `three/ThreeRenderer.ts`.

**Interfaces:**
```ts
BUILDING_MESHES: Record<string, { idle: string; wreck: string; construction?: string }>  // +8 entries, construction on the 4 KDF
```

- **Under construction** (`structures.progress < ONE`): draw the `construction` GLB with a local clipping plane at `progress × height`. Use one cloned material per unfinished instance: at most `MAX_SITES` = 8. Set `renderer.localClippingEnabled = true` once.
- **Textured militia works** extend **both** `TEXTURED_BUILDING_TYPES` and `TEXTURED_MESH_EXEMPT`, and `textured-building.test.ts`. The palette KDF works extend neither.
- **Builder clip:** `working: sim.tunnelChargeProgress(i) > 0 || sim.isConstructing(i)`.
- **Pixi** draws the new types through its generic fallback. There is no construction state on Pixi; `renderer.ts` stays frozen.

- [ ] **Step 1: Write the failing tests.**
  - `mesh-catalogue.test.ts`: every new GLB is claimed; every `construction` path exists; the orphan check is green.
  - The textured pair lists agree.
  - A `mesh-building` unit test: the clip-plane height is 0.3 × h at progress 0.3, and there is no clip at ONE.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.**
  - Drop one entry: the orphan check fails.
  - Add a militia type to only one textured list: the pair test fails.
- [ ] **Step 4: Gates.** Common gates plus `validate:meshes`, `validate:assets`, `encode:meshes -- --check`, `perf:load`, and a look at zoom 1.0 in `?sandbox=…&works`. **No bless expected**: no capture scene holds a new type until Task 15.

## Task 14 (lane C, tools): the §9 probes and their bands

**Agent:** `balance-analyst`, opus. **Depends:** 1–8.

**Files:** new `tools/src/backtest/field-works-probes.ts` (+`.test.ts`), `tools/package.json` (`"fw:probes"`), new `tools/src/fw_tunnel_radius.test.ts`, new `docs/campaign/field_works/probes.md`.

Every seed is fixed. Types come from `data/structures.json`. The bands are the spec's, fixed at G-NUM and never widened: a red probe is content to retune, on the lead's call.

| probe | band (§9) | kind |
|---|---|---|
| `fw-garrison-supp` | a 2×2 garrison kills more than 0 against a raid (#280's regression pin) | test |
| `fw-medic-lull` | 1:1 and 2:1 urban, with and without a station behind the attacker, plus a `hold_for` wave replay: 2:1 ≤ 85%, and ≥ 15 pp under 3:1 | test |
| `fw-outpost-raid` | 3 `inf_squad` in an outpost: heavy-raid hold 40–80% (measured 63%) | test |
| `fw-fp-assault` | 4 inf + mortar, and 4 inf + AT, against the firing position: the AT arm falls ≥ 80% | test |
| `fw-urban-garrisoned` | the militia bonus on every defender still passes §5.7 (0 / 42 / 100 / 100) | test |
| `fw-workshop-pk` | per 100 Spike penetrations, hulls fighting again within 120 s, workshop at 3 and at 12 tiles; `destroy` stays final | recorded, plus an assertion that a destroyed hull never returns |
| `fw-op-saddle` | `saddle-price.ts` with a militia OP at the best post, against its baseline | recorded; the lead's design call (L5) |
| `fw-tunnel-radius` | no allow-listed mission has a flat 2×2 pad whose `tunnel_radius` covers a route a primary objective needs | test |

- [ ] **Step 1: Write the probes and run them.** Record every measured value in `probes.md`. Its header states the bands are frozen.
- [ ] **Step 2: Keep `fw-tunnel-radius` from passing on nothing** (the "empty array" lesson). Until Task 15 it runs against the **planned** allow list from §5: seven missions, five of them listing the intel centre. It asserts `checked === 5`.
- [ ] **Step 3: See each check red.**
  - `heal_per_s` 0.03: `fw-medic-lull` fails.
  - Outpost range +2: `fw-outpost-raid`'s ceiling fails.
  - Militia range +1: `fw-fp-assault` fails.
  - Revert Task 1: `fw-garrison-supp` fails.
  - Tunnel radius 30: `fw-tunnel-radius` fails.
- [ ] **Step 4: Gates.** Common gates, `pnpm fw:probes`, and `balance` byte-identical.

## Task 15 (lane B, content): KDF allow lists and the militia authored placements

**Agents:** `mission-author` (sonnet), then `playtest` (opus), then `content-validator`. **Depends:** 13, 14, L4, L5.

**Files:** `data/missions/*.json` (the seven allow lists, plus the militia candidates), `tools/src/backtest/playtest.ts` (a `works` plan step, `requestConstruct` at a stated tick and tile), `tools/src/fw_tunnel_radius.test.ts`.

- **Allow lists** (§5):
  - `beit_sahwan_2_foothold` and `deir_amun_2_foothold`: `{ kdf_medic_station, kdf_outpost, kdf_workshop }`. No intel centre: they author tunnels.
  - `khan_rafid_2_foothold`, `qarn_hadid_2_foothold`, `tel_marum_2_foothold`, `umm_zeitoun_2_buildup`, `wadi_halam_2_laager`: all four.
  - The default count is 1.
  - The subterranean missions list nothing.
  - Carriers per L4.
- **Militia placements** (`structures[]`, `side` defaulting from the type; garrisons via `stance: garrison`):

  | work | missions |
  |---|---|
  | OP | `umm_zeitoun_3_clearance`, `umm_zeitoun_4_clearance`, `qarn_hadid_2_foothold`, `khan_rafid_3_clearance` |
  | firing position | `qarn_hadid_2_foothold`, `khan_rafid_2_foothold` |
  | field clinic | `beit_sahwan_3_clearance`, `khan_rafid_3_clearance` |
  | weapons workshop | `wadi_halam_5_depot` (inside its `raze` zone), `wadi_halam_3_counterraid` |

  **Never `tel_marum_3_clearance` without L5.**

- [ ] **Step 1: Author,** one commit per mission. `validate:data` is green, including rule 4.
- [ ] **Step 2: Playtest.** For each adopting mission, re-run its plan ladder, plus one plan that builds (a medic behind the foothold).
  - The endure-clock band, 0.70–1.00 of target, is the foothold check. A passive plan winning means the medic made a survive-until a walkover, and that is a retune.
  - Re-pin `LADDER_CREDITS`/`GATES` only where they moved, each with its reason.
- [ ] **Step 3: Switch `fw-tunnel-radius` to the shipped `field_works`,** and pin the count (5 missions list a `tunnel_radius` type).
- [ ] **Step 4: See it red.** Add `kdf_intel_centre` to `deir_amun_2_foothold`: `validate:data` rule 4 **and** `fw-tunnel-radius` both fail.
- [ ] **Step 5: Gates.** Everything, plus `playtest` (**re-pinned here**), `balance` (identical) and `test:determinism` (unmoved).
  - **Visual:** the golden `combat` capture is `beit_sahwan_3_clearance`. If its clinic stands in frame, a bless **is expected**: from CI numbers only, via the `visual-baseline-bless` workflow, with the reason.
  - Every other capture is expected unmoved.

## Task 16: final review and the Stage 4 probes

**Agents:** opus whole-branch review, plus `sim-guard` for the determinism review.

- [ ] **Step 1: The whole-branch review.**
  - Invariants: `git diff main -- packages/sim` has no `Math.`/`Date.` and no float literals outside `fx.from` load paths.
  - Every Command and Event addition is in its exhaustiveness guard.
  - Exactly one planned golden move (Task 2), plus any L1/E6 re-pin, each with its reason.
  - No world status marks.
  - `three` only under `render/src/three`.
  - Every `renderOrder` goes through `render-order.ts`.
- [ ] **Step 2: The Stage 4 probes (§9), run and quoted in the PR:**
  - `pnpm fw:probes`: `fw-medic-lull`, `fw-garrison-supp`, `fw-outpost-raid`, `fw-fp-assault`, `fw-urban-garrisoned`, `fw-op-saddle`, `fw-workshop-pk`, all in band or recorded;
  - `fw-tunnel-radius` green with its count;
  - `pnpm perf:recompute` (the §2 R1 measurement), with the lazy decision recorded;
  - `perf:units` at 300: aura plus sensor cost under 1% of detection (§7).
- [ ] **Step 3: Every gate:**
  - `lint`, `typecheck`, `test`, `test:determinism`;
  - `validate:data`, `validate:ui`, `validate:assets`, `validate:meshes`, `encode:meshes -- --check`;
  - `balance` (identical to `main`), `playtest` (the Task 15 pins), `ui:routes`, `golden-baseline`.
- [ ] **Step 4: Walk the UI.**
  - Walk `beit_sahwan_2_foothold` from the campaign: build a medic and a workshop under fire, cancel one mid-build, lose one.
  - Walk `wadi_halam_5_depot`: raze the weapons workshop.
  - Photograph at zoom 1.0.
- [ ] **Step 5: Docs.**
  - CLAUDE.md "Adding content" gains "A field work: `structures.json` with `buildable` + `aura`; a mission opts in with `field_works`".
  - `docs/PERFORMANCE.md` row.
  - HANDOVER line.
  - Close #277, and #280 if Task 1 did not.
- [ ] **Step 6: The PR** carries the AI-art disclosure (Task 12's provenance ids) and the Meshy spend against 210/420.

