"""Export the anti-tank ditch segment -- `art/meshes/decor/ditch_0.glb`.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/terrain/export_meshy_ditch.py

SOURCE (AI-generated, Meshy, disclosed per CONTRIBUTING.md):

    art/blend/terrain object/ditch/
        Meshy_AI_antitank_ditch_segmen_0902112836_image-to-3d-texture.blend

`art/blend/` is gitignored and does not exist inside a worktree checkout, so
SRC is an absolute path into the main repo's own untracked working directory
-- the same pattern `export_meshy_decor.py` and `export_meshy_camp.py` use.

This is a SEPARATE script from `export_meshy_decor.py`, and deliberately so:
that file's whole contract is "zero materials, zero images, every mesh node
carrying `extras.rl_role`", and this asset breaks it on purpose (see
"TEXTURED, NOT PALETTE" below). Folding a textured family into a script whose
docstring, `_strip` and `_finalize_and_export` all promise the opposite would
make the exception invisible at exactly the place a reader looks for the rule.

## WHAT THE SOURCE IS -- measured, not assumed

    objects   1 ('mesh_node')      verts 955,770      tris 1,912,080
    materials 1                    uv layers 1        modifiers 0
    images    3  base_color 4096^2 (sRGB), metallic_roughness 2048^2,
                 normal 4096^2                        transform: identity
    bbox      X -0.95206..+0.95108  extent 1.90314   <- the ditch runs along X
              Y -0.40223..+0.40319  extent 0.80542
              Z -0.11875..+0.11726  extent 0.23601

It is a FLAT GROUND PATCH WITH THE TRENCH PRESSED INTO IT, not a trench
floating in space -- which is the only shape that can work here, because the
terrain is an extruded heightfield and there is no way to cut a hole in it.
An asset that brings its own ground and replaces what is beneath it is
therefore the whole mechanism.

A top-surface heightmap (max z per XY cell, 48x20) gives the cross-section,
and it is ASYMMETRIC -- spoil is thrown to one side, as a real dug ditch is:

    y -0.40..-0.26   approach apron,  top -0.0363   <- THE GROUND PLANE
    y -0.24..-0.06   trench floor,    top -0.0925
    y -0.06..+0.00   far wall, rising
    y +0.00..+0.14   flat shelf,      top +0.0353
    y +0.14..+0.34   spoil berm, to   top +0.115    (rocks embedded)
    y +0.34..+0.40   falling tail,    top +0.020
    underside skin   -0.106..-0.119                 (a closed solid)

## GROUNDING: THE APRON, NOT THE LOWEST VERTEX

Every other decor family grounds its LOWEST vertex at Z=0
(`export_meshy_decor.py`'s `_bake_scale_and_ground`), which is right for a
rock or a bush sitting ON the ground. It is WRONG here and the failure looks
plausible: this asset's lowest vertex is the underside skin at -0.119, so
that rule would float the whole earthwork 0.082 source units above the
terrain -- a ditch hovering over the ground, with daylight under its apron.

What must land at Z=0 is the APPROACH APRON's top surface (-0.0363), because
that is the face that continues the terrain it replaces. Everything below it
(the trench floor, the underside skin) then sits under the terrain plane and
is hidden; the shelf and berm stand proudly above it, which is what spoil
does. `APRON_Z` below is that height and `_ground_apron` is the one place it
is applied.

APRON_Z is measured, not authored: `_measure_apron_z` reads it back off the
mesh at export time (the modal top-surface height over the -Y margin) and
fails loudly if it has moved, so a regenerated source cannot silently ship a
floating ditch.

The last epsilon -- lifting the apron a hair ABOVE the terrain so the two
coplanar surfaces do not z-fight -- is deliberately NOT baked in here. It
lives in `decor-place.ts`'s `DITCH_LIFT`, where it can be retuned without a
re-export and where it is visible to someone reading the renderer.

## SCALE: LENGTH = ONE TILE, AND WHY THAT AND NOT THE WIDTH

    MESH_UNITS_PER_TILE (3.0) build units = one 3 m tile, the convention every
    other export in this pipeline bakes to; the runtime's `MESH_SCALE = 1/3`
    undoes it at load.

The source is 2.364x longer than it is wide, and its trench opening is only
~31% of its own footprint width. Those two numbers together mean no isotropic
scale satisfies both "one segment per blocked tile" and "the trench is
tank-sized in metres". Four candidates were measured:

    scale rule        segment len  earthwork width  trench opening   tiling
    length = 1 tile      1.00 t     0.42 t / 1.27 m  0.39 m x 0.20 m  exact, any run
    length = 2 tiles     2.00 t     0.85 t / 2.54 m  0.79 m x 0.40 m  gap on odd runs
    length = 3 tiles     3.00 t     1.27 t / 3.81 m  1.18 m x 0.61 m  gap up to 2 t
    width  = 1 tile      2.36 t     1.00 t / 3.00 m  0.93 m x 0.48 m  58% overlap

Only the first tiles exactly for a run of ARBITRARY length, and that is the
property that was ruled load-bearing: a gap in an anti-tank ditch is not a
cosmetic flaw but a gameplay lie -- it draws a hole a vehicle visibly could
drive through, on ground that `blockedVehicle` says is impassable to it, at
the one moment the player is deciding whether to commit armour. Metric trench
width is not load-bearing; at gameplay zoom a tile is tens of pixels and what
the player needs is an unbroken line reading "armour stops here".

So this ships a ditch whose trench is small in metres, ON PURPOSE, and the
precedent for art that overhangs its own metric footprint is already in the
tree: `art/meshes/vehicles/mbt_lavi.glb` is 2.11 tile-widths long standing on
a one-tile footprint.

Three escapes were considered and rejected, each for a measured reason:
  * NON-UNIFORM squash of X. The cross-section is prismatic so the profile
    would survive untouched, but it compresses a 4096 texture 2.364x along
    the run against 1x across it, stacking an anisotropy on top of the UV
    damage decimation already does.
  * SLICING the model to a 1-tile length. The along-X profile varies only
    +/-0.003, so slices would abut as well as the natural ends do -- but an
    uncapped cut shows the hollow interior at a run's end, and a capped cut
    puts a vertical wall across the trench at every tile boundary (of each
    coincident pair, one always faces the camera under `FrontSide`).
  * ONE SEGMENT EVERY N TILES. A run whose length is not a multiple of N
    leaves a visible break, which is the exact failure this is avoiding.

## DECIMATION: 0.02, AND THE CHOICE IS NOT MONOTONE

955,770 verts cannot ship. Sweep, with the SEAM measured at each step -- the
maximum mismatch between the two X ends' top-surface profiles, which is
exactly the property end-to-end tiling depends on (source units, Z range
0.236):

    ratio    verts     seam max dz   seam mean   what the render shows
    1.000    955,770     0.00182      0.00096    reference
    0.020     18,850     0.00186      0.00107    indistinguishable
    0.010      9,290     0.00387      0.00131    indistinguishable
    0.004      3,554     0.13975      0.03114    <- see below
    0.002      1,642     0.00708      0.00215    berm crest faceted, seam a notch
    0.001        765     0.01008      0.01008    destroyed; texture shredded

0.004 is the whole reason this was measured rather than reasoned: it is
NON-MONOTONE. The collapse decimator removes a whole end feature there and
the seam mismatch jumps to 0.140 -- 59% of the entire Z range, a step you
would see from any camera -- while both 0.002 and 0.001 below it read
smaller. Picking a ratio by "smaller is fine until it looks bad in a render"
would have walked straight past it, because at 0.004 the SEGMENT still looks
correct; it is only the JOIN that breaks.

0.020 is the pick: its seam (0.00186) is within noise of the undecimated
source's own (0.00182), so decimation costs the tiling property nothing at
all, and it is the same ratio and almost the same vert count as the Levantine
house (19,445). Geometry cost is one-time regardless -- `InstancedMesh`
uploads this geometry ONCE for the whole map and draws every ditch tile from
it -- so there is nothing to buy by going lower.

## TEXTURED, NOT PALETTE -- and why this one is not a preference

Every other decor mesh is repainted at runtime from a palette ramp indexed BY
NORMAL (`decor-role.ts`). That is exactly what cannot work here. This asset's
job is to REPLACE a patch of ground, and its apron is a flat plane: one
normal, therefore ONE FLAT COLOUR, by construction. Dropped onto terrain that
carries its own grain and scatter, a uniformly-coloured slab does not read as
ground with a ditch in it -- it reads as a plaque with a ditch printed on it.
The two-plaques failure would be guaranteed rather than risked.

The project lead's standing instruction ("i have provided a very detailed
blender files and i want them to be used as is unless ill provide other
instruction") points the same way, but the argument above is the one that
decides it.

So the ditch takes the same exemption the three Meshy buildings take, through
the same module (`tools/buildings/textured.py`): `base_color` ships,
downscaled to 2048 and re-encoded as JPEG; `metallic_roughness` and `normal`
are DROPPED, because this renderer has no lights to consume them. The
exemption is a NAMED LIST on both sides, exactly as the building one is:

    TEXTURED_DECOR_FAMILIES  packages/render/src/three/terrain/textured-decor.ts
    TEXTURED_DECOR_EXEMPT    tools/validate_mesh_assets.py

pinned against each other by `textured-decor.test.ts`, which parses the
Python. A decor GLB outside that list which ships a texture still FAILS
`pnpm validate:meshes` -- the gate is not weakened for everything to admit
one asset.

The mesh node carries `extras.rl_textured = true` rather than an `rl_role`,
so the GLB says what it is and the runtime does not have to infer it. Both
locks apply: the flag says "this mesh is textured", and the named list says
"this family is allowed to be".

COLOUR SPACE, the way this fails silently if it fails at all: the runtime
must sample the map with `NoColorSpace`. `GLTFLoader` stamps `SRGBColorSpace`
on a baseColorTexture and this renderer's output is pass-through, so getting
it wrong dims the whole asset and still looks like a ditch. Nothing this
script does can enforce that -- `prepareTexturedMap` on the runtime side
does, and `textured-decor.test.ts` pins it.
"""
import json
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, os.path.join(TOOLS, "buildings"))

