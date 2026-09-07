"""Transfer Meshy's own part segmentation onto its textured sibling.

Shared by `export_meshy_apache.py` (first user, 2026-09-07) and
`export_meshy_jeep.py`. The fact it rests on, measured on both assets before
either export trusted it: a Meshy generation's `part-segmentation` export
and its `image-to-3d-texture` export are the SAME MESH at a uniform scale
(Meshy normalises each pass's overall bounding box independently), the
segmentation pass merely split into `model_partN` objects. Carried through
the aggregate-bbox affine `fit_affine` computes, every vertex of the
textured mesh coincides with a vertex of exactly one part -- p99.9 within
0.0002 model units on the AH-64 (24,492 rotor vertices sampled), p99 at
0.0000 on the jeep (122,857 sampled) -- while the nearest vertex of a
DIFFERENT part, away from a seam, is an edge away (~0.002 on a 787k-vertex
mesh). The two files' vertex counts differ by exactly the seam vertices the
split duplicated (198 on the AH-64).

So `label_textured_vertices` labels each textured vertex by the part of the
part-segmentation vertices within `DEFAULT_MATCH_RADIUS` of it (two labels
at one position = a seam vertex), `face_masks` claims a face for a part when
every corner is that part or a seam and at least one corner is unambiguously
the part, and `split_piece` cuts the claimed faces out of the FULL-resolution
mesh before any decimation. The alternative this replaced -- plane and box
cuts positioned from the parts' bounding boxes -- left the Peten's two
forward blades static in the hull (`export_meshy_apache.py`, top note).

Everything here is deterministic and reads only vertex positions. The
part-segmentation file never ships anything: it is opened first, censused,
and replaced in the scene by the textured file the caller opens next.
"""
import bmesh
import bpy
import numpy as np
from mathutils import Vector, kdtree

#: Range-query radius for `label_textured_vertices`, textured model units.
#: 2.5x the worst coincidence residual measured (0.0004, AH-64 rotor), and
#: half the shortest edge on either 800k-vertex mesh (~0.002). A caller whose
#: source measures differently passes its own.
DEFAULT_MATCH_RADIUS = 0.001


