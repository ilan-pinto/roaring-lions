"""Roaring Lions -- `sniper_team` from the two supplied Meshy sculpts.

Writes `art/meshes/sniper_team.glb`, replacing the `tools/units/rig.py`
primitive build with photogrammetry-grade geometry while keeping that file's
rig contract byte-for-byte: the same bone names, the same five clips, the
same role vocabulary, the same pose-swap mechanism.

    /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio \
        -P tools/export_meshy_sniper.py -- [--preview DIR] [--out PATH]

## The source: two POSES, not two animations

`art/blend/KDF/sniper/` holds two `image-to-3d-texture` blends -- one prone
pair, one standing pair. Each is a single welded ~1M-vertex shell with one
material and three packed textures, zero armatures, zero actions, zero
vertex groups. They are not rigged and they are not riggable into each
other: 982,047 vs 965,239 vertices, different topology, different ghillie
drape, no vertex correspondence whatsoever. Nothing here skins one and poses
it into the other, and nothing here tries.

It does not need to. The contract asks for CLIPS, and this unit's five clips
need exactly two postures -- see the mapping below.

## prone -> `down`? Yes, but not for the obvious reason

`docs/superpowers/specs/2026-08-10-roof-troops-and-sniper-posture-design.md`
(status: approved) settled this, and `tools/units/teams.py:sniper_team()`
implements it:

    posture = "standing" if clip == "move" else "prone"

So: `idle`, `fire`, `down` and `wreck` are ALL prone; only `move` stands.
Prone is not this unit's death pose, it is its RESTING pose -- "on the
scope; this is the sniper's identity". `down` cannot mean "go prone" for a
team that is already prone, so it means closing up and flattening further.

That satisfies hard-won fact 3 exactly. `resolveClip` returns `down` for
pinned and routed units as well as dead ones, on `LoopRepeat` -- so a `down`
that FALLS makes a suppressed man collapse over and over. A static prone
pose has precisely zero vertical hip travel and loops forever without
artefact. The inverse mapping (standing -> `idle`, prone -> `down`) is the
trap: it would put the sniper on his feet on overwatch and drop him prone
only under fire, which is the bug the 2026-08-10 spec was written to fix.

## How two poses live in one rigged file

By the bone-scale swap `packages/render/src/three/units/mesh-unit.ts` already
documents and the SHIPPED `sniper_team.glb` already ships. Measured from that
file rather than assumed (see this task's report): its `idle`/`fire`/`down`/
`wreck` clips key `snp_a_root`/`snp_b_root` to scale 0 and
`snp_a_death_root`/`snp_b_death_root` to scale 1; `move` inverts it. The
"death" root holds the PRONE rig and is visible in four clips of five.

This file keeps that exact convention and those exact bone names, so the
prefix disagreement between the mesh-unit contract (`f<N>_`) and the shipped
teams (`snp_a_`, `mtr_crew0_`) is not re-litigated here: nothing in the
runtime reads a bone name (`buildMeshUnitTemplate` reads roles and clip
names only; `instantiateMeshUnit` calls `SkeletonUtils.clone`), so matching
the file being replaced is the lowest-surprise choice available.

## Forward: -Y, established four independent ways

Hard-won fact 1 is that a still render cannot answer forward on its own.
So four measurements, not one, and two of them are pure geometry:

  1. Textured ortho render from -Y shows both figures' goggles and faces
     square to camera.
  2. Ortho render from -X (image-right = -Y) shows the ghillie cape hanging
     off the BACK at +Y, faces at -Y.
  3. GEOMETRY, prone: the vertex-count profile along Y has a thin protrusion
     at the -Y end (6,991 verts in the outermost slab, then 1,607 and 1,217
     -- a tube, not a body) while the body mass peaks at +0.19..+0.28. That
     protrusion is the rifle barrel, and a prone sniper's barrel IS his
     facing.
  4. GEOMETRY, both poses: vertices classified `weapon` (below) sit forward
     of the body centroid in Y -- prone dY = -0.344, standing dY = -0.194.
     Weapons are carried in front. Both poses agree, independently.

Source -Y -> contract +X is +90 degrees about Z, matching
`tools/buildings/export_meshy_house.py`'s finding for this same Meshy
product line.

**No `apply_forward_fix` here, deliberately.** That post-export glTF wrapper
exists in `tools/import_meshy_soldier.py` because that pipeline imports an
asset that ARRIVES rigged, and `bpy.ops.object.transform_apply` cannot touch
an existing armature's `matrix_world`. This asset arrives with no armature
at all: the rotation below is applied to raw vertex coordinates while the
mesh is still a free-floating shell, before any bone exists, so there is
nothing for it to be inert against. Verified after export by measuring where
the barrel lands, not by assuming (see `--verify`).

## Scale: ONE metres-per-unit for both files, and that is a measurement

Meshy normalises its longest axis to ~1.9 units, and the two files' longest
axes measure DIFFERENT real things (prone: body-plus-barrel along Y;
standing: two-men-plus-rifle along X). Normalising each to its own longest
axis would give them different metres-per-unit and the team would visibly
change size the instant it started moving.

It would also be unnecessary. Measured on SHOULDER/TORSO BREADTH -- the one
feature that is the same anatomical structure in both postures and is not
contaminated by limb pose, by the weapon, or by the ghillie cape (which
hangs at the back, along Y, not across the sides) -- the two files already
agree to 3%: 0.490 units prone vs 0.504 units standing, which is inside the
5% spread between the two FIGURES within a single file (standing figure
heights 1.485 and 1.417). Length-based measures disagree by 13%, but only
because a prone shooter's outstretched arms make him longer than he is tall;
that is anatomy, not a scale error.

So one factor, anchored on the shipped asset the way
`export_meshy_house.py` derives `REAL_METRES_HOUSE` rather than hand-typing
it: `_measure_shipped_standing_height()` splits the shipped GLB's vertices
by which bone dominates them and reports the standing rig's own height,
1.670 m. Independent cross-check: that factor puts this team's prone forward
footprint at 2.19 m against the shipped prone's 2.235 m -- 2%, from a number
derived only from the standing pose.
"""
import argparse
import json
import math
import os
import struct
import sys

import numpy as np

# `bpy` and `mathutils` are imported lazily inside `main()`. Everything under
# "verification" below reads the exported GLB's own bytes and must be runnable
# as `python3 tools/export_meshy_sniper.py --verify`, without Blender -- a
# verifier that can only run inside the process that produced the file is
# checking its author's intent, not its output.
bpy = None
Quaternion = Vector = None

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/KDF/sniper"
SRC = {
    "prone": os.path.join(
        SRC_DIR, "Meshy_AI_sniper_team_prone_0831163759_image-to-3d-texture.blend"
    ),
    "standing": os.path.join(
        SRC_DIR, "Meshy_AI_sniper_team_standing_0831163836_image-to-3d-texture.blend"
    ),
}
OUT_PATH = os.path.join(REPO, "art", "meshes", "sniper_team.glb")
SHIPPED_REF = OUT_PATH

