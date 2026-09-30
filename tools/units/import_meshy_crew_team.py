"""Build a two-man crew team GLB from ONE Meshy A-pose figure, through rig.py.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_crew_team.py -- manpad_team
    ... -- recoilless_team
    ... -- all

Writes `art/meshes/<team_id>.glb` -- WP-A3.1 (GH-179) batch B2
(`docs/art/meshy-prompts-units.md` §8-9). Owner of both files in
`rig.TEAM_MESH_OWNER`, so `export_mesh_team.py -- all` skips them.

SOURCES (`art/meshy/<team>-20260930-01a0f2af/model.glb`, Meshy text-to-3d
preview in `--pose a-pose`, then REMESH at 1,500 tris; no material, no rig):

  manpad_team      preview 01a0f2ac-f4e5-7632-8b48-d8813d50890c,
                   remesh  01a0f2af-b00a-715f-9b29-424e409d471a
  recoilless_team  preview 01a0f2ac-f5b1-7146-b3e3-73be95e86ff2,
                   remesh  01a0f2af-b122-75c8-bbe1-9c9da39e1aa2

AI-generated (Meshy), disclosed per CONTRIBUTING.md.

## Why this path and not `import_meshy_soldier.py`'s

The shipped Meshy infantry (`meshy_soldier`, `sarim_rifles`, `rpg_team`) were
SUPPLIED as rigged bipeds with clips, and their importers retarget those. B2's
figures come from `pnpm meshy`, which has no `rig` command, and a headless
session cannot drive the Meshy web UI; the bible's step 5 (a bought humanoid
rig) is therefore not taken. Instead the remeshed figure goes through
`tools/units/rig.py` exactly as a `kit.py` figure does: it is CUT into rigid
parts at rig.py's own joints, each part is named `{prefix}_{suffix}` with a
suffix from `PART_BONE`, `rig.rig_parts` binds one part to one bone, and every
clip is rig.py's own keyframe table (`build_idle_clip`, `build_move_clip`,
`build_fire_clip`, `build_death_clip`). No hand-posing, no weight painting;
where a rigid cut opens a seam, a `kit.blob` joint hides it -- kit's own
mechanism, in the same palette roles, so it is invisible on a palette-painted
figure.

## The cut, measured on each remesh rather than assumed

The A-pose figure faces -Y in the source (probed: the toes' centroid sits
forward of the shins' along -Y; confirmed by an ortho render with a marker
cube), so it takes one +90 degree Z rotation to face +X. Heights are
fractions of the figure's own height `H` (anthropometric, not `kit.py`'s
stylised 1.8 m proportions): ankle 0.045, boot top 0.09, knee 0.285, crotch
found by scanning for the band where the two legs merge (fallback 0.47),
belt = crotch + 0.08, neck base 0.83, chin 0.87. A crotch SCAN (the band
where the two legs' face centroids separate) was tried and swung between
0.44 and 0.52 H on a 1,500-tri shell, so the cut uses the fraction and the
scan is only logged beside it. The arm root is the torso half-width at the
armpit, 0.105 H -- both B2 figures measured 0.20 of 1.90 source units -- and
the shoulder is the centroid of the arm-root ring above the hip pouches; the
elbow sits 0.42 of the way from that ring to the fingertips.

The A-pose arms (30-47 degrees from vertical, measured) are hung at
`ARM_HANG_DEG` from vertical by one rigid rotation of each arm about its own
shoulder ring -- rest geometry, like kit's contrapposto, not a pose -- and a
deltoid blob covers the wedge. The kneeling figure is the same parts
re-arranged rigidly onto a kneel: torso, head and arms drop, the rear thigh
angles back to put its knee on the ground, the rear shin lies along the ground
with the boot plantar-flexed behind it, the front thigh rises to a knee the
front shin drops vertically from, so the front boot's sole lands on z = 0.
Every angle is solved from the figure's own segment lengths; see `_kneel`.

## Roles

`boot` below the boot top; `face` the forward strip of the head between 0.88
and 0.955 H; `keffiyeh` the rest of the head and the neck (both figures wrap a
scarf there -- the recoilless man is fully hooded, the MANPAD man's preview
ignored the head wrap and came bare-headed, so he ALSO gets `kit.keffiyeh`
geometry over the crown, the same fix the bible allows for a preview that
missed a slot); `uniform` everything else; `weapon`/`metal` the kit parts.
No `webbing`: a chest rig on a bakeless remesh cannot be told from the shirt
by geometry, and a wrong band reads as a wrong army.

## What each team carries, verbatim from `tools/units/teams.py`

  manpad_team      mpd_fire standing at (0.16, -0.22) with `kit.launcher` at
                   z 1.30, pitch 78 deg, length 0.94, radius 0.065, on his
                   forearm_R; mpd_spot kneeling at (-0.28, 0.30) with
                   `kit.binoculars` on his head.
  recoilless_team  rcl_fire kneeling at (0.20, -0.28), `kit.launcher` LOW at
                   z 0.72, pitch 0, length 0.86, radius 0.115, on forearm_R;
                   rcl_load kneeling at (-0.30, 0.30); two spare rounds
                   (`kit.tube` 0.52 x 0.075) on the ground on a `prop` bone.

Both kneeling figures walk on a standing walker for `move` (design D6,
`rig._walker_specs`), and every figure carries a prone corpse for
`down`/`wreck` -- the standing parts laid face-down and decimated to half,
rigidly on `{prefix}_death_root` (`rig._figure_death_parts`'s convention,
with the man's own body instead of kit primitives).

After this: `pnpm gait:meshes -- --id=<team>`, `pnpm validate:meshes`,
`pnpm encode:meshes`.
"""
import glob
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit  # noqa: E402
import rig  # noqa: E402

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes")

#: team -> (Meshy remesh folder glob, figure height in metres -- the numbers
#: table's 1.74 / 1.72, bible §5 worked examples 2 and 3; B3's §10-12).
SOURCES = {
    "manpad_team": (os.path.join(REPO, "art", "meshy", "manpad-team-*-01a0f2af", "model.glb"), 1.74),
    "recoilless_team": (os.path.join(REPO, "art", "meshy", "recoilless-team-*-01a0f2af", "model.glb"), 1.72),
    # B3 (GH-179, 2026-09-30): remeshes of REFINED tasks, so each carries its
    # own 2k bake -- see `TEXTURED` below. Folder ids filled in as each
    # remesh landed (docs/ASSET_PROVENANCE.md has the full task ids).
    "militia_cell": (os.path.join(REPO, "art", "meshy", "militia-cell-*-01a0f30b", "model.glb"), 1.70),
    "rpg_team": (os.path.join(REPO, "art", "meshy", "rpg-team-*-01a0f313", "model.glb"), 1.76),
    "atgm_cell": (os.path.join(REPO, "art", "meshy", "atgm-cell-*-01a0f313", "model.glb"), 1.72),
}

#: Teams whose GLB ships the remesh's own base-colour bake (PR #307's
#: `TEXTURED_INFANTRY_TYPES` / `TEXTURED_INFANTRY_EXEMPT`, both lists edited
#: in the same change as the file). The bake stays on the figure's own
#: material through every cut (`_piece` duplicates keep UVs and the material
#: slot); a `kit.blob` joint or a kit keffiyeh that joins a textured role
#: BORROWS the material and one UV from the nearest source face, so it takes
#: the local cloth colour instead of texel (0, 0). Kit weapons keep no UVs and
#: no material: `buildMeshUnitTemplate` decides per MESH, so `weapon`/`metal`
#: stay palette-painted beside a textured `uniform`. Shipped at
#: `TEXTURE_PX` JPEG; the refine's normal and metallic-roughness maps are
#: dropped (a 25 px figure cannot show them, and the characters doc's own
#: rule is "single base-colour texture").
TEXTURED = {"militia_cell", "rpg_team", "atgm_cell"}
TEXTURE_PX = 1024
JPEG_QUALITY = 85

