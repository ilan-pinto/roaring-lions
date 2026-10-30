"""Export the P3 pieces through the project's own exporter and read the GLBs back: roles,
zero materials, triangle counts against the caps, height.

    blender -b --factory-startup -P tools/terrain/export_wetland_p3.py -- --out art/meshes

writes `decor/{reed,wet_grass}_{0,1,2}.glb` and `props/{round_bale,culvert_pipe}.glb` (the
shipped export, GH-871 P3, approved after R1d). With `--out <scratch dir>` it is a dry run, which
is how R1 proved the pieces would export. Then, in plain python3:

    python3 tools/terrain/export_wetland_p3.py --read art/meshes

Every piece is procedural Blender (the builders in this directory, `.blend` sources under
`art/src/terrain/wetland/`): no generative tool, no downloaded or paid-pack source.
"""
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

CAPS = {"reed": 400, "wet_grass": 200, "round_bale": 160, "culvert_pipe": 140}
DECOR = [f"reed_{i}" for i in range(3)] + [f"wet_grass_{i}" for i in range(3)]
PROPS = ["round_bale", "culvert_pipe"]


def export_all(out):
    import bpy
    import export_meshy_decor as decor

    decor.CREDIT = (
        "Wetland decor and props (GH-871 P3) -- code-authored geometry in Blender, no generative tool "
        "and no source mesh; role-tagged for Roaring Lions"
    )
    import build_reeds, build_wet_grass, build_wetland_props
    from wetland_kit import to_object

    def one(name, roles, path, allowed):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        decor.DECOR_ROLES = frozenset(allowed)
        objs = {}
        for role, soup in roles.items():
            objs[role] = to_object(role, soup, sharp_degrees=35.0 if name in PROPS else None)
        decor._finalize_and_export(objs, path, name)

    for n in DECOR:
        if n.startswith("reed"):
            f, t = build_reeds.build(int(n[-1]))
        else:
            f, t = build_wet_grass.build(int(n[-1]))
        roles = {"foliage": f}
        if t.count:
            roles["trunk"] = t
        one(n, roles, os.path.join(out, "decor", n + ".glb"), {"foliage", "trunk", "rock", "sand"})
    for n in PROPS:
        one(n, build_wetland_props.build(n), os.path.join(out, "props", n + ".glb"), {"concrete", "metal", "rust", "rubber", "cloth"})


def read_glb(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    return json.loads(b[20 : 20 + n])


def read_all(out):
    ok = True
    for sub, names in (("decor", DECOR), ("props", PROPS)):
        for n in names:
            j = read_glb(os.path.join(out, sub, n + ".glb"))
            tris = 0
            roles = []
            ymax = 0.0
            ymin = 1e9
            for node in j["nodes"]:
                if "mesh" in node:
                    roles.append((node.get("extras") or {}).get("rl_role"))
            for m in j["meshes"]:
                for p in m["primitives"]:
                    tris += j["accessors"][p["indices"]]["count"] // 3
                    acc = j["accessors"][p["attributes"]["POSITION"]]
                    ymax = max(ymax, acc["max"][1])
                    ymin = min(ymin, acc["min"][1])
            cap = CAPS["reed" if n.startswith("reed") else "wet_grass" if n.startswith("wet_grass") else n]
            fine = tris <= cap and not j.get("materials") and not j.get("images") and not j.get("textures") and all(roles) and ymin >= -1e-6
            ok &= fine
            print(f"{n}: {tris}/{cap} tris, roles {roles}, materials {len(j.get('materials', []))}, glTF Y {ymin:.3f}..{ymax:.3f} m  {'OK' if fine else 'FAIL'}")
    return ok


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if "--read" in argv:
        sys.exit(0 if read_all(argv[argv.index("--read") + 1]) else 1)
    export_all(argv[argv.index("--out") + 1])
