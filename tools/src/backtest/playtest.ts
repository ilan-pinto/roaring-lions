// Headless mission playtests: each Beit Sahwan mission must be winnable by a
// sensible scripted plan inside its time budget. Run: tsx src/backtest/playtest.ts

import { Sim, fx, TICKS_PER_SECOND, MissionRuntime, type MissionJson, type LedgerData, type TunnelRouteJson } from '@lions/sim';
import { units, maps, missions, structures as structureCatalogue, parseMap, applyTerrain } from '@lions/data';

type Plan = (sim: Sim, rt: MissionRuntime, ids: (t: string) => number[], at: (t: number, fn: () => void) => void) => void;

function run(
  id: keyof typeof missions,
  plan: Plan,
  ledger: LedgerData = {},
  expect: 'victory' | 'defeat' | 'ongoing' = 'victory',
  label: string = id
): LedgerData {
  const mission = missions[id] as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  // Matches the app. `spawn` never reuses a dead slot, so this is a budget for
  // everyone who ever appears, not for how many stand at once.
  const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
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
  // Tunnels: registered from ONE array in ONE loop, and that same array is what
  // the mission context receives. `ctx.tunnels` is positional -- entry r IS the
  // sim's route index -- mirroring main.ts exactly (an equal-count permutation
  // would silently bury units in the wrong route).
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (let i = 0; i < tunnelRoutes.length; i++) {
    const got = sim.addTunnel(tunnelRoutes[i]);
    if (got !== i) throw new Error(`tunnel "${tunnelRoutes[i].id}" registered as route ${got}, expected ${i}`);
  }
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    tunnels: tunnelRoutes,
    ledger,
    unitInfo: (u) => {
      const d = (units as Record<
        string,
        | {
            faction: string;
            unlock?: { roe_rating_min?: number; after_mission?: string };
            cost: { logistics: number; build_time_s?: number };
          }
        | undefined
      >)[u];
      if (!d || d.faction !== 'kdf') return null;
      return {
        logistics: d.cost.logistics,
        buildTimeS: d.cost.build_time_s ?? 20,
        unlock: d.unlock
          ? { roeMin: d.unlock.roe_rating_min, afterMission: d.unlock.after_mission }
          : undefined,
      };
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
    `${label}: ${rt.result.toUpperCase()} in ${mins} min, ROE ${rt.roeScore}, ` +
      `objectives ${rt.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}, ` +
      `roster out ${(produced['roster.surviving_units'] ?? []).length}`
  );
  if (rt.result !== expect) {
    console.error(`${label}: FAILED — expected ${expect.toUpperCase()}, got ${rt.result.toUpperCase()}`);
    process.exitCode = 1;
  }
  return produced;
}

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

// 0 — First Light: hold the compound, run the villages in with the jeep, and
// spend the corridor as it arrives.
//
// The compound is at the middle of the map with a gate on each face, and 104
// attackers converge on it from all eight edges over thirteen minutes. Three
// things this plan does deliberately:
//
// - the defenders stay where they are. They start spread across the yard with
//   firing positions covering each gate, and a wall they can shoot over, so
//   there is nothing to reposition toward -- and a unit under orders is a unit
//   that might walk into its own gateway and cork it.
// - the jeep does two runs, north village then south, and nothing escorts it.
//   Shepherding is a four-tile proximity brush rather than an escort: the
//   families walk themselves in once touched, so speed is the whole trick and
//   numbers only add casualties.
// - logistics is spent, not banked. 400 up front and 120/min means a purchase
//   roughly every two minutes, and an unspent purse at the end is the GDD's own
//   definition of income set too high.
//
// Control: the premise is catastrophe. A player who gives no orders at all must
// LOSE -- if the compound holds itself for thirteen minutes, the breach is not
// a breach. This pins the mission's premise the way the plan pins feasibility.
run('beit_sahwan_breach', () => {}, {}, 'defeat', 'beit_sahwan_breach (passive control)');

