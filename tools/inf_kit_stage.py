"""The stage the infantry-kit approval render (GH-826) is photographed on.

Blender-only. One place for the camera, the light and the tone curve, so the
turntable and the tier grid cannot drift apart.

**What "the game's camera and light" means here.** The three.js backend loads
the GLB in three's frame (Y up) and looks at it from `VIEW_DIRECTION`
(+x, +y, +z, elevation 30 deg, `camera.ts`). Blender's glTF importer maps
three (x, y, z) -> Blender (x, -z, y), a ROTATION, so that camera sits at
Blender ground azimuth 315, not the sprite rig's 225 (the sprite rig is the
mirror image; `lighting.ts` explains the same fact for the sun). The sun is
`lighting.ts`'s SUN_DIRECTION (-0.406, 0.819, 0.406) -> Blender
(-0.406, -0.406, 0.819): azimuth 225, altitude 55, the camera's LEFT side.
Neither is the sprite rig's `build_rig`, which is why this file does not call
it. The object rotates (a turntable parent); the camera and sun never do.

Light amounts are three's, not Blender's: a DirectionalLight of intensity I
lights a diffuse surface to albedo * I * N.L / pi (no pi compensation since
r155), and a HemisphereLight to albedo * I * mix(ground, sky) / pi. Both are
reproduced and CALIBRATED against a white test card in `calibrate()`.
Output goes through three's ACESFilmic (exposure 1.0) in `aces_srgb`, applied
in numpy on the scene-linear float render, then sRGB-encoded.

Not reproduced (the game has them, this render does not): the SSAO pass, the
vignette, fog and the toon/fog post chain. Said plainly in notes.md.
"""
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dimetric import palette_linear, TILE_W, UNITS_PER_TILE  # noqa: E402

ELEVATION = math.asin(0.5)           # 30 deg, dimetric.py
CAM_AZIMUTH = math.radians(315.0)    # game camera, in the GLB's Blender frame
SUN_AZIMUTH = math.radians(225.0)
SUN_ALTITUDE = math.radians(55.0)
SUN_INTENSITY = 2.6                  # lighting.ts
HEMI_INTENSITY = 0.9
SUN_COLOR = "limestone.0"
SKY_COLOR = "water.0"
BOUNCE_COLOR = "dust.4"
GROUND_COLOR = "dust.3"

#: Screen pixels per metre along the screen horizontal at zoom 1: one diagonal
#: tile step is sqrt(2) * 3 m and spans TILE_W px (dimetric.py).
PX_PER_M_Z1 = TILE_W / (math.sqrt(2.0) * UNITS_PER_TILE)   # 15.08


def px_per_m(zoom):
    return PX_PER_M_Z1 * zoom


def _lin(key):
    return palette_linear(key)[:3]


