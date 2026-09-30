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

## Batch B0a units (Meshy text-to-3D, remeshed) -- GH-286

Style bible batch B0a (`docs/art/style-bible.md` section 6), run 2026-09-30 on
the lead's go (PR #290 rulings). All three are **AI-generated with Meshy**,
disclosed per `CONTRIBUTING.md`. Each prompt is the section 5 template filled
exactly as written in `docs/art/meshy-prompts-units.md` and sent verbatim; the
prompt text of every task is in the committed `art/meshy/ledger.jsonl`, keyed
by the ids below. 85 credits planned, 85 consumed as reported by Meshy
(`pnpm meshy -- spent`) for the three as planned; the lead's two same-day rulings
(the recon re-roll, 25, and the Kipod, 35) took the run to **145 spent, 145
consumed**. The remesh is what ships; each preview's only role was to be judged
and remeshed.

| File | Draws as | Preview task id | Refine task id | Remesh task id (shipped) | Real / drawn size |
|---|---|---|---|---|---|
| `art/meshes/vehicles/recon_drone.glb` | `recon_drone` (KDF recon quadcopter, **v2 -- the accepted re-roll**) | `01a0f292-52ff-715e-b359-57a5af7c3347` | -- (palette-painted) | `01a0f2aa-d9cc-7210-8289-3256750c1dec` (800 target, 785 + 96 guard-ring tris = 881 shipped) | 0.9 m across; **drawn 1.35 m**, `SIZE_CLASS["air"]` x1.5 baked into the GLB (lead, PR #290) |
| *(retired 2026-09-30, same day)* `recon_drone` v1 | -- | `01a0f268-0a89-7526-8e24-baaf0187f64b` | -- | `01a0f26b-176a-75a8-a73c-2b5cffb3a701` (797) | the first, consumer-style quadcopter; superseded by v2 above |
| `art/meshes/vehicles/apc_kipod.glb` | `apc_kipod` (KDF 6x6 screen carrier), replacing the kit hull -- the lead's follow-up after seeing the Eitan beside it | `01a0f2ac-f465-7172-aef7-0fcdb64f3f7a` | `01a0f2ae-970b-779d-9b4d-e55d2802ad95` (2k) | `01a0f2b4-c107-72f6-9e22-87fd1836afcf` (8,000 target, 8,052 shipped incl. the kit RWS) | 7.2 m long (`KIPOD_HULL` manifest), x1.0 |
| `art/meshes/vehicles/attack_drone.glb` | `attack_drone` (KDF loitering munition) | `01a0f26b-85b1-77c6-8b52-db4616992ff2` | -- (palette-painted) | `01a0f26d-a93b-758f-87a0-631462cd6617` (800 target, 706 shipped after the wing cut) | 1.05 m long; **drawn 1.575 m**, same x1.5 |
| `art/meshes/vehicles/apc_eitan.glb` | `apc_eitan` (KDF 8x8 APC), replacing the kit hull | `01a0f26e-3308-73bd-96b5-3cc85edcadfd` | `01a0f26f-63b4-77e3-88b8-cfc19c47b0d5` (2k) | `01a0f272-a1ff-72dd-b418-2d1f4c099595` (8,000 target, 7,961 shipped incl. the kit RWS) | 7.129 m long (`EITAN_HULL` manifest), x1.0 |

What Blender did to each, so the shipped file can be read against its source
(`tools/drones/export_meshy_drones.py`, `tools/vehicles/export_meshy_eitan.py`):

- **`recon_drone`** -- welded the remesh's UV-seam vertices (1,727 -> 424), turned
  the nose from -Y to +X, split by face-centroid geometry into `hull_hull`
  (body, arms, legs), `hull_metal` (rotors, motor tops, prop guards) and
  `hull_glass` (the camera ball). Zero materials. Nearest silhouettes at 64 px:
  `technical` mesh 0.384, `DRONE_LOITER` sprite 0.325, `attack_drone` 0.273.
  **The lead judged this v1 preview short on combat look and approved one
  re-roll (a military hexacopter, +25).** That preview came back as a
  four-arm quadcopter with no rotor guards (angular body, mast, gimballed
  ball, side rails and legs all present); the work stopped, and the lead
  then **accepted it as the quadcopter**: remeshed (5), fitted with the same
  numbers (x1.5, Rz as measured -- the preview's mast at y +0.36 and ball at
  y -0.19 put the nose at -Y), and given the guards Meshy left out as four
  flat 12-segment `metal` rings just outside the blade tips
  (`_recon_guards`, 24 tris each, keeping the file at 881 under the
  1,000 cap). The remesh dropped the mast, as it drops every whip. v2
  ships; v1's ids above are retired. v2 IoU: `attack_drone` 0.267,
  `DRONE_LOITER` sprite 0.331, `DRONE_ATTACK` sprite 0.201; nearest anything
  `yahalom_engineer` 0.308.
- **`apc_kipod`** -- same process as the Eitan, through the shared
  `tools/vehicles/export_meshy_apc.py` (the Eitan re-exported through it
  byte-identically when the code moved). Prompt and numbers table:
  `docs/art/meshy-prompts-units.md` section 6. The preview delivered six
  wheels on three evenly spaced axles, a tall boxy full-length compartment
  and a large empty roof ring (1.25 m across -- "small" did not land); its
  front-roof gun and whip antenna were dropped by the remesh itself, but two
  thin flank-mounted barrels survive in the bake on the left side and are
  left as they are (thin, hull-side, not a roof weapon). Blender: nose -X ->
  +X, scaled to `KIPOD_HULL`'s 7.2 m, tyres split as `hull_rubber` (axles at
  source x -0.614 / -0.027 / +0.506, radius 0.215), `turret_pivot` on the
  ring at (-1.24, 0.00, 3.45) m with `kit.rws` at `author_apc_kipod.py`'s
  own mount size. Footprint 7.2 x 3.72 m, 3.87 m tall with RWS. Nearest
  silhouettes: **`apc_eitan` 0.819** (the pair the lead asked about),
  `ifv_namer` 0.782, `rocket_battery` 0.725, `dozer_d9` 0.724.
