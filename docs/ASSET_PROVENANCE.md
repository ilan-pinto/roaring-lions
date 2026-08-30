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

**33 mesh GLBs ship with no recorded origin**, four of them AI-generated.

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
| `JEEP_HULL` | `Military jeep. LICENCE UNVERIFIED` | `tools/render_jeep.py`: *"downloaded without licence, readme or attribution. Do not redistribute until the terms are established."* **No known terms at all.** | replacement in progress |

Licence file on disk for the Namer only: `art/src/ifv_dmm08_LICENSE.html`
(`creativecommons.org/licenses/by/3.0` — plain Attribution, so commercial use
and closed-source derivatives are both permitted; attribution is not optional).

**Retirement is deliberately not performed.** Art existing and art drawing are
different things, and this branch has confused them four times. Each retirement
happens after its replacement is confirmed drawing in game, not before.

---

## The supplied Meshy assets

Four, all AI-generated with Meshy, all disclosed per `CONTRIBUTING.md`:

| File | Draws as | Source `.blend` |
|---|---|---|
| `art/meshes/meshy_soldier.glb` | `inf_squad` (KDF infantry) | `art/blend/soldier/` |
| `art/meshes/vehicles/mbt_lavi.glb` | `mbt_lavi` | `art/blend/tank/` |
| `art/meshes/vehicles/technical.glb` | `technical` | `art/blend/truck/` |
| `art/meshes/vehicles/ifv_namer.glb` | `ifv_namer` | `art/blend/namer/` |

`art/blend/` is **gitignored** (465 MB), so none of their sources are in version
control. `ART_PIPELINE.md` §8 requires source alongside rendered output — "no
binary-only art" — for the practical reason that an asset without source cannot
be re-rendered when the rig or palette version bumps. Both
`tools/import_meshy_soldier.py` and the `export_meshy_*.py` scripts read those
sources, so a fresh clone can run none of them.

That rule is project policy rather than law, and a private repo can relax it
deliberately. It should be a decision, not an omission.

### The one open question

**Which Meshy plan generated these, and do its terms permit commercial use?**

Closing the source removes the redistribution question. Selling on Steam does
not remove the commercial-use question, and AI 3D generators commonly restrict
that on free tiers. This is the only fact in this document that cannot be
established from the repository.

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
