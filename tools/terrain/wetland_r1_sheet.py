"""Turn the R1 raw renders into the approval plates and the contact sheet (GH-871 P3).

    python3 tools/terrain/wetland_r1_sheet.py --raw <dir from render_wetland_r1.py> \\
        --tiles <dir from author_wetland_tiles.py> --out <p3-r1 dir> [--only reed_0,...]

Plain python3 (numpy, cv2, PIL): Blender ships no PIL. The tone map is the game's:
three.js `ACESFilmicToneMapping` at exposure 1.0 over LINEAR radiance, then the sRGB
transfer, applied AFTER any supersample box-down (the engine resolves MSAA in linear
HDR and tone-maps in the output pass). The raw PNGs are 16-bit linear
(`wetland_r1_rig.py`, view transform Raw).
"""
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

HERO_EV = 2.5  # hero and turntable panels only; the rain light is dark by design
FONT_PATH = "/System/Library/Fonts/Helvetica.ttc"
MONO_PATH = "/System/Library/Fonts/Menlo.ttc"


def font(size, mono=False):
    try:
        return ImageFont.truetype(MONO_PATH if mono else FONT_PATH, size)
    except Exception:
        return ImageFont.load_default()


# --- tone map -----------------------------------------------------------------------

_IN = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
_OUT = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])


def aces(lin, exposure=1.0):
    """three.js ACESFilmicToneMapping over linear RGB (H, W, 3) floats."""
    c = lin * (exposure / 0.6)
    c = c @ _IN.T
    a = c * (c + 0.0245786) - 0.000090537
    b = c * (0.983729 * c + 0.4329510) + 0.238081
    c = a / b
    c = c @ _OUT.T
    return np.clip(c, 0.0, 1.0)


def encode_srgb(l):
    l = np.clip(l, 0.0, 1.0)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(l, 1 / 2.4) - 0.055)


def load_raw(path):
    """16-bit linear RGBA PNG -> float RGBA in [0, 1] (straight alpha)."""
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if a is None:
        raise FileNotFoundError(path)
    a = a.astype(np.float32) / (65535.0 if a.dtype == np.uint16 else 255.0)
    if a.shape[2] == 3:
        a = np.concatenate([a, np.ones(a.shape[:2] + (1,), np.float32)], axis=2)
    return a[..., [2, 1, 0, 3]]  # BGRA -> RGBA


def box_down(img, ss):
    if ss == 1:
        return img
    h, w = img.shape[:2]
    return img[: h // ss * ss, : w // ss * ss].reshape(h // ss, ss, w // ss, ss, -1).mean(axis=(1, 3))


def lit_to_image(path, ss=1, over=(0.0, 0.0, 0.0), exposure=1.0):
    """Raw linear render -> sRGB 8-bit PIL image; alpha composited over `over` (linear)."""
    raw = load_raw(path)
    # premultiply before the box so transparent texels do not drag colour in
    rgb = raw[..., :3] * raw[..., 3:4]
    rgb = box_down(np.concatenate([rgb, raw[..., 3:4]], axis=2), ss)
    alpha = rgb[..., 3:4]
    lin = rgb[..., :3] + np.array(over, np.float32) * (1.0 - alpha)
    out = encode_srgb(aces(lin, exposure))
    return Image.fromarray(np.rint(out * 255).astype(np.uint8), "RGB")


def sil_to_image(path, ss=1):
    """Raw render (alpha is coverage) -> a pure black silhouette on white, thresholded
    at 50% coverage after the box (the sprite gate's binary alpha)."""
    raw = load_raw(path)
    cov = box_down(raw[..., 3:4], ss)[..., 0]
    out = np.where(cov >= 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "L").convert("RGB"), float((cov >= 0.5).mean())


def wire_to_image(path, bg=(14, 16, 20)):
    raw = load_raw(path)
    a = raw[..., 3:4]
    rgb = np.clip(raw[..., :3] * a, 0, 1)
    out = rgb + np.array(bg, np.float32) / 255.0 * (1 - a)
    return Image.fromarray(np.rint(np.clip(out, 0, 1) * 255).astype(np.uint8), "RGB")


def up(img, k, resample=Image.NEAREST):
    return img.resize((img.width * k, img.height * k), resample)


def fit(img, w, h):
    s = min(w / img.width, h / img.height)
    return img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)


def label(im, text, xy, size=22, fill=(255, 255, 255), mono=False, bg=None):
    d = ImageDraw.Draw(im)
    f = font(size, mono)
    if bg is not None:
        w = d.textlength(text, font=f)
        d.rectangle([xy[0] - 6, xy[1] - 4, xy[0] + w + 6, xy[1] + size + 6], fill=bg)
    d.text(xy, text, font=f, fill=fill)


