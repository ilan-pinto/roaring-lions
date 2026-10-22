# Eleven credit-only special units for the brigade store — design (GH-709)

**Date:** 2026-10-22 · **Status:** proposal for the lead; nothing is built. **Issue:** GH-709 (ten units,
plus unit 11, the cluster bomb cannon, from the lead's 20 Oct comment). **Base:** `origin/main` at
`2f57c99a3` (mobility kills, GH-706, merged). **Precedent:** E5, the three bought-only units
(`docs/superpowers/specs/2026-09-29-e5-special-forces-design.md`, numbers in
`docs/campaign/special_units/e5/numbers.md`). **Downstream:** `sim-guard` (three engine concepts),
`balance-analyst` (numbers gate, probes), `narrative-designer` (names screen), `blender-art` (meshes),
`render-vfx` (three presentation items), `playtest` (off-ladder probes).

No engine code, no `data/units/` JSON and no Meshy credit was spent for this document. The 11 draft
units below were written to a scratch directory only, to measure them against the schema and the cost
curve; Phase 1 stages them in the repository.

## 0. What this design found, in one place

1. **Six of the eleven are JSON-only today.** Camouflage tank, long-range cannon, AA missile team,
   camouflage rifle squad, grenadier squad and robot dog need no engine change: every ability they
   advertise is a stat the sim already reads (signature, the firing multiplier, the ambush stance,
   indirect fire on per-side identification, `can_target: ["air"]`, `splash_tiles`, `mark_tunnel`).
2. **Three engine concepts cover the other five**, and each is small, data-driven and reuses a shipped
   mechanism rather than inventing one:
   - **E1, the unit aura**: the field-works `aura.area` block (`structures.ts`, `stepAuras`) carried by
     a unit instead of a building. Medic squad, armoured ambulance, medevac helicopter.
   - **E2, the `indirect` weapon flag**: any weapon class may fire on a side-identified target without
     its own line of sight, today decided by class alone (`INDIRECT_MASK`, `sim.ts:336`). The NLOS
     missile team.
   - **E3, submunitions**: one round that splits into N bomblets on impact, each resolved through the
     shipped `splashDirect` (soft targets only, tunnels immune) with its scatter drawn from the
     shooter's own RNG stream, and a new `submunition` event for the ROE judge and the renderer. Not
     the fire-support `strike` path, which damages armour and buildings alike (§2). The cluster
     cannon.
3. **The campaign enemy fields no armour at all.** Every Sarim unit's front armour is at most 15 mm
   (`technical`). A heavier anti-tank squad (unit 4) therefore has nothing to be heavier *against* in
   the campaign; it is redesigned below as a precision fires team whose value is reach without sight,
   at low collateral (§1.4).
4. **Enemy air is near-dead content**: five placements across 27 missions (`loiter_drone`, `paramotor`).
   A KDF AA team (unit 3) is cheap to build and nearly idle in the campaign; the 2026-09-13 star-unit
   design rejected a dedicated AA unit on the same measurement (its G6).
5. **The store's size roughly doubles.** The shipped credit catalogue is **72,485** credits
   (every KDF `unlock.price` and upgrade tier, plus staged `demo_tzav`), **12.2 campaigns** at
   `LADDER_CREDITS` 5,920. The eleven at the prices below add **57,750**: **130,235, 22.0 campaigns**,
   before any upgrade track. Every item stays reachable by play (coin spec G1), but "reachable" now
   means roughly ninety hours. That is the first question for the lead (§6, Q1).
6. **The cost curve passes with all eleven** (47 units within ±18%, both passes), and adding them moves
   no shipped unit closer to the band edge: `attack_drone` goes from +16.0% to +13.7%. The curve cannot
   see any of the abilities that are the point of these units, so five carry a deliberate premium inside
   the band (§3).

## 1. The eleven units

Common to all eleven: `"faction": "kdf"`, `"unlock": { "price": N }` and no earned field. That is the
credit-only shape: `isBoughtOnly` (`packages/sim/src/unlock.ts`) reads "no earned field and a price" as
"closed until bought", and the brigade screen already renders it (`unlockReason` returns
`buy for N credits`). The shared `unlock` schema (`common.schema.json#/$defs/unlock`) accepts `price`
alone, so **no schema change is needed for the gate**. No mission fields any of them (the ladder,
`GATES` and `LADDER_CREDITS` must not move, as in E5); a bought one is buildable at any camp on a
`resources` mission, and nowhere else.

Logistics costs are measured (§3). Credit prices sit in `prices.md` §8's bought-only band (floor 4,000,
ceiling 8,000), ordered by how much each changes what a player can do. "Ladders" is price over
`LADDER_CREDITS` 5,920.

