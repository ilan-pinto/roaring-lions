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
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in hand["verts"]]
    faces = []
    for (a, b, c) in hand["tris"]:
        try:
            f = bm.faces.new((vs[a], vs[b], vs[c]))
        except ValueError:
            continue
        faces.append(f)
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            lp[uvl].uv = uv if uv else (0.5, 0.5)
    for f in bm.faces:
        f.smooth = True
    # a hard edge at a fold of 50 degrees or more (the cuff rim, the pad's ends)
    import math
    lim = math.cos(math.radians(85.0))
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.link_faces[0].normal.dot(e.link_faces[1].normal) > lim
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
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
