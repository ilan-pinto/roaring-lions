# Building sprites — pipeline constraints and sourcing

**Date:** 2026-08-06
**Issue:** [#38](https://github.com/ilan-pinto/roaring-lions/issues/38)
**Status:** constraints established by prototype; awaiting a source model

Depth sorting landed first (`6f600db`) because tall building art cannot be
judged until a unit behind a building is correctly occluded. That is done and
verified. This document records what a throwaway generator prototype
established about the rest, so the next attempt starts from it.

## Buildings do not render like vehicles

Three differences, each found by getting it wrong first.

**Shared ortho scale, not fit-to-radius.** `render_vehicle.py` fits each model
to its own bounding radius, which is right for vehicles: every vehicle fills its
frame and the manifest's `scale` sets on-screen size. Applied to buildings it
inverts the result — a 5.2-unit apartment rendered *smaller* than a 1.5-unit
shanty, because each was fitted to its own extent. Buildings must share one
world-units-per-frame constant so relative heights survive.

**Camera aimed at the tile's ground centre, not the model centre.** The renderer
draws sprites with `anchor 0.5` at the tile centre. Centring the frame on a tall
building's mass puts its middle on the tile and buries the footprint. Aim at
`(0, 0, 0)` and let the building rise into the upper half of the frame.

**Walls need ambient light.** The vehicle rig — 55° key, 0.35 fill, black world —
works because a vehicle is mostly horizontal surface. A building is mostly
vertical wall, which that rig leaves nearly black. Buildings need sky ambient.
Note the correction: too much then blows the roofs to white, so this wants
tuning against a mid-tone type, not the extremes.

## Proportions come from the data, not from metres

`data/structures.json` already carries `height_px`, and `TILE_W` is 64. The
ratio is the intended proportion and it is squat:

| type | height_px | of a tile width |
|---|---|---|
| shanty | 11 | 0.17 |
| house | 16 | 0.25 |
| concrete | 20 | 0.31 |
| warehouse | 22 | 0.34 |
| apartment | 30 | 0.47 |
| mosque | 34 | 0.53 |

Inventing heights in metres produced 5:1 towers, which is wrong for vernacular
flat-roof housing and wrong for what the game has always drawn.

## The finding that decides the approach

Six types generated as one parametric shape scaled six ways are **not
distinguishable**. Measured pairwise silhouette IoU at 64px against the art
gate's 0.88 limit:

```
concrete  vs warehouse   0.950   over limit
apartment vs mosque      0.920   over limit
house     vs concrete    0.895   over limit
warehouse vs apartment   0.844
shanty    vs house       0.863
house     vs warehouse   0.855
concrete  vs apartment   0.805
```

Three of fifteen pairs fail outright and four more sit in the 0.80–0.88 band.

This matters beyond the gate. The ROE penalties are the mechanic: flattening a
mosque costs 30 points and an apartment 14, against 3 for a warehouse. A player
who cannot tell them apart cannot make that decision, and GDD §5.8's principle —
the model is shown, not hidden — fails at the first step.

A parametric generator buys consistency for free and distinctness not at all.
Distinctness is the requirement.

## Approach: source one model, kitbash six

ART_PIPELINE §7's recommendation applies directly — *"one building shell yields a
district."* One good Middle-Eastern building or pack, kitbashed into six types,
gives genuine variety while staying consistent because every part descends from
the same hand.

### Licence bar

Art in this repo is **CC BY-SA 4.0**, so a source must permit redistribution
under that:

- **CC0** — fine, no attribution needed
- **CC-BY** — fine with a credit line; `art/src/ifv_dmm08_LICENSE.html` is the
  precedent
- **CC BY-NC / CC BY-ND** — **not usable.** Non-commercial and no-derivatives
  are both incompatible, and they are the most common licences on free 3D sites
- Paid packs, Synty included — not usable regardless of ownership

### Where

- **BlendSwap** filtered to CC0/CC-BY. The proven route: the DMM08 IFV came from
  it with its licence page committed
- **Sketchfab**, *Downloadable* + CC0/CC-BY only. Largest selection of genuine
  mud-brick and flat-roof architecture, and the most likely place to trip over
  CC-BY-NC
- **Poly Haven** — CC0, small but high quality
- **Kenney.nl / Quaternius** — CC0 and safe, but bright low-poly cartoon: right
  geometry, wrong register

### What to look for

The pipeline discards almost everything. Materials are overridden with one flat
palette colour, the render is 256px, the quantizer snaps to a 7-ramp palette, and
the sprite displays at 64px. A photoscanned compound and a box with a parapet
arrive nearly identical.

So optimise for **silhouette**, not detail:

- flat roof with a **parapet** — the single most recognisable feature, and it
  reads at 64px because it breaks the roof edge
- **external stair**, which breaks the boxy outline
- roof clutter — water tank, vents
- slight wall **batter**
- per-type distinguishing mass: a ridge and roller door for the warehouse, dome
  and minaret for the mosque, setbacks and balconies for the apartment, an
  irregular corrugated lean-to for the shanty

### What to avoid, learned from the three vehicles

- **No ground plane and no emitter planes.** The jeep shipped a 153×89 `Ground`
  and an 8×8 `LightSource` directly over the roof; the latter rendered as a grey
  slab and threw the vehicle into shadow
- **Flat hierarchy if possible.** The jeep parented doors and wheels to the body
  and rendered as scattered debris until `render_vehicle.py` learned to
  re-parent only roots
- **Check `resolution_percentage`.** DMM08 shipped 50, which would have silently
  halved every sheet

### Sources are tracked

`art/src/buildings/` is committed in plain git (`64f89e3`). Building shells are
small enough that Git LFS and #28 are not prerequisites, unlike the vehicle
sources.

## Open decision: does the art gate compare buildings to units?

`validate_assets.py` compares every non-`layer` sheet pairwise. Buildings are not
units, and the check exists to keep units distinguishable from each other. Once
buildings enter `assets/sprites/`, either they are excluded the way turret layers
are, or a building will be silhouette-compared against a tank.

Excluding them is probably right — but they must still be distinguishable from
*each other*, so exclusion must not become a way to dodge the measurement above.

## Not yet decided

Multi-tile composition. #38 requires footprints composed from tiles rather than
one sprite per building size, which means a 3-tile apartment is three identical
stamps unless there are edge-aware or random variants. The prototype did not
address this and it changes how much art each type needs.
