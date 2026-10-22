# Mobility kills: design (GH-706)

Status: **design for the lead, no code.** Lane C (sim). Written 2026-10-22 against
`origin/main` at `be5ce361` (Yanshuf landed, #721 still open).

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

## 3. Proposed model

### 3.1 Keep ONE draw; reshape the weights

Do not add a second roll. `rollComponent` keeps its one `nextU32(shooter)`;
only the mobility WEIGHT changes, so every stream stays aligned and the
draw count per penetration is unchanged. The weight becomes

```
wMob = COMP_MOBILITY × arcMult[arc] × classMult[weapon class] × unitMult   (integer %, floored)
```

all integer percent in `tuning.ts` (no float, invariant 2), with the total
recomputed so the other rows keep their absolute weights. Starting numbers
(to be measured, §6):

| arc | mult | | class | mult |
|---|---|---|---|---|
| front | 75 | | `apfsds` | 100 |
| side | 150 | | `heat`, `rpg`, `atgm` | 100 |
| rear | 125 | | `autocannon` | 125 |
| | | | `he`, `mortar`, `rocket`, `demolition` | 150 |

Reasoning: running gear sits on the flanks and below the glacis; blast is what
throws a track. Note: the sim has no top-attack concept today (the `top` armour
value is unread, and `TOP_ATTACK_WEAPON_IDS` lives in the renderer only), so a
Spike is an `atgm` at 100; a roof-strike discount waits on a sim top-attack flag.
The arc is already computed for the same shot (`presentedArc`), so this is a read, not a new
geometric test.

### 3.2 Data: `mobility.immobilise`, optional, role defaults

```json
"mobility": { "immobilise": { "weight": 1.0, "gear": "tracks", "partial": false } }
```

- `weight` — the per-hull `unitMult` (default 1.0; schema 0–3).
- `gear` — `"tracks" | "wheels" | "rotor"`, defaulting from the running-gear
  recipes' own classification (Lavi, Namer, D9 tracks; Eitan, Kipod, Shachaf
  wheels; `domain: air` rotor). `validate:data` pins the default against
  `tools/src/meshes/running-gear-recipes.ts` both ways, the way
  `vehicle-weight-params.ts` is pinned to the GLBs.
- `partial` — default `true` for `wheels`, `false` otherwise.

Adding a hull is JSON only (CLAUDE.md "adding content").

### 3.3 States (one new hashed column)

`mobilityKilled` keeps its meaning (immobilised) so the HUD, alerts, voice and
versus need no rename. Add `mobilityDamaged: Uint8Array` (hashed):

| state | entered by | effect |
|---|---|---|
| sound | — | — |
| **damaged** (wheels only) | first `mobility_kill` on a `partial` hull | speed and turn rate × `MOB_DAMAGED_MULT` (50) |
| **immobilised** | `mobility_kill` on tracks, or a second one on wheels, or `combat_ineffective` | `stepPerTick` 0 **and hull facing frozen** |
| destroyed | catastrophic / HP | — |

**Frozen facing is the substantive rule change.** `turnToward` returns early when
`mobilityKilled` is set. Firing needs no hull facing (the sim has no turret
column; the renderer traverses the turret on its own, `stepTurretFacing`), so the
gun still fights all round; what changes is that a stuck tank can no longer present
its glacis to a flanker. That is the tactical payoff of the whole feature, and it
also stops the track counter-rotation for free.

Air (`gear: rotor`): an immobilise result is a **forced landing**, generalising
#721's Yanshuf path to every aircraft — landed where it is if foot-open, else the
nearest foot-open tile, then immobilised on the ground. A drone (soft) never
rolls. Depends on #721 landing first.

### 3.4 Repair

1. **Workshop aura** (ships): unchanged; it clears damaged and immobilised.
2. **Crew field fix** (new): a hull immobilised by `gear: tracks` with no hit and
   not pinned for `FIELD_FIX_S` (90 s) steps DOWN to `damaged` (re-tracked,
   limping), never to sound. Wheels: no field fix (the partial state already is
   one). Air: none.
3. **Engineer assist** (new, wires the dead `repair` ability): a unit with
   `repair` (proposed: `dozer_d9`, `demo_squad`) standing adjacent and not moving
   halves the field-fix clock, and lets a wheeled hull field-fix too.

Counters reuse `auraRepairTicks`'s shape (one Int32 per entity, hashed), so the
same "a hit restarts it" rule holds everywhere.

### 3.5 AI and missions

No enemy hull is hard, and no map places an enemy workshop: **no AI recovery in
v1.** If a hard Sarim vehicle is ever authored, it inherits the field fix with no
AI code (it is a timer, not an order). Mission data needs nothing new.

## 4. Presentation (HUD and icons only; no world status mark)

