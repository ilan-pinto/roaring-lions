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

This module imports nothing from bpy, so it is importable outside Blender and
its arithmetic is testable -- see tools/test_dimetric.py.
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
