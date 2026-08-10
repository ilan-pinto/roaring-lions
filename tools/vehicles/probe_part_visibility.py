"""Do these parts contribute any pixels to the sprite? Render with and without.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/probe_part_visibility.py -- wheel_

Prints, per facing, how many pixels the named parts are responsible for, plus a
control so a null result can be believed.

Why this exists. "Are the wheels visible?" was answered wrongly three times by
looking at renders: the dark shapes along the lower flank were mudguards, running
boards and fenders, and the tyres behind them contributed nothing. Judging occlusion
by eye on a 30 degree dimetric view is unreliable, because anything sitting outboard
*and* above a part hides it.

Two traps this encodes, both hit for real:

* **Do not use `hide_render`.** `render_clip` sets `hide_render = False` on every
  object in its `show` list, so hiding parts before calling it is undone on every
  frame. The first version of this probe did exactly that and reported 0 px twice
  for parts that were plainly visible. `exclude_prefixes` is honoured by `setup()`,
  which drops the parts from the mesh list, so `render_clip` never sees them.

* **Always run the control.** A probe that reports "0 px" is indistinguishable from
  a probe that is not measuring anything. The control removes a part known to be
  visible; if that also reports 0, the run means nothing.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.abspath("tools"))

from render_vehicle import VehicleSpec, render_clip, setup  # noqa: E402

#: A part that is unmistakably visible on every facing, for the control.
CONTROL_PART = "hull_upper"
FACING_STEP = 2


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    prefix = argv[0] if argv else "wheel_"

    import render_eitan as target      # guarded, so the import renders nothing

    out = {}
    for tag, excl in (("all", ()), ("without", (prefix,)), ("control", (CONTROL_PART,))):
        spec = VehicleSpec(
            src=target.SPEC.src,
            out_hull=f"/tmp/probe_{tag}",
            out_turr="/tmp/probe_turr",
            real_metres=target.SPEC.real_metres,
            size_class=target.SPEC.size_class,
            credit="probe",
            hull_unit="probe",
            turret_unit="probe",
            role_palette=target.SPEC.role_palette,
            turret_meshes=frozenset(),
            exclude_prefixes=excl,
            strip_source_lights=True,
        )
        pivot, hull, turret, _olive, _framing = setup(spec)
        bpy.context.scene.cycles.samples = 20
        files = []
        render_clip(pivot, hull, turret, spec.out_hull, "idle", files)
        out[tag] = (spec.out_hull, len(hull))
        print(f"{tag:8s} {len(hull)} hull part(s) -> {spec.out_hull}")

    print()
    print(f"now compare, e.g. with tools/vehicles/report_part_visibility.py {prefix}")
    for tag, (path, n) in out.items():
        print(f"  {tag:8s} {path}  ({n} parts)")


if __name__ == "__main__":
    main()