from dimetric import metres_per_unit  # noqa: E402
import textured  # noqa: E402  (tools/buildings/textured.py)

REPO = os.path.dirname(TOOLS)

SRC = (
    "/Users/ilpinto/dev/roaring-lions/art/blend/terrain object/ditch/"
    "Meshy_AI_antitank_ditch_segmen_0902112836_image-to-3d-texture.blend"
)

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "decor")

CREDIT = (
    "Anti-tank ditch segment -- AI-generated (Meshy), disclosed per "
    "CONTRIBUTING.md; decimated, re-scaled and apron-grounded for Roaring Lions"
)

#: Matches every other export script's own constant. One tile = 3 build units.
MESH_UNITS_PER_TILE = 3.0

#: The X extent (the ditch's own run direction) is baked to exactly one tile.
#: See the module docstring's "SCALE" for the four candidates and why.
TARGET_LENGTH = MESH_UNITS_PER_TILE

#: See "DECIMATION" -- chosen on the SEAM measurement, not on vert count.
DECIMATE_RATIO = 0.02

#: The approach apron's top surface in the SOURCE's own frame, and the height
#: `_ground_apron` moves to Z=0. Measured; `_measure_apron_z` re-reads it at
#: export time and refuses to ship if the source has moved away from it.
APRON_Z = -0.0363

