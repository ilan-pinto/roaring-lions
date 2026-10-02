/**
 * Fire link: how the player reads WHO IS SHOOTING WHOM without a line.
 *
 * Until `proto/fire-link` the selected unit drew a 1 px duel line from
 * itself to its target, plus four corner brackets on the target
 * (`ThreeRenderer.updateOverlays`, "Engagement reticles"). The lead retired
 * the line: tracers, missiles and muzzle flashes now carry the fire itself,
 * and a straight line laid over them is a second, flatter copy of the same
 * fact. This module holds the concepts that replace it -- each one a
 * PRESENTATION choice and nothing else: every input is sim state the
 * renderer already reads (`curTarget`, the `fire` event), and nothing here
 * is written back (invariant 4).
 *
 * The concepts are prototypes, switchable in the sandbox by
 * `&firelink=<name>[,<name>...]` (`packages/app/src/sandbox-help.ts`), so
 * the lead can compare them in-engine before one is chosen:
 *
 *  - `ring`   -- a hostile-coloured ground ring under the selected unit's
 *                target (the selection-ring batch, +0 draw calls). The
 *                baseline, and the default on this branch.
 *  - `ticks`  -- the selected unit's own ring grows a notch toward its
 *                target, and a hostile notch toward every enemy whose target
 *                is the selected unit ("who is shooting me").
 *  - `owned`  -- the selected unit's own tracers, bolts and shells draw in a
 *                lightened team colour with a longer trail: the fire is the
 *                link.
 *  - `flash`  -- when a selected unit's round lands as a hit, the target's
 *                outline (the occlusion silhouette's own geometry, with a
 *                normal depth test) flashes hostile red for ~150 ms.
 *  - `pulse`  -- every shot the selected unit fires sends a ground ring
 *                contracting onto its target, so the ring beats with the
 *                fire cadence.
 *  - `legacy` -- the old brackets + duel line, kept only so a before/after
 *                capture is one URL apart.
 *  - `none`   -- nothing in the world at all.
 *
 * The unit card's "Engaging: <enemy>" line is DOM (`packages/app`), and it
 * shows for every concept except `legacy` and `none`.
 */

import type { FireLinkConcept } from '../../fire-link-concepts';

export type { FireLinkConcept };

/** The target ring sits this much wider than the target's own selection
 *  ring would, so it reads as "around" the unit rather than "under" it. */
export const TARGET_RING_SCALE = 1.15;

/** Seconds a pulse takes to contract onto its target. */
export const PULSE_S = 0.35;
/** A pulse starts this many times the target ring's radius. */
export const PULSE_START_SCALE = 2.2;

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
 * cosmetic flight ends (`ShellModel.duration`), a missile at the sim's own
 * projectile speed. Pure; the caller supplies the flight it already built.
 */
export function landingDelayS(flightS: number | null): number {
  return flightS === null ? 0 : Math.max(0, flightS);
}

/** Notch geometry, tiles: how far out from the ring's edge the tick starts
 *  and how long it runs, and the half-width of its arrowhead. */
export const NOTCH_GAP_TILES = 0.04;
export const NOTCH_LENGTH_TILES = 0.42;
export const NOTCH_HEAD_TILES = 0.16;
/** At most this many "shooting me" notches per selected unit. */
export const MAX_ATTACKER_NOTCHES = 6;

/**
 * A notch as three ground segments (shaft plus two arrowhead arms), in tile
 * space, pointing from `(cx, cy)` toward `(tx, ty)` outside a ring of radius
 * `r`. `inward` flips the arrowhead so it points AT the ring (an incoming
 * shot) rather than away from it (an outgoing one). Null when the two points
 * coincide.
 */
export function notchSegments(
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  r: number,
  inward: boolean
): [number, number, number, number][] | null {
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  const r0 = r + NOTCH_GAP_TILES;
  const r1 = r0 + NOTCH_LENGTH_TILES;
  const ax = cx + ux * r0;
  const ay = cy + uy * r0;
  const bx = cx + ux * r1;
  const by = cy + uy * r1;
  // The arrowhead's tip: the far end for an outgoing notch, the near end for
  // an incoming one; its arms reach back along the shaft.
  const [tipX, tipY, back] = inward ? [ax, ay, 1] : [bx, by, -1];
  const px = -uy;
  const py = ux;
  const h = NOTCH_HEAD_TILES;
  const baseX = tipX + ux * h * back;
  const baseY = tipY + uy * h * back;
  return [
    [ax, ay, bx, by],
    [tipX, tipY, baseX + px * h, baseY + py * h],
    [tipX, tipY, baseX - px * h, baseY - py * h],
  ];
}

/**
 * `hex` mixed toward white by `amount` (0..1). The owned-fire colour is
 * DERIVED from the resolved team hex rather than a new palette row -- the
 * same rule the range envelope's desaturated fill follows (ruling R-5) -- so
 * it follows the colour-vision variant for free.
 */
export function lightenHex(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h.slice(0, 6), 16);
  const ch = (shift: number): string => {
    const v = (n >> shift) & 0xff;
    return Math.round(v + (255 - v) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** The owned-fire colour slot in the tracer/shell colour lists: a side
 *  index no real side uses, so the batches' existing per-side lookup
 *  resolves it with no new branch. */
export const OWNED_FIRE_SIDE = 3;
/** How much toward white the owned colour sits. */
export const OWNED_FIRE_LIGHTEN = 0.35;
/** An owned round's trail runs this many times its kind's own. */
export const OWNED_TRAIL_SCALE = 2.2;
/** And its streak is this much wider. */
export const OWNED_WIDTH_SCALE = 1.4;
/** An owned tracer lingers this many times a normal one. 1 on purpose:
 *  a small-arms tracer is a FULL-SPAN ribbon (GH-149 kept it for a stream),
 *  so lengthening its life would put back exactly the shooter-to-target line
 *  this branch retires -- measured in the first capture pass at 2.5. */
export const OWNED_TRACER_LIFE_SCALE = 1;
