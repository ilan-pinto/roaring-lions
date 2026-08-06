"""Render a building as a single dimetric sprite.

Buildings are not vehicles, and the differences are load-bearing:

  - **One sprite, not sixteen.** A unit needs 16 facings because it turns. A
    building is placed with a fixed orientation under a fixed camera, so it has
    exactly one appearance.
  - **A shared scale, not fit-to-radius.** `render_vehicle.py` fits each model
    to its own bounding radius, which is right for vehicles. Applied to
    buildings it inverts relative size -- a tall apartment ends up rendering
    smaller than a short shanty, because each is fitted to its own extent.
    Every building here is framed from its declared tile footprint instead, so a
    3x3 mosque and a 4x3 house share one world-units-per-pixel.
  - **The camera aims at the footprint's ground centre.** The renderer anchors
    sprites at 0.5 on the tile centre; centring the frame on a tall building's
    mass would bury its footprint below the ground.
  - **Walls need ambient.** The vehicle rig is a 55-degree key against a black
    world, which works because a vehicle is mostly horizontal surface. A
    building is mostly vertical wall and comes out near-black. Ambient is tuned
    low enough that recessed doors and windows still read as dark openings
    rather than washing flat.

Cycles output is off-palette with soft alpha, so a render must always be
followed by the quantizer or `pnpm validate:assets` rejects the frame:

    blender --background --python tools/render_building.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

Building .blend sources ARE tracked, unlike the vehicle sources -- see
.gitignore. Shells are small enough for plain git.
"""
import json
import math
import os
from dataclasses import dataclass, field

import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SIZE = 256
SAMPLES = 64
DIMETRIC_ELEVATION = math.atan(0.5)

# How much frame to leave around the footprint. A building is taller than it is
# wide in screen terms, so the margin buys headroom for domes and minarets.
FRAME_MARGIN = 1.30
# Push the framing up so the footprint sits at the sprite centre while the mass
# rises into the upper half.
FRAME_SHIFT_Y = 0.16


@dataclass
class BuildingSpec:
    """Everything that differs between one building and another."""

    src: str
    out_dir: str
    unit: str
    credit: str
    # Declared footprint in tiles, from the map: a 3x3 mosque is 3.
    footprint_tiles: int
    # The structure's palette entry from data/structures.json, e.g. limestone.1.
    colour_key: str
    # How many tiles wide the sprite draws. Usually footprint_tiles, but a
    # building whose mass overhangs its footprint -- a minaret, an eave -- wants
    # more, or it gets cropped.
    scale: float
    # Objects to leave out: ground planes, leftover primitives, parts that
    # belong in the .blend but not in this sprite.
    drop: set = field(default_factory=set)
    # Render-time nudges, name -> (dx, dy, dz). A last resort: prefer fixing the
    # source. Recorded in the manifest so the sprite can be explained.
    offsets: dict = field(default_factory=dict)
    strip_source_lights: bool = True
    # Coursed brick instead of a flat colour. Both tones come from one palette
    # ramp so the pattern survives quantization.
    brick: bool = False
    # Coursing tones, by palette name. Defaults chosen from the key art: its two
    # most common masonry tones map to limestone.2 and dust.0, with the mortar
    # line a step darker so coursing reads as shadow rather than highlight.
    course_a_key: str = "limestone.2"
    course_b_key: str = "dust.0"
    mortar_key: str = "limestone.3"
    # Bricks per world unit. The mosque is ~10.8 units and draws ~230px wide, so
    # roughly 21px per unit: a scale near 6 gives courses a few pixels deep,
    # which is the finest that still reads.
    brick_scale: float = 6.0
    mortar_size: float = 0.035
    # Name fragments that stay flat -- curved or fine parts.
    smooth_parts: tuple = ("dome", "Dome", "finial", "Finial", "drum", "Drum")


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


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def palette_linear(key):
    """A palette colour as linear RGB, ready for a Blender base colour.

    The render has to aim at the ramp the structure declares, not at a guessed
    sand. Getting this wrong is not subtle: a first pass lit with a blue ambient
    put 47% of the mosque into gunmetal and 16% into olive, because the quantizer
    snaps to whatever is nearest and blue-grey shadow is nearest gunmetal.
    """
    with open(os.path.join(REPO, "data", "palette.json")) as fh:
        pal = json.load(fh)
    band, name = key.split(".", 1)
    if band in pal["ramps"]:
        hexv = pal["ramps"][band]["colors"][int(name)]
    else:
        hexv = pal["reserved"][band]["colors"][name]
    r = int(hexv[1:3], 16) / 255.0
    g = int(hexv[3:5], 16) / 255.0
    b = int(hexv[5:7], 16) / 255.0
    return (_srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b), 1.0)


