#!/usr/bin/env python3
"""The Yahalom Engineers' packs are seated over the kit's back plate AS IT SHIPS (GH-826 unit "Yahalom", round 2).

    python3 tools/test_yahalom_back_plate.py

The lead's ruling of 17 Nov 2026: the assault pack is seated over the bare back and the kit's back plate together. The
importer builds the pack before the kit exists, so it reads the plate from a committed table
(`tools/units/yahalom_back_plate.json`, written by `tools/units/yahalom_back_plate.py --write` from the kit's own source,
`art/parts/inf_kit/yahalom_squad.glb`). A table that no longer matches the kit would seat the pack on a plate that is not
there, and nothing else would notice: the pack is hidden against it. This holds the two together: the committed table must
be what the tool reads off the committed kit source, cell for cell, to the 0.1 mm it is written in.

Why the table is not circular (measured, 17 Nov 2026): the carrier is fitted to the `uniform` skin (`inf_kit_v7.carrier_fit`)
and the pack is `webbing`. The kit was exported on the round-1 file (the 0.50 m pack, seated on the bare back) and on the
round-2 file (the 0.40 m pack): the two carrier nodes are the same bytes, both men; of the 50 nodes only the four that stand
on the gear moved (the radio pouch, the two whips, the mast sensor). So: build with RL_YAH_PLATE_BOOTSTRAP=1, export the kit,
write the table, build again, export the kit again: the second table is the first.

Falsified (17 Nov 2026), each run and watched red, then put back:
  - one cell of the committed table moved by 1 mm: "yah_a: 1 of 840 cells differ";
  - a man's row deleted: "the table's men are ['yah_a'], the team's are ['yah_a', 'yah_b']";
  - the KIT changed under the table (`carrier_trim.drop` 0.26 -> 0.20 in the team's row, the kit re-exported): "yah_a: 184 of
    840 cells differ", "yah_b: 150 of 904 cells differ". (That mutation is NOT seen by `test_inf_kit_standoff.py`'s carrier
    rows, which read 65 / 70 mm before and after: this test is the only one that saw it.)
Plain python3 and numpy (as `test_inf_kit_mesh.py`); no Blender. Wired into `pnpm validate:meshes`.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "units"))
import yahalom_back_plate as bp  # noqa: E402


def failures(committed, fresh):
    bad = []
    if sorted(committed.get("figures", {})) != sorted(bp.FIGURES):
        return [f"the table's men are {sorted(committed.get('figures', {}))}, the team's are {sorted(bp.FIGURES)}"]
    for fig in bp.FIGURES:
        a, b = committed["figures"][fig], fresh["figures"][fig]
        for k in ("y0", "dy", "z0", "dz"):
            if abs(a[k] - b[k]) > 1e-9:
                bad.append(f"{fig}: {k} is {a[k]} in the table, {b[k]} off the kit source")
        if len(a["x"]) != len(b["x"]) or any(len(r) != len(q) for r, q in zip(a["x"], b["x"])):
            bad.append(f"{fig}: the table is {len(a['x'])} rows, the kit source reads {len(b['x'])}")
            continue
        cells = sum(1 for r in a["x"] for v in r if v is not None)
        diff = sum(1 for r, q in zip(a["x"], b["x"]) for v, w in zip(r, q) if (v is None) != (w is None) or (v is not None and abs(v - w) > 5e-5))
        if diff:
            bad.append(f"{fig}: {diff} of {cells} cells differ between the committed table and the kit source (re-run `yahalom_back_plate.py --write`, "
                       "then the WHOLE pipeline: the pack's seat reads this table)")
        if cells < 200:
            bad.append(f"{fig}: the table has {cells} cells: not a plate")
    return bad


def main():
    if not os.path.exists(bp.OUT):
        print(f"FAIL no {bp.OUT}")
        return 1
    committed = json.load(open(bp.OUT))
    fresh = json.loads(bp.dumps(bp.table()))
    bad = failures(committed, fresh)
    for b in bad:
        print("FAIL", b)
    n = {f: sum(1 for r in committed["figures"][f]["x"] for v in r if v is not None) for f in committed.get("figures", {})}
    print("yahalom_squad back plate table: " + "; ".join(f"{f} {c} cells" for f, c in sorted(n.items())) + " against the kit source: " + ("FAIL" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
