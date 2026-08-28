"""Export a vehicle as hull + turret glTF nodes, from an authored `.blend`.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_vehicle.py -- apc_eitan

    # or every vehicle this pipeline covers:
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_vehicle.py -- all

Writes `art/meshes/vehicles/<unit_id>.glb`. Sibling of `tools/export_mesh_team.py`
(infantry, skinned) and targets the same pinned
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`, extended for a
mostly-rigid vehicle rather than a figure -- see this task's report for the
extension proposed and NOT yet pinned into that doc.

A vehicle needs no skeleton. At most two rigid bodies: a hull, and a turret
that yaws about one point on the hull roof. So this module builds, per
vehicle:

  - one merged mesh per (part, role) pair actually present -- "part" is
    "hull" or "turret", "role" is one of `tools/vehicles/kit.py`'s ROLES
    (the vehicle kit's own closed set, distinct from infantry's ten). Mesh
    and node name are both `f"{part}_{role}"` (e.g. "hull_hull",
    "hull_plate", "turret_metal"), and `extras.rl_role` / `extras.rl_part`
    repeat it, the same redundant-on-purpose convention the infantry
    contract already uses for `rl_role` alone.
  - a plain Empty node named "turret_pivot" (extras `rl_pivot: "turret"`),
    parented above the turret meshes, positioned at the vertical axis the
    weapon station actually turns about. The runtime rotates this node
    directly from sim turret bearing -- no bone, no skin, no baked
    animation clip needed for traverse.

Everything here is measured from the source geometry, never hand-typed:
the hull/turret split is the same name-prefix match `render_eitan.py` /
`flatten_for_sprites.py` already use (kept in explicit lockstep, see
`VehicleMeshSpec.turret_prefixes`'s comment); the real-world scale factor
is derived via `dimetric.metres_per_unit` against the `realMetres` already
shipped in the vehicle's own billboard manifest, so the mesh and the sprite
it stands beside agree on size; and the turret pivot is the horizontal
centroid of the turret geometry's own lowest contact layer -- verified
against the Eitan's explicitly named `turret_ring` mesh, which the
heuristic reproduces to four decimal places (see the report).
"""
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "vehicles"))

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- tools/vehicles/kit.py, ROLES is the vehicle role vocabulary

REPO = os.path.dirname(HERE)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")

#: The node the runtime rotates for traverse. A vehicle with no turret
#: meshes (a hull-only vehicle, e.g. a dozer or truck) omits it entirely,
#: mirroring the sprite pipeline's own "no turret sheet" behaviour.
TURRET_PIVOT_NODE = "turret_pivot"

#: Real-world bounding-box diagonal, in metres, below which a source part is
#: culled before merge -- see `_cull_subpixel`'s own doc comment. Measured
#: against `eitan_apc.blend` (f-vehicle-cost-report.md): every confirmed
#: fastener-class object (wheel lug nuts 0.157-0.166 m, armour bolts 0.055 m,
#: wheel nuts 0.139 m, suspension dampers 0.103 m, the drive hinge 0.158 m,
#: the APS tube greebles 0.165 m) sits at or below 0.166 m; every part kept
#: sits at 0.170 m or above (the muzzle-shroud "hider" family, the tow
#: points, door hardware, suspension coils, the wheel dish/flange/cap ring,
#: everything larger). 0.17 m draws the line squarely in that gap rather
#: than at either edge -- not tuned per-vehicle, so it generalises to the
#: next vehicle's own fastener-scale hardware without a name-pattern list.
MIN_PART_DIAG_M = 0.17


@dataclass
class VehicleMeshSpec:
    unit_id: str
    src: str
    #: Name-prefix match for meshes that traverse with the weapon station.
    #: MUST match the corresponding render_<vehicle>.py script (and, where
    #: one exists, the flatten_for_sprites.py that produced `src`) -- kept
    #: as an explicit duplicate rather than an import, because importing a
    #: leaf render script for one constant re-runs its whole module body
    #: (see the report). If a reshape adds a traversing part under a new
    #: prefix, the billboard turret sheet and this mesh silently disagree
    #: about what turns, which is exactly the class of bug this comment
    #: exists to prevent.
    turret_prefixes: tuple
    #: Manifest this vehicle's already-shipped billboard sheet wrote its
    #: derived `realMetres` into. Read at export time rather than copied as
    #: a literal, so the mesh and the sprite it stands beside can never
    #: silently drift apart in size the way a second hand-typed number
    #: would let them.
    sprite_manifest: str
    credit: str


