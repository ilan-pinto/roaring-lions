// What the narrow saddle costs, measured. Run: npx tsx tools/src/backtest/saddle-price.ts
//
// Tel Marum III offers two ways through the wall. The wide pass lies under two
// Kornet pockets; the narrow corridor is +10 tiles, infantry-only since the
// boulder field landed, and covered by nothing that can reach it except the
// Grad at `battery_position` — which needs no sight of its own (`rocket` is in
// `INDIRECT_MASK`) but does need its SIDE to have identified a target.
//
// The question this answers is not "can the flank be walked" (the doctrine test
// settles that on terrain) but "what does walking it cost". Three controls make
// the answer mean something:
//
//  - The armour's orders are BYTE-IDENTICAL in both arms. Only the foot's route
//    changes, so anything that moves between the rows is the route's doing and
//    not a better plan. Without this the comparison also passes when one arm
//    simply plays better.
//  - `perfect eyes` is the CEILING, not a proposal: it re-asserts Sarim contact
//    on every flanker on every tick it stands in the corridor. No observer can
//    beat it, so if a number does not move under perfect eyes, no spotter will
//    move it either.
//  - Ten seeds. A one-seed difference of a single tank is noise, and the first
//    run of this comparison produced exactly that.
//
// The observer sweep mutates the `tm_spotter_narrow` garrison entry IN PLACE at
// the same array index. Spawn order, entity ids and therefore every per-entity
// RNG stream are untouched — removing the entry instead would reshuffle every
// later unit's stream and quietly invalidate the comparison.
import {
  Sim, fx, TICKS_PER_SECOND, MissionRuntime,
  type MissionJson, type TunnelRouteJson,
} from '@lions/sim';
import { units, maps, missions, structures as structureCatalogue, parseMap, applyTerrain } from '@lions/data';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });
const MISSION = 'tel_marum_3_clearance';
const SEEDS = [424242, 7, 1009, 31337, 65521, 99991, 123456, 2024, 555, 8888];
/** The corridor and its scree apron — the ground a flanker is exposed on. */
const inCorridor = (x: number, y: number) => x >= 9 && x <= 12 && y >= 12 && y <= 18;

type Garrison = { unit: string; count: number; at: [number, number]; facing_deg?: number; tag?: string };

function walk(seed: number, foot: 'pass' | 'corridor', perfectEyes: boolean) {
  const mission = missions[MISSION] as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id, points: t.points, dig_tiles_per_s: t.digTilesPerS, pre_dug: t.preDug,
  }));
  for (const r of tunnelRoutes) sim.addTunnel(r);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers, zones: map.zones, tunnels: tunnelRoutes, ledger: {},
    unitInfo: (u) => {
      const d = (units as Record<string, { faction: string; cost: { logistics: number; build_time_s?: number } } | undefined>)[u];
      if (!d || d.faction !== 'kdf') return null;
      return { logistics: d.cost.logistics, buildTimeS: d.cost.build_time_s ?? 20 };
    },
  });
  rt.start();
  const ids = (t: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === t) out.push(i);
    return out;
  };
  const tanks = ids('mbt_lavi'), namer = ids('ifv_namer'), carriers = ids('apc_eitan');
  const legs = [...ids('inf_squad'), ...ids('at_team'), ...ids('mortar_team')];
  const battery = (() => {
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === 'rocket_battery') return i;
    return -1;
  })();

  const timed: [number, () => void][] = [];
  const at = (t: number, fn: () => void) => timed.push([Math.round(t * TICKS_PER_SECOND), fn]);
  // --- armour: identical in both arms ------------------------------------
  at(85, () => {
    sim.queueCommand({ kind: 'move', ids: carriers, ...M(23, 22) });
    sim.queueCommand({ kind: 'move', ids: tanks, ...M(25, 22) });
    sim.queueCommand({ kind: 'move', ids: namer, ...M(24, 23) });
  });
  at(130, () => {
    sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(28, 16) });
    sim.queueCommand({ kind: 'attackMove', ids: namer, ...M(20, 16) });
  });
  at(190, () => {
    sim.queueCommand({ kind: 'move', ids: tanks, ...M(24, 13) });
    sim.queueCommand({ kind: 'move', ids: carriers, ...M(24, 14) });
  });
  at(250, () => {
    sim.queueCommand({ kind: 'move', ids: carriers, ...M(23, 12) });
    sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(25, 6) });
  });
  // --- the foot: the one variable ----------------------------------------
  if (foot === 'pass') {
    at(3, () => sim.queueCommand({ kind: 'move', ids: legs, ...M(24, 22) }));
    at(190, () => sim.queueCommand({ kind: 'move', ids: legs, ...M(24, 15) }));
    at(250, () => sim.queueCommand({ kind: 'attackMove', ids: legs, ...M(25, 6) }));
  } else {
    at(3, () => sim.queueCommand({ kind: 'move', ids: legs, ...M(10, 12) }));
    at(250, () => sim.queueCommand({ kind: 'attackMove', ids: legs, ...M(25, 6) }));
  }

  let rockets = 0;
  const lost: string[] = [];
  const maxTicks = 20 * 60 * TICKS_PER_SECOND;
  let t = 0;
  for (; t < maxTicks; t++) {
    for (const [when, fn] of timed) if (when === t) fn();
    if (perfectEyes) {
      for (const id of legs) {
        if (sim.state.alive[id] !== 1) continue;
        if (inCorridor((sim.state.posX[id] ?? 0) >> 16, (sim.state.posY[id] ?? 0) >> 16)) sim.identifyTo(1, id);
      }
    }
    const evs = sim.tick();
    for (const e of evs) {
      if (e.kind === 'fire' && e.shooter === battery) rockets++;
      if (e.kind === 'destroyed' && sim.state.side[e.entity] === 0) lost.push(sim.unitTypes[sim.state.typeIdx[e.entity]].id);
    }
    rt.step(evs);
    if (rt.result !== 'ongoing') break;
  }
  const footHp = legs.reduce((a, id) => a + (sim.state.alive[id] === 1 ? (sim.state.hp[id] ?? 0) / 65536 : 0), 0);
  return { result: rt.result, mins: t / TICKS_PER_SECOND / 60, lost, rockets, footHp };
}

