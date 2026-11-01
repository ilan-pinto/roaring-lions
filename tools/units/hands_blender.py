"""Blender adapters for `hands.py`: a hand dict becomes a mesh object (smooth, one material per group
colour for review, or one flat glove colour). Blender only."""
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hands as H  # noqa: E402


def to_object(hand, name, material=None, uv=None, collection=None):
    """A hand dict as a mesh object: only the vertices its triangles use, the generator's own smooth normals
    as custom normals (a 5-sided tube shades like the round finger it stands for)."""
    tris = np.asarray(hand["tris"])
    used = sorted(set(int(i) for i in tris.ravel()))
    remap = {v: k for k, v in enumerate(used)}
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(hand["verts"][v]) for v in used]
    for (a, b, c) in tris:
        try:
            bm.faces.new((vs[remap[int(a)]], vs[remap[int(b)]], vs[remap[int(c)]]))
        except ValueError:
            continue
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.smooth = True
        for lp in f.loops:
            lp[uvl].uv = uv if uv else (0.5, 0.5)
    bm.to_mesh(me)
    bm.free()
    if "normals" in hand:
        nrm = np.asarray(hand["normals"])[used]
        me.normals_split_custom_set_from_vertices([tuple(n) for n in nrm])
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    if material is not None:
        me.materials.append(material)
    ob["rl_role"] = "uniform"
    return ob


def proxy_object(proxy, name, length=0.12, x0=-0.06, material=None):
    """A cylinder or box extruded along x for debug renders."""
    bm = bmesh.new()
    if proxy.kind == "circle":
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=48, radius1=proxy.r, radius2=proxy.r, depth=length)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(np.pi / 2, 3, "Y"), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(x0 + length / 2, proxy.cy, proxy.cz), verts=bm.verts)
    else:
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= length
            v.co.y *= (proxy.y1 - proxy.y0)
            v.co.z *= (proxy.z1 - proxy.z0)
            v.co.x += x0 + length / 2
            v.co.y += proxy.cy
            v.co.z += proxy.cz
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material is not None:
        me.materials.append(material)
    return ob
