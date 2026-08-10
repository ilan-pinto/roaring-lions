"""Reshape the Eitan hero asset: narrower, stepped, weapons proud, real glacis.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/reshape_eitan.py

Edits art/showcase/apc_detail.blend in place. Re-flatten and re-render after:

    blender --background --python tools/vehicles/flatten_for_sprites.py
    blender --background --python tools/render_eitan.py
    python3 tools/quantize_sprites.py --sprites assets/sprites

Why. Two widening passes took the hull to W/L 0.527 and H/L 0.523 -- very nearly a
cube -- and it read as a blocky turtle with no visible weapons, a strange front and
no discernible wheels. Measured against the truck that read better (W/L 0.439,
H/L 0.425) and against real 8x8s (0.357 / 0.321), the numbers agree.

But width alone is not the diagnosis. The truck reads better mostly because its
*section varies along its length* -- low bonnet, tall cab, low bed, three distinct
masses. This hull was one constant slab from nose to tail, and no amount of
narrowing fixes that. So the roofline steps here as well as narrowing.

Four stages, each measured rather than assumed:

1. **Narrow to W/L 0.42**, the truck's ratio, by scaling everything *except* the
   wheels in Y. Leaving the wheel track alone is what finally makes the wheels
   read: the hull half-width drops below the tyre faces, so the tyres protrude and
   silhouette themselves. Earlier attempts lifted bodywork and widened the track to
   chase this; simply narrowing the hull does it for free.

2. **Step the roofline** into a low nose, a tall crew section aft of centre, and a
   lower rear deck. Only geometry above the belt is touched, so the lower hull and
   the running gear stay put.

3. **A raked glacis and a flat nose plate** instead of the triangular prow, which is
   what read as "weird" -- a point has no facets to catch the key light, so it
   flattens into a blob at sprite scale.

4. **Weapons proud of the roof.** The station cleared the roofline by 0.5 and was
   invisible; it grows 30% and rises 0.5 so it breaks the silhouette.

Vertex edits go through world space and back, so parts parented to the wheel and
turret pivots are handled correctly rather than being silently skewed by their
parent's transform.
"""
import bpy

SRC = "art/showcase/apc_detail.blend"

NARROW_Y = 0.80          # 5.12 -> ~4.10, i.e. W/L 0.42
BELT_Z = 2.60            # above this is "roof"; below it the hull and wheels stay
NOSE_DROP = 0.55         # front third
REAR_DROP = 0.35         # rear deck
WEAPON_UP = 0.50
WEAPON_GROW = 1.30

WHEEL = ("wheel_", "pivot_wheel")
WEAPON = ("turret_", "mgun_", "aps_radar_")
#: The cage narrows with the hull but must not be stepped with the roof -- it is
#: flank armour, and stepping it would leave it floating off the body.
NO_STEP = WEAPON + ("cage_", "wheel_")


def meshes():
    return [o for o in bpy.data.objects
            if o.type == "MESH" and not o.name.startswith(("Ground", "APC_Path"))]


def edit(ob, fn):
    """Apply fn to each vertex in world space, writing back through the parent."""
    mw = ob.matrix_world.copy()
    inv = mw.inverted()
    for v in ob.data.vertices:
        v.co = inv @ fn(mw @ v.co)
    ob.data.update()


