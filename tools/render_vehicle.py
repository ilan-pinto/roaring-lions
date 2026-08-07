"""Shared machinery for rendering a vehicle as hull + turret sprite sheets.

Two passes over one model, sharing a single pivot and camera so the turret
sprite registers exactly over the hull as it traverses. Computing bounds per
pass would scale the two differently and the weapon station would drift.

Cycles output is not on-palette and has soft alpha, so a render must always be
followed by the quantizer or `pnpm validate:assets` rejects every frame:

    blender --background --python tools/render_<vehicle>.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

.blend sources are gitignored (too large to track). Provenance travels in each
vehicle script's CREDIT string and the `credit` field written into every
manifest.
"""
import sys
import json
import math
import os
from dataclasses import dataclass

import bpy
from mathutils import Matrix, Vector

SIZE = 256
FACINGS = 16
SAMPLES = 64
# Blender's --python does not put the script's own directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dimetric import ELEVATION as DIMETRIC_ELEVATION  # noqa: E402


@dataclass
class VehicleSpec:
    """Everything that differs between one vehicle and another."""

    src: str
    out_hull: str
    out_turr: str
    scale: float
    credit: str
    hull_unit: str
    turret_unit: str
    # Sprite index that faces world +x. This is a property of how the source
    # model is oriented in its own .blend file -- not of this rig -- so it
    # must be measured per vehicle rather than assumed to match another
    # vehicle's source file. Defaults to 0; override only if a silhouette fit
    # against rendered frames shows otherwise.
    facing_offset: int = 0
    # The traversing weapon station, if the model has one. A vehicle whose
    # weapon is not modelled separately -- or not modelled at all -- leaves this
    # empty and renders a hull sheet only. The game renderer already copes: a
    # unit whose atlas has no turret textures simply draws the hull, which is
    # how infantry has always worked.
    turret_meshes: frozenset = frozenset()
    # Meshes that are not the vehicle. A source file may ship a studio backdrop,
    # a ground plane, or an area-light emitter plane -- the jeep has both a
    # 153x89 Ground and an 8x8 LightSource hanging directly over the roof, which
    # rendered as a grey slab and threw the whole vehicle into shadow. Matched
    # by name prefix, and a tuple because one string cannot cover two unrelated
    # names.
    exclude_prefixes: tuple = ()
    # Remove any camera and lights the source file ships, so only this rig's
    # two lights illuminate the model. Defaults OFF: the truck source ships a
    # Sun that contributes real light to the committed Eitan sheets, and
    # stripping it changes 12 of its 48 frames. Turn it on per vehicle only
    # after checking a test render actually needs it.
    strip_source_lights: bool = False
    # Poses to include when measuring the model, for a sheet whose clip moves
    # parts of the model. Each is a zero-argument callable that looks its
    # objects up in bpy.data and poses them; bounds are the union over all of
    # them. Empty means measure the rest pose only, which is right for every
    # sheet whose frames are all the same shape. A drone's props sweep outside
    # their rest silhouette when they yaw, and framing to the rest pose alone
    # crops the blade tips on some frames.
    bounds_poses: tuple = ()
    # Vertical travel the clip will give the pivot, included in the measurement
    # so a bobbing model cannot walk out of its own frame.
    bounds_z_pad: float = 0.0
    # How the wreck is posed: weapon station knocked askew, hull settled.
    wreck_turret_yaw_deg: float = 34.0
    wreck_turret_pitch_deg: float = 11.0
    wreck_pitch_deg: float = 4.0
    wreck_sink: float = 0.25


def scene_meshes(spec):
    """Real vehicle meshes -- backdrop planes excluded."""
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if spec.exclude_prefixes and o.name.startswith(spec.exclude_prefixes):
            continue
        out.append(o)
    return out


