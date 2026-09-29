# Meshy prompts and numbers tables — the units of batch B0

**WP-A3.1 (GH-179), priority batch B0 (GH-286) · Status: draft for the lead's approval · 2026-09-29**

Sibling of `meshy-prompts-characters.md` (named people), `meshy-prompts-ashwar.md`
(the Ashwar front) and `meshy-prompts-buildings.md`. This one holds the **units** the
style bible (`style-bible.md`) schedules, starting with the five the lead moved to the
front on 29 Sep: `recon_drone`, `attack_drone`, `at_team`, `demo_squad`, `apc_eitan`.
Every prompt is the §5 template with its slots filled and nothing added between them;
the numbers above each prompt are what the lead approves **before any Meshy call**.

**Nothing here has been sent to Meshy.** No API call and no render was made writing
this page; the credit figures come from `pnpm meshy -- estimate` (no API call) and
`pricing.ts`. Every call is announced with its estimate when its turn comes and waits
for the lead's go (`style-bible.md` §4).

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
