# Meshy prompts and numbers tables — the units of batch B0

**WP-A3.1 (GH-179), priority batch B0 (GH-286) · Status: draft for the lead's approval · 2026-09-29**

Sibling of `meshy-prompts-characters.md` (named people), `meshy-prompts-ashwar.md`
(the Ashwar front) and `meshy-prompts-buildings.md`. This one holds the **units** the
style bible (`style-bible.md`) schedules, starting with the five the lead moved to the
front on 29 Sep: `recon_drone`, `attack_drone`, `at_team`, `demo_squad`, `apc_eitan`.
Every prompt is the §5 template with its slots filled and nothing added between them;
the numbers above each prompt are what the lead approves **before any Meshy call**.

**B0a's three prompts (sections 1, 2 and 5) were sent verbatim on 2026-09-30**, one
preview each, on the lead's go; task ids, what Blender then did, and the silhouette
numbers are in `docs/ASSET_PROVENANCE.md` ("Batch B0a units"). The attack drone's
preview came back with a delta wing it was not asked for (cut in Blender -- section 2's
warning was right), the Eitan's with a small cannon on the front deck (collapsed in
Blender), and the recon drone's as a clean consumer-style quadcopter the lead judged
short on combat look, so it took the one re-roll B0's ceiling allows: the lead asked
for a military hexacopter (six guarded rotors, mast, gimballed ball, rails, battery
pack, "not a smooth consumer drone" -- the prompt is `prompt_recon_v2.txt` in the run's
scratchpad and in the ledger), Meshy returned a four-arm quadcopter with the rest of
the brief present, and the lead accepted it with rotor guards added in Blender. The
Kipod (section 6) followed the same day. Sections 3 and 4 (B0b) are still unsent; the credit figures
come from `pnpm meshy -- estimate` (no API call) and `pricing.ts`, and every call is
announced with its estimate when its turn comes and waits for the lead's go
(`style-bible.md` §4).

## Costs, confirmed

`estimate text` = 20, `estimate text --refine --tex 2k` = 20 + 10, `estimate remesh` = 5,
`rigging` = 5 (`pricing.ts`; there is no `estimate rig` command). Added up per class:

| unit | class (bible §4) | steps | credits |
|---|---|---|---|
| `recon_drone` | drone part | preview 20 + remesh 5 | 25 |
| `attack_drone` | drone part | preview 20 + remesh 5 | 25 |
| `at_team` | figure team | preview 20 + refine 10 + remesh 5 + rig 5 | 40 |
| `demo_squad` | figure team | preview 20 + refine 10 + remesh 5 + rig 5 | 40 |
| `apc_eitan` | textured vehicle | preview 20 + refine 10 + remesh 5 | 35 |
| | | **B0 planned** | **165** (about $3.30) |

Ceiling **330** (about $6.60): one re-roll per unit, each a new spend with its own
announcement and go (GH-286).

## The KDF machine line (new, proposed)

§5 has faction lines for the KDF soldier, the Sarim irregular and the Sarim vehicle and
**none for a KDF vehicle or drone**, so the three machines below need one. It is written
in the same register as the KDF soldier's (plain, olive, clean) and names nothing real.
If approved it is added to `style-bible.md` §5 and copied verbatim from there:

> a machine of a fictional army in plain matte olive-drab paint with dark gunmetal
> fittings, clean and military

## Order inside B0

B0 is five units, and the bible's rule is three per session, so it runs as two:

- **B0a — `recon_drone`, `attack_drone`, `apc_eitan` (85 credits).** No rig, no
  figure prerequisites. The Eitan is the **first textured vehicle in the programme**,
  so it is also where the bible's one unverified claim gets measured: *does a remesh of
  a refined task keep its texture* (`style-bible.md` §4). Measure it on the Eitan's
  refine → remesh pair; if the texture is lost, the fallback is `retexture` (10) after
  the remesh and the Eitan costs 45, not 35.
- **B0b — `at_team`, `demo_squad` (80 credits).** Blocked on two CLI tasks: the
  `text` preview hard-codes `pose_mode: ''` (`tools/src/meshy/cli.ts:260`, checked
  2026-09-29), so a riggable A-pose figure cannot be requested from the CLI, and there
  is no `rig` command (rigging runs in the Meshy web UI and is logged by hand — bible
  §7 question 7). And blocked on bible §7 question 1: **no infantry bake exemption list
  exists** (`TEXTURED_INFANTRY_TYPES` is nowhere in the tree, checked 2026-09-29).

---

## 1. `recon_drone` — Recon Drone (KDF, air, no weapon)

