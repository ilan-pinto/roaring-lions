"""Parts every Roaring Lions building is assembled from.

The point of a kit rather than a parametric generator. A throwaway prototype
generated six types as one shape scaled six ways, and measured pairwise
silhouette IoU put concrete/warehouse at 0.950, apartment/mosque at 0.920 and
house/concrete at 0.895 -- all past the art gate's 0.88 limit. A generator buys
consistency for free and distinctness not at all, and distinctness is the
requirement: flattening a mosque costs 30 ROE points and a warehouse 3, so a
player who cannot tell them apart cannot make that decision.

This inverts it. Consistency is structural, because every parapet in the game is
one function call. Distinctness stays authored per type, in the author_*.py
scripts that compose these parts.

Two rules that are easy to get wrong:

  * **Real vertex coordinates, object scale always 1.** The brick shader in
    render_building.py projects triplanar from *Object* texture coordinates, so a
    part carrying an object-level scale would get stretched coursing. Every part
    here builds its geometry with `from_pydata` at final size. Nothing calls
    `obj.scale`.

  * **Every part declares `rl_role`.** render_building.py assigns materials from
    it -- `wall`, `roof`, `trim`, `dome`, `wood`, `glass`, `metal`, `rust`. A part with no
    role falls back to a name heuristic meant for hand-modelled sources, which is
    not what a kit part wants.

World scale is `dimetric.UNITS_PER_TILE` -- 3.0 units per map tile, about a
metre per unit, so a storey is about 3.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dimetric import UNITS_PER_TILE  # noqa: E402

ROLES = ("wall", "roof", "trim", "dome", "wood", "glass", "metal", "rust")


def new_scene():
    """An empty file. Author scripts start from nothing, every time."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def save(path):
    """Write the .blend. Building sources are tracked in plain git."""
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


