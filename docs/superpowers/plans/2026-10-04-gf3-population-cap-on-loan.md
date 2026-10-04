# WP-G-F plan F3: the population cap, and units "on loan" (GH-183, G3 Q4 and Q5). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two small rulings, made real.

| ruling (lead, 4 Oct) | today (`main` `067fab9a`) | after F3 |
|---|---|---|
| **Q4.** A population cap, available per mission and doctrine: **off in the campaign, on in skirmish and co-op**. The HUD shows used/cap when it is on | every unit JSON declares `cost.population` (drones 0, most teams 1, APCs 2, Lavi 3); **nothing reads it** (M, G3 sheet) | the runtime counts it; a cap, when set, refuses builds past it; the validator refuses a cap on any campaign mission |
| **Q5.** Missions may **lend** locked units, and the deploy screen marks them **"on loan"** | `starting_force` never consults `unlock`; 68 gated placement lines in 26 of 27 missions (M); CLAUDE.md calls it "undecided" | a documented feature; one pure predicate names the loaned placements; the deploy screen marks them; a loaned survivor goes back to the lender (L-1, the one decision here that can move a pin) |

**Architecture:**
- **The cap is `MissionRuntime`.** Population is read from `UnitType.population` (new, parsed from
  the JSON the sim already loads, not hashed, read by no sim system), summed over a side's living
  units plus its queued builds. The cap comes from the mission (`resources.pop_cap`) or from the
  runtime context (`MissionContext.popCaps`), which is the door G-G's doctrine loader and G-H's co-op
  setup will use. No campaign mission sets one, so no campaign outcome can move.
- **"On loan" is one pure predicate in `unlock.ts`**, beside `unlockReason` and `resolveUpgrades`,
  so the runtime and the deploy screen read the same answer (the `missionShepherds` pattern from the
  Stage 4 sim-fix plan).

**Tech stack:** TypeScript strict, vitest (jsdom for the deploy screen).

**Refs:**
- GH-183 F3 and F4's "a ruling on `starting_force` never consulting `unlock`". GH-167 (G3) Q4 and Q5,
  the lead on 4 Oct.