| item | number | source |
|---|---|---|
| class | drone part, **25** credits | bible §4 |
| real size | **0.9 m across** | sprite manifest, bible §3 |
| drawn size | see bible §7 question 10 — the mesh path has no `SIZE_CLASS` multiplier; the sprite draws at ×1.5 = **1.35 m** | `mesh-vehicle.ts` scales by `MESH_SCALE` only |
| remesh `--polycount` | **800** | bible §3, drone row |
| shipped cap | **1,000** | bible §3 |
| measured neighbours | no drone GLB exists; the smallest shipped vehicle mesh is `scout_shachaf` at 248 tris, so the 1,000 cap is generous | `art/meshes/vehicles/*.glb`, 2026-09-29 |
| bake | **no** — palette-painted; at 26 px a bake buys nothing | bible §7 question 2 |
| file | `art/meshes/vehicles/recon_drone.glb`, contract v2, roles from `hull, plate, rubber, metal, glass, recess` | bible §2 |
| pivots | **none.** A rotor spin needs a `rotor_pivot` and a file carries exactly one; a quadcopter has four, and static rotors read fine at 26 px. Nothing else traverses | `mesh-vehicle.ts` `ROTOR_PIVOT_NODE_NAME` |
| silhouette | quadcopter: four arms in an X, camera ball under the nose | `render_drone.py`, existing source `art/src/drones/recon_drone.blend` |
| nearest neighbour | **`attack_drone`** (a blunt cylinder with a cruciform tail, drawn below) and `loiter_drone`'s sprite (a swept-delta wing). Both differ in plan shape, so IoU risk is **low**; unmeasured until the gate runs | the gate compares a mesh against every other mesh and every other unit's sprite, excluding its own retired sprite |
| app wiring | `VEHICLE_UNIT_MESHES` in `packages/app/src/mesh-catalogue.ts`, plus a `VEHICLE_ROLE_PALETTE` entry in `vehicle-mesh-role.ts` and `render_mesh_gate.py`'s `VEHICLE_ROLE_PALETTES`. **Art existing is not art drawing** | `render-vfx` |
| air | the mesh path lifts `isAir` types by `AIR_LIFT_PX` already (`heli_peten`); wreck is procedural (`pnpm wreck:meshes`) | `ThreeRenderer.ts` |

```
A single low-poly game-ready quadcopter reconnaissance drone, a machine of a fictional
army in plain matte olive-drab paint with dark gunmetal fittings, clean and military.
At rest, level. Four rotor arms in an X around a compact central body, with a small
rounded camera ball hanging under the nose. Real-world scale, 0.9 metres across. Olive
paint, gunmetal, black rotors. Plain even lighting, no baked shadows, no ground, no
base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text
or markings of any kind.
```

540 characters. Blender: scale to the approved drawn size, `+X` toward the camera ball,
origin at ground centre under the body, split by role (camera lens → `glass`, rotors →
`metal`), trim at most ~10%.

## 2. `attack_drone` — Loitering Munition (KDF, air, kamikaze)

The KDF unit. The Sarim one is `loiter_drone` (see §7 of the bible and question 9).

| item | number | source |
|---|---|---|
| class | drone part, **25** credits | bible §4 |
| real size | **1.05 m long** | sprite manifest, bible §3 |
| drawn size | ×1.5 = **1.58 m**, same question as the recon drone | bible §7 question 10 |
| remesh `--polycount` | **800** | bible §3 |
| shipped cap | **1,000** | bible §3 |
| bake | **no** — palette-painted | bible §7 question 2 |
| file | `art/meshes/vehicles/attack_drone.glb`, contract v2 | bible §2 |
| pivots | **none** — the warhead is the airframe; there is no moving part | `render_attack_drone.py`: "no `fire` ... this weapon *is* the warhead" |
| silhouette | a blunt cylinder, tapered nose sensor pod, small cruciform (+) tail | `tools/drones/author_attack_drone.py`, `art/src/drones/attack_drone.blend` |
| nearest neighbour | **`loiter_drone`'s sprite (the Sarim delta wing) and `recon_drone`.** `render_attack_drone.py` records why the source was authored fresh: reusing either "would have been a guaranteed IoU ≈ 1.0 collision" — the gate reads alpha only. The Meshy preview must keep the **cylinder-plus-cross-tail plan**; if it comes back winged or four-armed, that is the one re-roll worth spending | `render_attack_drone.py` docstring |
| app wiring | as `recon_drone` | `render-vfx` |

```
A single low-poly game-ready loitering munition drone, a machine of a fictional army in
plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest,
level. A blunt cylindrical fuselage with a tapered sensor pod on the nose and a small
cross-shaped tail of four fins. Real-world scale, 1.05 metres long. Olive paint,
gunmetal nose pod, black fins. Plain even lighting, no baked shadows, no ground, no
base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text
or markings of any kind.
```

538 characters. Blender as `recon_drone`; the nose sensor lens is `glass`.

## 3. `at_team` — Spike AT Team (KDF, crew 3)

Today: `art/meshes/at_team.glb`, kit-built, **8,276 tris, 2 figures, 809 KB**, bounds
2.32 × 1.22 m on the ground and 1.83 m high, clips `idle, move, fire, down, wreck`
(measured 2026-09-29). Data says crew 3; the kit draws two figures and this batch keeps
two. `tools/units/teams.py::at_team` is the geometry being replaced.

