"""Retarget the supplied Meshy combat-engineer rig (seven single-clip
`*_withSkin.glb` exports, one 17,202-vert mesh, one 24-joint Mixamo-style
skeleton -- IDENTICAL joint names and hierarchy to BOTH existing Meshy
importers' sources) into ONE contract-compliant team file:
`art/meshes/yahalom_engineer.glb`, per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` (v1, infantry).

A SIBLING of `import_meshy_soldier_irregular.py` (itself a sibling of
`import_meshy_soldier.py`), not a rewrite. Everything structural is inherited
unchanged: `import_base_clip`/`import_clip`, `_real_mesh` (highest-vertex-count
pick -- this source carries the same 42-vert `Icosphere` placeholder both
predecessors already delete), `_basecolor_image_array` (do NOT re-derive the V
convention; `image.pixels.foreach_get` is likewise load-bearing --
`img.pixels[:]` on a 4096^2 image silently returns unusable data),
`separate_by_role`, `fix_forward` as a documented no-op at 0.0,
`apply_forward_fix`/`FORWARD_FIX_DEG`, `sample_clip`, `write_combined_clip`
with its cyclic per-figure phase shift, `merge_clip_glbs`, `export_glb`, and
`CLIP_SEMANTICS`/`check_clip_semantics`.

Four things are genuinely NEW here, each because this source is different:

  1. **`work` is built.** No mesh team has ever had this clip.
     `tools/units/rig.py`'s own docstring records declining to build it
     ("its sixth clip, `work`, driving the mast into the ground, is NOT built
     here"), and the shipped `art/meshes/yahalom_squad.glb` carries
     `['down','fire','idle','move','wreck']` -- no `work` -- while the runtime
     has been ready for it all along (`clip.ts`'s `resolveClip` returns
     `'work'` above `'fire'`, and `ThreeRenderer.ts` feeds
     `working: sim.tunnelChargeProgress(i) > 0` into `applyMeshClip`). This
     source supplies a REAL crouch (`CrouchLookAroundBow`: a low kneel, torso
     folded forward, right arm reaching to the ground) -- so `work` is that
     crouch held, plus an authored right-arm pump, rather than a pose
     synthesized from a standing idle the way both predecessors' `down` was.
     `down` comes off the same crouch, frozen.

  2. **`fire` is NOT built, and its absence is a decision, not an oversight.**
     Measured on this rig: `Hips` is the dominant vertex group on 8,075 of
     17,202 verts (47%), and a per-vertex bone-dominance re-colour render
     shows that set includes the ENTIRE slung carbine and the ENTIRE
     rucksack. `Spine02` owns 1,367 verts, `Spine01` 104, `Spine` 4 -- the
     torso is effectively rigid to the pelvis. So `build_fire_src`'s
     arm-only recoil (the mechanism both predecessors use) cannot move this
     figure's weapon: it would raise the arms while a carbine slung
     MUZZLE-DOWN across the chest stayed exactly where it is. Nor is that
     recoil worth shipping for its own sake -- an FK probe on this rig puts
     the hand displacement of the predecessors' recoil at ~8 cm, which is
     ~1 px at the ~25 px gameplay size this art is judged at, so the clip
     would be invisible where it plays and wrong where it is inspected.
     `meshClipOrFallback` degrades a missing `fire` to `idle` by design.
     THIS IS A REGRESSION against the `kit.py` file this asset replaces,
     which does have a `fire`; see the task report, which ranks the three
     ways out.

  3. **`idle` is a TRIMMED, ping-ponged sub-range.** The only non-locomotion,
     non-fall, non-crouch source clip is `Confused_Scratch`, 277 frames, and
     the man spends most of them with a hand raised above his helmet (frame-
     by-frame `RightHand` world Z: 0.89 m at rest, 1.77 m at the scratch's
     peak, above 1.25 m for ~200 of the 277 frames). Only two stretches keep
     the hand down, frames 140-159 and 240-276. A closure search over every
     window >= 30 frames picks 246-276 (best pose distance in the file), and
     that window is inside the second hand-down stretch. It is played
     forward then backward (`_PINGPONG`) rather than looped raw: the raw
     window's endpoints still differ by ~3 degrees on several bones, and a
     mirrored sequence closes EXACTLY by construction while staying a
     well-defined cycle for `write_combined_clip`'s phase shift.

  4. **`wreck` is re-centred horizontally.** Unlike both predecessors' fall
     clips, `Shot_and_Fall_Backward` carries real root motion -- the `Hips`
     travel 1.34 m in y and 0.39 m in x across the fall. Held as-is (which is
     literally what `build_wreck_src` does, snapshotting `pb.location` for
     every bone including `Hips`), the corpse would sit ~0.45 tiles from the
     unit it belongs to, and would JUMP there at the `down`->`wreck`
     transition `mesh-death.ts` drives. `build_wreck_src` here keeps the
     fall's final rotation and its final HEIGHT and puts the horizontal
     translation back where the living figure's own was.

## Source clips, and why each canonical clip maps where it does

Measured `Hips` world-z travel (x100, this rig, this script's own
`check_clip_semantics` prints the final table):

    Walking_withSkin.glb                -> move   (7.69; closes to 6e-4)
    Confused_Scratch_withSkin.glb       -> idle   (whole clip 3.43; the
                                                   246-276 window 0.85,
                                                   in family with
                                                   sarim_rifles' own 0.955)
    CrouchLookAroundBow_withSkin.glb    -> down   (frame 82 frozen) and
                                        -> work   (frame 82 + arm pump)
    Shot_and_Fall_Backward_withSkin.glb -> wreck  (last frame, re-centred)

    Running_withSkin.glb                 UNUSED  (spare `move`, 8.17)
    Run_02_withSkin.glb                  UNUSED  (spare `move`, 11.11)
    Shot_and_Fall_Forward_withSkin.glb   UNUSED  (the second fall. Both last
                                                  frames were rendered from
                                                  two angles and compared:
                                                  Backward lies the body out
                                                  flat on its back, arms
                                                  spread, reading as a body
                                                  from the dimetric camera;
                                                  Forward puts the man face
                                                  down under his own
                                                  rucksack, which from above
                                                  reads as a pack, not a
                                                  casualty. The number agreed
                                                  -- Backward's final Hips
                                                  height is 0.129 m against
                                                  Forward's 0.153 -- but the
                                                  call was the render.)

`CrouchLookAroundBow` frame 82 is not an arbitrary pick: the clip sweeps the
head left and right through the 141 frames (yaw -99.8 to +29.1 degrees
against the body's own forward), and frame 82 is where the head is straightest
(-1.0 degrees) while the crouch is at its lowest settled height.

No `mathutils.noise` anywhere in this file.
"""
import json
import math
import os
import struct
import tempfile

