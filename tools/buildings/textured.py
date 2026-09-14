"""Ship a Meshy building's OWN baked material instead of repainting it from
the palette at runtime.

Imported by six building exporters -- `export_meshy_house.py`,
`export_meshy_apartment.py`, `export_meshy_warehouse.py`,
`export_meshy_clinic.py`, `export_meshy_fence.py` and `export_meshy_hall.py`
(three when this module was first written; clinic/fence/hall were added
later and this line was not updated until 2026-09-14 -- CLAUDE.md's own
"three textured buildings" framing is stale for the same reason) -- plus
`tools/terrain/export_meshy_ditch.py`'s decor export, which is not a
building type but takes the same exemption through this same module. All
otherwise unchanged: every one of them already decimates the source, splits
it into `rl_role` pieces, bakes scale / forward-reorientation / ground
alignment, and writes one GLB per state. The only thing the three original
callers did differently before this module existed is the last step --
`ob.data.materials.clear()` plus `export_materials="NONE"` and (for two of
the three) `export_texcoords=False`.

WHY THIS EXISTS, since it reverses a rule the mesh contract states outright.
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` says "A GLB carries
zero materials", and CLAUDE.md repeats it. That rule was correct for
kit-built geometry, which has no texture to carry and whose colour genuinely
does belong to the palette. It is wrong for a supplied, photo-textured Meshy
source, and the project lead has overridden it explicitly:

    "i have provided a very detailed blender files and i want them to be
     used as is unless ill provide other instruction."

So these building types -- and no others -- ship their own `base_color`
bake, and the runtime draws it instead of `rampForBuildingRole`'s palette
slice. The opt-out is named on both sides:
`TEXTURED_BUILDING_TYPES` in
`packages/render/src/three/units/textured-building.ts`, and
`TEXTURED_MESH_EXEMPT` in `tools/validate_mesh_assets.py`. Every other
building still takes the palette path, unchanged.

WHAT SHIPS, AND WHAT IS DROPPED.

  - `base_color` ships, downscaled to `TEXTURE_PX` and re-encoded as JPEG at
    `JPEG_QUALITY`. Sizes measured on the house's own 19,445-vert intact
    mesh, total GLB bytes with geometry held constant at ~1.24 MB:

        4096 px  12,681,368 B   (texture ~11.4 MB -- absurd, see below)
        2048 px   1,766,504 B   (texture ~526 KB)  <- TEXTURE_PX
        1024 px   1,381,460 B   (texture ~141 KB)
         512 px   1,277,380 B   (texture ~37 KB)

    2048 is the pick. Against 1024 it costs 385 KB and visibly holds the
    mortar lines between masonry courses and the individual slats in the
    window shutters, both of which 1024 blurs (rendered close crops of the
    same facade, side by side, at both sizes). 4096 is not a real option:
    Blender re-encodes from the decoded buffer rather than passing the
    source JPEG through, so "keep the source resolution" costs 11.4 MB for
    detail no camera in this game can reach.

  - `metallic_roughness` and `normal` are KEPT, since 2026-09-14. Until then
    they were DROPPED, on the argument that nothing in this renderer could
    consume them: `palette-material.ts` quantized `N.L` into bands and
    indexed a ramp, with a single hard-coded light direction and no lights
    in the scene, so shipping a PBR map would change no pixel and would
    invite a later reader to conclude this backend is PBR when it is not.
    That stopped being true the same day: the renderer has real lights now
    (`packages/render/src/three/lighting.ts`), and
    `packages/render/src/three/world-materials.ts`'s `texturedMaterial`
    keeps a GLB's `metalnessMap`/`roughnessMap`/`normalMap` when present.
    Kept maps ship at the same `TEXTURE_PX` ceiling as `base_color` -- the
    lead: "dont drop resolution" -- rather than a separate, smaller one.

COLOUR SPACE, which is where this fails silently if it fails at all. The
runtime consumer must sample this texture with NO sRGB decode -- see
`textured-building.ts`'s own `prepareTexturedMap` for the full derivation.
Nothing this script does can enforce that; it is called out here only so a
reader changing the export does not also have to rediscover it.
"""
import bpy

#: Every kept image -- `base_color`, and now `metallic_roughness`/`normal`
#: too -- is downscaled to this before export. See the module docstring's
#: own measured table for why 2048 and not 1024 or 4096; originally sized
#: against `base_color` alone, `metallic_roughness`/`normal` now share the
#: same ceiling rather than a separate, smaller one -- the lead: "dont drop
#: resolution".
TEXTURE_PX = 2048

#: JPEG quality for the re-encoded `base_color`. 85 is Blender's own
#: near-default and the quality the size table above was measured at.
JPEG_QUALITY = 85

