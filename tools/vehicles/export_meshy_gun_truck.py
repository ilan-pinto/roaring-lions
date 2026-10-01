"""Export the Meshy-generated AA gun truck as a hull+turret glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/vehicles/export_meshy_gun_truck.py

Writes `art/meshes/vehicles/gun_truck.glb` -- WP-A3.1 (GH-179) batch B2, the
first unit of the programme to go preview -> refine -> remesh through
`pnpm meshy` end to end (`docs/art/meshy-prompts-units.md` §6).

SOURCE (one welded file, unlike `export_meshy_truck.py`'s two):

  art/meshy/gun-truck-20260930-01a0f2ac/model.glb
      Meshy text-to-3d preview 01a0f2a6-bc37-7461-9b4f-4919d0ff1606, refine
      01a0f2a8-35a9-701b-b1a0-ccdeca412e1b (2k bake), REMESH
      01a0f2ac-4384-735a-b5e1-0350426f017c at 5,000 tris. One object
      `output_unwrapped`, 9,547 verts / 4,857 tris, ONE material
      (`BakedMaterial`: base colour 2048, normal 2048, metallic-roughness 4096).

AI-generated (Meshy), disclosed per CONTRIBUTING.md. Prompt and task ids are in
`art/meshy/ledger.jsonl` and `docs/ASSET_PROVENANCE.md`.

**Measured on the day, and worth recording because the style bible left it
open: a Meshy remesh of a REFINED task keeps its bake.** The remesh arrived
already textured, so the fallback the numbers table named (Blender-decimate
the refined preview) was never needed and the unit stays at 35 credits.

ORIENTATION. Measured, not assumed, by rendering the remesh with a marker cube
at (+X, +Z) and by binning face centroids: the bonnet sits at NEGATIVE x and
the bed with the pedestal at positive x, so the source's nose points -X and the
whole model takes one 180-degree Z rotation, exactly as the technical did.

THE CUT. The source is one shell, so hull and turret are separated by face
centroid against constants measured on THIS remesh (source frame, model units,
forward -X), printed by the probe that produced them:

  bed floor        dense band z in [-0.20, -0.16]           -> BED_FLOOR_Z -0.17
  base plate       z in [-0.16, -0.04], x 0.15..0.62, |y| < 0.25 (bolted down:
                   HULL, role metal -- a base plate does not traverse)
  pedestal column  z in [-0.04, 0.20], x 0.16..0.44, |y| < 0.13
  cradle           z in [0.20, 0.30], |y| up to 0.22 (trunnion arms)
  gun body/barrels z in [0.28, 0.44], x 0.10..0.59, |y| < 0.14; the barrel
                   tips reach forward over the cab roof to x ~ 0.0
  cab roof         z up to 0.30 at x in [-0.29, +0.15]; the barrels' undersides
                   over it start at z 0.36 -- OVER_CAB_Z 0.305 sits in the gap
  cab rear wall    x ~ 0.10..0.17 -- TURRET_X0 0.17 keeps it on the hull
  bed side walls   top z ~ 0.02..0.05, |y| > 0.3
  wheels           discs about (x -0.65, z -0.34) and (x +0.49, z -0.34),
                   |y| in [0.34, 0.49], tyre bottom z -0.453, arch line -0.25

THE ELEVATION. The bible's lever for this unit against `technical` is the twin
gun raised at ~28 degrees. The preview honoured the pedestal and the twin
barrels but not the angle: the barrel axis measured 7.6 degrees (PCA of the
top band of the refined mesh). The bible's own rule -- "a wrong preview is
fixed in Blender, a re-roll is a new spend" -- is applied here: the GUN subset
of the turret (cradle and above, `GUN_Z0`) is rotated `ELEVATE_DEG` about a
Y-parallel trunnion line through the cradle's own centroid, so the muzzle
rises and the breech dips about the mount, and the pedestal stays put. Only
the turret's own faces move; no new geometry, no re-roll.

ROLES, from the vehicle six (`tools/vehicles/kit.py`):

  turret_metal   the pedestal, cradle and gun -- the whole mount, as the
                 technical's pintle is
  hull_rubber    the four tyres, by axle-disc fit as `export_meshy_truck.py`
  hull_glass     cab glazing, by the bake's own luminance inside the cab box:
                 the cab box measures bimodal (0.00-0.20 glass 0.37 of its
                 area, 0.45-0.60 body 0.43 of it, next to nothing between), so
                 `GLASS_LUM_MAX` 0.25 sits in the floor between the peaks
  hull_metal     the pedestal base plate and the front bumper
  hull_hull      everything else

`hull_plate` is deliberately absent: the Sarim vehicle line asks for welded
plates and the preview drew none, and inventing a plate region on a bake that
does not show one would paint a lie into the wreck charring.

TEXTURE. Ships the remesh's own bake through `tools/vehicles/textured.py`
(2048 ceiling, JPEG base colour). That module looks for an image whose name
starts `base_color`; Meshy's remesh names it `texture_0`, so it is renamed
here before the call and nothing else about that module changes.

The `turret_pivot` is the horizontal centroid of the turret mesh's own lowest
layer -- the pedestal foot -- measured after the cut (so the base plate, which
stays on the hull, cannot pull it), then scaled, rotated and ground-shifted
with everything else. Never copied from the sprite's `turret_axis`.

The wreck is procedural: `pnpm wreck:meshes -- --id=gun_truck` after this,
with `WRECK_RECIPES['gun_truck'] = { hull: 'wheeled', turretPivot: 'turret_pivot' }`.
"""
import glob
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402
from export_mesh_vehicle import _bake_scale  # noqa: E402
import textured as vehicle_textured  # noqa: E402

