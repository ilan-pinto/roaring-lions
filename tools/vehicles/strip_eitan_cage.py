"""Remove the Eitan's slat cage entirely.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/strip_eitan_cage.py

Edits art/showcase/apc_detail.blend in place. Re-flatten and re-render after, and
**recheck the drawn scale**: the cage sat outboard and above the hull, so removing it
shrinks the model's extents, the rig sizes each frame to hold the model at every
facing, and `real_metres` in tools/render_eitan.py has to move to keep the vehicle
from changing size on screen.

Why. The cage went through three states before this. All four sides, which wrapped
the hull in an unbroken dark rim once it was narrowed and made the vehicle read as a
tray with a green lid. Then flanks only, which broke the rim and let the glacis be
seen. Now none: at gameplay zoom sixty-eight bars along the flanks still out-number
the eight wheels they sit beside, and the lattice reads as noise rather than as
armour.

This supersedes trim_eitan_cage.py, which is why that script is gone -- it existed to
keep the flank runs, and there are none left to keep.

The anti-RPG protection is now a stat rather than something visible on the hull. That
is a deliberate trade: at ~100 px the slats never read as slats, and what they cost
was the wheels and the vehicle's whole shape.
"""
import bpy

SRC = "art/showcase/apc_detail.blend"


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)

    cage = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("cage_")]
    if not cage:
        print("no cage parts left -- nothing to do")
        return

    before = len([o for o in bpy.data.objects if o.type == "MESH"])
    names = sorted({n.rsplit("_", 1)[0] for n in (o.name for o in cage)})
    for o in cage:
        bpy.data.objects.remove(o, do_unlink=True)
    after = len([o for o in bpy.data.objects if o.type == "MESH"])

    print(f"removed {before - after} cage part(s) across {len(names)} run(s): {names}")
    print(f"meshes {before} -> {after}")

    leftover = [o.name for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("cage_")]
    if leftover:
        raise SystemExit(f"cage parts survived: {leftover[:5]}")

    # Report the new extents, since real_metres has to be reset against them.
    xs, ys, zs = [], [], []
    for o in bpy.data.objects:
        if o.type != "MESH" or o.name.startswith(("Ground", "APC_Path")):
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    L, W, H = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    print(f"extent now  L {L:.3f}  W {W:.3f}  H {H:.3f}   W/L {W / L:.3f}")
    print("-> recheck real_metres in tools/render_eitan.py against the tank's scale")

    bpy.ops.wm.save_mainfile()
    print(f"saved {SRC}")


if __name__ == "__main__":
    main()
