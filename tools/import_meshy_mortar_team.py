"""Turn the supplied Meshy mortar-crew tableau into one contract-compliant
team file: `art/meshes/meshy_mortar_team.glb`, per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` (v1, infantry).

Run headless:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/import_meshy_mortar_team.py

## What the source is, and why this is NOT a sibling of the other two importers

`import_meshy_soldier.py` and `import_meshy_soldier_irregular.py` each consumed
SEVEN rigged `*_withSkin.glb` clip files carrying a 24-joint Mixamo skeleton and
real supplied animation. This source has neither. Two `.blend` files arrive under
`art/blend/KDF/mortor team/`, each a single 980k-vertex `mesh_node` with ONE
material, three packed textures, one UV map, and:

  * ZERO armatures, ZERO actions, ZERO vertex groups, ZERO shape keys.

So there is no skeleton to retarget and not one keyframe to map. Every consequence
of that is faced here rather than papered over:

  * `CLIP_SEMANTICS` / `check_clip_semantics` in the two donor scripts exist to
    catch a supplied clip mapped onto a contract name whose MEANING it does not
    match (they caught `Side_Shot` -> `fire` and `Shot_and_Blown_Back` -> `down`).
    With no supplied clips there is nothing for that gate to catch. Its protection
    is LOST, not satisfied. The equivalent numeric check is kept anyway
    (`check_clip_semantics` below, same table, same ceilings) because it still
    proves the clips this file AUTHORS obey the contract's own rules -- notably
    that `fire` never changes a figure's height. It just cannot flag a mis-mapped
    source clip, because there is no source clip.
  * All five clips are synthesized. Their quality is a function of authoring
    effort alone.

## Which of the two supplied blends, and why

`..._standing_...` is three men on their feet: one shoulders the limbered tube and
bipod, one carries a round and an ammunition case, one has his rifle slung. It is a
genuine travel state and it is NOT used here -- see "The limbered state" at the
bottom of this docstring.

`..._loading_...` is the deployed tableau: baseplate down, bipod planted, tube up,
one man kneeling at an open ammunition case, the loader kneeling with a round raised
over the muzzle, a third kneeling with his rifle and a handset. That is the
composition `tools/units/teams.py`'s own `mortar_team` already builds and ships
(a tube at +0.26, two kneeling crew at +/-0.54, an upright No.3 at -0.62), with the
No.3 also kneeling. The art matches the design that already shipped, so `loading`
is the base for every clip.

## `work` -- asked, and the answer is NO

The brief asked whether a loading crew should map to the `work` clip, reasoning that
`resolveClip` gives `work` priority over `fire` precisely because `work` is the one
clip allowed to change a figure's height. That reasoning is right about the SHAPE and
wrong about the TRIGGER, and the difference is decisive. Traced through executed code:

    packages/render/src/clip.ts:68           `work` is returned only when `u.working`
    ThreeRenderer.ts:3070, :3209            `working: this.sim.tunnelChargeProgress(i) > 0`
    packages/sim/src/sim.ts:1397-1400       returns 0 unless `type.canTunnelCharge`
    packages/sim/src/sim.ts:436             `canTunnelCharge = abilities.includes('tunnel_charge')`
    data/units/kdf/mortar_team.json         `"abilities": ["garrison"]`

`tunnel_charge` appears in exactly one unit file in the repository, and it is
`yahalom_squad.json`. So `working` is permanently false for `mortar_team` and
`resolveClip` can never return `work` for it. A `work` clip authored here would be
art that nothing can ever play.

The height rule the brief was reaching for is satisfied another way, and better.
`teams.py`'s `_crew_posture` -- the rule that actually governs this unit -- returns
kneeling for EVERY clip except `down`/`wreck`. So `idle`, `move` and `fire` all sit
at the same kneeling height here, there is no height change for `fire`'s per-shot
latch to bob, and the problem `work`'s precedence exists to solve does not arise.

## The rig, and why it is not a Mixamo retarget

The obvious plan -- retarget the 24-joint donor skeleton from
`art/meshes/meshy_soldier.glb` onto each figure -- was rejected. That donor rig is
posed STANDING; fitting it to an arbitrary KNEELING photogrammetry figure with no
supplied joint positions is a pose-fitting problem, not a retarget, and its worst
failure mode (nearest-point weights bleeding across the thigh/calf fold of a folded
leg) lands exactly where a kneeling figure is weakest.

Built instead: a small purpose-made skeleton fitted from each figure's OWN measured
geometry --

    f{i}_root      translation only, never rotates, so legs never swing
      f{i}_abdomen pivot at 0.35 of the figure's own height
        f{i}_chest pivot at 0.56
          f{i}_head pivot at 0.80
    prop           rigid, unparented: the emplaced tube, bipod and baseplate

Four bones per figure plus one prop bone, thirteen in all -- which the contract
leaves open to this side to decide and report ("Bone count per figure beyond the 13
R0 used"). Weights are a smooth function of each vertex's height fraction within its
own figure, so they sum to exactly 1 by construction and have no nearest-point
failure mode at all. Two bones share the torso bend rather than one because a single
waist joint creases visibly at `down`'s 34 degrees.

Bone names use the contract's own `f<N>_` prefix, NOT the `mtr_crew0_`/`mtr_no3_`
prefixes the currently-shipped `art/meshes/mortar_team.glb` happens to use. The
contract says the runtime depends on nothing beyond the `f<N>_` convention and the
shipped file proves it tolerates others; this file follows the written contract.

## Roles: why the irregular pipeline's k=14 colour k-means is not used

It was tried first, and it FAILED. A k=14 fit on (r, g, b, zfrac*0.5, radial*0.3) --
`import_meshy_soldier_irregular.py`'s exact feature -- returned fourteen centroids
whose colour components were all neutral greys (r, g and b within 0.03 of each other
on every one of the fourteen), separated only by luminance and height. This texture
is achromatic: it carries no chromatic webbing/uniform signal to find, which is the
KDF soldier's situation rather than the Sarim irregular's.

What does separate, and is used instead, is a VOXEL-PURITY test (`hardware_groups`).
Real hardware sits in voxels that are entirely dark; the dark speckle of a multicam
uniform sits in voxels that are mostly light. Seeding on voxel purity and growing one
voxel outward recovers each hardware object whole, INCLUDING its specular highlights,
which a plain luminance threshold drops and which is why the naive mask left the tube
riddled with holes.

Eight coherent hardware objects come out, and every one was identified by
re-colouring the actual vertices and rendering the point cloud from -Y, +Y and above
-- never accepted from colour statistics. They are, largest first: the mortar
(round + tube + bipod + baseplate), the left figure's rifle, the right figure's
rifle, four pieces of slung kit, and the ammunition case's rail.

`boot` and `face` are geometric, and that is deliberate rather than a shortfall.
Since the exporter writes ZERO materials and colour comes from `data/palette.json`
at runtime, a role is a statement about what a piece of geometry IS, not a sample of
what colour it happens to be in a texture that is about to be discarded. On an
achromatic source a geometric rule is the correct instrument, not a workaround. Both
were confirmed by render like everything else. There is deliberately no
`skin_shadow`, `wood`, `charge` or `keffiyeh`: a KDF crew has none.

## Orientation

Measured, not assumed. Depth-buffered renders of the raw point cloud from -Y show
all three figures' faces, goggles and weapons; the same renders from +Y show all
three backpacks and the backs of their helmets. So the crew face Blender -Y, and
they agree with each other -- which had to be checked, because the ammunition handler
is turned toward his case and the loader is bent over the tube.

Blender -Y exports (`export_yup=True`) to glTF +Z, and a +90 degree rotation about
glTF +Y carries +Z to +X, the contract's forward. Hence `FORWARD_FIX_DEG = 90.0`,
applied POST-export on the glTF node graph by `apply_forward_fix`, never as a
Blender-side rest rotation -- `bpy.ops.object.transform_apply` preserves the
armature's `matrix_world` and provably cannot change exported facing at any angle,
which is why `import_meshy_soldier.py` keeps its own `fix_forward` as a documented
no-op.

Per that same file's hard-won rule this remains a HYPOTHESIS until confirmed by live
in-game measurement against a known-correct unit -- a still render answers "which end
is +X", never "which end leads while walking". Five of five supplied assets have
needed a baked rotation. See the task report for the measurement.

## The tube points 136 degrees off the crew's facing, and it is left alone

Measured twice on the isolated hardware: a slab-by-slab centroid trace up the tube
gives elevation 71 degrees, azimuth 134 degrees; bulk PCA agrees. The crew face
azimuth 270. So the tube leans back across the crew's own facing.

It is NOT corrected, and the reason is a measurement rather than a shrug. Over the
tube's unambiguous 0.314-unit rise the muzzle offsets 0.108 horizontally -- at
`MESH_SCALE` and gameplay zoom that is on the order of a pixel. Yawing the tube to
fix it means cutting it away from the loader's hand and the round poised over its
muzzle, which is the single most visible relationship in the tableau and the one
thing that must stay right. Breaking that to win a pixel is the wrong trade. Stated
here so it is a known, measured, accepted property and not a surprise.

## Footprint

The tableau is normalized by Meshy to 1.904 on its long axis. At `SCALE` that is
2.84 m of LATERAL spread once forward is fixed -- against 1.671 m for the shipped
`mortar_team.glb` and 1.56 m for a `sarim_rifles`/`inf_squad` three-man team. Nearly
twice every other team's width, and `root.scale` is a flat `1/3`
(`mesh-unit.ts` -> `MESH_SCALE`), so absolute metres are what the player sees.

`LATERAL_SQUEEZE` moves the two outer figures toward the middle one -- cheap, because
they are separate connected components -- landing the model at 2.50 m, just above the
shipped file's own 2.24 m long axis. Pushed harder the ammunition case slides in front
of the tube and hides the vertical spike that is this unit's whole silhouette
identity; 0.80 was chosen by rendering 1.00, 0.80, 0.70 and 0.62 and looking at all
four.

## The limbered state

`..._standing_...` is exactly the source a travel/`move` state would want, and it
cannot be added under the contract as written: a skinned mesh has ONE rest geometry,
so `move` on standing geometry while `idle` uses loading geometry is not expressible
without either two geometry sets scale-swapped per clip (which puts two meshes under
one role and breaks "node name equals its role exactly", the same way the building
wreck case did) or a second sibling file. That is a design decision for a later
slice, not something to improvise here. `teams.py`'s own module docstring already
accepts the trade in writing: "Crew-served weapons stay deployed through `move`. A
mortar team really walks with the tube shouldered. Authoring a carried state per crew
weapon roughly doubles the work for something invisible at 25 px."

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

#: The supplied blends live in the MAIN repo only -- `art/blend/` is gitignored
#: and is not present in a worktree, which is why this is an absolute path to the
#: main checkout rather than `REPO`-relative like every other tool here.
SRC_BLEND = (
    "/Users/ilpinto/dev/roaring-lions/art/blend/KDF/mortor team/"
    "Meshy_AI_mortar_crew_loading_0831170353_image-to-3d-texture.blend"
)
#: The unused travel-pose sibling -- see "The limbered state" in the module docstring.
SRC_STANDING = (
    "/Users/ilpinto/dev/roaring-lions/art/blend/KDF/mortor team/"
    "Meshy_AI_mortar_crew_standing_0831170455_image-to-3d-texture.blend"
)

#: A NEW file rather than a rewrite of `art/meshes/mortar_team.glb`. That one
#: ships today, is fielded in seven missions plus the tutorial, and passes every
#: gate; clobbering it in place would make a regression here impossible to bisect
#: and impossible to revert without the art. Same precedent as
#: `meshy_soldier.glb` and `sarim_rifles.glb`, both of which sit beside the
#: `tools/units/rig.py` file they replace rather than on top of it. The wiring
#: that points `mortar_team` at this file is one line in `packages/app/src/main.ts`
#: and is reported, not applied here.
OUT_PATH = os.path.join(REPO, "art", "meshes", "meshy_mortar_team.glb")

#: Build order, and the order clips appear in the merged file.
CLIP_ORDER = ("idle", "move", "fire", "down", "wreck")

#: The two clips that loop at runtime, and therefore the only two where a
#: per-figure phase shift is well defined -- shifting a one-shot `fire` or a held
#: `down` by a third of its length would just start it in the wrong place.
CYCLIC_CLIPS = frozenset({"idle", "move"})

#: Scale from Meshy's normalized units to metres.
#:
#: Derived from the STANDING blend, not this one: its figures are 1.207025 units
#: tall, and the contract fixes a standing figure at 1.8 m. Both files are
#: normalized by Meshy to the same 1.9035 long axis, so the factor transfers.
#:
#: Cross-checked INDEPENDENTLY, and this is the check worth keeping: the isolated
#: mortar measures 0.691 units from baseplate to the top of the raised round,
#: which at this factor is 1.03 m -- against `teams.py`'s own
#: `kit.mortar("mtr_tube", ..., length=1.02)`. Two unrelated derivations landing
#: within 1% is what makes this a measurement rather than a guess.
SCALE = 1.8 / 1.207025

#: How far the two outer figures are pulled toward the middle one. See "Footprint"
#: in the module docstring for the four rendered candidates this was chosen from.
LATERAL_SQUEEZE = 0.80

#: Per-role decimation ratio. Decimated PER ROLE rather than globally so the
#: mortar and the rifles keep their silhouettes while the uniform -- 81.7% of the
#: source and the role whose detail lives entirely in a normal map this pipeline
#: discards along with the material -- gives up density. The supplied mesh is
#: 990,725 verts; `sarim_rifles.glb`, the other Meshy-sourced three-figure team,
#: ships 52,219.
DECIMATE = {
    "uniform": 0.045,
    "metal": 0.120,
    "weapon": 0.100,
    "boot": 0.080,
    "webbing": 0.100,
    "face": 0.080,
}

#: Clip lengths in frames at the scene's 24 fps, matching what the shipped
#: `art/meshes/*.glb` already use: idle 1.333 s, move 0.667 s, fire 0.250 s, and
#: `down`/`wreck` a two-key static hold.
CLIP_FRAMES = {"idle": 32, "move": 16, "fire": 6, "down": 1, "wreck": 1}

#: Same table, same ceilings, as both donor importers. See the module docstring
#: for what this can and cannot prove with no source clips to gate.
CLIP_SEMANTICS = {
    "idle": {
        "means": "kneeling hold at the weapon, minimal motion -- the baseline every other clip is measured against.",
        "ceiling": lambda idle_travel: None,
    },
    "move": {
        "means": (
            "a deployed shuffle -- this crew stays on its weapon through `move` "
            "(`teams.py` `_crew_posture`), so vertical travel is expected but small."
        ),
        "ceiling": lambda idle_travel: None,
    },
    "fire": {
        "means": (
            "the tube reports and the crew flinch; upper body only, so root travel "
            "must not exceed idle's own -- `resolveClip` latches `fire` per shot and "
            "a height change would bob the whole team through a firefight."
        ),
        "ceiling": lambda idle_travel: idle_travel + 0.5,
    },
    "down": {
        "means": (
            "a HELD pose -- suppression, looped indefinitely, AND the first phase of "
            "death -- near-zero root travel. `resolveClip` returns `down` for pinned "
            "and routed as well as dead, so a fall here would collapse a suppressed "
            "man over and over."
        ),
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
    },
    "wreck": {
        "means": "a HELD corpse pose -- same requirement as down: static, near-zero root travel.",
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
    },
}

#: Per-figure phase offsets for the cyclic clips, as fractions of the cycle.
#: Identical to both donor importers' own `GAIT_PHASE_FRACTIONS` and to
#: `tools/units/rig.py`'s. Squads used to move in lockstep because every figure
#: carried byte-identical keyframes; this is what fixed it and it is preserved.
GAIT_PHASE_FRACTIONS = (0.0, 1.0 / 3.0, 2.0 / 3.0)

#: Height fractions (of each figure's OWN measured height) where one bone's
#: influence hands over to the next. Ordered and non-overlapping, which is what
#: makes the four weights sum to exactly 1 with no normalisation pass.
BONE_BANDS = ((0.28, 0.42), (0.50, 0.62), (0.74, 0.86))

#: Where each bone's pivot sits, again as a fraction of the figure's own height.
BONE_PIVOTS = {"root": 0.02, "abdomen": 0.35, "chest": 0.56, "head": 0.80}
BONE_CHAIN = ("root", "abdomen", "chest", "head")

LUMW = np.array([0.2126, 0.7152, 0.0722])

# --- role classification -------------------------------------------------
#
# See "Roles" in the module docstring for the method and for the k=14 colour
# k-means this replaced after it returned fourteen neutral-grey centroids.

VOX = 0.014        # region-grow voxel, ~1.3% of the tableau's long axis
PURITY_VOX = 0.016  # voxel the darkness fraction is measured over
PURITY = 0.72      # fraction of a voxel's verts that must be dark to seed it
MIN_SEED = 600     # smaller seed clusters are texture speckle, not hardware
DARK_LUM = 0.21
DARK_SAT = 0.22

#: Which grown hardware group is which, by rank in descending vertex count.
#: Every one of these was identified by re-colouring the actual vertices and
#: rendering; the ranks are stable because the objects differ in size by
#: multiples, not by percents (63k / 22k / 12k / 9.5k / 7.9k / 6.7k / 6.1k / 2.8k).
HW_ROLE_BY_RANK = {
    0: "metal",    # the mortar: round, tube, bipod, baseplate
    1: "weapon",   # the ammunition handler's slung rifle
    2: "weapon",   # the No.3's rifle
    3: "webbing",  # handler's chest and shoulder kit
    4: "webbing",  # No.3's handset at his ear
    5: "webbing",  # handler's lower kit
    6: "webbing",  # handler's thigh holster
    7: "metal",    # the ammunition case's rail
}

#: Boots: the lowest band of each figure, inside that figure's own radial core.
#: The radial term is what keeps the ammunition case -- which sits at the same
#: height but well out in front of its owner -- out of the boot mesh.
BOOT_ZFRAC_MAX = 0.12
BOOT_RADIAL_MAX = 0.40

#: Face: the front-lower window of each head. Fractions of that head's OWN
#: measured depth, never absolute coordinates.
FACE_ZFRAC = (0.79, 0.92)
FACE_DEPTH_OFFSET = 0.16
FACE_RADIUS = 0.62

#: `webbing` IS ONLY the confidently-dark slung kit the hardware pass finds, and
#: an attempt to extend it to the plate carriers was BUILT, MEASURED AND REVERTED.
#: Recorded here so it is not tried a third time.
#:
#: The carrier and its pouches are the SAME multicam fabric as the uniform,
#: separated in the source only by being consistently a little darker -- a
#: per-vertex dither on a photogrammetric texture, not a region. Taking the darker
#: 38% of each figure's own torso band directly gave salt-and-pepper, which after
#: decimation would be scattered single triangles reading as noise; a voxel-majority
#: filter over that flag (0.030 voxel, 60% majority) did turn it into coherent
#: blocks landing correctly on carrier fronts, shoulder straps and pouch clusters.
#:
#: It was then exported, rendered through `render_mesh_gate.py` at the locked
#: dimetric angle, and put side by side with the version without it. The difference
#: was barely perceptible -- because `rampForRole` gives `webbing` gunmetal[1:4] and
#: `uniform` the whole olive ramp, and at the gate's light angles those two slices
#: land at nearly the same VALUE. It cost +11,775 verts (62,910 -> 74,685, +19%) and
#: +566 KB (+16%) for a change that could not be seen at gameplay size. Dropped:
#: that is budget spent for nothing, and a scattering of near-identical grey among
#: the olive is the partial fix this project's own notes warn is worse than none.
#:
#: If KDF webbing ever needs to read here, the lever is the ramp SLICE in
#: `packages/render/src/three/units/mesh-role.ts`, not more geometry in this file.

#: Direction of the tube's own axis, muzzle-ward, measured by a slab-by-slab
#: centroid trace over its unambiguous section (elevation 71 deg, azimuth 134).
#: Read by exactly one caller: the cut that decides how much of the hardware is
#: the RAISED ROUND (which must travel with the loader's hand) rather than the
#: emplaced tube (which must not).
TUBE_AXIS = np.array([-0.227, 0.235, 0.949])
ROUND_AXIS_CUT = 0.16


def basecolor_per_vertex(mesh_obj):
    """(N, 3) linear base colour, one row per vertex, sampled through the mesh's
    own UV map. MUST run before `mesh.data.materials.clear()` -- the material is
    the only route to the texture. Resolves the image through the BSDF's own
    `Base Color` link rather than "the first TEX_IMAGE node", the same way
    `import_meshy_soldier_irregular.py` does and for the same reason."""
    mesh = mesh_obj.data
    mat = mesh.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    image = bsdf.inputs["Base Color"].links[0].from_node.image
    w, h = image.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(buf)
    img = buf.reshape(h, w, 4)

    n_loops = len(mesh.loops)
    lv = np.empty(n_loops, dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", lv)
    uv = np.empty(n_loops * 2, dtype=np.float64)
    mesh.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(n_loops, 2)

    first = np.full(len(mesh.vertices), -1, dtype=np.int64)
    for li in range(n_loops):
        vi = lv[li]
        if first[vi] < 0:
            first[vi] = li
    vuv = uv[first]
    px = np.clip(np.rint(vuv[:, 0] * (w - 1)).astype(np.int64), 0, w - 1)
    py = np.clip(np.rint(vuv[:, 1] * (h - 1)).astype(np.int64), 0, h - 1)
    return img[py, px, :3].astype(np.float32)


def vertex_positions(mesh_obj):
    mesh = mesh_obj.data
    n = len(mesh.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    return co.reshape(n, 3)


def connected_components(mesh_obj):
    """Union-find over the mesh's edges. Splits this tableau by FIGURE -- four
    components: three men and the loose round beside the ammunition handler.
    The mortar itself is FUSED into the loader's component and cannot be
    separated this way, which is what `hardware_groups` is for."""
    mesh = mesh_obj.data
    n = len(mesh.vertices)
    ne = len(mesh.edges)
    ed = np.empty(ne * 2, dtype=np.int32)
    mesh.edges.foreach_get("vertices", ed)
    ed = ed.reshape(ne, 2)
    par = np.arange(n, dtype=np.int64)

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x

    for a, b in ed:
        ra, rb = find(a), find(b)
        if ra != rb:
            par[ra] = rb
    lab = np.array([find(i) for i in range(n)])
    _, inv = np.unique(lab, return_inverse=True)
    return inv


def _voxel_cc(keys):
    """26-connected components over an integer voxel key array."""
    uk = np.unique(keys, axis=0)
    lut = {(k[0], k[1], k[2]): i for i, k in enumerate(uk)}
    par = np.arange(len(uk))

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x

    offs = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)
            if (a, b, c) > (0, 0, 0)]
    for i, k in enumerate(uk):
        t = (k[0], k[1], k[2])
        for o in offs:
            j = lut.get((t[0] + o[0], t[1] + o[1], t[2] + o[2]))
            if j is not None:
                a, b = find(i), find(j)
                if a != b:
                    par[a] = b
    return uk, np.array([find(i) for i in range(len(uk))])


def hardware_groups(co, cols):
    """Boolean masks, one per coherent hardware object, largest first and
    mutually disjoint. See "Roles" in the module docstring for the method; the
    ranks are consumed by `HW_ROLE_BY_RANK`."""
    lum = cols @ LUMW
    mx = cols.max(1)
    mn = cols.min(1)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)
    dark = (lum < DARK_LUM) & (sat < DARK_SAT)

    key = np.floor(co / PURITY_VOX).astype(np.int64)
    uk, inv = np.unique(key, axis=0, return_inverse=True)
    tot = np.bincount(inv, minlength=len(uk))
    drk = np.bincount(inv, weights=dark.astype(float), minlength=len(uk))
    frac = drk / np.maximum(tot, 1)
    seed = (frac[inv] > PURITY) & (tot[inv] >= 4) & dark

    gkey = np.floor(co / VOX).astype(np.int64)
    uks, root = _voxel_cc(gkey[seed])
    smap = {(k[0], k[1], k[2]): root[i] for i, k in enumerate(uks)}
    si = np.nonzero(seed)[0]
    sroot = np.array([smap[(k[0], k[1], k[2])] for k in gkey[seed]])

    kt = [(k[0], k[1], k[2]) for k in gkey]
    grown = []
    for r in np.unique(sroot):
        idx = si[sroot == r]
        if len(idx) < MIN_SEED:
            continue
        vs = set()
        for k in gkey[idx]:
            t = (k[0], k[1], k[2])
            for a in (-1, 0, 1):
                for b in (-1, 0, 1):
                    for c in (-1, 0, 1):
                        vs.add((t[0] + a, t[1] + b, t[2] + c))
        grown.append(np.fromiter((t in vs for t in kt), bool, len(kt)))

    grown.sort(key=lambda m: -m.sum())
    claimed = np.zeros(len(co), bool)
    out = []
    for m in grown:
        m = m & ~claimed
        if m.sum() < MIN_SEED:
            continue
        claimed |= m
        out.append(m)
    return out


def figure_frames(co, fig, body):
    """Per-figure normalized height `zf`, normalized radial distance `rad`, and
    the measured extent each is a fraction of. Computed from BODY vertices only:
    the loader's own component contains the whole mortar, and letting a 1.03 m
    tube set his height fraction would drag every band on him upward."""
    zf = np.zeros(len(co))
    rad = np.zeros(len(co))
    meta = {}
    for c in sorted(set(fig.tolist())):
        m = fig == c
        b = m & body
        p = co[b]
        zb, zt = p[:, 2].min(), p[:, 2].max()
        h = zt - zb
        zf[m] = (co[m, 2] - zb) / h
        core = (p[:, 2] > zb + 0.35 * h) & (p[:, 2] < zb + 0.62 * h)
        cx, cy = np.median(p[core, 0]), np.median(p[core, 1])
        r = np.sqrt((co[m, 0] - cx) ** 2 + (co[m, 1] - cy) ** 2)
        rad[m] = r / r.max()
        meta[c] = dict(cx=float(cx), cy=float(cy), zb=float(zb), zt=float(zt), h=float(h))
    return zf, rad, meta


def classify(co, cols, fig):
    """Per-vertex `rl_role`, plus the prop mask (the emplaced hardware) and the
    per-figure frames the rig is built from."""
    groups = hardware_groups(co, cols)
    print(f"hardware groups: {len(groups)} -- " +
          ", ".join(f"#{i}={int(m.sum())}" for i, m in enumerate(groups)))

    hw = np.zeros(len(co), bool)
    for m in groups:
        hw |= m
    body = ~hw

    zf, rad, meta = figure_frames(co, fig, body)

    roles = np.array(["uniform"] * len(co), dtype=object)
    roles[body & (zf < BOOT_ZFRAC_MAX) & (rad < BOOT_RADIAL_MAX)] = "boot"


    for c in sorted(meta):
        band = body & (fig == c) & (zf > FACE_ZFRAC[0]) & (zf < FACE_ZFRAC[1])
        p = co[band]
        cy = np.median(p[:, 1])
        cx = np.median(p[:, 0])
        depth = p[:, 1].max() - p[:, 1].min()
        r = np.sqrt((co[:, 0] - cx) ** 2 + (co[:, 1] - cy) ** 2)
        roles[band & (co[:, 1] < cy - FACE_DEPTH_OFFSET * depth) & (r < FACE_RADIUS * depth)] = "face"

    for i, m in enumerate(groups):
        roles[m] = HW_ROLE_BY_RANK.get(i, "webbing")

    # The mortar is group 0. Split it: everything past ROUND_AXIS_CUT along the
    # tube's own axis is the RAISED ROUND, which is in the loader's hand and must
    # travel with him; the rest is emplaced and belongs to the rigid `prop` bone.
    # Getting this backwards leaves a round hanging in mid-air the moment the
    # crew go to ground, which is the one clip pair where they leave the weapon.
    t = co @ TUBE_AXIS
    held_round = groups[0] & (t > ROUND_AXIS_CUT)
    prop = groups[0] & ~held_round
    print(f"mortar: {int(groups[0].sum())} verts -> prop {int(prop.sum())}, "
          f"held round {int(held_round.sum())} (travels with the loader)")
    return roles, prop, held_round, zf, rad, meta


# --- geometry recomposition ----------------------------------------------


def recompose(co, fig, body):
    """Squeeze the lateral spread, scale to metres, sit the model on z=0 and
    centre it on its own footprint. Returns the new positions.

    The two outer figures move toward the middle one; the mortar and the held
    round move with the FIGURE they belong to, or the tube would be left behind
    by its own loader."""
    cx = {}
    for c in sorted(set(fig.tolist())):
        cx[c] = float(np.median(co[(fig == c) & body, 0]))
    mid = min(cx, key=lambda c: abs(cx[c] - np.mean(list(cx.values()))))
    print("figure x centres:", {k: round(v, 3) for k, v in cx.items()}, "-> anchor", mid)

    out = co.copy()
    for c in cx:
        m = fig == c
        out[m, 0] += cx[c] * (LATERAL_SQUEEZE - 1.0)

    out *= SCALE
    out[:, 2] -= out[:, 2].min()
    for ax in (0, 1):
        out[:, ax] -= 0.5 * (out[:, ax].min() + out[:, ax].max())
    dim = out.max(0) - out.min(0)
    print(f"recomposed: {dim[0]:.3f} (lateral) x {dim[1]:.3f} (fore-aft) x "
          f"{dim[2]:.3f} (tall) m")
    return out


# --- weights --------------------------------------------------------------


def _smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def bone_weights(zf, head_gate):
    """Four weights per vertex, in `BONE_CHAIN` order, summing to exactly 1.

    A cumulative smoothstep ladder: each band hands influence up to the next, so
    `root >= abdomen >= chest >= head` by construction and no normalisation pass
    is needed. This has no nearest-point failure mode, which is the whole reason
    it is used instead of a BVH weight transfer -- `bpy.ops.object.data_transfer`
    silently does nothing in this headless Blender 5.2 anyway, and a hand-rolled
    nearest-point transfer bleeds weights straight across the thigh/calf contact
    of a kneeling figure, which is every figure here.

    `head_gate` is what keeps the loader's RAISED ARM off the head bone. His hand
    is the highest point on him, so a pure height rule would swing the round every
    time he nods. The gate is 1 near the head's own centre and 0 away from it; what
    it takes from `head` goes to `chest`, where an arm belongs."""
    a = _smoothstep(zf, *BONE_BANDS[0])
    b = _smoothstep(zf, *BONE_BANDS[1])
    c = _smoothstep(zf, *BONE_BANDS[2]) * head_gate
    c = np.minimum(c, b)
    return np.stack([1.0 - a, a - b, b - c, c], axis=1)


def quantize_weights(w):
    """Weights on a 1/255 grid whose rows sum to exactly 1. The three smaller
    weights are rounded; the dominant one absorbs the remainder, so the sum is
    exact in the same rational grid rather than merely close."""
    q = np.rint(w * 255.0).astype(np.int64)
    dom = np.argmax(w, axis=1)
    rows = np.arange(len(w))
    q[rows, dom] = 0
    q[rows, dom] = 255 - q.sum(axis=1)
    return q


# --- Blender mesh surgery -------------------------------------------------


def tag_group(mesh_obj, name, mask):
    vg = mesh_obj.vertex_groups.new(name=name)
    idx = np.nonzero(mask)[0].tolist()
    if idx:
        vg.add(idx, 1.0, "REPLACE")
    return vg


def separate_by_role(mesh_obj, roles):
    """Vertex-group-scoped `mesh.separate`, never raw index-based bmesh
    selection -- same mechanism as both donor importers' own `separate_by_role`."""
    present = sorted(set(roles.tolist()) - {"uniform"})
    for role in present:
        tag_group(mesh_obj, f"_role_{role}", roles == role)

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
        by_role[role] = bpy.data.objects[new_name]
    by_role["uniform"] = mesh_obj

    for obj in by_role.values():
        for role in present:
            g = f"_role_{role}"
            if g in obj.vertex_groups:
                obj.vertex_groups.remove(obj.vertex_groups[g])
    return by_role


