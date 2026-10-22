"""Export `spg_long_range` -- the Te'o Howitzer, a tracked 155 mm self-propelled
gun (special units P2, GH-709; prompt, numbers and task ids in
`docs/art/meshy-prompts-units.md`, "Te'o Howitzer") -- from its Meshy
text-to-3D remesh as a TEXTURED vehicle glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_spg_long_range.py -- [--probe] [--out <scratch.glb>]

Writes `art/meshes/vehicles/spg_long_range.glb` and its `.blend`
(`art/src/vehicles/spg_long_range.blend`, the export session saved with the
bake packed). `--probe` prints the source's own numbers and writes nothing.

THE METHOD. `export_meshy_tzav.py`'s tracked hull (the track band is
`hull_rubber`, the running-gear pass tags it afterwards) with
`export_meshy_yanshuf.py`'s way of cutting a moving part out of one welded
remesh -- by geometry, filling only the edges the cut opened -- applied twice:

  1. The Meshy bake is a jigsaw atlas, and the refine painted three tiny
     markings although the prompt and the negative prompt forbade any text:
     a word on each flank of the turret and a white mark on the rear plate.
     Each is found by its UV TEXEL RECTANGLE (located by raycasting the
     marking's 3D position to its texel, then read off the texture), and
     inside that rectangle every texel brighter than its local mean is
     replaced from the paint around it (`_scrub_markings`; the normal and
     metallic-roughness maps flattened under the same mask, as the D9's
     `scrub_white` does). Coverage and a residual re-detection are printed.
  2. Orient (bow `+X`: the gun points at the nose, so `Rz(180)` on the
     source), ground at z = 0, drop the whip antenna the remesh kept (the
     Namer's `collapse_boxes` method: it would double the height the wreck
     recipe scales by).
  3. The BARREL is cut by geometry at the trunnion: every face inside a
     cylinder of `barrel_r` about the fitted bore axis and forward of the
     plane `barrel_trunnion_a` along it (the sleeve, the tube, the recoil
     rails and the slice of mantlet around the bore). It is raised about the
     trunnion from the source's 10 degrees to `barrel_elev_deg` (the
     silhouette lever, the nearest neighbour being the D9), and the plain
     tube beyond `barrel_stretch_from` is lengthened by `barrel_stretch`
     (a stubby barrel reads as a mortar). A trunnion boss (a UV-pinned
     sphere, `kit.py`'s blobbed-joint rule) hides the seam the rotation opens.
  4. The TURRET is the box above the deck inside the turret footprint, cut
     the same way, so the wreck pass can throw it and the renderer can
     traverse it about `turret_pivot` (`extras.rl_pivot = "turret"`); the
     barrel and turret are siblings under it, as the Lavi's turret nodes are.
     The holes the cuts leave are capped with faces UV-pinned to the flat
     gunmetal patch `bake_fix.paint_metal_patch` paints into an empty UV hole.
  5. `hull_rubber` -- the track band, every face outboard of `track_ay` and
     below `track_z_top`. The six road wheels, idler and sprocket sit in that
     band; `running-gear-recipes.ts` carries the spin and scroll recipe.
  6. Scale so the HULL (hull_hull + hull_rubber, before the spades, barrel
     and turret) is `real_metres` long, ground z = 0, hull centred on the
     origin. Two lowered rear spades are built at full detail (the source has
     none: a plate, three ribs, a hinge barrel and a cutting edge each) and
     joined into `hull_hull`, pinned to the same patch.
  7. Textures at `textured.TEXTURE_PX`; export through `textured.gltf_kwargs`.
     Then `pnpm running-gear:meshes`, `wreck:meshes`, `damage:meshes`,
     `encode:meshes`.

THE DRAWN SIZE IS DECLARED, NOT READ: `real_metres` is the hull length.
Ownership: this script owns `art/meshes/vehicles/spg_long_range.glb`.

AI-generated source (Meshy text-to-3D preview + 2k refine + remesh),
disclosed per CONTRIBUTING.md; task ids in `docs/ASSET_PROVENANCE.md`.
DETERMINISM: no `mathutils.noise`; every threshold is a constant applied to
the source's own vertex data.
"""
import math
import os
import sys
from dataclasses import dataclass

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import textured as vehicle_textured  # noqa: E402
import bake_fix  # noqa: E402
from export_meshy_ramp import (  # noqa: E402
    _bake,
    _bounds,
    _fill_masked,
    _remesh_source,
    _rename_textures,
)

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
# Spelled out so `tools/src/mesh_ownership.test.ts` can read, from the source
# alone, which file this script writes.
OUT_SPG_LONG_RANGE = os.path.join(OUT_DIR, "spg_long_range.glb")
OUTPUTS = {"spg_long_range": OUT_SPG_LONG_RANGE}
BLEND_DIR = os.path.join(REPO, "art", "src", "vehicles")
BLEND_PATH = os.path.join(BLEND_DIR, "spg_long_range.blend")
TURRET_PIVOT_NODE = "turret_pivot"
SPADE_HINGE_Z = 0.78