#: Head-wrap recolour, per team: (target linear RGB, hue window in degrees).
#: Both B3 previews that honoured the head wrap painted it PINK (rpg: a rose
#: scarf; atgm: a pink-white cap) -- saturated colour the bible reserves for
#: VFX and team markers, on the one part of an enemy figure the eye goes
#: to. Fixed in the bake rather than re-rolled: the texels of the head and
#: neck faces (the cranium/neck cut, face strip excluded) whose hue falls in
#: the red-magenta window and whose saturation is above SAT_MIN take the
#: target's chroma at their own luminance, so folds and shading survive.
#: Skin (hue ~20-30 deg) and the tan shirt sit outside the window.
RECOLOUR = {"rpg_team": ((0.60, 0.52, 0.40), (300.0, 14.0)),      # dusty tan
            "atgm_cell": ((0.80, 0.77, 0.70), (300.0, 14.0))}     # limestone
RECOLOUR_SAT_MIN = 0.16
RECOLOUR_FLOOR_F = 0.74

#: Whether the figure needs kit's keffiyeh over the crown (see module docstring).
ADD_KEFFIYEH = {"manpad_team": True, "recoilless_team": False,
                # B3: the militia preview came back bare-headed and clean-cut
                # (the wrap AND the ragged jacket were ignored), so it wears
                # kit's keffiyeh, coloured from its own shirt's bake.
                "militia_cell": True, "rpg_team": False, "atgm_cell": False}

#: `kit.blob` topology per team. B2 used kit's default (9 sides, 3 rings: 72
#: glTF tris a blob, ~580 a body copy). B3's numbers tables budget the
#: kneeling ATGM crew at three copies per figure inside the 8,000-tri team
#: cap, so its joints are coarser -- 7 x 2, 42 tris -- and the two standing
#: teams take the same so the batch reads as one register.
BLOB_KW = {"militia_cell": dict(sides=7, rings=2), "rpg_team": dict(sides=7, rings=2),
           "atgm_cell": dict(sides=7, rings=2)}

#: Hand-bound weapon carriers get both forearms bent forward at the elbow --
#: rest geometry like the arm hang, one rigid rotation per forearm about its
#: own elbow -- so a kit rifle sits at the hands instead of floating at
#: chest height over arms that hang. Degrees: (pitch forward from hanging,
#: yaw inward about the elbow) for the left and the right forearm.
FORE_BEND = {"L": (75.0, 40.0), "R": (70.0, 10.0)}
#: Where the rifle grip sits past the right wrist, along the forearm.
HAND_REACH = 0.06
#: Rifle yaw across the front, degrees (negative: muzzle to the left).
RIFLE_YAW_DEG = -15.0    # mesh_gait.test.ts wants the rifle within 20 deg of the facing

#: The posed corpse (B3; B2 laid the A-pose body flat). Angles, all rigid
#: re-arrangements of the cut parts BEFORE the body is laid face down: the
#: left arm thrown overhead, the right arm out from the side, the right
#: thigh abducted and its shin splayed, the head turned, then the whole
#: body rolled so it is not a plank.
CORPSE_OVERHEAD = Vector((0.06, -0.34, 0.94))    # left arm target, standing frame
CORPSE_OUT = Vector((0.12, 0.92, -0.32))         # right arm target, standing frame
CORPSE_THIGH_DEG = 16.0                           # right thigh out, about the hip
CORPSE_SHIN_DEG = 42.0                            # right shin further out, about the knee
CORPSE_HEAD_DEG = 65.0                            # head turned, about the neck
CORPSE_ROLL_DEG = 12.0                            # body rolled about its own long axis
CORPSE_DECIMATE = 0.5

# --- height fractions of the figure's own H --------------------------------
ANKLE_F, BOOT_TOP_F, KNEE_F, CROTCH_FALLBACK_F = 0.045, 0.09, 0.285, 0.47
NECK_F, CHIN_F, FACE_LO_F, FACE_HI_F = 0.83, 0.87, 0.88, 0.955
FACE_HALF_W = 0.07
ARM_ROOT_FALLBACK_F = 0.105    # torso half-width at the armpit: both B2 figures measure 0.20/1.90 src
ARM_BAND_Z_F = 0.15            # a |y| band spanning less than this in z (above 0.62 H) is arm, not torso
WRIST_IN_F, HAND_F = 0.07, 0.035 # the wrist band, measured inward from the fingertips along |y|
HAND_PAST_WRIST = 0.24         # how far past the wrist band the forearm segment still claims faces
R_ARM_F = 0.05                 # an arm's reach from its own axis, incl. the hand (0.087 m at 1.74)
#: Joint-blob radii: kit.py's own limb radii (for its 1.8 m figure), scaled
#: by height -- measured cross-sections on a 1,500-tri shell are too noisy
#: (a first pass read the chest rig as the upper arm and drew 0.2 m spheres).
BLOB_R = {"deltoid": kit.R_UPPERARM * 1.35, "elbow": kit.R_FOREARM * 1.25,
          "knee": kit.R_KNEE * 1.2, "hip": kit.R_THIGH * 1.1}
ARM_HANG_DEG = 10.0            # from vertical, outward, once hung
REAR_THIGH_DEG = 25.0          # kneel: rear thigh back from vertical
REAR_BOOT_FLEX_DEG = 80.0      # kneel: rear boot plantar-flexed behind the shin
DEATH_DECIMATE = 0.5


def log(msg):
    print(f"[crew] {msg}")


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------

def _src(team_id):
    pattern, _h = SOURCES[team_id]
    hits = sorted(glob.glob(pattern))
    if len(hits) != 1:
        raise SystemExit(f"{team_id}: expected exactly one source at {pattern}, found {hits}")
    return hits[0]


def _load_figure(team_id):
    """The remesh as one mesh object: world transform applied, materials
    stripped, rotated to face +X, scaled to its target height, feet on z=0,
    ankles centred on the origin."""
    _pattern, height = SOURCES[team_id]
    bpy.ops.import_scene.gltf(filepath=_src(team_id))
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name != "rig"]
    if len(meshes) != 1:
        raise SystemExit(f"{team_id}: expected one mesh object, found {[o.name for o in meshes]}")
    ob = meshes[0]
    if team_id in TEXTURED:
        _keep_base_color(team_id, ob)
    else:
        ob.data.materials.clear()
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    co = _coords(ob)
    z = co[:, 2] - co[:, 2].min()
    h_src = z.max()
    zf = z / h_src
    feet, shin = zf < 0.04, (zf > 0.15) & (zf < 0.25)
    fwd_y = co[feet, 1].mean() - co[shin, 1].mean()
    if fwd_y >= 0:
        raise SystemExit(f"{team_id}: toes point +Y, not the -Y every B2 figure measured -- look before rotating")
    # -Y forward -> +X forward is +90 about Z; scale; feet to z=0; ankles to origin.
    k = height / h_src
    rot = Matrix.Rotation(math.radians(90.0), 4, "Z")
    me = ob.data
    for v in me.vertices:
        v.co = rot @ v.co
    for v in me.vertices:
        v.co = v.co * k
    co = _coords(ob)
    ankle = co[(co[:, 2] - co[:, 2].min()) < ANKLE_F * height]
    shift = Vector((-ankle[:, 0].mean(), -ankle[:, 1].mean(), -co[:, 2].min()))
    for v in me.vertices:
        v.co = v.co + shift
    co = _coords(ob)
    feet, shin = co[:, 2] < 0.04 * height, (co[:, 2] > 0.15 * height) & (co[:, 2] < 0.25 * height)
    if co[feet, 0].mean() <= co[shin, 0].mean():
        raise SystemExit(f"{team_id}: after the turn the toes do not point +X")
    log(f"{team_id}: source height {h_src:.4f} -> {height} m; {len(me.polygons)} tris; faces +X")
    ob.name = "figure_src"
    if team_id in RECOLOUR and team_id in TEXTURED:
        _recolour_head(team_id, ob, height, *RECOLOUR[team_id])
    return ob, height


