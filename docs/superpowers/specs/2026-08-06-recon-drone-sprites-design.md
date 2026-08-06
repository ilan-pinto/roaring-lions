# Recon drone sprites — a modelled-in-repo unit, and the first animated vehicle

**Date:** 2026-08-06
**Status:** approved, ready to implement
**Branch:** `feat/art-recon-drone`

`recon_drone` has existed as data since the unit roster landed. It is deployed
in `beit_sahwan_1_recon` — the mission whose briefing tells the player to push
the drone east and identify six garrison positions — and it has never had a
sprite. It draws as the procedural silhouette, which is the fallback for a unit
nobody has made art for yet.

This is the first unit whose source model is authored in this repository rather
than downloaded, and the first vehicle sheet with more than one frame per
facing.

## The model is ours, which fixes the licence problem for once

Every existing source in `art/src/` carries the same warning: the tank, the
Namer, the Eitan and the jeep are all marked **LICENCE UNVERIFIED**, downloaded
without terms, readme or attribution. `CONTRIBUTING.md` requires assets in this
repository to permit redistribution, so all four are technically unshippable
until someone establishes their terms.

A drone is simple enough to model from primitives, so this one is authored
directly and is cleanly **CC BY-SA 4.0** like the rest of the repo's art. The
source is tracked in plain git next to the buildings — a primitives-built
airframe is small, and the `.gitignore` rule that excludes vehicle sources is
about file size, not about category.

## Authoring is non-destructive to the live Blender session

The model is built through the Blender MCP in the running instance rather than
by a headless generator script. That instance had `mosque.blend` open with
unsaved changes, so the build must not touch the open file:

- objects are created in a **new scene** (`bpy.data.scenes.new`), never in the
  scene the user is working in;
- the result is written with `bpy.data.libraries.write()`, which produces a new
  `.blend` **without changing what the session has open** — unlike
  `wm.save_as_mainfile`, which would switch the open file out from under the
  user;
- the temporary scene and its datablocks are removed afterwards.

`wm.open_mainfile` and `wm.save_mainfile` are both unsafe here and are not used.

## Shape is dictated by the fill gate, not by realism

`validate_assets.py` enforces `MIN_FILL = 0.06`: a silhouette must occupy at
least 6% of its frame at 64px or it is rejected as unreadable at gameplay zoom.
A quadrotor is mostly empty space between four thin arms, which makes this the
binding constraint on the whole asset — more than palette, more than IoU.

So the airframe is deliberately chunkier than a real drone:

| part | why it is there |
|---|---|
| fuselage, ~0.55m, rounded | the mass that carries the fill |
| gimbal sensor ball, slung underneath | the identity feature — this is what says *recon* rather than *attack* |
| four arms in an X | thick enough to survive as more than one pixel |
| four 2-blade props | see below |
| two skids | breaks the bottom line, reads as an aircraft |
| antenna mast | breaks the top line, helps IoU against every ground unit |

Props are modelled as **blades, not discs**. A disc is rotationally symmetric,
so a spinning one is pixel-identical in every frame and the animation would
read as frozen. Blades change orientation visibly.

Binary alpha (the gate rejects anything else) also rules out the obvious trick
of a translucent rotor blur disc: it would quantize to either fully opaque or
gone.

## The animation: hover bob carries it, rotor spin garnishes it

Four frames, 8 fps, looping, on the `idle` clip. Per frame *k*:

- **bob** — `z += 0.09 · sin(2πk/4)`. The whole airframe rises and falls.
- **spin** — each prop yaws 45°, counter-rotating in pairs.

The bob is doing the real work. At 40–80px the rotors are about three pixels
and whatever happens to them is nearly invisible, whereas the entire silhouette
translating vertically reads clearly. This is the same conclusion
`ART_PIPELINE.md` §0 reaches about model quality in general: motion and
lighting are legible at gameplay zoom, detail is not.

45° per frame closes the loop exactly. A 2-blade prop is 180°-symmetric, so four
45° steps is one full apparent revolution and frame 3 → frame 0 is seamless.

Camera radius is computed with the bob extremes included, so no frame clips its
edge and trips `check_framing`.

### Only `idle` is authored, and that is the correct clip set

`resolveClip` returns `move` for anything with measured speed, but
`clipOrFallback` resolves a missing clip back to `idle` — so a drone in transit
plays the hover loop. For a multirotor that is not a compromise: hovering is
what it does whether or not it is translating.

`wreck` is skipped for the same kind of reason. `renderer.ts:686` keeps the old
cross marker for unit types with no wreck art, and a downed drone is a
scattering of debris rather than a recognisable burnt-out hull. If wreckage is
wanted later it is 16 extra frames and no new machinery.

## The renderer has to learn about frames

`render_vehicle.render_clip` writes exactly one file per facing, hardcoded to
`_000.png` and `"frame": 0`. The drone needs 16 facings × 4 frames = 64.

`render_clip` gains a frame count and a per-frame pose callback. Existing
callers pass nothing and keep single-frame behaviour byte-identical — the
committed tank, Eitan, Namer and jeep sheets must not shift, and that is
verified by re-rendering nothing and diffing nothing, i.e. by leaving their
scripts untouched and confirming the default path is unchanged.

Sheet layout stays exactly what the manifest parser already expects:
`assets/sprites/DRONE_RECON/idle_f<facing>_<frame>.png`.

## Definition of done

1. `art/src/drones/recon_drone.blend` committed, tracked, licence clean
2. `tools/render_drone.py` renders 64 frames headlessly and reproducibly
3. Quantized, and `pnpm validate:assets` passes — fill, palette, alpha,
   silhouette IoU
4. `recon_drone` wired into `SPRITE_MAP` in `packages/app/src/main.ts`
5. Verified **in the running game**, not by console shortcut: the drone in
   `beit_sahwan_1_recon` draws as a drone and visibly bobs

## Risks

**Fill is the one that can fail.** If the X-shape lands under 6%, the fix is a
larger fuselage and tighter framing. Measure on the first facing before
committing to 64 renders.

**IoU is expected to be comfortable.** An X-shape with an antenna mast has no
near neighbour among tanks, APCs, a jeep and foot troops, but it is checked, not
assumed.
