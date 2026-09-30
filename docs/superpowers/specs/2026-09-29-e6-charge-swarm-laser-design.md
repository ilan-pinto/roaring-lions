# E6: the Shiryonan placed charge, the enemy drone swarm and the Gachelet beam — design (WP-G-E6, #274)

**2026-09-29** · status: design, no code · base `main` `66170f0a` · implements #274 (takes over
#273; closes #156 when the Shiryonan lands) · input: E5 spec §4 G1 and §8
(`docs/superpowers/specs/2026-09-29-e5-special-forces-design.md`), E5 plan "E6 — moved out",
`docs/campaign/special_units/e5/`. **Stage 4 or later**: every section below changes
`@lions/sim`. Gates: **G-NUM** (§10, placeholders for `balance-analyst`, then the lead),
**Meshy estimate** (§11, announced before any call), **G-MISSION** (§9, the two fielding
missions, after `playtest`).

**Binding rulings (29 Sep).** The swarm is ENEMY-ONLY (Sarim, Rif). The carrier is the
"Shiryonan Demolition Carrier", id `demo_tzav`. The beam unit is the "Gachelet", id
`aa_gachelet`. All five E5 units' numbers are approved (E5 Q1) and are NOT reopened here; every
number this spec adds is marked **P** (placeholder, G-NUM) or **D** (derived from approved
numbers, to be measured). Taken defaults (E5 Q4, Q12): the carrier withdraws on its own, 4 tiles;
the charge is set only on an explicit order; the blast hurts own troops and civilians; the beam
does not intercept mortar or rocket rounds in v1. Missions stay declarative data; the sim stays
Q16.16 with per-entity RNG.

---

## 1. What exists today, measured in code

- **Demolition is held-station, one timer per unit.** `stepDemolition` (`packages/sim/src/sim.ts:
  4518-4638`) counts `demoTicks[i]` while the unit is stationary, unpinned and ungarrisoned
  (`:4551-4555`); on expiry it calls `destroyStructure(best, i)` at once (`:4617-4621`).
  `blade` grinds instead (`:4622-4636`). There is no placed object and no per-structure timer.
- **The automatic branch demolishes without an order** wherever a demolisher halts
  (`:4574-4600`), with carve-outs for protected sites, fences and the side's own camp. An
  ordered unit takes the explicit branch (`:4564-4573`); the command sets `demolishOrder`
  (`:2265-2292`).
- **Collapse kills the garrison and suppresses within 3 tiles**, nothing more
  (`destroyStructure`, `:4804-4830`; `COLLAPSE_SHOCK_SQ`/`COLLAPSE_SHOCK`,
  `structures.ts:129-131`).
- **`splashDirect` is the detonate-in-place splash** (`sim.ts:4086-4097`). It has no side
  test (own troops and civilians are hit), damages soft units only, skips `tunnelIn`, and skips
  **both `exclude` and `by`** (`:4089`), so the detonator never hurts itself.
- **`applyDamage` is the single HP choke point** (`:4099-4108`); garrisoned, carried and
  buried units take nothing.
- **A loitering munition steers itself** off its side's identified contacts, with no LOS or
  order (`stepKamikaze`, `:4402-4494`; scan `:4418-4437`), resolves its warhead **always against
  side armour** (`:4465`), **never meets APS** (the APS block lives only in
  `resolveProjectile`, `:3876-3905`), and dies: `destroy(i, target)` (`:4492`).
- **Air has no altitude.** `isAir` means "ignores terrain blocking and is only engageable by
  `can_target: air`" (`:329-339`). Targeting air still runs `losRay` (`selectTarget`,
  `:3176-3182`), and ground splash reaches air units (`splashAt` `:4065-4083` has no `isAir`
  test).
- **Smoke either blocks or degrades.** `losRay` returns -1 at `SMOKE_BLOCKS_AT` 320
  (`:2483-2484`, `tuning.ts:199`); thinner smoke multiplies hit chance by 0.55 per tile down to a
  0.1 floor (`hitFactors`, `sim.ts:3632-3640`; `tuning.ts:200-203`). `raySmoke` is
  elevation-aware (`sim.ts:2426-2464`).
- **Weapon classes are an int table** (`WEAPON_CLASS`, `:229-242`), and four per-class tables
  are indexed by it: `FALLOFF_SCALE` (`tuning.ts:29-42`), `APS_VEL_F` (`:107`), `PROJ_SPEED`
  (`:114-127`), `STRUCT_DAMAGE` (`structures.ts:105`). `interceptor` (10) exists in the schema
  and in no unit.
- **Field recovery regrows HP** to 70% of max after 10 s undamaged (`sim.ts:5124-5131`,
  `tuning.ts:238-242`). Rout needs `isSoft` (`sim.ts:5110-5118`).
- **ROE reads `side[e.by]` from persistent SoA**, so attribution outlives the killer: structures
  (`mission.ts:1413-1421`), civilians (`:1422-1425`). Kill credit counts any kill, own side's
  included (`:1024-1027`).