def _recolour_head(team_id, ob, height, target, hue_window):
    """See RECOLOUR. Rasterises the head/neck faces' UV triangles into a
    mask on `base_color`, then remaps the saturated red-magenta texels
    inside it."""
    img = bpy.data.images["base_color"]
    w, h = img.size
    me = ob.data
    cent = _face_centroids(ob)
    co = _coords(ob)
    head = cent[:, 2] > CHIN_F * height
    x_head = co[co[:, 2] > CHIN_F * height][:, 0].mean()
    face_strip = ((cent[:, 0] > x_head + 0.02) & (cent[:, 2] > FACE_LO_F * height)
                  & (cent[:, 2] < FACE_HI_F * height) & (np.abs(cent[:, 1]) < FACE_HALF_W))
    # Down to the upper chest, not just the neck cut: the rpg figure's
    # scarf hangs to the collarbones, and the hue window is what keeps
    # the shirt and the rig out of it.
    sel = ((cent[:, 2] > RECOLOUR_FLOOR_F * height) & ~(head & face_strip))
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    mask = np.zeros((h, w), dtype=bool)
    for i in np.nonzero(sel)[0]:
        poly = me.polygons[i]
        tri = uv[list(poly.loop_indices)][:3]
        px = np.stack([(tri[:, 0] % 1.0) * (w - 1), (tri[:, 1] % 1.0) * (h - 1)], axis=1)
        x0, x1 = int(np.floor(px[:, 0].min())), int(np.ceil(px[:, 0].max()))
        y0, y1 = int(np.floor(px[:, 1].min())), int(np.ceil(px[:, 1].max()))
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        (ax, ay), (bx, by), (cx, cy) = px
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-9:
            continue
        l1 = ((bx - xs) * (cy - ys) - (cx - xs) * (by - ys)) / det
        l2 = ((cx - xs) * (ay - ys) - (ax - xs) * (cy - ys)) / det
        l3 = 1.0 - l1 - l2
        inside = (l1 >= -0.002) & (l2 >= -0.002) & (l3 >= -0.002)
        mask[ys[inside], xs[inside]] = True
    pix = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(pix)
    pix = pix.reshape(h, w, 4)
    rgb = pix[:, :, :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    d = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r, (g - b) / d % 6.0, np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0)) * 60.0
    lo, hi = hue_window
    in_hue = (hue >= lo) | (hue <= hi)
    hit = mask & in_hue & (sat > RECOLOUR_SAT_MIN)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    t = np.array(target, dtype=np.float32)
    t_lum = float(0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2])
    scale = (lum[hit] / t_lum)[:, None]
    rgb[hit] = np.clip(t[None, :] * scale, 0.0, 1.0)
    img.pixels.foreach_set(pix.reshape(-1))
    img.pack()
    log(f"{team_id}: head recolour -- {int(sel.sum())} faces, mask {int(mask.sum())} px, "
        f"remapped {int(hit.sum())} px to {target}")


#: The one material every textured part shares, set by `_keep_base_color`.
_TEX = {"material": None, "src": None}


