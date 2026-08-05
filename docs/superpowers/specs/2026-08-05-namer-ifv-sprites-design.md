# Namer IFV sprites — and a shared vehicle renderer

**Date:** 2026-08-05
**Status:** approved, ready for implementation planning

## Problem

`ifv_namer` has no sprite. It draws as a procedural polygon while the tank,
the infantry and now the Eitan all have rendered art. Two Namers spawn in the
M0 sandbox, so it is one of the most visible gaps left in the roster.

## Source asset

`VEHICLE IFV DMM08` by **Mutte**, BlendSwap #75225.

**Creative Commons Attribution 3.0** — any purpose, attribution required. This
is the first downloaded asset in this project that arrived with its licence.

It is squarely within the project's stated policy. `CONTRIBUTING.md` line 17:
CC0 is the safe bar, *"CC-BY is accepted with a `credit` line"*, and libraries
permitting use but not redistribution cannot be committed. So this asset needs
a credit line and nothing more — no `LICENCE UNVERIFIED` marking.

Worth recording, because it explains how the two unlicensed assets got in:
`tools/validate_audio.py` **enforces** that policy for sound, with a licence
allowlist that includes `CC-BY-3.0` and a mandatory `source` URL, failing the
build on anything undeclared. `validate_assets.py` checks art pixels —
palette, alpha, silhouette — but never provenance. Nothing was looking when the
soldier and the truck were committed with no terms at all.

**The `.blend` is not committed.** `.gitignore` line 19 excludes
`art/src/*.blend` — the sources are too large to track — so provenance travels
in three places instead: the licence HTML in `art/src/`, the `CREDIT` constant
in the render script, and the `credit` field the script writes into each
manifest. CLAUDE.md's rule against committing sprites without their source is
satisfied in spirit by a reproducible script plus recorded provenance, not by
the binary.

The model suits the unit. A 6×6 wheeled armoured hull with a cannon turret and
a secondary remote station, against a `ifv_namer` that is a wheeled IFV with a
30mm autocannon and one passenger seat.

| Property | Value |
|---|---|
| Geometry | 9,100 verts / 8,035 faces — 35× lighter than the Eitan's truck |
| Dimensions | 2.62 × 6.92 × 3.96, in real-world metres |
| Rig | None. No armature, no actions — static, like the truck |
| Textures | 2048px diffuse/normal/spec, discarded (see below) |

The textures are discarded. `validate_assets.py` requires every opaque pixel to
be exactly a palette entry, and the diffuse maps are desert camo. The pipeline
overrides all materials with the flat palette material, exactly as the Eitan
does. Keeping the model's own textures would fail the palette gate.

## Clips

Hull `idle` and `wreck`; turret `idle`. 16 facings each, 48 renders total.

This matches the Eitan deliberately, so the two vehicles read as one art set.

A rolling-wheel `move` clip was considered and rejected. This model would
support it — three separate axle meshes, and renders are cheap at 9k faces —
but at 64px a wheel is roughly 8px across and the vehicle's own travel across
the screen dominates any tread motion. It would also make the Namer the only
vehicle with a move clip, leaving the Eitan looking static beside it.

The wreck bakes its turret in. When a unit dies the renderer draws only the
hull atlas's `wreck` clip and hides the turret sprite, so a separate wrecked
turret layer would never be drawn.

## Architecture — a shared vehicle renderer

`tools/render_eitan.py` and a Namer script would be about 95% identical. There
are already five `render_*.py` scripts with overlap, and this would be the
sixth.

Extract `tools/render_vehicle.py` holding what they share: `flat_material`,
`burnt_material`, `setup`, `render_clip`, `write_manifest`, and the dimetric
camera and pivot maths. It is driven by a per-vehicle spec:

```python
VehicleSpec(src, out_hull, out_turr, turret_meshes, scale, credit, unit_name)
```

`render_eitan.py` becomes a thin config that calls it. Its variable values are
already isolated as constants at the top of the file, so this is a move rather
than a rewrite. `render_namer.py` is a second config.

The reason to extract rather than copy is concrete: a depsgraph
evaluation-order bug in `render_soldier.py` silently removed the soldiers'
heads from every rendered frame. With duplicated scripts, that class of bug has
to be found and fixed once per vehicle, and will eventually be fixed once.

### The Namer's config

| | |
|---|---|
| Source | `art/src/ifv_dmm08.blend` |
| Hull meshes | `BODY`, `EIXO1`, `EIXO2`, `EIXO3`, `STEP` |
| Turret meshes | `TURRENT_BODY`, `CANNON`, `CANNON_BASE`, `REMOT_BODY`, `REMOT_GUN` |
| Output | `assets/sprites/NAMER_HULL/`, `assets/sprites/NAMER_TURR/` |
| Scale | `1.7` |
| Credit | `Mutte (CC-BY 3.0, BlendSwap #75225)` |

Scale 1.7 comes from the model being in real metres: 6.92m long, against the
tank at 1.8 and the Eitan at 1.6.

### Two properties of this file the truck did not have

