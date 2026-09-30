# Asset provenance

Where every shipped asset came from, and which ones cannot ship as-is.

Written 2026-08-30, when the project lead stated an intent to **close-source the
game and release it on Steam**. That changes what matters: redistribution of
*source* stops being the question, and **commercial use** plus **attribution
obligations that survive into a credits screen** become the question.

This file is a snapshot with a date on it. It is not a gate. See
"The gap" below for why that is the most important line in it.

The in-game credits screen (`ui/credits.ts`, `/credits`) is the player-facing
surface of this file: `credits-data.ts` carries forward only the entries
whose licence requires a credit — the Namer's, below — plus the AI-generated
disclosure this file's own header already anticipated.

---

## The three mechanisms, one of which does not exist

| Assets | Provenance record | Enforced by |
|---|---|---|
| **Audio** (`assets/audio/`) | `license` + `source` per clip in `data/audio.json` | `tools/validate_audio.py` — rejects any clip whose licence does not permit redistribution, any missing `source`, any undeclared file |
| **Sprites** (`assets/sprites/`) | `credit` in each set's `manifest.json`, written by its `render_*.py` | nothing — the field is conventional, not checked |
| **Meshes** (`art/meshes/`) | **none** | **nothing** |

`tools/validate_mesh_assets.py` checks palette, silhouette and completeness. It
does not look at provenance, because there is no provenance to look at.

**38 mesh GLBs ship with no recorded origin**, ten of them AI-generated.

---

## Sprites: 41 sets, all with recorded rights

**Resolved 2026-09-25, the day the repository went public.** Until then five
sets carried no usable rights record. Four were replaced and one now carries its
full credit:

| Set | Was | Now |
|---|---|---|
| `TNK_HULL`, `TNK_TURR` | rendered from a 2013 BlendSwap Tiger tank (`tiger_tank_rigged.blend`); **no credit recorded anywhere**, source never in git | **re-rendered** from `art/meshes/vehicles/mbt_lavi.glb` by `tools/render_vehicle_glb.py` |
| `JEEP_HULL` | rendered from `art/src/jeep_shoded.blend`, a model downloaded with no licence, readme or attribution; its manifest credit said as much; source never in git | **re-rendered** from `art/meshes/vehicles/jeep_shoded.glb` by `tools/render_vehicle_glb.py` |
| `NAMER_HULL`, `NAMER_TURR` | "VEHICLE IFV DMM08" by Mutte, CC BY 3.0 (BlendSwap #75225), credited on screen by author and id only | **kept**, with the full CC BY 3.0 credit on the credits screen (below) |

The two re-rendered sets come from the unit's **own shipped mesh**, whose
rights are recorded under "The supplied Meshy assets" below (AI-generated,
Meshy commercial plan, disclosed). Their GLB sources are committed, so unlike
the sheets they replace they can be re-rendered from a fresh clone. The sheet
FORMAT was reproduced exactly -- file names and layout (TNK_* are legacy
`f{NN}_000.png` with no clips and no wreck, JEEP_HULL is `idle_`/`wreck_`), 16
facings, 256 px cells, the median-vertex pivot, each sheet's `facingOffset`, and
`realMetres` (6.32, 4.8) -- so `main.ts`, the Pixi backend, `&nomesh`, the unit
icons and the tests needed no change. `scale` is re-derived by
`dimetric.unit_scale` (TNK 1.9643 -> 1.8421, JEEP 1.3977 -> 1.2749): the new
models fit tighter frames, and the vehicles still draw at their declared
length. The numbers were approved by the project lead before rendering. The
cropped unit icons `assets/ui/icons/units/TNK_HULL.png` and `JEEP_HULL.png`,
derived from the old frames, were rebuilt from the new ones.

The old TNK sheet turned out to be **one facing (22.5 deg) off** its own
`facingOffset`. Matched frame by frame by silhouette, old frame `f` lines up
with new frame `f+1`, while the jeep lines up at `f`. The hull's principal axis,
measured against each frame's projected heading, fits the old sheet best at
offset 4 (mean 10.0 deg, against 17.9 deg at the declared 5). The new sheet
follows the rig's measured convention instead (`dimetric.facing_offset`: +X
forward draws at offset 12), and it fits best at its declared 5. So a
`?renderer=pixi` or `&nomesh` Lavi is now drawn a facing closer to where it
drives. The jeep fits 0 both before and after.