# --- plates -------------------------------------------------------------------------------

SPEC = {
    "reed_0": ("common reed (Phragmites)", 1.25, 400, "foliage straw `dust.5` #806032 + trunk new shoots `scrub.1` #3E5C2E"),
    "reed_1": ("common reed (Phragmites)", 1.10, 400, "foliage straw `dust.5` #806032 + trunk new shoots `scrub.1` #3E5C2E"),
    "reed_2": ("bulrush (Typha)", 1.00, 400, "foliage `dust.5` #806032 + trunk new shoots `scrub.1` #3E5C2E"),
    "wet_grass_0": ("spring-flush sward tuft", 0.40, 200, "foliage `grass.3` #8AB04E + straw in `trunk` (untinted, dust.4 #96703C)"),
    "wet_grass_1": ("spring-flush sward tuft", 0.38, 200, "foliage `grass.3` #8AB04E + straw in `trunk` (untinted, dust.4 #96703C)"),
    "wet_grass_2": ("spring-flush sward tuft", 0.40, 200, "foliage `grass.3` #8AB04E + straw in `trunk` (untinted, dust.4 #96703C)"),
    "round_bale": ("wrapped silage bale", 1.0, 160, "rubber `gunmetal.3` #363B39 (black wrap)"),
    "culvert_pipe": ("culvert mouth", 1.0, 140, "concrete `limestone.3` #C8B494 (the role's lit step)"),
}
GROUND_LINEAR = {  # the plate ground, lit, over which silhouettes are judged
    "marsh": "#584535",
    "open": "#7F9F57",
}


