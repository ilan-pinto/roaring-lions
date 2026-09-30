"""Export the Peten Gunship -- the shipped `heli_peten.glb` plus stub wings,
four rocket pods, two drop tanks, a mast-top dome and a nose sensor ball.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/vehicles/export_meshy_apache_gunship.py [-- --scale K]

Writes `art/meshes/vehicles/heli_peten_gunship.glb` (E5 part 2, GH-181;
`docs/art/meshy-prompts-e5.md` section 1). Zero Meshy credits: the Gunship is
a VARIANT of the shipped Peten, so its source is the Peten's own export --
`art/meshes/vehicles/heli_peten.glb`, written by `export_meshy_apache.py`
from the supplied 787k-vertex Meshy scan -- re-opened here, not the scan
re-cut. Everything that export decided (orientation, the 4.684 m drawn size,
the rotor cut along Meshy's own segmentation seams, the tilted
`rotor_tilt -> rotor_pivot -> rotor_metal` graph, the canopy box) is
inherited byte-for-byte in meaning; what this file adds is geometry.

## What is added, and where the numbers come from

Every added part is sized against the Peten's OWN measured hull, never
typed from a real airframe: the fuselage half-width and height at the wing
station are read off `hull_hull`'s vertices, the nose extent off the same
mesh, the mast off `rotor_pivot`'s world position. Real-Apache proportions
enter only as RATIOS (stub-wing span ~0.35 of fuselage length, radome
~0.12) applied to the 4.37 m hull this model actually has. `--scale K`
multiplies the span/store sizes for the IoU search described below.

  stores_hull   the two stub wings (boxes, slight anhedral), their three
                pylons each, and the two drop tanks on the inboard pylons
  stores_metal  the four rocket pods (two per wing, outer pylons) and the
                mast: a rod through the rotor hub with a flat dome on top
  sensor_glass  a sensor ball under the nose, above the chin gun

Nothing traverses, so no `turret_pivot`; the rotor graph is the Peten's.

## One material, deliberately

The Peten ships its Meshy `base_color` bake (`TEXTURED_VEHICLE_TYPES`). The
runtime's textured branch is decided per MESH, so a bare palette part beside
the bake would be legal -- and would draw in a second register on one hull,
which is what the bake exists to avoid. Instead every added part takes the
hull's material with ALL of its UV loops pinned to one texel: the face of
`hull_hull` whose baked colour is nearest the MEDIAN colour of the whole
hull (sampled at every face's UV centroid), so the pods read as the same
worn olive as the fuselage and the runtime sun does the shading. This is
`import_meshy_kdf_team.py`'s `_pin_uv` idea applied to a vehicle.

## Wreck and clips

The imported file carries the wreck pass's `death_root`/`WRECK_*` subtree and
its `idle`/`wreck` clips; both are stripped here and rebuilt by
`pnpm wreck:meshes -- --id=heli_peten_gunship` (recipe `air` + `rotor_pivot`,
like the Peten), because the wreck must include the new stores.

## Verified on the EXPORT, not on this script

The output is re-opened by `tools/render_mesh_gate.py` and its silhouette
compared with `heli_peten`'s at 64 px -- the named risk (design §6) is IoU
>= 0.88 against the Peten, since the wings sit under the rotor disc, which
the 30-degree camera mostly covers. The stores are grown through `--scale`
until the gate reads under 0.88, and the number that shipped is recorded in
`docs/ASSET_PROVENANCE.md`.

AI-generated source (Meshy, the supplied Peten), disclosed per CONTRIBUTING.md.
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
SRC = os.path.join(REPO, "art", "meshes", "vehicles", "heli_peten.glb")
OUT = os.path.join(REPO, "art", "meshes", "vehicles", "heli_peten_gunship.glb")
UNIT = "heli_peten_gunship"

# --- ratios of the measured hull (see the docstring) ------------------------
WING_STATION = (-0.12, 0.40)     # x band, metres, aft of the canopy's rear third
WING_CHORD = 0.50
WING_THICK = 0.07
WING_TIP_ABS_Y = 1.16            # half-span to the tip, from the hull centreline
WING_ANHEDRAL_DEG = 6.0
WING_HEIGHT_FRAC = 0.62          # of the fuselage height at the station
PYLON_ABS_Y = (0.64, 0.86, 1.04)  # inboard (tank), mid (pod), outer (pod)
PYLON_SIZE = (0.10, 0.05, 0.11)
POD_R, POD_L = 0.085, 0.56
TANK_R, TANK_L = 0.12, 0.80
MAST_R = 0.035
DOME_R, DOME_H = 0.26, 0.13      # radome radius and half-height
DOME_CLEAR = 0.03                # above the rotor mesh's own top at the hub
SENSOR_R = 0.11
SENSOR_Z = 0.62
SIDES = 12

CREDIT = (
    "Peten Gunship -- a variant of the shipped AH-64 Peten (AI-generated, Meshy "
    "image-to-3d-texture export, disclosed per CONTRIBUTING.md): heli_peten.glb re-opened "
    "and fitted with stub wings, four rocket pods, two drop tanks, a mast dome and a nose "
    "sensor ball built from primitives for Roaring Lions, all UV-pinned to the Peten's own "
    "base_color bake. E5 part 2 (GH-181)."
)


def log(msg):
    print(f"[{UNIT}] {msg}")


# ---------------------------------------------------------------------------
# geometry helpers -- plain bmesh primitives carrying rl_role / rl_part
# ---------------------------------------------------------------------------

def _finish(name, bm, role, part):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob["rl_role"] = role
    ob["rl_part"] = part
    return ob


def box(name, size, at, role, part, matrix=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    m = Matrix.Translation(Vector(at)) @ Matrix.Diagonal((sx, sy, sz, 1.0))
    if matrix is not None:
        m = matrix @ m
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _finish(name, bm, role, part)


def cyl_x(name, radius, length, at, role, part, sides=SIDES, taper=(1.0, 1.0)):
    """A closed cylinder along +X centred at `at`; `taper` scales the aft and
    fore end rings (a drop tank narrows at both ends)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides,
                          radius1=radius * taper[0], radius2=radius * taper[1], depth=length)
    # create_cone builds along Z; turn it to X.
    m = Matrix.Translation(Vector(at)) @ Matrix.Rotation(math.radians(90.0), 4, "Y")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _finish(name, bm, role, part)


