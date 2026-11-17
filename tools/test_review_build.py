#!/usr/bin/env python3
"""`validate_mesh_assets.check_review_builds`, with the input that makes it fail. Plain python3.

    python3 tools/test_review_build.py

The skinned importer refuses a Meshy body whose gun reads outside 0.72 to 0.98 m. `SKINNED_GUN_LEN_REVIEW=<team>`
builds it anyway and stamps `extras.rl_skinned.gun_len_review`; the validator refuses a file that carries the stamp.

  1. the shipped Rifle Squad (a ruled build, no stamp)          -> clean;
  2. the same bytes with the stamp written into the JSON chunk  -> red, and the message names the file and the length;
  3. the stamp under another key (`rl_skinned.gun_len_reviewed`) -> clean: the check reads the importer's own key.

Falsified by mutation (12 Nov 2026): with `.get("gun_len_review")` in the check changed to `.get("gun_len_reviews")`,
case 2 is no longer red and this script exits 1.
"""
import json
import os
import shutil
import struct
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import validate_mesh_assets as v  # noqa: E402

REPO = os.path.dirname(HERE)
SHIPPED = os.path.join(REPO, "art", "meshes", "inf_squad.glb")


def restamp(src, dst, key, value):
    """Copy `src` to `dst` with `extras.rl_skinned[key] = value` in its JSON chunk; the binary chunk is not touched."""
    data = open(src, "rb").read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    js["scenes"][0].setdefault("extras", {}).setdefault("rl_skinned", {})[key] = value
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * ((4 - len(jb) % 4) % 4)
    with open(dst, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + len(rest)))
        fh.write(struct.pack("<II", len(jb), 0x4E4F534A))
        fh.write(jb)
        fh.write(rest)


def main():
    bad = []
    tmp = tempfile.mkdtemp(prefix="review_build_")
    try:
        one = os.path.join(tmp, "one"); two = os.path.join(tmp, "two"); three = os.path.join(tmp, "three")
        for d in (one, two, three):
            os.makedirs(d)
        shutil.copy(SHIPPED, os.path.join(one, "inf_squad.glb"))
        restamp(SHIPPED, os.path.join(two, "inf_squad.glb"), "gun_len_review", {"length": 0.625, "band": [0.72, 0.98]})
        restamp(SHIPPED, os.path.join(three, "inf_squad.glb"), "gun_len_reviewed", {"length": 0.625, "band": [0.72, 0.98]})
        f1, f2, f3 = (v.check_review_builds(d) for d in (one, two, three))
        if f1:
            bad.append(f"case 1: the shipped Rifle Squad reads as a review build: {f1}")
        if len(f2) != 1 or "inf_squad.glb" not in f2[0] or "0.625" not in f2[0]:
            bad.append(f"case 2: a stamped file is not refused by name and length: {f2}")
        if f3:
            bad.append(f"case 3: another key is read as the stamp: {f3}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for b in bad:
        print(f"FAIL {b}")
    if bad:
        sys.exit(1)
    print("review-build check: 3 cases ok (a stamped file is refused; the shipped one and a stray key are not)")


if __name__ == "__main__":
    main()
