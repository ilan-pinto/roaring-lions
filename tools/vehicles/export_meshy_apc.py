"""Export a Meshy-generated, remeshed, TEXTURED APC as hull + kit RWS glTF,
mesh contract v2 -- the one code path behind `export_meshy_eitan.py` and
`export_meshy_kipod.py` (GH-286, batch B0a and the lead's Kipod follow-up,
2026-09-30). Each wrapper carries its own history in its docstring; this
module carries the method, spec-driven so the second vehicle could not fork
the first's code and drift.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_apc.py -- apc_kipod [--no-rws]

`--no-rws` is the first pass on a NEW vehicle: it exports the hull alone so
the roof ring can be found on a top-down grid render of the exported frame
(`RING_SEED_M` in the spec is measured there, never guessed), and prints the
roof's highest bands to help.

THE METHOD, per vehicle (`ApcSpec`):
  1. Import the ledger's LAST `kind: remesh` task named `unit_id` -- the
     remesh of a REFINED task, which keeps its bake (measured on the Eitan:
     one `BakedMaterial`, base colour / normal / metallic-roughness re-baked
     onto fresh UVs).
  2. Rename the base-colour image to `base_color` after checking it is the
     one wired to the Principled BSDF's Base Color socket, so
     `textured.prepare_vehicle_textures` finds it; metallic-roughness likewise.
  3. Collapse any unasked-for gun (`gun`): every vertex forward of the mount
     face inside the box is `pointmerge`d to one point on that face, so the
     tube degenerates away and the root ring's faces become a flat fan --
     the mesh stays closed and nothing needs filling (deleting and filling
     was tried first on the Eitan and left a loop that never closed, because
     the remesh's UV seams split its vertices). `None` when the remesh
     dropped the gun by itself, as it drops every thin whip antenna.
  4. Split the tyres out as `hull_rubber`: every face whose centroid sits
     within `wheel_r` of an axle in the XZ plane, outboard of `wheel_ay`, and
     no higher than the axle plus 0.95 wheel_r (keeps a low-hanging skirt or
     screen out of the disc). Axles are the contact-patch centroids around
     `axle_seeds_x` (adjacent wheels touch, so a gap-based clustering of the
     whole tread merges them; the lowest 0.08 of the tread never overlaps).
     `rubber` is what the wreck pass leaves on the ground while the body drops.
  5. Rz(180) when the nose measures -X (both APCs so far: the glacis is the
     low end of the roof profile), scale the longest axis to the sprite
     manifest's `realMetres` (read, never typed), ground at z = 0, footprint
     centred on the origin.
  6. `turret_pivot` (`extras.rl_pivot = "turret"`) at the roof ring: the
     bounding-box centre and top of the highest `ring_band_m` within
     `ring_search_r_m` of `ring_seed_m` (final frame, metres), refusing if
     the lip is not where the seed says or is too wide to be a ring. The
     kit's `rws` (`tools/vehicles/kit.py`, barrel along +x since the B0a fix)
     is built there and joined by role into `turret_metal` / `turret_plate`,
     both without material -- the runtime's textured branch is per MESH.
  7. Textures at `textured.TEXTURE_PX`; export through
     `textured.gltf_kwargs`. Re-run `pnpm wreck:meshes -- --id=<unit>` after.

DETERMINISM. No `mathutils.noise`; every threshold is a constant applied to
the source's own vertex data. Re-exporting the Eitan through this module
reproduces the GLB `export_meshy_eitan.py` shipped byte-for-byte (checked
2026-09-30 when the code moved here).
"""
import glob
import json
import math
import os
import sys
from dataclasses import dataclass
from typing import Optional

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
TURRET_PIVOT_NODE = "turret_pivot"


@dataclass(frozen=True)
class ApcSpec:
    unit_id: str
    sheet: str                      # assets/sprites/<sheet>/manifest.json, realMetres
    credit: str
    wheel_r: float                  # SOURCE frame: tyre radius, in the arch gap
    wheel_ay: float                 # SOURCE frame: inboard limit of a tyre
    axle_seeds_x: tuple             # SOURCE frame: contact-patch seeds
    rws_size: tuple                 # metres, kit.rws
    rws_barrel: float               # metres
    ring_seed_m: Optional[tuple]    # FINAL frame (x, y) metres; None = --no-rws pass
    gun: Optional[tuple] = None     # SOURCE frame (x_max, z_min, |y| max) or None
    tyre_ay: float = 0.28
    tyre_z_band: float = 0.08
    axle_half_window: float = 0.13
    axle_min_verts: int = 40
    ring_search_r_m: float = 0.5
    ring_band_m: float = 0.03
    ring_max_across_m: float = 0.9
    tri_cap: int = 10000
    rot_z_deg: float = 180.0


