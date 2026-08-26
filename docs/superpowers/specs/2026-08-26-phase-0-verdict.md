# Phase 0 verdict — does the quantized palette survive real-time shading?

**Date:** 2026-08-26
**Issue:** 123
**Spec:** `docs/superpowers/specs/2026-08-26-three-renderer-design.md`, Phase 0
**Method:** throwaway spike, three.js 0.170, built outside the repository and deleted.

---

## VERDICT: GO

Real-time shading can emit the game's palette exactly. Not approximately — exactly, and
by construction rather than by care.

---

## What was compared

Three panels, all at the sprite's own draw size (`size 256 × scale 0.9307 = 238 px`),
under an orthographic camera at `atan(0.5)` elevation / 45° azimuth, on limestone[3]
(that angle is **wrong** — see the note at the end of this file; it does not affect this
verdict, which measured colour)
ground, framed so the 3D soldiers occupy the same share of the frame as the sprite's do:

1. the shipped `INF_SQUAD` `idle_f00_000.png`, untouched
2. stand-in geometry, toon-shaded through the olive/gunmetal/skin ramps with a palette lookup
3. the same geometry under ordinary smooth lighting — **the control**

`INF_SQUAD` was chosen because infantry migrates first in Phase F, deforms most, and
reads worst as a static sprite. It is a three-man squad, and the stand-in matches that.

## The measurement

Distinct colours covering ≥0.05% of the frame, ground excluded, compared against every
colour in `data/palette.json`:

| panel | distinct | in palette | **off palette** |
|---|---|---|---|
| 1 · shipped sprite | 18 | 18 | **0** |
| 2 · toon + palette LUT | 10 | 10 | **0** |
| 3 · ordinary lighting (control) | 207 | 0 | **207** |

The control is the point. Ordinary real-time lighting produces a continuous gradient, and
**not one of its 207 colours is in the palette**. The same geometry, same camera, same
light, put through a lookup table, emits ten colours and all ten are palette entries.

A shaded fragment cannot emit an off-palette colour because the only values it can write
are the ones read out of the ramp. That is a stronger guarantee than the current sprite
pipeline has: `validate:assets` *checks* rendered PNGs for palette conformance after the
fact, whereas a LUT makes non-conformance unrepresentable.

## Answers to the three questions the plan asked

**1. Does the 3D unit read as the same art direction as the sprite, at 1×?**
Yes. Same olive family, same flat banding, same dark helmet mass. It reads as though it
could be the same game. The control panel, beside it, plainly does not.

**2. Does the toon ramp produce banding the quantized sprite does not have?**
No — it produces *less*. Ten colours against the sprite's eighteen. The ramps are short
by design (olive has four steps, gunmetal four, shadow three) and a toon shader quantized
to a ramp's own step count lands on exactly those steps.

**3. Does the silhouette hold at 1×?**
Partially, and this is the weakest part of the finding. The edge holds against the
limestone ground. But internal contrast is lower than the sprite's: the sprite reads
rifle, webbing and boots as separate elements, while the stand-in reads as an olive mass
with a rifle. How much of that is the shading technique and how much is that the stand-in
is capsules with no webbing and no boots cannot be separated from this test. See the
caveats.

---

## Two findings that are requirements for Phase B, not footnotes

**1. The naive colour pipeline scores zero.** The first run of this spike used
`Color.convertSRGBToLinear()` with three.js's default output colour space — the obvious
setup — and measured **0 of 65 colours in palette**. The linear/sRGB round trip moves
every value off its palette entry. Getting to zero-off-palette required:

- LUT colours built with `setStyle(hex, LinearSRGBColorSpace)` — no conversion
- `renderer.outputColorSpace = LinearSRGBColorSpace` — pass-through, no output transform
- `setClearColor` given the same treatment, or the background alone lands off-palette
  (it read `#93744C` instead of `#C8B494` until fixed)

Phase B must set this up deliberately and assert it. It is not the default and it fails
silently — the render looks *fine*, it is merely not the palette.

**2. Antialiasing must be off, or accounted for.** A blended edge pixel is by definition
not a palette colour. The sprite pipeline quantizes rather than blends. With `antialias:
true` the figure carried a fringe of intermediate values; the census above filters
sub-0.05% colours to see past it, but Phase G's palette gate will need the same rule
written down, or every mesh fails it on edges alone.

## What this does NOT establish

- **One unit type, one clip, one light direction.** No vehicles, no buildings.
- **Stand-in geometry, not a real asset.** The silhouette answer above is limited by this
  and should be re-asked once a real rigged soldier exists. This test answers *colour*,
  which is what it was for.
- **No terrain behind it, no fog, no team colours, no damage state, no VFX over the top.**
  Fog in particular multiplies colour and would need the same LUT treatment or it
  reintroduces off-palette values everywhere.
- **Nothing about silhouette IoU**, the other half of `validate:assets`. Phase G still
  has to answer that.

## What follows

Phase A is already complete and merged-ready on this branch, independent of this verdict.
This result unblocks Phases B through G as designed. The two findings above belong in
Phase B's plan as explicit tasks rather than as discovered surprises.


---

## Correction, 2026-08-27

The camera elevation used by this spike, `atan(0.5)` ≈ 26.565°, is not the right angle
for 2:1 dimetric tiles. The correct one is `asin(TILE_H / TILE_W)` = 30°, which is what
makes the camera's pixels square; at `atan(0.5)` they are anisotropic by √5/2 ≈ 1.118.

**This does not change the verdict.** The measurement here was a colour census — which
distinct colours a shaded fragment can emit, and whether each is a palette entry. That
is independent of the camera's elevation: the same geometry under the same light through
the same LUT emits the same ten colours at either angle. The finding stands, and so do
the two requirements it produced for Phase B.

It is recorded because Phase B1 inherited the wrong angle from this document and shipped
it, and seven passing tests could not see it. See `2026-08-26-phase-b1-outcome.md`.
