"""How the Yahalom Engineers' base gear sits on the man who wears it: the READING behind `tools/test_yahalom_gear_standoff.py`
(GH-826 unit "Yahalom", round 2; the Opus review of 17 Nov 2026, section 6: "nothing measures pack-to-back standoff";
"the only strap row counts samples INSIDE the trunk. A strap 5 cm off the shoulder passes").

    blender -b --factory-startup -P tools/yahalom_gear_standoff.py -- <yahalom_squad.glb> <out.json>

Reads a team GLB off its BYTES: nothing of `tools/units/yahalom_gear.py` is imported and no size of it is used. A man's
gear is every `webbing` vertex his spine bone owns; it is split into its connected islands, and the islands are told
apart by where they are at rest:
  * the BAG is the island with the largest box;
    (vertices at one place are one vertex: the exporter splits them at hard edges)
  * a SHOULDER STRAP is an island that reaches more than 0.10 m ahead of the bag's body-side face (over the shoulder);
  * the DETECTOR is every other island whose middle stands more than 8 mm outside the bag's width;
  * the PACK is the rest (the bag, its lid, pocket, back pad, webbing and buckles).
Per man, in the rest pose and in every living clip (five instants; the worst kept):
  * `pack`: the gap between the pack's body-side face and the man's trunk, SIGNED (negative: the pack is in him), by
    thirds of the bag's height (top / middle / bottom). A ray per 30 x 20 mm cell of the bag's face, from behind the pack
    forward, carried with the spine bone; the gap is from the last pack surface the ray leaves to the first trunk surface
    it meets (the `uniform` triangles of his spine, pelvis, neck, head, hips and thighs). A cell whose ray meets no trunk
    is a MISS, counted. Per third: cells, misses, median, minimum, maximum;
  * `plate`: the same rays against the trunk AND the kit's carrier and yoke (`kit_uniform`, by the graft's tags): how many
    cells read the pack's face INSIDE the plate (negative), and the least gap;
  * `bag_plate`: the pack WITHOUT its back pad (the pad is the pack's island, not the bag, that reaches furthest toward the
    man) against the carrier and yoke alone: cells whose bag face is inside the plate, and the least gap;
  * `strap`: the shoulder straps' body-side vertices (their normal points at the body) at and above the collar line (the
    shoulder joints less 40 mm): the distance to the nearest point of `uniform`: median, 90th percentile, maximum. Unsigned
    (a strap sunk in the collar reads small: `launcher_clearance.test.ts`, `YAHALOM_GEAR`, counts those);
  * `strap_kit`: how many of the straps' OUTER vertices lie under the kit's carrier, yoke or throat guard (a ray from the
    vertex away from the body meets the kit within 80 mm), and how deep the deepest lies;
  * `detector_foot`: the lowest 0.20 m of the detector: its distance to the nearest point of `uniform` (minimum, median, maximum);
  * `gas_detector` (the kit's, `kit_weapon` by the graft's tags; the lead's ruling of 17 Nov 2026 moved it to the left
    carrier strap, where the support arm comes into it in the aimed clips): how many triangle pairs of the detector and of
    the man's own ARMS cross (`uniform` triangles his upper arms, forearms and hands own), and how many arm triangles are
    in them. A crossing count, as `inf_kit_pierce.py`'s: it asks nothing of a closed shell (the detector's back lies 6 mm
    in the bare chest by design, on the carrier it is worn on, and `uniform` alone is open where the gun was cut out of it).
Instants: the first, the quarters and the last frame of each clip (five); the worst is kept.
This tool only reads; the limits live in the test. No mathutils.noise.
"""
import json
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
CLIPS = ("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "work")
TRUNK = ("spine", "pelvis", "neck", "head", "hip_L", "hip_R", "thigh_L", "thigh_R")
KIT_OVER_BACK = ("carrier", "yoke")
KIT_OVER_STRAP = ("carrier", "yoke", "throat")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
U, W = bpy.data.objects["uniform"], bpy.data.objects["webbing"]
KU = bpy.data.objects.get("kit_uniform")
KW = bpy.data.objects.get("kit_weapon")


def posed(ob, normals=False):
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = e.to_mesh()
    co = np.array([ob.matrix_world @ v.co for v in me.vertices])
    nr = np.array([(ob.matrix_world.to_3x3() @ v.normal) for v in me.vertices]) if normals else None
    e.to_mesh_clear()
    return (co, nr) if normals else co


def dominant(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    return [names[max(v.groups, key=lambda g: g.weight).group] if v.groups else "" for v in ob.data.vertices]


def islands(ob, keep, co):
    """Connected islands of `ob` among the vertices `keep` (a bool per vertex): a list of vertex-index arrays. Vertices at
    one place (to 0.1 mm of `co`) are one: the exporter splits a vertex at every hard edge and texel seam."""
    parent = list(range(len(ob.data.vertices)))
    at = {}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for v in range(len(parent)):
        if keep[v]:
            key = tuple(int(round(float(c) * 1e4)) for c in co[v])
            if key in at:
                parent[find(v)] = find(at[key])
            else:
                at[key] = v
    for p in ob.data.polygons:
        vs = [v for v in p.vertices if keep[v]]
        for a, b in zip(vs[:-1], vs[1:]):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
    groups = {}
    for v in range(len(parent)):
        if keep[v]:
            groups.setdefault(find(v), []).append(v)
    return [np.array(g) for g in groups.values()]


def set_clip(name, frame):
    if name is None:
        rig.data.pose_position = "REST"
    else:
        rig.data.pose_position = "POSE"
        act = bpy.data.actions[name]
        rig.animation_data_create()
        rig.animation_data.action = act
        try:
            rig.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
        bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def bvh(co, polys):
    return BVHTree.FromPolygons([Vector(p) for p in co], polys)


def last_exit(tree, o, d, reach):
    """The distance at which a ray from `o` along `d` LAST leaves `tree` within `reach` (None: it never meets it)."""
    t, last, start = 0.0, None, Vector(o)
    for _ in range(64):
        hit = tree.ray_cast(start, d, reach - t)
        if hit[0] is None:
            break
        t += hit[3]
        last = t
        t += 1e-4
        start = Vector(o) + Vector(d) * t
    return last


wd, ud = dominant(W), dominant(U)
figures = sorted({n[: -len("_spine")] for n in wd if n.endswith("_spine")})
w_polys = [tuple(p.vertices) for p in W.data.polygons]
u_polys = [tuple(p.vertices) for p in U.data.polygons]
kit_tag = None
if KU is not None:
    parts = [dict(p) for p in KU["rl_kit"]["parts"]]
    att = KU.data.attributes["_RL_KIT"]
    kv = [d.value for d in att.data]
    k_polys = [tuple(p.vertices) for p in KU.data.polygons]
    kit_tag = (parts, kv, k_polys)


def kit_polys(fig, names):
    if kit_tag is None:
        return []
    parts, kv, k_polys = kit_tag
    ids = {i for i, p in enumerate(parts) if p["figure"] == fig and p["part"] in names}
    return [t for t in k_polys if all(kv[i] in ids for i in t)]


gas = {}
if KW is not None:
    _parts = [dict(p) for p in KW["rl_kit"]["parts"]]
    _kv = [d.value for d in KW.data.attributes["_RL_KIT"].data]
    for _i, _p in enumerate(_parts):
        if _p["part"] == "gas_detector":
            gas[_p["figure"]] = [tuple(p.vertices) for p in KW.data.polygons if all(_kv[i] == _i for i in p.vertices)]
ARM = ("upperarm", "forearm", "hand")


def stats(v):
    v = np.sort(np.asarray(v, float))
    return dict(n=int(len(v)), median=round(float(np.median(v)), 4), p90=round(float(v[int(0.9 * (len(v) - 1))]), 4), min=round(float(v[0]), 4), max=round(float(v[-1]), 4))


res = {}
set_clip(None, 0)
w_rest, w_rest_n = posed(W, normals=True)
u_rest = posed(U)
setup = {}
for fig in figures:
    keep = [d == f"{fig}_spine" for d in wd]
    isl = islands(W, keep, w_rest)
    box = lambda g: (w_rest[g].min(0), w_rest[g].max(0))  # noqa: E731
    vol = [float(np.prod(np.maximum(box(g)[1] - box(g)[0], 1e-4))) for g in isl]
    bag = isl[int(np.argmax(vol))]
    lo, hi = box(bag)
    centre = 0.5 * (lo + hi)
    spine = np.array(rig.matrix_world @ rig.data.bones[f"{fig}_spine"].head_local)
    f = spine - centre; f[2] = 0.0
    f = f / np.linalg.norm(f)                          # forward: from the bag to the spine's line, level
    lat = np.array([-f[1], f[0], 0.0])
    fwd = lambda P: (np.asarray(P) - centre) @ f      # noqa: E731
    lt = lambda P: (np.asarray(P) - centre) @ lat     # noqa: E731
    bag_f = (float(fwd(w_rest[bag]).min()), float(fwd(w_rest[bag]).max()))
    bag_l = (float(lt(w_rest[bag]).min()), float(lt(w_rest[bag]).max()))
    straps, det, pack = [], [], []
    for g in isl:
        if g is bag:
            pack.append(g)
        elif float(fwd(w_rest[g]).max()) > bag_f[1] + 0.10:
            straps.append(g)
        elif not (bag_l[0] - 0.008 <= float(0.5 * (lt(w_rest[g]).min() + lt(w_rest[g]).max())) <= bag_l[1] + 0.008):
            det.append(g)
        else:
            pack.append(g)
    # the BACK PAD: the pack's island, not the bag, that reaches furthest toward the man (it lies between the bag and his back)
    others = [g for g in pack if g is not bag]
    pad = max(others, key=lambda g: float(fwd(w_rest[g]).max())) if others else None
    if pad is not None and float(fwd(w_rest[pad]).max()) <= bag_f[1] + 0.002:
        pad = None
    pack_v = np.concatenate(pack)
    strap_v = np.concatenate(straps) if straps else np.array([], int)
    det_v = np.concatenate(det) if det else np.array([], int)
    in_pack = np.zeros(len(wd), bool); in_pack[pack_v] = True
    pack_polys = [t for t in w_polys if all(in_pack[i] for i in t)]
    in_pad = np.zeros(len(wd), bool)
    if pad is not None:
        in_pad[pad] = True
    shell_polys = [t for t in pack_polys if not all(in_pad[i] for i in t)]
    # the ray grid: 30 mm across, 20 mm up the bag, 25 mm inside its sides, from 0.10 m behind the pack
    rear = float(fwd(w_rest[pack_v]).min()) - 0.10
    cells = []
    for z in np.arange(lo[2] + 0.01, hi[2], 0.02):
        for y in np.arange(bag_l[0] + 0.025, bag_l[1] - 0.0249, 0.03):
            o = centre + f * rear + lat * y
            o[2] = z
            third = min(2, int(3 * (z - lo[2]) / (hi[2] - lo[2])))
            cells.append((o, ("bottom", "middle", "top")[third]))
    z_collar = max(float((rig.matrix_world @ rig.data.bones[f"{fig}_upperarm_{s}"].head_local).z) for s in "LR") - 0.040
    trunk = {f"{fig}_{b}" for b in TRUNK}
    trunk_polys = [t for t in u_polys if all(ud[i] in trunk for i in t)]
    arm_polys = [t for t in u_polys if all(ud[i].startswith(fig + "_") and ud[i][len(fig) + 1:].split("_")[0] in ARM for i in t)]
    setup[fig] = dict(f=f, cells=cells, pack_polys=pack_polys, shell_polys=shell_polys, trunk_polys=trunk_polys, strap_v=strap_v, det_v=det_v, z_collar=z_collar,
                      arm_polys=arm_polys, back_polys=kit_polys(fig, KIT_OVER_BACK), over_strap_polys=kit_polys(fig, KIT_OVER_STRAP),
                      foot=det_v[w_rest[det_v][:, 2] <= w_rest[det_v][:, 2].min() + 0.20] if len(det_v) else det_v)
    res[fig] = dict(islands=dict(all=len(isl), pack=len(pack), straps=len(straps), detector=len(det), pad=0 if pad is None else 1),
                    vertices=dict(pack=int(len(pack_v)), straps=int(len(strap_v)), detector=int(len(det_v)), pad=0 if pad is None else int(len(pad))),
                    bag_box_m=[round(float(v), 4) for v in (hi - lo)], cells=len(cells), trunk_triangles=len(trunk_polys),
                    kit_back_triangles=len(setup[fig]["back_polys"]), clips={})


def read(fig, state):
    s = setup[fig]
    wco, wn = posed(W, normals=True)
    uco = posed(U)
    kco = posed(KU) if KU is not None else None
    pb = rig.pose.bones[f"{fig}_spine"]
    if rig.data.pose_position == "REST":
        M = np.eye(4)
    else:
        M = np.array(rig.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted() @ rig.matrix_world.inverted())
    R = M[:3, :3]
    d = Vector(R @ s["f"])
    pack_t = bvh(wco, s["pack_polys"])
    trunk_t = bvh(uco, s["trunk_polys"])
    body_t = bvh(uco, u_polys)
    plate_t = bvh(kco, s["back_polys"]) if s["back_polys"] else None
    shell_t = bvh(wco, s["shell_polys"])
    by = {"top": [], "middle": [], "bottom": []}
    miss = {"top": 0, "middle": 0, "bottom": 0}
    plate, shell = [], []
    for o, third in s["cells"]:
        o_ = Vector(M[:3, :3] @ o + M[:3, 3])
        tg = last_exit(pack_t, o_, d, 0.60)
        if tg is None:
            continue                                  # no pack in this cell (a rounded corner): not a cell of the face
        hit = trunk_t.ray_cast(o_, d, 0.80)
        if hit[0] is None:
            miss[third] += 1
        else:
            by[third].append(hit[3] - tg)
        if plate_t is not None:
            hp = plate_t.ray_cast(o_, d, 0.80)
            both = min([h[3] for h in (hit, hp) if h[0] is not None], default=None)
            if both is not None:
                plate.append(both - tg)
            ts = last_exit(shell_t, o_, d, 0.60)
            if hp[0] is not None and ts is not None:
                shell.append(hp[3] - ts)
    out = dict(pack={k: dict(stats(v), misses=miss[k]) if len(v) else dict(n=0, misses=miss[k]) for k, v in by.items()})
    if plate_t is not None:
        out["plate"] = dict(n=len(plate), inside=int(sum(1 for v in plate if v < 0)), min=round(float(min(plate)), 4) if plate else None)
        # ...and the pack WITHOUT its back pad (the bag, lid and pocket) against the plate alone: the pad follows the bare
        # back and stands in the plate bag by design; the bag's own face may not
        out["bag_plate"] = dict(n=len(shell), inside=int(sum(1 for v in shell if v < 0)), min=round(float(min(shell)), 4) if shell else None)
    sv = s["strap_v"]
    if len(sv):
        near = [body_t.find_nearest(Vector(wco[v])) for v in sv]
        toward = np.array([float(np.dot(wn[v], np.array(n[0]) - wco[v])) > 0.0 for v, n in zip(sv, near)])
        dist = np.array([n[3] for n in near])
        crest = np.array([w_rest[v][2] >= s["z_collar"] for v in sv])
        if (toward & crest).sum() >= 1:
            out["strap"] = stats(dist[toward & crest])
        out["strap_all"] = stats(dist[toward]) if toward.sum() else dict(n=0)
        if s["over_strap_polys"]:
            kt = bvh(kco, s["over_strap_polys"])
            deep = []
            for v, n, t_ in zip(sv, near, toward):
                if t_:
                    continue
                away = Vector(wco[v]) - n[0]
                if away.length < 1e-6:
                    continue
                h = kt.ray_cast(Vector(wco[v]), away.normalized(), 0.08)
                if h[0] is not None:
                    deep.append(h[3])
            out["strap_kit"] = dict(n=int((~toward).sum()), under=len(deep), deepest=round(float(max(deep)), 4) if deep else 0.0)
    if len(s["foot"]):
        out["detector_foot"] = stats([body_t.find_nearest(Vector(wco[v]))[3] for v in s["foot"]])
    if fig in gas:
        gco = posed(KW)
        pairs = bvh(gco, gas[fig]).overlap(bvh(uco, s["arm_polys"]))
        out["gas_detector"] = dict(n=len(gas[fig]), arm_pairs=len(pairs), arm_triangles=len({b_ for _a, b_ in pairs}))
    return out


def worst(rows):
    """The instants of a clip into one row: the largest of each median / p90 / max / count inside, the least of each min."""
    out = json.loads(json.dumps(rows[0]))

    def fold(a, b):
        for k, v in b.items():
            if isinstance(v, dict):
                fold(a.setdefault(k, {}), v)
            elif v is None or k == "n":
                a.setdefault(k, v)
            elif k == "min":
                a[k] = v if a.get(k) is None else min(a[k], v)
            else:
                a[k] = v if a.get(k) is None else max(a[k], v)
    for r in rows[1:]:
        fold(out, r)
    return out


for fig in figures:
    set_clip(None, 0)
    res[fig]["rest"] = read(fig, None)
for clip in CLIPS:
    if clip not in bpy.data.actions:
        continue
    act = bpy.data.actions[clip]
    lo_, hi_ = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
    frames = sorted({lo_, (3 * lo_ + hi_) // 4, (lo_ + hi_) // 2, (lo_ + 3 * hi_) // 4, hi_})
    rows = {fig: [] for fig in figures}
    for fr in frames:
        set_clip(clip, fr)
        for fig in figures:
            rows[fig].append(read(fig, clip))
    for fig in figures:
        res[fig]["clips"][clip] = dict(worst(rows[fig]), instants=len(frames))

with open(OUT, "w") as fh:
    json.dump(res, fh, indent=1, sort_keys=True)
print(json.dumps(res))
