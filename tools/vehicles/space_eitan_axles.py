"""Space the Eitan's axles so four wheels read per side instead of one blob.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/space_eitan_axles.py

Edits art/showcase/apc_detail.blend in place. Re-flatten, re-render, recheck
`real_metres` afterwards.

Why. The axles sat at x -3.02, -1.52, +1.38, +2.96 -- adjacent spacings of 1.50 and
1.58 against a tyre *diameter* of 1.52. Adjacent tyres were touching, so each pair
fused into a single dark mass and the vehicle read as having one wheel a side rather
than four. Wheel count is the cheapest silhouette cue a wheeled hull has, and it was
being thrown away by 2 cm.

Even spacing at +-1.20 and +-3.60 gives 2.40 between axles, so 0.88 of daylight
between tyres -- unambiguous at gameplay zoom -- and leaves ~1.18 of overhang at each
end, which is right for an eight-wheeler.

Fenders move with their wheels. They are matched by nearest x rather than by name,
because their names encode the order the pivots happened to be iterated in, not their
position along the hull.
"""
import bpy

SRC = "art/showcase/apc_detail.blend"

#: New axle x positions, front to back. Mirrored automatically for both sides.
AXLE_X = (3.60, 1.20, -1.20, -3.60)
MIN_GAP = 0.40          # daylight between adjacent tyres, in model units


def rest_pose():
    bpy.context.scene.frame_set(1)
    for o in bpy.data.objects:
        for c in list(o.constraints):
            o.constraints.remove(c)
        if o.animation_data:
            o.animation_data_clear()
        if o.type == "EMPTY":
            o.rotation_euler = (0.0, 0.0, 0.0)
            if o.name == "APC_Root":
                o.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()


def centroid_x(ob):
    return sum((ob.matrix_world @ v.co).x for v in ob.data.vertices) / len(ob.data.vertices)


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    rest_pose()

    pivots = [o for o in bpy.data.objects
              if o.type == "EMPTY" and o.name.startswith("pivot_wheel")]
    if len(pivots) != 8:
        raise SystemExit(f"expected 8 wheel pivots, found {len(pivots)}")

    fenders = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("fender_")]
    print(f"{len(pivots)} pivots, {len(fenders)} fenders")

    # Old x per fender, before anything moves, so the match is against the layout the
    # fenders were built for.
    fender_x = {o.name: centroid_x(o) for o in fenders}

    moves = {}      # old pivot x -> delta
    for side in (1.0, -1.0):
        side_pivots = sorted([p for p in pivots if (p.location.y >= 0) == (side > 0)],
                             key=lambda p: -p.location.x)
        if len(side_pivots) != 4:
            raise SystemExit(f"expected 4 pivots on one side, found {len(side_pivots)}")
        for p, new_x in zip(side_pivots, AXLE_X):
            moves[round(p.location.x, 4)] = new_x - p.location.x
            print(f"   {p.name:20s} x {p.location.x:+.3f} -> {new_x:+.3f}")
            p.location.x = new_x

    # Each fender follows the axle it was built over.
    for o in fenders:
        old = fender_x[o.name]
        nearest = min(moves, key=lambda k: abs(k - old))
        o.location.x += moves[nearest]
    bpy.context.view_layer.update()

    # Assert the point: four separated tyres a side.
    tyres = [o for o in bpy.data.objects
             if o.type == "MESH" and o.name.startswith("wheel_") and o.name.endswith("_barrel")]
    spans = []
    for o in tyres:
        if (o.matrix_world @ o.data.vertices[0].co).y < 0:
            continue
        xs = [(o.matrix_world @ v.co).x for v in o.data.vertices]
        spans.append((min(xs), max(xs)))
    spans.sort()
    print(f"tyre spans on one side: {[(round(a,2), round(b,2)) for a, b in spans]}")
    if len(spans) != 4:
        raise SystemExit(f"expected 4 tyres a side, measured {len(spans)}")
    gaps = [spans[i + 1][0] - spans[i][1] for i in range(3)]
    print(f"gaps between tyres: {[round(g, 3) for g in gaps]}")
    if min(gaps) < MIN_GAP:
        raise SystemExit(f"tyres only {min(gaps):.3f} apart -- they will fuse into one mass")

    bpy.ops.wm.save_mainfile()
    print(f"saved {SRC}")


if __name__ == "__main__":
    main()
