"""Export the Meshy-generated Eitan APC as a textured hull + kit RWS glTF,
mesh contract v2 -- batch B0a of GH-286 (`docs/art/style-bible.md` section 6,
`docs/art/meshy-prompts-units.md` section 5).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_eitan.py

Writes `art/meshes/vehicles/apc_eitan.glb`, replacing the kit-built hull
(`tools/export_mesh_vehicle.py`, 63,492 tris) with a 7,951-tri Meshy remesh
carrying its own base_color bake. `SPECS["apc_eitan"].mesh_owner` in
`export_mesh_vehicle.py` names this script, so `export_mesh_vehicle.py -- all`
refuses to regenerate the kit hull over it (the `dozer_d9` incident recorded
in `tools/mesh_ownership.py`). Re-run `pnpm wreck:meshes -- --id=apc_eitan`
after this script: the export carries no `death_root`.

SOURCE. One Meshy text-to-3D preview (meshy-6), refined with a 2k texture,
then remeshed by Meshy at 8,000 triangles -- the numbers table's proposal for
a wheeled APC (`style-bible.md` section 3 has no heavy-vehicle row; eight
wheels need more than the light 5,000, and `mbt_lavi` ships at 8,346). Looked
up from `art/meshy/ledger.jsonl` by name, as `export_meshy_props.py` does.
AI-generated (Meshy), disclosed per CONTRIBUTING.md; task ids in
`docs/ASSET_PROVENANCE.md`.

  preview 01a0f26e-3308-73bd-96b5-3cc85edcadfd
  refine  01a0f26f-63b4-77e3-88b8-cfc19c47b0d5   (2k)
  remesh  01a0f272-a1ff-72dd-b418-2d1f4c099595   (7,951 tris, textured)

THE BIBLE'S OPEN QUESTION IS ANSWERED HERE: a remesh of a REFINED task keeps
its texture. Measured 2026-09-30 on this remesh's own bytes -- one
`BakedMaterial` with `baseColorTexture` (2048), `normalTexture` (2048) and
`metallicRoughnessTexture` (4096), re-baked onto the remesh's fresh
`TEXCOORD_0`. So the step order in section 4 (refine, THEN remesh) stands and
no `retexture` fallback was needed; the Eitan cost the planned 35 credits.

SCALE. `EITAN_HULL/manifest.json`'s `realMetres` (7.129) over the remesh's
longest axis, read at export time so the mesh and the sprite it stands beside
cannot drift -- the same rule `export_mesh_vehicle.py` applies. Size class
`heavy_vehicle` is x1.0, so nothing else is applied.

ORIENTATION, measured (2026-09-30, on the remesh): long axis X; the roof
profile is LOW at -X (the raked glacis, z max 0.03 over the first 0.2 units)
and steps up toward +X (0.21-0.23 over the rear two thirds), so the nose is
-X and the hull takes a 180-degree Z rotation. Origin at the ground centre of
the footprint (contract v2), wheels on z = 0.

TWO CUTS, both recorded rather than hidden. The prompt asked for "a small
empty round mounting ring on the roof with no weapon fitted"; the preview
delivered the ring AND a small cannon on the front deck (a thin tube along the
centreline, x -0.72..-0.50, z 0.11..0.16, |y| < 0.03, on a mount at
x -0.49) and a whip antenna at the rear. The 8,000-tri remesh dropped the
antenna on its own (z max 0.538 -> 0.232). The cannon is removed here -- the
RWS below is this unit's weapon (`rws_50`), and a second gun on the glacis
would read as an IFV -- by deleting every face whose centroid sits in that
box and filling only the loop those deletions opened (`_cut_gun`). The
remesh's UV seams split vertices, so a blanket `holes_fill` would try to fill
every seam; `_cut_gun` passes it only the edges that BECAME boundary.

ROLES. Two textured hull meshes and two palette RWS meshes:

  hull_rubber   the eight tyres -- every face whose centroid lies within
                `WHEEL_R` of an axle in the XZ plane and outboard of
                `WHEEL_AY`. The axles are found from the tyre verts
                themselves (`_axles`: the four clusters of |y| > 0.28,
                z < zmin + 0.24 verts along x); the radius comes from the
                radial histogram around them (tread mass at r 0.14-0.20,
                an EMPTY band at 0.20-0.22 -- the wheel-arch clearance -- then
                the skirt), the same signal `export_meshy_truck.py` used.
                `rubber` matters for the wreck pass: `DROP_ROLES` settles
                everything but the wheels.
  hull_hull     the rest of the remesh, texture and all.
  turret_metal  `kit.rws`'s mount and barrel, joined by role
  turret_plate  `kit.rws`'s gun shield

  turret_pivot  an empty carrying `extras.rl_pivot = "turret"` at the RING --
                the octagonal lip at (-0.67, +0.48) m on the roof, ~0.78 m
                across, read off a top-down grid render and refined to the
                lip's own centroid and top by `_ring_centre` (which refuses
                if the lip is not where the seed says). The lead's ruling
                (PR #290) is `kit.rws` on the empty ring and `turret_pivot`
                only -- no wheel pivots.

TEXTURE. The remesh's images arrive named `texture_0` / `normal` /
`texture_0_metallic_roughness`; `textured.prepare_vehicle_textures` looks for
`base_color` by prefix, so the base colour is renamed after checking it is
the image wired to the Principled BSDF's Base Color socket (not renamed by
position in a list). All three ship at `textured.TEXTURE_PX` (2048) -- the
lead: "dont drop resolution". The RWS parts carry no material: the runtime's
textured branch is per MESH, so they draw through `VEHICLE_ROLE_PALETTE
["apc_eitan"]`'s `metal`/`plate` slices, and `pnpm validate:meshes` repaints
the whole vehicle from the palette anyway.

DETERMINISM. No `mathutils.noise`; every threshold is a constant applied to
the source's own vertex data.
"""
import glob
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

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402
import textured as vehicle_textured  # noqa: E402

