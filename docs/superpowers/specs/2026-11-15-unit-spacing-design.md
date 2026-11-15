# Starting formation and minimum unit spacing (GH-1360) — design

**Date:** 2026-11-15 · **Status:** PROPOSED, for the lead. Design only: nothing under `packages/` changes on
this branch. **Base:** `main` `fc6d72c7c`. **Sheet:** `2026-11-15-unit-spacing-sheet.png` (beside this file).
**Builds on:** GH-421 vehicle separation (`2026-10-23-vehicle-separation-design.md`, PRs 663, 789, 809, and
GH-798 for the ranks), GH-859 formations (`2026-10-28-combat-formations-design.md`, `data/formations/`).

The lead, 15 Nov: *"the default formation at the start of a game. Currently, the default formation is that
all units are at one clutter. This doesn't look professional; it doesn't look good. It still looks like any
unit can run on top of another unit, which is not what I asked. The units should keep a minimum distance
from one another."*

**Short answer.**

1. **Start.** Every starting force is laid out by the real GH-859 template engine (`assignTemplate`) in a new
   `assembly` shape. Vehicles form the front rank, infantry the second, support weapons, medics and drones the
   third. Each class has its own spacing. The force faces a front the mission names, and is laid out on each
   unit's own mask, so a wheeled unit never lands on a boulder. Across 36 starts (30 missions and 6 versus ends) the
   sheet's census goes from **99 overlapping body pairs to 0**. Bodies move a mean of 3.3 tiles in a mission
   (at most 10.1), because the force is re-ordered into class rows.
2. **Always.** Foot units join GH-421's never-push machinery as circles: a mover may not deepen an overlap;
   it follows, steers or stops at contact, and a 1 s valve guarantees nothing deadlocks. A free-spot pick
   covers every place a unit *appears* (camp exit, unload, leaving a building, a tunnel vent, a reinforcement).
   No stationary unit is ever pushed, which is the property that kept GH-421's holds, zones and cover safe.
3. **Price.** It moves `pnpm playtest`, `pnpm balance`, `versus:probe` and some pins. Each is reported as a
   before/after table on GH-1360 under the balance park's rules: plan fixes only, never `tuning.ts` (§6).

---

## 1. The defect, measured

### 1.1 At the start (this design's census, bodies not centres)

Scratch exporter (not committed; S0 lands it as a tool): the real `MissionRuntime.start()` through
`tools/src/mission-harness.ts` and the real `versusSpawns`, seed 424242, `upgrades_to` unresolved, fresh roster.
"Overlap" uses the same bodies as the sheet. A vehicle is its GH-421 capsule from `mobility.footprint`. A foot
team is the proposed circle (§3.1). A pair counts when it interpenetrates by more than 0.02 tile, the GH-421
probe's threshold.

| starts | bodies | overlapping pairs today (foot-foot / foot-vehicle / vehicle-vehicle) | proposed |
|---|---|---|---|
| 30 shipped missions (side 0) | 292 | 72 (15 / 28 / 29), in 22 of 30 missions; worst depth 1.19 tile | **0** |
| versus `beit_sahwan_outskirts`, KDF and Sarim ends | 41 | 2 (0 / 0 / 2): the D9 and Lavi, the Lavi and jeep | **0** |
| versus `tel_marum`, both faction orders, both ends | 82 | 27 (11 / 6 / 10); the Sarim end has **5 `atgm_cell` and 3 `gun_truck` on single points** | **0** |
| **total** | **415** | **99** (26 / 34 / 39) | **0** |

The clump has three causes, each visible on the sheet:

- **Placements are authored a tile apart, and each one spreads its `count` 1.25 tiles east, then south**
  (`spawnPlacement`, `SPREAD`). Vehicle hulls are 1.5–2.8 tiles long, so a row of an Eitan, an Eitan and a
  Lavi at x = 25, 26.25, 26 (Qarn Hadid II) is one solid block. **No starting placement faces anywhere.**
  `starting_force` has no `facing_deg`, so every body faces east (angle 0) whatever the front.
- **`placeOnOpen` (`packages/app/src/sandbox-place.ts`), the versus and free-play placer, spirals to the
  nearest open tile with no occupancy test,** so offsets that fall in rock all land on the same tile. That
  produces Tel Marum's stacks of five and three. It also tests `sim.blocked` only, never the vehicle mask.
  The cloud census found **13 free-play vehicles on vehicle-blocked tiles**; on the two maps it inspected, every
  one was a boulder tile. `assertGroundClear` has the
  same blind spot for mission spawns: it checks `blocked`, never `blockedVehicle`.
- **Nothing reads facing or class at spawn.** The free-play and versus tables are offsets that were drawn
  by hand for one map and then translated onto every other.

### 1.2 In play (the cloud census, GH-1360 comment of 15 Nov 05:16)

`pnpm playtest`'s sensible plan per mission, 29 missions, 2.16 M ground unit-ticks, same-side centres:

| measure | share of unit-ticks |
|---|---|
| foot with a same-side foot neighbour under 0.3 tile | **13.0%** (worst: Wadi Halam IV 30.3%, Deir Amun III 30.1%) |
| vehicle with a same-side vehicle neighbour under 0.3 tile | 0.7% (Qarn Hadid III 10.7%) |
| either class with a neighbour of the other class under 0.3 tile | 0.2% |
| any same-side neighbour under 0.3 tile | 10.4% |

So **the in-play defect is foot on foot**, which GH-421 deliberately left alone (V-R1: "infantry stacking
stays a formation concern"). At 0.3 tile (0.9 m) two teams' figures are inside each other. Vehicle stacking
is now rare, though not zero, because GH-421 is live. The census also reports 20 foot bodies whose start tile
is blocked. **Checked:** the 8 missions' enemy garrison-stance bodies number exactly 5, 3, 3, 2, 2, 2, 2 and 1,
the census's per-mission counts. They are the bodies `assertGroundClear` exempts on purpose (a squad posted
at a door walks in on the first ticks), not a defect.

