/**
 * Fire link: how the player reads WHO IS SHOOTING WHOM without a line.
 *
 * Until 2 Oct 2026 the selected unit drew a 1 px duel line from itself to
 * its target, plus four corner brackets on the target
 * (`ThreeRenderer.updateOverlays`, "Engagement reticles"). The lead retired
 * it: tracers, missiles and muzzle flashes now carry the fire itself, and a
 * straight line laid over them is a second, flatter copy of the same fact.
 * Five replacements were prototyped in-engine on `proto/fire-link`; the
 * lead chose three, and only those ship:
 *
 *  - **pulse** -- every shot the selected unit fires sends a ground ring
 *    contracting onto its target, so the link beats with the unit's own rate
 *    of fire and goes quiet when it stops (`ThreeRenderer.drawFireLinkOverlays`,
 *    in the overlay batch: +0 draw calls);
 *  - **hit flash** -- when one of the selected unit's rounds visibly lands
 *    as a hit, the target's outline (the occlusion silhouette's own
 *    geometry, with no depth test) flashes red and wide for `HIT_FLASH_S`, so
 *    it reads through cover too (a material swap on meshes that already
 *    draw: +0 draw calls);
 *  - **the card** -- "Engaging: <enemy>" with the enemy's portrait
 *    (`packages/app/src/ui/hud.ts`, DOM).
 *
 * Rejected, measured and photographed on the prototype branch: a static
 * ring under the target (hidden whenever the target stands behind a wall),
 * directional ticks on the selection ring (about 10 px at zoom 1), and
 * team-coloured "owned" fire (on a machine gun it redrew the line in blue).
 *
 * Presentation only. Every input is sim state the renderer already reads --
 * `curTarget`, the `fire` event -- and nothing here is written back
 * (invariant 4). The pulse and flash age on the clamped frame clock, never a
 * sim tick.
 */

/** A pulse's starting ring sits this much wider than the target's own
 *  selection ring would, so it reads as "around" the unit. */
export const TARGET_RING_SCALE = 1.15;

/** Seconds a pulse takes to contract onto its target. */
export const PULSE_S = 0.35;
/** A pulse starts this many times the target ring's radius. */
export const PULSE_START_SCALE = 2.2;
/** At most one pulse per target per this many seconds: a machine gun fires
 *  every 3 ticks, and a ring per event stacked five deep in the prototype. */
export const PULSE_MIN_GAP_S = PULSE_S * 0.6;

/** Radius multiplier and alpha of a pulse `ageS` seconds old, or null once
 *  it has landed. Ease-out: fast at first, settling onto the ring. */
export function pulseAt(ageS: number): { scale: number; alpha: number } | null {
  if (ageS < 0 || ageS >= PULSE_S) return null;
  const k = ageS / PULSE_S;
  const eased = 1 - (1 - k) * (1 - k);
  return { scale: PULSE_START_SCALE + (1 - PULSE_START_SCALE) * eased, alpha: 0.9 * (1 - k * k) };
}

/** Seconds the hit-flash outline holds. */
export const HIT_FLASH_S = 0.15;
/** The flash outline's width as a multiple of the occlusion outline's. */
export const HIT_FLASH_WIDTH_SCALE = 1.8;

/**
 * Seconds from a `fire` event to the round visibly landing, for scheduling
 * the hit flash: a tracer lands at once, a travelling round when its own
 * cosmetic flight ends (`ShellModel.duration`, the first streak of a burst),
 * a missile at the sim's own projectile speed. Pure; the caller supplies the
 * flight it already built.
 */
export function landingDelayS(flightS: number | null): number {
  return flightS === null ? 0 : Math.max(0, flightS);
}
