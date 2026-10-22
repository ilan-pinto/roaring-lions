import { describe, it, expect } from 'vitest';
import { units } from '@lions/data';
import type { MatchConfig } from '@lions/net';
import { versusSpawns, campOf, factionsBySide, versusForceOf, versusUnitTypes, VERSUS_KDF, VERSUS_SARIM } from './versus-force';
import { unitCost } from './outcome';
import { SANDBOX_KDF } from '../sandbox-force';
import { versusAnchors } from './versus-seats';
import { buildWorld } from './versus-world.test-helper';

describe('the versus force is the sandbox force plus a second Spike team', () => {
  const atTeams = (force: readonly (readonly [string, number, number])[]) => force.filter(([id]) => id === 'at_team');

  it('leaves the single-player sandbox force alone (the golden gate photographs it)', () => {
    expect(SANDBOX_KDF).toHaveLength(14);
    expect(atTeams(SANDBOX_KDF)).toEqual([['at_team', 1, -2]]);
  });

  it('adds exactly one at_team, appended so every earlier placement keeps its index', () => {
    expect(VERSUS_KDF.slice(0, SANDBOX_KDF.length)).toEqual(SANDBOX_KDF);
    expect(VERSUS_KDF).toHaveLength(SANDBOX_KDF.length + 1);
    expect(atTeams(VERSUS_KDF)).toEqual([
      ['at_team', 1, -2],
      ['at_team', 1, 2],
    ]);
    const spots = VERSUS_KDF.map(([, dx, dy]) => `${dx},${dy}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('fields two at_team per side on a real map', () => {
    const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
    const force = versusSpawns(sim, typeOf, versusAnchors(map));
    const at = typeOf.get('at_team');
    for (const side of [0, 1] as const) {
      expect(force.bySide[side].filter((id) => sim.state.typeIdx[id] === at)).toHaveLength(2);
    }
  });
});

describe('versusSpawns', () => {
  it('puts the second at_team on the exact mirrored tiles (beit_sahwan_outskirts)', () => {
    const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
    const anchors = versusAnchors(map);
    const force = versusSpawns(sim, typeOf, anchors);
    const k = VERSUS_KDF.length - 1;
    const [id, dx, dy] = VERSUS_KDF[k];
    expect(id).toBe('at_team');
    const tileOf = (i: number): [number, number] => [sim.state.posX[i] >> 16, sim.state.posY[i] >> 16];
    expect(tileOf(force.bySide[0][k])).toEqual([Math.round(anchors.friendly[0] + dx), Math.round(anchors.friendly[1] + dy)]);
    expect(tileOf(force.bySide[1][k])).toEqual([Math.round(anchors.hostile[0] - dx), Math.round(anchors.hostile[1] - dy)]);
  });

  for (const mapId of ['beit_sahwan_outskirts', 'tel_marum'] as const) {
    it(`fields the same KDF force on each side, nothing else, on open ground (${mapId})`, () => {
      const { sim, typeOf, map } = buildWorld(mapId);
      const force = versusSpawns(sim, typeOf, versusAnchors(map));
      expect(force.bySide[0]).toHaveLength(VERSUS_KDF.length);
      expect(force.bySide[1]).toHaveLength(VERSUS_KDF.length);
      expect(sim.entityCount).toBe(2 * VERSUS_KDF.length);
      for (let i = 0; i < sim.entityCount; i++) {
        expect([0, 1]).toContain(sim.state.side[i]);
        const tx = sim.state.posX[i] >> 16;
        const ty = sim.state.posY[i] >> 16;
        expect(sim.blocked[ty * sim.width + tx]).toBe(0);
      }
    });

    it(`side 1 is side 0's formation mirrored through its own anchor (${mapId})`, () => {
      const { sim, typeOf, map } = buildWorld(mapId);
      const anchors = versusAnchors(map);
      const force = versusSpawns(sim, typeOf, anchors);
      const tileOf = (i: number): [number, number] => [sim.state.posX[i] >> 16, sim.state.posY[i] >> 16];
      const openAt = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < sim.width && y < sim.height && sim.blocked[y * sim.width + x] === 0;
      let checked = 0;
      VERSUS_KDF.forEach(([, dx, dy], k) => {
        const want0: [number, number] = [Math.round(anchors.friendly[0] + dx), Math.round(anchors.friendly[1] + dy)];
        const want1: [number, number] = [Math.round(anchors.hostile[0] - dx), Math.round(anchors.hostile[1] - dy)];
        // An offset that lands in rock is spiralled to the nearest open tile
        // by the shared placer; only a placement that needs no such shift
        // pins the mirror to the tile.
        if (!openAt(...want0) || !openAt(...want1)) return;
        expect(tileOf(force.bySide[0][k])).toEqual(want0);
        expect(tileOf(force.bySide[1][k])).toEqual(want1);
        checked++;
      });
      expect(checked).toBeGreaterThan(VERSUS_KDF.length / 3);
    });
  }

  it('is deterministic: two worlds spawn identical states', () => {
    const a = buildWorld('beit_sahwan_outskirts');
    const b = buildWorld('beit_sahwan_outskirts');
    versusSpawns(a.sim, a.typeOf, versusAnchors(a.map));
    versusSpawns(b.sim, b.typeOf, versusAnchors(b.map));
    expect(a.sim.hash()).toBe(b.sim.hash());
  });

  it("a camp is its END's anchor", () => {
    const anchors = { friendly: [5, 24] as const, hostile: [40, 24] as const };
    expect(campOf(anchors, 'friendly')).toEqual([5, 24]);
    expect(campOf(anchors, 'hostile')).toEqual([40, 24]);
  });
});