# --- plinth removal -------------------------------------------------------
# Both sculpts sit on a Meshy display base. Cut heights are measured, not
# guessed: a sweep of nine candidate planes (see the report) shows the prone
# round plinth clearing at zmin+0.055 (removes 26% of vertices) while the
# standing RECTANGULAR slab needs zmin+0.095 -- it has rocks, grass tufts and
# the figures' own boot soles modelled into it, so a shallower plane leaves
# one welded island still containing the slab. zmin+0.065 removed only 7,500
# vertices and did not separate anything.
CUT = {"prone": 0.055, "standing": 0.095}

# Connected components smaller than this are ghillie strips and gear severed
# by the cut plane, plus the standing slab's grass tufts and rocks. Same
# device as `export_meshy_house.py`'s `WRECK_SIZE_FLOOR`. The two figures are
# the two largest components in both files by two orders of magnitude
# (prone: 355,857 / 344,143 against a third place of 7,171).
ISLAND_FLOOR = 12000

# --- triangle budgets, and why they differ by 2.5x ------------------------
# Not symmetric inputs. Prone survives brutal decimation -- at ~8k triangles
# the figures, rifle, bipod, scope and boots all still read. Standing does
# NOT: at 9.6k it shatters into faceted spikes and open holes. The cause is
# structural rather than tunable. Prone's mass is a compact horizontal slab;
# standing spreads the same million vertices over a tall thin volume whose
# surface is mostly a cape of thousands of thin vertical ghillie ribbons,
# and a ribbon two triangles wide cannot lose a triangle without holing.
TRI_BUDGET = {"prone": 8000, "standing": 20000}

# --- roles ---------------------------------------------------------------
# HONEST SUBSET, and the honesty is the point. `mesh-role.ts`'s vocabulary is
# ten roles; this asset ships three of them.
#
#  * `face`/`skin_shadow` are ABSENT ON PURPOSE. Both figures are masked head
#    to foot in ghillie, balaclava and goggles -- there is no visible skin
#    anywhere on either man. `face` shades through the `skin` ramp, so
#    shipping it would paint flesh tones onto fabric. Fewer honest roles
#    beats an invented boundary; `export_meshy_house.py` and `technical.glb`
#    already made this call on record.
#  * `webbing` is absent for a different reason: it was TESTED and did not
#    separate. See `classify()`.
#  * `metal` is not shipped separately because `mesh-role.ts` gives `metal`
#    and `weapon` the identical ramp slice (`gunmetal[2:4]`), so splitting
#    them would cost a mesh and change nothing on screen.
ROLE_UNIFORM = "uniform"
ROLE_WEAPON = "weapon"
ROLE_BOOT = "boot"

# Weapon classification. Luminance ALONE fails on this asset, and failing to
# notice that is how the previous KDF Meshy attempt
# (`import_meshy_soldier_irregular.py`) ended up with "nothing but
# directional-shading luminance bands": the texture has lighting baked in, so
# a shadowed tan ghillie underside is darker than a lit gunmetal receiver.
# The prone luminance histogram has no valley at all.
#
# BLUE/RED RATIO is the fix, and it is lighting-invariant by construction:
# baked shading is multiplicative, so it cancels in a channel ratio. Tan
# ghillie is warm (B/R ~ 0.78); gunmetal is neutral (B/R ~ 1.00). The
# standing histogram is cleanly bimodal on it -- a 398k-vertex spike at 0.78
# against a second population at 0.98-1.06, with a deep valley between.
# Luminance is kept only as a secondary guard so that a neutral-but-BRIGHT
# vertex (a bleached ghillie tip) is not called a rifle.
WEAPON_NEUTRAL_MIN = 0.93
WEAPON_LUM_MAX = 0.36

# Boots are taken SPATIALLY, not by colour, because on this asset colour
# cannot see them: the standing figure's bottom band measures mean luminance
# 0.469 against 0.433 for the body, i.e. the boots are marginally BRIGHTER
# than the ghillie, not darker. They are canvas-and-rubber under a ghillie
# overhang, not black leather. Height is the honest signal.
BOOT_ZFRAC = 0.075

# --- scale ---------------------------------------------------------------
# Measured off the shipped GLB by `_measure_shipped_standing_height()`; this
# literal is the fallback if that file is ever missing, and the two are
# asserted to agree at build time.
SHIPPED_STANDING_HEIGHT_M = 1.670

# --- composition ---------------------------------------------------------
# `teams.sniper_team` puts the pair at `close` 0.24 for idle/move and 0.12
# for down/wreck -- "`down` cannot be 'go prone' here, since idle already is.
# Closing up and flattening is the only thing left that reads as a change."
# The DELTA is what carries meaning, and it cannot be reused verbatim: those
# numbers suit `kit.py`'s blocky ~0.3 m figures, whereas these sculpted men
# are ~0.56 m across, so a 0.24 m half-spacing would interpenetrate them.
# The gap between the two prone bodies is set explicitly instead, and closes
# by `CLOSE_DELTA_M` per figure for `down`/`wreck`.
# These sculpted men are broad: ~0.74-0.90 m across the ghillie, against the
# ~0.3 m of a `kit.py` figure. Left at arm's length the pair spans 1.94 m
# laterally where the asset it replaces spans 0.90 m, so the gap is closed to
# where the ghillie fringes just meet. Interpenetrating fringe is invisible at
# gameplay size; a unit twice the width of the one it replaces is not.
PRONE_GAP_IDLE_M = 0.05
CLOSE_DELTA_M = 0.025
STANDING_GAP_M = 0.05

# --- clips ---------------------------------------------------------------
FPS = 24
MOVE_FRAMES = 24          # one full two-step cycle
STATIC_FRAMES = (0, 1)    # see rig.py's `_key_scale`: never a single key

CLIPS = ("idle", "move", "fire", "down", "wreck")
PRONE_CLIPS = ("idle", "fire", "down", "wreck")

FIG_PREFIX = ("snp_a", "snp_b")


