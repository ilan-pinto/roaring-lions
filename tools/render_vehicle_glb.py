"""Render a vehicle's billboard sprite sheets from its own shipped mesh GLB.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_vehicle_glb.py -- --unit mbt_lavi
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_vehicle_glb.py -- --unit jeep_shoded
    python3 tools/quantize_sprites.py --sprites assets/sprites/TNK_HULL   (etc.)
    pnpm validate:assets
    pnpm icons:units

`--measure` stops after loading and cleaning the model and prints its bounds,
without rendering anything.

WHY THIS EXISTS (2026-09-25). The sheets the billboard path draws for
`mbt_lavi` (TNK_HULL, TNK_TURR) and `jeep_shoded` (JEEP_HULL) were rendered
from two downloaded models whose redistribution rights were never established:
a 2013 BlendSwap Tiger tank with no credit recorded anywhere, and a
`jeep_shoded.blend` "downloaded without licence, readme or attribution". Neither
source was ever in git. The repository went public, so the sheets are
re-rendered here from the unit's OWN shipped mesh, whose provenance is recorded
in docs/ASSET_PROVENANCE.md (AI-generated with Meshy under the project lead's
commercial plan, disclosed per CONTRIBUTING.md):

    mbt_lavi     art/meshes/vehicles/mbt_lavi.glb      -> TNK_HULL, TNK_TURR
    jeep_shoded  art/meshes/vehicles/jeep_shoded.glb   -> JEEP_HULL

The source is the committed GLB, so this sheet can be re-rendered from a fresh
clone -- which the sheets it replaces never could be.

THE FORMAT IS REPRODUCED, NOT REDESIGNED. `main.ts`, the Pixi renderer,
`&nomesh`, unit icons, portraits and tests name these sheets' files directly
(`TNK_HULL/f05_000.png`, `JEEP_HULL/idle_f03_000.png`), so each sheet keeps:

  * its file naming and layout -- TNK_* are the repository's only LEGACY-layout
    sheets (`f{NN}_000.png`, `frames: 1`, no `clips` key, no wreck), JEEP_HULL is
    clip layout (`idle_` + `wreck_`, 16 facings each);
  * 16 facings, 256 px square cells, frame centre on the rig's pivot (the
    model's median vertex, exactly as render_vehicle.setup and render_tank.py
    both placed it);
  * its `facingOffset` -- TNK 5, JEEP 0 -- so a given file keeps meaning the
    same bearing. The GLB's forward is +X (mesh contract), which this rig draws
    at offset 12 (dimetric.facing_offset); the model is turned by
    (12 - offset) x 22.5 degrees before frame 0 to land the old offset. The
    turn is split into a whole multiple of 90 degrees baked into the geometry
    (axis-aligned, so `realMetres` is still measured along the hull) and a
    residual on the pivot;
  * the scale DERIVATION -- `realMetres` is the value the old manifest declared
    (6.32, 4.8), which is also what export_meshy_tank.py / export_meshy_jeep.py
    read back to size these GLBs, and `scale` follows from dimetric.unit_scale.
    It is not hand-typed and it does not match the old number: the new model
    fits a tighter frame, so the same vehicle length sits on a smaller canvas.

Two manifest values change on purpose: `unit` stops naming the Tiger, and a
`credit` records the new provenance (TNK_* had none at all).

Material: one flat olive over the whole model, as both replaced sheets used,
then quantized onto the palette. The GLB's own base_color bake and its WRECK_
geometry are not used; the jeep's wreck clip is render_vehicle's burnt pose,
as before.
"""
import json
import math
import os
import sys
import tempfile

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_vehicle import (  # noqa: E402
    FACINGS,
    SIZE,
    VehicleSpec,
    _shader,
    render_vehicle,
    setup,
)
from dimetric import facing_offset as rig_facing_offset  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CREDIT = (
    "Original work for Roaring Lions: rendered from art/meshes/vehicles/{glb}, "
    "AI-generated with Meshy (commercial plan) and reworked in Blender; "
    "see docs/ASSET_PROVENANCE.md"
)

