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

---

# Batch B3 — `militia_cell`, `rpg_team`, `atgm_cell`

**WP-A3.1 (GH-179), batch B3 · 2026-09-30 · numbers for the lead before any spend**

The irregular look B4 (`mortar_crew`, `charge_squad`, `digger_crew`) is judged
against. Same shape as B0 and B2: an item/number/source table per unit, then the
§5 template with its slots filled and nothing added between them. Three facts
checked on the day that move the plan from B2's:

- **PR #307 is merged** (`TEXTURED_INFANTRY_TYPES` exists, empty, pinned against
  `TEXTURED_INFANTRY_EXEMPT`), so the three teams ship their **bake**: every
  preview is `--refine --tex 2k`, and each id is added to BOTH lists in the same
  change as its GLB. Ask 2048, ship **1024** JPEG (the infantry number in this
  document's own §3/§4 tables and `meshy-prompts-characters.md`: at 25 px a
  figure cannot show 2048, and three teams at 2048 would add ~1.5 MB to a 25 MB
  boot). Kit weapons (`kit.rifle`, `kit.launcher`, `kit.atgm_tripod`) carry no
  UVs and stay palette-painted by role — `buildMeshUnitTemplate` decides per
  MESH, so a textured `uniform` beside a palette `weapon` is the intended shape.
- **Still no `rig` CLI command**, so rigging is `rig.py` through the B2 importer
  (`tools/units/import_meshy_crew_team.py`), 0 credits, exactly as B2 did. The
  lead's 40 per unit included up to 5 for a Meshy rig call; it is not taken.
- **`rig.py`'s copies set the polycount, not the bible's 2,000 flat.** A standing
  figure ships twice (body + corpse), a kneeling one three times (kneel, D6
  walker, corpse), and `kit.blob` joints add ~340 glTF triangles per body copy.
  So the two standing teams remesh at the bible's **2,000** and the kneeling ATGM
  crew at **1,100**, each landing under the 8,000 team cap (arithmetic in the
  tables). The bake carries what the tris do not.

| unit | class | steps | credits |
|---|---|---|---|
| `militia_cell` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `rpg_team` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `atgm_cell` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| | | **B3 planned** | **105** (about $2.10), against the approved cap of 120 |

Balance read today: 4,030 credits. One preview per unit; anything that would
need a second call STOPS that unit and reports. **Run 2026-09-30: 105 spent,
nothing stopped, no re-roll** — task ids in `docs/ASSET_PROVENANCE.md`; what
each preview honoured and what the importer fixed in `style-bible.md` §9. All three are `faction: 'enemy'`
in `mesh-catalogue.ts`; `teams.py` dresses every irregular team, Ashwar and Sarim
alike, in the same costume (`meshy-prompts-ashwar.md` records this), so all three
take the bible's one irregular line verbatim. Enemies are defined by doctrine
(GDD §2): no symbol, flag or patch, and the head wrap is the faction's cloth head,
nothing more.

**The corpse, improved on B2.** B2's weakest point was the A-pose body laid flat:
symmetric, arms out, a plank. B3 builds the corpse from the SAME cut parts the
living figure uses and re-arranges them rigidly, in code, before laying them
down — one arm thrown overhead along the body line, the other out from the side,
one knee bent so the shin angles away, the head turned to one side, and the whole
body rolled a few degrees so it is not flat — then decimates it. Rigid one-part-
to-one-bone on `{prefix}_death_root`, no hand-posing, no weights; `kit.blob`
covers the three joints that turn. `_kneel` is the precedent for the method.

## 10. `militia_cell` — Militia Cell (enemy, crew 6, 2 drawn)

