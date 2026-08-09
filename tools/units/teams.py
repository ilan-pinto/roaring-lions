"""The nine infantry teams, composed from kit.py.

All nine live in one file rather than one file each, unlike the buildings. The
reason is the requirement: distinctness is a *joint* property. Nine human figures
have to stay apart from each other under a 0.88 silhouette limit, and a change to
the mortar team's massing is only safe if you can see the mortar crew's on the
same screen. Buildings were large enough to want a file each; a team is twenty
lines.

A clip is a composition, not a pose. `build(team, clip, frame)` returns a fresh
scene, so `move` really is different geometry from `idle` rather than the same
geometry deformed. The clip scheme:

    idle    the deployed arrangement
    move    standing figures' legs split fore-and-aft over four frames
    fire    standing figures drop to a knee -- a firing line goes to ground
    down    everyone prone, gone to ground under suppression
    wreck   prone, rendered in the casualty material

Two limitations, stated rather than hidden:

  * **Crew-served weapons stay deployed through `move`.** A mortar team really
    walks with the tube shouldered. Authoring a carried state per crew weapon
    roughly doubles the work for something invisible at 25 px, which is what the
    rig contract measured infantry at. render_soldier.py already made this trade,
    layering leg swing over a fixed upper body so the rifle stays up.
  * **`sniper_team`'s `down` cannot be "go prone"** because it starts prone. It
    closes up and flattens instead, or the clip is indistinguishable from idle.

Coordinates are in metres, x forward along the facing, y lateral. The kit builds
at metres by construction, which is why render_team.py takes metres-per-unit as
exactly 1.0 rather than deriving it.
"""
import math

import kit

#: Frames in the walk cycle, and the stride at each. Four is what closes a cycle
#: without a visible jump: 0 -> forward -> 0 -> back.
MOVE_STRIDE = (0.0, 1.0, 0.0, -1.0)

# On `leader=True`: exactly one figure per team carries the radio antenna, and it
# is the figure who would really carry it -- the spotter, the loader, the number
# three, the squad's middle man. On every figure the antennas read as a picket
# fence, and they would compete with the mortar tube that keeps two of the nine
# sheets apart.

#: Which palette ramp a faction's `uniform` and `webbing` roles resolve to.
#: KDF olive against militia dust is a second readability channel independent of
#: the marker ring -- and today there is no channel at all, because all seven
#: shared types are the same PNG.
FACTIONS = {"kdf": "olive", "enemy": "dust"}


def _standing_posture(clip):
    """What an upright figure does in this clip."""
    if clip == "fire":
        return "kneeling"
    if clip in ("down", "wreck"):
        return "prone"
    return "standing"


def _stride(clip, frame):
    return MOVE_STRIDE[frame % len(MOVE_STRIDE)] if clip == "move" else 0.0


def _crew_posture(clip):
    """What a figure already on the ground does. Crew stay at their weapon until
    they are suppressed, at which point they come off it."""
    return "prone" if clip in ("down", "wreck") else "kneeling"


def _weapon_visible(clip):
    """A crew weapon is abandoned when its crew goes flat. Keeping a deployed
    tripod standing over two prone bodies reads as a bug, not as suppression."""
    return clip not in ("down", "wreck")


# --- the nine --------------------------------------------------------------


def inf_squad(clip, frame):
    """Rifle Squad, crew 8. Three upright figures in a wide line -- the baseline
    every other silhouette has to differ from, and the widest of the standing
    groups so it separates from the two-figure militia cell."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    out = []
    for i, y in enumerate((-0.78, 0.0, 0.78)):
        x = 0.20 if i == 1 else 0.0
        out += kit.figure(f"rifle{i}", (x, y, 0.0), posture=p, stride=st, leader=(i == 1))
        out += kit.rifle(f"rifle{i}_w", (x, y, 0.0), posture=p)
    return out


def militia_cell(clip, frame):
    """Militia Cell, crew 6. Two figures in a touching pair, cloth heads. Held to
    two and kept tight so it reads lighter than the rifle squad's spread three --
    the helmet difference is worth about two pixels and cannot carry this."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    out = []
    for i, (x, y) in enumerate(((0.0, -0.24), (0.12, 0.26))):
        out += kit.figure(f"mil{i}", (x, y, 0.0), posture=p, stride=st, helmet=False,
                          leader=(i == 0))
        out += kit.rifle(f"mil{i}_w", (x, y, 0.0), posture=p)
    return out


def demo_squad(clip, frame):
    """Combat Engineers, crew 5. One figure low over a satchel charge, one upright
    with a cable reel. The mixed height plus the reel's disc-on-edge is the tell:
    no weapon in the set draws a disc."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    out = kit.figure("demo_a", (0.34, -0.16, 0.0), posture=_crew_posture(clip), yaw=0.0)
    if _weapon_visible(clip):
        out += kit.demo_charge("demo_charge", (0.76, -0.16, 0.0))
    out += kit.figure("demo_b", (-0.36, 0.28, 0.0), posture=p, stride=st, leader=True)
    out += kit.cable_spool("demo_spool", (-0.36, 0.28, 0.0))
    out += kit.rifle("demo_b_w", (-0.36, 0.28, 0.0), posture=p)
    return out


def at_team(clip, frame):
    """Spike AT Team, crew 3. A kneeling firer with the launcher held **level**,
    and a standing spotter on binoculars. Level is the whole separation from the
    RPG team: same parts, different tube axis, and the gate reads axis where it
    cannot read a texture."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    out = kit.figure("at_fire", (0.24, -0.30, 0.0), posture=_crew_posture(clip))
    if _weapon_visible(clip):
        out += kit.launcher("at_tube", (0.24, -0.30, 1.02), pitch=0.0, length=1.16)
    out += kit.figure("at_spot", (-0.32, 0.34, 0.0), posture=p, stride=st, leader=True)
    out += kit.binoculars("at_binos", (-0.32, 0.34, 0.0), posture=p)
    return out


