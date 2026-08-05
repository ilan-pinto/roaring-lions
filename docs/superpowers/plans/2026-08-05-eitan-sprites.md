# Eitan APC Sprites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apc_eitan` real sprites — an armoured hull, an independently traversing remote weapon station, and a burnt-out wreck — replacing the procedural polygon it draws as today.

**Architecture:** One Blender script renders two sheets from one source model, sharing a single pivot and camera so the turret registers over the hull. The renderer needs no changes: clip resolution, turret traverse, wreck spawning, recoil and weapon-fire VFX already exist, so the Eitan inherits them by having a sheet at all. A defect in the silhouette gate, found while scoping, is fixed first.

**Tech Stack:** Blender 5.2 (Cycles, background mode), Python 3, TypeScript, pnpm.

## Global Constraints

- **Do not modify anything under `packages/sim`.** `pnpm test:determinism` must pass with an unchanged hash (`484379662`). This is art and presentation.
- **The source `.blend` licence is UNVERIFIED.** It is a bare download with no licence, readme or attribution. Mark it `LICENCE UNVERIFIED` in the render script header, in both manifests' `credit` field, and in the commit message — exactly as `tools/render_soldier.py` does for the infantry model.
- **Rendering is two steps.** Raw Cycles output is off-palette with soft alpha and `pnpm validate:assets` rejects it. Always follow a render with `python3 tools/quantize_sprites.py --sprites assets/sprites`.
- **Palette keys only, never raw hex, in any data file.**
- `pnpm validate:assets` must pass: palette conformance, binary alpha, silhouette fill ≥ 6% (`MIN_FILL`), pairwise silhouette IoU ≤ 0.88 (`IOU_LIMIT`).
- Commit the `.blend` to `art/src/`. CLAUDE.md forbids committing rendered sprites without their source.

## Source model facts

`/Users/ilpinto/Downloads/LPMAC_military truck.blend`, 54 MB, 26 meshes, 315k faces, **no armature and no actions**.

**Backdrop meshes to exclude — `Plane`, `Plane.001`, `Plane.002`, `Plane.003`.** These are studio backdrop geometry spanning 134 units; including them fills the entire frame. Every real vehicle mesh has a name ending `high`.

**Turret group — exactly these three:** `turret high`, `gun high`, `turret mantlet high`. Everything else `high` is hull. Note `rotating sensor high` stays on the hull: it is a roof sensor, not part of the traversing weapon station.

The vehicle itself is about 7.5 wide × 15.2 long × 4.5 tall.

## File structure

| File | Responsibility |
|---|---|
| `tools/validate_assets.py` | Modify: `representative()` picks the right canonical sprite |
| `art/src/LPMAC_military_truck.blend` | Create: committed source for the rendered sheets |
| `tools/render_eitan.py` | Create: two-pass renderer, hull + turret sheets |
| `assets/sprites/EITAN_HULL/` | Create: 32 PNGs (idle, wreck) + manifest |
| `assets/sprites/EITAN_TURR/` | Create: 16 PNGs (idle) + manifest |
| `packages/app/src/main.ts` | Modify: one `SPRITE_MAP` entry |

---

### Task 1: Fix the silhouette gate's sprite selection

**Files:**
- Modify: `tools/validate_assets.py` (the `representative()` function)
- Create: `tools/test_representative.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `representative(sprites: list[str]) -> dict[str, str]` keeps its signature. Its behaviour changes: it now understands `<clip>_f<NN>_<FFF>.png` and prefers the `idle` clip.

**Why this exists:** `representative()` selects one canonical sprite per unit by looking for a filename starting `f00_000`. The clip migration renamed infantry files to `<clip>_f00_000.png`, so no infantry file matches and it falls back to whatever sorts first — `down_f00_000.png`. The gate CLAUDE.md calls "the single check" against two units reading alike is comparing a **crouched** soldier to a tank hull.

- [ ] **Step 1: Write the failing test**

Create `tools/test_representative.py`:

```python
"""Canonical-sprite selection for the silhouette gate.

Run: python3 tools/test_representative.py
Exits non-zero on failure. Deliberately dependency-free -- the repo's test
runner is vitest, and adding pytest for one tool would be heavier than the
thing it tests.
"""
import importlib.util
import os
import sys

spec = importlib.util.spec_from_file_location(
    "va", os.path.join(os.path.dirname(__file__), "validate_assets.py")
)
va = importlib.util.module_from_spec(spec)
spec.loader.exec_module(va)

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")


