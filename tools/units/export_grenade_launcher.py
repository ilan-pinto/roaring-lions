"""Build the revolving 40 mm grenade launcher as a hand-weapon PART, in Blender.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/units/export_grenade_launcher.py [-- OUT_DIR]

Writes `art/parts/grenade_launcher/grenade_launcher.glb` (and its source,
`grenade_launcher.blend`, beside it): one mesh, one material, one tiny
base-colour image of four flat swatches, in real metres. It is a PART, not a
unit -- no rig, no role table, drawn by nothing on its own.
`import_meshy_crew_team.py` loads it (`PART_SPECS["grenade_launcher"]`) and
composes its swatches into the team atlas as it does every hand part, for
`inf_grenadier`'s two grenadiers.

NOT Meshy, NOT AI-generated: authored here, procedurally, from primitives
(the lead's ruling, 22 Oct: "its drum is a hard regular shape"). No noise, no
`mathutils.noise`; the only inputs are the numbers below.

FRAME (the one `import_meshy_crew_team._normalise_part` calls `canonical`):
the butt plate at -X, the muzzle at +X, the BORE on the X axis (y = z = 0),
up +Z, the grips and the drum toward -Z. x = 0 at the butt plate.

WHAT IT IS: the class of six-round revolving 40 mm launcher (the Milkor MGL's
layout), invented in detail, no markings. From the butt: a folded-out wire
stock (two rods and a butt plate), a rear frame with a pistol grip hanging at
0.3 of the length (where `hold.ts`'s rifle grips put the trigger hand), a
fat six-chamber drum (axis PARALLEL to the bore, below it -- the top chamber
is the one in line with the barrel), a short barrel with a muzzle collar and
a front sight, a top rail with a flip-up rear sight, and a vertical foregrip
under the front frame at 0.62 of the length (the support hand). Dull-brass
cartridge bases show on the drum's rear face.

SWATCHES (the UVs are flat: each face takes the centre of one 2 x 2 swatch):
0 gunmetal, 1 black polymer (grips, stock, trigger guard), 2 bore black
(chamber mouths, muzzle), 3 dull brass.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_OUT = os.path.join(REPO, "art", "parts", "grenade_launcher")

#: Overall length, butt plate to muzzle collar, metres. Real: 0.78 m extended.
LENGTH = 0.78

# sRGB swatches (what the PNG holds): gunmetal, black polymer, bore black, dull brass.
SWATCH = [(0.27, 0.28, 0.29), (0.10, 0.10, 0.105), (0.03, 0.03, 0.035), (0.50, 0.38, 0.17)]
GUN, POLY, BORE, BRASS = range(4)

# geometry numbers (x from the butt plate)
DRUM_X0, DRUM_X1 = 0.285, 0.470
DRUM_R, DRUM_Z = 0.092, -0.052        # axis below the bore; top chamber's centre ON the bore
CHAMBER_R, CHAMBER_ORBIT = 0.0235, 0.058
BARREL_R, BARREL_X1 = 0.0265, LENGTH
PISTOL_X = 0.3 * LENGTH               # hold.ts GRIPS.rifle.trigger
FORE_X = 0.62 * LENGTH                # hold.ts GRIPS.rifle.support

_faces_swatch = []


def _bm_new():
    return bmesh.new()


def _tag(bm, faces, swatch):
    """Remember each face's swatch in an int layer (survives to_mesh)."""
    layer = bm.faces.layers.int.get("sw")
    for f in faces:
        f[layer] = swatch


def _cyl(bm, p0, p1, r0, r1, sides, swatch, caps=True):
    """A (tapered) cylinder from p0 to p1, built as a frustum."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0)
    m = Matrix.Translation(p0) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    before = set(bm.faces)
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=sides,
                          radius1=r0, radius2=r1, depth=d.length,
                          matrix=m @ Matrix.Translation((0, 0, d.length / 2.0)))
    _tag(bm, [f for f in bm.faces if f not in before], swatch)


def _disc(bm, at, r, sides, swatch, facing=1.0):
    """A flat filled disc at `at`, its normal along +X (facing 1) or -X (-1).
    At least 10 sides: 8 triangles, the importer's `SLIVER_FACES` floor -- a
    smaller loose island is dropped as a remesh's stray strip."""
    before = set(bm.faces)
    m = Matrix.Translation(at) @ Matrix.Rotation(math.radians(90.0 * facing), 4, "Y")
    bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=False, segments=sides, radius=r, matrix=m)
    _tag(bm, [f for f in bm.faces if f not in before], swatch)


