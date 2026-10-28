/**
 * The `kit_*` node contract, shared by `kit-pass.ts` (which writes kit nodes)
 * and `wreck-pass.ts` (which must never twin, measure or key one).
 *
 * A separate module rather than an export of either pass because each pass
 * already wants a constant from the other, and an import cycle between two
 * CLI entry points is the kind of thing that works until it does not.
 *
 * The contract itself is written down in
 * `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`, "v5 (vehicles)".
 */

/** Every kit part's node name starts with this, and nothing else's does. */
export const KIT_PREFIX = 'kit_';

/** True for a node the kit pass wrote (or a hand-made one claiming to be). */
export const isKitName = (name: string): boolean => name.startsWith(KIT_PREFIX);

/** A track name: lower-case letters only, so `kit_<track>_<tier>_<host>`
 *  parses back unambiguously however many underscores the host carries. */
export const KIT_TRACK_PATTERN = /^[a-z]+$/;

/** The highest tier a track has: tiers are 1, 2 and 3 (cumulative). */
export const KIT_MAX_TIER = 3;

/** The two levels of a kit part's geometric LOD (`rl_kit.lod`, GH-238
 *  leftovers): `near` is the real slat bars, drawn from the switch zoom up and
 *  in the garage; `far` the coarse bars that replace them below it. A part
 *  carries both or neither, beside its main node (no `lod`), which draws at
 *  every zoom. The runtime is `vehicle-kit.ts`'s `KIT_LOD_SWITCH`. */
export const KIT_LODS = ['near', 'far'] as const;
export type KitLod = (typeof KIT_LODS)[number];

/** The one name a kit part with this `rl_kit` may carry. */
export const kitNodeName = (track: string, tier: number, host: string, lod?: KitLod): string =>
  `${KIT_PREFIX}${track}_${tier}_${host}${lod === undefined ? '' : `_${lod}`}`;

/** The eight KDF vehicles that carry kit (spec §3, ruling K9 keeps the gunship
 *  and the command Lavi out). Here, with no dependency, so the kit pass and
 *  the draw-call harness (`tools/src/perf/kit-drawcalls.ts`) read one list. */
export const KIT_VEHICLES: readonly string[] = [
  'apc_eitan',
  'apc_kipod',
  'dozer_d9',
  'heli_peten',
  'ifv_namer',
  'jeep_shoded',
  'mbt_lavi',
  'scout_shachaf',
];

// ---------------------------------------------------------------------------
// The infantry kit (GH-826): skinned parts on a team's own skeleton
// ---------------------------------------------------------------------------
//
// A vehicle's kit part is rigid and sits beside its host with the host's
// local transform. A TEAM's kit part is skinned: it is rigid on ONE bone
// (JOINTS_0 = that joint, weight 1, so it rides that bone in every shipped
// clip) and hangs off the team's one skin. In the Blender SOURCE
// (`art/parts/inf_kit/<team>.glb`) it is a node of its own,
//
//   node name   kit_<track>_<tier>_<part>[_<L|R>]_<figure>   (`infantryKitNodeName`)
//   extras      rl_kit = { track, tier, host, part, figure, bone, slot?, side? }
//
// In the SHIPPING file the parts are PACKED, one node per host role primitive
// (`kit_uniform`, `kit_weapon`), each one primitive with the host's attributes
// plus `_RL_KIT` (the part's id per vertex) and `extras.rl_kit = { host, parts }`
// (`infantry-kit-pass.ts` `packHost` says why: 81 nodes cost +138 KiB encoded).
// `host` is a role primitive of the team (a role the team has no primitive for
// would be +1 draw call, so the graft refuses it), `bone` the bone without its
// figure prefix, `slot` a supersession group (only the HIGHEST bought tier in
// each (track, figure, slot, side) draws), `side` which of a pair it is.
// Same `kit_` prefix as the vehicles', so every pass that must never twin,
// measure or key a kit node already skips it.

/** The teams whose GLB carries kit. One at a time: each is a lane of its own. */
export const INFANTRY_KIT_TEAMS: readonly string[] = ['inf_squad'];

/** The role primitives a team's kit part may join. */
export const INFANTRY_KIT_HOSTS: readonly string[] = ['uniform', 'weapon'];

/** Budgets (spec 26 Oct, section 5.1). */
export const INFANTRY_KIT_FIGURE_TRIS = 1200; // one figure, every part it DRAWS at max kit
export const INFANTRY_KIT_FILE_TRIS = 5000; // every kit node in the file
/** A part may not exceed this multiple of its approved size (the vehicle rule). */
export const INFANTRY_KIT_PART_SLACK = 1.1;

/** The node name a skinned kit part may carry. */
export const infantryKitNodeName = (
  track: string,
  tier: number,
  part: string,
  figure: string,
  side?: string
): string => `${KIT_PREFIX}${track}_${tier}_${part}${side === undefined ? '' : `_${side}`}_${figure}`;

/**
 * Triangles per NODE as approved at render 1 (26-28 Oct): the per-part column
 * of the spec re-set from what was built, because twelve parts needed to be
 * bolder than the spec's sizes for a figure 23 px tall to show them. The graft
 * refuses a node over `INFANTRY_KIT_PART_SLACK` times its row.
 */
export const INFANTRY_KIT_PART_TRIS: Readonly<Record<string, number>> = {
  antenna_long: 32,
  antenna_short: 32,
  assault_pack: 56,
  collar: 48,
  counterweight: 44,
  eud_tablet: 56,
  foregrip: 44,
  grenade_pouches: 44,
  groin_flap: 12,
  helmet_cover: 102,
  ir_strobe: 24,
  mag_pouches: 36,
  nvg_mono: 22,
  nvg_mount: 56,
  nvg_quad: 100,
  optic_dot: 56,
  optic_mag: 84,
  plate_back: 12,
  plate_front: 44,
  radio_pouch: 44,
  shoulder: 68,
  side_plates: 44,
  suppressor: 70,
  upperarm_guard: 62,
  weapon_light: 34,
};
