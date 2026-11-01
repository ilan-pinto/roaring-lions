# Combat formations for a multi-unit selection (GH-859) — design

**Date:** 2026-10-28 · **Status:** PROPOSED, for the lead. Design only: nothing under `packages/`,
`data/` or `tools/` changes on this branch. **Builds on:** the group formation
(`packages/sim/src/formation.ts`, spec `2026-09-15-group-formation-design.md`), vehicle separation
(`2026-10-23-vehicle-separation-design.md`, GH-421, landed), wounded and rescue
(`2026-10-22-wounded-rescue-design.md`, GH-707), infantry halt-to-fire
(`2026-10-05-infantry-halt-to-fire.md`) and the network game (`2026-10-10-network-game-design.md`,
`packages/net`). **Downstream:** a HUD mock for the lead, then `writing-plans`, then `sim-guard`, a
sim implementer, `render-vfx` for the HUD, `balance-analyst` and `playtest` for the measurements.

The lead's request (GH-859, 27 Oct): when several units are selected, the player picks a formation
that mimics real army doctrine. His three examples, and "and so on":

1. **Ambush:** all units surround an area.
2. **Attack:** heavy vehicles in front, infantry behind, aircraft and medics at the back at a
   distance, waiting for a call.
3. **Move:** a two-column march, heavy vehicles in front, infantry behind, aircraft and medics at
   the back, aircraft providing cover.

---

## 0. The design in one page

- **A formation is data.** One JSON file per formation under `data/formations/`, validated against
  a new `formation.schema.json`. A file names its order verb, its slot geometry per **formation
  class** (heavy armour, light vehicle, recon, infantry, support weapon, medic, aircraft), its
  march rule, its arrival facing and stance, its contact drill and what its aircraft and medics do
  on a call. Adding a formation means adding JSON. The engine provides a small fixed set of
  geometry generators, contact drills and call behaviours, and formations pick from them.
- **The command is the one we have.** `move` and `attackMove` gain one optional field,
  `formation` (a formation id string, like `build.unit`). **An order without it is byte-identical
  to today**, so every pin, every playtest plan, the §5.7 backtest and the versus probe stay where
  they are until a formation is actually ordered. That is the first gate, and it gets a mutation
  that makes it go red.
- **The sim keeps a small group table.** A formation order creates a *formation group*: its
  members, its formation, its pace, its march legs, and whether it is in contact. That is what
  lets a column keep its shape (speed matched to the slowest member, re-forming at checkpoints
  every 8 tiles), lets the whole ambush open fire together, and gives "waiting for a call" a
  meaning: the troops' own contact and casualties are the call. Integers and Q16.16 only, no
  random draws, folded into `hash()` behind a `fmLive` latch as `patrolLive` and `woundLive` are.
- **Flow fields only.** Every slot is still a tile with its own cached field. A march adds one
  route field per order and one field per member per checkpoint, computed when the checkpoint
  becomes active, as queued waypoints are today.
- **Versus is safe by construction.** One new optional field on two whitelisted kinds. It is
  rebuilt by `cleanCommand` and checked against the shared formation list by `validateCommand`.
  Ownership is unchanged. The automatic sorties and medic calls are the sim acting on its own
  members, identically on both machines, like `stepSweep`.
- **The HUD gets a formation row.** It shows when two or more of the player's own free units are
  selected. A button or key arms a formation, and the next click on the map spends it, as Patrol
  and Move do now. The MVP previews the shape as a **schematic in the button's tooltip** (DOM).
  **A ghost of the slots on the ground is a world overlay and needs a lead-approved mock before
  anyone builds it** (§7.4).
- **Formations buy nothing at §5.7** unless the lead rules otherwise (D10). An urban assault in
  the Attack formation must read inside the same band as one without, and smoke stays the only
  thing that buys a ratio step.
- **MVP = the lead's three** (Move-column, Attack, Ambush), in two sim steps. P1a is the shapes,
  arrival and the ambush springing together. P1b is the march (pace, checkpoints, dress) and the
  calls. The other eight formations (§2.2) are P2. Enemy AI and missions using formations are P3.

---

## 1. What exists today (the ground this stands on)

Read on `origin/main` @ `6448d111c`.

**Slots.** `assignFormation` (`packages/sim/src/formation.ts`) is pure. It takes masks, the
click, the group's integer centroid, the members (`{ id, domain, front }`) and a reservation map,
and returns one tile per id. The frame is the centroid→click vector quantised to an axis. Front
units (vehicles **and aircraft**) fill ranks on the click row, at `VEHICLE_SPACING` 2 sideways
and `VEHICLE_RANK_DEPTH` 3 deep. Infantry fills ranks behind them at 1, at most `MAX_LATERAL` 3
each side, within `SEARCH_RADIUS` 8. A slot is valid only when it is open for the unit's domain
and reachable from that domain's snapped origin (a breadth-first walk, N/E/S/W). A street
therefore degenerates the block into a column with no street detector. Overflow is behind-first.
`applyMove` (`sim.ts`) builds the members, calls it, and writes `goalX/goalY`, the waypoint queue
(`MAX_WAYPOINTS` 8, `wpX/wpY/wpAttack/wpSweep`) and `fieldRef`. A queued point's field is
computed **when that waypoint activates**, never at issue time.

**What the lead's examples need that this does not do:**
- Aircraft are `front`, so they lead the ranks. The lead wants them at the back.
- No class distinction beyond front/rear. Medics, support weapons and recon rank as whatever their
  domain makes them.
- Only the destination has a shape. On the way, every unit follows its own field at its own speed,
  so a Lavi (1.1 tiles/s) leaves an infantry squad (0.9) behind and a jeep (2.9) leaves everyone.
  The separation spec's Option E (speed matching) was put to the lead as a question and left
  unbuilt (`2026-10-23-vehicle-separation-design.md` §8 Q3).
- No arrival facing, no arrival stance, no shared fire discipline.
- Group identity is lost the moment the order lands. Nothing in the sim knows these units were
  ordered together.

**Pieces that already exist and are reused:**
- `setStance{ambush}` / `setAmbush` (radius ≤ `AMBUSH_RADIUS_MAX`, 10 tiles) and
  `checkAmbushSpring`, which springs **each ambusher alone** when an enemy with line of sight comes
  inside its radius. `setStance{hold}`.
- `speedMul[id]` (a per-unit Q16.16 step multiplier, used for a medic dragging a casualty), and
  `stepPerTick`, `turnPerTick` and the 16-bit `facing` angle (one turn = 65536, so the eight
  directions are multiples of 8192).
- The medic: an idle `rescue` unit picks the nearest identified friendly wounded within
  `rescue.radius_tiles` (8) and treats, drags or carries him to the nearest aid post, ambulance or
  LZ (Model A). The ambulance and medevac have `can_carry: ["wounded"]`.
- The `attack` order (`focusTarget`), the `rescue` order, and `stepSweep`.
- Deferred hash folds (`patrolLive`, `woundLive`, `sepLive`): a column joins `hash()` only once
  something that uses it exists, so no pin moves until then.
- The snapshot schema (`packages/sim/src/snapshot-schema.ts`). Every own property of `Sim` is
  classed `state`, `config`, `derived` or `scratch`, and a completeness gate fails on an
  unclassed one.
- The versus whitelist: `COMMAND_KINDS` and `cleanCommand` (`packages/net/src/protocol.ts`),
  `validateCommand` (`packages/net/src/ownership.ts`). `move`/`attackMove` pass when every id is
  the seat's own and the point is on the map.
