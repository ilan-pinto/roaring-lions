"""Rebuild the seven `art/meshes/props/*.glb` from the lead-approved Meshy
REMESHED models, replacing the collapsed decimations of commit 93bafd30
(Task 3c's own predecessor). Ground plan 2, Task 3c: "Use these" (lead,
2026-09-27), superseding Task 3b's preview-mode sources.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/terrain/export_meshy_props.py

    # --only jersey_barrier,wrecked_car restricts export() to a subset, the
    # same convention every export_meshy_*.py script in this tree uses.

Writes 7 GLBs to `art/meshes/props/<kind>.glb` for `kind` in `PROP_KINDS`
(`packages/render/src/three/terrain/prop-role.ts`), keeping the exact
contract Task 3 built: zero materials/images/textures, every mesh node
tagged `extras.rl_role` from the closed set `PROP_ROLES`, triangle count
under that kind's own `PROP_TRI_CAPS`, height <= 1.7 m.

## SOURCES

`art/meshy/<kind-with-dashes>-20260927-<task-id>/model.glb`, one task per
kind, each a REMESH of the Task 3b preview the lead reviewed on the same
day (`art/meshy/ledger.jsonl`, `kind: "remesh"` entries keyed by `name`).
`_remesh_task_id`/`_source_path` resolve the directory from the ledger's
task id rather than a glob, because each kind's `art/meshy/` prefix now
matches TWO directories -- the original preview and the remesh -- and only
the ledger says which is current. Every one of the seven remeshed sources
was inspected before this script was written: each still carries exactly
one mesh, one node, zero materials, zero images, zero textures in the GLB
JSON itself (a `texture_0_normal.png` sits beside `model.glb` from the
remesh job but is not referenced by it -- the prop contract strips
materials anyway, so it would not matter if it were). Unlike the Task 3b
previews, six of the seven remeshed sources arrive already AT OR UNDER
their `PROP_TRI_CAPS` (see "DECIMATION"). Per `docs/ASSET_PROVENANCE.md`'s
own precedent for every other Meshy source in this tree
(`export_meshy_decor.py`'s `SRC_DIR`, `export_meshy_camp.py`'s), Meshy
SOURCE files are not committed to git -- only the exported GLB is.
`art/meshy/` therefore stays untracked here exactly as `art/blend/` stays
gitignored for every other Meshy pipeline in this repo; the ledger and task
ids are the provenance record, carried into `docs/ASSET_PROVENANCE.md`.

## WHY A SEPARATE SCRIPT FROM props.py, NOT A REWRITE OF IT

`tools/terrain/props.py` (Task 3) is a from-primitives builder: it never
imports a mesh, so it has no import/decimate/re-orient/re-scale pipeline at
all. This script is the opposite shape -- import a foreign mesh, normalise
it to the contract -- so nothing in `props.py` overlaps with what this file
does; it only reuses `export_meshy_decor.py`'s `_finalize_and_export`,
`_decimate`, `_strip`, `_extent` and `_bake_scale_and_ground`, the same
functions `props.py` itself reuses one of (`_finalize_and_export`) rather
than duplicating. `props.py` is left as-is (and its own GLBs are the
fallback this script's docstring names, should a future review send a kind
back to Blender-only per D7).

## ROLE -- one per kind, because a Meshy preview ships one undivided mesh

Every source is a single `mesh_node` with no material and no per-object
part-segmentation the way `export_meshy_decor.py`'s bush source has, so
there is no signal to split trunk-from-foliage the way that file's `bush`/
`tree` paths do. Task 3's own kit had the identical situation for its single
-role kinds (`jersey_barrier`, `water_tank`, `satellite_dish`) and answered
it the same way `export_meshy_decor.py`'s `grass`/`sand`/`rock`/`slab`
single-`mesh_node` families do: one role for the whole object, picked for
the material that actually reads on screen.

    kind             role      why
    jersey_barrier   concrete  cast concrete, no other material present
    water_tank       metal     a metal tank and its metal stand
    satellite_dish   metal     a metal dish, bracket and pole
    laundry_line     cloth     the poles/rope are a sliver of the silhouette;
                                the hanging garments are what a player reads
    tyre_pile        rubber    a stack of tyres, no other material present
    rebar            rust      the exposed rusty rods are the visible
                                identity; the concrete stub beneath is a
                                small fraction of the shape
    wrecked_car      metal     a burnt-out shell -- the paint/rubber detail a
                                textured car would carry is gone in a low-
                                poly preview anyway

## ORIENTATION -- a closed-form horizontal PCA, not a guess per kind

Meshy's own generation frame has no promised relationship to the contract's
"+X the long axis" convention (Task 3's own brief states it for the
barrier; this script applies it uniformly). Rather than eyeball a rotation
per kind, `_align_horizontal` computes the principal axis of the mesh's
own horizontal (X, Y) footprint from its 2x2 covariance matrix (closed
form: `angle = 0.5 * atan2(2*cov_xy, cov_xx - cov_yy)`) and rotates the
object about Z so that axis lands on +X. This is applied to every kind with
a real horizontal long axis (`ALIGN_HORIZONTAL` below); the roughly
rotation-symmetric kinds (tank, dish, tyre pile, rebar) are left alone --
PCA on a near-circular footprint is not reliably defined and buys nothing.
Deterministic: covariance and `atan2` are exact arithmetic on the source's
own vertex data, no `mathutils.noise` anywhere in this file.

## SCALE -- judged real-world size, clamped so nothing crosses 1.7 m

`PROP_TARGET` gives each kind a judged real-world size and the axis it is
measured on (`dimetric.metres_per_unit`'s own convention: a standing/
vertical form is declared by height, a long form by its longest axis).
Because a Meshy preview's own proportions are not guaranteed -- a car
generated slightly off-axis can read wider than it is long in its raw
bounding box -- `_calibrate` always ALSO checks the resulting height against
`HEIGHT_CAP_M` (1.65 m, a margin inside the contract's 1.7 m) and shrinks
the scale further if the length/footprint-calibrated size would break it.
This makes the height ceiling a hard invariant of the script rather than a
per-kind judgement call that could be measured wrong.

## DECIMATION -- the remesh sources need little or none

Measured 2026-09-27 against the remeshed sources: `jersey_barrier` (101),
`satellite_dish` (154), `laundry_line` (156), `rebar` (87) and `wrecked_car`
(353) all arrive AT OR UNDER their own `PROP_TRI_CAPS` (120/180/160/140/400)
and ship untouched -- no decimation call at all. Only `water_tank` (226 vs
220) and `tyre_pile` (272 vs 260) are over, each by a single-digit
percentage. `_decimate_to_cap` (this file, not `export_meshy_decor.py`'s
`_decimate`) handles both cases: it is a no-op when already at/under cap,
and otherwise applies the smallest deterministic trim -- one direct
`DECIMATE`/`COLLAPSE` modifier at `ratio = tri_cap / before`, applied, plus
the same bmesh loose-vertex cleanup `_decor._decimate` uses so glTF's own
face-less-vertex drop cannot silently undercount the shipped extent -- with
extra passes only as a safety net if that single pass overshoots.
`export_meshy_decor.py`'s own `_decimate` (escalating merge-by-distance) is
built for the opposite problem -- raw scans at 2,000-25,000+ triangles, far
denser than anything a single COLLAPSE ratio can reliably reach in one
step -- and is deliberately NOT reused here: these sources have no such
distance to close, and running that heavier pipeline on a mesh already this
close to its cap would risk over-simplifying a shape with little slack left
to give, for no benefit.

## DETERMINISM

Nothing in this file calls `mathutils.noise`. The only per-object
randomness anywhere in the whole pipeline (`_decimate_to_cap`'s COLLAPSE
passes, `_align_horizontal`'s PCA) is exact arithmetic on the source's own
fixed vertex data -- same input file, same floats, every run.
Export-twice-and-md5 is the falsification in the task report, not repeated
here.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import export_meshy_decor as _decor  # noqa: E402
from dimetric import metres_per_unit  # noqa: E402
from props import PROP_KINDS, PROP_ROLES  # noqa: E402  -- canonical vocabulary, not redefined here

REPO = os.path.dirname(TOOLS)
MESHY_DIR = os.path.join(REPO, "art", "meshy")

_decor.DECOR_ROLES = frozenset(PROP_ROLES)  # see props.py's own precedent

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "props")

if "--only" in _argv:
    ONLY_KINDS = set(_argv[_argv.index("--only") + 1].split(","))
else:
    ONLY_KINDS = None

CREDIT = (
    "Small ground props (jersey barrier, water tank, satellite dish, "
    "laundry line, tyre pile, rebar, wrecked car) -- AI-generated (Meshy "
    "text-to-3D, remesh mode), disclosed per CONTRIBUTING.md; decimated, "
    "re-scaled and role-tagged for Roaring Lions"
)

# `PROP_TRI_CAPS` from packages/render/src/three/terrain/prop-role.ts,
# mirrored the same way every Python side of this contract mirrors its TS
# counterpart by hand (props.py's own PROP_ROLES comment gives the reason).
PROP_TRI_CAPS = {
    "jersey_barrier": 120,
    "water_tank": 220,
    "satellite_dish": 180,
    "laundry_line": 160,
    "tyre_pile": 260,
    "rebar": 140,
    "wrecked_car": 400,
}

# kind -> (role, target size in metres, calibration axis). See module
# docstring "ROLE" and "SCALE".
PROP_TARGET = {
    "jersey_barrier": ("concrete", 1.80, "longest"),
    "water_tank": ("metal", 1.65, "z"),
    "satellite_dish": ("metal", 1.00, "z"),
    "laundry_line": ("cloth", 1.60, "z"),
    "tyre_pile": ("rubber", 0.80, "z"),
    "rebar": ("rust", 0.90, "z"),
    "wrecked_car": ("metal", 3.60, "longest"),
}

# Kinds with a real horizontal long axis worth aligning to +X. See module
# docstring "ORIENTATION".
ALIGN_HORIZONTAL = {"jersey_barrier", "laundry_line", "wrecked_car"}

HEIGHT_CAP_M = 1.65  # margin inside the contract's 1.7 m -- see "SCALE"


def _clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def _remesh_task_id(kind):
    """Look up the REMESH task id for `kind` from `art/meshy/ledger.jsonl` --
    the ledger, not a glob, is the source of truth for which of the two
    directories under each kind's prefix (the original preview, and the
    2026-09-27 remesh the lead approved with "Use these") is current. A
    glob over `{prefix}-20260927-*` matches both and cannot disambiguate."""
    ledger_path = os.path.join(MESHY_DIR, "ledger.jsonl")
    with open(ledger_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if entry.get("kind") == "remesh" and entry.get("name") == kind:
                return entry["id"]
    raise SystemExit(f"[{kind}] no kind=remesh entry for name={kind!r} in {ledger_path}")


def _source_path(kind):
    prefix = kind.replace("_", "-")
    task_id = _remesh_task_id(kind)
    short_id = task_id.split("-")[0]
    path = os.path.join(MESHY_DIR, f"{prefix}-20260927-{short_id}", "model.glb")
    if not os.path.isfile(path):
        raise SystemExit(f"[{kind}] expected remesh source at {path} (ledger task "
                          f"{task_id}), not found")
    return path


def _align_horizontal(ob, label):
    """Rotate `ob` about Z so its horizontal (X, Y) footprint's principal
    axis lands on +X. Closed-form 2x2 PCA -- see module docstring
    "ORIENTATION". Mutates vertex data directly and applies immediately, so
    every later measurement (decimation, extent, calibration) sees the
    aligned frame."""
    verts = ob.data.vertices
    n = len(verts)
    mx = sum(v.co.x for v in verts) / n
    my = sum(v.co.y for v in verts) / n
    cov_xx = sum((v.co.x - mx) ** 2 for v in verts) / n
    cov_yy = sum((v.co.y - my) ** 2 for v in verts) / n
    cov_xy = sum((v.co.x - mx) * (v.co.y - my) for v in verts) / n
    angle = 0.5 * math.atan2(2.0 * cov_xy, cov_xx - cov_yy)
    rot = Matrix.Rotation(-angle, 3, "Z")
    for v in verts:
        v.co = rot @ v.co
    ob.data.update()
    print(f"[{label}] aligned horizontal footprint by {-math.degrees(angle):+.2f} deg about Z")


def _decimate_to_cap(ob, tri_cap, label):
    """The 2026-09-27 remesh sources arrive AT OR NEAR each kind's own
    `PROP_TRI_CAPS` already (101-353 tris against caps of 120-400), not the
    2,000-25,000-triangle raw scans `export_meshy_decor.py`'s `_decimate`
    was built for (see that function's own docstring on why a single
    threshold cannot reach an arbitrary target on a mesh THAT dense). Running
    the heavy merge-escalation pipeline on a mesh already this small is both
    unnecessary and liable to over-simplify a shape that has no slack left to
    give -- so a kind already at or under its cap is shipped untouched, and a
    kind over its cap (measured 2026-09-27: `water_tank` 226 vs 220,
    `tyre_pile` 272 vs 260, both single-digit-percent over) gets the
    smallest deterministic trim: one direct COLLAPSE modifier at
    `ratio = tri_cap / before`, applied, with the same face-less-vertex
    cleanup `_decor._decimate` itself uses so glTF's own face-less-vertex
    drop cannot silently undercount the shipped extent. Extra passes only
    run if that single pass overshoots (COLLAPSE's ratio is approximate on a
    mesh this small), so the guard below is a safety net, not the intended
    path."""
    before0 = len(ob.data.polygons)
    if before0 <= tri_cap:
        print(f"[{label}] {before0} tris already at/under cap {tri_cap} -- "
              f"shipped untouched, no decimation")
        return
    guard = 0
    while len(ob.data.polygons) > tri_cap:
        guard += 1
        if guard > 10:
            raise SystemExit(f"[{label}] could not decimate under {tri_cap} tris "
                              f"after {guard} extra COLLAPSE passes -- stuck at "
                              f"{len(ob.data.polygons)}; do not loosen the cap, report instead")
        before = len(ob.data.polygons)
        ratio = tri_cap / before
        mod = ob.modifiers.new(f"cap_decimate_{guard}", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        faceless = [v for v in bm.verts if len(v.link_faces) == 0]
        bmesh.ops.delete(bm, geom=faceless, context="VERTS")
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
        print(f"[{label}] trim pass {guard}: ratio={ratio:.5f} {before} -> "
              f"{len(ob.data.polygons)} tris")


def _calibrate(ob, target, axis, label):
    """mpu that hits `target` on `axis` (dimetric.metres_per_unit's own
    convention), clamped so the resulting height never exceeds
    `HEIGHT_CAP_M`. See module docstring "SCALE"."""
    ext = _decor._extent([ob], axis=None if axis == "longest" else axis)
    mpu = metres_per_unit(ext, target)
    raw_h = _decor._extent([ob], axis="z")
    capped = raw_h * mpu > HEIGHT_CAP_M
    if capped:
        mpu = HEIGHT_CAP_M / raw_h
    print(f"[{label}] calibrate axis={axis} target={target:.3f} extent={ext:.4f} "
          f"-> mpu={mpu:.5f}{' (height-capped)' if capped else ''}, "
          f"resulting height={raw_h * mpu:.4f} m")
    return mpu


def export_one(kind):
    role, target, axis = PROP_TARGET[kind]
    tri_cap = PROP_TRI_CAPS[kind]
    src = _source_path(kind)
    _clear_scene()
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"[{kind}] expected exactly one mesh object from {src}, "
                          f"found {[o.name for o in meshes]}")
    ob = meshes[0]
    ob.name = kind
    if ob.data.materials or ob.data.color_attributes:
        raise SystemExit(f"[{kind}] source unexpectedly carries a material or "
                          f"vertex colour -- remesh-source inspection found none; "
                          f"re-check the source")

    if kind in ALIGN_HORIZONTAL:
        _align_horizontal(ob, kind)

    _decimate_to_cap(ob, tri_cap, kind)
    _decor._strip(ob)

    mpu = _calibrate(ob, target, axis, kind)
    _decor._bake_scale_and_ground([ob], mpu, kind)

    out_path = os.path.join(OUT_DIR, f"{kind}.glb")
    return _decor._finalize_and_export({role: ob}, out_path, kind)


def export():
    summary = {}
    for kind in PROP_KINDS:
        if ONLY_KINDS is not None and kind not in ONLY_KINDS:
            continue
        size, verts, polys, roles = export_one(kind)
        summary[kind] = {"bytes": size, "verts": verts, "polys": polys, "roles": roles}
    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
