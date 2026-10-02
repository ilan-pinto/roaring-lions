"""Unit portraits (GH-153 / S3a): one three-quarter, garage-lit still per unit.

    blender -b -P tools/render_unit_portraits.py -- --only=inf_squad,mbt_lavi,recon_drone

Numbers: docs/superpowers/specs/2026-10-01-unit-portraits-numbers.md (approved
1 Oct). Every constant below carries its row number from that table.

Colour is read from the game, never copied: `tools/src/portrait-roles.ts`
dumps `liftTone(rampFor*Role(...))` (what `rampMaterial` paints) to JSON and
this script reads that file (`--roles`, regenerated on every run by
`pnpm`'s tsx when `--roles` is not given). A mesh whose GLB material carries a
base-colour image keeps its bake (spec row 6), per mesh, exactly as the
renderer does (`mesh-vehicle.ts`, `mesh-unit.ts`).

Forward is glTF +X, which the importer leaves as Blender +X (Y-up -> Z-up
touches only Y and Z), so the unit's forward vector is (cos t, sin t, 0).
The camera sits on Blender -Y; screen-right is +X. The unit is turned so its
forward points toward the camera, 35 degrees off the camera axis, to screen
LEFT (row 1).

Deterministic: no random source, no `mathutils.noise`; the fit loop is a fixed
number of rounds. Writes the 512 px master and the 192 px shipped PNG
(Lanczos on premultiplied alpha) to art/portraits/
(no --only renders the full KDF + Sarim roster); replaces nothing shipped.
"""
import hashlib
import json
import math
import os
import subprocess
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# --- the approved numbers (spec rows) ------------------------------------
TURN_DEG = 35.0            # 1  forward turned off the camera axis, nose screen-left
FOV_DEG = 30.0             # 4  vertical
ELEV_FIGURE_DEG = 12.0     # 4
ELEV_VEHICLE_DEG = 18.0    # 4  vehicles and air
# 5  per-class fill rule: (axis, fraction). Figures: longer axis at 88%.
#    Vehicles and air (lead, 1 Oct): silhouette WIDTH at 92%, so a hull or a
#    drone reads at a 40 px chip; its height is whatever the width leaves.
FILL_RULE = {"figure": ("longer", 0.88), "vehicle": ("width", 0.92)}
KEY_ENERGY = 3.2           # 7
KEY_AZ_DEG, KEY_EL_DEG = 40.0, 50.0       # 7  screen-left, up
KEY_HEX = "#F2E8D5"        # limestone.0
SUN_ANGLE_DEG = 1.5        # 7  dimetric.SUN_ANGLE
FILL_ENERGY = 0.7          # 8
FILL_AZ_DEG, FILL_EL_DEG = 55.0, 20.0     # 8  screen-right, up
FILL_HEX = "#A9C4D1"       # water.0
SKY_HEX = "#A9C4D1"        # 9  water.0
BOUNCE_HEX = "#96703C"     # 9  dust.4
HEMI_INTENSITY = 0.7       # 9  three.js units
# three's Lambert is albedo/pi * irradiance; a Blender world of radiance L
# lights a diffuse surface albedo * L. The same light is therefore L = I / pi.
AMBIENT_STRENGTH = HEMI_INTENSITY / math.pi
EXPOSURE_EV = 0.14         # 12 (1.1 as EV: log2(1.1) = 0.1375)
SAMPLES = 64               # 13
FILTER_PX = 1.5            # 13
MASTER_PX = 512            # 14
SHIPPED_PX = 192           # 14
ROUGHNESS = 0.85           # 6  WORLD_ROUGHNESS
FIT_ROUNDS = 24

# Figure teams live in meshes/ itself, vehicles and air in meshes/vehicles/.
FIGURES = {"inf_squad", "at_team", "mortar_team", "sniper_team", "demo_squad",
           "breach_team", "yahalom_squad", "recon_zikit",
           "atgm_cell", "manpad_team", "recoilless_team", "sarim_rifles"}
ENEMY_FIGURES = {"atgm_cell", "manpad_team", "recoilless_team", "sarim_rifles"}
ROSTER = (
    # KDF (19)
    "inf_squad,at_team,mortar_team,sniper_team,demo_squad,breach_team,yahalom_squad,recon_zikit,"
    "mbt_lavi,ifv_namer,apc_eitan,apc_kipod,jeep_shoded,scout_shachaf,dozer_d9,"
    "heli_peten,heli_peten_gunship,attack_drone,recon_drone,"
    # Sarim (6)
    "sarim_rifles,atgm_cell,manpad_team,recoilless_team,rocket_battery,loiter_drone"
)
OUT_DIR = os.path.join(REPO, "art", "portraits")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = {"only": ROSTER, "source": "assets",
            "roles": "", "out": OUT_DIR}
    for a in argv:
        k, _, v = a.lstrip("-").partition("=")
        args[k] = v
    return args


