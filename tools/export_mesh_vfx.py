"""Export a VFX mesh from a supplied single-mesh/single-material `.blend`,
re-origined and split into a closed THREE-zone vocabulary the three.js
palette-shaded VFX mesh path expects
(`packages/render/src/three/units/muzzle-flash.ts`,
`packages/render/src/three/units/explosion-burst.ts`,
`packages/render/src/three/units/smoke-plume.ts`).

Two split MODES now, not one -- `smoke_plume` needed a genuinely different
one, not a third application of the first:

  * `"tip"` / `"bbox_center"` (RADIAL): concentric SHELLS, splitting each
    polygon by its own centroid's 3D DISTANCE from a single point. Correct
    for a roughly blob-shaped burst -- `core`/`mid`/`outer`, hottest at the
    middle, cooling outward in every direction equally.
  * `"height_z"` (AXIAL): stacked horizontal SLABS, splitting each polygon
    by its own centroid's Z COORDINATE alone, measured from local Z=0 (the
    `"min_z"`-re-origined base). Correct for a column that rises rather
    than a blob that detonates -- see `smoke-plume.ts`'s own top comment
    for why a radial split from any single point is the wrong shape for
    smoke (there is no "outer edge" of a slab the way there is of a
    shell), and `_height_split`'s own doc comment below for the mechanics.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_vfx.py -- explosion_burst

    # print the census without writing a file:
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_vfx.py -- explosion_burst --dry-run

Writes `art/meshes/vfx/<asset_id>.glb`. Sibling of `export_mesh_vehicle.py`
/ `export_mesh_team.py` / `export_mesh_building.py`, generalised for VFX's
own much simpler contract -- no armature, no rigid multi-part hull, ONE
incoming mesh with ONE incoming material, split into three zones along one
axis or one point. This is the method `art/meshes/vfx/muzzle_flash.glb`
established (see that asset's own `muzzle-flash.ts` top comment: "re-origin,
then partition faces by 3D distance against fixed fractions of max
radius"); ported here as reusable, committed code rather than staying a
one-off (that asset's own export script was never saved -- see the
explosion-burst task's own report). `MuzzleFlashSpec` below is still never
RUN by this module's own `main()` in any task to date (only `explosion_burst`,
then `smoke_plume`, have actually been exported through it) -- it documents
how the shipped `muzzle_flash.glb` would be reproduced from its own source,
for whoever eventually needs to, without touching that already-shipped,
already-tested asset here.

## The split, mechanically

Blender's native face unit is the POLYGON (which may be an n-gon), not the
triangle a glTF export ultimately writes -- so the split itself operates on
`mesh.polygons` (matching how a human working in the Blender UI would select
faces), and the CENSUS this script prints counts triangles via
`calc_loop_triangles()` on each resulting zone's own separated mesh, after
the split -- the same unit the muzzle-flash task's own 199/626/848 census
used. A polygon is assigned to a zone by `_radial_split` (3D distance from a
re-origin point, against `core_frac`/`mid_frac` of the mesh's own max such
distance -- literal concentric shells) or `_height_split` (local Z alone,
against the same two fractions of the mesh's own max Z -- literal stacked
slabs), per `VfxMeshSpec.split_origin`. Both are exhaustive (every polygon
lands in exactly one zone) and non-overlapping, matching the muzzle-flash
task's own "not a percentile-of-face-count split" rule.

## Re-origin strategies

Two, named rather than hard-coded per asset:

  * `"min_x"` -- shift the mesh by `-bbox_min_x` along X only (Y/Z
    untouched). What the muzzle flash used: origin lands at the narrow,
    barrel-adjacent tip of an elongated flare.
  * `"min_z"` -- shift the mesh by `-bbox_min_z` along Z only (X/Y
    untouched). What `explosion_burst` uses: origin lands at the lower
    taper point of a squat, radially-symmetric blob -- the ground-contact
    point an explosion detonates from and rises away from, matching where
    `ThreeRenderer.spawnCollapseFx` already anchors the particle fallback
    (a structure's own footprint centre, at ground height). See the
    explosion-burst task's own report for the measurement that justified
    this over `"min_x"` for that asset (near-1:1 X/Y aspect and a
    near-symmetric top/bottom Z taper -- there is no directional "forward"
    to align, only a vertical axis to plant at ground level). `smoke_plume`
    reuses this SAME strategy unchanged, for the identical reason: a column
    also plants at ground level and rises away from it -- see
    `smoke-plume.ts`'s own top comment for that asset's own axis
    measurement (local Z is unambiguously its rise axis: a 12-bin profile
    along each of local X/Y/Z showed only Z with the one-directional
    "near-zero at one end, widening, narrowing again toward the other"
    taper a rising column produces; X and Y both show the non-monotonic
    cross-section pattern of a HORIZONTAL slice instead).

No baked ROTATION is applied for `explosion_burst` -- see the report's own
radial-profile measurement for why: X/Y bounding-box extent ratio 1.012
(near-circular in the horizontal plane) means no yaw orientation reads
differently from any other, so the "five of five other Meshy assets needed
a baked rotation" precedent does not extend to this one. `smoke_plume` also
needed none, for a DIFFERENT reason (its own horizontal footprint is NOT
circular -- X/Y extent ratio ~3.4:1 -- so unlike the burst it does have a
directional lean in the horizontal plane): what this script checks for a
rotation bake is the UP axis, not the horizontal footprint shape, and the
column's own local Z is already Blender's native up axis, confirmed by the
same per-axis profile measurement -- so nothing needed correcting there
either, for a reason specific to this asset rather than a repeat of the
burst's. Verified by measurement in both cases, not assumed, per this
module's own recurring brief across every task that has used it.

## What is NOT done here, on purpose

No scale-bake (`export_apply`'s vertex-scale step vehicles use to fold a
measured metres-per-unit factor into vertex data): a VFX mesh has no sprite
counterpart to size-match against (`muzzle-flash.ts`'s own top comment:
"a Meshy-generated blast has no equivalent real-world measurement to
carry"). Calibrated scale is applied at RUNTIME instead
(`EXPLOSION_BURST_BASE_SCALE` in `explosion-burst.ts`, `SMOKE_PLUME_BASE_SCALE`
in `smoke-plume.ts`, both mirroring `MUZZLE_FLASH_BASE_SCALE`), so the
exported GLB keeps the source's own native unit dimensions unchanged.
"""
import glob
import os
import sys
from dataclasses import dataclass

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vfx")

