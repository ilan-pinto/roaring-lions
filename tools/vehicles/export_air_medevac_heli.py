"""Export the Nachlieli Medevac -- the shipped `heli_yanshuf.glb` plus a rescue
hoist over the right cabin door, two external tanks on stub pylons, a litter
pannier on each cabin side, and a pale band round the tail boom.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/vehicles/export_air_medevac_heli.py [-- --scale K]  (default 1.3, the IoU fallback) [--out path]

Writes `art/meshes/vehicles/air_medevac_heli.glb` and
`art/src/aircraft/air_medevac_heli.blend` (GH-709 / GH-707 P2, the lead's
approved spec `docs/superpowers/specs/2026-10-22-wounded-rescue-art.md`
section 6). ZERO Meshy credits: the medevac is a VARIANT of the shipped
Yanshuf, so its source is the Yanshuf's own export, re-opened exactly as
`export_meshy_apache_gunship.py` re-opens the Peten -- not the Meshy remesh
re-cut. The cut, the orientation, the 5.3 m drawn size, the tilted
`rotor_tilt -> rotor_pivot -> rotor_metal` graph and the bake are inherited;
this file adds geometry.

## What is removed

The Yanshuf's `kit_*` upgrade nodes (the medevac has no `upgrades`), the wreck
pass's `death_root`/`WRECK_*` subtree and its clips (`pnpm wreck:meshes` and
`pnpm damage:meshes` rebuild them: the wreck must include the new parts), and
the scene extras / baked-luma stamp the passes re-make.

## What is added, and where the numbers come from

Every size is read off the Yanshuf's OWN measured hull (the cabin's half-width
at the door, the door's frame, the tail boom's section at the band station),
never typed from a real airframe. Forward is +X, up +Z, and the aircraft's
RIGHT is -Y (right = forward x up).

  medevac_metal   the hoist: a mast on the upper frame of the right cabin door,
                  a boom out over the sill (~0.9 m), a reel at its root, a
                  brace, the cable stub and its hook block; the stub-wing
                  struts. Role `metal`.
  medevac_hull    the stub wings, two pylons a side, the two external tanks and
                  the two cabin-side litter panniers. Role `hull`.
  medevac_plate   the band round the tail boom. Role `plate`, which the
                  medevac's palette table maps to `limestone.1`, the palest
                  lit tone a vehicle takes (the ambulance's band tone, and the
                  aid post's). No red, no cross.

## Palette parts inside a textured vehicle

The Yanshuf ships its Meshy `base_color` bake and the runtime decides textured
vs palette per MESH, so these three carry NO material and draw through
`rampForVehicleRole("air_medevac_heli", role)` -- the only way the band can be
a palette tone at all.

## The IoU, which is the named risk

A rotor disc dominates this silhouette at 64 px and the additions are small
against it, so `heli_yanshuf` vs `air_medevac_heli` is MEASURED first
(`tools/render_mesh_gate.py`, `validate_assets.silhouette`). `--scale K`
multiplies the tanks, wings and panniers: the approved fallback is "enlarge the
tanks / add a cabin-side litter pannier" (0 credits), and the K that shipped is
recorded in `docs/ASSET_PROVENANCE.md` with the number it bought.

AI-generated source (Meshy, the Yanshuf remesh), disclosed per CONTRIBUTING.md.
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
SRC = os.path.join(REPO, "art", "meshes", "vehicles", "heli_yanshuf.glb")
OUT = os.path.join(REPO, "art", "meshes", "vehicles", "air_medevac_heli.glb")
BLEND = os.path.join(REPO, "art", "src", "aircraft", "air_medevac_heli.blend")
UNIT = "air_medevac_heli"

# --- measured on the Yanshuf (see the docstring) ----------------------------
DOOR_X = (0.01, 0.45)         # the right cabin door's opening, along x
DOOR_TOP_Z = 1.01
CABIN_HALF_Y = 0.43           # the cabin wall at the door
SHOULDER_HALF_Y = 0.36        # above the door, where the roof starts to round
BAND_X = -1.45                # on the tail boom, clear of the stabilator (x ~ -2.0)
BAND_LEN = 0.20
BAND_PROUD = 0.02
STUB_X = (-0.80, -0.20)       # aft of the door, under the rotor disc
STUB_Z = 0.82
STUB_TIP_Y = 1.00             # half-span to the tip, before --scale
STUB_THICK = 0.05
TANK_R, TANK_L = 0.13, 0.86   # before --scale
PYLON = (0.07, 0.05, 0.10)
PANNIER_X = (-0.45, 0.05)     # a litter pannier on each cabin side, aft of the door gun
PANNIER_Z = (0.42, 0.68)
SIDES = 12
# The scale that shipped: 1.0 read IoU 0.9003 against heli_yanshuf (over the 0.88 limit),
# 1.15 0.8742, 1.3 0.8429, 1.5 0.7977 -- the approved fallback (larger tanks, cabin-side
# litter pannier), taken at the smallest round step that leaves a margin.
SHIPPED_SCALE = 1.3

CREDIT = (
    "Nachlieli Medevac -- a variant of the shipped UH-60 Yanshuf (AI-generated, Meshy "
    "text-to-3d remesh export, disclosed per CONTRIBUTING.md): heli_yanshuf.glb re-opened "
    "and fitted with a rescue hoist, two external tanks, litter panniers and a tail band "
    "built from primitives for Roaring Lions. GH-709 / GH-707 P2."
)


def log(msg):
    print(f"[{UNIT}] {msg}")


def _finish(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def box(name, size, at, bevel=0.0, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Translation(Vector(at))
    if rot is not None:
        m = m @ rot
    m = m @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    if bevel > 0.0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES")
    return _finish(name, bm)


def cyl_between(name, p0, p1, radius, sides=8):
    """A closed cylinder from p0 to p1."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides,
                          radius1=radius, radius2=radius, depth=d.length)
    q = d.normalized().to_track_quat("Z", "Y")
    m = Matrix.Translation((a + b) / 2.0) @ q.to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _finish(name, bm)


