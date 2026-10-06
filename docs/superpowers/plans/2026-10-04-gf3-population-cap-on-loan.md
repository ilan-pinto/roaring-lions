# WP-G-F plan F3: the population cap, and units "on loan" (GH-183, G3 Q4 and Q5). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Changed since 4 Oct

Refreshed against `main` `b44df7aa` (v0.121.4, 6 Oct). F1 has not landed (`economyHash` and the
`ECONOMY_PIN*` constants are not in the tree), so Task 4 still waits on it.

Landed, touching F3:
- **#402**, infantry halt to fire (`7962b6ea`, 6 Oct, a lead-approved one-off sim change): `UnitType.haltsToFire`,
  parsed in `unitTypeFromJson` (sim.ts ~L540), where Task 1's `population` goes. Sim pins 2109596329 /
  1425295494 → 922714084 / 3200430224; `LADDER_CREDITS` 5844 → 5830; `ROSTER_MAX` 33 → 31. Its
  `tools/src/halt_to_fire_roster.test.ts` is the precedent for pinning a parsed field on the shipped roster.
- **GH-382** (5 Oct): every arc's II+ missions on new maps. For F3, coordinates only: units, counts,
  `from_ledger`, `upgrades_to`, `resources` and `target_minutes` are unchanged against `751b6742` (my
  diff), so both G3 censuses recount identically. Ladder 5736 → 5844; `ROSTER_MAX` 30 → 33.
- **GH-330** (`44e5874a`, after `067fab9a`): `CAMPAIGN_CREDITS` (`stores-model.ts` L63) is held equal to
  `LADDER_CREDITS` by `tools/src/campaign_credits.test.ts`, so a Task 7 ladder re-pin moves both.
- **GH-119**: `briefing_sections` must spell `briefing` exactly. F3 edits no briefing.

Interactions:
- **Loan and halt to fire never meet in code.** The flag is per TYPE and follows the type fielded after
  `resolveUpgrades`: a loaned `demo_squad`, `yahalom_squad` or `sniper_team` kneels to fire; a loaned Lavi,
  Namer, drone or D9 never braces. No app code reads `haltsToFire`, `LedgerRosterEntry` holds no brace
  state, and a kneeling, carried or garrisoned unit is alive and counts under D1.
- **Fixture trap** (Tasks 1, 3, 7): a test unit type with no `role` derives as wheeled, so it never braces
  and cannot embark. Infantry fixtures declare `role: 'infantry'`.
- **The `(bought)` probes** are built, so never on loan. L-1 reaches them only through pools: `ledUZ3`
  descends from Tel Marum III, which the harness runs on `{}`; `led4In` (the Zikit whose post #402
  re-fitted) from the breach's rating (R, Task 7 Step 1).

### For the lead
No 4 Oct ruling (G3 Q4: cap off in the campaign, on in skirmish/co-op, used/cap on the HUD when on; Q5:
missions may lend, marked "on loan") conflicts with what landed. Three questions:
1. Since GH-330, an L-1 move of `LADDER_CREDITS` also moves `CAMPAIGN_CREDITS`, the figure the store
   quotes per campaign. Is that inside the L-1 confirmation Task 7 asks for, or does it need its own word?
2. (Found in the refresh, not a landing.) Task 8 has no row to mark: both deploy surfaces list only
   `from_ledger` draws, and D5 never lends one, so no loaned unit appears on the deploy screen today.
   Where should "on loan" sit: a new list of issued placements beside "What you brought", or elsewhere?
3. (Found in the refresh, not a landing.) A `from_ledger` draw that finds no survivor spawns a fresh
   remnant (mission.ts ~L1276-1289). Should D5 still call that body never on loan when its type is gated?
   9 of the 68 gated lines are `from_ledger`.

**Goal:** Two small rulings, made real.

