"""Generate the campaign world as ONE continuous terrain mesh, true top-down.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_campaign_world.py

This is the v2 map candidate, replacing the per-region layered approach:

  * One high-density grid mesh covering the whole 1140x790 board. No gaps, no voids --
    countries are zones of the same surface, separated by raised ridges or sunken river
    valleys where the terrain itself changes, never by empty space.
  * Nine countries on a jittered 3x3 lattice, then the whole border field is bent
    by two octaves of noise: every border wiggles at two scales like a real one --
    no straight lines, no symmetric shapes -- while the lattice still guarantees
    the board tiles completely and Kedem (home) stays dead centre. The real-space
    country outlines are printed as JSON at build time so the shell can position
    its own per-country overlays.
  * Every enemy country is DESIGNED, one terrain identity per compass position:
    steppe NW, rocky highlands N, forested hills NE, coastal desert W (hamlets),
    river lowlands E (farm mottle, hamlets), stepped badlands SW, dune erg S,
    salt flats SE. Each also carries interior mountains and a valley or wadi
    (PEAKS/VALLEYS), a few settlements, and a watchtower on its Kedem-facing
    approach; boulders and tors gather at range feet and summits, riparian trees
    line every watercourse, the farmland grows orchard rows, and the erg keeps
    an oasis. Every enemy country flies a fictional flag at its capital (banner
    laid FLAT -- a vertical flag from straight above is a line) and keeps one
    unique monument: stone circle, ziggurat, forest shrine, caravanserai,
    step-well, twin obelisks, great pyramid, salt-labyrinth geoglyph. Organic
    scatter runs through `patchiness`, so cover clumps and voids asymmetrically
    instead of sitting at one synthetic density. Locked/complete state is NOT
    baked here -- the shell overlays grey for locked countries and the brigade
    lion flag for completed ones.
  * Campaign progress is NOT baked into the render: the shell overlays the brigade
    lion flag on completed countries. (The bezier-road bevel_factor_end dial from
    the first cut is gone with it.)
  * Kedem carries three terrain bands -- desert at the bottom, urban middle, woodland
    top -- blended over ~32-unit transitions: heights are weight-mixed and the band
    materials dither into each other, so the seams read as ecotones, not stripes.
  * Beit Sahwan, the campaign's start point, sits at the bottom of Kedem: a tight
    settlement cluster inside a terracotta ring marker, so the origin carries its
    own visual weight.
  * Colour is a node material per band: world-Z through a CONSTANT ColorRamp whose
    stops are palette keys. Deep water sits at the lowest heights, plains above,
    rock at ridge height. CONSTANT stops keep the output close to the locked
    32-colour palette so the post-render quantise barely has to move anything.

Self-contained except for `data/palette.json`: repo palette discipline outranks
asset purity, every colour in the render must trace to a ramp key.

Everything random is drawn from `rng_from` (same LCG as the layered script) or from
the hash-based value noise below, so a re-render is byte-identical.

Coordinates: SVG units, 1 unit = 1 layout px, X east; SVG y grows downward and is
flipped into Blender Y by `to_world`. "Bottom of Kedem" = large SVG y = screen south.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dimetric import palette_linear  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PNG = os.path.join(ROOT, "assets", "campaign", "world_map.png")
OUT_BLEND = os.path.join(ROOT, "art", "src", "campaign", "kedem_world.blend")

#: The layout box worldmap.ts positions everything against, and 2x for retina.
VIEW_W, VIEW_H = 1140.0, 790.0
RES_X, RES_Y = 2280, 1580

#: True top-down this time -- the brief asks for a vertical satellite view, so relief
#: must read from sun shading alone, not parallax. Between the layered map's 38 (valleys
#: drowned black) and the first world render's 52 (ranges shaded flat).
SUN_ELEV_DEG = 46.0
SUN_AZIMUTH_DEG = 145.0
SAMPLES = 96

#: Grid density: 2 units per cell = 4 rendered px per cell at 2x. Fine enough for the
#: ridges and dune ripple to displace smoothly, coarse enough to build in seconds.
STEP = 2.0
NX, NY = int(VIEW_W / STEP), int(VIEW_H / STEP)

SEA_Z = 0.0
#: Height range the colour ramps map over. Valley floors bottom out near -16,
#: ridge crests top out near +42.
Z_MIN, Z_MAX = -16.0, 44.0

KEDEM = 4  # centre cell of the 3x3


def rng_from(seed):
    """Deterministic LCG stream -- art that shuffles between renders is unreviewable."""
    state = seed & 0xFFFFFFFF

    def rnd():
        nonlocal state
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        return state / float(0x7FFFFFFF)

    return rnd


def to_world(x, y):
    """SVG (x, y) -> Blender (X, Y). Y flips because SVG grows downward."""
    return (x - VIEW_W / 2.0, (VIEW_H / 2.0) - y)


# ------------------------------------------------------------------------ noise
# Hand-rolled, NOT mathutils.noise: Blender 5.2 randomises that module's tables per
# process, so two runs of this script disagreed about where the countries' borders
# fall (Beit Sahwan landed at y=512, 484, 472, 448 across identical launches, and
# once found no ground at all). Same reasoning as the sim's own PRNG -- determinism
# is only a guarantee when it is a property of our code.

def _hash01(ix, iy, salt):
    """One lattice corner -> 0..1, from an integer avalanche hash."""
    h = (ix * 374761393 + iy * 668265263 + salt * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) / float(0xFFFFFFFF)


def vnoise(x, y, salt=0):
    """Signed 2D value noise, -1..1, smoothstep-interpolated between lattice corners."""
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    ux = fx * fx * (3.0 - 2.0 * fx)
    uy = fy * fy * (3.0 - 2.0 * fy)
    a = _hash01(ix, iy, salt)
    b = _hash01(ix + 1, iy, salt)
    c = _hash01(ix, iy + 1, salt)
    d = _hash01(ix + 1, iy + 1, salt)
    v = a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
    return 2.0 * v - 1.0


def fbm(x, y, salt=0, octaves=4):
    """Fractal sum of vnoise, normalised to -1..1."""
    amp, freq, total, norm = 1.0, 1.0, 0.0, 0.0
    for o in range(octaves):
        total += amp * vnoise(x * freq, y * freq, salt + 101 * o)
        norm += amp
        amp *= 0.5
        freq *= 2.0
    return total / norm


def smoothstep(x, e0, e1):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


# ----------------------------------------------------------------------- zones

def _lattice():
    """A 4x4 grid of border corners, jittered so no two countries are congruent.

    Interior nodes wander in both axes; rim nodes only slide along their board edge
    and the four corners stay pinned, so the nine quads tile the whole board with
    no slivers by construction. Jitter is under half a cell in each axis, which
    keeps every quad convex.
    """
    rnd = rng_from(0x1A77)
    xs = (0.0, VIEW_W / 3.0, 2.0 * VIEW_W / 3.0, VIEW_W)
    ys = (0.0, VIEW_H / 3.0, 2.0 * VIEW_H / 3.0, VIEW_H)
    nodes = {}
    for j in range(4):
        for i in range(4):
            jx = (rnd() - 0.5) * 110.0
            jy = (rnd() - 0.5) * 110.0
            if i in (0, 3):
                jx = 0.0
            if j in (0, 3):
                jy = 0.0
            nodes[(i, j)] = (xs[i] + jx, ys[j] + jy)
    return nodes


_NODES = _lattice()
#: Country polygons, id = row*3 + col, corners clockwise from the top-left.
CELLS = [
    [_NODES[(cx, cy)], _NODES[(cx + 1, cy)], _NODES[(cx + 1, cy + 1)], _NODES[(cx, cy + 1)]]
    for cy in range(3) for cx in range(3)
]
_CENTROIDS = [(sum(x for x, _ in c) / 4.0, sum(y for _, y in c) / 4.0) for c in CELLS]

#: Interior mountains per enemy country: (dx, dy from the cell centroid, radius,
#: height). Offsets are centroid-relative so the lattice jitter can never strand
#: a peak on a border; radii stay under half the distance to the nearest edge.
PEAKS = {
    0: [(-50.0, -35.0, 46.0, 13.0)],
    1: [(-30.0, -20.0, 62.0, 22.0), (55.0, 30.0, 48.0, 16.0)],
    2: [(35.0, -25.0, 52.0, 15.0)],
    3: [(-40.0, 30.0, 42.0, 12.0)],
    6: [(30.0, 40.0, 42.0, 15.0)],
    7: [(-45.0, -20.0, 44.0, 14.0)],
    8: [(40.0, -30.0, 40.0, 12.0)],
}

#: Interior valleys per enemy country: (centroid-relative polyline, half-width,
#: depth). Deep cuts drop below the water plane and read as rivers; shallow ones
#: stay dry and read as wadis.
VALLEYS = {
    2: ([(-130.0, 90.0), (0.0, 20.0), (120.0, -60.0)], 16.0, 24.0),   # forest stream
    3: ([(-120.0, -80.0), (-10.0, -10.0), (110.0, 60.0)], 18.0, 8.0),  # dry wadi
    5: ([(-150.0, -120.0), (-40.0, -30.0), (60.0, 40.0), (160.0, 130.0)], 26.0, 30.0),  # river
    7: ([(-140.0, 60.0), (-30.0, 10.0), (90.0, -40.0)], 20.0, 9.0),    # dry wadi
}

#: Kedem's three bands, in SVG y: thirds of the ACTUAL centre cell, not of nominal
#: constants -- the lattice jitter moves the cell, and the bands must move with it.
_K_TOP = (CELLS[KEDEM][0][1] + CELLS[KEDEM][1][1]) / 2.0
_K_BOT = (CELLS[KEDEM][2][1] + CELLS[KEDEM][3][1]) / 2.0
FOREST_MAX_Y = _K_TOP + (_K_BOT - _K_TOP) / 3.0
URBAN_MAX_Y = _K_TOP + 2.0 * (_K_BOT - _K_TOP) / 3.0
#: Half-width of the ecotone where two bands weight-mix and dither together.
BAND_BLEND = 16.0


def point_in_poly(px, py, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > py) != (y2 > py):
            xint = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if px < xint:
                inside = not inside
    return inside


def _seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
    return math.hypot(px - (ax + vx * t), py - (ay + vy * t))


#: Border style per country pair. A hash, not a hand list: any pair not named here
#: gets a deterministic mix of mountain ridges and river valleys.
def _border_style(a, b):
    lo, hi = (a, b) if a < b else (b, a)
    return "valley" if (lo * 31 + hi * 17) % 3 == 2 else "ridge"


def _warp(sx, sy):
    """The border warp: the lattice is queried through this displacement, so its
    straight edges land in real space as irregular curves. Two octaves = wiggle at
    two scales, the fractal look real borders have; straight survey lines read as
    CAD. One shared field for everything means both sides of a border agree on it.
    """
    wx = (34.0 * vnoise(sx * 0.0045 + 3.1, sy * 0.0045 + 8.2, salt=11)
          + 11.0 * vnoise(sx * 0.02 + 1.7, sy * 0.02 + 6.4, salt=12))
    wy = (34.0 * vnoise(sx * 0.0045 + 9.6, sy * 0.0045 + 2.8, salt=13)
          + 11.0 * vnoise(sx * 0.02 + 5.2, sy * 0.02 + 0.9, salt=14))
    return wx, wy


def country_outline(zid, samples_per_edge=24):
    """The country's REAL-space outline, for the shell's overlays: the quad's
    border, sampled and pulled back through the warp (first-order inverse -- the
    warp varies slowly, so q - w(q) lands within a pixel or two). Rim edges stay
    on the board frame."""
    poly = CELLS[zid]
    out = []
    for k in range(4):
        a, b = poly[k], poly[(k + 1) % 4]
        rim = (a[0] == b[0] == 0.0 or a[0] == b[0] == VIEW_W
               or a[1] == b[1] == 0.0 or a[1] == b[1] == VIEW_H)
        for i in range(samples_per_edge):
            f = i / samples_per_edge
            qx, qy = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
            if not rim:
                wx, wy = _warp(qx, qy)
                qx, qy = qx - wx, qy - wy
            out.append((min(VIEW_W, max(0.0, qx)), min(VIEW_H, max(0.0, qy))))
    return out


def zone_at(sx, sy):
    """(zone id, ridge factor 0..1, valley factor 0..1) at an SVG point.

    The point is pushed through the warp and located in the quad lattice, so the
    countries' real borders are the warped images of the lattice edges. Border
    influence is the warped point's distance to the quad's edges; edges on the
    board rim get no feature.
    """
    wx, wy = _warp(sx, sy)
    px, py = sx + wx, sy + wy
    zid = -1
    for i, poly in enumerate(CELLS):
        if point_in_poly(px, py, poly):
            zid = i
            break
    if zid < 0:  # warped outside the frame (near the rim): nearest centroid owns it
        zid = min(range(9), key=lambda i: (px - _CENTROIDS[i][0]) ** 2 + (py - _CENTROIDS[i][1]) ** 2)
    poly = CELLS[zid]
    cx, cy = zid % 3, zid // 3
    neighbours = ((cx, cy - 1), (cx + 1, cy), (cx, cy + 1), (cx - 1, cy))
    ridge_t = valley_t = 0.0
    for k, (nx, ny) in enumerate(neighbours):
        if not (0 <= nx < 3 and 0 <= ny < 3):
            continue
        d = _seg_dist(px, py, poly[k], poly[(k + 1) % 4])
        # 70 wide: at 95 the rock ramp splattered across the gentle flanks and the
        # ranges read as stains; narrower + taller = steeper = real shading.
        if _border_style(zid, ny * 3 + nx) == "ridge":
            ridge_t = max(ridge_t, 1.0 - d / 70.0)
        else:
            valley_t = max(valley_t, 1.0 - d / 65.0)
    return zid, max(0.0, ridge_t), max(0.0, valley_t)


def terrain(sx, sy):
    """(height, material band) at an SVG point. The single source of truth for the
    surface -- the mesh displaces with it AND every set piece samples it, which is
    how towns and trees sit on the ground without any raycasting."""
    zid, ridge_t, valley_t = zone_at(sx, sy)

    # Base relief, per terrain character; relief 0..1.
    relief = 0.5 * (fbm(sx * 0.006 + 7.3, sy * 0.006 + 2.1, salt=3) + 1.0)
    if zid != KEDEM:
        # Eight countries, eight terrain identities -- the height profile does the
        # character work and the band ramp colours it. Locked/complete states are
        # the shell's overlays, so nothing here is a placeholder any more.
        band = ZONE_BAND[zid]
        if zid == 0:      # NW steppe: low rolls, dust ground breaking into scrub
            z = 7.5 + 4.0 * relief
        elif zid == 1:    # N highlands: the tallest interior relief on the board,
            # with a fine roughness so the slopes shade as rock, not as a slab
            z = 9.0 + 15.0 * relief + 1.2 * vnoise(sx * 0.06, sy * 0.06, salt=18)
        elif zid == 2:    # NE forested hills: rolling, canopied by scatter
            z = 8.0 + 8.0 * relief
        elif zid == 3:    # W coastal desert: flat with wind-row ripple
            ripple = vnoise(sx * 0.045, sy * 0.011, salt=4)
            z = 7.5 + 3.0 * relief + 1.8 * ripple
        elif zid == 5:    # E river lowlands: field mottle crossing the ramp stops
            # (base sits mid-ramp: at 6.5 most of the zone fell into the dark
            # scrub stop and the whole country read as night marsh)
            z = 8.2 + 2.5 * relief + 2.2 * vnoise(sx * 0.03, sy * 0.03, salt=15)
        elif zid == 6:    # SW badlands: relief quantised into mesa tiers
            raw = 8.0 + 12.0 * relief
            z = round(raw / 6.0) * 6.0 + 0.8 * vnoise(sx * 0.08, sy * 0.08, salt=16)
        elif zid == 7:    # S erg: long dune bands, ripple deep enough to cross stops
            ripple = vnoise(sx * 0.028, sy * 0.008, salt=17)
            z = 8.0 + 2.0 * relief + 3.2 * ripple
        else:             # SE salt flats: near-dead-flat playa
            z = 6.0 + 2.2 * relief
    else:
        # Kedem's bands meet on noise-wavy lines, and BLEND across them: the three
        # height profiles are weight-mixed through the ecotone, and the material
        # pick dithers in proportion to the same weights -- a hard threshold drew
        # ruler stripes across the country.
        band_y = sy + 18.0 * vnoise(sx * 0.012, 4.4, salt=5)
        w_forest = 1.0 - smoothstep(band_y, FOREST_MAX_Y - BAND_BLEND, FOREST_MAX_Y + BAND_BLEND)
        w_desert = smoothstep(band_y, URBAN_MAX_Y - BAND_BLEND, URBAN_MAX_Y + BAND_BLEND)
        w_urban = max(0.0, 1.0 - w_forest - w_desert)
        # Desert: shallow anisotropic ripple reads as wind rows, not fish scales.
        ripple = vnoise(sx * 0.05, sy * 0.012, salt=4)
        z = (w_desert * (8.0 + 3.0 * relief + 1.6 * ripple)
             + w_urban * (9.0 + 1.2 * relief)
             + w_forest * (8.0 + 6.0 * relief))
        pick = 0.5 * (vnoise(sx * 0.31, sy * 0.31, salt=9) + 1.0)
        band = 1 if pick < w_desert else (3 if pick > 1.0 - w_forest else 2)

    # Interior features first: each enemy country's own mountains and valleys.
    if zid in PEAKS:
        ccx, ccy = _CENTROIDS[zid]
        for dx, dy, pr, ph in PEAKS[zid]:
            d = math.hypot(sx - (ccx + dx), sy - (ccy + dy))
            if d < pr:
                z += ph * (1.0 - smoothstep(d, pr * 0.25, pr))
    if zid in VALLEYS:
        ccx, ccy = _CENTROIDS[zid]
        pts, half_w, depth = VALLEYS[zid]
        dmin = 1e18
        for a, b in zip(pts, pts[1:]):
            dmin = min(dmin, _seg_dist(sx, sy, (ccx + a[0], ccy + a[1]),
                                       (ccx + b[0], ccy + b[1])))
        # The same rule as the country borders: a river drawn on a ruler reads as
        # a canal. Wobbling the distance field bends the banks, not the endpoints.
        dmin += 7.0 * vnoise(sx * 0.03, sy * 0.03, salt=19)
        if dmin < half_w:
            t = 1.0 - dmin / half_w
            blend = min(1.0, t * 2.5)
            z = z * (1.0 - blend) + min(z, 8.0) * blend
            z -= depth * t * t

    # Border features: what actually separates the countries. The crest multiplier
    # varies along the range so peaks alternate with saddles, and a finer corrugation
    # rides on top -- spur-and-gully striping is what makes a range read as mountains
    # from straight above; a smooth swell shades as a smear.
    # Ranges also sink to nothing within 50 units of the board edge: a ridge sliced
    # by the image boundary leaves a cliff face and a black shadow triangle.
    if ridge_t > 0.0:
        edge = min(sx, VIEW_W - sx, sy, VIEW_H - sy)
        fade = max(0.0, min(1.0, edge / 50.0))
        rocky = 0.75 + 0.55 * vnoise(sx * 0.03, sy * 0.03, salt=6)
        spurs = 8.0 * ridge_t * vnoise(sx * 0.055, sy * 0.055, salt=7)
        z += (48.0 * (ridge_t ** 3) * rocky + spurs) * fade
    if valley_t > 0.0:
        # Blend toward the truncation instead of min()-capping outright: the hard cap
        # guillotined any ridge entering a valley's influence and left cliff walls.
        blend = min(1.0, valley_t * 2.5)
        z = z * (1.0 - blend) + min(z, 10.0) * blend
        z -= 26.0 * (valley_t * valley_t)  # floor below sea level
    return z, band


# ------------------------------------------------------------------- materials

def _pal(colour_key):
    """palette_linear with the out-of-range guard from the layered script -- an
    IndexError from inside Blender names neither the key nor the ramp length."""
    import json
    band, _, idx = colour_key.partition(".")
    with open(os.path.join(ROOT, "data", "palette.json")) as fh:
        ramps = json.load(fh)["ramps"]
    if band in ramps and idx.isdigit() and int(idx) >= len(ramps[band]["colors"]):
        raise SystemExit(
            f"{colour_key!r}: ramp {band!r} has {len(ramps[band]['colors'])} entries "
            f"(0..{len(ramps[band]['colors']) - 1})"
        )
    return palette_linear(colour_key)


def terrain_material(name, stops, roughness=0.92):
    """Height-mapped zone material: world Z -> Map Range -> CONSTANT ColorRamp.

    `stops` is [(z_from, palette_key), ...] ascending; each colour holds from its
    height upward. CONSTANT interpolation means the render emits palette colours
    plus shading, not gradient in-betweens -- quantise stays a touch-up, not a repaint.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.2

    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mapr = nt.nodes.new("ShaderNodeMapRange")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mapr.inputs["Value"])
    mapr.inputs["From Min"].default_value = Z_MIN
    mapr.inputs["From Max"].default_value = Z_MAX

    ramp.color_ramp.interpolation = "CONSTANT"
    elems = ramp.color_ramp.elements
    # A ColorRamp is born with TWO stops; the factory white one at pos 1.0 was never
    # removed and contaminated the highest terrain. Strip down to one before building.
    while len(elems) > 1:
        elems.remove(elems[-1])
    for i, (z_from, key) in enumerate(stops):
        pos = (z_from - Z_MIN) / (Z_MAX - Z_MIN)
        el = elems[0] if i == 0 else elems.new(pos)
        el.position = pos if i else 0.0
        el.color = _pal(key)
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def flat(name, colour_key, roughness=0.85):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = _pal(colour_key)
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.2
    return mat


