"""Showcase model, materials, animation and camera for a wheeled 8x8 APC.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/showcase/apc_showcase.py -- --render 1

NOT the sprite pipeline. This is a cinematic/turntable asset: perspective
camera, HDRi world, mud ground, PBR camouflage, 250 frames of path animation at
1920x1080. None of that can feed assets/sprites/, which needs 16 orthographic
facings at 256px on transparent film with an exact palette match -- see
tools/render_vehicle.py and tools/validate_assets.py. Kept in its own directory
so the two are never confused.

Structure:
    1  scene reset, units, engine
    2  hull: base block, raked glacis, fenders with boolean wheel wells, bevel
    3  wheels: rim inset/extrude, displaced tread, 8x8 by linked instancing
    4  turret, hatches, bolt-on plates, headlights
    5  procedural materials: camo paint with pointiness wear, rubber, glass, mud
    6  animation: Bezier S-curve, Follow Path, rolling wheels, turret sweep
    7  ground, camera, sun, world
    8  render settings
"""
import math
import os
import sys

import bpy
from mathutils import Vector

# --- dimensions ------------------------------------------------------------
HULL_X, HULL_Y, HULL_Z = 2.5, 7.0, 1.2      # half-extents come from the brief's scale
WHEEL_R, WHEEL_D = 0.6, 0.45
AXLES_Y = (-2.55, -1.05, 0.95, 2.45)         # four axles along the travel axis
FENDER_Z = -0.15
FRAMES = 250
CURVE_LEN_HINT = 50.0                        # S-curve extent along +Y
TURRET_SWEEP_DEG = 45.0

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--render" in ARGV
OUT_DIR = os.path.abspath("art/showcase")


# ---------------------------------------------------------------- 1. scene --
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.frame_start, scene.frame_end = 1, FRAMES
    return scene


def link(ob):
    bpy.context.collection.objects.link(ob)
    return ob


def active(ob):
    """Make `ob` the sole selected + active object. Operators need both, and
    forgetting the pair is the classic bpy scripting bug."""
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    return ob


def cleanup_mesh(ob, tris=False):
    """Merge doubles and optionally triangulate. N-gons from booleans are the
    usual source of shading artefacts, so this runs after every boolean."""
    active(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    if tris:
        bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY", ngon_method="BEAUTY")
    bpy.ops.object.mode_set(mode="OBJECT")


def smooth(ob, angle_deg=30.0):
    """Shade smooth with an angle threshold.

    `mesh.use_auto_smooth` was removed in Blender 4.1; the replacement is the
    shade_smooth_by_angle operator. Guarded so the script survives either.
    """
    active(ob)
    bpy.ops.object.shade_smooth()
    if hasattr(bpy.ops.object, "shade_smooth_by_angle"):
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
        except (RuntimeError, TypeError):
            pass
    elif hasattr(ob.data, "use_auto_smooth"):
        ob.data.use_auto_smooth = True
        ob.data.auto_smooth_angle = math.radians(angle_deg)


def bevel(ob, width=0.02, segments=2):
    active(ob)
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(40.0)
    return m


# ----------------------------------------------------------------- 2. hull --
def build_hull():
    """Base block with a drastically raked glacis, front and lower front.

    The rake is done by moving vertices rather than by boolean, because a
    boolean here would leave N-gons across the largest, most visible face.
    """
    bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 0))
    hull = bpy.context.active_object
    hull.name = "APC_Hull"
    hull.scale = (HULL_X / 2.0, HULL_Y / 2.0, HULL_Z / 2.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Rake the front (+Y). Top-front vertices slide back, bottom-front slide
    # forward: the classic wedge that gives a wheeled carrier its nose.
    for v in hull.data.vertices:
        if v.co.y > 0:
            if v.co.z > 0:
                v.co.y -= HULL_Y * 0.30
            else:
                v.co.y += HULL_Y * 0.06
                v.co.z += HULL_Z * 0.10
    # Narrow the roof so the flanks lean outward toward the ground.
    for v in hull.data.vertices:
        if v.co.z > 0:
            v.co.x *= 0.86

    # Upper body: a shallower second block, set back, giving the two-step
    # profile a single wedge cannot.
    bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, -0.55, HULL_Z / 2.0 + 0.34))
    upper = bpy.context.active_object
    upper.name = "APC_Upper"
    upper.scale = (HULL_X / 2.0 * 0.80, HULL_Y / 2.0 * 0.62, 0.34)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for v in upper.data.vertices:
        if v.co.z > 0:
            v.co.x *= 0.88

    active(hull)
    upper.select_set(True)
    bpy.context.view_layer.objects.active = hull
    bpy.ops.object.join()
    hull = bpy.context.active_object
    hull.name = "APC_Hull"
    cleanup_mesh(hull)
    return hull


