import { describe, expect, it } from 'vitest';
import type { IncomeView, IncomeZoneView } from './income-view';
import { ROUTE_JUMP_SHOW_MS, SupplyRouteDisplay, supplyRoutesOf } from './supply-route-display';

function zoneView(over: Partial<IncomeZoneView> & { id: string }): IncomeZoneView {
  return {
    rect: [1, 2, 3, 4],
    ratePerMin: 10,
    paysPerMin: 10,
    state: 'held',
    cut: null,
    route: null,
    cutSpan: null,
    ...over,
  };
}

function view(over: Partial<IncomeView> = {}): IncomeView {
  return {
    base: 20,
    zones: 10,
    total: 30,
    halved: false,
    halvedBy: null,
    zoneViews: [zoneView({ id: 'well', route: [10, 11, 12, 13], cut: 'interdicted', cutSpan: [1, 2] })],
    convoy: { route: [40, 41, 42], cut: null, cutSpan: null },
    ...over,
  };
}

describe('supplyRoutesOf', () => {
  it('is nothing for a mission with no income (every shipped mission today)', () => {
    expect(supplyRoutesOf(null)).toEqual([]);
  });

  it('the convoy first, then each held zone, each with its own cut stretch', () => {
    expect(supplyRoutesOf(view())).toEqual([
      { tiles: [40, 41, 42], cutSpan: null },
      { tiles: [10, 11, 12, 13], cutSpan: [1, 2] },
    ]);
  });

  it('skips a line with no route: an enemy-held zone, or an unreachable rear', () => {
    const v = view({ zoneViews: [zoneView({ id: 'theirs', state: 'unheld' })], convoy: { route: null, cut: 'unreachable', cutSpan: null } });
    expect(supplyRoutesOf(v)).toEqual([]);
  });

  it('a cut line with no span is cut whole, as the minimap draws it', () => {
    const v = view({ convoy: { route: [1, 2, 3, 4], cut: 'vent', cutSpan: null }, zoneViews: [] });
    expect(supplyRoutesOf(v)).toEqual([{ tiles: [1, 2, 3, 4], cutSpan: [0, 3] }]);
  });
});

describe('SupplyRouteDisplay', () => {
  const at = (d: SupplyRouteDisplay, o: Partial<Parameters<SupplyRouteDisplay['routes']>[0]>) =>
    d.routes({ view: view(), logisticsHeld: false, modalOpen: false, nowMs: 1000, ...o });

  it('shows nothing until the logistics figure is held', () => {
    const d = new SupplyRouteDisplay();
    expect(at(d, {})).toBeNull();
    expect(at(d, { logisticsHeld: true })).toHaveLength(2);
    expect(at(d, { logisticsHeld: false })).toBeNull();
  });

  it('an open dialog clears it, held or not', () => {
    const d = new SupplyRouteDisplay();
    expect(at(d, { logisticsHeld: true, modalOpen: true })).toBeNull();
  });

  it('a mission with no income shows nothing even while held', () => {
    const d = new SupplyRouteDisplay();
    expect(at(d, { logisticsHeld: true, view: null })).toBeNull();
  });

  it('a supply jump shows it for ROUTE_JUMP_SHOW_MS on the frame clock, then not', () => {
    expect(ROUTE_JUMP_SHOW_MS).toBe(4000);
    const d = new SupplyRouteDisplay();
    d.jumpLanded(1000);
    expect(at(d, { nowMs: 1000 })).toHaveLength(2);
    expect(at(d, { nowMs: 4999 })).toHaveLength(2);
    expect(at(d, { nowMs: 5000 })).toBeNull();
  });

  it('a dialog opened inside the jump window ends the window', () => {
    const d = new SupplyRouteDisplay();
    d.jumpLanded(1000);
    expect(at(d, { nowMs: 1500, modalOpen: true })).toBeNull();
    expect(at(d, { nowMs: 1600 })).toBeNull();
  });

  it('hands back the SAME array while the routes are unchanged, so the world does not rebuild', () => {
    const d = new SupplyRouteDisplay();
    const a = at(d, { logisticsHeld: true });
    // The next HUD beat: a new view object, the same routes.
    const b = at(d, { logisticsHeld: true, view: view() });
    expect(b).toBe(a);
    // A recheck moved the convoy (a collapsed building): a new array.
    const c = at(d, { logisticsHeld: true, view: view({ convoy: { route: [40, 52, 42], cut: null, cutSpan: null } }) });
    expect(c).not.toBe(a);
    expect(c?.[0].tiles).toEqual([40, 52, 42]);
    // A changed cut stretch is a new array too.
    const e = at(d, {
      logisticsHeld: true,
      view: view({ convoy: { route: [40, 52, 42], cut: null, cutSpan: null }, zoneViews: [zoneView({ id: 'well', route: [10, 11, 12, 13], cut: 'interdicted', cutSpan: [0, 2] })] }),
    });
    expect(e).not.toBe(c);
  });
});
