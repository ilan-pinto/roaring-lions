# Eitan APC — sprites and wreckage

**Date:** 2026-08-05
**Status:** approved, ready for implementation planning

## Problem

`apc_eitan` has no sprite. It renders as the procedural fallback — a flat
polygon with a stubby barrel line — while infantry and the tank have real
art. It is the most-used KDF vehicle after the Lavi and it looks like a
placeholder, because it is one.

## Source model

`/Users/ilpinto/Downloads/LPMAC_military truck.blend`, 54 MB.

The mesh names (`flatbed`, `cargo pod`, `shafts`) suggest a supply truck.
Rendered through this project's dimetric camera it is not one: it is an
armoured wheeled vehicle with an armoured cab, a boxy hull and a small
remote weapon station. That is a good match for the Eitan, which is an 8x8
wheeled APC whose only weapon in `data/units/kdf/apc_eitan.json` is
`rws_50` — a remote weapon station.

| Property | Value |
|---|---|
| Meshes | 26 |
| Geometry | 315,499 verts / 311,762 faces |
| Armature | none |
| Actions | none |
| Materials | 15, no textures |
| Turret parts | `turret high`, `gun high`, `turret mantlet high` — separable |
| Contains a ground plane | yes, must be excluded |

The separable turret is what makes this worth doing properly: the RWS can
traverse independently, exactly as the tank's turret already does.

**Licence is unverified.** The file is a bare download with no licence, no
readme and no attribution. It carries the same `LICENCE UNVERIFIED` marking
as the infantry model: in the render script header, in the manifest's
`credit` field, and in the commit message.

## Clips

Two sheets, 48 renders at 16 facings:

| Sheet | Clips | Frames |
|---|---|---|
| `EITAN_HULL` | `idle`, `wreck` | 32 |
| `EITAN_TURR` | `idle` | 16 |

No `move` clip: wheel rotation is sub-pixel at the 64px a unit occupies on
screen, so it would cost 16 renders and buy nothing visible. No `fire`
clip: a hull does not change shape when an RWS fires, and that read is
already carried by the muzzle VFX and the recoil transform.

**The wreck bakes its turret in.** When a unit dies the renderer draws only
the hull atlas's `wreck` clip and hides the turret sprite — wreckage does
not traverse. So the wrecked RWS must be part of the wreck art. Authored by
tilting and sinking the hull, knocking the turret askew, and darkening the
material toward burnt.

## Asset production

`tools/render_eitan.py`, following `render_soldier.py`'s clip-aware
structure but simpler, since there is no armature to pose.

Both sheets must share one pivot and one camera, or the RWS will drift
off-centre as it traverses. The tank sheets already solve this; copy that
approach rather than reinventing it.

The script emits `facingOffset` and `facingReverse` into the manifest from
what the rig actually produced. It does not get measured by eye off the
images — that is how the tank's `offset 5, reverse true` was originally
derived, and the manifest work exists so it never has to be again.

Rendering is two steps. Raw Cycles output is off-palette with soft edges
and the asset gate rejects it:

```bash
blender --background --python tools/render_eitan.py
python3 tools/quantize_sprites.py --sprites assets/sprites
pnpm validate:assets
```

The `.blend` goes into `art/src/`. CLAUDE.md forbids committing rendered
sprites without their source.

## Wiring

Almost nothing, which is the payoff from the manifest work:

- Two manifests on the current clip format, carrying `facingOffset`,
  `facingReverse`, `credit`, and `scale`. Start `scale` at 1.6 — the tank
  is 1.8 and an Eitan is a little shorter than a Merkava — and tune by eye.
- One entry in `SPRITE_MAP` in `packages/app/src/main.ts`:
  `apc_eitan: { path: …/EITAN_HULL/, turretPath: …/EITAN_TURR/ }`.
- **No renderer changes.** Clip resolution, turret traverse, wreck
  spawning, recoil and weapon-fire VFX all already work. The Eitan inherits
  every one of them by having a sheet at all.

`apc_eitan`'s `rws_50` is weapon class `hmg`, so it already picks up the
`fire_hmg` emitter.

## Fixing the silhouette gate

`representative()` in `tools/validate_assets.py` selects one canonical
sprite per unit by looking for a filename starting `f00_000`. The clip
migration renamed infantry files to `<clip>_f00_000.png`, so no infantry
file matches and the function falls back to whatever sorts first —
`down_f00_000.png`.

The gate therefore compares a **crouched** soldier against the tank's idle
hull. CLAUDE.md calls this "the single check" that stops two units reading
alike, and it is currently measuring the wrong thing. The Eitan will be its
third unit, so it gets fixed here.

Parse a filename as an optional `<clip>_` prefix followed by
`f<NN>_<FFF>`, and pick by preference: `idle` at facing 00 frame 000, then
legacy `f00_000`, then anything.

Fail loudly when a directory has clip-prefixed files but no `idle` clip.
That is an authoring error, and a gate that silently measures the wrong
sprite is worse than one that stops.

Selection only. `IOU_LIMIT`, `MIN_FILL`, the palette check and the framing
check are not touched.

## Risks

**Eitan versus tank silhouette IoU** is the real one. Two boxy vehicles of
similar footprint, checked at 64px. `IOU_LIMIT` is 0.88, which is
permissive, and wheels against tracks plus a low RWS against a full turret
should separate them — but this cannot be known until it renders. If it
fails, the levers are camera framing and `scale`. Not the limit: relaxing
the gate to admit two units that read alike defeats its purpose.

Lesser risks: `MIN_FILL` is unlikely to bite, since a vehicle at scale 1.6
fills far more frame than a soldier, which passed at 7–8.7%. Facing
convention is fiddly but the script emits it rather than guessing. 48
renders at 315k faces is slow, not risky.

## Non-goals

No `move` or `fire` clips, for the reasons above.

No tank migration. `TNK_HULL` is still on the legacy manifest with no
`clips` block, which is why a destroyed tank falls back to the two-line
cross while a dead soldier gets a body. This spec produces the recipe that
fixes it; applying that recipe is a separate piece of work.

No changes to any other unit, and no survey of the remaining unmapped types
(`ifv_namer`, `technical`, `recon_drone`, `demo_squad`, `civilians`).

## Verification

`pnpm validate:assets` must pass, including palette conformance, binary
alpha, the 6% fill floor, and the pairwise silhouette check now selecting
the correct sprite.

In the running app: the Eitan draws as a vehicle rather than a polygon; its
RWS traverses toward its target independently of the hull; it recoils when
firing and produces the `fire_hmg` signature; and destroying it leaves a
burnt hull on the ground rather than a grey cross.

`pnpm test:determinism` must pass with an unchanged hash. This is art and
presentation; if the hash moves, something is very wrong.