Every sprite set now carries a `credit` in its manifest. The one attribution
the game owes is the Namer's, and `ui/credits.ts` carries it in the form CC BY
3.0 section 4 asks for: title, author, the licensor's URI for the work
(`http://www.blendswap.com/blends/view/75225`), the licence URI, and a line
saying the work was modified (rendered to sprites, recoloured to the palette).
`credits-data.test.ts` pins that credit against the licensor's own page,
`art/src/ifv_dmm08_LICENSE.html`.

### `art/src/soldier_kolos.fbx` -- removed 2026-09-25

A KolosStudios rigged soldier with no licence on record. The 2026-08-29 phase-D
audit also found that it **embeds a Synty POLYGON Military texture path**, which
makes it paid-pack material and not merely unknown. **It never shipped in the
game**: no sprite, mesh or build step read it (`tools/units/kit.py` only named
it as the dependency the code-authored kit had dropped, and every infantry
proportion is a constant in that file). It is gone from HEAD.

### History is kept

Every file replaced or removed above -- the old TNK_*/JEEP_HULL frames and
icons, `soldier_kolos.fbx`, and the render scripts that pointed at the
unrecorded sources (`render_tank.py`, `render_tiger.py`, `render_jeep.py`) --
**remains in git history from before 2026-09-25.** Rewriting history to purge
them was considered and declined: the project lead accepted keeping history
(25 Sep). This section records the fact. It is not an oversight.

## The supplied Meshy assets

Ten, all AI-generated with Meshy, all disclosed per `CONTRIBUTING.md`:

| File | Draws as | Source `.blend` |
|---|---|---|
| `art/meshes/meshy_soldier.glb` | `inf_squad` (KDF infantry) | `art/blend/soldier/` |
| `art/meshes/sarim_rifles.glb` | `sarim_rifles` (enemy infantry) | `art/blend/Sarim irregular/` |
| `art/meshes/vehicles/mbt_lavi.glb` | `mbt_lavi` | `art/blend/tank/` |
| `art/meshes/vehicles/technical.glb` | `technical` | `art/blend/truck/` |
| `art/meshes/vehicles/ifv_namer.glb` | `ifv_namer` | `art/blend/namer/` |
| `art/meshes/vehicles/jeep_shoded.glb` | `jeep_shoded` | `art/blend/Shodeed jeep/` |
| `art/meshes/vehicles/heli_peten.glb` | `heli_peten` | `art/blend/AH-64 attack helicopter/` |
| `art/meshes/buildings/house.glb` + `_wreck` | the `house` structure | `art/blend/enemy building 1/` |
| `art/meshes/vfx/muzzle_flash.glb` | `fire_apfsds` hot core | `art/blend/Muzzle flush/` |
| `art/meshes/vfx/explosion_burst.glb` | `structure_collapse` | `art/blend/explosion burst /` |

`art/blend/` is **gitignored** (4.8 GB as of 2026-09-01, not the 465 MB this
line recorded until then — it grew roughly tenfold as assets were supplied), so
none of their sources are in version
control. `ART_PIPELINE.md` §8 requires source alongside rendered output — "no
binary-only art" — for the practical reason that an asset without source cannot
be re-rendered when the rig or palette version bumps. Both
`tools/import_meshy_soldier.py` and the `export_meshy_*.py` scripts read those
sources, so a fresh clone can run none of them.

That rule is project policy rather than law, and a private repo can relax it
deliberately. It should be a decision, not an omission.

### Commercial rights

**Confirmed by the project lead on 2026-08-30: the Meshy plan used permits
commercial use.**

Recorded as his confirmation rather than as a verified fact — the terms live in
his Meshy account and nothing in this repository can check them. That is the
normal shape of a provenance record (the same way `data/audio.json` records a
`license` string it cannot independently prove), but it is worth one direct read
of the plan's own terms before a paid release, since "commercial use" and
"redistribution as part of a shipped binary" are occasionally separated.

With that settled, the four Meshy assets are clear to ship in a closed-source
commercial build, and the retirements below are unblocked.

---

## The seven ground props (Meshy text-to-3D, remeshed)

Ground plan 2, Task 3b (2026-09-27, lead: "Use all 7"), replacing Task 3's
code-authored kit (`fcde4da0`). Generated as Meshy **text-to-3D, preview
mode** (geometry only — no refine/texture pass was run or needed, since the
prop mesh contract strips materials at export anyway), disclosed per
`CONTRIBUTING.md`. Task 3c (2026-09-27, same day, lead: "Use these")
replaced every one of the seven previews with a Meshy **remesh** of the
same source, after Task 3b's own `export_meshy_props.py` run (commit
`93bafd30`) shipped collapsed, over-decimated geometry:

| File | Preview task id | Remesh task id (shipped) | Prompt |
|---|---|---|---|
| `art/meshes/props/jersey_barrier.glb` | `01a0e3ad-5d4d-77ad-a85b-1d26511355ef` | `01a0e41c-3760-77eb-bd64-aa4ca9ae775c` | "a single low-poly game-ready concrete jersey road barrier..." |
| `art/meshes/props/water_tank.glb` | `01a0e3ae-8a5d-773f-8487-63b99507ed54` | `01a0e41d-3485-7710-a11d-dfd7290a9482` | "a single low-poly game-ready cylindrical rooftop water storage tank on a short metal stand..." |
| `art/meshes/props/satellite_dish.glb` | `01a0e3b0-b3bb-745d-92fb-28012a542500` | `01a0e41e-06df-77ce-ba7e-454fffe588fd` | "a single low-poly game-ready small satellite dish antenna mounted on a thin pole..." |
| `art/meshes/props/laundry_line.glb` | `01a0e3b2-8328-70f0-86d1-6cc8c278367e` | `01a0e41f-1be9-7430-b412-d1ee116821e0` | "a single low-poly game-ready laundry line: two wooden poles holding up a horizontal clothesline with a few hanging cloth garments..." |
| `art/meshes/props/tyre_pile.glb` | `01a0e3b8-7ac9-7304-b72f-6f82e3e7d547` | `01a0e41f-ed58-76f8-978b-075a35e5470f` | "a single low-poly game-ready small stack of old car tyres piled on top of each other..." |
| `art/meshes/props/rebar.glb` | `01a0e3ba-f609-76f5-9ce6-6002a21054f9` | `01a0e420-bc80-718a-b1c0-dba2ca8d88a5` | "a single low-poly game-ready broken concrete stub with several bent rusty rebar rods sticking up out of it..." |
| `art/meshes/props/wrecked_car.glb` | `01a0e3bc-885e-708d-b7ec-a15893a71e66` | `01a0e421-75ac-703e-9055-e1a401c5f92e` | "a single low-poly game-ready burnt-out wrecked small sedan car..." |

Both generated 2026-09-27, both approved by the project lead the same day;
the remesh is what is shipped. Every remesh arrived as one mesh with zero
materials/images/textures in the GLB itself (a `texture_0_normal.png` sits
alongside `model.glb` from the remesh job but is not referenced by it —
verified before the export script was updated) and, unlike the previews,
six of the seven arrive already at or under the prop contract's own
per-kind triangle cap (101-353 tris against caps of 120-400); only
`water_tank` (226 vs 220) and `tyre_pile` (272 vs 260) needed trimming.
`tools/terrain/export_meshy_props.py` then, per prop: aligned the
horizontal footprint to +X where the shape has a real long axis, decimated
only where over cap (a single direct `DECIMATE`/`COLLAPSE` pass at
`ratio = cap / before`, not `export_meshy_decor.py`'s heavier merge-by-
distance escalation, which is built for raw scans two to three orders of
magnitude denser than these remesh sources), re-scaled to a judged
real-world size, and stripped to zero materials with one `rl_role` per prop
from the closed `PROP_ROLES` vocabulary. Full prompts are in
`art/meshy/ledger.jsonl`.

Full ledger entries and the fourteen downloaded `model.glb` sources (seven
previews, seven remeshes) live under `art/meshy/<name>-20260927-<task-id>/`,
**not committed** — same convention `export_meshy_decor.py`'s own `SRC_DIR`
and `export_meshy_camp.py`'s follow for every other Meshy source in this
tree (an untracked working directory; see "The supplied Meshy assets" above
for why sources generally are not kept in git here). The ledger and task
ids above are the provenance record.

---

## The A3.2 ramp set and the tunnel props (Meshy text-to-3D) -- GH-185, GH-227

Run 2026-09-30 on the lead's go (GH-185: "A3.2 ramp set approved for Meshy
now"), numbers table first (`docs/art/meshy-prompts-ramp.md`, commit
`004919c2`, before any spend). All eight generations are **AI-generated with
Meshy**, disclosed per `CONTRIBUTING.md`; every prompt is in the committed
`art/meshy/ledger.jsonl`, keyed by the ids below. **260 credits planned, 260
consumed** as Meshy reported them (`pnpm meshy -- spent`), against the
lead's cap of 295; every asset landed on its first preview, no re-roll.
`apc_kipod` and `apc_eitan` were not generated -- both already landed on
`art/b0a-meshy` (`67395cf0`, `123996c2`).

