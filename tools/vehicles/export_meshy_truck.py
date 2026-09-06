"""Export the Meshy-generated armed technical as a hull+turret glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_truck.py

Writes `art/meshes/vehicles/technical.glb`.

SOURCES (two separate files, unlike the tank -- see this task's report,
`.superpowers/f-meshy-truck-report.md`, for the full reasoning):

  art/blend/enemy/truck/Meshy_AI_Technical_Truck_Body_0829203857_image-to-3d-texture.blend
      single mesh object `mesh_node`, 983,143 verts, one material,
      three packed 4096/2048 textures -- the truck bed already carries
      modelled jerry cans, no gun.

  art/blend/enemy/truck/Meshy_AI_Pintle_Mount_Machine__0829203951_image-to-3d-texture.blend
      single mesh object `mesh_node`, 987,449 verts, one material, its own
      three packed textures -- a complete pedestal-mounted DShK: base
      plate, post, cradle, gun body, barrel.

Both AI-generated (Meshy), disclosed per CONTRIBUTING.md.

Why two files is a GOOD thing here, and simpler than the tank. The tank's
one welded mesh needed a geometric face-cut with hole-filling
(`export_meshy_tank.py`) to separate hull from turret. This source is
already split at the object level -- no cut, no boundary-loop fill, no
geometric ambiguity. What replaces that complexity is a different problem:
**the two files are independently Meshy-normalised and share no common
scale.** Measured: the pintle mount's own longest axis is 1.905 model
units, against the truck body's 1.896 -- nearly identical, despite one
being a full pickup and the other a machine gun on a pedestal. That is a
Meshy export-normalisation coincidence, not a real-world size relationship,
confirmed by rendering both (see the report) -- the pintle mount is
obviously a gun-sized object, not truck-sized, and applying the hull's
scale factor to it would produce a gun mount roughly 3 m tall. So this
script derives TWO independent metres-per-unit factors, one per source,
each declared against its own real-world reference (see REAL_METRES_HULL /
REAL_METRES_TURRET below), and manually places the resulting turret at an
authored position on the hull -- there is no geometric information in
either file that relates one to the other's coordinate frame.

DECIMATION. Both sources are Meshy's refined/textured output, not its
low-poly mode: ~985k verts each, roughly 100x this pipeline's other
vehicles (mbt_lavi's cut geometry ships at 9,349; apc_eitan at 61,887).
Blender's Decimate modifier (COLLAPSE, edge-collapse) is applied directly
to each whole object before any other processing -- ratios measured against
this specific pair of meshes (see the report for the vertex-count table and
before/after silhouette renders), landing hull at ~13.8k verts and turret
at ~9.7k verts, both inside this pipeline's 8-20k order of magnitude and
both silhouette-preserving at the render sizes checked.

ORIENTATION. Neither source points +X. Measured independently (not
assumed) by binning vertices along each model's own long axis: the truck's
cab/hood sits at negative X and its loaded cargo bed at positive X, so its
nose faces -X; the pintle mount's thin barrel-tip cross-section sits at
extreme negative X (elevated in Z) while its base-plate/post cluster sits
near positive X, so its muzzle also points -X. Both get the same baked
180-degree Z rotation, independently, in their own local frames, after
their own scale bake.

ROLE SPLIT (added after the first export shipped, GH #148 -- "the technical
is the only vehicle with one role"). The first version of this script emitted
BOTH parts as `hull`, so all 49,096 vertices drew in one flat colour and no
repaint of `limestone` could help. Three roles ship now, each measured on the
DECIMATED mesh in its own (pre-scale, pre-rotation) source frame, and each
verified by rendering the classification back onto the model in false colour
(see this task's report for the images):

  - `turret_metal` -- the WHOLE pintle mount, wholesale. This file's own
    docstring already describes that source as "a complete pedestal-mounted
    DShK: base plate, post, cradle, gun body, barrel", and
    `tools/vehicles/author_technical.py` -- the authored sprite for this same
    unit -- tags essentially every `turret_*` part `metal` (its own
    `turret_pintle_plate`, `turret_post`, `turret_receiver`, `turret_jacket`,
    `turret_muzzle_tube` and the rest). So this is a rename, not a cut, and
    it needs no measurement. The `turret` PART prefix is kept: the renderer
    finds the turret to rotate by that prefix, and emitting a bare `metal`
    would break turret traverse.

  - `hull_rubber` -- the four tyres. GEOMETRY did this, and the source's own
    base-colour texture did NOT: sampled through the UVs, the front tyre
    reads luminance 0.293 against 0.300 for the rocker panel directly above
    it and 0.356 for the rear tyre -- no separation at all (this asset is
    uniformly dust-covered in base colour; its visible contrast lives in the
    normal map). What is decisive instead is that each wheel is a disc about
    the Y axis: a radial histogram around each axle centre shows a filled
    disc out to r~0.12 model units, a sharp drop at r=0.13-0.15 (the wheel
    arch clearance gap: 84 and 72 faces in those bins against 282 and 399
    just inside), then the arch itself. `WHEEL_R`/`WHEEL_CZ`/`AXLE_F`/
    `AXLE_R` below are that fit; `WHEEL_AY` keeps the axle, diff, springs and
    underbody -- which sit inside the same disc but inboard of the tyre --
    out of it.

  - `hull_metal` -- the bed's lashed jerry-can load, plus the front
    bumper/grille/brush-guard assembly and the rear step bumper. Here
    geometry and texture AGREE, which is why this one is shipped and `plate`
    is not. The can load is a dark, uniform mass (luminance p10/p50/p90 =
    0.233/0.268/0.311) sitting inside the bed walls; the bed floor
    immediately below it reads 0.478 and the bed walls immediately outboard
    read 0.303-0.556, so the box below has bright material on every side of
    it. Same at both ends: everything forward of x=-0.84 below the bonnet
    line reads 0.25-0.28 against 0.675 for the bonnet directly above, and
    everything aft of x=+0.84 below z=-0.037 reads 0.29 against 0.49-0.57
    above. Calling a jerry can `metal` is an authored judgement, not a
    derived fact -- it is a steel can, and `metal` ("gun, bars, chassis" in
    `tools/render_technical.py`'s own ROLE_PALETTE) is the only role in the
    closed vehicle vocabulary that means "dark steel fitting". The
    alternative was leaving the biggest dark mass on the vehicle painted as
    body limestone.

  - `hull_plate` -- the improvised bolted armour: the four door plates, the
    plated-over side and rear windows, and the big slitted windscreen plate
    that carries forward onto the bonnet. This is the vehicle's single most
    characteristic feature, and it is the one role here that BASE COLOUR
    decides and geometry cannot. Three measurements, in the order they
    matter:

    (1) **There is no geometric standoff to find, at any decimation ratio.**
    An earlier pass rejected `plate` on the finding that the cab side has
    dense material to |y|=0.260, ZERO faces from 0.260 to 0.285, then more
    at 0.285-0.310, and that `DECIMATE_RATIO_HULL` closed that gap. Both
    halves of that are wrong. Re-measured over the ratio sweep
    1.0 / 0.10 / 0.06 / 0.03 / 0.015 / 0.008 / 0.004, the 0.260-0.285 band
    holds EXACTLY ZERO faces at every one of them -- decimation never closed
    it, including at 0.004, a fifth of what ships. And the band is not the
    plate: rendering the whole mesh banded by |y| shows 0.285+ is simply the
    body's widest belt (lower doors, wheel arches, bed sides, tyres) running
    unbroken nose to tailgate, and the empty band is the AIR INSIDE THE BODY
    SHELL, between the outer skin and the cab's inner surface. The armour is
    modelled flush; the door plates and the door skin around them are the
    same |y|. No ratio recovers what was never a boundary.

    (2) **Base colour separates it cleanly, but only inside the cab box.**
    Sampled per polygon on the FULL-RESOLUTION mesh (see the texture note
    below), the faces inside `PLATE_X0..PLATE_X1`, `z >= PLATE_Z0` are
    strongly BIMODAL in linear luminance: a peak at 0.24-0.36 (193k faces in
    the 0.28 bin alone) and a second at 0.64-0.84, with a floor of
    ~4.3k/bin across 0.48-0.56. `PLATE_LUM_MAX` sits in that floor, and the
    split is insensitive to where exactly: 0.45 and 0.60 differ by four
    percentage points of the box. The bimodality is why this works where the
    earlier attempt's thresholds of 0.30 and 0.33 tore the plates apart --
    the plate's own median is 0.28, so both of those cut THROUGH the peak
    rather than between the peaks.

    (3) **The nose does separate.** The earlier pass reported windscreen
    armour 0.302 against bonnet 0.313 and concluded the nose was hopeless.
    The plate figure is right; the bonnet figure is contaminated, because
    the windscreen plate CARRIES FORWARD ONTO THE BONNET and any x/z box
    drawn around "the bonnet" swallows it. The bonnet proper reads 0.65-0.82
    and the plate 0.276 -- as wide a separation as the door plates get.

    The cab box is what keeps this from being the speckle the earlier pass
    saw: unbounded, a dark threshold also claims the mud-caked rocker
    panels, wheel arches and tailgate, which read as dark as the armour.
    Bounded to the cab, and evaluated AFTER `rubber` and `metal` have taken
    their own faces, what is left below the threshold is armour and cab
    interior. The interior is never seen, so it costs a role tag and
    nothing else.

    Classify-then-transfer, not classify-on-the-decimated-mesh, and the
    reason is the UV atlas: Meshy's layout for this asset is a shattered
    per-triangle mosaic, so a decimated face's own UVs straddle island seams
    and smear every sample toward the atlas mean. A full-resolution triangle
    never does. So the mask is built at 1.97M faces and transferred onto the
    29.5k decimated faces by a spatial majority vote (`_transfer_plate`).

NOT SHIPPED, checked and rejected rather than assumed:

  - `glass`. **This vehicle has no glazing.** Its windscreen is a bolted
    twin steel plate with two letterbox vision slits, and every side window
    is plated over the same way -- read off a textured Workbench render of
    the source's own -X and -Y facades, the same instrument
    `export_meshy_house.py` used to find ITS windows. There is nothing
    glass-like left on the model except the headlight lenses, which are a
    few faces inside the front bumper assembly and ship as `metal` with it.
    A `glass` role here would have to be invented.

  - `recess`. Nothing on this source reads as a shadowed gap distinct from
    the body -- see `plate` above for what the base colour actually splits
    into, which is two populations and not three.

GROUND / PLACEMENT. The hull's own origin sits at its vertical midpoint
(z range roughly symmetric before ground-align), same defect as every
other Meshy source in this pipeline -- shifted up by its own lowest vertex
so the wheels touch z=0, the kit-vehicle convention. The turret has no
natural relationship to the hull's coordinate frame at all (two unrelated
files), so its placement on the truck bed is an authored decision, not a
derived one: see WORLD_PLACEMENT_M below for the measurement that produced
it (a histogram of the hull's own cargo-bed region, converted through the
hull's own mpu) and the sanity check against real truck-bed height.
"""
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale  # noqa: E402 -- shared bake-scale-into-verts helper
import textured as vehicle_textured  # noqa: E402 -- 2026-09-07: ship the source's own base_color bake

