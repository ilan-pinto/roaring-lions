# Namer IFV Sprites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ifv_namer` hull and turret sprite sheets, and extract the shared vehicle-rendering machinery so the Eitan and Namer scripts stop being 95% duplicates.

**Architecture:** `tools/render_vehicle.py` holds everything two vehicle renders share — flat and burnt materials, scene setup, the dimetric camera and pivot, the per-clip render loop, and manifest writing — driven by a `VehicleSpec` dataclass. `render_eitan.py` and a new `render_namer.py` become thin configs. No engine or renderer code changes: the Namer inherits clip resolution, turret traverse, wreck spawning and muzzle VFX simply by having a sheet.

**Tech Stack:** Blender 5.2 (`bpy`, background mode), Python 3, Pillow (comparison only), pnpm gates.

## Global Constraints

- **No changes under `packages/sim`.** `pnpm test:determinism` must pass with hash `484379662` unchanged. Nothing in this plan touches game logic.
- **`.blend` sources are gitignored** (`.gitignore:19` — `art/src/*.blend`). Never `git add` a `.blend`. Provenance lives in the licence HTML, the script's `CREDIT` constant, and the `credit` field in each manifest.
- **Licence:** `VEHICLE IFV DMM08` by **Mutte**, BlendSwap #75225, **CC-BY 3.0**. `CONTRIBUTING.md:17` accepts CC-BY *with a credit line*. Credit string exactly: `Mutte (CC-BY 3.0, BlendSwap #75225)`. This asset is properly licensed — do **not** mark it `LICENCE UNVERIFIED`.
- **Rendering must be followed by the quantizer.** Cycles output is off-palette with soft alpha; `pnpm validate:assets` rejects every frame otherwise. The sequence is always: render → `python3 tools/quantize_sprites.py --sprites assets/sprites` → `pnpm validate:assets`.
- **Turret sheets must declare `layer: "turret"`** in their manifest. `validate_assets.py`'s `is_layer()` reads that key to skip fill and silhouette checks; a bare weapon station is far under the 6% fill floor and fails without it.
- **Blender is at** `/Applications/Blender.app/Contents/MacOS/Blender`. Run scripts from the repo root: `/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/<script>.py`.
- Every task ends green on: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:determinism`, `pnpm validate:data`, `pnpm validate:assets`.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/render_vehicle.py` | Create: `VehicleSpec` + all shared render machinery |
| `tools/render_eitan.py` | Rewrite as a thin config calling the shared module |
| `tools/render_namer.py` | Create: the Namer's config |
| `art/src/ifv_dmm08.blend` | Place, untracked (gitignored) |
| `art/src/ifv_dmm08_LICENSE.html` | Commit: the CC-BY licence page |
| `assets/sprites/NAMER_HULL/` | Create: 16 `idle` + 16 `wreck` + manifest |
| `assets/sprites/NAMER_TURR/` | Create: 16 `idle` + manifest, `layer: "turret"` |
| `packages/app/src/main.ts` | Modify: one `SPRITE_MAP` entry |

---

### Task 1: Extract the shared vehicle renderer

**Files:**
- Create: `tools/render_vehicle.py`
- Rewrite: `tools/render_eitan.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class VehicleSpec` with fields `src`, `out_hull`, `out_turr`, `turret_meshes` (`set[str]`), `scale` (float), `credit` (str), `hull_unit` (str), `turret_unit` (str), `backdrop_prefix` (str or `None`), `strip_source_lights` (bool, default `False`), `wreck_turret_yaw_deg` (float), `wreck_turret_pitch_deg` (float), `wreck_pitch_deg` (float), `wreck_sink` (float).
  - `def render_vehicle(spec: VehicleSpec) -> None` — does the whole job for one vehicle.

  Task 3 constructs a `VehicleSpec` and calls `render_vehicle`.

**Background the implementer needs:** read `tools/render_eitan.py` first — it is the code being extracted, and every function below is lifted from it with the hardcoded constants replaced by `spec` fields. Two behaviours in it are load-bearing and easy to break:

