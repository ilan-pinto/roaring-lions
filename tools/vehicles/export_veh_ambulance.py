"""Export the Pered Armoured Ambulance -- the shipped `ifv_namer.glb` hull with
its weapon station removed and a medical box built on the roof.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/vehicles/export_veh_ambulance.py [-- --rise 0.9] [--out path]

Writes `art/meshes/vehicles/veh_ambulance.glb` (GH-709 / GH-707 P2, the lead's
approved spec `docs/superpowers/specs/2026-10-22-wounded-rescue-art.md` section
5). ZERO Meshy credits: the ambulance is a VARIANT of the shipped Namer (the
lead's GH-707 ruling 4, PR #728), so its source is the Namer's own export,
re-opened here in the `export_meshy_apache_gunship.py` manner -- not the Meshy
remesh re-cut. Everything that export decided (the 7.30 m tracked hull, the
2k bake, the road wheels and the track band split out as `hull_rubber`) is
inherited; this file adds geometry and takes the RWS away.

## What is removed

  * `turret_pivot`, `turret_metal`, `turret_plate` -- the Namer's kit RWS. The
    ambulance has no gun at all (`weapons: []`), and nothing traverses, so it
    carries no `turret_pivot` either (its wreck recipe is the plain tracked
    hull, `dozer_d9`'s shape).
  * every `kit_*` node -- the Namer's three upgrade tracks. The ambulance has
    no `upgrades` block, so a vehicle kit would be owed to nobody.
  * the wreck pass's `death_root`/`WRECK_*` subtree and its `idle`/`wreck`
    clips, the running-gear tags (`_RL_WHEEL`/`_RL_TRACK`, scene
    `extras.rl_running_gear`) and the baked-luma stamp: all of them are
    re-made by `pnpm running-gear:meshes`, `pnpm wreck:meshes`, then
    `pnpm damage:meshes`, because they must describe THIS geometry.

## What is added, and where the numbers come from

Every size is read off the Namer's own measured hull (the roof is flat at
z 3.24 over |y| < 1.0 and falls away at about 54 degrees to the sponson), never
typed from a real vehicle. The spec's numbers: a box over the rear two-thirds,
+0.9 m over the roof, 4.4 x 3.2 m, flat-sided, a rear roof hatch, two
folded-stretcher racks on the roof sides, two spotlights, and a pale band
round the box.

  medical_hull    the box body (a side profile extruded across the hull, its
                  top front edge chamfered), the hatch lid, the two rear door
                  panels and the stretcher straps. Role `hull`.
  medical_plate   the band round the box and the folded canvas. Role `plate`,
                  which the ambulance's palette table (`vehicle-mesh-role.ts`)
                  maps to `limestone.1` -- the palest tone a vehicle can wear
                  (index 0 of a three-step slice is never the lit face, and
                  `limestone.1`, `#E6D8BE`, is the `dome` tone the lead chose
                  for the aid post's porch band). No red anywhere, no cross.
  medical_metal   the hatch frame and hinge, the cradles and poles, the lamp
                  bodies, the door handles. Role `metal`.
  medical_glass   the lamp lenses and the box's side windows. Role `glass`.

## Palette parts inside a textured vehicle

The Namer ships its Meshy `base_color` bake. The runtime decides textured vs
palette per MESH (`mesh-vehicle.ts`), so these four carry NO material and draw
through `rampForVehicleRole("veh_ambulance", role)`, exactly as the Eitan's kit
RWS does. That is what lets the band be a palette tone at all: a texel of the
bake could never be `limestone.1`.

## Verified on the EXPORT, not on this script

The output is re-opened by `tools/render_mesh_gate.py` and its silhouette
compared with `ifv_namer`'s at 64 px: the named risk (spec section 5) is IoU
over 0.88. `--rise` takes the box's height over the roof (0.9 approved, 1.1
the approved fallback); the number that shipped is recorded in
`docs/ASSET_PROVENANCE.md`.

AI-generated source (Meshy, the Namer remesh), disclosed per CONTRIBUTING.md.
No `mathutils.noise` anywhere in this file.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import textured as vehicle_textured  # noqa: E402

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(REPO, "art", "meshes", "vehicles", "ifv_namer.glb")
OUT = os.path.join(REPO, "art", "meshes", "vehicles", "veh_ambulance.glb")
UNIT = "veh_ambulance"

# --- measured / approved numbers (see the docstring) ------------------------
ROOF_Z = 3.243            # the Namer's flat roof, read off hull_hull
BOX_RISE = 0.90           # spec: +0.9 m over the roof (1.1 is the IoU fallback)
BOX_X = (-3.50, 0.90)     # 4.4 m: the rear two-thirds of a 7.30 m hull
BOX_HALF_Y = 1.60         # 3.2 m
BOX_FOOT_Z = 2.40         # below the sponson's slope at |y| 1.6 (z 2.49), so no lip floats
CHAMFER_FRONT = 0.38      # the top front edge
CHAMFER_REAR = 0.20
BAND_Z = (3.40, 3.72)
BAND_PROUD = 0.03
WINDOW_Z = (3.84, 4.04)
SIDES = 10

CREDIT = (
    "Pered Armoured Ambulance -- a variant of the shipped Namer IFV (AI-generated, Meshy "
    "text-to-3d remesh export, disclosed per CONTRIBUTING.md): ifv_namer.glb re-opened, its "
    "weapon station removed, and a medical roof box, stretcher racks, lamps and a band built "
    "from primitives for Roaring Lions. GH-709 / GH-707 P2."
)


def log(msg):
    print(f"[{UNIT}] {msg}")


# ---------------------------------------------------------------------------
# geometry helpers -- plain bmesh primitives
# ---------------------------------------------------------------------------

def _finish(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def box(name, size, at, bevel=0.0, yaw=0.0, pitch=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    m = (Matrix.Translation(Vector(at)) @ Matrix.Rotation(yaw, 4, "Z")
         @ Matrix.Rotation(pitch, 4, "Y") @ Matrix.Diagonal((sx, sy, sz, 1.0)))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    if bevel > 0.0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES")
    return _finish(name, bm)


def cyl_x(name, radius, length, at, sides=SIDES, pitch=0.0):
    """A closed cylinder along +X centred at `at`, pitched about Y (positive
    pitch lifts the +X end)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides,
                          radius1=radius, radius2=radius, depth=length)
    m = (Matrix.Translation(Vector(at)) @ Matrix.Rotation(-pitch, 4, "Y")
         @ Matrix.Rotation(math.radians(90.0), 4, "Y"))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _finish(name, bm)


