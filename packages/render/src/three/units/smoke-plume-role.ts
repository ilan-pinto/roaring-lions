/**
 * The smoke-plume mesh's own closed role vocabulary -- `base`/`mid`/`top`,
 * three horizontal SLABS `art/blend/smoke plume/
 * Meshy_AI_smoke_plume_0830172426_image-to-3d-texture.blend`'s single
 * 3490-vert/7002-tri column was cut into by LOCAL Z HEIGHT alone, measured
 * from the mesh's own re-origined base (see `smoke-plume.ts`'s own top
 * comment for the axis measurement, and `tools/export_mesh_vfx.py`'s
 * `_height_split` for the export-time mechanics).
 *
 * Deliberately its OWN small vocabulary, not a third re-export of
 * `./vfx-mesh-role.ts` (the table `muzzle-flash-role.ts` and
 * `explosion-burst-role.ts` both re-export under their own names) -- for
 * two reasons that genuinely differ, not one dressed up as two:
 *
 *   - The GEOMETRY relationship is different in kind, not merely in name.
 *     `core`/`outer` name concentric SHELLS around a point -- literally
 *     meaningless for a column split into stacked horizontal bands, where
 *     there is no "outer" (a slab has no edge-vs-centre distinction the way
 *     a shell does). `base`/`top` name what the split actually measures:
 *     position along the mesh's own rise.
 *   - The PALETTE key each role resolves to is a different table entirely --
 *     `gunmetal.*` ramp entries (see `SMOKE_PLUME_ROLE_KEY` below), not the
 *     reserved `vfx.*` incandescent band `vfx-mesh-role.ts` hard-codes.
 *     Re-exporting that module under new names only works because the
 *     muzzle flash and the explosion burst share the IDENTICAL key table;
 *     this asset's table is not merely similarly shaped, it points
 *     somewhere else on the palette altogether -- see this file's own
 *     `SMOKE_PLUME_ROLE_KEY` doc comment, and `smoke-plume.ts`'s own top
 *     comment ("Colour runs the other way") for the full argument against
 *     using `reserved.vfx` here at all.
 *
 * The material recipe is NO LONGER shared, and the sentence that used to
 * stand here -- "nothing about how a zone's fragments are shaded differs
 * for smoke, only which zones exist and which palette entries they resolve
 * to" -- was the mistake, not a summary of one. `createVfxMeshMaterial`
 * (`./vfx-mesh-material.ts`) is flat, unlit and forced-OPAQUE, which is
 * exactly right for a thing that emits light and exactly wrong for a thing
 * that suspends in air: drawn through it, a plume is a solid three-tone
 * cutout stamped over the building it rose from. `smoke-plume.ts` now owns
 * `createSmokePlumeMaterial` instead -- see `SMOKE_PLUME_DENSITY` there for
 * the measurement. The zone -> palette table below is unchanged.
 */

export const SMOKE_PLUME_ROLES = ['base', 'mid', 'top'] as const;

export type SmokePlumeRole = (typeof SMOKE_PLUME_ROLES)[number];

export function isSmokePlumeRole(role: string): role is SmokePlumeRole {
  return (SMOKE_PLUME_ROLES as readonly string[]).includes(role);
}

/**
 * role -> the one `data/palette.json` `ramps.gunmetal` entry that zone
 * always resolves to, unconditionally -- never a ramp slice, never blended
 * with its neighbours, matching every other VFX-mesh zone in this backend
 * (`vfx-mesh-role.ts`'s own doc comment states the identical rule for its
 * own table).
 *
 * NOT `reserved.vfx` -- see `smoke-plume.ts`'s own top comment for the full
 * argument. In short: that band's own `role` text in `data/palette.json`
 * says it is reserved so "explosions and tracers pop against desaturated
 * terrain" -- saturated, attention-grabbing colour for a MOMENTARY effect.
 * Smoke is the opposite: an ambient, lingering haze that should blend with
 * desaturated terrain, not compete against it.
 *
 * `gunmetal` (not `shadow`, the OTHER dark/neutral ramp this file's data
 * ships) is chosen because its own `role` string is "weapons, tracks,
 * antennae, industrial" -- a grey-metal, sooty-industrial family that reads
 * as smoke off a burning hull or a collapsed structure's own core, where
 * `shadow`'s is "cast shadow, occlusion, interiors, night base": a
 * near-black tone family for OCCLUDING geometry, not a translucent-looking
 * airborne column. All three zones stay inside this ONE ramp rather than
 * mixing the two, so the gradient across zones is a single coherent hue
 * stepping only in VALUE (light/dark), never jumping hue families at a
 * zone boundary. This is also an ALREADY-ESTABLISHED reading in this
 * codebase, not a fresh guess: `data/vfx/vehicle_exhaust.json`'s own
 * particle layer already grades `["gunmetal.2", "gunmetal.1", "gunmetal.0"]`
 * (darker to lighter) for a vehicle's own driving exhaust.
 *
 * Index direction matters and is easy to get backwards --
 * `data/palette.json`'s own ramps descend in brightness, index 0 lightest
 * (CLAUDE.md: "The natural intuition... produces inverted output. This has
 * already cost three renders"). `gunmetal.colors` is `["#C3C7C4" (0,
 * lightest), "#8E9491" (1), "#5C625F" (2), "#363B39" (3, darkest)]`. This
 * table reads DESCENDING index from `base` to `top` on purpose: `base` (the
 * zone nearest the fire or wreck it rises from) is the DENSEST reading, so
 * it takes the DARKEST entry (index 3); `top` (the thinnest, most dispersed
 * zone) takes the LIGHTEST (index 0). Index 1 is deliberately skipped, not
 * omitted by accident: three zones sampling this four-stop ramp read more
 * clearly as "densest to thinnest" spread across the ramp's own full range
 * (3 -> 2 -> 0) than three adjacent stops bunched at the dark end
 * (3 -> 2 -> 1) would.
 */
const SMOKE_PLUME_ROLE_KEY: Readonly<Record<SmokePlumeRole, string>> = {
  base: 'gunmetal.3',
  mid: 'gunmetal.2',
  top: 'gunmetal.0',
};

export function smokePlumePaletteKey(role: SmokePlumeRole): string {
  return SMOKE_PLUME_ROLE_KEY[role];
}