import bpy
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: The unzipped Meshy delivery. `art/blend/` is gitignored and exists only in
#: the MAIN checkout, so a run from a git worktree must point this at that
#: checkout -- hence the env override rather than a bare repo-relative path.
SRC_DIR = os.environ.get(
    "RL_YAHALOM_SRC",
    os.path.join(
        REPO, "art", "blend", "KDF", "Yaalom",
        "Meshy_AI_combat_engineer_soldi_biped",
        "Meshy_AI_combat_engineer_soldi_biped",
    ),
)
OUT_PATH = os.environ.get("RL_YAHALOM_OUT", os.path.join(REPO, "art", "meshes", "yahalom_engineer.glb"))
SRC_PREFIX = "Meshy_AI_combat_engineer_soldi_biped_Animation_"

#: Clip build order -- also the order clips appear in the merged file.
#: `fire` is absent BY DECISION; see the module docstring, point 2.
CLIP_ORDER = ("idle", "move", "down", "work", "wreck")

#: The clips that actually loop at runtime, and so are the only ones a
#: per-figure phase shift is well-defined on. `down` and `wreck` are excluded
#: for the reason `import_meshy_soldier.py` excludes its own three: shifting a
#: held pose shifts nothing.
#:
#: `work` is added here, which neither predecessor had the clip to do. It is
#: a genuine loop -- `resolveClip` holds it for as long as
#: `tunnelChargeProgress > 0`, i.e. the whole 8 s `tunnel_charge_time_s` --
#: and a first render of it WITHOUT the shift showed both engineers pumping
#: the same arm through the same stroke on the same frame, which is exactly
#: the lockstep hard-won fact 6 records having to fix once already on the
#: march.
CYCLIC_CLIPS = frozenset({"idle", "move", "work"})

MOVE_SOURCE = SRC_PREFIX + "Walking_withSkin.glb"
IDLE_SOURCE = SRC_PREFIX + "Confused_Scratch_withSkin.glb"
CROUCH_SOURCE = SRC_PREFIX + "CrouchLookAroundBow_withSkin.glb"
FALL_SOURCE = SRC_PREFIX + "Shot_and_Fall_Backward_withSkin.glb"

#: The hand-down, settled window inside `Confused_Scratch`, as offsets from
#: that action's own `frame_range[0]` -- see the module docstring, point 3,
#: for how it was found and why it is mirrored rather than looped.
#:
#: A pure closure search first picked 246-276, and a frame-by-frame trace of
#: the `Hips` world position rejected it: across those 31 frames the pelvis
#: swings 14.9 cm sideways (x -16.7 -> -1.8 -> -4.7) as the man finishes
#: squaring up from the "confused" turn, which is TWICE the lateral sway of
#: this rig's own walk cycle -- a standing man out-shuffling a walking one.
#: 256-276 is the settled tail of that same move: 3.0 cm of lateral swing,
#: 0.42 cm vertical, 1.9 degrees of head yaw, and endpoints that already
#: nearly meet before the mirror closes them exactly.
IDLE_WINDOW = (256, 276)
_PINGPONG = True

#: `CrouchLookAroundBow`'s settled frame, as an offset from that action's own
#: `frame_range[0]`. Head straightest (-1.0 deg), crouch at its lowest.
CROUCH_FRAME = 82

#: Same semantics table both predecessors already built and proved, plus one
#: new row. See `import_meshy_soldier.py`'s own `CLIP_SEMANTICS` docstring for
#: the two prior instances of a Meshy clip being mapped onto a contract name
#: whose MEANING it did not match, which is what this gate exists to catch.
CLIP_SEMANTICS = {
    "idle": {
        "means": "standing hold, minimal motion -- the baseline every other clip is measured against.",
        "ceiling": lambda idle_travel: None,
    },
    "move": {
        "means": "a real gait cycle -- Hips travel is EXPECTED here, unlike every other clip in this table.",
        "ceiling": lambda idle_travel: None,
    },
    "fire": {
        # Unreachable by construction -- `fire` is not in CLIP_ORDER, and the
        # assert below keeps it that way. Kept, not deleted, so the meaning
        # this asset could not meet stays written down next to the ones it
        # could. See the module docstring, point 2.
        "means": "stand and shoot; recoil is upper-body only, so Hips travel must not exceed idle's own.",
        "ceiling": lambda idle_travel: idle_travel + 0.5,
    },
    "down": {
        "means": (
            "a HELD pose -- suppression, looped indefinitely, AND the first phase of death "
            "(mesh-death.ts plays this before wreck) -- near-zero Hips travel, well under idle's."
        ),
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
    },
    "work": {
        "means": (
            "a HELD kneeling work cycle -- the arms move, the figure does not. Driven by "
            "`tunnelChargeProgress > 0`, looped for as long as the charge is being placed, so "
            "any Hips travel here would bob the whole team every cycle. Same ceiling as down."
        ),
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
    },
    "wreck": {
        "means": "a HELD corpse pose -- same requirement as down: static, near-zero Hips travel.",
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
    },
}
assert "fire" not in CLIP_ORDER, "see the module docstring: fire is not built for this asset"

#: `tools/units/rig.py`'s own `TEAM_FIGURES["yahalom_squad"]`, copied verbatim
#: -- `_f("yah_a", 0.30, -0.20, leader=True)` and
#: `_f("yah_b", -0.34, 0.26, weapon="rifle")`. TWO figures, not the three both
#: predecessors build: this is a 2-figure team and its own spread is what the
#: kit.py file this replaces already uses.
FIGURE_SPREAD = (
    ("f0", 0.30, -0.20),
    ("f1", -0.34, 0.26),
)

#: Both roles `rig._yahalom_extras` grafts on are DROPPED rather than carried
#: over, for opposite reasons, and both are deliberate:
#:   * `yah_pack_a`/`yah_pack_b` (a `kit.box` worn pack per figure) -- this
#:     model already wears a large rucksack, measured at ~0.49 m behind the
#:     body's own centreline. Grafting a second one would double it.
#:   * `yah_mast`/`yah_head` (a 1.45 m `kit.tube` ground-penetrating mast held
#:     in yah_a's forearm) and the leader's radio antenna -- no equivalent
#:     geometry exists on this model, and the figure already carries a
#:     thigh-mounted tool with a mallet head that reads as engineer kit on its
#:     own. Grafting `kit.py` primitives onto a Meshy figure is contemplated
#:     in `import_meshy_soldier_irregular.py`'s docstring and has never been
#:     exercised; binding a 1.45 m tube to a forearm that owns 65 of this
#:     mesh's 17,202 verts would be a second unproven thing stacked on the
#:     first (`work` itself). If the engineer read is weak without it, that is
#:     its own follow-up.
_DROPPED_KIT_EXTRAS = ("yah_mast", "yah_head", "yah_pack_a", "yah_pack_b")

