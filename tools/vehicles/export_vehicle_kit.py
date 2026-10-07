"""Export a vehicle's kit parts at detail -- GH-238 plan 3, Task 4.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/vehicles/export_vehicle_kit.py -- [--only id,id] [--preview <dir>]

For each vehicle in `kit_vehicles.PARTS_DETAILED` (or `--only`):

  1. import the SHIPPED `art/meshes/vehicles/<id>.glb` (extras on), drop its
     `death_root`, `WRECK_*` twins, any `kit_*` node and every clip;
  2. build every part at detail (`kit_vehicles`), and the blockout's own part
     beside it (`kit_blockout.PARTS`, the same `Hull`); every face takes its
     TRACK's tone (`TRACK_TONE`, the approved colour study's "L3 shade"
     column: armour `paint`, sensors and firepower `metal`), `dark` kept only
     where a builder cut a lens, a window or an aperture;
  3. REFUSE (exit 1) a part over 1.10x its spec section 3 triangle budget, a
     vehicle over 5,000 kit triangles, a part whose bounding box moved off
     the mock's (size off by more than max(3 cm, 10%) on any axis, or centre
     off by more than 3 cm + 10% of its size) -- "built to the mock's numbers"
     -- unless that axis is a printed `kit_vehicles.DEVIATIONS` entry, or any
     CLASH (`kit_clash`: kit x kit, kit x the shipped nodes, the turret swept
     through 72 headings, and a kit piece wholly inside a shipped body or
     another track's closed part) not in the printed
     `kit_vehicles.CLASH_EXEMPTIONS`;
  4. choose the three tone texels of the vehicle's own bake (the plan's Tone
     table: `paint` = the hull's 25th-percentile paint, `metal` = the bake's
     metal, `dark` = the 5th percentile of the metal; where the metallic map
     is uniform and no textured `*_metal` node exists, a third rule, printed
     as a DEVIATION: `metal` = the greyest paint), each in a flat 16x16
     window (luminance spread < 0.02 linear) and on a neutral normal where the
     bake has a normal map; print them;
  5. join each (track, tier, host)'s pieces into ONE node
     `kit_<track>_<tier>_<host>` (identity transform, world-space vertices,
     `extras.rl_kit` + `extras.rl_role`), pin every loop to its tone's texel,
     and write `art/parts/kit/<id>.glb`: kit nodes only, no materials, no
     images, no animations. `pnpm kit:meshes` grafts it into the vehicle.

`--out <dir>` writes the kit GLBs there instead of `art/parts/kit/` -- for a
falsification run, or to diff a re-export against the shipped bytes without
touching them.

`--preview <dir>` renders stills the way `kit_blockout.py`'s mock does (the
game's sun, the dimetric camera, its px/m), but with the kit drawn in its
PINNED bake colours: kit level 0-3 at headings 240 and 60 at zoom 1.0 and 2.5,
and a ~150 px/m close-up at level 3 from both headings.

No `mathutils.noise`, no RNG: the same input writes the same bytes.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, HERE)
sys.path.insert(0, TOOLS)

import kit_blockout as kb  # noqa: E402 -- read-only: Hull, barrel, the blockout parts, the mock's camera
import kit_clash as kc  # noqa: E402
import kit_parts as kp  # noqa: E402
import kit_vehicles as kv  # noqa: E402

OUT_DIR = os.path.join(REPO, "art", "parts", "kit")

#: Flat-window rule for a pinned texel (the plan's Tone table).
WINDOW = 16
SPREAD_MAX = 0.02
NORMAL_TOL = 0.06
#: Mock-number tolerance: size within max(3 cm, 10%), centre within 3 cm + 10%.
TOL_ABS = 0.03
TOL_REL = 0.10
#: Faces bending more than this keep a hard edge on a smooth (curved) piece.
SMOOTH_SPLIT_DEG = 50.0
#: The tone a track's faces take (the approved colour study's "L3 shade"
#: column, `docs/art/sheets/kitted-vehicles/colour-study.png`): every ARMOUR
#: face in the shade paint texel, every SENSORS and FIREPOWER face in the
#: metal texel. `dark` survives on any track, and only lenses, windows and
#: apertures carry it (kit_parts' recesses, lenses and ports).
TRACK_TONE = {"armour": "paint", "sensors": "metal", "firepower": "metal"}


def log(msg):
    print(f"[kit] {msg}", flush=True)


class Refused(Exception):
    pass


# ---------------------------------------------------------------------------
# scene
# ---------------------------------------------------------------------------

def load_vehicle(vid):
    """The shipped GLB's live nodes: wreck, clips and any previous kit gone."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(REPO, "art", "meshes", "vehicles", f"{vid}.glb")
    bpy.ops.import_scene.gltf(filepath=path, import_scene_extras=True)
    for o in list(bpy.data.objects):
        if o.name == "death_root" or o.name.startswith("WRECK_") or o.name.startswith("kit_"):
            bpy.data.objects.remove(o, do_unlink=True)
    # and their meshes: a grafted GLB's own kit_* meshes, left as orphans,
    # would push this run's new nodes to "kit_....001" names
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()
    return [o for o in bpy.data.objects if o.type == "MESH"]