REPO = os.path.dirname(TOOLS)
#: Corrected 2026-09-07: this used to read "art/blend/truck/..." (no
#: `enemy` segment), a path that has never existed -- the real source has
#: always lived at "art/blend/enemy/truck/...". Same fix, same day, as
#: `export_meshy_tank.py`/`export_meshy_namer.py`.
SRC_HULL = os.path.join(
    REPO, "art", "blend", "enemy", "truck",
    "Meshy_AI_Technical_Truck_Body_0829203857_image-to-3d-texture.blend",
)
SRC_TURRET = os.path.join(
    REPO, "art", "blend", "enemy", "truck",
    "Meshy_AI_Pintle_Mount_Machine__0829203951_image-to-3d-texture.blend",
)
#: The .blend files are gitignored and live only in the MAIN checkout, not
#: in a worktree -- same fallback convention this pipeline already uses
#: elsewhere.
SRC_FALLBACK_ROOTS = (REPO, "/Users/ilpinto/dev/roaring-lions")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "technical.glb")


def _resolve(path):
    if os.path.exists(path):
        return path
    tail = os.path.relpath(path, REPO)
    for root in SRC_FALLBACK_ROOTS:
        alt = os.path.join(root, tail)
        if os.path.exists(alt):
            return alt
    raise SystemExit(f"source not found: {path} (also tried {SRC_FALLBACK_ROOTS})")

