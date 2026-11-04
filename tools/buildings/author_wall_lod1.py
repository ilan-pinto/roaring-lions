"""Author `wall_lod1`: the lower-detail twin of the Compound Wall (GH-974).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_wall_lod1.py

Writes art/src/buildings/wall_lod1.blend and art/meshes/buildings/wall_lod1.glb.

Why. `wall.glb` is a Meshy remesh of 3,087 triangles (nodes `roof` 77 + `wall`
3,010). A per-tile run draws it once per tile, and walls were about 2.3 ms of the
Rujm redo's centre frame. Below zoom 2.0 none of its stone relief is visible, so
this twin keeps what IS visible at zoom 1 and 1.6 -- the outline -- and drops the
rest. It is a deliberate simplification to a measured triangle budget (about 300,
hard ceiling 350), not a reduction of the standing art: the full wall stays.

How. Nothing here is a decimate. The twin is built from numbers MEASURED off
`wall.glb` and made of planar quads:

  1. the outline: ray-cast the full wall's SURFACE (not its vertices: a flat top
     has no vertex under most of its length) along its run. It is a flat 1.40 m
     top, 3.00 m long, 0.60 m thick, and the tool refuses to run if that stops
     being true (then the twin needs a profile, not a box);
  2. a `roof` coping cap (COPING m, 0.03 m chamfer) and a `wall` body;
  3. the one piece of relief that still reads at zoom 1.6: shallow masonry
     COURSES (grooves) and a running-bond of vertical JOINTS, both sides.
     Every groove is a real recess in planar quads, 20 mm deep.

What it drops: the stone-by-stone modelling, the protruding quoins at the tile
ends, every bevel below 20 mm.

Colour (GH-974, lead ruling, option (a)). The twin has ZERO materials but ships a
UV0 that samples the FULL wall's Meshy bake, so at runtime its geometry takes the
full template's own material: +0 materials, +0 textures. The full wall's atlas is
~600 small islands with black gaps between them, so a continuous mapping would smear
across islands; each face instead takes ONE texel, chosen by projection:

  - sample a 5 x 5 grid over the face, ray-cast each point along the face normal onto
    the full wall's surface (BVH), read the hit triangle's UV and the bake's texel;
  - pick the sample whose texel is closest to the mean of the face's samples (a medoid,
    so a crack or a dark pit never becomes the face's colour);
  - set all the face's loops to that UV (a constant UV: the shader's normal-map frame
    degenerates to the geometric normal, which is right for a flat twin).

Roles are the full wall's: `roof` and `wall`, zero materials, real metres, forward
+X (the run direction, as `wall.glb`). Hand-rolled determinism: no noise at all.
"""
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
SRC_FULL = os.path.join(REPO, "art", "meshes", "buildings", "wall.glb")
# Spelled out so tools/src/mesh_ownership.test.ts can read what this writes.
OUT_GLB = os.path.join(REPO, "art", "meshes", "buildings", "wall_lod1.glb")
OUT_BLEND = os.path.join(REPO, "art", "src", "buildings", "wall_lod1.blend")

HALF = 1.5            # half a tile along the run, m
SLAB = 1.0 / 32.0     # top-line sampling width, m
COPING = 0.12         # the `roof` cap, m (replaces nothing: the full wall's coping reads ~0.11-0.13)
CHAMFER = 0.03
COURSES = 6           # masonry courses in the body
GROOVE_H = 0.03       # a course line, m
GROOVE_D = 0.02       # how deep, m
JOINT_W = 0.03
JOINTS_EVEN = (-0.75, 0.75)   # running bond: alternate courses
JOINTS_ODD = (0.0,)
RAYS_Y = 7
TRI_CEILING = 350
CREDIT = ("Compound wall LOD1 (GH-974) -- built in Blender from code "
          "(tools/buildings/author_wall_lod1.py), derived from art/meshes/buildings/wall.glb, "
          "project original")


def bake_pixels():
    """The full wall's base-colour bake as a (h, w, 3) float list-of-rows array."""
    import numpy as np
    img = bpy.data.images.get("base_color")
    if img is None:
        img = next((i for i in bpy.data.images if i.size[0] > 0 and "base" in i.name.lower()), None)
    if img is None:
        raise SystemExit("wall_lod1: the full wall's base_color image did not import")
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[:, :, :3].copy()


