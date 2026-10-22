"""Per-figure body builds and slung rifles for a crew cut from ONE Meshy body.

The lead's standing rule (22 Oct 2026): when a team's figures reuse one source
body, the figures' builds DIFFER -- one taller, one stronger, one a bit
heavier, all of them fit soldiers, nothing comic -- and EVERY figure carries at
least one weapon (a crewman whose hands are on the equipment carries his rifle
slung). This module is the data for both and the guard that refuses a table
breaking either; `import_meshy_crew_team.py` reads it, and
`tools/src/crew_builds.test.ts` repeats both halves on the exported bytes.

Pure numpy, no bpy: the deformation and the guard run (and are falsified)
under a plain `python3`.

A build is a smooth, non-uniform deformation of the source body BEFORE it is
cut and rigged, so every part is still rigid on its one bone (no weight
painting) and every joint `cut_figure` measures is measured on the deformed
body. Fractions are of the source standing height H; +X forward, +Y left, z up.

  height    z scale about the ground (feet stay on z = 0)
  breadth   x and y scale about the body's vertical axis (whole body)
  width     lateral scale of the torso, peak `peak` over the z band
            `z = (rise0, rise1, fall0, fall1)` (1 below rise0 and above fall1,
            smoothstep between); the arms outboard of the arm root |y| = w
            are MOVED out with it by (s(z) - 1) * w rather than scaled, so an
            arm does not get longer and the armpit seam stays closed
  depth     x scale about the torso's own centre x, same band shape
  arm       radial scale of each arm about its own shoulder-elbow-wrist
            axis (sleeve girth), faded in over the first 0.04 H outboard of
            the root and out over the hand
"""

import math

import numpy as np

IDENTITY = {"height": 1.0, "breadth": 1.0, "width": None, "depth": None, "arm": 1.0}

#: team -> figure prefix -> build. A figure absent from a listed team is the
#: unmodified source, which the guard counts like any other build.
BUILDS = {
    # GH-709 Phase 7 (22 Oct): the Zaron Missile Team, three of mortar_team's
    # Meshy crewman. The leader stands tallest; the loader, who lifts the
    # canisters, is the strong one; the gunner at the fire-control case is
    # the heavier one.
    "at_nlos_team": {
        "nl_lead": {"label": "tall", "height": 1.06, "breadth": 1.02},
        "nl_load": {"label": "strong",
                    "width": {"peak": 1.13, "z": (0.60, 0.68, 0.82, 0.87)},
                    "depth": {"peak": 1.06, "z": (0.60, 0.68, 0.82, 0.87)},
                    "arm": 1.12},
        "nl_gun": {"label": "heavier",
                   "width": {"peak": 1.12, "z": (0.40, 0.50, 0.62, 0.70)},
                   "depth": {"peak": 1.13, "z": (0.40, 0.50, 0.62, 0.70)}},
    },
}

#: team -> figure prefix -> where a figure that holds no weapon in its hands
#: carries kit's rifle. `back`: across the back, muzzle up over the left
#: shoulder, on `{prefix}_spine` (and on the walker's own spine).
SLUNG = {
    "at_nlos_team": {"nl_gun": "back", "nl_load": "back"},
}

#: Two builds closer than this in EVERY measure are the same body.
SAME_BUILD_TOL = 0.02
#: And a build must move the source by at least this much somewhere -- the
#: rule's believable range starts at +5% (tall +5-7%, strong and heavier
#: +10-15%), so a 1% "heavier" is the source with a label.
MIN_BUILD_DELTA = 0.05


def build_of(team_id, prefix):
    out = dict(IDENTITY)
    out.update(BUILDS.get(team_id, {}).get(prefix, {}))
    return out


def _signature(b):
    """What a build does, as numbers: height, then torso width/depth and arm
    girth at the chest and at the waist (the factor each band ends up at)."""
    def band_at(spec, zf):
        return 1.0 if spec is None else profile(np.array([zf]), spec["peak"], spec["z"])[0]
    return np.array([b["height"], b["breadth"],
                     band_at(b["width"], 0.74), band_at(b["width"], 0.56),
                     band_at(b["depth"], 0.74), band_at(b["depth"], 0.56), b["arm"]])


