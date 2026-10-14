# Wreck damage: real damaged geometry on the `WRECK_` twins — design and record

**Date:** 2026-10-14. **Status:** built; the Lavi family and the tracked hulls are shipped (§6),
the wheeled hulls and the helicopter are not (§7). **Closes:** D1 of
`2026-09-14-vehicle-wreck-design.md`, which deferred "structural damage per vehicle" to a later
art pass. **Branch:** `art/wreck-damage`.

## 1. The rule: outline damage only

A Lane B mock tried four kinds of damage on the Lavi: a thrown track, missing road wheels, a holed
turret roof and a torn skirt plate. It photographed them through the live renderer at zoom 1.0
and 2.5, at four headings.

**Only damage that changes the outline read.** The cause is contrast. The shipped charring draws a
wreck near-black under this sun, so a hole or cavity in it has nothing to stand out against. A
dark strip on light sand, or a plate standing proud of the hull, does.

**The lead approved the rule on 2026-10-14, with these rulings:**

| # | Ruling |
|---|---|
| R1 | **Damage per vehicle:** a thrown track, peeled plates, a broken barrel or rotor, and a wheel-off corner drop for wheeled vehicles. **No roof hole.** No missing wheels on skirted tanks (the skirts hide them). |
| R2 | **Kit is blown off:** a kitted vehicle's wreck loses its kit. |
| R3 | **Cap:** 64 KiB Draco / 512 KiB raw per vehicle file, for the damaged copies. |
| R4 | The big trucks and the helicopter may have their damaged copies simplified to fit the cap. |
| R5 | **Charring unchanged.** The near-black look stays; changing it is a separate question. |
| R6 | **gltf-transform only, 0 Meshy credits.** Pipeline order: export → running-gear → kit → wreck → **damage** → encode, with the damage step re-runnable. |

## 2. The asset contract (wreck contract, amended)

**A `WRECK_<name>` twin still shares its live mesh by default.** The damage pass gives a twin its
**own** mesh only where a recipe cuts it.

**Requirements on a damaged copy** (clause 3, `validate_mesh_assets.py`):

- It is marked `extras.rl_damage = { source: <live node name> }` on the node and on the mesh.
- `source` is the live node its own name twins.
- It has exactly one primitive, with its source's material.
- It declares exactly its source's attributes, with the same component types and normalisation,
  so `_RL_WHEEL`/`_RL_TRACK` ride along. New vertices take 0 / −1, because debris does not turn.
- No other node uses it.

**A shared twin still carrying the mark fails as a stale flag.**

**Clause 3c is the cap (R3).** It is measured in the form each root ships:

- the Draco `bufferView`s of the damaged primitives in `assets/meshes/`;
- their accessor payloads in `art/meshes/`.

The two numbers live in `tools/src/meshes/damage-recipes.ts` (`DAMAGE_CAP_DRACO_BYTES`,
`DAMAGE_CAP_RAW_BYTES`). The Python gate reads them from there, so the pass and the gate cannot
disagree. The gate prints every damaged file's spend against the cap on the passing path too.

**Debris costs no node and no draw call.** A thrown track is built in `death_root` space (y = 0 is
the ground the wreck pass seats on) and carried into the twin's own frame by the inverse of the
twin's matrix. So it is more triangles in the rubber twin, nothing else.

## 3. The pass

**`pnpm damage:meshes [--id=<vehicle>]`** runs `tools/src/meshes/damage-pass.ts` over
`art/meshes/vehicles/`. Per-vehicle recipes are a literal table in `damage-recipes.ts`, with every
number measured off the shipped bytes and recorded beside it.

