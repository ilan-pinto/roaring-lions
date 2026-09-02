"""Export the Kedem campaign world -- `art/meshes/campaign/sahar_basin.glb`.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/campaign/export_meshy_world.py -- \
        [--ratio 0.02] [--texture-px 4096] [--out PATH] [--dry-run]

SOURCE (AI-generated, Meshy, disclosed per CONTRIBUTING.md). TWO exports of
the same generation, and NEITHER IS USABLE ALONE:

    art/blend/map/
      Meshy_AI_multi_biome_hex_diora_0902115508_image-to-3d-texture.blend
        1 object 'mesh_node', 977,301 verts, 1 UV layer, 1 material,
        images base_color 4096^2 (sRGB), metallic_roughness 2048^2,
        normal 4096^2.  ONE WELDED MESH -- it knows how the world LOOKS and
        nothing about where the regions are.

      Meshy_AI_multi_biome_hex_diora_0902123927_part-segmentation.blend
        16 objects 'model_part0'..'model_part15', 994,614 verts total,
        ZERO images, ZERO materials, ZERO UV layers.  It knows where the
        regions ARE and nothing about how they look.

`art/blend/` is gitignored and does not exist inside a worktree checkout, so
SRC is an absolute path into the main repo's untracked working directory --
the same pattern `export_meshy_decor.py`, `export_meshy_camp.py` and
`export_meshy_ditch.py` use.

## THE TWO EXPORTS SIT IN DIFFERENT COORDINATE FRAMES

This is the fact that makes every naive correspondence check look like the
meshes do not match, and it must be applied before anything else:

    SEG bbox size (0.5943, 0.5378, 0.1200)   origin at Z = 0
    TEX bbox size (1.9029, 1.7222, 0.3842)   centred on Z = 0
    per-axis scale tex/seg = 3.2020, 3.2021, 3.2020

Identical to four decimal places on all three axes: a pure uniform scale plus
an origin shift, no distortion and no rotation. Normalise the segmentation
into the textured mesh's frame by bounding box and the two surfaces coincide:

    nearest-triangle distance   max 0.00186   mean 0.00001
                                (on a model 1.903 units wide)

WITHOUT the alignment the same probe reads mean 0.378 -- twenty percent of
the model's width -- which reads as "these two meshes do not correspond" and
sends a reader to UV transfer, to re-unwrapping, or to asking for a
regenerated asset. All three would be wrong.

## THE APPROACH: SPLIT THE TEXTURED MESH, SEGMENTATION AS A SPATIAL KEY ONLY

For each face of the textured mesh, find the nearest triangle in the aligned
segmentation soup and inherit its part id; then separate the textured mesh by
that id. The UVs ride along per corner, untouched, so the texture maps BY
CONSTRUCTION rather than by approximation, and no value is ever interpolated.

The alternative -- transferring UVs from the welded mesh onto the sixteen
supplied parts -- interpolates every UV and concentrates its error exactly at
the cut boundaries, which is where regions meet and where a seam would show.

## DECIMATE FIRST, THEN SPLIT. THE ORDER IS THE SEAM, AND IT WAS MEASURED

A collapse decimator moves vertices. Split first and each region's decimator
moves ITS OWN side of every shared border independently, so the two sides
come apart. Decimate the welded mesh first and the split merely duplicates
vertices that already exist, so both sides of every cut are the same numbers.

Measured on this asset at ratio 0.02, `crack` = the distance from each cut
vertex to the nearest point on any OTHER part's surface (the source is closed
-- 3 border edges in 2.9M -- so every open border after splitting IS a cut):

    order                       cut verts   p50       p90       max      > 1e-4
    decimate -> split  (ships)      2,138  0.000000  0.000000  0.0191        3
    split -> decimate  (rejected)   6,774  0.000558  0.002353  0.1426    5,045

0.1426 is 7.5% of the model's width -- a hole visible from any camera -- and
74% of that order's cut vertices are displaced at all. The shipped order
leaves THREE displaced vertices in the whole model, which are the source's
own three border edges, not the cut.

## DECIMATION RATIO: 0.02. SWEPT AND MEASURED, NOT PICKED

See `.superpowers/queue/kedem-map-asset-report.md` for the table.

## REGIONS: FIVE LARGE MASSES, THREE OF THEM CAMPAIGN GROUND

The sixteen supplied parts are five large masses and eleven small props. Each
mass was rendered on its own, with its texture, and named from the picture:

    part14  the western forest belt and the river that runs its length
    part11  the north-central basin: glacial lake, the grid town, the wadi head
    part13  the southern basin: the walled compound, the huts, the south lake
    part12  the snow range along the north edge
    part15  the eastern desert plateau, the south-east savanna, AND the whole
            underside and rim of the slab

`world.json`'s three regions map to the first three. The last two are
scenery: part12 is the mountain wall Sur's own blurb names, and part15 MUST
never be tinted as a region because it carries the diorama's base -- tinting
it would light up the underside of the world.

The eleven props (trees, boulders, rock crags, ground patches, and the south
rim strip) are MERGED into whichever mass they share the most boundary with,
rather than shipped as nodes. A prop left as its own node inside a region is
a hole in that region's tint: veil `naharin` and its trees stay bright.

## TOWNS: MARKER NODES IN THE GLB, NOT COORDINATES IN world.json

`world.json`'s `at: [x, y]` are pixels in `worldmap.ts`'s 1140x790 viewBox,
measured against `assets/campaign/world_map.png`. They do not survive the
move to 3D and there is nothing to convert them to -- the PNG's geography is
not this diorama's.

A town is therefore an EMPTY node `<town_id>_town` carrying
`extras.rl_town`, placed by raycasting `TOWN_SITES` below straight down onto
the surface. The exporter then asserts the hit belongs to that town's own
declared region and raises if it does not, so a town cannot ship sitting in
a lake or on the wrong side of a border -- which a pair of numbers in a JSON
file could do silently, and which is the whole reason the markers are baked
here rather than authored as text.

`world.json` does NOT change. Its `at` stays, because `worldmap.ts` and
`worldmap.test.ts` still draw the flat PNG board and that path still ships
(see the report's "what a Pixi player sees"). The GLB is self-describing:
`extras.rl_region` names the region a mesh is, `extras.rl_town` names the
town a marker is, and those ids join with `world.json`'s own.

## TEXTURED, NOT PALETTE -- and the class this asset was given

A campaign map is neither a building nor decor, so neither existing named
exemption covers it. It gets its own class, `campaign`, with its own named
list on both sides:

    TEXTURED_CAMPAIGN_MAPS   packages/render/src/three/campaign/textured-world.ts
    TEXTURED_CAMPAIGN_EXEMPT tools/validate_mesh_assets.py

pinned against each other by `textured-world.test.ts`, which parses the
Python set -- the same two locks the ditch and the three buildings carry. A
campaign GLB outside the list that ships a texture fails
`pnpm validate:meshes` rather than being silently upgraded.

Why it must be textured rather than palette-painted is not a matter of taste
here: the palette path indexes a ramp BY NORMAL, and this asset's whole
subject is biome -- forest, desert, snow, water, cultivation -- which is
colour at a constant normal. A ramp indexed by normal cannot express any of
it; the map would come out one flat colour per slope angle.

## THE TRAPS, both already paid for elsewhere in this tree

  * `colorSpace` must be `NoColorSpace` at the consumer. `GLTFLoader` stamps
    `SRGBColorSpace` on a baseColorTexture and this renderer's output is
    pass-through, so an sRGB internal format decodes on every sample with
    nothing to re-encode it. Measured on `beit_sahwan_outskirts` that drops a
    lit wall from rgb 67 to 51 -- and it still looks like a building.
  * `metallic_roughness` and `normal` are DROPPED. Not for size: there are no
    lights in this scene to consume them, and shipping them would invite a
    later reader to conclude this backend is PBR when it is not.

## TEXTURE: 4096, AND THE RE-ENCODE IS NOT OPTIONAL

`base_color` ships at the source's own 4096, which the buildings' own
`textured.py` records as "not a real option" at 11-12 MB. That reading is
wrong, and the reason is worth knowing because it looks like a resolution
cost and is not.

`textured.prepare_textured_images` only calls `Image.scale` when the source
is LARGER than the target. Ask for 4096 from a 4096 source and the datablock
is never touched, so the glTF exporter copies the packed source JPEG through
verbatim -- at whatever quality and weight Meshy wrote it. Measured on this
asset, total GLB bytes with geometry fixed at 39,107 triangles:

    1024 q85   re-encoded    1,509,004
    2048 q85   re-encoded    1,983,628
    2560 q85   re-encoded    2,268,548
    3072 q85   re-encoded    2,652,236
    3584 q85   re-encoded    3,070,716
    4096 q85   re-encoded    3,964,320   <- SHIPPED
    4096       PASSTHROUGH  15,091,744   <- the "4096 is unaffordable" number

The jump from 3584 to 4096 is 4.9x for 1.3x the pixels, which is the tell: it
is not a resolution curve, it is one entry that stopped being a JPEG encode.
Forcing a no-op `scale(4096, 4096)` puts 4096 back on the curve.

Against the passthrough the re-encode reads meanAbsChannelDelta 1.09/255 and
is indistinguishable in a 4x crop of the town roofs; 3584 reads 1.57 and is
visibly softer, 2048 reads 2.62 and blurs the huts into each other at 1:1 on
a 1600 px presentation. So the choice is 4096 re-encoded, and `_prepare_images`
below exists purely to force that scale call -- `textured.py` is left alone
because the three buildings that share it would change bytes.
"""
import argparse
import json
import os
import sys
import time

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if REPO.endswith(os.path.join(".claude", "worktrees", "three-renderer")):
    MAIN_REPO = REPO[: -len(os.path.join(".claude", "worktrees", "three-renderer")) - 1]
