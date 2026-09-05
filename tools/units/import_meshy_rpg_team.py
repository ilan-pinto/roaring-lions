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
    Fall_Dead    travel 265.076  net 136.315   a fall, huge root  -> down/wreck
                                               (LAST FRAME only)
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
}
CLIP_ORDER = ("idle", "move", "fire", "down", "wreck")

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
#: unscaled wrote 22,404 KiB.
TEXTURE_PX = 1024


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

    # Drop the maps this renderer has no lights to consume, and keep exactly
    # one base_color. Same call CLAUDE.md records for the textured buildings:
    # "metallic_roughness/normal are dropped at export: there are no lights in
    # this scene to consume them."
    for name in [i.name for i in bpy.data.images]:
        if "metallic" in name or "normal" in name:
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

        d_arm.scale = (scale, scale, scale)
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

    # ---- build the five clips -------------------------------------------
    if merged_arm.animation_data is None:
        merged_arm.animation_data_create()
    move_len = int(src_actions["move"].frame_range[1])
    fall_end = int(src_actions["_fall"].frame_range[1])

    for clip in CLIP_ORDER:
        act = bpy.data.actions.new(clip)
        act.use_fake_user = True
        standing = CLIP_STANDING[clip]
        span = range(0, move_len + 1) if clip == "move" else range(0, 2)
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
                    if clip == "move":
                        for kp in fc.keyframe_points:
                            f = (kp.co.x + shift) % (move_len + 1)
                            nfc.keyframe_points.insert(f, kp.co.y)
                    else:
                        # `down`/`wreck` hold the fall's LAST frame: the clip
                        # itself carries 136 cm of net root travel and the
                        # build gate refuses that, so the corpse is a held
                        # pose, exactly as the irregular importer does it.
                        y = fc.evaluate(fall_end)
                        for f in span:
                            nfc.keyframe_points.insert(f, y)
                    for kp in nfc.keyframe_points:
                        kp.interpolation = "LINEAR"
            key_scale(act, f"{prefix}_Hips", 1.0 if standing else 0.0, span)
            key_scale(act, f"{prefix}_crouch_root", 0.0 if standing else 1.0, span)
        log(f"clip {clip}: {'standing' if standing else 'CROUCH'} geometry, "
            f"{len(read_fcurves(act))} fcurves, frames {min(span)}..{max(span)}")

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
            "Rigged standing fighter for move/down/wreck; a separate supplied crouching "
            "fighter, rigid-bound and scale-keyed, for idle/fire."
        ),
    )
    log(f"wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KiB)")


main()
