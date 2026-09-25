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