| ruling (lead, 4 Oct) | today (`main` `067fab9a`, re-checked on `b44df7aa`) | after F3 |
|---|---|---|
| **Q4.** A population cap, available per mission and doctrine: **off in the campaign, on in skirmish and co-op**. The HUD shows used/cap when it is on | 34 of the 35 unit JSONs declare `cost.population` (drones 0, most teams 1, APCs 2, Lavi 3); `civilians.json` takes the schema default 1 (`unit.schema.json` L82-86) and stands on side 2; **nothing reads it** (M, G3 sheet; still true on `b44df7aa`, grep) | the runtime counts it; a cap, when set, refuses builds past it; the validator refuses a cap on any campaign mission |
| **Q5.** Missions may **lend** locked units, and the deploy screen marks them **"on loan"** | `starting_force` never consults `unlock`; 68 gated placement lines in 26 of 27 missions (M at `751b6742`; my recount on `b44df7aa` is unchanged: 68 in 26, 9 of them `from_ledger`, only `beit_sahwan_breach` has none); CLAUDE.md calls it "undecided" | a documented feature; one pure predicate names the loaned placements; the deploy screen marks them; a loaned survivor goes back to the lender (L-1, the one decision here that can move a pin) |

**Architecture:**
- **The cap is `MissionRuntime`.** Population is read from `UnitType.population` (new, parsed in
  `unitTypeFromJson` from the JSON the sim already loads, not hashed, read by no sim system), summed
  over a side's living units plus its queued builds. The cap comes from the mission (`resources.pop_cap`) or from the
  runtime context (`MissionContext.popCaps`), which is the door G-G's doctrine loader and G-H's co-op
  setup will use. No campaign mission sets one, so no campaign outcome can move.
- **"On loan" is one pure predicate in `unlock.ts`**, beside `unlockReason` and `resolveUpgrades`,
  so the runtime and the deploy screen read the same answer (the `missionShepherds` pattern from the
  Stage 4 sim-fix plan, `docs/superpowers/plans/2026-09-29-stage4-sim-fixes.md`).

**Tech stack:** TypeScript strict, vitest (jsdom for the deploy screen).

**Refs:**
- GH-183 F3 and F4's "a ruling on `starting_force` never consulting `unlock`". GH-167 (G3) Q4 and Q5,
  the lead on 4 Oct.
- The G3 decision sheet (PR #369, `docs/superpowers/specs/2026-10-04-g3-decision-sheet.md`), Q4 (the
  population census: KDF starting 6–20, Sarim ×1/×2 at 20/27 pop against the KDF's 10, so an equal cap
  would undo Q7) and Q5 (the 68-line census, Wadi Halam V's two demolishers, `upgrades_to`/`gate_only`
  as the sanctioned restraint path). All M at `751b6742`, before GH-382 and #402. The JSON half
  recounts identically on `b44df7aa` (my count: authored starting population 6–20 bar the tutorial's 1,
  `umm_zeitoun_4_clearance` 20; still 6 `upgrades_to` sites, `gate_only` on `qarn_hadid_3_clearance`'s
  jeep only). The Sarim figures come from the skirmish spike and are not in the tree.
- CLAUDE.md, "Known scaling debts", the `starting_force` paragraph (rewritten in Task 9).
- `packages/app/src/ui/deploy-roster.ts`, `ui/loading.ts` (`broughtFor`): the deploy surfaces.

**Base:** read against `main` `067fab9a`, refreshed against `b44df7aa` (6 Oct). Branch `feat/gf3-popcap`,
cut from `main` after F1 lands. Nothing measured yet: (M) is quoted from the G3 sheet, (R) is reasoned.

---

## Decisions

