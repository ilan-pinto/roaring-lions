"""Probe a shipped vehicle GLB's bake: paint band (HSV, sRGB-encoded texels),
UV coverage of every textured mesh at the bake's resolution, and the empty
32x32 blocks (8-aligned) where a flat patch could go.  usage: bake_probe.py a.glb b.glb ..."""
import colorsys
import io
import json
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def load(p):
    d = open(p, 'rb').read()
    ln = struct.unpack_from('<I', d, 12)[0]
    j = json.loads(d[20:20 + ln])
    bl = struct.unpack_from('<I', d, 20 + ln)[0]
    bin_ = d[28 + ln:28 + ln + bl]
    return j, bin_


def acc(j, b, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    fmt, sz = CT[a['componentType']]
    n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', sz * n)
    out = np.zeros((a['count'], n), dtype=np.float64 if fmt == 'f' else np.int64)
    for k in range(a['count']):
        out[k] = struct.unpack_from('<' + fmt * n, b, off + k * stride)
    return out


def image(j, b, idx):
    im = j['images'][idx]
    bv = j['bufferViews'][im['bufferView']]
    off = bv.get('byteOffset', 0)
    return Image.open(io.BytesIO(b[off:off + bv['byteLength']])).convert('RGB')


for p in sys.argv[1:]:
    j, b = load(p)
    mat = j['materials'][0]
    base_idx = j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    base = image(j, b, base_idx)
    W, H = base.size
    cov = Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(cov)
    kit_cov = Image.new('L', (W, H), 0)
    kd = ImageDraw.Draw(kit_cov)
    tri = 0
    for node in j['nodes']:
        if 'mesh' not in node:
            continue
        name = node.get('name', '')
        if name.startswith('WRECK_'):
            continue
        m = j['meshes'][node['mesh']]
        for pr in m['primitives']:
            if 'material' not in pr or 'TEXCOORD_0' not in pr['attributes']:
                continue
            uv = acc(j, b, pr['attributes']['TEXCOORD_0'])
            idx = acc(j, b, pr['indices'])[:, 0] if 'indices' in pr else np.arange(len(uv))
            tgt = kd if name.startswith('kit_') else dr
            for t in range(0, len(idx), 3):
                pts = [(uv[idx[t + k]][0] * W, uv[idx[t + k]][1] * H) for k in range(3)]
                tgt.polygon(pts, fill=255, outline=255)
                tri += 1
    cv = np.asarray(cov) > 0
    kc = np.asarray(kit_cov) > 0
    # paint band stats over covered texels
    rgb = np.asarray(base).astype(np.float32) / 255.0
    sel = rgb[cv]
    hsv = np.array([colorsys.rgb_to_hsv(*c) for c in sel[::7]])
    hue = hsv[:, 0] * 360
    band = (hsv[:, 1] > 0.22) & (hue > 40) & (hue < 165)
    hb = hsv[band]
    print(f"{p.split('/')[-1]}: bake {W}x{H}, {tri} tris rasterised, coverage {cv.mean():.3f}, kit-only coverage {(kc & ~cv).mean():.4f}")
    print(f"   paint band ({band.mean():.2f} of texels): hue med {np.median(hb[:,0]*360):.1f} (p10 {np.percentile(hb[:,0]*360,10):.1f} p90 {np.percentile(hb[:,0]*360,90):.1f}) "
          f"sat med {np.median(hb[:,1]):.3f} val med {np.median(hb[:,2]):.3f}")
    # empty 32x32 8-aligned blocks, with a 4-texel guard, that no live or kit face touches
    allc = cv | kc
    blocks = []
    for y in range(0, H - 40, 8):
        for x in range(0, W - 40, 8):
            if not allc[y:y + 40, x:x + 40].any():
                blocks.append((x + 4, y + 4))
    print(f"   empty 40x40 guard blocks: {len(blocks)}; first {blocks[:3]}; nearest-centre {min(blocks, key=lambda q: abs(q[0]-W//2)+abs(q[1]-H//2)) if blocks else None}")
