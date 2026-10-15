import { describe, expect, it } from 'vitest';
import { ZONE_CONTESTED, ZONE_EMPTY, type CutCause, type MissionRuntime, type ZoneIncome } from '@lions/sim';
import { incomeViewOf, type IncomeRuntime } from './income-view';

// The model must be satisfiable by the real runtime: a compile-time check, nothing runs.
export const realRuntimeFitsTheModel = (rt: MissionRuntime): IncomeRuntime => rt;

type Fake = {
  -readonly [K in keyof ZoneIncome]: ZoneIncome[K];
};

function zone(over: Partial<Fake> & { zone: string }): ZoneIncome {
  return {
    rect: [1, 2, 3, 4],
    ratePerMin: 10,
    state: 0,
    holder: 0,
    cut: null,
    route: null,
    cutSpan: null,
    paysPerMin: 10,
    ...over,
  };
}

function rt(
  zones: ZoneIncome[],
  convoy: IncomeRuntime['convoyRoute'] = null,
  per: { base: number; zones: number; halvedBy: CutCause } = { base: 0, zones: 0, halvedBy: null },
): IncomeRuntime {
  return { incomeZones: zones, convoyRoute: convoy, incomePerMin: per };
}

describe('incomeViewOf', () => {
  it('is null with no zones and no convoy', () => {
    expect(incomeViewOf(rt([]))).toBeNull();
  });

  it('is a view for a convoy alone', () => {
    const v = incomeViewOf(rt([], { route: [1, 2, 3], cut: null, cutSpan: null }, { base: 20, zones: 0, halvedBy: null }));
    expect(v).not.toBeNull();
    expect(v?.convoy?.route).toEqual([1, 2, 3]);
    expect(v?.zoneViews).toEqual([]);
  });

  it('a held, uncut zone pays its rate and keeps its route', () => {
    const v = incomeViewOf(rt([zone({ zone: 'a', route: [5, 6, 7] })], null, { base: 30, zones: 10, halvedBy: null }));
    const z = v?.zoneViews[0];
    expect(z).toMatchObject({ id: 'a', rect: [1, 2, 3, 4], ratePerMin: 10, paysPerMin: 10, state: 'held', cut: null });
    expect(z?.route).toEqual([5, 6, 7]);
    expect(v?.halved).toBe(false);
  });

  it('a cut held zone pays half, carries its cause and span, and halves the view', () => {
    const v = incomeViewOf(
      rt([zone({ zone: 'a', cut: 'interdicted', route: [5, 6, 7], cutSpan: [1, 2], paysPerMin: 5 })], null, {
        base: 30,
        zones: 5,
        halvedBy: null,
      }),
    );
    const z = v?.zoneViews[0];
    expect(z).toMatchObject({ paysPerMin: 5, cut: 'interdicted', state: 'held' });
    expect(z?.cutSpan).toEqual([1, 2]);
    expect(v?.halved).toBe(true);
    expect(v?.halvedBy).toBeNull();
  });

  it('a convoy cut halves the view and names its cause', () => {
    const v = incomeViewOf(
      rt([], { route: [1, 2], cut: 'vent', cutSpan: [0, 1] }, { base: 10, zones: 0, halvedBy: 'vent' }),
    );
    expect(v?.halved).toBe(true);
    expect(v?.halvedBy).toBe('vent');
    expect(v?.convoy).toEqual({ route: [1, 2], cut: 'vent', cutSpan: [0, 1] });
  });

  it('a side-1-held zone pays 0, reads unheld and carries no route or cut', () => {
    const v = incomeViewOf(
      rt([zone({ zone: 'e', state: 1, holder: 1, cut: 'unreachable', route: [9, 9], cutSpan: [0, 1], paysPerMin: 5 })]),
    );
    const z = v?.zoneViews[0];
    expect(z).toMatchObject({ state: 'unheld', paysPerMin: 0, cut: null, route: null, cutSpan: null });
    expect(v?.halved).toBe(false);
  });

  it('an empty zone reads unheld', () => {
    const v = incomeViewOf(rt([zone({ zone: 'x', state: ZONE_EMPTY, holder: -1, paysPerMin: 0 })]));
    expect(v?.zoneViews[0]).toMatchObject({ state: 'unheld', paysPerMin: 0 });
  });

  it('a contested zone reads contested and pays nothing', () => {
    const v = incomeViewOf(rt([zone({ zone: 'c', state: ZONE_CONTESTED, holder: -1, paysPerMin: 0 })]));
    expect(v?.zoneViews[0]).toMatchObject({ state: 'contested', paysPerMin: 0, route: null, cut: null });
  });

  it('copies the totals from incomePerMin and does not derive them', () => {
    // A deliberately inconsistent runtime: if the view summed the zones it would read 10, not 99.
    const v = incomeViewOf(rt([zone({ zone: 'a' })], null, { base: 7, zones: 99, halvedBy: null }));
    expect(v).toMatchObject({ base: 7, zones: 99, total: 106 });
  });

  it('keeps zones in authored order', () => {
    const v = incomeViewOf(rt([zone({ zone: 'b' }), zone({ zone: 'a' })]));
    expect(v?.zoneViews.map((z) => z.id)).toEqual(['b', 'a']);
  });

  it('copies route and cutSpan: later in-place edits on the runtime do not reach the view', () => {
    const route = [1, 2, 3];
    const span: [number, number] = [0, 1];
    const croute = [4, 5, 6];
    const cspan: [number, number] = [1, 2];
    const v = incomeViewOf(
      rt([zone({ zone: 'a', cut: 'vent', route, cutSpan: span })], { route: croute, cut: 'vent', cutSpan: cspan }),
    );
    route[0] = 99;
    span[1] = 99;
    croute[0] = 99;
    cspan[1] = 99;
    expect(v?.zoneViews[0].route).toEqual([1, 2, 3]);
    expect(v?.zoneViews[0].cutSpan).toEqual([0, 1]);
    expect(v?.convoy?.route).toEqual([4, 5, 6]);
    expect(v?.convoy?.cutSpan).toEqual([1, 2]);
  });
});