#: technical's own declared real-world size -- read from the sprite sheet it
#: currently ships with (TECH_HULL/render_technical.py's own VehicleSpec),
#: same pattern as export_meshy_tank.py reading TNK_HULL's manifest. This is
#: the hull's longest axis (nose to tailgate).
TECH_HULL_MANIFEST = os.path.join(REPO, "assets", "sprites", "TECH_HULL", "manifest.json")

#: The pintle mount has no manifest of its own to read and no geometric
#: relationship to the hull's scale (see module docstring). Declared instead
#: from the unit's own weapon data: data/units/enemy/technical.json's single
#: weapon is `dshk` (a real DShK 12.7mm HMG, overall gun length 1.625 m).
#: 1.8 m adds the pedestal cradle's reach beyond the gun body itself, which
#: the model's own longest axis (barrel-to-rear-fitting) includes. This is a
#: declared editorial figure, not a derived one -- flagged here rather than
#: hidden, the same way mbt_lavi's inherited 6.32 m was flagged rather than
#: silently accepted.
REAL_METRES_TURRET = 1.8

#: Wheel fit, source frame, measured on the DECIMATED hull -- see the module
#: docstring's ROLE SPLIT section for the radial histogram this came from.
#: Each wheel is a disc about the Y axis; `WHEEL_CZ` is the axle height
#: (= the ground plane at z=-0.289 plus the tyre radius) and `WHEEL_R` sits
#: in the empty band between the tyre's own outer edge and the wheel arch.
WHEEL_R = 0.135
WHEEL_CZ = -0.166
AXLE_F = -0.636
AXLE_R = 0.451
#: Inboard limit of a wheel. The disc also contains the axle, differential,
#: leaf springs and a slice of underbody floor, all of which sit inboard of
#: the tyre and are NOT rubber.
WHEEL_AY = 0.190

