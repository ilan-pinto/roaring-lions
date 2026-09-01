# Asset provenance

Where every shipped asset came from, and which ones cannot ship as-is.

Written 2026-08-30, when the project lead stated an intent to **close-source the
game and release it on Steam**. That changes what matters: redistribution of
*source* stops being the question, and **commercial use** plus **attribution
obligations that survive into a credits screen** become the question.

This file is a snapshot with a date on it. It is not a gate. See
"The gap" below for why that is the most important line in it.

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

## Sprites: 41 sets, 36 clean

36 of 41 carry `Original work for Roaring Lions (CC BY-SA 4.0)` or the
equivalent. The five exceptions:

| Set | Credit | Problem | Status |
|---|---|---|---|
| `TNK_HULL` | **(none)** | no credit at all | **replaced** by `art/meshes/vehicles/mbt_lavi.glb`; old art not yet retired |
| `TNK_TURR` | **(none)** | as above | as above |
| `NAMER_HULL` | `Mutte (CC-BY 3.0, BlendSwap #75225)` | attribution mandatory and permanent; would have to appear in a shipped credits screen | **replaced** by `art/meshes/vehicles/ifv_namer.glb`; old art not yet retired |
| `NAMER_TURR` | as above | as above | as above |
| `JEEP_HULL` | `Military jeep. LICENCE UNVERIFIED` | `tools/render_jeep.py`: *"downloaded without licence, readme or attribution. Do not redistribute until the terms are established."* **No known terms at all.** | **replaced** by `art/meshes/vehicles/jeep_shoded.glb`; old art not yet retired |

Licence file on disk for the Namer only: `art/src/ifv_dmm08_LICENSE.html`
(`creativecommons.org/licenses/by/3.0` — plain Attribution, so commercial use
and closed-source derivatives are both permitted; attribution is not optional).

**All five now have replacements drawing in game**, so every retirement below is
unblocked. Retirement is still deliberately not performed here: art existing and
art drawing are different things, this branch has confused them six times, and
each retirement is its own verified step rather than a bulk delete.

**Update, 2026-09-01: the `&mesh` gate is gone — meshes are the default on
`three`.** `main.ts` now loads every mesh asset unless `&nomesh` is passed, so
the correction below is history rather than current state: a menu-driven player
on the default backend now DOES draw `mbt_lavi`, `ifv_namer` and `jeep_shoded`
from `art/meshes/vehicles/`. Verified live on `?mission=beit_sahwan_2_foothold`
with no flags — 7 vehicle and 14 unit mesh templates populated, 34 GLB fetches.

That unblocks **half** of outstanding item 2 and no more. `?renderer=pixi` still
has no mesh path, and `SPRITE_MAP` still loads all three sets unconditionally
for both backends, so deleting them today still blanks those vehicles on Pixi.
The remaining decision is unchanged and still the project lead's: accept that
`?renderer=pixi` loses them, or keep the debt until Pixi itself is retired. What
changed is that the *default* configuration is no longer an argument for keeping
them.

**Correction, 2026-08-31: "drawing in game" above is narrower than it reads.**
The replacements draw only behind the dev-only `&mesh` URL flag
(`packages/app/src/sandbox-help.ts`'s `SANDBOX_FLAGS`) — checked live against
the running dev server, not merely read off the source. Neither backend's
*default* configuration loads a vehicle mesh at all: `SPRITE_MAP` in
`main.ts` still names `TNK_HULL`/`TNK_TURR` for `mbt_lavi`,
`NAMER_HULL`/`NAMER_TURR` for `ifv_namer`, and `JEEP_HULL` for `jeep_shoded`,
and that loop runs unconditionally, for both backends, regardless of `&mesh`.
`?renderer=pixi` has no mesh path at all (`PixiRenderer` never gained one),
so it depends on these three sets absolutely. And on the default `three`
backend, `flags.mesh` gates the *entire* `MESH_VEHICLES` load — with the flag
off, `vehicleMeshTemplates` stays empty and the billboard path (built from
these same three sprite sets) is what actually draws `mbt_lavi`, `ifv_namer`
and `jeep_shoded`. Confirmed empirically: on the live dev server,
`?sandbox&renderer=three` (no `&mesh`) shows `unitInstancers` containing all
three ids and `vehicleMeshTemplates` empty; adding `&mesh` populates
`vehicleMeshTemplates` for them (and `unitInstancers` still keeps loading the
sprites — mesh wins the draw, but nothing stops loading the billboard).
`menu.ts` never appends `&mesh` to any link it builds, so **every real player,
on both backends, in their default configuration, is currently drawing these
three units from the sprite sets this section calls "unblocked" to retire.**
"Unblocked" is true only for a developer who manually adds `&mesh` to the
URL. See `.superpowers/sprite-retirement-report.md` for the full trail
(gitignored, session-scoped) and outstanding item 2 below for what retiring
these three sets actually requires before it is safe.

---

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

- **Code (MIT, effectively sole-authored)** — 747 of ~753 commits are the
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

That asymmetry is why `JEEP_HULL` shipped with *"LICENCE UNVERIFIED"* in its own
credit string and nothing objected, and why 33 meshes have no origin recorded at
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
2. **Retire the three superseded sprite sets** — `TNK_*`, `NAMER_*`, `JEEP_HULL`
   plus their `render_*.py` scripts and `art/src/ifv_dmm08_LICENSE.html` — each
   only after its replacement is confirmed drawing in game. Retiring `NAMER_*`
   removes the project's last permanent attribution obligation; retiring
   `JEEP_HULL` removes the only asset with no known terms at all.
   **Attempted 2026-08-31, NOT done — still blocked, but for one reason fewer
   as of 2026-09-01.** The original blocker — "confirmed drawing in game" meaning
   "drawing behind the dev-only `&mesh` flag," off in every real player's session
   — no longer applies on `three`: meshes are the default there now (see the
   update above `SPRITE_MAP`'s table). Pixi is what still blocks it. Concretely, deleting these
   three directories today would blank `mbt_lavi`, `ifv_namer` and
   `jeep_shoded` for `?renderer=pixi` (no mesh path exists there at all — not
   a gap to close, a permanent property of that backend) AND for the default
   `three` backend with no `&mesh` (which is every menu-driven link —
   `menu.ts` never adds the flag). Two more concrete breaks found alongside
   the rendering hole, neither owned by this task: `packages/render/src/
   three/units/instances.test.ts` (in `pnpm test`'s baseline) does a hard
   JSON import of `assets/sprites/TNK_HULL/manifest.json`; and
   `tools/vehicles/export_meshy_tank.py` / `export_meshy_namer.py` /
   `export_meshy_jeep.py` each read their respective legacy manifest's
   `real_metres` as the source of truth when regenerating that vehicle's GLB
   — deleting the manifest breaks re-running those scripts, not just today's
   render. Unblocking this is a decision, not a cleanup: either make `&mesh`
   (or an equivalent) the default for these three vehicle types on `three`
   and accept that `?renderer=pixi` permanently loses them, or accept the
   attribution/licence debt stays until `?renderer=pixi` itself is retired,
   or give these three types their own non-Meshy replacement sprites. That
   choice is the project lead's, not this task's — see
   `.superpowers/sprite-retirement-report.md` for the full trail.
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
