"""Export the Meshy-generated RPG-7 launcher as a glTF prop, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/units/export_meshy_rpg.py -- OUT.glb

The destination is REQUIRED and has no default. `art/meshes/props/rpg7.glb`
is where this asset belongs, but `render_mesh_gate.py`'s `mesh_kind` has no
`props` kind yet: it falls an unknown subdirectory through to `infantry` and
then looks for a sprite sheet that does not exist. The gate globs
`art/meshes/**/*.glb` with no ignore of untracked files, so a GLB written
there before that kind exists turns `pnpm validate:meshes` red for EVERY
session sharing this tree -- CLAUDE.md records exactly that happening, a
stray `zz_throwaway.glb` colliding at IoU 1.000.

This is the gear half of GH-155's Ashwar batch (`docs/art/meshy-prompts-ashwar.md`,
prompt 1). It is a PROP, not a unit: it carries no rig and draws nothing on its
own. `rpg_team.glb` is a separate, later step that parents this to the
irregular figure's shoulder.

SOURCES (two .blend files supplied; both inspected, one used)

  art/blend/enemy/wepons/
      Meshy_AI_RPG_7_launcher_0903143528_image-to-3d-texture.blend
          one welded object `mesh_node`, 977,326 verts, ONE material with
          three packed textures (base_color 4096x4096, metallic_roughness
          2048x2048, normal 4096x4096). NOT USED.

  art/blend/enemy/wepons/
      Meshy_AI_RPG_7_launcher_parts_0903143621_part-segmentation.blend
          eight objects `model_part0`..`model_part7`, 985,427 verts in total,
          ZERO materials and ZERO images. USED.

Both AI-generated (Meshy), disclosed per CONTRIBUTING.md.

WHY THE SEGMENTATION FILE, AND NOT THE TEXTURED ONE. The same call
`export_meshy_rocket_battery.py` made on the identical pair of files, for the
identical reason: the segmentation pass "already satisfies the contract's
zero-materials rule at the source rather than by stripping." Every unit in
this tree ships zero materials -- verified from the shipped bytes, not
assumed: `rocket_battery.glb`, `technical.glb` and `sarim_rifles.glb` all
read materials=0 images=0, while only `house`/`apartment`/`warehouse` sit in
`TEXTURED_MESH_EXEMPT`. Infantry and its gear have never had that exemption.
The 4K bake therefore goes unused here exactly as the irregular fighter's own
supplied bake does. Extending the exemption to worn gear is the project
lead's call and is recorded in the task queue, not decided here.

THE TWO FILES ARE THE SAME MODEL AT TWO UNIFORM SCALES, confirmed by axis
ratio rather than assumed -- the trap this pipeline already hit once on the
Grad truck, where the two frames differed by a uniform 3.202x:

    textured        1.90314 x 0.19601 x 0.42922
    segmentation    0.53208 x 0.05480 x 0.12000
    ratio             3.5768    3.5769    3.5768

Agreeing to four significant figures on all three axes, so the difference is
a uniform scale and nothing else. Vertex counts differ by 8,101 in 985k
(0.83%) -- the segmentation file has slightly MORE, which is what cutting a
welded mesh into eight parts does to the seam vertices, not geometry gained.
Choosing segmentation costs no shape.

There is also a frame TRANSLATION, worth stating because the ratio above hides
it: the textured file is centred on its own vertical midpoint (z from -0.2144
to +0.2148) while the segmentation file rests on z=0 (z from 0.0 to 0.1200).
Nothing here depends on it -- this script reads only the segmentation file --
but a future pass that wants the bake will need both numbers.

ROLES. From infantry's closed ten (`packages/render/src/three/units/
mesh-role.ts`), which already anticipated this asset: `wood` exists for a
heat shield and a spade handle, `weapon` for gunmetal, `metal` for fittings.
Which SEGMENTED PART carries which role is decided from measured geometry,
not from the part numbering -- the Grad's own prior inspection pass got two
parts wrong by trusting the numbering, and this source's numbering is
likewise not in weapon order (the sequence down the bore is 0, 1, 2, 6, 3,
5, 7, 4).

THE FIRST IDENTIFICATION OF THIS SOURCE WAS WRONG IN TWO PAIRS, and the
correction is recorded here because the reasoning that produced it is the
trap, not the parts. Extents alone said "the widest part on a loaded RPG is
the warhead", which put the muzzle at +X. It is false: an RPG-7's blast bell
flares WIDER than its warhead. What settles it is the radius profile along
each part's own axis, measured in 14 bins about the bore centreline:

    model_part0   0.0058 -> 0.0173 (mid) -> 0.0111       a teardrop with a
                                                         POINT at -X and a
                                                         thin stem at +X
    model_part4   0.0111 -> 0.0190 -> 0.0221 -> 0.0283   a MONOTONE flare,
                                                         maximum at the very
                                                         +X end

A warhead bulges and tapers to a point; a bell only opens. So `model_part0`
is the PG-7 warhead (with its stem running back into the heat shield) and
`model_part4` is the blast bell -- the reverse of the first reading -- and
therefore THE SOURCE'S MUZZLE IS AT -X. The two grips follow from that same
correction: the grip nearer the muzzle is the forward grip, and the one
carrying the trigger guard is the pistol grip behind it, which a rendered
side view confirms directly.

Both mis-identified parts are role `weapon`, so no colour was ever wrong --
only the direction the weapon points, which is exactly the sort of fault
that reads as merely odd on screen instead of obviously broken.

Measured in the segmentation frame, sorted MUZZLE to BELL (-X to +X):

  model_part0  168,893v  x[-0.2662,-0.1196] profile 0.006/0.017/0.011
      the PG-7 warhead and its stem: a teardrop pointed at -X, bulging
      mid-span, narrowing to a stem that runs back into the shield. -> weapon
  model_part1   15,586v  x[-0.1121,-0.0941] z[0.073,0.100]
      18 mm long and sitting ABOVE the bore line (bore centre z ~0.063), the
      only part up there this far forward: the front sight.           -> metal
  model_part2   44,900v  x[-0.0667,-0.0320] z[0.003,0.053]
      the more forward of the two parts hanging BELOW the bore, and the one
      without a trigger guard: the forward grip.                       -> wood
  model_part6  159,107v  x[-0.1201,+0.0322] z[0.049,0.077] y-span 0.0271
      spans the middle third, concentric with the bore and wider than the
      bare tube: the laminated heat shield.                            -> wood
  model_part3  118,103v  x[-0.0253,+0.0257] z[0.066,0.120] y[-0.0224,+0.0134]
      reaches the model's own maximum height AND is the only part offset in
      y -- the PGO-7 optical sight, which mounts on the left.          -> metal
  model_part5   50,527v  x[-0.0091,+0.0337] z[0.000,0.050]
      the rearward of the two parts below the bore, carrying the trigger
      guard: the pistol grip.                                          -> wood
  model_part7  237,017v  x[+0.0300,+0.2075] z[0.046,0.081]
      the long tube section behind the grip, running back to the bell.
                                                                     -> weapon
  model_part4  191,294v  x[+0.2070,+0.2659] profile monotone to 0.0283
      the flared blast bell at the +X extreme.                       -> weapon

ORIENTATION. The source's muzzle is at -X (see the profile measurement
above), and this repository's convention -- stated in the prompt this asset
was generated from, and the direction `export_meshy_rocket_battery.py`
normalises its own nose to -- is +X. So a 180-degree Z rotation IS baked
here, after the scale bake and like every other Meshy exporter in this tree.
`_assert_muzzle` checks the profile shapes rather than the extents, so it can
fail in BOTH directions; the extent check it replaces could only ever have
confirmed itself.

ORIGIN. Not ground-aligned. A vehicle stands on the ground and a decor rock
sits on it, but a launcher hangs off a shoulder, so z=0 is meaningless for it
and would only encode which way it happened to be lying. Instead the origin
is put on the BORE AXIS (y=0, z=0 through the centreline of the tube,
measured from the heat shield and rear tube rather than from the whole
bounding box, which the optical sight and the grips would drag off-axis)
with x=0 at the model's own X midpoint. A bone parent in the `rpg_team` step
is then one measured translation, and a pitch rotation is a rotation about
the bore, which is the axis it physically pivots on.

SCALE. Targets an OVERALL length of 1.40 m, warhead tip to bell mouth, and
the reason it is overall rather than the launcher tube alone is that the two
things this has to agree with are both overall figures. `tools/units/
teams.py` builds this weapon as `kit.launcher("rpg_tube", ..., length=1.24,
radius=0.075)` plus a separate `_bell` of 0.18, an envelope of about 1.42 m
-- and that kit tube is deliberately chunky rather than scale (a 0.075 radius
is a 15 cm tube; a real RPG-7's is nearer 7 cm), because it is sized to read
at 25 px, not to measure. A real loaded RPG-7 is about 1.34 m. 1.40 m sits
inside both, and matching the kit's on-screen envelope is the point --
`export_meshy_rocket_battery.py` gives the same reasoning for reading
`realMetres` off a sprite manifest: "the game already draws this unit at that
size, and a mesh replacing a billboard must not change how big the unit is."
An RPG has no sprite sheet of its own (it is drawn inside `INF_RPG`'s), so
the kit's own envelope is the thing to match.

DECIMATION. 985,427 source verts, ~16x the heaviest thing this pipeline ships
(`apc_eitan` at 61,887) for an object shorter than a rifleman is tall.
Per-part COLLAPSE ratios below, not one global ratio: the warhead's teardrop
and the bell's flare are what make this read as an RPG at gameplay zoom and
get the budget, while a plain tube section is a cylinder that survives heavy
collapse and the two grips are barely visible at all.

SPLIT NORMALS. Stripped, with the vertex-colour layer, before anything else --
`export_meshy_jeep.py`'s treatment for the other part-segmentation source in
this tree, for the same measured reason recorded there.
"""
import os
import sys

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(
    REPO, "art", "blend", "enemy", "wepons",
    "Meshy_AI_RPG_7_launcher_parts_0903143621_part-segmentation.blend",
)
#: There is deliberately NO default output path. `art/meshes/props/rpg7.glb`
#: is where this belongs, but `render_mesh_gate.py`'s `mesh_kind` has no
#: `props` kind yet and falls an unknown subdirectory through to `infantry`,
#: which would then look for a sprite sheet that does not exist -- so writing
#: there today turns `pnpm validate:meshes` red for EVERY session sharing this
#: tree, not only the one that ran this script. Until that kind exists, the
#: caller names the destination and takes responsibility for it.