def decimate(obj, ratio):
    before = len(obj.data.vertices)
    mod = obj.modifiers.new(name="dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after = len(obj.data.vertices)
    print(f"  {obj.name:9s} {before:7d} -> {after:6d} verts (ratio {ratio})")
    return after


def read_tag(obj, names):
    """Which of `names` each vertex was tagged with, as an index; -1 for none.
    Read back AFTER decimation, because collapse interpolates vertex groups and
    a survivor can carry a blend of two tags -- the strongest wins."""
    idx = {}
    for i, n in enumerate(names):
        if n in obj.vertex_groups:
            idx[obj.vertex_groups[n].index] = i
    out = np.full(len(obj.data.vertices), -1, dtype=np.int64)
    best = np.zeros(len(obj.data.vertices))
    for v in obj.data.vertices:
        for g in v.groups:
            i = idx.get(g.group)
            if i is not None and g.weight > best[v.index]:
                best[v.index] = g.weight
                out[v.index] = i
    return out


# --- armature -------------------------------------------------------------


def build_armature(meta, prop_anchor):
    arm_data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")

    for c in sorted(meta):
        m = meta[c]
        prev = None
        for name in BONE_CHAIN:
            z = m["zb"] + BONE_PIVOTS[name] * m["h"]
            b = arm_data.edit_bones.new(f"f{c}_{name}")
            b.head = (m["cx"], m["cy"], z)
            b.tail = (m["cx"], m["cy"], z + 0.12 * m["h"])
            if prev is not None:
                b.parent = prev
            prev = b

    # `prop` is unparented on purpose: the tube is planted in the ground and must
    # not inherit the loader's own motion. Its head sits at the baseplate.
    p = arm_data.edit_bones.new("prop")
    p.head = tuple(prop_anchor)
    p.tail = (prop_anchor[0], prop_anchor[1], prop_anchor[2] + 0.30)

    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"armature: {len(arm_data.bones)} bones "
          f"({len(meta)} figures x {len(BONE_CHAIN)} + prop)")
    return arm


