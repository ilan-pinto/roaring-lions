import { describe, expect, it } from 'vitest';
import { hintFor, loadSeen, markSeen } from './hint-model';

const base = { selected: 0, hoveringHostile: false, sawProjectedFire: true, sawDock: true, dockAvailable: true };

describe('hintFor', () => {
  it('teaches the controls with nothing selected, as it always did', () => {
    expect(hintFor(base)?.key).toBe('hud.controlHint');
  });

  // The inversion this task exists for.
  it('still says something with a selection -- the line is no longer hidden', () => {
    expect(hintFor({ ...base, selected: 3 })).not.toBeNull();
    expect(hintFor({ ...base, selected: 3 })?.key).toBe('hud.hint.selected');
  });

  it('a first-time player hovering a hostile is told what the panel beside it is', () => {
    expect(hintFor({ ...base, selected: 2, hoveringHostile: true, sawProjectedFire: false })?.key)
      .toBe('hud.hint.projectedFire');
  });

  it('and is told once -- after that the ordinary line comes back', () => {
    expect(hintFor({ ...base, selected: 2, hoveringHostile: true, sawProjectedFire: true })?.key)
      .toBe('hud.hint.selected');
  });

  it('names the dock only on a mission that has one', () => {
    expect(hintFor({ ...base, sawDock: false, dockAvailable: true })?.key).toBe('hud.hint.dock');
    expect(hintFor({ ...base, sawDock: false, dockAvailable: false })?.key).toBe('hud.controlHint');
  });

  // Two first-use hints can be owed at once; one line can hold one.
  it('shows the hint the player is closest to needing, never two', () => {
    const h = hintFor({ ...base, selected: 2, hoveringHostile: true, sawProjectedFire: false, sawDock: false });
    expect(h?.key).toBe('hud.hint.projectedFire');
  });
});

describe('hintFor: contextual first-use lines', () => {
  const line = { key: 'hud.hint.first.sniper', id: 'sniper' };
  it('shows the owed rule above the plain selection line', () => {
    expect(hintFor({ ...base, selected: 1, contextual: line })).toEqual(line);
  });
  it('yields to projected fire and to the dock, and to nothing else', () => {
    expect(hintFor({ ...base, selected: 1, hoveringHostile: true, sawProjectedFire: false, contextual: line })?.key).toBe('hud.hint.projectedFire');
    expect(hintFor({ ...base, sawDock: false, contextual: line })?.key).toBe('hud.hint.dock');
  });
  it('the dock line carries its memory id so it can be marked shown', () => {
    expect(hintFor({ ...base, sawDock: false })?.id).toBe('dock');
  });
  it('null and absent both fall through to the ordinary line', () => {
    expect(hintFor({ ...base, contextual: null })?.key).toBe('hud.controlHint');
    expect(hintFor(base)?.key).toBe('hud.controlHint');
  });
});

describe('first-use memory', () => {
  // Map-backed, not `window.localStorage`: this vitest jsdom config hands
  // that back as a bare `{}` (CLAUDE.md), so a fake is the only way to prove
  // a round-trip at all. `removeItem` is never called by `loadSeen`/
  // `markSeen`, but it is part of `StorageLike` (`brigade-account.ts`), so
  // the fake carries a no-op the same way every other store fake in this
  // package does (`settings.test.ts`, `brigade-account.test.ts`).
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  it('round-trips and defaults to unseen', () => {
    const s = store();
    expect(loadSeen(s)).toEqual({ projectedFire: false, dock: false, orderRow: false });
    markSeen(s, 'dock');
    expect(loadSeen(s)).toEqual({ projectedFire: false, dock: true, orderRow: false });
  });
  it('survives a store that is missing, blocked, or holding rubbish', () => {
    expect(loadSeen(null)).toEqual({ projectedFire: false, dock: false, orderRow: false });
    const bad = { getItem: () => '{{{', setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    expect(loadSeen(bad)).toEqual({ projectedFire: false, dock: false, orderRow: false });
    expect(() => markSeen(bad, 'dock')).not.toThrow();
  });
});

// WP-P5 (PA-16): the order-row line retires after the first session.
describe('hintFor: the order-row line is first-session scaffolding', () => {
  it('a selection shows it until a session that showed it has ended', () => {
    expect(hintFor({ ...base, selected: 2, sawOrderRow: false })?.key).toBe('hud.hint.selected');
    expect(hintFor({ ...base, selected: 2, sawOrderRow: true })).toBeNull();
  });

  it('retiring it leaves the empty-selection controls line and every first-use line alone', () => {
    expect(hintFor({ ...base, sawOrderRow: true })?.key).toBe('hud.controlHint');
    expect(
      hintFor({ ...base, selected: 2, hoveringHostile: true, sawProjectedFire: false, sawOrderRow: true })?.key
    ).toBe('hud.hint.projectedFire');
  });

  it('is remembered across sessions beside the other first-use flags', () => {
    const mem = new Map<string, string>();
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    expect(loadSeen(store).orderRow).toBe(false);
    markSeen(store, 'dock');
    markSeen(store, 'orderRow');
    expect(loadSeen(store)).toMatchObject({ dock: true, orderRow: true, projectedFire: false });
  });
});