def build_fenders(hull):
    """Narrow fender rails down each flank, with real semicircular wheel wells
    cut by boolean difference so the wheels sit inside the body."""
    cutters = []
    for i, y in enumerate(AXLES_Y):
        for sx, tag in ((-1, "l"), (1, "r")):
            bpy.ops.mesh.primitive_cylinder_add(
                radius=WHEEL_R * 1.18, depth=HULL_X * 0.5, vertices=24,
                location=(sx * HULL_X * 0.5, y, FENDER_Z + 0.05),
                rotation=(0, math.radians(90), 0),
            )
            c = bpy.context.active_object
            c.name = f"cut_{tag}{i}"
            cutters.append(c)

    fenders = []
    for sx, tag in ((-1, "l"), (1, "r")):
        bpy.ops.mesh.primitive_cube_add(size=2.0, location=(sx * (HULL_X * 0.46), 0, FENDER_Z))
        f = bpy.context.active_object
        f.name = f"APC_Fender_{tag}"
        f.scale = (0.16, HULL_Y / 2.0 * 0.92, 0.30)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for c in cutters:
            m = f.modifiers.new(f"Cut_{c.name}", "BOOLEAN")
            m.operation = "DIFFERENCE"
            m.object = c
            m.solver = "EXACT"
        active(f)
        bpy.ops.object.convert(target="MESH")
        cleanup_mesh(bpy.context.active_object, tris=False)
        fenders.append(bpy.context.active_object)

    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    return fenders


# --------------------------------------------------------------- 3. wheels --
def build_wheel_master():
    """One wheel, built from explicit rings rather than stacked operators.

    The first version did this the way the brief describes -- primitive cylinder,
    select the caps, `mesh.inset` twice, extrude and `shrink_fatten` inward, then
    a subdivision plus a STUCCI displace for tread. It rendered as open scoops:
    insetting both opposite caps in one operator call, then displacing the result,
    left the sidewalls inverted, and nothing about the failure was visible until
    a 1920x1080 frame came back.

    Built from rings instead, so the topology is known rather than discovered:

        r_out  tyre tread band, the full radius
        r_sh   shoulder, where the tread rolls off toward the rim
        r_rim  the wheel face
        r_hub  centre boss

    Three concentric rings per side plus a tread band is a real wheel section,
    it needs no modifiers, and the tread is a shallow zig-zag on the outer ring
    -- amplitude 12 mm, because a tread is a lighting cue at any honest viewing
    distance rather than a silhouette one.
    """
    seg = 28
    r_out, r_sh, r_rim, r_hub = WHEEL_R, WHEEL_R * 0.86, WHEEL_R * 0.58, WHEEL_R * 0.16
    hw = WHEEL_D / 2.0
    tread_amp = 0.012

    verts, faces = [], []

    def ring(radius, x, wobble=0.0):
        start = len(verts)
        for i in range(seg):
            a = 2.0 * math.pi * i / seg
            r = radius + (wobble if i % 2 == 0 else -wobble)
            verts.append((x, r * math.cos(a), r * math.sin(a)))
        return start

    # Rings outboard -> inboard, and the x order matters as much as the radii.
    # The first attempt put the shoulder at full depth with the rim recessed,
    # which dished each wheel into a hollow tube you could see straight through.
    # The wheel face is the outermost plane; depth decreases as radius grows.
    o_hub = ring(r_hub, hw)
    o_rim = ring(r_rim, hw)
    o_sh = ring(r_sh, hw * 0.94)
    t_o = ring(r_out, hw * 0.80, tread_amp)
    t_i = ring(r_out, -hw * 0.80, tread_amp)
    i_sh = ring(r_sh, -hw * 0.94)
    i_rim = ring(r_rim, -hw)
    i_hub = ring(r_hub, -hw)

    def band(a, b):
        for i in range(seg):
            j = (i + 1) % seg
            faces.append((a + i, a + j, b + j, b + i))

    band(o_hub, o_rim)   # outboard face
    band(o_rim, o_sh)
    band(o_sh, t_o)      # outboard shoulder
    band(t_o, t_i)       # tread
    band(t_i, i_sh)
    band(i_sh, i_rim)
    band(i_rim, i_hub)   # inboard face
    # Cap the hubs.
    faces.append(tuple(range(o_hub + seg - 1, o_hub - 1, -1)))
    faces.append(tuple(range(i_hub, i_hub + seg)))

    me = bpy.data.meshes.new("APC_Wheel")
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    w = bpy.data.objects.new("APC_Wheel", me)
    link(w)
    cleanup_mesh(w)
    smooth(w, 34.0)
    return w