- The order row (`packages/app/src/ui/selection-model.ts` `ORDERS`/`orderRow`, drawn by `hud.ts`),
  the keymap (`packages/app/src/input/keymap.ts`; bound today: h n p f g u o b m, ctrl+a, tab,
  space, f1, i, w a s d, z q c v, x, escape; **free: e r t y j k l**), and armed orders (Patrol's
  `input/patrol.ts` is the pattern: arm, click to send, right-click or Escape to drop).

**The measurements this design must not disturb:**
- GDD §5.7 urban assault, band in `tools/src/backtest/targets.ts` `urbanRatio`: 1:1 ≤ 25%,
  2:1 ≤ 85% **and** ≥ 15 pp below 3:1, 3:1 ≥ 65%, 4:1 ≥ 3:1 − 10 pp. The 2:1 reading has been
  about 65% since group formations landed (the earlier 15% was a stacking artifact). The smoke
  case pins the one thing allowed to buy a ratio step.
- The versus bar (`docs/agent-notes/sim-and-orders.md`): 96 seeds, offered cells only. That is the
  mirror on the four fair maps, plus KDF v Sarim on Tel Marum and Wadi Tarfan as placed force,
  `--economy` and `--tunnels` cell 3.
- `pnpm playtest` (30 seeds per plan, `LADDER_CREDITS`, `ROSTER_MAX`) and the golden hash.

**Scale.** One tile is 3 m (separation spec), and a map is 48 tiles. Doctrine's intervals (50 to
100 m between vehicles on a road march) cannot be reproduced. **This design keeps doctrine's
order, shape and relative spacing, not its metres.** Spacing is in tiles and builds on the
measured `VEHICLE_RANK_DEPTH` 3 (two hulls in consecutive ranks need up to 2.83 tiles).

---

## 2. The catalogue

### 2.1 Legend and common rules

Diagrams put forward at the top, one character per tile. `H` heavy armour, `L` light vehicle,
`R` recon, `I` infantry (a squad or team per tile), `S` support weapon, `M` medic (foot),
`+` ambulance/medevac (the casualty collection point, CCP), `A` aircraft, `x` the click. They show
a typical mix on open ground. Walls, boulders and reservations still remove slots exactly as
§4.2 of the 2026-09-15 spec says, and overflow is still behind-first.

**Formation classes.** A formation places classes, not unit ids. §3.2 derives each unit's class
from its JSON:

| class | shipped KDF | shipped enemy |
|---|---|---|
| `armour` | mbt_lavi, mbt_lavi_camo, ifv_namer, *dozer_d9 (override proposed)* | — |
| `light_vehicle` | apc_eitan, apc_kipod, jeep_shoded, demo_tzav, aa_remetz | technical, moto_rpg, gun_truck |
| `recon` | scout_shachaf, ugv_recon_dog (override), *recon_zikit (override proposed)* | — |
| `infantry` | inf_squad, inf_grenadier, at_team, breach_team, demo_squad, yahalom_squad | sarim_rifles, militia_cell, charge_squad, rpg_team, recoilless_team, digger_crew, manpad_team, atgm_cell |
| `support_weapon` | mortar_team, sniper_team, spg_cluster, spg_long_range, *at_nlos_team (override proposed)* | mortar_crew, rocket_battery |
| `medic` | inf_medic_squad, veh_ambulance (CCP), air_medevac_heli (CCP) | — |
| `aircraft` | heli_peten, heli_peten_gunship, heli_yanshuf, recon_drone, attack_drone | drone_swarm, loiter_drone, paramotor |
| *(never in a formation)* | wounded_kdf | wounded_sarim, civilians |

**Two behaviours every formation shares** (§4.6 defines them exactly):
- **On call, aircraft.** Aircraft hold a station behind the group at the formation's
  `standoff`. When the group calls (contact), an armed aircraft flies a *strike sortie* to the
  contact point as an attack-move. An unarmed or spotting aircraft flies a *spot sortie* there as a
  move. A transport or a loitering munition never sorties on its own. When the contact has been
  quiet for 10 s, the aircraft returns to its station.