**Per-tick cost.** The cloud cost probe had not reported when this was written. Its number goes in §4,
in the row marked **[cloud]**.

---

## 2. What exists today, and what this design keeps

- **Never push** (GH-421 Stage 2, `stepMovement`, `sepBlockedBy`, `sepAtContact`). A participating mover's
  step that deepens an overlap is refused. A step that reduces one is always allowed, so units that start
  inside each other part as soon as either moves. The mover's options are to **follow** a same-way mover
  ahead (a partial step, five halvings), to **steer** 45° then 90° away from a stationary, oncoming or
  converging unit (on its own mask, with the corner rule), or, if its goal is held, to **stop at contact**
  (B+). A range goal (demolish, focus, garrison, board, charge) is exempt from stopping. A **valve** lets a
  unit genuinely blocked for 1 s (`SEP_VALVE_TICKS` 40, +2 a standing tick) take its step anyway. The two
  per-unit columns, `sepWait` and `sepLast`, are already folded into `hash()` unconditionally. Participants
  declare `mobility.footprint`, and `sepLive` turns on with the first such type, so worlds made of footprint-less
  fixtures are byte-identical.
- **Spacing at order time.** `assignFormation` (`formation.ts`) seats a plain group order with vehicles 2
  apart sideways and 3 between ranks (`VEHICLE_RANK_DEPTH`), and infantry one per tile in ranks
  `VEHICLE_TO_INFANTRY_GAP` (1) behind the last vehicle rank. The GH-859 templates (`assignTemplate`) seat
  formation orders.
- **Flow fields only.** One field per goal and domain, cached. Nothing here stamps units into a field.

---

## 3. The design

### 3.1 Minimum spacing per class pair