# A clip-format sheet must resolve to its idle, not to whatever sorts first.
# 'down' sorts before 'idle' alphabetically, which is exactly the bug.
clipped = [
    "assets/sprites/EITAN_HULL/down_f00_000.png",
    "assets/sprites/EITAN_HULL/idle_f00_000.png",
    "assets/sprites/EITAN_HULL/idle_f03_000.png",
    "assets/sprites/EITAN_HULL/wreck_f00_000.png",
]
check(
    "clip sheet prefers idle facing 00",
    va.representative(clipped)["EITAN_HULL"],
    "assets/sprites/EITAN_HULL/idle_f00_000.png",
)

# A legacy flat sheet must still resolve to f00_000.
legacy = [
    "assets/sprites/TNK_HULL/f05_000.png",
    "assets/sprites/TNK_HULL/f00_000.png",
    "assets/sprites/TNK_HULL/f11_000.png",
]
check(
    "legacy sheet prefers f00_000",
    va.representative(legacy)["TNK_HULL"],
    "assets/sprites/TNK_HULL/f00_000.png",
)

# Mixed units in one list must not contaminate each other.
mixed = clipped + legacy
reps = va.representative(mixed)
check("mixed: clip unit", reps["EITAN_HULL"], "assets/sprites/EITAN_HULL/idle_f00_000.png")
check("mixed: legacy unit", reps["TNK_HULL"], "assets/sprites/TNK_HULL/f00_000.png")

# A clip sheet with no idle is an authoring error and must raise, not
# silently measure the wrong pose.
try:
    va.representative(["assets/sprites/BROKEN/wreck_f00_000.png"])
    failures.append("no-idle sheet: expected SystemExit, got none")
except SystemExit:
    pass

if failures:
    for f in failures:
        print("FAIL", f)
    sys.exit(1)
print(f"representative(): {4 + 1} checks passed")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 tools/test_representative.py`
Expected: FAIL on "clip sheet prefers idle facing 00" — it returns `down_f00_000.png` — and on the no-idle case, which currently returns a dict instead of raising.

- [ ] **Step 3: Replace `representative()`**

In `tools/validate_assets.py`, replace the whole `representative` function with:

```python
# Sprite filenames are either legacy flat -- f<NN>_<FFF>.png -- or
# clip-prefixed -- <clip>_f<NN>_<FFF>.png. The clip migration introduced the
# second form, and this function used to recognise only the first.
SPRITE_RE = re.compile(r"^(?:(?P<clip>[a-z_]+)_)?f(?P<facing>\d{2})_(?P<frame>\d{3})\.png$")


def representative(sprites):
    """One canonical sprite per unit -- the idle pose at facing 00, frame 000.

    The silhouette check asks "do two units read as the same thing at
    gameplay zoom", so it has to compare like with like. Comparing one unit's
    idle against another's crouch answers a question nobody asked.
    """
    best = {}
    seen_clipped = set()
    for p in sorted(sprites):
        unit = os.path.basename(os.path.dirname(p))
        m = SPRITE_RE.match(os.path.basename(p))
        if not m:
            best.setdefault(unit, p)
            continue
        clip = m.group("clip")
        canonical = m.group("facing") == "00" and m.group("frame") == "000"
        if clip:
            seen_clipped.add(unit)
            if clip == "idle" and canonical:
                best[unit] = p
                continue
        elif canonical:
            best[unit] = p
            continue
        best.setdefault(unit, p)

    for unit in seen_clipped:
        chosen = os.path.basename(best[unit])
        if not chosen.startswith("idle_f00_000"):
            sys.exit(
                f"{unit}: sheet uses clip-prefixed names but has no "
                f"idle_f00_000.png. The silhouette gate has nothing canonical "
                f"to compare and would otherwise measure an arbitrary pose."
            )
    return best
```

Add `import re` to the imports at the top of the file. `sys` is already imported (line 33); `re` is not.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 tools/test_representative.py`
Expected: PASS, "representative(): 5 checks passed".

- [ ] **Step 5: Confirm the real gate now compares idle poses**

Run:

```bash
python3 -c "
import importlib.util
spec=importlib.util.spec_from_file_location('va','tools/validate_assets.py')
va=importlib.util.module_from_spec(spec); spec.loader.exec_module(va)
reps=va.representative(va.sprite_paths('assets/sprites'))
reps={u:p for u,p in reps.items() if not va.is_layer(p)}
for u,p in reps.items(): print(u, '->', p.split('/')[-1])
"
```

