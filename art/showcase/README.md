# Showcase assets

Hero renders and animation for marketing, the README and design discussion.
**Nothing here feeds the game.**

## Why it cannot feed the game

`assets/sprites/` needs 16 orthographic facings at 256 px on transparent film,
every pixel an exact match against `data/palette.json`, checked by
`pnpm validate:assets`. The showcase asset is the opposite of all of that: a
perspective camera, procedural camouflage, a displaced mud ground, 1280×720
video. Feeding it through the quantizer would snap the camo to arbitrary palette
entries — which is exactly why `tools/render_vehicle.py:149` gives every shipping
vehicle one flat olive material.

If a game-ready version of this vehicle is wanted, it goes through
`tools/vehicles/` and `render_vehicle.py`, at sprite scale, on the locked
dimetric rig.

## What is here

| File | Role |
|---|---|
| `apc_detail.blend` | **Source of truth** for the 8×8 APC hero asset |
| `apc_showcase.blend` | Earlier scene: base geometry plus the path/animation rig |

Renders (`*.png`, `*.mp4`) are gitignored — they regenerate from the `.blend`,
and the stills alone are 4 MB that change whenever a light moves.

## Reproducibility — read this before editing

`tools/showcase/apc_detail.py` builds the **base geometry only**: roughly 460
parts and 9 k triangles. Everything after that was done interactively in a live
Blender session — bevels across every part, hull faceting, two widening passes,
the machine guns, the standoff cage, reactive bricks, truck wheels, the
triangular prow, larger wheels, and the animation rig.

So `apc_detail.blend` is the authority and the script is its starting point, not
its equivalent. That is a deliberate departure from `art/src/buildings/` and
`art/src/drones/`, where the script *is* the source; a hero asset refined by eye
does not reduce cleanly to a build script, and pretending otherwise would leave a
script that silently disagrees with the asset.

Practical consequence: **edit the `.blend`, not the script**, unless you intend
to regenerate from scratch and redo the refinement.

## The animation rig

- `APC_Root` — an empty carrying a Follow Path constraint against `APC_Path`,
  a 75.06 m S-curve. `offset_factor` is keyframed 0→1 linearly over 250 frames.
  Note `offset` is a *frame* offset unless `use_fixed_location` is set; using it
  by mistake sends the vehicle off in a straight line with its heading frozen.
- `pivot_wheel_*` — eight empties at the wheel centres. Wheel spin is
  θ = distance / radius from the measured arc length: 15.7 revolutions.
- `pivot_turret` — the RWS, coaxial gun and APS radars, sweeping ±42°.

**Why pivots exist.** Every part in this asset stores its position in vertex
coordinates with its object origin at (0, 0, 0), following the convention in
`tools/buildings/kit.py`. Any object-level rotation therefore pivots about the
*world* origin. That scattered the tread blocks twice and flung all eight wheels
off the hull once. Wheel and turret geometry is now expressed **relative** to its
pivot, so the pivot's own rotation is the only transform involved and there is no
captured `matrix_parent_inverse` to go stale when the rig above it changes.

## Rendering

Lit video, about 9.5 s per frame — roughly 40 minutes for 250 frames:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
    art/showcase/apc_detail.blend --render-anim
```

Motion check in about 15 seconds, flat-shaded — use this to verify a path or a
spin rate before spending the lit render:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
    art/showcase/apc_detail.blend --python tools/showcase/preview_anim.py
```