def plate(raw_dir, name, meta):
    d = os.path.join(raw_dir, "plates", name)
    info = meta["plates"][name]
    title, height, cap, roles = SPEC[name]
    W, H = 2440, 1440
    im = Image.new("RGB", (W, H), (30, 32, 36))
    label(im, f"{name}   {title}   model {height:.2f} m   {info['tris']} triangles (cap {cap}, {cap - info['tris']} under)", (24, 14), 30)
    label(im, roles, (24, 54), 20, fill=(200, 205, 210))
    ex = info["extent_m"]
    label(im, f"footprint {ex[0]:.2f} x {ex[1]:.2f} m, height {ex[2]:.2f} m   |   wire twin: dark faces, 1 px lines on every triangle edge", (24, 82), 18, fill=(160, 166, 172))
    # hero + wire
    hero = lit_to_image(os.path.join(d, "hero.png"), exposure=HERO_EV)
    wire = wire_to_image(os.path.join(d, "wire.png"))
    im.paste(fit(hero, 760, 760), (24, 122))
    im.paste(fit(wire, 760, 760), (800, 122))
    label(im, f"lit, rainLight, ACES x{HERO_EV} (legibility)", (32, 130), 18, bg=(0, 0, 0))
    label(im, f"wire-shaded: {info['tris']} triangles", (808, 130), 18, bg=(0, 0, 0))
    label(im, f"hero and turntable are lifted x{HERO_EV}; the four game-scale panels below are the true x1.0 exposure", (24, 886), 16, fill=(200, 205, 210))
    # turntable 4 x 2
    tw = 190
    for k in range(8):
        t = lit_to_image(os.path.join(d, f"turn_{k}.png"), exposure=HERO_EV)
        x, y = 1580 + (k % 4) * (tw + 8), 122 + (k // 4) * (tw + 8)
        im.paste(fit(t, tw, tw), (x, y))
        label(im, f"{k * 45}", (x + 4, y + 2), 14, bg=(0, 0, 0))
    label(im, "turntable (the object yaws; camera and sun fixed)", (1580, 122 + 2 * (tw + 8) + 2), 16, fill=(200, 205, 210))
    # game-scale strips
    y0 = 122 + 760 + 24
    ph = 480
    panels = []
    for zlabel, nat, k in (("z1", "zoom 1", 5), ("z25", "zoom 2.5", 2)):
        wn, hn = info[f"{zlabel}_native"]
        ss = info[f"{zlabel}_ss"]
        lit = lit_to_image(os.path.join(d, f"{zlabel}_lit.png"), ss)
        sil, fill = sil_to_image(os.path.join(d, f"{zlabel}_sil.png"), ss)
        panels.append((f"{nat}: native {wn}x{hn} px, shown x{k}, standing + piece (x{info[f'{zlabel}_scale']}) + kneeling", up(lit, k)))
        panels.append((f"{nat}: pure-black silhouette, same frame", up(sil, k)))
    x = 24
    for txt, img in panels:
        label(im, txt, (x, y0), 15, fill=(200, 205, 210))
        im.paste(img, (x, y0 + 24))
        x += img.width + 12
    return im


# --- scene --------------------------------------------------------------------------------


def scene_images(raw_dir, meta):
    out = {}
    s = meta["scene"]["views"]
    for name, v in s.items():
        p = os.path.join(raw_dir, "scene", f"{name}_lit.png")
        if os.path.exists(p):
            out[name] = lit_to_image(p, v["ss"])
        p = os.path.join(raw_dir, "scene", f"{name}_sil.png")
        if os.path.exists(p):
            im, _ = sil_to_image(p, v["ss"])
            out[name + "_sil"] = im
    return out


# --- figure check ---------------------------------------------------------------------------


def figcheck_stats(raw_dir, meta):
    fc = meta["figcheck"]
    pts = fc["points"]
    res = fc["results"]
    out = {}
    for posture, conds in res.items():
        stats = {}
        ref_counts = None
        for cname in ("none", "current", "fallback", "x1.5", "mass2", "mass3"):
            if cname not in conds:
                continue
            raw = load_raw(os.path.join(raw_dir, "figcheck", conds[cname]["png"]))
            a = raw[..., 3]
            ids = np.rint(raw[..., 0] * 64.0).astype(int)
            head = raw[..., 1] > 0.75
            n = len(pts)
            sel = a > 0.5
            counts_head = np.bincount(ids[sel & head], minlength=n + 2)[1 : n + 1]
            counts_body = np.bincount(ids[sel & ~head], minlength=n + 2)[1 : n + 1]
            if cname == "none":
                ref_counts = (counts_head, counts_body)
            stats[cname] = dict(head=counts_head.tolist(), body=counts_body.tolist())
        rh, rb = ref_counts
        for cname, s in stats.items():
            h = np.array(s["head"], float)
            b = np.array(s["body"], float)
            fh = h / np.maximum(rh, 1)
            fb = b / np.maximum(rb, 1)
            s["head_fraction"] = fh.tolist()
            s["body_fraction"] = fb.tolist()
            s["summary"] = dict(
                head_min=float(fh.min()),
                head_p10=float(np.percentile(fh, 10)),
                head_median=float(np.median(fh)),
                head_mean=float(fh.mean()),
                head_ge50=int((fh >= 0.5).sum()),
                head_ge25=int((fh >= 0.25).sum()),
                head_zero=int((fh <= 0.0).sum()),
                body_median=float(np.median(fb)),
                body_mean=float(fb.mean()),
                n=int(len(fh)),
                head_px_ref=float(np.median(rh)) / (meta["figcheck"]["ss"] ** 2),
            )
        out[posture] = stats
    return out


def figcheck_chart(stats, meta):
    """A bar chart of head-and-shoulders visibility by condition."""
    W, H = 1500, 560
    im = Image.new("RGB", (W, H), (30, 32, 36))
    label(im, "Head and shoulders visible, per figure position (36 dry marsh points, zoom 1, 4x supersample)", (20, 12), 24)
    conds = [("current", "current reeds (1.25/1.10/1.00 m, placer rolls)"), ("fallback", "sheet fallback (1.1/1.0/0.9 m)"), ("x1.5", "reeds x1.5 (constructed failing input)")]
    colors = {"current": (110, 190, 120), "fallback": (120, 160, 220), "x1.5": (220, 120, 100)}
    y = 60
    for posture in ("kneeling", "standing"):
        label(im, f"{posture} figure", (20, y), 22, fill=(230, 230, 120))
        y += 32
        for key, text in conds:
            s = stats[posture][key]["summary"]
            vals = np.array(stats[posture][key]["head_fraction"])
            x0, bw = 520, 36
            label(im, text, (20, y + 2), 16, fill=(200, 205, 210))
            vals_sorted = np.sort(vals)
            for i, v in enumerate(vals_sorted):
                h = int(60 * v)
                im.paste(colors[key], (x0 + i * (bw // 2 + 4), y + 56 - h, x0 + i * (bw // 2 + 4) + bw // 2, y + 56))
            label(
                im,
                f"median {s['head_median']*100:.0f}%  mean {s['head_mean']*100:.0f}%  min {s['head_min']*100:.0f}%  >=50%: {s['head_ge50']}/{s['n']}  >=25%: {s['head_ge25']}/{s['n']}  zero: {s['head_zero']}",
                (x0 + 36 * 22 + 10 - 360, y + 20),
                15,
                fill=(230, 230, 230),
                mono=True,
            ) if False else label(
                im,
                f"median {s['head_median']*100:.0f}%  min {s['head_min']*100:.0f}%  >=50%: {s['head_ge50']}/{s['n']}  zero: {s['head_zero']}",
                (1130, y + 20),
                15,
                fill=(230, 230, 230),
                mono=True,
            )
            y += 66
        y += 12
    return im


def share_stats(raw_dir, meta):
    """Reed share of the marsh area P, plan and game view, from the two emission passes."""
    out = {}
    for view, v in meta["share"]["views"].items():
        area = load_raw(v["area"])
        reeds = load_raw(v["reeds"])
        in_p = (area[..., 2] > 0.5) & (area[..., 3] > 0.5)
        white = (reeds[..., 0] > 0.5) & (reeds[..., 1] > 0.5) & (reeds[..., 3] > 0.5)
        out[view] = dict(
            share=float((white & in_p).sum() / in_p.sum()),
            area_px=int(in_p.sum()),
            share_of_dry=float((white & in_p).sum() / (in_p.sum() * (1.0 - meta["share"]["water_share"]))),
        )
    out["water_share"] = meta["share"]["water_share"]
    return out


def tiles_panel(tiles_dir):
    rep = json.load(open(os.path.join(tiles_dir, "report.json")))
    names = ["wetland_open_tile", "basalt_rock_tile", "wet_scrub_tile", "oak_litter_tile", "basalt_scree_tile"]
    slots = {
        "wetland_open_tile": "open ground (9 m, repeat 3, gain 1.25)",
        "basalt_rock_tile": "rock ^ (6 m, repeat 2, gain 1)",
        "wet_scrub_tile": "scrub / marsh floor (6 m, repeat 2, gain 2)",
        "oak_litter_tile": "oak grove floor (6 m, repeat 2, gain 1.5)",
        "basalt_scree_tile": "knoll n and road grain (9 m, repeat 3, gain 1)",
    }
    S = 520
    W, H = 5 * S + 6 * 14, S + 250
    im = Image.new("RGB", (W, H), (30, 32, 36))
    label(im, "The five ground tiles, 3 x 3 repeat (RATIO images: the theme tone sets the average, so these are shown as authored)", (14, 10), 24)
    for k, n in enumerate(names):
        sw = Image.open(os.path.join(tiles_dir, n + "_swatch3x3.png")).convert("RGB").resize((S, S), Image.LANCZOS)
        x = 14 + k * (S + 14)
        im.paste(sw, (x, 50))
        r = rep[n]
        label(im, n, (x, 50 + S + 6), 20)
        label(im, slots[n], (x, 50 + S + 30), 14, fill=(200, 205, 210))
        label(im, f"mean {r['mean']}  (GROUND_ALBEDOS row)", (x, 50 + S + 50), 14, fill=(200, 205, 210))
        label(im, f"seam ratio {r['seam_ratio']:.2f} rank {r['seam_rank']:.2f} ({'ok' if r['seam_ok'] else 'FAIL'}); contrast {r['contrast']:.3f} (floor 0.05)", (x, 50 + S + 70), 14, fill=(200, 205, 210))
        label(im, f"{r['jpeg_kb']} KB q90 4:4:4; {r['texels_per_metre']} texels/m", (x, 50 + S + 90), 14, fill=(200, 205, 210))
        for j, (key, fg) in enumerate(r.get("figure_ground", {}).items()):
            label(im, f"within dE12 of olive.1 on {fg['tone']}: {fg['share_within_12']*100:.1f}%", (x, 50 + S + 112 + j * 20), 14, fill=(230, 230, 120) if fg["share_within_12"] > 0.05 else (150, 220, 150))
    return im


def scene_pages(raw_dir, meta, out):
    ims = scene_images(raw_dir, meta)
    pages = {}
    # zoom 1: native, shown x2 nearest, and x1
    o = ims["overview_z1"]
    pg = Image.new("RGB", (o.width * 2 + 20, o.height * 2 + 70), (30, 32, 36))
    label(pg, "R3 composed scene, ZOOM 1: native %dx%d px shown x2 (nearest). Real Ein Qasab window and placer; oak grove = cedar STAND-IN." % o.size, (10, 8), 17)
    label(pg, "Marsh with real water field, reed mat, KDF figures standing and kneeling in the reeds (centre) and on open sward (lower left).", (10, 28), 17)
    pg.paste(up(o, 2), (10, 50))
    pages["r3_scene_zoom1"] = pg
    for key, title in (("marsh_z25", "ZOOM 2.5"), ("marsh_z6", "ZOOM 6 (a true re-render, not an upscale)")):
        lit, sil = ims[key], ims[key + "_sil"]
        pg = Image.new("RGB", (lit.width * 2 + 30, lit.height + 70), (30, 32, 36))
        label(pg, f"R3 marsh, {title}: lit (rainLight, ACES x1.0) | pure-black silhouette, same frame.", (10, 8), 17)
        label(pg, "A standing and a kneeling KDF figure in the reeds, 3 m apart.", (10, 28), 17)
        pg.paste(lit, (10, 50))
        pg.paste(sil, (lit.width + 20, 50))
        pages[f"r3_{key}"] = pg
    g = ims["grove_z25"]
    pg = Image.new("RGB", (g.width + 20, g.height + 70), (30, 32, 36))
    label(pg, "R3 oak-grove STAND-IN (cedar GLBs, tinted scrub.1 / mud.2 trunks) on the wet sward, zoom 2.5. The real oak is a Meshy asset and waits on the key limit.", (10, 8), 17)
    pg.paste(g, (10, 50))
    pages["r3_grove_zoom2p5"] = pg
    return pages


def figcheck_page(raw_dir, meta, stats, share):
    W, H = 1700, 1180
    im = Image.new("RGB", (W, H), (30, 32, 36))
    label(im, "Spec check: a kneeling KDF figure in the marsh keeps a visible head and shoulders at zoom 1", (20, 12), 28)
    label(im, "Instrument: emission mask at 60 px/m (zoom 1 x4), 36 dry marsh points of Ein Qasab's real marsh, the real placer's reed rolls; every reed is a black occluder.", (20, 52), 16, fill=(200, 205, 210))
    label(im, "Visible fraction = figure pixels left / pixels with no reeds. Head and shoulders = the top 30% of the kneeling figure (1.28 m, so above 0.90 m), the top 28% of the standing one (1.76 m).", (20, 74), 16, fill=(200, 205, 210))
    cols = [(k, t) for k, t in (("none", "no reeds"), ("current", "current reeds"), ("fallback", "sheet fallback 1.1/1.0/0.9 m"), ("x1.5", "reeds x1.5 (falsifier)"), ("mass2", "2x reed mass (what-if)"), ("mass3", "3x reed mass (what-if)")) if k in stats["kneeling"]]
    y = 112
    for posture in ("kneeling", "standing"):
        label(im, f"{posture} figure: head and shoulders visible (body in brackets)", (20, y), 22, fill=(230, 230, 120))
        y += 34
        label(im, "condition", (20, y), 15, mono=True, fill=(180, 180, 180))
        for k, t in enumerate(["median", "mean", "min", ">=50% of pts", "zero pts"]):
            label(im, t, (520 + k * 190, y), 15, mono=True, fill=(180, 180, 180))
        y += 24
        for key, text in cols:
            sm = stats[posture][key]["summary"]
            bad = key == "x1.5"
            col = (255, 160, 140) if bad else (230, 230, 230)
            label(im, text, (20, y), 16, mono=True, fill=col)
            vals = [f"{sm['head_median']*100:.0f}% ({sm['body_median']*100:.0f}%)", f"{sm['head_mean']*100:.0f}% ({sm['body_mean']*100:.0f}%)", f"{sm['head_min']*100:.0f}%", f"{sm['head_ge50']}/{sm['n']}", f"{sm['head_zero']}"]
            for k, v in enumerate(vals):
                label(im, v, (520 + k * 190, y), 16, mono=True, fill=col)
            y += 26
        y += 18
    label(im, "Reed share of the marsh (art-numbers 2.4: tuned in P3 until 65-75%, leaving 25-35% water)", (20, y), 22, fill=(230, 230, 120))
    y += 34
    label(im, f"water share of the marsh (real field, >= 0.5): {share['water_share']*100:.1f}%", (20, y), 16, mono=True)
    y += 24
    label(im, "view / mass", (20, y), 15, mono=True, fill=(180, 180, 180))
    for k, t in enumerate(["share of marsh", "share of the dry part"]):
        label(im, t, (520 + k * 260, y), 15, mono=True, fill=(180, 180, 180))
    y += 24
    for key in [k for k in ("plan_m1", "game_z1_m1", "plan_m2", "game_z1_m2", "plan_m3", "game_z1_m3") if k in share]:
        v = share[key]
        view, m = key.rsplit("_m", 1)
        lab = ("plan view" if view == "plan" else "game camera, zoom 1") + f", {m}x mass" + (" (placer)" if m == "1" else "")
        label(im, lab, (20, y), 16, mono=True)
        label(im, f"{v['share']*100:.0f}%", (520, y), 16, mono=True)
        label(im, f"{v['share_of_dry']*100:.0f}%", (780, y), 16, mono=True)
        y += 26
    return im


def contact_sheet(raw_dir, meta, tiles_dir, out, scene_ims):
    names = ["reed_0", "reed_1", "reed_2", "wet_grass_0", "wet_grass_1", "wet_grass_2", "round_bale", "culvert_pipe"]
    T = 470
    W = 4 * T + 5 * 12
    H = 2 * (T + 62) + 12 + 700 + 2 * 900
    im = Image.new("RGB", (W, H), (24, 26, 30))
    label(im, "Wetland P3 R1 approval set: procedural pieces, ground tiles, composed scene. Blender only. Nothing exported, no Meshy. Rain light, ACES, the game camera (30 deg, 225 deg).", (12, 10), 22)
    label(im, "Thumbnails are the hero views, lifted x2.5 for legibility; the plates carry the true-exposure game-scale panels.", (12, 38), 16, fill=(200, 205, 210))
    y = 70
    for k, n in enumerate(names):
        info = meta["plates"][n]
        title, height, cap, _ = SPEC[n]
        hero = lit_to_image(os.path.join(raw_dir, "plates", n, "hero.png"), exposure=HERO_EV)
        wire = wire_to_image(os.path.join(raw_dir, "plates", n, "wire.png"))
        x = 12 + (k % 4) * (T + 12)
        yy = y + (k // 4) * (T + 62)
        t = Image.new("RGB", (T, T), (0, 0, 0))
        t.paste(fit(hero, T, T), (0, 0))
        # the wire twin as an inset
        w = fit(wire, 170, 170)
        t.paste(w, (T - w.width - 4, T - w.height - 4))
        im.paste(t, (x, yy))
        label(im, f"{n}: {info['tris']} / {cap} tris   {height:.2f} m   ({title})", (x, yy + T + 4), 16)
        label(im, f"{info['extent_m'][0]:.2f} x {info['extent_m'][1]:.2f} m footprint", (x, yy + T + 26), 14, fill=(200, 205, 210))
    y += 2 * (T + 62) + 6
    tp = tiles_panel(tiles_dir)
    tp = tp.resize((W - 24, int(tp.height * (W - 24) / tp.width)), Image.LANCZOS)
    im.paste(tp, (12, y))
    y += tp.height + 8
    o = scene_ims["overview_z1"]
    sc = up(o, 2)
    sc = sc.resize((W - 24, int(sc.height * (W - 24) / sc.width)), Image.NEAREST)
    label(im, "R3 composed scene at zoom 1 (native 720x410 shown x2): marsh with reed mat and water (left grove is the cedar STAND-IN for the oak), KDF figures in the reeds", (12, y), 18)
    y += 28
    im.paste(sc.crop((0, 0, min(sc.width, W - 24), sc.height)), (12, y))
    return im.crop((0, 0, W, y + sc.height + 12))


def compare_sheet(old_raw, new_raw, old_tiles, new_tiles, census_before, census_after, extra_lines=(), titles=None):
    """R1b: the old and new open tile, the old and new R3 scene, and the numbers that moved."""
    om, nm = json.load(open(os.path.join(old_raw, "meta.json"))), json.load(open(os.path.join(new_raw, "meta.json")))
    old_sc, new_sc = scene_images(old_raw, om)["overview_z1"], scene_images(new_raw, nm)["overview_z1"]
    sw_old = Image.open(os.path.join(old_tiles, "wetland_open_tile_swatch3x3.png")).convert("RGB")
    sw_new = Image.open(os.path.join(new_tiles, "wetland_open_tile_swatch3x3.png")).convert("RGB")
    rep_old = json.load(open(os.path.join(old_tiles, "report.json")))["wetland_open_tile"]
    rep_new = json.load(open(os.path.join(new_tiles, "report.json")))["wetland_open_tile"]
    W = 2 * 960 + 3 * 16
    S = 960
    sc_h = int(old_sc.height * 2 * 960 / (old_sc.width * 2))
    H = 60 + S + 150 + 40 + sc_h + 40 + 330 + 30 * len(extra_lines)
    im = Image.new("RGB", (W, H), (24, 26, 30))
    titles = titles or dict(
        head="R1b: the open-ground tile calmed (before | after), the R3 scene (before | after), and the numbers that moved. Rain light, ACES, game camera.",
        old="BEFORE: 9 m tile, repeat 3, gain 1.25, 40% mud in 1.5 m hard-edged patches",
        new="AFTER: 18 m tile, repeat 6, gain 1.0, 20% mud in 0.5-1 m patches, soft edge, narrower sward spread",
        old_m=9, new_m=18,
        scene="R3 scene at zoom 1 (native 720x410, shown x2). BEFORE: P2's 1.5 reed clumps a tile, 9 m tile.  AFTER: 3 clumps a tile, calmed 18 m tile.",
    )
    label(im, titles["head"], (16, 12), 22)
    y = 50
    for k, (sw, rep, name, dims) in enumerate(
        ((sw_old, rep_old, titles["old"], "old"), (sw_new, rep_new, titles["new"], "new"))
    ):
        x = 16 + k * (S + 16)
        label(im, name, (x, y), 17)
        im.paste(sw.resize((S, S), Image.LANCZOS), (x, y + 26))
        fg = rep["figure_ground"]["open"]
        label(im, f"3 x 3 repeat = {3 * (titles['old_m'] if k == 0 else titles['new_m'])} m a side.  mean {rep['mean']}  contrast {rep['contrast']:.3f} (floor 0.05)  figure-ground {fg['share_within_12']*100:.1f}% (limit 5%)  {rep['jpeg_kb']} KB", (x, y + 26 + S + 6), 15, fill=(200, 205, 210))
    y += 26 + S + 40
    label(im, titles["scene"], (16, y), 17)
    y += 26
    for k, sc in enumerate((old_sc, new_sc)):
        x = 16 + k * (S + 16)
        im.paste(up(sc, 2).resize((S, int(sc.height * 2 * S / (sc.width * 2))), Image.NEAREST), (x, y))
    y += sc_h + 14
    lines = []
    if census_before is not None:
        cb, ca = census_before, census_after
        lines = [
            "Ein Qasab placed-decor triangles, against the 0.9 M ceiling (trees at their Meshy caps: oak 2,500, willow 2,500, shrub 600; reeds and grass measured):",
            f"   BEFORE, 1.5 clumps a tile: {cb['p3']['total']:,} ({cb['p3']['share_of_ceiling']*100:.0f}%), reeds {cb['p3']['rows']['reed'][1]:,} in {cb['p3']['rows']['reed'][0]} placements",
            f"   AFTER,  3 clumps a tile:   {ca['p3']['total']:,} ({ca['p3']['share_of_ceiling']*100:.0f}%), reeds {ca['p3']['rows']['reed'][1]:,} in {ca['p3']['rows']['reed'][0]} placements   (the P2 stand-in census reads {cb['p2']['total']:,} before, {ca['p2']['total']:,} after)",
        ]
    lines += list(extra_lines)
    for i, t in enumerate(lines):
        label(im, t, (16, y + i * 24), 16, mono=True if i else False)
    return im.crop((0, 0, W, y + len(lines) * 24 + 16))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--compare-old-raw", default=None)
    ap.add_argument("--compare-old-tiles", default=None)
    ap.add_argument("--census-before", default=None)
    ap.add_argument("--census-after", default=None)
    ap.add_argument("--old-numbers", default=None)
    ap.add_argument("--r1c", action="store_true")
    ap.add_argument("--r1d", action="store_true")
    ap.add_argument("--raw", required=True)
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default=None)
    args = ap.parse_args()
    meta = json.load(open(os.path.join(args.raw, "meta.json")))
    os.makedirs(args.out, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    for name in meta.get("plates", {}):
        if only and name not in only:
            continue
        plate(args.raw, name, meta).save(os.path.join(args.out, f"plate_{name}.png"))
        print("plate", name)
    compare = args.compare_old_raw is not None
    tiles_panel(args.tiles).save(os.path.join(args.out, "tiles_swatches.png"))
    if "scene" in meta:
        for k, pg in scene_pages(args.raw, meta, args.out).items():
            pg.save(os.path.join(args.out, k + ".png"))
            print(k)
    numbers = {}
    if "figcheck" in meta and "share" in meta:
        stats = figcheck_stats(args.raw, meta)
        share = share_stats(args.raw, meta)
        figcheck_page(args.raw, meta, stats, share).save(os.path.join(args.out, "figcheck_and_reed_share.png"))
        numbers["figcheck"] = {p: {c: v["summary"] for c, v in d.items()} for p, d in stats.items()}
        numbers["reed_share"] = share
    numbers["tiles"] = json.load(open(os.path.join(args.tiles, "report.json")))
    if "plates" in meta:
        numbers["plates"] = meta["plates"]
    if args.census_after and args.census_before:
        numbers["census_after"] = json.load(open(args.census_after))
        numbers["census_before"] = json.load(open(args.census_before))
    json.dump(numbers, open(os.path.join(args.out, "numbers.json"), "w"), indent=2)
    if compare:
        old_n = json.load(open(args.old_numbers))
        sh_o, sh_n = old_n["reed_share"], numbers["reed_share"]
        fc_o, fc_n = old_n["figcheck"]["kneeling"]["current"], numbers["figcheck"]["kneeling"]["current"]
        extra = [
            f"Reed share of the marsh at zoom 1 (game camera): BEFORE {sh_o['game_z1_m1']['share']*100:.0f}% of the marsh ({sh_o['game_z1_m1']['share_of_dry']*100:.0f}% of the dry part), plan {sh_o['plan_m1']['share']*100:.0f}%   AFTER {sh_n['game_z1_m1']['share']*100:.0f}% ({sh_n['game_z1_m1']['share_of_dry']*100:.0f}% of the dry part), plan {sh_n['plan_m1']['share']*100:.0f}%   (water {sh_n['water_share']*100:.1f}%)",
            f"Kneeling figure, head and shoulders visible (36 dry marsh points): BEFORE median {fc_o['head_median']*100:.0f}% min {fc_o['head_min']*100:.0f}%   AFTER median {fc_n['head_median']*100:.0f}% min {fc_n['head_min']*100:.0f}%, {fc_n['head_ge50']}/{fc_n['n']} points keep at least half",
        ]
        titles = None
        if args.r1c or args.r1d:
            extra = []
            rn = numbers["tiles"]["wetland_open_tile"]
            ro = json.load(open(os.path.join(args.compare_old_tiles, "report.json")))["wetland_open_tile"]
            extra = [
                f"Open tile  {'R1c -> R1d' if args.r1d else 'R1b -> R1c'}:  contrast {ro['contrast']:.3f} -> {rn['contrast']:.3f} (floor 0.05)   figure-ground {ro['figure_ground']['open']['share_within_12']*100:.1f}% -> {rn['figure_ground']['open']['share_within_12']*100:.1f}% (limit 5%)   mean {ro['mean']} -> {rn['mean']}",
                f"Reeds as they were (3 clumps a tile): game-camera share {sh_n['game_z1_m1']['share']*100:.0f}% of the marsh ({sh_n['game_z1_m1']['share_of_dry']*100:.0f}% of the dry part); kneeling head+shoulders median {fc_n['head_median']*100:.0f}% min {fc_n['head_min']*100:.0f}%",
            ]
            titles = dict(
                head="R1d: no mud in the open tile (R1c | R1d), and the R3 scene (R1c | R1d). Reeds unchanged. Rain light, ACES, game camera.",
                old="R1c: 18 m tile, 10% mud as small irregular flecks (0.2-0.45 m), no landmark, mud 25% nearer the sward",
                new="R1d: 18 m tile, no mud at all. Variation is in the grass: lighter / darker regions, blade grain, a hint of yellow-green straw",
                old_m=18, new_m=18,
                scene="R3 scene at zoom 1 (native 720x410, shown x2). R1c (left) | R1d (right). Same reeds, same placer.",
            ) if args.r1d else dict(
                head="R1c: the open-ground tile calmed again (R1b | R1c) and the R3 scene (R1b | R1c). Reeds unchanged. Rain light, ACES, game camera.",
                old="R1b: 18 m tile, 20% mud in 0.5-1 m patches (a noise field thresholded), soft edge",
                new="R1c: 18 m tile, 10% mud as small irregular flecks (0.2-0.45 m), no landmark, mud 25% nearer the sward",
                old_m=18, new_m=18,
                scene="R3 scene at zoom 1 (native 720x410, shown x2). R1b (left) | R1c (right). Same reeds, same placer.",
            )
        compare_sheet(args.compare_old_raw, args.raw, args.compare_old_tiles, args.tiles, json.load(open(args.census_before)) if args.census_before else None, json.load(open(args.census_after)) if args.census_after else None, extra, titles).save(os.path.join(args.out, "00_contact_sheet.png"))
        print("compare sheet")
    elif "scene" in meta and "plates" in meta:
        contact_sheet(args.raw, meta, args.tiles, args.out, scene_images(args.raw, meta)).save(os.path.join(args.out, "00_contact_sheet.png"))
        print("contact sheet")


if __name__ == "__main__":
    main()
