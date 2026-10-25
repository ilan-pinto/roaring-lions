// What the defile costs, measured. Run: pnpm --filter @lions/tools exec tsx src/backtest/saddle-price.ts [--seeds=30]
//
// PORTED to the Tel Marum III massif (GH-382, GH-802). Until this port the file carried a STALE
// banner: it was written against the old copy of the base map (corridor at x 9-12, y 12-18, orders
// in that map's coordinates) and could not run on `tel_marum_3`. The numbers it once printed (3.80 pass
// / 3.10 corridor, `fc0fc13e`, 30 Sep) belong to that geometry and are NOT comparable to this
// file's output: different map, different route lengths (54 / 64 tiles, not 38 / 48), a different
// roster and, since GH-707, men who fall wounded rather than dead.
//
// GH-802 (25 Oct): the plain-`move` defile arm below is a TRAP, not the route's price. Infantry
// fire only from a halt (`haltsToFire`), so a squad on a plain move never fires back; it walks into
// the mouth and is shot. The `attack-move` arm is what a player who fights his way up pays. Since
// GH-802 the defile also holds the battery's relay (`tm_relay`, the carrying secondary) at its first
// bend, and the rifle wave reaches the mouth at 40 s; the `relay` column reads that secondary.
//
// Tel Marum III offers two ways to the battery. The switchback road ends in the exit column at the
// pass under two Kornet pockets; the defile is a 72-tile foot-only bed of boulders on the west side
// (`saddle_narrow` [10,14] is its north end), ten tiles longer, out of both Kornets' reach, and
// covered by nothing but the Grad at `battery_position`, which needs no sight of its own (`rocket`
// is in `INDIRECT_MASK`) but does need its SIDE to have identified a target.
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
import { SWEEP_SEEDS } from './passive-sweep';
import { units, maps, missions, structures as structureCatalogue, parseMap, applyTerrain, roadMaskOf } from '@lions/data';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });
const MISSION = 'tel_marum_3_clearance';
const SEEDS_10 = [424242, 7, 1009, 31337, 65521, 99991, 123456, 2024, 555, 8888];
/** `--seeds=30` runs `main`'s 30-seed set (`passive-sweep.ts`) instead of the probe's own ten. */
const SEEDS = process.argv.includes('--seeds=30') ? SWEEP_SEEDS : SEEDS_10;
/** The defile is every `b` (boulder) tile: the ground a flanker is exposed on. Read off the map. */
const DEFILE = new Set<number>();
{
  const raw = maps[(missions[MISSION] as unknown as MissionJson).map.file as keyof typeof maps] as unknown as { width: number; rows: string[] };
  raw.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'b') DEFILE.add(y * raw.width + x); }));
  if (DEFILE.size !== 72) throw new Error(`expected the 72-tile defile, read ${DEFILE.size} boulder tiles`);
}
const inDefile = (x: number, y: number, w: number) => DEFILE.has(y * w + x);
/** `saddle_narrow`, the defile's north end, and `battery_position`. */
const NARROW = M(10, 14);
const BATTERY = M(25, 6);

type Killed = { victim: string; by: string; t: number };