# ==========================================================================
# small helpers
# ==========================================================================
def log(msg):
    print(f"SNIPER: {msg}", flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_arrays(ob):
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    return co.reshape(n, 3)


def set_coords(ob, co):
    ob.data.vertices.foreach_set("co", co.ravel())
    ob.data.update()


def base_color_image(ob):
    """The `base_color` texture feeding this object's material.

    Resolved by walking links and comparing node NAMES, never by RNA
    identity: `link.from_node is node` is unreliable in Blender (RNA structs
    are re-wrapped on each access) and silently returned None on the first
    probe run of this asset, which is the sort of failure that looks like a
    missing texture rather than a bad comparison.
    """
    tree = ob.data.materials[0].node_tree
    for link in tree.links:
        if link.to_socket.name == "Base Color" and link.from_node.type == "TEX_IMAGE":
            return tree.nodes[link.from_node.name].image
    raise RuntimeError(f"{ob.name}: no image feeding Base Color")


def sample_vertex_colours(ob, img, size=512):
    """Per-vertex base colour, averaged over the loops that touch each vertex.

    Called AFTER decimation on purpose: decimation preserves the UV layer, so
    sampling late costs nothing and avoids relying on a colour attribute
    surviving a collapse. `export_meshy_house.py` measures its own role
    thresholds on the decimated mesh for the same reason.
    """
    img.scale(size, size)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)

    me = ob.data
    nl = len(me.loops)
    uv = np.empty(nl * 2, dtype=np.float32)
    me.uv_layers[0].data.foreach_get("uv", uv)
    uv = uv.reshape(nl, 2)
    lv = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)

    ix = np.clip((uv[:, 0] % 1.0) * size, 0, size - 1).astype(np.int32)
    iy = np.clip((uv[:, 1] % 1.0) * size, 0, size - 1).astype(np.int32)
    lc = px[iy, ix, :3]

    n = len(me.vertices)
    acc = np.zeros((n, 3), dtype=np.float64)
    cnt = np.zeros(n, dtype=np.float64)
    np.add.at(acc, lv, lc)
    np.add.at(cnt, lv, 1.0)
    return acc / np.maximum(cnt, 1.0)[:, None]


# ==========================================================================
# phase 1 -- load, de-plinth, split into two figures
# ==========================================================================
def load_pose(pose):
    """Append `mesh_node` from one source blend and rename it uniquely."""
    path = SRC[pose]
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = [n for n in src.objects if n == "mesh_node"]
    ob = dst.objects[0]
    bpy.context.scene.collection.objects.link(ob)
    ob.name = f"{pose}_src"
    ob.data.name = f"{pose}_src"
    co = mesh_arrays(ob)
    log(f"{pose}: loaded {len(co)} verts, {len(ob.data.polygons)} polys")
    return ob


def cut_plinth(ob, pose):
    import bmesh

    co = mesh_arrays(ob)
    zcut = co[:, 2].min() + CUT[pose]
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    doomed = [v for v in bm.verts if v.co.z <= zcut]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    log(f"{pose}: plinth cut at zmin+{CUT[pose]} -> {len(ob.data.vertices)} verts "
        f"({len(doomed)} removed)")


def split_figures(ob, pose):
    """Flood-fill into connected components, keep the two biggest.

    Must run BEFORE decimation. The severed ghillie strips and grass tufts
    left at the cut plane are geometrically tiny but numerous; decimating
    with them still attached spends budget on them and turns them into the
    floating flakes seen in an early 8k prone render.
    """
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.mesh.separate(type="LOOSE")
    parts = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    parts.sort(key=lambda o: len(o.data.vertices), reverse=True)
    sizes = [len(o.data.vertices) for o in parts]
    log(f"{pose}: {len(parts)} islands, largest {sizes[:4]}, floor {ISLAND_FLOOR}")
    keep, drop = parts[:2], parts[2:]
    if len(keep) < 2 or len(keep[1].data.vertices) < ISLAND_FLOOR:
        raise RuntimeError(f"{pose}: expected two figure islands, got {sizes[:4]}")
    for o in drop:
        bpy.data.objects.remove(o, do_unlink=True)
    for i, o in enumerate(keep):
        o.name = f"{pose}_fig{i}"
    return keep


# ==========================================================================
# phase 2 -- decimate
# ==========================================================================
def decimate(ob, target_tris, tag):
    before = len(ob.data.polygons)
    ratio = min(1.0, float(target_tris) / max(1, before))
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f"{tag}: decimated {before} -> {len(ob.data.polygons)} tris "
        f"({len(ob.data.vertices)} verts, ratio {ratio:.5f})")


# ==========================================================================
# phase 3 -- role classification
# ==========================================================================
def classify(ob, img, tag):
    """Per-vertex role, then per-face role by majority vote.

    Returns (face_roles, stats). The `webbing` experiment lives here as a
    measurement rather than a comment: the mid-tone band between ghillie and
    gunmetal is reported every run, and it is not shipped as its own role
    because it does not form a mode -- it is the continuum BETWEEN the two
    real populations (shadowed cloth grading into lit metal), which is
    exactly the signal `import_meshy_soldier_irregular.py` warned reads as
    equipment and is really shading.
    """
    col = sample_vertex_colours(ob, img)
    co = mesh_arrays(ob)
    lum = col.mean(1)
    neutral = col[:, 2] / np.maximum(col[:, 0], 1e-6)

    zf = (co[:, 2] - co[:, 2].min()) / max(1e-9, float(np.ptp(co[:, 2])))

    vrole = np.full(len(co), ROLE_UNIFORM, dtype=object)
    is_weapon = (neutral > WEAPON_NEUTRAL_MIN) & (lum < WEAPON_LUM_MAX)
    vrole[is_weapon] = ROLE_WEAPON
    # Boot only where the figure actually stands on its feet. A prone
    # figure's boots are at the far end of its BODY, not at the bottom of
    # its bounding box, and the bottom band of a prone man is his chest.
    is_boot = np.zeros(len(co), bool)
    if tag.startswith("standing"):
        is_boot = (zf < BOOT_ZFRAC) & ~is_weapon
        vrole[is_boot] = ROLE_BOOT

    mid = (~is_weapon) & (neutral > 0.86) & (neutral <= WEAPON_NEUTRAL_MIN)
    log(f"{tag}: roles uniform={int((vrole == ROLE_UNIFORM).sum())} "
        f"weapon={int(is_weapon.sum())} boot={int(is_boot.sum())} "
        f"| webbing-candidate mid-band={int(mid.sum())} "
        f"({100.0 * mid.mean():.1f}%, not shipped -- see classify())")

    me = ob.data
    nf = len(me.polygons)
    fv = np.empty(nf * 3, dtype=np.int32)
    me.polygons.foreach_get("vertices", fv)
    fv = fv.reshape(nf, 3)
    code = np.zeros(len(co), np.int8)
    code[is_weapon] = 1
    code[is_boot] = 2
    fc = code[fv]
    # majority of three; ties fall to the lower code, i.e. toward uniform
    face_code = np.where(
        (fc[:, 0] == fc[:, 1]) | (fc[:, 0] == fc[:, 2]), fc[:, 0],
        np.where(fc[:, 1] == fc[:, 2], fc[:, 1], fc.min(1)),
    )
    return face_code


def split_by_role(ob, face_code, tag):
    """One object per role present, each carrying its own faces."""
    import bmesh

    out = {}
    for code, role in ((0, ROLE_UNIFORM), (1, ROLE_WEAPON), (2, ROLE_BOOT)):
        sel = np.flatnonzero(face_code == code)
        if len(sel) < 8:
            continue
        new = ob.copy()
        new.data = ob.data.copy()
        new.name = f"{tag}_{role}"
        new.data.name = new.name
        bpy.context.scene.collection.objects.link(new)
        bm = bmesh.new()
        bm.from_mesh(new.data)
        bm.faces.ensure_lookup_table()
        keep = set(sel.tolist())
        doomed = [f for i, f in enumerate(bm.faces) if i not in keep]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(new.data)
        bm.free()
        new.data.update()
        if len(new.data.vertices) == 0:
            bpy.data.objects.remove(new, do_unlink=True)
            continue
        out[role] = new
        log(f"{tag}: role {role} -> {len(new.data.polygons)} tris, "
            f"{len(new.data.vertices)} verts")
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


