# Enemy Raider Units (five sheets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author and render six new enemy sprite sheets — `INF_CHARGE`, `MOTO_RPG`, `GUNTRUCK_HULL`+`GUNTRUCK_TURR`, `PARA_MOTOR`, `DRONE_LOITER` — passing all four art-gate checks, per `docs/superpowers/specs/2026-08-11-enemy-raider-units-design.md`.

**Architecture:** Two figure-scale units extend `tools/units/teams.py` (compositions from `tools/units/kit.py`, rendered by `tools/render_team.py`). Three vehicle/air units get an author script (`tools/vehicles/author_*.py` or `tools/drones/`-style) building a tracked `.blend` in `art/src/`, plus a render script on `tools/render_vehicle.py`'s `VehicleSpec`/`render_clip` machinery. No sim, data, or renderer TypeScript changes of any kind.

**Tech Stack:** Blender headless (`/Applications/Blender.app/Contents/MacOS/Blender --background --python …`), the live Blender MCP session for visual checks, Python (pillow/numpy for gate), pnpm for repo gates.

## Global Constraints

- Branch: `feat/enemy-units-art`. **The working tree is shared with concurrent sessions**: stage explicit paths only (never `git add -A`/`-a`), and after every `git commit` confirm the `[feat/enemy-units-art <hash>]` prefix in its output — if it names another branch, stop and relocate the commit before doing anything else.
- Palette is locked (`data/palette.json`, 42 colours + reserved). No reserved `vfx`/`team` band in any static art. No new palette entries.
- Every Cycles render is off-palette until quantized: always run `python3 tools/quantize_sprites.py --sprites assets/sprites/<SHEET>` after rendering a sheet, before any gate check.
- Art gate limits: pairwise IoU < 0.88 at 64 px, MIN_FILL ≥ 6%, binary alpha, no edge-touching. The gate compares **only `idle_f00_000.png`** per sheet; `layer` sheets (turrets) are exempt from fill/silhouette.
- All geometry from `from_pydata` at real coordinates, object scale 1, every part carries `rl_role`. Lighting only from `dimetric.build_lights()`.
- `pnpm test:determinism` must end 4/4 with the golden hash **unmoved** — this plan touches no sim code.
- New sheet ids and directories exactly: `charge_squad`→`INF_CHARGE`, `moto_rpg`→`MOTO_RPG`, gun truck→`GUNTRUCK_HULL`/`GUNTRUCK_TURR`, paramotor→`PARA_MOTOR`, loitering munition→`DRONE_LOITER`.
- Blender binary path: `/Applications/Blender.app/Contents/MacOS/Blender`.
- User checkpoints: before each unit's full 16-facing render, show the user a preview (viewport screenshot or single render) and wait for approval — massing is judged before render minutes are spent.

---

### Task 1: `charge_squad` → `INF_CHARGE` (suicide squad)

**Files:**
- Modify: `tools/units/teams.py` (new helper + builder + `TEAMS` entry + clip-drop table)
- Output: `assets/sprites/INF_CHARGE/` (rendered; committed)

**One deliberate divergence from the spec:** the spec's clip table calls `INF_CHARGE`'s `down` a *crouch*. The plan uses **prone**, because `teams._standing_posture` already returns `"prone"` for `down`/`wreck` on all nine existing sheets, and a tenth team crouching where the rest go flat would read as a bug rather than as a distinction. Prone also flattens the sprint lean, which is what makes `down` differ from `idle` here at all.

**Interfaces:**
- Consumes: `kit.figure`, `kit.box`, `kit.rot_z` from `tools/units/kit.py`; `_standing_posture`, `_stride` from `teams.py`.
- Produces: `_lean_forward(parts, deg, at_x=0.0)` and `TEAM_CLIP_DROP` in `teams.py` — Task 2 uses both. `TEAMS["charge_squad"] = (charge_squad, "enemy", "INF_CHARGE")`.

- [ ] **Step 1: Add the lean helper and clip-drop table to `teams.py`**

After `_weapon_visible`, add:

```python
def _lean_forward(parts, deg, at_x=0.0):
    """Rotate finished parts forward about the ground line at x=at_x.

    A sprint lean. Applied to vertex data, never to object rotation -- the
    render rig reads vertex positions to size the frame, and an unapplied
    object rotation would report the unleaned figure (same rule as kit.rot_z).
    """
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    for ob in parts:
        me = ob.data
        for v in me.vertices:
            x, z = v.co.x - at_x, v.co.z
            v.co.x = at_x + x * c + z * s
            v.co.z = -x * s + z * c
        me.update()
    return parts


#: Clips a team's sheet deliberately omits. clipOrFallback resolves a missing
#: clip to idle in the renderer, so omission is behaviour, not a hole.
TEAM_CLIP_DROP = {}
```

And change the last line of `clips_for` from `return {"idle": idle, **BASE_CLIPS}` to:

```python
    table = {"idle": idle, **BASE_CLIPS}
    for c in TEAM_CLIP_DROP.get(team, ()):
        table.pop(c)
    return table
```

- [ ] **Step 2: Add the `charge_squad` builder and TEAMS entry**

After `atgm_cell` in `teams.py`:

```python
def charge_squad(clip, frame):
    """Suicide squad, crew 2. Both figures in a full sprint, single file, leaned
    20 degrees forward -- no other infantry sheet runs, and that posture is the
    separation from the militia cell's upright pair. No weapon parts at all:
    the missing rifle line is itself a silhouette lever. Vest bulk front and
    back in the `charge` role, one slung satchel on the trail figure."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    lean = 24.0 if clip == "fire" else 20.0
    out = []
    for i, (x, y) in enumerate(((0.45, -0.06), (-0.45, 0.10))):
        fig = kit.figure(f"chg{i}", (x, y, 0.0), posture=p, stride=st,
                         headgear="keffiyeh", loadout="irregular", mirror=(i == 1))
        if p == "standing":
            fig.append(kit.rot_z(f"chg{i}_vest_f", (0.09, 0.24, 0.30),
                                 (x + 0.16, y, 0.60), 0.0, "charge"))
            fig.append(kit.rot_z(f"chg{i}_vest_b", (0.08, 0.24, 0.26),
                                 (x - 0.15, y, 0.62), 0.0, "charge"))
            if i == 1:
                fig.append(kit.box("chg_satchel", (0.26, 0.18, 0.20),
                                   (x - 0.10, y + 0.18, 0.72), "charge"))
            _lean_forward(fig, lean, at_x=x)
        out += fig
    return out
```

Add to `TEAMS`:

```python
    "charge_squad": (charge_squad, "enemy", "INF_CHARGE"),
```