function walk(seed: number, foot: 'pass' | 'defile', perfectEyes: boolean, footKind: 'move' | 'attackMove' = 'move') {
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
    markers: map.markers, zones: map.zones, roadMask: roadMaskOf(map), tunnels: tunnelRoutes, ledger: {},
    unitInfo: (u) => {
      const d = (units as Record<string, { faction: string; cost: { logistics: number; build_time_s?: number; population?: number } } | undefined>)[u];
      if (!d || d.faction !== 'kdf') return null;
      return { logistics: d.cost.logistics, buildTimeS: d.cost.build_time_s ?? 20, population: d.cost.population ?? 1 };
    },
  });
  rt.start();
  const nameOf = (i: number) => sim.unitTypes[sim.state.typeIdx[i]].id;
  const ids = (t: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && nameOf(i) === t) out.push(i);
    return out;
  };
  const tanks = ids('mbt_lavi'), namer = ids('ifv_namer'), carriers = ids('apc_eitan'), mortar = ids('mortar_team');
  // The flankers: the two arms differ in where THESE walk, and in nothing else.
  const legs = [...ids('inf_squad'), ...ids('at_team')];
  const battery = (() => {
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 1 && nameOf(i) === 'rocket_battery') return i;
    return -1;
  })();

  const timed: [number, () => void][] = [];
  const at = (t: number, fn: () => void) => timed.push([Math.round(t * TICKS_PER_SECOND), fn]);
  // --- armour and mortar: copied from playtest.ts's Tel Marum III plan, identical in both arms ---
  // The column stages in the second leg behind the rib; two Lavis go up the exit column alone; one
  // Eitan fetches the families (the evacuate_before primary is what ends a plan that forgets them).
  at(2, () => {
    sim.queueCommand({ kind: 'move', ids: [...tanks, ...namer, ...carriers], ...M(28, 19) });
    sim.queueCommand({ kind: 'move', ids: mortar, ...M(26, 19) });
  });
  at(40, () => sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(33, 16) }));
  at(62, () => sim.queueCommand({ kind: 'move', ids: tanks, ...M(33, 11) }));
  at(80, () => sim.queueCommand({ kind: 'move', ids: carriers, ...M(33, 14) }));
  at(100, () => sim.queueCommand({ kind: 'move', ids: carriers, ...M(28, 6) }));
  at(115, () => sim.queueCommand({ kind: 'move', ids: carriers, ...M(29, 36) }));
  // --- the foot: the one variable ----------------------------------------
  let defileSent = false;
  if (foot === 'pass') {
    // exactly what playtest.ts gives its foot
    at(2, () => sim.queueCommand({ kind: 'move', ids: legs, ...M(27, 19) }));
    at(80, () => sim.queueCommand({ kind: 'move', ids: legs, ...M(33, 17) }));
    at(100, () => sim.queueCommand({ kind: 'move', ids: legs, ...M(33, 11) }));
  } else {
    // up the defile to its north end, then straight on to the battery (sent on ARRIVAL, below, so the
    // arm does not wait in the open at the mouth)
    at(2, () => sim.queueCommand({ kind: footKind, ids: legs, ...NARROW }));
  }

  let rockets = 0, woundedDown = 0, manKilled = 0;
  const lost: Killed[] = [];
  const footIdsStart = new Set(legs);
  let firstFootDeath = -1;
  const footHp0 = legs.reduce((a, id) => a + (sim.state.hp[id] ?? 0) / 65536, 0);
  const maxTicks = 20 * 60 * TICKS_PER_SECOND;
  let t = 0;
  for (; t < maxTicks; t++) {
    for (const [when, fn] of timed) if (when === t) fn();
    if (foot === 'defile' && !defileSent) {
      const live = legs.filter((id) => sim.state.alive[id] === 1);
      const arrived = live.length > 0 && live.every((id) => {
        const dx = (sim.state.posX[id] ?? 0) / 65536 - 10, dy = (sim.state.posY[id] ?? 0) / 65536 - 14;
        return dx * dx + dy * dy <= 9;
      });
      if (arrived || t >= 150 * TICKS_PER_SECOND) {
        defileSent = true;
        sim.queueCommand({ kind: 'attackMove', ids: live, ...BATTERY });
      }
    }
    if (perfectEyes) {
      for (const id of legs) {
        if (sim.state.alive[id] !== 1) continue;
        if (inDefile((sim.state.posX[id] ?? 0) >> 16, (sim.state.posY[id] ?? 0) >> 16, map.width)) sim.identifyTo(1, id);
      }
    }
    const evs = sim.tick();
    for (const e of evs) {
      if (e.kind === 'fire' && e.shooter === battery) rockets++;
      if (e.kind === 'woundedDown' && e.by >= 0 && sim.state.side[e.by] === 1) woundedDown++;
      if (e.kind === 'manKilled' && sim.state.side[e.entity] === 0) manKilled++;
      if (e.kind === 'destroyed' && sim.state.side[e.entity] === 0) {
        const victim = nameOf(e.entity);
        if (victim.startsWith('wounded')) continue; // a shed man bleeding out is not a unit lost
        lost.push({ victim, by: e.by >= 0 ? nameOf(e.by) : 'none', t: e.tick / TICKS_PER_SECOND });
        if (footIdsStart.has(e.entity) && firstFootDeath < 0) firstFootDeath = e.tick / TICKS_PER_SECOND;
      }
    }
    rt.step(evs);
    if (rt.result !== 'ongoing') break;
  }
  const footHp = legs.reduce((a, id) => a + (sim.state.alive[id] === 1 ? (sim.state.hp[id] ?? 0) / 65536 : 0), 0);
  const relay = rt.objectiveList.find((o) => o.id === 'cut_the_relay')?.status === 'complete';
  return { result: rt.result, mins: t / TICKS_PER_SECOND / 60, lost, rockets, footHp, footHp0, firstFootDeath, woundedDown, manKilled, relay };
}

