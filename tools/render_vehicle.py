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
#: Camera azimuth. Was a literal inside setup(); turret_axis_px needs the same
#: number, and this file already carries a warning about constants kept in two
#: places that agreed right up until they did not.
CAM_AZIMUTH = math.radians(225.0)
# Blender's --python does not put the script's own directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dimetric import (  # noqa: E402
    ELEVATION as DIMETRIC_ELEVATION,
    metres_for_scale,
    palette_linear,
    SIZE_CLASS,
    build_lights,
    metres_per_unit,
    ortho_scale_for_turning,
    tiles_across,
    unit_scale,
)

# Breathing room around whatever the geometry reaches, replacing the old
# `radius * 2.0 * 1.15`. Small, because the frame is now sized from the real
# projected extremes in both axes rather than from a bounding sphere -- a sphere
# around a tank is mostly empty corner. Widening this costs empty canvas and
# nothing else: the unit's on-screen size is unchanged by it (see tiles_across).
FRAME_MARGIN = 1.06


@dataclass
class Framing:
    """What the measurement produced, for the manifest to record.

    Carried rather than recomputed so the numbers in the manifest are the same
    ones the camera was built from -- a second derivation is a second chance to
    disagree.
    """

    derived_scale: float
    scale: float
    metres_per_unit: float
    frame_metres: float
    #: The pivot every frame was rotated about, and the frame width in model
    #: units. Both are needed to project a point into sheet pixels, which is what
    #: `turretAxisPx` is.
    center: tuple = (0.0, 0.0, 0.0)
    ortho_units: float = 1.0
    #: The metres actually used -- declared, or solved from `target_scale`.
    real_metres: float = 0.0


@dataclass
class VehicleSpec:
    """Everything that differs between one vehicle and another."""

    src: str
    out_hull: str
    out_turr: str
    # The vehicle's longest real dimension, in metres, and which size class it
    # draws at. Together these replace a hand-typed `scale`: the model's own
    # units are arbitrary, so the manifest scale is derived from these two facts
    # plus the measured frame. See dimetric.SIZE_CLASS for why the compression
    # exists at all.
    # State what the unit *is*, in metres on its longest axis -- or leave it None and
    # set `target_scale` instead, which fixes the drawn size and lets the metres
    # follow. Exactly one of the two.
    real_metres: float
    size_class: str
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
    #: The drawn scale to hit, instead of declaring metres. The rig sizes each frame
    #: to hold the model at every facing, so any geometry change moves the drawn scale
    #: -- the Eitan needed seven hand corrections to `real_metres` in one sitting for
    #: exactly that reason. Declaring the scale makes the on-screen size the fixed
    #: point and derives the metres, so a shape change cannot silently resize a
    #: vehicle. Set this *or* `real_metres`.
    target_scale: float = None
    #: rl_role -> palette key, for a model authored by tools/vehicles/kit.py. Left
    #: None, every part gets the one flat olive that every downloaded hull has
    #: always used, so no existing sheet changes.
    role_palette: dict = None
    #: rl_role -> brightness multiplier on the palette base, for roles that light
    #: far darker than their entry suggests.
    #:
    #: render_team.py measured that **a figure renders at roughly half its base
    #: value** and carries its own LIT_GAIN table for skin and leather. This rig is
    #: darker still -- a black world with no ambient, tuned for vehicles, which are
    #: mostly horizontal surface -- so a crew figure on a vehicle comes out as a
    #: silhouette. The paramotor is the first sheet here to carry human figures and
    #: the first to need this.
    #:
    #: Left None, nothing is gained and every existing sheet is byte-identical.
    lit_gain: dict = None
    #: Model-space (x, y) of the weapon's traverse axis -- the point the station
    #: physically turns about, e.g. the centre of a pintle post. Declaring it makes
    #: the rig emit `turretAxisPx` so the renderer can stop assuming a turret
    #: rotates about the model's centre. Leave None for a centre-mounted station or
    #: a hull-only vehicle; the field is then omitted and behaviour is unchanged.
    turret_axis: tuple = None
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


#: Roughness per role, so gunmetal and glass catch the key light differently from
#: paint. Anything unlisted takes the paint value.
ROLE_ROUGHNESS = {"metal": 0.55, "glass": 0.45, "rubber": 0.95}


def _gained(base, gain):
    """Scale a linear colour toward white without rotating its hue.

    Clamp the *gain*, not the channels. render_team.py recorded the failure:
    skin.0's linear red is 0.571, so a 1.95 gain pinned red at 1.0 while green
    and blue kept climbing, and the result came out orange. Scaling the whole
    colour by the largest non-clipping factor keeps the hue and only gives up
    brightness.
    """
    if gain == 1.0:
        return base
    peak = max(base[:3])
    headroom = 1.0 / peak if peak > 0 else 1.0
    g = min(gain, headroom)
    return tuple(c * g for c in base[:3]) + (1.0,)


