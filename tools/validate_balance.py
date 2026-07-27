#!/usr/bin/env python3
"""
Roaring Lions -- cost-curve validator.

The failure mode of open contribution is not malice, it is a well-meaning
contributor shipping a unit that is quietly 30% better than everything at its
price point. Nobody notices for six months, and by then three missions are
balanced around it.

This gate prices every unit from its own stats and rejects submissions whose
listed cost falls outside a tolerance band around the fitted curve. Think of
it as an arbitrage bound: if a unit's stats say it should cost 900 logistics
and the JSON says 600, that is free alpha and CI closes it.

    python tools/validate_balance.py --units data/units --tolerance 0.18

Fitting note: the curve is refitted from the CURRENT roster on every run, so
it tracks the game's own economy rather than a hardcoded constant. That means
a single bad merge shifts the curve slightly -- which is why the gate runs on
the PR, before merge, not after.
"""

import argparse
import glob
import json
import math
import os
import sys

# Exponents on the three power axes. Offense dominates, but survivability
# matters superlinearly in a game where flanking and concentration decide
# fights -- see Lanchester behaviour in GDD 5.7.
# ADDITIVE, not multiplicative. A geometric mean assumes every unit needs all
# three axes, which is false: recon drones, EOD teams and engineers are
# deliberate specialists with near-zero offense. A multiplicative model scores
# them at roughly zero no matter how good their sensors are. Additive scoring
# over roster-normalised axes prices a specialist for what it actually does.
W_OFFENSE = 0.45
W_DEFENSE = 0.35
W_MOBILITY = 0.20

# Offense is scored as expected KILLS PER MINUTE against a mixed target
# population, not raw damage. Two reasons this matters:
#   * A weapon that cannot penetrate scores zero against that class, so an
#     HMG gets full credit against infantry and none against an MBT. No
#     "minimum effectiveness" fudge factor needed.
#   * Overkill is capped. Tripling a weapon's damage past what kills the
#     target does not triple its value, which is true and which naive
#     damage-per-minute models always get wrong.
# (armor_mm, target_hp, share_of_population)
TARGET_MIX = (
    (320.0, 2500.0, 0.35),   # armour
    (60.0,  900.0,  0.25),   # light vehicles
    (8.0,   300.0,  0.40),   # infantry / soft
)

# Blast weapons defeat soft targets without penetrating anything.
BLAST_TYPES = {"he", "mortar", "rocket", "demolition"}
BLAST_EFFECT = {320.0: 0.05, 60.0: 0.30, 8.0: 1.00}

MAX_ENGAGE_RATE = 6.0    # kills/min ceiling -- target acquisition, not ammo
SUP_SATURATION = 3000.0  # suppression-per-min at which value saturates
SUP_MAX_VALUE = 3.0      # suppression ceiling, expressed in kills/min equivalent

MIN_ROSTER_FOR_FIT = 6


