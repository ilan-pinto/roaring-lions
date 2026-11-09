---
name: vehicle-movement
description: How real combat vehicles move (acceleration and braking, hull pitch and settle, slope and soft-ground speed, tracked pivot vs wheeled turning circles, reversing, turret traverse and stabilisation, suspension bounce) and how armour moves tactically (traveling, traveling overwatch, bounding overwatch, column/wedge/line/echelon, hull-down, shoot-and-scoot, tanks with infantry carriers), mapped to Roaring Lions' tile scale, its 20 Hz fixed-point sim and its presentation-only motion. Use this whenever you touch or judge vehicle motion: stepMovement, mobility fields in data/units, formations for vehicles, the AI or bot moving armour, running gear, the weight/conform/settle model, vehicle dust and track marks, turret slew, or a lead request like "the tank moves unrealistically" or "make vehicles turn like real ones". Also use it for Merkava, Namer, Eitan, M113, D9, Hummer or technical behaviour.
---

# Combat vehicle movement for Roaring Lions

You are making vehicles move like the real thing while keeping the game readable and deterministic. Real dynamics tell you **what moves when**: a tank pivots before it drives, a wheeled APC cannot, a stopping hull dips its nose, a turret takes seconds to swing round. Doctrine tells you **how a group moves**: who covers whom, which way the hull faces when backing out. The game's scale tells you which of those numbers survive.

The sourced research, with formulas and a URL per number, is in `references/`:
- `references/dynamics.md`: acceleration and braking, weight transfer and pitch, top speed vs slope, gradeability, soft ground (VCI), skid-steer and Ackermann steering, turret traverse and stabilisation, suspension and body motion.
- `references/tactics.md`: movement techniques, formations, intervals, terrain use (hull-down, skylines), short halt vs firing on the move, tanks with carriers and dismount points, convoy spacing, reversing out of a position, and §9, how to translate doctrine to game scale.
- `references/vehicles-and-game.md`: the calibration table (Merkava 4, Namer, Eitan, M113 Zelda, D9R, HMMWV, technical, with M1A1, K2 and Stryker as references), what reads at RTS distance, what the game does today, and the **ranked gap list** (§8).

Numbers are tagged sourced, a search snippet, a game model or an estimate. Keep the tag when you quote one.

## Scale facts you need first

- **1 tile = 3 m. 1 sim tick = 50 ms (20 Hz, real time). 1 elevation level = 0.766 m.** One level per tile is a 25.5% grade; three levels per tile (77%) is steeper than any tank climbs.
- **Distance is compressed, size is not.** Weapon ranges are about 70x compressed (the Lavi's gun reaches 12 tiles, against a real 2,500 m), but a hull is still about 2 tiles long. So **doctrinal intervals in metres cannot be used**: a 100 m interval would be 33 tiles. In the game, spacing is set by the footprint (today's `VEHICLE_SPACING` is 2 tiles centre to centre). Keep doctrine's **order** instead: close column < open column ≈ wedge < line < defence.
- **Time is not compressed.** Accelerations, turn rates, traverse rates and settle times can be used at real values or modestly exaggerated for readability.

## Calibration numbers (short form)

| | Merkava 4 | Namer | Eitan 8x8 | M113 | D9R | HMMWV | Technical |
|---|---|---|---|---|---|---|---|
| Mass (t) | 65 | 60–63.5 | 30–35 | 12.3+ | ≈ 64 | 3.4–4.7 | 2.0–2.3 (+1 load) |
| hp/t | 23 | 19–20 | 21–25 | 22 | 6.4 | 35–56 | 60–90 |
| Road / cross-country km/h | 64 / 55 | 60 | 90 | 67.6 | 11.7 fwd / 14.6 rev | 113 | 175 |
| Turning | pivots in place | pivots (est.) | **no pivot**, ~16 m circle (est.) | pivots | pivots on a braked track | 7.6 m radius | 6.4 m radius |
| Gradient / side slope | 60% / 30% (class norm) | as Merkava | 60/30 (Stryker est.) | 60% | n/s | 40% / 30% | n/s |

Other anchors:
- **Acceleration:** an MBT does 0–32 km/h in 7–9 s, about 1.2 m/s², or 0.4 tiles/s².
- **Braking:** a hard stop is about 0.4–0.6 g (estimate); the spec minimum is 0.22 g.
- **Nose dip on a hard stop:** about 0.5–2.5°, a launch squat about a quarter of that, and a settle of 1–2 s with one overshoot.
- **Pivot rate:** 15–40°/s (estimate; no measured military figure exists).
- **Turret traverse:** 30–40°/s (an M1 takes 9 s per 360°).
- **Slope:** speed falls with grade as `v = ηP / (m·g·(sin θ + f))`.
- **Soft ground:** a tank (VCI 25) crosses soil where a loaded Humvee (VCI ~31) bogs.

