"""Build the command Lavi -- `officer_armour` (GH-298, Capt. Ronen Heled) --
from the SHIPPED `mbt_lavi.glb`, at 0 credits.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/vehicles/export_officer_armour.py

Writes `art/meshes/vehicles/officer_armour.glb`. Then, in order:
`pnpm wreck:meshes -- --id=officer_armour`, `pnpm encode:meshes`,
`pnpm validate:meshes`.

SOURCE: `art/meshes/vehicles/mbt_lavi.glb` -- itself `tools/vehicles/
export_meshy_tank.py`'s cut of a Meshy tank (AI-generated, disclosed per
CONTRIBUTING.md; `docs/ASSET_PROVENANCE.md`). The shipped GLB rather than the
gitignored `art/blend/KDF/tank/` source, so a fresh clone can rebuild this
file, and so the command tank cannot drift from the Lavi beside it: the same
bytes, the same bake, the same four nodes and the same `turret_pivot`.

THE VARIANT. Spec §7's silhouette levers, all kit geometry in real metres,
positioned from a probe of the imported file (roof top z 2.12, the turret's
own two antenna stubs at the rear-left corner reaching z 3.14, pivot at
(-0.117, -0.006, 1.609)):

  * a raised commander's cupola on the turret roof (a tapered ring with a
    lid and a periscope block), the "raised commander's sight";
  * a telescoping mast behind the turret in three stepped tubes to z ~4.8 m,
    with a crossbar antenna head -- the "tall telescoping mast";
  * two whip antennas at the turret's rear corners.

WHY THE MAST IS WHAT MOVES THE IoU. `validate_mesh_assets.py` fits the gate's
camera to each unit's OWN bounds before rendering and comparing 64 px masks,
so a thin mast, which rasterises to a pixel, still doubles the box the tank
is framed in: the hull draws smaller and lower in its frame than the Lavi
does in its own. That is a real profile difference at gameplay zoom -- a
vertical line a tile and a half tall over the turret -- and it is what R8
(spec §9) is measured against, on the export, before anything else is decided.

TEXTURE. Every added part gets a UV layer pinned to the UV centroid of the
nearest face of the part it sits on -- the roof for the cupola (olive paint),
the antenna stubs for the mast and whips (gunmetal) -- and is then JOINED into
`turret_hull` / `turret_metal`. The four live nodes therefore keep the Lavi's
names, extras, material and one primitive each, which is what the vehicle
loader's per-mesh textured branch, the wreck pass's per-node recipe and the
`{part}_{role}` contract all read. The same trick `import_meshy_kdf_team.py`'s
`_pin_uv` uses for a blob joint. The imported `death_root`, its `WRECK_*`
twins and the two clips are deleted before export: the wreck pass rebuilds
them for the new geometry, and a stale wreck missing the mast would be a
second, wrong silhouette.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, TOOLS)

import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary
import textured as vehicle_textured  # noqa: E402

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(REPO, "art", "meshes", "vehicles", "mbt_lavi.glb")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "officer_armour.glb")

#: World-space (z up, +X forward) placements, from the probe in the docstring.
ROOF_Z = 2.12
CUPOLA_AT = (-0.85, -0.30)          # turret roof, camera-side of centre
CUPOLA_R0, CUPOLA_R1, CUPOLA_H = 0.34, 0.30, 0.32
MAST_AT = (-1.92, 0.52)             # rear deck, opposite corner to the Lavi's own stubs
MAST_SEGMENTS = ((0.060, 1.95, 3.20), (0.045, 3.20, 4.10), (0.030, 4.10, 4.80))
MAST_HEAD_Z = 4.80
WHIP_AT = ((-2.05, 0.88), (-2.05, -0.88))
WHIP_LEN, WHIP_R, WHIP_PITCH_DEG, WHIP_BASE_Z = 1.60, 0.012, 82.0, 1.95


def log(msg):
    print(f"[officer_armour] {msg}")


# ---------------------------------------------------------------------------
# kit geometry, built as vertices in world space (no object transforms, like
# tools/units/kit.py: the exporter applies transforms, but the probe below
# reads vertex data and a transform left on an object would lie to it)
# ---------------------------------------------------------------------------

def _mesh(name, verts, faces, role):
    if role not in vehicle_kit.ROLES:
        raise SystemExit(f"{name}: role {role!r} outside tools/vehicles/kit.py's ROLES")
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob["rl_role"] = role
    bpy.context.collection.objects.link(ob)
    return ob


def _ring_solid(name, rings, role, sides=10):
    """A capped solid through a list of (radius, z) rings around (x, y)."""
    (cx, cy), rings = rings[0], rings[1]
    verts, faces = [], []
    for r, z in rings:
        for k in range(sides):
            a = 2.0 * math.pi * k / sides
            verts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
    n = len(rings)
    for i in range(n - 1):
        for k in range(sides):
            a0, a1 = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a0, a1, a1 + sides, a0 + sides))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((n - 1) * sides, n * sides)))
    return _mesh(name, verts, faces, role)


def _box(name, size, at, role):
    sx, sy, sz = (s / 2.0 for s in size)
    cx, cy, cz = at
    verts = [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return _mesh(name, verts, faces, role)


def _whip(name, base, length, radius, pitch_deg, role, sides=6):
    """A thin rod from `base` leaning back (toward -X) by `pitch_deg` from vertical."""
    bx, by, bz = base
    p = math.radians(pitch_deg)
    axis = Vector((-math.cos(p), 0.0, math.sin(p)))
    tip = Vector(base) + axis * length
    u = Vector((0.0, 1.0, 0.0))
    v = axis.cross(u).normalized()
    verts, faces = [], []
    for c in (Vector(base), tip):
        for k in range(sides):
            a = 2.0 * math.pi * k / sides
            verts.append(tuple(c + (u * math.cos(a) + v * math.sin(a)) * radius))
    for k in range(sides):
        faces.append((k, (k + 1) % sides, sides + (k + 1) % sides, sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, 2 * sides)))
    return _mesh(name, verts, faces, role)


def build_additions():
    cx, cy = CUPOLA_AT
    cup = [
        _ring_solid("cupola_ring", ((cx, cy), [(CUPOLA_R0, ROOF_Z - 0.04), (CUPOLA_R0, ROOF_Z + 0.10),
                                               (CUPOLA_R1, ROOF_Z + CUPOLA_H)]), "hull"),
        _ring_solid("cupola_lid", ((cx - 0.04, cy), [(CUPOLA_R1 * 0.92, ROOF_Z + CUPOLA_H - 0.01),
                                                      (CUPOLA_R1 * 0.80, ROOF_Z + CUPOLA_H + 0.07)]), "hull"),
        _box("cupola_sight", (0.22, 0.18, 0.14), (cx + 0.30, cy, ROOF_Z + 0.22), "metal"),
    ]
    mx, my = MAST_AT
    mast = []
    for i, (r, z0, z1) in enumerate(MAST_SEGMENTS):
        mast.append(_ring_solid(f"mast_{i}", ((mx, my), [(r, z0), (r, z1)]), "metal", sides=8))
    mast.append(_box("mast_head", (0.14, 0.62, 0.05), (mx, my, MAST_HEAD_Z + 0.02), "metal"))
    mast.append(_box("mast_box", (0.18, 0.18, 0.12), (mx, my, MAST_HEAD_Z + 0.10), "metal"))
    mast.append(_box("mast_foot", (0.30, 0.30, 0.16), (mx, my, MAST_SEGMENTS[0][1] + 0.04), "metal"))
    whips = [
        _whip(f"whip_{i}", (wx, wy, WHIP_BASE_Z), WHIP_LEN, WHIP_R, WHIP_PITCH_DEG, "metal")
        for i, (wx, wy) in enumerate(WHIP_AT)
    ]
    return {"turret_hull": [cup[0], cup[1]], "turret_metal": [cup[2]] + mast + whips}


# ---------------------------------------------------------------------------
# texture pinning and joining
# ---------------------------------------------------------------------------

def _world_face_uv_table(ob):
    me = ob.data
    uv = me.uv_layers.active.data
    cents, uvs = [], []
    for poly in me.polygons:
        cents.append(tuple(ob.matrix_world @ poly.center))
        uvs.append(tuple(np.mean([tuple(uv[li].uv) for li in poly.loop_indices], axis=0)))
    return np.array(cents, dtype=np.float64), np.array(uvs, dtype=np.float64)


def _pin_uv(part, cents, uvs, mat, uv_name):
    """One UV for every loop: the UV centroid of the host part's face nearest
    the added part's own centre. Reads as the paint it sits on."""
    co = np.array([tuple(v.co) for v in part.data.vertices]).mean(axis=0)
    i = int(np.argmin(((cents - co) ** 2).sum(axis=1)))
    layer = part.data.uv_layers.new(name=uv_name)
    for loop in layer.data:
        loop.uv = (float(uvs[i][0]), float(uvs[i][1]))
    part.data.materials.append(mat)
    return i


