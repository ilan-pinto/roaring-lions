"""Export the Meshy-generated Sarim loitering munition as a rigid glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/vehicles/export_meshy_loiter_drone.py

Writes `art/meshes/vehicles/loiter_drone.glb` -- WP-A3.1 (GH-179) batch B2
(`docs/art/meshy-prompts-units.md` §7). Palette-painted: zero materials, roles
from the vehicle six, colour from `VEHICLE_ROLE_PALETTE['loiter_drone']`.

SOURCE: art/meshy/loiter-drone-20260930-01a0f2af/model.glb -- Meshy text-to-3d
preview 01a0f2ac-f4ba-76b2-b111-f2e797ce49d4, REMESH
01a0f2af-af1e-7008-8287-3bd290e63791 at 800 tris: one object, 1,566 verts /
776 tris, no material. AI-generated (Meshy), disclosed per CONTRIBUTING.md.

WHAT THE PREVIEW DID AND DID NOT HONOUR, so the reader is not surprised by the
shape. Asked for: a swept delta wing, slim fuselage, blunt seeker nose, a
two-blade PUSHER prop at the tail, a small vertical fin at each wingtip.
Delivered: the delta wing and slim fuselage; a five-blade TRACTOR prop on the
nose; ONE tall fin on the tail rather than two at the tips; and a tricycle
landing gear nobody asked for. The wing is what the silhouette gate reads
(`attack_drone` is a finned cylinder, `recon_drone` a quadcopter) and the
bible's rule is "a wrong preview is fixed in Blender, a re-roll is a new
spend", so:

  - the landing gear is CUT: every face whose centroid sits below
    `GEAR_CUT_Z` (source frame), which is the belly line -- measured, the
    fuselage/wing body occupies z in [-0.10, +0.07] with the gear legs and
    wheels hanging to -0.22, and the band between -0.12 and -0.10 is nearly
    empty;
  - the prop stays where it is. A munition with a nose prop is not a
    munition anyone will mistake for another unit on this roster, which is
    the whole job of the shape; moving 60 faces to the tail would be
    modelling, not a fix;
  - the single fin stays. It is a vertical read at 26 px, which is what the
    wingtip fins were for.

ORIENTATION. Measured by binning (prop disc at x ~ -0.6, fin at x ~ +0.55)
and by an ortho render with a marker cube: the nose points -X in the source,
so the model takes one 180-degree Z rotation to put it on +X.

SIZE. The blend the sprite was rendered from measures 1.62 m span x 1.40 m
long; the sprite manifest's `realMetres` is the span. Bible §7 q10's default
bakes the `SIZE_CLASS["air"]` x1.5 into the GLB, because a vehicle mesh is
scaled by `MESH_SCALE` alone: the shipped span is **2.43 m** and the real
span (1.62 m) is recorded in the provenance line. The remesh's own span/length
ratio is kept (uniform scale on the span).

ROLES (source frame, model units, after the gear cut):

  metal   the propeller and its spinner: x < PROP_X (the disc is the only
          thing forward of the nose cone), plus the warhead nose cone itself
          (x < NOSE_X)
  glass   the seeker: nothing to isolate on this remesh -- the nose is one
          cone -- so no glass mesh is emitted. The render tables carry a
          `glass` row for the day a re-export has one.
  plate   the tail fin: z > FIN_Z0 and x > FIN_X0 (the only thing that tall
          that far aft)
  hull    the wing and fuselage, everything else

No pivot (matching B0a's two drones); the wreck is procedural
(`WRECK_RECIPES['loiter_drone'] = { hull: 'air' }`, `pnpm wreck:meshes`).
"""
import glob
import math
import os
import sys

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit as vehicle_kit  # noqa: E402
from export_mesh_vehicle import _bake_scale  # noqa: E402

REPO = os.path.dirname(TOOLS)
UNIT_ID = "loiter_drone"
SRC_GLOB = os.path.join(REPO, "art", "meshy", "loiter-drone-*-01a0f2af", "model.glb")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, f"{UNIT_ID}.glb")

