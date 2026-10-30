"""The garage turntable's stage, reproduced in Blender (GH-826 redesign, R1).

Blender-only for the scene, numpy for the maths. The lead judged the infantry
kit on the GARAGE's close-up, so the approval render uses the garage's own
numbers (`packages/render/src/three/garage/garage-frame.ts`, `garage-view.ts`):

  * a PERSPECTIVE camera, vertical FOV 30 deg, 12 deg above the horizon, on the
    garage frame's +X looking back at the line of figures; it never moves;
  * the figures stand in a LINE across the screen, each turning on its own spot,
    spaced by `clearSpacing` (so no turn the player can make puts one figure
    inside another), the camera fitted once to the whole 360 deg sweep of the
    MAXIMUM kit (so a purchase never resizes the frame), margins 0.94 x 0.86;
  * a key (limestone.0, 3.2) 40 deg off the camera axis on the sun's screen side
    and 50 deg up, a cool fill (water.0, 0.7) 55 deg the other way and 20 deg up,
    a hemisphere (water.0 over dust.4, 0.7), exposure 1.1, ACES;
  * the arid open-ground sand (limestone.3) in a fading patch, squashed to the
    line's depth.

Heading 0 is `defaultYawDeg('figures')`: -40 deg, the broad face toward the key.
The garage's frame is three's (x toward the camera, y up, z along the line); the
glTF importer maps three (x, y, z) -> Blender (x, -z, y), a rotation, so a turn
`theta` about three's y is the same angle about Blender's z.

Not reproduced: the sand's albedo texture (a flat limestone.3 patch), the shadow
filter's exact softness, the vignette of the page behind the canvas (a radial
gradient is painted behind the figures), and the UI chrome.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dimetric import palette_linear  # noqa: E402
import inf_kit_stage as st  # noqa: E402

FOV_DEG = 30.0
ELEVATION_DEG = 12.0
MARGIN_X, MARGIN_Y = 0.94, 0.86
KEY_AZ, KEY_EL, KEY_I = 40.0, 50.0, 3.2
FILL_AZ, FILL_EL, FILL_I = 55.0, 20.0, 0.7
HEMI_I = 0.7
EXPOSURE = 1.1
BASE_YAW = -40.0           # defaultYawDeg('figures'): -KEY_AZIMUTH
LINE_GAP = 0.02
SWEEP_STEP = 15
SAND_RADIUS_OF_SWEEP = 1.4
SAND_FADE_START = 0.62
TEAM_DEPTH_SCALE = 1.6
TEAM_DEPTH_PAD = 0.04
CLOSEUP_PAD = 1.15


def lin(key):
    return palette_linear(key)[:3]


def t2b(p):
    """three (x, y, z) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def b2t(p):
    return np.array([p[0], p[2], -p[1]])


# ------------------------------------------------------------------ the maths

def clear_spacing(a, b, step=5):
    """a, b: (n, 3) three-frame points as offsets from each figure's own turn axis."""
    worst = 0.0
    for deg in range(0, 360, step):
        t = math.radians(deg)
        s, c = math.sin(t), math.cos(t)
        reach_a = np.max(-a[:, 0] * s + a[:, 2] * c)
        reach_b = np.min(-b[:, 0] * s + b[:, 2] * c)
        worst = max(worst, reach_a - reach_b)
    return worst + LINE_GAP