def _keep_base_color(team_id, ob):
    """Keep exactly one material on the remesh: its Principled BSDF with the
    base-colour image linked, every other image (normal, metallic-roughness)
    unlinked and removed. The image is renamed `base_color` -- the name the
    vehicle and building texture modules key on -- and downscaled at export."""
    mats = [m for m in ob.data.materials if m is not None]
    if len(mats) != 1 or not mats[0].use_nodes:
        raise SystemExit(f"{team_id}: expected one node material on the remesh, found {[m.name for m in mats]}")
    mat = mats[0]
    tree = mat.node_tree
    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise SystemExit(f"{team_id}: no Principled BSDF on {mat.name}")
    link = next((l for l in tree.links if l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE" or link.from_node.image is None:
        raise SystemExit(f"{team_id}: Base Color is not an image on {mat.name} -- no bake to ship")
    base = link.from_node.image
    for node in list(tree.nodes):
        if node.type == "TEX_IMAGE" and node.image is not base:
            img = node.image
            tree.nodes.remove(node)
            if img is not None and img.users == 0:
                bpy.data.images.remove(img)
    for other in list(bpy.data.images):
        if other is not base and other.users == 0:
            bpy.data.images.remove(other)
    base.name = "base_color"
    if not ob.data.uv_layers:
        raise SystemExit(f"{team_id}: the remesh carries no UV layer")
    _TEX["material"] = mat
    log(f"{team_id}: bake kept -- {mat.name}, base_color {base.size[0]}x{base.size[1]}, "
        f"{len(ob.data.uv_layers)} uv layer(s)")


def _borrow_uv(ob, src, near=None):
    """Give a UV-less kit part (a blob joint, a keffiyeh) the source figure's
    material and ONE uv -- the centroid uv of the source face nearest the
    part's own centre (or `near`, when the part should take its colour from
    somewhere else: a kit keffiyeh over a bare textured head borrows from the
    shirt, not from the hair) -- so it takes that cloth colour of the bake."""
    if _TEX["material"] is None or src is None or not src.data.uv_layers:
        return
    me_s = src.data
    uv_s = me_s.uv_layers.active.data
    cent = _face_centroids(src)
    c = np.array(near, dtype=np.float64) if near is not None else _coords(ob).mean(axis=0)
    i = int(np.argmin(((cent - c) ** 2).sum(axis=1)))
    poly = me_s.polygons[i]
    uv = np.mean([uv_s[l].uv[:] for l in poly.loop_indices], axis=0)
    me = ob.data
    layer = me.uv_layers.active if me.uv_layers else me.uv_layers.new(name="UVMap")
    for loop in layer.data:
        loop.uv = uv
    me.materials.clear()
    me.materials.append(_TEX["material"])


def _blob(name, at, radius, src=None, **kw):
    """`kit.blob` at this team's topology (`BLOB_KW`), textured if the team is."""
    kw = {**_BLOB_KW_ACTIVE, **kw}
    ob = kit.blob(name, at, radius, **kw)
    _borrow_uv(ob, src)
    return ob


_BLOB_KW_ACTIVE = {}
_TEAM = {"id": None}


def _coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def _face_centroids(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    cent = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float64)
    bm.free()
    return cent


def _find_crotch(cent, height):
    """The top of the first band (scanning down from the belt) in which the
    left-of-midline and right-of-midline face centroids are separated by a
    real gap -- two legs rather than one body. Face centroids rather than
    vertices because a 1,500-tri remesh leaves 2 cm bands with no vertex at
    all on a belly. Clamped to the anthropometric window either way."""
    z = cent[:, 2]
    band_h = 0.02 * height
    for lo in np.arange(0.58, 0.36, -0.02):
        band = (z >= lo * height) & (z < lo * height + band_h)
        ys = cent[band, 1]
        pos, neg = ys[ys > 0], ys[ys < 0]
        if len(pos) == 0 or len(neg) == 0:
            continue
        if pos.min() - neg.max() > 0.04 * height:
            return float(min(max(lo * height + band_h, 0.44 * height), 0.52 * height))
    return CROTCH_FALLBACK_F * height


def _arm_axis(co, height, side):
    """The spread arm's own joints. Returns (shoulder, elbow, wrist,
    torso half-width), all measured.

    B2 fitted this from a fixed torso half-width (0.105 H) and the centroid of
    a 5 cm ring outboard of it above z = 0.62 H. The B3 militia figure broke
    that: a broad chest rig puts torso flank INSIDE that ring, so the
    "shoulder" read at z 1.19 on a 1.70 m man (true ~1.40) and the arm came
    out 82 degrees from vertical -- half of it left in the torso. Measured,
    not assumed, now: |y| bands of 2 cm scanned outward above z = 0.62 H;
    a band that still spans the torso's height (belt to shoulder, ~0.23 H)
    is torso, the first band that spans only an arm's thickness is where
    the arm leaves the body; the shoulder is the centre of the first two
    arm-only bands."""
    sgn = -1.0 if side == 0 else 1.0
    y = co[:, 1] * sgn
    upper = co[:, 2] > 0.62 * height
    ymax = float(y[upper].max())
    step = 0.02
    w_arm = None
    for lo in np.arange(0.09 * height, ymax - 0.05, step):
        band = upper & (y >= lo) & (y < lo + step)
        if band.sum() < 6:
            continue
        if co[band, 2].max() - co[band, 2].min() < ARM_BAND_Z_F * height:
            w_arm = float(lo)
            break
    if w_arm is None:
        raise SystemExit(f"arm{side}: no arm-only band found -- not an A-pose figure?")
    # The shoulder is the centre of the first two arm-only bands -- the arm
    # root where it leaves the torso. (A line fitted through every band and
    # extrapolated back was tried first and read 0.09 m LOW on this figure:
    # its forearm is flatter than its upper arm, so the fit averages the two
    # slopes and lands under the deltoid.)
    root = upper & (y >= w_arm) & (y < w_arm + 2.0 * step)
    shoulder = Vector(co[root].mean(axis=0))
    # The wrist is the WRIST band, not the fingertips: this figure's open
    # hands cup upward, and a fingertip centroid put the axis 25 degrees
    # flatter than the arm it was meant to follow.
    above = co[:, 2] > 0.5 * height
    wrist_sel = above & (y > ymax - WRIST_IN_F * height) & (y < ymax - HAND_F * height)
    wrist = Vector(co[wrist_sel if wrist_sel.sum() >= 4 else above & (y > ymax - 0.05)].mean(axis=0))
    # The elbow: an A-pose arm is bent (this one visibly -- upper arm out
    # and down, forearm out and up), so a straight shoulder-to-wrist axis
    # is 0.2 m long on a 0.55 m arm and the hung arm came out a stub. The
    # elbow is the lowest band centroid in the middle of the |y| span; on
    # a straight arm sloping down that is the window's outer end, which
    # is still a fair elbow.
    span = ymax - w_arm
    best = None
    for lo in np.arange(w_arm + 0.32 * span, w_arm + 0.66 * span, step):
        band = above & (y >= lo) & (y < lo + step)
        if band.sum() < 4:
            continue
        c = co[band].mean(axis=0)
        if best is None or c[2] < best[2]:
            best = c
    elbow = Vector(best) if best is not None else shoulder.lerp(wrist, 0.45)
    return shoulder, elbow, wrist, w_arm


def _keep_only(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep_idx], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _piece(src, name, role, faces):
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    bpy.context.view_layer.objects.active = src
    bpy.ops.object.duplicate()
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name
    _keep_only(ob, faces)
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    ob["rl_role"] = role
    return ob


def _transform(ob, mat):
    for v in ob.data.vertices:
        v.co = mat @ v.co


def _rot_about(point, axis, deg):
    p = Vector(point)
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p)


def _radius_near(co, point, band=0.03):
    """Mean radial distance from `point` (in the horizontal plane) of the
    vertices within `band` of its height -- a limb's local radius."""
    z = co[:, 2]
    sel = np.abs(z - point[2]) < band
    if not sel.any():
        return 0.05
    d = np.hypot(co[sel, 0] - point[0], co[sel, 1] - point[1])
    return float(np.median(d))


# ---------------------------------------------------------------------------
# one figure: cut, hang the arms, measure the joints
# ---------------------------------------------------------------------------

def cut_figure(src, height, prefix, blobs=True):
    """Cut the standing source into rig.py parts at the origin. Returns
    (parts, joints) where joints is a dict of the measured points every later
    step (bones, kneel, corpse) reads."""
    co = _coords(src)
    cent = _face_centroids(src)
    H = height
    # Measured crotch heights on the two B2 remeshes swung between the clamps
    # (0.44 H and 0.52 H) on a 1,500-tri shell, so the cut uses the
    # anthropometric fraction and the scan is only reported beside it.
    zc = CROTCH_FALLBACK_F * H
    log(f"{prefix}: crotch scan read {_find_crotch(cent, H) / H:.3f} H; cutting at {CROTCH_FALLBACK_F} H")
    z_ankle, z_boot, z_knee = ANKLE_F * H, BOOT_TOP_F * H, KNEE_F * H
    z_belt, z_neck, z_chin = zc + 0.08, NECK_F * H, CHIN_F * H
    head = co[co[:, 2] > z_chin]
    x_head, y_head = float(head[:, 0].mean()), float(head[:, 1].mean())
    axes = {side: _arm_axis(co, H, side) for side in (0, 1)}
    w_arm = max(axes[0][3], axes[1][3])
    log(f"{prefix}: crotch {zc:.3f} ({zc / H:.3f} H) arm-root |y| {w_arm:.3f} knee {z_knee:.3f} "
        f"neck {z_neck:.3f} chin {z_chin:.3f}")

    def arm_side(p, y_out):
        """0/1 if a face is arm: its OUTERMOST vertex (`y_out`, signed) lies
        beyond the measured torso edge, and its centroid `p` is either above
        the armpit line (0.62 H -- nothing but arm is out there) or within
        R_ARM of the arm's axis (a low-hanging A-pose forearm). The pouches
        at the waist are outboard too but below the line and far from the
        axis. Two things B2 did differently, both measured wrong on a
        2,000-tri figure with near-horizontal arms: it tested the CENTROID
        against the torso edge, so a face straddling the armpit stayed with
        the torso and stuck out as a spike once the arm was hung (a 6 cm
        triangle reaches 6 cm past its own centroid); and it required the
        axis test alone, which left a third of a thick forearm behind."""
        if abs(y_out) <= w_arm or p[2] < 0.5 * H:
            return None
        side = 0 if y_out < 0 else 1
        if p[2] > 0.62 * H:
            return side
        shoulder, elbow, wrist, _w = axes[side]
        pv = Vector(p)
        # The forearm segment runs on past the wrist by a hand's length:
        # on the ATGM figure (arms 62 degrees from vertical) the fingertips
        # sit below the armpit line, and a glove face left behind here
        # floated beside the kneeling man at his old A-pose hand.
        for a, b, past in ((shoulder, elbow, 0.05), (elbow, wrist, HAND_PAST_WRIST)):
            axis = (b - a).normalized()
            d = pv - a
            along = d.dot(axis)
            if -0.05 <= along <= (b - a).length + past and (d - axis * along).length < R_ARM_F * H:
                return side
        return None

    classes = {}

    def put(i, name, role):
        classes.setdefault((name, role), set()).add(i)

    vco = _coords(src)
    y_outer = np.array([max((vco[v][1] for v in poly.vertices), key=abs) for poly in src.data.polygons])
    for i, (x, y, z) in enumerate(cent):
        side = arm_side((x, y, z), y_outer[i])
        if side is not None:
            put(i, f"arm{side}", "uniform")
        elif z > z_chin:
            # A centred strip, |y| < FACE_HALF_W: the hooded figure's head
            # wraps to one side and an off-centre face strip read 30 degrees
            # off the way the man travels (mesh_gait.test.ts's facing sweep).
            if x > x_head + 0.02 and FACE_LO_F * H < z < FACE_HI_F * H and abs(y - y_head) < FACE_HALF_W:
                put(i, "face", "face")
            else:
                put(i, "cranium", "keffiyeh")
        elif z > z_neck:
            put(i, "neck", "keffiyeh")
        elif z > z_belt:
            put(i, "torso", "uniform")
        elif z > zc - 0.02:
            put(i, "hips", "uniform")
        else:
            side = 0 if y < 0 else 1
            if z > z_knee:
                put(i, f"thigh{side}", "uniform")
            elif z > z_boot:
                put(i, f"calf{side}", "uniform")
            else:
                put(i, f"boot{side}", "boot")

    parts = {}
    for (name, role), faces in classes.items():
        parts[name] = _piece(src, f"{prefix}_{name}", role, faces)

    # The head's own centre in plan: the neck and head bones sit on it, and
    # the face strip is cut about it. The militia figure's head sits 5 cm
    # off the figure's axis, and with the bone ON the axis the strip's
    # bearing from the bone read 26 degrees (mesh_gait.test.ts's facing
    # sweep, limit 25) for a head that looks straight ahead.
    joints = {"H": H, "crotch": zc, "knee": z_knee, "ankle": z_ankle, "neck": z_neck, "chin": z_chin,
              "belt": z_belt, "head_xy": (x_head, y_head), "leg": {}, "arm": {}}
    # Legs: the knee band's centroid per side is where the thigh and shin bones meet.
    for side in (0, 1):
        pc = _coords(parts[f"calf{side}"])
        top = pc[pc[:, 2] > z_knee - 0.05]
        joints["leg"][side] = (float(top[:, 0].mean()), float(top[:, 1].mean()))

    # Arms: split each into upper and fore at the measured elbow, then hang
    # each segment separately -- the upper arm about the shoulder, the
    # forearm about the moved elbow -- so a bent A-pose arm hangs straight
    # at its full length.
    for side in (0, 1):
        arm = parts.pop(f"arm{side}")
        shoulder, elbow, wrist, _w = axes[side]
        acent = _face_centroids(arm)
        upper_faces = {i for i, c in enumerate(acent) if abs(c[1]) < abs(elbow.y)}
        fore_faces = set(range(len(acent))) - upper_faces
        upper = _piece(arm, f"{prefix}_upperarm{side}", "uniform", upper_faces)
        fore = _piece(arm, f"{prefix}_forearm{side}", "uniform", fore_faces)
        bpy.data.objects.remove(arm, do_unlink=True)
        sgn = -1.0 if side == 0 else 1.0
        target = Vector((0.0, sgn * math.sin(math.radians(ARM_HANG_DEG)), -math.cos(math.radians(ARM_HANG_DEG))))
        q_up = (elbow - shoulder).normalized().rotation_difference(target)
        m_up = Matrix.Translation(shoulder) @ q_up.to_matrix().to_4x4() @ Matrix.Translation(-shoulder)
        elbow_h = m_up @ elbow
        q_fore = (wrist - elbow).normalized().rotation_difference(target)
        m_fore = Matrix.Translation(elbow_h) @ q_fore.to_matrix().to_4x4() @ Matrix.Translation(-elbow)
        _transform(upper, m_up)
        _transform(fore, m_fore)
        wrist_h = m_fore @ wrist
        axis = (wrist - shoulder).normalized()
        k = H / kit.FIGURE_H
        parts[f"upperarm{side}"] = upper
        parts[f"forearm{side}"] = fore
        if blobs:
            parts[f"deltoid{side}"] = _blob(f"{prefix}_deltoid{side}", tuple(shoulder), BLOB_R["deltoid"] * k,
                                            src=src, squash=(1.0, 1.0, 0.9))
            parts[f"elbow{side}"] = _blob(f"{prefix}_elbow{side}", tuple(elbow_h), BLOB_R["elbow"] * k, src=src)
        joints["arm"][side] = {"shoulder": tuple(shoulder), "elbow": tuple(elbow_h), "wrist": tuple(wrist_h)}
        log(f"{prefix}: arm{side} A-pose {math.degrees(math.acos(abs(axis.z))):.1f} deg from vertical "
            f"(upper {(elbow - shoulder).length:.2f} m, fore {(wrist - elbow).length:.2f} m), hung to "
            f"{ARM_HANG_DEG}; shoulder z {shoulder.z:.3f} elbow z {elbow_h.z:.3f} wrist z {wrist_h.z:.3f}")

    # Knee and hip blobs, kit's own radii scaled to this figure.
    k = H / kit.FIGURE_H
    for side in (0, 1):
        lx, ly = joints["leg"][side]
        if blobs:
            parts[f"knee{side}"] = _blob(f"{prefix}_knee{side}", (lx, ly, z_knee), BLOB_R["knee"] * k, src=src)
            parts[f"hip{side}"] = _blob(f"{prefix}_hip{side}", (lx, ly, zc), BLOB_R["hip"] * k, src=src,
                                        squash=(1.05, 1.05, 1.05))
    return parts, joints


def _rename(parts, prefix, mapping):
    for old, new in mapping.items():
        if old in parts:
            ob = parts.pop(old)
            ob.name = f"{prefix}_{new}"
            ob.data.name = ob.name
            parts[new] = ob


def _move_all(parts, names, mat):
    for n in names:
        if n in parts:
            _transform(parts[n], mat)


def standing_bones(prefix, joints, dx, dy):
    """rig.py's `_BASE_BONES` shape with THIS figure's measured joints."""
    H, zc, zk, za, zn, zh = (joints[k] for k in ("H", "crotch", "knee", "ankle", "neck", "chin"))
    sh0 = joints["arm"][0]["shoulder"]
    z_sh = max(joints["arm"][s]["shoulder"][2] for s in (0, 1))
    hx, hy = joints["head_xy"]
    table = [
        ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
        ("pelvis", "root", (0.0, 0.0, zc - 0.05), (0.0, 0.0, joints["belt"])),
        ("spine", "pelvis", (0.0, 0.0, joints["belt"]), (0.0, 0.0, z_sh - 0.02)),
        ("neck", "spine", (hx, hy, zn), (hx, hy, zh)),
        ("head", "neck", (hx, hy, zh), (hx, hy, H)),
    ]
    for side, name in ((0, "L"), (1, "R")):
        a = joints["arm"][side]
        table.append((f"upperarm_{name}", "spine", a["shoulder"], a["elbow"]))
        table.append((f"forearm_{name}", f"upperarm_{name}", a["elbow"], a["wrist"]))
    for side, name in ((0, "L"), (1, "R")):
        lx, ly = joints["leg"][side]
        table.append((f"thigh_{name}", "pelvis", (lx, ly, zc), (lx, ly, zk)))
        table.append((f"shin_{name}", f"thigh_{name}", (lx, ly, zk), (lx, ly, za)))
    out = rig._translate(table, dx, dy, prefix)
    for side, name in ((0, "L"), (1, "R")):
        lx, ly = joints["leg"][side]
        out.append((f"{prefix}_hip_{name}", f"{prefix}_pelvis",
                    (lx + dx, ly + dy, zc), (lx + dx, ly + dy, zc - 0.15 * (zc - zk))))
    return out


def _kneel(parts, joints, prefix):
    """Re-arrange standing parts (at the origin) into a kneel, rigidly, and
    return the kneel bone table (untranslated). Side 0 (-y) is the rear leg
    with its knee on the ground; side 1 (+y) the planted front leg."""
    H, zc, zk, za = (joints[k] for k in ("H", "crotch", "knee", "ankle"))
    L_thigh, L_shin = zc - zk, zk - za
    rear = math.radians(REAR_THIGH_DEG)
    r_knee = 0.06
    z_hip = r_knee + L_thigh * math.cos(rear)
    drop = zc - z_hip
    # Front thigh angle that lands the front sole exactly on the ground.
    s = (zk - z_hip) / L_thigh
    front = math.asin(max(-1.0, min(1.0, s)))
    log(f"{prefix}: kneel hip z {z_hip:.3f} (drop {drop:.3f}), rear thigh {REAR_THIGH_DEG} deg back, "
        f"front thigh {math.degrees(front):.1f} deg up")

    legs = {"thigh0", "thigh1", "calf0", "calf1", "boot0", "boot1", "knee0", "knee1", "hip0", "hip1"}
    _move_all(parts, [n for n in parts if n not in legs], Matrix.Translation((0.0, 0.0, -drop)))

    # Rear leg (side 0): thigh back about the hip, shin flat behind the knee,
    # boot flexed behind the shin.
    lx0, ly0 = joints["leg"][0]
    hip0 = Vector((lx0, ly0, zc))
    # R_y(t) takes the thigh's own down vector (0, 0, -1) to (-sin t, 0, -cos t):
    # a POSITIVE angle about +Y tips it backward, toward -x.
    m_thigh0 = Matrix.Translation((0, 0, -drop)) @ _rot_about(hip0, "Y", REAR_THIGH_DEG)
    knee0 = m_thigh0 @ Vector((lx0, ly0, zk))
    m_shin0 = _rot_about(knee0, "Y", 90.0) @ m_thigh0
    ankle0 = m_shin0 @ Vector((lx0, ly0, za))
    m_boot0 = _rot_about(ankle0, "Y", REAR_BOOT_FLEX_DEG) @ m_shin0
    _transform(parts["thigh0"], m_thigh0)
    _transform(parts["hip0"], m_thigh0)
    _transform(parts["knee0"], m_thigh0)
    _transform(parts["calf0"], m_shin0)
    _transform(parts["boot0"], m_boot0)
    # Front leg (side 1): thigh up about the hip, shin vertical below the knee.
    lx1, ly1 = joints["leg"][1]
    hip1 = Vector((lx1, ly1, zc))
    # Forward and up by `front`: (0, 0, -1) -> (cos f, 0, sin f) is R_y(-(90 + f)).
    m_thigh1 = Matrix.Translation((0, 0, -drop)) @ _rot_about(hip1, "Y", -(90.0 + math.degrees(front)))
    knee1 = m_thigh1 @ Vector((lx1, ly1, zk))
    m_shin1 = Matrix.Translation(knee1 - Vector((lx1, ly1, zk)))
    _transform(parts["thigh1"], m_thigh1)
    _transform(parts["hip1"], m_thigh1)
    _transform(parts["knee1"], m_thigh1)
    _transform(parts["calf1"], m_shin1)
    _transform(parts["boot1"], m_shin1)
    ankle1 = m_shin1 @ Vector((lx1, ly1, za))
    # Blobs over the wedges the two thigh rotations opened at the hips.
    kneek = parts["knee1"]
    _rename(parts, prefix, {"thigh0": "thigh_r", "calf0": "shin_r", "boot0": "boot_r",
                            "thigh1": "thigh_f", "calf1": "shin_f", "boot1": "boot_f",
                            "knee1": "knee_f", "knee0": "kneek_r", "hip0": "hipk_r", "hip1": "hipk_f"})
    del kneek
    hip0k = m_thigh0 @ hip0
    hip1k = m_thigh1 @ hip1
    bones = [
        ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
        ("pelvis", "root", (0.0, 0.0, zc - 0.05 - drop), (0.0, 0.0, joints["belt"] - drop)),
        ("spine", "pelvis", (0.0, 0.0, joints["belt"] - drop),
         (0.0, 0.0, max(joints["arm"][s]["shoulder"][2] for s in (0, 1)) - drop - 0.02)),
        ("neck", "spine", (joints["head_xy"][0], joints["head_xy"][1], joints["neck"] - drop),
         (joints["head_xy"][0], joints["head_xy"][1], joints["chin"] - drop)),
        ("head", "neck", (joints["head_xy"][0], joints["head_xy"][1], joints["chin"] - drop),
         (joints["head_xy"][0], joints["head_xy"][1], H - drop)),
    ]
    for side, name in ((0, "L"), (1, "R")):
        a = joints["arm"][side]
        sh = (a["shoulder"][0], a["shoulder"][1], a["shoulder"][2] - drop)
        el = (a["elbow"][0], a["elbow"][1], a["elbow"][2] - drop)
        wr = (a["wrist"][0], a["wrist"][1], a["wrist"][2] - drop)
        bones.append((f"upperarm_{name}", "spine", sh, el))
        bones.append((f"forearm_{name}", f"upperarm_{name}", el, wr))
    bones.append(("thigh_r", "pelvis", tuple(hip0k), tuple(knee0)))
    bones.append(("shin_r", "thigh_r", tuple(knee0), tuple(ankle0)))
    bones.append(("thigh_f", "pelvis", tuple(hip1k), tuple(knee1)))
    bones.append(("shin_f", "thigh_f", tuple(knee1), tuple(ankle1)))
    eye_z = FACE_LO_F * H + 0.03 - drop
    return bones, eye_z


def _death_parts(src, height, prefix, x, y):
    """The whole standing source laid face-down, decimated, as ONE assembly
    named for `{prefix}_death_root`."""
    ob = _piece(src, f"{prefix}_death_body", "uniform", set(range(len(src.data.polygons))))
    # +90 about Y: height -> +x (head forward), forward -> -z (face down).
    _transform(ob, Matrix.Rotation(math.radians(90.0), 4, "Y"))
    co = _coords(ob)
    shift = Vector((x - height / 2.0, y, -co[:, 2].min()))
    _transform(ob, Matrix.Translation(shift))
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = DEATH_DECIMATE
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return [ob]


def _bend_forearms(parts, joints, prefix):
    """Rest geometry for a hand-bound weapon carrier: each forearm rotated
    rigidly about its own elbow, forward from the hang and a little inward,
    so the hands meet a rifle held across the front (`FORE_BEND`). The elbow
    blob is the pivot and stays; the wrist in `joints` moves with the part so
    `standing_bones` draws the forearm bone along the bent forearm."""
    for side, name in ((0, "L"), (1, "R")):
        a = joints["arm"][side]
        elbow = Vector(a["elbow"])
        pitch, yaw = FORE_BEND[name]
        inward = 1.0 if side == 0 else -1.0   # +Z yaw takes +x toward +y: inward for the left arm
        mat = _rot_about(elbow, "Z", inward * yaw) @ _rot_about(elbow, "Y", -pitch)
        _transform(parts[f"forearm{side}"], mat)
        a["wrist"] = tuple(mat @ Vector(a["wrist"]))
        log(f"{prefix}: forearm{side} bent {pitch:.0f} forward, {yaw:.0f} inward; wrist z {a['wrist'][2]:.3f}")


def _rifle_at_hand(prefix, joints, dx, dy):
    """`rig._weapon_parts`' seven-part rifle with its grip on the right
    hand: the anchor is solved from the bent right wrist rather than taken
    from kit's chest-height formula, and the rifle is yawed across the front."""
    a = joints["arm"][1]
    elbow, wrist = Vector(a["elbow"]), Vector(a["wrist"])
    hand = wrist + (wrist - elbow).normalized() * HAND_REACH
    yaw = math.radians(RIFLE_YAW_DEG)
    c, s = math.cos(yaw), math.sin(yaw)
    # grip centre = anchor + R(yaw)(-0.03, 0) + (0, 0, -0.065); anchor = at + (reach c, reach s, z_kit)
    gx, gy, gz = hand.x - (-0.03 * c), hand.y - (-0.03 * s), hand.z + 0.065
    reach, z_kit = 0.16, kit.POSTURE_EYE["standing"] * kit.FIGURE_H - 0.16
    at = (gx - reach * c + dx, gy - reach * s + dy, gz - z_kit)
    return rig._weapon_parts(prefix, at, yaw=yaw, posture="standing", aim=False)


def _kit_keffiyeh_over(parts, pfx, src):
    """kit's keffiyeh drape over the `{pfx}_cranium` part in `parts` (a dict
    or list), coloured from the same figure's shirt bake -- the bible's fix
    for a preview that ignored the head wrap. Returns the kef parts."""
    seq = parts.values() if isinstance(parts, dict) else parts
    cranium = next((o for o in seq if o.name == f"{pfx}_cranium"), None)
    if cranium is None:
        return []
    co = _coords(cranium)
    centre = ((co[:, 0].min() + co[:, 0].max()) / 2.0, (co[:, 1].min() + co[:, 1].max()) / 2.0,
              co[:, 2].min() + 0.55 * (co[:, 2].max() - co[:, 2].min()))
    radius = max(co[:, 0].max() - co[:, 0].min(), co[:, 1].max() - co[:, 1].min()) / 2.0 * 1.04
    kef = kit.keffiyeh(f"{pfx}_kef", centre, radius=radius)
    seq = parts.values() if isinstance(parts, dict) else parts
    torso = next((o for o in seq if o.name == f"{pfx}_torso"), None)
    near = None
    if torso is not None:
        tc = _coords(torso)
        near = (tc[:, 0].min() + 0.02, tc[:, 1].mean(), tc[:, 2].max() - 0.05)
    for ob_k in kef:
        _borrow_uv(ob_k, src, near=near)
    return kef


def _death_parts_posed(src, height, prefix, x, y, add_kef=False):
    """The corpse as a POSED fall (B3): the same cut as the living figure,
    re-arranged rigidly in code -- left arm overhead, right arm out, right
    thigh abducted and its shin splayed, head turned -- then laid face
    down, rolled off flat, and decimated. `kit.blob` covers the joints that
    turned. All of it on `{prefix}_death_root`, one part to one bone."""
    dp = f"{prefix}_death"
    parts, joints = cut_figure(src, height, dp, blobs=False)
    k = height / kit.FIGURE_H
    # Arms: the whole hung arm (upper + fore) about its shoulder.
    for side, target in ((0, CORPSE_OVERHEAD), (1, CORPSE_OUT)):
        a = joints["arm"][side]
        shoulder, wrist = Vector(a["shoulder"]), Vector(a["wrist"])
        axis = (wrist - shoulder).normalized()
        q = axis.rotation_difference(target.normalized())
        mat = Matrix.Translation(shoulder) @ q.to_matrix().to_4x4() @ Matrix.Translation(-shoulder)
        _transform(parts[f"upperarm{side}"], mat)
        _transform(parts[f"forearm{side}"], mat)
        parts[f"deltoid{side}"] = _blob(f"{dp}_deltoid{side}", tuple(shoulder), BLOB_R["deltoid"] * k, src=src,
                                        squash=(1.0, 1.0, 0.9))
    # Right leg: thigh out about the hip (X), shin further out about the knee.
    lx, ly = joints["leg"][1]
    hip, knee = Vector((lx, ly, joints["crotch"])), Vector((lx, ly, joints["knee"]))
    m_thigh = _rot_about(hip, "X", CORPSE_THIGH_DEG)
    m_shin = _rot_about(m_thigh @ knee, "X", CORPSE_SHIN_DEG) @ m_thigh
    _transform(parts["thigh1"], m_thigh)
    _transform(parts["calf1"], m_shin)
    _transform(parts["boot1"], m_shin)
    parts["hip1"] = _blob(f"{dp}_hip1", tuple(hip), BLOB_R["hip"] * k, src=src, squash=(1.05, 1.05, 1.05))
    parts["knee1"] = _blob(f"{dp}_knee1", tuple(m_thigh @ knee), BLOB_R["knee"] * k, src=src)
    # Head turned about the neck's own axis; kit's keffiyeh (if the preview
    # ignored the wrap) goes on BEFORE the turn and the lay-down, so it
    # drapes over a standing head and then falls with it.
    if add_kef:
        for i, ob_k in enumerate(_kit_keffiyeh_over(parts, dp, src)):
            parts[f"kef{i}"] = ob_k
    hc = _coords(parts["cranium"])
    m_head = _rot_about((hc[:, 0].mean(), hc[:, 1].mean(), 0.0), "Z", CORPSE_HEAD_DEG)
    for n in ("cranium", "face", "kef0", "kef1", "kef2"):
        if n in parts:
            _transform(parts[n], m_head)
    # Lay it down: height -> +x (head forward), forward -> -z (face down);
    # roll about the body's long axis; lowest point on the ground, centred.
    lay = Matrix.Rotation(math.radians(CORPSE_ROLL_DEG), 4, "X") @ Matrix.Rotation(math.radians(90.0), 4, "Y")
    for ob in parts.values():
        _transform(ob, lay)
    allco = np.concatenate([_coords(ob) for ob in parts.values()])
    shift = Matrix.Translation((x - (allco[:, 0].min() + allco[:, 0].max()) / 2.0, y, -allco[:, 2].min()))
    for ob in parts.values():
        _transform(ob, shift)
    # ONE object, decimated once: collapsing each cut piece on its own
    # shredded every seam (measured -- a first pass read as a heap of
    # shards). Role `uniform` for the whole body, as B2's corpse was; on a
    # textured team the bake colours the boots and face regardless.
    body = _join(list(parts.values()), f"{dp}_body", "uniform")
    # Re-weld the seams the pose did not open (each cut piece carries its
    # own copy of the boundary vertices), so the collapse works on a mostly
    # closed shell rather than a soup of open rims.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(body.data)
    bm.free()
    mod = body.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = CORPSE_DECIMATE
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f"{prefix}: posed corpse, {len(body.data.polygons)} polys, "
        f"x {allco[:, 0].min() + shift.translation.x:+.2f}..{allco[:, 0].max() + shift.translation.x:+.2f}")
    return [body]


