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
import sys
import json
import math
import os
from dataclasses import dataclass, field

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Blender's --python does not put the script's own directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dimetric import (  # noqa: E402
    palette_linear,
    ELEVATION as DIMETRIC_ELEVATION,
    UNITS_PER_TILE,
    badge_top_px,
    framing_clearance,
    ortho_scale_for,
    tiles_across,
)

# 512, not 256. A structure sprite draws at `manifest.scale * TILE_W` px, and the
# mosque's scale of 3.6 means it displays at 230px -- so buildings are near 1:1
# with their source, not the 64px the first building spec assumed. The apartment
# will want ~350px, which 256 cannot supply without upscaling.
SIZE = 512
SAMPLES = 64

# Breathing room around whatever the geometry actually reaches. Small, because
# the frame is now sized from the real projected extremes in both axes rather
# than from horizontal extent alone -- the margin only has to cover the
# difference between vertex positions and the pixels Cycles puts near them.
#
# Raising it costs empty canvas and nothing else: tiles_across() rises with the
# frame, so the building's size on the map does not change.
FRAME_MARGIN = 1.06

# Opaque art must clear every canvas edge by at least this many px. check_framing
# in the art gate rejects a sprite that touches an edge; catching it here means a
# cropped render never reaches the gate.
MIN_EDGE_CLEARANCE_PX = 4

# Palette entry per material role, by name. Never derived arithmetically: an
# earlier attempt computed a second brick course as `base * 1.16`, which is not a
# palette colour and drifted 23% of the mosque into moss-green.
#
# Any entry can be overridden for a sweep with RL_ROLE_<ROLE>, e.g.
# RL_ROLE_ROOF=limestone.8. Tones here were chosen by measuring which band the
# quantizer actually picked, not by eye, and a sweep is how that is redone.
ROLE_PALETTE = {
    # A separate roof deck, and a much darker tone than seems right. The roof used
    # to be the top face of a wall cube, so it took the wall material and the
    # 55-degree key hit it hardest -- 16.2% of the shipped mosque is bare
    # limestone.0 glare. A separate object was necessary but not sufficient:
    # swept against the house, the key multiplies a horizontal surface by roughly
    # 2.5x and there is a cliff between limestone.5 and limestone.6.
    #   limestone.5 -> 25.4% glare   (worse than the mosque)
    #   limestone.6 ->  3.2% glare, roof reads limestone.2
    #   limestone.7 ->  3.0% glare, roof reads limestone.3
    #   dust.6      ->  3.0% glare, roof reads dust.2      <- chosen
    # dust.6 wins on more than glare: it lands the roof in a warm sand distinct in
    # hue from the limestone walls, which is what a packed-earth flat roof is.
    "roof": "dust.6",
    "trim": "terracotta.1",
    "dome": "limestone.1",
    # Timber sits on vertical faces, which take far less light than a roof, so a
    # tone dark enough to read as wood on a roof goes near-black on a balcony.
    # dust.4 rather than dust.6 for that reason.
    "wood": "dust.4",
    "glass": "shadow.0",
    "metal": "gunmetal.2",
    # Rusted sheet, as distinct from galvanised. Added because the shanty's roof
    # in `metal` came back 8.8% olive.2: gunmetal is already slightly green, and
    # shadowed it drifts into the olive ramp -- moss on a desert shed. A warm tone
    # cannot make that mistake, and rusted corrugated iron is what this roof
    # actually is, which also keeps it from reading like the warehouse's grey gable.
    "rust": "terracotta.2",
}
#: `wall` is deliberately absent above: it is brick or flat stone per the spec.
WALL_ROLE = "wall"