function sweep(foot: 'pass' | 'defile', perfectEyes: boolean, label: string, footKind: 'move' | 'attackMove' = 'move') {
  const byType = new Map<string, number>();
  const byKiller = new Map<string, number>();
  let relays = 0, wins = 0, losses = 0, footLost = 0, rockets = 0, hp = 0, hp0 = 0, mins = 0, wd = 0, mk = 0, fd = 0, fdN = 0;
  const FOOT = new Set(['inf_squad', 'at_team']);
  const results: string[] = [];
  for (const seed of SEEDS) {
    const r = walk(seed, foot, perfectEyes, footKind);
    if (r.relay) relays++;
    results.push(r.result);
    if (r.result === 'victory') wins++;
    losses += r.lost.length;
    for (const k of r.lost) {
      byType.set(k.victim, (byType.get(k.victim) ?? 0) + 1);
      byKiller.set(`${k.by}>${k.victim}`, (byKiller.get(`${k.by}>${k.victim}`) ?? 0) + 1);
      if (FOOT.has(k.victim)) footLost++;
    }
    rockets += r.rockets; hp += r.footHp; hp0 += r.footHp0; mins += r.mins; wd += r.woundedDown; mk += r.manKilled;
    if (r.firstFootDeath >= 0) { fd += r.firstFootDeath; fdN++; }
  }
  const n = SEEDS.length;
  console.log(
    `${label.padEnd(36)} wins ${wins}/${n}  losses/run ${(losses / n).toFixed(2)} (foot ${(footLost / n).toFixed(2)})  ` +
    `foot HP ${(hp / n).toFixed(0)}/${(hp0 / n).toFixed(0)}  men down/run ${(wd / n).toFixed(1)}, killed outright ${(mk / n).toFixed(1)}  ` +
    `relay ${relays}/${n}  rockets ${(rockets / n).toFixed(1)}  first foot death ${fdN > 0 ? (fd / fdN).toFixed(0) + ' s (' + fdN + '/' + n + ' runs)' : 'none'}  ${(mins / n).toFixed(2)} min`
  );
  console.log(`    who died across ${n} seeds: ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join(', ') || 'nobody'}`);
  console.log(`    killer>victim: ${[...byKiller.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join(', ') || 'nobody'}`);
  console.log(`    results: ${results.join(' ')}`);
}

console.log('=== the route, isolated (armour and mortar orders identical in every row) ===');
sweep('pass', false, 'foot through the pass');
sweep('defile', false, 'foot up the defile, plain move (trap)');
sweep('defile', false, 'foot up the defile, attack-move', 'attackMove');
console.log();
console.log('=== the ceiling: permanent Sarim eyes on every flanker standing in the defile ===');
sweep('pass', true, 'foot through the pass, +perfect eyes');
sweep('defile', true, 'foot up the defile, +perfect eyes');
// The old observer sweep (four posts on the old corridor) is not ported: its coordinates and sight
// counts were for the old ground. The shipped post is `tm_spotter_narrow` [10.5, 11.5].