#: `art/blend/` is listed in `.gitignore` (the sources are too large and are
#: supplied locally, never committed) -- so it exists only in whichever
#: checkout a human actually placed the files in, NOT in every git worktree
#: that shares this repository's history. Running from a worktree (this
#: task's own instruction: "Run from there; never cd to the main repo")
#: therefore still needs an explicit path to the ONE checkout that has the
#: supplied `.blend` sources, distinct from `REPO` (which correctly points
#: at the worktree for every OUTPUT path below). Overridable via the
#: `RL_BLEND_SOURCE_ROOT` environment variable for a machine where the
#: primary checkout lives somewhere else.
BLEND_SOURCE_ROOT = os.environ.get(
    "RL_BLEND_SOURCE_ROOT", "/Users/ilpinto/dev/roaring-lions"
)

#: Role vocabularies are now PER SPEC (`VfxMeshSpec.roles`, below) rather
#: than one fixed module-level tuple -- `muzzle_flash`/`explosion_burst`
#: both default to `("core", "mid", "outer")`, matching
#: `packages/render/src/three/units/vfx-mesh-role.ts`'s `VFX_MESH_ROLES`
#: exactly (hand-kept in sync the same way `_join_by_part_role`'s
#: `turret_prefixes` comment already accepts for this pipeline: importing a
#: TypeScript module from Blender's Python is not an option); `smoke_plume`
#: overrides it to `("base", "mid", "top")`, matching
#: `packages/render/src/three/units/smoke-plume-role.ts`'s
#: `SMOKE_PLUME_ROLES` the same way.


