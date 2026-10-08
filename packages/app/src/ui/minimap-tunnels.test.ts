/**
 * GH-471: the minimap's tunnel mark, against a REAL `Sim` -- a pre_dug route
 * and a `mark_tunnel` carrier, the same rule the world's x-ray draws by.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHROME, tunnelMarks } from './minimap';

const MARKER: UnitTypeJson = {
  id: 'tn_marker',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['mark_tunnel'],
  weapons: [],
};

function world(withMarker: boolean): { sim: Sim; route: number } {
  const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
  const route = sim.addTunnel({ id: 'tn_a', points: [[2, 2], [8, 2]], dig_tiles_per_s: 1, pre_dug: true });
  if (withMarker) sim.spawn(sim.addUnitType(MARKER), 0, fx.from(4.5), fx.from(4.5));
  sim.tick();
  return { sim, route };
}

describe('tunnelMarks', () => {
  it('marks an identified route: its line, mouth to vent, and a shaft at each end', () => {
    const { sim, route } = world(true);
    expect(sim.tunnelContactLevel(0, route)).toBe(2);
    const marks = tunnelMarks(sim);
    expect(marks).toHaveLength(1);
    expect(marks[0].route).toBe(route);
    expect(marks[0].shafts[0]).toEqual([2.5, 2.5]);
    expect(marks[0].shafts[1]).toEqual([8.5, 2.5]);
    expect(marks[0].line.length).toBeGreaterThanOrEqual(12);
  });

  it('marks nothing for a route nobody has identified', () => {
    const { sim } = world(false);
    expect(tunnelMarks(sim)).toEqual([]);
  });

  it('marks nothing for a collapsed route', () => {
    const { sim, route } = world(true);
    sim.debugCollapseTunnel(route);
    expect(tunnelMarks(sim)).toEqual([]);
  });

  it('wears --intercept, which theme.css declares', () => {
    expect(CHROME.tunnel).toBe('var(--intercept)');
    const css = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/--intercept:\s*var\(--rl-vfx-interceptor\)/);
  });
});
