"""at_nlos_team's launcher (the Zaron Missile Team, GH-709 Phase 7): the Meshy
four-cell launcher, re-posed to its firing pitch about the cradle hinge in
Blender -- 0 further credits (the approved art spec, unit 4, A1-A2).

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/units/nlos_launcher_part.py

Writes, under `art/parts/at_nlos_team/`:

  launcher.glb   the part in the TEAM frame (+X forward, Z up in Blender, the
                 hinge on the origin in xy, lowest vertex on the
                 ground), one mesh with its own base-colour bake (JPEG);
                 `tools/units/import_meshy_crew_team.py` (MESHY_PARTS
                 `at_nlos_team`) composes that bake into the team's atlas and
                 places the part on the team's `prop` bone.
  launcher.blend the same scene, the `.blend` source the GLB is exported from.
  points.json    the measured points, glTF metres in the part's own frame:
                 `hinge` (the cradle hinge), `muzzle` (the upper canister's
                 front-cap centre), `backblast` (the lower canister's rear-cover
                 centre), `socket` (the junction box's outboard face, where the
                 fire-control cable plugs in).

## The source

`art/meshy/at-nlos-team-launcher-20261022-01a16328/model.glb` -- the 800-tri
remesh (arrived 774) of the 2k refine `01a16323` of preview `01a16320`
(text-to-3D, meshy-6; `docs/art/meshy-prompts-units.md`). AI-generated,
disclosed per CONTRIBUTING.md.

Measured in the SOURCE frame (Meshy's: front toward -Y, Z up, 1.90 units
tall overall), and checked again on every run so a different source cannot
pass silently:

  stand   four splayed legs whose tops meet the pack's bottom corners at
          z -0.66 (`HINGE_Z`) and a small cradle hub under its centre;
  pack    everything above `PACK_Z`: the 2 x 2 canister block (the front pair
          taller, domed), its frame bands, the two front sight discs and the
          junction box on its +X side. It came back near-vertical
          (`PACK_ELEV_SOURCE`, the fitted long axis: 87.0 deg).

## Edit 1: the pitch

The pack turns rigidly about the hinge -- the centre of its bottom, on the
legs' tops -- leaning its top toward the front (the bearing) until its
FITTED axis reads `PITCH_DEG`. The pitch is ASSERTED on the fitted axis
before (`PACK_ELEV_SOURCE`) and after (`PITCH_DEG` +- `PITCH_TOL_DEG`). The
legs take the turn in proportion to their height (`_leg_weight`, the mortar
part's bipod rule): the feet stay planted, each leg's top follows the corner
it holds, so the welded remesh never tears and nothing floats.

## Scale

Declared, not tuned: the pack (the canister block, from the cradle to the
caps) is `PACK_M` long, measured on its own fitted axis.

## Markings

The prompt and negative forbade text, and the Te'o's refine painted words
anyway (`export_meshy_spg_long_range._scrub_markings`). This bake is checked
for ink -- bright, unsaturated texels in clusters (`_ink_census`) -- and the
part is REFUSED over `INK_TEXELS_MAX`: a marking found here is scrubbed by
hand-located rectangles, as the Te'o's were, never shipped. This source
reads 127 clustered texels, every one in four bright steel fittings (looked
at one by one): no text, so nothing is scrubbed.

DETERMINISM: no `mathutils.noise`; every threshold is a constant applied to
the source's own vertex and texel data.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(REPO, "art", "meshy", "at-nlos-team-launcher-20261022-01a16328", "model.glb")
OUT = os.path.join(REPO, "art", "parts", "at_nlos_team")

#: The approved pitch (spec N4: 75 deg, range 70-80), the angle the lofted
#: round leaves at; asserted on the fitted pack axis after the turn.
PITCH_DEG = 75.0
PITCH_TOL_DEG = 0.5
#: The source came back near-vertical; anything outside this is not the
#: remesh this script was measured on.
PACK_ELEV_SOURCE = (84.0, 90.0)
#: The canister block, cradle to caps (spec N3: 1.90 x 0.56 x 0.56 m).
PACK_M = 1.90
#: Source z: the pack's bottom, where the four legs' tops meet its corners
#: (-0.659 measured) -- the hinge height; vertices at or above PACK_Z turn
#: fully, the legs below blend down to the feet (FOOT_Z), which stay put.
HINGE_Z = -0.66
PACK_Z = -0.70
FOOT_Z = -0.90
#: Source units along the pack axis: the vertices this close to either end
#: are that end's caps (for the muzzle and the backblast points).
END_BAND = 0.06
#: The junction box: source +X side of the pack, low on it.
BOX_X_MIN, BOX_Z = 0.30, (-0.66, -0.36)
#: Ink census: a texel is "ink" when bright and unsaturated, and it counts
#: only in a cluster -- an 8 x 8 window holding at least INK_CLUSTER of them
#: (a letter stroke at 2k is several texels wide; a glint is one or two).
INK_LUM, INK_SAT, INK_CLUSTER = 0.70, 0.20, 12
#: Measured 127, all of them in four bright steel fittings (brackets and a
#: bolt head, looked at one by one); a painted word at 2k is several hundred.
INK_TEXELS_MAX = 256
JPEG_QUALITY = 90


def log(msg):
    print(f"[nlos_launcher_part] {msg}", flush=True)


# ---------------------------------------------------------------- source

def load_source():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"expected one mesh in {SRC}, found {[o.name for o in meshes]}")
    ob = meshes[0]
    for o in list(bpy.context.scene.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    ob.name = ob.data.name = "at_nlos_team_launcher"
    log(f"source {os.path.relpath(SRC, REPO)}: {len(ob.data.polygons)} tris, {len(ob.data.vertices)} verts")
    return ob


def base_color_image(ob):
    mat = ob.active_material
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = next(l for l in mat.node_tree.links if l.to_node == bsdf and l.to_socket.name == "Base Color")
    if link.from_node.type != "TEX_IMAGE":
        raise SystemExit("the launcher's Base Color is not an image -- no bake")
    return mat, link.from_node.image


# ---------------------------------------------------------------- markings

def _ink_census(rgb):
    """(clustered ink texels, all bright unsaturated texels) in an (h, w, 3)
    float image: see INK_* above. Pure numpy, so a red input can be fed in."""
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    lum = rgb.mean(axis=2)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    ink = (lum > INK_LUM) & (sat < INK_SAT)
    h, w = ink.shape
    hh, ww = h - h % 8, w - w % 8
    cells = ink[:hh, :ww].reshape(hh // 8, 8, ww // 8, 8).sum(axis=(1, 3))
    hot = np.kron(cells >= INK_CLUSTER, np.ones((8, 8), dtype=bool))
    return int((ink[:hh, :ww] & hot).sum()), int(ink.sum())


def check_markings(img):
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(h, w, img.channels)[..., :3]
    clustered, bright = _ink_census(rgb)
    log(f"markings: {clustered} clustered ink texel(s) of {bright} bright unsaturated "
        f"({w}x{h} bake), ceiling {INK_TEXELS_MAX}")
    if clustered > INK_TEXELS_MAX:
        raise SystemExit(f"the bake carries {clustered} clustered ink texels -- painted text or markings. "
                         f"Scrub them by hand-located rectangles (the Te'o's `_scrub_markings`); do not ship it.")
    return clustered


# ---------------------------------------------------------------- geometry

def _fit_axis(co):
    """(centre, unit axis pointing up) of the points' principal direction."""
    c = co.mean(axis=0)
    _u, _s, vt = np.linalg.svd(co - c)
    ax = vt[0] if vt[0][2] >= 0 else -vt[0]
    return c, ax