class BakeSampler:
    """Reads the full wall's bake by projection. Built before the scene is wiped,
    so it holds its own copies: a BVH of the surface, per-triangle UVs, the texels."""

    GRID = 5
    DARK = 0.05          # a texel darker than this is an island gap, never a face's colour

    def __init__(self, tree, tri_uv, pixels):
        self.tree, self.tri_uv, self.px = tree, tri_uv, pixels

    def texel(self, uv):
        h, w, _ = self.px.shape
        x = min(w - 1, max(0, int(uv[0] * w)))
        y = min(h - 1, max(0, int(uv[1] * h)))   # Blender's image origin is bottom-left, as UV space
        return self.px[y, x]

    def hit_uv(self, origin, direction):
        hit = self.tree.ray_cast(origin, direction, 0.3)
        if hit[0] is None:
            return None
        return self.uv_at(hit[0], hit[2])

    def nearest_uv(self, point):
        hit = self.tree.find_nearest(point)
        return None if hit[0] is None else self.uv_at(hit[0], hit[2])

    def uv_at(self, p, index):
        pos, uvs = self.tri_uv[index]
        v0, v1, v2 = pos[1] - pos[0], pos[2] - pos[0], p - pos[0]
        d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
        d20, d21 = v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01
        if abs(den) < 1e-18:
            return Vector(uvs[0])
        b1 = (d11 * d20 - d01 * d21) / den
        b2 = (d00 * d21 - d01 * d20) / den
        return uvs[0] * (1.0 - b1 - b2) + uvs[1] * b1 + uvs[2] * b2

    def face_uv(self, corners, normal):
        """(uv, colour) for one planar quad/tri, or None if nothing of it lies over the full wall."""
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
                    uv = self.nearest_uv(p)      # an end cap or a joint flank: no surface straight under it
                if uv is None:
                    continue
                col = self.texel(uv)
                if float(col.max()) < self.DARK:
                    continue
                samples.append((uv, col))
        if not samples:
            return None
        mean = np.mean([s[1] for s in samples], axis=0)
        best = min(samples, key=lambda s: float(((s[1] - mean) ** 2).sum()))
        return best[0], best[1]


def measure_full():
    """Top line, half thickness and bounds of the full wall, from its GLB."""
    kit.new_scene()
    bpy.ops.import_scene.gltf(filepath=SRC_FULL)
    pts = []
    for o in bpy.data.objects:
        if o.type == "MESH":
            pts += [o.matrix_world @ v.co for v in o.data.vertices]
    # Ray-cast the SURFACE, not the vertices: a flat top face has no vertex
    # under most of its length, so a vertex census reads it as a notch.
    from mathutils.bvhtree import BVHTree
    deps = bpy.context.evaluated_depsgraph_get()
    tris, verts, tri_uv = [], [], []
    for o in bpy.data.objects:
        if o.type == "MESH":
            base = len(verts)
            verts += [o.matrix_world @ v.co for v in o.data.vertices]
            uv = o.data.uv_layers.active.data
            for poly in o.data.polygons:
                vs = [base + i for i in poly.vertices]
                ls = list(poly.loop_indices)
                for i in range(1, len(vs) - 1):
                    tris.append((vs[0], vs[i], vs[i + 1]))
                    tri_uv.append(tuple(Vector(uv[ls[k]].uv) for k in (0, i, i + 1)))
    tree = BVHTree.FromPolygons(verts, tris)
    tri_pos = [tuple(verts[i].copy() for i in t) for t in tris]
    tri_uv = [(tp, tu) for tp, tu in zip(tri_pos, tri_uv)]
    n = int(round(2 * HALF / SLAB))
    top = [0.0] * n
    ys = [-0.27 + 0.54 * k / (RAYS_Y - 1) for k in range(RAYS_Y)]
    for i in range(n):
        for sub in (0.2, 0.5, 0.8):
            x = -HALF + (i + sub) * SLAB
            for y in ys:
                hit = tree.ray_cast(Vector((x, y, 4.0)), Vector((0, 0, -1)))
                if hit[0] is not None:
                    top[i] = max(top[i], hit[0].z)
    half_t = max(max(p.y for p in pts), -min(p.y for p in pts))
    return top, half_t, pts, BakeSampler(tree, tri_uv, bake_pixels())


