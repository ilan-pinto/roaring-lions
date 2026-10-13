import { describe, it, expect } from 'vitest';
import { versusSpawns, campOf, VERSUS_KDF } from './versus-force';
import { SANDBOX_KDF } from '../sandbox-force';
import { sandboxAnchors } from '../sandbox-anchors';
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
    const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
    const at = typeOf.get('at_team');
    for (const side of [0, 1] as const) {
      expect(force.bySide[side].filter((id) => sim.state.typeIdx[id] === at)).toHaveLength(2);
    }
  });
});

describe('versusSpawns', () => {
  it('puts the second at_team on the exact mirrored tiles (beit_sahwan_outskirts)', () => {
    const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
    const anchors = sandboxAnchors(map);
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
      const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
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
      const anchors = sandboxAnchors(map);
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
    versusSpawns(a.sim, a.typeOf, sandboxAnchors(a.map));
    versusSpawns(b.sim, b.typeOf, sandboxAnchors(b.map));
    expect(a.sim.hash()).toBe(b.sim.hash());
  });

  it("each side's camp is its own anchor", () => {
    const anchors = { friendly: [5, 24] as const, hostile: [40, 24] as const };
    expect(campOf(anchors, 0)).toEqual([5, 24]);
    expect(campOf(anchors, 1)).toEqual([40, 24]);
  });
});