const led0 = run('beit_sahwan_breach', (sim, rt, ids, at) => {
  const shepherds = ids('jeep_shoded');
  // Both western villages, out and back through the west gate, before the
  // south-west and west spawns build up. Six families is the objective and the
  // two western pairs are six between them, so there is no reason to cross the
  // map for the eastern ones and every reason not to.
  const armour = ids('apc_eitan');
  at(5, () => {
    sim.queueCommand({ kind: 'move', ids: shepherds, ...M(13, 19) });
    sim.queueCommand({ kind: 'move', ids: armour, ...M(13, 28) });
  });
  at(45, () => {
    sim.queueCommand({ kind: 'move', ids: shepherds, ...M(20, 21) });
    sim.queueCommand({ kind: 'move', ids: armour, ...M(20, 26) });
  });
  // Spend it as it lands. Banking is the losing move here: an unspent purse is
  // a squad that was not on the wall when the wire came down, and the run that
  // bought on a six-purchase schedule died ninety seconds sooner than the one
  // that bought whenever it could afford to.
  for (let when = 20; when <= 700; when += 25) {
    at(when, () => {
      if (!rt.requestBuild('inf_squad')) rt.requestBuild('mortar_team');
    });
  }
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
const led3 = run(
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

// --- Naharin: Wadi Halam ------------------------------------------------------

// I — The Fords: push the screen into the tree line, clear both gallery
// ambushes for the picture, and hold the ford watch uncontested for 20s.
// The drone tours the bank/bund/hide side of the wadi so the picture comes
// from four *different* enemies rather than two ambushes seen twice.
// `take_ford` is a four-minute hold, contested by three waves out of the
// east (90s, 210s, 225s) -- so the screen has to actually stand on the
// ford watch and fight, not merely visit it for twenty seconds. Re-anchors
// on the same schedule as II and III, for the same reason: a wave that
// breaks and runs pulls a pursuing force past the zone edge and the hold
// clock does not resume until something brings them back.
const wh1 = run('wadi_halam_1_fords', (sim, rt, ids, at) => {
  const drone = ids('recon_drone');
  const screen = [...ids('apc_eitan'), ...ids('inf_squad'), ...ids('at_team')];
  const jeep = ids('jeep_shoded');
  at(0, () => {
    // North first: the near gallery ambush is 4 tiles off the axis, and
    // going in under attackMove springs and kills it instead of walking past.
    sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 15) });
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(9, 20) });
    sim.queueCommand({ kind: 'move', ids: drone, ...M(20, 17) });
  });
  at(45, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(20, 30) }));
  // South gallery next -- the second identified contact the picture needs
  // beyond the bank/bund pair the drone is already turning up.
  at(60, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 31) }));
  // Settle on the ford watch itself.
  at(110, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(10, 24) }));
  for (let when = 130; when <= 320; when += 45) {
    at(when, () => {
      const cur: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) cur.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(10, 24) });
    });
  }
  void rt;
});

// II — Grazing Ground: dig the whole force in on the pump house corner of
// the pasture and take every wave as it arrives; nothing here rewards
// manoeuvre, the ground is open on both sides. Buy inf_squad on a loose
// schedule once logistics allow.
//
// attackMove does not mean "stand here": a picket that breaks and runs pulls
// a force that killed it a good way past the zone edge chasing the retreat,
// and hold_for's clock only counts ticks where a living player unit is
// actually inside the zone. Left to a single order at t=1, the whole force
// wanders off after the first withdraw and the hold never resumes -- so this
// re-anchors on the pump house corner periodically, sweeping in whatever
// spawned since the last order too.
const wh2 = run(
  'wadi_halam_2_laager',
  (sim, rt, _ids, at) => {
    const anchor = (): void => {
      const all: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) all.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: all, ...M(18, 21) });
    };
    at(1, anchor);
    for (let when = 45; when <= 700; when += 45) at(when, anchor);
    for (let when = 90; when <= 700; when += 60) {
      at(when, () => void rt.requestBuild('inf_squad'));
    }
  },
  wh1
);

// III — The Cattle Track: a fast, armoured pair (jeep + APC) runs the
// commander down at the north hide -- enough firepower to drop him before
// the withdraw trigger matters, and enough armour on the jeep's wing that
// losing it to the technical's dshk isn't the likely outcome. The rest holds
// the bunds against the two-wave counter-raid; the hold re-anchors on the
// same schedule as II, for the same reason (a wave that breaks and runs
// pulls a pursuing force out past the zone edge).
const wh3 = run(
  'wadi_halam_3_counterraid',
  (sim, _rt, ids, at) => {
    const chase = [...ids('jeep_shoded'), ...ids('apc_eitan')];
    const anchor = (): void => {
      const cur: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) cur.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(18, 21) });
    };
    at(0, () => {
      sim.queueCommand({ kind: 'attackMove', ids: chase, ...M(22, 10) });
      sim.queueCommand({
        kind: 'attackMove',
        ids: [...ids('ifv_namer'), ...ids('inf_squad'), ...ids('at_team')],
        ...M(18, 21),
      });
    });
    for (let when = 60; when <= 700; when += 45) at(when, anchor);
  },
  wh2
);