TAG = "rpg7"

#: Overall length in metres, warhead tip to bell mouth -- the number this
#: export scales itself to match. See the module docstring, "SCALE", for why
#: overall rather than the launcher tube alone.
TARGET_OVERALL_LENGTH = 1.40

#: source object -> (rl_role, decimate ratio, label). See the module docstring
#: for how each part was identified (measured extents, never the numbering)
#: and why each ratio is what it is.
PARTS = {
    "model_part0": ("weapon", 0.0089, "PG-7 warhead + stem"),
    "model_part7": ("weapon", 0.0063, "rear tube"),
    "model_part4": ("weapon", 0.0105, "blast bell"),
    "model_part6": ("wood",   0.0075, "heat shield"),
    "model_part2": ("wood",   0.0134, "forward grip"),
    "model_part5": ("wood",   0.0119, "pistol grip"),
    "model_part3": ("metal",  0.0085, "optical sight"),
    "model_part1": ("metal",  0.0257, "front sight"),
}

#: The launcher tube proper -- the heat-shield section and the rear tube.
#: `model_part0` is deliberately NOT here: it is the grenade, not the
#: launcher, and its stem sits inside the shield. Used for the bore axis
#: (the sight and grips sit off it by design and would drag a whole-model
#: centroid off the centreline).
BORE_PARTS = ("model_part6", "model_part7")

