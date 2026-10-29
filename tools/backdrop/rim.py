"""WH IV's rim as the kit sees it (pure numpy, no bpy): the elevation grid in metres.

`rim_field(elev)` returns `at(x_tiles, z_tiles)`: the tile-centre levels (0.7656 m each),
blurred one tile and sampled bilinearly, clamped to the map's own tiles, so a point
outside the map reads the rim under it. The mock builds its floor from this, and the
layout reads the same function to put each piece's feet on the ground it stands on.
"""
import json
import os

import numpy as np

import kitlib as K


def load_map(name="wadi_halam_4"):
    with open(os.path.join(K.REPO, "data", "maps", name + ".json")) as f:
        m = json.load(f)
    elev = np.array([[int(c) for c in row] for row in m["elevation"]], dtype=np.float64)
    return m, elev


def rim_field(elev):
    """Tile-centre levels -> metres, smoothed; sampled at tile coordinates."""
    z = elev * K.LEVEL_M
    zb = K.box_blur(z, 1)

    def at(x, y):
        x = np.clip(np.asarray(x, dtype=np.float64) - 0.5, 0, elev.shape[1] - 1.001)
        y = np.clip(np.asarray(y, dtype=np.float64) - 0.5, 0, elev.shape[0] - 1.001)
        x0 = np.floor(x).astype(int)
        y0 = np.floor(y).astype(int)
        fx, fy = x - x0, y - y0
        return (zb[y0, x0] * (1 - fx) * (1 - fy) + zb[y0, x0 + 1] * fx * (1 - fy)
                + zb[y0 + 1, x0] * (1 - fx) * fy + zb[y0 + 1, x0 + 1] * fx * fy)
    return at
