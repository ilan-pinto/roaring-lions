# Smoke: who should carry it — proposal

**Date:** 2026-09-29. **Status:** PROPOSAL. No tracked data or sim file is changed by this
document. **Worktree:** `docs/smoke-proposal` at `e3bf7484` (origin/main).
Every number below was printed by a run on this worktree; the probe scripts live in the
session scratchpad (`.../scratchpad/smoke/`) and patch **in-memory copies** of the roster,
never `data/units/*.json`.

## 0. The parked finding is wrong, and what is actually true

The parked finding said *no unit carries the `smoke` ability, so the order is unreachable
in play*. **That is false and has been false since `cdeb601f` (2026-08-04).** Eight KDF units
carry it today:

| unit | line | gate |
|---|---|---|
| `mbt_lavi` | `data/units/kdf/mbt_lavi.json:84` | Conduct 90 |
| `ifv_namer` | `data/units/kdf/ifv_namer.json:58` | Conduct 85 |
| `apc_eitan` | `data/units/kdf/apc_eitan.json:53` | **none** |
| `apc_kipod` | `data/units/kdf/apc_kipod.json:40` | 44 stars |
| `scout_shachaf` | `data/units/kdf/scout_shachaf.json:42` | 30 stars |
| `breach_team` | `data/units/kdf/breach_team.json:38` | 12 stars |
| `demo_squad` | `data/units/kdf/demo_squad.json:35` | Conduct 77 |
| `yahalom_squad` | `data/units/kdf/yahalom_squad.json:35` | Conduct 75 |

`apc_eitan` is ungated and named in 27 mission files, including the tutorial, which **teaches
the order**: step `data/tutorial/beit_sahwan_0.json:161-164` ("Press f to lay smoke",
`"intent": "smoke"`). So a player can reach it from the first mission.

What *is* true, and is probably what the finding meant:

1. **No headless instrument ever lays smoke.** No mission, no `playtest.ts` plan, no
   `pnpm balance` target issues a `smoke` command. The only callers are unit tests
   (`packages/sim/src/smoke.test.ts`, `tools/src/tel_marum_smoke.test.ts`,
   `packages/sim/src/tunnels.test.ts:1173`). The golden replay uses inline unit types
   (`packages/sim/src/determinism.test.ts:9-15`) and lays none.
2. **The enemy cannot lay smoke at all.** No enemy unit carries the ability, and adding one
   would be inert: enemy units move only through mission triggers, whose `do` vocabulary is
   `commit | withdraw_to | spawn | reinforce | dismount | remove`
   (`data/schemas/mission.schema.json:537-544`), and `mission.ts:1662` turns those into
   `move`/`attackMove` and nothing else.

## 1. How the order works today, end to end

**Input (packages/app).**
- `f` is bound to `smoke` (`packages/app/src/input/keymap.ts:37`) and quick-casts at the
  cursor (`packages/app/src/main.ts:3674-3679`). The order-row **Smoke** button arms instead,
  and the next left click spends it (`main.ts:2538-2555`, `main.ts:3384-3388`). Both end in
  `runVerb('smoke', …)` (`main.ts:2506-2521`), which passes
  `canSmoke: (i) => sim.unitTypes[…].canSmoke` (`main.ts:2514`).
- The button only appears when a selected unit is a smoker
  (`packages/app/src/ui/selection-model.ts:70`, `:146-147`, fed by `hud.ts:1596`). The unit card
  lists the capability (`hud.ts:1858`), as does the dock tag (`ui/dock-model.ts:157`).
