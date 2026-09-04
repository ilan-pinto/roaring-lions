#!/usr/bin/env python3
"""
Roaring Lions -- character portrait render (UI art, not a unit sprite).

This is deliberately a *separate* script from tools/render_rig.py. That rig's
locked orthographic dimetric camera (26.565 deg elevation, azimuth 225, object
rotates / camera fixed) exists to seat sixteen facings on a tile grid -- it has
no notion of a face, a chest, or a three-quarter turn, and bending it into one
would be worse than starting clean.

Usage (headless -- the .blend is opened by Blender itself, this script is not
asked to import or link anything):

    blender -b "art/blend/KDF/Shai Hammi/Meshy_AI_shai_hammai_remeshed_0904094353_texture.blend" \
        --python tools/render_portrait.py -- \
        --out assets/ui/portraits/shai_hammai.png \
        --height 1.78 --yaw 35 --size 512x640

Geometry, not eyeballing:

  * The figure is scaled uniformly so its Z extent equals --height metres, and
    repositioned so its feet sit at world Z=0 and it is centred on X=0/Y=0.
    Scale is a derived factor (target height / measured mesh height), never a
    hand-typed number -- the same discipline render_rig.py's manifest scale
    uses, for the same reason.
  * "Front" (the direction the figure's chest/face points) is not assumed --
    it was measured for this asset by rendering the mesh from all four
    cardinal directions and reading which one shows the face. For this export
    that is -Y. FRONT_XY below carries that measurement; it is specific to
    this Meshy export's convention and would need re-checking, not copying,
    for a different figure.
  * Camera: 50 mm lens, VERTICAL sensor fit (sensor height fixed at 24 mm, the
    classic "50 mm on full frame" ~27 deg vertical FOV) so the vertical framing
    is independent of the 512x640 aspect ratio. Camera height = eye height
    (0.93 x figure height). Camera azimuth = straight-in-front, rotated by
    --yaw degrees toward camera-left (-X, given FRONT_XY) -- the "three-quarter
    from camera-left" the art doc asks for.
  * Aim point ("aimed at the sternum") is the vertical midpoint of the desired
    chest-up crop (roughly 55% of height to just above the head), which lands
    at ~0.80 of height -- close to the ~0.81 anthropometric sternum height,
    which is not a coincidence: a centred chest-up crop naturally centres near
    the sternum.
  * Camera distance is chosen to satisfy TWO constraints -- the vertical crop
    span (55% of height to head-top + headroom) through the lens's vertical
    FOV, and the horizontal span of whatever the mesh actually does in that
    z-band (shoulders, a raised hand, a held map) through the lens's
    horizontal FOV, so the frame is picked from the geometry, not asserted.
    Whichever needs more distance wins; the other axis ends up with a little
    extra headroom rather than clipping.

Key invariants -- do not "improve" these without checking the art doc first:

  * View transform is Standard, not Filmic/AgX. The material's base colour is
    an already-graded sRGB photograph (a Meshy bake); a display transform
    would re-grade a value that is not scene-linear HDR in the first place and
    flattens it.
  * Film transparent ON, RGBA output. The UI supplies the backdrop.
  * The material is untouched. No node is added, removed or rewired, and no
    colour is repainted -- this is UI art, outside the four palette gates
    (docs/ASSET_PROVENANCE.md: no gate on assets/ui), and the brief is
    explicit that the bake ships "unlit or lightly lit", not re-authored.
  * Lighting is a two-light portrait rig (soft key from camera-left, weak fill
    from camera-right, no rim) built in code, same reasoning as
    dimetric.build_lights: consistency by construction, not by eyeballing.
  * Never mathutils.noise. Nothing here uses it, but if a future revision
    reaches for procedural variation, hand-rolled vnoise/fbm only -- Blender
    5.2 reseeds mathutils.noise per process.
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

# --- locked portrait-rig constants ----------------------------------------

# Measured (not assumed) for this export: rendering the mesh from +X, -X, +Y
# and -Y and reading which view shows the face found the front at -Y.
FRONT_XY = Vector((0.0, -1.0))

LENS_MM          = 50.0
SENSOR_HEIGHT_MM = 24.0     # full-frame convention; fixes vertical FOV.
EYE_FRAC         = 0.93     # eye height as a fraction of figure height.
CROP_BOTTOM_FRAC = 0.55     # bottom of the chest-up crop, fraction of height.
HEAD_MARGIN_FRAC = 0.05     # headroom above the crown, fraction of height.
HORIZ_MARGIN     = 1.08     # safety margin on the measured shoulder/prop width.

KEY_ENERGY  = 220.0   # W, Blender area-light power.
KEY_SIZE    = 1.4     # m, square area light.
KEY_COLOR   = (1.0, 0.95, 0.88)   # warm-neutral.
FILL_ENERGY = 55.0     # W -- roughly a quarter of the key, "weak fill".
FILL_SIZE   = 1.2
FILL_COLOR  = (0.92, 0.95, 1.0)   # slightly cool, unobtrusive.

WORLD_COLOR = (0.0, 0.0, 0.0, 1.0)
SAMPLES     = 64


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True, help="output PNG path")
    p.add_argument("--height", type=float, default=1.78, help="figure height, metres")
    p.add_argument("--yaw", type=float, default=35.0, help="azimuth off dead-front, degrees, toward camera-left")
    p.add_argument("--size", default="512x640", help="WxH pixels")
    p.add_argument("--samples", type=int, default=SAMPLES)
    return p.parse_args(argv)


def find_root():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        sys.exit("ERROR: no mesh object in the opened .blend")
    if len(meshes) > 1:
        print(f"WARN: {len(meshes)} mesh objects found, using the first: {meshes[0].name}")
    return meshes[0]


def world_bounds(obj):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    mw = obj.matrix_world
    for corner in obj.bound_box:
        p = mw @ Vector(corner)
        lo = Vector(map(min, lo, p))
        hi = Vector(map(max, hi, p))
    return lo, hi


def scale_and_ground(obj, target_height):
    """Uniformly scale to target_height (Z extent), feet at Z=0, centred on X/Y=0."""
    lo, hi = world_bounds(obj)
    measured_height = hi.z - lo.z
    factor = target_height / measured_height
    cx = (lo.x + hi.x) * 0.5
    cy = (lo.y + hi.y) * 0.5

    obj.scale = (factor, factor, factor)
    obj.location = (
        -cx * factor,
        -cy * factor,
        -lo.z * factor,
    )
    bpy.context.view_layer.update()
    return factor, measured_height


def crop_band_extent(obj, z_cutoff_world):
    """Max XY radius from the (0,0) vertical axis, among vertices at or above
    z_cutoff_world, in the object's CURRENT (already scaled+positioned) world
    transform. Uses the evaluated mesh so any modifiers are accounted for."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    mw = obj.matrix_world
    max_r = 0.0
    n = 0
    for v in me.vertices:
        p = mw @ v.co
        if p.z >= z_cutoff_world:
            n += 1
            r = math.hypot(p.x, p.y)
            if r > max_r:
                max_r = r
    ev.to_mesh_clear()
    if n == 0:
        sys.exit(f"ERROR: no vertices at or above z={z_cutoff_world} -- crop band is empty")
    return max_r


