"""Render the Sahar Basin campaign map as layered, near-vertical satellite art.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_campaign_map.py -- marj

Renders one region per invocation to `assets/campaign/layer_<region>.png`, plus
`layer_base.png` for the sea, Kedem and the borders. Every layer is rendered with the
**same camera framing the whole basin**, so the PNGs are full-canvas with transparency
outside their own region and stack with no per-layer offsets. Getting that wrong is the
easy way to have a map that is subtly misregistered at one zoom and fine at another.

Why layers at all. The campaign screen's whole state language is CSS restyling a
per-region element -- live, complete, locked -- and a single flat image cannot be
desaturated one region at a time. Layers keep `worldmap.ts`, its tests and the town
anchoring exactly as they are; only what sits inside each wrapper changes.

Geometry is read from `assets/campaign/sahar_basin.svg` rather than duplicated here. The
SVG stays the authority on shape: it is what the data gate checks, what the town `at`
coordinates in world.json are expressed against, and what the live-border rule strokes.
A second copy of the coastline would drift from it within a week.

Coordinates: 1 SVG unit = 1 Blender unit, X east, Y north. SVG y grows downward, so it is
flipped. The frame is exactly the 1140x790 viewBox, which is the box `worldmap.ts`
positions town markers as percentages of.
"""
import json
import math
import os
import pathlib
import re
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dimetric import palette_linear  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, "assets", "campaign", "sahar_basin.svg")
OUT_DIR = os.path.join(ROOT, "assets", "campaign")

#: The layout box. Must equal the SVG's viewBox and worldmap.ts's VIEW_W/VIEW_H.
VIEW_W, VIEW_H = 1140.0, 790.0
#: 2x the layout box, so the map stays crisp on a high-density display.
RES_X, RES_Y = 2280, 1580

#: Near-vertical: 8 degrees off straight down. Enough parallax for relief to read as
#: height rather than as texture, not enough for anything to occlude anything else.
CAM_TILT_DEG = 8.0
#: (No camera azimuth: a top-down map keeps world axes aligned to screen axes.)
#: Sun low enough to model relief, high enough that shadows do not swallow the ground.
SUN_ELEV_DEG = 38.0
SUN_AZIMUTH_DEG = 145.0

SAMPLES = 96


# ---------------------------------------------------------------- svg geometry

def _svg_text():
    with open(SVG) as fh:
        return fh.read()


def region_polygon(region_id):
    """The boundary ring of `region-<id>`, as [(x, y), ...] in SVG units.

    Reads the first path inside the region's group. The groups are authored
    outline-first, and `class="region-outline"` marks it, so prefer that when present.
    """
    text = _svg_text()
    m = re.search(rf'<g id="region-{region_id}"[^>]*>(.*?)</g>', text, re.S)
    if not m:
        raise SystemExit(f"no group id=region-{region_id} in {SVG}")
    body = m.group(1)
    paths = re.findall(r'<path[^>]*\bd="([^"]+)"[^>]*>', body)
    outlined = re.findall(r'<path[^>]*class="region-outline"[^>]*\bd="([^"]+)"[^>]*>', body)
    d = (outlined or paths)[0]
    pts = []
    for xs, ys in re.findall(r'([-\d.]+),([-\d.]+)', d):
        pts.append((float(xs), float(ys)))
    if len(pts) < 3:
        raise SystemExit(f"region-{region_id}: parsed only {len(pts)} points from {d[:60]}")
    return pts


def to_world(x, y):
    """SVG (x, y) -> Blender (X, Y). Y flips because SVG grows downward."""
    return (x - VIEW_W / 2.0, (VIEW_H / 2.0) - y)


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


# ------------------------------------------------------------------- materials

def flat(name, colour_key, roughness=0.85):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = palette_linear(colour_key)
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.2
    return mat


# --------------------------------------------------------------------- geometry

def polygon_slab(name, poly, z0, z1, material):
    """A closed polygon extruded between two heights, as one mesh."""
    verts = [Vector((*to_world(x, y), z0)) for x, y in poly]
    verts += [Vector((*to_world(x, y), z1)) for x, y in poly]
    n = len(poly)
    faces = [list(range(n, 2 * n))]                       # top
    faces.append(list(reversed(range(n))))                # bottom
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, j + n, i + n])                # walls
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.validate()
    ob = bpy.data.objects.new(name, mesh)
    ob.data.materials.append(material)
    bpy.context.collection.objects.link(ob)
    return ob