#: Every ramp bottoms out in water -- "deep water for the lowest points" -- and tops
#: out in the same rock, so ridge crests read as one mountain range no matter whose
#: border they are. Warm limestone rock, not gunmetal: sunlit gunmetal under the warm
#: sun quantises into the olive ramp, which smeared the first render's ridges green.
# Ramp indices DESCEND in brightness (measured, not assumed: limestone.0 L233 ..
# limestone.8 L80, olive.0 L143 .. olive.3 L53). Deep water is the dark water.1
# with a pale shallow fringe; rock gets PALER with altitude, like bare limestone.
WATER = [(Z_MIN, "water.1"), (-5.0, "water.0")]
ROCK = [(20.0, "dust.4"), (30.0, "limestone.5"), (40.0, "limestone.3")]

BAND_STOPS = [
    WATER + [(1.2, "dust.2"), (8.5, "olive.0"), (11.0, "olive.1")] + ROCK,         # 0 steppe NW
    WATER + [(1.2, "dust.3"), (8.0, "dust.4"), (13.0, "dust.5")] + ROCK,           # 1 kedem desert
    WATER + [(1.2, "limestone.3"), (10.0, "limestone.4")] + ROCK,                  # 2 kedem urban
    WATER + [(1.2, "olive.0"), (8.0, "olive.1"), (14.0, "olive.2")] + ROCK,        # 3 forest (Kedem + NE)
    WATER + [(1.2, "limestone.3"), (11.0, "limestone.4"), (16.0, "limestone.5")] + ROCK,  # 4 highlands N
    WATER + [(1.2, "dust.2"), (8.0, "dust.3"), (11.5, "dust.4")] + ROCK,           # 5 coastal desert W
    # Farmland is a LIGHT mosaic from above: pale fallow fields between green ones.
    # (First cut used high olive indices believing they were lighter -- they are the
    # DARKEST, and the whole country rendered as night marsh, twice.)
    WATER + [(1.2, "olive.1"), (7.4, "scrub.0"), (9.2, "dust.2"), (11.0, "olive.0")] + ROCK,  # 6 lowlands E
    WATER + [(1.2, "terracotta.0"), (8.0, "terracotta.1"), (13.0, "dust.5")] + ROCK,  # 7 badlands SW
    WATER + [(1.2, "dust.3"), (9.0, "dust.4"), (12.0, "dust.5")] + ROCK,           # 8 erg S
    WATER + [(1.2, "limestone.5"), (7.5, "dust.3"), (10.0, "dust.4")] + ROCK,      # 9 salt flats SE
]