1. `o.matrix_parent_inverse = Matrix.Translation(-center)` is deliberate, with a comment explaining why. `pivot.matrix_world` is still identity at that point because the depsgraph has not been evaluated since `pivot.location` was set, so inverting it would be a no-op and parenting would shift the model by `+center`. Keep it exactly as written.
2. Hull and turret share **one** radius and **one** camera. That is what makes the turret sprite register over the hull as it traverses. Do not compute bounds per-pass.

- [ ] **Step 1: Create the shared module**

Create `tools/render_vehicle.py`:

```python
"""Shared machinery for rendering a vehicle as hull + turret sprite sheets.

Two passes over one model, sharing a single pivot and camera so the turret
sprite registers exactly over the hull as it traverses. Computing bounds per
pass would scale the two differently and the weapon station would drift.

Cycles output is not on-palette and has soft alpha, so a render must always be
followed by the quantizer or `pnpm validate:assets` rejects every frame:

    blender --background --python tools/render_<vehicle>.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

.blend sources are gitignored (too large to track). Provenance travels in each
vehicle script's CREDIT string and the `credit` field written into every
manifest.
"""
import json
import math
import os
from dataclasses import dataclass

import bpy
from mathutils import Matrix, Vector

SIZE = 256
FACINGS = 16
SAMPLES = 64
DIMETRIC_ELEVATION = math.atan(0.5)


@dataclass
class VehicleSpec:
    """Everything that differs between one vehicle and another."""

    src: str
    out_hull: str
    out_turr: str
    turret_meshes: set
    scale: float
    credit: str
    hull_unit: str
    turret_unit: str
    # Some source files ship a studio backdrop; rendering it fills the frame.
    backdrop_prefix: "str | None" = None
    # Remove any camera and lights the source file ships, so only this rig's
    # two lights illuminate the model. Defaults OFF: the truck source ships a
    # Sun that contributes real light to the committed Eitan sheets, and
    # stripping it changes 12 of its 48 frames. Turn it on per vehicle only
    # after checking a test render actually needs it.
    strip_source_lights: bool = False
    # How the wreck is posed: weapon station knocked askew, hull settled.
    wreck_turret_yaw_deg: float = 34.0
    wreck_turret_pitch_deg: float = 11.0
    wreck_pitch_deg: float = 4.0
    wreck_sink: float = 0.25


def scene_meshes(spec):
    """Real vehicle meshes -- backdrop planes excluded."""
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if spec.backdrop_prefix and o.name.startswith(spec.backdrop_prefix):
            continue
        out.append(o)
    return out


def _shader(name, colour, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def flat_material():
    """One flat olive material. A model's own materials are off-palette and the
    quantizer would snap them somewhere arbitrary."""
    return _shader("VehicleOlive", (0.28, 0.30, 0.20, 1.0), 0.85)


def burnt_material():
    """Wreckage: the same hull, burnt out. Dark enough to read as destroyed at
    64px without leaving the palette's gunmetal band."""
    return _shader("VehicleBurnt", (0.09, 0.09, 0.08, 1.0), 0.95)


def setup(spec):
    """Load the model, build the shared pivot and camera, return the pieces."""
    bpy.ops.wm.open_mainfile(filepath=spec.src)

    meshes = scene_meshes(spec)
    if spec.backdrop_prefix:
        for o in bpy.data.objects:
            if o.type == "MESH" and o.name.startswith(spec.backdrop_prefix):
                o.hide_render = True

    # A source file may ship its own camera and lights. Whether to remove them
    # is per-vehicle: the truck's Sun contributes usefully to the Eitan sheets,
    # so this defaults off and is opted into only where a test render shows the
    # source lighting spoils the result.
    if spec.strip_source_lights:
        for o in [o for o in bpy.data.objects if o.type in {"CAMERA", "LIGHT"}]:
            bpy.data.objects.remove(o, do_unlink=True)

    olive = flat_material()
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(olive)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    # Source files carry their own percentage; DMM08 ships 50, which would
    # silently halve every sheet.
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    sc.world = world

    key = bpy.data.lights.new("Key", type="SUN")
    key.energy = 4.0
    key_obj = bpy.data.objects.new("Key", key)
    bpy.context.collection.objects.link(key_obj)
    key_obj.rotation_euler = (math.pi / 2 - math.radians(55), 0, math.radians(135))

    fill = bpy.data.lights.new("Fill", type="SUN")
    fill.energy = 0.35
    fill.color = (0.66, 0.77, 0.82)
    fill.angle = math.radians(60)
    fill_obj = bpy.data.objects.new("Fill", fill)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(35), 0, math.radians(135) + math.pi)

    # Bounds from the vehicle only, so a backdrop cannot inflate the frame.
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        eo = o.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            pts.append(eo.matrix_world @ v.co)
        eo.to_mesh_clear()
    xs = sorted(p.x for p in pts)
    ys = sorted(p.y for p in pts)
    zs = sorted(p.z for p in pts)
    mid = len(pts) // 2
    center = Vector((xs[mid], ys[mid], zs[mid]))
    dists = sorted((p - center).length for p in pts)
    # Hull and turret share this radius and one camera. Widening one alone
    # would shrink it relative to the other and break registration.
    radius = max(dists[-1], 0.001)
    print(f"Bounds: center={center}, radius={radius:.2f} ({len(pts)} verts)")

    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)
    for o in meshes:
        o.parent = pivot
        # pivot.matrix_world is still identity -- the depsgraph has not been
        # evaluated since pivot.location was set -- so inverting it would be a
        # no-op and parenting would shift the model by +center.
        o.matrix_parent_inverse = Matrix.Translation(-center)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    az = math.radians(225)
    dist = radius * 6
    horiz = math.cos(DIMETRIC_ELEVATION) * dist
    cam.location = (
        center.x + horiz * math.cos(az),
        center.y + horiz * math.sin(az),
        center.z + math.sin(DIMETRIC_ELEVATION) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIMETRIC_ELEVATION, 0, az + math.pi / 2)
    cam_data.ortho_scale = radius * 2.0 * 1.15

    turret = [o for o in meshes if o.name in spec.turret_meshes]
    hull = [o for o in meshes if o.name not in spec.turret_meshes]
    missing = spec.turret_meshes - {o.name for o in turret}
    if missing:
        raise SystemExit(f"turret meshes not found in the model: {sorted(missing)}")
    print(f"Hull meshes: {len(hull)}, turret meshes: {len(turret)}")
    return pivot, hull, turret, olive


def render_clip(pivot, show, hide, out_dir, clip, files):
    """Render one clip's 16 facings into out_dir, appending to `files`."""
    os.makedirs(out_dir, exist_ok=True)
    for o in show:
        o.hide_render = False
    for o in hide:
        o.hide_render = True
    base_z = pivot.rotation_euler.z
    step = 2.0 * math.pi / FACINGS
    sc = bpy.context.scene
    for f in range(FACINGS):
        pivot.rotation_euler.z = base_z + f * step
        name = f"{clip}_f{f:02d}_000.png"
        sc.render.filepath = os.path.join(out_dir, name)
        bpy.ops.render.render(write_still=True)
        files.append({"clip": clip, "facing": f, "frame": 0, "file": name})
        print(f"  {clip} {f + 1}/{FACINGS}")
    pivot.rotation_euler.z = base_z


def write_manifest(spec, out_dir, unit, clips, files, layer=None):
    """The manifest is the renderer's only source of truth for this sheet.

    facingOffset and facingReverse describe how this rig lays frames out. They
    are constants, emitted here rather than measured off the images by eye --
    but they are not derived, so a change to the rig means changing them.

    `layer` marks a sheet as a composite drawn onto another rather than a unit
    in its own right. The art gate reads it to skip the fill and silhouette
    checks, which ask "does this read as a unit at gameplay zoom" -- a question
    a bare weapon station cannot answer meaningfully. Without it the turret
    sheet fails on fill, because a turret alone really is under 1% of frame.
    """
    manifest = {
        "unit": unit,
        "credit": spec.credit,
        "facings": FACINGS,
        "size": SIZE,
        "facingOffset": 5,
        "facingReverse": True,
        "scale": spec.scale,
        "clips": clips,
        "files": files,
    }
    if layer:
        manifest["layer"] = layer
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)


def render_vehicle(spec):
    """Render one vehicle's hull (idle + wreck) and turret (idle) sheets."""
    pivot, hull, turret, olive = setup(spec)

    hull_files = []
    render_clip(pivot, hull, turret, spec.out_hull, "idle", hull_files)

    # Wreck: settled on its axles, tipped, weapon station knocked askew and
    # burnt out. The renderer draws only the hull's wreck clip and hides the
    # turret sprite, so the destroyed weapon station has to be baked in here.
    burnt = burnt_material()
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    for o in turret:
        o.rotation_euler.z += math.radians(spec.wreck_turret_yaw_deg)
        o.rotation_euler.x += math.radians(spec.wreck_turret_pitch_deg)
    pivot.rotation_euler.x += math.radians(spec.wreck_pitch_deg)
    pivot.location.z -= spec.wreck_sink
    render_clip(pivot, hull + turret, [], spec.out_hull, "wreck", hull_files)
    pivot.rotation_euler.x -= math.radians(spec.wreck_pitch_deg)
    pivot.location.z += spec.wreck_sink
    for o in turret:
        o.rotation_euler.z -= math.radians(spec.wreck_turret_yaw_deg)
        o.rotation_euler.x -= math.radians(spec.wreck_turret_pitch_deg)
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(olive)

    write_manifest(
        spec,
        spec.out_hull,
        spec.hull_unit,
        {
            "idle": {"frames": 1, "fps": 0, "loop": False},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        hull_files,
    )

    turr_files = []
    render_clip(pivot, turret, hull, spec.out_turr, "idle", turr_files)
    write_manifest(
        spec,
        spec.out_turr,
        spec.turret_unit,
        {"idle": {"frames": 1, "fps": 0, "loop": False}},
        turr_files,
        layer="turret",
    )

    print(f"DONE {FACINGS * 3} frames -> {spec.out_hull}, {spec.out_turr}")
```