def skin(obj, arm, fig_tag, prop_tag, meta, head_gate_fn):
    """Give `obj` its bone vertex groups and an Armature modifier."""
    co = vertex_positions(obj)
    n = len(co)
    names = []
    for c in sorted(meta):
        names += [f"f{c}_{b}" for b in BONE_CHAIN]
    names.append("prop")
    vgs = {name: obj.vertex_groups.new(name=name) for name in names}

    for c in sorted(meta):
        m = (fig_tag == c) & ~prop_tag
        if not m.any():
            continue
        info = meta[c]
        zf = (co[m, 2] - info["zb_m"]) / info["h_m"]
        gate = head_gate_fn(c, co[m])
        w = quantize_weights(bone_weights(zf, gate))
        idx = np.nonzero(m)[0]
        for j, bone in enumerate(BONE_CHAIN):
            vg = vgs[f"f{c}_{bone}"]
            col = w[:, j]
            for q in np.unique(col):
                if q <= 0:
                    continue
                sel = idx[col == q].tolist()
                vg.add(sel, float(q) / 255.0, "REPLACE")

    if prop_tag.any():
        vgs["prop"].add(np.nonzero(prop_tag)[0].tolist(), 1.0, "REPLACE")

    mod = obj.modifiers.new(name="arm", type="ARMATURE")
    mod.object = arm
    obj.parent = arm
    return n