| # | id (working) | role | logistics | credits | ladders | engine | art |
|---|---|---|---|---|---|---|---|
| 1 | `mbt_lavi_camo` | mbt | 960 | 6,000 | 1.01 | none | Blender kit on `mbt_lavi.glb`, 0 cr |
| 2 | `spg_long_range` | artillery | 400 | 6,500 | 1.10 | none | Meshy, 35 / 75 cr |
| 3 | `inf_aa_missile` | aa | 240 | 4,000 | 0.68 | none | Meshy, 35 / 75 cr |
| 4 | `at_nlos_team` | at_team | 265 | 5,500 | 0.93 | **E2** | Meshy, 35 / 75 cr |
| 5 | `veh_ambulance` | apc | 540 | 5,000 | 0.84 | **E1** | Meshy, 35 / 75 cr |
| 6 | `air_medevac_heli` | apc (air) | 330 | 6,500 | 1.10 | **E1** | Blender on `heli_yanshuf.glb`, 0 cr |
| 7 | `inf_medic_squad` | support | 295 | 4,250 | 0.72 | **E1** | Meshy, 35 / 75 cr |
| 8 | `inf_rifle_camo` | infantry | 320 | 4,500 | 0.76 | none | Meshy, 35 / 75 cr |
| 9 | `inf_grenadier` | infantry | 320 | 4,000 | 0.68 | none | Meshy, 35 / 75 cr |
| 10 | `ugv_recon_dog` | drone (ground) | 190 | 4,000 | 0.68 | none (rig: new) | Meshy, 35 / 75 cr |
| 11 | `spg_cluster` | artillery | 400 | 7,500 | 1.27 | **E3** | Blender on unit 2's GLB, 0 cr |

Ids follow the issue; unit 4 drops the issue's `inf_atgm_kornet` because the Kornet is the Sarim weapon
in this game (the issue says so itself), and unit 11 takes the lead's `spg_cluster`. Display names are
working names only (§6, Q13).

### 1.1 `mbt_lavi_camo` — camouflaged tank

**Role and counters.** An ambush tank: it waits under a net on a road it expects armour or trucks to use,
and is seen late. Countered by anything that finds it first: a recon drone, a sweep, an observer that
makes it fire at the wrong thing. Its trade for the net is the Lavi's active protection: no `aps` block
(the net fouls the launchers), so a missile that finds it is not intercepted.

**Ability, and why it is JSON today.** Detection is `signature × stance × motion × firing × cover`
(`detectionFrom`, `sim.ts` ~4210): `AMBUSH_SIG` 0.5 in the ambush stance, `MOTION_SIG` 1.5 while it
moves, `firing_signature_mult` for `FIRING_SIG_TICKS` (3 s) after a shot, `COVER_SIG` by tile. So
"hidden while still, revealed on fire" is two numbers:

| state | Lavi (sig 1.0, fire ×4) | camo Lavi (sig 0.55, fire ×6) |
|---|---|---|
| parked, ambush stance | 0.50 | **0.275** |
| moving | 1.50 | 0.825 |
| within 3 s of firing | 4.00 | 3.30 |

The ambush stance is the shipped `setStance` command (any unit). It also holds fire until a target
closes to the ambush radius (`AMBUSH_RADIUS_DEFAULT` 3 tiles, `tuning.ts:487`, widened by the order's
`radius`), and any order or the spring clears it: the hidden posture is a trap, not a gun line. Out of
the stance the tank is only its 0.55 signature. Stats otherwise the Lavi's: hp 3000,
armour 700/300/150 (top 80), `gun_120` and `coax_mg` unchanged, speed 1.0 (Lavi 1.1), turn 55, thermal,
sight 12, `smoke`.

**Risk.** The campaign enemy has no armour, so a sprung camo Lavi kills whatever walked into its radius
from a position nothing had found. Its counter must be measured, not argued: a probe (§3) reads the tick at which
`sarim_rifles`, `atgm_cell` and `rpg_team` identify it at 4/6/8 tiles parked, moving and firing, against
the Lavi. `sniper_team` (sig 0.25) and the Shmamit (0.25) remain the least visible things the KDF owns.

### 1.2 `spg_long_range` — long-range cannon