SPECS = {
    "apc_eitan": VehicleMeshSpec(
        unit_id="apc_eitan",
        src=os.path.join(REPO, "art", "src", "vehicles", "eitan_apc.blend"),
        turret_prefixes=("turret_", "mgun_coax", "aps_radar_"),
        sprite_manifest=os.path.join(REPO, "assets", "sprites", "EITAN_HULL", "manifest.json"),
        credit="8x8 APC -- authored from primitives for this repository, CC BY-SA 4.0",
    ),
    "dozer_d9": VehicleMeshSpec(
        unit_id="dozer_d9",
        src=os.path.join(REPO, "art", "src", "vehicles", "d9.blend"),
        # No weapon station -- render_d9.py's own SPEC leaves turret_meshes
        # empty for the same reason ("the D9 is unarmed"). An empty tuple
        # here makes is_turret's str.startswith(()) False for every object,
        # so every part goes to the hull and no turret_pivot node is emitted
        # -- exercising the mesh contract's hull-only branch for the first
        # time (apc_eitan always had a turret).
        turret_prefixes=(),
        sprite_manifest=os.path.join(REPO, "assets", "sprites", "D9_HULL", "manifest.json"),
        credit="D9 armoured dozer -- authored from primitives for this repository, CC BY-SA 4.0",
    ),
}
DEFAULT_UNIT = "apc_eitan"


def _drop_non_mesh(unit_id):
    """Scene furniture the flatten/author step left behind (an unused
    animation-path curve, on the Eitan) -- never the vehicle itself."""
    dropped = []
    for ob in list(bpy.data.objects):
        if ob.type != "MESH":
            dropped.append((ob.name, ob.type))
            bpy.data.objects.remove(ob, do_unlink=True)
    if dropped:
        print(f"[{unit_id}] dropped {len(dropped)} non-mesh object(s): {dropped}")


def _drop_wreck_variants(unit_id, meshes):
    """Some vehicles (the D9, confirmed by inspection -- not the Eitan, which
    derives its wreck pose by re-posing the SAME live geometry at render
    time) carry a dedicated `WRECK_`-prefixed replacement mesh per damaged
    part, alongside the live one, in the same .blend -- the exact split
    `render_d9.py`'s own live/debris list comprehension already makes
    (`WRECK_` if name-prefixed, else live). The mesh contract has no wreck
    clip in this slice (see the report's point 7), so this drops every
    `WRECK_` object before merge, the same name-prefix convention the
    billboard renderer uses, generalised for any future vehicle authored the
    same way -- harmless (a no-op) on a vehicle with no such objects."""
    keep, dropped = [], []
    for ob in meshes:
        if ob.name.startswith("WRECK_"):
            dropped.append(ob.name)
            bpy.data.objects.remove(ob, do_unlink=True)
        else:
            keep.append(ob)
    if dropped:
        print(f"[{unit_id}] dropped {len(dropped)} WRECK_ variant object(s) (no wreck clip in this export): {dropped}")
    return keep


