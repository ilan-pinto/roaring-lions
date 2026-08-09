"""Parts every Roaring Lions infantry team is assembled from.

The building kit's reasoning applies unchanged: consistency should be structural
and distinctness authored. So a helmet is one function call everywhere, and what
separates a mortar team from an RPG team lives in the author_*.py scripts.

**No armature.** A posture is a different arrangement of the same parts, not a
deformation of one rig. Three reasons, in order of weight:

  * It is deterministic and reviewable as code. A rig's pose is data in a .blend
    that nobody can diff; `figure(posture="kneeling")` is a line in a script.
  * It drops `art/src/soldier_kolos.fbx`, whose licence is unverified -- one of
    the three CONTRIBUTING.md violations the rig-contract spec recorded.
  * It is enough. ART_PIPELINE.md section 0 states that at 40-80 px model quality
    is nearly irrelevant, and the rig contract measured infantry at 25 px wide.
    Blocky is the correct budget at that size, not a compromise.

Two rules carried over from the building kit, both easy to get wrong:

  * **Real vertex coordinates, object scale always 1.** Nothing here calls
    `obj.scale`; every part builds its geometry at final size with `from_pydata`.
  * **Every part declares `rl_role`**, which is how the renderer assigns
    materials.

One rule specific to figures:

  * **A figure is built at the origin and placed by `at`.** Composing at the
    origin and translating verts keeps every posture's contact point at z=0, so
    a kneeling figure's knee and a standing figure's boots sit on the same
    ground. Getting this wrong makes a team look like it is standing in a hole.

World scale is `dimetric.UNITS_PER_TILE` -- 3.0 units per tile, about a metre per
unit. A standing figure is 1.8 tall.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dimetric import UNITS_PER_TILE  # noqa: E402

#: Material roles. `uniform` and `webbing` are the two body tones; a unit's
#: faction picks which ramp they resolve to, so the same kit builds KDF olive and
#: militia dust without a second set of parts.
#: `boot` and `face` are separate from `webbing` so footwear and faces can leave
#: the uniform's ramp entirely -- boots are black on a real soldier and a face is
#: the one warm note on the figure, and neither reads if it is another step of the
#: same green.
ROLES = ("uniform", "webbing", "boot", "face", "skin_shadow", "keffiyeh",
         "weapon", "metal", "wood", "charge")

#: A standing figure, head to boot. Everything else is proportioned from it.
FIGURE_H = 1.8

#: Contact heights per posture, as a fraction of FIGURE_H. Used to keep the
#: weapon a figure carries at the right height without each author script
#: re-deriving it.
POSTURE_EYE = {"standing": 0.88, "kneeling": 0.62, "prone": 0.16}


def new_scene():
    """An empty file. Author scripts start from nothing, every time."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def save(path):
    """Write the .blend. Unit sources are tracked in plain git, like buildings."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"saved {path} ({len(bpy.data.objects)} objects)")


def tiles(n):
    """Tiles to world units."""
    return n * UNITS_PER_TILE


def _mesh(name, verts, faces, role):
    if role not in ROLES:
        raise ValueError(f"{name}: unknown role {role!r}, expected one of {ROLES}")
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob["rl_role"] = role
    bpy.context.collection.objects.link(ob)
    return ob


def _box_verts(size, at):
    sx, sy, sz = (s / 2.0 for s in size)
    cx, cy, cz = at
    return [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]


_BOX_FACES = [
    (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
    (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
]


def box(name, size, at, role="uniform"):
    """A cuboid. `size` is (sx, sy, sz); `at` is its centre."""
    return _mesh(name, _box_verts(size, at), list(_BOX_FACES), role)


def rot_z(name, size, at, yaw, role="uniform"):
    """A cuboid yawed about its own centre, built with real coordinates.

    Needed because object rotation is as forbidden here as object scale: the
    render rig reads vertex positions to size the frame, and an unapplied
    rotation would report the unrotated box.
    """
    cx, cy, cz = at
    c, s = math.cos(yaw), math.sin(yaw)
    verts = []
    for x, y, z in _box_verts(size, (0.0, 0.0, 0.0)):
        verts.append((cx + x * c - y * s, cy + x * s + y * c, cz + z))
    return _mesh(name, verts, list(_BOX_FACES), role)


def tube(name, length, radius, at, yaw=0.0, pitch=0.0, sides=8, role="weapon"):
    """A capped cylinder along +x, then pitched and yawed, at real coordinates.

    `pitch` is the lever that separates an RPG from a Spike launcher in
    silhouette: level reads as one weapon, steeply up as another, and the art
    gate sees the difference where it cannot see a texture.
    """
    cx, cy, cz = at
    cp, sp = math.cos(pitch), math.sin(pitch)
    cyaw, syaw = math.cos(yaw), math.sin(yaw)
    rings = []
    for end in (-length / 2.0, length / 2.0):
        ring = []
        for k in range(sides):
            a = 2.0 * math.pi * k / sides
            y, z = radius * math.cos(a), radius * math.sin(a)
            # pitch about y, then yaw about z
            px, pz = end * cp - z * sp, end * sp + z * cp
            ring.append((cx + px * cyaw - y * syaw, cy + px * syaw + y * cyaw, cz + pz))
        rings.append(ring)
    verts = rings[0] + rings[1]
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    faces.append(tuple(range(sides)))
    faces.append(tuple(range(2 * sides - 1, sides - 1, -1)))
    return _mesh(name, verts, faces, role)


# --- the figure ------------------------------------------------------------


def prism(name, r_bottom, r_top, height, at, sides=10, yaw=0.0, squash=1.0, role="uniform"):
    """A tapered n-sided prism, standing on +z. The limb and torso primitive.

    This exists because the first two passes built a figure entirely from
    axis-aligned cuboids, and the result did not read as a person. Two reasons,
    both structural rather than a matter of tuning sizes:

      * **A box has parallel sides.** A thigh that is the same width at the hip
        and the knee is a slab. Every limb on a body tapers, and the taper is
        what the eye uses to tell a limb from a crate.
      * **A box has four hard corners.** At any facing one of them points at the
        camera, so the outline is a staircase of right angles. Ten sides puts the
        outline within a pixel of a smooth curve at the size these render at.

    `squash` flattens the cross-section in y, so a forearm can be oval rather
    than round without needing a second primitive.
    """
    cx, cy, cz = at
    verts, faces = [], []
    cy_, sy_ = math.cos(yaw), math.sin(yaw)
    for level, r in ((0.0, r_bottom), (height, r_top)):
        for k in range(sides):
            a = 2.0 * math.pi * k / sides + math.pi / sides
            lx, ly = r * math.cos(a), r * math.sin(a) * squash
            verts.append((cx + lx * cy_ - ly * sy_, cy + lx * sy_ + ly * cy_, cz + level))
    for k in range(sides):
        n = (k + 1) % sides
        faces.append((k, n, sides + n, sides + k))
    faces.append(tuple(range(sides)))
    faces.append(tuple(range(2 * sides - 1, sides - 1, -1)))
    return _mesh(name, verts, faces, role)


def dome(name, radius, height, at, segments=10, rings=3, role="metal"):
    """A faceted half-dome. The helmet, and the reason a figure reads as a person.

    A cube head is the single thing that made the first pass look like stacked
    boxes rather than soldiers: at any facing a cube shows a hard corner where a
    head should show a curve, and a corner the width of the shoulders reads as
    cargo. Ten segments is enough that the outline is smooth once downsampled and
    cheap enough to build nine teams from.
    """
    cx, cy, cz = at
    verts, faces = [], []
    for r in range(rings + 1):
        phi = (math.pi / 2.0) * r / rings
        rr, zz = radius * math.cos(phi), height * math.sin(phi)
        for k in range(segments):
            a = 2.0 * math.pi * k / segments
            verts.append((cx + rr * math.cos(a), cy + rr * math.sin(a), cz + zz))
    for r in range(rings):
        for k in range(segments):
            a0, a1 = r * segments + k, r * segments + (k + 1) % segments
            b0, b1 = a0 + segments, a1 + segments
            faces.append((a0, a1, b1, b0))
    faces.append(tuple(range(rings * segments, (rings + 1) * segments)))
    faces.append(tuple(range(segments - 1, -1, -1)))
    return _mesh(name, verts, faces, role)


# --- organic primitives ----------------------------------------------------
#
# The three passes before this one were hard-surface by construction: cuboids,
# then tapered prisms with perfect circular cross-sections and dead-straight
# axes. Those read as machined parts however the proportions were tuned, because
# a constant cross-section and a straight axis are both things bodies never have.
#
# What follows replaces the primitive rather than the numbers, again -- but this
# time toward biology instead of merely away from boxes.


def _wobble(k, sides, amount, phase):
    """A deterministic per-vertex radius nudge, so no cross-section is a circle.

    Deterministic on purpose: Math.random has no place in an asset that must
    re-render identically, and the sim's PRNG is not available here. Two
    incommensurate harmonics give an outline that never repeats around the ring
    and never repeats between rings.
    """
    a = 2.0 * math.pi * k / sides
    return 1.0 + amount * (math.sin(a * 3.0 + phase) * 0.6 + math.sin(a * 5.0 - phase * 1.7) * 0.4)


def limb(name, waypoints, sides=9, squash=0.88, wobble=0.05, role="uniform"):
    """A limb lofted through waypoints, each `(x, y, z, radius)`.

    Three things here are the whole difference between a leg and a cone:

      * **Radius is not monotonic.** A calf swells above the ankle and narrows
        again at the knee -- 0.042 to 0.062 to 0.052. A single taper cannot do
        that, and it is the most recognisable soft-tissue cue on a human leg.
      * **The axis bends.** Waypoints carry their own x and y, so a limb bows
        instead of running straight. Straight limbs are the strongest machine
        cue a figure can have.
      * **Nine sides, not ten, plus `wobble`.** An odd ring has no mirror plane,
        and the harmonic nudge means no cross-section is a true circle. The brief
        bans perfect cylinders; this is that ban expressed in geometry.

    Rings are horizontal rather than perpendicular to the local axis. At the
    bends a body actually has -- a few degrees -- the difference is under a pixel,
    and it avoids carrying a reference frame along the curve for no visible gain.
    """
    verts, faces = [], []
    for i, (cx, cy, cz, r) in enumerate(waypoints):
        phase = i * 1.31
        for j in range(sides):
            a = 2.0 * math.pi * j / sides
            rr = r * _wobble(j, sides, wobble, phase)
            verts.append((cx + rr * math.cos(a), cy + rr * math.sin(a) * squash, cz))
    for i in range(len(waypoints) - 1):
        for j in range(sides):
            n = (j + 1) % sides
            a0, a1 = i * sides + j, i * sides + n
            faces.append((a0, a1, a1 + sides, a0 + sides))
    faces.append(tuple(range(sides)))
    faces.append(tuple(range(len(verts) - 1, len(verts) - sides - 1, -1)))
    return _mesh(name, verts, faces, role)


def blob(name, at, radius, squash=(1.0, 0.9, 0.85), sides=9, rings=3, wobble=0.06, role="uniform"):
    """An irregular ellipsoid. Joints, and the fix for "a stack of solids".

    The previous figure butt-joined its segments, so a shoulder was a corner
    where a thigh met a torso. A blob at each joint gives the silhouette a
    continuous curve across the junction, which is what stops the eye reading two
    parts instead of one limb.
    """
    cx, cy, cz = at
    sx, sy, sz = squash
    verts, faces = [], []
    for r in range(rings + 2):
        phi = math.pi * r / (rings + 1)
        rr, zz = math.sin(phi), -math.cos(phi)
        for j in range(sides):
            a = 2.0 * math.pi * j / sides
            w = _wobble(j, sides, wobble, r * 0.9)
            verts.append((cx + radius * sx * rr * math.cos(a) * w,
                          cy + radius * sy * rr * math.sin(a) * w,
                          cz + radius * sz * zz))
    for r in range(rings + 1):
        for j in range(sides):
            n = (j + 1) % sides
            a0, a1 = r * sides + j, r * sides + n
            faces.append((a0, a1, a1 + sides, a0 + sides))
    return _mesh(name, verts, faces, role)


def mitznefet(name, at, yaw=0.0, radius_min=0.19, radius_max=0.31, droop=0.12, role="uniform"):
    """The floppy, oversized, asymmetrical helmet cover.

    The single strongest silhouette-breaker on the figure, and the reason is
    geometric rather than stylistic: a helmet is a dome, a dome is the most
    machine-like form a head can have, and at 25 px a head is the first thing the
    eye resolves. This roughly doubles apparent head width and destroys the
    dome's rotational symmetry, so the head stops being a sphere from every
    facing.

    Deliberately not mirror-symmetric. Radius sweeps `radius_min` to
    `radius_max` once around, and the far side hangs `droop` lower, so the
    profile differs at every one of the 16 facings. A symmetric cover would just
    be a bigger dome.
    """
    cx, cy, cz = at
    sides = 11  # odd, so there is no facing at which two lobes line up
    verts = [(cx, cy, cz + 0.035)]
    for j in range(sides):
        a = 2.0 * math.pi * j / sides
        # One slow sweep plus a faster ripple: an oversized cloth cover hangs in
        # a few broad lobes rather than evenly.
        # `t` is 0 at the brow and 1 at the rear, so the flare and the droop both
        # grow backwards. A cover that hung evenly all round buried the face:
        # from a 30-degree camera an even skirt at crown height completely
        # encloses a head, and the figure rendered with no skin visible at all.
        # A real one clears the brow and gathers behind.
        t = 0.5 - 0.5 * math.cos(a + 0.7)
        r = radius_min + (radius_max - radius_min) * t
        r *= 1.0 + 0.09 * math.sin(a * 3.0 + 1.1)
        dz = -droop * t * t - 0.02 * t * (1.0 + math.sin(a * 2.0))
        ax = a + yaw
        verts.append((cx + r * math.cos(ax), cy + r * math.sin(ax), cz + dz))
    faces = [(0, j + 1, (j + 1) % sides + 1) for j in range(sides)]
    return _mesh(name, verts, faces, role)


def fold(name, at, size, yaw=0.0, role="uniform"):
    """A small irregular bulge -- fabric gathering at a drag point.

    Knees, elbows and the blouse over a boot. Flat palette art cannot shade a
    wrinkle, so a fold has to be geometry that shows up in the outline. At 25 px
    it is sub-pixel and does nothing; at the zoom the figure is judged at it is
    most of what separates cloth from plate.
    """
    sx, sy, sz = size
    return blob(name, at, max(sx, sy, sz) * 0.5,
                squash=(sx / max(sx, sy, sz), sy / max(sx, sy, sz), sz / max(sx, sy, sz)),
                sides=7, rings=2, wobble=0.16, role=role)


def tactical_helmet(name, at, yaw=0.0, radius=0.113, role="uniform"):
    """A modern tactical helmet: shell, rear/ear skirt, NVG mount, side rails.

    Replaces the floppy oversized cover, which was tried as a silhouette-breaker
    and abandoned for a good reason: at the size that actually broke the head's
    roundness it read as a pale mushroom cap wider than the torso, and it buried
    the face from a 30-degree camera. A shape that has to be unrecognisable to do
    its job is the wrong shape.

    The skirt is what keeps this from being a plain dome -- it drops lower at the
    rear and over the ears, so the profile is egg-shaped rather than circular and
    the back of the head reads differently from the front.
    """
    cx, cy, cz = at
    parts = [dome(f"{name}_shell", radius, 0.108, (cx, cy, cz), segments=11, role=role)]
    # Rear and ear skirt: a ring that hangs lower behind than in front.
    sides = 11
    verts, faces = [], []
    for level in (0, 1):
        for j in range(sides):
            a = 2.0 * math.pi * j / sides
            t = 0.5 - 0.5 * math.cos(a + math.pi + yaw * 0.0)   # 0 at brow, 1 at rear
            # Narrow at the brow (t=0), wide at the nape. A skirt at full
            # radius all round reached x=0.119 against the face's 0.093 and,
            # sitting a pixel above it, hid the face from a camera looking
            # down at 30 degrees -- the cause of five failed face fixes.
            r = radius * (0.84 + 0.22 * t)
            # t is 0 at the brow: the front edge stays above HEADGEAR_BROW.
            dz = -0.014 - 0.058 * t if level else 0.010
            ax = a + yaw
            verts.append((cx + r * math.cos(ax), cy + r * math.sin(ax), cz + dz))
    for j in range(sides):
        n = (j + 1) % sides
        faces.append((j, n, n + sides, j + sides))
    parts.append(_mesh(f"{name}_skirt", verts, faces, role))
    c, sn = math.cos(yaw), math.sin(yaw)

    def at_local(dx, dy, dz):
        return (cx + dx * c - dy * sn, cy + dx * sn + dy * c, cz + dz)

    parts.append(box(f"{name}_nvg", (0.062, 0.078, 0.050), at_local(0.088, 0.0, 0.052), "metal"))
    for i, sgn in enumerate((-1.0, 1.0)):
        parts.append(box(f"{name}_rail{i}", (0.105, 0.016, 0.022),
                         at_local(0.0, sgn * (radius - 0.004), 0.012), "metal"))
    return parts


def keffiyeh(name, at, yaw=0.0, radius=0.112, role="keffiyeh"):
    """A draped head scarf: crown, then a mantle over the back and one shoulder.

    This is the enemy's silhouette channel, and it is a better one than colour --
    a drape reaching the shoulders makes the head-and-neck outline continuous,
    where a helmet leaves a clear neck gap. So an irregular reads differently from
    a regular at any facing, including from behind, and including in a pure black
    silhouette where the palette cannot help.

    Asymmetric by construction: the mantle hangs to the shoulder on one side and
    a loose tail falls in front on the other.
    """
    cx, cy, cz = at
    parts = [dome(f"{name}_crown", radius, 0.088, (cx, cy, cz), segments=10, role=role)]
    sides = 11
    verts, faces = [], []
    for level in (0, 1, 2):
        for j in range(sides):
            a = 2.0 * math.pi * j / sides
            t = 0.5 - 0.5 * math.cos(a + math.pi)          # 0 at face, 1 at nape
            # Widening and lengthening backwards: cloth gathers on the shoulders.
            r = radius * (0.88 + (0.10 + 0.40 * t) * level * 0.62)
            # Nothing hangs at the face (t=0); the drape gathers behind.
            drop = (0.0, 0.008 + 0.150 * t, 0.030 + 0.290 * t)[level]
            # One side hangs lower -- a real scarf is never even.
            drop *= 1.0 + 0.30 * math.sin(a + 1.9)
            ax = a + yaw
            verts.append((cx + r * math.cos(ax), cy + r * math.sin(ax), cz - drop))
    for level in (0, 1):
        for j in range(sides):
            n = (j + 1) % sides
            a0, a1 = level * sides + j, level * sides + n
            faces.append((a0, a1, a1 + sides, a0 + sides))
    parts.append(_mesh(f"{name}_mantle", verts, faces, role))
    c, sn = math.cos(yaw), math.sin(yaw)
    # The loose tail, over one shoulder at the front.
    tail = (cx + 0.045 * c - 0.115 * sn, cy + 0.045 * sn + 0.115 * c, cz - 0.235)
    parts.append(blob(f"{name}_tail", tail, 0.062, squash=(0.55, 0.9, 1.5),
                      sides=7, wobble=0.18, role=role))
    return parts


#: Body proportions for a 1.8 m figure, as fractions of height, plus limb radii in
#: metres. Named rather than inlined because every posture reads from the same
#: set, so a change to leg length cannot desynchronise the kneeling figure from
#: the standing one.
#:
#: The radii are the important part and they are small: a real upper arm is about
#: 0.10 m across, a thigh 0.15, a shin 0.11. The first two passes used 0.14-0.22
#: boxes for the same parts, which is why the figures read as bulky slabs however
#: the proportions were tuned. Bulk was never a proportion problem -- it was a
#: cross-section problem.
BOOT_H, SHIN_TOP, KNEE_Z, THIGH_TOP = 0.055, 0.26, 0.28, 0.50
BELT_Z, CHEST_Z, SHOULDER_Z, HEAD_Z = 0.52, 0.62, 0.80, 0.865
R_SHIN, R_KNEE, R_THIGH = 0.060, 0.070, 0.088
R_WAIST, R_CHEST, R_NECK = 0.124, 0.165, 0.052
R_UPPERARM, R_FOREARM = 0.058, 0.048
HEAD_W = 0.115

#: Where headgear sits, relative to the head centre, and the contract that makes
#: a face visible at all.
#:
#: Four attempts failed before this, and every one of them tried to push the face
#: *forward* past the headgear. That can never work: a helmet dome is radius 0.113
#: and a keffiyeh crown 0.112, both as wide as the head, so there is no forward
#: position that clears them. Skin measured 0.1% across all sixteen facings each
#: time.
#:
#: A face is visible when it is **below the brim**, not in front of it. So the
#: headgear's bottom edge is pinned at HEADGEAR_BASE and everything worn on the
#: head builds upward from there, leaving a band of face beneath it. The cranium
#: shrinks to 0.075 and hides under the headgear, which is correct anyway -- the
#: headgear is supplying the skull's volume.
HEADGEAR_BASE = 0.005      # head-centre-relative z of any headgear's lowest edge
FACE_TOP = -0.017          # the face must stay below this, or the brim covers it


def smoke_pose(frame, frames):
    """Eased pose parameters for one frame of the smoking idle.

    Returns `(reach, breath, sway)`, each 0..1-ish.

    **The easing lives here, not in the manifest.** `advancePhase` in the renderer
    steps frames at one constant fps per clip -- there is no per-frame hold, so a
    timing curve cannot be expressed. What can be expressed is *pose spacing*:
    put more frames where the motion is slow and fewer through the fast middle,
    which is how hand-drawn sprite animation has always eased. A triangle wave
    through a smoothstep does exactly that -- consecutive frames are close
    together near both extremes and far apart in the middle.

    So the hand appears to slow as it nears the mouth, hold, and slow again at the
    bottom, from uniformly-timed frames.
    """
    t = frame / float(frames)
    tri = 1.0 - abs(2.0 * t - 1.0)          # 0 -> 1 -> 0
    reach = tri * tri * (3.0 - 2.0 * tri)   # smoothstep: slow at both ends
    breath = 0.5 - 0.5 * math.cos(2.0 * math.pi * t)
    # Sway runs at half rate and out of phase, so the weight shift never lines up
    # with the breath -- two synchronised sines read as one mechanical bob.
    sway = math.sin(math.pi * t + 0.9)
    return reach, breath, sway


def figure(prefix, at, posture="standing", yaw=0.0, headgear="helmet", stride=0.0,
           arms=True, leader=False, mirror=False, loadout="regular", smoke=None):
    """One soldier, contact point at z=0 of `at`.

    Fourth pass, and the first built to an organic brief rather than away from
    boxes. What changed, in order of how much it matters at any zoom:

      * **Contrapposto.** Weight on one leg, pelvis tilted, shoulders counter-
        tilted, head yawed off the body axis. A symmetrical stance is a machine
        stance; almost nothing else on this list matters while the figure stands
        square.
      * **No mirror plane.** Limbs, kit and cover are all handed. `mirror` flips
        the handedness so a team is not three clones.
      * **Organic limbs.** `limb()` through waypoints, with the calf swelling
        above the ankle and every axis slightly bowed.
      * **Blobbed joints.** Shoulders, elbows, knees and hips are ellipsoids that
        bridge the segments, so the outline curves across a junction instead of
        cornering.
      * **The cover.** Oversized, floppy, asymmetric -- see `mitznefet`.
      * **Fabric folds** at the knee and elbow drag points, and a blouse over the
        boot.

    `stride` drives the walk cycle. `arms=False` frees the hands for a crew
    weapon. `leader` adds the radio antenna.
    """
    if posture not in POSTURE_EYE:
        raise ValueError(f"{prefix}: unknown posture {posture!r}")
    x0, y0, z0 = at
    parts = []
    c, s = math.cos(yaw), math.sin(yaw)
    H = FIGURE_H
    # Handedness. Everything below reads `hand`, so one flag makes a whole figure
    # the other way round rather than a mirrored copy of the same asset.
    hand = -1.0 if mirror else 1.0

    def place(dx, dy, dz):
        return (x0 + dx * c - dy * s, y0 + dx * s + dy * c, z0 + dz)

    def L(name, waypoints, **kw):
        parts.append(limb(f"{prefix}_{name}", [place(*w[:3]) + (w[3],) for w in waypoints], **kw))

    def BL(name, at_local, radius, **kw):
        parts.append(blob(f"{prefix}_{name}", place(*at_local), radius, **kw))

    def B(name, size, at_local, role="uniform"):
        parts.append(rot_z(f"{prefix}_{name}", size, place(*at_local), yaw, role))

    def F(name, at_local, size, role="uniform"):
        parts.append(fold(f"{prefix}_{name}", place(*at_local), size, role=role))

    if posture == "prone":
        # Every part runs horizontally, so this branch cannot use the standing
        # primitives -- see the note that used to be here about prism().
        def C(name, length, radius, at_local, role="uniform"):
            parts.append(tube(f"{prefix}_{name}", length, radius,
                              place(*at_local), yaw=yaw, role=role))
        C("torso", 0.70, 0.125, (0.30, 0.0, 0.125))
        B("pack", (0.32, 0.30, 0.13), (0.02, 0.02 * hand, 0.255), "webbing")
        for i, sgn in enumerate((-1.0, 1.0)):
            reach = sgn * stride
            # Splayed unevenly: a prone body's legs are never parallel.
            spread = 0.085 + 0.03 * (1 if sgn * hand > 0 else 0)
            C(f"leg{i}", 0.62, 0.056, (-0.42 + reach * 0.085, sgn * spread, 0.072))
            B(f"boot{i}", (0.15, 0.13, 0.10), (-0.78 + reach * 0.085, sgn * spread, 0.06), "boot")
            C(f"arm{i}", 0.38, 0.044, (0.44 - reach * 0.075, sgn * 0.165, 0.082))
            BL(f"hand{i}", (0.62 - reach * 0.075, sgn * 0.165, 0.082), 0.043, role="skin_shadow")
        C("neck", 0.09, R_NECK, (0.66, 0.0, 0.125), "skin_shadow")
        BL("head", (0.78, 0.0, 0.115), 0.098, squash=(1.05, 0.92, 0.9), role="face")
        if headgear == "helmet":
            parts += tactical_helmet(f"{prefix}_helm", place(0.78, 0.0, 0.115),
                                     yaw=yaw, radius=0.106, role="uniform")
        elif headgear == "keffiyeh":
            parts += keffiyeh(f"{prefix}_kef", place(0.78, 0.0, 0.120),
                              yaw=yaw, radius=0.104)
        return parts

    # --- vertical layout, per posture ---
    if posture == "kneeling":
        drop = 0.30 * H
        parts.append(tube(f"{prefix}_shin_r", 0.38, 0.056,
                          place(-0.14, -0.11 * hand, 0.058), yaw=yaw, role="uniform"))
        B("boot_r", (0.16, 0.14, 0.10), (0.09, -0.11 * hand, 0.055), "boot")
        L("thigh_r", [(-0.20, -0.115 * hand, 0.10, R_KNEE),
                      (-0.13, -0.120 * hand, 0.26, R_THIGH * 0.98),
                      (-0.10, -0.125 * hand, 0.40, R_THIGH)])
        L("shin_f", [(0.15, 0.125 * hand, 0.055, 0.048),
                     (0.16, 0.126 * hand, 0.20, 0.060),
                     (0.15, 0.128 * hand, 0.40, 0.050)])
        B("boot_f", (0.24, 0.14, 0.10), (0.19, 0.125 * hand, 0.05), "boot")
        BL("knee_f", (0.16, 0.126 * hand, 0.42), R_KNEE * 1.15, role="uniform")
        L("thigh_f", [(0.15, 0.127 * hand, 0.44, R_KNEE), (0.0, 0.122 * hand, 0.52, R_THIGH)])
        hip_tilt = 0.0
        sh_tilt = -0.012 * hand
    else:
        drop = 0.018 * abs(stride)
        if smoke is not None:
            # Breathing lowers the whole upper body very slightly on the exhale;
            # a rising chest alone reads as a shrug.
            drop += 0.010 * (1.0 - smoke[1])
        # Contrapposto. The weight leg is straight and its hip rides up; the free
        # leg's knee comes forward and inward and its heel lifts. When striding
        # the weight shifts with the stride instead, or the figure looks like it
        # is limping on one side for the whole cycle.
        weight = hand if stride == 0.0 else (hand if stride > 0 else -hand)
        # Weight oscillates rather than transferring. A real shift of weight from
        # one leg to the other cannot be done smoothly in ten frames -- it reads
        # as a twitch -- so the contrapposto breathes in depth instead of swapping
        # sides. Stated as a limit rather than shipped badly.
        hip_tilt = 0.035 * weight * (1.0 + 0.15 * smoke[2] if smoke else 1.0)
        sh_tilt = -0.022 * weight          # shoulders counter the pelvis
        for i, sgn in enumerate((-1.0, 1.0)):
            fore = sgn * stride
            bearing = sgn * weight          # +1 on the weight side
            lift = 0.0 if bearing > 0 else 0.014
            lat = sgn * 0.115 + (0.0 if bearing > 0 else -sgn * 0.022)
            knee_fwd = 0.02 if bearing > 0 else 0.055
            hz = hip_tilt * sgn * weight
            B(f"sole{i}", (0.25, 0.135, 0.026),
              (fore * 0.26, lat, 0.013 + lift), "boot")
            B(f"boot{i}", (0.17, 0.125, 0.075),
              (fore * 0.26 - 0.012, lat, 0.062 + lift), "boot")
            B(f"toe{i}", (0.10, 0.115, 0.046),
              (fore * 0.26 + 0.075, lat, 0.048 + lift), "boot")
            # Calf swells above the ankle, then narrows into the knee.
            L(f"calf{i}", [(fore * 0.22, lat, 0.10 + lift, 0.050),
                           (fore * 0.20, lat + sgn * 0.004, 0.20 + lift, 0.070),
                           (fore * 0.17 + knee_fwd * 0.4, lat, 0.30 + lift, 0.050)])
            F(f"blouse{i}", (fore * 0.23, lat, 0.115 + lift), (0.15, 0.135, 0.05))
            BL(f"knee{i}", (fore * 0.16 + knee_fwd, lat, 0.34 + lift), R_KNEE * 1.12)
            F(f"kneefold{i}", (fore * 0.16 + knee_fwd, lat + sgn * 0.01, 0.29 + lift),
              (0.13, 0.11, 0.055))
            L(f"thigh{i}", [(fore * 0.15 + knee_fwd, lat, 0.36 + lift, R_KNEE),
                            (fore * 0.11 + knee_fwd * 0.5, lat + sgn * 0.006, 0.55, R_THIGH),
                            (fore * 0.05, sgn * 0.105, 0.78 + hz, R_THIGH * 1.04)])
            BL(f"hip{i}", (0.0, sgn * 0.10, 0.86 + hz), 0.072, squash=(1.0, 0.95, 0.8))
        B("dropleg", (0.125, 0.09, 0.20), (0.02, 0.215 * hand, 0.40 * H), "webbing")

    def z(frac):
        return frac * H - drop

    # Pelvis and a torso that leans a little over the weight leg, then an S-curve
    # back so the head stays over the feet.
    lean = sh_tilt * 0.8
    L("hips", [(0.0, hip_tilt * 0.4, z(BELT_Z) - 0.09, 0.126),
               (0.0, hip_tilt * 0.5, z(BELT_Z) + 0.02, R_WAIST)], squash=0.82)
    breathe = 1.0 + (0.030 * smoke[1] if smoke else 0.0)
    L("torso", [(0.0, hip_tilt * 0.5, z(BELT_Z) + 0.05, R_WAIST),
                (0.005, lean * 0.5, z(CHEST_Z) + 0.02, R_CHEST * 0.96 * breathe),
                (0.0, lean, z(SHOULDER_Z) - 0.03, R_CHEST * breathe)], squash=0.74)
    F("hem", (0.0, hip_tilt * 0.5, z(BELT_Z) + 0.10), (0.30, 0.26, 0.07))

    # Webbing. Straps break the shoulder line, which the brief asks for and which
    # also stops the deltoid blobs reading as pauldrons.
    if loadout == "regular":
        # Issued kit: a fitted carrier with pouches in a row, and everything in
        # its place. The regularity is the point -- it is what reads as issued.
        B("belt", (0.245, 0.255, 0.05), (0.0, hip_tilt * 0.5, z(BELT_Z) + 0.05), "webbing")
        B("carrier", (0.125, 0.245, 0.20), (0.09, lean * 0.6, z(CHEST_Z) + 0.05))
        for i, py in enumerate((-0.115, 0.005, 0.125)):   # uneven: packed by hand
            B(f"pouch{i}", (0.105, 0.10, 0.105 + 0.012 * i),
              (0.155, py + lean * 0.5, z(CHEST_Z) + 0.02), "webbing")
        for i, sgn in enumerate((-1.0, 1.0)):
            L(f"strap{i}", [(0.045, sgn * 0.075 + lean, z(SHOULDER_Z) - 0.02, 0.030),
                            (0.075, sgn * 0.135 + lean * 0.7, z(CHEST_Z) + 0.13, 0.026)],
              sides=7, squash=0.7, role="webbing")
        B("admin", (0.07, 0.13, 0.095), (0.135, lean * 0.5, z(CHEST_Z) + 0.155), "webbing")
        B("dump", (0.10, 0.085, 0.13), (-0.10, -0.155 * hand, z(BELT_Z) + 0.02), "webbing")
        L("canteen", [(-0.13, 0.075 * hand, z(BELT_Z) - 0.075, 0.046),
                      (-0.13, 0.075 * hand, z(BELT_Z) + 0.045, 0.043)], sides=8, role="webbing")
        B("holster", (0.08, 0.056, 0.15), (0.03, -0.215 * hand, 0.40 * H - drop), "webbing")
    else:
        # Irregular: no carrier at all. A single bandolier across one shoulder, two
        # mismatched pouches at different heights on a plain belt, and a long
        # untucked shirt over loose trousers.
        #
        # Removing the carrier is what does the work. A plate carrier is a slab
        # that squares the torso; without it the shirt keeps the body's own taper,
        # so a militiaman reads soft where a regular reads boxed -- visible in a
        # black silhouette, which colour is not.
        L("bandolier", [(0.055, -0.145 * hand + lean, z(SHOULDER_Z) - 0.03, 0.034),
                        (0.085, 0.055 * hand + lean * 0.6, z(CHEST_Z) - 0.02, 0.030),
                        (0.070, 0.130 * hand + lean * 0.4, z(BELT_Z) + 0.09, 0.026)],
          sides=7, squash=0.62, role="webbing")
        for i, (px, py, pz, ph) in enumerate((
                (0.115, -0.075 * hand, 0.02, 0.115),
                (0.095, 0.120 * hand, -0.03, 0.095))):
            B(f"pouch{i}", (0.095, 0.085, ph),
              (px, py + lean * 0.4, z(BELT_Z) + pz + 0.06), "webbing")
        B("belt", (0.235, 0.245, 0.042), (0.0, hip_tilt * 0.5, z(BELT_Z) + 0.05), "webbing")
        # Long untucked shirt: the hem sits low and irregular over the hips.
        F("shirt_hem", (0.0, hip_tilt * 0.5, z(BELT_Z) - 0.005), (0.31, 0.27, 0.12))

    # Shoulders as blobs, not a slab: the brief's organic slope.
    for i, sgn in enumerate((-1.0, 1.0)):
        BL(f"deltoid{i}", (0.0, sgn * (R_CHEST - 0.015) + lean, z(SHOULDER_Z) - 0.035),
           0.062, squash=(1.0, 0.92, 0.85))

    # Arms, handed and unequal. The weapon side comes forward and up; the off arm
    # hangs lower and further back. Equal arms are a mannequin.
    if arms:
        for i, sgn in enumerate((-1.0, 1.0)):
            lead = sgn * hand > 0                     # the weapon side
            swing = -sgn * stride
            # Smoking: the off hand rises to the mouth on `reach`, the weapon hand
            # hangs relaxed and a little lower. Only the off arm moves, so the
            # weapon stays where the eye last saw it.
            if smoke is not None and not lead:
                reach = smoke[0]
                fwd_s = 0.055 + 0.115 * reach
                elbow_lift = 0.05 * reach
                wrist_lift = 0.30 * reach
            else:
                fwd_s = elbow_lift = wrist_lift = None
            ay = sgn * (R_CHEST + R_UPPERARM + 0.012) + lean
            fwd = (fwd_s if fwd_s is not None else (0.075 if lead else -0.03)) + swing * 0.09
            # The weapon hand drops slightly while at ease -- a relaxed one-handed
            # carry, muzzle down, per the brief.
            relax = 0.03 if (smoke is not None and lead) else 0.0
            elbow_z = z(SHOULDER_Z) - (0.24 if lead else 0.27) - relax \
                + (elbow_lift or 0.0)
            L(f"upperarm{i}", [(swing * 0.02, ay, z(SHOULDER_Z) - 0.055, R_UPPERARM),
                               (fwd * 0.5, ay + sgn * 0.006, elbow_z + 0.09, R_UPPERARM * 0.90),
                               (fwd * 0.8, ay + sgn * 0.004, elbow_z, R_UPPERARM * 0.86)])
            BL(f"elbow{i}", (fwd * 0.8, ay + sgn * 0.004, elbow_z), 0.048)
            F(f"elbowfold{i}", (fwd * 0.8, ay + sgn * 0.012, elbow_z + 0.035), (0.10, 0.09, 0.05))
            wrist_z = elbow_z - (0.20 if lead else 0.23) + (wrist_lift or 0.0)
            L(f"forearm{i}", [(fwd * 0.85, ay + sgn * 0.004, elbow_z - 0.01, 0.046),
                              (fwd + (0.05 if lead else 0.0), ay, wrist_z, 0.036)])
            # Hands wrap the grip rather than ending in a block: two blobs, so a
            # fist reads as fingers over a wrist rather than a cube on a stick.
            BL(f"wrist{i}", (fwd + (0.05 if lead else 0.0), ay, wrist_z), 0.037, role="skin_shadow")
            BL(f"hand{i}", (fwd + (0.075 if lead else 0.01), ay + sgn * 0.008, wrist_z - 0.045),
               0.046, squash=(1.0, 0.82, 0.95), role="face")
            if smoke is not None and not lead:
                parts += cigarette(f"{prefix}_cig",
                                   place(fwd + 0.055, ay + sgn * 0.008, wrist_z - 0.030),
                                   yaw=yaw)

    # Neck and head, both yawed off the body axis: a head square to the shoulders
    # is the last symmetry to go and the most visible one.
    head_turn = 0.18 * hand
    hx, hy = 0.012 * math.cos(head_turn), 0.012 * math.sin(head_turn) + lean
    L("neck", [(0.0, lean, z(HEAD_Z) - 0.155, R_NECK * 1.05),
               (hx * 0.6, hy, z(HEAD_Z) - 0.085, R_NECK * 0.94)], sides=8, role="skin_shadow")
    # Two parts, not one, and this is the third attempt at making a face visible.
    #
    # The first two positioned a single head blob and hoped it cleared the
    # headgear; both times the skirt or mantle closed over it from a 30-degree
    # camera and skin measured 0.0%. Splitting it fixes that by construction: the
    # cranium lives under the headgear where it belongs, and the face is a
    # separate forward-and-*down* patch placed below the skirt line rather than
    # level with it. HEADGEAR_BROW is the contract -- anything worn on the head
    # must keep its front edge above it.
    # The cranium is deliberately *smaller* than a head: the headgear supplies the
    # skull's volume, and an accurate cranium simply swallows the face. At 0.098
    # it reached hx+0.100 while the face patch reached hx+0.113, so the face
    # protruded under two pixels and measured 0.1% skin across all sixteen
    # facings. Sizing the two against each other is the whole fix.
    BL("cranium", (hx - 0.008, hy, z(HEAD_Z) - 0.015), 0.075,
       squash=(1.00, 0.96, 1.02), role="skin_shadow")
    BL("face", (hx + 0.064, hy + 0.004, z(HEAD_Z) - 0.070), 0.054,
       squash=(0.94, 0.92, 1.02), role="face")
    if headgear == "helmet":
        parts += tactical_helmet(f"{prefix}_helm",
                                 place(hx, hy, z(HEAD_Z) + HEADGEAR_BASE),
                                 yaw=yaw + head_turn, role="uniform")
        B("chinstrap", (0.085, 0.135, 0.02), (hx + 0.03, hy, z(HEAD_Z) - 0.115), "webbing")
    elif headgear == "keffiyeh":
        parts += keffiyeh(f"{prefix}_kef",
                          place(hx, hy, z(HEAD_Z) + HEADGEAR_BASE),
                          yaw=yaw + head_turn)
    else:
        parts.append(dome(f"{prefix}_capp", 0.104, 0.11,
                          place(hx, hy, z(HEAD_Z) - 0.02), role="uniform"))

    if leader:
        parts.append(tube(f"{prefix}_antenna", 0.46, 0.009,
                          place(-0.11, -0.10 * hand, z(SHOULDER_Z) + 0.16),
                          yaw=yaw, pitch=math.radians(84.0), sides=6, role="metal"))
    return parts


# --- weapons ---------------------------------------------------------------


def cigarette(name, at, yaw=0.0, role="face"):
    """A cigarette. Two pixels, and the only reason it earns them is the motion.

    The ember is NOT here. Saturated colour lives in the reserved vfx band, which
    the art gate rejects in static art by name -- correctly, since that band is
    what keeps explosions readable. The glow is `data/vfx/cigarette_ember.json`,
    spawned by the renderer.
    """
    x0, y0, z0 = at
    return [tube(name, 0.055, 0.006, (x0, y0, z0), yaw=yaw, sides=5, role=role)]


def rifle(name, at, yaw=0.0, posture="standing", aim=False):
    """A rifle held across the chest, or brought up to the shoulder to fire.

    `aim` is what makes the `fire` clip read, and it deliberately changes nothing
    about the figure's height. The clip is latched per shot, so anything that
    moved the body would bob the whole team up and down for the length of a
    firefight -- see teams._standing_posture. Pushing the weapon forward and
    level is free of that, and a rifle swinging out from the chest is the part
    that is actually visible at gameplay zoom.
    """
    z = POSTURE_EYE[posture] * FIGURE_H - (0.10 if aim else 0.16)
    reach = 0.32 if aim else 0.16
    x0, y0, z0 = at
    c, s = math.cos(yaw), math.sin(yaw)
    return [tube(name, 0.78, 0.045, (x0 + reach * c, y0 + reach * s, z0 + z), yaw=yaw, role="weapon")]


def sniper_rifle(name, at, yaw=0.0):
    """Longer than a rifle, with a bipod, lying at prone height. The length is
    the point: it stretches an already-wide prone silhouette wider."""
    x0, y0, z0 = at
    c, s = math.cos(yaw), math.sin(yaw)
    parts = [tube(name, 1.24, 0.05, (x0 + 0.42 * c, y0 + 0.42 * s, z0 + 0.26), yaw=yaw, role="weapon")]
    parts.append(box(f"{name}_bipod", (0.06, 0.30, 0.22),
                     (x0 + 0.92 * c, y0 + 0.92 * s, z0 + 0.13), "metal"))
    return parts


def launcher(name, at, yaw=0.0, pitch=0.0, length=1.10, radius=0.085):
    """A shoulder-fired tube. `pitch` is what separates the units that carry one.

    Level reads as a guided AT launcher on a kneeling firer; steeply up reads as
    an RPG. That angle is a real silhouette difference at 64 px, where a texture
    is not.
    """
    x0, y0, z0 = at
    c, s = math.cos(yaw), math.sin(yaw)
    parts = [tube(name, length, radius, (x0 + 0.20 * c, y0 + 0.20 * s, z0), yaw=yaw, pitch=pitch, role="weapon")]
    # Rear venturi flare, so the tube is not a plain cylinder end-on.
    parts.append(tube(f"{name}_bell", 0.18, radius * 1.7,
                      (x0 - (length * 0.42) * math.cos(pitch) * c,
                       y0 - (length * 0.42) * math.cos(pitch) * s,
                       z0 - (length * 0.42) * math.sin(pitch)),
                      yaw=yaw, pitch=pitch, role="weapon"))
    return parts


def atgm_tripod(name, at, yaw=0.0):
    """A tripod-mounted missile post: wide, low, and the widest base in the set.

    The three legs splay in plan, so the silhouette is a low triangle rather than
    a vertical mass -- deliberately the opposite of the mortar.
    """
    x0, y0, z0 = at
    parts = []
    for k in range(3):
        a = yaw + 2.0 * math.pi * k / 3.0 + math.pi / 6.0
        parts.append(box(f"{name}_leg{k}", (0.66, 0.07, 0.07),
                         (x0 + 0.30 * math.cos(a), y0 + 0.30 * math.sin(a), z0 + 0.30), "metal"))
    parts.append(box(f"{name}_post", (0.16, 0.16, 0.20), (x0, y0, z0 + 0.60), "metal"))
    parts.append(tube(f"{name}_tube", 0.86, 0.10, (x0, y0, z0 + 0.74), yaw=yaw, role="weapon"))
    parts.append(box(f"{name}_sight", (0.18, 0.26, 0.20), (x0 - 0.16, y0, z0 + 0.80), "metal"))
    return parts


def mortar(name, at, yaw=0.0, length=0.94, pitch=math.radians(74.0)):
    """A mortar on its baseplate and bipod. The one vertical spike in the set.

    Pitched steeply rather than drawn straight up: a true vertical tube reads as
    a mast or an antenna, whereas 74 degrees still reads as a weapon aimed
    somewhere. `length` is the lever that keeps two mortar-armed units apart.
    """
    x0, y0, z0 = at
    parts = [box(f"{name}_plate", (0.34, 0.34, 0.06), (x0, y0, z0 + 0.03), "metal")]
    # The tube's centre sits half its length up its own axis from the baseplate,
    # so the muzzle leans forward over the plate instead of the tube hanging in
    # the air above it. The axial offset used to be multiplied by 0.0 -- a
    # leftover that pinned the tube to the plate's x and made it read as resting
    # on the nearest crewman's shoulder.
    axial = length * 0.5
    parts.append(tube(name, length, 0.055,
                      (x0 + axial * math.cos(pitch) * math.cos(yaw),
                       y0 + axial * math.cos(pitch) * math.sin(yaw),
                       z0 + axial * math.sin(pitch) + 0.06),
                      yaw=yaw, pitch=pitch, role="weapon"))
    for sgn in (-1.0, 1.0):
        parts.append(box(f"{name}_bipod{int(sgn)}", (0.06, 0.06, 0.54),
                         (x0 + 0.16, y0 + sgn * 0.17, z0 + 0.30), "metal"))
    return parts


def demo_charge(name, at):
    """A satchel charge set on the ground: a low box, deliberately bulky."""
    return [box(name, (0.40, 0.30, 0.20), (at[0], at[1], at[2] + 0.10), "charge")]


def cable_spool(name, at):
    """A firing-cable reel, carried. A disc on edge, which is a shape no weapon
    in the set has -- it is the engineers' silhouette tell."""
    x0, y0, z0 = at
    parts = [tube(name, 0.14, 0.26, (x0, y0, z0 + 0.30), yaw=math.radians(90.0), role="metal")]
    parts.append(box(f"{name}_hub", (0.10, 0.10, 0.10), (x0, y0, z0 + 0.30), "metal"))
    return parts


def binoculars(name, at, yaw=0.0, posture="standing"):
    """Raised optics. Small, but it stops a spotter reading as a second rifleman
    by removing the long horizontal line a rifle draws."""
    z = POSTURE_EYE[posture] * FIGURE_H + 0.04
    x0, y0, z0 = at
    c, s = math.cos(yaw), math.sin(yaw)
    return [box(name, (0.16, 0.24, 0.12), (x0 + 0.16 * c, y0 + 0.16 * s, z0 + z), "metal")]
