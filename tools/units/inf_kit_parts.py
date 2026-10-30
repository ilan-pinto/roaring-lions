"""The infantry upgrade kit's part manifest, REDESIGNED (GH-826, "real gear, fitted").
Plain Python, no bpy.

One table, read by three things: `inf_kit.py` (builds the geometry),
`rig.PART_BONE` (every kit suffix is added to it, so a part with no bone still
raises in `rig_parts` -- extend, never silence), and the render tool's tier
filter. It is importable outside Blender so a test can pin it.

A part's object name is `{figure}_kit_{track letter}{tier}_{part}`, for example
`f1_kit_s3_radio_pack`; the SUFFIX `kit_s3_radio_pack` is the PART_BONE key.

Supersedes the 26 Oct manifest (PR 885, `91dabb5f`): every part there was about
3x real size, flat-shaded and pale tan. This one is the 28 Oct redesign spec
(`_coord/inf-kit/redesign-spec.md`, lead-approved on GH-826): real-world sizes at
1.00x (helmet-mounted devices 1.08x, because the Meshy helmet is 1.08x a real
one), soft goods shrink-wrapped to the figure's own surface, smooth shading, two
colour families (coyote and olive), glass faces near-black.

`spec_tris` is the spec's per-part triangle column (section 3). The per-part
refusal limit is 1.10x that column (ruling Q8: it is re-based on THIS table;
render-1's part names are retired). Metres, x forward, y across, z up.
"""
from collections import namedtuple

Part = namedtuple("Part", "name track tier slot figs bone role texel spec_tris real game")

TRACKS = ("armour", "sensors", "firepower")
TRACK_LETTER = {"armour": "a", "sensors": "s", "firepower": "f"}
ALL = ("f0", "f1", "f2")
LEADER = ("f1",)
RIFLEMEN = ("f0", "f2")
PART_LIMIT = 1.10        # per-part refusal limit, x the spec column (ruling Q8)

# Texel names -> (px, py) in the shipped inf_squad atlas (2048 x 1024, py from the
# top): each the centre of a SOLID 9 x 9 block (per-channel std < 5/255) that is
# within dE76 2.4 of the palette key it stands for (spec section 2.2). Pinned
# UVs: the kit adds no texture, no material and no palette primitive.
#   key      hex      texel rgb      dE76   luminance
TEXELS = {
    "coyote": (1016, 664),         # dust.5   #806032  125, 94, 49    1.0  99
    "coyote_shade": (12, 396),     # dust.6   #6B4F29  111, 81, 42    1.8  82
    "olive": (1712, 544),          # olive.2  #4E5433  79, 81, 49     2.4  80
    "olive_dark": (1508, 500),     # olive.3  #333821  53, 55, 32     1.5  53
    "glass": (1224, 880),          # shadow.0 #23241F  35, 36, 31     0.3  35
}
PALETTE_KEY = {"coyote": "dust.5", "coyote_shade": "dust.6", "olive": "olive.2",
               "olive_dark": "olive.3", "glass": "shadow.0"}