def _apply_modifiers(meshes):
    """Bake BEVEL/SUBSURF into real geometry.

    `flatten_for_sprites.py` bakes only each part's world TRANSFORM into its
    vertices; it does not touch the modifier stack, so every part on disk
    still carries a Bevel (and eight carry a Subsurf) modifier. Cycles
    evaluates those automatically for the shipped billboard; a static glTF
    export does not unless something applies them first. Left alone, the
    mesh export would be visibly more faceted than the sprite it stands
    beside -- the small bevels are exactly what gives the hero asset its
    rounded read.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.convert(target="MESH")


def _extent(meshes):
    """The model's own longest axis-aligned extent -- what `real_metres` is
    declared against, matching `render_vehicle.py:setup()`'s own measurement
    exactly (axis extent, not bounding radius -- a radius under-reports by
    up to sqrt(2) for a diagonal-heavy shape)."""
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for ob in meshes:
        eo = ob.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            wc = eo.matrix_world @ v.co
            xs.append(wc.x)
            ys.append(wc.y)
            zs.append(wc.z)
        eo.to_mesh_clear()
    return max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def _cull_subpixel(unit_id, meshes, mpu, min_diag_m=MIN_PART_DIAG_M):
    """Drops any part whose own real-world bounding-box diagonal is below
    `min_diag_m` -- fastener-scale hardware (lug nuts, armour bolts, wheel
    nuts, suspension dampers...) that a Bevel modifier makes vertex-expensive
    on export (hard-edge normal splitting) but that cannot resolve at the
    25-80 px this ships at regardless of vertex budget. Geometric, not a
    per-vehicle name-pattern list, so it generalises to the next vehicle's
    own greebles unexamined -- it measures every part exactly the way
    `_extent` already measures the whole model, just per-object instead of
    pooled.

    Genuinely small-but-singular features (a tow point, a door handle) sit
    above the threshold and survive -- see `MIN_PART_DIAG_M`'s own doc
    comment for the measured gap this line sits in. Runs AFTER `mpu` is
    already known (derived from the FULL, uncalled part set, so a handful of
    tiny parts cannot skew the scale the way culling before measuring
    extent would risk) and BEFORE the turret/hull split, so it applies
    uniformly to both.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    keep, dropped = [], []
    for ob in meshes:
        eo = ob.evaluated_get(dg)
        m = eo.to_mesh()
        coords = [eo.matrix_world @ v.co for v in m.vertices]
        nv = len(m.vertices)
        eo.to_mesh_clear()
        if not coords:
            keep.append(ob)
            continue
        xs = [c.x for c in coords]
        ys = [c.y for c in coords]
        zs = [c.z for c in coords]
        diag_model = ((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2 + (max(zs) - min(zs)) ** 2) ** 0.5
        diag_m = diag_model * mpu
        if diag_m < min_diag_m:
            dropped.append((ob.name, nv, round(diag_m, 4)))
            bpy.data.objects.remove(ob, do_unlink=True)
        else:
            keep.append(ob)
    if dropped:
        dropped_verts = sum(d[1] for d in dropped)
        print(
            f"[{unit_id}] culled {len(dropped)} sub-{min_diag_m}m part(s), "
            f"{dropped_verts} source vertices (fastener-scale hardware, e.g. "
            f"{dropped[0][0]}...{dropped[-1][0]})"
        )
    return keep


def _turret_pivot(turret_meshes, eps=0.05):
    """The yaw axis a traversing weapon station turns about, as the
    horizontal centroid of its own lowest contact layer -- where it meets
    the hull roof, e.g. a turret ring.

    Not read off any single named part, because that would not generalise
    past the Eitan: derived purely from geometry so any vehicle with a
    turret_prefixes split gets a pivot with no per-vehicle hand-tuning.
    Verified on the Eitan against `turret_ring`'s own bounding-box centre
    computed independently -- (-1.5081, -0.0341) both ways, agreeing to
    four decimal places at every epsilon from 0.02 to 0.2 units, so the
    result is not sensitive to the choice of `eps`.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob in turret_meshes:
        eo = ob.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            pts.append(eo.matrix_world @ v.co)
        eo.to_mesh_clear()
    if not pts:
        return None
    zmin = min(p.z for p in pts)
    layer = [p for p in pts if p.z <= zmin + eps]
    cx = sum(p.x for p in layer) / len(layer)
    cy = sum(p.y for p in layer) / len(layer)
    return (cx, cy, zmin)


def _read_real_metres(spec):
    with open(spec.sprite_manifest) as fh:
        manifest = json.load(fh)
    return manifest["realMetres"]


def _join_by_part_role(meshes, part):
    """One merged mesh per `rl_role` present among `meshes`, named
    `f"{part}_{role}"` -- the per-(part, role) generalisation of
    `tools/units/rig.py`'s `join_by_role`, needed here because a plain
    per-role join would merge the hull's "metal" parts with the turret's
    "metal" parts into one mesh, making independent traverse impossible.
    """
    groups = defaultdict(list)
    for ob in meshes:
        role = ob.get("rl_role")
        if role is None:
            raise SystemExit(f"{ob.name} carries no rl_role -- the kit must set one")
        if role not in vehicle_kit.ROLES:
            raise SystemExit(
                f"{ob.name}: role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}"
            )
        groups[role].append(ob)

    merged = {}
    for role, obs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        name = f"{part}_{role}"
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        # join() keeps the active source object's custom properties (e.g. a
        # stray rl_localised from flatten_for_sprites.py's own bookkeeping);
        # clear everything and set exactly the two the contract wants.
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = part
        merged[role] = ob
    return merged


def _bake_scale(objs, mpu):
    """Apply the model-units -> metres factor into vertex data, so the
    exported node carries object scale 1 -- the mesh contract's own
    convention ("object scale always 1"). Safe to apply about each object's
    own origin because every source part's origin sits at world (0, 0, 0)
    (kit.py's `from_pydata`-at-absolute-coordinates convention, confirmed on
    every sampled part of the Eitan)."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.scale = (mpu, mpu, mpu)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def export_vehicle(spec, out_path=None):
    bpy.ops.wm.open_mainfile(filepath=spec.src)
    _drop_non_mesh(spec.unit_id)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    meshes = _drop_wreck_variants(spec.unit_id, meshes)
    _apply_modifiers(meshes)
    # convert() replaces mesh data in place on the same objects; the object
    # list itself is unchanged, but re-fetch defensively rather than trust that.
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    leftover_mods = sum(len(o.modifiers) for o in meshes)
    if leftover_mods:
        raise SystemExit(f"{leftover_mods} modifier(s) survived convert() -- would export un-applied")

    extent_model = _extent(meshes)
    real_metres = _read_real_metres(spec)
    mpu = metres_per_unit(extent_model, real_metres)
    print(
        f"[{spec.unit_id}] extent {extent_model:.3f} model units -> {real_metres:.3f} m "
        f"declared ({mpu:.5f} m/unit, real_metres from {spec.sprite_manifest})"
    )

    meshes = _cull_subpixel(spec.unit_id, meshes, mpu)

    def is_turret(ob):
        return ob.name.startswith(spec.turret_prefixes)

    turret_meshes = [o for o in meshes if is_turret(o)]
    hull_meshes = [o for o in meshes if not is_turret(o)]
    print(f"[{spec.unit_id}] hull parts: {len(hull_meshes)}  turret parts: {len(turret_meshes)}")
    if not hull_meshes:
        raise SystemExit(f"{spec.unit_id}: no hull meshes -- turret_prefixes matched everything")

    pivot_local = _turret_pivot(turret_meshes) if turret_meshes else None

    hull_merged = _join_by_part_role(hull_meshes, "hull")
    turret_merged = _join_by_part_role(turret_meshes, "turret") if turret_meshes else {}

    _bake_scale(list(hull_merged.values()) + list(turret_merged.values()), mpu)

    pivot_obj = None
    if pivot_local is not None:
        pivot_world = tuple(c * mpu for c in pivot_local)
        pivot_obj = bpy.data.objects.new(TURRET_PIVOT_NODE, None)
        pivot_obj.empty_display_size = 0.05
        pivot_obj["rl_pivot"] = "turret"
        bpy.context.collection.objects.link(pivot_obj)
        pivot_obj.location = pivot_world
        # Matches render_vehicle.py:setup()'s own re-parenting idiom: assign
        # the inverse directly rather than relying on pivot.matrix_world,
        # which is still identity until the depsgraph next updates.
        inv = Matrix.Translation(Vector(pivot_world) * -1.0)
        for ob in turret_merged.values():
            ob.parent = pivot_obj
            ob.matrix_parent_inverse = inv
        print(f"[{spec.unit_id}] {TURRET_PIVOT_NODE} at {tuple(round(c, 4) for c in pivot_world)} m")
    elif turret_meshes:
        raise SystemExit(f"{spec.unit_id}: turret meshes present but no pivot could be computed")

    os.makedirs(OUT_DIR, exist_ok=True)
    path = out_path or os.path.join(OUT_DIR, f"{spec.unit_id}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=spec.credit,
    )
    size = os.path.getsize(path)
    print(
        f"[{spec.unit_id}] wrote {path} ({size} bytes) "
        f"hull meshes: {sorted(hull_merged)} turret meshes: {sorted(turret_merged)} "
        f"pivot: {'yes' if pivot_obj else 'no'}"
    )
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv == ["all"]:
        names = list(SPECS)
    else:
        names = argv or [DEFAULT_UNIT]
    for name in names:
        if name not in SPECS:
            raise SystemExit(f"no VehicleMeshSpec for {name!r}; have {sorted(SPECS)}")
        export_vehicle(SPECS[name])


if __name__ == "__main__":
    main()
