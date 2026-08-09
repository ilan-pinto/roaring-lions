"""The one place the render camera's geometry is defined.

Six render scripts each carried their own `DIMETRIC_ELEVATION = math.atan(0.5)`,
and all six were wrong. `render_rig.py` called it "the exact" 2:1 elevation, so
the error had a comment defending it.

For an orthographic camera at azimuth 225 degrees, a ground square projects with
height/width = sin(elevation). The renderer draws with

    isoX = (x - y) * TILE_W / 2      isoY = (x + y) * TILE_H / 2

so the grid needs TILE_H / TILE_W = 32 / 64 = 0.5, and therefore
sin(elevation) = 0.5, elevation = 30 degrees. atan(0.5) is 26.565 degrees, whose
sine is 0.4472 -- every sprite rendered with it sits on a ground plane 10% too
shallow for the tiles it is drawn on.

Measured, by rendering a unit ground square at both angles:

    atan(0.5) = 26.565 deg   ground square 360x162 px   height/width = 0.4500
                30.000 deg   ground square 360x180 px   height/width = 0.5000

Invisible on a unit, which is small and not grid-aligned. Not invisible on a
building, whose base *is* a tile diamond.

It also holds the sun, for the same reason. Three render scripts each carried
their own copy of azimuth 135 / altitude 55 / key 4.0 / fill 0.35. Those three
copies happen to agree today, which is exactly the state the elevation was in
before it turned out to be wrong everywhere at once.

This module imports nothing from bpy at module level, so it is importable outside
Blender and its arithmetic is testable -- see tools/test_dimetric.py.
`build_lights` imports bpy when called, which keeps that property.
"""
import math

# Must match packages/render/src/renderer.ts.
TILE_W = 64
TILE_H = 32

#: Screen foreshortening of the tile grid. The whole projection follows from it.
TILE_ASPECT = TILE_H / TILE_W

#: Camera elevation above the horizon. 30 degrees, derived not chosen.
ELEVATION = math.asin(TILE_ASPECT)

#: Camera azimuth. 225 degrees puts +x to screen-right and +y to screen-left,
#: which is what isoX's (x - y) expects.
AZIMUTH = math.radians(225)

#: World units per map tile. The mosque set it: its `Hall` is 9.0 units across a
#: 3-tile footprint. One unit is about a metre, so a storey is about 3.
UNITS_PER_TILE = 3.0

#: Sun and fill, shared by every unit render. Near-noon hard key, cool sky fill.
#:
#: The key must not move with the object: rotating the camera or the light as a
#: unit turns is the classic sprite-pipeline mistake, and it makes cast shadows
#: swing around the roster for no visible reason. The object rotates; these do
#: not.
SUN_AZIMUTH = math.radians(135.0)
SUN_ALTITUDE = math.radians(55.0)
SUN_STRENGTH = 4.0
SUN_ANGLE = math.radians(1.5)  # slightly soft contact shadows
FILL_STRENGTH = 0.35
FILL_COLOR = (0.66, 0.77, 0.82)
FILL_ANGLE = math.radians(60.0)
FILL_ALTITUDE = math.radians(35.0)

#: How much larger than life each class of unit draws.
#:
#: Literal scale is not available. UNITS_PER_TILE fixes a tile at three metres,
#: which makes a 7.6m MBT cover 2.5 tiles and draw wider than the mosque, and a
#: 0.5m quadcopter about fifteen pixels across. The two ends of a 15x size range
#: cannot both be readable under one linear scale, so every RTS compresses --
#: render_drone.py was already doing it privately, in a comment reading "literal
#: scale would be about 0.37".
#:
#: The point of this table is not that these numbers are true. It is that the
#: compression is declared once, here, instead of living as five unrelated
#: hand-typed manifest constants that nothing relates.
#:
#: Calibrated by measuring opaque bounding boxes in the rendered sheets, not by
#: eye. **A multiplier of 1.00 is exactly life size**, which is worth stating
#: because it was not obvious in advance: a length L metres presented along the
#: screen-horizontal diagonal spans L / 4.24 * TILE_W px, since one diagonal tile
#: step covers sqrt(2 * 3^2) = 4.24 m of ground and 64 px of screen. Measured on
#: the Namer, 7.5 m lands at 117 px against a predicted 113.
#:
#: So three of the four classes are 1.00, and that is the finding rather than a
#: placeholder. Life size is self-consistent with the buildings for free, because
#: both derive from UNITS_PER_TILE. Against the sheets it replaces:
#:
#:     INF          -11%      NAMER_HULL   +32%
#:     JEEP_HULL    +66%      EITAN_HULL   +87%
#:     TNK_HULL     +21%      DRONE_RECON  -18%
#:
#: The spread is the point. The old roster was not uniformly mis-scaled, it was
#: mis-scaled *inconsistently* -- the jeep and Eitan drew far too small next to
#: the tank and Namer, which no amount of tuning one sheet at a time would have
#: surfaced.
#:
#: `air` is the one real exception, and it has an anchor rather than a taste:
#: **an air unit must be at least as clickable as a soldier.** At life size the
#: recon drone is 17.2 px wide, against infantry's 25.7; 1.5 puts it at 25.8.
#: Tracking that drone is the whole of one mission, so a unit the player cannot
#: hit is a mechanical failure and not a cosmetic one.
#:
#: Infantry deliberately stays at 1.00 even though a single 1.8 m figure stands
#: in for an eight-crew squad. Spec D turns those into multi-figure teams, so the
#: extra footprint should come from adding figures rather than from inflating one
#: -- content, not a fudge.
SIZE_CLASS = {
    "infantry": 1.00,
    "light_vehicle": 1.00,
    "heavy_vehicle": 1.00,
    "air": 1.50,
}