- **On call, medics.** Foot medics stay at the back, out of the fight. When a member of the group
  goes down (a `wounded` is shed whose parent is a member), the nearest free group medic answers.
  It does so even while marching and beyond its own 8-tile pick radius, out to the group's call
  radius. It treats the man and takes him to the CCP (the group's ambulance or medevac, else Model
  A's nearest aid post or LZ), then rejoins its slot. The ambulance and medevac hold their slot at
  the back and **are** the CCP.

### 2.2 The formations

Each entry gives when to use it, the shape by class, spacing, facing, aircraft and medics, and the
reaction to contact. MVP entries are marked. Sources are general open doctrine: the US Army
infantry platoon and squad manual (ATP 3-21.8) and tank platoon manual (ATP 3-20.15) for wedge,
vee, line, echelon, column, coil, herringbone and the three movement techniques, and the ambush
chapter of ATP 3-21.8 for linear, L-shaped and area ambushes. Nothing here claims the doctrine of
any real army beyond those shapes.

---

#### F1. Move — two-file march column (MVP; the lead's example 3)

**When:** moving a combined force along a road, a wadi bed or between objectives when contact is
not expected. It is the fastest shape to control and the weakest to the front and flanks.
**Verb:** `move` (a plain move runs through, holding fire; GDD §5.2).

```
  ▲ travel
  H .  .            files 2 tiles apart (lateral −1 / +1)
  .  . H            vehicles staggered: same file every 3 tiles,
  L .  .            the other file offset 1 deeper
  .  . L
  I .  I            infantry: 1 tile apart in each file, after a 1-tile gap
  I .  I
  I .  I
  S .  S            support weapons trail the infantry
  .  M  .           medics 2 tiles behind the tail
  .  +  .           CCP behind the medics
  A .  A            aircraft 3 tiles behind the tail
```
Recon, if present, takes a point slot 3 tiles ahead of the head. That is doctrine's advance guard,
and the lead's text is silent on it (D15). **Facing on arrival:** the travel direction. **March:**
pace matched to the slowest ground member, with checkpoints every 8 tiles and a 3 s dress (§4.4).
**Aircraft "providing cover":** they follow the column at their station behind the tail. While
there they engage whatever their own weapons reach, as any unit does, and they answer the
column's call. **Contact drill `halt`:** the whole column stops (remaining checkpoints dropped).
Vehicles turn their front toward the contact point, infantry halt and kneel (the existing
halt-to-fire rule), and everyone returns fire as they would standing. The group calls aircraft
and medics. The march does **not** resume by itself: the HUD raises "Column in contact", and the
player decides (D9). In a one-tile street the right file loses every slot, so the column becomes
a single file with no special case.

#### F2. Attack — armour-led assault (MVP; the lead's example 2)

**When:** an assault on a known position across open or mixed ground, with armour available.
**Verb:** `attackMove`. The front rank lands on the click, as the 2026-09-15 spec's D3 does today.

```
  H . H . H . H     armour: line abreast on the click row, 2 apart, up to ±6
  . L . L . L .     light vehicles: second rank, 3 behind
  . . . . . . .
  I I I I I I I     infantry: ranks 1 apart, up to ±3, a 1-tile gap behind the vehicles
  I I I I I I I
  . . . . . . .
  . . S . S . .     support weapons 4 behind the infantry
  . . . . . . .
  . . M . M . .     medics and CCP 6 behind the last infantry rank
  . . . + . . .
  . A . . . A .     aircraft 6 behind, spread ±2
```
**Standoff numbers:** medics and aircraft sit about 12 tiles behind the click. A defender a few
tiles past the click is therefore outside militia rifle range (7) and RPG range (5) of them, while
mortars (18) and snipers (15) still reach the objective from their slot. **Facing:** the approach
direction. **March:** as F1. Pace matching **holds through contact**, so the armour does not run
away from its infantry (D4). *(Amended 31 Oct 2026, GH-859 P1c, lead ruling: the shipped Attack has
`pace: none`. Its checkpoints and dress stay, its members walk at their own speeds, and the Column
and Ambush keep the pace. See `docs/agent-notes/sim-and-orders.md`, "Formations P1c".)* **Contact drill `press`:** members keep their attack-move and fight
under the existing rules (vehicles fire on the move, infantry close to effective range and stop,
bounding against targets in the open). Checkpoint dressing stops (nobody waits for a man who is
fighting). The group calls aircraft and medics.

#### F3. Ambush — encirclement of a kill zone (MVP; the lead's example 1)

**When:** a prepared trap on a route or in a square the enemy must cross. **Verb:** `move`, then
the `ambush` stance on arrival. **The click is the kill-zone centre.**

```
        . I H I .
      I .       . S
      H     x     H        ring of radius R (3 to 6) around the click,
      S .       . I        classes spread evenly around it
        . I H I .
            M +            medics, CCP and aircraft outside the ring,
            A              on the side the group came from (the rally point)
```
**Geometry:** the ring is the integer midpoint circle at the smallest radius R in [3, 6] whose
tile count is at least the number of ring members. Members are spread around it by stride, so each
sector gets firepower (armour and support weapons first, then infantry and recon into the gaps).
**Each ring slot prefers cover**: the best-cover open, reachable tile within one tile radially of
the ring point, ties broken by distance to the ring and then tile index. The 2026-09-15 spec
deferred a cover preference, and an ambush in the open is not an ambush. **Facing:** inward, toward
the kill zone. **Stance:** every ring member gets `ambush` with radius R. **Contact drill
`spring`:** the first member to spring (an enemy inside its radius in line of sight, the existing
`checkAmbushSpring`) or to be fired upon springs **every** member that tick. The whole ring opens
fire together, which is the point of an ambush (D8). Aircraft and medics are then called.
**Fratricide is real here**: `splashDirect` hurts every side, so a full ring can put HE onto its
own far side. §8 measures it, and D7 is the fallback to a U or L shape. Aircraft do not ring;
they wait at the rally point.

---

The proposals below are P2, one JSON file each, using only P1's machinery plus what each entry
names.

#### F4. Wedge (P2)

**When:** movement to contact in open ground, enemy position unknown. It gives all-round security
and firepower forward and to both flanks, and it is doctrine's default for a tank platoon and an
infantry squad. **Shape:** the point vehicle on the click, then armour and light vehicles
echeloned back both sides (slot k at depth 3k, lateral ±2k). Infantry fills the inside of the V
one rank behind the point, support weapons sit at the centre rear, and medics, CCP and aircraft
are at standoff 4. **Facing:** front. **Verb:** `attackMove` or `move`, whichever the player
armed. **Contact:** `halt` for move, `press` for attack-move.

#### F5. Line (P2)

**When:** the final assault across open ground against a known position, or a hasty defensive line.
It maximises fire to the front at the price of the flanks. **Shape:** every ground class in at most
two ranks abreast. Armour is in the centre at spacing 2, infantry extend the line outward at 1 (up
to ±8), support weapons are 3 behind the centre, and medics and aircraft are at standoff 6.
**Facing:** front. **Contact:** `press`. A doctrine claim to measure (§8): at equal numbers, a
line beats a column head-on.

#### F6. File (P2)

**When:** streets, defiles, the Tel Marum saddle, wadi beds, night. It is a single file: the
easiest shape to steer through a gap and the most exposed to the front. **Shape:** F1 with one
file (lateral 0), armour every 3 and infantry every 1. **Contact:** `halt`.

#### F7. Echelon left / right (P2; two files)

**When:** the threat is known to be on one flank, for example marching along a ridge with the enemy
in the valley. **Shape:** a diagonal line stepping back toward the exposed side (slot k at depth 2k
for infantry and 3k for vehicles, lateral ±2k). Support weapons sit on the protected side, and
medics and aircraft on the protected rear. **Facing:** front, with armour turned 45° toward the
exposed flank (one of the eight facings). **Contact:** `halt`.

#### F8. Bounding overwatch (P2; new drill `bound`)

**When:** contact is likely and the ground is open, such as crossing a saddle or approaching a
village edge. It is doctrine's slowest and safest movement technique. **Shape:** the group splits
into an **overwatch element** and a **bounding element** by a fixed rule. Each class is split by id
parity, so both elements stay combined-arms. Each element keeps the F4 wedge shape at half size.
**March:** the bounding element moves one checkpoint and halts, kneels and covers. Only then does
the overwatch element bound past it (alternate bounds). Checkpoints are the F1 legs, with the dress
gate applied per element instead of per group. It moves at roughly half F1's speed. **Contact
drill `bound`:** the moving element halts and goes to ground, and the stationary element fires.
Bounding stops, and the group calls. A doctrine claim to measure (§8): against the §5.7 Ashwar
ambush, bounding overwatch lowers the ambusher's first-volley rate below what a column suffers.

#### F9. Herringbone (P2)

**When:** a column halts briefly on a road or track (an air threat, a blocked route ahead, waiting
for engineers). **Shape:** F1's slots, but each vehicle steps one tile off the road to alternate
sides and turns out 45° (left file to the left, right file to the right). Infantry steps two tiles
out and kneels facing outward. Medics, CCP and aircraft stay at the centre rear. **Facing:** outward
diagonals. **Stance:** `hold`. **Contact:** none to run (already halted). The group calls.

#### F10. Coil (laager) (P2)

**When:** holding ground in the open for a while: waiting, resupply, a defensive halt with no
known threat axis. **Shape:** F3's ring generator turned outward. Armour is at the four cardinal
points, light vehicles and infantry fill the ring, and support weapons, medics, the CCP and
hovering aircraft are at the centre. **Facing:** outward. **Stance:** `hold`. **Contact:** none.
The group calls.

#### F11. Clearance — infantry leads in built-up areas (P2)

**When:** advancing into a town. Doctrine is close to unanimous that tanks do not lead into
streets: infantry screens them against RPG teams, and the tanks give direct fire from behind.
**This is the formation the urban 3:1 reading is about**, so it is measured against that band
first (§8). **Shape:** infantry (with engineers and breach teams) in two files at the front. Armour
and light vehicles follow 3 tiles behind the lead infantry in overwatch, support weapons 3 behind
them, and medics, CCP and aircraft at standoff 6. A street degenerates it to a file with
infantry at the head, the reverse of F1. **Facing:** front. **Verb:** `attackMove`. **Contact:**
`press`, with armour pace matched to the infantry. The lead's F2 puts armour first, so F11 is a
separate formation, not a silent change to his (D15).

**Deferred beyond P2:** a recon screen (recon spread thin and wide ahead of the main body), the
diamond/box, and per-formation diagonal templates (§4.2).

---

## 3. The data model

### 3.1 `data/formations/<id>.json` against `data/schemas/formation.schema.json`

Every number is an integer number of tiles or seconds. The sim converts once at load, as
`addUnitType` does, so no float reaches a tick.

```jsonc
{
  "id": "column",
  "label": "formation.column.name",      // an i18n KEY, never text (§7.5)
  "blurb": "formation.column.blurb",
  "factions": ["kdf", "sarim"],          // who may order it (D11)
  "verb": "move",                        // "move" | "attackMove" | "either" (the armed verb decides)
  "min_members": 2,
  "elements": [                          // filled in this order, each behind the last
    { "classes": ["recon"],          "shape": { "kind": "point", "ahead": 3 } },
    { "classes": ["armour"],         "shape": { "kind": "files", "files": 2, "file_gap": 2, "depth": 3, "stagger": 1 } },
    { "classes": ["light_vehicle"],  "shape": { "kind": "files", "files": 2, "file_gap": 2, "depth": 3, "stagger": 1 } },
    { "classes": ["infantry"],       "shape": { "kind": "files", "files": 2, "file_gap": 2, "depth": 1 }, "gap": 1 },
    { "classes": ["support_weapon"], "shape": { "kind": "files", "files": 2, "file_gap": 2, "depth": 1 } },
    { "classes": ["medic"],          "shape": { "kind": "files", "files": 1, "depth": 1 }, "gap": 2, "on_call": "casualty" },
    { "classes": ["aircraft"],       "shape": { "kind": "rank", "spacing": 2, "max_lateral": 2 }, "gap": 3, "on_call": "contact" }
  ],
  "march": { "legs": true, "leg_tiles": 8, "pace": "slowest_ground", "dress_s": 3 },
  "arrival": { "face": "front", "stance": "none" },     // face: front|travel|outward|inward|none; stance: none|hold|ambush
  "contact": { "drill": "halt", "call_radius_tiles": 12, "quiet_s": 10 }
}
```

**Shape generators** (engine code, each written once and pure):

| kind | parameters | used by |
|---|---|---|
| `rank` | `spacing`, `max_lateral`, `rank_depth` | F2, F5 (today's grid, generalised) |
| `files` | `files`, `file_gap`, `depth`, `stagger` | F1, F6, F11 |
| `vee` | `depth_step`, `lateral_step`, `inverted` | F4, F8 |
| `echelon` | `side`, `depth_step`, `lateral_step` | F7 |
| `ring` | `radius: [min, max]`, `cover_pref`, `turn` (inward/outward) | F3, F10 |
| `point` | `ahead` | the recon point |
| `slots` | an explicit list of `[forward, lateral]` integer pairs | the escape hatch, so a new shape needs no engine code |

`classes` in an element may also be `"rest"` (every class no earlier element took), so a formation
need not name all seven. A class no element names goes to the last element. **Contact drills**:
`halt`, `press`, `spring`, `bound`, `none`. **Call behaviours**: `contact` (aircraft), `casualty`
(medics), `none`. A formation that needs a drill or a call not on these lists is the CLAUDE.md
signal that the data model is missing a concept: extend the schema and write it once.

**Loading and validation.** `packages/data/src/index.ts` exports `formations`, an array pinned to
the directory by `index.test.ts`, as `vfxEmitters` is (an unregistered file would be silently
unorderable). `pnpm validate:data` gains `tools/validate_formations.mjs`, which checks:
- ids are unique;
- every `label`/`blurb` key exists in `en.json`;
- `factions` are real;
- extents stay inside the reachability bound (§4.5);
- `ring.radius` is within [2, 8];
- **every shipped formation places N units on open ground with no tile used twice, for N = 2…24
  and every class mix in a fixed table.** It is run, not imagined: the falsification is a file
  with two overlapping `slots`, which must go red.

### 3.2 Formation class from unit JSON

A pure function, `formationClassOf(json)`, computed once in `addUnitType` and stored on `UnitType`
as `fmClass`. It is config, not state. The first rule that matches wins:

1. role `wounded`, or side 2 (civilians) → **none** (never placed in a formation);
2. a `rescue` block, or `hull.can_carry` exactly `["wounded"]` → `medic`;
3. `mobility.domain: "air"` → `aircraft`;
4. role `artillery` or `sniper` → `support_weapon`;
5. role `mbt` or `ifv` → `armour`;
6. role `recon` → `recon`;
7. resolved `wheeled` true (the authored boolean, never `FOOT_ROLES` alone, per CLAUDE.md) →
   `light_vehicle`;
8. otherwise → `infantry`.

**Override:** an optional `formation_class` in the unit JSON, for the units this rule gets wrong.
The precedent is `mobility.wheeled` and `voice`, declared only where the default is wrong. The
spec proposes four: `dozer_d9 → armour` (an armoured breacher that leads), `ugv_recon_dog → recon`
(rule 8 would make it infantry), `recon_zikit → recon`, and `at_nlos_team → support_weapon` (a
long-range ATGM that should overwatch, not walk in the infantry ranks). A test pins every shipped
unit's class against a **literal** table (the §2.1 table), not against the function, so the
oracle cannot import its answer. Mutation: swap rules 4 and 5 and watch it go red.

**Aircraft call behaviour**, derived the same way: a weapon that can target ground, not kamikaze
and no seats → `strike`. No ground weapon (recon_drone) → `spot`. Seats (Yanshuf, medevac) or
`kamikaze` (attack_drone, loiter_drone) → `stay`. A loitering munition is spent by the player's
decision, never by a call (D6).

### 3.3 Missions and AI (P3, not MVP)

`mission.schema.json`'s waves, `commit`, `reinforce` and patrol groups gain an optional
`formation`. They send the same command, so an enemy column can be ordered to march in F1, which
is exactly the "non-reconnoitred column" the §5.7 Ashwar ambush target describes. P3, after the
player side is measured, because every scripted plan that meets such a column moves (D16).

---

## 4. The sim

### 4.1 The command

```ts
| { kind: 'move'; ids: number[]; x: Fx; y: Fx; append?: boolean; exact?: boolean; formation?: string }
| { kind: 'attackMove'; ...; formation?: string }
```

- **`formation` absent: today's code path, untouched.** `applyMove` branches before anything else
  reads the field. It is the byte-identity gate (§8.1).
- **An unknown id, or a faction the issuing side may not use: the field is ignored** and the order
  lands as a plain order. The sim does not refuse movement over a label. `validateCommand` has
  already dropped such a command in versus (§4.8), so this only matters to a script.
- **`exact: true` with `formation`:** `exact` wins. It is the sim shepherding a unit (civilians),
  never a player.
- **Fewer than `min_members` eligible members** (alive, not routed, not carried, not landing): the
  order lands as a plain order. This covers a single unit, or a selection whose other members are
  all aboard.
- **The verb:** the formation's `verb`, unless it is `either`, in which case the command's own kind
  decides. The app sends the right kind (§7.2), so `verb` is a check, not a conversion.
- **Why not a new command kind:** a formation answers the same question move and attack-move
  already answer, where to stand and how to get there. A new kind would duplicate the append,
  waypoint, carrier, landing and patrol-drop rules in `applyMove`, and `cleanCommand` already
  rebuilds these two kinds field by field. D2 records it.

### 4.2 Slot assignment, generalised

`assignFormation` keeps its signature for the no-formation path. A new pure sibling,
`assignTemplate(input, template)`, lives in the same file. It takes the formation's elements and
the members' classes instead of `front`. Everything that made the original deterministic carries
over unchanged:
- the frame is the axis-quantised approach (ties to x);
- ids are sorted;
- the walk visits N, E, S, W;
- reachability is per distinct (mask, origin);
- reservation comes from `reservedTilesFor`;
- overflow is behind-first;
- a vehicle anchors at its own domain's snapped origin (Deviation 4).

The new parts:
- **Generators output integer `(forward, lateral)` pairs**, rotated into the axis frame by
  swap-and-negate. A wedge's or echelon's diagonal offsets are still integers in that frame, so no
  trigonometry is ever needed.
- **The fill order within an element is depth first, then lateral.** A file whose lateral slots
  are walled off loses those slots, and the element runs on down the open file. That is how a
  two-file column becomes a single file in a one-tile street, with no special case.
- **Aircraft are no longer `front`** on the template path. They take their element's slots on the
  foot mask, as Deviation 8 already does.
- **The ring generator** is the integer midpoint-circle algorithm, ordered by octant and then by
  step. It is integer arithmetic only, run at load, and gives the same tile list on every machine.
  The radius rule (§2.2 F3) is a comparison of counts. **Cover preference** reads `cover[]`
  (integer) with a fixed tie-break.
- **Diagonal approaches** stay axis-quantised in the MVP. Eight-way frames would need either √2
  or a hand-authored diagonal variant per formation. The schema leaves room for an optional
  `diagonal` element list (data, no trig) in a later phase (D17).

### 4.3 The formation group

A fixed table of `MAX_FORMATION_GROUPS` (16 per side, 32 rows), struct-of-arrays and integer
only. The per-tick code allocates nothing.

| column | type | meaning |
|---|---|---|
| `fgLive` | u8 | row in use |
| `fgSide`, `fgType` | u8 | side; index into the boot-loaded formation table |
| `fgState` | u8 | `MARCH`, `ARRIVED`, `CONTACT`, `SPRUNG` |
| `fgLegs`, `fgRelease` | u8 | checkpoint count; the highest checkpoint released |
| `fgDress` | u16 | ticks since the first member reached the checkpoint being dressed |
| `fgQuiet` | u16 | ticks since the last contact (sorties return when it passes `quiet_s`) |
| `fgPace` | Fx | the step cap per tick for ground members (0 = none) |
| `fgCallX`, `fgCallY` | Fx | the contact point the last call named |
| `fgMembers` | u16 | living members, kept by increments and decrements, never a scan |

Per unit: `fmGroup` (i16, −1 for none), `fmLeg` (u8, the checkpoint it is heading to), `fmSortie`
(u8: none, out, returning), and `fmHomeX/fmHomeY` (Fx, its slot at the current checkpoint, for a
sortie or a medic to return to).

- **Allocation:** the lowest free row of the side. **A full table** degrades the order to slots
  only (shape, facing and stance, but no march, dress or calls). The card says so (§7.3). It is
  deterministic, and it is never a refusal.
- **Leaving:** any later order that names a member removes it from its group. That is patrol's
  `dropPatrol` rule, and a refused `attack` or `rescue` still changes nothing (GH-420). So does
  death, routing, boarding, garrisoning or going below ground. A row whose `fgMembers` reaches 0
  is freed.
- **Hash and snapshot:** every column above folds into `hash()` only once `fmLive` is set (the
  first formation order of the match), the pattern `patrolLive` uses. No pin moves until a
  formation is ordered. Every column is classed `state` in `snapshot-schema.ts`, the rule for a
  doubtful property. The completeness gate goes red until they are classed, which is the
  falsification for free. A new `FORMATION_WORLD_PIN` replay in `determinism.test.ts` orders all
  three MVP formations, marches, dresses, takes contact, sorties, rescues and springs.

### 4.4 Keeping formation on the march

**The route.** At order time the sim takes the group's lead domain: vehicle if any ground vehicle
is in the group, else foot. It computes (or reuses from the pool) that domain's field to the
snapped click. It then walks `dirs` from the members' integer centroid (snapped open) to the goal
in integer steps. **Checkpoints** sit every `leg_tiles` (8) steps along that walk, the last one at
the click. When the route is longer than the free waypoint budget allows (`MAX_WAYPOINTS` 8 less
any queue already held), the spacing grows to `ceil(length / budget)`, an integer divide.

**Slots per checkpoint.** At each checkpoint the members get the formation's slots, oriented along
the route there (the axis-quantised direction from the previous checkpoint). They are written as
ordinary per-unit waypoints, the mechanism the 2026-09-15 spec's §4.4 already uses for a shift
route. **Fields are computed only when a checkpoint becomes active**, as today. An intermediate
checkpoint reserves nothing. **The final checkpoint does**: `reservedTilesFor` additionally reads a
group member's last queued tile. That closes, for formation orders, the 2026-09-15 spec's
Deviation 1 blind spot (a queued point is not a reservation), at a cost of one array read per
member.

**Pace.** At order time and at each checkpoint release, `fgPace` is the minimum, over living
ground members, of each member's effective step: `stepPerTick × speedMul`, including a slowed
mobility kill. In `stepMovement` a member's step becomes `min(step, fgPace)` when `fgPace > 0`.
That is one compare per moving member per tick. Aircraft, and anyone on a sortie or a call, are
exempt: an aircraft holds station behind at the group's pace by following the checkpoints, and a
sortie flies at full speed. The card shows the pace and what sets it ("Pace 0.45 t/s, set by the
sniper team", §7.3), because a jeep crawling with no explanation reads as a bug (D4).

**Dress.** A member that reaches checkpoint k does not activate its next waypoint until the group
releases k. The group releases k when every living member on the march has `fmLeg ≥ k` and has
arrived, or when `dress_s` (3 s) has passed since the first arrival. The timeout means a member
stuck behind a hull (the separation valve is 2 s) or a fight never freezes the column. Arrivals are
counted incrementally. **Re-forming after an obstacle falls out of this**: the obstacle stretches
the group between checkpoints, and the next checkpoint reassembles it in the formation's shape,
re-fitted to that ground by the reachability walk. Doctrine calls these control points and halts.

**Rejected for keeping formation:** moving slots that follow a leader every tick. Each moving slot
would need either its own flow field every tick (a pool collapse) or straight-line steering
(which is not flow fields and does not survive a wall). §9 records it.

### 4.5 Arrival, facing and stance

On arrival at the final checkpoint:
- **Facing.** A new `restFacing` per-unit column (u16 angle, `0xFFFF` = none) holds one of the
  eight multiples of 8192. It is set by `arrival.face`: `front` and `travel` give the frame's
  forward; `outward` and `inward` give the eighth-turn nearest the vector from (or to) the
  formation's centre, chosen by integer comparisons of |dx| and |dy| with a 2:1 test, so there is
  no atan. A stationary unit with no target turns toward it at `turnPerTick`. A target always
  wins: this is where a hull rests, not where it shoots. **It changes armour arcs** (GDD §5.3,
  front ±60°), so it is combat geometry and is measured (§8, D14).
- **Stance.** `hold` or `ambush`, through the existing `setStance` writes, with the ring radius as
  the ambush radius.
- **Reachability bound.** The walk depth becomes the formation's extent, computed at load: the
  deepest and widest slot any generator can emit, plus `MAX_LATERAL`. It is capped at 24, which
  covers the whole 48×48 map at worst. That is an order-time cost, never a per-tick one.

### 4.6 Contact, drills and calls

**Contact** is event-driven, so nothing scans every tick. Two hooks set a pending flag on the
member's group (first writer wins, and writers run in shooter-id order, which is deterministic):
- in `applySuppression`, when the source side is hostile, the hit point being the suppression
  source (`suppFrom*`);
- in the fire path, when a member fires, the hit point being its target's position.

A new `stepFormations` runs once a tick after combat. It walks the live rows in index order and
does three things:
- **runs pending contacts** (the drill below);
- **advances dress timers** for rows in `MARCH`;
- **ends sorties** for rows quiet for `quiet_s`.

**Drills.**
- `halt`: drop the remaining checkpoints, set the members' `restFacing` toward the contact point
  (vehicles), state `CONTACT`.
- `press`: state `CONTACT`, dressing ends, pace stays. Attack-move does the fighting.
- `spring`: clear every member's ambush stance this tick (they all fire), state `SPRUNG`.
- `bound` (P2): the moving element halts, the stationary one keeps firing, bounding stops.

**The call (the definition the lead asked for).** "Waiting for a call" means waiting for the troops
in the group to report contact or a casualty. It is not waiting for the player.
1. **Contact call → aircraft.** Every `strike` aircraft member not on a sortie, within
   `call_radius_tiles` of the contact point, gets an attack-move (no sweep) to the contact point's
   tile, `fmSortie = out`. Every `spot` aircraft gets a move there. `stay` aircraft do nothing.
   When the row has been quiet (no member fired or was fired upon) for `quiet_s` (10 s), sortied
   aircraft are sent back to `fmHome` and rejoin the group. A player order to an aircraft takes it
   out of the group, as any order does. That is the manual override, and Halt is the way to recall
   everything.
2. **Casualty call → medics.** When `applyDamage`'s share crossing sheds a `wounded` whose parent
   is a member, the nearest free foot medic of the group (by distance squared, ties by id) gets the
   `rescue` focus on him. That is the existing `rescue` order's internals, so treat, drag or carry
   and Model A's delivery rules are untouched. It answers while marching, and out to
   `call_radius_tiles` (12) instead of its own 8-tile pick. When it has delivered, it is sent back
   to `fmHome`. The ambulance and medevac never leave their slot: they are where the medics bring
   the wounded.
3. **Manual calls** (P2): "Call air" and "Call medic" buttons on the card of a selected group,
   pointing a call at a clicked tile. They are a command, `formationCall { ids, x, y, call }`,
   whitelisted like `smoke`.

### 4.7 Determinism and cost

- **Invariant 1:** everything runs in the 20 Hz tick, and nothing reads frame time.
- **Invariant 2:** every quantity is an integer tile, a Q16.16 `Fx`, or a u16 angle. There is no
  `Math.*` anywhere: the ring is a midpoint circle, facings are eighth-turn constants chosen by
  comparisons, the centroid uses the existing remainder-first integer divide, and pace is a `min`.
- **Invariant 3:** **no random draw anywhere in this design.** Every tie breaks by id or tile
  index. No per-entity stream is touched, so no later unit's RNG shifts.
- **Invariant 4:** commands in, state and events out. New events (`formationContact`,
  `formationCall`, `formationSprung`, `formationReleased`) are what the HUD and the radio read.
  Nothing outside the sim writes the group table.

**Per tick:** one compare per moving member (pace), O(1) per suppression or fire event (the
pending flag), and O(live rows) in `stepFormations`. **Per order:** the walk (at most 2,401 tiles
at the 24 cap), the route walk (at most path length), and the template fill. **Flow fields:** one
route field per order, plus one field per member each time a checkpoint activates. A 20-unit group
activates 20 fields at once, about every 8 tiles of march, and the old ones become evictable.
`MAX_FLOW_FIELDS` 128 is a floor (a field issued this tick is never evicted), so 300 units
activating checkpoints in the same tick would grow the pool past 128 for that tick. That is
already true of a 300-unit order today. §8.6 measures the spike.

### 4.8 Versus safety

- **`COMMAND_KINDS`:** unchanged (no new kind in the MVP).
- **`cleanCommand`:** the `move`/`attackMove` branch accepts `formation` only when it is a string
  of at most 32 characters, and copies it. Anything else nulls the command, as a malformed
  `append` does. The `never` default needs no change.
- **`validateCommand`:** the existing check (own ids, on-map point), plus
  `cmd.formation === undefined || world.formationAllowed(seat, cmd.formation)`. That is an id in
  the shared formation list whose `factions` include the seat's faction. It is answered from load
  time data, so both machines agree. A forged id vanishes on both machines before the queue.
- **Ownership:** the command still names only the seat's own ids. Sorties and medic calls are
  goals the sim writes for its own members, computed identically on both machines, like
  `stepSweep`. They are never commands and never pass the whitelist.
- **Hidden information:** the formation id is visible to the other seat in the frame log, as every
  command already is (fog in versus is client honesty). It reveals nothing a unit's movement does
  not.
- **Snapshot and reconnect:** the group table is `state`, so a fork witness with formation orders
  is the proof.
- **Advisor and harness:** `packages/app/src/ui/advisor.ts` gains `net.advisor.cmd.move.formation`
  and `…attackMove.formation` ("March 6 units in column"), and the N4 harness protocol documents
  the field.
- **`manual call`** (P2) gets `formationCall` in `COMMAND_KINDS`, `cleanCommand` and
  `validateCommand` (own ids, on-map point). The `MissingCommandKind` type check catches the case
  where it is forgotten.

---

## 5. What does not change

`assignFormation`, and every order without `formation`. Separation (GH-421) is unchanged: it acts
per tick on movers whatever their goals are. The same goes for halt-to-fire, bounding against
targets in the open, focus fire, rescue and garrisons. Garrison, board, dig, charge, demolish and
tunnel orders take no formation. `stepSweep` keeps its post-contact re-stacking (Deviation 7 of
the 2026-09-15 spec): a formation does not fix it, and a pressed Attack that hunts afterwards still
heaps. The renderer is unchanged, apart from the HUD.

---

## 6. Interactions worth naming

- **Separation.** A column's files follow under separation's "follow" rule (a partial step to
  contact behind a same-way hull). Dress handles the 2 s valve. Pace matching should cut
  separation's mover-into-mover transit contacts, which the separation spec attributed to mixed
  speeds. Read the overlap probe on F1 marches (§8).
- **Halt-to-fire.** Infantry in a `move` column runs through holding fire. In Attack it halts,
  kneels and bounds as now. A formation never makes a man fire on the move.
- **Wounds.** A medic answering a call walks toward where the fire is. That is the price of the
  call, and §8.4 measures medic losses. If they are too high, D18's alternative waits until the
  wounded has crawled to cover.
- **Transports.** A loaded APC in a formation carries its passengers in its own slot. The
  passengers are not members (they were refused in `applyMove`). Unloading is the player's order.
- **Population and kit.** None. A formation costs nothing and unlocks nothing in the MVP. Whether
  a formation could be a brigade unlock (the lead likes upgrades) is a separate decision (D19).

---

## 7. The UI

### 7.1 Where it lives

A **formation row** directly above the order row in the bottom-centre cluster. It shows only when
the selection has **at least two of the player's own living units that are free**: not
garrisoned, aboard or below ground, with at least `min_members` of them for some offered
formation. It holds one button per formation the faction may use (three in the MVP). Each button
has a symbol from `symbol.ts`'s style (a role-neutral schematic of the shape), its label through
`t()`, and its key cap through `keyFor`. A formation the selection cannot form shows **inert**,
with a reason (`hud.formation.inert.needsTwo`, `…ambushNoGround`), the way `orderRow` does it, so
the dimming and the reason read the same facts.

### 7.2 Picking and ordering

- **Arm:** a button, or a key: **R** column, **T** attack, **Y** ambush. All three are free today,
  adjacent and rebindable, and listed in `keymap.ts` with the "what is bound" comment updated (D13).
  P2 formations are on buttons with no default key.
- **Spend:** the next left-click on the map issues `move` or `attackMove` with `formation`, at the
  clicked point. For Ambush the click is the kill zone. Shift+click appends, as an armed Move does.
  Right-click or Escape disarms. The armed formation stays armed for one order, as Patrol and Move
  do (D1).
- **Cursor:** the armed cursor gains a formation variant (`cursor.ts`, DOM, not the world).
- **The intent:** the `order` intent gains `formation?: string`, and `applyIntent` passes it
  through `clampToMap` as today.
- **Refusal:** an armed formation whose selection shrank below `min_members` before the click
  sends a plain order and plays the existing deny cue, with a feed line saying why.

### 7.3 What the HUD says (DOM only)

No world marks (the lead's standing rule; memory "no status marks in the world").
- **The card** of a member: "In column · checkpoint 3 of 5", "Pace 0.45 t/s, set by Sniper team",
  "On call" (aircraft or medic at its station), "Answering a call" (on a sortie or a rescue),
  "Ambush set · springs together". A degraded group (full table) reads "In formation (no march)".
- **The feed and alerts:** "Column in contact", "Ambush sprung", "Peten answering the call",
  through the existing alert feed, so `jumpToAlert` (space) works. The radio and EVA lines are the
  narrative designer's, from the new events.
- **Chips:** an optional small formation glyph on the selection chip of a member. It is a unit
  ICON, like the kit sign, so the lead's rule allows it, but it is still shown in the HUD mock
  first.

### 7.4 The preview: needs a lead-approved mock

- **MVP (no mock needed):** the formation button's tooltip draws the shape as an SVG schematic, the
  §2.2 diagrams as dots coloured by class through theme tokens. It is a DOM picture of the
  formation, not of the ground.
- **P2, only after the lead approves a mock:** a ghost of the slots on the ground while a formation
  is armed and the cursor moves. It would be small marks on each tile a unit will take, recomputed
  when the hovered tile changes. **This is a world overlay, the kind the lead has rejected on sight
  before.** The mock is a static HTML page with three captured frames (Move on a road, Attack in
  the open, Ambush in a square) at play zoom, shown before any renderer code is written. If it is
  built, the marks come from `Sim.previewFormation(ids, x, y, formation)`. That is a read-only
  query running the same pure `assignTemplate` against the live masks and reservations, so the
  preview cannot disagree with the order ("ask the sim, don't re-derive", as `canFocus` is). The
  render order comes from `units/render-order.ts`, and nothing is drawn after the order lands.
- **Also P2, mock first:** a right-drag to set the formation's facing (the Company of Heroes
  gesture). It is free in `pointer.ts` today, but it is a controls decision.

### 7.5 i18n

Every chrome string goes through `t()`, and `en.json` is the catalogue:
- `formation.<id>.name`, `formation.<id>.blurb`;
- `hud.formation.*` (row, inert reasons, card lines);
- `keymap.formationColumn` / `…Attack` / `…Ambush`;
- `net.advisor.cmd.*.formation`;
- alert keys.

The formation JSON carries **keys, never text**, so `validate:ui` has nothing bare to miss.
Labels are read through accessor functions at render time, never resolved at module load (the
`ROLE_LABEL` lesson, shipped wrong twice). A `?pseudo=1` capture of the row and the card is the
check: an unbracketed word never went through `t()`.

---

## 8. Measurement plan

Every new gate arrives with its falsification in the commit message: a one-line mutation of the
implementation, watched red, then put back (CLAUDE.md). Bands are proposed here and gated only
once the lead accepts them. Until then each probe is report-only.

1. **Byte-identity (the first gate).** With no `formation` on any command, the golden hash, every
   determinism spec, `pnpm playtest` (every plan 30/30, `LADDER_CREDITS`, `ROSTER_MAX`),
   `pnpm balance` and `pnpm versus:probe` at 96 seeds on the offered cells are byte-identical to
   main. Falsification: make `applyMove` treat an absent `formation` as `"column"`, and watch the
   hash and the probe move.
2. **Pure tests** (`formation-template.test.ts`). Every shipped formation, on hand-built maps:
   open ground, a one-tile street, the boulder corridor, all four approaches, N = 2…24, each class
   mix; no tile twice; ids shuffled give the same answer. Plus the ring's tile lists at R = 3…6
   against literal tile lists, cover preference on a hand-built cover grid, the class table
   (§3.2), and checkpoint placement along a hand-built route.
3. **§5.7 (`pnpm balance`, `tools/src/backtest/urban-only.ts` for the fast loop).** New arms,
   paired seed for seed with the existing ones, as `urbanSmokeStep` is:
   - **Urban in Attack (F2):** the same band as `urbanRatio`. **2:1 stays ≥ 15 pp below 3:1. A
     formation must not buy a ratio step** (D10; smoke stays the only buyer). The urban groups are
     rifle squads only, so F2 places them as its infantry ranks. The arm checks that pace and
     dress, which an infantry-only group barely uses, change nothing that matters.
   - **Urban in Clearance (F11, P2):** the same band, with an armoured group added to both arms.
   - **Lanchester, Line (F5) v Column (F1)** at equal numbers head-on: the line wins ≥ 70% over
     60 seeds. It is a doctrine claim that must be able to fail: falsify by giving the line the
     column's template.
   - **The Ashwar ambush target** (an unspotted RPG team's first volley before it is identified)
     against an F1 column: still ≥ 80%. Against F8 bounding overwatch: report the rate, which
     should be lower.
   - **Ambush (F3) probe:** a six-unit ring against a four-vehicle-plus-infantry column. Report
     how often every ring member fires within 1 s of the spring (claim ≥ 90%), and **friendly
     splash damage per engagement** (the fratricide reading behind D7).
   - Every arm at max tier too, as the existing targets run.
4. **Calls.**
   - **Medic probe:** time from a member going down to treatment, and bleed-outs, in F2 against no
     formation; medic losses per engagement.
   - **Air probe:** a gunship on call against one flown in the front rank, both against a MANPAD
     team. Report sortie response time and aircraft survival.
5. **`pnpm playtest`.** Plans do not use formations, so it is unchanged by item 1. Add one
   report-only variant per MVP formation on Beit Sahwan IV, Tel Marum II and Qarn Hadid III, where
   the player plan sends its main body in formation. The verdict must hold. Minutes and ROE are
   reported, not gated.
6. **Perf.** 300 units in 15 groups of 20 marching F1 on `qarn_hadid` (the separation spec's worst
   case). Tick time delta ≤ 1 ms at the median, and the checkpoint-activation tick ≤ 5 ms worst,
   measured three times; `flowFieldCount` peak reported. If it fails, raise `leg_tiles` before
   anything else.
7. **Versus (`pnpm versus:probe`, 96 seeds, offered cells only).**
   - (a) The no-formation arm is byte-identical (item 1).
   - (b) Both seats attack-move in F2: every offered cell stays inside the existing 60/40 band.
   - (c) One seat in F2 against one without: report the edge. A formation is skill, so it should
     show, but not as a stat; proposed cap ≤ 65% for the formation seat (D11).
8. **Snapshot.** The completeness gate classes every new column. A poison check runs on any
   column proposed as `scratch` (none are). A fork witness runs with formation orders in flight
   mid-march, mid-dress and mid-sortie.
9. **Separation overlap probe** on F1 marches: report transit pair-ticks against the same group
   ordered without a formation (pace matching should cut them).

---

## 9. Risks

- **Pace matching slows vehicles to a walk.** A Lavi in a column with a sniper team moves at 0.45
  tiles/s and is exposed to ATGMs for longer. That is the realism price, and it can shift versus
  balance (§8.7c). The mitigation is the player's: leave the sniper out. The card names who sets
  the pace.
- **Dress makes marches slower.** It costs only plans that use formations. Watch time limits on
  the P3 enemy columns.
- **Flow-field spikes** at checkpoint activation (§8.6).
- **Automatic sorties feed aircraft to air defence.** A gunship answering a call over a MANPAD
  team dies. The quiet-return and Halt are the controls. If §8.4 reads badly, D6's alternative
  makes strike sorties wait for the player's confirmation through the P2 manual call.
- **Medics run into fire** (§6, D18).
- **Fratricide in the ring** (§2.2 F3, D7).
- **The urban reading moves** if F2 or F11 buys a step (D10). It is stopped for the lead, never
  retuned silently, which is the 2026-09-15 spec's own rule.
- **The world overlay** (§7.4): kept out of the MVP entirely.
- **Scope creep from a persistent group.** The group table is new long-lived state, the first since
  patrols. Every exit path (death, rout, board, garrison, tunnel, a new order, a dead row) is a
  test, and §4.3 lists them.
- **The `stepSweep` re-stack survives** (§5). A pressed Attack that hunts after contact heaps as
  today.
- **Two command fields, one more source of confusion.** `exact` and `formation` are mutually
  exclusive, `exact` wins, and a test pins it.

**Rejected:**
- **The app splits the order** (the 2026-09-15 spec's B). Rejected for the same reasons: it is a
  fourth copy of the masks, scripts could not use it, and the replays bloat.
- **Moving slots that track a leader** (§4.4).
- **A formation per unit type in engine code.** It is the opposite of data-driven content.
- **Per-unit A\*** for staying in shape. CLAUDE.md forbids it.

---

## 10. Build phases

- **P0, design and mock.** This document and the lead's decisions. Then a static HUD mock of the
  formation row, the inert states, the tooltip schematics and the card lines, published for the
  lead before any HUD code.
- **P1a, shapes (sim + app).** The schema and the three MVP files, `formationClassOf` and the four
  overrides, the `formation` field (sim, net `cleanCommand` and `validateCommand`, advisor),
  `assignTemplate` with the `files`, `rank`, `ring` and `point` generators, cover preference for the
  ring, arrival facing and stance, the group table with membership and exits only, and the ambush
  `spring` drill. Then the formation row, keys, tooltip schematic, card lines and i18n. Measured:
  §8.1, 8.2, 8.3 (urban in F2, the ambush probe), 8.7, 8.8.
- **P1b, march and calls.** Route checkpoints, pace, dress, the final-checkpoint reservation, the
  `halt` and `press` drills, contact hooks, aircraft and medic calls, and the events, alerts and
  card lines. Measured: §8.3 (all arms), 8.4, 8.5, 8.6, 8.9.
- **P2, the catalogue.** F4 to F11 (`vee`, `echelon`, the `bound` drill, herringbone, coil,
  clearance), manual calls (`formationCall`), and then, only behind approved mocks, the ground
  ghost and the right-drag facing.
- **P3, the enemy.** `formation` on mission waves, `commit`, `reinforce` and patrols, AI use, the
  Sarim seat's doctrine flavour, eight-way diagonal templates if D17 asks for them, and the
  report-only bands promoted to gates.

Each phase is its own PR, with the pins it moves named and re-pinned in the same commit with the
reason. P1a moves only the new `FORMATION_WORLD_PIN`, because of item 1.

---

## 11. Decisions for the lead

Each one gives the recommendation first.

1. **How a formation is picked.** *Recommend:* an **armed one-shot verb**: click or key, then click
   the map, as Patrol and Move work now. *Alternative:* a sticky setting on the selection or
   control group that every later right-click uses. That is closer to Total War, but invisible
   after the moment it was set, and it needs a stored per-group setting in the app.
2. **Command shape.** *Recommend:* an optional `formation` id on `move`/`attackMove`, a string
   like `build.unit`. *Alternative:* a new `formationMove` kind, which duplicates `applyMove`'s
   rules.
3. **Persistence.** *Recommend:* a **persistent formation group** (march, pace, calls, springing
   together), built in two steps (P1a shapes, P1b march and calls). *Alternative:* destination
   shape only. That is cheap and nearly pin-free, but a column is a column only at the end, and
   "waiting for a call" has nothing to wait on.
4. **Pace.** *Recommend:* every ground member moves at the **slowest ground member's** speed,
   re-read at each checkpoint, held through contact in Attack, and named on the card.
   *(Amended 31 Oct 2026, GH-859 P1c: the Attack no longer paces; Column and Ambush do.)* This is the
   separation spec's Q3 (Option E), answered "yes" for formation orders only. Orders without a
   formation keep their own speeds.
5. **Holding the shape en route.** *Recommend:* **checkpoints every 8 tiles with a 3 s dress.**
   *Alternative:* no dress (pace only), which is cheaper but loses the shape at every obstacle.
6. **What "the call" is.** *Recommend:* **the troops' own contact and casualties, automatically.**
   Gunships strike, drones spot, transports and loitering munitions never go by themselves, and
   10 s of quiet brings them back. Halt or any order overrides. *Alternative:* calls only from the
   player (P2's manual call). It is safer for aircraft, but it is not what "waiting for a call"
   reads as.
7. **Ambush shape.** *Recommend:* **the full ring you asked for**, with cover preference, measured
   for friendly splash (§8.3). If friendly damage exceeds 10% of the ambush's own damage dealt, P2
   adds U- and L-shaped variants and the ring stays as "encircle". *Alternative:* ship the L-shape
   (doctrine's safer default) first.
8. **Ambush fire discipline.** *Recommend:* **the ring springs together**: the first member to see
   the enemy in the kill zone, or to be fired on, opens fire for all. *Alternative:* each member
   springs alone, as `setStance{ambush}` does today.
9. **Move-column contact drill.** *Recommend:* **halt, face the contact, return fire, alert, no
   automatic resume.** The player re-issues. *Alternative:* resume the march after 10 s of quiet.
10. **What a formation may buy at §5.7.** *Recommend:* **nothing.** Urban in Attack and in
    Clearance must stay in the existing band with 2:1 at least 15 pp below 3:1. A formation that
    lifts 2:1 into the 3:1 band stops the work for you, as smoke's one step was ruled. *Alternative:*
    allow one step for Clearance only (it is the doctrinally correct way into a town), pinned the
    way the smoke case is.
11. **Versus.** *Recommend:* the MVP three for **both seats and both factions**, gated by the
    offered-cell bar (§8.7b), with the formation seat's edge over a no-formation seat reported and
    capped at 65%. Faction flavour (Ashwar ambushes, Rif raids) is P3.
12. **Preview.** *Recommend:* **the tooltip schematic only in the MVP**. The ground ghost and the
    right-drag facing come in P2, only after you approve a mock.
13. **Keys.** *Recommend:* **R** column, **T** attack, **Y** ambush (free, adjacent, rebindable). P2
    formations get buttons only.
14. **Arrival facing for vehicles.** *Recommend:* **yes**: vehicles turn their front to the
    formation's front (outward for coil and herringbone, inward for the ring). It is combat
    geometry (armour arcs), so it is measured, and you see the reading before it is gated.
15. **Small doctrine additions to your three.** *Recommend:* (a) a recon unit, if any, takes a
    **point** slot 3 tiles ahead of the column (advance guard); (b) your Attack stays armour-first,
    and **Clearance (F11, infantry first)** is offered separately for towns, with a HUD hint in
    built-up ground. *Alternative:* Attack flips to infantry-first automatically in town (which is
    hidden behaviour, so not recommended).
16. **Enemy formations.** *Recommend:* **P3**, after the player side is measured. Enemy columns in
    F1 are the natural target for the Ashwar ambush doctrine, and they will move scripted plans.
17. **Diagonal approaches.** *Recommend:* keep the axis-quantised frame (today's rule) in the MVP,
    with authored diagonal templates as data in P3 if the blocky turn reads badly.
18. **Medics under fire.** *Recommend:* **answer at once**, and measure medic losses (§8.4).
    *Alternative:* wait until the wounded has crawled to cover (Model A's crawl) or until the
    medic's own path is not pinned.
19. **Formations as upgrades.** *Recommend:* **no** for the MVP three (they are basic command
    verbs). P2 formations could be brigade unlocks (for example bounding overwatch after a mission
    that teaches it), a separate design if you want it.

---

## 12. Downstream checklist (for `writing-plans`)

- `sim-guard` reviews every sim task: invariants, hash fold, snapshot classes.
- Briefs carry the house rules: no pkill/killall, never touch 5177, no local `ui:routes`,
  `golden-baseline` or `ui:shots`, music off, `git commit -- <paths>`, refs written as GH-NNN.
- The HUD mock goes to the lead before HUD code. The world-ghost mock goes to the lead before any
  renderer code.
- Every new gate's falsification goes in its commit message.
