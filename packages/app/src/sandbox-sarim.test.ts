// GH-1381: Free play as Sarim. The two forces are the versus room's (PR 1507), placed by `versusSpawns`
// itself, on the sandbox's own anchors; the player stays side 0. Built on every map the Free play picker
// lists, through the REAL spawner `main.ts` boots with, never a copy of its loop.
import { describe, expect, it } from 'vitest';
import { Sim, TICKS_PER_SECOND } from '@lions/sim';
import { applyTerrain, parseMap, units, type MapId } from '@lions/data';
import { maps } from '@lions/data/content';
import { sandboxAnchors } from './sandbox-anchors';
import { standMapStructures } from './map-sim';
import { SANDBOX_CIV } from './sandbox-force';
import { sarimSandboxSpawns, sarimSandboxUnitTypes } from './sandbox-sarim';
import { VERSUS_KDF, VERSUS_SARIM } from './net/versus-force';
import { freePlayMapIds } from './ui/menu';

type UnitJson = { id: string; faction: string };
const unitJson = units as unknown as Readonly<Record<string, UnitJson>>;

/** A Free play world as `main.ts` builds one: terrain, buildings, every shipped type. */
function world(mapId: MapId): { sim: Sim; typeOf: Map<string, number>; anchors: ReturnType<typeof sandboxAnchors> } {
  const parsed = parseMap(maps[mapId]);
  const sim = new Sim({ seed: 20261118, width: parsed.width, height: parsed.height, capacity: 256 });
  applyTerrain(parsed, sim);
  standMapStructures(sim, parsed);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  return { sim, typeOf, anchors: sandboxAnchors(parsed) };
}

const sorted = (xs: readonly string[]): string[] => [...xs].sort();
const typeIdOf = (sim: Sim, id: number): string => sim.unitTypes[sim.state.typeIdx[id]].id;

