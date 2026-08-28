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
    move    four frames: standing legs split fore-and-aft, prone figures crawl
    fire    weapons up, feet planted -- never a height change, see below
    down    everyone prone, gone to ground under suppression
    wreck   prone, rendered in the casualty material
    work    one team's own clip, not base vocabulary (TEAM_CLIP_ADD): the
            Yahalom lead kneels and drives the mast into the ground, looping
            for as long as the sim reports a tunnel charge being worked

Frames 0 and 2 of `move` are deliberately identical -- the stride cycle is
0 -> forward -> 0 -> back, so both are the contact pose. Three unique images per
facing, not four, and that is the cycle rather than a saving.

Two limitations, stated rather than hidden:

  * **Crew-served weapons stay deployed through `move`.** A mortar team really
    walks with the tube shouldered. Authoring a carried state per crew weapon
    roughly doubles the work for something invisible at 25 px, which is what the
    rig contract measured infantry at. The retired soldier renderer already made
    this trade, layering leg swing over a fixed upper body so the rifle stays up.
  * **`fire` cannot change a figure's height.** `resolveClip` latches it per
    shot, so a crouch made the whole team bob up and down through a firefight.
    The clip reads from the weapon coming up instead.
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

#: Frames in the smoking idle, and the teams that get one.
#:
#: Ten at 3 fps is a 3.3-second drag cycle. Real ones run 4-6 s; eight frames at
#: 6 fps came to 1.3 s and read as a twitch, and slowing eight frames to 2 fps
#: reads steppy. Ten is where a believable cycle and a bearable frame count meet.
IDLE_SMOKE_FRAMES = 10

#: Only teams whose idle has upright figures. A kneeling mortar crew at their tube
#: and a prone sniper on his scope are not going to light one, and animating them
#: doing it would look wrong rather than human. The other four keep a one-frame
#: idle, which also keeps roughly 500 frames out of the render.
SMOKING_TEAMS = frozenset({"inf_squad", "militia_cell", "rpg_team", "demo_squad", "at_team"})


def idle_frames(team):
    """Frames in this team's idle clip."""
    return IDLE_SMOKE_FRAMES if team in SMOKING_TEAMS else 1


def _smoke(team, clip, frame):
    """Eased smoking-pose parameters, or None for a team that does not smoke."""
    if clip != "idle" or team not in SMOKING_TEAMS:
        return None
    return kit.smoke_pose(frame, IDLE_SMOKE_FRAMES)

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
    """What an upright figure does in this clip.

    `fire` stays **standing**. It used to drop to a kneeling posture, which was
    wrong in a way only visible in play: `resolveClip` latches `fire` per shot,
    so a unit firing intermittently stood up and knelt down again on every burst
    -- the whole team bobbing up and down for as long as the fight lasted. A clip
    that changes a figure's height cannot be driven by a per-shot latch.

    The retired soldier renderer had this right and it was not carried over: its
    `fire` was the model's authored *Standing_Aim*, not a crouch. The read comes
    from the weapon coming up, which costs no height change.
    """
    if clip == "fire":
        return "standing"
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


def _lean_forward(parts, deg, at_x=0.0):
    """Rotate finished parts forward about the ground line at x=at_x.

    A sprint lean, applied to vertex data rather than to object rotation -- the
    render rig reads vertex positions to size the frame, so an unapplied object
    rotation would report the unleaned figure. Same rule kit.rot_z exists for.
    """
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    for ob in parts:
        for v in ob.data.vertices:
            x, z = v.co.x - at_x, v.co.z
            v.co.x = at_x + x * c + z * s
            v.co.z = -x * s + z * c
        ob.data.update()
    return parts


#: Clips a team's sheet deliberately omits. `clipOrFallback` resolves a missing
#: clip back to idle in the renderer, so omission is a behaviour rather than a
#: hole -- a motorcycle cannot go prone, and drawing it doing so reads as a bug.
TEAM_CLIP_DROP = {"moto_rpg": ("down",)}

#: Clips one team's sheet carries beyond the base vocabulary -- TEAM_CLIP_DROP's
#: mirror, and for the mirrored reason: a clip added to BASE_CLIPS would grow an
#: unused copy on every existing sheet, while `clipOrFallback` already resolves
#: an unauthored clip back to idle, so only the team that can actually play one
#: should pay to render it. `work` is what a Yahalom shows for the whole of a
#: tunnel charge: six frames at 6 fps, looping -- a slow press-and-lift cycle,
#: sized so one loop reads about once a second rather than as a twitch.
TEAM_CLIP_ADD = {"yahalom_squad": {"work": {"frames": 6, "fps": 6, "loop": True}}}


