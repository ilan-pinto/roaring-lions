"""The infantry upgrade kit's part manifest (GH-826). Plain Python, no bpy.

One table, read by three things: `inf_kit.py` (builds the geometry),
`rig.PART_BONE` (every kit suffix is added to it, so a part with no bone still
raises in `rig_parts` -- extend, never silence), and the render tool's tier
filter. It is importable outside Blender so a test can pin it.

A part's object name is `{figure}_kit_{track letter}{tier}_{part}`, for example
`f1_kit_s2_assault_pack`; the SUFFIX `kit_s2_assault_pack` is the PART_BONE key.

Dimensions in `spec_dims` are the 26 Oct spec (§2.3) numbers; `dims` are the
EXAGGERATED ones the lead asked for (GH-826 ruling, 26 Oct): "chunkier, bolder
silhouettes per tier, within the budgets and still plausible kit". Both are
metres, (x forward, y across, z up) unless the string says otherwise.
"""
from collections import namedtuple

Part = namedtuple("Part", "name track tier slot figs bone role texel spec_tris spec_dims dims")

TRACKS = ("armour", "sensors", "firepower")
TRACK_LETTER = {"armour": "a", "sensors": "s", "firepower": "f"}
ALL = ("f0", "f1", "f2")
LEADER = ("f1",)

# Texel names -> (px, py) in the shipped inf_squad atlas (2048 x 1024, py from
# the top), each the centre of a solid 9x9 block (std < 5/255) chosen as the
# nearest to a target colour. Pinned UVs, the blob-joint method: the kit adds
# no texture and the atlas bytes never change.
ATLAS_SHA256 = None   # filled by inf_kit.build() from the GLB it loads; see notes
TEXELS = {
    "khaki": (548, 96),       # (105, 99, 68)
    "tan": (840, 396),        # (169, 155, 135)
    "olive": (1808, 580),     # (81, 83, 40)
    "dark": (1280, 196),      # (37, 40, 43)
    "black": (1412, 696),     # (13, 14, 16)
    "grey": (860, 824),       # (120, 117, 98)
    "orange": (892, 240),     # (160, 93, 39)
    "cream": (180, 728),      # (202, 200, 187)
}