def cyl_z(name, radius, length, at, role, part, sides=SIDES):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides,
                          radius1=radius, radius2=radius, depth=length)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(at)), verts=bm.verts)
    return _finish(name, bm, role, part)


def ball(name, radii, at, role, part, segments=SIDES, rings=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    rx, ry, rz = radii
    m = Matrix.Translation(Vector(at)) @ Matrix.Diagonal((rx, ry, rz, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _finish(name, bm, role, part)


def _coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


# ---------------------------------------------------------------------------
# the texel every added part takes
# ---------------------------------------------------------------------------

def _median_hull_uv(hull, img):
    """(u, v) of the hull face whose baked colour is nearest the median
    baked colour of the whole hull -- sampled at each face's UV centroid."""
    me = hull.data
    uv = me.uv_layers.active.data
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3]
    uvs = np.array([np.mean([tuple(uv[li].uv) for li in poly.loop_indices], axis=0)
                    for poly in me.polygons], dtype=np.float64)
    cols = np.array([px[min(h - 1, max(0, int(v * h))), min(w - 1, max(0, int(u * w)))]
                     for u, v in uvs])
    median = np.median(cols, axis=0)
    i = int(np.argmin(((cols - median) ** 2).sum(axis=1)))
    log(f"hull bake median rgb {tuple(round(float(c), 3) for c in median)}; pinning to face {i} "
        f"uv {tuple(round(float(c), 4) for c in uvs[i])} rgb {tuple(round(float(c), 3) for c in cols[i])}")
    return float(uvs[i][0]), float(uvs[i][1])


def _pin(ob, uv_point, mat, layer_name):
    layer = ob.data.uv_layers.new(name=layer_name)
    for loop in layer.data:
        loop.uv = uv_point
    ob.data.materials.append(mat)


def _join(objs, name, role, part):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    ob["rl_role"] = role
    ob["rl_part"] = part
    return ob


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

def export(scale=1.0, out_path=OUT):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC, import_scene_extras=True)

    # Strip the wreck pass's subtree and clips; the pass rebuilds both.
    death = bpy.data.objects.get("death_root")
    if death is not None:
        doomed = [death] + [o for o in bpy.data.objects if o.parent == death]
        for o in doomed:
            bpy.data.objects.remove(o, do_unlink=True)
        log(f"stripped death_root and {len(doomed) - 1} WRECK_ node(s)")
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()

    hull = bpy.data.objects["hull_hull"]
    rotor = bpy.data.objects["rotor_metal"]
    pivot = bpy.data.objects["rotor_pivot"]
    for req in ("hull_glass", "hull_metal", "rotor_tilt"):
        if req not in bpy.data.objects:
            raise SystemExit(f"{SRC} has no {req!r} -- not the Peten export this file expects")
    mat = hull.data.materials[0]
    img = next(i for i in bpy.data.images if i.name.split(".")[0] == vehicle_textured.BASE_COLOR_PREFIX)
    layer_name = hull.data.uv_layers.active.name
    uv_pin = _median_hull_uv(hull, img)

    # --- measure the hull at the wing station ------------------------------
    co = _coords(hull)
    x0, x1 = WING_STATION
    band = co[(co[:, 0] > x0) & (co[:, 0] < x1)]
    core = band[np.abs(band[:, 1]) < 0.25]
    z_lo, z_hi = float(core[:, 2].min()), float(core[:, 2].max())
    z_wing = z_lo + WING_HEIGHT_FRAC * (z_hi - z_lo)
    side = band[np.abs(band[:, 2] - z_wing) < 0.08]
    w_root = float(np.percentile(np.abs(side[:, 1]), 90))
    nose = co[(np.abs(co[:, 1]) < 0.15) & (np.abs(co[:, 2] - SENSOR_Z) < 0.08)]
    x_nose = float(nose[:, 0].max())
    hub = pivot.matrix_world.translation.copy()
    rz = _coords(rotor)
    rotor_top = float(rz[np.hypot(rz[:, 0] - hub.x, rz[:, 1] - hub.y) < 0.35][:, 2].max())
    log(f"station x[{x0},{x1}]: fuselage z[{z_lo:.3f},{z_hi:.3f}] -> wing z {z_wing:.3f}, "
        f"half-width {w_root:.3f}; nose x {x_nose:.3f} at z {SENSOR_Z}; hub {tuple(round(c, 3) for c in hub)}, "
        f"rotor top at hub {rotor_top:.3f}; scale {scale}")

    # --- stores --------------------------------------------------------------
    x_mid = (x0 + x1) / 2.0
    tip = WING_TIP_ABS_Y * scale
    hull_parts, metal_parts = [], []
    for sgn in (-1.0, 1.0):
        root = w_root - 0.06
        span = tip - root
        yc = sgn * (root + span / 2.0)
        drop = math.tan(math.radians(WING_ANHEDRAL_DEG)) * span / 2.0
        anh = Matrix.Translation((x_mid, yc, z_wing)) @ Matrix.Rotation(
            math.radians(-sgn * WING_ANHEDRAL_DEG), 4, "X") @ Matrix.Translation((-x_mid, -yc, -z_wing))
        hull_parts.append(box(f"wing{'L' if sgn > 0 else 'R'}", (WING_CHORD, span + 0.02, WING_THICK),
                              (x_mid, yc, z_wing), "hull", "stores", matrix=anh))
        for k, ay in enumerate(PYLON_ABS_Y):
            y = sgn * ay * scale
            # the wing's centreline height at this station, on the anhedral
            zw = z_wing - (ay * scale - (root + span / 2.0)) * math.tan(math.radians(WING_ANHEDRAL_DEG))
            hull_parts.append(box(f"pylon{k}{sgn:+.0f}", PYLON_SIZE,
                                  (x_mid, y, zw - WING_THICK / 2.0 - PYLON_SIZE[2] / 2.0 + 0.01),
                                  "hull", "stores"))
            z_store_top = zw - WING_THICK / 2.0 - PYLON_SIZE[2] + 0.01
            if k == 0:
                r = TANK_R * scale
                hull_parts.append(cyl_x(f"tank{sgn:+.0f}", r, TANK_L * scale, (x_mid + 0.05, y, z_store_top - r),
                                        "hull", "stores", taper=(0.55, 0.45)))
            else:
                r = POD_R * scale
                metal_parts.append(cyl_x(f"pod{k}{sgn:+.0f}", r, POD_L * scale, (x_mid + 0.02, y, z_store_top - r),
                                         "metal", "stores"))

    # --- mast and dome -------------------------------------------------------
    dome_z = rotor_top + DOME_CLEAR + DOME_H * scale
    metal_parts.append(cyl_z("mast", MAST_R, dome_z - hub.z, (hub.x, hub.y, (hub.z + dome_z) / 2.0), "metal", "stores"))
    metal_parts.append(ball("dome", (DOME_R * scale, DOME_R * scale, DOME_H * scale), (hub.x, hub.y, dome_z),
                            "metal", "stores"))

    # --- nose sensor ---------------------------------------------------------
    sensor = ball("sensor", (SENSOR_R,) * 3, (x_nose + SENSOR_R * 0.55, 0.0, SENSOR_Z), "glass", "sensor")

    for ob in hull_parts + metal_parts + [sensor]:
        _pin(ob, uv_pin, mat, layer_name)
    stores_hull = _join(hull_parts, "stores_hull", "hull", "stores")
    stores_metal = _join(metal_parts, "stores_metal", "metal", "stores")
    sensor_glass = _join([sensor], "sensor_glass", "glass", "sensor")
    added = [stores_hull, stores_metal, sensor_glass]
    for ob in added:
        ob.data.validate()
        for poly in ob.data.polygons:
            poly.use_smooth = False

    live = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in live}
    lo = Vector([min(v.co[i] for o in live for v in o.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for o in live for v in o.data.vertices) for i in range(3)])
    log(f"tris {tris} total {sum(tris.values())}; bounds x[{lo.x:.3f},{hi.x:.3f}] y[{lo.y:.3f},{hi.y:.3f}] "
        f"z[{lo.z:.3f},{hi.z:.3f}]")

    kept, _dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        log(f"image {name}: {before} -> {after}")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out_path, CREDIT))
    log(f"wrote {out_path} ({os.path.getsize(out_path)} bytes)")
    return out_path


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    scale = float(argv[argv.index("--scale") + 1]) if "--scale" in argv else 1.0
    out = argv[argv.index("--out") + 1] if "--out" in argv else OUT
    export(scale=scale, out_path=out)