// IV — Wadi Halam (the village): clear the four corner cells, kill the cache
// guard in the SE house, and get the families out. Mind the mosque block --
// nothing in this force fires ordnance heavy enough to charge it, so the
// only ROE discipline needed is not parking a gun on top of it.
//
// The north corners first, deliberately: any garrisoned house that comes
// within a weapon's max range makes itself the target and an attack-mover
// halts to trade fire with it rather than closing the distance -- so a goal
// picked equidistant between the north and south clusters brings the south
// cell into range while the force is still eight tiles from the actual
// objective, and it sits there sniping a single rifleman through a wall for
// minutes. Clearing north to south in two bounds keeps only one cluster in
// range at a time.
// IV's shepherd is the IFV, not the jeep. Front armour 420 and side 220
// against every gun in this mission's roster (dshk, penetration 25) means
// nothing here can put a scratch on it, so it can drive straight through
// contested ground and pick every family up without the risk a lighter
// vehicle runs of dying mid-transport and stranding its passengers for
// good -- which is exactly what killed the jeep-shepherd version of this
// plan before it evacuated anyone. Five transport slots covers all four
// civilians in one circuit. The APC alone (plus the infantry) is enough
// to clear the north side without the IFV's cannon.
const wh4 = run(
  'wadi_halam_4_village',
  (sim, _rt, ids, at) => {
    const apc = ids('apc_eitan');
    const ifv = ids('ifv_namer');
    const infantry = [...ids('inf_squad'), ...ids('at_team')];
    // One building at a time, and everything that can hurt masonry aimed at the
    // same one. All four cells are garrisoned, and a garrisoned man cannot be
    // shot -- his house has to come down -- so clearing the village is four
    // sequential demolitions by gunfire, and splitting the force across two
    // corners halves the rate on both.
    const guns = [...apc, ...infantry];
    at(0, () => {
      sim.queueCommand({ kind: 'attackMove', ids: guns, ...M(27, 19) });
      sim.queueCommand({ kind: 'move', ids: ifv, ...M(28, 21) });
    });
    at(20, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(25, 23) }));
    at(40, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(29, 28) }));
    at(60, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(22, 36) }));
    // The IFV's autocannon is the heaviest thing here, so it joins the sweep
    // the moment its circuit is done rather than parking on the objective.
    at(105, () => sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(32, 19) }));
    at(210, () => sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(27, 30) }));
    at(300, () => sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(32, 30) }));
    // Consolidate on the centre for the capture clock once the corners are down.
    at(390, () => sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(29, 26) }));
  },
  wh3
);