| verb | selects | does |
|---|---|---|
| `throwTrack` | `hull_rubber` faces whose three vertices carry `_RL_TRACK ≥ 0`, on one side | the lower run (centroid below `lowY`) is lifted off the wheels as ONE strip and laid on the sand, slid back and curving out with a slow wave. Any upper return run is gone with the track. |
| `peelPlate` | faces facing the side (`normalMin`), at least `zMin` out along it, inside a box with torn edges | swung outward about a hinge edge (`top` = shelf, `rear`/`front` = door), with a crumpled free edge and its inside face added. An optional backing goes across the opening when nothing is modelled behind it. |
| `breakBarrel` | faces whose three vertices lie forward of `breakX` and within `axisRadius` of the measured barrel axis | turned in the GROUND frame about a horizontal axis across the barrel at its root. The muzzle goes down whichever way the turret was thrown, by `droopDeg` or less if that would put any vertex under the sand. |

**Idempotent.**

- `stripDamage` re-points every damaged twin at its live mesh and disposes the copy, along with
  every accessor only the copy held (the wreck pass's own trap: the writer emits whatever the
  Root still holds).
- `stripWreck` in the wreck pass does the same, so a re-wreck of a damaged file writes the
  undamaged file's exact bytes. Measured: `wreck → damage → wreck` returns the file to its
  pre-damage bytes, and `damage → damage` is a no-op.
- There is no randomness: torn edges come from a fixed integer hash.

**Order is load-bearing:** export → `running-gear:meshes` → `kit:meshes` → `wreck:meshes` →
`damage:meshes` → `encode:meshes`.

- **The wreck pass discards damage**, so damage must come after it.
- **The damage pass reads the wreck pose from each twin's matrix**, so it cannot come before it.
- **Re-running any earlier pass means re-running wreck and damage after it.** The running-gear and
  kit passes skip `WRECK_*` nodes, and `export_officer_armour.py` deletes every `WRECK_` object
  on import.

## 4. Runtime

**Kit is blown off (R2).** `applyVehicleKit` (`packages/render/src/three/units/vehicle-kit.ts`)
used to swap the merged, kitted geometry onto every mesh over the host's old geometry, `WRECK_`
twin included. It now skips `rl_wreck` meshes:

- A shared twin keeps the host's own unkitted geometry. That geometry is still drawn, so it is no
  longer returned for disposal, and the template lists it for its own disposal instead.
- A damaged twin has geometry no kit was ever merged into.
- Tiers absent or 0 change nothing, so no gated golden scenario can move.

**Everything else is unchanged and name-based:** charring, the death path, fog, eviction and
render order. A damaged copy's geometry enters the template's disposal list like any other.

## 5. Tests and falsification

| test | what it holds | falsified by |
|---|---|---|
| `damage-pass.test.ts` | the file on disk is what the pass writes; live accessors byte-identical in memory and after a re-wreck; the wreck pass leaves no damaged mesh; every copy carries its source's attribute set and material; `strip → apply → strip` byte-stable; each verb changes the outline, against LITERAL live measurements (hull half-width, muzzle height) | angle 0, droop 0, track not thrown out (Lavi, Namer), a write into a live accessor, the wreck pass keeping copies, a copy dropping `_RL_TRACK`, a recipe changed and not re-run: **each red** |
| `damage-contract.test.ts` | the real Python clause 3/3c on scratch copies of the shipped Lavi, raw and Draco: clean passes; undeclared copy, wrong source, unmarked mesh, attribute set, material, stale flag and a 1-byte cap each fail | the Python mutated five ways (accept any copy, no material check, no stale-flag check, cap never bites, no mesh-mark check): **each red, in both forms** |
| `mesh-vehicle-shipped.test.ts` | a wreck child shares its twin's geometry or is a declared copy with its source's attributes, read through `GLTFLoader` | the damaged branch asserted the wrong way: red on `mbt_lavi`, so the branch really runs |
| `vehicle-kit.test.ts` | the twin keeps the unkitted host geometry; it is not handed back for disposal; no LOD cage on the wreck | the `rl_wreck` skip removed: **4 red** |