- The G3 decision sheet (PR #369), Q4 (the population census: KDF starting 6–20, Sarim ×1/×2 at
  20/27 pop against the KDF's 10, so an equal cap would undo Q7) and Q5 (the 68-line census, Wadi
  Halam V's two demolishers, `upgrades_to`/`gate_only` as the sanctioned restraint path).
- CLAUDE.md, "Known scaling debts", the `starting_force` paragraph (rewritten in Task 9).
- `packages/app/src/ui/deploy-roster.ts`, `ui/loading.ts` (`broughtFor`): the deploy surfaces.

**Base:** read against `main` `067fab9a`. Branch `feat/gf3-popcap`, cut from `main` after F1 lands.
Nothing measured yet: (M) is quoted from the G3 sheet, (R) is reasoned.

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
    one needs the lead to lift the rule, which is the point.
  - **D5. A placement is on loan** when its unit's unlock gate, as resolved for this ledger (bought
    included, through `kdfUnlockGate`), is closed, **after** `resolveUpgrades`: a placement upgraded
    to an open unit is not on loan; a `gate_only` placement dropped by a closed gate is not on the
    field at all; a `from_ledger` placement is never on loan (it is the brigade's own body).
  - **L-1. A loaned survivor goes back to the lender.** "For that mission" (the lead's Q5 wording)
    means the unit does not join `roster.surviving_units` at mission end. Today every starting-force
    survivor without `from_ledger` appends a new roster entry, so a lent Lavi would become the
    brigade's permanently, gate or no gate. **This can move the playtest roster lines and, through
    later `from_ledger` draws, outcomes and `LADDER_CREDITS`.** It halts at Task 7 for the lead's
    confirmation. The credit formula is untouched either way: `creditInputFrom` reads
    `startingCount`/`startingHome`, and a loaned unit that comes home still counts as home.

---

## Global Constraints

- **The four invariants hold.** Population sums are integers. No `rng`. The sim gains one parsed,
  unhashed, unread field (`UnitType.population`); no sim system reads it.
- **Sim pins unmoved** by every task. A move is a defect.
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
| `packages/sim/src/sim.ts` | `UnitType.population`, parsed in `addUnitType` | 1 |
| `data/schemas/mission.schema.json`, the `validate:data` script | `resources.pop_cap`; the campaign refusal | 2 |
| `packages/sim/src/mission.ts` (+ test) | `population(side)`, `popCap(side)`, `populationView()`, the build refusal | 3, 4, 7 |
| `packages/sim/src/determinism.test.ts` | The economy re-pin | 4 |
| `tools/src/backtest/playtest.ts` | The population census line | 5 |
| `packages/sim/src/unlock.ts` (+ test), `index.ts` | `loanedPlacements` | 6 |
| `packages/app/src/ui/deploy-roster.ts`, `ui/loading.ts`, `i18n/en.json` (+ tests) | The "on loan" mark | 8 |
| `docs/GDD.md`, `data/schemas/mission.schema.json` (`starting_force` description), `CLAUDE.md`, `docs/HANDOVER.md` | The documented feature | 9 |

---

## Task 1: the sim carries population, and reads none of it

**Model:** haiku. **Agent:** `sim-guard`.

**Files:** `packages/sim/src/sim.ts`, `packages/sim/src/sim.test.ts`.

- [ ] **Step 1: Write the failing tests:** `addUnitType` of a JSON with `cost.population: 3` gives
  `population === 3`; absent gives 1 (the schema default); `recon_drone`'s shipped JSON gives 0.
  Assert from literals, not by re-reading the JSON under test.
- [ ] **Step 2: Implement.** Integer, validated ≥ 0.
- [ ] **Step 3: Measure.** Both sim pins unmoved (unit types are not hashed; if `hash()` ever folds
  type tables, stop and raise it).
- [ ] **Step 4: See it red.** Default to 0: the "absent gives 1" test fails.

---

## Task 2: the field, and "off in the campaign"

**Model:** sonnet. **Agent:** `mission-author`.

**Files:** `data/schemas/mission.schema.json`, the `validate:data` script and its tests.

**Interfaces (schema):** `resources.pop_cap: { "type": "integer", "minimum": 1, "description":
"Player-side population cap. Off in the campaign (lead, G3 Q4, 4 Oct): refused on any mission with a
town. Skirmish and co-op set it through the doctrine." }`

- [ ] **Step 1: Write the failing validator tests:** `pop_cap: 18` on a mission with `town` is refused
  by name and cites G3 Q4; the same on a fixture with no `town` passes; `pop_cap: 0` is refused by the
  schema.
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

- [ ] **Step 1: Write the failing tests** (fixtures with a cap through `ctx.popCaps`, since the
  schema refuses one on a campaign mission):
  - uncapped: `populationView()` is null and every build behaves as on `main`;
  - cap 6 with 5 used: a 1-pop build succeeds, a 2-pop build is refused with the reason string and
    costs nothing;
  - two queued 1-pop builds at 5/7: the second reserves the last slot; a third is refused (D2);
  - a unit dies: its population frees on the same tick;
  - a carried squad, a garrisoned squad and a buried squad all count (D1);
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

**Files:** `mission.ts` (`economyHash`), `determinism.test.ts`.

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
  lead later allows a cap (G3 sheet: KDF starting 6–20, ceiling ~26, M).
- [ ] **Step 2: Measure.** Every existing line byte-identical; the new lines are additions.
- [ ] **Step 3: See it red** (that the line reads the runtime, not the JSON): spawn a trigger unit in a
  scratch fixture mid-mission; peak moves, starting does not.

---

## Task 6: which placements are on loan

**Model:** sonnet. **Agent:** `sim-guard`.

**Files:** `packages/sim/src/unlock.ts` and its test, `packages/sim/src/index.ts`.

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
    `demo_squad` placements as on loan (M, G3 sheet: Conduct 87 and 77). This is the feature's own
    canonical case, as a test.
- [ ] **Step 2: Implement** by calling `resolveUpgrades` and `unlockReason`, never re-deriving either.
- [ ] **Step 3: See it red.** Skip `resolveUpgrades`: the `upgrades_to` test fails. Ignore `bought`:
  the bought test fails.

---

## Task 7: a loaned survivor goes back (L-1; halts for the lead)

**Model:** sonnet. **Agent:** `sim-guard`, then `playtest`. **Depends:** Task 6. **Halts until the lead
confirms L-1 on #183.** If the lead overrules, this task is skipped and the plan records that a lent
unit is kept.

**Files:** `packages/sim/src/mission.ts` and its test, `tools/src/backtest/playtest.ts` (comments).

- [ ] **Step 1: Measure first, on a scratch copy.** Run `pnpm playtest` with the change. Report which
  roster lines move, whether any later `from_ledger` draw fields a different force, and whether any
  outcome, grade or credit moves. On the optimal ladder every Conduct gate is open after mission 1
  (M, G3 sheet Q5), so the expected footprint is the first mission of each chain and the `(bought)`
  probes (R). Post the numbers with the request for confirmation.
- [ ] **Step 2: Write the failing tests:** a mission with one loaned and one open placement, both
  surviving: the produced `roster.surviving_units` contains the open one only; `startingHome` counts
  both (credits unchanged); a loaned unit killed in the mission is a loss in the debrief like any
  other.
- [ ] **Step 3: Implement.** The runtime records loaned entity ids at spawn (from Task 6's indices)
  and skips them in `checkEnd`'s roster write.
- [ ] **Step 4: Re-pin, if Step 1 said so.** Each moved `LADDER_CREDITS`/`GATES`/roster pin gets the
  house-style comment: the term, per mission, before and after, summing to the delta.
- [ ] **Step 5: See it red.** Remove the skip: the roster test fails, listing the loaned unit.

---

## Task 8: "on loan" on the deploy screen (Lane A)

**Model:** sonnet. **Agent:** lane A (`render-vfx` for styling questions). **Depends:** Task 6.

**Files:** `packages/app/src/ui/deploy-roster.ts`, `packages/app/src/ui/loading.ts` (`broughtFor` and
the deploy spread), `packages/app/src/i18n/en.json`, `theme.css` only if a token is missing; tests.

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
- [ ] **Step 2:** The population cap in GDD §3 and the campaign README: off in the campaign, on in
  skirmish and co-op through the doctrine, never equal across doctrines (G3 Q4/Q7).
- [ ] **Step 3:** `docs/HANDOVER.md` §1, §3 (D1–D5, L-1 as answered), §4.

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat and relief | **unmoved** (R) | — |
| `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` | **re-pinned once**, Task 4 | population and the cap are economy state (G3 Q4) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | byte-identical through Task 6; Task 7 moves roster lines (L-1) | new census lines (Task 5) |
| `LADDER_CREDITS` | unchanged unless L-1's smaller pools change a later outcome (R: small, measured in Task 7 Step 1) | "a loaned survivor returns to the lender (G3 Q5, L-1)", per mission |

## Lane A needs (WP-S-F #184)

- **Used/cap** beside the logistics counter, shown only when `populationView()` is not null (Q4: the
  HUD shows it when the cap is on). In the campaign it never appears.
- **The refusal on the dock tile**: the cap reason string, in the same slot the unlock reason uses.
- **"On loan"** on the deploy screen: Task 8, if lane A was busy when F3 landed.