// V — Break the Depot: bring the D9 and the combat engineers in behind the
// screen from the start to level all seven structures by explicit order,
// then hold the rubble. Every demolish order names its structure -- nothing
// here is left to the automatic search, which would be perfectly happy to
// park a stationary demolisher beside a village house on the way in and
// spend ROE nobody meant to spend.
//
// What sets this mission's length is `hold_depot` (data, not the plan): a
// 240s hold_for on the depot zone, primary, gated the same way II's
// hold_pasture is. The razed structure tiles unblock as they fall, so the
// column can stand in the compound once it is down. An earlier version of
// this plan parked the demolishers at the start line for over four minutes
// to manufacture a slow mission -- invisible to anyone reading the mission
// JSON, which at the time gated on nothing but raze and the gate HVT, and
// left the 160s/220s waves and `no_bleed` (300s) structurally unreachable
// in any competent run. That park is gone: the demolishers move
// immediately, the same as a player who is not deliberately stalling
// would send them. The raze itself is fast (D9: 2400 HP, nothing in this
// mission's roster can penetrate it, blade demolition 2s/structure) -- the
// four escalated waves and three interior defenders now matter for the
// *hold*, not for slowing the demolition down.
//
// The demolish orders are issued straight from the start -- no staging move
// to the gate first, no polling for arrival. `Sim.applyCommands` now snaps a
// blocked goal tile (a structure's centroid always is one) to the nearest
// open tile before building the flow field, so the D9 and the engineers
// route themselves through the one-tile gate on their own, the same as any
// other `move` order would.
run(
  'wadi_halam_5_depot',
  (sim, _rt, ids, at) => {
    const screen = [...ids('apc_eitan'), ...ids('ifv_namer'), ...ids('inf_squad'), ...ids('at_team')];
    const dozer = ids('dozer_d9');
    const engineers = ids('demo_squad');
    const jeep = ids('jeep_shoded');
    // The seven structures inside the wire, by one tile each inside their
    // footprint -- see the map's depot zone. One shared pool rather than a
    // fixed split: the combat engineers (HP 380, no armour worth the name)
    // are the softest thing in the column, and the harassment this mission
    // throws at the gate can plausibly kill them before they clear their
    // share. A demolisher pulls the next live target off the shared list
    // rather than a list assigned to it specifically, so if the engineers
    // go down the D9 (slower alone, but unkillable by anything in this
    // mission's roster) picks up what is left instead of three buildings
    // simply never coming down.
    const targets: [number, number][] = [
      [36, 18],
      [40, 18],
      [36, 21],
      [40, 21],
      [36, 24],
      [39, 24],
      [37, 27],
    ];
    // Checked against the live structure table so a target already down is
    // skipped. Scanned from opposite ends of the shared list so that, when
    // both demolishers are free in the same tick, they claim different
    // structures instead of doubling up on the first one.
    const orderNext = (unit: number[], forward: boolean): void => {
      const order = forward ? targets : [...targets].reverse();
      for (const [tx, ty] of order) {
        const s = sim.structureAt(tx, ty);
        if (s >= 0) {
          sim.queueCommand({ kind: 'demolish', ids: unit, structure: s });
          return;
        }
      }
    };
    at(0, () => {
      sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(34, 24) });
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(30, 24) });
      orderNext(dozer, true);
      orderNext(engineers, false);
    });
    // Reissue cadence: 15s, comfortably longer than either demolisher's own
    // timer (D9 2s, engineers 5s), so this only ever catches a demolisher
    // that has actually finished and gone idle -- it does not interrupt one
    // still working (a fresh demolish order resets its charge timer).
    for (let when = 15; when <= 200; when += 15) {
      at(when, () => {
        orderNext(dozer, true);
        orderNext(engineers, false);
      });
    }
    // Once the column has a foothold, the screen advances into the compound
    // and holds there for hold_depot's clock -- re-anchored periodically for
    // the same reason II and III need it: attackMove does not mean "stand
    // here", and a wave that breaks and runs pulls a pursuing force out past
    // the zone edge.
    at(40, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(38, 22) }));
    for (let when = 85; when <= 400; when += 45) {
      at(when, () => {
        const cur: number[] = [];
        for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) cur.push(i);
        sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(38, 22) });
      });
    }
  },
  wh4
);

// A player who gives no orders must not WIN the depot. This is the executable
// falsification of raze's worst failure mode: if the target set is ever empty,
// or `every()` degenerates on an empty array, this turns VICTORY and the harness
// fails.
//
// `defeat`, and it used to be `ongoing`. A passive force is neither wiped nor
// victorious, so before `raze_depot` had a deadline this run simply burned the
// 20-minute cap -- which is the softlock #87 describes, visible right here in
// the harness and mistaken for a control passing. Now the deadline expires at
// 300s and the mission ends. `defeat` still falsifies the empty-target-set bug
// exactly as `ongoing` did: a `raze` that wrongly completed would report
// VICTORY, not DEFEAT. It is a stronger control than before, because it also
// proves the deadline fires.
//
// It does NOT prove the D9's automatic demolition search leaves the depot alone
// in general -- the nearest structure is roughly twenty tiles from the passive
// start and the auto-search radius is two, so nothing here was ever close
// enough to test that.
run('wadi_halam_5_depot', () => {}, wh4, 'defeat', 'wadi_halam_5_depot (no orders)');

// --- Beit Sahwan IV: Subterranean --------------------------------------------

// IV — Subterranean: tour the district with both charge teams, and let the
// drone walk ahead of them.
//
// A route can only be charged while it is identified, and identification is
// live: a mark_tunnel carrier has to hold a sight line to it. Both Yahalom
// carry the ability themselves at sight 8, so a team that walks onto a route
// finds it and holds it for its own charge; the drone's job is to shorten the
// walk by finding the next one while the current charge runs.
//
// The two teams split. South-west takes bs_tn_souk then bs_tn_west; north-east
// takes bs_tn_clinic then bs_tn_north. Serialising them on one team is what
// blows the budget.
run('beit_sahwan_4_subterranean', () => {}, {}, 'defeat', 'beit_sahwan_4_subterranean (no orders)');