def phi(x):
    """Normal CDF -- the same penetration curve the sim uses."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def p_pen(penetration, armor):
    if penetration <= 0:
        return 0.0
    sigma = max(0.12 * penetration, 1e-6)
    return phi((penetration - armor) / sigma)


def offense_score(unit):
    total = 0.0
    for w in unit.get("weapons", []):
        rof = w.get("rof_per_min", 0.0)
        dmg = w.get("damage", 0.0)
        pen = w.get("penetration", 0.0)
        sup = w.get("suppression", 0.0)
        acc = w.get("accuracy", 0.0)
        rng = w.get("effective_range_tiles", w.get("range_tiles", 1.0))
        blast = w.get("type") in BLAST_TYPES

        kpm = 0.0
        for armor, hp, share in TARGET_MIX:
            pk = BLAST_EFFECT[armor] if blast else p_pen(pen, armor)
            if pk <= 0.0:
                continue
            rate = rof * acc * pk * dmg / max(hp, 1.0)
            kpm += share * min(rate, MAX_ENGAGE_RATE)

        # Suppression saturates: you cannot suppress a unit more than fully.
        # This is what stops a high-RoF MG from out-scoring a tank gun.
        spm = rof * sup
        kpm += SUP_MAX_VALUE * (1.0 - math.exp(-spm / SUP_SATURATION))

        # Standoff compounds -- engaging on your own terms is worth paying for.
        total += kpm * (1.0 + math.log1p(rng) * 0.25)
    return max(total, 0.05)


def defense_score(unit):
    hull = unit.get("hull", {})
    armor = hull.get("armor", {})
    hp = hull.get("hp", 1.0)

    # Weighted by realistic hit distribution: you get shot in the front most
    # of the time, but not always, and side armour is what flanking punishes.
    facing = (
        0.55 * armor.get("front", 0.0)
        + 0.30 * armor.get("side", 0.0)
        + 0.15 * armor.get("rear", 0.0)
    )

    survivability = hp * (1.0 + facing / 200.0)

    if hull.get("era"):
        survivability *= 1.15

    aps = hull.get("aps")
    if aps:
        pk = aps.get("base_pk", 0.0)
        mag = aps.get("magazine", 1)
        # Saturation is the counter, so a small magazine caps the value of
        # a high Pk. This is deliberate -- it prices the counterplay in.
        survivability *= 1.0 + pk * min(mag, 4) * 0.12

    survivability *= 1.0 + hull.get("suppression_resistance", 0.5) * 0.2
    return max(survivability, 1.0)


def mobility_score(unit):
    mob = unit.get("mobility", {})
    sen = unit.get("sensors", {})
    speed = mob.get("speed_tiles_s", 0.0)
    sight = sen.get("sight_tiles", 0.0)
    optics = sen.get("optics", 1.0)

    score = speed * 10.0 + sight * 2.0 + optics * 5.0

    # Low signature is the enemy's whole doctrine -- it must cost something.
    sig = sen.get("signature", 1.0)
    if sig > 0:
        score *= 1.0 + max(0.0, (1.0 - sig)) * 0.5

    if sen.get("thermal"):
        score *= 1.15
    if mob.get("reshapes_terrain"):
        score *= 1.25
    return max(score, 1.0)


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


def build_power_fn(units):
    """Normalise each axis against the roster median, then weight additively.

    Normalising against the roster means the curve tracks THIS game's economy
    rather than absolute numbers, so it stays meaningful as the roster grows.
    """
    offs = [offense_score(u) for u in units]
    defs = [defense_score(u) for u in units]
    mobs = [mobility_score(u) for u in units]
    mo, md, mm = median(offs) or 1.0, median(defs) or 1.0, median(mobs) or 1.0

    def power_score(unit):
        return (
            W_OFFENSE * (offense_score(unit) / mo)
            + W_DEFENSE * (defense_score(unit) / md)
            + W_MOBILITY * (mobility_score(unit) / mm)
        )
    return power_score


def effective_cost(unit):
    c = unit.get("cost", {})
    # Intel is scarcer than logistics; weight it accordingly.
    return c.get("logistics", 0) + c.get("intel", 0) * 2.5


def fit_curve(samples):
    """Least-squares fit of log(cost) = a*log(power) + b."""
    xs = [math.log(p) for p, _ in samples]
    ys = [math.log(c) for _, c in samples]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = sum((x - mx) ** 2 for x in xs)
    a = num / den if den else 1.0
    b = my - a * mx
    return a, b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--units", default="data/units")
    ap.add_argument("--tolerance", type=float, default=0.18)
    ap.add_argument("--report", action="store_true", help="print the whole roster")
    args = ap.parse_args()

    paths = sorted(glob.glob(os.path.join(args.units, "**", "*.json"), recursive=True))
    units = []
    for p in paths:
        with open(p) as fh:
            u = json.load(fh)
        if u.get("faction") == "civilian":
            continue
        units.append((p, u))

    if len(units) < MIN_ROSTER_FOR_FIT:
        print(f"roster has {len(units)} units, need {MIN_ROSTER_FOR_FIT} to fit a curve -- skipping")
        return 0

    power_score = build_power_fn([u for _, u in units])

    samples = []
    for _, u in units:
        cost = effective_cost(u)
        if cost <= 0:
            continue
        samples.append((power_score(u), cost))

    a, b = fit_curve(samples)
    print(f"fitted curve: cost = {math.exp(b):.3f} * power^{a:.3f}  (n={len(samples)})\n")

    failures = []
    rows = []
    for path, u in units:
        power = power_score(u)
        actual = effective_cost(u)
        expected = math.exp(b) * (power ** a)
        if expected <= 0:
            continue
        dev = (actual - expected) / expected
        rows.append((u["id"], power, actual, expected, dev))
        if abs(dev) > args.tolerance:
            verdict = "UNDERPRICED" if dev < 0 else "OVERPRICED"
            failures.append(
                f"{u['id']} ({os.path.basename(path)}): {verdict} "
                f"cost={actual:.0f} expected={expected:.0f} "
                f"deviation={dev:+.1%} (limit +/-{args.tolerance:.0%})"
            )

    if args.report:
        print(f"{'unit':<20}{'power':>10}{'cost':>10}{'expected':>10}{'dev':>9}")
        for r in sorted(rows, key=lambda r: -abs(r[4])):
            print(f"{r[0]:<20}{r[1]:>10.1f}{r[2]:>10.0f}{r[3]:>10.0f}{r[4]:>+9.1%}")
        print()

    if failures:
        print(f"BALANCE GATE FAILED -- {len(failures)} unit(s) off the cost curve:\n")
        for f in failures:
            print(f"  - {f}")
        print(
            "\nEither adjust the cost, or adjust the stats. If you believe the unit "
            "is correctly priced and the curve is wrong, say so in the PR -- the "
            "curve is a heuristic and is allowed to be argued with."
        )
        return 1

    print(f"balance gate passed: {len(units)} units within +/-{args.tolerance:.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