def cyl_y(name, radius, length, at, sides=SIDES):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides,
                          radius1=radius, radius2=radius, depth=length)
    m = Matrix.Translation(Vector(at)) @ Matrix.Rotation(math.radians(90.0), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _finish(name, bm)


def profile_prism(name, pts_xz, half_y, bevel=0.0):
    """A polygon given in (x, z), extruded across y in [-half_y, +half_y]."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, -half_y, z)) for x, z in pts_xz]
    hi = [bm.verts.new((x, half_y, z)) for x, z in pts_xz]
    n = len(pts_xz)
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bevel > 0.0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES")
    return _finish(name, bm)


def _join(objs, name, role):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    ob["rl_role"] = role
    ob["rl_part"] = "medical"
    ob.data.validate()
    for poly in ob.data.polygons:
        poly.use_smooth = False
    return ob


# ---------------------------------------------------------------------------
# the parts
# ---------------------------------------------------------------------------

def build_parts(rise):
    top = ROOF_Z + rise
    x0, x1 = BOX_X
    hull, plate, metal, glass = [], [], [], []

    # --- the box body: side profile, chamfered at the top front and rear ----
    prof = [
        (x0, BOX_FOOT_Z), (x1, BOX_FOOT_Z), (x1, top - CHAMFER_FRONT - 0.30),
        (x1 - CHAMFER_FRONT, top), (x0 + CHAMFER_REAR, top), (x0, top - CHAMFER_REAR),
    ]
    hull.append(profile_prism("body", prof, BOX_HALF_Y, bevel=0.035))

    # --- the band round the box: an outer shell, proud of every wall --------
    bx0, bx1 = x0 - BAND_PROUD, x1 + BAND_PROUD
    bh = BOX_HALF_Y + BAND_PROUD
    plate.append(box("band", (bx1 - bx0, 2 * bh, BAND_Z[1] - BAND_Z[0]),
                     ((bx0 + bx1) / 2, 0.0, (BAND_Z[0] + BAND_Z[1]) / 2), bevel=0.025))

    # --- side windows (a ribbon of two panes each side, above the band) -----
    for sgn in (-1.0, 1.0):
        for k, cx in enumerate((-1.75, -0.55)):
            glass.append(box(f"win{k}{sgn:+.0f}", (1.00, 0.03, WINDOW_Z[1] - WINDOW_Z[0]),
                             (cx, sgn * (BOX_HALF_Y + 0.012), (WINDOW_Z[0] + WINDOW_Z[1]) / 2)))
        # window frame: the mullion between the panes and a sill
        metal.append(box(f"mull{sgn:+.0f}", (0.07, 0.04, WINDOW_Z[1] - WINDOW_Z[0] + 0.06),
                         (-1.15, sgn * (BOX_HALF_Y + 0.012), (WINDOW_Z[0] + WINDOW_Z[1]) / 2)))

    # --- the rear roof hatch -------------------------------------------------
    hx, hy = -2.45, 0.0
    for sx, sy, w, d in ((0, 0.43, 1.00, 0.07), (0, -0.43, 1.00, 0.07),
                         (0.465, 0, 0.07, 0.79), (-0.465, 0, 0.07, 0.79)):
        metal.append(box("hatch_frame", (w, d, 0.10), (hx + sx, hy + sy, top + 0.05)))
    hull.append(box("hatch_lid", (0.86, 0.72, 0.05), (hx, hy, top + 0.115), bevel=0.012))
    metal.append(box("hatch_handle", (0.34, 0.05, 0.05), (hx + 0.15, hy, top + 0.17)))
    for sy in (-0.28, 0.28):
        metal.append(cyl_y("hatch_hinge", 0.025, 0.14, (hx - 0.46, hy + sy, top + 0.10), sides=8))

    # --- two folded-stretcher racks on the roof sides ------------------------
    rack_x = (-2.90, -0.55)          # the bundle's span, 2.35 m
    cx = (rack_x[0] + rack_x[1]) / 2
    length = rack_x[1] - rack_x[0]
    for sgn in (-1.0, 1.0):
        y = sgn * 1.18
        zc = top + 0.26
        plate.append(box("canvas", (length - 0.15, 0.25, 0.11), (cx, y, zc), bevel=0.02))
        for py in (-0.145, 0.145):
            metal.append(cyl_x("pole", 0.028, length + 0.30, (cx, y + py, zc + 0.02), sides=8))
            for gx in (rack_x[0] - 0.10, rack_x[1] + 0.10):
                metal.append(box("grip", (0.15, 0.05, 0.05), (gx, y + py, zc + 0.02)))
        for sx in (0.66, 1.69):  # on the bundle (x from rack start)
            hull.append(box("strap", (0.06, 0.34, 0.15), (rack_x[0] + sx, y, zc)))
        for sx in (0.15, 1.17, 2.20):
            for py in (-0.17, 0.17):
                metal.append(box("post", (0.06, 0.05, 0.22), (rack_x[0] + sx, y + py, top + 0.11)))
            metal.append(box("base", (0.12, 0.42, 0.03), (rack_x[0] + sx, y, top + 0.015)))

    # --- two spotlights on the front roof corners ---------------------------
    for sgn in (-1.0, 1.0):
        sy = sgn * 0.78
        sxp = x1 - 0.65
        metal.append(box("lamp_post", (0.14, 0.14, 0.20), (sxp, sy, top + 0.10)))
        metal.append(box("lamp_yoke", (0.12, 0.34, 0.05), (sxp, sy, top + 0.215)))
        metal.append(cyl_x("lamp_body", 0.155, 0.34, (sxp + 0.04, sy, top + 0.33), sides=12, pitch=math.radians(9)))
        metal.append(cyl_x("lamp_rim", 0.172, 0.05, (sxp + 0.215, sy, top + 0.355), sides=12, pitch=math.radians(9)))
        glass.append(cyl_x("lamp_lens", 0.145, 0.03, (sxp + 0.245, sy, top + 0.36), sides=12, pitch=math.radians(9)))

    # --- the rear: two door panels with handles (the box's back face) -------
    for sgn in (-1.0, 1.0):
        hull.append(box("door", (0.04, 0.72, 1.36), (x0 - 0.012, sgn * 0.40, 3.16), bevel=0.012))
        metal.append(box("door_handle", (0.05, 0.05, 0.30), (x0 - 0.045, sgn * 0.09, 3.16)))
    return hull, plate, metal, glass


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

def export(rise=BOX_RISE, out_path=OUT):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC, import_scene_extras=True)

    doomed = [o for o in bpy.data.objects
              if o.name.startswith(("kit_", "turret_", "WRECK_")) or o.name == "death_root"]
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    log(f"dropped {len(doomed)} imported node(s): the RWS, the kit_* parts, the wreck subtree")
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()
    # What the passes re-make, so a stale copy cannot ride along.
    for key in list(bpy.context.scene.keys()):
        if key != "_RNA_UI":
            del bpy.context.scene[key]
    for me in bpy.data.meshes:
        for name in ("_RL_WHEEL", "_RL_TRACK"):
            if name in me.attributes:
                me.attributes.remove(me.attributes[name])
    for mat in bpy.data.materials:
        if "rl_bake_luma" in mat:
            del mat["rl_bake_luma"]

    hull = bpy.data.objects["hull_hull"]
    rubber = bpy.data.objects["hull_rubber"]
    for ob in (hull, rubber):
        if ob.parent is not None or any(abs(c) > 1e-9 for c in ob.location):
            raise SystemExit(f"{ob.name} is not at the origin -- not the Namer export this file expects")
    zs = np.empty(len(hull.data.vertices) * 3)
    hull.data.vertices.foreach_get("co", zs)
    zs = zs.reshape(-1, 3)
    roof = float(zs[:, 2].max())
    if abs(roof - ROOF_Z) > 0.01:
        raise SystemExit(f"hull roof reads {roof:.3f}, this file was written against {ROOF_Z}")

    hull_p, plate_p, metal_p, glass_p = build_parts(rise)
    medical_hull = _join(hull_p, "medical_hull", "hull")
    medical_plate = _join(plate_p, "medical_plate", "plate")
    medical_metal = _join(metal_p, "medical_metal", "metal")
    medical_glass = _join(glass_p, "medical_glass", "glass")

    live = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in live}
    lo = Vector([min(v.co[i] for o in live for v in o.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for o in live for v in o.data.vertices) for i in range(3)])
    log(f"tris {tris} total {sum(tris.values())}; bounds x[{lo.x:.3f},{hi.x:.3f}] "
        f"y[{lo.y:.3f},{hi.y:.3f}] z[{lo.z:.3f},{hi.z:.3f}]; rise {rise}")
    if sum(tris.values()) > 10000:
        raise SystemExit(f"{sum(tris.values())} triangles is over the 10,000 APC cap")

    # The Namer's bake ships at 2560 x 2048 (past `textured.TEXTURE_PX` on one axis).
    # `prepare_vehicle_textures` would squeeze it to 2048 x 2048 and take a fifth
    # of its horizontal resolution for nothing: the ambulance shares the Namer's
    # photograph, so it keeps it as it is ("used as is"), and only checks that the
    # image the runtime reads is there.
    for img in bpy.data.images:
        log(f"image {img.name}: {tuple(img.size)} (kept as shipped)")
    if not any(vehicle_textured._basename(i.name) == vehicle_textured.BASE_COLOR_PREFIX for i in bpy.data.images):
        raise SystemExit("no base_color image survived the import")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out_path, CREDIT))
    log(f"wrote {out_path} ({os.path.getsize(out_path)} bytes)")

    # The editable source (CLAUDE.md: never a mesh without its .blend).
    blend = os.path.join(REPO, "art", "src", "vehicles", "veh_ambulance.blend")
    if out_path == OUT:
        bpy.ops.wm.save_as_mainfile(filepath=blend, copy=True)
        log(f"saved {blend}")
    return out_path


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    rise = float(argv[argv.index("--rise") + 1]) if "--rise" in argv else BOX_RISE
    out = argv[argv.index("--out") + 1] if "--out" in argv else OUT
    export(rise=rise, out_path=out)
