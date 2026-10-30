"""R1 approval renders for the wetland P3 art (GH-871), Blender only.

    blender -b --factory-startup -P tools/terrain/render_wetland_r1.py -- \\
        --out <dir> --stage plates|scene|figcheck|all \\
        --window window.json --ground-dir <dir> [--only reed_0,round_bale] [--samples 64]

Writes RAW linear 16-bit PNGs plus `meta.json` under `<dir>`; `wetland_r1_sheet.py`
(plain python3: ACES, labels, contact sheet) turns them into the plates. Nothing
is exported into `art/meshes/` or `assets/`, and no material made here is ever
written to a GLB.

Stages:
  plates    one set per piece: a lit hero, its wire-shaded twin (the triangle
            count), an 8-yaw turntable, and the piece beside a standing and a
            kneeling KDF figure at zoom 1 and zoom 2.5, lit and as a pure-black
            silhouette. Reed pieces stand on the marsh floor, the rest on the sward.
  scene     the composed R3 scene from the real Ein Qasab window: marsh, reed mat,
            the real water field, kneeling and standing figures in the reeds and on
            open ground, beside the oak-grove stand-in on wet sward.
  figcheck  the spec's check: a kneeling (and a standing) KDF figure in the marsh
            keeps a visible head and shoulders, measured by an emission mask at 36
            dry marsh points, with the constructed failing input (reeds x1.5) and
            the sheet's fallback (reeds at 1.1 / 1.0 / 0.9 m).

The rig (camera, light, calibration against three.js) is `wetland_r1_rig.py`.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.dirname(os.path.dirname(HERE))

import wetland_r1_rig as R  # noqa: E402
import build_reeds  # noqa: E402
import build_wet_grass  # noqa: E402
import build_wetland_props  # noqa: E402
from wetland_kit import to_object  # noqa: E402

AZ = R.AZIMUTH
RIGHT = Vector((-math.sin(AZ), math.cos(AZ), 0.0))  # screen-right, horizontal
LIGHT = R.RAIN

# --- tints (data/palette.json post S-6; the window.json dump overrides) ------------
TINT = {
    "reed": {"foliage": "#806032", "trunk": "#3E5C2E"},  # dust.5, scrub.1
    "wet_grass": {"foliage": "#8AB04E", "trunk": "#96703C"},  # grass.3, the untinted trunk role (dust.4)
    "round_bale": {"rubber": "#363B39"},  # gunmetal.3
    "culvert_pipe": {"concrete": "#C8B494"},  # limestone.3, the concrete role's lit step
}
# Untinted decor role tones (decor-role.ts, liftTone of each slice) for the stand-ins.
ROLE_TONE = {"foliage": "#6E7449", "trunk": "#96703C", "rock": "#75624A", "sand": "#C8B494"}
KDF = {"uniform": "#6E7449", "boot": "#9E4F30", "face": "#C78773", "weapon": "#5C625F"}
GROUND = {"marsh": "#584535", "open": "#7F9F57", "road": "#725944"}
HEAD_BAND = {"standing": 0.28, "kneeling": 0.30}  # top share of the figure's height read as head and shoulders

meta = {}


def log(*a):
    print("[r1]", *a, flush=True)


# --- args ------------------------------------------------------------------------


def parse():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    a = {"stage": "plates", "samples": "64", "only": None, "window": None, "ground_dir": None}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-").replace("-", "_")
        a[k] = argv[i + 1]
        i += 2
    a["samples"] = int(a["samples"])
    return a


# --- the pieces --------------------------------------------------------------------


def piece_soups(name):
    """role -> TriSoup for a piece, from the real builders."""
    if name.startswith("reed_"):
        f, t = build_reeds.build(int(name[-1]))
        return {"foliage": f, "trunk": t}
    if name.startswith("wet_grass_"):
        f, t = build_wet_grass.build(int(name[-1]))
        out = {"foliage": f}
        if t.count:
            out["trunk"] = t
        return out
    return build_wetland_props.build(name)


def tint_for(name, role, decor_colors=None):
    fam = "reed" if name.startswith("reed_") else "wet_grass" if name.startswith("wet_grass_") else name
    if decor_colors and f"{fam}:{role}" in decor_colors:
        return decor_colors[f"{fam}:{role}"]
    return TINT[fam][role]


def make_piece(name, scale=1.0, yaw=0.0, loc=(0.0, 0.0, 0.0), decor_colors=None, tag="piece"):
    objs = []
    for role, soup in piece_soups(name).items():
        ob = to_object(f"{name}_{role}", soup, smooth=True, sharp_degrees=35.0 if name in ("round_bale", "culvert_pipe") else None)
        ob.rotation_euler = (0.0, 0.0, yaw)
        ob.scale = (scale, scale, scale)
        ob.location = loc
        mat = R.flat_material(f"{name}_{role}_{tint_for(name, role, decor_colors)}", tint_for(name, role, decor_colors), cull=True)
        R.assign(ob, mat)
        ob["pkind"] = tag
        ob["lit_mat"] = mat.name
        ob["role"] = role
        objs.append(ob)
    return objs


def tri_total(name):
    return sum(s.count for s in piece_soups(name).values())


def piece_bounds_m(name):
    from wetland_kit import TriSoup

    both = TriSoup()
    for s in piece_soups(name).values():
        both.merge(s)
    return both.bounds()


# --- modes ---------------------------------------------------------------------------


def set_mode(mode, mask_codes=None):
    """lit | sil | wire. Every tagged object takes its material for the mode."""
    black = R.emission_material("black", (0.0, 0.0, 0.0))
    for ob in bpy.context.scene.objects:
        kind = ob.get("pkind")
        if kind is None or ob.type != "MESH":
            continue
        if mode == "lit":
            m = bpy.data.materials.get(ob["lit_mat"])
        elif mode == "sil":
            m = R.holdout_material() if kind == "ground" else black
        elif mode == "wire":
            m = R.holdout_material() if kind in ("ground", "figure") else R.wire_material()
        else:
            raise ValueError(mode)
        ob.data.materials.clear()
        ob.data.materials.append(m)


# --- figures -------------------------------------------------------------------------

_FIG = {}


def _dominant_f0(me):
    return None


def load_figures():
    """Standing (idle) and kneeling (kneel) KDF figure 0 from inf_squad.glb, evaluated
    through the armature at the clip's first frame and frozen, as static meshes in
    metres, feet on z = 0, centred on the origin. The upgrade-kit meshes (rl_kit) are
    left out."""
    if _FIG:
        return _FIG
    path = os.path.join(REPO, "art", "meshes", "inf_squad.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, import_scene_extras=True)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    parts_src = [o for o in new if o.type == "MESH" and o.get("rl_role") in KDF]
    keep = {}
    for ob in parts_src:
        names = {i: g.name for i, g in enumerate(ob.vertex_groups)}
        flags = []
        for v in ob.data.vertices:
            flags.append(any(names[g.group].startswith("f0_") and g.weight > 0.5 for g in v.groups))
        keep[ob.name] = flags
    out = {}
    for posture, action in (("standing", "idle"), ("kneeling", "kneel")):
        arm.animation_data_create()
        arm.animation_data.action = bpy.data.actions[action]
        bpy.context.scene.frame_set(0)
        dg = bpy.context.evaluated_depsgraph_get()
        parts = []
        for ob in parts_src:
            ev = ob.evaluated_get(dg)
            me = bpy.data.meshes.new_from_object(ev)
            me.transform(ob.matrix_world)
            import bmesh

            bm = bmesh.new()
            bm.from_mesh(me)
            bm.verts.ensure_lookup_table()
            for v in list(bm.verts):
                if not keep[ob.name][v.index]:
                    bm.verts.remove(v)
            bm.to_mesh(me)
            bm.free()
            parts.append((ob["rl_role"], me))
        zs = [v.co.z for _, me in parts for v in me.vertices]
        xs = [v.co.x for _, me in parts for v in me.vertices]
        ys = [v.co.y for _, me in parts for v in me.vertices]
        zmin, zmax = min(zs), max(zs)
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        for _, me in parts:
            me.transform(Matrix.Translation((-cx, -cy, -zmin)))
        out[posture] = dict(parts=parts, height=zmax - zmin, tris=sum(len(me.polygons) for _, me in parts))
        log(posture, "height", round(zmax - zmin, 3), "m", "polys", out[posture]["tris"])
    # hide the imported rig and meshes (render ignores hidden) and protect them from reset()
    for o in new:
        o.hide_render = True
        o.hide_viewport = True
        o["cache"] = True
    _FIG.update(out)
    return _FIG


def place_figure(posture, loc, yaw=0.0, mask_id=None, name="fig"):
    fig = load_figures()[posture]
    objs = []
    for role, me in fig["parts"]:
        ob = bpy.data.objects.new(f"{name}_{posture}_{role}", me)
        bpy.context.collection.objects.link(ob)
        ob.location = loc
        ob.rotation_euler = (0.0, 0.0, yaw)
        mat = R.flat_material(f"kdf_{role}", KDF[role], cull=True)
        R.assign(ob, mat)
        ob["pkind"] = "figure"
        ob["lit_mat"] = mat.name
        ob["posture"] = posture
        ob["height"] = fig["height"]
        objs.append(ob)
    return objs


# --- common scene --------------------------------------------------------------------


def reset():
    """Empty the scene but keep the cached imports (the figure rig, the stand-in GLBs):
    `read_factory_settings` would free them under our references."""
    for ob in list(bpy.data.objects):
        if not ob.get("cache"):
            bpy.data.objects.remove(ob, do_unlink=True)


def basic_scene(w, h, samples, light=LIGHT, transparent=True):
    reset()
    R.setup_render(w, h, samples, transparent)
    cam = R.make_camera()
    R.make_world(light)
    R.make_suns(light)
    return cam


def frame_for(objs, cam, aspect=1.0, margin=1.2):
    """Aim `cam` so `objs` fill the frame: centre of the projected bounds, width from
    the projected extent."""
    bpy.context.view_layer.update()
    lo, hi = R.object_bounds(objs)
    R.aim_camera(cam, (0, 0, 0), 1.0)
    bpy.context.view_layer.update()
    m = cam.matrix_world.to_3x3()
    right, up = m @ Vector((1, 0, 0)), m @ Vector((0, 1, 0))
    pts = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    us = [p.dot(right) for p in pts]
    vs = [p.dot(up) for p in pts]
    cu, cv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
    wu, wv = max(us) - min(us), max(vs) - min(vs)
    width = max(wu, wv * aspect) * margin
    centre = right * cu + up * cv
    R.aim_camera(cam, centre, width)
    return width


def ground_for(piece):
    return GROUND["marsh"] if piece.startswith("reed_") else GROUND["open"]


# --- stage: plates ---------------------------------------------------------------------

PIECES = ["reed_0", "reed_1", "reed_2", "wet_grass_0", "wet_grass_1", "wet_grass_2", "round_bale", "culvert_pipe"]
HERO_YAW = {"culvert_pipe": math.radians(225.0)}  # the mouth faces +X; 225 turns it to the camera
ROLL = {"reed": 1.2, "wet_grass": 0.9, "round_bale": 1.0, "culvert_pipe": 1.0}  # the largest drawn scale


def roll_of(name):
    return ROLL["reed" if name.startswith("reed_") else "wet_grass" if name.startswith("wet_grass_") else name]


def stage_plates(out, samples, only, decor_colors):
    base = os.path.join(out, "plates")
    for name in PIECES:
        if only and name not in only:
            continue
        d = os.path.join(base, name)
        os.makedirs(d, exist_ok=True)
        info = {}
        # -- hero + wire ---------------------------------------------------------
        cam = basic_scene(1000, 1000, max(samples, 96))
        ground = R.make_ground(ground_for(name))
        ground["pkind"] = "ground"
        ground["lit_mat"] = ground.data.materials[0].name
        y0 = HERO_YAW.get(name, 0.0)
        objs = make_piece(name, yaw=y0, decor_colors=decor_colors)
        width = frame_for(objs, cam, 1.0, 1.28)
        # ground drops to a hair below z=0 (the piece stands on it)
        R.render_to(os.path.join(d, "hero.png"))
        set_mode("wire")
        bpy.context.scene.render.film_transparent = True
        R.render_to(os.path.join(d, "wire.png"))
        info["hero_frame_m"] = width
        info["tris"] = tri_total(name)
        lo, hi = piece_bounds_m(name)
        info["extent_m"] = [hi[0] - lo[0], hi[1] - lo[1], hi[2]]
        # -- turntable: the OBJECT rotates, camera and sun do not -----------------
        set_mode("lit")
        bpy.context.scene.render.resolution_x = bpy.context.scene.render.resolution_y = 380
        bpy.context.scene.cycles.samples = 48
        for k in range(8):
            for ob in objs:
                ob.rotation_euler.z = y0 + k * math.radians(45.0)
            R.render_to(os.path.join(d, f"turn_{k}.png"))
        meta.setdefault("plates", {})[name] = info
        log(name, info)
        # -- game scale: beside a standing and a kneeling figure ------------------
        for zoom, label in ((1.0, "z1"), (2.5, "z25")):
            ss = 4
            wn, hn = (120, 80) if zoom == 1.0 else (300, 200)
            fw = wn / R.px_per_m(zoom)
            cam = basic_scene(wn * ss, hn * ss, 40)
            ground = R.make_ground(ground_for(name))
            ground["pkind"] = "ground"
            ground["lit_mat"] = ground.data.materials[0].name
            s = roll_of(name)
            objs = make_piece(name, scale=s, yaw=HERO_YAW.get(name, 0.0), decor_colors=decor_colors)
            figs = place_figure("standing", RIGHT * (-fw * 0.30), 0.0) + place_figure("kneeling", RIGHT * (fw * 0.30), 0.0)
            R.aim_camera(cam, (0, 0, 0.5), fw)
            R.render_to(os.path.join(d, f"{label}_lit.png"))
            set_mode("sil")
            R.render_to(os.path.join(d, f"{label}_sil.png"))
            info[f"{label}_native"] = [wn, hn]
            info[f"{label}_ss"] = ss
            info[f"{label}_scale"] = s
        meta["plates"][name] = info
        with open(os.path.join(out, "meta.json"), "w") as fh:
            json.dump(meta, fh, indent=2)


# --- stage: scene -----------------------------------------------------------------------

STAND_IN = {"oak": "cedar", "willow": "desert_tree", "shrub": "bush", "rock": "rock", "slab": "slab", "boulder": "boulder"}
_GLB = {}


def stand_in(fam, variant):
    """The shipped GLB a P2 stand-in family draws: list of (role, object, M0)."""
    key = f"{STAND_IN[fam]}_{variant}"
    if key in _GLB:
        return _GLB[key]
    path = os.path.join(REPO, "art", "meshes", "decor", key + ".glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, import_scene_extras=True)
    new = [o for o in bpy.data.objects if o not in before]
    parts = []
    for o in new:
        if o.type == "MESH":
            parts.append((o.get("rl_role", o.name), o, o.matrix_world.copy()))
    for o in new:
        o.hide_render = True
        o["cache"] = True
    _GLB[key] = parts
    return parts


def build_ground_mesh(win, tex_path, water_path, backing=True):
    x0, y0, x1, y1 = win["window"]["x0"], win["window"]["y0"], win["window"]["x1"] + 1, win["window"]["y1"] + 1
    nx, ny = x1 - x0, y1 - y0
    SH = win["heightsPerTile"]
    step = 2  # every second height sample: a vertex each quarter tile
    H = win["heights"]
    n = nx * SH + 1
    verts, uvs, faces = [], [], []
    gi = list(range(0, nx * SH + 1, step))
    gj = list(range(0, ny * SH + 1, step))
    idx = {}
    for j in gj:
        for i in gi:
            wx, wy = x0 + i / SH, y0 + j / SH
            idx[(i, j)] = len(verts)
            verts.append((wx * 3.0, wy * 3.0, H[j * n + i] * 3.0))
            uvs.append(((wx - x0) / nx, 1.0 - (wy - y0) / ny))
    for a, j in enumerate(gj[:-1]):
        for b, i in enumerate(gi[:-1]):
            i2, j2 = gi[b + 1], gj[a + 1]
            faces.append((idx[(i, j)], idx[(i2, j)], idx[(i2, j2)], idx[(i, j2)]))
    mesh = bpy.data.meshes.new("ground_window")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True
    uv = mesh.uv_layers.new(name="uv")
    for poly in mesh.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            uv.data[li].uv = uvs[vi]
    ob = bpy.data.objects.new("ground_window", mesh)
    bpy.context.collection.objects.link(ob)
    mat = bpy.data.materials.new("ground_window_mat")
    mat.use_nodes = True
    nt = mat.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(tex_path, check_existing=True)
    img.image.colorspace_settings.name = "sRGB"
    img.interpolation = "Cubic"
    img.extension = "EXTEND"
    wimg = nt.nodes.new("ShaderNodeTexImage")
    wimg.image = bpy.data.images.load(water_path, check_existing=True)
    wimg.image.colorspace_settings.name = "Non-Color"
    wimg.interpolation = "Linear"
    wimg.extension = "EXTEND"
    nt.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
    # roughness: 0.62 on ground, 0.08 where water
    rough = nt.nodes.new("ShaderNodeMath")
    rough.operation = "MULTIPLY_ADD"
    rough.inputs[1].default_value = -0.54
    rough.inputs[2].default_value = 0.62
    nt.links.new(wimg.outputs["Color"], rough.inputs[0])
    nt.links.new(rough.outputs[0], bsdf.inputs["Roughness"])
    # the spec's scene-referred reflection, R x overcast.0, an UNLIT emission under the water mask
    em = nt.nodes.new("ShaderNodeEmission")
    r, g, b = R.hex_linear("#C4C8C9")
    refl = win.get("reflectance", 0.25)
    em.inputs["Color"].default_value = (r * refl, g * refl, b * refl, 1.0)
    nt.links.new(wimg.outputs["Color"], em.inputs["Strength"])
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(bsdf.outputs["BSDF"], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(mat)
    ob["pkind"] = "ground"
    ob["lit_mat"] = mat.name
    return ob


def height_at(win, x, y):
    """Ground height in metres at tile coords (x, y), bilinear on the dumped samples."""
    SH = win["heightsPerTile"]
    x0, y0 = win["window"]["x0"], win["window"]["y0"]
    nx = win["window"]["x1"] - x0 + 1
    n = nx * SH + 1
    fx, fy = (x - x0) * SH, (y - y0) * SH
    i, j = int(math.floor(fx)), int(math.floor(fy))
    tx, ty = fx - i, fy - j
    H = win["heights"]
    g = lambda ii, jj: H[jj * n + ii]
    v = (g(i, j) * (1 - tx) + g(i + 1, j) * tx) * (1 - ty) + (g(i, j + 1) * (1 - tx) + g(i + 1, j + 1) * tx) * ty
    return v * 3.0


def water_at(win, x, y):
    S = win["window"]["S"]
    x0, y0 = win["window"]["x0"], win["window"]["y0"]
    nx = win["window"]["x1"] - x0 + 1
    ny = win["window"]["y1"] - y0 + 1
    i = int((x - x0) * S)
    j = int((y - y0) * S)
    if not (0 <= i < nx * S and 0 <= j < ny * S):
        return 0.0
    return win["water"][j * nx * S + i]


def place_decor(win, decor_colors, mat_cache, only_family=None, reed_scale_mul=1.0, reed_fallback=False, reed_mass=1):
    """Every dumped placement as objects: the NEW reeds and wet grass, the shipped
    stand-ins for everything else (R-1), tinted by `decorColors`."""
    objs = []
    plist = list(win["placements"])
    if reed_mass > 1:
        # a what-if: `reed_mass` clumps where the placer puts one, the extras offset
        # 0.37 / 0.29 tile per step and kept off the water, to read what more mass buys
        for p in win["placements"]:
            if p["family"] != "reed":
                continue
            for k in range(1, reed_mass):
                q = dict(p)
                q["x"] = p["x"] + 0.37 * k * (1 if k % 2 else -1)
                q["z"] = p["z"] + 0.29 * k * (-1 if k % 2 else 1)
                q["yawTurns"] = (p["yawTurns"] + 0.27 * k) % 1.0
                q["variant"] = (p["variant"] + k) % 3
                if water_at(win, q["x"], q["z"]) < 0.5:
                    plist.append(q)
    for p in plist:
        fam = p["family"]
        if only_family and fam not in only_family:
            continue
        x, z = p["x"] * 3.0, p["z"] * 3.0
        loc = Vector((x, z, p["y"] * 3.0))
        yaw = -p["yawTurns"] * math.tau
        sc = p["scale"]
        if fam == "reed":
            v = p["variant"]
            if reed_fallback:
                sc *= {0: 1.10 / 1.25, 1: 1.00 / 1.10, 2: 0.90 / 1.00}[v]
            sc *= reed_scale_mul
            objs += make_piece(f"reed_{v}", scale=sc, yaw=yaw, loc=loc, decor_colors=decor_colors, tag="decor")
        elif fam == "wet_grass":
            objs += make_piece(f"wet_grass_{p['variant']}", scale=sc, yaw=yaw, loc=loc, decor_colors=decor_colors, tag="decor")
        else:
            for role, src, m0 in stand_in(fam, p["variant"]):
                ob = src.copy()
                ob.data = src.data
                bpy.context.collection.objects.link(ob)
                ob.parent = None
                mw = Matrix.Translation(loc) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Scale(sc, 4) @ m0
                ob.matrix_world = mw
                ob.hide_render = False
                key = f"{fam}:{role}"
                hexv = decor_colors.get(key, ROLE_TONE.get(role, "#808080"))
                mat = R.flat_material(f"standin_{key}_{hexv}", hexv, cull=True)
                R.assign(ob, mat)
                ob["pkind"] = "decor"
                ob["lit_mat"] = mat.name
                objs.append(ob)
    return objs


def marsh_points(win, count, min_inner=0.55, water_max=0.02, seed_stride=None):
    """Dry marsh sample points (tile coords), far from the shore and the water, spread over
    the marsh by a stride over a fixed grid."""
    S = win["window"]["S"]
    x0, y0 = win["window"]["x0"], win["window"]["y0"]
    nx = win["window"]["x1"] - x0 + 1
    ny = win["window"]["y1"] - y0 + 1
    rows = win["rows"]
    W = win["water"]
    cand = []
    for j in range(ny * S):
        for i in range(nx * S):
            tx, ty = i // S, j // S
            if rows[ty][tx] != "~":
                continue
            wx, wy = x0 + (i + 0.5) / S, y0 + (j + 0.5) / S
            # inner distance: clear of non-marsh tiles by min_inner tiles
            ok = True
            r = int(math.ceil(min_inner))
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    ax, ay = tx + dx, ty + dy
                    if 0 <= ax < nx and 0 <= ay < ny and rows[ay][ax] == "~":
                        continue
                    # nearest point of that non-marsh tile
                    px = min(max(wx, x0 + ax), x0 + ax + 1)
                    py = min(max(wy, y0 + ay), y0 + ay + 1)
                    if math.hypot(wx - px, wy - py) < min_inner:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                continue
            # no water within 0.12 tile (0.36 m)
            wmax = 0.0
            rr = 4
            for dj in range(-rr, rr + 1, 2):
                for di in range(-rr, rr + 1, 2):
                    jj, ii = j + dj, i + di
                    if 0 <= jj < ny * S and 0 <= ii < nx * S:
                        wmax = max(wmax, W[jj * (nx * S) + ii])
            if wmax > water_max:
                continue
            cand.append((wx, wy))
    return cand


def spread(points, count):
    """`count` points from `points`, farthest-point sampling (deterministic)."""
    if len(points) <= count:
        return points
    chosen = [points[len(points) // 2]]
    while len(chosen) < count:
        best, bd = None, -1
        for p in points:
            d = min(math.hypot(p[0] - c[0], p[1] - c[1]) for c in chosen)
            if d > bd:
                best, bd = p, d
        chosen.append(best)
    return chosen


def stage_scene(out, samples, win, ground_dir, decor_colors):
    d = os.path.join(out, "scene")
    os.makedirs(d, exist_ok=True)
    tex = os.path.join(ground_dir, "ground_window.png")
    wat = os.path.join(ground_dir, "ground_window_water.png")
    gmeta = json.load(open(os.path.join(ground_dir, "ground_window.json")))
    win = {**win, "reflectance": gmeta.get("reflectance", 0.25)}
    x0, y0 = win["window"]["x0"], win["window"]["y0"]
    cand = marsh_points(win, 40)
    log("dry marsh candidates", len(cand))
    pts = spread(cand, 12)
    # The showcase figures: a standing one and a kneeling one deep in the marsh, near its
    # middle; and the same two on open ground beside the grove.
    # A standing and a kneeling figure 3 m apart across the screen (23/32 tile along both
    # axes, the camera's right), both on dry ground, as near the middle of the marsh as the
    # water allows.
    S_ = win["window"]["S"]
    idx_ = {(round((c[0] - x0) * S_ - 0.5), round((c[1] - y0) * S_ - 0.5)): c for c in cand}
    cx = sum(c[0] for c in cand) / len(cand)
    cy = sum(c[1] for c in cand) / len(cand)
    pairs = []
    for (i, j), c in idx_.items():
        k = (i + 23, j - 23)
        if k in idx_:
            pairs.append((math.hypot(c[0] - cx, c[1] - cy), c, idx_[k]))
    pairs.sort(key=lambda t: t[0])
    _, p_stand, p_kneel = pairs[0]
    log("showcase", p_stand, p_kneel)
    open_stand = (16.5, 23.0)
    open_kneel = (17.6, 23.0)

    def build_scene(w, h, ss, samples_, light=LIGHT):
        cam = basic_scene(w * ss, h * ss, samples_, light)
        g = build_ground_mesh(win, tex, wat)
        back = R.make_ground("#7F9F57", size_m=400.0, z=-0.01, centre=(60.0, 60.0))
        back["pkind"] = "ground"
        back["lit_mat"] = back.data.materials[0].name
        dec = place_decor(win, decor_colors, {})
        figs = []
        for posture, pt in (("standing", p_stand), ("kneeling", p_kneel), ("standing", open_stand), ("kneeling", open_kneel)):
            loc = Vector((pt[0] * 3.0, pt[1] * 3.0, height_at(win, pt[0], pt[1])))
            figs += place_figure(posture, loc, 0.0, name=f"scene{pt}")
        return cam, g, dec, figs

    def aim_screen(cam, tile_xy, width_px_native, zoom):
        """Aim the camera at a point (tile coords) with a frame `width_px_native` wide."""
        loc = Vector((tile_xy[0] * 3.0, tile_xy[1] * 3.0, height_at(win, *tile_xy)))
        R.aim_camera(cam, loc, width_px_native / R.px_per_m(zoom))

    views = [
        # name, centre tile, native size, zoom, supersample
        ("overview_z1", (22.0, 23.5), (720, 410), 1.0, 2),
        ("marsh_z25", (p_stand[0] - 0.3, p_stand[1] - 0.2), (1000, 620), 2.5, 2),
        ("marsh_z6", ((p_stand[0] + p_kneel[0]) / 2, (p_stand[1] + p_kneel[1]) / 2), (880, 560), 6.0, 1),
        ("grove_z25", (15.0, 24.0), (760, 460), 2.5, 2),
    ]
    info = {}
    for name, centre, (wn, hn), zoom, ss in views:
        cam, g, dec, figs = build_scene(wn, hn, ss, max(samples, 48))
        aim_screen(cam, centre, wn, zoom)
        R.render_to(os.path.join(d, f"{name}_lit.png"))
        info[name] = dict(native=[wn, hn], ss=ss, zoom=zoom, centre_tile=centre)
        if name in ("marsh_z25", "marsh_z6"):
            set_mode("sil")
            R.render_to(os.path.join(d, f"{name}_sil.png"))
        log("scene view", name)
    meta["scene"] = dict(
        views=info,
        showcase=dict(standing=p_stand, kneeling=p_kneel, open_standing=open_stand, open_kneeling=open_kneel),
        placements={k: sum(1 for p in win["placements"] if p["family"] == k) for k in sorted({p["family"] for p in win["placements"]})},
    )
    with open(os.path.join(out, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    return win, pts


# --- stage: figcheck ---------------------------------------------------------------------


def stage_figcheck(out, win, decor_colors):
    """Visible head-and-shoulders fraction of a figure at dry marsh points, by an emission mask:
    each figure is emitted as (id / 64, band, 0): band 1.0 for the head and shoulders band
    (the top share of its height), 0.5 for the rest; every reed is black and occludes.
    Counted at 4x supersampling of zoom 1 (60 px/m). A reference render with no reeds gives
    each figure's full footprint, so the fraction is exact whatever the figures do to each other."""
    d = os.path.join(out, "figcheck")
    os.makedirs(d, exist_ok=True)
    cand = marsh_points(win, 0)
    pts = spread(cand, 36)
    pts.sort(key=lambda p: (round(p[1], 1), p[0]))
    log("figcheck points", len(pts))
    results = {}
    conditions = [
        ("none", dict(reeds=False)),  # the instrument must read 100%
        ("current", dict(reeds=True)),
        ("fallback", dict(reeds=True, reed_fallback=True)),  # 1.1 / 1.0 / 0.9 m
        ("x1.5", dict(reeds=True, reed_scale_mul=1.5)),  # the constructed failing input: reeds 1.5x
        # headroom beyond the placer's three clumps a tile: twice that (a what-if only)
        ("mass2", dict(reeds=True, reed_mass=2)),
    ]
    zoom, ss = 1.0, 4
    ppm = R.px_per_m(zoom) * ss
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    for posture in ("kneeling", "standing"):
        fig = load_figures()[posture]
        band_z = fig["height"] * (1.0 - HEAD_BAND[posture])
        for cname, cfg in conditions:
            reset()
            lo_tx, hi_tx = min(xs) - 2.0, max(xs) + 2.0
            lo_ty, hi_ty = min(ys) - 2.0, max(ys) + 2.0
            cam_target = Vector(((lo_tx + hi_tx) / 2 * 3.0, (lo_ty + hi_ty) / 2 * 3.0, 0.0))
            # the frame: the projected extent of the points' box
            corners = [Vector((x * 3.0, y * 3.0, 0.0)) for x in (lo_tx, hi_tx) for y in (lo_ty, hi_ty)]
            proj_w = max(c.dot(RIGHT) for c in corners) - min(c.dot(RIGHT) for c in corners)
            fw = proj_w + 6.0
            # image height from the vertical extent of the same box: the depth axis is foreshortened
            depth = Vector((math.cos(AZ), math.sin(AZ), 0.0))
            proj_d = max(c.dot(depth) for c in corners) - min(c.dot(depth) for c in corners)
            fh = proj_d * math.sin(R.ELEVATION) + 4.0
            W_px, H_px = int(round(fw * ppm)), int(round(fh * ppm))
            R.setup_render(W_px, H_px, 1, True)
            sc = bpy.context.scene
            sc.render.filter_size = 0.0  # no blending: one sample is one pixel
            sc.cycles.samples = 1
            sc.cycles.use_denoising = False
            cam = R.make_camera()
            R.aim_camera(cam, cam_target + Vector((0, 0, 0.6)), fw)
            black = R.emission_material("black", (0.0, 0.0, 0.0))
            # occluders
            if cfg.get("reeds"):
                for ob in place_decor(win, decor_colors, {}, only_family={"reed"}, reed_scale_mul=cfg.get("reed_scale_mul", 1.0), reed_fallback=cfg.get("reed_fallback", False), reed_mass=cfg.get("reed_mass", 1)):
                    R.assign(ob, black)
            for fid, pt in enumerate(pts):
                loc = Vector((pt[0] * 3.0, pt[1] * 3.0, 0.0))
                for role, me in fig["parts"]:
                    ob = bpy.data.objects.new(f"m{fid}_{role}", me.copy())
                    bpy.context.collection.objects.link(ob)
                    ob.location = loc
                    mat = bpy.data.materials.new(f"mask_{fid}_{role}")
                    mat.use_nodes = True
                    nt = mat.node_tree
                    for nd in list(nt.nodes):
                        nt.nodes.remove(nd)
                    o = nt.nodes.new("ShaderNodeOutputMaterial")
                    e = nt.nodes.new("ShaderNodeEmission")
                    pos = nt.nodes.new("ShaderNodeNewGeometry")
                    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
                    cmp_ = nt.nodes.new("ShaderNodeMath")
                    cmp_.operation = "GREATER_THAN"
                    cmp_.inputs[1].default_value = band_z
                    nt.links.new(pos.outputs["Position"], sep.inputs["Vector"])
                    nt.links.new(sep.outputs["Z"], cmp_.inputs[0])
                    comb = nt.nodes.new("ShaderNodeCombineXYZ")
                    comb.inputs["X"].default_value = (fid + 1) / 64.0
                    gm = nt.nodes.new("ShaderNodeMath")
                    gm.operation = "MULTIPLY_ADD"
                    gm.inputs[1].default_value = 0.5
                    gm.inputs[2].default_value = 0.5
                    nt.links.new(cmp_.outputs[0], gm.inputs[0])
                    nt.links.new(gm.outputs[0], comb.inputs["Y"])
                    nt.links.new(comb.outputs[0], e.inputs["Color"])
                    nt.links.new(e.outputs[0], o.inputs["Surface"])
                    ob.data.materials.clear()  # the frozen part meshes carry stale slots
                    ob.data.materials.append(mat)
            # the ground occludes nothing here but must not be seen: a holdout plane
            hg = R.make_ground("#000000", size_m=400.0, z=0.0, centre=(60.0, 60.0))
            R.assign(hg, R.holdout_material())
            path = os.path.join(d, f"{posture}_{cname}.png")
            R.render_to(path)
            results.setdefault(posture, {})[cname] = dict(png=os.path.basename(path), W=W_px, H=H_px, ss=ss, band_z=band_z, fig_height=fig["height"])
            log("figcheck", posture, cname, W_px, H_px)
    meta["figcheck"] = dict(points=pts, results=results, zoom=zoom, ss=ss, px_per_m=ppm, head_band=HEAD_BAND)
    with open(os.path.join(out, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)


# --- stage: share ----------------------------------------------------------------------------


def _emit(name, rgb):
    return R.emission_material(name, rgb)


def stage_share(out, win, decor_colors, masses=(1, 2)):
    """The reed share of the marsh (art-numbers 2.4: tuned in P3 until 65-75%, with 25-35% water).
    Two renders per view: the marsh tiles alone (the area P), then the marsh tiles under the
    reed mat painted white. Share = white pixels inside P / pixels of P. Measured twice: from
    straight above (plan; the footprint) and through the game camera at zoom 1 (4x supersample;
    what a player sees, where height adds coverage). Water is the real field, >= 0.5."""
    d = os.path.join(out, "share")
    os.makedirs(d, exist_ok=True)
    x0, y0 = win["window"]["x0"], win["window"]["y0"]
    S = win["window"]["S"]
    nx = win["window"]["x1"] - x0 + 1
    rows = win["rows"]
    W = win["water"]
    marsh = [(x0 + i, y0 + j) for j, r in enumerate(rows) for i, ch in enumerate(r) if ch == "~"]
    xs = [t[0] for t in marsh]
    ys = [t[1] for t in marsh]
    res = {}
    for view, elev, ppm_, mass in [
        (v, e, pp, m)
        for m in masses
        for (v, e, pp) in (("plan", math.pi / 2.0 - 1e-4, 24.0), ("game_z1", None, R.px_per_m(1.0) * 4))
    ]:
        imgs = {}
        for tag in ("area", "reeds"):
            reset()
            cam = R.make_camera()
            # a quad per marsh tile (blue emission), at z = 0
            verts, faces = [], []
            for (tx, ty) in marsh:
                b = len(verts)
                for (ox, oy) in ((0, 0), (1, 0), (1, 1), (0, 1)):
                    verts.append(((tx + ox) * 3.0, (ty + oy) * 3.0, 0.0))
                faces.append((b, b + 1, b + 2, b + 3))
            me = bpy.data.meshes.new("marsh_area")
            me.from_pydata(verts, [], faces)
            me.update()
            ob = bpy.data.objects.new("marsh_area", me)
            bpy.context.collection.objects.link(ob)
            ob.data.materials.append(_emit("blue", (0.0, 0.0, 1.0)))
            if tag == "reeds":
                white = _emit("white", (1.0, 1.0, 1.0))
                for o in place_decor(win, decor_colors, {}, only_family={"reed"}, reed_mass=mass):
                    R.assign(o, white)
            lo = Vector((min(xs) * 3.0, min(ys) * 3.0, 0.0))
            hi = Vector(((max(xs) + 1) * 3.0, (max(ys) + 1) * 3.0, 0.0))
            centre = (lo + hi) / 2
            corners = [Vector((x, y, 0.0)) for x in (lo.x, hi.x) for y in (lo.y, hi.y)]
            proj_w = max(c.dot(RIGHT) for c in corners) - min(c.dot(RIGHT) for c in corners)
            depth = Vector((math.cos(AZ), math.sin(AZ), 0.0))
            proj_d = max(c.dot(depth) for c in corners) - min(c.dot(depth) for c in corners)
            fw = proj_w + 8.0
            fh = (proj_d if elev is not None else proj_d * math.sin(R.ELEVATION)) + 8.0 + (0.0 if elev is not None else 3.0)
            Wp, Hp = int(round(fw * ppm_)), int(round(fh * ppm_))
            R.setup_render(Wp, Hp, 1, True)
            sc = bpy.context.scene
            sc.render.filter_size = 0.0
            sc.cycles.samples = 1
            R.aim_camera(cam, centre + Vector((0, 0, 0.5)), fw, elevation=elev)
            p = os.path.join(d, f"{view}_m{mass}_{tag}.png")
            R.render_to(p)
            imgs[tag] = p
        res[f"{view}_m{mass}"] = dict(area=imgs["area"], reeds=imgs["reeds"], ppm=ppm_, view=view, mass=mass)
    # plan-view water share: from the window's water field over the marsh tiles
    wet = tot = 0
    for j, r in enumerate(rows):
        for i, ch in enumerate(r):
            if ch != "~":
                continue
            for b in range(S):
                for a in range(S):
                    tot += 1
                    wet += W[(j * S + b) * (nx * S) + i * S + a] >= 0.5
    meta["share"] = dict(views=res, water_share=wet / tot, marsh_tiles=len(marsh))
    with open(os.path.join(out, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)


# --- main --------------------------------------------------------------------------------


def main():
    a = parse()
    out = a["out"]
    os.makedirs(out, exist_ok=True)
    if os.path.exists(os.path.join(out, "meta.json")):
        meta.update(json.load(open(os.path.join(out, "meta.json"))))
    win = json.load(open(a["window"])) if a["window"] else None
    decor_colors = win["decorColors"] if win else None
    only = set(a["only"].split(",")) if a["only"] else None
    stages = ["plates", "scene", "share", "figcheck"] if a["stage"] == "all" else [a["stage"]]
    for st in stages:
        if st == "plates":
            stage_plates(out, a["samples"], only, decor_colors)
        elif st == "scene":
            stage_scene(out, a["samples"], win, a["ground_dir"], decor_colors)
        elif st == "share":
            stage_share(out, win, decor_colors)
        elif st == "figcheck":
            stage_figcheck(out, win, decor_colors)


if __name__ == "__main__":
    main()