| item | number | source |
|---|---|---|
| class | figure team (bake + rig), **40** credits | bible §4 |
| base figure | **one** Meshy figure, 1.78 m (the KDF rifleman reference), re-posed for the second man — the `manpad_team` worked example's method, no second generation | bible §5 |
| remesh `--polycount` | **2,000** per figure | bible §3 |
| shipped cap | **2,500** per figure; **8,000** per team file including weapons. Today's 8,276 is over that; two Meshy figures at 2,000 plus kit weapon parts land near 5,000 | bible §3, measured |
| footprint | feet at z = 0, `+X` forward, figures within ±1.2 m. Keep `teams.py`'s anchors so the silhouette layout and the gate result carry over: firer (0.24, −0.30), spotter (−0.32, +0.34) | `teams.py` |
| bake | **yes**, per GH-160 — ask 2048, ship 1024. **Blocked on bible §7 question 1**: the named list does not exist yet | characters doc, "Numbers to approve" |
| rig | Meshy humanoid rig (5 credits, web UI until the CLI has `rig`); bones prefixed `f0_`, `f1_`; clips exactly `idle, move, fire, down, wreck`, retargeted in Blender from the supplied Meshy libraries and authored in code through `rig.py` — **never hand-posed**. Falls 0.9–1.2 s. `PART_BONE` needs entries for any new part; `rig.py` raises on an unmapped one and that guard stays. The firer kneels, the spotter stands — posed in code | bible §2, `rig.py` |
| crew weapon | **kit geometry** (`kit.launcher("at_tube", …, pitch=0, length=1.16)` at z = 1.02, and `kit.binoculars`), separate `weapon`/`metal` objects, per bible §7 question 3 | `teams.py` |
| idle | `at_team` is in `SMOKING_TEAMS` (a ten-frame smoking beat on the spotter). Keep it if the retargeted library has a comparable idle; otherwise a plain idle. Flavour, not a gate | `teams.py` |
| nearest neighbour | **`recoilless_team`** — `teams.py` names `at_team` as *its* collision risk ("kneeling firer with a level tube"). Then `rpg_team` (same parts, tube at 38° against level). Levers that must survive: **kneeling firer, LEVEL tube at chest height, one standing spotter**. Because B0 lands before B2, the Meshy `recoilless_team` will be judged against this file, not the kit one | `teams.py` docstrings |
| IoU | not measured (no render made); `pnpm validate:meshes` is the measurement | |

```
A single low-poly game-ready anti-tank crewman, a soldier of a fictional army in a plain
olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with
a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body. A
large box-shaped tan rucksack on the back. Real-world scale, 1.78 metres tall. Olive
drab cloth, black webbing, tan canvas. Plain even lighting, no baked shadows, no
ground, no base, no plinth, centred, one object, facing forward. No insignia, flags,
patches, text or markings of any kind.
```

About 550 characters. The rucksack is the one thing the prompt adds, and it is not "a
missile": an A-pose figure cannot hold a level launcher, so the launcher is kit
geometry and the pack is only what makes this a different man from `inf_squad`.

## 4. `demo_squad` — Combat Engineers (KDF, crew 5)

Today: `art/meshes/demo_squad.glb`, kit-built, **8,368 tris, 2 figures, 820 KB**, bounds
2.46 × 1.02 m and 1.83 m high, same five clips (measured 2026-09-29).