#: The bed's lashed jerry-can load -- source frame, same decimated mesh. The
#: box is bounded on every side by material that measures brighter than it
#: (bed floor below, bed walls outboard, cab rear wall forward); see the
#: module docstring for the numbers. `CARGO_Z1` is generous: the load's own
#: top sits at z=0.225, so the ceiling never clips anything.
CARGO_X0, CARGO_X1 = 0.24, 0.88
CARGO_AY = 0.245
CARGO_Z0, CARGO_Z1 = 0.085, 0.30

#: Front bumper/grille/brush-guard, and the rear step bumper. Both are dark
#: structures that stop cleanly at a body line -- the bonnet lip forward, the
#: tailgate lip aft -- rather than fading into the panel above.
NOSE_X, NOSE_Z = -0.84, 0.037
TAIL_X, TAIL_Z = 0.84, -0.037

#: The cab box, source frame. `plate` is only looked for inside it, because
#: outside it a dark-luminance threshold also claims the mud-caked rocker
#: panels, wheel arches and tailgate -- which measure as dark as the armour
#: does and are not armour. The box is the cab and its windscreen: aft to the
#: bed front wall (+0.20), forward far enough to keep the windscreen plate's
#: carry-over onto the bonnet (-0.60), and above the rocker line (-0.05).
PLATE_X0, PLATE_X1 = -0.60, 0.20
PLATE_Z0 = -0.05

#: Linear-luminance ceiling for `plate`, read off the floor between the cab
#: box's own two luminance peaks (0.24-0.36 armour, 0.64-0.84 body) -- see the
#: module docstring. Anywhere in 0.45-0.60 gives the same split to within four
#: percentage points of the box; 0.50 is the middle of the floor.
PLATE_LUM_MAX = 0.50

#: Voxel edge for `_transfer_plate`'s majority vote, source units. Small
#: enough that one cell is finer than the decimated mesh's own face spacing,
#: large enough that a cell holds many full-resolution faces (1.97M faces over
#: a 1.9 x 0.68 x 0.60 box).
PLATE_VOXEL = 0.006

#: Every role the hull splits into, in the one order that both `_classify_hull`
#: and `_split_hull` walk -- so a role added here cannot be classified and then
#: silently not emitted, which is the shape of the bug this whole split fixed.
HULL_ROLES = ("hull", "plate", "metal", "rubber")

#: The turret source ships wholesale as `metal`; see the module docstring.
TURRET_ROLE = "metal"

#: Decimate ratios, measured against THESE two meshes (see report for the
#: vertex-count table and before/after silhouette renders) -- not a general
#: formula, because Decimate's COLLAPSE algorithm's actual output count
#: depends on mesh topology, not just target ratio.
DECIMATE_RATIO_HULL = 0.015
DECIMATE_RATIO_TURRET = 0.010

#: Where the turret_pivot lands in the FINAL (rotated, ground-aligned, +X
#: forward) hull frame, in metres. Derived from a histogram of the hull's
#: OWN cargo-bed region (x > 0.30 model units in the hull's pre-rotation
#: source frame, where the loaded jerry cans sit) -- centred left-right,
#: biased toward the rear (65% of the way from bed-front to tailgate), at
#: the bed-floor height read from the low-density valley in that region's
#: z-histogram (~0.02 model units, between the floor/wall cluster and the
#: jerry-can mass above it). After the hull's own 180-degree rotation and
#: ground shift this works out to (-1.635, 0.0, 0.819) m -- sanity-checked
#: against the hull's own 5.0 m declared length (65% into the rear half, not
#: at the very tailgate edge) and against a real pickup's bed-floor height
#: (~0.8-0.9 m), both plausible. See the report for the full derivation;
#: this is an authored placement, not something either source file encodes.
WORLD_PLACEMENT_M = (-1.635, 0.0, 0.819)