# ==========================================================================
# phase 4 -- orientation, scale, placement
# ==========================================================================
def _measure_shipped_standing_height(path):
    """Standing-rig height, in metres, read out of the shipped GLB.

    The file carries BOTH rigs in one skin, so a plain bounding box would
    mix them. Vertices are split by which joint dominates their skin
    weights: anything whose heaviest joint is a `*_death_root` belongs to
    the prone rig, everything else to the standing one. glTF is Y-up, so the
    standing set's Y extent is the figure's height.

    This is `export_meshy_house.py`'s `_measure_existing_extent` move --
    derive the anchor from the asset that already ships and already passes
    the gates, rather than typing a number.
    """
    if not os.path.exists(path):
        log(f"scale: {path} absent -- falling back to {SHIPPED_STANDING_HEIGHT_M}")
        return SHIPPED_STANDING_HEIGHT_M
    with open(path, "rb") as fh:
        data = fh.read()
    jlen = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blob = b""
    while off < len(data):
        ln, ty = struct.unpack("<II", data[off:off + 8])
        if ty == 0x004E4942:
            blob = data[off + 8:off + 8 + ln]
        off += 8 + ln

    comp = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
            5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def read(idx):
        a = gltf["accessors"][idx]
        fmt, sz = comp[a["componentType"]]
        nc = ncomp[a["type"]]
        bv = gltf["bufferViews"][a["bufferView"]]
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride") or sz * nc
        return np.array([
            struct.unpack_from("<" + fmt * nc, blob, base + k * stride)
            for k in range(a["count"])
        ], dtype=np.float64), a["componentType"]

    nodes = gltf["nodes"]
    joints = gltf["skins"][0]["joints"]
    dead = {i for i, j in enumerate(joints) if "death_root" in nodes[j].get("name", "")}
    tops = []
    for nd in nodes:
        if "mesh" not in nd:
            continue
        # BODY height only. The shipped file's `metal` mesh tops out at
        # 1.684 m because it includes the rifle held above the head, and
        # anchoring on that would make every figure 0.8% short. `uniform`
        # is the like-for-like counterpart of what is measured on this
        # asset's own side (body vertices, weapon excluded).
        if gltf["meshes"][nd["mesh"]].get("name") != "uniform":
            continue
        for prim in gltf["meshes"][nd["mesh"]]["primitives"]:
            pos, _ = read(prim["attributes"]["POSITION"])
            jt, _ = read(prim["attributes"]["JOINTS_0"])
            wt, ct = read(prim["attributes"]["WEIGHTS_0"])
            if ct == 5123:
                wt = wt / 65535.0
            elif ct == 5121:
                wt = wt / 255.0
            dom = jt[np.arange(len(jt)), wt.argmax(1)].astype(int)
            stand = pos[~np.isin(dom, list(dead))]
            if len(stand):
                tops.append(np.percentile(stand[:, 1], 99.8))
    h = float(max(tops))
    log(f"scale: shipped standing rig height = {h:.4f} m (measured from {os.path.basename(path)})")
    return h


def orient_and_scale(role_obs, metres_per_unit):
    """Rotate source -Y onto contract +X, then scale to metres.

    Applied to raw vertex coordinates, on an unrigged shell, before any
    armature exists -- see the module docstring on why no post-export
    forward fix is used or needed here.
    """
    c, s = math.cos(math.pi / 2), math.sin(math.pi / 2)
    for ob in role_obs:
        co = mesh_arrays(ob)
        x, y = co[:, 0].copy(), co[:, 1].copy()
        co[:, 0] = x * c - y * s
        co[:, 1] = x * s + y * c
        set_coords(ob, co * metres_per_unit)


def figure_bounds(role_obs):
    co = np.concatenate([mesh_arrays(o) for o in role_obs])
    return co.min(0), co.max(0)


def translate(role_obs, delta):
    for ob in role_obs:
        set_coords(ob, mesh_arrays(ob) + np.asarray(delta, dtype=np.float64))


# ==========================================================================
# phase 5/6 -- armature, weights, join
# ==========================================================================
def build_armature(figs):
    """One armature, four figure roots.

    `{p}_death_root` carries the PRONE sculpt and is a lone rigid bone: a
    static pose has nothing to articulate. `{p}_root` carries the STANDING
    sculpt and gets a small leg chain, because `move` is the one clip that
    genuinely has to move and a standing pose translated across the ground
    is the classic tell.
    """
    arm_data = bpy.data.armatures.new("sniper_rig")
    arm = bpy.data.objects.new("sniper_rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    for p in FIG_PREFIX:
        f = figs[p]
        b = eb.new(f"{p}_death_root")
        b.head = Vector((f["prone_x"], f["prone_y"], 0.0))
        b.tail = b.head + Vector((0.0, 0.0, 0.20))

        root = eb.new(f"{p}_root")
        root.head = Vector((f["stand_x"], f["stand_y"], 0.0))
        root.tail = root.head + Vector((0.0, 0.0, 0.12))

        h = f["stand_h"]
        pelvis = eb.new(f"{p}_pelvis")
        pelvis.head = Vector((f["stand_x"], f["stand_y"], 0.53 * h))
        pelvis.tail = pelvis.head + Vector((0.0, 0.0, 0.25 * h))
        pelvis.parent = root

        for side, sgn in (("L", 1.0), ("R", -1.0)):
            hipy = f["stand_y"] + sgn * 0.09
            thigh = eb.new(f"{p}_thigh_{side}")
            thigh.head = Vector((f["stand_x"], hipy, 0.47 * h))
            thigh.tail = Vector((f["stand_x"], hipy, 0.26 * h))
            thigh.parent = pelvis
            shin = eb.new(f"{p}_shin_{side}")
            shin.head = thigh.tail.copy()
            shin.tail = Vector((f["stand_x"], hipy, 0.02 * h))
            shin.parent = thigh
            shin.use_connect = True

    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"armature: {len(arm_data.bones)} bones -- "
        f"{sorted(b.name for b in arm_data.bones)}")
    return arm