- **`attack_drone`** -- the preview delivered the prompt's cylinder, nose pod and
  cross tail AND an unasked-for swept delta wing (the Sarim `loiter_drone`'s
  plan). Per the bible ("a wrong preview is fixed in Blender") the 35 wing
  faces were cut on the 734-tri remesh and the fuselage slit closed; nose
  turned from -X to +X; `hull_hull` (fuselage), `hull_metal` (nose pod, cross
  tail, propeller, skids), `hull_glass` (nose lens). Zero materials. Nearest
  silhouettes: `technical` mesh 0.437, `DRONE_RECON` sprite 0.343,
  `DRONE_LOITER` sprite 0.266.
- **`apc_eitan`** -- the first textured vehicle from the CLI pipeline, and the
  measurement the bible's section 4 was waiting on: **a remesh of a refined task
  keeps its texture** (the remesh arrived with one `BakedMaterial`, base colour
  2048 / normal 2048 / metallic-roughness 4096, re-baked onto fresh UVs), so no
  `retexture` fallback was needed. Blender collapsed a small cannon the preview
  put on the front deck (the prompt asked for no weapon), scaled to the sprite
  manifest's 7.129 m, turned the nose from -X to +X, split the eight tyres out
  as `hull_rubber` by axle-disc geometry, and placed `turret_pivot` on the
  measured roof ring at (-0.63, +0.40, 2.84) m carrying `tools/vehicles/kit.py`'s
  `rws` (whose barrel now runs along +x as its docstring says; it was built
  with `wheel()` and pointed sideways). Textures ship at 2048 through
  `textured.prepare_vehicle_textures`; the two RWS meshes carry no material.
  Nearest silhouettes: `ifv_namer` mesh 0.837, `apc_kipod` mesh 0.786,
  `rocket_battery` 0.764, `KIPOD_HULL` sprite 0.717. The bake carries a small
  stencil-like squiggle on the rear flank that reads as lettering at close
  zoom; it names nothing and is not a real marking, but it is there.

**Sources.** `art/meshy/ledger.jsonl`, each task's `task.json` and the three
shipped remesh `model.glb` files are committed with this batch (the 60 KB
drones and the 10.4 MB textured Eitan remesh). The previews (7-14 MB each) and
the Eitan refine directory (207 MB across five formats) stay untracked, like
every other Meshy download in this tree; their task ids above are the record.

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

---

