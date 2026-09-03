"""Preview the Ashwar RPG team: two supplied irregular figures and the Meshy
RPG-7, arranged at `tools/units/teams.py`'s own `rpg_team` offsets.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/preview_rpg_team.py -- RPG7.glb art/showcase/rpg_team_mock.png

For looking at only -- writes PNGs to `art/showcase/` (gitignored) and nothing
else, the same contract `tools/vehicles/preview_rocket_battery.py` states.
This is NOT the export: it builds no `art/meshes/rpg_team.glb`, and it is
deliberately a mock-up so the arrangement can be judged before anything is
committed to it.

WHERE THE FIGURES COME FROM. `art/meshes/sarim_rifles.glb` holds THREE
figures (`f0`/`f1`/`f2`) sharing one skin and one set of five role meshes,
under a `forward_fix` root. To get two independently-placeable figures out of
that, the file is imported TWICE and each copy is reduced to a single figure
by deleting the vertices weighted to the other two -- cleaner than trying to
move one figure inside a shared armature, and it keeps each copy's own clips
intact so the gunner can hold `fire` while the loader holds `idle`.

THE GUNNER CARRIES TWO WEAPONS AND THAT IS DELIBERATE. The supplied irregular
has its rifle sculpted into its own mesh (`import_meshy_soldier_irregular.py`
line 203: "`weapon` is NOT separated: the figure's own carried rifle is
sculpted as part of this one mesh"), so an RPG on the shoulder sits alongside
a rifle that cannot be removed without cutting the supplied asset. The project
lead's call, 2026-09-03: ship it -- a real RPG gunner carries a rifle too.
This preview exists partly so that decision can be looked at rather than
imagined.

PLACEMENT is `teams.py`'s `rpg_team` verbatim: firer at (0.18, -0.26), loader
at (-0.30, 0.30), launcher at the firer's own x/y at z=1.46 pitched 38 degrees
up. Those are kit units, and the figures here are the supplied Meshy ones
rather than kit boxes, so the launcher's height is re-derived from THIS
figure's measured shoulder rather than trusted at 1.46 -- a kit figure and a
photogrammetry figure are not the same height, and hanging the tube at the
kit's number would put it through the man's ear or under his armpit depending
on which. The kit value is printed beside the measured one.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

RPG_GLB = sys.argv[sys.argv.index("--") + 1]
OUT = sys.argv[sys.argv.index("--") + 2]
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIGURES_GLB = os.path.join(REPO, "art", "meshes", "sarim_rifles.glb")

#: teams.py's own rpg_team offsets.
FIRER_AT = (0.18, -0.26)
LOADER_AT = (-0.30, 0.30)
KIT_TUBE_Z = 1.46
TUBE_PITCH_DEG = 38.0

#: render_team.py's BODY_PALETTE / SHARED_PALETTE, resolved through
#: data/palette.json. Not invented here.
PAL = {
    "uniform": "#6E7449", "webbing": "#4E5433", "boot": "#7A3B24",
    "face": "#D9A57A", "keffiyeh": "#E6D8BE",
    "weapon": "#363B39", "wood": "#96703C", "metal": "#5C625F",
}
GROUND = "#E6D8BE"


def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(h):
    h = h.lstrip("#")
    return tuple(s2l(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def mat(name, hexc, rough=0.88):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(hexc)
    b.inputs["Roughness"].default_value = rough
    if "Metallic" in b.inputs:
        b.inputs["Metallic"].default_value = 0.0
    return m


def paint(objs):
    for o in objs:
        role = next((r for r in PAL if o.name.split(".")[0].endswith(r)), None)
        if role is None:
            print(f"!! no role for {o.name}")
            continue
        o.data.materials.clear()
        o.data.materials.append(mat(f"{o.name}_{role}", PAL[role]))


def import_figure(keep, clip, frame):
    """Import the three-figure team file and reduce it to the one figure whose
    bones are prefixed `keep`, posed on `clip` at `frame`. Returns (objects,
    armature)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=FIGURES_GLB)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    # Only the skinned role meshes. Blender's glTF importer also materialises a
    # 42-vertex radius-1.0 `Icosphere` that is NOT in the file -- checked
    # against the GLB's own JSON, which declares exactly five meshes, all with
    # an `rl_role` -- so it is filtered by "has vertex groups" rather than by
    # name, which would only work until the placeholder is renamed.
    meshes = [o for o in new if o.type == "MESH" and len(o.vertex_groups) > 0]
    for stray in [o for o in new if o.type == "MESH" and not o.vertex_groups]:
        bpy.data.objects.remove(stray, do_unlink=True)
        new.remove(stray)

    drop = [g for g in ("f0", "f1", "f2") if g != keep]
    for ob in meshes:
        idx = {vg.index for vg in ob.vertex_groups if vg.name.split("_")[0] in drop}
        if not idx:
            continue
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
        for v in ob.data.vertices:
            if any(g.group in idx and g.weight > 0.0 for g in v.groups):
                v.select = True
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.delete(type="VERT")
        bpy.ops.object.mode_set(mode="OBJECT")

    act = bpy.data.actions.get(clip) or next(
        (a for a in bpy.data.actions if a.name.startswith(clip)), None)
    if act and arm.animation_data is None:
        arm.animation_data_create()
    if act:
        arm.animation_data.action = act
    bpy.context.scene.frame_set(frame)
    return new, arm, meshes


