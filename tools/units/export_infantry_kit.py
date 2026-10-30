"""Export an infantry team's upgrade kit as a graftable source (GH-826).

    blender -b -P tools/units/export_infantry_kit.py -- [--team inf_squad]

Imports the SHIPPED team GLB, builds every kit part of `inf_kit_parts.PARTS`
on it (`inf_kit.build`: fitted per figure at the bind pose, rigidly bound
through `rig.rig_parts`, so a part with no `PART_BONE` entry raises), and
writes

    art/parts/inf_kit/<team>.glb     the kit nodes + the armature, no animation
    art/parts/inf_kit/<team>.blend   the source of that file

`pnpm kit:meshes -- --teams` (tools/src/meshes/infantry-kit-pass.ts) then
grafts the nodes into `art/meshes/<team>.glb`. Infantry pipeline order, and it
is load-bearing: export -> motion:meshes -> gait:meshes -> kit:meshes --teams
-> encode:meshes. The kit goes in AFTER the gait pass because the graft keeps
every live accessor byte-identical, and the motion pass would refuse a file it
has already been through.

A kit node is named `kit_<track>_<tier>_<part>_<figure>` (a sided part carries
`_L`/`_R` after the part) and carries `extras.rl_kit` =
`{track, tier, host, part, figure, bone, slot?, side?}`: `host` is the role
primitive it joins at load (`uniform` or `weapon`), `bone` the one bone it is
bound to (the graft checks every vertex agrees). `extras.rl_kit_base` on the
scene is a hash of the base primitives it was fitted to, so a source built
against a stale base is refused by the graft rather than drawn off its body.

The source carries NO material of its own that matters: each part keeps its
pinned UVs (a texel of the team's own atlas), and a stand-in 2 x 2 image gives
the glTF exporter a reason to write them. The graft discards the stand-in and
gives each part its host's material.
"""
import hashlib
import json
import os
import struct
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import inf_kit  # noqa: E402
import inf_kit_parts as kp  # noqa: E402
import inf_kit_scene as scn  # noqa: E402

TEAMS = {"inf_squad": "art/meshes/inf_squad.glb", "demo_squad": "art/meshes/demo_squad.glb"}
OUT_DIR = "art/parts/inf_kit"


def base_hash(path):
    """sha256 over POSITION + JOINTS_0 + WEIGHTS_0 bytes of every live mesh
    node (not `kit_*`), in node-name order. The same function lives in
    `infantry-kit-pass.ts`; both read these from the glTF accessors, so a graft
    that only ADDS kit nodes leaves it unchanged."""
    with open(path, "rb") as fh:
        data = fh.read()
    _magic, _ver, _len = struct.unpack("<4sII", data[:12])
    jlen, _jt = struct.unpack("<II", data[12:20])
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, _bt = struct.unpack("<II", data[off:off + 8])
    binchunk = data[off + 8:off + 8 + blen]
    h = hashlib.sha256()
    nodes = [n for n in gltf["nodes"] if "mesh" in n and not n.get("name", "").startswith("kit_")]
    for n in sorted(nodes, key=lambda n: n["name"]):
        for prim in gltf["meshes"][n["mesh"]]["primitives"]:
            for sem in ("POSITION", "JOINTS_0", "WEIGHTS_0"):
                acc = gltf["accessors"][prim["attributes"][sem]]
                bv = gltf["bufferViews"][acc["bufferView"]]
                comp = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[acc["componentType"]]
                width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
                size = acc["count"] * comp * width
                stride = bv.get("byteStride", comp * width)
                start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
                if stride == comp * width:
                    h.update(binchunk[start:start + size])
                else:
                    for i in range(acc["count"]):
                        h.update(binchunk[start + i * stride:start + i * stride + comp * width])
    return h.hexdigest()


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {}
    for i in range(0, len(argv) - 1, 2):
        a[argv[i].lstrip("-")] = argv[i + 1]
    return a


def node_name(part, suf, pf):
    side = suf[-2:] if suf[-2:] in ("_L", "_R") else ""
    return f"kit_{part.track}_{part.tier}_{part.name}{side}_{pf}"


def main():
    a = parse()
    team = a.get("team", "inf_squad")
    if team not in TEAMS:
        raise SystemExit(f"{team}: no kit builder (teams with one: {', '.join(TEAMS)})")
    src = os.path.join(REPO, TEAMS[team])
    kp.use_team(team)
    arm, meshes, mat = scn.load_squad(REPO, team)
    # a file already grafted imports its own kit nodes: they are not the base
    for o in [o for o in bpy.data.objects if o.name.startswith("kit_")]:
        meshes.pop(o.name, None)
        bpy.data.objects.remove(o, do_unlink=True)
    rows = inf_kit.build(REPO, arm, meshes, mat)

    # a stand-in texture so the glTF exporter writes TEXCOORD_0; the graft drops it
    stub = bpy.data.materials.new("kit_stub")
    stub.use_nodes = True
    img = bpy.data.images.new("kit_stub_2x2", 2, 2)
    img.pixels = [0.5, 0.5, 0.5, 1.0] * 4
    img.pack()
    tex = stub.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    stub.node_tree.links.new(tex.outputs["Color"], stub.node_tree.nodes["Principled BSDF"].inputs["Base Color"])

    kit_objs = []
    for ob, part, pf, tris in rows:
        suf = ob.name[len(pf) + 1:]
        name = node_name(part, suf, pf)
        bone = ob.vertex_groups[0].name
        assert bone.startswith(pf + "_"), (ob.name, bone)
        extras = {"track": part.track, "tier": part.tier, "host": part.role, "part": part.name,
                  "figure": pf, "bone": bone[len(pf) + 1:]}
        if part.slot:
            extras["slot"] = part.slot
        if suf[-2:] in ("_L", "_R"):
            extras["side"] = suf[-1]
        for k in list(ob.keys()):
            del ob[k]
        ob["rl_kit"] = extras
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        ob.data.materials.append(stub)
        kit_objs.append(ob)

    out_dir = os.path.join(REPO, OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    digest = base_hash(src)
    bpy.context.scene["rl_kit_base"] = digest
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in kit_objs:
            o.hide_set(True)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in kit_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    arm.data.pose_position = "REST"
    glb = os.path.join(out_dir, f"{team}.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
        export_skins=True, export_animations=False, export_extras=True, export_materials="EXPORT",
        export_image_format="JPEG", export_jpeg_quality=50, export_rest_position_armature=True,
    )
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in kit_objs:
            o.hide_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{team}.blend"))
    tris = sum(t for *_x, t in rows)
    print(f"[inf_kit] {team}: {len(kit_objs)} kit nodes, {tris} tris, base {digest[:12]} -> {glb} "
          f"({os.path.getsize(glb)} bytes)")


if __name__ == "__main__":
    main()
