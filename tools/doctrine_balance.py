#!/usr/bin/env python3
"""
Roaring Lions -- the doctrine picks' cost-curve gate (GH-1383 slice 1, design §3 and T4).

    python3 tools/doctrine_balance.py --upgrade-cost-factor 0.02 [--json]

A pick (data/doctrines/picks/<id>.json) changes its faction's camp menu and some prices. This
asks one question of it: does the pick buy more power per logistic, on average over what it can
build, than its base doctrine does? It is a statement about PRICES ON THE CURVE, not about win
rates (fairness between doctrines is parked for the lead, design §3.1).

The curve is tools/validate_balance.py's own: this script imports `load_units`,
`build_power_fn`, `fit_curve`, `effective_cost` and `patch_to_max_tier` from it and copies none
of them (design Appendix A). Then, per pick:

  - surplus of a unit at a price: s(u) = ln(expected(u) / price(u)), positive a bargain;
  - menu value: the equal-weight mean of s over a resolved menu;
  - delta = value(pick's menu at the pick's prices) - value(base menu at base prices), both
    scored on the FROZEN base fit: the curve, the axis medians and the exponent are fitted on the
    roster at its own prices, and a pick's prices are scored against that fit, never refitted
    into it.

The bar is the lead's ruling Q6 (19 Nov 2026): |delta| <= 0.005 and every unit the pick prices
inside the +/-18% band of validate_balance.py. A KDF pick is gated again at max tier, once per
uniform branch vector (`--branch=1`, `--branch=2`, PR 1584): the roster is patched by
`patch_to_max_tier(units, K, branch)`, the fit is refitted on THAT roster (the kitted base), and a
priced unit costs `pick logistics + K x total tier price` (the doctrine is applied before the kit,
design §2.3). Sarim fields no kit, so its max-tier reading is printed but not gated: it moves only
because the KDF rows moved the fit (design §3.1).

The cap is not on the curve; tools/validate_doctrine.mjs holds the neutral-cap rule (P8). This
script prints the neutral cap beside each pick for the table, and gates nothing about it.

`--json` prints one JSON object (the numbers, the resolved menus and a `failures` list) for
tools/validate_data.mjs and tools/src/doctrine_balance.test.ts. The exit code is 1 when any
failure is found, 2 on a usage or input error, 0 otherwise.
"""

import argparse
import glob
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate_balance as vb  # noqa: E402

BRANCHES = (1, 2)


def load_docs(dir_path):
    """Every *.json directly under `dir_path`, sorted by file name."""
    out = []
    for p in sorted(glob.glob(os.path.join(dir_path, "*.json"))):
        with open(p) as fh:
            out.append((p, json.load(fh)))
    return out


def resolve(base, pick):
    """The pick's menu (base order, removals dropped, additions appended in op order) and its
    {unit: logistics} prices. The same reading as @lions/data's resolveDoctrine; a test pins the
    two menus together."""
    menu = list(base["menu"])
    prices = {}
    for op in pick.get("ops", []):
        kind = op.get("op")
        if kind == "menu_remove":
            drop = set(op["units"])
            menu = [u for u in menu if u not in drop]
        elif kind == "menu_add":
            menu += [u for u in op["units"] if u not in menu]
        elif kind == "set_price":
            prices[op["unit"]] = op["logistics"]
    return menu, prices


def neutral_cap(base_cap, base_menu, menu, pop):
    """round(base_cap x meanPop(menu) / meanPop(base_menu)), half up, in integers (design §3.2)."""
    num = base_cap * sum(pop[u] for u in menu) * len(base_menu)
    den = len(menu) * sum(pop[u] for u in base_menu)
    return (2 * num + den) // (2 * den)


