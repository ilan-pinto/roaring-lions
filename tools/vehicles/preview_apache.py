"""Preview the AH-64 Peten on the locked rig, over ground, in palette colour.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/preview_apache.py

Writes art/showcase/apache_mock{,_nose,_side,_tail}.png. Does not save the .blend:
the ground plane, the mock camera and these materials are for looking at, not for
shipping, and render_vehicle.py builds its own camera and materials from scratch.

Why the ground is here. The renderer draws an air unit lifted 14 px off its tile
with a shadow on the tile it actually occupies (renderer.ts, AIR_LIFT_PX), and that
gap *is* the altitude cue -- without it an aircraft and a ground vehicle on the same
tile are indistinguishable. So the airframe has to be judged with a cast shadow
under it, which a transparent void cannot show.

The other thing the ground settles is the rotor. Four blades at 9.6 m were chosen
over a solid disc at the true 14.6 m because the disc swallowed the airframe at
sprite size; whether the blades still read once they are throwing a shadow across
pale dirt is the check this preview exists to make.

Derived from preview_technical.py, which shares the rig setup but not the reasoning.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dimetric import ELEVATION as DIM_ELEV  # noqa: E402
from render_rig import build_lights  # noqa: E402

SRC = os.path.abspath("art/src/aircraft/apache.blend")
OUT = os.path.abspath("art/showcase/apache_mock.png")

#: One colour per `rl_role`, every one an entry in data/palette.json. This is the
#: mapping render_vehicle.py needs to grow -- render_team.py and
#: render_building.py already assign per-role materials; vehicles are the only
#: renderer still flattening everything to one olive, which would paint this
#: truck olive and lose the faction read.
PAL = {
    "hull": "#6E7449",    # olive.1 -- KDF vehicle hull
    "plate": "#4E5433",   # olive.2 -- fenders, roof, bonnet
    "metal": "#5C625F",   # gunmetal.2 -- rotor, mast, gun, gear legs
    "rubber": "#23241F",  # shadow.0    -- tyres
    "glass": "#363B39",   # gunmetal.3  -- glazing
    "recess": "#14150F",  # shadow.1    -- the gaps a flat box does not have
}
GROUND = "#E6D8BE"        # limestone.1


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_rgba(hex_colour):
    h = hex_colour.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def material(name, hex_colour, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgba = linear_rgba(hex_colour)
    mat.diffuse_color = rgba
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)

    mats = {
        role: material(f"rl_{role}", col, 0.55 if role in ("glass", "metal") else 0.85)
        for role, col in PAL.items()
    }
    missing = []
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        role = ob.get("rl_role")
        if role not in mats:
            missing.append(f"{ob.name}(rl_role={role!r})")
            continue
        ob.data.materials.clear()
        ob.data.materials.append(mats[role])
    if missing:
        raise SystemExit(f"parts with no usable rl_role: {missing}")

    me = bpy.data.meshes.new("Ground")
    s = 20.0
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    me.update()
    ground = bpy.data.objects.new("Ground", me)
    ground.data.materials.append(material("ground", GROUND, 0.9))
    bpy.context.collection.objects.link(ground)

    build_lights(bpy.context.collection)

    # Framed on the vehicle, so the ground cannot inflate the frame.
    pts = []
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name == "Ground":
            continue
        for v in ob.data.vertices:
            pts.append(ob.matrix_world @ v.co)
    xs = sorted(p.x for p in pts)
    ys = sorted(p.y for p in pts)
    zs = sorted(p.z for p in pts)
    mid = len(pts) // 2
    center = Vector((xs[mid], ys[mid], (zs[0] + zs[-1]) / 2.0))

    cam_data = bpy.data.cameras.new("MockCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 13.2
    cam = bpy.data.objects.new("MockCam", cam_data)
    bpy.context.collection.objects.link(cam)
    az = math.radians(225.0)
    dist = 30.0
    horiz = math.cos(DIM_ELEV) * dist
    cam.location = (
        center.x + horiz * math.cos(az),
        center.y + horiz * math.sin(az),
        center.z + math.sin(DIM_ELEV) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIM_ELEV, 0.0, az + math.pi / 2)

    sc = bpy.context.scene
    sc.camera = cam
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 900
    sc.render.resolution_y = 640
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    if hasattr(sc.render.image_settings, "media_type"):
        sc.render.image_settings.media_type = "IMAGE"
    sc.render.image_settings.file_format = "PNG"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    # Three facings, by rotating the model under a fixed camera and light -- which
    # is what the game does. Rotating the *camera* instead would move the key light
    # relative to the body and show a truck that never appears in play.
    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)
    for ob in list(bpy.data.objects):
        if ob.type != "MESH" or ob.name == "Ground" or ob.parent is not None:
            continue
        ob.parent = pivot
        ob.matrix_parent_inverse = Matrix.Translation(-center)

    written = []
    for label, frame in (("nose", 6), ("side", 10), ("tail", 14)):
        pivot.rotation_euler.z = frame * 2.0 * math.pi / 16.0
        path = OUT.replace(".png", f"_{label}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)
    pivot.rotation_euler.z = 0.0
    sc.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    written.append(OUT)

    print(f"extent L {xs[-1] - xs[0]:.3f}  W {ys[-1] - ys[0]:.3f}  H {zs[-1] - zs[0]:.3f}")
    for p in written:
        print(f"wrote {p}")


if __name__ == "__main__":
    main()