- [ ] **Step 3: Probe render (one facing) and quantize**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_team.py -- --probe charge_squad
python3 tools/quantize_sprites.py --sprites assets/sprites/INF_CHARGE
```

Expected: one file `assets/sprites/INF_CHARGE/idle_f00_000.png`, console line reporting frame metres and scale.

- [ ] **Step 4: Measure the IoU risk pair before committing to massing**

```bash
python3 - <<'EOF'
import sys
sys.path.insert(0, "tools")
from validate_assets import silhouette, iou, representative, sprite_paths, is_layer
reps = {u: p for u, p in representative(sprite_paths("assets/sprites")).items() if not is_layer(p)}
masks = {u: silhouette(p) for u, p in reps.items()}
for other in sorted(masks):
    if other != "INF_CHARGE":
        print(f"{iou(masks['INF_CHARGE'], masks[other]):.3f}  INF_CHARGE vs {other}")
EOF
```

Expected: every pair < 0.88, `INF_MILITIA` the highest. If `INF_MILITIA` ≥ 0.88: deepen the lean to 26° and widen the file gap to (0.55, −0.55); if still colliding, add a third figure at (0.0, 0.55). Re-probe and re-measure after any change.

- [ ] **Step 5: Live Blender checkpoint**

In the connected Blender (MCP): run the builder for one frame and screenshot for the user, e.g. `execute_blender_code` with:

```python
import sys; sys.path.insert(0, "/Users/ilpinto/dev/roaring-lions/tools"); sys.path.insert(0, "/Users/ilpinto/dev/roaring-lions/tools/units")
import teams
teams.build("charge_squad", "move", 1)
```

then a viewport screenshot sent to the user. Wait for approval before Step 6; apply requested massing tweaks and re-show.

- [ ] **Step 6: Full render, quantize, gate**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_team.py -- charge_squad
python3 tools/quantize_sprites.py --sprites assets/sprites/INF_CHARGE
python3 tools/validate_assets.py
python3 tools/test_dimetric.py
```

Expected: 128 files (8 frames × 16 facings) + `manifest.json`; art gate passes over the whole roster; sun guard green.

- [ ] **Step 7: Commit**

```bash
git add tools/units/teams.py assets/sprites/INF_CHARGE
git commit -m "feat(art): suicide squad sheet -- two sprinting figures, vest bulk, no rifle line"
```

Confirm the output says `[feat/enemy-units-art …]`.

---

### Task 2: `moto_rpg` → `MOTO_RPG` (armed motorcycle)

**Files:**
- Modify: `tools/units/teams.py` (machine + rider helpers, builder, TEAMS entry, clip drop)
- Output: `assets/sprites/MOTO_RPG/` (rendered; committed)

**Interfaces:**
- Consumes: `kit.tube`, `kit.box`, `kit.rot_z`, `kit.limb`, `kit.blob`, `kit.keffiyeh`, `kit.figure`; `_lean_forward` and `TEAM_CLIP_DROP` from Task 1.
- Produces: `TEAMS["moto_rpg"] = (moto_rpg, "enemy", "MOTO_RPG")`; sheet has clips idle/move(4)/fire/wreck, **no `down`** (dropped via `TEAM_CLIP_DROP`).

- [ ] **Step 1: Add machine, rider, and builder to `teams.py`**

```python
def _motorcycle(prefix, z=0.0, pitch=0.0):
    """The machine: 2.2 m long, wheels as 14-segment cylinders, frame in `metal`
    (gunmetal.2), tyres in `weapon` (gunmetal.3 -- the darkest non-shadow tone,
    which is what a tyre is). `pitch` is the fork-dip lever for the move clip."""
    parts = []
    for i, wx in enumerate((0.78, -0.72)):
        parts.append(kit.tube(f"{prefix}_wheel{i}", 0.07, 0.30, (wx, 0.0, 0.30 + z),
                              yaw=math.radians(90.0), sides=14, role="weapon"))
        parts.append(kit.rot_z(f"{prefix}_guard{i}", (0.42, 0.10, 0.05),
                               (wx, 0.0, 0.66 + z), 0.0, "metal"))
    parts.append(kit.tube(f"{prefix}_spine", 1.05, 0.06, (0.05, 0.0, 0.62 + z),
                          pitch=math.radians(8.0), sides=8, role="metal"))
    parts.append(kit.box(f"{prefix}_tank", (0.34, 0.20, 0.16), (0.28, 0.0, 0.74 + z), "metal"))
    parts.append(kit.box(f"{prefix}_seat", (0.46, 0.22, 0.08), (-0.22, 0.0, 0.76 + z), "webbing"))
    parts.append(kit.tube(f"{prefix}_forks", 0.55, 0.035, (0.68, 0.0, 0.55 + z),
                          pitch=math.radians(62.0), sides=6, role="metal"))
    parts.append(kit.tube(f"{prefix}_bars", 0.56, 0.03, (0.56, 0.0, 0.95 + z),
                          yaw=math.radians(90.0), sides=6, role="metal"))
    parts.append(kit.box(f"{prefix}_lamp", (0.10, 0.13, 0.13), (0.74, 0.0, 0.82 + z), "metal"))
    parts.append(kit.tube(f"{prefix}_exhaust", 0.70, 0.045, (-0.35, 0.17, 0.38 + z),
                          sides=6, role="metal"))
    if pitch:
        _lean_forward(parts, pitch)
    return parts


def _rider(prefix, x, z=0.0, lean_deg=14.0, mirror=False):
    """A seated figure from kit primitives -- kit.figure has no seated posture
    and at 25 px a rider is a torso, a head and two angled legs. Saddle height
    0.76; legs run down-forward to the peg line."""
    hand = -1.0 if mirror else 1.0
    parts = []
    parts.append(kit.limb(f"{prefix}_torso", [(x, 0.0, 0.76 + z, 0.13),
                                              (x + 0.02, 0.01 * hand, 1.05 + z, 0.155),
                                              (x + 0.05, 0.0, 1.28 + z, 0.145)], squash=0.75))
    for i, sgn in enumerate((-1.0, 1.0)):
        parts.append(kit.limb(f"{prefix}_leg{i}", [(x + 0.02, sgn * 0.14, 0.80 + z, 0.075),
                                                   (x + 0.22, sgn * 0.18, 0.55 + z, 0.06),
                                                   (x + 0.25, sgn * 0.17, 0.36 + z, 0.05)]))
        parts.append(kit.blob(f"{prefix}_boot{i}", (x + 0.27, sgn * 0.17, 0.33 + z), 0.07,
                              role="boot"))
        parts.append(kit.limb(f"{prefix}_arm{i}", [(x + 0.04, sgn * 0.17, 1.24 + z, 0.05),
                                                   (x + 0.28, sgn * 0.15, 1.05 + z, 0.042)]))
    parts.append(kit.blob(f"{prefix}_head", (x + 0.07, 0.0, 1.42 + z), 0.085,
                          squash=(1.0, 0.94, 1.05), role="face"))
    parts += kit.keffiyeh(f"{prefix}_kef", (x + 0.07, 0.0, 1.45 + z), radius=0.104)
    return parts


def moto_rpg(clip, frame):
    """Armed motorcycle, crew 2. Rider leaned to the bars, pillion passenger
    with an RPG tube over the right shoulder angled 30 degrees up and rearward
    -- level for the fire frame. Total height ~1.9 m against 2.2 m length:
    taller than long is what keeps it off the low-car read. No `down` clip: a
    bike cannot go to ground, and the renderer falls back to idle."""
    if clip == "wreck":
        out = _motorcycle("mw")
        # On its side: roll every machine vert 80 degrees about the x axis at
        # ground level, then lift clear of z=0. Applied to vertex data for the
        # same reason kit.rot_z exists -- the rig measures vertices, so an
        # object rotation would report the upright bike.
        c, s = math.cos(math.radians(80.0)), math.sin(math.radians(80.0))
        for ob in out:
            for v in ob.data.vertices:
                y, zc = v.co.y, v.co.z
                v.co.y = y * c - zc * s
                v.co.z = y * s + zc * c
            ob.data.update()
        # The roll puts part of the bike below z=0; lift the lot back onto the
        # ground so it does not sink through its own shadow plane.
        lift = -min(v.co.z for ob in out for v in ob.data.vertices)
        for ob in out:
            for v in ob.data.vertices:
                v.co.z += lift
            ob.data.update()
        out += kit.figure("mw_a", (0.55, -0.45, 0.0), posture="prone")
        out += kit.figure("mw_b", (-0.55, 0.50, 0.0), posture="prone", mirror=True)
        return out
    bob = (0.0, 0.02, 0.0, -0.02)[frame % 4] if clip == "move" else 0.0
    dip = (0.0, 1.5, 0.0, -1.5)[frame % 4] if clip == "move" else 0.0
    out = _motorcycle("m", z=bob, pitch=dip)
    out += _rider("rid", 0.18, z=bob, lean_deg=18.0)
    out += _rider("pas", -0.40, z=bob, mirror=True)
    pitch = math.radians(0.0 if clip == "fire" else 30.0)
    # Over the passenger's right shoulder, muzzle rearward-up.
    out.append(kit.tube("pas_rpg", 1.15, 0.075, (-0.48, -0.17, 1.42 + bob),
                        yaw=math.pi, pitch=pitch, role="weapon"))
    out.append(kit.tube("pas_rpg_bell", 0.18, 0.12,
                        (-0.48 + 0.48 * math.cos(pitch), -0.17, 1.42 + bob + 0.48 * math.sin(pitch)),
                        yaw=math.pi, pitch=pitch, role="weapon"))
    return out
```

