"""Author art/src/buildings/concrete.blend.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_concrete.py

The concrete structure: 700 HP a tile -- the toughest thing in the set after the
mosque -- two garrison slots, 3 ROE points. A strongpoint or utility tower, and
the only type no map places yet. It is built anyway, because otherwise it is the
one structure still falling back to the procedural extrusion.

**The footprint is a choice, not data.** No map places '#', so unlike the other
five there is nothing to measure. It is authored 2x2 rather than 3x3, which is
what the silhouette budget had room for -- see below -- and a 2x2 at 700 HP a tile
is a 2800 HP blockhouse, which is a plausible thing for a map to draw. If a map
later places '#' at another size, this is the file to revisit.

Why a tower. Absolute height is not a distinctness lever: the render frame is
sized to each building's own reach, so downsampling to 64px normalises height
away. That is what put the discarded parametric generator at 0.950 IoU. Only
proportion and outline survive, and by the time the other five were authored the
proportions were taken:

    shanty     0.28   low sprawl, pitched
    warehouse  0.41   wide and squat, gabled
    house      0.45   medium rectangle, parapet
    apartment  0.66   tall and wide, stepped setback
    mosque      --    dome and minaret

A first pass built this squat, which measured 0.847 against the warehouse -- two
wide low masses. Tall and narrow was the free niche, so that is what this is: a
single blank shaft under a heavy overhanging cornice, at about 0.85. Nothing else
in the set is narrow.

The cornice is the feature. A solid slab is right here where a parapet ring would
be wrong: it gives the building a T-shaped top nothing else has, and the blankness
-- no windows, only slits -- is what makes it read as not-domestic against five
buildings pierced all over.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

W = kit.tiles(2) - 0.5   # 5.5
D = kit.tiles(2) - 0.5   # 5.5
BODY = 7.60
CORNICE_H = 0.80
CORNICE_OVER = 0.52      # modest: overhang widens the plan and flattens the ratio

S = -D / 2
N = D / 2
WW = -W / 2
E = W / 2

kit.new_scene()

# --- one blank shaft --------------------------------------------------------
kit.box("Body", (W, D, BODY), (0, 0, BODY / 2), "wall")
kit.box("Plinth", (W + 0.44, D + 0.44, 0.60), (0, 0, 0.30), "wall")
# Two shallow string courses, so 7.6 units of blank wall has some scale to it.
kit.trim_band("Course_0", (W, D), 2.60, height=0.24, overhang=0.13)
kit.trim_band("Course_1", (W, D), 5.10, height=0.24, overhang=0.13)

# --- the cornice: the whole silhouette argument -----------------------------
kit.cornice("Cornice", (W, D), BODY, height=CORNICE_H, overhang=CORNICE_OVER)
kit.trim_band(
    "Cornice_band", (W + 2 * CORNICE_OVER, D + 2 * CORNICE_OVER), BODY - 0.26,
    height=0.26, overhang=0.06,
)
kit.roof_deck("Roof", (W, D), BODY + CORNICE_H, inset=0.18)

# --- no windows. Slits only. ------------------------------------------------
for i, z in enumerate((3.30, 5.80)):
    kit.box(f"Slit_S{i}", (1.90, 0.16, 0.32), (0.0, S, z), "glass")
    kit.box(f"Slit_W{i}", (0.16, 1.90, 0.32), (WW, 0.0, z), "glass")

# --- steel door and the services that say "utility" ------------------------
kit.box("Door", (1.30, 0.20, 2.10), (-0.7, S - 0.05, 1.05), "metal")
kit.box("Door_frame", (1.58, 0.16, 0.26), (-0.7, S - 0.07, 2.23), "trim")
kit.box("Conduit", (0.28, 0.28, BODY - 0.60), (1.95, S - 0.16, 0.60 + (BODY - 0.60) / 2), "metal")
kit.box("Conduit_box", (0.60, 0.40, 0.70), (1.95, S - 0.22, 1.45), "metal")
for i, x in enumerate((-1.0, 0.9)):
    kit.ventilator(f"Vent_{i}", (x, 0.7, BODY + CORNICE_H))

# --- revetment --------------------------------------------------------------
kit.sandbag_row("Bags_S", (WW + 0.5, S - 0.64), (E - 0.5, S - 0.64), 0.0, 5)
kit.sandbag_row("Bags_W", (WW - 0.64, S + 0.7), (WW - 0.64, N - 0.7), 0.0, 4)

kit.save(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "art", "src", "buildings", "concrete.blend",
))
