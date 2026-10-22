"""Build the Lavi Ambush Tank -- `mbt_lavi_camo` (GH-709, special units P2) --
from the SHIPPED `mbt_lavi.glb`, at 0 credits.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/vehicles/export_lavi_camo.py

Writes `art/meshes/vehicles/mbt_lavi_camo.glb` in the Lavi's 6.32 m export
frame and `art/src/vehicles/mbt_lavi_camo.blend` (the committed source). Then,
in order: `pnpm rescale:meshes -- --id=mbt_lavi_camo` (x1.18),
`pnpm running-gear:meshes -- --id=mbt_lavi_camo`, `pnpm wreck:meshes --
--id=mbt_lavi_camo`, `pnpm damage:meshes -- --id=mbt_lavi_camo`,
`pnpm encode:meshes`, `pnpm validate:meshes`. No kit: the unit declares no
upgrade tracks, and the imported `kit_*` nodes (where the Lavi's APS lives)
are stripped.

SOURCE: `art/meshes/vehicles/mbt_lavi.glb` (itself a cut of a Meshy tank,
AI-generated, disclosed per CONTRIBUTING.md; `docs/ASSET_PROVENANCE.md`),
exactly as `export_officer_armour.py` uses it: same bytes, same bake, same four
live nodes and `turret_pivot`. The net itself is authored here, in code, from
hand-rolled `vnoise`/`fbm` (NEVER `mathutils.noise`: Blender 5.2 reseeds it per
process, so a render would shape-shift between runs). Every number below is a
literal, and the build is a pure function of them: two runs write the same
bytes.

THE NET. One heightfield, sampled on a 6 cm grid over the hull and turret
footprint by ray-casting down onto `hull_hull` and `turret_hull`:

  * a CONE dilation of the measured surface (slope `NET_SLOPE`): the net is
    taut over the high features and bridges the gaps between them, and outside
    the footprint it falls away from the edge -- the sagging drops over bustle,
    glacis, fenders and mantlet, with no extra geometry;
  * lumps (`fbm`) and eight propped-up humps on top, so the top line is
    irregular where a plain skin would follow the turret exactly;
  * the edge is ragged (`fbm` on the drop-off distance) and the net STOPS at
    `NET_Z_MIN`, above the track runs (`hull_rubber` tops out at 0.44 m), and
    at `turret_hull`'s own front, so the gun barrel (`turret_metal`) is bare;
  * faces over the turret join `turret_hull` (they turn with it), the rest
    join `hull_hull`;
  * garnish: scrim loops hanging from the ragged edge, and cut-foliage tufts
    along the ridge and out past the rim.

COLOUR. No baked team colour and no new texture: every face's UV is pinned to
ONE texel of the Lavi's own bake (as `export_officer_armour.py` pins its
parts), chosen per face from a 3-tone disruptive pattern: sand paint, the
brown shade paint, and the near-black gunmetal. Texel positions were read off
the bake image (2048 px) as flat patches (std <= 8 over a 30 px box).
"""
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, TOOLS)

import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary
import textured as vehicle_textured  # noqa: E402
import rescale as vehicle_rescale  # noqa: E402

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(REPO, "art", "meshes", "vehicles", "mbt_lavi.glb")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "mbt_lavi_camo.glb")
BLEND_PATH = os.path.join(REPO, "art", "src", "vehicles", "mbt_lavi_camo.blend")

