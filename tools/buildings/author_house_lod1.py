"""Author `house_lod1`: the lower-detail twin of the two-storey house (GH-974).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_house_lod1.py [-- <texture px>]

Writes art/src/buildings/house_lod1.blend and art/meshes/buildings/house_lod1.glb.

Why. `house.glb` is a Meshy remesh of 39,016 triangles (glass 4,084, metal 11,714, roof 353, trim 746, wall 22,119) and a
town like Milh Flats draws six of them. Measured (GH-974 step 0, hiding every house): -0.6 ms at centre zoom 1 and
-0.7 at 1.6. At zoom 1 a metre is 15 px: the stone coursing (0.3 m) is 4 px and the rebar and the cables are under one.

Geometry. Not a decimate. Every number below was MEASURED off `house.glb` by ray-casting its surface (not its vertices),
in Blender's frame (the GLB's -z is Blender +y; the house is a box with its door on the +x face):

  main block   x -3.95..5.60, y -5.52..4.20, roof deck 9.20, parapet 0.35-0.38 thick to 9.70
  annex        x -6.38..-3.95, y -5.52..5.55: a 5.10 deck (5.60 for the landing at y > 3.72), walled 2.3 m high on the
               west and south sides, open to the north (an external stair climbs from its landing, +y side)
  windows      east face, 0.22 m reveals: y -3.98..-2.34 at z 1.98..3.50 and 6.38..7.90; y 0.94..2.66 at 6.38..7.90;
               the door y 0.82..2.30, z 0.34..3.26; a 0.34 m step slab on the +x side
  tanks        T1 r 0.70 at (-2.80, 2.75) to z 10.46; T2 r 0.64 at (3.22, 3.27), drum z 10.55..11.50 on four legs
  mast         a pole at (-1.62, 3.00) to z 12.71

Coplanar cells are dissolved (a flat wall is a few polygons, not a grid), so the triangles go to the shape, not to the
colour. Roles: the full mesh's five (`glass`, `metal`, `roof`, `trim`, `wall`), same node names and `rl_role`.

Colour (lead ruling, 5 Nov: patches of one texel a cell read as plaster at zoom 1.6). The twin carries its OWN baked
texture: one 1-material, 1-image atlas shared by the five roles. The UV layout is a clean unwrap (smart project, then
the faces that never face the camera -- west, north, the stair -- scaled to 40% so the texels go where the picture is,
then packed). The bake is Cycles selected-to-active, DIFFUSE colour only (no light), from `house.glb` onto the twin: the
stone coursing, the dark floor band, the window shutters and the roof mottling carry over from the Meshy bake. Metallic
is zeroed on the source for the bake (glTF's default metallic 1 would read as black albedo). No Meshy call, no noise.
"""
import math
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lod_twin_common as C  # noqa: E402
import kit  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
SRC_FULL = os.path.join(REPO, "art", "meshes", "buildings", "house.glb")
OUT_GLB = os.path.join(REPO, "art", "meshes", "buildings", "house_lod1.glb")
OUT_BLEND = os.path.join(REPO, "art", "src", "buildings", "house_lod1.blend")

