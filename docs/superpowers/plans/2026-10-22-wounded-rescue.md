# Wounded and Rescue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A man lost from an infantry squad may fall wounded instead of dead, bleed, crawl to cover, and be treated, dragged or carried by medics, ambulances and a medevac to an aid post, where he is treated and rejoins his squad weaker; rescuing enemy and civilian wounded raises Conduct.

**Architecture:** Model A (spec §2, ruling 1). A squad sheds a one-man `wounded` entity at each figure-share crossing; carrying reuses `canSeat`/`seat`/`stepTransport` with a new role filter (`can_carry`); every new column folds into `hash()` only once a wound-related type is registered (`woundLive`, the `fwLive`/`airLive` shape), so the engine lands with every pin standing. Three phases: **P1 engine** (this plan in detail), **P2 content**, **P3 switch-on** (outlined; each gets its own dispatch).

**Tech Stack:** TypeScript strict, `@lions/sim` Q16.16 fixed point, vitest, JSON Schema.

**Spec:** `docs/superpowers/specs/2026-10-22-wounded-rescue-design.md` (section 0 = the lead's rulings; they override the body).

## Global Constraints

- The four invariants (CLAUDE.md): 20 Hz tick; no float, `Math.*` or `Date.*` in `packages/sim`; all randomness from `rng` per entity id; commands in, events out.
- No per-tick allocation in hot loops; scratch arrays preallocated on `Sim`, not hashed. Strict TS, no `any`, no non-null assertions in sim code.
- **P1 and P2 move NO pin**: golden flat 935671699 and every other `determinism.test.ts` pin (`ECONOMY_PIN` 904873885, `RUNTIME_DIGEST_PIN` 2037118941, relief, orders), versus/net 580559085 / 1260439781 (and every pin in `packages/app/src/net/*.test.ts`, `tools/src/backtest/versus-*.test.ts`), `LADDER_CREDITS` 5920, `ROSTER_MAX` 29, and `pnpm balance` / `pnpm playtest` output byte-identical to `_coord/wr-base/{balance,playtest}.txt`.
- Nothing under `data/units/`, `data/structures.json` or `data/missions/` uses a new field in P1. Behaviour is proved with test-only types built in the test files.
- Test oracles are LITERALS with the hand arithmetic in a comment, never values imported from the code under test.
- Every new check is falsified: a one-line mutation of the implementation, run, seen red, undone by reverting the edit (never `git checkout <file>`); the red line is quoted in the commit message.
- Tuning numbers live in `packages/sim/src/tuning.ts`: `MAX_WOUNDED_PER_SIDE` 24, `WOUND_CRAWL_PERIOD_TICKS` 40 (2 s), `WOUND_CRAWL_SCAN` 2 (5x5), `WOUND_COVER_STOP` 2, `MEDIC_TREAT_REACH` 2 tiles, `WOUND_SCAR_STEP` 0.2, `WOUND_SCAR_FLOOR` 0.4, `CONDUCT_GAIN_ENEMY` 2, `CONDUCT_GAIN_CIVILIAN` 3, `CONDUCT_GAIN_CAP` 10, `CONDUCT_KILL_WOUNDED_ENEMY` 3.
- Every chrome string through `t()`; no new strings in mission data.

## Decisions this plan makes (not in the spec; reported to the lead)

- **D1 crawl speed** is the `wounded_*` type's own `mobility.speed` (spec's `crawl_tiles_s` moves there in P2); `hull.wounds` keeps `wound_chance`, `bleed_s`, `type`, `in_place`.
- **D2 auto-rescue priority:** friendly, then civilian, then nothing. **Enemy wounded are rescued only by a player `rescue` order** (an explicit act; Conduct pays for it). Ties: nearest, then lowest id.
- **D3 a carrying medic cannot board a vehicle**; he hands the wounded over instead (transfer seat). No nested carrying.
- **D4 evacuation points** are a sim list (`addEvacPoint(side, x, y)`); the runtime registers a map marker named `wounded_evac` for side 0 if the map has one. Ambulance arrival within 1 tile, or a medevac lifting off with wounded aboard, evacuates them.
- **D5 a treated civilian** counts as evacuated (no rejoin); `evacuate_before` does not count him (it counts refuge arrivals only).
- **D6 Conduct gain events** are a new `MissionEvent` kind `roeGain { tick, gain, reason, score }`; the app ignores it until P2's feed line.