def rpg_team(clip, frame):
    """RPG Team, crew 3. Standing firer, tube pitched **steeply up**, plus a
    loader. Upright and diagonal against the AT team's kneeling and level."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    out = kit.figure("rpg_fire", (0.18, -0.26, 0.0), posture=p, stride=0.0, helmet=False)
    if _weapon_visible(clip):
        out += kit.launcher("rpg_tube", (0.18, -0.26, 1.46),
                            pitch=math.radians(38.0), length=1.24, radius=0.075)
    out += kit.figure("rpg_load", (-0.30, 0.30, 0.0), posture=p, stride=st, helmet=False,
                      leader=True)
    out += kit.rifle("rpg_load_w", (-0.30, 0.30, 0.0), posture=p)
    return out


def mortar_team(clip, frame):
    """60mm Mortar Team, crew 3. The long tube, two kneeling crew and one upright
    -- the tallest, narrowest silhouette in the set, and the only vertical spike.
    Three figures and a 1.02 tube against the enemy crew's two and 0.76."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    out = []
    if _weapon_visible(clip):
        out += kit.mortar("mtr_tube", (0.26, 0.0, 0.0), length=1.02)
    for i, y in enumerate((-0.54, 0.54)):
        out += kit.figure(f"mtr_crew{i}", (-0.14, y, 0.0), posture=_crew_posture(clip))
    out += kit.figure("mtr_no3", (-0.62, 0.0, 0.0), posture=p, stride=st, leader=True)
    out += kit.rifle("mtr_no3_w", (-0.62, 0.0, 0.0), posture=p)
    return out


def mortar_crew(clip, frame):
    """Mortar Crew, crew 3. The same weapon class as mortar_team and the closest
    pair in the set, so it is held apart on the two levers that survive
    downsampling: two figures instead of three, and a visibly shorter tube."""
    out = []
    if _weapon_visible(clip):
        out += kit.mortar("emtr_tube", (0.22, 0.0, 0.0), length=0.76)
    for i, y in enumerate((-0.40, 0.42)):
        out += kit.figure(f"emtr_crew{i}", (-0.16, y, 0.0),
                          posture=_crew_posture(clip), helmet=False)
    return out


def sniper_team(clip, frame):
    """Sniper Team, crew 2. Both prone. The only prone idle in the game, which
    makes it the one sheet with no collision risk worth naming -- a wide flat
    smear is a shape nothing else can produce."""
    # `down` cannot be "go prone" here. Closing up and flattening is the only
    # thing left that reads as a change.
    close = 0.12 if clip in ("down", "wreck") else 0.24
    out = kit.figure("snp_a", (0.10, -close, 0.0), posture="prone")
    out += kit.sniper_rifle("snp_rifle", (0.10, -close, 0.0))
    out += kit.figure("snp_b", (-0.24, close, 0.0), posture="prone")
    out += kit.binoculars("snp_binos", (-0.24, close, 0.0), posture="prone")
    return out


def atgm_cell(clip, frame):
    """ATGM Cell, crew 3. A tripod post with two kneeling crew: the widest, lowest
    base in the set, deliberately the inverse of the mortar's vertical spike."""
    out = []
    if _weapon_visible(clip):
        out += kit.atgm_tripod("atgm_post", (0.24, 0.0, 0.0))
    for i, y in enumerate((-0.40, 0.44)):
        out += kit.figure(f"atgm_crew{i}", (-0.34, y, 0.0),
                          posture=_crew_posture(clip), helmet=False)
    return out


#: id -> (builder, faction, sprite directory). The sheet name follows the unit id
#: so a missing sheet is obvious in main.ts rather than hidden behind an alias --
#: which is exactly how seven types came to share one directory.
TEAMS = {
    "inf_squad": (inf_squad, "kdf", "INF_SQUAD"),
    "demo_squad": (demo_squad, "kdf", "INF_DEMO"),
    "at_team": (at_team, "kdf", "INF_AT"),
    "mortar_team": (mortar_team, "kdf", "INF_MORTAR"),
    "sniper_team": (sniper_team, "kdf", "INF_SNIPER"),
    "militia_cell": (militia_cell, "enemy", "INF_MILITIA"),
    "rpg_team": (rpg_team, "enemy", "INF_RPG"),
    "atgm_cell": (atgm_cell, "enemy", "INF_ATGM"),
    "mortar_crew": (mortar_crew, "enemy", "INF_MORTAR_E"),
}

CLIPS = {
    "idle": {"frames": 1, "fps": 0, "loop": False},
    "move": {"frames": 4, "fps": 10, "loop": True},
    "fire": {"frames": 1, "fps": 12, "loop": False},
    "down": {"frames": 1, "fps": 0, "loop": False},
    "wreck": {"frames": 1, "fps": 0, "loop": False},
}


def build(team_id, clip, frame):
    """Fresh scene holding one team in one clip's frame."""
    builder, faction, _ = TEAMS[team_id]
    kit.new_scene()
    return builder(clip, frame), faction
