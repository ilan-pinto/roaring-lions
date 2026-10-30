"""The R1 render rig for the wetland art (GH-871 P3): scene, light, camera and
materials, in code, so the rig cannot drift between plates.

Imported by `render_wetland_r1.py` (inside Blender). It is a PREVIEW rig for the
approval plates, not the game: nothing here is exported and no material it makes
is ever written into a GLB (decor and props ship zero materials).

## Invariants (all of them break silently)

* The OBJECT rotates, never the camera or the sun (turntables yaw the piece).
  A camera that turned instead would swing every cast shadow.
* The camera is the game's: orthographic, 30 degrees elevation, azimuth 225
  (`tools/dimetric.py`, the one place that geometry is defined). The scale is
  derived from the game's tile (64 px wide at zoom 1, 3 m a tile): 15.085 px/m
  across the ground at zoom 1, 13.06 px/m up the screen for a vertical metre.
  The art-numbers sheet quotes 12.2 px/m vertical (+/-20%); this rig measures
  from the camera, so a 1.8 m figure is 23.5 px here, not 22.
* The light is the spec's `rainLight` over `day` (4.5): the sun keeps the game's
  SIDE direction (`SUN_DIRECTION`, `lighting.ts`: to-sun (-0.406, 0.406, 0.819) in
  Blender's frame), at intensity 1.2 and colour `overcast.0`; the hemisphere is
  1.35 of `overcast.1` over a `dust.4` ground bounce; the shadow strength is 0.45,
  built as two suns (an unshadowed one at 0.55 and a shadowed one at 0.45, which is
  exactly `1 - 0.45 * (1 - visibility)`). three.js divides both by pi
  (`BRDF_Lambert`), so a world radiance of `I / pi` reproduces the hemisphere and a
  Blender sun of strength `I` reproduces the sun; the calibration stage reads the
  numbers back from a white plane to prove it.
* The view transform is the engine's own: ACES at exposure 1.0 over linear
  radiance, then sRGB. Blender writes RAW linear 16-bit PNGs (view transform
  `Raw`) and `wetland_r1_sheet.py` applies three.js's ACES fit, so the plates
  carry the game's tone curve and not Blender's `Standard` or `Filmic`.
* Film transparent, RGBA. A plate's ground is a plane in the scene so shadows land
  on something; silhouettes drop it.
* No `mathutils.noise`.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import AZIMUTH, ELEVATION  # noqa: E402

# --- the game's numbers ---------------------------------------------------------

UNITS_PER_TILE = 3.0  # metres a tile
TILE_W = 64
PX_PER_M_GROUND = (TILE_W / 2.0) / (UNITS_PER_TILE * math.cos(math.radians(45.0)))  # 15.085 at zoom 1
PX_PER_M_VERTICAL = PX_PER_M_GROUND * math.cos(ELEVATION)  # 13.06 at zoom 1

SUN_TO = Vector((-0.406, 0.406, 0.819)).normalized()  # lighting.ts, Blender's frame

# rainLight over day (spec 4.5). Hexes from data/palette.json, post S-6.
RAIN = dict(
    sun_intensity=1.2,
    sun_hex="#C4C8C9",  # overcast.0
    hemi_intensity=1.35,
    sky_hex="#9FA9B5",  # overcast.1
    ground_hex="#96703C",  # dust.4, the ground bounce (unchanged by rainLight)
    shadow_strength=0.45,
    sun_angle=math.radians(7.0),  # a soft overcast shadow
)
DAY = dict(
    sun_intensity=2.6,
    sun_hex="#F2E8D5",  # limestone.0
    hemi_intensity=0.9,
    sky_hex="#A9C4D1",  # water.0
    ground_hex="#96703C",
    shadow_strength=1.0,
    sun_angle=math.radians(1.5),
)


def srgb_to_linear(c):
    c = max(0.0, min(1.0, c))
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_linear(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255.0) for i in (0, 2, 4))


def px_per_m(zoom):
    return PX_PER_M_GROUND * zoom


# --- scene ----------------------------------------------------------------------


def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_render(width, height, samples=64, transparent=True):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 2
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.use_adaptive_sampling = False
    sc.render.resolution_x = int(width)
    sc.render.resolution_y = int(height)
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.filter_size = 1.0
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "16"
    # Raw: no view transform. Linear radiance goes into the file; the ACES fit is
    # applied afterwards, in wetland_r1_sheet.py.
    sc.view_settings.view_transform = "Raw"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    sc.display_settings.display_device = "sRGB"
    return sc


def make_camera():
    cam_data = bpy.data.cameras.new("CAM")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.1
    cam_data.clip_end = 400.0
    cam = bpy.data.objects.new("CAM", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def aim_camera(cam, target, frame_width_m, dist=120.0, elevation=None):
    """Orthographic camera at the game's elevation and azimuth looking at
    `target`, framing `frame_width_m` metres across the image's WIDTH (Blender's
    ortho scale is the larger of width and height; every frame here is wider than
    it is tall or square). Never rotated per object: the object rotates."""
    el = ELEVATION if elevation is None else elevation
    d = Vector((math.cos(el) * math.cos(AZIMUTH), math.cos(el) * math.sin(AZIMUTH), math.sin(el)))
    cam.location = Vector(target) + d * dist
    cam.rotation_euler = (math.pi / 2.0 - el, 0.0, AZIMUTH + math.pi / 2.0)
    cam.data.ortho_scale = frame_width_m


def make_world(light):
    """The hemisphere as a world radiance that reproduces three.js's
    `mix(ground, sky, 0.5 + 0.5 * N.y)` irradiance for ANY normal: a radiance linear
    in z, `a + b z`, gives E(N) / pi = a + (2/3) b N.z, so a = (g + s) / 2 and
    b = 0.75 (s - g), times I / pi, clamped at 0."""
    world = bpy.data.worlds.new("rain_world")
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    k = light["hemi_intensity"] / math.pi
    s = hex_linear(light["sky_hex"])
    g = hex_linear(light["ground_hex"])
    # In a world shader the Generated coordinate IS the unit direction, in [-1, 1]
    # (measured: probe_gen, the camera's own direction read back as (0.61, 0.61, -0.5)).
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    zmap = nt.nodes.new("ShaderNodeMath")
    zmap.operation = "MULTIPLY_ADD"
    zmap.inputs[1].default_value = 1.0
    zmap.inputs[2].default_value = 0.0
    nt.links.new(sep.outputs["Z"], zmap.inputs[0])
    comps = []
    for ch in range(3):
        a = (g[ch] + s[ch]) / 2.0 * k
        b = 0.75 * (s[ch] - g[ch]) * k
        m = nt.nodes.new("ShaderNodeMath")
        m.operation = "MULTIPLY_ADD"
        m.inputs[1].default_value = b
        m.inputs[2].default_value = a
        m.use_clamp = False
        nt.links.new(zmap.outputs[0], m.inputs[0])
        mx = nt.nodes.new("ShaderNodeMath")
        mx.operation = "MAXIMUM"
        mx.inputs[1].default_value = 0.0
        nt.links.new(m.outputs[0], mx.inputs[0])
        comps.append(mx)
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    for ch, mx in enumerate(comps):
        nt.links.new(mx.outputs[0], comb.inputs[ch])
    nt.links.new(comb.outputs[0], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs[0], out.inputs[0])
    bpy.context.scene.world = world
    return world


def make_suns(light):
    """The sun as two suns whose sum is the game's: an unshadowed one at
    `1 - shadow_strength` and a shadowed one at `shadow_strength`."""
    suns = []
    q = SUN_TO.to_track_quat("Z", "Y")
    col = hex_linear(light["sun_hex"])
    for name, share, shadow in (
        ("sun_lit", 1.0 - light["shadow_strength"], False),
        ("sun_shadow", light["shadow_strength"], True),
    ):
        if share <= 1e-6:
            continue
        data = bpy.data.lights.new(name, "SUN")
        data.energy = light["sun_intensity"] * share
        data.color = col
        data.angle = light["sun_angle"]
        data.use_shadow = shadow
        ob = bpy.data.objects.new(name, data)
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = q
        bpy.context.collection.objects.link(ob)
        suns.append(ob)
    return suns


# --- materials (preview only, never exported) -----------------------------------


def flat_material(name, hexcolor, roughness=0.85, cull=False):
    """The runtime's material for decor, props and units alike: a lit-step albedo
    on a MeshStandardMaterial, roughness 0.85 (`WORLD_ROUGHNESS`), metalness 0.
    `cull` mimics three.js's default `FrontSide`: a back face draws as nothing
    (Cycles has no backface-culling switch, so it is a Transparent mix on the
    Geometry node's `Backfacing`)."""
    key = name + ("|cull" if cull else "")
    m = bpy.data.materials.get(key)
    if m is not None:
        return m
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    r, g, b = hex_linear(hexcolor)
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if cull:
        out = nt.nodes["Material Output"]
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(geo.outputs["Backfacing"], mix.inputs["Fac"])
        nt.links.new(bsdf.outputs["BSDF"], mix.inputs[1])
        nt.links.new(tr.outputs["BSDF"], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def emission_material(name, rgb):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def holdout_material():
    m = bpy.data.materials.get("holdout")
    if m is not None:
        return m
    m = bpy.data.materials.new("holdout")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    ho = nt.nodes.new("ShaderNodeHoldout")
    nt.links.new(ho.outputs[0], out.inputs["Surface"])
    return m


def wire_material(line=0.92, face=0.045, pixel=1.1):
    """Dark opaque faces (so hidden lines are hidden) with a one-pixel white line
    on every triangle edge: a wire-shaded twin that carries the triangle count."""
    m = bpy.data.materials.get("wire")
    if m is not None:
        return m
    m = bpy.data.materials.new("wire")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    wf = nt.nodes.new("ShaderNodeWireframe")
    wf.use_pixel_size = True
    wf.inputs["Size"].default_value = pixel
    e_line = nt.nodes.new("ShaderNodeEmission")
    e_line.inputs["Color"].default_value = (line, line, line, 1.0)
    e_face = nt.nodes.new("ShaderNodeEmission")
    e_face.inputs["Color"].default_value = (face, face, face, 1.0)
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(wf.outputs["Fac"], mix.inputs["Fac"])
    nt.links.new(e_face.outputs[0], mix.inputs[1])
    nt.links.new(e_line.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def assign(ob, material):
    ob.data.materials.clear()
    ob.data.materials.append(material)


# --- ground ---------------------------------------------------------------------


def make_ground(hexcolor, size_m=60.0, name="ground", z=0.0, centre=(0.0, 0.0)):
    """A flat plane of the given albedo (the game's ground tone at ratio 1)."""
    mesh = bpy.data.meshes.new(name)
    h = size_m / 2.0
    cx, cy = centre
    mesh.from_pydata([(cx - h, cy - h, z), (cx + h, cy - h, z), (cx + h, cy + h, z), (cx - h, cy + h, z)], [], [(0, 1, 2, 3)])
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(flat_material(f"ground_{hexcolor}", hexcolor, roughness=0.62))
    return ob


# --- rendering ------------------------------------------------------------------


def render_to(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def object_bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        for c in ob.bound_box:
            p = ob.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi
