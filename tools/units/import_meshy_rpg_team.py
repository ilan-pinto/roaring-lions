"""Build `art/meshes/rpg_team.glb` from the supplied Meshy RPG-fighter set.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_rpg_team.py -- OUT.glb

SOURCES -- `art/blend/enemy/RPG team/`, all AI-generated (Meshy), disclosed
per CONTRIBUTING.md:

  Meshy_AI_Fighter_standing_RPG__biped/          THE RIGGED ASSET. 19,339
      Character_output.glb                       verts, ONE material, ONE
      ..._Animation_Walking_withSkin.glb         4K base_color, and the same
      ..._Animation_Running_withSkin.glb         24-bone skeleton (Hips ..
      ..._Animation_Fall_Dead_..._withSkin.glb   headfront, neck) as every
      ..._Animation_Backflip_withSkin.glb        other Meshy figure here.

  Meshy_AI_Fighter_crouching_RPG_...blend        966,154 verts, NO rig, its
                                                 own 4K bake. The firing
                                                 posture.
  Meshy_AI_Fighter_standing_RPG__...blend        971,018 verts, NO rig. The
                                                 hi-res source the biped was
                                                 decimated from. NOT USED --
                                                 the biped is that mesh with
                                                 a skeleton on it.

## The clips, measured rather than trusted

Hips path travel, x100, over each clip's own frame range -- the same gate
`import_meshy_soldier_irregular.py` applies, and for the reason recorded
there: a clip's NAME does not tell you what it means.

    Walking      travel  34.612  net   1.174   real gait          -> move
    Running      travel  31.452  net   0.001   real gait, in place   spare
    Fall_Dead    travel 265.076  net 136.315   a fall, huge root  -> fall (WHOLE
                                               clip, root held horizontal, D3)
                                               and down/wreck (its held last
                                               frame -- same standing spot)
    Backflip     travel 242.066  z-range 78.9  a BACKFLIP          unused

**There is no idle clip and no fire clip in this set.** Meshy's idle for this
character is the backflip, which is what the project lead meant by "when idle,
flipping" -- and it is why the instruction is that the unit crouches for both:
"when shooting the unit should be in crouch mode also when idle not shooting."

## How the crouch gets in: two geometries, one armature

The crouching source is a static 966k mesh with no skeleton, so it cannot be a
clip. It becomes a SECOND geometry in the same file, rigid-bound to its own
bone, and every clip keys the two roots' scale -- standing at 1 and crouch at
0 for `move`/`down`/`wreck`, the reverse for `idle`/`fire`. That mechanism is
not invented here: `tools/units/rig.py`'s `_figure_death_parts` already does
exactly this to give infantry a prone death that FK-folding the standing rig
could not produce, and CLAUDE.md records it working.

The two supplied meshes are separate Meshy generations, and an automated
comparison of their 4K bakes reads them as different (mean RGB 0.439/0.376/
0.317 against 0.512/0.428/0.362, tone-histogram intersection 0.66). That
measurement is misleading and was checked by eye before being acted on: it
compares whole ATLASES, including the unused space that a different UV layout
moves around. Rendered side by side the two are plainly the same man -- tan
robes, white checkered keffiyeh, black chest rig, brown boots, black gloves --
so swapping between them across clips does not change who the player is
looking at. Recorded because the number, taken alone, says the opposite.

## Textures ship

This unit carries its supplied bake rather than the 42-colour palette, under
the project lead's standing instruction: "i have provided a very detailed
blender files and i want them to be used as is unless ill provide other
instruction." That needs `rpg_team` naming itself in the textured exemption on
both sides -- `TEXTURED_BUILDING_TYPES` and `TEXTURED_MESH_EXEMPT` -- which
until now has held only `house`, `apartment` and `warehouse`, all buildings.
Infantry has never taken it. Two consequences, both already true of the
buildings and neither new here: `pnpm validate:meshes` cannot palette-check
this file (the gate repaints from the palette before rendering, so it would be
measuring a stand-in), and the texture's `colorSpace` must be `NoColorSpace`
at load or the renderer's pass-through output darkens it.
"""
import math
import os
import sys

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "art", "blend", "enemy", "RPG team")
BIPED = os.path.join(SRC, "Meshy_AI_Fighter_standing_RPG__biped")
CROUCH_BLEND = os.path.join(SRC, "Meshy_AI_Fighter_crouching_RPG_0903175634_image-to-3d-texture.blend")

TAG = "rpg_team"

#: Clip file -> canonical clip name. `Backflip` is deliberately absent.
CLIP_SOURCES = {
    "move": "Meshy_AI_Fighter_standing_RPG__biped_Animation_Walking_withSkin.glb",
    "_fall": "Meshy_AI_Fighter_standing_RPG__biped_Animation_Fall_Dead_from_Abdominal_Injury_withSkin.glb",
}
BASE_GLB = "Meshy_AI_Fighter_standing_RPG__biped_Character_output.glb"

#: Clip order in the output, and which geometry each one shows.
#: True = the standing skinned mesh, False = the crouch.
CLIP_STANDING = {
    "idle": False,
    "move": True,
    "fire": False,
    "down": True,
    "wreck": True,
    "fall": True,
}
CLIP_ORDER = ("idle", "move", "fire", "down", "wreck", "fall")

#: Design D3 (`2026-09-17-infantry-animation-design.md`): `fall` is the
#: supplied `Fall_Dead` clip bound WHOLE, one-shot, with its (huge -- net
#: 136 cm, see the module docstring's table) root motion held horizontally
#: so the man drops where he stood; `down`/`wreck` already held its LAST
#: frame and now hold the SAME re-centred position, so the runtime's switch
#: from finished fall to persistent wreck moves nothing.
FALL_STAGGER_S = 0.1
#: Metres the Hips may drift horizontally across `fall` after the hold --
#: the runtime gate (`tools/src/mesh_gait.test.ts`) uses the same 0.05.
FALL_HORIZONTAL_CEILING_M = 0.05

#: teams.py's own rpg_team offsets, in tiles. Both figures carry a launcher
#: (the lead's call): at gameplay size the launcher's diagonal is the only
#: thing identifying this team, so carrying it twice doubles the one cue that
#: works, where a rifle-armed loader adds a silhouette shared with every other
#: irregular team on the map.
FIGURES = (("f0", (0.18, -0.26)), ("f1", (-0.30, 0.30)))

#: Match the height the game already draws an irregular at -- `sarim_rifles`'
#: own figures measure 1.614 m. A mesh replacing a billboard must not change
#: how big the unit is.
TARGET_HEIGHT_M = 1.614

#: How far the crouch mesh drops relative to the standing figure's feet. Both
#: are grounded independently, so this is 0; kept named so a future source
#: that is not grounded has an obvious place to say so.
CROUCH_GROUND_Z = 0.0

CROUCH_DECIMATE_TARGET = 19000

#: Bake resolution to ship. The source is 4096x4096 on a figure the player
#: sees at roughly 30 px; every textured building in this repo carries a JPEG
#: of 520-660 KiB and a whole file under 1.8 MB, and exporting this source
#: unscaled wrote 22,404 KiB. Deliberately lower than
#: `tools/vehicles/textured.py`/`tools/buildings/textured.py`'s shared 2048:
#: those ship on vehicles and buildings the camera gets far closer to, and
#: this figure's own screen footprint was measured, not assumed. Unaffected
#: by "dont drop resolution" -- that instruction is about not dropping a MAP
#: (see `DROPPED_TEXTURE_SUBSTRINGS`), not about raising this ceiling.
TEXTURE_PX = 1024

#: Name substrings dropped before export (a loose `in` match, not an exact
#: or prefix match like the two sibling modules use -- catches a name
#: regardless of what Blender's `.001`-style collision suffix does to it,
#: which matters here since the standing and crouch poses are two separate
#: Meshy generations, each appending its own `metallic_roughness`/`normal`
#: pair). Empty since 2026-09-14: the renderer has lights now
#: (`packages/render/src/three/lighting.ts`), and
#: `packages/render/src/three/world-materials.ts`'s `texturedMaterial` keeps
#: a GLB's `metalnessMap`/`roughnessMap`/`normalMap` when present, so these
#: are no longer dead weight. Kept maps still go through the `shrink_texture`
#: calls below like every other image, so they ship at the same `TEXTURE_PX`
#: ceiling as `base_color` rather than at native resolution -- the lead:
#: "dont drop resolution". This is the third, independent copy of the same
#: policy `tools/vehicles/textured.py::DROPPED_PREFIXES` and
#: `tools/buildings/textured.py::DROPPED_MAPS` name; fixed the same way in
#: the same change.
DROPPED_TEXTURE_SUBSTRINGS: tuple[str, ...] = ()


