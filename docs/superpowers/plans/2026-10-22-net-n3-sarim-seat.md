# N3 · The Sarim Seat: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A KDF-v-Sarim friend match plays on the skirmish rules: each seat has a camp, a purse, a
doctrine menu, a population cap and held-ground income, both seats build through F4's lines over
the wire, and the match ends by the network rule with production counted.

**Architecture:**
- A schema-validated **versus rules file** per map (`data/versus/<map>.json`) names each end's camp
  and the income zones. A pure loader in `@lions/data` maps it, field for field, into the
  `MissionJson` shape the runtime already takes. No objective, trigger, wave or civilian is
  authored, so `checkEnd` can never end the runtime; `outcome.ts` decides the match (decision 24).
- `buildMatchWorld` is still the ONE place a room's world is built. It now also builds the
  `MissionRuntime` for an economy room, and one shared `matchTick(world)` runs
  `applyQueued → sim.tick → runtime.step` for the browser and the AI harness alike, so their
  digests cannot drift.
- Side 1's human paths open in one commit: `applyQueued` asks `sim.isHumanHeld(side)` instead of
  `side !== 0`, and `validateCommand` admits `build`/`cancelBuild`/`setRally`/`clearRally` in an
  **economy** room. `support`, `callStrike`, `reveal`, `raiseWorks` and `cancelWorks` stay dropped.

