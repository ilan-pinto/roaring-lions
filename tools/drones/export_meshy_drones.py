"""Export the two Meshy-generated KDF drones as TEXTURED vehicle GLBs that
ship their remesh's own bake, mesh contract v2 -- A3.1 stage 2 of GH-179,
replacing batch B0a's palette-painted exports (GH-286; `docs/art/style-bible.md`
section 6, `docs/art/meshy-prompts-a31-parts.md`).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/drones/export_meshy_drones.py [-- --only recon_drone] [--probe] [--out <path>]

Writes `art/meshes/vehicles/recon_drone.glb` and
`art/meshes/vehicles/attack_drone.glb`; run `pnpm wreck:meshes` after it (the
`idle`/`wreck` clips) and `pnpm encode:meshes` after that. `--probe` prints the
source's own numbers and writes nothing -- every constant below came from it.

SOURCES. One Meshy text-to-3D chain per drone -- preview, refine (8k bake),
remesh at the bible's drone target of 800 triangles -- the remesh found through
`art/meshy/ledger.jsonl`'s LAST `kind: remesh` entry carrying the drone's
`name`, because each drone has several directories under `art/meshy/` (B0a's
palette chain and this one) and only the ledger says which is current. All
AI-generated (Meshy), disclosed per CONTRIBUTING.md; task ids in
`docs/ASSET_PROVENANCE.md`.

  recon_drone   preview 01a10c2f-177b-768e-aeb2-690b70446bb2,
                refine 01a10c57-cf0b-75ce-92c0-9574434b8631,
                remesh 01a10c59-eede-7009-82ba-125e709bbe8e (801 tris) -- a
                HEXACOPTER (six arms, 2-2-2); six guard rings are added here
                (945 tris shipped).
  attack_drone  preview 01a10c43-ae9f-7219-b923-62eb52ac13fb,
                refine 01a10c79-b7bf-7749-aaa8-1be09178f0f5,
                remesh 01a10c7c-2354-70e0-be0e-d47776620bb6 (789 tris); the
                straight wing and its stores are cut here (474 tris shipped).

  B0a's palette sources (recon v2 remesh 01a0f2aa, attack remesh 01a0f26d)
  stay in the tree as history.

THE TEXTURED PATH. The source's one material is kept, its base colour renamed
`base_color` and its metallic-roughness and normal maps kept, all scaled to
`tools/vehicles/textured.py`'s `TEXTURE_PX` and exported through
`textured.gltf_kwargs`, exactly as `export_meshy_ramp.py` does for the ground
vehicles. Both drones are therefore named in `TEXTURED_VEHICLE_TYPES`
(`textured-vehicle.ts`) and `TEXTURED_VEHICLE_EXEMPT`
(`tools/validate_mesh_assets.py`). Geometry this script ADDS -- the guard
rings, the faces that close the wing-root slit -- takes a uv into the bake
(the motor-cap texel, the neighbouring fuselage texel) so nothing samples
texel (0,0).

SIZE -- the x1.5 is baked in, and it comes from `dimetric.SIZE_CLASS`. The
sprite sheets draw air units at `SIZE_CLASS["air"]` (1.5) so a 0.9 m drone is
as clickable as a soldier; a vehicle GLB is scaled by `MESH_SCALE` only, with
no class multiplier (`mesh-vehicle.ts`). The lead's ruling on PR #290 is to
bake the x1.5 into the drone GLBs rather than add an air multiplier to the
mesh path, so the shipped recon drone is 0.9 x 1.5 = 1.35 m across and the
attack drone 1.05 x 1.5 = 1.575 m long. The multiplier is READ from
`SIZE_CLASS["air"]`, never typed here, so the bible's "size is compressed only
through SIZE_CLASS" still holds in the one place that matters: change the
class and both drones follow. The real metres are the sprite manifests' own
`realMetres` (`DRONE_RECON`, `DRONE_ATTACK`), read at export time for the same
reason `export_mesh_vehicle.py` reads a manifest rather than a literal.

ORIENTATION, measured rather than assumed (2026-09-30, on the remesh):

  recon_drone   (v2) the preview's antenna mast sits at y +0.36 and the
                gimballed ball at y -0.19, so the nose is -Y. Rz(+90). (v1
                measured the same way, by ball against battery box.)
  attack_drone  principal axis X; the radial extent tapers to 0.12 at -X (the
                nose pod) and opens to 0.55 at +X (the cross tail), so the
                nose is -X. Rz(180).

THE ATTACK DRONE'S WING IS CUT HERE. The prompt forbade a wing; the re-roll
delivered a straight one anyway (see `_classify_attack`'s numbers block), and
the lead ruled (2026-10-05) to cut it in Blender and keep the fuselage, nose,
tail and propeller. Every face touching a vertex with |y| > ATTACK_WING_Y in
front of ATTACK_WING_X_MAX goes, the slit is closed with `holes_fill`, and the
stores left hanging from nothing are dropped as disconnected pieces
(`_drop_debris`). Re-measured after the cut: 1.575 m long, 0.85 m across (the
propeller disc), 0.62 m tall.

ROLES. One remeshed mesh per drone, split by face-centroid geometry into the
vehicle vocabulary (`tools/vehicles/kit.py` ROLES); on a textured file the
role names the part for the loader and the gate, the colour comes from the
bake:

  recon_drone   metal  rotors and motor tops (r > 0.55 from the body centre,
                       z > 0.17) plus the six guard rings
                glass  the gimballed ball (within RECON_BALL_R of its centre)
                hull   everything else
  attack_drone  glass  the nose: the forward 8% of the length
                metal  the tail pylon and propeller (x > ATTACK_TAIL_X) and the
                       gear stubs (z < ATTACK_GEAR_Z)
                hull   the fuselage

Each role is ONE object named `hull_<role>` -- `{part}_{role}` per contract v2,
all `hull_` because nothing on a drone traverses: no `turret_pivot`, and no
`rotor_pivot` either (a file carries exactly one and a quadcopter has four;
static rotors read fine at 26 px -- `meshy-prompts-units.md` section 1).

DETERMINISM. Nothing here calls `mathutils.noise`; every threshold is a
constant applied to the source's own vertex data.
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
sys.path.insert(0, os.path.join(TOOLS, "vehicles"))

from dimetric import SIZE_CLASS, metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary
import textured as vehicle_textured  # noqa: E402 -- the textured path: `TEXTURE_PX`, `gltf_kwargs`

REPO = os.path.dirname(TOOLS)
MESHY_DIR = os.path.join(REPO, "art", "meshy")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = set(_argv[_argv.index("--only") + 1].split(",")) if "--only" in _argv else None

#: The bible's shipped cap for a drone (section 3).
TRI_CAP = 1000


def _credit(unit_id):
    return (
        f"{unit_id} -- AI-generated (Meshy text-to-3D preview + remesh), disclosed per "
        "CONTRIBUTING.md; re-oriented, re-scaled and role-split for Roaring Lions"
    )


def _remesh_source(name):
    """`art/meshy/<slug>-<yyyymmdd>-<id8>/model.glb` for the LAST ledger entry
    of `kind: remesh` named `name` -- the ledger, not a glob over the slug,
    decides which of a drone's directories is current, and the last entry
    wins because the ledger is append-only and `recon_drone` has two remeshes
    (v1, retired, and the accepted v2)."""
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
    # Slug AND id prefix: the CLI names a directory by the first eight hex
    # digits of the task id, and two tasks submitted in the same minute can
    # share them (recon's v1 remesh and attack's preview both start 01a0f26b).
    slug = name.replace("_", "-")
    hits = glob.glob(os.path.join(MESHY_DIR, f"{slug}-*-{task_id.split('-')[0]}", "model.glb"))
    if len(hits) != 1:
        raise SystemExit(f"[{name}] expected one download dir for remesh task {task_id}, found {hits}")
    return hits[0], task_id


#: Each drone's real size in metres -- the `realMetres` the DRONE_RECON and
#: DRONE_ATTACK sprite manifests carried, copied here when the sprite sheets
#: were retired (A3.3 Task 8, `5a08b70f`): there is no manifest left to read, and
#: `export_mesh_vehicle.py` does the same for its own six. The x1.5 air class
#: is NOT copied -- it is still read from `dimetric.SIZE_CLASS` below.
REAL_METRES = {"recon_drone": 0.9, "attack_drone": 1.05}


# ---------------------------------------------------------------------------
# Per-drone classification, in the SOURCE frame (before the Z rotation), on
# face centroids. Each returns a role from `vehicle_kit.ROLES`.
# ---------------------------------------------------------------------------
# Numbers measured 2026-10-05 on the 801-face TEXTURED remesh of the A3.1
# re-roll (`--probe`, `hubs.py`-style clustering of the blade tips, the six
# motor tops and the low vertices). The remesh is a HEXACOPTER -- six arms in a
# 2-2-2 layout, not the four of B0a's v2 and of the prompt -- so there are SIX
# rotors and six guard rings, not four. Hubs are the xy centroid of each motor's
# top cap (z 0.22-0.25), blades sit at z 0.21-0.22 and reach 0.41-0.49 from
# the hub. The nose is -Y: the gimballed ball sits under the -Y end of the body
# (cluster at (-0.07, -0.50), z -0.19..-0.11, r ~0.09) and the antenna mast at
# the +Y end -- the same read B0a made on v2. The body is the box between the
# arms, |x| < 0.3.
RECON_BODY_CENTRE = (-0.02, 0.05)
RECON_BALL_CENTRE = (-0.05, -0.50, -0.15)
RECON_BALL_R = 0.15
RECON_HUBS = ((-0.801, 0.125), (-0.639, -0.635), (0.614, -0.640), (0.759, 0.124), (0.402, 0.724), (-0.437, 0.722))
RECON_HUB_Z = 0.205
#: Rotor guards -- the lead's brief asked for them, Meshy did not draw them (the
#: re-roll has none either), and the bible says a wrong preview is fixed in
#: Blender: one flat annulus per rotor, `metal`, just outside the blade tips
#: (blades read 0.32-0.35 from the hub on the source's top view; the ring's
#: centre line is 0.37, its edges 0.345-0.395). A first cut at 0.47 -- taken from
#: the farthest z > 0.14 vertex, which was the NEXT arm over -- drew hoops
#: twice the blades' size and was rejected on the render. Flat (one face ring, 24 tris each) rather than a
#: thickened ring so the file stays under the 1,000-tri drone cap: 801 + 6 x 24
#: = 945. Neighbouring hubs sit as close as 0.62 apart on the +x side (0.70
#: and 0.78 elsewhere), so three adjacent pairs of rings overlap a little; alternate rings sit 0.006 apart in z so the
#: overlap never z-fights.
GUARD_RADIUS = 0.37
GUARD_WIDTH = 0.05
GUARD_SEGMENTS = 12
GUARD_Z_STEP = 0.006


def _classify_recon(c):
    r = math.hypot(c.x - RECON_BODY_CENTRE[0], c.y - RECON_BODY_CENTRE[1])
    if r > 0.55 and c.z > 0.17:
        return "metal"
    if (Vector(RECON_BALL_CENTRE) - c).length < RECON_BALL_R:
        return "glass"
    return "hull"


def _recon_guards():
    """Six flat rings in the SOURCE frame, one mesh -- joined into `hull_metal`
    by `_add_guards` before the transforms."""
    verts, faces = [], []
    for k, (hx, hy) in enumerate(RECON_HUBS):
        base = len(verts)
        z = RECON_HUB_Z + (GUARD_Z_STEP if k % 2 else 0.0)
        for i in range(GUARD_SEGMENTS):
            a = 2 * math.pi * i / GUARD_SEGMENTS
            for rr in (GUARD_RADIUS + GUARD_WIDTH / 2.0, GUARD_RADIUS - GUARD_WIDTH / 2.0):
                verts.append((hx + rr * math.cos(a), hy + rr * math.sin(a), z))
        for i in range(GUARD_SEGMENTS):
            j = (i + 1) % GUARD_SEGMENTS
            faces.append((base + 2 * i, base + 2 * j, base + 2 * j + 1, base + 2 * i + 1))
    me = bpy.data.meshes.new("guards")
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new("guards", me)
    bpy.context.collection.objects.link(ob)
    return ob


def _add_guards(parts, label):
    """Join the rings into `hull_metal` THROUGH THE BAKE: a palette export could
    add bare geometry, a textured one cannot -- a ring with no uv would sample
    texel (0,0). Each ring takes the one uv of the motor-cap face nearest its
    hub (a carbon-black texel), the hull's material and uv layer."""
    target = parts["metal"]
    guards = _recon_guards()
    me_t = target.data
    uv_t = me_t.uv_layers.active
    layer_name = uv_t.name
    cents = [(sum((me_t.vertices[i].co for i in p.vertices), Vector()) / len(p.vertices), p) for p in me_t.polygons]
    gm = guards.data
    lay = gm.uv_layers.new(name=layer_name)
    for k, (hx, hy) in enumerate(RECON_HUBS):
        probe = Vector((hx, hy, RECON_HUB_Z + 0.015))
        _c, nearest = min(cents, key=lambda cp: (cp[0] - probe).length)
        u = sum(uv_t.data[l].uv.x for l in nearest.loop_indices) / len(nearest.loop_indices)
        v = sum(uv_t.data[l].uv.y for l in nearest.loop_indices) / len(nearest.loop_indices)
        for poly in gm.polygons[k * GUARD_SEGMENTS:(k + 1) * GUARD_SEGMENTS]:
            for l in poly.loop_indices:
                lay.data[l].uv = (u, v)
    gm.materials.append(me_t.materials[0])
    bpy.ops.object.select_all(action="DESELECT")
    guards.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    print(f"[{label}] added {len(RECON_HUBS)} rotor guards ({GUARD_SEGMENTS} segments, r {GUARD_RADIUS}) "
          f"into hull_metal: now {len(target.data.polygons)} faces, "
          f"{len(target.data.materials)} material slot(s), uv layers {[u.name for u in target.data.uv_layers]}")


