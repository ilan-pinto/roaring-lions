"""Ship a Meshy vehicle's OWN baked material instead of repainting it from
the palette at runtime -- the vehicle-pipeline twin of
`tools/buildings/textured.py`, which this deliberately does not import (this
pipeline's own convention, restated by `export_meshy_paramotor.py`'s own
docstring for `_delete_faces`/`_trace_boundary_loops`/`_fill_holes`:
importing another asset class's privates couples two unrelated pipelines
together for no benefit, so small shared shape is copied, not imported).

WHY THIS EXISTS: the same override the project lead already gave the three
textured buildings applies here, in the same words --

    "i have provided a very detailed blender files and i want them to be
     used as is unless ill provide other instruction."

-- extended 2026-09-07 to name six vehicles explicitly: `mbt_lavi`,
`ifv_namer`, `technical`, `rocket_battery`, `paramotor`, `heli_peten`. Three
vehicle sources ship NO base_color bake at all (`jeep_shoded`, `dozer_d9`,
the `KDF camp` prop) and stay on the palette untouched -- there is no photo
to ship for those, the override does not apply, and this module is never
imported by their exporters.

WHY PREFIX MATCH, NOT EXACT NAME (the one real difference from the building
module). `tools/buildings/export_meshy_*.py` each open exactly one source
file per GLB, so `bpy.data.images` holds exactly one `base_color` /
`metallic_roughness` / `normal` triplet and an exact-name lookup is enough.
Two vehicle exporters -- `export_meshy_truck.py` (hull + pintle mount) and
`export_meshy_paramotor.py` (canopy + trike) -- APPEND two independently
Meshy-exported files into one Blender session via `bpy.data.libraries.load`,
and each file carries its own `base_color`/`metallic_roughness`/`normal`
trio under those exact names. Blender resolves the second file's collision
by suffixing (`base_color.001`, `metallic_roughness.001`, ...), so a lookup
by literal name would silently miss half the images this step needs to
touch. Matching by the part before the trailing `.NNN` catches every image
regardless of how many source files were appended.
"""
import bpy

#: `base_color` images ship, downscaled to this -- identical figure and
#: reasoning to `tools/buildings/textured.py::TEXTURE_PX`: measured there
#: against a comparable ~1.2 MB base geometry, 2048 costs 385 KB over 1024
#: and holds detail 1024 blurs, while 4096 re-encodes the decoded buffer at
#: ~11 MB for resolution no camera in this game reaches.
TEXTURE_PX = 2048

#: JPEG quality for the re-encoded `base_color` -- Blender's own near-default,
#: matching `tools/buildings/textured.py::JPEG_QUALITY`.
JPEG_QUALITY = 85

#: Image name PREFIXES (the part before a trailing `.NNN` Blender appends on
#: a name collision) that are dropped before export. Not for size -- there is
#: nothing in this renderer to consume them: no lights in the scene, `N.L`
#: quantized into bands by `palette-material.ts`/`textured-building.ts`, no
#: PBR response for a roughness or normal map to feed. See
#: `tools/buildings/textured.py`'s own docstring for the fuller argument;
#: it is unchanged here.
DROPPED_PREFIXES = ("metallic_roughness", "normal")

#: The map that ships.
BASE_COLOR_PREFIX = "base_color"


def _basename(name):
    """`"base_color"` -> `"base_color"`; `"base_color.001"` -> `"base_color"`.
    Only strips a trailing `.NNN` (Blender's own collision-suffix shape),
    never a name that merely happens to contain a dot for another reason --
    none of the images this module reads do."""
    if "." in name:
        head, tail = name.rsplit(".", 1)
        if tail.isdigit():
            return head
    return name


def prepare_vehicle_textures():
    """Drops every `DROPPED_PREFIXES` image, downscales every `base_color`
    image (there may be more than one -- see module docstring) to at most
    `TEXTURE_PX` on a side.

    Call AFTER every role split, cut and transform bake, immediately before
    `export_scene.gltf` -- exactly `tools/buildings/textured.py`'s own
    convention, for the same reason: role-split duplicates share these same
    `bpy.data.images` datablocks by reference, so one pass here covers every
    piece regardless of how many objects reference a given image.

    Returns `(kept, dropped)`: `kept` is a list of
    `(image.name, (before_w, before_h), (after_w, after_h))` for every
    shipped base_color image, `dropped` a list of `(image.name, (w, h))` for
    every removed one -- both for the caller's own summary print.
    """
    dropped = []
    for img in list(bpy.data.images):
        if _basename(img.name) in DROPPED_PREFIXES:
            dropped.append((img.name, tuple(img.size)))
            bpy.data.images.remove(img)

    kept = []
    for img in bpy.data.images:
        if _basename(img.name) != BASE_COLOR_PREFIX:
            continue
        before = tuple(img.size)
        if img.size[0] > TEXTURE_PX or img.size[1] > TEXTURE_PX:
            img.scale(min(img.size[0], TEXTURE_PX), min(img.size[1], TEXTURE_PX))
        kept.append((img.name, before, tuple(img.size)))

    if not kept:
        raise SystemExit(
            f"textured: no {BASE_COLOR_PREFIX!r} image found -- "
            f"present: {sorted(i.name for i in bpy.data.images)}"
        )
    return kept, dropped


def gltf_kwargs(out_path, credit):
    """The `export_scene.gltf` keyword set for a TEXTURED vehicle GLB.
    Differs from a palette-path vehicle export's own call in exactly the
    same four arguments `tools/buildings/textured.py::gltf_kwargs` changes,
    for the same reasons -- spelled out in full rather than as a diff so a
    reader sees both sides whole."""
    return dict(
        filepath=out_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        # The whole point of this module: a material now reads these.
        export_texcoords=True,
        export_extras=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=JPEG_QUALITY,
        export_copyright=credit,
    )
