"""The sprite sheets are retired (WP-A3.3, 2026-10-04).

`assets/sprites/` -- the 43 billboard sheets the Pixi backend and the
three.js `&nomesh` path drew -- is deleted, and nothing reads a sheet any
more: every unit and structure draws a mesh, and the HUD's pictures are the
Blender portraits (`tools/render_unit_portraits.py`).

The per-unit sprite renderers (`render_team.py`, `render_vehicle.py`,
`render_building.py`, `render_vehicle_glb.py` and the `render_<unit>.py`
specs on top of them) stay in the tree, because the mesh gate
(`render_mesh_gate.py`, `validate_mesh_assets.py`) and several mesh exporters
import their palette tables, framing and rig helpers. What they must not do is
quietly recreate the deleted directory. Every place they used to write a
sheet calls `refuse_sprite_output` first, which stops with this explanation.
A `--probe` render into `.superpowers/probe/` is still allowed.
"""
import os

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SPRITES = os.path.join(_REPO, "assets", "sprites")


def refuse_sprite_output(out_dir):
    """Raise SystemExit if `out_dir` is under the retired `assets/sprites/`."""
    target = os.path.abspath(out_dir)
    if target == _SPRITES or target.startswith(_SPRITES + os.sep):
        raise SystemExit(
            f"refusing to write {target}: assets/sprites/ is retired (WP-A3.3). "
            "Units and structures draw meshes; see tools/sprites_retired.py."
        )
