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

/**
 * Which side a mesh unit fights for. Only two roles shade differently by
 * faction, so this is a parameter rather than a second whole table -- exactly
 * the shape `tools/render_team.py` already uses, where `ROLE_PALETTE` is keyed
 * by faction and carries ONLY `uniform`/`webbing`, while `BODY_PALETTE` and
 * `SHARED_PALETTE` are faction-blind ("a rifle is a rifle on either side").
 *
 * `civilian` is a third SIDE, not a third army -- `data/units/civilians.json`
 * declares `"faction": "civilian"` and the sim spawns them on side 2. It was
 * added with GH-149's four figures, and it is not decoration: `rampForRole`
 * REQUIRES a faction, so wiring a civilian mesh meant choosing one of the two
 * that existed, and both answers were wrong in a way that costs the player
 * points. Through `kdf` a civilian wears the same olive as a rifle squad and
 * reads as friendly infantry; through `enemy` it wears militia tan and reads
 * as something to shoot, which the ROE system then deducts for
 * (`mission.ts`'s `civilian_casualty_penalty`). See `FACTION_RAMPS` for what
 * the third row shades through and why that colour.
 */
export type MeshFaction = 'kdf' | 'enemy' | 'civilian';

/**
 * The two roles that differ by side, and they are INVERTED rather than tinted.
 *
 * `render_team.py` explains the design and it is worth not flattening: KDF wear
 * grey nylon webbing over olive; the militia wear *olive* gear over tan cloth --
 * "scavenged and mismatched, which is what an irregular cell should look like
 * and which keeps the two factions' dominant tones apart regardless." So the
 * enemy is not "KDF in a different green"; the two ramps swap roles between the
 * cloth and the kit.
 *
 * Before this existed, every mesh unit shaded through the KDF rows below
 * regardless of side -- Phase R0 only ever tested one faction, and five enemy
 * teams shipped meshes before anyone had rendered one. An enemy squad came out
 * in KDF olive, which reads as the wrong ARMY rather than as a wrong colour.
 */
const FACTION_RAMPS: Record<MeshFaction, { uniform: readonly string[]; webbing: readonly string[] }> =
  {
    kdf: {
      // The whole olive ramp, lightest-lit to darkest-shadow.
      uniform: readRamp('olive'),
      // Grey nylon against olive -- deliberately NOT a second step of the same
      // green, which `render_team.py` found "read as shading rather than as
      // equipment".
      webbing: readRamp('gunmetal').slice(1, 4),
    },
    enemy: {
      // Tan cloth. `ROLE_PALETTE`'s enemy base is `dust.0`; dust is a 7-step
      // ramp, so this takes the light half rather than all of it -- the full
      // ramp bottoms out near `dust.6` (#6B4F29) and would read as a much
      // darker figure than the sprite, which lights DOWN from dust.0 rather
      // than stepping the whole way to the bottom.
      uniform: readRamp('dust').slice(0, 5),
      // Olive gear over tan, the mirror of KDF's grey-over-olive.
      // `ROLE_PALETTE`'s enemy webbing base is `olive.1`.
      webbing: readRamp('olive').slice(1, 4),
    },
    civilian: {
      // The `water` ramp: a soft blue-grey, and the only hue in
      // `data/palette.json` that is neither of the two an army wears. The
      // candidates were rendered side by side against an olive KDF figure and
      // a dust militia one before this was chosen (task report, GH-149), and
      // the near miss is the instructive one: `limestone`, the obvious
      // "civilian sand-cloth" answer, came out a near twin of the enemy's own
      // dust at gameplay value -- exactly the confusion this row exists to
      // prevent. Blue is also what the sources themselves wear (a navy
      // tunic, a pale blue shirt, blue jeans -- three of the four figures).
      //
      // Two steps rather than a slice of a longer ramp, because `water` only
      // has two. That is fine for the same reason `skin_shadow` gets away
      // with one: the toon shader INDEXES a ramp rather than multiplying by
      // it, so a two-step ramp is a two-band figure, not a broken one.
      //
      // `water` is a terrain ramp by origin and is unused by terrain: only
      // `tools/render_campaign_map.py` and `render_campaign_world.py` name it,
      // both for the strategic map screen, and no in-mission terrain or map
      // symbol draws water at all. Checked before choosing it.
      uniform: readRamp('water'),
      // No shipped civilian mesh carries a `webbing` role and none may --
      // GH-149's "no webbing, no pouches, no weapon" is what keeps a
      // non-combatant readable as one. `tools/civilian_roles.py`'s
      // `FORBIDDEN_ROLES` states it, its own test asserts no figure's table
      // names one, and `civilian-mesh-shipped.test.ts` asserts the shipped
      // GLBs carry none. This entry exists only because the record demands
      // every faction answer for both roles; it is the same cloth ramp as
      // `uniform` so that a role which must never appear could not, if it
      // somehow did, read as military kit.
      webbing: readRamp('water'),
    },
  };

/** Roles that shade the same on either side. `render_team.py`'s own division:
 *  its `ROLE_PALETTE` carries only uniform and webbing per faction, because
 *  "a rifle is a rifle on either side". */
const SHARED_RAMP_FOR_ROLE: Record<
  Exclude<MeshRole, 'uniform' | 'webbing'>,
  readonly string[]
> = {
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
 *  ramp lookup failed for some other reason" without a try/catch.
 *
 *  Keyed off `MESH_ROLES` rather than off either ramp table, so it stays
 *  correct however the tables are split by faction. Deriving it from a table
 *  was safe when there was one; with two, a role present in only one of them
 *  would silently change what counts as "known". */
export function isMeshRole(role: string): role is MeshRole {
  return (MESH_ROLES as readonly string[]).includes(role);
}

/**
 * The ramp slice a mesh role shades through, for a given side.
 *
 * `faction` is REQUIRED rather than defaulted to `'kdf'`. A default would make
 * the exact bug this parameter exists to fix -- an enemy unit shading in KDF
 * colours -- reachable again by simply forgetting the argument, and it would
 * compile and render plausibly. The contract's own rule for roles applies here
 * too: wrong colour must not be the quiet path.
 *
 * Throws loudly for any role outside the closed set -- per the contract,
 * "A role outside the set must be a loud failure on both sides, never a
 * default colour." Guessing a colour here would make an un-exported or
 * misspelled `rl_role` look plausible and be wrong.
 */
export function rampForRole(role: string, faction: MeshFaction): readonly string[] {
  if (!isMeshRole(role)) {
    throw new Error(`mesh-role: unknown rl_role "${role}" -- not in the closed role vocabulary`);
  }
  if (role === 'uniform' || role === 'webbing') {
    return FACTION_RAMPS[faction][role];
  }
  return SHARED_RAMP_FOR_ROLE[role];
}