def srgb_to_linear(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def glb_path(unit, source):
    sub = "" if unit in FIGURES else "vehicles"
    return os.path.join(REPO, source, "meshes", sub, f"{unit}.glb")


def import_unit(unit, source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = glb_path(unit, source)
    try:
        bpy.ops.import_scene.gltf(filepath=path, import_scene_extras=True)
        used = source
    except Exception as exc:  # Draco decoder missing, etc.
        if source == "art":
            raise
        print(f"WARN: {unit}: {source}/ import failed ({exc}); falling back to art/")
        bpy.ops.wm.read_factory_settings(use_empty=True)
        path = glb_path(unit, "art")
        bpy.ops.import_scene.gltf(filepath=path, import_scene_extras=True)
        used = "art"
    return path, used


def drop_dead_geometry(unit):
    """The wreck and death subtrees (`death_root`, `<prefix>_death_root`) are
    scaled to 0 by `idle`, which collapses their meshes to a point at the
    origin and wrecks the framing. Unlinked, as the mesh gate does."""
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o.get("rl_role") is None:
            bpy.data.objects.remove(o, do_unlink=True)  # importer's stray icosphere
    roots = [o for o in bpy.context.scene.objects if o.name.endswith("death_root")]
    for root in roots:
        for o in [root] + list(root.children_recursive):
            for c in list(o.users_collection):
                c.objects.unlink(o)


def pose_idle():
    action = bpy.data.actions.get("idle")
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if action is None:
        raise SystemExit("no `idle` clip -- spec row 2 poses every unit from it")
    for obj in armatures:
        if obj.animation_data is None:
            obj.animation_data_create()
        obj.animation_data.action = action
        obj.animation_data.action_slot = action.slots[0] if action.slots else None
    bpy.context.scene.frame_set(int(action.frame_range[0]))
    bpy.context.view_layer.update()


def has_bake(mat):
    return bool(mat and mat.use_nodes and any(n.type == "TEX_IMAGE" and n.image
                                              for n in mat.node_tree.nodes))


def flat_material(cache, hexv):
    if hexv not in cache:
        m = bpy.data.materials.new(f"portrait_{hexv}")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Base Color"].default_value = srgb_to_linear(hexv)
        b.inputs["Roughness"].default_value = ROUGHNESS
        b.inputs["Metallic"].default_value = 0.0
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(b.outputs["BSDF"], o.inputs["Surface"])
        cache[hexv] = m
    return cache[hexv]


def paint(unit, table):
    cache, report = {}, {"baked": 0, "flat": 0}
    roles = (table["figure_enemy" if unit in ENEMY_FIGURES else "figure"]
             if unit in FIGURES else table[unit])
    for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        mats = [s.material for s in ob.material_slots]
        if mats and all(has_bake(m) for m in mats):
            for m in mats:
                bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if bsdf is not None:
                    if not bsdf.inputs["Roughness"].is_linked:
                        bsdf.inputs["Roughness"].default_value = ROUGHNESS
                    if not bsdf.inputs["Metallic"].is_linked:
                        bsdf.inputs["Metallic"].default_value = 0.0
            report["baked"] += 1
            continue
        role = ob.get("rl_role")
        hexv = roles.get(role)
        if hexv is None:
            raise SystemExit(f"{unit}: {ob.name}: no game colour for role {role!r}")
        ob.data.materials.clear()
        ob.data.materials.append(flat_material(cache, hexv))
        report["flat"] += 1
    return report


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def posed_points():
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in mesh_objects():
        eo = o.evaluated_get(dg)
        me = eo.to_mesh()
        mw = eo.matrix_world
        pts.extend(mw @ v.co for v in me.vertices)
        eo.to_mesh_clear()
    return pts


def dir_toward(az_deg, el_deg, screen_left):
    """Direction TOWARD a light. Azimuth is measured from the camera axis
    (toward the camera, Blender -Y); `screen_left` is -X."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    sx = -1.0 if screen_left else 1.0
    return Vector((sx * math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def aim(obj, toward_light):
    """Sun lamps shine along their local -Z."""
    obj.rotation_euler = (-toward_light).to_track_quat("-Z", "Y").to_euler()


def build_scene(elev_deg):
    sc = bpy.context.scene
    coll = sc.collection
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = SAMPLES
    sc.eevee.use_shadows = True
    sc.render.filter_size = FILTER_PX
    sc.render.resolution_x = sc.render.resolution_y = MASTER_PX
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = EXPOSURE_EV

    for name, energy, hexv, az, el, left in (
        ("KEY", KEY_ENERGY, KEY_HEX, KEY_AZ_DEG, KEY_EL_DEG, True),
        ("FILL", FILL_ENERGY, FILL_HEX, FILL_AZ_DEG, FILL_EL_DEG, False),
    ):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = energy
        ld.color = srgb_to_linear(hexv)[:3]
        ld.angle = math.radians(SUN_ANGLE_DEG)
        lo = bpy.data.objects.new(name, ld)
        coll.objects.link(lo)
        aim(lo, dir_toward(az, el, left))

    # Row 9: a hemisphere -- sky above, bounce below -- as a world gradient.
    world = bpy.data.worlds.new("portrait_world")
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
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Result"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sc.world = world

    cd = bpy.data.cameras.new("CAM")
    cd.type = "PERSP"
    cd.sensor_fit = "VERTICAL"
    cd.angle_y = math.radians(FOV_DEG)
    cd.clip_start, cd.clip_end = 0.05, 500.0
    cam = bpy.data.objects.new("CAM", cd)
    coll.objects.link(cam)
    sc.camera = cam
    el = math.radians(elev_deg)
    view_back = Vector((0.0, -math.cos(el), math.sin(el)))   # target -> camera
    cam.rotation_euler = view_back.to_track_quat("Z", "Y").to_euler()
    return cam, view_back


def turn_unit():
    """Spin every root about world Z so forward (+X) points at the camera,
    TURN_DEG off its axis, toward screen-left (-X)."""
    theta = math.atan2(-math.cos(math.radians(TURN_DEG)), -math.sin(math.radians(TURN_DEG)))
    roots = [o for o in bpy.context.scene.objects if o.parent is None and o.type in {"EMPTY", "ARMATURE", "MESH"}]
    for r in roots:
        r.rotation_mode = "XYZ"
        r.rotation_euler.rotate_axis("Z", theta)
    bpy.context.view_layer.update()
    return math.degrees(theta)


def fit(cam, view_back, rule):
    sc = bpy.context.scene
    pts = posed_points()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    target = (lo + hi) * 0.5
    dist = (hi - lo).length * 2.0
    right = Vector((1.0, 0.0, 0.0))
    up = view_back.cross(right).normalized() * -1.0
    up = (Vector((0, 0, 1)) - view_back * view_back.z).normalized()
    half = math.tan(math.radians(FOV_DEG) / 2.0)
    box = None
    for _ in range(FIT_ROUNDS):
        cam.location = target + view_back * dist
        bpy.context.view_layer.update()
        ndc = [world_to_camera_view(sc, cam, p) for p in pts]
        x0, x1 = min(n.x for n in ndc), max(n.x for n in ndc)
        y0, y1 = min(n.y for n in ndc), max(n.y for n in ndc)
        box = (x0, x1, y0, y1)
        target = target + right * ((x0 + x1) / 2 - 0.5) * 2 * half * dist \
            + up * ((y0 + y1) / 2 - 0.5) * 2 * half * dist
        axis, frac = rule
        extent = (x1 - x0) if axis == "width" else max(x1 - x0, y1 - y0)
        dist *= extent / frac
    cam.location = target + view_back * dist
    bpy.context.view_layer.update()
    ndc = [world_to_camera_view(sc, cam, p) for p in pts]
    box = (min(n.x for n in ndc), max(n.x for n in ndc), min(n.y for n in ndc), max(n.y for n in ndc))
    return box


def downsample(master, shipped):
    code = (
        "from PIL import Image;import sys;"
        "im=Image.open(sys.argv[1]).convert('RGBa').resize((%d,%d),Image.LANCZOS).convert('RGBA');"
        "im.save(sys.argv[2],optimize=True)" % (SHIPPED_PX, SHIPPED_PX)
    )
    subprocess.run(["python3", "-c", code, master, shipped], check=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def main():
    args = parse_args()
    units = [u for u in args["only"].split(",") if u]
    roles_path = args["roles"]
    if not roles_path:
        roles_path = os.path.join(REPO, "art", "portraits", ".roles.json")
        os.makedirs(os.path.dirname(roles_path), exist_ok=True)
        vehicles = [u for u in units if u not in FIGURES]
        subprocess.run(["npx", "tsx", "src/portrait-roles.ts", roles_path, *vehicles],
                       cwd=os.path.join(REPO, "tools"), check=True)
    table = json.load(open(roles_path))
    masters = os.path.join(args["out"], "masters")
    shipped = os.path.join(args["out"], "units")
    os.makedirs(masters, exist_ok=True)
    os.makedirs(shipped, exist_ok=True)

    for unit in units:
        path, used = import_unit(unit, args["source"])
        drop_dead_geometry(unit)
        pose_idle()
        report = paint(unit, table)
        elev = ELEV_FIGURE_DEG if unit in FIGURES else ELEV_VEHICLE_DEG
        cam, view_back = build_scene(elev)
        yaw = turn_unit()
        rule = FILL_RULE["figure" if unit in FIGURES else "vehicle"]
        box = fit(cam, view_back, rule)
        m = os.path.join(masters, f"{unit}.png")
        bpy.context.scene.render.filepath = m
        bpy.ops.render.render(write_still=True)
        s = os.path.join(shipped, f"{unit}.png")
        downsample(m, s)
        meta = {"unit": unit, "source": os.path.relpath(path, REPO), "source_sha256": sha256(path),
                "yaw_deg": round(yaw, 3), "elevation_deg": elev, "fov_deg": FOV_DEG,
                "fill": list(rule), "ndc_box": [round(v, 4) for v in box], "materials": report}
        json.dump(meta, open(os.path.join(masters, f"{unit}.json"), "w"), indent=2)
        print(f"PORTRAIT_OK: {unit} src={meta['source']} baked={report['baked']} "
              f"flat={report['flat']} box={meta['ndc_box']} -> {m}")


if __name__ == "__main__":
    main()