def instance_wheels(master):
    """8x8: linked duplicates sharing one mesh datablock (the scripted
    equivalent of alt+D), so eight wheels cost one wheel of memory."""
    out = []
    x = HULL_X * 0.5 + 0.02
    for i, y in enumerate(AXLES_Y):
        for sx, tag in ((-1, "l"), (1, "r")):
            ob = bpy.data.objects.new(f"APC_Wheel_{tag}{i}", master.data)
            ob.location = (sx * x, y, FENDER_Z + 0.05)
            ob.rotation_euler = (0, 0, 0)
            link(ob)
            out.append(ob)
    bpy.data.objects.remove(master, do_unlink=True)
    return out


# ------------------------------------------------- 4. turret and greebles --
def build_turret():
    """Low-profile unmanned turret: a squashed octagonal prism plus barrel."""
    bpy.ops.mesh.primitive_cylinder_add(radius=0.62, depth=0.38, vertices=8,
                                        location=(0, -1.35, HULL_Z / 2.0 + 0.68 + 0.19))
    t = bpy.context.active_object
    t.name = "APC_Turret"
    for v in t.data.vertices:          # taper the top: an angular, faceted mount
        if v.co.z > 0:
            v.co.x *= 0.74
            v.co.y *= 0.74
    bevel(t, 0.015, 2)
    smooth(t, 30.0)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.055, depth=1.9, vertices=12,
                                        location=(0, 0.0, 0.0),
                                        rotation=(math.radians(90), 0, 0))
    b = bpy.context.active_object
    b.name = "APC_Barrel"
    b.location = (0, -1.35 + 0.95, HULL_Z / 2.0 + 0.68 + 0.22)
    b.parent = t
    b.matrix_parent_inverse = t.matrix_world.inverted()
    smooth(b, 30.0)
    return t, b


def build_greebles(hull):
    greebles = []
    # Two circular hatches forward on the roof.
    for i, x in enumerate((-0.52, 0.52)):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=0.07, vertices=20,
                                            location=(x, 1.05, HULL_Z / 2.0 + 0.035))
        h = bpy.context.active_object
        h.name = f"APC_Hatch_{i}"
        bevel(h, 0.012, 2)
        smooth(h, 30.0)
        greebles.append(h)

    # Bolt-on plates down each flank: eight small slabs, deliberately uneven so
    # the flank does not read as a repeating pattern.
    # Sat at HULL_X * 0.5 in the first pass and read as spikes: the hull roof is
    # narrowed to 0.86 of the floor, so the full half-width is outside the body
    # at plate height. 0.40 keeps them against the flank.
    spans = (-2.3, -1.6, -0.85, -0.1, 0.55, 1.25, 1.95, 2.5)
    for i, y in enumerate(spans):
        sx = -1 if i % 2 == 0 else 1
        bpy.ops.mesh.primitive_cube_add(size=2.0,
                                        location=(sx * (HULL_X * 0.40), y, 0.12))
        p = bpy.context.active_object
        p.name = f"APC_Plate_{i}"
        p.scale = (0.05, 0.30 + (i % 3) * 0.05, 0.22)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bevel(p, 0.008, 1)
        greebles.append(p)

    # Headlights in protected housings on the front fenders.
    lights = []
    for sx, tag in ((-1, "l"), (1, "r")):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.13, depth=0.10, vertices=16,
                                            location=(sx * (HULL_X * 0.40), HULL_Y * 0.46, 0.12),
                                            rotation=(math.radians(90), 0, 0))
        g = bpy.context.active_object
        g.name = f"APC_Headlight_{tag}"
        smooth(g, 30.0)
        lights.append(g)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=0.13, vertices=16,
                                            location=(sx * (HULL_X * 0.40), HULL_Y * 0.44, 0.12),
                                            rotation=(math.radians(90), 0, 0))
        hs = bpy.context.active_object
        hs.name = f"APC_LightHousing_{tag}"
        bevel(hs, 0.01, 1)
        smooth(hs, 30.0)
        greebles.append(hs)
    return greebles, lights