# Numbers measured 2026-10-05 on the 789-face TEXTURED remesh of the A3.1
# re-roll (`--probe`; faces and views read before any threshold was written).
# The remesh's SOURCE frame is not B0a's: the fuselage runs along X (1.31 long,
# nose tip at x -0.656 -- the thin end, radial extent 0.09 against 0.35 at the
# tail), the wingspan along Y (1.89, the axis Meshy normalised to). Nose -X, so
# Rz(180), as before. What the re-roll delivered:
#   * the fuselage capsule (radius ~0.22) with a plain ogive nose -- no separate
#     sensor pod, no lens window;
#   * a STRAIGHT WING the negative prompt forbade (|y| to 0.945, chord ~0.26 about
#     x -0.16..+0.10), with two small stores hung under each half;
#   * a swept tail pylon carrying a two-blade propeller at x +0.45..+0.66 -- NO
#     cross tail of four fins.
# The lead's ruling (5 Oct): cut the wing in Blender, keep the cylinder, nose,
# tail and propeller. The wing is one planar structure, and so are its stores:
# every face touching a vertex with |y| > ATTACK_WING_Y and x < ATTACK_WING_X_MAX
# (the fuselage never leaves |y| 0.22; the propeller starts at x 0.45). The
# fuselage slit it leaves is closed by `_cut_faces` (`holes_fill`, each filled
# face taking the uv of the fuselage face it closes against).
ATTACK_NOSE_X = -0.656  # measured x-min of the remesh, the nose tip
ATTACK_LEN = 1.307      # nose tip to propeller tip
ATTACK_WING_Y = 0.24
ATTACK_WING_X_MAX = 0.40
ATTACK_TAIL_X = 0.40    # the pylon and propeller start here
ATTACK_GEAR_Z = -0.20   # the two stubs under the belly
#: The bake came back a dark teal-grey (hue 190, mean rgb 39/49/50) where the
#: prompt asked for matte olive-drab and the recon drone's bake is hue 55: the
#: coloured band is turned onto the roster's olive and lifted a little (the
#: bake is darker than the recon's, mean value 0.20 against 0.27). Greys and
#: blacks -- the propeller, the fittings -- are under the saturation gate and
#: untouched.
TEAL_SAT_MIN = 0.12
TEAL_HUE_LO = 150.0
TEAL_HUE_HI = 235.0
TEAL_HUE_SHIFT = -135.0
TEAL_SAT_MUL = 0.9
TEAL_VAL_MUL = 1.2


