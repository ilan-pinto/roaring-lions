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

## The Sur highland biome -- the Lebanon cedar and the V2 ground (GH-322), 2026-10-01

Two assets for the `highland` terrain theme the eight Sur maps declare, both
approved by the lead on 1 Oct ("ground V2", "the Meshy cedar"). AI-generated,
disclosed per `CONTRIBUTING.md`.

**The cedar** -- Meshy **text-to-3D** through `pnpm meshy`, a preview plus one
remesh, **25 credits** (~$0.50), both tasks in `art/meshy/ledger.jsonl`, which
also records the prompt. No texture was requested: decor is a palette ramp
slice, zero materials by contract. `tools/terrain/fit_meshy_cedar.py` (Blender
5.2 headless, 0 credits, deterministic) splits the remesh into `trunk` /
`foliage` roles by geometry alone and writes three uniform scales of the one
base.

| File(s) (`art/meshes/decor/`) | Preview task id | Remesh task id (shipped source) | heights | tris shipped |
|---|---|---|---|---|
| `cedar_0` / `cedar_1` / `cedar_2` | `01a0f636-1df3-70c1-b014-5cd62fc58c7e` (meshy-6, lowpoly, 20,963 tris) | `01a0f63b-65fb-74f9-a672-098b61015362` (`--polycount 1500`) | 5.4 / 4.4 / 3.3 m | 1,523 each (250 trunk / 1,273 foliage faces) |

Committed under `art/meshy/`: the remesh folder's `model.glb` (the fit
script's only input) and both tasks' `task.json` and `thumbnail.png`. The
preview `model.glb` and the remesh's loose `texture_0_normal.png` are not, the
same convention as every batch above.

**The ground** -- `art/textures/highland_v2_tile.png` (shipped as
`assets/textures/highland_v2_tile.jpg` by `tools/textures/encode_ground_tiles.py`)
is authored by `tools/textures/author_highland_tile.py` from the SUPPLIED
`art/blend/terrain tiles /Meshy_AI_image_rock.png` (the image the lead fed to
Meshy; md5 `ccd28b05894a57bb5c9f8483981372ad`, gitignored with the rest of
`art/blend/`), never used before this. No Meshy call, 0 credits: a blurred-
luminance mask separates the limestone chips from the earth between them, the
chips are pulled to a warm neutral grey and the earth to terra rossa. Mean rgb
162.3 / 135.1 / 116.8, declared in `GROUND_ALBEDOS` and measured by
`tools/src/ground-albedo.test.ts`.

---

## The Roar coin's lion relief (Meshy text-to-3D, GH-317), 2026-10-01

