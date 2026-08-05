"""Render the Eitan APC as separate hull and turret sprite sheets.

  - Hull pass:   everything except the weapon station
  - Turret pass: turret, gun and mantlet only

Both passes share one pivot and one camera, so the turret sprite registers
exactly over the hull sprite as it traverses. Widening one without the other
would make the weapon station drift off-centre.

Output:
  assets/sprites/EITAN_HULL/idle_f{facing}_000.png    (16 facings)
  assets/sprites/EITAN_HULL/wreck_f{facing}_000.png   (16 facings)
  assets/sprites/EITAN_TURR/idle_f{facing}_000.png    (16 facings)

Cycles output is not on-palette and has soft alpha, so this must be followed
by the quantizer or `pnpm validate:assets` will reject every frame:

    blender --background --python tools/render_eitan.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/LPMAC_military_truck.blend (gitignored -- .blend sources are
too large to track; see .gitignore)
LICENCE UNVERIFIED -- downloaded without licence, readme or attribution.
Do not redistribute until the terms are established.
"""
import json
import math
import os

import bpy
from mathutils import Matrix, Vector

SRC = os.path.abspath("art/src/LPMAC_military_truck.blend")
OUT_HULL = os.path.abspath("assets/sprites/EITAN_HULL")
OUT_TURR = os.path.abspath("assets/sprites/EITAN_TURR")

SIZE = 256
FACINGS = 16
SAMPLES = 64
DIMETRIC_ELEVATION = math.atan(0.5)

# How many tiles wide the sprite draws. The tank is 1.8; an Eitan is a little
# shorter than a Merkava.
SCALE = 1.6

CREDIT = "LPMAC military truck. LICENCE UNVERIFIED, see tools/render_eitan.py"

# The traversing weapon station. Everything else is hull.
TURRET_MESHES = {"turret high", "gun high", "turret mantlet high"}

# Studio backdrop, 134 units long. Rendering it fills the entire frame.
BACKDROP_PREFIX = "Plane"


def scene_meshes():
    """Real vehicle meshes -- backdrop planes excluded."""
    return [
        o
        for o in bpy.data.objects
        if o.type == "MESH" and not o.name.startswith(BACKDROP_PREFIX)
    ]


def flat_material():
    """One flat olive material. The model's own 15 materials are off-palette
    and the quantizer would snap them somewhere arbitrary."""
    mat = bpy.data.materials.new("EitanOlive")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.28, 0.30, 0.20, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def burnt_material():
    """Wreckage: the same hull, burnt out. Dark enough to read as destroyed at
    64px without leaving the palette's gunmetal band."""
    mat = bpy.data.materials.new("EitanBurnt")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.09, 0.09, 0.08, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def setup():
    """Load the model, build the shared pivot and camera, return the pieces."""
    bpy.ops.wm.open_mainfile(filepath=SRC)

    meshes = scene_meshes()
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if o.name.startswith(BACKDROP_PREFIX):
            o.hide_render = True

    olive = flat_material()
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(olive)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    sc.world = world

    key = bpy.data.lights.new("Key", type="SUN")
    key.energy = 4.0
    key_obj = bpy.data.objects.new("Key", key)
    bpy.context.collection.objects.link(key_obj)
    key_obj.rotation_euler = (math.pi / 2 - math.radians(55), 0, math.radians(135))

    fill = bpy.data.lights.new("Fill", type="SUN")
    fill.energy = 0.35
    fill.color = (0.66, 0.77, 0.82)
    fill.angle = math.radians(60)
    fill_obj = bpy.data.objects.new("Fill", fill)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(35), 0, math.radians(135) + math.pi)

    # Bounds from the vehicle only, so the backdrop cannot inflate the frame.
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        eo = o.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            pts.append(eo.matrix_world @ v.co)
        eo.to_mesh_clear()
    xs = sorted(p.x for p in pts)
    ys = sorted(p.y for p in pts)
    zs = sorted(p.z for p in pts)
    mid = len(pts) // 2
    center = Vector((xs[mid], ys[mid], zs[mid]))
    dists = sorted((p - center).length for p in pts)
    # Hull and turret share this radius and one camera. Widening one alone
    # would shrink it relative to the other and break registration.
    radius = max(dists[-1], 0.001)
    print(f"Bounds: center={center}, radius={radius:.2f} ({len(pts)} verts)")

    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)
    for o in meshes:
        o.parent = pivot
        # pivot.matrix_world is still identity -- the depsgraph has not been
        # evaluated since pivot.location was set -- so inverting it would be a
        # no-op and parenting would shift the model by +center.
        o.matrix_parent_inverse = Matrix.Translation(-center)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    az = math.radians(225)
    dist = radius * 6
    horiz = math.cos(DIMETRIC_ELEVATION) * dist
    cam.location = (
        center.x + horiz * math.cos(az),
        center.y + horiz * math.sin(az),
        center.z + math.sin(DIMETRIC_ELEVATION) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIMETRIC_ELEVATION, 0, az + math.pi / 2)
    cam_data.ortho_scale = radius * 2.0 * 1.15

    turret = [o for o in meshes if o.name in TURRET_MESHES]
    hull = [o for o in meshes if o.name not in TURRET_MESHES]
    missing = TURRET_MESHES - {o.name for o in turret}
    if missing:
        raise SystemExit(f"turret meshes not found in the model: {sorted(missing)}")
    print(f"Hull meshes: {len(hull)}, turret meshes: {len(turret)}")
    return pivot, hull, turret, olive