def log(msg):
    print(f"[{TAG}] {msg}")


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def drop_placeholders(objs):
    """Blender's glTF importer materialises a 42-vertex radius-1.0 Icosphere
    that is NOT in the file -- the GLBs declare one mesh each. Filtered on
    "no vertex groups and tiny" rather than by name, so a renamed placeholder
    is still caught."""
    out = []
    for o in list(objs):
        if o.type == "MESH" and not o.vertex_groups and len(o.data.vertices) < 100:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        out.append(o)
    return out


def mesh_bbox(objs):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in objs:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def shrink_texture(img, target=TEXTURE_PX):
    """A 4096x4096 bake on a figure the player sees at about 30 px is 22 MB of
    GLB for pixels no screen ever resolves -- measured: exporting the source
    unchanged wrote 22,404 KiB, where every textured building this repo ships
    carries a JPEG of 520-660 KiB and a whole-file size under 1.8 MB. Scaled
    and re-encoded to match that budget."""
    before = tuple(img.size)
    if img.size[0] > target or img.size[1] > target:
        img.scale(target, target)
    img.file_format = "JPEG"
    log(f"texture {img.name!r}: {before[0]}x{before[1]} -> {img.size[0]}x{img.size[1]} JPEG")


def rename_bones(arm_obj, prefix):
    for b in arm_obj.data.bones:
        if not b.name.startswith(f"{prefix}_"):
            b.name = f"{prefix}_{b.name}"


def retarget_action(act, prefix):
    """Rewrite an action's bone references to the prefixed names. Source
    actions address `pose.bones["Hips"]`; after renaming they must address
    `pose.bones["f0_Hips"]`. Done on the data path string because that is
    where a bone name lives in an F-curve."""
    for fc in act.fcurves:
        dp = fc.data_path
        if 'pose.bones["' in dp and f'pose.bones["{prefix}_' not in dp:
            fc.data_path = dp.replace('pose.bones["', f'pose.bones["{prefix}_')


def read_fcurves(act):
    """Blender 5.x actions are SLOTTED: `Action.fcurves` no longer exists and
    the curves live at layers[].strips[].channelbags[].fcurves. Probed against
    this Blender (5.2) rather than assumed, because the old attribute fails
    with a bare AttributeError that reads like a missing action."""
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def writable_fcurves(act, name="Team"):
    """The write side of the same change: a fresh action has no slot, no layer
    and no strip, and every one has to be created before a curve can be."""
    if hasattr(act, "fcurves"):
        return act.fcurves
    slot = act.slots[0] if len(act.slots) else act.slots.new(id_type="OBJECT", name=name)
    layer = act.layers[0] if len(act.layers) else act.layers.new("layer0")
    strip = layer.strips[0] if len(layer.strips) else layer.strips.new(type="KEYFRAME")
    cb = strip.channelbags[0] if len(strip.channelbags) else strip.channelbags.new(slot)
    return cb.fcurves


def key_scale(act, bone, value, frames):
    """Key one bone's scale to a constant across `frames` -- the switch that
    shows one geometry and hides the other. `rig.py`'s `_figure_death_parts`
    already uses exactly this to swap standing geometry for prone."""
    fcs = writable_fcurves(act)
    for axis in range(3):
        fc = fcs.new(data_path=f'pose.bones["{bone}"].scale', index=axis)
        for f in frames:
            kp = fc.keyframe_points.insert(f, value)
            kp.interpolation = "CONSTANT"


def hips_location_fcurves(act, bone):
    """The three `location` f-curves of `bone` in `act`, index-ordered."""
    fcs = [fc for fc in read_fcurves(act) if fc.data_path == f'pose.bones["{bone}"].location']
    fcs.sort(key=lambda fc: fc.array_index)
    if len(fcs) != 3:
        raise RuntimeError(f"{act.name}: expected 3 location f-curves on {bone}, got {len(fcs)}")
    return fcs


def _hips_world_position(arm, prefix, act, frame, loc_scale):
    """World-space position of `{prefix}_Hips` at `frame` of `act`, from its
    location f-curves alone. A pose bone's rotation/scale do not move its OWN
    head -- only its children's -- so `matrix_basis`'s translation component
    equals `loc` regardless of the bone's quaternion/scale at that frame, and
    `rest @ Matrix.Translation(loc)` gives the same world position a full
    `rest @ Matrix.LocRotScale(loc, quat, scale)` would (verified: the
    sampled-pose importers' `_hips_armature_translation` does the LocRotScale
    version and both agree here) -- PROVIDED `loc` is in the same coordinate
    scale `rest` is. It is not, without `loc_scale`: `act`'s raw f-curve
    values are the SOURCE `base_arm`'s own units (that armature's own
    `scale`, e.g. 0.01 -- this rig's own "armature scale" convention), while
    `rest` (`arm.data.bones[...].matrix_local`, `arm` = the FINAL merged
    figure) has been re-baked to `TARGET_HEIGHT_M`. `rest.to_3x3()` is a
    PURE rotation regardless of any of that baking (a bone's local axes are
    always unit vectors by construction), so it does not carry the scale
    difference for us -- `loc_scale` (`hips_loc_scale` in `main()`, = the
    SOURCE armature's own scale times the height-normalisation factor) must.
    Skipping it was measured giving a Hips 87 m off the ground instead of
    0.87 m -- see the task report."""
    from mathutils import Matrix, Vector  # noqa: PLC0415

    rest = arm.data.bones[f"{prefix}_Hips"].matrix_local
    loc = Vector([fc.evaluate(frame) for fc in hips_location_fcurves(act, "Hips")]) * loc_scale
    return arm.matrix_world @ (rest @ Matrix.Translation(loc))


def held_hips_location(arm, prefix, src_act, frame, hold_xy, loc_scale):
    """`{prefix}_Hips`' pose-space location at `frame` of `src_act`, with its
    WORLD x/y replaced by `hold_xy` (z kept) -- the horizontal hold the
    sampled-pose importers do in `hold_hips_horizontal`, on an f-curve.

    `src_act`'s curves still address `Hips`, not `{prefix}_Hips` -- they are
    read BEFORE `retarget_action` (never applied to `_fall`); `arm` is
    `merged_arm` after `rename_bones`, so the rest matrix is looked up under
    the PREFIXED name -- each figure's own rest matrix already carries its
    spread offset (Blender's armature join preserves world-space
    representation), which is what makes the SAME source location value
    resolve to a different, correct world position per figure. `loc_scale`
    is passed straight through to `_hips_world_position`; this function's
    own RETURN VALUE needs no separate correction -- it is built from
    `target` (already in `rest`'s own, correctly-scaled space, via `hold_xy`
    and `_hips_world_position`) and `rest.translation` (same space), so the
    result is a pose-space location `rest` can consume directly."""
    from mathutils import Vector  # noqa: PLC0415

    rest = arm.data.bones[f"{prefix}_Hips"].matrix_local
    rot3 = rest.to_3x3()
    world = _hips_world_position(arm, prefix, src_act, frame, loc_scale)
    target = arm.matrix_world.inverted() @ Vector((hold_xy[0], hold_xy[1], world.translation.z))
    return rot3.inverted() @ (target - rest.translation)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: ... --python tools/units/import_meshy_rpg_team.py -- OUT.glb")
    out_path = os.path.abspath(argv[0])
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    clear()

    # ---- base rigged figure -------------------------------------------
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(BIPED, BASE_GLB))
    new = drop_placeholders([o for o in bpy.data.objects if o not in before])
    base_arm = next(o for o in new if o.type == "ARMATURE")
    base_body = next(o for o in new if o.type == "MESH")
    lo, hi = mesh_bbox([base_body])
    natural_h = hi[2] - lo[2]
    scale = TARGET_HEIGHT_M / natural_h
    log(f"base: {len(base_arm.data.bones)} bones, {len(base_body.data.vertices)} verts, "
        f"height {natural_h:.4f} -> {TARGET_HEIGHT_M} m (scale {scale:.4f})")
    # `base_arm.scale` is this rig's own "armature scale (0.01)" convention
    # (`import_meshy_yahalom.py`'s docstring names the same pattern for a
    # different source): `Hips.matrix_local`'s translation and every
    # `pose.bones["Hips"].location` value in `src_actions` are BOTH in that
    # same "raw" (un-scaled-down) space. `d_arm` below gets duplicated from
    # `base_arm` and then re-scaled for `TARGET_HEIGHT_M`, so any Hips
    # location value taken from a SOURCE action and combined with the
    # DUPLICATED figure's own (differently-baked) rest needs this SAME
    # factor applied first -- see `_hips_world_position`'s docstring and the
    # task report for the measured 87 m / 0.87 m before/after this line
    # existed.
    hips_loc_scale = base_arm.scale[0] * scale

    for img in bpy.data.images:
        if img.name != "Render Result":
            shrink_texture(img)

    # ---- source clips --------------------------------------------------
    src_actions = {}
    for name, fname in CLIP_SOURCES.items():
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(BIPED, fname))
        added = [o for o in bpy.data.objects if o not in before]
        a2 = next(o for o in added if o.type == "ARMATURE")
        act = a2.animation_data.action
        act.name = f"src_{name}"
        act.use_fake_user = True
        src_actions[name] = act
        fs, fe = [int(v) for v in act.frame_range]
        log(f"source clip {name}: frames {fs}..{fe}")
        for o in added:
            bpy.data.objects.remove(o, do_unlink=True)
        # Purge, never hand-remove: each clip import brings its own copy of the
        # 4K bake, and deleting datablocks one at a time out of `bpy.data.images`
        # invalidates the very list being iterated -- "StructRNA of type Image
        # has been removed". `orphans_purge` cascades correctly.
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True,
                                       do_recursive=True)

    # ---- crouch geometry ------------------------------------------------
    before = set(bpy.data.objects)
    bpy.ops.wm.append(directory=os.path.join(CROUCH_BLEND, "Object"), filename="mesh_node")
    crouch_src = [o for o in bpy.data.objects if o not in before]
    crouch = next(o for o in crouch_src if o.type == "MESH")
    n0 = len(crouch.data.vertices)
    mod = crouch.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, CROUCH_DECIMATE_TARGET / n0)
    bpy.context.view_layer.objects.active = crouch
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f"crouch: {n0} -> {len(crouch.data.vertices)} verts")
    for img in bpy.data.images:
        if img.name != "Render Result" and img.size[0] > TEXTURE_PX:
            shrink_texture(img)
    clo, chi = mesh_bbox([crouch])
    log(f"crouch bbox size=({chi[0]-clo[0]:.3f},{chi[1]-clo[1]:.3f},{chi[2]-clo[2]:.3f})")

    # DROPPED_TEXTURE_SUBSTRINGS is empty since 2026-09-14 -- see its own
    # docstring -- so this no longer removes anything; kept as a loop rather
    # than deleted outright so a future re-drop is a one-line constant change
    # here, matching how the two sibling modules keep theirs.
    for name in [i.name for i in bpy.data.images]:
        if any(s in name for s in DROPPED_TEXTURE_SUBSTRINGS):
            img = bpy.data.images.get(name)
            if img:
                bpy.data.images.remove(img)
                log(f"dropped map {name!r}")

    # ---- ground and scale both geometries ------------------------------
    for ob, label in ((base_body, "standing"), (crouch, "crouch")):
        ob.select_set(False)
    bpy.ops.object.select_all(action="DESELECT")

    cscale = TARGET_HEIGHT_M / natural_h
    # The crouch is a different generation and is NOT the same height as a
    # standing man by construction -- it is a man kneeling. Scale it by the
    # ratio the STANDING pair establishes (source units -> metres), never by
    # its own bounding height, which would stretch a kneeling figure up to
    # standing height.
    crouch.scale = (cscale, cscale, cscale)
    bpy.context.view_layer.objects.active = crouch
    crouch.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    crouch.select_set(False)
    clo, chi = mesh_bbox([crouch])
    crouch.location = (-(clo[0] + chi[0]) / 2, -(clo[1] + chi[1]) / 2, -clo[2] + CROUCH_GROUND_Z)
    bpy.context.view_layer.objects.active = crouch
    crouch.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    crouch.select_set(False)
    clo, chi = mesh_bbox([crouch])
    log(f"crouch scaled+grounded: height {chi[2]-clo[2]:.3f} m, footprint "
        f"{chi[0]-clo[0]:.3f} x {chi[1]-clo[1]:.3f} m")

    # ---- per-figure assembly -------------------------------------------
    arms, bodies = [], []
    for prefix, (tx, ty) in FIGURES:
        bpy.ops.object.select_all(action="DESELECT")
        base_arm.select_set(True)
        base_body.select_set(True)
        bpy.context.view_layer.objects.active = base_arm
        bpy.ops.object.duplicate()
        dup = list(bpy.context.selected_objects)
        d_arm = next(o for o in dup if o.type == "ARMATURE")
        d_body = next(o for o in dup if o.type == "MESH")
        d_arm.name = f"arm_{prefix}"
        d_body.name = f"body_{prefix}"

        # PRE-EXISTING BUG, found and fixed while wiring `held_hips_location`
        # (task report has the numbers): this OVERWROTE `d_arm`'s own
        # duplicated-from-`base_arm` scale instead of composing with it.
        # `base_arm.scale` is (0.01, 0.01, 0.01) -- this rig's own "armature
        # scale (0.01)" convention, the same one `import_meshy_yahalom.py`'s
        # docstring names for a different source -- so a bare overwrite baked
        # `scale` (~0.9494) into bone rest data ~100x too large relative to
        # the mesh (whose OWN object scale is 1.0 and was never touched here).
        # Invisible for `move` (its Hips.location values are near-zero, a
        # deliberately in-place cycle) and for `idle`/`fire` (crouch geometry,
        # no armature-driven Hips motion at all), but NOT for `down`/`wreck`:
        # `Fall_Dead`'s own last frame carries real translation, so the
        # existing held pose was ~100x displaced from the standing figure --
        # invisible again ONLY because nothing measured its absolute
        # position before `held_hips_location` needed to.
        d_arm.scale = tuple(s * scale for s in base_arm.scale)
        bpy.ops.object.select_all(action="DESELECT")
        d_arm.select_set(True)
        d_body.select_set(True)
        bpy.context.view_layer.objects.active = d_arm
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

        # A crouch copy, rigid-bound to its own bone.
        bpy.ops.object.select_all(action="DESELECT")
        crouch.select_set(True)
        bpy.context.view_layer.objects.active = crouch
        bpy.ops.object.duplicate()
        d_crouch = bpy.context.selected_objects[0]
        d_crouch.name = f"crouch_{prefix}"

        # The extra bone. Added in edit mode on this figure's own armature,
        # before any renaming, then renamed with everything else.
        bpy.context.view_layer.objects.active = d_arm
        bpy.ops.object.mode_set(mode="EDIT")
        eb = d_arm.data.edit_bones.new("crouch_root")
        eb.head = (0.0, 0.0, 0.0)
        eb.tail = (0.0, 0.0, 0.2)
        bpy.ops.object.mode_set(mode="OBJECT")

        rename_bones(d_arm, prefix)
        for vg in d_body.vertex_groups:
            if not vg.name.startswith(f"{prefix}_"):
                vg.name = f"{prefix}_{vg.name}"

        vg = d_crouch.vertex_groups.new(name=f"{prefix}_crouch_root")
        vg.add(range(len(d_crouch.data.vertices)), 1.0, "REPLACE")
        d_crouch.parent = d_arm
        m = d_crouch.modifiers.new("arm", type="ARMATURE")
        m.object = d_arm

        for ob in (d_arm, d_body, d_crouch):
            ob.location = (ob.location.x + tx, ob.location.y + ty, ob.location.z)
        arms.append((prefix, d_arm))
        bodies.extend([d_body, d_crouch])
        log(f"figure {prefix} at ({tx:+.2f}, {ty:+.2f}): body {len(d_body.data.vertices)} + "
            f"crouch {len(d_crouch.data.vertices)} verts")

    bpy.data.objects.remove(base_body, do_unlink=True)
    bpy.data.objects.remove(base_arm, do_unlink=True)
    bpy.data.objects.remove(crouch, do_unlink=True)

    # ---- join into one armature ----------------------------------------
    bpy.ops.object.select_all(action="DESELECT")
    for _p, a in arms:
        a.select_set(True)
    merged_arm = arms[0][1]
    bpy.context.view_layer.objects.active = merged_arm
    bpy.ops.object.join()
    merged_arm.name = "Armature"
    log(f"merged armature: {len(merged_arm.data.bones)} bones")

    # ---- build the six clips -------------------------------------------
    if merged_arm.animation_data is None:
        merged_arm.animation_data_create()
    move_len = int(src_actions["move"].frame_range[1])
    fall_start = int(src_actions["_fall"].frame_range[0])
    fall_end = int(src_actions["_fall"].frame_range[1])
    fall_len = fall_end - fall_start
    stagger = round(FALL_STAGGER_S * bpy.context.scene.render.fps)

    # Each figure's OWN standing spot -- where `fall` and (via the SAME
    # value at `fall_end`) `down`/`wreck` all hold horizontally, so a man
    # dies where he stood, at his own spread offset, and the corpse sits
    # exactly on `fall`'s own last frame. `src_actions["_fall"]` is the one
    # shared, unprefixed source action; the same location value resolves to
    # a different world position per figure because each figure's own
    # `{prefix}_Hips` rest matrix already carries its offset (see
    # `held_hips_location`'s docstring).
    hold_xy_by_prefix = {
        prefix: (lambda w: (w.translation.x, w.translation.y))(
            _hips_world_position(merged_arm, prefix, src_actions["_fall"], fall_start, hips_loc_scale)
        )
        for prefix, _a in FIGURES
    }

    for clip in CLIP_ORDER:
        act = bpy.data.actions.new(clip)
        act.use_fake_user = True
        standing = CLIP_STANDING[clip]
        if clip == "move":
            span = range(0, move_len + 1)
        elif clip == "fall":
            # `fall_len + 1` frames per figure, figure `i` starting `stagger *
            # i` output frames later -- the same stagger shape the sampled-
            # pose importers give `write_combined_clip`, done here directly on
            # f-curves instead.
            span = range(0, fall_len + 1 + stagger * (len(FIGURES) - 1))
        else:
            span = range(0, 2)
        for i, (prefix, _a) in enumerate(FIGURES):
            if standing:
                src = src_actions["move" if clip == "move" else "_fall"]
                # Per-figure phase shift on the one cyclic clip, so two men do
                # not march in lockstep -- the same idea the mesh contract
                # applies to `idle`/`move` elsewhere.
                shift = (move_len // len(FIGURES)) * i if clip == "move" else 0
                dst = writable_fcurves(act)
                # The geometry switch OWNS the two root scales. The supplied
                # Walking action keys `Hips.scale` itself, so copying it and
                # then keying the switch collides ("F-Curve ... already exists
                # in this channelbag"). The switch wins: a scale curve on the
                # root here is the difference between a figure that draws and
                # one that does not.
                reserved = {f'pose.bones["{prefix}_Hips"].scale',
                            f'pose.bones["{prefix}_crouch_root"].scale'}
                for fc in read_fcurves(src):
                    dp = fc.data_path.replace('pose.bones["', f'pose.bones["{prefix}_')
                    if dp in reserved:
                        continue
                    nfc = dst.new(data_path=dp, index=fc.array_index)
                    is_hips_loc = dp == f'pose.bones["{prefix}_Hips"].location'
                    if clip == "move":
                        for kp in fc.keyframe_points:
                            f = (kp.co.x + shift) % (move_len + 1)
                            nfc.keyframe_points.insert(f, kp.co.y)
                    elif clip == "fall":
                        # Design D3: the WHOLE fall plays, one-shot, staggered
                        # per figure, with Hips held horizontal -- unlike
                        # `down`/`wreck` below, which hold only the last frame.
                        for f in range(fall_len + 1):
                            raw = fall_start + f
                            value = (
                                held_hips_location(
                                    merged_arm, prefix, src, raw, hold_xy_by_prefix[prefix], hips_loc_scale
                                )[fc.array_index]
                                if is_hips_loc
                                else fc.evaluate(raw)
                            )
                            nfc.keyframe_points.insert(f + stagger * i, value)
                        if i > 0:
                            # Held flat from frame 0 until this figure's own
                            # start -- LINEAR interpolation between two keys
                            # of the SAME value (this one and the real f=0 key
                            # just written at `stagger * i`) holds flat with
                            # no extra interpolation mode needed.
                            first_value = (
                                held_hips_location(
                                    merged_arm, prefix, src, fall_start, hold_xy_by_prefix[prefix], hips_loc_scale
                                )[fc.array_index]
                                if is_hips_loc
                                else fc.evaluate(fall_start)
                            )
                            nfc.keyframe_points.insert(0, first_value)
                    else:
                        # `down`/`wreck` hold the fall's LAST frame, Hips
                        # horizontally re-centred to the SAME standing spot
                        # `fall` holds -- so the corpse sits where the figure
                        # stood, exactly on `fall`'s own last frame, and the
                        # `fall` -> `wreck` transition `mesh-death.ts` drives
                        # moves nothing. Non-Hips-location curves are held
                        # verbatim, as before.
                        y = (
                            held_hips_location(
                                merged_arm, prefix, src, fall_end, hold_xy_by_prefix[prefix], hips_loc_scale
                            )[fc.array_index]
                            if is_hips_loc
                            else fc.evaluate(fall_end)
                        )
                        for f in span:
                            nfc.keyframe_points.insert(f, y)
                    for kp in nfc.keyframe_points:
                        kp.interpolation = "LINEAR"
            key_scale(act, f"{prefix}_Hips", 1.0 if standing else 0.0, span)
            key_scale(act, f"{prefix}_crouch_root", 0.0 if standing else 1.0, span)
        log(f"clip {clip}: {'standing' if standing else 'CROUCH'} geometry, "
            f"{len(read_fcurves(act))} fcurves, frames {min(span)}..{max(span)}")

    # ---- build-time drift check on `fall`, mirroring the sampled-pose
    # importers' `check_clip_semantics` horizontal block -------------------
    from mathutils import Matrix, Vector  # noqa: PLC0415

    fall_action = bpy.data.actions["fall"]
    f0, f1 = fall_action.frame_range
    for prefix, _a in FIGURES:
        fcs = hips_location_fcurves(fall_action, f"{prefix}_Hips")
        rest = merged_arm.data.bones[f"{prefix}_Hips"].matrix_local
        pts = []
        zs = []
        for f in range(int(f0), int(f1) + 1):
            loc = Vector([fc.evaluate(f) for fc in fcs])
            world = merged_arm.matrix_world @ (rest @ Matrix.Translation(loc))
            pts.append((world.translation.x, world.translation.y))
            zs.append(world.translation.z)
        x0, y0 = pts[0]
        drift = max(math.hypot(x - x0, y - y0) for x, y in pts)
        log(
            f"fall: {prefix} Hips horizontal drift {drift:.4f} m (ceiling {FALL_HORIZONTAL_CEILING_M}), "
            f"height {zs[0]:.4f} -> {zs[-1]:.4f} m"
        )
        if drift > FALL_HORIZONTAL_CEILING_M:
            raise RuntimeError(
                f"fall: {prefix} Hips drift {drift:.3f} m exceeds {FALL_HORIZONTAL_CEILING_M} m -- "
                "the horizontal hold is not holding"
            )

    merged_arm.animation_data.action = bpy.data.actions["idle"]
    # A slotted action also needs its slot bound, or the object plays nothing.
    if hasattr(merged_arm.animation_data, "action_slot"):
        slots = bpy.data.actions["idle"].slots
        if len(slots):
            merged_arm.animation_data.action_slot = slots[0]

    for ob in bodies:
        ob["rl_textured"] = True

    bpy.ops.export_scene.gltf(
        filepath=out_path, export_format="GLB", use_selection=False,
        export_apply=False, export_yup=True, export_skins=True,
        export_animations=True, export_extras=True, export_materials="EXPORT",
        export_copyright=(
            "Ashwar RPG team -- AI-generated (Meshy), disclosed per CONTRIBUTING.md. "
            "Rigged standing fighter for move/fall/down/wreck; a separate supplied crouching "
            "fighter, rigid-bound and scale-keyed, for idle/fire."
        ),
    )
    log(f"wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KiB)")


main()