// The scripted run inherits the arc, the control does not. `run` returns only the
// keys a mission DECLARES in `produces`, while the app merges each mission's output
// into one persistent ledger (main.ts:1022) -- so chaining led1 -> led2 -> led3 by
// hand drops `intel.marked_positions` at Beit Sahwan II, which does not declare it.
// Merging the three here is what the app actually does, and it is the only way this
// mission's two inherited tags (bs_cell_north_block, bs_ambush_market_lane) arrive
// pre-revealed the way the design says they should. The no-orders control keeps `{}`:
// a passive run should not double as a carry-over test.
const led4In = { ...led1, ...led2, ...led3 };

// Diagnosis (walk_mission.ts + a scratch instrumented run) turned up something
// the guessed plan above could not have worked around: a plain `move` parked
// beside a route never charges it. `chargeOrder` is set in exactly one place,
// Sim.applyCommands's `kind: 'chargeTunnel'` branch -- the same command
// main.ts's HUD dispatches on a right-click over an identified route. It also
// walks the team to the nearest tile on the route's OWN polyline itself, so
// there is no tile to guess -- the plan only has to say which route and when.
// Route indices are positional, in the map's own `tunnels` array order:
// bs_tn_west=0, bs_tn_north=1, bs_tn_souk=2, bs_tn_clinic=3.
run('beit_sahwan_4_subterranean', (sim, _rt, ids, at) => {
  const teams = ids('yahalom_squad');
  const west = teams.slice(0, 1);
  const east = teams.slice(1, 2);
  const drone = ids('recon_drone');
  const escort = [...ids('inf_squad'), ...ids('ifv_namer'), ...ids('apc_eitan')];

  // The escort goes out FIRST and alone. bs4_charge_crossroads -- a kamikaze
  // charge_squad, not one of the two tags this mission inherits pre-revealed
  // -- sits directly on the ground south of the district and rushes whoever
  // reaches it first. Sending the escort ahead means an inf_squad trades with
  // it instead of a Yahalom team: a rifle squad is replaceable, a charge team
  // eaten by one kamikaze hit (420 damage against 380 HP) is not. The same
  // attackMove clears bs_ambush_market_lane (already identified from the
  // inherited ledger) on the same pass.
  at(0, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(27, 25) }));

  // The drone scouts toward bs_tn_north -- the one route nothing has found
  // yet, its mouth over 20 tiles from every player spawn -- from a stand-off
  // point outside any occupant's weapon range of the vent, so it does not
  // trigger a surfacing volley by walking up on its own.
  at(2, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(28, 20) }));

  // West waits for the escort to clear the crossroads, then charges
  // bs_tn_souk. Ordered while the team is still at its spawn: the nearest
  // tile on souk's own polyline from there is on the MOUTH side (~7 tiles),
  // not the vent (~11) -- so the team never comes within the stocked
  // militia_cell pair's weapon range of the vent, and the charge collapses
  // both of them still buried, no fight needed.
  at(12, () => sim.queueCommand({ kind: 'chargeTunnel', ids: west, tunnel: 2 }));

  // East charges bs_tn_clinic immediately. Its stocked rpg_team + militia_cell
  // pair does surface -- clinic's line runs through contested ground either
  // way -- but Yahalom's own carbines are enough to drop both before the
  // charge completes.
  at(2, () => sim.queueCommand({ kind: 'chargeTunnel', ids: east, tunnel: 3 }));

  // Once each team's first route is down, retarget to the second.
  // bs_tn_west has no stocked occupants at all -- the digger_crew reworking
  // it live is 20 tiles north, out of this fight -- so west's second charge
  // is uncontested.
  at(45, () => sim.queueCommand({ kind: 'chargeTunnel', ids: west, tunnel: 0 }));

  // bs_tn_north is the hardest of the four: two rpg_team occupants (300
  // damage, penetration 550) plus a garrisoned militia_cell dug in at the
  // mouth. East cannot solo this the way it solo'd clinic, so the escort
  // follows it up once the crossroads/market lane fight is won.
  at(45, () => sim.queueCommand({ kind: 'chargeTunnel', ids: east, tunnel: 1 }));
  at(50, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(30, 17) }));
}, led4In);