#: Order the joined role nodes are built in, so the export is byte-stable
#: across runs regardless of dict iteration order.
ROLE_ORDER = ("weapon", "wood", "metal")


def _bbox(objs):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for ob in objs:
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def _strip_split_normals_and_colour(ob):
    """Clear this source's baked custom split normals and vertex-colour layer,
    and shade-smooth the result, BEFORE any decimate. `export_meshy_jeep.py`'s
    treatment for the other part-segmentation source here, for the reason
    recorded there: the glTF exporter must split a vertex wherever a per-loop
    normal or colour differs from its neighbour's, which on flat-shaded
    segmentation geometry is nearly every loop."""
    while ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes[0])
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.shade_smooth()


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    if ratio >= 1.0:
        print(f"[{TAG}] {label}: kept at {before_v} verts (no decimate)")
        return
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"[{TAG}] {label:24} ratio={ratio:<7} {before_v:7} -> {len(ob.data.vertices):5} verts, "
          f"{before_p:7} -> {len(ob.data.polygons):5} polys")


def _join(objs, name):
    """Join `objs` into one object called `name`. Custom properties are set
    AFTER the join, never before -- `object.join` keeps the active object's
    own properties and silently drops the others'."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = name
    return merged


def _radius_profile(ob, bore_z, bins=14):
    """Max radius from the bore centreline in each of `bins` slices along the
    part's own X extent. The one measurement that tells a warhead from a blast
    bell -- see the module docstring for why extents cannot."""
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    xs = [v.x for v in vs]
    lo, hi = min(xs), max(xs)
    step = (hi - lo) / bins
    out = []
    for b in range(bins):
        a, z = lo + b * step, lo + (b + 1) * step
        sl = [v for v in vs if a <= v.x <= z]
        out.append(max(((v.y ** 2 + (v.z - bore_z) ** 2) ** 0.5) for v in sl) if sl else 0.0)
    return out


def _assert_muzzle(by_name):
    """The warhead must bulge and taper; the bell must only open. Both are
    checked, so this fails if the two are swapped, if a re-generated source
    arrives mirrored, or if either part stops being what it is -- unlike the
    extent test this replaces, which asked whether the widest part leads and
    was therefore true whichever way round the weapon pointed."""
    lo_b, hi_b = _bbox([by_name[n] for n in BORE_PARTS])
    bore_z = (lo_b[2] + hi_b[2]) / 2
    head = _radius_profile(by_name["model_part0"], bore_z)
    bell = _radius_profile(by_name["model_part4"], bore_z)

    peak = head.index(max(head))
    if not (0 < peak < len(head) - 1 and head[0] < max(head) and head[-1] < max(head)):
        raise SystemExit(
            f"[{TAG}] FAIL: model_part0 does not read as a warhead -- profile {['%.4f' % r for r in head]} "
            "peaks at an end rather than bulging mid-span. Re-measure before re-mapping."
        )
    if not (bell[-1] == max(bell) and bell[-1] > bell[0] * 1.5):
        raise SystemExit(
            f"[{TAG}] FAIL: model_part4 does not read as a blast bell -- profile {['%.4f' % r for r in bell]} "
            "does not open to its maximum at the far end. Re-measure before re-mapping."
        )
    print(f"[{TAG}] muzzle check: warhead bulges {head[0]:.4f}->{max(head):.4f}->{head[-1]:.4f} (peak at bin {peak}); "
          f"bell opens {bell[0]:.4f}->{bell[-1]:.4f}. Source muzzle at -X.")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit(
            "usage: blender -b --factory-startup --python tools/units/export_meshy_rpg.py -- OUT.glb\n"
            "No default destination on purpose -- see DEFAULT_OUT's note above."
        )
    out_path = os.path.abspath(argv[0])
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    bpy.ops.wm.open_mainfile(filepath=SRC)

    found = {ob.name for ob in bpy.data.objects if ob.type == "MESH"}
    expected = set(PARTS)
    if found != expected:
        raise SystemExit(
            f"[{TAG}] FAIL: source parts changed. expected {sorted(expected)}, found {sorted(found)}. "
            "Every role assignment in PARTS was measured against the parts listed in the module "
            "docstring; re-measure before re-mapping."
        )

    by_name = {ob.name: ob for ob in bpy.data.objects if ob.type == "MESH"}
    _assert_muzzle(by_name)

    total_before = sum(len(ob.data.vertices) for ob in by_name.values())
    for name, (_role, ratio, label) in PARTS.items():
        ob = by_name[name]
        _strip_split_normals_and_colour(ob)
        _decimate(ob, ratio, label)

    # Scale on the OVERALL span -- warhead tip to bell mouth (module
    # docstring, "SCALE").
    lo_all, hi_all = _bbox(list(by_name.values()))
    overall = hi_all[0] - lo_all[0]
    mpu = TARGET_OVERALL_LENGTH / overall
    print(f"[{TAG}] overall span {overall:.5f} model units -> {TARGET_OVERALL_LENGTH} m  "
          f"(scale {mpu:.5f} m/unit)")

    by_role = {}
    for role in ROLE_ORDER:
        members = [by_name[n] for n, (r, _, _) in PARTS.items() if r == role]
        if not members:
            continue
        merged = _join(members, f"rpg_{role}")
        merged["rl_role"] = role
        merged["rl_part"] = "rpg"
        by_role[role] = merged
        print(f"[{TAG}] rpg_{role}: joined {len(members)} part(s) -> "
              f"{len(merged.data.vertices)} verts, {len(merged.data.polygons)} polys")

    parts = [by_role[r] for r in ROLE_ORDER if r in by_role]

    # Bake model-units -> metres into vertex data; object scale stays 1.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.scale = (mpu, mpu, mpu)
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Reorient: this source's muzzle is at -X and the convention is +X
    # (module docstring, "ORIENTATION"), so bake a 180-degree Z rotation.
    # After the scale bake, before the origin shift -- the same bake point
    # every other Meshy exporter here uses.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    # Origin: x at the model's own midpoint, y/z on the bore axis. Measured
    # AFTER the rotation, from the two tube parts only, which are now inside
    # the joined `rpg_weapon`/`rpg_wood` nodes -- so the bore is recovered
    # from the weapon node's own y/z centre, the tube being the only thing in
    # it that is round about the bore.
    lo_all, hi_all = _bbox(parts)
    lo_w, hi_w = _bbox([by_role["weapon"]])
    offset = (
        -((lo_all[0] + hi_all[0]) / 2),
        -((lo_w[1] + hi_w[1]) / 2),
        -((lo_w[2] + hi_w[2]) / 2),
    )
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.location = offset
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    lo, hi = _bbox(parts)
    total_after = sum(len(ob.data.vertices) for ob in parts)
    print(f"[{TAG}] final bbox  x[{lo[0]:+.4f},{hi[0]:+.4f}] y[{lo[1]:+.4f},{hi[1]:+.4f}] "
          f"z[{lo[2]:+.4f},{hi[2]:+.4f}] m")
    print(f"[{TAG}] overall length {hi[0]-lo[0]:.4f} m, muzzle at +X")
    print(f"[{TAG}] verts {total_before} -> {total_after}")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=(
            "RPG-7 launcher -- AI-generated (Meshy), part-segmentation export, disclosed "
            "per CONTRIBUTING.md; eight segmented parts joined into rpg_weapon/rpg_wood/"
            "rpg_metal for this repository. A prop carried by the Ashwar rpg_team, not a "
            "unit in its own right."
        ),
    )
    print(f"[{TAG}] wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KiB)")


main()