#: zone id (lattice cell) -> material band, for the eight enemy countries.
ZONE_BAND = {0: 0, 1: 4, 2: 3, 3: 5, 5: 6, 6: 7, 7: 8, 8: 9}


# -------------------------------------------------------------------- the mesh

def build_terrain():
    """The one continuous grid. Vertices displace by `terrain`; each face takes the
    material band of its corner vertex -- a face is 2 units, the bands are 88, so the
    corner is as good as the centre and halves the noise evaluations."""
    verts = []
    vband = []
    for iy in range(NY + 1):
        sy = iy * STEP
        for ix in range(NX + 1):
            sx = ix * STEP
            z, band = terrain(sx, sy)
            wx, wy = to_world(sx, sy)
            verts.append((wx, wy, z))
            vband.append(band)

    faces = []
    fband = []
    row = NX + 1
    for iy in range(NY):
        for ix in range(NX):
            a = iy * row + ix
            faces.append((a, a + 1, a + 1 + row, a + row))
            fband.append(vband[a])

    mesh = bpy.data.meshes.new("world_terrain")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new("world_terrain", mesh)
    bpy.context.collection.objects.link(ob)

    mats = [terrain_material(f"terra_{i}", stops) for i, stops in enumerate(BAND_STOPS)]
    for m in mats:
        mesh.materials.append(m)
    mesh.polygons.foreach_set("material_index", fband)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return ob


