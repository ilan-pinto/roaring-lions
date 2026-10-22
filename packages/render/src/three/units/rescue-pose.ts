/**
 * Wounded and rescue, drawn (GH-707 P2, spec 2026-10-22-wounded-rescue-design
 * sections 4 and 7). Pure and three-free: what a wounded man, a treating medic
 * and a squad that has lost men should look like, as decisions the frame loop
 * applies. Nothing here reaches back into the sim (invariant 4).
 *
 * Everything is FEATURE-DETECTED by clip presence or by a type that declares
 * `hull.figures` above 1, so until the art and the content land every frame is
 * the one drawn before this file existed.
 *
 */
import { MED_CARRYING, MED_DELIVERING, MED_TREATING } from '@lions/sim';
import type { ClipName } from '../../sheet';

/**
 * The clip names the rescue states play, in ONE table, so the art pipeline and
 * the roster tests read the same list the renderer asks for. Each role lists
 * its preferred clip first; `*Fallback` is what is drawn when the GLB does not
 * carry it (null: leave the ordinary clip alone).
 */
export const RESCUE_CLIPS = {
  /** A `wounded`-role unit lying still (stabilised, or not moving). */
  woundedIdle: 'idleWounded',
  woundedIdleFallback: 'down',
  /** A `wounded`-role unit dragging itself along. No fallback: the ordinary `move` stays. */
  woundedMove: 'crawl',
  /** A medic treating a casualty. */
  medicTreat: 'treat',
  medicTreatFallback: 'kneel',
  /** A medic with a casualty on its stretcher. No fallback. */
  medicCarry: 'carry',
} as const satisfies Record<string, ClipName>;

/** Every clip name the table can ask a GLB for (what a medic or wounded rig may author). */
export const RESCUE_CLIP_NAMES: readonly ClipName[] = [
  RESCUE_CLIPS.woundedIdle,
  RESCUE_CLIPS.woundedIdleFallback,
  RESCUE_CLIPS.woundedMove,
  RESCUE_CLIPS.medicTreat,
  RESCUE_CLIPS.medicTreatFallback,
  RESCUE_CLIPS.medicCarry,
];

export interface RescuePoseInput {
  /** The unit's type has role `wounded`. */
  readonly isWounded: boolean;
  /** The unit's type has a `rescue` block (a medic). */
  readonly isMedic: boolean;
  /** `medState` column. */
  readonly medState: number;
  /** The unit is moving this frame. */
  readonly moving: boolean;
}

/**
 * The clip a wounded or medic unit overrides its ordinary one with, or null
 * to leave `resolveClip`'s answer alone (any other unit, any state with no
 * authored clip, a fallback the GLB cannot serve).
 */
export function rescueClipFor(input: RescuePoseInput, available: { has(name: ClipName): boolean }): ClipName | null {
  if (input.isWounded) {
    if (input.moving) return available.has(RESCUE_CLIPS.woundedMove) ? RESCUE_CLIPS.woundedMove : null;
    if (available.has(RESCUE_CLIPS.woundedIdle)) return RESCUE_CLIPS.woundedIdle;
    return available.has(RESCUE_CLIPS.woundedIdleFallback) ? RESCUE_CLIPS.woundedIdleFallback : null;
  }
  if (input.isMedic) {
    if (input.medState === MED_TREATING) {
      if (available.has(RESCUE_CLIPS.medicTreat)) return RESCUE_CLIPS.medicTreat;
      return available.has(RESCUE_CLIPS.medicTreatFallback) ? RESCUE_CLIPS.medicTreatFallback : null;
    }
    if (input.medState === MED_CARRYING || input.medState === MED_DELIVERING) {
      return available.has(RESCUE_CLIPS.medicCarry) ? RESCUE_CLIPS.medicCarry : null;
    }
  }
  return null;
}

/**
 * A casualty carried by a foot medic is not drawn: the medic's own `carry` clip
 * has him on its stretcher (the art spec's choice: one rig, no cross-entity
 * alignment). The same applies to a wounded man riding in a vehicle, which
 * draws nothing for a passenger it hides. Only a `wounded`-role unit is ever
 * hidden here, so no ordinary passenger's frame changes.
 */
export function woundedHiddenByCarry(isWounded: boolean, carriedBy: number): boolean {
  return isWounded && carriedBy >= 0;
}

/**
 * How many of a team's drawn figures are shown. `figures` is the type's
 * `hull.figures` F, `up` the sim's `figuresUp`, `drawn` the GLB's own
 * `rl_figures` count G. Null: this type takes no new path (F <= 1), and the
 * caller changes nothing. Otherwise the F shares are mapped onto G figures
 * proportionally (the hidden ones are the TOPMOST indices), and a living team
 * never loses its last figure.
 */
export function figuresShown(figures: number, up: number, drawn: number): number | null {
  if (figures <= 1 || drawn <= 0) return null;
  const clamped = Math.min(figures, Math.max(0, up));
  return Math.min(drawn, Math.max(1, Math.ceil((clamped * drawn) / figures)));
}
