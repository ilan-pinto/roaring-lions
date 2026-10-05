# Infantry halt and kneel to fire

Lead request, 5 Oct 2026: *infantry actually stop and kneel to fire, instead of
firing while running.* This is a SIM change (`@lions/sim`): it moves the golden
hash, `pnpm balance` and `pnpm playtest`. Measurements are in §6; the open
decisions for the lead are in §7.

## 1. Which units

A unit **halts to fire** when its type says so. The flag is data
(`mobility.halts_to_fire` in `unit.schema.json`) with a derived default, the
same pattern as `mobility.wheeled`:

    halts_to_fire = armed && !wheeled && domain !== 'air' && !kamikaze

On the shipped roster that is exactly (pinned by
`tools/src/halt_to_fire_roster.test.ts`): `at_team`, `atgm_cell`,
`breach_team`, `demo_squad`, `inf_squad`, `manpad_team`, `militia_cell`,
`mortar_crew`, `mortar_team`, `recoilless_team`, `recon_zikit`, `rpg_team`,
`sarim_rifles`, `sniper_team`, `yahalom_squad`.

- `manpad_team` is the one explicit override (`halts_to_fire: true`): its role
  (`aa`) makes the `wheeled` derivation call it a vehicle. That is a
  pre-existing quirk of `wheeled` (it also means a boulder field stops a
  MANPAD team), reported, not touched here.
- Excluded by construction: every vehicle (they keep firing on the move),
  every aircraft, `charge_squad` (kamikaze: its sprint is the attack and a
  vest is not aimed), and the unarmed (`digger_crew`, civilians).
- **Crew-served weapons.** Nothing in the sim made the mortar, ATGM or
  recoilless teams stationary before this. `hidden_setup` is read only by the
  dock tags; there is no deploy state. They fired on the move like a rifle
  squad, so they are *included*, with the same drop. A longer, per-type set-up
  time for a tube or a launcher is the obvious follow-up and is deliberately
  not invented here (it would be a number with nothing to measure it against).

## 2. The state machine

Per entity: `brace` (one byte), `braceTicks` (ticks left in a transition) and a
private `braceClock` (ticks in the current state, for the bound).

| value | name             | moves? | fires? |
|-------|------------------|--------|--------|
| 0     | `BRACE_NONE`     | yes    | **no** (for a unit that halts to fire) |
| 1     | `BRACE_DROPPING` | no     | no |
| 2     | `BRACE_KNEELING` | no     | yes |
| 3     | `BRACE_RISING`   | no     | no |

A unit that halts to fire fires **only** while `BRACE_KNEELING`. Two
exemptions keep the old rules: **garrisoned** (fights from a window, no pose in
the open) and **carried** (firing port). Both are held at `BRACE_NONE` and fire
exactly as before.

**Should he be down this tick?** (`stepBrace`, from this tick's target
selection in `stepCombat`):

| situation | down? |
|---|---|
| routed | no — he gets up and runs |
| not moving (idle, halted, arrived, working, watching) | **yes, target or not**: a man who has stopped takes a knee |
| stuck against a wall in his way (`selectBreachTarget`) | yes, any order |
| plain `move` | no — runs through, holding fire |
| attack-move, target inside **effective** range | yes, for good |
| attack-move, target only between effective and **maximum** range | **bounds**: down for `BOUND_FIRE_TICKS`, then up and moving for `BOUND_MOVE_TICKS`, repeat |
| attack-move, nothing to shoot | no |

**Timing, exactly** (pinned in `packages/sim/src/brace.test.ts`):

- The first shot is fired exactly `KNEEL_DROP_TICKS` ticks after the tick the
  unit first wanted to be down, and it does not move on any tick in between
  (it stops on that tick itself).
- After a rise starts, the unit moves again exactly `KNEEL_RISE_TICKS` ticks
  later.
- A man who fired this tick is still kneeling at the end of it; the rise
  starts on the next tick. So a bracer's `fire` event always comes with
  `BRACE_KNEELING` in the post-tick state.
- Interrupts mirror: a drop cut short rises only for as long as it had been
  dropping (capped at a full rise); a rise turned back drops only for as long
  as it had been rising (capped at a full drop).
- **Pinned** freezes the machine (state and clock). **Routed** does not: the
  man gets up (paying the rise) and runs.