Register:

```python
    "moto_rpg": (moto_rpg, "enemy", "MOTO_RPG"),
```

and in `TEAM_CLIP_DROP`:

```python
TEAM_CLIP_DROP = {"moto_rpg": ("down",)}
```

- [ ] **Step 2: Probe, quantize, IoU**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_team.py -- --probe moto_rpg
python3 tools/quantize_sprites.py --sprites assets/sprites/MOTO_RPG
```

Then rerun the Task 1 Step 4 snippet with `'MOTO_RPG'` in place of `'INF_CHARGE'`. Expected: all pairs < 0.88; watch `JEEP_HULL` and the infantry sheets. Fallback per spec: steepen the RPG to 38° and lengthen it to 1.30; the wheel base line separates from infantry.

- [ ] **Step 3: Live Blender checkpoint** — same procedure as Task 1 Step 5 with `teams.build("moto_rpg", "idle", 0)`; wait for user approval.

- [ ] **Step 4: Full render, quantize, gate**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_team.py -- moto_rpg
python3 tools/quantize_sprites.py --sprites assets/sprites/MOTO_RPG
python3 tools/validate_assets.py
```

Expected: 112 files (7 frames × 16 facings: idle 1, move 4, fire 1, wreck 1) + manifest whose `clips` has no `down`.

- [ ] **Step 5: Commit**

```bash
git add tools/units/teams.py assets/sprites/MOTO_RPG
git commit -m "feat(art): armed motorcycle sheet -- rider, RPG passenger, no down clip"
```

Confirm the branch prefix in the output.

---

### Task 3: Gun truck model — `art/src/vehicles/gun_truck.blend`

**Files:**
- Create: `tools/vehicles/author_gun_truck.py`
- Create: `tools/vehicles/preview_gun_truck.py`
- Create: `art/src/vehicles/gun_truck.blend` (generated by the author script; committed — kit-authored vehicle sources are tracked, same as `technical.blend`)

**Interfaces:**
- Consumes: `tools/vehicles/kit.py` (`box`, `hull_box`, `wheels_in_pairs`, `barrel`, `new_scene`, `save`); local `bx`/`prism`/`taper` helpers in the style of `author_technical.py` (repeated here, not imported — that module runs `main()` patterns of its own).
- Produces: a `.blend` whose traversing parts are all named `turret_*` (resolved by prefix at render time), pivot of the mount at model `(-1.0, 0.0)`; every mesh carries `rl_role` ∈ {hull, plate, metal, rubber, glass, recess}.

- [ ] **Step 1: Write `tools/vehicles/author_gun_truck.py`**

Dimensions from the approved spec: 6.6 × 2.35 m, cab roof 2.5 m, dual rear wheels, drop-side flatbed, ZU-23-style twin cannon. Structure (full file):

