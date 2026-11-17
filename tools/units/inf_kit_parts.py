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
from dataclasses import dataclass, field

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
BASE_PARTS = [
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


# ================================================================ THE TEAMS
#
# The Rifle Squad's table above is the TEMPLATE. Every other team is a `Team`: its own figure
# prefixes (`demo_a`, not `f0`), its leader, which figures carry a gun, its atlas size and its five
# pinned texels (5 x 5 solid blocks, std < 4/255, `tools/inf_kit_texels.py`), and what differs from
# the template (parts the bake already shows, the role the devices ride, the clips its census walks).
# `use_team(id)` rebinds `ALL` / `LEADER` / `RIFLEMEN` / `PARTS` / `TEXELS` / the atlas size IN PLACE for
# the rest of the process, so a tool picks a team once and every `kp.X` it reads afterwards is that
# team's. The default is `inf_squad` and leaves this module exactly as the Rifle Squad shipped it.


@dataclass
class Team:
    id: str
    figs: tuple
    leader: tuple
    armed: tuple                 # figures that carry `weapons[0]`'s gun: weapon-bone parts go on these only
    atlas: tuple                 # (w, h) of the team's colour atlas
    texels: dict
    device_role: str = "weapon"  # the role a `weapon`-role device rides: `uniform` where the weapon primitive is a palette one
    drop: tuple = ()             # parts the bake already shows (gear already baked in is not added twice)
    prims: tuple = ("uniform", "boot", "face", "weapon")     # every primitive of the file the census treats as body
    bank_prims: tuple = ("uniform", "weapon")                # primitives the wraps are trimmed against
    clips: tuple = ("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned")   # the living clips
    bank_clips: tuple = ("idle", "move", "fire", "moveFire", "kneel", "pinned")
    torso_ring_cap: bool = False       # cap the torso wrap's sampled radii by the ring its own front and back walls imply (loose shards, spine-bound hands)
    weapon_by_surface: bool = False    # read the gun's top / bottom / width off its faces (a sparse gun has no vertices at most stations)
    clear_pouches: bool = False        # turn the belt pouches to where no other bone's geometry strikes them in any key of any living clip
    flip_deg: float = 70.0             # a flipped-up NVG tube: degrees up from the helmet front's normal
    yoke_cols: int = 9                 # columns of the yoke horseshoe
    nvg_lift: float = 0.0              # a baked mount: how far above the bracket's front tip the tubes and the bridge sit
    bridge_back: float = 0.004         # a baked mount: how far behind the bracket's front tip the binocular bridge's centre sits
    stage_hide: tuple = ()             # base primitives left out of the garage / close-up / turntable stills (a world-fixed prop on the ground)
    torso_vest_lum: float = None       # fit the torso wraps to the baked vest: spine triangles whose atlas texel is darker than this (0-1)
    torso_ellipse: tuple = (0.20, 0.185)   # the section ellipse a bridged (unsampled) torso vertex stays inside
    carrier_back_plate: bool = False   # the carrier's back is a flat upright plate (a plane fitted to the back wall), thin, upper back only
    helmet_front_trim: float = 0.0     # degrees either side of the front where the cover's lowest band is left off (the open face of a baked helmet)
    yoke_rmax: float = None            # cap on the yoke's radius from the spine axis (the collar, not a cape over the shoulders)
    yoke_slack: float = 0.015          # how far past its clearance trim the yoke's offset may stand (the Rifle Squad's 15 mm)
    pack_box: bool = False             # the T3 radio pack is a flat-sided box with a lid, not a pad conformed to the back
    baked_mount: bool = False    # the helmet already carries an NVG shroud and mount: the tubes ride it, `nvg_mount` is not built
    dense_keys: bool = False     # sample every keyframe of a short clip and the clip's last frame (not a stride alone)
    belt_from_spine: float = None   # the belt line this far under each figure's own spine joint, its ring centred on the hips (not 0.9125 m about the root)
    pouch_turn_max: float = None    # the furthest (degrees) `clear_pouches` may turn a pair of belt pouches off its nominal angles (None: the search's own 120)
    torso_from_joints: tuple = None   # (m under the shoulder joints, m under the spine joint): the carrier's collar and hem, the yoke and the radio rows on each figure's OWN trunk
    carrier_trim: dict = None    # cut a v7 carrier to a plate carrier's outline: {half_w, drop, corner} (`inf_kit_v7._carrier_trim`)
    headset_below_rim: float = None   # the ear cup's centre this far under each figure's OWN helmet rim (not 1.572 m, the Rifle Squad's metres)
    headset_clear_gun: float = None   # ...and both cups raised, in 2 mm steps up to this (plus one step of air), until no gun triangle crosses one in any sampled key
    groin_wrap: bool = False     # a v7 groin apron is turned to face the way the belt's front faces under it (a body whose hips stand turned)
    v7: bool = False             # the approved v7 mesh parts (art/parts/inf_kit/v7, `inf_kit_v7.py`) stand in for the procedural builders
    part_tris: dict = field(default_factory=dict)   # this team's own per-NODE triangle rows (the graft's 1.10x limit); a part not named reads the shared table in kit-contract.ts
    notes: str = ""


_BASE_ALL, _BASE_LEADER, _BASE_RIFLEMEN = ALL, LEADER, RIFLEMEN

#: The Rifle Squad's per-NODE triangle rows for the v7 parts (a sided part is one node per side; the mag and grenade pouches are
#: two pouches in one node). Pinned to `art/parts/inf_kit/v7/kit_parts_report.json` by `test_inf_kit_parts.py` and to
#: `INFANTRY_KIT_TEAM_PART_TRIS` in `tools/src/meshes/kit-contract.ts` by `kit-contract.test.ts`. The carrier is the v7 part
#: decimated 2,474 -> 2,299 to hold the lead's 7,200 per figure (9 Nov, GH-746).
V7_PART_TRIS = {
    "battle_belt": 556, "carrier": 2299, "counterweight": 140, "grenade_pouches": 392, "groin": 220,
    "headset": 280, "ir_strobe": 116, "laser_box": 192, "lpvo": 326, "mag_pouches": 592, "nvg_bino": 336, "nvg_mono": 348,
    "radio_pack": 514, "radio_panel": 386, "radio_pouch": 346, "red_dot": 198, "suppressor": 140, "throat": 188,
    "weapon_light": 216,
}

TEAMS = {
    # Meshy pilot f1 (1 Nov 2026): the skinned figure's own 2048 x 2048 bake (retinted olive / dark brown / tan), its
    # texels found by `_coord/inf-meshy-pilot/tools/find_texels.py` (solid 5 x 5 blocks nearest each key; dE 0.4-4.5)
    "inf_squad": Team("inf_squad", ALL, LEADER, ALL, (2048, 2048), {
        # re-found 9 Nov (round 3) by `tools/inf_kit_texels.py inf_squad` after the vest and sleeve retints
        "coyote": (1369, 279),          # dust.5   #806032  dE 0.06 (re-found round 5, after the per-texel glove)
        "coyote_shade": (799, 590),    # dust.6   #6B4F29  dE 3.33 (inside the 6.0 cap)
        "olive": (1680, 987),          # olive.2  #4E5433  dE 0.49
        "olive_dark": (1740, 125),     # olive.3  #333821  dE 0.75
        "glass": (1467, 1413),         # shadow.0 #23241F  dE 0.17
    },
                      bank_clips=("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned"), clear_pouches=True, dense_keys=True, flip_deg=120.0,
                      # what the Meshy bake already shows (9 Nov, the step-9 re-fit): a helmet with an NVG shroud and mount
                      # (the tubes ride it; `nvg_mount` is not added twice; the cover is open at the face) and a black plate
                      # carrier the wraps fit to, as the Demolition squad's do. No deltoid or sleeve armour: a skinned upper
                      # arm is welded to the ribs, so its surface by dominant bone is shoulder AND chest wall, and the arm
                      # wraps came out as flat slabs standing off the shoulder (9 Nov render) -- the lead's ruling for the
                      # Demolition squad (30 Oct), applied here (the lead accepted it for this figure on 9 Nov)
                      # eud: dropped from this squad's sensors tier 3 for the pilot (the lead, 10 Nov 2026, GH-746): no chest or wrist spot
                      # clears the grip, arm, neck and throat on this carrier; it returns later as a smaller wrist-strapped part
                      drop=("nvg_mount", "deltoid", "sleeve", "eud"), baked_mount=True, helmet_front_trim=60.0, torso_ring_cap=True,
                      # the lead (9 Nov, GH-746): the approved v7 kit set is fitted to this figure
                      v7=True, part_tris=V7_PART_TRIS),
                      # (no `torso_vest_lum`: since 9 Nov the bake's vest is retinted to the carrier's coyote, so it is no
                      # longer the near-black texels the wraps used to find it by; the wraps fit the whole spine zone)
    # Combat Engineers (GH-826; infantry upgrade unit 1, the lead's approval of 12 Nov 2026). Since 13 Nov the team is ONE
    # skinned Meshy body in two scalings (`import_meshy_skinned_team.py`), both men armed with Meshy's own carbine, on a
    # 2048 x 2048 bake retinted as the Rifle Squad's: the approved v7 kit set is re-fitted to it exactly as it was fitted
    # to the Rifle Squad (the same flags), at 0 credits. Firepower goes on BOTH men now that demo_a carries a gun. What is
    # this team's own: the cable spool (`metal`, on demo_b's spine) and the charge (`charge`, on `prop`) are body the
    # wraps and the census see, the charge is left out of the stage stills, and `work` is a living clip.
    # Texels re-found 13 Nov by `tools/inf_kit_texels.py demo_squad` on the final atlas (after the shoulder and carrier retints).
    "demo_squad": Team(
        "demo_squad", ("demo_a", "demo_b"), ("demo_b",), ("demo_a", "demo_b"), (2048, 2048),
        {
            "coyote": (225, 1656),         # dust.5   #806032  dE 0.03
            # round 4 (16 Nov 2026): re-found by the same tool after `sweep_hem`. The block pinned on 13 Nov, (998, 700), lies
            # on the baked vest's hem beside faces that sweep repaints; the atlas ships as a JPEG, whose chroma blocks carried
            # the repaint into it ((118, 84, 47) -> (121, 85, 35)), and `test_inf_kit_parts.py` went red on the pin.
            "coyote_shade": (995, 704),    # dust.6   #6B4F29  dE 2.97 (inside the 6.0 cap; the Rifle Squad's is 3.33)
            "olive": (1969, 992),          # olive.2  #4E5433  dE 0.48
            "olive_dark": (1177, 1297),    # olive.3  #333821  dE 0.38
            "glass": (1045, 983),          # shadow.0 #23241F  dE 0.52
        },
        # dropped as on the Rifle Squad (the plan, section 2): the NVG mount (baked), deltoids, sleeves and the EUD
        drop=("nvg_mount", "deltoid", "sleeve", "eud"), baked_mount=True, helmet_front_trim=60.0, torso_ring_cap=True,
        prims=("uniform", "boot", "face", "weapon", "metal", "charge"),
        bank_prims=("uniform", "weapon", "metal", "charge"),
        clips=("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "work"),
        bank_clips=("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "work"),
        stage_hide=("charge",), clear_pouches=True, dense_keys=True, flip_deg=120.0,
        v7=True, part_tris=V7_PART_TRIS, groin_wrap=True,
        # The belt line. The kit's belt heights are the Rifle Squad's metres (the belt ring at 0.9125, the pouches at 0.905 and
        # 0.855), about each figure's ROOT. This body's hip joints stand higher (0.52 of the stature against 0.49: demo_a's at
        # 0.956) and its hips stand 10 cm behind its ankles, so at 0.9125 about the root the ring read the tops of the thighs
        # from a centre in front of them: demo_a's battle belt stood a median 93 mm off the body (p90 180) and his groin apron
        # 186 mm, against the Rifle Squad's 29-34 and 67-106 (the Opus review of 13 Nov; `tools/inf_kit_standoff.py`). The
        # baked web belt is 65 mm under the spine joint on both men (z 1.025 on demo_a, 0.965 on demo_b), and the ring is
        # centred on the hips' own section there.
        belt_from_spine=0.065,
        # the gun's stations are read off its SURFACE (rays), not its vertices within 2.5 cm: the handguard's lowest vertex
        # near the foregrip's station is 11-15 mm under the surface over the grip, and the grip hung in the air by that much
        weapon_by_surface=True,
        # the belt pouches keep to their own quarter: with the belt at the waist the grenade pouches (right rear, 120 / 150
        # degrees) found no clear angle in every clip and the search took its least-bad one, +100 degrees: onto the magazine
        # pouches at 240 / 270 (the second look at sheet v2, 13 Nov)
        pouch_turn_max=40.0,
        # Round 3 (the second Opus review, 13 Nov; the lead's list): the firing-shoulder cavity in the aimed back views. The
        # shell's back upper corners and the rear lips of its armholes stood 60-96 mm off the body at rest. The shell is cut
        # to a plate carrier's outline: above 0.26 m under the collar (the cummerbund's top, under the arm) only the plate
        # bag stays, 0.13 m either side of the centre line, its inner corners clipped 0.03 m (`inf_kit_v7._carrier_trim`).
        # (0.20 was tried first: the wall left between 0.20 and 0.26 stood as an open lip under the raised arm in the aimed
        # clips, seen from behind and above; a lip closing the cut down to the skin was tried too and read as slats.)
        carrier_trim=dict(half_w=0.13, drop=0.26, corner=0.03),
        # ...and it is worn where each man's trunk is: the collar 40 mm under his shoulder joints, the hem 35 mm under his
        # spine joint. Those are demo_a's own (1.460 and 1.090: his rows do not move); demo_b's joints stand at 1.380 and
        # 1.030, and at the Rifle Squad's 1.42 the shell's collar stood 4 cm OVER his shoulder joints, in the air behind
        # his neck (the plate bag's top 95 mm off his back at rest). The yoke and the radio rows go with it.
        torso_from_joints=(0.040, 0.035),
        # ...and the ear cup the stock ran through: the cups are SEATED at each man's own ears (48 mm under his helmet's rim:
        # the widest station of both faces is 30-70 mm under it) and then RAISED until the stock's comb passes under the
        # firing-side cup at the cheek weld: 22 mm on demo_a, 32 mm on demo_b. So as shipped the cups' centres stand 26 and
        # 16 mm under the rim, about 2-3 cm ABOVE the ear, not at it (the lead's L3, 16 Nov 2026: accepted as a named item).
        headset_below_rim=0.048, headset_clear_gun=0.030),
}

TEAM = TEAMS["inf_squad"]
ATLAS_W, ATLAS_H = TEAM.atlas
PARTS = list(BASE_PARTS)


def _resolve(part, team):
    figs = part.figs
    if set(figs) == set(_BASE_ALL):
        figs = team.figs
    elif set(figs) == set(_BASE_LEADER):
        figs = team.leader
    elif set(figs) == set(_BASE_RIFLEMEN):
        figs = tuple(f for f in team.figs if f not in team.leader)
    if part.bone == "weapon":
        figs = tuple(f for f in figs if f in team.armed)
    role = team.device_role if part.role == "weapon" else part.role
    return part._replace(figs=tuple(figs), role=role)


def use_team(team_id):
    """Rebind the module's tables to `team_id`'s (in place: `TEXELS` and `PARTS` keep their identity)."""
    global ALL, LEADER, RIFLEMEN, TEAM, ATLAS_W, ATLAS_H
    team = TEAMS[team_id]
    TEAM = team
    ALL, LEADER = tuple(team.figs), tuple(team.leader)
    RIFLEMEN = tuple(f for f in team.figs if f not in team.leader)
    ATLAS_W, ATLAS_H = team.atlas
    TEXELS.clear()
    TEXELS.update(team.texels)
    PARTS[:] = [_resolve(p, team) for p in BASE_PARTS if p.name not in team.drop]
    return team


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
