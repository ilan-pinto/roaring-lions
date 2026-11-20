// Free play boots on every map with field works on (their default since 18 Nov 2026) and off.
//
// v0.134.1 shipped `/free-play/bir_tarsha` dead on arrival: "mission sandbox_works: demo_squad body 1 of 1 spawns at
// (27,36), which is blocked". The works builder stood on its raw offset from the friendly anchor, and the
// `MissionRuntime` that raises it refuses a blocked tile instead of searching; the sandbox force beside it already
// went through the nearest-open-tile placer. Bir Tarsha, Bir Tarsha 2 and Umm Zeitoun all failed. Nothing booted
// every map with the works on, so this does: every shipped map, both sides, flags read by the app's own `bootFlags`,
// the force placed by the app's own spawners, and the works runtime started over the app's own builders.
import { describe, expect, it } from 'vitest';
import { DOMAIN_VEHICLE, MissionRuntime, Sim, fx } from '@lions/sim';
import { applyTerrain, mapManifest, parseMap, units, type MapId } from '@lions/data';
import { maps } from '@lions/data/content';
import { bootFlags } from './boot-flags';
import { sandboxAnchors } from './sandbox-anchors';
import { standMapStructures } from './map-sim';
import { SANDBOX_WORKS_KDF } from './sandbox-force';
import { sandboxSpawns } from './sandbox-spawn';
import { sarimSandboxSpawns } from './sandbox-sarim';
import { sandboxWorksBuilders, sandboxWorksMission } from './sandbox-works';
import { UNLISTED_MAP_IDS, freePlayMapIds } from './ui/menu';

type Side = 'kdf' | 'sarim';

/**
 * One Free play boot, in `main.ts`'s order: flags, terrain, buildings, the force, then (works on) the works runtime.
 * `crowd` stands one more KDF body on each named tile as part of the force, for a case no shipped boot makes: a body
 * on the very tile the builder would take.
 */
function boot(
  mapId: MapId,
  side: Side,
  query: string,
  crowd: readonly (readonly [number, number])[] = []
): { sim: Sim; works: boolean; builders: number[]; raw: Raw[] } {
  const params = new URLSearchParams(side === 'sarim' ? `side=sarim&${query}` : query);
  const { side: got, flags } = bootFlags(params, { missionId: null, inRoom: false }, () => {});
  expect(got).toBe(side);
  const mapJson = maps[mapId];
  const parsed = parseMap(mapJson);
  const sim = new Sim({ seed: 20261119, width: parsed.width, height: parsed.height, capacity: 256 });
  applyTerrain(parsed, sim);
  standMapStructures(sim, parsed);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  const anchors = sandboxAnchors(mapJson);
  if (side === 'sarim') sarimSandboxSpawns(sim, typeOf, anchors, { civ: flags.civ });
  else sandboxSpawns(sim, typeOf, anchors, { tunnel: flags.tunnel, sur: flags.sur, civ: flags.civ, works: flags.works });
  for (const [x, y] of crowd) sim.spawn(typeOf.get('inf_squad') as number, 0, fx.from(x + 0.5), fx.from(y + 0.5), 0);
  const before = sim.entityCount;
  // Read BEFORE the builders are placed, independently of `openTileFor`: each builder's raw offset from the friendly
  // anchor, and whether that tile is clear on the builder's own mask and stood on by no living body of the force.
  const raw: Raw[] = SANDBOX_WORKS_KDF.map(([unit, dx, dy]) => {
    const x = anchors.friendly[0] + dx;
    const y = anchors.friendly[1] + dy;
    const t = typeOf.get(unit) as number;
    const mask = sim.unitTypes[t].moveDomain === DOMAIN_VEHICLE ? sim.blockedVehicle : sim.blocked;
    const inside = x >= 0 && y >= 0 && x < sim.width && y < sim.height;
    const clear = inside && mask[y * sim.width + x] === 0;
    let free = true;
    for (let i = 0; i < before; i++) {
      if (sim.state.alive[i] === 1 && sim.state.posX[i] >> 16 === x && sim.state.posY[i] >> 16 === y) free = false;
    }
    return { x, y, clear, free };
  });
  if (flags.works) {
    new MissionRuntime(sim, sandboxWorksMission(sim.structureTypes, sandboxWorksBuilders(sim, typeOf, anchors)), {
      typeIdOf: (id) => typeOf.get(id) ?? 0,
      markers: parsed.markers,
      zones: parsed.zones,
    }).start();
  }
  const builders: number[] = [];
  for (let i = before; i < sim.entityCount; i++) builders.push(i);
  return { sim, works: flags.works, builders, raw };
}

/** A builder's raw tile (its `SANDBOX_WORKS_KDF` offset from the friendly anchor) as the force left it. */
interface Raw {
  x: number;
  y: number;
  /** Clear on the builder's own mask. */
  clear: boolean;
  /** No living body of the force stands on it. */
  free: boolean;
}

/** The tile a body stands on. */
const tileOf = (sim: Sim, i: number): [number, number] => [sim.state.posX[i] >> 16, sim.state.posY[i] >> 16];

const ids = Object.keys(maps) as MapId[];