**Tech Stack:** TypeScript strict, vitest, `@lions/sim`, `@lions/net`, `@lions/data`,
`packages/app`, `packages/worker`, `tools/` (probe, two-client test). No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-10-network-game-design.md` (§2.2, §2.3, §6, §7.1 incl.
"F4 (LD6) as built", the §9 N3 row, decisions 9, 18, 19, 24, 25). Read with it:
- `docs/superpowers/plans/2026-10-16-net-n3-prep.md`: the gap list, LD1–LD8 (all ruled 16 Oct, as
  recommended) and §6 (tunnels, superseding LD4).
- `docs/superpowers/specs/2026-10-22-versus-tunnels-design.md`: its T3–T6 wait on this plan's rules
  file and production. Its T1+T2 are PR GH-737 (open at the time of writing).
- `docs/superpowers/plans/2026-10-16-net-n2-sim.md` Task 8 (the `humanHeld` skip design, deferred
  to N3 by D1) and its pin-table format, which this plan follows.
- GH-655 (the prep), GH-658 (doctrines, LD2/LD3), GH-684 (`yahalom_squad` on the KDF menu), GH-725
  (the measured versus seats).

**Base:** `origin/main` `8eeea195` (22 Oct). Line numbers are hints; locate code by symbol.

**Status (22 Oct):** the lead accepted Q1–Q9 as recommended (in chat, posted on GH-741). A
review against the code found two blocking points and four minor ones; all six are folded in (P-9,
Task 3's fix and test, Task 3's direct calls, and the test lists in Tasks 1, 2 and 4).

---

## Pre-flight against `8eeea195` (done while writing; the executor repeats Step 0)

What the tree says, where it differs from the prep note:

| # | Finding | Consequence for N3 |
|---|---|---|
| P-1 | **F4 (GH-692) has merged with all ten LD6 asks** (spec §7.1 table). `requestBuild(unit, line?, side)`, `cancelBuild(line, index, side)`, `setRally(line, x, y, side)`, `clearRally(line, side)`, `productionLines(side)`, `productionOf(side)`, `populationView(side)`, `MissionContext.economy` and `built.side` all exist. | N3 writes no production code. It opens the wire and passes `c.side` through. |
| P-2 | `applyQueued` (`mission.ts` ~L1635) skips `c.side !== 0` and calls `cancelBuild(c.line, c.index)`, `setRally(c.line, c.x, c.y)` and `clearRally(c.line)` **without** the side. | Task 4 passes `c.side` to all four, or a side-1 cancel lands on side 0's line. |
| P-3 | Field works (GH-277) added two more runtime kinds, `raiseWorks`/`cancelWorks`. `requestConstruct` has no side. Wounded (GH-707) added `rescue`, which is not versus-gated. | Both field-works kinds stay dropped in versus and refused for side 1 by the runtime. `rescue` is untouched. |
| P-4 | **LD1 is not built.** The room mints `side: mode === 'versus' ? seat : 0` (`match-room.ts` ~L401), so a host who picks Sarim plays side 0. GH-725's "Sarim west" cell (22/26) is Sarim on side 0 at the friendly anchor. | Task 2 builds LD1 **without losing either measured spawn order**: side follows faction, the anchor follows the seat. |
| P-5 | `app` already filters `built` by `isOwnSide(e.side, viewer)` (`ui/alerts.ts`, `voice/announce.ts`). Only the tutorial reads `side !== 0`, and it is single-player. | Prep row 18 is done. Nothing to switch. |
| P-6 | Doctrines landed (`data/doctrines/{kdf,sarim}.json`, GH-658 + GH-684): KDF 3000, Sarim 4800, both `provisional`; `pop_cap` unset; not exported from `@lions/data`; not in `contentDigest`. | Task 1 exports them and folds them in. Values are Q3/Q4. |
| P-7 | Six KDF menu units carry an `unlock` gate (`mbt_lavi` Conduct 90, `ifv_namer` 85, `dozer_d9` 87, `heli_peten` 82, `yahalom_squad` 75, `recon_drone` 70). With no ledger, `unlockReason` refuses them. | The versus `unitInfo` hands the runtime no `unlock` (the doctrine menu IS the gate). Task 3. |
| P-8 | Placed-force population: `VERSUS_KDF` 22, `VERSUS_SARIM` 32. | A pop cap below that refuses every build until losses. Q4. |
| P-9 | `checkEnd` ends a runtime on a primary, a player wipe, an ROE floor or `time_limit_s`. A versus mission authors no primary, no floor and no limit, **but production spawns through `spawnPlacement`, which pushes every side-0 unit into `playerIds`** (~L3225). So once every BUILT KDF unit is dead, while the placed force (spawned by `buildMatchWorld`, not in `playerIds`) still lives, `wiped` is true, the runtime ends, and `step()` returns `[]` for good: income and production stop silently. (Plan review, blocking 1.) | Fixed in the sim in Task 3, before Task 4 opens building: **a runtime whose mission has no objectives never ends by itself** (`checkEnd` returns at once when `this.objectives.length === 0`). No `versus` flag: every shipped mission has at least one objective (the schema's `minItems: 1`), so single-player cannot reach the guard. Pinned by a build-and-lose test shown red without the guard. |
| P-10 | The AI harness (`tools/src/net/agent-client.ts`) runs `runTick: () => { sim.tick(); fog.step(); }`. | Once a room has a runtime, a harness seat would desync on tick 19. Task 3's `matchTick` is shared by both. |
| P-11 | `versus:probe` builds its own world (`world()`), not `buildMatchWorld`, and plays attack-move only. | Task 7 moves the economy arm onto `buildMatchWorld` + `matchTick`. |
| P-12 | No hash pin covers a KDF-v-Sarim room today; the mirror pins do. | Task 3 births one per matchup map. |
| P-13 | GH-737 (tunnels T1+T2) is **open**. It adds `enterTunnel`/`vent` (not versus-gated) and a `humanHeld` surfacing gate. | N3 does not depend on it. Whichever lands second rebases `COMMAND_KINDS`/`validateCommand`. Tunnels' T3 extends this plan's `versus_rules.schema.json` with its `tunnels` block. |

**Current pins (read at `8eeea195`):** golden flat `3719067886`, relief `2842924511`, orders
`3272041047`; `ECONOMY_PIN` `904873885`, `ECONOMY_PIN_RELIEF` `2771311510`; `RUNTIME_DIGEST_PIN`
`2037118941`, `RUNTIME_DIGEST_PIN_RELIEF` `1884258391`; `WOUNDED_WORLD_PIN` `1774950105` (all
`packages/sim/src/determinism.test.ts`); versus-force mirror `3296182002` / `1524988923`;
match-world mirror `1108074073` / `1524988923`; per-seat-types control `580559085`;
`LADDER_CREDITS` `5920`, `ROSTER_MAX` `29` (`tools/src/backtest/playtest.ts`).

---

## Global Constraints

- **The four invariants** (CLAUDE.md). No float in `@lions/sim`; no new RNG draw; nothing outside
  the sim writes sim state. The runtime's production is set aside and drained by `applyQueued`, as
  N2 built it.
- **The rules file is data, never TypeScript** (L1 restatement, spec §11b.4). The loader only
  copies fields; a value that is not in a JSON file does not reach the runtime.
- **LD1:** KDF is side 0 in a faction matchup. **LD5:** fire support stays off in versus.
  **LD7:** Conduct is the KDF seat's, report-only, never shown to Sarim. **LD8:** the create-time
  pick is the pick; no `lobby.set`.
- **Mirror rooms are unchanged** (Q1's recommendation): no runtime, no economy, every mirror pin
  and the arena's seed-40595 checks unmoved. Economy is on in a KDF-v-Sarim room only.
- **No pin moves except where the pin table says it may.** Each move is its own commit, with
  `Was <n>.` and the reason. **A versus fairness result, a playtest outcome, a §5.7 target,
  `LADDER_CREDITS` or `ROSTER_MAX` that moves: STOP and report to the coordinator.**
- `COMMAND_KINDS`, `cleanCommand` and `validateCommand` change in the same commit as anything that
  changes what the wire carries.
- Every check arrives with its falsification run and watched red; the commit lists the mutations.
- Gates before each commit that touches its area: `pnpm test:determinism` (any sim file), `lint`,
  `typecheck`, `pnpm test`, `validate:data`, `validate:ui`, `balance`, `playtest`.
- Git: `/usr/bin/git`, `git commit -- <paths>`, never `add -A`, never `checkout <file>`, never
  pkill. No local `ui:routes`, `golden-baseline` or `ui:shots`. Port 5177 is off-limits.
- Issue references in any UI-adjacent file are written `GH-NNN`.
- UI strings go through `t()`; every new key in `en.json`.
- Commits end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The PR merges with a merge
  commit, not a squash.

## Review Focus

1. **A seat's order lands on the other side's line.** A Sarim `cancelBuild{side:1, line:0}` must
   refund `purse[1]` and touch only side 1's line 0 — owned by Task 4 (`applyQueued` passes
   `c.side`; test "side-1 cancel refunds side 1, not side 0").
2. **A forged `side` on the wire.** Seat 0 sending `build{side:1}` must drop on both clients —
   Task 4's ownership test, plus a two-client run where it is in the frame stream (Task 8).
3. **A mirror room with a stale economy assumption.** A mirror room must still drop `build` (it has
   no runtime) — Task 4, "mirror still drops build".
4. **A Sarim host's spawn end moves.** Picking Sarim must still put the host at the friendly anchor
   and the camera there — Task 2, "host end follows the seat".
5. **A side with no units but a camp and a purse is called beaten.** `outcomeOf` must keep it
   standing while it can still buy an armed unit, and stop keeping it once it cannot — Task 5.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `data/schemas/versus_rules.schema.json` (new) | The rules file's shape: `id`, `map`, `ends.{friendly,hostile}.camp`, `income_zones`, optional `zones` | 1 |
| `data/versus/tel_marum.json`, `data/versus/wadi_tarfan.json` (new) | Camps and income zones for the two matchup maps | 1 |
| `tools/validate_versus_rules.mjs` (new), `tools/validate_data.mjs` | Cross-file checks the schema cannot see | 1 |
| `packages/data/src/index.ts`, `packages/data/src/versus.ts` (new) | Export `doctrines`, `versusRules`; `versusMissionOf(rules, campSides)` the field-for-field loader | 1 |
| `packages/app/src/net/content-digest.ts` | Fold `doctrines` and `versusRules` | 1 |
| `packages/worker/src/match/match-room.ts`, `packages/net/src/config.ts` | LD1: side by faction; `sideOfFaction` | 2 |
| `packages/app/src/net/versus-force.ts`, `versus-seats.ts`, `match-world.ts` | Anchor and spawn order by SEAT; camera by seat | 2 |
| `packages/net/src/config.ts` | `economyRoom(config)` | 3 |
| `packages/app/src/net/match-world.ts` | Build the runtime; `matchTick(world)`; doctrine context | 3 |
| `packages/sim/src/mission.ts` | `unitLost` for a human-held side 1; `applyQueued` by `isHumanHeld` and `c.side` | 3, 4 |
| `packages/net/src/ownership.ts`, `SeatWorld` | `economy` flag; admit the four production kinds there | 4 |
| `packages/app/src/net/frame-step.ts` (`seatWorldFor`) | Feed `economy` | 4 |
| `packages/app/src/net/outcome.ts` | Production-aware standing | 5 |
| `packages/app/src/main.ts`, `ui/hud.ts`, `ui/versus.ts`, `i18n/en.json` | Dock, purse and pop by viewer side; no Conduct for Sarim; lobby copy | 6 |
| `tools/src/backtest/versus-probe.ts` (+ test) | Economy arm, production plan, sweep flags | 7 |
| `tools/src/net/two-client.test.ts`, `tools/src/net/agent-client.ts`, `tools/src/net/two-engine.ts` | Two-seat production stream; harness on `matchTick` | 3, 8 |
| `packages/sim/src/sim.ts` (patrol, if Q6 keeps it) | `setStance patrol` | 9 |
| Spec, CLAUDE.md | As built | 10 |

---

### Task 0: Pre-flight

- [ ] **Step 1:** Rebase target is `origin/main`; record its sha. Re-read every row of the
  pre-flight table above against it and note any that changed (GH-737 merged or not, F4 symbols).
- [ ] **Step 2:** Run `pnpm test:determinism`, `pnpm playtest`, `pnpm balance` and
  `pnpm versus:probe -- --maps=tel_marum,wadi_tarfan --seeds=48`. Save the four outputs to the
  ledger as the baselines every later "unmoved" is read against.
- [ ] **Step 3:** Confirm the lead's answers to Q1–Q9 are recorded in the ledger. Tasks 1, 3, 5, 7
  and 9 read them.

---

### Task 1: The versus rules file, the doctrines exported, and both in the content digest

No sim change. No pin moves (`contentDigest` carries no value pin).

**Files:** see the table (Task 1 rows). Test: `tools/src/validate_versus_rules.test.ts`,
`packages/data/src/versus.test.ts`, `packages/app/src/net/content-digest.test.ts`.

**Interfaces:**
- Produces:
  - `export const doctrines: Readonly<Record<'kdf' | 'sarim', DoctrineJson>>` (`@lions/data`).
  - `export const versusRules: Readonly<Record<string, VersusRulesJson>>`, keyed by map id.
  - `export function versusMissionOf(rules: VersusRulesJson, campSide: { friendly: 0 | 1; hostile: 0 | 1 }): MissionJson`.
    It returns `{ id: 'versus:' + rules.map, map: { file: rules.map }, ledger: { requires: [], produces: [] }, objectives: [], structures: [<friendly camp with side: campSide.friendly>, <hostile camp with side: campSide.hostile>], resources: { income_zones: rules.income_zones } }` and nothing else. **Side 0's camp is listed first** whichever end it stands on, so structure indices, and so line order, never depend on the spawn order.
  - `export function versusZonesOf(rules, mapZones): Record<string, readonly number[]>`: the map's
    zones plus the rules file's own, refusing a name clash.
  - `Content` gains `doctrines` and `versusRules`.

**The file shape** (`versus_rules.schema.json`, `additionalProperties: false` at every level):

```json
{
  "id": "wadi_tarfan",
  "map": "wadi_tarfan",
  "ends": {
    "friendly": { "camp": { "at": [8, 6], "size": [2, 2] } },
    "hostile":  { "camp": { "at": [38, 40], "size": [2, 2] } }
  },
  "zones": { "optional_extra_zone": [x, y, w, h] },
  "income_zones": [ { "zone": "centre_ford", "rate_per_min": 60 } ]
}
```

`friendly`/`hostile` are the two anchors `versusAnchors` returns, so the tunnels spec's T3 adds its
`tunnels` block under each end with no change of vocabulary. Camp `type` is always `camp` and is
not authored. The coordinates and rates go in **only as the lead approves them (Q2)**; the strawman
below is what is put to the lead.

- [ ] **Step 1: Write the failing validator tests.** `validate_versus_rules.test.ts`:
  - `rulesFor('wadi_tarfan')` and `rulesFor('tel_marum')` pass;
  - each of these is refused by name: a camp tile off the map; a camp tile on a blocked or
    building tile; a camp more than 6 tiles (Chebyshev) from its end's anchor; an `income_zones`
    name in neither the map's zones nor the file's own; a file zone whose name clashes with a map
    zone; `map` not in `FACTION_MATCHUP_MAPS`; a file for a map with none (each matchup map must
    have exactly one); `rate_per_min` outside 1..120.
  - `versus.test.ts`: `versusMissionOf(r, {friendly: 1, hostile: 0}).structures[0].side === 0`
    and its `at` is the hostile camp's; the output's keys are exactly the seven listed above.
- [ ] **Step 2: Run, watch red** (`pnpm --filter @lions/tools exec vitest run validate_versus_rules versus`).
- [ ] **Step 3: Implement** the schema, the two files with the approved numbers, the validator
  (wired into `validate_data.mjs` as `validate_doctrine.mjs` is), the exports and the loader. The
  anchor and the passability come from `@lions/data`'s own `parseMap` and `versusAnchors`'s table:
  the validator cannot import app code, so `tools/src/validate_versus_rules.test.ts` holds the
  anchor-distance rule against `versusAnchors` the way `validate_doctrine.test.ts` holds
  `VERSUS_SARIM`.
- [ ] **Step 4: Content digest.** Test first: changing one doctrine's `logistics_start` by 1, and
  one rules file's rate by 1, each gives a different digest; put back, the same. Then add both to
  `shippedContent()` and `contentDigest`.
  **Existing tests this breaks, to update in the same commit:** `content-digest.test.ts` ~L49
  (`shippedContentDigest() === contentDigest({ units, structures, maps })`: add the two new keys)
  and the `Content` literals at ~L65–79 (`withInfHp`, the structure, map-row and array-order cases),
  which spread a `Content` and must carry `doctrines` and `versusRules` too.
- [ ] **Step 5: Green** (`pnpm validate:data`, the three test files, `pnpm test`).
- [ ] **Step 6: Falsify.** M1 drop the anchor-distance check (its test red); M2 skip `doctrines`
  in `contentDigest` (digest test red); M3 list the hostile camp first in `versusMissionOf` (the
  side-0-first test red).
- [ ] **Step 7: Commit** `data(net): N3 Task 1 -- versus rules files, doctrines exported, both in the content digest`.

---

### Task 2: LD1 — KDF is side 0; the spawn end follows the seat

**Files:** `packages/net/src/config.ts`, `packages/worker/src/match/match-room.ts`,
`packages/app/src/net/versus-force.ts`, `match-world.ts`, `versus-seats.ts`, `main.ts` (camera),
`tools/src/backtest/versus-probe.ts` (arrangement labels). Tests beside each.

**Interfaces:**
- Produces:
  - `export function sidesOfMatchup(m: Matchup): [0 | 1, 0 | 1]` (`@lions/net`), by seat: mirror
    and `kdf` → `[0, 1]`; `sarim` → `[1, 0]`.
  - `export function endOfSeat(seat: Seat): 'friendly' | 'hostile'` — seat 0 (the host) is always
    `friendly`.
  - `versusSpawns(sim, typeOf, anchors, factions, ends?: readonly ['friendly' | 'hostile', 'friendly' | 'hostile'])`,
    `ends` by SIDE, default `['friendly', 'hostile']` (today).
  - `MatchWorld.endOfSide: readonly ['friendly' | 'hostile', 'friendly' | 'hostile']`.
  - `campOf(anchors, end)` takes an end, not a side.

**The byte rule.** `versusSpawns` places **the friendly end's force first**, whichever side stands
there. With a Sarim host that is side 1, so entity ids, and every per-entity RNG stream, are the
ones today's "Sarim west" game used; only the `side` values differ.

**The mirroring rule goes with it.** Today side 1's offsets are mirrored through its own anchor
(`bx - dx, by - dy`, `versus-force.ts` ~L88–94). That must become **by end**: the force at the
`hostile` end is the one mirrored, whichever side it is, and its facing is `hostileFacing` toward
the other end. Mirror by side and a Sarim host's force is flipped across its own anchor, and the
"game for game" claim below is false by construction.

**Existing tests that assume side = seat, to update in this task:** `match-world.test.ts` ~L39–40
and ~L50–55 (seat-to-side and spawn-side expectations); the Sarim-host configs in
`versus-force.test.ts` and `versus-probe.test.ts` (`arr=sarim/kdf` meant Sarim on side 0; it now
means Sarim at the friendly end, on side 1). The executor greps for `side: 0, faction: 'sarim'` and
`['sarim', 'kdf']` in `packages/app/src/net` and `tools/src` and lists every hit in the task report.

- [ ] **Step 1: Failing tests.**
  - `config.test.ts`: `sidesOfMatchup('sarim')` is `[1, 0]`; the room mints seat 0 as side 1 when
    the host picks Sarim, and `validateConfig` accepts it.
  - `match-world.test.ts` "host end follows the seat": a `sarim` room's side 1 units stand within
    3 tiles of `anchors.friendly`, side 0's of `anchors.hostile`; `endOfSide` is
    `['hostile', 'friendly']`; the Sarim host's camera starts on `friendly`.
  - The mirror pins (`1108074073` / `1524988923`) and the `kdf` room are byte-identical.
  - `versus-force.test.ts`: with a Sarim host, side 1's unit `k` stands where today's side-0 Sarim
    unit `k` stood, with the same facing (mirroring by end).
- [ ] **Step 2: Red, implement, green.**
- [ ] **Step 3: The fairness read-back (report-only, and the STOP rule applies).** Run
  `pnpm versus:probe -- --maps=tel_marum,wadi_tarfan --seeds=48` (the probe now labels cells by
  END: "KDF friendly", "Sarim friendly"). Every cell must read the Task 0 baseline **game for game**
  (same winner, same finish, same tick on all 48 seeds). If any game differs, the side swap leaks
  into play (a side-indexed tie-break): **STOP and report** with the first differing seed.
- [ ] **Step 4: Falsify.** M1 place side 0 first instead of the friendly end (Step 3 diverges,
  and the id-order test red); M2 `endOfSeat` returns `hostile` for seat 0 (host-end test red);
  M3 room mints `side: seat` again (config test red); M4 mirror by side instead of by end (the
  same-tile test red).
- [ ] **Step 5: Commit** `net, worker, app: N3 Task 2 -- KDF is side 0 (LD1); the spawn end follows the seat`.

---

### Task 3: The runtime boots in an economy room, through one `matchTick`

**Files:** `packages/net/src/config.ts`, `packages/app/src/net/match-world.ts`, `main.ts`,
`tools/src/net/agent-client.ts`, `packages/sim/src/mission.ts` (`checkEnd`'s no-objective guard and
`unitLost`). Reviewer: sim-guard.

**The wire is still closed in this task** (Task 4 opens it): `validateCommand` drops `build` in
versus and `applyQueued` skips `side !== 0`. **So every build in Task 3's tests is a direct call,
`runtime.requestBuild(unit, line, side)`**, made between ticks the way the sim tests already
call it. None of Task 3's tests sends a build through a frame.
Tests: `match-world.test.ts`, `packages/sim/src/runtime-seats.test.ts` (new), `two-client.test.ts`.

**Interfaces:**
- Consumes: Task 1's `versusMissionOf`, `versusZonesOf`, `doctrines`; Task 2's `endOfSide`.
- Produces:
  - `export function economyRoom(config: MatchConfig): boolean` (`@lions/net`): `mode === 'versus'`
    and the two seats' factions differ (Q1).
  - `MatchWorld.runtime: MissionRuntime | null` (null in a mirror room).
  - `export function matchTick(w: Pick<MatchWorld, 'sim' | 'runtime'>): { sim: SimEvent[]; mission: MissionEvent[] }`
    — `runtime?.applyQueued(); const ev = sim.tick(); return { sim: ev, mission: runtime?.step(ev) ?? [] }`.
  - `export function versusUnitInfo(menu: readonly string[]): MissionContext['unitInfo']`: for a
    menu id, `{ logistics, buildTimeS, population }` from the unit's `cost`; **no `unlock`, no
    `intel`**; null off the menu. The side argument picks the doctrine:
    `(id, side) => side's faction's menu`.
  - Context the room passes: `typeIdOf` = `typeOfBySide[0]` (the context has one lookup; Q7 records
    why that is exact under LD1); `markers`/`zones` = map's + `versusZonesOf`; `popCaps` = `[kdf.pop_cap ?? null, sarim.pop_cap ?? null]`
    by side; `economy` = `{ logisticsStart: [kdf, sarim] by side, logisticsRatePerMin: [0, 0] }`;
    `roadMask` from the map; no `ledger`, no `tunnels` (none registered by a matchup map today).

- [ ] **Step 1: Failing tests.**
  - `match-world.test.ts`: a mirror room has `runtime === null`; a `kdf` room on each matchup map
    has a runtime with one living line per side (`productionLines(0).length === 1`,
    `productionLines(1).length === 1`), `logisticsOf(0) === 3000`, `logisticsOf(1) === 4800` (or
    the Q3 values, read from the doctrine files, not literals), and a camp structure of each side.
  - **"build and lose"** (`packages/sim/src/runtime-seats.test.ts`, sim-level, and again on a real
    `kdf` room in `match-world.test.ts`): a mission with `objectives: []`, a side-0 camp and a
    placed side-0 unit that is NOT in `playerIds`; `requestBuild` one `inf_squad` directly, step
    until it spawns, `debugKill` it. Assert `runtime.result === null`, `step()` still returns events
    on the next tick, the purse still accrues from a held zone, and a second direct `requestBuild`
    starts and finishes. **Shown red without the guard** (the runtime ends as a defeat the tick the
    built unit dies); the commit records it.
  - "never ends": a `kdf` room stepped 30,000 ticks (the 25-minute cap) with `matchTick` and no
    orders has `runtime.result === null` and keeps producing (a direct `requestBuild` at tick
    29,000 starts).
  - `runtime-seats.test.ts` (sim): with `humanHeld [true, true]` a side-1 death emits `unitLost`
    with `side: 1`; with the default table it does not (single-player unchanged).
  - **The pin born:** `VERSUS_ECONOMY_PINS` = `[['tel_marum', <n>], ['wadi_tarfan', <n>]]`,
    seed 20260727, 200 ticks, `matchDigest(sim.hash(), runtime.digest(), 0)`. Recorded at first
    green; the commit says "born".
  - `two-client.test.ts`: two clients on a `kdf` `tel_marum` room, 400 ticks of the existing
    frame stream, equal reported digests every hash tick, and `runtimeDigest` non-zero.
- [ ] **Step 2: Red, then implement.** `buildMatchWorld` builds the runtime after the forces, so
  every entity id and the mirror bytes are as before. `main.ts`'s room path takes `world.runtime`
  (today it holds `runtime === null` in a room) and its `runTick` body calls `matchTick`;
  `agent-client.ts`'s `runTick` calls `matchTick` too and passes `runtimeDigest: () => w.runtime?.digest() ?? 0`.
  The `unitLost` change: emit for `side === 0`, or for `side === 1` when `sim.isHumanHeld(1)`.
  The `checkEnd` guard: `if (this.objectives.length === 0) return;` as its first line, with a
  comment naming the reason (a runtime with nothing to win is ended only by `outcome.ts`). It is
  the cleaner of the two options the coordinator allowed: it follows from data, adds no field to
  `MissionContext`, and a single-player mission cannot reach it.
- [ ] **Step 3: Green**, including `pnpm test:determinism` with every sim and economy pin unmoved
  (no fixture passes `[true, true]` to a runtime), and the mirror pins unmoved.
- [ ] **Step 4: Falsify.** M1 drop `applyQueued` from `matchTick` (two-client equal but the
  "build starts" assertion red); M2 the harness keeps its old `runTick` (a harness-vs-browser
  digest test, written in Step 1 as part of `two-client.test.ts`, red at tick 19); M3 pass
  `economy.logisticsStart` in file order instead of by faction (the 3000/4800 assertion red for a
  `sarim` host); M4 emit side-1 `unitLost` unconditionally (single-player case red); M5 delete the
  `checkEnd` guard (both build-and-lose tests red).
- [ ] **Step 5: Commit**, then a separate commit for the pin birth if it is recorded apart.

---

### Task 4: Side 1 builds over the wire (the lift)

**One commit**, as LD6 and the spec require. Reviewer: sim-guard plus one.

**Files:** `packages/sim/src/mission.ts` (`applyQueued`), `packages/net/src/ownership.ts`,
`packages/app/src/net/frame-step.ts` (`seatWorldFor`), `packages/app/src/main.ts` (`cmdSink` room
branch). Tests: `packages/sim/src/runtime-seats.test.ts`, `packages/net/src/ownership.test.ts`,
`packages/app/src/net/room-pause.test.ts`.

**Interfaces:**
- `SeatWorld.economy: boolean` — `economyRoom(config)`, false in single-player.
- `validateCommand`: `build`, `cancelBuild`, `clearRally` → `(!world.versus || world.economy) && cmd.side === side`;
  `setRally` adds `onMap`. `support`, `callStrike`, `reveal`, `raiseWorks`, `cancelWorks` unchanged
  (still `!world.versus`).
- `applyQueued`: `if (!this.sim.isHumanHeld(c.side)) continue;` replaces `c.side !== 0`, and the
  four production kinds pass `c.side` (narrowed to `0 | 1`). `support`, `raiseWorks`,
  `cancelWorks` refuse `c.side !== 0` explicitly (they have no side parameter; LD5).

- [ ] **Step 1: Failing tests.**
  - sim: under `[true, true]`, queued `build{side:1}` on a side-1 camp line spends `purse[1]` and
    enqueues on `productionLines(1)[0]`; `cancelBuild{side:1, line:0, index:0}` refunds `purse[1]`
    and leaves side 0's line and purse untouched; `setRally{side:1}` sets side 1's rally;
    `support{side:1}`, `raiseWorks{side:1}` and `cancelWorks{side:1}` are each refused, with side 0's
    purse and works untouched (`requestConstruct` and `requestCancelWorks` have no side parameter,
    so without the explicit refusal they would act for side 0); under the default table every
    side-1 kind is refused (today).
  - net: in an economy room, seat 1 (side 1) passes `build{side:1}`, seat 0 sending `build{side:1}`
    drops; in a **mirror** room every production kind still drops; `support` drops in both.
  - app: the dock pre-check in a room consults `ordersWait(room.status())` before noting a buy
    (the spec §11b.4 follow-up, now reachable).
- [ ] **Step 2: Red, implement, green.** Every sim, economy and runtime-digest pin unmoved;
  `pnpm playtest` and `pnpm balance` byte-identical (single-player's table is `[true, false]`).
- [ ] **Step 3: Falsify.** M1 drop `c.side` from the `cancelBuild` call (side-1 cancel test red:
  side 0 refunded); M2 `world.economy` ignored (mirror-drop test red); M3 `isHumanHeld` replaced by
  `true` (single-player side-1 refusal red); M4 admit `support` with the others (LD5 test red);
  M5 drop the explicit side refusal for `raiseWorks` (its side-1 test red: side 0 is charged).
- [ ] **Step 4: Commit** `sim, net, app: N3 Task 4 -- both seats build through F4's lines in an economy room`.

