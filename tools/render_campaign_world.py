"""Generate the campaign world as ONE continuous terrain mesh, true top-down.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_campaign_world.py -- [progress]

`progress` is the campaign completion fraction 0..1 (default 0.35) and drives how much
of the troops' road is drawn -- see `set_campaign_progress` at the bottom.

This is the v2 map candidate, replacing the per-region layered approach with the brief:

  * One high-density grid mesh covering the whole 1140x790 board. No gaps, no voids --
    countries are zones of the same surface, separated by raised ridges or sunken river
    valleys where the terrain itself changes, never by empty space.
  * Nine countries: Kedem (home) dead centre, eight placeholder enemies around it,
    their terrain all grey until each gets an art pass.
  * Kedem carries three terrain bands: desert at the bottom (with Beit Sahwan),
    urban in the middle, woodland at the top.
  * Zones come from a domain-warped Voronoi over nine seeds -- warp makes the borders
    organic instead of straight cell walls.
  * Colour is a node material per zone: world-Z through a CONSTANT ColorRamp whose
    stops are palette keys. Deep water sits at the lowest heights, plains above,
    rock at ridge height. CONSTANT stops keep the output close to the locked
    32-colour palette so the post-render quantise barely has to move anything.
  * A Bezier road winds from Beit Sahwan north through Kedem into enemy ground.
    Its `bevel_factor_end` is the progress dial: 0 = no road, 1 = full road. The
    shell re-renders headless with the fraction as the CLI arg after `--`.

Self-contained except for `data/palette.json`: repo palette discipline outranks
asset purity, every colour in the render must trace to a ramp key.

Everything random is drawn from `rng_from` (same LCG as the layered script) or from
Perlin noise at fixed offsets, so a re-render is byte-identical.

Coordinates: SVG units, 1 unit = 1 layout px, X east; SVG y grows downward and is
flipped into Blender Y by `to_world`. "Bottom of Kedem" = large SVG y = screen south.
"""
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

KEDEM = 4  # centre seed of the 3x3
#: Kedem's three bands, in SVG y. The centre Voronoi cell nominally spans y 263..527;
#: thirds of that, so each band is a readable stripe rather than a sliver.
FOREST_MAX_Y = 351.0   # forest: y < this (screen top of Kedem)
URBAN_MAX_Y = 439.0    # urban: FOREST_MAX_Y <= y < this; desert below (screen bottom)

DEFAULT_PROGRESS = 0.35


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


# ----------------------------------------------------------------------- zones

def _seeds():
    """Nine country seeds on a jittered 3x3. Kedem's stays exactly central --
    the whole point of the layout is the home country in the middle."""
    rnd = rng_from(0xC4A9)
    xs = (VIEW_W / 6.0, VIEW_W / 2.0, 5.0 * VIEW_W / 6.0)
    ys = (VIEW_H / 6.0, VIEW_H / 2.0, 5.0 * VIEW_H / 6.0)
    pts = []
    for iy in range(3):
        for ix in range(3):
            jx = (rnd() - 0.5) * 76.0
            jy = (rnd() - 0.5) * 76.0
            if iy == 1 and ix == 1:
                jx = jy = 0.0
            pts.append((xs[ix] + jx, ys[iy] + jy))
    return pts


SEEDS = _seeds()

#: Border style per country pair. A hash, not a hand list: any pair not named here
#: gets a deterministic mix of mountain ridges and river valleys.
def _border_style(a, b):
    lo, hi = (a, b) if a < b else (b, a)
    return "valley" if (lo * 31 + hi * 17) % 3 == 2 else "ridge"


def zone_at(sx, sy):
    """(zone id, ridge factor 0..1, valley factor 0..1) at an SVG point.

    Domain-warped nearest-seed: the warp is what turns straight Voronoi walls into
    coastline-looking borders.

    Border influence is accumulated from EVERY neighbour, not just the second-nearest.
    The second-nearest-only version flipped ridge/valley per sample wherever two
    different neighbours traded second place -- every triple junction grew a sawtooth
    of alternating bumps and cuts. Taking max ridge and max valley influence
    separately lets both features coexist smoothly where three countries meet.
    """
    wx = vnoise(sx * 0.004 + 11.0, sy * 0.004 + 5.0, salt=1)
    wy = vnoise(sx * 0.004 + 11.0, sy * 0.004 + 5.0, salt=2)
    px, py = sx + wx * 60.0, sy + wy * 60.0
    dists = [math.hypot(px - cx, py - cy) for cx, cy in SEEDS]
    zid = min(range(len(SEEDS)), key=lambda i: dists[i])
    ridge_t = valley_t = 0.0
    for j, dj in enumerate(dists):
        if j == zid:
            continue
        e = dj - dists[zid]
        # A mountain range on a 1140-unit map needs to be ~1/12th of a country
        # across; the first render's 55-wide ridges read as hairline cracks.
        if _border_style(zid, j) == "ridge":
            ridge_t = max(ridge_t, 1.0 - e / 95.0)
        else:
            valley_t = max(valley_t, 1.0 - e / 65.0)
    return zid, max(0.0, ridge_t), max(0.0, valley_t)


