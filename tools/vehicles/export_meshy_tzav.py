"""Export `demo_tzav` -- the Shiryonan Demolition Carrier (E5 part 2, GH-181;
numbers and prompt in `docs/art/meshy-prompts-e5.md` section 3) -- from its
Meshy text-to-3D remesh as a TEXTURED vehicle glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_tzav.py -- demo_tzav [--probe]

`export_meshy_ramp.py`'s method for a tracked hull (the D9), with the two
things that differ for this unit spelled out here rather than forked into a
third copy of the code: the helpers that do not depend on the spec's shape
(`_remesh_source`, `_rename_textures`, `_fix_bake`, `_probe`, `_split_rubber`,
`_join_by_role`, `_bake`, `_bounds`) are imported from that module.

  1. **The drawn size is declared, not read.** Every other Meshy vehicle
     exporter reads `realMetres` off the unit's sprite manifest; the Tzav
     has no sheet yet (`TZAV_HULL` is E6's), so `real_metres` is a field of
     this spec -- 8.5 m over the arm and crate, the design's own figure --
     and E6's sheet must be rendered from THIS GLB so the two agree
     (`tools/render_vehicle_glb.py` is how `mbt_lavi`'s was).
  2. **The weapon station sits on a flat roof, not a ring.** The prompt
     asked for an empty roof, and the staged unit fires an `hmg` through a
     remote station (`rws_mg`), so `turret_pivot` carries `kit.rws` the way
     the Eitan's does. There is no lip to find: `_roof_station` measures the
     roof's HEIGHT at a seed read off `--probe`'s roof bands and refuses if
     the roof is not flat there (the arm's base or a hatch would both show as
     a tall spread inside the search radius). The station's x/y is the seed;
     its z is measured.

`--probe` prints the source's own numbers -- contact clusters, roof bands,
end plate areas -- and writes nothing; every spec number below was read off a
probe run, never guessed. `rot_z_deg` turns the arm end to `+X`.

Ownership: this script owns `art/meshes/vehicles/demo_tzav.glb`. The unit is
deliberately NOT in `export_mesh_vehicle.py`'s `SPECS`, so nothing in the kit
can regenerate it (`tools/mesh_ownership.py`). Re-run
`pnpm wreck:meshes -- --id=demo_tzav` after exporting (recipe `tracked` +
`turret_pivot`).

AI-generated source (Meshy text-to-3D preview + 2k refine + remesh),
disclosed per CONTRIBUTING.md. No `mathutils.noise`; every threshold is a
constant applied to the source's own vertex data.
"""
import math
import os
import sys
from dataclasses import dataclass
from typing import Optional

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402
import textured as vehicle_textured  # noqa: E402
from export_meshy_ramp import (  # noqa: E402
    _bake,
    _bounds,
    _fix_bake,
    _join_by_role,
    _probe,
    _remesh_source,
    _rename_textures,
    _split_rubber,
)

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
# Spelled out so `tools/src/mesh_ownership.test.ts` can read, from the source
# alone, which file this script writes.
OUT_DEMO_TZAV = os.path.join(OUT_DIR, "demo_tzav.glb")
OUTPUTS = {"demo_tzav": OUT_DEMO_TZAV}
TURRET_PIVOT_NODE = "turret_pivot"


@dataclass(frozen=True)
class TzavSpec:
    unit_id: str
    real_metres: float                   # declared: no sprite manifest yet (see docstring)
    credit: str
    rot_z_deg: float                     # arm end -> +X
    tri_cap: int
    # tracked -- SOURCE frame, after rot_z
    track_ay: float                      # tracks are outboard of this |y|
    track_z_top: float                   # absolute z, SOURCE frame: top of the track band
    track_x: tuple                       # the tracks' x span; the arm and crate lie beyond it
    # the kit RWS on the flat roof -- FINAL frame, metres
    rws: Optional[dict] = None           # {size, barrel, seed, search_r, flat_band, z_max}
    # bake fixes (export_meshy_ramp.py's own), applied to base_color before export
    scrub_white: bool = False
    olive_shift: bool = False