def _shader(name, colour, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def flat_material():
    """One flat olive material. A model's own materials are off-palette and the
    quantizer would snap them somewhere arbitrary."""
    return _shader("VehicleOlive", (0.28, 0.30, 0.20, 1.0), 0.85)


def burnt_material():
    """Wreckage: the same hull, burnt out. Dark enough to read as destroyed at
    64px without leaving the palette's gunmetal band."""
    return _shader("VehicleBurnt", (0.09, 0.09, 0.08, 1.0), 0.95)


def setup(spec):
    """Load the model, build the shared pivot and camera, return the pieces."""
    bpy.ops.wm.open_mainfile(filepath=spec.src)

    meshes = scene_meshes(spec)
    if spec.exclude_prefixes:
        for o in bpy.data.objects:
            if o.type == "MESH" and o.name.startswith(spec.exclude_prefixes):
                o.hide_render = True

    # A source file may ship its own camera and lights. Whether to remove them
    # is per-vehicle: the truck's Sun contributes usefully to the Eitan sheets,
    # so this defaults off and is opted into only where a test render shows the
    # source lighting spoils the result.
    if spec.strip_source_lights:
        for o in [o for o in bpy.data.objects if o.type in {"CAMERA", "LIGHT"}]:
            bpy.data.objects.remove(o, do_unlink=True)

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
    # Source files carry their own percentage; DMM08 ships 50, which would
    # silently halve every sheet.
    sc.render.resolution_percentage = 100
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

    # Bounds from the vehicle only, so a backdrop cannot inflate the frame.
    # Measured over every pose the clip will show, so a moving part cannot
    # sweep outside a frame that was fitted to the rest pose.
    pts = []
    for pose in spec.bounds_poses or (lambda: None,):
        pose()
        bpy.context.view_layer.update()
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
    # The pad is added rather than max'd: a vertex already at the far edge is
    # also the one the vertical travel pushes furthest out.
    radius = max(dists[-1] + spec.bounds_z_pad, 0.001)
    print(f"Bounds: center={center}, radius={radius:.2f} ({len(pts)} verts)")

    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)
    # Re-parent only the roots. A source file may already have a hierarchy --
    # the jeep parents its doors, wheels, antennas and roof to the Hummer body,
    # and a spare wheel to the trunk door. Flattening all of them onto the pivot
    # discards each child's transform relative to its real parent and scatters
    # the vehicle into loose panels. Children follow their root automatically.
    roots = [o for o in meshes if o.parent is None or o.parent not in meshes]
    for o in roots:
        o.parent = pivot
        # pivot.matrix_world is still identity -- the depsgraph has not been
        # evaluated since pivot.location was set -- so inverting it would be a
        # no-op and parenting would shift the model by +center.
        o.matrix_parent_inverse = Matrix.Translation(-center)
    print(f"Re-parented {len(roots)} root object(s) of {len(meshes)} meshes")

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

    turret = [o for o in meshes if o.name in spec.turret_meshes]
    hull = [o for o in meshes if o.name not in spec.turret_meshes]
    missing = set(spec.turret_meshes) - {o.name for o in turret}
    if missing:
        raise SystemExit(f"turret meshes not found in the model: {sorted(missing)}")
    print(f"Hull meshes: {len(hull)}, turret meshes: {len(turret)}")
    return pivot, hull, turret, olive


def render_clip(pivot, show, hide, out_dir, clip, files, frames=1, pose=None):
    """Render one clip's 16 facings into out_dir, appending to `files`.

    `frames` and `pose` make a clip animated. `pose(pivot, k)` is called before
    each frame and must set absolute state, not apply a delta -- it is called
    once per facing per frame, so deltas would accumulate 64 times over a sheet.

    Both default to the single-frame behaviour every vehicle sheet in the
    repository was rendered with: one file per facing, named `_000.png`, frame
    index 0. A caller that passes neither gets byte-identical output.
    """
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
        for k in range(frames):
            if pose:
                pose(pivot, k)
            name = f"{clip}_f{f:02d}_{k:03d}.png"
            sc.render.filepath = os.path.join(out_dir, name)
            bpy.ops.render.render(write_still=True)
            files.append({"clip": clip, "facing": f, "frame": k, "file": name})
        print(f"  {clip} {f + 1}/{FACINGS}")
    pivot.rotation_euler.z = base_z
    if pose:
        pose(pivot, 0)