def role_materials(meshes, role_palette, lit_gain=None):
    """One material per `rl_role`, each an exact palette entry.

    Vehicles were the last renderer flattening a whole model to one olive, while
    render_team.py and render_building.py had already grown this. Olive is right
    for the KDF -- the ramp's declared role is literally "KDF vehicle hulls" -- and
    wrong for anything else: a captured pickup painted olive loses the faction read
    that its sun-bleached limestone body is there to carry.

    A part with no `rl_role`, or a role with no palette key, raises. Guessing would
    put an off-palette colour into a sheet and the art gate would reject the frame
    with no hint as to which part caused it.
    """
    cache = {}
    gains = lit_gain or {}
    for ob in meshes:
        role = ob.get("rl_role")
        if role is None:
            raise SystemExit(f"{ob.name} carries no rl_role -- the kit must set one")
        key = role_palette.get(role)
        if key is None:
            raise SystemExit(f"no palette key for rl_role {role!r} on {ob.name}")
        # Keyed on (key, role), not key alone: two roles may share a palette
        # entry while only one of them is gained, and a key-only cache would
        # hand the second role the first one's brightened material.
        ck = (key, role)
        if ck not in cache:
            cache[ck] = _shader(
                f"Vehicle_{key.replace('.', '_')}_{role}",
                _gained(palette_linear(key), gains.get(role, 1.0)),
                ROLE_ROUGHNESS.get(role, 0.85),
            )
        ob.data.materials.clear()
        ob.data.materials.append(cache[ck])
    print(f"Materials: {len(cache)} palette colour(s) across {len(meshes)} part(s)")
    return cache


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
    # is per-vehicle, so this defaults off and is opted into only where a test
    # render shows the source lighting spoils the result -- as it does for the
    # Namer, whose own Sun casts a blue patch across the glacis.
    if spec.strip_source_lights:
        for o in [o for o in bpy.data.objects if o.type in {"CAMERA", "LIGHT"}]:
            bpy.data.objects.remove(o, do_unlink=True)

    olive = flat_material()
    if spec.role_palette:
        role_materials(meshes, spec.role_palette, spec.lit_gain)
    else:
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
    # Same class of inherited-setting bug as the percentage above. A source blend
    # that was last used for video carries `media_type = 'VIDEO'`, and the
    # file_format enum then offers only FFMPEG -- assigning "PNG" raises rather
    # than being ignored, which is how the hero-derived Eitan source surfaced it.
    if hasattr(sc.render.image_settings, "media_type"):
        sc.render.image_settings.media_type = "IMAGE"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    sc.world = world

    # The locked rig, from the one place it is defined. These values used to be
    # literals here, in render_rig.py and in the retired soldier renderer -- three
    # copies that agreed, which is how the elevation constant looked right before
    # it turned out to be wrong in six files.
    #
    # One real change comes with it: the key now carries SUN_ANGLE (1.5 deg)
    # where this script left it at Blender's default, so vehicle contact shadows
    # soften very slightly. That is the rig's stated value and the soldier and
    # drone sheets already render with it.
    build_lights(bpy.context.collection)

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
    radius = max(dists[-1], 0.001)

    # The model's own longest axis, which is what `real_metres` names. Taken from
    # the axis-aligned extent rather than the bounding radius: a radius is a
    # diagonal and would under-report metres per unit by up to sqrt(3).
    extent_model = max(xs[-1] - xs[0], ys[-1] - ys[0], zs[-1] - zs[0])

    # Sized to hold the model at every facing, in the model's own units.
    centred = [(p.x, p.y, p.z) for p in pts]
    ortho_units = ortho_scale_for_turning(
        centred, FRAME_MARGIN, aim=tuple(center), z_pad=spec.bounds_z_pad
    )
    # Either the metres are declared and the scale follows, or the scale is declared
    # and the metres follow. The second is what stops a shape change resizing a
    # vehicle behind your back.
    if (spec.target_scale is None) == (spec.real_metres is None):
        raise SystemExit("set exactly one of real_metres or target_scale")
    if spec.target_scale is not None:
        real_metres = metres_for_scale(
            spec.target_scale, extent_model, ortho_units, spec.size_class
        )
        print(f"Solved: target scale {spec.target_scale} -> real_metres {real_metres:.3f}")
    else:
        real_metres = spec.real_metres
    mpu = metres_per_unit(extent_model, real_metres)
    derived = tiles_across(ortho_units * mpu)
    scale = unit_scale(ortho_units * mpu, spec.size_class)
    print(
        f"Bounds: center={center}, radius={radius:.2f} ({len(pts)} verts)\n"
        f"Scale:  extent {extent_model:.3f} units = {real_metres:.3f} m "
        f"({mpu:.4f} m/unit), frame {ortho_units:.3f} units = "
        f"{ortho_units * mpu:.2f} m\n"
        f"        derived {derived:.4f} x {SIZE_CLASS[spec.size_class]} "
        f"({spec.size_class}) = scale {scale:.4f} -> {scale * 64:.0f}px canvas"
    )

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
    az = CAM_AZIMUTH
    dist = radius * 6
    horiz = math.cos(DIMETRIC_ELEVATION) * dist
    cam.location = (
        center.x + horiz * math.cos(az),
        center.y + horiz * math.sin(az),
        center.z + math.sin(DIMETRIC_ELEVATION) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIMETRIC_ELEVATION, 0, az + math.pi / 2)
    # Sized for every facing, not for a bounding sphere. Hull and turret share it,
    # so the weapon station stays registered over the hull as it traverses.
    cam_data.ortho_scale = ortho_units

    turret = [o for o in meshes if o.name in spec.turret_meshes]
    hull = [o for o in meshes if o.name not in spec.turret_meshes]
    missing = set(spec.turret_meshes) - {o.name for o in turret}
    if missing:
        raise SystemExit(f"turret meshes not found in the model: {sorted(missing)}")
    print(f"Hull meshes: {len(hull)}, turret meshes: {len(turret)}")
    return pivot, hull, turret, olive, Framing(
        derived, scale, mpu, ortho_units * mpu, tuple(center), ortho_units, real_metres
    )


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


