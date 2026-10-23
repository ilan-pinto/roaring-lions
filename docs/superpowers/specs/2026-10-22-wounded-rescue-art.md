# Wounded and rescue P2 -- art spec (numbers for the lead's approval)

GH-707 P2, with GH-709's #5-#7. **Nothing here is rendered or bought yet.** Every number
below is for the lead's go (memory: "approve art numbers before rendering"). The Meshy
prompts, written by an Opus agent at high effort, are in `docs/art/meshy-prompts-wounded.md`;
this page is the whole art set, Meshy and Blender, and the decisions it takes.

House rules for every model: maximum detail, simplified only to a measured budget; no flags,
insignia, numbers or text; team colour never baked; **no Red Cross, Red Crescent, Red
Crystal, Star of Life or Magen David Adom star** (Geneva Conventions, ruling) -- the medical
mark is a plain white (palest palette role) band beside the runtime team colour; every mesh
through `pnpm validate:meshes` (silhouette IoU <= 0.88 against every other mesh); AI art
disclosed in the PR.

## 1. Summary

| # | asset | route | credits planned / ceiling | file tris (cap) | IoU risk -> lever |
|---|---|---|---|---|---|
| 1 | `inf_medic_squad.glb` (2 figures, stretcher, casualty) | Meshy A-pose figure (preview, judge, refine 2k, remesh) -> `import_meshy_kdf_team.py`-style cut into `rig.py` parts | 35 / 55 | ~7,700 (8,000 team cap) | `at_team`, `demo_squad`, `breach_team`, `inf_squad` -> the upright folded stretcher 0.3 m over the helmet |
| 2 | stretcher prop | Meshy preview + remesh, palette (`metal` poles, `wood` canvas) | 25 / 45 | 600 (part of #1; prop cap 400-600) | none alone (a part) |
| 3 | `kdf_aid_post.glb` + `_wreck` + `_construction` | Meshy preview + remesh, palette; wreck and construction in Blender (`export_fw_works.py`) | 25 / 45 | 6,000 remesh, 8,000 cap | `kdf_medic_station` (hip tent + container), `camp`, `shanty` -> 1:1.5 plan, arched roof, off-centre porch |
| 4 | `veh_ambulance.glb` | Blender: `ifv_namer.glb` + raised-roof kit graft | 0 | ~9,600 (10,000 APC cap) | `ifv_namer` -> the raised box roof (+0.9 m) |
| 5 | `air_medevac_heli.glb` | Blender: `heli_yanshuf.glb` + hoist boom (+ external tanks if needed) | 0 | ~41,000 (legacy airframe) | `heli_yanshuf` -> boom + tanks; measured before export |
| 6 | `wounded_kdf.glb`, `wounded_sarim.glb` | `kit.py` prone figure in each side's kit, `rig.py` clips | 0 | ~1,500 each (8,000) | low: a lone prone man |
| | **Meshy total** | | **85 / 145** (~$1.70 / $2.90) | | approval is 120-150 |

8k option: the one refine at `--tex 8k` costs +5 (90 / 150). The brief said 2k; **lead's pick**.

## 2. The medic team (`inf_medic_squad`, "Nemala Medic Team")

- **Figures 2** (`hull.figures` 2, `rl_figures` 2, pinned equal by `mesh_roster.test.ts`).
  GH-709 drafted a six-man team; GH-707's two-man stretcher team wins (ruling order: the
  lead, then GH-707). One Meshy figure, cut twice, like `at_team`.
- **Size**: 1.78 m figures (the KDF standard), rest footprint within +-1.2 m.
- **Nodes / parts**: `rig.py` parts per figure, plus three new rigid parts: the folded
  stretcher bundle on `spine` (each man), the open stretcher on a `prop` bone, and a
  **casualty** (a `kit.py` prone figure in KDF kit) on that bone. Carbine = kit geometry on
  `{prefix}_weapon` (not in the Meshy figure: previews weld held weapons to the chest).
