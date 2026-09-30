"""Export the GH-277 field works -- four KDF works, four militia works -- as
building GLB triples/pairs, mesh contract v2's BUILDINGS section.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_fw_works.py -- all
    ... -- kdf_medic_station          # one building, all its states

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


def scaffold_kit(seed):
    """The shared construction kit: one two-lift scaffold tower at the
    front-right (+X/-Y) corner, a pallet of sandbags front-left, a spoil heap
    rear-left. Asymmetric on purpose (see module docstring)."""
    objs = []
    cx, cy = 1.9, -1.9
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
    px, py = -1.9, -2.0
    objs.append(kit.box("pallet", (1.2, 1.0, 0.12), (px, py, 0.06), "wood"))
    for i in range(3):
        for j in range(2):
            for c in range(3):
                objs.append(kit.box(f"pal_bag_{i}{j}{c}", (0.36, 0.44, 0.22),
                                    (px - 0.38 + 0.38 * i, py - 0.24 + 0.48 * j, 0.12 + 0.11 + 0.22 * c), "wood"))
    # spoil heap, rear-left
    objs.append(kit.cylinder("spoil", 1.1, 0.7, (-1.8, 1.9, 0.0), "roof", segments=10, taper=0.15))
    objs += scatter_bags("spill", 4, (0.4, -2.4), 0.8, seed)
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
            parts = _construction(parts, seed=sum(ord(c) for c in bid))
        suffix = "" if state == "idle" else f"_{state}"
        results[state] = export(os.path.join(OUT_DIR, f"{bid}{suffix}.glb"), credit_for(bid), bid in TEXTURED)
    return results


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