| File | Draws as | Preview task id | Refine task id (2k) | Remesh task id (shipped) | Size / tris |
|---|---|---|---|---|---|
| `art/meshes/buildings/concrete.glb` + `_wreck` | `concrete` | `01a0f2ec-7896-7074-8d8a-72b2f9aecb84` | `01a0f2ed-9020-7387-81b4-548a56793d07` | `01a0f2f0-8294-768e-abfa-826e41790eaa` (8,000) | 3.6 x 5.3 m plan, 9.0 m tall; 7,650 / 7,961 tris |
| `art/meshes/buildings/shanty.glb` + `_wreck` | `shanty` | `01a0f2ec-809b-73f7-9bff-ea4c54fbd962` | `01a0f2ee-b802-70bf-8ca3-b0429bda18ff` | `01a0f2f1-e83f-73bc-8a3e-63f57aa2cc7b` (8,000) | 5.2 x 5.5 m, 4.2 m tall; 7,415 / 8,881 tris |
| `art/meshes/buildings/wall.glb` + `_wreck` | `wall` (per tile) | `01a0f2ec-88ce-71c7-9760-eb48f7666e8e` | `01a0f2ed-a3ea-7635-b5ea-b74f7908558a` | `01a0f2f0-8aad-7226-853f-a303523907c1` (3,000) | 3.0 x 0.6 m, 1.4 m tall; 3,087 / 2,479 tris |
| `art/meshes/buildings/camp.glb` + `_wreck` | `camp` | `01a0f2ec-90f9-77bc-a6ff-b94c581afd55` | `01a0f2ee-02f1-7003-b5fb-a42b51d2a546` | `01a0f2f0-ed6c-70a5-8006-0dfdf43fbb3e` (10,000) | 7.5 x 7.5 m, 3.9 m tall; 9,543 / 8,628 tris |
| `art/meshes/vehicles/dozer_d9.glb` | `dozer_d9` | `01a0f2f5-f6d6-736c-99cd-18b3ce9c8941` | `01a0f2f7-5b78-7680-8858-58c0c6811915` | `01a0f2fc-483b-7240-aaf6-83a2e652230b` (8,000) | 6.832 m (`D9_HULL` manifest) x 4.39 x 3.62 m; 7,901 tris |
| `art/meshes/vehicles/scout_shachaf.glb` | `scout_shachaf` | `01a0f2f5-fe36-7782-a377-67246cc7f8c5` | `01a0f2f7-193a-7547-9a83-e916293d9e51` | `01a0f2fc-508c-716d-b370-820ecd3229e6` (5,000) | 4.6 m (`SHACHAF_HULL` manifest) x 2.54 x 3.06 m; 5,076 tris incl. the kit RWS |
| `art/meshes/props/tunnel_mouth.glb` (+ `_collapsed`) | tunnel mouth (GH-227) | `01a0f30a-7298-75be-a4ae-64a250efc379` | -- (palette) | `01a0f314-6b95-741e-8848-5d5097c6e607` (400) | 2.4 x 1.47 x 1.46 m; 402 tris |
| `art/meshes/props/tunnel_vent.glb` (+ `_collapsed`) | tunnel vent (GH-227) | `01a0f30a-80b8-7402-aa3b-0ffa9b1dbd86` | -- (palette) | `01a0f314-73ed-70e4-9112-dd9692dc493b` (200) | 0.82 x 0.64 x 0.80 m; 207 tris |
| `art/meshes/props/spoil_heap.glb` | spoil heap (GH-227) | -- (built from primitives in Blender) | -- | -- | 1.6 x 1.6 x 0.5 m; 108 tris |

What Blender did to each (`tools/buildings/export_meshy_ramp.py`,
`tools/vehicles/export_meshy_ramp.py`, `tools/terrain/export_meshy_tunnel.py`):

- **The four buildings** ship their own 2k bake (`TEXTURED_BUILDING_TYPES` /
  `TEXTURED_BUILDING_EXEMPT`, pinned). Each remesh was turned so the openings
  face the camera half (the yaw chosen by dark-face area on Blender `+X`/`-Y`,
  printed for all four candidates), scaled on ONE declared axis, grounded and
  centred, and split into `wall` / `roof` / `glass` -- the openings on the
  camera half, so `building_facing.py` can judge the front: `concrete` reads
  directional 171 / 11 px (15.6x), `shanty` 840 / 0; `wall` and `camp` model
  no glass and are named unchecked, like `warehouse`. The **wreck** of each is
  `render_building.collapse()` on the textured mesh (the kit's own seed-free
  dice / punch / crush / spill), so the rubble carries the photograph -- no
  second generation. Three things the previews did not deliver as asked and
  Blender settled: the wall came back **1.5 m thick** and is thinned in Y
  alone to 0.6 m (every course on its long faces untouched); the shanty came
  back **6.9 m tall** at its 9 m plan and is scaled by HEIGHT to 4.2 m
  (5.2 x 5.5 m plan inside its 3-tile block) rather than by plan; the camp
  is cut to **7.5 m** across, the 2x2 every one of the six missions places it
  at plus a quarter-tile apron, where the shipped GLB it replaces was 15 m
  (`export_meshy_camp.py` assumed 5x5). The remesh dropped the camp's thin
  mast tip; the concrete's tank and the shanty's tank and crates survived.