# --- clip authoring -------------------------------------------------------


def local_axis(arm, bone_name, world_vec):
    """`world_vec` expressed in `bone_name`'s own rest space.

    Bones here are built straight up, so their local Y is world +Z, but the roll
    Blender picks for the other two axes is not something to guess at -- reading
    it off `matrix_local` makes every rotation below a WORLD-space statement
    ("pitch forward", "roll left") regardless of what roll the bone ended up
    with."""
    from mathutils import Vector  # noqa: PLC0415
    m = arm.data.bones[bone_name].matrix_local.to_3x3()
    return (m.inverted() @ Vector(world_vec)).normalized()


#: World axes, given that the crew face -Y (measured -- see "Orientation").
#: Positive rotation about +X pitches a figure FORWARD, onto its weapon.
AX_PITCH = (1.0, 0.0, 0.0)
AX_ROLL = (0.0, 1.0, 0.0)
AX_YAW = (0.0, 0.0, 1.0)


def clip_pose(clip, figure, phase, t):
    """The pose for one figure at normalized time `t` in [0, 1).

    Returns (root_offset_metres, {bone: (world_axis, degrees)}). Every number here
    is an authored art number; the shapes they make are described per clip.
    """
    ph = (t + phase) % 1.0
    s = math.sin(2.0 * math.pi * ph)

    if clip == "idle":
        # Breathing. A slow single-cycle sway of the upper body with the head
        # counter-rotating, plus 8 mm of vertical rise -- enough that `fire`'s
        # own ceiling (idle + 0.5) is a real bound rather than zero.
        return (0.0, 0.0, 0.008 * s), {
            "abdomen": (AX_PITCH, -0.9 * s),
            "chest": (AX_PITCH, -0.8 * s),
            "head": (AX_PITCH, 0.9 * s),
        }

    if clip == "move":
        # A deployed shuffle, not a gait: this crew stays on its weapon through
        # `move` (`teams.py` `_crew_posture`, and that file's own module docstring
        # accepting the trade). Two bobs per cycle plus a lateral roll, so it reads
        # as a crew working rather than a squad marching.
        s2 = math.sin(4.0 * math.pi * ph)
        return (0.018 * s, 0.0, 0.020 * abs(s2)), {
            "abdomen": (AX_ROLL, 2.4 * s),
            "chest": (AX_ROLL, 1.6 * s),
            "head": (AX_YAW, -2.0 * s),
        }

    if clip == "fire":
        # The tube reports. NO root translation at all, so root travel is exactly
        # zero and `CLIP_SEMANTICS['fire']`'s ceiling holds by construction rather
        # than by tuning. Sharp out, slow back.
        amp = math.sin(math.pi * min(1.0, t * 1.6)) if t < 0.62 else (1.0 - t) * 0.9
        # The loader has just released the round and ducks INTO the tube; the other
        # two flinch back from it. Opposite signs are what makes the clip read as a
        # report rather than as three men nodding.
        sign = 1.0 if figure == 1 else -1.0
        return (0.0, 0.0, 0.0), {
            "abdomen": (AX_PITCH, sign * 3.4 * amp),
            "chest": (AX_PITCH, sign * 4.6 * amp),
            "head": (AX_PITCH, 2.6 * amp),
        }

    if clip == "down":
        # A HELD pose. Suppression, looped indefinitely, and the first phase of
        # death -- never a fall. The crew fold down over the weapon; the tube does
        # not move, because `prop` is unparented. Split across abdomen and chest so
        # the 34 degrees is an arc rather than a crease at the waist.
        return (0.0, 0.0, -0.03), {
            "abdomen": (AX_PITCH, 15.0),
            "chest": (AX_PITCH, 19.0),
            "head": (AX_PITCH, -6.0),
        }

    if clip == "wreck":
        # A second held pose, flatter than `down` and rolled off the vertical so
        # the two are distinguishable at gameplay zoom, which is the only place
        # they are ever seen.
        roll = 9.0 if figure != 1 else -9.0
        return (0.0, -0.02, -0.06), {
            "abdomen": (AX_PITCH, 24.0),
            "chest": (AX_PITCH, 26.0),
            "head": (AX_PITCH, -2.0),
            "_roll": (AX_ROLL, roll),
        }

    raise RuntimeError(f"unknown clip {clip!r}")