def world_bounds_of_objects(objs):
    cs = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    return (Vector([min(c[i] for c in cs) for i in range(3)]),
            Vector([max(c[i] for c in cs) for i in range(3)]))


def blockout_objects(vid, H):
    """{(track, tier): [(name, lo, hi)]} of the blockout's own parts, built
    against the same Hull and then removed from the scene."""
    out = {}
    for track, tier, _host, _label, fn in kb.PARTS[vid](H):
        objs = fn()
        rows = []
        for o in objs:
            lo, hi = world_bounds_of_objects([o])
            rows.append((o.name, lo, hi))
        out[(track, tier)] = rows
        for o in objs:
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.meshes.remove(me)
    return out


# ---------------------------------------------------------------------------
# the checks
# ---------------------------------------------------------------------------

def _union(boxes):
    lo = Vector([min(b[0][i] for b in boxes) for i in range(3)])
    hi = Vector([max(b[1][i] for b in boxes) for i in range(3)])
    return lo, hi


def detailed_box(pieces, base_z):
    """The union box of the pieces the mock is compared against: `mount`
    pieces out, a `ground` piece's bottom clipped at the mock's own bottom."""
    boxes = []
    for p in pieces:
        if p.mount:
            continue
        lo, hi = p.bounds()
        if p.ground:
            lo = Vector((lo.x, lo.y, max(lo.z, base_z)))
            hi = Vector((hi.x, hi.y, max(hi.z, lo.z)))
        boxes.append((lo, hi))
    return _union(boxes)


def compare_box(label, det, blk, skip_axes=""):
    """[(axis, problem)] where `det` is off the mock `blk`."""
    bad = []
    rows = []
    for i, ax in enumerate("xyz"):
        sb = blk[1][i] - blk[0][i]
        sd = det[1][i] - det[0][i]
        cb = (blk[1][i] + blk[0][i]) / 2
        cd = (det[1][i] + det[0][i]) / 2
        tol_s = max(TOL_ABS, TOL_REL * sb)
        tol_c = TOL_ABS + TOL_REL * sb
        ok_s = abs(sd - sb) <= tol_s
        ok_c = abs(cd - cb) <= tol_c
        skipped = ax in skip_axes
        rows.append(f"{ax}: size {sd:.3f} vs {sb:.3f} (d {sd - sb:+.3f}, tol {tol_s:.3f}) "
                    f"centre {cd:.3f} vs {cb:.3f} (d {cd - cb:+.3f}, tol {tol_c:.3f})"
                    + (" [DEVIATION: axis not compared]" if skipped else "")
                    + ("" if skipped or (ok_s and ok_c) else "  <-- OFF"))
        if not skipped and not ok_s:
            bad.append(f"{label} {ax}-size {sd:.3f} m vs the mock's {sb:.3f} m (tolerance {tol_s:.3f})")
        if not skipped and not ok_c:
            bad.append(f"{label} {ax}-centre {cd:.3f} vs the mock's {cb:.3f} (moved {cd - cb:+.3f}, tolerance {tol_c:.3f})")
    log(f"  mock check {label}:")
    for r in rows:
        log(f"      {r}")
    return bad


