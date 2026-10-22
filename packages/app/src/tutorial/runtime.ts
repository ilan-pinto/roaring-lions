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
import type { FireState } from '../ui/fire-state';
import type { HudElement } from '../ui/hud-elements';

export interface PredicateJson {
  kind: 'intent' | 'sim' | 'mission' | 'elapsed_s' | 'all_of' | 'any_of' | 'hover' | 'camera' | 'production';
  intent?: string;
  verb?: 'move' | 'attackMove';
  via?: 'click' | 'box' | 'group';
  action?: 'assign' | 'recall';
  append?: boolean;
  event?: string;
  side?: number;
  by_unit?: string;
  loaded?: boolean;
  seconds?: number;
  of?: PredicateJson[];
  target?: 'enemy' | 'structure' | 'any';
  /** hover only (GH-345): what the projected-fire panel says about the
   *  hovered enemy -- `ui/fire-state.ts`'s word for it. Implies an enemy. */
  projection?: Exclude<FireState, 'holding'>;
  /** mission only (GH-345): the trigger or objective id the event carries. */
  id?: string;
  /** camera only (GH-345): tiles the view's centre has moved from where it
   *  stood when the tutorial started. */
  tiles?: number;
  /** production only (GH-184): some living line of the player's holds at
   *  least this many items, the one building included. */
  queued?: number;
  /** production only: whether any living line of the player's has a rally. */
  rally?: boolean;
  /** production only: a line's contested state CHANGED while it was building
   *  -- `paused` on false -> true, `resumed` on true -> false. An edge, not a
   *  state, so an `all_of` of the two cannot be marked out of order. */
  edge?: ProductionEdge;
}

export type ProductionEdge = 'paused' | 'resumed';

export interface StepJson {
  id: string;
  title: string;
  teach: string;
  await: PredicateJson;
  focus?: { kind: 'marker' | 'zone' | 'none'; marker?: string; zone?: string };
  nudge_after_s?: number;
  nudge?: string;
  /** HUD elements added when this step opens (GH-345, `hud-visibility.ts`). */
  reveal?: HudElement[];
}

/** What the runtime can be told about. `sideOf` and `typeIdOf` are read-only
 *  lookups the caller supplies — the runtime never holds the sim itself. */
export type TutorialInput =
  | { kind: 'intent'; intent: PlayerIntent }
  | { kind: 'sim'; event: SimEvent; sideOf: (entity: number) => number; typeIdOf?: (entity: number) => string }
  | { kind: 'mission'; event: MissionEvent }
  | { kind: 'tick' }
  | {
      kind: 'hover';
      entity: number;
      structure: number;
      sideOf: (entity: number) => number;
      /** What the fire panel says about `entity` for the current selection,
       *  or null when it says nothing (no selection, not an enemy). */
      projection?: FireState | null;
    }
  /** How far the view's centre has moved from where the tutorial found it,
   *  in tiles. The caller measures; the runtime only compares. */
  | { kind: 'camera'; tilesFromStart: number }
  /** The player's production lines as the caller read them this tick
   *  (`productionInput`). `edge` is set only on the input that reports one. */
  | { kind: 'production'; queued: number; rally: boolean; edge: ProductionEdge | null };

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
      if (pred.append !== undefined && (i.kind !== 'order' || i.append !== pred.append)) return false;
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
    case 'mission': {
      if (input.kind !== 'mission' || input.event.kind !== pred.event) return false;
      // R-F4-1: only our own purchases are the player's `built`.
      if (input.event.kind === 'built' && input.event.side !== 0) return false;
      if (pred.id === undefined) return true;
      // Only `trigger` and `objective` carry an authored id; every other
      // event's id-shaped field is an entity number, which an authored
      // string can never name.
      const e = input.event;
      return (e.kind === 'trigger' || e.kind === 'objective') && e.id === pred.id;
    }
    case 'camera':
      return input.kind === 'camera' && input.tilesFromStart >= (pred.tiles ?? 1);
    case 'production': {
      if (input.kind !== 'production') return false;
      if (pred.edge !== undefined) return input.edge === pred.edge;
      // A production predicate that names nothing would match every tick;
      // steps.test.ts refuses one in shipped data, and this refuses it here.
      if (pred.queued === undefined && pred.rally === undefined) return false;
      if (pred.queued !== undefined && input.queued < pred.queued) return false;
      if (pred.rally !== undefined && input.rally !== pred.rally) return false;
      return true;
    }
    case 'hover': {
      if (input.kind !== 'hover') return false;
      const want = pred.target ?? 'any';
      const onEnemy = input.entity >= 0 && input.sideOf(input.entity) === 1;
      const onStructure = input.structure >= 0;
      if (pred.projection !== undefined) return onEnemy && input.projection === pred.projection;
      if (want === 'enemy') return onEnemy;
      if (want === 'structure') return onStructure;
      // 'any': hovering literally anything -- any entity regardless of side,
      // or a structure -- not narrowed to `onEnemy`, which would reject a
      // hover over your own unit.
      return input.entity >= 0 || onStructure;
    }
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

/** The read of one production line `productionInputs` needs -- a subset of
 *  `MissionRuntime.productionLines(0)`'s rows, so a test can hand in literals. */
export interface TutorialLineView {
  readonly alive: boolean;
  readonly current: string | null;
  /** Waiting items, the one building excluded. */
  readonly queued: number;
  readonly contested: boolean;
  readonly rally: unknown;
}

/**
 * Turn this tick's production lines into the reducer's inputs (GH-184): one
 * state input, then one input per contested edge. `prevContested` is what the
 * caller kept from the last call (start with `[]`); the returned `contested`
 * replaces it. Pure: the caller reads the lines, this only compares -- the
 * tutorial still holds no `Sim` and can queue nothing.
 *
 * `contested` is only ever true while a line is building (the runtime's own
 * rule), so a `paused` edge is always a build stopping. A line that is lost
 * reads uncontested, which is a `resumed` edge: the clock is not running, but
 * nothing contests it any more either, and a beat waiting on it should not wait
 * for a camp that will never build again.
 */
export function productionInputs(
  prevContested: readonly boolean[],
  lines: readonly TutorialLineView[]
): { inputs: TutorialInput[]; contested: boolean[] } {
  let queued = 0;
  let rally = false;
  const contested: boolean[] = [];
  const edges: ProductionEdge[] = [];
  lines.forEach((l, i) => {
    const now = l.alive && l.contested;
    contested.push(now);
    const was = prevContested[i] === true;
    if (now && !was) edges.push('paused');
    if (!now && was) edges.push('resumed');
    if (!l.alive) return;
    queued = Math.max(queued, l.queued + (l.current === null ? 0 : 1));
    if (l.rally !== null && l.rally !== undefined) rally = true;
  });
  const inputs: TutorialInput[] = [{ kind: 'production', queued, rally, edge: null }];
  for (const edge of edges) inputs.push({ kind: 'production', queued, rally, edge });
  return { inputs, contested };
}