def spindle(name, radius, length, at, sides=SIDES, taper=(0.55, 0.45)):
    """A drop tank: a cylinder along X whose two end rings are narrowed, with
    a second ring pair so the nose reads as a dome and not a cone."""
    bm = bmesh.new()
    n = sides
    rings = [(-0.5, taper[0] * 0.55), (-0.42, taper[0] * 0.92), (-0.3, 1.0), (0.3, 1.0),
             (0.42, taper[1] * 1.55 if taper[1] * 1.55 < 1.0 else 0.95), (0.5, taper[1] * 0.55)]
    verts = []
    for fx, fr in rings:
        ring = []
        for k in range(n):
            ang = 2.0 * math.pi * k / n
            ring.append(bm.verts.new((fx * length, radius * fr * math.cos(ang), radius * fr * math.sin(ang))))
        verts.append(ring)
    for i in range(len(rings) - 1):
        for k in range(n):
            j = (k + 1) % n
            bm.faces.new((verts[i][k], verts[i][j], verts[i + 1][j], verts[i + 1][k]))
    bm.faces.new(verts[0][::-1])
    bm.faces.new(verts[-1])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(at)), verts=bm.verts)
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
    ob["rl_part"] = "medevac"
    ob.data.validate()
    for poly in ob.data.polygons:
        poly.use_smooth = False
    return ob