- [ ] **Step 2: Rewrite the Eitan script as a config**

Replace the whole contents of `tools/render_eitan.py` with:

```python
"""Render the Eitan APC as separate hull and turret sprite sheets.

Output:
  assets/sprites/EITAN_HULL/idle_f{facing}_000.png    (16 facings)
  assets/sprites/EITAN_HULL/wreck_f{facing}_000.png   (16 facings)
  assets/sprites/EITAN_TURR/idle_f{facing}_000.png    (16 facings)

Must be followed by the quantizer, or `pnpm validate:assets` rejects every
frame:

    blender --background --python tools/render_eitan.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/LPMAC_military_truck.blend (gitignored -- .blend sources are
too large to track; see .gitignore)
LICENCE UNVERIFIED -- downloaded without licence, readme or attribution.
Do not redistribute until the terms are established.
"""
import os
import sys

# Blender's --python does not put the script's own directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/LPMAC_military_truck.blend"),
    out_hull=os.path.abspath("assets/sprites/EITAN_HULL"),
    out_turr=os.path.abspath("assets/sprites/EITAN_TURR"),
    # The traversing weapon station. Everything else is hull.
    turret_meshes={"turret high", "gun high", "turret mantlet high"},
    # How many tiles wide the sprite draws. The tank is 1.8; an Eitan is a
    # little shorter than a Merkava.
    scale=1.6,
    credit="LPMAC military truck. LICENCE UNVERIFIED, see tools/render_eitan.py",
    hull_unit="eitan_apc_hull",
    turret_unit="eitan_apc_turret",
    # Studio backdrop, 134 units long. Rendering it fills the entire frame.
    backdrop_prefix="Plane",
)

render_vehicle(SPEC)
```