def _read_real_metres(manifest_path):
    import json
    with open(manifest_path) as fh:
        manifest = json.load(fh)
    return manifest["realMetres"]


def _extent_of(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    m = eo.to_mesh()
    xs, ys, zs = [], [], []
    for v in m.vertices:
        wc = eo.matrix_world @ v.co
        xs.append(wc.x)
        ys.append(wc.y)
        zs.append(wc.z)
    eo.to_mesh_clear()
    return max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def _load_object(path, new_name):
    """Append `mesh_node` from `path` into the CURRENT scene, renamed so two
    files' identically-named root objects don't collide once both are
    loaded together."""
    path = _resolve(path)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == "mesh_node"]
    if not dst.objects or dst.objects[0] is None:
        raise SystemExit(f"{path}: no 'mesh_node' object found")
    ob = dst.objects[0]
    bpy.context.collection.objects.link(ob)
    ob.name = new_name
    ob.data.name = new_name
    if ob.modifiers:
        raise SystemExit(f"{new_name}: carries {len(ob.modifiers)} modifier(s) on load -- unexpected")
    return ob


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(f"[{label}] decimate ratio={ratio}: {before_v} -> {after_v} verts, {before_p} -> {after_p} polys")


def _turret_pivot_local(ob, eps=0.05):
    """Horizontal centroid of the lowest-z vertex layer -- the base plate's
    underside, the same "lowest contact layer" convention
    `export_mesh_vehicle.py`'s `_turret_pivot` uses for a turret ring.
    Measured on the FULL (pre-decimate) mesh so it is not sensitive to which
    exact verts survive decimation; decimate preserves the overall silhouette
    (see the report) so the post's footprint centre does not move materially.
    """
    zmin = min(v.co.z for v in ob.data.vertices)
    layer = [v.co for v in ob.data.vertices if v.co.z <= zmin + eps]
    cx = sum(p.x for p in layer) / len(layer)
    cy = sum(p.y for p in layer) / len(layer)
    return (cx, cy, zmin)


