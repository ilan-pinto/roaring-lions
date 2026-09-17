"""Export an infantry team as a skinned glTF, from tools/units/rig.py.

Usage:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_team.py -- inf_squad militia_cell ...

    # or every team this pipeline covers:
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_team.py -- all

Writes `art/meshes/<team_id>.glb` per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`. `rig.py`'s own
`SUPPORTED_TEAMS` and module docstring record which of `tools/units/teams.py`'s
teams are covered and why the rest are not.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import rig  # noqa: E402
from mesh_ownership import split_owned_and_superseded  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv == ["all"]:
        # "all" means "everything this kit owns", and it says which it skipped.
        # Named, never silently dropped: `all` meaning "all but one" is exactly
        # the kind of thing a reader has to be told.
        names, superseded = split_owned_and_superseded(
            list(rig.SUPPORTED_TEAMS), rig.TEAM_MESH_OWNER, "rig.TEAM_MESH_OWNER"
        )
        for name in superseded:
            print(f"[{name}] SKIPPED by `all`: art/meshes/{name}.glb is not "
                  f"rig.py's to regenerate -- {rig.TEAM_MESH_OWNER[name]}")
    else:
        names = argv or [rig.DEFAULT_TEAM]
    for name in names:
        _arm_obj, merged, path = rig.build_and_export(name)
        size = os.path.getsize(path)
        roles = sorted(merged)
        print(f"[{name}] wrote {path} ({size} bytes), {len(roles)} meshes: {roles}")


if __name__ == "__main__":
    main()