Expected: `INF -> idle_f00_000.png` (previously `down_f00_000.png`) and `TNK_HULL -> f00_000.png`.

- [ ] **Step 6: Confirm the gate still passes**

Run: `pnpm validate:assets`
Expected: PASS. The IoU between an idle soldier and a tank hull is well under 0.88.

- [ ] **Step 7: Commit**

```bash
git add tools/validate_assets.py tools/test_representative.py
git commit -m "fix(tools): silhouette gate compared a crouching soldier to a tank"
```

---

### Task 2: Render the Eitan sheets

**Files:**
- Create: `art/src/LPMAC_military_truck.blend`
- Create: `tools/render_eitan.py`
- Create: `assets/sprites/EITAN_HULL/` (32 PNGs + `manifest.json`)
- Create: `assets/sprites/EITAN_TURR/` (16 PNGs + `manifest.json`)

**Interfaces:**
- Consumes: Task 1's fixed gate, which will validate these sheets.
- Produces: two sheets whose manifests declare `facingOffset`, `facingReverse`, `scale`, `credit` and a `clips` block. Task 3 points `SPRITE_MAP` at them.

**Pattern to follow:** `tools/render_tank.py` already does two-pass hull/turret rendering with a shared pivot and camera — read it first. The differences: this model has no armature, so turret classification is by mesh name rather than bone parenting; and the manifest uses the newer clip format from `tools/render_soldier.py` rather than the legacy `frames` field.

- [ ] **Step 1: Copy the source model into the repo**

```bash
cp "/Users/ilpinto/Downloads/LPMAC_military truck.blend" art/src/LPMAC_military_truck.blend
```

The space in the original filename becomes an underscore — a space in a path is a foot-gun in shell scripts and Blender CLI invocations.

- [ ] **Step 2: Write the render script**

Create `tools/render_eitan.py`:

```python
"""Render the Eitan APC as separate hull and turret sprite sheets.

  - Hull pass:   everything except the weapon station
  - Turret pass: turret, gun and mantlet only

Both passes share one pivot and one camera, so the turret sprite registers
exactly over the hull sprite as it traverses. Widening one without the other
would make the weapon station drift off-centre.

Output:
  assets/sprites/EITAN_HULL/idle_f{facing}_000.png    (16 facings)
  assets/sprites/EITAN_HULL/wreck_f{facing}_000.png   (16 facings)
  assets/sprites/EITAN_TURR/idle_f{facing}_000.png    (16 facings)

Cycles output is not on-palette and has soft alpha, so this must be followed
by the quantizer or `pnpm validate:assets` will reject every frame:

    blender --background --python tools/render_eitan.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/LPMAC_military_truck.blend
LICENCE UNVERIFIED -- downloaded without licence, readme or attribution.
Do not redistribute until the terms are established.
"""
import json
import math
import os

import bpy
from mathutils import Matrix, Vector

SRC = os.path.abspath("art/src/LPMAC_military_truck.blend")
OUT_HULL = os.path.abspath("assets/sprites/EITAN_HULL")
OUT_TURR = os.path.abspath("assets/sprites/EITAN_TURR")

SIZE = 256
FACINGS = 16
SAMPLES = 64
DIMETRIC_ELEVATION = math.atan(0.5)

# How many tiles wide the sprite draws. The tank is 1.8; an Eitan is a little
# shorter than a Merkava.
SCALE = 1.6

CREDIT = "LPMAC military truck. LICENCE UNVERIFIED, see tools/render_eitan.py"

# The traversing weapon station. Everything else is hull.
TURRET_MESHES = {"turret high", "gun high", "turret mantlet high"}

# Studio backdrop, 134 units long. Rendering it fills the entire frame.
BACKDROP_PREFIX = "Plane"


def scene_meshes():
    """Real vehicle meshes -- backdrop planes excluded."""
    return [
        o
        for o in bpy.data.objects
        if o.type == "MESH" and not o.name.startswith(BACKDROP_PREFIX)
    ]


def flat_material():
    """One flat olive material. The model's own 15 materials are off-palette
    and the quantizer would snap them somewhere arbitrary."""
    mat = bpy.data.materials.new("EitanOlive")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.28, 0.30, 0.20, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def burnt_material():
    """Wreckage: the same hull, burnt out. Dark enough to read as destroyed at
    64px without leaving the palette's gunmetal band."""
    mat = bpy.data.materials.new("EitanBurnt")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.09, 0.09, 0.08, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def setup():
    """Load the model, build the shared pivot and camera, return the pieces."""
    bpy.ops.wm.open_mainfile(filepath=SRC)

    meshes = scene_meshes()
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if o.name.startswith(BACKDROP_PREFIX):
            o.hide_render = True

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

    # Bounds from the vehicle only, so the backdrop cannot inflate the frame.
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

    turret = [o for o in meshes if o.name in TURRET_MESHES]
    hull = [o for o in meshes if o.name not in TURRET_MESHES]
    missing = TURRET_MESHES - {o.name for o in turret}
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


def write_manifest(out_dir, unit, clips, files):
    """The manifest is the renderer's only source of truth for this sheet.

    facingOffset and facingReverse describe how this rig lays frames out, and
    are emitted here rather than measured off the images by eye.
    """
    manifest = {
        "unit": unit,
        "credit": CREDIT,
        "facings": FACINGS,
        "size": SIZE,
        "facingOffset": 5,
        "facingReverse": True,
        "scale": SCALE,
        "clips": clips,
        "files": files,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)


def main():
    pivot, hull, turret, olive = setup()

    hull_files = []
    render_clip(pivot, hull, turret, OUT_HULL, "idle", hull_files)

    # Wreck: settled on its axles, tipped, weapon station knocked askew and
    # burnt out. The renderer draws only the hull's wreck clip and hides the
    # turret sprite, so the destroyed weapon station has to be baked in here.
    burnt = burnt_material()
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    for o in turret:
        o.rotation_euler.z += math.radians(34)
        o.rotation_euler.x += math.radians(11)
    pivot.rotation_euler.x += math.radians(4)
    pivot.location.z -= 0.25
    render_clip(pivot, hull + turret, [], OUT_HULL, "wreck", hull_files)
    pivot.rotation_euler.x -= math.radians(4)
    pivot.location.z += 0.25
    for o in turret:
        o.rotation_euler.z -= math.radians(34)
        o.rotation_euler.x -= math.radians(11)
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(olive)

    write_manifest(
        OUT_HULL,
        "eitan_apc_hull",
        {
            "idle": {"frames": 1, "fps": 0, "loop": False},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        hull_files,
    )

    turr_files = []
    render_clip(pivot, turret, hull, OUT_TURR, "idle", turr_files)
    write_manifest(
        OUT_TURR,
        "eitan_apc_turret",
        {"idle": {"frames": 1, "fps": 0, "loop": False}},
        turr_files,
    )

    print(f"DONE {FACINGS * 3} frames -> {OUT_HULL}, {OUT_TURR}")


main()
```

