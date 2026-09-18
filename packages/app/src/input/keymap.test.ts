// @vitest-environment jsdom
//
// jsdom, since `shouldYieldSpace` below is the one helper here that reads the
// DOM. Everything else in this file is pure and does not care.

import { describe, expect, it } from 'vitest';
import { ACTIONS, bindingsFrom, heldAction, keyLabel, overridesOf, rebind, resolveKey, shouldYieldSpace } from './keymap';

describe('keymap', () => {
  it('ships the bindings main.ts had hard-coded, in the same letters', () => {
    const b = bindingsFrom({});
    expect(b.halt).toBe('h');
    expect(b.smoke).toBe('f');
    expect(b.load).toBe('g');
    expect(b.unload).toBe('u');
    expect(b.overlay).toBe('o');
    expect(b.production).toBe('b');
    expect(b.mute).toBe('m');
    expect(b.selectAll).toBe('a'); // with ctrl/cmd
    expect(b.cycleChips).toBe('tab');
    expect(b.pause).toBe('escape');
    expect(b.panUp).toBe('w');
  });
  it('resolves a key to its action, honouring the ctrl modifier where the action needs one', () => {
    const b = bindingsFrom({});
    expect(resolveKey(b, { key: 'H', ctrlKey: false, metaKey: false })).toBe('halt');
    expect(resolveKey(b, { key: 'a', ctrlKey: true, metaKey: false })).toBe('selectAll');
    expect(resolveKey(b, { key: 'a', ctrlKey: false, metaKey: true })).toBe('selectAll');
    expect(resolveKey(b, { key: 'a', ctrlKey: false, metaKey: false })).toBe('panLeft');
    expect(resolveKey(b, { key: 'Escape', ctrlKey: false, metaKey: false })).toBe('pause');
    expect(resolveKey(b, { key: 'ArrowUp', ctrlKey: false, metaKey: false })).toBe('panUp');
    expect(resolveKey(b, { key: '5', ctrlKey: false, metaKey: false })).toBeNull(); // groups are not in the table
  });
  it('rebind refuses a key another action holds and names it', () => {
    const b = bindingsFrom({});
    expect(rebind(b, 'halt', 'f')).toEqual({ ok: false, takenBy: 'smoke' });
    const r = rebind(b, 'halt', 'j');
    expect(r.ok && r.bindings.halt).toBe('j');
    expect(r.ok && r.bindings.smoke).toBe('f');
  });
  it('rebind refuses a non-rebindable action and the group digits', () => {
    const b = bindingsFrom({});
    expect(rebind(b, 'pause', 'p').ok).toBe(false);
    expect(rebind(b, 'halt', '3').ok).toBe(false);
  });
  it('rebind refuses an arrow key -- it already has a fixed meaning outside the table', () => {
    const b = bindingsFrom({});
    expect(rebind(b, 'halt', 'ArrowUp').ok).toBe(false);
    expect(rebind(b, 'halt', 'arrowdown').ok).toBe(false);
  });
  it('bindingsFrom drops an override that collides or names an unknown action', () => {
    const b = bindingsFrom({ halt: 'f', nope: 'x', smoke: 'k' });
    expect(b.halt).toBe('h');
    expect(b.smoke).toBe('k');
  });
  it('bindingsFrom drops a digit or an arrow-key override, same as rebind does', () => {
    const b = bindingsFrom({ halt: '3', smoke: 'arrowleft' });
    expect(b.halt).toBe('h');
    expect(b.smoke).toBe('f');
  });
  it('overridesOf round-trips through bindingsFrom and is empty at the defaults', () => {
    expect(overridesOf(bindingsFrom({}))).toEqual({});
    const b = bindingsFrom({ halt: 'j' });
    expect(overridesOf(b)).toEqual({ halt: 'j' });
    expect(bindingsFrom(overridesOf(b))).toEqual(b);
  });
  it('labels keys the way a keycap does', () => {
    expect(keyLabel('h')).toBe('H');
    expect(keyLabel('arrowup')).toBe('↑');
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('escape')).toBe('Esc');
    expect(keyLabel('tab')).toBe('Tab');
  });
  it('every action in ACTIONS has a distinct default key within its modifier class', () => {
    const plain = ACTIONS.filter((a) => a.modifier === undefined).map((a) => a.key);
    expect(new Set(plain).size).toBe(plain.length);
  });
  it('jumpToAlert is bound, rebindable and free of the existing letters', () => {
    const b = bindingsFrom({});
    expect(b.jumpToAlert).toBe('space');
    expect(resolveKey(b, { key: ' ', ctrlKey: false, metaKey: false })).toBe('jumpToAlert');
    const taken = ACTIONS.filter((a) => a.key === 'space' && a.modifier === undefined);
    expect(taken).toHaveLength(1);
  });
  it('a rebind onto a taken key is still refused, with the new action in the table', () => {
    expect(rebind(bindingsFrom({}), 'jumpToAlert', 'h')).toEqual({ ok: false, takenBy: 'halt' });
  });
  // The space bar is the one key whose physical spelling (`' '`) and its stored
  // spelling (`'space'`) differ, so both have to resolve and both have to
  // label. `norm` lower-cases everything else, which leaves `' '` as `' '` --
  // a binding table written in that spelling would be unreadable in settings
  // and unmatched by `keyLabel`'s own `norm` call.
  it('space resolves and labels under both its spellings', () => {
    const b = bindingsFrom({});
    expect(resolveKey(b, { key: 'space', ctrlKey: false, metaKey: false })).toBe('jumpToAlert');
    expect(keyLabel('space')).toBe('Space');
    expect(keyLabel(' ')).toBe('Space');
  });
  // Space is the jump key AND the activation key of every focused control, so
  // the one case that binds it has to stand down when a control holds focus --
  // the reinforcement dock's `focusFirst()` and a Tab onto a HUD chip both
  // leave a button focused, and a camera that jumped every time the player
  // pressed a button would read as the camera being broken.
  describe('shouldYieldSpace', () => {
    const el = (html: string): Element => {
      const host = document.createElement('div');
      host.innerHTML = html;
      const first = host.firstElementChild;
      if (!first) throw new Error(`no element in ${html}`);
      return first;
    };
    it('yields to a focused interactive control', () => {
      expect(shouldYieldSpace(el('<button>Buy</button>'))).toBe(true);
      expect(shouldYieldSpace(el('<input type="text">'))).toBe(true);
      expect(shouldYieldSpace(el('<select><option>a</option></select>'))).toBe(true);
      expect(shouldYieldSpace(el('<textarea></textarea>'))).toBe(true);
      expect(shouldYieldSpace(el('<div contenteditable="true"></div>'))).toBe(true);
      expect(shouldYieldSpace(el('<a href="#x">go</a>'))).toBe(true);
    });
    it('does not yield to anything else, nor to nothing at all', () => {
      expect(shouldYieldSpace(el('<div></div>'))).toBe(false);
      expect(shouldYieldSpace(null)).toBe(false);
      // The two near-misses that are NOT controls: an anchor with no href is
      // not focusable, and `contenteditable="false"` is the attribute saying
      // exactly that this element does not take typing.
      expect(shouldYieldSpace(el('<a>go</a>'))).toBe(false);
      expect(shouldYieldSpace(el('<div contenteditable="false"></div>'))).toBe(false);
      // The canvas and the body are where focus sits during play, and both
      // must let the key through -- otherwise the feature never fires at all.
      expect(shouldYieldSpace(el('<canvas></canvas>'))).toBe(false);
      expect(shouldYieldSpace(document.body)).toBe(false);
    });
    it('is case-insensitive about the tag, because a DOM tagName is upper-case', () => {
      // `tagName` reads 'BUTTON', not 'button'. A raw === comparison against
      // the lower-case literal would return false for every real element and
      // the guard would be inert on the one path it exists for.
      expect(el('<button>Buy</button>').tagName).toBe('BUTTON');
      expect(shouldYieldSpace(el('<BUTTON>Buy</BUTTON>'))).toBe(true);
    });
  });

  it('heldAction is true while ANY physical key held resolves to that action', () => {
    const b = bindingsFrom({});
    // W and the physical Up arrow are two different keys that both mean
    // panUp -- releasing one (removing it from the held set) must not stop
    // the other from still counting.
    expect(heldAction(b, ['w', 'arrowup'], 'panUp')).toBe(true);
    expect(heldAction(b, ['arrowup'], 'panUp')).toBe(true); // 'w' released
    expect(heldAction(b, [], 'panUp')).toBe(false); // both released
    expect(heldAction(b, ['w'], 'panDown')).toBe(false); // wrong direction
    // The key that answers is not necessarily the FIRST one held -- an
    // irrelevant key (a Set's insertion order) ahead of the one that matters
    // must not shadow it.
    expect(heldAction(b, ['x', 'w'], 'panUp')).toBe(true);
  });
});