## WP-A3.1 batch B2 — the first units generated through `pnpm meshy` (GH-179)

Four units, 2026-09-30, all Meshy **text-to-3D** through the CLI (`pnpm meshy`),
AI-generated and disclosed per `CONTRIBUTING.md`; every spend is a line in
`art/meshy/ledger.jsonl` (110 credits consumed against the 140 the lead
approved). Prompts, numbers tables and the per-unit decisions are in
`docs/art/meshy-prompts-units.md` §6–9. The downloaded `model.glb` sources sit
under `art/meshy/<slug>-20260930-<task>/` and are **not committed** (the gun
truck's refine folder alone is 359 MB across six formats); the ledger, each
folder's `task.json` and thumbnail are. The task ids below are the provenance.

| File | Draws as | Preview task id | Refine / remesh task id (shipped) | Notes |
|---|---|---|---|---|
| `art/meshes/vehicles/gun_truck.glb` | `gun_truck` (AA Gun Truck, enemy) | `01a0f2a6-bc37-7461-9b4f-4919d0ff1606` | refine `01a0f2a8-35a9-701b-b1a0-ccdeca412e1b` (2k), remesh `01a0f2ac-4384-735a-b5e1-0350426f017c` at 5,000 | **Textured** (`TEXTURED_VEHICLE_TYPES`): ships the remesh's own 2048 base-colour, normal and metallic-roughness bake. Measured here: a remesh of a refined task keeps its bake. 4,857 tris; 5.4 m long × 2.82 m wide × 2.79 m tall (barrels raised 20° in Blender to the bible's ~28°, the preview came back at 7.6°); `turret_pivot` at the pedestal foot; hull/turret cut by geometry, glass by the bake's luminance. `tools/vehicles/export_meshy_gun_truck.py`, then `pnpm wreck:meshes`. |
| `art/meshes/vehicles/loiter_drone.glb` | `loiter_drone` (Loitering Munition, Sarim) | `01a0f2ac-f4ba-76b2-b111-f2e797ce49d4` | remesh `01a0f2af-af1e-7008-8287-3bd290e63791` at 800 | Palette-painted, zero materials. Real span **1.62 m**, shipped at ×1.5 = 2.43 m (bible §7 q10; the mesh path has no `SIZE_CLASS` air multiplier). 630 tris after cutting the preview's uninvited tricycle landing gear; the preview's nose prop and single tail fin were kept. `tools/vehicles/export_meshy_loiter_drone.py`. |
| `art/meshes/manpad_team.glb` | `manpad_team` (MANPAD Team, Sarim) | `01a0f2ac-f4e5-7632-8b48-d8813d50890c` (`--pose a-pose`) | remesh `01a0f2af-b00a-715f-9b29-424e409d471a` at 1,500 | Palette-painted (PR #307's `TEXTURED_INFANTRY_TYPES` was open; no refine bought). ONE figure, 1.74 m, used for both men: cut into `rig.py` parts and driven by `rig.py`'s own clips (`idle`, `move`, `fire`, `down`, `wreck`) — `tools/units/import_meshy_crew_team.py`. The preview ignored the head wrap, so the man wears `kit.keffiyeh`. Tube and binoculars are kit geometry. 7,368 tris (kneel + walker + corpse per kneeling figure). |
| `art/meshes/recoilless_team.glb` | `recoilless_team` (Recoilless Team, Sarim) | `01a0f2ac-f5b1-7146-b3e3-73be95e86ff2` (`--pose a-pose`) | remesh `01a0f2af-b122-75c8-bbe1-9c9da39e1aa2` at 1,500 | As `manpad_team`: one hooded figure, 1.72 m, both crew kneeling, tube and rounds kit geometry. 8,936 tris. |

No Meshy rig was bought for either team: the CLI has no `rig` command and a
headless session cannot drive the web UI, so the figures are rigid-bound to
`rig.py`'s bone tables exactly as `kit.py` figures are (no hand-posing, no
weight painting; `kit.blob` joints hide the cut seams).

## The GH-277 field works (Meshy text-to-3D, remeshed; two textured), 2026-09-30