```python
"""Author the enemy AA gun truck: a rusting flat-nosed medium truck with a
ZU-23-style twin cannon on a drop-side flatbed.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/author_gun_truck.py

Writes art/src/vehicles/gun_truck.blend. Everything that traverses with the
cannon is named turret_* -- the render script resolves the split by prefix.
The mount's pivot is at model (-1.0, 0.0): declared as turret_axis at render
time, which is what makes turretAxisPx come out right.

Lessons carried from author_technical.py: slab flanks with squared arch
cut-outs from prisms, an upright windscreen (~26 deg), tyres nearly filling
their arches, and a weapon big on a short mount rather than perched high.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

L, W = 6.6, 2.35            # body length/width
HALF = W / 2.0
FLOOR = 0.55                # chassis floor height
BED_FLOOR = 0.95
CAB_ROOF = 2.5
WHEEL_R = 0.45
AXLE_F, AXLE_R = 2.35, -1.85
NOSE_X, CAB_X, BED_X = 3.3, 2.45, 1.35   # front bumper, cab front, cab rear


def bx(name, x0, x1, y0, y1, z0, z1, role="hull"):
    kit.box(name, (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)),
            ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0), role)


def prism(name, profile_xz, y0, y1, role="hull"):
    """Extrude an X-Z profile along Y -- the flank primitive."""
    verts = [(x, y0, z) for x, z in profile_xz] + [(x, y1, z) for x, z in profile_xz]
    n = len(profile_xz)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(); me.update()
    ob = bpy.data.objects.new(name, me)
    ob["rl_role"] = role
    bpy.context.collection.objects.link(ob)
    return ob


def flank_profile(x_lo, x_hi, z_top):
    """A slab side with squared arch notches over both axles."""
    pts = [(x_lo, FLOOR)]
    for ax in (AXLE_R, AXLE_F):
        if x_lo < ax < x_hi:
            pts += [(ax - WHEEL_R - 0.06, FLOOR), (ax - WHEEL_R - 0.06, FLOOR - 0.28),
                    (ax + WHEEL_R + 0.06, FLOOR - 0.28), (ax + WHEEL_R + 0.06, FLOOR)]
    pts += [(x_hi, FLOOR), (x_hi, z_top), (x_lo, z_top)]
    return pts


def body():
    for sgn, tag in ((-1.0, "l"), (1.0, "r")):
        y_out, y_in = sgn * HALF, sgn * (HALF - 0.06)
        prism(f"flank_bed_{tag}", flank_profile(-NOSE_X, BED_X, BED_FLOOR + 0.45),
              min(y_out, y_in), max(y_out, y_in), "hull")
    bx("bed_floor", -NOSE_X, BED_X, -HALF + 0.06, HALF - 0.06, BED_FLOOR - 0.08, BED_FLOOR, "hull")
    bx("tailgate", -NOSE_X - 0.06, -NOSE_X, -HALF, HALF, FLOOR, BED_FLOOR + 0.45, "plate")
    bx("headboard", BED_X - 0.08, BED_X, -HALF, HALF, BED_FLOOR, BED_FLOOR + 0.60, "plate")
    # Cab: upright windscreen at 26 degrees, level bonnet into a flat nose.
    bx("cab_lower", CAB_X, NOSE_X, -HALF, HALF, FLOOR, 1.42, "hull")
    prism("cab_upper", [(BED_X, 1.42), (CAB_X + 0.52, 1.42),
                        (CAB_X + 0.52 - math.tan(math.radians(26.0)) * (CAB_ROOF - 1.42), CAB_ROOF),
                        (BED_X, CAB_ROOF)], -HALF + 0.04, HALF - 0.04, "hull")
    bx("windscreen", CAB_X + 0.30, CAB_X + 0.44, -HALF + 0.22, HALF - 0.22, 1.55, 2.28, "glass")
    bx("grille", NOSE_X - 0.10, NOSE_X - 0.02, -0.62, 0.62, 0.72, 1.30, "recess")
    for i, sgn in enumerate((-1.0, 1.0)):
        bx(f"headlamp{i}", NOSE_X - 0.10, NOSE_X - 0.02, sgn * 0.86 - 0.14, sgn * 0.86 + 0.14,
           0.95, 1.23, "glass")
    bx("bumper", NOSE_X - 0.04, NOSE_X + 0.10, -HALF, HALF, 0.42, 0.62, "metal")


def running_gear():
    kit.wheels_in_pairs("wheel_f", (AXLE_F,), HALF - 0.18, WHEEL_R, 0.30, WHEEL_R)
    # Dual rears: two tyres a side, the medium-truck tell.
    kit.wheels_in_pairs("wheel_r_in", (AXLE_R,), HALF - 0.42, WHEEL_R, 0.28, WHEEL_R)
    kit.wheels_in_pairs("wheel_r_out", (AXLE_R,), HALF - 0.12, WHEEL_R, 0.28, WHEEL_R)
    bx("chassis", -NOSE_X, NOSE_X, -0.55, 0.55, FLOOR - 0.18, FLOOR, "recess")


def taper(name, r0, r1, length, at, pitch, role="metal", segments=12):
    cx, cy, cz = at
    cp, sp = math.cos(pitch), math.sin(pitch)
    verts, faces = [], []
    for end, r in ((0.0, r0), (length, r1)):
        for i in range(segments):
            a = 2 * math.pi * i / segments
            y, z = r * math.cos(a), r * math.sin(a)
            verts.append((cx + end * cp - z * sp, cy + y, cz + end * sp + z * cp))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, segments + j, segments + i))
    faces.append(tuple(range(segments - 1, -1, -1)))
    faces.append(tuple(range(segments, 2 * segments)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(); me.update()
    ob = bpy.data.objects.new(name, me)
    ob["rl_role"] = role
    bpy.context.collection.objects.link(ob)


def cannon(pivot_x=-1.0):
    """ZU-23-style twin mount, everything prefixed turret_. Barrels 2.0 m at
    15 degrees, on a low ring at bed centre -- big weapon, short mount."""
    z0 = BED_FLOOR
    kit.box("turret_ring", (1.10, 1.10, 0.14), (pivot_x, 0.0, z0 + 0.07), "metal")
    kit.box("turret_cradle", (0.72, 0.56, 0.34), (pivot_x, 0.0, z0 + 0.38), "metal")
    kit.box("turret_seat", (0.30, 0.34, 0.40), (pivot_x - 0.55, 0.0, z0 + 0.34), "plate")
    for i, sgn in enumerate((-1.0, 1.0)):
        kit.box(f"turret_ammo{i}", (0.46, 0.24, 0.30),
                (pivot_x - 0.05, sgn * 0.52, z0 + 0.40), "plate")
        taper(f"turret_barrel{i}", 0.055, 0.038, 2.0,
              (pivot_x + 0.30, sgn * 0.14, z0 + 0.62), math.radians(15.0), "metal")
        taper(f"turret_flash{i}", 0.075, 0.055, 0.22,
              (pivot_x + 0.30 + 2.0 * math.cos(math.radians(15.0)), sgn * 0.14,
               z0 + 0.62 + 2.0 * math.sin(math.radians(15.0))), math.radians(15.0), "metal")


def main():
    kit.new_scene()
    body()
    running_gear()
    cannon()
    kit.save(os.path.abspath("art/src/vehicles/gun_truck.blend"))
    print(f"objects: {len(bpy.data.objects)}")


main()
```

- [ ] **Step 2: Run it and confirm the file writes**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/vehicles/author_gun_truck.py
```

Expected: `saved …/art/src/vehicles/gun_truck.blend`.

- [ ] **Step 3: Write and run `tools/vehicles/preview_gun_truck.py`**

Copy `tools/vehicles/preview_technical.py` verbatim, then change exactly four things — everything else (the rig, the ground plane, `srgb_to_linear`, `material`, the camera) is what makes this comparable to the technical's approved preview and must not drift:

1. Docstring: state that this checks a **dust** hull on limestone ground, the same readability risk one ramp over.
2. `SRC = os.path.abspath("art/src/vehicles/gun_truck.blend")`
3. `OUT = os.path.abspath("art/showcase/gun_truck_mock.png")`
4. The `PAL` table, to the spec's dust roles — with the hex read from `data/palette.json`, not typed from memory:

```python
PAL = {
    "hull": "#D1A668",    # dust.1   -- faded ochre body
    "plate": "#C29455",   # dust.2   -- bolt-ons and drop sides
    "metal": "#5C625F",   # gunmetal.2 -- cannon, chassis
    "rubber": "#23241F",  # shadow.0 -- tyres
    "glass": "#363B39",   # gunmetal.3 -- glazing
    "recess": "#14150F",  # shadow.1 -- the gaps a flat box does not have
}
```

Those hexes were read from `data/palette.json`, not typed from memory — writing this plan, two of them were wrong on the first pass. Re-verify before running, since a wrong hex previews a colour the render will never produce:

```bash
python3 -c "import json;p=json.load(open('data/palette.json'));[print(k, p['ramps'][k]['colors']) for k in ('dust','gunmetal','shadow','limestone')]"
```

Then run it and send `art/showcase/gun_truck_mock.png` to the user. Dust-on-limestone-ground is this vehicle's readability check, exactly as white-on-pale was the technical's:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/vehicles/preview_gun_truck.py
```