The `sys.path.insert` is required: Blender's `--python` does not put the
script's own directory on `sys.path`, so a bare `from render_vehicle import ...`
fails with `ModuleNotFoundError`.

- [ ] **Step 3: Re-render the Eitan into a scratch directory**

Do **not** render over the committed sheets. Temporarily point the spec at a
scratch path by running with an override:

```bash
mkdir -p /tmp/eitan-check
cat > /tmp/eitan_check.py <<'PY'
import os, sys
sys.path.insert(0, os.path.abspath("tools"))
from render_vehicle import VehicleSpec, render_vehicle
render_vehicle(VehicleSpec(
    src=os.path.abspath("art/src/LPMAC_military_truck.blend"),
    out_hull="/tmp/eitan-check/EITAN_HULL",
    out_turr="/tmp/eitan-check/EITAN_TURR",
    turret_meshes={"turret high", "gun high", "turret mantlet high"},
    scale=1.6,
    credit="LPMAC military truck. LICENCE UNVERIFIED, see tools/render_eitan.py",
    hull_unit="eitan_apc_hull",
    turret_unit="eitan_apc_turret",
    backdrop_prefix="Plane",
))
PY
/Applications/Blender.app/Contents/MacOS/Blender --background --python /tmp/eitan_check.py
python3 tools/quantize_sprites.py --sprites /tmp/eitan-check
```