## Review Focus

1. **A world with no wound type is bit-identical** — no column folded, no rng draw, no branch taken. Task 1 pins this with a mutation (fold unconditionally → golden red).
2. **A squad hit from full to dead in one shot** (an ATGM on a 4-man squad) crosses several shares in one `applyDamage`: each intermediate man rolls once, the last is the squad's death; Task 2 tests a 400-damage hit on 400 hp / 4 figures.
3. **The wounded cap and the sim's capacity** — the 25th wounded on a side, and a spawn at `count === capacity`, are killed, never thrown; Task 2.
4. **The carrier dies with a wounded aboard** — an ambulance destroyed on the ground drops him alive (bail-out path, hurt), an airborne medevac takes him with it; a medic killed while dragging drops him where he stood, still stabilised; Task 4 and Task 5.
5. **The parent squad is dead when its man is treated** — he joins the nearest same-type squad below full, else counts as evacuated, never resurrects the squad; Task 6.

---

## File Structure (P1)

- Modify `packages/sim/src/sim.ts` — type fields (`UnitTypeJson`/`UnitType`), columns, `woundLive`, hash fold, `applyDamage` share crossing, `canSeat` filter, movement speed multiplier, `selectTarget`/`canFocus` skip, `rescue` command, `destroy` hooks, step wiring.
- Create `packages/sim/src/wounds.ts` — pure helpers with no `Sim` state: `figuresStanding(hp, typeHp, figures)`, `scarredShare(share, scars)`, `bestCoverTile(...)`, `pickRescueTarget(...)` scoring. Unit-tested on their own.
- Modify `packages/sim/src/structures.ts` — parse the structure `aid` block.
- Modify `packages/sim/src/tuning.ts` — the constants above.
- Modify `packages/sim/src/mission.ts` — Conduct gains/deductions, `roeGain`, `wounded_evac` marker.
- Modify `data/schemas/unit.schema.json`, `data/schemas/structure.schema.json`.
- Modify `packages/net/src/protocol.ts`, `packages/net/src/ownership.ts` — the `rescue` command.
- Tests: create `packages/sim/src/wounds.test.ts` (helpers), `packages/sim/src/wounded.test.ts` (falling, bleed, crawl, targeting), `packages/sim/src/rescue.test.ts` (carry, medic, aid post, evac); extend `determinism.test.ts` (fold guard + a new wounded-world pin), `mission.test.ts` (Conduct).

---

### Task 1: Data shape, columns and the deferred fold

**Files:** `data/schemas/unit.schema.json`, `data/schemas/structure.schema.json`, `packages/sim/src/sim.ts`, `packages/sim/src/structures.ts`, `packages/sim/src/tuning.ts`, `packages/sim/src/determinism.test.ts`, `packages/sim/src/wounded.test.ts`