def _sstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def assign_weights(ob, prefix, pose, fig):
    """Vertex groups, computed analytically from position.

    Nothing here uses `bpy.ops.object.data_transfer` -- hard-won fact 5, it
    returns FINISHED and does nothing in this headless Blender 5.2. Nothing
    needs to: weights are a closed-form function of a vertex's own height
    and lateral offset, not a transfer from a donor mesh.
    """
    co = mesh_arrays(ob)
    n = len(co)
    if pose == "prone":
        g = ob.vertex_groups.new(name=f"{prefix}_death_root")
        g.add(list(range(n)), 1.0, "REPLACE")
        return

    h = fig["stand_h"]
    t = co[:, 2] / max(h, 1e-6)
    w_pelvis = _sstep((t - 0.44) / 0.12)
    leg = 1.0 - w_pelvis
    w_shin = _sstep((0.30 - t) / 0.12) * leg
    w_thigh = leg - w_shin
    left = co[:, 1] >= fig["stand_y"]

    groups = {
        f"{prefix}_pelvis": w_pelvis,
        f"{prefix}_thigh_L": np.where(left, w_thigh, 0.0),
        f"{prefix}_thigh_R": np.where(left, 0.0, w_thigh),
        f"{prefix}_shin_L": np.where(left, w_shin, 0.0),
        f"{prefix}_shin_R": np.where(left, 0.0, w_shin),
    }
    for name, w in groups.items():
        g = ob.vertex_groups.new(name=name)
        idx = np.flatnonzero(w > 1e-4)
        for i in idx:
            g.add([int(i)], float(w[i]), "REPLACE")


def join_by_role(role_map):
    """One mesh per role, joined across all four figures.

    Meshes are joined BEFORE anything is parented to the armature -- hard-won
    fact 4's ordering. Vertex groups survive a join by NAME, which is why the
    groups above are named for their bones rather than indexed.
    """
    merged = {}
    for role, obs in role_map.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = role
        ob.data.name = role
        ob["rl_role"] = role
        merged[role] = ob
        log(f"joined role {role}: {len(ob.data.vertices)} verts, "
            f"{len(ob.data.polygons)} tris")
    return merged


def bind(merged, arm):
    for ob in merged.values():
        ob.parent = arm
        ob.matrix_parent_inverse = arm.matrix_world.inverted()
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        ob.data.materials.clear()


# ==========================================================================
# phase 7 -- clips
# ==========================================================================
def _new_action(arm, name):
    """A fresh, self-contained action -- every bone explicitly keyed.

    Copied in intent from `rig.py`'s own `_new_action` and for the bug it
    records: a bone an action never touches keeps whatever value the
    previously built action left in memory, which makes clips depend on the
    order they were authored in.
    """
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    return action


def _key(pb, frame, loc=True, rot=True, scale=True):
    if loc:
        pb.keyframe_insert(data_path="location", frame=frame)
    if rot:
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    if scale:
        pb.keyframe_insert(data_path="scale", frame=frame)


def _world_loc(pb, vec):
    """Set a pose-bone LOCATION expressed in world axes.

    `pose_bone.location` is in the bone's own rest basis, and a bone's local
    Y runs head->tail -- so for an upright root bone, local Z is world -Y,
    not world up. Writing `(0, 0, bob)` there moves the figure SIDEWAYS.
    That bug shipped into the first build of this file and was caught by
    `check_clip_semantics` reporting `move` vertical travel of exactly zero,
    which is the whole reason that gate exists.
    """
    pb.location = pb.bone.matrix_local.to_3x3().inverted() @ Vector(vec)


def _world_rot(pb, axis, angle):
    """Set a pose-bone rotation expressed about a WORLD axis.

    Bone-local axes depend on head/tail and roll, so authoring a leg swing
    directly in local space is a guess. This converts once, correctly:
    `q_local = M^-1 · q_world · M`, with `M` the rest bone's own basis.
    """
    m = pb.bone.matrix_local.to_3x3()
    qw = Quaternion(axis, angle).to_matrix()
    pb.rotation_quaternion = (m.inverted() @ qw @ m).to_quaternion()


def build_clips(arm, figs):
    dead = [f"{p}_death_root" for p in FIG_PREFIX]
    live = [f"{p}_root" for p in FIG_PREFIX]
    pb = arm.pose.bones

    for name in PRONE_CLIPS:
        _new_action(arm, name)
        close = CLOSE_DELTA_M if name in ("down", "wreck") else 0.0
        for p in FIG_PREFIX:
            d = pb[f"{p}_death_root"]
            d.scale = (1.0, 1.0, 1.0)
            # Lateral close-up, expressed in the bone's own rest basis so the
            # sign follows the bone rather than a global assumption.
            sgn = -1.0 if figs[p]["prone_y"] > 0 else 1.0
            shift = Vector((0.0, sgn * close, 0.0))
            if name == "fire" and p == "snp_a":
                # A 25 mm rearward recoil on the anti-materiel shooter alone.
                # HORIZONTAL ONLY: the 2026-08-10 spec forbids `fire` changing
                # a figure's height, because the clip is latched per shot and
                # a height change makes the whole team bob through a
                # firefight. Zero vertical component, by construction.
                shift = shift + Vector((-0.025, 0.0, 0.0))
            _world_loc(d, shift)
            for fr in STATIC_FRAMES:
                _key(d, fr)
            for bn in [f"{p}_root", f"{p}_pelvis"] + [
                f"{p}_{seg}_{s}" for seg in ("thigh", "shin") for s in ("L", "R")
            ]:
                b = pb[bn]
                b.scale = (0.0, 0.0, 0.0) if bn in live else (1.0, 1.0, 1.0)
                b.location = (0.0, 0.0, 0.0)
                b.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
                for fr in STATIC_FRAMES:
                    _key(b, fr)
        log(f"clip {name}: prone visible, close={close:.3f} m")

    # ---- move: the standing pair, walking -------------------------------
    _new_action(arm, "move")
    n = MOVE_FRAMES
    for i, p in enumerate(FIG_PREFIX):
        # HARD-WON FACT 6: never ship byte-identical keyframes across
        # figures. Half a cycle apart, so the pair does not march in
        # lockstep the way squads used to.
        phase = 0.5 * i
        d = pb[f"{p}_death_root"]
        d.scale = (0.0, 0.0, 0.0)
        d.location = (0.0, 0.0, 0.0)
        root = pb[f"{p}_root"]
        root.scale = (1.0, 1.0, 1.0)
        for fr in range(n + 1):
            u = (fr / n + phase) % 1.0
            a = 2.0 * math.pi * u
            for fr2, b in ((fr, d),):
                b.scale = (0.0, 0.0, 0.0)
                _key(b, fr2)
            # pelvis bob: two dips per cycle, one per footfall
            bob = -0.018 * abs(math.sin(a))
            _world_loc(root, (0.0, 0.0, bob))
            root.scale = (1.0, 1.0, 1.0)
            _key(root, fr)
            _world_rot(pb[f"{p}_pelvis"], Vector((1, 0, 0)), 0.05 * math.sin(2 * a))
            _key(pb[f"{p}_pelvis"], fr)
            for side, sgn in (("L", 1.0), ("R", -1.0)):
                swing = 0.40 * math.sin(a + (0.0 if sgn > 0 else math.pi))
                _world_rot(pb[f"{p}_thigh_{side}"], Vector((0, 1, 0)), swing)
                _key(pb[f"{p}_thigh_{side}"], fr)
                bend = -0.55 * max(0.0, math.sin(a + (0.0 if sgn > 0 else math.pi) + 1.4))
                _world_rot(pb[f"{p}_shin_{side}"], Vector((0, 1, 0)), bend)
                _key(pb[f"{p}_shin_{side}"], fr)
    log(f"clip move: standing visible, {n} frames, per-figure phase offset 0.5")