def extent():
    xs, ys, zs = [], [], []
    for o in meshes():
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def report(tag):
    (x0, x1), (y0, y1), (z0, z1) = extent()
    L, W, H = x1 - x0, y1 - y0, z1 - z0
    print(f"  {tag:24s} L {L:.3f}  W {W:.3f}  H {H:.3f}   W/L {W/L:.3f}  H/L {H/L:.3f}")
    return L, W, H


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    # Rest pose, so measurements are of the vehicle rather than of wherever the
    # animation had it on its path.
    sc = bpy.context.scene
    sc.frame_set(1)
    for ob in bpy.data.objects:
        for c in list(ob.constraints):
            ob.constraints.remove(c)
        if ob.animation_data:
            ob.animation_data_clear()
        if ob.type == "EMPTY":
            ob.rotation_euler = (0.0, 0.0, 0.0)
            if ob.name == "APC_Root":
                ob.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    print("before:")
    report("as authored")

    # --- 1. narrow, wheels excepted -----------------------------------------
    for ob in meshes():
        if ob.name.startswith(WHEEL):
            continue

        def narrow(w):
            w.y *= NARROW_Y
            return w

        edit(ob, narrow)
    bpy.context.view_layer.update()
    print("after:")
    report("narrowed")

    (x0, x1), _, _ = extent()
    L = x1 - x0
    nose_from = x1 - 0.34 * L      # front third
    rear_to = x0 + 0.30 * L        # rear deck

    # --- 2. step the roofline ------------------------------------------------
    for ob in meshes():
        if ob.name.startswith(NO_STEP):
            continue

        def step(w):
            if w.z <= BELT_Z:
                return w
            if w.x >= nose_from:
                w.z -= NOSE_DROP
            elif w.x <= rear_to:
                w.z -= REAR_DROP
            return w

        edit(ob, step)
    bpy.context.view_layer.update()
    report("roofline stepped")

    # --- 3. glacis and nose plate -------------------------------------------
    # Truncate the point into a plate, and rake what is above the belt backwards so
    # the front has two facets instead of one edge.
    plate_x = x1 - 0.38
    for ob in meshes():
        if ob.name.startswith(WEAPON + ("wheel_",)):
            continue

        def prow(w):
            if w.x <= plate_x:
                return w
            w.x = plate_x
            if w.z > BELT_Z - 0.35:
                w.x -= 0.42          # upper plate rakes back over the lower
            return w

        edit(ob, prow)
    bpy.context.view_layer.update()
    report("glacis + nose plate")

    # --- 4. weapons proud ----------------------------------------------------
    wparts = [o for o in meshes() if o.name.startswith(WEAPON)]
    if not wparts:
        raise SystemExit("no weapon-station parts matched")
    pts = []
    for ob in wparts:
        mw = ob.matrix_world
        pts += [mw @ v.co for v in ob.data.vertices]
    cx = sum(p.x for p in pts) / len(pts)
    cy = sum(p.y for p in pts) / len(pts)
    cz = min(p.z for p in pts)      # grow upward from its base, not through the roof
    for ob in wparts:
        def bigger(w):
            w.x = cx + (w.x - cx) * WEAPON_GROW
            w.y = cy + (w.y - cy) * WEAPON_GROW
            w.z = cz + (w.z - cz) * WEAPON_GROW + WEAPON_UP
            return w

        edit(ob, bigger)
    bpy.context.view_layer.update()
    L, W, H = report("weapons proud")

    # The points of the exercise, asserted. Note the gates are on the *body*, not on
    # the overall extent: once the wheels protrude they set the total width, and
    # gating on that would reject the very outcome being aimed at. Likewise H/L
    # legitimately rises when the weapon station grows -- that is it becoming
    # visible.
    def reach(pred):
        return max(abs((o.matrix_world @ v.co).y)
                   for o in meshes() if pred(o.name) for v in o.data.vertices)

    wheel_y = reach(lambda n: n.startswith("wheel_"))
    body_y = reach(lambda n: not n.startswith(("wheel_", "cage_")))
    body_ratio = (body_y * 2) / L
    print(f"  body W {body_y * 2:.3f} -> W/L {body_ratio:.3f}")
    print(f"  tyres reach |y| {wheel_y:.3f}, body {body_y:.3f} "
          f"-> wheels protrude {wheel_y - body_y:+.3f} each side")
    if body_ratio > 0.46:
        raise SystemExit(f"body still too wide: W/L {body_ratio:.3f}")
    if wheel_y <= body_y:
        raise SystemExit("wheels still inboard of the body; narrow further")

    # And that the roofline actually steps, which is the turtle fix.
    def roof_at(lo, hi):
        zs = [(o.matrix_world @ v.co).z
              for o in meshes() if not o.name.startswith(NO_STEP)
              for v in o.data.vertices
              if lo <= (o.matrix_world @ v.co).x <= hi]
        return max(zs) if zs else 0.0

    nose_roof = roof_at(nose_from, x1)
    crew_roof = roof_at(rear_to, nose_from)
    rear_roof = roof_at(x0, rear_to)
    print(f"  roofline  nose {nose_roof:.2f}  crew {crew_roof:.2f}  rear {rear_roof:.2f}")
    if not (nose_roof < crew_roof and rear_roof < crew_roof):
        raise SystemExit("roofline did not step -- still a constant-section slab")

    bpy.ops.wm.save_mainfile()
    print(f"saved {SRC}")


if __name__ == "__main__":
    main()