- [ ] **Step 4: Live Blender checkpoint** — open the blend in the connected Blender, screenshot 3/4 view, iterate massing on user feedback (cab-to-bed ratio, barrel dominance). The technical's history says expect 2–3 rounds.

- [ ] **Step 5: Commit**

```bash
git add tools/vehicles/author_gun_truck.py tools/vehicles/preview_gun_truck.py art/src/vehicles/gun_truck.blend
git commit -m "feat(art): author the AA gun truck -- flat-nosed medium truck, twin 2.0m cannon"
```

Confirm the branch prefix.

---

### Task 4: Gun truck sheets — `GUNTRUCK_HULL` + `GUNTRUCK_TURR`

**Files:**
- Create: `tools/render_gun_truck.py`
- Output: `assets/sprites/GUNTRUCK_HULL/`, `assets/sprites/GUNTRUCK_TURR/` (committed)

**Interfaces:**
- Consumes: `VehicleSpec`, `setup`, `render_clip`, `write_manifest`, `turret_axis_px`, `burnt_material`, `role_materials` from `tools/render_vehicle.py`; `art/src/vehicles/gun_truck.blend` from Task 3.
- Produces: hull sheet clips `idle`(1) + `wreck`(1); turret sheet clips `idle`(1) + `fire`(1, barrels recoiled), `layer: "turret"`, `turretAxisPx` present.

- [ ] **Step 1: Write `tools/render_gun_truck.py`**

Modelled on `render_technical.py` but with a custom `main` (like `render_drone.py`) because the standard `render_vehicle()` has no turret `fire` pass:

```python
"""Render the AA gun truck's hull and turret sheets.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_gun_truck.py
    python3 tools/quantize_sprites.py --sprites assets/sprites/GUNTRUCK_HULL
    python3 tools/quantize_sprites.py --sprites assets/sprites/GUNTRUCK_TURR
    pnpm validate:assets

SOURCE: art/src/vehicles/gun_truck.blend, by tools/vehicles/author_gun_truck.py.
Custom main rather than render_vehicle(): the turret gets a `fire` clip with the
barrels recoiled, which the shared entry point does not render.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from render_vehicle import (  # noqa: E402
    VehicleSpec, setup, render_clip, write_manifest, turret_axis_px,
    burnt_material, role_materials,
)

ROLE_PALETTE = {
    "hull": "dust.1",       # faded ochre -- old and sun-rotted, vs the technical's white
    "plate": "dust.2",
    "metal": "gunmetal.2",
    "rubber": "shadow.0",
    "glass": "gunmetal.3",
    "recess": "shadow.1",
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/vehicles/gun_truck.blend"),
    out_hull=os.path.abspath("assets/sprites/GUNTRUCK_HULL"),
    out_turr=os.path.abspath("assets/sprites/GUNTRUCK_TURR"),
    turret_meshes=frozenset(),          # resolved by prefix in main()
    real_metres=6.6,
    size_class="light_vehicle",
    credit="AA gun truck -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="gun_truck_hull",
    turret_unit="gun_truck_turret",
    role_palette=ROLE_PALETTE,
    turret_axis=(-1.0, 0.0),
    # Prow on +X, same derivation as the technical: (c - phi)/22.5 = -4 = 12.
    facing_offset=12,
    strip_source_lights=True,
)

RECOIL = 0.10


def main():
    bpy.ops.wm.open_mainfile(filepath=SPEC.src)
    names = frozenset(o.name for o in bpy.data.objects
                      if o.type == "MESH" and o.name.startswith("turret_"))
    if not names:
        raise SystemExit(f"no turret_* meshes in {SPEC.src}")
    SPEC.turret_meshes = names

    pivot, hull, turret, _olive, framing = setup(SPEC)

    hull_files = []
    render_clip(pivot, hull, turret, SPEC.out_hull, "idle", hull_files)

    # Wreck: burnt, mount knocked askew, settled -- same posing as render_vehicle().
    burnt = burnt_material()
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    for o in turret:
        o.rotation_euler.z += math.radians(SPEC.wreck_turret_yaw_deg)
        o.rotation_euler.x += math.radians(SPEC.wreck_turret_pitch_deg)
    pivot.rotation_euler.x += math.radians(SPEC.wreck_pitch_deg)
    pivot.location.z -= SPEC.wreck_sink
    render_clip(pivot, hull + turret, [], SPEC.out_hull, "wreck", hull_files)
    pivot.rotation_euler.x -= math.radians(SPEC.wreck_pitch_deg)
    pivot.location.z += SPEC.wreck_sink
    for o in turret:
        o.rotation_euler.z -= math.radians(SPEC.wreck_turret_yaw_deg)
        o.rotation_euler.x -= math.radians(SPEC.wreck_turret_pitch_deg)
    role_materials(hull + turret, SPEC.role_palette)

    write_manifest(SPEC, SPEC.out_hull, SPEC.hull_unit,
                   {"idle": {"frames": 1, "fps": 0, "loop": False},
                    "wreck": {"frames": 1, "fps": 0, "loop": False}},
                   hull_files, framing)

    barrels = [o for o in turret if "barrel" in o.name or "flash" in o.name]

    def recoil_pose(_piv, k):
        for o in barrels:
            o.location.x = -RECOIL if k == 0 else 0.0

    turr_files = []
    render_clip(pivot, turret, hull, SPEC.out_turr, "idle", turr_files)
    render_clip(pivot, turret, hull, SPEC.out_turr, "fire", turr_files,
                frames=1, pose=recoil_pose)
    for o in barrels:
        o.location.x = 0.0
    write_manifest(SPEC, SPEC.out_turr, SPEC.turret_unit,
                   {"idle": {"frames": 1, "fps": 0, "loop": False},
                    "fire": {"frames": 1, "fps": 12, "loop": False}},
                   turr_files, framing, layer="turret",
                   axis_px=turret_axis_px(SPEC, framing))
    print(f"DONE {len(hull_files) + len(turr_files)} frames")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Render, quantize, gate**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_gun_truck.py
python3 tools/quantize_sprites.py --sprites assets/sprites/GUNTRUCK_HULL
python3 tools/quantize_sprites.py --sprites assets/sprites/GUNTRUCK_TURR
python3 tools/validate_assets.py
```

Expected: 32 hull + 32 turret frames; gate passes. Run the Task 1 Step 4 IoU snippet for `GUNTRUCK_HULL`; the pair to watch is `TECH_HULL` — the spec fallback is longer barrels and more flatbed rear overhang.

- [ ] **Step 3: Commit**

```bash
git add tools/render_gun_truck.py assets/sprites/GUNTRUCK_HULL assets/sprites/GUNTRUCK_TURR
git commit -m "feat(art): gun truck sheets -- dust hull, twin-cannon turret with fire recoil and turretAxisPx"
```