def _elev(ax):
    return math.degrees(math.asin(max(-1.0, min(1.0, float(ax[2])))))


def _leg_weight(z):
    """How much of the pack's turn a vertex takes: all of it at or above the
    pack's bottom, none at the feet, linear between (the mortar part's legs)."""
    return min(1.0, max(0.0, (z - FOOT_Z) / (PACK_Z - FOOT_Z)))


def pitch(ob):
    """Turn the pack about the hinge to PITCH_DEG; the legs follow by
    `_leg_weight`, so the feet stay planted and nothing tears. Returns the
    measured points (source frame, turned), the scale factor and the source
    elevation."""
    me = ob.data
    co = np.array([v.co[:] for v in me.vertices])
    pack = co[co[:, 2] >= PACK_Z]
    _c, ax0 = _fit_axis(pack)
    e0 = _elev(ax0)
    log(f"source: pack {len(pack)} verts above z {PACK_Z}, {int((co[:, 2] < PACK_Z).sum())} in the stand; "
        f"pack axis elevation {e0:.2f} deg (toward {'front -Y' if ax0[1] < 0 else 'rear +Y'})")
    if not (PACK_ELEV_SOURCE[0] <= e0 <= PACK_ELEV_SOURCE[1]):
        raise SystemExit(f"pack axis at {e0:.2f} deg, outside {PACK_ELEV_SOURCE}: not the remesh this "
                         f"script was measured on -- re-measure")
    t = (pack - pack.mean(axis=0)) @ ax0
    length_src = float(t.max() - t.min())
    scale = PACK_M / length_src
    # The hinge: the centre of the pack's bottom, where the legs meet it.
    hinge = Vector((float(pack[:, 0].mean()), float(pack[:, 1].mean()), float(HINGE_Z)))
    # A rotation about +X by +theta takes +Z toward -Y, the front. Iterated on
    # the FITTED axis (the pack is not a perfect prism, so one turn by the
    # difference of angles lands a little short).
    theta = 0.0
    for _ in range(4):
        rot = Matrix.Translation(hinge) @ Matrix.Rotation(theta, 4, "X") @ Matrix.Translation(-hinge)
        turned = np.array([(rot @ Vector(p))[:] for p in pack])
        _c1, ax1 = _fit_axis(turned)
        e1 = _elev(ax1)
        if ax1[1] > 0:
            e1 = 180.0 - e1
        theta += math.radians(e1 - PITCH_DEG)
    rot = Matrix.Translation(hinge) @ Matrix.Rotation(theta, 4, "X") @ Matrix.Translation(-hinge)
    for v in me.vertices:
        w = _leg_weight(v.co.z)
        if w > 0.0:
            v.co = v.co.lerp(rot @ v.co, w)
    if me.has_custom_normals:
        me.normals_split_custom_set([(0, 0, 0)] * len(me.loops))
    for poly in me.polygons:
        poly.use_smooth = False
    me.update()
    co2 = np.array([v.co[:] for v in me.vertices])
    pack2 = np.array([(rot @ Vector(p))[:] for p in pack])
    _c2, ax1 = _fit_axis(pack2)
    e1 = _elev(ax1)
    lean = "front -Y" if ax1[1] < 0 else "rear +Y"
    log(f"pitched: turned {math.degrees(theta):+.2f} deg about the hinge {tuple(round(x, 3) for x in hinge)}; "
        f"pack axis elevation {e1:.2f} deg toward {lean} (want {PITCH_DEG} +- {PITCH_TOL_DEG}); "
        f"feet moved {float(np.abs(co2[co[:, 2] < FOOT_Z] - co[co[:, 2] < FOOT_Z]).max()):.4f}")
    if abs(e1 - PITCH_DEG) > PITCH_TOL_DEG or ax1[1] >= 0:
        raise SystemExit(f"pack axis at {e1:.2f} deg toward {lean} after the turn, want {PITCH_DEG} toward the front")

    # Fire points on the turned pack: its two end bands along the fitted
    # axis, the team's RIGHT half of each (source -X; the junction box is on
    # +X, the team's left). The top band holds the front pair's tall caps.
    c2 = pack2.mean(axis=0)
    t2 = (pack2 - c2) @ ax1
    right = pack2[:, 0] < c2[0]
    top = pack2[(t2 > t2.max() - END_BAND) & right]
    bot = pack2[(t2 < t2.min() + END_BAND) & right]
    if len(top) < 4 or len(bot) < 4:
        raise SystemExit(f"end bands too thin: top {len(top)}, bottom {len(bot)} vertices")
    muzzle = Vector(top.mean(axis=0).tolist())
    backblast = Vector(bot.mean(axis=0).tolist())
    box = pack2[(pack2[:, 0] > BOX_X_MIN) & (pack2[:, 2] > BOX_Z[0]) & (pack2[:, 2] < BOX_Z[1])]
    if len(box) < 8:
        raise SystemExit(f"no junction box found ({len(box)} vertices in its window)")
    socket = Vector((float(box[:, 0].max()), float(box[:, 1].mean()), float(box[:, 2].mean())))
    log(f"measured (source units, turned): muzzle {tuple(round(x, 3) for x in muzzle)}, "
        f"backblast {tuple(round(x, 3) for x in backblast)}, socket {tuple(round(x, 3) for x in socket)}")
    pts = {"hinge": hinge, "muzzle": muzzle, "backblast": backblast, "socket": socket}
    return pts, scale, e0, e1


