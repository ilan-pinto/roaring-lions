"""Photograph Meshy PREVIEW downloads as a labelled contact sheet, four yaws each.

Two halves in one file, chosen by the interpreter that runs it:

    # 1. under Blender: one PNG per (model, yaw) plus a sidecar .json each
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/render_meshy_sheet.py -- \
        --out docs/art/sheets/.a31-cells \
        art/meshy/sarim-rifle-20261005-01a1xxxx/model.glb [more .glb ...]

    # 2. under python3 (needs Pillow): the cells composed into ONE sheet
    python3 tools/render_meshy_sheet.py --compose docs/art/sheets/.a31-cells \
        --out docs/art/sheets/a31-parts-previews.png --title "A3.1 parts previews"

WHY THIS EXISTS (2026-10-05, A3.1 stage 1). The lead judges a Meshy preview
BEFORE the refine spends (B8's rule: a bad preview costs 20, not 40), and the
only picture a preview download carries is Meshy's own single thumbnail. A
preview judged from one angle has already been wrong twice (the B0a attack
drone's unasked-for delta wing was invisible head-on; the B8 Namer's "WWII tank
destroyer" read only from the side). Four yaws of the same untextured
geometry, at a size a person can look at, side by side with the other items of
the batch, is the instrument for "approve the previews".

WHAT IT IS NOT. Not the game's camera, not the dimetric rig, not a gate: it
renders Workbench studio shading with cavity on, because a preview has no
texture and the question is SHAPE. `tools/render_clip_pose.py` is the one
for "how does this read through the game's own camera".

The object turns, the camera does not (the rig's own convention): yaw 0 shows the
face Meshy delivers as "facing forward" (Blender -Y after import), three
quarters on; 90, 180 and 270 follow anticlockwise seen from above. The camera is orthographic
at 30 degrees elevation, framed on the model's bounding sphere so every cell
of one model shares a scale and different models do not (a rifle and a bike
cannot share one). The label under each cell carries the folder name, the
task id prefix, the glTF triangle count and the model's extent in metres, read
from the GLB itself rather than from anyone's memory.
"""
import json
import math
import os
import sys

YAWS = (0, 90, 180, 270)
CELL = 512
ELEVATION_DEG = 30.0
AZIMUTH_DEG = -55.0  # Meshy's "facing forward" lands on Blender -Y after the glTF import;
                     # the camera sits 35 degrees off that axis so yaw 0 shows the front and a flank


# ---------------------------------------------------------------------------
# Blender half
# ---------------------------------------------------------------------------

def _blender_main(argv):
    import bpy  # noqa: F401  (only importable under Blender)
    from mathutils import Vector

    out_dir = None
    glbs = []
    i = 0
    while i < len(argv):
        if argv[i] == '--out':
            out_dir = argv[i + 1]
            i += 2
        else:
            glbs.append(argv[i])
            i += 1
    if not out_dir or not glbs:
        raise SystemExit('usage: ... -- --out <dir> <model.glb> [more]')
    os.makedirs(out_dir, exist_ok=True)

    for glb in glbs:
        _render_one(bpy, Vector, glb, out_dir)


def _wipe(bpy):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = CELL
    scene.render.resolution_y = CELL
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'SINGLE'
    sh.single_color = (0.62, 0.60, 0.55)
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.curvature_ridge_factor = 1.0
    sh.curvature_valley_factor = 1.0
    sh.show_object_outline = True
    sh.show_shadows = False
    world = bpy.data.worlds.new('sheet')
    world.color = (0.86, 0.86, 0.84)
    scene.world = world
    return scene


