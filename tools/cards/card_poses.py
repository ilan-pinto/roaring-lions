"""Store-card poses (GH-746 SC1): the numbers and the maths. Plain numpy, no bpy, no noise of any kind.

The card is a presentation scene, not a battle frame: its pose exists only in the guide scene
(`render_card_guide.py`), never in a GLB clip. This module holds

  * the approved numbers (design `_coord/store-cards/design.md` section 6: N2 camera, N3 light,
    N4 safe zones, N5 Rifle Squad pose), each with the row it came from;
  * the pure geometry the Blender glue calls: a rigid frame fit for the weapon, a two-bone IK
    for the arm, a swing rotation for a bone. Testable without Blender (`test_card_poses.py`).

FRAMES. Metres, the figure's own frame as the shipped `inf_squad.glb` stands in Blender: +X forward,
+Y toward the rig's `_R` side, +Z up. The rig's L/R are the MIRROR of anatomy: the `_L` hand is the
FIRING hand (it carries `finger_L`, the trigger finger) and sits on -Y; the `_R` hand is the SUPPORT
hand and sits on +Y. Every "firing" / "support" below is by that rule, not by the bone letter alone.
"""
import math

import numpy as np

# --- N1 the card ----------------------------------------------------------------------------
CARD_W, CARD_H = 1536, 1024           # 3:2, the shipped base card
GUIDE_4x3_H = 1152                    # the 4:3 render a nano-banana model takes; the 3:2 card is its middle band

# --- N2 camera -------------------------------------------------------------------------------
CAM_PITCH_DEG = 8.0                   # looking down
CAM_VFOV_DEG = 30.0                   # vertical, of the 3:2 frame
TURN_DEG = 35.0                       # forward turned toward the camera, 35 deg to screen-left (the portrait rule)
TEAM_HEIGHT_FRAC = (0.74, 0.80)       # the team's bounding box, of the card height
FEET_FRAC = (0.86, 0.90)              # the feet line, from the top of the card
TEAM_HEIGHT_TARGET = 0.77
FEET_TARGET = 0.88

# --- N3 light (the portrait rig: tools/render_unit_portraits.py rows 7-9) -------------------------
KEY_AZ_DEG, KEY_EL_DEG, KEY_ENERGY, KEY_TONE = 40.0, 50.0, 3.2, "limestone.0"
FILL_AZ_DEG, FILL_EL_DEG, FILL_ENERGY, FILL_TONE = 55.0, 20.0, 0.7, "water.0"
FILL_OF_KEY = 0.22                    # the design's 0.22 (0.7 / 3.2 = 0.219)

# --- N4 safe zones: fractions of the card (x0, y0, x1, y1), from the top-left ------------------------
SAFE_KIT_MARK = (0.0, 0.0, 0.24, 0.20)          # top-left 24 x 20 %
SAFE_MAXED_STAMP = (1.0 - 0.26, 1.0 - 0.16, 1.0, 1.0)   # bottom-right 26 x 16 %
SAFE_ZONE_FIGURE_MAX = 0.02           # the figure mask may cover at most 2 % of each safe zone (G-C8)
HAND_CLEAR_FRAC = 0.04                # a hand is at least 4 % of the card width from any other figure

# --- N7 masks ---------------------------------------------------------------------------------
DELTA_E = 2.0
DILATE_PX = 4
FEATHER_PX = 6
OVERLAP_MAX = 0.01                    # G-C7

# --- the Rifle Squad card pose: LOW READY, muzzle down (the lead's ruling of 1 Nov, replacing N5's high ready) ----
# The numbers are the audit's A2 low ready (`_coord/inf-audit/audit.md`): muzzle depression 30-40 deg from horizontal,
# firing hand 1.00-1.08 m high, the grip 0.06-0.09 m ahead of the carrier's front face (at that height the front face
# is the pouch line). The azimuth and the roll are mine, found by sweeping them against the hand-visibility report
# (the lead's brief is "angled down across the body, both hands on it, faces clear", every hand >= 0.85 visible):
# with the sights up no azimuth showed more than 0.65 of a hand, the rifle on its side across the body shows 0.93. The support-hand range is not in A2: it is a sanity band of mine.
RIFLE_SQUAD = {
    "team": "inf_squad",
    "pose": "low_ready",
    "figures": ("f0", "f1", "f2"),
    "leader": "f1",                   # in front
    "line_gap_m": 1.1,                # distance between neighbours ALONG the line (N5: "1.1 m apart")
    "line_order": ("f1", "f0", "f2"), # from the front-left end to the back-right end; f1, the leader, is nearest
    "line_deg": 35.0,                 # the line recedes to the right by this angle off the screen horizontal ("shallow")
    "team_height": 0.75,              # of the card height (N2: 74-80 %)
    "team_centre_x": 0.58,            # horizontal middle of the team in the card, so the nearest man clears the kit mark
    "muzzle_elevation_deg": -35.0,    # negative: the muzzle is BELOW horizontal (A2: 30-40 deg of depression)
    "muzzle_azimuth_deg": 110.0,      # off forward toward the support side: across the body, the muzzle at the support hip
    "weapon_cant_deg": -90.0,         # rolled on its side about the bore, so the camera sees the hands' side of the rifle
    "firing_hand_height_m": (1.00, 1.08),
    "firing_hand_ahead_m": (0.06, 0.09),      # in front of the carrier's front face at the hand's height
    "support_hand_height_m": (0.70, 1.00),    # sanity band, not from the audit
    "firing_hand_height_target": 1.04,
    "firing_hand_ahead_target": 0.075,
    "carrier_front_band_m": 0.05,             # the front face is read within this much of the firing hand's height
    "firing_hand_y_from_shoulder": 0.12,      # the grip sits this far inboard of the firing shoulder
    # the elbow hangs down and a little out: a pole direction in the figure frame, per side (+Y is the rig's R)
    "elbow_pole": {"L": (-0.15, -0.55, -1.0), "R": (-0.15, 0.55, -1.0)},
    "shoulder_protract_max_m": 0.11,          # hold.ts protracts the support shoulder by this much; the card allows either side
    # one combined layer where two tracks' masks cannot be told apart (G-C7, the lead's ruling of 1 Nov)
    "combined_layers": (("armour", 3, "sensors", 3),),
}

