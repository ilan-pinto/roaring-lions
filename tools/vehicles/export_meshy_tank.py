"""Export the Meshy-generated tank as a hull+turret glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_tank.py

Writes `art/meshes/vehicles/mbt_lavi.glb`.

SOURCE: art/blend/tank/Meshy_AI_A_3D_low_poly_futuris_0829201559_texture.blend
-- AI-generated (Meshy), single mesh object `mesh_node`, 3,906 verts, one
material with three packed 2048^2 textures. Disclosed per CONTRIBUTING.md;
see this task's report (`.superpowers/f-meshy-tank-report.md`) for the full
licensing note.

Why this is its own script rather than a new `VehicleMeshSpec` entry in
`tools/export_mesh_vehicle.py`. That module's split is a name-PREFIX match
(`turret_prefixes`) against objects a kit author already tagged with
`rl_role` -- `tools/vehicles/kit.py` builds every part as a separate Blender
object with a role already set. This source has NEITHER: hull and turret
share one welded mesh (a connected-component pass found 3,814 of 3,906 verts
in a single component) and there is exactly one material, so no per-part
name or role exists to split on. The cut here is geometric -- face selection
by position, not name -- which is a different enough operation that forcing
it through the prefix-matching code path would have obscured both.

The cut. Bounding-volume, not topological -- there is no modeled seam
between hull and turret to cut along, because this is an AI mesh, not a
kit-built one. A face belongs to the turret if:

  - its centroid sits at or above Z_CUT (0.055 model units) -- the turret
    box, roof hatches, and (near the mantlet, where the barrel's top surface
    already pokes above the hull roof height) part of the barrel; or
  - its centroid falls inside BARREL_BAND -- a narrow box out along the gun
    axis, at barrel height, picking up the rest of the barrel the Z_CUT
    alone misses.

Both thresholds were measured, not guessed: a connected-component pass located
the one welded hull+turret+barrel component and the four small disconnected
greebles (two antenna stubs, already watertight, folded into the turret
automatically since they sit above Z_CUT; two hull-mounted details that stay
with the hull); a per-slice z-histogram of vertex x/y spread located the
"waist" where the hull roof's footprint suddenly narrows into the turret
base, at z=~0.055-0.065; and a direct query of near-y=0, far-x vertices
found the barrel spanning x=[-0.953,-0.44] at z=[0.0,0.065], y=[-0.09,0.09].

Whether this SHIPS the turret separated is a judgement call made after
rendering the result, not before -- see the report for the boundary-loop
trace that found the naive combined selection has FOUR disjoint face islands
whose boundaries interleave (Blender's own `holes_fill` returns zero faces
on that combined edge set), while the Z_CUT-only selection is a single
closed 86-edge loop. Filling each island's boundary loop SEPARATELY with
`triangle_fill`, rather than handing every loop to one `holes_fill` call,
is what turns a bottomless turret and a gaping hull hole into a capped
result -- rendered and checked at 8 yaw angles in the report, no case
showing background through the seam.

FORWARD REORIENTATION. This source's gun and antennas point -X, opposite
the mesh contract's +X-forward convention (verified with coloured axis
markers, not assumed -- see the report). Baked as a final 180-degree Z
rotation on the already-cut, already-scaled geometry, not before -- every
cut threshold above is measured in the SOURCE's own coordinate frame, and
flipping first would have required renegotiating every one of them for no
benefit, since a Z-axis rotation cannot change which vertices are "above"
Z_CUT or inside the barrel band.
"""
import json
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale  # noqa: E402 -- shared bake-scale-into-verts helper

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(REPO, "art", "blend", "tank", "Meshy_AI_A_3D_low_poly_futuris_0829201559_texture.blend")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "mbt_lavi.glb")

#: mbt_lavi's own declared real-world size -- read from the sprite sheet it
#: currently ships with (TNK_HULL), the only place this unit's size is
#: written down (data/units/kdf/mbt_lavi.json carries no metres field). Per
#: coordinator direction: this is mbt_lavi's own number, not a picked one.
TNK_HULL_MANIFEST = os.path.join(REPO, "assets", "sprites", "TNK_HULL", "manifest.json")

#: The role every mesh in this export gets. A single-material source has no
#: basis to split `hull`/`plate`/`rubber`/`metal`/`glass`/`recess` from --
#: see the module docstring and the report's "roles" section.
ROLE = "hull"

#: Height (model units) above which a face is unconditionally turret --
#: measured from a per-slice z-histogram of the source mesh; see the module
#: docstring.
Z_CUT = 0.055

