import { describe, expect, it } from 'vitest';
import { hoverLine, pickOutcome } from './pin-hover';

describe('hoverLine', () => {
  // The locked reason is the one thing a click already says that a player
  // most wants BEFORE clicking: the ground is one canvas, so a click that
  // resolves to "you cannot" is a wasted click.
  it('previews the reason a locked region is locked', () => {
    expect(hoverLine({ status: 'locked', regionName: 'Sahar', lockedBecause: 'Conduct 70' })).toEqual({
      key: 'world3d.hover.locked',
      params: { region: 'Sahar', reason: 'Conduct 70' },
      tone: 'bad',
    });
  });

  it('falls back to a human reason rather than saying nothing', () => {
    expect(hoverLine({ status: 'locked', regionName: 'Sahar' }).params.reason).toBeTruthy();
  });

  it('says a region is empty rather than leaving it silent', () => {
    expect(hoverLine({ status: 'empty', regionName: 'Marj' }).key).toBe('world3d.hover.empty');
  });

  it('names the mission a click would open', () => {
    expect(
      hoverLine({ status: 'live', regionName: 'Sahar', nextMissionName: 'Foothold' })
    ).toEqual({
      key: 'world3d.hover.opening',
      params: { region: 'Sahar', mission: 'Foothold' },
      tone: 'good',
    });
  });

  // A preview and a commitment must not read identically -- the click
  // sentence says "opening", the hover says "opens".
  it('is a different catalogue key from the click sentence, for every status', () => {
    // 'done' is not a member of `RegionStatus` -- it is the pin's OWN status,
    // set once every one of a town's objectives is complete
    // (`worldmap3d.ts`'s pin loop). `PinStatus` (`pin-hover.ts`) is the union
    // that admits it; this loop is why it exists.
    for (const s of ['locked', 'empty', 'live', 'done'] as const) {
      expect(hoverLine({ status: s, regionName: 'x' }).key).toMatch(/^world3d\.hover\./);
    }
  });

  it('a cleared region says so and does not promise a mission', () => {
    const l = hoverLine({ status: 'done', regionName: 'Sahar' });
    expect(l.key).toBe('world3d.hover.cleared');
    expect(l.params.mission).toBeUndefined();
  });
});

describe('pickOutcome', () => {
  // The one branch both `onPick` (click) and `hoverLine` (hover) resolve
  // through -- see pin-hover.ts's header and the pre-flight scan's M11. A
  // hard-coded status always wins, even with a mission id in hand: a locked
  // or empty pin has nothing there IS to open.
  it('locked always wins, mission id or not', () => {
    expect(pickOutcome('locked', true)).toBe('locked');
    expect(pickOutcome('locked', false)).toBe('locked');
  });

  it('empty always wins, mission id or not', () => {
    expect(pickOutcome('empty', true)).toBe('empty');
    expect(pickOutcome('empty', false)).toBe('empty');
  });

  it('a live or done status with no mission id is cleared', () => {
    expect(pickOutcome('live', false)).toBe('cleared');
    expect(pickOutcome('done', false)).toBe('cleared');
  });

  it('a live or done status with a mission id is opening', () => {
    expect(pickOutcome('live', true)).toBe('opening');
    expect(pickOutcome('complete', true)).toBe('opening');
  });
});