Today: `art/meshes/militia_cell.glb`, kit-built, **8,420 glTF tris, 2 figures,
843 KB**, bounds 1.92 × 1.09 m on the ground and 1.83 m high, clips `idle, move,
fire, down, wreck` (measured 2026-09-30). `teams.py` composition kept verbatim:
`mil0` at (0.0, −0.24) leader, `mil1` at (0.12, 0.26), both standing with a
rifle, keffiyeh heads, irregular loadout.

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4; batch header |
| base figure | **one** Meshy figure, `--pose a-pose`, used for both men (the bible's re-pose method) | bible §5 |
| height | **1.70 m** — the baseline irregular, a shade under B2's 1.72–1.74 Sarim crews and above `sarim_rifles`' 1.61 | bible §3 window 1.66–1.80 |
| remesh `--polycount` | **2,000** | bible §3 |
| shipped estimate | 2 × (2,000 + ~340 blobs) + 2 corpses × ~1,000 (decimate 0.45) + 2 kit rifles × ~250 ≈ **7,200**; cap 8,000 | arithmetic, batch header |
| bake | **yes** — 2k asked, 1024 shipped; `militia_cell` in `TEXTURED_INFANTRY_TYPES` + `TEXTURED_INFANTRY_EXEMPT` | #307 |
| roles | `uniform`, `boot`, `face`, `keffiyeh` cut by geometry exactly as B2 (the bake colours them; the roles still name the meshes); `weapon` the kit rifles | contract v1 |
| rig | `rig.py` through the B2 importer: standing parts at rig.py's joints, hung arms, and — new for a rifle carrier — both forearms bent forward at the elbow (rigid, rest geometry) so the kit rifle sits at the hands, grip on the right wrist, yawed across the front. `fire` is rig.py's rifle raise-and-recoil; `move` walks both (`animates=True`) | `rig.py` |
| crew weapon | **kit geometry**: `rig._weapon_parts` (the seven-part rifle) bound to `{prefix}_forearm_R` | bible §7 q3 |
| nearest neighbour | **`rpg_team`** (two standing irregulars at almost the same anchors — the tube at 38° is the whole separation, and it is kit), then **`charge_squad`** (two standing dust figures with a 20° lean, kit until B4) and `sarim_rifles` (three). Levers kept: a touching pair, rifles, no tube | `teams.py` docstrings |
| idle | `militia_cell` is in `SMOKING_TEAMS` on the sprite side; the mesh idle is rig.py's breath, as every mesh team | `teams.py` |
| sandbox | four in the base set (`sandbox-force.ts`) | |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A loose ragged civilian jacket hanging open over the chest rig. Real-world scale, 1.70 metres tall. Faded grey and dusty tan cloth, olive webbing, brown leather. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The open jacket is the signature: bulk and a ragged hem that the trimmer Sarim
crews (B2) do not have, so the roster's cheapest, most numerous enemy reads
lighter-armed and less uniform than the mountain brigade beside it.

## 11. `rpg_team` — RPG Team (enemy, crew 3, 2 drawn)

Today: `art/meshes/rpg_team.glb`, kit-built, **8,368 glTF tris, 832 KB**, bounds
2.27 × 1.15 m and 1.90 m high (the tube crest), five clips. Composition kept
verbatim: `rpg_fire` standing at (0.18, −0.26) with `kit.launcher` at z 1.46,
**pitch 38°**, length 1.24, radius 0.075; `rpg_load` standing at (−0.30, 0.30)
with a rifle, leader.

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4 |
| base figure | one Meshy figure, `--pose a-pose`, both men | bible §5 |
| height | **1.76 m** | bible §3 |
| remesh `--polycount` | **2,000** | bible §3 |
| shipped estimate | as `militia_cell` less one rifle plus the tube: ≈ **7,100**; cap 8,000 | |
| bake | yes, 2k → 1024; both lists | #307 |
| rig | as `militia_cell`. **`rpg_fire` walks** (`animates=True`, the B2 `mpd_fire` precedent): the "carried frozen across the ground" figure `mesh_gait.test.ts`'s `STILL_FIGURES` records as the only standing one in the tree goes with this export, and that entry is retired with it | `rig.py`, `mesh_gait.test.ts` |
| crew weapon | **kit geometry**: `_rpg_extras`' launcher on `rpg_fire_forearm_R`; the loader's rifle as `militia_cell` | `rig.py` |
| nearest neighbour | **`militia_cell`** (above) and **`at_team`** (kneeling + level — the axis is the separation, `teams.py`); then `manpad_team` (standing + 78° tube, kneeling spotter). Levers kept: both upright, tube diagonal at 38°, one rifle | `teams.py` |
| sandbox | two in the base set | |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A small canvas backpack with two slim spare rocket rounds strapped upright on the back. Real-world scale, 1.76 metres tall. Dusty tan cloth, olive webbing, gunmetal. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The spare rounds are the loader's whole job and the one thing that says "RPG"
about a man who is not holding the tube (the tube is kit). Both men come from the
one figure, so both carry the pack; a pack that tops out at head height adds no
crest above the 38° tube, so the silhouette lever is untouched.

## 12. `atgm_cell` — ATGM Cell (enemy, crew 3, 2 drawn)

Today: `art/meshes/atgm_cell.glb`, kit-built, **13,120 glTF tris, 1,288 KB**,
bounds 2.03 × 1.44 m and 1.65 m high, clips `idle, move, down, wreck` (no `fire`:
the post is `prop`). Composition kept verbatim: `kit.atgm_tripod` at (0.24, 0.0)
on the `prop` bone; `atgm_crew0` kneeling at (−0.34, −0.40), `atgm_crew1`
kneeling at (−0.34, 0.44), both walking on a D6 standing walker.

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4 |
| base figure | one Meshy figure, `--pose a-pose`, both crew kneeling from it (B2's `_kneel`) | bible §5 |
| height | **1.72 m** | bible §3 |
| remesh `--polycount` | **1,100** — a kneeling figure ships three copies: 2 × (kneel 1,100 + ~460 blobs + walker 1,100 + ~340 + corpse ~600) + tripod ~100 ≈ **7,300**; at the bible's 2,000 this file would be ~12,000, over the cap like B2's 8,936 `recoilless_team` | batch header, bible §8 |
| bake | yes, 2k → 1024; both lists. The bake matters most here: 1,100 tris is coarse and the photograph carries the read | #307 |
| rig | B2's kneel and walker; the crew's arms hang (no hand-bound weapon; `fire` is not built — `WEAPON_ELEVATION_EXEMPT` already records "its launcher is `prop`") | `rig.py` |
| crew weapon | **kit geometry**: `_atgm_extras`' tripod on `prop`, hidden while the crew walks | `rig.py` |
| nearest neighbour | **`mortar_crew`** (two kneeling irregulars round a ground mount, kit until B4 — the real look-alike; levers: the tripod's wide low triangle against the mortar's vertical spike) and **`recoilless_team`** (two kneeling, tube at the hip, no mount). Levers kept: two kneelers, the widest lowest base in the set | `teams.py` |
| sandbox | one in the base set at hostile +7, 0 | |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A heavy quilted winter jacket, bulky at the shoulders. Real-world scale, 1.72 metres tall. Dusty grey-green cloth, olive webbing, brown leather. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The quilted jacket is the Sur register (northern mountains, the standoff
doctrine): more mass at the shoulders than the coastal militia, on a crew that
kneels behind a post all mission. Not a colour lever — a mass one.

## Order inside B3

`militia_cell` first (the plain standing pair: the textured-through-rig.py path
and the new corpse are proved on the simplest team), then `rpg_team` (the same
path plus the launcher), then `atgm_cell` (the kneel). One preview, one refine,
one remesh each; gates after every unit; commit per unit.

---

# Batch B4 — `mortar_crew`, `charge_squad`, `digger_crew`

**WP-A3.1 (GH-179), batch B4 · 2026-09-30 · numbers for the lead before any spend**

The three remaining enemy teams, judged against the irregular look B3 set
(`militia_cell`, `rpg_team`, `atgm_cell`): the same faction line, the same
B3 process (one A-pose preview, `--refine --tex 2k`, one remesh, `rig.py`
through `tools/units/import_meshy_crew_team.py`, the posed corpse), the same
bake (ask 2048, ship 1024 JPEG), each id added to `TEXTURED_INFANTRY_TYPES`
and `TEXTURED_INFANTRY_EXEMPT` in the same change as its GLB. Three facts
checked on the day:

- **The lead approved 120 credits, 35–40 a unit, as a hard cap.** The plan is
  35 each (`estimate text --refine --tex 2k` = 30, `estimate remesh` = 5;
  there is still no `rig` command, so the 5 a Meshy rig would cost is not
  taken): **105 planned**. One preview per unit; a unit that would need a
  second call STOPS and reports.
- **`digger_crew` has no `work` clip anywhere, and none is added.** `work` is
  scoped by `teams.TEAM_CLIP_ADD` to `yahalom_squad` alone (the mast press),
  and the shipped `digger_crew.glb` carries exactly `idle, move, down, wreck`
  (read from the bytes 2026-09-30); `meshClipOrFallback` resolves a `work`
  request to `idle`. The digger's clip set is kept as it is — four clips —
  and the labour reads from the kneel at the heap, not from a clip. Authoring
  a digging cycle is a `rig.py` design item, not an art-batch one.
- **`rig.py`'s copies set the polycount** (B3's finding): a standing figure
  ships twice (body + corpse), a kneeler three times (kneel, D6 walker,
  corpse). So `mortar_crew`'s two kneelers remesh at B3's **1,100**, the
  standing `charge_squad` at the bible's **2,000**, and the one-man
  `digger_crew` at **2,000** — the cap is not binding on a single figure and
  the kneeling man IS the unit.

| unit | class | steps | credits |
|---|---|---|---|
| `mortar_crew` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `charge_squad` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `digger_crew` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| | | **B4 planned** | **105** (about $2.10), against the approved cap of 120 |

**Run 2026-09-30: STOPPED before any spend.** Every text-to-3d POST answered
HTTP 402 (five attempts, 17:06–17:13 UTC) while `balance` read 3,735 credits
and `list` showed no task created; the request body was dry-run first and is
B3's with the B4 prompt. **Run 2026-10-01: 105 spent, nothing stopped, no
re-roll** — the lead raised the key's credit limit and the same calls went
through; task ids in `docs/ASSET_PROVENANCE.md`, what each preview honoured
and what the importer fixed in `style-bible.md` §11. The CLI still swallows
Meshy's 402 body (`MeshyApiError.body`), so why it refused is not on record.

All three are `faction: 'enemy'` in `mesh-catalogue.ts` and take the bible's
one irregular line verbatim, in B3's spelling (`worn boots` — a kneeling
figure's boot cut needs a boot). Enemies are defined by doctrine (GDD §2): no
symbol, flag or patch, and the head wrap is the faction's cloth head, nothing
more. Kit weapons and props (`kit.mortar`, the `charge` satchel, the spoil
heap) carry no UVs and stay palette-painted beside the textured figure, as B3's
did.

## 13. `mortar_crew` — Mortar Crew (enemy, crew 3, 2 drawn)

Today: `art/meshes/mortar_crew.glb`, kit-built, **13,096 glTF tris, 2 figures,
1,285 KB**, bounds 1.79 × 1.42 m on the ground and 1.65 m high (the tube
crest), clips `idle, move, down, wreck` (no `fire`: the tube is `prop`;
measured 2026-09-30). Composition kept verbatim: `kit.mortar("emtr_tube",
(0.22, 0.0, 0.0), length=0.76)` on the `prop` bone; `emtr_crew0` kneeling at
(−0.16, −0.40), `emtr_crew1` kneeling at (−0.16, 0.42), both walking on a D6
standing walker.

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4; batch header |
| base figure | **one** Meshy figure, `--pose a-pose`, both crew kneeling from it (B2's `_kneel`) | bible §5 |
| height | **1.68 m** | bible §3 window 1.66–1.80 |
| remesh `--polycount` | **1,100** — a kneeler ships three copies: 2 × (kneel 1,100 + ~460 blobs + walker 1,100 + ~340 + corpse ~600) + kit mortar 64 (28 `weapon` + 36 `metal`, read from today's GLB) ≈ **7,300**; cap 8,000 | batch header, bible §8; `atgm_cell` landed 7,228 the same way |
| bake | **yes** — 2k asked, 1024 shipped; `mortar_crew` in `TEXTURED_INFANTRY_TYPES` + `TEXTURED_INFANTRY_EXEMPT` | #307 |
| roles | `uniform`, `boot`, `face`, `keffiyeh` cut by geometry as B3; `weapon`/`metal` the kit mortar | contract v1 |
| rig | B2's kneel and walker; arms hang (no hand-bound weapon; no `fire` — `WEAPON_EXEMPT` already records "the tube is `prop`"); the tube hidden while the crew walks | `rig.py`, `mesh_gait.test.ts` |
| crew weapon | **kit geometry**: `rig._mortar_crew_extras()` verbatim (tube 0.76 m at 74° on `prop` at (0.22, 0, 0.10)) | bible §7 q3 |
| nearest neighbour | **`atgm_cell`** (two kneeling irregulars round a ground mount — the real look-alike; levers: the tube's vertical spike against the tripod's wide low triangle), then `mortar_team` (KDF: three figures, a 1.02 m tube) and `recoilless_team` (two kneelers, tube at the hip). Levers kept: two kneelers, one short vertical spike, no third man | `teams.py` docstrings |
| sandbox | one in the base set at hostile +13, +2 | `sandbox-force.ts` |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A short canvas bandolier of stubby mortar bombs slung across the chest over a plain long-sleeved shirt. Real-world scale, 1.68 metres tall. Dusty tan cloth, faded grey-green, olive webbing. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The bandolier is the signature: the one thing that says "mortar" about a man
who is not holding the tube (the tube is kit), and chest mass rather than
shoulder mass, so it does not read as `atgm_cell`'s quilted jacket. It sits on
the torso cut, which the kneel moves as one piece — nothing below the belt, so
the kneel cannot tear it.

## 14. `charge_squad` — Suicide Squad (enemy, crew 2, 2 drawn)

Today: `art/meshes/charge_squad.glb`, kit-built, **8,244 glTF tris, 828 KB**,
bounds 2.72 × 0.78 m and 1.55 m high (leaned), clips `idle, move, fire, down,
wreck`. Composition kept verbatim: `chg0` standing at (0.46, −0.06), `chg1`
standing at (−0.46, 0.10), single file, **20° forward lean baked into rest
geometry** (`rig.CHARGE_REST_LEAN_DEG` through `teams._lean_forward`, +4° on
`root` in `fire` — `FIRE_ROOT_LEAN`), vest slabs front and back in the
`charge` role, `chg1`'s satchel, **no weapon parts at all**.

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4 |
| base figure | one Meshy figure, `--pose a-pose`, both men | bible §5 |
| height | **1.72 m** | bible §3 |
| remesh `--polycount` | **2,000** | bible §3 |
| shipped estimate | 2 × (2,000 + ~340 blobs) + 2 corpses × ~1,000 (decimate 0.5) + kit satchel/vest ~60 ≈ **6,800**; cap 8,000 | arithmetic |
| bake | yes, 2k → 1024; both lists | #307 |
| rig | as `militia_cell` without the rifle bend: standing parts at rig.py's joints, arms hung, then **the whole placed figure leaned 20° about its own ground line** (`teams._lean_forward`, the exact call `rig._charge_squad_rest` makes, on the cut parts) with the bones left upright as that builder leaves them — `build_clips` budgets the gait against `REST_LEAN_RAD` and keys `FIRE_ROOT_LEAN`. The corpse is cut from the unleaned source (a fallen body is prone, not sprinting — the same rule `_charge_squad_rest` states). `chg1`'s `mirror=True` is a kit contrapposto flag with no Meshy equivalent and is not applied | `rig.py` |
| crew weapon | **none** — "the absence is itself a silhouette lever". The vest bulk is asked of Meshy (the signature below) so it carries the bake; `chg1`'s kit satchel stays, palette-painted in the `charge` role on `chg1_spine`, so the role the rig has always carried is still on it. If the preview ignores the vest, kit's `vest_f`/`vest_b` slabs go on both men — the bible's fix for a missed slot | `teams.py`, `rig._charge_squad_rest` |
| nearest neighbour | **`militia_cell`** (two standing dust figures — the recorded collision risk; levers: the 20° lean, single file along x at ±0.46 against militia's touching pair, no rifle line), then `rpg_team` (upright, tube). Levers kept: all three | `teams.py` |
| sandbox | one in the base set at hostile +0, −2 | `sandbox-force.ts` |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A thick bulky padded vest with wide square pockets across the chest and back, worn over the shirt. Real-world scale, 1.72 metres tall. Dusty grey cloth, dark brown, olive webbing. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The padded vest is the whole unit: bulk front AND back, which no other
standing irregular has, on a man with nothing in his hands. It is asked as
clothing, never as a device — the GDD's doctrine rule and the bible's "nothing
real" both apply — and the mass is the lever, not the pockets.

## 15. `digger_crew` — Digger Crew (enemy, crew 3, 1 drawn)

Today: `art/meshes/digger_crew.glb`, kit-built, **6,732 glTF tris, 1 figure,
663 KB**, bounds 2.04 × 0.93 m and 1.65 m high (the standing walker), clips
`idle, move, down, wreck` (no `fire`, no `work` — see the batch header).
Composition kept verbatim: `dig` kneeling at (−0.34, 0.04), walking on a D6
standing walker; the spoil heap (`rig._digger_extras`: three `kit.blob`s in
the `wood` role) on the never-keyed `ground` bone, so it stays through every
clip — "spoil does not go prone when the digger does".

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4 |
| base figure | one Meshy figure, `--pose a-pose`, kneeling from it | bible §5 |
| height | **1.66 m** — the floor of the window: the lone labourer is the smallest man in the enemy set | bible §3 |
| remesh `--polycount` | **2,000** — one kneeler: kneel 2,000 + ~460 blobs + walker 2,000 + ~340 + corpse ~1,000 + heap 216 + tool ~40 ≈ **6,100**; cap 8,000. The bible's number, affordable on a one-man file, on the figure the player looks at alone | bible §3, §8 |
| bake | yes, 2k → 1024; both lists | #307 |
| rig | B2's kneel and walker; no `fire`. The kneeling man holds a **kit entrenching tool** — a short `wood` handle (`kit.tube`, 0.50 × 0.018 m) with a `metal` blade (`kit.box`) — bound to `dig_forearm_R`, angled down into the heap, so it hides with the kneel root while he walks (as the ATGM crew leave their tripod). ~40 tris, no `weapon` role, no UV: `WEAPON_EXEMPT`'s "a digger: `wood`, no `weapon` role, no `fire` clip" stays true | `rig.py`, `mesh_gait.test.ts` |
| crew weapon | none; the heap verbatim from `rig._digger_extras()` on `ground` | `teams.py` |
| nearest neighbour | **`atgm_cell`** and **`mortar_crew`** (kneeling irregulars with a mount; levers: ONE figure, a low mound where they have a spike or a triangle, no second man), then `recoilless_team`. Levers kept: the lone kneeler, the mound, no weapon line | `teams.py` docstring |
| sandbox | not in the base set — fielded by `beit_sahwan_2_foothold`, `beit_sahwan_4_subterranean` and the three Deir Amun missions; the capture uses a mission | `data/missions/` |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A thick cloth sash tied round the waist over a plain work shirt with the sleeves rolled to the elbow. Real-world scale, 1.66 metres tall. Dust-caked grey cloth, dark brown trousers, brown leather. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The sash is the labourer's register — waist mass on a man with no rig bulk,
where the three fighting crews carry theirs on the chest or shoulders — and it
sits on the hips cut, which the kneel moves with the pelvis. Rolled sleeves are
a bake detail (the arm cut is `uniform` either way) and cost nothing if Meshy
ignores them.

## Order inside B4

`mortar_crew` first (the kneel-plus-prop path B3's `atgm_cell` proved, on the
unit whose nearest neighbour IS `atgm_cell`, so the IoU is read early), then
`charge_squad` (the standing path plus the rest lean, new to the importer), then
`digger_crew` (one kneeler, the heap on `ground`, the tool). One preview, one
refine, one remesh each; gates after every unit; commit per unit.

## 16. `breach_team` — Tzinah Breach Team (KDF, crew 6, 2 drawn)

Today: `art/meshes/breach_team.glb`, kit-built, **9,272 glTF tris, 2 figures,
933 KB**, bounds 2.38 × 1.01 m on the ground and 1.86 m high (the pole's
head), clips `idle, move, fire, down, wreck` (measured 2026-10-01). The last
kit-built KDF team, judged beside `meshy_soldier`, `at_team` and `demo_squad`.
Composition kept verbatim: `brc_point` standing at (0.32, −0.18), leader,
rifle, `kit.ballistic_shield` on his LEFT forearm; `brc_cover` standing at
(−0.30, 0.24), rifle, `kit.breach_pole` slung on his back (`rig._breach_extras`,
`PART_BONE`'s `shield` → `forearm_L`, `pole`/`pole_head` → `spine`).

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits (preview 20 + refine 10 as one `text --refine` call, remesh 5; no Meshy rig — bible §9) | bible §4, §9 |
| base figure | **one** Meshy KDF figure, `--pose a-pose`, both men standing from it | bible §5 |
| height | **1.78 m** — the KDF rifleman reference, as `at_team` and `demo_squad` | bible §1 |
| remesh `--polycount` | **2,000** — two standing men, no walker: 2 × (2,000 + ~340 blobs) + 2 posed corpses × ~1,000 (decimate 0.5) + 2 kit rifles ~2 × 90 + shield (`rbox`, chamfered) ~100 + pole ~40 ≈ **7,100**; cap 8,000. `militia_cell` (two standing riflemen, same cut) landed 7,746 | bible §3, §10 |
| bake | **yes** — 2k asked, 1024 shipped; `breach_team` joins `TEXTURED_INFANTRY_TYPES` + `TEXTURED_INFANTRY_EXEMPT` | #307 |
| roles | `uniform`, `boot`, `face` cut by geometry; the helmet and neck are `uniform` (a KDF head, not a `keffiyeh`); `weapon` the kit rifles, `metal` the shield, `charge` the pole — exactly today's role set less `webbing`/`skin_shadow`, which the bake carries | contract v1 |
| rig | **through `tools/units/import_meshy_crew_team.py`**, not the B0b KDF importer: B3/B4's measured elbow cut, both forearms bent forward for a rifle carrier (`FORE_BEND`), the rifle at the bent right hand (`_rifle_at_hand`), the POSED corpse. The B0b cut hangs each arm as one rigid unit (hands flare at the wrist, bible §9) and lays the corpse flat; the brief's "inherit the corpse and recolour fixes" is why the newer path carries this one. The crew importer gains a per-team head-role override (`HEAD_ROLE`, `uniform` here) and the breach rule; `rig.TEAM_MESH_OWNER` moves to it | `rig.py`, bible §9–§11 |
| crew weapon | **kit geometry**: `rig._weapon_parts` rifle at each man's hand; `kit.ballistic_shield("brc_point_shield", (0.32, −0.18, 0))` on `brc_point_forearm_L`, its plate stood 0.28 m ahead of the man's centre line as today; `kit.breach_pole("brc_cover_pole", (−0.30, 0.24, 0))` on `brc_cover_spine`. Both verbatim from `rig._breach_extras` — the shield is THE tell and stays kit so its size is pinned, not asked of Meshy | `teams.py`, bible §7 q3 |
| nearest neighbour | **`demo_squad`** (two KDF men; `teams.py` names this unit as *its* collision risk — levers: both men UPRIGHT here where demo has one low over the charge, a 0.55 × 1.20 m plate stood upright in front where demo's satchel is a low box on the ground), then `yahalom_squad` (a thin level mast at the hip and square packs, against a thick near-upright pole on the BACK) and `militia_cell`/`inf_squad` (two standing riflemen with nothing held out). Levers kept: all of them — the shield and the pole are kit and unchanged | `teams.py` docstrings |
| sandbox | not in the base set — reached only by `upgrades_to` in `deir_amun_2_foothold` and `khan_rafid_3_clearance`; the capture spawns it in the sandbox through the console | `data/missions/`, `sandbox-force.ts` |

```
A single low-poly game-ready assault breacher, a soldier of a fictional army in a plain olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body. A heavy padded assault vest with wide shoulder pads over the plate carrier and a clear face visor raised on the helmet. Real-world scale, 1.78 metres tall. Olive drab cloth, black webbing, gunmetal. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

About 590 characters. The vest bulk and the raised visor are the one thing
the prompt adds — upper-body mass and a helmet profile that is not the
rifleman's — because the levers that matter (shield, pole) are kit. If the
visor comes back as a painted stripe or nothing, nothing is lost: the
silhouette is in the kit parts, as it is for every KDF team.

## 17. `moto_rpg` — Armed Motorcycle (enemy, crew 2, 2 drawn)

Today: `art/meshes/moto_rpg.glb`, kit-built, **4,516 glTF tris, 432 KB**, bounds
2.48 × 1.70 m (the union over clips — the tipped wreck and thrown riders set the
frame) and 2.09 m high, clips `idle, move, fire, wreck` — **no `down`**
(`TEAM_CLIP_DROP`: a motorcycle cannot go prone; CLAUDE.md "Mesh units").
Built from scratch in `rig._moto_rpg_rest`: a rigid machine on `m_root`, two
spinning wheel bones, the launcher on its own pitching bone, each rider ONE
rigid unit on `rid_seat`/`pas_seat`, three wreck bones (`mw`, `mw_a`, `mw_b`).
That topology and `rig.build_moto_clips` are kept verbatim; only the geometry
bound to it changes.

| item | number | source |
|---|---|---|
| class | **vehicle part, palette-painted, 25 credits** (preview 20 + remesh 5, no refine — the bike takes the enemy ramp like every kit vehicle part); the riders **0 credits** | bible §4, §6 B6 |
| the bike | a Meshy off-road motorcycle, remeshed, scaled to **2.2 m** long (`teams._motorcycle`), `+X` forward, origin at ground centre, tyres on z = 0. Measured on the remesh, not assumed: the wheel centres (the two wheel bones' heads), the saddle height (where the riders sit), the bars (where the rider's hands go) | `teams.py` |
| remesh `--polycount` | **1,500** for the bike (bible §3: part caps serve download size; the kit bike is 1,850 tris with 14-segment wheels). The wreck is the same remesh tipped through `teams._tip_over` and decimated to 0.4 (~600) | bible §3, §8 |
| the riders | **B3's `rpg_team` remesh** (`01a0f313-bf75-727d-8573-8fb7f04c2453`, 1.76 m, with its rose-to-tan head-wrap `RECOLOUR`; the one Sarim figure that honoured the keffiyeh), cut by `import_meshy_crew_team.cut_figure` and re-arranged RIGIDLY in code into a seat: pelvis on the saddle, thighs forward-down, shins down to the pegs, forearms bent forward to the bars (rider) or to the pillion's own knees (passenger), torso leaned forward 12° on the rider only. Each rider is then one rigid unit on its seat bone, as the kit riders are. Bake kept: 2k → 1024 | bible §6 B6 ("re-posed seated"), `rig._moto_rpg_rest` |
| shipped estimate | bike 1,500 + wreck bike ~600 + riders 2 × (2,000 + ~200 blobs) + 2 posed corpses × ~700 (decimate 0.35) + kit launcher ~60 ≈ **7,560**; cap 8,000. If over, the rider's `uniform` group is welded and decimated once (0.8) the way the corpse is, never per piece | bible §3, §10 |
| bake | the riders ship the `rpg_team` bake, so `moto_rpg` joins `TEXTURED_INFANTRY_TYPES` + `TEXTURED_INFANTRY_EXEMPT`; the bike's `metal`/`weapon`/`webbing` meshes carry no UV and take the ramp — the per-mesh rule B0b measured | #307, bible §9 |
| roles | bike: tyres `weapon` (kit's own call — gunmetal.3, the darkest non-shadow tone), saddle and panniers `webbing` where the remesh separates them by geometry, everything else `metal`; riders `uniform`/`boot`/`face`/`keffiyeh`; launcher `weapon` | `teams._motorcycle` |
| rig | `rig._moto_bone_table` with the two wheel heads at the MEASURED axles and the seat bones at the measured saddle; `rig.build_clips(arm, "moto_rpg")` unchanged (bob 0.02 m, dip 1.6°, two wheel turns, launcher levels for `fire`, three wreck bones) | `rig.py` |
| crew weapon | **kit geometry**: `kit.launcher("pas_rpg", (−0.50, −0.17, z), yaw π, pitch 30°, length 1.18, radius 0.075)` on `m_launcher`, verbatim from `rig._moto_rpg_rest` with `z` re-measured at the Meshy pillion's shoulder so the tube still rides OVER his shoulder — the tallest point, the tell | `teams.moto_rpg` |
| corpses | two posed corpses (`_death_parts_posed`) at `teams.moto_rpg`'s own (0.30, −0.42) and (−0.32, 0.46), on `mw_a_death_root`/`mw_b_death_root`; the tipped bike on `mw_death_root` | `rig._moto_rpg_rest` |
| nearest neighbour | **`technical`** (the other enemy two-wheeler-adjacent light vehicle — levers: taller than it is long, ~1.9 m against 2.2, and a wheel-base line no infantry sheet has), `digger_crew` (whose worst IoU neighbour IS this file at 0.557), `rpg_team` (the same tube, on a standing man). Levers kept: the tube up at 30° over the pillion, the two-wheel line, two men in a row | `teams.py` docstring, provenance B4 |
| sandbox | one in the base set at hostile −5, +6 | `sandbox-force.ts` |

```
A single low-poly game-ready rugged off-road motorcycle with knobbly tyres and a long two-person saddle, a civilian vehicle crudely converted for war, sun-faded dusty paint, welded plates. At rest, level. Two canvas panniers and a rolled bedroll strapped over the rear rack behind the empty saddle, no rider. Real-world scale, 2.2 metres long. Faded tan paint, gunmetal, black rubber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

About 520 characters. "No rider" is in the signature slot on purpose: Meshy
honours the silhouette (bible §8), and a bike prompt without it risks a baked
figure welded to the saddle that no cut could remove cleanly. The panniers and
bedroll are kit's own fill lever ("lateral mass is the only lever that adds
silhouette area without extending the frame" — `teams._motorcycle`), asked of
Meshy so they come as one shell; if they do not come, kit's `pannier0/1` and
`bedroll` boxes go on the remesh in `webbing`.

**Sent 2026-10-01**, verbatim: §16's prompt as `text --pose a-pose --refine --tex 2k`
(30) then `remesh --polycount 2000` (5); §17's as `text` (20) then `remesh
--polycount 1500` (5) — 60 of the 65 approved. Task ids in
`docs/ASSET_PROVENANCE.md` (B5, B6); what each preview honoured in
`style-bible.md` §12–§13. The breach preview ignored the A-pose (carbine held
across the chest in the left hand) and the bike preview folded the panniers
and bedroll into one roll bag; both were fixed in Blender, no re-roll.

## Order inside B5 / B6

`breach_team` first (B5: the KDF look is read beside `at_team` and `demo_squad`
before the cheaper unit spends), then `moto_rpg` (B6: the bike preview, no
refine; riders from a figure already on disk). **Lead-approved cap: 65 credits**
(breach 35–40, moto 25); planned spend 35 + 25 = **60**. Anything that would
need a re-roll or a second call stops and reports the cost instead.

---

# Batch B7 — the eight teams without a bake

**WP-A3.1 (GH-179), batch B7 · 2026-10-01 · approved by the lead ("Run all 8",
160–240 credits, never more than 300)**

The eight unit types still outside `TEXTURED_INFANTRY_TYPES` after B6: the two
B2 figure teams that shipped palette-painted because #307 had not merged
(`manpad_team`, `recoilless_team`), and the six SUPPLIED Meshy assets the bible
§6 had marked out of scope (`inf_squad` → `meshy_soldier.glb`, `mortar_team` →
`meshy_mortar_team.glb`, `yahalom_squad` → `yahalom_engineer.glb`,
`sarim_rifles`, `sniper_team`, `civilians`), every one palette-painted and four
of them far over the bible's 8,000 team cap (31,965 / 180,670 / 20,544 / 30,876
/ 27,991 tris; measured 2026-10-01 from the bytes). Three facts checked on the
day set the plan:

- **A refine can be bought on a preview that already exists.** Meshy's refine
  takes a `preview_task_id`; B2's two previews (2026-09-30) are still on
  Meshy's side. The CLI gains `refine <preview-task-id>` (the `--refine` half of
  `text` on its own, 10 credits at 2k), so the two B2 figures the lead already
  judged -- and whose launcher seats #327 tuned -- get their bake for **15 each**
  (refine 10 + remesh 5), not a new 35-credit figure.
- **The four civilians keep their SUPPLIED figures and ship the bake those
  sources already carry -- 0 credits.** Four new A-pose previews would cost 140
  and push the batch past the 300 ceiling; one figure re-posed four ways would
  erase the adult/child variety the brief says to keep; and a `rig.py` cut would
  replace the supplied idle/run/crawl clips with keyframe tables for a type that
  neither shoots nor digs. `import_meshy_civilians.py` reads its gitignored
  sources (`art/blend/civilian/`, each with one 4096² base-colour bake) and
  gains a textured path on the B3 shape: keep the material, ship 1024 JPEG, add
  `civilians` to both lists. Same geometry, same clips, same gait pins.
- **The five supplied teams are REPLACED on B3–B6's path** -- one A-pose
  preview, `--refine --tex 2k`, one remesh, `rig.py` through
  `tools/units/import_meshy_crew_team.py`, 35 each. The files take their team
  id's own name (`inf_squad.glb`, `mortar_team.glb`, `yahalom_squad.glb` -- the
  superseded `kit.py` builds on disk, which `RETIRED_MESH_FILES` kept for a
  reversible swap -- plus `sarim_rifles.glb`, `sniper_team.glb`), the catalogue
  points each type at its own file, and `meshy_soldier.glb`,
  `meshy_mortar_team.glb` and `yahalom_engineer.glb` are deleted with the tests
  that measured their bytes. The supplied clips go with them (`fall`, `fallAlt`,
  `wreckAlt`, `moveFire`, and `yahalom_engineer`'s `work`); what each loses is
  recorded in its own table below, and `yahalom_squad`'s `work` is the one
  loss that decides whether the unit is done or skipped.

| unit | class | steps | credits |
|---|---|---|---|
| `manpad_team` | B2 figure, bake bought on its preview | refine 10 + remesh 5 | 15 |
| `recoilless_team` | B2 figure, bake bought on its preview | refine 10 + remesh 5 | 15 |
| `inf_squad` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `sarim_rifles` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `mortar_team` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `sniper_team` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `yahalom_squad` | figure team, textured, rig.py | preview 20 + refine 10 + remesh 5 | 35 |
| `civilians` | supplied figures, bake kept | — | 0 |
| | | **B7 planned** | **205** (about $4.10), inside the lead's 160–240; ceiling 300 |

Balance read 2026-10-01: 3,490 credits. One preview per unit; a re-roll only
for an unusable preview, logged with the reason; anything that would pass 300
stops and reports.

## 18. `manpad_team` and `recoilless_team` — the bake on the B2 figures

| item | number | source |
|---|---|---|
| preview tasks | `manpad_team` `01a0f2ac-f4e5-7632-8b48-d8813d50890c`; `recoilless_team` `01a0f2ac-f5b1-7146-b3e3-73be95e86ff2` | `import_meshy_crew_team.py` SOURCES, provenance B2 |
| refine | `refine <preview> --tex 2k --name <id>`, 10 each; ship 1024 JPEG as B3 | this batch's CLI command |
| remesh | `--polycount 1500` of the REFINED task, as B2's 1,500 (a walker-carrying team; B2 landed 8,967 / 10,408 tris) | bible §8 |
| heights | 1.74 / 1.72, unchanged | B2 tables |
| what moves | the figure geometry is a fresh remesh of the SAME preview mesh at the SAME polycount, so the cut, the kneel and `_seat_launcher`'s search re-run on near-identical shells; the seats are re-measured, not copied, and `launcher_clearance.test.ts` must stay at 0 inside. `ADD_KEFFIYEH["manpad_team"]` stays True (the preview was bare-headed). The MANPAD man's kit keffiyeh borrows its colour from his shirt's bake, as militia's did | #327, B3 |
| lists | both join `TEXTURED_INFANTRY_TYPES` / `TEXTURED_INFANTRY_EXEMPT` and the importer's `TEXTURED` | #307 |

No prompt: nothing new is generated.

## 19. `inf_squad` — Rifle Squad (KDF, crew 8, 3 drawn)

Today: `art/meshes/meshy_soldier.glb`, the supplied rifleman, **31,965 tris, 3
figures, 3.2 MB**, 1.67 m high (the bible's own §1 line calls it 1.78 -- the
bytes read 1.67), clips `idle, move, moveFire, fire, down, fall, wreck`. The
kit composition is kept verbatim (`rig.TEAM_FIGURES["inf_squad"]`): `f0` at
(0.0, −0.78), `f1` at (0.20, 0.0) leader, `f2` at (0.0, 0.78), three standing
riflemen in a wide line -- "the baseline every other silhouette has to differ
from".

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4, batch header |
| base figure | **one** Meshy KDF figure, `--pose a-pose`, all three men from it | bible §5 |
| height | **1.78 m** -- the KDF rifleman reference the bible names; this file becomes that reference | bible §1 |
| remesh `--polycount` | **1,500** -- THREE standing men: 3 × (1,500 + ~340 blobs) + 3 posed corpses × ~750 (decimate 0.5) + 3 kit rifles × ~90 ≈ **8,040**; at the bible's 2,000 the file would read ~10,300 | bible §3, §10 |
| bake | yes, 2k → 1024; `inf_squad` in both lists | #307 |
| roles | `uniform`, `boot`, `face` by geometry; helmet and neck `uniform` (`HEAD_ROLE`, the B5 KDF rule); `weapon` the kit rifles | contract v1 |
| rig | the crew importer's standing cut, both forearms bent to the rifle (`FORE_BEND`), `_rifle_at_hand` on each man -- `militia_cell`'s rule, three times | B3 |
| what is lost | the supplied `moveFire` (walk-and-shoot) and `fall` clips; `resolveMeshMotionClip` falls back to `fire` and the topple plays instead, as on every rig.py team | `mesh-anim.ts`, `mesh-death.ts` |
| nearest neighbour | **`sarim_rifles`** (three standing riflemen; `teams.py`: the straight line at even spacing against its diagonal wedge) and `militia_cell` (two). Levers kept: three in a line, centre man stepped forward, rifles | `teams.py` |
| sandbox | three in the base set | `sandbox-force.ts` |

```
A single low-poly game-ready rifleman, a soldier of a fictional army in a plain olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body. A small radio pouch on the left shoulder strap and a rolled olive poncho strapped across the lower back. Real-world scale, 1.78 metres tall. Olive drab cloth, black webbing, tan suede. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The signature is deliberately small: the rifleman is the baseline, and every
other KDF team was asked for the thing that makes it NOT this man (a rucksack,
goggles and a tool bag, a vest and visor). The rifle is kit.

## 20. `sarim_rifles` — Sarim Rifles (enemy, crew 8, 3 drawn)

Today: `art/meshes/sarim_rifles.glb`, the supplied irregular, **30,876 tris,
3 figures, 4.1 MB**, 1.63 m high, nine clips. Composition kept verbatim from
`teams.sarim_rifles`: `sar0` at (0.34, −0.90), `sar1` at (0.0, 0.0) leader,
`sar2` at (−0.34, 0.86) -- the diagonal wedge.

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4 |
| base figure | one Meshy Sarim figure, `--pose a-pose`, all three from it | bible §5 |
| height | **1.74 m** -- the trim mountain brigade, B2's MANPAD height; the supplied file's 1.61 sat under the bible's 1.66 floor | bible §3 |
| remesh `--polycount` | **1,500**, as `inf_squad`: ≈ **8,040** | bible §3 |
| bake | yes, 2k → 1024; both lists | #307 |
| roles | `uniform`, `boot`, `face`, `keffiyeh` by geometry; `weapon` the kit rifles; kit keffiyeh if the preview ignores the wrap (`ADD_KEFFIYEH`), head-wrap recolour if it paints one saturated (`RECOLOUR`) | B3/B4 |
| rig | as `inf_squad`; `rig.py` gains `sarim_rifles` in `SUPPORTED_TEAMS` / `TEAM_FIGURES` / `TEAM_MESH_OWNER` (it was never a kit export) | `rig.py` |
| what is lost | `moveFire`, `fall`, `fallAlt`, `wreckAlt` | as `inf_squad` |
| nearest neighbour | **`inf_squad`** (above) and **`militia_cell`** (two standing irregulars in a touching pair, open jacket). Levers kept: three, the wedge, no jacket bulk | `teams.py` |
| sandbox | two in the base set | `sandbox-force.ts` |

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away from the body. A short cropped field jacket with the sleeves rolled to the elbow and a single bandolier of rifle magazines across the chest. Real-world scale, 1.74 metres tall. Dusty tan cloth, faded olive, brown leather. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The cropped jacket is the Sarim register beside the coastal militia's ragged
open one: trimmer, a shade more uniform, and nothing that adds crest or width.

## 21. `mortar_team` — 60mm Mortar Team (KDF, crew 3, 3 drawn)

Today: `art/meshes/meshy_mortar_team.glb`, two supplied 980k-vertex sculpts
retargeted into a 180,670-tri file (5.8 MB) with synthesized clips. Composition
kept verbatim from `rig.TEAM_FIGURES["mortar_team"]`: `kit.mortar` 1.02 m at
(0.26, 0, 0) on `prop`; `mtr_crew0`/`mtr_crew1` kneeling at (−0.14, ∓0.54);
`mtr_no3` standing at (−0.62, 0.0), leader, with a rifle.

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4 |
| base figure | one Meshy KDF figure, `--pose a-pose`; two kneeling from it (`_kneel`) and one standing | bible §5 |
| height | **1.76 m** | bible §3 |
| remesh `--polycount` | **1,000** -- two kneelers each ship three copies plus a standing man: 2 × (1,000 + ~460 + 1,000 + ~340 + ~500) + (1,000 + 340 + 500) + mortar 64 + rifle 90 ≈ **8,650**, 8% over the cap, where 1,100 (B4's kneeler number) reads ~9,300; the bake carries the read | bible §3, B4 |
| bake | yes, 2k → 1024; both lists | #307 |
| roles | as `inf_squad` (KDF head `uniform`); `weapon`/`metal` the kit mortar and rifle | contract v1 |
| rig | B2's kneel and walker for the two crew (`move_posture="standing"`, `animates=False`), the standing No.3 with `_rifle_at_hand`; `rig._mortar_team_extras` verbatim on `prop`, hidden while the crew walks | `rig.py` |
| what is lost | the supplied limbered-march `move` (tube shouldered); the crew walk on D6 walkers with nothing carried, as `mortar_crew` does | `import_meshy_mortar_team.py` |
| nearest neighbour | **`mortar_crew`** (two kneeling irregulars and a 0.76 tube; the third man and the 1.02 tube are the levers), `atgm_cell`, `at_team` (one kneeler, one stander). Levers kept: three figures, the tallest spike | `teams.py` |
| the gait control | `mesh_gait.test.ts` measures the kit `mortar_team.glb` as the instrument's CONTROL (0.887 coverage); that file is overwritten here, so the control moves to a B3 rig.py walker whose coverage is pinned | `mesh_gait.test.ts` |
| sandbox | one in the base set | `sandbox-force.ts` |

```
A single low-poly game-ready mortar crewman, a soldier of a fictional army in a plain olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body. A tall boxy tan ammunition rucksack on the back with a short round bomb canister strapped to each side. Real-world scale, 1.76 metres tall. Olive drab cloth, black webbing, tan canvas. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The pack with its two canisters is what says "mortar" about a man who is not
holding the tube (the tube is kit) -- rear mass, so it does not read as
`at_team`'s plain box rucksack from the camera's side.

## 22. `sniper_team` — Sniper Team (KDF, crew 2, 2 drawn)

Today: `art/meshes/sniper_team.glb`, two supplied sculpts (one prone pair, one
standing pair) under `tools/export_meshy_sniper.py`, **27,991 tris, 0.8 MB**,
three roles. `rig._sniper_rest`'s contract is kept exactly: `snp_a` at (0.10,
−0.24) with the rifle, `snp_b` at (−0.24, +0.24) with binoculars; the PRONE
build on `{prefix}_death_root` is the LIVING pose (`idle`, `fire`, and tightened
to ±0.12 for `down`/`wreck`), the standing walker on `root` is `move` alone,
`rig.build_sniper_clips` unchanged.

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4 |
| base figure | one Meshy KDF figure, `--pose a-pose`, both men from it: a standing cut for the walker and the SAME cut re-arranged rigidly prone -- the kneel's method, flat: the body laid on its chest, both arms swung forward to the rifle (or the binoculars), the head raised on the neck. Bible §2: no prompt asks for a prone figure | `rig._sniper_rest` |
| height | **1.78 m** | bible §1 |
| remesh `--polycount` | **1,500** -- each man ships twice (prone + walker, no separate corpse): 2 × (1,500 + ~340 + 1,500 + ~340) + kit sniper rifle and binoculars twice ≈ **7,800** | bible §3 |
| bake | yes, 2k → 1024; both lists | #307 |
| roles | `uniform`, `boot`, `face` (KDF head `uniform`); `weapon` the kit sniper rifle, `metal` the binoculars | contract v1 |
| what is lost | the sculpted ghillie drape; the Meshy figure asks for a ghillie hood instead | below |
| nearest neighbour | nothing prone lives in the set (the gate compares `idle` only, and this is the one prone idle); `teams.py` calls it "the one sheet with no collision risk worth naming" | `teams.py` |
| gait pins | `sniper_team` is `GAIT_MULTIPLIER_UNDER_ONE`'s one entry (0.9144) and the slowest cadence in the tree; both move with the new walker and are re-pinned from the bytes | `mesh_gait.test.ts` |
| sandbox | not in the base set; fielded by missions; the capture spawns it | |

```
A single low-poly game-ready sniper, a soldier of a fictional army in a plain olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body. A shaggy ghillie hood of shredded burlap strips covering the helmet and draped down over the upper back. Real-world scale, 1.78 metres tall. Olive drab cloth, dusty tan burlap, black webbing. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The hood is on the head and the upper back only, on purpose: a full cape over
the A-pose arms would weld the arms to the torso and defeat the cut.

## 23. `yahalom_squad` — Yahalom Engineers (KDF, crew 5, 2 drawn)

Today: `art/meshes/yahalom_engineer.glb`, the supplied engineer, **20,544
tris, 2.7 MB**, eight clips including the tree's only `work`. Composition from
`rig.TEAM_FIGURES["yahalom_squad"]`: `yah_a` at (0.30, −0.20) leader with the
1.45 m mast and sensor head on `forearm_R`, `yah_b` at (−0.34, 0.26) with a
rifle; kit packs on both spines (`rig._yahalom_extras`).

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits | bible §4 |
| base figure | one Meshy KDF figure, `--pose a-pose`, both standing from it | bible §5 |
| height | **1.78 m** | bible §1 |
| remesh `--polycount` | **2,000** -- two standing men, no walker: ≈ **7,100** as `breach_team` | bible §3 |
| bake | yes, 2k → 1024; both lists | #307 |
| `work` | `rig.py` has never built it ("not built here", its own docstring), and `yahalom_engineer.glb` is the only mesh with one: `resolveClip` plays `work` for the whole of a tunnel charge. **The unit is done only if a `work` clip ships with it** -- the lead kneeling at the mast (a kneel copy of `yah_a` on its own root, the mast pitched into the ground), built through rig.py the way the walker is. If that cannot be built honestly inside this batch, the unit is SKIPPED and the reason is this row | `clip.ts`, `rig.py` |
| nearest neighbour | `breach_team` (two KDF men, shield and pole), `demo_squad`. Levers kept: the level mast at hip height, the square packs, two upright men | `teams.py` |
| sandbox | two in the base set | `sandbox-force.ts` |

```
A single low-poly game-ready combat engineer, a soldier of a fictional army in a plain olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body. Thick padded knee guards and elbow pads, and a coil of thick cord slung over one shoulder across the chest. Real-world scale, 1.78 metres tall. Olive drab cloth, black webbing, tan canvas. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The packs and the mast are kit (the tells), so the prompt asks for pads and a
coil -- surface, not silhouette -- and loses nothing if Meshy ignores them.

**Sent 2026-10-01, verbatim, all eight: 205 credits, no re-roll.** The two
refines, the five previews (`text --pose a-pose --refine --tex 2k`) and the
seven remeshes are in `docs/ASSET_PROVENANCE.md` ("batch B7") with task ids;
what each preview honoured and what the importer fixed in `style-bible.md`
§14. The rifleman and the sniper came holding a carbine instead of the A-pose
(kept, as B5's breach team was); the Sarim rifleman came bare-headed under a
green headband (kit keffiyeh, recolour); `yahalom_squad` was NOT skipped --
its `work` clip is built through rig.py now (§23's own condition).

## Order inside B7

The two refines first (cheapest, and the first measurement of a refine on an
old preview), then `inf_squad` (the reference, and the three-man cut), then
`sarim_rifles` (the same cut on the Sarim line), `mortar_team` (kneel + stand
+ prop), `sniper_team` (the new prone pose), civilians (no spend), and
`yahalom_squad` last, after its `work` question is answered. One preview, one
refine, one remesh each; gates after every unit; commit per unit; one PR per
two units.