def _project(pts, cam_pos, cam_rot, fov, aspect):
    """NDC (x, y) and a front flag for three-frame points; `cam_rot` rows = camera right, up, back."""
    d = pts - cam_pos
    xc = d @ cam_rot[0]
    yc = d @ cam_rot[1]
    zc = d @ cam_rot[2]            # camera looks down -z_c
    h = np.tan(math.radians(fov) / 2.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        nx = xc / (-zc * h * aspect)
        ny = yc / (-zc * h)
    return nx, ny, (-zc) > 0.01


def _look(pos, target):
    back = pos - target
    back = back / np.linalg.norm(back)
    right = np.cross(np.array([0.0, 1.0, 0.0]), back)
    right /= np.linalg.norm(right)
    up = np.cross(back, right)
    return np.stack([right, up, back])


def fit_camera(points, aspect, fov=FOV_DEG, elev=ELEVATION_DEG, mx=MARGIN_X, my=MARGIN_Y):
    """The smallest distance at which every point lands inside the NDC margins, then
    re-centre on what it sees, five rounds (garage-frame.ts `fitCamera`)."""
    el = math.radians(elev)
    max_y = float(points[:, 1].max())
    target = np.array([0.0, max_y / 2.0, 0.0])

    def place(d):
        pos = np.array([target[0] + math.cos(el) * d, target[1] + math.sin(el) * d, target[2]])
        return pos, _look(pos, target)

    def fits(d):
        pos, rot = place(d)
        nx, ny, front = _project(points, pos, rot, fov, aspect)
        return bool(front.all() and (np.abs(nx) <= mx).all() and (np.abs(ny) <= my).all())
    dist = 200.0
    for _ in range(5):
        lo, hi = 0.05, 200.0
        for _i in range(40):
            mid = (lo + hi) / 2
            if fits(mid):
                hi = mid
            else:
                lo = mid
        dist = hi
        pos, rot = place(dist)
        nx, ny, _f = _project(points, pos, rot, fov, aspect)
        half_h = math.tan(math.radians(fov) / 2.0) * dist
        target = target + rot[1] * ((ny.min() + ny.max()) / 2 * half_h) + rot[0] * ((nx.min() + nx.max()) / 2 * half_h * aspect)
    pos, rot = place(dist)
    return pos, target, dist


# ------------------------------------------------------------------ the figures

def eval_points(arm, objs, owners_fn):
    """World vertices of evaluated mesh objects: (n, 3) array and the owning figure index per vertex."""
    dg = bpy.context.evaluated_depsgraph_get()
    P, O = [], []
    for ob in objs:
        e = ob.evaluated_get(dg)
        me = e.to_mesh()
        mw = ob.matrix_world
        co = np.array([(mw @ v.co)[:] for v in me.vertices])
        e.to_mesh_clear()
        if len(co) == 0:
            continue
        P.append(co)
        O.append(owners_fn(ob, len(co)))
    return np.concatenate(P), np.concatenate(O)


def base_owner_fn(arm, figs):
    cache = {}

    def fn(ob, n):
        if ob.name in cache:
            return cache[ob.name]
        names = {vg.index: vg.name for vg in ob.vertex_groups}
        own = np.zeros(n, dtype=int)
        for i, v in enumerate(ob.data.vertices):
            g = max(v.groups, key=lambda g: g.weight)
            own[i] = figs.index(names[g.group][:2]) if names[g.group][:2] in figs else 0
        cache[ob.name] = own
        return own
    return fn


def kit_owner_fn(figs):
    return lambda ob, n: np.full(n, figs.index(ob.name[:2]))


def place_figures(arm, figs, spacing, heading_deg):
    """Stand the figures in a line (Blender y), each turned on its own spot to
    BASE_YAW + heading. Root bones carry the transform: every skinned object follows."""
    n = len(figs)
    rest = {}
    for pf in figs:
        h = arm.data.bones[f"{pf}_root"].head_local
        rest[pf] = Vector((h[0], h[1], 0.0))
    for i, pf in enumerate(figs):
        tgt = Vector((0.0, (i - (n - 1) / 2.0) * spacing, 0.0))
        phi = math.radians(BASE_YAW + heading_deg)
        W = Matrix.Translation(tgt) @ Matrix.Rotation(phi, 4, "Z") @ Matrix.Translation(-rest[pf])
        pb = arm.pose.bones[f"{pf}_root"]
        pb.matrix = W @ pb.matrix
    bpy.context.view_layer.update()
    return rest


class Garage:
    """Measured once for the maximum kit: spacing, camera, sand. `place(heading)` re-poses."""

    def __init__(self, arm, meshes, kit_rows, figs, show_fn, width, height, pose_fn):
        self.arm, self.figs, self.w, self.h = arm, figs, width, height
        self.pose_fn = pose_fn
        self.aspect = width / height
        base = [meshes[n] for n in ("uniform", "boot", "face", "weapon")]
        show_fn({t: 3 for t in ("armour", "sensors", "firepower")})
        pose_fn()
        kit = [ob for ob, _, _, _ in kit_rows if not ob.hide_render]
        bo = base_owner_fn(arm, figs)
        ko = kit_owner_fn(figs)
        P1, O1 = eval_points(arm, base, bo)
        P2, O2 = eval_points(arm, kit, ko) if kit else (np.zeros((0, 3)), np.zeros(0, dtype=int))
        P = np.concatenate([P1, P2])
        O = np.concatenate([O1, O2])
        roots = [np.array(arm.data.bones[f"{pf}_root"].head_local) for pf in figs]
        T = np.array([b2t(p) for p in P])
        local = []
        for i in range(len(figs)):
            sel = T[O == i]
            r = b2t(roots[i])
            loc = sel - np.array([r[0], 0.0, r[2]])
            local.append(loc[:: max(1, len(loc) // 3000)])
        # rest facing is +x in both frames; three turn t sends +x to (cos t, 0, -sin t)
        sp = 0.0
        for i in range(1, len(figs)):
            sp = max(sp, clear_spacing(local[i - 1], local[i]))
        self.spacing = sp
        # sweep: every point at every 15 deg of a full turn, about its own axis, in the line
        swept = []
        n = len(figs)
        for a in range(0, 360, SWEEP_STEP):
            th = math.radians(BASE_YAW + a)
            c, s = math.cos(th), math.sin(th)
            for i in range(n):
                p = local[i]
                x = p[:, 0] * c + p[:, 2] * s
                z = -p[:, 0] * s + p[:, 2] * c
                zl = (i - (n - 1) / 2.0) * sp * -1.0      # Blender +y is three -z
                swept.append(np.stack([x, p[:, 1], z + zl], axis=1))
        swept = np.concatenate(swept)
        self.top = float(swept[:, 1].max())
        self.sweep_radius = float(np.max(np.hypot(swept[:, 0], swept[:, 2])))
        depth = float(np.max(np.abs(swept[:, 0])))
        self.near_edge = depth * TEAM_DEPTH_SCALE + TEAM_DEPTH_PAD
        fit_pts = swept[::3]
        fit_pts = np.concatenate([fit_pts, [[self.near_edge, 0.0, 0.0]]])
        self.fit_pts = fit_pts
        self.cam_pos, self.cam_target, self.cam_dist = fit_camera(fit_pts, self.aspect)
        self.sand_r = max(0.2, self.sweep_radius * SAND_RADIUS_OF_SWEEP)
        self.squash = min(1.0, (self.near_edge * TEAM_DEPTH_SCALE) / self.sand_r)

    def ndc_extent(self):
        """Largest |NDC| of the max-kit sweep under the fitted camera: the frame-edge (cropping) check."""
        pos, tgt = self.cam_pos, self.cam_target
        rot = _look(pos, tgt)
        nx, ny, front = _project(self.fit_pts, pos, rot, FOV_DEG, self.aspect)
        return float(np.abs(nx).max()), float(np.abs(ny).max()), bool(front.all())

    def summary(self):
        ex, ey, fr = self.ndc_extent()
        return {"ndc_max_x": round(ex, 4), "ndc_max_y": round(ey, 4), "margins": [MARGIN_X, MARGIN_Y], "all_in_front": fr, "spacing_m": round(self.spacing, 3), "camera_distance_m": round(self.cam_dist, 3),
                "sweep_radius_m": round(self.sweep_radius, 3), "top_m": round(self.top, 3),
                "sand_radius_m": round(self.sand_r, 3), "sand_squash": round(self.squash, 3),
                "aspect": round(self.aspect, 4)}

    # -- the scene ---------------------------------------------------------------
    def build_scene(self, samples=64, denoise=True, pad=None):
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = samples
        sc.cycles.use_denoising = denoise
        sc.cycles.max_bounces = 2
        sc.cycles.diffuse_bounces = 1
        sc.cycles.glossy_bounces = 1
        sc.cycles.transmission_bounces = 0
        sc.cycles.volume_bounces = 0
        sc.cycles.sample_clamp_indirect = 4.0
        sc.render.resolution_x = self.w
        sc.render.resolution_y = self.h
        sc.render.resolution_percentage = 100
        sc.render.film_transparent = True
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.look = "None"
        sc.view_settings.exposure = 0.0
        sc.view_settings.gamma = 1.0
        sc.display_settings.display_device = "sRGB"
        sc.render.image_settings.file_format = "OPEN_EXR"
        sc.render.image_settings.color_depth = "32"
        sc.render.image_settings.color_mode = "RGBA"
        # camera
        cd = bpy.data.cameras.new("gcam")
        cd.sensor_fit = "VERTICAL"
        cd.angle = math.radians(FOV_DEG)
        cd.clip_start, cd.clip_end = 0.05, 200.0
        cam = bpy.data.objects.new("gcam", cd)
        bpy.context.collection.objects.link(cam)
        self.cam_data, self.cam = cd, cam
        self.set_camera(self.cam_pos, self.cam_target)
        sc.camera = cam
        # lights (three direction -> Blender)
        def dirv(az, el):
            a, e = math.radians(az), math.radians(el)
            return t2b((math.cos(e) * math.cos(a), math.sin(e), math.cos(e) * math.sin(a)))
        for name, az, el, inten, key, ang in (("key", KEY_AZ, KEY_EL, KEY_I, "limestone.0", 2.5), ("fill", -FILL_AZ, FILL_EL, FILL_I, "water.0", 8.0)):
            ld = bpy.data.lights.new(name, "SUN")
            ld.angle = math.radians(ang)
            ld.color = lin(key)
            ld.energy = inten * st.SUN_GAIN
            ob = bpy.data.objects.new(name, ld)
            bpy.context.collection.objects.link(ob)
            ob.rotation_euler = dirv(az, el).to_track_quat("Z", "Y").to_euler()
            ob.location = (0, 0, 10)
            if name == "fill":
                ld.use_shadow = False       # the fill is unshadowed in the garage (only the key casts)
        # world: hemisphere for light, flat dark for the camera
        world = bpy.data.worlds.new("ghemi")
        world.use_nodes = True
        nt = world.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputWorld")
        bg = nt.nodes.new("ShaderNodeBackground")
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        half = nt.nodes.new("ShaderNodeMath")
        half.operation = "MULTIPLY_ADD"
        half.inputs[1].default_value = 0.5
        half.inputs[2].default_value = 0.5
        nt.links.new(sep.outputs["Z"], half.inputs[0])
        nt.links.new(half.outputs["Value"], mix.inputs["Factor"])
        s = np.array(lin("water.0"))
        g = np.array(lin("dust.4"))
        k = HEMI_I / math.pi * st.HEMI_GAIN
        ls = np.clip(k * (1.25 * s - 0.25 * g), 0, None)
        lg = np.clip(k * (1.25 * g - 0.25 * s), 0, None)
        mix.inputs["A"].default_value = (*lg.tolist(), 1.0)
        mix.inputs["B"].default_value = (*ls.tolist(), 1.0)
        nt.links.new(mix.outputs["Result"], bg.inputs["Color"])
        nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
        sc.world = world
        # sand: an elliptical patch fading to nothing
        bpy.ops.mesh.primitive_circle_add(vertices=96, radius=1.0, fill_type="NGON", location=(0, 0, 0))
        sand = bpy.context.active_object
        sand.name = "sand"
        sand.scale = (self.sand_r * self.squash, self.sand_r, 1.0)
        sm = bpy.data.materials.new("sand")
        sm.use_nodes = True
        nt = sm.node_tree
        nt.nodes.clear()
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = (*lin("limestone.3"), 1.0)
        bsdf.inputs["Roughness"].default_value = 0.95
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mx = nt.nodes.new("ShaderNodeMixShader")
        tcn = nt.nodes.new("ShaderNodeTexCoord")
        vl = nt.nodes.new("ShaderNodeVectorMath")
        vl.operation = "LENGTH"
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = SAND_FADE_START
        mr.inputs["From Max"].default_value = 1.0
        mr.inputs["To Min"].default_value = 1.0
        mr.inputs["To Max"].default_value = 0.0
        mr.clamp = True
        nt.links.new(tcn.outputs["Object"], vl.inputs[0])
        nt.links.new(vl.outputs["Value"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], mx.inputs["Fac"])
        nt.links.new(tr.outputs["BSDF"], mx.inputs[1])
        nt.links.new(bsdf.outputs["BSDF"], mx.inputs[2])
        nt.links.new(mx.outputs["Shader"], o.inputs["Surface"])
        sand.data.materials.append(sm)
        sand.visible_diffuse = False
        sand.visible_glossy = False
        self.sand = sand
        return cam

    def set_camera(self, pos_three, target_three):
        pos = t2b(pos_three)
        tgt = t2b(target_three)
        self.cam.location = pos
        self.cam.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()

    def closeup_camera(self, pts_three, pad=CLOSEUP_PAD, aspect=None):
        """Re-fit the SAME fov and elevation to `pts_three` alone with `pad` of margin."""
        a = aspect or self.aspect
        pos, tgt, dist = fit_camera(pts_three, a, mx=1.0 / pad, my=1.0 / pad)
        self.set_camera(pos, tgt)
        return pos, tgt, dist


BG_DISPLAY = (36.0, 37.0, 32.0)      # the page behind the canvas: palette shadow.0 (#23241F) lifted a hair, measured off garage-1


def background(w, h):
    """Display-space (0-1) backdrop: flat shadow.0 with the faint lift behind the line the page has."""
    y, x = np.mgrid[0:h, 0:w]
    r = np.hypot((x - w * 0.5) / (w * 0.5), (y - h * 0.5) / (h * 0.5))
    gain = 1.0 + 0.10 * np.clip(1.0 - r, 0, 1)
    base = np.array(BG_DISPLAY) / 255.0
    return np.clip(base[None, None, :] * gain[..., None], 0, 1)


def render_rgba(path_npy):
    """Render with a transparent film; return scene-linear premultiplied RGBA (h, w, 4)."""
    sc = bpy.context.scene
    tmp = path_npy + ".exr"
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    os.remove(tmp)
    return px.reshape(h, w, 4)[::-1].astype(np.float32)


def save_png(rgba, path, exposure=EXPOSURE):
    """Tone-map the figures and sand the garage's way (ACES, exposure 1.1) and lay them over the page's backdrop."""
    h, w, _ = rgba.shape
    srgb = st.aces_srgb(rgba[..., :3] * exposure)
    a = np.clip(rgba[..., 3:4], 0, 1)
    out = np.clip(srgb + (1.0 - a) * background(w, h), 0, 1)
    full = np.ones((h, w, 4), dtype=np.float32)
    full[..., :3] = out
    img = bpy.data.images.new("out", w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(full[::-1].reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def place_figures_one(arm, pf, heading_deg):
    """One soldier alone on the origin, turned to BASE_YAW + heading (the track close-ups)."""
    h = arm.data.bones[f"{pf}_root"].head_local
    rest = Vector((h[0], h[1], 0.0))
    phi = math.radians(BASE_YAW + heading_deg)
    W = Matrix.Rotation(phi, 4, "Z") @ Matrix.Translation(-rest)
    pb = arm.pose.bones[f"{pf}_root"]
    pb.matrix = W @ pb.matrix
    bpy.context.view_layer.update()