def rng_from(seed):
    """A tiny deterministic stream, so a re-render is byte-identical.

    Same reasoning as the sim's seeded per-entity PRNG: art that shuffles between renders
    makes every diff unreviewable.
    """
    state = seed & 0xFFFFFFFF

    def rnd():
        nonlocal state
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        return state / float(0x7FFFFFFF)

    return rnd


def inset(poly, d):
    """Shrink a polygon by pulling every vertex `d` toward its centroid.

    Crude but sufficient for a convex-ish coastline, and its purpose is narrow: keep the
    undulating floor away from the region's edge so the floor's own blocky boundary never
    becomes the silhouette.
    """
    cx = sum(x for x, _ in poly) / len(poly)
    cy = sum(y for _, y in poly) / len(poly)
    out = []
    for x, y in poly:
        vx, vy = x - cx, y - cy
        L = math.hypot(vx, vy) or 1.0
        out.append((x - vx / L * d, y - vy / L * d))
    return out


def desert_ground(name, poly, seed, material, step=6.0, relief=1.4, floor_z=4.4, edge=9.0):
    """The region's floor as undulating desert rather than a flat slab.

    A grid over the polygon's bounding box, each vertex lifted by summed sines, keeping
    only the quads whose centre falls inside the polygon. At 8 degrees off vertical the
    height itself is nearly invisible -- what reads is the shading across the slopes, which
    is why the ground needs relief at all rather than being one flat tone.
    """
    # The floor is laid inside an inset ring, so the flat plinth shows as a thin shore and
    # the floor's stepped boundary sits away from the coastline. At 2.6 units of relief its
    # edge was a visible cliff with its own shadow; 1.4 plus the inset makes it disappear.
    poly = inset(poly, edge)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    nx = max(2, int((x1 - x0) / step) + 1)
    ny = max(2, int((y1 - y0) / step) + 1)
    rnd = rng_from(seed)
    ph = [rnd() * 6.28 for _ in range(6)]

    def height(x, y):
        return (
            relief * 0.55 * math.sin(x * 0.055 + ph[0]) * math.cos(y * 0.048 + ph[1])
            + relief * 0.30 * math.sin(x * 0.130 + ph[2]) * math.cos(y * 0.115 + ph[3])
            + relief * 0.15 * math.sin(x * 0.290 + ph[4]) * math.cos(y * 0.260 + ph[5])
        )

    verts, index = [], {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = x0 + i * step
            y = y0 + j * step
            index[(i, j)] = len(verts)
            wx, wy = to_world(x, y)
            # + relief keeps the minimum at floor_z, so the plinth never shows through.
            verts.append((wx, wy, floor_z + relief + height(x, y)))

    faces = []
    for j in range(ny):
        for i in range(nx):
            # All four corners, not the centre: a centre test leaves half-quads hanging
            # over the coast and the region's edge stair-steps at 6-unit intervals, which
            # reads as a pixelated coastline. Strictly-inside quads let the plinth's clean
            # polygon rim form the silhouette instead.
            gx, gy = x0 + i * step, y0 + j * step
            if not all(point_in_poly(cx, cy, poly) for cx, cy in
                       ((gx, gy), (gx + step, gy), (gx, gy + step), (gx + step, gy + step))):
                continue
            faces.append([index[(i, j)], index[(i + 1, j)], index[(i + 1, j + 1)], index[(i, j + 1)]])

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    ob = bpy.data.objects.new(name, mesh)
    ob.data.materials.append(material)
    bpy.context.collection.objects.link(ob)
    return len(faces)


def scatter_low_buildings(poly, seed, mats, spacing=26.0, density=0.42):
    """Sparse, low, irregular structures on the desert floor.

    Deliberately not a packed grid. `spacing` sets the lattice, `density` how many cells
    are actually built on, and each footprint is jittered off its cell and varied in size,
    so no two rows line up. Heights are low -- one to two storeys against a 26-unit
    lattice -- because what should read from above is desert with settlement on it, not a
    city that happens to be beige.
    """
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    rnd = rng_from(seed)
    made = 0
    y = min(ys)
    while y < max(ys):
        x = min(xs)
        while x < max(xs):
            if rnd() < density:
                w = 6.0 + rnd() * 6.0
                d = 6.0 + rnd() * 6.0
                jx = x + rnd() * (spacing - w)
                jy = y + rnd() * (spacing - d)
                corners = [(jx, jy), (jx + w, jy), (jx, jy + d), (jx + w, jy + d)]
                if all(point_in_poly(cx, cy, poly) for cx, cy in corners):
                    h = 3.0 + rnd() * 3.5
                    mat = mats[int(rnd() * len(mats)) % len(mats)]
                    quad = [(jx, jy), (jx + w, jy), (jx + w, jy + d), (jx, jy + d)]
                    polygon_slab(f"bld_{made:04d}", quad, 4.4, 4.4 + h, mat)
                    made += 1
            x += spacing
        y += spacing
    return made


def scatter_dunes(poly, seed, material, spacing=17.0, density=0.55, edge=11.0):
    """Low dune mounds as interior islands, never touching the region's edge.

    This replaced a raised undulating floor grid. That grid gave the desert its relief but
    also gave it a *boundary*, stepped at the grid pitch, which sat a couple of units above
    the surrounding plinth and drew a stair-stepped shadow line down the coast -- visible
    even at the 170px the region occupies on the page. Insetting it and flattening the
    relief reduced the line without removing it, because the cliff is inherent to having an
    edge at all. Islands have no edge to catch the light.
    """
    ring_poly = inset(poly, edge)
    xs, ys = [p[0] for p in ring_poly], [p[1] for p in ring_poly]
    rnd = rng_from(seed)
    made = 0
    y = min(ys)
    while y < max(ys):
        x = min(xs)
        while x < max(xs):
            if rnd() < density:
                # Elongated and rotated, so they read as wind-blown rather than as blobs.
                rx = 5.0 + rnd() * 7.0
                ry = rx * (0.42 + rnd() * 0.4)
                rot = rnd() * math.pi
                cx, cy = x + rnd() * spacing, y + rnd() * spacing
                ring = []
                for k in range(8):
                    a = k * math.pi / 4.0
                    px_ = rx * math.cos(a)
                    py_ = ry * math.sin(a)
                    ring.append((cx + px_ * math.cos(rot) - py_ * math.sin(rot),
                                 cy + px_ * math.sin(rot) + py_ * math.cos(rot)))
                if all(point_in_poly(qx, qy, ring_poly) for qx, qy in ring):
                    # Deliberately shallow. At 1.1-2.7 units each mound threw a hard crescent of
                    # shadow and the field read as fish scales; at 0.4-1.1 the same mounds read
                    # as wind ripples, which is what desert seen from above actually looks like.
                    polygon_slab(f"dune_{made:04d}", ring, 4.4, 4.4 + 0.4 + rnd() * 0.7, material)
                    made += 1
            x += spacing
        y += spacing
    return made


def scatter_scrub(poly, seed, material, spacing=22.0, density=0.26, rmin=2.2, rspan=2.6,
                  sides=6):
    """Low desert scrub: flat pads, no height. Breaks the ground's tonal uniformity."""
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    rnd = rng_from(seed)
    made = 0
    y = min(ys)
    while y < max(ys):
        x = min(xs)
        while x < max(xs):
            if rnd() < density:
                r = rmin + rnd() * rspan
                cx, cy = x + rnd() * spacing, y + rnd() * spacing
                if point_in_poly(cx, cy, poly):
                    # Side count matters with size: a hexagon reads as a dot at radius 2
                    # and unmistakably as a hexagon at radius 18, which is what Kedem's
                    # groves looked like on the first pass.
                    ring = [(cx + r * math.cos(2.0 * math.pi * k / sides),
                             cy + r * math.sin(2.0 * math.pi * k / sides))
                            for k in range(sides)]
                    polygon_slab(f"scrub_{made:04d}", ring, 4.4, 4.85, material)
                    made += 1
            x += spacing
        y += spacing
    return made


# ----------------------------------------------------------------------- scene

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


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
    # Frame the long axis exactly; the sensor fit keeps the short axis proportional.
    cam_data.ortho_scale = VIEW_W
    # The camera stands 2000 units off to keep the projection clean, and Blender's default
    # far clip is 100 -- so without this every polygon sits beyond the clip plane and the
    # render comes out fully transparent with no error of any kind.
    cam_data.clip_start = 1.0
    cam_data.clip_end = 6000.0
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam

    # A camera at euler (0,0,0) looks straight down -Z with +Y up, which is exactly the
    # mapping this map wants: world +X to screen right, world +Y to screen up. Tilting
    # about X alone preserves it. Deriving the orientation by "look at the origin" instead
    # -- which the first version did -- leaves the roll unconstrained, so the world axes
    # arrive on screen rotated and the whole basin lands somewhere unintended.
    tilt = math.radians(CAM_TILT_DEG)
    height = 2000.0
    cam.location = (0.0, -height * math.tan(tilt), height)
    cam.rotation_euler = (tilt, 0.0, 0.0)
    # Tilting foreshortens the north-south axis by cos(tilt); at 8 degrees that is 0.99,
    # which is under a pixel over the whole frame and is why the towns still register.


    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.1
    sun_data.angle = math.radians(2.0)
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    se, sa = math.radians(SUN_ELEV_DEG), math.radians(SUN_AZIMUTH_DEG)
    sun.location = (900 * math.cos(se) * math.cos(sa), 900 * math.cos(se) * math.sin(sa), 900 * math.sin(se))
    sun.rotation_euler = (Vector((0, 0, 0)) - Vector(sun.location)).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = palette_linear("water.0")
    bg.inputs["Strength"].default_value = 0.35
    bpy.context.scene.world = world
    return cam


# ---------------------------------------------------------------------- layers

def build_marj():
    """The Marj Strip: low settlement scattered over coastal desert.

    Ground first and buildings second, by area and by intent. An earlier pass packed 163
    tall blocks edge to edge and read as a checkerboard rather than a place -- at the size
    this occupies on screen, roughly 50 by 200 pixels, dense uniform detail collapses into
    noise while open terrain with sparse relief still reads.
    """
    poly = region_polygon("marj")
    sand = flat("marj_sand", "dust.2", roughness=0.96)
    walls = [
        flat("wall_a", "limestone.2"),
        flat("wall_b", "limestone.3"),
        flat("wall_c", "limestone.4"),
        flat("wall_d", "dust.1"),
        flat("roof_terracotta", "terracotta.0"),
    ]
    scrub_mat = flat("marj_scrub", "scrub.1", roughness=0.98)

    # A thin plinth so the coastline still reads as a hard edge against the sea, with the
    # undulating desert floor laid over it.
    polygon_slab("marj_plinth", poly, 0.0, 4.4, sand)
    dunes = scatter_dunes(poly, seed=0x0DE5, material=sand)
    scrub = scatter_scrub(poly, seed=0x5C2B, material=scrub_mat)
    n = scatter_low_buildings(poly, seed=0x5A4A, mats=walls)
    print(f"marj: {dunes} dunes, {scrub} scrub, {n} low buildings")
    return n


def settlement_near(points, seed, mats, radius=44.0, spacing=13.0, density=0.5, ring=None):
    """Low buildings clustered around given town positions, at the Marj's own footprint.

    Sur was rendered with ridges and nothing else, so its two towns were labels on bare
    rock while Beit Sahwan sat in visible settlement -- the same world at two different
    levels of detail. Footprint and height here are deliberately identical to
    scatter_low_buildings: a house in the mountains is the same size as a house on the
    coast, and anything else makes the regions read as different zoom levels.
    """
    rnd = rng_from(seed)
    made = 0
    for tx, ty in points:
        y = ty - radius
        while y < ty + radius:
            x = tx - radius
            while x < tx + radius:
                if math.dist((x, y), (tx, ty)) <= radius and rnd() < density:
                    w = 6.0 + rnd() * 6.0
                    d = 6.0 + rnd() * 6.0
                    h = 3.0 + rnd() * 3.5
                    quad = [(x, y), (x + w, y), (x + w, y + d), (x, y + d)]
                    if ring is None or all(point_in_poly(qx, qy, ring) for qx, qy in quad):
                        polygon_slab(f"twn_{made:04d}", quad, 4.4, 4.4 + h, mats[int(rnd() * len(mats)) % len(mats)])
                        made += 1
                x += spacing
            y += spacing
    return made


def scatter_ridges(poly, seed, rock, cap, spacing=13.0, density=0.9, edge=11.0):
    """Mountain ridges: tall, elongated, roughly parallel mounds with lit crests.

    Sur's whole identity is a wall you cannot climb, and from near-vertical a wall reads
    only through its shadow. So these are much taller than the Marj's dunes (18-34 against
    0.4-1.1) and share a common bearing, so the shadows line up into ranges instead of
    scattering into lumps. A second, smaller cap slab sits on each crest to catch the sun.
    """
    ring = inset(poly, edge)
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    rnd = rng_from(seed)
    made = 0
    y = min(ys)
    while y < max(ys):
        x = min(xs)
        while x < max(xs):
            if rnd() < density:
                # Long and overlapping at a shared bearing, so neighbours merge into ranges.
                # Discrete stubby mounds read as scattered boulders, not as a wall.
                rx = 11.0 + rnd() * 9.0
                ry = rx * (0.26 + rnd() * 0.18)
                # A shared bearing with only a little scatter: a range, not a rash.
                rot = math.radians(-14.0) + (rnd() - 0.5) * 0.5
                cx, cy = x + rnd() * spacing, y + rnd() * spacing
                h = 7.0 + rnd() * 7.0

                def ellipse(fx, fy):
                    out = []
                    for k in range(10):
                        a = k * math.pi / 5.0
                        ex, ey = rx * fx * math.cos(a), ry * fy * math.sin(a)
                        out.append((cx + ex * math.cos(rot) - ey * math.sin(rot),
                                    cy + ex * math.sin(rot) + ey * math.cos(rot)))
                    return out

                base = ellipse(1.0, 1.0)
                # Centre-only test: requiring every vertex inside kept ridges away from the
                # boundary and left the range floating in the middle of the region.
                if point_in_poly(cx, cy, ring):
                    polygon_slab(f"ridge_{made:04d}", base, 4.4, 4.4 + h, rock)
                    # No lit crest slab. At 8 degrees off vertical a small pale cap on a dark
                    # mound renders as a white dot, and thirteen of them read as insects. The
                    # sun on the ridge's own flank does this job properly.
                    made += 1
            x += spacing
        y += spacing
    return made


def river_channel(seed, material):
    """The river along the Kedem/Naharin border, as a low water ribbon.

    Traced from the same curve the SVG draws so the two cannot disagree, sampled into a
    quad strip. It reads at this scale because water is the only cool tone on the map.
    """
    pts = [(816, 368), (842, 414), (838, 462), (796, 470), (826, 522), (800, 558), (724, 556)]
    made = 0
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L * 4.5, dx / L * 4.5
        quad = [(x1 + nx, y1 + ny), (x2 + nx, y2 + ny), (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)]
        polygon_slab(f"river_{i:02d}", quad, 4.4, 4.9, material)
        made += 1
    return made


def build_sur():
    """Sur: a mountain wall, with the two towns tucked among the ridges."""
    poly = region_polygon("sur")
    stone = flat("sur_stone", "limestone.4", roughness=0.92)
    rock = flat("sur_rock", "gunmetal.1", roughness=0.86)
    cap = flat("sur_cap", "limestone.0", roughness=0.7)
    scrub_mat = flat("sur_scrub", "scrub.1", roughness=0.98)
    polygon_slab("sur_plinth", poly, 0.0, 4.4, stone)
    n = scatter_ridges(poly, seed=0x5124, rock=rock, cap=cap)
    scrub = scatter_scrub(poly, seed=0x5125, material=scrub_mat, spacing=30.0, density=0.18)
    # Read the town positions from world.json rather than repeating them, so settlement
    # cannot drift away from the markers the shell draws on top of it.
    towns = [tuple(t["at"]) for r in json.loads(pathlib.Path(
        os.path.join(ROOT, "data", "campaign", "world.json")).read_text())["regions"]
        if r["id"] == "sur" for t in r["towns"]]
    walls = [flat("sur_wall_a", "limestone.2"), flat("sur_wall_b", "limestone.3"),
             flat("sur_wall_c", "limestone.4"), flat("sur_roof", "terracotta.0")]
    b = settlement_near(towns, seed=0x5126, mats=walls, ring=poly)
    print(f"sur: {n} ridges, {scrub} scrub, {b} buildings at {len(towns)} towns")
    return n


def build_naharin():
    """Naharin: open dune desert across the river, coarser-grained than the Marj."""
    poly = region_polygon("naharin")
    sand = flat("nah_sand", "dust.3", roughness=0.96)
    pale = flat("nah_pale", "dust.2", roughness=0.96)
    water = flat("nah_water", "water.0", roughness=0.15)
    polygon_slab("nah_plinth", poly, 0.0, 4.4, sand)
    # Bigger, sparser dunes than the Marj's: open desert rather than a settled shelf.
    dunes = scatter_dunes(poly, seed=0x4A17, material=pale, spacing=30.0, density=0.7, edge=13.0)
    riv = river_channel(0x4A18, water)
    print(f"naharin: {dunes} dunes, {riv} river segments")
    return dunes


def build_base():
    """Sea, Kedem's plain, and the groves on it. Everything not owned by a region."""
    sea = flat("sea", "water.1", roughness=0.12)
    plain = flat("kedem_plain", "limestone.1", roughness=0.94)
    grove = flat("kedem_grove", "olive.1", roughness=0.97)
    coast = [(0, 0), (104, 0), (92, 120), (104, 296), (78, 434), (88, 540), (124, 592),
             (108, 700), (96, 790), (0, 790)]
    polygon_slab("sea", coast, 0.0, 3.9, sea)
    kedem = [(212, 372), (200, 298), (156, 264), (182, 204), (272, 168), (404, 148), (564, 156),
             (704, 194), (790, 266), (816, 368), (796, 470), (724, 556), (600, 606), (444, 614),
             (304, 590), (200, 470)]
    polygon_slab("kedem", kedem, 0.0, 4.4, plain)
    groves = scatter_scrub(kedem, seed=0x6EDE, material=grove, spacing=74.0,
                           density=0.5, rmin=9.0, rspan=9.0, sides=14)
    print(f"base: sea + kedem plain + {groves} groves")
    return groves


BUILDERS = {"marj": build_marj, "sur": build_sur, "naharin": build_naharin, "base": build_base}

#: Which palette ramps each layer may be snapped to.
#:
#: Not a formality. Snapping to the nearest entry across the whole palette assumes the
#: palette covers the render's tones densely enough to preserve hue, and it does not: the
#: neutral greys are four `gunmetal` entries while the greens sit closer in RGB distance,
#: so Sur's lit rock snapped to `scrub.0` and the mountains came out bright green over
#: 92k pixels. Each layer therefore declares the ramps its subject is made of.
ALLOW = {
    "marj": ["dust", "limestone", "terracotta", "scrub", "shadow"],
    "sur": ["gunmetal", "limestone", "terracotta", "shadow"],
    "naharin": ["dust", "limestone", "water", "shadow"],
    "base": ["limestone", "water", "olive", "scrub", "shadow"],
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    which = argv[0] if argv else "marj"
    if which not in BUILDERS:
        raise SystemExit(f"unknown layer {which!r}; have {sorted(BUILDERS)}")

    clear()
    camera_and_light()
    BUILDERS[which]()

    out = os.path.join(OUT_DIR, f"layer_{which}.png")
    bpy.context.scene.render.filepath = out
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    print(f"wrote {out} at {RES_X}x{RES_Y}")

    # Quantizing cannot happen in here: Blender's bundled Python has no Pillow. So print
    # the exact follow-up rather than leaving the right --allow set to memory -- getting it
    # wrong is not a small error, it is green mountains.
    print(f"NEXT: python3 tools/quantize_sprites.py --file {out} "
          f"--allow {','.join(ALLOW[which])}")

    blend = os.path.join(ROOT, "art", "src", "campaign", "sahar_basin.blend")
    os.makedirs(os.path.dirname(blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"saved {blend}")


if __name__ == "__main__":
    main()