| item | number | source |
|---|---|---|
| class | figure team (bake + rig), **40** credits | bible §4 |
| base figure | **one** Meshy figure, 1.78 m, re-posed: one crouched over the charge, one upright | `teams.py::demo_squad` |
| remesh / cap / footprint | 2,000 / 2,500 per figure, 8,000 per file; anchors `demo_a` (0.34, −0.16), `demo_b` (−0.36, +0.28) kept | bible §3, `teams.py` |
| bake | **yes** per GH-160, ask 2048, ship 1024; blocked on question 1 | |
| rig | as `at_team`. Closest precedent for a two-figure KDF engineer team: `tools/import_meshy_yahalom.py` — read how it handles the second figure and the kneel before writing this importer | |
| crew weapon | **kit geometry**: `kit.demo_charge` (low, on the ground beside the crouching man), `kit.cable_spool` (a disc on edge, on the upright man's back), and the standing man's rifle. **The base figure carries no reel and no charge** — a reel on both men would erase the mixed-height, one-disc tell | `teams.py` docstring |
| nearest neighbour | **`breach_team`** (a ballistic shield plate plus a slung pole; `teams.py` names `demo_squad`'s low satchel as its own lever against this unit), then `yahalom_squad` (horizontal mast, square packs) and `inf_squad`. Levers that must survive: **one figure low over the charge, one upright, and the reel's disc on edge** — no weapon in the set draws a disc | `teams.py` docstrings |
| idle | `demo_squad` is in `SMOKING_TEAMS`, and `yahalom_squad` borrows this team's frame-0 pose by key — **do not rename or drop the key** | `teams.py` |
| IoU | not measured; `breach_team` stays kit-built until B5, so it is judged against this file | |

```
A single low-poly game-ready combat engineer, a soldier of a fictional army in a plain
olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with
a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body.
Dust goggles pushed up on the helmet, padded knee guards, and a rolled canvas tool bag
strapped across the back. Real-world scale, 1.78 metres tall. Olive drab cloth, black
webbing, tan canvas. Plain even lighting, no baked shadows, no ground, no base, no
plinth, centred, one object, facing forward. No insignia, flags, patches, text or
markings of any kind.
```

About 620 characters. Two prompts from one faction line make two figures of the same
family: that is intended (they are judged beside `meshy_soldier`), and it is why the
silhouette levers above are all in the kit weapons and the postures.

## 5. `apc_eitan` — Eitan APC (KDF, wheeled, seats two)

Today: `art/meshes/vehicles/apc_eitan.glb`, kit-built by `tools/export_mesh_vehicle.py`
from `art/src/vehicles/eitan_apc.blend`, **63,492 tris, 1,831 KB**, bounds **7.13 m long
× 3.30 m wide × 3.56 m tall** (RWS included), zero materials, clips `idle, wreck`
(measured 2026-09-29). 63,492 is 7.6× the bible's heavy neighbour (`mbt_lavi`, 8,346),
which is most of what this uplift buys back.

| item | number | source |
|---|---|---|
| class | textured vehicle, **35** credits | bible §4 |
| real size | **7.13 m** hull length — the sprite manifest's `realMetres` (7.129), so sprite and mesh cannot drift apart; scale the Meshy result **uniformly** to it | `EITAN_HULL/manifest.json`, `dimetric.unit_scale` |
| size class | `heavy_vehicle`, ×1.0, drawn through `SIZE_CLASS`, never per asset | `dimetric.py` |
| remesh `--polycount` | **8,000** (proposal: §3 has no heavy-vehicle row; eight wheels need more than the light 5,000, and `mbt_lavi` ships at 8,346) | bible §3 |
| shipped cap | **10,000** (proposal, as above) | |
| bake | **yes** — 35 prices it in; needs `apc_eitan` added to **both** `TEXTURED_VEHICLE_TYPES` (`textured-vehicle.ts`) and `TEXTURED_VEHICLE_EXEMPT` (`validate_mesh_assets.py`), pinned against each other by `textured-vehicle.test.ts`. That file's own comment still says the Eitan "is kit-built and was never a candidate" — update it. Palette and fill checks then skip it; silhouette IoU still runs | bible §7 question 8 |
| file | `art/meshes/vehicles/apc_eitan.glb`, contract v2; roles `hull, plate, rubber, metal, glass, recess`; `+X` forward, origin at ground centre | bible §2 |
| pivots | **`turret_pivot`** (`extras.rl_pivot = "turret"`) at the RWS ring, holding the RWS parts. **No `wheel_*` pivots**: none exist in any of the eleven shipped GLBs, `mesh-vehicle.ts` looks up only `turret_pivot` and `rotor_pivot`, and A1.3 (PR #213) shipped the **hull half only** — a four-corner terrain conform, pitch and roll from the hull's own footprint, no wheel spin (`2026-09-20-art-vehicle-weight-design.md`, R-J). So there is nothing wheel-shaped for the new file to "keep" | `mesh-vehicle.ts`, that spec |
| A1.3 needs from the mesh | origin at ground centre, footprint length and width measured by `vehicleMeshBounds` (the four-corner conform reads them), and the hull as one rigid body. Nothing else | `vehicle-conform.ts` |
| wheels | four axles, eight wheels, kept in the prompt because **wheel count is the Eitan's silhouette cue** against tracked hulls. Axles as authored: x = −3.05, −1.55, +1.35, +2.95 m on the 8.5 m authoring hull, wheel radius 0.55 m — record for a later wheel package; they scale with the export and are not re-measured from the GLB | `author_eitan.py` |
| RWS | **kit geometry** (`kit.rws`) placed at the ring, 0 credits; the prompt asks for an empty ring so no cut is needed. A Meshy RWS as a second part is +25 | precedent: `technical` was two Meshy files |
| nearest neighbour | **`apc_kipod`** (mesh, 7.2 m × 3.18 m wide × 3.03 m tall — the same footprint, and the one to worry about; unmeasured) and **`ifv_namer`** (sprite preview IoU **0.525**, `2026-08-05-namer-ifv-sprites-design.md`; a mesh measurement does not exist). Levers, from `author_apc_kipod.py`: the Kipod has a **full-length** raised roof, proud slab screens and no weapon; the Eitan has a **rear-only** raised cab, flush skirts, eight visible wheels and a roof-mounted RWS. Keep all four | `author_apc_kipod.py`, `author_eitan.py` |
| death | the Meshy export will not carry `death_root` / `WRECK_*`; re-run `pnpm wreck:meshes` after it, or a destroyed Eitan leaves nothing | CLAUDE.md, mesh-vehicle-death |
| ownership | `SPECS["apc_eitan"].mesh_owner` in `export_mesh_vehicle.py` is `MESH_KIT_OWNED`; it must be changed to name the new `tools/vehicles/export_meshy_eitan.py`, or `all` regenerates the kit hull over the Meshy one (the `dozer_d9` incident recorded there) | `export_mesh_vehicle.py` |

```
A single low-poly game-ready eight-wheeled armoured personnel carrier, a machine of a
fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and
military. At rest, level. Four pairs of large wheels, a low raked front plate, a raised
crew compartment over the rear two thirds only, bolt-on side skirts over the wheel
arches, and a small empty round mounting ring on the roof with no weapon fitted.
Real-world scale, 7.1 metres long. Olive paint, gunmetal, black tyres. Plain even
lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing
forward. No insignia, flags, patches, text or markings of any kind.
```

660 characters. Blender (`export_meshy_eitan.py`, following `export_meshy_truck.py`):
scale to 7.13 m, `+X` forward, origin at ground centre, split hull from the ring by role,
set the `turret_pivot` at the bounding-box centre of the RWS geometry **read back from
the exported GLB** (the shipped pivot sits near glTF (−1.12, 2.80, 0.03) and must not be
copied), then `pnpm wreck:meshes`, `pnpm validate:meshes`, `pnpm encode:meshes -- --check`,
and look at it at zoom 1.0 beside `mbt_lavi` and `apc_kipod` in `?sandbox`.

## 6. `apc_kipod` — Kipod Screen Carrier (KDF, wheeled 6x6, seats six)

Added 2026-09-30 on the lead's ruling after seeing the B0a Eitan in the sandbox ("the
kipod looks terrible" beside it): the kit-built Kipod (`author_apc_kipod.py`, 808 tris,
palette-painted) is replaced by a Meshy textured vehicle on the Eitan's process, 35
credits. Before: `art/meshes/vehicles/apc_kipod.glb`, bounds 7.2 × 3.18 × 3.14 m, no
`turret_pivot` (its `remote_mg` was a fixed pintle), clips `idle, wreck`.

| item | number | source |
|---|---|---|
| class | textured vehicle, **35** credits (preview 20 + refine 10 + remesh 5) | bible §4 |
| real size | **7.2 m** hull length — `KIPOD_HULL/manifest.json` `realMetres`, read at export time; scale uniformly | `render_apc_kipod.py` |
| size class | `heavy_vehicle`, ×1.0 | `dimetric.py` |
| remesh / cap | **8,000** / **10,000**, as the Eitan | §5 above |
| bake | **yes** — joins `TEXTURED_VEHICLE_TYPES` + `TEXTURED_VEHICLE_EXEMPT` (pinned) like the Eitan | bible §7 q8 |
| file | `art/meshes/vehicles/apc_kipod.glb`, contract v2, `+X` forward, origin at ground centre | bible §2 |
| pivots | **`turret_pivot`** on the roof ring, carrying `kit.rws` with `author_apc_kipod.py`'s own `RWS_SIZE` (0.85, 0.65, 0.42) and 1.0 m barrel (`kit.rws`'s barrel runs +x since the B0a fix). The mesh gets the pivot the kit build never had; `wreck-recipes.ts` gains `turretPivot` for it | lead, 2026-09-30 |
| the vehicle class the prompt describes | a heavier 6x6 troop carrier, from the unit's own data: 6 seats behind reactive plate (`hull.era`), `remote_mg` only. `author_apc_kipod.py`'s three levers against the Eitan are kept: **three evenly spaced axles / six wheels** (Eitan: four axles, eight), **a full-length tall boxy compartment with a flat roof** (Eitan: low raked glacis, rear cab), **slab screens standing proud of the flanks** (Eitan: flush skirts) | `author_apc_kipod.py` docstring |
| nearest neighbour | **the new `apc_eitan`** (mesh) — must stay under 0.88. The kit Kipod read 0.786 against the Meshy Eitan; the new hull profile is what keeps it there or lower. Then `ifv_namer` (0.837 to the Eitan) | `pnpm validate:meshes` |
| ownership / death | `SPECS["apc_kipod"].mesh_owner` in `export_mesh_vehicle.py` → the new exporter; `pnpm wreck:meshes -- --id=apc_kipod` after export | as the Eitan |

```
A single low-poly game-ready six-wheeled armoured personnel carrier, a machine of a
fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and
military. At rest, level. Three evenly spaced axles with six large wheels, a tall boxy
troop compartment with a flat roof running the full length of the hull, thick slab
armour screens standing proud of both flanks above the wheels, and a small empty round
mounting ring on the roof with no weapon fitted. Real-world scale, 7.2 metres long.
Olive paint, gunmetal, black tyres. Plain even lighting, no baked shadows, no ground, no
base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text
or markings of any kind.
```

712 characters. Blender as the Eitan, through the shared spec-driven
`tools/vehicles/export_meshy_apc.py`: scale to 7.2 m, nose measured, tyres split as
`hull_rubber` (three axles), any unasked-for weapon removed, `turret_pivot` at the
measured ring, `kit.rws`, textures at 2048.

---

# Batch B2 — `gun_truck`, `manpad_team`, `recoilless_team`, `loiter_drone`

**WP-A3.1 (GH-179), batch B2 · 2026-09-30 · numbers for the lead before any spend**

Same shape as B0 above: an item/number/source table per unit, then the §5
template with its slots filled. Two facts checked on the day, both of which move
credits **down** from the bible's 140:

- **PR #307 (`TEXTURED_INFANTRY_TYPES`) is OPEN, not merged** (checked 2026-09-30
  12:45Z). So the two figure teams ship **palette-painted**: no `--refine`, and
  the closed ten infantry roles are cut from geometry (height bands and side, the
  same `zfrac` bands `import_meshy_soldier_irregular.py` uses) rather than from a
  bake. If #307 lands mid-run the bake is NOT bought retroactively — that is a
  re-roll-class spend and waits for the lead.