@dataclass
class VfxMeshSpec:
    asset_id: str
    src: str
    #: Fixed fractions of the mesh's own max extent along the split axis
    #: (from `split_origin`, below) that separate zone0/zone1 (`roles[0]`/
    #: `roles[1]`) from zone1/zone2 (`roles[1]`/`roles[2]`). For a RADIAL
    #: split (`split_origin` `"tip"`/`"bbox_center"`) that extent is 3D
    #: distance from a point -- 0.40/0.70 is the muzzle flash's own pair.
    #: For an AXIAL split (`split_origin` `"height_z"`) it is local Z alone,
    #: measured from the `"min_z"`-re-origined base -- `smoke_plume` uses
    #: even thirds (1/3, 2/3), the plainest reading of "bottom third / middle
    #: third / top third" with no attempt to reverse-engineer the fractions
    #: from where the mesh happens to bulge (see `smoke-plume.ts`'s own top
    #: comment: colour zones read by HEIGHT here, not by geometric volume).
    core_frac: float
    mid_frac: float
    #: One of `"min_x"` / `"min_z"` -- where local (0,0,0) lands, i.e. the
    #: point the RUNTIME anchors this mesh's transform to (a barrel tip, a
    #: ground-contact point...). See this module's own docstring.
    origin: str
    #: Where the SPLIT measures FROM -- may differ from `origin`. `"tip"`
    #: measures 3D distance from the same point geometry is re-origined to
    #: (the muzzle flash's own choice: correct there because that point
    #: genuinely IS the flare's hottest, ignition-adjacent end).
    #: `"bbox_center"` measures 3D distance from the mesh's own bounding-box
    #: centre instead, independent of where local (0,0,0) ends up.
    #: `explosion_burst` needs this split: its `origin` is `"min_z"` (a
    #: ground-contact PLACEMENT anchor, so the mesh does not clip through
    #: the terrain), but `"tip"` as the split origin too put the whole
    #: "core" zone in a thin dome hugging that same ground point --
    #: OCCLUDED by the wider bulge above it from the game's own downward
    #: dimetric camera, confirmed by rendering (not merely predicted) in
    #: that task's report. `"bbox_center"` puts the hottest zone at the
    #: blast's own volumetric middle instead, which is both the more
    #: physically sensible "hottest at the core of the explosion" reading
    #: AND the one confirmed visible from the actual camera angle.
    #: `"height_z"` is a THIRD, AXIAL option, not a radial one at all: no
    #: distance-from-a-point measurement runs, `_height_split` (below) reads
    #: each polygon centroid's local Z coordinate directly. `smoke_plume`
    #: uses it because a column's colour zones read by height, not by
    #: distance from any single point -- see `_height_split`'s own doc
    #: comment.
    split_origin: str
    credit: str
    #: The three zone names this spec's GLB exports its meshes under
    #: (`rl_role` extras, and the object/mesh name) -- defaults to the
    #: `core`/`mid`/`outer` vocabulary `muzzle_flash`/`explosion_burst` both
    #: use. `smoke_plume` overrides this to `("base", "mid", "top")`:
    #: `core`/`outer` describe concentric SHELLS around a point, which is
    #: meaningless for a column split into stacked horizontal bands (a slab
    #: has no "outer edge" the way a shell does) -- see
    #: `packages/render/src/three/units/smoke-plume-role.ts`'s own top
    #: comment for the full argument against reusing that vocabulary here.
    roles: tuple = ("core", "mid", "outer")


