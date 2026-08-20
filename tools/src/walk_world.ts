/**
 * Build the same world the app builds, headless, for the walk tools.
 *
 * Why this is shared rather than copied. A walk tool is only worth trusting if its
 * world matches the one the game loads. The first version of walk_carryover.ts skipped
 * cover and structures, so `beit_sahwan_3_clearance` -- which garrisons a militia cell
 * in a house -- died on start with "no building at (28,12)", and the house is right
 * there in the map rows. A tool that reports a mission is broken when the tool is what
 * is broken is worse than no tool, and two copies of this setup means two chances to
 * differ from the app in a way that reads as a content bug.
 *
 * Mirrors packages/app/src/main.ts: cover, structure types, structures, unit types,
 * then the runtime. Read-only.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseMap, structures as structureCatalogue } from '../../packages/data/src/index';
import { MissionRuntime, type LedgerData } from '../../packages/sim/src/mission';
import { Sim } from '../../packages/sim/src/sim';
import type { TunnelRouteJson } from '../../packages/sim/src/tunnels';

export const ROOT = join(import.meta.dirname, '..', '..');
export const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** Every unit in data/units, keyed by id. */
export function loadUnits(): Record<string, unknown> {
  const units: Record<string, unknown> = {};
  const collect = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) collect(join(dir, e.name));
      else if (e.name.endsWith('.json')) {
        const u = read(join(dir, e.name));
        if (u.id) units[u.id] = u;
      }
    }
  };
  collect(join(ROOT, 'data/units'));
  return units;
}

export interface PlacementLike {
  unit?: string;
  tag?: string;
  at?: readonly number[];
  stance?: { kind?: string };
}

export interface MissionLike {
  id: string;
  map: { file: string };
  enemy?: { garrison?: readonly PlacementLike[] };
  objectives?: readonly { id: string; type: string; target?: string }[];
  ledger?: { requires?: readonly string[]; produces?: readonly string[] };
}

export interface World {
  sim: Sim;
  runtime: MissionRuntime;
  mission: MissionLike;
  /** Unit id by type index, for printing. */
  nameOf: Map<number, string>;
  /** Registered routes, positional: entry r is the sim's route index r. */
  tunnels: readonly TunnelRouteJson[];
}

/** Load a mission and start its runtime, with the map's cover and buildings in place. */
export function makeWorld(
  missionId: string,
  opts: { ledger?: LedgerData; seed?: number; units?: Record<string, unknown> } = {}
): World {
  const units = opts.units ?? loadUnits();
  const mission = read(join(ROOT, `data/missions/${missionId}.json`)) as MissionLike;
  const map = parseMap(read(join(ROOT, `data/maps/${mission.map.file}.json`)));
  const sim = new Sim({ seed: opts.seed ?? 11, width: map.width, height: map.height, capacity: 256 });

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = y * map.width + x;
      const c = map.cover[t];
      if (c !== undefined && c !== 0) sim.setCover(x, y, c);
    }
  }

  // Buildings are entities, not terrain -- and `garrison` stances resolve through
  // sim.structureAt, so a world without them cannot start half the missions.
  const structTypeIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structTypeIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const t = structTypeIdx.get(b.type);
    if (t === undefined) throw new Error(`map references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }

  // Tunnels: one array, one loop, and the same array goes into the mission
  // context — ctx.tunnels is positional, so this mirrors main.ts exactly
  // (an equal-count permutation would silently bury units in the wrong route).
  const tunnels: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (let i = 0; i < tunnels.length; i++) {
    const got = sim.addTunnel(tunnels[i]);
    if (got !== i) throw new Error(`tunnel "${tunnels[i].id}" registered as route ${got}, expected ${i}`);
  }

  const typeIds = new Map<string, number>();
  for (const [id, u] of Object.entries(units)) typeIds.set(id, sim.addUnitType(u as never));
  const nameOf = new Map<number, string>([...typeIds].map(([id, t]) => [t, id]));

  const runtime = new MissionRuntime(sim, mission as never, {
    typeIdOf: (u: string) => {
      const t = typeIds.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: map.markers as never,
    zones: map.zones as never,
    tunnels,
    unitInfo: (u: string) => (units[u] ?? null) as never,
    ...(opts.ledger !== undefined ? { ledger: opts.ledger } : {}),
  });
  runtime.start();
  return { sim, runtime, mission, nameOf, tunnels };
}

/** Live entity ids on a side. */
export function idsOf(sim: Sim, side: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.state.alive.length; i++) {
    if (sim.state.alive[i] === 1 && sim.state.side[i] === side) out.push(i);
  }
  return out;
}
