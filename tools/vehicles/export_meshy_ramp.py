"""Export the A3.2 ramp vehicles -- `dozer_d9` and `scout_shachaf` -- from
their Meshy text-to-3D remeshes as TEXTURED vehicle glTFs, mesh contract v2
(GH-185, 2026-09-30; numbers and prompts in `docs/art/meshy-prompts-ramp.md`).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_ramp.py -- scout_shachaf [--probe]

One spec-driven module for both, the `export_meshy_apc.py` shape on
`art/b0a-meshy` (that file lands with B0a; this one carries the same method
for its own two specs so the branches add different files). `--probe` prints
the source's own numbers -- contact-patch clusters, roof bands, the two end
profiles -- and writes nothing; every spec number below was read off a probe
run, never guessed.

THE METHOD, per vehicle (`RampVehicleSpec`):
  1. Import the ledger's LAST `kind: remesh` task named `unit_id` (a remesh
     of a REFINED task keeps its bake -- B0a's measurement); bake the
     importer's transform into the vertices; rename the Base Color image to
     `base_color` so `textured.prepare_vehicle_textures` finds it.
  2. `Rz(rot_z_deg)` so the nose is `+X` (measured on the probe: a wheeled
     hull's roof profile is LOW at the glacis; the dozer's blade end is the
     x extreme with the most vertical plate area).
  3. `hull_rubber`: wheeled -- every face whose centroid sits inside a wheel
     disc (radius `wheel_r` around an axle found as the contact-patch
     centroid near each `axle_seeds_x`, outboard of `wheel_ay`); tracked --
     every face outboard of `track_ay` and below `track_z_top`, the track
     band. `rubber` is what the wreck pass leaves on the ground.
  4. Scale the longest axis to the sprite manifest's `realMetres` (read,
     never typed), ground at z = 0, footprint centred on the origin.
  5. Optional kit parts: `turret_pivot` (`extras.rl_pivot = "turret"`) at
     the roof ring's measured centre carrying `kit.rws` (the Shachaf's
     `cupola_mg`; the barrel runs +x since B0a's kit fix), and a `metal`
     mast box where the remesh dropped the whip (it drops every whip --
     B0a's recon drone lost its mast the same way).
  6. Textures at `textured.TEXTURE_PX`; export through
     `textured.gltf_kwargs`; tri cap. Re-run `pnpm wreck:meshes -- --id=<unit>`.

DETERMINISM: no `mathutils.noise`; every threshold is a constant applied to
the source's own vertex data.
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

#: `scrub_white`: a texel is a marking when every channel is above this and
#: the channels agree to within this spread (image buffer values, linear).
WHITE_MIN = 0.55
WHITE_SPREAD = 0.12
WHITE_DILATE = 6          # texels, on the 2048 base colour
#: `olive_shift`: the green band pulled toward olive, and by how much.
OLIVE_SAT_MIN = 0.22
OLIVE_HUE_LO = 70.0
OLIVE_HUE_HI = 165.0
OLIVE_HUE_SHIFT = 22.0    # degrees toward yellow
OLIVE_SAT_MUL = 0.62
OLIVE_VAL_MUL = 0.80

REPO = os.path.dirname(TOOLS)
MESHY_DIR = os.path.join(REPO, "art", "meshy")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
# Spelled out per unit so `tools/src/mesh_ownership.test.ts` can read, from
# the source alone, which files this script writes.
OUT_DOZER_D9 = os.path.join(OUT_DIR, "dozer_d9.glb")
OUT_SCOUT_SHACHAF = os.path.join(OUT_DIR, "scout_shachaf.glb")
OUTPUTS = {"dozer_d9": OUT_DOZER_D9, "scout_shachaf": OUT_SCOUT_SHACHAF}
TURRET_PIVOT_NODE = "turret_pivot"


@dataclass(frozen=True)
class RampVehicleSpec:
    unit_id: str
    sheet: str
    credit: str
    kind: str                            # "wheeled" | "tracked"
    rot_z_deg: float                     # nose -> +X
    tri_cap: int
    # wheeled -- SOURCE frame, after rot_z
    wheel_r: float = 0.0
    wheel_ay: float = 0.0
    axle_seeds_x: tuple = ()
    axle_half_window: float = 0.12
    axle_min_verts: int = 30
    tyre_z_band: float = 0.06
    # tracked -- SOURCE frame, after rot_z
    track_ay: float = 0.0
    track_z_top: float = 0.0              # absolute z, SOURCE frame
    track_x: tuple = (-9.0, 9.0)          # the tracks' x span; the blade lies beyond it
    # kit parts -- FINAL frame, metres
    rws: Optional[dict] = None           # {size, barrel, ring_seed, search_r, band, max_across}
    mast: Optional[dict] = None          # {at: (x, y), width, height}
    # bake fixes, applied to the base_color pixels before export
    scrub_white: bool = False            # paint out near-white blobs (a marking the prompt forbade)
    olive_shift: bool = False            # pull a grass-green bake toward the roster's olive


def _credit(what):
    return (f"{what} -- AI-generated (Meshy text-to-3D preview + 2k refine + remesh), "
            "disclosed per CONTRIBUTING.md; re-oriented, re-scaled, rubber/hull split "
            "and fitted with kit parts in Blender for Roaring Lions")


SPECS = {
    # D9, measured 2026-09-30 on its 7,901-face remesh with --probe: the blade
    # is the -x end (vertical plate area 1.02 against 0.59 at +x) so Rz(180)
    # puts it at +X; the tracks are the low outboard band |y| 0.366..0.614,
    # z 0..0.373 above the belly line (zmin -0.502), spanning x -0.91..0.72 in
    # the turned frame -- the blade and its push arms lie beyond 0.74. The
    # exhaust stack (roof 1.004) sits on the hood between blade and cab; the
    # ripper is the low +x... now -x end (0.47). No ring, no weapon.
    "dozer_d9": RampVehicleSpec(
        unit_id="dozer_d9", sheet="D9_HULL", credit=_credit("D9 armoured dozer"),
        kind="tracked", rot_z_deg=180.0, tri_cap=10000,
        track_ay=0.36, track_z_top=-0.127, track_x=(-0.95, 0.74),
        scrub_white=True,
    ),
    # Shachaf, measured the same way on its 5,024-face remesh: roof profile
    # low at -x (0.59) and high at +x (0.91, the raised cab), so Rz(180); two
    # contact-patch clusters at source x -0.576 / +0.589 (turned: +0.576 /
    # -0.589), tyres |y| 0.315..0.524, z 0..0.497 (radius ~0.25). The remesh
    # KEPT the sensor mast (a 16-vert column at turned x -0.435, up to z
    # 1.263) and it rises from the centre of the roof ring (117-vert lip at
    # z 0.89-0.91, x -0.54..-0.28, y +-0.12) -- so the kit RWS sits on the
    # ring with the mast through it, the ring's top found under `z_max` so
    # the mast tip is not mistaken for the lip. mpu 4.6 / 1.899 = 2.422.
    "scout_shachaf": RampVehicleSpec(
        unit_id="scout_shachaf", sheet="SHACHAF_HULL", credit=_credit("Shachaf scout car"),
        kind="wheeled", rot_z_deg=180.0, tri_cap=8000,
        wheel_r=0.255, wheel_ay=0.31, axle_seeds_x=(0.576, -0.589),
        rws={"size": (0.55, 0.45, 0.30), "barrel": 0.7, "ring_seed": (-0.99, 0.0),
             "search_r": 0.45, "band": 0.06, "max_across": 0.9, "z_max": 2.22},
        olive_shift=True,
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
                task_id = entry["id"]
    if task_id is None:
        raise SystemExit(f"[{name}] no kind=remesh entry named {name!r} in {ledger}")
    hits = glob.glob(os.path.join(MESHY_DIR, f"{name.replace('_', '-')}-*-{task_id.split('-')[0]}", "model.glb"))
    if len(hits) != 1:
        raise SystemExit(f"[{name}] expected one download dir for remesh task {task_id}, found {hits}")
    return hits[0], task_id


def _read_real_metres(spec):
    with open(os.path.join(REPO, "assets", "sprites", spec.sheet, "manifest.json")) as fh:
        return json.load(fh)["realMetres"]


def _rename_textures(spec, ob):
    mat = ob.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = next((l for l in mat.node_tree.links
                 if l.to_node.name == bsdf.name and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE":
        raise SystemExit(f"[{spec.unit_id}] Base Color is not fed by an image texture")
    base = link.from_node.image
    base.name = vehicle_textured.BASE_COLOR_PREFIX
    for img in bpy.data.images:
        if img.name != base.name and img.name.endswith("metallic_roughness"):
            img.name = "metallic_roughness"
        elif img.name != base.name and img.name.endswith("normal"):
            img.name = "normal"
    print(f"[{spec.unit_id}] images: {[(i.name, tuple(i.size)) for i in bpy.data.images]}")
    return base


def _fill_masked(rgb, mask):
    """Replace every masked texel by the mean of its unmasked 3x3 neighbours,
    growing inward ring by ring until the blob is filled."""
    import numpy as np
    h, w = mask.shape
    fill = rgb.copy()
    todo = mask.copy()
    for _ in range(96):
        if not todo.any():
            break
        ok = (~todo).astype(np.float32)
        acc = np.zeros_like(fill)
        cnt = np.zeros((h, w), dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(fill * ok[..., None], dy, 0), dx, 1)
                cnt += np.roll(np.roll(ok, dy, 0), dx, 1)
        ring = todo & (cnt > 0)
        fill[ring] = acc[ring] / cnt[ring][:, None]
        todo = todo & ~ring
    return fill


def _fix_bake(spec, img):
    """Two pixel operations on the remesh's own base colour, both pure
    numpy over the image buffer, both recorded in the provenance:

    `scrub_white` -- the D9's refine put a white five-point star on each
    hull flank although the prompt asked for no markings. Near-white pixels
    (every channel above WHITE_MIN, spread under WHITE_SPREAD) are replaced
    by the mean of the non-white pixels around them, grown outward until the
    blob is filled; nothing else on an olive hull is that white.

    `olive_shift` -- the Shachaf's bake came back a saturated grass green
    beside the D9's olive. Its green pixels are pulled toward olive in HSV:
    hue toward yellow, saturation and value down. Greys and blacks (tyres,
    fittings) are below the saturation gate and untouched.
    """
    import numpy as np
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    rgb = px[..., :3]
    if spec.scrub_white:
        mn = rgb.min(axis=2)
        mx = rgb.max(axis=2)
        white = (mn > WHITE_MIN) & ((mx - mn) < WHITE_SPREAD)
        n_white = int(white.sum())
        # Grow the mask: the star's anti-aliased rim is not near-white, and
        # the normal / metallic-roughness bakes carry its relief and sheen a
        # few texels wider than its colour. Measured on the first pass: a
        # 1-texel fill left a ghost star on the hull.
        mask = white.copy()
        for _ in range(WHITE_DILATE):
            grown = mask.copy()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    grown |= np.roll(np.roll(mask, dy, 0), dx, 1)
            mask = grown
        rgb[:] = _fill_masked(rgb, mask)
        for other in bpy.data.images:
            if other.name == img.name or tuple(other.size) == (0, 0):
                continue
            ow, oh = other.size
            opx = np.array(other.pixels[:], dtype=np.float32).reshape(oh, ow, other.channels)
            # The mask is on the base colour's grid; resample by nearest.
            ys = (np.arange(oh) * h // oh)
            xs = (np.arange(ow) * w // ow)
            omask = mask[ys][:, xs]
            if other.name.startswith("normal"):
                opx[..., 0][omask] = 0.5
                opx[..., 1][omask] = 0.5
                opx[..., 2][omask] = 1.0
            else:
                opx[..., :3] = _fill_masked(opx[..., :3], omask)
            other.pixels = opx.ravel().tolist()
            other.update()
            print(f"[{spec.unit_id}] scrub_white: {other.name} {int(omask.sum())} texels flattened")
        print(f"[{spec.unit_id}] scrub_white: {n_white} near-white texels ({100.0 * n_white / (w * h):.3f}%), "
              f"{int(mask.sum())} after dilation, painted over")
    if spec.olive_shift:
        mx = rgb.max(axis=2)
        mn = rgb.min(axis=2)
        d = np.maximum(mx - mn, 1e-6)
        sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0.0)
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        hue = np.where(mx == r, ((g - b) / d) % 6.0, np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0)) * 60.0
        green = (sat > OLIVE_SAT_MIN) & (hue > OLIVE_HUE_LO) & (hue < OLIVE_HUE_HI)
        n_green = int(green.sum())
        hue2 = np.where(green, hue - OLIVE_HUE_SHIFT, hue)
        sat2 = np.where(green, sat * OLIVE_SAT_MUL, sat)
        val2 = np.where(green, mx * OLIVE_VAL_MUL, mx)
        c = val2 * sat2
        hp = (hue2 % 360.0) / 60.0
        x = c * (1.0 - np.abs(hp % 2.0 - 1.0))
        m = val2 - c
        z = np.zeros_like(c)
        i = hp.astype(np.int32) % 6
        r2 = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [c, x, z, z, x, c]) + m
        g2 = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [x, c, c, x, z, z]) + m
        b2 = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [z, z, x, c, c, x]) + m
        rgb[..., 0] = np.where(green, r2, r)
        rgb[..., 1] = np.where(green, g2, g)
        rgb[..., 2] = np.where(green, b2, b)
        print(f"[{spec.unit_id}] olive_shift: {n_green} green texels ({100.0 * n_green / (w * h):.1f}%) pulled toward olive")
    px[..., :3] = np.clip(rgb, 0.0, 1.0)
    img.pixels = px.ravel().tolist()
    img.update()


def _bake(objs, matrix):
    for ob in objs:
        for v in ob.data.vertices:
            v.co = matrix @ v.co
        ob.data.update()


def _bounds(objs):
    pts = [v.co for ob in objs for v in ob.data.vertices]
    return (Vector([min(p[i] for p in pts) for i in range(3)]),
            Vector([max(p[i] for p in pts) for i in range(3)]))


def _face_normal(ob, p):
    vs = [ob.data.vertices[i].co for i in p.vertices]
    n = (vs[1] - vs[0]).cross(vs[2] - vs[0])
    return n.normalized() if n.length > 1e-12 else n


def _probe(spec, ob):
    mn, mx = _bounds([ob])
    L, W, H = mx.x - mn.x, mx.y - mn.y, mx.z - mn.z
    print(f"[{spec.unit_id}] bounds x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] "
          f"z[{mn.z:+.3f},{mx.z:+.3f}]  L {L:.3f} W {W:.3f} H {H:.3f}")
    # Roof profile along x: the highest z in each of 12 x-bins (a wheeled
    # hull's glacis is the low end).
    bins = 12
    prof = [mn.z] * bins
    for v in ob.data.vertices:
        b = min(int((v.co.x - mn.x) / L * bins), bins - 1)
        prof[b] = max(prof[b], v.co.z)
    print(f"[{spec.unit_id}] roof profile (x bins, -x..+x): {[round(z - mn.z, 3) for z in prof]}")
    # Vertical plate area facing +x / -x at each end (the blade end).
    plus = minus = 0.0
    for p in ob.data.polygons:
        n = _face_normal(ob, p)
        if abs(n.x) > 0.8:
            if p.center.x > mn.x + L * 0.7 and n.x > 0:
                plus += p.area
            elif p.center.x < mn.x + L * 0.3 and n.x < 0:
                minus += p.area
    print(f"[{spec.unit_id}] end plate area: +x {plus:.4f}  -x {minus:.4f}")
    # Contact patch: the lowest band, by x, outboard of a third of the width.
    zmin = mn.z
    xs = [v.co.x for v in ob.data.vertices if abs(v.co.y) > W * 0.3 and v.co.z < zmin + H * 0.03]
    xs.sort()
    clusters = []
    for x in xs:
        if clusters and x - clusters[-1][-1] < L * 0.03:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    print(f"[{spec.unit_id}] contact clusters (x centre, n): "
          f"{[(round(sum(c) / len(c), 3), len(c)) for c in clusters if len(c) >= 5]}")
    # Track / tyre band: the |y| extent and the z extent of everything below
    # 0.4 H, outboard of a third of the width.
    low = [v.co for v in ob.data.vertices if abs(v.co.y) > W * 0.3 and v.co.z < zmin + H * 0.4]
    if low:
        print(f"[{spec.unit_id}] low outboard band: |y| {min(abs(p.y) for p in low):.3f}..{max(abs(p.y) for p in low):.3f}, "
              f"z {min(p.z for p in low) - zmin:.3f}..{max(p.z for p in low) - zmin:.3f}")
    # Roof bands: the top 6 x 3 cm, with their x/y boxes.
    zmax = mx.z
    for i in range(6):
        lo, hi = zmax - 0.03 * (i + 1) * H, zmax - 0.03 * i * H
        band = [v.co for v in ob.data.vertices if lo < v.co.z <= hi]
        if band:
            print(f"[{spec.unit_id}] roof band {i} z {lo - zmin:+.3f}..{hi - zmin:+.3f}: {len(band)} verts "
                  f"x[{min(p.x for p in band):+.2f},{max(p.x for p in band):+.2f}] "
                  f"y[{min(p.y for p in band):+.2f},{max(p.y for p in band):+.2f}]")


def _axles(spec, ob):
    zmin = min(v.co.z for v in ob.data.vertices)
    contact = [v.co.x for v in ob.data.vertices if abs(v.co.y) > spec.wheel_ay and v.co.z < zmin + spec.tyre_z_band]
    axles = []
    for seed in spec.axle_seeds_x:
        xs = [x for x in contact if abs(x - seed) < spec.axle_half_window]
        if len(xs) < spec.axle_min_verts:
            raise SystemExit(f"[{spec.unit_id}] only {len(xs)} contact verts within {spec.axle_half_window} of "
                             f"axle seed {seed:+.2f} -- re-measure axle_seeds_x with --probe")
        axles.append((sum(xs) / len(xs), zmin + spec.wheel_r))
    print(f"[{spec.unit_id}] axles (x, z): {[(round(x, 3), round(z, 3)) for x, z in axles]}")
    return axles


def _split_rubber(spec, ob, is_rubber):
    parts = {}
    for role, keep in (("rubber", True), ("hull", False)):
        copy = ob.copy()
        copy.data = ob.data.copy()
        copy.name = copy.data.name = f"hull_{role}"
        bpy.context.collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        doomed = [f for f in bm.faces if is_rubber(f.calc_center_median()) != keep]
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


def _ring_centre(spec, hull):
    r = spec.rws
    sx, sy = r["ring_seed"]
    # `z_max` keeps a mast rising THROUGH the ring (the Shachaf's, at the
    # ring's own centre) from being taken as the lip.
    near = [v.co for v in hull.data.vertices
            if math.hypot(v.co.x - sx, v.co.y - sy) < r["search_r"] and v.co.z <= r.get("z_max", 1e9)]
    zmax = max(p.z for p in near)
    lip = [p for p in near if p.z > zmax - r["band"]]
    x0, x1 = min(p.x for p in lip), max(p.x for p in lip)
    y0, y1 = min(p.y for p in lip), max(p.y for p in lip)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    across = max(x1 - x0, y1 - y0)
    print(f"[{spec.unit_id}] ring lip ({len(lip)} verts within {r['search_r']} m of {r['ring_seed']}): "
          f"centre ({cx:+.3f}, {cy:+.3f}), top z {zmax:+.3f}, {across:.2f} m across")
    if math.hypot(cx - sx, cy - sy) > 0.25 or across > r["max_across"]:
        raise SystemExit(f"[{spec.unit_id}] ring lip is not where ring_seed says -- re-measure with --probe")
    return Vector((cx, cy, zmax))


def _join_by_role(spec, raw, prefix):
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
        joined.name = joined.data.name = f"{prefix}_{role}"
        joined["rl_role"] = role
        joined.data.materials.clear()
        out[role] = joined
        print(f"[{spec.unit_id}] {prefix}_{role}: {len(joined.data.polygons)} faces")
    return out


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

    if spec.kind == "wheeled":
        axles = _axles(spec, ob)

        def is_rubber(c):
            if abs(c.y) <= spec.wheel_ay:
                return False
            return any(math.hypot(c.x - ax, c.z - az) < spec.wheel_r and c.z < az + spec.wheel_r * 0.95
                       for ax, az in axles)
    else:
        def is_rubber(c):
            return (abs(c.y) > spec.track_ay and c.z < spec.track_z_top
                    and spec.track_x[0] <= c.x <= spec.track_x[1])

    parts = _split_rubber(spec, ob, is_rubber)
    objs = list(parts.values())

    mn, mx = _bounds(objs)
    real = _read_real_metres(spec)
    mpu = metres_per_unit(max(mx.x - mn.x, mx.y - mn.y), real)
    _bake(objs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(objs)
    _bake(objs, Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))))
    mn, mx = _bounds(objs)
    print(f"[{unit_id}] {real:.3f} m long ({spec.sheet} manifest), mpu {mpu:.5f}; "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")

    extra = {}
    pivot_obj = None
    if spec.rws is not None:
        pivot = _ring_centre(spec, parts["hull"])
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
    if spec.mast is not None:
        m = spec.mast
        ax, ay = m["at"]
        roof = max(v.co.z for v in parts["hull"].data.vertices
                   if math.hypot(v.co.x - ax, v.co.y - ay) < m["width"] * 3)
        raw = [vehicle_kit.box("mast", (m["width"], m["width"], m["height"]),
                               (ax, ay, roof + m["height"] / 2.0 - 0.02), role="metal")]
        extra.update({f"mast_{k}": v for k, v in _join_by_role(spec, raw, "mast").items()})
        print(f"[{unit_id}] mast {m['height']} m at ({ax:+.2f}, {ay:+.2f}) on roof z {roof:+.3f}")

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