## Rules that decide most questions

1. **Tracked vehicles turn, then go. Wheeled ones cannot turn on the spot.** A tank pivots in place (neutral steer) and should finish most of a big turn before translating. An 8x8 or a Hummer needs speed to turn, has a turning radius of about 2–2.5 tiles, and reverses or makes a three-point turn when blocked. Today every vehicle can pivot and none of them finishes its turn before moving. That is gap 2 in `references/vehicles-and-game.md` §8.
2. **Back out facing the enemy.** Doctrine reverses out of a firing position with the front hull toward the threat. The game has no reverse gear (gap 1), so a retreating tank shows its rear armour. Reverse speed is about 40–50% of forward. Because `resolveHit` reads `facing` for armour arcs, this is a sim rule, not a look.
3. **Real turrets are slow, and the gun stays on target.** Traverse is 30–40°/s, and stabilisation holds the gun on target while the hull turns and pitches. Today the turret spring has no rate cap and peaks near 800°/s (gap 3). If you cap the visual, the sim still fires on the tick it acquires, so either hold the shot visual until the barrel aligns or move traverse into the sim (`turret_traverse_deg_s`). Never let a capped barrel draw a shot that leaves sideways.
4. **Weight shows.** Nose dips under braking, squats under acceleration, settles with one overshoot. Exaggerate slightly for readability (a few pixels at zoom 1), and only once the sim has real acceleration; today's 0.35 s drawn ramp is invented (gap 4: `accel_tiles_s2` is in the schema but unread).
5. **Dust and marks read best.** At RTS distance the most legible cues are dust, track marks, pivot scuffs and reversing. Hull pitch is 1–4 px, and antenna whip and track sag are close-zoom only. Spend effort in that order (gap 5 has pivot dust and scuff decals, presentation only).
6. **Slopes cost speed, not just path.** Tracked vehicles drop to about 0.6x at one level per tile and about 0.25x at two. Wheeled vehicles drop to about 0.5x and cannot pass above a 40% grade. Descending is free. Today slope only changes the path cost (gap 6).
7. **Formations: spacing by footprint, roles by doctrine.** The game has wedge, line, echelon and file for vehicles, plus bounding overwatch, where one element moves while the other covers. Keep a bound no longer than the overwatch element's weapon range; the 8-tile `leg_tiles` fits the Lavi's 12-tile gun. Tanks leading infantry crawl to the infantry's pace, which the Column's `pace: slowest_ground` already does.
8. **Hull-down is the core armour terrain skill.** A crest 1–2 levels (0.8–1.5 m) above the vehicle, within about a tile toward the threat, covers the hull arcs. That is a sim and data design (gap 7), and large: probe it with `pnpm balance` and garrison-style probes.

## How to use this skill on a task

1. **Classify the change** as **presentation** (running gear, weight model, dust, marks, turret visual) or **sim** (speed, turning, reverse, acceleration, slope, facing, hull-down).
   - Presentation runs on the frame clock or the sim clock, with nothing read back by the sim.
   - Sim changes must keep the four invariants:
     - Q16.16 fixed point; use `fx.sin`/`fx.cos` LUTs, never `Math.*`;
     - 20 Hz;
     - per-entity RNG;
     - one-way data flow.
   - A sim change moves the golden hash deliberately, in the same commit, with the reason. It needs `pnpm balance` and `pnpm test:determinism` re-run.
2. **Prefer data to code.** Add or read `mobility` fields per unit (`reverse_speed_tiles_s`, `accel_tiles_s2`, a turning radius, `wheeled`), and keep tuning tables in `tuning.ts`. Remember that `mobility.wheeled` is authored, and `FOOT_ROLES` alone is wrong both ways.
3. **Use the real numbers above,** converted to tiles and ticks. State where you exaggerate for readability, and by how much.
4. **Check the ranked gaps** in `references/vehicles-and-game.md` §8 before proposing anything. They come with sketches, and gaps 1 and 2 share the same `stepMovement` change.
5. **Write the proposal as a table:** real value, game value now, proposed value and verdict. The lead approves movement and art numbers before anything ships.
6. **Prove every new check can fail** with a one-line mutation, and put the falsification in the commit message.

## Pitfalls

- **Copying doctrinal metres onto the map.** Intervals in metres become absurd at game scale; keep the ordering and the footprint instead.
- **A turret cap that desyncs the shot.** If the barrel is capped, the shot visual must wait for it (rule 3).
- **Acceleration added only in the renderer.** It lags the sim position. A real ramp of 2–3 s cannot be faked within the renderer's 0.09-tile lag budget, so it belongs in the sim.
- **Giving wheeled vehicles a pivot "because it is easier".** It is the most visible unrealism after skating turns.
- **Treating all moving fire alike.** Stabilised MBT guns lose little on the move; a technical's mount loses a lot (gap 9, a per-weapon `stabilised` factor).