describe('the Sarim Free play force (GH-1381)', () => {
  const ids = freePlayMapIds() as MapId[];

  it('is built on every map the picker lists (the walk is not vacuous)', () => {
    // Literal: the picker's count (sandbox-menu.test.ts pins the same 43).
    expect(ids).toHaveLength(43);
  });

  it('puts the versus Sarim force on side 0 and the versus KDF force on side 1, on every listed map', () => {
    // Literals for the two forces' sizes, so the check does not read its answer off the tables alone.
    expect([VERSUS_SARIM.length, VERSUS_KDF.length]).toEqual([26, 15]);
    for (const mapId of ids) {
      const { sim, typeOf, anchors } = world(mapId);
      const force = sarimSandboxSpawns(sim, typeOf, anchors, { civ: false });
      expect(sim.entityCount, mapId).toBe(41);
      const bySide: [string[], string[]] = [[], []];
      for (let i = 0; i < sim.entityCount; i++) {
        const side = sim.state.side[i];
        expect(side === 0 || side === 1, `${mapId}: unit ${i} side ${side}`).toBe(true);
        bySide[side as 0 | 1].push(typeIdOf(sim, i));
      }
      expect(sorted(bySide[0]), `${mapId} side 0`).toEqual(sorted(VERSUS_SARIM.map(([id]) => id)));
      expect(sorted(bySide[1]), `${mapId} side 1`).toEqual(sorted(VERSUS_KDF.map(([id]) => id)));
      // Sarim's side is Sarim and its raiders (`gun_truck` is faction `rif`), never the KDF.
      for (const t of bySide[0]) expect(['sarim', 'rif'], `${mapId}: ${t}`).toContain(unitJson[t].faction);
      for (const t of bySide[1]) expect(unitJson[t].faction, `${mapId}: ${t}`).toBe('kdf');
      // `player` is the commanded side, all of it: the &civ shepherds and the HUD's own count read it.
      expect(sorted(force.player.map(String)), mapId).toEqual(
        sorted(Array.from({ length: sim.entityCount }, (_, i) => i).filter((i) => sim.state.side[i] === 0).map(String)),
      );
      expect(force.civilians, mapId).toEqual([]);
    }
  });

  it('stands the player at the friendly anchor and the KDF at the hostile one, no two bodies on a tile, out of contact', () => {
    for (const mapId of ids) {
      const { sim, typeOf, anchors } = world(mapId);
      sarimSandboxSpawns(sim, typeOf, anchors, { civ: false });
      const st = sim.state;
      const tiles = new Set<number>();
      const centroid = [
        [0, 0, 0],
        [0, 0, 0],
      ];
      for (let i = 0; i < sim.entityCount; i++) {
        const tx = st.posX[i] >> 16;
        const ty = st.posY[i] >> 16;
        const t = ty * sim.width + tx;
        expect(tiles.has(t), `${mapId}: unit ${i} shares tile ${tx},${ty}`).toBe(false);
        tiles.add(t);
        const c = centroid[st.side[i]];
        c[0] += tx;
        c[1] += ty;
        c[2]++;
      }
      const d = (c: number[], p: readonly number[]): number => Math.hypot(c[0] / c[2] - p[0], c[1] / c[2] - p[1]);
      expect(d(centroid[0], anchors.friendly) < d(centroid[0], anchors.hostile), `${mapId}: Sarim at the friendly end`).toBe(true);
      expect(d(centroid[1], anchors.hostile) < d(centroid[1], anchors.friendly), `${mapId}: KDF at the hostile end`).toBe(true);
      // The closest pair across the line, in tiles: never inside 10 on any listed map (measured minimum 10.0,
      // umm_zeitoun_4), so neither side opens the game already in a firefight it did not choose.
      let gap = Infinity;
      for (let i = 0; i < sim.entityCount; i++) {
        for (let j = 0; j < sim.entityCount; j++) {
          if (st.side[i] !== 0 || st.side[j] !== 1) continue;
          gap = Math.min(gap, Math.hypot((st.posX[i] - st.posX[j]) / 65536, (st.posY[i] - st.posY[j]) / 65536));
        }
      }
      expect(gap, mapId).toBeGreaterThanOrEqual(10);
    }
  });

  it('garrisons nobody (the roof cutaway precondition the KDF force pins too)', () => {
    for (const mapId of ids) {
      const { sim, typeOf, anchors } = world(mapId);
      sarimSandboxSpawns(sim, typeOf, anchors, { civ: true });
      for (let t = 0; t < 2 * TICKS_PER_SECOND; t++) sim.tick();
      for (let id = 0; id < sim.entityCount; id++) {
        expect([sim.state.garrisonedIn[id], sim.state.garrisonGoal[id]], `${mapId}: unit ${id}`).toEqual([-1, -1]);
      }
    }
  });

  it('&civ adds the crowd last, on side 2, one unbroken id block', () => {
    const { sim, typeOf, anchors } = world('beit_sahwan_outskirts');
    const force = sarimSandboxSpawns(sim, typeOf, anchors, { civ: true });
    expect(force.civilians).toEqual(Array.from({ length: SANDBOX_CIV.length }, (_, k) => 41 + k));
    for (const id of force.civilians) expect([sim.state.side[id], typeIdOf(sim, id)]).toEqual([2, 'civilians']);
  });
});

describe('sarimSandboxUnitTypes: the mesh roster', () => {
  it('names exactly the types the Sarim Free play places, with and without &civ', () => {
    for (const civ of [false, true]) {
      const { sim, typeOf, anchors } = world('tel_marum');
      sarimSandboxSpawns(sim, typeOf, anchors, { civ });
      const placed = new Set(Array.from({ length: sim.entityCount }, (_, i) => typeIdOf(sim, i)));
      expect(sorted([...sarimSandboxUnitTypes({ civ })]), `civ ${civ}`).toEqual(sorted([...placed]));
    }
  });
});