REPO = os.path.dirname(TOOLS)
UNIT_ID = "gun_truck"
#: The remesh task's download folder (see module docstring). Globbed by task
#: prefix so the date in the folder name is not a second place it lives.
SRC_GLOB = os.path.join(REPO, "art", "meshy", "gun-truck-*-01a0f2ac", "model.glb")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, f"{UNIT_ID}.glb")

#: `docs/art/meshy-prompts-units.md` §6: 5.4 m, the bible's worked example.
#: Applied to the model's longest axis (nose to tailgate).
REAL_METRES = 5.4

# --- cut constants, source frame (forward -X), model units -- see docstring ---
BED_FLOOR_Z = -0.17
TURRET_X0, TURRET_X1 = 0.17, 0.66
TURRET_Z0 = -0.04            # pedestal foot; the base plate below stays on the hull
TURRET_HALF_W_LOW = 0.16     # pedestal column
TURRET_HALF_W_HIGH = 0.23    # cradle arms and gun body
CRADLE_Z = 0.20              # where the pedestal ends and the cradle begins
OVER_CAB_X0 = -0.10          # barrel tips forward of the cab rear wall
OVER_CAB_Z = 0.305           # cab roof <= 0.30, barrel undersides >= 0.36
GUN_Z0 = 0.205               # the elevating subset: cradle and above
ELEVATE_DEG = 20.0           # 7.6 measured + 20 = ~28, the bible's number

PLATE_X0, PLATE_X1, PLATE_Z0, PLATE_Z1, PLATE_HALF_W = 0.15, 0.66, -0.155, -0.04, 0.25
BUMPER_X, BUMPER_Z = -0.86, -0.12

AXLES = ((-0.65, -0.34), (0.49, -0.34))
WHEEL_R = 0.125
WHEEL_AY = 0.33

CAB_X0, CAB_X1, CAB_Z0, CAB_Z1 = -0.45, 0.17, 0.02, 0.30
GLASS_LUM_MAX = 0.25

HULL_ROLES = ("hull", "metal", "rubber", "glass")
TURRET_ROLE = "metal"

BASE_COLOR_SRC_IMAGE = "texture_0"


def _src():
    hits = sorted(glob.glob(SRC_GLOB))
    if len(hits) != 1:
        raise SystemExit(f"expected exactly one source at {SRC_GLOB}, found {hits}")
    return hits[0]


def _load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=_src())
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"expected one mesh object, found {[o.name for o in meshes]}")
    ob = meshes[0]
    # The importer leaves the Y-up -> Z-up conversion on the object; bake it so
    # every measurement below is in world space.
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.name = "src"
    return ob


def _extent_of(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float32)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    return float((co.max(axis=0) - co.min(axis=0)).max())