CELL = 1.5          # only a construction grid now: coplanar cells are dissolved, the bake carries the colour
HIDDEN_CELL = 1.5
TRI_CEILING = 2600
TEX_PX = int(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else 512
HIDDEN_UV_SCALE = 0.4
CREDIT = ("House LOD1 (GH-974) -- built in Blender from code (tools/buildings/author_house_lod1.py), "
          "derived from art/meshes/buildings/house.glb, project original")

X_W, X_MAIN_W, X_E = -6.38, -3.95, 5.60
Y_S, Y_MAIN_N, Y_N = -5.52, 4.20, 5.55
Y_LAND = 3.72
Z_DECK, Z_ANNEX, Z_LAND, Z_PAR, Z_ANNEX_PAR = 9.20, 5.10, 5.60, 9.70, 7.40
REVEAL = 0.22
WINDOWS = [(-3.98, -2.34, 1.98, 3.50), (-3.98, -2.34, 6.38, 7.90), (0.94, 2.66, 6.38, 7.90)]
DOOR = (0.82, 2.30, 0.34, 3.26)


class Box:
    def __init__(self, x0, x1, y0, y1, z0, z1):
        self.x0, self.x1, self.y0, self.y1, self.z0, self.z1 = x0, x1, y0, y1, z0, z1

    def contains(self, p):
        return self.x0 < p[0] < self.x1 and self.y0 < p[1] < self.y1 and self.z0 < p[2] < self.z1


class Ramp:
    """The north stair: a prism over y y0..y1 under the line from (xa, za) down to (xb, zb)."""

    def __init__(self, xa, xb, y0, y1, za, zb):
        self.xa, self.xb, self.y0, self.y1, self.za, self.zb = xa, xb, y0, y1, za, zb

    def contains(self, p):
        if not (self.xa < p[0] < self.xb and self.y0 < p[1] < self.y1 and p[2] > 0):
            return False
        t = (p[0] - self.xa) / (self.xb - self.xa)
        return p[2] < self.za + t * (self.zb - self.za)


def lines(lo, hi, cell, extras=()):
    n = max(1, int(round((hi - lo) / cell)))
    ls = [lo + (hi - lo) * k / n for k in range(n + 1)]
    for e in extras:
        if lo + 1e-6 < e < hi - 1e-6 and all(abs(e - v) > 0.02 for v in ls):
            ls.append(e)
    return sorted(ls)


def point(axis, plane, a, b):
    return (plane, a, b) if axis == "x" else (a, plane, b) if axis == "y" else (a, b, plane)


def face(Q, solids, own, role, axis, sign, plane, ra, rb, extras_a=(), extras_b=(), holes=(), cell=CELL):
    """A grid of quads on the plane `axis`=plane facing `sign`, spanning ra x rb. A cell is dropped when it lies inside
    another solid or inside a hole. Returns the (a-lines, b-lines) used so a reveal can share its edge vertices."""
    ca_, cb_ = cell if isinstance(cell, tuple) else (cell, cell)
    la, lb = lines(ra[0], ra[1], ca_, extras_a), lines(rb[0], rb[1], cb_, extras_b)
    nrm = {"x": (sign, 0, 0), "y": (0, sign, 0), "z": (0, 0, sign)}[axis]
    for i in range(len(la) - 1):
        for j in range(len(lb) - 1):
            ca, cb = (la[i] + la[i + 1]) / 2, (lb[j] + lb[j + 1]) / 2
            if any(h[0] < ca < h[1] and h[2] < cb < h[3] for h in holes):
                continue
            c = point(axis, plane, ca, cb)
            probe = tuple(c[k] + 0.03 * nrm[k] for k in range(3))
            back = tuple(c[k] - 0.03 * nrm[k] for k in range(3))
            if any(s is not own and s.contains(probe) for s in solids):
                continue
            if not own.contains(back):      # a cell off its own box (a face spanning a notch): never emit
                continue
            Q.add(role, [point(axis, plane, la[i], lb[j]), point(axis, plane, la[i + 1], lb[j]),
                         point(axis, plane, la[i + 1], lb[j + 1]), point(axis, plane, la[i], lb[j + 1])], nrm)
    return la, lb


def box(Q, solids, bx, role_side, role_top, extra=None, cell=CELL):
    """Five faces of a box (never the underside). `extra[face]` = (extras_a, extras_b, holes)."""
    extra = extra or {}
    spec = {
        "x-": ("x", -1, bx.x0, (bx.y0, bx.y1), (bx.z0, bx.z1)),
        "x+": ("x", 1, bx.x1, (bx.y0, bx.y1), (bx.z0, bx.z1)),
        "y-": ("y", -1, bx.y0, (bx.x0, bx.x1), (bx.z0, bx.z1)),
        "y+": ("y", 1, bx.y1, (bx.x0, bx.x1), (bx.z0, bx.z1)),
        "z+": ("z", 1, bx.z1, (bx.x0, bx.x1), (bx.y0, bx.y1)),
    }
    out = {}
    for k, (axis, sign, plane, ra, rb) in spec.items():
        ea, eb, holes = extra.get(k, ((), (), ()))
        role = role_top if k == "z+" else role_side
        c = (HIDDEN_CELL, cell) if (k in ("x-", "y+") and cell == CELL and axis == "x") else \
            (HIDDEN_CELL, cell) if (k in ("x-", "y+") and cell == CELL) else cell
        out[k] = face(Q, solids, bx, role, axis, sign, plane, ra, rb, ea, eb, holes, c)
    return out


def prism(Q, role, cx, cy, r, z0, z1, n=12, top=True):
    """A regular n-gon drum. One quad per side, a fan on top."""
    ring = [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
    for k in range(n):
        (xa, ya), (xb, yb) = ring[k], ring[(k + 1) % n]
        mx, my = (xa + xb) / 2 - cx, (ya + yb) / 2 - cy
        Q.add(role, [(xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1)], (mx, my, 0))
        if top:
            Q.add(role, [(cx, cy, z1), (xa, ya, z1), (xb, yb, z1)], (0, 0, 1))


def build():
    Q = C.Quads()
    main = Box(X_MAIN_W, X_E, Y_S, Y_MAIN_N, 0.0, Z_DECK)
    par = [Box(X_MAIN_W, -3.58, Y_S, Y_MAIN_N, Z_DECK, Z_PAR), Box(5.22, X_E, Y_S, Y_MAIN_N, Z_DECK, Z_PAR),
           Box(-3.58, 5.22, Y_S, -5.14, Z_DECK, Z_PAR), Box(-3.58, 5.22, 3.85, Y_MAIN_N, Z_DECK, Z_PAR)]
    deck = Box(X_W, X_MAIN_W, Y_S, Y_LAND, 0.0, Z_ANNEX)
    land = Box(X_W, X_MAIN_W, Y_LAND, Y_N, 0.0, Z_LAND)
    wpar1 = Box(X_W, -6.03, Y_S, Y_LAND, Z_ANNEX, Z_ANNEX_PAR)
    wpar2 = Box(X_W, -6.03, Y_LAND, Y_N, Z_LAND, Z_ANNEX_PAR)
    spar = Box(-6.03, X_MAIN_W, Y_S, -5.17, Z_ANNEX, Z_ANNEX_PAR)
    step = Box(X_E, 6.39, 0.10, 3.10, 0.0, 0.34)
    ramp = Ramp(-3.90, 3.60, Y_MAIN_N, Y_N, 5.50, 0.10)
    solids = [main, *par, deck, land, wpar1, wpar2, spar, step, ramp]

    # the main block. East face: the window and door holes, with their edges as lines so the reveals share vertices.
    holes = [w for w in WINDOWS] + [DOOR]
    ea = sorted({v for h in holes for v in (h[0], h[1])})
    eb = sorted({v for h in holes for v in (h[2], h[3])})
    laa, lbb = {}, {}
    sides = box(Q, solids, main, "wall", "wall", extra={
        "x+": (ea, sorted(set(eb) | {4.30, 5.00}), holes),
        "y-": ((), (4.30, 5.00), ()),
        "z+": ((-3.58, 5.22), (-5.14, 3.85), ()),
    })
    la, lb = sides["x+"]
    for (y0, y1, z0, z1) in holes:
        deep = 0.30 if (y0, y1, z0, z1) == DOOR else REVEAL
        xb = X_E - deep
        ys = [v for v in la if y0 - 1e-6 <= v <= y1 + 1e-6]
        zs = [v for v in lb if z0 - 1e-6 <= v <= z1 + 1e-6]
        for i in range(len(ys) - 1):                       # sill and head
            Q.add("wall", [(X_E, ys[i], z0), (X_E, ys[i + 1], z0), (xb, ys[i + 1], z0), (xb, ys[i], z0)], (0, 0, 1))
            Q.add("wall", [(X_E, ys[i], z1), (X_E, ys[i + 1], z1), (xb, ys[i + 1], z1), (xb, ys[i], z1)], (0, 0, -1))
        for j in range(len(zs) - 1):                       # jambs
            Q.add("wall", [(X_E, y0, zs[j]), (X_E, y0, zs[j + 1]), (xb, y0, zs[j + 1]), (xb, y0, zs[j])], (0, 1, 0))
            Q.add("wall", [(X_E, y1, zs[j]), (X_E, y1, zs[j + 1]), (xb, y1, zs[j + 1]), (xb, y1, zs[j])], (0, -1, 0))
        Q.add("glass", [(xb, y0, z0), (xb, y1, z0), (xb, y1, z1), (xb, y0, z1)], (1, 0, 0))
        f, t = 0.10, 0.03                                  # frame: a 10 cm border, 3 cm proud
        for (a0, a1, b0, b1) in ((y0 - f, y1 + f, z1, z1 + f), (y0 - f, y1 + f, z0 - f, z0),
                                 (y0 - f, y0, z0, z1), (y1, y1 + f, z0, z1)):
            Q.add("trim", [(X_E + t, a0, b0), (X_E + t, a1, b0), (X_E + t, a1, b1), (X_E + t, a0, b1)], (1, 0, 0))
            for (p0, p1, q0, q1, nrm) in ((a0, a1, b1, b1, (0, 0, 1)), (a0, a1, b0, b0, (0, 0, -1)),
                                          (a0, a0, b0, b1, (0, -1, 0)), (a1, a1, b0, b1, (0, 1, 0))):
                Q.add("trim", [(X_E, p0, q0), (X_E + t, p0, q0), (X_E + t, p1, q1), (X_E, p1, q1)], nrm)
    # parapet: sides are wall, caps are roof
    for p in par:
        box(Q, solids, p, "wall", "roof")
    # annex
    box(Q, solids, deck, "wall", "wall", extra={"z+": ((), (), ())})
    box(Q, solids, land, "wall", "wall")
    for p in (wpar1, wpar2, spar):
        box(Q, solids, p, "wall", "roof")
    box(Q, solids, step, "wall", "wall")
    # the stair, as a ramp
    n = max(1, int(round(math.hypot(7.5, 5.4) / CELL)))
    for k in range(n):
        xa, xb = -3.90 + 7.5 * k / n, -3.90 + 7.5 * (k + 1) / n
        za, zb = 5.50 - 5.40 * k / n, 5.50 - 5.40 * (k + 1) / n
        Q.add("wall", [(xa, Y_MAIN_N, za), (xb, Y_MAIN_N, zb), (xb, Y_N, zb), (xa, Y_N, za)], (5.4, 0, 7.5))
        Q.add("wall", [(xa, Y_N, 0.0), (xb, Y_N, 0.0), (xb, Y_N, zb), (xa, Y_N, za)], (0, 1, 0))
    Q.add("wall", [(3.60, Y_MAIN_N, 0.0), (3.60, Y_N, 0.0), (3.60, Y_N, 0.10), (3.60, Y_MAIN_N, 0.10)], (1, 0, 0))
    # roof tanks, mast, rebar
    prism(Q, "metal", -2.80, 2.75, 0.70, Z_DECK, 10.46)
    prism(Q, "metal", 3.22, 3.27, 0.64, 10.55, 11.50)
    for dx in (-0.42, 0.42):
        for dy in (-0.42, 0.42):
            lx, ly = 3.22 + dx, 3.27 + dy
            lg = Box(lx - 0.035, lx + 0.035, ly - 0.035, ly + 0.035, Z_DECK, 10.55)
            box(Q, [], lg, "metal", "metal", cell=4.0)
    mast = Box(-1.655, -1.585, 2.965, 3.035, Z_DECK, 12.71)
    box(Q, [], mast, "metal", "metal", cell=4.0)
    for (rx, ry) in ((-3.65, -5.00), (-3.65, 3.90), (5.35, -4.80), (5.50, -4.85)):
        box(Q, [], Box(rx - 0.03, rx + 0.03, ry - 0.03, ry + 0.03, Z_PAR, 10.70), "metal", "metal", cell=4.0)
    return Q


ROLES = ("glass", "metal", "roof", "trim", "wall")
OUT_TEX = os.path.join(REPO, "art", "src", "buildings", "house_lod1_base_color.jpg")


def visible_to_camera(n):
    """The game camera sees +x, -y and up. A face is hidden when it faces none of them."""
    return not (n.x < 0.1 and n.y > -0.1 and n.z < 0.5)


def make_twin_object(Q):
    """One object, five material slots (one per role), shared corners merged, coplanar cells dissolved."""
    verts, faces, mats = [], [], []
    for ri, role in enumerate(ROLES):
        for q in Q.by_role.get(role, []):
            base = len(verts)
            verts += q
            faces.append(tuple(range(base, base + len(q))))
            mats.append(ri)
    me = bpy.data.meshes.new("house_lod1")
    me.from_pydata(verts, [], faces)
    me.validate()
    ob = bpy.data.objects.new("house_lod1", me)
    bpy.context.collection.objects.link(ob)
    for ri, role in enumerate(ROLES):
        m = bpy.data.materials.new(role)
        me.materials.append(m)
    for poly, mi in zip(me.polygons, mats):
        poly.material_index = mi
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts, edges=bm.edges, delimit={"MATERIAL"})
    bm.to_mesh(me)
    bm.free()
    return ob


def unwrap(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.002, scale_to_bounds=False)
    bm = bmesh.from_edit_mesh(ob.data)
    uv = bm.loops.layers.uv.active
    hidden = 0
    for f in bm.faces:
        if not visible_to_camera(f.normal):
            hidden += 1
            for l in f.loops:
                l[uv].uv *= HIDDEN_UV_SCALE
    bmesh.update_edit_mesh(ob.data)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=max(0.0015, 6.0 / TEX_PX), shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[house_lod1] unwrapped: {len(ob.data.polygons)} polygons, {hidden} hidden-facing (UV x{HIDDEN_UV_SCALE})")


def bake(twin, full_objs):
    """Cycles selected-to-active DIFFUSE colour: the full house's base colour onto the twin's own atlas."""
    for o in full_objs:
        for m in o.data.materials:
            if m and m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == "BSDF_PRINCIPLED":
                        n.inputs["Metallic"].default_value = 0.0
    img = bpy.data.images.new("house_lod1_base_color", TEX_PX, TEX_PX, alpha=False)
    img.generated_color = (0.32, 0.29, 0.26, 1.0)
    for m in twin.data.materials:
        m.use_nodes = True
        nt = m.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.nodes.active = node
        node.select = True
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    bpy.ops.object.select_all(action="DESELECT")
    for o in full_objs:
        o.select_set(True)
    twin.select_set(True)
    bpy.context.view_layer.objects.active = twin
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=6, margin_type="EXTEND",
                        use_selected_to_active=True, cage_extrusion=0.35, max_ray_distance=0.0, use_clear=True)
    img.filepath_raw = OUT_TEX
    img.file_format = "JPEG"
    scn = bpy.context.scene
    scn.render.image_settings.quality = 90
    img.save()
    return img