# ==========================================================================
# phase 8 -- export + semantics gate
# ==========================================================================
def check_clip_semantics(arm, figs):
    """Port of `import_meshy_soldier.py`'s `CLIP_SEMANTICS` gate.

    Twice in this project a Meshy clip was bound to a contract name whose
    MEANING it did not match (`Side_Shot` -> `fire`, a hit reaction;
    `Shot_and_Blown_Back` -> `down`, a death fall). Here the properties are
    true by construction, which is exactly why asserting them is cheap and
    worth doing: it turns "by construction" into "measured".
    """
    scene = bpy.context.scene
    results = {}
    for name in CLIPS:
        action = bpy.data.actions[name]
        arm.animation_data.action = action
        fr0, fr1 = (int(action.frame_range[0]), int(action.frame_range[1]))
        heights = []
        for fr in range(fr0, fr1 + 1):
            scene.frame_set(fr)
            dg = bpy.context.evaluated_depsgraph_get()
            ev = arm.evaluated_get(dg)
            zs = []
            for p in FIG_PREFIX:
                for bn in (f"{p}_death_root", f"{p}_pelvis"):
                    zs.append(ev.pose.bones[bn].matrix.translation.z)
            heights.append(zs)
        h = np.array(heights)
        travel = float((h.max(0) - h.min(0)).max())
        results[name] = travel
    idle_t = results["idle"]
    problems = []
    for name in ("down", "wreck"):
        if results[name] > 1e-6:
            problems.append(f"{name}: vertical travel {results[name]:.5f} m, must be 0 "
                            f"(hard-won fact 3 -- `down` is a HELD pose on LoopRepeat)")
    if results["move"] < 1e-4:
        problems.append(
            f"move: vertical travel {results['move']:.5f} m -- a standing pose "
            f"sliding across the ground with no gait is the classic tell, and "
            f"exactly zero means the bob was written into the wrong axis"
        )
    if results["fire"] > idle_t + 1e-6:
        problems.append(f"fire: vertical travel {results['fire']:.5f} m exceeds idle's "
                        f"{idle_t:.5f} m -- the 2026-08-10 spec forbids `fire` "
                        f"changing a figure's height")
    for k, v in results.items():
        log(f"semantics: {k} vertical travel = {v:.5f} m")
    if problems:
        raise SystemExit("CLIP SEMANTICS FAILED:\n  " + "\n  ".join(problems))
    log("semantics: gate passed")


def export_glb(arm, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        # Off by default and drops `rl_role` SILENTLY if forgotten.
        export_extras=True,
        # No UVs. Hard-won fact 8 -- zero materials ship and colour comes from
        # the palette ramp indexed by NORMAL -- so a texcoord channel is
        # bytes nothing will ever read. Dropping it took this file from
        # 2,169 KB to the size reported at the end of the run.
        export_texcoords=False,
        export_tangents=False,
        # Hard-won fact 8: zero materials ship; colour comes from the palette
        # at runtime through `rl_role`.
        export_materials="NONE",
        export_rest_position_armature=True,
    )
    log(f"exported {path} ({os.path.getsize(path) / 1024:.1f} KB)")


# ==========================================================================
# optional preview render -- the role-classification confirmation step
# ==========================================================================
def preview(out_dir, merged, arm, clips=("idle", "move", "down")):
    """Flat-colour render per role, from four directions.

    `import_meshy_soldier_irregular.py` insists on this and it caught that
    script's own errors: a cluster that looks separable in a histogram can
    still be scattered across the model. Never hardcode a threshold without
    looking at where it actually lands.
    """
    os.makedirs(out_dir, exist_ok=True)
    colours = {ROLE_UNIFORM: (0.32, 0.42, 0.16, 1), ROLE_WEAPON: (0.10, 0.11, 0.14, 1),
               ROLE_BOOT: (0.62, 0.20, 0.09, 1)}
    for role, ob in merged.items():
        mat = bpy.data.materials.new(f"prev_{role}")
        # Workbench in MATERIAL colour mode reads `diffuse_color` (the
        # viewport display colour), NOT the Principled BSDF -- setting the
        # BSDF gives a uniformly grey render that looks like the roles all
        # collapsed into one when in fact nothing was wrong with them.
        mat.diffuse_color = colours[role]
        ob.data.materials.clear()
        ob.data.materials.append(mat)

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "MATERIAL"
    sc.render.resolution_x = sc.render.resolution_y = 720
    sc.render.film_transparent = True
    allco = np.concatenate([mesh_arrays(o) for o in merged.values()])
    allco = np.concatenate([allco, allco])
    mn, mx = allco.min(0), allco.max(0)
    ctr = (mn + mx) / 2
    cd = bpy.data.cameras.new("pc")
    cd.type = "ORTHO"
    cd.ortho_scale = float(max(mx - mn)) * 1.15
    cam = bpy.data.objects.new("pc", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cd.ortho_scale = float(max(mx - mn)) * 1.35
    ctrv = Vector((float(ctr[0]), float(ctr[1]), float(ctr[2])))
    views = {
        "front": Vector((6.0, 0.0, 0.0)),
        "side": Vector((0.0, -6.0, 0.0)),
        "top": Vector((0.0, 0.0, 6.0)),
        # The locked dimetric-ish three-quarter view. Aimed by pointing a
        # -Z camera axis down the offset rather than by typing an euler,
        # which is how the first pass framed the figures half off-screen.
        "dimetric": Vector((5.0, -5.0, 4.2)),
    }
    for clip in clips:
        arm.animation_data.action = bpy.data.actions[clip]
        sc.frame_set(0)
        for nm, off in views.items():
            cam.location = ctrv + off
            cam.rotation_euler = (-off).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(out_dir, f"{clip}_{nm}.png")
            bpy.ops.render.render(write_still=True)
    log(f"preview: wrote {len(clips) * len(views)} renders to {out_dir}")


# ==========================================================================
# verification -- reads the EXPORTED BYTES, needs no Blender
# ==========================================================================
def _read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:4] != b"glTF":
        raise RuntimeError(f"{path}: not a GLB")
    jlen = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    off, blob = 20 + jlen, b""
    while off < len(data):
        ln, ty = struct.unpack("<II", data[off:off + 8])
        if ty == 0x004E4942:
            blob = data[off + 8:off + 8 + ln]
        off += 8 + ln
    return gltf, blob, len(data)


_COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
         5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _accessor(gltf, blob, idx):
    a = gltf["accessors"][idx]
    fmt, sz = _COMP[a["componentType"]]
    nc = _NCOMP[a["type"]]
    bv = gltf["bufferViews"][a["bufferView"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride") or sz * nc
    arr = np.array([struct.unpack_from("<" + fmt * nc, blob, base + k * stride)
                    for k in range(a["count"])], dtype=np.float64)
    if a["componentType"] == 5123:
        norm = arr / 65535.0
    elif a["componentType"] == 5121:
        norm = arr / 255.0
    else:
        norm = arr
    return arr, norm


# `mesh-role.ts`'s MESH_ROLES, restated. `buildMeshUnitTemplate` THROWS on a
# mesh whose role is outside this set, so a typo here is a unit that does not
# draw at all rather than one that draws wrong.
MESH_ROLES = ("uniform", "webbing", "boot", "face", "skin_shadow",
              "metal", "weapon", "wood", "charge", "keffiyeh")
# `sheet.ts`'s ClipName. `buildMeshUnitTemplate` THROWS on any other name.
CLIP_NAMES = ("idle", "move", "fire", "down", "wreck", "work")


def verify(path):
    """Check an exported GLB against everything the runtime and the contract
    will demand of it. Returns True/False and prints every finding."""
    gltf, blob, size = _read_glb(path)
    ok = True

    def bad(msg):
        nonlocal ok
        ok = False
        print(f"  FAIL {msg}")

    def good(msg):
        print(f"  ok   {msg}")

    print(f"VERIFY {path}  ({size / 1024:.1f} KB)")

    mats = gltf.get("materials", [])
    (good if not mats else bad)(
        f"materials: {len(mats)} (hard-won fact 8: zero materials ship)")

    nodes = gltf["nodes"]
    total_v = total_t = 0
    roles_seen = []
    for ni, nd in enumerate(nodes):
        if "mesh" not in nd:
            continue
        mesh = gltf["meshes"][nd["mesh"]]
        role = (nd.get("extras") or {}).get("rl_role")
        name = nd.get("name")
        # `buildMeshUnitTemplate` reads extras.rl_role FIRST, then falls back
        # to the node/mesh name -- "either alone has failed once already in
        # this project", so both are checked here.
        if role not in MESH_ROLES:
            bad(f"node {name!r}: extras.rl_role={role!r} not in MESH_ROLES")
        elif name != role:
            bad(f"node {name!r}: name disagrees with rl_role {role!r} "
                f"(the name is the runtime's fallback)")
        else:
            roles_seen.append(role)
        for prim in mesh["primitives"]:
            if "material" in prim:
                bad(f"{name}: primitive carries a material index")
            nv = gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
            nt = gltf["accessors"][prim["indices"]]["count"] // 3
            total_v += nv
            total_t += nt
            _, w = _accessor(gltf, blob, prim["attributes"]["WEIGHTS_0"])
            sums = w.sum(1)
            if abs(sums.min() - 1.0) > 2e-3 or abs(sums.max() - 1.0) > 2e-3:
                bad(f"{name}: skin weight sums span "
                    f"{sums.min():.5f}..{sums.max():.5f}, must be 1.0")
            else:
                good(f"{name}: {nv} verts, {nt} tris, weight sums 1.0")
    good(f"roles shipped: {sorted(roles_seen)}")
    good(f"TOTAL {total_v} verts, {total_t} tris")

    # ---- skeleton -------------------------------------------------------
    skins = gltf.get("skins", [])
    if len(skins) != 1:
        bad(f"expected exactly 1 skin (contract: one armature per file), got {len(skins)}")
    else:
        jn = [nodes[j].get("name") for j in skins[0]["joints"]]
        good(f"skin: {len(jn)} joints, prefixes "
             f"{sorted({n.split('_')[0] + '_' + n.split('_')[1] + '_' for n in jn})}")
        for want in ("snp_a_root", "snp_b_root",
                     "snp_a_death_root", "snp_b_death_root"):
            if want not in jn:
                bad(f"skin: missing figure root {want!r}")

    # ---- clips ----------------------------------------------------------
    anims = gltf.get("animations", [])
    names = [a.get("name") for a in anims]
    for n in names:
        if n not in CLIP_NAMES:
            bad(f"animation {n!r} is not a ClipName -- buildMeshUnitTemplate throws")
    for need in ("idle", "move", "fire", "down", "wreck"):
        if need not in names:
            bad(f"clip {need!r} missing")
    good(f"clips: {names}")

    # PER-CLIP KEYFRAME VARIATION, and cross-clip DIFFERENCE. A Blender defect
    # once produced correct clip names where every clip had collapsed to two
    # identical keyframes, so presence proves nothing on its own.
    sig = {}
    for a in anims:
        varied = 0
        vec = []
        for ch in a["channels"]:
            smp = a["samplers"][ch["sampler"]]
            _, out = _accessor(gltf, blob, smp["output"])
            if len({tuple(np.round(v, 6)) for v in out}) > 1:
                varied += 1
            vec.append((nodes[ch["target"]["node"]].get("name"),
                        ch["target"]["path"],
                        tuple(np.round(out.mean(0), 5))))
        sig[a["name"]] = tuple(sorted(vec))
        _, tin = _accessor(gltf, blob, a["samplers"][a["channels"][0]["sampler"]]["input"])
        print(f"  ok   clip {a['name']!r}: {len(a['channels'])} channels, "
              f"{varied} varying within the clip")
        if a["name"] == "move" and varied == 0:
            bad("clip 'move' has no channel that varies -- a static walk")
    dupes = [(x, y) for i, x in enumerate(sig) for y in list(sig)[i + 1:]
             if sig[x] == sig[y]]
    for x, y in dupes:
        # down/wreck ARE identical by design (teams.py treats them the same
        # apart from the material), so only an UNEXPECTED pair is a failure.
        if {x, y} != {"down", "wreck"}:
            bad(f"clips {x!r} and {y!r} are byte-identical -- one of them is "
                f"not doing what its name says")
    if {"down", "wreck"} in [{x, y} for x, y in dupes]:
        good("clips 'down' and 'wreck' identical, as teams.py intends")
    for pair in (("idle", "down"), ("idle", "move"), ("idle", "fire")):
        if sig[pair[0]] == sig[pair[1]]:
            bad(f"clips {pair[0]!r} and {pair[1]!r} do not differ")

    # ---- FORWARD, by measurement ----------------------------------------
    # glTF is Y-up and the contract's forward is +X. The check that matters is
    # not "which end sits at +X" (hard-won fact 1: a bounding box cannot
    # answer forward) but WHICH PART is there: the rifle. `weapon` vertices
    # must sit forward of the body's centroid along +X.
    body = weapon = None
    for nd in nodes:
        if "mesh" not in nd:
            continue
        role = (nd.get("extras") or {}).get("rl_role")
        for prim in gltf["meshes"][nd["mesh"]]["primitives"]:
            pos, _ = _accessor(gltf, blob, prim["attributes"]["POSITION"])
            if role == "weapon":
                weapon = pos if weapon is None else np.vstack([weapon, pos])
            else:
                body = pos if body is None else np.vstack([body, pos])
    if weapon is None or body is None:
        bad("cannot check forward: missing weapon or body geometry")
    else:
        d = weapon[:, 0].mean() - body[:, 0].mean()
        reach = weapon[:, 0].max() - body[:, 0].max()
        if d > 0 and reach > 0:
            good(f"forward: weapon centroid is +{d:.3f} m along +X of the body "
                 f"centroid, and reaches {reach:.3f} m past it -- "
                 f"muzzle points +X, the contract's forward")
        else:
            bad(f"forward: weapon centroid dX={d:+.3f}, reach={reach:+.3f} -- "
                f"the rifles are NOT pointing along +X")
        gmin, gmax = body.min(0), body.max(0)
        good(f"body extent (glTF X fwd, Y up, Z lat): "
             f"{np.round(gmax - gmin, 3).tolist()} m, "
             f"ground at Y={gmin[1]:+.4f}")
        if abs(gmin[1]) > 0.02:
            bad(f"figures do not stand on Y=0 (lowest body vertex {gmin[1]:+.4f})")

    print("VERIFY: PASS" if ok else "VERIFY: FAIL")
    return ok


# ==========================================================================
# main
# ==========================================================================
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--preview", default="")
    ap.add_argument("--verify", nargs="?", const=OUT_PATH, default=None,
                    help="parse an exported GLB and check it against the "
                         "contract; needs no Blender")
    args = ap.parse_args(argv)

    if args.verify is not None:
        raise SystemExit(0 if verify(args.verify) else 1)

    global bpy, Quaternion, Vector
    import bpy as _bpy
    from mathutils import Quaternion as _Q, Vector as _V
    bpy, Quaternion, Vector = _bpy, _Q, _V

    height_m = _measure_shipped_standing_height(SHIPPED_REF)

    reset_scene()

    # ---- per-pose geometry ----------------------------------------------
    per_pose = {}
    for pose in ("prone", "standing"):
        src = load_pose(pose)
        img = base_color_image(src)
        cut_plinth(src, pose)
        figs = split_figures(src, pose)
        budget = TRI_BUDGET[pose] // 2
        built = []
        for i, f in enumerate(figs):
            decimate(f, budget, f"{pose}_fig{i}")
            fc = classify(f, img, f"{pose}_fig{i}")
            built.append(split_by_role(f, fc, f"{pose}_fig{i}"))
        per_pose[pose] = built

    # ---- which figure is snp_a? -----------------------------------------
    # The anti-materiel shooter, identified by the largest weapon-vertex
    # extent -- not by a raw X sign, which flips with the frame and would
    # silently swap the pair between the two poses.
    order = {}
    for pose, built in per_pose.items():
        spans = []
        for roles in built:
            w = roles.get(ROLE_WEAPON)
            span = 0.0 if w is None else float(np.ptp(mesh_arrays(w), axis=0).max())
            spans.append(span)
        a_idx = int(np.argmax(spans))
        order[pose] = [a_idx, 1 - a_idx]
        log(f"{pose}: weapon spans {[round(s, 3) for s in spans]} -> "
            f"snp_a = fig{a_idx} (anti-materiel shooter)")

    # ---- orient, scale, place -------------------------------------------
    scale_probe = []
    for pose, built in per_pose.items():
        for roles in built:
            orient_and_scale(list(roles.values()), 1.0)
    # figure height is measured AFTER rotation (rotation about Z leaves Z alone)
    for roles in per_pose["standing"]:
        body = [o for r, o in roles.items() if r != ROLE_WEAPON]
        co = np.concatenate([mesh_arrays(o) for o in body])
        scale_probe.append(np.percentile(co[:, 2], 99.5) - co[:, 2].min())
    unit_h = float(np.mean(scale_probe))
    metres_per_unit = height_m / unit_h
    log(f"scale: standing figures measure {[round(v, 4) for v in scale_probe]} units "
        f"(mean {unit_h:.4f}); metres_per_unit = {height_m:.4f}/{unit_h:.4f} "
        f"= {metres_per_unit:.4f}")

    figs = {}
    for pose, built in per_pose.items():
        idxs = order[pose]
        for slot, idx in enumerate(idxs):
            roles = built[idx]
            obs = list(roles.values())
            for ob in obs:
                set_coords(ob, mesh_arrays(ob) * metres_per_unit)
        # place the pair symmetrically about the origin with a controlled gap
        pair = [built[i] for i in idxs]
        # Placement reads BODY bounds only. `snp_a` carries the anti-materiel
        # rifle across his body, and including it makes his bounding box
        # 1.268 m wide against the other figure's 0.817 m -- centring on that
        # shoves the MAN off-centre to make room for his barrel, and skews
        # the pair. The weapon is allowed to overhang; the bodies are what
        # must not intersect.
        bounds = [figure_bounds([o for r, o in roles.items() if r != ROLE_WEAPON])
                  for roles in pair]
        gap = PRONE_GAP_IDLE_M if pose == "prone" else STANDING_GAP_M
        widths = [b[1][1] - b[0][1] for b in bounds]
        centres = [-(gap / 2 + widths[0] / 2), (gap / 2 + widths[1] / 2)]
        # Forward is centred on the PAIR, not per figure, so whatever fore/aft
        # stagger the sculpt gives the sniper and his spotter survives --
        # `teams.sniper_team` sets one deliberately (x +0.10 against -0.24),
        # and centring each man independently would silently discard it and
        # leave two identical shapes abreast.
        pair_x = float(np.mean([(b[0][0] + b[1][0]) / 2 for b in bounds]))
        for slot, (roles, (mn, mx)) in enumerate(zip(pair, bounds)):
            cur_y = (mn[1] + mx[1]) / 2
            translate(list(roles.values()),
                      (-pair_x, centres[slot] - cur_y, -mn[2]))
            p = FIG_PREFIX[slot]
            e = figs.setdefault(p, {})
            e[f"{'prone' if pose == 'prone' else 'stand'}_x"] = 0.0
            e[f"{'prone' if pose == 'prone' else 'stand'}_y"] = centres[slot]
            if pose == "standing":
                e["stand_h"] = float(mx[2] - mn[2])
            e.setdefault("roles", {})[pose] = roles
        log(f"{pose}: widths {[round(w, 3) for w in widths]} m, "
            f"lateral centres {[round(c, 3) for c in centres]} m, gap {gap} m")

    # ---- weights, join, bind --------------------------------------------
    role_map = {}
    for p in FIG_PREFIX:
        for pose in ("prone", "standing"):
            for role, ob in figs[p]["roles"][pose].items():
                assign_weights(ob, p, pose, figs[p])
                role_map.setdefault(role, []).append(ob)
    merged = join_by_role(role_map)

    arm = build_armature(figs)
    bind(merged, arm)
    build_clips(arm, figs)
    check_clip_semantics(arm, figs)

    total_v = sum(len(o.data.vertices) for o in merged.values())
    total_t = sum(len(o.data.polygons) for o in merged.values())
    log(f"TOTAL {total_v} verts, {total_t} tris across {len(merged)} role meshes")

    export_glb(arm, args.out)
    if args.preview:
        preview(args.preview, merged, arm)


if __name__ == "__main__":
    main()
