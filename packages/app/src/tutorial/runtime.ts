/**
 * The teaching state machine — a pure reducer.
 *
 * It holds no `Sim`. It cannot queue a command because it has no object that
 * accepts one, so no step data can move the determinism hash (invariant 4 by
 * construction rather than by review discipline).
 *
 * Pure and DOM-free on purpose. The render loop only advances under
 * `requestAnimationFrame`, which does not run while the page is hidden, so
 * anything only observable by watching the game cannot be verified. All the
 * logic that can be wrong lives here; `panel.ts` stays thin enough to check by
 * eye.
 */

import type { MissionEvent, SimEvent } from '@lions/sim';
import type { PlayerIntent } from '../input/intents';

export interface PredicateJson {
  kind: 'intent' | 'sim' | 'mission' | 'elapsed_s' | 'all_of' | 'any_of';
  intent?: string;
  verb?: 'move' | 'attackMove';
  via?: 'click' | 'box' | 'group';
  action?: 'assign' | 'recall';
  event?: string;
  side?: number;
  by_unit?: string;
  loaded?: boolean;
  seconds?: number;
  of?: PredicateJson[];
}

export interface StepJson {
  id: string;
  title: string;
  teach: string;
  await: PredicateJson;
  focus?: { kind: 'marker' | 'zone' | 'none'; marker?: string; zone?: string };
  nudge_after_s?: number;
  nudge?: string;
}

/** What the runtime can be told about. `sideOf` and `typeIdOf` are read-only
 *  lookups the caller supplies — the runtime never holds the sim itself. */
export type TutorialInput =
  | { kind: 'intent'; intent: PlayerIntent }
  | { kind: 'sim'; event: SimEvent; sideOf: (entity: number) => number; typeIdOf?: (entity: number) => string }
  | { kind: 'mission'; event: MissionEvent }
  | { kind: 'tick' };

export interface TutorialState {
  readonly steps: readonly StepJson[];
  /** Index of the open step; equals `steps.length` when finished. */
  readonly index: number;
  readonly done: boolean;
  /** `nowMs` at which the open step became open. */
  readonly openedAtMs: number;
  readonly nudging: boolean;
  /** Which children of an `all_of` have been seen for the open step. */
  readonly seen: readonly boolean[];
}

/**
 * `nowMs` is the caller's clock at construction time, not a hardcoded 0.
 * Seeding `openedAtMs` at 0 while the caller measures elapsed time from
 * `performance.now()` made step 1's nudge timer run from page load instead of
 * from when the tutorial actually opened, so a nudge could fire before the
 * player's first frame.
 */
export function initTutorial(steps: readonly StepJson[], nowMs: number): TutorialState {
  return { steps, index: 0, done: steps.length === 0, openedAtMs: nowMs, nudging: false, seen: [] };
}

/** Does one predicate match this input? Composition is handled by the caller
 *  for `all_of`, which needs to accumulate across inputs. */
export function matches(
  pred: PredicateJson,
  input: TutorialInput,
  openedAtMs: number,
  nowMs: number
): boolean {
  switch (pred.kind) {
    case 'intent': {
      if (input.kind !== 'intent') return false;
      const i = input.intent;
      if (i.kind !== pred.intent) return false;
      if (pred.verb !== undefined && (i.kind !== 'order' || i.verb !== pred.verb)) return false;
      if (pred.via !== undefined && (i.kind !== 'select' || i.via !== pred.via)) return false;
      if (pred.action !== undefined && (i.kind !== 'group' || i.action !== pred.action)) return false;
      return true;
    }
    case 'sim': {
      if (input.kind !== 'sim') return false;
      const e = input.event;
      if (e.kind !== pred.event) return false;
      if (pred.side !== undefined) {
        const subject = 'entity' in e ? e.entity : 'target' in e ? e.target : -1;
        if (subject < 0 || input.sideOf(subject) !== pred.side) return false;
      }
      if (pred.by_unit !== undefined) {
        if (!('by' in e) || input.typeIdOf === undefined) return false;
        if (input.typeIdOf(e.by) !== pred.by_unit) return false;
      }
      if (pred.loaded !== undefined) {
        if (e.kind !== 'transport' || e.loaded !== pred.loaded) return false;
      }
      return true;
    }
    case 'mission':
      return input.kind === 'mission' && input.event.kind === pred.event;
    case 'elapsed_s':
      return nowMs - openedAtMs > (pred.seconds ?? 0) * 1000;
    case 'any_of':
      return (pred.of ?? []).some((p) => matches(p, input, openedAtMs, nowMs));
    case 'all_of':
      // Accumulated in `advance` — a single input cannot satisfy every child,
      // so this always returns false here. That makes `all_of` valid only as
      // a step's top-level `await`: a nested `all_of` (inside another
      // predicate's `of`) would always hit this branch and could never be
      // satisfied, stalling the tutorial with no signal in the state pointing
      // at the cause. The schema enforces this — `predicate.of` items are
      // typed as `nestedPredicate`, whose `kind` enum omits `all_of` — so the
      // unsatisfiable shape cannot be authored, not just discouraged.
      return false;
  }
}

/**
 * Fold one input into the state.
 *
 * Advances at most one step per input: two consecutive steps awaiting the same
 * thing must not both clear on one action, or a lesson goes by unseen.
 */
export function advance(state: TutorialState, input: TutorialInput, nowMs: number): TutorialState {
  if (state.done) return state;
  const step = state.steps[state.index];
  if (step === undefined) return { ...state, done: true };

  let satisfied: boolean;
  let seen = state.seen;
  if (step.await.kind === 'all_of') {
    const children = step.await.of ?? [];
    const marks = seen.length === children.length ? [...seen] : children.map(() => false);
    for (let k = 0; k < children.length; k++) {
      if (!marks[k] && matches(children[k], input, state.openedAtMs, nowMs)) marks[k] = true;
    }
    seen = marks;
    satisfied = marks.every(Boolean);
  } else {
    satisfied = matches(step.await, input, state.openedAtMs, nowMs);
  }

  if (satisfied) {
    const index = state.index + 1;
    return {
      steps: state.steps,
      index,
      done: index >= state.steps.length,
      openedAtMs: nowMs,
      nudging: false,
      seen: [],
    };
  }

  const nudging =
    step.nudge_after_s !== undefined && nowMs - state.openedAtMs > step.nudge_after_s * 1000;
  if (nudging === state.nudging && seen === state.seen) return state;
  return { ...state, nudging, seen };
}