def solid_spans(slots, lo=-HALF, hi=HALF):
    """The x intervals of a band that are NOT slot, given slot centres."""
    out, x = [], lo
    for c in sorted(slots):
        out.append((x, c - JOINT_W / 2.0))
        x = c + JOINT_W / 2.0
    out.append((x, hi))
    return out


def build(top_h, t):
    """Quads for the two roles. Normals are fixed up against the wanted
    direction, so winding is never hand-ordered."""
    wall, roof = [], []

    def quad(into, pts, want):
        a, b, c = (Vector(p) for p in pts[:3])
        n = (b - a).cross(c - b)
        into.append(list(pts) if n.dot(Vector(want)) > 0 else list(pts)[::-1])

    hc = top_h - COPING                   # body top / coping bottom
    pitch = hc / COURSES
    # band edges: body [0, hc] cut by COURSES-1 grooves of height GROOVE_H
    cuts = [k * pitch for k in range(1, COURSES)]
    bands = []
    lo = 0.0
    for z in cuts:
        bands.append((lo, z - GROOVE_H / 2.0))
        lo = z + GROOVE_H / 2.0
    bands.append((lo, hc))
    slots_of = [JOINTS_EVEN if i % 2 == 0 else JOINTS_ODD for i in range(len(bands))]
    d = GROOVE_D

    for s in (-1.0, 1.0):
        face = (0.0, s, 0.0)
        for i, (z0, z1) in enumerate(bands):
            top_open = i < len(bands) - 1       # a groove sits above this band
            bot_open = i > 0                    # and one below
            sl = slots_of[i]
            for xa, xb in solid_spans(sl):
                quad(wall, [(xa, s * t, z0), (xb, s * t, z0), (xb, s * t, z1), (xa, s * t, z1)], face)
            for c in sl:
                quad(wall, [(c - JOINT_W / 2, s * (t - d), z0), (c + JOINT_W / 2, s * (t - d), z0),
                            (c + JOINT_W / 2, s * (t - d), z1), (c - JOINT_W / 2, s * (t - d), z1)], face)
                for x, nx in ((c - JOINT_W / 2, 1.0), (c + JOINT_W / 2, -1.0)):
                    quad(wall, [(x, s * (t - d), z0), (x, s * t, z0), (x, s * t, z1), (x, s * (t - d), z1)], (nx, 0, 0))
            # the lip below a groove faces up, the one above faces down; both are the
            # band's own surface minus its joint slots
            if top_open:
                for xa, xb in solid_spans(sl):
                    quad(wall, [(xa, s * (t - d), z1), (xb, s * (t - d), z1), (xb, s * t, z1), (xa, s * t, z1)], (0, 0, 1))
            if bot_open:
                for xa, xb in solid_spans(sl):
                    quad(wall, [(xa, s * (t - d), z0), (xb, s * (t - d), z0), (xb, s * t, z0), (xa, s * t, z0)], (0, 0, -1))
            # the groove's own back wall, once, under each cut
            if top_open:
                za, zb = z1, bands[i + 1][0]
                quad(wall, [(-HALF, s * (t - d), za), (HALF, s * (t - d), za), (HALF, s * (t - d), zb), (-HALF, s * (t - d), zb)], face)
        # coping: a straight face, a 45 degree chamfer, the flat top
        quad(roof, [(-HALF, s * t, hc), (HALF, s * t, hc), (HALF, s * t, top_h - CHAMFER), (-HALF, s * t, top_h - CHAMFER)], face)
        quad(roof, [(-HALF, s * t, top_h - CHAMFER), (HALF, s * t, top_h - CHAMFER),
                    (HALF, s * (t - CHAMFER), top_h), (-HALF, s * (t - CHAMFER), top_h)], (0, s, 1.0))
    quad(roof, [(-HALF, -(t - CHAMFER), top_h), (HALF, -(t - CHAMFER), top_h), (HALF, t - CHAMFER, top_h), (-HALF, t - CHAMFER, top_h)], (0, 0, 1))
    # the underside of the coping where it meets the grooved body is hidden; the
    # two tile ends seal every groove and joint: one body rectangle, one cap.
    for x, nx in ((-HALF, -1.0), (HALF, 1.0)):
        quad(wall, [(x, -t, 0.0), (x, t, 0.0), (x, t, hc), (x, -t, hc)], (nx, 0, 0))
        quad(roof, [(x, -t, hc), (x, t, hc), (x, t, top_h - CHAMFER), (x, -t, top_h - CHAMFER)], (nx, 0, 0))
        quad(roof, [(x, -t, top_h - CHAMFER), (x, t, top_h - CHAMFER), (x, t - CHAMFER, top_h), (x, -(t - CHAMFER), top_h)], (nx, 0, 0))
    return wall, roof