def check_team(team_id, figures):
    """Refuse a table that breaks the standing rule for `team_id`, whose
    figure specs are `figures` (rig.TEAM_FIGURES[team_id]: dicts with
    `prefix` and `weapon`). Returns the per-figure labels. Only teams listed
    in BUILDS are held to it (the rule post-dates every other team)."""
    if team_id not in BUILDS:
        return {}
    prefixes = [f["prefix"] for f in figures]
    unknown = set(BUILDS[team_id]) - set(prefixes)
    if unknown:
        raise SystemExit(f"{team_id}: BUILDS names figures the team does not have: {sorted(unknown)}")
    sigs = {p: _signature(build_of(team_id, p)) for p in prefixes}
    src = _signature(dict(IDENTITY))
    for p in prefixes:
        if float(np.max(np.abs(sigs[p] - src))) < MIN_BUILD_DELTA:
            raise SystemExit(f"{team_id}: {p}'s build moves the source body by under {MIN_BUILD_DELTA:.0%} "
                             f"anywhere -- not a different build")
    for i, a in enumerate(prefixes):
        for b in prefixes[i + 1:]:
            if float(np.max(np.abs(sigs[a] - sigs[b]))) < SAME_BUILD_TOL:
                raise SystemExit(f"{team_id}: {a} and {b} have the same build "
                                 f"({BUILDS[team_id].get(a, {}).get('label', 'source')} / "
                                 f"{BUILDS[team_id].get(b, {}).get('label', 'source')}) -- the standing rule wants "
                                 f"every figure's body shape different")
    slung = SLUNG.get(team_id, {})
    for f in figures:
        if not f.get("weapon") and f["prefix"] not in slung:
            raise SystemExit(f"{team_id}: {f['prefix']} carries no weapon -- hold one (`weapon`) or sling kit's "
                             f"rifle (SLUNG)")
        if f["prefix"] in slung and slung[f["prefix"]] != "back":
            raise SystemExit(f"{team_id}: {f['prefix']}: unknown sling {slung[f['prefix']]!r}")
    return {p: BUILDS[team_id].get(p, {}).get("label", "source") for p in prefixes}


def profile(zf, peak, z):
    """The band factor at height fractions `zf`: 1 outside, `peak` on the
    plateau, smoothstep on the two ramps."""
    r0, r1, f0, f1 = z
    def ss(t):
        t = np.clip(t, 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)
    up = ss((zf - r0) / max(r1 - r0, 1e-9))
    down = 1.0 - ss((zf - f0) / max(f1 - f0, 1e-9))
    return 1.0 + (peak - 1.0) * np.minimum(up, down)


def _arm_param(co, axis):
    """For each point, (distance along the shoulder-elbow-wrist polyline from
    the shoulder, nearest point on it, total length)."""
    s, e, w = (np.asarray(p, dtype=np.float64) for p in axis)
    best_d = np.full(len(co), np.inf)
    best_q = np.zeros_like(co)
    best_t = np.zeros(len(co))
    acc = 0.0
    for a, b in ((s, e), (e, w)):
        ab = b - a
        L = float(np.linalg.norm(ab))
        u = np.clip(((co - a) @ ab) / max(L * L, 1e-12), 0.0, 1.0)
        q = a + u[:, None] * ab
        d = np.linalg.norm(co - q, axis=1)
        m = d < best_d
        best_d[m], best_q[m], best_t[m] = d[m], q[m], acc + u[m] * L
        acc += L
    # Past the wrist: continue along the forearm's direction (the hand).
    fw = w - e
    fw /= max(float(np.linalg.norm(fw)), 1e-12)
    beyond = (co - w) @ fw
    past = (beyond > 0) & (best_t >= acc - 1e-9)
    best_t[past] = acc + beyond[past]
    best_q[past] = w + beyond[past, None] * fw
    return best_t, best_q, acc