def stone_material(colour_key):
    """One flat colour, taken from the structure's own palette entry, so lit and
    shadowed faces both land inside that ramp instead of drifting out of it."""
    return _shader("BuildingStone", palette_linear(colour_key), 0.90)


def brick_material(course_a_key, course_b_key, mortar_key, brick_scale, mortar_size):
    """Coursed brick, projected triplanar, built from one palette ramp.

    Two problems had to be solved together.

    Quantization: every pixel snaps to the nearest of ~24 palette colours, so a
    photographic texture scatters across bands unpredictably -- the same failure
    that put 47% of the flat-shaded mosque into gunmetal. Driving the pattern
    between two steps of the SAME ramp keeps surface tone inside it.

    Projection: Blender's brick texture is 2D. Fed the default generated
    coordinates, a vertical wall gets one brick row extruded along its depth,
    which renders as vertical stripes -- it reads as corrugated iron, not
    masonry. The fix is triplanar: project brick along each of the three axes and
    blend by the absolute surface normal, so every face gets brick face-on
    without the model needing UVs. This model has none, and unwrapping 42 objects
    to get coursing is not a trade worth making.
    """
    mat = bpy.data.materials.new("BuildingBrick")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    # All three tones are real palette entries. An earlier attempt derived the
    # second course arithmetically (base * 1.16), which is not a palette colour
    # and drifted into the green olive mid-steps -- 23% of the sprite read as
    # moss. Sampling the project's key art shows its masonry spans limestone AND
    # dust together, with olive only in deep shadow, so the courses are drawn
    # from those two warm ramps by name.
    base = palette_linear(course_a_key)
    course = palette_linear(course_b_key)
    mortar = palette_linear(mortar_key)

    coord = nt.nodes.new("ShaderNodeTexCoord")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    # |normal| gives the three blend weights.
    absn = nt.nodes.new("ShaderNodeVectorMath")
    absn.operation = "ABSOLUTE"
    nt.links.new(geo.outputs["Normal"], absn.inputs[0])
    split = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(absn.outputs["Vector"], split.inputs[0])

    def plane(axis_a, axis_b):
        """One brick projection, using two of the object's three axes."""
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(coord.outputs["Object"], sep.inputs[0])
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(sep.outputs[axis_a], comb.inputs[0])
        nt.links.new(sep.outputs[axis_b], comb.inputs[1])
        b = nt.nodes.new("ShaderNodeTexBrick")
        b.inputs["Color1"].default_value = base
        b.inputs["Color2"].default_value = course
        b.inputs["Mortar"].default_value = mortar
        b.inputs["Scale"].default_value = brick_scale
        b.inputs["Mortar Size"].default_value = mortar_size
        b.inputs["Mortar Smooth"].default_value = 0.15
        b.inputs["Bias"].default_value = 0.0
        b.inputs["Brick Width"].default_value = 0.5
        b.inputs["Row Height"].default_value = 0.25
        nt.links.new(comb.outputs["Vector"], b.inputs["Vector"])
        return b

    # A face whose normal is mostly X sees the YZ pattern, and so on -- so
    # courses always run horizontally on a vertical wall.
    bx = plane(1, 2)  # normal along X -> project YZ
    by = plane(0, 2)  # normal along Y -> project XZ
    bz = plane(0, 1)  # normal along Z (a roof) -> project XY

    mix_xy = nt.nodes.new("ShaderNodeMix")
    mix_xy.data_type = "RGBA"
    nt.links.new(bx.outputs["Color"], mix_xy.inputs[6])
    nt.links.new(by.outputs["Color"], mix_xy.inputs[7])
    nt.links.new(split.outputs["Y"], mix_xy.inputs[0])

    mix_z = nt.nodes.new("ShaderNodeMix")
    mix_z.data_type = "RGBA"
    nt.links.new(mix_xy.outputs[2], mix_z.inputs[6])
    nt.links.new(bz.outputs["Color"], mix_z.inputs[7])
    nt.links.new(split.outputs["Z"], mix_z.inputs[0])

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.92
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(mix_z.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def setup(spec):
    """Load the model, drop what is not wanted, light it, frame it."""
    bpy.ops.wm.open_mainfile(filepath=spec.src)

    for o in list(bpy.data.objects):
        if o.name in spec.drop:
            bpy.data.objects.remove(o, do_unlink=True)
        elif spec.strip_source_lights and o.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(o, do_unlink=True)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no meshes left after dropping {sorted(spec.drop)}")

    for name, (dx, dy, dz) in spec.offsets.items():
        o = bpy.data.objects.get(name)
        if o is None:
            raise SystemExit(f"offset names an object that is not here: {name!r}")
        o.location.x += dx
        o.location.y += dy
        o.location.z += dz

    stone = stone_material(spec.colour_key)
    brick = (
        brick_material(
            spec.course_a_key,
            spec.course_b_key,
            spec.mortar_key,
            spec.brick_scale,
            spec.mortar_size,
        )
        if spec.brick
        else None
    )
    for o in meshes:
        o.data.materials.clear()
        # Brick is for masonry. Domes and finials stay smooth: coursing a curved
        # surface reads as scaffolding, not stonework.
        use_brick = brick is not None and not any(k in o.name for k in spec.smooth_parts)
        o.data.materials.append(brick if use_brick else stone)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    # A source file can carry its own percentage and silently halve the sheet.
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # Sky ambient, because a building is mostly wall, and warm rather than blue:
    # blue-grey shadow on limestone quantizes to gunmetal.
    #
    # Key and ambient were swept rather than guessed, measuring which palette
    # band the quantizer actually chose. Too dark and mid-tones fall below
    # limestone.3 and snap to gunmetal; too bright and they climb into olive:
    # Flat shading:
    #   key 2.6 / amb 0.34 -> gunmetal 47%, limestone 36%
    #   key 4.0 / amb 0.45 -> limestone 73%, olive 24%
    #   key 5.5 / amb 0.60 -> limestone 81%, olive 12%
    # Coursed brick sits on darker base tones and needed its own sweep, warm
    # being limestone + dust, the two ramps the project's key art actually uses:
    #   key 5.5 / amb 0.60 -> warm 68%, gunmetal 21%
    #   key 7.0 / amb 0.70 -> warm 75%, gunmetal 13%
    #   key 8.5 / amb 0.80 -> warm 88%, gunmetal  6%   <- chosen
    bg.inputs[0].default_value = (0.55, 0.50, 0.42, 1.0)
    bg.inputs[1].default_value = 0.80
    sc.world = world

    key = bpy.data.lights.new("Key", type="SUN")
    key.energy = 8.5
    key_obj = bpy.data.objects.new("Key", key)
    bpy.context.collection.objects.link(key_obj)
    key_obj.rotation_euler = (math.pi / 2 - math.radians(55), 0, math.radians(135))

    fill = bpy.data.lights.new("Fill", type="SUN")
    fill.energy = 0.55
    fill.color = (0.82, 0.78, 0.68)
    fill.angle = math.radians(60)
    fill_obj = bpy.data.objects.new("Fill", fill)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(35), 0, math.radians(135) + math.pi)

    # Bounds of what will actually render.
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        eo = o.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            pts.append(eo.matrix_world @ v.co)
        eo.to_mesh_clear()
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    print(
        f"Extent: x={max(xs) - min(xs):.2f} y={max(ys) - min(ys):.2f} "
        f"z={max(zs) - min(zs):.2f}, base z={min(zs):.2f}"
    )

    # Ground centre of the footprint: the point the tile sits under.
    gx = (max(xs) + min(xs)) / 2
    gy = (max(ys) + min(ys)) / 2
    gz = min(zs)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    az = math.radians(225)
    # Orthographic, so distance only has to clear the geometry.
    dist = extent * 20.0 + 50.0
    horiz = math.cos(DIMETRIC_ELEVATION) * dist
    cam.location = (
        gx + horiz * math.cos(az),
        gy + horiz * math.sin(az),
        gz + math.sin(DIMETRIC_ELEVATION) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIMETRIC_ELEVATION, 0, az + math.pi / 2)
    cam_data.ortho_scale = extent * FRAME_MARGIN
    cam_data.shift_y = FRAME_SHIFT_Y

    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = (gx, gy, gz)
    bpy.context.collection.objects.link(pivot)
    for o in meshes:
        o.parent = pivot
        # pivot.matrix_world is still identity here -- the depsgraph has not run
        # since pivot.location was set -- so inverting it would be a no-op and
        # parenting would shift the model by +centre.
        o.matrix_parent_inverse = Matrix.Translation((-gx, -gy, -gz))
    return meshes, extent