SPECS = {
    # Measured 2026-10-01 on the 4,888-face remesh (task 01a0f5f6) with
    # --probe. Source bounds L 1.886 W 0.922 H 0.877, belly at z -0.593. The
    # roof profile is HIGH at -x (0.87, the cab) and low at +x (0.59-0.70,
    # the crate), so the crate end is already +X and rot_z is 0. The tracks
    # are the low outboard band |y| 0.27..0.41 (the |y| histogram has a
    # trough at 0.30-0.325 between the track's inner face and the hull side
    # at 0.41-0.46), dense up to 0.375 above the belly (absolute -0.218) and
    # spanning x -0.92..+0.56 -- the crate and its arm sit beyond +0.65 at
    # z 0.16-0.71 above the belly, clear of the ground. The cab roof is the
    # flattest plateau: at source (-0.55, 0) a 0.12 circle reads 49-71% of
    # its verts in the top 3 cm band at z 0.793; the local maxima at x -0.3
    # ..0.0 are a one-sided hatch (y -0.34..-0.09) and are avoided. mpu
    # 8.5 / 1.886 = 4.507, so the station seed is (-2.49, 0.0) m.
    "demo_tzav": TzavSpec(
        unit_id="demo_tzav",
        real_metres=8.5,
        credit=(
            "Shiryonan demolition carrier -- AI-generated (Meshy text-to-3D preview + 2k "
            "refine + remesh), disclosed per CONTRIBUTING.md; re-oriented, re-scaled, "
            "track/hull split and fitted with a kit remote weapon station in Blender for "
            "Roaring Lions"
        ),
        rot_z_deg=0.0,
        tri_cap=8000,
        track_ay=0.265,
        track_z_top=-0.213,
        track_x=(-0.95, 0.60),
        rws={"size": (0.9, 0.7, 0.45), "barrel": 0.95, "seed": (-2.49, 0.0),
             "search_r": 0.54, "flat_band": 0.135, "flat_fraction": 0.4},
    ),
}


def _roof_station(spec, hull):
    """Where the kit RWS goes on a roof with no ring: the seed's x/y and the
    MEASURED roof height there. Refuses if the roof is not flat inside the
    search radius (the top band spreads more than `flat_band`), which is what
    the arm's base, a hatch or a stowage box would read as."""
    r = spec.rws
    sx, sy = r["seed"]
    near = [v.co for v in hull.data.vertices
            if math.hypot(v.co.x - sx, v.co.y - sy) < r["search_r"] and v.co.z <= r.get("z_max", 1e9)]
    if len(near) < 8:
        raise SystemExit(f"[{spec.unit_id}] only {len(near)} hull verts within {r['search_r']} m of the "
                         f"station seed {r['seed']} -- re-measure with --probe")
    zmax = max(p.z for p in near)
    top = [p for p in near if p.z > zmax - r["flat_band"]]
    x0, x1 = min(p.x for p in top), max(p.x for p in top)
    y0, y1 = min(p.y for p in top), max(p.y for p in top)
    print(f"[{spec.unit_id}] roof station: {len(top)} of {len(near)} verts within {r['flat_band']} m of the "
          f"local top z {zmax:+.3f}, spanning x[{x0:+.2f},{x1:+.2f}] y[{y0:+.2f},{y1:+.2f}]")
    # A flat roof puts most of the nearby verts in the top band; a slope or a
    # fitting does not.
    if len(top) < len(near) * r.get("flat_fraction", 0.4):
        raise SystemExit(f"[{spec.unit_id}] the roof is not flat at the station seed -- "
                         f"{len(top)}/{len(near)} verts in the top band; re-measure with --probe")
    return Vector((sx, sy, zmax))