If `art/src/LPMAC_military_truck.blend` is absent (it is gitignored, so a fresh
clone will not have it), report **BLOCKED** and stop — the refactor cannot be
verified without it, and shipping an unverified refactor of a working pipeline
is not acceptable.

- [ ] **Step 4: Compare against the committed sheets**

Byte-identical output is the hoped-for result but is **not** the pass condition:
Cycles with denoising is not guaranteed reproducible to the byte.

```bash
python3 - <<'PY'
from PIL import Image, ImageChops
import glob, os, sys
bad = []
for new in sorted(glob.glob("/tmp/eitan-check/*/*.png")):
    old = new.replace("/tmp/eitan-check/", "assets/sprites/")
    if not os.path.exists(old):
        bad.append(f"{new}: no committed counterpart at {old}")
        continue
    a = Image.open(old).convert("RGBA")
    b = Image.open(new).convert("RGBA")
    if a.size != b.size:
        bad.append(f"{os.path.basename(new)}: size {a.size} vs {b.size}")
        continue
    am = a.split()[3].point(lambda v: 255 if v > 128 else 0)
    bm = b.split()[3].point(lambda v: 255 if v > 128 else 0)
    if list(am.getdata()) != list(bm.getdata()):
        diff = sum(1 for x, y in zip(am.getdata(), bm.getdata()) if x != y)
        bad.append(f"{os.path.basename(new)}: alpha mask differs in {diff} px")
        continue
    d = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    mean = sum(sum(c) for c in d.getdata()) / (3.0 * a.size[0] * a.size[1])
    if mean > 2.0:
        bad.append(f"{os.path.basename(new)}: mean pixel diff {mean:.2f}")
print(f"compared {len(glob.glob('/tmp/eitan-check/*/*.png'))} frames")
for b in bad:
    print("  MISMATCH", b)
sys.exit(1 if bad else 0)
PY
```

Expected: `compared 48 frames` and no MISMATCH lines.

If frames mismatch, report **BLOCKED** with the list rather than adjusting the
comparison thresholds to pass. A refactor that changes the output has changed
behaviour, and the whole point of this step is to catch that.

- [ ] **Step 5: Confirm the committed sheets and gates are untouched**

```bash
git status --short assets/sprites
pnpm validate:assets
pnpm test && pnpm test:determinism && pnpm lint
```
Expected: `git status` shows no changes under `assets/sprites`, and all gates pass.

- [ ] **Step 6: Commit**

```bash
git add tools/render_vehicle.py tools/render_eitan.py
git commit -m "refactor(tools): extract the shared vehicle sprite renderer

render_eitan.py and a second vehicle script would be about 95% identical, and
there are already five render_*.py scripts with overlap.

The shared module holds the materials, scene setup, dimetric camera and pivot,
the per-clip render loop and manifest writing, driven by a VehicleSpec.
render_eitan.py becomes a config.

Verified by re-rendering the Eitan through the shared path and comparing all
48 frames against the committed sheets: identical dimensions, identical binary
alpha masks, mean pixel difference under 2/255. The extraction changed nothing.

Also folded in what a second source file needs. resolution_percentage is forced
to 100, because a .blend can carry its own and DMM08 ships 50, which would
silently halve every sheet. Removal of a source file's own camera and lights is
available as strip_source_lights but defaults OFF, because the truck's Sun
contributes real light to the committed Eitan sheets: stripping it changes 12 of
48 frames, so it is opted into per vehicle after a test render, not applied
blanket."
```