---

### Task 5: The win rule counts production

**Files:** `packages/app/src/net/outcome.ts`, `outcome.test.ts`, `main.ts` (pass the runtime).

**Interfaces:**
- `export interface OutcomeProduction { canField(side: 0 | 1): boolean }`, where `canField(s)` is
  true when side `s` has a living production line AND (an armed item is queued or in progress on
  any of its lines, OR `logisticsOf(s)` covers the cheapest **armed** unit on its menu).
- `outcomeOf(sim, tick, costOf?, production?: OutcomeProduction)`: a side is standing when
  `armedStanding(sim, side) || production?.canField(side) === true`. Absent `production` is
  today's rule exactly.
- `hashTickOutcome`/`decideOnHashTick` take `production` through; the room passes one built from
  `world.runtime`, a mirror room passes none.
- Force value at the stalemate or the cap stays **units only** (Q5).

- [ ] **Step 1: Failing tests.** A Sarim side with no armed unit, a living camp and a purse equal to
  its cheapest armed menu unit (computed from data in the test; `rocket_battery`, 201, at
  `8eeea195`) is `ongoing`; the same side one logistics short, with an empty queue, loses by
  annihilation; with a queued `atgm_cell` and
  purse 0 it is `ongoing`; with its camp destroyed it loses. Mirror (no `production`) results equal
  today's on every existing case.
