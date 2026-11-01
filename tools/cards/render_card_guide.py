"""Store-card layout tool (GH-746 SC1, design `_coord/store-cards/design.md` section 2.3).

    blender -b -P tools/cards/render_card_guide.py -- --team inf_squad --out <dir> \\
        [--levels base,armour_t1,...,firepower_t3] [--no-kit 1] [--samples 64]

Stages a team's SHIPPED figures and gear at a given kit state in the fixed camera and light, in flat
palette colours by role, and writes, per level (the base card, then each (track, tier)):

  raw/<level>_rgba.png     the lit render, 1536 x 1152 (4:3) with alpha; the 3:2 card is its middle 1024 rows
  raw/ids_rgba.png         figure-id map (0 background, bodies 30/70/110, firing hand +10, support hand +20)
  raw/hands_rgba.png       the id map with everything but the hands removed (how much of each hand the camera sees)
  raw/zone_<track>_t<n>_rgba.png   where that (track, tier)'s parts project; the bodies occlude (255 = part)
  raw/report_blender.json  pose numbers, camera fractions, timings

`tools/cards/card_masks.py` (plain python3 + PIL) then composites the sky, crops the 3:2 card and makes the
difference masks, the crops, the overlap, safe-zone and hand-clearance checks and the contact sheets.

Render-guided, not painted: the figures are the shipped `art/meshes/<team>.glb` posed in code
(`card_poses.py`), the kit is `units/inf_kit.py`'s parts at the tier shown (the same build the garage and
the in-game kit use), the colours are `data/palette.json` keys. A card never waits for a figure's clips:
the pose exists only in this scene. No GLB is written, no mesh contract changes.
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, os.path.join(TOOLS, "units"))

import card_poses as cp  # noqa: E402
import card_scene as cs  # noqa: E402
import inf_kit  # noqa: E402
import inf_kit_parts as kp  # noqa: E402
import inf_kit_scene as scn  # noqa: E402

# flat tone per role: palette keys only, the rig's own vocabulary (units/inf_kit_parts.py PALETTE_KEY,
# the hands pass's glove texel limestone.7, tools/render_team.py's body palette)
ROLE_TONE = {
    "cloth": "olive.1",        # trousers, neck, pelvis
    "sleeve": "olive.1",
    "helmet": "olive.2",
    "vest": "olive.3",         # the baked carrier base (dark olive); the kit's carrier_t1 is coyote dust.5
    "boot": "dust.6",
    "skin": "skin.0",
    "weapon": "gunmetal.2",
    "glove": "limestone.7",
}
BODY_CODE = {"f0": 30, "f1": 70, "f2": 110}
HAND_PLUS = {"L": 10, "R": 20}          # firing hand (rig L), support hand (rig R)
TRACKS = kp.TRACKS


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {}
    for i in range(0, len(argv) - 1, 2):
        a[argv[i].lstrip("-")] = argv[i + 1]
    return a


def combined_name(c):
    return f"{c[0]}_t{c[1]}_{c[2]}_t{c[3]}"


def levels_all(spec=None):
    out = ["base"]
    for t in TRACKS:
        for n in (1, 2, 3):
            out.append(f"{t}_t{n}")
    for c in (spec or cp.RIFLE_SQUAD).get("combined_layers", ()):
        out.append(combined_name(c))
    return out


def tiers_of(level):
    if level == "base":
        return {}
    parts = level.split("_t")            # armour_t3_sensors_t3 -> ["armour", "3_sensors", "3"]
    if len(parts) == 3:
        return {parts[0]: int(parts[1].split("_")[0]), parts[1].split("_", 1)[1]: int(parts[2])}
    return {parts[0]: int(parts[1])}


# ------------------------------------------------------------------------------------- skin weights

def dominant_by_poly(ob):
    """Per polygon, the vertex group (bone) with the largest summed weight over the polygon's vertices."""
    me = ob.data
    names = {g.index: g.name for g in ob.vertex_groups}
    vw = [{g.group: g.weight for g in v.groups} for v in me.vertices]
    out = []
    for p in me.polygons:
        acc = {}
        for vi in p.vertices:
            for gi, w in vw[vi].items():
                acc[gi] = acc.get(gi, 0.0) + w
        out.append(names[max(acc, key=acc.get)] if acc else None)
    return out


def dominant_by_vertex(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    out = []
    for v in ob.data.vertices:
        out.append(names[max(v.groups, key=lambda g: g.weight).group] if v.groups else None)
    return out


def role_of(mesh_name, bone):
    if mesh_name == "face":
        return "skin"
    if mesh_name == "boot":
        return "boot"
    if mesh_name == "weapon":
        return "weapon"
    part = bone.split("_", 1)[1] if bone and "_" in bone else ""
    if part.startswith(("hand", "finger", "fist")):
        return "glove"
    if part.startswith(("upperarm", "forearm")):
        return "sleeve"
    if part == "head":
        return "helmet"
    if part == "spine":
        return "vest"
    return "cloth"


def hand_side(bone):
    part = bone.split("_", 1)[1]
    if part.startswith(("hand", "finger", "fist")):
        return part.rsplit("_", 1)[1]
    return None


class Painter:
    """Per-face flat materials for the four shared base meshes, and the pass-mode swap."""

    def __init__(self, meshes, rows, figs):
        self.slots = []
        self.figs = figs
        self.cache = {}
        self.base_objs = []
        for name in ("boot", "face", "uniform", "weapon"):
            ob = meshes[name]
            self.base_objs.append(ob)
            self._paint_base(ob, name)
        for ob, part, pf, _ in rows:
            self._paint_kit(ob, part, pf)

    def _mat(self, kind, key):
        k = (kind, key)
        if k not in self.cache:
            if kind == "lit":
                self.cache[k] = cs.lit_material(f"lit_{key}", key)
            elif kind == "code":
                self.cache[k] = cs.code_material(f"code_{key}", key)
            else:
                self.cache[k] = cs.clear_material("clear")
        return self.cache[k]

    def _paint_base(self, ob, name):
        doms = dominant_by_poly(ob)
        keys = {}
        ob.data.materials.clear()
        idx = []
        for d in doms:
            fig = d.split("_", 1)[0] if d else "f0"
            role = role_of(name, d)
            side = hand_side(d) if d else None
            key = (role, fig, side)
            if key not in keys:
                keys[key] = len(keys)
                ob.data.materials.append(self._mat("lit", ROLE_TONE[role]))
                self.slots.append(cs.Slot(ob, keys[key], ROLE_TONE[role], fig, "hand" if side else "body"))
                self.slots[-1].side = side
            idx.append(keys[key])
        ob.data.polygons.foreach_set("material_index", idx)
        ob.data.update()

    def _paint_kit(self, ob, part, pf):
        tone = kp.PALETTE_KEY[part.texel]
        ob.data.materials.clear()
        ob.data.materials.append(self._mat("lit", tone))
        s = cs.Slot(ob, 0, tone, pf, "kit", part.track, part.tier)
        s.side = None
        self.slots.append(s)

    def set_mode(self, mode, zone_track=None):
        """lit | ids | hands | zone. Writes slot.material for every slot."""
        for s in self.slots:
            if mode == "lit":
                m = self._mat("lit", s.tone)
            elif mode == "ids":
                code = BODY_CODE[s.fig] + (HAND_PLUS[s.side] if s.kind == "hand" else 0)
                m = self._mat("code", code)
            elif mode == "hands":
                m = self._mat("code", BODY_CODE[s.fig] + HAND_PLUS[s.side]) if s.kind == "hand" else self._mat("clear", 0)
            elif mode == "zone":
                m = self._mat("code", 255 if (s.kind == "kit" and s.track == zone_track) else 1)
            else:
                raise ValueError(mode)
            s.ob.material_slots[s.index].material = m
        sc = bpy.context.scene
        if mode == "lit":
            sc.view_settings.view_transform = "Standard"
            sc.view_settings.exposure = cs.EXPOSURE_EV
            sc.eevee.taa_render_samples = cs.SAMPLES
            sc.render.filter_size = 1.5
            sc.render.dither_intensity = 1.0
        else:
            sc.render.dither_intensity = 0.0      # an id code must read back exactly: dither noise breaks the +-2 match
            sc.view_settings.view_transform = "Raw"
            sc.view_settings.exposure = 0.0
            sc.eevee.taa_render_samples = 1
            sc.render.filter_size = 0.0


# ------------------------------------------------------------------------------------- the pose

def m4(pb):
    return np.array(pb.matrix)


def set_m4(pb, M):
    pb.matrix = Matrix(M.tolist())


def rt4(R, t):
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = t
    return M


def refresh():
    bpy.context.view_layer.update()


def pts_of(ob_eval_pts, dom, names):
    sel = np.array([d in names for d in dom])
    return ob_eval_pts[sel]


def pose_team(arm, meshes, spec, psi, report):
    """Idle frame 0 as the base, then the N5 high ready for every figure. Everything the numbers need is
    measured from the shipped bytes, not assumed."""
    figs = spec["figures"]
    scn.pose(arm, "idle", 0)
    pb = arm.pose.bones

    # 1. the line. Screen-frame positions q (x right, y away from the camera) along a shallow diagonal that
    #    recedes to the right, `line_gap_m` apart along the line, f0 (the middle man) at the origin; then into the
    #    figures' own frame with R(-psi), since the whole scene is turned by psi afterwards and every man faces +X.
    ang = math.radians(spec["line_deg"])
    dirw = np.array([math.cos(ang), math.sin(ang)])
    c, s_ = math.cos(-psi), math.sin(-psi)
    Rinv = np.array([[c, -s_], [s_, c]])
    order = spec["line_order"]
    mid_i = len(order) // 2
    for k, pf in enumerate(order):
        q = dirw * spec["line_gap_m"] * (k - mid_i)
        p = Rinv @ q
        M = m4(pb[f"{pf}_root"])
        set_m4(pb[f"{pf}_root"], rt4(np.eye(3), [p[0] - M[0, 3], p[1] - M[1, 3], 0.0]) @ M)
    refresh()

    # 2. measure the idle stance (after the line is set)
    uni, wpn = meshes["uniform"], meshes["weapon"]
    Pu, Pw = cs.posed_points([uni]), cs.posed_points([wpn])
    du, dw = dominant_by_vertex(uni), dominant_by_vertex(wpn)
    info = {}
    for pf in figs:
        g0 = pts_of(Pu, du, {f"{pf}_hand_L", f"{pf}_finger_L"}).mean(axis=0)
        s0 = pts_of(Pu, du, {f"{pf}_hand_R"}).mean(axis=0)
        Wv = pts_of(Pw, dw, {f"{pf}_weapon"})
        c = Wv.mean(axis=0)
        w, V = np.linalg.eigh(np.cov((Wv - c).T))
        a0 = V[:, -1]
        if a0 @ (s0 - g0) < 0:
            a0 = -a0
        proj = (Wv - c) @ a0
        front = Wv[proj > np.percentile(proj, 70)]
        bore = front.mean(axis=0)
        down = (g0 - bore)
        down = down - a0 * (down @ a0)
        u0 = -down / np.linalg.norm(down)
        root = m4(pb[f"{pf}_root"])[:3, 3]
        sp = pts_of(Pu, du, {f"{pf}_spine"})
        # the carrier's front face at the firing hand's height (a band around it, between the shoulders): at the low
        # ready that is the pouch line, 0.27 m ahead of the root; higher up the chest plate is 0.20 and the arms and the
        # support-side protraction reach further and are not the carrier. 99th percentile, not the maximum.
        hz, band = spec["firing_hand_height_target"], spec["carrier_front_band_m"]
        chest = sp[(sp[:, 2] > hz - band) & (sp[:, 2] < hz + band) & (np.abs(sp[:, 1] - root[1]) < 0.12)]
        info[pf] = dict(g0=g0, s0=s0, a0=a0, u0=u0, root=root, chest_front=float(np.percentile(chest[:, 0], 99)),
                        a0_elev=math.degrees(math.asin(a0[2])))

    # 3. the high ready
    e, az = math.radians(spec["muzzle_elevation_deg"]), math.radians(spec["muzzle_azimuth_deg"])
    a_t = np.array([math.cos(e) * math.cos(az), math.cos(e) * math.sin(az), math.sin(e)])
    # sights up, then rolled about the bore by the cant (A2's outboard cant turns the hands toward the camera)
    u_t = cp.axis_angle(a_t, spec.get("weapon_cant_deg", 0.0)) @ cp.unit(np.array([0.0, 0.0, 1.0]) - a_t * a_t[2])
    short_total = {}
    for pf in figs:
        I = info[pf]
        PL = m4(pb[f"{pf}_upperarm_L"])[:3, 3]
        g_t = np.array([I["chest_front"] + spec["firing_hand_ahead_target"],
                        PL[1] + spec["firing_hand_y_from_shoulder"],
                        spec["firing_hand_height_target"]])
        R = cp.rigid_between(I["a0"], I["u0"], a_t, u_t)
        T = rt4(np.eye(3), g_t) @ rt4(R, np.zeros(3)) @ rt4(np.eye(3), -I["g0"])    # D(p) = R (p - g0) + g_t
        I["R"], I["T"], I["g_t"] = R, T, g_t

        # the weapon, then the hands that ride it
        Mw = m4(pb[f"{pf}_weapon"])
        hands_idle = {s: m4(pb[f"{pf}_hand_{s}"]) for s in ("L", "R")}
        fore_idle = {s: m4(pb[f"{pf}_forearm_{s}"]) for s in ("L", "R")}
        up_idle = {s: m4(pb[f"{pf}_upperarm_{s}"]) for s in ("L", "R")}
        set_m4(pb[f"{pf}_weapon"], T @ Mw)
        refresh()

        # arms: two-bone IK, elbow on a pole, the support shoulder may protract
        for s in ("L", "R"):
            Hn = T @ hands_idle[s]
            W = Hn[:3, 3]
            Pm = up_idle[s]
            P = Pm[:3, 3].copy()
            a_len = float(np.linalg.norm(fore_idle[s][:3, 3] - P))
            b_len = float(np.linalg.norm(hands_idle[s][:3, 3] - fore_idle[s][:3, 3]))
            # either shoulder may come forward, up to hold.ts's 0.11 m, and only as far as the reach needs
            shift = cp.protraction_needed(P, W, a_len, b_len, W - P, spec["shoulder_protract_max_m"])
            P = P + cp.unit(W - P) * shift
            E, d, short = cp.solve_two_bone(P, W, a_len, b_len, spec["elbow_pole"][s])
            short_total[f"{pf}_{s}"] = dict(short_m=round(short, 4), protract_m=round(shift, 4), arm=[round(a_len, 4), round(b_len, 4)],
                                            shoulder=[round(float(x), 3) for x in P], wrist=[round(float(x), 3) for x in W], d=round(float(np.linalg.norm(W - P)), 3))
            # upper arm: swing its idle Y onto P->E, translation at the (possibly protracted) head
            y_up_new = cp.unit(E - P)
            R_up = cp.swing(Pm[:3, 1], y_up_new) @ Pm[:3, :3]
            set_m4(pb[f"{pf}_upperarm_{s}"], rt4(R_up, P))
            refresh()
            # forearm: swing onto E->W, then roll so the hand sits on the forearm as it did in idle
            Fm = fore_idle[s]
            y_f_new = cp.unit(W - E)
            R_f = cp.swing(Fm[:3, 1], y_f_new) @ Fm[:3, :3]
            r0 = cp.signed_angle(Fm[:3, 0], hands_idle[s][:3, 0], Fm[:3, 1])
            r1 = cp.signed_angle(R_f[:, 0], Hn[:3, 0], y_f_new)
            delta = max(-75.0, min(75.0, r1 - r0))
            R_f = cp.axis_angle(y_f_new, delta) @ R_f
            set_m4(pb[f"{pf}_forearm_{s}"], rt4(R_f, E))
            refresh()
            set_m4(pb[f"{pf}_hand_{s}"], Hn)
            refresh()
    report["pose"] = dict(
        elevation_deg=spec["muzzle_elevation_deg"], azimuth_deg=spec["muzzle_azimuth_deg"], arms=short_total,
        idle={pf: dict(muzzle_elev_deg=round(info[pf]["a0_elev"], 1), chest_front_x=round(info[pf]["chest_front"] - info[pf]["root"][0], 3)) for pf in figs})
    return info


def measure_hands(meshes, figs, info, spec):
    """The N5 numbers from the final posed bytes: hand centroids against the carrier front and the ground."""
    uni = meshes["uniform"]
    Pu = cs.posed_points([uni])
    du = dominant_by_vertex(uni)
    out = {}
    for pf in figs:
        g = pts_of(Pu, du, {f"{pf}_hand_L", f"{pf}_finger_L"}).mean(axis=0)
        s = pts_of(Pu, du, {f"{pf}_hand_R"}).mean(axis=0)
        m = dict(firing_height=float(g[2]), firing_ahead=float(g[0] - info[pf]["chest_front"]), support_height=float(s[2]))
        rows = cp.check_hand_numbers(m, spec)
        out[pf] = dict(measured={k: round(v, 3) for k, v in m.items()}, checks=[dict(name=r[0], value=round(r[1], 3), lo=r[2], hi=r[3], ok=bool(r[4])) for r in rows])
    return out


# ------------------------------------------------------------------------------------- rendering

def render_to(path, w, h):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    a = parse()
    out = os.path.abspath(a["out"])
    raw = os.path.join(out, "raw")
    os.makedirs(raw, exist_ok=True)
    team_id = a.get("team", "inf_squad")
    spec = dict(cp.TEAM_POSES[team_id])
    # development overrides, recorded in the report: `--az 40 --line 30 --cx 0.55 --elev 42.5`
    for flag, key in (("az", "muzzle_azimuth_deg"), ("line", "line_deg"), ("cx", "team_centre_x"), ("elev", "muzzle_elevation_deg"), ("th", "team_height"), ("yoff", "firing_hand_y_from_shoulder"), ("hh", "firing_hand_height_target"), ("ah", "firing_hand_ahead_target"), ("cant", "weapon_cant_deg")):
        if flag in a:
            spec[key] = float(a[flag])
    levels = a.get("levels", ",".join(levels_all(spec))).split(",")
    samples = int(a.get("samples", cs.SAMPLES))
    cs.SAMPLES = samples
    t0 = time.time()
    report = {"team": team_id, "levels": levels, "combined_layers": [list(c) for c in spec.get("combined_layers", ())], "timings_s": {}, "spec": {k: spec[k] for k in ("muzzle_azimuth_deg", "muzzle_elevation_deg", "line_deg", "team_centre_x", "line_gap_m", "team_height")}}

    kp.use_team(team_id)
    arm, meshes, mat = scn.load_squad(REPO, team_id)
    if a.get("no-kit", "0") == "1":
        rows = []
    else:
        rows = inf_kit.build(REPO, arm, meshes, mat)
    report["timings_s"]["load_and_kit"] = round(time.time() - t0, 1)
    figs = spec["figures"]

    painter = Painter(meshes, rows, figs)
    psi = math.atan2(-math.cos(math.radians(cp.TURN_DEG)), -math.sin(math.radians(cp.TURN_DEG)))
    info = pose_team(arm, meshes, spec, psi, report)
    report["hands"] = measure_hands(meshes, figs, info, spec)

    # the turn: forward (+X) onto the camera, TURN_DEG off its axis, toward screen-left, about the world origin
    turn = bpy.data.objects.new("turn", None)
    bpy.context.scene.collection.objects.link(turn)
    arm.parent = turn
    turn.rotation_euler = (0.0, 0.0, psi)
    refresh()
    report["turn_deg"] = round(math.degrees(psi), 1)

    ground = cs.build_stage(cp.CARD_W, cp.GUIDE_4x3_H)
    cam = cs.make_camera(cp.CARD_W, cp.GUIDE_4x3_H)

    # frame once, on the MAXIMUM kit, so a purchase never resizes the picture
    # The leader's radio whip (sensors T2 0.9 m, T3 1.25 m above the pack) reaches 0.9 m over his helmet: fitting the
    # frame to it would shrink the team to half the card. The camera is fitted to everything BUT the whips, and the
    # whip's own top is reported (a negative fraction is off the card's top edge: a cropped silhouette).
    whips = [ob for ob, part, _, _ in rows if "whip" in part.name]
    allobjs = painter.base_objs + [ob for ob, part, _, _ in rows if "whip" not in part.name]
    if rows:
        inf_kit.show(rows, {t: 3 for t in TRACKS})
    allobjs = [o for o in allobjs if not o.hide_render]
    whips = [o for o in whips if not o.hide_render]
    pts = cs.posed_points(allobjs)
    whip_pts = cs.posed_points(whips) if whips else None
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = cp.CARD_W, cp.GUIDE_4x3_H
    (fx0, fx1, fy0, fy1), dist, shifts = cs.fit_camera(cam, pts, cp.CARD_W, cp.GUIDE_4x3_H, spec["team_centre_x"], spec["team_height"])
    report["camera"] = dict(team_x=[round(fx0, 3), round(fx1, 3)], team_y=[round(fy0, 3), round(fy1, 3)],
                            team_height_frac=round(fy1 - fy0, 3), feet_frac=round(fy1, 3), distance_m=round(dist, 2),
                            shift=[round(shifts[0], 4), round(shifts[1], 4)])
    if whip_pts is not None:
        wx, wy = cs.project(cam, whip_pts)
        full_h = bpy.context.scene.render.resolution_y
        top_card = ((1.0 - wy.max()) * full_h - (full_h - cp.CARD_H) / 2.0) / cp.CARD_H
        report["camera"]["whip_t3_top_frac"] = round(float(top_card), 3)
        report["camera"]["whip_cropped_by_card_top"] = bool(top_card < 0.0)
    report["camera"]["projection_check_max_err"] = round(float(cs.check_projection(cam, pts)), 6)
    print(json.dumps(report["camera"]))
    t1 = time.time()

    def lit(level, name_4x3=False):
        painter.set_mode("lit")
        ground.hide_render = False
        if rows:
            inf_kit.show(rows, tiers_of(level))
        h = cp.GUIDE_4x3_H
        render_to(os.path.join(raw, f"{level}_rgba.png"), cp.CARD_W, h)
        print("lit", level, flush=True)

    for level in levels:
        lit(level)
    report["timings_s"]["lit_renders"] = round(time.time() - t1, 1)

    # id passes on the base level
    t2 = time.time()
    ground.hide_render = True
    if rows:
        inf_kit.show(rows, {})
    painter.set_mode("ids")
    render_to(os.path.join(raw, "ids_rgba.png"), cp.CARD_W, cp.GUIDE_4x3_H)
    painter.set_mode("hands")
    render_to(os.path.join(raw, "hands_rgba.png"), cp.CARD_W, cp.GUIDE_4x3_H)
    if rows:
        for track in TRACKS:
            for tier in (1, 2, 3):
                inf_kit.show(rows, {track: tier})
                painter.set_mode("zone", track)
                render_to(os.path.join(raw, f"zone_{track}_t{tier}_rgba.png"), cp.CARD_W, cp.GUIDE_4x3_H)
    report["timings_s"]["id_passes"] = round(time.time() - t2, 1)
    report["timings_s"]["total"] = round(time.time() - t0, 1)
    with open(os.path.join(raw, "report_blender.json"), "w") as fh:
        json.dump(report, fh, indent=1, sort_keys=True, default=float)
    print("DONE", json.dumps(report["timings_s"]))


if __name__ == "__main__":
    main()