- **`dozer_d9`** -- blade at the `-x` end of the remesh (vertical plate area
  1.02 against 0.59), turned to `+X`; tracks split as `hull_rubber` by the low
  outboard band (|y| > 0.36, z under 0.375 above the belly line, x within
  the track span -- the blade and push arms lie beyond it); scaled to the
  sprite manifest's 6.832 m. **The refine put a white five-point star on
  each hull flank** although the prompt asked for no markings; the exporter's
  `scrub_white` paints every near-white texel over from its olive
  neighbours (17,052 texels, 0.4 % of the bake, dilated 6 texels so the
  anti-aliased rim goes too) and flattens the same footprint in the normal
  and metallic-roughness bakes, which carried the star's relief -- a
  one-texel fill left a ghost star on the hull, measured before the
  dilation was added. No pivot, no weapon; `wreck-recipes.ts` keeps `tracked`.
- **`scout_shachaf`** -- nose measured at `-x` (roof profile low there, the
  raised cab at `+x`), turned to `+X`; two axles found from the contact
  patches at turned x +0.565 / -0.589; tyres `hull_rubber` (radius 0.255);
  scaled to 4.6 m. The remesh KEPT the sensor mast, rising from the centre of
  the roof ring; `turret_pivot` sits on that ring at (-0.99, 0.00, 2.21) m
  carrying `kit.rws` at (0.55, 0.45, 0.30) m with a 0.7 m barrel (the
  `cupola_mg`), the mast through it; `wreck-recipes.ts` gains `turretPivot`.
  Its bake came back a **saturated grass green** beside the D9's olive;
  `olive_shift` pulls the green band (56 % of the texels) toward olive in HSV
  (hue -22 deg, saturation x0.62, value x0.80). Both vehicles ship their bake
  (`TEXTURED_VEHICLE_TYPES` / `TEXTURED_VEHICLE_EXEMPT`, pinned); the
  Shachaf's RWS parts carry no material (`plate` added to its palette on
  both sides). `tools/vehicles/kit.py`'s `rws` barrel fix is B0a's hunk,
  applied verbatim so the two branches merge clean.
- **The tunnel pieces** are palette props under the prop contract, new kinds
  in `PROP_KINDS` / `PROP_TRI_CAPS` (both sides, pinned) and `PROP_MESHES`.
  The mouth came back as a timber-framed adit in a rock face rather than a
  sandbagged shaft head; it opens toward `+X` (the recessed back wall's
  faces point there) and is scaled to 2.4 m across, one role `rust`. The
  vent is scaled to 0.8 m tall and split by height into `metal` (pipe) over
  `rust` (earth ring). The two `_collapsed` twins are the same meshes
  slumped in Blender (height x0.45, hash-jittered slump); the spoil heap is
  a hash-jittered hemisphere from nothing. **Nothing in the renderer read a
  tunnel mesh before this**: `packages/render/src/three/tunnel-props.ts`
  stands them on the route's own points (`tunnelPointAt`, `tunnelVent`,
  `tnProgress`) under the trail's identification rule
  (`collapsedRouteLevel`), and `tunnel-props.test.ts` pins that rule --
  an unidentified route shows at most the spoil heap where anyone can see
  the dig head; the mouth and vent draw only at level 2; the collapsed twins
  only for a route that was identified when it died.

**Gates** (2026-09-30): `pnpm validate:meshes` passes -- 53 mesh units against
38 sprite units, 12 prop meshes contract-checked; `pnpm validate:assets`,
`pnpm test` (7,504), `pnpm typecheck`, `pnpm lint` all green. The mesh gate
prints no per-pair IoU on a pass; the nearest pairs were not measured
separately here.

**Sources.** `art/meshy/ledger.jsonl`, each task's `task.json`, the eight
shipped remesh `model.glb` files (six textured, 9-11 MB each; the two tunnel
remeshes under 40 KB) are committed with this set, as B0a's were; the
previews and refine folders (10-23 MB and 200+ MB per asset) stay untracked;
their task ids above are the record.

---

## The decor trees (Meshy re-exports, `tools/terrain/export_meshy_decor.py`)