- **Texture**: the Meshy refine bake (2k, shipped at 1024); the white band is the bake's
  helmet band and left-arm band, scrubbed of any red by the importer (0 credits).
- **Clips**: `idle, move, moveFire, fire, down, wreck` (rig.py) + the motion pass's kneel
  set; `treat` = the kneel over the casualty's position; `carry` = both men at the handles,
  open stretcher and casualty shown (scale 1 only in `carry`), the rear man's folded bundle
  hidden. **No `drag`**: the sim drags only with a one-man medic, and none ships.
- **Budget**: 2 x (1,800 + ~340) + 2 posed corpses x ~1,000 + 2 carbines x ~90 + stretcher
  600 + casualty ~1,000 = **~7,640** of the 8,000 cap. The prompts file says remesh 2,000 per
  figure; with the casualty (decision D-A below) that is ~8,040, so **remesh 1,800**.
- **Gate trap**: `validate:meshes` renders frame 0 of `idle`, where the stretcher and the
  casualty are scaled to 0: their origin must sit inside the team footprint.
- **Open for the lead**: in `carry` the two men stand +-1.35 m apart on a 2.2 m litter,
  past the +-1.2 m team footprint. Recommendation: allow it for `carry` only.

## 3. The stretcher prop

2.2 x 0.55 m, open and empty, poles, canvas bed, two spreader bars, four stirrup feet; 600
tris; palette (`metal` gunmetal fittings, `wood` tan canvas), zero materials. Used in #1's
`carry`, optionally on the ground beside the aid post (a building kit piece), and optionally
racked on the ambulance roof. Drawn at about 30 x 8 px, where a texture shows nothing.

## 4. The aid post (`kdf_aid_post`, structure)

- **Footprint 2x3 tiles = 6 x 9 m**, one storey, ridge ~3.4 m. The 9 m axis is the footprint's
  `h` (map y); the exporter's yaw is checked against a 2x3 test box before export, since every
  shipped KDF work is square and none has proved the axis.
- **Shape**: a long arched modular shelter (no shipped building has a curved roof) with a
  gabled entrance porch off-centre on the camera-facing long side, stakes and guy lines as
  solid geometry, stacked crates. Porch flap on Blender `+X` or `-Y`, with a kit `glass`
  pane in the doorway so `building_facing.py` can judge the front.