def _coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def build_parts(hull_co, scale):
    hull_p, metal_p, plate_p = [], [], []

    # --- the tail boom band, sized off the boom's own section there ---------
    def section(x):
        w = hull_co[(np.abs(hull_co[:, 0] - x) < 0.04) & (hull_co[:, 2] > 0.35) & (np.abs(hull_co[:, 1]) < 0.45)]
        if len(w) < 20:
            raise SystemExit(f"no tail boom at x={x}")
        lo, hi = w.min(0), w.max(0)
        return (lo + hi) / 2.0, (hi - lo) / 2.0
    c0, r0 = section(BAND_X - 0.20)
    c1, r1 = section(BAND_X + 0.20)
    c, r = section(BAND_X)
    if r[1] > 0.40:
        raise SystemExit(f"the boom section at x={BAND_X} is {r[1]:.2f} half-wide: that is the stabilator, not the boom")
    pitch = math.atan2(c0[2] - c1[2], (BAND_X + 0.20) - (BAND_X - 0.20))   # the boom rises aft
    log(f"tail boom at x {BAND_X}: centre {tuple(round(float(v), 3) for v in c)}, half-section "
        f"{tuple(round(float(v), 3) for v in r)}, climbs {math.degrees(pitch):.1f} deg aft")
    bm = bmesh.new()
    n = 24
    rings = []
    for fx in (-0.5, 0.5):
        ring = []
        for k in range(n):
            ang = 2.0 * math.pi * k / n
            ring.append(bm.verts.new((fx * BAND_LEN, (r[1] + BAND_PROUD) * math.cos(ang), (r[2] + BAND_PROUD) * math.sin(ang))))
        rings.append(ring)
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((rings[0][k], rings[0][j], rings[1][j], rings[1][k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[1])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector((BAND_X, c[1], c[2]))) @ Matrix.Rotation(-pitch, 4, "Y"),
                        verts=bm.verts)
    plate_p.append(_finish("band", bm))

    # --- the rescue hoist over the right cabin door (-Y) ---------------------
    dx = (DOOR_X[0] + DOOR_X[1]) / 2.0
    zb = DOOR_TOP_Z + 0.06
    y0 = -SHOULDER_HALF_Y            # the mast stands on the shoulder above the door
    mast_top = (dx, y0 - 0.02, zb + 0.22)
    tip = (dx, y0 - 0.90, zb + 0.12)  # the arm runs ~0.9 m out and a little down
    metal_p.append(box("hoist_base", (0.20, 0.16, 0.05), (dx, y0 + 0.01, zb + 0.025)))
    metal_p.append(cyl_between("hoist_mast", (dx, y0, zb), mast_top, 0.032, sides=8))
    metal_p.append(cyl_between("hoist_boom", mast_top, tip, 0.026, sides=8))
    metal_p.append(cyl_between("hoist_brace", (dx, y0 - 0.02, zb + 0.05), (dx, y0 - 0.55, zb + 0.15), 0.016, sides=6))
    reel_at = (dx, y0 - 0.14, zb + 0.22)
    metal_p.append(cyl_between("hoist_reel", (reel_at[0] - 0.09, reel_at[1], reel_at[2]),
                               (reel_at[0] + 0.09, reel_at[1], reel_at[2]), 0.075, sides=12))
    metal_p.append(box("hoist_tip", (0.07, 0.07, 0.06), (tip[0], tip[1] - 0.02, tip[2]), bevel=0.01))
    cable_bottom = (tip[0], tip[1] - 0.02, tip[2] - 0.42)
    metal_p.append(cyl_between("hoist_cable", (tip[0], tip[1] - 0.02, tip[2] - 0.03), cable_bottom, 0.010, sides=6))
    metal_p.append(box("hoist_hook", (0.06, 0.05, 0.09), (cable_bottom[0], cable_bottom[1], cable_bottom[2] - 0.045), bevel=0.01))

    # --- stub wings, pylons and external tanks, both sides -------------------
    x_mid = (STUB_X[0] + STUB_X[1]) / 2.0
    chord = (STUB_X[1] - STUB_X[0])
    tip_y = STUB_TIP_Y * scale
    root_y = 0.34
    span = tip_y - root_y
    tr, tl = TANK_R * scale, TANK_L * scale
    for sgn in (-1.0, 1.0):
        yc = sgn * (root_y + span / 2.0)
        hull_p.append(box(f"stub{sgn:+.0f}", (chord, span + 0.04, STUB_THICK), (x_mid, yc, STUB_Z), bevel=0.01))
        for px in (x_mid - 0.17, x_mid + 0.17):
            hull_p.append(box(f"pylon{sgn:+.0f}", PYLON, (px, sgn * (tip_y - 0.12), STUB_Z - STUB_THICK / 2.0 - PYLON[2] / 2.0 + 0.01)))
        z_tank = STUB_Z - STUB_THICK / 2.0 - PYLON[2] - tr + 0.03
        hull_p.append(spindle(f"tank{sgn:+.0f}", tr, tl, (x_mid, sgn * (tip_y - 0.12), z_tank)))
        metal_p.append(cyl_between(f"strut{sgn:+.0f}", (x_mid, sgn * 0.40, STUB_Z - 0.35), (x_mid, sgn * (root_y + span * 0.55), STUB_Z - 0.02), 0.018, sides=6))

    # --- the litter panniers: a long box on each cabin side, aft of the door --
    px0, px1 = PANNIER_X
    z0, z1 = PANNIER_Z
    for sgn in (-1.0, 1.0):
        pw = 0.10 * scale
        hull_p.append(box(f"pannier{sgn:+.0f}", ((px1 - px0), pw, (z1 - z0)),
                          ((px0 + px1) / 2.0, sgn * (CABIN_HALF_Y + pw / 2.0 - 0.01), (z0 + z1) / 2.0), bevel=0.02))
        for fx in (px0 + 0.08, px1 - 0.08):
            metal_p.append(box(f"pannier_latch{sgn:+.0f}", (0.04, 0.03, 0.10),
                               (fx, sgn * (CABIN_HALF_Y + pw + 0.005), (z0 + z1) / 2.0)))
    return hull_p, metal_p, plate_p