def write_clip(arm, figures, clip):
    """Keyframe one whole clip onto `arm` and return the action."""
    from mathutils import Quaternion, Vector  # noqa: PLC0415

    action = bpy.data.actions.new(clip)
    action.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    arm.animation_data.action_slot = None

    n = CLIP_FRAMES[clip]
    cyclic = clip in CYCLIC_CLIPS
    root_axis = {}
    for c in figures:
        root_axis[c] = arm.data.bones[f"f{c}_root"].matrix_local.to_3x3().inverted()

    for frame in range(n + 1):
        t = (frame % n) / n if cyclic else frame / n
        for c in figures:
            phase = GAIT_PHASE_FRACTIONS[c % len(GAIT_PHASE_FRACTIONS)] if cyclic else 0.0
            offset, bends = clip_pose(clip, c, phase, t)
            extra_roll = bends.pop("_roll", None)
            pb = arm.pose.bones[f"f{c}_root"]
            pb.rotation_mode = "QUATERNION"
            pb.location = root_axis[c] @ Vector(offset)
            pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
            pb.keyframe_insert(data_path="location", frame=frame)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            for bone in BONE_CHAIN[1:]:
                pb = arm.pose.bones[f"f{c}_{bone}"]
                pb.rotation_mode = "QUATERNION"
                q = Quaternion((1, 0, 0, 0))
                if bone in bends:
                    ax, deg = bends[bone]
                    q = Quaternion(local_axis(arm, f"f{c}_{bone}", ax), math.radians(deg))
                if extra_roll is not None and bone == "abdomen":
                    ax, deg = extra_roll
                    q = q @ Quaternion(local_axis(arm, f"f{c}_{bone}", ax), math.radians(deg))
                pb.rotation_quaternion = q
                pb.location = (0.0, 0.0, 0.0)
                pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
                pb.keyframe_insert(data_path="location", frame=frame)
        pb = arm.pose.bones["prop"]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pb.location = (0.0, 0.0, 0.0)
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        pb.keyframe_insert(data_path="location", frame=frame)
    return action


