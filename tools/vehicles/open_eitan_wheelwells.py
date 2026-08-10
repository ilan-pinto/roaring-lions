"""Open up the Eitan's wheel wells so its eight wheels read at gameplay zoom.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/open_eitan_wheelwells.py

Edits art/showcase/apc_detail.blend in place, then re-flatten and re-render:

    blender --background --python tools/vehicles/flatten_for_sprites.py
    blender --background --python tools/render_eitan.py
    python3 tools/quantize_sprites.py --sprites assets/sprites

Why. The wheels were invisible in play, and the cause was compound rather than any
one thing. Measured on the asset: the tyres reach |y| 2.385, while the mudguards
and appliqué reach 2.42 and the standoff cage 2.56. The bodywork overhangs the
tyres, that band is also the model's darkest zone, and at roughly 100 px on screen
it is ~10 px tall with eight wheels and sixty-eight cage bars competing at the same
spatial frequency.

Four things were tried and rejected before this, and they are worth recording so
nobody repeats them: per-role materials with dark tyres (helped the body, not the
wheels); dusty lighter tyres (no visible change -- `wheel_*_barrel` was mis-tagged
`metal`, since fixed); widening the wheel track by 0.34 (no improvement, reverted);
and dropping the standoff cage entirely (clears the lattice, wheels still do not
read).

What actually has to change is vertical. Under a 30 degree ortho camera, geometry
that sits *outboard and lower* projects onto the same screen band as the wheels and
screens them. So the fix is to lift everything that overhangs a tyre clear of the
wheel band:

  * mudguards and running boards go above the tyre tops (1.557), which is what puts
    daylight between hull and tyre.
  * the standoff cage's bottom rail lifts to ~1.95, so it guards the flank -- what
    slat armour is actually for -- rather than the running gear.

The cage and the appliqué both stay. This is not a reduction in the vehicle's
protection kit; it is the same kit, mounted where it does not hide the wheels.
"""
import bpy

SRC = "art/showcase/apc_detail.blend"

#: Wheel top, measured. Anything overhanging a tyre must clear this.
WHEEL_TOP = 1.557

#: prefix -> how far up it moves. Chosen so each part's *lowest* vertex ends up
#: above WHEEL_TOP, with the cage lifted further because it also sits outboard.
LIFTS = {
    "mudguard_": 0.22,
    "runningboard_": 0.30,
    # 0.28, not 0.42. The larger lift worked but pushed the cage above the roofline
    # so it read as a railing rather than flank armour. At 0.28 its bottom rail sits
    # 0.26 above the wheel top, which still clears the wheels on screen: being 0.14
    # outboard costs only 0.14*sin(30) = 0.07 of downward projection against
    # 0.26*cos(30) = 0.22 of upward.
    "cage_post_": 0.28,
    "cage_bar_": 0.28,
    "cage_rear_": 0.28,
}


def lowest_z(ob):
    return min((ob.matrix_world @ v.co).z for v in ob.data.vertices)


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)

    moved = {}
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        for prefix, dz in LIFTS.items():
            if ob.name.startswith(prefix):
                ob.location.z += dz
                moved[prefix] = moved.get(prefix, 0) + 1
                break
    bpy.context.view_layer.update()

    print("lifted:")
    for prefix, n in sorted(moved.items()):
        print(f"    {prefix:16s} x{n:4d}  +{LIFTS[prefix]:.2f}")
    if not moved:
        raise SystemExit("nothing matched -- part names must have changed")

    # Assert the point of the exercise, rather than trusting the arithmetic: no
    # lifted part may still hang into the wheel band.
    offenders = []
    for ob in bpy.data.objects:
        if ob.type != "MESH" or not ob.name.startswith(tuple(LIFTS)):
            continue
        z = lowest_z(ob)
        if z < WHEEL_TOP:
            offenders.append((ob.name, round(z, 3)))
    if offenders:
        print(f"STILL IN THE WHEEL BAND ({len(offenders)}):")
        for n, z in offenders[:10]:
            print(f"    {n:24s} lowest z {z:+.3f} < {WHEEL_TOP}")
        raise SystemExit("lift values are too small")
    print(f"all lifted parts now clear the wheel top ({WHEEL_TOP})")

    bpy.ops.wm.save_mainfile()
    print(f"saved {SRC}")


if __name__ == "__main__":
    main()
