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
| attack-move, target only between effective and **maximum** range, **in the open** | **bounds**: down for `BOUND_FIRE_TICKS`, up and moving for `BOUND_MOVE_TICKS`, repeat |
| attack-move, target only in that band, **in cover** | no — it **closes**, weapon held (§3) |
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
- **Marching fire is gone for infantry.** Before, an attack-mover kept
  walking and firing at 0.55 while its target sat between effective and
  maximum range — the running fire the lead objected to. Now:
  - target in the band **in the open**: it advances by **bounds** (2 s down
    and firing, 2 s up and moving), so the rear ranks of a larger force bring
    their rifles to bear. Without bounds the Lanchester target failed (16v8
    left 10.4 survivors against 13.9: the fight broke into routs that lost
    contact);
  - target in the band **in cover** (cover level ≥ 1, `hitFactors`' own rule):
    it does not stop short; it **closes** to effective range, weapon held.

- **The sight-upgrade quirk, fixed as one rule: a far-seeing attack-mover
  closes to its weapons' effective range instead of holding at sight range.**
  `inf_squad`'s max-tier sensors put 13 tiles of sight on an 8-tile rifle.
  On `main` that already cost max-tier urban 3:1 (77% against base 100%), and
  under halt to fire it sank the max-tier smoke step. It held in three places,
  and each now closes instead:
  1. *Moving, covered target in the band*: it identified defenders in cover it
     could not answer and bounded against them under their fire. Now it closes
     (the row above).
  2. *Arrived, covered target in the band* (`stepSweep`): it knelt where it
     stopped and plinked at long range. Now it walks on toward that target. The
     sweep's "busy shooting something" now means a target inside effective
     range, or one in the band in the open (the same split as the bound: a
     squad sent to a vantage point still fires from it at an exposed enemy —
     measured: walking on regardless lost `beit_sahwan_4_subterranean` at max
     tier, whose plan holds the scree crest to shoot down into the pit).
  3. *Arrived, enemy identified but out of reach* (`stepSweep`): it stood and
     watched it, because the sweep skipped every identified contact as "the
     combat step's problem". Now it walks toward it, unless none of its
     weapons could ever engage it (a rifle squad does not chase a helicopter)
     or it is garrisoned, carried or buried.

  Proof it is the sight: with `inf_squad`'s base sensors swapped into the
  max-tier roster the smoked 2:1 cell reads 100% before and after; with the
  max-tier sensors it went 86% (first design) → 96% (this one), 240 seeds.
  Designs measured and dropped for the band: walking it silently
  (Lanchester fails, above), halting for good at maximum range (a 2:1 urban
  assault carried ~95%, two ratio steps), bounding against every target
  (max-tier smoke 86%).
- **Patrols** (`MissionRuntime.stepPatrols`): a patrol leg is a plain move, so
  a foot patroller would walk past the player holding fire, and the tick it
  reached a waypoint it would be sent on before it could kneel. A patroller
  that halts to fire and holds a target is now **halted** by the runtime, its
  interrupted leg kept; it resumes from that leg when the target is gone. A
  patrol that makes contact stops and fights. Vehicle patrollers are
  untouched.
- **Accuracy, exposure, cover: unchanged by kneeling.** A kneel at a *short*
  halt — a bound against a target in the open, nothing yet inside effective
  range — keeps the values of a unit on the move (0.55 on his own shots, 0.7
  on shots at him, `MOTION_SIG`): GDD §5.2's short-halt, which the sim has
  always priced with the moving values. A halt for good (idle, or a target
  inside effective range) is stationary, as it always was;
  `isEffectivelyMoving` is not touched. Pricing every kneeler as stationary
  took a smoked 2:1 assault from 67% to 18%; a kneeling low-profile bonus
  collapsed urban 2:1 to 2%.
- **Suppression** is unchanged; pinned units do not fire and do not change
  brace.
- **charge_squad** is excluded; its sprint is untouched.
- **Transports**: a passenger is held at `NONE` and fires as before. Boarding
  and dismounting reset to `NONE`.
- **ROE** is unaffected directly; it moves only through who is alive where.

## 4. Constants (`packages/sim/src/tuning.ts`)

- `KNEEL_DROP_TICKS = 4` and `KNEEL_RISE_TICKS = 4` (0.2 s each). The lead
  accepted 0.3 s on 6 Oct; 0.2 s is a deviation, made because with the final
  design at 0.3 s the gate's own 60 seeds read 88% on max-tier 2:1 + smoke
  against the 90% floor (94% over 240 seeds), and at 0.2 s they read 97%
  (96% over 240). In this
  model whoever fires first at close range pins the other, and the attacker
  coming into sight is always the one getting down, so every tick is paid by
  the assault. The realism-only first pick, 0.6 s / 0.5 s, read 68%.
- `BOUND_FIRE_TICKS = 40`, `BOUND_MOVE_TICKS = 40` (2 s each), used only
  against a target in the open. 60/20, 20/40 and 30/30 moved nothing outside
  noise.

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

Unchanged by the 6 Oct revision except the two durations (now 4 ticks each).

Guarantees a clip can rely on: a halts-to-fire unit that fires (a `fire` event
with it as `shooter`) reads `BRACE_KNEELING` after that tick unless it is
garrisoned or carried (one exception: a garrisoned man whose building comes
down on him in the same tick). A unit whose `brace` is not `NONE` does not
change position. `brace` is always `NONE` for a unit that does not halt to
fire. **An idle infantry unit kneels** — every stationary foot unit that
shoots is drawn kneeling within `KNEEL_DROP_TICKS` of stopping, with or without
a target. `brace` is not the old private `stance` array (the ambush flag).

## 6. Measurements

"Before" is `origin/main` at `c28de4d7`. Urban numbers are win rates of
`targets.ts`'s urban assault on the gate's own 60 seeds (`pnpm balance`) or
the 240-seed pool its smoke-step comment uses.

### `pnpm balance` (gate seeds) — green at both tiers

| target | base before → after | max tier before → after |
|---|---|---|
| ATGM Pk | 0.67 → 0.67 | 0.77 → 0.77 |
| APS intercept | 0.73 → 0.73 | 0.73 → 0.73 |
| urban 1:1 / 2:1 / 3:1 / 4:1 | 0/63/100/100 → 0/37/100/100 | 0/55/80/98 → 0/63/100/100 |
| smoke 1:1 / 2:1 (floor: 2:1 ≥ 90) | 0/100 → 0/100 | 0/97 → 0/97 |
| Lanchester 12v6 / 16v8 survivors | 12.0/16.0 → 12.0/16.0 | 12.0/16.0 → 12.0/16.0 |
| air: 1 / 2 / 3 trucks | 80/0/0 → 80/0/0 | 100/30/30 → 100/30/30 |

### 240 seeds

| cell | before | final |
|---|---|---|
| base 2:1 | 65 | 45 |
| max 2:1 | 61 | 59 |
| base 2:1 + smoke | 100 | 99 |
| max 2:1 + smoke | 98 | **96** |
| max 3:1 | 77 | **100** |
| 1:1 + smoke, both tiers | 0 | 0 |
| max 2:1 + smoke, base sensors swapped in | – | 100 |

### How the max-tier smoke cell got there (240 seeds)

| design | max 2:1 + smoke | note |
|---|---|---|
| first PR (bounds everywhere, 0.3 s) + out-of-reach sweep | 86 | gate 83: red |
| pure closing, no bounds (0.3 s) | 94 | gate 87; Lanchester fails (16v8 10.4) |
| pure closing, 0.2 s | 96 | gate 97; Lanchester fails |
| **bounds vs open, close vs cover, 0.2 s** (shipped) | **96** | gate 97; Lanchester 16.0 |
| same at 0.3 s | 94 | gate 88: red |

Other designs measured on the way (60 seeds unless noted): walking the band
silently with no idle kneel (max 3:1 53%), marching fire kept in the band
(the thing the lead asked to remove), halting for good at maximum range
(base 2:1 95–97%: two ratio steps), every kneeler priced stationary (smoked
2:1 18%), a kneel accuracy bonus ×1.2 / ×1.4 (max 3:1 55 / 67%), kneeling as
a low profile ×0.7 (base 2:1 2%), rallied attack-movers resuming their
attack (max 2:1 92%: over the 85% cap).

### `pnpm playtest` — green

Every scripted plan wins and every passive / no-orders control loses, at base
and max tier; no outcome or star changed anywhere. Pins re-pinned with
reasons: `ROSTER_MAX` 33 → 31, `LADDER_CREDITS` 5844 → 5830 (and its copy
`CAMPAIGN_CREDITS`). The bought Zikit in `beit_sahwan_4_subterranean` goes to
(42,24) instead of (42,28). Per-run table in the PR.

### Determinism

The golden replay held no unit that halts to fire (its riflemen had no
`role`), so the brace columns alone first moved the hash with no behaviour
behind it — measured: drop the `hashArray` lines and the old number returns.
`d_rifles` now carries `role: 'infantry'` and a test asserts the replay drops,
kneels, fires and rises. Flat 2109596329 → 922714084; relief 1425295494 →
3200430224. Setting the drop back to 6 ticks reds both pins. The replay's
rifles have no band (effective range = maximum), so it does not see the bound
or the closing rule; `brace.test.ts` and `sweep-out-of-reach.test.ts` do.

## 7. Decisions taken and open

Ruled by the lead 6 Oct: idle infantry kneel everywhere (accepted); urban 2:1
harder (accepted); fix the sight-upgrade quirk in this PR without lowering the
floor or restoring running fire (done: §3).

Open:
1. **Kneel 0.2 s, not the accepted 0.3 s.** At 0.3 s the final design reads
   88% on the gate's seeds for max-tier smoked 2:1 (94% at 240); at 0.2 s,
   97% (96%).
2. **Bound only against a target in the open.** This is the rule that makes
   Lanchester and the smoke step pass together; it is a new tactical
   distinction (cover level ≥ 1 counts as cover).
3. `manpad_team` derives as wheeled (role `aa`), so boulders stop it. Not
   touched.