**Interfaces — Produces:**
- Schema: role enum gains `"wounded"`; `hull.figures` (integer 1–8, default 1); `hull.wounds { wound_chance (0–1), bleed_s (>0), type (unit id), in_place (bool, default false) }`; `hull.can_carry` (array of role strings; when present the carrier seats ONLY those roles); `hull.stabilise_radius` (number ≥ 0, tiles); top-level `rescue { radius_tiles, treat_s, drag_speed_mult, carry_speed_mult }` and ability `"rescue"` in the abilities enum. Structure `aid { admit_radius, treat_s, dispatch_radius }`.
- `UnitType` fields: `figures: number`, `wounds: { chance: Fx; bleedTicks: number; typeId: string; inPlace: boolean } | null`, `woundedTypeIdx: number` (resolved lazily, -1 until found), `isWounded: boolean` (role `wounded`), `canCarry: readonly string[] | null`, `stabiliseRadiusSq: Fx`, `rescue: { radiusSq: Fx; treatTicks: number; dragMult: Fx; carryMult: Fx } | null`.
- `StructureType.aid: { admitRadiusSq: Fx; treatTicks: number; dispatchRadiusSq: Fx } | null`.
- Columns (Int32Array/Uint8Array sized `capacity`, defaults in brackets): `figuresUp` [type.figures at spawn], `scars` [0], `woundParent` [-1], `woundBy` [-1], `woundState` [0 = none; 1 DOWN, 2 STABILISED, 3 ADMITTED, 4 GONE], `bleedTicks` [0], `woundTimer` [0], `medState` [0 = idle; 1 TO_WOUNDED, 2 TREATING, 3 CARRYING, 4 DELIVERING], `medTarget` [-1], `medTimer` [0], `speedMul` [ONE], `admittedAt` [-1]; plus `woundedAlive: Int32Array(3)` per side and `evacX/evacY/evacSide` (fixed max 8 points).
- `private woundLive = false`, set in `addUnitType` when the type has `wounds`, `rescue`, `canCarry` or `isWounded`, and in `addStructureType` when it has `aid`; public getter `get woundsLive(): boolean`.
- Hash: after the `airLive` block, `if (this.woundLive) { h = hashWord(h, 0x57440707); // 'WD' #707` then every column above in the order listed, then `woundedAlive`, then the evac arrays and their count `}`.

- [ ] **Step 1: Failing tests** in `wounded.test.ts`: (a) a sim with only shipped types reports `woundsLive === false`; registering a test type `{ ..., hull: { hp: 400, figures: 4, wounds: { wound_chance: 0.6, bleed_s: 60, type: 'wounded_test' } } }` flips it true; (b) two otherwise identical worlds, one with the wound type registered and nothing spawned from it, have DIFFERENT `hash()` (fold is on) and the world without it hashes exactly as before; (c) schema: `validate:data` accepts a fixture unit with every new field (add a vitest case that runs the schema validator from `@lions/data` on an in-test object, plus a rejected one with `wound_chance: 1.5`).
- [ ] **Step 2: Run** `pnpm --filter @lions/sim exec vitest run src/wounded.test.ts` — FAIL (unknown fields).
- [ ] **Step 3: Implement** schema, parsing (floats cross to Fx once at load via `fx.from`; seconds to ticks ×20), columns, defaults in `spawn`, the flag and the fold.
- [ ] **Step 4: Falsify**: fold the block unconditionally → `pnpm test:determinism` red on the flat golden (quote it), undo. Set `woundLive` in `addUnitType` for every type → same red, undo.
- [ ] **Step 5: Gates** (see "Gates" below), commit `feat(sim): wound data shape and deferred fold (#707)`, push.

### Task 2: Falling — share crossings, the roll, spawn and in-place downing

**Files:** `packages/sim/src/wounds.ts`, `wounds.test.ts`, `sim.ts`, `wounded.test.ts`, `tuning.ts`

**Interfaces — Consumes:** Task 1 columns and fields. **Produces:**
- `export function figuresStanding(hp: Fx, typeHp: Fx, figures: number): number` — `ceil(hp × figures / typeHp)` in integers, clamped to `[0, figures]`.
- `SimEvent` `{ kind: 'woundedDown'; tick; entity: number /* the wounded id */; parent: number /* squad id, or -1 for in place */; by: number }` and `{ kind: 'manKilled'; tick; entity: number /* squad */; by: number }`.
- `private fallMan(squad: number, by: number, last: boolean): void`.

Rule (in `applyDamage`, only when `woundLive` and the target type has `wounds`): after `hp` is reduced, `standing = figuresStanding(hp, type.hp, type.figures)`; while `figuresUp > max(standing, 1)` fall one man (`last = false`); if `hp <= 0` the squad is destroyed as today and `fallMan(..., last = true)` rolls for a body whose `woundParent` is -1 (ruling 5). Each fall draws ONE `rng.chance(squad, wounds.chance)` on the squad's stream; wounded → spawn `woundedTypeIdx` at the squad's position, same side, `woundBy = by`, `bleedTicks = wounds.bleedTicks`, `woundState = DOWN`, `scars` copied, `woundedAlive[side]++`; killed (or `woundedAlive[side] >= MAX_WOUNDED_PER_SIDE`, or `count >= capacity`) → `manKilled`. `figuresUp` decrements either way. `in_place` types (`figures` 1): the fatal hit instead sets `hp` to the wounded hp floor `ONE`, `woundState = DOWN`, `isWounded` behaviour via `woundState`, no spawn, `woundedDown` with `parent -1`, `entity` = itself. The regen ceiling multiplies by `figuresUp / figures` when `figures > 1`.