#: How far the re-measured apron may drift from APRON_Z before this refuses.
#: 0.01 is ~4% of the source's 0.236 Z range -- tight enough that a
#: regenerated source with a different profile fails rather than shipping a
#: ditch sunk or floating by a visible amount.
APRON_Z_TOLERANCE = 0.01

#: The -Y fraction of the model's width that is approach apron. Read off the
#: heightmap in the docstring: the apron runs y -0.40..-0.26 of a -0.40..+0.40
#: span, so the outer 15% of the -Y side is apron and nothing else.
APRON_BAND = 0.15


def _mesh_objects():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def _verts(ob):
    """Local-space vertex array. The source's transform is identity (asserted
    in `export`), so local and world agree and this stays cheap -- a per-vertex
    `matrix_world @ v.co` over 955k verts is minutes in Python, measured."""
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    return co.reshape(n, 3)


def _measure_apron_z(ob, label):
    """The apron's top-surface height, read back off the mesh.

    Takes the outer `APRON_BAND` of the -Y side (which the heightmap says is
    apron and only apron) and returns the MEDIAN of its per-column top
    surface. Median rather than max: the apron is a real scanned surface with
    a few high specks on it, and a max would ground the ditch by its worst
    outlier.
    """
    co = _verts(ob)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    cut = y.min() + np.ptp(y) * APRON_BAND
    band = y < cut
    if band.sum() < 100:
        raise SystemExit(f"[{label}] apron band holds {band.sum()} verts -- too few to measure")
    # Per-column top surface across the band, so the underside skin (which is
    # also inside the band) cannot drag the answer down.
    NX = 48
    ix = np.clip(((x[band] - x.min()) / np.ptp(x) * NX).astype(int), 0, NX - 1)
    zb = z[band]
    tops = np.array([zb[ix == c].max() for c in range(NX) if (ix == c).any()])
    return float(np.median(tops))


