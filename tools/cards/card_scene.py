"""Blender stage for the store-card guide (GH-746 SC1): light, ground, camera, flat materials, render passes.

Blender-only. Deterministic: no random source, no `mathutils.noise`; EEVEE with a fixed sample count.

The LIGHT is the portrait rig's, unchanged (`tools/render_unit_portraits.py` rows 7-9, which is the garage's
and the card design's N3): a limestone.0 key at azimuth 40 deg / elevation 50 deg on the screen-left side, a
water.0 fill at azimuth 55 / elevation 20 on the right at 0.22 of the key's energy, a hemisphere of water.0
over dust.4. The key is a SIDE light, so the ground carries a cast shadow the painter will be told about.

The CAMERA is a perspective camera 8 deg above the horizon on Blender -Y with a 30 deg VERTICAL field of
view for the 3:2 card (N2). The guide is rendered at 4:3 (1536 x 1152) with the same focal length and the
same horizontal extent, so the 3:2 card is exactly its middle 1024 rows. `fit_camera` places it: distance
from the team's projected height, then a sensor shift for the feet line and the horizontal position.

PASS MODES (`set_mode`) swap each material slot between the lit flat-colour material and an emission
material carrying a code, so one scene gives the guide, the figure-id map, the hand-id map and the zone
maps without a second import.
"""
import math
import os
import sys

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import card_poses as cp  # noqa: E402
from dimetric import palette_linear  # noqa: E402

SAMPLES = 64
EXPOSURE_EV = 0.14
HEMI_INTENSITY = 0.7
AMBIENT_STRENGTH = HEMI_INTENSITY / math.pi
SUN_ANGLE_DEG = 1.5
ROUGHNESS = 0.85
GROUND_TONE = "limestone.3"
SKY_TONE = "water.0"
BOUNCE_TONE = "dust.4"
GROUND_HALF_M = 400.0


def lin(key):
    return tuple(palette_linear(key)[:3])


def hex_of(key):
    import json
    ramp, idx = key.split(".")
    with open(os.path.join(os.path.dirname(os.path.dirname(HERE)), "data", "palette.json")) as fh:
        return json.load(fh)["ramps"][ramp]["colors"][int(idx)]


# --------------------------------------------------------------------------------------- materials

def lit_material(name, tone):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*lin(tone), 1.0)
    b.inputs["Roughness"].default_value = ROUGHNESS
    b.inputs["Metallic"].default_value = 0.0
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(b.outputs["BSDF"], o.inputs["Surface"])
    return m


def code_material(name, code):
    """Emission carrying `code` (0-255) in all three channels. Read back with the Raw view transform."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    v = code / 255.0
    e.inputs["Color"].default_value = (v, v, v, 1.0)
    e.inputs["Strength"].default_value = 1.0
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return m


def clear_material(name):
    """Holdout-free full transparency: the pixel leaves alpha 0 and does not occlude."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    t = nt.nodes.new("ShaderNodeBsdfTransparent")
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(t.outputs["BSDF"], o.inputs["Surface"])
    return m


class Slot:
    """One material slot of one object: the lit flat tone and the pass codes it takes."""

    def __init__(self, ob, index, tone, fig, kind, track=None, tier=0):
        self.ob, self.index, self.tone = ob, index, tone
        self.fig, self.kind = fig, kind          # kind: body | hand | kit
        self.track, self.tier = track, tier
        self.mats = {}


# --------------------------------------------------------------------------------------- stage

