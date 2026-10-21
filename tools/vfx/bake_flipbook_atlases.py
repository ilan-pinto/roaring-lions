"""Bake the fire and smoke flipbook atlases (Defilade T4, decision D7).

Provenance: PROCEDURAL. Every texel is computed below from a hand-rolled
integer-hash 3D value noise; nothing is AI-generated, scanned or taken from a
pack, and no Meshy credit was spent. The script runs under Blender's bundled
Python (numpy) and touches no `bpy` scene at all -- it is "Blender-baked" in
the sense that Blender is the pinned interpreter:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/vfx/bake_flipbook_atlases.py -- --out assets/textures/vfx

(Any Python 3 with numpy produces the same bytes: `python3 <script> --out ...`.)

Determinism: no `mathutils.noise` (randomised per process in Blender 5.2), no
`random`, no clock. The PNG is written by hand (fixed filter choice, zlib level
9, no timestamp chunk), so two runs are byte-identical.

Layout (both atlases): 1024x1024 RGBA, 8-bit, 8x8 frames of 128 px. Frame k is
row-major from the TOP-LEFT and shows life fraction t = k/63.

Channels:
  R  density: the projected opacity 1 - exp(-tau) of the billow, 0..1.
  G  dR/dx  (screen +x = right),  encoded 0.5 + 0.5 * clamp(g / GRAD_SCALE, -1, 1)
  B  dR/dy  (screen +y = UP, toward the frame's top edge), same encoding.
     Gradients are per unit of frame half-width (the frame spans [-1, 1]), so a
     shader recovers grad = (GB * 2 - 1) * GRAD_SCALE and shades from
     dot(grad, sunDir).
  A  fire: the hot-core mask (optical depth of the dense core) times a cooling
     curve, so it is high early and gone by mid-life.
     smoke: a soft interior term (1 at the dense middle, falling to 0 at the rim).
  NOTE for the loader: A is DATA, not alpha. Load with premultiplyAlpha off
  (and NoColorSpace), or a browser that premultiplies loses R/G/B where A = 0.

Every frame is windowed to exactly zero over its outermost 3 px, so no frame
bleeds into its neighbour under bilinear filtering.
"""

import argparse
import os
import struct
import sys
import zlib

import numpy as np

FRAME = 128
GRID = 8
FRAMES = GRID * GRID
DEPTH = 40  # ray-march samples along the (orthographic) view axis
GRAD_SCALE = 4.0
OCTAVES = 5

FIRE_SEED = 0x51F1
SMOKE_SEED = 0x5E0C


# ---------------------------------------------------------------- noise ----

def _hash3(ix, iy, iz, seed):
    """Integer hash of lattice coords -> float in [0, 1). uint32 wraparound."""
    m = np.uint64(0xFFFFFFFF)
    x = ix.astype(np.int64).astype(np.uint64) & m
    y = iy.astype(np.int64).astype(np.uint64) & m
    z = iz.astype(np.int64).astype(np.uint64) & m
    h = (x * np.uint64(73856093)) ^ (y * np.uint64(19349663)) ^ (z * np.uint64(83492791))
    h = (h ^ np.uint64(seed)) & m
    h = (h ^ (h >> np.uint64(13))) & m
    h = (h * np.uint64(1274126177)) & m
    h = (h ^ (h >> np.uint64(16))) & m
    h = (h * np.uint64(2246822519)) & m
    h = (h ^ (h >> np.uint64(13))) & m
    return (h & np.uint64(0xFFFFFF)).astype(np.float64) / float(0x1000000)


def _smooth(f):
    return f * f * (3.0 - 2.0 * f)


def value_noise(px, py, pz, seed):
    ix = np.floor(px)
    iy = np.floor(py)
    iz = np.floor(pz)
    fx = _smooth(px - ix)
    fy = _smooth(py - iy)
    fz = _smooth(pz - iz)
    ix = ix.astype(np.int64)
    iy = iy.astype(np.int64)
    iz = iz.astype(np.int64)

    def h(dx, dy, dz):
        return _hash3(ix + dx, iy + dy, iz + dz, seed)

    x00 = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * fx
    x10 = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * fx
    x01 = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * fx
    x11 = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * fx
    y0 = x00 + (x10 - x00) * fy
    y1 = x01 + (x11 - x01) * fy
    return y0 + (y1 - y0) * fz


def fbm(px, py, pz, seed, octaves=OCTAVES):
    total = np.zeros_like(px)
    amp = 0.5
    norm = 0.0
    freq = 1.0
    x, y, z = px, py, pz
    for o in range(octaves):
        total += amp * value_noise(x, y, z, seed + 101 * o)
        norm += amp
        amp *= 0.5
        # Rotate between octaves (a fixed orthonormal matrix, scaled by 2.03)
        # so the value-noise lattice never lines up across octaves and no
        # axis-aligned "boxy" artefact survives into the billow.
        x, y, z = (
            2.03 * (0.00 * x + 0.80 * y + 0.60 * z),
            2.03 * (-0.80 * x + 0.36 * y - 0.48 * z),
            2.03 * (-0.60 * x - 0.48 * y + 0.64 * z),
        )
    return total / norm


# --------------------------------------------------------------- shapes ----

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _grid():
    c = (np.arange(FRAME, dtype=np.float64) + 0.5) / FRAME * 2.0 - 1.0
    zc = (np.arange(DEPTH, dtype=np.float64) + 0.5) / DEPTH * 2.0 - 1.0
    # y is UP: row 0 is the top of the frame.
    y, x, z = np.meshgrid(-c, c, zc, indexing="ij")
    return x, y, z, 2.0 / DEPTH


X, Y, Z, DZ = _grid()
X2 = X[:, :, 0]
Y2 = Y[:, :, 0]
# Zero over the outermost 3 px of every frame (|coord| >= 1 - 6/128).
_EDGE = np.maximum(np.abs(X2), np.abs(Y2))
WINDOW = 1.0 - smoothstep(0.80, 1.0 - 6.0 / FRAME, _EDGE)


def fire_grow(t):
    return 1.0 - (1.0 - min(4.0 * t, 1.0)) ** 3


def fire_frame(t):
    """A fireball: fast growth, rolling billow, thins and breaks up late."""
    grow = fire_grow(t)
    radius = 0.30 + 0.42 * grow + 0.08 * t
    cy = -0.10 + 0.16 * t  # rises a little
    sx, sy, sz = X / radius, (Y - cy) / radius, Z / radius
    r = np.sqrt(sx * sx + sy * sy + sz * sz)
    # Noise in the ball's own frame (it expands WITH the ball) plus a slow
    # upward roll and churn, continuous in t so frames never pop.
    n = fbm(sx * 1.7 + 3.1, sy * 1.7 - 2.2 * t, sz * 1.7 + 1.3 * t, FIRE_SEED)
    shell = r + (0.5 - n) * (0.60 + 0.35 * t)
    raw = 1.0 - smoothstep(0.50, 1.0, shell)
    # Soft erosion threshold on the noise: the ball breaks into feathered lobes.
    erode = 0.10 + 0.40 * smoothstep(0.25, 1.0, t)
    dens = raw * smoothstep(erode, erode + 0.30, n) * (0.55 + 0.9 * n)
    tau = dens.sum(axis=2) * DZ * 3.2
    core_tau = (dens * smoothstep(0.55, 0.85, n + (1.0 - r) * 0.4)).sum(axis=2) * DZ * 3.2
    R = 1.0 - np.exp(-tau)
    cooling = 1.0 - smoothstep(0.0, 0.45, t)
    A = smoothstep(0.05, 0.9, 1.0 - np.exp(-core_tau)) * cooling
    return R, A


def smoke_frame(t):
    """Smoke: a slower, softer billow that spreads, drifts up and erodes away."""
    grow = 1.0 - (1.0 - t) ** 2
    radius = 0.66 + 0.24 * grow
    cy = -0.06 + 0.08 * t
    sx, sy, sz = X / radius, (Y - cy) / radius, Z / radius
    r = np.sqrt(sx * sx + sy * sy + sz * sz)
    # Fewer octaves than the fire: a soft billow, not a crisp one.
    n = fbm(sx * 1.5 - 0.7, sy * 1.5 - 1.1 * t, sz * 1.5 + 0.7 * t, SMOKE_SEED, octaves=4)
    shell = r + (0.5 - n) * 0.7
    raw = 1.0 - smoothstep(0.1, 1.0, shell)  # density falls all the way out: a soft rim
    # Erosion is a soft threshold on the noise, so late frames thin into
    # wisps with feathered (not cut) edges.
    erode = 0.15 + 0.38 * smoothstep(0.40, 1.0, t)
    dens = raw * smoothstep(erode, erode + 0.35, n) * (0.4 + 1.2 * n)
    tau = dens.sum(axis=2) * DZ * 3.0
    R = 1.0 - np.exp(-tau)
    A = smoothstep(0.0, 0.6, R)
    return R, A


def encode_frame(R, A):
    R = R * WINDOW
    A = A * WINDOW
    # np.gradient over rows runs DOWN the frame; flip sign so +B is up.
    d_row, d_col = np.gradient(R, 2.0 / FRAME)
    gx = d_col
    gy = -d_row
    G = 0.5 + 0.5 * np.clip(gx / GRAD_SCALE, -1.0, 1.0)
    B = 0.5 + 0.5 * np.clip(gy / GRAD_SCALE, -1.0, 1.0)
    rgba = np.stack([R, G, B, A], axis=-1)
    return np.clip(np.floor(rgba * 255.0 + 0.5), 0, 255).astype(np.uint8)


def bake(frame_fn):
    atlas = np.zeros((FRAME * GRID, FRAME * GRID, 4), dtype=np.uint8)
    for k in range(FRAMES):
        t = k / (FRAMES - 1)
        R, A = frame_fn(t)
        row, col = divmod(k, GRID)
        atlas[row * FRAME:(row + 1) * FRAME, col * FRAME:(col + 1) * FRAME] = encode_frame(R, A)
    return atlas


# ------------------------------------------------------------------ PNG ----

def _filter_rows(img):
    """Per-row PNG filter choice (min sum of |signed residual|), vectorised."""
    h, w, c = img.shape
    rows = img.reshape(h, w * c).astype(np.int16)
    prev = np.vstack([np.zeros((1, w * c), np.int16), rows[:-1]])
    left = np.hstack([np.zeros((h, c), np.int16), rows[:, :-c]])
    upleft = np.hstack([np.zeros((h, c), np.int16), prev[:, :-c]])
    p = left + prev - upleft
    pa = np.abs(p - left)
    pb = np.abs(p - prev)
    pc = np.abs(p - upleft)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, prev, upleft))
    cands = [
        rows,
        rows - left,
        rows - prev,
        rows - ((left + prev) >> 1),
        rows - paeth,
    ]
    cands = [(cnd & 0xFF).astype(np.uint8) for cnd in cands]
    cost = np.stack([np.abs(cnd.astype(np.int8).astype(np.int32)).sum(axis=1) for cnd in cands])
    choice = np.argmin(cost, axis=0)  # ties -> lowest filter id, deterministic
    out = bytearray()
    for y in range(h):
        f = int(choice[y])
        out.append(f)
        out += cands[f][y].tobytes()
    return bytes(out)


def write_png(path, img):
    h, w, _ = img.shape

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(_filter_rows(img), 9)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    for name, fn in (("fire", fire_frame), ("smoke", smoke_frame)):
        path = os.path.join(args.out, "flipbook_%s.png" % name)
        write_png(path, bake(fn))
        print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(argv)