def _import_glb(bpy, glb):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    objs = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in objs if o.type == 'MESH']
    if not meshes:
        raise SystemExit(f'{glb}: no mesh objects imported')
    # One parent so a single rotation turns everything.
    root = bpy.data.objects.new('sheet_root', None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    return root, meshes


def _bounds(meshes, Vector):
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(min(a, b) for a, b in zip(lo, w))
            hi = Vector(max(a, b) for a, b in zip(hi, w))
    return lo, hi


def _tri_count(meshes):
    n = 0
    for o in meshes:
        o.data.calc_loop_triangles()
        n += len(o.data.loop_triangles)
    return n


def _render_one(bpy, Vector, glb, out_dir):
    scene = _wipe(bpy)
    root, meshes = _import_glb(bpy, glb)
    bpy.context.view_layer.update()
    lo, hi = _bounds(meshes, Vector)
    centre = (lo + hi) / 2.0
    extent = hi - lo
    radius = extent.length / 2.0
    tris = _tri_count(meshes)

    # Camera: orthographic, fixed; the root turns under it.
    cam_data = bpy.data.cameras.new('sheet_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = radius * 2.0 * 1.12
    cam_data.clip_start = 0.01
    cam_data.clip_end = radius * 20 + 10
    cam = bpy.data.objects.new('sheet_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    el = math.radians(ELEVATION_DEG)
    az = math.radians(AZIMUTH_DEG)
    direction = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    cam.location = centre + direction * (radius * 6 + 1)
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()

    folder = os.path.basename(os.path.dirname(os.path.abspath(glb)))
    stem = folder
    meta = {
        'folder': folder,
        'glb': os.path.relpath(glb),
        'triangles': tris,
        'extent_m': [round(v, 3) for v in extent],
        'yaws': list(YAWS),
    }
    # Rotate about the model's own centre so it stays framed at every yaw.
    root.location = Vector((0, 0, 0))
    pivot = bpy.data.objects.new('sheet_pivot', None)
    scene.collection.objects.link(pivot)
    pivot.location = centre
    root.parent = pivot
    root.matrix_parent_inverse = pivot.matrix_world.inverted()
    for yaw in YAWS:
        pivot.rotation_euler = (0.0, 0.0, math.radians(yaw))
        scene.render.filepath = os.path.join(out_dir, f'{stem}__{yaw:03d}.png')
        bpy.ops.render.render(write_still=True)
    with open(os.path.join(out_dir, f'{stem}.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    print(f'rendered {folder}: {tris} tris, extent {meta["extent_m"]} m')


# ---------------------------------------------------------------------------
# python3 half
# ---------------------------------------------------------------------------

def _compose(cells_dir, out, title):
    from PIL import Image, ImageDraw, ImageFont

    metas = sorted(
        (json.load(open(os.path.join(cells_dir, f))) for f in os.listdir(cells_dir) if f.endswith('.json')),
        key=lambda m: m.get('order', m['folder']),
    )
    if not metas:
        raise SystemExit(f'{cells_dir}: no cell metadata')
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 20)
        small = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 16)
    except OSError:
        font = small = ImageFont.load_default()
    label_h = 56
    gutter = 12
    header = 48
    cols = len(YAWS)
    w = gutter + cols * (CELL + gutter)
    h = header + len(metas) * (CELL + label_h + gutter)
    sheet = Image.new('RGB', (w, h), (235, 235, 232))
    d = ImageDraw.Draw(sheet)
    d.text((gutter, 12), title, fill=(20, 20, 20), font=font)
    for r, m in enumerate(metas):
        y0 = header + r * (CELL + label_h + gutter)
        for c, yaw in enumerate(m['yaws']):
            x0 = gutter + c * (CELL + gutter)
            cell = Image.open(os.path.join(cells_dir, f"{m['folder']}__{yaw:03d}.png")).convert('RGB')
            sheet.paste(cell, (x0, y0))
            d.text((x0 + 6, y0 + 4), f'yaw {yaw}', fill=(60, 60, 60), font=small)
        ex = m['extent_m']
        line1 = m.get('label', m['folder'])
        line2 = f"{m['triangles']:,} tris  |  {ex[0]:.2f} x {ex[1]:.2f} x {ex[2]:.2f} m  |  {m['folder']}"
        d.text((gutter, y0 + CELL + 6), line1, fill=(20, 20, 20), font=font)
        d.text((gutter, y0 + CELL + 32), line2, fill=(70, 70, 70), font=small)
    sheet.save(out)
    print(f'wrote {out} ({w}x{h}, {len(metas)} rows)')


def _python_main(argv):
    if '--compose' not in argv:
        raise SystemExit(__doc__)
    cells = argv[argv.index('--compose') + 1]
    out = argv[argv.index('--out') + 1]
    title = argv[argv.index('--title') + 1] if '--title' in argv else 'Meshy previews'
    _compose(cells, out, title)


if __name__ == '__main__':
    try:
        import bpy  # noqa: F401
        _blender_main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    except ImportError:
        _python_main(sys.argv[1:])