SPECS = {
    # Eitan numbers as measured for the B0a export (see export_meshy_eitan.py).
    "apc_eitan": ApcSpec(
        unit_id="apc_eitan",
        sheet="EITAN_HULL",
        credit=(
            "Eitan 8x8 APC -- AI-generated (Meshy text-to-3D preview + 2k refine + remesh), "
            "disclosed per CONTRIBUTING.md; re-oriented, re-scaled, wheel/hull split and fitted "
            "with a kit remote weapon station for Roaring Lions"
        ),
        wheel_r=0.205,
        wheel_ay=0.27,
        axle_seeds_x=(-0.62, -0.22, 0.18, 0.52),
        rws_size=(0.9, 0.7, 0.45),
        rws_barrel=0.95,
        ring_seed_m=(-0.67, 0.48),
        gun=(-0.49, 0.09, 0.05),
    ),
    # Kipod numbers, measured 2026-09-30 on its 7,9xx-tri remesh: glacis at
    # -X (roof profile 0.036 there, 0.27-0.45 aft), three contact-patch
    # clusters at x -0.608 / -0.036 / +0.510, tread mass peaking at r
    # 0.18-0.20 with the arch beyond 0.22, tyres at |y| 0.315-0.483 (the
    # proud screens sit at 0.45-0.49 above them, which the disc's z cap keeps
    # out). The preview's small front-roof gun is a 19-vertex stub a few
    # centimetres proud of the front roof at x -0.48 after the remesh, not a
    # barrel, so nothing is collapsed. RWS size and barrel are
    # author_apc_kipod.py's own numbers for the remote_mg mount.
    "apc_kipod": ApcSpec(
        unit_id="apc_kipod",
        sheet="KIPOD_HULL",
        credit=(
            "Kipod 6x6 screen carrier -- AI-generated (Meshy text-to-3D preview + 2k refine + "
            "remesh), disclosed per CONTRIBUTING.md; re-oriented, re-scaled, wheel/hull split "
            "and fitted with a kit remote weapon station for Roaring Lions"
        ),
        wheel_r=0.215,
        wheel_ay=0.30,
        tyre_ay=0.30,
        axle_seeds_x=(-0.61, -0.04, 0.51),
        rws_size=(0.85, 0.65, 0.42),
        rws_barrel=1.0,
        # The ring is BIG on this one -- the roof's top 3 cm is a 1.25 m
        # square band centred here (the --no-rws pass's own printout, and the
        # grid render agrees) -- so the "too wide to be a ring" guard is
        # raised to fit it.
        ring_seed_m=(-1.25, 0.0),
        ring_search_r_m=0.85,
        ring_max_across_m=1.4,
        gun=None,
    ),
}


def _remesh_source(name):
    ledger = os.path.join(MESHY_DIR, "ledger.jsonl")
    task_id = None
    with open(ledger) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if entry.get("kind") == "remesh" and entry.get("name") == name:
                task_id = entry["id"]  # append-only ledger: the last one is current
    if task_id is None:
        raise SystemExit(f"[{name}] no kind=remesh entry named {name!r} in {ledger}")
    slug = name.replace("_", "-")
    hits = glob.glob(os.path.join(MESHY_DIR, f"{slug}-*-{task_id.split('-')[0]}", "model.glb"))
    if len(hits) != 1:
        raise SystemExit(f"[{name}] expected one download dir for remesh task {task_id}, found {hits}")
    return hits[0], task_id


def _read_real_metres(spec):
    with open(os.path.join(REPO, "assets", "sprites", spec.sheet, "manifest.json")) as fh:
        return json.load(fh)["realMetres"]