def render_clip(pivot, show, hide, out_dir, clip, files):
    """Render one clip's 16 facings into out_dir, appending to `files`."""
    os.makedirs(out_dir, exist_ok=True)
    for o in show:
        o.hide_render = False
    for o in hide:
        o.hide_render = True
    base_z = pivot.rotation_euler.z
    step = 2.0 * math.pi / FACINGS
    sc = bpy.context.scene
    for f in range(FACINGS):
        pivot.rotation_euler.z = base_z + f * step
        name = f"{clip}_f{f:02d}_000.png"
        sc.render.filepath = os.path.join(out_dir, name)
        bpy.ops.render.render(write_still=True)
        files.append({"clip": clip, "facing": f, "frame": 0, "file": name})
        print(f"  {clip} {f + 1}/{FACINGS}")
    pivot.rotation_euler.z = base_z


def write_manifest(out_dir, unit, clips, files, layer=None):
    """The manifest is the renderer's only source of truth for this sheet.

    facingOffset and facingReverse describe how this rig lays frames out, and
    are emitted here rather than measured off the images by eye.

    `layer` marks a sheet as a composite drawn onto another rather than a unit
    in its own right. The art gate reads it to skip the fill and silhouette
    checks, which ask "does this read as a unit at gameplay zoom" -- a
    question a bare weapon station cannot answer meaningfully. Without it the
    turret sheet fails on fill, because a turret alone really is 0.6% of frame.
    """
    manifest = {
        "unit": unit,
        "credit": CREDIT,
        "facings": FACINGS,
        "size": SIZE,
        "facingOffset": 5,
        "facingReverse": True,
        "scale": SCALE,
        "clips": clips,
        "files": files,
    }
    if layer:
        manifest["layer"] = layer
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)


def main():
    pivot, hull, turret, olive = setup()

    hull_files = []
    render_clip(pivot, hull, turret, OUT_HULL, "idle", hull_files)

    # Wreck: settled on its axles, tipped, weapon station knocked askew and
    # burnt out. The renderer draws only the hull's wreck clip and hides the
    # turret sprite, so the destroyed weapon station has to be baked in here.
    burnt = burnt_material()
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    for o in turret:
        o.rotation_euler.z += math.radians(34)
        o.rotation_euler.x += math.radians(11)
    pivot.rotation_euler.x += math.radians(4)
    pivot.location.z -= 0.25
    render_clip(pivot, hull + turret, [], OUT_HULL, "wreck", hull_files)
    pivot.rotation_euler.x -= math.radians(4)
    pivot.location.z += 0.25
    for o in turret:
        o.rotation_euler.z -= math.radians(34)
        o.rotation_euler.x -= math.radians(11)
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(olive)

    write_manifest(
        OUT_HULL,
        "eitan_apc_hull",
        {
            "idle": {"frames": 1, "fps": 0, "loop": False},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        hull_files,
    )

    turr_files = []
    render_clip(pivot, turret, hull, OUT_TURR, "idle", turr_files)
    write_manifest(
        OUT_TURR,
        "eitan_apc_turret",
        {"idle": {"frames": 1, "fps": 0, "loop": False}},
        turr_files,
        layer="turret",
    )

    print(f"DONE {FACINGS * 3} frames -> {OUT_HULL}, {OUT_TURR}")


main()
