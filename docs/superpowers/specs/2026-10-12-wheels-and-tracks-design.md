# Wheels and tracks turn — the second half of GH-177 — Design

> Art lane, vehicle weight, part 2. Branch `art/wheels-tracks`, worktree
> `roaring-lions-ep/wheels-tracks`, base `main@2a65cc41`.
> **Phase 1 only: measure and design.** No GLB is touched until the lead has
> approved the table below. The build has to start after `art/kit-leftovers`
> merges, because both branches rewrite the same vehicle GLBs and a binary
> conflict cannot be merged.

---

## For the lead: what needs your approval before anything is built

Every number below was measured from the shipped bytes on 2026-10-12 (method in §1).
Nothing is rendered or re-exported until these are approved.

| # | Decision | Proposed | Alternatives |
|---|---|---|---|
| A1 | **Wheels spin** | `jeep_shoded`, `scout_shachaf`, `apc_kipod`, `apc_eitan`, `technical`, `gun_truck`, `rocket_battery`, and the Namer's 6 road wheels a side | add the Lavi's road wheels (see A3) |
| A2 | **Tracks scroll** | `ifv_namer`, `mbt_lavi` (and `officer_armour`, which copies it), `dozer_d9` | — |
| A3 | **Lavi road wheels** | **do not spin.** They are 0.25 m in radius (about 7 px at zoom 1). The Meshy scan cuts them in half at y = 0.44, and each side has one wheel position with a hub and no tyre (§1) | spin them anyway (+438 split vertices) |
| A4 | **D9 road wheels** | **do not spin.** The track roller frame is in the same `rubber` mesh and passes through every wheel disc in side view | spin them, with a sideways slab cut per wheel |
| A5 | **`demo_tzav`** | **wait for E6.** It is held art. Its staged JSON says `wheeled: true`, but the mesh is tracked (8 road wheels a side, r ≈ 0.24) | do it in this package as tracked |
| A6 | **Tread pattern** (no new texture) | dark bars across the track drawn in the shader: **pitch 0.30 m**, bar 35% of the pitch, darkening 0.35 with the average brightness unchanged. The bars fade out when a bar is under about 3 px. A real link pitch is about 0.17 m, but at zoom 1 that is 2.5 px and it moiré-patterns | 0.20 m (only readable from zoom 1.5; it also flickers backwards at 30 fps on the Namer, §3.3) |
| A7 | **Tread at rest** | **hidden.** The bar strength ramps from 0 to full as track speed goes from 0 to 25% of cruise, so a parked vehicle draws exactly as it does today and no golden baseline moves | always shown (needs a re-bless of `vehicle`, `kitted` and `relief`) |
| A8 | **Top wheel spin speed** | **15 rad/s**, at most 29° per frame at 30 fps. At cruise the jeep would turn at 20.2 rad/s and the technical at 24.7, so they draw 26% and 39% slower than true | no cap: wheels appear to spin backwards at 30 fps on both |
| A9 | **Steering** | front axle only, on `jeep_shoded`, `scout_shachaf`, `technical`, `gun_truck`. Up to **20°**, and lower where the pass measures that the tyre would hit the body | none in v1; or add the Kipod and Eitan front axles |
| A10 | **Wheeled vehicle turning on the spot** (the sim allows it) | left and right sides turn in opposite directions, like skid steering, same as tracks | wheels stand still |
| A11 | **Hull facing away from where it is moving** (it moves at full speed while still turning, §3.1) | wheels and tracks run **backwards**: the drive speed is the signed forward part of the motion | always forwards |
| A12 | **Draw-call budget** | **+0**, measured with `kit-drawcalls.ts` on all ten fielded ground vehicles; +1 shader program per vehicle type | — |

**Nothing makes the split impossible.** Two vehicles are recommended against on
cost/benefit (A3, A4), and one is deferred because it is held art (A5).

---

## What changed since R-J (2026-09-20)