def terrain(sx, sy):
    """(height, material band) at an SVG point. The single source of truth for the
    surface -- the mesh displaces with it AND the road samples it, which is how the
    road stays glued to the ground without any raycasting."""
    zid, ridge_t, valley_t = zone_at(sx, sy)

    # Base relief, per terrain character; relief 0..1.
    relief = 0.5 * (fbm(sx * 0.006 + 7.3, sy * 0.006 + 2.1, salt=3) + 1.0)
    # Kedem's bands meet on noise-wavy lines, not ruler-straight y thresholds.
    band_y = sy + 18.0 * vnoise(sx * 0.012, 4.4, salt=5)
    if zid != KEDEM:
        # Placeholders stay CALM as well as grey: taller relief grew lit patches
        # that quantised olive, and a placeholder should not compete for the eye.
        z = 8.0 + 3.0 * relief
        band = 0  # grey placeholder
    elif band_y >= URBAN_MAX_Y:
        # Desert: shallow anisotropic ripple reads as wind rows, not fish scales.
        ripple = vnoise(sx * 0.05, sy * 0.012, salt=4)
        z = 8.0 + 3.0 * relief + 1.6 * ripple
        band = 1
    elif band_y >= FOREST_MAX_Y:
        z = 9.0 + 1.2 * relief  # urban: near-flat, buildings carry the texture
        band = 2
    else:
        z = 8.0 + 6.0 * relief  # woodland: rolling
        band = 3

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
        spurs = 14.0 * ridge_t * vnoise(sx * 0.055, sy * 0.055, salt=7)
        z += (38.0 * (ridge_t ** 3) * rocky + spurs) * fade
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
WATER = [(Z_MIN, "water.0"), (-5.0, "water.1")]
ROCK = [(18.0, "dust.5"), (27.0, "limestone.6"), (36.0, "limestone.7")]

BAND_STOPS = [
    WATER + [(1.2, "gunmetal.1")] + ROCK,                                          # 0 grey
    WATER + [(1.2, "dust.3"), (8.0, "dust.4"), (13.0, "dust.5")] + ROCK,           # 1 desert
    WATER + [(1.2, "limestone.3"), (10.0, "limestone.4")] + ROCK,                  # 2 urban
    WATER + [(1.2, "olive.0"), (8.0, "olive.1"), (14.0, "olive.2")] + ROCK,        # 3 forest
]


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


def _block(add, sx, sy, w, d, h):
    z0, _ = terrain(sx, sy)
    z0 -= 1.0
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


def scatter_city(road_pts):
    """Kedem's urban band: a jittered grid of low blocks, parted around the road so
    the campaign path visibly threads the capital rather than being painted over."""
    walls = [flat("wall_a", "limestone.2"), flat("wall_b", "limestone.3"),
             flat("wall_c", "limestone.4")]
    batches = [_batched_mesh(f"city_{i}", m) for i, m in enumerate(walls)]
    rnd = rng_from(0x0B71)
    placed = 0
    # The loop overshoots both band edges by the wave amplitude; the band check on
    # each candidate is what actually gates placement.
    sy = FOREST_MAX_Y - 14.0
    while sy < URBAN_MAX_Y + 14.0:
        sx = SEEDS[KEDEM][0] - 175.0
        while sx < SEEDS[KEDEM][0] + 175.0:
            jx, jy = sx + (rnd() - 0.5) * 8.0, sy + (rnd() - 0.5) * 8.0
            # District mask: low-frequency noise clumps the blocks into quarters
            # with open ground between. A uniform scatter reads as confetti; the
            # first threshold (0.02) kept only noise peaks and halved the city.
            district = vnoise(jx * 0.022, jy * 0.022, salt=8) > -0.08
            keep = district and rnd() < 0.88
            zid, ridge_t, valley_t = zone_at(jx, jy)
            z, band = terrain(jx, jy)
            near_road = any((jx - rx) ** 2 + (jy - ry) ** 2 < 100.0 for rx, ry in road_pts)
            if keep and zid == KEDEM and band == 2 and z < 16.0 and not near_road:
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
    sy = 256.0
    while sy < FOREST_MAX_Y + 14.0:
        sx = SEEDS[KEDEM][0] - 180.0
        while sx < SEEDS[KEDEM][0] + 180.0:
            jx, jy = sx + (rnd() - 0.5) * 7.0, sy + (rnd() - 0.5) * 7.0
            keep = rnd() < 0.85
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


