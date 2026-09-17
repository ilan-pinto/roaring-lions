// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS, bindingsFrom, type Bindings } from '../input/keymap';
import { keymapRows } from './settings-keymap';

function deps(initial: Bindings = bindingsFrom({})) {
  let b = initial;
  const set = vi.fn((next: Bindings) => {
    b = next;
  });
  return { bindings: (): Bindings => b, set };
}

function mount(d: ReturnType<typeof deps>): HTMLElement {
  const table = document.createElement('div');
  keymapRows(d).mount(table);
  document.body.appendChild(table);
  return table;
}

function rowFor(table: HTMLElement, label: string): HTMLElement {
  const row = [...table.querySelectorAll<HTMLElement>('.rl-settings__row')].find((r) =>
    r.textContent?.includes(label)
  );
  if (!row) throw new Error(`no row for "${label}"`);
  return row;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('keymapRows', () => {
  it('renders one row per action with its current keycap', () => {
    const table = mount(deps());
    const rows = [...table.querySelectorAll('.rl-settings__row')];
    // ACTIONS.length rows plus the trailing "Reset to defaults" row.
    expect(rows.length).toBe(ACTIONS.length + 1);
    expect(rowFor(table, 'Halt').querySelector('kbd')?.textContent).toBe('H');
  });

  it('rebinds through a captured keydown and calls set with the new table', () => {
    const d = deps();
    const table = mount(d);
    const row = rowFor(table, 'Halt');
    const btn = row.querySelector<HTMLButtonElement>('button');
    if (!btn) throw new Error('no Change button on the Halt row');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // The kbd goes into capture mode before the next key lands.
    expect(row.querySelector('kbd')?.textContent).toBe('press a key…');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    expect(d.set).toHaveBeenCalledTimes(1);
    expect(d.set.mock.calls[0][0].halt).toBe('j');
    expect(row.querySelector('kbd')?.textContent).toBe('J');
  });

  it('refuses a key another action holds, names the holder, and never calls set', () => {
    const d = deps();
    const table = mount(d);
    const row = rowFor(table, 'Halt');
    const btn = row.querySelector<HTMLButtonElement>('button');
    if (!btn) throw new Error('no Change button on the Halt row');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })); // smoke's key
    expect(d.set).not.toHaveBeenCalled();
    expect(row.querySelector('.rl-settings__hint')?.textContent).toBe(
      'Already used by Smoke at the cursor'
    );
    // The kbd reverts to the action's own (unchanged) binding.
    expect(row.querySelector('kbd')?.textContent).toBe('H');
  });

  it('Escape cancels the capture and calls set with nothing changed', () => {
    const d = deps();
    const table = mount(d);
    const row = rowFor(table, 'Halt');
    const btn = row.querySelector<HTMLButtonElement>('button');
    if (!btn) throw new Error('no Change button on the Halt row');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(d.set).not.toHaveBeenCalled();
    expect(row.querySelector('kbd')?.textContent).toBe('H');
  });

  it('offers no Change button for a non-rebindable action', () => {
    const table = mount(deps());
    const row = rowFor(table, 'Pause');
    expect(row.querySelector('button')).toBeNull();
  });

  it('"Reset to defaults" calls set with the shipped bindings', () => {
    const d = deps(bindingsFrom({ halt: 'j' }));
    const table = mount(d);
    const resetBtn = [...table.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reset to defaults'
    );
    if (!resetBtn) throw new Error('no Reset to defaults button');
    resetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(d.set).toHaveBeenCalledTimes(1);
    expect(d.set.mock.calls[0][0]).toEqual(bindingsFrom({}));
  });

  it('"Reset to defaults" repaints every row, not just the one that changed', () => {
    // A rebind repaints its OWN row inline; reset changes every binding at
    // once, so leaving the other rows unpainted would show a stale "J" next
    // to Halt until the panel was remounted.
    const d = deps(bindingsFrom({ halt: 'j', smoke: 'k' }));
    const table = mount(d);
    expect(rowFor(table, 'Halt').querySelector('kbd')?.textContent).toBe('J');
    const resetBtn = [...table.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reset to defaults'
    );
    if (!resetBtn) throw new Error('no Reset to defaults button');
    resetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rowFor(table, 'Halt').querySelector('kbd')?.textContent).toBe('H');
    expect(rowFor(table, 'Smoke at the cursor').querySelector('kbd')?.textContent).toBe('F');
  });
});
