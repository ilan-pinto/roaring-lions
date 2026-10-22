# Mobility kills: design (GH-706)

Status: **ruled 22 Oct 2026 (lead, comment on #723); amended to the rulings.**
Lane C (sim). Written 2026-10-22 against `origin/main` at `be5ce361` (Yanshuf
landed, #721 still open). Sections 1-2 are the survey as written; sections 3-7
are the model AS RULED, and the original proposal's rejected parts are kept in
§8 so the reasoning is not lost.

The issue asks for a running-gear hit that immobilises a vehicle (stuck, turret
still fights) until it is repaired or destroyed. **Most of that already ships.**
GDD §5.4's component table has had a `mobility_kill` row since M0, and the HUD,
alerts and radio already read it. What is missing is narrower than the issue
assumes: the roll ignores weapon and facing, the "stuck" hull still pivots, there
is no partial state, and the only repair needs a structure no mission places.
This spec maps what exists, then proposes the smallest model that closes the gap.

## 1. What exists today (read from the code, not recalled)

**The roll.** `resolveHit` → on penetration, `applyDamage`, then, if the target
lives, `rollComponent` (`packages/sim/src/sim.ts:6063`). One draw on the
SHOOTER's per-entity stream (`this.rng.nextU32(shooter)`, invariant 3) over the
§5.4 weights in `tuning.ts`: crew shaken 45, **mobility 20**, firepower 15,
both 12, catastrophic 8, with overmatch moving up to 30 points from crew-shaken to
catastrophic. `mobility_kill` sets `mobilityKilled[target] = 1`, `moving = 0`,
`fieldRef = -1`; `combat_ineffective` sets both kills plus a suppression spike.
A `component` event is emitted with the result.

**Who can get one.** Only a hard target: `isSoft` (front armour under
`SOFT_ARMOR_LIMIT`, 30 mm) returns before the component table. Hard today:
Lavi, Namer, D9 (tracked); Eitan, Kipod, Shachaf (wheeled); Peten, Peten
gunship, Yanshuf (air, front 45 / 47 / 32 mm). The jeep, technical, gun truck, Grad and moto are soft and
can only be destroyed. **No enemy vehicle is hard**, so in the campaign this is a
KDF-only hazard; in versus both seats field KDF hulls.

**What it does.** `stepMovement` skips the hull (`sim.ts:7757`), as does the
order-walk gate (`:7394`); a mobility-killed soft unit never routs. Weapons stay
live. **But the hull still turns**: `aimHullAt` → `turnToward` (`:5297`, `:5310`)
has no mobility gate, so a stationary immobilised tank swings its whole hull, and
with it the front plate `resolveHit` reads for the armour arc, onto every threat.
An airborne aircraft that is mobility-killed hovers in place (#721 lands the
Yanshuf only; gunships and drones still hover).

**Hashed.** `mobilityKilled` and `firepowerKilled` are in the state hash
(`sim.ts:8104`) and in `SimState` (read-only to the app).

**Repair.** One path: a field-works aura with `repair_components_s`
(`kdf_workshop` 30 s, `militia_weapons_workshop` 45 s, radius 4,
`affects: vehicle`). `stepUpkeep` (`:8026`) counts covered, undamaged ticks and
clears BOTH kills at the threshold. A stuck hull cannot drive to a workshop, so
it must be built within 4 tiles of it. **No shipped map or mission places either
workshop**; the militia one is reachable by nobody. `abilities: ["repair"]` is in
the unit schema's enum and read by nothing.

**Presentation already shipped.** HUD unit card state `Immobilised — can't move,
can still fire` (`hud.ts`, `combat-state.ts` `vehicleDamage`), the struck-wheel
`immobilised` symbol (`symbol.ts`), the selection chip `{n} IMMOBILISED`
(`selection-model.ts`), the feed alert (`alerts.ts`), and the radio call
`We're stuck, tracks are gone!` (`voice/director.ts`). The Pixi-era grey world
pip is gone with Pixi; `MOBILITY_KILL_COLOR_KEY` survives only as a building-bar
fallback. **No world status mark — already compliant with the lead's rule.**

**Running gear.** Wheel spin and track scroll are driven from the weight model's
smoothed speed and yaw rate (`units/running-gear.ts`). A stuck hull has speed 0,
so its wheels already stop — but its in-place pivot counter-rotates the tracks,
which is the one visible lie.

**Versus.** `net/outcome.ts` treats `mobilityKilled` as "can never move again"
for the `stalemate` rule. Any repair path makes that wording, not the rule, stale.

## 2. Gap table

| Issue asks | Today | Gap |
|---|---|---|
| Running-gear hit immobilises, turret fights | `mobility_kill` row, weapons live | none |
| Roll from weapon type | flat 20 for every class | **missing** |
| Roll from facing | arc read for armour only | **missing** |
| Roll from the hull's own data | none | **missing** (`mobility.immobilise`) |
| Per-entity RNG, hashed | yes, shooter stream; column hashed | none |
| "Stuck" | stops moving, **still pivots** | **defect** |
| Partial (slowed) | none | **missing** |
| Wheeled vs tracked | same | **missing** |
| Repair: workshop aura | ships, unreachable in missions | partial |
| Repair: D9 / engineer | `repair` ability unread | **missing** |
| Air units | hover forever (#721: Yanshuf lands) | **missing** for gunships |
| HUD card + icon chip | ships | add the slowed state |
| Stop track scroll / wheel spin | wheels stop; tracks counter-rotate on pivot | fixed by the pivot fix |
| Thrown-track decal | wreck twin only | **missing** (optional) |
| AI recovery | no enemy hard hulls, no enemy workshops | moot today |
| Balance probe | none | **missing** |

## 3. The model as ruled

### 3.0 The lead's rulings (22 Oct)

1. **No facing freeze.** A stuck hull keeps pivoting, as today.
2. **Flat 20%.** `rollComponent`'s mobility weight stays `COMP_MOBILITY` (20) for
   every weapon, arc and hull. No arc or class table, no `mobility.immobilise`
   weight, no new probe numbers.
3. **Field repair, yes.** A mobility-killed hull's crew fixes it to "slowed"
   after 90 s with no hit taken (a hit restarts the clock); an engineer (a unit
   with the `repair` ability) or a D9 nearby speeds it up. Wheeled hulls go
   "slowed" on the first mobility hit and are fully stuck only on a second. The
   field-works workshop aura keeps working.
4. **Aircraft: forced landing for every aircraft** mobility-killed in the air,
   extending #721's air-carrier path (land where it is, or on the nearest open
   tile).
5. Display stays HUD / icon / feed only (no world marks); the thrown-track
   model is deferred.

### 3.1 The roll: unchanged

`rollComponent` keeps its one `nextU32(shooter)` draw over the §5.4 weights.
What a `mobility_kill` (or `combat_ineffective`) result DOES depends on the
hull's running gear (3.2) and its present state (3.3).

### 3.2 Data: `mobility.gear`

```json
"mobility": { "gear": "wheels" }
```

Optional, `"tracks" | "wheels"`, default `"tracks"` (which is today's
behaviour). Set to `"wheels"` on the three hard wheeled hulls (Eitan, Kipod,
Shachaf) and on the soft wheeled ones for truth's sake; a soft hull never rolls
a component. It is NOT `mobility.wheeled`, which means "a vehicle rather than
foot" and is true for a Lavi. Air types ignore it. A tools test pins it against
`tools/src/meshes/running-gear-recipes.ts` (a recipe with wheels and no track
is `wheels`; one with a track is `tracks`). Adding a hull stays JSON only.

### 3.3 States (two new hashed columns)

`mobilityKilled` keeps its meaning (stuck), so the HUD, alerts, voice and
versus keep reading it. New: `mobilityDamaged: Uint8Array` ("slowed") and
`fieldFixTicks: Int32Array` (the crew's repair clock), both hashed.

| state | entered by | effect |
|---|---|---|
| sound | -- | -- |
| **slowed** | first `mobility_kill` on a `wheels` hull; or a field fix | `stepPerTick` x `MOB_DAMAGED_PCT` (50) |
| **stuck** | `mobility_kill` on `tracks`, a second one on a slowed `wheels` hull, or `combat_ineffective` on any hull | no movement (as today); the hull still pivots (ruling 1) |
| destroyed | catastrophic / HP | -- |

A slowed hull's partial hit emits the component event with the new result
`mobility_damaged`, so the feed and the radio do not announce "stuck" for a
hull that can still drive.

### 3.4 Repair

1. **Workshop aura** (ships): unchanged threshold and rule; it now clears
   slowed as well as stuck and gun-out.
2. **Crew field fix** (new): every tick a living, surface, ground hull is stuck,
   its `fieldFixTicks` counts up; any tick it takes damage
   (`lastDamagedTick === tickCount`, the aura's own "under fire" rule) resets it
   to 0. At `FIELD_FIX_TICKS` (90 s x 20 = 1800) the hull steps DOWN to slowed,
   never to sound, and the counter returns to 0. An event
   (`fieldFixed`) tells the feed.
3. **Engineer assist** (new, wires the dead `repair` ability): while a living
   same-side unit with `repair` (granted to `demo_squad` and `dozer_d9`) stands
   within `FIELD_FIX_ASSIST_RADIUS` (2 tiles) of the stuck hull and is not
   moving, the clock counts 2 a tick: 45 s. Assists do not stack.
4. **Aircraft get no field fix.** A forced-landed aircraft stays down until a
   workshop clears it (none can reach one today) or it is destroyed; it is a
   ground target while down (#721's `isAirborne`). A crew cannot re-rig a rotor
   in a field, and a "slowed" aircraft has no meaning.

No rng anywhere in repair (invariant 3); counters are integers.

### 3.5 Aircraft

An AIRBORNE aircraft of ANY air type that is mobility-killed (`mobility_kill`
or `combat_ineffective`) makes #721's forced landing: LANDING at once where it
is if the tile is foot-open, else on the nearest foot-open tile, then LANDED.
The air state machine (`stepAirCarriers`) runs for every air type, not only
carriers; for a non-carrier `airWant` is always NONE, so only the forced
landing and the LANDED hold apply. Drones and the paramotor are soft and never
roll. The renderer draws every air type's lift through `airLiftFrac`, which is
1 while AIRBORNE, so an air unit that never lands is drawn bit-identically.

### 3.6 AI and missions

No enemy hull is hard, and no map places an enemy workshop: **no AI recovery.**
A hard Sarim hull, if ever authored, inherits the field fix with no AI code (it
is a timer, not an order). Mission data needs nothing new.

## 4. Presentation (HUD, icons and feed only; no world status mark)

- **Already right:** card state, symbol, selection chip, alert, radio call for
  stuck.
- **Slowed:** the unit card shows `Running gear hit -- slowed` with its `.why`;
  the selection chip `{n} SLOWED`, ranked below immobilised in the D5 order;
  the immobilised glyph at half ink (no new symbol).
- **Repair countdown:** a stuck hull's card shows `Repairing 0:47` from the
  hashed `fieldFixTicks` (at the assisted rate when an engineer is assisting);
  nothing on the map.
- **Feed:** a `mobility_damaged` result reads as "slowed", not "immobilised";
  `fieldFixed` reads "back on the move, slowed".
- **Running gear:** unchanged. A stuck hull still pivots (ruling 1), so its
  tracks still counter-rotate on the pivot; that is the accepted cost.
- **Thrown track geometry: deferred** (ruling 5).

## 5. Pins that move

| pin | moves? | why |
|---|---|---|
| Golden determinism hashes | **yes** | two new hashed columns; wheeled partial state; field fix |
| versus hash pins | **yes** | same |
| `pnpm balance` §5.7 | **check** | wheeled hulls now slowed first; a stuck hull frees itself after 90 s quiet |
| `pnpm playtest` outcomes | **check, must not flip** | STOP if one does |
| `LADDER_CREDITS` / `ROSTER_MAX` | **must not move** | STOP if one does |
| golden visual gate | **no** | no gated scenario fights armour |
| `net/outcome.ts` stalemate | **rule follows the model** | a stuck GROUND hull is no longer "immobile" (it field-fixes); a forced-landed aircraft still is |

## 6. Measurement

`pnpm balance`, `pnpm playtest`, `test:determinism` and the versus pins on each
sim step; the moved numbers are tabled in the build PR. No new probe (ruling 2).
Every new check is falsified by a one-line mutation of the implementation.

## 7. Questions, answered

| # | question | ruling |
|---|---|---|
| 1 | Freeze facing on immobilise? | **No** |
| 2 | Arc and class table? | **No, flat 20** |
| 3 | Crew field fix + engineer assist? | **Yes** |
| 4 | Wheeled partial state? | **Yes** |
| 5 | Thrown-track geometry? | **Deferred** |
| 6 | Glyph for slowed? | half ink (recommendation, no ruling needed) |
| 7 | Forced landing for all aircraft? | **Yes** |
| 8 | Stalemate rule? | follows the model: a stuck ground hull is not immobile |

## 8. The original proposal's rejected parts (for the record)

- **Arc x class x hull weights** (front 75 / side 150 / rear 125; `apfsds` and
  HEAT 100, `autocannon` 125, blast 150), one draw, integer percent. Rejected:
  ruling 2.
- **Frozen facing**: `turnToward` returning early while stuck, so a stuck tank
  could not present its glacis to a flanker. Rejected: ruling 1.
- **`mobility.immobilise` block** (`weight`, `gear`, `partial`). Only `gear`
  survives, as `mobility.gear`.
- **A report-only mobility probe.** Not built: with the flat weight there is
  nothing to calibrate.