**Role.** Counter-battery and deep fire. A tracked 155 mm howitzer: range 28 (KDF indirect tops out at
`mortar_team`'s 18; the Sarim `rocket_battery` reaches 20), minimum range 6, sight 7. It cannot see what
it shoots.

**Ability, and why it is JSON today.** A `mortar`-class weapon is in `INDIRECT_MASK`, so it fires with no
line of sight of its own, and `engageable` already refuses any target its side has not *identified*
(`sim.ts` ~5008). "Needs a spotter" is therefore not a rule to write: it is how indirect fire works.
Weapon `howitzer_155`: mortar, range 28 / eff 22, accuracy 0.45, pen 60, damage 320, splash 2.4,
suppression 140, rof 3, `collateral_risk` 0.8, `can_target: ["ground","structure"]`.
Hull hp 1400, armour 60/30/20, `wheeled: true` and `gear: "tracks"` (role `artillery` is in
`FOOT_ROLES`, which would otherwise make it a foot unit, the `rocket_battery` trap), `can_embark: false`,
signature 1.0, firing ×6.

**Not in v1: counter-battery radar.** Nothing reveals an indirect shooter to its target's side today. A
"sound-ranging" rule would also expose the Sarim Grad and move every pin it touches; out of scope (§5,
deferred D3).

**Risk.** Range 28 on a 48-tile map outranges every enemy weapon. The 2026-09-13 star-unit design
rejected a 20-tile guided mortar as a reward for restraint; credits are not restraint, but the ROE cost
still lands where the round lands (collateral 0.8 arms both the zone penalty and danger-close). A probe
duels it against the Grad with a drone spotter on each side.

### 1.3 `inf_aa_missile` — AA missile team

**Role.** The KDF's first foot AA: a three-man team with a shoulder-launched missile, the mirror of the
Sarim `manpad_team`. **Ability:** `can_target: ["air"]` on an `atgm`-class weapon, which `engageable`
already honours (`isAirborne(t) ? canTargetAir : canTargetGround`). Weapon `aa_missile`: range 14 / eff
12, accuracy 0.75, pen 60, damage 320, rof 3, min range 2, collateral 0.05. Hull hp 340, sight 13,
thermal, signature 0.4. `role: "aa"` is not in `FOOT_ROLES`, so the draft sets `wheeled: false` and
`can_embark: true` explicitly, as `manpad_team` does.

**Risk: idle content.** Enemy air is five placements in 27 missions. Priced at the floor, built after
everything else unless E6's drone swarm (GH-274) lands first and gives it work (§6, Q3).

### 1.4 `at_nlos_team` — NLOS missile team (unit 4, redesigned)

**What changed and why.** The issue asks for a heavier anti-tank squad. The KDF already has `at_team`
(Spike, pen 900), and **no campaign enemy has more than 15 mm of front armour**, so more penetration buys
nothing in the campaign. What the KDF lacks is *precise* reach without sight: its only indirect weapon
is the mortar at collateral 0.7 (the Peten's Hellfire, collateral 0.2, is direct fire and needs its own
sight line), which bills the player for every round near a clinic. The NLOS team
fires a guided missile at 24 tiles onto anything its side has identified, at **collateral 0.2**, below
the 0.3 structural threshold (`STRUCTURAL_COLLATERAL`, `mission.ts:686`): the tool for killing a Grad, a
mortar crew or an ATGM cell in a town without paying for it.

**Ability: needs E2.** Line of sight is decided by weapon CLASS (`INDIRECT_MASK` = mortar | rocket). An
`atgm` must see its target. Authoring the missile as `rocket` would work in the sim today, but it would
draw as a Grad arc with a rocket trail and be counted by everything that reads "rocket" as artillery.
E2 adds one boolean (`indirect`) so the class stays honest. Weapon `spike_nlos`: atgm, `indirect: true`
(E2), range 24 / eff 18, accuracy 0.8, pen 1000, damage 450, rof 2, min range 4, collateral 0.2,
`can_target: ["ground","structure"]`. Hull hp 380, crew 4, speed 0.6, sight 9.

**Not in v1: top attack.** `hull.armor.top` is in the schema and **read by nothing in the sim**;
`TOP_ATTACK_WEAPON_IDS` (`render/.../missiles.ts:107`) is a presentation whitelist only. With no
armoured enemy in the campaign, a top-attack rule would change only a versus mirror match (§5, D4).

### 1.5 `veh_ambulance` — armoured ambulance

**Role.** A protected four-seat carrier that heals foot units around it while parked. Unarmed. Hull hp
1700, armour 240/150/90 (top 40), crew 2, `transport_slots: 4`, speed 1.4, `smoke`.

**Ability: needs E1.** Field works already heal: `kdf_medic_station` carries
`aura.area: [{ radius: 4, affects: "foot", heal_per_s: 0.01, heal_cap: 1.0 }]` and `stepAuras`
(`sim.ts` ~8110) applies the max over covering effects. E1 lets a unit type carry the same block. The
ambulance: radius 3, foot, `heal_per_s` 0.015, cap 1.0, while it is not moving (E1's `stationary`).

**Wounded and rescue (GH-707) is not assumed.** The issue's "evacuates wounded" needs #707's wounded
entity, which does not exist. v1 heals pooled squad hp; when #707 lands, "evacuate a wounded man" is a
transport order on #707's entity and needs no change to this unit's data.

### 1.6 `air_medevac_heli` — medevac helicopter

**Role.** The Yanshuf's airframe (GH-698: `heli_yanshuf` and its GLB are on `main`, with the
`AIR_LANDING`/`AIR_LANDED`/`AIR_LIFTING` flight states) as an unarmed four-seat carrier whose passengers
heal in flight. hp 800, armour 32/20/14, `domain: "air"`, speed 3.0, `transport_slots: 4`, no weapon.

**Ability: needs E1, with the `passengers` scope.** `stepAuras` skips carried and airborne units by
design. E1's `affects: "passengers"` heals the carrier's own riders instead, at `heal_per_s` 0.03 (twice
the ambulance, because the rider is out of the fight while it heals). Landing to load is the shipped
Yanshuf behaviour (`airLoadOrder`).

### 1.7 `inf_medic_squad` — medic squad

**Role.** A six-man team that keeps a line of riflemen standing. Carbines for self-defence only
(range 6, damage 14, collateral 0.08), `garrison`, `smoke`. hp 360.

**Ability: needs E1.** A personal aura: radius 2.5, foot, `heal_per_s` 0.02, cap 1.0, stationary. It
does not heal itself (E1 excludes the carrier from its own `area` effects). Two medic squads standing
together do heal each other; each still costs a slot and a price, so that is accepted.
`repair` is deliberately absent: it is the engineers' vehicle field-fix assist (`fieldFixRate`,
GH-706).