Confirm the branch prefix.

---

### Task 5: Paramotor — `art/src/drones/paramotor.blend` → `PARA_MOTOR`

**Files:**
- Create: `tools/drones/author_paramotor.py` (new `tools/drones/` directory, matching `art/src/drones/`)
- Create: `tools/render_paramotor.py`
- Output: `art/src/drones/paramotor.blend`, `assets/sprites/PARA_MOTOR/` (committed)

**Interfaces:**
- Consumes: `tools/vehicles/kit.py` primitives (`box`, `wheel`, `new_scene`, `save`) — vehicle roles; `VehicleSpec`, `setup`, `render_clip`, `write_manifest`, `burnt_material` from `render_vehicle.py`.
- Produces: a `.blend` with mesh groups by name: `CART_*` (always visible), `CANOPY_FLY` + `LINE_*` (airborne clips), `CANOPY_DOWN` (landed clips). Sheet clips: `idle`(4, bob+sway), `fire`(1), `down`(1, landed), `wreck`(1, burnt).

- [ ] **Step 1: Write `tools/drones/author_paramotor.py`**

```python
"""Author the paramotor: a trike cart under a 9.5 m parafoil arc.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/drones/author_paramotor.py

The canopy is ~85% of the silhouette -- nothing else on the roster has mass
floating above a point. Two canopy states are authored in one file and the
render script toggles them per clip: CANOPY_FLY (an arc 5.5 m up, with lines)
and CANOPY_DOWN (crumpled on the ground behind the cart).

Roles are the vehicle kit's: the render palette maps hull->dust.0 (canopy),
plate->dust.1 (pilot, cart body), metal->gunmetal.2 (cage, frame, lines),
rubber->shadow.0 (wheels).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vehicles"))
import kit  # noqa: E402

SPAN, CHORD, ARC_H, CANOPY_Z = 9.5, 2.6, 1.3, 5.5


def strip(name, pts_y_z, x0, x1, role):
    """A surface lofted across Y with 0.07 thickness -- the canopy primitive."""
    verts = []
    for dz in (0.0, -0.07):
        for x in (x0, x1):
            for y, z in pts_y_z:
                verts.append((x, y, z + dz))
    n = len(pts_y_z)
    faces = []
    for base in (0, 2 * n):            # top pair, bottom pair
        for i in range(n - 1):
            a, b = base + i, base + i + 1
            faces.append((a, b, b + n, a + n) if base == 0 else (a + n, b + n, b, a))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(); me.update()
    ob = bpy.data.objects.new(name, me)
    ob["rl_role"] = role
    bpy.context.collection.objects.link(ob)
    return ob


def ring(prefix, radius, at, segments=16):
    """The prop cage: an open ring of small boxes in a vertical Y-Z plane."""
    cx, cy, cz = at
    for k in range(segments):
        a = 2.0 * math.pi * k / segments
        kit.box(f"{prefix}_{k}", (0.05, 0.16, 0.06),
                (cx, cy + radius * math.cos(a), cz + radius * math.sin(a)), "metal")


def cart():
    kit.box("CART_seat", (0.55, 0.50, 0.35), (0.10, 0.0, 0.55), "plate")
    kit.box("CART_pilot_torso", (0.32, 0.40, 0.55), (0.10, 0.0, 1.05), "plate")
    kit.box("CART_pilot_head", (0.22, 0.22, 0.24), (0.16, 0.0, 1.45), "plate")
    # Shown only on the fire clip, so `fire` is different geometry rather than a
    # duplicate of idle -- a rifle levelled over the side of the cart.
    kit.box("WEAPON_rifle", (0.90, 0.07, 0.07), (0.62, -0.26, 1.08), "metal")
    kit.box("CART_frame", (1.30, 0.08, 0.08), (0.0, 0.0, 0.30), "metal")
    ring("CART_cage", 0.68, (-0.55, 0.0, 0.90))
    kit.box("CART_prop", (0.03, 0.12, 1.10), (-0.55, 0.0, 0.90), "metal")
    kit.wheel("CART_wheel_n", 0.16, 0.10, (0.60, 0.0, 0.16))
    kit.wheel("CART_wheel_l", 0.16, 0.10, (-0.35, -0.45, 0.16))
    kit.wheel("CART_wheel_r", 0.16, 0.10, (-0.35, 0.45, 0.16))


def canopy_fly():
    pts = []
    for j in range(13):
        t = j / 12.0
        y = -SPAN / 2.0 + SPAN * t
        pts.append((y, CANOPY_Z + ARC_H * math.sin(math.pi * t)))
    strip("CANOPY_FLY", pts, -CHORD / 2.0, CHORD / 2.0, "hull")
    for k in range(6):
        t = k / 5.0
        y = -SPAN / 2.0 + 0.5 + (SPAN - 1.0) * t
        z = CANOPY_Z + ARC_H * math.sin(math.pi * (0.5 / SPAN + (1.0 - 1.0 / SPAN) * t)) - 0.05
        length = math.sqrt(y * y + (z - 1.0) ** 2)
        pitch = math.atan2(z - 1.0, -y) if y else math.pi / 2.0
        # A thin box from the cart's riser point toward the canopy edge.
        kit.box(f"LINE_{k}", (0.02, 0.02, length),
                (0.10, y / 2.0, 1.0 + (z - 1.0) / 2.0), "metal")


def canopy_down():
    pts = [(-2.6, 0.10), (-1.4, 0.34), (0.0, 0.18), (1.3, 0.40), (2.6, 0.12)]
    ob = strip("CANOPY_DOWN", pts, -2.4, -1.0, "hull")
    return ob


def main():
    kit.new_scene()
    cart()
    canopy_fly()
    canopy_down()
    kit.save(os.path.abspath("art/src/drones/paramotor.blend"))


main()
```

- [ ] **Step 2: Run it; live Blender checkpoint** — run headless, open the blend in the connected Blender, screenshot for the user (both canopy states visible is fine at this stage). Iterate canopy mass/pilot proportion on feedback. Wait for approval.

- [ ] **Step 3: Write `tools/render_paramotor.py`**