The weight spec's R-J table is **stale on one fact, and that fact was the
blocker.** It said four vehicles had no UVs on `hull_rubber`, and that the other
seven shared the hull's material. Since the Meshy re-exports (2026-09-30 to
10-02), **all twelve ground-vehicle GLBs carry `TEXCOORD_0` on `hull_rubber`.**
Every one points it at the vehicle's one baked material, the same one
`hull_hull` uses (`technical` has two materials, and its rubber uses the hull's).
CLAUDE.md's weight bullet still repeats the stale claim. The rest of R-J
still holds:

- no `wheel_*` or `track_*` node exists;
- wheels and tracks are merged by role, never by part;
- a UV scroll on the shared material would scroll the whole vehicle;
- and a Meshy bake's UVs are an atlas of islands, not a strip, so **a UV scroll
  is the wrong tool even where UVs exist.** Offsetting atlas UVs pulls
  neighbouring islands' texels onto the track.

That last point is why the track half of this design is drawn by the shader
(§3.3), not done by scrolling UVs.

---

## 1. Per-vehicle measurements

**Method** (scratch scripts, not committed):

1. Read each `art/meshes/vehicles/<id>.glb` with gltf-transform, skipping
   `WRECK_*` and `kit_*`.
2. Union-find the `hull_rubber` triangles into connected parts, after welding
   positions to 0.1 mm, and print each part's bounding box.
3. Plot a side view of every hull mesh for each side (+Z and −Z), with rubber
   highlighted.
4. Fit each wheel by iterating a bounding-box centre and radius over the
   vertices inside a seeded disc. Where a wheel is a clean separate part, the
   radius comes from that part's bounding box, because the disc fit picks up
   hull faces that cut through the disc.

Units are GLB units, and **1 GLB unit = 1 m** (`MESH_UNITS_PER_TILE` = 3, one tile
is 3 m). +X is forward, +Y is up, +Z is the hull's physical right.

On screen, `TILE_W` = 64 px across a 4.24 m tile diagonal gives about **15 px/m at
zoom 1** and **38 px/m at zoom 2.5** (CSS px, DPR 1).

### Wheeled

| id | side | layout | radius (m) | axle x (front last) | axle y | how the rubber is split today | wheel tris tagged (est.) | split vertices |
|---|---|---|---|---|---|---|---|---|
| `jeep_shoded` | KDF | 4×4, 2 a side | 0.43 | −1.27, 1.64 | 0.43 | 4 separate tyres + 4 separate hubs, clean. The rubber also holds 4 fender flares (2 m long) and 2 bumper strips, all outside the wheel radius | ≈5,700 | ≈870 |
| `scout_shachaf` | KDF | 4×4 | 0.536 | −1.40, 1.41 | 0.537 | 4 separate tyres, clean, plus 4 separate fenders | ≈2,300 | ≈210 |
| `apc_kipod` | KDF | 6×6, 3 a side | 0.755 | −1.96, 0.17, 2.30 | 0.75 | 6 separate tyres and 6 separate hubs, clean | ≈3,300 | ≈360 |
| `apc_eitan` | KDF | 8×8, 4 a side | 0.66 | −2.14, −0.74, 0.72, 2.29 (−Z front 2.32) | 0.66 | **one part per side**: the tyres are fused to the wheel-arch liners. The radius cut keeps the arches static. One front-left tyre is a separate part | ≈4,700 | ≈470 |
| `technical` | enemy | 4×4 | 0.312–0.319 | −1.19, 1.69 | 0.307 | 4 separate tyres, clean | ≈2,900 | ≈480 |
| `gun_truck` | enemy | 4×4 | 0.425 | −1.47, 1.77 | 0.415 | 4 tyre parts + 4 hubs. **Part of each tyre sits in `hull_hull`** | ≈750 | ≈80 |
| `rocket_battery` | enemy | 6×6, 3 a side | 0.48 | −1.79, −0.90, 1.96 | 0.48 | the rear bogie and the front axle are **each one part spanning both sides**, so the pass splits them by the sign of z. The rims are in `hull_plate` | ≈11,400 | ≈900 |

### Tracked

| id | side | road wheels a side | radius (m) | axle y | track loop a side | notes |
|---|---|---|---|---|---|---|
| `ifv_namer` | KDF | 6 at x ±0.56, ±1.67, −2.85, +2.86 | ≈0.49 (fit 0.51–0.54 includes the track) | 0.54 | **≈15 m**. The convex-hull bound of 16.1 m includes the skirts | road wheels are **fused into the track loop** (one part per side). The cut radius of 0.44 stays inside the track's inner face. ≈1,840 wheel tris, ≈290 split vertices |
| `mbt_lavi` | KDF | 7 stations at ≈0.55 m pitch, from x −2.40 to 1.17 (+Z) and −2.32 to 1.03 (−Z) | 0.25 | 0.33–0.36 | **≈5 m visible** (lower run 4.19 m, x −2.73…1.46, plus front and rear ramps). The upper run is hidden by the hull | asymmetric scan: on each side one station is a hub with no tyre (+Z at x −1.14, −Z at x 0.50). The rubber is a horizontal slice at y = 0.44, so the wheels' upper halves are `hull_hull`. See A3 |
| `officer_armour` | held (GH-298) | as `mbt_lavi` | | | | `export_officer_armour.py` re-opens the shipped Lavi; see §2.4 |
| `dozer_d9` | KDF | 5 at x −2.89 (rear), −1.69, −0.77, 0.29, 1.37 | ≈0.41 | 0.64–0.86 | **≈13 m** (hull bound 13.8 m) | track with grousers. The `rubber` role also covers the **track roller frame**, which crosses every disc in side view. See A4 |
| `demo_tzav` | held (E5→E6) | 8 at ≈0.6 m pitch, x −2.7 … 1.5 | ≈0.24 | 0.43–0.54 | **≈13.5 m** (hull bound 15.4–15.7 m includes the fenders) | staged JSON says `wheeled: true`. See A5 |

Both the wheel-tris and split-vertex figures are estimates from a disc-plus-side-slab cut. Phase 2
recomputes them exactly, and the gate holds them to this table (§4).

**Triangle cost: +0 everywhere.** No face is created or deleted. What grows is
vertices: those on the wheel boundary get duplicated (column above, 80–900 a
vehicle). There are also two per-vertex attributes:
- `_RL_WHEEL`, 1 B a vertex, on each hull mesh that has wheel faces;
- `_RL_TRACK`, 4 B a vertex, on `hull_rubber` of tracked vehicles only.

Together that is under 60 KB raw per vehicle before Draco.

**Can the source split cleanly? Not for any of them, and it does not need to.**
Every one of the twelve is a Meshy welded shell. The exporters already sort out
the tyres by a geometric disc test around axles they find themselves:
- `export_meshy_eitan.py`, `export_meshy_apc.py`, `export_meshy_ramp.py`,
  `export_meshy_truck.py` and `export_meshy_gun_truck.py` use `WHEEL_R`/`WHEEL_AY`
  and axle seeds;
- `export_meshy_tank.py` records the Lavi's tracks as welded into the hull
  component.

No source has a separate wheel object to keep. The one that once did
(`author_eitan.py`'s eight wheels) belongs to a retired palette model. Going back
to the `.blend` sources (gitignored, main checkout only) would only repeat the
same disc test, and would re-bake and re-decimate on the way. §2 does the disc
test on the shipped bytes instead.

**Out of scope:**
- air units (`attack_drone`, `heli_peten`, `heli_peten_gunship`, `loiter_drone`,
  `paramotor` including its trike wheels, `recon_drone`);
- `moto_rpg`, a rigged team rather than a vehicle GLB, which already spins its two
  `*_wheel<n>` bones in its clips (`rig.py`; `motion/ground.ts` keeps their axles
  grounded).

---

## 2. The split: a gltf-transform pass, not Blender

### 2.1 Decision

**`pnpm running-gear:meshes` (`tools/src/meshes/running-gear-pass.ts`)** is a
gltf-transform post-pass over `art/meshes/vehicles/<id>.glb`. Like `wreck:meshes`, it is
driven by a literal per-vehicle table (`running-gear-recipes.ts`): axle seeds,
radius, cut radius, side slab, steer flag and loop seeds, copied from §1.

Why not Blender:
1. **The sources add nothing.** As §1 shows, it is the same disc test either way.
2. **It is reproducible and idempotent.** A Blender re-export re-decimates and
   re-bakes. A gltf-transform pass over the shipped bytes writes the same bytes
   on a second run, which is the same guarantee `kit:meshes` makes.
3. **It does not disturb the other passes.** The pass keeps every existing
   vertex as a prefix and only appends (§2.2), so the wreck pass's measurements
   (bounds, clearance, lowest vertex) cannot move. That matters because moving a
   wheel face out of `hull_hull` would change `clearance` and with it every
   wreck pose. The kit graft's hosts are not re-cut either.
4. **No source needed.** It runs in CI's Node environment with no Blender and no
   gitignored sources.

### 2.2 What the pass writes

- **No new meshes and no new nodes.** The brief suggested `wheel_<side>_<n>`
  nodes with a pivot at the axle. A node with a mesh is +3 draw calls per wheel
  (main, shadow and AO pass): +24 on an Eitan, and about +700 for thirty vehicles
  on screen. That lands on the documented bottleneck (draw-call submission,
  74–84% of `render()`). Empty pivot nodes would cost nothing to draw, but every
  node-walking reader would have to learn to ignore them. That includes the wreck
  pass, which keys scale on every top-level live node, and the shipped-contract
  test, portraits, ring footprints and the two exporters that re-open a shipped
  vehicle. So the axles go where `rl_gait` already set the precedent, on the
  scene:
  - **scene `extras.rl_running_gear`**:
    `{ wheels: [{ side: 'r'|'l', index, centre: [x,y,z], radius, steer, maxSteerRad }],
    tracks: [{ side, loop: [[x,y,r]…], loopLength, pitch }] }`.
    Here `r` = +Z = physical right, pinned by a test, because the weight code's
    corner names already mislead once. Wheel `index` 0 is the frontmost.
- **`_RL_WHEEL`** (UNSIGNED_BYTE, scalar) on every live `hull_*` primitive that
  has wheel faces: 0 = static, k = wheel k−1. **A face is a wheel face when its
  centroid is within the cut radius of an axle in side view and inside that
  wheel's side slab.** The cut radius is just under the tyre for wheeled
  vehicles (0.99 r) and inside the track's inner face for tracked (≈0.9 r), so
  arches, fenders, track links and the D9's frame stay static. Vertices shared
  between a wheel face and a static face are **duplicated and appended** (never
  reordered), so a rotating wheel never drags a fender. The boundary is a circle
  about the axle, so rotation opens no crack wider than the scan's own deviation
  from round, which the gate measures (§4).
- **`_RL_TRACK`** (FLOAT, scalar) on `hull_rubber` of tracked vehicles: the
  distance in metres along that side's track loop (−1 = not track). The loop is
  the convex hull of the recipe's wheel circles, each grown by the track
  thickness. A face is track when it lies within the band of that loop and
  outside every wheel disc. The seam goes at the top rear, where the hull hides
  it. Each pitch is rounded to `loopLength / round(loopLength / pitch)` so the
  bars meet at the seam.
- It **refuses** to run:
  - on an id with no recipe;
  - when a recipe axle has no vertices in its disc;
  - when two wheels' discs overlap within a side;
  - when a tagged vertex is outside its declared radius by more than 2 cm;
  - when a tracked recipe has no track faces.

### 2.3 Order, and how it fits with kit, wreck and encode

`export → running-gear:meshes → kit:meshes → wreck:meshes → encode:meshes`.
Like the wreck pass's rule, this order is load-bearing:

- **Kit parts.** The contract says a kit part carries *exactly its host's
  attribute set*, and `mergeGeometries` refuses a mismatch. So:
  - `kit:meshes` learns one rule: when grafting onto a host that carries
    `_RL_*`, zero-fill the same attributes on the part (`_RL_WHEEL` = 0,
    `_RL_TRACK` = −1);
  - `running-gear:meshes` does the same for kit parts already present, so either
    order of re-runs converges;
  - no shipped kit part is hosted on `hull_rubber` today (hosts are `hull_hull`,
    `hull_metal`, `turret_*`), so a kit part never turns.
- **Wreck twins.** A `WRECK_` twin references the same `Mesh`, so it carries the
  attributes. **A wreck's wheels do not turn** for two independent reasons:
  - its material is `charredFor(original)`, built from the unpatched bake;
  - the dead entity leaves `vehicleMeshEntities`, so nothing updates its angles.

  The wreck pass is unchanged. Its `DROP_ROLES` already keeps `rubber` on the
  ground, and with no vertex moved its measurements are byte-identical.
- **Draco.** `encode:meshes` uses gltf-transform's `draco()`. Custom attributes
  encode as GENERIC: `_RL_TRACK` is quantised at 12 bits (≈3.7 mm over a 15 m
  loop) and `_RL_WHEEL` stays integer. `GLTFLoader`'s Draco extension maps
  `_RL_WHEEL` to `_rl_wheel`. **Unverified until phase 2**, so §4 gates it.
- **`officer_armour`.** `export_officer_armour.py` re-opens the shipped Lavi and
  must ignore `_RL_*` and `rl_running_gear` (it already ignores `kit_*`). The
  pass then runs on `officer_armour` with the Lavi's recipe.

### 2.4 Readers that must learn about it

These must ignore or carry the new data, and each needs a test:
- `mesh-vehicle-shipped.test.ts` (reads the contract from the bytes);
- `validate_mesh_assets.py` (§4);
- `export_officer_armour.py`;
- `export_meshy_apache_gunship.py` (it re-opens the Peten, which has no running
  gear, so it is unaffected);
- `render_unit_portraits.py`, and the Blender importer under `validate:meshes`.
  Blender imports `_`-attributes as mesh attributes, which is harmless; the first
  gate run in phase 2 confirms it.

The contract gains a **v7 (vehicles): running gear** section in
`2026-08-28-mesh-unit-contract.md`.

---

## 3. Runtime

### 3.1 The drive signal

- **Speed: signed forward speed, from the weight model's own smoothed speed.**
  `v = smoothedSpeed × 3 m/tile × cos(travelBearing − hullHeading)`.
  - `smoothedSpeed` is `vehicle-weight.ts`'s ramp, so wheels speed up and slow
    down exactly as the hull pitches.
  - `travelBearing` is the bearing of the same tick delta that produced
    `entitySpeed`.
  - `hullHeading` is the weight model's `smoothedHeading`.

  The cosine is not decoration. `stepMovement` (`sim.ts:5428-5452`) moves a unit a
  full `stepPerTick` along its route while `turnToward` turns the hull at the
  unit's `turn_rate_deg_s`. A Lavi reversing its route spends three seconds
  sliding backwards at 60°/s, and with the unsigned speed its tracks would run
  forwards the whole time (A11).
- **Yaw rate:** `ω = smoothedYawRate × 2π` rad/s, the weight model's second
  stage, already free of the 20 Hz staircase.
- **Per-side ground speed:** `v_side = v ± ω · g_side`, where `g_side` is the
  mean |z| of that side's wheels or loop. The sign is pinned by a test: the
  outside of the turn runs faster, and turning on the spot runs the two sides
  opposite (A10).
- **Clock:** the frame clock, through `frameDtSeconds` (100 ms ceiling, 0 during
  hit-stop), never raw `dtMs`. That is the 2026-09-18 drift rule. The renderer
  only reads from the sim (invariant 4). The sim, the determinism hash,
  `playtest` and `balance` do not move.
- **State:** per entity id, with a `seeded` companion like every other array in
  `ThreeRenderer`:
  - `wheelAngle[16]` per entity, each kept modulo 2π on the CPU (`Float64`), so a
    long mission never loses float32 precision in the shader;
  - `trackPhase[2]`, kept modulo 1;
  - `steer`.

  A pure module, `units/running-gear.ts` (no `three`, no sim import), like
  `vehicle-weight.ts`.

### 3.2 Wheels

- **Angle:** `θ_k += clamp(v_side / r_k, −ω_max, ω_max) · dt`, with
  ω_max = 15 rad/s (A8).
- **Steering** (A9, flagged wheels only):
  - `δ = atan(wheelbase · ω / v)`;
  - faded to 0 below 0.5 m/s, so turning on the spot does not crab the front
    wheels;
  - clamped to `min(20°, maxSteerRad)`, where `maxSteerRad` is measured per wheel
    by the pass (§2.2): the largest yaw at which no tyre vertex enters the body's
    sideways envelope at its height.
- **Vertex shader**, in an `onBeforeCompile` chunk after `begin_vertex` and
  `beginnormal_vertex`:
  - `k = int(_rl_wheel + 0.5) − 1`;
  - if `k ≥ 0`, rotate `transformed − axle_k` about the wheel's own axis (+Z),
    then by the steer yaw about +Y, and add the difference back. The normal is
    rotated the same way.
  - **Written as `p + (R·d − d)`**, so that at angle 0 the result is `p` bit for
    bit. That is what keeps a parked vehicle, and so every gated golden frame,
    unchanged.
  - Axle centres and radii are per type, as constants on the material. Angles
    are per entity.

### 3.3 Tracks

- **Phase:** `trackPhase_side += v_side · dt / pitch` (mod 1), with
  pitch = 0.30 m (A6).
- **Speed limit at 30 fps:** the fastest tracked vehicle, the Namer at 1.3
  tiles/s = 3.9 m/s, moves 0.13 m per frame. That is 0.43 of a 0.30 m pitch,
  under the 0.5 Nyquist limit. At 0.20 m it would be 0.65, and the bars would
  appear to run backwards. That is half of why A6 is not the real 0.17 m.
- **Fragment shader**, after `map_fragment`, for fragments with
  `_RL_TRACK ≥ 0` (passed as a varying):
  - `phase = _rl_track / pitch − trackPhase_side`, with the side taken from the
    sign of z;
  - an antialiased square wave with `duty` 0.35;
  - **mean-preserving:** `diffuse *= 1 − depth · amp · fade · (bar − duty)`;
  - `fade = 1 − smoothstep(0.25, 0.5, fwidth(phase))`, so the bars give way to
    the bake's own tone well before they could alias;
  - `amp` ramps with |track speed| (A7).
- **No new texture, no new UVs, no new material slot.** The bake still supplies
  the colour, and the bars supply the motion.
- If the static links painted in the bake fight the bars at zoom 2.5, the
  fallback is to sample the bake with a mip bias of +2 on track fragments only,
  smoothing the static detail away under the moving bars. Whether that is needed
  is a call for the lead, made on the captures.

### 3.4 Material, per-entity values, and draw calls

- **Uniforms cannot be shared across instances here, and this was checked.**
  three r170 honours `material.uniformsNeedUpdate` **only for `ShaderMaterial`**
  (`WebGLRenderer.js:2149`). For a `MeshStandardMaterial`, its `onBeforeCompile`
  uniforms are re-uploaded only when the material, program or camera changes.
  Two Lavis sharing one material would therefore both draw whichever wheel angle
  was uploaded first.
- So each **live vehicle entity gets one clone of the patched material**, used by
  its wheel- and track-carrying `hull_*` meshes:
  - the clone shares the program and the textures;
  - the per-type patched original is built once in `buildVehicleMeshTemplate`
    and only in its non-wreck branch;
  - the turret meshes keep the unpatched bake, so the attribute is never read
    from a mesh that lacks it;
  - the clone is disposed with the entity, in the same teardown as its mixer.
- **Draw calls: +0 by construction.** The number of meshes is unchanged, and a
  clone does not add a submission.
- **Shadow and AO passes:** the shadow depth material and the GTAO override
  material do not run the chunk. A spinning near-round wheel has the same
  silhouette and the same normals in both, so they are unaffected. The one thing
  they miss is steering (≤ 20° of front-tyre yaw in the shadow), which is
  accepted.
- **Measured, not asserted:** `tools/src/perf/kit-drawcalls.ts` already counts
  shadow, main and AO submissions by hand. Phase 2 adds:
  - `--ids` covering all ten fielded ground vehicles;
  - a `--running-gear=on|off` column that must read the same count (12 for a
    4-mesh vehicle, 6 for the D9);
  - a print of `renderer.info.programs.length`, expected +1 per vehicle type.

---

## 4. Gates

**No gated golden scenario contains a moving vehicle.** `vehicle` and `kitted`
park the sandbox force, `relief` has two recoiling Lavis and no driving, and
`combat` is report-only. So the golden gate can only confirm **that parked
vehicles did not move (0 px, given A7)**. It cannot see wheels turn. What can:

| Check | Where | What it asserts | Falsification (one-line mutation, run red) |
|---|---|---|---|
| Recipe vs literals | `running-gear-recipes.test.ts` | every recipe's radius and axle x/y match **§1's table as literals** (±2 cm). The test does not take them from the pass, so this oracle does not move when the pass does (the `x * 1.0 == x` lesson) | change one radius in the recipe by 5 cm |
| Bytes | `running-gear-pass.test.ts` | every pre-existing accessor is a byte prefix of its successor; a second run writes the same bytes; no index is shared between a wheel face and a static face; every `_RL_WHEEL = k` vertex is within `radius + 2 cm` of axle k; every wheel has ≥ 1 face; tracked recipes tag ≥ 1 track face per side | skip the vertex duplication; then drop one wheel record |
| Contract in the shipped files | `mesh-vehicle-shipped.test.ts` and `validate_mesh_assets.py` (a new `check_running_gear`) | `rl_running_gear` parses; the `_RL_WHEEL` maximum is ≤ the wheel count; side letter matches z sign; kit parts carry exactly the host's attribute set (already checked, now with `_RL_*` in it); **the same facts read again from the Draco file in `assets/meshes/`**, the way `check_vehicle_wrecks` already compares the two | make `encode:meshes` drop generic attributes |
| Roster | `mesh_roster.test.ts` | every id in the approved A1/A2 lists carries `rl_running_gear` with the approved number of wheels or tracks, and **no air vehicle carries any** | delete the extras from one file |
| Runtime maths | `running-gear.test.ts` | parked → every angle exactly 0; one wheel turn after 2πr of travel; outside side faster in a turn; turning on the spot gives opposite signs; hull facing away from travel runs backwards; `dt = 0` (hit-stop) changes nothing; ω capped at 15 rad/s | flip the ω sign; use `|speed|`; feed raw `dtMs` |
| Shader mirror | `running-gear-shader.test.ts` | a TypeScript copy of the vertex maths (like `decalRoadMix`): angle 0 returns the input position **bit for bit**; a rim vertex at θ = π lands at the opposite rim | write the chunk as `c + R·(p − c)` |
| Per-instance values | same harness as below | two Lavis, one parked and one driving, drawn in one frame: the parked one is **pixel-identical** to its frame alone | share one material across instances (the `uniformsNeedUpdate` trap) |
| Draw calls | `kit-drawcalls.ts` (§3.4) | same submission count with running gear on and off, on all ten | implement a wheel as its own node and mesh |
| **Does it show at all** (reference-free) | `pnpm weight:capture`, which already advances the sim and drives `mbt_lavi`, `technical` and `apc_eitan` | new `DEBUG_LAYERS` entry **`running-gear`**: hiding it holds every angle and phase at 0. On a **moving** subject, hide → repaint at zero elapsed time → capture → the frame must change by a floor set to a third of a measured signal (the `blast:capture` method). Like `unitsDebugHidden`, it is a **flag the per-frame writer reads**, not a `setObjectsVisible`, because a toggle that lasts only one frame measures nothing | stop updating the angles (the toggle reads 0 px) |
| Golden gate | `pnpm golden-baseline` | 0 px on every gated scenario (A7) | set A7 to "always shown": it goes red on `vehicle` |

The lead judges the result on **ten seconds of motion per vehicle** (G0 #14's
precedent, the same as the weight package), using `weight:capture`'s flip pages
at zoom 1 and 2.5. A still or a number is not the judgement.

---

## 5. Phase 2 work order (after approval, and after `art/kit-leftovers` merges)

1. Rebase on `main` after kit-leftovers lands, then re-measure §1 on the merged
   bytes. Kit changes do not touch `hull_*`, but measuring again costs nothing.
2. `running-gear-recipes.ts` and `running-gear-pass.ts`, with their tests,
   including the literal oracle.
3. `kit-pass.ts` zero-fill; `check_running_gear` in `validate_mesh_assets.py`;
   contract v7 text; `export_officer_armour.py` ignore rule.
4. Run `running-gear:meshes → kit:meshes → wreck:meshes → encode:meshes` on the
   approved vehicles. Test that the Draco round trip keeps the attributes. Run
   `pnpm validate:meshes` (headless Blender, after approval only).
5. Runtime: `units/running-gear.ts`; the material patch in
   `buildVehicleMeshTemplate`; per-entity clones and their disposal; the
   `ThreeRenderer.updateVehicleMeshes` wiring; the `running-gear` debug layer.
6. `kit-drawcalls.ts` across all ten; `weight:capture` lanes and toggle floors;
   flip pages for the lead.
7. `pnpm golden-baseline` (expect 0 px), `pnpm test`, `pnpm lint`, `tsc`.
   `ui:routes` runs on CI, not locally.
8. Picture gate: the lead judges the motion before merge.

**Estimate:** about **3–4 working sessions** of agent time:
- pass and tests: 1.5;
- runtime, shader and tests: 1;
- harness, floors and captures: 1;
- review: 0.5.

No Meshy credits and no new art assets. The vehicles are Meshy-generated, so the
phase-2 PR carries the AI-art disclosure forward even though it adds no
generated content.

---

## 6. As built (phase 2, 2026-10-12)

Approved as written on 2026-10-12. These are the places where the build
differs from the text above, and what was measured on the way.

- **The §1 table was re-measured during the build.** Three rows moved by more
  than the literal test's 2 cm:
  - `technical`: the rubber parts' boxes carried a mud-flap sliver that pulled
    the rear centre 6 cm forward. A least-squares circle through the tread
    gives x −1.19 / 1.69, r 0.312–0.319, rms 1.4 cm.
  - `gun_truck`: y 0.415, r 0.425.
  - `rocket_battery`: r 0.48, y 0.48. Its rear pair is welded into one blob, so
    its cut is 0.92 r and a face goes to its nearer axle.

  `running-gear-recipes.test.ts` holds the table as it stands now.
- **Tracks carry a `gauge` in the extras.** The Lavi and the D9 spin no wheel,
  so the turn split needs the track's own lever arm.
- **Measured steering limits** (A9, per axle, the smaller of its two wheels):
  jeep 20°, Shachaf 20°, gun truck 20°, **technical 3°**. The technical's front
  tyres sit inside a close arch, so its steering barely shows.
- **The A/B vote counts exactly-changed pixels**, not pixelmatch's perceptual
  count. The tread is a 35% mean-preserving modulation of dark baked track, and
  on the D9 and the Lavi almost all of it moves a pixel by fewer than 13
  levels: pixelmatch at 0.05 read 0–2 px there, against 2,600 changed. The
  frame is frozen, so the parked control reads exactly 0.
- **The capture is `pnpm weight:capture -- --running-gear`**, a mode of that
  harness that reuses its spawn and phase choreography. It photographs the
  four vehicles the lead asked for (jeep, Namer, Lavi, D9), each starting and
  turning, at zoom 1 and 2.5, 24 frames a lane. Each pair is the game's frame
  and the same frame repainted with the layer hidden.
- **What it found that the doc did not predict: the Lavi's tracks barely show
  from the game camera.** Its rubber is a slice at y ≤ 0.44 under a hull
  skirt that reaches lower and wider. The A/B moves 0–4 px at zoom 1 and 36–59
  px at 2.5. The pass and the shader work (the same code moves 2,600 px on the
  D9), but that geometry hides most of the Lavi's track.
- **The golden gate was not run locally** (the polish-lane rule; CI runs it).
  A probe of the gated scenarios at their own capture tick:
  - `quiet`, `open-ground`, `vehicle`, `kitted` and `dusk` bind no vehicle, so
    they draw through the unpatched materials.
  - `relief` and `aftermath` each bind two (the Lavi and the Namer turn their
    hulls before the capture tick), both off frame. The layer A/B over the
    whole frame reads 0 px. Their only in-frame contribution is shadow, which
    the running-gear chunk does not touch.

## 7. Open questions

1. **A3/A4:** are the Lavi's and D9's road wheels worth the scan surgery? The
   recommendation is no. The tracks carry the motion on both.
2. **A6/A7:** should the tread show at rest? The recommendation is no, which also
   keeps every golden baseline still.
3. **`demo_tzav`'s `wheeled: true`** against a tracked mesh. That is a sim
   passability fact (boulders), not presentation, so this package does not
   change it. Should E6 change the flag, or the mesh?
4. **CLAUDE.md's weight bullet** still says four vehicles have no UVs on their
   rubber. Fix it in phase 2's docs commit.