**Overlap with GH-707.** #707 proposes a `medic_team` that drags and treats wounded men. That is this
unit's v2. Recommendation: build E1 now (it is useful whatever #707 decides), but schedule this unit,
the ambulance and the medevac after #707's model decision, as the issue suggests, so they are not
redesigned twice (§6, Q8).

### 1.8 `inf_rifle_camo` — camouflaged rifle squad

**Role.** A fighting squad in ghillie suits: it holds a hedge line unseen and opens fire first. Six men,
`marksman_rifles` (range 10 / eff 8, accuracy 0.72, pen 12, damage 30, rof 120, collateral 0.06),
signature 0.28, firing ×4.5, thermal, sight 11, `garrison`, `mark_target`, `hidden_setup`.

**Ability, and why it is JSON today.** As 1.1 (with the same ambush-radius caveat): parked in the
ambush stance it reads 0.14, moving 0.42,
firing 1.26, against a rifle squad's 0.3 / 0.9 / 1.8. (`hidden_setup` is a dock tag only, read by
nothing in the sim; the stance does the work.)

**Overlap.** The Shmamit (`recon_zikit`, signature 0.25) is an eye that avoids a fight; the sniper team
takes one man at a time. This is the only one of the three that *fights* as a squad. If the lead
judges the overlap too close, this is the unit to drop (§6, Q9).

### 1.9 `inf_grenadier` — grenadier squad

**Role.** Clears infantry in cover. Two weapon slots (the sim fires slots 0 and 1 only,
`unit_weapon_slots.test.ts`): `gl_40` (type `he`, range 7 / eff 5.5, accuracy 0.55, pen 30, damage 60,
`splash_tiles` 1.2, suppression 120, rof 30, collateral 0.3) and the rifle squad's rifles.

**Ability, and why it is JSON today.** Tile cover lowers the chance a round *hits*, but splash does not
read cover: `splashAt` (`sim.ts` ~6258) damages every soft unit inside the radius on a hit or a miss.
So a grenade that misses a man behind a wall still hurts him, which is the whole point of a grenade.
**Garrisons are out of reach and that is a rule, not a gap**: `applyDamage` returns for a garrisoned
unit ("taking it down is the only way to reach them", `engageable`). An occupant-fire rule would
overturn that; not recommended (§6, Q7).

**Presentation item P2.** `shellKindFor` (`render/.../shells.ts:410`) draws every `he` round as a
`missile` (body, glow, smoke trail). A 40 mm grenade needs a short lobbed round with no trail, keyed by
weapon id like `TOP_ATTACK_WEAPON_IDS`.

**ROE.** Collateral 0.3 sits exactly on `STRUCTURAL_COLLATERAL`, so grenades fired into a flagged zone
cost Conduct and rifles do not. That is the honest number for 40 mm HE in a street (§6, Q10).

### 1.10 `ugv_recon_dog` — recon robot dog

**Role.** Expendable ground recon that walks where a drone is shot down and a man would be: into
alleys, boulder fields and tunnel mouths. No weapon, hp 160, speed 1.3, sight 12, optics 1.6, thermal,
signature 0.35, `mark_target`, `mark_tunnel`, `suppression_resistance` 1.0 (a robot does not pin),
`crew: 0`, `population: 0`.

**Ability, and why it is JSON today.** `mark_tunnel` identifies a route to anything that holds a sight
line to it, whatever carries it. `role: "drone"` with `domain: "ground"` and `wheeled: false` walks the
foot domain (boulders are open ground on foot, a wall to vehicles), which is the dog's whole value
against the recon drone (air, MANPAD-exposed) and the Shachaf (wheeled, boulder-blocked).

**Named risks.** (a) `role: "drone"` with a ground domain is a new combination; anything that assumes
"drone means air" (icons, voices, `names.json` kinds) must be audited in its phase. (b) The rig: every
rigged unit is a biped (`rig.py`, the motion pass). A quadruped is a new rig shape with its own gait
measurement. Built last for that reason.

### 1.11 `spg_cluster` — cluster bomb cannon (unit 11)

**Role.** Area denial against infantry and soft-skin vehicles in the open. Same tracked chassis and
hull as unit 2; weapon `dpicm_155`: mortar class, range 24 (shorter than unit 2: the carrier shell is
heavier), min range 6, rof 2, collateral **0.95**, `can_target: ["ground"]` (no structures; bomblets do
not bring a building down).