- **The hash covers the SoA** (`sim.ts:5148-5195`); the golden value is `2109596329`
  (`determinism.test.ts:394`), from a hand-built roster with no swarm, beam or placed charge.
- **The curve does not see class, `can_target` or abilities** — only `BLAST_TYPES`
  (`tools/validate_balance.py:231`, `offense_score` `:253-279`). The E5 figures (swarm +6.2%,
  Gachelet +5.1% on the `interceptor` stand-in) therefore carry over unchanged to the new class.

## 2. G1 — the placed charge (`demolition_method: "placed"`)

### 2.1 Arm

- **Order-only.** A `placed` unit skips the automatic branch entirely (`sim.ts:4574-4600`); it
  sets a charge only on `demolishOrder[i] >= 0`. Rationale beyond the ruling: a charge that goes
  off 8 s after a halt, with a 2.5-tile blast that kills friends, cannot be a side effect of
  parking.
- **Setting** reuses the explicit branch unchanged: in range (`DEMO_RANGE_SQ` 2 tiles,
  `structures.ts:125`), stationary, unpinned, ungarrisoned, no friendly inside (`sim.ts:4570`),
  for `demolition_time_s` 3.0 = 60 ticks. Interruption resets `demoTicks`, as today.
- **On completion** the unit does NOT call `destroyStructure`. It writes the charge into
  per-structure SoA sized `MAX_STRUCTURES` 256 (`sim.ts:697`), allocated once:
  `stChargeTicks: Int32Array` (fuse left, 0 = none), `stChargeBy: Int32Array` (setter id, -1),
  `stChargeX/Y: Int32Array` (the charge point: `nearestStructTile(s, pos)`, `:4188`, at set
  time — the wall the carrier stood at, not the centroid). It clears `demolishOrder`, emits
  `chargeSet`, and starts the withdrawal (§2.4).
- **One charge per structure.** An order on a charged structure is refused at the command
  (`:2265-2267` gains `stChargeTicks[s] === 0`).

### 2.2 Fuse

- `fuse_s` 8.0 → 160 ticks, counted down in a structure loop at the **top** of
  `stepDemolition` (before the unit loop, so a charge set this tick is not decremented this
  tick). Tick order is unchanged: demolition still runs between garrison and upkeep
  (`sim.ts:1731-1733`). Cost: one pass over ≤256 structures, only when any charge is live
  (a `chargesLive` counter gates the loop).
- The fuse **outlives the carrier**. Nothing reads `alive[stChargeBy]`; attribution resolves
  through `side[by]`, which `destroy()` leaves intact (`sim.ts:4833-4847`).
- No defusal in v1 (`defuse` is in the ability enum and read by nothing; Q12).

### 2.3 Detonation: structures, units, tunnels

On expiry, with `by = stChargeBy[s]`:

1. **Structure.** If `stAlive[s]`, `destroyStructure(s, by)` (`sim.ts:4804`): tiles unblock to
   rubble cover, the garrison dies via `destroy()` (so buildings still kill what is inside),
   everyone within 3 tiles takes `COLLAPSE_SHOCK`, `structureDestroyed` fires and ROE bills the
   structure's `roePenalty` to the setter's side (`mission.ts:1413-1421`). If the building was
   already destroyed by fire before the fuse ran out, step 1 is skipped and the crate still
   blows (Q9).
2. **Units.** `splashDirect(stChargeX, stChargeY, blast 2.5, damage 300, suppression 120/700,
   by, -1)`. Soft units take `300 × (1 − d/2.5)`: an `inf_squad` (400 hp) at 0.5 tiles takes
   240, a civilian group (200 hp, `data/units/civilians.json`) dies inside 0.83 tiles. Hulls
   take suppression only (`splashDirect` damages `isSoft` only). Own troops and civilians are hit
   by construction (no side test, `:4086-4097`); civilian deaths deduct through the existing
   path (`mission.ts:1422-1425`). The carrier itself is exempt by `splashDirect`'s `i === by`
   (`:4089`); it is armoured, so this only forgoes suppression (Risk R7).
3. **Tunnels.** None in v1. `splashDirect` already skips buried units (`:4090`), which is
   GDD-honest ("three metres of earth"), and route collapse stays `tunnel_charge`'s job behind
   its identification gate (`stepTunnelCharge`, `:4651-4710`). A placed charge that could
   collapse unidentified routes would bypass the whole find-then-charge loop (Q10).
4. **Neighbouring structures** take no damage in v1 (Q11): the ROE bill stays one building.
5. Clear the three arrays, emit `chargeDetonated`.

### 2.4 Withdraw

After `chargeSet`, the carrier gets a move goal `withdraw_tiles` (4) from the **charge point**,
along the charge-point→carrier vector, snapped with `nearestOpenTile(tx, ty,
maskFor(domain))` (`sim.ts:1846`, used this way at `:1827`) so a wheeled hull never targets a
boulder tile. Movement does not wait for the hull to turn (`:5007-5031`), so 4 tiles at 1.0
tiles/s take ~4 s (80 ticks, **D**) of the 8 s fuse, and the hull swings its 120 mm rear to the
enemy while it goes (E5 counter-play). If the snap cannot improve on the carrier's own tile
(a sealed courtyard, the `nearestOpenTile` pathology `:4673-4676` documents), the carrier stays;
it is still exempt from its own blast (R7), its escorts are not.