# --- the nine --------------------------------------------------------------


def inf_squad(clip, frame):
    """Rifle Squad, crew 8. Three upright figures in a wide line -- the baseline
    every other silhouette has to differ from, and the widest of the standing
    groups so it separates from the two-figure militia cell."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    sm = _smoke("inf_squad", clip, frame)
    out = []
    for i, y in enumerate((-0.78, 0.0, 0.78)):
        x = 0.20 if i == 1 else 0.0
        out += kit.figure(f"rifle{i}", (x, y, 0.0), posture=p, stride=st, smoke=sm, leader=(i == 1))
        out += kit.rifle(f"rifle{i}_w", (x, y, 0.0), posture=p, aim=(clip == "fire"))
    return out


def militia_cell(clip, frame):
    """Militia Cell, crew 6. Two figures in a touching pair, cloth heads. Held to
    two and kept tight so it reads lighter than the rifle squad's spread three --
    the helmet difference is worth about two pixels and cannot carry this."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    sm = _smoke("militia_cell", clip, frame)
    out = []
    for i, (x, y) in enumerate(((0.0, -0.24), (0.12, 0.26))):
        out += kit.figure(f"mil{i}", (x, y, 0.0), posture=p, stride=st, smoke=sm, headgear="keffiyeh", loadout="irregular",
                          leader=(i == 0))
        out += kit.rifle(f"mil{i}_w", (x, y, 0.0), posture=p, aim=(clip == "fire"))
    return out


def demo_squad(clip, frame):
    """Combat Engineers, crew 5. One figure low over a satchel charge, one upright
    with a cable reel. The mixed height plus the reel's disc-on-edge is the tell:
    no weapon in the set draws a disc."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    sm = _smoke("demo_squad", clip, frame)
    out = kit.figure("demo_a", (0.34, -0.16, 0.0), posture=_crew_posture(clip), yaw=0.0)
    if _weapon_visible(clip):
        out += kit.demo_charge("demo_charge", (0.76, -0.16, 0.0))
    out += kit.figure("demo_b", (-0.36, 0.28, 0.0), posture=p, stride=st, smoke=sm, leader=True)
    out += kit.cable_spool("demo_spool", (-0.36, 0.28, 0.0))
    out += kit.rifle("demo_b_w", (-0.36, 0.28, 0.0), posture=p, aim=(clip == "fire"))
    return out


def at_team(clip, frame):
    """Spike AT Team, crew 3. A kneeling firer with the launcher held **level**,
    and a standing spotter on binoculars. Level is the whole separation from the
    RPG team: same parts, different tube axis, and the gate reads axis where it
    cannot read a texture."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    sm = _smoke("at_team", clip, frame)
    out = kit.figure("at_fire", (0.24, -0.30, 0.0), posture=_crew_posture(clip))
    if _weapon_visible(clip):
        out += kit.launcher("at_tube", (0.24, -0.30, 1.02), pitch=0.0, length=1.16)
    out += kit.figure("at_spot", (-0.32, 0.34, 0.0), posture=p, stride=st, smoke=sm, leader=True)
    out += kit.binoculars("at_binos", (-0.32, 0.34, 0.0), posture=p)
    return out


def rpg_team(clip, frame):
    """RPG Team, crew 3. Standing firer, tube pitched **steeply up**, plus a
    loader. Upright and diagonal against the AT team's kneeling and level."""
    p, st = _standing_posture(clip), _stride(clip, frame)
    sm = _smoke("rpg_team", clip, frame)
    out = kit.figure("rpg_fire", (0.18, -0.26, 0.0), posture=p, stride=0.0,
                            headgear="keffiyeh", loadout="irregular")
    if _weapon_visible(clip):
        out += kit.launcher("rpg_tube", (0.18, -0.26, 1.46),
                            pitch=math.radians(38.0), length=1.24, radius=0.075)
    out += kit.figure("rpg_load", (-0.30, 0.30, 0.0), posture=p, stride=st, smoke=sm, headgear="keffiyeh", loadout="irregular",
                      leader=True)
    out += kit.rifle("rpg_load_w", (-0.30, 0.30, 0.0), posture=p, aim=(clip == "fire"))
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
    out += kit.rifle("mtr_no3_w", (-0.62, 0.0, 0.0), posture=p, aim=(clip == "fire"))
    return out