- **There is still no `rig` CLI command** (`cli.ts` USAGE, checked today), and a
  headless session cannot drive the Meshy web UI. So the bible's step 5 (Meshy
  humanoid rig, 5 credits) is not taken. The figures are rigged through
  `tools/units/rig.py` exactly as the brief asks: the remeshed figure is cut into
  rigid parts named by `PART_BONE`'s own suffixes, bound one part to one bone on
  rig.py's own `_standing_bones`/`_kneel_bones` tables, and every clip is rig.py's
  own keyframe table (`idle`, `move`, `fire`, `down`, `wreck`). No hand-posing, no
  weight painting; seams are hidden with `kit.blob` joints, kit's own mechanism.

| unit | class | steps | credits |
|---|---|---|---|
| `gun_truck` | textured vehicle | preview 20 + refine 10 + remesh 5 | 35 |
| `manpad_team` | figure team, palette (see above) | preview 20 + remesh 5 | 25 |
| `recoilless_team` | figure team, palette | preview 20 + remesh 5 | 25 |
| `loiter_drone` | drone part | preview 20 + remesh 5 | 25 |
| | | **B2 planned** | **110** (about $2.20), against the approved cap of 140 |

Balance read today: 4,630 credits. Every call goes through `pnpm meshy --` with
`--name <id>`, so each lands under `art/meshy/<id>-20260930-<task>/` and in the
ledger. One preview per unit; anything that would need a second call STOPS that
unit and reports.

## 6. `gun_truck` — AA Gun Truck (enemy, light vehicle, textured)

