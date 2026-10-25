# E6 art: the swarm drone, the Remetz laser carrier, the swarm draw and the beam VFX

GH-274 (WP-G-E6), items 2 (drawing), 4 (beam VFX) and 6 (two meshes). Approved by the lead,
24-25 Oct 2026, A1-A10.

**As built: read this first.**
- **The carrier is `aa_remetz`, "Remetz Laser Carrier".**
  - This design was written under a working name, and the lead renamed the unit on 25 Oct after
    the rule-3 names screen.
  - The working name is Hebrew for anthrax, and it collides with a hull callsign; "Beam Carrier"
    echoed real truck-mounted lasers.
  - The working name is replaced throughout below.
- **The carrier's turret is a Blender part**, untextured, on the textured Meshy hull, in the
  pattern of the Eitan and the Tzav. Meshy drew a roof hatch box, not the turret.
- **The drone body is refit as clean primitives**, measured off the Meshy preview; only the bomb
  is decimated. Meshy's remesh at 600 collapsed, and Blender decimation shredded the booms.
- **The carrier stands taller than §2.2 says.** At 7.6 m long the Meshy hull's roof is 3.71 m,
  so the turret roof is 5.25 m and the width over the mirrors is 4.04 m. The lever is
  `REAL_METRES` in `tools/vehicles/export_meshy_remetz.py`. This is open for the lead.
- **Meshy spend: 65 credits, exactly the approved plan**, ledger in `art/meshy/ledger.jsonl`.
- **The witness is `pnpm e6:capture`** (`tools/src/perf/e6-captures.ts`, floors in
  `e6-floors.ts`).

---

## 0. What the engine actually ships (read from `sim.ts` on main, not from the E6 spec)

The E6 design spec predates the code, and four of its render assumptions are now stale:

| E6 spec said | main has | consequence here |
|---|---|---|
| `beamBurn` / `beamBreak { reason }` events | one event, `{ kind: 'beam', phase: 'struck' \| 'lockout', shooter, target, weaponId, until }`. No break event. | A break is *inferred*: `beamState(id).target` goes to -1 without a lockout. The VFX cannot say *why* a beam stopped. The unit card can, if Lane A wants that. |
| state read `beamState(i)` | `sim.beamState(entity, slot)` gives `{target, dwell, heat, locked, lockUntil}` in ticks. It allocates, and its comment says "presentation" | read once per frame per visible beam carrier. That is a handful of small objects, so it is acceptable. No sim change is asked for. |
| live members derived | `sim.swarmMembers(id)` gives `ceil(hp / member_hp)` | the instance count reads this, and nothing else |
| `DRONE_SWARM/` billboard in `SPRITE_MAP` | billboards, sheets and `SPRITE_MAP` were retired at WP-A3.3 | **dropped**. Mesh only, as for every unit. |
| member bob on the frame clock | the sway precedent (R-11) and the GH-391 rotor fix both moved presentation motion to the SIM clock | **sim clock** (`presentationSimMs`), so a frozen capture repeats |

