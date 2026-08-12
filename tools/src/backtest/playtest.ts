// Headless mission playtests: each Beit Sahwan mission must be winnable by a
// sensible scripted plan inside its time budget. Run: tsx src/backtest/playtest.ts

import { Sim, fx, TICKS_PER_SECOND, MissionRuntime, type MissionJson, type LedgerData } from '@lions/sim';
import { units, maps, missions, structures as structureCatalogue, parseMap } from '@lions/data';

type Plan = (sim: Sim, rt: MissionRuntime, ids: (t: string) => number[], at: (t: number, fn: () => void) => void) => void;

function run(id: keyof typeof missions, plan: Plan, ledger: LedgerData = {}): LedgerData {
  const mission = missions[id] as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 128 });
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = y * map.width + x;
      if (map.cover[t]) sim.setCover(x, y, map.cover[t]);
    }
  // Buildings are entities, exactly as the app raises them.
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    ledger,
    unitInfo: (u) => {
      const d = (units as Record<string, { faction: string; cost: { logistics: number; build_time_s?: number } } | undefined>)[u];
      return d && d.faction === 'kdf' ? { logistics: d.cost.logistics, buildTimeS: d.cost.build_time_s ?? 20 } : null;
    },
  });
  rt.start();
  const ids = (t: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === t) out.push(i);
    return out;
  };
  const timed: [number, () => void][] = [];
  plan(sim, rt, ids, (t, fn) => timed.push([t * TICKS_PER_SECOND, fn]));
  let produced: LedgerData = {};
  const maxTicks = 20 * 60 * TICKS_PER_SECOND;
  let t = 0;
  for (; t < maxTicks; t++) {
    for (const [when, fn] of timed) if (when === t) fn();
    const evs = sim.tick();
    for (const me of rt.step(evs)) if (me.kind === 'missionEnd') produced = me.ledger;
    if (rt.result !== 'ongoing') break;
  }
  const mins = (t / TICKS_PER_SECOND / 60).toFixed(1);
  console.log(
    `${id}: ${rt.result.toUpperCase()} in ${mins} min, ROE ${rt.roeScore}, ` +
      `objectives ${rt.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}, ` +
      `roster out ${(produced['roster.surviving_units'] ?? []).length}`
  );
  if (rt.result !== 'victory') process.exitCode = 1;
  return produced;
}

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

// 0 — First Light: give up the perimeter on purpose, walk the north village
// out with the jeep alone, and hold the compound with everything else.
//
// This deviates from the obvious "attackMove everyone to the compound, walk
// both villages" sketch in two ways the playtest itself forced:
//
// - `move`, not `attackMove`, for the fallback. attackMove halts a unit the
//   moment anything is in effective range, so under fire from the moment
//   contact starts, it never resumes toward the compound -- the APC took
//   root at the abandoned perimeter and fought there for the entire mission
//   (never reaching cover), and the sniper team got dragged out of the
//   strongpoint the same way. `move` still returns fire on the way in but
//   does not stop for it, so the whole line reaches the walled compound.
// - The jeep sweeps the north village only (two waypoints, no escort). The
//   south village's civilians are guarded by an ambushed RPG team sitting
//   almost on top of them (`south_infiltrators`, tunnel_south) -- walking a
//   light escort in there is a needless second firefight. The north pair
//   alone yields enough evacuees for the (tuned) objective count, and a
//   dedicated infantry escort tried alongside the jeep still died to the
//   wave-1 militia drifting off the now-empty perimeter with nothing else to
//   shoot at -- the jeep's speed is what gets it in and out before that
//   drift arrives, not numbers.
const led0 = run('beit_sahwan_breach', (sim, _rt, ids, at) => {
  const shepherds = ids('jeep_shoded');
  const holders = [...ids('at_team'), ...ids('sniper_team'), ...ids('apc_eitan'), ...ids('inf_squad')];
  // The perimeter is indefensible and not an objective: fall back at once.
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: holders, ...M(34, 24) });
    sim.queueCommand({ kind: 'move', ids: shepherds, ...M(24, 13) });
  });
  // Trigger both north-village family groups, then run back to the compound.
  at(20, () => sim.queueCommand({ kind: 'move', ids: shepherds, ...M(28, 17) }));
  at(45, () => sim.queueCommand({ kind: 'move', ids: shepherds, ...M(34, 24) }));
});

// I — Recon: scouts screen forward on the berm and observe; the drone tours
// a standoff line and re-tours until the picture is built.
const led1 = run('beit_sahwan_1_recon', (sim, _rt, ids, at) => {
  const drone = ids('recon_drone');
  const screen = [
    ...ids('apc_eitan'),
    ...ids('mbt_lavi'),
    ...ids('ifv_namer'),
    ...ids('inf_squad'),
    ...ids('at_team'),
  ];
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(16, 22) });
    sim.queueCommand({ kind: 'move', ids: drone, ...M(21, 8) });
  });
  at(60, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(21, 30) }));
  at(150, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(26, 40) }));
  // Recon in force: the screen advances and fights for the rest of the
  // picture — firing multiplies signature, contacts identify fast.
  at(240, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(22, 24) }));
  at(300, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(30, 18) }));
  at(480, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(27, 20) }));
}, led0);

// II — Foothold: dig in on the assembly area, buy a squad when affordable.
const led2 = run(
  'beit_sahwan_2_foothold',
  (sim, rt, _ids, at) => {
    at(1, () => {
      const all: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0) all.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: all, ...M(8, 23) });
    });
    at(120, () => void rt.requestBuild('inf_squad'));
  },
  led1
);

// III — Clearance: the proven combined-arms plan; mortar stays home.
run(
  'beit_sahwan_3_clearance',
  (sim, _rt, ids, at) => {
    at(1, () => {
      sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(32, 18) });
      const armor = [...ids('mbt_lavi'), ...ids('ifv_namer'), ...ids('apc_eitan')];
      sim.queueCommand({ kind: 'attackMove', ids: armor, ...M(30, 13) });
      sim.queueCommand({ kind: 'attackMove', ids: [...ids('inf_squad'), ...ids('at_team')], ...M(28, 26) });
      // Engineers follow the infantry: held houses come down by charge, which
      // costs the house and nothing else — shelling them scatters rounds into
      // the clinic block next door.
      sim.queueCommand({ kind: 'attackMove', ids: ids('demo_squad'), ...M(27, 25) });
    });
    at(140, () => {
      const alive: number[] = [];
      for (let i = 0; i < sim.entityCount; i++)
        if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id !== 'mortar_team')
          alive.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: alive, ...M(38, 22) });
    });
  },
  led2
);
