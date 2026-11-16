# An escort that holds through the work (GH-1439)

**Date:** 2026-11-15 · **Status:** design for the lead, nothing built. · **Issue:** GH-1439 (engine gap G-2 of *The Long Ground*).
**Why now:** *The Blade Line* (Bir Tarsha IV) is the first shipped use of `escort`, and the lead's ruling on its
decision 2 (15 Nov, on GH-1439) asks for a loss tolerance: the escort fails after losing **two** of the four tagged
dozers, not the first. *The Line* (Mina Sahil IV) needs the same shape.

**What I read to write this** (this session, on `main` at `e5be829ab`): `packages/sim/src/mission.ts`
(`ObjectiveJson` at line 213; the escort branch of `stepObjectivePass` at 4516; `stepObjectives` at 4456;
`start()` load checks at 2666; `digest()` at 1477; `checkEnd` and `defeatCause`), `data/schemas/mission.schema.json`
(the `escort` text and the `zone` property), `tools/validate_objectives.mjs`, `tools/src/escort_contract.test.ts`,
the `escort (GH-2)` block of `packages/sim/src/mission.test.ts` (719 to 930), and the harness's `Plan` type in
`tools/src/backtest/playtest-run.ts`. **Nothing was run and no code was changed**: every behaviour below is read
from those files, and every test in §6 is a proposal for the implementer.

---

## 1. What escort does today, and the two gaps