def check_clip_semantics(arm, figures):
    """Root world-z travel per clip, against `CLIP_SEMANTICS`' ceilings.

    Same instrument both donor importers use, on this rig's `f0_root` rather than
    a Mixamo `Hips`. See the module docstring for what it can and cannot prove
    here: it still proves these AUTHORED clips obey the contract, and it cannot
    catch a mis-mapped source clip because there is no source clip."""
    travel = {}
    for clip in CLIP_ORDER:
        n = CLIP_FRAMES[clip]
        zs = []
        for frame in range(n + 1):
            t = (frame % n) / n if clip in CYCLIC_CLIPS else frame / n
            for c in figures:
                phase = GAIT_PHASE_FRACTIONS[c % len(GAIT_PHASE_FRACTIONS)] \
                    if clip in CYCLIC_CLIPS else 0.0
                zs.append(clip_pose(clip, c, phase, t)[0][2])
        travel[clip] = (max(zs) - min(zs)) * 100.0
    print("root world-z travel x100, by clip:",
          {k: round(v, 3) for k, v in travel.items()})
    for clip in CLIP_ORDER:
        ceiling = CLIP_SEMANTICS[clip]["ceiling"](travel["idle"])
        if ceiling is not None and travel[clip] > ceiling:
            raise RuntimeError(
                f"{clip}: root travel {travel[clip]:.3f} exceeds {ceiling:.3f} -- "
                f"CLIP_SEMANTICS['{clip}']['means'] = {CLIP_SEMANTICS[clip]['means']!r}"
            )
    return travel