- `resolveKeyVerb` (`packages/app/src/input/intents.ts:361-372`) filters the selection to
  smokers. With none, it shows the note `intent.smoke.none` ("nothing selected that carries
  smoke", `i18n/en.json:388`). Otherwise it emits **one** intent carrying **every** smoker's
  id, plus an order marker (`marker: true`). The dispatch is at `intents.ts:76-77`.

**Sim (packages/sim).**
- `canSmoke = abilities.includes('smoke')` (`sim.ts:494`). This is the ability's only
  reader in the sim.
- Command handler, `sim.ts:2176-2201`. For each id it checks three gates in order:
  alive and `canSmoke` (`:2178`), own cooldown at 0 (`:2179`), and target within
  `SMOKE_RANGE_SQ` of the unit (`:2180`). It then sets the cooldown (`:2181`), writes
  `SMOKE_MAX` into every tile of the disc (`:2184-2191`), and emits `smokeLaid` (`:2194`).
  The screen is laid **instantly**. There is no projectile, no flight time, and no signature
  cost to the unit that lays it.
- Tuning (`packages/sim/src/tuning.ts:190-207`):
  - **Size.** A disc of `SMOKE_RADIUS` = 3 tiles, meaning `dx²+dy² ≤ 9`, which is **29 tiles**.
  - **Placement range.** `SMOKE_RANGE_SQ` = 5242880, i.e. 80 tile², so **8.94 tiles** from
    the unit that lays it.
  - **Duration.** Each tile starts at 255 and loses `SMOKE_DECAY` = 1 per tick, so the whole
    disc is gone after 255 ticks, **12.75 s**. A sight line is cut outright while the summed
    density along it is at least `SMOKE_BLOCKS_AT` = 320 (`sim.ts:2483-2484`). A chord
    across the full 7-tile diameter stays blocked for 10.45 s; a 2-tile chord at the edge for
    4.75 s. A single tile never blocks on its own.
  - **Thin smoke.** Below the blocking threshold, smoke counts as extra cover in `losRay`
    (`sim.ts:2485`). It also multiplies hit chance by `SMOKE_HIT_MULT` = 36045 (0.55) per
    tile-equivalent, with a floor of `SMOKE_HIT_FLOOR` = 6554 (0.1) (`sim.ts:3634-3639`).
  - **Cooldown.** `SMOKE_COOLDOWN` = 900 ticks, **45 s**. It is **per unit and global to
    every type**, and there are **no charges**, so a unit can lay smoke indefinitely.
- **Height.** `SMOKE_RISE` = 2 levels above each tile's own ground (`sim.ts:759`), strictly
  above `EYE_HEIGHT` = 1 (`sim.ts:738`) and equal to `BLOCK_RISE` = 2 (`sim.ts:724`). In
  practice, smoke obscures what a building would obscure; see `raySmoke`, `sim.ts:2426`.
- Decay and cooldown both tick in `stepFields` (`sim.ts:5067-5073`), and both grids are
  hashed (`sim.ts:5163-5164`).

**Three rough edges this reading found.** None is data-fixable.
- **A refused order looks like an accepted one.** The app always drops a marker, but the sim
  silently drops the order if the unit is on cooldown or the point is more than 8.94 tiles
  away (`sim.ts:2179-2180`). The cooldown is private (`sim.ts:895`), so the app cannot tell
  the player which one happened. This breaks GDD §5.8 (legibility).
- **Selecting N smokers burns N cooldowns for one screen.** The command carries every
  smoker's id and the loop lays the identical disc once per id.
- **Mortar smoke is capped at 8.94 tiles like everything else**, although the tube reaches
  18 (`mortar_team` `mortar_60`, `range_tiles: 18`).

## 2. Which units should carry it

The principle is GDD §1 pillar 3: *"The player is few, expensive, high-tech, and visible. The
enemy is cheap, numerous, and hidden."* Smoke is the **visible side's** concealment. The
enemy's concealment is already structural (`hidden_setup`, `ambush`, tunnels, signature),
so the asymmetry argues for KDF-only smoke, not against it.

**Keep all eight shipped carriers. Each is real-world plausible:**
- Merkava-class MBT (`mbt_lavi`): hull smoke-grenade dischargers plus the internal 60 mm
  mortar.
- Namer and Eitan: smoke dischargers are standard.
- Kipod is literally the "Screen Carrier".
- Shachaf: dischargers for self-extraction.
- The three engineer and breach teams: hand smoke is standard issue for entry and
  obstacle work.

**Add `mortar_team`.** The 60 mm smoke round is the textbook source of a screen. The addition
is ungated, as the Eitan already is, so it changes no availability. Today it would lay at 8.94
tiles, not its full reach; the per-unit range is a Stage 4 item (§4).

**Do not add, for now:**
- `inf_squad`. The real squad carries smoke grenades, but it is the §5.7 reference unit,
  ungated and the most numerous. §3 shows one screen per axis is what moves §5.7, so smoke
  on every squad is a lead decision (§6), not a data tidy-up.
- `jeep_shoded`, `at_team`, `sniper_team`, `recon_drone`, `attack_drone`, `heli_peten`,
  `dozer_d9`. None is plausible, or it would contradict the unit's concealment doctrine.
- Any enemy unit (`militia_cell`, `sarim_rifles`, `rpg_team`, …). It is inert without a
  trigger verb (§0.2). If Sarim, the regular force, should ever *withdraw under smoke*, that
  is a `do: smoke` or `withdraw_to` + `screen` extension to `mission.schema.json` and
  `mission.ts`: Stage 4, via `sim-guard`.

## 3. Measured effect

### 3.1 The data change alone moves nothing (measured, not argued)

Seven abilities were added in memory: `mortar_team`, `inf_squad`, `jeep_shoded`, `at_team`,
`militia_cell`, `sarim_rifles` and `rpg_team`. That is wider than this proposal, on purpose.
The real `tools/src/balance/cli.ts` and `tools/src/backtest/playtest.ts` were then run on top:

| instrument | baseline | patched roster | verdict |
|---|---|---|---|
| `pnpm balance` (base + max-tier tables) | all 5 PASS, exit 0 | all 5 PASS, exit 0 | **identical line for line** |
| `pnpm playtest` (238 lines) | exit 0 | exit 0 | **byte-identical** |
| `pnpm test:determinism` | 11/11, hash `1147898451` | n/a | the replay uses inline types (`determinism.test.ts:9-15`); **a data change cannot reach it** |

The baseline §5.7 numbers, base roster: ATGM Pk 0.67, APS 0.73, urban
1:1=0% 2:1=63% 3:1=100% 4:1=100%, Lanchester 12v6 12.0 / 16v8 16.0, air 1aa=80% 3aa=0%.
`canSmoke` is read only by the command handler, so nothing moves until someone lays smoke.

### 3.2 §5.7 urban assault with a scripted smoke plan

This is the scenario from `targets.ts` `urbanAssault`, copied with the same seeds
(60000+ratio·1000+s, 60 per ratio), with `inf_squad` given smoke in a copy. The no-smoke row
reproduces `pnpm balance` exactly.

| plan | 1:1 | 2:1 | 3:1 | 4:1 |
|---|---|---|---|---|
| no smoke | 0% | **63%** | 100% | 100% |
| *screen*: smoke 6 tiles ahead of the group's own advance, every 10 s | 0% | **7%** | 100% | 100% |
| *blind*: smoke on the group's block front, every 10 s, any squad | 8% | **97%** | 90% | 98% |
| blind, **1 smoker per group**, unlimited, 45 s | 0% | **98%** | 100% | 100% |
| blind, 1 smoker per group, 2 charges | 0% | **100%** | 100% | 100% |
| blind, **1 smoker per group, 1 charge** (3 screens per run) | 0% | **100%** | 100% | 100% |
| blind, every squad, 1 charge | 10% | 100% | 98% | 97% |
| blind, every squad, 90 s cooldown | 10% | 100% | 97% | 98% |

- **Placement is everything, and that is a real skill gradient.** Smoke laid in your own
  path collapses the assault: at 2:1, wins fall 63% to 7% and losses rise from 0.7 to 5.4
  squads a run. Smoke laid on the defender carries it.
- **One screen per axis is enough to break the §5.7 2:1 clause.** The clause is
  "2:1 ≤ 85% and ≥ 15 pp below 3:1"; one charge per group reads 100%. Charges and cooldown
  do not gate this effect at all.
- **Mechanism, measured at 2:1 over 60 seeds.** The screen lands at a median of 20 s. It
  breaks the pin → rout → fall-back cycle that `targets.ts` documents: attacker pins fall
  from 24.2 to 10.3 a run, routs from 22.1 to 9.4, and the median defender death moves from
  171 s to 97 s. The assault arrives unbroken.
- **This is already reachable with shipped units.** One Eitan, Namer, Tzinah or demo team per
  axis is "one smoker per group". §6 escalates it; this proposal does not create it.

### 3.3 Open ground

- **§5.7 Lanchester** (20 seeds, the attacker screens its own advance): 12v6 survivors
  12.0 → 12.0, 16v8 16.0 → 15.9. **Still passes.** In a symmetric 8v8 the smoker's survivors
  go 1.2 → 5.5.
- **Crossing 18 open tiles against 4 dug-in `militia_cell` (cover 2)**, 40 seeds, attackers
  re-tasked every 60 s:

| plan | 4v4 | 6v4 | 8v4 | 12v4 |
|---|---|---|---|---|
| no smoke | 0% (lost 4.0) | 0% (5.8) | 0% (5.5) | **0% (2.6)** |
| screen own advance | 0% (4.0) | 0% (6.0) | 0% (8.0) | 0% (8.8) |
| blind the position | 0% (4.0) | 0% (4.8) | 0% (3.7) | **70% (0.3)** |

  **Yes, smoke lets an assault cross open ground it otherwise cannot.** At 3:1 the dug-in line
  never falls without it and falls 70% of the time with it, while losses drop ninefold. It
  does not rescue an under-strength assault: ratios below 3:1 stay at 0%.

### 3.4 A real mission: Tel Marum III's pass (`tools/src/backtest/saddle-price.ts`, 10 seeds)

This uses the shipped carriers (2 Lavi, 1 Namer, 2 Eitan), with armour orders unchanged.

| arm | wins | losses/run | foot HP | first foot death |
|---|---|---|---|---|
| pass, no smoke | 9/10 | 3.80 | 442/1930 | 29 s |
| corridor, no smoke | 10/10 | 3.10 | 686/1930 | 58 s |
| pass, carriers smoke the Kornet pockets from 188 s | 9/10 | 3.80 | 443 | 29 s |
| pass, carriers smoke the pockets from 130 s | 10/10 | 3.80 | 473 | 29 s |
| pass, self-screen toward the pockets, carriers only | 10/10 | 3.30 | 504 | 29 s |
| pass, self-screen, + `mortar_team` smoke | 10/10 | 3.40 | 502 | 31 s |
| pass, self-screen, + `inf_squad` smoke | 9/10 | 3.30 | 532 | 36 s |
| pass, self-screen, + mortar + inf | 10/10 | **2.90** | 629 | 41 s |

- Smoke on a real map is **useful and modest**. The best plan cuts the pass to 2.90, level
  with the corridor, and delays the first death by 12 s.
- The limit is **geometry, not tuning**. The Kornets (`atgm_cell`, `range_tiles: 10`,
  28 of 38 kills) fire from beyond the 8.94-tile placement range. The foot is hit at 29 s and
  49 s while walking to its staging point, 20 tiles ahead of the armour that carries the
  smoke. Only smokers that walk *with* the foot help.
- No smoke plan lost a mission that the no-smoke plan won.

**Side finding, not in scope:** CLAUDE.md's Tel Marum bullet quotes the pass at 1.20
losses/run and the corridor at 0.30. The unmodified `saddle-price.ts` prints **3.80 and 3.10**
on this worktree. That paragraph is stale.

## 4. Data-only or Stage 4?

- **Data-only, allowed now:** adding or removing `smoke` in `abilities`. The enum already
  exists (`data/schemas/unit.schema.json:466`), and §3.1 measured no movement in hash,
  balance or playtest. That is the whole of what the data model can express today.
- **Stage 4 (sim + schema, through `sim-guard`):**
  - Per-unit `smoke_charges`, `smoke_cooldown_s` and `smoke_range_tiles`. Today all three
    are one global constant, or do not exist.
  - One screen per order: lay from the nearest ready smoker instead of burning every
    selected unit's cooldown.
  - An exposed readiness value, so the app can say "on cooldown" or "out of range" instead of
    dropping a marker for a refused order.
  - Any enemy smoke, via a `do` verb.
  - The golden hash would not move from any of these unless the replay itself is changed to
    lay smoke. It should be changed to, since the replay currently has no smoke coverage.

## 5. G-NUM

The **data-only** columns are what ships if this is approved now. They are the only values the
model can express: 45 s, unlimited charges and 8.94 tiles for every carrier. The **Stage 4**
columns are proposals for when per-unit fields exist. §3.2 shows charges do not govern the
§5.7 effect, so they are a pacing and realism choice, unmeasured beyond that.

| unit | data-only (now) | charges (S4) | cooldown (S4) | range (S4) | reason |
|---|---|---|---|---|---|
| `mbt_lavi` | keep | 3 | 45 s | 9 | dischargers + internal 60 mm mortar |
| `ifv_namer` | keep | 2 | 45 s | 9 | hull dischargers |
| `apc_eitan` | keep | 2 | 45 s | 9 | hull dischargers; the ungated smoker the tutorial teaches with |
| `apc_kipod` | keep | 4 | 30 s | 9 | "Screen Carrier": the smoke specialist should out-smoke the line vehicles |
| `scout_shachaf` | keep | 2 | 60 s | 9 | self-extraction for an unarmed eye |
| `breach_team` | keep | 3 | 45 s | 6 | hand smoke for entry work; short throw |
| `demo_squad` | keep | 2 | 45 s | 6 | hand smoke to cover a charge |
| `yahalom_squad` | keep | 2 | 45 s | 6 | hand smoke to cover a shaft |
| `mortar_team` | **add** | 4 | 45 s | 18 | 60 mm smoke round; the only long-reach smoker, which answers §3.4's standoff problem |
| `inf_squad` | **not now** (lead) | 1 | — | 4 | real squads carry grenades, but §3.2 shows one screen per axis moves §5.7 |
| any enemy unit | **no** | — | — | — | inert without a `do` verb; GDD pillar 3 |

## 6. Escalation

Shipped smoke already breaks the §5.7 urban 2:1 clause in play: one screen per axis takes
2:1 from 63% to 100%. `pnpm balance` stays green only because the harness never lays smoke.
§5.7 targets may not be changed to fit, and this is not a mission problem, so it needs a
ruling:
- **(a)** §5.7 measures the un-smoked model, and smoke is the combined-arms skill that buys
  exactly one ratio step. Pin that as a new smoke arm in `targets.ts`, so smoke buying *two*
  steps (1:1 carrying) would fail. Today 1:1 stays at 0–10%.
- **(b)** It is a model defect, fixed in Stage 4. Candidates are area fire into a known
  position through smoke, or a signature cost for laying it. Owned by `sim-guard`, measured
  against this table.