def _classify_attack(c):
    if c.x < ATTACK_NOSE_X + 0.08 * ATTACK_LEN:
        return "glass"
    if c.x > ATTACK_TAIL_X or c.z < ATTACK_GEAR_Z:
        return "metal"
    return "hull"


def _attack_wing_face(face):
    return any(abs(v.co.y) > ATTACK_WING_Y and v.co.x < ATTACK_WING_X_MAX for v in face.verts)


def _teal_to_olive(unit_id, img):
    """Turn the teal band of the base colour onto olive (see TEAL_*). Pure
    numpy over the image buffer; the image is already at `TEXTURE_PX` (the 8k
    original would be a 270 M-float python list)."""
    import numpy as np
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    rgb = px[..., :3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    d = np.maximum(mx - mn, 1e-6)
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6.0, np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0)) * 60.0
    band = (sat > TEAL_SAT_MIN) & (hue > TEAL_HUE_LO) & (hue < TEAL_HUE_HI)
    hue2 = np.where(band, hue + TEAL_HUE_SHIFT, hue)
    sat2 = np.where(band, np.minimum(sat * TEAL_SAT_MUL, 1.0), sat)
    val2 = np.where(band, np.minimum(mx * TEAL_VAL_MUL, 1.0), mx)
    c = val2 * sat2
    hp = (hue2 % 360.0) / 60.0
    x = c * (1.0 - np.abs(hp % 2.0 - 1.0))
    m = val2 - c
    z = np.zeros_like(c)
    i = hp.astype(np.int32) % 6
    conds = [i == 0, i == 1, i == 2, i == 3, i == 4, i == 5]
    r2 = np.select(conds, [c, x, z, z, x, c]) + m
    g2 = np.select(conds, [x, c, c, x, z, z]) + m
    b2 = np.select(conds, [z, z, x, c, c, x]) + m
    rgb[..., 0] = np.where(band, r2, r)
    rgb[..., 1] = np.where(band, g2, g)
    rgb[..., 2] = np.where(band, b2, b)
    img.pixels = px.ravel().tolist()
    img.update()
    print(f"[{unit_id}] teal_to_olive: {int(band.sum())} teal texels ({100.0 * band.sum() / (w * h):.1f}%) "
          f"turned {TEAL_HUE_SHIFT:+.0f} deg onto olive")