def _face_data(ob):
    """(centroids, areas) per polygon, object frame."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    cent = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float32)
    area = np.array([f.calc_area() for f in bm.faces], dtype=np.float32)
    bm.free()
    return cent, area


def _face_luminance(ob):
    """Linear luminance of the bake at each face's UV centroid."""
    me = ob.data
    img = bpy.data.images[BASE_COLOR_SRC_IMAGE]
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    lum = 0.2126 * px[:, :, 0] + 0.7152 * px[:, :, 1] + 0.0722 * px[:, :, 2]
    del px
    nl = len(me.loops)
    uv = np.empty(nl * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    lt = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_total", lt)
    if lt.min() != 3 or lt.max() != 3:
        raise SystemExit(f"[{UNIT_ID}] source is not pure triangles")
    uvc = uv.reshape(-1, 3, 2).mean(axis=1)
    xs = np.clip((uvc[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(np.int32)
    ys = np.clip((uvc[:, 1] % 1.0) * (h - 1), 0, h - 1).astype(np.int32)
    return lum[ys, xs]


def _is_turret(c):
    x, y, z = c
    half_w = TURRET_HALF_W_HIGH if z > CRADLE_Z else TURRET_HALF_W_LOW
    if abs(y) >= half_w or x >= TURRET_X1:
        return False
    if x > TURRET_X0 and z > TURRET_Z0:
        return True
    return z > OVER_CAB_Z and x > OVER_CAB_X0


def _hull_role(c, lum):
    x, y, z = c
    for ax, az in AXLES:
        if abs(y) >= WHEEL_AY and (x - ax) ** 2 + (z - az) ** 2 <= WHEEL_R ** 2:
            return "rubber"
    if PLATE_X0 <= x <= PLATE_X1 and PLATE_Z0 <= z <= PLATE_Z1 and abs(y) < PLATE_HALF_W:
        return "metal"
    if x < BUMPER_X and z < BUMPER_Z:
        return "metal"
    if CAB_X0 <= x <= CAB_X1 and CAB_Z0 <= z <= CAB_Z1 and lum < GLASS_LUM_MAX:
        return "glass"
    return "hull"


def _keep_only(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep_idx], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _duplicate(ob, name):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.duplicate()
    piece = bpy.context.object
    piece.name = name
    piece.data.name = name
    return piece


def _elevate_gun(turret_obj):
    """Rotate the cradle-and-above faces of the turret about a Y-parallel
    trunnion through the cradle's centroid. Vertices are moved directly
    (a vertex belongs to the gun if every face it touches is a gun face;
    a vertex shared with the pedestal stays, so the seam stretches rather
    than tears -- a few long triangles at the trunnion, invisible under the
    cradle)."""
    me = turret_obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    gun_faces = [f for f in bm.faces if f.calc_center_median().z > GUN_Z0]
    if not gun_faces:
        raise SystemExit(f"[{UNIT_ID}] no gun faces above GUN_Z0 -- re-measure the cut")
    cradle = [f.calc_center_median() for f in bm.faces if GUN_Z0 < f.calc_center_median().z < 0.30]
    px = sum(c.x for c in cradle) / len(cradle)
    pz = sum(c.z for c in cradle) / len(cradle)
    print(f"[{UNIT_ID}] trunnion (source frame) x={px:.4f} z={pz:.4f} from {len(cradle)} cradle faces; "
          f"elevating {len(gun_faces)} gun faces by {ELEVATE_DEG} deg")
    gun_face_set = set(f.index for f in gun_faces)
    moving = [v for v in bm.verts if v.link_faces and all(f.index in gun_face_set for f in v.link_faces)]
    rot = Matrix.Rotation(math.radians(ELEVATE_DEG), 4, "Y")
    pivot = Vector((px, 0.0, pz))
    for v in moving:
        v.co = rot @ (v.co - pivot) + pivot
    bm.to_mesh(me)
    bm.free()
    return (px, pz)


def _turret_pivot_local(ob, eps=0.05):
    zmin = min(v.co.z for v in ob.data.vertices)
    layer = [v.co for v in ob.data.vertices if v.co.z <= zmin + eps]
    return (sum(p.x for p in layer) / len(layer), sum(p.y for p in layer) / len(layer), zmin)


def _rotate_180z(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, math.pi)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def export():
    src = _load()
    extent = _extent_of(src)
    mpu = metres_per_unit(extent, REAL_METRES)
    print(f"[{UNIT_ID}] extent {extent:.4f} model units -> {REAL_METRES} m ({mpu:.5f} m/unit)")

    cent, area = _face_data(src)
    lum = _face_luminance(src)
    turret_idx = {i for i, c in enumerate(cent) if _is_turret(c)}
    roles = {}
    for i, c in enumerate(cent):
        if i in turret_idx:
            continue
        roles.setdefault(_hull_role(c, float(lum[i])), set()).add(i)
    total = len(cent)
    print(f"[{UNIT_ID}] turret: {len(turret_idx)} faces ({100.0 * len(turret_idx) / total:.1f}%)")
    for role in HULL_ROLES:
        n = len(roles.get(role, ()))
        if n == 0:
            raise SystemExit(f"[{UNIT_ID}] hull role {role!r} came out EMPTY -- re-measure the cut")
        print(f"[{UNIT_ID}] hull role {role}: {n} faces ({100.0 * n / total:.1f}%)")

    pieces = []
    for role in HULL_ROLES:
        piece = _duplicate(src, f"hull_{role}")
        _keep_only(piece, roles[role])
        pieces.append((piece, role, "hull"))
    turret = _duplicate(src, f"turret_{TURRET_ROLE}")
    _keep_only(turret, turret_idx)
    pieces.append((turret, TURRET_ROLE, "turret"))
    bpy.data.objects.remove(src, do_unlink=True)

    _elevate_gun(turret)
    pivot_local = _turret_pivot_local(turret)
    print(f"[{UNIT_ID}] turret pivot (source frame): {tuple(round(c, 4) for c in pivot_local)}")

    for ob, role, part in pieces:
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES")
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = part

    objs = [ob for ob, _r, _p in pieces]
    _bake_scale(objs, mpu)
    _rotate_180z(objs)
    pivot = (-pivot_local[0] * mpu, -pivot_local[1] * mpu, pivot_local[2] * mpu)

    zmin = min(min(v.co.z for v in ob.data.vertices) for ob in objs)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.location.z = -zmin
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    pivot = (pivot[0], pivot[1], pivot[2] - zmin)
    print(f"[{UNIT_ID}] ground shift +{-zmin:.4f} m; turret_pivot at {tuple(round(c, 4) for c in pivot)} m")

    pivot_obj = bpy.data.objects.new("turret_pivot", None)
    pivot_obj.empty_display_size = 0.15
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot
    turret.parent = pivot_obj
    turret.matrix_parent_inverse = Matrix.Translation(Vector(pivot) * -1.0)

    # Bounds, for the numbers the provenance line records.
    lo = np.array([min(v.co[i] for ob in objs for v in ob.data.vertices) for i in range(3)])
    hi = np.array([max(v.co[i] for ob in objs for v in ob.data.vertices) for i in range(3)])
    print(f"[{UNIT_ID}] final bounds (m): x {lo[0]:.3f}..{hi[0]:.3f}  y {lo[1]:.3f}..{hi[1]:.3f}  z {lo[2]:.3f}..{hi[2]:.3f}")

    # `textured.py` keys the shipped bake on the `base_color` prefix; Meshy's
    # remesh names it `texture_0`.
    bpy.data.images[BASE_COLOR_SRC_IMAGE].name = "base_color"
    kept, dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{UNIT_ID}] shipping {name!r} at {after[0]}x{after[1]} (was {before[0]}x{before[1]})")
    for name, size in dropped:
        print(f"[{UNIT_ID}] dropped {name!r} ({size[0]}x{size[1]})")

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        **vehicle_textured.gltf_kwargs(
            OUT_PATH,
            "AA gun truck -- AI-generated (Meshy text-to-3d, refined, remeshed; "
            "task 01a0f2ac-4384-735a-b5e1-0350426f017c), disclosed per "
            "CONTRIBUTING.md; ships the remesh's own base_color bake",
        )
    )
    tris = sum(len(ob.data.polygons) for ob in objs)
    print(f"[{UNIT_ID}] wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), {tris} tris")
    return OUT_PATH


if __name__ == "__main__":
    export()