- **Already right:** card state, symbol, selection chip, alert, radio call.
- **New `damaged` state:** `hud.state.limping` "Running gear hit — slowed", its
  `.why`, a chip `{n} SLOWED`, ranked below immobilised in the D5 chip order.
  Same struck-wheel glyph at half ink, or a new glyph — lead's call (Q6).
- **Field-fix progress:** the unit card shows "Re-tracking 0:47" from the hashed
  counter; nothing on the map.
- **Running gear:** frozen facing makes yaw rate 0, so the tracks stop
  counter-rotating with no renderer change. A damaged wheeled hull keeps spinning
  at its (lower) speed — correct.
- **Thrown track (optional, physical, not a status mark):** the damage pass
  already builds a thrown track on the sand for Lavi, officer_armour, Namer and
  D9, but only inside the `WRECK_` twin under `death_root` (scale 0 while alive).
  Showing it on a LIVING hull needs the pass to split that debris into its own
  `DMG_track` node and the runtime to toggle it on `mobilityKilled`; +0 draw
  calls if it stays in the hull's batch. The tread mesh on the hull would still
  draw, so it reads as "track off, track still on" unless the pass also cuts a
  live `tracks_off` variant. Recommend deferring (Q5).

## 5. Pins that would move

| pin | moves? | why |
|---|---|---|
| Golden determinism hash | **yes** | new hashed columns, and the reweighted table changes outcomes |
| `pnpm balance` §5.7 | **likely** | armour duels: side shots immobilise more, frozen facing exposes flanks |
| `pnpm playtest` outcomes | **check** | armour-heavy plans (Wadi Halam, Tel Marum III, Beit Sahwan IV's Namer, see `playtest.ts:1035`) |
| `LADDER_CREDITS` / `CAMPAIGN_CREDITS` | **maybe** | only if a star or ROE result moves |
| `ROSTER_MAX` (29) | **maybe** | if a hull that used to die now survives, or vice versa |
| versus hash pins | **yes** | same as golden |
| `versus:probe` (report-only) | **yes** | KDF-vs-KDF armour |
| golden visual gate | **no** | no gated scenario fights armour; `combat` is report-only |
| `net/outcome.ts` stalemate | **wording** | "can never move again" becomes "cannot move now"; the rule still terminates because repair needs time with no hits |

## 6. Measurement plan

1. **Report-only probe** `tools/src/backtest/mobility-probe.ts`: 30 seeds × the
   §5.7 armour matchups plus a Lavi-vs-`at_team` flank duel; prints component
   results by class × arc, seconds spent immobilised, and the ending
   (repaired / field-fixed / destroyed / survived stuck). Baseline on `main`
   first, then each step.
2. **Falsify the probe before trusting it** (CLAUDE.md): `arcMult` all 0 must
   read zero mobility kills; frozen facing removed must read a different side-hit
   share against the flanker.
3. `pnpm balance`, `pnpm playtest`, `pnpm versus:probe`, `test:determinism` on
   each step; land the hash change with the reason in the same commit.
4. Order: (a) frozen facing alone, (b) weights, (c) partial state, (d) field fix
   and engineer assist, (e) air forced landing. Each step measured on its own so a
   moved §5.7 number has one cause.

## 7. Questions for the lead (each with a recommendation)

1. **Frozen hull facing on immobilise?** It is a real rule change: stuck tanks
   become flankable, and it moves §5.7. *Recommend yes* — it is the whole point of
   a mobility kill and it fixes the counter-rotating tracks.
2. **Weight by arc and weapon class (§3.1), or keep §5.4's flat 20?** *Recommend
   the table*, with numbers set by the probe, and the GDD §5.4 text updated to say
   the mobility weight is modulated.
3. **Repair beyond the workshop: crew field fix to "slowed" after 90 s quiet,
   plus D9/engineer assist?** *Recommend yes to the field fix, engineer assist in
   the same step*; otherwise a mobility kill is permanent in every shipped
   mission, since no map places a workshop.
4. **Wheeled hulls take a partial ("slowed") state first?** *Recommend yes* for
   `wheels` only — an 8x8 runs on a lost wheel, a tank does not run on a thrown
   track.
5. **Thrown-track geometry on living hulls?** *Recommend defer*: HUD reading is
   complete without it, and doing it honestly needs a second live variant from the
   damage pass.
6. **New glyph for "slowed", or the immobilised wheel at half ink?** *Recommend
   half ink* (no new symbol, colour-vision safe by shape).
7. **Aircraft: forced landing for all air hulls (after #721)?** *Recommend yes*;
   a hovering, unmovable gunship is the same defect #721 fixed for the Yanshuf.
8. **Versus: does a field fix delay the stalemate rule?** *Recommend yes,
   unchanged rule*: a stuck hull is "immobile" only while immobilised; repair
   needs quiet time, so a stalemate still resolves.