- [ ] **Step 2: Red, implement, green.** `allImmobile` stalemate: a side that `canField` is not
  immobile (it can still produce a mover) — test it.
- [ ] **Step 3: Falsify.** M1 ignore the queued-item clause (queued test red); M2 count unarmed menu
  units when taking the cheapest (a test menu of `recon_drone` and `inf_squad` with a purse of 250,
  which covers only the unarmed drone, must lose; red under the mutation. The shipped menus cannot
  show it: no unarmed unit is the cheapest on either); M3 drop the living-line clause (camp-destroyed test red).
- [ ] **Step 4: Commit.**

---

### Task 6: The app — dock, purse and pop by viewer side; LD7; the lobby

**Files:** `packages/app/src/main.ts`, `ui/hud.ts` (dock, purse, pop), `ui/versus.ts` (lobby),
`i18n/en.json`. Tests beside each.

**Interfaces:** the HUD reads `runtime.productionOf(me)`, `runtime.logisticsOf(me)`,
`runtime.populationView(me)`, and `buildBlockedReason(unit, me)`, where `me = viewerSideOf(...)`.
The dock lists the viewer faction's doctrine menu. Every dispatch carries `side: me`.

- [ ] **Step 1: Failing tests.** In a `sarim` room, seat 0 (side 1): the dock lists the six Sarim
  menu ids in doctrine order, the purse shows 4800 (doctrine value), a click dispatches
  `build{side:1}`. No Conduct line or panel renders for a Sarim viewer; it renders for the KDF
  viewer (LD7). The intel figure and the support menu are absent in every versus room (LD5). The
  lobby's KDF-v-Sarim option reads the new key `versus.matchup.economy` ("Camps, income and
  production on").