def world_bbox(objs, evaluated=True):
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg) if evaluated else o
        me = ev.to_mesh()
        for v in me.vertices:
            w = ev.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
        ev.to_mesh_clear()
    return lo, hi


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 0, 60

# --- the two figures -------------------------------------------------------
gunner_objs, gunner_arm, gunner_meshes = import_figure("f0", "fire", 3)
loader_objs, loader_arm, loader_meshes = import_figure("f1", "idle", 7)

# Place each figure by a DELTA from where it actually stands, not by setting
# an absolute location: the three figures sit at their own echelon offsets
# inside the shared file (f0 at x +0.84, f1 at +0.06, f2 at -0.72), so
# assigning the target coordinate outright would leave each one its own
# offset away from where it was asked for.
for objs, meshes, at in ((gunner_objs, gunner_meshes, FIRER_AT),
                         (loader_objs, loader_meshes, LOADER_AT)):
    root = next(o for o in objs if o.parent is None)
    bpy.context.view_layer.update()
    lo, hi = world_bbox(meshes)
    root.location = (
        root.location.x + at[0] - (lo.x + hi.x) / 2,
        root.location.y + at[1] - (lo.y + hi.y) / 2,
        root.location.z - lo.z,
    )
bpy.context.view_layer.update()

bpy.context.view_layer.update()
glo, ghi = world_bbox(gunner_meshes)
print(f"gunner bbox x[{glo.x:+.3f},{ghi.x:+.3f}] y[{glo.y:+.3f},{ghi.y:+.3f}] z[{glo.z:+.3f},{ghi.z:+.3f}]"
      f"  height {ghi.z - glo.z:.3f} m")

# Shoulder height, measured off this figure rather than trusting the kit's
# 1.46 (module docstring, "PLACEMENT").
shoulder_z = glo.z + (ghi.z - glo.z) * 0.84
print(f"launcher z: measured shoulder {shoulder_z:.3f} m  (kit value {KIT_TUBE_Z})")

# --- the launcher ----------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=RPG_GLB)
rpg = [o for o in bpy.data.objects if o not in before]
rpg_meshes = [o for o in rpg if o.type == "MESH"]
# The prop's three role meshes are each their OWN root -- the exporter bakes
# every transform into vertex data, so nothing parents them together. Moving
# "the root" therefore moves one third of a launcher and leaves the tube and
# the heat shield at the world origin, which is exactly what the first run of
# this preview did. Parent them to one empty and move that instead.
pivot = bpy.data.objects.new("rpg_pivot", None)
bpy.context.collection.objects.link(pivot)
for o in rpg_meshes:
    o.parent = pivot
pivot.rotation_mode = "XYZ"
pivot.rotation_euler = (0.0, -math.radians(TUBE_PITCH_DEG), 0.0)
pivot.location = (FIRER_AT[0] - 0.10, FIRER_AT[1] - 0.16, shoulder_z)
rpg = rpg_meshes

paint([o for o in gunner_meshes + loader_meshes if o.type == "MESH"])
paint([o for o in rpg if o.type == "MESH"])

# --- stage -----------------------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
bpy.context.active_object.data.materials.append(mat("ground", GROUND, 0.95))

sun = bpy.data.lights.new("key", "SUN"); sun.energy = 3.4
so = bpy.data.objects.new("key", sun); sc.collection.objects.link(so)
so.rotation_euler = (math.radians(52), 0, math.radians(38))
fill = bpy.data.lights.new("fill", "SUN"); fill.energy = 1.2
fo = bpy.data.objects.new("fill", fill); sc.collection.objects.link(fo)
fo.rotation_euler = (math.radians(66), 0, math.radians(215))
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = lin("#C8B494")
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.5

sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
sc.view_settings.view_transform = "Standard"

cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data); sc.collection.objects.link(cam); sc.camera = cam
ctr = Vector((0.0, 0.0, 0.9))


def shoot(path, az_deg, elev_deg, ortho):
    cam_data.ortho_scale = ortho
    az, el = math.radians(az_deg), math.radians(elev_deg)
    d = 12.0
    cam.location = (ctr.x + d * math.cos(el) * math.cos(az),
                    ctr.y + d * math.cos(el) * math.sin(az),
                    ctr.z + d * math.sin(el))
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


base = os.path.splitext(OUT)[0]
shoot(f"{base}_dimetric.png", 225, 30, 3.0)     # the game's own camera
shoot(f"{base}_close.png",    225, 30, 2.3)     # same angle, filling the frame
shoot(f"{base}_side.png",     270, 8,  2.6)     # side, to read the pose

# Gameplay size. Every judgement above is made at roughly 20x the size the
# player sees, and this project has a standing rule about that ("approve art
# numbers before rendering" -- the lead judges sprites zoomed in, not at
# gameplay size, and it has cost renders before). A mesh unit occupies on the
# order of 25-40 px at zoom 1.0, so this render is deliberately tiny: it is
# the only one of the four that answers "does the launcher read, and does the
# second weapon matter" rather than "is the model nice".
sc.render.resolution_x, sc.render.resolution_y = 220, 140
shoot(f"{base}_gameplay.png", 225, 30, 3.0)
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
