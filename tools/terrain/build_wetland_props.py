"""The wetland's two Blender props, `round_bale` and `culvert_pipe` (GH-871 P3).
Procedural, 0 Meshy credits.

    blender -b --factory-startup -P tools/terrain/build_wetland_props.py -- \\
        --blend-dir art/src/terrain/wetland [--report out.json]

or, for the counts alone, in plain Python:

    python3 tools/terrain/build_wetland_props.py

The numbers are the lead's, approved 28 Oct (`art-numbers.md` rows 6 and 7,
spec 2.4):

  * `round_bale`: a wrapped silage bale, 1.1 m across by 1.0 m high (0.85 of a
    real 1.3 x 1.2 m bale, the wrecked-car precedent), standing on its end. One
    `rubber` node (`gunmetal.3`, the commonest black wrap), at most 160 triangles.
  * `culvert_pipe`: a culvert MOUTH at the verge, a headwall 1.6 m wide x 1.0 m
    tall x 0.25 m thick and a pipe stub 0.8 m across x 0.6 m long with a 0.65 m
    bore. One `concrete` node, at most 140 triangles. Its mouth faces +X, the
    same convention every directional prop in `props.py` uses.

Props ship zero materials and are coloured at load from their role. They are
not scale-rolled and not destructible, so there is no wreck twin.

## Why a separate file and not `props.py`

`props.py` is the documented Blender-only FALLBACK for the shipped seven kinds
(its own docstring says it stays unmodified), and adding two kinds to its
`PROP_KINDS` would put them in its `main()` export into `art/meshes/props/`.
This round exports nothing, so the two builders live here and reuse the same
conventions (metres, Z up, origin at the footprint centre on the ground, +X the
long axis). Folding them into `PROP_KINDS` is the export commit's job.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from wetland_kit import TriSoup  # noqa: E402

CAPS = {"round_bale": 160, "culvert_pipe": 140}


def build_round_bale():
    """A 20-segment standing cylinder: a slight belly (the wrap swells the
    middle), rolled shoulders and a gently domed top. 20 x (3 bands x 2) + a
    20-triangle top fan = 140 triangles; the 20 left under the cap are unspent."""
    soup = TriSoup()
    profile = [
        (0.525, 0.000),  # the foot, on the ground
        (0.550, 0.500),  # the belly
        (0.535, 0.930),  # the shoulder
        (0.455, 1.000),  # the rolled edge of the top
        (0.000, 1.018),  # the crown of the top (a wrap sags a hair domed)
    ]
    soup.lathe(profile, 20)
    return {"rubber": soup}


def _strip_between(soup, inner, outer, toward):
    """Triangulate the annulus between two closed polygons that wind the same
    way about the same centre, given as lists of (angle, vertex index) sorted by
    angle. A two-pointer strip: always advance the side whose next vertex is
    nearer in angle. `len(inner) + len(outer)` triangles."""
    n, m = len(inner), len(outer)
    i = j = 0
    twopi = 2.0 * math.pi
    while i < n or j < m:
        ai = inner[(i + 1) % n][0] + (twopi if i + 1 >= n else 0.0)
        bj = outer[(j + 1) % m][0] + (twopi if j + 1 >= m else 0.0)
        if i >= n:
            adv_inner = False
        elif j >= m:
            adv_inner = True
        else:
            adv_inner = ai <= bj
        if adv_inner:
            soup.tri_facing(inner[i % n][1], inner[(i + 1) % n][1], outer[j % m][1], toward)
            i += 1
        else:
            soup.tri_facing(inner[i % n][1], outer[(j + 1) % m][1], outer[j % m][1], toward)
            j += 1


def build_culvert_pipe():
    """A headwall with a pipe stub and a dark bore, mouth toward +X. See the
    module docstring for the dimensions; the triangle accounting is:
    front face with the pipe's hole 28, back 2, ends 4, coping 10, pipe wall 24,
    end ring 24, bore 24, bore back 12, apron 10 = 138."""
    soup = TriSoup()
    seg = 12
    cy, cz = 0.0, 0.43  # the pipe's axis, in (y, z)
    r_out, r_bore = 0.40, 0.325
    half_w, wall_top, coping_top = 0.80, 0.92, 1.00
    x_front, x_back, x_end = 0.0, -0.25, 0.60

    # -- the headwall: front face (with the pipe's hole), back, two ends ---------
    inner = []  # the hole's polygon, as (angle, vertex)
    for k in range(seg):
        a = 2.0 * math.pi * (k + 0.5) / seg
        inner.append((a, soup.vert((x_front, cy + r_out * math.cos(a), cz + r_out * math.sin(a)))))
    outer = []  # the rectangle's outline, corners included, as (angle, vertex)
    corners = [(half_w, wall_top), (-half_w, wall_top), (-half_w, 0.0), (half_w, 0.0)]
    pts = []
    for k in range(seg):
        a = 2.0 * math.pi * (k + 0.5) / seg
        dy, dz = math.cos(a), math.sin(a)
        # Ray from the axis to the rectangle's outline.
        t = min(
            (half_w - cy) / dy if dy > 1e-9 else (-half_w - cy) / dy if dy < -1e-9 else 1e9,
            (wall_top - cz) / dz if dz > 1e-9 else (0.0 - cz) / dz if dz < -1e-9 else 1e9,
        )
        pts.append((a, (cy + t * dy, cz + t * dz)))
    for (y, z) in corners:
        pts.append((math.atan2(z - cz, y - cy) % (2.0 * math.pi), (y, z)))
    pts.sort(key=lambda p: p[0])
    for a, (y, z) in pts:
        outer.append((a, soup.vert((x_front, y, z))))
    _strip_between(soup, inner, outer, (1.0, 0.0, 0.0))
    soup.box((x_back, -half_w, 0.0), (x_front, half_w, wall_top), skip=("+x", "+z", "-z", "-x"))  # the two ends
    # back face, on its own so the bore's back disc sits proud of it
    b = [soup.vert((x_back, -half_w, 0.0)), soup.vert((x_back, half_w, 0.0)), soup.vert((x_back, half_w, wall_top)), soup.vert((x_back, -half_w, wall_top))]
    soup.quad_facing(b[0], b[1], b[2], b[3], (-1.0, 0.0, 0.0))

    # -- the coping: a slab over the top of the wall, a little proud --------------
    soup.box((x_back - 0.05, -half_w - 0.05, wall_top), (x_front + 0.05, half_w + 0.05, coping_top), skip=("-z",))

    # -- the pipe stub: wall, end ring, bore, bore back ---------------------------
    def ring(x, r, phase=0.0):
        return [
            soup.vert((x, cy + r * math.cos(2 * math.pi * s / seg + phase), cz + r * math.sin(2 * math.pi * s / seg + phase)))
            for s in range(seg)
        ]

    ro0, ro1 = ring(x_front, r_out), ring(x_end, r_out)
    # The bore stops 2 cm inside the wall, so its back disc is never coplanar with the
    # wall's back face (a coplanar pair z-fights, and the culled one shows the bore through).
    x_stop = x_back + 0.02
    ri1, ri0 = ring(x_end, r_bore), ring(x_stop, r_bore)
    axis_pt = (0.0, cy, cz)
    for s in range(seg):
        n = (s + 1) % seg
        # outer wall of the stub faces away from the axis
        soup.tri_out(ro0[s], ro0[n], ro1[n], (x_end / 2, cy, cz))
        soup.tri_out(ro0[s], ro1[n], ro1[s], (x_end / 2, cy, cz))
        # the end ring faces +X
        soup.tri_facing(ro1[s], ro1[n], ri1[n], (1.0, 0.0, 0.0))
        soup.tri_facing(ro1[s], ri1[n], ri1[s], (1.0, 0.0, 0.0))
        # the bore's inner wall faces the axis (toward the middle of the hole)
        soup.tri_facing(ri1[s], ri1[n], ri0[n], _toward_axis(soup, ri1[s], ri1[n], ri0[n], axis_pt))
        soup.tri_facing(ri1[s], ri0[n], ri0[s], _toward_axis(soup, ri1[s], ri0[n], ri0[s], axis_pt))
    # the bore's back disc (a fan), facing +X into the hole
    centre = soup.vert((x_stop, cy, cz))
    for s in range(seg):
        soup.tri_facing(centre, ri0[s], ri0[(s + 1) % seg], (1.0, 0.0, 0.0))

    # -- the apron: a low slab under the mouth, so the wall sits on something -----
    soup.box((x_back - 0.12, -half_w - 0.05, 0.0), (x_end + 0.12, half_w + 0.05, 0.03), skip=("-z",))

    # Recentre on the footprint so the origin is the footprint centre on the ground.
    (lx, ly, _), (hx, hy, _) = soup.bounds()
    cx, cyy = (lx + hx) / 2.0, (ly + hy) / 2.0
    soup.verts = [(x - cx, y - cyy, z) for x, y, z in soup.verts]
    return {"concrete": soup}


def _toward_axis(soup, a, b, c, axis_pt):
    """The direction from triangle (a, b, c)'s centre toward the pipe's axis,
    flattened onto the pipe's cross-section: a face of the bore looks at it."""
    pa, pb, pc = soup.verts[a], soup.verts[b], soup.verts[c]
    centre = ((pa[0] + pb[0] + pc[0]) / 3.0, (pa[1] + pb[1] + pc[1]) / 3.0, (pa[2] + pb[2] + pc[2]) / 3.0)
    return (0.0, axis_pt[1] - centre[1], axis_pt[2] - centre[2])