- **Roles**: `wall` canvas (the type's `olive.1`), `metal` frame, `wood` crates, `glass` door
  pane; optional `dome` (`limestone.1`, the palest building role) strip across the porch
  gable as the white band. **Lead's pick: the strip (recommended) or no mark.**
- **Tris**: remesh 6,000, cap 8,000 (palette building cap 20,000).
- **Wreck** (Blender, 0 credits): the frame folded, canvas flat over the crates, ONE arched
  hoop left standing at the far end (the element that says which building it was), porch down.
- **Construction** (KDF buildable): the standing mesh cut at 45 % + the shared scaffold kit,
  as the four KDF works.
- **Data** (staged, `docs/campaign/special_units/gh707_structures/kdf_aid_post.json`): 200 hp
  a tile, 200 logistics, 25 s build, the medic station's heal aura, `aid { admit_radius 1,
  treat_s 20, dispatch_radius 12 }`, symbol `A`.

## 5. The armoured ambulance (`veh_ambulance`, "Pered Armoured Ambulance")

- **Route**: Blender, `ifv_namer.glb` (7.30 x 3.99 x 4.12 m, 8,483 tris, textured, 3 maps)
  copied to a new `veh_ambulance.glb`. GH-709 planned a Meshy model (35 / 75); GH-707's
  ruling 4 (the lead's, on PR #728) reuses the Namer, so that spend is not made.
- **Kit (0 credits)**: the RWS/turret removed; a raised box roof over the rear two-thirds of
  the hull (+0.9 m, 4.4 x 3.2 m), flat-sided with a rear roof hatch; two stretcher racks on
  the roof sides (the #3 stretcher, folded); two spotlights; a white band (palest vehicle
  role) round the box under the team colour. Palette parts inside a textured vehicle (the
  per-mesh rule). The Namer's three upgrade tracks' `kit_*` nodes are stripped (the
  ambulance has no upgrades).
- **Tris**: ~8,500 hull + ~1,100 kit = **~9,600** of the 10,000 APC cap.
- **Pipeline**: export -> `running-gear:meshes` (the Namer's track and road-wheel recipe,
  copied) -> `wreck:meshes` (the Namer recipe) -> `damage:meshes` (thrown track, as the
  Namer) -> `encode:meshes`; `mobility.weight` role default; portrait and plate.
- **IoU**: the roof box is the lever against `ifv_namer`; measured before anything is
  committed; if it does not clear 0.88, the box goes taller (1.1 m), not a Meshy spend.

## 6. The medevac (`air_medevac_heli`, "Nachlieli Medevac")

- **Route**: Blender on `heli_yanshuf.glb` (5.30 x 1.73 x 4.32 m at game scale, 40,669 tris,
  textured, `idle`/`wreck`), 0 credits.
- **Kit**: a rescue-hoist davit over the right cabin door (arm ~0.9 m out, reel, cable stub);
  two external tanks on stub pylons; a white band round the tail boom (palest role); Peten
  precedent for a variant GLB.
- **IoU**: the boom and the tanks are small against a rotor disc; **measured first**. If
  `heli_yanshuf` vs `air_medevac_heli` reads over 0.88, options in order: larger tanks and
  a cabin-side litter pannier (0 credits); else one Meshy part (35, inside the ceiling).
- **Pipeline**: export -> `wreck:meshes` -> `damage:meshes` (rotor split as the Petens) ->
  `encode:meshes`; air units take no weight params.

## 7. The wounded (`wounded_kdf`, `wounded_sarim`)

- **Route**: `kit.py` prone figure in each side's kit (the death-figure geometry that exists
  today), bound rigidly by `rig.py`, 0 credits. One figure each (`hull.figures` 1).
- **Clips**: `down` (lying, a slow breath), `idleWounded` (lying, a hand to the wound),
  `crawl` (elbows and one knee, stride matched by `gait:meshes` to 0.12 tile/s), `wreck`
  (still; a dead wounded man). Ground pass applies; a crawling figure is in
  `BELOW_GROUND_BY_DESIGN` only if measured to need it.
- **No `dragged` / `carried`** (decision D-A): a carried wounded is hidden and the medic's
  `carry` draws the casualty; inside a vehicle he is hidden too.
- **Tris**: ~1,500 each; IoU low risk (a lone prone man).
- **Data** (staged in `docs/campaign/special_units/gh707/`): role `wounded`, hp 30, no
  weapon, sight 0, `can_embark: true`, signature 0.3, speed 0.12, logistics 0.

## 8. Decisions this spec takes (for the lead)

- **D-A: one rig carries the casualty.** The carried wounded entity is hidden; the medic
  team's `carry` clip draws a KDF-kit casualty on its own stretcher. This avoids aligning
  two entities' rigs frame by frame. Cost: a carried Sarim or civilian wounded draws in KDF
  kit at 25 px. Spec §7's `dragged`/`carried` clips and the medic's `drag` are dropped.
- **D-B: the ambulance is the Namer** (GH-707 ruling 4) instead of GH-709's Meshy model;
  saves 35-75 credits.
- **D-C: the medic team is two men** (GH-707) instead of GH-709's six; crew 2, hp 360 kept.
- **D-D: remesh 1,800 per medic figure** (not the prompts file's 2,000) to fit the casualty
  under the 8,000 team cap.
- Lead picks: 2k vs 8k refine; the tent's white strip; the `carry` footprint.

## 9. Order once approved

Meshy (each call's estimate in `_coord/wounded-rescue-progress.md` first): medic figure
preview -> judge -> refine -> remesh; stretcher preview -> judge -> remesh; tent preview ->
judge -> remesh. Then Blender, foreground, one unit per commit with its data moved out of
staging: medic team, aid post, ambulance, medevac, wounded pair. Gates per commit plus
`pnpm validate:meshes`.