def mortar_crew(clip, frame):
    """Mortar Crew, crew 3. The same weapon class as mortar_team and the closest
    pair in the set, so it is held apart on the two levers that survive
    downsampling: two figures instead of three, and a visibly shorter tube."""
    out = []
    if _weapon_visible(clip):
        out += kit.mortar("emtr_tube", (0.22, 0.0, 0.0), length=0.76)
    for i, y in enumerate((-0.40, 0.42)):
        out += kit.figure(f"emtr_crew{i}", (-0.16, y, 0.0), posture=_crew_posture(clip),
                          headgear="keffiyeh", loadout="irregular")
    return out


def sniper_team(clip, frame):
    """Sniper Team, crew 2. Prone on the scope, but *upright when it relocates*.

    Posture used to be prone for every clip, so the team crawled everywhere it
    went. A sniper team moves on its feet and goes down to shoot.

    The prone idle is still the only one in the game, and this file used to call
    that "the one sheet with no collision risk worth naming". That reasoning
    survives intact: the silhouette gate compares *only* `idle_f00_000.png` and
    refuses to run on anything else (validate_assets.py), and `idle` is still
    prone, so the gate sees exactly what it saw before. Standing up for `move`
    cannot reach it.

    `fire` stays prone for the reason in this module's header -- the clip is
    latched per shot, so a posture that changes height makes the whole team bob
    up and down through a firefight.
    """
    # `down` cannot be "go prone" here, since idle already is. Closing up and
    # flattening is the only thing left that reads as a change.
    close = 0.12 if clip in ("down", "wreck") else 0.24
    posture = "standing" if clip == "move" else "prone"
    st = _stride(clip, frame)
    out = kit.figure("snp_a", (0.10, -close, 0.0), posture=posture, stride=st)
    out += kit.sniper_rifle("snp_rifle", (0.10, -close, 0.0), posture=posture)
    out += kit.figure("snp_b", (-0.24, close, 0.0), posture=posture, stride=-st)
    out += kit.binoculars("snp_binos", (-0.24, close, 0.0), posture=posture)
    return out


def atgm_cell(clip, frame):
    """ATGM Cell, crew 3. A tripod post with two kneeling crew: the widest, lowest
    base in the set, deliberately the inverse of the mortar's vertical spike."""
    out = []
    if _weapon_visible(clip):
        out += kit.atgm_tripod("atgm_post", (0.24, 0.0, 0.0))
    for i, y in enumerate((-0.40, 0.44)):
        out += kit.figure(f"atgm_crew{i}", (-0.34, y, 0.0), posture=_crew_posture(clip),
                          headgear="keffiyeh", loadout="irregular")
    return out


def charge_squad(clip, frame):
    """Suicide Squad, crew 2. Two figures at a full sprint, single file.

    The collision risk is `militia_cell` -- also two standing dust figures -- so
    posture and spacing carry the separation. Nothing else in the set runs, and
    a 20 degree forward lean is a shape no upright team can imitate.

    **No weapon parts at all.** Every other infantry sheet draws a rifle line or
    a tube; the absence is itself a silhouette lever, and it is what the unit
    actually is. The vest bulk front and back is the only kit.
    """
    p, st = _standing_posture(clip), _stride(clip, frame)
    lean = 24.0 if clip == "fire" else 20.0
    out = []
    for i, (x, y) in enumerate(((0.46, -0.06), (-0.46, 0.10))):
        fig = kit.figure(f"chg{i}", (x, y, 0.0), posture=p, stride=st,
                         headgear="keffiyeh", loadout="irregular", mirror=(i == 1))
        if p == "standing":
            fig.append(kit.rot_z(f"chg{i}_vest_f", (0.10, 0.26, 0.32),
                                 (x + 0.16, y, 0.60), 0.0, "charge"))
            fig.append(kit.rot_z(f"chg{i}_vest_b", (0.09, 0.26, 0.28),
                                 (x - 0.15, y, 0.62), 0.0, "charge"))
            if i == 1:
                fig.append(kit.box("chg_satchel", (0.26, 0.18, 0.20),
                                   (x - 0.12, y + 0.19, 0.74), "charge"))
            _lean_forward(fig, lean, at_x=x)
        out += fig
    return out