**The "file is current" test is NOT a byte comparison, as CI showed.** The pass's trigonometry is
not bit-identical across Node/V8 versions: files written locally (Node 25) failed a byte compare on
CI (Node 22) for all four vehicles. The test now requires the same faces and every attribute within
1e-4 of what the pass writes now; a 0.1° change to the Lavi plate's angle still turns it red.
Byte-stability of a re-run is held in-process instead.

**One survivor, disclosed.** Changing the Lavi plate's `jag` from 0.07 to 0.09 changes no selected
face. The Lavi's skirt is 17 large triangles, selected by centroid, so its torn edge is the
triangle edges, and `jag` only bites on a finer mesh. The parameter is kept for the vehicles that
have one.

## 6. Shipped

Bytes are measured against `origin/main` (`0949d222`) and read back by the gate.

| vehicle | damage | raw file | Draco file | damaged copies, Draco (cap 65,536) | raw (cap 524,288) |
|---|---|---:|---:|---:|---:|
| `mbt_lavi` | thrown track (+Z), skirt plate door-swung 55° about its rear edge, barrel broken and drooped | 3,090,792 → 3,468,528 (+377,736) | 2,520,704 → 2,569,328 (+48,624) | 46,295 (71%) | 366,247 (70%) |
| `officer_armour` | the Lavi's own recipe (held art; not spawnable, so not photographed) | +390,236 | +57,348 | 55,018 (84%) | 378,731 (72%) |
| `ifv_namer` | thrown track (+Z) | +342,476 | +47,768 | 46,874 (72%) | 318,219 (61%) |
| `dozer_d9` | thrown track (+Z) | +343,568 | +49,300 | 48,410 (74%) | 318,799 (61%) |

- **Draw calls: +0.** There are still four wreck meshes on a Lavi and two on a D9.
- **The Namer and the D9 take a track only** because the cap allows nothing else. Their rubber
  copies are most of 64 KiB on their own.
- **The before/after sheet** (`tools/src/perf/wreck-damage-captures.ts`, Metal, 1440x900) is in
  `docs/art/sheets/wreck-damage/` (`<id>-z2.5.jpg`, `<id>-z1.jpg`: live / before / after at four
  headings). It shows what reads:
  - **The thrown track reads** at zoom 1.0 and 2.5 at three of four headings on all three
    vehicles.
  - **The Lavi's barrel droop reads** where the thrown turret points it toward the camera.
  - **The door-swung plate reads at 2.5**, and only modestly at 1.0.

## 7. The rest of the rollout (`art/wreck-damage-2`)

Shipped in the second PR: the wheel-off corner drop on six wheeled hulls, the gun truck's glass,
and the Petens' snapped rotor. The third PR adds `rocket_battery` (§7.5) and fixes the pivot on
multi-axle hulls (§7.6).

### 7.1 The corner drop: the WRECK pass

**`WreckRecipe.lostWheel`** names a wheel of the scene's `rl_running_gear` (#550). Two things
happen in the wreck pass:

- **The body tips onto that corner.** It rotates about the line through its two neighbours (the
  other wheel on that axle, the nearest wheel on that side), at ground level, by the angle that
  lowers the lost axle by `(1 − LOST_WHEEL_RIM_FRAC)` of its radius.
- **The ground seat ignores the lost tyre.** Without that, the seat would stand the corner back
  up on the tyre that is no longer there.

**Which wheel is lost is load-bearing.** It is the REAR +Z wheel, the corner the slump already
lowers: the hull pitches 7° nose-up and rolls 12° toward +Z. Losing the front one fought the
slump: on the Eitan the hub stood 0.52 m in the air with its corner "dropped".

### 7.2 The tyre is a volume, not a tag

`lost-tyre.ts` is read by both passes. The tyre is everything:

- farther than the rim from the axle in side view;
- no farther than 1.04 r;
- inside the slab the wheel's own tagged rubber spans, padded 2 cm.

**Two measured reasons it is not simply the tag:**