**Ability: needs E3, submunitions.** One round bursts into **12 bomblets** scattered up to 2.5 tiles,
each damage 90, splash 0.8, suppression 60. If each bomblet resolves through the shipped `splashDirect`
(`sim.ts` ~6286), the behaviours the lead asked for fall out of its rules: it damages only `isSoft`
units, so armour is untouched; `applyDamage` returns for garrisoned and carried units; tunnelled units
are skipped. Strong against infantry and trucks in the open, weak against armour and garrisons, with no
new combat rule. (It is side-blind, like every splash in the game: a bomblet on your own squad hurts it.)

**Separate unit, not an ammo choice.** The sim fires both weapon slots independently, so "HE or cluster"
on one hull would fire both. An ammunition selector is a new command, a UI control and a new hash
column for one unit. Recommended: a separate unit on a Blender variant of unit 2's GLB (§4), 0 credits
(§6, Q4).

**ROE, the point of the unit.** The parent round is already judged today with no E3: its `fire` event at
collateral 0.95 (≥ `HEAVY_COLLATERAL` 0.5) charges danger-close at the aimpoint per shot
(`mission.ts` ~3319), and a miss's `nearMiss` charges a flagged zone (≥ 0.3, `mission.ts:3278`). What
that misses is where the bomblets land. E3 adds a `submunition` event per bomblet that `mission.ts`
judges with the flagged-zone rule (sharing the shipped `zoneDeductedAt` cooldown, so one round charges a
zone once) and with danger-close against civilians where the bomblets fall. Recommended magnitude:
danger-close **once per round at double the penalty**, and the parent's own aimpoint danger-close
skipped for a submunition weapon so the round is not charged twice (12 bomblets × 3 would be 36 Conduct
for one shell) (§6, Q6).

**Duds: not in v1.** A persistent hazard area is a new sim object (position, lifetime, a trigger on
entry, civilians walking into it). Recommended deferred (§6, Q5).

**Presentation.** An airburst, then a spread of small impacts: the Defilade flipbook explosions
(GH-705) when they land, otherwise `shell_impact.json` at a low `impactPower`; small craters and scorch
through `stampGroundDecal`, the one decal entry.

## 2. Engine concepts

Each is data first (a schema field), owned by `sim-guard`, and dormant on shipped content: no shipped
unit carries the new field, so **no golden hash, `pnpm balance` line or `pnpm playtest` line should
move**. A PR that moves one has a bug or must say why in the same commit.

### E1 — the unit aura

- **Schema:** `unit.schema.json` gains `aura: { area: [AreaEffect] }`, the field-works `aura.area`
  shape (`radius`, `affects`, `heal_per_s`, `heal_cap`, `repair_per_s`, `accuracy_mult`), plus
  `affects: "passengers"` (units only) and `stationary: boolean` (effect only while the carrier is not
  moving).
- **Parser:** `AreaEffectJson`'s parser throws on an unknown `affects` (`structures.ts:243`), so
  `"passengers"` is a new enum value and `stationary` a new effect field, and structure data must
  still refuse `passengers`.
- **Sim:** `stepAuras` also walks units whose type has an aura (alive, surface, not carried) and applies
  the same max-over-effects rule into the same `auraHealRate`/`auraHealCap`/`auraAccMult` columns; a
  carrier never covers itself. `stepAuras` skips carried, garrisoned and air recipients outright
  (`sim.ts` ~8132), so `passengers` is its own loop over the carrier's riders (`carriedBy[i] === c`).
  Heal still waits `REGEN_DELAY_TICKS` after damage (`sim.ts` ~8258); a carried rider takes none, so it
  heals from the first tick of the ride.
- **Gating and the hash:** the aura columns are folded into the state hash only inside
  `if (this.fwLive)` (`sim.ts` ~8421). A separate flag would leave a unit aura's effects unhashed, so
  spawning an aura-carrying unit sets `fwLive` (as structure placement does at `sim.ts` 1999 and 2094).
  That also switches on field works' sensor and route bookkeeping for that mission, a small cost, and
  only where a bought aura unit is fielded; every shipped mission keeps `fwLive` as it is today.
- **Cost:** O(aura units × living units) every `AURA_CADENCE_TICKS` (10). At 10 aura units and 300
  living, 3,000 distance checks twice a second.
- **Consumers:** units 5, 6, 7. Later: #707's medic team.

### E2 — the `indirect` weapon flag

- **Schema:** weapon `indirect: boolean`, default false.
- **Sim:** load sets a per-weapon bit; the five `INDIRECT_MASK & (1 << w.cls)` sites (`sim.ts` 4019,
  4346, 5020, 5116, 7692) read `w.isIndirect` instead, which load sets to `INDIRECT_MASK` membership OR
  the flag. Identical for every shipped weapon by construction. The rest of the class-keyed behaviour
  stays with the class on purpose: structure damage (`STRUCT_DAMAGE`), anti-armour target ranking
  (`ANTI_ARMOR_MASK`), projectile speed and falloff. So the NLOS missile flies and ranks targets as an
  ATGM; Phase 6 confirms `STRUCT_DAMAGE[atgm]` is non-zero for its `structure` target.
- **Render:** a lofted flight for an indirect `atgm` (`missiles.ts` already has a `top_attack` variant
  keyed by weapon id).
- **Consumers:** unit 4.

### E3 — submunitions