P = Part
PARTS = [
    # ---- ARMOUR: torso shell, shoulders, groin, helmet shell -------------
    P("helmet_cover", "armour", 1, None, ALL, "head", "uniform", "tan", 120,
      "shell +0.008", "shell +0.045 all round (rim lifted off the face), orange scrim band, rear flap 0.06 x 0.24 x 0.12"),
    P("side_plates", "armour", 1, None, ALL, "spine", "uniform", "tan", 72,
      "2 x 0.04 x 0.17 x 0.22", "2 x 0.09 (across) x 0.24 (fore-aft) x 0.28, a full plate-width proud of the flank"),
    P("shoulder", "armour", 2, "shoulder", ALL, "upperarm", "uniform", "tan", 120,
      "2 x 0.13 x 0.04 x 0.15, three panels", "2 x three stepped lames 0.26-0.28 x 0.08 x 0.08-0.10, fanned 0/28/52 deg"),
    P("groin_flap", "armour", 2, None, ALL, "pelvis", "uniform", "tan", 40,
      "0.18 x 0.025 x 0.17", "0.07 x 0.26 x 0.22"),
    P("collar", "armour", 2, None, ALL, "spine", "uniform", "tan", 80,
      "ring 0.03 thick", "ring 0.06 thick, 0.10 tall, o.d. 0.32"),
    P("plate_front", "armour", 3, None, ALL, "spine", "uniform", "tan", 48,
      "0.27 x 0.03 x 0.32 (+30 mm)", "0.08 x 0.36 x 0.42"),
    P("plate_back", "armour", 3, None, ALL, "spine", "uniform", "tan", 48,
      "0.27 x 0.03 x 0.32 (+30 mm)", "0.08 x 0.36 x 0.42"),
    P("upperarm_guard", "armour", 3, "shoulder", ALL, "upperarm", "uniform", "tan", 160,
      "2 x to the elbow", "2 x tapered sleeve r 0.105 -> 0.085, shoulder to elbow, + cap r 0.115"),
    # ---- SENSORS: helmet, back, chest -------------------------------------
    P("nvg_mount", "sensors", 1, None, ALL, "head", "weapon", "dark", 60,
      "0.05 x 0.06 x 0.04", "0.12 x 0.14 x 0.12 shroud + 0.06 x 0.06 x 0.11 arm"),
    P("counterweight", "sensors", 1, None, ALL, "head", "weapon", "dark", 40,
      "0.09 x 0.04 x 0.06", "0.15 x 0.19 x 0.15 battery pouch at the helmet rear"),
    P("ir_strobe", "sensors", 1, None, ALL, "head", "weapon", "dark", 16,
      "(none given)", "0.11 x 0.11 x 0.07 pale cover on a 0.035 post"),
    P("nvg_mono", "sensors", 2, "nvg", ALL, "head", "weapon", "dark", 70,
      "dia 0.035 x 0.12", "dia 0.10-0.11 x 0.14 tube, flipped up 50 deg, grey lens cap"),
    P("radio_pouch", "sensors", 2, None, ALL, "spine", "uniform", "olive", 48,
      "0.08 x 0.05 x 0.16", "0.10 x 0.16 x 0.28 on the back, left"),
    P("assault_pack", "sensors", 2, None, LEADER, "spine", "uniform", "olive", 180,
      "0.30 x 0.14 x 0.38", "0.22 x 0.42 x 0.50 + 0.06 x 0.34 x 0.08 lid"),
    P("antenna_short", "sensors", 2, "antenna", LEADER, "spine", "weapon", "black", 12,
      "0.6 m, dia 0.008", "0.85 m above the pack, dia 0.03 (whip) on a 0.05 base"),
    P("nvg_quad", "sensors", 3, "nvg", ALL, "head", "weapon", "dark", 120,
      "0.13 x 0.05", "0.32 wide bar + 4 tubes dia 0.064-0.076 x 0.14, flipped up"),
    P("eud_tablet", "sensors", 3, None, ALL, "spine", "weapon", "dark", 40,
      "0.16 x 0.015 x 0.11", "0.09 x 0.28 x 0.19 chest carrier with a dark panel"),
    P("antenna_long", "sensors", 3, "antenna", LEADER, "spine", "weapon", "black", 12,
      "0.9 m, dia 0.008", "1.25 m above the pack, dia 0.03 (whip) on a 0.05 base"),
    # ---- FIREPOWER: the weapon, ammunition, the tools of the trade ---------
    P("optic_dot", "firepower", 1, "optic", ALL, "weapon", "weapon", "black", 40,
      "0.07 x 0.04 x 0.05", "0.19 x 0.115 x 0.125 housing + lens (T1 bolder, lead 28 Oct)"),
    P("foregrip", "firepower", 1, None, ALL, "weapon", "weapon", "black", 24,
      "0.07", "0.105 x 0.105 x 0.24 (T1 bolder, lead 28 Oct)"),
    P("optic_mag", "firepower", 2, "optic", ALL, "weapon", "weapon", "black", 70,
      "dia 0.04 x 0.16", "dia 0.104 x 0.34 tube, bells to 0.144, on a 0.13 x 0.08 x 0.08 mount + offset dot"),
    P("weapon_light", "firepower", 2, None, ALL, "weapon", "weapon", "grey", 30,
      "0.08 x 0.04 x 0.03", "0.15 x 0.10 x 0.10 + aperture"),
    P("mag_pouches", "firepower", 2, None, ALL, "pelvis", "uniform", "olive", 60,
      "0.20 x 0.05 x 0.10", "3 x 0.09 x 0.11 x 0.22 pouches"),
    P("suppressor", "firepower", 3, None, ALL, "weapon", "weapon", "black", 48,
      "dia 0.04 x 0.18", "dia 0.094 x 0.31, three grey bands"),
    P("grenade_pouches", "firepower", 3, None, ALL, "pelvis", "uniform", "olive", 48,
      "2 x 0.07 x 0.05 x 0.09", "2 x 0.13 x 0.13 x 0.22"),
]


#: Parts built as a left and a right object. `L` is the rig's `_L` bone side,
#: which stands at NEGATIVE y in the GLB's Blender frame (forward +x).
SIDED = {"side_plates", "shoulder", "upperarm_guard", "grenade_pouches"}
SIDES = ("L", "R")


def suffix(p):
    return f"kit_{TRACK_LETTER[p.track]}{p.tier}_{p.name}"


def object_suffixes(p):
    """[(object suffix, bone base)] for one part: one entry, or one per side."""
    s = suffix(p)
    if p.name not in SIDED:
        return [(s, p.bone)]
    if p.bone == "upperarm":
        return [(f"{s}_{k}", f"upperarm_{k}") for k in SIDES]
    return [(f"{s}_{k}", p.bone) for k in SIDES]


def part_bone_entries():
    """suffix -> bone base, for rig.PART_BONE."""
    out = {}
    for p in PARTS:
        for suf, base in object_suffixes(p):
            out[suf] = base
    return out


KIT_PART_BONE = part_bone_entries()
