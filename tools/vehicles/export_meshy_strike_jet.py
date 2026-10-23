"""Export `strike_jet` -- the fixed-wing strike jet that flies over the map when
the player calls an air strike (GH-748; numbers approved by the lead on the
issue, 22 Oct; prompt and numbers in `docs/art/meshy-prompts-strike-jet.md`)
-- from its Meshy text-to-3D remesh as ONE textured rigid mesh.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_strike_jet.py -- [--probe]

Writes `art/meshes/vfx/strike_jet.glb` and its `.blend`
(`art/src/aircraft/strike_jet.blend`, the export session saved with the bake
packed). `--probe` prints the source's numbers after the cut and writes
nothing. Then `pnpm encode:meshes` mirrors it into `assets/meshes/vfx/`.

IT IS NOT A UNIT. Presentation only: no unit JSON, no catalogue entry, no
clips (no `idle`, no `wreck` -- a rigid mesh moved by code), no
`rotor_pivot`, no kit. It lives under `art/meshes/vfx/`, which
`render_mesh_gate.py` skips (a silhouette-collision check means nothing for
an aircraft that is on screen for four seconds and is on nobody's roster).
One node, `hull_hull` (`extras.rl_role = "hull"`, `rl_part = "hull"`), on the
remesh's one baked material.

THE METHOD. `export_meshy_yanshuf.py`'s shape -- one remesh in, one textured
mesh out -- with three steps of its own, all constants applied to the
source's own vertex data, all printed:

  1. Import the ledger's LAST `kind: remesh` task named `strike_jet` (a
     remesh of a REFINED task keeps its bake); rename the base colour to
     `base_color` so `textured.prepare_vehicle_textures` finds it.
  2. SCRUB the markings the refine painted although the prompt and the
     negative prompt both forbade them (`MARKS`, below): a grey disc that
     reads as a roundel and a white stencil panel on the left flank, a
     "01"-like number on the right flank, and small stencils and text on the
     nose and the spine. The bake is a pale-and-grey camouflage, so a colour
     rule (the D9's `scrub_white`) would eat half the airframe; each mark is
     located in 3D instead -- a centre, an ellipse and the direction it was
     seen from, read off flat-lit orthographic renders of the source -- and
     scrubbed in texture space: rays cast along that direction inside the
     ellipse name the faces that are visible there, and every texel of those
     faces whose 3D point projects inside it takes the colour, normal and
     metallic-roughness of the NEAREST sample in a ring around the mark, so
     the camouflage continues through it (see `_scrub_markings`).
  3. CUT what the brief does not have. Meshy put the landing gear DOWN (the
     negative prompt named it) and hung eight stores where the brief asked
     for two bombs. Both are under the airframe, so both are cut by face
     CENTROID (a stores face) or LOWEST VERTEX (a gear face) below a level
     the source's own z profile puts under the skin there (`GEAR_BOXES`,
     `STORE_*`): the nose gear, both main gears, and
     the three outboard stores and the tip rail on each wing; the inboard
     pair stays as the two bombs. A face straddling the cut goes with the
     side its centroid is on, so no pylon sheet is left hanging. Loose
     fragments the cut leaves below the wing are dropped, and ONLY the edges
     that became boundary are filled (`export_meshy_yanshuf._split`'s rule:
     the remesh's UV seams already split vertices).
  4. Orient: the nose is the end WITHOUT the fins -- the outer fifth at each
     end, by its highest point (both printed); turned to +X (glTF +X).
  5. SCALE TO THE DECLARED BOX, per axis: length 10.5, span 7.5, height 2.4
     GLB units (3 per tile; the lead's numbers). The source's own
     proportions are 1.895 : 1.586 : ~0.47, so a uniform scale cannot hit
     all three; the three factors are printed and the span is the one that
     moves (about 0.85 of the length factor: the wings come in a little).
     Origin at the centre of the plan bounding box, z = 0 at the lowest
     point (the bombs), as the vehicles are.
  6. Triangles at most `TRI_CAP`; decimated only if over. Textures at
     `textured.TEXTURE_PX`; export through `textured.gltf_kwargs`. The bake's
     metallic channel is 0 everywhere (measured), so nothing draws black
     under a renderer that gives vehicles no environment map.

AI-generated source (Meshy text-to-3D preview + 2k refine + remesh),
disclosed per CONTRIBUTING.md; task ids in `docs/ASSET_PROVENANCE.md`.
DETERMINISM: no `mathutils.noise`; every threshold is a constant.
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
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import textured as vehicle_textured  # noqa: E402
from export_meshy_ramp import _remesh_source, _rename_textures, _bake, _bounds  # noqa: E402

REPO = os.path.dirname(TOOLS)
UNIT_ID = "strike_jet"
OUT_PATH = os.path.join(REPO, "art", "meshes", "vfx", "strike_jet.glb")
BLEND_DIR = os.path.join(REPO, "art", "src", "aircraft")
BLEND_PATH = os.path.join(BLEND_DIR, "strike_jet.blend")
CREDIT = (
    "Strike jet (fictional, no markings) -- AI-generated (Meshy text-to-3D preview + 2k refine + "
    "remesh), disclosed per CONTRIBUTING.md; markings scrubbed, landing gear and six stores cut, "
    "re-oriented and scaled for Roaring Lions (GH-748)"
)

# The lead's numbers (GH-748), GLB units: 3 per tile.
LENGTH = 10.5
SPAN = 7.5
HEIGHT = 2.4
TRI_CAP = 15000

# --- step 2: the markings, in the SOURCE frame (after the importer's own
# matrix is baked; nose at -X, fins at +X, as Meshy delivered it). Read off
# flat-lit orthographic renders of the source at 0.000625 units a pixel, each
# mark's extent measured against a 0.02-unit grid. `view` is the axis the
# mark was seen FROM (rays travel the other way); the mark is an ellipse of
# half-axes (hu, hv) in that view's plane: u = X; v = Z on a flank, Y from
# above.
#   (name, view, centre (x, y, z), (hu, hv))
MARKS = (
    ("flank_L_disc",     (0, -1, 0), (-0.5875, 0.0, 0.0025), (0.044, 0.038)),  # grey roundel-like disc
    ("flank_L_panel",    (0, -1, 0), (-0.4250, 0.0, -0.0206), (0.046, 0.032)),  # white stencil panel
    ("flank_L_text_a",   (0, -1, 0), (-0.5188, 0.0, -0.0625), (0.024, 0.012)),
    ("flank_L_text_b",   (0, -1, 0), (-0.3000, 0.0, -0.0663), (0.014, 0.010)),
    ("flank_L_glyph",    (0, -1, 0), (-0.3125, 0.0, -0.0100), (0.014, 0.012)),
    ("flank_L_stencil",  (0, -1, 0), (-0.1688, 0.0, 0.1088), (0.012, 0.010)),
    ("flank_R_number",   (0, 1, 0), (-0.3538, 0.0, 0.0100), (0.027, 0.021)),   # "01"
    ("flank_R_tag",      (0, 1, 0), (-0.2338, 0.0, 0.0625), (0.038, 0.011)),
    ("nose_top_stencil", (0, 0, 1), (-0.6220, -0.0070, 0.0), (0.016, 0.040)),
    ("nose_top_disc",    (0, 0, 1), (-0.5720, -0.0690, 0.0), (0.030, 0.020)),  # the flank disc's upper edge
    ("spine_text",       (0, 0, 1), (-0.1940, 0.1655, 0.0), (0.045, 0.016)),
    ("spine_tag_L",      (0, 0, 1), (-0.1063, -0.1350, 0.0), (0.058, 0.011)),
    ("spine_tag_R",      (0, 0, 1), (-0.1063, 0.1338, 0.0), (0.058, 0.011)),
    ("spine_text_b",     (0, 0, 1), (-0.0657, -0.1600, 0.0), (0.022, 0.010)),
    ("spine_text_c",     (0, 0, 1), (-0.0690, 0.1590, 0.0), (0.022, 0.010)),
)
MASK_E = 1.15               # texels within this normalised ellipse radius are repainted
RING_E = (1.3, 2.2)         # the colours come from this ring around the mark
RAYS_PER_HALF = 6           # ray spacing = the shorter half-axis / this
RING_DEPTH = 0.05           # a ring hit this far off the mark's own depth is another surface

# --- step 3: the cut, in the SOURCE frame. A gear face goes when its
# centroid is inside a box AND its LOWEST vertex is below the box's z; a
# centroid rule there left the open gear doors' shards hanging under the
# nose fairing (long thin faces whose centroids sat just above the cut).
# From the source's z profile: the nose fairing bottoms at z -0.133..-0.137
# and the nose gear runs to -0.290; the nacelles bottom at -0.155 and the
# mains run to -0.270.
GEAR_BOXES = (
    # (name, x range, |y| range, cut z)
    ("nose_gear", (-0.54, -0.34), (0.00, 0.07), -0.140),
    ("main_gear", (0.12, 0.32), (0.09, 0.24), -0.160),
)
# The wing underside, measured between the stores: z -0.075 at |y| 0.45,
# -0.083 at 0.58, -0.090 at 0.70, -0.094 at 0.78 -- a straight line through
# them, less a margin, is the cut. Stores inboard of STORE_Y_MIN (the pair at
# |y| 0.34-0.40, the largest) stay as the two bombs.
STORE_Y_MIN = 0.47
STORE_Z0 = -0.072           # wing underside at |y| = STORE_Y_REF
STORE_Y_REF = 0.42
STORE_SLOPE = 0.07          # anhedral: z falls this much per unit of |y|
STORE_MARGIN = 0.006
LOOSE_MAX_FACES = 60        # a fragment this small, wholly below the wing, is cut debris
WELD_REACH = 0.03           # source units: seam duplicates welded this near the cut ring


def _coords(ob):
    return np.array([[v.co.x, v.co.y, v.co.z] for v in ob.data.vertices], dtype=np.float64)


# ---------------------------------------------------------------------------
# step 2: scrub
# ---------------------------------------------------------------------------

def _image_array(img):
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, img.channels)


def _image_store(img, arr):
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.update()


def _view_basis(view):
    d = Vector(view).normalized()
    a = Vector((0.0, 0.0, 1.0)) if abs(d.z) < 0.9 else Vector((0.0, 1.0, 0.0))
    u = a.cross(d).normalized()
    v = d.cross(u).normalized()
    return d, u, v


def _hits(ob, view, centre, half, e_lo, e_hi):
    """Ray hits whose plane position lies at normalised ellipse radius
    e_lo..e_hi around `centre`, seen from `view`: (face, location, pu, pv)."""
    d, u, v = _view_basis(view)
    c = Vector(centre)
    hu, hv = half
    step = min(hu, hv) / RAYS_PER_HALF
    nu, nv = int(math.ceil(e_hi * hu / step)), int(math.ceil(e_hi * hv / step))
    out = []
    for i in range(-nu, nu + 1):
        for j in range(-nv, nv + 1):
            pu, pv = i * step, j * step
            e = math.hypot(pu / hu, pv / hv)
            if e < e_lo or e > e_hi:
                continue
            base = c - d * c.dot(d) + u * pu + v * pv
            ok, loc, _n, fi = ob.ray_cast(base + d * 10.0, -d)
            if ok:
                out.append((fi, loc.copy(), pu, pv))
    return out


def _uv_of(ob, fi, loc):
    """UV of a point on face `fi`, by barycentric weights over its triangle fan."""
    me = ob.data
    poly = me.polygons[fi]
    uv = me.uv_layers.active.data
    loops = list(poly.loop_indices)
    p = np.array(loc)
    best = None
    for k in range(1, len(loops) - 1):
        tri = (loops[0], loops[k], loops[k + 1])
        P = np.array([me.vertices[me.loops[l].vertex_index].co for l in tri])
        w = _bary(p, P)
        err = -min(w)
        if best is None or err < best[0]:
            best = (err, tri, w)
    _, tri, w = best
    U = np.array([uv[l].uv for l in tri])
    return w @ U


def _bary(p, P):
    v0, v1, v2 = P[1] - P[0], P[2] - P[0], p - P[0]
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-18:
        return np.array([1.0, 0.0, 0.0])
    b = (d11 * d20 - d01 * d21) / den
    c = (d00 * d21 - d01 * d20) / den
    return np.array([1.0 - b - c, b, c])


def _mask_texels(ob, faces, view, centre, half, w, h):
    """Every texel of `faces` whose 3D point projects inside MASK_E of the
    mark's ellipse, rasterised triangle by triangle in UV space, with its
    plane position: arrays (ix, iy, pu, pv), deduplicated."""
    me = ob.data
    uvl = me.uv_layers.active.data
    _d, u, v = _view_basis(view)
    U3, V3 = np.array(u), np.array(v)
    c = np.array(centre)
    hu, hv = half
    found = {}
    for fi in faces:
        poly = me.polygons[fi]
        loops = list(poly.loop_indices)
        for k in range(1, len(loops) - 1):
            tri = (loops[0], loops[k], loops[k + 1])
            T = np.array([uvl[l].uv for l in tri]) * np.array([w, h])
            P = np.array([me.vertices[me.loops[l].vertex_index].co for l in tri])
            x0, y0 = np.floor(T.min(axis=0)).astype(int) - 1
            x1, y1 = np.ceil(T.max(axis=0)).astype(int) + 1
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, w - 1), min(y1, h - 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            q = np.stack([gx.ravel(), gy.ravel()], axis=1)
            a, b, cc = T
            v0, v1 = b - a, cc - a
            den = v0[0] * v1[1] - v1[0] * v0[1]
            if abs(den) < 1e-12:
                continue
            v2 = q - a
            l1 = (v2[:, 0] * v1[1] - v1[0] * v2[:, 1]) / den
            l2 = (v0[0] * v2[:, 1] - v2[:, 0] * v0[1]) / den
            l0 = 1.0 - l1 - l2
            tol = -1.0 / max(abs(den) ** 0.5, 1.0)   # about one texel of slack at the edges
            inside = (l0 >= tol) & (l1 >= tol) & (l2 >= tol)
            if not inside.any():
                continue
            W3 = np.stack([l0, l1, l2], axis=1)[inside] @ P
            rel = W3 - c
            pu, pv = rel @ U3, rel @ V3
            near = np.hypot(pu / hu, pv / hv) <= MASK_E
            qi = q[inside][near].astype(int)
            for (ix, iy), a_, b_ in zip(qi, pu[near], pv[near]):
                found.setdefault((int(ix), int(iy)), (float(a_), float(b_)))
    if not found:
        return np.zeros(0, int), np.zeros(0, int), np.zeros(0), np.zeros(0)
    keys = sorted(found)
    ix = np.array([k[0] for k in keys])
    iy = np.array([k[1] for k in keys])
    pu = np.array([found[k][0] for k in keys])
    pv = np.array([found[k][1] for k in keys])
    return ix, iy, pu, pv


def _scrub_markings(ob, base):
    """Repaint each mark from its own surroundings: every masked texel takes
    the base colour, normal and metallic-roughness of the NEAREST ring
    sample (in the mark's ellipse-normalised plane), so the camouflage edges
    that cross a mark continue through it instead of ending in a flat disc
    -- the first cut filled each mark with one median colour, and on the
    spine that drew two pale discs that read as roundels themselves. Ring
    samples that fall inside ANY mark, or on another surface (off the mark's
    own depth), are not used."""
    images = {i.name: i for i in bpy.data.images}
    normal = images.get("normal")
    mr = images.get("metallic_roughness")
    w, h = base.size
    # One resolution for all three maps (`prepare_vehicle_textures` brings
    # them to TEXTURE_PX = 2048 anyway), so one mask and one index serve all.
    for img in (normal, mr):
        if img is not None and tuple(img.size) != (w, h):
            print(f"[{UNIT_ID}] {img.name}: {tuple(img.size)} -> {(w, h)} before the scrub")
            img.scale(w, h)
    maps = [m for m in (base, normal, mr) if m is not None]
    arrs = [_image_array(m) for m in maps]
    rgb = arrs[0]

    plans = []
    union = np.zeros((h, w), dtype=bool)
    for name, view, centre, half in MARKS:
        inner = _hits(ob, view, centre, half, 0.0, MASK_E)
        ring = _hits(ob, view, centre, half, RING_E[0], RING_E[1])
        if not inner:
            raise SystemExit(f"[{UNIT_ID}] mark {name}: no surface under it -- not where it was read from")
        d = np.array(_view_basis(view)[0])
        depth = float(np.median([np.array(loc) @ d for _f, loc, _u, _v in inner]))
        ring = [r for r in ring if abs(np.array(r[1]) @ d - depth) <= RING_DEPTH]
        faces = sorted({fi for fi, *_ in inner})
        ix, iy, pu, pv = _mask_texels(ob, faces, view, centre, half, w, h)
        union[iy, ix] = True
        plans.append((name, half, faces, (ix, iy, pu, pv), ring))

    total = 0
    for name, half, faces, (ix, iy, pu, pv), ring in plans:
        hu, hv = half
        rs = []
        for fi, loc, ru, rv in ring:
            uv = _uv_of(ob, fi, loc)
            tx = min(max(int(uv[0] * w), 0), w - 1)
            ty = min(max(int(uv[1] * h), 0), h - 1)
            if not union[ty, tx]:
                rs.append((tx, ty, ru, rv))
        if len(rs) < 8:
            raise SystemExit(f"[{UNIT_ID}] mark {name}: only {len(rs)} clean ring samples")
        rs = np.array(rs)
        du = (pu[:, None] - rs[None, :, 2]) / hu
        dv = (pv[:, None] - rs[None, :, 3]) / hv
        k = np.argmin(du * du + dv * dv, axis=1)
        sx, sy = rs[k, 0].astype(int), rs[k, 1].astype(int)
        before = np.abs(rgb[iy, ix, :3] - rgb[sy, sx, :3]).max(axis=1)
        for arr in arrs:
            arr[iy, ix, :3] = arr[sy, sx, :3]
        total += len(ix)
        print(f"[{UNIT_ID}] scrub {name:17s}: {len(faces):3d} faces, {len(ix):5d} texels from "
              f"{len(rs)} clean ring samples; |texel - its fill| p95 {float(np.percentile(before, 95)):.3f}, "
              f"max {float(before.max()):.3f} before, 0 after")
    for m, arr in zip(maps, arrs):
        _image_store(m, arr)
    print(f"[{UNIT_ID}] scrubbed {len(MARKS)} marks, {total} texels "
          f"({100.0 * total / (w * h):.3f}% of the {w}x{h} base colour); the normal and "
          f"metallic-roughness texels under each mark copied from the same ring samples")


# ---------------------------------------------------------------------------
# step 3: cut
# ---------------------------------------------------------------------------

def _store_cut_z(ay):
    return STORE_Z0 - STORE_SLOPE * (ay - STORE_Y_REF) - STORE_MARGIN


def _doomed(f):
    c = f.calc_center_median()
    x, y, z = c.x, c.y, c.z
    ay = abs(y)
    zlow = min(v.co.z for v in f.verts)
    for name, (x0, x1), (y0, y1), zc in GEAR_BOXES:
        if x0 <= x <= x1 and y0 <= ay <= y1 and zlow < zc:
            return name
    if ay >= STORE_Y_MIN and z < _store_cut_z(ay):
        return "stores"
    return None


def _pos_components(bm):
    """Connected components over shared vertex POSITIONS (the UV seams split
    vertices; by index every island is its own component)."""
    key = lambda co: (round(co.x, 5), round(co.y, 5), round(co.z, 5))
    by_key = {}
    for f in bm.faces:
        for v in f.verts:
            by_key.setdefault(key(v.co), []).append(f)
    seen = set()
    comps = []
    for f in bm.faces:
        if f.index in seen:
            continue
        comp, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for v in g.verts:
                for h in by_key[key(v.co)]:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        comps.append(comp)
    return comps


def _cut(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    for e in bm.edges:
        e.tag = e.is_boundary
    counts = {}
    doomed = []
    for f in bm.faces:
        why = _doomed(f)
        if why:
            counts[why] = counts.get(why, 0) + 1
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    print(f"[{UNIT_ID}] cut by centroid: " + ", ".join(f"{k} {v} faces" for k, v in sorted(counts.items())))

    bm.faces.ensure_lookup_table()
    bm.faces.index_update()
    comps = _pos_components(bm)
    sizes = sorted((len(c) for c in comps), reverse=True)
    debris = []
    for comp in comps:
        if len(comp) <= LOOSE_MAX_FACES:
            zmax = max(v.co.z for f in comp for v in f.verts)
            if zmax < -0.07:
                debris.extend(comp)
    if debris:
        bmesh.ops.delete(bm, geom=debris, context="FACES")
    print(f"[{UNIT_ID}] after the cut: {len(comps)} component(s) {sizes[:8]}; "
          f"{len(debris)} debris faces below the wing dropped")

    opened = [e for e in bm.edges if e.is_boundary and not e.tag]
    filled = 0
    n_opened = len(opened)
    if opened:
        # The remesh is split along its UV seams EVERYWHERE (24,042 boundary
        # edges before any cut), so a cut ring that crosses a seam is several
        # open chains and `holes_fill` finds no loop to close. Weld the seam
        # duplicates NEAR the ring only (within WELD_REACH of a ring vertex):
        # UVs and normals are per-loop data in bmesh and survive the weld.
        # What is still boundary there afterwards is the hole itself -- where
        # it closes. The source already carries 35 open and 24 non-manifold
        # edges (measured on a fully welded copy), and a ring that meets one
        # cannot close; those edges stay open and are counted below. They
        # are all on the underside, where the pylons and the gear legs met
        # the skin, which the game camera never sees.
        ring = [v.co.copy() for v in {v for e in opened for v in e.verts}]
        ring_np = np.array([tuple(c) for c in ring])
        region = []
        for v in bm.verts:
            if v.link_faces and np.min(np.sum((ring_np - np.array(v.co)) ** 2, axis=1)) <= WELD_REACH ** 2:
                region.append(v)
        bmesh.ops.remove_doubles(bm, verts=region, dist=1e-5)
        near = {v for v in region if v.is_valid}
        holes = [e for e in bm.edges if e.is_boundary and e.verts[0] in near and e.verts[1] in near]
        res = bmesh.ops.holes_fill(bm, edges=holes, sides=0)
        filled = len(res.get("faces", []))
        opened = [e for e in bm.edges if e.is_boundary and e.verts[0] in near and e.verts[1] in near]
        print(f"[{UNIT_ID}] cut ring: {n_opened} opened edges, {len(region)} vertices welded near it, "
              f"{len(holes)} hole edges -> {filled} fill faces, {len(opened)} still open")
    # Loose vertices and edges the delete left behind.
    loose_e = [e for e in bm.edges if not e.link_faces]
    if loose_e:
        bmesh.ops.delete(bm, geom=loose_e, context="EDGES")
    loose_v = [v for v in bm.verts if not v.link_faces]
    if loose_v:
        bmesh.ops.delete(bm, geom=loose_v, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{UNIT_ID}] {len(ob.data.polygons)} faces left after the cut")


# ---------------------------------------------------------------------------
# step 4-5: orient and scale
# ---------------------------------------------------------------------------

def _nose_sign(ob):
    pts = _coords(ob)
    x0, x1 = pts[:, 0].min(), pts[:, 0].max()
    L = x1 - x0
    lo = pts[pts[:, 0] < x0 + 0.2 * L][:, 2].max()
    hi = pts[pts[:, 0] > x1 - 0.2 * L][:, 2].max()
    sign = 1 if lo > hi else -1      # the fins are the tall end: the nose is the other one
    print(f"[{UNIT_ID}] end tops: -X fifth z {lo:+.3f}, +X fifth z {hi:+.3f} -> fins at "
          f"{'-X' if lo > hi else '+X'}, nose at {'+X' if sign > 0 else '-X'}")
    return sign


def export(probe=False):
    src, task_id = _remesh_source(UNIT_ID)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"[{UNIT_ID}] expected one mesh in {src}, found {[o.name for o in meshes]}")
    ob = meshes[0]
    for o in list(bpy.data.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    print(f"[{UNIT_ID}] source {os.path.relpath(src, REPO)} ({task_id}): {len(ob.data.polygons)} faces, "
          f"{len(ob.data.materials)} material(s), images {[(i.name, tuple(i.size)) for i in bpy.data.images]}")
    _bake([ob], ob.matrix_world.copy())
    ob.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()
    mn, mx = _bounds([ob])
    print(f"[{UNIT_ID}] source bounds x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")

    class _S:  # `_rename_textures` reads only `unit_id`
        unit_id = UNIT_ID
    base = _rename_textures(_S, ob)
    mra = next((i for i in bpy.data.images if i.name == "metallic_roughness"), None)
    if mra is not None:
        a = _image_array(mra)
        print(f"[{UNIT_ID}] metallic (B) range [{a[..., 2].min():.3f},{a[..., 2].max():.3f}], "
              f"roughness (G) median {float(np.median(a[..., 1])):.3f}")

    if not probe:
        _scrub_markings(ob, base)
    _cut(ob)

    if _nose_sign(ob) < 0:
        _bake([ob], Matrix.Rotation(math.radians(180.0), 4, "Z"))
    mn, mx = _bounds([ob])
    size = mx - mn
    print(f"[{UNIT_ID}] oriented: L {size.x:.4f} W {size.y:.4f} H {size.z:.4f} (source units)")
    if probe:
        print(f"[{UNIT_ID}] --probe: nothing written")
        return None

    sx, sy, sz = LENGTH / size.x, SPAN / size.y, HEIGHT / size.z
    print(f"[{UNIT_ID}] scale per axis: x {sx:.4f}, y {sy:.4f} ({sy / sx:.3f} of x), z {sz:.4f} ({sz / sx:.3f} of x)")
    _bake([ob], Matrix.Diagonal((sx, sy, sz, 1.0)))
    mn, mx = _bounds([ob])
    _bake([ob], Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))))
    mn, mx = _bounds([ob])

    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > TRI_CAP:
        mod = ob.modifiers.new("decimate", "DECIMATE")
        mod.ratio = (TRI_CAP / tris) * 0.995
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
        before, tris = tris, sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(f"[{UNIT_ID}] decimated {before} -> {tris} triangles (cap {TRI_CAP})")
    if tris > TRI_CAP:
        raise SystemExit(f"[{UNIT_ID}] {tris} triangles over the cap {TRI_CAP}")

    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    ob.name = ob.data.name = "hull_hull"
    ob["rl_role"] = "hull"
    ob["rl_part"] = "hull"

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    kept, _dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{UNIT_ID}] image {name}: {before} -> {after}")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(OUT_PATH, CREDIT))
    os.makedirs(BLEND_DIR, exist_ok=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
    print(f"[{UNIT_ID}] saved {BLEND_PATH} ({os.path.getsize(BLEND_PATH)} bytes)")
    size = mx - mn
    print(f"[{UNIT_ID}] wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes, {tris} tris, "
          f"L {size.x:.3f} x span {size.y:.3f} x H {size.z:.3f} GLB units; "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}])")
    return OUT_PATH


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    export(probe="--probe" in argv)