- **Schema:** weapon `submunitions: { count, scatter_tiles, damage, splash_tiles, suppression }`.
- **Sim:** on the parent round's impact (hit or miss), resolve `count` bomblets at once, each at a
  scatter point drawn as the fire-support path draws one: **two draws per bomblet from the shooter's
  own stream** (`rng.nextU32(shooter)`, invariant 3), and each through `splashDirect` with the weapon's
  bomblet numbers. **Not through `pendingStrikes`/`stepStrikes`**: that resolver (`sim.ts` ~5957)
  calls `applyDamage` on every unit in the radius with no `isSoft` test, so armour would take bomblet
  damage, and damages every structure in the radius at twice the damage, so bomblets would raze
  houses. Its `strike` event's `profile` indexes `FIRE_SUPPORT`, the renderer reads any non-barrage
  profile as the air-strike burst (`ThreeRenderer.ts` ~5584), and the overlay prints "PRECISION STRIKE"
  for every one (`overlay.ts:219`). Resolving in the same tick also keeps the hashed `pendingStrikes`
  fold untouched.
- **Event:** a new `submunition` event per bomblet (`by`, `x`, `y`, the parent's weapon id).
- **ROE (`mission.ts`):** the `submunition` event is judged per §1.11 and Q6; the parent's aimpoint
  danger-close is skipped for a submunition weapon.
- **Render:** an airburst at the parent impact and N small impacts from the `submunition` events.
- **Cost:** per round, `count` × living units distance checks. At rof 2/min, negligible.
- **Consumers:** unit 11. Possibly a fire-support "cluster barrage" profile later (not proposed).

### Deferred, named so nobody builds them by accident

| # | concept | why deferred |
|---|---|---|
| D1 | GH-707 wounded entity | its own issue; the medic trio's v2 |
| D2 | Duds as a persistent hazard area | a new sim object; Q5 |
| D3 | Counter-battery (indirect fire reveals the firer) | touches the Sarim Grad and its pins |
| D4 | Top-attack reading `hull.armor.top` | no armoured campaign enemy; versus only |
| D5 | Occupant fire into garrisons | overturns a shipped rule; Q7 |
| D6 | Ammunition selector on one hull | a command, a UI control and a hash column for one unit; Q4 |

## 3. Balance

**Cost curve, measured.** Drafts in a scratch directory (schema: 11 PASS against the shipped
`unit.schema.json` through `ajv/dist/2020.js`, as `validate_data.mjs` uses). Command:

```
python3 tools/validate_balance.py --units data/units \
  --also docs/campaign/special_units/e5 --also <scratch>/su --report
fitted curve: cost = 284.578 * power^0.480  (n=47)
at_nlos_team      0.7   265   236  +12.1%     inf_rifle_camo    1.1   320   301   +6.2%
air_medevac_heli  1.1   330   297  +11.1%     ugv_recon_dog     0.5   190   196   -3.2%
spg_cluster       1.7   400   367   +9.0%     inf_grenadier     1.4   320   330   -3.1%
veh_ambulance     3.2   540   497   +8.7%     inf_aa_missile    0.7   240   242   -0.9%
inf_medic_squad   0.9   295   272   +8.6%
mbt_lavi_camo    11.0   960   899   +6.8%
spg_long_range    1.8   400   375   +6.8%
balance gate passed: 47 units within +/-18%
```

The curve without the eleven is `288.175 * power^0.468` (n=36), tightest `attack_drone` +16.0%; with
them `attack_drone` reads +13.7%. Max-tier pass (`--max-tier --upgrade-cost-factor 0.02`): passes,
tightest `heli_yanshuf` +15.1% (a shipped unit), and none of the eleven above +11.3%. None of the
eleven declares an upgrade track.

**What the curve cannot see, and the premium for it.** The curve scores kills per minute, hull and
mobility. It does not read the firing multiplier, the ambush stance, indirect fire, an aura, or
submunitions. The first fit put `air_medevac_heli` at +35% and `at_nlos_team` at +27% when priced by
feel; each unit's logistics was then set to the fitted value plus a premium for the ability it cannot
see: NLOS and medevac about +11-12%, aura and cluster about +9%, camouflage about +6-7%, none for the
JSON-only units whose value the curve does read. **The premiums are judgement, and the probes below are
what tests them.**

**§5.7 and `pnpm balance`.** `pnpm balance` names six ids (`tools/src/backtest/targets.ts`) and cannot
move; it runs as a guard. None of the eleven is in a §5.7 target. **`validate_balance.py --also` on CI
is what sees them**, from Phase 1 on, exactly as it sees the E5 three.

**Probes** (`tools/src/backtest/special-units-probes.ts`, report-only, bands frozen by
`balance-analyst` at the numbers gate and pinned by a test, never widened afterwards):

| unit | probe | the question |
|---|---|---|
| 1 | detection tick vs `sarim_rifles`, `atgm_cell`, `rpg_team` at 4/6/8 tiles, parked in ambush (radius 3, and widened to 8) / moving / firing, against the Lavi | is it found at all, and only by firing? |
| 2 | vs `rocket_battery` at 20-28 tiles, a recon drone spotting for each side | does reach win the duel outright? |
| 3 | vs `paramotor`, `loiter_drone` | kills per pass |
| 4 | vs `rocket_battery`, `atgm_cell` at 20 tiles with a drone spotter; Conduct spent in a flagged zone vs `mortar_team` | the precision claim |
| 5-7 | hp restored per minute on a pinned rifle squad vs `kdf_medic_station` | an aura is not a better station |
| 8 | detection as 1, against `inf_squad` and `recon_zikit` | the overlap |
| 9 | vs `militia_cell` on cover 2 and in the open, vs `inf_squad` | the cover claim |
| 10 | first identification of a buried route on `beit_sahwan_4_subterranean`, vs `recon_drone` and `yahalom_squad` | the tunnel claim |
| 11 | vs infantry in the open, a garrisoned house, a `technical`, an armoured column; Conduct per round near civilians | the lead's four claims |

`(bought)` playtest probes, off the ladder (E5's idiom): units 1, 2, 11 on `umm_zeitoun_4_clearance`,
unit 4 on `tel_marum_3_clearance` (the Grad), units 5-7 on `wadi_halam_5_depot` (the hold), unit 10 on
`beit_sahwan_4_subterranean`.

**Staging.** Phase 1 puts the eleven JSONs in `docs/campaign/special_units/gh709/`, extends
`tools/src/e5_staged.test.ts`'s pattern to it (schema-valid, not half-landed, no staged id in
`@lions/data`'s `units`), and adds `--also docs/campaign/special_units/gh709` to CI's
two `--also` steps (`ci.yml` has four `validate_balance.py` steps: plain and `--also e5`, each with and
without `--max-tier`). The staged test's mirror pin (a landed id must be registered, bought-only and in
band, and its mesh out of `HELD_MESH_FILES`) extends to `gh709` too, one held entry per unit whose GLB
lands before its data. A staged JSON that needs E1-E3 is staged **without** the engine field
(which the schema would refuse) and gains it in its engine phase.

## 4. Art

House rules apply to every model: Meshy only for the base model (`meshy-api-policy`), each call's credits
announced to the lead first, prompts rewritten from the lead's drafts by an Opus agent at high effort (the
21 Oct rule), maximum detail with simplification only to a measured budget, no flags, insignia or text,
team colour never baked into a texture, and every mesh through `pnpm validate:meshes`' silhouette IoU
(≤ 0.88 against every other mesh). Credits below: **planned** is one text preview (20), one refine (10)
and one remesh (5); **ceiling** adds a re-roll and a second remesh. At the CLI's $0.02 a credit.