- [ ] **Step 2: Red, implement, green.** `pnpm validate:ui` green (no bare strings).
- [ ] **Step 3: Falsify.** M1 the dock reads side 0 (Sarim-viewer menu test red); M2 Conduct shown
  regardless (LD7 test red).
- [ ] **Step 4: One Metal browser check** on your own port, music off: a local room (two contexts)
  on `wadi_tarfan`, each seat buys one unit; both boards show the arrival on their own side only.
  Screenshots to the ledger. No `ui:routes` locally.
- [ ] **Step 5: Commit.**

---

### Task 7: Fairness at the GH-561 bar (report-only; the STOP rule applies)

**Files:** `tools/src/backtest/versus-probe.ts`, `versus-probe.test.ts`.

**Interfaces:**
- `--economy` runs a room's world: `buildMatchWorld(config)` and `matchTick`, a `kdf`/`sarim`
  config per spawn order.
- **The production plan** (both seats, deterministic): every 20 s, while `canBuild`, queue the
  cheapest armed menu unit not queued last time, cycling the menu in doctrine order; rally the
  line to the own anchor; attack-move as today. Nothing reads the other side's purse.
- Sweep flags, applied as an in-memory override of the doctrine/rules data, never written to disk:
  `--start=<kdf>/<sarim>`, `--cap=<kdf>/<sarim>`, `--rate-scale=<percent>`.