REPO = os.path.dirname(TOOLS)
MESHY_DIR = os.path.join(REPO, "art", "meshy")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "apc_eitan.glb")
UNIT_ID = "apc_eitan"
MANIFEST = os.path.join(REPO, "assets", "sprites", "EITAN_HULL", "manifest.json")
CREDIT = (
    "Eitan 8x8 APC -- AI-generated (Meshy text-to-3D preview + 2k refine + remesh), "
    "disclosed per CONTRIBUTING.md; re-oriented, re-scaled, wheel/hull split and fitted "
    "with a kit remote weapon station for Roaring Lions"
)
TURRET_PIVOT_NODE = "turret_pivot"

#: Wheel fit, SOURCE frame (pre-rotation, pre-scale), from the radial histogram
#: around each axle (module docstring, ROLES). `WHEEL_R` sits in the empty
#: arch band; `WHEEL_AY` keeps the underbody inside the same disc out of it.
WHEEL_R = 0.205
WHEEL_AY = 0.27
#: Tyre verts for the axle search: outboard, and only the CONTACT band -- the
#: lowest 0.08 of the tread. Adjacent wheels touch here (axle spacing 0.40
#: against a 0.41 wheel diameter), so a gap-based clustering of the whole
#: tread merges three of the four; the contact patches never overlap in x.
TYRE_AY, TYRE_Z_BAND = 0.28, 0.08
#: Axle seeds, source frame, read off the vertex-count peaks of the wheel
#: band along x (2026-09-30); each is refined to its own contact patch's
#: centroid and must find `AXLE_MIN_VERTS` there.
AXLE_SEEDS_X = (-0.62, -0.22, 0.18, 0.52)
AXLE_HALF_WINDOW = 0.13
AXLE_MIN_VERTS = 40
#: The gun's box, source frame -- see the module docstring.
GUN_X_MAX, GUN_Z_MIN, GUN_AY = -0.49, 0.09, 0.05
#: `kit.rws` numbers, metres -- `author_eitan.py`'s own RWS and RWS_AT sizes.
RWS_SIZE = (0.9, 0.7, 0.45)
RWS_BARREL = 0.95
#: The ring, final frame, metres -- see `_ring_centre`.
RING_SEED_M = (-0.67, 0.48)
RING_SEARCH_R_M = 0.5
RING_BAND_M = 0.03
RING_MAX_ACROSS_M = 0.9
#: The bible's proposed shipped cap for a wheeled APC.
TRI_CAP = 10000


def _remesh_source(name):
    ledger = os.path.join(MESHY_DIR, "ledger.jsonl")
    with open(ledger) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if entry.get("kind") == "remesh" and entry.get("name") == name:
                task_id = entry["id"]
                slug = name.replace("_", "-")
                hits = glob.glob(os.path.join(MESHY_DIR, f"{slug}-*-{task_id.split('-')[0]}", "model.glb"))
                if len(hits) != 1:
                    raise SystemExit(f"[{name}] expected one download dir for remesh task {task_id}, found {hits}")
                return hits[0], task_id
    raise SystemExit(f"[{name}] no kind=remesh entry named {name!r} in {ledger}")


def _read_real_metres():
    with open(MANIFEST) as fh:
        return json.load(fh)["realMetres"]


