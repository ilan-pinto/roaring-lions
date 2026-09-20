# Vehicle weight — the hull that leans, lags and settles (WP-A1.3, GH-177) — Design

> Art lane, Phase 1 · Weight, sub-project 3. Branch `feat/art-vehicle-weight`, worktree
> `.claude/worktrees/ep-a13`, base `main@a567b892`.
>
> Companion plan: `docs/superpowers/plans/2026-09-20-art-vehicle-weight.md`.

---

## What this is

The art-direction review's Phase 1 · Weight carries one bullet for vehicles, and GH-177
repeats it almost word for word:

> "Vehicles: export `wheel_*` and `track_*` pivots the way `turret_pivot` is exported,
> spin wheels by distance over radius, scroll track UVs, pitch and roll the hull from
> four ground-height samples (the sampler exists in `ground-height.ts`), plus ±2° pitch
> on acceleration and a small roll in turns."

The diagnosis beside it is the sentence that actually names the defect: **"Hulls glide."**
A sixty-tonne Lavi reaches cruising speed in one 50 ms tick, holds it exactly, stops
dead, crosses a hillside without tilting, and turns without leaning. Nothing about the
way it moves says it has mass.

This package delivers the **hull** half of that bullet — the four-sample terrain
conform, the acceleration pitch, the turn roll, a settle on stop, and dust whose
cadence follows the speed instead of a fixed clock. It does **not** deliver the wheel
and track half, and that is a measured decision rather than a preference: every one of
the eleven shipped vehicle GLBs was read from the bytes for this spec and none of them
has a wheel or a track that can be addressed at all (R-J). The wheel half needs
geometry that does not exist yet.

