/**
 * `rl_role` -> the RAMP SLICE that role shades through, for a mesh unit's
 * toon material (`mesh-material.ts`'s `toonRampSkinnedMaterial`).
 *
 * Promoted from Phase R0's spike (`spike/rig-scene.ts`'s `RAMP_FOR_ROLE`)
 * after the GO verdict (`docs/superpowers/specs/2026-08-28-phase-r0-verdict.md`).
 * `spike/rig-scene.ts` now imports this module rather than keeping its own
 * copy, so the mapping has exactly one source of truth.
 *
 * This is NOT `tools/render_team.py`'s `ROLE_PALETTE`, and copying that table
 * here would be the single most likely way to get this wrong. That pipeline
 * maps a role to ONE base colour at the LIGHTEST end of a ramp and then
 * MULTIPLIES it by a light -- its own comment says "a figure renders at
 * roughly half its base value", and `LIT_GAIN` exists to pre-brighten faces
 * and boots so the lit result lands where it was aimed. A toon LUT does not
 * multiply. It INDEXES. Feeding it `olive.0` would shade a uniform from
 * olive.0 toward black instead of stepping it down the olive ramp.
 *
 * So each role gets a slice spanning the values the sprite pipeline's LIT
 * result occupies, and the shader picks a step within it from `N·L`. Slices
 * rather than whole ramps because the sprite separates `webbing`
 * (`gunmetal.2`) from `metal` (`gunmetal.2`) from `weapon` (`gunmetal.3`) by
 * VALUE inside one ramp, and handing all three the whole gunmetal ramp would
 * collapse a distinction the art direction deliberately makes.
 *
 * ## What this table does NOT cover, on purpose
 *
 * `render_team.py`'s `ROLE_PALETTE` additionally splits `uniform` and
 * `webbing` BY FACTION: `{"kdf": {"uniform": "olive.0", "webbing":
 * "gunmetal.2"}, "enemy": {"uniform": "dust.0", "webbing": "olive.1"}}`
 * (`tools/units/teams.py`'s `FACTIONS` names which faction a given
 * `art/meshes/<team_id>.glb` belongs to). R0 judged exactly one team,
 * `inf_squad`, which is KDF -- its own verdict's "What R0 did NOT establish"
 * list says so outright: "the enemy `dust`-ramp figure is untested." The
 * slices below are therefore the KDF values only, and every mesh unit
 * currently shades `uniform`/`webbing` through them regardless of faction.
 * Extending this to the enemy figure needs its own visual judgement pass
 * (CLAUDE.md: "Approve art numbers before rendering") -- guessing a dust/
 * olive slice range here, with no figure to look at, is exactly the kind of
 * unapproved tuning number this project's own history warns against. See
 * the top-level report for this task for this gap named as a concern.
 */
import paletteJson from '../../../../../data/palette.json';

const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;

/**
 * A whole named ramp from `data/palette.json`, lightest step first (index 0).
 *
 * Exported so callers that need a bare ramp (`spike/rig-scene.ts`'s ground
 * plane colour, `ramp('limestone')[3]`) read `data/palette.json` through
 * this one function too, rather than keeping a second `paletteJson.ramps`
 * cast of their own.
 */
export function readRamp(name: string): readonly string[] {
  const entry = ramps[name];
  if (!entry) {
    throw new Error(`mesh-role: no ramp named "${name}" in data/palette.json`);
  }
  return entry.colors;
}

/**
 * The mesh unit contract's closed role vocabulary
 * (`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`: "Roles are a
 * closed set. The ten above, from `tools/render_team.py`'s `ROLE_PALETTE` /
 * `BODY_PALETTE` / `SHARED_PALETTE`.").
 */
export const MESH_ROLES = [
  'uniform',
  'webbing',
  'boot',
  'face',
  'skin_shadow',
  'metal',
  'weapon',
  'wood',
  'charge',
  'keffiyeh',
] as const;

export type MeshRole = (typeof MESH_ROLES)[number];

const RAMP_FOR_ROLE: Record<MeshRole, readonly string[]> = {
  // KDF uniform: the whole olive ramp, lightest-lit to darkest-shadow.
  uniform: readRamp('olive'),
  // Grey nylon against olive -- deliberately NOT a second step of the same
  // green, which `render_team.py` found "read as shading rather than as
  // equipment".
  webbing: readRamp('gunmetal').slice(1, 4),
  // Reddish-brown leather. Kept off terracotta.0 -- the sprite pipeline
  // clamps boots to 1.35 gain precisely because the top of that band "exists
  // for fired roof tile" and made boots read as glowing orange specks.
  boot: readRamp('terracotta').slice(1, 3),
  face: readRamp('skin'),
  // The darker skin variant. One step, so it reads flat -- it is a shadow
  // area on a figure that is ~25 px wide, not a surface that needs its own
  // shading.
  skin_shadow: readRamp('skin').slice(1, 2),
  metal: readRamp('gunmetal').slice(2, 4),
  weapon: readRamp('gunmetal').slice(2, 4),
  wood: readRamp('dust').slice(3, 6),
  charge: readRamp('gunmetal').slice(1, 3),
  keffiyeh: readRamp('limestone').slice(0, 3),
};

/** True for any role in the closed vocabulary above -- a type guard so
 *  `rampForRole`'s caller can distinguish "unknown role" from "known role,
 *  ramp lookup failed for some other reason" without a try/catch. */
export function isMeshRole(role: string): role is MeshRole {
  return Object.prototype.hasOwnProperty.call(RAMP_FOR_ROLE, role);
}

/**
 * The ramp slice a mesh role shades through.
 *
 * Throws loudly for any role outside the closed set -- per the contract,
 * "A role outside the set must be a loud failure on both sides, never a
 * default colour." Guessing a colour here would make an un-exported or
 * misspelled `rl_role` look plausible and be wrong.
 */
export function rampForRole(role: string): readonly string[] {
  if (!isMeshRole(role)) {
    throw new Error(`mesh-role: unknown rl_role "${role}" -- not in the closed role vocabulary`);
  }
  return RAMP_FOR_ROLE[role];
}