def render_building(spec):
    """One building, one sprite."""
    meshes, extent = setup(spec)
    os.makedirs(spec.out_dir, exist_ok=True)
    name = "idle_f00_000.png"
    bpy.context.scene.render.filepath = os.path.join(spec.out_dir, name)
    bpy.ops.render.render(write_still=True)
    print(f"  rendered {name}")

    manifest = {
        "unit": spec.unit,
        "credit": spec.credit,
        # A building does not turn, so there is one appearance and the facing
        # machinery is inert. facingOffset/facingReverse are meaningless here and
        # are omitted rather than set to a lie.
        "kind": "building",
        "facings": 1,
        "size": SIZE,
        "scale": spec.scale,
        "footprintTiles": spec.footprint_tiles,
        "clips": {"idle": {"frames": 1, "fps": 0, "loop": False}},
        "files": [{"clip": "idle", "facing": 0, "frame": 0, "file": name}],
    }
    if spec.drop:
        manifest["dropped"] = sorted(spec.drop)
    if spec.offsets:
        manifest["offsets"] = {k: list(v) for k, v in spec.offsets.items()}
    with open(os.path.join(spec.out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    print(f"DONE 1 frame -> {spec.out_dir} (extent {extent:.2f})")


MOSQUE = BuildingSpec(
    src=os.path.abspath("art/src/buildings/mosque.blend"),
    out_dir=os.path.abspath("assets/sprites/BLD_MOSQUE"),
    unit="mosque",
    credit="Original work for Roaring Lions (CC BY-SA 4.0)",
    # data/maps: the mosque is a 3x3 block of 'm'.
    footprint_tiles=3,
    colour_key="limestone.1",
    brick=True,
    # Wider than the footprint: the minaret overhangs, and cropping it would
    # remove the feature that identifies the building at a glance.
    scale=3.6,
    drop={
        "Ground",  # 26x22 ground plane; fills the frame
        "Cube",  # leftover default cube, half below grade inside Hall
        # Forecourt. The map declares a 3x3 square and these make the model
        # 1.36:1; at 64px they read as thin noise and shrink the dome, which is
        # what identifies a mosque. They stay in the .blend.
        "Wall_L",
        "Wall_R",
        "Wall_side_L",
        "Wall_side_R",
        "Gate_L",
        "Gate_R",
        "Gate_lintel",
    },
    offsets={
        # The minaret was placed inside the forecourt. With the walls dropped it
        # reads as a detached pillar, so it is tucked against the hall's corner.
        # Fill rises from 19-23% to 24-30% and the group reads as one building.
        "Minaret_base": (-1.55, 0.60, 0.0),
        "Minaret_shaft": (-1.55, 0.60, 0.0),
        "Minaret_balcony": (-1.55, 0.60, 0.0),
        "Minaret_dome": (-1.55, 0.60, 0.0),
        "Minaret_top": (-1.55, 0.60, 0.0),
        "Minaret_finial": (-1.55, 0.60, 0.0),
    },
)


render_building(MOSQUE)
