"""A3.2 phase 1 reference sheet: today's shipped GLBs, bake kept, through the
game's dimetric camera and a sun at the game's own azimuth/altitude.

    Blender -b --factory-startup -P render_ref.py -- --repo <repo> --out <dir> id[,id...]

Reuses `render_rig.frame_camera` (the locked camera) and `render_mesh_gate`'s
`hide_death_root` / `hide_kit_parts` so a vehicle shows exactly what a
fresh-campaign player sees: live hull, no wreck twin, no kit. Materials are
whatever the glTF importer builds from the file's own bake (nothing is
repainted), which is why the gate renderer could not be used here -- it
repaints every building and vehicle from the palette before rendering.

Lights: one sun TOWARD azimuth 135 deg / altitude 55 deg in the camera's frame
(`lighting.ts`'s SUN_DIRECTION, the camera's left), limestone.0, plus the
portraits' sky/bounce hemisphere. An approximation of the game's light for a
side-by-side judgement, not a golden capture. Eevee, Standard view transform,
film transparent, no RNG, no `mathutils.noise`.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
repo = argv[argv.index("--repo") + 1]
out_dir = argv[argv.index("--out") + 1]
# --meshes-dir: read the GLBs from here (a `git show` extraction of another
# revision, laid out as <dir>/vehicles|buildings/<id>.glb) instead of the repo.
meshes_dir = argv[argv.index("--meshes-dir") + 1] if "--meshes-dir" in argv else os.path.join(repo, "art", "meshes")
ids = [a for a in argv if not a.startswith("--") and a not in (repo, out_dir, meshes_dir)]
ids = ",".join(ids).split(",")

sys.path.insert(0, os.path.join(repo, "tools"))
sys.path.insert(0, os.path.join(repo, "tools", "units"))
from render_rig import frame_camera, world_bounds  # noqa: E402
import render_mesh_gate as gate  # noqa: E402

SIZE = 512
SAMPLES = 64
SUN_AZ_DEG, SUN_EL_DEG = 135.0, 55.0   # lighting.ts SUN_DIRECTION (-0.406, 0.819, 0.406)
KEY_ENERGY, KEY_HEX = 3.2, "#F2E8D5"   # portraits row 7, limestone.0
SKY_HEX, BOUNCE_HEX = "#A9C4D1", "#96703C"
AMBIENT_STRENGTH = 0.7 / math.pi


def srgb_to_linear(h):
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5))
    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


def path_for(uid):
    for sub in ("vehicles", "buildings", ""):
        p = os.path.join(meshes_dir, sub, uid + ".glb")
        if os.path.exists(p):
            return p, sub
    raise SystemExit(f"no GLB for {uid}")


def build_scene():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = SAMPLES
    sc.eevee.use_shadows = True
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"

    az, el = math.radians(SUN_AZ_DEG), math.radians(SUN_EL_DEG)
    toward = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    ld = bpy.data.lights.new("KEY", "SUN")
    ld.energy = KEY_ENERGY
    ld.color = srgb_to_linear(KEY_HEX)[:3]
    ld.angle = math.radians(1.5)
    lo = bpy.data.objects.new("KEY", ld)
    sc.collection.objects.link(lo)
    lo.rotation_euler = (-toward).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("ref_world")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = -1.0
    rng.inputs["From Max"].default_value = 1.0
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = srgb_to_linear(BOUNCE_HEX)
    mix.inputs["B"].default_value = srgb_to_linear(SKY_HEX)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = AMBIENT_STRENGTH
    outn = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Result"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], outn.inputs["Surface"])
    sc.world = world

    cd = bpy.data.cameras.new("CAM")
    cd.type = "ORTHO"
    cam = bpy.data.objects.new("CAM", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


os.makedirs(out_dir, exist_ok=True)
for uid in ids:
    glb, sub = path_for(uid)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = build_scene()
    bpy.ops.import_scene.gltf(filepath=glb, import_scene_extras=True)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if sub == "vehicles":
        objs, _ = gate.hide_kit_parts(objs)
        objs, _ = gate.hide_death_root(objs, glb)
    # Material-less role meshes (the palette weapon stations) take the game's
    # own lifted tone, dumped by tools/src/portrait-roles.ts, as the portraits do.
    import json
    roles = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roles.json"))).get(uid, {})
    cache = {}
    for ob in objs:
        if any(s.material for s in ob.material_slots):
            for m in (s.material for s in ob.material_slots if s.material):
                bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if bsdf is not None:
                    if not bsdf.inputs["Roughness"].is_linked:
                        bsdf.inputs["Roughness"].default_value = 0.85
                    if not bsdf.inputs["Metallic"].is_linked:
                        bsdf.inputs["Metallic"].default_value = 0.0
            continue
        hexv = roles.get(ob.get("rl_role"))
        if hexv is None:
            raise SystemExit(f"{uid}: {ob.name}: no game colour for role {ob.get('rl_role')!r}")
        if hexv not in cache:
            m = bpy.data.materials.new("flat_" + hexv[1:])
            m.use_nodes = True
            b = m.node_tree.nodes["Principled BSDF"]
            b.inputs["Base Color"].default_value = srgb_to_linear(hexv)
            b.inputs["Roughness"].default_value = 0.85
            b.inputs["Metallic"].default_value = 0.0
            cache[hexv] = m
        ob.data.materials.clear()
        ob.data.materials.append(cache[hexv])
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    lo, hi = world_bounds()
    frame_camera(cam, lo, hi)
    ext = hi - lo
    px_per_m = SIZE / cam.data.ortho_scale
    bpy.context.scene.render.filepath = os.path.join(out_dir, f"{uid}.png")
    bpy.ops.render.render(write_still=True)
    mats = {m.name for o in objs for m in o.data.materials if m}
    imgs = {i.name: tuple(i.size) for i in bpy.data.images if i.has_data or i.size[0]}
    print(f"REF_OK {uid} ext={ext.x:.2f}x{ext.y:.2f}x{ext.z:.2f}m px_per_m={px_per_m:.1f} "
          f"materials={sorted(mats)} images={imgs}")