# --- role classification -------------------------------------------------
#
# This texture is NOT the Sarim source's, and `_ROLE_CENTROIDS_14` does not
# transfer (neither does the KDF soldier's `_ROLE_CENTROIDS`; both are
# source-specific and both scripts say so). Measured here: the whole 4096^2
# atlas is one desaturated tan hue -- per-vertex saturation sits at 0.098 at
# the median and 0.173 at the 99th percentile -- and luminance is a single
# broad unimodal ramp from 0.19 to 0.66 peaking at 0.42. So k-means on colour
# (k=12, colour + height + radial, the Sarim feature) returns luminance
# BANDS, not materials, exactly as the KDF soldier's texture did.
#
# What IS separable is VALUE, and it is separable cleanly. Confirmed the way
# the precedent insists on -- by re-colouring the actual mesh with a vertex-
# colour + emission material and rendering it from four sides, not from
# statistics: a luminance band at 0.22-0.33 lands exactly on the carbine, the
# knee pads, the thigh tool, the goggle lens and the chest-rig strap outlines,
# and on nothing else. The rules below are therefore thresholds on value plus
# three spatial facts, every one of them a fraction of THIS mesh's own
# measured extents (never an absolute coordinate), in the same spirit as the
# donor scripts' `_BOOT_FRAC`/`_FACE_FRAC`/`_CORE_BAND_ZFRAC`.
#
# Sampling matters and was measured before being chosen. Point-sampling one
# texel at each vertex's own UV (both predecessors' method) bottoms out at
# luminance 0.034 where the atlas's true black is 0.000; sampling each LOOP
# 25% of the way toward its own polygon's UV centroid and averaging per vertex
# is what `_basecolor_image_array`'s consumer below does instead. The
# difference is small on this asset (0.034 vs 0.069 at the darkest vertex) but
# it is the sampling the thresholds were fitted against, so it is the sampling
# that runs.
#
# `face` is NOT produced. There is no face: the model wears a full mask under
# goggles under a helmet, and the warmest vertices in the head band all turn
# out to be the near-white neck scarf (luminance 0.72-0.85) rather than skin.
# The scarf and mask go to `keffiyeh` -- the closed vocabulary's light
# head-cloth role, which `mesh-role.ts` shades through `limestone[0:3]`, and
# which is what a light scarf actually is. Naming it `face` to get the skin
# ramp would paint a balaclava as bare flesh.
_ROLE_LUM_GEAR = 0.335     # dark cloth gear: knee pads, straps, pouches
_ROLE_LUM_WEAPON = 0.315   # carbine + thigh tool, in front of the body
_ROLE_LUM_METAL = 0.30     # goggle lens, in the head band
_ROLE_LUM_SCARF = 0.60     # the near-white neck scarf / face mask
#: Behind the torso centreline by this fraction of the figure's own height ==
#: the rucksack. Measured: the pack reaches +0.49 of a metre behind the
#: centreline where the body's own back is at ~+0.15.
_PACK_DEPTH_ZFRAC = 0.115
_PACK_Z_RANGE = (0.45, 0.88)
_WEAPON_Z_RANGE = (0.35, 0.82)
_GEAR_Z_MAX = 0.78
_METAL_Z_MIN = 0.80
_SCARF_Z_RANGE = (0.79, 0.93)
#: Boot: the foot/toe bones own the boot's sole and vamp; its shaft rides the
#: shin bones, so a height cut finishes the job. 0.16 of the figure's own
#: height is 27 cm on this 170 cm model -- ankle height, checked on the
#: re-colour render.
_BOOT_ZFRAC = 0.16
_BOOT_BONES = ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase")
#: Torso band whose median (x, y) is taken as the figure's own centreline --
#: a median over a band, never a single point, and recomputed per-mesh.
_CORE_BAND_ZFRAC = (0.55, 0.72)

#: Collapse ratio applied to every role mesh AFTER separation and BEFORE
#: duplication; `None` ships the source density. Set `RL_YAHALOM_DECIMATE`
#: (with `RL_YAHALOM_OUT` to keep the two builds apart) to produce the other
#: one without editing this file.
#:
#: `None` is a CHOICE, not a default nobody made. Hard-won fact 7 says
#: decimate hard, and every shipped VEHICLE does; but neither shipped Meshy
#: INFANTRY team is decimated at all (meshy_soldier ships 14.8k verts/figure
#: against a 13.9k-vert source, sarim_rifles 17.4k against 17.2k), so `None`
#: is parity with the two files this one sits beside in `art/meshes/` and in
#: the same load. Both measured numbers are in the task report so the call can
#: be reversed on one line; if it is, look at the carbine and the goggle frame
#: specifically -- they are the thinnest geometry here and the first thing
#: Collapse eats.
DECIMATE_RATIO = (
    float(os.environ["RL_YAHALOM_DECIMATE"]) if os.environ.get("RL_YAHALOM_DECIMATE") else None
)


def _basecolor_image_array(mesh_obj):
    """(H, W, 4) float32 array of `mesh_obj`'s own Base-Color texture --
    identical method and identical V-flip reasoning to
    `import_meshy_soldier.py`'s own `_basecolor_image_array`; see that
    function's docstring for the calibration this relies on. Resolves the
    image through the BSDF's own `Base Color` link rather than "the first
    TEX_IMAGE node found", for the reason
    `import_meshy_soldier_irregular.py` gives. `pixels.foreach_get` is not
    interchangeable with `img.pixels[:]`, which on a 4096^2 image in this
    Blender silently returns unusable data."""
    mat = mesh_obj.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    image = bsdf.inputs["Base Color"].links[0].from_node.image
    w, h = image.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4), w, h


