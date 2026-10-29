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
 */
import { t } from '../i18n/t';
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
}

export interface FormationArming {
  /** The armed formation, or null. */
  armed(): FormationId | null;
  /** A formation key: arms it (or, pressed again, puts it down). An inert or absent button arms
   *  nothing and says why. Returns the id now armed, or null. */
  press(action: Action): FormationId | null;
  /** The row's button for `id` (same rules as its key). */
  activate(id: FormationId): FormationId | null;
  /** Put it down without sending anything (Escape, a right-click, the minimap). True when one was armed. */
  disarm(): boolean;
  /** The left click: send the formation to (x, y) and disarm. Null when none was armed. */
  spend(x: number, y: number, append: boolean): Resolution | null;
}

export function createFormationArming(deps: FormationArmingDeps): FormationArming {
  let armed: FormationId | null = null;

  const activate = (id: FormationId): FormationId | null => {
    const view = deps.row(armed).find((v) => v.id === id);
    if (view === undefined) {
      deps.sink.note(t('hud.formation.inert.needsTwo'), 'mute');
      armed = null;
      return null;
    }
    if (view.inert) {
      // The button is drawn dim but still answers: the reason is the answer (the order row's rule).
      const why = formationReason(view);
      if (why !== null) deps.sink.note(why, 'mute');
      armed = null;
      return null;
    }
    if (armed === id) {
      armed = null;
      return null;
    }
    armed = id;
    deps.onArmed();
    deps.sink.note(formationArmNote(id), 'info');
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
      if (view === undefined) deps.sink.note(t('hud.formation.inert.needsTwo'), 'mute');
      else {
        const why = formationReason(view);
        if (why !== null) deps.sink.note(why, 'mute');
      }
      armed = null;
      return null;
    },
    disarm() {
      const was = armed !== null;
      armed = null;
      return was;
    },
    spend(x, y, append) {
      if (armed === null) return null;
      const formation = armed;
      armed = null;
      return issueFormation(deps.world, deps.sink, { ids: deps.ids(), formation, x, y, append, formationsOpen: deps.open() });
    },
  };
}