def _join_into(host, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    host.select_set(True)
    bpy.context.view_layer.objects.active = host
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def export():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC, import_scene_extras=True)
    objs = {o.name: o for o in bpy.data.objects}
    for need in ("hull_hull", "hull_rubber", "turret_hull", "turret_metal", "turret_pivot"):
        if need not in objs:
            raise SystemExit(f"{SRC}: no object {need!r} -- not the Lavi this script was written against")

    # The imported wreck and its clips: rebuilt by `pnpm wreck:meshes`.
    dead = [o for o in bpy.data.objects if o.name == "death_root" or o.name.startswith("WRECK_")]
    for o in dead:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()
    log(f"dropped {len(dead)} imported wreck object(s) and the idle/wreck clips")

    mat = objs["turret_hull"].data.materials[0]
    if mat is not objs["turret_metal"].data.materials[0]:
        raise SystemExit("turret_hull and turret_metal do not share one material -- not the shipped Lavi")
    uv_name = objs["turret_hull"].data.uv_layers.active.name

    additions = build_additions()
    for host_name, parts in additions.items():
        host = objs[host_name]
        cents, uvs = _world_face_uv_table(host)
        before = len(host.data.polygons)
        for p in parts:
            i = _pin_uv(p, cents, uvs, mat, uv_name)
            log(f"{p.name}: {len(p.data.polygons)} faces, UV pinned to {host_name} face {i} at "
                f"{tuple(round(c, 2) for c in cents[i])}")
        joined = _join_into(host, parts)
        objs[host_name] = joined
        log(f"{host_name}: {before} -> {len(joined.data.polygons)} faces, parent {joined.parent.name}, "
            f"role {joined.get('rl_role')!r}, part {joined.get('rl_part')!r}, "
            f"{len(joined.data.materials)} material slot(s)")

    for name in ("hull_hull", "hull_rubber", "turret_hull", "turret_metal"):
        ob = objs[name]
        if len([m for m in ob.data.materials if m is not None]) != 1:
            raise SystemExit(f"{name}: expected one material after the join")
        co = np.array([tuple(ob.matrix_world @ v.co) for v in ob.data.vertices])
        log(f"{name}: world z {co[:, 2].min():.2f}..{co[:, 2].max():.2f}, x {co[:, 0].min():.2f}..{co[:, 0].max():.2f}")

    kept, dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        log(f"shipping {name!r} at {after[0]}x{after[1]} (was {before[0]}x{before[1]})")

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    kwargs = vehicle_textured.gltf_kwargs(
        OUT_PATH,
        "Command Lavi (officer_armour) -- the shipped mbt_lavi.glb (AI-generated, Meshy, "
        "disclosed per CONTRIBUTING.md) with a kit cupola, telescoping mast and whip antennas "
        "joined into its own four nodes; ships the Lavi's own base_color bake",
    )
    # The source bake is already a JPEG packed in the GLB; AUTO writes those
    # bytes through rather than re-encoding a JPEG a second time.
    kwargs["export_image_format"] = "AUTO"
    bpy.ops.export_scene.gltf(**kwargs)
    log(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)")
    return OUT_PATH


if __name__ == "__main__":
    export()
