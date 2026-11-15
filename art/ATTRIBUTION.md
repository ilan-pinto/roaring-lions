# Attribution: Meshy-generated art

Written 5 Nov 2026 (GH-933), on the project lead's ruling of that day.

## The credit

Much of the 3D art and the ground textures in this repository was generated
with [Meshy](https://www.meshy.ai) (meshy.ai), an AI 3D generator, and then
processed in Blender.

> 3D models and textures generated with Meshy (meshy.ai).
> Licensed under CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/>.
> Credit: Meshy, <https://www.meshy.ai>.

This credit is kept as a **courtesy**. The Meshy account was on a **paid plan
for every generation** (about 29 Aug 2026 to 15 Nov 2026, the lead's
confirmation), and under Meshy's Terms of Service (Last Updated 19 Sep 2026)
§3.2 customers on a paid plan own their Customer Output. The CC BY 4.0 credit
is what Meshy's free-plan terms would ask for; it costs nothing to give and is
given as a matter of care.

## What this file does not say

- It is not a licence grant to anyone, and it is not the source of the project's
  rights: those are ownership of the output under a paid plan (Terms §3.2),
  recorded in `docs/ASSET_PROVENANCE.md`, "Commercial rights".
- It does not change the repository's own licence. Art and data remain "all
  rights reserved" (`CONTRIBUTING.md`, `data/LICENSE.md`); this file is a credit
  to the tool's maker, not a grant to anyone.
- It does not record the plan per ledger row. The ledger recorded no plan before
  1 Nov 2026; the lead's word covers the whole window. See "Plan per asset" below.

## Asset groups credited

"Meshy-origin" means the shipped file derives from a Meshy text-to-3D or
image-to-3D result (its mesh, its texture bake, or both). Code-built parts,
rigs and animation clips added in Blender are not Meshy output.

| Group | Files | How it is identified |
|---|---|---|
| Infantry and crew teams, officers, civilians, the recon robot | `art/meshes/*.glb` for the types in `TEXTURED_INFANTRY_EXEMPT` (`tools/validate_mesh_assets.py`): `at_team`, `demo_squad`, `militia_cell`, `rpg_team`, `atgm_cell`, `mortar_crew`, `charge_squad`, `digger_crew`, `breach_team`, `moto_rpg`, `officer_infantry`, `officer_fires`, `officer_engineer`, `recon_zikit`, `ugv_recon_dog`, `manpad_team`, `recoilless_team`, `civilian_*`, `office_worker`, `farm_worker`, `inf_squad`, `sarim_rifles`, `mortar_team`, `sniper_team`, `yahalom_squad`, `inf_medic_squad`, `at_nlos_team`, `inf_grenadier` | `TEXTURED_INFANTRY_EXEMPT`; ledger names match the type ids |
| Vehicles and aircraft | `art/meshes/vehicles/*.glb` for the types in `TEXTURED_VEHICLE_EXEMPT`: `mbt_lavi`, `ifv_namer`, `technical`, `rocket_battery`, `paramotor`, `heli_peten`, `jeep_shoded`, `gun_truck`, `apc_eitan`, `apc_kipod`, `dozer_d9`, `scout_shachaf`, `officer_armour`, `mbt_lavi_camo`, `heli_peten_gunship`, `aa_remetz`, `air_medevac_heli`, `attack_drone`, `demo_tzav`, `heli_yanshuf`, `recon_drone`, `spg_cluster`, `spg_long_range`, `veh_ambulance` (the full set, 24 ids, is `TEXTURED_VEHICLE_EXEMPT` in `tools/validate_mesh_assets.py`) | `TEXTURED_VEHICLE_EXEMPT` |
| Buildings and field works | `art/meshes/buildings/*.glb` for the types in `TEXTURED_BUILDING_EXEMPT`: `house`, `apartment`, `warehouse`, `clinic`, `hall`, `fence`, `militia_observation_post`, `militia_weapons_workshop`, `militia_field_clinic`, `concrete`, `shanty`, `wall`, `camp`, `relay`, `pump_house`, `hesco`, `house_lod1`, and their wreck twins (the full set, 17 ids, is `TEXTURED_BUILDING_EXEMPT`) | `TEXTURED_BUILDING_EXEMPT` |
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
field and are not edited; for those, the register relies on the lead's
confirmation that the plan was paid throughout. Details: `docs/ART_PIPELINE.md`,
section 7 (Meshy).

## Open

Ownership is closed (GH-933, 15 Nov 2026): no question to Meshy is pending and no
regeneration is needed for rights. One follow-up stays open, the Terms §2.4
AI-identifier question, in `docs/ASSET_PROVENANCE.md`, "Meshy terms of 19 Sep
2026, and the §2.4 AI-identifier census".