TEAM_POSES = {"inf_squad": RIFLE_SQUAD}


# --- geometry -----------------------------------------------------------------------------------------

def unit(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    if n < 1e-12:
        raise ValueError("zero vector")
    return v / n


def frame(a, u):
    """Right-handed orthonormal frame (columns: a, u', l) with `a` exact and `u'` the part of `u` square to it."""
    a = unit(a)
    u = np.asarray(u, dtype=float)
    u = unit(u - a * (u @ a))
    l = np.cross(a, u)       # columns (a, u, l = a x u): right-handed
    return np.stack([a, u, l], axis=1)


def rigid_between(a0, u0, a1, u1):
    """The rotation matrix that takes the frame (a0, u0) onto (a1, u1): `R @ a0 = a1`, `R @ u0' = u1'`."""
    return frame(a1, u1) @ frame(a0, u0).T


def swing(y_from, y_to):
    """The smallest rotation taking direction `y_from` onto `y_to` (Rodrigues; the 180 case picks any square axis)."""
    a, b = unit(y_from), unit(y_to)
    c = float(a @ b)
    if c > 1.0 - 1e-12:
        return np.eye(3)
    if c < -1.0 + 1e-12:
        axis = unit(np.cross(a, [1.0, 0.0, 0.0]) if abs(a[0]) < 0.9 else np.cross(a, [0.0, 1.0, 0.0]))
        return 2.0 * np.outer(axis, axis) - np.eye(3)
    v = np.cross(a, b)
    k = np.array([[0.0, -v[2], v[1]], [v[2], 0.0, -v[0]], [-v[1], v[0], 0.0]])
    return np.eye(3) + k + k @ k * (1.0 / (1.0 + c))


def axis_angle(axis, deg):
    ax = unit(axis)
    t = math.radians(deg)
    k = np.array([[0.0, -ax[2], ax[1]], [ax[2], 0.0, -ax[0]], [-ax[1], ax[0], 0.0]])
    return np.eye(3) + math.sin(t) * k + (1.0 - math.cos(t)) * (k @ k)


def signed_angle(frm, to, axis):
    """Angle (degrees) turning `frm` onto `to` about `axis`, both projected square to it."""
    ax = unit(axis)
    f = np.asarray(frm, float) - ax * (np.asarray(frm, float) @ ax)
    t = np.asarray(to, float) - ax * (np.asarray(to, float) @ ax)
    return math.degrees(math.atan2(float(ax @ np.cross(f, t)), float(f @ t)))


def solve_two_bone(P, W, a, b, pole, tol=1e-6):
    """Elbow position for a shoulder `P`, a wrist target `W`, bone lengths `a` (upper) and `b` (fore), and an
    elbow `pole` direction. Returns (E, reach) where `reach` is the clamped shoulder-to-wrist distance and
    `short` (third value) is how far the target lies beyond full extension (0 when it is reachable)."""
    P, W = np.asarray(P, float), np.asarray(W, float)
    d_raw = float(np.linalg.norm(W - P))
    lo, hi = abs(a - b) + tol, a + b - tol
    d = min(max(d_raw, lo), hi)
    u = (W - P) / max(d_raw, 1e-12)
    cos_a = (a * a + d * d - b * b) / (2.0 * a * d)
    cos_a = min(1.0, max(-1.0, cos_a))
    sin_a = math.sqrt(1.0 - cos_a * cos_a)
    p = np.asarray(pole, float)
    n = p - u * (p @ u)
    if np.linalg.norm(n) > 1e-9:
        n = unit(n)
    else:        # the pole lies along the shoulder-wrist line: any square direction will do; pick a stable one
        n = unit(np.cross(u, [0.0, 0.0, 1.0] if abs(u[2]) < 0.9 else [1.0, 0.0, 0.0]))
    E = P + u * (a * cos_a) + n * (a * sin_a)
    return E, d, max(0.0, d_raw - hi)


def protraction_needed(P, W, a, b, direction, cap):
    """Smallest shoulder shift along `direction` (up to `cap`) that makes the wrist reachable; 0 if it already is."""
    P, W = np.asarray(P, float), np.asarray(W, float)
    reach = a + b - 1e-3
    if np.linalg.norm(W - P) <= reach:
        return 0.0
    dr = unit(direction)
    best = cap
    for k in range(0, 1001):
        s = cap * k / 1000.0
        if np.linalg.norm(W - (P + dr * s)) <= reach:
            best = s
            break
    return best


def check_hand_numbers(m, spec):
    """Per-figure measured hand numbers against the N5 ranges. `m` carries `firing_height`, `firing_ahead`,
    `support_height` (metres). Returns a list of (name, value, lo, hi, ok)."""
    rows = []
    for key, mk in (("firing_hand_height_m", "firing_height"), ("firing_hand_ahead_m", "firing_ahead"),
                    ("support_hand_height_m", "support_height")):
        lo, hi = spec[key]
        v = m[mk]
        rows.append((key, v, lo, hi, lo <= v <= hi))
    return rows


def safe_zone_px(zone, w=CARD_W, h=CARD_H):
    x0, y0, x1, y1 = zone
    return (int(round(x0 * w)), int(round(y0 * h)), int(round(x1 * w)), int(round(y1 * h)))