### 2.5 Events and presentation reads

`chargeSet { structure, by, x, y, fuseTicks }` and `chargeDetonated { structure, by, x, y }`
join the `SimEvent` union (`sim.ts:587-651`) and `SIM_EVENT_KINDS` (`:660-664`; the exhaustive
check fails the build otherwise). `chargeFuse(s): number` (0..1) joins `demolitionProgress`
(`:1594`) as a presentation read.

## 3. The swarm (`drone_swarm`, Sarim and Rif)

### 3.1 One entity, and why — measured against `docs/PERFORMANCE.md`

Per-tick cost does **not** decide this. At the 300-unit checkpoint the whole tick costs
2.08 ms (PERFORMANCE.md "Sim tick cost", 296 living), dominated by the two O(N²) scans. Scaling
that quadratically, the largest authored mission (65 units, CLAUDE.md) plus two 12-member swarms
as 24 entities is ~0.18 ms against ~0.11 ms with 2 swarm entities (**D**): both under 0.4% of
the 50 ms budget. What decides it:

- **RNG stability (invariant 3).** Ids are handed out by `const id = this.count++`
  (`sim.ts:1642`) and each id owns its stream (`rng.ts:36`). A wave of N drones re-keys every
  entity spawned after it; retuning `count` from 12 to 10 would then move every later unit's
  rolls. One entity makes `count` a pure number.
- **Saturation is the realistic abstraction.** The model the lead approved (a pool that thins)
  is exactly one hull whose HP is the pool.
- **Accounting.** Pop 0, one HP bar, one `destroyed` event, one detection row.

### 3.2 State and rules

`swarm: { count, member_hp, spread_tiles }` → `UnitType.swarmCount`, `swarmMemberHp` (Fx),
`swarmSpread` (Fx); `hull.hp` must equal `count × member_hp` (schema test). **No new per-entity
array**: live members are `ceil(hp / member_hp)`, computed on read.