The beam keeps `curTarget[i]` (slot 0) set while it holds a target, so the existing turret
spring already aims the Remetz's turret through `resolveTurretTarget`. That holds during
lockout too (PR #785 open item 4): the turret keeps tracking while the beam is dark.

A swarm dive is an ordinary `fire` event of class `heat`. Today that draws:
- a `missile` flight (`shellKindFor`), with body, glow and smoke trail;
- a `fire_heat` muzzle flash at the swarm centre.

Both are wrong for a quadcopter dropping a bomb (§5.3).

---

## 1. The swarm drone (`drone_swarm`, one member's mesh)

### 1.1 Numbers

| item | number | source / reasoning |
|---|---|---|
| real size | 0.50 m across the rotor tips, 0.20 m tall with the bomb | E5 §8.4 |
| drawn size | **0.75 m** across (x1.5 baked into the GLB) | bible §7 Q10 default, the same as recon/attack/loiter; real metres go in the provenance line |
| against the fleet | 55% of `recon_drone` (1.24 x 1.35 m drawn); **~11 px across at zoom 1**, against the recon's ~19 px and a rifleman's ~23 px tall. One member alone is a speck: the CLOUD is the read, and the selection ring and pick radius are sized to the cloud (§5.2). If the lead wants single drones legible, x2 (1.0 m, ~15 px) is the next step; it is ask A1. | measured from the shipped GLBs; ~12-15 px per metre at zoom 1 (64 px across a 4.24 m tile diagonal, 39 px per tile of height) |
| the cloud | 12 members inside a disc **1.5 tiles (4.5 m) across**, centred on the entity; ~64 px across at zoom 1 | `spread_tiles` N1 = 1.5, read as the cloud's DIAMETER (§5.2, ask A2) |
| height | each member at `AIR_LIFT_PX` (1.07 m) x (1 +/- 0.25) | as other air units, jittered so the cloud is not one plane |
| faction look | Sarim vehicle line, verbatim | bible §5 |
| silhouette lever | **H-frame, bare rotors, no legs, a finned bomb slung lengthwise beneath**. `recon_drone` is an X-frame with guard rings, a mast, a gimbal and skids. `attack_drone` is a finned cylinder; `loiter_drone` is a delta. | IoU < 0.88 at 64 px. The gate reads alpha only, scale-normalised, so the lever has to be shape, not size. **Named risk:** quad against quad. Measure on the preview before any Blender work. |

### 1.2 Nodes and roles: palette, no texture

The drone is palette-painted. Bible Q2 ("drones stay palette: at 26 px a bake buys nothing")
holds at 16 px a fortiori. Instancing wants one material, and a bake would need a second
texture per draw.

| node | role | ramp (new `VEHICLE_ROLE_PALETTE['drone_swarm']`) | content |
|---|---|---|---|
| `hull_hull` | hull | `dust` 1, w6 (as `loiter_drone`) | the plank body, the battery |
| `hull_plate` | plate | `dust` 2, w5 | the taped and welded patch plates, the claw bracket |
| `hull_metal` | metal | `gunmetal` 2, w2 | the booms, the motors, the bomb body, the antenna |
| `rotor_rubber` | rubber | `shadow` 0, w3 | the four two-blade rotors, kept as geometry for the gate and the wreck |

Scene extras, written by the exporter:
- `rl_rotors: [[x, y, z, r] x 4]`: the measured hub centres and blade radius, in GLB metres.
  The runtime draws its own rotor-blur discs from these (§5.1), the way `rl_running_gear`
  records wheels.
- `rl_bomb: [x, y, z]`: where the bomb hangs, the release point for the dive (§5.3).

`+X` forward, origin at the body centre on the ground plane. The runtime lifts air units, so the
GLB sits on y = 0 like `recon_drone`.

### 1.3 The wreck

What a destroyed swarm leaves behind: **one small wreck per member shot down, lying where it
fell. Nothing for a member that dived, and nothing extra when the entity dies.**
- `pnpm wreck:meshes` with `WRECK_RECIPES.drone_swarm = { hull: 'air' }` gives the `WRECK_` twin
  and the `idle`/`wreck` clips. `mesh_roster.test.ts` needs both, and the runtime takes the twin's
  geometry for the ground wreck (§5.4).
- `pnpm damage:meshes`, outline damage only (the 2026-10-14 rule), in two parts:
  - two adjacent booms snapped and drooped 35 degrees;
  - one rotor torn off and laid flat 0.15 m beside the body.

  The bomb stays on the claw (a shot-down drone did not release). Spend: well under the
  64 KiB cap, since the mesh is ~800 triangles.
- Charred at runtime like every wreck: the shared charred ramp slice for a palette vehicle.

### 1.4 Triangle budget

- **Meshy remesh at 600, shipped cap 800 per member.** The bible's drone row is remesh 800 and
  cap 1,000.
- Taken lower because the cost is paid 12 times per swarm. A full swarm is then <= 9,600
  triangles, less than one kitted Lavi (13,158 + 4,740). Rendering is draw-call-bound
  (`docs/PERFORMANCE.md`), and the instanced draw (§5.1) is a fixed +4 calls whatever the
  triangle count. So the only real costs are download size and a clean shape at 16 px.
- The max-detail rule: the preview arrives at full detail, and the remesh at 600 is the
  measured budget. The export prints what was cut against the preview.
- Lower is possible if the preview survives it: 300 was the E6 spec's target, and the cost
  difference is invisible. **Not recommended:** 300 is where the bible's props collapsed thin
  shapes (the booms are thin).

### 1.5 Meshy against Blender

Meshy builds the base:
- one text preview (20 credits);
- one remesh at 600 (5 credits), which avoids the thin-boom decimation collapse the bible
  measured on props.

Blender does the rest:
- the H-frame trim;
- the rotors split to `rotor_rubber`;
- the roles;
- the x1.5 scale;
- the extras.

Blender alone (0 credits) is possible: `tools/drones/author_attack_drone.py` is a precedent. But
bible Q5's default is "Meshy, so the roster reads as one register", and the lead has taken that
default for every drone.

### 1.6 Meshy prompt (729 characters, under the CLI's 800)

```
A single low-poly game-ready small quadcopter drone rigged to drop one bomb, a civilian vehicle crudely converted for war, sun-faded dusty paint, welded plates. At rest, level. A flat H-frame: two straight booms run front to back either side of a slim plank body, four bare two-blade rotors on exposed motors at the boom ends, no guards. A taped battery on top, a short whip antenna, and under the body a crude release claw holding one finned teardrop bomb slung lengthwise. No legs. Real-world scale, 0.5 metres across. Dusty tan plastic, gunmetal, black rotors. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

`--negative "rotor guard rings, landing skids, gimbal camera, smooth white consumer plastic, fixed wing, several drones"`.
These are the B0a roll's failure modes, plus the recon drone's own levers.

Changes from the E5 §8.4 text, and why:
- "H-frame ... no guards ... no legs" is the silhouette lever against `recon_drone`, which E5's
  prompt did not have. The E5 prompt described a recon-like quad.
- "release claw ... slung lengthwise" makes the bomb read fore-and-aft, a second silhouette
  feature, and gives the dive a visible release point.
- The Sarim vehicle line is kept verbatim, as the bible requires, although "welded plates" is
  odd on a drone. The `hull_plate` role absorbs whatever plates Meshy adds.
- No real munition, model or maker is named.

---

## 2. The Remetz beam carrier (`aa_remetz`)

### 2.1 Name and markings

- "Remetz" (Hebrew for the embers glowing in ash) is an in-world name, and it is not the name of any real
  system. The prompt names no real system, maker or vehicle family. "Beam-director turret" is a
  generic engineering term.
- The design steers away from the shapes of fielded laser air-defence vehicles. It does not use:
  - an 8x8 APC hull with a laser on the RWS;
  - a containerised trailer module;
  - a light truck with a small sensor turret.

  It is an armoured 6x6 with a large radiator module and an octagonal turret on a column, which
  is this game's own shape.
- No insignia, flags, patches, text or markings. That is in the prompt, and `validate:meshes`
  holds the palette.
- **R11 still applies.** `narrative-designer`'s rule-3 screen on the names "Remetz" and
  "Drone Swarm" is owed before any JSON ships (E6 spec Q19). This spec does not clear it.

### 2.2 Numbers

| item | number | against the fleet (measured, live geometry only) |
|---|---|---|
| length | **7.6 m** | `apc_eitan` 7.13, `apc_kipod` 7.20, `ifv_namer` 7.30, `mbt_lavi` 7.46, `demo_tzav` 8.50. The E5 prompt said 8 m; 7.6 m puts it in the APC band, where hp 1,100 and pop 2 place it. |
| width | **2.8 m** body, 3.0 m over the tyres | `apc_eitan` 3.06, `gun_truck` 2.82 |
| height | **3.7 m** to the turret roof; aperture centre at 3.0 m | `apc_eitan` 3.45, `mbt_lavi` 3.71, `rocket_battery` 3.03. It stands taller than the Eitan's hull on purpose: an AA vehicle that lases over its escort. |
| wheels | 6, radius ~0.56 m, axles at +2.55 / -0.55 / -2.05 m from the centre | `rocket_battery` 0.48, `apc_eitan` 0.66 |
| faction | KDF machine line, verbatim | bible §5 |
| silhouette lever | a **tall compact octagonal turret on a column** with one large round aperture, plus a **radiator power module** behind the cab | IoU neighbours (E6 spec §11): `apc_eitan`, `gun_truck`, `jeep_shoded`. Two more are added here: **`rocket_battery`** (also a 6x6 truck with a box on the rear deck: the turret's height and the column are the lever against its long, low launcher box) and `apc_kipod`. |

### 2.3 Nodes and roles

Vehicle contract v2, as the fleet uses it:

| node | role | content |
|---|---|---|
| `hull_hull` | hull | the cab, the tub, the power module, the bins |
| `hull_glass` | glass | the cab's slit windows (and, if the bake is chosen, the lit check in §2.4) |
| `hull_rubber` | rubber | the six tyres. `pnpm running-gear:meshes` then tags them `_RL_WHEEL`, so the wheels spin like every other wheeled hull (contract v7). |
| `hull_metal` | metal | the radiator grilles, the exhaust stack, the grab rails |
| `turret_pivot` (`extras.rl_pivot = "turret"`) | | at the column's top centre. The column is part of the hull and does not turn. |
| `turret_hull` | hull | the octagonal head |
| `turret_metal` | metal | the armoured aperture ring, the roof sensor box |
| `turret_glass` | glass | **the aperture**: one round dark-glass disc, its own mesh, so the beam knows where it starts and the wreck can blow it out |

Scene extras:
- `rl_fire: { muzzle: [x, y, z] }`: the aperture centre, in GLB metres, measured on the
  `turret_glass` vertices. The format is the existing `fire-points.ts` one. `muzzle` is in
  turret-local space, so the beam origin follows traverse. That needs a two-line addition so
  that `rl_fire` can be read as turret-relative for a turret vehicle.
- `rl_running_gear`: written by the running-gear pass.

There are no upgrade tracks in v1: the unit JSON declares none in the E6 numbers, so no kit
parts are made (§9 ask A9).

### 2.4 Palette or texture

| option | credits | for | against |
|---|---|---|---|
| **palette** (the issue's plan) | preview 20 + remesh 5 = **25** | the plan as written; cheaper; `validate:meshes` palette-checks it | it would be the only untextured KDF ground vehicle. The Eitan, Kipod, Namer, Lavi and Tzav all ship bakes, and the lit renderer makes a flat-palette hull read as a different register beside them. |
| **textured, 8k** | preview 20 + refine 8k 15 + remesh 5 = **40** | matches the vehicles it drives beside; the max-detail rule (2 Oct) postdates the issue's "palette" | +15 credits; it joins `TEXTURED_VEHICLE_TYPES` / `TEXTURED_VEHICLE_EXEMPT`, so only IoU runs on it; the aperture `turret_glass` keeps a palette role, as `hull_glass` does on other bakes |

**Recommendation: textured at 40** (ask A4). The swarm drone stays palette in either case.

### 2.5 The wreck

- **The wreck pass:**
  - `WRECK_RECIPES.aa_remetz = { hull: 'wheeled', turretPivot: 'turret_pivot', lostWheel: <rear +Z index> }`.
  - The turret is thrown across the hull, the pass's measured default.
  - The body tips onto the lost-tyre corner, as on the six wheeled hulls. The lost tyre is
    measured as a volume about the axle (`lost-tyre.ts`), not as the tag.
- **The damage pass**, outline damage only:
  1. the **aperture blown out**: `turret_glass` removed from the twin, as the gun truck's glass
     is, so the dark disc becomes a ring with nothing in it;
  2. **one power-module side panel swung open** 70 degrees on its hinge, like the Lavi's
     door-swung skirt plate;
  3. the **exhaust stack bent** 40 degrees aft.

  All three fit inside the 64 KiB Draco / 512 KiB raw per-file cap, and the spend is printed.
- Charred at runtime through `charredTexturedMaterial` (`rl_bake_luma`) if textured, or the
  charred slice if palette.
- The kill blast (`catastrophic_kill`, a pooled light, the shroud sized from its own bounds, the
  scorch) is unchanged.

### 2.6 Triangle budget

- **Meshy remesh 8,000, shipped cap 10,000.** That is the bible's "wheeled APC" row. The Eitan
  ships 12,012 and the Kipod 12,111.
- It is a player-steered vehicle seen up close in the garage, and it is drawn once, not 12 times.
- The running-gear pass appends split vertices on top of that (measured on the fleet:
  +2-6%). The cap is checked after that pass.

### 2.7 Meshy against Blender

- **Meshy** makes the base: one preview, the refine (if textured) and the remesh.
- **Blender** (`tools/vehicles/export_meshy_remetz.py`, on the `export_meshy_gun_truck.py`
  pattern) does the rest:
  - the role split;
  - the `turret_pivot` placed by measurement at the column top;
  - `turret_glass` split from the aperture by colour or normal;
  - the `rl_fire` muzzle measured on that disc;
  - the scale to 7.6 m, `+X` forward and the origin at ground centre.
- After the export: running-gear, wreck, damage and encode, in the CLAUDE.md order.
- A Blender-only build was considered and rejected: the fleet is all Meshy bases now, and the
  lead's rule is "Meshy for the initial base model".

### 2.8 Meshy prompt (787 characters)

```
A single low-poly game-ready six-wheeled armoured truck carrying a beam-director turret, a machine of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest, level. A flat-faced armoured cab with slit windows; behind it a tall boxy power module with radiator grilles and an exhaust stack; on the rear deck a squat octagonal turret on a short armoured column, its face one large round dark glass aperture in a thick armoured ring, a sensor box on its roof. Six large off-road tyres, side stowage bins. Real-world scale, 7.6 metres long. Olive paint, gunmetal, dark glass. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

`--negative "eight wheels, shipping container, trailer, rocket launcher, missile tubes, gun barrel, open pickup bed"`.
This keeps it off the real 8x8 and containerised shapes, and off `rocket_battery` and `gun_truck`.

Changes from the E5 §8.4 text, and why:
- "directed-energy" became "beam-director". Meshy reads weapon words as gun barrels.
- The **power module with radiator grilles** and the **column** are new silhouette levers
  against the rocket battery.
- "raised slightly" was dropped. Elevation is a runtime matter: the turret traverses only, as
  on every vehicle.
- "pedestal" became "short armoured column", so "no plinth" cannot cancel it.
- 8 m became 7.6 m (§2.2).

If textured, the refine runs `--tex 8k` (max-detail rule) on the same call (`text --refine`).

---

## 3. Credits (from `pnpm meshy -- estimate`, 24 Oct; no API call made)

```
estimate text                        -> text preview 20 credits (~$0.40)
estimate remesh                      -> remesh 5 credits (~$0.10)
estimate text --refine --tex 8k      -> preview 20 + refine 15 = 35 credits (~$0.70)
estimate text --refine --tex 2k      -> preview 20 + refine 10 = 30 credits (~$0.60)
```

| plan | swarm drone | carrier | total | USD |
|---|---|---|---|---|
| **recommended** (palette drone, textured 8k carrier) | 20 + 5 = 25 | 35 + 5 = 40 | **65** | ~$1.30 |
| as the issue reads (both palette) | 25 | 20 + 5 = 25 | **50** | ~$1.00 |
| ceiling: one announced re-roll each, recommended plan | 50 | 80 | **130** | ~$2.60 |

The "25 each" in the issue was 20 + 5 under today's price table. A re-roll is never
speculative: each one is its own announcement and go. Running total to date: `pnpm meshy --
spent` reads 2,520 credits consumed over 198 tasks.

The ledger announcement, to paste into `art/meshy/ledger.jsonl`'s session note once approved:

> E6 art: `drone_swarm` text preview (20) + remesh 600 (5); `aa_remetz` text preview +
> refine 8k (35) + remesh 8000 (5). 65 credits, ~$1.30. One call at a time; preview judged
> before its remesh.

---

## 4. Draw-call budget

| element | draws while visible | passes |
|---|---|---|
| swarm bodies (all swarms, one batch) | **3** | main + shadow + AO pre-pass (opaque, `castShadow`) |
| swarm rotor-blur discs (same instance matrices) | **1** | main only (transparent; no shadow, no AO normal) |
| swarm ground wrecks (one batch, cap 96) | **2** | main + AO (`castShadow` off: a 0.75 m wreck's shadow is a speck) |
| beam (all beams, one batch: core, sheath, lens and target glows) | **1** | main only (transparent, additive-look, not in AO or shadow) |
| beam heat shimmer | **0** | spliced into the existing `FogOfWarPass` as ALU, the haze precedent (R-13) |
| beam strike and member-down sparks | **0** | the existing particle system |
| Remetz hull | as any mesh vehicle | per-entity clone, contract v2 |

- **Peak: +7 draw calls**, and that is fixed: it does not grow with the number of swarms,
  members or beams.
- For scale: drawing each member as a vehicle clone would cost ~3 meshes x 3 passes x 12 =
  ~108 draws per swarm.
- Every batch hides itself (`visible = false`, 0 draws) when it has no live instance, so a
  mission without swarms pays nothing.
- Measured, not asserted, at landing: count `renderBufferDirect` per object over one frame with
  the shadow map forced, as the decal pools were measured.

---

## 5. The swarm's instanced draw (`units/swarm-batch.ts`, render-vfx)

### 5.1 Structure

- `SwarmBatch` builds, from the `drone_swarm` template:
  - **two `InstancedMesh`es sharing one instance-matrix buffer**: bodies, and rotor discs;
  - **one more** for ground wrecks.
- **Bodies:** every live non-rotor mesh merged into one `BufferGeometry` with vertex colours
  baked from `VEHICLE_ROLE_PALETTE['drone_swarm']` at load (the `bakePropColors` precedent),
  under one lit `MeshStandardMaterial`. One material means one draw per pass.
- **Rotor discs:** a 12-segment disc per `rl_rotors` entry, merged into one geometry. The
  material is a radial alpha falloff (`shadow.0`, 0.45 alpha at the rim, 0.15 at the hub), plus
  two faint blade streaks rotated by a per-instance phase attribute on the sim clock.
  - Spinning blades inside an `InstancedMesh` cannot be separate nodes, and a static blade at
    16 px reads as a stopped rotor.
  - The GLB's `rotor_rubber` stays for the gate and the wreck, and is left out of the body merge.
- **Wrecks:** the `WRECK_` twin's meshes merged the same way, under the charred slice.
- **Capacity:** `SWARM_CAPACITY = 12 x 16 = 192` instances (16 live swarms on screen; the
  largest authored mission is 65 units). The wreck cap `SWARM_WRECK_CAP` = 96, oldest evicted
  first, the `MAX_MESH_WRECKS` rule.
- `mesh-catalogue.ts`: `drone_swarm` is fielded as a swarm type. `buildVehicleMeshTemplate`
  still loads it once, since the batch needs the template, but **no per-entity clone is made**:
  `updateVehicleMeshes` skips any type with `swarm !== null`, and `updateSwarms` owns it.

### 5.2 How the live-member count drives the visible members

Per frame, for each living swarm entity:
1. `live = sim.swarmMembers(id)` (12..1). `prev` is the count drawn last frame, kept per entity
   in an `Int8Array`.
2. **Member slots are fixed per entity**: index `k` in `0..count-1` keeps its place in the cloud
   for the whole mission. **Members `0..live-1` are drawn.** A member that is lost is always
   the highest index. The sim does not know which drone died, so the renderer chooses, and
   "highest index" keeps every surviving drone exactly where it was.
3. Placement, presentation only, never the sim RNG:
   - each slot's home offset is `tileHash`-style hashing of `(entity id, k)`, inside a disc of
     radius `spread_tiles / 2` (0.75 tile), rejection-sampled once per entity at first sight
     with a 0.18-tile minimum separation;
   - its height is `AIR_LIFT` x (1 + 0.25 x h(k));
   - it moves on a slow wander on the SIM clock (`presentationSimMs`): a 0.08-tile Lissajous
     about its home, periods 2.3-3.9 s per slot, and a +/-0.03-tile bob at 1.7 Hz;
   - each member's yaw is the entity's facing plus +/-25 degrees of hash jitter, so the cloud
     points the way it flies without marching in step;
   - a frozen tick therefore repeats exactly, the GH-391 lesson.
4. **`live < prev`** (members lost this frame). The `prev - live` highest slots leave the live
   draw and become *exits*. An exit is classified by what happened this frame:
   - **dive**: a `fire` event this frame with `shooter == id`. One exit becomes a diver (§5.3).
   - **shot down**: anything else. A beam `struck` on this target, a hit or a splash. Each such
     exit tumbles: it falls from its height to the ground over 0.6 s with a 540-degrees-per-second
     spin on a hashed axis, and throws `swarm_member_down` (a new emitter: a spark burst plus a
     grey puff, palette keys only) at the moment it is hit. On landing it becomes a wreck
     instance at that spot (§5.4).

     A splash that removes four members tumbles four at once, which is how a mortar round reads
     against a cloud.
5. **`live > prev`** never happens: there is no regrowth, `swarm.test.ts` pins that. If it ever
   did, the slot simply reappears.
6. **Fog:** the members follow the entity's fog visibility, exactly as `updateVehicleMeshes`
   gates `root.visible`. Positions update every frame, so nothing freezes into a ghost.
   - Exits in flight finish their fall under the same rule.
   - Wrecks follow `mesh-death.ts`'s fog rule.
7. **The entity's `destroyed` event** does NOT fire the vehicle-kill blast, light, shake or
   shroud (`catastrophic_kill` sized from one drone's bounds would be wrong). The batch has
   already drawn the last member's exit.
   - The last member's dive is `destroy(i, -1)`.
   - A finishing splash tumbles whoever is left.
8. **HP bar:** one bar per entity, as today. The ring and the pick radius are both sized to the
   cloud:
   - the ring: `RADIUS_BY_TYPE.drone_swarm` = 0.75 tile, through the footprint generator's air
     special case, or `RING_CLASS_OVERRIDE`;
   - the pick radius: `unitAtScreen` takes the cloud radius for a swarm type, so a click on an
     edge drone selects the swarm.

   No world status mark: the member count *is* the read.

### 5.3 The dive

The dive must not draw as a missile with a smoke trail, and must not flash a muzzle at the cloud.

- **`shellKindFor`'s caller passes a swarm shooter to a new `dive` profile.** That profile has:
  - no body, glow or trail;
  - the sim's own flight time for class `heat` (`PROJ_SPEED`, copied, as `missiles.ts` already
    copies it);
  - on landing, `missile_impact` at `scale` 0.6, through the `shellHasLanded` rule.
- **The diving member instance rides that flight.** It leaves its slot and follows the dive path
  from its own position, not the cloud centre, to the impact point. It pitches nose-down 60
  degrees over the first 120 ms, the bomb at `rl_bomb` leading, and is removed on the landing
  frame.
- `fire_heat`'s weapon-fire flash is skipped for a swarm shooter.
- No new sim read: the `fire` event already carries the shooter and the target.

### 5.4 Ground wrecks

- A tumbled member lands as one wreck instance:
  - the `WRECK_` geometry (snapped booms, a rotor off);
  - its yaw and roll frozen from the tumble;
  - its height on the drawn ground (`ground-height.ts`).
- Persistent for the mission, capped at 96.
- No decal stamp. A 0.75 m drone does not scorch a crater, and a mark at that size reads as noise.

---

## 6. The beam VFX (`units/beam-batch.ts`, render-vfx; three only)

### 6.1 Geometry

- One `BeamBatch` mesh with a capacity of 16 beams. Each beam is:
  - a **core ribbon**: a camera-facing quad strip, 1.2 px at zoom 1, `vfx.white_hot`;
  - a **sheath ribbon**: 4 px, `vfx.ember`, with alpha falling off across its width;
  - a **lens glow**: a small billboard disc at the origin, 0.18 tile, `vfx.ember`;
  - a **target glow**: a billboard disc at the end, 0.10 tile, `vfx.white_hot` over `vfx.ember`.
- Widths are constant in **screen pixels**, the silhouette's lesson, since zoom clamps
  0.35-2.5. A world-unit width vanishes zoomed out and becomes a pipe zoomed in.
- Colours:
  - **`vfx.white_hot` core with a `vfx.ember` sheath.** "Remetz" means an ember, and the warm
    beam is the in-world fiction. It also keeps cyan `vfx.interceptor` for the APS, so the two
    effects never read alike.
  - No new palette key is needed.
  - Real high-energy lasers are invisible; the beam is drawn because the player must read
    who is burning whom (GDD §5.8).
- **Band `FX_RENDER_ORDER` (2) with `depthTest` ON**, as the bolt does: the beam needs line of
  sight, so anything in front of it should hide it.
  - The material is the shell batch's non-summing additive look. The palette rule is "additive
    is an opaque hot core", so the ribbon writes the palette colour and no summed colours.
  - It never draws over a roof between it and the camera.
- **Endpoints, every frame, interpolated:**
  - **Origin**: the carrier's `rl_fire.muzzle`, transformed by the clone's live `turret_pivot`
    world matrix, so it follows traverse, recoil and hull pitch.
  - **End**: for a swarm target, **the member at slot `live-1`**, the one the next `struck`
    will remove (§5.2). So the drone the beam is on is the drone that falls. For any other air
    target, its interpolated render position and lift.

### 6.2 What drives the look: sim events and `beamState`

Per frame, for each living `aa_remetz` visible to the viewer:
`s = sim.beamState(id, 0)`. The weapon's beam stats (`dwellTicks` 30, `heatTicks` 240,
`coolTicks` 120) come from the unit type.

| sim state | the look |
|---|---|
| `s.target < 0`, not locked | **no beam.** The lens glow fades out over 150 ms. |
| `s.target >= 0` (lasing) | the beam is drawn. **The dwell drives it**, `d = s.dwell / dwellTicks` (0..1): the sheath narrows from 6 px to 3 px and its alpha rises from 0.35 to 0.85 as the dwell builds, so the player sees the burn "focus" toward the kill. The target glow grows from 0.06 to 0.12 tile. The **heat shimmer** at the target is on (§6.3), with amplitude rising with `d`. |
| a `beam` event, `phase: 'struck'` | a 120 ms **pulse**: core 2x, sheath 1.6x, target glow 1.8x. `beam_strike` (a new emitter: white-hot sparks, a 4-particle ember fleck) spawns at the struck member. If the target is a swarm, the member-down tumble of §5.2 starts on the same frame; the struck slot is `live-1`, which is the member the beam was on. |
| a `beam` event, `phase: 'lockout'` | the beam **snaps off** (no fade: it is a forced shutdown). `beam_vent` (a new emitter: two grey heat-haze puffs from the power module's grilles, rising for 1.2 s) spawns at the carrier. Nothing else in the world: **heat and the cooldown go on the unit card and HUD, never over the vehicle**, by the lead's no-status-marks rule. `until` is for the card's countdown. |
| `s.locked` | no beam, no glow. The turret keeps tracking through `curTarget` (engine item 4), which is honest: the crew is still aiming. |
| a break (target goes -1 with no lockout: smoke, a wall, a switch, the carrier moving) | the beam fades over 80 ms, distinct from the lockout's snap. No reason is drawn: the sim emits none. |

`heat` itself drives **nothing in the world**. If the lead wants a physical cue, the one honest
option is the vent puffs scaling with heat after 75%. That is off by default (ask A8).

### 6.3 Heat shimmer

- The schema's `heat_shimmer` flag ("screen-space distortion pass") has been read by nothing
  until now. This is the first consumer.
- **Spliced into `fog-pass.ts`, before the shroud mix**, the way the dust haze was (R-13). It
  costs 0 draw calls.
  - A uniform array of up to 8 shimmer sites (screen position, radius in pixels, amplitude).
  - The pass offsets its scene-colour sample by a two-octave sine field inside each site's disc,
    radius 10 px at zoom 1, scaled with zoom, max offset 1.5 px.
  - The phase is on the sim clock, so a frozen frame is a fixed distortion.
  - Sites are fed by `BeamBatch`: one per lasing beam, at the target end. The amplitude is
    `0.4 + 0.6 x d`, with a 1.0 spike on `struck`.
- With no sites, the branch is skipped (`uShimmerCount == 0`): the same frame, bit for bit, the
  `rlB.g` precedent.
- **Alternative** (ask A7): a separate `ShimmerPass` after `RenderPass`, enabled only while a
  site exists. +1 full-screen draw while any beam burns, and a simpler shader to own. Not
  recommended: the fog pass already samples the scene colour at that point.

### 6.4 Schema and data touch points (for the implementing task, listed so nothing is invisible)

- `vfx_emitter.schema.json`:
  - the `trigger` enum gains `beam_strike`, `beam_lockout` and `swarm_member_down`;
  - the `weapon_classes` enum gains `directed_energy` (PR #785 open item 6).
- `data/vfx/beam_strike.json`, `beam_vent.json` and `swarm_member_down.json`, each registered in
  `packages/data/src/index.ts`'s `vfxEmitters`. `index.test.ts` pins the directory against the
  array, which is the trap that left the blast inert once.
- `fire_heat`: no change. The swarm skip is in code (§5.3).
- `VEHICLE_ROLE_PALETTE['drone_swarm']` and `['aa_remetz']`, the gate's
  `VEHICLE_ROLE_PALETTES`, `WRECK_RECIPES`, the damage recipes, and `TEXTURED_VEHICLE_TYPES` /
  `_EXEMPT` if textured.

---

## 7. Mock stills

The design review used Blender blockout stills and Meshy preview renders, which were made outside
the repo for the lead. The as-built screenshots come from `pnpm e6:capture`.

---

## 8. Witness plan: `pnpm e6:capture` (`tools/src/perf/e6-captures.ts`), the `blast:capture` pattern

No gated golden scenario contains a swarm or a beam, and none should: `combat` is report-only
for being unstable. So, as with the blast (R-L), a dedicated harness is the only instrument.

**Inherited from `blast-captures.ts` and `death-captures.ts`, unchanged:**
- `FREEZE_FRAME_LOOP_SCRIPT`, with explicit `renderer.frame(1, FRAME_MS)` pumping;
- the steady-loop settle (5 frames of 150 ms or less, a 30 s ceiling), with
  `unsteadySettleRefusal`;
- subjects are spawned, never found, on `beit_sahwan_outskirts`' open northern band;
- its own port via `port.ts` (default 5179; never 5177; a port already held is refused);
- `musicOffInitScript()`;
- Metal on macOS, `--gpu` as `ui:shots` takes it;
- `handTick` where a settle cannot be trusted.

**Debug layers (new `DEBUG_LAYERS` entries):**

| layer | what it hides | how (the `unitsDebugHidden` lesson: a per-frame re-assert must consult a flag) |
|---|---|---|
| `swarm` | the swarm bodies, rotor discs and exits in flight | a `swarmDebugHidden` flag read by `updateSwarms` |
| `swarm-wrecks` | the ground wreck batch | `visible`; nothing re-asserts it |
| `beam` | the beam batch (ribbons and glows) | a flag read by `updateBeams` |
| `beam-shimmer` | the shimmer | drives the uniform amplitude to 0; nothing per-frame re-asserts it (the `macro` standard) |

The existing `units` layer also hides the swarm bodies, so `vehicle`/`kitted` keep meaning "unit
bodies". Neither of those scenarios contains a swarm, so neither golden reading moves.

**Subjects and checks.** Floors are a third of the smallest of three measured runs, with the
sample size beside them (R-M).

| # | subject | check | kind |
|---|---|---|---|
| S1 | a full swarm hovering, tick-pinned | `swarm` A/B >= floor | toggle |
| S2 | the same swarm thinned by a Remetz over ~10 s | **readback**: `__lions.swarmDrawn(id)` (the batch's own drawn count for that entity, read off the batch like `cursorKey`, never recomputed) equals `sim.swarmMembers(id)` at 6 tick rungs | reference-free |
| S3 | a Remetz mid-dwell on the swarm | `beam` A/B >= floor; `beam-shimmer` A/B >= floor (magnitude floor if the pixel count is sub-threshold, the `relief` precedent) | toggle |
| S4 | 200 ms after a `struck` | `swarm` A/B includes the tumbling exit; the `beam` pulse frame is above the S3 reading | toggle |
| S5 | during the lockout (after 240 ticks on target) | `beam` A/B **= 0 px / 0.0000**: the beam must not draw while locked | negative control |
| S6 | a smoke screen laid across the line (the sim breaks the beam) | `beam` A/B **= 0** | negative control |
| S7 | 2 s after three members are shot down | `swarm-wrecks` A/B >= floor | toggle |
| S8 | a dive landing on a parked `apc_eitan` | `missiles` A/B on the dive frame **= 0** (the `dive` profile draws no missile body or trail), and `swarm` A/B > 0 (the diver is drawn) | negative + positive |

**The falsifications owed with the commit.** These are one-line mutations, each run and
watched go red:

| mutation | caught by |
|---|---|
| draw `count`, not `swarmMembers` | S2 |
| drop the lowest slot instead of the highest | S4 (the beam end and the tumbling member no longer coincide); and a unit test on the slot rule |
| a beam that ignores `locked` | S5 |
| a beam that keeps its last target through a break | S6 |
| the shimmer not fed | S3 `beam-shimmer` |
| `swarm` layer not consulted per frame | S1 reads the bare `setObjectsVisible` residue (~76 px, the `vehicle` story) |
| wrecks not spawned | S7 |
| a swarm dive routed through `missile` | S8 |

**Outputs.** A contact sheet `sheet.md` plus flip pages, as `atgm:capture` makes, for the lead
to judge on motion: a 10 s ladder of the swarm thinning and a 15 s beam ladder through
dwell, strike, lockout and recovery.

**Cost.** One browser on Metal, on our own port. One run at most per review round (common rules).

---

## 9. What the lead must approve

| # | decision | recommended |
|---|---|---|
| A1 | Drone size: real 0.5 m, drawn 0.75 m (x1.5 baked, bible Q10), ~11 px a member at zoom 1; or x2 (1.0 m, ~15 px) | x1.5 |
| A2 | The cloud drawn **1.5 tiles across** (`spread_tiles` read as the diameter), members at the air lift +/-25% | yes |
| A3 | Drone: H-frame, bare rotors, no legs, bomb slung beneath; palette; remesh 600, cap 800; per-member wreck with snapped booms, persistent, cap 96 | yes |
| A4 | Carrier: 7.6 x 2.8 x 3.7 m, 6x6, octagonal turret on a column, radiator module. **Textured 8k (40 cr)** or palette (25 cr, the issue's plan)? | textured |
| A5 | Carrier triangles: remesh 8,000, cap 10,000; the wreck blows out the aperture, swings a module panel open, bends the stack, and loses the rear +Z tyre | yes |
| A6 | The two prompts (§1.6, §2.8) and their negatives, as written | yes |
| A7 | Beam colour: `white_hot` core + `ember` sheath (no new palette key); the shimmer spliced into the fog pass (+0 draws), not its own pass (+1) | yes |
| A8 | Heat drives nothing in the world (card and HUD only); the lockout shows vent puffs; no heat-scaled puffs | yes |
| A9 | No kit tracks on the Remetz in v1, so no kit parts | yes |
| A10 | Credits: **65 planned (~$1.30), ceiling 130 with one announced re-roll each.** Then the calls run one at a time, the drone first, with each preview judged before its remesh. | go |

Not decided here, and still owed elsewhere:
- the rule-3 name screen (R11);
- PR #785's open items 1-5 (sim, Lane C);
- `validate_balance.py` pricing a beam (balance-analyst).