def build_water():
    """One flat quad just below sea level, spanning the whole board. Valley floors
    dip to -16, so wherever a border digs below this plane the river surfaces as
    flat, evenly-lit water -- terrain shading alone left the first render's valleys
    reading as shadow cracks."""
    z = -2.0
    corners = [(0.0, 0.0), (VIEW_W, 0.0), (VIEW_W, VIEW_H), (0.0, VIEW_H)]
    verts = [(*to_world(x, y), z) for x, y in corners]
    mesh = bpy.data.meshes.new("water")
    mesh.from_pydata(verts, [], [(3, 2, 1, 0)])
    mesh.update()
    mesh.materials.append(flat("water", "water.1", roughness=0.35))
    ob = bpy.data.objects.new("water", mesh)
    bpy.context.collection.objects.link(ob)


# ------------------------------------------------------------------ set pieces

def _batched_mesh(name, material):
    """Accumulator for hundreds of blocks/canopies as ONE mesh per material --
    one object each keeps the depsgraph small."""
    state = {"verts": [], "faces": []}

    def add(verts, faces):
        base = len(state["verts"])
        state["verts"] += verts
        state["faces"] += [tuple(base + i for i in f) for f in faces]

    def commit():
        if not state["verts"]:
            return None
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(state["verts"], [], state["faces"])
        mesh.update()
        mesh.materials.append(material)
        ob = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(ob)
        return ob

    return add, commit


def _block(add, sx, sy, w, d, h, lift=0.0):
    z0, _ = terrain(sx, sy)
    z0 += lift - 1.0
    wx, wy = to_world(sx, sy)
    x0, x1, y0, y1 = wx - w / 2, wx + w / 2, wy - d / 2, wy + d / 2
    z1 = z0 + h
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2),
             (2, 6, 7, 3), (3, 7, 4, 0)]
    add(verts, faces)


def _canopy(add, sx, sy, r, h, sides=12):
    z0, _ = terrain(sx, sy)
    wx, wy = to_world(sx, sy)
    ring0, ring1 = [], []
    for i in range(sides):
        a = 2.0 * math.pi * i / sides
        ring0.append((wx + r * math.cos(a), wy + r * math.sin(a), z0 - 0.5))
        ring1.append((wx + 0.72 * r * math.cos(a), wy + 0.72 * r * math.sin(a), z0 + h))
    verts = ring0 + ring1
    faces = [tuple(range(sides, 2 * sides))]  # flat top
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    add(verts, faces)


def _kedem_x_span():
    # Overshoot the unwarped quad by the warp's reach; the zone gate on each
    # candidate is what actually clips to the real border.
    xs = [x for x, _ in CELLS[KEDEM]]
    return min(xs) - 46.0, max(xs) + 46.0


def scatter_city(clear_at=None, clear_r=44.0):
    """Kedem's urban band: a jittered grid of low blocks. The band gate is the
    dithered pick from `terrain`, so the city thins out THROUGH the ecotones --
    stray blocks reach into the desert and under the treeline instead of stopping
    on a line. `clear_at` keeps open ground around the start-point marker."""
    walls = [flat("wall_a", "limestone.2"), flat("wall_b", "limestone.3"),
             flat("wall_c", "limestone.4")]
    batches = [_batched_mesh(f"city_{i}", m) for i, m in enumerate(walls)]
    rnd = rng_from(0x0B71)
    placed = 0
    kx0, kx1 = _kedem_x_span()
    # The loop overshoots both band edges by the blend width; the band check on
    # each candidate is what actually gates placement.
    sy = FOREST_MAX_Y - BAND_BLEND - 6.0
    while sy < URBAN_MAX_Y + BAND_BLEND + 6.0:
        sx = kx0
        while sx < kx1:
            jx, jy = sx + (rnd() - 0.5) * 8.0, sy + (rnd() - 0.5) * 8.0
            # District mask: low-frequency noise clumps the blocks into quarters
            # with open ground between. A uniform scatter reads as confetti; the
            # first threshold (0.02) kept only noise peaks and halved the city.
            district = vnoise(jx * 0.022, jy * 0.022, salt=8) > -0.08
            keep = district and rnd() < 0.88
            zid, ridge_t, valley_t = zone_at(jx, jy)
            z, band = terrain(jx, jy)
            near_start = clear_at and (jx - clear_at[0]) ** 2 + (jy - clear_at[1]) ** 2 < clear_r ** 2
            if keep and zid == KEDEM and band == 2 and z < 16.0 and not near_start:
                add, _ = batches[int(rnd() * 3) % 3]
                _block(add, jx, jy, 5.0 + rnd() * 4.0, 5.0 + rnd() * 4.0, 3.0 + rnd() * 4.0)
                placed += 1
            sx += 13.0
        sy += 13.0
    for _, commit in batches:
        commit()
    print(f"city: {placed} blocks")


def scatter_forest():
    """Kedem's northern band: 12-sided canopies (hexagons read as hexagons; twelve
    sides read as trees), three greens, rolling ground showing through."""
    greens = [flat("can_a", "olive.1"), flat("can_b", "olive.2"), flat("can_c", "scrub.1")]
    batches = [_batched_mesh(f"forest_{i}", m) for i, m in enumerate(greens)]
    rnd = rng_from(0xF03E)
    placed = 0
    kx0, kx1 = _kedem_x_span()
    sy = _K_TOP - 46.0
    while sy < FOREST_MAX_Y + BAND_BLEND + 6.0:
        sx = kx0
        while sx < kx1:
            jx, jy = sx + (rnd() - 0.5) * 8.0, sy + (rnd() - 0.5) * 8.0
            keep = rnd() < 0.9 * patchiness(jx, jy, 31, floor=0.3)
            zid, ridge_t, valley_t = zone_at(jx, jy)
            z, band = terrain(jx, jy)
            if keep and zid == KEDEM and band == 3 and z < 16.0:
                add, _ = batches[int(rnd() * 3) % 3]
                _canopy(add, jx, jy, 3.0 + rnd() * 2.2, 2.0 + rnd() * 2.0)
                placed += 1
            sx += 8.0
        sy += 8.0
    for _, commit in batches:
        commit()
    print(f"forest: {placed} canopies")


def _rock(add, sx, sy, r, h, rnd, sides=6):
    """An irregular rock: jittered base ring pinched to an off-centre apex.
    Reads as a boulder at small sizes and a tor at large ones."""
    z0, _ = terrain(sx, sy)
    wx, wy = to_world(sx, sy)
    base = []
    for i in range(sides):
        a = 2.0 * math.pi * i / sides
        rr = r * (0.7 + 0.6 * rnd())
        base.append((wx + rr * math.cos(a), wy + rr * math.sin(a), z0 - 1.0))
    verts = base + [(wx + (rnd() - 0.5) * r * 0.5, wy + (rnd() - 0.5) * r * 0.5, z0 + h)]
    faces = [tuple(reversed(range(sides)))]
    faces += [(i, (i + 1) % sides, sides) for i in range(sides)]
    add(verts, faces)


