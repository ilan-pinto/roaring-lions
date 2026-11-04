#!/usr/bin/env python3
"""The LOD-twin exemption of the silhouette collision check (GH-974), with a constructed failing input for each way it goes red.

    python3 tools/test_lod_twin_gate.py

`validate_mesh_assets.check_collisions` exempts a (twin, full) pair named in `LOD_TWINS`, and `check_lod_twins` holds the
exemption to two conditions: the twin is wired in `mesh-catalogue.ts` as its full mesh's `lod1`, and it is still a twin (IoU
at or above `LOD_TWIN_MIN_IOU`). Masks here are synthetic and the catalogue text is a literal, so each case is one input:

  0. the shipped catalogue text, the shipped table, two near-identical masks       -> no failures (the control)
  1. an exempt pair, but the catalogue never names the twin as `lod1`               -> "does not name it"
  2. wired, but the twin's mask is a different shape (IoU well below the floor)     -> "no longer reads as the same mesh"
  3. the exemption is for ONE pair: the twin against a third near-identical mesh    -> still a silhouette collision
  4. no exemption table at all (`twins={}`)                                         -> the twin/full pair collides (the gate's own red)
  5. a table naming a twin with no render                                           -> "has no render"
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate_mesh_assets as v  # noqa: E402

REPO = v.REPO


def box(x0, x1, n=64):
    m = np.zeros((n, n), dtype=bool)
    m[20:44, x0:x1] = True
    return m


def main():
    with open(v.MESH_CATALOGUE_TS, encoding="utf-8") as fh:
        shipped = fh.read()
    full, twin = box(8, 56), box(8, 55)           # IoU ~0.98: the real pair is 0.946
    other = box(8, 56)                              # a third mesh the twin must still not collide with
    assert v.va.iou(full, twin) > v.va.IOU_LIMIT
    masks = {"wall": full, "wall_lod1": twin}
    bad = []

    def expect(name, failures, needle):
        ok = (needle is None and not failures) or (needle is not None and any(needle in f for f in failures))
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" -- got {failures}"))
        if not ok:
            bad.append(name)

    expect("0 control: wired and a twin", v.check_collisions(masks) + v.check_lod_twins(masks, shipped), None)
    expect("1 unwired", v.check_lod_twins(masks, shipped.replace("lod1: 'buildings/wall_lod1.glb'", "")), "does not name it")
    skewed = {"wall": full, "wall_lod1": box(40, 60)}
    expect("2 not a twin", v.check_lod_twins(skewed, shipped), "no longer reads as the same mesh")
    expect("3 exemption is one pair", v.check_collisions({**masks, "fence": other}), "wall_lod1 (mesh) vs fence")
    expect("4 no exemption", v.check_collisions(masks, twins={}), "silhouette collision")
    expect("5 twin has no render", v.check_lod_twins({"wall": full}, shipped), "has no render")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