else:
    MAIN_REPO = REPO
sys.path.insert(0, os.path.join(REPO, "tools"))
sys.path.insert(0, os.path.join(REPO, "tools", "buildings"))
import textured  # noqa: E402  (tools/buildings/textured.py)

SRC_DIR = os.path.join(MAIN_REPO, "art", "blend", "map")
TEX_BLEND = os.path.join(
    SRC_DIR, "Meshy_AI_multi_biome_hex_diora_0902115508_image-to-3d-texture.blend")
SEG_BLEND = os.path.join(
    SRC_DIR, "Meshy_AI_multi_biome_hex_diora_0902123927_part-segmentation.blend")

OUT_DEFAULT = os.path.join(REPO, "art", "meshes", "campaign", "sahar_basin.glb")

CREDIT = (
    "Sahar Basin campaign world -- AI-generated (Meshy), disclosed per "
    "CONTRIBUTING.md; segmented against Meshy's own part-segmentation export, "
    "decimated and re-scaled for Roaring Lions"
)

#: Swept and measured; see the module docstring and the report.
DECIMATE_RATIO = 0.02

#: Majority-vote passes over the face->part assignment before splitting.
#: Two, and the number is a measured trade rather than a taste (see
#: `smooth_owners`).
SMOOTH_PASSES = 2