def export(scale=SHIPPED_SCALE, out_path=OUT):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC, import_scene_extras=True)

    kit = [o for o in bpy.data.objects if o.name.startswith("kit_")]
    for o in kit:
        bpy.data.objects.remove(o, do_unlink=True)
    log(f"dropped {len(kit)} imported kit_* object(s)")
    # By PREFIX, like the ambulance exporter: a WRECK_ node nested below another (not a direct
    # child of death_root) would otherwise survive, unparented, into the export.
    doomed = [o for o in bpy.data.objects if o.name.startswith("WRECK_") or o.name == "death_root"]
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    log(f"stripped death_root and every WRECK_* node ({len(doomed)} object(s))")
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()
    for key in list(bpy.context.scene.keys()):
        if key != "_RNA_UI":
            del bpy.context.scene[key]
    for mat in bpy.data.materials:
        if "rl_bake_luma" in mat:
            del mat["rl_bake_luma"]

    hull = bpy.data.objects["hull_hull"]
    for req in ("rotor_metal", "rotor_pivot", "rotor_tilt"):
        if req not in bpy.data.objects:
            raise SystemExit(f"{SRC} has no {req!r} -- not the Yanshuf export this file expects")
    hull_co = _coords(hull)
    # The door the numbers above were read off must be where they say.
    cabin = hull_co[(hull_co[:, 0] > 0.2) & (hull_co[:, 0] < 0.4) & (hull_co[:, 2] > 0.5) & (hull_co[:, 2] < 0.9)]
    if abs(float(cabin[:, 1].min()) + CABIN_HALF_Y) > 0.03:
        raise SystemExit(f"the cabin wall reads {float(cabin[:, 1].min()):.3f}, this file was written against {-CABIN_HALF_Y}")

    hull_p, metal_p, plate_p = build_parts(hull_co, scale)
    medevac_hull = _join(hull_p, "medevac_hull", "hull")
    medevac_metal = _join(metal_p, "medevac_metal", "metal")
    medevac_plate = _join(plate_p, "medevac_plate", "plate")

    live = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in live}
    lo = Vector([min(v.co[i] for o in live for v in o.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for o in live for v in o.data.vertices) for i in range(3)])
    log(f"tris {tris} total {sum(tris.values())}; hull-local bounds x[{lo.x:.3f},{hi.x:.3f}] "
        f"y[{lo.y:.3f},{hi.y:.3f}] z[{lo.z:.3f},{hi.z:.3f}]; scale {scale}")

    # The Yanshuf's bake ships at its own size; keep it as it is (see
    # export_veh_ambulance.py for the reasoning).
    for img in bpy.data.images:
        log(f"image {img.name}: {tuple(img.size)} (kept as shipped)")
    if not any(vehicle_textured._basename(i.name) == vehicle_textured.BASE_COLOR_PREFIX for i in bpy.data.images):
        raise SystemExit("no base_color image survived the import")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out_path, CREDIT))
    log(f"wrote {out_path} ({os.path.getsize(out_path)} bytes)")
    if out_path == OUT:
        os.makedirs(os.path.dirname(BLEND), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=BLEND, copy=True)
        log(f"saved {BLEND}")
    return out_path


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    scale = float(argv[argv.index("--scale") + 1]) if "--scale" in argv else SHIPPED_SCALE
    out = argv[argv.index("--out") + 1] if "--out" in argv else OUT
    export(scale=scale, out_path=out)