- [ ] **Step 1: Tests** — `figuresStanding`: (400,400,4)→4, (300,400,4)→3, (299,400,4)→3, (1,400,4)→1, (0,400,4)→0. Sim: test type 400 hp / 4 figures / chance 1.0 → a 100-damage hit spawns exactly one wounded at the squad's position (`count` +1, `figuresUp` 3, event `woundedDown` with `parent` = squad, `by` = shooter); chance 0 → `manKilled`, no spawn; one 400-damage hit → 3 wounded with parent = squad + 1 body with parent -1 and a `destroyed` for the squad; 25th wounded on one side killed; capacity-full spawn killed and no throw; regen after 300 hp lost tops out at `0.7 × 400 × 1/4 = 70` hp, not 280; in-place type: fatal hit leaves `alive 1`, `woundState 1`, same id, no `destroyed`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Falsify** each of: `max(standing,1)` → `standing` (last-man test red), drop the cap check, drop the regen ceiling. **Step 5: Gates, commit, push.**

### Task 3: The wounded man — bleed, crawl, hors de combat

**Files:** `sim.ts`, `wounds.ts`, `wounds.test.ts`, `wounded.test.ts`

**Interfaces — Produces:**
- `export function bestCoverTile(cover: Uint8Array, blocked: Uint8Array, width: number, height: number, tx: number, ty: number): number` — best tile index in the 5x5 around (tx,ty), highest cover, ties lowest index; a candidate two tiles away is refused if the tile between it and the start (integer midpoint) is blocked; returns the start tile when nothing beats it.
- `private stepWounded(): void`, called once per tick before `stepMovement`, returns at once unless `woundLive`.
- `SimEvent` `{ kind: 'bledOut'; tick; entity }` (in addition to the normal `destroyed` with `by = woundBy`).

Rules: DOWN bleeds 1 tick per tick, 2 while `pinned`; 0 while a friendly unit with `rescue` stands within `MEDIC_TREAT_REACH`, or a friendly `stabiliseRadiusSq` carrier is in range, or he is carried; STABILISED never bleeds. At 0 → `destroy(id, woundBy[id])` and `woundedAlive[side]--` (also decremented on any other death of a wounded). Every `WOUND_CRAWL_PERIOD_TICKS` while DOWN, not carried and cover under `WOUND_COVER_STOP`, he moves straight toward `bestCoverTile`'s centre at his type's speed (direct position step, no flow field, no `moving` flag). `selectTarget` never picks a unit with `woundState` DOWN/STABILISED or `isWounded` for either side; `canFocus` refuses them; splash still applies. A wounded has no orders: every order kind skips ids whose `woundState !== 0`.

- [ ] **Step 1: Tests** — `bestCoverTile` on literal 5x5 grids (cover-3 tile two away beyond a blocked midpoint is refused; tie picks lower index); a DOWN wounded with `bleed_s` 2 (40 ticks) dies on tick 40 with `destroyed.by` = original shooter, on tick 20 when pinned, and never while a test medic stands 1 tile away; a crawler on cover 0 next to a cover-2 tile reaches it and stops; an enemy rifle team beside a wounded never fires at him (`fire` events: zero) while an `attack` order on him is refused; a mortar splash still kills him.
- [ ] **Steps 2–5** as Task 2; falsify the pinned double-bleed, the medic pause, the midpoint block, the `selectTarget` skip.

### Task 4: Carrying — the role filter, drag speed, stabilise aura, evacuation

**Files:** `sim.ts`, `rescue.test.ts`