- **Starting down:** `setAmbush` and surfacing from a tunnel put a bracer
  straight into `BRACE_KNEELING` with no drop (the ambusher is already in
  position; the fighter comes out of the shaft low, and the 3 s window is the
  player's answer). Containment (building, vehicle, tunnel) resets to `NONE`.
  Death freezes the state, so a body can be drawn falling from the pose it
  held.

## 3. How it meets the existing behaviour

- **The player never issues a plain move.** Every right-click in
  `packages/app/src/input/intents.ts` is an `attackMove`, so the brief's "a
  plain move does not halt, so the player can run through" has no button
  today. Plain `move` is what the sim issues for itself (walking to garrison,
  to board, to a demolition or tunnel charge), what `withdraw_to` and patrols
  issue for the enemy, and what scripted playtest plans issue. All of those
  run without firing. If a "run" order is ever added to the HUD, it is a plain
  move and needs nothing more from the sim.
- **Marching fire is gone for infantry.** Before, an attack-mover kept walking
  and firing at 0.55 accuracy while its target sat between effective and
  maximum range. That band is exactly the running fire the lead objected to.
  It now bounds: halts, fires from a knee, gets up, closes, halts again.
  - Walking the band silently was measured and rejected: no suppression on
    the approach, the max-tier 3:1 urban assault fell to ~60%.
  - Halting at maximum range for good was measured and rejected: from a knee
    at full accuracy, outside the defenders' own effective range, a 2:1 urban
    assault carried ~95% of the time — two ratio steps.
- **Patrols** (`MissionRuntime.stepPatrols`): a patrol leg is a plain move, so
  a foot patroller would walk past the player holding fire, and the tick it
  reached a waypoint it would be sent on before it could kneel. A patroller
  that halts to fire and holds a target is now **halted** by the runtime, its
  interrupted leg kept; it resumes from that leg when the target is gone. A
  patrol that makes contact stops and fights. Vehicle patrollers are
  untouched.
- **Accuracy, exposure, cover: unchanged by kneeling.** A kneel at a *short*
  halt — an attack-move bound with nothing yet inside effective range — keeps
  the values of a unit on the move (`MOVING_STANCE_MOD` 0.55 on his own shots,
  `TARGET_MOTION_MOD` 0.7 on shots at him, `MOTION_SIG`). GDD §5.2 names three
  shooter stances, stationary / short-halt / moving, and the sim has always
  priced short-halt with the moving values. A halt for good (idle, or a target
  inside effective range) is stationary, as it always was. Making every
  kneeling man stationary was measured: it took the smoked 2:1 urban assault
  from 67% to 18%, because a bound would then cost the attacker his
  moving-target protection and buy him nothing. Halt to fire changes *when* a
  man shoots and moves, never how hard he is to hit.
- **Suppression** is unchanged; pinned units do not fire and do not change
  brace.
- **charge_squad** is excluded; its sprint is untouched.
- **Transports**: a passenger is held at `NONE` and fires as before. Boarding
  and dismounting reset to `NONE`.
- **ROE** is unaffected directly; it moves only through who is alive where.

## 4. Constants (`packages/sim/src/tuning.ts`)

- `KNEEL_DROP_TICKS = 6` (0.3 s) and `KNEEL_RISE_TICKS = 6` (0.3 s). The
  realism-only first pick was 12 / 10 (0.6 s / 0.5 s). It was measured to
  break the smoke step (§6): in this model whoever fires first at close range
  pins the other, and the attacker leaving the smoke is always the one
  getting down. 6 / 6 is a fast drop to a knee, which is what a trained
  rifleman does under fire.
- `BOUND_FIRE_TICKS = 40`, `BOUND_MOVE_TICKS = 40` (2 s each). 60/20, 20/40
  and 30/30 moved nothing outside noise.

## 5. Renderer contract

Read-only, struct-of-arrays, written only by the sim, on `sim.state`:

- **`sim.state.brace: Uint8Array`** — per entity, one of
  `BRACE_NONE = 0`, `BRACE_DROPPING = 1`, `BRACE_KNEELING = 2`,
  `BRACE_RISING = 3`, all exported from `@lions/sim`.
- **`sim.state.braceTicks: Int32Array`** — while `DROPPING` or `RISING`, ticks
  left until `KNEELING` / `NONE` respectively; 0 otherwise. An interrupted
  transition starts shorter than the full constant, so drive a clip by
  "ticks left", not by "ticks since the state changed".
- **`KNEEL_DROP_TICKS`, `KNEEL_RISE_TICKS`** are exported from `@lions/sim` for
  clip timing.
- `UnitType.haltsToFire` (on `sim.unitTypes[typeIdx]`) says whether a type
  ever leaves `NONE`.

Guarantees a clip can rely on: a halts-to-fire unit that fires (a `fire` event
with it as `shooter`) reads `BRACE_KNEELING` after that tick unless it is
garrisoned or carried (one exception: a garrisoned man whose building comes
down on him in the same tick). A unit whose `brace` is not `NONE` does not
change position. `brace` is always `NONE` for a unit that does not halt to
fire. **An idle infantry unit kneels** — every stationary foot unit that
shoots is drawn kneeling within `KNEEL_DROP_TICKS` of stopping, with or without
a target. `brace` is not the old private `stance` array (the ambush flag).

## 6. Measurements

All urban numbers are win rates of `tools/src/backtest/targets.ts`'s urban
assault (6 militia in cover; KDF rifle squads attack-moving), on the gate's
own seeds (60, `pnpm balance`) or the 240-seed pool the smoke-step comment in
that file uses. "Before" is `origin/main` at `c28de4d7`.

### `pnpm balance` (60 gate seeds)

| target | before base | after base | before max tier | after max tier |
|---|---|---|---|---|
| ATGM Pk | 0.67 | 0.67 | 0.77 | 0.77 |
| APS intercept | 0.73 | 0.73 | 0.73 | 0.73 |
| urban 1:1 / 2:1 / 3:1 / 4:1 | 0 / 63 / 100 / 100 | 0 / 33 / 100 / 100 | 0 / 55 / 80 / 98 | 0 / 38 / 100 / 100 |
| smoke 1:1 / 2:1 (floor 2:1 ≥ 90) | 0 / 100 | 0 / 97 | 0 / 97 | 0 / **83 FAIL** |
| Lanchester 12v6 / 16v8 survivors | 12.0 / 16.0 | 12.0 / 16.0 | 12.0 / 16.0 | 12.0 / 16.0 |
| air: 1 / 2 / 3 trucks | 80 / 0 / 0 | 80 / 0 / 0 | 100 / 30 / 30 | 100 / 30 / 30 |

Every GDD §5.7 target passes at both tiers. The smoke step (lead ruling D1,
not §5.7) passes at base and misses at max tier.

### Urban cells at 240 seeds

| cell | before | 12/10 drop/rise | **6/6 (shipped)** | 4/4 |
|---|---|---|---|---|
| base 2:1 | 65 | 23 | 35 | 43 |
| base 2:1 + smoke | 100 | 69 | 99 | 100 |
| max 2:1 | 61 | 31 | 35 | 43 |
| max 2:1 + smoke | 98 | 68 | **86** | 82 |
| max 3:1 | 77 | 100 | 100 | 100 |
| 1:1 + smoke, both tiers | 0 | 0 | 0 | 0 |

The max-tier smoke shortfall is the max-tier SENSOR upgrade, not the kneel:
the same cell with `inf_squad`'s base sensors swapped in reads **100%**
(240 seeds). It is the same interaction that held max-tier 3:1 to 77% before
this change (`targets.ts` already records it), where 13 tiles of sight on an
8-tile rifle leaves an attack-mover idle with identified enemies it cannot
reach.

### Design variants measured on the way (60 seeds unless noted)

| variant | base 2:1 | base 2:1+smoke | max 3:1 | verdict |
|---|---|---|---|---|
| walk the band silently, no idle kneel | 68 | – | 53 | max 3:1 fails |
| keep marching fire in the band | 53–78 | – | 67 (240) | the thing the lead asked to remove |
| halt for good at max range | 95–97 | – | 100 | 2:1 two ratio steps |
| bounds, every kneeler stationary | 23 | 18 | 100 | smoke dead |
| **bounds, short-halt priced as moving** | 33 | 97 | 100 | shipped |
| + kneel accuracy ×1.2 / ×1.4 | 65 / 83 | – | 55 / 67 | not needed; max 2:1 hit 90 |
| + kneeling is a low profile (×0.7) | 2 | – | 80 | 2:1 collapses |

### The sweep stall (second commit)

Before the sweep fix, max-tier 3:1 read 53–63% (60 seeds), 60% at 240. With it
(and nothing else) 100% at 240 seeds; with base sensors it was already 100%
either way. The fix was not measured on `main` alone.

### `pnpm playtest`

Every scripted plan still wins and every passive / no-orders control still
loses, at base and max tier. Mission clocks moved by at most a few tenths of a
minute; the full before/after table is in the PR. Two plan-level re-scripts:
`beit_sahwan_4_subterranean (bought)`'s Zikit goes to (42,24) instead of
(42,28), and `ROSTER_MAX` re-pinned 33 → 31 (two fewer units reach the end of
the chain).

### Determinism

The golden replay held no unit that halts to fire (its riflemen had no
`role`), so the brace columns alone moved the hash with no behaviour behind it
— measured: drop the three `hashArray` lines and the old number returns.
`d_rifles` now carries `role: 'infantry'`, so the replay drops, kneels, fires
from the knee and rises inside the pin (asserted by "the replay actually
exercises halt to fire"). Flat 2109596329 → 2118781669; relief 1425295494 →
3739556491. The replay's riflemen have no effective range shorter than their
maximum, so it has no band and does not see the bound: `brace.test.ts` does.

## 7. Open decisions for the lead

1. **Max-tier smoke step** reads 83% on the gate's seeds (86% at 240) against
   a 90% floor, so `pnpm balance` is red on that one line. Root cause is the
   max-tier sensor upgrade (100% with base sensors). Options: re-fit the
   floor for max tier, fix the sensor/idle-plinking behaviour as its own
   task, or accept marching fire back in the band (which the request removes).
2. **The urban 2:1 assault moves from ~63% to ~35%.** Still inside the gate
   ("unreliable"), but the curve is steeper: halting to fire makes assaults
   harder, which is what doctrine says it should do.
3. **Idle infantry kneel.** Every stationary foot unit is drawn kneeling,
   target or not. Needed (a "set" defender must not pay the drop at contact,
   or a smoked 1:1 assault carries 48%), and visible everywhere.
4. **Drop/rise 0.3 s each**, not the 0.6 / 0.5 s realism pick, because the
   longer pair broke the smoke step at both tiers.
5. **The sweep fix** is a separate commit and can be dropped; without it
   max-tier 3:1 sits ~60% and `pnpm balance` fails a §5.7 target.
6. `manpad_team` derives as wheeled (role `aa`), so boulders stop it. Not
   touched; flagged.