def export(unit_id, probe=False, out_path=None):
    spec = SPECS[unit_id]
    src, task_id = _remesh_source(unit_id)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1 or len(meshes[0].data.materials) != 1:
        raise SystemExit(f"[{unit_id}] expected one textured mesh in {src}, found "
                         f"{[(o.name, len(o.data.materials)) for o in meshes]}")
    ob = meshes[0]
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    _bake([ob], ob.matrix_world.copy())
    ob.matrix_world = Matrix.Identity(4)
    print(f"[{unit_id}] source {os.path.relpath(src, REPO)} (remesh task {task_id}): {len(ob.data.polygons)} faces")
    base = _rename_textures(spec, ob)
    if not probe and (spec.scrub_white or spec.olive_shift):
        _fix_bake(spec, base)
    _bake([ob], Matrix.Rotation(math.radians(spec.rot_z_deg), 4, "Z"))
    if probe:
        _probe(spec, ob)
        print(f"[{unit_id}] --probe: nothing written (rot_z {spec.rot_z_deg} applied first)")
        return None

    def is_rubber(c):
        return (abs(c.y) > spec.track_ay and c.z < spec.track_z_top
                and spec.track_x[0] <= c.x <= spec.track_x[1])

    parts = _split_rubber(spec, ob, is_rubber)
    objs = list(parts.values())

    mn, mx = _bounds(objs)
    mpu = metres_per_unit(max(mx.x - mn.x, mx.y - mn.y), spec.real_metres)
    _bake(objs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(objs)
    _bake(objs, Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))))
    mn, mx = _bounds(objs)
    print(f"[{unit_id}] {spec.real_metres:.3f} m long (declared; no sheet yet), mpu {mpu:.5f}; "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")

    extra = {}
    pivot_obj = None
    if spec.rws is not None:
        pivot = _roof_station(spec, parts["hull"])
        raw = vehicle_kit.rws("rws", spec.rws["size"], (pivot.x, pivot.y, pivot.z), barrel_len=spec.rws["barrel"])
        turret = _join_by_role(spec, raw, "turret")
        pivot_obj = bpy.data.objects.new(TURRET_PIVOT_NODE, None)
        pivot_obj.empty_display_size = 0.05
        pivot_obj["rl_pivot"] = "turret"
        bpy.context.collection.objects.link(pivot_obj)
        pivot_obj.location = pivot
        inv = Matrix.Translation(-pivot)
        for t in turret.values():
            t.parent = pivot_obj
            t.matrix_parent_inverse = inv
        extra.update({f"turret_{k}": v for k, v in turret.items()})
        print(f"[{unit_id}] {TURRET_PIVOT_NODE} at ({pivot.x:+.3f}, {pivot.y:+.3f}, {pivot.z:+.3f}) m")

    every = objs + list(extra.values())
    tris = sum(len(p.vertices) - 2 for o in every for p in o.data.polygons)
    if tris > spec.tri_cap:
        raise SystemExit(f"[{unit_id}] {tris} triangles over the cap {spec.tri_cap}")
    mn, mx = _bounds(every)

    kept, _dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{unit_id}] image {name}: {before} -> {after}")
    os.makedirs(OUT_DIR, exist_ok=True)
    out = out_path or OUTPUTS[unit_id]
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out, spec.credit))
    print(f"[{unit_id}] wrote {out} ({os.path.getsize(out)} bytes, {tris} tris, "
          f"bounds {tuple(round(c, 3) for c in (mx - mn))}, nodes {sorted(o.name for o in every)}"
          f"{' + ' + TURRET_PIVOT_NODE if pivot_obj else ''})")
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv or argv[0] not in SPECS:
        raise SystemExit(f"usage: -- <unit_id> [--probe] [--out <path>]; units: {sorted(SPECS)}")
    export(argv[0], probe="--probe" in argv,
           out_path=argv[argv.index("--out") + 1] if "--out" in argv else None)