def deform(co, H, w_arm, axes, build):
    """Apply `build` to points `co` (N x 3, the standing source: feet on z 0,
    ankles on the origin, +X forward). `w_arm`: the arm-root half-width;
    `axes`: {side: (shoulder, elbow, wrist)} for the arm sides not kept on the
    torso. Returns (new points, new H, new w_arm, new axes) -- the axes and
    w_arm are carried through the SAME map, since `cut_figure` classifies by
    them (`_ARM_AXES_CACHE`)."""
    co = np.array(co, dtype=np.float64)
    pts = {side: np.array(ax, dtype=np.float64) for side, ax in axes.items()}

    def all_points():
        return np.vstack([co] + [pts[s] for s in pts]) if pts else co.copy()

    def put(arr):
        nonlocal co
        n = len(co)
        co = arr[:n]
        for i, side in enumerate(pts):
            pts[side] = arr[n + 3 * i: n + 3 * i + 3]

    zf_src = None
    # 1. Arm girth, about the source arm axes (before anything moves them).
    if build["arm"] != 1.0 and pts:
        a = all_points()
        n = len(co)
        zf_src = a[:, 2] / H
        for side, ax in pts.items():
            sgn = -1.0 if side == 0 else 1.0
            t, q, L = _arm_param(a, ax)
            yout = a[:, 1] * sgn - w_arm
            fade_in = np.clip(yout / (0.04 * H), 0.0, 1.0)
            fade_out = 1.0 - np.clip((t - L) / (0.06 * H), 0.0, 1.0)
            on = (yout > 0) & (zf_src > 0.45)
            f = 1.0 + (build["arm"] - 1.0) * fade_in * fade_out * on
            f[n:] = 1.0                     # the axis points stay on the axis
            a = q + (a - q) * f[:, None]
        put(a)
    # 2. Torso width (arms moved out with it) and depth, in bands of H.
    a = all_points()
    zf = a[:, 2] / H
    if build["width"] is not None:
        s = profile(zf, build["width"]["peak"], build["width"]["z"])
        y = a[:, 1]
        ay = np.abs(y)
        inner = ay < w_arm
        ny = np.where(inner, y * s, np.sign(y) * (ay + (s - 1.0) * w_arm))
        a[:, 1] = ny
    if build["depth"] is not None:
        d = profile(zf, build["depth"]["peak"], build["depth"]["z"])
        torso = (np.abs(co[:, 1]) < w_arm) & (co[:, 2] > 0.45 * H) & (co[:, 2] < 0.85 * H)
        xc = float(co[torso, 0].mean()) if torso.any() else 0.0
        a[:, 0] = xc + (a[:, 0] - xc) * d
    put(a)
    # 3. Whole-body breadth and height.
    a = all_points()
    a[:, 0] *= build["breadth"]
    a[:, 1] *= build["breadth"]
    a[:, 2] *= build["height"]
    put(a)
    # The arm root: a point ON the root plane at the shoulder's height goes
    # where the plane goes (`width` moves |y| = w to s(z) * w).
    w_new = w_arm
    if build["width"] is not None and pts:
        z_sh = float(np.mean([axes[s][0][2] for s in axes])) / H
        w_new = w_arm * float(profile(np.array([z_sh]), build["width"]["peak"], build["width"]["z"])[0])
    w_new *= build["breadth"]
    return co, H * build["height"], w_new, {s: tuple(tuple(float(v) for v in p) for p in pts[s]) for s in pts}


def measure(co, H, w_arm):
    """Plain extents for the importer's log and the self-test: standing
    height, chest width (0.70-0.80 H) and waist width/depth (0.50-0.60 H),
    the torso only (inboard of the arm root, |y| under `w_arm`)."""
    co = np.asarray(co)
    zf = co[:, 2] / H
    def ext(sel, k):
        return float(co[sel, k].max() - co[sel, k].min()) if sel.any() else 0.0
    torso = np.abs(co[:, 1]) < w_arm
    chest = torso & (zf > 0.70) & (zf < 0.80)
    waist = torso & (zf > 0.50) & (zf < 0.60)
    return {"height": float(co[:, 2].max() - co[:, 2].min()), "chest_w": ext(chest, 1),
            "waist_w": ext(waist, 1), "waist_d": ext(waist, 0)}


if __name__ == "__main__":
    # A synthetic body: torso cylinder, two A-pose arms. Each build must move
    # what it says and nothing it does not; the guard must pass the table.
    rng = np.random.default_rng(7)
    H = 1.76
    n = 4000
    th = rng.uniform(0, 2 * math.pi, n)
    zt = rng.uniform(0.0, 0.88 * H, n)
    body = np.c_[0.12 * np.cos(th), 0.17 * np.sin(th), zt]
    arm = []
    for sgn in (-1, 1):
        t = rng.uniform(0, 1, 800)
        c = np.c_[np.zeros(800), sgn * (0.20 + 0.45 * t), 0.80 * H - 0.35 * t]
        arm.append(c + rng.normal(0, 0.03, c.shape))
    co = np.vstack([body] + arm)
    axes = {0: ((0, -0.21, 0.80 * H), (0, -0.42, 0.70 * H), (0, -0.62, 0.62 * H)),
            1: ((0, 0.21, 0.80 * H), (0, 0.42, 0.70 * H), (0, 0.62, 0.62 * H))}
    base = measure(co, H, 0.19)
    print("check_team:", check_team("at_nlos_team", [{"prefix": "nl_gun"}, {"prefix": "nl_load"},
                                                     {"prefix": "nl_lead", "weapon": "rifle"}]))
    for p in ("nl_lead", "nl_load", "nl_gun"):
        out, h2, w2, ax2 = deform(co, H, 0.19, axes, build_of("at_nlos_team", p))
        m = measure(out, h2, w2)
        print(p, {k: round(m[k] / base[k], 3) for k in m}, "feet z", round(float(out[:, 2].min()), 4),
              "w", round(w2, 3))