| # | source | planned / ceiling | IoU neighbours (the named risk) | lever that separates it |
|---|---|---|---|---|
| 1 | Blender kit grafted on `mbt_lavi.glb` (as `officer_armour`, `export_officer_armour.py`) | 0 | `mbt_lavi`, `officer_armour` | the net's draped top line; `officer_armour`'s mast took it to 0.526 |
| 2 | Meshy text-to-3D | 35 / 75 | `rocket_battery`, `ifv_namer`, `mbt_lavi` | barrel at 35°, spades down |
| 3 | Meshy (team) | 35 / 75 | `manpad_team`, `at_team`, `inf_squad` | tube aimed high, back radar pack |
| 4 | Meshy (team) | 35 / 75 | `at_team`, `atgm_cell` | tripod launcher box |
| 5 | Meshy text-to-3D | 35 / 75 | `ifv_namer`, `apc_kipod`, `apc_eitan` | raised box roof, stretcher racks |
| 6 | Blender on `heli_yanshuf.glb` | 0 | `heli_yanshuf` | hoist boom, external tanks |
| 7 | Meshy (team) | 35 / 75 | `inf_squad`, `breach_team` | boxy trauma packs, rolled stretchers |
| 8 | Meshy (team) | 35 / 75 | `sniper_team`, `recon_zikit` | ghillie cloak: a draped, caped outline |
| 9 | Meshy (team) | 35 / 75 | `inf_squad` (highest risk) | drum launcher, bandolier vest |
| 10 | Meshy | 35 / 75 | `recon_drone`? none on four legs | quadruped body |
| 11 | Blender on unit 2's GLB | 0 | unit 2 (identical chassis) | a different barrel and a rear ammunition rack, measured before any spend |

**Total: 280 credits planned, 600 ceiling (about $5.60-$12).** Measure IoU on every Blender variant
before deciding it needs Meshy; a variant that cannot clear 0.88 against its parent costs one Meshy part
(35).

**Pipeline per kind.** Vehicles: export → (`rescale:meshes` if cut in another frame) →
`running-gear:meshes` → `wreck:meshes` → `damage:meshes` → `encode:meshes`, `mesh-catalogue.ts`, the
portrait and the plate. Teams: `rig.py` figures, clips `idle`/`move`/`moveFire`/`fire`/`down`/`wreck`
(the medic adds `work`, as `yahalom_squad` does), then `motion:meshes` → `gait:meshes` →
`encode:meshes`, all three in that order. The dog needs a quadruped rig the motion and gait passes do not
know (§1.10).