def _rename_textures(spec, ob):
    mat = ob.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    # `.name` comparisons: bpy hands out a fresh RNA wrapper per access, so
    # `is` between two node references is not identity.
    link = next((l for l in mat.node_tree.links if l.to_node.name == bsdf.name and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE":
        raise SystemExit(f"[{spec.unit_id}] Base Color is not fed by an image texture -- source material changed shape")
    base = link.from_node.image
    base.name = vehicle_textured.BASE_COLOR_PREFIX
    for img in bpy.data.images:
        if img.name != base.name and img.name.endswith("metallic_roughness"):
            img.name = "metallic_roughness"
    print(f"[{spec.unit_id}] images: {[(i.name, tuple(i.size)) for i in bpy.data.images]}")


def _collapse_gun(spec, ob):
    x_max, z_min, ay = spec.gun
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    gun = [v for v in bm.verts if v.co.x < x_max - 0.005 and v.co.z > z_min and abs(v.co.y) < ay]
    if len(gun) < 8:
        raise SystemExit(f"[{spec.unit_id}] only {len(gun)} verts in the gun box -- re-measure `gun` against this source")
    zc = sum(v.co.z for v in gun) / len(gun)
    before = len(bm.faces)
    bmesh.ops.pointmerge(bm, verts=gun, merge_co=(x_max, 0.0, zc))
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{spec.unit_id}] gun collapsed: {len(gun)} verts merged, {before} -> {len(ob.data.polygons)} faces")


def _axles(spec, ob):
    zmin = min(v.co.z for v in ob.data.vertices)
    contact = [v.co.x for v in ob.data.vertices if abs(v.co.y) > spec.tyre_ay and v.co.z < zmin + spec.tyre_z_band]
    axles = []
    for seed in spec.axle_seeds_x:
        xs = [x for x in contact if abs(x - seed) < spec.axle_half_window]
        if len(xs) < spec.axle_min_verts:
            raise SystemExit(f"[{spec.unit_id}] only {len(xs)} contact-patch verts within {spec.axle_half_window} of "
                             f"axle seed {seed:+.2f} -- re-measure axle_seeds_x against this source")
        axles.append((sum(xs) / len(xs), zmin + spec.wheel_r))
    print(f"[{spec.unit_id}] axles (x, z): {[(round(x, 3), round(z, 3)) for x, z in axles]}")
    return axles


def _split_wheels(spec, ob, axles):
    def is_tyre(c):
        if abs(c.y) <= spec.wheel_ay:
            return False
        for ax, az in axles:
            if math.hypot(c.x - ax, c.z - az) < spec.wheel_r and c.z < az + spec.wheel_r * 0.95:
                return True
        return False

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
        print(f"[{spec.unit_id}] hull_{role}: {len(copy.data.polygons)} faces")
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


def _print_roof_bands(spec, hull):
    """For a `--no-rws` pass: where the roof's highest verts are, so a
    ring seed can be read off the grid render with numbers beside it."""
    zmax = max(v.co.z for v in hull.data.vertices)
    for i in range(6):
        lo = zmax - 0.03 * (i + 1)
        hi = zmax - 0.03 * i
        band = [v.co for v in hull.data.vertices if lo < v.co.z <= hi]
        if band:
            print(f"[{spec.unit_id}] roof band z {lo:+.3f}..{hi:+.3f}: {len(band)} verts "
                  f"x[{min(p.x for p in band):+.2f},{max(p.x for p in band):+.2f}] "
                  f"y[{min(p.y for p in band):+.2f},{max(p.y for p in band):+.2f}]")


def _ring_centre(spec, hull):
    sx, sy = spec.ring_seed_m
    near = [v.co for v in hull.data.vertices
            if math.hypot(v.co.x - sx, v.co.y - sy) < spec.ring_search_r_m and v.co.z > 2.0]
    zmax = max(p.z for p in near)
    lip = [p for p in near if p.z > zmax - spec.ring_band_m]
    x0, x1 = min(p.x for p in lip), max(p.x for p in lip)
    y0, y1 = min(p.y for p in lip), max(p.y for p in lip)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    across = max(x1 - x0, y1 - y0)
    print(f"[{spec.unit_id}] ring lip ({len(lip)} verts within {spec.ring_search_r_m} m of seed {spec.ring_seed_m}): "
          f"bbox centre ({cx:+.3f}, {cy:+.3f}), top z {zmax:+.3f}, {across:.2f} m across")
    if math.hypot(cx - sx, cy - sy) > 0.2 or across > spec.ring_max_across_m:
        raise SystemExit(f"[{spec.unit_id}] ring lip does not sit where the seed says -- re-measure ring_seed_m "
                         "from a top-down grid render of a --no-rws export")
    return Vector((cx, cy, zmax))


def _rws_parts(spec, pivot):
    raw = vehicle_kit.rws("rws", spec.rws_size, (pivot.x, pivot.y, pivot.z), barrel_len=spec.rws_barrel)
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
        print(f"[{spec.unit_id}] turret_{role}: {len(joined.data.polygons)} faces")
    return out


def export(unit_id, with_rws=True, out_path=None):
    spec = SPECS[unit_id]
    src, task_id = _remesh_source(unit_id)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1 or len(meshes[0].data.materials) != 1:
        raise SystemExit(f"[{unit_id}] expected one textured mesh in {src}, found "
                         f"{[(o.name, len(o.data.materials)) for o in meshes]}")
    ob = meshes[0]
    print(f"[{unit_id}] source {os.path.relpath(src, REPO)} (remesh task {task_id}): "
          f"{len(ob.data.polygons)} faces, images {[i.name for i in bpy.data.images]}")
    _rename_textures(spec, ob)
    if spec.gun is not None:
        _collapse_gun(spec, ob)
    axles = _axles(spec, ob)
    parts = _split_wheels(spec, ob, axles)
    objs = list(parts.values())

    _bake(objs, Matrix.Rotation(math.radians(spec.rot_z_deg), 4, "Z"))
    mn, mx = _bounds(objs)
    real = _read_real_metres(spec)
    mpu = metres_per_unit(mx.x - mn.x, real)
    _bake(objs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(objs)
    _bake(objs, Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))))
    mn, mx = _bounds(objs)
    print(f"[{unit_id}] {real:.3f} m long ({spec.sheet} manifest), mpu {mpu:.5f}; hull "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")

    turret = {}
    if with_rws and spec.ring_seed_m is not None:
        pivot = _ring_centre(spec, parts["hull"])
        turret = _rws_parts(spec, pivot)
        pivot_obj = bpy.data.objects.new(TURRET_PIVOT_NODE, None)
        pivot_obj.empty_display_size = 0.05
        pivot_obj["rl_pivot"] = "turret"
        bpy.context.collection.objects.link(pivot_obj)
        pivot_obj.location = pivot
        inv = Matrix.Translation(-pivot)
        for t in turret.values():
            t.parent = pivot_obj
            t.matrix_parent_inverse = inv
        print(f"[{unit_id}] {TURRET_PIVOT_NODE} at ({pivot.x:+.3f}, {pivot.y:+.3f}, {pivot.z:+.3f}) m")
    else:
        _print_roof_bands(spec, parts["hull"])
        print(f"[{unit_id}] --no-rws pass: hull only, no pivot; measure ring_seed_m from a grid render")

    every = objs + list(turret.values())
    tris = sum(len(p.vertices) - 2 for o in every for p in o.data.polygons)
    if tris > spec.tri_cap:
        raise SystemExit(f"[{unit_id}] {tris} triangles over the cap {spec.tri_cap}")
    mn, mx = _bounds(every)

    kept, _dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{unit_id}] image {name}: {before} -> {after}")
    os.makedirs(OUT_DIR, exist_ok=True)
    out = out_path or os.path.join(OUT_DIR, f"{unit_id}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out, spec.credit))
    print(f"[{unit_id}] wrote {out} ({os.path.getsize(out)} bytes, {tris} tris, "
          f"bounds {tuple(round(c, 3) for c in (mx - mn))}, nodes {sorted(o.name for o in every)}"
          f"{' + ' + TURRET_PIVOT_NODE if turret else ''})")
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv or argv[0] not in SPECS:
        raise SystemExit(f"usage: -- <unit_id> [--no-rws] [--out <path>]; units: {sorted(SPECS)}")
    export(argv[0], with_rws="--no-rws" not in argv,
           out_path=argv[argv.index("--out") + 1] if "--out" in argv else None)