# --- export ---------------------------------------------------------------


def export_glb(arm, path):
    """One clip per call. A shared multi-action armature at export time silently
    collapses every clip's every channel to two identical keyframes -- the defect
    `import_meshy_soldier.py`'s own `export_glb` docstring records, which is why
    both donor scripts export each clip completely alone and merge afterwards."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for child in arm.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = arm
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
        export_extras=True,          # off by default, and it drops SILENTLY
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
        chunk = data[offset + 8: offset + 8 + chunk_len]
        if chunk_type == b"JSON":
            gltf = json.loads(chunk)
        elif chunk_type == b"BIN\x00":
            bin_data = chunk
        offset += 8 + chunk_len
    if gltf is None:
        raise RuntimeError(f"{path}: no JSON chunk")
    return gltf, bytearray(bin_data)


def _write_glb(gltf, bin_data, path):
    json_bytes = json.dumps(gltf).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    bin_bytes = bytes(bin_data)
    bin_bytes += b"\x00" * ((4 - len(bin_bytes) % 4) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
        f.write(bin_bytes)


#: Degrees about glTF/three.js +Y that turn this asset's exported facing into the
#: contract's local +X. See "Orientation" in the module docstring: the crew were
#: MEASURED to face Blender -Y, which exports to glTF +Z, and +90 about +Y carries
#: +Z to +X. A working hypothesis until the live in-game measurement confirms it,
#: exactly as it was for both donor assets.
FORWARD_FIX_DEG = 90.0


def _quat_y(deg):
    half = math.radians(deg) / 2.0
    return [0.0, math.sin(half), 0.0, math.cos(half)]


def apply_forward_fix(gltf, deg):
    """A wrapper node on the glTF node graph. NOT a Blender-side rest rotation --
    `bpy.ops.object.transform_apply` preserves the armature's `matrix_world` and
    provably cannot change the exported facing at any angle."""
    scene = gltf["scenes"][gltf.get("scene", 0)]
    wrapper = {"name": "forward_fix", "rotation": _quat_y(deg), "children": list(scene["nodes"])}
    gltf["nodes"].append(wrapper)
    scene["nodes"] = [len(gltf["nodes"]) - 1]


def merge_clip_glbs(clip_paths, out_path, forward_fix_deg=0.0):
    names = list(clip_paths.keys())
    base, base_bin = _read_glb(clip_paths[names[0]])
    base_nodes = [n.get("name") for n in base["nodes"]]
    if len(base["animations"]) != 1:
        raise RuntimeError(f"{names[0]}: expected 1 animation, got {len(base['animations'])}")
    base["animations"][0]["name"] = names[0]

    for clip in names[1:]:
        gltf, bin_data = _read_glb(clip_paths[clip])
        if [n.get("name") for n in gltf["nodes"]] != base_nodes:
            raise RuntimeError(f"{clip}: node name/order differs from {names[0]} -- cannot merge by index")
        if len(gltf["animations"]) != 1:
            raise RuntimeError(f"{clip}: expected 1 animation, got {len(gltf['animations'])}")
        anim = gltf["animations"][0]
        bv_remap, acc_remap = {}, {}

        def remap_bv(old):
            if old in bv_remap:
                return bv_remap[old]
            bv = dict(gltf["bufferViews"][old])
            start = bv.get("byteOffset", 0)
            chunk = bytes(bin_data[start:start + bv["byteLength"]])
            base_bin.extend(b"\x00" * ((4 - len(base_bin) % 4) % 4))
            bv["byteOffset"] = len(base_bin)
            bv["buffer"] = 0
            base_bin.extend(chunk)
            bv_remap[old] = len(base["bufferViews"])
            base["bufferViews"].append(bv)
            return bv_remap[old]

        def remap_acc(old):
            if old in acc_remap:
                return acc_remap[old]
            acc = dict(gltf["accessors"][old])
            if "bufferView" in acc:
                acc["bufferView"] = remap_bv(acc["bufferView"])
            acc_remap[old] = len(base["accessors"])
            base["accessors"].append(acc)
            return acc_remap[old]

        samplers = []
        for s in anim["samplers"]:
            ns = dict(s)
            ns["input"] = remap_acc(s["input"])
            ns["output"] = remap_acc(s["output"])
            samplers.append(ns)
        base["animations"].append(
            {"name": clip, "channels": [dict(c) for c in anim["channels"]], "samplers": samplers}
        )

    if forward_fix_deg:
        apply_forward_fix(base, forward_fix_deg)
    base["buffers"][0]["byteLength"] = len(base_bin)
    _write_glb(base, base_bin, out_path)


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC_BLEND)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mesh_obj = max(meshes, key=lambda o: len(o.data.vertices))
    print(f"source: {mesh_obj.name}, {len(mesh_obj.data.vertices)} verts, "
          f"{len(mesh_obj.data.polygons)} polys")

    # --- 1. sample the texture BEFORE the material is stripped ---------------
    co = vertex_positions(mesh_obj)
    cols = basecolor_per_vertex(mesh_obj)

    # --- 2. figures, then roles ---------------------------------------------
    comp = connected_components(mesh_obj)
    sizes = np.bincount(comp)
    order = np.argsort(-sizes)
    print("components:", [(int(c), int(sizes[c])) for c in order])
    # The loose round beside the ammunition handler is its own component and has
    # to be folded into the nearest figure by hand, or it would be a fourth
    # "figure" with no body to hang from.
    big = [c for c in order if sizes[c] > 50_000]
    fig = np.full(len(co), -1, dtype=np.int64)
    for i, c in enumerate(sorted(big, key=lambda c: co[comp == c, 0].mean())):
        fig[comp == c] = i
    for c in order:
        if c in big:
            continue
        m = comp == c
        cen = co[m].mean(0)
        d = [np.linalg.norm(co[fig == i].mean(0) - cen) for i in range(len(big))]
        fig[m] = int(np.argmin(d))
        print(f"  loose component {int(c)} ({int(sizes[c])} verts) -> figure {fig[m][0]}")

    roles, prop, held_round, zf, rad, meta = classify(co, cols, fig)
    from collections import Counter
    counts = Counter(roles.tolist())
    print("rl_role (source resolution): " +
          ", ".join(f"{k}={v} ({v / len(co):.1%})" for k, v in counts.most_common()))

    # The held round belongs to the loader, whichever figure that is: the mortar
    # is fused into exactly one component and that component's figure owns it.
    loader = int(np.bincount(fig[prop | held_round]).argmax())
    fig[held_round] = loader
    print(f"loader is figure {loader}")

    # --- 3. recompose, scale, sit on z=0 -------------------------------------
    body = np.ones(len(co), bool)
    for r in ("metal", "weapon"):
        body &= roles != r
    newco = recompose(co, fig, body)
    mesh_obj.data.vertices.foreach_set("co", newco.reshape(-1))
    mesh_obj.data.update()

    # Per-figure metres, recomputed from the recomposed positions -- the weights
    # are a function of height within a figure and the figure just moved.
    for c in sorted(meta):
        p = newco[(fig == c) & body]
        meta[c]["zb_m"] = float(p[:, 2].min())
        meta[c]["h_m"] = float(p[:, 2].max() - p[:, 2].min())
        hb = (fig == c) & body & (newco[:, 2] > meta[c]["zb_m"] + 0.80 * meta[c]["h_m"])
        meta[c]["hx"] = float(np.median(newco[hb, 0]))
        meta[c]["hy"] = float(np.median(newco[hb, 1]))
        meta[c]["hr"] = float(newco[hb, 1].max() - newco[hb, 1].min())
        print(f"  figure {c}: zb={meta[c]['zb_m']:.3f} h={meta[c]['h_m']:.3f} m")

    # --- 4. zero materials, and drop the UV map ------------------------------
    # Colour comes from `data/palette.json` at runtime, so TEXCOORD_0 would be
    # bytes nothing reads. `mortar_team.glb` and `inf_squad.glb` already ship
    # without one; only `sarim_rifles.glb` kept its.
    mesh_obj.data.materials.clear()
    while mesh_obj.data.uv_layers:
        mesh_obj.data.uv_layers.remove(mesh_obj.data.uv_layers[0])

    # --- 5. tag figure membership so it survives decimation ------------------
    fig_names = [f"_fig{c}" for c in sorted(meta)]
    for c in sorted(meta):
        tag_group(mesh_obj, f"_fig{c}", (fig == c) & ~prop)
    tag_group(mesh_obj, "_prop", prop)

    # --- 6. split by role, then decimate each ------------------------------
    by_role = separate_by_role(mesh_obj, roles)
    print(f"roles present: {sorted(by_role)}")
    print("decimating:")
    total = 0
    for role in sorted(by_role):
        obj = by_role[role]
        obj.name = role
        obj.data.name = role
        obj["rl_role"] = role
        total += decimate(obj, DECIMATE[role])
    print(f"  total {total} verts across {len(by_role)} role meshes")

    # --- 7. armature --------------------------------------------------------
    prop_anchor = newco[prop].mean(0)
    prop_anchor[2] = newco[prop][:, 2].min()
    arm = build_armature(meta, prop_anchor)

    def head_gate(c, pts):
        """1 near this figure's own head, falling to 0 away from it -- see
        `bone_weights`. The loader's raised hand is the highest point on him and
        must not ride the head bone."""
        info = meta[c]
        r = np.sqrt((pts[:, 0] - info["hx"]) ** 2 + (pts[:, 1] - info["hy"]) ** 2)
        return 1.0 - _smoothstep(r, 0.55 * info["hr"], 1.00 * info["hr"])

    # --- 8. skin every role mesh -------------------------------------------
    for role in sorted(by_role):
        obj = by_role[role]
        tag = read_tag(obj, fig_names + ["_prop"])
        fig_tag = np.where(tag < len(fig_names), tag, -1)
        prop_tag = tag == len(fig_names)
        # A decimated survivor with no surviving tag is orphan geometry; give it
        # to the nearest figure rather than dropping it silently.
        if (tag < 0).any():
            pts = vertex_positions(obj)
            for i in np.nonzero(tag < 0)[0]:
                d = [abs(pts[i, 0] - meta[c]["cx"] * SCALE) for c in sorted(meta)]
                fig_tag[i] = int(np.argmin(d))
            print(f"  {role}: {(tag < 0).sum()} untagged verts assigned by proximity")
        skin(obj, arm, fig_tag, prop_tag, meta, head_gate)
        for g in list(obj.vertex_groups):
            if g.name.startswith("_"):
                obj.vertex_groups.remove(g)

    figures = sorted(meta)
    check_clip_semantics(arm, figures)

    # --- 9. one export per clip, then merge --------------------------------
    tmp = tempfile.mkdtemp(prefix="meshy_mortar_clips_")
    paths = {}
    for clip in CLIP_ORDER:
        action = write_clip(arm, figures, clip)
        paths[clip] = os.path.join(tmp, f"{clip}.glb")
        export_glb(arm, paths[clip])
        arm.animation_data.action = None
        action.use_fake_user = False
        bpy.data.actions.remove(action)

    merge_clip_glbs(paths, OUT_PATH, forward_fix_deg=FORWARD_FIX_DEG)
    for p in paths.values():
        os.remove(p)
    os.rmdir(tmp)

    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), "
          f"clips={list(CLIP_ORDER)}, bones={len(arm.data.bones)}, "
          f"roles={sorted(by_role)}, verts={total}")


if __name__ == "__main__":
    main()
