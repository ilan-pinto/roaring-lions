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
ROLES = ("uniform", "webbing", "skin", "weapon", "metal", "wood", "charge")

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


def figure(prefix, at, posture="standing", yaw=0.0, helmet=True, stride=0.0):
    """One soldier, contact point at z=0 of `at`.

    `stride` drives the walk cycle: the legs split fore-and-aft by that fraction
    of a pace and the torso dips slightly. Four values around a cycle is all the
    `move` clip needs, because a leg is about three pixels at gameplay zoom and
    what actually reads is the whole silhouette shifting.

    `helmet=False` gives a cloth-wrapped head, which is how militia read as
    irregulars. It is worth being clear that this is nearly invisible in a black
    silhouette -- a helmet is two pixels. It matters in colour, and the sheets
    that need silhouette separation get it from posture and weapon axis instead.
    """
    if posture not in POSTURE_EYE:
        raise ValueError(f"{prefix}: unknown posture {posture!r}")
    x0, y0, z0 = at
    parts = []
    c, s = math.cos(yaw), math.sin(yaw)

    def place(dx, dy, dz):
        """Body-local offset to world, so a figure can face any way."""
        return (x0 + dx * c - dy * s, y0 + dx * s + dy * c, z0 + dz)

    if posture == "prone":
        # Long and low, and the one posture nothing else in the set can imitate.
        parts.append(rot_z(f"{prefix}_torso", (0.95, 0.46, 0.22), place(0.0, 0.0, 0.11), yaw, "uniform"))
        parts.append(rot_z(f"{prefix}_pack", (0.34, 0.34, 0.14), place(-0.10, 0.0, 0.29), yaw, "webbing"))
        parts.append(rot_z(f"{prefix}_legs", (0.66, 0.34, 0.18), place(-0.78, 0.0, 0.09), yaw, "uniform"))
        parts.append(box(f"{prefix}_head", (0.22, 0.22, 0.20), place(0.60, 0.0, 0.20),
                         "metal" if helmet else "uniform"))
        return parts

    if posture == "kneeling":
        hip, torso_h = 0.42, 0.62
        parts.append(rot_z(f"{prefix}_shin", (0.52, 0.24, 0.16), place(-0.16, -0.13, 0.08), yaw, "uniform"))
        parts.append(box(f"{prefix}_knee", (0.22, 0.24, 0.42), place(0.16, 0.14, 0.21), "uniform"))
    else:
        hip, torso_h = 0.86, 0.66
        # Legs split by stride. Both stay on the ground: a figure that lifts a
        # foot reads as floating once the shadow is a few pixels.
        for side, sgn in (("l", -1.0), ("r", 1.0)):
            parts.append(box(f"{prefix}_leg_{side}", (0.24, 0.22, hip),
                             place(sgn * stride * 0.30, sgn * 0.13, hip / 2.0), "uniform"))

    dip = 0.02 * abs(stride)
    chest_z = hip + torso_h / 2.0 - dip
    parts.append(rot_z(f"{prefix}_torso", (0.36, 0.52, torso_h), place(0.0, 0.0, chest_z), yaw, "uniform"))
    parts.append(rot_z(f"{prefix}_carrier", (0.42, 0.56, 0.34), place(0.0, 0.0, chest_z + 0.04), yaw, "webbing"))
    head_z = hip + torso_h + 0.13 - dip
    parts.append(box(f"{prefix}_head", (0.24, 0.24, 0.26), place(0.0, 0.0, head_z),
                     "metal" if helmet else "uniform"))
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
    parts.append(tube(name, length, 0.055,
                      (x0 + math.cos(pitch) * length * 0.5 * math.cos(yaw) * 0.0,
                       y0, z0 + math.sin(pitch) * length * 0.5 + 0.06),
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