SPECS = {
    "recon_drone": dict(
        rot_z_deg=90.0, classify=_classify_recon, cut=None, axis="horizontal",
        extras=_add_guards,
    ),
    "attack_drone": dict(
        rot_z_deg=180.0, classify=_classify_attack, cut=_attack_wing_face, axis="x",
        extras=None, fix_bake=_teal_to_olive, debris_faces=12,
    ),
}


def _clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _import_textured(unit_id, src):
    """Import the remesh as ONE textured mesh with its world transform baked
    in, its Base Color image renamed `base_color` (the name
    `textured.prepare_vehicle_textures` and the loader key on) and its
    metallic-roughness / normal images renamed to the names the vehicle path
    keeps. The textured twin of B0a's palette import, which refused any
    material outright."""
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
    _bake_transform([ob], ob.matrix_world.copy())
    ob.matrix_world = Matrix.Identity(4)
    mat = ob.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = next((l for l in mat.node_tree.links
                 if l.to_node.name == bsdf.name and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE":
        raise SystemExit(f"[{unit_id}] Base Color is not fed by an image texture -- no bake to ship")
    base = link.from_node.image
    base.name = vehicle_textured.BASE_COLOR_PREFIX
    for img in bpy.data.images:
        if img.name != base.name and img.name.endswith("metallic_roughness"):
            img.name = "metallic_roughness"
        elif img.name != base.name and img.name.endswith("normal"):
            img.name = "normal"
    if not ob.data.uv_layers:
        raise SystemExit(f"[{unit_id}] the remesh carries no UV layer")
    print(f"[{unit_id}] images: {[(i.name, tuple(i.size)) for i in bpy.data.images]}")
    return ob, base


def _loop_uv(me, poly):
    """The mean uv of one face, read off the active layer."""
    layer = me.uv_layers.active.data
    uvs = [layer[l].uv for l in poly.loop_indices]
    return (sum(u[0] for u in uvs) / len(uvs), sum(u[1] for u in uvs) / len(uvs))


def _weld(ob, label):
    """Merge the vertices Meshy's remesh splits along its UV seams. UVs live
    on the LOOPS and survive a vertex weld, so the bake is untouched; without
    the weld the surface is not closed -- every seam is a boundary edge -- and
    `holes_fill` cannot tell a wing-root slit from a seam (B0a measured 1,333
    boundary edges and 4 fill faces before the weld, the slit left open)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{label}] welded {before} -> {len(ob.data.vertices)} vertices")


def _cut_faces(ob, predicate, label):
    """Delete every face `predicate` accepts and close the holes it leaves.
    Runs after `_weld`, so the only boundary loops left are real holes. The
    TEXTURED path adds one step the palette path never needed: a filled face is
    born with no uv (texel 0,0, an arbitrary colour), so each takes the mean
    uv of the surviving face across its first boundary edge -- the fuselage
    paint it closes against."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv_lay = bm.loops.layers.uv.active
    doomed = [f for f in bm.faces if predicate(f)]
    before = len(bm.faces)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    open_edges = [e for e in bm.edges if e.is_boundary]
    old = set(f.index for f in bm.faces)
    res = bmesh.ops.holes_fill(bm, edges=open_edges, sides=0)
    for f in res["faces"]:
        nb = None
        for e in f.edges:
            for g in e.link_faces:
                if g is not f and g.index in old:
                    nb = g
                    break
            if nb is not None:
                break
        if nb is None:
            raise SystemExit(f"[{label}] a filled face has no surviving neighbour to take a uv from")
        u = sum(l[uv_lay].uv.x for l in nb.loops) / len(nb.loops)
        v = sum(l[uv_lay].uv.y for l in nb.loops) / len(nb.loops)
        for l in f.loops:
            l[uv_lay].uv = (u, v)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{label}] cut {len(doomed)} faces of {before}, closed {len(open_edges)} boundary edges "
          f"({len(res['faces'])} fill faces, uv from the neighbour), now {len(ob.data.polygons)} faces")


