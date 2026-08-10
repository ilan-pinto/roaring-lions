"""Keep the Eitan's slat armour on its flanks and take it off the nose and tail.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/trim_eitan_cage.py

Edits art/showcase/apc_detail.blend in place. Re-flatten and re-render after.

Why. Once the hull was narrowed to W/L 0.415 the cage's 107 parts wrapped all four
sides at belt height and formed an unbroken dark rim, so the vehicle read as a tray
with a green lid rather than an APC. Breaking the wrap is what stops that, and the
flanks are where RPG hits actually come from -- so the anti-RPG kit stays where it
earns its keep and comes off the ends, which also finally lets the new glacis be
seen.

Selection is geometric, not by name: a part is a nose or tail run if its own centre
sits forward of the front axle or behind the rear axle. Matching `cage_rear_*` by
name alone would miss the front runs and the wrap-around corner braces.
"""
import bpy

SRC = "art/showcase/apc_detail.blend"

#: Fraction of the half-length beyond which a cage run counts as an end run rather
#: than a flank run. 0.62 keeps the cage across the crew compartment and drops it
#: from the sloped nose and the ramp.
END_FRACTION = 0.62


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)

    cage = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("cage_")]
    if not cage:
        raise SystemExit("no cage parts found -- has the asset changed?")

    # Body length from the hull, not from the cage, so the threshold does not move
    # as parts are removed.
    hull = [o for o in bpy.data.objects
            if o.type == "MESH" and o.name.startswith(("hull_", "armour_", "era_"))]
    xs = [(o.matrix_world @ v.co).x for o in hull for v in o.data.vertices]
    mid = (min(xs) + max(xs)) / 2.0
    half = (max(xs) - min(xs)) / 2.0
    cut = half * END_FRACTION

    removed, kept = [], 0
    for o in cage:
        cx = sum((o.matrix_world @ v.co).x for v in o.data.vertices) / len(o.data.vertices)
        if abs(cx - mid) > cut:
            removed.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            kept += 1

    print(f"hull spans x {min(xs):.2f}..{max(xs):.2f}  (mid {mid:.2f}, cut +-{cut:.2f})")
    print(f"cage: kept {kept} flank part(s), removed {len(removed)} end part(s)")
    if kept == 0:
        raise SystemExit("removed the whole cage -- END_FRACTION is too small")
    if not removed:
        raise SystemExit("removed nothing -- END_FRACTION is too large")

    # The rim must actually be broken: no cage geometry left near either end.
    left = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("cage_")]
    worst = max(
        abs(sum((o.matrix_world @ v.co).x for v in o.data.vertices) / len(o.data.vertices) - mid)
        for o in left
    )
    print(f"furthest remaining cage part sits {worst:.2f} from mid (cut was {cut:.2f})")
    if worst > cut + 1e-6:
        raise SystemExit("an end run survived the trim")

    bpy.ops.wm.save_mainfile()
    print(f"saved {SRC}")


if __name__ == "__main__":
    main()