UNITS = {
    "mbt_lavi": {
        "glb": "mbt_lavi.glb",
        "layout": "legacy",
        "out_hull": "assets/sprites/TNK_HULL",
        "out_turr": "assets/sprites/TNK_TURR",
        "hull_unit": "mbt_lavi_hull",
        "turret_unit": "mbt_lavi_turret",
        "real_metres": 6.32,
        "size_class": "heavy_vehicle",
        "facing_offset": 5,
        "turret_meshes": frozenset({"turret_hull", "turret_metal"}),
        # render_tank.py's own TankOlive, so the tank keeps its tone.
        "olive": ((0.22, 0.24, 0.15, 1.0), 0.7, 0.3),
    },
    "jeep_shoded": {
        "glb": "jeep_shoded.glb",
        "layout": "clip",
        "out_hull": "assets/sprites/JEEP_HULL",
        # Never written: no turret meshes, so render_vehicle stops after the
        # hull sheet. Required by the dataclass only (as in render_jeep.py).
        "out_turr": "assets/sprites/JEEP_TURR_UNUSED",
        "hull_unit": "jeep_shoded_hull",
        "turret_unit": "jeep_shoded_turret",
        "real_metres": 4.8,
        "size_class": "light_vehicle",
        "facing_offset": 0,
        "turret_meshes": frozenset(),
        "olive": None,  # render_vehicle.flat_material, as render_jeep.py used
    },
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    unit, measure = None, False
    for i, a in enumerate(argv):
        if a == "--unit":
            unit = argv[i + 1]
        elif a.startswith("--unit="):
            unit = a.split("=", 1)[1]
        elif a == "--measure":
            measure = True
    if unit not in UNITS:
        raise SystemExit(f"--unit must be one of {sorted(UNITS)}, got {unit!r}")
    return unit, measure


def turn_split(offset):
    """(geometry quarter-turns, residual pivot yaw in radians) for an offset."""
    turn = ((rig_facing_offset(FACINGS) - offset) % FACINGS) * (360.0 / FACINGS)
    quarters = int(turn // 90.0)
    return quarters, math.radians(turn - 90.0 * quarters)


def load_clean(glb, quarters):
    """Import the GLB into an empty scene and leave only the living model.

    Dropped: the WRECK_ meshes and their death_root (the mesh path's own wreck,
    not this sheet's), every animation (bind pose only), and every empty -- the
    turret meshes are un-parented from turret_pivot keeping their world
    transform, because render_vehicle.setup re-parents parentless meshes onto
    its own pivot and would otherwise discard the pivot's offset.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    for ob in list(bpy.data.objects):
        ob.animation_data_clear()
    bpy.context.view_layer.update()
    for ob in list(bpy.data.objects):
        if ob.name.startswith("WRECK_") or ob.name == "death_root":
            bpy.data.objects.remove(ob, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    worlds = {o.name: o.matrix_world.copy() for o in meshes}
    turn = Matrix.Rotation(math.radians(90.0 * quarters), 4, "Z")
    for o in meshes:
        o.parent = None
        o.matrix_world = turn @ worlds[o.name]
    for ob in [o for o in bpy.data.objects if o.type != "MESH"]:
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.context.view_layer.update()
    # Bake every transform into the vertices: object scale 1, as every source
    # this rig reads is authored.
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in meshes:
        o.data.materials.clear()
    return meshes


def report_bounds(meshes):
    xs, ys, zs = [], [], []
    for o in meshes:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            xs.append(p.x)
            ys.append(p.y)
            zs.append(p.z)
    mid = len(xs) // 2
    print(
        "[measure] meshes", sorted(o.name for o in meshes),
        "verts", len(xs),
        "extent", tuple(round(max(a) - min(a), 3) for a in (xs, ys, zs)),
        "median", tuple(round(sorted(a)[mid], 3) for a in (xs, ys, zs)),
    )


def legacy_manifest(spec, framing, unit, offset, files, layer=None):
    """The TNK_* manifest shape render_tank.py wrote: no clips, `frames: 1`."""
    manifest = {
        "unit": unit,
        "credit": spec.credit,
        "facings": FACINGS,
        "size": SIZE,
        "frames": 1,
        "facingOffset": offset,
        "facingReverse": True,
        "scale": round(framing.scale, 4),
        "derivedScale": round(framing.derived_scale, 4),
        "sizeClass": spec.size_class,
        "classMultiplier": 1.0,
        "realMetres": round(framing.real_metres, 3),
        "metresPerModelUnit": round(framing.metres_per_unit, 5),
        "frameMetres": round(framing.frame_metres, 3),
    }
    if layer:
        manifest["layer"] = layer
    manifest["files"] = files
    return manifest


def render_legacy(spec, cfg, yaw):
    """Hull then turret, one frame per facing, named f{NN}_000.png."""
    pivot, hull, turret, _olive, framing = setup(spec)
    colour, rough, metal = cfg["olive"]
    mat = _shader("TankOlive", colour, rough)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metal
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(mat)
    sc = bpy.context.scene
    step = 2.0 * math.pi / FACINGS
    for out_dir, show, hide, unit, layer in (
        (spec.out_hull, hull, turret, spec.hull_unit, None),
        (spec.out_turr, turret, hull, spec.turret_unit, "turret"),
    ):
        os.makedirs(out_dir, exist_ok=True)
        for o in show:
            o.hide_render = False
        for o in hide:
            o.hide_render = True
        files = []
        for f in range(FACINGS):
            pivot.rotation_euler.z = yaw + f * step
            name = f"f{f:02d}_000.png"
            sc.render.filepath = os.path.join(out_dir, name)
            bpy.ops.render.render(write_still=True)
            files.append({"facing": f, "frame": 0, "file": name})
            print(f"  {os.path.basename(out_dir)} {f + 1}/{FACINGS}")
        with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
            json.dump(
                legacy_manifest(spec, framing, unit, spec.facing_offset, files, layer),
                fh,
                indent=2,
            )
    print(f"DONE {FACINGS * 2} frames -> {spec.out_hull}, {spec.out_turr}")


def main():
    unit, measure = parse_args()
    cfg = UNITS[unit]
    glb = os.path.join(REPO, "art", "meshes", "vehicles", cfg["glb"])
    quarters, yaw = turn_split(cfg["facing_offset"])
    print(f"[{unit}] {glb}: {quarters} quarter-turn(s) baked, residual yaw {math.degrees(yaw):.1f} deg")
    meshes = load_clean(glb, quarters)
    report_bounds(meshes)
    if measure:
        return
    src = os.path.join(tempfile.mkdtemp(prefix=f"rl_{unit}_"), f"{unit}_sprite_src.blend")
    bpy.ops.wm.save_as_mainfile(filepath=src)
    spec = VehicleSpec(
        src=src,
        out_hull=os.path.join(REPO, cfg["out_hull"]),
        out_turr=os.path.join(REPO, cfg["out_turr"]),
        real_metres=cfg["real_metres"],
        size_class=cfg["size_class"],
        credit=CREDIT.format(glb=cfg["glb"]),
        hull_unit=cfg["hull_unit"],
        turret_unit=cfg["turret_unit"],
        facing_offset=cfg["facing_offset"],
        turret_meshes=cfg["turret_meshes"],
    )
    if cfg["layout"] == "legacy":
        render_legacy(spec, cfg, yaw)
    else:
        if yaw != 0.0:
            raise SystemExit("clip layout expects a whole quarter-turn; see turn_split")
        render_vehicle(spec)


main()
