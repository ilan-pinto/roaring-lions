# Attribution: Meshy-generated art

Written 5 Nov 2026 (GH-933), on the project lead's ruling of that day.

## The credit

Much of the 3D art and the ground textures in this repository was generated
with [Meshy](https://www.meshy.ai) (meshy.ai), an AI 3D generator, and then
processed in Blender.

> 3D models and textures generated with Meshy (meshy.ai).
> Licensed under CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/>.
> Credit: Meshy, <https://www.meshy.ai>.

This credit is given under Meshy's **published free-plan terms**, which ask for
a CC BY 4.0 credit to Meshy. It is given now, in the repository, as a matter of
care.

## What this file does not say

- It makes no claim about who owns the output. Whether the output of the
  free plan is owned by the user or by Meshy has been **asked of Meshy and is
  pending**. Until Meshy answers, this file records the credit and nothing more.
- It does not change the repository's own licence. Art and data remain "all
  rights reserved" (`CONTRIBUTING.md`, `data/LICENSE.md`); this file is a credit
  to the tool's maker, not a grant to anyone.
- It does not say which plan any single asset was generated under. The Meshy
  ledger recorded no plan before 1 Nov 2026. See "Plan per asset" below.

## Asset groups credited

"Meshy-origin" means the shipped file derives from a Meshy text-to-3D or
image-to-3D result (its mesh, its texture bake, or both). Code-built parts,
rigs and animation clips added in Blender are not Meshy output.

| Group | Files | How it is identified |
|---|---|---|
| Infantry and crew teams, officers, civilians, the recon robot | `art/meshes/*.glb` for the types in `TEXTURED_INFANTRY_EXEMPT` (`tools/validate_mesh_assets.py`): `at_team`, `demo_squad`, `militia_cell`, `rpg_team`, `atgm_cell`, `mortar_crew`, `charge_squad`, `digger_crew`, `breach_team`, `moto_rpg`, `officer_infantry`, `officer_fires`, `officer_engineer`, `recon_zikit`, `ugv_recon_dog`, `manpad_team`, `recoilless_team`, `civilian_*`, `office_worker`, `farm_worker`, `inf_squad`, `sarim_rifles`, `mortar_team`, `sniper_team`, `yahalom_squad`, `inf_medic_squad`, `at_nlos_team`, `inf_grenadier` | `TEXTURED_INFANTRY_EXEMPT`; ledger names match the type ids |
| Vehicles and aircraft | `art/meshes/vehicles/*.glb` for the types in `TEXTURED_VEHICLE_EXEMPT`: `mbt_lavi`, `ifv_namer`, `technical`, `rocket_battery`, `paramotor`, `heli_peten`, `jeep_shoded`, `gun_truck`, `apc_eitan`, `apc_kipod`, `dozer_d9`, `scout_shachaf`, `officer_armour`, `mbt_lavi_camo`, `heli_peten_gunship` and the later entries of that set | `TEXTURED_VEHICLE_EXEMPT` |
| Buildings and field works | `art/meshes/buildings/*.glb` for the types in `TEXTURED_BUILDING_EXEMPT`: `house`, `apartment`, `warehouse`, `clinic`, `hall`, `fence`, `militia_observation_post`, `militia_weapons_workshop`, `militia_field_clinic`, `concrete`, `shanty`, `wall`, `camp`, `relay`, `pump_house`, `hesco`, and their wreck twins and LOD1 twins | `TEXTURED_BUILDING_EXEMPT` |
| Terrain decor, props, tunnels, drones, backdrop kit | `art/meshes/decor/*.glb` (boulders, bushes, cedars, desert trees, grass, reeds, rocks, sand, slabs, trees, wet grass, the ditch), `art/meshes/props/*.glb` (except `spoil_heap.glb`, built from primitives), the drone swarm and tunnel pieces, `art/meshes/backdrop/` | `tools/terrain/export_meshy_*.py`, `tools/drones/export_meshy_drones.py`; the ledger |
| Ground-tile textures | `art/textures/*_tile.png` and `assets/textures/*_tile.jpg`: desert sand, green basin, rock ground, rough scrub, orchard floor, basalt rock, basalt scree, highland, knoll scree, oak litter, road track, wet scrub, wetland open | The tile image was fed to Meshy; `docs/ASSET_PROVENANCE.md`, "Ground textures" |
| Renders of the above | Unit portraits, plates and any picture rendered from the GLBs above | `docs/ASSET_PROVENANCE.md` |

The authoritative per-file record, with the ledger entry, tool and open
questions for each file, is the register in `docs/ASSET_PROVENANCE.md`
(`python3 tools/check_provenance_register.py` checks that every tracked file
has a row). The Meshy working record is `art/meshy/ledger.jsonl` and the
`art/meshy/<slug>-<date>-<id>/` task folders. If this file and the register
disagree, the register is right and this file should be fixed.

Not in these groups: audio (a separate record in `docs/ASSET_PROVENANCE.md`),
video, and files built by code with no generative tool.

## Plan per asset

From **1 Nov 2026** every new Meshy spend records the plan tier it ran under in
its ledger row, in a `plan` field. Rows written before that date carry no
field and are not edited. Details: `docs/ART_PIPELINE.md`, section 7 (Meshy).

## Open

The pending question to Meshy (ownership of free-plan output) is tracked in
GH-933 and in `docs/ASSET_PROVENANCE.md`, "Meshy plan tier for commercial use".
The lead decides whether anything is regenerated only after Meshy answers.
