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

## 7. Not done: the rest of the rollout

1. **Wheeled APCs (`apc_eitan`, `apc_kipod`), the corner drop.** This needs the WRECK pass, not
   the damage pass. Two changes:
   - a `lostWheel` field on `WreckRecipe` that tilts the body toward that corner;
   - `seatOnGround` must ignore that wheel's `_RL_WHEEL = k` tyre vertices, or the seat holds the
     missing tyre's bottom on the ground.

   Then a `dropTyre` verb removes the tyre faces from `hull_rubber`, so the hull sits on its hub.
   Only the rubber is copied, because the Eitan's `hull_hull` plus `hull_rubber` copies would
   exceed the cap.
2. **Soft-skins (`jeep_shoded`, `technical`, `gun_truck`, `scout_shachaf`, `rocket_battery`).**
   The same corner drop, plus glass removal: an index-only cut on `hull_glass`, so the copy can be
   smaller than its source. Hull plates on these only on a copy simplified to the cap (R4).
3. **Helicopters (`heli_peten`, `heli_peten_gunship`), the broken rotor.** A `snapRotor` verb cuts
   `rotor_metal` into blades by angle sector and bends each one down. The rotor copy is about
   57 KB Draco, so simplify it if it is over.

Each step ends with the same capture.
