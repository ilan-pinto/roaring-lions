/**
 * The keyboard, as data. `main.ts`'s keydown listener used to be an if-chain
 * of literals and `selection-model.ts`'s ORDERS carried a second copy of the
 * same letters for display; nothing kept them in step and nothing could
 * rebind either. Both read this table now. Keys are stored lower-case as
 * `KeyboardEvent.key` reports them (`'h'`, `'arrowup'`, `'escape'`).
 *
 * Deliberately NOT in the table: the control groups (ctrl+digit assigns, digit
 * recalls), which every RTS player expects on exactly those keys, and the
 * digit keys are refused as bindings for that reason.
 */
export type Action =
  | 'halt' | 'smoke' | 'load' | 'unload' | 'overlay' | 'production' | 'mute'
  | 'selectAll' | 'cycleChips' | 'panUp' | 'panDown' | 'panLeft' | 'panRight' | 'pause';

export interface ActionSpec {
  id: Action;
  label: string;
  key: string;
  rebindable: boolean;
  /** The action fires only with ctrl (or cmd on a Mac) held. */
  modifier?: 'ctrl';
}

export const ACTIONS: readonly ActionSpec[] = [
  { id: 'halt', label: 'Halt', key: 'h', rebindable: true },
  { id: 'smoke', label: 'Smoke at the cursor', key: 'f', rebindable: true },
  { id: 'load', label: 'Load', key: 'g', rebindable: true },
  { id: 'unload', label: 'Unload', key: 'u', rebindable: true },
  { id: 'overlay', label: 'Toggle the debug overlay', key: 'o', rebindable: true },
  { id: 'production', label: 'Focus the production dock', key: 'b', rebindable: true },
  { id: 'mute', label: 'Mute', key: 'm', rebindable: true },
  { id: 'selectAll', label: 'Select every unit', key: 'a', rebindable: true, modifier: 'ctrl' },
  { id: 'cycleChips', label: 'Cycle the selection chips', key: 'tab', rebindable: false },
  { id: 'panUp', label: 'Pan up', key: 'w', rebindable: true },
  { id: 'panDown', label: 'Pan down', key: 's', rebindable: true },
  { id: 'panLeft', label: 'Pan left', key: 'a', rebindable: true },
  { id: 'panRight', label: 'Pan right', key: 'd', rebindable: true },
  { id: 'pause', label: 'Pause', key: 'escape', rebindable: false },
];

/** The arrow keys pan alongside WASD whatever the bindings say. */
const ARROWS: Readonly<Record<string, Action>> = { arrowup: 'panUp', arrowdown: 'panDown', arrowleft: 'panLeft', arrowright: 'panRight' };

export type Bindings = Readonly<Record<Action, string>>;

export const isAction = (s: string): s is Action => ACTIONS.some((a) => a.id === s);
const spec = (id: Action): ActionSpec => ACTIONS.find((a) => a.id === id) as ActionSpec;
const norm = (key: string): string => key.toLowerCase();
const DIGIT = /^[0-9]$/;

function holder(b: Bindings, key: string, modifier: 'ctrl' | undefined, except?: Action): Action | null {
  for (const a of ACTIONS) {
    if (a.id === except) continue;
    if (b[a.id] === key && a.modifier === modifier) return a.id;
  }
  return null;
}

export function bindingsFrom(overrides: Record<string, string>): Bindings {
  const out = Object.fromEntries(ACTIONS.map((a) => [a.id, a.key])) as Record<Action, string>;
  for (const [id, key] of Object.entries(overrides)) {
    if (!isAction(id) || !spec(id).rebindable) continue;
    const k = norm(key);
    if (DIGIT.test(k) || k.length === 0) continue;
    if (holder(out, k, spec(id).modifier, id) !== null) continue;
    out[id] = k;
  }
  return out;
}

export function resolveKey(b: Bindings, ev: { key: string; ctrlKey: boolean; metaKey: boolean }): Action | null {
  const k = norm(ev.key);
  const mod = ev.ctrlKey || ev.metaKey ? 'ctrl' : undefined;
  const hit = holder(b, k, mod);
  if (hit) return hit;
  if (mod === undefined && k in ARROWS) return ARROWS[k];
  return null;
}

export function rebind(b: Bindings, action: Action, key: string): { ok: true; bindings: Bindings } | { ok: false; takenBy: Action } {
  const k = norm(key);
  const s = spec(action);
  if (!s.rebindable || DIGIT.test(k) || k.length === 0) return { ok: false, takenBy: action };
  const taken = holder(b, k, s.modifier, action);
  if (taken) return { ok: false, takenBy: taken };
  return { ok: true, bindings: { ...b, [action]: k } };
}

export function overridesOf(b: Bindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ACTIONS) if (b[a.id] !== a.key) out[a.id] = b[a.id];
  return out;
}

const LABELS: Readonly<Record<string, string>> = {
  ' ': 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  escape: 'Esc', tab: 'Tab', enter: 'Enter', backspace: '⌫', delete: 'Del',
};

export function keyLabel(key: string): string {
  const k = norm(key);
  return LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
}