def _decimate(ob, ratio, label):
    before = len(ob.data.vertices)
    mod = ob.modifiers.new("ditch_decimate", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after = len(ob.data.vertices)
    print(f"[{label}] decimate ratio={ratio}: {before} -> {after} verts "
          f"({len(ob.data.polygons)} tris)")


def _bake_scale(ob, mpu, label):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    ob.scale = (mpu, mpu, mpu)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    co = _verts(ob)
    print(f"[{label}] scale={mpu:.5f} -> extents "
          f"X {np.ptp(co[:, 0]):.4f}  Y {np.ptp(co[:, 1]):.4f}  Z {np.ptp(co[:, 2]):.4f} "
          f"build units ({MESH_UNITS_PER_TILE} = one tile)")


def _ground_apron(ob, apron_z_scaled, label):
    """Shifts the mesh so the APRON's top surface lands at Z=0.

    NOT the lowest vertex -- see the module docstring's "GROUNDING". The
    lowest vertex here is the underside skin, and grounding on it would float
    the whole earthwork above the terrain it is supposed to be cut into.
    """
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    ob.location.z = -apron_z_scaled
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    co = _verts(ob)
    print(f"[{label}] apron grounded: shift {-apron_z_scaled:+.5f} -> "
          f"Z {co[:, 2].min():+.4f}..{co[:, 2].max():+.4f} "
          f"(apron at 0; trench and underside below it, spoil above)")


def export():
    label = "ditch_0"
    out_path = os.path.join(OUT_DIR, f"{label}.glb")

    bpy.ops.wm.open_mainfile(filepath=SRC)
    meshes = _mesh_objects()
    if len(meshes) != 1 or meshes[0].name != "mesh_node":
        raise SystemExit(f"[{label}] expected exactly one 'mesh_node' object, "
                         f"found {[o.name for o in meshes]}")
    ob = meshes[0]
    if tuple(ob.scale) != (1.0, 1.0, 1.0) or tuple(ob.location) != (0.0, 0.0, 0.0):
        raise SystemExit(f"[{label}] source transform is not identity "
                         f"(scale={tuple(ob.scale)} loc={tuple(ob.location)}) -- "
                         f"_verts() reads local space and would be wrong")
    if len(ob.data.materials) != 1:
        raise SystemExit(f"[{label}] expected exactly one material to ship, "
                         f"found {len(ob.data.materials)}")
    if not ob.data.uv_layers:
        raise SystemExit(f"[{label}] source carries no UV layer -- there is nothing "
                         f"for the shipped base_color to address")

    # Decimate FIRST, then measure and ground: the apron height is a property
    # of the geometry that actually ships, and collapse decimation moves
    # vertices. Measuring on the source and applying to the decimated mesh
    # would ground it by a number the shipped bytes no longer have.
    _decimate(ob, DECIMATE_RATIO, label)

    apron_z = _measure_apron_z(ob, label)
    drift = abs(apron_z - APRON_Z)
    print(f"[{label}] apron top measured at {apron_z:+.5f} (expected {APRON_Z:+.5f}, "
          f"drift {drift:.5f}, tolerance {APRON_Z_TOLERANCE})")
    if drift > APRON_Z_TOLERANCE:
        raise SystemExit(
            f"[{label}] apron top is {apron_z:+.5f}, {drift:.5f} from the expected "
            f"{APRON_Z:+.5f} -- the source's cross-section has changed. Re-read the "
            f"heightmap and re-derive APRON_Z rather than widening the tolerance: "
            f"grounding on the wrong face floats or sinks the whole earthwork."
        )

    co = _verts(ob)
    mpu = metres_per_unit(float(np.ptp(co[:, 0])), TARGET_LENGTH)
    _bake_scale(ob, mpu, label)
    _ground_apron(ob, apron_z * mpu, label)

    # `rl_textured`, not `rl_role`: this mesh draws its own bake, so it has no
    # palette ramp to name. See the docstring's "TEXTURED, NOT PALETTE".
    ob.name = "ditch"
    ob.data.name = "ditch"
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    ob["rl_textured"] = True

    tex_size = textured.prepare_textured_images()
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**textured.gltf_kwargs(out_path, CREDIT))

    size = os.path.getsize(out_path)
    verts = len(ob.data.vertices)
    polys = len(ob.data.polygons)
    print(f"[{label}] wrote {out_path} ({size} bytes, {verts} verts, {polys} tris, "
          f"base_color {tex_size[0]}x{tex_size[1]})")
    print("SUMMARY_JSON " + json.dumps({
        label: {"path": out_path, "bytes": size, "verts": verts, "polys": polys,
                "texture": list(tex_size), "ratio": DECIMATE_RATIO}
    }))


if __name__ == "__main__":
    export()