@dataclass(frozen=True)
class SpgSpec:
    unit_id: str
    credit: str
    real_metres: float            # the HULL's length, declared (the barrel and spades are extra)
    tri_cap: int
    rot_z_deg: float              # bow -> +X
    # bake markings: UV texel rectangles (x0, x1, y0, y1; origin top-left, 2048 px atlas)
    marking_rects: tuple
    marking_delta: float          # a texel this much brighter than its local mean is ink
    marking_grow: int             # texels of dilation
    marking_peak_max: float       # a rectangle's brightest texel above its median must end under this
    # collapsed whip antenna (SOURCE frame after rot_z, ground-shifted: x0, x1, y0, y1, z_floor)
    whip_box: tuple
    # barrel
    tube_x_min: float             # tube verts (bore-axis fit): forward of this x ...
    tube_z_min: float             # ... and above this z
    barrel_trunnion_a: float      # trunnion, metres-in-source along the bore axis from the tube centroid
    barrel_r: float               # cylinder about the bore axis taken with the barrel
    barrel_elev_deg: float
    barrel_stretch_from: float    # axial coordinate beyond which the plain tube is lengthened
    barrel_stretch: float
    barrel_probe_x: float         # final-frame x forward of which every barrel vertex is plain tube
    boss_r: float                 # trunnion boss radius across the bore
    boss_depth: float             # ... and along it (a flattened dome)
    paint_texel: tuple            # (x, y) top-origin texel of flat hull paint, for the boss
    # turret (SOURCE frame after rot_z, ground-shifted): flood seed, and the deck that stops the flood
    turret_seed: tuple
    turret_box: tuple             # (x0, x1, |y|) the flood may not leave
    turret_flat_nz: float
    turret_flat_z: float
    turret_z_floor: float
    turret_pivot_xy: tuple        # pivot x, y; z is the deck (turret_z_floor)
    # tracks
    track_ay: float
    track_z_top: float


SPEC = SpgSpec(
    unit_id="spg_long_range",
    credit=(
        "Te'o Howitzer 155 mm self-propelled gun -- AI-generated (Meshy text-to-3D preview + 2k "
        "refine + remesh), disclosed per CONTRIBUTING.md; re-oriented, re-scaled, scrubbed of the "
        "bake's painted markings, barrel re-posed and lengthened, turret / track split and rear "
        "spades added in Blender for Roaring Lions (GH-709)"
    ),
    real_metres=6.8,
    tri_cap=46000,
    rot_z_deg=180.0,
    # Located 2026-10-22 by raycasting each marking's 3D position to its texel
    # and reading the 2048 base colour: the word on the turret's -y flank
    # (source frame) at texel (245..277, 1707..1713), its mirror on the +y
    # flank (1910..1921, 1450..1468, faint and turned on its side), and the
    # white mark on the rear plate at (1700..1707, 861..870).
    marking_rects=((240, 282, 1700, 1724), (1902, 1928, 1436, 1464), (1694, 1714, 856, 876)),
    marking_delta=0.035,
    marking_grow=3,
    marking_peak_max=0.08,
    # The whip's base is at (-0.091, 0.079, 0.758); its three upper vertices rings
    # sit at z 0.802, 0.996 and 1.108.
    whip_box=(-0.095, -0.083, 0.073, 0.083, 0.76),
    tube_x_min=0.6,
    tube_z_min=0.45,
    barrel_trunnion_a=-0.55,
    barrel_r=0.125,
    barrel_elev_deg=35.0,
    barrel_stretch_from=-0.2,
    barrel_stretch=2.0,
    barrel_probe_x=2.4,
    boss_r=0.125,
    boss_depth=0.075,
    # flat olive island the turret word was painted on (centre of the scrubbed rectangle)
    paint_texel=(262, 1712),
    turret_seed=(-0.10, 0.0, 0.70),
    turret_box=(-0.47, 0.38, 0.34),
    turret_flat_nz=0.92,
    turret_flat_z=0.66,
    turret_z_floor=0.40,
    turret_pivot_xy=(-0.07, 0.0),
    track_ay=0.27,
    track_z_top=0.30,
)