function sweep(foot: 'pass' | 'corridor', perfectEyes: boolean, label: string) {
  const byType = new Map<string, number>();
  let wins = 0, losses = 0, rockets = 0, hp = 0, mins = 0;
  for (const seed of SEEDS) {
    const r = walk(seed, foot, perfectEyes);
    if (r.result === 'victory') wins++;
    losses += r.lost.length;
    for (const k of r.lost) byType.set(k, (byType.get(k) ?? 0) + 1);
    rockets += r.rockets; hp += r.footHp; mins += r.mins;
  }
  const n = SEEDS.length;
  console.log(
    `${label.padEnd(40)} wins ${wins}/${n}  losses/run ${(losses / n).toFixed(2)}  ` +
    `foot HP ${(hp / n).toFixed(0)}/1930  rockets ${(rockets / n).toFixed(1)}  ${(mins / n).toFixed(2)} min`
  );
  console.log(`    who died across ${n} seeds: ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join(', ') || 'nobody'}`);
}

console.log('=== the route, isolated (armour orders identical in every row) ===');
sweep('pass', false, 'foot through the pass');
sweep('corridor', false, 'foot up the narrow corridor');
console.log();
console.log('=== the ceiling: unkillable, permanent eyes on the corridor ===');
sweep('pass', true, 'foot through the pass, +perfect eyes');
sweep('corridor', true, 'foot up the corridor, +perfect eyes');
console.log();
console.log('=== and what a REAL observer does instead (corridor arm only) ===');
const garrison = (missions[MISSION] as unknown as { enemy: { garrison: Garrison[] } }).enemy.garrison;
const idx = garrison.findIndex((g) => g.tag === 'tm_spotter_narrow');
if (idx < 0) throw new Error('tel_marum_3_clearance has no tm_spotter_narrow');
const shipped = garrison[idx];
const variants: [string, Garrison][] = [
  ['shipped: sarim_rifles [12,4], sees 2/12', shipped],
  ['moved:   sarim_rifles [11,8], sees 10/12', { ...shipped, at: [11.5, 8.5] }],
  ['manpad:  manpad_team [8,3], 6/12 @ 9.2', { ...shipped, unit: 'manpad_team', at: [8.5, 3.5] }],
  ['manpad:  manpad_team [10,6], 12/12 @ 6.0', { ...shipped, unit: 'manpad_team', at: [10.5, 6.5] }],
];
for (const [label, g] of variants) {
  garrison[idx] = g;
  sweep('corridor', false, label);
}
garrison[idx] = shipped;