---

### Task 2: Place the source asset and its licence

**Files:**
- Place (untracked): `art/src/ifv_dmm08.blend`
- Create: `art/src/ifv_dmm08_LICENSE.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `art/src/ifv_dmm08.blend` on disk for Task 3 to render.

- [ ] **Step 1: Extract the zip**

```bash
mkdir -p art/src
unzip -o '/Users/ilpinto/Downloads/VEHICLE IFV DMM08.zip' -d /tmp/ifv-src
ls -la /tmp/ifv-src
```
Expected three files: `IVFDMM08.blend`, `preview_75225.jpg`, and
`75225 - VEHICLE IFV DMM08 - License.html`.

- [ ] **Step 2: Place the blend under its project name**

```bash
cp /tmp/ifv-src/IVFDMM08.blend art/src/ifv_dmm08.blend
cp '/tmp/ifv-src/75225 - VEHICLE IFV DMM08 - License.html' art/src/ifv_dmm08_LICENSE.html
```

- [ ] **Step 3: Verify git ignores the blend and tracks the licence**

```bash
git status --short art/src
git check-ignore -v art/src/ifv_dmm08.blend
```
Expected: `check-ignore` reports `.gitignore:19:art/src/*.blend`, and
`git status` offers only `art/src/ifv_dmm08_LICENSE.html` as new.

If the `.blend` appears as untracked-and-addable, stop — the gitignore is not
matching and committing a 25MB binary is exactly what it exists to prevent.

- [ ] **Step 4: Commit the licence only**

```bash
git add art/src/ifv_dmm08_LICENSE.html
git commit -m "art: licence for the DMM08 IFV source model

VEHICLE IFV DMM08 by Mutte, BlendSwap #75225, CC-BY 3.0 -- any purpose,
attribution required. CONTRIBUTING.md accepts CC-BY with a credit line.

The first source model in this repo that arrived with its terms. The .blend
itself is gitignored as too large to track, so the licence page travels here
and the attribution is repeated in the render script and every manifest."
```

---

### Task 3: Render the Namer sheets

**Files:**
- Create: `tools/render_namer.py`
- Create: `assets/sprites/NAMER_HULL/` (16 `idle` + 16 `wreck` + `manifest.json`)
- Create: `assets/sprites/NAMER_TURR/` (16 `idle` + `manifest.json`)

**Interfaces:**
- Consumes: `VehicleSpec` and `render_vehicle` from `tools/render_vehicle.py` (Task 1); `art/src/ifv_dmm08.blend` (Task 2).
- Produces: the two sheet directories that Task 4 wires up.

**Mesh names, verified by probing the file:** hull is `BODY`, `EIXO1`, `EIXO2`, `EIXO3`, `STEP`; turret is `TURRENT_BODY`, `CANNON`, `CANNON_BASE`, `REMOT_BODY`, `REMOT_GUN`. Note `TURRENT_BODY` is spelled that way in the model — it is not a typo to fix. There is **no** backdrop mesh in this file, so `backdrop_prefix` stays `None`.

- [ ] **Step 1: Write the config**

Create `tools/render_namer.py`:

```python
"""Render the Namer IFV as separate hull and turret sprite sheets.

Output:
  assets/sprites/NAMER_HULL/idle_f{facing}_000.png    (16 facings)
  assets/sprites/NAMER_HULL/wreck_f{facing}_000.png   (16 facings)
  assets/sprites/NAMER_TURR/idle_f{facing}_000.png    (16 facings)

Must be followed by the quantizer, or `pnpm validate:assets` rejects every
frame:

    blender --background --python tools/render_namer.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/ifv_dmm08.blend (gitignored -- .blend sources are too large to
track; see .gitignore). Licence page committed at
art/src/ifv_dmm08_LICENSE.html.

LICENCE: VEHICLE IFV DMM08 by Mutte, BlendSwap #75225, Creative Commons
Attribution 3.0. Any purpose, attribution required.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/ifv_dmm08.blend"),
    out_hull=os.path.abspath("assets/sprites/NAMER_HULL"),
    out_turr=os.path.abspath("assets/sprites/NAMER_TURR"),
    # The cannon turret and the secondary remote station traverse together.
    # "TURRENT" is the model's own spelling.
    turret_meshes={
        "TURRENT_BODY",
        "CANNON",
        "CANNON_BASE",
        "REMOT_BODY",
        "REMOT_GUN",
    },
    # This model is in real metres and measures 6.92m long. The tank draws at
    # 1.8 and the Eitan at 1.6.
    scale=1.7,
    credit="Mutte (CC-BY 3.0, BlendSwap #75225)",
    hull_unit="namer_ifv_hull",
    turret_unit="namer_ifv_turret",
    # No studio backdrop in this file.
    backdrop_prefix=None,
)

render_vehicle(SPEC)
```

- [ ] **Step 2: Render**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_namer.py 2>&1 | tail -20
```
Expected: `Hull meshes: 5, turret meshes: 5`, then progress to
`DONE 48 frames -> …NAMER_HULL, …NAMER_TURR`.

If it exits with `turret meshes not found in the model`, the mesh names differ
from the list above — print the actual names and report **NEEDS_CONTEXT** rather
than guessing at a mapping.

- [ ] **Step 2a: Check the exposure before rendering all 48 frames**

This source ships its own `Camera`, `Sun` and two `Hemi` lights. Whether they
help or hurt is a per-model question, and `strip_source_lights` defaults to
`False`, so the first render keeps them.

Look at one rendered frame — `assets/sprites/NAMER_HULL/idle_f00_000.png` —
before going further. If the hull is blown out, flat, or lit from an obviously
wrong direction, set `strip_source_lights=True` in the spec, re-render, and
compare. Keep whichever reads better and record which you chose and why in your
report.

Do not skip this by reasoning about it. The plan already got this wrong once by
assuming source lights must be removed; the truck source proved otherwise.

- [ ] **Step 3: Quantize to the palette**

```bash
python3 tools/quantize_sprites.py --sprites assets/sprites
```
This is mandatory. Cycles output is off-palette with soft alpha, and the art
gate rejects every frame without it.

- [ ] **Step 4: Verify the art gate, and check the numbers the spec predicted**

```bash
pnpm validate:assets
```
Expected: pass, with the unit count risen by one (`NAMER_HULL` is a unit;
`NAMER_TURR` declares `layer` and is skipped).

Then confirm fill and silhouette separation match what the spec predicted:

```bash
python3 - <<'PY'
from PIL import Image
import itertools
Z = 64
sheets = {
    "NAMER": "assets/sprites/NAMER_HULL/idle_f00_000.png",
    "EITAN": "assets/sprites/EITAN_HULL/idle_f00_000.png",
    "TNK":   "assets/sprites/TNK_HULL/f00_000.png",
}
def sil(p):
    im = Image.open(p).convert("RGBA").resize((Z, Z), Image.LANCZOS)
    return im.split()[3].point(lambda v: 255 if v > 128 else 0).convert("1")
s = {k: sil(v) for k, v in sheets.items()}
fill = sum(1 for v in s["NAMER"].getdata() if v) / float(Z * Z)
print(f"NAMER fill {fill:.1%}  (gate floor 6%; spec predicted 22.2%)")
def iou(a, b):
    pa, pb = list(a.getdata()), list(b.getdata())
    i = sum(1 for x, y in zip(pa, pb) if x and y)
    u = sum(1 for x, y in zip(pa, pb) if x or y)
    return i / u if u else 0.0
for a, b in itertools.combinations(s, 2):
    print(f"  {a} vs {b}: IoU {iou(s[a], s[b]):.3f}  (limit 0.88)")
PY
```
Expected: fill comfortably above 6%, and every IoU below 0.88. The spec
predicted 0.525 against the Eitan from a preview render; the real figure may
differ, and only exceeding 0.88 is a problem.

- [ ] **Step 5: Commit**

```bash
git add tools/render_namer.py assets/sprites/NAMER_HULL assets/sprites/NAMER_TURR
git commit -m "feat(art): Namer IFV hull, turret and wreck sheets

Hull idle and wreck plus an independently traversing turret, 48 frames at 16
facings, rendered through the shared vehicle renderer.

Source: VEHICLE IFV DMM08 by Mutte, BlendSwap #75225, CC-BY 3.0 -- the first
source model here that came with its licence. Attribution is carried in the
script header and the credit field of both manifests.

Scale 1.7 by measurement rather than by eye: the model is in real metres and
is 6.92m long, against the tank at 1.8 and the Eitan at 1.6.

The turret manifest declares layer: turret so the art gate skips its fill and
silhouette checks -- a bare weapon station is under 1% of frame and would
otherwise fail a test that asks whether it reads as a unit."
```

---

### Task 4: Wire the Namer into the app

**Files:**
- Modify: `packages/app/src/main.ts` (the `SPRITE_MAP` block, near line 292)

**Interfaces:**
- Consumes: `assets/sprites/NAMER_HULL/` and `NAMER_TURR/` from Task 3.
- Produces: `ifv_namer` renders as a vehicle in the running game.

**Background:** the existing block defines `type SpriteSpec = { path: string; turretPath?: string }` and an `EITAN` constant of that shape, then maps unit ids to specs. Everything else — facing convention, scale, clips — comes from the manifests, so this is genuinely one entry.

- [ ] **Step 1: Add the sprite spec**

In `packages/app/src/main.ts`, beside the existing `EITAN` constant, add:

```ts
  const NAMER: SpriteSpec = {
    path: `${BASE}sprites/NAMER_HULL/`,
    turretPath: `${BASE}sprites/NAMER_TURR/`,
  };
```

and add to `SPRITE_MAP`:

```ts
    ifv_namer: NAMER,
```

- [ ] **Step 2: Verify it compiles and nothing regressed**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:assets && pnpm build
```
Expected: all pass, determinism hash unchanged.

- [ ] **Step 3: Verify in the running app**

Start the preview and load `M0 sandbox (no mission)`. Two Namers spawn at tiles
(3,16) and (3,30).

Confirm in the browser console that the sheets loaded and the turret is a
separate atlas:

```js
const rd = window.__lions.renderer;
const a = rd.spriteAtlas.get('ifv_namer');
JSON.stringify({
  clips: a ? Object.keys(a.textures) : null,
  hasTurret: !!(a && a.turretTextures),
  scale: a ? a.sheet.scale : null,
});
```
Expected: clips include `idle` and `wreck`, `hasTurret` is `true`, scale is
`1.7`.

Then look at one with your own eyes: centre the camera on a Namer, take a
screenshot, and confirm it draws as a wheeled vehicle rather than a procedural
polygon. Give it a target so the turret traverses, and confirm the turret sprite
stays registered over the hull rather than drifting off-centre.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main.ts
git commit -m "feat(app): the Namer draws as a vehicle, not a polygon

One SPRITE_MAP entry. Facing convention, scale and clips all come from the
manifests, and the renderer already handles clip resolution, independent
turret traverse, wreck spawning, power-scaled recoil and the muzzle VFX -- the
Namer inherits all of it by having a sheet.

Its cannon_30 is weapon class autocannon, so it picks up the fire_autocannon
emitter with no extra wiring."
```

---

## Verification checklist

Run before declaring the feature complete:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm test:determinism   # hash MUST be 484379662 — nothing here touches the sim
pnpm validate:data
pnpm validate:assets
pnpm build
```

And by eye, in the M0 sandbox:

- A Namer reads as a wheeled IFV, distinct at a glance from both the Eitan and the tank.
- Its turret traverses onto a target and stays centred on the hull.
- A destroyed Namer leaves burnt wreckage, not the grey X marker.
- Firing produces the autocannon muzzle signature, not the generic puff.
