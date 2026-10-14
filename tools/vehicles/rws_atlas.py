"""Each RWS host's widened texture atlas (unit polish, item 3), under python3
with Pillow -- the precedent is `tools/render_meshy_sheet.py --compose`.

    python3 tools/vehicles/rws_atlas.py <out_dir> [vehicle ...]

For each vehicle, its three maps are read out of its SHIPPED GLB
(`art/meshes/vehicles/<id>.glb`) and widened from 2048 to 2048 + 512: the
hull's pixels untouched in [0, 2048), `tools/vehicles/rws_part.py`'s 512 slot
in the new column's top rows (u 0.8-1, v 0-0.25 in glTF's top-down v), the
rest of the column the slot's mean (the normal map's: flat). Written as JPEG
at `QUALITY` -- above the hulls' own 85, so the re-encode of the hull's
pixels adds as little loss as a JPEG can. `rws-swap.ts` embeds them.

Done outside Blender on purpose: Blender's `save_render` passes an image
through the scene's view transform (measured: the Eitan's bake came back
5.5 levels darker on average), and a `Non-Color` reassignment drops a
generated image's pixels. Pillow copies bytes.
"""
import io
import json
import os
import struct
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SLOTS = os.path.join(REPO, "art", "parts", "rws")
HOSTS = ("apc_eitan", "apc_kipod", "ifv_namer", "scout_shachaf")
HULL_PX = 2048
SLOT_PX = 512
QUALITY = 95
MAPS = ("base_color", "normal", "metallic_roughness")


def glb_images(path):
    b = open(path, "rb").read()
    jlen = struct.unpack("<I", b[12:16])[0]
    g = json.loads(b[20:20 + jlen])
    off = 20 + jlen + 8
    out = {}
    for im in g["images"]:
        bv = g["bufferViews"][im["bufferView"]]
        start = off + bv.get("byteOffset", 0)
        out[im["name"]] = b[start:start + bv["byteLength"]]
    return out


def compose(vid, out_dir):
    shipped = glb_images(os.path.join(REPO, "art", "meshes", "vehicles", f"{vid}.glb"))
    for key in MAPS:
        hull = Image.open(io.BytesIO(shipped[key])).convert("RGB")
        if hull.size != (HULL_PX, HULL_PX):
            raise SystemExit(f"{vid} {key} is {hull.size}, not {HULL_PX}")
        slot = Image.open(os.path.join(SLOTS, f"slot_{key}.png")).convert("RGB")
        if slot.size != (SLOT_PX, SLOT_PX):
            raise SystemExit(f"slot_{key} is {slot.size}")
        fill = (128, 128, 255) if key == "normal" else tuple(int(c) for c in slot.resize((1, 1), Image.BOX).getpixel((0, 0)))
        atlas = Image.new("RGB", (HULL_PX + SLOT_PX, HULL_PX), fill)
        atlas.paste(hull, (0, 0))
        atlas.paste(slot, (HULL_PX, 0))
        dst = os.path.join(out_dir, f"{vid}_{key}.jpg")
        atlas.save(dst, quality=QUALITY, subsampling=0)
        print(f"[rws-atlas] {vid} {key}: {atlas.size} -> {dst}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: python3 tools/vehicles/rws_atlas.py <out_dir> [vehicle ...]")
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for vid in sys.argv[2:] or HOSTS:
        compose(vid, out)