- Bar: 48 seeds per spawn order, both maps, neither faction above 60%.

- [ ] **Step 1: Self-check first** (exit 2 on failure): the existing two controls plus one
  economy control — the side whose camp is destroyed at tick 0 and whose force is cut to one unit
  must lose. Mutation: the production plan never queues (the economy control still passes, so add
  "at least one `built` per side per game" to the self-check; red with the no-queue mutation).
- [ ] **Step 2: Run** the four cells (2 maps × 2 ends) at the approved values. Record the table.
- [ ] **Step 3: If every cell is inside 60/40:** record it and go on. **If any is outside: STOP.**
  Report the table and the sweep the lead can choose from (Step 4) — do not tune on your own.
- [ ] **Step 4 (only if asked):** sweep `--start` (Sarim ratio held at 8/5 unless Q3 says
  otherwise), then `--cap`, at 24 seeds, and re-read the chosen point at 48.
- [ ] **Step 5: Commit** the probe and the table (in the commit message and the spec §7.1).

---

### Task 8: Two-client and two-engine determinism with both seats producing

**Files:** `tools/src/net/two-client.test.ts`, `tools/src/net/two-engine.ts`.

- [ ] **Step 1: Two-client test.** A `sarim` `wadi_tarfan` room; a 1,200-tick frame stream in
  which both seats `build` (several units), `cancelBuild` one queued item, `setRally` and
  `clearRally`, and seat 0 forges one `build{side:0}` (it is side 1). Assert: equal reported
  digests at every hash tick; the forged command dropped on both; each side's `built` count equal
  across clients and > 0; `runtimeDigest` non-zero.