class Tier:
    """One frozen fit: the roster (base or patched), its power function and its curve."""

    def __init__(self, rows, k=None, branch=None):
        self.k = k
        self.branch = branch
        self.rows = vb.patch_to_max_tier(rows, k, branch) if k is not None else rows
        self.by_id = {u["id"]: u for _, u in self.rows}
        self.raw = {u["id"]: (p, u) for p, u in rows}
        self.power = vb.build_power_fn([u for _, u in self.rows])
        samples = [(self.power(u), vb.effective_cost(u)) for _, u in self.rows if vb.effective_cost(u) > 0]
        self.a, self.b = vb.fit_curve(samples)
        self.n = len(samples)

    def expected(self, uid):
        return math.exp(self.b) * self.power(self.by_id[uid]) ** self.a

    def price(self, uid, logistics=None):
        """The unit's cost on this tier; with `logistics`, the cost at the pick's price, the kit
        (if any) bought on top of it."""
        if logistics is None:
            return vb.effective_cost(self.by_id[uid])
        path, raw = self.raw[uid]
        priced = dict(raw)
        priced["cost"] = dict(raw.get("cost", {}), logistics=logistics)
        if self.k is not None:
            priced = vb.patch_to_max_tier([(path, priced)], self.k, self.branch)[0][1]
        return vb.effective_cost(priced)

    def value(self, menu, prices):
        return sum(math.log(self.expected(u) / self.price(u, prices.get(u))) for u in menu) / len(menu)

    def dev(self, uid, logistics):
        return (self.price(uid, logistics) - self.expected(uid)) / self.expected(uid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--units", default="data/units")
    ap.add_argument("--doctrines", default="data/doctrines", help="the base files; picks are read from <dir>/picks")
    ap.add_argument("--picks", default=None, help="override the picks directory (a test's fixtures)")
    ap.add_argument("--tolerance", type=float, default=0.18, help="validate_balance.py's band")
    ap.add_argument("--delta", type=float, default=0.005, help="the |delta| bar (the lead's Q6)")
    ap.add_argument(
        "--upgrade-cost-factor",
        type=float,
        required=True,
        metavar="K",
        help="K for the max-tier pass, read from docs/campaign/economy/upgrades.md section 5 (as CI passes it to validate_balance.py)",
    )
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    rows = vb.load_units(args.units)
    if len(rows) < vb.MIN_ROSTER_FOR_FIT:
        print(f"roster has {len(rows)} units, need {vb.MIN_ROSTER_FOR_FIT}", file=sys.stderr)
        return 2
    bases = {d["id"]: d for _, d in load_docs(args.doctrines)}
    picks = load_docs(args.picks or os.path.join(args.doctrines, "picks"))
    pop = {u["id"]: u.get("cost", {}).get("population", 0) for _, u in rows}

    base_tier = Tier(rows)
    max_tiers = {br: Tier(rows, args.upgrade_cost_factor, br) for br in BRANCHES}

    failures = []
    out_picks = []
    if not picks:
        failures.append("no doctrine picks to score (an empty directory passes nothing)")
    for path, pick in picks:
        name = os.path.relpath(path)
        pid = pick.get("id")
        base = bases.get(pick.get("extends"))
        if base is None:
            failures.append(f"{name}: extends {pick.get('extends')!r}, which is no base doctrine")
            continue
        menu, prices = resolve(base, pick)
        unknown = [u for u in menu + list(prices) if u not in base_tier.by_id]
        if unknown:
            failures.append(f"{name}: names {sorted(set(unknown))}, not on the fitted roster")
            continue
        gated_max = base["faction"] == "kdf"
        rec = {
            "id": pid,
            "faction": base["faction"],
            "menu": menu,
            "base_value": round(base_tier.value(base["menu"], {}), 6),
            "value": round(base_tier.value(menu, prices), 6),
            "delta_base": round(base_tier.value(menu, prices) - base_tier.value(base["menu"], {}), 6),
            "delta_max": {},
            "max_gated": gated_max,
            "neutral_cap": neutral_cap(base["pop_cap"], base["menu"], menu, pop) if "pop_cap" in base else None,
            "prices": [],
        }
        if abs(rec["delta_base"]) > args.delta:
            failures.append(f"{name}: net value {rec['delta_base']:+.4f} at base tier, outside +/-{args.delta} (Q6)")
        for br, tier in max_tiers.items():
            d = tier.value(menu, prices) - tier.value(base["menu"], {})
            rec["delta_max"][str(br)] = round(d, 6)
            if gated_max and abs(d) > args.delta:
                failures.append(f"{name}: net value {d:+.4f} at max tier, branch {br}, outside +/-{args.delta} (Q6)")
        for uid in sorted(prices):
            was = base_tier.raw[uid][1]["cost"]["logistics"]
            row = {"unit": uid, "was": was, "is": prices[uid], "dev_base": round(base_tier.dev(uid, prices[uid]), 6), "dev_max": {}}
            if abs(row["dev_base"]) > args.tolerance:
                failures.append(f"{name}: {uid} at {prices[uid]} is {row['dev_base']:+.1%} off the curve, outside +/-{args.tolerance:.0%}")
            for br, tier in max_tiers.items():
                dm = tier.dev(uid, prices[uid])
                row["dev_max"][str(br)] = round(dm, 6)
                if gated_max and abs(dm) > args.tolerance:
                    failures.append(
                        f"{name}: {uid} at {prices[uid]} is {dm:+.1%} off the max-tier curve, branch {br}, outside +/-{args.tolerance:.0%}"
                    )
            rec["prices"].append(row)
        out_picks.append(rec)

    result = {
        "fit": {"a": round(base_tier.a, 6), "scale": round(math.exp(base_tier.b), 6), "n": base_tier.n},
        "fit_max": {str(br): {"a": round(t.a, 6), "scale": round(math.exp(t.b), 6), "n": t.n} for br, t in max_tiers.items()},
        "delta_bar": args.delta,
        "tolerance": args.tolerance,
        "picks": out_picks,
        "failures": failures,
    }
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"frozen base fit: cost = {result['fit']['scale']:.3f} * power^{result['fit']['a']:.4f} (n={base_tier.n})")
        print(f"{'pick':<16}{'delta base':>12}{'max br1':>10}{'max br2':>10}{'cap':>6}  prices (was -> is, curve dev)")
        for r in out_picks:
            ps = ", ".join(f"{p['unit']} {p['was']}->{p['is']} ({p['dev_base']:+.1%})" for p in r["prices"])
            mark = "" if r["max_gated"] else "*"
            print(
                f"{r['id']:<16}{r['delta_base']:>+12.4f}{r['delta_max']['1']:>+9.4f}{mark:1}{r['delta_max']['2']:>+9.4f}{mark:1}"
                f"{r['neutral_cap'] if r['neutral_cap'] is not None else '-':>6}  {ps}"
            )
        print("(* max tier is a reading, not gated: Sarim fields no kit)")
        if failures:
            print(f"\nDOCTRINE GATE FAILED -- {len(failures)}:")
            for f in failures:
                print(f"  - {f}")
        else:
            print(f"\ndoctrine gate passed: {len(out_picks)} picks within |delta| <= {args.delta}, priced units within +/-{args.tolerance:.0%}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
