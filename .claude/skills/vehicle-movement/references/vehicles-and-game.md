# Real vehicles, what reads at RTS scale, and what Roaring Lions does today

Reference notes for Roaring Lions developers (sections 5 and 6 of the brief, plus the game
comparison and the gaps). Companion files: `dynamics.md` (physics) and `tactics.md`
(doctrine). Source tags `[n]` refer to this file's list. **(estimate)** marks anything
unsourced. **(heuristic)** marks craft advice that is not physics.

## Contents

5. [Real vehicles for calibration](#5-real-vehicles-for-calibration)
   - 5.1 [The table](#51-the-table)
   - 5.2 [Where sources disagree](#52-where-sources-disagree)
6. [What reads at RTS scale](#6-what-reads-at-rts-scale)
   - 6.1 [Pixels per metre in this game](#61-pixels-per-metre-in-this-game)
   - 6.2 [Motion by motion: visible or not](#62-motion-by-motion-visible-or-not)
   - 6.3 [Craft heuristics from game-dev and animation sources](#63-craft-heuristics-from-game-dev-and-animation-sources)
7. [The game today](#7-the-game-today)
   - 7.1 [Units: tiles, ticks, levels](#71-units-tiles-ticks-levels)
   - 7.2 [What the sim does](#72-what-the-sim-does)
   - 7.3 [What the renderer does](#73-what-the-renderer-does)
   - 7.4 [Game numbers against real ones](#74-game-numbers-against-real-ones)
8. [Gaps, ranked by visual and gameplay impact](#8-gaps-ranked-by-visual-and-gameplay-impact)
9. [Sources](#9-sources)

---

## 5. Real vehicles for calibration

### 5.1 The table

"n/s" means no public source was found. The M1A1 and K2 rows are included because they are
the only tanks with a published 0-32 km/h time. The Stryker row stands in for the Eitan's
missing mobility data.

| Vehicle | Mass (t) | Power | hp/t | Road / cross-country (km/h) | 0-32 km/h | Turning | Gradient / side slope | Trench / step | Fording | Sources |
|---|---|---|---|---|---|---|---|---|---|---|
| **Merkava Mk 4** (MBT, tracked) | 65 | 1,501 hp, MTU 12V883 diesel | 23.1 | 64 / 55 | n/s; **about 8.8 s (estimate**, scaled from the K2 by hp/t) | Neutral steer; rate n/s, **15-40°/s (estimate)** | **60 % / 30 % (estimate**, class norm) | 3.5 m / 1.0 m (table likely for the Mk 3) | 1.4 m (same table) | [1], [2], [3] |
| **Namer** (heavy APC, Merkava 4 chassis) | 60-63.5 (one outlier says 50) | 1,200 hp, AVDS-1790-9AR | ~19-20 | **60** (85.2 per Wikipedia, doubtful, see 5.2) / n/s | **about 10.5 s (estimate)** | Neutral steer (estimate, shared chassis) | n/s (estimate as Merkava) | n/s | n/s | [4], [5], [6] |
| **Eitan** (8x8 APC) | 30-35 (infobox "up to 50") | 750 PS, MTU 6V890 | 21-25 at 30-35 t | 90 / n/s | n/s | Wheeled: no pivot. Turning diameter n/s; **about 16 m (estimate**, Stryker class) | n/s; **60 % / 30 % (estimate**, Stryker class) | n/s; **about 2.0 m / 0.6 m (estimate**, Stryker) | n/s | [7], [8] |
| *Stryker ICV (8x8, reference)* | ~17-19 (n/s here) | n/s | n/s | ~97 (60 mph) / n/s | n/s | **16 m turning diameter** | 60 % / 30 % | 2.0 m / 0.58 m | n/s | [9] |
| **M113** (IDF "Zelda" with ERA) | 12.3 base; Zelda heavier (n/s) | 275 hp, 6V53T | 22.4 (base) | 67.6 road; 5.8 swim / n/s | n/s | Pivots; clutch-brake laterals (a yoke on the A3) | 60 % / n/s | 1.7 m / 0.6 m | Amphibious as built; heavier A2 and later not required to swim. **IDF armoured Zelda: assume not amphibious (estimate)** | [10] |
| **D9R armoured dozer** ("Doobi") | ~49 base + ~15 armour ≈ 64; kit reviews say 65-70 loaded | 405-410 hp (flywheel) | **about 6.4** | 11.7 forward / 14.6 **reverse** | n/a | D9R clutch-brake: pivots on a braked track. D9T: differential steer | n/s | n/s | n/s | [11], [12] |
| **HMMWV M1151** | 3.40 curb (A1 3.70; with B1 kit 4.67); GVW 5.49 | 190 hp, 6.5 L turbo-diesel | 56 curb; 35 at GVW | 113 / n/s | n/s | 7.62 m (25 ft) turning radius | 40 % / 30 % (at GCW) | n/s / 0.30 m | 0.76 m; 1.52 m with kit | [13] |
| **Technical** (Hilux 2.8 GD-6 double cab) | 2.04-2.34 kerb; about +1 t payload | 150 kW (204 PS) | ~90 PS/t kerb; ~60-65 loaded (estimate) | 175 / n/s | n/s | 6.4 m radius (tyres); 13.4 m circle | n/s | n/s | 0.70 m wading | [14], [15], [16] |
| *M1A1 Abrams (reference)* | 57.2 (63 short tons) | 1,500 shp turbine | 26.2 (23.8 hp/short ton) | 67-72 governed / 40-48 | **7.2 s** (M1: 7.0 s) | Neutral steer | 60 % / 40 % | 2.74 m / 1.07 m (M1: 1.24 m) | n/s | [17], [18] |
| *K2 Black Panther (reference)* | ~55 | 1,500 hp, MT883 | 27.3 | 70 / 50 | **7.47 s** (DV27K: 8.77 s) | Neutral steer; ISU can kneel and lean | 60 % / n/s | n/s / 1.3 m | 4.1 m with snorkel | [19] |

**Two calibration numbers worth memorising:** a heavy tank takes about 7-9 s to reach 32 km/h,
and turns its turret at about 30-40°/s.

### 5.2 Where sources disagree

- **Namer top speed: 60 vs 85.2 km/h.** Army Recognition and Tankhistoria say 60 km/h [5],
  [6]. Wikipedia's infobox says 85.2 km/h [4]. The Namer carries a weaker engine (1,200 hp)
  than the Merkava 4 (1,501 hp) at a similar mass. The Merkava's road speed is 64 km/h [1].
  **Use 60 km/h**: 85 km/h is physically implausible for this chassis.
- **Namer mass: 50 / 60 / 63.5 t.** The 50 t figure (Army Recognition [5]) is an outlier
  against 60 t (Wikipedia text) and 63.5 t (Wikipedia infobox) [4]. **Use 60-63.5 t.**
- **Eitan mass: 30-35 vs "up to 50" t.** Army Recognition gives 30,000-35,000 kg [7]. The
  Wikipedia overview says "less than 35 tons", but its infobox says "up to 50 tonnes" [8].
  The higher figure probably covers heavier IFV variants (estimate). **Use 35 t for the
  APC.**
- **Eitan engine: 750 PS vs 712 hp.** Wikipedia gives 750 PS (552 kW) for the MTU 6V890 [8].
  One mirror gives an MTU 8V199 at 712 hp (search snippet [7b]). Same order; **use 750 PS.**
- **Merkava 4 obstacle data.** GlobalSecurity's table gives a 1 m step, 3.5 m ditch and
  1.4 m ford [3]. The same table also gives 1,200 hp and 55 km/h, which are Mk 3 numbers, so
  the obstacle figures may also be the Mk 3's. **Use them as approximate.** Merkava 4
  gradient and side slope are not published anywhere found. 60 % / 30 % is the class norm
  (M60A3 spec, M1, M113, K2 and Stryker are all 60 %).
- **M1 cross-country: 40 vs 48 km/h.** Wikipedia gives 25 mph [17]; FAS gives 30 mph for the
  M1 [18]. Different variants and test conditions.
- **D9 weights.** Wikipedia's intro says 49 short tons (44 t) and its infobox 48,988 kg [11].
  The armour adds "roughly 15 additional tonnes" [12]. Model-kit reviews claim 65-70 t loaded
  [12b]. **Use about 62-65 t armoured.**

---

## 6. What reads at RTS scale

### 6.1 Pixels per metre in this game

The renderer uses its own conversion. Screen pixels are about `tiles × TILE_H × zoom`, with
`TILE_H` = 32 px (`project.ts`, used the same way in `vehicle-weight-params.ts`). One tile
is 3 m. Zoom runs from 0.35 to 2.5 (`camera-input.ts`).

| Zoom | px per metre | A 7.6 m Merkava hull |
|---|---|---|
| 0.35 (farthest) | 3.7 | 28 px |
| 1.0 | 10.7 | 81 px |
| 2.5 (closest) | 26.7 | 203 px |

Below about 1 px of displacement a motion is invisible, and below about 2-3 px it is
marginal (heuristic).

### 6.2 Motion by motion: visible or not

Displacements use the real magnitudes from `dynamics.md`.

| Motion | Real size | px at zoom 1 / 2.5 | Verdict |
|---|---|---|---|
| Hull yaw (pivot, turning) | Ends of a 7.6 m hull sweep metres | tens of px | **Reads strongly.** Pivot against a moving turn is obvious from the path shape |
| Turret slew | 5 m barrel tip sweeps metres | tens of px | **Reads strongly**; slew speed is legible |
| Speed change (launch, stop) | 0-30 km/h over seconds | position | **Reads.** Players see a vehicle "lunge" or "creep" |
| Reversing (hull keeps facing) | whole vehicle | position | **Reads strongly**, and players read facing as armour (CoH community [27]) |
| Dust plume / rooster tail | metres tall and long | tens of px | **Reads strongly**: the best cue for speed, heading and pivot |
| Track marks / ruts | 0.6 m wide tracks, metres long | 6-16 px wide | **Reads**, and records history (path, pivots) |
| Recoil rock | 3.4° in the game | several px | Reads (already in the game) |
| Nose dip on a hard stop, 1-2.5° | ±6-17 cm at the nose of a 7.6 m hull | 0.7-1.8 / 1.8-4.5 | **Marginal**; visible only zoomed in. Shading change on the side-lit hull may read more than the movement (heuristic) |
| Squat on launch, 0.1-0.6° | ±1-4 cm | <0.5 / ~1 | **Invisible** at true size |
| Roll in a turn, ~1.5° | ±5 cm at the hull edge | 0.5 / 1.3 | **Invisible to marginal** |
| Body bounce, 1-2.5 Hz, a few cm | ±2-5 cm | 0.2-0.5 / 0.5-1.3 | **Invisible** |
| Road wheels following terrain, ±0.3 m travel | under skirts on the Merkava | hidden | **Invisible**; visible only on unskirted wheeled vehicles at close zoom |
| Track sag and slap | cm | <1 | **Invisible** |
| Antenna whip, tip ±0.2-0.4 m (estimate) | thin line | 2-4 / 5-10 but 1 px wide | **Marginal**: a flicker at close zoom; cheap secondary action |
| Wheel spin and tread scroll | texture motion | | Visible at close zoom only (already in the game) |
| Stabilised barrel holding level while the hull pitches | barrel angle vs hull | ~1-4 px at the tip | Marginal at true size, but the *relationship* (barrel still, hull moving) reads when exaggerated (heuristic) |

**Summary.**

- **Readable at any zoom:** heading, speed changes, pivot against arc, reversing, dust,
  marks, and turret direction.
- **Close-zoom flavour only:** suspension and body motion of 1-3°, antennas and wheels.
- Spend effort in that order.

### 6.3 Craft heuristics from game-dev and animation sources

All of these are **heuristics**, not physics.

1. **Exaggerate what is below the visibility floor, and only that** (Disney "exaggeration"
   [20]). A real 1° dive is 0.7 px; drawing 2-3° buys visibility. Keep restraint: the
   principle itself warns against overwhelming the viewer [20]. The game's 2° MBT pitch is
   already about 1.5-4× real for braking, and about 4-10× real for the launch squat (see
   `dynamics.md` 1.3).
2. **Slow in, slow out; anticipation; follow-through** [20].
   - Starts and stops ease.
   - A pivot can be preceded by a brief halt: anticipation.
   - After a stop, the nose dips, passes level once and settles. The antenna keeps going
     after the hull settles: follow-through and overlapping action.
3. **Secondary action only if it does not compete with the primary** [20]. Antenna whip and
   track sag are secondary; dust and heading are primary.
4. **Model acceleration and turning on heavy units; slow down for sharp turns.** Pottinger
   (Ensemble, *Age of Empires*): "The movement of large ships and heavily armored units has a
   lot more realism" when acceleration and deceleration are modelled. Most pathfinders ignore
   turn radius, and "most systems overcome this deficiency by slowing the unit down to make a
   sharp turn" [21]. He also says unit movement "work[s] much better with nice, consistent
   simulation intervals" [21], which the 20 Hz sim already provides.
5. **Keep steering and locomotion separate** (Reynolds, GDC 1999). The **steering** layer
   turns goals into a desired motion. The **locomotion** layer "converts steering control
   signals into actual motion, subject to the body's physical limits", so the locomotion can
   be swapped (horse or motorcycle) without changing the steering [22]. This maps onto the
   repository's split: flow field and steering in the sim, and the weight model and running
   gear in the renderer. Turn-rate and reverse rules belong in the sim's locomotion step
   (gaps 1-2 below).
6. **Flow fields plus local steering scale to big battles, and vehicles need their own
   constraints on top** (Emerson, *Supreme Commander 2*, *Game AI Pro* ch. 23 [23]). The
   chapter discusses tanks, hovercraft and large experimental units as separate movement
   classes.
7. **Design silhouettes for the actual camera angle** (Samwise Didier on *StarCraft II*: all
   art is viewed in the top-down three-quarter view, so silhouettes were designed for that
   angle [24]). In motion terms: a pivot, a reversal and the turret direction are
   silhouette-level changes. Bounce is not.
8. **Players read and use facing.** In *Company of Heroes*, players reverse vehicles to keep
   frontal armour toward the enemy. Community guides say "shift reverse so unit won't turn
   around" [25]. A third-party patch summary reports that *CoH 3* 1.1.4 raised the
   auto-reverse distance for a right-click behind a vehicle from 20 to 60 [26] (search
   snippet, not verified from Relic's notes). Players complained when a click behind a tank
   made it pivot and show its rear [27]. This is **community-reported**, not developer
   documentation.
9. **No status marks in the world** (the lead's standing ruling; `CLAUDE.md` and memory).
   Communicate motion state through the motion itself (dust, marks, pivots, posture), not
   through overlays.

---

## 7. The game today

Read from `main` in `/Users/ilpinto/dev/roaring-lions`, read-only.

### 7.1 Units: tiles, ticks, levels

- **1 tile = 3 m.** `MESH_UNITS_PER_TILE = 3.0` (`packages/render/src/three/units/mesh-anim.ts`).
  `tunnel-xray.ts` says "1 tile = 1 wu = 3 m", and `docs/agent-notes/mesh-units.md` says
  "One tile is 3 m".
- **1 sim tick = 50 ms (20 Hz)** (invariant 1; `TICKS_PER_SECOND = 20` in `formation-template.ts`).
  The renderer interpolates at the frame rate. One tick is 1/20 s of real time: the game does
  not compress time.
- **1 elevation level = 0.766 m.** `WORLD_PER_LEVEL = ELEV_STEP × WORLD_Y_PER_LIFT_PIXEL`
  = 10 × (√2 × tan 30°) / 32 = 0.255 wu. `BLOCK_RISE` = 2 levels (1.53 m).
- **Speeds:** 1 tile/s = 3 m/s = 10.8 km/h. **Turn rates:** degrees per second, real time.
- **Ranges are compressed, sizes are not.** The Lavi gun reaches 12 tiles (36 m), against
  2,500 m planning range in reality. The hull is about 2 tiles long. Maps are 48, 80 or 96
  tiles square (144-288 m).

### 7.2 What the sim does

`packages/sim/src/sim.ts`, `tuning.ts`, `formation.ts`, `flowfield.ts`, `data/units/**`.

- **Constant speed, no acceleration.** `stepMovement` moves a moving unit by exactly
  `stepPerTick` and snaps onto the goal. `mobility.accel_tiles_s2` and `mobility.terrain` (speed
  multipliers) exist in `unit.schema.json`, but **nothing reads them** (grep finds them only in
  the schema).
- **Turning.** `turnToward` rotates `facing` by at most `turn_rate_deg_s` per second. **The
  hull follows the line of march and translation is not gated by heading.** The unit moves a
  full step while the hull is still coming round. The running-gear header says a Lavi
  reversing its route "slides backwards for three seconds".
- **No reverse gear.** Every turreted vehicle turns its hull to the direction of travel. Only
  `bodyAimed` units (soft and isotropic, no turret) may face off the line of march, by up to
  `AIM_OFF_HEADING_MAX` (45°). Facing is mechanical: `resolveHit` picks the armour arc from
  it.
- **Turret abstracted.** Under a move order, turreted vehicles keep the hull on the march and
  "let the gun traverse" (`aimHullAt`). There is no traverse time in the sim.
- **Moving fire.** `MOVING_STANCE_MOD` 0.55 applies to any moving shooter, and
  `TARGET_MOTION_MOD` 0.7 to a moving target. There is no per-weapon stabilisation.
- **Slope.** Pathing charges `UPHILL_PER_LEVEL` (10) per level climbed and descending is
  free. **Speed does not change on a slope.**
- **Terrain.** `b` boulders, `d` ditch and `~` marsh are walls to wheeled and tracked vehicles
  (`mobility.wheeled`). `^` is impassable. There is no soft-soil, mud or speed-by-ground model.
- **Formations.** Column, Attack and Ambush (`data/formations/*.json`). `VEHICLE_SPACING` is
  2 tiles. Armour ranks are 3 deep. The march uses 8-tile checkpoints. The contact drills are
  `halt`, `press` and `spring`. Column pace is `slowest_ground`; Attack has no pace. There is
  no bounding overwatch.
- **Mobility kills.** `gear: tracks | wheels`: wheels slow at the first hit and stick at the
  second.
- **No hull-down concept.** No grep hits for hull-down, turret-down or reverse slope in the
  sim or GDD. Elevation affects line of sight only.

### 7.3 What the renderer does

`packages/render/src/three/units/`. All presentation-only, on the frame clock.

- **Terrain conform** (`vehicle-weight.ts`, `vehicle-conform.ts`). Pitch and roll come from the
  ground sampled under the four hull corners: `atan(Δh / span)`, using spans measured from the
  GLB. It is exactly 0 on flat ground.
- **Dynamic weight** (`vehicle-weight.ts`, `vehicle-weight-params.ts`):
  - an invented speed ramp (`accelSeconds`) that drives the squat and dive;
  - a damped settle spring (`settleSeconds`, damping ≥ 0.5);
  - roll from the smoothed yaw rate;
  - a positional lag of at most 0.09 tiles.
  - Role defaults. **MBT:** 2.0° pitch, 1.5° roll, 0.35 s ramp, 0.5 s settle, damping 0.6.
    **APC:** 1.2°, 1.1°, 0.22 s, 0.35 s. **Technical:** 1.0°, 1.6°, 0.15 s, 0.3 s.
  - Launch and brake are symmetric: the ramp runs at ±`cruise / accelSeconds`.
- **Running gear** (`running-gear.ts`). Wheels spin, and the front wheels steer by the bicycle
  model (≤ 20°, faded below 0.5 m/s). Tracks scroll by signed speed and counter-rotate on the
  spot, wheeled vehicles included.
- **Turret** (`frame-state.ts`). A damped spring (`TURRET_STIFFNESS` 90, `TURRET_DAMPING` 13)
  points it at the target and returns it to the hull heading. **There is no rate cap.** A step
  response computed here peaks at about **815°/s for a 180° slew** (407°/s for 90°) and reaches
  90 % in 0.27 s, against a real 30-40°/s. Recoil adds a 3.44° hull rock and a 0.11-tile turret
  kick.
- **Dust and exhaust** (`vehicle-fx.ts`). Dust scales with speed and surges on a launch. It
  is emitted at the rear. **There is no dust when pivoting on the spot**: the dust magnitude
  is a function of translation speed.
- **Track marks** (`ThreeRenderer.ts`, `vehicle-tracks.ts`). Tread and tyre decals are stamped
  every 0.5 tiles of **translation**, on the sim clock. A pivot on the spot leaves no mark.
- **No antenna whip, no track sag, no stabilised-barrel behaviour** (none found by grep).

### 7.4 Game numbers against real ones

Implied radius = speed ÷ turn rate. "Real" values are from 5.1.

| Unit | Game speed | = km/h | Real analogue (cross-country or road) | Game / real | Game turn rate | Implied radius | Real minimum radius / pivot |
|---|---|---|---|---|---|---|---|
| `mbt_lavi` | 1.1 t/s | 11.9 | Merkava 4: 55 CC | 0.22 | 60°/s | 3.2 m (1.1 tiles) | Pivot, ~15-40°/s (est.) |
| `ifv_namer` | 1.3 | 14.0 | Namer: 60 road | 0.23 | 75°/s | 3.0 m | Pivot (est.) |
| `apc_eitan` | 1.8 | 19.4 | Eitan: 90 road | 0.22 | 90°/s | 3.4 m | ~8 m radius (est., Stryker 16 m diameter); **no pivot** |
| `jeep_shoded` | 2.9 | 31.3 | HMMWV: 113 road | 0.28 | 160°/s | 3.1 m | 7.62 m; **no pivot** |
| `technical` | 2.6 | 28.1 | Hilux: 175 road | 0.16 | 120°/s | 3.7 m | 6.4 m; **no pivot** |
| `dozer_d9` | 0.6 | 6.5 | D9: 11.7 forward | 0.55 | 45°/s | 2.3 m | Pivot on a braked track |
| Infantry (reference) | 0.9 | 9.7 | A running soldier | about 1 | n/a | n/a | n/a |

**What the table shows.**

- **Vehicles run at 16-28 % of real speed, infantry at about real speed, and the D9 at 55 %.**
  This is an RTS compression choice and not a defect. Inside it, the D9 is relatively fast.
- **Every vehicle has an implied turning radius of about one tile (2.3-3.7 m).** That
  matches the flow field's tile and octant resolution, but it is **2-2.5 times tighter than
  any real wheeled vehicle**. The sim also lets **wheeled vehicles rotate at zero speed**,
  which they physically cannot do.
- **Tracked turn rates (60-75°/s) are about 2-4 times a plausible real pivot rate.** In-place
  turns are always allowed.
- **Real acceleration** is about 1.2 m/s², or 0.4 tiles/s². At that rate a Lavi would reach
  1.1 t/s in 2.75 s, over about 1.5 tiles. Today it does so in one tick in the sim, and over
  0.35 s in the drawing.

---

## 8. Gaps, ranked by visual and gameplay impact

The constraints are the four invariants (deterministic Q16.16 sim, 20 Hz, per-entity RNG,
one-way data flow), flow-field pathing, and presentation-only motion unless the sim must
change. "Sim" below means `pnpm test:determinism` and the golden hash move, `pnpm balance`
must be re-run, and the change ships as JSON fields where possible (content-not-code rule).
The numbers proposed are **estimates** for tuning, not doctrine.

| # | Gap | Visual | Gameplay | Where | Sketch |
|---|---|---|---|---|---|
| 1 | **No reverse gear.** A tank told to back off turns 180° and drives away, showing its rear. Doctrine backs out "keeping front hulls toward the enemy" (`tactics.md` §8) | High | **High** (armour arcs, shoot-and-scoot, retreat under fire) | Sim | Add `mobility.reverse_speed_tiles_s` (about 40-50 % of forward, from the Leopard 2's 31/68 km/h). In `stepMovement`, reverse when the goal lies in the rear arc within N tiles (CoH-style, about 4-6 tiles), or when retreating with an identified enemy in the front arc. Facing = heading + ½ turn. A "reverse move" modifier for the player. Running gear already handles signed speed |
| 2 | **Hull skates while turning; wheeled vehicles pivot.** Translation is not gated by heading error. A reversal slides backwards for about 3 s | **High** | Medium (turn timing, exposure) | Sim | Tracked: step at `v × max(0, cos(err))`, or hold while `err > 45°` (pivot first). Wheeled: no rotation at zero speed; cap the yaw rate at `v / R_min` with `R_min` about 2-2.5 tiles (HMMWV 7.6 m, 8x8 about 8 m), and reverse-turn when blocked. Fixed-point safe (LUT `fx.sin`/`cos`). Pottinger's slow-down-for-sharp-turns is the cheap form [21] |
| 3 | **Turret slews at up to about 800°/s; real is 30-40°/s** | **High** (the barrel snaps) | Potentially high if moved into the sim (flanking pays, switching targets costs time) | Presentation now; sim later | Presentation: cap the spring's velocity at about 60-90°/s (2× real for readability, heuristic) and keep the overshoot. **Risk:** the sim fires on the tick it acquires, so a capped barrel can fire off-target. The muzzle reads turret facing. Either hold the shot visual until the barrel aligns, or add `turret_traverse_deg_s` to the sim (acquisition delay = angle ÷ rate) |
| 4 | **The sim has no acceleration.** `accel_tiles_s2` exists in the schema and is unread. The drawn ramp (0.35 s) is invented and cannot be realistic, because the 0.09-tile lag budget allows about 0.1 s of real ramp, not 2-3 s | Medium-high (lunge and creep read; the weight model gets a true input) | **High** (stop-start cost, shoot-and-scoot timing, a pin's effect) | Sim | Read `accel_tiles_s2` (and a braking value about 3× it; `dynamics.md` 1.2). Real is about 0.4 t/s² for an MBT; game-tuned is perhaps 0.75-1.5 t/s² (estimate). Then `stepVehicleWeight` can read real acceleration and drop the invented ramp. Balance must be measured, since every vehicle duel shifts |
| 5 | **No pivot ground effects.** Turning on the spot makes no dust and leaves no mark. Turns leave no outside berm | Medium-high (dust and marks are the best-reading cues, 6.2) | None | Presentation | When yaw rate exceeds a threshold and translation is about 0: dust at both track ends (`vehicle-fx.ts` reads the yaw rate the weight model already smooths), and one pivot-scuff decal (a disc about one hull length across) through `stampGroundDecal`. Optionally an outside-berm tint on tight turns |
| 6 | **Slope does not change speed** (only the path cost) | Low-medium | Medium (high ground costs time; makes `UPHILL_PER_LEVEL` real) | Sim | Speed multiplier from levels climbed per tile, from `v = eta P / (m g (sin θ + f))`. Tracked: 1 level/tile (25 %) → ×0.6; 2 levels/tile (51 %) → ×0.25. Wheeled: ×0.5 and impassable above 40 % (HMMWV rating). Descending ×1.0. A table in `tuning.ts` keyed by `gear`, or per-unit JSON |
| 7 | **No hull-down / turret-down** | Medium | **High** (the core armour terrain skill in doctrine) | Sim + data | Masked hull: a crest 1-2 levels (0.8-1.5 m) above the vehicle's ground within 1 tile toward the threat, giving cover to the hull arcs. Turret-down: 1-2 tiles further back, sees but cannot fire the main gun. AI uses the occupy sequence in `tactics.md` §4. Large design; needs `pnpm balance` and garrison-style probes |
| 8 | **No bounding overwatch** in formations | Medium (reads as purposeful) | **High for the AI**, medium for the player | Data + one engine change | A formation whose two elements alternate legs: only one moves, the other halts, and legs are ≤ the weapon range. The 8-tile checkpoints and leg holds already exist. Per `CLAUDE.md`, a new drill is "a schema and engine change, made once" |
| 9 | **One moving-fire penalty for all** (0.55) | Low | Medium | Sim | A per-weapon `stabilised` factor: an MBT gun's penalty small, a technical's mount large (`tactics.md` §5) |
| 10 | **Barrel does not hold level against hull pitch** | Low-medium (reads "real tank" when slightly exaggerated) | None | Presentation | Counter the weight model's pitch and roll on the gun elevation pivot for stabilised types; let technical mounts bob |
| 11 | **Pitch symmetric and fast-settling.** Launch squat equals brake dive (2° MBT); settles in 0.5 s | Low (1-4 px) | None | Presentation | Split `maxPitch` into launch (about 0.3-0.5× today's) and brake (today's). Settle the MBT in about 1-1.5 s with one overshoot (damping 0.3-0.4). The settle floor is 0.5 by design; one visible overshoot is real. Meaningful only after gap 4 gives a real stop |
| 12 | **Antenna whip, track sag** | Low (close zoom only) | None | Presentation | A whip bone or vertex sway driven by the weight model's acceleration, on the sim clock. Last in the queue |

**Suggested order:**

1. **Reverse plus turn-before-move (1, 2).** They share the `stepMovement` change and fix the
   two most visible movement defects. Reverse also restores the doctrine's armour-facing
   logic.
2. **Turret cap (3).** Do it with the shot-visual hold first; sim traverse is a later design
   call.
3. **Pivot effects (5).** Cheap, presentation-only, high read.
4. **Sim acceleration (4).**
5. Slope speed (6).
6. Hull-down and bounding overwatch (7, 8) as their own design work.
7. Polish (9-12).

Every sim change needs its falsification: a one-line mutation that turns the new test red,
per `CLAUDE.md`.

---

## 9. Sources

1. Wikipedia, *Merkava*: Mk 4 mass, MTU 12V883 1,501 hp, 18.8 kW/t, 64 / 55 km/h, helical
   spring. https://en.wikipedia.org/wiki/Merkava
2. Army Recognition, *Merkava IV*: 65,000 kg, 1,500 hp, separate helical spring per wheel.
   https://www.armyrecognition.com/military-products/army/main-battle-tanks/main-battle-tanks/merkava-iv-4-israel-uk
3. GlobalSecurity, *Merkava specs*: 1 m step, 3.5 m ditch, 1.4 m ford, alongside Mk 3 engine
   and speed figures (search snippet; 403 on fetch).
   https://www.globalsecurity.org/military/world/israel/merkava-specs.htm
4. Wikipedia, *Namer*: 60+ t (infobox 63.5 t in some versions), 1,200 hp, 20 hp/t, 85.2 km/h,
   helical spring. https://en.wikipedia.org/wiki/Namer
5. Army Recognition, *Namer*: 50,000 kg, AVDS-1790-9AR 1,200 hp, 60 km/h, 500 km.
   https://armyrecognition.com/military-products/army/armoured-personnel-carriers/tracked-vehicles/namer-israel-uk
6. Tankhistoria, *Namer*: 60 km/h (search snippet). https://tankhistoria.com/modern-day/namer/
7. Army Recognition, *Eitan 8x8 APC* data sheet: 30,000-35,000 kg, 750 hp, 90 km/h, 1,000 km.
   https://www.armyrecognition.com/archives/archives-naval-defense/naval-defense-2023/eitan-8x8-apc-armoured-vehicle-personnel-carrier-technical-data-sheet-specifications-pictures-video-10208163
   7b. Wikipedia mirror giving an MTU 8V199 at 712 hp (search snippet).
   https://www.chise.org/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco/wiki/Eitan_AFV.html
8. Wikipedia, *Eitan AFV*: "up to 50 tonnes" infobox, MTU 6V890 750 PS, 90 km/h, Allison 4800
   SP. https://en.wikipedia.org/wiki/Eitan_AFV
9. AFV Database, *M1126 Stryker ICV*: 60 % / 30 %, 23 in step, 78 in trench, 52 ft turning
   diameter, 60 mph (search snippet). https://afvdatabase.com/usa/m1126icv.html
10. Wikipedia, *M113 armored personnel carrier*: 12.3 t, 275 hp, 22.36 hp/t, 67.6 / 5.8 km/h,
    60 %, 1.7 m, 0.6 m, amphibious notes, IDF Zelda.
    https://en.wikipedia.org/wiki/M113_armored_personnel_carrier
11. Wikipedia, *Caterpillar D9*: weights, D9R 405-410 hp, 11.7 / 14.6 km/h, D9R clutch-brake,
    D9T differential. https://en.wikipedia.org/wiki/Caterpillar_D9
12. Wikipedia, *IDF Caterpillar D9*: armour adds "roughly 15 additional tonnes", Doobi
    (search snippet). https://www.wikipedia.com/wiki/IDF_Caterpillar_D9
    12b. Meng D9R kit review: "65 tons loaded" (search snippet).
    https://modelingmadness.com/review/misc/vehicles/previews/meng/ss002.htm
13. AM General, *M1151* product sheet (PDF; text extracted).
    https://www.amgeneral.com/wp-content/uploads/2019/12/M1151.pdf
14. Toyota UK, *Hilux Tech Specs* (2024): kerb weights, turning radius, wading (search
    snippet). https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/240528-Hilux-Tech-Specs.pdf
15. auto-data.net, *Hilux Double Cab VIII facelift 2024 2.8d 204 hp*: 175 km/h, 13.4 m circle,
    700 mm wading (search snippet).
    https://www.auto-data.net/en/toyota-hilux-double-cab-viii-facelift-2024-2.8d-204hp-4x4-53909
16. StrategyPage, *The Endless Toyota Wars*: about 1.4 t empty, about 1 t payload, for older
    models (search snippet). https://www.strategypage.com/htmw/htarm/20151019.aspx
17. Wikipedia, *M1 Abrams*: masses, 1,500 shp, governed speeds, 40 km/h off-road, turret 9 s
    per 360°. https://en.wikipedia.org/wiki/M1_Abrams
18. FAS, *M1 Abrams*: 0-20 mph 7 / 7.2 s, slopes, steps, trench, ground pressure.
    https://man.fas.org/dod-101/sys/land/m1.htm
19. Wikipedia, *K2 Black Panther*: 0-32 km/h 7.47 / 8.77 s, 27.3 hp/t, 70 / 50 km/h, 60 %,
    1.3 m, 4.1 m snorkel, ISU. https://en.wikipedia.org/wiki/K2_Black_Panther
20. Wikipedia, *Twelve basic principles of animation* (after Thomas and Johnston, *The
    Illusion of Life*, 1981). https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
21. Pottinger, D., "Coordinated Unit Movement", *Game Developer* (Gamasutra), 22 Jan 1999.
    https://gamedeveloper.com/programming/coordinated-unit-movement; part 2, "Implementing
    Coordinated Movement": https://gamedeveloper.com/programming/implementing-coordinated-movement
22. Reynolds, C., "Steering Behaviors For Autonomous Characters", GDC 1999.
    https://www.red3d.com/cwr/steer/gdc99/
23. Emerson, E., "Crowd Pathfinding and Steering Using Flow Field Tiles", *Game AI Pro*, ch. 23
    (PDF; title and author confirmed by text extraction).
    http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf
24. Eurogamer interview with Samwise Didier, via Blizzplanet (silhouettes for the
    three-quarter view) (search snippet).
    https://www.blizzplanet.com/blog/comments/eurogamer_interviews_samwise_didier
25. coh2.org, *Tips and tricks for newbies* ("shift reverse so unit won't turn around")
    (search snippet, community). https://Www.coh2.org/guides/31462/tips-and-tricks-for-newbies
26. progameguides.com, *Company of Heroes 3 Patch Notes - Balance Update 1.1.4* (auto-reverse
    distance 20 → 60) (search snippet; 403 on fetch; third-party).
    https://progameguides.com/company-of-heroes/company-of-heroes-3-patch-notes/
27. coh2.org forum thread on reverse behaviour (community).
    https://www.coh2.org/topic/53110/title/post/536808
28. Repository files (read-only, `main`): `packages/sim/src/sim.ts` (`turnToward`,
    `aimHullAt`, `stepMovement`, `bodyAimed`), `packages/sim/src/tuning.ts`
    (`MOVING_STANCE_MOD`, `TARGET_MOTION_MOD`, `UPHILL_PER_LEVEL`, `AIM_OFF_HEADING_MAX`),
    `packages/sim/src/formation.ts` (`VEHICLE_SPACING`), `data/formations/*.json`,
    `data/units/**` (`mobility`), `data/schemas/unit.schema.json`,
    `packages/render/src/three/units/{vehicle-weight,vehicle-weight-params,vehicle-conform,running-gear,vehicle-fx,frame-state,mesh-anim}.ts`,
    `packages/render/src/three/ThreeRenderer.ts` (track marks),
    `packages/render/src/project.ts`, `packages/render/src/three/terrain/shared.ts`,
    `packages/app/src/ui/camera-input.ts`, `docs/agent-notes/mesh-units.md`.