def _motorcycle(prefix, z=0.0, dip=0.0):
    """The machine: 2.2 m long, wheels as 14-segment cylinders.

    Tyres take the `weapon` role rather than a shadow entry -- gunmetal.3 is the
    darkest non-shadow tone, and a shadow base lights down to pure black, which
    reads as a hole punched in the sprite. render_team.py records the same
    finding for boots.
    """
    parts = []
    for i, wx in enumerate((0.78, -0.72)):
        parts.append(kit.tube(f"{prefix}_wheel{i}", 0.07, 0.30, (wx, 0.0, 0.30 + z),
                              yaw=math.radians(90.0), sides=14, role="weapon"))
        parts.append(kit.rot_z(f"{prefix}_guard{i}", (0.44, 0.11, 0.05),
                               (wx, 0.0, 0.67 + z), 0.0, "metal"))
    parts.append(kit.tube(f"{prefix}_spine", 1.05, 0.06, (0.05, 0.0, 0.62 + z),
                          pitch=math.radians(8.0), sides=8, role="metal"))
    parts.append(kit.box(f"{prefix}_tank", (0.36, 0.21, 0.17), (0.28, 0.0, 0.75 + z), "metal"))
    parts.append(kit.box(f"{prefix}_seat", (0.48, 0.23, 0.09), (-0.22, 0.0, 0.77 + z), "webbing"))
    parts.append(kit.tube(f"{prefix}_forks", 0.56, 0.035, (0.68, 0.0, 0.56 + z),
                          pitch=math.radians(62.0), sides=6, role="metal"))
    parts.append(kit.tube(f"{prefix}_bars", 0.58, 0.03, (0.57, 0.0, 0.97 + z),
                          yaw=math.radians(90.0), sides=6, role="metal"))
    parts.append(kit.box(f"{prefix}_lamp", (0.11, 0.14, 0.14), (0.75, 0.0, 0.83 + z), "metal"))
    parts.append(kit.tube(f"{prefix}_exhaust", 0.72, 0.045, (-0.34, 0.17, 0.38 + z),
                          sides=6, role="metal"))
    # Panniers and a bedroll. Raider kit, and load-bearing for the art gate: a
    # motorcycle is long and thin, and the frame is square and sized to its
    # longest extent, so the idle filled only 6.08% of a 6.00% floor. Lateral
    # mass is the only lever that adds silhouette area without extending the
    # frame -- more length or a taller tube would make the ratio worse, not
    # better.
    for i, sgn in enumerate((-1.0, 1.0)):
        parts.append(kit.rot_z(f"{prefix}_pannier{i}", (0.34, 0.17, 0.30),
                               (-0.60, sgn * 0.27, 0.56 + z), 0.0, "webbing"))
    parts.append(kit.tube(f"{prefix}_bedroll", 0.62, 0.10, (-0.62, 0.0, 0.86 + z),
                          yaw=math.radians(90.0), sides=8, role="webbing"))
    if dip:
        _lean_forward(parts, dip)
    return parts