#: `base_color` ships at this size. The source's own 4096 -- see the module
#: docstring's "TEXTURE: 4096, AND THE RE-ENCODE IS NOT OPTIONAL" for why that
#: costs 3.96 MB here and 15.09 MB if the scale call is skipped.
TEXTURE_PX = 4096

#: The world's id, and the GLB's basename. Joins with `data/campaign/world.json`.
WORLD_ID = "sahar_basin"

#: Longest horizontal extent of the exported model, in glTF units. A campaign
#: map has no tiles, so `MESH_UNITS_PER_TILE` means nothing here; 1.0 makes the
#: consumer's framing arithmetic readable and leaves the scale its own call.
TARGET_SPAN = 1.0

#: part id -> (node name, extras). The five large masses, named from renders
#: of each one on its own -- see the module docstring.
MASSES = {
    14: ("naharin_region", {"rl_region": "naharin"}),
    11: ("sur_region", {"rl_region": "sur"}),
    13: ("marj_region", {"rl_region": "marj"}),
    12: ("wall_scenery", {}),
    15: ("outland_scenery", {}),
}

#: town id -> (region id, u, v) with u,v normalised over the SOURCE model's XY
#: bounding box (0,0 = min X/min Y = south-west corner; 1,1 = north-east).
#: Read off the top-down render of the source; the exporter raycasts each one
#: onto the surface and REFUSES to write a marker that lands outside its own
#: region's mesh, so these cannot drift onto the wrong ground unnoticed.
TOWN_SITES = {
    # marj -- the southern basin, where every drawn settlement is
    "beit_sahwan": ("marj", 0.347, 0.281),   # the walled compound
    "khan_rafid": ("marj", 0.388, 0.138),    # the mud-brick huts, south edge
    "deir_amun": ("marj", 0.545, 0.205),     # the ground between wadi and lake
    # sur -- the north-central basin under the mountain wall
    "tel_marum": ("sur", 0.413, 0.481),      # the grid town
    "umm_zeitoun": ("sur", 0.520, 0.600),    # the wadi head below the ridge
    # naharin -- the western forest corridor
    "wadi_halam": ("naharin", 0.196, 0.437),  # the river bank
}