def build_stage(width, height):
    """Light, world, ground. Returns nothing; the camera comes from `make_camera` once the team is posed."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = SAMPLES
    sc.eevee.use_shadows = True
    sc.render.filter_size = 1.5
    sc.render.resolution_x, sc.render.resolution_y = width, height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = EXPOSURE_EV
    sc.display_settings.display_device = "sRGB"

    def aim(obj, toward):
        obj.rotation_euler = (-toward).to_track_quat("-Z", "Y").to_euler()

    def toward(az, el, screen_left):
        a, e = math.radians(az), math.radians(el)
        sx = -1.0 if screen_left else 1.0
        return Vector((sx * math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))

    for name, energy, tone, az, el, left in (
        ("KEY", cp.KEY_ENERGY, cp.KEY_TONE, cp.KEY_AZ_DEG, cp.KEY_EL_DEG, True),
        ("FILL", cp.FILL_ENERGY, cp.FILL_TONE, cp.FILL_AZ_DEG, cp.FILL_EL_DEG, False),
    ):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = energy
        ld.color = lin(tone)
        ld.angle = math.radians(SUN_ANGLE_DEG)
        lo = bpy.data.objects.new(name, ld)
        bpy.context.scene.collection.objects.link(lo)
        aim(lo, toward(az, el, left))

    world = bpy.data.worlds.new("card_world")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = -1.0
    rng.inputs["From Max"].default_value = 1.0
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*lin(BOUNCE_TONE), 1.0)
    mix.inputs["B"].default_value = (*lin(SKY_TONE), 1.0)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = AMBIENT_STRENGTH
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Result"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sc.world = world

    # the ground: one big flat plane at z = 0. A pass mode hides it (it is not a figure).
    bpy.ops.mesh.primitive_plane_add(size=2 * GROUND_HALF_M, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "ground"
    g.data.materials.append(lit_material("ground_lit", GROUND_TONE))
    return g


def make_camera(width, height):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("CAM")
    cd.type = "PERSP"
    cd.sensor_fit = "HORIZONTAL"
    # the 3:2 card's vertical FOV is 30 deg; the same focal length serves the 4:3 render (same width)
    cd.angle = 2.0 * math.atan(1.5 * math.tan(math.radians(cp.CAM_VFOV_DEG) / 2.0))
    cd.clip_start, cd.clip_end = 0.05, 2000.0
    cam = bpy.data.objects.new("CAM", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def view_back():
    el = math.radians(cp.CAM_PITCH_DEG)
    return Vector((0.0, -math.cos(el), math.sin(el)))


def _aim(cam, target, dist, shift_x=0.0, shift_y=0.0):
    vb = view_back()
    cam.location = Vector(target) + vb * dist
    cam.rotation_euler = vb.to_track_quat("Z", "Y").to_euler()
    cam.data.shift_x, cam.data.shift_y = shift_x, shift_y
    bpy.context.view_layer.update()


def posed_points(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in objs:
        eo = o.evaluated_get(dg)
        me = eo.to_mesh()
        n = len(me.vertices)
        a = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", a)
        mw = np.array(eo.matrix_world)
        P = a.reshape(n, 3) @ mw[:3, :3].T + mw[:3, 3]
        out.append(P)
        eo.to_mesh_clear()
    return np.concatenate(out) if out else np.zeros((0, 3))


def project(cam, pts):
    """NDC of world points under `cam` (numpy, the render's own aspect): x from the left, y UP, both 0..1 over the
    full frame. Blender's shift: a positive shift_x moves the subject LEFT in frame, a positive shift_y DOWN
    (both in sensor-width units); `check_projection` compares this against world_to_camera_view."""
    sc = bpy.context.scene
    W, H = sc.render.resolution_x, sc.render.resolution_y
    inv = np.linalg.inv(np.array(cam.matrix_world))
    pc = np.c_[pts, np.ones(len(pts))] @ inv.T
    t = math.tan(cam.data.angle / 2.0)
    x = 0.5 + (pc[:, 0] / -pc[:, 2]) / (2.0 * t) - cam.data.shift_x
    y = 0.5 + (pc[:, 1] / -pc[:, 2]) * (W / H) / (2.0 * t) - cam.data.shift_y * (W / H)
    return x, y


def check_projection(cam, pts, n=25):
    """The numpy projection against Blender's, on `n` evenly spaced points. Returns the worst error (NDC)."""
    sc = bpy.context.scene
    idx = np.linspace(0, len(pts) - 1, n).astype(int)
    x, y = project(cam, pts[idx])
    worst = 0.0
    for k, i in enumerate(idx):
        v = world_to_camera_view(sc, cam, Vector(pts[i]))
        worst = max(worst, abs(v.x - x[k]), abs(v.y - y[k]))
    return worst


def _frame_fraction(cam, pts, width, height_card):
    """Fractions of the 3:2 card, measured from the top-left: (x0, x1, y0, y1)."""
    sc = bpy.context.scene
    full_h = sc.render.resolution_y
    x, y_up = project(cam, pts)
    ys = 1.0 - y_up
    off = (full_h - height_card) / 2.0
    ys_card = (ys * full_h - off) / height_card
    return x.min(), x.max(), ys_card.min(), ys_card.max()


def fit_camera(cam, pts, width, height_full, centre_x=0.5, team_height=cp.TEAM_HEIGHT_TARGET, height_card=cp.CARD_H):
    """Distance from the team's projected height (N2: 74-80 % of the card, target 77 %), then the sensor shift
    that puts the feet line at 88 % and the team's horizontal middle at the card's middle.
    Returns the final fractions (x0, x1, y0, y1) of the 3:2 card."""
    sc = bpy.context.scene
    lo = pts.min(axis=0)
    hi = pts.max(axis=0)
    target = (lo + hi) / 2.0
    dist = float((hi - lo).max()) * 2.0
    sx = sy = 0.0
    for _ in range(40):
        _aim(cam, target, dist, sx, sy)
        x0, x1, y0, y1 = _frame_fraction(cam, pts, width, height_card)
        h = y1 - y0
        dist *= h / team_height
        # shifts: positive shift_y moves the view up (the subject down in frame). The unit is the sensor width.
        # a point at card-fraction y sits at NDC (0.5 - y) * card_h / width of sensor-width units; shift by the error.
        _aim(cam, target, dist, sx, sy)
        x0, x1, y0, y1 = _frame_fraction(cam, pts, width, height_card)
        # feet at FEET_TARGET: move the subject down by (FEET_TARGET - y1) of the card height
        sy += (cp.FEET_TARGET - y1) * height_card / width
        # horizontal: team middle at the card's middle (shift_x positive moves the subject left)
        sx += ((x0 + x1) / 2.0 - centre_x)
    _aim(cam, target, dist, sx, sy)
    return _frame_fraction(cam, pts, width, height_card), dist, (sx, sy)