def metres_per_unit(measured_extent, real_metres):
    """How many metres one of a model's own units is worth.

    Nothing in the pipeline related a model to real size before this:
    `render_vehicle.py` used a model's own units only to compute a bounding
    radius, and the hand-typed manifest `scale` beside it had no relationship to
    the model's size at all. So downloaded geometry is in arbitrary units, and a
    derived scale means nothing until it has been converted.

    `real_metres` is the unit's longest dimension on any axis, so a standing
    figure is declared by height and a tank by length.

    This is a unit conversion, not a transform: the geometry is left alone and
    only the frame measurement is converted. Scaling the model instead would
    move every vertex and the camera with it, and the rendered pixels would
    change for a reason that has nothing to do with scale. Framing is the only
    thing this spec should be able to move.
    """
    if measured_extent <= 0.0:
        raise ValueError("measured_extent must be positive")
    return real_metres / measured_extent


def unit_scale(ortho_scale_metres, size_class, units_per_tile=UNITS_PER_TILE):
    """The manifest `scale` a unit needs: canvas width in tiles, then compressed.

    `ortho_scale_metres` is the frame in metres -- convert with
    `metres_per_unit` first if the model is in its own units.
    """
    if size_class not in SIZE_CLASS:
        raise KeyError(f"unknown size class {size_class!r}; have {sorted(SIZE_CLASS)}")
    return tiles_across(ortho_scale_metres, units_per_tile) * SIZE_CLASS[size_class]


def build_lights(collection):
    """Link the locked key and fill into `collection`.

    bpy is imported here rather than at module level so this file stays
    importable, and testable, outside Blender.
    """
    import bpy  # noqa: PLC0415 -- see docstring

    key_data = bpy.data.lights.new("KEY", type="SUN")
    key_data.energy = SUN_STRENGTH
    key_data.angle = SUN_ANGLE
    key = bpy.data.objects.new("KEY", key_data)
    collection.objects.link(key)
    key.rotation_euler = (math.pi / 2 - SUN_ALTITUDE, 0.0, SUN_AZIMUTH)

    fill_data = bpy.data.lights.new("FILL", type="SUN")
    fill_data.energy = FILL_STRENGTH
    fill_data.color = FILL_COLOR
    fill_data.angle = FILL_ANGLE
    fill = bpy.data.objects.new("FILL", fill_data)
    collection.objects.link(fill)
    fill.rotation_euler = (FILL_ALTITUDE, 0.0, SUN_AZIMUTH + math.pi)

    return key, fill


def facing_offset(facings=16):
    """Frames between a rig frame index and the bearing the game draws it at.

    Measured, then derived, after nine infantry sheets shipped facing 270 degrees
    away from their targets.

    The rig and the game disagree about which way is up. `camera_uv` returns v
    pointing **up**, and a PNG's row 0 is its top, so a larger v is a smaller row.
    The renderer's `isoY = (x + y) * TILE_H / 2` grows **downward**. Both agree on
    the horizontal, since u and isoX are both proportional to (x - y).

    So image-space and game-space are reflected in the vertical axis, which maps a
    bearing theta to 270 - theta. `facingReverse` already supplies the theta ->
    -theta half of that, so what remains is a constant +270 degrees -- three
    quarters of a turn, or 12 of 16 frames.

    Confirmed by rendering a single rod along +x through the rig and reading its
    tip back through the renderer's own projection: reverse plus offset 12 fits at
    3.4 degrees mean error against the 22.5 degree frame quantum, where offset 0
    is out by 87.

    This is the *rig's* share of the offset. A model whose own forward is not +x
    needs its own axis folded in on top -- which is what the per-vehicle
    `facing_offset` in render_vehicle.py exists for, and why TNK carries 5.
    """
    return 3 * facings // 4