def scatter_rocks():
    """Boulders and tors, one pass over the whole board: at the feet of the border
    ranges (mid ridge influence), on peak summits (by height), and denser and
    larger in the two countries whose identity IS rock -- highlands and badlands."""
    mats = [flat("rock_a", "limestone.5"), flat("rock_b", "limestone.6"),
            flat("rock_c", "gunmetal.1")]
    batches = [_batched_mesh(f"rocks_{i}", m) for i, m in enumerate(mats)]
    rnd = rng_from(0x50CC)
    placed = 0
    sy = 6.0
    while sy < VIEW_H - 6.0:
        sx = 6.0
        while sx < VIEW_W - 6.0:
            jx, jy = sx + (rnd() - 0.5) * 9.0, sy + (rnd() - 0.5) * 9.0
            roll = rnd()
            size = rnd()
            zid, ridge_t, valley_t = zone_at(jx, jy)
            z, band = terrain(jx, jy)
            rocky_land = zid in (1, 6)  # highlands, badlands
            # Geology stays where geology is (range feet, summits); only the
            # loose interior rock fields get the patchy, asymmetric density.
            gate = (0.25 < ridge_t < 0.55 and z < 19.0) or z > 19.0
            gate = gate or (rocky_land and roll < 0.12 * patchiness(jx, jy, 32, floor=0.2))
            keep = roll < (0.5 if rocky_land else 0.3)
            if gate and keep and band != 2 and valley_t < 0.3:
                add, _ = batches[int(rnd() * 3) % 3]
                if rocky_land:
                    _rock(add, jx, jy, 3.5 + size * 4.0, 4.0 + size * 6.0, rnd)
                else:
                    _rock(add, jx, jy, 2.5 + size * 2.5, 3.0 + size * 3.0, rnd)
                placed += 1
            sx += 13.0
        sy += 13.0
    for _, commit in batches:
        commit()
    print(f"rocks: {placed}")


def scatter_riverbanks():
    """Riparian green: trees hugging every watercourse -- border rivers and
    interior valleys both, since each is just valley influence in `zone_at` or
    `VALLEYS` depth in `terrain`. The strip of life along the water is what sells
    a river in a desert."""
    greens = [flat("bank_a", "olive.1"), flat("bank_b", "scrub.0"),
              flat("bank_c", "olive.2")]
    batches = [_batched_mesh(f"banks_{i}", m) for i, m in enumerate(greens)]
    rnd = rng_from(0xBA9C)
    placed = 0
    sy = 6.0
    while sy < VIEW_H - 6.0:
        sx = 6.0
        while sx < VIEW_W - 6.0:
            jx, jy = sx + (rnd() - 0.5) * 9.0, sy + (rnd() - 0.5) * 9.0
            keep = rnd() < 0.62 * patchiness(jx, jy, 33, floor=0.25)
            zid, ridge_t, valley_t = zone_at(jx, jy)
            z, band = terrain(jx, jy)
            # 2 < z < 14: above the shallow fringe, below any range shoulder.
            on_bank = (0.30 < valley_t < 0.62 or (zid in VALLEYS and 1.0 < z < 6.0))
            if keep and on_bank and 2.0 < z < 14.0 and band != 2 and ridge_t < 0.3:
                add, _ = batches[int(rnd() * 3) % 3]
                _canopy(add, jx, jy, 2.0 + rnd() * 2.0, 1.5 + rnd() * 1.8)
                placed += 1
            sx += 9.0
        sy += 9.0
    for _, commit in batches:
        commit()
    print(f"riverbank trees: {placed}")


def scatter_orchards():
    """Cultivation you can see: straight planted rows of trees in the eastern
    farmland. Rows are the one deliberately regular thing on the map -- crops are
    the only place regularity is honest."""
    greens = [flat("orch_a", "scrub.0"), flat("orch_b", "olive.1")]
    batches = [_batched_mesh(f"orchard_{i}", m) for i, m in enumerate(greens)]
    rnd = rng_from(0x04C4)
    x0, x1, y0, y1 = _zone_span(5)
    rows = 0
    attempts = 0
    while rows < 8 and attempts < 120:
        attempts += 1
        ax = x0 + rnd() * (x1 - x0)
        ay = y0 + rnd() * (y1 - y0)
        ang = rnd() * math.pi
        n = 5 + int(rnd() * 5)
        pts = [(ax + math.cos(ang) * 7.0 * i, ay + math.sin(ang) * 7.0 * i) for i in range(n)]
        ok = True
        for px, py in pts:
            zid, ridge_t, valley_t = zone_at(px, py)
            z, _band = terrain(px, py)
            if zid != 5 or max(ridge_t, valley_t) > 0.2 or not 6.0 < z < 14.0:
                ok = False
                break
        if not ok:
            continue
        add, _ = batches[rows % 2]
        for px, py in pts:
            _canopy(add, px, py, 2.1 + rnd() * 0.6, 1.6 + rnd() * 0.8)
        rows += 1
    for _, commit in batches:
        commit()
    print(f"orchards: {rows} rows")


def build_oasis(at):
    """The erg settlement is an oasis: a pond disc ringed by palms. The one patch
    of standing water and fresh green in the whole southern desert."""
    pond_add, pond_commit = _batched_mesh("oasis_pond", flat("pond", "water.1", roughness=0.3))
    z0, _ = terrain(*at)
    wx, wy = to_world(*at)
    sides = 14
    ring = [(wx + 7.5 * math.cos(2.0 * math.pi * i / sides),
             wy + 6.0 * math.sin(2.0 * math.pi * i / sides), z0 + 0.4) for i in range(sides)]
    pond_add(ring, [tuple(range(sides))])
    pond_commit()

    palms = [flat("palm_a", "scrub.0"), flat("palm_b", "olive.1")]
    batches = [_batched_mesh(f"palms_{i}", m) for i, m in enumerate(palms)]
    rnd = rng_from(0x0A51)
    for i in range(10):
        a = 2.0 * math.pi * i / 10.0 + rnd() * 0.4
        r = 10.0 + rnd() * 6.0
        add, _ = batches[i % 2]
        _canopy(add, at[0] + r * math.cos(a), at[1] + r * math.sin(a) * 0.85,
                2.2 + rnd() * 1.0, 2.5 + rnd() * 1.5)
    for _, commit in batches:
        commit()
    print("oasis at S hamlet")


def _plate(add, sx0, sy0, sx1, sy1, z):
    """A flat upward-facing quad given SVG-coord corners (sx0<sx1, sy0<sy1)."""
    wx0, wy1 = to_world(sx0, sy0)   # SVG y flips: smaller sy = larger world y
    wx1, wy0 = to_world(sx1, sy1)
    add([(wx0, wy0, z), (wx1, wy0, z), (wx1, wy1, z), (wx0, wy1, z)], [(0, 1, 2, 3)])


#: One fictional flag per enemy country: 2-3 palette fields, horizontal bands,
#: vertical bands, or a canton. The banner lies FLAT at the pole top -- a vertical
#: flag seen from straight above is a line, and this is a top-down map.
FLAG_DESIGNS = {
    0: ("h", ["olive.0", "dust.1"]),
    1: ("v", ["gunmetal.1", "limestone.2"]),
    2: ("h", ["olive.2", "limestone.1", "olive.2"]),
    3: ("h", ["dust.1", "water.1"]),
    5: ("v", ["scrub.0", "limestone.0", "scrub.0"]),
    6: ("h", ["terracotta.1", "dust.0"]),
    7: ("canton", ["dust.0", "terracotta.2"]),
    8: ("h", ["limestone.0", "water.0"]),
}

#: The animal on each flag, as axis-aligned rects (dx, dy, w, h) in banner-local
#: units (origin top-left, y down), stamped just above the fields. Pixel-art
#: heraldry: at 36x24 rendered pixels only a bold silhouette survives, so every
#: beast is built from a handful of rectangles.
EMBLEMS = {
    0: ("shadow.1", [(5, 3, 1.6, 4.5), (11.4, 3, 1.6, 4.5), (5, 7, 8, 1.6)]),          # bull horns
    1: ("shadow.1", [(8, 3, 2, 5.5), (3, 4.5, 5, 1.6), (10, 4.5, 5, 1.6),
                     (4, 3.2, 3, 1.3), (11, 3.2, 3, 1.3)]),                            # eagle
    2: ("shadow.1", [(8, 7, 2, 2.4), (6, 2.5, 1.3, 5), (10.7, 2.5, 1.3, 5),
                     (4, 3, 2, 1.2), (4, 5.2, 2, 1.2), (12, 3, 2, 1.2),
                     (12, 5.2, 2, 1.2)]),                                              # stag antlers
    3: ("limestone.0", [(5, 4.5, 5.5, 3), (10.5, 3.5, 2, 5), (6.5, 3.6, 2.5, 1)]),     # fish
    5: ("olive.3", [(4, 8.5, 2.6, 1.5), (6, 7, 2.6, 1.5), (8, 5.5, 2.6, 1.5),
                    (10, 4, 2.6, 1.5), (12, 2.5, 3, 2)]),                              # river serpent
    6: ("shadow.1", [(8, 3, 2, 6), (8.4, 1.8, 1.3, 1.4), (5.8, 3.6, 2.2, 1.2),
                     (10, 3.6, 2.2, 1.2), (5.8, 6.6, 2.2, 1.2), (10, 6.6, 2.2, 1.2),
                     (8.6, 9, 0.9, 2)]),                                               # lizard
    7: ("terracotta.2", [(10.2, 4.8, 3.6, 2), (8.8, 3.8, 1.8, 1.4), (8.8, 6.6, 1.8, 1.4),
                         (13.8, 3.8, 1.4, 1.2), (14.8, 2.6, 1.4, 1.2),
                         (13.9, 1.5, 1.5, 1.1)]),                                      # scorpion
    8: ("olive.2", [(6.5, 4, 5, 4), (8.4, 2.6, 1.4, 1.4), (5.4, 3.6, 1.2, 1.2),
                    (11.4, 3.6, 1.2, 1.2), (5.4, 7.2, 1.2, 1.2), (11.4, 7.2, 1.2, 1.2),
                    (8.6, 8.2, 1, 1.2)]),                                              # turtle
}