```python
"""Render the paramotor: 4-frame airborne idle, fire, landed `down`, wreck.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_paramotor.py
    python3 tools/quantize_sprites.py --sprites assets/sprites/PARA_MOTOR
    pnpm validate:assets

The `down` clip is the landed state -- CANOPY_DOWN shown, flying canopy and
lines hidden -- authored now because it is the frame the future
land-and-dismount behaviour needs. SOURCE: art/src/drones/paramotor.blend.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from render_vehicle import (  # noqa: E402
    VehicleSpec, setup, render_clip, write_manifest, burnt_material,
)

FRAMES, FPS, BOB, SWAY = 4, 8, 0.12, 0.15

ROLE_PALETTE = {
    "hull": "dust.0",     # canopy
    "plate": "dust.1",    # pilot, cart body
    "metal": "gunmetal.2",
    "rubber": "shadow.0",
    "glass": "gunmetal.3",
    "recess": "shadow.1",
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/drones/paramotor.blend"),
    out_hull=os.path.abspath("assets/sprites/PARA_MOTOR"),
    out_turr=os.path.abspath("assets/sprites/PARA_MOTOR_TURR_UNUSED"),
    real_metres=9.5,
    size_class="air",
    credit="Paramotor -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="paramotor",
    turret_unit="paramotor_turret_unused",
    facing_offset=0,
    role_palette=ROLE_PALETTE,
    bounds_z_pad=BOB,
    # The canopy swings in y across the idle loop, so the rest pose alone would
    # crop a wingtip on half the frames -- the same trap render_drone.py hit
    # with sweeping prop blades. Both extremes, then back to rest.
    bounds_poses=(
        lambda: setattr(bpy.data.objects["CANOPY_FLY"], "location", (0.0, SWAY, 0.0)),
        lambda: setattr(bpy.data.objects["CANOPY_FLY"], "location", (0.0, -SWAY, 0.0)),
        lambda: setattr(bpy.data.objects["CANOPY_FLY"], "location", (0.0, 0.0, 0.0)),
    ),
)


def groups():
    """Four groups, shown in different combinations per clip."""
    fly, down, weapon, cart = [], [], [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.name == "CANOPY_DOWN":
            down.append(o)
        elif o.name.startswith(("CANOPY_FLY", "LINE_")):
            fly.append(o)
        elif o.name.startswith("WEAPON_"):
            weapon.append(o)
        else:
            cart.append(o)
    return fly, down, weapon, cart


def main():
    # Both canopy states are in the scene when setup() measures, so one frame
    # holds the flying canopy and the landed one alike -- the unit cannot resize
    # when it lands. That is the same union-framing rule render_team.py applies
    # across clips, got here for free by authoring both states in one file.
    pivot, _hull, _turret, _olive, framing = setup(SPEC)
    fly, down, weapon, cart = groups()
    base_z = pivot.location.z
    canopy = bpy.data.objects["CANOPY_FLY"]

    def air_pose(piv, k):
        piv.location.z = base_z + BOB * math.sin(2.0 * math.pi * k / FRAMES)
        canopy.location.y = SWAY * math.sin(2.0 * math.pi * k / FRAMES + math.pi / 2.0)

    files = []
    render_clip(pivot, cart + fly, down + weapon, SPEC.out_hull, "idle", files,
                frames=FRAMES, pose=air_pose)
    # Absolute reset before every later clip. render_clip calls pose(pivot, 0)
    # on exit, and air_pose(_, 0) leaves the canopy swung fully to one side --
    # so without this the fire, down and wreck clips would all inherit a lean
    # from the last frame of the idle loop.
    canopy.location.y = 0.0
    pivot.location.z = base_z
    render_clip(pivot, cart + fly + weapon, down, SPEC.out_hull, "fire", files)
    render_clip(pivot, cart + down, fly + weapon, SPEC.out_hull, "down", files)
    burnt = burnt_material()
    for o in cart + down:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    pivot.rotation_euler.y = math.radians(7.0)
    render_clip(pivot, cart + down, fly + weapon, SPEC.out_hull, "wreck", files)
    pivot.rotation_euler.y = 0.0
    write_manifest(SPEC, SPEC.out_hull, SPEC.hull_unit,
                   {"idle": {"frames": FRAMES, "fps": FPS, "loop": True},
                    "fire": {"frames": 1, "fps": 12, "loop": False},
                    "down": {"frames": 1, "fps": 0, "loop": False},
                    "wreck": {"frames": 1, "fps": 0, "loop": False}},
                   files, framing)
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Render, quantize, gate, IoU**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_paramotor.py
python3 tools/quantize_sprites.py --sprites assets/sprites/PARA_MOTOR
python3 tools/validate_assets.py
```

Expected: 112 files (idle 64 + fire 16 + down 16 + wreck 16). The floating-canopy silhouette should be the loosest thing on the matrix; if the thin lines vanish after quantization that is acceptable — the canopy mass carries the read.

- [ ] **Step 5: Commit**

```bash
git add tools/drones/author_paramotor.py tools/render_paramotor.py art/src/drones/paramotor.blend assets/sprites/PARA_MOTOR
git commit -m "feat(art): paramotor sheet -- parafoil arc, bob-and-sway idle, landed down state"
```

Confirm the branch prefix.

---

### Task 6: Loitering munition — `art/src/drones/loitering_munition.blend` → `DRONE_LOITER`

**Files:**
- Create: `tools/drones/author_loiter.py`
- Create: `tools/render_loiter.py`
- Output: `art/src/drones/loitering_munition.blend`, `assets/sprites/DRONE_LOITER/` (committed)

**Interfaces:**
- Consumes: `tools/vehicles/kit.py`; `VehicleSpec`, `setup`, `render_clip`, `write_manifest`, `burnt_material` from `render_vehicle.py`.
- Produces: a `.blend` with `WING`, `FUSE_*`, `FIN_*`, `PROP` (airborne) and `WRECK_*` debris meshes (wreck only). Sheet clips: `idle`(4, roll wobble + prop spin), `wreck`(1, debris).

- [ ] **Step 1: Write `tools/drones/author_loiter.py`**

```python
"""Author the loitering munition: a 1.6 m delta wing with a pusher prop.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/drones/author_loiter.py

Against DRONE_RECON's open quad cross this is a solid triangle -- expected to
be the loosest pair on the matrix. WRECK_* meshes are the debris field for the
wreck clip, hidden in flight.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vehicles"))
import kit  # noqa: E402

SPAN, LEN = 1.6, 1.15


def wing():
    """Delta planform: nose at +x, tips aft. Two skins with a tapered edge."""
    top, bot = 0.05, -0.04
    verts = [(LEN * 0.55, 0.0, top), (-LEN * 0.45, -SPAN / 2.0, 0.01), (-LEN * 0.45, SPAN / 2.0, 0.01),
             (LEN * 0.55, 0.0, bot), (-LEN * 0.45, -SPAN / 2.0, -0.01), (-LEN * 0.45, SPAN / 2.0, -0.01)]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (2, 5, 3, 0), (1, 4, 5, 2)]
    me = bpy.data.meshes.new("WING")
    me.from_pydata(verts, [], faces)
    me.validate(); me.update()
    ob = bpy.data.objects.new("WING", me)
    ob["rl_role"] = "hull"
    bpy.context.collection.objects.link(ob)


def main():
    kit.new_scene()
    wing()
    kit.box("FUSE_body", (0.85, 0.16, 0.16), (0.05, 0.0, 0.05), "plate")
    kit.box("FUSE_nose", (0.22, 0.13, 0.13), (0.58, 0.0, 0.05), "recess")   # blunt warhead
    for i, sgn in enumerate((-1.0, 1.0)):
        kit.box(f"FIN_{i}", (0.16, 0.03, 0.16), (-LEN * 0.42, sgn * SPAN / 2.0, 0.10), "plate")
    kit.box("PROP", (0.02, 0.60, 0.06), (-0.42, 0.0, 0.05), "metal")
    # Debris for the wreck clip: charred fragments flat on the ground.
    kit.box("WRECK_wing_l", (0.5, 0.45, 0.05), (-0.3, -0.4, 0.03), "hull")
    kit.box("WRECK_wing_r", (0.45, 0.4, 0.05), (0.25, 0.45, 0.03), "hull")
    kit.box("WRECK_fuse", (0.6, 0.14, 0.10), (0.1, 0.0, 0.05), "plate")
    kit.save(os.path.abspath("art/src/drones/loitering_munition.blend"))


main()
```