def _rename_textures(ob):
    """`texture_0` -> `base_color` etc., checked against the node wiring."""
    mat = ob.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = next((l for l in mat.node_tree.links if l.to_node.name == bsdf.name and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE":
        raise SystemExit(f"[{UNIT_ID}] Base Color is not fed by an image texture -- source material changed shape")
    base = link.from_node.image
    base.name = vehicle_textured.BASE_COLOR_PREFIX
    for img in bpy.data.images:
        if img is base:
            continue
        if img.name.endswith("metallic_roughness"):
            img.name = "metallic_roughness"
    print(f"[{UNIT_ID}] images: {[(i.name, tuple(i.size)) for i in bpy.data.images]}")


def _cut_gun(ob):
    """Collapse the barrel onto its root rather than deleting and filling:
    every vertex forward of the mount face inside the gun box is merged to
    one point on that face (`pointmerge`), so the tube's faces degenerate
    away and the root ring's faces become a flat fan -- the mesh stays closed
    with no hole to fill. Deleting the faces was tried first and left a loop
    that never closed, because the remesh's UV seams split its vertices."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    gun = [v for v in bm.verts if v.co.x < GUN_X_MAX - 0.005 and v.co.z > GUN_Z_MIN and abs(v.co.y) < GUN_AY]
    if len(gun) < 8:
        raise SystemExit(f"[{UNIT_ID}] only {len(gun)} verts in the gun box -- re-measure GUN_* against this source")
    zc = sum(v.co.z for v in gun) / len(gun)
    before = len(bm.faces)
    bmesh.ops.pointmerge(bm, verts=gun, merge_co=(GUN_X_MAX, 0.0, zc))
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    open_left = sum(1 for e in bm.edges if e.is_boundary and abs(e.verts[0].co.y) < GUN_AY * 2
                    and GUN_X_MAX - 0.05 < e.verts[0].co.x < GUN_X_MAX + 0.05 and e.verts[0].co.z > GUN_Z_MIN)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{UNIT_ID}] gun collapsed: {len(gun)} verts merged, {before} -> {len(ob.data.polygons)} faces, "
          f"{open_left} boundary edges left near the root (seams count here; 0 is not required)")


def _axles(ob):
    """Four axle (x, z) pairs, source frame, from the tyre verts."""
    zmin = min(v.co.z for v in ob.data.vertices)
    contact = [v.co.x for v in ob.data.vertices if abs(v.co.y) > TYRE_AY and v.co.z < zmin + TYRE_Z_BAND]
    axles = []
    for seed in AXLE_SEEDS_X:
        xs = [x for x in contact if abs(x - seed) < AXLE_HALF_WINDOW]
        if len(xs) < AXLE_MIN_VERTS:
            raise SystemExit(f"[{UNIT_ID}] only {len(xs)} contact-patch verts within {AXLE_HALF_WINDOW} of "
                             f"axle seed {seed:+.2f} -- re-measure AXLE_SEEDS_X against this source")
        axles.append((sum(xs) / len(xs), zmin + WHEEL_R))
    print(f"[{UNIT_ID}] axles (x, z): {[(round(x, 3), round(z, 3)) for x, z in axles]}")
    return axles


def _split_wheels(ob, axles):
    """Duplicate `ob` into `hull_rubber` (tyre faces) and `hull_hull` (the
    rest) by deleting the complementary faces in each copy -- keeps UVs and
    the material on both."""
    def is_tyre(c):
        return abs(c.y) > WHEEL_AY and any(math.hypot(c.x - ax, c.z - az) < WHEEL_R for ax, az in axles)

    parts = {}
    for role, keep in (("rubber", True), ("hull", False)):
        copy = ob.copy()
        copy.data = ob.data.copy()
        copy.name = copy.data.name = f"hull_{role}"
        bpy.context.collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        doomed = [f for f in bm.faces if is_tyre(f.calc_center_median()) != keep]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(copy.data)
        bm.free()
        copy.data.update()
        copy["rl_role"] = role
        parts[role] = copy
        print(f"[{UNIT_ID}] hull_{role}: {len(copy.data.polygons)} faces")
    bpy.data.objects.remove(ob, do_unlink=True)
    return parts


def _bake(objs, matrix):
    for ob in objs:
        for v in ob.data.vertices:
            v.co = matrix @ v.co
        ob.data.update()


def _bounds(objs):
    pts = [v.co for ob in objs for v in ob.data.vertices]
    return (Vector([min(p[i] for p in pts) for i in range(3)]),
            Vector([max(p[i] for p in pts) for i in range(3)]))


def _ring_centre(hull):
    """The ring, in the FINAL frame (metres, +X forward, ground at z = 0).

    Seeded, not searched: `RING_SEED_M` was read off a top-down orthographic
    render of the exported hull with a metre grid drawn over it (2026-09-30),
    where the ring is the one octagonal lip on the roof, ~0.78 m across. The
    first version of this function took "the highest 0.045 m of the roof",
    which is the RECTANGULAR hatch cover at (-0.44, -0.50) -- the ring's lip
    stands 0.02 m proud of the plateau, the hatch 0.10 m -- and put the RWS
    beside the ring. Within `RING_SEARCH_R_M` of the seed the lip is the
    highest thing, so the pivot is the centroid of the top `RING_BAND_M` of
    that neighbourhood and its z is the lip's own top."""
    near = [v.co for v in hull.data.vertices
            if math.hypot(v.co.x - RING_SEED_M[0], v.co.y - RING_SEED_M[1]) < RING_SEARCH_R_M and v.co.z > 2.0]
    zmax = max(p.z for p in near)
    lip = [p for p in near if p.z > zmax - RING_BAND_M]
    # Bounding-box centre, not centroid: the remesh puts its lip vertices
    # where the octagon's facets need them, not evenly around it, and the
    # centroid of that set sat 0.16 m off the octagon's true centre.
    x0, x1 = min(p.x for p in lip), max(p.x for p in lip)
    y0, y1 = min(p.y for p in lip), max(p.y for p in lip)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    across = max(x1 - x0, y1 - y0)
    print(f"[{UNIT_ID}] ring lip ({len(lip)} verts within {RING_SEARCH_R_M} m of seed {RING_SEED_M}): "
          f"bbox centre ({cx:+.3f}, {cy:+.3f}), top z {zmax:+.3f}, {across:.2f} m across")
    if math.hypot(cx - RING_SEED_M[0], cy - RING_SEED_M[1]) > 0.15 or across > RING_MAX_ACROSS_M:
        raise SystemExit(f"[{UNIT_ID}] ring lip does not sit where the seed says -- re-measure RING_SEED_M "
                         "from a top-down grid render of this source")
    return Vector((cx, cy, zmax))


def _rws_parts(pivot):
    """`kit.rws` at the pivot, joined by role into turret_metal/turret_plate."""
    raw = vehicle_kit.rws("rws", RWS_SIZE, (pivot.x, pivot.y, pivot.z), barrel_len=RWS_BARREL)
    by_role = {}
    for ob in raw:
        by_role.setdefault(ob["rl_role"], []).append(ob)
    out = {}
    for role, obs in by_role.items():
        bpy.ops.object.select_all(action="DESELECT")
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = joined.data.name = f"turret_{role}"
        joined["rl_role"] = role
        out[role] = joined
        print(f"[{UNIT_ID}] turret_{role}: {len(joined.data.polygons)} faces")
    return out


def export():
    src, task_id = _remesh_source(UNIT_ID)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1 or len(meshes[0].data.materials) != 1:
        raise SystemExit(f"[{UNIT_ID}] expected one textured mesh in {src}, found "
                         f"{[(o.name, len(o.data.materials)) for o in meshes]}")
    ob = meshes[0]
    print(f"[{UNIT_ID}] source {os.path.relpath(src, REPO)} (remesh task {task_id}): "
          f"{len(ob.data.polygons)} faces, images {[i.name for i in bpy.data.images]}")
    _rename_textures(ob)

    _cut_gun(ob)
    axles = _axles(ob)
    parts = _split_wheels(ob, axles)
    objs = list(parts.values())

    _bake(objs, Matrix.Rotation(math.pi, 4, "Z"))
    mn, mx = _bounds(objs)
    real = _read_real_metres()
    mpu = metres_per_unit(mx.x - mn.x, real)
    _bake(objs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(objs)
    _bake(objs, Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))))
    mn, mx = _bounds(objs)
    print(f"[{UNIT_ID}] {real:.3f} m long (from {os.path.relpath(MANIFEST, REPO)}), mpu {mpu:.5f}; hull "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")

    pivot = _ring_centre(parts["hull"])
    turret = _rws_parts(pivot)
    pivot_obj = bpy.data.objects.new(TURRET_PIVOT_NODE, None)
    pivot_obj.empty_display_size = 0.05
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot
    inv = Matrix.Translation(-pivot)
    for t in turret.values():
        t.parent = pivot_obj
        t.matrix_parent_inverse = inv
    print(f"[{UNIT_ID}] {TURRET_PIVOT_NODE} at ({pivot.x:+.3f}, {pivot.y:+.3f}, {pivot.z:+.3f}) m")

    every = objs + list(turret.values())
    tris = sum(len(p.vertices) - 2 for o in every for p in o.data.polygons)
    if tris > TRI_CAP:
        raise SystemExit(f"[{UNIT_ID}] {tris} triangles over the cap {TRI_CAP}")
    mn, mx = _bounds(every)

    kept, dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{UNIT_ID}] image {name}: {before} -> {after}")
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(OUT_PATH, CREDIT))
    print(f"[{UNIT_ID}] wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes, {tris} tris, "
          f"bounds {tuple(round(c, 3) for c in (mx - mn))}, nodes {sorted(o.name for o in every)} + {TURRET_PIVOT_NODE})")


if __name__ == "__main__":
    export()