BUILDERS = {"round_bale": build_round_bale, "culvert_pipe": build_culvert_pipe}


def build(kind):
    roles = BUILDERS[kind]()
    total = sum(s.count for s in roles.values())
    assert total <= CAPS[kind], f"{kind}: {total} triangles, cap {CAPS[kind]}"
    return roles


def measure(roles):
    both = TriSoup()
    for s in roles.values():
        both.merge(s)
    (x0, y0, z0), (x1, y1, z1) = both.bounds()
    return {
        "tris": both.count,
        "roles": {r: s.count for r, s in roles.items()},
        "extent_x_m": x1 - x0,
        "extent_y_m": y1 - y0,
        "height_m": z1,
        "lowest_z_m": z0,
    }


def main():
    import argparse

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend-dir", default=None)
    ap.add_argument("--report", default=None)
    args = ap.parse_args(argv)

    report = {}
    for kind in BUILDERS:
        roles = build(kind)
        m = measure(roles)
        report[kind] = m
        print(
            f"{kind}: {m['tris']} tris (cap {CAPS[kind]}), {m['extent_x_m']:.3f} x {m['extent_y_m']:.3f} m footprint, "
            f"{m['height_m']:.3f} m tall, lowest z {m['lowest_z_m']:+.4f}"
        )
        if args.blend_dir:
            save_blend(kind, roles, args.blend_dir)
    if args.report:
        with open(args.report, "w") as fh:
            json.dump(report, fh, indent=2)


def save_blend(kind, roles, out_dir):
    import bpy
    from wetland_kit import to_object

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for role, soup in roles.items():
        ob = to_object(role, soup, sharp_degrees=35.0)
        ob["rl_role"] = role
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{kind}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
