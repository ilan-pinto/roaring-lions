import { describe, expect, it } from 'vitest';
import { doctrines, units } from '@lions/data';
import { sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import { buildMatchWorld } from './match-world';
import { decideOnHashTick, outcomeOf, productionFor, productionOf, unitCost, type OutcomeSim } from './outcome';

const TYPES = [
  { id: 'armed', weapons: [1], stepPerTick: 3000, isAir: false },
] as const;
/** Side 0 has an armed unit; side 1 has nothing alive. */
function sim(): OutcomeSim {
  return {
    entityCount: 1,
    state: { side: Uint8Array.of(0), alive: Uint8Array.of(1), typeIdx: Uint16Array.of(0), firepowerKilled: Uint8Array.of(0), mobilityKilled: Uint8Array.of(0) },
    unitTypes: TYPES,
  };
}
/** Both sides immobile: a stalemate unless production says otherwise. */
function fixedSim(): OutcomeSim {
  return {
    entityCount: 2,
    state: { side: Uint8Array.of(0, 1), alive: Uint8Array.of(1, 1), typeIdx: Uint16Array.of(0, 0), firepowerKilled: Uint8Array.of(0, 0), mobilityKilled: Uint8Array.of(0, 0) },
    unitTypes: [{ id: 'armed', weapons: [1], stepPerTick: 0, isAir: false }],
  };
}

interface Line { alive: boolean; current: string | null; items: string[] }
function runtime(lines1: Line[], purse1: number) {
  return {
    productionLines: (side: 0 | 1): Line[] => (side === 1 ? lines1 : []),
    logisticsOf: (side: 0 | 1): number => (side === 1 ? purse1 : 0),
  };
}
const camp = (over: Partial<Line> = {}): Line => ({ alive: true, current: null, items: [], ...over });
const sarim = doctrines.sarim.menu;
const armedCost = (menu: readonly string[]): number =>
  Math.min(...menu.filter((id) => ((units as Record<string, { weapons?: unknown[] }>)[id].weapons?.length ?? 0) > 0).map(unitCost));
const cheapest = armedCost(sarim);

describe('the win rule counts production (N3 Task 5)', () => {
  it('data: the cheapest armed Sarim unit is priced (201 today)', () => {
    expect(cheapest).toBeGreaterThan(0);
    expect(Number.isFinite(cheapest)).toBe(true);
  });

  it('no production: a side with no armed unit loses (today)', () => {
    expect(outcomeOf(sim(), 100)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('a living camp and a purse that covers the cheapest armed unit: ongoing', () => {
    const p = productionFor(runtime([camp()], cheapest), [doctrines.kdf.menu, sarim]);
    expect(outcomeOf(sim(), 100, unitCost, p)).toEqual({ kind: 'ongoing' });
  });

  it('one logistics short with an empty queue: lost by annihilation', () => {
    const p = productionFor(runtime([camp()], cheapest - 1), [doctrines.kdf.menu, sarim]);
    expect(outcomeOf(sim(), 100, unitCost, p)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('a queued armed unit with purse 0 keeps it standing; an in-progress one too', () => {
    const m: [readonly string[], readonly string[]] = [doctrines.kdf.menu, sarim];
    expect(outcomeOf(sim(), 100, unitCost, productionFor(runtime([camp({ items: ['atgm_cell'] })], 0), m))).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(sim(), 100, unitCost, productionFor(runtime([camp({ current: 'atgm_cell' })], 0), m))).toEqual({ kind: 'ongoing' });
  });

  it('an unarmed queued item does not keep it standing', () => {
    const p = productionFor(runtime([camp({ items: ['recon_drone'] })], 0), [doctrines.kdf.menu, sarim]);
    expect(outcomeOf(sim(), 100, unitCost, p)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('camp destroyed: it loses, purse and queue notwithstanding', () => {
    const p = productionFor(runtime([camp({ alive: false, items: ['atgm_cell'] })], 99999), [doctrines.kdf.menu, sarim]);
    expect(outcomeOf(sim(), 100, unitCost, p)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('M2: the cheapest ARMED unit counts, not the cheapest unit (menu [recon_drone, inf_squad], purse 250)', () => {
    const drone = unitCost('recon_drone');
    const squad = unitCost('inf_squad');
    expect(drone).toBeLessThanOrEqual(250);
    expect(squad).toBeGreaterThan(250);
    const p = productionFor(runtime([camp()], 250), [doctrines.kdf.menu, ['recon_drone', 'inf_squad']]);
    expect(outcomeOf(sim(), 100, unitCost, p)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('a side that can field is not immobile: no stalemate while it can still buy; stalemate once it cannot', () => {
    const m: [readonly string[], readonly string[]] = [doctrines.kdf.menu, sarim];
    expect(outcomeOf(fixedSim(), 100, unitCost, productionFor(runtime([camp()], cheapest), m))).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(fixedSim(), 100, unitCost, productionFor(runtime([camp()], cheapest - 1), m)).kind).toBe('draw');
    expect(outcomeOf(fixedSim(), 100).kind).toBe('draw');
  });
});

describe('productionOf on a real world', () => {
  const cfg = (factions: ['kdf' | 'sarim', 'kdf' | 'sarim']): MatchConfig => {
    const sides = sidesOfFactions(factions);
    const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 7, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
    if (c === null) throw new Error('bad fixture');
    return c;
  };
  it('a mirror room has none; an economy room reads its runtime and its faction menus', () => {
    expect(productionOf(buildMatchWorld(cfg(['kdf', 'kdf'])))).toBeUndefined();
    const w = buildMatchWorld(cfg(['kdf', 'sarim']));
    const p = productionOf(w);
    expect(p).toBeDefined();
    expect(p?.canField(0)).toBe(true);
    expect(p?.canField(1)).toBe(true);
    expect(w.runtime?.logisticsOf(1)).toBeGreaterThanOrEqual(cheapest);
  });

  it('decideOnHashTick: a side with no units but a camp and a purse is not called beaten when production is passed', () => {
    const c = cfg(['kdf', 'sarim']);
    const w = buildMatchWorld(c);
    for (const id of w.bySide[1]) w.sim.debugKill(id);
    // The mirror rule (no production) calls it; the room's rule does not.
    expect(decideOnHashTick(null, 19, c, w.sim)?.result).toMatchObject({ kind: 'won', side: 0, by: 'annihilation' });
    expect(decideOnHashTick(null, 19, c, w.sim, productionOf(w))).toBeNull();
  });
});
