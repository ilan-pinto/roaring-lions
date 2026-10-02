"""Build (or --check) assets/ui/portraits/units/manifest.json (GH-153).

    python3 tools/portrait_manifest.py [--check]

One entry per shipped unit portrait: the file, its pixel size and the unit's
own alpha bounding box (`extent`) -- the `UnitIcon { url, size, extent }`
contract `packages/app/src/ui/portrait.ts` hands every icon slot -- plus a
`lead` sub-entry where `render_unit_portraits.py --variant=lead` wrote the
one-figure chip picture. `render_unit_portraits.py` calls this after every
run; `--check` exits 1 when the manifest on disk differs from what the PNGs
say, the same shape as `crop_unit_icons.py --check`.
"""
import json
import os
import sys

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHIP = os.path.join(REPO, "assets", "ui", "portraits", "units")
LEAD = "lead"


def entry(path, rel):
    im = Image.open(path)
    if im.width != im.height:
        raise SystemExit(f"{rel}: portrait must be square, is {im.width}x{im.height}")
    box = im.getchannel("A").getbbox()
    if box is None:
        raise SystemExit(f"{rel}: fully transparent")
    return im.width, {"file": rel, "extent": [box[2] - box[0], box[3] - box[1]]}


def build():
    portraits, size = {}, None
    for name in sorted(os.listdir(SHIP)):
        if not name.endswith(".png"):
            continue
        uid = name[:-4]
        w, e = entry(os.path.join(SHIP, name), name)
        lead = os.path.join(SHIP, LEAD, name)
        if os.path.exists(lead):
            lw, le = entry(lead, f"{LEAD}/{name}")
            if lw != w:
                raise SystemExit(f"{uid}: lead is {lw}px, team is {w}px")
            e["lead"] = le
        if size not in (None, w):
            raise SystemExit(f"{uid}: {w}px, others {size}px")
        size = w
        portraits[uid] = e
    if os.path.isdir(os.path.join(SHIP, LEAD)):
        for name in os.listdir(os.path.join(SHIP, LEAD)):
            if name.endswith(".png") and name[:-4] not in portraits:
                raise SystemExit(f"lead/{name} has no team portrait beside it")
    return {"version": 1, "size": size, "portraits": portraits}


def main():
    out = os.path.join(SHIP, "manifest.json")
    text = json.dumps(build(), indent=2) + "\n"
    if "--check" in sys.argv:
        have = open(out).read() if os.path.exists(out) else ""
        if have != text:
            print(f"FAIL: {os.path.relpath(out, REPO)} is stale -- run python3 tools/portrait_manifest.py")
            sys.exit(1)
        print("portrait manifest OK")
        return
    open(out, "w").write(text)
    print(f"wrote {os.path.relpath(out, REPO)}")


if __name__ == "__main__":
    main()
