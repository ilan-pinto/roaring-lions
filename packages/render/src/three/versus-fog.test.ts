/**
 * N1b task 13 (R-N14): the four versus fog leaks N1a left open, as pure
 * predicates. The single-player guarantee is the first block: with `versus`
 * false every predicate answers "draw it" (and the arc is never hidden),
 * whatever else it is told, so no campaign frame can change.
 *
 * `ThreeRenderer.versus-leaks.test.ts` is the other half: it proves the
 * renderer asks these on its real draw paths.
 */
import { describe, it, expect } from 'vitest';
import { arcHiddenUntil, hostileEffectVisible, structureBarVisible } from './versus-fog';

const BOOLS = [false, true] as const;

describe('single-player (versus off) answers "draw it" everywhere', () => {
  it('structureBarVisible is true for every holder and every fog', () => {
    for (const own of BOOLS) for (const seen of BOOLS) expect(structureBarVisible(false, own, seen)).toBe(true);
  });
  it('hostileEffectVisible is true for every side and every fog', () => {
    for (const own of BOOLS) for (const seen of BOOLS) expect(hostileEffectVisible(false, own, seen)).toBe(true);
  });
  it('arcHiddenUntil is 0 for every side and every fog', () => {
    for (const own of BOOLS) for (const seen of BOOLS) expect(arcHiddenUntil(false, own, seen)).toBe(0);
  });
});

describe('in a versus room', () => {
  it('a hostile building out of sight hides its integrity bar', () => {
    expect(structureBarVisible(true, false, false)).toBe(false);
  });
  it('an own building, or one in sight, shows it', () => {
    expect(structureBarVisible(true, true, false)).toBe(true);
    expect(structureBarVisible(true, false, true)).toBe(true);
    expect(structureBarVisible(true, true, true)).toBe(true);
  });
  it('a hostile effect out of sight is not drawn', () => {
    expect(hostileEffectVisible(true, false, false)).toBe(false);
  });
  it('an own effect, or one in sight, is drawn', () => {
    expect(hostileEffectVisible(true, true, false)).toBe(true);
    expect(hostileEffectVisible(true, false, true)).toBe(true);
    expect(hostileEffectVisible(true, true, true)).toBe(true);
  });
  it('an arc from an unseen hostile shooter stays hidden to its apex', () => {
    expect(arcHiddenUntil(true, false, false)).toBe(0.5);
  });
  it('an own arc, or one whose shooter is seen, is drawn from the muzzle', () => {
    expect(arcHiddenUntil(true, true, false)).toBe(0);
    expect(arcHiddenUntil(true, false, true)).toBe(0);
    expect(arcHiddenUntil(true, true, true)).toBe(0);
  });
});