- [ ] **Step 3: Render**

Run from the repo root — the script uses paths relative to it:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_eitan.py
```

Expected: `DONE 48 frames`. At 315k faces and 64 samples this takes several minutes; run it in the background and wait rather than reducing samples.

If it reports `turret meshes not found`, the model's mesh names differ from `TURRET_MESHES` — list them with a probe rather than guessing.

- [ ] **Step 4: Quantize to the palette**

```bash
python3 tools/quantize_sprites.py --sprites assets/sprites
```

Expected: it reports the EITAN files it snapped. Skipping this makes every following step fail.

- [ ] **Step 5: Run the asset gate**

Run: `pnpm validate:assets`
Expected: PASS, with the sprite count risen by 48 and the unit count by one (`EITAN_TURR` is filtered out as a composite layer).

**If the silhouette IoU fails against `TNK_HULL`**, do not raise `IOU_LIMIT` — that would admit two units that genuinely read alike. Lower `SCALE` or widen the camera's `ortho_scale` multiplier so the Eitan's proportions differ more, then re-render.

**If `MIN_FILL` fails**, the vehicle is too small in frame: reduce the `radius * 2.0 * 1.15` multiplier.

- [ ] **Step 6: Look at the result**

```bash
open assets/sprites/EITAN_HULL/idle_f00_000.png assets/sprites/EITAN_HULL/wreck_f00_000.png assets/sprites/EITAN_TURR/idle_f00_000.png
```

Confirm by eye: the hull has no turret on it, the turret sheet has no hull under it, and the wreck is visibly darker and tipped.

**On `facingOffset: 5, facingReverse: true`:** these are inherited from `render_tank.py`, which uses the same 225° camera azimuth and the same pivot rotation direction, so the frame layout should be identical. That is a reasoned expectation, not a measurement — Task 3 Step 3 checks it in the running game, where a wrong convention shows up immediately as a vehicle driving sideways or backwards. If it is wrong, correct the two manifest values rather than re-rendering: the frames are fine, only their interpretation is off.

- [ ] **Step 7: Commit**

```bash
git add art/src/LPMAC_military_truck.blend tools/render_eitan.py assets/sprites/EITAN_HULL assets/sprites/EITAN_TURR
git commit -m "feat(art): Eitan APC hull, weapon station and wreck sheets

