#!/usr/bin/env python3
"""
Roaring Lions -- Phase G mesh art gate.

`validate_assets.py`'s own docstring explains the four checks it runs on
rendered sprites: PALETTE, RESERVED, ALPHA and SILHOUETTE. That gate never
looks at `art/meshes/` -- it walks PNGs, and a mesh produces none. This
script is the missing half: it renders every mesh headlessly at the locked
dimetric angle (`tools/render_mesh_gate.py`, run inside Blender, which see
for how and why), then runs the SAME checks against the result by importing
`validate_assets.py` and calling its own functions -- not a second
implementation of palette or IoU maths that could quietly disagree with the
sprite gate's.

    python3 tools/validate_mesh_assets.py
    python3 tools/validate_mesh_assets.py --out /tmp/mesh-renders   # keep the renders
    python3 tools/validate_mesh_assets.py --blender /path/to/blender

## What is compared against what, and why

Two comparisons, run separately, because they answer different questions:

1. **Palette / reserved-band / alpha-binary / framing**, per rendered mesh,
   exactly as `validate_assets.check_image` and `check_framing` already
   define them. A raw Cycles render is continuous, not quantized -- every
   other Blender output in this pipeline
   (`render_team.py`, `render_eitan.py`, `render_vehicle.py`) goes through
   `quantize_sprites.py` before the art gate ever sees it, and this script
   does the same rather than inventing a looser rule for meshes.

2. **Silhouette IoU**, at gameplay zoom, comparing a mesh's representative
   pose against:
     - every OTHER mesh's representative pose, and
     - every OTHER unit's shipped billboard sprite (`assets/sprites/`),

   deliberately EXCLUDING one pairing: a mesh against the billboard sprite of
   the SAME unit id. The whole point of the IoU gate is to stop two
   DIFFERENT units reading as the same thing in a fight -- a unit and its own
   art, mid-migration from sprite to mesh, are not two units, and are
   *supposed* to read alike; comparing them would fail the gate for doing
   its job correctly. Two different units drawing as a mesh and a sprite
   respectively can absolutely appear on screen together (only `inf_squad`
   currently ships as a mesh in-game -- CLAUDE.md, "The three.js backend" --
   and Phase F migrates one type at a time), so that cross-comparison is the
   one this gate actually exists to add; sprite-vs-sprite is already
   `validate:assets`'s job and is not repeated here.

   "Own sprite" is resolved two ways: for an infantry team, from
   `tools/units/teams.py`'s own `TEAMS` registry (`team_id -> (.., faction,
   sheet)`), read at runtime rather than copied, so a team rename there is
   picked up here automatically -- but read on the BLENDER side
   (`render_mesh_gate.py`, inside the same process that already needs it for
   faction), not here: `teams.py` imports `tools/units/kit.py`, which imports
   `bpy` at module scope, so `import teams` raises `ModuleNotFoundError` in
   this script's own plain-`python3` process. (This was tried and silently
   returned nothing for every team, defeating the exclusion entirely, before
   being caught -- see the report.) `render_mesh_gate.py` prints one
   `MESH_GATE_SHEET: <unit_id> <sheet>` line per team instead, and
   `render_meshes()` below parses it. A vehicle mesh has no equivalent
   registry to read at all (`tools/export_mesh_vehicle.py`'s own per-vehicle
   spec is not importable here either -- see `render_mesh_gate.py`'s
   docstring for why), so `VEHICLE_OWN_SPRITES` below is a small hand-kept
   table, covering the vehicle meshes that ship today. A new vehicle mesh
   with no entry here does not go unchecked -- it still gets every check
   above, including mesh-vs-sprite IoU -- it only loses the courtesy
   exclusion against its own sprite, which would read as a spurious
   "collision" against itself until an entry is added.

Never adjusts `IOU_LIMIT` or `MIN_FILL` to make a result pass -- both are
imported from `validate_assets.py`, not redeclared, so there is nowhere here
to move them even by accident.
"""
import argparse
import glob
import itertools
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import validate_assets as va  # noqa: E402
import quantize_sprites as qs  # noqa: E402

