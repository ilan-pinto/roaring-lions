// Read-only queries the app used to do by hand.
//
// Each replaces an inline lookup in packages/app/src/main.ts. They exist so
// one resolver can answer "what would clicking here do" without the app
// importing sim constants or hand-rolling a scan over tunnel routes.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';
import { PROTECTED_ROE } from './structures';

const HOUSE = { id: 'house', name: 'House', hp_per_tile: 200, garrison_slots: 2, rubble_cover: 2 };
const SHRINE = { id: 'shrine', name: 'Shrine', hp_per_tile: 200, garrison_slots: 0, rubble_cover: 1, low_profile: true, roe_penalty: 30 };
const FENCE = { id: 'wall', name: 'Compound Wall', hp_per_tile: 200, garrison_slots: 0, rubble_cover: 1, low_profile: true, standing_cover: 2 };
const APARTMENT = { id: 'apartment', name: 'Apartment', hp_per_tile: 300, garrison_slots: 4, rubble_cover: 2, roe_penalty: 14 };

const ROUTE = { id: 'q_route', points: [[5, 5], [9, 5]] as const, dig_tiles_per_s: 1 };

/** mark_tunnel and nothing else — the walk-by scout's shape. */
const SCOUT: UnitTypeJson = {
  id: 'q_scout',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 20, signature: 0.5 },
  abilities: ['mark_tunnel'],
};

const RIFLE: UnitTypeJson = {
  id: 'q_rifle',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  abilities: ['garrison'],
};

/** A bare 24x24 world with no structures and no tunnels. */
function bare(): Sim {
  return new Sim({ seed: 5, width: 24, height: 24, capacity: 16 });
}

/** addStructure takes FLAT tile indices, not coordinates. */
const tileIdx = (sim: Sim, x: number, y: number): number => y * sim.width + x;

describe('tunnelAt', () => {
  it('returns -1 on a map with no tunnels at all', () => {
    expect(bare().tunnelAt(5, 5)).toBe(-1);
  });

  it('refuses a route the player has not identified, even standing on it', () => {
    // The gate is the point: tunnelUnderTile says yes and tunnelAt still says
    // no. Without this pairing the next case would pass on a query that
    // ignored contact level entirely.
    const sim = bare();
    const r = sim.addTunnel(ROUTE);
    expect(sim.tunnelUnderTile(r, 5, 5)).toBe(true);
    expect(sim.tunnelContactLevel(0, r)).toBeLessThan(2);
    expect(sim.tunnelAt(5, 5)).toBe(-1);
  });

  it('returns the route once identified, and only under its own tiles', () => {
    const sim = bare();
    const r = sim.addTunnel(ROUTE);
    const scout = sim.spawn(sim.addUnitType(SCOUT), 0, fx.from(7.5), fx.from(6.5));
    expect(scout).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 20 * TICKS_PER_SECOND && sim.tunnelContactLevel(0, r) < 2; i++) sim.tick();
    expect(sim.tunnelContactLevel(0, r)).toBe(2);
    expect(sim.tunnelAt(5, 5)).toBe(r);
    expect(sim.tunnelAt(20, 20)).toBe(-1);
  });
});

describe('structure queries', () => {
  it('reads a penalty back and calls the shrine protected', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(SHRINE), [tileIdx(sim, 3, 3)]);
    expect(sim.structureRoePenalty(s)).toBe(30);
    expect(sim.structureRoePenalty(s)).toBeGreaterThanOrEqual(PROTECTED_ROE);
    expect(sim.isProtected(s)).toBe(true);
  });

  it('leaves an apartment unprotected but not free — the middle tier', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(APARTMENT), [tileIdx(sim, 8, 8)]);
    expect(sim.isProtected(s)).toBe(false);
    expect(sim.structureRoePenalty(s)).toBe(14);
  });

  it('gives a wall no penalty at all', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(FENCE), [tileIdx(sim, 20, 20)]);
    expect(sim.structureRoePenalty(s)).toBe(0);
    expect(sim.isProtected(s)).toBe(false);
  });

  it('reports garrison space and counts an occupant against it', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(HOUSE), [tileIdx(sim, 12, 12)]);
    expect(sim.garrisonFree(s)).toBe(2);
    const id = sim.spawn(sim.addUnitType(RIFLE), 0, fx.from(12.5), fx.from(13.5));
    sim.queueCommand({ kind: 'garrison', ids: [id], structure: s });
    for (let i = 0; i < 30 * TICKS_PER_SECOND && sim.garrisonFree(s) === 2; i++) sim.tick();
    expect(sim.garrisonFree(s)).toBe(1);
  });

  it('reports zero free slots for a structure nobody can garrison', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(FENCE), [tileIdx(sim, 21, 21)]);
    expect(sim.garrisonFree(s)).toBe(0);
  });
});
