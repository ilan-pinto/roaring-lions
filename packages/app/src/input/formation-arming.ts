/**
 * The armed combat formation (GH-859 P1a): which one is waiting for a click, how a key or a
 * button arms it, and how the click spends it.
 *
 * `main.ts` is not importable by a spec, and "R/T/Y arm nothing in a versus room" has to be seen
 * at the place the key lands, so the state and the three entry points live here and `main.ts`
 * wires them: the keydown `case`s call `press(action)`, the HUD's buttons call `activate(id)`,
 * the left click calls `spend(...)`, and Escape / right-click call `disarm()`. Pure of DOM and sim:
 * every read arrives through `deps`.
 *
 * Mutual exclusion with `armedOrder`, a support call, a work and a rally is the caller's
 * (`onArmed`): arming a formation disarms them there, and each of them nulls this one where it arms.
 *
 * The arm note ("column -- click open ground (Esc cancels)") is a promise about the NEXT click, so it is taken
 * back the moment that stops being true: on the click that spends it, on every way of putting it down, and when
 * another formation takes its place (`retire`). A key that cannot arm (an inert button) says why and leaves
 * whatever was armed armed; a key with no row at all says nothing.
 */
import { formationArmNote, formationReason, type FormationId, type FormationView } from '../ui/formation-model';
import { armFormationKey, issueFormation } from './formation';
import type { IntentWorld, OrderSink, Resolution } from './intents';
import type { Action } from './keymap';

export interface FormationArmingDeps {
  /** The row for the current selection with `armed` marked (`formationRow`); empty when there is none. */
  row(armed: FormationId | null): readonly FormationView[];
  /** Who a formation order is handed (own, living, selected, `formationIds`-filtered). */
  ids(): number[];
  world: IntentWorld;
  sink: OrderSink;
  /** `formationsOpenIn(netConfig?.mode)`. */
  open(): boolean;
  /** A formation has just been armed: disarm everything else that owns the next click. */
  onArmed(): void;
  /** The unit's formation class (`FM_CLASS_NONE` = none), for the resolver's `min_members` count. */
  classOf(id: number): number;
  /** Take back a note this arming posted (the HUD feed's `retireNote`): the same text and tone it was posted with. */
  retire(text: string, tone: 'info' | 'mute'): void;
}

export interface FormationArming {
  /** The armed formation, or null. */
  armed(): FormationId | null;
  /** A formation key: arms it (or, pressed again, puts it down). An inert button arms nothing, says why and leaves
   *  any other formation armed; a key with no row says nothing. Returns the id now armed, or null. */
  press(action: Action): FormationId | null;
  /** The row's button for `id` (same rules as its key). */
  activate(id: FormationId): FormationId | null;
  /** Put it down without sending anything (Escape, a right-click, the minimap). True when one was armed. */
  disarm(): boolean;
  /** A left-button drag (a box select) ended. The selection it makes is not the one the formation was armed for, and the
   *  next click would spend the arm on it, so the drag puts the formation down. True when one was armed. */
  drag(): boolean;
  /** The left click: send the formation to (x, y) and disarm. Null when none was armed. */
  spend(x: number, y: number, append: boolean): Resolution | null;
}

export function createFormationArming(deps: FormationArmingDeps): FormationArming {
  let armed: FormationId | null = null;
  /** The arm note on the feed, if it is still the live promise. */
  let note: string | null = null;

  /** Put it down, taking the arm note back. True when one was armed. */
  const putDown = (): boolean => {
    const was = armed !== null;
    armed = null;
    if (note !== null) {
      deps.retire(note, 'info');
      note = null;
    }
    return was;
  };

  /** An inert button is drawn dim but still answers: the reason is the answer (the order row's rule). */
  const say = (view: FormationView): void => {
    const why = formationReason(view);
    if (why !== null) deps.sink.note(why, 'mute');
  };

  const activate = (id: FormationId): FormationId | null => {
    const view = deps.row(armed).find((v) => v.id === id);
    if (view === undefined) {
      // No row (the selection shrank below two): nothing to say, and nothing left to arm.
      putDown();
      return null;
    }
    if (view.inert) {
      say(view);
      return null;
    }
    if (armed === id) {
      putDown();
      return null;
    }
    putDown();
    armed = id;
    deps.onArmed();
    note = formationArmNote(id);
    deps.sink.note(note, 'info');
    return id;
  };

  return {
    armed: () => armed,
    activate,
    press(action) {
      const row = deps.row(armed);
      // The pure rule (`armFormationKey`): a key arms its formation when the button is there and not inert.
      const id = armFormationKey(row, action);
      if (id !== null) return activate(id);
      const view = row.find((v) => v.key === action);
      if (view === undefined) putDown();
      else say(view);
      return null;
    },
    disarm: putDown,
    drag: putDown,
    spend(x, y, append) {
      if (armed === null) return null;
      const formation = armed;
      putDown();
      return issueFormation(deps.world, deps.sink, { ids: deps.ids(), formation, x, y, append, formationsOpen: deps.open(), classOf: deps.classOf });
    },
  };
}
