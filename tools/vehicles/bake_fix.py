"""Texel passes over a Meshy bake, shared by the vehicle exporters
(`export_meshy_apc.py`, `export_meshy_ramp.py`) -- A3.2 phase 2 (GH-185,
2026-10-11, the lead's "fleet olive" and "metal texel" rulings).

Two operations, both pure numpy over `bpy.data.images` buffers, both
deterministic (no RNG, no `mathutils.noise`), both recorded per vehicle in
`docs/ASSET_PROVENANCE.md`:

`band_shift` -- the generic form of `export_meshy_ramp.py`'s `olive_shift`
and `sand_olive`: every texel whose HSV saturation is above `sat_min` and
whose hue lies in [`hue_lo`, `hue_hi`] is moved by `hue_shift` degrees and
has its saturation and value multiplied. Greys and blacks (tyres, fittings,
lenses) sit under the saturation gate and are untouched. The numbers come
from measuring the bake against the reference bake (the Kipod's: hue 70.2 /
sat 0.427 / val 0.361 over its paint band, `bake_probe.py`, 2026-10-11),
never from taste.

`paint_metal_patch` -- a flat gunmetal square painted into UV space that NO
face maps to: `gunmetal.2` (#5C625F, the tone `rampForVehicleRole('metal')`
lifts to, so the kit's steel matches the palette weapon station on the same
hull) in `base_color`, a neutral (0.5, 0.5, 1.0) normal, metallic
`METAL_METALLIC` (0.0 since the GH-238 leftovers, 2026-10-12; 1.0 before) /
roughness 0.6 in `metallic_roughness`. The kit exporter
(`export_vehicle_kit.py`, `choose_tones`) pins every SENSORS and FIREPOWER
face to it, so kit metal reads as metal instead of "the greyest paint" (the
third-rule DEVIATION the five uniform-metallic bakes printed until now).
The block is PATCH px square inside a GUARD-texel margin that no live or kit
face touches, 8-aligned so JPEG's 8x8 DCT blocks inside it stay flat (the
kit exporter requires a 16x16 window with luminance spread < 0.02 linear),
and it is the FIRST such block in scan order, so a re-export lands it on the
same texels. It costs 0 bytes of geometry and 0 bytes of texture: the maps
are the same size they were.
"""
import numpy as np

#: The patch's edge, and the empty margin it must have on every side.
PATCH = 32
GUARD = 4
#: gunmetal.2 -- `liftTone(rampForVehicleRole(id, 'metal'))` for every
#: shipped vehicle (tools/src/portrait-roles.ts), as sRGB-encoded bytes.
METAL_HEX = "#5C625F"
METAL_ROUGHNESS = 0.6
#: DIELECTRIC, on purpose. The patch shipped metallic 1.0 on 2026-10-11 and
#: drew near-black in the game: a vehicle material has `envMapIntensity = 0`
#: and the scene no environment (`packages/render/src/three/world-materials.ts`),
#: so a fully metallic texel keeps NO diffuse term and is lit by the sun's
#: specular lobe alone. Measured in game (`pnpm kit:capture -- --measure`,
#: zoom 2.5, sensors + firepower kit pixels, mean linear luminance, metallic
#: 1.0 -> 0.0): Namer 0.046 -> 0.055, Eitan 0.027 -> 0.038, Kipod 0.027 ->
#: 0.035, Shachaf 0.024 -> 0.036, D9 0.010 -> 0.029 -- the masts and sensor
#: heads go from near-black to gunmetal grey. Blender's sheets light it with a world
#: hemisphere, which a metal reflects, which is why they looked right. As a
#: dielectric the texel draws its own gunmetal.2 albedo under the sun and the
#: hemisphere, the same way the palette weapon station beside it does. The
#: kit exporter finds the patch by its COLOUR off every island, not by this
#: flag (`export_vehicle_kit.choose_tones`).
METAL_METALLIC = 0.0


def _hsv(rgb):
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    d = np.maximum(mx - mn, 1e-6)
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6.0,
                   np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0)) * 60.0
    return hue, sat, mx


def _rgb(hue, sat, val):
    c = val * sat
    hp = (hue % 360.0) / 60.0
    x = c * (1.0 - np.abs(hp % 2.0 - 1.0))
    m = val - c
    z = np.zeros_like(c)
    i = hp.astype(np.int32) % 6
    sel = [i == 0, i == 1, i == 2, i == 3, i == 4, i == 5]
    r = np.select(sel, [c, x, z, z, x, c]) + m
    g = np.select(sel, [x, c, c, x, z, z]) + m
    b = np.select(sel, [z, z, x, c, c, x]) + m
    return r, g, b


def band_shift(rgb, sat_min, hue_lo, hue_hi, hue_shift, sat_mul, val_mul, mask=None):
    """In place on an (h, w, 3) float array; returns the band's texel count.
    `mask` (h, w) restricts the band to those texels -- a role's own UV
    islands, for a pass that must not reach the rest of the bake."""
    hue, sat, val = _hsv(rgb)
    band = (sat > sat_min) & (hue > hue_lo) & (hue < hue_hi)
    if mask is not None:
        band &= mask
    r2, g2, b2 = _rgb(np.where(band, hue + hue_shift, hue),
                      np.where(band, sat * sat_mul, sat),
                      np.where(band, val * val_mul, val))
    rgb[..., 0] = np.where(band, r2, rgb[..., 0])
    rgb[..., 1] = np.where(band, g2, rgb[..., 1])
    rgb[..., 2] = np.where(band, b2, rgb[..., 2])
    np.clip(rgb, 0.0, 1.0, out=rgb)
    return int(band.sum())


def band_shift_image(img, label, mask=None, **kw):
    """`band_shift` over a Blender image's own buffer."""
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, img.channels)
    n = band_shift(px[..., :3], mask=mask, **kw)
    img.pixels.foreach_set(px.ravel())
    img.update()
    print(f"[{label}] band_shift{' (masked)' if mask is not None else ''}: {n} texels ({100.0 * n / (w * h):.1f}%) in hue "
          f"{kw['hue_lo']}..{kw['hue_hi']} / sat > {kw['sat_min']} moved by {kw['hue_shift']:+.0f} deg, "
          f"sat x{kw['sat_mul']}, value x{kw['val_mul']}")
    return n


def colour_balance_image(img, mul, label):
    """Multiply every texel by `mul` (r, g, b), clipped -- a warm or cool
    pass that is honest on greys, where a hue rotation is noise."""
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, img.channels)
    px[..., :3] = np.clip(px[..., :3] * np.array(mul, dtype=np.float32), 0.0, 1.0)
    img.pixels.foreach_set(px.ravel())
    img.update()
    print(f"[{label}] colour_balance: every texel x {tuple(mul)}")


def raster_tri(mask, p):
    """OR the texels whose centres lie inside UV triangle `p` ((3, 2) in
    texel units) into `mask` -- `export_vehicle_kit.coverage`'s rasteriser."""
    h, w = mask.shape
    x0, y0 = np.floor(p.min(axis=0)).astype(int)
    x1, y1 = np.ceil(p.max(axis=0)).astype(int)
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, w - 1), min(y1, h - 1)
    if x1 < x0 or y1 < y0:
        return
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    a, b, c = p
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-12:
        return
    l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
    l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
    l3 = 1.0 - l1 - l2
    mask[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)


def uv_coverage(objs, w, h):
    """Texels inside the UV triangles of `objs`' faces (pixel centres),
    kept here so an exporter does not import the kit module."""
    mask = np.zeros((h, w), dtype=bool)
    for o in objs:
        me = o.data
        if me.uv_layers.active is None:
            continue
        me.calc_loop_triangles()
        uv = me.uv_layers.active.data
        for tri in me.loop_triangles:
            raster_tri(mask, np.array([(uv[li].uv[0] * w, uv[li].uv[1] * h) for li in tri.loops], dtype=np.float64))
    return mask