for _role in list(ROLE_PALETTE):
    _override = os.environ.get(f"RL_ROLE_{_role.upper()}")
    if _override:
        ROLE_PALETTE[_role] = _override
        print(f"  role override: {_role} -> {_override}")


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
    # Where the footprint's centre sits in the model, in world units. The camera
    # aims here and the renderer anchors the sprite here, so the two must agree or
    # the building sits off the tiles it occupies. Kit-authored buildings are
    # centred on the origin by construction; the model's bounding-box centre is
    # NOT a substitute, because an overhanging stair or minaret drags it sideways.
    footprint_centre: tuple = (0.0, 0.0)
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
    # One material per role, built lazily so a building that has no glass does not
    # carry a glass material into its .blend.
    role_mats = {}

    def role_material(role):
        if role not in role_mats:
            key = ROLE_PALETTE[role]
            role_mats[role] = _shader(f"Building_{role}", palette_linear(key), 0.90)
        return role_mats[role]

    roles_used = {}
    for o in meshes:
        o.data.materials.clear()
        # An object authored by the kit declares what it is. Objects without a
        # role -- anything hand-modelled before roles existed, mosque.blend
        # included -- fall through to the original name heuristic, so an untouched
        # source renders exactly as it did before.
        role = o.get("rl_role")
        if role is None:
            # Brick is for masonry. Domes and finials stay smooth: coursing a
            # curved surface reads as scaffolding, not stonework.
            use_brick = brick is not None and not any(k in o.name for k in spec.smooth_parts)
            o.data.materials.append(brick if use_brick else stone)
            roles_used["<inferred>"] = roles_used.get("<inferred>", 0) + 1
            continue
        if role == WALL_ROLE:
            o.data.materials.append(brick if brick is not None else stone)
        elif role in ROLE_PALETTE:
            o.data.materials.append(role_material(role))
        else:
            raise SystemExit(
                f"{o.name!r} declares rl_role={role!r}, which is not a known role. "
                f"Known: {sorted([WALL_ROLE] + list(ROLE_PALETTE))}"
            )
        roles_used[role] = roles_used.get(role, 0) + 1
    print("  roles: " + ", ".join(f"{k}={v}" for k, v in sorted(roles_used.items())))

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

    # The point the tile sits under: the declared footprint centre at grade, NOT
    # the bounding-box centre. The house's stair and the mosque's minaret both
    # overhang, and taking the bbox centre would slide the anchor off the
    # footprint -- 0.55 units for the mosque.
    gx, gy = spec.footprint_centre
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
    # Sized from the real projected extremes in both axes, centred on the aim
    # point. Horizontal extent alone is not enough: a two-storey house reaches
    # much further in screen-vertical than in screen-horizontal, and framing it by
    # width ran its merlons 4.5px off the top of the canvas.
    cam_data.ortho_scale = ortho_scale_for(
        [(p.x, p.y, p.z) for p in pts], FRAME_MARGIN, aim=(gx, gy, gz)
    )
    # No shift. The camera already aims at the footprint's ground centre, and
    # drawStructureSprite anchors the sprite at 0.5 on the tile centre, so leaving
    # the aim point at the canvas centre makes the two coincide by definition
    # rather than by tuning. It is also what makes badgeTopPx meaningful.
    cam_data.shift_y = 0.0

    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = (gx, gy, gz)
    bpy.context.collection.objects.link(pivot)
    for o in meshes:
        o.parent = pivot
        # pivot.matrix_world is still identity here -- the depsgraph has not run
        # since pivot.location was set -- so inverting it would be a no-op and
        # parenting would shift the model by +centre.
        o.matrix_parent_inverse = Matrix.Translation((-gx, -gy, -gz))

    scale = tiles_across(cam_data.ortho_scale)
    bpy.context.view_layer.update()
    framing = check_framing(sc, cam, meshes, scale)
    return meshes, extent, scale, framing


#: Row buckets used to find the roof plane. 64 over a 512px frame is 8px a bucket
#: -- fine enough to separate a parapet from a spire, coarse enough not to be moved
#: by one stray vertex.
ROOF_ROWS = 64
#: How wide a row must be, against the widest row, to count as roof rather than
#: spire. 0.45 skips the mosque's minaret and keeps its dome shoulder.
ROOF_BROAD_FRAC = 0.45