- [ ] **Step 2: Run it; live Blender checkpoint** — open in connected Blender, screenshot, user approval.

- [ ] **Step 3: Write `tools/render_loiter.py`**

```python
"""Render the loitering munition: a 4-frame flying idle and a debris wreck.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_loiter.py
    python3 tools/quantize_sprites.py --sprites assets/sprites/DRONE_LOITER
    pnpm validate:assets

No `move` clip, for render_drone.py's reason: clipOrFallback resolves a missing
clip back to idle, and a munition in transit is doing exactly what its idle
shows. SOURCE: art/src/drones/loitering_munition.blend.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from render_vehicle import (  # noqa: E402
    VehicleSpec, setup, render_clip, write_manifest, burnt_material,
)

FRAMES, FPS, BOB = 4, 8, 0.06
ROLL_DEG = 4.0
# 2-blade prop: FRAMES * SPIN_DEG must be 180 or the loop jumps on wrap-around.
SPIN_DEG = 45.0

ROLE_PALETTE = {
    "hull": "dust.1",
    "plate": "dust.2",
    "metal": "gunmetal.2",
    "rubber": "shadow.0",
    "glass": "gunmetal.3",
    "recess": "shadow.1",
}


def _spin(k):
    bpy.data.objects["PROP"].rotation_euler.x = math.radians(SPIN_DEG) * k


SPEC = VehicleSpec(
    src=os.path.abspath("art/src/drones/loitering_munition.blend"),
    out_hull=os.path.abspath("assets/sprites/DRONE_LOITER"),
    out_turr=os.path.abspath("assets/sprites/DRONE_LOITER_TURR_UNUSED"),
    real_metres=1.6,
    size_class="air",
    credit="Loitering munition -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="loitering_munition",
    turret_unit="loitering_munition_turret_unused",
    facing_offset=0,
    role_palette=ROLE_PALETTE,
    bounds_z_pad=BOB,
    # The prop sweeps outside its rest silhouette as it spins.
    bounds_poses=tuple(
        (lambda k: (lambda: _spin(k)))(k) for k in range(FRAMES)
    ),
)


def groups():
    """Airborne meshes and the wreck debris, split by name."""
    air, debris = [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        (debris if o.name.startswith("WRECK_") else air).append(o)
    return air, debris


def main():
    pivot, _hull, _turret, _olive, framing = setup(SPEC)
    air, debris = groups()
    base_z = pivot.location.z

    def air_pose(piv, k):
        t = 2.0 * math.pi * k / FRAMES
        piv.location.z = base_z + BOB * math.sin(t)
        # The bank wobble is what reads at this size -- a 3 px prop does not.
        piv.rotation_euler.x = math.radians(ROLL_DEG) * math.sin(t)
        _spin(k)

    files = []
    render_clip(pivot, air, debris, SPEC.out_hull, "idle", files,
                frames=FRAMES, pose=air_pose)
    # Absolute reset: render_clip calls pose(pivot, 0) on exit, which restores
    # the bob and roll, but the wreck pass must start from a level pivot.
    pivot.location.z = base_z
    pivot.rotation_euler.x = 0.0
    _spin(0)

    burnt = burnt_material()
    for o in debris:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    render_clip(pivot, debris, air, SPEC.out_hull, "wreck", files)

    write_manifest(SPEC, SPEC.out_hull, SPEC.hull_unit,
                   {"idle": {"frames": FRAMES, "fps": FPS, "loop": True},
                    "wreck": {"frames": 1, "fps": 0, "loop": False}},
                   files, framing)
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Render, quantize, gate — watch MIN_FILL**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/render_loiter.py
python3 tools/quantize_sprites.py --sprites assets/sprites/DRONE_LOITER
python3 tools/validate_assets.py
```

Expected: 80 files (idle 64 + wreck 16). The named risk is MIN_FILL (6%): the 30° camera sees mostly planform so the delta should pass, but if it fails, widen `SPAN` to 1.8 and re-run from Step 1 (the `air` class multiplier means this does not change its size relative to anything).

- [ ] **Step 5: Commit**

```bash
git add tools/drones/author_loiter.py tools/render_loiter.py art/src/drones/loitering_munition.blend assets/sprites/DRONE_LOITER
git commit -m "feat(art): loitering munition sheet -- solid delta, roll-wobble idle, debris wreck"
```

Confirm the branch prefix.

---

### Task 7: Full-roster verification and the recorded matrix

**Files:**
- Create: `docs/superpowers/specs/assets/2026-08-11-enemy-raider-iou-matrix.txt`

**Interfaces:**
- Consumes: all six new sheets in `assets/sprites/`.
- Produces: the recorded IoU evidence the spec's verification section requires; a green full gate run.

- [ ] **Step 1: Record the matrix**

```bash
python3 - <<'EOF' | tee docs/superpowers/specs/assets/2026-08-11-enemy-raider-iou-matrix.txt
import sys, itertools
sys.path.insert(0, "tools")
from validate_assets import silhouette, iou, representative, sprite_paths, is_layer
reps = {u: p for u, p in representative(sprite_paths("assets/sprites")).items() if not is_layer(p)}
masks = {u: silhouette(p) for u, p in reps.items()}
new = {"INF_CHARGE", "MOTO_RPG", "GUNTRUCK_HULL", "PARA_MOTOR", "DRONE_LOITER"}
rows = sorted(((iou(masks[a], masks[b]), a, b)
               for a, b in itertools.combinations(sorted(masks), 2)
               if a in new or b in new), reverse=True)
print(f"{len(masks)} units; pairs involving the five new sheets, worst first (limit 0.88):")
for s, a, b in rows:
    print(f"{s:.3f}  {a:16s} {b}")
EOF
```

Expected: every row < 0.88.

- [ ] **Step 2: Run every gate the spec names**

```bash
python3 tools/validate_assets.py
python3 tools/test_dimetric.py
pnpm test
pnpm lint
pnpm test:determinism
```

Expected: art gate green over the full roster; sun guard green; tests green; determinism **4/4 with the golden hash unchanged** — if the hash moved, something in this work touched sim code and that is a stop-and-investigate, not an update-the-hash.

- [ ] **Step 3: Commit the evidence**

```bash
git add docs/superpowers/specs/assets/2026-08-11-enemy-raider-iou-matrix.txt
git commit -m "docs(art): record the raider-sheet IoU matrix -- all pairs clear 0.88"
```

Confirm the branch prefix. Then report the final matrix and gate results to the user.
