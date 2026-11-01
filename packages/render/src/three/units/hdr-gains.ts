/**
 * The ONE table of HDR brightness gains for effects (Defilade T4, D2/D9).
 *
 * An effect's authored colour is still a palette key; its BRIGHTNESS may
 * exceed 1 as a gain on that (linear) colour. Phase 0 retired the per-pixel
 * palette rule (CLAUDE.md, "The colour pipeline"), and the PM ruled (D9,
 * reversible by the lead) that HDR gains are consistent with that. The gains
 * are what let an emitter cross the bloom pass's scene-referred threshold
 * (1.0, `../bloom.ts`) while sunlit sand (about 0.7 linear at most) does not.
 *
 * Where each is applied:
 *  - muzzle*   `muzzle-flash.ts` `setColors`, per zone role.
 *  - burst*    `explosion-burst.ts` `setColors`, per zone role.
 *  - bolt/arc  `fx.ts` `ShellBatch`'s tracer material `uHdr`: bolt for the
 *              depth-tested batch, arc for the other.
 *  - streakKind  `fx.ts` `writeShellInstances`, a per-kind factor on the
 *              vertex colour, relative to the bolt/arc gain above.
 *  - sparks    `fx.ts` `createParticleMaterial(_, hotCore=true)`. The missile
 *              core glow (`missile-fx.ts`) draws through that same hotCore
 *              material, so it gets this 4 -- the same number as burstMid;
 *              no separate role was added.
 *  - fireball  `flipbook-fx.ts`'s `uFireGain`: the fire type's hot phase
 *              (white_hot/fire for its first ~16% of life).
 *  - beam*     `beam-batch.ts` (E6 chunk C), as a factor on the vertex colour of the
 *              core ribbon, the ember sheath and the lens/target glows.
 *
 * Known pre-existing HDR source NOT in this table: the tunnel x-ray
 * discovery beat is already above 1.0 on main and is accepted to glow.
 */
export const HDR_GAINS = Object.freeze({
  muzzleCore: 10,
  muzzleMid: 5,
  muzzleOuter: 2.2,
  burstCore: 8,
  burstMid: 4,
  burstOuter: 1.8,
  bolt: 4,
  arc: 3.5,
  sparks: 4,
  fireball: 2.6,
  // E6 chunk C (units/beam-batch.ts): a laser carrier's beam. The core is a bolt-hot streak; the
  // ember sheath stays just over the bloom threshold, so the beam blooms from its core outward.
  beamCore: 4,
  beamSheath: 1.6,
  beamGlow: 2.4,
  // grenade: a DARK round (GH-709 P2): 3.5 (arc) x 0.06 keeps the ember
  // colour about 0.2 of itself, under the bloom threshold -- no glow.
  streakKind: Object.freeze({ rifle: 0.45, mg: 0.6, grenade: 0.06 }),
  // The grenade's GLINT (the lead, 22 Oct: "a faint glint so it reads at zoom
  // 1"): its HEAD segment only, at this gain on the same shell colour. 3.5 (arc)
  // x 0.4 = 1.4, so a full-red channel sits just over the bloom threshold: a
  // small bright point that blooms faintly, on a body that still does not.
  grenadeGlint: 0.4,
  // GH-941: the ceiling on `hostileBoltGain`. The ratio of the own tracer's
  // luminance to the hostile colour's is about 4.6 for the shipped palette and
  // about 3.7 in the colour-vision variants; 12 is a runaway guard for a
  // palette edit, not a look.
  hostileBoltMax: 12,
});

export type HdrZoneRole = 'core' | 'mid' | 'outer';

export function muzzleGain(role: HdrZoneRole): number {
  return role === 'core' ? HDR_GAINS.muzzleCore : role === 'mid' ? HDR_GAINS.muzzleMid : HDR_GAINS.muzzleOuter;
}

export function burstGain(role: HdrZoneRole): number {
  return role === 'core' ? HDR_GAINS.burstCore : role === 'mid' ? HDR_GAINS.burstMid : HDR_GAINS.burstOuter;
}

/** The factor on the HEAD segment of a shell streak: the grenade's glint, and
 *  the kind's own `streakKindGain` for every other kind (no glint). */
export function streakHeadGain(kind: string): number {
  return kind === 'grenade' ? HDR_GAINS.grenadeGlint : streakKindGain(kind);
}

/** Per-kind factor on a shell streak's colour (1 for every other kind). */
export function streakKindGain(kind: string): number {
  if (kind === 'rifle') return HDR_GAINS.streakKind.rifle;
  if (kind === 'mg') return HDR_GAINS.streakKind.mg;
  if (kind === 'grenade') return HDR_GAINS.streakKind.grenade;
  return 1;
}

/**
 * GH-941: the gain a HOSTILE bolt's colour is multiplied by so it blooms as
 * much as the own side's.
 *
 * Bloom thresholds LINEAR LUMINANCE (`../bloom.ts`, `BLOOM_THRESHOLD` 1.0), not
 * a channel. The own tracer, `vfx.tracer` lime, is luminous (about 0.82 linear)
 * and the bolt's 4x gain takes it to 3.3, so it throws a halo. A red is not: the
 * hostile team colour is about 0.18, and 4x takes it to 0.7, under the
 * threshold, so the same autocannon round drew with no glow at all on the enemy
 * side. Scaling the hostile colour by `ownLuminance / hostileLuminance` puts both
 * streaks at the same pre-bloom luminance, and therefore the same halo energy;
 * only the hue differs, which is what the lead asked for. Both arguments are the
 * LINEAR luminance of the streak colour BEFORE any gain (`linearLuminance`).
 * Capped at `HDR_GAINS.hostileBoltMax`; a non-positive luminance gives 1.
 */
export function hostileBoltGain(ownLuminance: number, hostileLuminance: number): number {
  if (!(ownLuminance > 0) || !(hostileLuminance > 0)) return 1;
  return Math.min(HDR_GAINS.hostileBoltMax, Math.max(1, ownLuminance / hostileLuminance));
}