Eight buildings for the field-works design (`docs/superpowers/specs/2026-09-29-
field-works-design.md` §8), generated 2026-09-30 through `pnpm meshy` against
the lead's approved 210-credit plan and landing at **170 credits consumed**
(`pnpm meshy -- spent`: 14 tasks, 170 estimated, 170 consumed as reported by
Meshy, ~$3.40): the four KDF works skipped the refine step because Q11 paints
them from the palette, so 25 each rather than 35; the two textured militia
works cost the planned 35. No re-roll was spent. AI-generated, disclosed per
`CONTRIBUTING.md`; the exporter is `tools/buildings/export_fw_works.py`, the
prompts and numbers table are in `docs/art/meshy-prompts-buildings.md`
("Field works"). **The meshes are held, not wired**: `mesh-catalogue.ts`'s
`HELD_MESH_FILES` names each with the structure type that will claim it in
Stage 5; `data/structures.json` is unchanged.

| File(s) (`art/meshes/buildings/`) | Preview task id | Refine (2k) | Remesh task id (shipped source) | tris shipped |
|---|---|---|---|---|
| `kdf_medic_station` + `_construction` + `_wreck` | `01a0f2a6-d11f-7400-aaa0-8332e0d33f6f` | — | `01a0f2aa-c38d-76b2-92c7-f2ae8f63fe20` (3,000) | 3,107 / 3,039 / 5,291 |
| `kdf_outpost` + `_construction` + `_wreck` | `01a0f2a6-e8f5-712f-a695-bfee06ba9da2` | — | `01a0f2ac-4b22-7178-91f4-1fb9f3dd434b` (4,000) | 3,967 / 4,171 / 3,884 |
| `kdf_intel_centre` + `_construction` + `_wreck` | `01a0f2a7-0059-75c2-94ff-16a2387ffa05` | — | `01a0f2aa-d7bb-751a-99fa-12b022e98529` (4,000) | 3,388 / 3,103 / 3,496 |
| `kdf_workshop` + `_construction` + `_wreck` | `01a0f2a7-1873-7421-be8f-8f9612b2515c` | — | `01a0f2aa-eb15-77de-af5c-dfbfa615acd3` (4,000) | 3,425 / 2,185 / 3,587 |
| `militia_observation_post` + `_wreck` | `01a0f2a7-305e-75ba-a3fe-43f8db8dc055` | `01a0f2a8-518e-702d-a6f5-037dbdb18aa6` | `01a0f2ac-5d56-70ea-987f-e88c72ad6fa5` (6,000) | 5,508 / 5,568 |
| `militia_weapons_workshop` + `_wreck` | `01a0f2a7-4873-74cd-b0a8-743234a46f47` | `01a0f2a9-b6b8-74e8-82af-9bdac1ebd1e9` | `01a0f2ae-51f1-70d4-96be-bcb810eb9337` (8,000) | 7,538 / 12,939 |
| `militia_field_clinic` + `_wreck` | — kit-bashed, 0 credits: a 6 x 3.4 m crop of the shipped `clinic.glb` (itself Meshy, see above) plus `kit.py` sandbags, a canvas annex and a tank | | | 5,784 / 4,599 |
| `militia_firing_position` + `_wreck` | — kit-bashed, 0 credits: the shipped palette `shanty.glb` shed at 0.62 plus `kit.py` sandbag parapets and a corner stack | | | 2,512 / 3,312 |

Every remesh arrived as one unroled `output_unwrapped` mesh; the exporter
orients, fits, grounds, splits it into `rl_role` meshes by height band and adds
the kit pieces (see the script's docstring). **The remesh of a refined task keeps
its bake** -- measured here for the first time on this pipeline (the OP and
weapons-workshop remesh GLBs carry `texture_0` base colour plus normal and
metallic-roughness), which answers `style-bible.md` §4's "unverified until B0".
The OP arrived with a small flag on its cabin roof despite the prompt; the
exporter deletes that geometry (`OP_FLAG_FRAC`).

What is committed under `art/meshy/`: each REMESH folder's `model.glb`
(the exporter's only input), and every task's `task.json` and `thumbnail.png`
(the provenance record), plus `ledger.jsonl`. The preview and refine
`model.glb` files (8-50 MB each of 30k-tri geometry the export never reads) and
the loose texture PNGs a remesh writes beside its GLB (duplicates of what the
GLB embeds) are not committed -- the same "the ledger and task ids are the
record" convention the seven ground props follow above.