# --------------------------------------------------------------------------
# source loading and alignment
# --------------------------------------------------------------------------
def _bbox(pts):
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def harvest_segmentation():
    """The sixteen supplied parts as one triangle soup plus a per-triangle
    owner, in the SEGMENTATION file's own frame."""
    if not os.path.exists(SEG_BLEND):
        raise SystemExit(f"missing segmentation source: {SEG_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=SEG_BLEND)
    objs = sorted((o for o in bpy.data.objects if o.type == "MESH"),
                  key=lambda o: int(o.name.replace("model_part", "")))
    verts, tris, owner = [], [], []
    for pid, o in enumerate(objs):
        me = o.to_mesh()
        me.calc_loop_triangles()
        base = len(verts)
        mw = o.matrix_world
        verts.extend(mw @ v.co for v in me.vertices)
        for t in me.loop_triangles:
            tris.append(tuple(base + i for i in t.vertices))
            owner.append(pid)
        o.to_mesh_clear()
    print(f"[seg] {len(objs)} parts, {len(verts)} verts, {len(tris)} triangles")
    return verts, tris, owner


def align_segmentation(sverts, tris, tmin, tmax):
    """Normalise the segmentation soup into the textured mesh's frame by
    bounding box, and build one BVH over it. Raises if the per-axis scales
    disagree -- that would mean the two exports are NOT the same shape and
    every assignment below would be meaningless."""
    smin, smax = _bbox(sverts)
    ssz, tsz = smax - smin, tmax - tmin
    sc = Vector((tsz.x / ssz.x, tsz.y / ssz.y, tsz.z / ssz.z))
    spread = max(sc) - min(sc)
    print(f"[align] per-axis scale tex/seg = {sc.x:.4f}, {sc.y:.4f}, {sc.z:.4f} "
          f"(spread {spread:.5f})")
    if spread > 1e-3:
        raise SystemExit(
            f"[align] the two exports do not differ by a UNIFORM scale "
            f"({sc.x:.4f}/{sc.y:.4f}/{sc.z:.4f}). A regenerated source has changed "
            f"shape; re-derive the correspondence rather than proceeding -- every "
            f"part assignment below would be nearest-triangle noise.")
    moved = [Vector(((p.x - smin.x) * sc.x + tmin.x,
                     (p.y - smin.y) * sc.y + tmin.y,
                     (p.z - smin.z) * sc.z + tmin.z)) for p in sverts]
    return BVHTree.FromPolygons(moved, tris, all_triangles=True)


# --------------------------------------------------------------------------
# split
# --------------------------------------------------------------------------
def decimate(ob, ratio):
    if ratio >= 1.0:
        return
    m = ob.modifiers.new("dec", "DECIMATE")
    m.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="dec")


