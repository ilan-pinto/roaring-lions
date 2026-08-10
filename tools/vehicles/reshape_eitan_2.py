"""Second Eitan reshape: wheels under the body with fenders and arches, horned prow.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/reshape_eitan_2.py

Edits art/showcase/apc_detail.blend in place. Re-flatten, re-render, then **recheck
`real_metres`** in tools/render_eitan.py: the rig sizes each frame to hold the model
at every facing, so any change to the extents moves the drawn scale.

Three requests, and the first two are one idea:

1. **Wheels in toward the centreline.** Pivots move from y +-2.000 to +-1.50, which
   puts the tyre faces at 1.885, just inside the body's 1.936. Until now the wheels
   were legible only because they hung *outside* the hull -- true, but it is not how
   a wheeled AFV looks.

2. **Fenders and wheel arches**, which is what makes tucked-in wheels read. The hull
   sill lifts clear of the tyre tops so there is daylight under the body, and each
   wheel gets an arch band over its top. `hull_tub` is a twelve-vertex prism, so
   scalloping openings into it is not possible -- the arches are added geometry, one
   per wheel, projecting slightly outboard so they cast the wheel into shadow and
   frame it. Same principle that makes the technical's wheels read.

3. **A horned prow, and a rear that mirrors it.** The flat nose plate becomes an
   upswept beak: the front's upper band lifts and extends forward. The rear gets the
   same treatment mirrored, so the silhouette is symmetric end to end.

Every stage measures rather than assumes, and the assertions at the end state what
the exercise was for.
"""
import math

import bpy

SRC = "art/showcase/apc_detail.blend"

TRACK_Y = 1.50          # wheel pivot half-track: tyre faces land at ~1.885
SILL_MIN_Z = 1.64       # hull bottom, clear of the 1.557 tyre tops
HORN_LIFT = 0.62        # how far the prow's upper band rises
HORN_REACH = 0.30       # and how far forward it extends
END_BAND = 0.55         # how much of each end counts as prow/tail

WHEEL_R_OUTER = 0.95    # arch outer radius; tyre outer radius is ~0.76
WHEEL_R_INNER = 0.80
ARCH_Y_IN = 1.12
ARCH_Y_OUT = 2.02


def vehicle():
    return [o for o in bpy.data.objects
            if o.type == "MESH" and not o.name.startswith(("Ground", "APC_Path"))]


def edit(ob, fn):
    mw = ob.matrix_world.copy()
    inv = mw.inverted()
    for v in ob.data.vertices:
        v.co = inv @ fn(mw @ v.co)
    ob.data.update()


def extent(pred=lambda n: True):
    xs, ys, zs = [], [], []
    for o in vehicle():
        if not pred(o.name):
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


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


