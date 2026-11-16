// applyUnitLocale: the unit-text locale overlay (GH-1406). See index.ts's header on this section.
import { describe, expect, it } from 'vitest';
import { applyUnitLocale, units, type UnitLocaleOverlay } from './index';

const squad = { id: 'inf_squad', name: 'Rifle Squad', blurb: 'Holds ground.', role: 'infantry' };

describe('applyUnitLocale', () => {
  it('replaces the name and the blurb, and nothing else', () => {
    const overlay: UnitLocaleOverlay = { inf_squad: { name: 'Fusiliers', blurb: 'Tient le terrain.' } };
    expect(applyUnitLocale(squad, overlay)).toEqual({ ...squad, name: 'Fusiliers', blurb: 'Tient le terrain.' });
  });

  it('falls back to the en text per field: a name alone leaves the blurb, a blurb alone leaves the name', () => {
    expect(applyUnitLocale(squad, { inf_squad: { name: 'Fusiliers' } })).toEqual({ ...squad, name: 'Fusiliers' });
    expect(applyUnitLocale(squad, { inf_squad: { blurb: 'Tient.' } })).toEqual({ ...squad, blurb: 'Tient.' });
  });

  it('returns the unit BY REFERENCE for a null overlay, a missing unit, and an entry that says nothing', () => {
    expect(applyUnitLocale(squad, null)).toBe(squad);
    expect(applyUnitLocale(squad, { other: { name: 'X' } })).toBe(squad);
    expect(applyUnitLocale(squad, { inf_squad: {} })).toBe(squad);
  });

  it('never adds a blurb to a unit that has none', () => {
    const bare = { id: 'x', name: 'X' };
    expect(applyUnitLocale(bare, { x: { name: 'Y', blurb: 'Z' } })).toEqual({ id: 'x', name: 'Y' });
  });

  it('does not touch the source unit or the shared `units` table', () => {
    const before = JSON.stringify(units);
    applyUnitLocale(squad, { inf_squad: { name: 'Fusiliers' } });
    expect(squad.name).toBe('Rifle Squad');
    const real = Object.values(units)[0] as { id: string; name?: string; blurb?: string };
    applyUnitLocale(real, { [real.id]: { name: 'Changed', blurb: 'Changed' } });
    expect(JSON.stringify(units)).toBe(before);
  });

  it('works on a real shipped unit', () => {
    const u = units.inf_squad as { id: string; name?: string; blurb?: string };
    const out = applyUnitLocale(u, { inf_squad: { name: 'Fusiliers' } });
    expect(out.name).toBe('Fusiliers');
    expect(out.blurb).toBe(u.blurb);
  });
});