def write_manifest(spec, out_dir, unit, clips, files, layer=None):
    """The manifest is the renderer's only source of truth for this sheet.

    facingOffset and facingReverse describe how this rig lays frames out.
    facingReverse is a rig constant: this loop always advances rotation the
    same way relative to world bearing. facingOffset is per-vehicle -- it
    depends on the source model's own orientation, not the rig -- so it comes
    from spec.facing_offset rather than being hardcoded here. Neither is
    derived from the images; both are emitted from what the rig (and spec)
    already know.

    `layer` marks a sheet as a composite drawn onto another rather than a unit
    in its own right. The art gate reads it to skip the fill and silhouette
    checks, which ask "does this read as a unit at gameplay zoom" -- a question
    a bare weapon station cannot answer meaningfully. Without it the turret
    sheet fails on fill, because a turret alone really is under 1% of frame.
    """
    manifest = {
        "unit": unit,
        "credit": spec.credit,
        "facings": FACINGS,
        "size": SIZE,
        "facingOffset": spec.facing_offset,
        "facingReverse": True,
        "scale": spec.scale,
        "clips": clips,
        "files": files,
    }
    if layer:
        manifest["layer"] = layer
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)


def render_vehicle(spec):
    """Render one vehicle's hull (idle + wreck) and turret (idle) sheets."""
    pivot, hull, turret, olive = setup(spec)

    hull_files = []
    render_clip(pivot, hull, turret, spec.out_hull, "idle", hull_files)

    # Wreck: settled on its axles, tipped, weapon station knocked askew and
    # burnt out. The renderer draws only the hull's wreck clip and hides the
    # turret sprite, so the destroyed weapon station has to be baked in here.
    burnt = burnt_material()
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    for o in turret:
        o.rotation_euler.z += math.radians(spec.wreck_turret_yaw_deg)
        o.rotation_euler.x += math.radians(spec.wreck_turret_pitch_deg)
    pivot.rotation_euler.x += math.radians(spec.wreck_pitch_deg)
    pivot.location.z -= spec.wreck_sink
    render_clip(pivot, hull + turret, [], spec.out_hull, "wreck", hull_files)
    pivot.rotation_euler.x -= math.radians(spec.wreck_pitch_deg)
    pivot.location.z += spec.wreck_sink
    for o in turret:
        o.rotation_euler.z -= math.radians(spec.wreck_turret_yaw_deg)
        o.rotation_euler.x -= math.radians(spec.wreck_turret_pitch_deg)
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(olive)

    write_manifest(
        spec,
        spec.out_hull,
        spec.hull_unit,
        {
            "idle": {"frames": 1, "fps": 0, "loop": False},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        hull_files,
    )

    # A vehicle with no separately modelled weapon gets a hull sheet and stops.
    # Rendering an empty turret pass would write 16 blank frames, and the art
    # gate would reject them on minimum fill -- correctly, since a sheet of
    # nothing is not a layer.
    if not turret:
        print(f"DONE {FACINGS * 2} frames (hull only) -> {spec.out_hull}")
        return

    turr_files = []
    render_clip(pivot, turret, hull, spec.out_turr, "idle", turr_files)
    write_manifest(
        spec,
        spec.out_turr,
        spec.turret_unit,
        {"idle": {"frames": 1, "fps": 0, "loop": False}},
        turr_files,
        layer="turret",
    )

    print(f"DONE {FACINGS * 3} frames -> {spec.out_hull}, {spec.out_turr}")