`escort` (GH-2) is `target` (a tag on the player's own `starting_force`) plus `zone` (the destination). Each tick
while it is `active` (`stepObjectivePass`):

```ts
const ids  = this.tags.get(d.target ?? '') ?? [];
failed   = ids.some((id) => alive[id] === 0);                 // ANY tagged unit dead or taken
complete = dest !== undefined && ids.every((id) => this.standsIn(id, dest));
```

Both verdicts are pure functions of this tick's bodies, so the objective is **stateless**: it adds no column and
no hash word (the comment at the branch says so on purpose, and the test "writes nothing into the sim" pins it).
Once `complete`, the status latches and the objective is never evaluated again.

Two gaps for *The Blade Line*:

1. **It completes at arrival and then stops caring.** The dozers could reach the zone, the escort go green, and
   every dozer die afterwards while `raze` and `collapse` are still running. The escort has to cover the work.
2. **One death fails it.** The lead wants two of four.

## 2. Proposal: two optional fields on `escort`

Both are escort-only, like `zone`. Absent, the objective is today's, byte for byte.

| field | type | meaning |
|---|---|---|
| `fail_after_losses` | integer, 1 to the number of tagged units | the escort fails the tick this many tagged units are dead or taken. Default 1 (today) |
| `until` | array of objective ids, 1 or more | the escort cannot complete until **every** listed objective is `complete` |

A Blade Line row would read:

```json
{ "id": "blades", "type": "escort", "primary": true,
  "target": "blades", "zone": "far_gate",
  "fail_after_losses": 2,
  "until": ["clear_works", "drop_shafts"],
  "text": "Bring the blades through the fence" }
```

### 2.1 The rule, in the sim's own terms

```ts
const ids   = this.tags.get(d.target) ?? [];
const lost  = ids.filter((id) => alive[id] === 0).length;
const live  = ids.filter((id) => alive[id] === 1);
failed   = lost >= (d.fail_after_losses ?? 1);
complete = !failed && dest !== undefined && live.length > 0
        && live.every((id) => this.standsIn(id, dest))
        && untilIds.every((u) => status[u] === 'complete');
```

- **Survivors are what arrive.** With tolerance, the dead cannot block arrival, so "every tagged unit stands in
  the zone" becomes "every *surviving* tagged unit". With the default limit of 1 the two are identical, because
  any death has already failed the objective.
- **Failure wins a tie.** If the second dozer dies on the tick the last work objective completes, the escort
  fails (`!failed &&` above). Today the two cannot coincide; with tolerance they can, and the player must not be
  told they won with the limit crossed.
- **Arrival is read each tick, not latched.** The escort completes the first tick the work is done *and* every
  living dozer is in the destination. This is the recommendation, and the reasons are in §3 (alternatives).
- **A loss is permanent.** `alive` never returns to 1, so `lost` can only rise and the count needs no stored
  history.
- **`live.length > 0` is a backstop.** Validation (§4) keeps the limit at or below the tagged total, so `failed`
  has already fired before the last unit dies; the guard exists so a broken limit cannot read as an empty win.

### 2.2 Evaluation order: a pass after the work

`stepObjectives` already runs two passes ("every objective in authored order, then each `no_collateral_above`")
so that a ceiling sees the others complete on the same tick. An escort with `until` needs the same courtesy: if it
is authored before the `raze` it waits on, it would read the raze as `active` on the tick the raze completes and
lag a tick behind. The runtime must not make the result depend on authored order, so the passes become three:

1. every objective except an escort with `until` and a ceiling, in authored order (today's first pass);
2. each escort with `until`, in authored order;
3. each `no_collateral_above` (today's second pass; it completes when every primary is complete, the escort
   included, so it must run last).

A mission without `until` has no row in pass 2, so its event order, its statuses and its digest are untouched.
The pass of an objective is a function of its definition and is fixed at construction.

## 3. Alternatives, and why not

- **A. The two fields on `escort` (recommended).** One objective, one panel row, one place that says what the
  player owes the dozers. It reuses the escort's existing load checks and its stateless shape.
- **B. A ceiling, `protect`, in the manner of `no_collateral_above`.** An objective `{ type: "protect", target:
  "blades", threshold: 1 }` that fails past N losses and completes with the other primaries. It decomposes the
  idea cleanly (arrive, and separately do not lose more than N), and it is the form to prefer if a third mission
  wants "keep these alive" with no destination. Not recommended now because it is a new objective type (schema,
  the `SUPPORTED` set, `objectiveList`, the HUD row, the briefing text, `validate_objectives`, a second `if` in
  `stepObjectivePass`) **and** the escort would still need `fail_after_losses` for its own arrival, so the
  dozers would carry two objectives to say one thing.
- **C. Latch the arrival.** The escort remembers it has arrived and then watches the work. It lets the dozers
  leave the destination (to finish a berm) without the escort un-arriving. It costs one `Uint8` column per escort,
  a snapshot row, and a fold in `digest()`; per the house pattern that fold would sit behind a live flag (the
  `fmLive` and `woundLive` precedent: "fold only once any escort has `until`") so no existing mission's hash
  moves. I do not recommend it: for *The Blade Line* the last work falls at the barrier, a few tiles from
  `far_gate`, so "now roll through the gap" is the right ending and a latch would end the scene with the blades
  still on the wrong side. **Open question 1** for the lead; the column and fold are specified in §7 if the answer
  is yes.
- **D. `until: "primaries"` shorthand.** Saves a line, hides the pairing, and makes the escort wait on itself.
  Refused.

## 4. Load-time and authoring rules

The runtime throws at load (like every other objective fault); `validate_objectives.mjs` mirrors each rule before
a mission ships, with the file name in the message; the JSON schema carries the field types and descriptions.

| # | rule | message root |
|---|---|---|
| R1 | `fail_after_losses` and `until` belong to `escort` alone (like `zone`) | "which takes no `until` (only escort does)" |
| R2 | `fail_after_losses` is an integer, at least 1 | "needs a whole `fail_after_losses` of at least 1" |
| R3 | `fail_after_losses` is at most the number of tagged units (the sum of `count` over the placements carrying the tag; the runtime reads the bodies) | "cannot exceed the N units tagged X" |
| R4 | `until` is a non-empty array of distinct ids, each naming an objective of this mission, never the escort itself | "names unknown objective" / "names itself" |
| R5 | each `until` id is a **primary** objective | "waits on a secondary" |
| R6 | no `until` id is another `escort`, a `no_collateral_above`, or a `score` | "waits on a type that waits on it" |
| R7 | the "starts inside zone" fault applies **only to an escort without `until`** | existing message, narrowed |

Why R5: if the work objective is a primary and it fails (a `raze` deadline), the mission ends in defeat with the
raze as the cause (`defeatCause` is the first failed primary in authored order). If it were a secondary that
failed, the escort would be left `active` for ever and the mission would end as `withdrawn` on the clock. Making
every `until` a primary means a failed prerequisite ends the mission itself, and the escort needs no failure
propagation.

Why R6: a ceiling completes only when every primary is complete; an escort waiting on a ceiling is a deadlock.
Two escorts waiting on each other is the same. `score` is versus-only.

Why R7: with `until`, "the units start inside the zone" is a legitimate **protect-in-place** escort (the dozers
begin at the work site, the zone is where they work, and the objective completes when the work does). The
first-tick fault exists because an escort without `until` would complete immediately; with `until` it would not.
This is the form *The Line* (Mina Sahil IV) is likely to want; flagged, not designed here.

`tools/validate_objectives.mjs` gets the same seven checks, and `tools/src/validate_objectives.test.ts` the same
parity cases. Because the escort data contract is one object through both the schema and the runtime
(`escort_contract.test.ts`), the new fields join that test so the schema and the runtime cannot drift apart again.

## 5. Determinism and the hash

- **Integer only.** The branch reads `alive` bytes and objective statuses; no `Math.*`, no `Date.*`, no float.
  Invariant 2 holds, as it does for the escort today.
- **No randomness.** Invariant 3 is not engaged.
- **No writes to the sim.** Invariant 4: the objective reads bodies and writes only its own status, as before.
  The existing test "writes nothing into the sim: the hash with an escort objective equals the hash without one,
  every tick" is extended to a mission using both fields.
- **`digest()` needs no new word and no live flag.** It folds each objective's status code, `holdTicks` and
  `paused` code. `fail_after_losses` and `until` live on the immutable `def`, which is rebuilt from the mission
  JSON on load; the escort has no state of its own to add. The statuses already folded are the only runtime fact.
  A mission that uses neither field has the same digest and the same `sim.hash()` on every tick as it has on
  `main`, which the implementer pins with literals recorded **before** the change (§6, test 9).
- **Save and resume** (the mid-mission save design, PR 1443) snapshots `ObjectiveState`, not `def`; nothing to
  add for this feature under option A. Under option C it would need the new column in the snapshot.
- **Replays.** A replay replays the same commands against the same mission JSON; the new fields are part of that
  JSON, so a replay of an old mission is unaffected and a replay of a new mission is deterministic by the two
  properties above.

`sim-guard` review points, so they can be checked rather than trusted: (a) pass 2 is a function of `def` only;
(b) the three passes never read a status they have not yet written that tick, except by design (pass 2 reads
pass 1); (c) the default path (`fail_after_losses` absent, `until` absent) computes `lost >= 1` over the same
array the old `some()` read, and `live.every` over the same array when `lost === 0`.

## 6. Tests, each with the mutation that must turn it red

Colocated: `packages/sim/src/mission.test.ts` (the `escort (GH-2)` block gets a sibling `escort through the work
(GH-1439)`), `tools/src/validate_objectives.test.ts`, `tools/src/escort_contract.test.ts`. Per CLAUDE.md, a new
check arrives with its falsification in the commit message: the **implementer runs each mutation below as a
one-line edit of the implementation, watches the named test go red, and puts it back.** I have run none of them.

| # | test | mutation of the implementation that must make it red |
|---|---|---|
| 1 | with `until: [raze]`, a tagged unit in the zone and the raze still `active`: the escort stays `active`; the tick the raze completes, it completes | delete the `untilIds.every(...)` clause |
| 2 | after the raze completes, a unit **leaving** the zone puts the escort back to waiting, and re-entering completes it (arrival is per tick) | latch an `arrived` flag |
| 3 | `fail_after_losses: 2`, four tagged: one `debugKill` leaves the escort `active` and the mission `ongoing`; the second fails it with `defeatCause { objective }` | change `>=` to `>` (needs three), or hard-code the limit to 1 |
| 4 | survivors arrive: one dead, three standing in the zone, `until` done: it completes | iterate `ids` (all tagged) instead of `live` in the `every` |
| 5 | the tie: the second death and the last `until` completion on the **same tick**: the escort fails, the mission is a defeat | drop `!failed &&` from `complete` |
| 6 | order independence: the same mission with the escort authored before and after its `raze` completes on the **same tick** in both | collapse pass 2 into pass 1 |
| 7 | default unchanged: every existing `escort (GH-2)` case passes untouched; the first death still fails with no fields | change the default limit from 1 |
| 8 | the load refusals R1 to R7, one `it` each, in the runtime **and** in `validate_objectives` (the same literal through both) | remove each throw in turn: its case must go red |
| 9 | digest and hash pinned: a mission with no new field has the digest and `sim.hash()` literals recorded on `main` before the change, for 40 s of ticks; a mission with both fields plus the same plan has `sim.hash()` equal to the same mission with the escort deleted | add any word to `digest()` or any write to the sim in the escort branch |
| 10 | contract: the new fields on the literal in `escort_contract.test.ts` pass the schema **and** play in the runtime (the schema rejects `until: []`, `fail_after_losses: 0`, either field on a `raze`) | delete the schema property |

Two of these are checks that are easy to write so they cannot fail, and the casebook (`falsification-casebook.md`)
names the shapes: test 9's literals must be **recorded on `main` first** (a golden recomputed by the code under
test is the "right-hand side the check recomputed itself" shape); test 6 must put the escort **before** the raze
in the array (an escort after it reads the right answer by accident); test 4 must have a dead unit that is *not*
in the zone, or a bug that reads the dead as arrived still passes.

## 7. If the lead wants the latch (option C)

One `Uint8Array` per escort objective (`arrived`), set in pass 2 the first tick every living tagged unit stands in
the zone, never cleared; `complete` becomes `arrived && untilDone && !failed`. Folded in `digest()` as one word per
objective **only when some escort in the mission has `until`** (a `private escortLive` set in the constructor, the
`fmLive` pattern), a row in the runtime snapshot, and a `runtime-digest.test.ts` twin that isolates the fold (R-5).
Mutation: remove the fold, the twin goes red. Nothing else in this document changes.

## 8. Harness support (G-16)

`pnpm playtest` runs a real `MissionRuntime`, so an `escort` objective **is evaluated** in a plan today: nothing
about the objective needs harness work. What the harness lacks, read from `playtest-run.ts`:

1. **A plan finds units by unit type, not by tag.** The `Plan` signature is
   `(sim, rt, ids: (t: string) => number[], at)`, where `ids('dozer_d9')` returns every `dozer_d9`. That is enough
   for *The Blade Line* only while the four tagged dozers are the only dozers. A tagged group among untagged
   units of the same type needs the tag. **Proposal:** a read-only `MissionRuntime.taggedIds(tag): readonly number[]`
   (the `tags` map, copied), passed to a plan as a fifth argument or through `rt`. It reads, never writes
   (invariant 4).
2. **The plan needs the work verbs.** An explicit `demolish` per `low_profile` tile (the 13 berm tiles in the
   Bir Tarsha IV design), `move` for the lane, and a `chargeTunnel` for the shafts. All exist as `Command`s; no
   new primitive. The plan is long, not hard.
3. **The passive-probe expectation.** A passive plan on *The Blade Line* must **lose to the clock** (the raze's
   `seconds`), not stall: with `until`, an escort that never completes and a raze that has a deadline resolves as
   a defeat caused by the raze. That is the measure `playtest` already reports, and it is the reason for R5.
4. **A losing probe for the tolerance.** One plan that deliberately drives two dozers into the ATGM lane and
   asserts the defeat cause is the escort, and one that loses one and still wins. These two are the playtest
   witnesses for `fail_after_losses`; neither exists today because no shipped mission has the field.
5. **Margins.** The 30-seed slowest win must still leave the 120 s and 20% margin to `time_limit_s` (CLAUDE.md,
   "Adding content"); an escort that ends at `far_gate` after the work adds the roll-through time, which the
   plan author measures.

## 9. Rollout

1. **Schema + sim + validator + tests** in one PR (this design's section 6), no mission uses the fields yet. Gate:
   `pnpm test`, `pnpm test:determinism` (the canary for invariants 2 and 3, required before any commit touching
   `@lions/sim`), `pnpm validate:data`, `pnpm lint`. The determinism golden hash in `determinism.test.ts` must
   **not** change; if it does, the change broke the default path.
2. **Harness**: `taggedIds`, then the Blade Line plan, in the PR that authors `bir_tarsha_4_clearance`.
3. **Docs**: the `escort` paragraph in `mission.schema.json`; `docs/campaign/README.md`'s objective table (one
   line); `docs/agent-notes/mission-findings.md` gets a short "escort through the work" entry. The Bir Tarsha
   design's G-2 row is closed by that PR.
4. **Presentation (follow-on, not in this feature):** the objective row for a waiting escort should say what it is
   waiting on. `objectiveList` already carries `zone` for an escort; a `waitingOn: string[]` of the unfinished
   `until` ids is a snapshot-only read. It is a separate small PR so this one stays a pure sim and data change.

## 10. Open decisions for the lead

1. **Per-tick arrival (recommended) or a latch?** §3 C, §7. The recommendation makes the escort end with the dozers
   in the gap; a latch lets them finish work elsewhere first.
2. **Option A (fields on `escort`) or B (a separate `protect` ceiling)?** A is the smallest now; B is the better
   shape if a third "keep these alive" mission appears with no destination.
3. **R5 (every `until` a primary).** The alternative is to let a failed secondary fail the escort too, which
   needs failure propagation and attributes the defeat to the dozers when the cause was the clock.
4. **R7 (protect-in-place when `until` is present).** On by default in this design; say so if *The Line* should not
   be able to use it.
5. **The default limit.** 1 keeps every shipped mission identical. There is no shipped escort today
   (`grep -l '"type": "escort"' data/missions/*.json` finds none), so the default is a compatibility promise for
   authored fixtures and the schema's existing description only.