describe('KDF vs Sarim (2026-10-14)', () => {
  const value = (force: readonly (readonly [string, number, number])[]): number => force.reduce((sum, [id]) => sum + unitCost(id), 0);
  const factionOf = (id: string): string => (units as Record<string, { faction: string }>)[id].faction;

  it('the mirror is untouched: the same spawn, tick for tick, as before KDF vs Sarim existed', () => {
    // Pinned from the tree before this change (`versusSpawns` with no factions, 200 ticks).
    // Re-pinned 2026-10-14 for targeted fire (GH-420): two per-unit columns, focusTarget and focusLost, join the sim hash. No behaviour moved: with their hashArray lines removed, both maps reproduce the old values. Was 873892333 / 3176591845.
    // Re-pinned 2026-10-22 for beit's versus seats (`versus-seats.ts`): seat 1 moved from
    // town_center (31,22) to (40,24) after the probe read the mirror west 38 / east 10.
    // The spawn moved and nothing else. Was 580559085. tel_marum re-pinned the same day when
    // its seat 0 moved from start_line (24,44) to (24,46) (the lead's ruling). Was 1260439781.
    const want: Record<string, number> = { beit_sahwan_outskirts: 3296182002, tel_marum: 1524988923 };
    for (const mapId of ['beit_sahwan_outskirts', 'tel_marum'] as const) {
      for (const factions of [undefined, ['kdf', 'kdf'] as const]) {
        const { sim, typeOf, map } = buildWorld(mapId);
        versusSpawns(sim, typeOf, versusAnchors(map), factions);
        for (let i = 0; i < 200; i++) sim.tick();
        expect(sim.hash()).toBe(want[mapId]);
      }
    }
  });

  it('the Sarim force is opposition units only, worth the KDF force to within 5%', () => {
    for (const [id] of VERSUS_SARIM) expect(['sarim', 'rif', 'ashwar']).toContain(factionOf(id));
    const kdf = value(VERSUS_KDF);
    const sarim = value(VERSUS_SARIM);
    expect(Math.abs(sarim - kdf) / kdf).toBeLessThan(0.05);
    const spots = VERSUS_SARIM.map(([, dx, dy]) => `${dx},${dy}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('is the force the probe measured: a change here re-runs the probe and the PR table', () => {
    const counts: Record<string, number> = {};
    for (const [id] of VERSUS_SARIM) counts[id] = (counts[id] ?? 0) + 1;
    expect(counts).toEqual({ sarim_rifles: 2, atgm_cell: 14, gun_truck: 6, manpad_team: 2, rocket_battery: 2 });
    expect(value(VERSUS_SARIM)).toBe(6736);
    expect(value(VERSUS_KDF)).toBe(6664);
  });

  it('a faction fields its own force', () => {
    expect(versusForceOf('kdf')).toBe(VERSUS_KDF);
    expect(versusForceOf('sarim')).toBe(VERSUS_SARIM);
  });

  // LD1: the KDF is side 0; a Sarim host is side 1 at the friendly end.
  for (const ends of [['friendly', 'hostile'], ['hostile', 'friendly']] as const) {
    const factions = ['kdf', 'sarim'] as const;
    it(`each side spawns its faction's force on open ground (KDF side 0 at the ${ends[0]} end, tel_marum)`, () => {
      const { sim, typeOf, map } = buildWorld('tel_marum');
      const force = versusSpawns(sim, typeOf, versusAnchors(map), factions, ends);
      for (const side of [0, 1] as const) {
        const want = versusForceOf(factions[side]).map(([id]) => id);
        expect(force.bySide[side].map((i) => sim.unitTypes[sim.state.typeIdx[i]].id)).toEqual(want);
        for (const i of force.bySide[side]) {
          expect(sim.state.side[i]).toBe(side);
          expect(sim.blocked[(sim.state.posY[i] >> 16) * sim.width + (sim.state.posX[i] >> 16)]).toBe(0);
        }
      }
    });
  }

  it('factions are read by SIDE from the shared config; no config is the mirror', () => {
    const cfg = (a: 'kdf' | 'sarim', b: 'kdf' | 'sarim') => ({ seats: [{ side: 0, faction: a }, { side: 1, faction: b }] }) as unknown as MatchConfig;
    expect(factionsBySide(cfg('sarim', 'kdf'))).toEqual(['sarim', 'kdf']);
    expect(factionsBySide({ seats: [{ side: 1, faction: 'sarim' }, { side: 0, faction: 'kdf' }] } as unknown as MatchConfig)).toEqual(['kdf', 'sarim']);
    expect(factionsBySide(null)).toEqual(['kdf', 'kdf']);
  });

  it('the mesh roster is both factions\' forces', () => {
    const roster = versusUnitTypes(['kdf', 'sarim']);
    for (const [id] of [...VERSUS_KDF, ...VERSUS_SARIM]) expect(roster.has(id)).toBe(true);
    expect(versusUnitTypes(['kdf', 'kdf']).has('atgm_cell')).toBe(false);
  });

  it('both seats of one KDF-vs-Sarim room spawn the same world', () => {
    const a = buildWorld('tel_marum');
    const b = buildWorld('tel_marum');
    versusSpawns(a.sim, a.typeOf, versusAnchors(a.map), ['kdf', 'sarim'], ['hostile', 'friendly']);
    versusSpawns(b.sim, b.typeOf, versusAnchors(b.map), ['kdf', 'sarim'], ['hostile', 'friendly']);
    for (let i = 0; i < 100; i++) { a.sim.tick(); b.sim.tick(); }
    expect(a.sim.hash()).toBe(b.sim.hash());
  });
});