def check_framing(scene, cam, meshes, scale):
    """Where the art lands in the frame, measured through the camera.

    Reading the rendered PNG would be the obvious way, but Blender ships no PIL,
    and projecting vertices is more precise anyway: it gives the true silhouette
    bounds rather than bounds thresholded at some alpha cut.

    Returns the opaque box in px and the badge offset the renderer needs. Raises
    if the art is closer to an edge than MIN_EDGE_CLEARANCE_PX, so a cropped
    render never reaches the gate.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    us, vs = [], []
    for o in meshes:
        eo = o.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            p = world_to_camera_view(scene, cam, eo.matrix_world @ v.co)
            us.append(p.x)
            vs.append(p.y)
        eo.to_mesh_clear()
    # world_to_camera_view is normalised with y up from the bottom; image rows run
    # down from the top.
    left = min(us) * SIZE
    right = max(us) * SIZE
    top = (1.0 - max(vs)) * SIZE
    bottom = (1.0 - min(vs)) * SIZE
    clearance = framing_clearance(top, left, bottom, right, SIZE)
    badge = badge_top_px(top, SIZE, scale)

    # The roof plane, which is not the same thing as the top of the art. badgeTopPx
    # is the topmost opaque row, so for the mosque it is the tip of the *minaret* --
    # correct for a badge floating clear of the building, and wrong for anything
    # meant to stand on it. Garrison figures placed there hovered above the dome.
    #
    # So: bin the projected points into rows, and take the highest row where the
    # silhouette is still broad. A minaret or a spire is narrow and gets skipped; a
    # roof, a parapet or a dome shoulder is wide and does not.
    widths = {}
    for u, v in zip(us, vs):
        row = int((1.0 - v) * ROOF_ROWS)
        lo_hi = widths.get(row)
        if lo_hi is None:
            widths[row] = [u, u]
        else:
            if u < lo_hi[0]:
                lo_hi[0] = u
            if u > lo_hi[1]:
                lo_hi[1] = u
    spans = {r: (hi_ - lo_) for r, (lo_, hi_) in widths.items()}
    broadest = max(spans.values()) if spans else 0.0
    broad_rows = [r for r, w in spans.items() if w >= ROOF_BROAD_FRAC * broadest]
    roof_row = (min(broad_rows) / ROOF_ROWS) * SIZE if broad_rows else top
    roof = badge_top_px(roof_row, SIZE, scale)
    print(
        f"  framing: rows {top:.1f}..{bottom:.1f} cols {left:.1f}..{right:.1f} "
        f"of {SIZE}, clearance {clearance:.1f}px, badgeTopPx {badge:.1f}, "
        f"roofTopPx {roof:.1f}"
    )
    if clearance < MIN_EDGE_CLEARANCE_PX:
        raise SystemExit(
            f"art comes within {clearance:.1f}px of a frame edge (need "
            f"{MIN_EDGE_CLEARANCE_PX}). Raise FRAME_MARGIN, currently "
            f"{FRAME_MARGIN}, or shrink the model."
        )
    return {
        "badge_top_px": round(badge, 2),
        "roof_top_px": round(roof, 2),
        "clearance_px": round(clearance, 2),
    }


def render_building(spec):
    """One building, one sprite."""
    meshes, extent, scale, framing = setup(spec)
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
        # Derived, not authored: extent * FRAME_MARGIN * sqrt(2) / (2 * 3), which
        # is "3 world units draw as one tile" solved for this field. The mosque's
        # hand-tuned 3.6 was about 9% larger than that.
        "scale": round(scale, 4),
        "footprintTiles": spec.footprint_tiles,
        # Display px from the sprite anchor up to the top of the art. The renderer
        # places integrity bars and garrison pips with this; using heightPx put
        # them 67px inside the mosque, behind the dome.
        "badgeTopPx": framing["badge_top_px"],
        "roofTopPx": framing["roof_top_px"],
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
    print(
        f"DONE 1 frame -> {spec.out_dir} (extent {extent:.2f}, scale {scale:.3f}, "
        f"badgeTopPx {framing['badge_top_px']}, roofTopPx {framing['roof_top_px']})"
    )


MOSQUE = BuildingSpec(
    src=os.path.abspath("art/src/buildings/mosque.blend"),
    out_dir=os.path.abspath("assets/sprites/BLD_MOSQUE"),
    unit="mosque",
    credit="Original work for Roaring Lions (CC BY-SA 4.0)",
    # data/maps: the mosque is a 3x3 block of 'm'.
    footprint_tiles=3,
    colour_key="limestone.1",
    brick=True,
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


HOUSE = BuildingSpec(
    src=os.path.abspath("art/src/buildings/house.blend"),
    out_dir=os.path.abspath("assets/sprites/BLD_HOUSE"),
    unit="house",
    credit="Original work for Roaring Lions (CC BY-SA 4.0)",
    # data/maps: 'h' is four columns across three rows.
    footprint_tiles=4,
    colour_key="limestone.3",
    brick=True,
)


SHANTY = BuildingSpec(
    src=os.path.abspath("art/src/buildings/shanty.blend"),
    out_dir=os.path.abspath("assets/sprites/BLD_SHANTY"),
    unit="shanty",
    credit="Original work for Roaring Lions (CC BY-SA 4.0)",
    footprint_tiles=3,
    colour_key="dust.1",
    # Flat, not coursed. Breeze block is not brick, and at this size the coursing
    # would be the only thing distinguishing it from the house's masonry.
    brick=False,
)

WAREHOUSE = BuildingSpec(
    src=os.path.abspath("art/src/buildings/warehouse.blend"),
    out_dir=os.path.abspath("assets/sprites/BLD_WAREHOUSE"),
    unit="warehouse",
    credit="Original work for Roaring Lions (CC BY-SA 4.0)",
    footprint_tiles=4,
    colour_key="gunmetal.1",
    brick=False,
)

APARTMENT = BuildingSpec(
    src=os.path.abspath("art/src/buildings/apartment.blend"),
    out_dir=os.path.abspath("assets/sprites/BLD_APARTMENT"),
    unit="apartment",
    credit="Original work for Roaring Lions (CC BY-SA 4.0)",
    footprint_tiles=5,
    colour_key="limestone.4",
    brick=True,
)

CONCRETE = BuildingSpec(
    src=os.path.abspath("art/src/buildings/concrete.blend"),
    out_dir=os.path.abspath("assets/sprites/BLD_CONCRETE"),
    unit="concrete",
    credit="Original work for Roaring Lions (CC BY-SA 4.0)",
    # 2, not 3: no map places '#', so this footprint is a choice rather than a
    # measurement. See author_concrete.py -- tall and narrow was the only
    # silhouette niche left once the other five were authored.
    footprint_tiles=2,
    colour_key="limestone.4",
    # Poured concrete, so no coursing -- and the blankness is the point.
    brick=False,
)


BUILDINGS = {
    "mosque": MOSQUE,
    "house": HOUSE,
    "shanty": SHANTY,
    "warehouse": WAREHOUSE,
    "apartment": APARTMENT,
    "concrete": CONCRETE,
}


def main():
    # Blender hands the script everything after `--`.
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    wanted = argv if argv else list(BUILDINGS)
    unknown = [w for w in wanted if w not in BUILDINGS]
    if unknown:
        raise SystemExit(
            f"unknown building(s) {unknown}. Known: {sorted(BUILDINGS)}"
        )
    for name in wanted:
        print(f"=== {name} ===")
        render_building(BUILDINGS[name])


main()