Both are handled in the shared renderer, since any future vehicle may have
them.

**`resolution_percentage` is 50 in this blend.** A preview requesting 420px
rendered at 210. Unforced, every sheet would silently render at half
resolution. The shared renderer sets it to 100.

**The file ships its own `Camera`, `Sun` and two `Hemi` lights.** The renderer
builds its own lighting, so these must be removed or exposure will be wrong.
Unlike the truck, there is no ground-plane mesh to exclude.

## Wiring

- Two manifests on the current clip format, carrying `credit`, `scale` and the
  rig's `facingOffset`/`facingReverse`. Note these two are hardcoded constants
  in `write_manifest` (`5` and `True`) describing how this rig lays frames out;
  they are emitted by the script rather than measured off the images by eye, but
  they are not derived — a rig change means changing them.
- The turret manifest must declare `layer: "turret"`. `validate_assets.py`'s
  `is_layer()` reads that key to skip the fill and silhouette checks, which ask
  "does this read as a unit at gameplay zoom" — a question a bare weapon station
  cannot answer. Without it the turret sheet fails on fill, since a turret alone
  is well under 6% of frame.
- One entry in `SPRITE_MAP` in `packages/app/src/main.ts`:
  `ifv_namer: { path: …NAMER_HULL/, turretPath: …NAMER_TURR/ }`.
- **No renderer changes.** Clip resolution, independent turret traverse, wreck
  spawning, power-scaled recoil and the muzzle VFX all already work. The Namer
  inherits them by having a sheet at all. Its `cannon_30` is class
  `autocannon`, so it already selects the `fire_autocannon` emitter.

## Validation

`pnpm validate:assets` enforces palette conformance, binary alpha, a ≥6%
silhouette fill at 64px, and pairwise silhouette IoU below 0.88.

Measured on the preview render before committing to the work:

| Check | Measured | Limit |
|---|---|---|
| Fill at 64px | 22.2% | ≥ 6% |
| IoU vs `EITAN_HULL` | 0.525 | < 0.88 |
| IoU vs `TNK_HULL` | 0.328 | < 0.88 |

The two wheeled hulls were the plausible collision — a 6×6 IFV against an 8×8
APC — and 0.525 leaves ample headroom. These figures come from a preview at a
single orientation rather than a real sheet facing, so they are indicative;
the gate runs on the real sheets.

The fill figure is measured with the production camera formula
(`radius = dists[-1]`, the full extent), not the 97th percentile an earlier
draft used. The distinction matters here because this model has tall antennas
that inflate the radius and so shrink the vehicle in frame: the looser formula
reported 24.3%.

`pnpm test:determinism` must pass with an unchanged hash. Nothing here touches
`packages/sim`.

## Testing

No unit tests. This is asset production plus a refactor of build tooling, and
CLAUDE.md holds that rendering does not require tests while combat maths does.

The refactor's correctness is established by re-rendering the Eitan through the
shared renderer and comparing against the committed sheets.

Byte-identical output is the hoped-for result but must not be the pass
condition: Cycles with denoising is not guaranteed reproducible to the byte
across runs. The pass condition is that every re-rendered frame has the same
dimensions, an identical binary alpha mask, and a mean per-pixel difference
near zero — with any frame that differs visibly inspected by eye. If output
does turn out byte-identical, that is a bonus, not the requirement.

## Rollout

1. Extract `tools/render_vehicle.py`; port `render_eitan.py` to it; re-render
   the Eitan into a scratch directory and compare against the committed sheets
   on the criteria under Testing. Do not overwrite the committed sheets until
   the comparison passes.
2. Put the source blend in `art/src/` (untracked) and commit its licence HTML.
3. Add `render_namer.py`; render the two sheets; **run
   `tools/quantize_sprites.py`**; then `pnpm validate:assets`.
4. Wire `SPRITE_MAP`; confirm in the running app.

Step 3's quantizer pass is not optional. Cycles output is off-palette with soft
alpha, and the art gate rejects every frame without it — the Eitan script's own
docstring records this as the required sequence.

Step 1 lands independently and is verifiable on its own, which is why it goes
first — a refactor validated against known-good output is worth having before
new art depends on it.

## Non-goals

No rolling-wheel or firing clips, for the reasons under Clips.

No fix for `validate_assets.py`'s `representative()`, which still looks for
`f00_000`-prefixed filenames and therefore compares the infantry's *crouch*
pose against the vehicles. Adding the Namer does not worsen it, since `idle_`
sorts first for clip-named sheets. It is a real defect in the check CLAUDE.md
calls the single most important one, and it belongs in its own change.

No resolution of the soldier and truck assets' missing licences. This asset
being properly licensed makes those two more conspicuous, but that is a
separate decision.

No provenance gate for art. `validate_audio.py` enforces licence and source
for sound; `validate_assets.py` has no equivalent, which is the reason
unlicensed art can land at all. Closing that gap is worth doing and is a change
of its own — it would fail the build on the two assets already committed, so it
needs their licence question resolved first.