SPECS = {
    "muzzle_flash": VfxMeshSpec(
        asset_id="muzzle_flash",
        src=os.path.join(BLEND_SOURCE_ROOT, "art", "blend", "Muzzle flush", "Meshy_AI_tank_muzzle_flash_low_0830151349_texture.blend"),
        core_frac=0.40,
        mid_frac=0.70,
        origin="min_x",
        split_origin="tip",
        credit="Tank muzzle flash -- Meshy AI generated, disclosed per CONTRIBUTING.md",
        roles=("core", "mid", "outer"),
    ),
    "explosion_burst": VfxMeshSpec(
        asset_id="explosion_burst",
        # Trailing space in the directory name is REAL -- see this task's brief.
        src=os.path.join(BLEND_SOURCE_ROOT, "art", "blend", "explosion burst ", "Meshy_AI_explosion_fireball_lo_0830152530_texture.blend"),
        core_frac=0.55,
        mid_frac=0.80,
        origin="min_z",
        split_origin="bbox_center",
        credit="Explosion fireball burst -- Meshy AI generated, disclosed per CONTRIBUTING.md",
        roles=("core", "mid", "outer"),
    ),
    "smoke_plume": VfxMeshSpec(
        asset_id="smoke_plume",
        src=os.path.join(BLEND_SOURCE_ROOT, "art", "blend", "smoke plume", "Meshy_AI_smoke_plume_0830172426_image-to-3d-texture.blend"),
        # Even thirds of local Z (post `min_z` re-origin, so this is literally
        # "bottom third" / "middle third" / "top third" of the column's own
        # height) -- see `VfxMeshSpec.core_frac`'s own doc comment for why
        # this split does not chase the mesh's own geometric bulge (measured
        # ~65-75% up) the way `explosion_burst`'s radial fractions chase its
        # own hollow-shell shape. Verified non-degenerate before committing:
        # a 12-bin vertex census along local Z (this task's report) put
        # ~20%/~43%/~36% of the mesh's own vertices in the resulting
        # bottom/middle/top thirds -- every zone comfortably populated, no
        # near-empty band the way the muzzle flash's first 0.40 fraction
        # produced from a hollow-shell centre.
        core_frac=1 / 3,
        mid_frac=2 / 3,
        origin="min_z",
        split_origin="height_z",
        credit="Smoke plume -- Meshy AI generated, disclosed per CONTRIBUTING.md",
        roles=("base", "mid", "top"),
    ),
}


def _find_single_mesh(asset_id):
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(
            f"{asset_id}: expected exactly one MESH object in the source .blend, found "
            f"{len(meshes)}: {[o.name for o in meshes]} -- this script's whole re-origin/"
            f"radial-split method assumes a single supplied mesh, matching the muzzle "
            f"flash's own source shape"
        )
    return meshes[0]


def _apply_modifiers_if_any(obj):
    if not obj.modifiers:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    if obj.modifiers:
        raise SystemExit(f"{obj.name}: modifier(s) survived convert() -- would export un-applied")


def _reorigin(obj, strategy):
    """Shift the mesh's own vertex data (never `obj.location`, which stays
    world (0,0,0) throughout -- matching the muzzle flash's own exported
    convention of an object sitting at the scene origin with its geometry
    already positioned relative to it) so local (0,0,0) lands at the
    strategy's chosen bbox extreme. Returns the shift applied, for the
    report."""
    me = obj.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    bbox_min = (min(xs), min(ys), min(zs))

    if strategy == "min_x":
        shift = (bbox_min[0], 0.0, 0.0)
    elif strategy == "min_z":
        shift = (0.0, 0.0, bbox_min[2])
    else:
        raise SystemExit(f"unknown origin strategy {strategy!r}")

    if shift != (0.0, 0.0, 0.0):
        for v in me.vertices:
            v.co.x -= shift[0]
            v.co.y -= shift[1]
            v.co.z -= shift[2]
        me.update()
    return shift


def _polygon_centroid(me, poly):
    verts = [me.vertices[i].co for i in poly.vertices]
    n = len(verts)
    cx = sum(v.x for v in verts) / n
    cy = sum(v.y for v in verts) / n
    cz = sum(v.z for v in verts) / n
    return (cx, cy, cz)


