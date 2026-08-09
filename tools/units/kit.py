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
ROLES = ("uniform", "webbing", "boot", "face", "weapon", "metal", "wood", "charge")

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
R_SHIN, R_KNEE, R_THIGH = 0.055, 0.062, 0.078
R_WAIST, R_CHEST, R_NECK = 0.115, 0.150, 0.048
R_UPPERARM, R_FOREARM = 0.050, 0.042
HEAD_W = 0.115


def figure(prefix, at, posture="standing", yaw=0.0, helmet=True, stride=0.0,
           arms=True, leader=False):
    """One soldier, contact point at z=0 of `at`.

    Limbs and torso are tapered prisms; only genuinely boxy kit -- pouches, boots,
    knee pads, the carrier front -- stays a cuboid. Three passes to get here, and
    the reasons the first two failed are worth keeping:

      * Pass one used four cuboids and read as stacked crates.
      * Pass two added the right *parts* -- helmet dome, arms, boots, knee pads,
        drop-leg pouch -- and still read as bulky, because every one of them was
        an axis-aligned box. A box has parallel sides and four hard corners, so
        limbs came out as slabs with staircase outlines no matter what sizes they
        were given.
      * This pass changes the primitive rather than the numbers. Tapering a thigh
        from 0.078 to 0.062 and rounding it to ten sides is what makes it read as
        a leg, and the cross-sections are roughly half what they were.

    `stride` drives the walk cycle: legs split fore-and-aft, the torso dips, the
    arms counter-swing. `arms=False` is for a figure whose hands are on a
    crew-served weapon, so an arm does not float through the tube.
    """
    if posture not in POSTURE_EYE:
        raise ValueError(f"{prefix}: unknown posture {posture!r}")
    x0, y0, z0 = at
    parts = []
    c, s = math.cos(yaw), math.sin(yaw)
    H = FIGURE_H

    def place(dx, dy, dz):
        """Body-local offset to world, so a figure can face any way."""
        return (x0 + dx * c - dy * s, y0 + dx * s + dy * c, z0 + dz)

    def P(name, rb, rt, h, at_local, role="uniform", sides=10, squash=1.0):
        parts.append(prism(f"{prefix}_{name}", rb, rt, h, place(*at_local),
                           sides=sides, yaw=yaw, squash=squash, role=role))

    def B(name, size, at_local, role="uniform"):
        parts.append(rot_z(f"{prefix}_{name}", size, place(*at_local), yaw, role))

    if posture == "prone":
        # Long and low, and the one posture nothing else in the set can imitate.
        #
        # Cylinders along +x, NOT prism(): prism stands on +z, and a first attempt
        # used it here, which stood the lying body up as a scatter of vertical
        # posts. A prone figure is the one case where every part runs horizontally,
        # so the standing primitive cannot serve it.
        def C(name, length, radius, at_local, role="uniform"):
            parts.append(tube(f"{prefix}_{name}", length, radius,
                              place(*at_local), yaw=yaw, role=role))

        C("torso", 0.74, 0.125, (0.30, 0.0, 0.125))
        B("pack", (0.32, 0.32, 0.13), (0.02, 0.0, 0.255), "webbing")
        # A prone figure crawls rather than walks, and it has to read as *some*
        # movement: the prone branch used to ignore `stride` entirely, so
        # sniper_team's four `move` frames rendered byte-identical -- a manifest
        # claiming a 4-frame loop that played as a still. Opposite limbs reach
        # forward together, which is what a low crawl looks like from above.
        for sgn in (-1.0, 1.0):
            reach = sgn * stride
            C(f"leg{int(sgn)}", 0.66, 0.058, (-0.42 + reach * 0.085, sgn * 0.085, 0.075))
            B(f"boot{int(sgn)}", (0.15, 0.13, 0.10),
              (-0.80 + reach * 0.085, sgn * 0.085, 0.06), "boot")
            C(f"arm{int(sgn)}", 0.40, 0.045, (0.44 - reach * 0.075, sgn * 0.165, 0.085))
        C("neck", 0.10, R_NECK, (0.70, 0.0, 0.13))
        if helmet:
            parts.append(dome(f"{prefix}_helmet", HEAD_W, 0.15,
                              place(0.80, 0.0, 0.075), role="metal"))
            B("nvg", (0.08, 0.10, 0.055), (0.92, 0.0, 0.135), "metal")
        else:
            parts.append(dome(f"{prefix}_head", 0.098, 0.135,
                              place(0.80, 0.0, 0.075), role="uniform"))
        return parts

    # Vertical layout per posture. Kneeling compresses the legs and drops
    # everything above the belt by the same amount, so the upper body is authored
    # once.
    if posture == "kneeling":
        drop = 0.30 * H
        # Rear shin flat on the ground, forward knee up: the classic firing knee.
        # A cylinder along the ground rather than a standing prism -- prism() only
        # stands on +z, and a vertical shin is exactly what kneeling is not.
        parts.append(tube(f"{prefix}_shin_r", 0.40, 0.057,
                          place(-0.14, -0.11, 0.058), yaw=yaw, role="uniform"))
        B("boot_r", (0.16, 0.14, 0.10), (0.09, -0.11, 0.055), "boot")
        P("thigh_r", R_THIGH, R_KNEE, 0.30, (-0.13, -0.115, 0.115))
        P("shin_f", 0.058, 0.052, 0.38, (0.15, 0.125, 0.055))
        B("boot_f", (0.24, 0.14, 0.10), (0.19, 0.125, 0.05), "boot")
        B("knee_f", (0.15, 0.15, 0.10), (0.16, 0.125, 0.40), "webbing")
        P("thigh_f", R_KNEE, R_THIGH, 0.28, (0.15, 0.125, 0.44))
    else:
        drop = 0.018 * abs(stride)
        for sgn in (-1.0, 1.0):
            fore = sgn * stride
            # Boot in three parts. A single flat box read as a paving slab: a
            # boot's shape is a dark sole wider than the upper, an ankle that
            # tapers in, and a toe that runs forward of the shin.
            bx = fore * 0.26
            B(f"sole{int(sgn)}", (0.255, 0.135, 0.028), (bx, sgn * 0.115, 0.014), "boot")
            B(f"boot{int(sgn)}", (0.165, 0.125, 0.078), (bx - 0.015, sgn * 0.115, 0.067), "boot")
            B(f"toe{int(sgn)}", (0.10, 0.115, 0.048), (bx + 0.075, sgn * 0.115, 0.052), "boot")
            P(f"shin{int(sgn)}", R_SHIN, R_KNEE, (SHIN_TOP - BOOT_H) * H,
              (fore * 0.20, sgn * 0.115, BOOT_H * H), squash=0.92)
            B(f"knee{int(sgn)}", (0.145, 0.145, 0.095),
              (fore * 0.16, sgn * 0.115, KNEE_Z * H), "webbing")
            P(f"thigh{int(sgn)}", R_KNEE, R_THIGH, (THIGH_TOP - KNEE_Z) * H,
              (fore * 0.10, sgn * 0.12, KNEE_Z * H + 0.03), squash=0.92)
        # Drop-leg pouch on one thigh only, so the legs are not mirror images.
        B("dropleg", (0.125, 0.09, 0.20), (0.02, 0.215, 0.40 * H), "webbing")

    def z(frac):
        return frac * H - drop

    # Hips into a torso that tapers out to the shoulders. Two prisms rather than
    # one so the waist is genuinely the narrowest point.
    P("hips", 0.128, R_WAIST, 0.13, (0.0, 0.0, z(BELT_Z) - 0.075), squash=0.80)
    B("belt", (0.245, 0.255, 0.05), (0.0, 0.0, z(BELT_Z) + 0.055), "webbing")
    P("torso", R_WAIST, R_CHEST, 0.30, (0.0, 0.0, z(BELT_Z) + 0.055), squash=0.74)

    # Plate carrier: a shallow slab on the chest front plus three pouches. Kept
    # narrower than the chest prism so it does not restore the slab silhouette the
    # prisms were introduced to remove.
    B("carrier", (0.135, 0.255, 0.22), (0.085, 0.0, z(CHEST_Z) + 0.035))
    for k, py in enumerate((-0.088, 0.0, 0.088)):
        B(f"pouch{k}", (0.10, 0.075, 0.095), (0.155, py, z(CHEST_Z) + 0.005), "webbing")

    # Personal equipment. Each of these is one or two pixels at gameplay zoom and
    # none of them is load-bearing for silhouette separation -- they are here
    # because the figure reads as issued kit rather than a mannequin when you look
    # closely, which is where the eye goes first at any zoom above 1x.
    B("admin", (0.075, 0.135, 0.10), (0.14, 0.0, z(CHEST_Z) + 0.135), "webbing")
    B("dump", (0.105, 0.085, 0.135), (-0.10, -0.155, z(BELT_Z) + 0.03), "webbing")
    P("canteen", 0.048, 0.044, 0.125, (-0.135, 0.075, z(BELT_Z) - 0.02), "webbing", sides=8)
    # Holster on the thigh opposite the drop-leg pouch, so the two legs carry
    # different kit and the figure is not mirror-symmetric.
    B("holster", (0.082, 0.058, 0.155), (0.03, -0.215, 0.40 * H - drop), "webbing")

    # Shoulders as a squashed prism, so the arms grow out of a curve.
    P("shoulders", R_CHEST, 0.128, 0.085, (0.0, 0.0, z(SHOULDER_Z) - 0.055), squash=0.72)

    # Arms clear of the torso, counter-swinging on the walk. Tapered and thin:
    # this is the pair of parts that most made the old figure look armoured.
    if arms:
        for sgn in (-1.0, 1.0):
            swing = -sgn * stride
            ay = sgn * (R_CHEST + R_UPPERARM + 0.012)
            P(f"upperarm{int(sgn)}", R_UPPERARM, R_UPPERARM * 0.86, 0.24,
              (swing * 0.08, ay, z(SHOULDER_Z) - 0.26), squash=0.94)
            P(f"forearm{int(sgn)}", R_FOREARM * 0.92, R_FOREARM, 0.22,
              (swing * 0.16, ay + sgn * 0.004, z(SHOULDER_Z) - 0.47), squash=0.94)
            # Elbow pad, then a cuff and a fist. One box for a hand read as a
            # stump; a wrist cuff is what makes the hand a separate thing from
            # the forearm.
            B(f"elbow{int(sgn)}", (0.098, 0.092, 0.062),
              (swing * 0.13, ay + sgn * 0.006, z(SHOULDER_Z) - 0.275), "webbing")
            P(f"cuff{int(sgn)}", R_FOREARM * 1.18, R_FOREARM * 1.05, 0.045,
              (swing * 0.19, ay + sgn * 0.008, z(SHOULDER_Z) - 0.585), "webbing")
            B(f"fist{int(sgn)}", (0.088, 0.078, 0.078),
              (swing * 0.21, ay + sgn * 0.010, z(SHOULDER_Z) - 0.585), "webbing")
            # Shoulder pad, sitting on the deltoid where the carrier strap ends.
            B(f"pad{int(sgn)}", (0.125, 0.098, 0.055),
              (0.0, ay * 0.92, z(SHOULDER_Z) - 0.075), "webbing")

    # Radio antenna, on the team leader only. The one piece of added kit that is
    # visible at gameplay zoom -- a thin vertical line above the shoulders, which
    # is why it goes on exactly one figure per team rather than all of them: on
    # every figure it would read as a picket fence, and it would compete with the
    # mortar tube that separates two of the nine sheets.
    if leader:
        parts.append(tube(f"{prefix}_antenna", 0.46, 0.009,
                          place(-0.11, -0.10, z(SHOULDER_Z) + 0.16),
                          yaw=yaw, pitch=math.radians(84.0), sides=6, role="metal"))

    # Neck, then the head. The neck is two pixels and does all the work of
    # separating the helmet dome from the shoulders.
    P("neck", R_NECK, R_NECK * 0.92, 0.075, (0.0, 0.0, z(HEAD_Z) - 0.115), sides=8)
    if helmet:
        parts.append(dome(f"{prefix}_helmet", HEAD_W, 0.165,
                          place(0.0, 0.0, z(HEAD_Z) - 0.055), role="metal"))
        # NVG mount stub on the brow: a small forward break in the head outline,
        # which is the one piece of helmet detail large enough to read.
        B("nvg", (0.085, 0.10, 0.06), (0.105, 0.0, z(HEAD_Z) + 0.045), "metal")
        # Helmet cover rim, goggles band across the brow, chin strap under the jaw.
        P("rim", HEAD_W * 1.06, HEAD_W * 1.02, 0.022,
          (0.0, 0.0, z(HEAD_Z) - 0.058), "webbing")
        B("goggles", (0.055, 0.195, 0.042), (0.075, 0.0, z(HEAD_Z) - 0.012), "metal")
        # Balaclava, not a bare face. Two reasons and the second is the real one:
        # the reference figure is fully covered, and a `skin` tone quantized into
        # *terracotta* -- bright orange-red specks on the hands and face that read
        # as blood spatter, worst on the dust-ramp enemy. No skin is exposed
        # anywhere on the figure now, which removed the band entirely.
        B("jaw", (0.10, 0.115, 0.075), (0.035, 0.0, z(HEAD_Z) - 0.07), "face")
        B("chinstrap", (0.09, 0.145, 0.022), (0.02, 0.0, z(HEAD_Z) - 0.105), "webbing")
    else:
        # Cloth-wrapped head: a dome in the uniform tone, sitting lower with no
        # NVG stub. Barely a silhouette cue at 25 px -- it earns its keep in
        # colour, and outline separation comes from posture and weapon axis.
        parts.append(dome(f"{prefix}_head", 0.098, 0.145,
                          place(0.0, 0.0, z(HEAD_Z) - 0.055), role="uniform"))
        B("face", (0.055, 0.095, 0.075), (0.075, 0.0, z(HEAD_Z) - 0.015), "face")
    return parts


# --- weapons ---------------------------------------------------------------


def rifle(name, at, yaw=0.0, posture="standing"):
    """A rifle held across the chest. The default weapon, and the baseline the
    other silhouettes have to differ from."""
    z = POSTURE_EYE[posture] * FIGURE_H - 0.16
    x0, y0, z0 = at
    c, s = math.cos(yaw), math.sin(yaw)
    return [tube(name, 0.78, 0.045, (x0 + 0.16 * c, y0 + 0.16 * s, z0 + z), yaw=yaw, role="weapon")]


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