GH-177 states no acceptance criteria, and G0 (#164) answered nothing about vehicle
motion — all fourteen items closed on 18 Sep and not one mentions wheels, tracks or
hull weight. The package's only lead gate is **G1 (#165), "vehicle numbers"**, and the
precedent it inherits is G0 #14's, set for the blast one sub-project ago: **the lead
judges this on ten seconds of motion, not on a still and not on a number.**

---

## What exists today (verified)

Every claim here was read at `main@a567b892` in this worktree. The research brief is
research; these are the citations that survived checking. Four of them came back
different from what the brief or a shipped comment says, and one of those is a live
defect this package has to compose with.

**Turret lag already ships, fully, and is not this package's work** (R-A).
`stepTurretFacing` (`packages/render/src/three/units/frame-state.ts:436`) is a damped
spring toward the current aim bearing, with a per-entity `turretFacing`/`turretVel`
pair, a `turretSeeded` first-frame seed, and a spring-back to the hull's own heading
when there is no target. `updateVehicleMeshes` calls it for every turreted mesh vehicle
(`ThreeRenderer.ts:5353-5401`). Only the parent research-task prompt ever named turret
lag as A1.3 scope; the issue, the art page and the execution plan do not.

**No `wheel_*` or `track_*` node exists anywhere, and none can be added by naming
alone.** `mesh-vehicle.ts` looks up exactly two pivots — `turret_pivot`
(`PIVOT_NODE_NAME`, `:72`) and `rotor_pivot` (`ROTOR_PIVOT_NODE_NAME`, `:100`), each by
exact name with an `extras.rl_pivot` fallback. A grep for `wheel_`/`track_` across
`packages/render/src/three/` returns only the terrain's `road_track_tile` albedo.
Reading the JSON chunk of all eleven `art/meshes/vehicles/*.glb` directly:

| GLB | live nodes | wheel/track nodes | `hull_rubber` | UVs on it | materials |
|---|---|---|---|---|---|
| `apc_eitan` | 9 | **none** | one merged mesh | **no** | 0 |
| `apc_kipod` | 6 | **none** | one merged mesh | **no** | 0 |
| `dozer_d9` | 5 | **none** | one merged mesh | **no** | 0 |
| `scout_shachaf` | 4 | **none** | one merged mesh | **no** | 0 |
| `mbt_lavi` | 5 | **none** | one merged mesh | yes, material 0 | 1 |
| `ifv_namer` | 5 | **none** | one merged mesh | yes, material 0 | 1 |
| `jeep_shoded` | 4 | **none** | one merged mesh | yes, material 0 | 1 |
| `rocket_battery` | 4 | **none** | one merged mesh | yes, material 0 | 1 |
| `technical` | 6 | **none** | one merged mesh | yes, material 0 | 2 |
| `paramotor` | 4 | **none** | one merged mesh | yes, material 0 | 2 |
| `heli_peten` | 6 | **none** | **no rubber at all** | — | 1 |

Every file merges by ROLE, not by part. `author_eitan.py` authors eight separate road
wheels (`kit.wheels_in_pairs("eitan_wheel", …)`, `:75`) and the export merges all eight
into one `hull_rubber` mesh. Four vehicles carry no `TEXCOORD_0` on that mesh at all, so
a track-UV scroll is not unimplemented there, it is inexpressible. The seven that do
point `hull_rubber` at **material 0 — the same material the hull body uses** — so
scrolling that material's UV offset scrolls the whole vehicle's texture. And the Meshy
sources are single welded meshes: `export_meshy_tank.py`'s own docstring records that a
connected-component pass found the tracks welded into the same component as the hull,
and that the hull/turret split had to be a **geometric** cut by face position with
per-island hole-filling, because there is no seam to cut along.

**There is no acceleration anywhere in the sim, and `entitySpeed` is a step function.**
`stepMovement` (`packages/sim/src/sim.ts:4918`) moves a moving unit by exactly
`type.stepPerTick`, shifted only by rout (`ROUT_SPEED_SHIFT`) and pin
(`PIN_SPEED_SHIFT`), and snaps onto the goal on arrival. No ramp exists. The renderer's
`entitySpeed[i]` is `Math.hypot(dx, dy) * SIM_HZ` from the tick-to-tick delta
(`ThreeRenderer.ts:2752`), recomputed once per 20 Hz tick in `snapshot()` and held for up
to three frames at 60 fps. A literal derivative of it reads zero at cruise and spikes for
one tick at a standing start.

**Heading is a different story, and the brief has this half wrong.** The hull does NOT
slew instantly: `turnToward` (`sim.ts:3459`) clamps every facing change to
`type.turnPerTick`, derived from an authored `mobility.turn_rate_deg_s`
(`sim.ts:463`, default `DEFAULT_TURN_DEG_S` = 360), and `stepMovement` turns the hull
toward its line of march through that same cap (`:5027`). Every vehicle authors one:
`mbt_lavi` 60 °/s, `ifv_namer` 75, `apc_eitan` 90, `apc_kipod` 95, `technical` 120,
`scout_shachaf` 140, `jeep_shoded` 160, `moto_rpg` 220. So yaw rate is a real,
rate-limited, per-vehicle-authored signal with a known ceiling — which is what makes
roll cheap and pitch expensive (R-L, R-M).

**The hull already takes a procedural tilt, and the comment describing it is wrong.**
`updateVehicleMeshes` writes `entity.root.rotation.x = hullPitch` every frame
(`ThreeRenderer.ts:5348`), where `hullPitch` is `MESH_HULL_PITCH_RAD` (0.06 rad, ~3.4°)
eased by `recoilT[i]²`. `MESH_HULL_PITCH_RAD`'s doc comment claims XYZ Euler order makes
this "a local pitch regardless of which way the hull is currently facing, not a
world-axis tilt that would look like a roll from some headings." **Measured, with the
shipped constants and `meshYawFromFacing` (`mesh-anim.ts:386`, `-2π·facing`), it is
exactly the world-axis tilt the comment denies:**

| facing (turns) | nose lift (forward·y) | lateral tip (up·z) |
|---|---|---|
| 0.000 | **0.00000** | 0.05996 |
| 0.125 | −0.04240 | 0.05996 |
| 0.250 | **−0.05996** (nose DOWN) | 0.05996 |
| 0.500 | −0.00000 | 0.05996 |
| 0.750 | +0.05996 | 0.05996 |

(A true nose-up pitch would read lift 0.05996 and tip 0 at every heading.) Three.js
composes `rotation` as `Rx · Ry · Rz`, so with yaw on `y` the `x` term is applied about
the **world** X axis: the hull is banked by the full amount at every heading, gets no
pitch at all facing east, and pitches nose-DOWN facing north. It has never been noticed
because it is 3.4° for 0.4 s on a one-shot. A continuous weight tilt through the same
field would be glaring, so this package composes tilt in the hull's own frame and the
recoil comes with it (R-K).

**Dust already scales with speed — but only its density, never its rate.**
`vehicleDustMagnitude` (`three/units/vehicle-fx.ts:89`) ramps 0→1 linearly to
`VEHICLE_DUST_FULL_SPEED_TILES_S` (1.0 tiles/s) and clamps, and that magnitude sizes each
puff. But `updateVehicleAmbientFx` (`ThreeRenderer.ts:3643`) spawns on a **fixed**
`VEHICLE_DUST_INTERVAL_MS`, so a crawling Lavi (1.1 tiles/s) and a sprinting `technical`
(2.6) lay dust at the same rate, and the plume is anchored off `curX`/`curY` — the sim's
exact last-tick position, not the drawn hull. That method's own "THE CEILING IS
LOAD-BEARING" section (`:3606-3642`) records what happens when a new accumulator skips
the clamp: until 2026-09-18 this was the one elapsed-time reader in `frame()` fed raw
`dtMs`, a long frame banked 5607.9 ms of emission credit, and the next 22 zero-time
repaints each spawned seven puffs. Every new accumulator goes through
`frameDtMs`/`frameDtSeconds` (`:4679-4687`, `FRAME_DT_CEILING_MS` = 100).

**A dying vehicle is already out of the loop.** `updateVehicleMeshes`' prune pass
(`:5460+`) deletes the entity from `vehicleMeshEntities` in the same frame `alive` goes
to 0 and hands it to `beginVehicleDeath`; nothing in this method ever reads it again. So
new weight state freezes at death for free (R-N) — but it still needs a `seeded`
companion, because every existing per-entity array in this class
(`turretSeeded`, `animSeeded`, `vehicleTrackSeeded`) seeds from the current frame on an
entity's first tick rather than reading the zero-fill a reinforcement would otherwise
start from.

**The hull's footprint is already measured and already stored.**
`vehicleShroudBounds(root)` (`mesh-vehicle.ts:477`) returns the live body's size in tile
units, excluding `death_root`, and the blast package fills `vehicleMeshBounds` from it at
template load (`ThreeRenderer.ts:4088`). The template root carries only `MESH_SCALE` and no
rotation, and the contract's rest pose is +X forward — so `bounds.x` is length along the
hull's forward axis and `bounds.z` is its width. The four-corner sampler needs no
authored footprint numbers at all.

**`groundWorldY` samples one point and is called once per vehicle per frame.**
`three/ground-height.ts:98`, `groundWorldY(elevation, width, height, wx, wy)`, sampling
the drawn Catmull-Rom surface at a fractional level. "Four samples" means four calls, not
a new API (`ThreeRenderer.ts:5321` is today's single call).

**Picking never reads the drawn transform.** `ThreeRenderer.pickUnit` (`:3744`) forwards
`curX`/`curY` to `pickUnitPure`; `worldToScreen` (`:3706`) takes world coordinates from
the caller. The hull recoil already displaces `entity.root.position` by up to
`MESH_HULL_RECOIL_TILES` = 0.16 tiles without moving what gets picked.

**The gate is structurally near-blind to this, and that is provable rather than
hopeful.** `VEHICLE_SCENARIO` (`tools/src/golden-diff/capture-protocol.ts:416`) is
`beit_sahwan_outskirts` at `targetTick: 140` with **no `orders`** — the sandbox force is
parked. `beit_sahwan_outskirts`, `tutorial_ground` (`open-ground`) and `beit_sahwan_3`
(`combat`, report-only) declare **no `elevation` grid at all**; only `relief`
(`tel_marum`) does among the gated four. So on three of the four gated scenarios a parked
vehicle's weight state is the identity transform by construction, not by tuning.

**`packages/render` cannot import `@lions/data`,** enforced by eslint
(`eslint.config.mjs:138-147`). It CAN import a raw `data/*.json` file by relative path,
and production code already does — `three/units/mesh-role.ts:44` and
`three/terrain/tones.ts:27` both read `data/palette.json` that way, each with a comment
saying why. This is the route R-I takes.

**The instruments.** `tools/src/perf/blast-captures.ts` (1,827 lines) is the ten-second
ladder, the per-run `stepJumpMs` read from a dry `step(1)`, the frozen frame loop, the
explicit `renderer.frame(1, FRAME_MS)` pumps, and a `sheet.md`/`sheet.json` index whose
NUMBERS survive the git-ignored PNGs. `tools/src/perf/gait-captures.ts` photographs units
walking — `L.sim.queueCommand({ kind: 'move', ids: [id], … })`, one order per body so a
group order does not land them in formation (`:741-762`) — and gets its "before" by
answering `/meshes/*.glb` from `git show <rev>:…`. `__lions.step(n)`
(`packages/app/src/main.ts:3851`) runs n ticks and then exactly **one**
`renderer.frame(1, lastFrameMs)`, at alpha 1, with a frame delta the harness cannot set.

---

## Direction

One per-vehicle smoothed state in the renderer, driven by the frame clock, fed by the
sim's 20 Hz step function, read by nothing but the draw:

```
sim tick (20 Hz)                     frame (60 Hz)
  entitySpeed[i]  ─┐
  facing[i]       ─┤
  curX/curY       ─┤   stepVehicleWeight(state, input, dtSeconds)   → lagged position
                   │     smoothed speed  → d/dt → pitch               → hull-frame pitch
                   │     smoothed heading → d/dt → roll               → hull-frame roll
                   │     settle spring on stop                        → dust cadence
  ground (4 calls) ─┘   terrainTilt(frontY, rearY, leftY, rightY)   → terrain pitch/roll
```

Two mechanisms that must not be conflated, because one needs history and the other must
not have any:

1. **Terrain conform.** Four `groundWorldY` calls at the hull's own footprint corners,
   offset along the current yaw from `vehicleMeshBounds`. Purely geometric,
   recomputable from scratch every frame, exactly like the single sample it joins.
   Zero on flat ground by arithmetic.
2. **Dynamic weight.** A smoothed speed and heading per entity, with pitch taken from
   the derivative of the smoothed speed and roll from the derivative of the smoothed
   heading, plus a settle spring that overshoots and returns when a vehicle stops. This
   is the half that fakes the ramp the sim does not have, and it is the only new
   per-entity state.

Both return angles in the **hull's own frame**, and the renderer composes them with the
yaw through a quaternion so the tilt is hull-local at every heading — which is what the
existing recoil pitch only claims to be (R-K).

---

## Decisions

Each records the reason, because a reason is what a later reader can check.

### The controller's rulings (binding)

**R-A — Turret lag already exists and is NOT new scope.** `stepTurretFacing`
(`frame-state.ts:436`) is a real damped spring with seeding and spring-back, called from
`updateVehicleMeshes` (`ThreeRenderer.ts:5353-5401`). The spec records it as existing.
**The plan does not touch it**, and the reason is stated rather than assumed: the issue,
the art page and the execution plan all omit turret lag from A1.3's contents — only the
parent research-task prompt named it — and rebuilding a working spring to satisfy a
prompt would be the "a design that set out to extend it would be rebuilding something
that works" failure CLAUDE.md already records for the occlusion silhouette. If the lead
wants a different turret FEEL (slower traverse on a heavier hull, a distinct
acquisition snap), that is a constant change in `frame-state.ts` and a sentence at G1, not
this package as written. Open question 2.

**R-B — The per-vehicle weight parameters live in the unit JSON.** An optional,
schema-validated `weight` block under `mobility`, with role-based defaults in the
renderer for every unit that declares none. `pnpm validate:data` validates it; `pnpm
balance`, `pnpm playtest`, the determinism replay and the sim itself never read it.
The precedent is `mobility.wheeled` — an authored field that exists because the role
default is wrong for exactly one unit, and whose schema description says "Set it only
where the default gets a unit wrong." The expected authored set here is **zero to
three units**, for the same reason. How the JSON reaches a renderer that may not import
`@lions/data` is R-I.

**R-C — The drawn hull may trail the sim by at most 0.25 tile, and never on a unit the
sim reports stationary.** Picking (`pickUnit`, `screenToWorld`) keeps reading the sim
position, unchanged, so nothing about input moves. The bound is a spec constraint with a
pure spec behind it that goes red when a parameter set exceeds it — over a swept range
of speeds, not at one sample. See R-K for what "the drawn hull" includes.

**R-D — Everything here is presentation.** A per-vehicle smoothed state in the renderer —
lagged position and heading, pitch from longitudinal acceleration, roll from yaw rate, a
settle on stop — driven by the FRAME clock, reset on spawn, frozen at death. The sim's
20 Hz step function is the input and nothing written here is ever read back. Invariant 1
holds because no simulation is driven from frame time; invariant 4 holds because there is
no sim state in reach to mutate — the pure model takes plain numbers and returns plain
numbers.

**R-E — `ThreeRenderer.ts` is ONE small region and it is the LAST code task.** The
per-vehicle state beside `updateVehicleMeshes`, and the ambient-FX call for speed-tied
dust. Lane A's Phase 2 Tasks 15–16 (range rings in `three/units/overlays.ts` +
`overlay-geometry.ts`, minimap ground through `api.ts`) are in flight in
`feat/shell-phase-2-render` and **land first**. The plan's preamble says the run waits at
that task until they are on `main`, then merges `origin/main`.

**R-F — The hull must not pitch or roll during its own death.** The blast's shroud and
`stepVehicleDeath` own that window and a hull tilting under a collapse cloud fights both.
The weight state freezes when `alive === 0`. R-N records that this is free by
construction and what the plan must prove instead.

**R-G — Before-captures first.** A still and the ten-second ladder of a start, a stop and
a turn, at 2.5×, stored git-ignored under `.superpowers/art-captures/weight/<label>/`.
The after-set is the acceptance evidence and the lead judges on motion. **The golden
`vehicle` scenario must not move**: a parked vehicle's weight state is at rest, and a
spec pins that a stationary input yields the identity transform. A red `vehicle` on this
branch is a defect — leaked state, a filter that never settles to zero, a terrain sample
that is nonzero on flat ground — not drift, and must be found rather than blessed.

**R-H — Pixi owes no parity.** `packages/sim` untouched; `three` only, under
`packages/render/src/three/**`. `packages/render/src/renderer.ts` stays byte-identical to
`main` and none of this is reachable from it.

### Rulings taken while specifying

**R-I — The unit JSON reaches the renderer by relative import of the JSON file itself,
not through `@lions/data`, not through `UnitType`, and not through `RendererOptions`.**
All three of the obvious routes are closed, each by something already written down:
`@lions/render` may import `@lions/sim` only, enforced by eslint
(`eslint.config.mjs:138-147`); `RendererOptions` is built in `main.ts`, and the shell
programme owns `packages/app/**` including `main.ts` by the boundary agreed on 2026-09-17
(`2026-09-16-shell-upgrade-design.md:489-508`); and carrying it on `UnitType` is a
`packages/sim` edit R-H forbids. What is open — and is already how two production files
in this backend read authored data — is importing the raw JSON by relative path:
`three/units/mesh-role.ts:44` and `three/terrain/tones.ts:27` both do it with
`data/palette.json` and both say why. So `three/units/vehicle-weight-params.ts` imports
the vehicle unit JSONs directly and reads `mobility.weight` off them. **The numbers are
never transcribed** — a transcription with a test holding it in step would work, and is
what `TEXTURED_BUILDING_TYPES` does, but there is no reason to copy numbers when the file
can be read. What IS hand-kept is the import list, and that is pinned to the shipped
vehicle set by a disk-reading test: every `art/meshes/vehicles/*.glb` must have its unit
JSON imported here. Read from disk at test time rather than made an `import.meta.glob`,
for the reason `packages/data`'s own `index.test.ts` gives — a glob derives the list from
the directory and makes the check vacuous. That test is not decoration: registering
`catastrophic_kill.json` was forgotten one sub-project ago, three blast effects shipped
inert, and only a capture run found it.

**R-J — Wheel spin and track-UV scroll are OUT of this package, and the reason is
measured.** The table in "What exists today" is the whole argument: zero `wheel_*` or
`track_*` nodes in any of the eleven shipped GLBs; every file merging its wheels and
tracks into at most one `hull_rubber` mesh; four of them carrying no UVs on it at all, so
a scroll is inexpressible; the seven that do pointing it at the same material as the hull
body, so a scroll moves the whole vehicle's texture; and the Meshy sources being single
welded meshes whose hull/turret split already had to be a measured geometric cut with
per-island hole-filling (`export_meshy_tank.py`'s docstring). Delivering the issue's
bullet therefore means, per vehicle: cutting road wheels out of a welded low-poly scan,
giving each one a pivot at a measured axle centre, splitting the track run onto its own
material with its own UV set, and re-exporting — with the `.blend` sources, which are
gitignored and live only in the main checkout. That is the real cost behind the issue's
"a numbers table per vehicle (wheel radius, track pitch) approved at G1", it is art-lane
work, and it is several times this package. Named in Out of scope and raised as open
question 1. **The hull half is worth shipping without it**: a hull that leans into a
slope, squats when it pulls away and settles when it stops reads as weight even with
wheels that do not turn, and the reverse is not true.

**R-K — Tilt is composed in the hull's own frame, and the shipped recoil pitch comes with
it.** Measured above: `rotation.x` with yaw on `rotation.y` is a world-axis tilt — full
bank at every heading, zero pitch facing east, nose-DOWN facing north — while
`MESH_HULL_PITCH_RAD`'s own comment says the opposite. A continuous weight tilt through
that field would be nailed to the screen rather than to the hull. So
`updateVehicleMeshes` composes yaw, pitch and roll into `entity.root.quaternion` in the
hull's frame, and `hullPitch` becomes one more term in the pitch sum rather than a
separate write. That is a behaviour change to the recoil and it is deliberate, disclosed,
and cheap to check: the `vehicle` golden scenario is parked with nothing firing, so
recoil is zero there and the baseline cannot move on account of it; `combat` will move
and is report-only.
**R-C's 0.25-tile bound is on the COMBINED offset**, because the recoil shove (up to
`MESH_HULL_RECOIL_TILES` = 0.16 tiles) and the weight lag write the same
`entity.root.position` in the same frame. The lag's own budget is therefore
`0.25 − 0.16 = 0.09` tile in the worst case, and the composition is clamped once, at the
end, against 0.25 — never two independent clamps that can sum past it.

**R-L — Roll comes from the sim's own rate-limited yaw and normalises by the unit's own
`turn_rate_deg_s`, so it needs no second authored constant.** `turnToward`
(`sim.ts:3459`) caps every facing change at `turnPerTick`, and every vehicle authors its
rate (60–220 °/s across the roster). So the measured yaw rate has a known per-unit
ceiling and `roll = maxRollRad · clamp(yawRate / turnRateRad, −1, 1)` is bounded by
construction, at full lean exactly when the vehicle is turning as hard as it can. A Lavi
at 60 °/s therefore leans fully on a turn that a `moto_rpg` at 220 °/s takes without
leaning at all, which is the right answer and falls out of authored data rather than a
table. The research brief's "the sim gives no acceleration signal" is true of SPEED and
false of HEADING, and that asymmetry is the whole reason roll is cheap here and pitch is
not.

**R-M — Pitch has to fake the ramp, and its time constant is a presentation number
normalised by the unit's own `speed_tiles_s`.** `stepMovement` has no acceleration, so
`entitySpeed` steps 0 → full in one tick and back. The renderer keeps a smoothed speed per
entity — a first-order filter toward `entitySpeed[i]`, stepped on `frameDtSeconds`, the
same shape and the same clock `stepTurretFacing`'s spring already uses — and takes the
pitch from the derivative of THAT, normalised by `speed_tiles_s / accelSeconds` so a
standing start reaches the authored maximum and a cruise reads zero. The issue's **±2°** is
the authored maximum, which sits deliberately below the recoil's own 3.4°
(`MESH_HULL_PITCH_RAD` = 0.06 rad): a main gun should rock the hull harder than pulling
away from a standstill does.

**R-N — The freeze is free; the RESET is the part that needs writing.** A dead entity is
deleted from `vehicleMeshEntities` in the same frame `alive` goes to 0 (`:5460+`) and the
loop never revisits it, so R-F costs nothing — the plan proves that with a spec rather
than asserting it. What does need code is the first-frame seed: the weight arrays are
indexed by entity id, and a reinforcement spawning mid-mission would otherwise start from
a zero-filled slot and read as a vehicle that materialised at full speed. Every existing
per-entity array in this class carries a `seeded` `Uint8Array` companion for exactly this
(`turretSeeded`, `animSeeded`, `vehicleTrackSeeded`); the weight state gets one too, and
seeds smoothed speed and heading to the entity's current values on its own first frame.

**R-O — "Dust tied to speed" is the CADENCE and the ANCHOR; the magnitude ramp that
already exists is not re-implemented.** `vehicleDustMagnitude` already scales each puff's
density and size with speed. What is fixed is the spawn INTERVAL, so a crawling tank and
a sprinting technical lay dust at the same rate — measured, not assumed
(`ThreeRenderer.ts:3672`, `VEHICLE_DUST_INTERVAL_MS`). This package makes the interval a
function of speed, adds a short surge while the weight model reports real acceleration
(the moment a vehicle breaks traction is the moment it throws the most dust, and this is
the first time the renderer has an acceleration signal to hang that on), and moves the
anchor from `curX`/`curY` to the DRAWN hull, so the plume does not lead the vehicle it
comes off. **Every new accumulator goes through `frameDtMs`**, never raw `dtMs` — the
2026-09-18 drift is fixed and must not be reintroduced. A distance-based interval was
considered and rejected: `vehicle-tracks.ts` stamps by distance deliberately, because a
tyre mark is a mark on the ground, but a dust plume is thrown by the engine and a
stationary vehicle spinning its wheels throws dust while covering no ground.

**R-P — The harness is `blast-captures.ts` retargeted, with the one thing it cannot
inherit named: the SIM must advance.** The blast ladder freezes the sim and advances only
the FX clock, which is right for an explosion and useless for a moving vehicle. And
`__lions.step(n)` (`main.ts:3851`) ends with exactly one `renderer.frame(1, lastFrameMs)`
— alpha 1, at a frame delta the harness cannot read or set — so a ladder driven by
`step()` alone photographs tick boundaries only, at whatever `lastFrameMs` happened to
be, and would miss the interpolation the whole package lives in. The weight ladder
therefore alternates `step(1)` with hand-pumped `renderer.frame(alpha, FRAME_MS)` at a
fixed `FRAME_MS`, walking alpha across each tick, and records the measured `stepJumpMs`
the way `blast-captures.ts` does. `gait-captures.ts`'s `git show` interception is the
wrong instrument here for one reason its own header already gives about the opposite
case: it photographs before-ART by answering GLB fetches from another revision, and this
package's change is CODE. The "before" is taken by running the harness at the branch base.

**R-Q — The acceptance instrument is numeric as well as photographic, and the numeric
half is what actually witnesses this package.** The layer-toggle A/B cannot see motion —
there is no layer to hide, because the hull draws either way and hiding `units` moves the
same pixels with weight or without it. What replaces it is a per-frame readback of the
DRAWN transform against the sim's own position and heading, printed as a ladder: drawn-vs-true
offset in tiles, pitch and roll in degrees, and the settle's overshoot and return. It is
reference-free in the same sense the toggle is — it never asks what the frame looks like
— and it measures R-C's bound directly, on the running game, instead of trusting a pure
spec to have covered the parameter set that shipped. A zero across every rung is a
FAILURE, for the reason `debug-layers.ts` gives about zero deltas: a model wired to
nothing reads exactly like a model at rest.

---

## Constraints that bind every task

Copied into the plan's Global Constraints verbatim.

- **The four invariants.** The sim ticks at a fixed 20 Hz and the renderer interpolates;
  `@lions/sim` is Q16.16 with no floating point; randomness is the seeded per-entity
  PRNG; data flows commands → sim → state + events, one way. **This package's diff under
  `packages/sim/` is empty** — `git diff --stat <base>..HEAD -- packages/sim` must print
  nothing at landing. `pnpm test:determinism` is in the gate line anyway, because "cannot
  move" is a claim and the gate is the evidence. Every clock touched here is the FRAME
  clock, through `frameDtMs`/`frameDtSeconds` (`ThreeRenderer.ts:4679-4687`), never raw
  `dtMs` and never a sim tick. No presentation value is ever read back by the sim.
- **The colour pipeline is the standard one and its two surviving rules still bite.**
  Nothing here adds a colour; if anything ever does, vertex and uniform colours are
  LINEAR (`hexToLinear`) and ground albedo alone stays `NoColorSpace`.
- **Render-order bands come from `units/render-order.ts`**, the single source of truth.
  Nothing here changes a band: the hull stays at 0 and the turret at 1.
- **`three` may only be imported under `packages/render/src/three/**`**, enforced by
  eslint; the rule's `paths` entry does not catch subpath imports (`three/addons/...`),
  so keep those inside by discipline. **`@lions/render` may not import `@lions/data`**
  (`eslint.config.mjs:138-147`) — a raw `data/*.json` relative import is the sanctioned
  route and has two production precedents (R-I). **This package adds no `api.ts` member
  and no dynamic-import door.**
- **Pixi owes no parity.** `packages/render/src/renderer.ts` stays byte-identical to
  `main`; none of the new code is reachable from it.
- **The file boundary with Lane A** (`2026-09-16-shell-upgrade-design.md:489-508`). This
  session owns `packages/render/src/three/units/mesh-*.ts`,
  `packages/render/src/three/ThreeRenderer.ts`, `tools/src/perf/*`, `art/meshes/**`,
  `assets/meshes/**` and CLAUDE.md's "Mesh units" section. **Do not touch
  `packages/app/**`** (the shell programme's, `main.ts` included) and **do not touch
  `three/units/overlays.ts` or `three/units/overlay-geometry.ts`** — Lane A's Tasks 15–16
  hold those and land first (R-E).
- **The pure model imports neither `three` nor `Sim`.** `three/units/vehicle-weight.ts`
  takes plain numbers and returns plain numbers, the way
  `three/units/vehicle-fx.ts` already does for the ambient effects, so it is testable
  with no `WebGLRenderer` and presentation-only by construction.
- **No `any`, no non-null assertion in new code.** Strict TypeScript; tests colocated as
  `*.test.ts`; the three-side suites run under `environment: 'node'` and, where they
  construct a `ThreeRenderer`, mock `WebGLRenderer` exactly the way
  `ThreeRenderer.collapse.test.ts:38-55` does.
- **Every check gets an input that makes it fail — constructed, and run.** Each task
  names the mutation that turns its test red and the commit message says it was seen red.
  Sign flips are the cheapest and most valuable mutation in this package: half of what it
  computes is a signed angle.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test &&
  pnpm validate:data`. Plus `pnpm test:determinism` once, on the `ThreeRenderer` task.
  Nothing here needs `validate:assets`, `validate:meshes`, `validate:ui`, `balance` or
  `playtest` — no new PNG, no new GLB, no UI source, no sim change. (`validate:meshes` is
  what the wheel half would have needed, and R-J puts that out of scope.)
- **Git hygiene:** commit with explicit paths (`git add <paths>` /
  `git commit -s -- <paths>`), never `-A` — other sessions share this working tree; never
  `git checkout -- <file>`; DCO `-s`; the trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` verbatim.
- **Do not kill the dev server.** No `pkill -f vite`, ever. The harness starts and stops
  its own through `ensureDevServer`/`stopDevServer` (`tools/src/golden-diff/browser.ts`),
  which kills the process GROUP it created and nothing else.

---

## Architecture

### The pure model — `three/units/vehicle-weight.ts`

Two halves in one file, no `three` import, no `Sim` import, mirroring
`units/vehicle-fx.ts`'s split of "pure decision math here, dispatch in `ThreeRenderer`".

**Terrain conform, no history.**

```
hullCornerOffsets(facingNorm, halfLengthTiles, halfWidthTiles)
    → { frontX, frontY, rearX, rearY, leftX, leftY, rightX, rightY }   (tile offsets)
terrainPitchRad(frontGroundY, rearGroundY, lengthWorld) → radians, + is nose-up
terrainRollRad(leftGroundY, rightGroundY, widthWorld)   → radians, + is right-side-down
```

The half-extents come from `vehicleMeshBounds` (`bounds.x / 2`, `bounds.z / 2`), already
measured from the shipped GLB and already stored (`ThreeRenderer.ts:4088`) — no authored
footprint table, and nothing to go stale when a vehicle is re-exported. On a map with no
`elevation` grid all four samples are equal and both functions return exactly 0, which is
what makes three of the four gated scenarios provably unmoved.

**Dynamic weight, per entity.**

```
interface VehicleWeightArrays {          // Float64Array/Uint8Array, owned by ThreeRenderer
  smoothedSpeed, smoothedHeading, lagX, lagY, pitch, roll, settle, settleVel: Float64Array
  seeded: Uint8Array
}
interface VehicleWeightInput {
  entityId, speedTilesS, headingTurns, trueX, trueY, dtSeconds
  params: VehicleWeightParams                  // resolved once per type
}
interface VehicleWeightOutput { drawX, drawY, pitchRad, rollRad }

stepVehicleWeight(arrays, input) → VehicleWeightOutput
```

The shape is `stepTurretFacing`'s (`frame-state.ts:436`), deliberately: persisted
`Float64Array`s mutated in place, a `seeded` `Uint8Array` consulted first, `dtSeconds`
from `frameDtSeconds`, and a return value the caller writes onto the object. Per-entity,
because a group order does not land vehicles on the same tick — `formation.ts` assigns
slots and each unit reaches its own by the ordinary flow-field walk, so a shared filter
would be wrong the moment two vehicles in one order stopped a second apart.

`VehicleWeightParams` carries the authored numbers: `maxPitchRad` (±2°, R-M),
`maxRollRad`, `accelSeconds` (the smoothing time constant), `settleSeconds`,
`settleDamping` and `lagTiles`. Resolution order is JSON override → role default →
throw-free fallback, and it is a pure function of its inputs so it is tested without a
renderer.

**The bound (R-C, R-K).** `stepVehicleWeight` clamps its own position output to
`lagTiles`, and a spec sweeps the whole shipped parameter set across the roster's speed
range and asserts `hypot(drawX − trueX, drawY − trueY) + MESH_HULL_RECOIL_TILES ≤ 0.25`
at every sample, plus `=== 0` exactly whenever `speedTilesS === 0`. That second assertion
is R-G's: it is the one that keeps the `vehicle` baseline still.

### The authored parameters — `mobility.weight`

`data/schemas/unit.schema.json`, inside `mobility` (which is
`additionalProperties: false`, so the schema must name it):

```json
"weight": {
  "type": "object",
  "additionalProperties": false,
  "description": "Presentation only. How the DRAWN hull leans, lags and settles; read by the three.js renderer and by nothing in the sim. Absent means the role default.",
  "properties": {
    "mass_class": { "enum": ["light", "medium", "heavy"] },
    "pitch_deg":  { "type": "number", "minimum": 0, "maximum": 6 },
    "roll_deg":   { "type": "number", "minimum": 0, "maximum": 6 },
    "lag_tiles":  { "type": "number", "minimum": 0, "maximum": 0.09 },
    "settle_s":   { "type": "number", "minimum": 0, "maximum": 1.5 }
  }
}
```

`mass_class` is the cheap authoring surface and the four numbers are the escape hatch;
the renderer maps the class to a number set and any explicit number overrides it. The
ceilings are the spec's own constraints made mechanical: `lag_tiles` maxes at **0.09**
because R-K's combined budget is 0.25 and the recoil already owns 0.16, so an author
cannot write a value that breaks R-C even if the pure spec were removed. `pitch_deg`'s 6
sits just above the recoil's 3.4° for the same reason the recoil sits above ±2°.

**Role defaults** live in `three/units/vehicle-weight-params.ts`, keyed by
`UnitType.role` — a fact the sim already parses and the renderer already has, so there is
no second hand-kept id table of the `VEHICLE_TRACK_KIND` kind. The roster's vehicle roles
are `mbt`, `ifv`, `apc`, `technical`, `recon`, `artillery`, `aa`, `gunship`, `drone`.
Nothing foot can reach the table: `updateVehicleMeshes` gates on
`vehicleMeshTemplates.has(type.id)`, and only the eleven types with a shipped
`art/meshes/vehicles/*.glb` have one — which is also why `manpad_team`, classed as
`wheeled` by the `FOOT_ROLES` default and genuinely four men with a launcher, never gets
a hull tilt.

Air is excluded outright on `type.isAir`: `heli_peten` and the drones fly, they already
take `AIR_LIFT_PX`, and a helicopter conforming to the ground under it would be a bug
with a straight face.

### The renderer region — `ThreeRenderer.ts`

One task, three adjacent places, and nothing reordered:

1. **New per-entity arrays** beside `rotorPhase`/`vehicleMoving` (`:1190-1230`), allocated
   in the constructor beside `this.rotorPhase` (`:1744`-region), with their `seeded`
   companion.
2. **`updateVehicleMeshes`** (`:5248`): four `groundWorldY` calls in place of one; a
   `stepVehicleWeight` call composed after the hull-recoil block (`~:5348`) and before the
   turret block (`:5353`); and `entity.root.position`/`quaternion` written once from the
   composition (R-K) instead of `position.set` + `rotation.x` + `rotation.y`. The turret's
   own `deltaYaw` derivation is unchanged, because it is a delta against the hull's yaw
   and the hull's yaw has not moved — only the axis the tilt is taken about.
3. **`updateVehicleAmbientFx`** (`:3643`): the dust interval becomes
   `vehicleDustIntervalMs(speed, accel)` and the anchor takes the drawn position (R-O).
   The accumulators keep feeding on `frameDtMs(dtMs)`, untouched.

Not touched: `addWreck`'s `hasWreck` guard, the death fork, `updateMeshUnits` (infantry),
`pickUnit`, `worldToScreen`, `threeCamera`, `api.ts`, and every file Lane A holds.

### The instrument — `tools/src/perf/weight-captures.ts`

A retarget of `blast-captures.ts`, inheriting its three hard-won behaviours verbatim (the
frozen frame loop, the explicit frame pumps, subjects spawned rather than found) and
differing in what R-P names:

- **Three phases per subject** — a standing START, a running STOP, and a held TURN — each
  driven by `L.sim.queueCommand({ kind: 'move', ids: [id], … })`, one order per body
  (`gait-captures.ts:741-762`'s reason: a group order lands in formation).
- **The ladder advances the sim.** For each rung: `step(1)`, then `FRAMES_PER_TICK` hand
  pumps of `renderer.frame(alpha, FRAME_MS)` with alpha walking across the tick. The
  measured `stepJumpMs` is read from a dry `step(1)` at boot, printed and written into
  the sheet, exactly as the blast harness does.
- **Subjects** on the open northern band of `beit_sahwan_outskirts` (rows 0–7, open end to
  end): `mbt_lavi` (the roster's slowest and heaviest, 1.1 tiles/s at 60 °/s),
  `technical` (fastest wheeled, 2.6 at 120) and `apc_eitan` (the middle, and the one
  8-wheeler). A fourth run on `tel_marum` for the terrain-conform half, because
  `beit_sahwan_outskirts` has no elevation grid and cannot show it at all.
- **The numeric ladder (R-Q)**, written to `sheet.json` beside the PNGs: per rung, the
  drawn-vs-true offset in tiles, pitch and roll in degrees, and the sim's own speed and
  heading — read back off `__lions.renderer` and `__lions.sim`, never recomputed, for the
  reason `cursorKey()` is a DOM read: recomputing would agree with the logic and tell you
  nothing about the wiring.
- Output root `.superpowers/art-captures/weight/<label>/`, `--label=before|after`
  required, `sheet.md` + `sheet.json` with every capture condition named.

---

## Testing and evidence

**Pure specs, node environment, no browser.** Everything with a curve or a filter is a
pure function with its own test, and each test names the mutation that reddens it:

- `terrainPitchRad`/`terrainRollRad`: zero on four equal samples (the flat-map case, and
  the one that keeps `vehicle` still); nose-up on a rise ahead; right-side-down on ground
  falling to the right; the magnitude is `atan` of the height delta over the span, so a
  vehicle twice as long tilts half as much on the same step. **Falsified by a sign flip.**
- `hullCornerOffsets`: the four offsets rotate with the hull, front is ahead at facing 0,
  and the four are symmetric about the centre at every heading.
- `stepVehicleWeight`: a stationary input at rest returns the identity — offset exactly 0,
  pitch exactly 0, roll exactly 0 (**R-G's pin**); a standing start reaches the authored
  pitch maximum and returns to zero at cruise; a step input does not spike in one frame
  (the smoothing is doing work); roll is zero at zero yaw rate and reaches the maximum at
  the unit's own `turnPerTick` and no further (R-L); the settle overshoots once and
  returns; `seeded` makes an entity's first frame start from its current speed rather than
  the zero-fill (R-N).
- **The bound spec (R-C, R-K):** sweep every shipped parameter set across 0 → the
  roster's fastest speed and assert the combined drawn-vs-true offset never exceeds 0.25
  tile. **Falsified by raising one `lag_tiles` past the schema's own ceiling**, which must
  redden the spec AND fail `pnpm validate:data`, because a constraint enforced in one
  place only is a constraint with one way around it.
- `vehicleDustIntervalMs`: monotonically shorter as speed rises, floored so it cannot
  outrun the frame clamp, and equal to today's constant at today's reference speed so the
  existing ambient-FX suite passes unchanged.
- `vehicle-weight-params.ts`: a role with no JSON gets the role default; a JSON override
  wins; **every `art/meshes/vehicles/*.glb` has its unit JSON imported here**, read from
  the directory at test time (R-I).

**Renderer-region specs** in a new `ThreeRenderer.vehicle-weight.test.ts`, under the
headless `FakeWebGLRenderer` mock `ThreeRenderer.collapse.test.ts:38-55` already proves
works:

- A parked vehicle on flat ground, stepped a hundred frames, has `position` equal to its
  sim position to the bit and a quaternion equal to yaw alone. This is the golden gate's
  own case, asserted where it can be asserted cheaply.
- The tilt is hull-local at every heading: set a pitch, read the hull's forward axis in
  world space, and require the nose lift to be the same at facing 0, 0.25 and 0.75 —
  **the assertion that would have caught the shipped recoil defect**, and the one this
  package's R-K exists to satisfy.
- A dying vehicle's weight state is not advanced after `alive` goes to 0 (R-F).
- `pickUnit` returns the same entity for the same click while the hull is lagged (R-C).

**The captures (R-G) are the acceptance evidence**, and the numeric ladder (R-Q) is what
makes them checkable. Before-set at the branch base, after-set at the head, both quoted in
the PR body with their conditions — machine, GL backend, viewport, zoom, tick,
`stepJumpMs` — because a first golden-diff run once read 6.5× high purely from screenshot
downscaling and a font-load race.

**The golden gate.** `pnpm golden-baseline` runs for information. `quiet`, `open-ground`
and `vehicle` stand on maps with no `elevation` grid, so the terrain half is arithmetically
zero there and the parked force makes the dynamic half zero too — those three must not
move, and a red one is a defect to find. `relief` (`tel_marum`) is the one gated scenario
on real relief; whether it moves is **measured in the renderer task rather than predicted
here**, since it frames the boulder corridor with a drone and the sandbox force sits thirty
tiles away. If it does move, it is because a vehicle is parked on a slope and is now drawn
standing on it, which is the feature — one bless, from CI numbers, never from the local
darwin baseline (stale since 2026-09-03), serialised against Lane A's own landing.

---

## Out of scope

- **Wheel spin and track-UV scroll** (R-J) — the other half of GH-177's own bullet. Needs
  per-vehicle geometry that does not exist: road wheels cut out of welded low-poly scans,
  a pivot at each measured axle centre, the track run on its own material and UV set, and
  a re-export against `.blend` sources that live only in the main checkout. Open
  question 1.
- **Turret lag** (R-A) — already ships as a damped spring. A different FEEL is a constant
  change and a sentence at G1, not this package. Open question 2.
- **Any `packages/sim` change** (R-H). No acceleration model, no per-tick ramp, no new
  field on `UnitType`. If the lead would rather the weight parameters travel on
  `UnitType`, that is a cleaner wiring than R-I's and it is open question 3.
- **Any `packages/app` change.** `main.ts` is the shell programme's until the boundary
  says otherwise, which is why `RendererOptions` is not the route (R-I).
- **Suspension bounce.** Named nowhere — not in the issue, not on the art page, not in the
  execution plan. The settle on stop is a decay to rest, not a spring the hull rides. Do
  not invent a bounce mechanic without the lead adding it at G1.
- **Fixing the shipped recoil tilt as its own change.** R-K fixes it as a consequence of
  composing in the hull's frame and says so; a standalone recoil-feel pass is not this
  package.
- **A gated `weight` visual scenario** — a scripted vehicle in motion at a pinned tick,
  which is what would let the golden gate see this package at all. Real work, its own
  package, and it has the same shape as the `blast` scenario the last sub-project also
  left open.
- **Pixi.** No parity owed; `renderer.ts` stays byte-identical.

---

## Open questions for the lead

Only what this page leaves open. All three want an answer at **G1 (#165)**, and the first
two should be answered *before* the plan's Task 6, because they change what lands.

1. **The wheel and track half of GH-177 — defer, or fund the art?** R-J's measurement is
   that it cannot be done by naming a pivot: no shipped GLB has a wheel or a track that
   can be addressed, four have no UVs on their rubber at all, and the seven that do share
   the hull's material. Doing it means a per-vehicle geometric re-cut and re-export —
   which is exactly what the issue's "a numbers table per vehicle (wheel radius, track
   pitch) approved at G1" was pricing, at a cost nobody had measured until now. The
   options are: ship the hull half alone and open a wheel package (recommended — a hull
   that leans and settles reads as weight with static wheels, and the reverse does not);
   ship nothing until both are ready; or fund one vehicle as a pilot (`apc_eitan`, whose
   eight road wheels are still separate objects in `author_eitan.py` and are merged only
   at export, so it is the one vehicle where the cut is a change to an export script
   rather than surgery on a scan).

2. **Does A1.3 owe a turret-feel change at all?** R-A: turret lag ships and works. The
   parent task prompt asked for it; the issue, the page and the execution plan did not.
   If the answer is "leave it", this page is already right. If it is "heavier hulls
   should traverse slower", that is one constant in `frame-state.ts` and belongs in this
   package rather than a later one — but it is a feel judgement and should be made
   against the after-captures, not before them.

3. **Should the weight parameters travel on `UnitType` instead?** R-I's route works and
   has two production precedents, but it means the renderer imports eleven unit JSONs by
   relative path with a test pinning the list. Carrying one optional passthrough field on
   `UnitType` would be cleaner to read and would put the numbers where every other
   per-type fact already lives — at the cost of a `packages/sim` edit that R-H forbids,
   for a field the sim never reads and the determinism hash cannot see. **Recommendation:
   keep R-I for this package** (it is provable in one gate run and touches nothing
   load-bearing) and revisit if a second presentation-only per-type field ever needs the
   same route, because two would make the case that R-H's line is drawn in the wrong
   place.