def to_team_frame(ob, pts, scale):
    """Front (-Y) leads +X (+90 deg about Z), scaled to PACK_M, the hinge on
    the origin in xy, the lowest vertex on the ground."""
    xf = Matrix.Scale(scale, 4) @ Matrix.Rotation(math.radians(90.0), 4, "Z")
    ob.data.transform(xf)
    co = np.array([v.co[:] for v in ob.data.vertices])
    zmin = co[:, 2].min()
    h = xf @ pts["hinge"]
    shift = Matrix.Translation((-h.x, -h.y, -float(zmin)))
    ob.data.transform(shift)
    out = {k: shift @ (xf @ v) for k, v in pts.items()}
    co = np.array([v.co[:] for v in ob.data.vertices])
    log(f"team frame: scale {scale:.4f}; extent x {co[:, 0].min():+.3f}..{co[:, 0].max():+.3f} "
        f"y {co[:, 1].min():+.3f}..{co[:, 1].max():+.3f} z 0..{co[:, 2].max():.3f}; "
        + ", ".join(f"{k} {tuple(round(x, 3) for x in v)}" for k, v in out.items()))
    return out


# ---------------------------------------------------------------- write

def strip_textures(mat, keep):
    """Only the base colour ships (the importer composes it into the atlas);
    the refine's normal and metallic-roughness maps are dropped."""
    tree = mat.node_tree
    for n in list(tree.nodes):
        if n.type == "TEX_IMAGE" and n.image is not keep:
            tree.nodes.remove(n)
        elif n.type == "NORMAL_MAP":
            tree.nodes.remove(n)
    for img in list(bpy.data.images):
        if img is not keep and img.users == 0:
            bpy.data.images.remove(img)