# ---------------------------------------------------------------- constants
CELL = 0.06                      # grid pitch, metres (raycast and mesh share it)
X0, X1, Y0, Y1 = -3.45, 2.35, -1.70, 1.70
NET_SLOPE = 1.5                  # drop per metre outward of the footprint (~56 deg)
CONE_R = 12                      # cells: dilation reach (0.72 m)
FOOT_Z = 0.80                    # a surface above this is "under the net"
NET_Z_MIN = 0.62                 # the net never hangs below this (track tops at 0.44)
NET_LIFT = 0.05                  # net rides this far above the skin it covers
D_MIN, D_VAR = 0.03, 0.09        # ragged drop-off distance: D_MIN + D_VAR * (0..1)
POLES = (                        # (x, y, radius, height) propped humps
    (-2.55, 0.55, 0.60, 0.28), (-1.55, -0.70, 0.65, 0.42), (-0.60, 0.20, 0.55, 0.30),
    (0.25, -0.30, 0.50, 0.46), (1.10, 0.55, 0.55, 0.20), (1.45, -0.55, 0.50, 0.22),
    (-0.95, 0.85, 0.45, 0.40), (-2.90, -0.40, 0.50, 0.20),
)
# Texels of the Lavi's own bake (u, v with v up, i.e. 1 - y/2048 of the image).
TEXEL_SAND = (636 / 2048.0, 1.0 - 1378 / 2048.0)     # sand paint
TEXEL_SHADE = (625 / 2048.0, 1.0 - 848 / 2048.0)     # brown shade paint
TEXEL_GUN = (773 / 2048.0, 1.0 - 742 / 2048.0)       # gunmetal
N_LOOPS = 18
N_TUFTS = 64
N_RIM_TUFTS = 14
SEED = 7


def log(msg):
    print(f"[lavi_camo] {msg}")


# ------------------------------------------------- hand-rolled noise (no mathutils.noise)
def _hash01(ix, iy, salt):
    h = (ix * 374761393 + iy * 668265263 + salt * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) / float(0xFFFFFFFF)


def vnoise(x, y, salt=0):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy)
    a, b = _hash01(ix, iy, salt), _hash01(ix + 1, iy, salt)
    c, d = _hash01(ix, iy + 1, salt), _hash01(ix + 1, iy + 1, salt)
    v = a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
    return 2.0 * v - 1.0


def fbm(x, y, salt=0, octaves=4):
    amp, freq, total, norm = 1.0, 1.0, 0.0, 0.0
    for o in range(octaves):
        total += amp * vnoise(x * freq, y * freq, salt + 101 * o)
        norm += amp
        amp *= 0.5
        freq *= 2.0
    return total / norm


def rnd(i, salt):
    return _hash01(i, salt * 7 + 3, SEED + salt)