describe('Free play boots with field works on and off, on every map and both sides', () => {
  it('the maps are the shipped catalogue, and the picker lists all of them but the held-out cards', () => {
    expect(ids.length).toBeGreaterThan(0); // a loop over nothing passes vacuously
    expect([...ids].sort()).toEqual(Object.keys(mapManifest).sort());
    expect(freePlayMapIds()).toEqual(Object.keys(mapManifest).filter((id) => !UNLISTED_MAP_IDS.has(id)));
    expect(freePlayMapIds().length).toBeGreaterThan(0);
  });

  for (const mapId of ids) {
    it(`${mapId}: KDF with works (the default) starts, and each builder stands on open ground`, () => {
      const { sim, works, builders } = boot(mapId, 'kdf', '');
      expect(works, 'works are on by default in a KDF Free play').toBe(true);
      expect(builders.map((i) => sim.unitTypes[sim.state.typeIdx[i]].id)).toEqual(SANDBOX_WORKS_KDF.map(([id]) => id));
      for (const i of builders) {
        const mask = sim.unitTypes[sim.state.typeIdx[i]].moveDomain === DOMAIN_VEHICLE ? sim.blockedVehicle : sim.blocked;
        const tile = (sim.state.posY[i] >> 16) * sim.width + (sim.state.posX[i] >> 16);
        expect(mask[tile], `${mapId}: builder ${i} on a blocked tile`).toBe(0);
        expect(sim.state.side[i]).toBe(0);
      }
    });
    it(`${mapId}: a builder keeps its raw tile when that is open and free, and never takes a body's tile`, () => {
      const { sim, builders, raw } = boot(mapId, 'kdf', '');
      expect(builders.length).toBe(SANDBOX_WORKS_KDF.length);
      builders.forEach((i, k) => {
        const [bx, by] = tileOf(sim, i);
        // PR 1662's claim: where the raw offset is already open and free, the spiral returns it at ring 0, so the
        // builder spawns exactly where it did before the placer.
        if (raw[k].clear && raw[k].free) {
          expect([bx, by], `${mapId}: builder ${i} left its open, free raw tile`).toEqual([raw[k].x, raw[k].y]);
        }
        // And the placer runs AFTER the force stands, so no other living body shares the builder's tile.
        for (let j = 0; j < sim.entityCount; j++) {
          if (j === i || sim.state.alive[j] !== 1) continue;
          const [jx, jy] = tileOf(sim, j);
          expect(jx === bx && jy === by, `${mapId}: builder ${i} shares (${bx},${by}) with body ${j}`).toBe(false);
        }
      });
    });
    it(`${mapId}: with a body already on the builder's tile, the builder stands on another`, () => {
      // No shipped boot puts a force body on the builder's tile (every flag mix was tried), so the order and the
      // occupancy test only bite when one is made to: stand a body where the uncrowded boot put the builder.
      const first = boot(mapId, 'kdf', '');
      const taken = first.builders.map((i) => tileOf(first.sim, i));
      const { sim, builders, raw } = boot(mapId, 'kdf', '', taken);
      expect(builders.length).toBe(SANDBOX_WORKS_KDF.length);
      raw.forEach((r, k) => {
        if (r.x === taken[k][0] && r.y === taken[k][1]) expect(r.free, `${mapId}: the crowd missed the raw tile`).toBe(false);
      });
      builders.forEach((i, k) => {
        const [bx, by] = tileOf(sim, i);
        expect([bx, by], `${mapId}: builder ${i} took the crowded tile`).not.toEqual(taken[k]);
        for (let j = 0; j < sim.entityCount; j++) {
          if (j === i || sim.state.alive[j] !== 1) continue;
          const [jx, jy] = tileOf(sim, j);
          expect(jx === bx && jy === by, `${mapId}: builder ${i} shares (${bx},${by}) with body ${j}`).toBe(false);
        }
      });
    });
    it(`${mapId}: KDF with works=0, and Sarim (no works, even asked for), start`, () => {
      expect(boot(mapId, 'kdf', 'works=0').works).toBe(false);
      expect(boot(mapId, 'sarim', '').works).toBe(false);
      expect(boot(mapId, 'sarim', 'works').works).toBe(false);
    });
  }

  it('both branches are exercised: some maps keep the raw tile, and Bir Tarsha has to search', () => {
    const kept = ids.filter((id) => boot(id, 'kdf', '').raw.every((r) => r.clear && r.free));
    expect(kept.length).toBeGreaterThan(0); // else the keep pin above is vacuous on every map
    expect(kept).not.toContain('bir_tarsha');
  });
});

describe('Bir Tarsha: the raw builder tile is a wall, and the builder stands on the nearest open one', () => {
  it('the raw tile (27,36) is blocked, and the builder stands on (25,34)', () => {
    const { sim, builders, raw } = boot('bir_tarsha' as MapId, 'kdf', '');
    expect(raw).toEqual([{ x: 27, y: 36, clear: false, free: true }]);
    expect(builders.length).toBe(1);
    // Literal, read once from the map: ring 1 round (27,36) is all building (`#`), and (25,34) is the first open tile
    // of ring 2 in the spiral's scan order (row 34 reads `.rr.rrrrr` from x 22).
    expect(tileOf(sim, builders[0])).toEqual([25, 34]);
  });
});