`art/meshes/decor/tree_{0,1,2}.glb` and `desert_tree_{0,1,2}.glb`, disclosed
per `CONTRIBUTING.md`. Both are re-exports of an **EARLIER** Meshy source than
the seven props above — generated before `art/meshy/ledger.jsonl` existed, so
neither carries a Meshy task id; this table records what the ledger and git
history do carry rather than inventing one.

| File | Draws as | Source | Notes |
|---|---|---|---|
| `art/meshes/decor/tree_0.glb` | olive grove (green-terrain maps) | `art/blend/terrain object/olive tree/` (source 1, `image-to-3d-texture` mode) | Decimated by triangle count (D8, `TREE_TARGET_TRIS` = 3000, was `TREE_TARGET_VERTS` = 3500); trunk/foliage split on raw Z height (`TREE_TRUNK_Z`), split BEFORE decimation so no vertex can cross the seam. Task id not recorded. |
| `art/meshes/decor/tree_1.glb` | olive grove | `art/blend/terrain object/olive tree/` (source 2, `0831112418`) | Same pipeline as `tree_0`. Task id not recorded. |
| `art/meshes/decor/tree_2.glb` | olive grove | `art/blend/terrain object/olive tree/` (source 2, same as `tree_1`) | A second export of `tree_1`'s own source — `TREE_SRC[1] is TREE_SRC[2]` literally, deterministic pipeline — so `tree_1.glb` and `tree_2.glb` are byte-identical (md5 `c9b22c2165d69da590c42f9cdab0e708`, both 826,504 bytes, verified 2026-09-07). Recorded rather than fixed: closing the gap is an olive-art judgement, out of scope here. Task id not recorded. |
| `art/meshes/decor/desert_tree_0.glb` | desert-terrain maps (non-`green`) | `art/blend/terrain object/` `Meshy_AI_shrub_desert_var1_..._spl_..._part-segmentation.blend` | Trunk half of the bush source that also supplies `bush_0` (hue-classified, `HUE_TRUNK_MAX` = 30deg), calibrated to `DESERT_TREE_TARGET_HEIGHT` (2.90). Foliage is a procedural **crown** (R-10), not Meshy geometry — generated in Blender from a hand-rolled hash, never `mathutils.noise` (nondeterministic per process in Blender 5.2), so two exports of the same crown are byte-identical. Task id not recorded. |
| `art/meshes/decor/desert_tree_1.glb` | desert-terrain maps | `art/blend/terrain object/` `Meshy_AI_shrub_desert_var3_..._spl_..._part-segmentation.blend` | Trunk half of the same `var3` source as `desert_tree_2` (`DESERT_TREE_SRC[1] is DESERT_TREE_SRC[2]`), same hue classification as `bush_2` (8 trunk objects vs `var1`'s 1); differs from `desert_tree_2` only by crown (8 clumps, 1.15-1.5 m band vs 5 clumps, 1.0-1.3 m). Task id not recorded. |
| `art/meshes/decor/desert_tree_2.glb` | desert-terrain maps | `art/blend/terrain object/` `Meshy_AI_shrub_desert_var3_..._spl_..._part-segmentation.blend` | Same source `.blend` as `desert_tree_1` (`var3`, untouched); not a byte-identical repeat because the crown's clump count/footprint band differs per variant. Task id not recorded. |

`var2` of the same bush source family is excluded from `desert_tree` on
purpose — it is a low, spreading ground shrub rather than a tree silhouette,
and stays distinct as `bush_1` instead (script docstring "DESERT TREE").
`art/blend/` is gitignored, as for every other Meshy source in this tree; see
"The supplied Meshy assets" above.

---

## Unit voices (ElevenLabs, supplied by the lead, 2026-09-29)

Five Hebrew voice lines in `assets/audio/voice/he/`, wired to `data/audio.json`
`voices.lines` (WP-AU1, engine in #253). Lead decision 29 Sep 2026: *"Add them
now."*

**The ElevenLabs commercial licence is NOT confirmed.** Decision D5 was
deferred by the lead on 29 Sep 2026 and he will settle it later. CLAUDE.md
requires explicit redistribution rights for audio "exactly as it does to art";
these files were added **knowingly without that confirmation**. Until D5 is
settled they must not ship in a commercial build, and if the plan turns out to
forbid commercial use or redistribution they are to be deleted (the manifest
entries are one block per key, and an empty `variants` list plays nothing).
The manifest records `source` as "commercial licence NOT yet confirmed" on every
variant so the fact travels with the data. AI-generated speech: disclosed in the
PR per CONTRIBUTING.md. The generating plan and date are not recorded.

| File (`assets/audio/voice/`) | Slot | Source | Generated by | Commercial licence |
|---|---|---|---|---|
| `he/infantry/move_01a` | `he.infantry.move` | ElevenLabs, from `on my way kdf infentry.mp3` | the lead | NOT yet confirmed (D5 deferred 29 Sep) |
| `he/infantry/attack_01a` | `he.infantry.attack` | ElevenLabs, from `attack.mp3` | the lead | NOT yet confirmed (D5 deferred 29 Sep) |
| `he/common/ack_01a` | `he.common.ack` | ElevenLabs, from `od ktana etlecha.mp3` | the lead | NOT yet confirmed (D5 deferred 29 Sep) |
| `he/infantry/death_01a` | `he.infantry.death` | ElevenLabs, from `inshouts2. .mp3` | the lead | NOT yet confirmed (D5 deferred 29 Sep) |
| `he/infantry/death_02a` | `he.infantry.death` | ElevenLabs, from `inshouts3 .mp3` | the lead | NOT yet confirmed (D5 deferred 29 Sep) |

Each is an `.ogg` plus an `.m4a` `alt`, made by `tools/voice_prep.py`: trimmed,
mono 44.1 kHz, -18 LUFS, true peak under -3 dBFS. Sources are git-ignored
(`.superpowers/voice-src/`).

**Excluded under D2 (military calls only):** `alláhuwakbar! .mp3`, a religious
exclamation, is not committed anywhere. **Also left out:** `אוחתי מועלימה .mp3`,
Arabic (*ukhti mu'allima*, "my sister is a teacher") in Hebrew letters, a
phrasebook sentence and not a military call.

The `text`, `translit` and `en` fields for four of the five are placeholders
taken from the filenames: nobody has transcribed the audio. The mapping of the
`inshouts` pair, `attack` and `od ktana` is inferred from filenames and needs
the lead's ear.

---

## What closing the source changes

- **Code (MIT until 2026-09-18, then PolyForm Noncommercial 1.0.0 with `CLA.md`; effectively sole-authored)** — 747 of ~753 commits are the
  project lead's, the rest a bot. No contributor's permission is needed. MIT is
  an offer made to others; copyright is retained. Closing it is straightforward.
- **Art currently declared CC BY-SA 4.0** (`ART_PIPELINE.md` §8) — the repo has
  been **public since 2026-08-04**, and Creative Commons licences are
  irrevocable for copies already obtained. Going forward the declaration can
  change; what has already been distributed under it stays licensed. At a few
  weeks on an unreleased project the practical exposure is minimal, but the
  declaration should be changed **before** the repo goes private, not after.
- **Steam** requires disclosure of AI-generated content at submission, plus
  confirmation of rights to everything shipped. Four assets are AI-generated, so
  that is a form field to complete rather than a judgement call — which is
  itself a reason to have this written down rather than reconstructed later.

---

## The gap, and the fix

Audio has a CI gate that rejects an unlicensed clip. Sprites have a convention
with no gate. Meshes have neither.

That asymmetry is why `JEEP_HULL` shipped for weeks with a credit string that
declared its own licence unknown, and nothing objected (resolved 2026-09-25, above), and why 33 meshes have no origin recorded at
all. A human noticed; no check did.

**Recommended:** give `art/meshes/**` the same `credit` record sprites already
carry, written by the export script the way `render_*.py` writes a sprite
manifest, and extend `tools/validate_mesh_assets.py` to reject a mesh without
one — matching what `validate_audio.py` already does for clips. Provenance that
depends on someone remembering is provenance that eventually fails.

---

## Outstanding, in order

1. **Record credits for the 33 meshes and gate on them** (above). Now that the
   Meshy terms are settled, every mesh has an answer to record — which is the
   cheapest moment to start requiring one.
2. ~~**Retire the three superseded sprite sets**~~ -- **resolved 2026-09-25**,
   by a different route than the one this item proposed. Retiring the sets would
   have blanked `mbt_lavi`, `ifv_namer` and `jeep_shoded` on `?renderer=pixi` and
   `&nomesh`, so the tank and jeep sets were instead **re-rendered from their own
   Meshy GLBs** in the same format, and the Namer set was kept with its full CC BY
   credit on screen (see "Sprites" above). The Namer is therefore still the
   project's one permanent attribution obligation; `render_namer.py` and
   `art/src/ifv_dmm08_LICENSE.html` stay. The legacy manifests that
   `export_meshy_tank.py` / `export_meshy_jeep.py` read `realMetres` from still
   exist and still declare 6.32 and 4.8.
3. ~~**Change the art licence declaration**~~ — **done 2026-08-30**, in
   `ART_PIPELINE.md` §8, ahead of merging this work to `main`. Art and data are
   now all rights reserved. Everything published under CC BY-SA 4.0 between
   2026-08-04 and that date remains licensed under it to whoever took a copy;
   the change stops adding to that set and cannot undo it.
4. **Decide the `art/blend/` question deliberately** ([#137](https://github.com/ilan-pinto/roaring-lions/issues/137),
   queued behind the T1 terrain milestone) — measured **2026-09-01: 5.16 GB**
   in the main checkout (both prior figures were wrong: 4.8 GB is stale, and
   the issue's own ~5.4 GB estimate ran high — re-measure before quoting
   either again; `art/blend/` is gitignored, per-checkout, and does not exist
   in a fresh worktree, so the number moves independently of `main`'s own
   history). Git LFS, a decimated in-repo source, or a documented exception.
   Currently it is an omission rather than a decision.

   **The "texture is discarded by construction" hypothesis was tested, not
   assumed — and it splits cleanly by asset class, not uniformly.** It holds
   for vehicles, buildings, terrain and effects (3.46 GB of the 5.16 GB):
   grepping every `export_meshy_*`/`import_meshy_*` script for a base-color
   pixel read finds none in that group — classification there is pure
   geometry (Z/X/Y histograms). Proven concretely on one representative
   vehicle, `ifv_namer` (992,444-vert single mesh, 189 MB source): a
   materials-stripped copy (geometry untouched, 94 MB, 50% retained) ran
   through the real `export_meshy_namer.py` unmodified and produced a GLB
   with the shipped one's exact bounding box and vertex counts within 0.3%.
   Pre-*decimating* the source on top of that is a different question and
   the answer is no — the exporter applies its own fixed 0.02-ratio decimate
   to whatever mesh it's handed, so a pre-decimated input compounds and
   undershoots the calibrated target by roughly half (measured: 10,369 hull
   polys vs. the real 19,179). The geometric cuts still land correctly
   (they're absolute coordinates, not vertex-relative), but the shipped
   resolution changes — so **materials-only stripping, not decimation, is
   the safe operation for this class.**

   The hypothesis does **not** hold for the rigged-figure class
   (`KDF/sniper`, `KDF/mortor team`, `KDF/soldier`, `KDF/Yaalom`,
   `enemy/Sarim irregular` — 1.70 GB): four of those five import scripts
   read a base-color pixel array to classify vertices into roles
   (`webbing`/`boot`/`uniform`/…) *before* clearing materials, not after.
   Proven concretely, not inferred: stripping the texture from the
   representative rigged biped's base clip (`Sarim irregular`) and running
   the real `import_meshy_soldier_irregular.py` against it crashed —
   `IndexError: … materials[0] … index 0 out of range, size 0` inside
   `classify_vertex_roles`. Two sub-patterns live inside this class and
   extrapolate very differently: `soldier`/`Yaalom`/`Sarim irregular` each
   ship one texture-load-bearing base clip plus several animation-only clips
   whose own mesh is discarded either way (only the action curve survives
   `import_clip`) — stripping those is provably free (a partial-strip run
   reproduced the shipped `sarim_rifles.glb`'s vertex count exactly, 58,725
   both times) — and each of those three families also carries a redundant
   delivery `.zip`, byte-for-byte duplicating a folder already unzipped
   beside it (462 MB total, a zero-risk deletion available today,
   independent of this whole question). `sniper` and `mortor team`, though,
   are each two independently-classified static poses with no disposable
   clip at all — every byte of their texture is load-bearing.

   **Extrapolated best case sits around 2.6 GB, not "ordinary git."**
   Applying the Namer ratio to the rest of the geometry-only class
   (3.46 GB → ~1.7 GB) and the measured per-family ratios to the figure
   class (1.70 GB → ~0.9 GB, almost all of the saving from
   `soldier`/`Yaalom`/`Sarim irregular` collapsing roughly 6:1 while
   `sniper`/`mortor team` stay full-size) totals **~2.6 GB retained** —
   about half of 5.16 GB, not the order-of-magnitude cut "texture is pure
   waste" implied. 2.6 GB of binary sources that get replaced wholesale on
   every re-export (nothing here deltas) is still well past what plain git
   carries gracefully. **This measurement rules out "strip and commit
   plainly" as a full fix on its own; it does not resolve the choice between
   Git LFS, a class-aware partial in-repo source, and a documented
   exception** — that remains the project lead's call. Full method, per-file
   numbers, and the Blender scripts used are in
   `.superpowers/queue/blend-size-report.md`.
