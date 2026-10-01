# WP-G-G0 · Skirmish AI spike report (GH-187)

Scratch branch `spike/skirmish-g0`. Throwaway: nothing here lands. The report feeds
G4 (#168, early November) and G3 (#167, 30 October).

## 1. Criteria, fixed before the build

Written and committed before any commander code existed. They come from the ledger
(G3 question 6, G4's issue text): the commander must **contest income ground**,
**answer a flank**, and **lose to a good plan without a script**. Each is scored
headlessly over ten seeds against four scripted player plans in the style of
`tools/src/backtest/playtest.ts`: `passive` (no orders), `naive` (everything
attack-moves straight up the pass at the battery), `flank` (the foot walks the
narrow corridor to the battery while the armour holds back), and `good`
(recon, a pin at the pass with the armour, the foot through the corridor, then
converge).

### Skirmish rules the criteria are scored against

The economy (WP-G-F) does not exist, so income ground is a **zone-hold proxy**.
Four income zones on the map. Every second, a side earns one point per zone it
holds **exclusively**: at least one of its living ground units stands inside, and
no living ground unit of the other side does. Air units hold nothing. A
contested zone pays nobody. The commander's wave budget is fed by the same
points (see §3), so income ground is also what buys it reinforcements.

The game lasts seven minutes (8,400 ticks, the GDD's 5-7 minute unit of content).
It ends early when the KDF destroys the Sarim rocket battery (the commander's HQ;
KDF wins), when the KDF has no ground unit left (Sarim wins), or when Sarim has no
unit left (KDF wins). At seven minutes the higher score wins; a tie goes to Sarim,
the defender.

### C1 · Contest income ground

- **C1a, take uncontested ground.** Against `passive`, by 120 s the commander
  holds at least 3 of the 4 income zones, including at least one SOUTH of the
  wall (the commander starts in none of them), in at least 9 of 10 seeds.
- **C1b, dispute what the player takes.** Against `naive`, `flank` and `good`:
  every time the player comes to hold a zone exclusively, does the commander
  order units at that zone (a `commit` naming it) within 30 s, unless its
  doctrine has written the zone off as lost to a superior force (a logged
  `withdraw` decision counts as an answer, a silence does not)? Score = answered
  captures / all captures. Pass at 75% or more.
- **C1c, out-earn a bad player.** Against `naive`, the commander's share of all
  points earned is above 50% in at least 7 of 10 seeds.

### C2 · Answer a flank

Scored on the `flank` plan, with a **static control**: the same Sarim force,
placed where Tel Marum III's garrison stands, with no commander. That control is
what the existing vocabulary does today, and the doctrine test already measured
that it cannot see or answer the corridor.

- **C2a, react.** The commander orders units at the threatened ground (the west
  income zone at the corridor's north exit, or the battery) within 30 s of first
  having contact on a flanker north of the wall, in at least 8 of 10 seeds.
- **C2b, make it cost.** The flank party's mean HP lost with the commander is at
  least twice the static control's.
- **C2c, the flank alone is not the answer.** `flank` wins strictly fewer seeds
  than `good`.

### C3 · Lose to a good plan without a script

- **C3a, beatable.** `good` wins at least 7 of 10 seeds.
- **C3b, a skill gradient.** `passive` wins 0 of 10 and `naive` wins at most 3 of
  10.
- **C3c, no script on the commander's side.** The commander's force carries no
  timed wave and no trigger: every move and every wave comes from the utility
  pass. And its decisions are not one fixed script: across the ten `good` seeds
  the commander's decision traces are pairwise distinct in at least 8 of 10.
- **C3d, no script needed on the player's side.** The `good` plan's timings
  shifted 15 s early and 15 s late (every order) still win at least 6 of 10 seeds
  each, so the win comes from the plan's shape, not from hitting a frame the
  commander happens to leave open.

### Also measured, not gating

- `pnpm test:determinism`, and a skirmish replay: two runs of the same seed must
  produce the same sim hash, score and decision trace.
- Per-tick cost at 300 living units: the sim tick, and the commander's thinking
  pass amortised per tick.

Everything below §1 was written after the build. Where the build departed from
§1's rules, it is listed under §3 "Deviations" with the measurement that
forced it. The criteria themselves were not changed.

## 2. Verdict, in one paragraph

The commander **can** be built inside the four invariants and over the existing
vocabulary, with five small additions. It is deterministic. It costs about 0.2 ms
per think at 300 units, which is about 0.01 ms per tick when it thinks once a
second. It **contests income ground** well: C1a and C1b pass at every force size
tried. It **answers a flank** once its doctrine names the route: C2a passes at
force ×1, and a supplementary reading answered 10 of 10 flank contacts within one
second. It **loses to a good plan**: C3a passes at ×1, and a concentrated plan wins
10 of 10. It fails the fourth thing the lead will notice first: **it does not
punish a bad plan**. A naive attack-move with everything wins as often as the
criteria's good plan (8 of 10 each at ×1; 4 and 3 of 10 at ×2). No force size tried
separates them. The reason is design, not engineering. The commander spreads its
force over income ground, and a fist breaks a spread force in detail. My
recommendation for G4 is **No-go on the design as built, Go on the approach**. Make
the three design changes in §7, then re-run this harness for one week at most.
Everything that could have sunk the approach has been measured and did not sink it.

## 3. What was built

All of it is on `spike/skirmish-g0`; none of it lands.

| Piece | Where | What |
|---|---|---|
| Commander | `packages/sim/src/commander.ts` (~420 lines) | Utility-scored, integer-only, own seeded `Rng` stream. It thinks every 20 ticks (1 Hz). |
| Doctrine | `tools/src/skirmish/sarim_standoff.doctrine.json` | One doctrine, Sarim "standoff", all numbers as data: power table, zones and their markers, ratios, dwell, ambush and standoff roles, the wave menu and budget. |
| Runtime door | `packages/sim/src/mission.ts` | `execDo` and `spawnWave` were factored out of `stepTriggers`/`stepWaves`, with byte-identical behaviour. `setGroup`, `command`, `dispatchWave` were added. |
| Perception | `packages/sim/src/sim.ts` | `lastSeenOf(side, target)`, read-only. |
| Harness | `tools/src/skirmish/skirmish.ts` | The skirmish rules, five plans, a static control and a massed control, criteria scoring, `--determinism`, `--cost`, `--only=`, `--arm=`, and the sweep hooks `SK_EXTRA`/`SK_DOC`. Run: `npx tsx tools/src/skirmish/skirmish.ts`. A full run takes about 30 s. |

**Map: Tel Marum III's ground (`tel_marum_3`).** It is the only shipped map with a
measured flank. The narrow corridor is foot-only, +10 tiles, and
`tel_marum_doctrine.test.ts` proves no post can watch it from outside its own
weapons. That makes "answer a flank" a real test rather than a decorated one. It
also has a static control for free: Tel Marum III's own Sarim garrison and two
timed waves are exactly "what the vocabulary does today". The relief and two
routes give the income zones a front and a back. The four income zones are the
pass, the ground north of the corridor (west), the open north-east, and the
approach SOUTH of the wall.

**Doctrine: Sarim standoff** (GDD §2: rockets, ATGMs, best-trained, standoff).
ATGMs and the MANPAD hold zones from a standoff marker behind them. Recoilless
teams arm a 4-tile ambush when they arrive. The Grad is the HQ and never moves.
Rifles hold ground.

**How the commander decides, every second:**
1. Perceive its own force, and only those enemy units its side has contact on, at
   their last-seen position.
2. Make one task per income zone, one for the HQ when it is threatened, one per
   watched route when the enemy is near it, and a reserve. Utility is the zone's
   value (jittered ±15% once per game, so no two seeds weigh the ground alike)
   plus 2× the enemy power seen near it.
3. Staff tasks greedily by utility. Enemy armour needs 1.2× its power in
   *anti-armour* units, and everything else needs 1.2× in any units. Quiet ground
   needs one rifle team. Nearest units go first, with a hysteresis bonus and a
   15 s dwell for units already ordered. If less than 0.7× is left, the doctrine
   writes the task off and its units withdraw to the reserve.
4. Issue orders only for units whose task changed. Leaving written-off ground is a
   `withdraw_to` (move). Everything else is a `commit` (attack-move). Standoff
   types go to the standoff marker.
5. Spend the wave budget (start 500, plus 2 per point earned, 30 s cooldown) on
   the task with the biggest shortfall. The wave is anti-armour if the shortfall
   is anti-armour.

### Deviations from §1's rules

- **D-1. The battery is a 120-point prize, not an instant win.** As written, the
  naive rush killed it in under 45 s in every seed under BOTH arms. The HQ stands
  6 tiles behind the pass and the Lavi's gun reaches 12. The skirmish became a
  race to one soft unit.
- **D-2. The commander fields Tel Marum III's garrison plus an extra block**
  (2 ATGM, 2 rifles, 1 recoilless), and the block is a sweep variable (§5). The
  garrison alone is a mission's enemy, sized to lose. The naive rush wiped all 8
  in under 100 s for one KDF loss.
- **D-3. The KDF fields a skirmish force, not Tel Marum III's campaign force.**
  It is 1 Lavi, 1 Eitan, 3 squads, an AT team, a mortar and a drone: 2,957
  logistics, against about 5,000 for the mission force. A skirmish is a budget.
- **D-4. The flank route hugs the west wall** in both `flank` and `good`. The first
  cut walked the flow field's diagonal past the commander's forward screen. It
  died in the open valley in every seed of both arms and never reached the
  corridor, so it was not a flank.
- **Scoring detail, C1b.** An order up to 10 s *before* the capture counts as an
  answer, because units can already be en route when the player arrives. C3d
  shifts every order at t ≥ 5 s; the t = 2-4 s opening orders are not shifted.
- **Supplementary plan `concentrated`**, not the criteria's `good`. It is one fist:
  drone and mortar first, then bounds up the axis, then spread for income once the
  defence breaks, with no corridor. It was added once it was clear `good` and
  `naive` score alike. It is reported beside the criteria and never inside them.

## 4. Results (10 seeds, force ×1: commander 3,461 logistics + 500 budget vs KDF 2,957)

| Plan | vs commander | vs static (TM III garrison) | KDF units lost vs commander (mean) |
|---|---|---|---|
| passive | 0/10 | 0/10 | 0 |
| naive (a-move all) | **8/10** | 10/10 | 5.1 of 8 |
| flank (foot via corridor) | 0/10 | 0/10 | 5 of 5 sent |
| good (pin + corridor) | 8/10 | 10/10 | 4.6 |
| concentrated (supplementary) | 10/10 | 10/10 | 3.3 |

Against the static garrison every plan but the lone flank wins 10/10 for 1-2 losses. The
commander makes every plan cost 3-5 units out of 8. It wins on points against a
passive player 1,658 to 0. It is not yet a gradient.

| Criterion | ×1 | ×2 (4,816 + 500) |
|---|---|---|
| C1a take uncontested ground | **PASS** 10/10 | **PASS** 10/10 |
| C1b dispute captures within 30 s | **PASS** 86% (55/64) | **PASS** 95% (56/59) |
| C1c out-earn naive | FAIL 2/10 | FAIL 6/10 |
| C2a react to the flank | **PASS** 8/10 | FAIL 0/10 (contact never made, see below) |
| C2b flank HP lost ≥ 2× static | FAIL 1.02× | FAIL 1.02× |
| C2c flank wins < good wins | **PASS** 0 < 8 | **PASS** 0 < 3 |
| C3a good wins ≥ 7/10 | **PASS** 8/10 | FAIL 3/10 |
| C3b passive 0, naive ≤ 3 | FAIL naive 8/10 | FAIL naive 4/10 |
| C3c no script, traces distinct | **PASS** 0 timed waves, 0 triggers, 10/10 unique | **PASS** |
| C3d good ±15 s still wins ≥ 6 | **PASS** 8/10, 10/10 | FAIL 5/10, 6/10 |
| *(supp.) C2a′ any flank contact west of x=16 answered ≤ 30 s* | *10/10, median 0-1 s* | *10/10* |
| *(supp.) corridor foot HP lost inside `good`* | *1,192 vs 729 static (1.6×)* | *1,580 vs 729 (2.2×)* |
| *(supp.) concentrated wins* | *10/10* | *7/10* |

**C2a and C2b need reading, not just scoring.**
- **C2b cannot pass as written.** The static control already kills 98% of a lone
  flank party (1,552 of 1,580 HP). The 2× threshold was fitted to the doctrine
  test's arm, where the armour pinned the pass at the same time. The same
  comparison inside the `good` plan, where the flank IS supported, reads 1.6× at
  ×1 and 2.2× at ×2.
- **C2a at ×2 reads 0/10 because the commander kills the flank before it is a
  flank.** With the corridor named as a watched route, the commander posts units
  at its south mouth. The flank party dies at (7-9, 22-25), in the valley, so the
  criterion's "contact north of the wall" never happens. The supplementary reading
  (any contact west of x = 16) is answered 10/10 within one second.
- **Before the watch route was in the doctrine, the flank was answered by
  accident.** The commander's own units commuted through the corridor on the foot
  flow field and met the flankers there. No task had seen them. That is the honest
  version of "answer a flank": the commander had no idea of a route until the
  doctrine named one (gap G-12).

**Force-size sweep (KDF wins out of 10; the commander's opening force varies, and
the KDF stays at 2,957):**

| Commander force | passive | flank | naive | good | concentrated |
|---|---|---|---|---|---|
| ×0 (2,106) | 0 | 0 | 9 | 10 | 10 |
| ×1 (3,461) | 0 | 0 | 8 | 8 | 10 |
| ×1.4 (3,931) | 0 | 0 | 9 | 8 | 6 |
| ×2 (4,816) | 0 | 0 | 4 | 3 | 7 |
| ×3 (6,171) | 0 | 0 | 0 | 1 | 3 |

Two controls say where the weakness lives. First, the **massed control**: the
same ×2 force, dug in as one block at the pass mouth with no commander. It loses
**10/10 to every attacking plan** (naive, flank, good, concentrated), on points: it
holds no ground, so it earns nothing. Second, at ×1 the massed block still loses 10/10 to naive for 2-6
KDF losses. So the commander is worth more than its force standing still: it makes
the naive rush cost 5 units instead of 1, and it out-earns a block that only
defends. The skirmish's remaining problem is the gradient, not the commander's
existence.

With ten seeds, ±1-2 wins is noise. The rows are not monotone (×1.4
`concentrated`), and should be read as bands.

### Determinism

- `pnpm test:determinism`: 11/11 pass on the branch. The golden hash did not move,
  because the runtime refactor is behaviour-identical. `pnpm playtest` exits 0,
  and `vitest run packages/sim` passes 555/555.
- Skirmish replay (`--determinism`): two runs of seed 424242 match on sim hash,
  score and decision trace (96 decisions for `naive`, 70 for `good`).
- **Falsified, then put back.** Adding `Math.random()` to the commander's
  selection score made both replays read DIVERGED, and `eslint` failed the sim
  package on the float literal (invariant 2's rule).
- **Not covered:** the commander's state (assignments, budget, its Rng word) is
  not in `sim.hash()`. Replays agree here only because the harness runs the
  commander at a fixed point after `rt.step`. That is gap G-10.

### Per-tick cost at 300 living units

Measured with `--cost`: 150 KDF and 150 Sarim on Tel Marum III, the commander
deploying and then fighting for 60 s, Node 25 on this Mac, 3 runs each. Only
ticks with 290 or more alive are counted (515-549 ticks per run).

| | sim + runtime tick, mean / p95 | commander think, mean / max | commander, amortised per tick |
|---|---|---|---|
| no commander | 1.20-1.86 / 1.30-3.44 ms | n/a | n/a |
| commander | 1.53-1.84 / 2.54-3.60 ms | 0.17-0.37 / 0.49-1.32 ms | **0.007-0.015 ms** |

That is under 0.03% of the 50 ms tick budget. The worst single think, 1.3 ms, lands
on one tick in twenty. The think is O(enemies) for perception plus O(tasks × own
units²) for assignment. That is roughly 135k comparisons at 150 own units, so a
600-unit skirmish would want an O(units × tasks) assignment, which is still
cheap. Detection and `selectTarget` (GH-24) remain the real per-tick cost, as
`docs/PERFORMANCE.md` already records.

## 5. What worked

- **The vocabulary is the right output language.** Every move the commander makes
  is a trigger `do` (`commit`, `withdraw_to`) or a wave, through the same code
  path a mission uses. The refactor that made that possible moved nothing.
  A commander built this way is data plus one interpreter, which is what CLAUDE.md
  asks of missions.
- **Perception through the side's own contact picture is enough, and it is fair.**
  The commander never reads a position it has not seen. It still contested the
  approach within seconds of contact, and answered 86-95% of player captures.
- **Integer-only utility is no handicap.** Every comparison is a
  cross-multiplication, distances are octile in 1/1024 tile, and there is no `/`
  at all.
- **Per-game jitter gives variety for free.** All ten `good` seeds produced
  distinct decision traces. The `good` plan still won with every order 15 s early
  or late, so a player cannot win by memorising a frame.
- **Two doctrine concepts earned their place, each measured:**
  - *Typed power* (armour vs soft). With one scalar "strength" and no dwell, rifles
    were sent at tanks, and the ATGMs fired 6 rounds in a whole game.
  - *Dwell* (15 s). A 1 Hz re-plan walked units back and forth under fire.
  
  Splitting power took naive's wins from 9/10 to 7/10 at the same force.

## 6. What the vocabulary could not express (each is a G-G schema or engine item)

| # | Gap | What the spike did | For G-G |
|---|---|---|---|
| G-1 | Groups are fixed at authoring time | `rt.setGroup(name, ids)` | schema: none (runtime only); engine: a group table the commander owns |
| G-2 | A stance is placement-only; nothing re-arms an ambush mid-game | `command({kind:'stance', tiles})` | schema: `do.kind: stance` |
| G-3 | A wave fires only on a timer or a completed objective | `rt.dispatchWave(...)` | engine: a decision-released wave; schema: a wave *menu* with costs, not a timeline |
| G-4 | `to` must name a marker | 6 extra spike markers (holding and standoff points per zone) | schema: a zone carries its own hold and standoff points; the commander cannot aim at a contact |
| G-5 | Trigger conditions cannot read the contact picture by region or type | `Sim.lastSeenOf` plus the commander's own scan | engine: a contact query (power by region, armour seen); schema: `on: enemy_seen(zone, type?)` |
| G-6 | No side parameter: `spawn` is side 1, `reinforce` side 0 | commander hard-wired to side 1 | schema: every `do` takes a side, for 1v1 and co-op |
| G-7 | The commander cannot smoke, strike or direct fire | the Grad fires on its own | schema: `do: smoke/strike(zone)` for the AI side |
| G-8 | No income zones, no score, no "most points at time T" victory | the harness owns the rules | schema: `income` zones and a `score` end condition. This is G-F's to define, and G3's question 2 |
| G-9 | Doctrine has nowhere to live | a JSON file in tools/ | `data/doctrines/*.json` + `doctrine.schema.json` |
| G-10 | The commander runs outside the tick and is not hashed | harness calls it after `rt.step` | engine: a commander phase in the tick, with its state in `sim.hash()` |
| G-11 | One scalar strength cannot answer "what counters what" | `armour` / `anti_armour` lists | data: a counter table per doctrine |
| G-12 | Maps declare no routes or lanes | `watch_corridor`, hand-drawn in the doctrine | schema: map `routes` (approach lanes), so a doctrine can watch any map's flanks |
| G-13 | No main effort or fallback position | `reserve` marker | doctrine: a fallback line and a concentration rule (§7) |

## 7. G4 recommendation: No-go as built, Go on the approach

**What is retired as a risk:** determinism, integer-only decisions, cost (0.01 ms
a tick at 300 units), driving the existing vocabulary, fair perception, and
non-scripted variety. G-G's engine work is the table above, and none of it is
large.

**What is not acceptable yet:** a naive attack-move wins as often as a good plan,
at every force size. Two smaller findings: games end by annihilation in 2-4
minutes, under the 5-7 minute target, and the commander banks its whole budget
against a passive player (3,816 unspent) because it only buys to close a gap.

**Design changes before the code grows**, re-run against these same criteria for
one week at most:
1. **A main effort.** When one task's enemy power exceeds half of everything the
   commander has seen, it concentrates there. It writes off peripheral ground and
   fights from a fallback line, which is a doctrine field, rather than withdrawing
   piecemeal to a reserve. The spread-over-income-ground behaviour that wins C1 is
   exactly what loses to a fist. The commander has to choose between them by
   threat, not run both.
2. **A preservation rule.** Disengage a unit before it dies, and do not commit
   into a known armour lane without anti-armour cover. Annihilation should be
   rare; holding ground over time should decide the game.
3. **An investment rule.** Spend the budget when unthreatened (patrols, forward
   pickets) instead of banking it, and the GDD's "banking >30% = income too high"
   test then applies to the AI too.

**And two changes to the criteria themselves, for the lead to rule on:**
- Replace C2b's static baseline with the `good` plan's flank component. A lone
  flank already dies to a static garrison.
- Name the good plan by its shape rather than its route. On this map, against a
  reactive commander, the corridor split is punished (C2 doing its job), and a
  concentrated plan is the good one.

**Before G4, a sandbox flag.** The lead plays five games, and that needs a shell
hook that does not exist: a flag such as `?sandbox=tel_marum_3&commander`, which
mounts the commander on side 1 and shows the score. That is a few hours in
`packages/app` and nothing in the sim.

## 8. What G3 should decide for the economy, given this

1. **Income from held ground (question 2): yes, and it works as a contest driver.**
   With zones that pay continuously and pay nobody while contested, the commander
   took ground it did not start on (C1a 10/10) and disputed 86-95% of player
   captures. Contested-pays-nobody is the rule that made both sides fight for the
   approach. Keep it.
2. **Income must not be the only way to win, and no single unit should end the
   game.** The battery as an instant win made the game a 40-second race (D-1).
3. **A doctrine's prices need their own exchange rate. Logistics cost is not one.**
   At 1.17× the KDF's logistics, the Sarim force loses 8/10 to an attack-move,
   whether a commander or a massed block holds it. Parity for the naive plan needs
   about 1.6× (×2). The cost curve prices units against a power score inside one
   roster, so G3 should ask `pnpm balance` for a cross-doctrine exchange rate
   before it fixes skirmish budgets or production prices.
4. **Production (question 3): a cooldown alone is too weak a governor for the AI.**
   With a 30 s cooldown and a gap-driven spender, the commander bought 2-3 waves a
   game when pressed and banked everything when not. Camp plus cooldown is fine
   for the player. The AI also needs a spend-down rule (§7.3), or the economy will
   read as "the AI never builds".
5. **The income rate:** the spike's 2 per zone-second, 480 a minute for four zones,
   is well above the GDD's 120-200/min anchors. It was chosen to make waves happen
   inside seven minutes. G-F should set it from those anchors, and the commander's
   menu should be priced from the same table.

## 9. Reproduce

```
cd tools
npx tsx src/skirmish/skirmish.ts                      # criteria at ×1 (default)
SK_EXTRA=2 npx tsx src/skirmish/skirmish.ts           # criteria at ×2
SK_EXTRA=1.4 npx tsx src/skirmish/skirmish.ts --only=naive,good,concentrated
npx tsx src/skirmish/skirmish.ts --only=naive,good --arm=massed
npx tsx src/skirmish/skirmish.ts --determinism
npx tsx src/skirmish/skirmish.ts --cost
SK_DOC='{"abandon_ratio_pct":40}' npx tsx src/skirmish/skirmish.ts --only=naive,good
SEED=7 SK_DEBUG=1 TRACE=1 npx tsx src/skirmish/dbg.ts naive commander   # one game, deaths + decisions
```