REAL_SPAN_M = 1.62
AIR_CLASS_MULTIPLIER = 1.5          # dimetric.SIZE_CLASS["air"], baked -- bible §7 q10
SHIPPED_SPAN_M = REAL_SPAN_M * AIR_CLASS_MULTIPLIER

# --- source frame constants (forward -X), see docstring ---
GEAR_CUT_Z = -0.105
PROP_X = -0.585
NOSE_X = -0.50
FIN_X0, FIN_Z0 = 0.45, 0.05
SHIPPED_CAP_TRIS = 1000


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
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.clear()
    ob.name = "src"
    return ob


def _centroids(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    cent = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float32)
    bm.free()
    return cent


def _role(c):
    x, y, z = c
    if x < PROP_X or x < NOSE_X:
        return "metal"
    if x > FIN_X0 and z > FIN_Z0:
        return "plate"
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


def export():
    src = _load()
    cent = _centroids(src)
    total = len(cent)
    gear = {i for i, c in enumerate(cent) if c[2] < GEAR_CUT_Z}
    print(f"[{UNIT_ID}] source {total} tris; cutting {len(gear)} landing-gear faces below z={GEAR_CUT_Z}")
    roles = {}
    for i, c in enumerate(cent):
        if i in gear:
            continue
        roles.setdefault(_role(c), set()).add(i)
    for role in ("hull", "metal", "plate"):
        n = len(roles.get(role, ()))
        if n == 0:
            raise SystemExit(f"[{UNIT_ID}] role {role!r} came out EMPTY -- re-measure the cut")
        print(f"[{UNIT_ID}] role {role}: {n} faces")

    pieces = []
    for role, idx in roles.items():
        piece = _duplicate(src, f"hull_{role}")
        _keep_only(piece, idx)
        for k in list(piece.keys()):
            if k != "_RNA_UI":
                del piece[k]
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES")
        piece["rl_role"] = role
        piece["rl_part"] = "hull"
        pieces.append(piece)
    bpy.data.objects.remove(src, do_unlink=True)

    # Uniform scale on the SPAN (y extent), then 180 about Z (nose -X -> +X),
    # then the lowest vertex to z=0 -- the same order the truck exporter uses.
    ys = [v.co.y for ob in pieces for v in ob.data.vertices]
    span = max(ys) - min(ys)
    mpu = SHIPPED_SPAN_M / span
    print(f"[{UNIT_ID}] span {span:.4f} model units -> {SHIPPED_SPAN_M:.3f} m shipped "
          f"({REAL_SPAN_M} m real x {AIR_CLASS_MULTIPLIER}); {mpu:.5f} m/unit")
    _bake_scale(pieces, mpu)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in pieces:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, math.pi)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zmin = min(v.co.z for ob in pieces for v in ob.data.vertices)
    for ob in pieces:
        ob.location.z = -zmin
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    lo = [min(v.co[i] for ob in pieces for v in ob.data.vertices) for i in range(3)]
    hi = [max(v.co[i] for ob in pieces for v in ob.data.vertices) for i in range(3)]
    tris = sum(len(ob.data.polygons) for ob in pieces)
    print(f"[{UNIT_ID}] final bounds (m): x {lo[0]:.3f}..{hi[0]:.3f}  y {lo[1]:.3f}..{hi[1]:.3f}  "
          f"z {lo[2]:.3f}..{hi[2]:.3f}; {tris} tris (cap {SHIPPED_CAP_TRIS})")
    if tris > SHIPPED_CAP_TRIS:
        raise SystemExit(f"[{UNIT_ID}] {tris} tris over the {SHIPPED_CAP_TRIS} cap -- trim before shipping")

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=(
            "Sarim loitering munition -- AI-generated (Meshy text-to-3d, remeshed; "
            "task 01a0f2ac-f4ba-76b2-b111-f2e797ce49d4), disclosed per CONTRIBUTING.md; "
            "palette-painted at runtime, real span 1.62 m shipped at x1.5"
        ),
    )
    print(f"[{UNIT_ID}] wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)")
    return OUT_PATH


if __name__ == "__main__":
    export()
