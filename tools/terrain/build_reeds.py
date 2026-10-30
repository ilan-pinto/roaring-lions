"""The wetland reeds, `reed_0/1/2` (GH-871 P3): two common-reed (*Phragmites*)
clumps and one bulrush (*Typha*) clump, procedural, at 0 Meshy credits.

    blender -b --factory-startup -P tools/terrain/build_reeds.py -- \\
        --blend-dir art/src/terrain/wetland [--report out.json]

or, for the counts alone, in plain Python (no Blender needed):

    python3 tools/terrain/build_reeds.py

The numbers are the lead's, approved 28 Oct (`art-numbers.md` rows 4 and 2.4):

  * model height 1.25 / 1.10 / 1.00 m, so the DRAWN height is at most 1.5 m after
    the placement pass's 0.8-1.2 scale roll;
  * a clump footprint of about 2.5 m (0.8 tile), 1.25 m radius;
  * at most 400 triangles a clump;
  * roles: `foliage` carries the straw culms, the drooping leaf blades and the
    plumes or spikes (`reed:foliage` is tinted `dust.5`); `trunk` carries the
    green new shoots at the base, the flush (`reed:trunk` is tinted `scrub.1`).

## The geometry, and why it is made of cones

Every stem and blade is a thin three-sided cone (3 triangles, `wetland_kit.py`
explains why a card would vanish under the decor material's `FrontSide`). The
art-numbers sheet planned 2-triangle culms; a closed culm is 3, so the clump
spends its 400 differently: 30 culms, 60 to 66 leaf blades, 10 to 12 plumes and
12 to 14 shoots instead of the sheet's richer counts. The counts are printed by
the builder and held under the cap by an assertion.

A common-reed clump is laid out as seven BUNCHES, one in the middle and six
around it, because a real reed bed grows in tufts with gaps between them; the
culms of a bunch lean away from the clump's centre, more the farther out they
stand, so the clump has a dome and a ragged skirt rather than a lawn of spikes.
Leaf blades hang from the culm at 40-80% of its height, some drooping (the
straw flags of a winter bed), some held up. The tallest culms carry a plume that
droops outward. Bulrush is stiffer: arching strap leaves from the base, and a
few tall stalks topped by a brown spike.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from wetland_kit import (  # noqa: E402
    Stream,
    TriSoup,
    dir_from,
    fbm2,
    v_add,
    v_mul,
    v_norm,
    v_sub,
)

CAP = 400
FOOTPRINT_RADIUS = 1.25  # a 2.5 m clump

VARIANTS = {
    0: dict(kind="phragmites", H=1.25, seed=7101, bunches=6, culms=24, blades=112, hang=64, plumes=10, shoots=16),
    1: dict(kind="phragmites", H=1.10, seed=7211, bunches=6, culms=26, blades=116, hang=68, plumes=8, shoots=16),
    2: dict(kind="typha", H=1.00, seed=7321, bunches=6, leaves=40, stalks=10, shoots=16),
}


RMAX = 1.26  # nothing reaches past the 2.5 m footprint by more than a hair


def _fit_length(at, d, length, zmax=None, zmin=0.02):
    """Shorten a straight stem of `length` from `at` along `d` so its end stays
    above the ground, under `zmax` if given, and inside the footprint."""
    for _ in range(40):
        end = v_add(at, v_mul(d, length))
        ok = end[2] >= zmin and math.hypot(end[0], end[1]) <= RMAX and (zmax is None or end[2] <= zmax)
        if ok:
            return length
        length *= 0.93
    return length


def _bunch_centres(s, n):
    """One bunch in the middle and `n` around it, each with a radius of spread."""
    out = [((0.0, 0.0), 0.30)]
    for i in range(n):
        ang = 2.0 * math.pi * (i + s.sym(0.18)) / n
        rho = FOOTPRINT_RADIUS * s.span(0.38, 0.66)
        out.append(((rho * math.cos(ang), rho * math.sin(ang)), s.span(0.20, 0.32)))
    return out


def _place_in_bunch(s, bunches, i):
    """Culm `i`'s ground position: its bunch's centre plus a polar offset. The
    first culm belongs to the middle bunch and stands at the exact centre."""
    if i == 0:
        return 0, (0.0, 0.0)
    # The middle bunch gets two shares, the rest one each.
    b = s.pick(len(bunches) + 1)
    b = 0 if b == len(bunches) else b
    (cx, cy), spread = bunches[b]
    r = spread * math.sqrt(s.u())
    a = s.u() * 2.0 * math.pi
    return b, (cx + r * math.cos(a), cy + r * math.sin(a))


def _outward(px, py, bunch_c, s):
    """The azimuth a stem at (px, py) leans toward: away from the clump's centre,
    blended with away-from-its-own-bunch, plus jitter."""
    ax, ay = px, py
    bx, by = px - bunch_c[0], py - bunch_c[1]
    if math.hypot(ax, ay) < 0.05:
        return s.u() * 2.0 * math.pi
    az1 = math.atan2(ay, ax)
    az2 = math.atan2(by, bx) if math.hypot(bx, by) > 0.02 else az1
    d = (az2 - az1 + math.pi) % (2.0 * math.pi) - math.pi
    return az1 + 0.35 * d + s.sym(0.35)


def build_phragmites(variant):
    p = VARIANTS[variant]
    H, seed = p["H"], p["seed"]
    s = Stream(seed)
    foliage, trunk = TriSoup(), TriSoup()
    bunches = _bunch_centres(s, p["bunches"])

    culms = []  # (base, tip, azimuth, rho)
    for i in range(p["culms"]):
        b, (px, py) = _place_in_bunch(s, bunches, i)
        rho = math.hypot(px, py)
        az = _outward(px, py, bunches[b][0], s)
        lean = 0.0 if i == 0 else math.radians(3.0 + 13.0 * min(1.0, rho / FOOTPRINT_RADIUS) + s.sym(4.0))
        # Height falls toward the rim (a dome) and wanders a little with noise.
        wander = 0.06 * fbm2(px * 1.7, py * 1.7, seed)
        h = H * (0.97 - 0.30 * min(1.0, rho / FOOTPRINT_RADIUS) ** 1.2 + wander) * (0.93 + 0.07 * s.u())
        if i == 0:
            h = H
        axis = (math.sin(lean) * math.cos(az), math.sin(lean) * math.sin(az), math.cos(lean))
        base = (px, py, 0.0)
        tip = foliage.cone(base, axis, h, 0.034, flat_base=True)
        culms.append((base, tip, az, rho))

    # Leaf blades: some hang, some are held up. Blades come off the culms in turn.
    hang_n = p["hang"]
    for k in range(p["blades"]):
        base, tip, az, rho = culms[k % len(culms)]
        hanging = k < hang_n
        t = s.span(0.40, 0.80)
        at = v_add(base, v_mul(v_sub(tip, base), t))
        baz = az + s.sym(1.15) if hanging else az + s.sym(2.2)
        el = math.radians(s.span(-58.0, -22.0)) if hanging else math.radians(s.span(28.0, 62.0))
        length = s.span(0.28, 0.46) * (H / 1.25)
        d = dir_from(baz, el)
        # Under the model height, above the ground, inside the footprint.
        length = _fit_length(at, d, length, zmax=H * 0.97)
        foliage.ribbon(at, d, length, 0.105, roll=s.u() * 6.28)

    # Plumes on the tallest culms, drooping outward from the tip.
    order = sorted(range(len(culms)), key=lambda c: -culms[c][1][2])
    for c in order[: p["plumes"]]:
        base, tip, az, rho = culms[c]
        d = dir_from(az + s.sym(0.5), math.radians(s.span(-62.0, -28.0)))
        ln = _fit_length(tip, d, s.span(0.21, 0.27) * (H / 1.25), zmax=H)
        end = v_add(tip, v_mul(d, ln))
        # Start slightly below the tip so the plume hangs from it.
        foliage.spindle(tip, end, 0.062, t_mid=0.35, sides=3, phase=s.u() * 6.28)

    # New shoots (the green flush) in the bottom fifth, in the trunk role.
    for k in range(p["shoots"]):
        b = s.pick(len(bunches))
        (cx, cy), spread = bunches[b]
        r = spread * 1.15 * math.sqrt(s.u())
        a = s.u() * 2.0 * math.pi
        px, py = cx + r * math.cos(a), cy + r * math.sin(a)
        az = _outward(px, py, (cx, cy), s)
        lean = math.radians(s.span(8.0, 34.0))
        h = s.span(0.12, 0.30) * (H / 1.25)
        axis = (math.sin(lean) * math.cos(az), math.sin(lean) * math.sin(az), math.cos(lean))
        trunk.ribbon((px, py, 0.0), axis, h, 0.07, roll=s.u() * 6.28)

    return foliage, trunk


def build_typha(variant):
    p = VARIANTS[variant]
    H, seed = p["H"], p["seed"]
    s = Stream(seed)
    foliage, trunk = TriSoup(), TriSoup()
    bunches = _bunch_centres(s, p["bunches"])

    # Arching strap leaves: stiff and tall at the heart, arching outward at the rim.
    for i in range(p["leaves"]):
        b, (px, py) = _place_in_bunch(s, bunches, i)
        rho = math.hypot(px, py)
        az = _outward(px, py, bunches[b][0], s)
        lean = math.radians(5.0 + 15.0 * min(1.0, rho / FOOTPRINT_RADIUS) + s.sym(4.0))
        length = H * s.span(0.62, 1.0) * (1.0 - 0.18 * min(1.0, rho / FOOTPRINT_RADIUS))
        axis = (math.sin(lean) * math.cos(az), math.sin(lean) * math.sin(az), math.cos(lean))
        outward = (math.cos(az), math.sin(az), -0.15)
        bend = v_mul(v_norm(outward), s.span(0.04, 0.10))
        # Keep the apex under the model height, above the ground and inside the
        # footprint after the bend.
        for _ in range(40):
            apex = v_add(v_mul(axis, length), v_mul(bend, 2.4))
            apex = (apex[0] + px, apex[1] + py, apex[2])
            if 0.02 <= apex[2] <= H and math.hypot(apex[0], apex[1]) <= RMAX:
                break
            length *= 0.94
            bend = v_mul(bend, 0.97)
        foliage.bent_ribbon((px, py, 0.0), axis, length, 0.115, bend, roll=s.u() * 6.28, t_bend=s.span(0.5, 0.62))

    # Flower stalks, each topped by a brown cigar. The first is the tallest (= H).
    for i in range(p["stalks"]):
        b, (px, py) = _place_in_bunch(s, bunches, i + 1)
        rho = math.hypot(px, py)
        az = _outward(px, py, bunches[b][0], s)
        lean = math.radians(2.0 + 6.0 * min(1.0, rho / FOOTPRINT_RADIUS) + s.sym(2.0))
        h = H if i == 0 else H * s.span(0.80, 0.97)
        if i == 0:
            lean = 0.0
        axis = (math.sin(lean) * math.cos(az), math.sin(lean) * math.sin(az), math.cos(lean))
        base = (px, py, 0.0)
        tip = foliage.cone(base, axis, h, 0.022, flat_base=True)
        # The spike sits on the stalk, its top at the stalk's tip.
        spike_len = s.span(0.14, 0.19) * (H / 1.0)
        lo = v_add(tip, v_mul(axis, -spike_len))
        foliage.spindle(lo, tip, 0.036, t_mid=0.5, sides=4, phase=s.u() * 6.28)

    for k in range(p["shoots"]):
        b = s.pick(len(bunches))
        (cx, cy), spread = bunches[b]
        r = spread * 1.15 * math.sqrt(s.u())
        a = s.u() * 2.0 * math.pi
        px, py = cx + r * math.cos(a), cy + r * math.sin(a)
        az = _outward(px, py, (cx, cy), s)
        lean = math.radians(s.span(8.0, 30.0))
        h = s.span(0.12, 0.30)
        axis = (math.sin(lean) * math.cos(az), math.sin(lean) * math.sin(az), math.cos(lean))
        trunk.ribbon((px, py, 0.0), axis, h, 0.07, roll=s.u() * 6.28)

    return foliage, trunk


def build(variant):
    """`(foliage_soup, trunk_soup)` for `reed_<variant>`; asserts the 400 cap."""
    fn = build_phragmites if VARIANTS[variant]["kind"] == "phragmites" else build_typha
    foliage, trunk = fn(variant)
    for soup in (foliage, trunk):
        soup.clamp_z(0.0, VARIANTS[variant]["H"])
    total = foliage.count + trunk.count
    assert total <= CAP, f"reed_{variant}: {total} triangles, cap {CAP}"
    return foliage, trunk


def measure(foliage, trunk):
    """Extents the checks read: height, radial footprint (p100 and p95), tris."""
    both = TriSoup()
    both.merge(foliage)
    both.merge(trunk)
    (x0, y0, z0), (x1, y1, z1) = both.bounds()
    radii = sorted(math.hypot(v[0], v[1]) for v in both.verts)
    return {
        "tris": both.count,
        "foliage_tris": foliage.count,
        "trunk_tris": trunk.count,
        "height_m": z1,
        "lowest_z_m": z0,
        "extent_x_m": x1 - x0,
        "extent_y_m": y1 - y0,
        "radius_max_m": radii[-1],
        "radius_p95_m": radii[int(0.95 * (len(radii) - 1))],
    }


def main():
    import argparse

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend-dir", default=None, help="save reed_N.blend files here (Blender only)")
    ap.add_argument("--report", default=None)
    args = ap.parse_args(argv)

    report = {}
    for v in sorted(VARIANTS):
        foliage, trunk = build(v)
        m = measure(foliage, trunk)
        report[f"reed_{v}"] = m
        print(
            f"reed_{v} ({VARIANTS[v]['kind']}): {m['tris']} tris "
            f"(foliage {m['foliage_tris']}, trunk {m['trunk_tris']}), height {m['height_m']:.3f} m, "
            f"footprint radius max {m['radius_max_m']:.2f} / p95 {m['radius_p95_m']:.2f} m, lowest z {m['lowest_z_m']:+.4f}"
        )
        if args.blend_dir:
            save_blend(v, foliage, trunk, args.blend_dir)
    if args.report:
        with open(args.report, "w") as fh:
            json.dump(report, fh, indent=2)


def save_blend(variant, foliage, trunk, out_dir):
    import bpy
    from wetland_kit import to_object

    bpy.ops.wm.read_factory_settings(use_empty=True)
    f = to_object("foliage", foliage)
    t = to_object("trunk", trunk)
    f["rl_role"] = "foliage"
    t["rl_role"] = "trunk"
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"reed_{variant}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