- **#550 tags a face only inside 0.99 r**, so fenders stay static. That leaves the outermost tread
  UNTAGGED on the jeep and the technical. Cut by tag, that tread stayed and held the corner up:
  the drop was 0.05 / 0.01 m against the Eitan's 0.33.
- **The hub is not separable from the tags.** On the Eitan and the jeep, the tread is partly baked
  into `hull_hull` (228 of 315 and 426 of 698 tagged hull vertices sit at 0.9 r or beyond). So
  `LOST_WHEEL_RIM_FRAC` (0.6) is a constant, not a measurement.

**Tread a bake put in `hull_hull` sinks into the sand** with the corner, rather than being cut,
wherever the hull copy would break the cap (the Eitan, the jeep, the technical).

**`dropTyre` cuts a face only when ALL its vertices are in the volume.** Cut on the centroid, it
took the vertex the seat had stood the corner on, and left the technical's corner 0.047 m in the
air.

### 7.3 Glass and the rotor

**`blowOut`** keeps a fixed-hash 15% of a mesh's faces as shards. It runs on the gun truck only:
the one soft-skin that models glass (`hull_glass`). The jeep's, the technical's and the Shachaf's
windows are painted into their bakes.

**`snapRotor`** does three things in turn:

- **Splits the disc into blades.** Faces past `hubRadius` are grouped into runs of occupied
  15° sectors. The Peten has five blades.
- **Droops each blade toward the sand,** about the hub, in the ground frame, up to 32°.
- **Breaks off one blade's outer part** past 1.1 m and lays it flat on the sand beside the body.

This retires the wreck spec's §7.9 follow-up: the rigid rotor no longer stands up.

### 7.4 Readings

"Drop" is how much lower the lost axle sits than in the same wreck with all its wheels. "Lean" is
the extra height difference across that axle, the part a seat alone could not produce. Copies are
the gate's own measure; percentages are of the cap.

| vehicle | cut | drop | lean | Draco file growth | copies Draco | copies raw |
|---|---|---:|---:|---:|---:|---:|
| `apc_eitan` | rear +Z tyre (rubber) | 0.327 | 0.250 | +44,300 | 43,431 (66%) | 290,712 (55%) |
| `apc_kipod` | rear +Z tyre (rubber) | 0.309 | 0.291 | +28,896 | 28,039 (43%) | 182,710 (35%) |
| `scout_shachaf` | rear +Z tyre (rubber) | 0.208 | 0.206 | +26,564 | 25,707 (39%) | 172,023 (33%) |
| `gun_truck` | rear +Z tyre (rubber and hull), cab glass | 0.207 | 0.163 | +56,236 | 53,780 (82%) | 350,523 (67%) |
| `jeep_shoded` | rear +Z tyre (rubber) | 0.066 | 0.165 | +50,616 | 49,749 (76%) | 409,546 (78%) |
| `technical` | rear +Z tyre (rubber) | 0.044 | 0.122 | +17,944 | 17,061 (26%) | 135,283 (26%) |
| `heli_peten` | rotor: 5 blades drooped, one snapped | — | — | +49,704 | 48,982 (75%) | 347,276 (66%) |
| `heli_peten_gunship` | the same (held art, not photographed) | — | — | +52,536 | 51,812 (79%) | 347,660 (66%) |

**The jeep and the technical come down least**, because their bodies already sat on that corner;
they lean onto it instead. **The gun truck's tyre cut is the weakest:** 22 rubber and 16 hull faces.
Most of its tyre lies outside the slab its tagged rubber spans, so the lying tyre is a fragment.

**Tests and falsification** (`damage-pass.test.ts`, "lost wheel" and "snapped rotor"). Each of
these was seen red, then restored:

- removing `lostWheel` from the wreck table;
- the seat standing on the lost tyre;
- removing the tip (caught by the lean test);
- leaving the tyre at its axle;
- keeping the glass;
- a rotor that neither droops nor snaps;
- cutting the tyre on centroids again.

