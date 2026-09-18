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
  | 'selectAll' | 'cycleChips' | 'jumpToAlert' | 'keysOverlay' | 'idleNext'
  | 'panUp' | 'panDown' | 'panLeft' | 'panRight' | 'pause';

export interface ActionSpec {
  id: Action;
  /** A catalogue KEY (`'keymap.halt'`), not the label text. Resolved with
   *  `t()` where it is rendered (`settings-keymap.ts`'s Controls rows,
   *  `hud.ts`'s order row via `ORDERS[].label`'s own identical convention) --
   *  not here, and not at module load: a table resolved once at import time
   *  would freeze in whatever locale was active before `main.ts`'s boot ever
   *  calls `setCatalogue`, and render plain English under `?pseudo=1`
   *  forever (the bug `role.ts`'s `ROLE_LABEL` fix round 1 closed). Keeping
   *  `ACTIONS` as plain, keyed data is what lets `bindingsFrom`/`rebind`/
   *  `holder` go on comparing `id`s with no locale in the loop at all. */
  label: string;
  key: string;
  rebindable: boolean;
  /** The action fires only with ctrl (or cmd on a Mac) held. */
  modifier?: 'ctrl';
}

export const ACTIONS: readonly ActionSpec[] = [
  { id: 'halt', label: 'keymap.halt', key: 'h', rebindable: true },
  { id: 'smoke', label: 'keymap.smoke', key: 'f', rebindable: true },
  { id: 'load', label: 'keymap.load', key: 'g', rebindable: true },
  { id: 'unload', label: 'keymap.unload', key: 'u', rebindable: true },
  { id: 'overlay', label: 'keymap.overlay', key: 'o', rebindable: true },
  { id: 'production', label: 'keymap.production', key: 'b', rebindable: true },
  { id: 'mute', label: 'keymap.mute', key: 'm', rebindable: true },
  { id: 'selectAll', label: 'keymap.selectAll', key: 'a', rebindable: true, modifier: 'ctrl' },
  { id: 'cycleChips', label: 'keymap.cycleChips', key: 'tab', rebindable: false },
  // The space bar, the one key on this table that is not a letter, a word or
  // an arrow. It is free: h f g u o b m, ctrl+a, tab, w s a d and escape are
  // the whole of what was taken, and space is the key a hand resting on the
  // keyboard can reach without looking -- which is the point of an alert jump.
  { id: 'jumpToAlert', label: 'keymap.jumpToAlert', key: 'space', rebindable: true },
  // F1 is the browser's own help key everywhere else on the page, and free
  // here: h f g u o b m, ctrl+a, tab, space, w s a d and escape are the whole
  // of what was taken. `unassignable` only refuses digits, the four arrows
  // and the empty string, so f1 is also a legal REBIND target for something
  // else -- there is nothing about a function key that this table treats
  // specially.
  { id: 'keysOverlay', label: 'keymap.keysOverlay', key: 'f1', rebindable: true },
  // Task 11: the idle-unit finder. Free -- h f g u o b m, ctrl+a, tab, space,
  // f1, w s a d and escape are the whole of what was taken -- and `i` sits
  // beside the letters this table already uses without reaching for a
  // modifier or a function key.
  { id: 'idleNext', label: 'keymap.idleNext', key: 'i', rebindable: true },
  { id: 'panUp', label: 'keymap.panUp', key: 'w', rebindable: true },
  { id: 'panDown', label: 'keymap.panDown', key: 's', rebindable: true },
  { id: 'panLeft', label: 'keymap.panLeft', key: 'a', rebindable: true },
  { id: 'panRight', label: 'keymap.panRight', key: 'd', rebindable: true },
  { id: 'pause', label: 'keymap.pause', key: 'escape', rebindable: false },
];

/** The arrow keys pan alongside WASD whatever the bindings say. */
const ARROWS: Readonly<Record<string, Action>> = { arrowup: 'panUp', arrowdown: 'panDown', arrowleft: 'panLeft', arrowright: 'panRight' };

/** Never assignable, the same way a digit never is. An arrow key already has
 *  a fixed meaning (`ARROWS` above) that does not go through a binding at
 *  all -- if a rebind could park, say, `halt` on `'arrowup'`, `resolveKey`'s
 *  `holder` lookup would find that binding and return `'halt'` before ever
 *  reaching the `ARROWS` fallback, so pressing the physical Up arrow would
 *  halt instead of pan. Reusing `ARROWS`' own keys rather than a second
 *  literal list keeps the two enumerations from drifting apart. */
const RESERVED = new Set<string>(Object.keys(ARROWS));

export type Bindings = Readonly<Record<Action, string>>;

export const isAction = (s: string): s is Action => ACTIONS.some((a) => a.id === s);
const spec = (id: Action): ActionSpec => ACTIONS.find((a) => a.id === id) as ActionSpec;
/**
 * `KeyboardEvent.key` for the space bar is a single SPACE character, and a
 * binding stored as `' '` would be invisible in the Controls rows and
 * indistinguishable from an empty one. It is stored as `'space'` and mapped
 * here, so the event and the table agree at the one point every lookup goes
 * through -- `resolveKey`, `rebind`, `bindingsFrom` and `keyLabel` all call
 * this, so neither spelling can reach any of them unconverted.
 */
const norm = (key: string): string => (key === ' ' ? 'space' : key.toLowerCase());
const DIGIT = /^[0-9]$/;
const unassignable = (k: string): boolean => DIGIT.test(k) || RESERVED.has(k) || k.length === 0;

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
    if (unassignable(k)) continue;
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

