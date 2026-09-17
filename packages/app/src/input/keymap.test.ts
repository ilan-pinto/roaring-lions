import { describe, expect, it } from 'vitest';
import { ACTIONS, bindingsFrom, heldAction, keyLabel, overridesOf, rebind, resolveKey } from './keymap';

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