def _split_origin_point(obj, strategy):
    """The point `_radial_split` measures distance from -- `"tip"` is local
    (0,0,0) (wherever `_reorigin` already placed it); `"bbox_center"` is the
    (already re-origined) mesh's own current bounding-box centre, independent
    of that placement point. See `VfxMeshSpec.split_origin`'s own doc
    comment for why these can legitimately differ."""
    if strategy == "tip":
        return (0.0, 0.0, 0.0)
    if strategy == "bbox_center":
        me = obj.data
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        zs = [v.co.z for v in me.vertices]
        return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    raise SystemExit(f"unknown split_origin strategy {strategy!r}")


#: role -> a scratch integer tag, baked into `polygon.material_index` (never
#: a real Material -- `export_materials="NONE"` drops it regardless, see
#: `export_vfx`) SPECIFICALLY so `_separate_by_role`'s SECOND and THIRD
#: passes can find "their" faces correctly. `material_index` is a per-
#: polygon ATTRIBUTE that travels with its own face through an edit-mode
#: operation; a bare bmesh face INDEX does not -- `bpy.ops.mesh.separate`
#: removes the peeled-off faces and Blender compacts the remainder, so
#: every positional index at or after the first removed face silently
#: refers to a DIFFERENT face than it did before the separate() call (or,
#: once far enough OUT of range, raises `IndexError` -- the failure mode
#: that caught this on the very first attempt with the real, imbalanced
#: 245/1096/963 explosion-burst split; a smaller first bucket like the
#: muzzle flash's own 199-of-1673 core happened not to push the second
#: pass's indices out of bounds, which is what let that shape run to
#: completion looking correct without ever proving it was).
#:
#: Built PER SPEC now, from `spec.roles`, rather than as a fixed module-level
#: `{"core": 0, "mid": 1, "outer": 2}` -- `smoke_plume`'s `("base", "mid",
#: "top")` needs the identical mechanism under different names. Order is
#: significant: index 0/1 are peeled off by `_separate_by_role`'s two passes,
#: index 2 is whatever remains in the original object afterward.
def _role_index(roles):
    return {role: i for i, role in enumerate(roles)}


def _radial_split(obj, origin_point, core_frac, mid_frac, role_index):
    """Assigns every polygon of `obj` to the three zones (`role_index`'s own
    keys, in index order) by its own centroid's 3D distance from
    `origin_point`, against `core_frac`/`mid_frac` of the mesh's own max such
    distance -- written directly into each polygon's own `material_index`
    (`role_index`) rather than returned as positional indices, so the
    assignment survives `_separate_by_role`'s destructive edits. Returns
    `{role: count}` (for the printed census) and `max_r`. Concentric SHELLS
    from a single point -- correct for a roughly blob-shaped burst, wrong
    for a column (`_height_split`, below, is the axial sibling
    `smoke_plume` uses instead)."""
    me = obj.data
    roles = list(role_index.keys())
    ox, oy, oz = origin_point
    dists = []
    for poly in me.polygons:
        cx, cy, cz = _polygon_centroid(me, poly)
        dx, dy, dz = cx - ox, cy - oy, cz - oz
        dists.append((dx * dx + dy * dy + dz * dz) ** 0.5)
    max_r = max(dists) if dists else 0.0
    core_r = core_frac * max_r
    mid_r = mid_frac * max_r

    counts = {r: 0 for r in roles}
    for poly, d in zip(me.polygons, dists):
        role = roles[0] if d <= core_r else roles[1] if d <= mid_r else roles[2]
        poly.material_index = role_index[role]
        counts[role] += 1
    me.update()
    return counts, max_r


