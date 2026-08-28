"""Export an infantry team as a skinned glTF, from tools/units/rig.py.

Usage:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_team.py -- inf_squad

Writes `art/meshes/<team_id>.glb` per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`. `rig.py` currently
covers only `inf_squad` -- see its `TEAM_ID` docstring for why the other eight
`tools/units/teams.py` teams are out of scope for this slice.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import rig  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = argv or [rig.TEAM_ID]
    for name in names:
        _arm_obj, merged, path = rig.build_and_export(name)
        size = os.path.getsize(path)
        roles = sorted(merged)
        print(f"[{name}] wrote {path} ({size} bytes), {len(roles)} meshes: {roles}")


if __name__ == "__main__":
    main()