def check_part(vid, built, blockout):
    """Budgets and mock numbers; returns the list of refusals."""
    budgets = kv.BUDGETS[vid]
    split = kv.BLOCKOUT_SPLIT.get(vid, {})
    devs = kv.DEVIATIONS.get(vid, {})
    refusals = []
    parts = {}
    for (track, tier, host), pieces in built.items():
        parts.setdefault((track, tier), {})[host] = pieces
    total = 0
    for key in sorted(parts, key=lambda k: (kv.TRACKS.index(k[0]), k[1])):
        hosts = parts[key]
        t = sum(kp.tris(p) for p in hosts.values())
        total += t
        b = budgets[key]
        flag = "" if t <= b else ("  (over budget, inside the 1.10x slack)" if t <= kv.PART_SLACK * b else "  <-- OVER")
        log(f"PART {vid} {key[0]} {key[1]}: {t} tris, budget {b} ({t / b:.2f}x){flag}  "
            + ", ".join(f"{h}={kp.tris(p)}" for h, p in sorted(hosts.items())))
        if t > kv.PART_SLACK * b:
            refusals.append(f"{key[0]} {key[1]}: {t} triangles > {kv.PART_SLACK:.2f} x budget {b}")
        rows = blockout[key]
        if key in split:
            for host, prefixes in sorted(split[key].items()):
                if host not in hosts:
                    refusals.append(f"{key[0]} {key[1]}: no {host} node, though the blockout split names one")
                    continue
                brows = [(lo, hi) for n, lo, hi in rows if n.startswith(prefixes)]
                blk = _union(brows)
                det = detailed_box(hosts[host], blk[0].z)
                dev = devs.get((key[0], key[1], host))
                if dev:
                    log(f"  DEVIATION {key[0]} {key[1]} {host} ({dev[0]}): {dev[1]}")
                refusals += compare_box(f"{key[0]} {key[1]} {host}", det, blk, dev[0] if dev else "")
        else:
            blk = _union([(lo, hi) for _n, lo, hi in rows])
            allp = [p for ps in hosts.values() for p in ps]
            det = detailed_box(allp, blk[0].z)
            skip = "".join(devs[(key[0], key[1], h)][0] for h in hosts if (key[0], key[1], h) in devs)
            refusals += compare_box(f"{key[0]} {key[1]}", det, blk, skip)
    log(f"KIT {vid}: {total} triangles at maximum kit; spec budget {kv.VEHICLE_BUDGET[vid]}, cap {kv.VEHICLE_CAP}")
    if total > kv.VEHICLE_CAP:
        refusals.append(f"{vid}: {total} kit triangles > the {kv.VEHICLE_CAP} cap")
    missing = set(budgets) - set(parts)
    if missing:
        refusals.append(f"{vid}: no detailed part for {sorted(missing)}")
    return refusals, total


def apply_track_tone(track, pieces):
    """Every face of the part takes its track's tone, `dark` excepted (a
    lens, window or aperture keeps it); returns how many faces changed."""
    want = TRACK_TONE[track]
    moved = 0
    for p in pieces:
        new = [t if t == "dark" else want for t in p.tones]
        moved += sum(1 for a, b in zip(p.tones, new) if a != b)
        p.tones = new
    return moved


# ---------------------------------------------------------------------------
# tone texels
# ---------------------------------------------------------------------------

def _linked_image(mat, socket_name, through=()):
    """The TEX_IMAGE feeding `socket_name` of the Principled BSDF, directly
    or through nodes of the given types; returns (image, output_socket_name
    of the last hop) or (None, None)."""
    if not mat or not mat.use_nodes:
        return None, None
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None or socket_name not in bsdf.inputs:
        return None, None
    sock = bsdf.inputs[socket_name]
    hop = None
    for _ in range(4):
        if not sock.is_linked:
            return None, None
        link = sock.links[0]
        node = link.from_node
        if node.type == "TEX_IMAGE":
            return node.image, hop
        if node.type in through:
            hop = link.from_socket.name
            sock = node.inputs[0] if node.type != "NORMAL_MAP" else node.inputs["Color"]
            continue
        return None, None
    return None, None


def _pixels(img):
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    return px


