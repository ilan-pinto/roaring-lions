"""Shared pieces of the LOD1 twin authors (GH-974): the ditch and the house.

`author_wall_lod1.py` is the pattern: a twin is built FROM NUMBERS measured off the full mesh, as planar quads, and
carries ZERO materials but a UV0 that samples the FULL mesh's Meshy bake, so at runtime its geometry takes the full
template's own material (+0 materials, +0 textures). Each face takes ONE texel of the bake, chosen by projection:

  - sample a 5 x 5 grid over the face, ray-cast each point along the face normal onto the full mesh (BVH), read the
    hit triangle's UV and the bake's texel; a point with no surface straight under it falls back to the nearest one;
  - take the sample whose texel is closest to the mean of the face's samples (a medoid, so a crack or a dark pit
    never becomes the face's colour);
  - set all the face's loops to that UV (a constant UV: a flat twin has no use for the shader's normal-map frame).

Faces are therefore also the colour cells: a wall is cut into cells (CELL m) so that the twin keeps the full mesh's
low-frequency mottling, not one flat colour. Nothing here is random or noisy: no mathutils.noise, no decimate.
"""
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit  # noqa: E402
from author_wall_lod1 import BakeSampler, bake_pixels  # noqa: E402


class FaceSampler(BakeSampler):
    """BakeSampler whose face_uv never gives up on a dark face (a shutter, a glass pane)."""

    def face_uv(self, corners, normal):
        import numpy as np
        a, b, c = corners[0], corners[1], corners[2]
        d = corners[3] if len(corners) > 3 else corners[2] + (corners[0] - corners[1])
        g = self.GRID
        samples = []
        for i in range(g):
            for j in range(g):
                u, v = 0.15 + 0.7 * i / (g - 1), 0.15 + 0.7 * j / (g - 1)
                p = (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + c * u) * v
                uv = self.hit_uv(p + normal * 0.1, -normal)
                if uv is None:
                    uv = self.nearest_uv(p)
                if uv is None:
                    continue
                samples.append((uv, self.texel(uv)))
        if not samples:
            return None
        light = [s for s in samples if float(s[1].max()) >= self.DARK]
        pool = light if light else samples      # an island gap is skipped, but a truly dark face keeps its colour
        mean = np.mean([s[1] for s in pool], axis=0)
        best = min(pool, key=lambda s: float(((s[1] - mean) ** 2).sum()))
        return best[0], best[1]


def import_full(glb):
    """Import the full mesh. Returns (sampler, bvh, pts, tri_count, role_tris): world-space points of every vertex."""
    kit.new_scene()
    bpy.ops.import_scene.gltf(filepath=glb)
    verts, tris, tri_uv, pts, role_tris = [], [], [], [], {}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in o.data.vertices]
        uv = o.data.uv_layers.active.data
        for poly in o.data.polygons:
            vs = [base + i for i in poly.vertices]
            ls = list(poly.loop_indices)
            for i in range(1, len(vs) - 1):
                tris.append((vs[0], vs[i], vs[i + 1]))
                tri_uv.append(tuple(Vector(uv[ls[k]].uv) for k in (0, i, i + 1)))
                role_tris[o.name] = role_tris.get(o.name, 0) + 1
    pts = list(verts)
    tree = BVHTree.FromPolygons(verts, tris)
    tri_pos = [tuple(verts[i].copy() for i in t) for t in tris]
    sampler = FaceSampler(tree, list(zip(tri_pos, tri_uv)), bake_pixels())
    return sampler, tree, pts, len(tris), role_tris


class Quads:
    """Quads (or triangles) per role, wound so the normal points where it is told to."""

    def __init__(self):
        self.by_role = {}

    def add(self, role, pts, want):
        p = [Vector(q) for q in pts]
        n = (p[1] - p[0]).cross(p[2] - p[1])
        if n.length < 1e-12 and len(p) > 3:
            n = (p[2] - p[0]).cross(p[3] - p[0])
        if n.dot(Vector(want)) < 0:
            p = p[::-1]
        self.by_role.setdefault(role, []).append([tuple(q) for q in p])

    def tri_count(self):
        return sum(len(q) - 2 for qs in self.by_role.values() for q in qs)


def project_uvs(parts, sampler):
    import numpy as np
    area, col_sum, faces, miss = 0.0, np.zeros(3), 0, 0
    for ob in parts:
        me = ob.data
        layer = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            corners = [me.vertices[i].co.copy() for i in poly.vertices]
            res = sampler.face_uv(corners, poly.normal.copy())
            faces += 1
            if res is None:
                miss += 1
                continue
            uv, col = res
            for li in poly.loop_indices:
                layer.data[li].uv = (uv[0], uv[1])
            area += poly.area
            col_sum += np.asarray(col, dtype=float) * poly.area
    if miss:
        raise SystemExit(f"{miss} of {faces} faces found no surface of the full mesh to project from")
    print(f"[uv] {faces} faces, mean projected texel (linear) {(col_sum / area).round(4).tolist()}")


def smooth_normals(ob, angle_deg=35.0):
    """Custom split normals: average the face normals that meet at one position within `angle_deg` of each other."""
    me = ob.data
    me.update()
    cosv = math.cos(math.radians(angle_deg))
    at = {}
    key = lambda v: (round(v.x, 5), round(v.y, 5), round(v.z, 5))  # noqa: E731
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            at.setdefault(key(me.vertices[vi].co), []).append((poly.normal.copy(), poly.area))
    out = []
    for poly in me.polygons:
        for vi in poly.vertices:
            n0 = poly.normal
            acc = Vector((0, 0, 0))
            for n, a in at[key(me.vertices[vi].co)]:
                if n.dot(n0) >= cosv:
                    acc += n * a
            out.append(acc.normalized() if acc.length > 1e-12 else n0)
    me.normals_split_custom_set(out)


def build_and_export(quads, sampler, out_blend, out_glb, credit, smooth_roles=(), node_props=None):
    """Fresh scene, one object per role (named and tagged for the role), UVs, .blend, .glb. Returns the objects."""
    kit.new_scene()
    parts = []
    for role in sorted(quads.by_role):
        verts, faces = [], []
        for q in quads.by_role[role]:
            base = len(verts)
            verts += q
            faces.append(tuple(range(base, base + len(q))))
        if node_props is None:
            ob = kit._mesh(role, verts, faces, role)
        else:       # a node that carries its own extras and NO rl_role (the textured ditch decor)
            me = bpy.data.meshes.new(role)
            me.from_pydata(verts, [], faces)
            me.validate()
            me.update()
            ob = bpy.data.objects.new(role, me)
            for k, v in node_props[role].items():
                ob[k] = v
            bpy.context.collection.objects.link(ob)
        ob.data.materials.clear()
        parts.append(ob)
    project_uvs(parts, sampler)
    for ob in parts:
        if ob.name in smooth_roles:
            smooth_normals(ob)
    kit.save(out_blend)
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_glb, export_format="GLB", use_selection=False, export_apply=True,
        export_yup=True, export_skins=False, export_animations=False, export_extras=True,
        export_materials="NONE", export_copyright=credit,
    )
    return parts


def bounds(pts):
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi
