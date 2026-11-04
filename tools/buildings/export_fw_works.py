"""Export the GH-277 field works -- four KDF works, four militia works -- as
building GLB triples/pairs, mesh contract v2's BUILDINGS section.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_fw_works.py -- all
    ... -- kdf_medic_station          # one building, all its states
    ... -- kdf_forward_camp           # also saves art/src/buildings/kdf_forward_camp.blend
                                      # (a full run only; --states or --out-dir skip it)

The forward camp (`kdf_forward_camp`, GH-277 follow-on, 4 Nov) is the ninth KDF-style
work: a Meshy-7 remesh of two separate objects, a tent and a net-roofed bay, carved
apart and re-packed onto the 2x2 plot -- see `build_kdf_forward_camp`.

Writes, per building, `art/meshes/buildings/<id>.glb` (standing) and
`<id>_wreck.glb`; the four KDF works also get `<id>_construction.glb`
(plan Task 13 drives it as a height clip from `stProgress`). Militia works
are never built, so they have no construction state (L3).

Design: `docs/superpowers/specs/2026-09-29-field-works-design.md` §3/§5/§8;
numbers table and prompts: `docs/art/meshy-prompts-buildings.md`, "Field
works". Art only -- no `data/structures.json` entry and no `BUILDING_MESHES`
line; the GLBs sit in `mesh-catalogue.ts`'s `HELD_MESH_FILES` until Stage 5.

SOURCES (all AI-generated, Meshy text-to-3D, disclosed per CONTRIBUTING.md;
task ids in `docs/ASSET_PROVENANCE.md` and `art/meshy/ledger.jsonl`):

  KDF, palette-painted (Q11): preview + remesh, downloaded to
  `art/meshy/<slug>-remesh-20260930-<id>/model.glb` -- a single unroled
  mesh, no material, arriving in Meshy's unit box (about 1.9 units across).
  Militia OP / weapons workshop, textured (Q11): preview + refine (2k) +
  remesh; the remesh KEEPS the refine's bake (measured on the OP: the remesh
  GLB carries `texture_0` base colour plus normal/metallic-roughness), which
  closes style-bible.md §4's "unverified until B0" question for buildings.
  Militia field clinic / firing position: kit-bashed at 0 credits from the
  shipped `clinic.glb` / `shanty.glb` plus `tools/buildings/kit.py` sandbags.

WHAT THIS SCRIPT DOES TO A MESHY SOURCE, in order: import; set the yaw that
puts the entrance on Blender +X or -Y (the two faces the fixed dimetric
camera can see -- glTF +X/+Z, `building_facing.py`; MEASURED this session
with a test pane, not read off the exporter's axis convention); scale so the
longest horizontal extent equals the footprint edge (6 m for 2x2, 3 m for
the 1x1 OP); ground the lowest vertex at z=0 and centre XY on the footprint
(the contract's anchor: "the model's own world origin at z~0"); split faces
into `rl_role` meshes by height band and position (a remesh is one shell
with no part names, so height is the only honest signal -- each threshold
below is a fraction of the building's OWN height, printed on every run);
add the kit pieces the prompt asked for and the generation left out (the
medic's store container, the intel window pane that makes it
facing-judgeable, the outpost's firing slits); export.

ROLE COLOURS, so the choices below make sense: `wall` takes the type's own
`color` at runtime (proposed `olive.1`, the camp's -- KDF reads olive);
`metal` gunmetal.2; `wood` dust.4 (the tan of a sandbag); `roof` dust.6;
`glass` shadow.0 (a dark opening, which is what a firing slit or a window
looks like at 40 px). Textured militia meshes ignore the role for colour and
draw their bake; a palette piece inside a textured GLB (the OP's slot, the
clinic's sandbags) draws its ramp, by the per-MESH rule `warehouse.glb`'s
synthesised roof cap already uses.

WRECKS reuse `render_building.py`'s deterministic, seed-free maths
(`_hash01`, `_dice`, `collapse`) where a masonry collapse is the right read,
and per-building rigid moves where it is not: a mast falls, a container tips,
a tower lies down. Each wreck keeps ONE element that says which building it
was, because `pnpm validate:meshes` frames every render to its own bounds and
then compares 64 px silhouettes pairwise -- eight collapsed 2x2 heaps would
read as one wreck.

No `mathutils.noise` anywhere (Blender 5.2 reseeds it per process).
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit  # noqa: E402  -- tools/buildings/kit.py: box, cylinder, wedge, ROLES
import textured  # noqa: E402
from render_building import _hash01, _dice, collapse  # noqa: E402

REPO = os.path.dirname(TOOLS)
MESHY = os.path.join(REPO, "art", "meshy")
OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
SHIPPED = os.path.join(REPO, "art", "meshes", "buildings")

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
    _argv = [a for a in _argv if a != "--out-dir" and a != OUT_DIR]

TILE = 3.0  # metres, dimetric.UNITS_PER_TILE
CONSTRUCTION_FRACTION = 0.45  # the standing mesh's lower part kept under construction

CREDIT_MESHY = (
    "Field works (GH-277): {name} -- AI-generated (Meshy text-to-3D, remeshed), "
    "disclosed per CONTRIBUTING.md; oriented, fitted, role-split and kit-bashed in "
    "Blender for Roaring Lions (tools/buildings/export_fw_works.py)"
)
CREDIT_KITBASH = (
    "Field works (GH-277): {name} -- kit-bashed in Blender from {parent} (AI-generated, "
    "Meshy, disclosed per CONTRIBUTING.md) and tools/buildings/kit.py sandbags "
    "(tools/buildings/export_fw_works.py)"
)


# --------------------------------------------------------------------------
# scene helpers
# --------------------------------------------------------------------------

def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def meshy_dir(prefix):
    hits = sorted(d for d in os.listdir(MESHY) if d.startswith(prefix + "-2026"))
    if len(hits) != 1:
        raise SystemExit(f"expected exactly one art/meshy/{prefix}-2026*/ directory, found {hits}")
    return os.path.join(MESHY, hits[0])


def normalise_meshy_images():
    """A Meshy remesh names its bake `texture_0`; `textured.py` ships the image
    named `base_color`. Rename, and drop the maps nothing here asked for."""
    img = bpy.data.images.get("texture_0")
    if img is not None:
        img.name = "base_color"


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, import_scene_extras=True)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        o.rotation_mode = "XYZ"  # the importer leaves QUATERNION, on which an euler yaw is a no-op
    return meshes


def apply_all(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo.x, lo.y, lo.z = min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)
            hi.x, hi.y, hi.z = max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)
    return lo, hi


def fit(objs, yaw_deg, edge_m, offset=(0.0, 0.0), scale_override=None):
    """Yaw, uniform-scale the longest horizontal extent to `edge_m`, ground at
    z=0, centre XY on the footprint (+ offset). Applies the transform."""
    for o in objs:
        o.rotation_euler = (0.0, 0.0, math.radians(yaw_deg))
    bpy.context.view_layer.update()
    apply_all(objs)
    lo, hi = bounds(objs)
    ext = max(hi.x - lo.x, hi.y - lo.y)
    k = scale_override if scale_override else edge_m / ext
    for o in objs:
        o.scale = (k, k, k)
    bpy.context.view_layer.update()
    apply_all(objs)
    lo, hi = bounds(objs)
    for o in objs:
        o.location = Vector((-(lo.x + hi.x) / 2 + offset[0], -(lo.y + hi.y) / 2 + offset[1], -lo.z))
    bpy.context.view_layer.update()
    apply_all(objs)
    lo, hi = bounds(objs)
    print(f"    fitted: {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} m (scale {k:.4f})")
    return lo, hi


def fit_plan(objs, size_xy, height, offset=(0.0, 0.0)):
    """Non-uniform fit: scale X, Y and Z independently so the bounds are
    `size_xy` x `height`, ground at z=0, XY centred (+ offset). The aid post's
    source is a near-square tent and its footprint is 2x3 tiles (1:1.5), so a
    uniform `fit` cannot reach the plot. Applies the transform."""
    for o in objs:
        o.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    apply_all(objs)
    lo, hi = bounds(objs)
    kx = size_xy[0] / (hi.x - lo.x)
    ky = size_xy[1] / (hi.y - lo.y)
    kz = height / (hi.z - lo.z)
    for o in objs:
        o.scale = (kx, ky, kz)
    bpy.context.view_layer.update()
    apply_all(objs)
    lo, hi = bounds(objs)
    for o in objs:
        o.location = Vector((-(lo.x + hi.x) / 2 + offset[0], -(lo.y + hi.y) / 2 + offset[1], -lo.z))
    bpy.context.view_layer.update()
    apply_all(objs)
    lo, hi = bounds(objs)
    print(f"    fitted: {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} m "
          f"(scale {kx:.3f} {ky:.3f} {kz:.3f})")
    return lo, hi


def split_by_role(ob, classify, label):
    """Split ONE mesh object into one object per role, by a per-face
    classifier `(centre: Vector, normal: Vector) -> role`. Returns
    {role: object}. The source object is consumed."""
    me = ob.data
    roles = {}
    for p in me.polygons:
        roles.setdefault(classify(p.center.copy(), p.normal.copy()), []).append(p.index)
    out = {}
    for role, faces in roles.items():
        if role not in kit.ROLES:
            raise SystemExit(f"{label}: classifier produced unknown role {role!r}")
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        keep = set(faces)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
        new_me = bpy.data.meshes.new(f"{label}_{role}")
        bm.to_mesh(new_me)
        bm.free()
        new_me.update()
        # carry the material so a textured piece keeps its bake
        for m in me.materials:
            new_me.materials.append(m)
        new_ob = bpy.data.objects.new(f"{label}_{role}", new_me)
        new_ob["rl_role"] = role
        bpy.context.collection.objects.link(new_ob)
        out[role] = new_ob
        print(f"    role {role:6s}: {len(faces)} faces")
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


def join_by_role(objs):
    """One mesh per role (the contract's draw-call rule). Returns {role: object}."""
    by_role = {}
    for o in objs:
        role = o.get("rl_role")
        if role not in kit.ROLES:
            raise SystemExit(f"{o.name}: missing or unknown rl_role {role!r}")
        by_role.setdefault(role, []).append(o)
    out = {}
    for role, group in by_role.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        if len(group) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = role
        merged.data.name = role
        merged["rl_role"] = role
        out[role] = merged
    return out


def scene_meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def export(path, credit, textured_file):
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    merged = join_by_role(scene_meshes())
    if textured_file:
        textured.split_textured_roles(merged, os.path.basename(path))
        textured.prepare_textured_images()
        kwargs = textured.gltf_kwargs(path, credit)
    else:
        for o in merged.values():
            o.data.materials.clear()
        kwargs = dict(
            filepath=path, export_format="GLB", use_selection=False, export_apply=True,
            export_yup=True, export_skins=False, export_animations=False, export_extras=True,
            export_materials="NONE", export_copyright=credit,
        )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**kwargs)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in merged.values())
    lo, hi = bounds(list(merged.values()))
    print(f"  wrote {os.path.relpath(path, REPO)}: {tris} tris, roles {sorted(merged)}, "
          f"bbox x[{lo.x:.2f},{hi.x:.2f}] y[{lo.y:.2f},{hi.y:.2f}] z[{lo.z:.2f},{hi.z:.2f}] "
          f"({os.path.getsize(path)} bytes)")
    return tris


# --------------------------------------------------------------------------
# geometry ops for wrecks and construction
# --------------------------------------------------------------------------

def rotate_about(ob, pivot, axis, degrees):
    """Rotate an object's mesh data about a world-space pivot and axis."""
    apply_all([ob])
    rot = Matrix.Rotation(math.radians(degrees), 4, Vector(axis).normalized())
    m = Matrix.Translation(Vector(pivot)) @ rot @ Matrix.Translation(-Vector(pivot))
    ob.data.transform(m)
    ob.data.update()


def scale_about(ob, pivot, factors):
    apply_all([ob])
    m = (Matrix.Translation(Vector(pivot)) @ Matrix.Diagonal(Vector(factors)).to_4x4()
         @ Matrix.Translation(-Vector(pivot)))
    ob.data.transform(m)
    ob.data.update()


def translate(ob, delta):
    apply_all([ob])
    ob.data.transform(Matrix.Translation(Vector(delta)))
    ob.data.update()


def ground(objs):
    lo, _ = bounds(objs)
    for o in objs:
        translate(o, (0, 0, -lo.z))


def delete_faces_where(ob, pred):
    """Delete faces whose centre satisfies pred(centre)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    doomed = [f for f in bm.faces if pred(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(doomed)


def bisect_keep_below(ob, z, fill=True):
    """Cut an object at world z and keep what is below, capping the cut."""
    apply_all([ob])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-4, plane_co=(0, 0, z), plane_no=(0, 0, 1),
                           clear_outer=True, clear_inner=False)
    if fill:
        edges = [e for e in bm.edges if len(e.link_faces) == 1 and abs(e.verts[0].co.z - z) < 1e-3
                 and abs(e.verts[1].co.z - z) < 1e-3]
        if edges:
            try:
                bmesh.ops.holes_fill(bm, edges=edges, sides=0)
            except Exception:
                pass
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def crop_box(ob, lo, hi):
    """Keep the part of an object inside an axis-aligned world box, capping cuts."""
    apply_all([ob])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    planes = [((lo[0], 0, 0), (-1, 0, 0)), ((hi[0], 0, 0), (1, 0, 0)),
              ((0, lo[1], 0), (0, -1, 0)), ((0, hi[1], 0), (0, 1, 0))]
    for co, no in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-4, plane_co=co, plane_no=no,
                                     clear_outer=True, clear_inner=False)
        cut_edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if cut_edges:
            try:
                bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
            except Exception:
                pass
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def scatter_bags(label, n, centre, radius, seed, role="wood", size=(0.6, 0.4, 0.26)):
    """A deterministic spill of sandbags around a point."""
    out = []
    for i in range(n):
        a = _hash01(seed, i, 1) * 2 * math.pi
        r = radius * (0.3 + 0.7 * _hash01(seed, i, 2))
        x = centre[0] + r * math.cos(a)
        y = centre[1] + r * math.sin(a)
        yaw = _hash01(seed, i, 3) * math.pi
        b = kit.box(f"{label}_bag{i}", size, (0, 0, size[2] / 2), role)
        b.data.transform(Matrix.Translation((x, y, 0)) @ Matrix.Rotation(yaw, 4, "Z"))
        out.append(b)
    return out


def sandbag_wall(label, start, end, base_z, courses, role="wood", size=(0.62, 0.42, 0.26)):
    """A multi-course sandbag wall between two points, courses offset."""
    (x0, y0), (x1, y1) = start, end
    length = math.hypot(x1 - x0, y1 - y0)
    n = max(1, int(length / (size[0] * 0.95)))
    yaw = math.atan2(y1 - y0, x1 - x0)
    out = []
    for c in range(courses):
        m = n if c % 2 == 0 else n - 1
        for i in range(m):
            t = (i + 0.5) / m
            cx = x0 + (x1 - x0) * t
            cy = y0 + (y1 - y0) * t
            b = kit.box(f"{label}_{c}_{i}", size, (0, 0, base_z + size[2] * (c + 0.5)), role)
            b.data.transform(Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(yaw, 4, "Z"))
            out.append(b)
    return out


def scaffold_kit(seed, scaffold=(1.9, -1.9), pallet_at=(-1.9, -2.0), spoil_at=(-1.8, 1.9),
                 spoil_r=1.1, spill_at=(0.4, -2.4)):
    """The shared construction kit: one two-lift scaffold tower at the
    front-right (+X/-Y) corner, a pallet of sandbags front-left, a spoil heap
    rear-left. Asymmetric on purpose (see module docstring). The positions are
    parameters because a work whose own plan fills those spots (the forward
    camp's ramp and tent) moves the kit; the defaults are the original four
    works' and reproduce their files exactly."""
    objs = []
    cx, cy = scaffold
    for dx in (-0.9, 0.9):
        for dy in (-0.9, 0.9):
            objs.append(kit.box(f"scaf_post_{dx}_{dy}", (0.09, 0.09, 4.4), (cx + dx, cy + dy, 2.2), "metal"))
    for z in (1.0, 2.2, 3.4, 4.3):
        objs.append(kit.box(f"scaf_ledger_x_{z}", (1.95, 0.07, 0.07), (cx, cy - 0.9, z), "metal"))
        objs.append(kit.box(f"scaf_ledger_x2_{z}", (1.95, 0.07, 0.07), (cx, cy + 0.9, z), "metal"))
        objs.append(kit.box(f"scaf_ledger_y_{z}", (0.07, 1.95, 0.07), (cx - 0.9, cy, z), "metal"))
        objs.append(kit.box(f"scaf_ledger_y2_{z}", (0.07, 1.95, 0.07), (cx + 0.9, cy, z), "metal"))
    for z in (2.2, 4.3):
        objs.append(kit.box(f"scaf_deck_{z}", (1.8, 1.8, 0.06), (cx, cy, z + 0.06), "wood"))
    # diagonal brace on the camera-facing side
    br = kit.box("scaf_brace", (0.06, 2.6, 0.06), (cx + 0.92, cy, 1.6), "metal")
    br.data.transform(Matrix.Translation((cx + 0.92, cy, 1.6)) @ Matrix.Rotation(math.radians(40), 4, "X")
                      @ Matrix.Translation((-(cx + 0.92), -cy, -1.6)))
    objs.append(br)
    # pallet of sandbags, front-left
    px, py = pallet_at
    objs.append(kit.box("pallet", (1.2, 1.0, 0.12), (px, py, 0.06), "wood"))
    for i in range(3):
        for j in range(2):
            for c in range(3):
                objs.append(kit.box(f"pal_bag_{i}{j}{c}", (0.36, 0.44, 0.22),
                                    (px - 0.38 + 0.38 * i, py - 0.24 + 0.48 * j, 0.12 + 0.11 + 0.22 * c), "wood"))
    # spoil heap, rear-left
    objs.append(kit.cylinder("spoil", spoil_r, 0.7, (spoil_at[0], spoil_at[1], 0.0), "roof", segments=10, taper=0.15))
    objs += scatter_bags("spill", 4, spill_at, 0.8, seed)
    return objs


# --------------------------------------------------------------------------
# per-building recipes
# --------------------------------------------------------------------------

def _height_of(objs):
    lo, hi = bounds(objs)
    return hi.z - lo.z


def build_kdf_medic_station(state):
    """Meshy hip-roof tent (its container never generated), fitted to 5.4 m and
    pushed to the rear of the pad; a store container, a sandbag skirt and drums
    fill the front. The tent's open flap faces +X at yaw 0 (four-view)."""
    src = os.path.join(meshy_dir("kdf-medic-station-remesh"), "model.glb")
    objs = import_glb(src)
    fit(objs, 0, 5.4, offset=(0.0, 1.05))
    tent = split_by_role(objs[0], lambda c, n: "wall", "tent")["wall"]
    cont = kit.box("store", (2.2, 2.3, 2.4), (1.85, -1.85, 1.2), "metal")
    win = kit.box("store_win", (0.05, 0.9, 0.5), (2.97, -1.85, 1.6), "glass")
    door = kit.box("store_door", (0.8, 0.03, 1.9), (1.85, -3.01, 0.97), "glass")  # thin in y: faces -Y, a camera side
    skirt = sandbag_wall("skirt", (-2.85, -2.85), (0.6, -2.85), 0.0, 2)
    skirt += sandbag_wall("skirt2", (-2.85, -2.85), (-2.85, -0.4), 0.0, 2)
    drums = [kit.oil_drum("drum0", (-1.6, -1.6, 0)), kit.oil_drum("drum1", (-0.9, -1.7, 0))]
    parts = [tent, cont, win, door] + skirt + drums
    if state == "wreck":
        delete_faces_where(tent, lambda c: c.z > 0.62 * 3.81)     # roof torn off
        _dice([tent], 0.45)
        collapse([tent], 0.0, 3.8)
        scale_about(tent, (0, 1.05, 0), (1.0, 1.0, 0.6))
        rotate_about(cont, (2.95, -1.85, 0), (0, 1, 0), -90)   # tipped onto its +X side
        translate(cont, (-0.6, 0, 0))
        for w in (win, door):
            bpy.data.objects.remove(w, do_unlink=True)
        parts = [p for p in parts if p not in (win, door)]
        for b in skirt:
            bpy.data.objects.remove(b, do_unlink=True)
        parts = [p for p in parts if p not in skirt]
        parts += scatter_bags("spill", 14, (-1.6, -1.8), 1.6, 11)
        for d, (dx, dy) in zip(drums, ((-1.6, -1.6), (-0.9, -1.7))):
            rotate_about(d, (dx, dy - 0.34, 0.34), (1, 0, 0), 90)
        ground(parts)
    return parts


AID_BODY = (5.4, 7.7)      # tent body plan, m: 1:1.43 inside the 6 x 9 m plot
AID_HEIGHT = 3.4           # ridge, m
AID_OFFSET = (0.0, 0.65)   # body pushed to the rear: a 1.3 m yard in front for crates
AID_FRONT_Y = -2.7         # the gable plane, ray-cast on the fitted mesh
AID_TRIM_Y = 0.72          # raw source |y| beyond which the Meshy guy-line/stake slivers are cut


def build_kdf_aid_post(state):
    """Meshy ridge tent (entrance flap on the -Y gable, a camera face), its
    guy-line slivers trimmed and the plan stretched to the 2x3 plot: long axis
    on Blender Y = glTF -Z = game y = the footprint's `h`. PROVEN, not
    assumed: `ThreeRenderer.updateBuildingMeshes` places the clone at the
    footprint centre with no yaw, and `buildingFitScale` is fed the mesh's
    three-x extent against the footprint's x width (`maxX-minX+1`) and its
    three-z extent against the y depth, so Blender X (6 m) must be the 2-tile
    side and Blender Y (9 m) the 3-tile one."""
    src = os.path.join(meshy_dir("kdf-aid-post-remesh"), "model.glb")
    objs = import_glb(src)
    gone = delete_faces_where(objs[0], lambda c: abs(c.y) > AID_TRIM_Y)
    print(f"    trimmed {gone} sliver faces beyond |y| {AID_TRIM_Y}")
    lo, hi = fit_plan(objs, AID_BODY, AID_HEIGHT, AID_OFFSET)
    tent = split_by_role(objs[0], lambda c, n: "wall", "tent")["wall"]
    fy = AID_FRONT_Y
    # the doorway: the flap is rolled up in a slit about 1.2 m wide (ray-cast on
    # the fitted mesh: x within +-0.6, open to z 1.5-2.6). A glass pane sits 15 cm
    # behind the gable plane -- thin in y, facing -Y, a camera face -- so
    # `building_facing.py` has an opening to judge the front by.
    door = kit.box("door_pane", (1.1, 0.04, 1.7), (0.0, fy + 0.17, 0.95), "glass")
    posts = [kit.box(f"door_post{i}", (0.1, 0.1, 2.1), (x, fy - 0.06, 1.05), "metal") for i, x in enumerate((-0.72, 0.72))]
    lintel = kit.box("door_lintel", (1.54, 0.1, 0.1), (0.0, fy - 0.06, 2.1), "metal")
    # the white band: a pale `dome` (limestone.1) strip across the entrance
    # gable, proud of the canvas by 8 cm. No glyph, no cross: a plain band.
    band = kit.box("gable_band", (2.3, 0.16, 0.42), (0.0, fy - 0.02, 1.95), "dome")
    crates = [
        kit.box("crate0", (0.75, 0.55, 0.5), (-1.95, -3.7, 0.25), "wood"),
        kit.box("crate1", (0.6, 0.5, 0.45), (-1.25, -3.6, 0.225), "wood"),
        kit.box("crate2", (0.6, 0.5, 0.42), (-1.9, -3.68, 0.71), "wood"),
        kit.box("crate3", (0.7, 0.5, 0.5), (-2.15, -4.25, 0.25), "wood"),
    ]
    crates[2].data.transform(Matrix.Translation((-1.9, -3.68, 0)) @ Matrix.Rotation(0.2, 4, "Z") @ Matrix.Translation((1.9, 3.68, 0)))
    # a stretcher on the ground by the door: two grip poles and a flat canvas bed
    sx, sy = 1.55, -3.6
    stretcher = [
        kit.box("str_pole0", (2.2, 0.05, 0.05), (sx, sy - 0.28, 0.1), "metal"),
        kit.box("str_pole1", (2.2, 0.05, 0.05), (sx, sy + 0.28, 0.1), "metal"),
        kit.box("str_bed", (2.0, 0.5, 0.03), (sx, sy, 0.1), "wall"),
    ]
    stakes, ropes = [], []
    for sgn in (-1, 1):
        for i, y in enumerate((-1.6, 0.2, 2.0, 3.8)):
            stakes.append(kit.box(f"stake_{sgn}_{i}", (0.1, 0.1, 0.3), (sgn * 2.94, y, 0.15), "metal"))
            ropes.append(rod(f"rope_{sgn}_{i}", (sgn * 2.62, y, 1.45), (sgn * 2.94, y, 0.28), 0.018, "metal"))
    parts = [tent, door, lintel, band] + posts + crates + stretcher + stakes + ropes
    if state == "wreck":
        for o in [door, lintel, band] + posts + stakes + ropes + stretcher:
            bpy.data.objects.remove(o, do_unlink=True)
        parts = [tent] + crates
        # the canvas comes down flat: diced, crushed to a low ragged heap that
        # lies over the crates, which are moved under it (inside the old plan)
        _dice([tent], 1.2)
        collapse([tent], 0.0, AID_HEIGHT)
        scale_about(tent, (0, AID_OFFSET[1], 0), (1.0, 1.0, 0.45))
        for c, (x, y) in zip(crates, ((-1.2, -0.3), (-0.5, 0.8), (1.3, 0.2), (1.0, -1.6))):
            translate(c, (x + 1.95, y + 3.7, 0))
        # ONE standing frame bay at the far (+Y) end: two arched hoops, purlins,
        # and a torn strip of canvas hanging from the rear hoop. Porch is down.
        parts += aid_hoop_bay(y0=3.55, y1=4.35)
        # torn flap tail on the ground at the front where the porch stood
        parts.append(kit.box("flap_scrap", (1.5, 1.1, 0.04), (0.4, -3.3, 0.02), "wall"))
        ground(parts)
    return parts


def rod(name, a, b, r, role):
    """A square-section rod between two points (guy ropes, hoop segments)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized() * r
    w = d.cross(u).normalized() * r
    v = [a + u + w, a - u + w, a - u - w, a + u - w, b + u + w, b - u + w, b - u - w, b + u - w]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return kit._mesh(name, [tuple(x) for x in v], f, role)


def aid_hoop(label, y, a=2.35, b=2.95, n=12, r=0.07):
    """One arched hoop in the XZ plane at world y: a half-ellipse of `n` rod
    segments, half-width `a`, crown `b`."""
    pts = [(a * math.cos(math.pi * i / n), y, b * math.sin(math.pi * i / n)) for i in range(n + 1)]
    return [rod(f"{label}_{i}", pts[i], pts[i + 1], r, "metal") for i in range(n)]


def aid_hoop_bay(y0, y1):
    """The one frame bay left standing: two hoops, purlins between them, a
    torn canvas strip hanging off the rear hoop."""
    out = aid_hoop("hoop0", y0) + aid_hoop("hoop1", y1)
    for i, ang in enumerate((25, 55, 90, 125, 155)):
        t = math.radians(ang)
        p = (2.35 * math.cos(t), 2.95 * math.sin(t))
        out.append(rod(f"purlin{i}", (p[0], y0, p[1]), (p[0], y1, p[1]), 0.05, "metal"))
    out.append(kit.box("hoop_tear", (0.04, 0.8, 1.3), (2.3, (y0 + y1) / 2, 0.9), "wall"))
    return out


def build_kdf_outpost(state):
    """Meshy sandbag ring + gabion block + flat roof; ladder on +X at yaw 0.
    Ring < 45% height -> wall (olive, as camp's HESCO); block -> wood (dust,
    the plywood frame); roof > 88% -> metal. Firing slits added as glass."""
    src = os.path.join(meshy_dir("kdf-outpost-remesh"), "model.glb")
    objs = import_glb(src)
    lo, hi = fit(objs, 0, 6.0)
    H = hi.z - lo.z

    def cls(c, n):
        if c.z > 0.88 * H:
            return "metal"
        if c.z > 0.45 * H:
            return "wood"
        return "wall"
    roles = split_by_role(objs[0], cls, "outpost")
    # find the block's extent for slit placement
    blo, bhi = bounds([roles["wood"]])
    slits = []
    for i, y in enumerate((-0.9, 0.0, 0.9)):
        slits.append(kit.box(f"slit_x{i}", (0.06, 0.5, 0.22), (bhi.x + 0.02, y, 0.45 * H + 0.9), "glass"))
        slits.append(kit.box(f"slit_y{i}", (0.5, 0.06, 0.22), (y, blo.y - 0.02, 0.45 * H + 0.9), "glass"))
    parts = list(roles.values()) + slits
    if state == "wreck":
        ring, block, roof = roles["wall"], roles["wood"], roles["metal"]
        delete_faces_where(ring, lambda c: c.x > 1.2 and c.y < -1.2)      # front corner breached
        scale_about(block, (0, 0, 0), (1.0, 1.0, 0.55))
        rotate_about(roof, (-2.6, 0, 0.55 * H), (0, 1, 0), 28)           # roof down on the +X side
        translate(roof, (0.4, 0, -(0.88 * H - 0.55 * H) * 0.6))
        for s in slits:
            bpy.data.objects.remove(s, do_unlink=True)
        parts = [ring, block, roof]
        parts += scatter_bags("spill", 16, (2.0, -2.0), 1.8, 21, role="wall")
        ground(parts)
    return parts


def build_kdf_intel_centre(state):
    """Meshy container + lattice mast + dish + sandbag skirt; door on +X at yaw
    0. Above the cabin top -> metal; the low outer skirt -> wood; cabin -> wall
    (olive). A window pane on +X gives the facing gate something to judge."""
    src = os.path.join(meshy_dir("kdf-intel-centre-remesh"), "model.glb")
    objs = import_glb(src)
    lo, hi = fit(objs, 0, 6.0)
    H = hi.z - lo.z
    me = objs[0].data
    # cabin top: the highest height band whose XY span is still most of the
    # footprint -- above it only the mast, dish and antenna remain. A face
    # histogram was tried first and picked a lattice band (dense, small
    # faces) 10.7 m up; span is the honest signal.
    bands = 40
    span = [None] * bands
    for p in me.polygons:
        i = min(bands - 1, int((p.center.z - lo.z) / H * bands))
        c = p.center
        b = span[i]
        span[i] = [c.x, c.x, c.y, c.y] if b is None else [min(b[0], c.x), max(b[1], c.x), min(b[2], c.y), max(b[3], c.y)]
    areas = [((b[1] - b[0]) * (b[3] - b[2])) if b else 0.0 for b in span]
    big = max(areas)
    cabin_top = lo.z + H * (max(i for i, a in enumerate(areas) if a > 0.45 * big) + 1) / bands
    # Fit by the CABIN, not the mast: at 6 m wide the source's cabin stood 4.3
    # m tall (a container is 2.6-2.9). Rescale so the cabin top is 3.2 m; the
    # mast then tops out near 9 m, which is what the prompt asked for.
    k2 = 3.2 / cabin_top
    for o in objs:
        o.scale = (k2, k2, k2)
    bpy.context.view_layer.update()
    apply_all(objs)
    lo, hi = bounds(objs)
    H = hi.z - lo.z
    cabin_top = 3.2
    xs, ys = [], []
    for p in me.polygons:
        if 0.3 * cabin_top < p.center.z < 0.8 * cabin_top:
            xs.append(p.center.x)
            ys.append(p.center.y)
    cx0, cx1, cy0, cy1 = min(xs) + 0.15, max(xs) - 0.15, min(ys) + 0.15, max(ys) - 0.15
    print(f"    cabin top {cabin_top:.2f} m of {H:.2f}; cabin x[{cx0:.2f},{cx1:.2f}] y[{cy0:.2f},{cy1:.2f}]; "
          f"footprint {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f}")

    def cls(c, n):
        if c.z > cabin_top + 0.05 * H:
            return "metal"
        if c.z < 0.3 * cabin_top and not (cx0 < c.x < cx1 and cy0 < c.y < cy1):
            return "wood"
        return "wall"
    roles = split_by_role(objs[0], cls, "intel")
    win = kit.box("cabin_win", (0.05, 0.9, 0.6), (cx1 + 0.17, (cy0 + cy1) / 2 + 0.6, cabin_top * 0.62), "glass")
    parts = list(roles.values()) + [win]
    if state == "wreck":
        cabin, mast, skirt = roles["wall"], roles["metal"], roles.get("wood")
        mlo, mhi = bounds([mast])
        base = ((mlo.x + mhi.x) / 2, (mlo.y + mhi.y) / 2, cabin_top)
        rotate_about(mast, base, (0, 0, 1), 35)
        rotate_about(mast, base, (1, 1, 0), -82)                   # toppled diagonally across the pad
        mlo, _ = bounds([mast])
        translate(mast, (0.6, -0.6, 0.05 - mlo.z))                 # and down onto the ground, across the cabin
        scale_about(cabin, (0, 0, 0), (1.05, 1.05, 0.6))
        cabin.data.transform(Matrix.Shear("XZ", 4, (0.18, 0.0)))
        bpy.data.objects.remove(win, do_unlink=True)
        parts = [cabin, mast] + ([skirt] if skirt else [])
        parts += scatter_bags("spill", 10, (-1.5, -2.0), 1.4, 31)
        ground(parts)
    return parts


def build_kdf_workshop(state):
    """Meshy open canopy; roof > 60% height -> wall (olive canvas/steel),
    everything else (posts, gantry, bench, drums) -> metal. No glass: an open
    canopy has no pane, so the facing gate names it unchecked."""
    src = os.path.join(meshy_dir("kdf-workshop-remesh"), "model.glb")
    objs = import_glb(src)
    lo, hi = fit(objs, 0, 6.0)
    # The source canopy is 2.8 m at 6 m wide -- a Lavi is 2.5 m tall and
    # would not fit under it. Stretch z 1.45x (posts and roof only get
    # taller; at 40 px the clutter's distortion is invisible).
    for o in objs:
        o.scale = (1.0, 1.0, 1.45)
    bpy.context.view_layer.update()
    apply_all(objs)
    lo, hi = bounds(objs)
    H = hi.z - lo.z
    roles = split_by_role(objs[0], lambda c, n: "wall" if c.z > 0.6 * H else "metal", "workshop")
    parts = list(roles.values())
    if state == "wreck":
        roof, rest = roles["wall"], roles["metal"]
        delete_faces_where(rest, lambda c: c.x < -1.0 and c.z > 0.35 * H)   # -X posts gone
        rotate_about(roof, (2.9, 0, 0.6 * H), (0, 1, 0), 42)              # roof down on the -X side
        rlo, _ = bounds([roof])
        translate(roof, (0.3, 0, 0.05 - rlo.z))
        delete_faces_where(rest, lambda c: c.x < -1.0 and c.z > 0.12 * H)   # -X post stubs too
        drums = [kit.oil_drum(f"wdrum{i}", (0, 0, 0)) for i in range(3)]
        for i, d in enumerate(drums):
            rotate_about(d, (0, 0, 0.34), (1, 0, 0), 90)
            translate(d, (1.2 + 0.8 * i, -2.4 + 0.5 * _hash01(41, i), 0))
        parts = [roof, rest] + drums
        ground(parts)
    return parts


# --- the forward camp (GH-277 follow-on) ----------------------------------
#
# Meshy-7 text-to-3D delivered TWO separate objects in one remesh (task
# 01a1a645, from preview 01a1a640): a gabled frame tent on -X and an open
# vehicle bay under a pitched camouflage net on +X, side by side, 1.9 units
# across. Neither fits a 2x2 plot as delivered (the pair is 1.9 x 1.2 units,
# a long rectangle, and the bay carries curtains on three sides), so this
# recipe carves the two shells apart, drops what the lead cut (the curtains,
# the ground slab, the guy-ropes), re-fits each onto its own corner of the
# 6 x 6 m plot, and rebuilds the four poles as steel.
#
# PLAN, Blender axes (X east, Y north; the dimetric camera sees the +X and -Y
# faces, so -Y is the front). The camera's screen-right axis is (+1,+1): the
# tent takes the screen-left corner (-X/-Y) and the net the screen-right one
# (+X/+Y), so the tall net never stands in front of the low tent. The
# near corner (+X/-Y) is a low sandbag L, the rear-left strip (-X/+Y) holds
# the mast and the crates, and the tent door opens on -Y onto a steel ramp.
#
#   y= 3 |  mast  crates |  net (4 poles, 3.6-4.25 m)
#        |    tent       |
#        |  (2.2 m)      |
#   y=-2 |  [ramp]       |  sandbag L ...........
#   y=-3 +----------------------------------------> x
#       -3                0                      3
FC_TENT_BOX = ((-3.0, -1.75, 0.0), (-0.2, 1.85, 2.2))     # target bounds of the tent shell
FC_NET_BOX = ((0.15, 0.10, 3.60), (3.0, 3.0, 4.25))       # target bounds of the net lid
FC_TENT_SRC = (-0.82, -0.09, 0.47)  # raw body: x range, |y| limit (everything beyond is rope)
FC_NET_Z0 = 0.135                   # raw z above which a face belongs to the net lid (below: curtains)
FC_POLE_H = 4.1
FC_SAG = 0.30                       # m of sag at the middle of the net
FC_MAST_AT = (-2.65, 2.35)
FC_MAST_H = 3.9                     # the steel mast; its whip takes the top to 5.0 m
FC_DOOR_X = -1.65                   # tent door centre (x), ray-cast on the fitted mesh
FC_DOOR_W = 0.7                     # opening width after widening
FC_DOOR_H = 1.5                     # opening height (the flap closes above z 1.5)
FC_FRONT_Y = -1.55                  # the canvas front plane at the door, ray-cast on the fitted mesh
FC_POLES = ((0.34, 0.28), (2.79, 0.28), (0.34, 2.79), (2.79, 2.79))


def carve(src, keep, name):
    """A new object holding only the faces of `src` whose centre satisfies
    `keep`. The source is untouched."""
    me = src.data.copy()
    me.name = name
    bm = bmesh.new()
    bm.from_mesh(me)
    doomed = [f for f in bm.faces if not keep(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def remap_box(ob, lo_to, hi_to):
    """Affine-map an object's own bounds onto [lo_to, hi_to], per axis (the
    plan stretches differently in x, y and z, as `fit_plan` does). Vertex
    work at real coordinates; the object transform stays identity."""
    apply_all([ob])
    lo, hi = bounds([ob])
    k = [(hi_to[i] - lo_to[i]) / (hi[i] - lo[i]) for i in range(3)]
    m = Matrix.Translation(Vector(lo_to)) @ Matrix.Diagonal(Vector(k)).to_4x4() @ Matrix.Translation(-lo)
    ob.data.transform(m)
    ob.data.update()
    return k


def build_kdf_forward_camp(state):
    src = os.path.join(meshy_dir("kdf-forward-camp-remesh"), "model.glb")
    objs = import_glb(src)
    raw = objs[0]
    apply_all([raw])
    x0, x1, ylim = FC_TENT_SRC
    tent = carve(raw, lambda c: x0 < c.x < x1 and abs(c.y) < ylim, "tent")
    net = carve(raw, lambda c: c.x > 0.05 and c.z >= FC_NET_Z0, "net")
    bpy.data.objects.remove(raw, do_unlink=True)
    tent["rl_role"] = "wall"
    net["rl_role"] = "roof"
    kt = remap_box(tent, *FC_TENT_BOX)
    kn = remap_box(net, *FC_NET_BOX)
    # the net sags between its four poles: a deterministic paraboloid, deepest
    # in the middle, zero at the corners (hand-rolled; no mathutils.noise)
    nlo, nhi = bounds([net])
    for v in net.data.vertices:
        u = 2 * (v.co.x - nlo.x) / (nhi.x - nlo.x) - 1
        w = 2 * (v.co.y - nlo.y) / (nhi.y - nlo.y) - 1
        v.co.z -= FC_SAG * (1 - u * u) * (1 - w * w)
    net.data.update()
    print(f"    tent {len(tent.data.polygons)} faces (scale {kt[0]:.2f} {kt[1]:.2f} {kt[2]:.2f}), "
          f"net {len(net.data.polygons)} faces (scale {kn[0]:.2f} {kn[1]:.2f} {kn[2]:.2f})")
    # The door. Ray-cast on the fitted mesh (x scan at z 0.5-1.3, from -Y): the
    # canvas front plane is y -1.5 to -1.6, and the rolled flap leaves a slit
    # only ~0.35 m wide at x -1.8..-1.5, closed again above z 1.5, with the
    # back wall (y +1.6) showing through. Widened here to 0.7 m so a dark
    # opening reads at gameplay zoom, and backed by a `glass` pane 0.2 m behind
    # the front plane, which also gives `building_facing.py` an opening to judge.
    dx, dw = FC_DOOR_X, FC_DOOR_W
    delete_faces_where(tent, lambda c: abs(c.x - dx) < dw / 2 and c.y < FC_FRONT_Y + 0.55 and c.z < FC_DOOR_H)
    door = kit.box("door_pane", (dw + 0.3, 0.04, FC_DOOR_H + 0.1), (dx, FC_FRONT_Y + 0.35, (FC_DOOR_H + 0.1) / 2), "glass")
    # the pale `dome` band over the door -- the aid post's established "aid"
    # sign (this camp also gives medic care): a plain strip, no glyph
    band = kit.box("door_band", (1.1, 0.12, 0.26), (dx, FC_FRONT_Y - 0.1, FC_DOOR_H + 0.28), "dome")
    # the low steel ramp at the door: a wedge rising toward the tent, plus a landing
    ramp = [kit.wedge("ramp", (1.3, 1.15, 0.36), (dx, FC_FRONT_Y - 0.12 - 0.575, 0.0), "metal", axis="y"),
            kit.box("ramp_landing", (1.3, 0.14, 0.36), (dx, FC_FRONT_Y - 0.12 + 0.07, 0.18), "metal")]
    # steel poles under the net, and their base plates
    poles = []
    for i, (px, py) in enumerate(FC_POLES):
        poles.append(kit.box(f"pole{i}", (0.14, 0.14, FC_POLE_H), (px, py, FC_POLE_H / 2), "metal"))
        poles.append(kit.box(f"pole_plate{i}", (0.36, 0.36, 0.07), (px, py, 0.035), "metal"))
    # a low sandbag L at the near corner (+X/-Y): two courses, open at the
    # tent end and at the bay's rear -- not a ring (that is `camp`'s outline)
    bags = sandbag_wall("wallA", (-0.5, -2.78), (2.78, -2.78), 0.0, 2)
    bags += sandbag_wall("wallB", (2.78, -2.78), (2.78, -0.5), 0.0, 2)
    # the mast: a 3.9 m telescoping steel mast at the rear-left, with a whip
    mx, my = FC_MAST_AT
    mast = [kit.box("mast_plate", (0.5, 0.5, 0.08), (mx, my, 0.04), "metal"),
            kit.box("mast", (0.1, 0.1, FC_MAST_H), (mx, my, FC_MAST_H / 2), "metal"),
            kit.box("mast_whip", (0.05, 0.05, 1.1), (mx, my, FC_MAST_H + 0.55), "metal")]
    # stores: crates beside the mast, a drum, the bay's tool chest and spare roadwheels
    crates = [kit.box("crate0", (0.85, 0.6, 0.55), (-1.5, 2.45, 0.275), "wood"),
              kit.box("crate1", (0.6, 0.6, 0.5), (-0.85, 2.5, 0.25), "wood"),
              kit.box("crate2", (0.6, 0.5, 0.45), (-1.35, 2.42, 0.78), "wood")]
    crates[2].data.transform(Matrix.Translation((-1.35, 2.42, 0)) @ Matrix.Rotation(0.25, 4, "Z")
                             @ Matrix.Translation((1.35, -2.42, 0)))
    chest = kit.box("tool_chest", (0.95, 0.5, 0.6), (1.1, 1.1, 0.3), "metal")
    wheels = [kit.cylinder(f"wheel{i}", 0.46, 0.26, (2.35, 1.0, 0.26 * i), "metal", segments=12) for i in range(3)]
    parts = [tent, net, door, band] + ramp + poles + bags + mast + crates + [chest] + wheels
    if state == "wreck":
        parts = _fc_wreck(tent, net, door, band, ramp, poles, bags, mast, crates, chest, wheels)
    return parts


def _remove(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


def _fc_wreck(tent, net, door, band, ramp, poles, bags, mast, crates, chest, wheels):
    """The forward camp down. ONE pole stays standing at a lean -- the element
    that tells this wreck from the medic station's and the workshop's -- with
    the net torn down in the bay, the tent flat at about 0.6 m, the mast
    fallen across the pad, the stores scattered. Per-part rigid moves and
    hash-seeded jitter only (`_hash01`; no mathutils.noise)."""
    _remove([door, band] + bags)
    # tent: diced, crushed to a low ragged heap
    _dice([tent], 1.0)
    collapse([tent], 0.0, FC_TENT_BOX[1][2])
    tcx = (FC_TENT_BOX[0][0] + FC_TENT_BOX[1][0]) / 2
    tcy = (FC_TENT_BOX[0][1] + FC_TENT_BOX[1][1]) / 2
    scale_about(tent, (tcx, tcy, 0), (1.0, 1.0, 0.5))
    # net: torn down onto the bay floor in ragged folds -- height per 0.4 m cell from a hash
    for v in net.data.vertices:
        h = _hash01(int(v.co.x / 0.4) + 50, int(v.co.y / 0.4) + 50, 97)
        v.co.z = 0.12 + 0.5 * h
    net.data.update()
    translate(net, (-0.15, -0.1, 0))
    # poles: pole 1 (near right) stands, leaning; pole 0 lies across the bay on the diagonal;
    # poles 2 and 3 are snapped stubs. Plates stay where they were.
    pole = [o for o in poles if o.name.startswith("pole") and not o.name.startswith("pole_plate")]
    plates = [o for o in poles if o.name.startswith("pole_plate")]
    (px, py) = FC_POLES[1]
    rotate_about(pole[1], (px, py, 0.07), (1, 0, 0), 16)          # the survivor, leaning toward the camera
    (qx, qy) = FC_POLES[0]
    bisect_keep_below(pole[0], 2.6)                                 # snapped: 2.6 m of it fits across the bay
    rotate_about(pole[0], (qx, qy, 0.07), (1, 0, 0), -88)          # down along +Y ...
    rotate_about(pole[0], (qx, qy, 0.07), (0, 0, 1), -37)          # ... and swung across the bay
    for o in (pole[2], pole[3]):
        bisect_keep_below(o, 0.55)
    # mast: down across the pad, tip resting on the heap
    for m in mast:
        if m.name.startswith("mast_plate"):
            continue
        rotate_about(m, (FC_MAST_AT[0], FC_MAST_AT[1], 0.08), (1, 0, 0), 82)
        rotate_about(m, (FC_MAST_AT[0], FC_MAST_AT[1], 0.08), (0, 0, 1), 40)
    # crates thrown about; the chest over on its side; wheels flat and scattered
    for i, c in enumerate(crates):
        rotate_about(c, (-1.2, 2.45, 0.0), (0, 0, 1), -50 + 40 * i)
        translate(c, (0.3 * (i - 1), -0.9 - 0.7 * i, 0))
    rotate_about(chest, (1.1, 1.1, 0.0), (1, 0, 0), 90)
    translate(chest, (-0.2, -0.5, 0))
    for i, w in enumerate(wheels):
        translate(w, (-1.3 + 0.55 * i, -0.6 - 0.5 * _hash01(33, i), 0))
        translate(w, (0, 0, -0.26 * i))
    spill = scatter_bags("spill", 16, (1.0, -1.6), 1.25, 81)
    heap = sandbag_wall("heap", (-0.4, -2.75), (2.0, -2.75), 0.0, 1)
    parts = [tent, net] + ramp + pole + plates + mast + crates + [chest] + wheels + spill + heap
    ground(parts)
    return parts


def _fc_construction(parts, seed):
    """The forward camp under construction: the tent cut to a 1.0 m wall stub
    (about half its own height) and the four poles to 1.9 m stubs (45% of the
    4.25 m net line), the net, mast, band, sandbag L and stores not yet put up,
    the ramp (steel, laid first) and the shared scaffold kit standing where
    this plan is clear: the scaffold at the near corner, the pallet by the
    ramp, the spoil heap at the rear-left."""
    keep = []
    for p in parts:
        n = p.name
        if n.startswith(("net", "mast", "door_band", "wall", "crate", "tool_chest", "wheel")):
            bpy.data.objects.remove(p, do_unlink=True)
            continue
        if n.startswith("tent") or n.startswith("door_pane"):
            bisect_keep_below(p, 1.0)
        elif n.startswith("pole") and not n.startswith("pole_plate"):
            bisect_keep_below(p, 0.45 * FC_NET_BOX[1][2])
        keep.append(p)
    return keep + scaffold_kit(seed, scaffold=(1.9, -1.9), pallet_at=(0.3, -2.0),
                               spoil_at=(-1.6, 2.2), spoil_r=0.8, spill_at=(0.5, -0.6))


def _construction(parts, seed):
    """The standing parts cut at CONSTRUCTION_FRACTION of the building's own
    height, plus the shared scaffold kit."""
    H = _height_of(parts)
    z = CONSTRUCTION_FRACTION * H
    kept = []
    for p in parts:
        plo, phi = bounds([p])
        if plo.z >= z:
            bpy.data.objects.remove(p, do_unlink=True)
            continue
        if phi.z > z:
            bisect_keep_below(p, z)
        if len(p.data.polygons) == 0:
            bpy.data.objects.remove(p, do_unlink=True)
            continue
        kept.append(p)
    print(f"    construction: cut at {z:.2f} m of {H:.2f}")
    return kept + scaffold_kit(seed)


# --- militia --------------------------------------------------------------

def build_militia_observation_post(state, yaw):
    """Meshy textured lattice tower with a lookout cabin; fitted to the 1x1
    pad (3 m) so the tower stands ~8 m. Lattice and legs (< 62% height) ->
    metal, cabin -> wall; both keep the bake. A viewing slot on +X is a
    palette glass piece so the facing gate can judge it."""
    src = os.path.join(meshy_dir("militia-observation-post-remesh"), "model.glb")
    objs = import_glb(src)
    normalise_meshy_images()
    lo, hi = fit(objs, yaw, 3.0)
    H = hi.z - lo.z
    # Meshy put a flag on the roof despite the prompt; the rule is no flags.
    gone = delete_faces_where(objs[0], lambda c: c.z > lo.z + OP_FLAG_FRAC * H)
    print(f"    flag: removed {gone} faces above {OP_FLAG_FRAC:.2f} of the height")
    roles = split_by_role(objs[0], lambda c, n: "wall" if c.z > 0.62 * H else "metal", "op")
    clo, chi = bounds([roles["wall"]])
    slot = kit.box("op_slot", (0.05, 1.2, 0.3), (chi.x + 0.02, (clo.y + chi.y) / 2, clo.z + (chi.z - clo.z) * 0.6), "glass")
    parts = list(roles.values()) + [slot]
    if state == "wreck":
        cabin, legs = roles["wall"], roles["metal"]
        bpy.data.objects.remove(slot, do_unlink=True)
        for o in (cabin, legs):
            rotate_about(o, (-1.1, -1.1, 0.2), (1, -1, 0), 72)   # falls toward the camera (-X/-Y)
        scale_about(cabin, (0, 0, 0), (1.0, 1.0, 0.7))
        parts = [cabin, legs] + scatter_bags("spill", 6, (0.3, 0.3), 1.0, 51)
        ground(parts)
    return parts


def build_militia_weapons_workshop(state, yaw, roof_frac):
    """Meshy textured garage with a lean-to and yard clutter; open bay on the
    camera side by `yaw`. Roof above `roof_frac` -> roof, else wall; both keep
    the bake. A palette glass pane on +X if the bake has a window there."""
    src = os.path.join(meshy_dir("militia-weapons-workshop-remesh"), "model.glb")
    objs = import_glb(src)
    normalise_meshy_images()
    lo, hi = fit(objs, yaw, 6.0)
    H = hi.z - lo.z
    roles = split_by_role(objs[0], lambda c, n: "roof" if (c.z > roof_frac * H and n.z > 0.35) else "wall", "ww")
    parts = list(roles.values())
    if state == "wreck":
        walls, roof = roles["wall"], roles.get("roof")
        _dice([walls], 0.5)
        collapse([walls], 0.0, H * 0.75)
        if roof:
            rotate_about(roof, (0, 2.8, roof_frac * H), (1, 0, 0), -30)
            translate(roof, (0, -0.4, -0.35 * H))
            scale_about(roof, (0, 0, 0), (1.0, 1.0, 0.5))
        parts = [walls] + ([roof] if roof else [])
        ground(parts)
    return parts


def build_militia_field_clinic(state):
    """A 6 x 3.6 m corner of the shipped textured `clinic.glb` (its real +X
    facade and -Y end wall, cuts on the hidden -X/+Y), pushed to the rear of
    the pad; a pale canvas annex and a sandbag ring in front."""
    objs = import_glb(os.path.join(SHIPPED, "clinic.glb"))
    for o in objs:
        o.name = "clinic_" + (o.get("rl_role") or o.name)
    crop_lo, crop_hi = (-0.9, -7.06, -1), (5.1, -2.4, 20)
    kept = []
    for o in objs:
        crop_box(o, crop_lo, crop_hi)
        if len(o.data.polygons) == 0:
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            kept.append(o)
    # cut wall roof? the crop leaves the lower rooftop; move to the pad's rear
    lo, hi = bounds(kept)
    dx, dy = -(lo.x + hi.x) / 2, -lo.y + (-0.6)
    for o in kept:
        translate(o, (dx, dy, -lo.z))
    lo, hi = bounds(kept)
    print(f"    clinic crop: {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} m at y[{lo.y:.2f},{hi.y:.2f}]")
    annex_wall = kit.box("annex_body", (4.4, 2.3, 1.3), (-0.6, -1.75, 0.65), "dome")
    annex = kit.wedge("annex", (4.4, 2.3, 1.0), (-0.6, -1.75, 1.3), "dome", axis="y", flip=False)
    # `rust`, not `metal`: the crop keeps some of the clinic's own textured
    # `metal` rooftop units, and a palette piece joined into a textured role
    # would sample texel (0,0). A rusty tank and props read right anyway.
    posts = [kit.box(f"annex_post{i}", (0.08, 0.08, 2.3), (x, -2.85, 1.15), "rust") for i, x in enumerate((-2.7, 1.5))]
    ring = sandbag_wall("ring", (-2.95, -2.95), (2.95, -2.95), 0.0, 3)
    ring += sandbag_wall("ring2", (2.95, -2.95), (2.95, 2.9), 0.0, 3)
    roof_obj = [o for o in kept if o.get("rl_role") == "roof"]
    roof_top = bounds(roof_obj)[1].z if roof_obj else hi.z - 0.2
    tank = kit.roof_tank("tank", (2.2, 2.2, roof_top - 0.05), role="rust")
    tank = tank if isinstance(tank, list) else [tank]
    parts = kept + [annex, annex_wall] + tank + posts + ring
    if state == "wreck":
        for o in kept:
            _dice([o], 0.6)
        collapse(kept, 0.0, hi.z * 0.8)
        scale_about(annex, (0, -1.75, 0), (1.05, 1.05, 0.2))
        bpy.data.objects.remove(annex_wall, do_unlink=True)
        for p in posts:
            bpy.data.objects.remove(p, do_unlink=True)
        for b in ring:
            bpy.data.objects.remove(b, do_unlink=True)
        for t in tank:
            rotate_about(t, (2.2, 2.2, roof_top), (1, 0, 0), 90)
            translate(t, (-1.0, -1.5, -roof_top))
        parts = kept + [annex] + tank + scatter_bags("spill", 18, (0.0, -2.4), 2.4, 61)
        ground(parts)
    return parts


def build_militia_firing_position(state):
    """The shipped palette `shanty.glb` shed scaled to 0.62, its -Y window
    toward the camera, at the rear of the pad; an L of sandbags (5 courses) on
    the +X/-Y camera sides, a 3 m corner stack at +X/-Y, open at the back."""
    objs = import_glb(os.path.join(SHIPPED, "shanty.glb"))
    for o in objs:
        o.name = "shed_" + (o.get("rl_role") or o.name)
    # yaw 0: the shanty's window is on its -Y wall, which is a camera face
    # (glTF +Z); at 180 the gate read it 241 vs 1003 hidden, i.e. the back.
    fit(objs, 0, 5.4, offset=(-0.2, 0.9), scale_override=0.62)
    lo, hi = bounds(objs)
    wallL = sandbag_wall("par_y", (-2.95, -2.95), (1.7, -2.95), 0.0, 5)
    wallL += sandbag_wall("par_x", (2.95, -1.6), (2.95, 2.95), 0.0, 5)
    stack = []
    for c in range(11):
        for i in range(3):
            for j in range(3):
                stack.append(kit.box(f"stack_{c}_{i}_{j}", (0.6, 0.6, 0.26),
                                     (1.95 + 0.62 * i - 0.62, -1.95 + 0.62 * j - 0.62, 0.13 + 0.26 * c), "wood"))
    slit = kit.box("stack_slit", (0.05, 0.5, 0.2), (2.9, -1.95, 11 * 0.26 - 0.45), "glass")
    drums = [kit.oil_drum("fp_drum", (-2.4, 1.9, 0))]
    parts = objs + wallL + stack + [slit] + drums
    if state == "wreck":
        _dice(objs, 0.5)
        collapse(objs, 0.0, hi.z * 0.9)
        for b in wallL + stack:
            bpy.data.objects.remove(b, do_unlink=True)
        bpy.data.objects.remove(slit, do_unlink=True)
        heap = sandbag_wall("heap_y", (-2.6, -2.7), (1.4, -2.7), 0.0, 2)
        heap += sandbag_wall("heap_x", (2.7, -1.4), (2.7, 2.6), 0.0, 2)
        parts = objs + heap + drums + scatter_bags("spill", 22, (1.4, -1.4), 2.2, 71)
        ground(parts)
    return parts


# --------------------------------------------------------------------------
# table and driver
# --------------------------------------------------------------------------

KDF = {
    "kdf_medic_station": build_kdf_medic_station,
    "kdf_outpost": build_kdf_outpost,
    "kdf_intel_centre": build_kdf_intel_centre,
    "kdf_workshop": build_kdf_workshop,
    "kdf_aid_post": build_kdf_aid_post,
    "kdf_forward_camp": build_kdf_forward_camp,
}
# yaw (degrees about z) that puts the opening on Blender +X / -Y, from the
# four-view renders (report), and the militia workshop's roof band.
OP_YAW = 0
OP_FLAG_FRAC = 0.90  # the cabin roof apex sits under this; the flag pole above it
WW_YAW = 0
WW_ROOF_FRAC = 0.62
MILITIA = {
    "militia_observation_post": lambda s: build_militia_observation_post(s, OP_YAW),
    "militia_weapons_workshop": lambda s: build_militia_weapons_workshop(s, WW_YAW, WW_ROOF_FRAC),
    "militia_field_clinic": build_militia_field_clinic,
    "militia_firing_position": build_militia_firing_position,
}
TEXTURED = {"militia_observation_post", "militia_weapons_workshop", "militia_field_clinic"}
NAMES = {
    "kdf_medic_station": "KDF medic station", "kdf_outpost": "KDF outpost",
    "kdf_intel_centre": "KDF intel centre", "kdf_workshop": "KDF workshop",
    "kdf_aid_post": "KDF aid post", "kdf_forward_camp": "KDF forward camp",
    "militia_observation_post": "militia observation post",
    "militia_weapons_workshop": "militia weapons workshop",
    "militia_field_clinic": "militia field clinic",
    "militia_firing_position": "militia firing position",
}
PARENTS = {"militia_field_clinic": "clinic.glb", "militia_firing_position": "shanty.glb"}


def credit_for(bid):
    if bid in PARENTS:
        return CREDIT_KITBASH.format(name=NAMES[bid], parent=PARENTS[bid])
    return CREDIT_MESHY.format(name=NAMES[bid])


def run(bid, states=None):
    builder = KDF.get(bid) or MILITIA.get(bid)
    if builder is None:
        raise SystemExit(f"unknown building {bid!r}; known: {sorted(KDF) + sorted(MILITIA)}")
    states = states or (["idle", "construction", "wreck"] if bid in KDF else ["idle", "wreck"])
    results = {}
    for state in states:
        print(f"[{bid}] {state}")
        wipe()
        parts = builder("wreck" if state == "wreck" else "idle")
        if state == "construction":
            seed = sum(ord(c) for c in bid)
            parts = _fc_construction(parts, seed) if bid == "kdf_forward_camp" else _construction(parts, seed)
        suffix = "" if state == "idle" else f"_{state}"
        results[state] = export(os.path.join(OUT_DIR, f"{bid}{suffix}.glb"), credit_for(bid), bid in TEXTURED)
    return results


SRC_DIR = os.path.join(REPO, "art", "src", "buildings")
# Works whose `.blend` source is committed beside the GLBs. The four 30 Sep KDF
# works shipped without one (their source is the remesh plus this script); the
# forward camp closes that gap for itself, because "never commit a mesh without
# its .blend" is the repository's own rule.
BLEND_SOURCES = {"kdf_forward_camp": os.path.join(SRC_DIR, "kdf_forward_camp.blend")}
BLEND_STATE_SPACING = 9.0  # m between the three states laid side by side in the source file


def save_source_blend(bid):
    """Rebuild the three states in ONE scene -- idle at x 0, construction at +9,
    wreck at +18, one collection each -- and save it. Not the GLB's own
    scene (which is wiped per state): this is the file a person opens to see
    the parts, the roles (`rl_role` on every object) and the kit."""
    builder = KDF[bid]
    wipe()
    for k, state in enumerate(("idle", "construction", "wreck")):
        before = set(bpy.data.objects)
        parts = builder("wreck" if state == "wreck" else "idle")
        if state == "construction":
            _fc_construction(parts, seed=sum(ord(c) for c in bid))
        new = [o for o in bpy.data.objects if o not in before]
        coll = bpy.data.collections.new(state)
        bpy.context.scene.collection.children.link(coll)
        for o in new:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll.objects.link(o)
            if k:
                o.data.transform(Matrix.Translation((k * BLEND_STATE_SPACING, 0, 0)))
                o.data.update()
    path = BLEND_SOURCES[bid]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print(f"  saved {os.path.relpath(path, REPO)} ({len(bpy.data.objects)} objects)")


if __name__ == "__main__":
    want = [a for a in _argv if not a.startswith("--")]
    only_states = None
    if "--states" in _argv:
        only_states = _argv[_argv.index("--states") + 1].split(",")
        want = [a for a in want if a not in only_states and "," not in a]
    if not want or want == ["all"]:
        want = list(KDF) + list(MILITIA)
    for b in want:
        run(b, only_states)
        if b in BLEND_SOURCES and only_states is None and OUT_DIR == SHIPPED:
            save_source_blend(b)