def _box(bm, lo, hi, swatch, tilt_deg=0.0, pivot=None):
    """An axis-aligned box lo..hi, optionally tilted about Y (the pistol grip rakes back)."""
    lo, hi = Vector(lo), Vector(hi)
    c, s = (lo + hi) / 2.0, hi - lo
    before = set(bm.faces)
    m = Matrix.Translation(c) @ Matrix.Diagonal((s.x, s.y, s.z, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    new = [f for f in bm.faces if f not in before]
    if tilt_deg:
        pv = Vector(pivot if pivot is not None else c)
        R = Matrix.Translation(pv) @ Matrix.Rotation(math.radians(tilt_deg), 4, "Y") @ Matrix.Translation(-pv)
        verts = {v for f in new for v in f.verts}
        bmesh.ops.transform(bm, matrix=R, verts=list(verts))
    _tag(bm, new, swatch)


def build():
    bm = _bm_new()
    bm.faces.layers.int.new("sw")   # before any face exists: a later `new` invalidates face refs
    # --- stock: butt plate and two wire rods -------------------------------
    _box(bm, (0.0, -0.032, -0.100), (0.020, 0.032, 0.030), POLY)
    for y in (-0.026, 0.026):
        _cyl(bm, (0.020, y, -0.030), (0.200, y, -0.026), 0.0085, 0.0085, 6, GUN)
    # --- rear frame -------------------------------------------------------
    _box(bm, (0.190, -0.040, -0.058), (DRUM_X0, 0.040, 0.044), GUN)
    # pistol grip, raked back 14 deg, hanging from the rear frame
    _box(bm, (PISTOL_X - 0.019, -0.021, -0.175), (PISTOL_X + 0.019, 0.021, -0.045), POLY,
         tilt_deg=14.0, pivot=(PISTOL_X, 0.0, -0.045))
    # trigger guard: a thin plate under the frame, ahead of the grip, and its front post
    _box(bm, (PISTOL_X + 0.022, -0.012, -0.066), (PISTOL_X + 0.062, 0.012, -0.058), POLY)
    _box(bm, (PISTOL_X + 0.058, -0.012, -0.066), (PISTOL_X + 0.066, 0.012, -0.036), POLY)
    # --- the drum, axis parallel to the bore, below it ---------------------
    _cyl(bm, (DRUM_X0, 0.0, DRUM_Z), (DRUM_X1, 0.0, DRUM_Z), DRUM_R, DRUM_R, 18, GUN)
    # a raised band round the middle (the cylinder's index ring)
    _cyl(bm, (0.355, 0.0, DRUM_Z), (0.395, 0.0, DRUM_Z), DRUM_R + 0.006, DRUM_R + 0.006, 18, GUN)
    # six chamber mouths on the front face (dark), six brass cartridge bases on the rear
    for k in range(6):
        a = math.radians(90.0 + 60.0 * k)       # k = 0 is the TOP chamber, on the bore
        y, z = CHAMBER_ORBIT * math.cos(a), DRUM_Z + CHAMBER_ORBIT * math.sin(a)
        _disc(bm, (DRUM_X1 + 0.002, y, z), CHAMBER_R, 10, BORE, 1.0)
        _disc(bm, (DRUM_X0 - 0.002, y, z), CHAMBER_R * 0.92, 10, BRASS, -1.0)
    # --- front frame, barrel, collar, sights ------------------------------
    _box(bm, (DRUM_X1, -0.034, -0.052), (0.545, 0.034, 0.038), GUN)
    _cyl(bm, (0.440, 0.0, 0.0), (BARREL_X1, 0.0, 0.0), BARREL_R, BARREL_R, 10, GUN)
    _cyl(bm, (BARREL_X1 - 0.050, 0.0, 0.0), (BARREL_X1, 0.0, 0.0), BARREL_R + 0.008, BARREL_R + 0.008, 10, GUN)
    _disc(bm, (BARREL_X1 + 0.002, 0.0, 0.0), BARREL_R * 0.72, 10, BORE, 1.0)
    # top rail and sights
    _box(bm, (0.250, -0.014, 0.040), (0.545, 0.014, 0.052), GUN)
    _box(bm, (0.262, -0.020, 0.052), (0.282, 0.020, 0.082), GUN)       # rear sight block
    _box(bm, (BARREL_X1 - 0.075, -0.004, BARREL_R), (BARREL_X1 - 0.067, 0.004, BARREL_R + 0.030), GUN)  # front post
    # --- vertical foregrip under the front frame --------------------------
    _cyl(bm, (FORE_X, 0.0, -0.050), (FORE_X, 0.0, -0.170), 0.0185, 0.0165, 8, POLY)
    return bm


def _make_object(bm):
    me = bpy.data.meshes.new("grenade_launcher")
    layer = bm.faces.layers.int.get("sw")
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        sw = f[layer]
        cu, cv = 0.25 + 0.5 * (sw % 2), 0.25 + 0.5 * (sw // 2)
        for lp in f.loops:
            lp[uv].uv = (cu, cv)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("grenade_launcher", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _material(ob):
    n = 128
    img = bpy.data.images.new("grenade_launcher_color", n, n, alpha=False)
    px = []
    for j in range(n):
        for i in range(n):
            sw = (i * 2 // n) + 2 * (j * 2 // n)
            r, g, b = SWATCH[sw]
            px += [r, g, b, 1.0]
    img.pixels = px
    img.update()
    img.colorspace_settings.name = "sRGB"
    mat = bpy.data.materials.new("grenade_launcher")
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.7
    ob.data.materials.append(mat)
    return img


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = argv[0] if argv else DEFAULT_OUT
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bm = build()
    ob = _make_object(bm)
    img = _material(ob)
    # pack the swatch image so the .blend is self-contained
    img.pack()
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    print(f"[grenade_launcher] {len(ob.data.polygons)} tris, x {min(xs):.3f}..{max(xs):.3f} "
          f"y {min(ys):.3f}..{max(ys):.3f} z {min(zs):.3f}..{max(zs):.3f}")
    blend = os.path.join(out_dir, "grenade_launcher.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    glb = os.path.join(out_dir, "grenade_launcher.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True,
                              export_image_format="AUTO", export_materials="EXPORT",
                              export_apply=True)
    print(f"[grenade_launcher] wrote {glb} ({os.path.getsize(glb)} bytes) and {blend}")


if __name__ == "__main__":
    main()