- **By the lead, 4 Oct:** Q4 and Q5 as in the table.
- **Taken defaults (confirm or overrule):**
  - **D1. Population counts every living unit of the side**: garrisoned, carried, buried. A carried
    squad is still a squad. Dead units free their population on death; a unit evacuated off the map
    is dead (`alive = 0`) and frees it too.
  - **D2. A queued build reserves its population at queue time**, as it pays its logistics at queue
    time today. Otherwise five builds queued against a cap of one free slot all succeed.
  - **D3. A cap never removes anything.** A starting force, a trigger spawn or a wave above the cap
    stands; builds are refused until the side is back under. Authored spawns ignore the cap (they are
    the mission's, not the side's purse). F4's enemy production is a build and **does** obey it.
  - **D4. "Off in the campaign" is enforced by `validate:data`**: `resources.pop_cap` is refused on
    every mission in `data/missions/` that declares a `town`. A future build-up mission that wants
    one needs the lead to lift the rule, which is the point. (`town` is a required field,
    `mission.schema.json` L7-14, so on today's tree the rule refuses `pop_cap` in every mission file,
    the tutorial included.)
  - **D5. A placement is on loan** when its unit's unlock gate, as resolved for this ledger (bought
    included, through `kdfUnlockGate`: `packages/app/src/kdf-gate.ts` in the app, the harness's own
    copy plus `withBought` at playtest.ts ~L119/~L238), is closed, **after** `resolveUpgrades`: a
    placement upgraded to an open unit is not on loan; a `gate_only` placement dropped by a closed
    gate is not on the field at all; a `from_ledger` placement is never on loan (it is the brigade's
    own body). (On a fresh or gutted roster a `from_ledger` draw spawns a fresh remnant instead,
    mission.ts ~L1276-1289: see "For the lead" 3.) Halt to fire follows the fielded type, loan or not
    (#402).
  - **L-1. A loaned survivor goes back to the lender.** "For that mission" (the lead's Q5 wording)
    means the unit does not join `roster.surviving_units` at mission end. Today every starting-force
    survivor without `from_ledger` appends a new roster entry, so a lent Lavi would become the
    brigade's permanently, gate or no gate. **This can move the playtest roster lines (`ROSTER_MAX`,
    31 on `b44df7aa`, 30 on 4 Oct) and, through later `from_ledger` draws, outcomes and
    `LADDER_CREDITS` (5830 on `b44df7aa`, 5736 on 4 Oct), and with it `CAMPAIGN_CREDITS` (GH-330).**
    It halts at Task 7 for the lead's confirmation. The credit formula is untouched either way:
    `creditInputFrom` (`packages/sim/src/credits.ts` L59) reads `startingCount`/`startingHome`, and a
    loaned unit that comes home still counts as home.

---

## Global Constraints

- **The four invariants hold.** Population sums are integers. No `rng`. The sim gains one parsed,
  unhashed, unread field (`UnitType.population`); no sim system reads it.
- **Sim pins unmoved** by every task (flat 922714084, relief 3200430224 on `b44df7aa`,
  `determinism.test.ts` L427/L721; they were 2109596329 and 1425295494 on 4 Oct, moved by #402). A
  move is a defect.
- **The economy pins move once**, in Task 4, with the reason.
- **`pnpm balance`** byte-identical (R).
- **`pnpm playtest`** byte-identical through Task 6 (R: no campaign mission sets a cap, and the
  predicate changes nothing it does not mark). Task 7 (L-1) moves roster lines by design; anything
  downstream is measured and named.
- **Every check seen red**, by a one-line mutation, quoted in the commit.
- **Gates before every commit**: as F1, plus `pnpm validate:ui` for Task 8.
- **Git, TypeScript:** as F1. Task 8 is **Lane A** (`packages/app`), done by the lane A agent and
  landed in F3's PR when lane A is free; otherwise it moves to WP-S-F #184 unchanged.

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/sim.ts` (+ `sim.test.ts`) | `UnitTypeJson.cost`, `UnitType.population`, parsed in `unitTypeFromJson` (which `addUnitType` calls) | 1 |
| `tools/src/` (a shipped-roster spec, beside `halt_to_fire_roster.test.ts`) | The shipped-JSON assertions of Tasks 1 and 6 | 1, 6 |
| `data/schemas/mission.schema.json`, `tools/validate_data.mjs` + a new pure rule module and its `tools/src/*.test.ts` | `resources.pop_cap`; the campaign refusal | 2 |
| `packages/sim/src/mission.ts` (+ test) | `population(side)`, `popCap(side)`, `populationView()`, the build refusal | 3, 4, 7 |
| `packages/app/src/main.ts` (~L2102), `tools/src/backtest/playtest.ts` (~L259) | The two runtime `unitInfo` builders gain `population` | 3 |
| `packages/sim/src/determinism.test.ts` | The economy re-pin | 4 |
| `tools/src/backtest/playtest.ts` | The population census line; Task 7's pins | 5, 7 |
| `packages/app/src/ui/stores-model.ts` (`CAMPAIGN_CREDITS`) | Moves with `LADDER_CREDITS` if Task 7 moves it (GH-330) | 7 |
| `packages/sim/src/unlock.ts` (+ test), `index.ts` | `loanedPlacements` | 6 |
| `packages/app/src/ui/deploy-roster.ts`, `ui/loading.ts`, `i18n/en.json` (+ tests) | The "on loan" mark | 8 |
| `docs/GDD.md`, `data/schemas/mission.schema.json` (`starting_force` description), `CLAUDE.md`, `docs/campaign/README.md`, `docs/HANDOVER.md` | The documented feature | 9 |

---

## Task 1: the sim carries population, and reads none of it

**Model:** haiku. **Agent:** `sim-guard`.

**Files:** `packages/sim/src/sim.ts`, `packages/sim/src/sim.test.ts`; the shipped-roster assertion in
`tools/src/` (see Step 1).

On `b44df7aa`: `UnitTypeJson` (sim.ts ~L158) has no `cost` field yet and gains
`cost?: { population?: number }`; the parse goes in `unitTypeFromJson` (~L494, called by `addUnitType`
~L1327), in the same return object as #402's `haltsToFire` (~L540). The house test for a parsed field
calls `unitTypeFromJson` directly (`brace.test.ts` ~L133, `facing.test.ts` ~L147). Fixture trap from
#402: a fixture with no `role` derives as wheeled. Population does not depend on it, but say which
role a fixture stands for.

- [ ] **Step 1: Write the failing tests:** `unitTypeFromJson` of a JSON with `cost.population: 3` gives
  `population === 3`; absent gives 1 (the schema default); `recon_drone`'s shipped JSON gives 0.
  Assert from literals, not by re-reading the JSON under test. The `recon_drone` case reads shipped
  data, which no `packages/sim` test does, so it goes in `tools/src/`, the way
  `tools/src/halt_to_fire_roster.test.ts` pins `haltsToFire` over `@lions/data`'s `units`.
- [ ] **Step 2: Implement.** Integer, validated ≥ 0.
- [ ] **Step 3: Measure.** Both sim pins unmoved (unit types are not hashed; if `hash()` ever folds
  type tables, stop and raise it).
- [ ] **Step 4: See it red.** Default to 0: the "absent gives 1" test fails.

---

## Task 2: the field, and "off in the campaign"

**Model:** sonnet. **Agent:** `mission-author`.

**Files:** `data/schemas/mission.schema.json` (`resources`, ~L270-291), `tools/validate_data.mjs` and a
new pure module beside it, with its spec in `tools/src/`. `validate_data.mjs` runs its whole sweep at
import time and has no spec of its own, so a rule that needs tests lives in a pure module it imports:
`validate_briefing.mjs` (wired at validate_data.mjs ~L1080, spec `tools/src/validate_briefing.test.ts`)
is the pattern.

**Interfaces (schema):** `resources.pop_cap: { "type": "integer", "minimum": 1, "description":
"Player-side population cap. Off in the campaign (lead, G3 Q4, 4 Oct): refused on any mission with a
town. Skirmish and co-op set it through the doctrine." }`

- [ ] **Step 1: Write the failing validator tests:** `pop_cap: 18` on a mission with `town` is refused
  by name and cites G3 Q4; the same on a fixture with no `town` passes; `pop_cap: 0` is refused by the
  schema. (`town` is schema-required, L7-14, so the town-less fixture exercises the pure rule
  function directly; the full gate would refuse it for the missing `town` first.)
- [ ] **Step 2: Implement.** `pnpm validate:data` passes on the shipped tree (no mission sets one).
- [ ] **Step 3: See it red.** Remove the town check: the campaign test passes a capped campaign
  mission.

---

## Task 3: counting, and refusing past the cap

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 1.

**Files:** `packages/sim/src/mission.ts` and its test.

**Interfaces:**

```ts
export interface MissionContext { /* … */
  /** Doctrine or co-op caps, by side; overrides `resources.pop_cap`. null = uncapped. */
  popCaps?: readonly [number | null, number | null];
}
population(side: 0 | 1): number;            // living units (D1) + queued reservations (D2)
popCap(side: 0 | 1): number | null;
populationView(): { used: number; cap: number } | null;   // side 0; null when uncapped (HUD hides)
// buildBlockedReason gains, after the unlock and camp checks:
//   `population cap reached (${used}/${cap})`
// unitInfo(id) gains `population: number`
```

On `b44df7aa`, `buildBlockedReason` (mission.ts ~L601) checks, in order: no `unitInfo` →
`'not available in the field'`; `unlockReason(...)`; then the camp, which **returns `null` early when a
camp stands** (~L611) before `'field camp destroyed — no production'` and
`'no field camp — production needs one standing'`. The population check must not sit behind that early
return. `requestBuild` (~L671) pays and pushes onto `buildQueue` (~L517); queued entries carry no side
(player only). Two runtime `unitInfo` builders return `{ logistics, buildTimeS, unlock }` today and both
need `population`: `main.ts` ~L2102 and `playtest.ts` ~L259. D1's states are `sim.state.carriedBy`,
`garrisonedIn` and `tunnelIn`.

- [ ] **Step 1: Write the failing tests** (fixtures with a cap through `ctx.popCaps`, since the
  schema refuses one on a campaign mission):
  - uncapped: `populationView()` is null and every build behaves as on `main`;
  - cap 6 with 5 used: a 1-pop build succeeds, a 2-pop build is refused with the reason string and
    costs nothing;
  - two queued 1-pop builds at 5/7: the second reserves the last slot; a third is refused (D2);
  - a unit dies: its population frees on the same tick;
  - a carried squad, a garrisoned squad and a buried squad all count (D1); each fixture squad declares
    `role: 'infantry'` (with no role it derives as wheeled and cannot board, #402's fixture trap), and
    the test asserts `carriedBy`/`garrisonedIn`/`tunnelIn` before it counts;
  - drones (population 0) are never refused by the cap;
  - a starting force of 8 under a cap of 6 stands, and every build is refused until two die (D3);
  - a trigger spawn above the cap spawns (D3).
- [ ] **Step 2: Implement.** One pass over the side's ids per query; called on build requests and once
  a tick for the HUD view, not per unit.
- [ ] **Step 3: See it red.** Skip the reservation: the "third is refused" test fails. Count only
  units not carried: the D1 test fails.

---

## Task 4: the economy pin learns population

**Model:** haiku. **Agent:** `sim-guard`. **Depends:** Task 3, F1 Task 1.

**Files:** `mission.ts` (`economyHash`), `determinism.test.ts`. Neither `economyHash` nor the
`ECONOMY_PIN*` constants exist on `b44df7aa`: F1 Task 1 creates them.

- [ ] **Step 1:** `economyHash` folds `population(0)`, `population(1)`, and each cap (null as a
  sentinel). The F1 fixture gains a `ctx.popCaps` of `[12, null]` and one build the cap refuses.
- [ ] **Step 2: Re-pin once.** Commit: *"economy pins re-pinned: population and the cap are economy
  state (G3 Q4, lead 4 Oct); the fixture gained a cap of 12 and a refused build; was N / M"*.
  Coverage: assert the fixture really refuses one build for the cap (`buildBlockedReason` read back),
  so the pin is not over a cap that never binds.
- [ ] **Step 3: See it red.** Drop the cap from the hash: a fixture variant with cap 13 hashes the same
  as 12, and the coverage test written for that pair fails.

---

## Task 5: the census in the harness

**Model:** haiku. **Agent:** `playtest`. **Depends:** Task 3.

**Files:** `tools/src/backtest/playtest.ts`.

- [ ] **Step 1:** Print per mission, from the winning plan: starting population, peak population, and
  end population for side 0 and side 1. No gate: no campaign mission has a cap, and a pinned peak
  would be a fitted number. The numbers exist for G-G's doctrine caps and for any build-up mission the
  lead later allows a cap (G3 sheet: KDF starting 6–20, ceiling ~26, M at `751b6742`; the authored
  starting figure recounts identically on `b44df7aa`, and the ceiling's inputs, `resources` and
  `target_minutes`, are unchanged; peak and end population have never been measured, and #402 changed
  who survives, `ROSTER_MAX` 33 → 31).
- [ ] **Step 2: Measure.** Every existing line byte-identical; the new lines are additions.
- [ ] **Step 3: See it red** (that the line reads the runtime, not the JSON): spawn a trigger unit in a
  scratch fixture mid-mission; peak moves, starting does not.

---

## Task 6: which placements are on loan

**Model:** sonnet. **Agent:** `sim-guard`.

**Files:** `packages/sim/src/unlock.ts` and its test, `packages/sim/src/index.ts`; the shipped census
case in `tools/src/` (see Step 1).

On `b44df7aa`: `UnlockGate` (unlock.ts L7) is `{ roeMin?, starsMin?, afterMission?, price?, bought? }`;
`unlockReason` is L48, `resolveUpgrades` L150. `resolveUpgrades` takes a whole `MissionJson`, not a
`Pick`, so the signature below widens or spreads into one. It also `filter`s a dropped `gate_only`
entry out, so authored and resolved indices differ after one: say which array the answer indexes. Both
consumers already hold the RESOLVED mission (`main.ts` ~L1614 builds it once for the runtime and for
`broughtFor`).

**Interfaces:**

```ts
/** D5. Indices into `mission.starting_force` of placements that field a unit whose
 *  gate is closed for this ledger, after `resolveUpgrades`. Pure; the runtime and
 *  the deploy screen call it with the same `gateOf`. */
export function loanedPlacements(
  mission: Pick<MissionJson, 'starting_force'>,
  ledger: LedgerData | undefined,
  gateOf: (unitId: string) => UnlockGate | undefined,
): readonly number[];
```

- [ ] **Step 1: Write the failing tests:**
  - a `mbt_lavi` placement with `roeMin: 90` and a ledger at Conduct 80 → on loan; at 95 → not;
  - the same gate with `bought: true` → not;
  - an `upgrades_to` placement whose upgrade is open → not (the upgraded unit is fielded, and it is
    open); whose upgrade is closed → the base unit's own gate decides;
  - a `gate_only` placement with a closed gate → absent from the answer (nothing is fielded);
  - a `from_ledger` placement of a gated type → never;
  - **the shipped census**: on an empty ledger, `wadi_halam_5_depot` reports the `dozer_d9` and the
    `demo_squad` placements as on loan (Conduct 87 and 77: `data/units/kdf/dozer_d9.json` L8,
    `demo_squad.json` L73 on `b44df7aa`; authored indices 4 and 5, still fielded fresh after GH-382 moved
    the mission to `wadi_halam_5`). Its `ifv_namer` (Conduct 85) is `from_ledger` and its
    `jeep_shoded` → `apc_kipod` (44 stars) resolves to the ungated jeep, so neither is on loan. This is
    the feature's own canonical case, as a test, in `tools/src/` (packages/sim tests read no shipped
    JSON; `halt_to_fire_roster.test.ts` is the precedent).
- [ ] **Step 2: Implement** by calling `resolveUpgrades` and `unlockReason`, never re-deriving either.
- [ ] **Step 3: See it red.** Skip `resolveUpgrades`: the `upgrades_to` test fails. Ignore `bought`:
  the bought test fails.

---

## Task 7: a loaned survivor goes back (L-1; halts for the lead)

**Model:** sonnet. **Agent:** `sim-guard`, then `playtest`. **Depends:** Task 6. **Halts until the lead
confirms L-1 on #183.** If the lead overrules, this task is skipped and the plan records that a lent
unit is kept.

**Files:** `packages/sim/src/mission.ts` and its test, `tools/src/backtest/playtest.ts` (comments and
pins), `packages/app/src/ui/stores-model.ts` (`CAMPAIGN_CREDITS`, only if `LADDER_CREDITS` moves).

- [ ] **Step 1: Measure first, on a scratch copy.** Run `pnpm playtest` with the change. Report which
  roster lines move, whether any later `from_ledger` draw fields a different force, and whether any
  outcome, grade or credit moves. On the optimal ladder every Conduct gate is open after mission 1
  (M, G3 sheet Q5; on `b44df7aa` asserted by `CONDUCT_GATES`, playtest.ts ~L3007, all nine
  `opensAfter: 1`). That is the SYNTHETIC `conductLedgerAfter` ladder (~L2886), though, and L-1's
  footprint is decided by the harness's own runs. Read from their `run(` calls on `b44df7aa` (the same
  threading as on 4 Oct), ten plain winning runs that field a gated fresh placement start from `{}`,
  every Conduct gate closed: Wadi Halam I, Khan Rafid I–III, Deir Amun I–III and Tel Marum I–III.
  Wadi Halam I's ledger feeds Wadi Halam II–V, and Tel Marum III's feeds both Qarn Hadid I–III and Umm
  Zeitoun I–IV, where `ROSTER_MAX` (31) is measured. Beit Sahwan threads from the breach's rating. The
  two feeders lend a drone (Wadi Halam I) and two Lavis, a Namer and a drone (Tel Marum III), and no
  `from_ledger` draw downstream of them asks for a drone, or for a Lavi or a Namer on the Qarn Hadid and
  Umm Zeitoun side. So the expected footprint (R) is the ten runs' own roster lines, the pool sizes
  downstream of Wadi Halam I and Tel Marum III, and `ROSTER_MAX`.
  A chained mission whose inherited rating sits below a floor would lend as well; not read here. Of the
  `(bought)` probes, `led4In` (the Zikit, whose post #402 re-fitted on 6 Oct) descends from the breach,
  and `ledUZ3` (the Gunship) from Tel Marum III. Report both probes' use lines. Post the numbers with the
  request for confirmation.
- [ ] **Step 2: Write the failing tests:** a mission with one loaned and one open placement, both
  surviving: the produced `roster.surviving_units` contains the open one only; `startingHome` counts
  both (credits unchanged); a loaned unit killed in the mission is a loss in the debrief like any
  other. (An armed fixture with `role: 'infantry'` now kneels when idle, #402; it stands still and
  survives the same, and its roster entry carries no brace state.)
- [ ] **Step 3: Implement.** The runtime records loaned entity ids at spawn (from Task 6's indices)
  and skips them in `checkEnd`'s roster write (mission.ts ~L1884; the survivor loop over `playerIds`
  before ~L1929's unfielded-pool append). The runtime never sees a gate (`resolveUpgrades`' own comment),
  so the indices reach it through `MissionContext`.
- [ ] **Step 4: Re-pin, if Step 1 said so.** Each moved `LADDER_CREDITS` (5830 on `b44df7aa`, ~L3181) /
  `GATES` (~L2944) / `ROSTER_MAX` (31, ~L3308) pin gets the house-style comment: the term, per mission,
  before and after, summing to the delta. A moved `LADDER_CREDITS` moves `CAMPAIGN_CREDITS` in the same
  commit, or `tools/src/campaign_credits.test.ts` goes red (GH-330).
- [ ] **Step 5: See it red.** Remove the skip: the roster test fails, listing the loaned unit.

---

## Task 8: "on loan" on the deploy screen (Lane A)

**Model:** sonnet. **Agent:** lane A (`render-vfx` for styling questions). **Depends:** Task 6.

**Files:** `packages/app/src/ui/deploy-roster.ts`, `packages/app/src/ui/loading.ts` (`broughtFor` and
the deploy spread), `packages/app/src/i18n/en.json`, `packages/app/src/ui/theme.css` only if a token is
missing; tests (`loading.test.ts`, `deploy-roster.test.ts`).

On `b44df7aa` neither surface has a row for a loaned unit. `broughtFor` (loading.ts ~L130) names only
what `from_ledger` placements draw, through `drawFromPool`, and skips fresh units on purpose; the deploy
spread (`deploySpread`, ~L252) lists `deployRosterView`'s pool entries (deploy-roster.ts ~L36-52). D5
puts every loaned unit on a non-`from_ledger` placement, so Wadi Halam V's D9 and demolition squad
appear on neither, and the "rows" below are new. Both surfaces read the resolved mission (`main.ts`
~L1614/~L1929/~L1944). Where the mark sits is "For the lead" 2. en.json is flat dotted keys, so
`deploy.onLoan` and `deploy.onLoan.tip` coexist.

- [ ] **Step 1: Write the failing tests** (jsdom): on `wadi_halam_5_depot` with an empty ledger, the
  deploy panel's D9 and demolition rows carry the mark; with a ledger that opens both gates, neither
  does; the mark's text comes from `t('deploy.onLoan')` (the pseudo-locale renders it bracketed).
- [ ] **Step 2: Implement.** A chip beside the unit name, with a tooltip:
  `t('deploy.onLoan.tip')` = "Issued for this mission. Returns to its unit afterwards." (if L-1 is
  overruled: "Issued for this mission."). Semantic tokens only (`pnpm validate:ui`). The mark is on
  the deploy screen and nowhere in the world (memory: no status marks in the world).
- [ ] **Step 3: Measure.** `pnpm validate:ui` clean; a pseudo capture of the deploy screen shows no
  unbracketed word.
- [ ] **Step 4: See it red.** Read the gate before `resolveUpgrades` in the view: the upgraded-row test
  fails.

---

## Task 9: the feature, documented

**Model:** haiku. **Depends:** Tasks 6, 7.

**Files:** `docs/GDD.md` §6, `data/schemas/mission.schema.json` (`starting_force` description),
`CLAUDE.md` ("Known scaling debts", the `starting_force` paragraph), `docs/campaign/README.md`,
`docs/HANDOVER.md`.

- [ ] **Step 1:** The sentence in all four places: *"The issued force is the brigade's to lend. A
  placement may field a unit whose gate is closed; it is on loan for that mission, marked so on the
  deploy screen, and returns afterwards. Gates govern what you build and what you upgrade to.
  Restraint shapes the issued force through `upgrades_to` and `gate_only` (lead, G3 Q5, 4 Oct)."*
  CLAUDE.md's "Whether that is a feature or a hole is undecided" becomes "decided 4 Oct: a feature".
  That paragraph (CLAUDE.md ~L2079 on `b44df7aa`) also quotes pre-WP-G-E1 floors, `dozer_d9` (ROE 60),
  `demo_squad` (ROE 50), `recon_drone` (35), `ifv_namer` (40); the unit JSON on `b44df7aa` reads 87, 77,
  70 and 85 (`data/units/kdf/*.json`, the `CONDUCT_GATES` table at playtest.ts ~L3007). Correct them in
  the same rewrite.
- [ ] **Step 2:** The population cap in GDD §3 and the campaign README: off in the campaign, on in
  skirmish and co-op through the doctrine, never equal across doctrines (G3 Q4/Q7).
- [ ] **Step 3:** `docs/HANDOVER.md` §1, §3 (D1–D5, L-1 as answered), §4.

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat and relief | **unmoved** (R): 922714084 / 3200430224 on `b44df7aa` (2109596329 / 1425295494 on 4 Oct, moved by #402) | — |
| `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` | **re-pinned once**, Task 4 (born in F1; not in the tree on `b44df7aa`) | population and the cap are economy state (G3 Q4) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | byte-identical through Task 6; Task 7 moves roster lines (L-1) | new census lines (Task 5) |
| `ROSTER_MAX` | 31 on `b44df7aa` (30 on 4 Oct; GH-382 → 33, #402 → 31), at `umm_zeitoun_4_clearance`; may move in Task 7 (R) | "a loaned survivor returns to the lender (G3 Q5, L-1)" |
| `LADDER_CREDITS` | 5830 on `b44df7aa` (5736 on 4 Oct); unchanged unless L-1's smaller pools change a later outcome (R: small, measured in Task 7 Step 1) | "a loaned survivor returns to the lender (G3 Q5, L-1)", per mission |
| `CAMPAIGN_CREDITS` (`stores-model.ts` L63) | equal to `LADDER_CREDITS` (GH-330, `campaign_credits.test.ts`); moves with it, same commit | as `LADDER_CREDITS` |

## Lane A needs (WP-S-F #184)

- **Used/cap** beside the logistics counter, shown only when `populationView()` is not null (Q4: the
  HUD shows it when the cap is on). In the campaign it never appears.
- **The refusal on the dock tile**: the cap reason string, in the same slot the unlock reason uses.
- **"On loan"** on the deploy screen: Task 8, if lane A was busy when F3 landed.