| pair | minimum centre-to-body distance | body | mechanism |
|---|---|---|---|
| vehicle-vehicle | the GH-421 capsules, **unchanged** | `mobility.footprint` capsule, measured from the GLB | GH-421, unchanged |
| foot-foot | r_i + r_j, **0.50 to 0.90 tile** (rifle team to rifle team 0.90 = 2.7 m) | circle, r per type (below) | GH-421 rules, circle fast path |
| foot-vehicle | r_foot + the hull capsule's radius, measured to the hull's segment (a rifle team stays ≥ 0.45 tile from the hull's axis-capsule surface + its own radius) | circle vs capsule | GH-421 rules |
| aircraft-anything | none | no body (as GH-421) | — |

**The foot radius is data, not a constant.** Each foot type declares `mobility.footprint` with
`half_length_tiles == half_width_tiles == r`, which is a circle (`hullCapsule` already reduces to a point
segment when the half-length is not above the half-width). r is the type's measured idle half-diagonal
(`tools/src/perf/unit-footprints.ts`, this tree), rounded up to 0.05 and clamped to **[0.25, 0.45]**:

| r | types |
|---|---|
| 0.25 | `civilians` (one figure an entity, 0.151), `ugv_recon_dog` |
| 0.30 | `breach_team` |
| 0.35 | `manpad_team`, `charge_squad`, `digger_crew` |
| 0.40 | `rpg_team`, `demo_squad`, `militia_cell`, `recoilless_team`, `wounded_kdf`, `wounded_sarim` |
| 0.45 | `inf_medic_squad`, `at_team`, `atgm_cell`, `recon_zikit`, `mortar_team`, `yahalom_squad`, `sniper_team`, `mortar_crew`, `inf_squad`, `inf_grenadier`, `sarim_rifles`, `at_nlos_team`, `moto_rpg` (a circle now; GH-421's name exemption V-R4 retires) |

**Why the ceiling is 0.45, not the measured 0.55–0.62 of a rifle squad.** Every order generator already hands
out infantry slots one tile apart: `assignFormation` (`INFANTRY_SPACING` 1), the Attack's infantry rank
(`spacing` 1), and the Column's files. A foot radius above 0.5 would put every neighbouring slot inside
contact. Stop-at-contact would then end each leg short of its slot, and the formation would never dress.
0.45 leaves 0.1 tile of slack under the slot pitch for the arrival rounding. The figures' measured envelope,
the dotted ring on the sheet, is a bounding circle around three men in a wedge, so two rings touching at 0.9
does not mean two men touching. Q16.16: 0.25, 0.30, 0.35, 0.40 and 0.45 are 16384, 19661, 22938, 26214 and
29491, converted at load by `fx.from` exactly as vehicle footprints are today.

**Every generator against these distances** (consequences in §3.3):

| generator | smallest pitch it hands out | clears foot r ≤ 0.45? | clears foot vs hull? |
|---|---|---|---|
| `assignFormation` infantry | 1 tile | yes | **no**: the first infantry rank is 1 tile behind the last vehicle rank, and a Namer needs 1.22 + 0.45 = 1.67 → `VEHICLE_TO_INFANTRY_GAP` 1 → 2 (S5b) |
| Attack / Column templates | infantry 1, element `gap` ≥ 1 (2 tiles) | yes | yes (a Tzav, the longest hull, needs 1.42 + 0.45 = 1.87 ≤ 2) |
| Ambush ring | ring tiles 1 apart, hulls and foot mixed | yes, foot-foot | **no** for a hull beside a team. Today's vehicles already stop at contact there (GH-421); it stays the one generator that hands out sub-contact slots (open question, §8) |
| `overflowPlace`, `exact`, sweep onto a last-seen point, a rally point, the camp exit | a single point | no | no. B+ stops arrivals at contact, and §3.4's free spot handles units appearing |

### 3.2 The starting layout

**Shape.** A new file `data/layouts/assembly.json`, written in `formation.schema.json`'s vocabulary and
compiled by the existing `compileFormation`. **It is not in `data/formations/`**: everything there is
registered with `addFormationType` and listed in the HUD picker (`ui/formation-model.ts`), so a fourth file
would become an orderable formation. A layout is never registered with the sim, never calls `fmJoin` and
never sets `fmLive`, so no formation column folds into `hash()`.

Abridged: the compiled file also carries `label`, `blurb`, `factions`, `march` (`legs: false`, `pace: none`)
and `contact` (`drill: none`), which `compileFormation` requires and the layout never reads.

```json
{ "id": "assembly", "verb": "move", "min_members": 2,
  "elements": [
    { "classes": ["armour", "light_vehicle", "recon"], "shape": { "kind": "rank", "spacing": 3, "max_lateral": 6, "rank_depth": 3 } },
    { "classes": ["infantry"], "shape": { "kind": "rank", "spacing": 2, "max_lateral": 8, "rank_depth": 2 }, "gap": 1 },
    { "classes": ["support_weapon", "medic", "aircraft"], "shape": { "kind": "rank", "spacing": 2, "max_lateral": 8, "rank_depth": 2 }, "gap": 1 }
  ], "arrival": { "face": "front", "stance": "none" } }
```

- Vehicles stand 3 apart sideways (the widest hull pair, 0.73 + 0.71, leaves 1.5 tiles of clear ground) and
  3 between ranks (GH-798's rank depth). They take five to a rank, tanks and IFVs in the centre.
- Infantry stand 2 apart (6 m: two teams read as two teams, not as a blob), nine to a rank, 2 tiles behind
  the vehicles.
- Support weapons, medics and drones form one rear rank. A first draft gave each its own rank, which was 11
  tiles deep and pushed edge starts 8 tiles toward the enemy. This version is 4–7 deep.
- It is the Attack formation's reading order (armour, then vehicles, then infantry, then support), so the
  lead sees the same grammar at the start as on the HUD card.

**Front.**

1. **An authored `start_front`** on the mission (`"N" | "E" | "S" | "W"`), new and optional in the schema.
2. **Otherwise derived, in this order:**
   - the centroid of side 1's start placements, excluding buried bodies;
   - failing that, the centroids of the primary objectives' zones;
   - failing that, the map centre.

   Each is taken from the assembly anchor and quantised to an axis the way `assignTemplate` does (|dx| ≥ |dy|
   → x, ties to x). The three derivations disagree on 6 of 30 missions (`beit_sahwan_1_recon`,
   `beit_sahwan_breach`, `ein_qasab_1_recon`, `tel_marum_1_recon`, `wadi_halam_5_depot`, and the tutorial,
   which has no enemy). The enemy centroid is the only one that never points at a muster or refuge zone
   behind the start.
3. **Recommended:** S3b authors `start_front` on all 30 shipped missions, using the derived value as the
   proposal and having `mission-author` review the six. The fallback chain stays for free-play maps, versus
   (where the front is the other end's anchor, as `hostileFacing` already does) and for fixtures.

Every body faces the front axis (an eighth-turn: 0, 90, 180 or 270°). The layout writes **positions and
facings only**. Spawn order, and with it entity ids and every per-entity RNG stream, is unchanged.

**Anchor.**

- Placements are grouped into assemblies by single-link distance: authored `at`s within 6 tiles of each
  other belong to one. The tutorial's two bodies, 27.5 apart, stay two. **A one-body assembly keeps its
  authored position** (de-overlapped by the free spot) and only turns to the front: `compileFormation` refuses
  `min_members` below 2, and a lone unit has no rows to stand in. Measured: every other start is one assembly.
- Each assembly is laid out at its own anchor.
- The anchor is the bodies' authored centroid, **summed in Fx and floored once** (the P1c lesson: a floored
  sum of floored tiles is chiral), then moved forward by half the layout's depth so that the formation is
  centred on where the author put the force.
- The depth comes from `templateOffsets`, which needs no ground.
- If the rear row would be under 1 tile from the map edge, the anchor slides inward until it is not. Most
  starts sit 2–5 tiles from an edge (y ≈ 44 of 48), so this is the normal case, not an edge case.
- The anchor then snaps to open ground per domain, as a click does.

**How far bodies move.** The layout keeps the force where the author put it (the centroid moves 0.5–1.5 tiles
on the sheet's four rows, at most 3.6 over all 36 starts), but it re-orders the force into class rows, so
individual bodies travel further. That is the number `pnpm playtest` will feel:

| starts | mean body move | largest body move |
|---|---|---|
| 30 missions | 3.3 tiles (per-mission means 1.8–5.0) | 10.1 (`deir_amun_3_subterranean`) |
| 6 versus ends | 3.9–7.9 | 16.5 (`tel_marum` Sarim end, a 26-body line re-folded into a 9-wide block) |

A **matched seating** refinement was prototyped. Within each element and domain, bodies take the slots in the
order of their authored lateral position (GH-798's trick for plain orders). It cut the mission mean to 2.6 and
the maximum to 9.2, but it left one overlapping pair in `umm_zeitoun_1_recon` and lengthened one versus
end's moves to 18.0. It is not in the recommendation; S3a can add it if the lead wants smaller moves (D13).

**When there is no room.** `assignTemplate` already walks each domain's own mask (`blocked` for foot,
`blockedVehicle` for wheeled, which includes boulders) and only takes slots reachable from the anchor. A
member it cannot seat comes back in `overflow`, and the chain continues:

1. **The free spot** (§3.4) from the anchor outward, on the member's own mask, clear of every body already
   placed. The free spot was not prototyped. In the scratch run, 2 bodies of 415 (the drone and medic of
   `umm_zeitoun_1_recon`) overflowed, and `assignTemplate`'s own overflow seat put both clear of everyone. S2
   and S3a are where the free spot's share is measured.
2. **The member's authored position.** This is today's behaviour, and only reached if no spot exists within
   12 tiles. For a start-time placement it is an authoring error. `tools/src/start_layout.test.ts` walks every
   shipped mission and fails on any body that reaches this step, on any overlapping pair, on any body off
   its own mask, and on any body that moves more than 11 tiles (the measured 10.1 plus one: a ratchet that a
   layout change which scatters the force fails).

**Upgrades and the ledger.** The layout runs inside `start()` **after** `resolveUpgrades` and the ledger draw,
because both change counts and classes. A sparse roster lays out fewer bodies; it does not leave holes.

**Opt-in by data, enforced for shipped content.**

- `start_layout: "assembly" | "authored"` is a new mission field. `"authored"` keeps every `at` and runs only
  the free-spot de-overlap.
- The runtime treats an absent field as today's spread, so the sim's fixture missions, and the pins built on
  them, do not move.
- `validate:data` refuses a shipped mission without the field. All 30 get `"assembly"` in S3b, except any
  the lead names. The likely candidate is `beit_sahwan_breach`, whose 9 placements stand 2+ tiles apart
  around a compound in the map's middle.

**Versus and free play.** The KDF and Sarim tables in `sandbox-force.ts` and `versus-force.ts` keep their
*membership* and order, so entity ids and the mesh roster do not change. They lose their offsets as the
source of positions: both callers pass the force through the same pure layout function from `@lions/sim`,
anchored on the end's anchor and fronted at the other end. `placeOnOpen` remains only for the opposition
and civilians in free play, fixed as S1 describes.

**Enemy and civilian placements.** These get no assembly, because authored garrisons and ambush lines are
content. Body k of a count-N placement still *asks* for today's `SPREAD` offset, and the free spot answers
from there, so the bodies of one placement, and of neighbouring placements, never stand inside each other.
Garrison-stance and buried placements stay exempt, as they are from `assertGroundClear`. The free spot runs
only in a mission that declares `start_layout`, so the sim's fixture missions keep `SPREAD` byte for byte. A
type with no footprint has a clearance of 0, so its requested point is always taken.

### 3.3 Minimum spacing at all times

**Mechanism: GH-421's rules, extended to foot, with no second mechanism.** Foot types declare a footprint
(§3.1), and from then on they are participants. The rules do not change: no push, deepen-refused,
reduce-allowed, follow, steer, stop at contact, valve. No new hashed state is needed, because `sepWait` and
`sepLast` already exist for every entity and are already hashed. Four refinements are required, each found
by reading the GH-421 code against foot crowds:

1. **A circle fast path.** For two circles, compare squared distances (`fx.mul` only): the step is blocked
   when d²_new < (r_i + r_j)² and d²_new < d²_old. There is no `fx.sqrt` and no `fx.div`. For a circle
   against a capsule, take one closest point on the segment (one `fx.div`), then make the same squared
   compare. The steering side needs only the sign of a cross product, never a unit normal. GH-421's own note
   says the pair test, not the cell walk, is what costs, so this is where foot must be cheaper.
2. **A held formation member is stationary.** `sepMoves(j)` reads `moving[j] === 1`, but `fmMarchHold` holds
   a member at an unreleased checkpoint *with `moving` 1*. Others would therefore try to follow a member who
   is not going anywhere, and would read it one step ahead along its facing. Add `fmDuty[j] !== FM_DUTY_WAIT`
   to `sepMoves`. A dressed checkpoint line is then something to steer round. It changes nothing in a world
   without a formation order. **It does change today's vehicles inside a formation order,** which already
   participate, so it ships in S5a-2 with its own before/after table, not as a neutral refactor.
3. **Pair exemptions,** checked at the top of the narrow phase:
   - a boarder and the carrier it is boarding (`boardGoal[i] === j`, and the reverse). Otherwise a team
     reaching a Namer from behind contacts it at 1.22 + 0.45 = 1.67 tiles, outside `LOAD_RANGE` (1.5), and
     boards only through the valve;
   - a medic and the casualty it is treating or carrying (`MEDIC_TREAT_REACH` 2 tiles is outside contact
     anyway, but the carry pick-up is not);
   - a rider for the tick it unloads.
4. **At a held goal, B+ runs before the valve.** Today a unit whose valve opened while it queued will ghost
   into a goal another unit holds, and end at rest inside it. Move the `sepAtContact` test ahead of the
   `wait >= SEP_VALVE_TICKS` branch when the step is the final leg. Like item 2, this changes today's vehicle
   behaviour, so it ships in S5a-2 with a before/after table.

**Who is not a participant:**

- **No body:** aircraft.
- **Carried, garrisoned or below ground** (`sepParticipates`, unchanged). A garrison is a building's, and a
  tunnel's occupants are underground.
- **Bodies that never take a step in `stepMovement`:** a wounded man crawls only by `stepWounded`. He is still
  a **stationary body** that others steer round, and a medic is exempt from him (item 3 above).
- **Civilians** are participants with r 0.25: the `CivilianFlight` rule moves them through `stepMovement`,
  and they stop at contact inside the 4×4 refuge (16 tiles holds the 8–11 bodies a mission fields).

**Garrisons.**

- Units entering a building have a range goal (`garrisonGoal`), so they are never stopped at contact. They
  queue at the door by following, and the valve frees any that stall.
- Inside, they are not participants.
- **Leaving** a building puts them on the free spot round the exit (§3.4), not all on the exit point.

**Tunnels.** A buried body is not a participant. **Surfacing** at a vent takes the free spot round the vent
instead of the vent point itself.

**1-tile chokes (a gap must still pass).**

1. Spacing never tests terrain. The wall clip stays a test of the unit's centre against its own mask, so a
   body's radius cannot make a 1-tile gap narrower. A rifle team of r 0.45 fits a 1-tile gap exactly as it
   does today.
2. A column into a gap **follows**: single file at 0.9 tiles. Steering candidates must pass the corner rule,
   so in a gap they fail and the follower waits rather than climbing the wall.
3. Two units meeting **head-on** in the gap cannot steer. Both wait, and the valve opens after 1 s of standing
   (20 ticks at +2), so they pass through each other. That is the one place the lead will see a pass-through:
   rare, short and bounded. S0 counts it as "valve opens per 1,000 unit-ticks".
4. **Throughput.** A crowd funnelling into a gap now goes through one at a time, about 1.1 teams a second at
   0.9–1 tile/s, where today it flows through itself at any width. That is the realistic answer, and it
   slows a plan that pushes ten squads through a door. S0's choke probe measures time-to-clear today vs
   proposed for 12 teams through a 1-tile gap, and the valve opens. **Gate: every team through and no
   deadlock**, never a time bar.

**Crowd arrival at a goal.** A plain group order already gives every infantry member its own tile. Orders
that converge on one point (`exact`, a sweep's last-seen point, a rally point, two separate orders to one
tile) end **at contact**. B+ does this for foot as it does for vehicles, so arrivals form a ring around the
point instead of a stack. That is why the ring-not-stack picture costs nothing per tick at rest.

**Formations.**

- **Checkpoints and the dress.** Template slots are at least 1 tile apart for foot and 2 for foot behind a
  hull, so a member arriving at its own slot is not in contact. Members cross each other's paths inside the
  group on the way, and following or steering delays them. The 3 s dress clock (`dress_s`) absorbs that. The
  release counts arrivals and does not care how a member got there.
- **The pace** (`fgPace`) is unchanged. Stopping or steering only makes a member slower than the pace, never
  faster.
- **Rest facing** (`stepFormationFacing`) is unchanged.
- The **Ambush ring** is the exception noted in §3.1.

**What stays possible, said plainly.** "Always", in the lead's word, means *no mover ever deepens an overlap
and no unit appears inside another*. Two things can still leave a pair overlapping:

- a valve pass-through that ends at rest. This is rare; S0 counts it;
- two stationary units that started overlapped in a fixture world.

A **rest dress**, in which a stationary unit with no order takes one small self-step out of an overlap, would
close both. It is the GH-421 push in another form: on 18 Oct a pushed Eitan left Umm Zeitoun II's crest line
(`packages/app/src/hold-outside.test.ts`) and units moved across tile boundaries that change cover. **It is
not in this design.** It is decision D7, with "no" recommended until S0's in-play census, re-run after S5c,
says how much is left.

### 3.4 The free spot: one deterministic placement helper

`freeSpotNear(x, y, typeIdx, side, reach)` is a pure method on `Sim`, used by every place a unit appears:

- the starting layout's overflow;
- the enemy and civilian spread;
- production at a camp exit (today every build spawns on `structureExit` and stacks until it moves);
- unloading;
- leaving a building;
- surfacing at a vent;
- a `reinforce` trigger;
- a wave.

**How it searches.** Candidates are tested in a fixed order: the requested point, then rings on a 0.5-tile
lattice outward, each ring visited clockwise from north. A candidate is taken when:

- its tile is open on the unit's own mask;
- it is reachable (same component as the requested point; the walk is cached per call);
- its body clears every living participant within reach by the pair distance.

The first candidate that passes wins. Reach is 6 tiles for a soft (mid-mission) spawn and 12 for a start.
**With no candidate, the requested point is used: today's behaviour, never a refusal, never a throw** for a
soft spawn.

Integer and Q16.16 throughout, no RNG, and visit order is fixed. Its cost is O(candidates × neighbours) per
spawn event, and nothing per tick.

### 3.5 Invariants

| invariant | how this design keeps it |
|---|---|
| 1. 20 Hz | No frame-time input. Everything is in `stepMovement` or at spawn. |
| 2. Q16.16 | Radii are converted by `fx.from` at load. The fast path uses `fx.mul` only. Lattice offsets are multiples of `HALF`. The layout runs on integer tiles. No `Math.*`. |
| 3. Per-entity RNG | No RNG at all. The layout keeps spawn order, so ids and streams are unchanged. |
| 4. One-way data | The app's versus and free-play callers pass tables into a pure sim function. Nothing outside the sim writes positions. |
| Flow fields only | Unchanged. No unit is stamped into a field, there is no per-unit A*, and `freeSpotNear`'s reachability is a bounded BFS at spawn time only, never a path. |

---

## 4. Cost per tick at 400 units

**Where it lands:** `stepMovement`, per moving participant, times the neighbours in its visit.

**Grids.**

- The existing vehicle grid stays: 4-tile cells, 3×3 visit.
- Foot gets a second grid of **2-tile cells**, built in the same O(count) pass. One dense 4-tile cell of
  infantry at one per tile would put 16 candidates in every cell of a 3×3 visit.
- A foot mover visits:
  - the foot grid 3×3, for a foot-foot reach of 0.45 + 0.45 + `HALF` = 1.4 ≤ 2;
  - the vehicle grid 3×3, for a reach of 1.47 + 0.45 + 0.5 = 2.42 ≤ 4.
- A vehicle mover visits:
  - the vehicle grid 3×3, as today;
  - the foot grid 5×5, for a reach of 2.42 ≤ 4.
- `addUnitType` checks each type's reach against its visit, as it does today.

**Estimate.** The scene is 300 foot and 100 vehicles, all ordered at once to converge.

- **Base test.** Each foot mover makes one base `sepBlockedBy`, with about 20 candidates in a 6×6-tile visit
  at crowd density. Most are rejected by the integer box test (a few ns each). About 5 survive to the squared
  narrow phase (about 15 ns).
- **Blocked movers.** In a crowd, assume 30% are blocked. Each adds up to 5 follow halvings or 2 steer tests.
  - Base: 300 × (20 × 3 ns + 5 × 15 ns) ≈ 0.04 ms.
  - Blocked extra: 300 × 0.3 × 5 × 0.135 µs ≈ 0.06 ms.
- **Foot against hulls.** Assume the circle-capsule test costs a third of GH-421's capsule-capsule; this adds
  ≈ 0.3 ms.
- **The bottom-up estimate is +0.3 to +1.0 ms** on top of GH-421's cost: 0.6–2% of the 50 ms budget. The
  tick at 300 units is about 2 ms today (`docs/PERFORMANCE.md`), owned by detection and combat.
- **The anchored upper bound is worse, and is the honest number to plan against.** The one measured figure
  is PR 809's: +1.3 ms for 100 moving hulls (300 units, `qarn_hadid`), about 13 µs per mover, far above
  nanoseconds per test. 300 foot movers at that rate would be **+3.9 ms, above this design's own STOP bar**.
  The reasons to expect much less are the circle fast path (no `fx.sqrt`, no `fx.div`, against GH-421's
  closest-segment maths with both), the 2-tile foot grid, and the fact that most foot pairs fail the integer
  box test. Until S0 measures it, the bound stands.

| scene (400 units: 300 foot, 100 vehicles) | `stepMovement` today | proposed |
|---|---|---|
| all ordered to converge, `qarn_hadid` | **[cloud]** | **[cloud]** (estimate +0.3 to +1.0 ms; bound +3.9 ms) |
| idle (no movers) | ~0 | grid build only, O(count), < 0.02 ms |

**How it is measured.**

- `tools/src/perf/sim-scaling.ts` with `--checkpoints=300,400,600` gets a `--scene=converge` option: S0 adds
  the GH-421 stress scene, with foot added. It reports `stepMovement`'s share of the attribution, three runs,
  min and median.
- **Bar:** +2 ms at 400 is reported and accepted. Above +3 ms is a STOP, to be resolved by the grid or the
  narrow phase and never by thinning the rule.
- The cloud probe's number replaces the **[cloud]** cells when it lands on GH-1360.

---

## 5. Rendering

Nothing is needed for the layout or for spacing to be *correct*. Two presentation-only checks follow from it:

1. **The walk/idle flicker.** `resolveClip` (`packages/render/src/clip.ts`) picks `move` from the *measured*
   speed (rule 6), so a follower that alternates partial steps with standing ticks could flicker between walk
   and idle at 20 Hz. **Proposal:** a render-side hold. Keep `move` for 3 sim ticks after the measured speed
   reaches zero while the sim's `moving` is still 1. It is frame-clock, read-only, and leaves the sim alone.
   Ship it only if S0's census counts real flicker: speed-zero runs of 1–2 ticks inside a moving leg, per
   1,000 foot unit-ticks.
2. **Facing.** A 45° steer turns a team through `turnToward`. The steering side is read from geometry every
   tick and does not flip while the blocker stays on one side, so a pass is a sustained curve, not a jitter.
   S0 counts facing reversals over 30° within 3 ticks. Above 1 per 1,000 foot unit-ticks, the render's
   existing facing interpolation gets a short slerp. Otherwise nothing is done.

**Unchanged:** interpolation (steps never exceed the base step), selection rings (a ring is the figures'
extent, and two rifle-team rings at 0.9 overlap slightly, as they do at the 1-tile slot pitch today), and
the HUD formation schematic (the assembly layout is not orderable).

The golden visual `quiet`, `vehicle` and `kitted` scenarios photograph the free-play force, so S4 moves
them. Bless from CI numbers, after a look, never from the branch.

---

## 6. What moves, and how it is reported under the balance park

Pins at the worktree base `fc6d72c7c`:

- golden replays: flat 1258746094, relief 1483138559, orders 2559269335;
- `ECONOMY_PIN` 904873885 and `_RELIEF` 2771311510;
- `RUNTIME_DIGEST_PIN` 2037118941 and `_RELIEF` 1884258391;
- `WOUNDED_WORLD_PIN` 3748305113;
- `FORMATION_WORLD_PIN` 1398138626;
- `LADDER_CREDITS` 6955, `ROSTER_MAX` 30.

The sim package's pinned worlds use fixture types and missions **with no footprint and no `start_layout`**,
so the opt-in-by-data rule keeps them still unless a slice changes shared code.

The golden flat, relief and orders worlds declare no footprint, so they **cannot see any separation change**
and prove nothing about one. The neutrality proof for separation code is `vehicle-overlap:probe` and
`pnpm playtest` byte-identical, because both run shipped vehicles that already participate.

| what | S1 placer | S3 layout | S4 versus and free play | S5a-1 neutral sim | S5a-2 two rule changes | S5b infantry gap | S5c foot footprints on | S6 free spot |
|---|---|---|---|---|---|---|---|---|
| golden flat / relief | — | — | — | — (blind) | — (blind) | — | — (fixtures declare none) | — |
| golden orders | — | — | — | — (blind) | — (blind) | **moves** if it issues mixed group orders (re-pin, say why) | — | — |
| economy / runtime-digest | — | — (no `start_layout` in the fixture) | — | — | — | re-read | re-read | — (no `start_layout`, so no free spot) |
| `WOUNDED_WORLD_PIN` (reads shipped unit JSON) | — | — | — | must not move | re-read | — | **moves** | re-read |
| `FORMATION_WORLD_PIN` | — | — | — | — | re-read (moves only if its vehicles declare footprints) | moves if its plain orders mix classes | re-read | — |
| `vehicle-overlap:probe` | — | — | — | **identical** (the proof) | **moves**: before/after table | — | report | — |
| `pnpm playtest` (30 seeds) | — | **moves** (positions) | — | **identical** (the proof) | moves (vehicles in formation orders and at held goals) | moves | **moves** | moves (camp builds) |
| `LADDER_CREDITS`, `ROSTER_MAX` | — | re-read | — | identical | re-read | re-read | re-read | re-read |
| `pnpm balance` (§5.7) | — | — (builds its own forces) | — | identical | re-read | — | **likely moves**: infantry now part in the urban fights | — |
| `pnpm versus:probe` (60/40, report-only) | moves (Tel Marum) | — | **moves** | — | re-read | — | moves | — |
| versus literals (`versus-force`, `match-world`, net arena) | moves | — | moves | — | re-read | — | moves | — |
| golden visual | expect none | — | **`quiet`, `vehicle`, `kitted` move** | — | — | — | — | — |

**Reporting rule, without reopening balance (lead, 13 Nov).** This is a correctness and presentation change,
so:

- **Every slice that moves a number posts a before/after table on GH-1360.** That covers playtest per plan
  (wins of 30, slowest win), `LADDER_CREDITS`, `ROSTER_MAX`, the balance rows, the versus cells and the
  census. The table is generated by the existing tools, run on the slice's head and its parent.
- **Fixes are plan fixes only.** This is the GH-421 pattern: each lost seed is root-caused against a run with
  the slice switched off, and each fix is its own commit in `tools/src/backtest/plans/`.
- **Nothing in `tuning.ts`'s combat constants, unit stats or mission difficulty changes.** A seed no plan fix
  closes is a STOP to the lead as a mission-design finding, never a re-tune.
- **`pnpm balance` rows are reported, not screened.** Its pass/fail stays a gate, and a row that fails is a
  STOP to the lead, not a tuning task.
- **Versus cells outside 60/40 are logged on the issue and not chased.** Fairness probes and seat-bias fixes
  are parked.
- A pin moves only in the commit that moves it, with the reason and the no-behaviour proof where the change
  is meant to be neutral.

---

## 7. Slices (1–2 h each), in order

Every gate arrives with its falsification run, red, in the commit message. That is the house rule; see
`docs/agent-notes/falsification-casebook.md`.

| # | slice | change | tests | falsification (each seen red, then put back) |
|---|---|---|---|---|
| **S0** | Instrument | `tools/src/backtest/spacing-census.ts` (report-only). It reports tick-0 and in-play overlap by **bodies** (capsules and circles, the sheet's geometry); class pairs; valve opens and stop-at-contact counts (`sepDiag`); speed-zero runs and facing reversals for §5; the choke probe (12 teams, 1-tile gap); and `sim-scaling --scene=converge`. It commits the sheet's exporter as a tool, and confirms the 20 blocked-tile foot bodies are garrison-stance exemptions. | Literal geometry: a stacked foot pair is counted; a pair 0.95 apart is not; a team touching a hull's flank is counted; a head-on pass in the gap is counted as a valve open. Pins the instrument, never the level. | (1) the circle radius read as 0; (2) capsule vs circle using the wrong endpoint; (3) foot-vehicle counted as foot-foot; (4) the 0.02 threshold blinded; (5) one unit dropped from the census. Each goes red. |
| **S1** | Placer fixes (app) | `placeOnOpen` tests the unit's own mask (`blockedVehicle` for a wheeled type) and refuses an occupied tile. `assertGroundClear` adds the vehicle mask for wheeled bodies. | Every versus cell and every free-play map: no two bodies on one tile, no wheeled body on its mask. | Revert the mask line → `beit_sahwan_4` goes red (5 vehicles on boulders). Revert the occupancy line → the `tel_marum` Sarim end goes red (5 on one tile). |
| **S2** | `freeSpotNear` (sim, pure) | §3.4 | Order of candidates, mask, reachability, clearance by pair distance, the fallback to the requested point; determinism (two runs, same bytes). | (1) The lattice ring order reversed → the order test goes red; (2) the vehicle mask swapped for foot → the boulder case goes red; (3) clearance using the radius not the sum → the stack case goes red. |
| **S3a** | Layout function (sim, pure) | `startLayout(force, masks, anchor rule, front)` over `assignTemplate`, plus `data/layouts/assembly.json` and its loader (validated against `formation.schema.json`, never registered). | A golden table of slots for 3 literal forces on open ground; the edge pull-back; overflow to the free spot; ids and order unchanged. | (1) The anchor not pulled back → the edge case goes red (rear off the map); (2) the front read from the wrong axis → the facing test goes red; (3) the centroid floored per body (the P1c bug) → the chirality test goes red (a mirrored force, mirrored slots). |
| **S3b** | Missions on | `start()` calls it after `resolveUpgrades` and the draw. Schema fields `start_layout` and `start_front`; `validate:data` requires `start_layout` on shipped missions; 30 missions authored. | `tools/src/start_layout.test.ts`: every shipped mission has 0 overlapping pairs, 0 bodies off their mask, 0 at the authored fallback, and no body moved more than 11 tiles. `pnpm playtest` re-read and reported. | (1) One mission's `start_layout` removed → validate goes red; (2) the layout skipped → the start test goes red with 72 pairs; (3) one body forced onto a boulder → the off-mask count goes red; (4) the anchor's half-depth shift doubled → the 11-tile move bound goes red. |
| **S4** | Versus and free play | `sandboxSpawns` and `versusSpawns` call `startLayout`. The tables keep membership and order. | Versus literals re-derived; free play: every map with 0 pairs; mesh roster unchanged. Bless `quiet`, `vehicle` and `kitted` **from CI**. | Swap the two ends' fronts → the facing test goes red; drop the order-preservation line → the id-order test goes red. |
| **S5a-1** | Sim, neutral | Circle fast path, foot grid, pair exemptions (a boarder and its carrier, a medic and its casualty, an unloading rider). With no foot participant yet, none of these pairs can occur. | 26 GH-421 specs plus new ones, each on a literal world with a test-only foot footprint: two circles, a circle and a capsule, a boarder vs its carrier. **Proof: `vehicle-overlap:probe` and `pnpm playtest` byte-identical.** | (1) The fast path's `<` made `<=`; (2) the deepen test dropped; (3) the boarder exemption keyed on the wrong id → each goes red. |
| **S5a-2** | Sim, two rule changes | The `sepMoves` WAIT clause (§3.3 item 2) and B+ before the valve at a held goal (item 4). Both change today's vehicles. | A held checkpoint is steered round, not followed; the valve at a held goal ends the leg at contact. Before/after table: `vehicle-overlap:probe`, `pnpm playtest`, `FORMATION_WORLD_PIN`. | (1) The WAIT clause inverted → the checkpoint spec goes red; (2) B+ left after the valve → the held-goal spec goes red. |
| **S5b** | Infantry gap | `VEHICLE_TO_INFANTRY_GAP` 1 → 2 (§3.1). | `formation.test.ts` and `formation_walk.test.ts` re-derived, not loosened; a new spec checks that every shipped hull clears r 0.45 at the first infantry rank. | Put back 1 → the clearance spec goes red on `ifv_namer`. |
| **S5c** | Foot footprints on | 25 foot types declare circles (§3.1). Schema text no longer says "vehicles only". A validate rule: every ground type declares a footprint unless named, and foot r ≤ `INFANTRY_SPACING` / 2; a test pins the r table to `unit-footprints.ts`'s measurement. | `separation.test.ts` foot cases on shipped types; S0's census before and after (the target: foot-foot under 0.3 tile from 13.0% to under 1%); the choke probe passes, with no deadlock. | (1) One foot type's footprint deleted → validate goes red; (2) an r of 0.55 → the slot-pitch rule goes red; (3) the measurement table edited → the pin goes red. |
| **S6** | Emergence | `freeSpotNear` at the camp exit, unload, leaving a building, vent surfacing, `reinforce` and waves. In a mission that declares `start_layout`, body k of an enemy or civilian count-N placement asks for its `SPREAD` offset and takes the free spot from there. | Ten builds from one camp with no rally: 0 overlapping pairs at rest; unloading a full Namer: 0; a five-man garrison leaving: 0; a vent with three surfacing: 0. | Point the exit back at `structureExit` → the camp spec goes red with 45 pairs. |
| **S7** | Render, conditional | The walk-hold and facing slerp from §5, only if S0's counts call for them. | Unit tests on `resolveClip`'s hold (pure). | Hold length 0 → the flicker spec goes red. |
| **S8** | Report and notes | The final before/after tables on GH-1360; `CLAUDE.md` and `docs/agent-notes/sim-and-orders.md` brought in line (V-R1's "infantry never" and the schema text retire). | — | — |

The order is load-bearing:

- S0 must exist before any change is measured.
- S1 is an independent bug fix and can land first.
- S2 is needed by S3 and S6.
- S5a-1 must prove itself byte-identical, and S5a-2's two rule changes must be measured on today's vehicles
  alone, before S5c turns foot on. A number that moves in S5c is then attributable to foot participation
  alone.
- S3 and S5 can run in parallel streams after S2. They meet only in `pnpm playtest`, so S5c re-reads it
  after S3b.

---

## 8. Lead decisions (each with a recommended default)

| # | decision | recommended default |
|---|---|---|
| **D1** | **Scope of the starting layout.** (a) Re-lay every starting force in the `assembly` shape (rows by class, facing the front), or (b) keep every authored `at` and only de-overlap. | **(a)**, as GH-1360 asks. Every shipped mission gets `start_layout: "assembly"`; a mission can opt out with `"authored"`. Candidate opt-out: `beit_sahwan_breach`. |
| **D2** | **The front.** Author `start_front` on all 30 missions, or derive it each load. | **Author it** (S3b), seeded from the enemy-centroid derivation; `mission-author` reviews the six missions where the derivations disagree. The derivation stays as the fallback for free play, versus and fixtures. |
| **D3** | **Foot radius.** Per type (measured, rounded up to 0.05, 0.25–0.45), or one value (0.45) for every foot type. | **Per type**: a civilian is one person and a rifle team is three. |
| **D4** | **Extra clearance between infantry and a vehicle.** None, or +0.25 tile on that pair. | **None.** Bodies are measured, and a pad would stop teams short of the 2-tile rank behind a hull (1.87 + 0.25 > 2). |
| **D5** | **Stop-at-contact (B+) for foot.** Keep GH-421's rule, or let a foot unit wait and ghost instead. | **Keep it.** Without B+, GH-421 measured no fix for converging orders. It is also what costs playtest seeds, and those get plan fixes (§6). |
| **D6** | **The free spot where units appear** (camp exit, unload, leaving a building, vent, reinforcements, waves). | **Yes** (S6). It is the only way a unit appearing does not start inside another, and it pushes no one. |
| **D7** | **A rest dress for idle overlapped units.** | **No**, until S0's census after S5c measures what is left. It is a push by another name, and the Umm Zeitoun II crest line is what it broke last time. |
| **D8** | **The valve for foot.** Keep 1 s, or lengthen it for foot. | **Keep 1 s**, and report valve opens per 1,000 unit-ticks. A longer valve trades rare pass-throughs for visible jams at doors. |
| **D9** | **Enemy and civilian placements.** De-overlap the count-N spread with the free spot, or leave them alone. | **De-overlap** (no assembly): garrison and ambush lines are content. |
| **D10** | **`VEHICLE_TO_INFANTRY_GAP` 1 → 2.** Required for foot to clear a hull in a plain group order; it makes every mixed group one row deeper. | **Yes** (S5b). |
| **D11** | **Offer the assembly shape as a fourth orderable formation?** | **No.** It lives in `data/layouts/`, never in the HUD picker. |
| **D12** | **How moved numbers are reported under the park.** | Before/after tables on GH-1360, plan fixes only, no `tuning.ts`; a seed no plan fix closes, or a balance row that fails, is a STOP to the lead; versus cells outside 60/40 are logged and not chased (§6). |
| **D13** | **Matched seating** (bodies take their element's slots in order of their authored lateral position). | **Not now.** It cut the mission mean move from 3.3 to 2.6 tiles, but left one overlapping pair and lengthened a versus end's moves. It can be revisited in S3a if `pnpm playtest` moves more than the lead wants. |

**Open, not a decision yet.** The Ambush ring hands out ring tiles one apart regardless of class, so a hull
beside a team is a contested slot. GH-421 already stops the arriving hull at contact there. If S0 shows the
ring visibly ragged, the fix is in the ring's slot pick (hulls on every other tile), a formation change for
its own small slice.

---

## 9. Reproducing the sheet

The scratch exporter builds each world through `missionWorld` (`tools/src/mission-harness.ts`, seed 424242,
empty ledger), or through `standMapStructures` plus `versusSpawns` for the versus rows. It reads
`sim.state`, and runs the real `assignTemplate` (with `templateOffsets` for the depth) on the real
`sim.blocked` and `sim.blockedVehicle` masks with the `assembly` shape in §3.2, after the 6-tile clustering
and the one-body rule. It writes JSON, and a
matplotlib script draws it: tiles (blocked, boulder, cover), bodies by class, overlapping bodies outlined in
red, a facing tick on each body, and a front arrow. S0 commits the exporter as
`tools/src/backtest/spacing-sheet.ts` so the picture can be regenerated after every slice. Until then the
census table in §1.1 is the record of what the scratch run printed on `fc6d72c7c`.