def _join(objs, name, role):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    ob["rl_role"] = role
    return ob


def _place(parts, dx, dy):
    for ob in parts.values():
        _transform(ob, Matrix.Translation((dx, dy, 0.0)))


# ---------------------------------------------------------------------------
# teams
# ---------------------------------------------------------------------------

def _figure(src, height, spec, kneel):
    """Parts + bones + forced binds for one TEAM_FIGURES spec, placed at its
    anchor. `kneel` builds the deployed kneel AND (per design D6) a standing
    walker with the `{prefix}w` prefix."""
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    forced = {}
    if not kneel:
        parts, joints = cut_figure(src, height, prefix)
        if spec["weapon"] in ("rifle", "launcher"):
            _bend_forearms(parts, joints, prefix)
        bones = standing_bones(prefix, joints, x, y)
        _place(parts, x, y)
        eye_z = FACE_LO_F * height + 0.03
    else:
        parts, joints = cut_figure(src, height, prefix)
        kbones, eye_z = _kneel(parts, joints, prefix)
        bones = rig._translate(kbones, x, y, prefix)
        _place(parts, x, y)
        wp = rig._walker_prefix(spec)
        wparts, wjoints = cut_figure(src, height, wp)
        bones += standing_bones(wp, wjoints, x, y)
        _place(wparts, x, y)
        parts.update({f"w_{k}": v for k, v in wparts.items()})
    out = list(parts.values())
    death = _death_parts_posed(src, height, prefix, x, y, add_kef=ADD_KEFFIYEH[_TEAM["id"]])
    death_bone = rig._death_root_bone(prefix, x, y)
    bones.append(death_bone)
    for ob in death:
        forced[ob] = death_bone[0]
    out += death
    return out, bones, forced, eye_z, joints