def finish(twin, img):
    """One material with the baked atlas as its base colour; five objects, one per role, named and tagged."""
    mat = bpy.data.materials.new("material")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    img.pack()
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    bpy.ops.object.select_all(action="DESELECT")
    twin.select_set(True)
    bpy.context.view_layer.objects.active = twin
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    out = []
    for ob in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("house_lod1")]:
        role = ob.data.materials[0].name.split(".")[0] if ob.data.materials else ""
        if role not in ROLES:
            raise SystemExit(f"house_lod1: a separated part has no role: {ob.name} {role!r}")
        ob.name = role
        ob.data.name = role
        ob["rl_role"] = role
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        out.append(ob)
    if sorted(o.name for o in out) != sorted(ROLES):
        raise SystemExit(f"house_lod1: roles after separate: {sorted(o.name for o in out)}")
    return out


def main():
    kit.new_scene()
    bpy.ops.import_scene.gltf(filepath=SRC_FULL)
    full_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    full_pts = [o.matrix_world @ v.co for o in full_objs for v in o.data.vertices]
    full_tris = sum(len(p.vertices) - 2 for o in full_objs for p in o.data.polygons)
    Q = build()
    twin = make_twin_object(Q)
    tris = sum(len(p.vertices) - 2 for p in twin.data.polygons)
    if tris > TRI_CEILING:
        raise SystemExit(f"house_lod1: {tris} triangles over the ceiling {TRI_CEILING}")
    unwrap(twin)
    img = bake(twin, full_objs)
    for o in full_objs:
        bpy.data.meshes.remove(o.data)    # frees the names `glass`..`wall` for the twin's own parts
    parts = finish(twin, img)
    kit.save(OUT_BLEND)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB, export_format="GLB", use_selection=False, export_apply=True,
        export_yup=True, export_skins=False, export_animations=False, export_extras=True,
        export_materials="EXPORT", export_image_format="JPEG", export_jpeg_quality=90, export_copyright=CREDIT,
    )
    pts = [o.matrix_world @ v.co for o in parts for v in o.data.vertices]
    lo, hi = C.bounds(pts)
    flo, fhi = C.bounds(full_pts)
    per = {o.name: len(o.data.polygons) for o in parts}
    print(f"[house_lod1] {tris} tris of {full_tris} ({100 * tris / full_tris:.1f}%); polygons {per}; texture {TEX_PX}px")
    print(f"[house_lod1] bounds lo {[round(v, 3) for v in lo]} hi {[round(v, 3) for v in hi]}; "
          f"full lo {[round(v, 3) for v in flo]} hi {[round(v, 3) for v in fhi]}; {os.path.getsize(OUT_GLB)} bytes")


if __name__ == "__main__":
    main()