- **Dive.** A branch in `stepKamikaze` (same tick slot, so tick order is unchanged). Target
  scan is the kamikaze scan verbatim (`:4418-4437`: side-identified, not contained, `can_target`
  honoured). Approach is the kamikaze steer (`:4446-4458`), but terminal range is the weapon's
  own `rangeSq` (1.5 tiles), not `KAMIKAZE_STRIKE_SQ` (`tuning.ts:234`). At range, if
  `cooldown[i*2] > 0`, it holds over the target (keeps `moving = 1` on the target's tile, so it
  still counts as moving for `TARGET_MOTION_MOD`, `sim.ts:3641`). Otherwise it dives once:
  - **Soft target:** `applyDamage(target, 90)`.
  - **Armoured target:** the APS block (factored out of `resolveProjectile`, `:3876-3905`,
    unchanged, drawing from the target's stream exactly as now) and, if not intercepted, a
    penetration roll **against the arc of approach** — `resolveHit`'s arc logic (`:3935-3955`)
    factored into `armourArc(target, fromX, fromY)` and fed the swarm's position. Q2, Q3.
  - **Splash** 0.5 via `splashDirect(target pos, …, by = i, exclude = target)`.
  - **Spend:** `hp[i] = (live − 1) × member_hp`, exactly. At zero, `destroy(i, -1)`: the last
    drone was expended, nobody killed it (Q16).
  - **Cooldown:** `ceil(ticksBetweenShots × count / live_after)` — the approved "rate scales
    with live ÷ count". At rof 12 (100 ticks) that is 110 ticks after the first dive, 200 at 6 live,
    1,200 before the last; an unopposed swarm takes ~181 s to spend all 12 (**D**, Σ ceil(1200/k),
    k = 1..11).
- **Incoming damage** routes through one new helper, `damageSwarm(target, dmg, by, members)`,
  called wherever `applyDamage` would hit a swarm: `hp = max(hp − dmg, (live − members) ×
  member_hp)`. Partial damage carries (a 12-damage carbine round leaves the member wounded;
  the next one drops it), but no hit removes more members than it is allowed:
  - direct hits — `resolveHit` soft branch (`:3932`), kamikaze terminal (`:4462`), a
    beam burn (§4): `members = 1`;
  - splash — `splashAt` (`:4065`) and `splashDirect` (`:4086`): `members = ceil(live ×
    min(1, splash / spread))`, with `splash` the radius of the event.
- **No regrowth.** Field recovery is skipped for swarms (`:5126` gains `swarmCount === 0`).
  Without this a swarm that dives and is not shot regrows members to 70% of 180 hp — dives are
  not damage, so `lastDamagedTick` never blocks it. **Risk R3; a test must pin it.**
- **No rout.** `crew: 0` and `suppression_resistance 1.0` as `loiter_drone`
  (`data/units/enemy/loiter_drone.json`); the rout clause (`:5110-5118`) gains `swarmCount ===
  0`. The dive branch ignores `pinned`, like `stepKamikaze` today.
- **It is also an eye.** Sight 10, optics 1.2 feed Sarim/Rif contact like any unit
  (`stepDetection`), so a swarm cues the `rocket_battery` (range 20, sight 6). Intended (Act II:
  "kill the eyes and it goes blind"), and a playtest effect to measure (R10).

### 3.3 The finding the approved numbers do not survive: kinetic fire

E5 §8.1 says "a single-target hit removes at most one member. That is why rifles and MGs are
poor against it." **Under the current hit model that is false.** A single-member cap only blunts
high-damage single shots (sniper 260, cannon 90). Against volume it does nothing: every KDF
rifle and MG but `breach_team`'s already carries `can_target: air` (`inf_squad`, `apc_eitan`,
`mbt_lavi`'s coax, `jeep_shoded`, …), `rws_50` fires every 3 ticks (rof 380, `sim.ts:419`), and
at 4 of 9 tiles against a swarm that counts as moving its p ≈ 0.6 × 0.82 × 0.7 ≈ 0.34 (**D**,
`hitFactors` `:3609-3650`). Each hit of 40 ≥ 15 is one member: **~2.3 members/s, a full swarm in
about 5 s.** An `inf_squad` does it in about 7. Realistically, hitting a half-metre quadcopter with a rifle is a few-percent
proposition; that difficulty is the whole case for a beam.

**Proposal:** `swarm.hit_mult` (**P** 0.08), a target-side factor in `hitFactors` shown in the
`fire` breakdown as `sizeMod` (GDD §5.8: a factor the player cannot see is bad RNG). Applied
only when the target is a swarm, so every existing shot's `p` is bit-identical and no stream
moves. At 0.08 the Eitan MG needs ~65 s and a rifle squad ~90 s for a full swarm, against the
beam's 24 s (**D**; §10). Q1.

### 3.4 Counters (intended)

The beam (§4); massed MG fire as a slow second best; smoke does NOT hide ground units from a
swarm already holding contact (kamikaze targeting reads side contact, not LOS — as today);
dispersion (splash 0.5, one target per dive); APS on the Lavi (Q3); keeping the Lavi's front
toward the threat (pen 160 against Lavi rear 150 is `pPen` ≈ 0.70, side 300 ≈ 0, **D**).

## 4. The `directed_energy` weapon class and the Gachelet

### 4.1 Class

`WEAPON_CLASS.directed_energy = 12` (`sim.ts:229-242`), with a 13th entry in each per-class
table: `FALLOFF_SCALE` 65536 (unused, no roll), `APS_VEL_F` 0, `PROJ_SPEED` 0,
`STRUCT_DAMAGE` 0. Not in `APS_INTERCEPTABLE_MASK` (`tuning.ts:105`), not in `INDIRECT_MASK`
(`sim.ts:245`). `interceptor` (10) stays in place and unused; reusing it would repurpose a
schema word whose render and palette hooks (`vfx.interceptor`, `ThreeRenderer.ts:4231`) already
mean something else.

### 4.2 The beam block and state machine

`beam: { dwell_s, heat_s, cooldown_s }` on the weapon (approved 1.5 / 12 / 6 → 30 / 240 / 120
ticks). Per-unit SoA, allocated once: `beamTarget: Int32Array` (-1), `beamDwell`, `beamHeat`,
`beamCool: Int32Array`. In `stepCombat`'s slot loop (`sim.ts:3508-3532`) a `directed_energy`
slot takes its own branch instead of `selectTarget`/`fireAt`:

1. **Lockout.** If `beamCool > 0`: decrement, no target, `continue`.
2. **Lock.** If `beamTarget < 0`, `selectTarget(i, w)` (`:3155`) — the ordinary filters apply,
   including side IDENTIFIED contact and `can_target: ["air"]` (`:3176`). A held lock skips the
   O(N) scan, which is cheaper than today's per-tick reselection.
3. **Hold conditions**, every tick, any failure breaks the lock and resets `beamDwell`:
   target alive and uncontained; in range; `losRay ≥ 0` (`:2474`); **`raySmoke(...) === 0`** —
   any smoke on the line breaks the beam, even where a rifle would still fire through at the
   0.1 floor and even when another unit holds contact (Q5); the carrier not moving (Q6);
   not pinned and firepower intact (the existing `stepCombat` gates, `:3470-3490`).
4. **Burn.** `beamHeat++`; `++beamDwell >= 30` → `damageSwarm(target, 80, i, 1)` for a swarm,
   `applyDamage` for any other soft air target, a penetration roll for an armoured one (pen 5:
   `pPen` ≈ 0 against the Peten's 45 front, so it does nothing to armour). Reset `beamDwell`,
   keep the lock, emit `beamBurn`.
5. **Heat.** At `beamHeat >= 240`: `beamCool = 120`, `beamHeat = 0`, lock dropped. While not
   lasing, heat falls by `heat / cooldown` = 2 per tick (**P**), so a voluntary pause of 6 s is
   as good as a forced one (Q7).

**No RNG draw anywhere in the beam.** Dwell is the hit roll, and it is deterministic; so the
beam cannot perturb any stream. `rof_per_min` 40 in JSON equals `60 / dwell_s`; the sim ignores
it for this class (the curve reads it, `validate_balance.py:256`) and a data test pins the
equality. Collateral 0.0: it never trips `STRUCTURAL_COLLATERAL` or `HEAVY_COLLATERAL`
(`mission.ts:398-400`).

### 4.3 What it can and cannot engage (**D**)

| target | outcome |
|---|---|
| `drone_swarm` (12 × 15) | one member per 1.5 s; 8 per heat window; full swarm 24 s uninterrupted |
| `loiter_drone` (Sarim, 70 hp) | one burn, 1.5 s |
| `paramotor` (Ashwar, 130 hp) | two burns, 3.0 s |
| `heli_peten` class hulls | nothing (pen 5 vs front 45) |
| ground anything | cannot select (`can_target` air only) |
| mortar / rocket rounds | no (E5 Q12); projectiles are not entities (`PROJ_CAP`, `sim.ts:696`) |

**APS:** the beam is not a projectile and not in the interceptable mask, so APS never sees it.
**Smoke:** the one counter the enemy has to the beam; there is no weather system.

### 4.4 Legibility (GDD §5.8)

`projectHit` (`sim.ts:2696`) returns `shot` with `pHit` 1 for a beam and the UI says "burns one
drone every 1.5 s". `beamState(i)` (target, dwell 0..1, heat 0..1, cooling) is a presentation
read for the unit card. `beamBreak { shooter, reason: 'smoke' | 'los' | 'range' | 'moved' |
'heat' }` tells the player why it stopped. Per the lead's no-status-marks rule, heat goes on the
card and HUD, never over the vehicle in the world.

## 5. Schema changes

`data/schemas/unit.schema.json`:

- `demolition_method` enum `["charges","blade"]` → `+ "placed"` (`:491-496`), and top-level
  `placed_charge { fuse_s, blast_tiles, damage, suppression, withdraw_tiles }`, all required, all
  `> 0`, **required iff** `demolition_method === "placed"` (`if/then`, the shape the mission
  schema already uses for `target_minutes`).
- weapon `type` enum (`:386-399`) `+ "directed_energy"`; weapon `beam { dwell_s, heat_s,
  cooldown_s }`, **required iff** type is `directed_energy`, forbidden otherwise.
- top-level `swarm { count ≥ 2, member_hp > 0, spread_tiles > 0, hit_mult (0,1] }`; a tools
  test asserts `hull.hp === count × member_hp`, `mobility.domain === "air"` and
  `abilities ∋ "kamikaze"`.
- `packages/sim/src/sim.ts` `UnitTypeJson`/`WeaponJson` (`:137-203`) gain the same optional
  fields, parsed once in `unitTypeFromJson`/`weaponFromJson` (`:417-512`); nothing is read from
  JSON per tick.
- `data/audio.json` gains sets (§8); `data/vfx/` gains emitters (§7); `data/campaign/names.json`
  `kinds.vehicle_ids += ["demo_tzav", "aa_gachelet"]` (`aa` is not in `vehicle_roles`).
- `data/palette.json` `reserved.vfx` gains `beam` (runtime-only band) if `interceptor` #6FE0FF
  reads wrong; decided at G-MOCK, not here.

## 6. Determinism

- **The golden hash WILL move, and by construction, not by behaviour.** The new SoA
  (`stCharge*`, `beam*`) is sim state and joins `hash()` (`sim.ts:5148-5195`); hashing four
  arrays of zeros still changes the mix. The golden roster has no placed, swarm or beam unit,
  so its trajectory is untouched. Re-pin `2109596329` once, in the task that adds the arrays,
  with that reason, and prove "no behaviour change" in the same commit: `pnpm balance`,
  `pnpm playtest` and the E5 probes byte-identical.
- The refactors (`armourArc`, the APS block helper) are pure extractions; the `hit_mult` factor
  multiplies only when the target is a swarm. Each lands with `pnpm test:determinism` green.
- Everything is Q16.16 and integer: member arithmetic, `ceil(tbs × count / live)` in integer
  division with a +live−1 bias, heat counters in ticks. No `Math.*`.
- Owner `sim-guard`, one stream, one determinism review (E5 §8.4).

## 7. Render and VFX (three only; Pixi owes no parity)

- **Swarm:** one `InstancedMesh` per swarm type, `count = Σ live members`, member offsets
  inside `spread_tiles` from a hash of (entity id, member index) and a frame-clock bob —
  presentation only, never the sim RNG. Lift as other air units, shadow below. A member lost
  bursts through a new `data/vfx/swarm_member_down.json` (palette keys only). HP bar as today.
  `SPRITE_MAP` (`packages/app/src/main.ts:662`) gets a `DRONE_SWARM/` billboard (a five-drone
  cluster) so `?renderer=pixi` and `&nomesh` draw something; without it the unit is invisible
  there and no gate catches it (CLAUDE.md "Art existing is not art drawing").
- **Beam:** a `BeamBatch` — a thin additive-core line from the turret lens to the target at
  `FX_RENDER_ORDER` 2 (`units/render-order.ts`), `depthTest` ON like the bolt (the beam needs
  LOS, so anything in front should hide it), plus a heat shimmer at the target, the first
  consumer of the schema's `heat_shimmer` (read by nothing until now, CLAUDE.md). Driven per
  frame from `beamState`, not from events, so a 30-tick dwell is not 30 tracers.
  `shellKindFor` (`units/shells.ts:334-347`) returns null for class 12 and the `fire` handler
  (`ThreeRenderer.ts:4231`) must skip the flat tracer for it.
- **Shiryonan:** the charge is a physical crate prop at `(x, y)` from `chargeSet`, with a
  blinking fuse light on the crate — no floating timer. Detonation reuses
  `spawnCollapseFx('structure_collapse', …)` (`ThreeRenderer.ts:4198`) plus a ground blast from
  the art-blast work (`docs/superpowers/specs/2026-09-19-art-blast-design.md`) sized to 2.5
  tiles.
- **Gates:** the visual gate's toggles are unaffected (no new always-on layer). A mission-
  scenario golden capture is not added: `combat` is already report-only for being unstable.

## 8. Audio

`audio.ts` maps `fire` by weapon class (`packages/render/src/audio.ts:1105-1111`) and other
events by kind; both backends share it. New sets in `data/audio.json`, each with a synth
fallback so they may ship with zero variants, as `ui_alert` does:

| set | event | why a new set |
|---|---|---|
| `beam_burn` | `beamBurn` | a burn is not a `fire`; mapping class 12 into `tank_gun` would be absurd |
| `swarm_dive` | `impact`/`destroyed` from a swarm shooter | a dive is `heat`, which today plays `tank_gun` |
| `charge_set` | `chargeSet` | a short click and tone |
| `charge_blast` | `chargeDetonated` | a large blast, distinct from `destroyed` |

A swarm drone buzz is a loop and the engine has only one-shots; deferred (Q15). Sources follow
CLAUDE.md: no paid packs, provenance in `docs/ASSET_PROVENANCE.md`.

## 9. Mission integration (gate G-MISSION)

Lead: "Sur's standoff and Naharin's corridor", or the beam is dead content (E5 §8.3). Both
missions below have `resources`, so a Gachelet can be built there; the six recon missions cannot
(E5 G6).

| front | mission | today | E6 change (**P**) |
|---|---|---|---|
| Sur (Sarim) | `umm_zeitoun_2_buildup` | waves 90/180/**210 `loiter_drone` → `camp_ground`**/300; primaries `hold_for` + `raze`; logistics 500 + 150/min | the 210 s `loiter_drone` becomes one `drone_swarm` to `camp_ground`; a `tag` so a trigger can name it |
| Naharin (Rif) | `wadi_halam_3_counterraid` | waves 90 (2 `technical`), 200 (2 `moto_rpg` + `technical`) → `pump_house`; the only build-up in Act III | a `drone_swarm` joins the 200 s wave, `from` its own marker — Hallaq's smuggled drones |

Why not `wadi_halam_5_depot`: it is the Shiryonan's `(bought)` probe mission, and two new
mechanics in one mission's playtest cannot be told apart. Why not both Umm Zeitoun waves: one
swarm per front first, measured, then more.

**Pipeline** (CLAUDE.md): `level-scripter` writes the wave rows and a trigger id the player
can read (`enemy reacts (<id>)` is shown verbatim), `narrative-designer` a briefing line per
mission, `mission-author` the JSON, `playtest` the ladder. Knock-ons: plans in
`tools/src/backtest/playtest.ts` that meet a swarm must still win; `LADDER_CREDITS` (`:3063`,
5,849) is re-pinned with the per-mission deltas explained in the comment above it, as every
previous re-pin was; `GATES` (`:2864-2868`) is re-checked; `CONDUCT_GATES` (`:2927-2937`)
gains `{ unit: 'aa_gachelet', roeMin: 85, opensAfter: 1 }` (every Conduct floor opens after
mission 1 on the optimal ladder, `:2897-2916`). `target_minutes` stays inside 5–7.

## 10. Balance: G-NUM placeholders for `balance-analyst`

Approved and not reopened: Shiryonan (charge 3.0 s set, fuse 8, blast 2.5, dmg 300, supp 120,
withdraw 4), swarm (12 × 15, speed 2.6, sight 10, sig 0.6, `bomblet_dive` heat pen 160 dmg 90
splash 0.5 rof 12 range 1.5, 240 logistics), Gachelet (hp 1,100, range 9, dmg 80, dwell 1.5,
heat 12, cooldown 6, 350 logistics, pop 2, Conduct 85 or 470 cr).

| # | number | value | kind | where |
|---|---|---|---|---|
| N1 | `swarm.spread_tiles` | 1.5 | P | splash thinning, render spread |
| N2 | `swarm.hit_mult` | 0.08 | P | §3.3; the MG-vs-beam ratio hangs on it |
| N3 | dive terminal range | weapon `range_tiles` 1.5 | P | not `KAMIKAZE_STRIKE_SQ` 1.22 |
| N4 | dive cadence | 5.5 s after the first → 60 s before the last; 181 s to spend 12 | D | `ceil(tbs × count / live)` |
| N5 | dive arc | approach bearing | P | Q2 |
| N6 | dive meets APS | yes | P | Q3; Lavi `base_pk` 0.75 × heat 0.75 = 0.56 |
| N7 | beam smoke threshold | any smoke (`> 0`) | P | Q5 |
| N8 | beam needs a halted carrier | yes | P | Q6 |
| N9 | beam idle cooling | 2 heat-ticks per tick | P | Q7 |
| N10 | beam kill time, full swarm | 24 s | D | 8 in 12 s, 6 s lock, 4 in 6 s |
| N11 | MG / rifle full-swarm kill time at N2 | ~65 s / ~90 s | D | `rws_50` / `inf_squad`, 4 tiles |
| N12 | Shiryonan escape | ~4 s of 8 s fuse | D | movement does not wait for the turn |
| N13 | blast centre | charge point, not centroid | P | §2.1 |
| N14 | swarm dive vs Gachelet | 65% per penetrating dive to lose the beam (cat 38 + fp 15 + both 12) | D | overmatch z ≈ 6.3 → shift 30 (`tuning.ts:77-78`) |

**Probes** (`tools/src/backtest/e6-probes.ts`, bands frozen at G-NUM like E5's):
- **Shiryonan** vs `dozer_d9` and `demo_squad` on a defended house (moved from E5): time
  exposed, carrier survival, and own-side soft casualties inside 2.5 tiles.
- **`(bought)` playtest probe** on `wadi_halam_5_depot`.
- **New §5.7 target, `airDefence`** in `tools/src/backtest/targets.ts` beside `airContested`
  (`:347`): one swarm dives on a halted KDF group (`inf_squad` + `apc_eitan`) in four arms —
  no AA fire, MG only, Gachelet, Gachelet with a smoke screen laid across its line. Claims
  (**P**): members spent on the group — Gachelet < MG < none; the smoke arm reverts to within
  the MG arm; the Gachelet arm kills the swarm before it spends half its members in ≥ 80% of
  seeds. **A lone Gachelet is measured and not claimed**: by N14 a swarm diving on it knocks the
  beam out ~96% of the time in three dives (**D**). Doctrine says escort it; the claim sits on
  the escorted arm (Q4).

## 11. Art and the Meshy estimate

Meshy policy: announce each call with a credit and dollar estimate first; Meshy for bases,
Blender for the rest.

| asset | source | credits | notes |
|---|---|---|---|
| swarm drone | Meshy preview, E5 §8.4 prompt | 25 | palette mesh, instanced; ≤ 300 tris target |
| Gachelet beam carrier | Meshy preview, E5 §8.4 prompt | 25 | palette vehicle; IoU neighbours `apc_eitan`, `gun_truck`, `jeep_shoded` |
| Shiryonan GLB + `TZAV_HULL/` | E5's Meshy base and `.blend` | 0 new | E5 budget; E6 exports |
| charge crate prop | Blender, from the Shiryonan's own crate part | 0 | decor-class mesh |
| `DRONE_SWARM/` billboard | Blender, `tools/render_drone.py` pattern | 0 | Pixi and `&nomesh` |
| icons, portraits | GH-153 pipeline | 0 | |

**Planned 50 credits, ceiling 100 (one retry each), ≈ $1.00 / $2.00** at E5's rate (140 cr ≈
$2.80). Then wrecks (`pnpm wreck:meshes`), `pnpm validate:meshes` (IoU ≥ 0.88 is the named risk
for the Gachelet against `apc_eitan`), provenance, and AI disclosure in the PR.

## 12. Phasing (Stage 4)

| task | owner | content | done when |
|---|---|---|---|
| T1 | sim-guard | class 12 in every per-class table; schema enums and blocks; new events and `SIM_EVENT_KINDS`; the SoA and `hash()` additions; `armourArc` and APS-helper extractions | golden re-pinned once with its reason; balance, playtest and E5 probes byte-identical |
| T2 | sim-guard | G1 (§2) + tests: order-only, fuse outlives carrier, blast hits own and civilians, carrier exempt, no tunnel effect, withdraw | `pnpm test` green |
| T3 | sim-guard | swarm (§3) + tests: member cap, splash thinning, no regrowth, no rout, dive cadence, `hit_mult` factor | as T2 |
| T4 | sim-guard | beam (§4) + tests: dwell resets on each break reason, heat lockout, zero RNG draws | as T2 |
| T5 | balance-analyst | `e6-probes.ts`, `airDefence` target; **G-NUM** to the lead | bands frozen |
| T6 | blender-art | §11, after the announced Meshy call | `validate:meshes`, `validate:assets` green |
| T7 | render-vfx | §7 and §8 | walked in the browser on `?sandbox=umm_zeitoun&sur` |
| T8 | level-scripter → mission-author → playtest | §9; `LADDER_CREDITS`, `GATES`, `CONDUCT_GATES`; **G-MISSION** | `pnpm playtest` exits 0 |
| T9 | — | land `demo_tzav` (closes #156), `drone_swarm`, `aa_gachelet`; `SPRITE_MAP`, mesh catalogue, `names.json`; sandbox flag table (`&sur` gains the swarm); CLAUDE.md and HANDOVER | PR open, lead merges |

T2–T4 are independent after T1 and may run in parallel worktrees; T8 needs T3–T5.

## 13. Risks

- **R1 — kinetic fire trivialises the swarm** without N2 (§3.3). The approved design's claim is
  false in the current model; the fix is one factor, but it is a new number.
- **R2 — the swarm eats its own counter** (N14). A lone Gachelet loses. Acceptable only if the
  missions and the briefing teach escorting; otherwise the Gachelet's armour is the lever.
- **R3 — regeneration resurrects drones** (`sim.ts:5124-5131`) unless excluded.
- **R4 — the hash moves** on the new arrays, by construction; it must be said in the commit, and
  "no behaviour change" proved, or the next reader will suspect a regression.
- **R5 — ground splash reaches air** (no altitude): a mortar round landing under a swarm thins it
  through N1. Unrealistic but pre-existing for every air unit (Q14).
- **R6 — friendly kills credit the killer** (`mission.ts:1024-1027`): a Shiryonan that kills its
  own escort earns kills and `contributed`.
- **R7 — the carrier cannot be hurt by its own blast** (`splashDirect` skips `by`, `:4089`),
  including when it failed to withdraw.
- **R8 — the kamikaze path still ignores APS and always uses side armour** (`:4465-4488`). E6
  fixes neither for `loiter_drone`/`attack_drone`; doing so moves shipped outcomes and belongs
  in its own change.
- **R9 — invisible unit.** A missing `SPRITE_MAP`/instancer entry draws nothing and no gate says
  so.
- **R10 — the swarm spots for the battery**, which may shift Umm Zeitoun II's timing in ways the
  scripted plan hides; `playtest` must read the ladder, not only VICTORY.
- **R11 — names.** "Gachelet" and "Drone Swarm" have not been through the storyline §2.4 rule-3
  screen that renamed the Zikit and the Tzav (`numbers.md`, names screen).

## 14. Open questions (each with a recommended default)

1. **Add `swarm.hit_mult` (N2)?** Default: yes, 0.08, shown as `sizeMod` in the hit breakdown.
2. **Which armour does a dive meet?** Default: the arc of approach (`resolveHit`'s rule), not
   the kamikaze's fixed side and not `top` (read by nothing today; pen 160 vs Lavi top 80 would
   make every swarm a tank killer).
3. **Do dives meet APS?** Default: yes, through the existing block — the swarm is the
   saturation attack GDD §5.6 names as APS's counter.
4. **Lone Gachelet vs swarm (R2)?** Default: keep the approved numbers; claim on the escorted
   arm; the briefing line says "keep the Gachelet behind the line".
5. **Beam smoke threshold?** Default: any smoke on the line breaks the beam.
6. **Must the carrier be halted to lase?** Default: yes; moving resets dwell.
7. **Heat when idle?** Default: cools at `heat_s / cooldown_s` per tick; lockout only at full.
8. **Beam against non-swarm air?** Default: yes, anything `can_target: air` allows; pen 5 means
   armour ignores it.
9. **Charge on a building already destroyed before the fuse ends?** Default: the crate still
   blows (units only).
10. **Charge versus tunnels?** Default: no effect in v1; buried units are immune.
11. **Blast damage to neighbouring structures?** Default: none in v1.
12. **Can anything defuse a set charge, and may own troops garrison a charged building?**
    Default: no defusal; own side refuses to enter, the enemy does not know.
13. **"Danger close" ROE deduction for the blast near civilians?** Default: no; the casualty
    penalty already bills it.
14. **Should ground splash stop reaching air units (R5)?** Default: not in E6; record it.
15. **A looping swarm buzz?** Default: deferred; one-shot `swarm_dive` only.
16. **Who is credited when the last drone dives?** Default: nobody (`destroy(i, -1)`).
17. **One `drone_swarm` for both fronts?** Default: one JSON, `faction: "sarim"`, placed by Rif
    missions too (nothing enforces a mission's faction against its units).
18. **Which missions?** Default: `umm_zeitoun_2_buildup` (replacing the 210 s loiter drone) and
    `wadi_halam_3_counterraid` (joining the 200 s wave).
19. **Names.** Default: `narrative-designer` runs the rule-3 screen on "Gachelet" and "Drone
    Swarm" before any JSON ships.