**Medical markings.** The lead's ambulance and medevac drafts ask for a red cross or star of life. The
Red Cross, Red Crescent and Red Crystal are protected emblems under the Geneva Conventions, and Magen
David Adom's red star is a real organisation's mark. Recommended: no medical emblem at all, a plain white
band beside the team colour (§6, Q12).

**Names.** The `names.json` `kinds.vehicle_roles` list is `[apc, ifv, mbt, recon]`: the two SPGs
(`artillery`) and the dog (`drone`) would be named as squads. Each phase adds what its unit needs.

## 5. Build order

Each phase is one PR. Engine concepts land before the units that need them; JSON-only units land early,
in parallel with the engine work. Every content phase lands art and data together and moves its units
from `gh709/` to `data/units/kdf/` (CLAUDE.md, "Adding content").

| phase | PR | contents | owner | needs |
|---|---|---|---|---|
| 1 | Numbers and staging | the eleven staged in `gh709/`, the staged test, CI `--also`, the probe file, the names screen | balance-analyst, narrative-designer | the lead's numbers gate (Q1-Q13) |
| 2 | Ambush armour | units 1 and 2 (JSON-only); one Meshy model (unit 2) | blender-art | 1 |
| 3 | Infantry, JSON-only | units 8, 9, 3; three Meshy teams; P2 (the lobbed grenade) | blender-art, render-vfx | 1 |
| 4 | E1, the unit aura | schema, sim, tests; no content | sim-guard | 1 |
| 5 | The medic trio | units 7, 5, 6; two Meshy models, one Blender | blender-art | 4, and GH-707's model decision |
| 6 | E2 and E3 | the `indirect` flag and submunitions (own resolver on `splashDirect`, the `submunition` event), with their ROE and render hooks; no content | sim-guard, render-vfx | 1 |
| 7 | Precision and cluster | units 4 and 11; one Meshy team, one Blender variant | blender-art | 2 (unit 11's chassis), 6 |
| 8 | The robot dog | unit 10; the quadruped rig and gait | blender-art | 1 |

Phases 2, 3 and 4 can run at once; 6 can run beside 5.

## 6. Questions for the lead

1. **The store doubles.** 57,750 credits for the eleven take the catalogue from 12.2 to 22.0
   campaigns at the measured ladder, and upgrade tracks on them would add ~25,000 more (about 26
   campaigns). *Recommendation:* keep the 4,000-8,000 band (it is the rule that a bought-only unit is
   never cheaper than the dearest earned one), ship no upgrade tracks on the eleven in v1, and accept
   the larger catalogue as the long-tail goal it is.
2. **Prices.** The table in §1 (4,000-7,500). *Recommendation:* approve as drafted; the probes move
   logistics, not credits.
3. **The AA team has almost nothing to shoot.** *Recommendation:* build it (it is cheap, JSON-only and
   fills a real roster hole), at the floor price, after the other JSON-only units; or hold it until E6's
   drone swarm (GH-274) gives it work.
4. **Cluster: separate unit or ammunition choice?** *Recommendation:* separate unit `spg_cluster` on a
   Blender variant of unit 2's chassis (0 credits); no ammunition selector (D6).
5. **Duds as a lasting hazard?** *Recommendation:* no, not in v1 (D2). The Conduct cost is the
   cluster's price.
6. **How hard does the cluster hit Conduct?** *Recommendation:* the zone judge per bomblet (with the
   shipped cooldown, so once per zone per round), and danger-close once per round, judged where the
   bomblets land, at twice `disproportionate_ordnance_penalty`; not 12 times, and not again at the
   aimpoint.
7. **Grenades into garrisons?** *Recommendation:* no. "A building is the only way in" stays the rule;
   the grenadier's value is splash against cover and suppression.
8. **Medic trio before or after GH-707?** *Recommendation:* build E1 now; schedule the three units after
   #707's model decision so they are designed once.
9. **Is the camouflaged rifle squad too close to the Shmamit and the sniper?** *Recommendation:* keep
   it as the one that fights as a squad; it is the first to drop if the store needs trimming.
10. **Grenade collateral 0.3, on the structural threshold?** *Recommendation:* yes; 40 mm HE in a
    street should cost in a flagged zone.
11. **Long-range cannon at 28 tiles outranges the Grad.** *Recommendation:* 28, sight 7, firing ×6, and
    let the probe decide whether it wins outright; drop to 24 if it does.
12. **Medical markings.** *Recommendation:* no emblem; a white band and the team colour.
13. **Names.** *Recommendation:* `narrative-designer` runs the rule-3 screen before any name ships, in
    the house register (single Hebrew common nouns, mostly animals). Avoid real platform names the
    lead's drafts lean on (Kornet, Spike NLOS, Black Hawk, Merkava).
14. **Meshy spend.** 280 credits planned, 600 ceiling (about $5.60-$12), eight models, announced one
    by one. *Recommendation:* approve the plan; each call is still announced before it is spent.
15. **Network play.** *Recommendation:* the existing rule holds: a bought unit reaches network play
    only in a friends' room on "bring your brigade".