def build_world():
    world = bpy.data.worlds.new("portrait_world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = WORLD_COLOR
    bg.inputs[1].default_value = 0.0
    bpy.context.scene.world = world


def build_scene(size_x, size_y, samples):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size_x
    scene.render.resolution_y = size_y
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.eevee.taa_render_samples = samples
    # The bake is already a graded sRGB photograph. Filmic/AgX would apply a
    # second, unwanted display transform on top of it and flatten it.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    build_world()


def add_area_light(name, energy, size, color, location, target):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def build_camera(height, yaw_deg):
    """Returns (camera, geometry-report-dict)."""
    eye_z = EYE_FRAC * height
    crop_bottom_z = CROP_BOTTOM_FRAC * height
    head_top_z = height  # by construction: scale_and_ground puts the crown at Z=height.
    frame_top_z = head_top_z + HEAD_MARGIN_FRAC * height
    aim_z = (crop_bottom_z + frame_top_z) * 0.5
    vertical_span = frame_top_z - crop_bottom_z

    vfov = 2.0 * math.atan(SENSOR_HEIGHT_MM / (2.0 * LENS_MM))
    aspect = bpy.context.scene.render.resolution_x / bpy.context.scene.render.resolution_y
    hfov = 2.0 * math.atan((SENSOR_HEIGHT_MM * aspect) / (2.0 * LENS_MM))

    root = find_root()
    diameter = 2.0 * crop_band_extent(root, crop_bottom_z)

    dist_for_vertical = vertical_span / (2.0 * math.tan(vfov / 2.0))
    dist_for_horizontal = (diameter * HORIZ_MARGIN) / (2.0 * math.tan(hfov / 2.0))
    distance = max(dist_for_vertical, dist_for_horizontal)

    yaw = math.radians(yaw_deg)
    # Rotate FRONT_XY by -yaw about +Z: swings the camera's stand-point toward
    # -X (camera-left, given a figure that faces -Y). See module docstring.
    dir_x = -math.sin(yaw)
    dir_y = -math.cos(yaw)

    dz = eye_z - aim_z
    horiz_dist_sq = distance * distance - dz * dz
    if horiz_dist_sq <= 0:
        sys.exit("ERROR: eye/sternum height gap exceeds camera distance -- yaw or height is degenerate")
    horiz_dist = math.sqrt(horiz_dist_sq)

    cam_pos = Vector((dir_x * horiz_dist, dir_y * horiz_dist, eye_z))
    aim_pos = Vector((0.0, 0.0, aim_z))

    cam_data = bpy.data.cameras.new("portrait_cam")
    cam_data.type = "PERSP"
    cam_data.lens = LENS_MM
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = SENSOR_HEIGHT_MM
    cam = bpy.data.objects.new("portrait_cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = cam_pos
    direction = aim_pos - cam_pos
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam

    report = {
        "eye_z": eye_z,
        "aim_z": aim_z,
        "aim_frac_of_height": aim_z / height,
        "crop_bottom_z": crop_bottom_z,
        "crop_bottom_frac": crop_bottom_z / height,
        "frame_top_z": frame_top_z,
        "frame_top_frac": frame_top_z / height,
        "vertical_span": vertical_span,
        "diameter": diameter,
        "vfov_deg": math.degrees(vfov),
        "hfov_deg": math.degrees(hfov),
        "dist_for_vertical": dist_for_vertical,
        "dist_for_horizontal": dist_for_horizontal,
        "distance": distance,
        "cam_pos": tuple(cam_pos),
        "aim_pos": tuple(aim_pos),
    }

    # Portrait 2-light rig: soft key from camera-left/above, weak fill from
    # camera-right, no rim. Positioned relative to the aim point, on the same
    # (key) / opposite (fill) side as the camera's own azimuth offset.
    key_yaw = yaw + math.radians(25.0)   # a bit wider than the camera itself.
    key_dir = Vector((-math.sin(key_yaw), -math.cos(key_yaw)))
    key_pos = aim_pos + Vector((key_dir.x * 1.4, key_dir.y * 1.4, 1.0))
    add_area_light("key", KEY_ENERGY, KEY_SIZE, KEY_COLOR, key_pos, aim_pos)

    fill_yaw = -math.radians(30.0)
    fill_dir = Vector((-math.sin(fill_yaw), -math.cos(fill_yaw)))
    fill_pos = aim_pos + Vector((fill_dir.x * 1.6, fill_dir.y * 1.6, 0.3))
    add_area_light("fill", FILL_ENERGY, FILL_SIZE, FILL_COLOR, fill_pos, aim_pos)

    return cam, report


def main():
    args = parse_args()
    size_x, size_y = (int(v) for v in args.size.lower().split("x"))

    build_scene(size_x, size_y, args.samples)

    root = find_root()
    factor, measured_height = scale_and_ground(root, args.height)

    cam, report = build_camera(args.height, args.yaw)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bpy.context.scene.render.filepath = os.path.abspath(args.out)
    bpy.ops.render.render(write_still=True)

    print("OK: portrait rendered ->", args.out)
    print(f"  measured mesh height : {measured_height:.4f} m")
    print(f"  scale factor          : {factor:.4f}  (target {args.height} m)")
    print(f"  eye height            : {report['eye_z']:.4f} m ({EYE_FRAC} x height)")
    print(f"  aim (sternum) height  : {report['aim_z']:.4f} m ({report['aim_frac_of_height']:.3f} x height)")
    print(f"  crop bottom           : {report['crop_bottom_z']:.4f} m ({report['crop_bottom_frac']:.3f} x height)")
    print(f"  frame top             : {report['frame_top_z']:.4f} m ({report['frame_top_frac']:.3f} x height)")
    print(f"  vertical span         : {report['vertical_span']:.4f} m")
    print(f"  measured diameter     : {report['diameter']:.4f} m (crop-band worst-case XY radius x2)")
    print(f"  lens / sensor height  : {LENS_MM} mm / {SENSOR_HEIGHT_MM} mm")
    print(f"  vfov / hfov           : {report['vfov_deg']:.3f} / {report['hfov_deg']:.3f} deg")
    print(f"  distance for vertical : {report['dist_for_vertical']:.4f} m")
    print(f"  distance for horiz    : {report['dist_for_horizontal']:.4f} m")
    print(f"  chosen distance       : {report['distance']:.4f} m")
    print(f"  camera position       : {report['cam_pos']}")
    print(f"  aim point             : {report['aim_pos']}")
    print(f"  yaw                   : {args.yaw} deg off dead-front, toward camera-left")
    print(f"  samples               : {args.samples}")


if __name__ == "__main__":
    main()