def build_team(team_id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _TEX["material"] = None
    _TEAM["id"] = team_id
    _BLOB_KW_ACTIVE.clear()
    _BLOB_KW_ACTIVE.update(BLOB_KW.get(team_id, {}))
    src, height = _load_figure(team_id)
    figures = rig.TEAM_FIGURES[team_id]
    parts, bones, forced = [], [], {}
    eyes, hands = {}, {}
    for spec in figures:
        p, b, f, eye_z, j = _figure(src, height, spec, kneel=(spec["posture"] == "kneeling"))
        parts += p
        bones += b
        forced.update(f)
        eyes[spec["prefix"]] = eye_z
        hands[spec["prefix"]] = j
    if ADD_KEFFIYEH[team_id]:
        # Crown over every LIVING head this team draws (deployed, walker) --
        # the corpse got its own inside `_death_parts_posed`, before it fell.
        for ob in list(parts):
            if ob.name.endswith("_cranium") and not ob.name.endswith("_death_cranium"):
                parts += _kit_keffiyeh_over(parts, ob.name[: -len("_cranium")], src)
    bpy.data.objects.remove(src, do_unlink=True)

    # Crew weapons -- kit geometry, verbatim positions from teams.py.
    if team_id == "manpad_team":
        tube = kit.launcher("mpd_tube", (0.16, -0.22, 1.30), pitch=math.radians(78.0), length=0.94, radius=0.065)
        binos = kit.binoculars("mpd_binos", (-0.28, 0.30, eyes["mpd_spot"] - kit.POSTURE_EYE["standing"] * kit.FIGURE_H - 0.04),
                               posture="standing")
        forced.update({ob: "mpd_fire_forearm_R" for ob in tube})
        forced.update({ob: "mpd_spot_head" for ob in binos})
        parts += tube + binos
    elif team_id == "recoilless_team":
        tube = kit.launcher("rcl_tube", (0.20, -0.28, 0.72), pitch=0.0, length=0.86, radius=0.115)
        rounds = [
            kit.tube("rcl_round0", 0.52, 0.075, (-0.10, 0.46, 0.075), yaw=math.radians(90.0)),
            kit.tube("rcl_round1", 0.52, 0.075, (-0.10, 0.60, 0.075), yaw=math.radians(90.0)),
        ]
        bones.append(rig._prop_bone((-0.10, 0.53, 0.0), 0.30))
        forced.update({ob: "rcl_fire_forearm_R" for ob in tube})
        forced.update({ob: "prop" for ob in rounds})
        parts += tube + rounds
    elif team_id == "militia_cell":
        # Two riflemen, grip on each man's own bent right hand (`_rifle_at_hand`).
        for spec in figures:
            w = _rifle_at_hand(spec["prefix"], hands[spec["prefix"]], spec["x"], spec["y"])
            forced.update({ob: f"{spec['prefix']}_forearm_R" for ob in w})
            parts += w
    elif team_id == "rpg_team":
        # The tube verbatim from `rig._rpg_extras` (teams.py's 38-degree
        # launcher on rpg_fire's forearm_R); the loader's rifle at his hand.
        tube, _b, f_tube = rig._rpg_extras()
        forced.update(f_tube)
        parts += tube
        w = _rifle_at_hand("rpg_load", hands["rpg_load"], -0.30, 0.30)
        forced.update({ob: "rpg_load_forearm_R" for ob in w})
        parts += w
    elif team_id == "atgm_cell":
        # The tripod post verbatim from `rig._atgm_extras`, on the static
        # `prop` bone -- hidden while the crew walks (`_key_death_visibility`).
        post, prop_bones, f_post = rig._atgm_extras()
        bones += prop_bones
        forced.update(f_post)
        parts += post
    else:
        raise SystemExit(f"no crew weapon rule for {team_id}")

    want = {f"{s['prefix']}_forearm_R" for s in figures if s["weapon"] in ("launcher", "rifle")}
    if want - set(forced.values()):
        raise SystemExit(f"{team_id}: weapon declared but not bound: {want - set(forced.values())}")

    if os.environ.get("CREW_DEBUG"):
        for ob in sorted(parts, key=lambda o: o.name):
            c = _coords(ob)
            log(f"  part {ob.name:28s} role {ob.get('rl_role'):9s} x {c[:, 0].min():+.2f}..{c[:, 0].max():+.2f} "
                f"y {c[:, 1].min():+.2f}..{c[:, 1].max():+.2f} z {c[:, 2].min():+.2f}..{c[:, 2].max():+.2f} "
                f"-> {forced.get(ob, '(table)')}")
    arm_obj = rig.build_armature(bones)
    prefixes = {s["prefix"] for s in figures} | {s["prefix"] for s in rig._walker_specs(figures)}
    rig.rig_parts(parts, arm_obj, forced, prefixes)
    merged = rig.join_by_role(parts)
    rig.build_clips(arm_obj, team_id)
    path = os.path.join(OUT_DIR, f"{team_id}.glb")
    textured = team_id in TEXTURED
    if textured:
        img = bpy.data.images["base_color"]
        before = tuple(img.size)
        if img.size[0] > TEXTURE_PX or img.size[1] > TEXTURE_PX:
            img.scale(min(img.size[0], TEXTURE_PX), min(img.size[1], TEXTURE_PX))
        log(f"{team_id}: base_color {before[0]}x{before[1]} -> {img.size[0]}x{img.size[1]}; "
            f"images {[i.name for i in bpy.data.images]}")
        for role, ob in merged.items():
            has = any(m is not None for m in ob.data.materials)
            log(f"  role {role:9s} material {'yes' if has else 'no '} uv {'yes' if ob.data.uv_layers else 'no '}")
    rig.export_glb(arm_obj, path, materials=textured, jpeg_quality=JPEG_QUALITY)
    tris = sum(len(ob.data.polygons) for ob in merged.values())
    log(f"{team_id}: wrote {path} ({os.path.getsize(path)} bytes), roles {sorted(merged)}, {tris} tris, "
        f"clips {[a.name for a in bpy.data.actions]}")
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = list(SOURCES) if argv in ([], ["all"]) else argv
    for name in names:
        if name not in SOURCES:
            raise SystemExit(f"unknown team {name!r}; have {sorted(SOURCES)}")
        build_team(name)


if __name__ == "__main__":
    main()