P = Part
PARTS = [
    # ---- ARMOUR: the carrier and cover (T1), deltoids/throat/groin (T2), sleeves/yoke (T3)
    P("carrier", "armour", 1, None, ALL, "spine", "uniform", "coyote", 190,
      "SAPI-M 0.241 x 0.318 x 0.022 under 3 mm of fabric; cummerbund 0.15-0.18 tall",
      "shrink-wrap of the figure's own vest zone: +0.022 on the plates, +0.006 on the cummerbund; rolled rim; dust.6 bands"),
    P("helmet_cover", "armour", 1, None, ALL, "head", "uniform", "olive", 64,
      "cloth over an ACH/FAST, 3-5 mm; scrim band 25 mm",
      "shrink-wrap of the helmet shell +0.005, a 0.025 band 3 mm proud; no flap, no lifted rim"),
    P("deltoid", "armour", 2, "shoulder", ALL, "upperarm", "uniform", "coyote", 48,
      "deltoid protector 0.15 x 0.13 x 0.010",
      "2 x a curved cap on the top 0.14 of the upper arm, lateral 180 deg, +0.008, rolled rim"),
    P("throat", "armour", 2, None, ALL, "spine", "uniform", "coyote", 28,
      "throat protector 0.20 x 0.11 x 0.010", "0.18 x 0.10 x 0.012 hanging from the carrier's front top edge"),
    P("groin", "armour", 2, None, ALL, "pelvis", "uniform", "coyote", 32,
      "groin protector 0.25 x 0.20 x 0.012", "0.20 -> 0.14 wide, 0.14 tall below the belt, 0.012 thick, curved to the belt front"),
    P("sleeve", "armour", 3, "shoulder", ALL, "upperarm", "uniform", "coyote", 80,
      "DAPS upper-arm protection, about 0.30 long, +0.010",
      "2 x a shrink-wrap of the upper arm, shoulder to 0.03 above the elbow, lateral 200 deg (open medial), +0.010"),
    P("yoke", "armour", 3, None, ALL, "spine", "uniform", "coyote", 32,
      "yoke and collar 0.06 tall, 0.015-0.020 thick",
      "a horseshoe round the back and sides of the neck base, open at the throat; top z <= 1.45"),
    # ---- SENSORS: head comms (T1), monocular and radios (T2), binocular, EUD and man-pack (T3)
    P("headset", "sensors", 1, None, ALL, "head", "weapon", "olive_dark", 64,
      "ComTac-class ear cup 0.080 x 0.065 x 0.045 on a rail arm",
      "x1.08: 2 x cup 0.086 x 0.070 x 0.049 at ear level under the rim, on a 0.015 arm to the rail"),
    P("nvg_mount", "sensors", 1, None, ALL, "head", "weapon", "olive_dark", 40,
      "shroud 0.070 x 0.060 x 0.015; L4-class mount 0.075 x 0.055 x 0.040, folded",
      "x1.08: shroud 0.076 x 0.065 x 0.016 conformed to the helmet front; mount 0.081 x 0.059 x 0.043"),
    P("ir_strobe", "sensors", 1, None, ALL, "head", "weapon", "olive_dark", 16,
      "MS-2000 class 0.055 x 0.040 x 0.025", "x1.08: 0.059 x 0.043 x 0.027 flat on the crown, rear of centre; no post"),
    P("nvg_mono", "sensors", 2, "nvg", ALL, "head", "weapon", "olive_dark", 52,
      "PVS-14 0.114 x 0.051 x 0.064, objective dia 0.044", "x1.08: 0.123 long, body dia 0.055, flipped up 70 deg on the mount"),
    P("counterweight", "sensors", 2, None, ALL, "head", "uniform", "olive", 24,
      "battery pouch 0.110 x 0.060 x 0.040", "x1.08: 0.119 x 0.065 x 0.043 conformed to the helmet's rear curve"),
    P("radio_pouch", "sensors", 2, None, RIFLEMEN, "spine", "uniform", "olive", 46,
      "PRC-152 class 0.076 x 0.066 x 0.245 in a 0.09 x 0.08 x 0.21 pouch, 0.20 stub antenna",
      "pouch 0.09 x 0.08 x 0.21 on the left rear (y -0.12 to -0.20) + a dia 0.012 x 0.20 stub"),
    P("radio_panel", "sensors", 2, "back", LEADER, "spine", "uniform", "olive", 48,
      "zip-on radio panel 0.25 x 0.30 x 0.07", "0.25 x 0.30 x 0.07 conformed to the back (4 columns), top at z <= 1.38"),
    P("whip_short", "sensors", 2, "antenna", LEADER, "spine", "weapon", "olive_dark", 30,
      "tape whip 0.9, 15-25 mm wide, on a gooseneck base dia 0.025 x 0.08",
      "0.85 above the base, dia 0.024 -> 0.012, base dia 0.03 x 0.08; off the left shoulder, leaning back 8 deg"),
    P("nvg_bino", "sensors", 3, "nvg", ALL, "head", "weapon", "olive_dark", 88,
      "PVS-31 class 0.115 x 0.075 x 0.100, tubes dia 0.040", "x1.08: bridge 0.124 x 0.035 x 0.04; 2 tubes dia 0.043 x 0.10, flipped up"),
    P("eud", "sensors", 3, None, ALL, "spine", "weapon", "olive_dark", 24,
      "phone 0.160 x 0.080 x 0.015 on a folding panel 0.18 x 0.10 x 0.02", "0.17 x 0.09 x 0.025, high on the left chest, flat on the plate"),
    P("radio_pack", "sensors", 3, "back", LEADER, "spine", "uniform", "olive", 84,
      "PRC-117G class in a small pack about 0.13 x 0.26 x 0.30", "0.13 x 0.26 x 0.30 on the upper back, top at z <= 1.40, 2 shoulder straps"),
    P("whip_long", "sensors", 3, "antenna", LEADER, "spine", "weapon", "olive_dark", 30,
      "tape whip 1.2-1.5", "1.25 above the base, dia 0.024 -> 0.012, from the top of the pack"),
    # ---- FIREPOWER: belt, pouches, red dot, grip (T1), LPVO, laser, light (T2), can, grenades (T3)
    P("battle_belt", "firepower", 1, None, ALL, "pelvis", "uniform", "coyote_shade", 64,
      "padded war belt 0.045-0.060 tall, 0.015 thick", "shrink-wrap of the pelvis belt band, +0.012, 0.055 tall, rolled top and bottom"),
    P("mag_pouches", "firepower", 1, None, ALL, "pelvis", "uniform", "coyote", 56,
      "2 x double M4 open-top pouch 0.080 x 0.060 x 0.120", "2 pouches 0.08 x 0.06 x 0.12 on the left hip at 8 and 9 o'clock, mags proud 0.025"),
    P("red_dot", "firepower", 1, "optic", ALL, "weapon", "weapon", "coyote", 44,
      "Aimpoint Micro T-2 class 0.064 x 0.041 x 0.048, body dia 0.030, LRP mount, axis 0.039", "exactly that"),
    P("foregrip", "firepower", 1, None, ALL, "weapon", "weapon", "coyote", 28,
      "vertical grip 0.100 x dia 0.032", "0.10 x dia 0.032, 0.17 behind the muzzle"),
    P("lpvo", "firepower", 2, "optic", ALL, "weapon", "weapon", "coyote", 88,
      "1-6x24 0.265 long, tube dia 0.030, eyepiece dia 0.044, objective dia 0.038",
      "0.265 long, 0.55 to 0.285 behind the muzzle, axis 0.040 over the rail, 2 turrets"),
    P("laser_box", "firepower", 2, None, ALL, "weapon", "weapon", "coyote", 32,
      "PEQ-15 class 0.109 x 0.069 x 0.038", "0.109 x 0.069 x 0.038 on the top rail, ahead of the optic"),
    P("weapon_light", "firepower", 2, None, ALL, "weapon", "weapon", "coyote", 28,
      "M600 class 0.140 x dia 0.025", "0.14 x dia 0.025 at 3 o'clock on the handguard"),
    P("suppressor", "firepower", 3, None, ALL, "weapon", "weapon", "coyote", 44,
      "5.56 can 0.165 x dia 0.038", "0.165 x dia 0.038, QD collar 0.042, chamfered front, bore recess; no bands"),
    P("grenade_pouches", "firepower", 3, None, ALL, "pelvis", "uniform", "coyote", 48,
      "frag pouch 0.075 x 0.055 x 0.110", "2 pouches 0.075 x 0.055 x 0.11 on the right rear of the belt, at 4 and 5 o'clock"),
]


#: Parts built as a left and a right object. `L` is the rig's `_L` bone side,
#: which stands at NEGATIVE y in the GLB's Blender frame (forward +x).
SIDED = {"deltoid", "sleeve", "headset"}
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
