import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeObjectiveZoneNames, incomeZonesFor, objectiveZonesFor } from './objective-zones';
import type { IncomeView, IncomeZoneState, IncomeZoneView } from './ui/income-view';

const ZONES = { approach: [21, 22, 7, 5], ammo_draw: [30, 12, 3, 3] } as const;

describe('objectiveZonesFor', () => {
  it('outlines every active zone objective, not only the first -- Tel Marum II', () => {
    const out = objectiveZonesFor(
      [
        { id: 'hold_approach', type: 'hold_for', status: 'active', zone: 'approach', paused: 'unheld' },
        { id: 'kill_spotter', type: 'eliminate_hvt', status: 'active' },
        { id: 'burn_the_ammo_point', type: 'raze', status: 'active', zone: 'ammo_draw' },
      ],
      ZONES
    );
    expect(out.map((z) => z.id)).toEqual(['hold_approach', 'burn_the_ammo_point']);
    expect(out[0]).toEqual({ id: 'hold_approach', rect: ZONES.approach, state: 'unheld' });
    expect(out[1]).toEqual({ id: 'burn_the_ammo_point', rect: ZONES.ammo_draw, state: 'target' });
  });

  it('carries the hold state through: held when the clock runs, contested when it is fought over', () => {
    const [held] = objectiveZonesFor([{ id: 'h', type: 'hold_for', status: 'active', zone: 'approach' }], ZONES);
    expect(held.state).toBe('held');
    const [contested] = objectiveZonesFor(
      [{ id: 'h', type: 'capture', status: 'active', zone: 'approach', paused: 'contested' }],
      ZONES
    );
    expect(contested.state).toBe('contested');
  });

  it('drops a completed or failed objective, and one whose zone the map does not declare', () => {
    const out = objectiveZonesFor(
      [
        { id: 'done', type: 'hold_for', status: 'complete', zone: 'approach' },
        { id: 'lost', type: 'raze', status: 'failed', zone: 'ammo_draw' },
        { id: 'ghost', type: 'raze', status: 'active', zone: 'nowhere' },
      ],
      ZONES
    );
    expect(out).toEqual([]);
  });
});

// --- S-F F2 Z-B: held income ground wears the objective-zone look ----------

function iz(id: string, state: IncomeZoneState, rect: IncomeZoneView['rect'] = [1, 2, 3, 4]): IncomeZoneView {
  return { id, rect, ratePerMin: 20, paysPerMin: state === 'held' ? 20 : 0, state, cut: null, route: null, cutSpan: null };
}
function viewOf(zoneViews: IncomeZoneView[]): IncomeView {
  return { base: 100, zones: 0, total: 100, halved: false, halvedBy: null, zoneViews, convoy: null };
}

describe('incomeZonesFor', () => {
  it('draws held ground held, unheld ground unheld, contested ground contested', () => {
    const out = incomeZonesFor(viewOf([iz('a', 'held'), iz('b', 'unheld'), iz('c', 'contested')]), new Set());
    expect(out.map((z) => [z.id, z.state])).toEqual([
      ['income:a', 'held'],
      ['income:b', 'unheld'],
      ['income:c', 'contested'],
    ]);
  });

  it('never wears the target state, whatever the zone is', () => {
    const states = incomeZonesFor(viewOf([iz('a', 'held'), iz('b', 'unheld'), iz('c', 'contested')]), new Set()).map((z) => z.state);
    expect(states).not.toContain('target');
  });

  it('hands the renderer the view\'s own rectangle', () => {
    const out = incomeZonesFor(viewOf([iz('a', 'held', [18, 25, 14, 11])]), new Set());
    expect(out[0]?.rect).toEqual([18, 25, 14, 11]);
  });

  it('skips a zone an active objective already draws, and only that one', () => {
    const out = incomeZonesFor(viewOf([iz('hamlet', 'held'), iz('stockpile', 'held')]), new Set(['stockpile']));
    expect(out.map((z) => z.id)).toEqual(['income:hamlet']);
  });

  it('draws nothing for a mission with no income view', () => {
    expect(incomeZonesFor(null, new Set())).toEqual([]);
    expect(incomeZonesFor(viewOf([]), new Set())).toEqual([]);
  });
});

describe('activeObjectiveZoneNames', () => {
  it('names the zones of active objectives only', () => {
    const names = activeObjectiveZoneNames([
      { status: 'active', zone: 'approach' },
      { status: 'complete', zone: 'ammo_draw' },
      { status: 'active' },
    ]);
    expect([...names]).toEqual(['approach']);
  });
});

describe('a mission with no income zones (Review Focus 1)', () => {
  it('writes byte-identical zones to before: the objective list alone', () => {
    const objs = [{ id: 'hold_approach', type: 'hold_for', status: 'active', zone: 'approach', paused: 'unheld' as const }];
    const before = objectiveZonesFor(objs, ZONES);
    const after = [...objectiveZonesFor(objs, ZONES), ...incomeZonesFor(null, activeObjectiveZoneNames(objs))];
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe('main.ts wiring (Z-B)', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
  it('takes the income view once per beat, and hands it to both the world and the minimap', () => {
    expect(main.match(/incomeViewOf\(/g)).toHaveLength(1);
    expect(main).toMatch(/\.\.\.incomeZonesFor\(income, activeObjectiveZoneNames\(runtime\.objectiveList\)\)/);
    expect(main).toMatch(/income: \(\) => income,/);
  });
});

// S-F F2 C3 (Review Focus 4): the world supply route is written every frame from the HUD
// beat's one view, held by the logistics figure (hover or focus alike), cleared by any open
// dialog or the pause menu, and null on teardown. A Space jump onto a supply alert opens the
// display's jump window on the frame clock.
describe('main.ts wiring (C3, the world supply route)', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
  it('writes renderer.supplyRoutes from the display, every frame, from the beat\'s one view', () => {
    expect(main.match(/incomeViewOf\(/g)).toHaveLength(1);
    const write = /renderer\.supplyRoutes = supplyRouteDisplay\.routes\(\{([\s\S]*?)\}\);/.exec(main);
    expect(write).not.toBeNull();
    const body = write?.[1] ?? '';
    expect(body).toMatch(/view: income,/);
    expect(body).toMatch(/logisticsHeld: hud\.logisticsHeld,/);
    expect(body).toMatch(/modalOpen: isDialogOpen\(\) \|\| pauseHandle !== null,/);
    expect(body).toMatch(/nowMs: performance\.now\(\),/);
    // In the frame loop, before the frame is drawn.
    const loop = main.slice(main.indexOf('const loop = (): void => {'));
    expect(loop.indexOf('renderer.supplyRoutes = supplyRouteDisplay.routes(')).toBeGreaterThan(0);
    expect(loop.indexOf('renderer.supplyRoutes = supplyRouteDisplay.routes(')).toBeLessThan(loop.indexOf('renderer.frame('));
  });
  it('clears the route on teardown', () => {
    expect(main).toMatch(/onDispose\(\(\) => \{\s*renderer\.supplyRoutes = null;\s*\}\);/);
  });
  it('remembers the alert kind for the jump key, and a jump onto a supply alert opens the window', () => {
    expect(main).toMatch(/jumpTarget = nextJump\(jumpTarget, a\.tier, a\.at, a\.kind\);/);
    expect(main).toMatch(/if \(jumpTarget\.kind === 'supply'\) supplyRouteDisplay\.jumpLanded\(performance\.now\(\)\);/);
  });
});