def _height_split(obj, core_frac, mid_frac, role_index):
    """Assigns every polygon of `obj` to the three zones (`role_index`'s own
    keys, in index order) by its own centroid's LOCAL Z COORDINATE alone --
    no origin point, no distance measurement -- against `core_frac`/
    `mid_frac` of the mesh's own max Z. `obj` is assumed already re-origined
    so Z=0 is the base (`_reorigin`'s `"min_z"` strategy, the same one
    `explosion_burst` uses for its ground-contact PLACEMENT anchor -- here
    it doubles as the split's own zero point, since `smoke_plume` needs
    nothing else). Stacked horizontal SLABS, not concentric shells: the
    axial sibling of `_radial_split`, for a mesh that rises rather than one
    that detonates outward from a point -- see `smoke-plume.ts`'s own top
    comment for the full argument, and `VfxMeshSpec.split_origin`'s doc
    comment for why this is a THIRD split mode rather than a third radial
    origin choice. Returns `{role: count}` and `max_z`, the identical shape
    `_radial_split` returns, so `export_vfx` does not need to branch on the
    return value itself, only on which function it calls."""
    me = obj.data
    roles = list(role_index.keys())
    zs = [_polygon_centroid(me, poly)[2] for poly in me.polygons]
    max_z = max(zs) if zs else 0.0
    core_z = core_frac * max_z
    mid_z = mid_frac * max_z

    counts = {r: 0 for r in roles}
    for poly, z in zip(me.polygons, zs):
        role = roles[0] if z <= core_z else roles[1] if z <= mid_z else roles[2]
        poly.material_index = role_index[role]
        counts[role] += 1
    me.update()
    return counts, max_z


def _separate_by_role(obj, counts, role_index):
    """Physically splits `obj` into three new MESH objects, one per role, via
    `bmesh` face selection (by each face's own persistent `material_index`,
    see `_role_index`'s doc comment -- NOT by positional index) +
    `bpy.ops.mesh.separate(type='SELECTED')`, the same operation a human
    artist would drive from the Blender UI. Consumes (deletes) the original
    `obj`; returns `{role: new_obj}`. `role_index`'s own key ORDER decides
    which two roles are peeled off and which one is left behind -- see the
    loop below."""
    roles = list(role_index.keys())
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    produced = {}
    # The first two roles are peeled off first (separate() moves SELECTED
    # faces into a NEW object, leaving the rest behind) -- the third is
    # whatever remains in the original object afterward, never separated out
    # itself, so its vertex/face data is not duplicated-then-discarded like
    # the other two.
    for role in roles[:2]:
        want = role_index[role]
        bpy.ops.mesh.select_all(action="DESELECT")
        selected = 0
        for f in bm.faces:
            if f.material_index == want:
                f.select = True
                selected += 1
        if selected != counts[role]:
            raise SystemExit(
                f"{role}: selected {selected} face(s) by material_index, expected "
                f"{counts[role]} from the split's own count -- the persistent-tag "
                f"selection and the census have diverged"
            )
        bmesh.update_edit_mesh(obj.data)
        bpy.ops.mesh.separate(type="SELECTED")
        # The separated piece is the newest object in bpy.data.objects with
        # the expected base name (Blender suffixes it "<name>.001" etc.).
        new_obj = bpy.context.selected_objects[-1]
        # Re-enter edit mode on the ORIGINAL object for the next role's pass
        # -- separate() leaves the new piece active/selected, not the source.
        bpy.ops.object.mode_set(mode="OBJECT")
        new_obj.name = role
        new_obj.data.name = role
        produced[role] = new_obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bm = bmesh.from_edit_mesh(obj.data)
        bm.faces.ensure_lookup_table()

    bpy.ops.object.mode_set(mode="OBJECT")
    # Correctness check: every polygon still in `obj` must be tagged with the
    # THIRD role -- if either peel above missed a face (a material_index this
    # function never selected for either pass), it would silently ride along
    # in that third zone instead of raising, so check for it explicitly
    # rather than trust the arithmetic.
    last_role = roles[2]
    stray = sum(1 for p in obj.data.polygons if p.material_index != role_index[last_role])
    if stray:
        raise SystemExit(f"{last_role}: {stray} leftover polygon(s) not tagged {last_role!r} after both peels")
    obj.name = last_role
    obj.data.name = last_role
    produced[last_role] = obj
    return produced


