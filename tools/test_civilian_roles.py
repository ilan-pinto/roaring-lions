"""Guards `tools/civilian_roles.py` and `tools/civilian_retarget.py` -- the
two pieces of GH-149's civilian pipeline that decide anything.

Run: python3 tools/test_civilian_roles.py
Exits non-zero on failure. Dependency-free, matching `test_dimetric.py` and
`test_representative.py` -- the repo's test runner is vitest, and pytest for
three tool modules would be heavier than the thing it tests.

The four SOURCE figures are gitignored (`art/blend/civilian/`, 325 MB), so
nothing here reads them. Every case builds its own small mesh or its own two
rigs, which is the point: these prove the RULES, and the rules are what a
future source change would run through. What the shipped GLBs themselves
carry is proved separately, in `packages/render/src/three/units/
civilian-mesh-shipped.test.ts`, which runs under `pnpm test` against the
bytes on disk.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import civilian_retarget as retarget  # noqa: E402
import civilian_roles as roles  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    if cond:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label} {detail}")
        FAILURES.append(label)


def check_raises(label, fn, needle=""):
    try:
        fn()
    except Exception as exc:  # noqa: BLE001 -- the raise IS the assertion
        if needle and needle not in str(exc):
            print(f"  FAIL {label} -- raised, but not about {needle!r}: {exc}")
            FAILURES.append(label)
        else:
            print(f"  ok   {label}")
        return
    print(f"  FAIL {label} -- did not raise")
    FAILURES.append(label)


# --- the role tables ---------------------------------------------------------

def test_tables():
    print("role tables")
    for figure, table in roles.FIGURES.items():
        outside = sorted({r for r in table.values()} - set(roles.MESH_ROLES) - {roles.BODY})
        check(f"{figure}: every role is in the closed set", not outside, outside)

        forbidden = sorted({r for r in table.values()} & set(roles.FORBIDDEN_ROLES))
        check(
            f"{figure}: names no forbidden civilian role "
            f"({', '.join(roles.FORBIDDEN_ROLES)})",
            not forbidden,
            forbidden,
        )

        bodies = [k for k, v in table.items() if v == roles.BODY]
        check(f"{figure}: exactly one body island to colour-split", len(bodies) == 1, bodies)

        hands = [k for k, v in table.items() if v == "face"]
        check(f"{figure}: has a bare-hand island to measure skin colour from", bool(hands))

    check(
        "all four supplied figures have a table",
        set(roles.FIGURES) == {"civilian_woman", "office_worker", "farm_worker", "civilian_child"},
        sorted(roles.FIGURES),
    )

    farm = roles.FIGURES["farm_worker"]
    check(
        "the farm worker's tool is wood and metal, never weapon (GH-149)",
        farm[("RightHand", 1)] == "wood" and farm[("RightToeBase", 0)] == "metal",
        (farm[("RightHand", 1)], farm[("RightToeBase", 0)]),
    )


# --- island welding ----------------------------------------------------------

def test_weld():
    print("island welding")
    # Two triangles meeting along an edge, but the shared corners are
    # DUPLICATED in the vertex array -- exactly what a glTF UV seam produces.
    # Index-based components see two islands; position welding sees one.
    positions = [
        (0, 0, 0), (1, 0, 0), (0, 1, 0),          # tri A
        (1, 0, 0), (0, 1, 0), (1, 1, 0),          # tri B, corners re-listed
    ]
    tris = [(0, 1, 2), (3, 4, 5)]
    comp = roles._weld_islands(positions, tris)
    check("a UV seam does not split one shell into two islands", len(set(comp)) == 1, set(comp))

    # Genuinely separate geometry stays separate.
    positions2 = positions + [(9, 9, 9), (9, 10, 9), (10, 9, 9)]
    tris2 = tris + [(6, 7, 8)]
    comp2 = roles._weld_islands(positions2, tris2)
    check("detached geometry is its own island", len(set(comp2)) == 2, set(comp2))


def test_island_keys():
    print("island naming")
    # Three islands: two on Head (5 verts and 3 verts), one on Hips.
    positions, tris, bones = [], [], []

    def quad(x, y, n, bone):
        base = len(positions)
        for i in range(n):
            positions.append((x + i * 0.01, y, 0.0))
            bones.append(bone)
        for i in range(n - 2):
            tris.append((base, base + i + 1, base + i + 2))

    quad(0, 0, 6, "Head")
    quad(0, 5, 4, "Head")
    quad(0, 10, 5, "Hips")
    keys = roles.island_keys(positions, tris, bones)
    check("islands are ranked largest-first within a dominant bone",
          len(keys[("Head", 0)]) == 6 and len(keys[("Head", 1)]) == 4,
          {k: len(v) for k, v in keys.items()})
    check("a bone with one island gets rank 0 only",
          ("Hips", 0) in keys and ("Hips", 1) not in keys)


# --- classify ----------------------------------------------------------------

def _synthetic():
    """A three-island figure: a body shell (a skin head vertex, a hair head
    vertex, a cloth torso vertex), a hand, and a boot."""
    positions, tris, colours, bones = [], [], [], []

    def shell(n, bone, rgb, dx):
        base = len(positions)
        for i in range(n):
            positions.append((dx + i * 0.01, i * 0.01, 0.0))
            bones.append(bone[i] if isinstance(bone, list) else bone)
            colours.append(rgb[i] if isinstance(rgb, list) else rgb)
        for i in range(n - 2):
            tris.append((base, base + i + 1, base + i + 2))
        return base

    skin = (200.0, 160.0, 130.0)
    hair = (40.0, 26.0, 18.0)
    cloth = (60.0, 90.0, 170.0)
    shell(6, ["Head", "Head", "Head", "Spine", "Spine", "Spine"],
          [skin, skin, hair, cloth, cloth, cloth], 0.0)
    shell(4, "RightHand", skin, 10.0)
    shell(3, "LeftFoot", (30.0, 20.0, 15.0), 20.0)
    return positions, tris, colours, bones


SYNTH_TABLE = {
    ("Head", 0): roles.BODY,
    ("RightHand", 0): "face",
    ("LeftFoot", 0): "boot",
}


def test_classify():
    print("classify")
    positions, tris, colours, bones = _synthetic()
    roles.FIGURES["_synthetic"] = SYNTH_TABLE
    try:
        got = roles.classify("_synthetic", positions, tris, colours, bones)
        check("accessory islands take their table role verbatim",
              got[6:10] == ["face"] * 4 and got[10:13] == ["boot"] * 3, got)
        check("bare skin inside the body island becomes `face`",
              got[0] == "face" and got[1] == "face", got[:3])
        check("hair inside the body island becomes `skin_shadow`",
              got[2] == "skin_shadow", got[2])
        check("cloth inside the body island becomes `uniform`",
              got[3:6] == ["uniform"] * 3, got[3:6])
        check("no vertex is left unclassified", None not in got)

        # A source whose islands changed must fail loudly, not shade a bag
        # as a face.
        check_raises(
            "a vanished island raises rather than mis-shading",
            lambda: roles.classify("_synthetic", positions[:10], tris[:5], colours[:10], bones[:10]),
            "island set changed",
        )

        # And the closed-set guard fires on its own output, not just the table.
        roles.FIGURES["_bad"] = {**SYNTH_TABLE, ("LeftFoot", 0): "hat"}
        check_raises(
            "a role outside the closed set raises",
            lambda: roles.classify("_bad", positions, tris, colours, bones),
            "outside the closed set",
        )
        roles.FIGURES["_forbidden"] = {**SYNTH_TABLE, ("LeftFoot", 0): "weapon"}
        check_raises(
            "a forbidden civilian role raises even when it is a legal mesh role",
            lambda: roles.classify("_forbidden", positions, tris, colours, bones),
            "forbidden civilian role",
        )
    finally:
        for k in ("_synthetic", "_bad", "_forbidden"):
            roles.FIGURES.pop(k, None)


# --- retarget ----------------------------------------------------------------

def _axis_angle(ax, ay, az, deg):
    half = math.radians(deg) / 2.0
    s = math.sin(half)
    n = math.sqrt(ax * ax + ay * ay + az * az)
    return (ax / n * s, ay / n * s, az / n * s, math.cos(half))


def _angle_between(a, b):
    d = abs(sum(x * y for x, y in zip(a, b)))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return math.degrees(2 * math.acos(min(1.0, d / (na * nb))))


def test_retarget():
    print("retarget")
    parents = {"root": None, "arm": "root", "hand": "arm"}
    # Two rigs with DELIBERATELY different rest frames -- the condition that
    # makes the naive copy wrong. (Measured on the real sources: the child's
    # rest bones differ from the woman's by a median 11.4 deg, max 45.3.)
    donor_rest = {
        "root": _axis_angle(0, 0, 1, 0),
        "arm": _axis_angle(0, 0, 1, 30),
        "hand": _axis_angle(1, 0, 0, 15),
    }
    target_rest = {
        "root": _axis_angle(0, 0, 1, 0),
        "arm": _axis_angle(0, 1, 0, 80),
        "hand": _axis_angle(1, 1, 0, 140),
    }
    # The donor strikes a pose: shoulder swung 40 deg, wrist 25 deg.
    donor_pose = {
        "root": donor_rest["root"],
        "arm": retarget.qmul(_axis_angle(0, 0, 1, 40), donor_rest["arm"]),
        "hand": retarget.qmul(_axis_angle(0, 1, 0, 25), donor_rest["hand"]),
    }

    basis = retarget.retarget_local(donor_pose, donor_rest, target_rest, parents)

    # The SPEC, written out here independently of the implementation: with
    # `basis` applied, each target bone's armature-space rotation must equal
    # the donor's own delta-from-rest applied to the target's rest.
    def compose(bone):
        parent = parents[bone]
        if parent is None:
            return retarget.qmul(target_rest[bone], basis[bone])
        return retarget.qmul(
            retarget.qmul(
                retarget.qmul(compose(parent), retarget.qinv(target_rest[parent])),
                target_rest[bone],
            ),
            basis[bone],
        )

    worst = 0.0
    for bone in target_rest:
        delta = retarget.qmul(donor_pose[bone], retarget.qinv(donor_rest[bone]))
        want = retarget.qmul(delta, target_rest[bone])
        worst = max(worst, _angle_between(compose(bone), want))
    check(f"every bone lands on the donor's own delta from rest (worst {worst:.4f} deg)",
          worst < 1e-6, worst)

    # The control. Copying the donor's LOCAL rotation across -- the borrow
    # GH-149 calls "likely wrong" -- must NOT satisfy the same spec, or this
    # test proves nothing.
    naive = {}
    for bone in target_rest:
        parent = parents[bone]
        if parent is None:
            naive[bone] = retarget.qmul(retarget.qinv(donor_rest[bone]), donor_pose[bone])
        else:
            naive[bone] = retarget.qmul(retarget.qinv(donor_rest[bone]), donor_pose[bone])
    basis_backup = dict(basis)
    basis.update(naive)
    naive_worst = 0.0
    for bone in target_rest:
        delta = retarget.qmul(donor_pose[bone], retarget.qinv(donor_rest[bone]))
        want = retarget.qmul(delta, target_rest[bone])
        naive_worst = max(naive_worst, _angle_between(compose(bone), want))
    basis.update(basis_backup)
    check(f"the naive local copy does NOT (worst {naive_worst:.1f} deg) -- so the case above can fail",
          naive_worst > 10.0, naive_worst)

    check_raises(
        "a donor missing a bone raises rather than silently leaving it at rest",
        lambda: retarget.retarget_local(
            {k: v for k, v in donor_pose.items() if k != "hand"},
            {k: v for k, v in donor_rest.items() if k != "hand"},
            target_rest,
            parents,
        ),
        "no bone",
    )


def main():
    test_tables()
    test_weld()
    test_island_keys()
    test_classify()
    test_retarget()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("all civilian role/retarget checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
