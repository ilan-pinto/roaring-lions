# Meshy prompts and numbers tables — the E5 special forces (GH-181, part 2)

**WP-G-E5 (#181) part 2 · 2026-09-30 · the art for the three bought-only units staged in
`docs/campaign/special_units/e5/`.** Sibling of `meshy-prompts-units.md` (B0) and written
to the same rule: every number below is what is approved **before any Meshy call**, every
prompt is the style bible's §5 template with its slots filled, and the credits come from
`pnpm meshy -- estimate` (no API call). Design: `docs/superpowers/specs/2026-09-29-e5-special-forces-design.md`
§6; plan: `docs/superpowers/plans/2026-09-29-e5-special-forces.md` Task 8.

**These are held meshes, not wired ones.** Task 9 (the Zikit and the Gunship) and E6 (the
Tzav) land the staged JSON and wire `SPRITE_MAP` / `mesh-catalogue.ts`. Until then each GLB
sits in `art/meshes/**` under `HELD_MESH_FILES` (the mechanism the GH-277 field works used),
so `mesh-catalogue.test.ts`'s orphan check knows the file is waiting rather than forgotten.
The plan's Task 8 step 4 said the Tzav GLB must NOT be committed because that check would
fail; `HELD_MESH_FILES` is what makes committing it honest instead.

## The credit plan, against the 65 approved (140 cap)

| unit | class (bible §4) | steps | credits |
|---|---|---|---|
| `heli_peten_gunship` | Blender, from the shipped `heli_peten` export | none | **0** |
| `recon_zikit` | figure team, bake, rig through `rig.py` | preview 20 + refine 10 + remesh 5 | **35** |
| `demo_tzav` | textured vehicle | preview 20 + refine 10 + remesh 5 | **35** |
| | | **planned** | **70** (~$1.40) |

Why 70 and not the plan's 65. The plan priced the Tzav as a palette vehicle (25) and put
its bake (+10) in the ceiling; B0b then measured a figure team at 35, not 40 (the Meshy
rig is never bought — `rig.py` drives a remesh cut into its own parts). The Tzav ships a
bake because every hull it drives beside does (`mbt_lavi`, `ifv_namer`, `apc_eitan`,
`apc_kipod`, `dozer_d9` — all in `TEXTURED_VEHICLE_TYPES` after B0a), and a palette hull in
that line-up is one register short, which is the argument the bible's §7 q8 already won
for the Eitan. Net: 70 planned, 5 over the round figure, 70 under the cap.

**Hard cap 140.** One preview per concept. A preview that needs a re-roll STOPS that unit
(what exists is kept and reported); no extra call of any kind is made. The Gunship's
fallback pod part (25, plan Task 8 step 2) is NOT taken: a pod part does not change a
silhouette, so it cannot fix an IoU result, and IoU is the only thing that could send the
Gunship back to Meshy.

## Order

1. Gunship first, at zero credits, and its IoU against `heli_peten` measured through
   `tools/render_mesh_gate.py` before either Meshy call is made.
2. Zikit: one `text --refine --tex 2k --pose a-pose` call, then one `remesh`.
3. Tzav: one `text --refine --tex 2k` call, then one `remesh`.
4. Blender fits, exports, `pnpm wreck:meshes` for the two vehicles, `pnpm encode:meshes`,
   the gates, provenance, one commit per unit.

---

## 1. `heli_peten_gunship` — Peten Gunship (KDF, air, gunship)

| item | number | source |
|---|---|---|
| class | **0 credits**, Blender only | design §6, plan Task 8 step 2 |
| source | `art/meshes/vehicles/heli_peten.glb` — the shipped export of the supplied Meshy Peten (`tools/vehicles/export_meshy_apache.py`), re-opened in Blender; its `death_root` and clips are stripped and re-made by the wreck pass | the bible: "supplied files are used as-is"; the 787k-vertex `.blend` sources are not re-cut |
| real size | **4.684 m** long, as the Peten draws (`APACHE_HULL` manifest `realMetres`; the mesh measures 4.37 m hull + 2.45 m rotor radius) | the Gunship is a variant, so it takes the Peten's own drawn size unchanged |
| size class | `air` — the Peten's | `SIZE_CLASS` |
| tris | Peten live: hull 23,523 + glass 2,680 + metal 2,826 + rotor 12,002 = **41,031**; the added parts stay under **+2,000** | measured 2026-09-30 in Blender |
| roles / parts | keeps `hull_hull`, `hull_glass`, `hull_metal`, `rotor_metal` under `rotor_tilt → rotor_pivot`; adds `wing_hull` (two stub wings), `pod_metal` (four rocket pods, two per wing, tubes along +X with a honeycomb front face), `tank_hull` (two drop tanks inboard), `mast_metal` (the mast-top dome above the rotor hub), `sensor_glass` (a nose sensor ball). **Every added part is UV-pinned to a plain-olive texel of the Peten's own `base_color` bake and shares its one material**, so the file stays one material and one register; the runtime's textured branch is per mesh, so a palette part would also be legal, but two registers on one hull is what the bake is there to avoid | mesh contract v2; `mesh-vehicle.ts` |
| pivots | `rotor_pivot` (`extras.rl_pivot = "rotor"`) under `rotor_tilt`, exactly as shipped; no `turret_pivot` (the Peten has none) | `export_meshy_apache.py`, "NO TURRET" |
| wreck | `pnpm wreck:meshes -- --id=heli_peten_gunship`, recipe `{ hull: 'air', rotorPivot: 'rotor_pivot' }` like the Peten | `wreck-recipes.ts` |
| textured lists | `heli_peten_gunship` added to `TEXTURED_VEHICLE_TYPES` and `TEXTURED_VEHICLE_EXEMPT` (it ships the Peten's bake) | `textured-vehicle.test.ts` pins the two |
| silhouette lever | stub wings with four pods and two tanks below the rotor disc, a mast dome above it, a sensor ball under the nose — mass added at the waist and on the mast, where the Peten has none | design §6 |
| nearest neighbour | **`heli_peten`** itself. The named risk: the wings sit under the rotor disc, which from the 30-degree camera covers most of the span. **Measured before anything else**, and the parts are sized in Blender (0 credits) until IoU < 0.88; the plan's fallback pod part is not a lever for this | plan Task 8 step 2 |
| catalogue | held: `HELD_MESH_FILES['vehicles/heli_peten_gunship.glb']` → Task 9 wires `VEHICLE_UNIT_MESHES` | |

No prompt: nothing is generated.

## 2. `recon_zikit` — Shmamit Deep Recon Team (KDF, crew 4, drawn as 3 figures)

| item | number | source |
|---|---|---|
| class | figure team (bake, no bought rig), **35** credits | bible §4, B0b measurement |
| base figure | **one** Meshy A-pose figure, **1.78 m** (the KDF rifleman reference), cut into `rig.py` parts three times — the B0b method (`tools/units/import_meshy_kdf_team.py`), extended to three figures in `tools/units/import_meshy_zikit_team.py` | bible §5; B0b |
| remesh `--polycount` | **1,500** per figure, not the table's 2,000: three figures each carry a half-decimated prone corpse, so 2,000 lands at ~9,500 tris against the **8,000** file cap while 1,500 lands at ~7,000. B2 remeshed at 1,500 for the same reason | bible §3; B0b §8 |
| shipped cap | 2,500 per figure, 8,000 per file incl. kit parts | bible §3 |
| footprint | feet at z = 0, `+X` forward, within ±1.2 m: `zk_radio` standing at (−0.30, +0.05), `zk_spot` kneeling at (+0.25, +0.65) behind a tripod scope on the team's `prop` bone at (+0.74, +0.65), `zk_rifle` standing at (+0.10, −0.70) | bible §2 |
| bake | **yes**: ask 2048, ship 1024 JPEG q85 on `uniform`/`boot`/`face`; normal and metallic-roughness dropped. Needs `recon_zikit` in `TEXTURED_INFANTRY_TYPES` and `TEXTURED_INFANTRY_EXEMPT` | B0b |
| rig / clips | `rig.py`'s own bone tables and clips (`idle, move, fire, down, wreck`), bones prefixed `zk_radio_`/`zk_spot_`/`zk_rifle_`; rigid one-part-one-bone, no weight painting. The spotter kneels through `move` like `at_team`'s gunner. Falls are the held prone corpse (`down`/`wreck`), as every `rig.py` team | CLAUDE.md "Mesh units" |
| kit parts (0 credits) | the whip antenna: `kit.tube` 0.46 m at **80°** from the radio pack (`zk_radio_spine`); the tripod scope: three `kit.tube` legs and a `kit.box` scope at the kneeling eye height (`prop`); the rifle: `rig._weapon_parts` held level at the hung right hand (`zk_rifle_forearm_R`, the B0b `demo_b` method). `weapon`/`metal` roles, palette | bible §2 "crew weapons" |
| silhouette levers | a whip at 80° over one man, a kneeling man behind a low tripod, and one rifle among three — against `inf_squad` (three standing rifles in a line), `at_team` (kneel + stand, level tube), `sniper_team` (prone) | design §6 |
| nearest neighbour | `inf_squad` (the Meshy `meshy_soldier` file) and `at_team`; unmeasured until the gate runs | |
| catalogue | held: `HELD_MESH_FILES['recon_zikit.glb']` → Task 9 wires `RIGGED_UNIT_MESHES` (kdf). `pnpm gait:meshes` is scoped to that table, so the `rl_gait` extra is written through `processGaitFile` directly and re-run at landing | contract v3 |

The prompt is design §6's with two slots changed on purpose. The whip antenna and the slung
carbine are **out**: B0a measured that a remesh drops every thin whip, and a slung gun on the
base figure would put a carbine on all three men beside the kit rifle. Both are kit geometry
placed at a controlled angle, which is the whole point of a silhouette lever.

```
A single low-poly game-ready reconnaissance soldier, a soldier of a fictional army in a plain olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body. A large boxy radio backpack high on the back, and a rolled shemagh scarf around the neck. Real-world scale, 1.78 metres tall. Olive cloth, black webbing, tan canvas. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

563 characters. Call: `pnpm meshy -- text "<prompt>" --pose a-pose --refine --tex 2k --name recon_zikit --yes`,
then `pnpm meshy -- remesh <refine id> --polycount 1500 --name recon_zikit --yes`.

## 3. `demo_tzav` — Shiryonan Demolition Carrier (KDF, tracked engineering vehicle)

| item | number | source |
|---|---|---|
| class | textured vehicle, **35** credits | bible §4; see the credit plan for why baked |
| real size | **8.5 m** long over the arm and crate (design §6; the hull under it ~7 m). No sprite manifest exists yet (`TZAV_HULL` is E6's), so the exporter declares 8.5 in its spec as `real_metres` and E6's sheet must be rendered from the same source | `dimetric.metres_per_unit` |
| size class | `heavy_vehicle`, ×1.0 | `SIZE_CLASS` |
| remesh `--polycount` | **5,000** (plan Task 8 step 4); cap **8,000** | bible §3 light-vehicle row |
| bake | yes: 2k refine, shipped at `textured.TEXTURE_PX` 2048 (the vehicle rule "dont drop resolution"); `demo_tzav` in `TEXTURED_VEHICLE_TYPES` + `TEXTURED_VEHICLE_EXEMPT` | `textured.py` |
| file | `art/meshes/vehicles/demo_tzav.glb`, contract v2: `hull_hull` (body, arm, crate), `hull_rubber` where the tracks separate cleanly (else they stay in the hull), `+X` forward, origin at ground centre | bible §2 |
| pivots | **`turret_pivot`** with a small kit RWS (`kit.rws`, the Eitan/Kipod precedent) for its `rws_mg`: the plan's step 4 said "no `turret_pivot`", but the staged unit fires an hmg and the contract puts a pivot "wherever anything traverses"; a fixed MG on a 2,600 hp hull would read as unarmed. Placed at the roof band the exporter measures, never typed | contract v2; B0a |
| wreck | `pnpm wreck:meshes -- --id=demo_tzav`, recipe `{ hull: 'tracked', turretPivot: 'turret_pivot' }` | `wreck-recipes.ts` |
| palette tables | `VEHICLE_ROLE_PALETTE` (runtime) and `VEHICLE_ROLE_PALETTES` (gate), KDF olive like `apc_eitan`, for the kit RWS roles `metal`/`plate` and the gate's repaint | `vehicle-mesh-role.test.ts` |
| silhouette lever | a folding arm reaching past the bow holding a square crate raised ~30°, and no turret | design §6 |
| nearest neighbours | `apc_kipod` (7.2 m, full-length raised roof), `ifv_namer` (7.3 m, turret), `dozer_d9` (6.8 m, blade), `apc_eitan`, `mbt_lavi`; unmeasured until the gate runs | design §6 |
| ownership | `tools/vehicles/export_meshy_tzav.py` owns the file; it is not in `export_mesh_vehicle.py`'s `SPECS` (nothing there can regenerate it) | `mesh_ownership.py` |
| catalogue | held: `HELD_MESH_FILES['vehicles/demo_tzav.glb']` → E6 wires it | |

The prompt is design §6's with the faction line replaced by the bible's own KDF machine line
(Q8 asked for a KDF vehicle line; the bible has carried one since B0, so a second is not
added) and the arm asked to leave the roof empty for the kit RWS.

```
A single low-poly game-ready heavy tracked armoured engineering vehicle with a folding hydraulic arm at the front holding a large square demolition crate, a machine of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest, level. The arm reaches forward past the bow and holds the crate raised at about 30 degrees, clearly ahead of the hull, and the flat roof is empty with no turret. Real-world scale, 8.5 metres long. Worn olive paint, gunmetal arm, black tracks. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

663 characters. Call: `pnpm meshy -- text "<prompt>" --refine --tex 2k --name demo_tzav --yes`,
then `pnpm meshy -- remesh <refine id> --polycount 5000 --name demo_tzav --yes`.

## Gates, per unit

`pnpm validate:meshes` (first `git status art/meshes/` for strangers), `pnpm validate:assets`,
`pnpm encode:meshes` then `-- --check`, `pnpm test`, `pnpm typecheck`, `pnpm lint`. Held meshes
cannot draw in a mission, so the in-game look is stood in for by headless renders through the
gate's own rig at the game camera: zoomed in, and at gameplay scale beside a shipped neighbour.

---

## Outcome (2026-09-30, same day; the Tzav on 2026-10-01)

| unit | spent | result |
|---|---|---|
| `heli_peten_gunship` | 0 | shipped held: 41,771 tris, IoU vs `heli_peten` **0.653** (first build, no re-render loop needed), wreck pass applied, `TEXTURED_VEHICLE_TYPES` |
| `recon_zikit` | **35** (preview 20 + refine 10 + remesh 5; tasks `01a0f343` / `01a0f344` / `01a0f346`) | shipped held: 7,997 tris, five clips, `TEXTURED_INFANTRY_TYPES`; highest IoU 0.598 (`mortar_team`) |
| `demo_tzav` | **35** (preview 20 + refine 10 + remesh 5; tasks `01a0f5f2` / `01a0f5f3` / `01a0f5f6`, 2026-10-01) | shipped held: 4,940 tris, `TEXTURED_VEHICLE_TYPES`, kit RWS under `turret_pivot` on the measured cab roof; highest IoU 0.838 (`apc_eitan`), `dozer_d9` 0.765, `ifv_namer` 0.792; fill 22.3%. The 2026-09-30 attempt's two `text` calls answered HTTP 402 `API key credit limit reached` with 3,735 on the balance (the key's own limit, not the account); no task, no charge. Ran at 35 the next morning once the limit was raised |
| | **70 of 70 planned, cap 140** | |

Two numbers in section 2's table moved in the build and are recorded here rather than
rewritten above: the corpses stay at B0b's 0.5 (0.3 was measured as spikes at zoom 2.5)
and the tri budget was found in the seam blobs instead (24 of them at kit's 9x3 cost more
than a whole figure; 6x2 hides a rigid cut just as well at 25 px), which is what puts
three figures at 7,997 against the 8,000 cap. The `rl_gait` extra is not on the held file
(`gait:meshes` is scoped to `RIGGED_UNIT_MESHES`) and is applied at landing.

The Tzav's preview came back as the hull the prompt asked for -- a long tracked armoured
body with a raised rear cab -- carrying its crate upright on a short mount hard against
the bow rather than on a folding arm reaching past it. It was kept (one preview per
concept, a wrong preview is fixed in Blender), and nothing needed fixing: the gate reads
it at 0.765 against the D9 and 0.792 against the Namer, the crate end measured at +X
already, and the two roof whips the remesh kept (B0a's finding that a remesh drops every
whip did not hold at 5,000 polys) are a few pixels at any zoom. Two of section 3's numbers
moved in the build: the bake needed no `olive_shift` (hue 86 against the D9's 70 and the
Eitan's 102, measured on the linear buffers), and the station sits on a measured flat
roof rather than a ring -- there is none -- with its height read off the hull and its
x/y the probe's seed.