def assign_owners(ob, bvh, owner):
    """Every face inherits the part id of the nearest segmentation triangle.

    Also reports how far the nearest triangle was: the two surfaces coincide
    to ~1e-5 of the model's width, so a large maximum means the alignment
    above is wrong and the split is guesswork.
    """
    me = ob.data
    mw = ob.matrix_world
    own = [0] * len(me.polygons)
    dmax = 0.0
    for p in me.polygons:
        _, _, idx, dist = bvh.find_nearest(mw @ p.center)
        if idx is None:
            raise SystemExit("[assign] a face found no nearest segmentation triangle")
        own[p.index] = owner[idx]
        dmax = max(dmax, dist)
    print(f"[assign] {len(own)} faces, worst nearest-triangle distance {dmax:.5f}")
    return own, dmax


def smooth_owners(ob, own, passes):
    """Majority vote over each face's edge-neighbours, `passes` times.

    WHAT THIS FIXES, and it is not the boundary. Decimation leaves two
    different defects and only one of them looks like "ragged":

      * boundary jitter -- the cut wanders by a triangle. Organic, and
        invisible against a border the source itself draws as a wiggle.
      * ISLANDS -- a face whose every edge-neighbour disagrees with it,
        stranded well inside another region. Under a region tint that is a
        speck of the wrong colour on open ground, and it is what a tinted
        render of the unsmoothed split actually shows: a scatter of red,
        green and cyan shards across the middle of `sur`.

    Measured on this asset at ratio 0.02, against the FULL-RESOLUTION
    assignment (the artist's own boundary, and the only reference there is):

        passes   islands   region delta vs full-res
             0       119        1.511%
             1        43        1.659%
             2        29        1.605%
             3        24        1.761%
             5        22        1.769%

    Two facts to take from that. The two goals TRADE: every pass that
    removes a speck also rounds the border, so fidelity gets slightly worse
    while the picture gets better -- and the right call is the picture,
    because a one-triangle speck of the wrong colour reads as a defect and a
    border rounded by one triangle does not. And the trade is NOT MONOTONE:
    2 passes scores better than 1 (1.605 vs 1.659). Picking by "more passes
    is smoother" would have taken 1 or 5 and both are worse.

    The floor of ~22 is faces genuinely enclosed by another region -- a
    folded prop reduced to a single triangle. A local filter cannot reach
    those, and deleting them would put a hole in the surface.
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    adj = [[] for _ in range(len(ob.data.polygons))]
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2:
            adj[fs[0].index].append(fs[1].index)
            adj[fs[1].index].append(fs[0].index)
    bm.free()

    def islands(o):
        return sum(1 for i, ns in enumerate(adj) if ns and all(o[n] != o[i] for n in ns))

    before = islands(own)
    for _ in range(passes):
        nxt = list(own)
        for i, ns in enumerate(adj):
            if not ns:
                continue
            c = {}
            for n in ns:
                c[own[n]] = c.get(own[n], 0) + 1
            best = max(c.values())
            if c.get(own[i], 0) < best:
                # ties broken by lowest part id, so the pass is deterministic
                # and two runs of this exporter cannot disagree
                nxt[i] = min(k for k, v in c.items() if v == best)
        if nxt == own:
            break
        own[:] = nxt
    print(f"[smooth] {passes} pass(es): islands {before} -> {islands(own)}")
    return own


def fold_props(ob, own):
    """Rewrite every small part's owner to the large mass it shares the most
    boundary with, so the model ships exactly the five named nodes.

    A prop left as its own node is a hole in its region's tint -- see the
    module docstring. Returns {prop id: (host id, shared length, total)}.
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    shared = {}
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) != 2:
            continue
        a, b = own[fs[0].index], own[fs[1].index]
        if a == b:
            continue
        ln = (e.verts[0].co - e.verts[1].co).length
        shared.setdefault(a, {}).setdefault(b, 0.0)
        shared.setdefault(b, {}).setdefault(a, 0.0)
        shared[a][b] += ln
        shared[b][a] += ln
    bm.free()

    folded = {}
    for pid in sorted(set(own)):
        if pid in MASSES:
            continue
        nb = {k: v for k, v in shared.get(pid, {}).items() if k in MASSES}
        if not nb:
            raise SystemExit(
                f"[fold] part {pid} touches none of the five masses {sorted(MASSES)} -- "
                f"it is an island, and folding it would move geometry across the map. "
                f"Name it as its own node instead of silently attaching it.")
        host = max(nb, key=nb.get)
        folded[pid] = (host, nb[host], sum(nb.values()))
    for i, o in enumerate(own):
        if o in folded:
            own[i] = folded[o][0]
    for pid, (host, ln, tot) in sorted(folded.items()):
        print(f"[fold] part{pid:<3d} -> {MASSES[host][0]:<16s} "
              f"({100 * ln / tot:.0f}% of its {tot:.3f} of shared border)")
    return folded