- [ ] **Step 2: Falsify.** Feed client B one frame out of order (red at that tick); drop the
  `cancelBuild` from client B only (red by the next hash tick); disable `validateCommand` on both
  (the forged build executes: the "dropped" assertion red).
- [ ] **Step 3: `net:engines`** gains the same stream (Chromium, Firefox, WebKit, CI only), final
  digest compared to Node's.
- [ ] **Step 4: Commit.**

---

### Task 9 (Q6): `setStance patrol`

Only if the lead keeps it in N3. Recommended design: **sim-native**, so "any later order drops the
patrol" is the `stance` column's existing reset ("any order overrides a held stance",
`sim.ts` ~L4017), not new interception in the runtime.

**Interfaces:** `Command` `setStance` gains `stance: 'patrol'` with `waypoints: [Fx, Fx][]`, 2 to
`MAX_PATROL_WAYPOINTS` (4), integer Q16.16, each on the map (`cleanCommand`, `validateCommand`).
`stance` value 2; per-unit `patrolX`/`patrolY` (`Int32Array(capacity * 4)`) and `patrolIdx`;
folded into `hash()` only behind `patrolLive` (the `mobLive`/`fwLive` pattern), so no pin moves.
A `stepPatrolStance` in the tick walks them with `stepPatrols`' halt-to-fire rule.

- [ ] **Step 1: Failing tests:** a patrol walks its loop; a `move` naming the unit ends it; a
  routed or buried unit holds its index; a world that never patrols keeps every pin.
- [ ] **Step 2: Red, implement, green** (`pnpm test:determinism` every pin unmoved).
- [ ] **Step 3: Falsify:** remove the `stance` reset on `move` (red); fold the columns
  unconditionally (golden pins red — then restore).
- [ ] **Step 4: Commit** (sim-guard reviews).

---

### Task 10: Docs as built, and the gate