/**
 * May this action still reach the game while a modal -- a confirm, or the pause
 * menu -- is open?
 *
 * Only the four camera pans, and they are not a game verb at all: panning
 * writes `renderer.camera.x/y` and nothing else. It dispatches no intent,
 * touches no sim state, and stays correct under invariant 4 whether or not a
 * modal is up. `ui/pause.ts` already exempts them from its own capture guard
 * for that reason ("a modal over a world that keeps drawing while the sim
 * stops"); this is the same rule stated once, in a place both halves can read.
 *
 * I1 (final review): `main.ts`'s bubble keydown listener guarded only
 * `case 'pause'`. Everything else -- halt, select-all, overlay, load/unload,
 * smoke, reinforcements, mute and the control-group digits -- was protected
 * solely by the modals' own capture-phase `stopPropagation()`, which is to say
 * by exactly the listener C1 showed can go missing. Tab was worse than
 * unprotected: both modals deliberately PASS Tab through so the browser's
 * native focus traversal works inside the dialog, and `main.ts` bound Tab to
 * `cycleChips` -- so a Tab pressed in the pause menu walked the lime focus
 * frame along the HUD chips BEHIND the modal and then `preventDefault()`ed the
 * focus move the dialog needed. The `aria-modal="true"` both dialogs claim was
 * false for the one key a keyboard player needs most.
 *
 * Defence in depth rather than a second copy of the modal's guard: this one
 * holds whether or not the modal's listener is alive.
 */
export function passesThroughModal(action: Action | null): boolean {
  return action === 'panUp' || action === 'panDown' || action === 'panLeft' || action === 'panRight';
}

/**
 * Does a key bound to the SPACE bar have to stand down right now?
 *
 * Space is not an ordinary game letter: it is the activation key of every
 * focused control on the screen. `production.focusFirst()` (the `b` key)
 * moves focus into the reinforcements dock and Tab walks the HUD chips, so a
 * player buying a unit with the keyboard is holding focus on a button at the
 * exact moment `jumpToAlert` would fire -- and the camera flying off on every
 * purchase reads as the camera being broken rather than as two features
 * meeting.
 *
 * The answer is to YIELD, never to `preventDefault()`: swallowing the key
 * would keep the camera still and break the button instead, which is strictly
 * worse. The caller returns and the control gets its own key.
 *
 * Deliberately NOT a handler-wide guard. Every other bound key is a letter no
 * control claims, and stopping `h` from halting because a chip has focus
 * would be a regression dressed as a fix.
 *
 * `tagName` is upper-case on a real element and lower-case on an XML one, so
 * it is folded rather than compared raw -- a `=== 'button'` here would be
 * false for every button in the game and the guard would be silently inert.
 */
export function shouldYieldSpace(el: Element | null): boolean {
  if (el === null) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') return true;
  // An anchor is only focusable with an href, and `contenteditable="false"`
  // is the attribute whose whole job is to say this element does not type.
  if (tag === 'a') return el.hasAttribute('href');
  const editable = el.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

export function rebind(b: Bindings, action: Action, key: string): { ok: true; bindings: Bindings } | { ok: false; takenBy: Action } {
  const k = norm(key);
  const s = spec(action);
  if (!s.rebindable || unassignable(k)) return { ok: false, takenBy: action };
  const taken = holder(b, k, s.modifier, action);
  if (taken) return { ok: false, takenBy: taken };
  return { ok: true, bindings: { ...b, [action]: k } };
}

/**
 * Is ANY physical key in `keys` currently a pan direction for `action`?
 *
 * The render loop tracks physical keys (`ev.key.toLowerCase()`), not action
 * ids, because a modifier-free pan key has no per-key state of its own to
 * lose track of -- and, more to the point, W and the physical Up arrow are
 * two different keys that both mean `panUp`. Storing the resolved ACTION
 * instead of the key would collapse them onto one Set entry, so releasing
 * either one (whichever's `keyup` happened to fire) would delete the entry
 * and stop the pan while the OTHER key was still held. Checking with no
 * modifier is correct for every action this is used for: every pan action's
 * `modifier` is `undefined`, and a key that was added while a modifier was
 * held would have resolved to a DIFFERENT action at add-time (`resolveKey`'s
 * own modifier-aware lookup) and never reached the pan case at all. */
export function heldAction(b: Bindings, keys: Iterable<string>, action: Action): boolean {
  for (const k of keys) {
    if (resolveKey(b, { key: k, ctrlKey: false, metaKey: false }) === action) return true;
  }
  return false;
}

export function overridesOf(b: Bindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ACTIONS) if (b[a.id] !== a.key) out[a.id] = b[a.id];
  return out;
}

// Keyed by the NORMALISED spelling: `keyLabel` calls `norm` first, so the `' '`
// entry this table used to carry became unreachable the moment `norm` started
// mapping the space bar to `'space'`, and it is replaced rather than joined.
//
// Disclosed because it was measured rather than assumed: the `space` entry is
// belt-and-braces and NO test can separate it from the fallback below, which
// capitalises any multi-character key and so returns `'Space'` for `'space'`
// by itself. Swapping the key back to `' '` leaves every keymap spec green.
// It stays because a table that names its own keycaps is the thing a reader
// checks, and because the fallback is not a promise -- a future `keyLabel`
// that stopped capitalising would take this label with it, silently.
const LABELS: Readonly<Record<string, string>> = {
  space: 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  escape: 'Esc', tab: 'Tab', enter: 'Enter', backspace: '⌫', delete: 'Del',
};

export function keyLabel(key: string): string {
  const k = norm(key);
  return LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
}