#: The barrel band: a box around the gun's own axis (y~=0) picking up the
#: part of the barrel Z_CUT alone would leave attached to the hull. Measured
#: by direct query of near-y=0, far-x vertices (module docstring).
BARREL_X_MAX = -0.44
BARREL_Y = 0.09
BARREL_Z_MIN = -0.02
BARREL_Z_MAX = 0.08

#: Above this many boundary-loop edges, a "cap" is not a small fix -- see
#: the report for why this asset stays below it (largest loop: 85 edges).
MAX_SANE_LOOP = 400


def _is_turret_face(f):
    c = f.calc_center_median()
    if c.z >= Z_CUT:
        return True
    if c.x <= BARREL_X_MAX and abs(c.y) <= BARREL_Y and BARREL_Z_MIN <= c.z <= BARREL_Z_MAX:
        return True
    return False


def _delete_faces(ob, keep_fn, invert=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    to_delete = []
    for f in bm.faces:
        keep = keep_fn(f)
        if invert:
            keep = not keep
        if not keep:
            to_delete.append(f)
    bmesh.ops.delete(bm, geom=to_delete, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _trace_boundary_loops(bm):
    """Every closed boundary-edge loop in `bm`, as lists of edges. Refuses
    (returns the loop anyway but flags open=False) a loop that never returns
    to its own start vertex -- `_fill_holes` skips those rather than feeding
    a non-loop to `triangle_fill`, which is exactly the failure mode a
    combined multi-loop `holes_fill` call hit during development (see the
    module docstring and report)."""
    boundary = set(e for e in bm.edges if len(e.link_faces) == 1)
    vadj = defaultdict(list)
    for e in boundary:
        v0, v1 = e.verts
        vadj[v0].append((v1, e))
        vadj[v1].append((v0, e))
    unvisited = set(boundary)
    loops = []
    while unvisited:
        e0 = next(iter(unvisited))
        unvisited.discard(e0)
        v0, v1 = e0.verts
        cur = v1
        loop_edges = [e0]
        closed = False
        while True:
            nxts = [(v, e) for (v, e) in vadj[cur] if e in unvisited]
            if not nxts:
                break
            v, e = nxts[0]
            unvisited.discard(e)
            loop_edges.append(e)
            cur = v
            if cur == v0:
                closed = True
                break
        loops.append((loop_edges, closed))
    return loops


def _fill_holes(ob, label):
    """Cap every closed boundary loop, one `triangle_fill` call per loop --
    NOT one call across the whole boundary edge set, which silently returns
    zero faces on this mesh's multi-island boundary (see module docstring).
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    loops = _trace_boundary_loops(bm)
    print(f"[{label}] {len(loops)} boundary loop(s), lengths={[len(e) for e, _ in loops]}")
    for loop_edges, closed in loops:
        if not closed or len(loop_edges) < 3:
            print(f"[{label}]   skip loop len={len(loop_edges)} closed={closed}")
            continue
        if len(loop_edges) > MAX_SANE_LOOP:
            raise SystemExit(
                f"[{label}] boundary loop of {len(loop_edges)} edges exceeds MAX_SANE_LOOP "
                f"({MAX_SANE_LOOP}) -- this is not a small cap fix, stop and re-examine the cut"
            )
        bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=loop_edges)
    remaining = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    ob.data.update()
    bm.free()
    if remaining:
        print(f"[{label}] WARNING: {remaining} boundary edge(s) remain open after fill")
    return remaining


def _extent_of(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    m = eo.to_mesh()
    xs, ys, zs = [], [], []
    for v in m.vertices:
        wc = eo.matrix_world @ v.co
        xs.append(wc.x)
        ys.append(wc.y)
        zs.append(wc.z)
    eo.to_mesh_clear()
    return max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def _read_real_metres():
    with open(TNK_HULL_MANIFEST) as fh:
        manifest = json.load(fh)
    return manifest["realMetres"]


def _turret_pivot(turret_obj):
    """Horizontal centre of the turret's own footprint, excluding the barrel
    (which would drag a bbox-centre far off-axis) and the two antenna
    stubs (which sit far to the rear-top and do the same, from the other
    direction). Both exclusions were necessary in practice -- an earlier
    pass that used the single lowest vertex layer picked the barrel
    underside (the mesh's actual lowest point after the cut), not the
    turret ring; see the report.
    """
    bm = bmesh.new()
    bm.from_mesh(turret_obj.data)
    pts = [v.co.copy() for v in bm.verts]
    bm.free()
    core = [
        p for p in pts
        if not (p.x <= BARREL_X_MAX and abs(p.y) <= BARREL_Y)  # not barrel
        and p.x <= 0.5  # not the rear antenna stubs
    ]
    if not core:
        raise SystemExit("turret pivot: no core (non-barrel, non-antenna) vertices found")
    xs = [p.x for p in core]
    ys = [p.y for p in core]
    zs = [p.z for p in core]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    cz = min(zs)
    return (cx, cy, cz)


def export():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    src_obj = bpy.data.objects["mesh_node"]
    if src_obj.modifiers:
        raise SystemExit(f"mesh_node carries {len(src_obj.modifiers)} modifier(s) -- apply before cutting")

    extent_model = _extent_of(src_obj)
    real_metres = _read_real_metres()
    mpu = metres_per_unit(extent_model, real_metres)
    print(
        f"[mbt_lavi] extent {extent_model:.4f} model units -> {real_metres:.3f} m declared "
        f"({mpu:.5f} m/unit, real_metres from {TNK_HULL_MANIFEST})"
    )

    # Duplicate into two objects, then cut each down to its half.
    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    turret_obj = bpy.context.object
    turret_obj.name = "turret_cut"
    hull_obj = src_obj
    hull_obj.name = "hull_cut"

    _delete_faces(turret_obj, _is_turret_face, invert=False)
    _delete_faces(hull_obj, _is_turret_face, invert=True)
    print(f"[mbt_lavi] pre-fill hull faces={len(hull_obj.data.polygons)} turret faces={len(turret_obj.data.polygons)}")

    _fill_holes(turret_obj, "turret")
    _fill_holes(hull_obj, "hull")
    print(f"[mbt_lavi] post-fill hull faces={len(hull_obj.data.polygons)} turret faces={len(turret_obj.data.polygons)}")

    # Pivot, in the SOURCE (pre-rotation) coordinate frame -- rotated below
    # alongside the geometry itself.
    pivot_local = _turret_pivot(turret_obj)
    print(f"[mbt_lavi] turret pivot (source frame, model units): {tuple(round(c, 4) for c in pivot_local)}")

    # Contract naming: {part}_{role}. One role (hull) for both parts -- see
    # module docstring "roles" section.
    if ROLE not in vehicle_kit.ROLES:
        raise SystemExit(f"role {ROLE!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    for ob, part in ((hull_obj, "hull"), (turret_obj, "turret")):
        name = f"{part}_{ROLE}"
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = ROLE
        ob["rl_part"] = part

    # Bake model-units -> metres into vertex data (object scale stays 1).
    _bake_scale([hull_obj, turret_obj], mpu)
    pivot_world_src = tuple(c * mpu for c in pivot_local)

    # Reorient: source forward is -X (gun + antennas point -X, verified with
    # axis markers -- see report), contract wants +X. A 180-degree Z
    # rotation, applied and baked in AFTER the cut and the scale bake, on
    # both pieces and on the pivot location alike.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in (hull_obj, turret_obj):
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    pivot_world = (-pivot_world_src[0], -pivot_world_src[1], pivot_world_src[2])

    # Ground alignment. The source's own origin sits at the vehicle's
    # vertical MIDPOINT (z range was -0.472..0.476 in model units, roughly
    # symmetric) -- not at ground level the way every kit-built vehicle in
    # this pipeline is authored (author_eitan.py's GROUND=0.10, hull built
    # upward from there; confirmed on the shipped apc_eitan.glb, whose
    # lowest wheel vertex sits at z=0.028 m). Left alone, the runtime would
    # plant this unit's origin on the ground plane and half the hull would
    # sink below it. Shift both pieces (and the pivot) up by the combined
    # lowest vertex, in the SAME already-scaled, already-rotated frame, so
    # every measurement above stays valid in the source's own coordinates.
    zmins = []
    for ob in (hull_obj, turret_obj):
        zmins.append(min(v.co.z for v in ob.data.vertices))
    shift_z = -min(zmins)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in (hull_obj, turret_obj):
        ob.location.z = shift_z
        ob.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    pivot_world = (pivot_world[0], pivot_world[1], pivot_world[2] + shift_z)
    print(f"[mbt_lavi] ground shift +{shift_z:.4f} m (lowest vertex -> z=0)")
    print(f"[mbt_lavi] turret pivot (export frame, +X forward, metres): {tuple(round(c, 4) for c in pivot_world)}")

    pivot_obj = bpy.data.objects.new("turret_pivot", None)
    pivot_obj.empty_display_size = 0.15
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot_world
    inv = Matrix.Translation(Vector(pivot_world) * -1.0)
    turret_obj.parent = pivot_obj
    turret_obj.matrix_parent_inverse = inv

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
            "Tank hull+turret -- AI-generated (Meshy), disclosed per CONTRIBUTING.md; "
            "cut into hull_hull/turret_hull for this repository"
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(f"[mbt_lavi] wrote {OUT_PATH} ({size} bytes)")
    return OUT_PATH


if __name__ == "__main__":
    export()
