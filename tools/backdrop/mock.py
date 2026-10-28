"""R1c: the composed Wadi Halam IV mock.

WH IV's own elevation grid is the floor lozenge (a pasture tone), the procedural
floor field continues beyond the rim exactly as the prototype's `backdropField`
does (rim blended to the rim mean over 10 tiles), the kit ring comes from
`layout.layout_ns`, and the real olives stand on the terrace treads. The fade
to the scene background over the outer 40% of the 48-tile margin and the
"explored ground" dimming are the prototype's rules 3 and 4, rebuilt as shader
nodes so the mock shows what the game would.
"""
import json
import math
import os

import numpy as np
import bpy
import mathutils

import kitlib as K
import layout as L
import render_kit as R

TILE = 3.0
MARGIN_TILES = 48


def load_map():
    with open(os.path.join(K.REPO, "data", "maps", "wadi_halam_4.json")) as f:
        m = json.load(f)
    elev = np.array([[int(c) for c in row] for row in m["elevation"]], dtype=np.float64)
    return m, elev


def rim_field(elev):
    """Tile-centre levels -> metres, smoothed; sampled at tile coordinates."""
    z = elev * K.LEVEL_M
    zb = K.box_blur(z, 1)

    def at(x, y):
        x = np.clip(np.asarray(x, dtype=np.float64) - 0.5, 0, elev.shape[1] - 1.001)
        y = np.clip(np.asarray(y, dtype=np.float64) - 0.5, 0, elev.shape[0] - 1.001)
        x0 = np.floor(x).astype(int)
        y0 = np.floor(y).astype(int)
        fx, fy = x - x0, y - y0
        return (zb[y0, x0] * (1 - fx) * (1 - fy) + zb[y0, x0 + 1] * fx * (1 - fy)
                + zb[y0 + 1, x0] * (1 - fx) * fy + zb[y0 + 1, x0 + 1] * fx * fy)
    return at


def floor_mesh(elev, seed=7):
    w = elev.shape[1]
    h = elev.shape[0]
    rim = rim_field(elev)
    edge = np.concatenate([rim(np.arange(0, w + 1), np.zeros(w + 1)), rim(np.arange(0, w + 1), np.full(w + 1, h)),
                           rim(np.zeros(h + 1), np.arange(0, h + 1)), rim(np.full(h + 1, w), np.arange(0, h + 1))])
    rim_mean = float(edge.mean())
    step = 0.5   # tiles = 1.5 m
    xs = np.arange(-MARGIN_TILES, w + MARGIN_TILES + 1e-9, step)
    zs = np.arange(-MARGIN_TILES, h + MARGIN_TILES + 1e-9, step)
    X, Z = np.meshgrid(xs, zs)
    cx, cz = np.clip(X, 0, w), np.clip(Z, 0, h)
    base = rim(cx, cz)
    out = np.hypot(np.maximum(np.maximum(-X, X - w), 0), np.maximum(np.maximum(-Z, Z - h), 0))
    t = K.smooth(0, 10, out)
    Y = base + (rim_mean - base) * t + 0.3 * K.fbm(X, Z, 18, 2, seed + 6) * K.smooth(0, 6, out)
    Y = np.where(out == 0, base - 0.02, Y)
    # colour: the map's own ground is a green basin pasture; beyond it, the same sward
    Xm, Zm = X * TILE, Z * TILE
    n_big = K.fbm(Xm, Zm, 34.0, 3, seed + 81)
    n_mid = K.fbm(Xm, Zm, 8.0, 3, seed + 82)
    n_fine = K.vnoise(Xm, Zm, 1.6, seed + 83)
    inside = out == 0
    col = K.GRASS.at(np.clip(1.3 + 1.1 * n_mid + 0.5 * n_fine, 0, 5))
    col = K.mix(col, K.DUST.at(np.clip(1.4 + 1.2 * n_mid, 0, 6)), 0.35 * K.smooth(0.0, 0.6, n_big) * (1 - inside * 0.6))
    return X * TILE, -Z * TILE, Y, col, rim, rim_mean, out