def find_beit_sahwan():
    """Bottom of Kedem: walk north from the southern border until we are inside
    Kedem's desert band and off the border ridge. Searched, not hand-placed --
    the warp moves the border, and a hand constant ends up in the wrong country."""
    sx = SEEDS[KEDEM][0]
    sy = 526.0
    while sy > URBAN_MAX_Y + 10.0:
        zid, ridge_t, valley_t = zone_at(sx, sy)
        if zid == KEDEM and max(ridge_t, valley_t) < 0.15:
            return (sx, sy - 10.0)
        sy -= 4.0
    raise SystemExit("no spot for Beit Sahwan inside Kedem's desert band")


def build_beit_sahwan(at):
    """A tight settlement cluster plus a named Empty so the town is addressable
    from the GUI and from any later registration script."""
    walls = [flat("bs_a", "limestone.3"), flat("bs_b", "limestone.4"), flat("bs_c", "dust.5")]
    batches = [_batched_mesh(f"beit_sahwan_{i}", m) for i, m in enumerate(walls)]
    rnd = rng_from(0xBE17)
    for _ in range(24):
        a, r = rnd() * 2.0 * math.pi, rnd() * 18.0
        jx, jy = at[0] + r * math.cos(a), at[1] + r * math.sin(a) * 0.7
        add, _ = batches[int(rnd() * 3) % 3]
        _block(add, jx, jy, 4.0 + rnd() * 3.0, 4.0 + rnd() * 3.0, 3.0 + rnd() * 3.0)
    for _, commit in batches:
        commit()
    marker = bpy.data.objects.new("beit_sahwan", None)
    z, _ = terrain(*at)
    marker.location = (*to_world(*at), z + 6.0)
    marker.empty_display_size = 12.0
    bpy.context.collection.objects.link(marker)


# --------------------------------------------------------------------- the road

def road_points(start):
    """The troops' path: Beit Sahwan north through the capital and the woods, over
    the northern border into enemy ground. Sampled densely (every ~20 units) so the
    AUTO bezier handles hug the terrain over the border ridge instead of tunnelling."""
    end_y = 95.0
    pts = []
    # Dense: at 22 samples the AUTO handles cut inside the sharpened border crest and
    # the road visibly tunnelled where it crossed the range. ~9 units per sample hugs it.
    n = 46
    for i in range(n + 1):
        f = i / n
        sy = start[1] + (end_y - start[1]) * f
        sx = start[0] + 60.0 * math.sin(f * 2.2 * math.pi + 0.6) * (1.0 - 0.25 * f)
        pts.append((sx, sy))
    return pts


def build_road(pts, progress):
    curve = bpy.data.curves.new("campaign_road", type="CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(pts) - 1)
    for bp, (sx, sy) in zip(spline.bezier_points, pts):
        z, _ = terrain(sx, sy)
        bp.co = Vector((*to_world(sx, sy), z + 2.6))
        bp.handle_left_type = bp.handle_right_type = "AUTO"

    # The progress dial. bevel_factor_end grows the swept ribbon from the spline's
    # start; SPLINE mapping makes the fraction proportional to arc position, so 0.5
    # is visually half the journey, not half the control points.
    curve.bevel_depth = 2.6
    curve.bevel_resolution = 2
    curve.use_fill_caps = True
    curve.bevel_factor_mapping_start = "SPLINE"
    curve.bevel_factor_mapping_end = "SPLINE"
    curve.bevel_factor_start = 0.0
    curve.bevel_factor_end = max(0.0, min(1.0, progress))

    curve.materials.append(flat("road", "terracotta.1", roughness=0.7))
    ob = bpy.data.objects.new("campaign_road", curve)
    bpy.context.collection.objects.link(ob)
    return ob


def set_campaign_progress(fraction):
    """The hook the render rig calls: 0.0 = no road, 1.0 = road reaches the far end.

    Headless usage from the shell's tooling:

        Blender --background art/src/campaign/kedem_world.blend \
            --python-expr "import bpy; \
                bpy.data.curves['campaign_road'].bevel_factor_end = 0.62; \
                bpy.context.scene.render.filepath = 'assets/campaign/world_map.png'; \
                bpy.ops.render.render(write_still=True)"
    """
    bpy.data.curves["campaign_road"].bevel_factor_end = max(0.0, min(1.0, fraction))


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
    progress = DEFAULT_PROGRESS
    if "--" in sys.argv:
        rest = sys.argv[sys.argv.index("--") + 1:]
        if rest:
            progress = float(rest[0])

    bpy.ops.wm.read_factory_settings(use_empty=True)  # no default cube, light, camera
    camera_and_light()

    build_terrain()
    build_water()
    bs = find_beit_sahwan()
    print(f"beit sahwan at SVG ({bs[0]:.0f}, {bs[1]:.0f})")
    build_beit_sahwan(bs)
    pts = road_points(bs)
    scatter_city(pts)
    scatter_forest()
    build_road(pts, progress)

    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

    bpy.context.scene.render.filepath = OUT_PNG
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    print(f"wrote {OUT_PNG} (progress={progress})")
    print(f"NEXT: python3 tools/quantize_sprites.py --file {OUT_PNG} to lock it to the palette")


main()
