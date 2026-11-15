#!/usr/bin/env python3
"""Draw the unit-spacing layout sheet (GH-1360, S0). Report-only.

    python3 tools/spacing_sheet.py sheet.json sheet.png [--cols=2]

`sheet.json` is what `tools/src/backtest/spacing-sheet.ts` writes (pnpm spacing:sheet). One row per start, with
two panels when the export carries a layout arm: today on the left, the layout on the right. Each panel is a
top-down plot of the starting force:

  - terrain: blocked tiles dark, boulders (closed to wheels) hatched, cover tinted;
  - each body as its real shape (a hull is a capsule of its GH-421 footprint, a foot team is a circle of the
    spec's proposed radius), coloured by FORMATION CLASS, with a tick for its facing;
  - bodies that overlap a same-side body in red outline; a body on ground closed to its own mask in black
    outline (dashed when a garrison order was queued for it, which is the exemption assertGroundClear makes);
  - the layout's front as an arrow.

Needs matplotlib only.
"""
import json
import math
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Polygon, Rectangle  # noqa: E402

# One hue per formation class, readable on the light terrain and distinct in greyscale by lightness.
CLASS_COLOUR = {
    "armour": "#3b5b92",
    "light_vehicle": "#7aa6d6",
    "recon": "#2f8f83",
    "infantry": "#c9822b",
    "support_weapon": "#8a5ab0",
    "medic": "#3f9a4d",
    "aircraft": "#999999",
    "none": "#777777",
}
FRONT_VEC = {"N": (0, -1), "E": (1, 0), "S": (0, 1), "W": (-1, 0)}


def capsule_polygon(b, steps=10):
    """The outline of a body: an axis segment swept by halfWid, as the sim's hullCapsule builds it."""
    ang = b["facing"] * 2 * math.pi
    c, s = math.cos(ang), math.sin(ang)
    cx = b["x"] + c * b["centre"]
    cy = b["y"] + s * b["centre"]
    h = max(b["halfLen"] - b["halfWid"], 0.0)
    r = b["halfWid"]
    x0, y0 = cx - c * h, cy - s * h
    x1, y1 = cx + c * h, cy + s * h
    pts = []
    for k in range(steps + 1):  # cap at the front end, sweeping from -90 to +90 degrees about the heading
        a = ang - math.pi / 2 + math.pi * k / steps
        pts.append((x1 + r * math.cos(a), y1 + r * math.sin(a)))
    for k in range(steps + 1):  # cap at the back end
        a = ang + math.pi / 2 + math.pi * k / steps
        pts.append((x0 + r * math.cos(a), y0 + r * math.sin(a)))
    return pts


def draw_arm(ax, start, arm, title):
    w, h = start["width"], start["height"]
    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)  # y down, as the sim
    ax.set_aspect("equal")
    for ty, row in enumerate(start["rows"]):
        for tx, ch in enumerate(row):
            if ch == "#":
                ax.add_patch(Rectangle((tx, ty), 1, 1, fc="#3a3a3a", ec="none", zorder=1))
            elif ch == "b":
                ax.add_patch(Rectangle((tx, ty), 1, 1, fc="#bdb7a8", ec="#8d877a", hatch="///", lw=0, zorder=1))
            elif ch in "123":
                ax.add_patch(Rectangle((tx, ty), 1, 1, fc="#d6e2c8", ec="none", alpha=0.35 * int(ch), zorder=1))
    for b in arm["bodies"]:
        poly = Polygon(
            capsule_polygon(b),
            closed=True,
            fc=CLASS_COLOUR.get(b["cls"], CLASS_COLOUR["none"]),
            ec="#d62728" if b["overlap"] else ("black" if b["onBlocked"] else "white"),
            lw=1.6 if (b["overlap"] or b["onBlocked"]) else 0.5,
            ls="--" if (b["onBlocked"] and b["garrison"] and not b["overlap"]) else "-",
            alpha=0.62,
            zorder=3,
        )
        ax.add_patch(poly)
        ang = b["facing"] * 2 * math.pi
        reach = max(b["halfLen"], b["halfWid"]) + abs(b["centre"])
        ax.plot([b["x"], b["x"] + math.cos(ang) * reach], [b["y"], b["y"] + math.sin(ang) * reach], color="black", lw=0.8, zorder=4)
    front = arm.get("front")
    if front in FRONT_VEC and arm["bodies"]:
        cx = sum(b["x"] for b in arm["bodies"]) / len(arm["bodies"])
        cy = sum(b["y"] for b in arm["bodies"]) / len(arm["bodies"])
        dx, dy = FRONT_VEC[front]
        ax.annotate("", xy=(cx + 4 * dx, cy + 4 * dy), xytext=(cx, cy), arrowprops=dict(arrowstyle="-|>", color="#d62728", lw=2), zorder=5)
    ax.set_title(f"{title}: {len(arm['bodies'])} bodies, {arm['overlapPairs']} overlapping pairs", fontsize=8)
    ax.tick_params(labelsize=6)
    ax.grid(color="#888", lw=0.2, alpha=0.5)


def crop(start, arms, pad=3):
    """Limit the view to the force: the map is 48-96 tiles and the force is ~20."""
    xs = [b["x"] for a in arms for b in a["bodies"]]
    ys = [b["y"] for a in arms for b in a["bodies"]]
    if not xs:
        return 0, start["width"], 0, start["height"]
    return max(0, min(xs) - pad), min(start["width"], max(xs) + pad), max(0, min(ys) - pad), min(start["height"], max(ys) + pad)


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    sheets = json.load(open(argv[1]))
    out = argv[2]
    n_arms = 2 if any("layout" in s for s in sheets) else 1
    fig, axes = plt.subplots(len(sheets), n_arms, figsize=(6.2 * n_arms, 4.6 * len(sheets)), squeeze=False)
    for r, st in enumerate(sheets):
        arms = [("today", st["today"])] + ([("layout", st["layout"])] if "layout" in st else [])
        x0, x1, y0, y1 = crop(st, [a for _, a in arms])
        for c in range(n_arms):
            ax = axes[r][c]
            if c < len(arms):
                title, arm = arms[c]
                draw_arm(ax, st, arm, f"{st['name']} - {title}")
                ax.set_xlim(x0, x1)
                ax.set_ylim(y1, y0)
            else:
                ax.axis("off")
    handles = [plt.Line2D([0], [0], marker="s", ls="", color=col, label=name) for name, col in CLASS_COLOUR.items() if name != "none"]
    fig.legend(handles=handles, loc="upper center", ncol=len(handles), fontsize=8)
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    fig.savefig(out, dpi=110)
    print(f"wrote {out} ({len(sheets)} starts)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