def _rider(prefix, x, z=0.0, mirror=False, hands_fwd=0.28):
    """A seated figure, composed rather than posed.

    kit.figure offers standing, kneeling and prone -- no seated -- so this
    arranges the same limb and blob primitives into a rider. At the 25 px the
    rig contract measured infantry at, a rider is a torso, a head and two
    angled legs, and that is the whole budget.

    Gloved hands and kneepads, added below the same way kit.figure()'s own
    modern-outfit pass covers a bare hand{i} or a bare knee{i} -- a second
    blob at the SAME centre, over a webbing role, bigger radius. This is the
    fix for "MOTO_RPG's riding-pose sprites are byte-identical to pre-
    gear-pass art": this function never called kit.figure() (it cannot --
    there is no seated posture), so it never picked up that pass, and every
    other figure in the roster has. Two additions, not a rebuild: a hand
    (there was none at all before -- the arm limb tapered straight to a bare
    grip point) plus its glove, and a kneepad over the leg's own knee
    waypoint. `torso`/`leg`/`arm`/`head`/`kef` are UNCHANGED from before this
    pass -- every new line below only ADDS a part, at a centre already
    implied by an existing waypoint, never moves one.
    """
    hand = -1.0 if mirror else 1.0
    parts = [
        kit.limb(f"{prefix}_torso", [(x, 0.0, 0.77 + z, 0.13),
                                     (x + 0.02, 0.01 * hand, 1.06 + z, 0.155),
                                     (x + 0.05, 0.0, 1.29 + z, 0.145)], squash=0.75),
    ]
    for i, sgn in enumerate((-1.0, 1.0)):
        parts.append(kit.limb(f"{prefix}_leg{i}", [(x + 0.02, sgn * 0.14, 0.80 + z, 0.075),
                                                   (x + 0.22, sgn * 0.18, 0.55 + z, 0.060),
                                                   (x + 0.25, sgn * 0.17, 0.36 + z, 0.050)]))
        parts.append(kit.blob(f"{prefix}_boot{i}", (x + 0.28, sgn * 0.17, 0.33 + z), 0.07,
                              role="boot"))
        # NEW: kneepad, centred on the leg's own knee waypoint (the middle
        # of the three above) -- kit.figure()'s own kneepad{i}/kneepad_f.
        parts.append(kit.blob(f"{prefix}_kneepad{i}", (x + 0.22, sgn * 0.18, 0.55 + z),
                              0.060 * 1.35, squash=(1.05, 0.95, 0.85), role="webbing"))
        parts.append(kit.limb(f"{prefix}_arm{i}", [(x + 0.04, sgn * 0.17, 1.25 + z, 0.050),
                                                   (x + hands_fwd, sgn * 0.15, 1.05 + z, 0.042)]))
        # NEW: hand + glove at the grip -- kit.figure()'s own hand{i} (role
        # "face", the same skin ramp) plus glove{i} over it. There was no
        # hand geometry here at all before this pass.
        grip = (x + hands_fwd, sgn * 0.15, 1.05 + z)
        parts.append(kit.blob(f"{prefix}_hand{i}", grip, 0.045,
                              squash=(1.0, 0.85, 0.9), role="face"))
        parts.append(kit.blob(f"{prefix}_glove{i}", grip, 0.045 * 1.2,
                              squash=(1.0, 0.85, 0.9), role="webbing"))
    parts.append(kit.blob(f"{prefix}_head", (x + 0.07, 0.0, 1.43 + z), 0.082,
                          squash=(1.0, 0.94, 1.05), role="face"))
    parts += kit.keffiyeh(f"{prefix}_kef", (x + 0.07, 0.0, 1.46 + z), radius=0.104)
    return parts


def moto_rpg(clip, frame):
    """Armed Motorcycle, crew 2. Rider on the bars, pillion with an RPG.

    The tube rides over the passenger's shoulder angled up and rearward -- the
    tallest point, breaking the roofline the way the technical's pintle gun
    does. Total height ~1.9 m against 2.2 m of length: taller than it is long is
    what keeps it off the low-car read at gameplay zoom, and the wheel base line
    is a shape no infantry sheet has.

    No `down` clip -- see TEAM_CLIP_DROP.
    """
    if clip == "wreck":
        out = _motorcycle("mw")
        # On its side: roll every vertex 80 degrees about the x axis, then lift
        # the lot back onto the ground. Vertex data, not object rotation, for
        # the reason _lean_forward records.
        c, s = math.cos(math.radians(80.0)), math.sin(math.radians(80.0))
        for ob in out:
            for v in ob.data.vertices:
                y, z = v.co.y, v.co.z
                v.co.y = y * c - z * s
                v.co.z = y * s + z * c
            ob.data.update()
        lift = -min(v.co.z for ob in out for v in ob.data.vertices)
        for ob in out:
            for v in ob.data.vertices:
                v.co.z += lift
            ob.data.update()
        # Riders thrown close to the machine, not sprawled away from it. This is
        # a framing decision as much as a staging one: render_team frames from
        # the union over every clip, so a wide wreck sizes the frame that `idle`
        # is then measured for fill inside. At +/-0.55 the wreck spanned 2.89 m
        # against idle's 2.33 and dragged idle's fill to 5.96%, under the art
        # gate's 6% floor.
        out += kit.figure("mw_a", (0.30, -0.42, 0.0), posture="prone",
                          headgear="keffiyeh", loadout="irregular")
        out += kit.figure("mw_b", (-0.32, 0.46, 0.0), posture="prone", mirror=True,
                          headgear="keffiyeh", loadout="irregular")
        return out

    bob = (0.0, 0.02, 0.0, -0.02)[frame % 4] if clip == "move" else 0.0
    dip = (0.0, 1.6, 0.0, -1.6)[frame % 4] if clip == "move" else 0.0
    out = _motorcycle("m", z=bob, dip=dip)
    out += _rider("rid", 0.18, z=bob, hands_fwd=0.34)
    out += _rider("pas", -0.42, z=bob, mirror=True, hands_fwd=0.18)
    # Level for `fire`, angled up otherwise. Angle is the silhouette lever that
    # keeps this apart from the RPG team, exactly as kit.launcher's docstring says.
    pitch = math.radians(0.0 if clip == "fire" else 30.0)
    out += kit.launcher("pas_rpg", (-0.50, -0.17, 1.44 + bob),
                        yaw=math.pi, pitch=pitch, length=1.18, radius=0.075)
    return out