def make_floor(scene, elev):
    X, Y, Zh, col, rim, rim_mean, out = floor_mesh(elev)
    ny, nx = X.shape
    pos = np.stack([X.ravel(), Y.ravel(), Zh.ravel()], axis=1)
    idx = np.arange(nx * ny).reshape(ny, nx)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
    # Y = -z, so rows run towards -Y: keep the winding facing +Z
    tris = np.concatenate([np.stack([a, c, b], 1), np.stack([b, c, d], 1)])
    me = bpy.data.meshes.new("floor")
    me.from_pydata(pos.tolist(), [], tris.tolist())
    me.update()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    attr = me.color_attributes.new("col", "FLOAT_COLOR", "POINT")
    lin = R.srgb_to_lin(col.reshape(-1, 3))
    rgba = np.concatenate([lin, np.ones((len(lin), 1))], axis=1).astype(np.float32)
    attr.data.foreach_set("color", rgba.ravel())
    ob = bpy.data.objects.new("floor", me)
    scene.collection.objects.link(ob)
    mat = bpy.data.materials.new("floor")
    mat.use_nodes = True
    nt = mat.node_tree
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "col"
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    me.materials.append(mat)
    return ob, rim, rim_mean


# NOTE: the prototype fades over 0.55-0.98 of a 48-tile margin; the kit's slopes reach 40 tiles,
# so the mock fades over 0.50-0.80 (a recommendation for the runtime, see notes.md).
def fade_wrap(mat, map_w_m, map_h_m, margin_m, bg_lin, tint_lin, dim_amount=0.4, dim_ramp=12.0):
    """Shader nodes for the prototype's rules: dim (explored) and fade to background."""
    nt = mat.node_tree
    outn = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    src = outn.inputs["Surface"].links[0].from_socket
    pos = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(pos.outputs["Position"], sep.inputs[0])

    def math_(op, a=None, b=None, clamp=False):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        if a is not None and not hasattr(a, "node"):
            n.inputs[0].default_value = a
        if b is not None and not hasattr(b, "node"):
            n.inputs[1].default_value = b
        return n

    def link(n, i, s):
        if hasattr(s, "node"):
            nt.links.new(s, n.inputs[i])
        else:
            n.inputs[i].default_value = s

    def op(name, a, b=None):
        n = math_(name)
        link(n, 0, a)
        if b is not None:
            link(n, 1, b)
        return n.outputs[0]

    x, y = sep.outputs["X"], sep.outputs["Y"]
    ox = op("MAXIMUM", op("MAXIMUM", op("MULTIPLY", x, -1.0), op("SUBTRACT", x, map_w_m)), 0.0)
    oy = op("MAXIMUM", op("MAXIMUM", y, op("SUBTRACT", op("MULTIPLY", y, -1.0), map_h_m)), 0.0)
    dist = op("SQRT", op("ADD", op("MULTIPLY", ox, ox), op("MULTIPLY", oy, oy)))
    # fade = smoothstep(0.55 M, 0.98 M); dim = amount * smoothstep(0, ramp)
    def sstep(v, a, b):
        t = op("DIVIDE", op("SUBTRACT", v, a), b - a)
        t = op("MINIMUM", op("MAXIMUM", t, 0.0), 1.0)
        return op("MULTIPLY", op("MULTIPLY", t, t), op("SUBTRACT", 3.0, op("MULTIPLY", t, 2.0)))
    fade = sstep(dist, 0.50 * margin_m, 0.80 * margin_m)
    dim = op("MULTIPLY", sstep(dist, 0.0, dim_ramp), dim_amount)
    em_t = nt.nodes.new("ShaderNodeEmission")
    em_t.inputs["Color"].default_value = (*tint_lin, 1.0)
    em_b = nt.nodes.new("ShaderNodeEmission")
    em_b.inputs["Color"].default_value = (*bg_lin, 1.0)
    m1 = nt.nodes.new("ShaderNodeMixShader")
    m2 = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(dim, m1.inputs[0])
    nt.links.new(src, m1.inputs[1])
    nt.links.new(em_t.outputs[0], m1.inputs[2])
    nt.links.new(fade, m2.inputs[0])
    nt.links.new(m1.outputs[0], m2.inputs[1])
    nt.links.new(em_b.outputs[0], m2.inputs[2])
    nt.links.new(m2.outputs[0], outn.inputs["Surface"])


