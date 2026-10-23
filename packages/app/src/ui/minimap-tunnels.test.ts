/**
 * GH-471: the minimap's tunnel mark, against a REAL `Sim` -- a pre_dug route
 * and a `mark_tunnel` carrier, the same rule the world's x-ray draws by.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHROME, tunnelMarks, unitDots } from './minimap';

const MARKER: UnitTypeJson = {
  id: 'tn_marker',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['mark_tunnel'],
  weapons: [],
};

function world(withMarker: boolean, markerSide = 0): { sim: Sim; route: number } {
  const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
  const route = sim.addTunnel({ id: 'tn_a', points: [[2, 2], [8, 2]], dig_tiles_per_s: 1, pre_dug: true });
  if (withMarker) sim.spawn(sim.addUnitType(MARKER), markerSide, fx.from(4.5), fx.from(4.5));
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

  it('marks what the VIEWER\'s side has identified, not side 0\'s (N1a task 6)', () => {
    const own = world(true, 1);
    expect(own.sim.tunnelContactLevel(1, own.route)).toBe(2);
    expect(tunnelMarks(own.sim, 1).map((m) => m.route)).toEqual([own.route]);
    expect(tunnelMarks(own.sim, 0)).toEqual([]);
    const theirs = world(true, 0);
    expect(tunnelMarks(theirs.sim, 1)).toEqual([]);
  });

  it('GH-681: the route a seat OWNS is marked for that seat always, and for the other seat not until found', () => {
    const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8, humanHeld: [true, true] });
    const route = sim.addTunnel({ id: 'tn_s', points: [[2, 2], [8, 2]], dig_tiles_per_s: 1, pre_dug: true, side: 1 });
    sim.tick();
    expect(sim.tunnelContactLevel(1, route)).toBe(0);
    expect(tunnelMarks(sim, 1).map((m) => m.route)).toEqual([route]);
    expect(tunnelMarks(sim, 0)).toEqual([]);
    // The other seat's carrier finds it: now the KDF screen marks it too.
    sim.spawn(sim.addUnitType(MARKER), 0, fx.from(4.5), fx.from(4.5));
    sim.tick();
    expect(tunnelMarks(sim, 0).map((m) => m.route)).toEqual([route]);
  });

  it('GH-681 fog audit: a buried Sarim unit makes no dot and no mark on the KDF minimap, all fog lifted', () => {
    const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8, humanHeld: [true, true] });
    const route = sim.addTunnel({ id: 'tn_s', points: [[2, 2], [8, 2]], dig_tiles_per_s: 1, pre_dug: true, side: 1 });
    const rifle = sim.addUnitType({ ...MARKER, id: 'tn_rifle', role: 'infantry', abilities: [] });
    const sarim = sim.spawn(rifle, 1, fx.from(1.5), fx.from(2.5));
    sim.queueCommand({ kind: 'enterTunnel', ids: [sarim], tunnel: route });
    for (let t = 0; t < 120 && sim.state.tunnelIn[sarim] < 0; t++) sim.tick();
    expect(sim.state.tunnelIn[sarim]).toBe(route);
    const everything = (): boolean => true;
    expect(unitDots(sim, everything, 0).filter((d) => d.side === 1)).toEqual([]);
    expect(tunnelMarks(sim, 0)).toEqual([]);
  });

  it('wears --intercept, which theme.css declares', () => {
    expect(CHROME.tunnel).toBe('var(--intercept)');
    const css = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/--intercept:\s*var\(--rl-vfx-interceptor\)/);
  });
});