#: The maps dropped before export -- see the docstring's "WHAT SHIPS". Empty
#: since 2026-09-14: the renderer has lights now and `texturedMaterial`
#: consumes `metallic_roughness`/`normal` when present -- see the docstring's
#: "WHAT SHIPS, AND WHAT IS DROPPED" for the fuller argument, restated from
#: `tools/vehicles/textured.py`'s own `DROPPED_PREFIXES`, its sibling
#: constant, fixed the same way in the same change.
DROPPED_MAPS: tuple[str, ...] = ()

#: The map that ships. A source lacking it is an authoring error, not
#: something to paper over with a palette fallback.
BASE_COLOR = "base_color"


def prepare_textured_images():
    """Drops every `DROPPED_MAPS` image (none, currently -- see its own
    docstring), downscales every remaining image -- `BASE_COLOR` and any
    kept `metallic_roughness`/`normal` alike -- to at most `TEXTURE_PX` on a
    side.

    Call AFTER the role split and the transform bakes, immediately before
    `export_scene.gltf` -- the role split duplicates objects, and every
    duplicate keeps referencing this same handful of `bpy.data.images`
    datablocks, so one pass here covers every piece and the glTF exporter
    emits the image exactly once no matter how many role meshes sample it.

    Returns the shipped `base_color` image's own (width, height) for the
    caller's summary -- unchanged shape, so none of the seven callers (six
    building exporters plus the ditch decor exporter) need editing for this.
    """
    for name in DROPPED_MAPS:
        img = bpy.data.images.get(name)
        if img is not None:
            bpy.data.images.remove(img)

    for img in bpy.data.images:
        if img.size[0] > TEXTURE_PX or img.size[1] > TEXTURE_PX:
            img.scale(min(img.size[0], TEXTURE_PX), min(img.size[1], TEXTURE_PX))

    base = bpy.data.images.get(BASE_COLOR)
    if base is None:
        raise SystemExit(
            f"textured: source carries no {BASE_COLOR!r} image -- "
            f"present: {sorted(i.name for i in bpy.data.images)}"
        )
    return tuple(base.size)


def split_textured_roles(role_objs, label):
    """Decides, per role mesh, whether it ships the source texture or stays
    on the palette -- and strips the material from the ones that stay.

    NOT every mesh in these GLBs comes from the Meshy source. The
    warehouse's intact `metal` role is a flat roof cap this pipeline
    SYNTHESISES with `from_pydata` (`_synthesize_roof_cap`), because the
    source is a photogrammetry-style scan of an open-topped building and has
    no roof at all. Synthesised geometry has no UV layer by construction, and
    there is no honest texel for it: any unwrap would be inventing a mapping
    into someone else's bake and would draw a smear of whatever happens to
    sit at those coordinates.

    So the opt-out is per MESH, not per file. A role that carries UVs keeps
    the material and draws the photo; a role this script invented has its
    material cleared and draws `rampForBuildingRole`'s palette slice at
    runtime, exactly as it did before. The runtime makes the same decision
    from the same evidence -- see `textured-building.ts`'s
    `buildBuildingMeshTemplate`, which branches on whether a mesh's material
    actually carries a map -- so the two sides cannot drift: there is one
    fact (does this mesh have a texture?) recorded in the GLB itself.

    Raises if NOTHING has UVs, which would mean the texcoords were dropped
    upstream rather than this being a synthesised piece. That failure is real
    and already happened once in this tree: `apartment.glb` and
    `warehouse.glb` shipped as correctly-decimated Meshy geometry with
    `export_texcoords=False`, on the then-correct reasoning that "zero
    materials ship, so a UV set is bytes nothing can read". The geometry was
    never wrong and never needed redoing -- only the last step threw the
    texture coordinates away. Without this check the export silently produces
    a textured material sampling a mesh that cannot address it, and the
    building draws one flat colour smeared from the texel at (0,0).
    """
    photo, palette = [], []
    for role, ob in sorted(role_objs.items()):
        if ob.data.uv_layers:
            photo.append(role)
        else:
            ob.data.materials.clear()
            palette.append(role)
    if not photo:
        raise SystemExit(
            f"{label}: no role has a UV layer -- the source texcoords were dropped upstream, "
            f"which is not the same thing as a synthesised piece"
        )
    print(f"[{label}] textured roles: {photo or '-'} | palette roles (synthesised, no UVs): {palette or '-'}")
    return photo, palette


def gltf_kwargs(out_path, credit):
    """The `export_scene.gltf` keyword set for a TEXTURED building GLB.

    Differs from the palette path's in exactly three arguments --
    `export_materials`, `export_texcoords` and the two image settings -- and
    is spelled out in full rather than as a diff so a reader comparing this
    against a palette exporter's own call sees both sides whole.
    """
    return dict(
        filepath=out_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        # The whole point of this module. UVs ship because a material now
        # reads them; `assert_uvs` above guarantees there are some.
        export_texcoords=True,
        export_extras=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=JPEG_QUALITY,
        export_copyright=credit,
    )