#: The pair of large square packs both Yahalom figures wear, and the one
#: adjustment the owner asked for after the live preview: at (-0.24, z 1.05) the
#: packs read as detached slabs floating behind the figures, so they sit 0.06
#: closer to the body and 0.10 lower -- the box now overlaps the torso's back
#: face instead of clearing it, which is what "against the back" needs at any
#: zoom. A kneeling figure's torso drops by 0.30 * FIGURE_H (kit.figure), and
#: the pack rides the torso, so it drops the same 0.54.
YAH_PACK_SIZE = (0.30, 0.44, 0.46)


def _yah_pack(name, at, kneel=False):
    drop = 0.54 if kneel else 0.0
    return kit.box(name, YAH_PACK_SIZE, (at[0] - 0.18, at[1], 0.95 - drop), role="webbing")


def yahalom_squad(clip, frame):
    """Yahalom Engineers, crew 5. Two upright figures: the lead sweeps a 1.45 m
    ground-penetrating mast held out level at hip height, and both wear large
    square packs riding high on the back. Three independent tells, so no single
    lever carries the sheet: the horizontal spike (no other weapon in the set
    draws a long flat bar across the figure's front), the boxy over-shoulder
    mass, and the two-figure count.

    `work` is this team's own sixth clip (TEAM_CLIP_ADD): the lead kneels and
    drives the mast tip-first into the ground while the second stands over him
    -- what plays for the whole of a tunnel charge. The sensor head box exists
    only in the other clips, because in `work` it is the part in the ground.
    """
    p, st = _standing_posture(clip), _stride(clip, frame)
    # Keyed on "demo_squad" deliberately: it borrows the smoking cycle's frame-0
    # rest pose (asymmetric hands, weight shifted) for this team's single idle
    # frame without enrolling it in SMOKING_TEAMS, which would cost a ten-frame
    # loop. Previewed and approved in exactly this form.
    sm = _smoke("demo_squad", clip, frame)
    A, B = (0.30, -0.20, 0.0), (-0.34, 0.26, 0.0)
    if clip == "work":
        out = kit.figure("yah_a", A, posture="kneeling", leader=True)
        out += [_yah_pack("yah_pack_a", A, kneel=True)]
        # The mast pivots about a fixed ground contact and sinks. Pose spacing
        # does the easing exactly as kit.smoke_pose describes: the triangle
        # through a smoothstep crowds frames at both ends of the stroke, so the
        # press appears to slow, hold and lift from uniformly-timed frames.
        t = frame / 6.0
        tri = 1.0 - abs(2.0 * t - 1.0)
        ease = tri * tri * (3.0 - 2.0 * tri)
        vis = 0.98 - 0.18 * ease         # visible length; the rest is in the ground
        pitch = math.radians(40.0)
        gx, gz = 1.02, 0.01              # where the mast enters the ground
        out += [kit.tube("yah_mast", vis, 0.030,
                         (gx - 0.5 * vis * math.cos(pitch), A[1],
                          gz + 0.5 * vis * math.sin(pitch)),
                         yaw=0.0, pitch=-pitch)]
        out += kit.figure("yah_b", B, posture="standing")
        out += [_yah_pack("yah_pack_b", B)]
        out += kit.rifle("yah_b_w", B, posture="standing")
        return out
    out = kit.figure("yah_a", A, posture=p, stride=st, smoke=sm, leader=True)
    if p == "standing":
        # Prone figures mould their own pack (kit.figure's prone branch), so the
        # high packs exist only while the torso they ride is upright -- the same
        # gate charge_squad puts on its vests.
        out += [_yah_pack("yah_pack_a", A)]
    if _weapon_visible(clip):
        out += [kit.tube("yah_mast", 1.45, 0.030, (0.62, -0.20, 0.74), yaw=0.0, pitch=0.0)]
        out += [kit.box("yah_head", (0.16, 0.10, 0.04), (1.30, -0.20, 0.74))]
    out += kit.figure("yah_b", B, posture=p, stride=st)
    if p == "standing":
        out += [_yah_pack("yah_pack_b", B)]
    out += kit.rifle("yah_b_w", B, posture=p, aim=(clip == "fire"))
    return out