def project_uvs(parts, sampler):
    """UV0 on every loop of every part: one projected texel per face (see the module docstring)."""
    import numpy as np
    area_sum, col_sum, missing, faces = 0.0, np.zeros(3), 0, 0
    for ob in parts:
        me = ob.data
        layer = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            corners = [me.vertices[i].co.copy() for i in poly.vertices]
            res = sampler.face_uv(corners, poly.normal.copy())
            faces += 1
            if res is None:
                missing += 1
                continue
            uv, col = res
            for li in poly.loop_indices:
                layer.data[li].uv = (uv[0], uv[1])
            area_sum += poly.area
            col_sum += np.asarray(col, dtype=float) * poly.area
    if missing:
        raise SystemExit(f"wall_lod1: {missing} of {faces} faces found no full-wall surface to project from")
    # for the log: the area-weighted mean texel the twin will draw
    mean = col_sum / area_sum
    print(f"[wall_lod1] uv: {faces} faces, mean projected texel (linear) {mean.round(4).tolist()}")


def tri_count(quads):
    return sum(len(q) - 2 for q in quads)


def main():
    top, t, full_pts, sampler = measure_full()
    if max(top) - min(top) > 0.03 or abs(max(top) - 1.40) > 0.02:
        raise SystemExit(f"wall_lod1: the full wall's top line is not flat any more "
                         f"({min(top):.3f}..{max(top):.3f}); this twin is a box with courses, give it a profile")
    top_h = sum(top) / len(top)
    if abs(t - 0.30) > 0.02:
        raise SystemExit(f"wall_lod1: thickness {t:.3f} is not 0.30 half")
    wall_q, roof_q = build(top_h, 0.30)
    total = tri_count(wall_q) + tri_count(roof_q)
    if total > TRI_CEILING:
        raise SystemExit(f"wall_lod1: {total} triangles over the ceiling {TRI_CEILING}")

    kit.new_scene()
    parts = []
    for role, quads in (("roof", roof_q), ("wall", wall_q)):
        verts, faces = [], []
        for q in quads:
            base = len(verts)
            verts += q
            faces.append(tuple(range(base, base + len(q))))
        ob = kit._mesh(role, verts, faces, role)
        ob.data.materials.clear()
        parts.append(ob)
    # Merge the shared corners; a flat-shaded export splits them again by normal.
    for ob in parts:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=1e-5)
        bpy.ops.object.mode_set(mode="OBJECT")
    project_uvs(parts, sampler)
    pts = [o.matrix_world @ v.co for o in parts for v in o.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    if lo.z < -1e-4 or lo.x < -HALF - 1e-4 or hi.x > HALF + 1e-4:
        raise SystemExit(f"wall_lod1 leaves its tile or the ground: {lo} {hi}")

    kit.save(OUT_BLEND)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB, export_format="GLB", use_selection=False, export_apply=True,
        export_yup=True, export_skins=False, export_animations=False, export_extras=True,
        export_materials="NONE", export_copyright=CREDIT,
    )
    fl = [min(p[i] for p in full_pts) for i in range(3)], [max(p[i] for p in full_pts) for i in range(3)]
    print(f"[wall_lod1] {tri_count(wall_q)} wall + {tri_count(roof_q)} roof = {total} tris; "
          f"x[{lo.x:+.3f},{hi.x:+.3f}] y[{lo.y:+.3f},{hi.y:+.3f}] z[{lo.z:+.3f},{hi.z:+.3f}] "
          f"(full wall x{fl[0][0]:+.3f}..{fl[1][0]:+.3f} z..{fl[1][2]:+.3f}); "
          f"{os.path.getsize(OUT_GLB)} bytes")


if __name__ == "__main__":
    main()