# ---------------------------------------------------------------- the field
def world_bvh(ob):
    me = ob.data
    mw = ob.matrix_world
    verts = [tuple(mw @ v.co) for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    return BVHTree.FromPolygons(verts, polys)


def sample_top(bvh, xs, ys):
    out = np.full((len(ys), len(xs)), -np.inf)
    down = Vector((0.0, 0.0, -1.0))
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            hit = bvh.ray_cast(Vector((x, y, 6.0)), down)
            if hit[0] is not None:
                out[j, i] = hit[0].z
    return out


def shifted(a, dj, di, fill):
    out = np.full_like(a, fill)
    nj, ni = a.shape
    j0, j1 = max(0, dj), min(nj, nj + dj)
    i0, i1 = max(0, di), min(ni, ni + di)
    out[j0:j1, i0:i1] = a[j0 - dj:j1 - dj, i0 - di:i1 - di]
    return out


def build_field(hull, turret):
    xs = np.arange(X0, X1 + 1e-6, CELL)
    ys = np.arange(Y0, Y1 + 1e-6, CELL)
    hh = sample_top(world_bvh(hull), xs, ys)
    ht = sample_top(world_bvh(turret), xs, ys)
    raw = np.maximum(hh, ht)
    is_turret = ht > hh + 0.05
    foot = raw > FOOT_Z
    cone = np.full(raw.shape, -np.inf)
    dist = np.full(raw.shape, np.inf)
    for dj in range(-CONE_R, CONE_R + 1):
        for di in range(-CONE_R, CONE_R + 1):
            d = math.hypot(dj, di) * CELL
            if d > CONE_R * CELL:
                continue
            cone = np.maximum(cone, shifted(raw, dj, di, -np.inf) - NET_SLOPE * d)
            dist = np.minimum(dist, shifted(np.where(foot, 0.0, np.inf), dj, di, np.inf) + d)
    # the label of a node: turret if the nearest footprint sample is a turret one
    label = is_turret.copy()
    for dj in range(-3, 4):
        for di in range(-3, 4):
            label |= shifted(is_turret, dj, di, False) & ~foot
    X, Y = np.meshgrid(xs, ys)
    h = cone + NET_LIFT
    for j in range(len(ys)):
        for i in range(len(xs)):
            x, y = xs[i], ys[j]
            lump = 0.065 * fbm(x * 2.2, y * 2.2, 11) + 0.025 * vnoise(x * 7.0, y * 7.0, 13)
            for px, py, pr, ph in POLES:
                r2 = ((x - px) ** 2 + (y - py) ** 2) / (pr * pr)
                if r2 < 9.0:
                    lump += ph * math.exp(-r2 * 1.6)
            h[j, i] += lump
    dmax = np.zeros_like(h)
    for j in range(len(ys)):
        for i in range(len(xs)):
            dmax[j, i] = D_MIN + D_VAR * (0.5 + 0.5 * fbm(xs[i] * 3.1, ys[j] * 3.1, 17))
    valid = np.isfinite(h) & (h >= NET_Z_MIN) & (dist <= dmax)
    # the drop-off must also fall, not rise, over the ragged rim: clamp to the floor
    h = np.where(valid, np.maximum(h, NET_Z_MIN), NET_Z_MIN)
    return xs, ys, h, valid, label, dist


# ---------------------------------------------------------------- the mesh
def class_of(x, y):
    n = fbm(x * 1.25, y * 1.25, 31) + 0.35 * vnoise(x * 0.45 + 3.1, y * 0.45, 37)
    if n < -0.14:
        return 2          # gunmetal
    if n < 0.16:
        return 0          # sand
    return 1              # shade


def texel(cls):
    return (TEXEL_SAND, TEXEL_SHADE, TEXEL_GUN)[cls]


def mk_object(name, verts, faces, face_cls, mat, uv_name):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    me.update()
    layer = me.uv_layers.new(name=uv_name)
    for poly, cls in zip(me.polygons, face_cls):
        u, v = texel(cls)
        for li in poly.loop_indices:
            layer.data[li].uv = (u, v)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def build_net(xs, ys, h, valid, label, mat, uv_name):
    nj, ni = h.shape
    parts = {False: ([], [], []), True: ([], [], [])}
    maps = {False: {}, True: {}}

    def vid(lab, j, i):
        verts = parts[lab][0]
        m = maps[lab]
        if (j, i) not in m:
            m[(j, i)] = len(verts)
            verts.append((xs[i], ys[j], h[j, i]))
        return m[(j, i)]

    for j in range(nj - 1):
        for i in range(ni - 1):
            # two triangles, split along the diagonal that alternates (no grain)
            if (i + j) % 2 == 0:
                tris = (((j, i), (j, i + 1), (j + 1, i + 1)), ((j, i), (j + 1, i + 1), (j + 1, i)))
            else:
                tris = (((j, i), (j, i + 1), (j + 1, i)), ((j, i + 1), (j + 1, i + 1), (j + 1, i)))
            for t in tris:
                if not all(valid[a, b] for a, b in t):
                    continue
                cx = sum(xs[b] for a, b in t) / 3.0
                cy = sum(ys[a] for a, b in t) / 3.0
                lab = bool(sum(label[a, b] for a, b in t) >= 2)
                cls = class_of(cx, cy)
                if _hash01(int(cx * 40), int(cy * 40), 41) < 0.05:
                    cls = (cls + 1) % 3
                ids = [vid(lab, a, b) for a, b in t]
                parts[lab][1].append(ids)
                parts[lab][2].append(cls)
    objs = {}
    for lab, name in ((False, "net_hull"), (True, "net_turret")):
        v, f, c = parts[lab]
        if f:
            objs[name] = mk_object(name, v, f, c, mat, uv_name)
    return objs


def surface_z(xs, ys, h, x, y):
    i = int(round((x - xs[0]) / CELL))
    j = int(round((y - ys[0]) / CELL))
    i = max(0, min(len(xs) - 1, i))
    j = max(0, min(len(ys) - 1, j))
    return h[j, i]


def thin_ribbon(path, widths, cls_pair):
    """A double-sided ribbon along `path` (list of Vector), width per point."""
    verts, faces = [], []
    n = len(path)
    for k in range(n):
        a = path[max(0, k - 1)]
        b = path[min(n - 1, k + 1)]
        t = (b - a)
        t.normalize()
        side = t.cross(Vector((0.0, 0.0, 1.0)))
        if side.length < 1e-4:
            side = Vector((1.0, 0.0, 0.0))
        side.normalize()
        verts.append(tuple(path[k] - side * widths[k] * 0.5))
        verts.append(tuple(path[k] + side * widths[k] * 0.5))
    for k in range(n - 1):
        a, b, c, d = 2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2
        faces.append((a, b, c))
        faces.append((a, c, d))
        faces.append((c, b, a))
        faces.append((d, c, a))
    return verts, faces


def build_garnish(xs, ys, h, valid, label, mat, uv_name):
    """Scrim loops off the ragged edge."""
    nj, ni = h.shape
    edge = []
    for j in range(1, nj - 1):
        for i in range(1, ni - 1):
            if not valid[j, i] or h[j, i] < 0.85:
                continue
            nbrs = [(j + 1, i), (j - 1, i), (j, i + 1), (j, i - 1)]
            out = Vector((0.0, 0.0, 0.0))
            for a, b in nbrs:
                if not valid[a, b]:
                    out += Vector((xs[b] - xs[i], ys[a] - ys[j], 0.0))
            if out.length > 0:
                out.normalize()
                edge.append((_hash01(i, j, 53), i, j, out))
    edge.sort(key=lambda e: e[0])
    chosen = []
    for _, i, j, out in edge:
        p = Vector((xs[i], ys[j], h[j, i]))
        if all((p - q[0]).length > 0.75 for q in chosen):
            chosen.append((p, out, label[j, i]))
        if len(chosen) >= N_LOOPS:
            break
    buckets = {False: ([], [], []), True: ([], [], [])}
    for k, (p, out, lab) in enumerate(chosen):
        L = 0.30 + 0.30 * rnd(k, 61)
        tang = Vector((-out.y, out.x, 0.0)) * (0.10 + 0.08 * rnd(k, 62))
        path, widths = [], []
        steps = 10
        for s in range(steps + 1):
            t = s / steps
            sn = math.sin(math.pi * t)
            path.append(p + out * (0.05 * sn) + tang * t - Vector((0.0, 0.0, L * sn)))
            widths.append(0.055 * (0.65 + 0.35 * sn))
        v, f = thin_ribbon(path, widths, None)
        base = len(buckets[lab][0])
        buckets[lab][0].extend(v)
        buckets[lab][1].extend([tuple(x + base for x in face) for face in f])
        cls = 2 if rnd(k, 63) < 0.55 else 1
        buckets[lab][2].extend([cls] * len(f))
    objs = {}
    for lab, name in ((False, "garnish_hull"), (True, "garnish_turret")):
        v, f, c = buckets[lab]
        if f:
            objs[name] = mk_object(name, v, f, c, mat, uv_name)
    return objs, len(chosen)


def build_tufts(xs, ys, h, valid, label, mat, uv_name):
    """Cut-foliage tufts: ridge tufts on the crown, rim tufts leaning outward."""
    nj, ni = h.shape
    cand = []
    for j in range(2, nj - 2):
        for i in range(2, ni - 2):
            if not valid[j, i]:
                continue
            x, y, z = xs[i], ys[j], h[j, i]
            rim = not (valid[j + 2, i] and valid[j - 2, i] and valid[j, i + 2] and valid[j, i - 2])
            cand.append((_hash01(i, j, 71), x, y, z, i, j, rim))
    cand.sort(key=lambda c: c[0])
    chosen = []
    for _, x, y, z, i, j, rim in cand:
        if rim:
            if z < 0.9 or sum(1 for c in chosen if c[4]) >= N_RIM_TUFTS:
                continue
        elif z < 1.1 or abs(y) > 0.95 or sum(1 for c in chosen if not c[4]) >= N_TUFTS:
            continue
        sp = 0.55 if rim else 0.42
        if any(math.hypot(x - c[0], y - c[1]) < sp for c in chosen):
            continue
        chosen.append((x, y, z, label[j, i], rim, i, j))
    buckets = {False: ([], [], []), True: ([], [], [])}
    for k, (x, y, z, lab, rim, i, j) in enumerate(chosen):
        outv = Vector((0.0, 0.0, 0.0))
        if rim:
            for a, b in ((j + 2, i), (j - 2, i), (j, i + 2), (j, i - 2)):
                if not valid[a, b]:
                    outv += Vector((xs[b] - xs[i], ys[a] - ys[j], 0.0))
            if outv.length > 0:
                outv.normalize()
        nblades = 5 + int(rnd(k, 81) * 3)
        for b in range(nblades):
            ang = 2 * math.pi * rnd(k * 9 + b, 82)
            tilt = (0.25 + 0.55 * rnd(k * 9 + b, 83))
            lean = Vector((math.cos(ang), math.sin(ang), 0.0)) * tilt + outv * (0.2 if rim else 0.0)
            ln = (0.25 if rim else 0.35) + (0.25 if rim else 0.40) * rnd(k * 9 + b, 84)
            base = Vector((x + 0.07 * (rnd(k * 9 + b, 85) - 0.5), y + 0.07 * (rnd(k * 9 + b, 86) - 0.5), z - 0.02))
            up = Vector((0.0, 0.0, 1.0))
            d1 = (up + lean * 0.5).normalized()
            d2 = (up + lean * 1.2).normalized()
            p1 = base + d1 * (ln * 0.5)
            p2 = base + d2 * ln
            side = d1.cross(Vector((0.0, 0.0, 1.0)))
            if side.length < 1e-4:
                side = Vector((1.0, 0.0, 0.0))
            side.normalize()
            w = 0.055
            v = [base - side * w, base + side * w, p1 - side * w * 0.8, p1 + side * w * 0.8, p2]
            f = [(0, 1, 3), (0, 3, 2), (2, 3, 4), (3, 1, 0), (2, 3, 0)[::-1], (4, 3, 2)]
            f = [(0, 1, 3), (0, 3, 2), (2, 3, 4), (3, 1, 0), (2, 0, 3), (4, 3, 2)]
            bv, bf, bc = buckets[lab]
            o = len(bv)
            bv.extend(v)
            bf.extend([tuple(a + o for a in face) for face in f])
            cls = 1 if rnd(k * 9 + b, 87) < 0.6 else 0
            bc.extend([cls] * len(f))
    objs = {}
    for lab, name in ((False, "tufts_hull"), (True, "tufts_turret")):
        v, f, c = buckets[lab]
        if f:
            objs[name] = mk_object(name, v, f, c, mat, uv_name)
    return objs, len(chosen)


def join_into(host, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    host.select_set(True)
    bpy.context.view_layer.objects.active = host
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def export():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC, import_scene_extras=True)
    vehicle_rescale.unscale_imported(log)
    kit = [o for o in bpy.data.objects if o.name.startswith("kit_")]
    for o in kit:
        bpy.data.objects.remove(o, do_unlink=True)
    log(f"dropped {len(kit)} imported kit_* object(s)")
    for scene in bpy.data.scenes:
        if "rl_running_gear" in scene:
            del scene["rl_running_gear"]
    for o in bpy.data.objects:
        if o.type == "MESH":
            for name in ("_RL_WHEEL", "_RL_TRACK"):
                if name in o.data.attributes:
                    o.data.attributes.remove(o.data.attributes[name])
    objs = {o.name: o for o in bpy.data.objects}
    for need in ("hull_hull", "hull_rubber", "turret_hull", "turret_metal", "turret_pivot"):
        if need not in objs:
            raise SystemExit(f"{SRC}: no object {need!r} -- not the Lavi this script was written against")
    dead = [o for o in bpy.data.objects if o.name == "death_root" or o.name.startswith("WRECK_")]
    for o in dead:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()
    log(f"dropped {len(dead)} imported wreck object(s) and the idle/wreck clips")
    bpy.context.view_layer.update()

    mat = objs["turret_hull"].data.materials[0]
    if mat is not objs["turret_metal"].data.materials[0]:
        raise SystemExit("turret_hull and turret_metal do not share one material -- not the shipped Lavi")
    uv_name = objs["turret_hull"].data.uv_layers.active.name

    before = {n: len(objs[n].data.polygons) for n in ("hull_hull", "hull_rubber", "turret_hull", "turret_metal")}
    xs, ys, h, valid, label, dist = build_field(objs["hull_hull"], objs["turret_hull"])
    log(f"field {len(xs)}x{len(ys)} nodes, {int(valid.sum())} valid, net z {h[valid].min():.2f}..{h[valid].max():.2f}")
    net = build_net(xs, ys, h, valid, label, mat, uv_name)
    garnish, n_loops = build_garnish(xs, ys, h, valid, label, mat, uv_name)
    tufts, n_tufts = build_tufts(xs, ys, h, valid, label, mat, uv_name)
    log(f"{n_loops} scrim loops, {n_tufts} tufts")
    groups = {"hull_hull": [], "turret_hull": []}
    for d in (net, garnish, tufts):
        for name, ob in d.items():
            groups["turret_hull" if name.endswith("turret") else "hull_hull"].append(ob)
    added = {}
    for host_name, parts in groups.items():
        tris = sum(len(p.data.polygons) for p in parts)
        joined = join_into(objs[host_name], parts)
        objs[host_name] = joined
        added[host_name] = tris
        log(f"{host_name}: {before[host_name]} -> {len(joined.data.polygons)} faces (+{tris}), "
            f"{len(joined.data.materials)} material slot(s), role {joined.get('rl_role')!r}")
    for name in ("hull_hull", "hull_rubber", "turret_hull", "turret_metal"):
        ob = objs[name]
        if len([m for m in ob.data.materials if m is not None]) != 1:
            raise SystemExit(f"{name}: expected one material after the join")
        co = np.array([tuple(ob.matrix_world @ v.co) for v in ob.data.vertices])
        log(f"{name}: world z {co[:, 2].min():.2f}..{co[:, 2].max():.2f}, "
            f"x {co[:, 0].min():.2f}..{co[:, 0].max():.2f}, y {co[:, 1].min():.2f}..{co[:, 1].max():.2f}")

    kept, dropped = vehicle_textured.prepare_vehicle_textures()
    for name, b, a in kept:
        log(f"shipping {name!r} at {a[0]}x{a[1]} (was {b[0]}x{b[1]})")

    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
    log(f"wrote {BLEND_PATH} ({os.path.getsize(BLEND_PATH)} bytes)")

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    kwargs = vehicle_textured.gltf_kwargs(
        OUT_PATH,
        "Lavi Ambush Tank (mbt_lavi_camo) -- the shipped mbt_lavi.glb (AI-generated, Meshy, "
        "disclosed per CONTRIBUTING.md) with a Blender-authored camouflage net, scrim garnish and "
        "foliage tufts joined into its own four nodes; ships the Lavi's own base_color bake",
    )
    kwargs["export_image_format"] = "AUTO"
    bpy.ops.export_scene.gltf(**kwargs)
    log(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)")
    return OUT_PATH


if __name__ == "__main__":
    export()