def paint_patch_arrays(images, x, y, scale_from):
    """The patch's pixels into plain uint8 arrays: `images` is
    {name: (h, w, c) uint8}, `(x, y)` the block on the `scale_from`
    (w, h) grid. Returns the names painted. The glTF side of
    `paint_metal_patch`, for a file whose Meshy source is no longer on disk
    (`patch_metal_glb.py`)."""
    w0, h0 = scale_from
    rgb = tuple(int(round(c * 255)) for c in _hex_bytes(METAL_HEX))
    painted = []
    for name, arr in images.items():
        ih, iw = arr.shape[:2]
        sx, sy = iw / w0, ih / h0
        x0, y0 = int(round(x * sx)), int(round(y * sy))
        x1, y1 = int(round((x + PATCH) * sx)), int(round((y + PATCH) * sy))
        if name == "base_color":
            arr[y0:y1, x0:x1, :3] = rgb
        elif name.startswith("normal"):
            arr[y0:y1, x0:x1, :3] = (128, 128, 255)
        elif name.startswith("metallic_roughness"):
            arr[y0:y1, x0:x1, 1] = int(round(METAL_ROUGHNESS * 255))
            arr[y0:y1, x0:x1, 2] = int(round(METAL_METALLIC * 255))
        else:
            continue
        painted.append(f"{name} [{x0}:{x1},{y0}:{y1}]")
    return painted


def find_patch_block(mask, size=PATCH, guard=GUARD):
    """(x, y) of the first `size`-square block, 8-aligned, whose `guard`
    margin on every side is also free of `mask`, in scan order; None if the
    atlas has no such hole."""
    h, w = mask.shape
    span = size + 2 * guard
    for y in range(0, h - span + 1, 8):
        for x in range(0, w - span + 1, 8):
            if not mask[y:y + span, x:x + span].any():
                return x + guard, y + guard
    return None


def _hex_bytes(hexv):
    return tuple(int(hexv[i:i + 2], 16) / 255.0 for i in (1, 3, 5))


def paint_metal_patch(obj, base_img, label):
    """Paint the patch into `base_img` (and the `normal` / `metallic_roughness`
    images beside it, at their own resolutions) in a hole of `obj`'s UV
    atlas. Returns {"texel": (x, y), "uv": (u, v)} on the base image's
    grid; raises if the atlas has no hole."""
    import bpy
    w, h = base_img.size
    cov = uv_coverage([obj], w, h)
    at = find_patch_block(cov)
    if at is None:
        raise SystemExit(f"[{label}] metal patch: no {PATCH + 2 * GUARD}-texel hole in the {w}x{h} UV atlas")
    x, y = at
    rgb = _hex_bytes(METAL_HEX)
    painted = []
    for img in bpy.data.images:
        if tuple(img.size) == (0, 0):
            continue
        iw, ih = img.size
        sx, sy = iw / w, ih / h
        x0, y0 = int(round(x * sx)), int(round(y * sy))
        x1, y1 = int(round((x + PATCH) * sx)), int(round((y + PATCH) * sy))
        px = np.empty(iw * ih * img.channels, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(ih, iw, img.channels)
        if img.name == base_img.name:
            px[y0:y1, x0:x1, 0] = rgb[0]
            px[y0:y1, x0:x1, 1] = rgb[1]
            px[y0:y1, x0:x1, 2] = rgb[2]
        elif img.name.startswith("normal"):
            px[y0:y1, x0:x1, 0] = 0.5
            px[y0:y1, x0:x1, 1] = 0.5
            px[y0:y1, x0:x1, 2] = 1.0
        elif img.name.startswith("metallic_roughness"):
            # glTF packs roughness in G and metallic in B.
            px[y0:y1, x0:x1, 1] = METAL_ROUGHNESS
            px[y0:y1, x0:x1, 2] = METAL_METALLIC
        else:
            continue
        if img.channels == 4:
            px[y0:y1, x0:x1, 3] = 1.0
        img.pixels.foreach_set(px.ravel())
        img.update()
        painted.append(f"{img.name} [{x0}:{x1},{y0}:{y1}]")
    uv = ((x + PATCH / 2.0) / w, (y + PATCH / 2.0) / h)
    print(f"[{label}] metal patch: {PATCH}x{PATCH} {METAL_HEX} at texel ({x}, {y}) of {w}x{h}, "
          f"uv ({uv[0]:.5f}, {uv[1]:.5f}), guard {GUARD}; painted {', '.join(painted)}; "
          f"atlas coverage {100.0 * cov.mean():.1f}%")
    return {"texel": (x, y), "uv": uv}