def main():
    os.makedirs(OUT, exist_ok=True)
    ob = load_source()
    mat, img = base_color_image(ob)
    ink = check_markings(img)
    pts, scale, e0, e1 = pitch(ob)
    team = to_team_frame(ob, pts, scale)
    strip_textures(mat, img)
    ob["rl_role"] = "weapon"
    tris = len(ob.data.polygons)
    co = np.array([v.co[:] for v in ob.data.vertices])
    # glTF frame: (x, y, z)_blender -> (x, z, -y)
    gl = {k: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)] for k, v in team.items()}
    bpy.context.scene["rl_points"] = json.dumps(gl)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "launcher.blend"))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "launcher.glb"), export_format="GLB", use_selection=False,
        export_extras=True, export_yup=True, export_apply=True, export_image_format="JPEG",
        export_jpeg_quality=JPEG_QUALITY,
    )
    with open(os.path.join(OUT, "points.json"), "w") as fh:
        json.dump({"frame": "glTF metres, +X forward, +Y up, +Z anatomical right; the hinge on the origin in xy",
                   "source": os.path.relpath(SRC, REPO),
                   "pitch_deg": PITCH_DEG, "pitch_fitted_deg": round(e1, 2), "source_pitch_deg": round(e0, 2),
                   "pack_m": PACK_M, "scale": round(scale, 5), "tris": tris,
                   "ink_texels": ink,
                   "extent_m": [round(float(co[:, i].max() - co[:, i].min()), 3) for i in range(3)],
                   "points": gl}, fh, indent=2)
        fh.write("\n")
    log(f"wrote {OUT}/launcher.glb, launcher.blend, points.json: {tris} tris; points {gl}")


if __name__ == "__main__":
    main()