def box(name, size, at, role="wall"):
    """A cuboid. `size` is (sx, sy, sz); `at` is its centre."""
    sx, sy, sz = (s / 2.0 for s in size)
    cx, cy, cz = at
    v = [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return _mesh(name, v, f, role)


def wedge(name, size, at, role="metal", axis="y", flip=False):
    """A triangular prism: a mono-pitch roof, or a merlon tooth.

    Rises along +z across `axis`. `size` is (sx, sy, sz), `at` is the centre of
    its base rectangle.
    """
    sx, sy, sz = size[0] / 2.0, size[1] / 2.0, size[2]
    cx, cy, cz = at
    lo, hi = (sy, -sy) if flip else (-sy, sy)
    if axis == "y":
        v = [
            (cx - sx, cy + lo, cz), (cx + sx, cy + lo, cz),
            (cx + sx, cy + hi, cz), (cx - sx, cy + hi, cz),
            (cx - sx, cy + hi, cz + sz), (cx + sx, cy + hi, cz + sz),
        ]
    else:
        v = [
            (cx + lo, cy - sy, cz), (cx + lo, cy + sy, cz),
            (cx + hi, cy + sy, cz), (cx + hi, cy - sy, cz),
            (cx + hi, cy - sy, cz + sz), (cx + hi, cy + sy, cz + sz),
        ]
    f = [(0, 1, 2, 3), (3, 2, 5, 4), (0, 4, 5, 1), (0, 3, 4), (1, 5, 2)]
    return _mesh(name, v, f, role)


def cylinder(name, radius, height, at, role="wall", segments=16, taper=1.0):
    """An upright cylinder or truncated cone. `at` is the centre of its base."""
    cx, cy, cz = at
    v, f = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        v.append((cx + radius * math.cos(a), cy + radius * math.sin(a), cz))
    for i in range(segments):
        a = 2 * math.pi * i / segments
        r = radius * taper
        v.append((cx + r * math.cos(a), cy + r * math.sin(a), cz + height))
    for i in range(segments):
        j = (i + 1) % segments
        f.append((i, j, segments + j, segments + i))
    f.append(tuple(range(segments - 1, -1, -1)))
    f.append(tuple(range(segments, 2 * segments)))
    return _mesh(name, v, f, role)


def dome(name, radius, height, at, role="dome", segments=16, rings=6):
    """A hemispherical dome on a ring. `at` is the centre of its base."""
    cx, cy, cz = at
    v, f = [], []
    for r in range(rings):
        phi = (math.pi / 2) * r / rings
        rr = radius * math.cos(phi)
        zz = cz + height * math.sin(phi)
        for i in range(segments):
            a = 2 * math.pi * i / segments
            v.append((cx + rr * math.cos(a), cy + rr * math.sin(a), zz))
    apex = len(v)
    v.append((cx, cy, cz + height))
    for r in range(rings - 1):
        for i in range(segments):
            j = (i + 1) % segments
            f.append((r * segments + i, r * segments + j, (r + 1) * segments + j, (r + 1) * segments + i))
    last = (rings - 1) * segments
    for i in range(segments):
        f.append((last + i, last + (i + 1) % segments, apex))
    return _mesh(name, v, f, role)


def ring(name, outer, height, thickness, at_z, role="wall", centre=(0.0, 0.0)):
    """Four walls enclosing a rectangle -- a parapet, or a projecting trim band.

    A solid slab would be simpler and wrong: it would cap the roof and hide
    whatever sits inside. `outer` is (x, y) of the outer face, `at_z` is the
    BOTTOM of the ring.
    """
    ox, oy = outer
    cx, cy = centre
    t = thickness
    z = at_z + height / 2.0
    parts = [
        box(f"{name}_S", (ox, t, height), (cx, cy - oy / 2 + t / 2, z), role),
        box(f"{name}_N", (ox, t, height), (cx, cy + oy / 2 - t / 2, z), role),
        box(f"{name}_W", (t, oy - 2 * t, height), (cx - ox / 2 + t / 2, cy, z), role),
        box(f"{name}_E", (t, oy - 2 * t, height), (cx + ox / 2 - t / 2, cy, z), role),
    ]
    return parts


def trim_band(name, outer, at_z, height=0.30, overhang=0.22, role="trim", centre=(0.0, 0.0)):
    """The projecting course under a coping. Present on every building in the
    reference, and the reason the palette grew a terracotta ramp."""
    ox, oy = outer
    return ring(
        name,
        (ox + 2 * overhang, oy + 2 * overhang),
        height,
        overhang + 0.18,
        at_z,
        role,
        centre,
    )


def merlon_row(name, start, end, at_z, count, size=0.5, shape="square", role="wall"):
    """Teeth along the top of a parapet.

    `shape` is "square" or "triangle" -- the two the reference uses, and one of
    the few cheap ways to make two flat-roofed buildings read differently.
    """
    (x0, y0), (x1, y1) = start, end
    out = []
    for i in range(count):
        t = (i + 0.5) / count
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        if shape == "square":
            out.append(box(f"{name}_{i}", (size, size, size), (x, y, at_z + size / 2), role))
        elif shape == "triangle":
            axis = "y" if abs(x1 - x0) < abs(y1 - y0) else "x"
            out.append(
                wedge(f"{name}_{i}", (size, size, size * 1.4), (x, y, at_z), role, axis=axis)
            )
        else:
            raise ValueError(f"{name}: shape must be square or triangle, got {shape!r}")
    return out


def zigzag_frieze(name, start, end, at_z, count, size=0.34, depth=0.14, role="trim"):
    """A sawtooth band, as diamonds set into a wall face.

    Rotating a box 45 degrees about the wall normal is what makes the zigzag, and
    at these sizes the diamonds read as the band the reference paints under its
    copings.
    """
    (x0, y0), (x1, y1) = start, end
    horizontal = abs(x1 - x0) >= abs(y1 - y0)
    h = size / math.sqrt(2)
    out = []
    for i in range(count):
        t = (i + 0.5) / count
        cx = x0 + (x1 - x0) * t
        cy = y0 + (y1 - y0) * t
        if horizontal:
            v = [
                (cx - h, cy - depth / 2, at_z), (cx, cy - depth / 2, at_z + h),
                (cx + h, cy - depth / 2, at_z), (cx, cy - depth / 2, at_z - h),
                (cx - h, cy + depth / 2, at_z), (cx, cy + depth / 2, at_z + h),
                (cx + h, cy + depth / 2, at_z), (cx, cy + depth / 2, at_z - h),
            ]
        else:
            v = [
                (cx - depth / 2, cy - h, at_z), (cx - depth / 2, cy, at_z + h),
                (cx - depth / 2, cy + h, at_z), (cx - depth / 2, cy, at_z - h),
                (cx + depth / 2, cy - h, at_z), (cx + depth / 2, cy, at_z + h),
                (cx + depth / 2, cy + h, at_z), (cx + depth / 2, cy, at_z - h),
            ]
        f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        out.append(_mesh(f"{name}_{i}", v, f, role))
    return out


def arch_opening(name, width, height, at, face="S", role="glass", depth=0.16):
    """A pointed-arch door or window, as a recessed panel with a stepped head.

    Modelled as depth rather than a texture: at 230px on screen a recess reads
    and a painted arch does not, and the palette's `shadow.0` makes the opening
    read as depth.
    """
    cx, cy, cz = at
    out = []
    shaft = height * 0.68
    if face in ("S", "N"):
        sgn = -1 if face == "S" else 1
        y = cy + sgn * depth / 2
        out.append(box(f"{name}_shaft", (width, depth, shaft), (cx, y, cz + shaft / 2), role))
        steps = 3
        for i in range(steps):
            w = width * (1.0 - (i + 1) / (steps + 1.0))
            h = (height - shaft) / steps
            out.append(
                box(f"{name}_head{i}", (w, depth, h), (cx, y, cz + shaft + h * (i + 0.5)), role)
            )
    else:
        sgn = -1 if face == "W" else 1
        x = cx + sgn * depth / 2
        out.append(box(f"{name}_shaft", (depth, width, shaft), (x, cy, cz + shaft / 2), role))
        steps = 3
        for i in range(steps):
            w = width * (1.0 - (i + 1) / (steps + 1.0))
            h = (height - shaft) / steps
            out.append(
                box(f"{name}_head{i}", (depth, w, h), (x, cy, cz + shaft + h * (i + 0.5)), role)
            )
    return out


def window_row(name, start, end, at_z, count, size=(0.55, 1.15), face="S", role="glass"):
    """Evenly spaced rectangular openings along a wall."""
    (x0, y0), (x1, y1) = start, end
    w, h = size
    depth = 0.14
    out = []
    for i in range(count):
        t = (i + 0.5) / count
        cx = x0 + (x1 - x0) * t
        cy = y0 + (y1 - y0) * t
        if face in ("S", "N"):
            out.append(box(f"{name}_{i}", (w, depth, h), (cx, cy, at_z + h / 2), role))
        else:
            out.append(box(f"{name}_{i}", (depth, w, h), (cx, cy, at_z + h / 2), role))
    return out


def external_stair(name, foot, head, rise, width=1.25, steps=10, role="wall"):
    """An open stair to the roof, climbing *along* a wall.

    One of the few features that reliably breaks a boxy outline at gameplay zoom,
    which is why the previous spec listed it first among things to look for.

    `foot` and `head` are (x, y) in plan, so the run is parallel to the face and
    the stair projects from it only by `width`. An earlier version took a single
    point and a compass face and ran the treads *outward*: ten steps to a 5.9-unit
    roof projected 6.8 units, over two tiles of stair, and pushed the house's
    render extent from 11.1 to 18.6. Vernacular stairs hug the wall.

    Masonry by default, not timber. These stairs are integral with the building,
    and the coursed brick makes the stepped profile read; timber on the shadowed
    west wall rendered as one dark wedge.

    A sloped handrail was tried and removed. At 0.14 units it came out as a 2px
    near-black diagonal that read as a scratch across the wall rather than a rail,
    and it needed posts at the foot to look supported. The steps are legible on
    their own; the rail was polish pretending to be legibility.
    """
    (x0, y0), (x1, y1) = foot, head
    dx, dy = x1 - x0, y1 - y0
    along_x = abs(dx) >= abs(dy)
    seg = (abs(dx) if along_x else abs(dy)) / steps
    out = []
    for i in range(steps):
        h = rise * (i + 1) / steps
        t = (i + 0.5) / steps
        cx = x0 + dx * t
        cy = y0 + dy * t
        size = (seg, width, h) if along_x else (width, seg, h)
        out.append(box(f"{name}_{i}", size, (cx, cy, h / 2), role))
    return out


def stilted_balcony(name, size, at, post_height, role="wood", posts=4):
    """A balcony carried on posts, as in the reference's two-storey house.

    `at` is the centre of the deck's underside.
    """
    sx, sy = size
    cx, cy, cz = at
    out = [box(f"{name}_deck", (sx, sy, 0.22), (cx, cy, cz + 0.11), role)]
    px = sx / 2 - 0.18
    py = sy / 2 - 0.18
    corners = [(-px, -py), (px, -py), (px, py), (-px, py)][:posts]
    for i, (dx, dy) in enumerate(corners):
        out.append(
            box(f"{name}_post{i}", (0.20, 0.20, post_height), (cx + dx, cy + dy, cz - post_height / 2), role)
        )
    out += ring(f"{name}_rail", (sx, sy), 0.60, 0.12, cz + 0.22, role, centre=(cx, cy))
    return out


def mashrabiya(name, size, at, role="wood", bars=5):
    """A projecting latticed bay window -- the house's signature.

    The lattice is real geometry rather than a texture: it is the difference
    between a bay reading as a bay and reading as a lump.
    """
    sx, sy, sz = size
    cx, cy, cz = at
    out = [
        box(f"{name}_floor", (sx, sy, 0.16), (cx, cy, cz + 0.08), role),
        box(f"{name}_roof", (sx + 0.14, sy + 0.14, 0.18), (cx, cy, cz + sz - 0.09), role),
        box(f"{name}_back", (sx, 0.12, sz), (cx, cy + sy / 2 - 0.06, cz + sz / 2), role),
        box(f"{name}_side_W", (0.14, sy, sz), (cx - sx / 2 + 0.07, cy, cz + sz / 2), role),
        box(f"{name}_side_E", (0.14, sy, sz), (cx + sx / 2 - 0.07, cy, cz + sz / 2), role),
    ]
    for i in range(bars):
        t = (i + 0.5) / bars
        out.append(
            box(
                f"{name}_bar{i}",
                (0.09, 0.09, sz - 0.5),
                (cx - sx / 2 + sx * t, cy - sy / 2 + 0.05, cz + sz / 2),
                role,
            )
        )
    return out


def roof_deck(name, size, at_z, role="roof", centre=(0.0, 0.0), inset=0.0):
    """The roof surface, as its own object.

    This exists because of a measured failure: the mosque's roof is the top face
    of a wall cube, so it takes the wall material, and the 55-degree key blows it
    out -- 16.2% of that sprite is bare limestone.0. A separate deck can sit on a
    darker tone and read as a surface.
    """
    sx, sy = size
    cx, cy = centre
    return box(name, (sx - 2 * inset, sy - 2 * inset, 0.18), (cx, cy, at_z + 0.09), role)


def cornice(name, outer, at_z, height=0.65, overhang=0.55, role="roof", centre=(0.0, 0.0)):
    """A heavy overhanging slab, unlike a parapet in silhouette.

    A solid slab is right here: it caps the building, which is the point -- it
    gives the concrete structure a T-shaped top nothing else in the set has.
    """
    ox, oy = outer
    cx, cy = centre
    return box(
        name, (ox + 2 * overhang, oy + 2 * overhang, height), (cx, cy, at_z + height / 2), role
    )


def roller_door(name, size, at, face="S", role="metal"):
    """A vehicle door, with a lintel. The warehouse's identifying feature."""
    w, h = size
    cx, cy, cz = at
    depth = 0.22
    if face in ("S", "N"):
        return [
            box(f"{name}_leaf", (w, depth, h), (cx, cy, cz + h / 2), role),
            box(f"{name}_lintel", (w + 0.5, depth + 0.1, 0.34), (cx, cy, cz + h + 0.17), "trim"),
        ]
    return [
        box(f"{name}_leaf", (depth, w, h), (cx, cy, cz + h / 2), role),
        box(f"{name}_lintel", (depth + 0.1, w + 0.5, 0.34), (cx, cy, cz + h + 0.17), "trim"),
    ]


def roof_tank(name, at, radius=0.55, height=1.05, role="metal"):
    """A rooftop water tank on a low frame. Roof clutter is silhouette."""
    cx, cy, cz = at
    return [
        box(f"{name}_frame", (radius * 1.7, radius * 1.7, 0.32), (cx, cy, cz + 0.16), role),
        cylinder(f"{name}_drum", radius, height, (cx, cy, cz + 0.32), role),
    ]


def ventilator(name, at, radius=0.34, role="metal"):
    """A ridge ventilator: a stub and a cap."""
    cx, cy, cz = at
    return [
        cylinder(f"{name}_stub", radius, 0.42, (cx, cy, cz), role),
        cylinder(f"{name}_cap", radius * 1.5, 0.16, (cx, cy, cz + 0.42), role),
    ]


def oil_drum(name, at, role="metal", radius=0.34, height=0.9):
    """A drum. The shanty's yard clutter, and it breaks the outline."""
    return cylinder(name, radius, height, at, role)


def sandbag_row(name, start, end, at_z, count, role="wall", size=(0.62, 0.42, 0.26)):
    """A revetment along a wall base: two courses, offset."""
    (x0, y0), (x1, y1) = start, end
    sx, sy, sz = size
    out = []
    for course in range(2):
        n = count if course == 0 else count - 1
        for i in range(n):
            t = (i + 0.5) / n
            cx = x0 + (x1 - x0) * t
            cy = y0 + (y1 - y0) * t
            out.append(
                box(f"{name}_{course}_{i}", (sx, sy, sz), (cx, cy, at_z + sz * (course + 0.5)), role)
            )
    return out