def _plate_mask_full(ob):
    """Per-polygon boolean over the FULL-RESOLUTION hull: "this face is bolted
    armour". Base colour decides it; see the module docstring's `hull_plate`
    section for why geometry cannot and why the cab box is required.

    The texture sample is the MEDIAN of four lookups per triangle -- the face's
    own UV centroid, plus each corner pulled halfway in toward that centroid.
    Pulling in matters: Meshy's atlas is a per-triangle mosaic and a corner UV
    sits exactly on an island seam, so sampling corners raw reads the
    neighbouring island. Run on the full-resolution mesh ONLY, before decimate,
    because a decimated triangle's UVs span several islands and no amount of
    pulling in rescues that.
    """
    import numpy as np

    me = ob.data
    nl, nv, npoly = len(me.loops), len(me.vertices), len(me.polygons)
    lt = np.empty(npoly, dtype=np.int32)
    me.polygons.foreach_get("loop_total", lt)
    if lt.min() != 3 or lt.max() != 3:
        raise SystemExit("[technical] hull source is not pure triangles -- _plate_mask_full assumes it")

    co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    lv = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    cent = co.reshape(-1, 3)[lv.reshape(-1, 3)].mean(axis=1)

    uv = np.empty(nl * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 3, 2)
    uvc = uv.mean(axis=1)

    img = bpy.data.images["base_color"]
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    # `Image.pixels` hands back SCENE-LINEAR floats for an sRGB-tagged image --
    # Blender has already undone the encoding. Converting again here halves
    # every reading and moves the peaks off the constants above.
    lum = (0.2126 * px[:, :, 0] + 0.7152 * px[:, :, 1] + 0.0722 * px[:, :, 2]).astype(np.float32)
    del px

    def sample(u):
        xs = np.clip((u[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(np.int32)
        ys = np.clip((u[:, 1] % 1.0) * (h - 1), 0, h - 1).astype(np.int32)
        return lum[ys, xs]

    taps = [sample(uvc)] + [sample(uvc + 0.5 * (uv[:, k, :] - uvc)) for k in range(3)]
    lin = np.median(np.stack(taps, axis=1), axis=1)

    x, y, z = cent[:, 0], cent[:, 1], cent[:, 2]
    box = (x >= PLATE_X0) & (x <= PLATE_X1) & (z >= PLATE_Z0)
    mask = box & (lin < PLATE_LUM_MAX)
    print(
        f"[technical] plate mask (full res): {int(mask.sum())} of {npoly} faces "
        f"({100.0 * mask.sum() / npoly:.1f}%), {100.0 * mask.sum() / max(1, box.sum()):.1f}% of the cab box"
    )
    return cent, mask


def _transfer_plate(cent, mask, ob):
    """Carry `mask` (full-resolution) onto the DECIMATED faces of `ob`, as a
    set of face indices.

    A spatial majority vote rather than a single nearest neighbour: a decimated
    face centroid does not land on any original face, and one nearest original
    triangle at a plate's edge is a coin toss. Bin the full-resolution faces
    into `PLATE_VOXEL` cells, blur the plate and total counts by one cell in
    each direction (so a query cell always sees its neighbours), and take the
    majority of the 3x3x3 neighbourhood -- widening to 5x5x5 for the rare
    decimated centroid whose neighbourhood is empty.
    """
    import numpy as np

    lo = cent.min(axis=0) - PLATE_VOXEL
    hi = cent.max(axis=0) + PLATE_VOXEL
    dims = np.maximum(((hi - lo) / PLATE_VOXEL).astype(np.int64) + 1, 1)
    nx, ny, nz = (int(d) for d in dims)

    def cells(pts):
        i = np.clip(((pts - lo) / PLATE_VOXEL).astype(np.int64), 0, dims - 1)
        return i[:, 0], i[:, 1], i[:, 2]

    ix, iy, iz = cells(cent)
    tot = np.zeros((nx, ny, nz), dtype=np.int32)
    hit = np.zeros((nx, ny, nz), dtype=np.int32)
    np.add.at(tot, (ix, iy, iz), 1)
    np.add.at(hit, (ix[mask], iy[mask], iz[mask]), 1)

    def blur(a, r):
        out = np.zeros_like(a)
        for dx in range(-r, r + 1):
            sx = slice(max(0, dx), nx + min(0, dx))
            tx = slice(max(0, -dx), nx + min(0, -dx))
            for dy in range(-r, r + 1):
                sy = slice(max(0, dy), ny + min(0, dy))
                ty = slice(max(0, -dy), ny + min(0, -dy))
                for dz in range(-r, r + 1):
                    sz = slice(max(0, dz), nz + min(0, dz))
                    tz = slice(max(0, -dz), nz + min(0, -dz))
                    out[sx, sy, sz] += a[tx, ty, tz]
        return out

    tot1, hit1 = blur(tot, 1), blur(hit, 1)
    tot2, hit2 = blur(tot, 2), blur(hit, 2)

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    q = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float32)
    idx = [f.index for f in bm.faces]
    bm.free()

    qx, qy, qz = cells(q)
    t1, h1 = tot1[qx, qy, qz], hit1[qx, qy, qz]
    t2, h2 = tot2[qx, qy, qz], hit2[qx, qy, qz]
    wide = t1 == 0
    t = np.where(wide, t2, t1)
    hcount = np.where(wide, h2, h1)
    vote = (t > 0) & (hcount * 2 > t)
    print(
        f"[technical] plate transfer: {int(vote.sum())} of {len(idx)} decimated faces, "
        f"{int(wide.sum())} needed the 5x5x5 fallback"
    )
    return {idx[i] for i in np.nonzero(vote)[0]}


def _hull_role(c, is_plate):
    """The role for one decimated hull face, from its centroid in the SOURCE
    frame (nose -X, bed +X, ground z=-0.289) plus the transferred plate vote.
    See the module docstring's ROLE SPLIT section for how every constant below
    was measured. `rubber` and `metal` are geometric and outrank `plate`, which
    is why the front bumper and the can load stay gunmetal rather than being
    swept up by a luminance test they would also pass."""
    for cx in (AXLE_F, AXLE_R):
        if abs(c.y) >= WHEEL_AY and (c.x - cx) ** 2 + (c.z - WHEEL_CZ) ** 2 <= WHEEL_R ** 2:
            return "rubber"
    if CARGO_X0 <= c.x <= CARGO_X1 and abs(c.y) < CARGO_AY and CARGO_Z0 <= c.z <= CARGO_Z1:
        return "metal"
    if c.x < NOSE_X and c.z < NOSE_Z:
        return "metal"
    if c.x > TAIL_X and c.z < TAIL_Z:
        return "metal"
    if is_plate:
        return "plate"
    return "hull"


def _classify_hull(ob, plate_idx):
    """{role: set(face_index)} over the decimated hull. Every role must be
    non-empty: an empty one would mean a constant above has drifted off the
    geometry it was fitted to, which is a silent flat-colour regression --
    the exact bug this split exists to fix -- so it raises instead."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    out = {}
    for f in bm.faces:
        role = _hull_role(f.calc_center_median(), f.index in plate_idx)
        out.setdefault(role, set()).add(f.index)
    total = len(bm.faces)
    bm.free()
    for role in HULL_ROLES:
        if not out.get(role):
            raise SystemExit(
                f"[technical] hull role {role!r} came out EMPTY -- the cut constants no "
                f"longer match the geometry; re-measure before shipping"
            )
    for role in sorted(out):
        n = len(out[role])
        print(f"[technical] hull role {role}: {n} faces ({100.0 * n / total:.1f}%)")
    return out


def _keep_only(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep_idx], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _split_hull(hull_obj, role_faces):
    """Duplicate the decimated hull once per role and cut each copy down to
    its own faces. Boundaries are deliberately left OPEN, the way
    `tools/buildings/export_meshy_house.py` leaves its own role cuts open:
    every cut here runs along a real material seam (tyre against wheel arch,
    can load against bed floor, bumper against bonnet lip), so the two sides
    of a cut are separate surfaces that were never one closed shell. There
    is no boundary loop to cap the way `export_meshy_tank.py`'s mid-hull
    face cut had."""
    pieces = []
    for role in HULL_ROLES:
        bpy.ops.object.select_all(action="DESELECT")
        hull_obj.select_set(True)
        bpy.context.view_layer.objects.active = hull_obj
        bpy.ops.object.duplicate()
        piece = bpy.context.object
        piece.name = f"hull_{role}"
        _keep_only(piece, role_faces[role])
        pieces.append((piece, role))
    bpy.data.objects.remove(hull_obj, do_unlink=True)
    return pieces


def _rotate_180z(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def export():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    hull_obj = _load_object(SRC_HULL, "hull_src")
    turret_obj = _load_object(SRC_TURRET, "turret_src")

    # Real-world scale, independently per source (see module docstring).
    real_metres_hull = _read_real_metres(TECH_HULL_MANIFEST)
    extent_hull = _extent_of(hull_obj)
    mpu_hull = metres_per_unit(extent_hull, real_metres_hull)
    print(
        f"[technical] hull extent {extent_hull:.4f} model units -> {real_metres_hull:.3f} m declared "
        f"({mpu_hull:.5f} m/unit, real_metres from {TECH_HULL_MANIFEST})"
    )

    extent_turret = _extent_of(turret_obj)
    mpu_turret = metres_per_unit(extent_turret, REAL_METRES_TURRET)
    print(
        f"[technical] turret extent {extent_turret:.4f} model units -> {REAL_METRES_TURRET:.3f} m declared "
        f"({mpu_turret:.5f} m/unit, dshk-derived, see module docstring)"
    )

    # Turret pivot, measured in the turret's OWN pre-scale, pre-rotate,
    # pre-decimate frame (see _turret_pivot_local docstring).
    pivot_local = _turret_pivot_local(turret_obj)
    print(f"[technical] turret pivot (source frame, model units): {tuple(round(c, 4) for c in pivot_local)}")

    # The `plate` mask, on the FULL-RESOLUTION hull and therefore before
    # decimate -- a decimated triangle's UVs straddle Meshy's atlas islands and
    # read the wrong texel (see `_plate_mask_full`). Same source frame as the
    # geometric constants, since nothing has been transformed yet.
    plate_cent, plate_mask = _plate_mask_full(hull_obj)

    # Decimate. Order: after measuring extent/pivot on the full mesh, before
    # everything else -- so every later step (rotate, bake scale, ground
    # align) operates on the cheap mesh.
    _decimate(hull_obj, DECIMATE_RATIO_HULL, "hull")
    _decimate(turret_obj, DECIMATE_RATIO_TURRET, "turret")

    # Role split. Measured in the SOURCE frame on the DECIMATED mesh, so it
    # has to run here -- after decimate, before the scale bake and the
    # 180-degree rotation move every coordinate the constants were fitted to.
    plate_idx = _transfer_plate(plate_cent, plate_mask, hull_obj)
    role_faces = _classify_hull(hull_obj, plate_idx)
    hull_pieces = _split_hull(hull_obj, role_faces)

    # Contract naming and role, before bake/rotate so nothing downstream
    # needs to remember which object is which.
    tagged = [(ob, role, "hull") for ob, role in hull_pieces]
    tagged.append((turret_obj, TURRET_ROLE, "turret"))
    for ob, role, part in tagged:
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")
        name = f"{part}_{role}"
        ob.name = name
        ob.data.name = name
        # 2026-09-07: materials KEPT, not cleared -- see
        # `export_meshy_tank.py`'s identical comment and
        # `tools/vehicles/textured.py`. `hull_obj`/`turret_obj` are each
        # appended (`_load_object`) from their OWN Meshy source and keep
        # their own base_color material; `_split_hull`'s new hull pieces are
        # all duplicates of `hull_obj` and inherit the same reference.
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = part

    hull_objs = [ob for ob, _role in hull_pieces]

    # Bake scale into vertex data, independently per part (object scale
    # stays 1, the mesh contract's convention). Every hull piece shares the
    # hull's own factor; the turret has its own (see module docstring).
    _bake_scale(hull_objs, mpu_hull)
    _bake_scale([turret_obj], mpu_turret)
    pivot_scaled = tuple(c * mpu_turret for c in pivot_local)

    # Reorient. Both sources point -X (verified independently, see module
    # docstring); bake 180 degrees about Z into each, AFTER its own scale
    # bake, in its own local frame.
    _rotate_180z(hull_objs)
    _rotate_180z([turret_obj])
    pivot_rotated = (-pivot_scaled[0], -pivot_scaled[1], pivot_scaled[2])

    # Ground-align the hull: its own origin sits at the vertical midpoint
    # (same defect as every other Meshy source in this pipeline), not at
    # ground level. Shift up by its own lowest vertex -- the lowest across
    # ALL hull pieces, applied to all of them together, so the split cannot
    # move the vehicle off the ground or shear its parts apart. In practice
    # the lowest vertex is a tyre's contact patch, i.e. `hull_rubber`'s.
    hull_zmin = min(min(v.co.z for v in ob.data.vertices) for ob in hull_objs)
    shift_hull = -hull_zmin
    bpy.ops.object.select_all(action="DESELECT")
    for ob in hull_objs:
        ob.location.z = shift_hull
        ob.select_set(True)
    bpy.context.view_layer.objects.active = hull_objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[technical] hull ground shift +{shift_hull:.4f} m (lowest vertex -> z=0)")

    # Place the turret on the truck bed. No geometric relationship between
    # the two source frames exists (see module docstring) -- translate the
    # turret so its own pivot point lands exactly at the authored
    # WORLD_PLACEMENT_M, in the hull's now-final (rotated, ground-aligned)
    # frame.
    delta = tuple(WORLD_PLACEMENT_M[i] - pivot_rotated[i] for i in range(3))
    bpy.ops.object.select_all(action="DESELECT")
    turret_obj.location = delta
    turret_obj.select_set(True)
    bpy.context.view_layer.objects.active = turret_obj
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    pivot_world = WORLD_PLACEMENT_M
    print(f"[technical] turret translated by {tuple(round(c, 4) for c in delta)} m -> pivot at {pivot_world}")

    pivot_obj = bpy.data.objects.new("turret_pivot", None)
    pivot_obj.empty_display_size = 0.15
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot_world
    inv = Matrix.Translation(Vector(pivot_world) * -1.0)
    turret_obj.parent = pivot_obj
    turret_obj.matrix_parent_inverse = inv

    # 2026-09-07: ships both sources' own base_color bakes -- see
    # `export_meshy_tank.py`'s identical block and `tools/vehicles/textured.py`.
    # There are TWO base_color images here (hull's own "base_color", turret's
    # own "base_color.001") -- `prepare_vehicle_textures` matches by prefix
    # for exactly this reason; see that module's own docstring.
    kept, dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[technical] shipping {name!r} at {after[0]}x{after[1]} (was {before[0]}x{before[1]}), JPEG q{vehicle_textured.JPEG_QUALITY}")
    for name, size in dropped:
        print(f"[technical] dropped {name!r} ({size[0]}x{size[1]})")

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        **vehicle_textured.gltf_kwargs(
            OUT_PATH,
            "Armed technical hull+turret -- AI-generated (Meshy), disclosed per "
            "CONTRIBUTING.md; truck body and pintle-mounted DShK from two separate "
            "Meshy exports, combined for this repository; ships both sources' own "
            "base_color bakes (project lead direction, 2026-09-07)",
        )
    )
    size = os.path.getsize(OUT_PATH)
    print(f"[technical] wrote {OUT_PATH} ({size} bytes)")
    return OUT_PATH


if __name__ == "__main__":
    export()