# ---------------------------------------------------------------------------
# bake: markings
# ---------------------------------------------------------------------------

def _box_mean(a, r):
    """Mean of `a` over the (2r+1)^2 box around each texel (edges padded by zeros, divided by the count)."""
    k = 2 * r + 1
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r))), 0), 1)
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / float(k * k)


def _marking_mask(lum, rects, delta, grow, h):
    """True where a texel inside one of `rects` is `delta` brighter than its local (9-texel box) mean."""
    mask = np.zeros(lum.shape, dtype=bool)
    loc = _box_mean(lum, 9)
    for (x0, x1, y0, y1) in rects:
        r0, r1 = h - y1, h - y0     # bpy image rows run bottom-up
        sub = lum[r0:r1, x0:x1] - loc[r0:r1, x0:x1]
        mask[r0:r1, x0:x1] = sub > delta
    for _ in range(grow):
        g = mask.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                g |= np.roll(np.roll(mask, dy, 0), dx, 1)
        mask = g
    # growing must not leave the rectangles (a roll across the atlas edge would)
    keep = np.zeros(lum.shape, dtype=bool)
    for (x0, x1, y0, y1) in rects:
        keep[h - y1:h - y0, x0:x1] = True
    return mask & keep


def _scrub_markings(spec, img):
    """Paint the three markings out of the base colour (and flatten the normal
    and metallic-roughness maps under the same mask). Returns the texel count."""
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, img.channels)
    rgb = px[..., :3]
    lum = rgb.mean(axis=2)
    raw = _marking_mask(lum, spec.marking_rects, spec.marking_delta, 0, h)
    n_raw = int(raw.sum())
    mask = _marking_mask(lum, spec.marking_rects, spec.marking_delta, spec.marking_grow, h)
    n = int(mask.sum())
    per = []
    for (x0, x1, y0, y1) in spec.marking_rects:
        per.append(int(mask[h - y1:h - y0, x0:x1].sum()))
    rgb[:] = _fill_masked(rgb, mask)
    img.pixels.foreach_set(px.ravel())
    img.update()
    for other in bpy.data.images:
        if other.name == img.name or tuple(other.size) == (0, 0):
            continue
        ow, oh = other.size
        opx = np.empty(ow * oh * other.channels, dtype=np.float32)
        other.pixels.foreach_get(opx)
        opx = opx.reshape(oh, ow, other.channels)
        ys = (np.arange(oh) * h // oh)
        xs = (np.arange(ow) * w // ow)
        om = mask[ys][:, xs]
        if other.name.startswith("normal"):
            opx[..., 0][om] = 0.5
            opx[..., 1][om] = 0.5
            opx[..., 2][om] = 1.0
        else:
            opx[..., :3] = _fill_masked(opx[..., :3], om)
        other.pixels.foreach_set(opx.ravel())
        other.update()
    # Residual: the brightest texel of each rectangle above that rectangle's own median, before and after.
    # (Re-running the ink detector would be circular -- it measures against the local mean the fill just
    # flattened -- so the gate is the PEAK, which paint noise cannot reach but a letter does.)
    px2 = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px2)
    lum2 = px2.reshape(h, w, img.channels)[..., :3].mean(axis=2)

    def peaks(l):
        out = []
        for (x0, x1, y0, y1) in spec.marking_rects:
            sub = l[h - y1:h - y0, x0:x1]
            out.append(float(sub.max() - np.median(sub)))
        return out

    before, after = peaks(lum), peaks(lum2)
    print(f"[{spec.unit_id}] scrub markings: {n_raw} ink texels detected, {n} painted over after a {spec.marking_grow}-texel "
          f"grow ({100.0 * n / (w * h):.4f}% of the atlas; per rectangle {per}); peak above rectangle median, "
          f"before {[round(v, 3) for v in before]} -> after {[round(v, 3) for v in after]}")
    return before, after


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------

def _coords(ob):
    return np.array([[v.co.x, v.co.y, v.co.z] for v in ob.data.vertices], dtype=np.float64)


def _collapse_whip(spec, ob):
    x0, x1, y0, y1, zf = spec.whip_box
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    box = [v for v in bm.verts if x0 <= v.co.x <= x1 and y0 <= v.co.y <= y1 and v.co.z > zf + 0.005]
    if len(box) < 4:
        raise SystemExit(f"[{spec.unit_id}] only {len(box)} verts in the whip box -- re-measure it with --probe")
    top = max(v.co.z for v in box)
    before = len(bm.faces)
    bmesh.ops.pointmerge(bm, verts=box, merge_co=((x0 + x1) / 2.0, (y0 + y1) / 2.0, zf))
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{spec.unit_id}] whip collapsed: {len(box)} verts (up to z {top:.3f}) merged onto the roof, "
          f"{before} -> {len(ob.data.polygons)} faces")