**Interfaces — Produces:**
- `canSeat(car, id)`: when the car's type has `canCarry`, the rider's ROLE must be in it (and wounded riders are seated by anyone listing `wounded` regardless of `canEmbark`); when the car's type lacks `canCarry`, a rider with `woundState !== 0` or `isWounded` is refused (an APC is not an ambulance).
- `private transferSeat(fromCar: number, toCar: number, id: number): boolean` — disembark from one, seat in the other, one `transport` unload + load event pair, no position snap gap.
- `speedMul[carrier]` = `rescue.dragMult` (or `carryMult` when the medic type's `transportSlots >= 1` and figures ≥ 2 — the stretcher team) while it carries; `stepMovement` multiplies the per-tick step by `speedMul` (ONE elsewhere: a `fx.mul` by ONE is exact, so nothing moves without content).
- `addEvacPoint(side: number, x: Fx, y: Fx): void` (max 8, throws beyond); `SimEvent` `{ kind: 'woundEvacuated'; tick; entity; carrier; side /* rescuing side */ }`. Evacuated wounded: `alive = 0` without `destroyed`, `woundState = GONE`.
- A ground carrier with wounded aboard within 1 tile of its side's evac point evacuates them; an air carrier entering LIFTING with wounded aboard evacuates them (in `stepAirCarriers`).
- Carrier death: ground → `disembark(id, true)` as today, the wounded keeps his state; airborne air → dies with it (already the rule).

- [ ] **Step 1: Tests** — test ambulance type (`transport_slots 4`, `can_carry: ['wounded']`, `stabilise_radius 1.5`) refuses an infantry squad and seats a wounded; a test APC without `can_carry` refuses a wounded; a carrying test medic moves at exactly 0.5 × its step per tick (literal positions after 20 ticks); a DOWN wounded 1 tile from the ambulance does not bleed; ambulance driven to the evac point emits `woundEvacuated` and the wounded is `alive 0` with no `destroyed`; a test medevac (air carrier + `can_carry`) lifting with a wounded aboard evacuates him; ambulance destroyed on the ground drops him alive.
- [ ] **Steps 2–5**; falsify the role filter, the no-`canCarry` refusal, `speedMul`, the 1-tile evac radius.

### Task 5: The medic — automatic rescue, treat, drag, deliver; the `rescue` order

**Files:** `sim.ts`, `wounds.ts`, `wounds.test.ts`, `rescue.test.ts`, `packages/net/src/protocol.ts`, `packages/net/src/ownership.ts` (+ their tests)

**Interfaces — Produces:**
- `Command` `{ kind: 'rescue'; ids: number[]; target: number }` — medics only (`rescue !== null`), target must have `woundState` DOWN/STABILISED and not be carried; refused ids change nothing; net protocol encodes it exactly like `attack`, ownership checks `ids` like `attack`.
- `export function rescuePriority(rescuerSide: number, woundedSide: number): number` — 0 friendly, 1 civilian (side 2), -1 otherwise (D2).
- `private stepMedics(): void` after `stepWounded`. State machine per medic: IDLE (not moving, no `focusTarget`, no `boardGoal`, not carrying) → picks the best identified (side contact ≥ identified for enemies/civilians; own side always known) DOWN/STABILISED wounded within `rescue.radiusSq` (or within the post's `dispatchRadiusSq` of a friendly aid structure whose own radius contains the medic: Task 6 wires this) → TO_WOUNDED (move to him) → TREATING for `rescue.treatTicks` within `MEDIC_TREAT_REACH` (`medTimer`; at 0 `woundState = STABILISED`, event `woundStabilised { tick, entity, medic }`) → seats him in himself when `transportSlots ≥ 1` (CARRYING) → DELIVERING to the nearest of: friendly aid structure (Task 6), friendly ground `canCarry` carrier with a free seat (transfer within `LOAD_RANGE`), friendly LANDED air `canCarry` carrier, own evac point; none → he holds where he is. A player order other than `rescue` resets the medic to IDLE but he keeps anyone he carries; `unload` drops the wounded beside him. A medic with `transportSlots 0` treats only. A carrying medic's own `canSeat` as a rider is refused (D3). Medic death while carrying → wounded dropped, state kept.
- `SimEvent` `{ kind: 'woundStabilised'; tick; entity; medic }`.

- [ ] **Step 1: Tests** — `rescuePriority` literals; an idle test medic 6 tiles from a friendly DOWN wounded walks to him, treats for exactly `treat_s × 20` ticks, then carries him to a test aid point and the wounded is admitted (stub: an evac point until Task 6); an enemy wounded is NOT auto-picked but IS rescued under a `rescue` order; a civilian wounded beats nothing but loses to a friendly at equal distance; an unidentified enemy wounded cannot be targeted by the order; medic killed mid-carry drops him STABILISED; a `move` order mid-carry keeps the passenger; net round-trip of `rescue` equals the input; ownership refuses a foreign id.
- [ ] **Steps 2–5**; falsify priority, the identification check, the treat timer, the drop-on-death.

### Task 6: The aid post — admission, treatment, rejoin, dispatch

**Files:** `sim.ts`, `wounds.ts`, `wounds.test.ts`, `rescue.test.ts`

**Interfaces — Produces:**
- `export function scarredShare(share: Fx, scars: number): Fx` — `share × max(WOUND_SCAR_FLOOR, 1 − WOUND_SCAR_STEP × scars)`.
- Admission: a carried wounded whose carrier is within `aid.admitRadiusSq` of an alive aid structure owned (`stOwner`) by the carrier's side is removed (`alive = 0`, no `destroyed`, `woundState = ADMITTED`, `admittedAt = structure`, `woundTimer = aid.treatTicks`, halved when he was STABILISED by a medic), event `woundAdmitted { tick, entity, structure, side /* admitting side */ }`; the carrier's seat frees.
- `private stepAidPosts(): void` — counts every ADMITTED timer down; the structure destroyed → the patient is lost (`woundState GONE`, event `woundLost`). At 0: parent alive and same side → `figuresUp + 1`, `hp += scarredShare(type.hp / figures, scars[parent])` capped at the regen ceiling for the new `figuresUp`, `scars[parent]++`, event `woundRejoined { tick, entity, squad }`; parent dead → nearest same-type same-side squad with `figuresUp < figures` (ties lowest id) gets the same; none, or the wounded is enemy/civilian, or `woundParent` is -1 → `woundEvacuated` with `carrier = -1` (D5, ruling 5).
- Dispatch: a medic standing within `aid.dispatchRadiusSq` of a friendly aid structure searches wounded within that same radius of the STRUCTURE (Task 5's hook).

- [ ] **Step 1: Tests** — `scarredShare(100, 0..4)` → 100, 80, 60, 40, 40; a friendly wounded admitted, after `treat_s × 20` (or half when stabilised) ticks his squad goes 3→4 figures and +100 hp (scars 0), a second rejoin +80; parent dead → the second same-type squad below full gains him; enemy wounded admitted → `woundEvacuated` not rejoin; post destroyed mid-treatment → `woundLost`; dispatch pulls a medic 10 tiles from the post to a wounded 11 tiles from the post but 20 from the medic.
- [ ] **Steps 2–5**; falsify the scar floor, the halving, the parent-dead fallback, the ownership check.

### Task 7: Conduct, the evac marker, the wounded-world pin, docs

**Files:** `packages/sim/src/mission.ts`, `mission.test.ts`, `determinism.test.ts`, `packages/app/src/**` (only where an exhaustive switch over `MissionEvent`/`SimEvent` kinds forces a no-op case), `CLAUDE.md`

**Interfaces — Produces:**
- `MissionEvent` `{ kind: 'roeGain'; tick; gain: number; reason: string; score: number }` (D6); added to the kinds list at `mission.ts` ~593.
- `stepRoe`: `woundAdmitted`/`woundEvacuated` with rescuing `side` 0 and the wounded's side 1 → +`CONDUCT_GAIN_ENEMY`, side 2 → +`CONDUCT_GAIN_CIVILIAN`; the mission's running gain total capped at `CONDUCT_GAIN_CAP`, the score never above 100; a field `roeGainTotal` folded into `digest()` (it is 0 without content, but fold it only when non-zero so the digest pin stands). `destroyed` of a side-1 wounded with `by` on side 0 → deduct `CONDUCT_KILL_WOUNDED_ENEMY`. A downed civilian's death keeps the existing `civilian_casualty_penalty` branch (it is the same entity and `by` is the original shooter), so a rescued civilian costs nothing (ruling 3).
- The runtime calls `sim.addEvacPoint(0, x, y)` at start for a marker named `wounded_evac` when the map declares one (no shipped map does; `validate:data` unchanged).
- `determinism.test.ts`: a NEW pin `WOUNDED_WORLD_PIN` — a 600-tick scripted fight with the test wound type, a test medic and a test aid post, run twice from the seed; equal hashes, the literal pinned (a new pin, not a moved one).
- `CLAUDE.md`: one bullet under "Dev instruments" — wounds are engine-only until P3; `woundLive` deferred fold; where the rules live.

- [ ] **Step 1: Tests** — mission runtime with a test mission: player rescues 6 enemy wounded → score 100 stays 100 (cap at 100) and from 90 → 100 (cap 10), civilian rescue +3, killing an enemy wounded −3, a civilian downed by the player and rescued → no deduction, downed and bled out → −8.
- [ ] **Steps 2–5**; falsify the cap, the 100 ceiling, the side check; the new pin's falsification is "change one test-type number → pin red".

### Gates (every task)

`pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm test:determinism`, then `pnpm balance > X` and `pnpm playtest > Y` diffed against `_coord/wr-base/{balance,playtest}.txt` (byte-identical; a timing line only may differ). A sim task also gets a sim-guard review. Any pin move → STOP, do not commit, report.

---

## P2 — Content (next dispatch; no pin moves)

1. Meshy prompts by an Opus agent at high effort for `inf_medic_squad` (two figures, trauma pack, folded stretcher; no red cross), the stretcher prop, and the `kdf_aid_post` tent + `_wreck`; each call announced with its estimate (~120–150 credits total, ruling 4).
2. `wounded_kdf` / `wounded_sarim` unit JSON (role `wounded`, hp 30, no weapon, sight 0, `can_embark: true`, signature 0.3, mobility speed 0.12, not buildable) with `kit.py` prone figures and clips (`down`, `crawl`, `idleWounded`, `dragged`, `carried`); `validate_balance.py` skips role `wounded`.
3. `inf_medic_squad` JSON (`rescue` block, `transport_slots 1`, `can_carry ['wounded']`, figures 2), `veh_ambulance` (Namer GLB + raised-roof kit, `can_carry`, `stabilise_radius 1.5`, 4 slots), `air_medevac_heli` (Yanshuf GLB + hoist boom), `kdf_aid_post` structure (2x3, 200 logistics, `aid { admit_radius 1, treat_s 20, dispatch_radius 12 }`), mesh catalogue entries, portraits, `mesh_roster` pins.
4. Presentation: `squad-rig` hides one figure per lost share from `figuresUp`; feed line "Man down — <squad>" and a "Medic!" radio call (one per 8 s per side), `roeGain` feed line, a bleed ring on the unit card, the minimap icon; roster `wounded_in_action` / `rescued` counts and the debrief "N evacuated".
5. None of the shipped infantry carries `hull.wounds` yet; all pins byte-identical.

## P3 — Switch on for all infantry (later dispatch; pins move)

1. `hull.figures` on every foot unit (equal to its GLB's `rl_figures`, pinned by `mesh_roster.test.ts`) and `hull.wounds` on every infantry unit of both sides (`wound_chance 0.6`, `bleed_s 60`); civilians `in_place: true`.
2. Measure and re-pin, each with its reason in the commit: golden(s), versus/net, `ECONOMY_PIN`, `RUNTIME_DIGEST_PIN`, playtest outcomes and `LADDER_CREDITS`/`ROSTER_MAX` if they move; `pnpm balance` §5.7 — **a failing target goes to the lead before any re-tuning** (ruling 2).
3. `docs/PERFORMANCE.md`: the lifetime-id cost of shed men at the 300-unit target.
4. The visual bless from CI numbers only.