- [ ] **Step 1:** Spec §7.1 "N3 as built" (commit per row), §9's N3 row, §6.1's LD1 sentence, the
  pin table below filled with real values. CLAUDE.md's production bullet: "`applyQueued` asks
  `isHumanHeld`; `validateCommand` admits the four production kinds in an economy room".
- [ ] **Step 2:** All gates green; open the PR (merge commit). **The N3 gate is the lead's:** five
  KDF-v-Sarim matches (spec §9).

---

## Pin table

| Pin (value at `8eeea195`) | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 |
|---|---|---|---|---|---|---|---|---|---|
| Golden flat `3719067886`, relief `2842924511`, orders `3272041047` | — | — | unmoved | unmoved | — | — | — | — | unmoved (live gate) |
| `ECONOMY_PIN` `904873885`, `_RELIEF` `2771311510` | — | — | unmoved | unmoved (no fixture passes `[true, true]`) | — | — | — | — | unmoved |
| `RUNTIME_DIGEST_PIN` `2037118941`, `_RELIEF` `1884258391` | — | — | unmoved | unmoved | — | — | — | — | unmoved |
| `WOUNDED_WORLD_PIN` `1774950105` | — | — | unmoved (`unitLost` is an event, unhashed) | unmoved | — | — | — | — | unmoved |
| versus-force mirror `3296182002` / `1524988923` | — | unmoved (mirror: side = seat) | unmoved | — | — | — | — | — | — |
| match-world mirror `1108074073` / `1524988923` | — | unmoved | unmoved (mirror: no runtime) | — | — | — | — | — | — |
| per-seat-types control `580559085` | — | unmoved | unmoved | — | — | — | — | — | — |
| `VERSUS_ECONOMY_PINS` (tel_marum, wadi_tarfan) | — | — | **born** | unmoved (the stream issues no build) | — | — | — | — | — |
| `shippedContentDigest()` (no value pin) | changes | — | — | — | — | — | — | — | — |
| `two-client.test.ts` (equality) | — | holds | holds, + economy room | holds | — | — | — | extended | holds |
| `pnpm playtest` (outcomes, `LADDER_CREDITS` `5920`, `ROSTER_MAX` `29`) | identical | identical | identical | identical | — | — | — | — | identical |
| `pnpm balance` | identical | identical | identical | identical | — | — | — | — | identical |
| `versus:probe` placed-force cells (GH-725) | — | **game-for-game identical** (STOP if not) | — | — | — | — | — | — | — |
| `versus:probe --economy` cells | — | — | — | — | — | — | **new reading, report-only** (STOP if outside 60/40) | — | — |
| Arena seed-40595 checks (`players.test.ts`, `arena.test.ts`, `external-player.test.ts`) | — | unmoved (mirror) | unmoved | — | unmoved | — | — | — | — |

---

## Questions for the lead (each with a recommendation)

**All nine accepted as recommended by the lead, 22 Oct (posted on GH-741).**

1. **Economy in the mirror?** **Recommend: KDF-v-Sarim only in N3.** The mirror keeps today's
   placed-force rooms, so its measured seats, its pins and the arena's controls stay; a mirror
   economy is a later, separately probed step (`milh_flats`, `beit_sahwan_outskirts` need rules
   files and a fresh 60/40 read).
2. **Camps and income zones (the numbers).** Strawman for approval: each camp 2×2, 3 tiles behind
   its end's anchor on the anchor axis (`validate:data` holds it within 6). Wadi Tarfan uses its
   own zones: `centre_ford` 60/min, `ne_ford` and `sw_ford` 40, the four bluffs 20, the four farms
   20 (point-symmetric). Tel Marum uses `pass` 40, `approach` 40, `overwatch_east` and
   `overwatch_west` 20, `ammo_draw` 20. **Recommend: approve as the first probe run**, and let
   Task 7's table say whether Tel Marum's asymmetry needs a zone moved.
3. **Start purses.** The doctrines hold 3000 / 4800 (8/5), marked `provisional`. **Recommend: keep
   both placed forces and these purses for the first probe run; keep 8/5 and sweep only the KDF
   base if a cell is outside the bar.**
4. **Population caps.** The placed forces already take 22 (KDF) and 32 (Sarim). **Recommend:
   KDF 40, Sarim 56** (the same 18 + 24 headroom, roughly the purse ratio), written to the doctrine
   files' `pop_cap`, swept by Task 7 if needed.
5. **Purse at the cap.** Decision 24 counts surviving unit value. **Recommend: units only** — the
   purse and queued items do not count, so hoarding never wins a timed-out match.
6. **`setStance patrol` (L3).** **Recommend: build it as Task 9, sim-native and live-gated**, so a
   later order drops it through the existing stance reset and no pin moves. Alternative: cut it to
   a follow-on (the Sarim seat has `hold` and `ambush`), saving one sim task.
7. **Per-side kit and production.** A `brigade` room patches KDF types per side, but the runtime
   takes one `typeIdOf`, so a KDF unit **built** in a brigade room spawns with side 0's kit.
   KDF is always side 0 (LD1), so in a KDF-v-Sarim room this is exact. **Recommend: no change in
   N3**; note it for the day a mirror room gets an economy.
8. **The N2 Task 8 skips (waves, side-1 triggers, patrols on a human-held side).** A versus rules
   file has no field for any of them, so nothing can reach them. **Recommend: do not build them in
   N3**; the schema refusing those fields is the guard. Build them when a rules file first needs a
   trigger.
9. **The loader.** `versusMissionOf` copies the rules file field for field into a `MissionJson`
   (no authored value lives in TypeScript). **Recommend: accept this as "data, not TypeScript"**;
   the alternative, a mission-shaped rules file, must satisfy `mission.schema.json`'s required
   objectives, ledger and time limit, which a versus match does not have.