describe('LD1 (N3 Task 2): the spawn end follows the seat, the side follows the faction', () => {
  // The world before LD1 for a Sarim host: Sarim on side 0, at the friendly end.
  // After: Sarim on side 1, at the friendly end. Only the side labels may differ.
  const read = (sim: ReturnType<typeof buildWorld>['sim'], ids: readonly number[]) =>
    ids.map((i) => [sim.unitTypes[sim.state.typeIdx[i]].id, sim.state.posX[i], sim.state.posY[i], sim.state.facing[i]]);
  for (const mapId of ['tel_marum', 'wadi_tarfan'] as const) {
    it(`a Sarim host's side-1 unit k stands where the side-0 Sarim unit k stood, with the same facing (${mapId})`, () => {
      const before = buildWorld(mapId);
      const old = versusSpawns(before.sim, before.typeOf, versusAnchors(before.map), ['sarim', 'kdf']);
      const after = buildWorld(mapId);
      const now = versusSpawns(after.sim, after.typeOf, versusAnchors(after.map), ['kdf', 'sarim'], ['hostile', 'friendly']);
      expect(read(after.sim, now.bySide[1])).toEqual(read(before.sim, old.bySide[0]));
      expect(read(after.sim, now.bySide[0])).toEqual(read(before.sim, old.bySide[1]));
      for (const i of now.bySide[1]) expect(after.sim.state.side[i]).toBe(1);
      for (const i of now.bySide[0]) expect(after.sim.state.side[i]).toBe(0);
    });
    it(`the friendly end's force is placed first, whichever side it is: the same entity ids (${mapId})`, () => {
      const before = buildWorld(mapId);
      const old = versusSpawns(before.sim, before.typeOf, versusAnchors(before.map), ['sarim', 'kdf']);
      const after = buildWorld(mapId);
      const now = versusSpawns(after.sim, after.typeOf, versusAnchors(after.map), ['kdf', 'sarim'], ['hostile', 'friendly']);
      expect(now.bySide[1]).toEqual(old.bySide[0]);
      expect(now.bySide[0]).toEqual(old.bySide[1]);
      expect(now.bySide[1][0]).toBe(0);
    });
  }
  it('refuses two sides on one end', () => {
    const { sim, typeOf, map } = buildWorld('tel_marum');
    expect(() => versusSpawns(sim, typeOf, versusAnchors(map), ['kdf', 'sarim'], ['friendly', 'friendly'])).toThrow(/two ends/);
  });
});