def tiles_across(ortho_scale, units_per_tile=UNITS_PER_TILE):
    """The manifest `scale` a building needs: its canvas width in map tiles.

    `render_building.py` frames each building to fit its own geometry, so
    on-screen size would otherwise depend on how big the model happens to be.
    This solves "UNITS_PER_TILE world units must draw as one tile" for the
    manifest field.

    A footprint spanning W x H world units projects to (W + H) / sqrt(2) units
    across the camera's horizontal axis, and must land on (W + H) / (2 * U) tiles
    of screen width. Both sides carry (W + H), so it cancels and the answer
    depends only on the frame:

        scale = ortho_scale * sqrt(2) / (2 * U)

    The useful consequence: `scale` rises with `ortho_scale`, so widening the
    frame to stop a dome being clipped costs empty canvas but does not change the
    building's size on the map. That is what lets the frame be driven by whatever
    the geometry needs rather than by a tuned margin.
    """
    return ortho_scale * math.sqrt(2) / (2 * units_per_tile)


def camera_uv(x, y, z, elevation=ELEVATION):
    """A world point in camera-plane coordinates, relative to the aim point.

    `u` is screen-horizontal, `v` screen-vertical, both in world units. Derived
    from the camera basis at azimuth 225 degrees: right = (1, -1, 0) / sqrt(2),
    up = (sin e, sin e, cos e) / (1, 1, 1) normalised the same way.

    Used to size the frame before a camera exists, so the render never has to
    guess whether a dome will fit.
    """
    root2 = math.sqrt(2)
    u = (x - y) / root2
    v = (x + y) / root2 * math.sin(elevation) + z * math.cos(elevation)
    return u, v


def ortho_scale_for(points, margin, aim=(0.0, 0.0, 0.0)):
    """The smallest square frame holding `points`, centred on the aim point.

    The aim point must stay at the canvas centre -- `drawStructureSprite` anchors
    a structure sprite at 0.5 on its footprint centre, so any offset would put the
    building off the tiles it occupies. That makes the frame's half-width the
    largest absolute u or v, not the extent of the geometry.

    Sizing on horizontal extent alone is what broke the first attempt: a
    two-storey house is much taller in v than it is wide in u, and its merlons
    ran 4.5px off the top of the canvas.
    """
    ax, ay, az = aim
    reach = 0.0
    for x, y, z in points:
        u, v = camera_uv(x - ax, y - ay, z - az)
        reach = max(reach, abs(u), abs(v))
    return 2.0 * reach * margin


def ortho_scale_for_turning(points, margin, aim=(0.0, 0.0, 0.0), z_pad=0.0, elevation=ELEVATION):
    """The smallest square frame holding `points` at *every* facing.

    A building never turns, so `ortho_scale_for` sizes its frame from one
    orientation. A unit turns through 16 of them, and a hull is not square: a
    7.6m tank reaches 7.6m across the frame at one facing and about 3.5m at
    another. Framing one orientation would crop the others.

    `render_vehicle.py` used a bounding sphere, which is rotation-invariant by
    construction but wastes most of the frame -- a sphere around a tank is mostly
    empty corner, and that emptiness is why the hand-typed manifest scales had to
    exist.

    Solved rather than sampled. Rotating a point at horizontal radius r and
    bearing phi by theta about z gives

        u = r * cos(phi + theta + 45deg)
        v = r * sin(phi + theta + 45deg) * sin(e) + z * cos(e)

    so over all theta, max|u| is exactly r, and max|v| is bounded by
    r * sin(e) + |z| * cos(e). Both are O(N) in the points and need no sampling
    over facings.

    `z_pad` is vertical travel the clip will add -- a bobbing drone would
    otherwise walk out of a frame fitted to its rest height.
    """
    ax, ay, az = aim
    sin_e = math.sin(elevation)
    cos_e = math.cos(elevation)
    reach_u = 0.0
    reach_v = 0.0
    for x, y, z in points:
        dx, dy, dz = x - ax, y - ay, z - az
        r = math.hypot(dx, dy)
        reach_u = max(reach_u, r)
        reach_v = max(reach_v, r * sin_e + abs(dz) * cos_e)
    return 2.0 * (max(reach_u, reach_v + z_pad)) * margin


def badge_top_px(opaque_top_row, size, scale, tile_w=TILE_W):
    """Display px from the sprite's anchor up to the top of its opaque art.

    The renderer used to place a structure's integrity bar and garrison pips at
    `heightPx` above the footprint centre, but `heightPx` belongs to the
    procedural extrusion -- 34 for the mosque, whose sprite draws far taller. The
    badge landed 67px inside the dome, which hides the pips that tell a player
    whether a house is held.

    With FRAME_SHIFT_Y at 0 the camera aims at the footprint's ground centre, so
    the canvas centre is the anchor and this is a straight proportion.
    """
    return (0.5 - opaque_top_row / size) * (scale * tile_w)


def framing_clearance(top, left, bottom, right, size):
    """Smallest gap in px between the opaque bounding box and any canvas edge.

    `validate_assets.check_framing` rejects art touching an edge, which catches a
    cropped sprite at the gate. The render script should catch it at the render:
    the mosque clears its frame by 2px, so the margin that produced it has no
    room for anything taller.
    """
    return min(top, left, size - 1 - bottom, size - 1 - right)