def build_flag(zid, at):
    """The country's flag, planted beside its capital hamlet."""
    orient, keys = FLAG_DESIGNS[zid]
    pole_add, pole_commit = _batched_mesh(f"flag{zid}_pole", flat(f"flag{zid}_pole_m", "gunmetal.1"))
    _block(pole_add, at[0], at[1], 1.6, 1.6, 16.0)
    pole_commit()
    z0, _ = terrain(*at)
    zb = z0 + 15.0
    fx, fy, fw, fh = at[0] + 1.2, at[1] - 6.0, 18.0, 12.0
    if orient == "canton":
        field, canton = keys
        add, commit = _batched_mesh(f"flag{zid}_f", flat(f"flag{zid}_fm", field, roughness=0.6))
        _plate(add, fx, fy, fx + fw, fy + fh, zb)
        commit()
        add, commit = _batched_mesh(f"flag{zid}_c", flat(f"flag{zid}_cm", canton, roughness=0.6))
        _plate(add, fx, fy, fx + fw * 0.45, fy + fh * 0.5, zb + 0.35)
        commit()
    else:
        n = len(keys)
        for i, key in enumerate(keys):
            add, commit = _batched_mesh(f"flag{zid}_p{i}", flat(f"flag{zid}_pm{i}", key, roughness=0.6))
            if orient == "h":
                _plate(add, fx, fy + fh * i / n, fx + fw, fy + fh * (i + 1) / n, zb)
            else:
                _plate(add, fx + fw * i / n, fy, fx + fw * (i + 1) / n, fy + fh, zb)
            commit()
    emblem_key, rects = EMBLEMS[zid]
    add, commit = _batched_mesh(f"flag{zid}_e", flat(f"flag{zid}_em", emblem_key, roughness=0.6))
    for dx, dy, w, h in rects:
        _plate(add, fx + dx, fy + dy, fx + dx + w, fy + dy + h, zb + 0.55)
    commit()


def find_monument_sites():
    """One interior landmark site per enemy country, searched like everything
    else: fixed candidate offsets from the centroid, gated to solid home ground."""
    sites = {}
    offsets = [(55.0, -40.0), (-60.0, 35.0), (40.0, 60.0), (-45.0, -55.0),
               (75.0, 20.0), (0.0, -75.0), (-80.0, -10.0), (20.0, 80.0)]
    for zid in range(9):
        if zid == KEDEM:
            continue
        cx, cy = _CENTROIDS[zid]
        # The relaxed pass also accepts high ground: the highlands and badlands
        # have no low interior, and a ziggurat on a summit is the point of one.
        for pass_gate, z_max in ((0.15, 14.0), (0.28, 21.0)):
            for dx, dy in offsets:
                px, py = cx + dx, cy + dy
                z_id, ridge_t, valley_t = zone_at(px, py)
                z, _band = terrain(px, py)
                if z_id == zid and max(ridge_t, valley_t) < pass_gate and z < z_max:
                    sites[zid] = (px, py)
                    break
            if zid in sites:
                break
        if zid not in sites:
            print(f"monument: no site in zone {zid}")
    return sites


def build_monuments(sites):
    """A unique monument per enemy country, all from primitives:
    stone circle, ziggurat, forest shrine, caravanserai, step-well,
    twin obelisks, great pyramid, salt-labyrinth geoglyph."""
    rnd = rng_from(0x303B)

    def batched(tag, key, rough=0.8):
        return _batched_mesh(tag, flat(f"{tag}_m", key, roughness=rough))

    if 0 in sites:  # NW steppe: great stone circle with a central trilithon
        sx, sy = sites[0]
        add, commit = batched("mon_circle", "limestone.2")
        for i in range(12):
            a = 2.0 * math.pi * i / 12.0
            _rock(add, sx + 19.0 * math.cos(a), sy + 19.0 * math.sin(a) * 0.85,
                  2.6, 8.0 + rnd() * 5.0, rnd, sides=5)
        _block(add, sx - 3.2, sy, 2.6, 2.6, 11.0)
        _block(add, sx + 3.2, sy, 2.6, 2.6, 11.0)
        _block(add, sx, sy, 10.0, 3.2, 2.2, lift=11.0)  # lintel
        commit()
    if 1 in sites:  # N highlands: five-tier ziggurat, shrine on the crown
        sx, sy = sites[1]
        tiers = ((27.0, "limestone.3"), (21.0, "limestone.2"), (15.5, "limestone.3"),
                 (10.5, "limestone.2"), (6.0, "limestone.1"))
        for i, (side, key) in enumerate(tiers):
            add, commit = batched(f"mon_zig{i}", key)
            _block(add, sx, sy, side, side, 3.2, lift=3.2 * i)
            commit()
        add, commit = batched("mon_zig_stair", "limestone.1")
        _block(add, sx, sy + 15.0, 4.0, 8.0, 2.4)  # processional ramp, south face
        commit()
        add, commit = batched("mon_zig_crown", "terracotta.1")
        _block(add, sx, sy, 3.4, 3.4, 3.0, lift=16.0)
        commit()
    if 2 in sites:  # NE forest: colonnaded white temple in its clearing
        sx, sy = sites[2]
        add, commit = batched("mon_temple_base", "limestone.1")
        _block(add, sx, sy, 16.0, 13.0, 2.0)
        commit()
        add, commit = batched("mon_temple", "limestone.0")
        for px in (-6.0, -2.0, 2.0, 6.0):
            _block(add, sx + px, sy - 4.8, 1.6, 1.6, 6.0, lift=2.0)
            _block(add, sx + px, sy + 4.8, 1.6, 1.6, 6.0, lift=2.0)
        _block(add, sx, sy, 8.0, 6.0, 5.0, lift=2.0)   # cella
        _block(add, sx, sy, 11.0, 8.5, 1.6, lift=8.0)  # roof slab over the colonnade
        commit()
    if 3 in sites:  # W coastal desert: caravanserai with corner towers and a gate
        sx, sy = sites[3]
        add, commit = batched("mon_serai", "limestone.3")
        _block(add, sx - 5.5, sy - 13.0, 15.0, 3.0, 6.5)   # north wall, gate gap east
        _block(add, sx + 11.0, sy - 13.0, 4.0, 3.0, 6.5)
        _block(add, sx, sy + 13.0, 26.0, 3.0, 6.5)
        _block(add, sx - 13.0, sy, 3.0, 23.0, 6.5)
        _block(add, sx + 13.0, sy, 3.0, 23.0, 6.5)
        commit()
        add, commit = batched("mon_serai_towers", "limestone.2")
        for dx, dy in ((-13.0, -13.0), (13.0, -13.0), (-13.0, 13.0), (13.0, 13.0)):
            _block(add, sx + dx, sy + dy, 6.0, 6.0, 9.5)
        _block(add, sx, sy, 5.0, 5.0, 3.0)  # courtyard cistern house
        commit()
    if 5 in sites:  # E lowlands: terraced step-well descending to water
        sx, sy = sites[5]
        add, commit = batched("mon_well_rim", "limestone.1")
        for half, h in ((11.0, 3.0), (7.5, 1.8)):
            _block(add, sx, sy - half, 2.0 * half + 2.0, 2.0, h)
            _block(add, sx, sy + half, 2.0 * half + 2.0, 2.0, h)
            _block(add, sx - half, sy, 2.0, 2.0 * half - 2.0, h)
            _block(add, sx + half, sy, 2.0, 2.0 * half - 2.0, h)
        commit()
        add, commit = batched("mon_well_stair", "limestone.2")
        _block(add, sx, sy - 9.2, 3.0, 7.0, 1.2)  # entry stair cutting the terraces
        commit()
        z0, _ = terrain(sx, sy)
        add, commit = batched("mon_well_water", "water.1", rough=0.3)
        _plate(add, sx - 5.5, sy - 5.5, sx + 5.5, sy + 5.5, z0 + 0.5)
        commit()
    if 6 in sites:  # SW badlands: obelisk gateway on a paved plaza
        sx, sy = sites[6]
        add, commit = batched("mon_plaza", "limestone.5")
        _plate_z = terrain(sx, sy)[0] + 0.4
        _plate(add, sx - 11.0, sy - 5.5, sx + 11.0, sy + 5.5, _plate_z)
        commit()
        add, commit = batched("mon_obelisks", "gunmetal.0")
        for dx in (-6.5, 6.5):
            _block(add, sx + dx, sy, 6.0, 6.0, 2.2)            # plinth
            _block(add, sx + dx, sy, 3.4, 3.4, 22.0, lift=2.2)  # shaft
        commit()
    if 7 in sites:  # S erg: pyramid complex -- great pyramid, satellite, causeway
        sx, sy = sites[7]
        z0, _ = terrain(sx, sy)
        wx, wy = to_world(sx, sy)
        add, commit = batched("mon_pyramid", "dust.0")
        s = 16.0
        base = [(wx - s, wy - s, z0 - 1.0), (wx + s, wy - s, z0 - 1.0),
                (wx + s, wy + s, z0 - 1.0), (wx - s, wy + s, z0 - 1.0)]
        add(base + [(wx, wy, z0 + 20.0)],
            [(3, 2, 1, 0)] + [(i, (i + 1) % 4, 4) for i in range(4)])
        s2, ox, oy = 6.0, 15.0, 13.0
        wx2, wy2 = to_world(sx + ox, sy + oy)
        z2, _ = terrain(sx + ox, sy + oy)
        base2 = [(wx2 - s2, wy2 - s2, z2 - 1.0), (wx2 + s2, wy2 - s2, z2 - 1.0),
                 (wx2 + s2, wy2 + s2, z2 - 1.0), (wx2 - s2, wy2 + s2, z2 - 1.0)]
        add(base2 + [(wx2, wy2, z2 + 8.0)],
            [(3, 2, 1, 0)] + [(i, (i + 1) % 4, 4) for i in range(4)])
        commit()
        add, commit = batched("mon_causeway", "limestone.0")
        _plate(add, sx + s, sy - 1.5, sx + s + 26.0, sy + 1.5, z0 + 0.4)
        commit()
    if 8 in sites:  # SE salt flats: labyrinth geoglyph, bolder and centred
        sx, sy = sites[8]
        add, commit = batched("mon_glyph", "shadow.1", rough=0.95)
        for half in (26.0, 17.0, 9.0):
            _block(add, sx, sy - half, 2.0 * half + 4.5, 4.5, 1.0)
            _block(add, sx, sy + half, 2.0 * half + 4.5, 4.5, 1.0)
            _block(add, sx - half, sy, 4.5, 2.0 * half - 4.5, 1.0)
            _block(add, sx + half, sy, 4.5, 2.0 * half - 4.5, 1.0)
        _block(add, sx, sy, 5.0, 5.0, 1.4)
        commit()
    print(f"monuments: {len(sites)}")