The lion on the Roar coin (`tools/roar_coin.py`, PR #331). The first build
extruded the shop mock's own SVG profile and read as a dinosaur; the lead chose
a sculpted relief on 1 Oct ("Option 2", budget about 30 credits, cap 60).
AI-generated with Meshy, disclosed per `CONTRIBUTING.md`. **One preview,
20 credits** (~$0.40), no refine, no remesh, no re-roll; the task and its
prompt are in `art/meshy/ledger.jsonl`.

| File | Draws as | Preview task id | Refine / remesh | Size / tris |
|---|---|---|---|---|
| `art/meshy/roar-lion-relief-20261001-01a0f804/model.glb` | the relief on `assets/ui/roar_coin/roar_coin_*.png` and `.svg` | `01a0f804-bc39-778e-acc9-2861fb68fa5e` (meshy-6, standard, 508,666 tris) | -- (palette; Blender decimates) | 33 mm across, 2.0 mm deep on the coin; 16,000 tris |

What Blender did (`tools/roar_coin.py`, headless 5.2, 0 credits,
deterministic): clipped the lion off its round plaque at the measured plane
(y 0.31, inside the plaque's ring), turned it face-up, scaled it to 33 mm on
its longer axis and 2.0 mm deep (the sculpt's 0.80-unit depth over a
1.9-unit plaque would have stood 14 mm off a 4 mm coin), seated it 0.12 mm
under the face, decimated it with the collapse modifier to 16,000 triangles,
and coloured it per face from height and radius alone: the high relief and
the inner disc `limestone.1`, the mane `terracotta.1`, the mouth and the
mane's deepest grooves `shadow.1`. The groove ink is what makes the mane read
at 24 and 48 px, where `terracotta.1` on the `terracotta.0` face is
tone-on-tone. The 16/24/48 SVGs are traced from an unlit ID render of the
same scene, not drawn by hand. The coin body, rim and sizes are unchanged.
The preview `model.glb` (9.1 MB) is committed because it is the script's
only input; there is no remesh to commit instead.

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

## E5 part 2 -- the bought-only special forces (GH-181, 2026-09-30)

All three staged units have art; every file is **held** (`HELD_MESH_FILES`,
`packages/app/src/mesh-catalogue.ts`) until E5 Task 9 lands their unit JSON. Numbers
tables, prompts and the credit plan: `docs/art/meshy-prompts-e5.md`. Every spend is a
line in `art/meshy/ledger.jsonl`: **70 credits consumed** (Zikit preview 20 + refine 10
+ remesh 5 on 2026-09-30; Tzav preview 20 + refine 10 + remesh 5 on 2026-10-01, once the
key's limit was raised) against 70 planned and the 140 cap. AI-generated (Meshy) where it says so,
disclosed per `CONTRIBUTING.md`.

| File | Draws as (once landed) | Source | Notes |
|---|---|---|---|
| `art/meshes/vehicles/heli_peten_gunship.glb` | `heli_peten_gunship` (Peten Gunship, KDF air) | `art/meshes/vehicles/heli_peten.glb` re-opened by `tools/vehicles/export_meshy_apache_gunship.py` -- the supplied Meshy Peten's own export, so the same AI-generated source as `heli_peten` above, **0 credits** | Adds `stores_hull` (stub wings, pylons, two drop tanks), `stores_metal` (four rocket pods, mast and dome) and `sensor_glass` (nose ball), every one UV-pinned to the Peten's `base_color` bake (one material; `TEXTURED_VEHICLE_TYPES`). Rotor graph unchanged; wreck re-made by `pnpm wreck:meshes` (recipe `air` + `rotor_pivot`). **41,771 tris** live (Peten 41,031), 4.684 m drawn size as the Peten. IoU against `heli_peten` **0.653** at 64 px (limit 0.88), against the `APACHE_HULL` sprite 0.408. |
| `art/meshes/recon_zikit.glb` | `recon_zikit` (Shmamit Deep Recon Team, KDF) | Meshy text-to-3D preview `01a0f343-6390-741c-adee-20c9a3ec409e` (`--pose a-pose`), refine `01a0f344-3a27-7653-9d91-9e0db0ddef5b` (2k), remesh `01a0f346-7ff9-772a-aa3c-f0cae827210c` at 1,500 (arrived 1,541 with the bake); `art/meshy/recon-zikit-20260930-01a0f34{3,6}/` | **Textured** (`TEXTURED_INFANTRY_TYPES`): the remesh's base colour at 1024 JPEG q85 on `uniform`/`boot`/`face`. ONE figure cut into `rig.py` parts three times by `tools/units/import_meshy_zikit_team.py`: `zk_rifle` standing with the kit rifle level at the hand, `zk_radio` standing with a 0.9 m kit whip at 80 degrees over the pack, `zk_spot` kneeling behind a kit tripod scope on the `prop` bone. Corpses at 0.5, seam blobs at 6x2 (the two levers that hold three figures under the cap). **7,997 tris**, clips `idle, move, fire, down, wreck`, all `rig.py`'s own. Highest IoU: `mortar_team` 0.598 (mesh), `DRONE_RECON` 0.386 (sprite). No `rl_gait` yet: `pnpm gait:meshes` is scoped to `RIGGED_UNIT_MESHES`, so it runs at landing. |
| `art/meshes/vehicles/demo_tzav.glb` | `demo_tzav` (Shiryonan Demolition Carrier, KDF tracked engineering vehicle) | Meshy text-to-3D preview `01a0f5f2-08a8-734f-8348-a80f63b20b30`, refine `01a0f5f3-3cdf-71c8-9061-cd8698e04795` (2k), remesh `01a0f5f6-8e92-7148-834f-9bd3e136c31e` at 5,000 (arrived 4,888 faces with the bake); `art/meshy/demo-tzav-20261001-01a0f5f{2,6}/`; **35 credits** on 2026-10-01 (the 2026-09-30 attempt's two 402s charged nothing) | **Textured** (`TEXTURED_VEHICLE_TYPES`): the remesh's own `base_color` at 2048, normal and metallic-roughness kept at 2048, no bake fix (hue 86 / sat 0.41 / val 0.29 in the linear buffer, between the D9's 70/0.51/0.29 and the Eitan's 102/0.29/0.33). `tools/vehicles/export_meshy_tzav.py`: crate end measured at +X (no turn), tracks split as `hull_rubber` (2,088 faces, the outboard band |y| 0.27..0.41 below 0.375 of the belly), **8.5 m declared** over arm and crate (no sprite manifest yet; E6's `TZAV_HULL` must render from this GLB), x 4.15 x 4.02 m; `turret_pivot` with the Eitan-sized `kit.rws` on the measured cab roof at (-2.49, 0, 3.57) m. **4,940 tris** live; wreck by `pnpm wreck:meshes` (recipe `tracked` + `turret_pivot`, live-vs-wreck IoU 0.739). Highest IoU at 64 px: `apc_eitan` 0.838, `apc_kipod` 0.799, `ifv_namer` 0.792, `dozer_d9` 0.765 (mesh); `KIPOD_HULL` 0.749 (sprite); fill 22.3%. The remesh kept the two roof whips the prompt did not ask for; they are a few pixels at any zoom and were left. Held until E6. |

Measured on the way: the Zikit figure came back with its A-pose arms BENT, hands forward
(chord 78-81 degrees from vertical, tip x +0.32 against the shoulder's -0.07), which the
B0b importer's "within 0.05 H of the shoulder-to-hand chord" arm test does not see -- the
elbows stayed in the torso and only the hands hung. `import_meshy_zikit_team.py` widens
the chord radius so the test becomes "outboard of the arm-root ring", which is safe on
this figure because no pack face reaches that far out. The whip and the slung carbine
were left out of the prompt on purpose (B0a measured that a remesh drops every thin whip;
a slung gun on the base figure would arm all three men) and are kit geometry instead.

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


## GH-286 batch B0b — the first Meshy-textured rigged figure teams

Two units, 2026-09-30, both Meshy **text-to-3D** through the CLI (`pnpm meshy`),
AI-generated and disclosed per `CONTRIBUTING.md`; every spend is a line in
`art/meshy/ledger.jsonl` (**70 credits consumed** against the 80 the lead
approved: preview 20 + refine 10 + remesh 5 per unit; the 5-credit Meshy rig
was not bought — the CLI has no `rig` command, a headless session cannot drive
the web UI, and a figure cut into `rig.py`'s parts does not need one). Prompts
and numbers tables are in `docs/art/meshy-prompts-units.md` §3–4, used verbatim.
Under `art/meshy/<slug>-20260930-<task>/`: each task's `task.json` and
thumbnail, the ledger, and the two REMESH `model.glb` files (the importer's
actual input, ~10.5 MB each with their 2048/4096 maps) are committed; the
preview and refine downloads (six formats, ~100 MB per refine) are not.

| File | Draws as | Preview task id | Refine / remesh task id (shipped) | Notes |
|---|---|---|---|---|
| `art/meshes/at_team.glb` | `at_team` (Spike AT Team, KDF) | `01a0f2fa-3d74-7553-8559-fc36a338cd92` (`--pose a-pose`) | refine `01a0f2fb-2e11-70ac-8034-d21b9b58d534` (2k), remesh `01a0f2fd-1f66-779a-9a23-370974ee442a` at 2,000 | **Textured** (`TEXTURED_INFANTRY_TYPES`): ships the remesh's base-colour bake at 1024, JPEG q85, on `uniform`/`boot`/`face`; the normal and metallic-roughness maps are dropped. ONE figure, 1.78 m, cut into `rig.py` parts for both men (`tools/units/import_meshy_kdf_team.py`): `at_fire` kneeling (2,051 tris) with `kit.launcher` level on the shoulder, `at_spot` standing (2,051) with `kit.binoculars`; two prone corpses at half. **6,754 tris**, 1014928 bytes after the gait pass (321540 encoded). Clips `idle, move, fire, down, wreck`, all `rig.py`'s own. |
| `art/meshes/demo_squad.glb` | `demo_squad` (Combat Engineers, KDF) | `01a0f2fb-6ba7-7245-9bd0-22edca38a2a6` (`--pose a-pose`) | refine `01a0f2fc-8731-76a4-af00-4d4805d08fb1` (2k), remesh `01a0f302-184a-701e-a5c6-daa76f54f83f` at 2,000 | As `at_team`: `demo_a` kneeling (2,061 tris) beside `kit.demo_charge` on the `prop` bone, `demo_b` standing (2,061) with the kit rifle held level at his hung right hand and `kit.cable_spool` worn on the back (the kit drew it through the shins). **6,828 tris**, 1048200 bytes after the gait pass (323484 encoded). Same five clips. |

Measured in this batch: a remesh of a refined task keeps its bake (both
figures arrived with base colour + normal + metallic-roughness); Meshy honoured
the A-pose, helmet, carrier, boots, goggles and knee pads, and returned bent
elbows with upturned palms rather than a straight A-pose — the importer hangs
each arm as one rigid unit about its shoulder ring, so the hands flare
slightly at the wrist. `pnpm validate:meshes` passes with both on the
`NOT palette-checked` line (silhouette IoU still runs and clears 0.88).

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

---

## WP-A3.1 batch B3 — the first textured infantry (GH-179)

Three teams, 2026-09-30, Meshy **text-to-3D** through the CLI (`pnpm meshy`):
one A-pose preview, one refine (2k), one remesh each — **105 credits** against
the 120 the lead approved (35 a unit; the 5 the plan held for a Meshy rig call
was not spent — the figures are rigged through `rig.py`, as B2's were).
AI-generated and disclosed per `CONTRIBUTING.md`; every spend is a line in
`art/meshy/ledger.jsonl`. Prompts, numbers tables and the per-unit decisions are
in `docs/art/meshy-prompts-units.md` §10–12. The downloaded `model.glb` and
texture sources sit under `art/meshy/<slug>-20260930-<task>/` and are **not
committed** (each refine folder is ~130 MB across six formats); the ledger,
each folder's `task.json` and thumbnail are. The task ids below are the
provenance. All three are the first entries in `TEXTURED_INFANTRY_TYPES` /
`TEXTURED_INFANTRY_EXEMPT` (#307): the palette, framing and fill checks skip
them and silhouette IoU still runs.

| File | Draws as | Preview task id (`--pose a-pose`) | Refine task id (2k) | Remesh task id (shipped) | Notes |
|---|---|---|---|---|---|
| `art/meshes/militia_cell.glb` | `militia_cell` (Militia Cell, enemy) | `01a0f307-59d9-75fd-bd39-76311d703bed` | `01a0f308-4984-7657-9dcf-9132e3fafb6a` | `01a0f30b-c1ee-748b-9915-6aaabecbe861` at 2,000 | ONE figure, 1.70 m, both men. The preview ignored the head wrap AND the open jacket (a clean bare-headed tan soldier came back), so both men wear `kit.keffiyeh`, coloured from their own shirt's bake. Base colour 2048 → 1024 JPEG; normal and metallic-roughness dropped. **7,746 glTF tris**, 1.10 MB source / 355 KB shipped. |
| `art/meshes/rpg_team.glb` | `rpg_team` (RPG Team, enemy) | `01a0f30b-c2bc-7569-bdce-13ec56567f8f` | `01a0f30c-e042-7315-85b2-bf36b9f01a5a` | `01a0f313-bf75-727d-8573-8fb7f04c2453` at 2,000 | One figure, 1.76 m. The head wrap came back but painted **rose pink**; its texels (head and collar faces, red-magenta hue, saturation > 0.16) are remapped to dusty tan at their own luminance in the importer. The spare-rounds pack came as a small backpack. `rpg_fire` walks with his tube now (`animates=True`). **7,082 tris**, 1.02 MB / 333 KB. |
| `art/meshes/atgm_cell.glb` | `atgm_cell` (ATGM Cell, enemy) | `01a0f30b-c390-7426-a0f8-e745b1d7589b` | `01a0f30c-c781-701e-a0c7-50e45ee6552f` | `01a0f313-c015-77e4-8b32-fd22a37957f9` at 1,100 | One figure, 1.72 m, both crew kneeling (B2's `_kneel`) on D6 walkers; the quilted jacket came as asked. Its pink-white cap is remapped to limestone the same way. Tripod is `kit.atgm_tripod` on `prop`. **7,228 tris**, 1.11 MB / 369 KB. |

All three through `tools/units/import_meshy_crew_team.py` (B2's importer,
extended): rigid one-part-to-one-bone on `rig.py`'s tables, `rig.py`'s own
clips, no hand-posing, no weights. The corpse is no longer the A-pose body laid
flat: the same cut parts are re-arranged rigidly in code (left arm overhead,
right arm out, right knee bent, head turned, body rolled 12°), welded, and
decimated once at 0.5. Kit weapons (`rifle`, `launcher`, `atgm_tripod`) stay
palette-painted beside the textured figure — the loader decides per mesh.
---

## WP-A3.1 batch B4 — the last three enemy teams (GH-179)

Three teams, 2026-10-01, Meshy **text-to-3D** through the CLI (`pnpm meshy`):
one A-pose preview, one refine (2k), one remesh each — **105 credits** against
the 120 the lead approved (35 a unit, no Meshy rig call; the 30 Sep attempt
answered HTTP 402 before any spend and is recorded in
`docs/art/meshy-prompts-units.md`). AI-generated and disclosed per
`CONTRIBUTING.md`; every spend is a line in `art/meshy/ledger.jsonl`. Prompts,
numbers tables and the per-unit decisions are in `meshy-prompts-units.md`
§13–15; what each preview honoured and what the importer fixed in
`style-bible.md` §11. The downloaded `model.glb` and texture sources sit under
`art/meshy/<slug>-20261001-<task>/` and are **not committed**; the ledger, each
folder's `task.json` and thumbnail are. All three join `TEXTURED_INFANTRY_TYPES`
/ `TEXTURED_INFANTRY_EXEMPT`: palette, framing and fill skip them, silhouette
IoU still runs.

| File | Draws as | Preview task id (`--pose a-pose`) | Refine task id (2k) | Remesh task id (shipped) | Notes |
|---|---|---|---|---|---|
| `art/meshes/mortar_crew.glb` | `mortar_crew` (Mortar Crew, enemy) | `01a0f5ef-c4df-71f9-833b-cf974437337b` | `01a0f5f0-87b4-7418-84d9-e40f53dcb913` | `01a0f5f3-5e48-70e5-9aa6-f249c78e1dd7` at 1,100 | Two kneelers (B2's `_kneel`, D6 walkers) round `kit.mortar` on `prop`; 7,995 tris, 1.22 MB source / 0.41 MB shipped. Preview came in a helmet with goggles and a slung gun: kit keffiyeh over the crown; the refine's red-and-white check on helmet, collar and bandolier remapped to dusty tan. Worst IoU neighbour `recoilless_team` 0.549 |
| `art/meshes/charge_squad.glb` | `charge_squad` (Suicide Squad, enemy) | `01a0f5f0-7b09-76f5-8452-315d719f0236` | `01a0f5f1-63b0-77dc-a0b2-30e2aeaf247f` | `01a0f5f3-5e8b-7032-93bb-1a9bdae9af32` at 2,000 | Two standing men, 20° rest lean through `teams._lean_forward`, `chg1`'s kit satchel (`charge`), no weapon; 7,478 tris. Preview came helmeted: kit keffiyeh. Corpses offset ±0.30 m so the single-file pair does not fall in one heap. Worst IoU neighbour `wall` 0.502 |
| `art/meshes/digger_crew.glb` | `digger_crew` (Digger Crew, enemy) | `01a0f5f0-995a-76d1-8158-3585f4847011` | `01a0f5f1-8793-7094-80ee-b3535f37513b` | `01a0f5f3-5ee3-739e-a016-4ea1ce94669d` at 2,000 | One kneeler at `rig._digger_extras`' heap on `ground`, kit entrenching tool (`wood` + `metal`) in his hands; 6,214 tris. Preview came bald with both arms reaching FORWARD, not an A-pose: arms kept on the torso (`ARMS_FORWARD`), corpse on its side, head away from the heap; the rose check on the crown remapped to grey. Four clips (no `work` anywhere). Worst IoU neighbour `moto_rpg` 0.557 |

All three through `tools/units/import_meshy_crew_team.py` (B3's importer): rigid
one-part-to-one-bone on `rig.py`'s tables, `rig.py`'s own clips, no hand-posing,
no weights; `pnpm gait:meshes` stamped each `rl_gait`. Gates on 2026-10-01:
`validate:meshes` (83 mesh units), `validate:assets`, `test` (7,653), `typecheck`,
`lint` all green; the boot-vertex, swing-lift and charge-squad cadence pins in
`tools/src/mesh_gait.test.ts` moved with the bytes.

---

## WP-A3.1 batch B5 — `breach_team`, the last KDF team (GH-179)

One team, 2026-10-01, Meshy **text-to-3D** through the CLI (`pnpm meshy`):
one A-pose preview, one refine (2k), one remesh — **35 credits** against the
65 the lead approved for B5 + B6 together (no Meshy rig call, as B0b–B4).
AI-generated and disclosed per `CONTRIBUTING.md`; every spend is a line in
`art/meshy/ledger.jsonl`. Numbers table and prompt in `meshy-prompts-units.md`
§16; what the preview honoured and what the importer fixed in `style-bible.md`
§12. The downloaded `model.glb` and texture sources sit under
`art/meshy/breach-team-20261001-<task>/` and are **not committed**; the ledger,
each folder's `task.json` and thumbnail are. Joins `TEXTURED_INFANTRY_TYPES` /
`TEXTURED_INFANTRY_EXEMPT`: palette, framing and fill skip it, silhouette IoU
still runs.

| File | Draws as | Preview task id (`--pose a-pose`) | Refine task id (2k) | Remesh task id (shipped) | Notes |
|---|---|---|---|---|---|
| `art/meshes/breach_team.glb` | `breach_team` (Tzinah Breach Team, KDF) | `01a0f621-408f-76f7-b088-42053e79a5b9` | `01a0f622-31d0-74c7-bf96-fb238e1f232e` | `01a0f624-9323-75cf-af68-5d597c4b0af6` at 2,000 | ONE figure, 1.78 m, both men standing; kit `ballistic_shield` (`metal`) on `brc_point_spine`, kit `breach_pole` (`charge`) on `brc_cover_spine` — the tells, unchanged. The preview came holding a compact carbine across the chest in the LEFT hand (not the A-pose asked for) with the right arm out: the left arm stays on the torso (`ARMS_ON_TORSO`), the carbine is cut off as a `weapon` piece on `spine` and IS the rifle (no kit rifle, `TEAM_FIGURES` `weapon=None`, `fire` is a `FIRE_ROOT_LEAN` brace); the refine's small name tape on the carrier flattened to the carrier's black (`LABEL_FLATTEN`). Corpses on their side, pushed ±0.22 m apart. **6,552 tris** (6,864 glTF), 0.99 MB source / 0.29 MB shipped. Worst IoU neighbour `apartment` 0.578 (worst unit `demo_squad` 0.524) |

Through `tools/units/import_meshy_crew_team.py` — not the B0b KDF importer the
batch plan named, because this one carries B3/B4's measured elbow cut and the
posed corpse; the only KDF-specific thing it needed was a head-role override
(`HEAD_ROLE`: helmet and neck `uniform`, no kit keffiyeh). `rig.TEAM_MESH_OWNER`
moves with it. Gates on 2026-10-01: `validate:meshes` (85 mesh units),
`validate:assets`, `test` (7,668), `typecheck`, `lint`, `validate:ui` all green;
the boot-vertex pin and the weapon pins in `tools/src/mesh_gait.test.ts` moved
with the bytes (`breach_team.glb` is in `WEAPON_EXEMPT` now, with the reason).

---

## WP-A3.1 batch B6 — `moto_rpg`, a Meshy bike under B3's riders (GH-179)

One unit, 2026-10-01, Meshy **text-to-3D** through the CLI (`pnpm meshy`): one
preview (no pose, no refine — a palette part) and one remesh — **25 credits**;
B5 + B6 together **60 against the 65 the lead approved**. The riders cost
nothing: they are B3's `rpg_team` figure (its remesh and bake, already on disk)
re-posed seated in code. AI-generated and disclosed per `CONTRIBUTING.md`;
every spend is a line in `art/meshy/ledger.jsonl`. Numbers table and prompt in
`meshy-prompts-units.md` §17; what the preview honoured and what the importer
did in `style-bible.md` §13. The downloaded `model.glb` sources sit under
`art/meshy/moto-rpg-20261001-<task>/` and are **not committed**; the ledger,
each folder's `task.json` and thumbnail are. Joins `TEXTURED_INFANTRY_TYPES` /
`TEXTURED_INFANTRY_EXEMPT` for the riders' bake; the bike's own meshes carry no
UV and take the enemy ramp (the loader decides per mesh).

| File | Draws as | Preview task id | Remesh task id (shipped) | Riders | Notes |
|---|---|---|---|---|---|
| `art/meshes/moto_rpg.glb` | `moto_rpg` (Armed Motorcycle, enemy) | `01a0f62f-c542-709f-a687-4c7c07808be6` | `01a0f631-e3c6-7076-8eae-cf95ec4d032a` at 1,500 | `rpg_team` remesh `01a0f313-bf75-727d-8573-8fb7f04c2453` (B3), 1.76 m, rose scarf remapped to tan | The bike scaled to 2.2 m (`teams._motorcycle`), front found by the wider end (bars) and turned to `+X`; its hoop wheels (1,500 tris keep no spokes) cut out and `kit.tube` cylinders stood on axles read from the ground-contact points (`weapon`, as kit's tyres); saddle and rear bag `webbing`, the rest `metal`. Riders seated rigidly from `cut_figure`'s parts (thighs 75° forward, shins back to the pegs, the rider leaned 12° with hands on the bars, the pillion upright with hands on his knees), one unit per seat bone; kit launcher on `m_launcher` at the pillion's measured shoulder; `rig._moto_bone_table`'s shape with measured heads, `rig.build_moto_clips` unchanged (`idle`, `move`, `fire`, `wreck` — no `down`). Wreck: the same bike through `teams._tip_over`, decimated 0.45, plus two posed corpses at `teams.moto_rpg`'s own anchors. **7,348 tris**, 1.05 MB source / 0.37 MB shipped. Worst IoU neighbour `digger_crew` 0.650 |

Through `tools/units/import_meshy_moto_rpg.py` (new; owner in
`rig.TEAM_MESH_OWNER`), which borrows `import_meshy_crew_team.py`'s loader, cut
and posed corpse for the riders. The preview honoured the knobbly tyres, the
long saddle and "no rider"; the "two panniers and a rolled bedroll" came as one
roll bag on the rear rack. Gates on 2026-10-01: `validate:meshes` (85 mesh
units), `validate:assets`, `test`, `typecheck`, `lint`, `validate:ui` all green;
`mesh_gait.test.ts`'s `moto_rpg` pins (a non-walker whose boots do not move,
no arm bones) held unchanged.

---

## WP-A3.1 batch B7 — the eight teams without a bake (GH-179)

Eight unit types, 2026-10-01, on the lead's "Run all 8" (160–240 credits,
ceiling 300): **205 credits spent, no re-roll.** AI-generated (Meshy) and
disclosed per `CONTRIBUTING.md`; every spend is a line in
`art/meshy/ledger.jsonl`. Numbers tables and prompts in
`meshy-prompts-units.md` §18–23; what each preview honoured and what the
importer fixed in `style-bible.md` §14. The downloaded `model.glb` and texture
sources sit under `art/meshy/<slug>-20261001-<task>/` and are **not
committed**; the ledger, each folder's `task.json` and thumbnail are. All
eight join `TEXTURED_INFANTRY_TYPES` / `TEXTURED_INFANTRY_EXEMPT`: palette,
framing and fill skip them, silhouette IoU still runs. Three things this
batch did differently from B3–B6:

- **Two bakes were bought on previews that already existed.** The CLI gained
  `pnpm meshy -- refine <preview-task-id>` (the `--refine` half of `text` on
  its own), so `manpad_team` and `recoilless_team` -- B2's figures, the ones
  the lead judged and #327 seated -- cost 15 each (refine 10 + remesh 5 at
  B2's 1,500), not a new 35-credit figure. The re-remesh is a fresh shell of
  the same preview, so the cut, the kneel and `_seat_launcher` re-ran on it;
  `launcher_clearance.test.ts` reads 0 inside on both.
- **The four civilians keep their supplied figures and ship the bake those
  sources always carried -- 0 credits.** `tools/import_meshy_civilians.py`
  keeps one material (the B3 rule, `_keep_base_color`, shared) and exports it
  at 1024 JPEG; same geometry, same supplied clips, same `rl_gait` to the
  fourth decimal. `validate_mesh_assets.py` maps the four file basenames to
  the one type id (`TEXTURED_FILE_TYPE`) so the two pinned lists stay equal.
- **The five supplied teams are REPLACED** (`meshy_soldier.glb`,
  `meshy_mortar_team.glb`, `yahalom_engineer.glb` deleted; `sarim_rifles.glb`
  and `sniper_team.glb` overwritten) by A-pose figures through
  `tools/units/import_meshy_crew_team.py`, each under its team id's own
  name. What went with them: the supplied `moveFire`, `fall`, `fallAlt` and
  `wreckAlt` clips (rig.py topples per figure), the mortar's limbered march
  (the crew walk on D6 walkers now) and the sniper sculpt's ghillie drape.
  `yahalom_squad`'s `work` did NOT go: rig.py builds it now (`build_work_clip`,
  a kneeler body on `yah_ak_root` shown in `work` alone, its own mast pitched
  into the ground), so the tunnel charge still plays a man at the mast.

| File | Draws as | Preview task id (`--pose a-pose`) | Refine task id (2k) | Remesh task id (shipped) | Notes |
|---|---|---|---|---|---|
| `art/meshes/manpad_team.glb` | `manpad_team` (MANPAD Team, enemy) | **B3's militia_cell figure** (`01a0f307…`, remesh `01a0f30b…`, 1.70 m) since the lead's 2026-10-02 ruling; B2's `01a0f2ac-f4e5-7632-8b48-d8813d50890c` and its refine `01a0f88a-c202-7630-85cf-d6fc9ec596ac` / remesh `01a0f88f-07fa-7056-820b-4a231e864cff` are UNUSED (15 credits, ledger lines kept) | — | — | The refine painted the scarf and collar red-and-white check: `RECOLOUR` to dusty tan (B4's window). The tube found no seat inside `SEAT_OUT_MAX` 0.10 -- the nearest candidate failed by 3 samples within 2 cm and 1 vertex in the bore -- so the search's outboard limit is 0.12 (measured, then widened) and the tube rests over the deltoid at out 0.105. The support hand reads 17 cm short of the stock (B2's gripstock, no handle). **9,503 polys / 10,843 glTF tris**, 0.40 MB shipped |
| `art/meshes/recoilless_team.glb` | `recoilless_team` (Recoilless Team, enemy) | B2's `01a0f2ac-f5b1-7146-b3e3-73be95e86ff2` | `01a0f88c-8d6f-74b8-8c45-bffaf4ce1e90` | `01a0f890-4780-708b-8c6d-dae7e73166ea` at 1,500 | A grey hood and tan rig, no recolour. Seat found at the old limits (pushed 0.200, rest 0.33). **11,140 polys / 12,432 glTF tris** |
| `art/meshes/inf_squad.glb` | `inf_squad` (Rifle Squad, KDF) | `01a0f891-8aa4-76c1-97ca-260bac7383b5` | `01a0f892-61d1-703e-b0bd-226ab87adaff` | `01a0f89c-f6c6-7272-a46c-bc4a5a02abb7` at 1,500 | The preview came holding its carbine across the chest in BOTH hands (not the A-pose): both arms stay on the torso (`ARMS_ON_TORSO`), the carbine ships as `weapon` on each man's `spine` (`WEAPON_ON_SPINE`), no kit rifle, `fire` is a 3-degree `FIRE_ROOT_LEAN` brace -- breach_team's shape on both sides. Three men at kit's line. **8,193 polys / 8,664 glTF tris**, 0.40 MB shipped. This file is the bible's 1.78 m KDF reference now |
| `art/meshes/sarim_rifles.glb` | `sarim_rifles` (Sarim Rifles, enemy) | **B3's militia_cell figure** (remesh `01a0f30b…`, 1.70 m) since the 2026-10-02 ruling; the B7 preview `01a0f894-4a4e-7291-b64d-a9d96dc8c408`, refine `01a0f895-4da3-7456-8dd7-c70a75566455` and remesh `01a0f89e-7b37-7588-8fae-85a8979448c6` are UNUSED (35 credits, ledger lines kept) | — | — | A-pose honoured; the head wrap ignored (bare head, a saturated green headband): kit's keffiyeh over the crown, and the band's green remapped to tan (`RECOLOUR`, a non-wrapping hue window, new). Three riflemen in `teams.py`'s wedge, kit rifles at the bent hand. Joins `rig.SUPPORTED_TEAMS`. **10,684 polys / 12,168 glTF tris** |
| `art/meshes/mortar_team.glb` | `mortar_team` (60mm Mortar Team, KDF) | `01a0f897-130a-7292-904b-e1c69d00549f` | `01a0f898-1301-72be-b851-7fa06623fb66` | `01a0f89f-ca03-719d-b2c1-1439abe166d3` at 1,000 | A-pose honoured, helmet and pouches. Two kneelers on D6 walkers (new for this team -- the kit's crew had none), the No.3 standing with a kit rifle, `rig._mortar_team_extras` on `prop`. **10,182 polys / 11,766 glTF tris** at 1,000 tris a figure (three men, two of them three times, plus the bisection rings) |
| `art/meshes/sniper_team.glb` | `sniper_team` (Sniper Team, KDF) | `01a0f89a-112b-76f6-be96-e757cf292ba7` | `01a0f89a-d374-7120-acea-40834aa11577` | `01a0f8a1-15c0-75ee-8fc3-40b12f5bdcb3` at 1,500 | The preview came AIMING its carbine, arms up on the gun, no ghillie hood. Kept: `rig._sniper_rest`'s two bodies with Meshy geometry -- the standing walker (carbine on `spine`) for `move`, and the same cut laid on its chest on `death_root` (`_prone_parts`: head lifted 38 deg, legs splayed, arms under it) for every other clip, with kit's long rifle and bipod lying beside the head and a small kit glasses box at the spotter's face. The carbine turned along the body ran through the lying man's head and was dropped from the prone copy. **7,470 polys / 7,938 glTF tris** |
| `art/meshes/yahalom_squad.glb` | `yahalom_squad` (Yahalom Engineers, KDF) | `01a0f8a2-8570-74fb-812e-bf374a02e002` | `01a0f8a3-5e19-7267-95d0-e80a06084f24` | `01a0f8ab-7294-7338-b207-1ed04b57ec44` at 2,000 | A-pose honoured, knee pads and goggles, no cord coil, a small green shoulder patch left as painted. Kit packs on both spines, the 1.45 m mast level at yah_a's hung hand (`metal`, not `weapon` -- a sensor mast is not a barrel), yah_b's rifle at his hand, and the `work` kneeler. **11,360 polys / 12,410 glTF tris** -- the third body is the cap's cost. The review found the kit packs (`teams._yah_pack`, 0.18 m behind a KIT figure's axis) running through both Meshy torsos, 86-89 surface samples inside on every clip and 79 on the work kneeler: `_pack_behind` seats each pack 1 cm behind the figure's own measured back, 0 inside, and `launcher_clearance.test.ts` now gates mounted parts (the packs, and the mortar against its crew) the way it gates held launchers |
| `art/meshes/civilians/*.glb` (4) | `civilians` | supplied (see "The supplied Meshy assets") | — | — | Bake kept at 1024 JPEG; 0.27–0.32 MB shipped each |

**The review's second defect, and the fix every team got.** The 1400 px
renders showed shards on the mortar team's torso, shoulders and legs: a
1,000-tri remesh has triangles up to ~10 cm across, and `cut_figure`
classified each one whole by its centroid, so a triangle straddling the knee
or the arm root stayed with one side and was torn into a spike when the kneel
or the arm hang turned its neighbours. `_bisect_source` now cuts the source
shell along the hinge planes (ankle, knee, crotch, both arm roots -- only the
faces near each plane, and with the arm axes measured BEFORE the cut and
cached) before any classification; every B7 team was rebuilt on it (+14-30%
tris, the counts above). The mortar itself was measured clear of all three
crewmen before and after (0 samples inside).

**The lead's ruling of 2026-10-02 (option 1).** In the live captures the new
`sarim_rifles` and `manpad_team` figures read as KDF soldiers at game zoom --
dark olive, helmets -- and the militia side must stay tan with keffiyehs. Both
teams are built on the EXISTING Sarim body, B3's `militia_cell` remesh with its
tan bake and kit keffiyeh, at 0 credits and no new Meshy call: the importer's
source mapping alone changed. The rifles and the MANPAD tube are unchanged
(seat re-searched on the new body; `launcher_clearance` 0 inside). The two
figures generated for them -- B2's MANPAD man (refined in B7) and the B7 Sarim
rifleman -- are unused: 50 of the batch's 205 credits bought nothing that
ships, and their ledger lines stay. Counts now: manpad 11,440 glTF tris,
sarim 12,898.

Gates on 2026-10-01: `validate:meshes`, `encode:meshes --check`, `test`
(`mesh_gait.test.ts` re-pinned: the control is the rig.py mortar_team, the
fall/moveFire/marker/two-posture tests that measured the deleted files are
gone with them, `sniper_team` stays the one multiplier under 1.0 at 0.972),
`launcher_clearance.test.ts` (0 inside on all four), `typecheck`, `lint`.

---

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

---

## GH-286 batch B0b — the first Meshy-textured rigged figure teams

Two units, 2026-09-30, both Meshy **text-to-3D** through the CLI (`pnpm meshy`),
AI-generated and disclosed per `CONTRIBUTING.md`; every spend is a line in
`art/meshy/ledger.jsonl` (**70 credits consumed** against the 80 the lead
approved: preview 20 + refine 10 + remesh 5 per unit; the 5-credit Meshy rig
was not bought — the CLI has no `rig` command, a headless session cannot drive
the web UI, and a figure cut into `rig.py`'s parts does not need one). Prompts
and numbers tables are in `docs/art/meshy-prompts-units.md` §3–4, used verbatim.
Under `art/meshy/<slug>-20260930-<task>/`: each task's `task.json` and
thumbnail, the ledger, and the two REMESH `model.glb` files (the importer's
actual input, ~10.5 MB each with their 2048/4096 maps) are committed; the
preview and refine downloads (six formats, ~100 MB per refine) are not.

| File | Draws as | Preview task id | Refine / remesh task id (shipped) | Notes |
|---|---|---|---|---|
| `art/meshes/at_team.glb` | `at_team` (Spike AT Team, KDF) | `01a0f2fa-3d74-7553-8559-fc36a338cd92` (`--pose a-pose`) | refine `01a0f2fb-2e11-70ac-8034-d21b9b58d534` (2k), remesh `01a0f2fd-1f66-779a-9a23-370974ee442a` at 2,000 | **Textured** (`TEXTURED_INFANTRY_TYPES`): ships the remesh's base-colour bake at 1024, JPEG q85, on `uniform`/`boot`/`face`; the normal and metallic-roughness maps are dropped. ONE figure, 1.78 m, cut into `rig.py` parts for both men (`tools/units/import_meshy_kdf_team.py`): `at_fire` kneeling (2,051 tris) with `kit.launcher` level on the shoulder, `at_spot` standing (2,051) with `kit.binoculars`; two prone corpses at half. **6,754 tris**, 1014928 bytes after the gait pass (321540 encoded). Clips `idle, move, fire, down, wreck`, all `rig.py`'s own. |
| `art/meshes/demo_squad.glb` | `demo_squad` (Combat Engineers, KDF) | `01a0f2fb-6ba7-7245-9bd0-22edca38a2a6` (`--pose a-pose`) | refine `01a0f2fc-8731-76a4-af00-4d4805d08fb1` (2k), remesh `01a0f302-184a-701e-a5c6-daa76f54f83f` at 2,000 | As `at_team`: `demo_a` kneeling (2,061 tris) beside `kit.demo_charge` on the `prop` bone, `demo_b` standing (2,061) with the kit rifle held level at his hung right hand and `kit.cable_spool` worn on the back (the kit drew it through the shins). **6,828 tris**, 1048200 bytes after the gait pass (323484 encoded). Same five clips. |

Measured in this batch: a remesh of a refined task keeps its bake (both
figures arrived with base colour + normal + metallic-roughness); Meshy honoured
the A-pose, helmet, carrier, boots, goggles and knee pads, and returned bent
elbows with upturned palms rather than a straight A-pose — the importer hangs
each arm as one rigid unit about its shoulder ring, so the hands flare
slightly at the wrist. `pnpm validate:meshes` passes with both on the
`NOT palette-checked` line (silhouette IoU still runs and clears 0.88).

---

## GH-298 — the officers (held art, Stage 5 wires it)

Four units, 2026-09-30, three of them Meshy **text-to-3D** through the CLI
(`pnpm meshy`), AI-generated and disclosed per `CONTRIBUTING.md`; every spend is
a line in `art/meshy/ledger.jsonl` (**105 credits consumed** against the 155 the
lead planned and the 310 cap: preview 20 + refine 10 + remesh 5 per figure team,
0 for the command tank, which is a Blender variant of the shipped Lavi). Numbers,
prompts and the credit plan are `docs/art/meshy-prompts-officers.md`, used
verbatim. No unit JSON exists yet, so all four files sit in `HELD_MESH_FILES`
(`packages/app/src/mesh-catalogue.ts`) and draw nothing until Stage 5 of the
field-commanders spec claims them. Under `art/meshy/<slug>-20260930-<task>/`:
each task's `task.json` and thumbnail and the three REMESH `model.glb` files
(the importer's input, ~11 MB each with their 2048 maps) are committed; the
preview and refine downloads are not.

| File | Draws as (Stage 5) | Preview task id | Refine / remesh task id (shipped) | Notes |
|---|---|---|---|---|
| `art/meshes/officer_infantry.glb` | `officer_infantry` (Capt. Maya Pereg, infantry company commander) | `01a0f33e-aa5b-71e4-bd3c-ee5f17fbc82e` (`--pose a-pose`) | refine `01a0f33f-9c56-72af-a11d-009f1def0ced` (2k), remesh `01a0f342-783f-748a-a4ce-88fc2d808a21` at 2,000 (2,041 tris) | **Textured** (`TEXTURED_INFANTRY_TYPES`). Two figures, two people: `maya` standing (1.68 m, patrol cap, the new figure) and `sig`, the signaller, cut from B0b's `at_team` remesh (`01a0f2fd-…`, 0 credits) with a kit whip antenna on his rucksack and the kit rifle. Both bakes in ONE 2048x1024 atlas (1024 a figure, JPEG q85). `tools/units/import_meshy_officers.py`. **7,429 tris** in the shipped bytes (incl. the two half-decimated corpses), 1205456 bytes, 498184 encoded. Clips `idle, move, fire, down, wreck`, `rig.py`'s own; stride sized from `inf_squad.json` until the officer JSON lands. |
| `art/meshes/officer_fires.glb` | `officer_fires` (Capt. Sagi Sharav, forward observer) | `01a0f341-6d50-72a9-b8e8-747cb13c7e5a` (`--pose a-pose`) | refine `01a0f342-41c0-719d-ab81-af6a4e515af0` (2k), remesh `01a0f344-2e47-74ac-bdd3-b050b4075658` at 2,000 (2,075 tris) | As above. Meshy returned Sagi with a helmet and both hands on a rifle across his chest rather than the A-pose asked for; the importer keeps his upper body as one rigid part (no arm cut) and kneels him at a kit laser designator on a tripod (`prop` bone); `rto`, the radio operator, is the `at_team` remesh again with whip and rifle. **7,292 tris**, 1188220 bytes, 488816 encoded. |
| `art/meshes/officer_engineer.glb` | `officer_engineer` (Capt. Dalia Charsit, engineer commander) | `01a0f341-6e1f-7447-afce-b8e055b07548` (`--pose a-pose`) | refine `01a0f342-49ef-747e-b7b2-f3b33c0a0824` (2k), remesh `01a0f344-2e90-70f4-b19f-05fbb19e842f` at 2,000 (2,071 tris) | As above. `dalia` standing (1.70 m, helmet) with a kit mine probe held in the right hand; `sap`, the sapper, cut from B0b's `demo_squad` remesh (`01a0f302-…`, 0 credits) with whip, rifle and a slung kit satchel (`charge`). **7,521 tris**, 1237456 bytes, 495992 encoded. |
| `art/meshes/vehicles/officer_armour.glb` | `officer_armour` (Capt. Ronen Heled, command Lavi) | none (0 credits) | none | **Textured** (`TEXTURED_VEHICLE_TYPES`): the shipped `mbt_lavi.glb` (itself Meshy, above) re-exported by `tools/vehicles/export_officer_armour.py` with a kit commander's cupola, a three-section telescoping mast to z 4.8 m and two whip antennas, each UV-pinned to the paint it sits on and JOINED into the Lavi's own four nodes, so the file keeps the Lavi's bake, material and `turret_pivot`. **8,610 tris** (the Lavi's 8,346 plus the kit parts), 2849668 bytes. Wreck by `pnpm wreck:meshes` (recipe `tracked` + `turret_pivot`). IoU vs `mbt_lavi` **0.525** (limit 0.88): the mast changes the frame the gate fits, which is the whole of R8's answer. |

Measured in this batch: Meshy paints a small sleeve badge on every KDF figure
whatever the prompt says, so the importer scrubs chroma/brightness outliers
under each officer's upper-arm faces before the atlas is built (1,285 / 186 /
262 texels replaced); a GENERATED Blender image is silently skipped by the glTF
exporter, and comparing two `bpy` node wrappers with `is` removed the texture
node itself — the first exports shipped `images: None` and were caught by
reading the GLB's JSON chunk, not by the export succeeding; and a 1.35 m whip
put `officer_fires` under the gate's 6% fill floor (5.2%), because the gate
frames each unit to its own bounds — 0.85 m clears it at 9.1%.

## The A3.2 remainder — the relay hut, the pump house, damage states, the hall wreck and the licensing pass (GH-185, GH-31, GH-157), 2026-10-03

The plan is PR #353 (`docs/art/a32-remainder-plan.md`), approved by the lead on
3 Oct with its recommended defaults: a map symbol for the relay (decision 1A),
both prompts as written (2), the material route for damage states first (3A),
the island cut for the hall wreck (4b), the Meshy tier left as the lead's word
(5). **80 credits planned, 80 consumed, cap 160, no re-roll** — `pnpm meshy --
spent` 1,605 → 1,685 as Meshy reports it. Both buildings are **AI-generated
with Meshy** (text-to-3D preview, 8k refine, remesh at 8,000), disclosed per
`CONTRIBUTING.md`; every prompt is in the committed `art/meshy/ledger.jsonl`.
The remesh `model.glb`, `task.json` and thumbnail are committed as the ramp
set's were; the preview and 8k refine folders (6 MB and ~200 MB each) are not,
and their task ids below are the record.

| File | Draws as | Preview task id | Refine task id (8k) | Remesh task id (shipped) | Size / tris |
|---|---|---|---|---|---|
| `art/meshes/buildings/relay.glb` + `_wreck` | `relay` (Adhal's relay hut, the `y` symbol on all three Umm Zeitoun maps) | `01a10299-4609-75ff-a2b2-9ac0d2fc3b07` | `01a1029a-7e70-7384-abbc-7de44ced7cea` | `01a1029d-7e8c-70cd-9284-f1c9c6822706` (8,000, arrived 7,270) | 4.65 × 4.65 m plan, 10.0 m to the mast tip, parapet at 6.9 m; 7,270 / 12,043 tris; 1.26 / 1.28 MiB Draco |
| `art/meshes/buildings/pump_house.glb` + `_wreck` | `pump_house` (the Rif forward store, `wadi_halam_2_laager`'s `structures[]`) | `01a10299-dca5-7022-93ef-8c3b564692b9` | `01a1029b-39d5-76b8-9c33-77901bb018d8` | `01a1029d-efc7-7546-9ffa-e1ff1d2c774b` (8,000, arrived 7,594) | 3.9 × 5.6 m plan, 3.8 m tall; 7,594 / 6,909 tris; 1.28 / 1.28 MiB Draco |

What Blender did to each (`tools/buildings/export_meshy_ramp.py`, two new
`RampSpec` rows, the same exporter as the ramp set):

- **The relay** came back a square two-storey blockhouse with the lattice mast
  INTACT through the remesh (3,726 vertices above 0.8 of the height — the camp
  lost its mast tip at 10,000 and this one did not at 8,000, which is what a
  lattice buys over a whip), one dish on the mast and one on the roof, the
  ladder, the door with its step. Scaled on HEIGHT, not plan: the roof slab
  sits at 0.69 of the total, so 10 m to the tip puts the parapet at 6.9 m and
  the plan at 4.65 m over its 6 × 3 m footprint — the numbers table's two
  storeys; scaling the plan to 6 m would have made a 12.9 m tower. **The
  dark-opening yaw rule could not read this bake** (board-form concrete is
  dark on every face: the four candidates scored 0.73 / 0.72 / 0.89 / 0.91 and
  the rule picked 270°, which turns the door onto the hidden `-X` face), so
  the exporter gained a MEASURED `yaw` override and the number comes from the
  geometry: the step block makes the ground band of the `-Y` side reach 0.433
  against 0.337 at mid height while the other three sides are flush within
  0.015, and the mast centroid is (−0.277, −0.100), the `-X/-Y` corner. One
  quarter turn puts the door on `+X` and the mast on the camera's near corner,
  where the numbers table asked for it; the auto choice is still printed
  beside the override. `building_facing.py` judges it **directional** (it is
  not in the gate's "not facing-checked" list).
- **The pump house** came back as asked — a one-room shed, single-pitch
  roof, plank door and one window on the front, the tank on its stand beside
  it — and the dark-opening rule reads it cleanly (0.154 on the camera half
  against 0.022 hidden). It keeps yaw 0 by that rule, which puts the tank at
  the far end under this camera, behind the roof line; yaw 90 scores within
  5% and puts the door on `+X` and the tank on the near side, so the measured
  override takes that one too. Scaled on height to 3.8 m (the shanty's own
  lesson), 3.9 × 5.6 m inside the 2 × 2 tiles it replaces. The facing gate
  names it on its passing path as "only 8 glazed px on the larger half — too
  little frontage to judge": its two openings are small, and the rule that
  judges the concrete at 171 px has nothing to measure here.
- Both wrecks are `render_building.collapse()` on the textured pieces, as the
  ramp set's are; no second generation.

**Wiring.** `relay` is a new catalogue entry with symbol `y` and `concrete`'s
numbers to the digit (700 hp/tile, garrison 2, rubble 2, `roe_penalty` 3,
`height_px` 20, `limestone.4`), authored on the two `#` tiles at (15,7)–(16,7)
of `umm_zeitoun.json`, `umm_zeitoun_3.json` and `umm_zeitoun_4.json` (the plan
named two maps; the third, UZ III's own variant, carries the same two tiles
and `umm_zeitoun_variants.test.ts` is what caught it), so all four Umm
Zeitoun missions stand the hut and `umm_zeitoun_4_clearance`'s `raze(crest_top)`
snapshots it unchanged. `pump_house` copies `shanty`'s (120 / 1 / 1 / 2 / 11 /
`dust.1`) with symbol `p` that no map authors — the camp's shape — and
`wadi_halam_2_laager.json`'s `structures[]` names it in place of the shanty.
No loader or sim code moved: `STRUCTURE_SYMBOLS` is derived from the
catalogue. One gate line did: `validate_data.mjs`'s garrison-stance check was
the literal `'#hawsm'` and now reads every catalogue type with a slot. `pnpm
playtest` is byte-identical before and after (every line of the table; the
diff is the `time` line). `tools/src/umm_zeitoun_doctrine.test.ts` pins the
relay's numbers against the concrete's.

**Damage states (GH-31), the material route — 0 credits.** A mesh building
drew pixel-identical at 1 hp and at full until this; it now steps through
`units/building-damage.ts`'s bands on every `structureHit`: 8–6 clean, 5–3
scarred (the wreck charring at `(1 − band/8) × 0.6`, one memoised clone per
template material per band), 2–1 burning (`data/vfx/structure_burning.json`
on the renderer's own timer, the smoke plume at the template's measured roof
height), 0 the existing wreck, which keeps a dying fire for 20 s only if the
building was burning when it fell. `Sim.debugDamageStructure(id, eighths)`
beside `debugDestroyStructure` is what the capture sheet drives, through the
same path a hit takes. The sheet is `tools/src/perf/building-captures.ts`
(`--only=sheet`: `house` and `hall` on `beit_sahwan_outskirts` at every band,
zoom 2.5 and 1.0); the lead judges it. Measured on the hall at zoom 2.5
through the live renderer: the sunlit facade's mean RGB reads 132.8 clean and
117.9 at band 3.

**The hall wreck (decision 4b) — measured, nothing to cut.** The destroyed
source is ONE loose part (`separate(type='LOOSE')` on the raw 1,922,562 faces
yields one object; an edge-connected walk over the decimated 47,861 faces
finds one island), and deleting the UV layer leaves the same decimation floor.
The "thousands of debris islands" in `export_meshy_hall.py`'s own note was a
reading of the GLB's per-face vertex split, not of the mesh; the note now says
so. The wreck ships as it did (47,860 tris, 945 KB Draco), `hall.glb` and
`hall_wreck.glb` byte-identical to `main`.

### The A3.2 licensing pass — repository facts, 2026-10-03

| asset | status | what replaces it |
|---|---|---|
| `TNK_HULL`, `TNK_TURR` (Tiger-derived) | retired 2026-09-25 (`30050389`): every frame re-rendered from `art/meshes/vehicles/mbt_lavi.glb`; the old frames stay in history ("History is kept") | nothing — done |
| `JEEP_HULL` (downloaded model, no licence) | re-rendered the same day from `jeep_shoded.glb`, a supplied Meshy asset | nothing — verified |
| `art/src/soldier_kolos.fbx` (Synty) | deleted (`38ea4a20` / `30b069c0`); never shipped | nothing — done |
| `NAMER_HULL`, `NAMER_TURR` (Mutte, CC BY 3.0) | kept, the one permanent attribution (`credits-data.ts`, pinned); still live because the sprite sheet is rendered from the Mutte model while `ifv_namer.glb` is a Meshy Namer | optional: re-render from `ifv_namer.glb` (the TNK route), retiring the credit with the sheet |
| the Meshy commercial tier | "Commercial rights" above: the lead's 2026-08-30 word, unverified by anything in the repository | **lead action, docs only**: one direct read of the plan's terms, then the plan NAME, the date read, and the two answers (commercial use; redistribution in a shipped binary) go into "Commercial rights". The lead will send the plan name; until then this line is the record |
| mesh provenance (outstanding item 1) | every Meshy mesh since September has its task ids here and its prompt in the ledger; the per-GLB `credit` gate is still open | recorded, not done here |

## WP-A3.1 batch B8 v2 — `ifv_namer` (GH-179), 2026-10-02

The lead's ruling on the first B8 Namer (`art/namer-props`, PR #339: it read as a
WWII tank destroyer — sloped, low, an old-style turret, too light an olive — and
is not shipped there): re-do it on this branch at about 40 credits, cap 80.
**40 credits spent, no re-roll.** AI-generated (Meshy) and disclosed per
`CONTRIBUTING.md`; numbers and the prompt in `meshy-prompts-units.md` ("Batch B8
v2"). The downloads (54–74 MB at 8k) are not committed; the ledger, `task.json`
and thumbnails are. The CLI gained `--negative` (the API's `negative_prompt`) for
this preview.

| File | Draws as | Preview task id | Refine task id (8k) | Remesh task id (shipped) | Notes |
|---|---|---|---|---|---|
| `art/meshes/vehicles/ifv_namer.glb` | `ifv_namer` (Namer IFV, KDF) | `01a0fb1d-984a-75ee-a4e2-1576a4c39a12` (negative: "tank destroyer, sloped casemate, gun turret, cannon barrel, WWII, vintage, low hull, rivets") | `01a0fb1f-8375-72f5-92f7-eb196c89d804` | `01a0fb22-2611-760e-934f-b77197039b9a` at 8,000 (arrived 8,048) | **Textured** (`TEXTURED_VEHICLE_TYPES`, already listed): the remesh's 8k base colour, normal and metallic-roughness at 2048 JPEG q85. The preview honoured the hull — tall slab-sided box, bonnet at the front with headlights, flat high roof, skirts over six large road wheels, vertical rear ramp — and STILL grew a gun turret with a barrel over the bonnet, negative prompt or not; `export_meshy_ramp.py` collapses it onto the roof (`turret`, 532 verts) with the whip the remesh kept (13 verts), and seats `kit.rws` (1.0×0.8×0.5, 1.2 m) where it stood (`rws.at`, +0.92 m, roof 3.24 m). Rz 180 (end-plate area +x 0.74 vs −x 0.51: the ramp is the vertical end), 7.3 m from `NAMER_HULL`, tracked split at the measured band. The bake came back desert tan; `sand_olive` pulls its tan band (58% of texels) 22° toward yellow-green at 0.85 sat / 0.82 value, into the Eitan's register. `pnpm wreck:meshes` after; `export_meshy_namer.py` deleted. **7,810 tris** (hull 2,354 / tracks 5,404 / RWS 22), 7.3 × 4.12 × 3.74 m with the RWS. Ring rows re-pasted from `unit-footprints.ts` (1.61, ellipse 1.61 × 1.05). |

**Portrait re-rendered** (`tools/render_unit_portraits.py --only=ifv_namer`).

## WP-A3.1 batch B8 — the lead's 2 Oct follow-ups: the Namer, the mortar, the sniper rifle (GH-179)

Three items, 2026-10-02, approved by the lead after the portrait sheet (about 90
planned, cap 150): **120 credits spent, no re-roll; the Namer's 40 did not ship (see its row)** — preview 20 + refine 15 +
remesh 5 per item, the refine at **8k**, the lead's standing rule since 2 Oct
("every model at MAXIMUM DETAIL"; `style-bible.md` §4). AI-generated (Meshy) and
disclosed per `CONTRIBUTING.md`; every spend is a line in `art/meshy/ledger.jsonl`.
Numbers tables and prompts in `meshy-prompts-units.md` §24–26; what arrived and
what Blender did in `style-bible.md` §15. The downloaded `model.glb` and texture
sources (54–74 MB each at 8k) sit under `art/meshy/<slug>-20261002-<task>/` and
are **not committed**, as B7's were not; the ledger, each folder's `task.json`
and thumbnail are. The two B7 figure remeshes the importer rebuilds on
(`mortar-team-*-01a0f89f`, `sniper-team-*-01a0f8a1`) were re-downloaded from
Meshy for 0 credits inside its three-day window; the same rule applies to them.

| File | Draws as | Preview task id | Refine task id (8k) | Remesh task id (shipped) | Notes |
|---|---|---|---|---|---|
| *(not shipped)* | `ifv_namer` (Namer IFV, KDF) | `01a0fae0-8b20-71c2-bfbb-0a8f4b1c6b27` | `01a0fae2-4538-758c-9314-297369eeeff9` | `01a0fae4-ce58-77b8-bf8a-90a0876f2fef` at 8,000 | **UNUSED — the lead's 2 Oct ruling: the preview read as a WWII tank destroyer (sloped, low, an old-style turret, too light an olive), so the shipped `ifv_namer.glb` stays the 2026-08 image-to-3D hull and a v2 is generated on its own branch (`art/namer-v2`). 40 credits, ledger lines kept.** What this attempt measured, for v2: the remesh's tracked split read 5,202 of 7,790 faces in the track band; the preview put a gun on the glacis (collapsed, 52 verts); the roof ring measured 1.28 m across at (−0.117, 0) in the 7.3 m frame. |
| `art/meshes/mortar_team.glb` (the mortar) | `mortar_team`'s `weapon` on `prop` | `01a0fae0-8f0b-70aa-bc3e-0f4c44e2ec5a` | `01a0fae2-4563-723f-a67a-aa4a8ecc3a8d` | `01a0fae4-ced0-703c-885c-de5d8b3228f7` at 600 (arrived 589) | One mesh — tube, bipod with hand wheels, round baseplate, sight — scaled to 1.40 m on its longest axis, baseplate centre on kit's (0.26, 0) anchor, muzzle +X. **Elevated ~35°, not the prompted 70°**: kept (no re-roll budget at 8k; a tilt of the whole assembly would lift the plate). Textured through the figure's atlas (`import_meshy_crew_team.py`, "B8"): one 2048×1024 `base_color`, figure left / part right, one material. The No.3's kit rifle borrows a uv from the mortar's bake. 0 samples inside any crewman (`launcher_clearance`). Team file 11,766 → **10,743 glTF tris** (the kit plate and bipods go). |
| `art/meshes/sniper_team.glb` (the rifle and the spotting scope) | `sniper_team`'s `weapon` on `snp_a_death_root`, `metal` on `snp_b_death_root` | `01a0fae0-89ab-7725-9fbf-5cfb7ff3af18` | `01a0fae2-45b3-715c-8cc1-eae6c688ccf5` | `01a0fae4-cecf-7493-ac81-22d91d8c5dac` at 600 (arrived 564) | ONE preview carried both, as asked: split by connectivity after welding the remesh's UV-split vertices (before the weld it fell into 361 "islands"), rifle 501 tris / scope 63. The rifle turned muzzle +X (the thinner end), scaled to 1.24 m on its long axis, lying on its own bipod beside the prone head (B7's place); the scope on its tripod 0.30 m ahead of the spotter's lifted face. The standing spotter's kit glasses borrow a uv from the scope's bake so `metal` stays one material; the standing walker keeps its baked carbine. 7,938 → **8,012 glTF tris**; the gait pins (0.972) did not move. |

**Portraits re-rendered** for `mortar_team` and `sniper_team` (`tools/render_unit_portraits.py --only`).


---

## WP-A3.1 stage 2 — the drones and the bike, textured (GH-179), 2026-10-05

Three units re-made through `pnpm meshy` (text-to-3D preview, refine at **8k**,
remesh at the bible's target), shipping each remesh's own bake instead of the
palette: 20 credits a unit for the refine and remesh (60), on top of the stage-1
previews. **AI-generated (Meshy)** and disclosed per `CONTRIBUTING.md`; every
spend and prompt is a line in `art/meshy/ledger.jsonl`. Committed for each: the
refine and remesh `task.json` and `thumbnail.png`, and the remesh `model.glb`
(never a preview's). Every model at maximum detail, simplified only to the
measured triangle caps (the lead's rule, 2 Oct).

| File | Draws as | Preview task id | Refine task id (8k) | Remesh task id (shipped) | Notes |
|---|---|---|---|---|---|
| `art/meshes/vehicles/recon_drone.glb` | `recon_drone` (KDF recon drone) | `01a10c2f-177b-768e-aeb2-690b70446bb2` | `01a10c57-cf0b-75ce-92c0-9574434b8631` | `01a10c59-eede-7009-82ba-125e709bbe8e` at 800 (801 arrived) | Arrived a HEXACOPTER (six arms); six flat rotor-guard rings added in Blender (uv into the motor-cap texel), **945 tris** of the 1,000 cap. 0.9 m real, **drawn 1.35 m** (`SIZE_CLASS["air"]` x1.5). Bake kept at 2,048 (base colour, metallic-roughness, normal). Replaces B0a's palette v2 (`01a0f2aa`). |
| `art/meshes/vehicles/attack_drone.glb` | `attack_drone` (KDF loitering munition) | `01a10c43-ae9f-7219-b923-62eb52ac13fb` | `01a10c79-b7bf-7749-aaa8-1be09178f0f5` | `01a10c7c-2354-70e0-be0e-d47776620bb6` at 800 (789 arrived) | Arrived with a STRAIGHT WING the prompt forbade; cut in Blender (309 faces) on the lead's ruling, slit closed, the four stray store pieces (16 faces) dropped: **474 tris**. Re-measured after the cut: 1.575 m long (1.05 m real x1.5), 0.85 m across the propeller disc, 0.62 m tall. The teal bake (hue ~190) turned onto olive in code (`_teal_to_olive`, 66% of texels). Replaces B0a's palette remesh (`01a0f26d`). |
| `art/meshes/moto_rpg.glb` (the bike) | `moto_rpg` (Armed Motorcycle, enemy) | `01a10c31-ea45-70f1-bef0-b06f3d51d4e2` | `01a10c65-0225-775d-8dfd-e5f11040b216` | `01a10c69-8fc1-740c-acb1-1e25cd415d57` at 1,500 (1,440 arrived) | The bike body rebuilt from the remesh with its OWN material and bake (`bike_material` / `bike_color`, 2,048), not a share of the riders' atlas (see the importer's "THE BIKE'S BAKE"). A stray second front wheel (155 faces), the rear-wheel island and a bedroll on the saddle (45 faces) deleted; both wheels are kit tubes textured from the bike's tyre texel (the remesh's hoops are poor and the front one is welded to a yawed fork). Riders unchanged: B3's `rpg_team` figure. **7,903 tris** of the 8,000 cap. Replaces B6's palette bike (`01a0f631`). |

Through `tools/drones/export_meshy_drones.py` (now the textured path, after
`export_meshy_ramp.py`) and `tools/units/import_meshy_moto_rpg.py`; both drones
join `TEXTURED_VEHICLE_TYPES` / `TEXTURED_VEHICLE_EXEMPT`. Idle stills at 1,400 px
in `docs/art/sheets/a31-parts/<id>-idle.png` (`tools/render_baked_pose.py`, the
bake-keeping twin of `render_clip_pose.py`). **Portraits re-rendered** for all
three (`tools/render_unit_portraits.py --only`).

## WP-A3.1 stage 2 — the hand weapons and crew-weapon parts (GH-179), 2026-10-05

Every kit rifle and procedural launcher left on a Meshy infantry body is replaced
by a Meshy PART: refined at **8k**, remeshed at the bible's crew-weapon number
(400, cap 600; the ATGM post and the recoilless 600), loaded from the ledger's
LAST `kind: remesh` per name, scaled to real metres (Meshy normalises every model
to 1.90 m on its longest axis) and composed into the team's ONE `base_color`
atlas exactly as B8's mortar was — one 1024 slot per part beside the figure's
1024, one material, role `weapon` (`import_meshy_crew_team.py`, "A3.1 stage 2";
the Spike through `import_meshy_kdf_team.py`). **AI-generated (Meshy)**, disclosed
per `CONTRIBUTING.md`; every spend and prompt is a line in
`art/meshy/ledger.jsonl` (numbers and rulings in `docs/art/meshy-prompts-a31-parts.md`).
Committed per task: `task.json` and `thumbnail.png`; the 8k remesh `model.glb`
sources (32–62 MB) are not, as B8's were not. Stills at 1,400 px through
`tools/render_clip_pose.py` (palette-repainted silhouettes) in
`docs/art/sheets/a31-parts/<team>-<clip>.png`.

| Part | Replaces, on | Preview task id | Refine task id (8k) | Remesh task id (shipped) | Notes |
|---|---|---|---|---|---|
| `art/parts/rpg7.glb` (RPG-7) | the procedural RPG on `rpg_team`'s `rpg_fire` (38°) and the kit tube on `moto_rpg`'s pillion | — | — | *on-disk source* `art/blend/enemy/wepons/Meshy_AI_RPG_7_launcher_0903143528_image-to-3d-texture.blend` (Meshy image-to-3D, supplied 3 Sep, 0 credits) | The TEXTURED file by the lead's ruling (every infantry team ships a bake now); `tools/units/export_meshy_rpg.py` decimates 1,954,697 → **559 tris**, 1.27 m overall, muzzle +X, base colour 4096 → 1024. Seated by `_seat_launcher` on the measured shoulder with the hands on its own pistol grip and a solved handle off its forward grip (the figures' arms cannot reach the real forward grip). Optic mirrored to the outboard side: inboard it put 106 → 173 firing-arm vertices in the chest. |
| `sarim_rifle` | every `kit.rifle` (`rig._weapon_parts`) on `militia_cell` ×2, `sarim_rifles` ×3, `rpg_team`'s loader | `01a10c2d-a7b5-750e-a603-6e4030a645a3` | `01a10c51-668c-7167-989e-f821fbb74854` | `01a10c53-aa02-7283-933d-a36bb3e1103a` at 400 (351 arrived) | 0.88 m, **339 tris** (12 sliver faces dropped). Same anchor and yaw as the kit rifle, its length centred on the kit span. Its grip came FORWARD of the magazine (Meshy's, unfixed). |
| `kdf_carbine` | the kit rifle on `mortar_team` No.3 and `yahalom_squad` yah_b; on `breach_team` the figures' BAKED carbines (both men), laid along each baked one's own axis | `01a10c40-aa15-7125-9c3b-2fc18e0a0224` | `01a10c6d-dee5-73ab-bab3-2246e541f8c1` | `01a10c6f-fd2f-71bb-9da3-6955d73f2a16` at 400 (350 arrived) | 0.85 m, **315 tris**: the slack sling, baked safety ORANGE, cut off (35 faces). Not `inf_squad`. |
| `spike_launcher` | the procedural Spike on `at_team`'s `at_fire_forearm_R`, pitch 0 | `01a10c30-4ca3-74b9-befa-ba935597d8b7` | `01a10c5d-97ab-777d-98c9-1775e9c5348d` | `01a10c61-808f-7626-9ebd-8abddc4e01b6` at 400 (410 arrived) | 1.2 m, **350 tris**: the EXTENDED bipod deleted (60 faces; at 25 px it read as a second barrel). Rear face where the procedural sight's eyepiece was; the measured grip and support handle kept, textured from the part. |
| `manpad_tube` | the procedural MANPAD on `manpad_team`'s `mpd_fire`, 78° | `01a10c41-a7cc-7653-a8d8-d549bec79b17` | `01a10c73-d0c2-7786-9026-53fc1dd45155` | `01a10c75-f46e-7277-b9bb-03d72a1f13da` at 400 (355 arrived) | The pointed missile nose cut at the tube's own end and capped flat (the lead's ruling), the hanging orange strap cut (13 faces); then 1.4 m, **354 tris** (the cap triangulated). Fatter than the procedural tube (r 0.089 vs 0.065): it seats only after sliding 0.36 of its length up its own bore, so both hands sit higher than the kit's gripstock did; the support hand on the tube 2 cm ahead of the grip, no handle (launcher_arms 170/175/186 under 196/196/207). |
| `atgm_post` (v2) | `kit.atgm_tripod` on `atgm_cell`'s `prop` | `01a10c4f-a611-776f-9bca-d720f1b947b2` | `01a10c80-1c2d-72be-9217-621d55e07b6a` | `01a10c82-1470-7159-8a6a-d25809fb6c95` at 600 (618 arrived) | Tube 1.2 m (with its rounded front, then cut back to a flat cap), axis 0.74 m up, **633 tris** (611 + the cap triangulated). Its four splayed legs reach further than kit's three: at kit's anchor 8 samples sat inside a kneeling crewman, so the mount slides forward to the first clear anchor (+0.08) plus a 0.08 sway margin: x 0.40. |
| `recoilless_rifle` (v2) | `kit.launcher("rcl_tube")` and the two `kit.tube` rounds on `recoilless_team` | `01a10c4c-319f-710d-9d1d-12d43c8955ce` | `01a10c86-56c3-7145-b9a0-dea4f527b0d8` | `01a10c88-87de-7586-8a66-47c0c2997c3a` at 600 (599 arrived) | Stood on a dirt patch the remesh welded to it: the patch cut (158 faces), the tube, the two rounds (one island, 65 tris) and three grass tufts then separate by connectivity; tufts dropped, the folding front leg cut. 1.1 m, **359 tris** tube + 65 rounds, shouldered from the kneel as before; the rounds by the loader. |

Team files after (glTF tris, before -> after this change): rpg_team 8,724 -> 9,350;
militia_cell 7,746 -> 9,510; sarim_rifles 14,448 -> 15,141; mortar_team 12,291 -> 12,498;
yahalom_squad 12,410 -> 12,617; breach_team 6,864 -> 8,118; at_team 7,408 -> 7,690;
manpad_team 12,806 -> 13,052; atgm_cell 7,228 -> 9,725; recoilless_team 12,432 -> 12,708;
moto_rpg 7,872 -> 8,926. Part of militia_cell's and breach_team's rise is not the part:
the importer at HEAD, rebuilt untouched, already reads militia's boot/uniform counts
the new file does (see `mesh_gait.test.ts`'s note). The atlases: 2048x1024 (figure +
one part) on militia_cell, sarim_rifles, yahalom_squad, breach_team, at_team,
manpad_team, atgm_cell, recoilless_team, moto_rpg's riders; 3072x1024 (figure, RPG,
rifle) on rpg_team and (figure, mortar, carbine) on mortar_team.

## The captured clips, restored (the B7 motion regression), 2026-10-05

`art/mocap/meshy_soldier.json`, `art/mocap/sarim_rifles.json` and
`art/mocap/yahalom_engineer.json` are the bone rotations (and hip path) of the
supplied Meshy bipeds' own animation clips -- `idle`, `move`, `fire`,
`moveFire`, `fall`, `fallAlt`, `down`, `wreck`, `wreckAlt` where each file had
them -- read by `tools/units/extract_mocap.py` straight out of git at
`e31ebdf3` (`git show e31ebdf3:art/meshes/<name>.glb`, blobs `e496063a`,
`ea16d2f8`, `bcdd9106`), the last commit before B7 (#335/#337) deleted or
replaced those GLBs. No geometry, no texture: rotations only. They come from
the same supplied Meshy rig and animation library as those files (see the
`meshy_soldier.glb` row above), AI-generated and disclosed per
CONTRIBUTING.md, and `tools/units/mocap.py` retargets them onto the B7
textured figures of `inf_squad`, `sarim_rifles` and `yahalom_squad`. No new
Meshy task, 0 credits.
