// Plan ladder for Beit Sahwan -- First Light (`beit_sahwan_breach`): passive / naive / sensible /
// optimal over many seeds.
//
//   npx tsx tools/src/backtest/fl_ladder.ts [seeds=30] [tier ...]
//   FL_V=1  prints one line per run (outcome and every objective's status)
//
// The world is built exactly as `playtest.ts`'s `run()` builds it (same @lions/data imports, same
// unit registration order, same structure and tunnel loops), so seed 424242 reproduces the pinned
// gate's own lines. Only the seed varies.
//
//   passive  - no orders. The design says this must LOSE (playtest.ts, "Control: the premise is
//              catastrophe").
//   naive    - the jeep drives to the nearest village at t=0 and is never ordered again.
//   sensible - the jeep runs the west village, then the south-west one, then comes home; the APC
//              stays in the yard.
//   optimal  - `playtest.ts`'s own winning plan: the same object, imported from plans/beit_sahwan.ts
//              (jeep and APC out at 5 s, home at 45 s).
//
// `civilians in` is a histogram of how many civilians reached the compound (0/1/2/3+); the
// objective counts civilians, not groups.
//
// Measured 2026-10-11, seeds 424242 + 1..99 (win rate, civilians in 0/1/2/3+):
//   before (NW 12.5, SW 11.5, SE 35.5)  passive 10/100 [62/28/10/0]  naive 99  sensible 100  optimal 100
//   after  (NW 10.5, SW  9.5, SE 37.5)  passive  0/100 [100/0/0/0]   naive 99  sensible 100  optimal 100
// Every winning run reads 5.00 min: the relief hold is a fixed 300 s clock.
import { Sim, fx, TICKS_PER_SECOND, MissionRuntime, type MissionJson, type TunnelRouteJson } from '@lions/sim';
import { units, maps, missions, structures as structureCatalogue, parseMap, applyTerrain, roadMaskOf } from '@lions/data';
import { firstLightPlan } from './plans/beit_sahwan';

type Tier = 'passive' | 'naive' | 'sensible' | 'optimal';
const ID = 'beit_sahwan_breach';
const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

export interface FlRun {
  result: string;
  mins: number;
  objectives: string;
  evacuated: number;
}

export function runFirstLight(tier: Tier, seed: number, mission: MissionJson = missions[ID] as unknown as MissionJson): FlRun {
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
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (const r of tunnelRoutes) sim.addTunnel(r);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    roadMask: roadMaskOf(map),
    tunnels: tunnelRoutes,
    ledger: {},
    unitInfo: () => null,
  });
  rt.start();
  const ids = (t: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === t) out.push(i);
    return out;
  };
  const timed: [number, () => void][] = [];
  const at = (s: number, fn: () => void) => timed.push([s * TICKS_PER_SECOND, fn]);
  const mk = (n: string) => map.markers[n] as readonly [number, number];
  const jeep = ids('jeep_shoded');
  const move = (who: number[], p: readonly [number, number]) =>
    sim.queueCommand({ kind: 'move', ids: who.filter((i) => sim.state.alive[i] === 1), ...M(p[0], p[1]) });
  if (tier === 'naive') at(0, () => move(jeep, mk('families_nw')));
  if (tier === 'sensible') {
    at(0, () => move(jeep, mk('families_nw')));
    at(30, () => move(jeep, mk('families_sw')));
    at(55, () => move(jeep, mk('civ_refuge')));
  }
  // The very object `pnpm playtest` runs (plans/beit_sahwan.ts), not a copy of it.
  if (tier === 'optimal') firstLightPlan(sim, rt, ids, at);
  const maxTicks = 20 * 60 * TICKS_PER_SECOND;
  let t = 0;
  let evacuated = 0;
  for (; t < maxTicks; t++) {
    for (const [when, fn] of timed) if (when === t) fn();
    for (const me of rt.step(sim.tick())) if (me.kind === 'evacuated') evacuated++;
    if (rt.result !== 'ongoing') break;
  }
  return {
    result: rt.result,
    mins: t / TICKS_PER_SECOND / 60,
    objectives: rt.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' '),
    evacuated,
  };
}

const isMain = process.argv[1]?.endsWith('fl_ladder.ts');
if (isMain) {
  const seedsN = Number(process.argv[2] ?? 30);
  const tiers = (process.argv.slice(3).length ? process.argv.slice(3) : ['passive', 'naive', 'sensible', 'optimal']) as Tier[];
  const seeds = [424242, ...Array.from({ length: seedsN - 1 }, (_, k) => k + 1)];
  console.log(`First Light ladder; seeds 424242 + 1..${seedsN - 1}`);
  for (const tier of tiers) {
    const rs = seeds.map((s) => ({ seed: s, ...runFirstLight(tier, s) }));
    if (process.env.FL_V) for (const r of rs) console.log(`  ${tier} seed ${r.seed}: ${r.result} ${r.mins.toFixed(1)} min ${r.objectives}`);
    const won = rs.filter((r) => r.result === 'victory');
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    console.log(
      `${tier.padEnd(8)} win ${String(won.length).padStart(2)}/${rs.length} (${((100 * won.length) / rs.length).toFixed(0).padStart(3)}%)  ` +
        `min(all) ${mean(rs.map((r) => r.mins)).toFixed(2)}  min(won) ${mean(won.map((r) => r.mins)).toFixed(2)}  ` +
        `civilians in: ${[0, 1, 2, 3].map((n) => `${n === 3 ? '3+' : n}x${rs.filter((r) => (n === 3 ? r.evacuated >= 3 : r.evacuated === n)).length}`).join(' ')}` +
        (won.length > 0 && won.length <= rs.length / 2 ? `  won on: ${won.map((r) => r.seed).join(',')}` : '') +
        (won.length > rs.length / 2 && won.length < rs.length
          ? `  lost on: ${rs.filter((r) => r.result !== 'victory').map((r) => r.seed).join(',')}`
          : '')
    );
  }
}