def turret_axis_px(spec, framing):
    """Where the weapon's traverse axis lands, in sheet pixels, for each facing.

    The renderer composites a turret sheet at the *hull's* screen position while
    choosing its frame independently, so a turret is drawn as though the whole
    vehicle had turned to the turret's heading -- it orbits the rig's pivot. That
    pivot is the model's median vertex, so a weapon anywhere else swings.

    Nobody noticed while the only turrets were centre-mounted: the Eitan's station
    sits 4.2% of hull length from its pivot, about 4 px drawn. A pintle gun on a
    pickup bed measured 16.2%, and a long barrel built from 14-segment cylinders
    makes it *worse* by dragging the median forward -- the better the gun, the
    worse the pivot, which is the incentive running backwards.

    So the rig records the truth instead: for facing f, the pixel the axis appears
    at within frame f. The renderer offsets the turret sprite by
    `axis[hullFacing] - axis[turretFacing]`, which is zero when they agree and
    exactly the correction when they do not. Emitted only when a spec declares
    `turret_axis`; without it the manifest omits the field and the renderer keeps
    its previous behaviour, so no existing sheet moves a pixel.
    """
    if spec.turret_axis is None:
        return None
    ax, ay = spec.turret_axis
    cx, cy, cz = framing.center
    ppu = SIZE / framing.ortho_units
    right = (-math.sin(CAM_AZIMUTH), math.cos(CAM_AZIMUTH), 0.0)
    up = (
        -math.sin(DIMETRIC_ELEVATION) * math.cos(CAM_AZIMUTH),
        -math.sin(DIMETRIC_ELEVATION) * math.sin(CAM_AZIMUTH),
        math.cos(DIMETRIC_ELEVATION),
    )
    out = []
    for f in range(FACINGS):
        th = f * 2.0 * math.pi / FACINGS
        # The axis rides the pivot's rotation, exactly as render_clip turned it.
        dx = ax - cx
        dy = ay - cy
        rx = dx * math.cos(th) - dy * math.sin(th)
        ry = dx * math.sin(th) + dy * math.cos(th)
        sx = (rx * right[0] + ry * right[1]) * ppu
        sy = (rx * up[0] + ry * up[1]) * ppu
        # Sheet pixels: x rightward, y downward, from the frame centre.
        out.append([round(sx, 2), round(-sy, 2)])
    return out


def write_manifest(spec, out_dir, unit, clips, files, framing, layer=None, axis_px=None):
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
        # `scale` is what the renderer draws with. The four fields beside it are
        # the derivation, recorded so the compression is reviewable in the
        # manifest instead of being inferred from one opaque number -- which is
        # what the hand-typed scales it replaces were.
        "scale": round(framing.scale, 4),
        "derivedScale": round(framing.derived_scale, 4),
        "sizeClass": spec.size_class,
        "classMultiplier": SIZE_CLASS[spec.size_class],
        "realMetres": round(framing.real_metres, 3),
        "metresPerModelUnit": round(framing.metres_per_unit, 5),
        "frameMetres": round(framing.frame_metres, 3),
        "clips": clips,
        "files": files,
    }
    if layer:
        manifest["layer"] = layer
    if axis_px:
        manifest["turretAxisPx"] = axis_px
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)


def render_vehicle(spec):
    """Render one vehicle's hull (idle + wreck) and turret (idle) sheets."""
    pivot, hull, turret, olive, framing = setup(spec)

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
    # Restore. A role-painted model must go back to its roles, not to olive --
    # otherwise the turret sheet renders olive after the wreck pass and the two
    # sheets of one vehicle disagree on colour.
    if spec.role_palette:
        role_materials(hull + turret, spec.role_palette, spec.lit_gain)
    else:
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
        framing,
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
        framing,
        layer="turret",
        axis_px=turret_axis_px(spec, framing),
    )

    print(f"DONE {FACINGS * 3} frames -> {spec.out_hull}, {spec.out_turr}")
