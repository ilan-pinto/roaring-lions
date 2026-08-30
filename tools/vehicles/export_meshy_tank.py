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

ROLE SPLIT (added after the project lead flagged "the tank color is all
monolith color"; see `.superpowers/tank-role-split-report.md`). Both
`hull_hull` and `turret_hull` shipped as one role (`hull`) each -- correct
for the hull/turret CUT above, wrong for shading, since it means the tracks
and the barrel shade through the same ramp as painted armour. Connectivity
was checked FIRST, exactly like the hull/turret cut: a weld-invariant
flood-fill (identical at weld thresholds 1e-6..1e-2, so not an artifact of
the threshold) found the tracks welded into the SAME single component as
the hull body, and the barrel welded into the SAME single component as the
turret body -- so, same as above, there is no seam to cut along and the
cut is geometric (face position), not topological. One exception: the two
antenna stubs on the turret ARE already separate, watertight components
(this was true even before the hull/turret cut -- see the module docstring
above), so those need no cut or hole-fill at all, only picking out.

Both new cuts are measured in the FINAL frame (already scaled, rotated
+X-forward, ground-aligned) -- unlike Z_CUT/BARREL_* above, which are
source-frame -- because they were derived by inspecting the ALREADY
SHIPPED predecessor `mbt_lavi.glb` directly (see the report for the
z/y-histograms):

  - Tracks/wheels (`hull` -> `rubber`): a y-histogram of `hull_hull` at low
    z shows the mesh's own CENTRE (|y| < ~0.73) completely empty from
    z=0 up to z=0.38 -- the open belly between the two track runs -- while
    the flanks (|y| >= ~0.73) are dense. Above z=0.38 the centre starts
    filling in (hull floor plate), so 0.38 is where the geometry itself
    stops being "only the two track lobes." `Y_TRACK_MIN=0.70` sits with
    margin inside the empirical gap.
  - Barrel (`hull` -> `metal`, within `turret_hull`): an x-histogram of
    `turret_hull` shows the turret body's own width collapsing from
    |y|~0.75 down to a narrow ~0.11-wide cylinder from x=0.70 onward, with
    the sparse-ring vertex spacing characteristic of a low-poly cylinder,
    running to the muzzle at x=3.16.
  - Antennas (`hull` -> `metal`, within `turret_hull`): picked out by
    connectivity alone, not a box -- their real bounding boxes overlap the
    turret roof's own z-range enough that a position-only box would also
    catch roof-hatch geometry at the same x/z and opposite y.

No `plate`/`glass`/`recess` split was attempted on this asset: past tracks,
barrel and antennas, the remaining geometry (turret roof hatches, hull
greebles) is still one welded blob with no comparable large-scale
geometric signal (no open-gap, no cylinder-ring pattern, no disjoint
component) to cut along -- see the report for what was checked and why it
was not enough to act on.
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

#: Track/wheel role cut (`hull` -> `rubber`), in the FINAL (scaled,
#: +X-forward, ground-aligned) frame, metres -- see module docstring
#: "ROLE SPLIT" for the y-histogram evidence this was measured against.
Z_WHEEL_CUT = 0.38
Y_TRACK_MIN = 0.70

#: Barrel role cut (`hull` -> `metal`, within `turret_hull`), same final
#: frame -- narrower than BARREL_X_MAX/BARREL_Y above, which only had to
#: separate turret from hull; this one must exclude the mantlet/turret-front
#: body and keep only the free-standing barrel tube. See module docstring.
BARREL_ROLE_X_MIN = 0.70
BARREL_ROLE_Y_MAX = 0.35

#: A connected component below this face count, once the antenna/greeble
#: components are set aside, would mean the "one dominant welded body"
#: assumption `_antenna_face_indices` relies on does not hold for this
#: mesh -- fail loudly rather than silently mis-splitting.
ANTENNA_MAIN_MIN_FACES = 200


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


def _antenna_face_indices(ob, main_min_faces=ANTENNA_MAIN_MIN_FACES):
    """Face indices of every SMALL connected component of `ob`, i.e. every
    component except the largest -- the antenna stubs, which this module's
    docstring already established are separate and watertight (found by the
    same weld-then-flood-fill census this task's report ran, identical
    across weld thresholds 1e-6..1e-2). Returns a plain set of
    `ob.data.polygons` indices so the caller can build a position-free
    `keep_fn` for `_delete_faces` -- deliberately NOT a bounding-box test:
    the antenna stubs' real bounding boxes overlap the turret roof's own
    z-range closely enough that a box would also catch roof-hatch geometry
    at the same x/z and opposite y (see report).

    Weld first (`remove_doubles`, matching the census's own method) so a
    vertex-per-loop export convention cannot fragment one physical surface
    into spurious extra "components" -- though `ob` here is still native
    Blender geometry, not glTF-roundtripped, so this is a defensive no-op in
    the common case, not a correction for a known defect on this specific
    object.
    """
    n_faces_before = len(ob.data.polygons)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    if len(bm.faces) != n_faces_before:
        raise SystemExit(
            f"{ob.name}: welding for component analysis changed face count "
            f"{n_faces_before} -> {len(bm.faces)} -- the 'faces are stable, only "
            f"verts merge' assumption this helper relies on does not hold here"
        )
    seen = set()
    comps = []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        stack = [f0]
        comp = []
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            comp.append(f.index)
            for e in f.edges:
                for f2 in e.link_faces:
                    if f2.index not in seen:
                        seen.add(f2.index)
                        stack.append(f2)
        comps.append(comp)
    bm.free()
    comps.sort(key=len, reverse=True)
    if not comps:
        return set()
    main = comps[0]
    if len(main) < main_min_faces:
        raise SystemExit(
            f"{ob.name}: largest connected component is only {len(main)} faces "
            f"(< {main_min_faces}) -- the 'one dominant welded body plus small "
            f"greebles' assumption does not hold, stop and re-examine"
        )
    small = set()
    for c in comps[1:]:
        small.update(c)
    print(
        f"[{ob.name}] connected components: {len(comps)} "
        f"(main={len(main)} faces, {len(comps) - 1} small totalling {len(small)} faces)"
    )
    return small


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

    # ------------------------------------------------------------------
    # Role split. `hull_obj`/`turret_obj` are already scaled, rotated and
    # ground-aligned at this point, which is why the thresholds above are
    # metres in THIS frame rather than source model units -- see the module
    # docstring's "ROLE SPLIT" section for the evidence each was measured
    # against.

    # -- Turret antennas -> metal. Connectivity-based, not a box (see
    # `_antenna_face_indices` docstring): already separate, watertight, no
    # hole-fill needed.
    antenna_idx = _antenna_face_indices(turret_obj)

    def _is_antenna_face(f):
        return f.index in antenna_idx

    bpy.ops.object.select_all(action="DESELECT")
    turret_obj.select_set(True)
    bpy.context.view_layer.objects.active = turret_obj
    bpy.ops.object.duplicate()
    antenna_obj = bpy.context.object
    antenna_obj.name = "turret_metal_antenna"
    _delete_faces(antenna_obj, _is_antenna_face, invert=False)
    _delete_faces(turret_obj, _is_antenna_face, invert=True)
    print(
        f"[mbt_lavi] antenna piece: {len(antenna_obj.data.polygons)} faces; "
        f"turret body+barrel remaining: {len(turret_obj.data.polygons)} faces"
    )

    # -- Barrel -> metal. A real geometric cut through the welded
    # turret-body+barrel shell -- same per-loop triangle_fill approach as
    # the original hull/turret cut, because the same "combined multi-loop
    # holes_fill returns nothing" trap applies here too.
    def _is_barrel_face(f):
        c = f.calc_center_median()
        return c.x >= BARREL_ROLE_X_MIN and abs(c.y) <= BARREL_ROLE_Y_MAX

    bpy.ops.object.select_all(action="DESELECT")
    turret_obj.select_set(True)
    bpy.context.view_layer.objects.active = turret_obj
    bpy.ops.object.duplicate()
    barrel_obj = bpy.context.object
    barrel_obj.name = "turret_metal_barrel"
    _delete_faces(barrel_obj, _is_barrel_face, invert=False)
    _delete_faces(turret_obj, _is_barrel_face, invert=True)
    print(
        f"[mbt_lavi] pre-fill barrel faces={len(barrel_obj.data.polygons)} "
        f"turret-body-remaining faces={len(turret_obj.data.polygons)}"
    )
    _fill_holes(barrel_obj, "barrel")
    _fill_holes(turret_obj, "turret-post-barrel-cut")
    print(
        f"[mbt_lavi] post-fill barrel faces={len(barrel_obj.data.polygons)} "
        f"turret-body-remaining faces={len(turret_obj.data.polygons)}"
    )

    bpy.ops.object.select_all(action="DESELECT")
    antenna_obj.select_set(True)
    barrel_obj.select_set(True)
    bpy.context.view_layer.objects.active = barrel_obj
    bpy.ops.object.join()
    metal_turret_obj = bpy.context.view_layer.objects.active
    print(f"[mbt_lavi] turret_metal (antenna+barrel joined): {len(metal_turret_obj.data.polygons)} faces")

    # -- Tracks/wheels -> rubber. Also a real geometric cut through the
    # welded hull shell (see module docstring for the y-histogram evidence).
    def _is_wheel_face(f):
        c = f.calc_center_median()
        return c.z < Z_WHEEL_CUT and abs(c.y) >= Y_TRACK_MIN

    bpy.ops.object.select_all(action="DESELECT")
    hull_obj.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.duplicate()
    wheel_obj = bpy.context.object
    wheel_obj.name = "hull_rubber"
    _delete_faces(wheel_obj, _is_wheel_face, invert=False)
    _delete_faces(hull_obj, _is_wheel_face, invert=True)
    print(
        f"[mbt_lavi] pre-fill wheel faces={len(wheel_obj.data.polygons)} "
        f"hull-remaining faces={len(hull_obj.data.polygons)}"
    )
    _fill_holes(wheel_obj, "wheel")
    _fill_holes(hull_obj, "hull-post-wheel-cut")
    print(
        f"[mbt_lavi] post-fill wheel faces={len(wheel_obj.data.polygons)} "
        f"hull-remaining faces={len(hull_obj.data.polygons)}"
    )

    # Re-tag the two new pieces (hull_obj/turret_obj keep role "hull",
    # already set above and unchanged by these cuts). Both new roles must
    # be in the closed vehicle vocabulary -- checked, not assumed.
    for role in ("rubber", "metal"):
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    for ob, role, part, name in (
        (wheel_obj, "rubber", "hull", "hull_rubber"),
        (metal_turret_obj, "metal", "turret", "turret_metal"),
    ):
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = part
    # ------------------------------------------------------------------

    pivot_obj = bpy.data.objects.new("turret_pivot", None)
    pivot_obj.empty_display_size = 0.15
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot_world
    inv = Matrix.Translation(Vector(pivot_world) * -1.0)
    for ob in (turret_obj, metal_turret_obj):
        ob.parent = pivot_obj
        ob.matrix_parent_inverse = inv

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
            "cut into hull_hull/hull_rubber/turret_hull/turret_metal for this repository"
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(
        f"[mbt_lavi] wrote {OUT_PATH} ({size} bytes) meshes: "
        f"hull_hull={len(hull_obj.data.polygons)} hull_rubber={len(wheel_obj.data.polygons)} "
        f"turret_hull={len(turret_obj.data.polygons)} turret_metal={len(metal_turret_obj.data.polygons)}"
    )
    return OUT_PATH


if __name__ == "__main__":
    export()