def setup_scene(width, height, zoom, centre, samples=96, supersample=1):
    """Camera, sun, hemisphere world, ground. Returns (cam, sun, ground)."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.filter_width = 1.0
    sc.cycles.max_bounces = 2
    sc.cycles.diffuse_bounces = 1
    sc.cycles.glossy_bounces = 1
    sc.cycles.transmission_bounces = 0
    sc.cycles.volume_bounces = 0
    sc.cycles.transparent_max_bounces = 4
    sc.cycles.sample_clamp_indirect = 4.0
    sc.render.resolution_x = width * supersample
    sc.render.resolution_y = height * supersample
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    sc.display_settings.display_device = "sRGB"
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.color_mode = "RGB"

    # --- camera: orthographic, azimuth 315, elevation 30 -------------------
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = width / px_per_m(zoom)          # horizontal extent, metres
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    d = 30.0
    cx, cy, cz = centre
    cam.location = (cx + d * math.cos(ELEVATION) * math.cos(CAM_AZIMUTH),
                    cy + d * math.cos(ELEVATION) * math.sin(CAM_AZIMUTH),
                    cz + d * math.sin(ELEVATION))
    # look at centre
    direction = (np.array(centre) - np.array(cam.location))
    direction = direction / np.linalg.norm(direction)
    from mathutils import Vector
    cam.rotation_euler = Vector(direction.tolist()).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam

    # --- sun: three's intensity -> radiance albedo*I*NL/pi -----------------
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.angle = math.radians(1.0)
    sun_data.color = _lin(SUN_COLOR)
    sun_data.energy = SUN_INTENSITY * SUN_GAIN
    sun = bpy.data.objects.new("sun", sun_data)
    bpy.context.collection.objects.link(sun)
    to_sun = Vector((math.cos(SUN_AZIMUTH) * math.cos(SUN_ALTITUDE),
                     math.sin(SUN_AZIMUTH) * math.cos(SUN_ALTITUDE),
                     math.sin(SUN_ALTITUDE)))
    sun.rotation_euler = to_sun.to_track_quat("Z", "Y").to_euler()
    sun.location = (0, 0, 10)

    # --- world: hemisphere light -------------------------------------------
    world = bpy.data.worlds.new("hemi")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    # Generated, in a world shader, is the unit ray direction in [-1, 1].
    half = nt.nodes.new("ShaderNodeMath")
    half.operation = "MULTIPLY_ADD"
    half.inputs[1].default_value = 0.5
    half.inputs[2].default_value = 0.5
    nt.links.new(sep.outputs["Z"], half.inputs[0])
    nt.links.new(half.outputs["Value"], mix.inputs["Factor"])
    s = np.array(_lin(SKY_COLOR))
    g = np.array(_lin(BOUNCE_COLOR))
    k = HEMI_INTENSITY / math.pi * HEMI_GAIN
    ls = np.clip(k * (1.25 * s - 0.25 * g), 0, None)
    lg = np.clip(k * (1.25 * g - 0.25 * s), 0, None)
    mix.inputs["A"].default_value = (*lg.tolist(), 1.0)
    mix.inputs["B"].default_value = (*ls.tolist(), 1.0)
    nt.links.new(mix.outputs["Result"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sc.world = world

    # --- ground ------------------------------------------------------------
    bpy.ops.mesh.primitive_plane_add(size=60.0, location=(cx, cy, 0.0))
    ground = bpy.context.active_object
    ground.name = "ground"
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    bsdf = gm.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*_lin(GROUND_COLOR), 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    ground.data.materials.append(gm)
    # Three's hemisphere light has no bounce: the ground must not light the
    # figure. It stays visible to the camera and to shadow rays.
    ground.visible_diffuse = False
    ground.visible_glossy = False
    return cam, sun, ground


#: Calibration constants, filled by `calibrate()` once and pinned below. See
#: notes.md: a white card facing the sun must read I*cos/pi in scene-linear.
SUN_GAIN = 1.0
HEMI_GAIN = 1.0


def aces_srgb(lin):
    """three.js ACESFilmicToneMapping at exposure 1.0, then sRGB. lin: (...,3) float."""
    c = np.clip(lin, 0, None) / 0.6
    m_in = np.array([[0.59719, 0.35458, 0.04823],
                     [0.07600, 0.90834, 0.01566],
                     [0.02840, 0.13383, 0.83777]])
    m_out = np.array([[1.60475, -0.53108, -0.07367],
                      [-0.10208, 1.10813, -0.00605],
                      [-0.00327, -0.07276, 1.07602]])
    v = c @ m_in.T
    a = v * (v + 0.0245786) - 0.000090537
    b = v * (0.983729 * v + 0.4329510) + 0.238081
    v = (a / b) @ m_out.T
    v = np.clip(v, 0.0, 1.0)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)


def render_npy(path_npy):
    """Render the current scene and save scene-linear RGB as float32 .npy."""
    sc = bpy.context.scene
    tmp = path_npy + ".exr"
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    os.remove(tmp)
    arr = px.reshape(h, w, 4)[::-1, :, :3]     # Blender rows run bottom-up
    np.save(path_npy, arr.astype(np.float32))
    return arr


def save_png(lin, path):
    """Tone-map a scene-linear (h, w, 3) array the game's way and write a PNG."""
    srgb = aces_srgb(lin)
    h, w, _ = srgb.shape
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = srgb
    img = bpy.data.images.new("out", w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"      # already display-encoded
    img.pixels.foreach_set(rgba[::-1].reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
