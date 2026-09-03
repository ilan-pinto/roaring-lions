"""Preview the exported RPG-7 prop in palette colour, beside a scale reference.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \\
        --python tools/units/preview_rpg.py -- IN.glb art/showcase/rpg7_mock.png

Writes `<out>_dimetric.png` (the game's own 225/30 camera) and `<out>_side.png`.
For looking at only -- same contract as `tools/vehicles/preview_rocket_battery.py`:
does not save a .blend and does not touch assets/sprites/.

Two reference objects are in frame on purpose, because "approve art numbers
before rendering" is a standing rule here and a weapon has no self-evident
size: a 1.80 m column (a figure's height) and a 1.24 m rod (the tube length
`kit.launcher` ships for `rpg_tube`). Colours are the palette keys the runtime
would apply -- weapon gunmetal.3, wood dust.4, metal gunmetal.2 -- read from
`render_team.py`'s own SHARED_PALETTE, not invented here.
"""
import math, os, sys
import bpy
from mathutils import Vector

GLB = sys.argv[sys.argv.index("--") + 1]
OUT = sys.argv[sys.argv.index("--") + 2]

PAL = {"weapon": "#363B39", "wood": "#96703C", "metal": "#5C625F"}
GROUND = "#E6D8BE"
REF = "#A28C6E"

def s2l(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def lin(h):
    h = h.lstrip("#")
    return tuple(s2l(int(h[i:i+2], 16) / 255) for i in (0, 2, 4)) + (1.0,)

def mat(name, hexc, rough=0.85):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(hexc)
    b.inputs["Roughness"].default_value = rough
    if "Metallic" in b.inputs: b.inputs["Metallic"].default_value = 0.0
    return m

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("imported:", [(o.name, len(o.data.vertices)) for o in meshes])

for o in meshes:
    role = next((r for r in PAL if o.name.endswith(r)), None)
    if role is None:
        print("!! no role match for", o.name); continue
    o.data.materials.clear(); o.data.materials.append(mat(o.name, PAL[role]))

# combined bbox
lo = Vector((1e9,)*3); hi = Vector((-1e9,)*3)
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
size = hi - lo
ctr = (hi + lo) / 2
print(f"prop bbox size=({size.x:.4f},{size.y:.4f},{size.z:.4f}) centre=({ctr.x:.4f},{ctr.y:.4f},{ctr.z:.4f})")

# Ground plane
bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, lo.z - 0.35))
bpy.context.active_object.data.materials.append(mat("ground", GROUND, 0.95))

# 1.80 m human-height reference: a slim column, one metre behind the weapon
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.9, lo.z - 0.35 + 0.90))
ref = bpy.context.active_object
ref.scale = (0.16, 0.16, 1.80)
ref.data.materials.append(mat("ref", REF, 0.9))
# 1.24 m tube marker: a thin rod at the tube's own length, in front
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.55, lo.z - 0.34))
rod = bpy.context.active_object
rod.scale = (1.24, 0.02, 0.02)
rod.data.materials.append(mat("rod", "#363B39", 0.9))

# lights
sun = bpy.data.lights.new("key", "SUN"); sun.energy = 3.2
so = bpy.data.objects.new("key", sun); bpy.context.collection.objects.link(so)
so.rotation_euler = (math.radians(52), 0, math.radians(38))
fill = bpy.data.lights.new("fill", "SUN"); fill.energy = 1.1
fo = bpy.data.objects.new("fill", fill); bpy.context.collection.objects.link(fo)
fo.rotation_euler = (math.radians(65), 0, math.radians(215))
bpy.context.scene.world = bpy.data.worlds.new("w")
bpy.context.scene.world.use_nodes = True
bpy.context.scene.world.node_tree.nodes["Background"].inputs[0].default_value = lin("#C8B494")
bpy.context.scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.55

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.film_transparent = False
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
sc.view_settings.view_transform = "Standard"

cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data); sc.collection.objects.link(cam); sc.camera = cam

def shoot(name, az_deg, elev_deg, ortho):
    cam_data.ortho_scale = ortho
    az, el = math.radians(az_deg), math.radians(elev_deg)
    d = 8.0
    cam.location = (ctr.x + d*math.cos(el)*math.cos(az),
                    ctr.y + d*math.cos(el)*math.sin(az),
                    ctr.z + d*math.sin(el))
    dirv = Vector(ctr) - cam.location
    cam.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = name
    bpy.ops.render.render(write_still=True)
    print("wrote", name)

base = os.path.splitext(OUT)[0]
shoot(f"{base}_dimetric.png", 225, 30, 3.2)   # the game's own camera angle
shoot(f"{base}_side.png",     270, 6,  2.2)   # straight side, to read the shape
