// Free play boots on every map with field works on (their default since 18 Nov 2026) and off.
//
// v0.134.1 shipped `/free-play/bir_tarsha` dead on arrival: "mission sandbox_works: demo_squad body 1 of 1 spawns at
// (27,36), which is blocked". The works builder stood on its raw offset from the friendly anchor, and the
// `MissionRuntime` that raises it refuses a blocked tile instead of searching; the sandbox force beside it already
// went through the nearest-open-tile placer. Bir Tarsha, Bir Tarsha 2 and Umm Zeitoun all failed. Nothing booted
// every map with the works on, so this does: every shipped map, both sides, flags read by the app's own `bootFlags`,
// the force placed by the app's own spawners, and the works runtime started over the app's own builders.
import { describe, expect, it } from 'vitest';
import { DOMAIN_VEHICLE, MissionRuntime, Sim } from '@lions/sim';
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

/** One Free play boot, in `main.ts`'s order: flags, terrain, buildings, the force, then (works on) the works runtime. */
function boot(mapId: MapId, side: Side, query: string): { sim: Sim; works: boolean; builders: number[] } {
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
  const before = sim.entityCount;
  if (flags.works) {
    new MissionRuntime(sim, sandboxWorksMission(sim.structureTypes, sandboxWorksBuilders(sim, typeOf, anchors)), {
      typeIdOf: (id) => typeOf.get(id) ?? 0,
      markers: parsed.markers,
      zones: parsed.zones,
    }).start();
  }
  const builders: number[] = [];
  for (let i = before; i < sim.entityCount; i++) builders.push(i);
  return { sim, works: flags.works, builders };
}

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
    it(`${mapId}: KDF with works=0, and Sarim (no works, even asked for), start`, () => {
      expect(boot(mapId, 'kdf', 'works=0').works).toBe(false);
      expect(boot(mapId, 'sarim', '').works).toBe(false);
      expect(boot(mapId, 'sarim', 'works').works).toBe(false);
    });
  }
});