# ------------------------------------------------------------ 5. materials --
def _nt(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return nt, bsdf


def paint_material():
    """Camouflage paint: Voronoi into a two-stop ramp, matte roughness from
    noise, and edge wear driven by geometry pointiness.

    Pointiness is why this needs no UVs: it reports how convex a shading point
    is, so the sharpest armour edges pick up the worn metal tone automatically
    wherever the geometry happens to be sharp.
    """
    mat = bpy.data.materials.new("APC_Paint")
    nt, bsdf = _nt(mat)

    # Object coordinates, so the pattern rides the hull instead of swimming as
    # the vehicle drives along the path.
    coord = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 0.9
    nt.links.new(coord.outputs["Object"], vor.inputs["Vector"])
    camo = nt.nodes.new("ShaderNodeValToRGB")
    camo.color_ramp.elements[0].position = 0.34
    camo.color_ramp.elements[0].color = (0.055, 0.085, 0.045, 1.0)   # NATO green
    camo.color_ramp.elements[1].position = 0.62
    camo.color_ramp.elements[1].color = (0.075, 0.055, 0.035, 1.0)   # dark brown
    camo.color_ramp.interpolation = "CONSTANT"
    nt.links.new(vor.outputs["Distance"], camo.inputs["Fac"])

    geo = nt.nodes.new("ShaderNodeNewGeometry")
    # Pointiness runs 0..1 with flat surfaces near 0.5, so the window has to be
    # narrow and sit just above it. A wide window (0.48-0.62 was the first
    # attempt) paints the whole hull as worn metal, because bevelling every
    # edge makes almost nothing perfectly flat.
    wear = nt.nodes.new("ShaderNodeValToRGB")
    wear.color_ramp.elements[0].position = 0.545
    wear.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    wear.color_ramp.elements[1].position = 0.60
    wear.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    nt.links.new(geo.outputs["Pointiness"], wear.inputs["Fac"])

    metal = nt.nodes.new("ShaderNodeRGB")
    metal.outputs[0].default_value = (0.19, 0.19, 0.20, 1.0)
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MIX"
    nt.links.new(wear.outputs["Color"], mix.inputs["Fac"])
    nt.links.new(camo.outputs["Color"], mix.inputs["Color1"])
    nt.links.new(metal.outputs["Color"], mix.inputs["Color2"])
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])

    rough_tex = nt.nodes.new("ShaderNodeTexNoise")
    rough_tex.inputs["Scale"].default_value = 42.0
    rough_tex.inputs["Detail"].default_value = 12.0
    rmap = nt.nodes.new("ShaderNodeValToRGB")
    rmap.color_ramp.elements[0].position = 0.30
    rmap.color_ramp.elements[0].color = (0.78, 0.78, 0.78, 1.0)
    rmap.color_ramp.elements[1].position = 0.80
    rmap.color_ramp.elements[1].color = (0.96, 0.96, 0.96, 1.0)
    nt.links.new(rough_tex.outputs["Fac"], rmap.inputs["Fac"])
    nt.links.new(rmap.outputs["Color"], bsdf.inputs["Roughness"])
    if "Metallic" in bsdf.inputs:
        nt.links.new(wear.outputs["Color"], bsdf.inputs["Metallic"])
    return mat