def _dark_texel_uv(img):
    """UV of the first 16 x 16 block (scan order) of the base colour that is black to within 0.02: the empty gaps
    between the jigsaw islands. Faces pinned to it draw as an unlit well, which is what a cap over a hole into
    the hull should look like."""
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    lum = px.reshape(h, w, img.channels)[..., :3].max(axis=2)
    blk = lum.reshape(h // 16, 16, w // 16, 16).max(axis=(1, 3))
    hits = np.argwhere(blk < 0.02)
    if len(hits) == 0:
        raise SystemExit("no black 16x16 block in the base colour for the cap texel")
    by, bx = hits[0]
    return Vector(((bx * 16 + 8) / w, (by * 16 + 8) / h))


def _paint_texel_uv(img, x, y_top):
    """UV of texel (x, y_top) (origin top-left) of the base colour -- a texel read off a flat island of hull paint."""
    w, h = img.size
    return Vector(((x + 0.5) / w, (h - 1 - y_top + 0.5) / h))


def _weld(spec, ob):
    """Weld the glTF importer's UV-seam duplicates (same position, separate vertex) back into one vertex each.
    UVs and split normals live on the loops and survive; what changes is that a cut through the model now opens
    one clean loop instead of leaving every UV island edge already 'open', which `holes_fill` could not close."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(ob.data)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    ob.data.update()
    print(f"[{spec.unit_id}] welded UV-seam duplicates: {before} -> {len(ob.data.vertices)} verts, "
          f"{nonman} non-manifold edges left")


def _uv_pin(bm, faces, uv):
    layer = bm.loops.layers.uv.active
    for f in faces:
        for lp in f.loops:
            lp[layer].uv = uv


def _split(spec, ob, take, name_taken, name_rest, patch_uv):
    """Two copies of `ob`: `name_taken` keeps the faces `take(face_centre)` accepts, `name_rest` the others.
    Only the edges the cut opened are filled (the remesh's UV seams already split its vertices, so a blanket
    fill would try every seam), and the cap faces are UV-pinned to the flat gunmetal patch."""
    parts = {}
    for name, keep_taken in ((name_taken, True), (name_rest, False)):
        copy = ob.copy()
        copy.data = ob.data.copy()
        copy.name = copy.data.name = name
        bpy.context.collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        bm.faces.ensure_lookup_table()
        for e in bm.edges:
            e.tag = e.is_boundary
        if callable(take):
            doomed = [f for f in bm.faces if take(f.calc_center_median()) != keep_taken]
        else:
            doomed = [f for f in bm.faces if (f.index in take) != keep_taken]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        opened = [e for e in bm.edges if e.is_boundary and not e.tag]
        filled = 0
        if opened:
            # a set of verts iterates in id order, which differs run to run: sort by position so the weld and the fill do not
            ring = sorted({v for e in opened for v in e.verts}, key=lambda v: (v.co.x, v.co.y, v.co.z, v.index))
            for v in ring:
                v.tag = True
            bmesh.ops.remove_doubles(bm, verts=ring, dist=1e-5)
            opened = [e for e in bm.edges if e.is_boundary and e.verts[0].tag and e.verts[1].tag]
            res = bmesh.ops.holes_fill(bm, edges=opened, sides=0)
            new_faces = res.get("faces", [])
            _uv_pin(bm, new_faces, patch_uv)
            filled = len(new_faces)
        bm.to_mesh(copy.data)
        bm.free()
        copy.data.update()
        print(f"[{spec.unit_id}] {name}: {len(copy.data.polygons)} faces ({len(opened)} cut edges, {filled} cap faces)")
        parts[name] = copy
    bpy.data.objects.remove(ob, do_unlink=True)
    return parts[name_taken], parts[name_rest]


def _turret_faces(spec, ob):
    """Indices of the turret's faces: a flood over shared edges from a seed on the turret roof that STOPS at
    the deck (and a bounding box, which the superstructure roof's slight slope would otherwise leak through) -- a near-horizontal face (|n.z| > `turret_flat_nz`) below `turret_flat_z`, or any face below
    `turret_z_floor`. The turret's lower rim is then the crease where its walls meet the deck and the
    superstructure roof (a plain footprint-and-height cut took deck corners with it and left a gap)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    seed_p = Vector(spec.turret_seed)
    seed = min(bm.faces, key=lambda f: (f.calc_center_median() - seed_p).length)
    if (seed.calc_center_median() - seed_p).length > 0.08:
        raise SystemExit(f"[{spec.unit_id}] no face within 0.08 of the turret seed {spec.turret_seed}")

    def stop(f):
        c = f.calc_center_median()
        if not (spec.turret_box[0] <= c.x <= spec.turret_box[1] and abs(c.y) <= spec.turret_box[2]):
            return True
        return c.z < spec.turret_z_floor or (abs(f.normal.z) > spec.turret_flat_nz and c.z < spec.turret_flat_z)

    seen = {seed.index}
    stack = [seed]
    while stack:
        f = stack.pop()
        for e in f.edges:
            for g in e.link_faces:
                if g.index not in seen and not stop(g):
                    seen.add(g.index)
                    stack.append(g)
    bm.free()
    xs = [ob.data.polygons[i].center for i in seen]
    print(f"[{spec.unit_id}] turret flood: {len(seen)} faces, x[{min(c.x for c in xs):+.3f},{max(c.x for c in xs):+.3f}] "
          f"|y| <= {max(abs(c.y) for c in xs):.3f} z[{min(c.z for c in xs):+.3f},{max(c.z for c in xs):+.3f}]")
    return seen


def _tube_axis(spec, ob):
    pts = _coords(ob)
    t = pts[(pts[:, 0] > spec.tube_x_min) & (pts[:, 2] > spec.tube_z_min)]
    if len(t) < 50:
        raise SystemExit(f"[{spec.unit_id}] only {len(t)} tube verts -- re-measure tube_x_min / tube_z_min")
    c = t.mean(axis=0)
    _, _, vt = np.linalg.svd(t - c, full_matrices=False)
    d = vt[0]
    if d[0] < 0:
        d = -d
    elev = math.degrees(math.asin(d[2]))
    print(f"[{spec.unit_id}] bore axis from {len(t)} tube verts: direction ({d[0]:.4f},{d[1]:.4f},{d[2]:.4f}), "
          f"elevation {elev:.2f} deg, yaw {math.degrees(math.atan2(d[1], d[0])):.2f} deg")
    return Vector(c), Vector(d), elev


def _add_dome(ob, centre, axis, r, depth, uv, seg=48, rings=24):
    """A flattened ellipsoid (radius `r` across `axis`, `depth` along it) at `centre`: the trunnion boss."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    frame = axis.to_track_quat("X", "Z").to_matrix().to_4x4()      # local X -> the bore axis
    m = Matrix.Translation(centre) @ frame @ Matrix.Diagonal((depth / r, 1.0, 1.0, 1.0))
    ret = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r, matrix=m)
    faces = {f for v in ret["verts"] for f in v.link_faces}
    for f in faces:
        f.smooth = True
    _uv_pin(bm, faces, uv)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(faces)


def _box_faces(bm, centre, size, rot=None):
    """A closed box as bmesh faces; `size` = (x, y, z) full extents; `rot` a 3x3 about its own centre."""
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = ret["verts"]
    m = Matrix.Translation(centre)
    if rot is not None:
        m = m @ rot.to_4x4()
    m = m @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    for v in verts:
        v.co = m @ v.co
    return {f for v in verts for f in v.link_faces}


def _build_spades(ob, x_rear, patch_uv, spec_id):
    """Two lowered rear spades, joined into `ob` (the hull) and UV-pinned to the gunmetal patch.
    Frame: metres, +X forward, rear plate at `x_rear`, ground z = 0.

    Each spade is a plate hinged below the rear plate and dug in at the ground behind the hull
    (inclined `ang` from the horizontal), with three stiffening ribs along its top face, a hinge barrel
    across its head and a bevelled cutting edge at its toe."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    hinge_z, ang = SPADE_HINGE_Z, math.radians(38.0)   # hinge height puts the toe's lowest edge on z = 0
    plate_len, plate_w, plate_t = 1.05, 0.86, 0.09
    # incline: along the plate the direction is (-cos a, 0, -sin a): back and down
    along = Vector((-math.cos(ang), 0.0, -math.sin(ang)))
    up = Vector((-math.sin(ang), 0.0, math.cos(ang)))   # normal to the top face, tilted back
    rot = Matrix(((along.x, 0, up.x), (0, 1, 0), (along.z, 0, up.z)))  # columns: local x -> along, z -> up
    all_faces = set()
    for sy in (-1.0, 1.0):
        yc = sy * 0.56
        head = Vector((x_rear - 0.04, yc, hinge_z))
        centre = head + along * (plate_len / 2.0)
        all_faces |= _box_faces(bm, centre, (plate_len, plate_w, plate_t), rot)
        for ry in (-0.28, 0.0, 0.28):
            rc = centre + up * (plate_t / 2.0 + 0.04) + Vector((0, ry, 0))
            all_faces |= _box_faces(bm, rc, (plate_len * 0.92, 0.07, 0.08), rot)
        # hinge barrel across the head (a cylinder along y)
        ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.085, radius2=0.085,
                                    depth=plate_w + 0.10,
                                    matrix=Matrix.Translation(head) @ Matrix.Rotation(math.radians(90), 4, "X"))
        all_faces |= {f for v in ret["verts"] for f in v.link_faces}
        # bevelled cutting edge at the toe
        toe = head + along * (plate_len + 0.02)
        all_faces |= _box_faces(bm, toe, (0.22, plate_w + 0.02, 0.13),
                                Matrix(((along.x, 0, up.x), (0, 1, 0), (along.z, 0, up.z))))
        # two hinge arms from the rear plate to the hinge barrel
        for ay in (-0.36, 0.36):
            all_faces |= _box_faces(bm, head + Vector((0.11, ay, 0.07)), (0.24, 0.08, 0.14))
    _uv_pin(bm, all_faces, patch_uv)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    n = len(all_faces)
    print(f"[{spec_id}] spades: 2 x (plate, 3 ribs, hinge barrel, cutting edge, 2 arms), {n} faces, "
          f"hinge z {hinge_z:.2f} m, {math.degrees(ang):.0f} deg dig-in, plate {plate_len} x {plate_w} m")


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

def export(probe=False, out_path=None):
    spec = SPEC
    src, task_id = _remesh_source(spec.unit_id)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1 or len(meshes[0].data.materials) != 1:
        raise SystemExit(f"[{spec.unit_id}] expected one textured mesh in {src}, found "
                         f"{[(o.name, len(o.data.materials)) for o in meshes]}")
    ob = meshes[0]
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    _bake([ob], ob.matrix_world.copy())
    ob.matrix_world = Matrix.Identity(4)
    print(f"[{spec.unit_id}] source {os.path.relpath(src, REPO)} (remesh task {task_id}): {len(ob.data.polygons)} faces")
    base = _rename_textures(spec, ob)
    _bake([ob], Matrix.Rotation(math.radians(spec.rot_z_deg), 4, "Z"))
    mn, mx = _bounds([ob])
    _bake([ob], Matrix.Translation(Vector((0.0, 0.0, -mn.z))))
    mn, mx = _bounds([ob])
    print(f"[{spec.unit_id}] source frame, bow +X, ground 0: x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] "
          f"z[{mn.z:+.3f},{mx.z:+.3f}]")
    if probe:
        _tube_axis(spec, ob)
        print(f"[{spec.unit_id}] --probe: nothing written")
        return None

    before, after = _scrub_markings(spec, base)
    for i, (pre, post) in enumerate(zip(before, after)):
        if post > spec.marking_peak_max or (pre > spec.marking_peak_max and post > 0.5 * pre):
            raise SystemExit(f"[{spec.unit_id}] marking rectangle {i} not scrubbed: peak {pre:.3f} -> {post:.3f} "
                             f"(must end under {spec.marking_peak_max}, and under half the original if that was above it)")
    patch = bake_fix.paint_metal_patch(ob, base, spec.unit_id)
    patch_uv = Vector(patch["uv"])
    dark_uv = _dark_texel_uv(base)
    paint_uv = _paint_texel_uv(base, *spec.paint_texel)
    print(f"[{spec.unit_id}] pinned texels: gunmetal patch uv ({patch_uv.x:.5f}, {patch_uv.y:.5f}), black well uv "
          f"({dark_uv.x:.5f}, {dark_uv.y:.5f}), hull paint uv ({paint_uv.x:.5f}, {paint_uv.y:.5f})")

    _weld(spec, ob)
    _collapse_whip(spec, ob)

    # ---- barrel
    c, d, elev0 = _tube_axis(spec, ob)
    trunnion = c + d * spec.barrel_trunnion_a
    side = Vector((0.0, 1.0, 0.0))

    def in_barrel(p):
        rel = p - c
        a = rel.dot(d)
        radial = (rel - d * a).length
        return a > spec.barrel_trunnion_a and radial < spec.barrel_r

    barrel, rest = _split(spec, ob, in_barrel, "turret_metal", "hull_all", dark_uv)

    # lengthen the plain tube beyond the sleeve, along the bore
    pts = barrel.data.vertices
    stretched = 0
    for v in pts:
        a = (v.co - c).dot(d)
        if a > spec.barrel_stretch_from:
            v.co = v.co + d * ((spec.barrel_stretch - 1.0) * (a - spec.barrel_stretch_from))
            stretched += 1
    boss_faces = _add_dome(barrel, trunnion + d * 0.02, d, spec.boss_r, spec.boss_depth, paint_uv)
    # raise about the trunnion, a pitch about the lateral axis (negative about +Y is nose-up in this frame)
    dtheta = math.radians(spec.barrel_elev_deg - elev0)
    rot = (Matrix.Translation(trunnion) @ Matrix.Rotation(-dtheta, 4, "Y") @ Matrix.Translation(-trunnion))
    _bake([barrel], rot)
    print(f"[{spec.unit_id}] barrel: {len(barrel.data.polygons)} faces ({boss_faces} boss), source bore {elev0:.2f} deg raised by "
          f"{math.degrees(dtheta):.2f} deg about the trunnion, tube stretched x{spec.barrel_stretch} ({stretched} verts), "
          f"trunnion at ({trunnion.x:+.3f}, {trunnion.y:+.3f}, {trunnion.z:+.3f}) source units")

    # ---- turret
    turret_idx = _turret_faces(spec, rest)
    turret, hull_all = _split(spec, rest, turret_idx, "turret_hull", "hull_all", dark_uv)

    # ---- tracks
    def is_rubber(p):
        return abs(p.y) > spec.track_ay and p.z < spec.track_z_top

    rubber, hull = _split(spec, hull_all, is_rubber, "hull_rubber", "hull_hull", dark_uv)
    hull_objs = [hull, rubber]
    mn, mx = _bounds(hull_objs)
    hull_len_src = mx.x - mn.x
    hull_w_src = mx.y - mn.y
    mpu = metres_per_unit(hull_len_src, spec.real_metres)
    allobjs = [hull, rubber, turret, barrel]
    pivot_src = Vector((spec.turret_pivot_xy[0], spec.turret_pivot_xy[1], spec.turret_z_floor))
    _bake(allobjs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(hull_objs)
    shift = Vector((-(mn.x + mx.x) / 2.0, -(mn.y + mx.y) / 2.0, -mn.z))
    _bake(allobjs, Matrix.Translation(shift))
    pivot = (pivot_src * mpu) + shift
    trunnion_f = trunnion * mpu + shift

    def bore_elevation():
        """Elevation of the raised bore in the FINAL frame: the plain tube is every barrel vertex forward of
        `barrel_probe_x` (unique positions -- the exported file's UV-split duplicates would weight the seams);
        the far quarter's centroid, by axial position, against the near quarter's."""
        pts = {(round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)) for v in barrel.data.vertices if v.co.x > spec.barrel_probe_x}
        arr = np.array(sorted(pts, key=lambda k: k[0]))
        q = max(len(arr) // 4, 3)
        dv = arr[-q:].mean(axis=0) - arr[:q].mean(axis=0)
        return math.degrees(math.atan2(dv[2], math.hypot(dv[0], dv[1]))), len(arr)

    # The source axis is fitted to a few dozen vertices and the tube is not perfectly straight, so the raise lands a
    # fraction of a degree off: rotate the rest of the way, measured on the finished geometry, until it is on target.
    for _ in range(4):
        elev_final, n_probe = bore_elevation()
        if abs(elev_final - spec.barrel_elev_deg) < 0.01:
            break
        fix = (Matrix.Translation(trunnion_f) @ Matrix.Rotation(-math.radians(spec.barrel_elev_deg - elev_final), 4, "Y")
               @ Matrix.Translation(-trunnion_f))
        _bake([barrel], fix)
    elev_final, n_probe = bore_elevation()
    print(f"[{spec.unit_id}] bore elevation {elev_final:.2f} deg (target {spec.barrel_elev_deg}), measured over "
          f"{n_probe} unique tube vertices forward of x {spec.barrel_probe_x} m")
    mn, mx = _bounds(hull_objs)
    print(f"[{spec.unit_id}] hull {mx.x - mn.x:.3f} m long x {mx.y - mn.y:.3f} m wide x {mx.z - mn.z:.3f} m "
          f"(declared {spec.real_metres} m, mpu {mpu:.5f}; hull {hull_len_src:.3f} x {hull_w_src:.3f} source units)")

    hz = SPADE_HINGE_Z
    plate = [v.co.x for v in hull.data.vertices if abs(v.co.y) < 0.9 and abs(v.co.z - hz) < 0.15]
    x_rear = min(plate)
    print(f"[{spec.unit_id}] rear plate between the tracks at the spade hinge height: x {x_rear:+.3f} m "
          f"({len(plate)} verts; hull rear {mn.x:+.3f} m)")
    _build_spades(hull, x_rear, patch_uv, spec.unit_id)

    for ob_, role, part in ((hull, "hull", "hull"), (rubber, "rubber", "hull"),
                            (turret, "hull", "turret"), (barrel, "metal", "turret")):
        for k in list(ob_.keys()):
            if k != "_RNA_UI":
                del ob_[k]
        ob_["rl_role"] = role
        ob_["rl_part"] = part

    pivot_obj = bpy.data.objects.new(TURRET_PIVOT_NODE, None)
    pivot_obj.empty_display_size = 0.3
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot
    bpy.context.view_layer.update()
    inv = Matrix.Translation(-pivot)
    for t in (turret, barrel):
        t.parent = pivot_obj
        t.matrix_parent_inverse = inv
    print(f"[{spec.unit_id}] {TURRET_PIVOT_NODE} at ({pivot.x:+.3f}, {pivot.y:+.3f}, {pivot.z:+.3f}) m")

    every = [hull, rubber, turret, barrel]
    tris = sum(len(p.vertices) - 2 for o in every for p in o.data.polygons)
    if tris > spec.tri_cap:
        raise SystemExit(f"[{spec.unit_id}] {tris} triangles over the cap {spec.tri_cap}")
    mn, mx = _bounds(every)
    print(f"[{spec.unit_id}] overall x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")

    kept, _dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{spec.unit_id}] image {name}: {before} -> {after}")
    out = out_path or OUT_SPG_LONG_RANGE
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out, spec.credit))
    if out_path is None:
        os.makedirs(BLEND_DIR, exist_ok=True)
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
        print(f"[{spec.unit_id}] saved {BLEND_PATH} ({os.path.getsize(BLEND_PATH)} bytes)")
    print(f"[{spec.unit_id}] wrote {out} ({os.path.getsize(out)} bytes, {tris} tris, "
          f"bounds {tuple(round(c, 3) for c in (mx - mn))}, nodes {sorted(o.name for o in every)} + {TURRET_PIVOT_NODE})")
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    export(probe="--probe" in argv, out_path=argv[argv.index("--out") + 1] if "--out" in argv else None)
