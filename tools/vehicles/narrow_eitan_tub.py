"""Pull the Eitan's lower hull in so the tyres become the widest thing on it.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/narrow_eitan_tub.py

Edits art/showcase/apc_detail.blend in place. Re-flatten, re-render, and recheck
`real_metres` in tools/render_eitan.py afterwards.

Why, in pixels rather than adjectives. On this rig -- ortho, azimuth 225, elevation
asin(0.5) -- a lateral offset of `dy` at a wheel station projects to
`0.7071 * dy * 256 / ortho_units` pixels of screen width. With the tyres at 2.235,
their own fenders at 2.05 and the body at 1.936, that came to **2.8 px** of tyre
showing past the fender and 4.5 px past the body. Nothing reads at 3 px, which is why
the wheels were invisible however dark or light they were painted.

Widening the track cannot fix it: 2.60 buys 8.3 px and takes W/L to 0.544, which is
the blocky proportion that started this. Narrowing the *lower* hull can: at 1.55 the
tyre clears by 10.3 px with the overall width unchanged, because the tyres already set
it. That is also how real eight-wheelers are arranged, and how the technical works --
a narrow tub with the wheels as the widest thing on the vehicle.

Only geometry below the belt moves. The deck, the weapon station and the stepped
roofline are left exactly as they are.
"""
import bpy

SRC = "art/showcase/apc_detail.blend"

TUB_Y = 1.55            # new half-width for everything below the belt
FENDER_Y = 1.62         # fenders just outside the tub, still inboard of the tyres
BELT_Z = 2.10           # below this is "tub"; above it the hull keeps its shape
KEEP = ("wheel_",)      # the tyres are the reference, so they do not move


def vehicle():
    return [o for o in bpy.data.objects
            if o.type == "MESH" and not o.name.startswith(("Ground", "APC_Path"))]


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


def edit(ob, fn):
    mw = ob.matrix_world.copy()
    inv = mw.inverted()
    for v in ob.data.vertices:
        v.co = inv @ fn(mw @ v.co)
    ob.data.update()


def reach(pred, below=None):
    vals = []
    for o in vehicle():
        if not pred(o.name):
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            if below is None or w.z <= below:
                vals.append(abs(w.y))
    return max(vals) if vals else 0.0


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    rest_pose()

    tyre = reach(lambda n: n.startswith("wheel_"))
    print(f"tyres reach |y| {tyre:.3f} -- the reference, unchanged")

    for ob in vehicle():
        if ob.name.startswith(KEEP):
            continue
        is_fender = ob.name.startswith("fender_")
        cap = FENDER_Y if is_fender else TUB_Y

        def pull(w):
            # Fenders arch over the wheels and belong to the running gear, so they
            # come in wholesale. Everything else only narrows below the belt.
            if not is_fender and w.z > BELT_Z:
                return w
            if abs(w.y) > cap:
                w.y = cap if w.y > 0 else -cap
            return w

        edit(ob, pull)
    bpy.context.view_layer.update()

    tub = reach(lambda n: not n.startswith(("wheel_", "fender_")), below=BELT_Z)
    fend = reach(lambda n: n.startswith("fender_"))
    tyre_after = reach(lambda n: n.startswith("wheel_"))
    print(f"after: tub |y| {tub:.3f}  fenders {fend:.3f}  tyres {tyre_after:.3f}")

    # The point of the exercise, in the units that matter: projected pixels.
    import math
    az, E = math.radians(225.0), math.asin(0.5)
    right_y = math.cos(az)
    # ortho_units is recomputed by the rig; 12.07 was the last measured frame and is
    # only used here to express the margin in approximate pixels.
    ppu = 256.0 / 12.07
    clear_px = abs((tyre_after - max(tub, fend)) * right_y) * ppu
    print(f"tyre clears the widest bodywork by {clear_px:.1f} px on screen")
    if tyre_after <= max(tub, fend):
        raise SystemExit("tyres are not the widest thing on the vehicle")
    if clear_px < 7.0:
        raise SystemExit(f"only {clear_px:.1f} px of tyre showing -- will not read")

    xs, ys, zs = [], [], []
    for o in vehicle():
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    L, W, H = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    print(f"extent  L {L:.3f}  W {W:.3f}  H {H:.3f}   W/L {W / L:.3f}")

    bpy.ops.wm.save_mainfile()
    print(f"saved {SRC}")


if __name__ == "__main__":
    main()