def _zone_span(zid):
    """The zone's search box: unwarped quad bbox padded by the warp's reach,
    clamped to the board. Candidates are gated by `zone_at`, not by this box."""
    xs = [x for x, _ in CELLS[zid]]
    ys = [y for _, y in CELLS[zid]]
    return (max(0.0, min(xs) - 46.0), min(VIEW_W, max(xs) + 46.0),
            max(0.0, min(ys) - 46.0), min(VIEW_H, max(ys) + 46.0))


def patchiness(jx, jy, salt, floor=0.12):
    """Real cover is patchy and asymmetric: forests have glades and dense hearts,
    scrub gathers in tracts, rock fields thin out. A large soft noise modulates
    scatter density so nothing sits at one even, synthetic-looking density."""
    return floor + (1.0 - floor) * max(0.0, vnoise(jx * 0.011, jy * 0.011, salt=salt)) ** 0.7


def scatter_zone_canopies(zid, label, seed, spacing, keep_p, r0, r1, h0, h1,
                          patch_salt=30, patch_floor=0.12, clear_at=None, clear_r=16.0):
    """Vegetation cover for a whole enemy country -- NE's forest canopy, or the
    NW steppe's sparse scrub dots, depending on the numbers. `clear_at` keeps a
    monument's ground open."""
    greens = [flat(f"{label}_a", "olive.1"), flat(f"{label}_b", "olive.2"),
              flat(f"{label}_c", "scrub.1")]
    batches = [_batched_mesh(f"{label}_{i}", m) for i, m in enumerate(greens)]
    rnd = rng_from(seed)
    placed = 0
    x0, x1, y0, y1 = _zone_span(zid)
    sy = y0
    while sy < y1:
        sx = x0
        while sx < x1:
            jx = sx + (rnd() - 0.5) * spacing
            jy = sy + (rnd() - 0.5) * spacing
            keep = rnd() < keep_p * patchiness(jx, jy, patch_salt, floor=patch_floor)
            z_id, ridge_t, valley_t = zone_at(jx, jy)
            z, _band = terrain(jx, jy)
            cleared = clear_at and (jx - clear_at[0]) ** 2 + (jy - clear_at[1]) ** 2 < clear_r ** 2
            if keep and z_id == zid and z < 16.0 and not cleared:
                add, _ = batches[int(rnd() * 3) % 3]
                _canopy(add, jx, jy, r0 + rnd() * (r1 - r0), h0 + rnd() * (h1 - h0))
                placed += 1
            sx += spacing
        sy += spacing
    for _, commit in batches:
        commit()
    print(f"{label}: {placed} canopies")


def build_hamlets(zid, label, count, seed):
    """A few small settlements for the inhabited enemy countries. Sites are drawn
    from the zone's box and gated to solid interior ground, so the warp can never
    strand a hamlet in the wrong country or on a mountain range."""
    walls = [flat(f"{label}_a", "limestone.3"), flat(f"{label}_b", "limestone.4"),
             flat(f"{label}_c", "dust.5")]
    batches = [_batched_mesh(f"{label}_{i}", m) for i, m in enumerate(walls)]
    rnd = rng_from(seed)
    x0, x1, y0, y1 = _zone_span(zid)
    sites = []
    attempts = 0
    while len(sites) < count and attempts < 400:
        attempts += 1
        px = x0 + rnd() * (x1 - x0)
        py = y0 + rnd() * (y1 - y0)
        z_id, ridge_t, valley_t = zone_at(px, py)
        z, _band = terrain(px, py)
        # The board edge is not a border: a capital at x=4 renders half a hamlet
        # and hangs its flag off the map.
        on_board = 24.0 < px < VIEW_W - 24.0 and 24.0 < py < VIEW_H - 24.0
        if z_id != zid or max(ridge_t, valley_t) > 0.15 or z > 14.0 or not on_board:
            continue
        for _ in range(5 + int(rnd() * 4)):
            a, r = rnd() * 2.0 * math.pi, 1.5 + rnd() * 11.0
            add, _ = batches[int(rnd() * 3) % 3]
            _block(add, px + r * math.cos(a), py + r * math.sin(a) * 0.75,
                   3.5 + rnd() * 2.5, 3.5 + rnd() * 2.5, 2.5 + rnd() * 2.5)
        sites.append((px, py))
    for _, commit in batches:
        commit()
    print(f"{label}: {len(sites)} hamlets")
    return sites