def _srgb_to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def _lum(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def coverage(objs, w, h):
    """Texels inside the UV triangles of `objs`' faces (pixel centres)."""
    mask = np.zeros((h, w), dtype=bool)
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        uv = me.uv_layers.active.data
        for tri in me.loop_triangles:
            p = np.array([(uv[li].uv[0] * w, uv[li].uv[1] * h) for li in tri.loops], dtype=np.float64)
            x0, y0 = np.floor(p.min(axis=0)).astype(int)
            x1, y1 = np.ceil(p.max(axis=0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, w - 1), min(y1, h - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            a, b, c = p
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
            l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
            l3 = 1.0 - l1 - l2
            inside = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def find_texel(name, lin, mask, target, nrm=None, quiet=False):
    """The texel whose 16x16 window is fully inside `mask`, has luminance
    spread < SPREAD_MAX (linear) and (where `nrm`) a neutral normal, and
    whose window mean is closest to `target`. Windows step by 4 px (4x4
    blocks of 4 px); the chosen texel is the window's centre, so it and its
    bilinear neighbours all lie inside the flat window."""
    h, w, _ = lin.shape
    B = 4
    K = WINDOW // B
    hb, wb = h // B, w // B
    blk = lin[:hb * B, :wb * B].reshape(hb, B, wb, B, 3)
    lum = _lum(lin)[:hb * B, :wb * B].reshape(hb, B, wb, B)
    bmean = blk.mean(axis=(1, 3))
    bmin = lum.min(axis=(1, 3))
    bmax = lum.max(axis=(1, 3))
    bmask = mask[:hb * B, :wb * B].reshape(hb, B, wb, B).all(axis=(1, 3))
    if nrm is not None:
        dev = np.sqrt(((nrm[:hb * B, :wb * B] - np.array([0.5, 0.5, 1.0])) ** 2).sum(axis=-1))
        bdev = dev.reshape(hb, B, wb, B).max(axis=(1, 3))
    else:
        bdev = np.zeros((hb, wb))
    H2, W2 = hb - K + 1, wb - K + 1
    wsum = np.zeros((H2, W2, 3))
    wmin = np.full((H2, W2), np.inf)
    wmax = np.full((H2, W2), -np.inf)
    wmask = np.ones((H2, W2), dtype=bool)
    wdev = np.zeros((H2, W2))
    for dy in range(K):
        for dx in range(K):
            sl = (slice(dy, dy + H2), slice(dx, dx + W2))
            wsum += bmean[sl]
            wmin = np.minimum(wmin, bmin[sl])
            wmax = np.maximum(wmax, bmax[sl])
            wmask &= bmask[sl]
            wdev = np.maximum(wdev, bdev[sl])
    wmean = wsum / (K * K)
    ok = wmask & ((wmax - wmin) < SPREAD_MAX) & (wdev < NORMAL_TOL)
    if not ok.any():
        return None
    dist = np.sqrt(((wmean - np.array(target)) ** 2).sum(axis=-1))
    dist = np.where(ok, dist, np.inf)
    by, bx = np.unravel_index(int(np.argmin(dist)), dist.shape)
    px, py = bx * B + WINDOW // 2, by * B + WINDOW // 2      # the window's centre texel
    uv = ((px + 0.5) / w, (py + 0.5) / h)
    info = {
        "uv": uv, "texel": (px, py), "rgb": tuple(float(c) for c in lin[py, px]),
        "window_mean": tuple(float(c) for c in wmean[by, bx]),
        "spread": float(wmax[by, bx] - wmin[by, bx]), "target": tuple(float(c) for c in target),
        "normal_dev": float(wdev[by, bx]), "candidates": int(ok.sum()), "dist": float(dist[by, bx]),
    }
    if not quiet:
        log(f"TONE {name}: uv ({uv[0]:.6f}, {uv[1]:.6f}) texel {px},{py}  linear rgb "
            f"({info['rgb'][0]:.4f}, {info['rgb'][1]:.4f}, {info['rgb'][2]:.4f})  window mean "
            f"({info['window_mean'][0]:.4f}, {info['window_mean'][1]:.4f}, {info['window_mean'][2]:.4f})  "
            f"spread {info['spread']:.4f}  normal dev {info['normal_dev']:.3f}  target "
            f"({target[0]:.4f}, {target[1]:.4f}, {target[2]:.4f})  off target {info['dist']:.4f}  "
            f"from {info['candidates']} flat windows")
    return info


#: A texel farther than this (linear RGB) from its tone's target is not that
#: tone; the search then widens from the source's own islands to every island
#: of the shared bake (the colour is the rule, not where it sits).
MATCH_TOL = 0.01


def find_tone(name, lin, masks, target, nrm):
    """Search `masks` in order [(label, mask)], keep the first whose best
    flat window is within MATCH_TOL of `target`, else the closest overall."""
    best = None
    for label, mask in masks:
        info = find_texel(name, lin, mask, target, nrm, quiet=True)
        if info is None:
            log(f"TONE {name}: no flat window in {label}")
            continue
        info["where"] = label
        log(f"TONE {name}: best flat window in {label} is {info['dist']:.4f} off target")
        if best is None or info["dist"] < best["dist"]:
            best = info
        if info["dist"] <= MATCH_TOL:
            break
    if best is None:
        raise Refused(f"tone {name}: no flat {WINDOW}x{WINDOW} window in any island "
                      f"(spread < {SPREAD_MAX}, normal < {NORMAL_TOL})")
    if best["dist"] > MATCH_TOL:
        log(f"TONE {name}: WARNING closest flat texel is {best['dist']:.4f} off target (> {MATCH_TOL})")
    final = find_texel(name, lin, dict(masks)[best["where"]], target, nrm)
    final["where"] = best["where"]
    log(f"TONE {name}: chosen from {best['where']}")
    return final


def choose_tones(live):
    """{tone: uv} from the vehicle's own bake, or None for a vehicle with no
    bake on its hull (then no host is textured either)."""
    hull = next((o for o in live if o.name == "hull_hull"), None)
    mat = hull.data.materials[0] if hull and hull.data.materials else None
    img, _ = _linked_image(mat, "Base Color")
    if img is None:
        log("TONE: hull_hull carries no bake -- no texels pinned")
        return None
    px = _pixels(img)
    rgb = px[..., :3]
    lin = _srgb_to_linear(rgb) if img.colorspace_settings.name.lower().startswith("srgb") else rgb
    h, w, _ = lin.shape
    nimg, _ = _linked_image(mat, "Normal", through=("NORMAL_MAP",))
    nrm = _pixels(nimg)[..., :3] if nimg is not None else None
    log(f"TONE bake {img.name} {w}x{h} ({img.colorspace_settings.name}); normal map: "
        f"{nimg.name if nimg else 'none'}")
    textured = [o for o in live if o.data.materials and o.data.materials[0] is not None
                and _linked_image(o.data.materials[0], "Base Color")[0] is img]

    # paint: the hull's 25th-percentile luminance texel (kit_blockout's rule)
    paint_target = kb.percentile_colour(kb.bake_texels(hull), 0.25)
    tones = {"paint": find_tone("paint", lin, [("hull_hull's islands", coverage([hull], w, h))], paint_target, nrm)}
    every = coverage(textured, w, h)


    mimg, chan = _linked_image(mat, "Metallic", through=("SEPARATE_COLOR", "SEPRGB", "SEPARATE_RGB"))
    metallic = None
    if mimg is not None:
        mp = _pixels(mimg)
        mch = {"Red": 0, "R": 0, "Green": 1, "G": 1, "Blue": 2, "B": 2}.get(chan, 2)
        metallic = mp[..., mch]
        mcov = metallic[every]
        log(f"TONE metallic map {mimg.name} channel {chan}: {mcov.min():.3f}..{mcov.max():.3f} over the islands, "
            f"{int((mcov >= 0.5).sum())} texels >= 0.5")
        if not (mcov >= 0.5).any():
            metallic = None       # a uniform map marks no metal: fall through
    mnode = next((o for o in textured if o.name.endswith("_metal")), None)
    if metallic is not None:
        mmask = every & (metallic >= 0.5)
        cols = lin[mmask]
        order = np.argsort(_lum(cols), kind="stable")

        def pct(q):
            i = int(q * (len(order) - 1))
            k = max(1, len(order) // 200)
            return tuple(cols[order[max(0, i - k):i + k + 1]].mean(axis=0))
        metal_target, dark_target = pct(0.5), pct(0.05)
        src = "the metal texels' islands"
        log(f"TONE metal source: metallic >= 0.5 ({int(mmask.sum())} texels)")
    elif mnode is not None:
        mtex = kb.bake_texels(mnode)
        metal_target = kb.percentile_colour(mtex, 0.5)
        dark_target = kb.percentile_colour(mtex, 0.05)
        mmask = coverage([mnode], w, h)
        src = f"{mnode.name}'s islands"
        log(f"TONE metal source: {mnode.name}'s own face texels (no metal in a metallic map)")
    else:
        # No metallic texel and no textured metal node (the Namer, Eitan,
        # Kipod and Shachaf weapon stations are palette; the D9 has no metal
        # node), and these bakes are painted all over: metal parts take the
        # GREYEST PAINT of the hull -- the least-saturated tenth of hull_hull's
        # texels inside its 25-95th luminance band -- and lenses the darkest
        # twentieth of every textured island (the track rubber included).
        hmask = coverage([hull], w, h)
        cols = lin[hmask]
        lum = _lum(cols)
        mx, mn = cols.max(axis=1), cols.min(axis=1)
        sat = (mx - mn) / np.maximum(mx, 1e-6)
        band = (lum >= np.percentile(lum, 25)) & (lum <= np.percentile(lum, 95))
        cut = np.percentile(sat[band], 10)
        grey = cols[band][sat[band] <= cut]
        order = np.argsort(_lum(grey), kind="stable")
        k = max(1, len(order) // 200)
        mid = len(order) // 2
        metal_target = tuple(grey[order[max(0, mid - k):mid + k + 1]].mean(axis=0))
        allc = lin[every]
        aord = np.argsort(_lum(allc), kind="stable")
        i5 = int(0.05 * (len(aord) - 1))
        ka = max(1, len(aord) // 200)
        dark_target = tuple(allc[aord[max(0, i5 - ka):i5 + ka + 1]].mean(axis=0))
        mmask = hmask
        src = "hull_hull's islands"
        log("DEVIATION tone metal (a third rule beside the plan's two): this bake's metallic map is uniform "
            "and no textured *_metal node exists, so `metal` is the greyest paint and `dark` the 5th "
            "luminance percentile of every textured island")
        log(f"TONE metal source: no metallic texel and no textured *_metal node -- the greyest paint "
            f"(saturation <= {cut:.3f} in hull_hull's 25-95th luminance band, {len(grey)} texels); "
            f"dark: the 5th luminance percentile of every textured island")
    tones["metal"] = find_tone("metal", lin, [(src, mmask), ("every textured island", every)], metal_target, nrm)
    tones["dark"] = find_tone("dark", lin, [(src, mmask), ("every textured island", every)], dark_target, nrm)
    return tones


# ---------------------------------------------------------------------------
# nodes
# ---------------------------------------------------------------------------

def make_node(track, tier, host, pieces, tones, uv_name):
    name = f"kit_{track}_{tier}_{host.name}"
    verts, faces, ftone, fsmooth = [], [], [], []
    for p in pieces:
        off = len(verts)
        verts += [tuple(v) for v in p.verts]
        for f, t in zip(p.faces, p.tones):
            faces.append(tuple(i + off for i in f))
            ftone.append(t)
            fsmooth.append(p.smooth)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if len(me.polygons) != len(faces):
        raise Refused(f"{name}: from_pydata kept {len(me.polygons)} of {len(faces)} faces")
    me.polygons.foreach_set("use_smooth", fsmooth)
    me.set_sharp_from_angle(angle=math.radians(SMOOTH_SPLIT_DEG))
    if me.validate(verbose=False):
        raise Refused(f"{name}: mesh failed validation (degenerate geometry)")
    uvl = me.uv_layers.new(name=uv_name)
    if tones is not None:
        data = []
        for poly, t in zip(me.polygons, ftone):
            u, v = tones[t]["uv"]
            data += [(u, v)] * poly.loop_total
        uvl.data.foreach_set("uv", [c for uv in data for c in uv])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob["rl_kit"] = {"track": track, "tier": tier, "host": host.name}
    ob["rl_role"] = host["rl_role"]
    return ob


def export_glb(kit_objs, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in kit_objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_extras=True, export_yup=True, export_apply=False,
                              export_animations=False, export_materials="NONE",
                              export_texcoords=True, export_normals=True, export_cameras=False,
                              export_lights=False)
    bpy.ops.object.select_all(action="DESELECT")


def read_back(path):
    """The written GLB's own word: node names, extras, attributes, materials."""
    import json
    import struct
    with open(path, "rb") as fh:
        data = fh.read()
    n = struct.unpack_from("<I", data, 12)[0]
    gj = json.loads(data[20:20 + n])
    rows = []
    for node in gj.get("nodes", []):
        mesh = gj["meshes"][node["mesh"]] if "mesh" in node else None
        prims = mesh["primitives"] if mesh else []
        tri = sum(gj["accessors"][p["indices"]]["count"] // 3 for p in prims)
        attrs = sorted({a for p in prims for a in p["attributes"]})
        mats = [p.get("material") for p in prims]
        rows.append((node["name"], node.get("extras", {}), attrs, mats, tri,
                     node.get("translation"), node.get("rotation"), node.get("scale")))
    return gj, rows


# ---------------------------------------------------------------------------
# preview
# ---------------------------------------------------------------------------

def _crop_to_content(path, margin=24):
    """Crop a transparent still to its drawn pixels (scale unchanged)."""
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    ys, xs = np.nonzero(px[..., 3] > 0)
    if len(xs) == 0:
        return
    x0, x1 = max(0, xs.min() - margin), min(w, xs.max() + 1 + margin)
    y0, y1 = max(0, ys.min() - margin), min(h, ys.max() + 1 + margin)
    crop = px[y0:y1, x0:x1].copy()
    out = bpy.data.images.new("crop", x1 - x0, y1 - y0, alpha=True)
    out.pixels.foreach_set(crop.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    bpy.data.images.remove(img)


def preview(vid, live, kit, out_dir):
    scene = bpy.context.scene
    allobjs = [o for o in scene.objects if o.type == "MESH"]
    lo, hi = kb.world_bounds(allobjs)
    rad = max(Vector((x, y, 0)).length for x in (lo.x, hi.x) for y in (lo.y, hi.y))
    zc = (lo.z + hi.z) / 2
    center = Vector((0.0, 0.0, zc))
    frame_m = 2 * rad * 1.06 + (hi.z - lo.z) * math.cos(kb.ELEVATION) * 0.6
    pivot = bpy.data.objects.new("PIVOT", None)
    scene.collection.objects.link(pivot)
    kb.parent_all(pivot, [o for o in scene.objects if o is not pivot])
    cd = bpy.data.cameras.new("CAM")
    cd.type = "ORTHO"
    cam = bpy.data.objects.new("CAM", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    kb.game_sun(scene)
    kb.paint_palette_nodes(live)
    hosts = {o.name: o for o in live}
    for (track, tier, host), ob in kit.items():
        ob.data.materials.clear()
        ob.data.materials.append(hosts[host].data.materials[0])

    def show(level):
        for (track, tier, _host), ob in kit.items():
            on = tier <= level
            ob.hide_render = not on
            ob.hide_viewport = not on

    os.makedirs(out_dir, exist_ok=True)
    shots = []
    for zoom, ppm in kb.PX_PER_M.items():
        res = int(round(frame_m * ppm))
        scene.render.resolution_x = scene.render.resolution_y = res
        kb.place_camera(cam, center, frame_m)
        for L in (0, 1, 2, 3):
            show(L)
            for hd in kb.HEADINGS_MOCK:
                pivot.rotation_euler = (0, 0, math.radians(hd))
                bpy.context.view_layer.update()
                scene.render.filepath = os.path.join(out_dir, f"z{zoom}_L{L}_h{hd:03d}.png")
                bpy.ops.render.render(write_still=True)
                shots.append(scene.render.filepath)
    show(3)
    res = int(round(frame_m * kb.PX_PER_M[2.5] * 4.0))
    scene.render.resolution_x = scene.render.resolution_y = res
    kb.place_camera(cam, center, frame_m)
    for hd in kb.HEADINGS_MOCK:
        pivot.rotation_euler = (0, 0, math.radians(hd))
        bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(out_dir, f"closeup_L3_h{hd:03d}.png")
        bpy.ops.render.render(write_still=True)
        _crop_to_content(scene.render.filepath)
        shots.append(scene.render.filepath)
    pivot.rotation_euler = (0, 0, 0)
    log(f"PREVIEW {vid}: {len(shots)} stills in {out_dir} (frame {frame_m:.3f} m)")


# ---------------------------------------------------------------------------

USAGE = ("usage: blender -b --factory-startup --python tools/vehicles/export_vehicle_kit.py -- "
         "[--only id,id] [--preview <dir>] [--out <dir>]")


def parse(argv):
    args = {"only": None, "preview": None, "out": None}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--only", "--preview", "--out") and i + 1 < len(argv):
            args[a[2:]] = argv[i + 1]
            i += 2
        else:
            print(f"unknown argument: {a}\n{USAGE}", file=sys.stderr)
            raise SystemExit(2)
    return args


def run(vid, preview_dir, out_dir=OUT_DIR):
    live = load_vehicle(vid)
    H = kb.Hull(live)
    hosts = {o.name: o for o in live}
    blockout = blockout_objects(vid, H)

    built = {}
    for track, tier, host, label, fn in kv.PARTS_DETAILED[vid](H):
        if host not in hosts:
            raise Refused(f"{track} {tier} ({label}): host {host!r} is not a live node of {vid}")
        key = (track, tier, host)
        if key in built:
            raise Refused(f"duplicate node {key}")
        built[key] = fn()
        log(f"  built {track} {tier} {host}: {len(built[key])} pieces, {kp.tris(built[key])} tris -- {label}")

    for (track, tier, host), pieces in built.items():
        moved = apply_track_tone(track, pieces)
        log(f"  tone {track} {tier} {host}: {TRACK_TONE[track]} (+ dark lenses/windows)"
            + (f"; {moved} face(s) re-toned from the builders' own choice" if moved else ""))

    refusals, total = check_part(vid, built, blockout)
    clash, _summary = kc.check(vid, live, built, kv.CLASH_EXEMPTIONS.get(vid, {}))
    refusals += clash
    if refusals:
        raise Refused("; ".join(refusals))

    tones = choose_tones(live)
    kit = {}
    for (track, tier, host), pieces in built.items():
        h = hosts[host]
        uv_name = h.data.uv_layers.active.name if h.data.uv_layers.active else "UVMap"
        kit[(track, tier, host)] = make_node(track, tier, h, pieces, tones, uv_name)

    path = os.path.join(out_dir, f"{vid}.glb")
    export_glb(list(kit.values()), path)
    _gj, rows = read_back(path)
    log(f"EXPORT {vid}: {path} ({os.path.getsize(path)} bytes, {len(rows)} nodes)")
    for name, extras, attrs, mats, tri, t, r, s in rows:
        log(f"   {name}: {tri} tris, attrs {attrs}, materials {mats}, extras {extras}, trs {t} {r} {s}")
        if any(m is not None for m in mats):
            raise Refused(f"{name}: exported with a material")
        if t or r or s:
            raise Refused(f"{name}: exported with a transform (kit nodes are world-space at identity)")
    if sum(r[4] for r in rows) != total:
        raise Refused(f"exported triangles {sum(r[4] for r in rows)} != built {total}")

    if preview_dir:
        # Draw the FILE, not the scene that wrote it: re-import the GLB, so the
        # stills show its own positions, normals and pinned UVs.
        for ob in kit.values():
            me = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.meshes.remove(me)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path, import_scene_extras=True)
        kit = {}
        for ob in set(bpy.data.objects) - before:
            rk = ob.get("rl_kit")
            if ob.type == "MESH" and rk is not None:
                kit[(rk["track"], int(rk["tier"]), rk["host"])] = ob
        if len(kit) != len(rows):
            raise Refused(f"re-import found {len(kit)} kit nodes, the file has {len(rows)}")
        preview(vid, live, kit, os.path.join(os.path.abspath(preview_dir), vid))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parse(argv)
    ids = args["only"].split(",") if args["only"] else sorted(kv.PARTS_DETAILED)
    for vid in ids:
        if vid not in kv.PARTS_DETAILED:
            print(f"no detailed kit table for {vid!r} (have: {sorted(kv.PARTS_DETAILED)})", file=sys.stderr)
            raise SystemExit(2)
    try:
        for vid in ids:
            log(f"== {vid}")
            run(vid, args["preview"], os.path.abspath(args["out"]) if args["out"] else OUT_DIR)
    except Refused as e:
        print(f"[kit] REFUSED: {e}", file=sys.stderr, flush=True)
        sys.stdout.flush()
        os._exit(1)
    except BaseException:
        # Blender swallows an uncaught exception in --python and exits 0;
        # a crash must fail the command, never look like success.
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)


if __name__ == "__main__":
    main()