def obj_bbox(ob):
    """`ob`'s bbox as ((xmin,xmax),(ymin,ymax),(zmin,zmax)) from local `co`.
    Refuses an object that is not at the origin with unit scale and no
    rotation -- every Meshy source this pipeline reads is, and reading local
    coordinates as world ones silently depends on it."""
    mw = ob.matrix_world
    if tuple(round(c, 9) for c in mw.translation) != (0.0, 0.0, 0.0):
        raise SystemExit(f"{ob.name}: not at the origin ({tuple(mw.translation)}) -- census assumes identity transforms")
    if any(abs(s - 1.0) > 1e-9 for s in mw.to_scale()) or any(abs(a) > 1e-9 for a in mw.to_euler()):
        raise SystemExit(f"{ob.name}: scaled or rotated -- census assumes identity transforms")
    n = len(ob.data.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mn, mx = co.min(axis=0), co.max(axis=0)
    return tuple((float(mn[i]), float(mx[i])) for i in range(3))


def union_bbox(boxes):
    boxes = list(boxes)
    return tuple(
        (min(b[ax][0] for b in boxes), max(b[ax][1] for b in boxes)) for ax in range(3)
    )


def partseg_census(path, names, label_of, tag):
    """Open the part-segmentation file at `path` (already resolved) and
    return `(boxes, verts, labels)`: `{name: bbox}` for every object in
    `names`, every vertex of every named part as one `(N, 3)` float64 array,
    and the matching `(N,)` int8 label from `label_of[name]`. READ ONLY;
    call BEFORE opening the textured file, since `open_mainfile` replaces the
    scene -- everything returned is plain numpy and outlives it."""
    bpy.ops.wm.open_mainfile(filepath=path)
    boxes, chunks, labels = {}, [], []
    for name in names:
        ob = bpy.data.objects[name]
        if ob.modifiers:
            raise SystemExit(f"{name} carries {len(ob.modifiers)} modifier(s) in the part-segmentation census")
        boxes[name] = obj_bbox(ob)
        n = len(ob.data.vertices)
        co = np.empty(n * 3, dtype=np.float32)
        ob.data.vertices.foreach_get("co", co)
        chunks.append(co.reshape(-1, 3).astype(np.float64))
        labels.append(np.full(n, label_of[name], dtype=np.int8))
    verts = np.vstack(chunks)
    labels = np.concatenate(labels)
    print(f"[{tag}] part-segmentation census: {len(verts)} verts across {len(names)} parts")
    return boxes, verts, labels


def fit_affine(partseg_boxes, textured_box, tag):
    """One GLOBAL scale plus a per-axis offset mapping part-segmentation
    model units into textured model units, from the two files' aggregate
    bboxes. The three per-axis ratios are printed and must agree: they did
    to four significant figures on every source so far (4.3457 x3 on the
    AH-64, 7.5838 x3 on the jeep), which is the measurement that says the
    two passes are one normalised model. Disagreement beyond 0.5% aborts --
    that would be a different model, and nothing below could be trusted."""
    agg = union_bbox(partseg_boxes.values())
    axis_scales = [
        (textured_box[ax][1] - textured_box[ax][0]) / (agg[ax][1] - agg[ax][0]) for ax in range(3)
    ]
    scale = sum(axis_scales) / 3.0
    spread = max(abs(s - scale) / scale for s in axis_scales)
    offsets = tuple(textured_box[ax][0] - scale * agg[ax][0] for ax in range(3))
    print(
        f"[{tag}] partseg->textured affine: per-axis scale {[round(s, 4) for s in axis_scales]}, "
        f"mean {scale:.4f} (spread {100 * spread:.3f}%), offsets {tuple(round(o, 4) for o in offsets)}"
    )
    if spread > 0.005:
        raise SystemExit(
            f"[{tag}] the two sources' bounding boxes scale differently per axis -- "
            f"they are not the same normalised model; do not transfer a segmentation between them"
        )
    return scale, offsets


def transform_box(box, scale, offset, margin=0.0):
    """`box` (part-segmentation frame) -> textured frame, widened by
    `margin` on every side."""
    return tuple(
        (box[ax][0] * scale + offset[ax] - margin, box[ax][1] * scale + offset[ax] + margin) for ax in range(3)
    )


def transform_scalar(value, axis, scale, offset):
    """One coordinate along `axis` (0/1/2), part-segmentation frame -> textured."""
    return value * scale + offset[axis]


def label_textured_vertices(ob, partseg_verts, partseg_labels, scale, offset, *, radius, fallthrough, seam, names, tag):
    """Every vertex of `ob` labelled by the part-segmentation vertices within
    `radius` of it after the affine: one part -> that label; two or more ->
    `seam`; none -> the nearest part's label, counted as a miss and refused
    past 0.1% of vertices (the sources are then no longer the same mesh).
    `names` maps label -> printable name for the census line. Returns an
    `(N,)` int8 array over `ob.data.vertices`."""
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    pts = partseg_verts * scale + np.asarray(offset, dtype=np.float64)
    kd = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(Vector(p), i)
    kd.balance()
    labels = np.full(n, fallthrough, dtype=np.int8)
    seams = misses = 0
    miss_worst = 0.0
    for i in range(n):
        hits = kd.find_range(Vector(co[i]), radius)
        if not hits:
            _, idx, dist = kd.find(Vector(co[i]))
            misses += 1
            miss_worst = max(miss_worst, dist)
            labels[i] = partseg_labels[idx]
            continue
        found = {int(partseg_labels[idx]) for _, idx, _ in hits}
        if len(found) == 1:
            labels[i] = found.pop()
        else:
            labels[i] = seam
            seams += 1
    counts = {name: int((labels == lab).sum()) for lab, name in names.items()}
    counts["seam"] = seams
    print(f"[{tag}] textured vertex labels: {counts}; range-query misses {misses} (worst nearest {miss_worst:.5f})")
    if misses > n * 0.001:
        raise SystemExit(
            f"[{tag}] segmentation transfer: {misses} of {n} textured vertices have no part-segmentation "
            f"vertex within {radius} -- the two sources are no longer the same mesh; re-measure"
        )
    return labels


def face_masks(ob, labels, *, claim, seam, names, tag):
    """`{label: bool mask over ob.data.polygons}` for every label in `claim`:
    a face belongs to a part when every corner is that part or a seam vertex
    and at least one corner is unambiguously the part. A face with an
    unambiguous corner of another part is never claimed, so the only faces
    the rule can misplace are triangles with all three corners ON a seam,
    and those fall through to whatever the caller keeps as the remainder.
    Triangulated meshes only (every Meshy export is; asserted)."""
    me = ob.data
    nf = len(me.polygons)
    totals = np.empty(nf, dtype=np.int32)
    me.polygons.foreach_get("loop_total", totals)
    if not np.all(totals == 3):
        raise SystemExit(f"[{tag}] face_masks: {int((totals != 3).sum())} non-triangle face(s) -- triangulate first")
    vi = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", vi)
    tri = labels[vi.reshape(-1, 3)]
    masks = {}
    claimed = np.zeros(nf, dtype=bool)
    for lab in claim:
        ok = (tri == lab) | (tri == seam)
        masks[lab] = ok.all(axis=1) & (tri == lab).any(axis=1)
        claimed |= masks[lab]
    summary = " ".join(f"{names[lab]}={int(masks[lab].sum())}" for lab in claim)
    print(f"[{tag}] face masks: {summary} remainder={int((~claimed).sum())} of {nf}")
    return masks


def delete_faces_mask(ob, keep_mask):
    """Delete every face of `ob` whose index is False in `keep_mask` (bmesh
    preserves polygon order on `from_mesh`, so face i is polygon i). Built
    for the FULL-resolution mesh, where a per-face Python predicate over
    ~2M faces would be the slow part."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    to_delete = [bm.faces[int(i)] for i in np.flatnonzero(~keep_mask)]
    bmesh.ops.delete(bm, geom=to_delete, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def split_piece(src_obj, keep_mask, name, tag):
    """A duplicate of `src_obj` reduced to the faces in `keep_mask`, named
    `name`. `src_obj` is untouched: the caller removes every claimed face
    from it in ONE pass afterwards, so every mask is read against the same
    original polygon order."""
    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    piece = bpy.context.object
    piece.name = name
    delete_faces_mask(piece, keep_mask)
    print(f"[{tag}] {name}: {len(piece.data.polygons)} faces cut from the full-resolution mesh")
    return piece