LICENCE UNVERIFIED -- source .blend was downloaded with no licence,
readme or attribution. Marked in the script header and both manifests."
```

---

### Task 3: Wire the sheets into the game

**Files:**
- Modify: `packages/app/src/main.ts` (the `SPRITE_MAP` literal)

**Interfaces:**
- Consumes: `assets/sprites/EITAN_HULL/` and `assets/sprites/EITAN_TURR/` from Task 2, and their manifests.
- Produces: nothing later depends on.

**Why so small:** the renderer already resolves clips from sim state, traverses turrets, spawns wreckage on death, applies power-scaled recoil, and plays weapon-fire VFX. The Eitan gets all of it by having a sheet.

- [ ] **Step 1: Add the map entry**

In `packages/app/src/main.ts`, find the `SPRITE_MAP` literal (near the `TANK` and `FOOT` consts). Add beside the existing `TANK`/`FOOT` declarations:

```ts
  const EITAN: SpriteSpec = {
    path: `${BASE}sprites/EITAN_HULL/`,
    turretPath: `${BASE}sprites/EITAN_TURR/`,
  };
```

and add to the `SPRITE_MAP` object literal:

```ts
    apc_eitan: EITAN,
```

- [ ] **Step 2: Verify it compiles and nothing regressed**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:assets && pnpm build
```

Expected: all pass, determinism hash unchanged.

- [ ] **Step 3: Verify in the running app**

Start the preview and load `M0 sandbox`, then in the console:

```js
const L = window.__lions, rd = L.renderer, sim = L.sim, st = sim.state;
let e = -1;
for (let i = 0; i < sim.entityCount; i++) {
  if (st.alive[i] && sim.unitTypes[st.typeIdx[i]].id === 'apc_eitan') { e = i; break; }
}
const atlas = rd.spriteAtlas.get('apc_eitan');
JSON.stringify({
  entity: e,
  hasAtlas: !!atlas,
  clips: atlas ? Object.keys(atlas.textures) : null,
  hasTurret: atlas ? !!atlas.turretTextures : null,
  scale: atlas ? atlas.sheet.scale : null,
});
```

Expected: `hasAtlas: true`, `clips` containing `idle` and `wreck`, `hasTurret: true`, `scale: 1.6`.

Then centre the camera on it and screenshot:

```js
const f = v => v / 65536;
rd.camera.x = f(st.posX[e]); rd.camera.y = f(st.posY[e]); rd.camera.zoom = 3.0;
```

Confirm by eye: it draws as a vehicle rather than a flat polygon, and its weapon station points at whatever it is engaging rather than sitting fixed to the hull.

**Check the facing convention here.** Order it to drive east and confirm it faces the way it travels:

```js
st.facing[e] = 0;                       // 0 turns = world +x = east
sim.queueCommand({ kind: 'move', ids: [e], x: st.posX[e] + 8 * 65536, y: st.posY[e] });
```

A vehicle driving sideways or backwards means `facingOffset` or `facingReverse` in `assets/sprites/EITAN_HULL/manifest.json` is wrong. Fix the manifest values — the rendered frames are correct, only their interpretation is off — and apply the same correction to `EITAN_TURR/manifest.json`.

Then kill it and confirm the wreck:

```js
st.hp[e] = 0;
for (let n = 0; n < 6; n++) L.step(1);
```

Expected after a moment: a burnt hull on the ground, not a grey X cross. Note the collapse advances on rendered frames, so let it tick normally rather than fast-forwarding.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main.ts
git commit -m "feat(app): the Eitan draws as a vehicle, not a polygon"
```

---

## Verification checklist

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm test:determinism   # hash MUST be unchanged
pnpm validate:data
pnpm validate:assets
pnpm build
python3 tools/test_representative.py
```

And by eye in a running mission:

- The Eitan reads as an armoured vehicle at gameplay zoom, distinct from the tank.
- Its weapon station traverses toward its target independently of the hull.
- It recoils when firing and produces the `fire_hmg` muzzle signature.
- Destroying it leaves a burnt hull that persists, not a grey cross.