DEFAULT_BLENDER_CANDIDATES = (
    os.environ.get("BLENDER_BIN", ""),
    "blender",
    "/Applications/Blender.app/Contents/MacOS/Blender",
)

# unit_id -> the assets/sprites/ directory (or directories) that are this
# vehicle mesh's own retired art, excluded from the IoU comparison for the
# same reason a team's own sprite is -- see this module's docstring.
# tools/export_mesh_vehicle.py owns the real mapping; not imported here
# (see render_mesh_gate.py's docstring for why), so this is kept by hand.
# Extend it when a new vehicle mesh ships.
VEHICLE_OWN_SPRITES = {
    "apc_eitan": ("EITAN_HULL", "EITAN_TURR"),
}


def find_blender(explicit):
    candidates = (explicit,) + DEFAULT_BLENDER_CANDIDATES if explicit else DEFAULT_BLENDER_CANDIDATES
    for candidate in candidates:
        if not candidate:
            continue
        path = shutil.which(candidate) or (candidate if os.path.exists(candidate) else None)
        if path:
            return path
    return None


def render_meshes(blender_bin, out_dir):
    script = os.path.join(HERE, "render_mesh_gate.py")
    cmd = [blender_bin, "-b", "-P", script, "--", "--out", out_dir]
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, check=False)
    ok, warn, fail, sheets = [], [], [], {}
    for line in proc.stdout.splitlines():
        if line.startswith("MESH_GATE_OK: "):
            ok.append(line[len("MESH_GATE_OK: "):])
        elif line.startswith("MESH_GATE_WARN: "):
            warn.append(line[len("MESH_GATE_WARN: "):])
        elif line.startswith("MESH_GATE_FAIL: "):
            fail.append(line[len("MESH_GATE_FAIL: "):])
        elif line.startswith("MESH_GATE_SHEET: "):
            unit_id, sheet = line[len("MESH_GATE_SHEET: "):].rsplit(" ", 1)
            sheets[unit_id] = sheet
    return proc, ok, warn, fail, sheets


_STRUCTURE_IDS = None


def structure_ids():
    """Every building type id in data/structures.json -- pure data, safe to
    read from this plain-python process (unlike tools/units/teams.py, which
    is only importable inside Blender -- see own_sprite_dirs below)."""
    global _STRUCTURE_IDS
    if _STRUCTURE_IDS is None:
        with open(os.path.join(REPO, "data", "structures.json")) as fh:
            _STRUCTURE_IDS = set(json.load(fh)["types"])
    return _STRUCTURE_IDS


def own_sprite_dirs(unit_id, sheets):
    if unit_id in sheets:
        return (sheets[unit_id],)
    if unit_id in VEHICLE_OWN_SPRITES:
        return VEHICLE_OWN_SPRITES[unit_id]
    # A building mesh id is a data/structures.json type id, `_wreck` variants
    # included; its own sprite is assets/sprites/BLD_<ID>, uppercased --
    # tools/render_building.py's own out_dir convention. No separate wreck
    # sprite sheet exists in the current billboard roster, so a `_wreck` mesh
    # is excluded against the SAME BLD_<ID> its living form is.
    base_id = unit_id[:-len("_wreck")] if unit_id.endswith("_wreck") else unit_id
    if base_id in structure_ids():
        return (f"BLD_{base_id.upper()}",)
    return ()