def add_arch(name, cx, cz, sign):
    """A fender band arcing over one wheel, extruded across the tyre's width."""
    steps = 9
    a0, a1 = math.radians(14.0), math.radians(166.0)
    y0, y1 = sign * ARCH_Y_IN, sign * ARCH_Y_OUT
    ring = []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        ring.append((cx + math.cos(a) * WHEEL_R_INNER, cz + math.sin(a) * WHEEL_R_INNER))
        ring.append((cx + math.cos(a) * WHEEL_R_OUTER, cz + math.sin(a) * WHEEL_R_OUTER))
    verts, faces = [], []
    n = len(ring)
    for (x, z) in ring:
        verts.append((x, y0, z))
    for (x, z) in ring:
        verts.append((x, y1, z))
    for i in range(steps):
        a, b = i * 2, i * 2 + 1
        c, d = (i + 1) * 2, (i + 1) * 2 + 1
        faces.append((a, c, d, b))                                  # inner face
        faces.append((a + n, b + n, d + n, c + n))                  # outer face
        faces.append((b, d, d + n, b + n))                          # outer skin
        faces.append((a, a + n, c + n, c))                          # under skin
    faces.append((0, 1, 1 + n, 0 + n))
    faces.append((steps * 2, steps * 2 + n, steps * 2 + 1 + n, steps * 2 + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob["rl_role"] = "plate"
    bpy.context.collection.objects.link(ob)
    m = ob.modifiers.new("bevel", "BEVEL")
    m.width = 0.012
    m.segments = 2
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(40.0)
    return ob


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    rest_pose()
    (x0, x1), (y0, y1), (z0, z1) = extent()
    print(f"before   L {x1 - x0:.3f}  W {y1 - y0:.3f}  H {z1 - z0:.3f}")

    # --- 1. wheels in toward the centreline ---------------------------------
    seats = []
    for o in bpy.data.objects:
        if o.type == "EMPTY" and o.name.startswith("pivot_wheel"):
            sign = 1.0 if o.location.y >= 0 else -1.0
            o.location.y = sign * TRACK_Y
            seats.append((o.location.x, sign))
    if len(seats) != 8:
        raise SystemExit(f"expected 8 wheel pivots, found {len(seats)}")
    bpy.context.view_layer.update()

    # --- 2. lift the sill, then arch each wheel -----------------------------
    for o in vehicle():
        if o.name.startswith(("wheel_", "turret_", "mgun_", "aps_radar_")):
            continue

        def lift(w):
            if w.z < SILL_MIN_Z:
                w.z = SILL_MIN_Z
            return w

        edit(o, lift)
    bpy.context.view_layer.update()

    wz = 0.797   # wheel centre height, measured
    made = 0
    for cx, sign in seats:
        tag = "l" if sign < 0 else "r"
        add_arch(f"fender_{made // 2}{tag}", cx, wz, sign)
        made += 1
    bpy.context.view_layer.update()
    print(f"         added {made} fender arch(es)")

    # --- 3. horned prow, mirrored at the rear -------------------------------
    # Both ends lift to a *common* target rather than by a common amount. The first
    # reshape dropped the nose 0.55 and the rear only 0.35, so equal lifts preserve
    # that 0.20 gap and the ends stay asymmetric -- which is exactly what the
    # assertion below caught on the first run.
    (x0, x1), _, (z0, z1) = extent()
    belt = z0 + (z1 - z0) * 0.42
    front_from, rear_to = x1 - END_BAND, x0 + END_BAND

    SHELL = ("wheel_", "turret_", "mgun_", "aps_radar_", "fender_")

    def band_top(lo, hi):
        zs = [(o.matrix_world @ v.co).z
              for o in vehicle() if not o.name.startswith(SHELL)
              for v in o.data.vertices
              if lo <= (o.matrix_world @ v.co).x <= hi]
        return max(zs) if zs else 0.0

    nose_top, tail_top = band_top(front_from, x1), band_top(x0, rear_to)
    target = max(nose_top, tail_top) + HORN_LIFT
    nose_dz, tail_dz = target - nose_top, target - tail_top
    print(f"         prow {nose_top:.2f} +{nose_dz:.2f}, tail {tail_top:.2f} "
          f"+{tail_dz:.2f} -> both {target:.2f}")

    for o in vehicle():
        if o.name.startswith(SHELL):
            continue

        def horn(w):
            if w.z <= belt:
                return w
            if w.x >= front_from:
                w.z += nose_dz
                w.x += HORN_REACH
            elif w.x <= rear_to:
                w.z += tail_dz
                w.x -= HORN_REACH
            return w

        edit(o, horn)
    bpy.context.view_layer.update()

    (x0, x1), (y0, y1), (z0, z1) = extent()
    L, W, H = x1 - x0, y1 - y0, z1 - z0
    print(f"after    L {L:.3f}  W {W:.3f}  H {H:.3f}   W/L {W / L:.3f}")

    # --- assertions: the three things this was for --------------------------
    def reach(pred):
        return max(abs((o.matrix_world @ v.co).y)
                   for o in vehicle() if pred(o.name) for v in o.data.vertices)

    wheel_y = reach(lambda n: n.startswith("wheel_"))
    body_y = reach(lambda n: not n.startswith(("wheel_", "fender_")))
    fender_y = reach(lambda n: n.startswith("fender_"))
    print(f"         tyres |y| {wheel_y:.3f}  body {body_y:.3f}  fenders {fender_y:.3f}")
    if wheel_y > body_y:
        raise SystemExit("wheels still outside the body -- track is too wide")
    if fender_y <= wheel_y:
        raise SystemExit("fenders do not cover the tyres")

    sill = min((o.matrix_world @ v.co).z
               for o in vehicle()
               if not o.name.startswith(("wheel_", "fender_")) for v in o.data.vertices)
    wheel_top = max((o.matrix_world @ v.co).z
                    for o in vehicle() if o.name.startswith("wheel_") for v in o.data.vertices)
    print(f"         sill {sill:.3f} vs tyre top {wheel_top:.3f} -> daylight {sill - wheel_top:+.3f}")
    if sill < wheel_top:
        raise SystemExit("body still hangs into the wheel band")

    def top_at(lo, hi):
        zs = [(o.matrix_world @ v.co).z
              for o in vehicle()
              if not o.name.startswith(("wheel_", "turret_", "mgun_", "aps_radar_", "fender_"))
              for v in o.data.vertices
              if lo <= (o.matrix_world @ v.co).x <= hi]
        return max(zs) if zs else 0.0

    nose = top_at(front_from, x1)
    mid = top_at(rear_to, front_from)
    tail = top_at(x0, rear_to)
    print(f"         prow {nose:.2f}  midships {mid:.2f}  tail {tail:.2f}")
    if abs(nose - tail) > 0.25:
        raise SystemExit(f"rear is not symmetric to the front ({nose:.2f} vs {tail:.2f})")

    bpy.ops.wm.save_mainfile()
    print(f"saved {SRC}")


if __name__ == "__main__":
    main()