def _tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def export_vfx(spec, out_path=None, dry_run=False):
    bpy.ops.wm.open_mainfile(filepath=spec.src)
    src = _find_single_mesh(spec.asset_id)
    src_verts = len(src.data.vertices)
    src.data.calc_loop_triangles()
    src_tris = len(src.data.loop_triangles)
    src_mats = len(src.data.materials)
    print(
        f"[{spec.asset_id}] source {src.name!r}: verts={src_verts} tris={src_tris} "
        f"materials={src_mats}"
    )

    _apply_modifiers_if_any(src)

    shift = _reorigin(src, spec.origin)
    print(f"[{spec.asset_id}] re-origin ({spec.origin}): shifted by {tuple(round(c, 4) for c in shift)}")

    role_index = _role_index(spec.roles)
    r0, r1, r2 = spec.roles
    if spec.split_origin == "height_z":
        counts, max_extent = _height_split(src, spec.core_frac, spec.mid_frac, role_index)
        print(
            f"[{spec.asset_id}] height split along local Z from 0 (the re-origined base): "
            f"max_z={max_extent:.4f}  {r0}<= {spec.core_frac * max_extent:.4f}  "
            f"{r1}<= {spec.mid_frac * max_extent:.4f}  poly counts {r0}={counts[r0]} "
            f"{r1}={counts[r1]} {r2}={counts[r2]} total={sum(counts.values())}"
        )
    else:
        split_origin = _split_origin_point(src, spec.split_origin)
        counts, max_extent = _radial_split(src, split_origin, spec.core_frac, spec.mid_frac, role_index)
        print(
            f"[{spec.asset_id}] radial split from {spec.split_origin} "
            f"{tuple(round(c, 4) for c in split_origin)}: max_r={max_extent:.4f}  "
            f"{r0}<= {spec.core_frac * max_extent:.4f}  {r1}<= {spec.mid_frac * max_extent:.4f}  "
            f"poly counts {r0}={counts[r0]} {r1}={counts[r1]} "
            f"{r2}={counts[r2]} total={sum(counts.values())}"
        )
    if any(counts[r] == 0 for r in spec.roles):
        raise SystemExit(f"{spec.asset_id}: at least one zone got zero polygons -- degenerate split, do not export")

    if dry_run:
        print(f"[{spec.asset_id}] --dry-run: stopping before separate/export")
        return None

    zones = _separate_by_role(src, counts, role_index)
    total_tris = 0
    for role in spec.roles:
        ob = zones[role]
        ob["rl_role"] = role
        ob.data.materials.clear()
        ntris = _tri_count(ob)
        total_tris += ntris
        print(f"[{spec.asset_id}] zone {role!r}: verts={len(ob.data.vertices)} tris={ntris}")
    print(f"[{spec.asset_id}] total exported tris={total_tris} (source had {src_tris})")

    os.makedirs(OUT_DIR, exist_ok=True)
    path = out_path or os.path.join(OUT_DIR, f"{spec.asset_id}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for role in spec.roles:
        zones[role].select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=spec.credit,
    )
    size = os.path.getsize(path)
    print(f"[{spec.asset_id}] wrote {path} ({size} bytes)")
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    dry_run = "--dry-run" in argv
    names = [a for a in argv if not a.startswith("--")]
    if not names:
        raise SystemExit(f"usage: blender -b -P tools/export_mesh_vfx.py -- <asset_id> [--dry-run]; have {sorted(SPECS)}")
    for name in names:
        if name not in SPECS:
            raise SystemExit(f"no VfxMeshSpec for {name!r}; have {sorted(SPECS)}")
        export_vfx(SPECS[name], dry_run=dry_run)


if __name__ == "__main__":
    main()