**One mutation survived the drop test alone:** removing the tip, because the seat lowers the
whole body. That is why the lean test exists.

**A bisection that grew the tip until the corner rested was written and removed.** It never ran
on a shipped file; the fault it was for was the centroid cut.

### 7.5 The rocket battery: a damaged copy simplified to the cap (`art/wreck-damage-3`)

**Why it needs simplifying.** The rocket battery's `hull_rubber` is 77,049 Draco bytes live, so
even an unsimplified rubber copy is 77,756 Draco / 766,776 raw bytes: 119% / 146% of the cap.
Ruling R4 lets a big truck's copy be simplified to fit.

**How it is simplified:**

- `meshoptimizer` 1.1.1 is now an exact tools devDependency. It was already in the lockfile,
  under `@gltf-transform`.
- The `simplify` verb (`MeshoptSimplifier.simplify`) runs FIRST on its mesh, so its collapse
  decisions run on the shipped bytes. They cannot be tipped by the last-bit float differences the
  later verbs' trigonometry shows across Node versions (§5).
- The rocket battery then loses its rear +Z tyre (wheel 2 of six), the same corner drop as §7.1.

**The ratio is the largest on a 0.01 grid that fits both caps, and the raw cap binds.**

| ratio | copy Draco | copy raw | triangles (of 10,839) | meshopt error (of extent) |
|---|---:|---:|---:|---:|
| 0.78 | 65,392 (100%) | 551,374 (105%) | 8,399 | 1.54e-3 |
| 0.75 | 63,806 (97%) | 525,091 (100%, 803 B over) | 8,070 | 1.76e-3 |
| **0.74, shipped** | **63,247 (97%)** | **517,561 (99%)** | **7,962** | **1.85e-3 (~1.3 cm on 6.9 m)** |
| 0.70 | 60,817 (93%) | 484,483 (92%) | 7,518 | 2.18e-3 |

**`Permissive` is required.** Without it, simplification stalls at 8,672 triangles whatever the
ratio (102% / 128% of the cap). The bake splits 5,015 positions into 18,851 vertices, none of them
exact duplicates, and every split is a seam meshopt will not collapse across.

**A named outlier in the drop test.** The slump already rests the rocket battery on the launcher's
rear overhang, 0.66 m behind its rear axle, so its rear tyres were in the air before one was lost.
After the tip, the lost axle ends 0.09 m HIGHER, while the hull leans 0.18 m onto that quarter and
the quarter rests on the sand. A demotion assertion fails, and says to delete the exemption, the
day that axle comes down.

**Falsified** (each red, then restored):

- ratio 0.60, over-simplified: the "next 0.01 up does not fit" budget test;
- ratio 0.80: the budget test and the Python raw cap;
- no `Permissive`: both;
- `simplify` after the tyre cut: the order test;
- the rocket battery with no `lostWheel`: the table test.

### 7.6 Fix: the corner-drop pivot on multi-axle hulls

**#616 pivoted about the line to the NEAREST same-side wheel.** On a 6x6 or an 8x8 that is a short
diagonal passing close to the lost axle. The tip came out near 17°, and the far end of the hull
rose more than a metre: the rocket battery's cab hung in the air with its shadow detached.

**It now runs to the FARTHEST same-side wheel.** The line spans the hull, and the opposite corner
rises by about the drop. On a 4x4 the two choices are the same wheel, so the four 4x4s are
unchanged.

**Readings after the fix:**

| vehicle | drop | lean |
|---|---:|---:|
| Eitan | 0.243 | 0.252 |
| Kipod | 0.322 | 0.292 |
| rocket battery | −0.091 | 0.182 |

**Only these three files were regenerated.** A re-run under `@gltf-transform` 4.5.1 (bumped on
main by #575) rewrites all eighteen vehicle files: same sizes, different bytes. That churn was
reverted, not shipped.

**No vehicle in the rollout is left undone.**