def load_mesh_masks(out_dir, palette_path):
    """Quantize each render onto the palette (mirroring every other Blender
    output in this pipeline -- see module docstring), then run the same
    per-image checks `validate_assets.py` runs on a sprite. Returns
    (failures, masks)."""
    failures = []
    masks = {}
    targets, _ = qs.load_targets(palette_path)
    allowed, reserved = va.load_palette(palette_path)

    paths = sorted(glob.glob(os.path.join(out_dir, "*", "idle_f00_000.png")))
    for path in paths:
        unit_id = os.path.basename(os.path.dirname(path))
        qs.quantize(path, targets, check_only=False)
        for e in va.check_image(path, allowed, reserved):
            failures.append(f"{unit_id}: {e}")
        for e in va.check_framing(path):
            failures.append(f"{unit_id}: {e}")

        mask = va.silhouette(path)
        fill = mask.sum() / float(mask.size)
        if fill < va.MIN_FILL:
            failures.append(
                f"{unit_id}: silhouette fills {fill:.1%} of frame "
                f"(min {va.MIN_FILL:.0%}) -- unreadable at gameplay zoom"
            )
        masks[unit_id] = mask
    return failures, masks


def load_sprite_masks(sprites_root):
    paths = va.sprite_paths(sprites_root)
    if not paths:
        return {}
    reps = va.representative(paths)
    reps = {u: p for u, p in reps.items() if not va.is_layer(p)}
    return {u: va.silhouette(p) for u, p in reps.items()}


def check_collisions(mesh_masks, sprite_masks, sheets):
    failures = []
    for (ua, ma), (ub, mb) in itertools.combinations(mesh_masks.items(), 2):
        score = va.iou(ma, mb)
        if score > va.IOU_LIMIT:
            failures.append(
                f"silhouette collision: {ua} (mesh) vs {ub} (mesh) IoU={score:.3f} "
                f"(limit {va.IOU_LIMIT:.2f}) -- these read as the same unit"
            )
    for mesh_id, ma in mesh_masks.items():
        own = set(own_sprite_dirs(mesh_id, sheets))
        for sprite_id, mb in sprite_masks.items():
            if sprite_id in own:
                continue
            score = va.iou(ma, mb)
            if score > va.IOU_LIMIT:
                failures.append(
                    f"silhouette collision: {mesh_id} (mesh) vs {sprite_id} (sprite) "
                    f"IoU={score:.3f} (limit {va.IOU_LIMIT:.2f}) -- these read as the same unit"
                )
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--palette", default=os.path.join(REPO, "data", "palette.json"))
    ap.add_argument("--sprites", default=os.path.join(REPO, "assets", "sprites"))
    ap.add_argument("--blender", default="")
    ap.add_argument("--out", default="", help="keep renders here instead of a throwaway temp dir")
    args = ap.parse_args()

    blender_bin = find_blender(args.blender)
    if not blender_bin:
        print(
            "MESH GATE FAILED -- no Blender binary found. Set BLENDER_BIN or pass "
            "--blender; tried: " + ", ".join(c for c in DEFAULT_BLENDER_CANDIDATES if c)
        )
        return 1

    keep = bool(args.out)
    out_dir = args.out or tempfile.mkdtemp(prefix="rl-mesh-gate-")
    try:
        proc, ok, warn, fail, sheets = render_meshes(blender_bin, out_dir)
        for line in warn:
            print(f"  [warn] {line}")
        for line in fail:
            print(f"  [render failed] {line}")
        if not ok and not fail:
            print("MESH GATE FAILED -- Blender produced no MESH_GATE_OK/FAIL lines at all.")
            print("--- blender stdout (tail) ---")
            print("\n".join(proc.stdout.splitlines()[-40:]))
            print("--- blender stderr (tail) ---")
            print("\n".join(proc.stderr.splitlines()[-40:]))
            return 1

        failures = [f"render: {u}" for u in fail]

        image_failures, mesh_masks = load_mesh_masks(out_dir, args.palette)
        failures.extend(image_failures)

        sprite_masks = load_sprite_masks(args.sprites)
        failures.extend(check_collisions(mesh_masks, sprite_masks, sheets))

        if failures:
            print(f"\nMESH GATE FAILED -- {len(failures)} issue(s):\n")
            for f in failures:
                print(f"  - {f}")
            return 1

        print(f"mesh gate passed: {len(mesh_masks)} mesh unit(s) rendered and checked "
              f"against {len(sprite_masks)} sprite unit(s)")
        return 0
    finally:
        if not keep:
            shutil.rmtree(out_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
