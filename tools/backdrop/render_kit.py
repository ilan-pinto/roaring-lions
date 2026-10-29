"""Render the kit for approval: plates, wireframes, wall turntables, the composed mock.

    blender -b -P tools/backdrop/render_kit.py -- --blend kit.blend --out DIR --mode plates|turntables|mock [--only name ...]

Same rig rules as every render tool here (kit-spec section 6): the OBJECT rotates,
the camera and the sun do not; the camera is the game's (orthographic, 30 degrees
of elevation, 45 degrees of yaw, `tools/dimetric.py`'s geometry); the sun is the
game's side light `SUN_DIRECTION` (-0.406, 0.819, 0.406 in three's y-up axes) at
`SUN_INTENSITY` 2.6, and the hemisphere is `water.0` over `dust.4` at 0.9, exactly
`lighting.ts`'s lights; the backdrop casts and receives no shadow (prototype
rule 2), so shadows are off. EEVEE renders scene-linear EXRs; the tone map is
three's ACESFilmic (exposure 1.0) applied in numpy, because Blender ships no
ACES view transform and `Filmic`/`AgX` would not be what the game shows.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import bpy
import mathutils

import kitlib as K

# three's SUN_DIRECTION (x, y-up, z) -> Blender (x, -z, y-up)
SUN_TO_LIGHT = mathutils.Vector((-0.406, -0.406, 0.819)).normalized()
SUN_INTENSITY = 2.6
HEMI_INTENSITY = 0.9
ELEV = math.radians(30.0)
# direction from the scene to the camera: camera sits on the +x,+z (map) side = Blender (+x, -y)
CAM_DIR = mathutils.Vector((math.cos(ELEV) / math.sqrt(2), -math.cos(ELEV) / math.sqrt(2), math.sin(ELEV)))
PX_PER_M_Z1 = 64.0 / (3.0 * math.sqrt(2.0))        # TILE_W / the tile's diagonal in metres


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin(key):
    return srgb_to_lin(K.key_rgb(key))


LIGHTS = {
    # lighting.ts DAY_LIGHTS and time-of-day.ts dusk
    "day": dict(to_light=SUN_TO_LIGHT, sun="limestone.0", energy=2.6, sky="water.0", hemi=0.9),
}


def _dusk_to_light():
    x, y, z = -0.406, 0.819, 0.406
    phi = math.radians(35.0)
    rx, rz = x * math.cos(phi) + z * math.sin(phi), -x * math.sin(phi) + z * math.cos(phi)
    hh = math.hypot(rx, rz)
    el = math.radians(18.0)
    rx, rz = rx / hh * math.cos(el), rz / hh * math.cos(el)
    return mathutils.Vector((rx, -rz, math.sin(el))).normalized()


LIGHTS["dusk"] = dict(to_light=_dusk_to_light(), sun="dust.0", energy=1.8, sky="gunmetal.1", hemi=0.7)


def set_lights(scene, name):
    L = LIGHTS[name]
    so = bpy.data.objects["sun"]
    so.data.energy = L["energy"]
    so.data.color = tuple(lin(L["sun"]))
    so.rotation_euler = (-L["to_light"]).to_track_quat("-Z", "Y").to_euler()
    nt = scene.world.node_tree
    mix = next(n for n in nt.nodes if n.type == "MIX")
    mix.inputs[6].default_value = (*lin("dust.4"), 1.0)
    mix.inputs[7].default_value = (*lin(L["sky"]), 1.0)
    next(n for n in nt.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = L["hemi"] / math.pi


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", required=True)
    ap.add_argument("--only", nargs="*", default=[])
    ap.add_argument("--samples", type=int, default=24)
    ap.add_argument("--layout")
    return ap.parse_args(argv)


# ---- tone map: three's ACESFilmicToneMapping, exposure 1.0 -------------------
_IN = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
_OUT = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])


def aces(rgb, exposure=1.0):
    c = rgb * (exposure / 0.6)
    c = c @ _IN.T
    a = c * (c + 0.0245786) - 0.000090537
    b = c * (0.983729 * c + 0.4329510) + 0.238081
    c = a / b
    c = c @ _OUT.T
    return np.clip(c, 0.0, 1.0)


def oetf(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-9), 1 / 2.4) - 0.055)


def save_png(path, arr8):
    h, w = arr8.shape[:2]
    img = bpy.data.images.new("out_tmp", w, h, alpha=False)
    img.colorspace_settings.name = "sRGB"
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.flipud(arr8.astype(np.float32) / 255.0)
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def render_to_png(scene, path, bg_key, tmp_dir):
    exr = os.path.join(tmp_dir, "_tmp.exr")
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(exr)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    px = px.reshape(h, w, 4)
    rgb, a = px[..., :3].astype(np.float64), px[..., 3:4].astype(np.float64)
    bg = lin(bg_key)
    comp = rgb + (1.0 - a) * bg
    out = oetf(aces(comp))
    save_png(path, np.flipud((out * 255.0 + 0.5).astype(np.uint8)))
    return a[..., 0]


# ---- scene ----------------------------------------------------------------
def setup_scene(samples, w, h):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = samples
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.display_settings.display_device = "sRGB"
    # world: three's hemisphere light as an environment (hard split at the horizon)
    world = bpy.data.worlds.new("hemi")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = 0.0
    sky = nt.nodes.new("ShaderNodeMix")
    sky.data_type = "RGBA"
    sky.inputs[6].default_value = (*lin("dust.4"), 1.0)
    sky.inputs[7].default_value = (*lin("water.0"), 1.0)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = HEMI_INTENSITY / math.pi
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], gt.inputs[0])
    nt.links.new(gt.outputs[0], sky.inputs[0])
    nt.links.new(sky.outputs[2], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs[0])
    scene.world = world
    # the sun: shines along -L
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = SUN_INTENSITY
    sun.color = tuple(lin("limestone.0"))
    sun.angle = math.radians(0.6)
    sun.use_shadow = False
    so = bpy.data.objects.new("sun", sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (-SUN_TO_LIGHT).to_track_quat("-Z", "Y").to_euler()
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.clip_start, cam.clip_end = 1.0, 3000.0
    co = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(co)
    scene.camera = co
    return scene, co


def aim(co, target, ortho_scale):
    target = mathutils.Vector(target)
    co.location = target + CAM_DIR * 1000.0
    co.rotation_euler = (-CAM_DIR).to_track_quat("-Z", "Y").to_euler()
    co.data.ortho_scale = ortho_scale


def frame_bbox(co, corners, aspect, pad=1.07):
    """Aim at the middle of the projected bbox and fit it (ortho_scale is the larger side)."""
    right = (-CAM_DIR).to_track_quat("-Z", "Y") @ mathutils.Vector((1, 0, 0))
    up = (-CAM_DIR).to_track_quat("-Z", "Y") @ mathutils.Vector((0, 1, 0))
    xs = [c.dot(right) for c in corners]
    ys = [c.dot(up) for c in corners]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    wdt, hgt = max(xs) - min(xs), max(ys) - min(ys)
    scale = max(wdt, hgt * aspect) * pad
    target = right * cx + up * cy
    aim(co, target, scale)
    return scale


def bbox_corners(obj):
    return [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]


def only_visible(piece_names):
    for col in bpy.data.collections:
        if col.name.startswith("piece:"):
            vis = col.name[6:] in piece_names
            for o in col.objects:
                if o.name.endswith("_lod1"):
                    o.hide_render = True
                else:
                    o.hide_render = not vis
                    for c in o.children:
                        c.hide_render = True


def wire_material():
    solid = bpy.data.materials.new("wire_solid")
    solid.use_nodes = True
    nt = solid.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*lin("gunmetal.2"), 1.0)
    em.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    line = bpy.data.materials.new("wire_line")
    line.use_nodes = True
    nt = line.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*lin("limestone.1"), 1.0)
    em.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    return solid, line


def main():
    args = parse()
    bpy.ops.wm.open_mainfile(filepath=args.blend)
    os.makedirs(args.out, exist_ok=True)
    stats = json.load(open(os.path.join(os.path.dirname(args.blend), "stats.json")))
    names = [n for n in stats["pieces"] if (not args.only or n in args.only)]
    work = os.path.join(args.out, "work")
    os.makedirs(work, exist_ok=True)
    if args.mode == "plates":
        plates(args, names, work, stats)
    elif args.mode == "turntables":
        turntables(args, names, work)
    elif args.mode == "mock":
        import mock
        mock.run(args, work, stats)


def plates(args, names, work, stats):
    scene, co = setup_scene(args.samples, 1600, 1000)
    solid, line = wire_material()
    pdir = os.path.join(args.out, "plates")
    os.makedirs(pdir, exist_ok=True)
    for n in names:
        col = bpy.data.collections["piece:" + n]
        obj = next(o for o in col.objects if o.name == n)
        only_visible({n})
        corners = bbox_corners(obj)
        frame_bbox(co, corners, 1.6)
        if n == "bd_olive":
            aim(co, (0, 0, 1.9), 7.0)
        render_to_png(scene, os.path.join(pdir, n + ".png"), "karst.4", work)
        # wireframe twin
        orig = list(obj.data.materials)
        obj.data.materials.clear()
        obj.data.materials.append(solid)
        obj.data.materials.append(line)
        m = obj.modifiers.new("wire", "WIREFRAME")
        m.thickness = 0.07 if n != "bd_olive" else 0.015
        m.offset = 1.0
        m.use_replace = False
        m.material_offset = 1
        m.use_even_offset = True
        render_to_png(scene, os.path.join(pdir, n + "_wire.png"), "shadow.1", work)
        obj.modifiers.remove(m)
        obj.data.materials.clear()
        for mt in orig:
            obj.data.materials.append(mt)
        print("plate", n, flush=True)


def cen_xy(c):
    return mathutils.Vector((c.x, c.y, 0.0))


def turntables(args, names, work):
    scene, co = setup_scene(args.samples, 1200, 750)
    tdir = os.path.join(args.out, "turntables")
    os.makedirs(tdir, exist_ok=True)
    for n in names:
        col = bpy.data.collections["piece:" + n]
        obj = next(o for o in col.objects if o.name == n)
        only_visible({n})
        # rotate the OBJECT about the middle of its footprint; camera and sun stay put
        lo = mathutils.Vector(obj.bound_box[0])
        hi = mathutils.Vector(obj.bound_box[6])
        cen = (lo + hi) / 2
        cen.z = 0.0
        obj.location = -cen
        pivot = bpy.data.objects.new("pivot", None)
        scene.collection.objects.link(pivot)
        obj.parent = pivot
        # one frame size that holds every rotation: a circle around the footprint centre
        corners = []
        for k in range(8):
            rot = mathutils.Matrix.Rotation(math.radians(45 * k), 3, "Z")
            for x in (lo.x, hi.x):
                for y in (lo.y, hi.y):
                    for z in (lo.z, hi.z):
                        corners.append(rot @ (mathutils.Vector((x, y, z)) - cen_xy(cen)))
        scale = frame_bbox(co, corners, 1.6, pad=1.04)
        for k in range(8):
            pivot.rotation_euler = (0, 0, math.radians(45 * k))
            bpy.context.view_layer.update()
            render_to_png(scene, os.path.join(tdir, "%s_r%03d.png" % (n, 45 * k)), "karst.4", work)
        obj.parent = None
        obj.location = (0, 0, 0)
        bpy.data.objects.remove(pivot)
        print("turntable", n, flush=True)


if __name__ == "__main__":
    main()