def split_by_owner(ob, own):
    """Separate by material -- the one separation mode that carries UVs and
    per-corner data across untouched. Returns {part id: object}.

    `mesh.separate(type='MATERIAL')` REMAPS slot indices on the objects it
    creates, so a part is identified by its material's NAME, never by the
    index. (Reading the index gives every new object 0, which silently
    collapses sixteen parts into one -- observed.)
    """
    me = ob.data
    src_material = me.materials[0]
    keys = sorted(set(own))
    me.materials.clear()
    for pid in keys:
        me.materials.append(bpy.data.materials.new(f"rlpart{pid:02d}"))
    slot = {pid: i for i, pid in enumerate(keys)}
    for p, o in zip(me.polygons, own):
        p.material_index = slot[o]

    ob.name = "rlsplit"
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")

    out = {}
    for o in [x for x in list(bpy.context.scene.objects)
              if x.type == "MESH" and x.name.startswith("rlsplit")]:
        if not len(o.data.polygons):
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        pid = int(o.data.materials[o.data.polygons[0].material_index].name[len("rlpart"):])
        o.data.materials.clear()
        o.data.materials.append(src_material)
        out[pid] = o
    return out


def measure_crack(parts):
    """Distance from every cut vertex to the nearest point on any OTHER
    part's surface. The source is closed, so an open border after splitting
    IS a cut. Decimate-then-split makes this 0 for all but the source's own
    three border edges; it is measured rather than asserted because the
    ORDER is the only thing keeping it 0."""
    trees = {}
    for pid, o in parts.items():
        me = o.data
        me.calc_loop_triangles()
        mw = o.matrix_world
        trees[pid] = BVHTree.FromPolygons(
            [mw @ v.co for v in me.vertices],
            [tuple(t.vertices) for t in me.loop_triangles],
            all_triangles=True)
    ds = []
    for pid, o in parts.items():
        bm = bmesh.new()
        bm.from_mesh(o.data)
        border = {v.index for e in bm.edges if len(e.link_faces) == 1 for v in e.verts}
        bm.free()
        mw = o.matrix_world
        for vi in border:
            p = mw @ o.data.vertices[vi].co
            best = min((trees[q].find_nearest(p)[3] or 0.0)
                       for q in trees if q != pid)
            ds.append(best)
    ds.sort()
    return dict(n=len(ds), p50=ds[len(ds) // 2] if ds else 0.0,
                p90=ds[int(0.9 * len(ds))] if ds else 0.0,
                max=ds[-1] if ds else 0.0,
                over_1e4=sum(1 for d in ds if d > 1e-4))


# --------------------------------------------------------------------------
# placement
# --------------------------------------------------------------------------
def bake_transform(parts, tmin, tmax):
    """Uniform scale to `TARGET_SPAN` across the longer horizontal axis,
    centred on the origin in X/Y, with Z = 0 at the lowest vertex so the
    diorama sits on a floor. Applied to every part with the SAME numbers, so
    the cut vertices stay bit-identical."""
    size = tmax - tmin
    s = TARGET_SPAN / max(size.x, size.y)
    cx = (tmin.x + tmax.x) / 2
    cy = (tmin.y + tmax.y) / 2
    for o in parts.values():
        for v in o.data.vertices:
            v.co = Vector(((v.co.x - cx) * s, (v.co.y - cy) * s, (v.co.z - tmin.z) * s))
        o.data.update()
    print(f"[scale] x{s:.5f} -- span {max(size.x, size.y):.4f} -> {TARGET_SPAN}, "
          f"height {size.z * s:.4f}")
    return s, cx, cy


def place_towns(parts, tmin, tmax, scale, cx, cy):
    """One empty per town, dropped straight down onto the surface from above.

    Raises if the ray lands on a part that is not the town's own region: a
    marker in the wrong region -- or in a lake, which is a different part --
    is exactly the failure a pair of authored numbers would ship silently.
    """
    by_region = {ex["rl_region"]: pid for pid, (_, ex) in MASSES.items() if "rl_region" in ex}
    top = (tmax.z - tmin.z) * scale + 1.0
    out = {}
    for town, (region, u, v) in sorted(TOWN_SITES.items()):
        x = ((tmin.x + u * (tmax.x - tmin.x)) - cx) * scale
        y = ((tmin.y + v * (tmax.y - tmin.y)) - cy) * scale
        best = None
        for pid, o in parts.items():
            hit, nrm, idx, dist = _ray_down(o, Vector((x, y, top)))
            if hit is not None and (best is None or hit.z > best[0].z):
                best = (hit, pid)
        if best is None:
            raise SystemExit(
                f"[town] {town}: the ray at u={u} v={v} hit no geometry at all -- "
                f"that position is off the diorama.")
        hit, pid = best
        want = by_region[region]
        if pid != want:
            raise SystemExit(
                f"[town] {town} is declared in region {region!r} ({MASSES[want][0]}) but "
                f"u={u} v={v} lands on {MASSES[pid][0]}. Move the site rather than "
                f"relaxing this check: a town on the wrong side of a border is the one "
                f"failure a pair of numbers in a JSON file would ship in silence.")
        e = bpy.data.objects.new(f"{town}_town", None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.02
        e.location = hit
        e["rl_town"] = town
        e["rl_region"] = region
        bpy.context.scene.collection.objects.link(e)
        out[town] = (hit, region)
        print(f"[town] {town:<12s} {region:<8s} at ({hit.x:+.4f}, {hit.y:+.4f}, {hit.z:+.4f})")
    return out


def _ray_down(ob, origin):
    ok, loc, nrm, idx = ob.ray_cast(ob.matrix_world.inverted() @ origin,
                                    Vector((0, 0, -1)))
    return (ob.matrix_world @ loc, nrm, idx, 0.0) if ok else (None, None, None, None)


# --------------------------------------------------------------------------
def _prepare_images(px):
    """Drop `metallic_roughness`/`normal`, then ALWAYS resize `base_color`.

    `textured.prepare_textured_images` resizes only when the source is bigger
    than the target, which is right for the buildings and wrong here: this
    source IS 4096, so that guard leaves the datablock untouched and the glTF
    exporter copies the packed source JPEG through verbatim -- 15.09 MB
    instead of 3.96. The scale call is what puts it back on the encode curve.
    Constants come from `textured` so the two cannot drift on WHAT ships.
    """
    for name in textured.DROPPED_MAPS:
        img = bpy.data.images.get(name)
        if img is not None:
            bpy.data.images.remove(img)
    base = bpy.data.images.get(textured.BASE_COLOR)
    if base is None:
        raise SystemExit(
            f"source carries no {textured.BASE_COLOR!r} image -- present: "
            f"{sorted(i.name for i in bpy.data.images)}")
    base.scale(min(base.size[0], px), min(base.size[1], px))
    return tuple(base.size)


def export(ratio, texture_px, out_path, dry_run, smooth_passes=SMOOTH_PASSES):
    t0 = time.time()
    sverts, tris, owner = harvest_segmentation()

    if not os.path.exists(TEX_BLEND):
        raise SystemExit(f"missing textured source: {TEX_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=TEX_BLEND)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"expected one mesh in the textured source, found {len(meshes)}")
    ob = meshes[0]
    if not ob.data.uv_layers:
        raise SystemExit("the textured source carries no UV layer -- nothing to ship")
    tmin, tmax = _bbox([ob.matrix_world @ v.co for v in ob.data.vertices])
    print(f"[tex] {len(ob.data.vertices)} verts, uv {ob.data.uv_layers.active.name}, "
          f"bbox size ({(tmax-tmin).x:.4f}, {(tmax-tmin).y:.4f}, {(tmax-tmin).z:.4f})")

    bvh = align_segmentation(sverts, tris, tmin, tmax)

    decimate(ob, ratio)
    own, _ = assign_owners(ob, bvh, owner)
    fold_props(ob, own)
    smooth_owners(ob, own, smooth_passes)
    missing = sorted(set(MASSES) - set(own))
    if missing:
        raise SystemExit(
            f"[split] parts {missing} own no face at ratio {ratio} -- a named mass "
            f"has been decimated out of existence. Raise the ratio.")
    parts = split_by_owner(ob, own)
    print(f"[split] {len(parts)} parts: " +
          ", ".join(f"{MASSES[p][0]}={len(o.data.vertices)}v"
                    for p, o in sorted(parts.items())))
    crack = measure_crack(parts)
    print(f"[crack] {json.dumps(crack)}")

    scale, cx, cy = bake_transform(parts, tmin, tmax)
    for pid, o in parts.items():
        name, extras = MASSES[pid]
        o.name = o.data.name = name
        for k in list(o.keys()):
            if k != "_RNA_UI":
                del o[k]
        # `rl_textured`, not `rl_role`: this mesh draws its own bake, so it
        # has no palette ramp to name. Same flag the ditch and the three
        # textured buildings carry.
        o["rl_textured"] = True
        o["rl_map_role"] = "region" if "rl_region" in extras else "scenery"
        for k, v in extras.items():
            o[k] = v
    towns = place_towns(parts, tmin, tmax, scale, cx, cy)

    tex_size = _prepare_images(texture_px)

    if dry_run:
        print("[dry-run] not writing")
        return
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**textured.gltf_kwargs(out_path, CREDIT))
    size = os.path.getsize(out_path)
    verts = sum(len(o.data.vertices) for o in parts.values())
    polys = sum(len(o.data.polygons) for o in parts.values())
    print(f"[out] {out_path} ({size} bytes, {verts} verts, {polys} tris, "
          f"base_color {tex_size[0]}x{tex_size[1]}, {time.time()-t0:.1f}s)")
    print("SUMMARY_JSON " + json.dumps({
        WORLD_ID: {
            "path": out_path, "bytes": size, "verts": verts, "polys": polys,
            "texture": list(tex_size), "ratio": ratio, "crack": crack,
            "smooth_passes": smooth_passes,
            "nodes": {MASSES[p][0]: len(o.data.vertices) for p, o in sorted(parts.items())},
            "towns": {t: [round(v, 5) for v in loc] for t, (loc, _) in towns.items()},
        }
    }))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ratio", type=float, default=DECIMATE_RATIO)
    ap.add_argument("--texture-px", type=int, default=TEXTURE_PX)
    ap.add_argument("--smooth", type=int, default=SMOOTH_PASSES)
    ap.add_argument("--jpeg-quality", type=int, default=textured.JPEG_QUALITY)
    ap.add_argument("--out", default=OUT_DEFAULT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    textured.JPEG_QUALITY = args.jpeg_quality
    export(args.ratio, args.texture_px, args.out, args.dry_run, args.smooth)