def rubber_material():
    mat = bpy.data.materials.new("APC_Rubber")
    nt, bsdf = _nt(mat)
    bsdf.inputs["Base Color"].default_value = (0.017, 0.017, 0.018, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55
    return mat


def glass_material():
    mat = bpy.data.materials.new("APC_Glass")
    nt, bsdf = _nt(mat)
    bsdf.inputs["Base Color"].default_value = (0.92, 0.94, 0.96, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.04
    for name in ("Transmission Weight", "Transmission"):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = 1.0
            break
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.45
    return mat


def mud_material():
    mat = bpy.data.materials.new("Ground_Mud")
    nt, bsdf = _nt(mat)
    # Scaled for a 220 m plane: at 3.2 the whole ground fell inside one lobe and
    # read as flat brown. 26 puts the features at roughly a wheel's width.
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 26.0
    n.inputs["Detail"].default_value = 8.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.035, 0.026, 0.018, 1.0)
    ramp.color_ramp.elements[1].color = (0.095, 0.072, 0.048, 1.0)
    nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    disp = nt.nodes.new("ShaderNodeDisplacement")
    disp.inputs["Scale"].default_value = 0.10
    nt.links.new(n.outputs["Fac"], disp.inputs["Height"])
    out = [x for x in nt.nodes if x.type == "OUTPUT_MATERIAL"][0]
    nt.links.new(disp.outputs["Displacement"], out.inputs["Displacement"])
    mat.displacement_method = "BOTH"
    return mat


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ------------------------------------------------------------ 6. animation --
def action_fcurves(action):
    """Every fcurve in an action, across API generations.

    Blender 4.4 moved to slotted actions and 5.x dropped `Action.fcurves`
    entirely: curves now hang off layers -> strips -> channelbags. Written
    tolerantly so the script runs on either.
    """
    if action is None:
        return []
    direct = getattr(action, "fcurves", None)
    if direct is not None:
        return list(direct)
    out = []
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            bags = getattr(strip, "channelbags", None)
            if bags is None and hasattr(strip, "channelbag"):
                bags = [strip.channelbag(s) for s in getattr(action, "slots", [])]
            for cb in bags or []:
                if cb is not None:
                    out.extend(cb.fcurves)
    return out


def linearise(ob):
    """Force LINEAR interpolation on every key an object owns. Bezier easing on
    a path offset makes the vehicle accelerate and coast, which desynchronises
    the wheels computed from a linear distance."""
    ad = getattr(ob, "animation_data", None)
    if ad is None:
        return
    for fc in action_fcurves(getattr(ad, "action", None)):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def build_path():
    """An S-shape along +Y, 50 m of travel."""
    curve = bpy.data.curves.new("APC_Path", type="CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("BEZIER")
    pts = [(-6.0, -CURVE_LEN_HINT / 2.0, 0.0),
           (6.0, -CURVE_LEN_HINT / 6.0, 0.0),
           (-6.0, CURVE_LEN_HINT / 6.0, 0.0),
           (6.0, CURVE_LEN_HINT / 2.0, 0.0)]
    spline.bezier_points.add(len(pts) - 1)
    for bp, co in zip(spline.bezier_points, pts):
        bp.co = Vector(co)
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    ob = bpy.data.objects.new("APC_Path", curve)
    link(ob)
    return ob


def curve_length(curve_ob, samples=400):
    """Sample the evaluated curve to get its arc length -- needed to convert
    Follow Path offset into metres travelled, which is what the wheels roll on."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = curve_ob.evaluated_get(deps)
    me = ev.to_mesh()
    total = 0.0
    verts = [v.co.copy() for v in me.vertices]
    for a, b in zip(verts, verts[1:]):
        total += (b - a).length
    ev.to_mesh_clear()
    return total if total > 0 else CURVE_LEN_HINT


def animate(root, path_ob, wheels, turret):
    con = root.constraints.new("FOLLOW_PATH")
    con.target = path_ob
    con.use_curve_follow = True
    con.forward_axis = "FORWARD_Y"
    con.up_axis = "UP_Z"

    con.offset = 0.0
    con.keyframe_insert("offset", frame=1)
    con.offset = 100.0
    con.keyframe_insert("offset", frame=FRAMES)
    linearise(root)

    # Rolling wheels. offset is a percentage of the path, so metres travelled
    # is length * offset/100, and a wheel of radius r turns dist/r radians.
    # Keyframed in a loop rather than driven: one expression per wheel would
    # need the constraint's evaluated offset, which drivers cannot read cleanly.
    length = curve_length(path_ob)
    step = 5
    for f in range(1, FRAMES + 1, step):
        frac = (f - 1) / float(FRAMES - 1)
        dist = length * frac
        rot = -dist / WHEEL_R
        for w in wheels:
            w.rotation_euler = (rot, 0.0, 0.0)
            w.keyframe_insert("rotation_euler", index=0, frame=f)
    for w in wheels:
        linearise(w)

    # Turret sweep: 45 left, then 45 right, between frames 50 and 200.
    for frame, deg in ((50, 0.0), (110, TURRET_SWEEP_DEG),
                       (170, -TURRET_SWEEP_DEG), (200, 0.0)):
        turret.rotation_euler = (0.0, 0.0, math.radians(deg))
        turret.keyframe_insert("rotation_euler", index=2, frame=frame)
    print(f"path length {length:.2f} m; wheel turns {length / (2 * math.pi * WHEEL_R):.1f} revs")
    return length


# ----------------------------------------------- 7. ground, camera, lights --
def build_ground():
    bpy.ops.mesh.primitive_plane_add(size=220.0, location=(0, 0, FENDER_Z - WHEEL_R - 0.02))
    g = bpy.context.active_object
    g.name = "Ground"
    sub = g.modifiers.new("Sub", "SUBSURF")
    sub.subdivision_type = "SIMPLE"
    sub.levels = sub.render_levels = 6
    assign(g, mud_material())
    return g


def build_camera(root):
    """A chase camera at the brief's low angle.

    Parented to APC_Root rather than left in world space. A fixed camera at
    (10, -10, 2) frames the vehicle only at the start: the path is 63 m long, so
    by the midpoint the subject is a speck and Track To dutifully keeps that
    speck centred. Parenting makes the offset a chase rig, which is what a low
    artistic angle on a moving vehicle actually needs.
    """
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 50.0
    cam = bpy.data.objects.new("Camera", cam_data)
    link(cam)
    cam.parent = root
    cam.location = (10.0, -10.0, 2.0)
    con = cam.constraints.new("TRACK_TO")
    con.target = root
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    bpy.context.scene.camera = cam
    return cam


def build_lighting():
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.2
    sun_data.angle = math.radians(1.6)
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (math.radians(52.0), 0.0, math.radians(135.0))
    link(sun)

    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    env = nt.nodes.new("ShaderNodeTexEnvironment")   # left imageless on purpose
    bg.inputs["Strength"].default_value = 1.0
    bg.inputs["Color"].default_value = (0.29, 0.36, 0.46, 1.0)
    nt.links.new(env.outputs["Color"], bg.inputs["Color"]) if env.image else None
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return sun, world


# --------------------------------------------------------------------- run --
def main():
    scene = reset_scene()

    hull = build_hull()
    fenders = build_fenders(hull)
    bevel(hull, 0.02, 2)
    smooth(hull, 30.0)
    for f in fenders:
        bevel(f, 0.015, 2)
        smooth(f, 30.0)

    master = build_wheel_master()
    wheels = instance_wheels(master)
    turret, barrel = build_turret()
    greebles, lights = build_greebles(hull)

    paint, rubber, glass = paint_material(), rubber_material(), glass_material()
    for ob in [hull, turret, barrel] + fenders + greebles:
        assign(ob, paint)
    assign(wheels[0], rubber)          # shared mesh: one assignment covers all 8
    for g in lights:
        assign(g, glass)

    root = bpy.data.objects.new("APC_Root", None)
    link(root)
    for ob in [hull, turret] + fenders + wheels + greebles + lights:
        if ob.parent is None:
            ob.parent = root

    path_ob = build_path()
    animate(root, path_ob, wheels, turret)
    build_ground()
    build_camera(root)
    build_lighting()

    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    scene.render.image_settings.file_format = "PNG"
    scene.cycles.samples = 128

    os.makedirs(OUT_DIR, exist_ok=True)
    blend = os.path.join(OUT_DIR, "apc_showcase.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"saved {blend}: {len(bpy.data.objects)} objects, {FRAMES} frames")

    if DO_RENDER:
        scene.frame_set(120)
        scene.render.filepath = os.path.join(OUT_DIR, "apc_showcase_f120.png")
        bpy.ops.render.render(write_still=True)
        print(f"rendered {scene.render.filepath}")


if __name__ == "__main__":
    main()