def build_towers():
    """A watchtower on each enemy country's Kedem-facing approach: walk from the
    country's centroid toward Kedem's and keep the last solid interior point
    before the border zone begins. Plinth, tall shaft, wider dark cap -- a thin
    vertical silhouette nothing else on the map has."""
    b_add, b_commit = _batched_mesh("towers", flat("tower_body", "limestone.4"))
    c_add, c_commit = _batched_mesh("tower_caps", flat("tower_cap", "gunmetal.2"))
    kx, ky = _CENTROIDS[KEDEM]
    for zid in range(9):
        if zid == KEDEM:
            continue
        cx, cy = _CENTROIDS[zid]
        dx, dy = kx - cx, ky - cy
        step = 6.0 / math.hypot(dx, dy)
        best = None
        # Two passes: strict, then relaxed -- badlands mesas can leave no point
        # that clears the strict height gate on the whole approach line.
        for t_max, z_max in ((0.18, 16.0), (0.32, 22.0)):
            t = 0.0
            while t < 1.0:
                px, py = cx + dx * t, cy + dy * t
                z_id, ridge_t, valley_t = zone_at(px, py)
                if z_id != zid:
                    break
                z, _band = terrain(px, py)
                if max(ridge_t, valley_t) < t_max and z < z_max:
                    best = (px, py)
                t += step
            if best is not None:
                break
        if best is None:
            print(f"tower: no ground on zone {zid}'s approach")
            continue
        px, py = best
        _block(b_add, px, py, 6.0, 6.0, 2.5)            # plinth
        _block(b_add, px, py, 3.4, 3.4, 15.0)           # shaft
        _block(c_add, px, py, 5.2, 5.2, 1.6, lift=15.0)  # lookout cap
    b_commit()
    c_commit()
    print("towers: one per enemy country")


def find_beit_sahwan():
    """Bottom of Kedem: walk north from the southern border until we are on solid
    desert, clear of the border features AND of the ecotone. Searched, not
    hand-placed -- the lattice jitter moves the cell, and a hand constant ends up
    in the wrong country."""
    sx = _CENTROIDS[KEDEM][0]
    sy = _K_BOT + 44.0
    while sy > URBAN_MAX_Y + BAND_BLEND:
        zid, ridge_t, valley_t = zone_at(sx, sy)
        band_y = sy + 18.0 * vnoise(sx * 0.012, 4.4, salt=5)
        if zid == KEDEM and max(ridge_t, valley_t) < 0.12 and band_y >= URBAN_MAX_Y + BAND_BLEND:
            return (sx, sy - 12.0)
        sy -= 4.0
    raise SystemExit("no spot for Beit Sahwan inside Kedem's desert band")


def build_beit_sahwan(at):
    """The campaign's start point, and drawn as one: a tight settlement cluster
    inside a terracotta ring baked into the ground. With the road gone (progress
    is the shell's flag overlay), the origin has to carry its own visual weight.
    A named Empty keeps the town addressable from the GUI."""
    walls = [flat("bs_a", "limestone.3"), flat("bs_b", "limestone.4"), flat("bs_c", "dust.5")]
    batches = [_batched_mesh(f"beit_sahwan_{i}", m) for i, m in enumerate(walls)]
    rnd = rng_from(0xBE17)
    for _ in range(30):
        a, r = rnd() * 2.0 * math.pi, 2.0 + rnd() * 18.0
        jx, jy = at[0] + r * math.cos(a), at[1] + r * math.sin(a) * 0.75
        add, _ = batches[int(rnd() * 3) % 3]
        _block(add, jx, jy, 4.0 + rnd() * 3.5, 4.0 + rnd() * 3.5, 3.0 + rnd() * 3.5)
    for _, commit in batches:
        commit()

    ring_add, ring_commit = _batched_mesh("bs_ring", flat("bs_ring", "terracotta.2", roughness=0.8))
    seg, r0, r1 = 32, 30.0, 37.0
    for i in range(seg):
        a0 = 2.0 * math.pi * i / seg
        a1 = 2.0 * math.pi * (i + 1) / seg
        quad = []
        for (a, r) in ((a0, r0), (a1, r0), (a1, r1), (a0, r1)):
            px, py = at[0] + r * math.cos(a), at[1] + r * math.sin(a) * 0.8
            z, _ = terrain(px, py)
            quad.append((*to_world(px, py), z + 1.2))
        ring_add(quad, [(0, 1, 2, 3)])
    ring_commit()

    marker = bpy.data.objects.new("beit_sahwan", None)
    z, _ = terrain(*at)
    marker.location = (*to_world(*at), z + 6.0)
    marker.empty_display_size = 12.0
    bpy.context.collection.objects.link(marker)


# ------------------------------------------------------------------ scene rig

def camera_and_light():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.render.resolution_x = RES_X
    sc.render.resolution_y = RES_Y
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = VIEW_W
    # Default far clip is 100 and the camera stands 2000 up: without this the render
    # is fully transparent with no error of any kind. Cost a debugging round once.
    cam_data.clip_start = 1.0
    cam_data.clip_end = 6000.0
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    # Euler (0,0,0) looks straight down -Z with +Y up: world +X = screen right,
    # world +Y = screen up. True vertical, per the brief.
    cam.location = (0.0, 0.0, 2000.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.0
    # A touch cool: with a pure-warm rig, lit gunmetal drifts near the olive ramp
    # and the quantiser turns the grey placeholders camouflage.
    sun_data.color = (0.95, 0.98, 1.0)
    sun_data.angle = math.radians(2.0)
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    se, sa = math.radians(SUN_ELEV_DEG), math.radians(SUN_AZIMUTH_DEG)
    sun.location = (900 * math.cos(se) * math.cos(sa),
                    900 * math.cos(se) * math.sin(sa), 900 * math.sin(se))
    sun.rotation_euler = (Vector((0, 0, 0)) - Vector(sun.location)).to_track_quat("-Z", "Y").to_euler()

    # Warm ambient. The layered map learned this the hard way: a cool blue ambient
    # desaturates shadowed greens into the gunmetal ramp and a third of the forest
    # quantises grey.
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = palette_linear("limestone.1")
    bg.inputs["Strength"].default_value = 0.34
    bpy.context.scene.world = world


# ------------------------------------------------------------------------ main

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)  # no default cube, light, camera
    camera_and_light()

    build_terrain()
    build_water()
    bs = find_beit_sahwan()
    print(f"beit sahwan at SVG ({bs[0]:.0f}, {bs[1]:.0f})")
    build_beit_sahwan(bs)
    scatter_city(clear_at=bs)
    scatter_forest()
    mon_sites = find_monument_sites()
    scatter_zone_canopies(2, "ne_forest", 0x2F0A, spacing=11.0, keep_p=0.85,
                          r0=2.6, r1=4.8, h0=1.8, h1=3.6, patch_salt=34,
                          patch_floor=0.3, clear_at=mon_sites.get(2), clear_r=17.0)
    scatter_zone_canopies(0, "nw_scrub", 0x0F0B, spacing=24.0, keep_p=0.7,
                          r0=1.6, r1=3.2, h0=1.0, h1=2.2, patch_salt=35)
    capitals = {}
    capitals[3] = build_hamlets(3, "w_hamlets", 3, 0x77A1)
    capitals[5] = build_hamlets(5, "e_hamlets", 2, 0x77A2)
    capitals[0] = build_hamlets(0, "nw_hamlets", 2, 0x77A3)
    capitals[1] = build_hamlets(1, "n_hamlets", 2, 0x77A4)
    capitals[2] = build_hamlets(2, "ne_hamlets", 2, 0x77A5)
    capitals[6] = build_hamlets(6, "sw_hamlets", 2, 0x77A6)
    capitals[7] = build_hamlets(7, "s_hamlets", 1, 0x77A7)
    capitals[8] = build_hamlets(8, "se_hamlets", 1, 0x77A8)
    build_towers()
    scatter_rocks()
    scatter_riverbanks()
    scatter_orchards()
    if capitals.get(7):
        build_oasis(capitals[7][0])
    build_monuments(mon_sites)
    # The flag flies at the capital -- the first hamlet -- or failing that at the
    # monument, so every country shows its colours somewhere sensible.
    for zid in FLAG_DESIGNS:
        spot = (capitals.get(zid) or [mon_sites.get(zid)])[0]
        if spot:
            build_flag(zid, (spot[0] + 11.0, spot[1] - 9.0))

    # The shell overlays per-country state (the brigade lion flag on completed
    # countries) on top of this render; these outlines are its geometry contract.
    print("country polygons:", json.dumps(
        [[[round(x, 1), round(y, 1)] for x, y in country_outline(zid)] for zid in range(9)]))

    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

    bpy.context.scene.render.filepath = OUT_PNG
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    print(f"wrote {OUT_PNG}")
    print(f"NEXT: python3 tools/quantize_sprites.py --file {OUT_PNG} to lock it to the palette")


main()