Today: `assets/sprites/GUNTRUCK_HULL` + `GUNTRUCK_TURR`, primitives from
`art/src/vehicles/gun_truck.blend` (hull 6.79 model units × 0.745 m = **5.06 m**
real, gun crest 2.86 units); no GLB. `render_gun_truck.py` is the sprite source and
its `turret_axis (-1.65, 0)` is the mount-ring position on that hull.

| item | number | source |
|---|---|---|
| class | textured vehicle, **35** credits | bible §4, §7 q2 (default: ships a bake, to match `technical` beside it) |
| real size | **5.4 m long** (bible §5 worked example 1; the sprite's `realMetres` 5.058 was the primitive hull, and a pickup under a twin AA gun is a long-bed truck). Width/height fall out of the Meshy proportions and are read back from the GLB | bible §5 |
| drawn size | real metres × 1.0 (`light_vehicle`), through `MESH_SCALE` only. The sprite's `target_scale 1.84` was a frame-fitting fix for the elevated gun and does not apply to a mesh | `mesh-vehicle.ts`, `render_gun_truck.py` |
| remesh `--polycount` | **5,000** | bible §3, light vehicle |
| shipped cap | **8,000** | bible §3 |
| measured neighbours | `technical` 49,268 (legacy), `mbt_lavi` 8,346 | bible §3 |
| bake | **yes** — `--refine --tex 2k`, shipped at `tools/vehicles/textured.py`'s 2048 ceiling. Needs `gun_truck` in **both** `TEXTURED_VEHICLE_TYPES` (`textured-vehicle.ts`) and `TEXTURED_VEHICLE_EXEMPT` (`validate_mesh_assets.py`), pinned by `textured-vehicle.test.ts`. **Measured here, not in B0a** (B0a has not landed on `main`): whether a remesh of a refined task keeps its texture. If it does not, the fallback is a Blender decimate of the refined preview to ≤ 8,000 with UVs kept — **0 extra credits**, not `retexture` (+10) | bible §4 |
| file | `art/meshes/vehicles/gun_truck.glb`, contract v2: `hull_hull`, `hull_plate`, `hull_rubber` (tyres, by axle-disc fit as `export_meshy_truck.py`), `hull_glass` (cab glazing if separable), `turret_metal` (pedestal, cradle, twin gun — the whole mount, as `technical`'s pintle is) | contract v2, `export_meshy_truck.py` |
| pivots | **`turret_pivot`** (`extras.rl_pivot = "turret"`) at the mount ring, measured as the bounding-box centre of the turret geometry's lowest ring **read back from the cut**, never copied from the sprite's `(-1.65, 0)`. The gun traverses at runtime; the 28° elevation is baked, no `fire` (mesh vehicles carry `idle`/`wreck` only) | contract v2 |
| facing | `+X` forward, cab first; measured by binning vertices along the long axis (cab/bonnet mass vs bed-and-gun mass), as `export_meshy_truck.py` did — never assumed | `export_meshy_truck.py` |
| wreck | procedural: `WRECK_RECIPES['gun_truck'] = { hull: 'wheeled', turretPivot: 'turret_pivot' }` then `pnpm wreck:meshes -- --id=gun_truck`. `wreck-pass.test.ts` pins the recipe list ("eleven") and is updated with it | `wreck-recipes.ts` |
| silhouette | twin barrels raised at ~28°, clearly above the cab; pedestal in a drop-side bed | `render_gun_truck.py` (the elevation is load-bearing there for cab clearance; here it is the lever) |
| nearest neighbour | **`technical`** (mesh, 5.0 m pickup with a pintle MG): the same truck class, so this is the real IoU risk. Levers: the two long barrels above the cab line, the taller pedestal, a longer bed. Then `rocket_battery` (6×6 truck, much larger) and the `GUNTRUCK_*` sprites, excluded as its own. **Unmeasured until the gate runs**; if it collides the fix is profile (barrel elevation, pedestal height), never the limit | `validate_mesh_assets.py` |
| app wiring | `VEHICLE_UNIT_MESHES`, `VEHICLE_ROLE_PALETTE` (from `render_gun_truck.py`'s own `ROLE_PALETTE`: hull dust.1, plate dust.2, metal gunmetal.2, rubber shadow.0, glass gunmetal.3, recess shadow.1) and `render_mesh_gate.py`'s `VEHICLE_ROLE_PALETTES` — the drift test parses the Python table, and `vehicle-mesh-role.test.ts` currently uses `gun_truck` as its example of an UNKNOWN vehicle; that case moves to a name that stays unknown | `render-vfx` |
| sandbox | `?sandbox=beit_sahwan_outskirts` base set already fields one (`sandbox-force.ts`, hostile anchor +1,−5) | `sandbox-force.ts` |

```
A single low-poly game-ready light pickup truck carrying a twin-barrel anti-aircraft gun on a pedestal mount in the bed, a civilian vehicle crudely converted for war, sun-faded dusty paint, welded plates. At rest, level. The twin gun barrels are raised steeply at about 28 degrees, clearly taller than the cab. Real-world scale, 5.4 metres long. Faded tan paint, gunmetal gun, black tyres. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

Bible §5 worked example 1, verbatim. 555 characters.

## 7. `loiter_drone` — Loitering Munition (Sarim, air, kamikaze)

The Sarim one; the KDF `attack_drone` is B0a's (§2 above). Today:
`assets/sprites/DRONE_LOITER` from `art/src/drones/loitering_munition.blend`,
measured **1.40 m long × 1.62 m span × 0.65 m tall** (WING, FUSE_*, FIN_0/1,
PROP_*); the manifest's `realMetres` 1.62 is the span.

| item | number | source |
|---|---|---|
| class | drone part, **25** credits | bible §4 |
| real size | **1.62 m wingspan, 1.40 m long** | blend measured today; sprite manifest |
| drawn size | **×1.5 baked into the GLB** per bible §7 q10's default: **2.43 m span, 2.10 m long**; real metres recorded in the provenance line. Same call B0a takes for its two drones | bible §7 q10 |
| remesh `--polycount` | **800** | bible §3 |
| shipped cap | **1,000** | bible §3 |
| bake | **no** — palette-painted | bible §7 q2 |
| file | `art/meshes/vehicles/loiter_drone.glb`, contract v2; roles `hull` (wing + fuselage), `plate` (fins), `metal` (warhead nose, propeller and hub), `glass` (seeker lens) — from `render_loiter.py`'s own `ROLE_PALETTE` assignments; cut by geometry (nose cap, tail disc, tip fins by position) | `render_loiter.py` |
| pivots | **none**, matching B0a's two drones: a pusher prop at 26 px does not need a `rotor_pivot`, and the sprite's idle bob is not a vehicle clip (`idle`/`wreck` reserved) | `mesh-vehicle.ts` |
| wreck | procedural: `WRECK_RECIPES['loiter_drone'] = { hull: 'air' }` ("air lies on its side"), `pnpm wreck:meshes -- --id=loiter_drone` | `wreck-recipes.ts` |
| faction line | the bible has no Sarim MACHINE line and the Sarim VEHICLE line ("a civilian vehicle crudely converted for war") is false of a purpose-built munition. **Proposed, in the same register as the B0 "KDF machine" line:** *"a crude workshop-built machine of an irregular militia in sun-faded dusty paint with rough welded seams"*. If the lead prefers the vehicle line verbatim, say so before the call | bible §5 |
| silhouette | swept delta wing, slim central fuselage, blunt seeker nose, pusher prop at the tail, two small vertical wingtip fins — the existing blend's own composition | `render_loiter.py` |
| nearest neighbour | `attack_drone`'s sprite (cylinder + cross tail; `render_attack_drone.py` records the sprites were authored apart precisely for this), `recon_drone`'s sprite (quadcopter), `paramotor` mesh (a canopy many times the size). Plan shape differs from all three, so IoU risk is **low**; the fill gate is the one to watch on a thin wing, and the same planform already clears it as a sprite | gate |
| app wiring | `VEHICLE_UNIT_MESHES`, `VEHICLE_ROLE_PALETTE` (hull dust.1, plate dust.2, metal gunmetal.2, rubber shadow.0, glass gunmetal.3, recess shadow.1 — `render_loiter.py`), `render_mesh_gate.py`'s `VEHICLE_ROLE_PALETTES`, `VEHICLE_OWN_SPRITES['loiter_drone'] = ('DRONE_LOITER',)`. Air lift already applies to `isAir` types on the mesh path | `render-vfx` |
| sandbox | in the base set (`sandbox-force.ts`, hostile anchor −1,0); `attack_drone` is not fielded by the sandbox, so the side-by-side capture puts the two sprites/meshes together by placing the KDF drone through the sandbox force if it can, else the drone is photographed beside the `DRONE_ATTACK` billboard | `sandbox-force.ts` |

```
A single low-poly game-ready loitering munition drone with a swept delta wing, a crude workshop-built machine of an irregular militia in sun-faded dusty paint with rough welded seams. At rest, level. A flat swept delta wing with a slim central fuselage, a short blunt seeker nose, a two-blade pusher propeller at the tail and a small vertical fin at each wingtip. Real-world scale, 1.6 metres wingspan. Dusty tan paint, gunmetal nose, black propeller. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

617 characters. Blender: scale span to 2.43 m, nose to `+X` (measured: the seeker
end is the blunt, narrow end; the prop disc is the wide thin end), origin at ground
centre, split by role, trim ≤ ~10% if over 1,000.

## 8. `manpad_team` — MANPAD Team (Sarim, crew 2)

Today: `assets/sprites/INF_MANPAD` from `teams.manpad_team` (kit), no GLB.
`teams.py`'s composition, kept verbatim: gunner `mpd_fire` standing at (0.16, −0.22)
with `kit.launcher` at z 1.30, **pitch 78°**, length 0.94, radius 0.065; spotter
`mpd_spot` **kneeling** at (−0.28, 0.30) with `kit.binoculars`.

| item | number | source |
|---|---|---|
| class | figure team, **25** credits (palette, no Meshy rig — see the batch header) | bible §4 |
| base figure | **one** Meshy figure, generated `--pose a-pose`, used for both men (the bible's re-pose method); the spotter is the same remesh re-posed kneeling in code | bible §5 |
| height | **1.74 m** (bible worked example 2). Neighbours: `sarim_rifles`/`rpg_team` Meshy figures ship at 1.614 m, kit figures at 1.80 | bible §5, `import_meshy_rpg_team.py` |
| remesh `--polycount` | **1,500** per figure — below the bible's 2,000 on purpose: rig.py ships a kneeling figure as THREE geometry copies (deployed kneel, standing walker for `move` per design D6, prone corpse), so a 2,000 figure would put this two-man file near 11k. With corpses decimated ×0.5: ≈ 1,500 × (1 + 0.5) + 1,500 × (1 + 1 + 0.5) + tube + binos ≈ **6,900** | bible §3, `rig.py` `_add_figure` |
| shipped cap | 8,000 per file | bible §3 |
| footprint | `teams.py`'s anchors above, feet at z = 0, `+X` forward, within ±1.2 m | bible §2 |
| bake | **no** (#307 open) — roles cut from geometry: `boot` below the ankle band, `face` the forward upper-head band, `keffiyeh` the head above the face band, `webbing` the front-torso relief band if it separates cleanly, else folded into `uniform`; everything else `uniform`. Roles from the closed ten in both node name and `extras.rl_role` | contract v1 |
| rig | **rig.py**: parts cut by plane at rig.py's own joint heights (scaled 1.74/1.80) and named `{prefix}_{suffix}` from `PART_BONE` (`torso`, `hips`, `upperarm0/1`, `forearm0/1`, `thigh0/1`, `calf0/1`, `boot0/1`, `neck`, `cranium`, `face`; kneeling `thigh_r/f`, `shin_r/f`, `boot_r/f`), so `rig_parts` binds them with no table change. A-pose arms are rotated to rig.py's hanging rest about the shoulder; the kneel is the standing parts re-arranged rigidly onto `_kneel_bones`; seams get `kit.blob` joints (`knee`, `hip`, `elbow` suffixes, already in `PART_BONE`). New entries in `TEAM_FIGURES`/`SUPPORTED_TEAMS`/`TEAM_MESH_OWNER` (owner = the new importer, so `all` never overwrites it). Clips: rig.py's `idle`, `move` (spotter walks on a standing walker, D6), `fire` (launcher impulse, `weapon="launcher"`), `down`, `wreck` (rigid prone copy on `{prefix}_death_root`). Then `pnpm gait:meshes -- --id=manpad_team` | `rig.py` |
| crew weapon | **kit geometry**: `kit.launcher` at 78° bound to `mpd_fire_forearm_R`, `kit.binoculars` bound to `mpd_spot_head` — the `_at_extras` pattern | bible §7 q3 |
| prompt deviation | the bible's worked example asks for the tube slung on the back and separates it in Blender. **Not done here**: a remesh is one welded shell, a diagonal cylinder fused to a back cannot be cut cleanly, and both men come from the one figure so the spotter would carry one too. The tube is kit geometry (q3's default) and the figure's signature slot is a small haversack instead | bible §5 |
| nearest neighbour | **`rpg_team`** (Meshy, standing firer with a raised tube at 38°): levers are the 78° tube and the KNEELING spotter (rpg's loader stands). Then `sarim_rifles` (three standing riflemen). IoU unmeasured until the gate runs | `teams.py` docstring |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A small worn canvas haversack slung at the left hip. Real-world scale, 1.74 metres tall. Dusty tan cloth, olive webbing, brown leather. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

564 characters.

## 9. `recoilless_team` — Recoilless Team (Sarim, crew 3 in data, 2 drawn)

Today: `assets/sprites/INF_RECOILLESS` from `teams.recoilless_team` (kit), no GLB.
Composition kept verbatim: firer `rcl_fire` **kneeling** at (0.20, −0.28) with the
short fat tube at z **0.72**, pitch 0, length 0.86, radius 0.115; loader `rcl_load`
**kneeling** at (−0.30, 0.30) beside two spare rounds on the ground (`kit.tube`
0.52 × 0.075 at y 0.46 / 0.60). Nobody stands — that is the team's whole lever.

| item | number | source |
|---|---|---|
| class | figure team, **25** credits (palette, rig.py) | bible §4 |
| base figure | one Meshy figure, `--pose a-pose`, both men from it. Note the kit firer wore a `helmet`/regular loadout and the loader a keffiyeh; the Meshy pair are both keffiyeh irregulars | `teams.py` |
| height | **1.72 m** (bible worked example 3) | bible §5 |
| remesh `--polycount` | **1,500** per figure; two kneeling figures = two walkers + two corpses ≈ 1,500 × 2 × 2.5 + tube + rounds ≈ **7,900** | as `manpad_team` |
| shipped cap | 8,000 per file | bible §3 |
| bake / roles | as `manpad_team` (palette, geometric roles) | |
| rig | as `manpad_team`: both figures `posture="kneeling"`, `move_posture="standing"` (walkers), firer `weapon="launcher"` so `fire` gets the launcher brace; rounds on a static `prop` bone, hidden while the crew walks (`_key_death_visibility`'s own rule) | `rig.py` |
| crew weapon | **kit geometry**: `kit.launcher(length=0.86, radius=0.115)` LOW at z 0.72 bound to `rcl_fire_forearm_R`; `rcl_round0/1` on `prop` | bible §7 q3 |
| nearest neighbour | **`at_team`** — `teams.py` names it: a kneeling firer with a level tube. Levers kept: tube 0.30 m lower, shorter and a third thicker, and **no upright figure** (at_team's spotter stands). B0b's Meshy `at_team` has not landed on `main`, so the gate judges against the kit `at_team.glb` today. Then `atgm_cell`/`mortar_crew` (two kneeling irregulars around a ground mount — the real look-alike risk; lever: no tripod, a horizontal tube at hip height) | `teams.py` docstrings |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A heavy bandolier of large rounds across the chest. Real-world scale, 1.72 metres tall. Dusty tan cloth, olive webbing, gunmetal. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

Bible §5 worked example 3, verbatim. 558 characters.

## Order inside B2

`gun_truck` first (the textured path, and the remesh-keeps-texture measurement),
then `loiter_drone` (cheap, same exporter shape), then the two figure teams (one
importer serves both). One preview each, one remesh each, gates after every unit,
commit per unit.