def _vertex_colors(mesh_obj):
    """Per-vertex linear RGB, sampled per LOOP 25% of the way toward the
    loop's own polygon UV centroid and averaged per vertex -- see the module
    comment above `_ROLE_LUM_GEAR` for why this rather than one texel at the
    vertex's own UV."""
    mesh = mesh_obj.data
    img, w, h = _basecolor_image_array(mesh_obj)

    nloops = len(mesh.loops)
    lv = np.empty(nloops, dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", lv)
    uv = np.empty(nloops * 2, dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(nloops, 2)

    starts = np.empty(len(mesh.polygons), dtype=np.int32)
    totals = np.empty(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get("loop_start", starts)
    mesh.polygons.foreach_get("loop_total", totals)
    centroid = np.zeros((nloops, 2), dtype=np.float32)
    for s, t in zip(starts, totals):
        centroid[s:s + t] = uv[s:s + t].mean(axis=0)

    inset = uv * 0.75 + centroid * 0.25
    px = np.clip(np.rint(inset[:, 0] * (w - 1)).astype(np.int64), 0, w - 1)
    py = np.clip(np.rint(inset[:, 1] * (h - 1)).astype(np.int64), 0, h - 1)
    loop_col = img[py, px, :3]

    n = len(mesh.vertices)
    out = np.zeros((n, 3), dtype=np.float32)
    cnt = np.zeros(n, dtype=np.int64)
    np.add.at(out, lv, loop_col)
    np.add.at(cnt, lv, 1)
    return out / np.maximum(cnt, 1)[:, None]


def classify_vertex_roles(mesh_obj):
    """Per-vertex role for every vertex of `mesh_obj`. MUST run before
    `mesh.data.materials.clear()` -- the material is this function's only
    route to the texture. Every role produced is inside the mesh unit
    contract's closed set of ten; see the module comment above
    `_ROLE_LUM_GEAR` for the method and how it was confirmed."""
    mesh = mesh_obj.data
    col = _vertex_colors(mesh_obj)
    lum = col[:, 0] * 0.2126 + col[:, 1] * 0.7152 + col[:, 2] * 0.0722

    n = len(mesh.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    zmax = float(co[:, 2].max())
    zfrac = co[:, 2] / zmax

    core = (zfrac > _CORE_BAND_ZFRAC[0]) & (zfrac < _CORE_BAND_ZFRAC[1])
    cy = float(np.median(co[core, 1]))
    depth = co[:, 1] - cy            # + behind the figure, - in front of it

    vg_name = {vg.index: vg.name for vg in mesh_obj.vertex_groups}
    on_foot = np.zeros(n, dtype=bool)
    for v in mesh.vertices:
        best_w, best_g = 0.0, None
        for g in v.groups:
            if g.weight > best_w:
                best_w, best_g = g.weight, vg_name.get(g.group)
        on_foot[v.index] = best_g in _BOOT_BONES

    roles = np.array(["uniform"] * n, dtype=object)
    pack = (depth > _PACK_DEPTH_ZFRAC * zmax) & (zfrac > _PACK_Z_RANGE[0]) & (zfrac < _PACK_Z_RANGE[1])
    roles[pack] = "webbing"
    roles[(lum < _ROLE_LUM_GEAR) & (zfrac < _GEAR_Z_MAX)] = "webbing"
    roles[
        (lum < _ROLE_LUM_WEAPON)
        & (zfrac > _WEAPON_Z_RANGE[0]) & (zfrac < _WEAPON_Z_RANGE[1])
        & (depth < 0.0) & ~pack
    ] = "weapon"
    roles[on_foot | (zfrac < _BOOT_ZFRAC)] = "boot"
    roles[(zfrac > _METAL_Z_MIN) & (lum < _ROLE_LUM_METAL)] = "metal"
    roles[(zfrac > _SCARF_Z_RANGE[0]) & (zfrac < _SCARF_Z_RANGE[1]) & (lum > _ROLE_LUM_SCARF)] = "keffiyeh"
    return list(roles)


#: The mesh unit contract's closed role vocabulary, restated here so a rule
#: above that ever produced something outside it fails loudly at build time
#: rather than at `rampForRole` in the browser. Kept in sync with
#: `packages/render/src/three/units/mesh-role.ts`'s own `MESH_ROLES`.
MESH_ROLES = frozenset({
    "uniform", "webbing", "boot", "face", "skin_shadow",
    "metal", "weapon", "wood", "charge", "keffiyeh",
})


def separate_by_role(mesh_obj, vertex_roles):
    """Identical to both predecessors' own `separate_by_role` --
    vertex-group-scoped `mesh.separate`, never raw index-based bmesh
    selection."""
    unknown = set(vertex_roles) - MESH_ROLES
    if unknown:
        raise RuntimeError(
            f"classify_vertex_roles produced role(s) outside the contract's closed set: {sorted(unknown)}"
        )
    present = sorted(set(vertex_roles) - {"uniform"})
    for role in present:
        vg = mesh_obj.vertex_groups.new(name=f"_role_{role}")
        vg.add([i for i, r in enumerate(vertex_roles) if r == role], 1.0, "REPLACE")

    by_role = {}
    for role in present:
        before = set(bpy.data.objects.keys())
        bpy.context.view_layer.objects.active = mesh_obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="VERT")
        bpy.ops.mesh.select_all(action="DESELECT")
        mesh_obj.vertex_groups.active_index = mesh_obj.vertex_groups[f"_role_{role}"].index
        bpy.ops.object.vertex_group_select()
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        new_name = next(iter(set(bpy.data.objects.keys()) - before))
        new_obj = bpy.data.objects[new_name]
        new_obj["rl_role"] = role
        by_role[role] = new_obj

    mesh_obj["rl_role"] = "uniform"
    by_role["uniform"] = mesh_obj

    for obj in by_role.values():
        for role in present:
            gname = f"_role_{role}"
            if gname in obj.vertex_groups:
                obj.vertex_groups.remove(obj.vertex_groups[gname])
    return by_role


def decimate_role_meshes(by_role, ratio):
    """Collapse-decimate each role mesh in place. Blender's Decimate
    preserves vertex groups, so the skin survives; the two thinnest pieces of
    geometry on this figure are the carbine and the goggle frame, and they are
    what to look at in a render before believing any ratio."""
    for role, obj in by_role.items():
        before = len(obj.data.vertices)
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new(name="dec", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
        print(f"  decimate {role}: {before} -> {len(obj.data.vertices)} verts")


def _new_objects_and_action(before_objs, before_actions):
    new_objs = [bpy.data.objects[n] for n in (set(bpy.data.objects.keys()) - before_objs)]
    new_actions = [a for a in bpy.data.actions if a.name not in before_actions]
    if len(new_actions) != 1:
        raise RuntimeError(f"expected exactly 1 new action, got {[a.name for a in new_actions]}")
    return new_objs, new_actions[0]


def _real_mesh(new_objs):
    """The actual character mesh among an import's new objects -- picked by
    HIGHEST vertex count, never by name or iteration order. This rig's seven
    source files each carry a 42-vert `Icosphere` placeholder alongside the
    real 17,202-vert `char1` (confirmed by inspection), exactly as both
    predecessors' sources do."""
    meshes = [o for o in new_objs if o.type == "MESH"]
    return max(meshes, key=lambda o: len(o.data.vertices))


def import_clip(path, target_name):
    before_objs = set(bpy.data.objects.keys())
    before_actions = set(a.name for a in bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new_objs, action = _new_objects_and_action(before_objs, before_actions)
    action.name = target_name
    action.use_fake_user = True
    for obj in new_objs:
        bpy.data.objects.remove(obj, do_unlink=True)
    return action


def import_base_clip(path, target_name):
    before_objs = set(bpy.data.objects.keys())
    before_actions = set(a.name for a in bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new_objs, action = _new_objects_and_action(before_objs, before_actions)
    action.name = target_name
    action.use_fake_user = True
    arm = next(o for o in new_objs if o.type == "ARMATURE")
    mesh = _real_mesh(new_objs)
    for obj in new_objs:
        if obj not in (arm, mesh):
            bpy.data.objects.remove(obj, do_unlink=True)
    return arm, mesh, action


#: Kept at 0 (inert), same reasoning as both predecessors' own -- a
#: Blender-side rest rotation is PROVABLY unable to touch this asset's
#: exported facing at any angle, because `bpy.ops.object.transform_apply`
#: preserves the armature's `matrix_world` and the scratch mesh is a parented
#: child that is never itself touched. The real fix is `FORWARD_FIX_DEG` /
#: `apply_forward_fix`, far below.
_FIX_FORWARD_DEG = 0.0


def fix_forward(arm_obj):
    """No-op at `_FIX_FORWARD_DEG=0`. Kept, not deleted -- see
    `import_meshy_soldier.py`'s own `fix_forward` docstring."""
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.rotation_euler = (0.0, 0.0, math.radians(_FIX_FORWARD_DEG))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def _set_action(arm, action):
    arm.animation_data.action = action
    arm.animation_data.action_slot = action.slots[0] if action.slots else None


def _pose_at(arm, action, frame_offset):
    """Snapshot every pose bone at `action.frame_range[0] + frame_offset`."""
    from mathutils import Quaternion  # noqa: PLC0415

    _set_action(arm, action)
    f0 = action.frame_range[0]
    fr = f0 + frame_offset
    bpy.context.scene.frame_set(int(fr), subframe=fr - int(fr))
    bpy.context.view_layer.update()
    return {
        pb.name: (Quaternion(pb.rotation_quaternion), tuple(pb.location), tuple(pb.scale))
        for pb in arm.pose.bones
    }


def _write_pose_action(arm, name, frames):
    """`frames` is a list of {bone: (quat, loc, scale)}; writes them onto a
    new action, one keyframe per index."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data.action = action
    arm.animation_data.action_slot = None
    for i, pose in enumerate(frames):
        for pb in arm.pose.bones:
            q, loc, sc = pose[pb.name]
            pb.rotation_quaternion = q
            pb.location = loc
            pb.scale = sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=i)
            pb.keyframe_insert(data_path="location", frame=i)
            pb.keyframe_insert(data_path="scale", frame=i)
    return action


def build_down_src(arm, crouch_action):
    """`down` -- `CrouchLookAroundBow`'s own settled frame, frozen as a
    two-frame static hold.

    Unlike both predecessors, nothing is synthesized: this source ships a real
    crouch, so `down` is a real kneel rather than a standing idle with
    authored leg bends. The reason it must be FROZEN rather than played is the
    same one `import_meshy_soldier.py`'s own `build_down_src` docstring gives
    and hard-won fact 3 restates -- `resolveClip` returns `down` for PINNED
    and ROUTED as well as dead, on LoopRepeat, so any motion here is a
    suppressed man doing it forever. The arithmetic agrees independently: the
    crouch cycle measures 1.93 against a `down` ceiling of 1.0, so it fails
    the gate as a cycle and passes as a hold."""
    base = _pose_at(arm, crouch_action, CROUCH_FRAME)
    return _write_pose_action(arm, "down_src", [base, base])


#: The authored `work` arm pump, measured on THIS rig with a standalone FK
#: probe at `CROUCH_FRAME`: each bone rotated +/-20 degrees about each local
#: axis, reading back the world displacement of the CHILD bone's head
#: (`RightHand`), never the bone's own auto-rigged tail. Local Z is the axis
#: that moves this hand vertically from this pose -- `RightArm` ax=2 gives
#: dz -0.110/+0.139 m at -/+20 degrees, `RightForeArm` ax=2 gives
#: dz -0.052/+0.065; local Y moves it essentially not at all (0.017 and 0.000
#: respectively), which is what an auto-rigged twist axis looks like.
#: The values below drive the right hand ~0.10 m down and back at the pump's
#: bottom -- roughly 1.5 px at gameplay size, which is the whole budget a
#: 25 px figure has, and the reason nothing bigger is attempted.
_WORK_PUMP_BONES = {
    "RightArm": (2, -14.0),
    "RightForeArm": (2, -16.0),
    "RightShoulder": (0, +4.0),
}
#: (frame, fraction of the peak). A push down, a short hold at the bottom,
#: then a withdraw -- 24 frames, so it reads as deliberate work rather than a
#: twitch when looped against an 8 s `tunnel_charge_time_s`.
_WORK_CYCLE = ((0, 0.0), (7, 1.0), (12, 0.95), (18, 0.15), (23, 0.0))
_AXIS_VEC = {0: (1.0, 0.0, 0.0), 1: (0.0, 1.0, 0.0), 2: (0.0, 0.0, 1.0)}


def build_work_src(arm, crouch_action):
    """`work` -- the SAME settled crouch `down` freezes, plus an authored
    right-arm pump. The first `work` clip any mesh team has ever had.

    Only the right arm chain moves. The torso is deliberately left alone even
    though a lean into the work would read well: on this rig the rucksack and
    the carbine are both weighted to `Hips` (measured: 8,075 of 17,202 verts,
    the pack and weapon visibly among them), while `Spine02` owns 1,367 and
    `Spine01` 104 -- so bending the spine slides the chest out from under a
    pack that stays with the pelvis. `Hips` itself is never touched, which is
    what keeps this clip's travel at zero under `CLIP_SEMANTICS['work']`."""
    from mathutils import Quaternion  # noqa: PLC0415

    base = _pose_at(arm, crouch_action, CROUCH_FRAME)
    frames = []
    for _frame, fraction in _WORK_CYCLE:
        pose = {}
        for pb in arm.pose.bones:
            base_q, base_loc, base_sc = base[pb.name]
            if pb.name in _WORK_PUMP_BONES:
                axis_idx, peak_deg = _WORK_PUMP_BONES[pb.name]
                delta = Quaternion(_AXIS_VEC[axis_idx], math.radians(peak_deg * fraction))
                pose[pb.name] = (base_q @ delta, base_loc, base_sc)
            else:
                pose[pb.name] = (base_q, base_loc, base_sc)
        frames.append(pose)
    # `_WORK_CYCLE`'s own frame numbers describe the intended timing; the
    # action is written one key per entry and `sample_clip` resamples it, so
    # expand to the stated spacing here rather than dropping the timing.
    expanded = []
    for i in range(len(_WORK_CYCLE) - 1):
        f_a, _ = _WORK_CYCLE[i]
        f_b, _ = _WORK_CYCLE[i + 1]
        for f in range(f_a, f_b):
            t = (f - f_a) / (f_b - f_a)
            pose = {}
            for name in frames[i]:
                qa, la, sa = frames[i][name]
                qb, _lb, _sb = frames[i + 1][name]
                pose[name] = (qa.slerp(qb, t), la, sa)
            expanded.append(pose)
    expanded.append(frames[-1])
    return _write_pose_action(arm, "work_src", expanded)


def build_idle_src(arm, scratch_action):
    """`idle` -- `Confused_Scratch`'s frames 246-276, played forward then
    backward. See the module docstring, point 3, for why this window and why
    mirrored."""
    a, b = IDLE_WINDOW
    forward = [_pose_at(arm, scratch_action, i) for i in range(a, b + 1)]
    frames = forward + (list(reversed(forward[1:-1])) if _PINGPONG else [])
    return _write_pose_action(arm, "idle_src", frames)


def build_wreck_src(arm, fall_action, living_pose):
    """`wreck` -- `Shot_and_Fall_Backward`'s own last frame, frozen as a
    two-frame static hold, with the fall's HORIZONTAL root translation undone.

    Both predecessors' `build_wreck_src` snapshot `pb.location` verbatim for
    every bone including `Hips`, which is correct for their sources and wrong
    for this one: this fall carries real root motion (the `Hips` travel 1.34 m
    in y and 0.39 m in x across the clip), so a verbatim hold would drop the
    corpse ~0.45 tiles from the unit it belongs to and JUMP it there at the
    `down` -> `wreck` transition `mesh-death.ts` drives. The final rotation
    and the final HEIGHT -- the parts that make it a corpse -- are kept
    exactly; only the horizontal offset is put back to `living_pose`'s own."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415

    end = _pose_at(arm, fall_action, fall_action.frame_range[1] - fall_action.frame_range[0])
    hips_rest = arm.data.bones["Hips"].matrix_local.copy()
    rot3 = hips_rest.to_3x3()

    def hips_translation(pose):
        q, loc, sc = pose["Hips"]
        return (hips_rest @ Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc))).translation

    t_end = hips_translation(end)
    t_live = hips_translation(living_pose)
    target = Vector((t_live.x, t_live.y, t_end.z))
    q, _loc, sc = end["Hips"]
    end = dict(end)
    end["Hips"] = (q, tuple(rot3.inverted() @ (target - hips_rest.translation)), sc)
    print(
        "  wreck root re-centred: hips (%.3f, %.3f, %.3f) -> (%.3f, %.3f, %.3f)"
        % (t_end.x, t_end.y, t_end.z, target.x, target.y, target.z)
    )
    return _write_pose_action(arm, "wreck_src", [end, end])


def duplicate_figure(scratch_arm, scratch_role_meshes, prefix, dx, dy):
    """Identical to both predecessors' own `duplicate_figure`."""
    bpy.context.preferences.edit.use_duplicate_mesh = True
    bpy.context.preferences.edit.use_duplicate_armature = True
    bpy.context.preferences.edit.use_duplicate_action = False

    bpy.ops.object.select_all(action="DESELECT")
    scratch_arm.select_set(True)
    for mesh_obj in scratch_role_meshes.values():
        mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = scratch_arm
    bpy.ops.object.duplicate(linked=False)

    selected = list(bpy.context.selected_objects)
    dup_arm = next(o for o in selected if o.type == "ARMATURE")
    dup_meshes_by_role = {}
    for o in selected:
        if o.type == "MESH":
            role = o.get("rl_role")
            if role is None:
                raise RuntimeError(f"{o.name}: duplicate lost its rl_role tag")
            dup_meshes_by_role[role] = o
    if set(dup_meshes_by_role) != set(scratch_role_meshes):
        raise RuntimeError(
            f"duplicate role mismatch: expected {sorted(scratch_role_meshes)}, "
            f"got {sorted(dup_meshes_by_role)}"
        )

    orig_names = [b.name for b in dup_arm.data.bones]
    for name in orig_names:
        for mesh_obj in dup_meshes_by_role.values():
            mesh_obj.vertex_groups[name].name = f"{prefix}_{name}"
    for name in orig_names:
        dup_arm.data.bones[name].name = f"{prefix}_{name}"

    dup_arm.animation_data_clear()
    dup_arm.location = (dx, dy, 0.0)
    return dup_arm, dup_meshes_by_role


def sample_clip(scratch_arm, src_action):
    """Identical to both predecessors' own `sample_clip` -- `action_slot` is
    reassigned explicitly rather than left stale or cleared to `None`."""
    _set_action(scratch_arm, src_action)
    bpy.context.view_layer.update()
    f0, f1 = src_action.frame_range
    n_steps = max(1, round(f1 - f0))
    bone_names = [pb.name for pb in scratch_arm.pose.bones]

    frames = []
    for step in range(n_steps + 1):
        src_frame = f0 + (f1 - f0) * step / n_steps
        bpy.context.scene.frame_set(int(src_frame), subframe=src_frame - int(src_frame))
        bpy.context.view_layer.update()
        frames.append(
            {
                name: (
                    tuple(scratch_arm.pose.bones[name].rotation_quaternion),
                    tuple(scratch_arm.pose.bones[name].location),
                    tuple(scratch_arm.pose.bones[name].scale),
                )
                for name in bone_names
            }
        )
    return frames


#: Both predecessors' own `GAIT_PHASE_FRACTIONS`, and `tools/units/rig.py`'s.
#: A three-entry table indexed `i % 3`, so this 2-figure team draws 0 and 1/3
#: rather than the 0 and 1/2 that would separate two figures best. Left as-is
#: rather than special-cased: it works, it is what every other team in both
#: pipelines uses, and a second phase table would be a divergence to no
#: measurable end at 25 px.
GAIT_PHASE_FRACTIONS = (0.0, 1.0 / 3.0, 2.0 / 3.0)


def write_combined_clip(merged_arm, figures, clip_name, frames, cyclic=False):
    """Identical to both predecessors' own `write_combined_clip`."""
    combined = bpy.data.actions.new(clip_name)
    combined.use_fake_user = True
    if merged_arm.animation_data is None:
        merged_arm.animation_data_create()
    merged_arm.animation_data.action = combined
    merged_arm.animation_data.action_slot = None

    n = len(frames)
    for step in range(n):
        for i, (prefix, _dx, _dy) in enumerate(figures):
            if cyclic:
                shift = round(n * GAIT_PHASE_FRACTIONS[i % len(GAIT_PHASE_FRACTIONS)])
                sampled = frames[(step + shift) % n]
            else:
                sampled = frames[step]
            for name, (q, loc, sc) in sampled.items():
                pb = merged_arm.pose.bones[f"{prefix}_{name}"]
                pb.rotation_quaternion = q
                pb.location = loc
                pb.scale = sc
                pb.keyframe_insert(data_path="rotation_quaternion", frame=step)
                pb.keyframe_insert(data_path="location", frame=step)
                pb.keyframe_insert(data_path="scale", frame=step)
    return combined


def _hips_world_z_travel(frames, hips_rest, arm_world):
    """Identical to both predecessors' own `_hips_world_z_travel`."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415

    zs = []
    for f in frames:
        q, loc, sc = f["Hips"]
        basis = Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc))
        zs.append((arm_world @ (hips_rest @ basis)).translation.z)
    return (max(zs) - min(zs)) * 100.0


def check_clip_semantics(frames_by_clip, hips_rest, arm_world):
    """Identical to both predecessors' own `check_clip_semantics`."""
    travel = {name: _hips_world_z_travel(frames_by_clip[name], hips_rest, arm_world) for name in CLIP_ORDER}
    idle_travel = travel["idle"]
    print("Hips world-z travel x100, by clip:", {k: round(v, 3) for k, v in travel.items()})

    for name in CLIP_ORDER:
        ceiling = CLIP_SEMANTICS[name]["ceiling"](idle_travel)
        if ceiling is not None and travel[name] > ceiling:
            raise RuntimeError(
                f"{name}: Hips travel {travel[name]:.3f} exceeds {ceiling:.3f} -- "
                f"CLIP_SEMANTICS['{name}']['means'] = {CLIP_SEMANTICS[name]['means']!r}"
            )
    return travel


def export_glb(arm_obj, path):
    """Identical to both predecessors' own `export_glb` -- every clip must be
    exported completely alone, because a shared multi-action armature at
    export time silently collapses every clip's every channel to two
    identical keyframes."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    for child in arm_obj.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_extras=True,
        export_materials="NONE",
        export_rest_position_armature=True,
        export_optimize_animation_size=False,
    )


def _read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, _version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise RuntimeError(f"{path}: not a GLB (bad magic)")
    offset = 12
    gltf = None
    bin_data = b""
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from("<I4s", data, offset)
        chunk_data = data[offset + 8: offset + 8 + chunk_len]
        if chunk_type == b"JSON":
            gltf = json.loads(chunk_data)
        elif chunk_type == b"BIN\x00":
            bin_data = chunk_data
        offset += 8 + chunk_len
    if gltf is None:
        raise RuntimeError(f"{path}: no JSON chunk")
    return gltf, bytearray(bin_data)


def _write_glb(gltf, bin_data, path):
    json_bytes = json.dumps(gltf).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    bin_bytes = bytes(bin_data)
    bin_bytes += b"\x00" * ((4 - len(bin_bytes) % 4) % 4)
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
        f.write(bin_bytes)


#: Degrees about glTF/three.js +Y needed to turn this asset's own exported
#: facing into the contract's local +X.
#:
#: Both predecessors measured +90 for their own sources, and this rig shares
#: their exact bone names, hierarchy, armature scale (0.01) and
#: `headfront`/`Head` marker relationship -- `headfront` sits at
#: `Head + (0.009, -0.212, -0.009)` on the base clip's first frame, i.e. the
#: figure faces Blender -Y, which exports to glTF +Z, which +90 about Y takes
#: to +X. That reasoning is SUGGESTIVE AND NOT SUFFICIENT on its own (hard-won
#: fact 1: five of five supplied Meshy assets needed a baked rotation, and a
#: still render answers "which end sits at +X", never "which end is the
#: front"), so it is confirmed here by measurement on the SHIPPED artifact
#: rather than on the source: `tools/../scratchpad` verification loads the
#: exported GLB through three.js itself, walks the skeleton under the
#: `forward_fix` wrapper, and reads where `headfront` lands relative to `Head`
#: in world space -- against `art/meshes/at_team.glb` (kit.py, forward-correct
#: by construction) and `art/meshes/sarim_rifles.glb` (this same +90) as
#: controls. See the task report for the measured numbers.
FORWARD_FIX_DEG = 90.0


def _quat_y(deg):
    half = math.radians(deg) / 2.0
    return [0.0, math.sin(half), 0.0, math.cos(half)]


def apply_forward_fix(gltf, deg):
    """Identical to both predecessors' own `apply_forward_fix` -- a post-export
    glTF wrapper node, never a Blender-side rest rotation."""
    scene_idx = gltf.get("scene", 0)
    scene = gltf["scenes"][scene_idx]
    old_top_nodes = list(scene["nodes"])
    wrapper = {"name": "forward_fix", "rotation": _quat_y(deg), "children": old_top_nodes}
    wrapper_idx = len(gltf["nodes"])
    gltf["nodes"].append(wrapper)
    scene["nodes"] = [wrapper_idx]


def merge_clip_glbs(clip_paths, out_path, forward_fix_deg=0.0):
    """Identical to both predecessors' own `merge_clip_glbs`."""
    names = list(clip_paths.keys())
    base_gltf, base_bin = _read_glb(clip_paths[names[0]])
    base_node_names = [n.get("name") for n in base_gltf["nodes"]]
    if len(base_gltf["animations"]) != 1:
        raise RuntimeError(
            f"{names[0]}: expected exactly 1 animation in the base file, "
            f"got {len(base_gltf['animations'])}"
        )
    base_gltf["animations"][0]["name"] = names[0]

    for clip_name in names[1:]:
        gltf, bin_data = _read_glb(clip_paths[clip_name])
        node_names = [n.get("name") for n in gltf["nodes"]]
        if node_names != base_node_names:
            raise RuntimeError(
                f"{clip_name}: node name/order differs from the base file "
                f"({names[0]}) -- cannot merge by index"
            )
        if len(gltf["animations"]) != 1:
            raise RuntimeError(f"{clip_name}: expected exactly 1 animation, got {len(gltf['animations'])}")
        anim = gltf["animations"][0]

        bufferview_remap = {}

        def remap_bufferview(old_idx, _gltf=gltf, _bin=bin_data, _map=bufferview_remap):
            if old_idx in _map:
                return _map[old_idx]
            bv = dict(_gltf["bufferViews"][old_idx])
            start = bv.get("byteOffset", 0)
            length = bv["byteLength"]
            chunk = bytes(_bin[start: start + length])
            base_bin.extend(b"\x00" * ((4 - len(base_bin) % 4) % 4))
            bv["byteOffset"] = len(base_bin)
            bv["buffer"] = 0
            base_bin.extend(chunk)
            new_idx = len(base_gltf["bufferViews"])
            base_gltf["bufferViews"].append(bv)
            _map[old_idx] = new_idx
            return new_idx

        accessor_remap = {}

        def remap_accessor(old_idx, _gltf=gltf, _map=accessor_remap):
            if old_idx in _map:
                return _map[old_idx]
            acc = dict(_gltf["accessors"][old_idx])
            if "bufferView" in acc:
                acc["bufferView"] = remap_bufferview(acc["bufferView"])
            new_idx = len(base_gltf["accessors"])
            base_gltf["accessors"].append(acc)
            _map[old_idx] = new_idx
            return new_idx

        new_samplers = []
        for samp in anim["samplers"]:
            new_samp = dict(samp)
            new_samp["input"] = remap_accessor(samp["input"])
            new_samp["output"] = remap_accessor(samp["output"])
            new_samplers.append(new_samp)

        base_gltf["animations"].append(
            {"name": clip_name, "channels": [dict(ch) for ch in anim["channels"]], "samplers": new_samplers}
        )

    if forward_fix_deg:
        apply_forward_fix(base_gltf, forward_fix_deg)

    base_gltf["buffers"][0]["byteLength"] = len(base_bin)
    _write_glb(base_gltf, base_bin, out_path)


def main():
    if not os.path.isdir(SRC_DIR):
        raise SystemExit(
            f"source not found: {SRC_DIR}\n"
            "art/blend/ is gitignored and lives only in the main checkout -- from a worktree, set\n"
            "  RL_YAHALOM_SRC=/path/to/Meshy_AI_combat_engineer_soldi_biped/Meshy_AI_combat_engineer_soldi_biped"
        )
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # --- 1. import: base rig from Walking, then the three clips read for pose.
    scratch_arm, scratch_mesh, move_src = import_base_clip(
        os.path.join(SRC_DIR, MOVE_SOURCE), "move_src"
    )
    scratch_src = import_clip(os.path.join(SRC_DIR, IDLE_SOURCE), "scratch_src")
    crouch_src = import_clip(os.path.join(SRC_DIR, CROUCH_SOURCE), "crouch_src")
    fall_src = import_clip(os.path.join(SRC_DIR, FALL_SOURCE), "fall_src")

    # --- 2. classify every vertex's rl_role from the mesh's OWN base-color
    # texture, BEFORE the material is stripped.
    vertex_roles = classify_vertex_roles(scratch_mesh)
    role_counts = {role: vertex_roles.count(role) for role in sorted(set(vertex_roles))}
    total = len(vertex_roles)
    print(
        f"rl_role classification (single figure, {total} verts): "
        + ", ".join(f"{role}={n} ({n / total:.1%})" for role, n in role_counts.items())
    )

    # --- 3. zero materials ------------------------------------------------
    scratch_mesh.data.materials.clear()

    # --- 4. fix forward -- documented no-op, see `fix_forward`'s docstring.
    fix_forward(scratch_arm)
    hips_rest = scratch_arm.data.bones["Hips"].matrix_local.copy()
    arm_world = scratch_arm.matrix_world.copy()

    # --- 4.5. build idle / down / work / wreck ----------------------------
    idle_src = build_idle_src(scratch_arm, scratch_src)
    down_src = build_down_src(scratch_arm, crouch_src)
    work_src = build_work_src(scratch_arm, crouch_src)
    living_pose = _pose_at(scratch_arm, move_src, 0)
    wreck_src = build_wreck_src(scratch_arm, fall_src, living_pose)

    # --- 5. sample every clip into plain Python data, off the scratch rig,
    # BEFORE any duplication happens.
    src_by_clip = {
        "idle": idle_src, "move": move_src, "down": down_src,
        "work": work_src, "wreck": wreck_src,
    }
    frames_by_clip = {name: sample_clip(scratch_arm, src_by_clip[name]) for name in CLIP_ORDER}
    print("frames per clip:", {k: len(v) for k, v in frames_by_clip.items()})

    # --- 5.5. enforce CLIP_SEMANTICS before any expensive downstream work --
    check_clip_semantics(frames_by_clip, hips_rest, arm_world)

    # --- 6. delete every `*_src` action BEFORE duplicating/renaming --------
    # Load-bearing ordering: Blender's bone-rename callback is not scoped to
    # the object being renamed. See `import_meshy_soldier.py`'s own `main()`.
    for action in (move_src, scratch_src, crouch_src, fall_src, idle_src, down_src, work_src, wreck_src):
        action.use_fake_user = False
        bpy.data.actions.remove(action)

    # --- 7. split the scratch mesh by role, BEFORE duplication -------------
    scratch_role_meshes = separate_by_role(scratch_mesh, vertex_roles)
    print(f"roles present: {sorted(scratch_role_meshes)}")
    if DECIMATE_RATIO is not None:
        decimate_role_meshes(scratch_role_meshes, DECIMATE_RATIO)

    # --- 8. duplicate x2 (armature + every role mesh together), prefix
    # bones/vgroups, spread ------------------------------------------------
    from collections import defaultdict  # noqa: PLC0415

    figures, dup_arms = [], []
    role_dup_meshes = defaultdict(list)
    for prefix, dx, dy in FIGURE_SPREAD:
        dup_arm, dup_meshes_by_role = duplicate_figure(scratch_arm, scratch_role_meshes, prefix, dx, dy)
        figures.append((prefix, dx, dy))
        dup_arms.append(dup_arm)
        for role, mesh_obj in dup_meshes_by_role.items():
            role_dup_meshes[role].append(mesh_obj)

    # --- 9. join each role's duplicates into one mesh FIRST, THEN join the
    # armatures -- load-bearing ordering (hard-won fact 4: reversing it
    # silently corrupts the pose, no crash).
    n_fig = len(FIGURE_SPREAD)
    merged_meshes = {}
    for role, meshes in role_dup_meshes.items():
        bpy.ops.object.select_all(action="DESELECT")
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = role
        merged.data.name = role
        merged["rl_role"] = role
        merged_meshes[role] = merged
        if len(merged.vertex_groups) != 24 * n_fig:
            raise RuntimeError(
                f"{role}: expected {24 * n_fig} vertex groups after join, got {len(merged.vertex_groups)}"
            )

    # --- 10. now join the armatures ---------------------------------------
    bpy.ops.object.select_all(action="DESELECT")
    for arm in dup_arms:
        arm.select_set(True)
    bpy.context.view_layer.objects.active = dup_arms[0]
    bpy.ops.object.join()
    merged_arm = dup_arms[0]

    if len(merged_arm.data.bones) != 24 * n_fig:
        raise RuntimeError(f"expected {24 * n_fig} bones after join, got {len(merged_arm.data.bones)}")
    for role, merged in merged_meshes.items():
        if merged.modifiers[0].object != merged_arm:
            raise RuntimeError(f"{role}: Armature modifier does not target the merged armature")

    total_verts = sum(len(m.data.vertices) for m in merged_meshes.values())
    total_tris = sum(len(m.data.loop_triangles) for m in merged_meshes.values()) or sum(
        len(m.data.polygons) for m in merged_meshes.values()
    )
    print(f"merged: {len(merged_meshes)} role mesh(es) {sorted(merged_meshes)}, {total_verts} verts total")

    # --- 11. scratch rig no longer needed ----------------------------------
    for mesh_obj in scratch_role_meshes.values():
        bpy.data.objects.remove(mesh_obj, do_unlink=True)
    bpy.data.objects.remove(scratch_arm, do_unlink=True)
    bpy.data.orphans_purge(do_recursive=True)

    # --- 12. write + export each clip ALONE, one export call per clip ------
    tmp_dir = tempfile.mkdtemp(prefix="meshy_yahalom_clips_")
    clip_paths = {}
    for clip_name in CLIP_ORDER:
        combined = write_combined_clip(
            merged_arm, figures, clip_name, frames_by_clip[clip_name],
            cyclic=clip_name in CYCLIC_CLIPS,
        )
        tmp_path = os.path.join(tmp_dir, f"{clip_name}.glb")
        export_glb(merged_arm, tmp_path)
        clip_paths[clip_name] = tmp_path
        merged_arm.animation_data.action = None
        combined.use_fake_user = False
        bpy.data.actions.remove(combined)

    # --- 13. merge the single-clip temp files into the real output ---------
    merge_clip_glbs(
        {name: clip_paths[name] for name in CLIP_ORDER}, OUT_PATH, forward_fix_deg=FORWARD_FIX_DEG
    )
    for path in clip_paths.values():
        os.remove(path)
    os.rmdir(tmp_dir)

    print(
        f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), clips={list(CLIP_ORDER)}, "
        f"bones={len(merged_arm.data.bones)}, roles={sorted(merged_meshes)}, "
        f"verts={total_verts}, tris~{total_tris}, decimate={DECIMATE_RATIO}"
    )


if __name__ == "__main__":
    main()