def _drop_debris(ob, label, min_faces):
    """Delete every connected piece smaller than `min_faces` and print the sizes
    of all of them, so the threshold is read off the dump. A wing cut leaves
    what hung from the wing without anything to hang from -- the attack
    remesh's stores left black slivers floating under the belly -- and
    connectivity (not position) is what says a piece belongs to nothing."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen, pieces = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, cur = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            cur.append(g)
            for v in g.verts:
                for h in v.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        pieces.append(cur)
    pieces.sort(key=len, reverse=True)
    doomed = [g for piece in pieces if len(piece) < min_faces for g in piece]
    for piece in pieces[1:]:
        pts = [v.co for g in piece for v in g.verts]
        print(f"[{label}]   piece of {len(piece)} faces: x[{min(p.x for p in pts):+.2f},{max(p.x for p in pts):+.2f}] "
              f"y[{min(p.y for p in pts):+.2f},{max(p.y for p in pts):+.2f}] z[{min(p.z for p in pts):+.2f},{max(p.z for p in pts):+.2f}]")
    print(f"[{label}] pieces after the cut (faces): {[len(p) for p in pieces]}; "
          f"deleting those under {min_faces} ({len(doomed)} faces)")
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def _split_by_role(ob, classify, label):
    """One new object per role, each holding the faces whose centroid
    `classify` sends there. Built by COPYING the source and deleting the other
    roles' faces (the ramp exporter's `_split_rubber`), so every piece keeps
    its uv layer and the one material -- the palette path rebuilt them from
    `from_pydata` precisely to shed both."""
    me = ob.data
    roles = {}
    for p in me.polygons:
        c = Vector((0.0, 0.0, 0.0))
        for i in p.vertices:
            c += me.vertices[i].co
        c /= len(p.vertices)
        role = classify(c)
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"[{label}] classify returned {role!r}, outside {vehicle_kit.ROLES}")
        roles[p.index] = role
    out = {}
    for role in sorted(set(roles.values())):
        copy = ob.copy()
        copy.data = ob.data.copy()
        copy.name = copy.data.name = f"hull_{role}"
        bpy.context.collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        bm.faces.ensure_lookup_table()
        doomed = [f for f in bm.faces if roles[f.index] != role]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(copy.data)
        bm.free()
        copy.data.update()
        copy["rl_role"] = role
        out[role] = copy
        print(f"[{label}] hull_{role}: {len(copy.data.polygons)} faces")
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


def _bake_transform(objs, matrix):
    for ob in objs:
        for v in ob.data.vertices:
            v.co = matrix @ v.co
        ob.data.update()


def _bounds(objs):
    pts = [v.co for ob in objs for v in ob.data.vertices]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    return mn, mx


def _probe(unit_id, ob):
    """Print the source's own numbers and write nothing -- every constant in
    SPECS is read off a run of this, never guessed."""
    co = [v.co.copy() for v in ob.data.vertices]
    mn = Vector([min(p[i] for p in co) for i in range(3)])
    mx = Vector([max(p[i] for p in co) for i in range(3)])
    print(f"[{unit_id}] {len(ob.data.polygons)} faces, {len(co)} verts; bounds "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")
    for axis, name in ((0, "x"), (1, "y"), (2, "z")):
        bins = 12
        lo, span = mn[axis], max(mx[axis] - mn[axis], 1e-9)
        rows = []
        for b in range(bins):
            sel = [p for p in co if min(int((p[axis] - lo) / span * bins), bins - 1) == b]
            if sel:
                oth = [i for i in range(3) if i != axis]
                ext = [max(abs(p[i]) for p in sel) for i in oth]
                rows.append(f"{lo + span * (b + .5) / bins:+.2f}:n{len(sel)}/r{ext[0]:.2f},{ext[1]:.2f}")
            else:
                rows.append(f"{lo + span * (b + .5) / bins:+.2f}:-")
        print(f"[{unit_id}] along {name} (n / max|other axes|): " + "  ".join(rows))
    zs = sorted(co, key=lambda p: -p.z)[: max(8, len(co) // 40)]
    print(f"[{unit_id}] top-z verts centroid {sum((p for p in zs), Vector()) / len(zs)}")
    zl = sorted(co, key=lambda p: p.z)[: max(8, len(co) // 40)]
    print(f"[{unit_id}] bottom-z verts centroid {sum((p for p in zl), Vector()) / len(zl)}")


def export_one(unit_id, probe=False, out_path=None):
    spec = SPECS[unit_id]
    src, task_id = _remesh_source(unit_id)
    _clear_scene()
    ob, base = _import_textured(unit_id, src)
    print(f"[{unit_id}] source {os.path.relpath(src, REPO)} (remesh task {task_id}): "
          f"{len(ob.data.polygons)} faces")
    if probe:
        _probe(unit_id, ob)
        _bake_transform([ob], Matrix.Rotation(math.radians(spec["rot_z_deg"]), 4, "Z"))
        _probe(unit_id + " (after rot_z)", ob)
        print(f"[{unit_id}] --probe: nothing written")
        return None
    if spec.get("fix_bake") is not None:
        cap = vehicle_textured.TEXTURE_PX
        if base.size[0] > cap or base.size[1] > cap:
            base.scale(min(base.size[0], cap), min(base.size[1], cap))
        spec["fix_bake"](unit_id, base)

    if spec["cut"] is not None:
        _weld(ob, unit_id)
        _cut_faces(ob, spec["cut"], unit_id)
        _drop_debris(ob, unit_id, spec["debris_faces"])

    parts = _split_by_role(ob, spec["classify"], unit_id)
    if spec["extras"] is not None:
        spec["extras"](parts, unit_id)
    objs = list(parts.values())

    # Rotation first (the classification above was written in the source
    # frame), then scale, then ground and centre -- all baked into the verts,
    # object transforms stay identity (contract: "object scale always 1").
    _bake_transform(objs, Matrix.Rotation(math.radians(spec["rot_z_deg"]), 4, "Z"))

    mn, mx = _bounds(objs)
    size = mx - mn
    extent = size.x if spec["axis"] == "x" else max(size.x, size.y)
    real = REAL_METRES[unit_id]
    drawn = real * SIZE_CLASS["air"]
    mpu = metres_per_unit(extent, drawn)
    _bake_transform(objs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(objs)
    centre = Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))
    _bake_transform(objs, Matrix.Translation(-centre))
    mn, mx = _bounds(objs)
    print(f"[{unit_id}] real {real:.3f} m x SIZE_CLASS[air] {SIZE_CLASS['air']} = {drawn:.3f} m drawn; "
          f"mpu {mpu:.5f}; final bounds x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] "
          f"z[{mn.z:+.3f},{mx.z:+.3f}]")

    tris = sum(len(p.vertices) - 2 for ob in objs for p in ob.data.polygons)
    if tris > TRI_CAP:
        raise SystemExit(f"[{unit_id}] {tris} triangles over the drone cap {TRI_CAP}")

    kept, _dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{unit_id}] image {name}: {before} -> {after}")
    os.makedirs(OUT_DIR, exist_ok=True)
    out = out_path or os.path.join(OUT_DIR, f"{unit_id}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out, _credit(unit_id)))
    print(f"[{unit_id}] wrote {out} ({os.path.getsize(out)} bytes, {tris} tris, roles {sorted(parts)})")


if __name__ == "__main__":
    for unit_id in SPECS:
        if ONLY is None or unit_id in ONLY:
            export_one(unit_id, probe="--probe" in _argv,
                       out_path=_argv[_argv.index("--out") + 1] if "--out" in _argv else None)