def flat_material(name, key, roughness=0.95):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*R.lin(key), 1.0)
    b.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.0
    return mat


def house_meshes():
    """A placeholder house: a box with a hip roof, 12 + 6 triangles."""
    s = 1.5
    h = 2.7
    v = [(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0), (-s, -s, h), (s, -s, h), (s, s, h), (-s, s, h)]
    walls = [(0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    me = bpy.data.meshes.new("house_walls")
    me.from_pydata(v, [], walls)
    me.update()
    rv = [(-s - 0.25, -s - 0.25, h), (s + 0.25, -s - 0.25, h), (s + 0.25, s + 0.25, h), (-s - 0.25, s + 0.25, h), (-0.8, 0, h + 1.2), (0.8, 0, h + 1.2)]
    roof = [(0, 1, 5), (0, 5, 4), (1, 2, 5), (2, 3, 4), (2, 4, 5), (3, 0, 4)]
    mr = bpy.data.meshes.new("house_roof")
    mr.from_pydata(rv, [], roof)
    mr.update()
    return me, mr


def placement_matrix(pl, y0):
    th = -math.radians(pl["rot"])
    m = mathutils.Matrix.Translation((pl["at"][0] * TILE, -pl["at"][1] * TILE, y0)) @ mathutils.Matrix.Rotation(th, 4, "Z")
    if pl["mirror"]:
        m = m @ mathutils.Matrix.Scale(-1.0, 4, (0, 1, 0))
    return m


def run(args, work, stats):
    m, elev = load_map()
    w, h = elev.shape[1], elev.shape[0]
    scene, co = R.setup_scene(args.samples, 1400, 900)
    R.only_visible(set())
    for col in bpy.data.collections:
        if col.name.startswith("piece:"):
            for o in col.objects:
                o.hide_render = True
    floor, rim, rim_mean = make_floor(scene, elev)
    W_m, H_m, M_m = w * TILE, h * TILE, MARGIN_TILES * TILE
    bg_lin = R.lin("shadow.1")
    tint = R.lin("shadow.0")
    fade_wrap(floor.data.materials[0], W_m, H_m, M_m, bg_lin, tint)
    kit = bpy.data.materials["wadi_halam_kit"]
    fade_wrap(kit, W_m, H_m, M_m, bg_lin, tint)
    hw, hr = house_meshes()
    mat_w = flat_material("house_wall", "limestone.2")
    mat_r = flat_material("house_roof", "terracotta.1")
    fade_wrap(mat_w, W_m, H_m, M_m, bg_lin, tint)
    fade_wrap(mat_r, W_m, H_m, M_m, bg_lin, tint)
    hw.materials.append(mat_w)
    hr.materials.append(mat_r)

    placements = L.layout_ns(w, h)
    # one shared base height per side family, below the rim so a foot buries into the floor
    far_edges = np.concatenate([rim(np.zeros(h + 1), np.arange(0, h + 1)), rim(np.arange(0, w + 1), np.zeros(w + 1))])
    near_edges = np.concatenate([rim(np.full(h + 1, w), np.arange(0, h + 1)), rim(np.arange(0, w + 1), np.full(w + 1, h))])
    y_far = float(np.percentile(far_edges, 15)) - 0.3
    y_near = float(np.percentile(near_edges, 15)) - 0.2
    prof = stats.get("profile")
    objs = []
    for k, pl in enumerate(placements):
        pid = pl["id"]
        near = pid.startswith("bd_slope") and pl["rot"] in (180, 270)
        y0 = y_near if near else y_far
        if pid.startswith("bd_crest"):
            y0 = y_far + K.CREST_M - 0.4
        if pid.startswith("bd_scree"):
            d = abs(pl["at"][0]) * TILE if pl["rot"] in (0, 180) else abs(pl["at"][1]) * TILE
            y0 = y_far + float(np.interp(d, prof["d"], prof["y"]))
        me = bpy.data.objects[pid].data
        ob = bpy.data.objects.new("%s#%d" % (pid, k), me)
        scene.collection.objects.link(ob)
        ob.matrix_world = placement_matrix(pl, y0)
        ob["rl_role"] = pid
        objs.append((ob, pl, y0))
    # hamlet: placeholder houses at the anchor_house empties
    n_houses = 0
    for ob, pl, y0 in objs:
        for a in stats["pieces"][pl["id"]].get("anchors", []):
            if not a["name"].startswith("anchor_house"):
                continue
            loc = ob.matrix_world @ mathutils.Vector(a["local"])
            yaw = (float(K.tile_hash(n_houses, 3)) - 0.5) * 1.2 + math.radians(-pl["rot"])
            sc = 0.85 + 0.5 * float(K.tile_hash(n_houses, 9))
            for me_h in (hw, hr):
                ho = bpy.data.objects.new("house", me_h)
                scene.collection.objects.link(ho)
                ho.location = loc
                ho.rotation_euler = (0, 0, yaw)
                ho.scale = (sc, sc, sc)
            n_houses += 1
    # real olives on the terrace treads
    olive_me = bpy.data.objects["bd_olive"].data
    n_olive = 0
    for ob, pl, y0 in objs:
        for q in stats["pieces"][pl["id"]].get("olives", []):
            loc = ob.matrix_world @ mathutils.Vector(q)
            oo = bpy.data.objects.new("olive", olive_me)
            scene.collection.objects.link(oo)
            oo.location = loc
            sc = 0.85 + 0.3 * float(K.tile_hash(n_olive, 17))
            oo.rotation_euler = (0, 0, float(K.tile_hash(n_olive, 5)) * 6.28)
            oo.scale = (sc, sc, sc * (0.9 + 0.2 * float(K.tile_hash(n_olive, 23))))
            n_olive += 1
    print("placed %d pieces, %d houses, %d olives" % (len(objs), n_houses, n_olive))

    px_per_m = R.PX_PER_M_Z1
    mdir = os.path.join(args.out, "mock")
    os.makedirs(mdir, exist_ok=True)
    cx, cy = W_m / 2, -H_m / 2
    zc = rim_mean
    views = [
        ("z0.35-centre-day", 0.35, (cx, cy, zc), "day", True),
        ("z0.35-centre-dusk", 0.35, (cx, cy, zc), "dusk", True),
        ("z0.35-centre-day-floor-only", 0.35, (cx, cy, zc), "day", False),
        ("z1-west-day", 1.0, (2 * TILE, -h / 2 * TILE, 1.0), "day", True),
        ("z1-north-day", 1.0, (w / 2 * TILE, -2 * TILE, 3.0), "day", True),
        ("z1-south-day", 1.0, (w / 2 * TILE, -(h - 2) * TILE, 1.0), "day", True),
        ("z2.5-west-day", 2.5, (2 * TILE, -h / 2 * TILE, 1.0), "day", True),
        ("z2.5-north-day", 2.5, (w / 2 * TILE, -2 * TILE, 3.0), "day", True),
    ]
    if os.environ.get("MOCK_TOPDOWN"):
        views = [("topdown", 0.0, (cx, cy, zc), "day", True)]
    for name, zoom, target, light, show_kit in views:
        R.set_lights(scene, light)
        for ob, pl, y0 in objs:
            ob.hide_render = not show_kit
        for o in bpy.data.objects:
            if o.name.startswith(("olive", "house")):
                o.hide_render = not show_kit
        if zoom == 0.0:
            co.location = (target[0], target[1], 800.0)
            co.rotation_euler = (0, 0, 0)
            co.data.ortho_scale = 560.0
        else:
            R.aim(co, target, 1400.0 / (px_per_m * zoom))
        R.render_to_png(scene, os.path.join(mdir, name + ".png"), "shadow.1", work)
        print("mock", name, flush=True)