def digger_crew(clip, frame):
    """Digger Crew, crew 3. One figure bent over a low spoil heap, unarmed.

    Nothing else in the enemy set is a lone kneeling figure with a mound, and
    the missing weapon line is itself a lever (charge_squad's finding): every
    other kneeling sheet pairs its crew with a tube. The unit's threat is what
    the route delivers, not its rifle, so the sprite promises exactly that.

    Standing for `move` on the sniper team's precedent: the silhouette gate
    reads only `idle_f00_000`, and a crew that kneels its way across the map
    reads as a bug rather than as labour.
    """
    posture = "standing" if clip == "move" else _crew_posture(clip)
    st = _stride(clip, frame)
    out = kit.figure("dig", (-0.34, 0.04, 0.0), posture=posture, stride=st,
                     headgear="keffiyeh", loadout="irregular")
    # The heap is ground, not kit: it stays through every clip, because spoil
    # does not go prone when the digger does. role="wood" names dust.4 -- the
    # dark turned-earth tone -- not a material. Sized up from a first probe
    # that filled 6.4% of frame against the art gate's 6% floor: the mound is
    # the unit's tell, so it is also the right part to carry the fill margin,
    # and the frame is set by the standing move figure so a wider heap costs
    # no canvas.
    out += [
        kit.blob("dig_heap", (0.36, -0.06, 0.14), 0.45,
                 squash=(1.0, 0.85, 0.62), wobble=0.12, role="wood"),
        kit.blob("dig_heap_b", (0.52, 0.26, 0.08), 0.28,
                 squash=(1.0, 0.9, 0.62), wobble=0.10, role="wood"),
        kit.blob("dig_heap_c", (0.14, 0.30, 0.06), 0.20,
                 squash=(0.9, 1.0, 0.6), wobble=0.10, role="wood"),
    ]
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
    "yahalom_squad": (yahalom_squad, "kdf", "INF_YAHALOM"),
    "militia_cell": (militia_cell, "enemy", "INF_MILITIA"),
    "rpg_team": (rpg_team, "enemy", "INF_RPG"),
    "atgm_cell": (atgm_cell, "enemy", "INF_ATGM"),
    "mortar_crew": (mortar_crew, "enemy", "INF_MORTAR_E"),
    "charge_squad": (charge_squad, "enemy", "INF_CHARGE"),
    "moto_rpg": (moto_rpg, "enemy", "MOTO_RPG"),
    "digger_crew": (digger_crew, "enemy", "INF_DIGGER"),
}

#: Clips that are the same for every team. `idle` is not among them any more --
#: see `clips_for`.
BASE_CLIPS = {
    "move": {"frames": 4, "fps": 10, "loop": True},
    "fire": {"frames": 1, "fps": 12, "loop": False},
    "down": {"frames": 1, "fps": 0, "loop": False},
    "wreck": {"frames": 1, "fps": 0, "loop": False},
}


def clips_for(team):
    """This team's clip table: per-team idle, the shared base vocabulary, plus
    TEAM_CLIP_ADD's extras and minus TEAM_CLIP_DROP's omissions.

    A smoking team's idle loops at 3 fps; a team without one keeps a single
    still frame with fps 0, which is what the renderer already treats as static.
    """
    n = idle_frames(team)
    idle = {"frames": n, "fps": 3 if n > 1 else 0, "loop": n > 1}
    table = {"idle": idle, **BASE_CLIPS}
    table.update(TEAM_CLIP_ADD.get(team, {}))
    for clip in TEAM_CLIP_DROP.get(team, ()):
        table.pop(clip, None)
    return table


def build(team_id, clip, frame):
    """Fresh scene holding one team in one clip's frame."""
    builder, faction, _ = TEAMS[team_id]
    kit.new_scene()
    return builder(clip, frame), faction
