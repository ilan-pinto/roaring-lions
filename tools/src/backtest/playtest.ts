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
// - every other defender stays where they are. They start spread across the
//   yard with firing positions covering each gate, and a wall they can shoot
//   over, so there is nothing to reposition toward -- and a unit under orders
//   is a unit that might walk into its own gateway and cork it.
// - the forward section is the one exception, and it is the design's own
//   decision rather than a workaround. `script.md`'s level design leaves one
//   inf_squad at [20,14], outside the wire, between the paramotor's eye and
//   the mortar crew laid in behind it -- exposed to both unless the sniper or
//   the mortar team spends a turn on one of them instead of the wall. `hold_outpost`
//   (secondary, hold_for(outpost_ground, 120)) rewards holding it; the
//   `they_take_the_section` trigger (timer_s 165) takes it if the mission does
//   not lose it first. This plan takes the other half of that decision: at t=0
//   the section withdraws to [21,18], the tile it occupied before the level
//   script moved it forward, trading `hold_outpost` for the unit itself rather
//   than spend a defender on ground the plan cannot also hold with the rest of
//   the line intact.
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
  at(0, () => {
    // Pull the forward section back inside the wire immediately, rather than
    // leave it to the paramotor/mortar pair or the t=120s wave that overruns
    // `outpost_ground`. Filtered by starting position, not by entity order,
    // since `inf_squad` spawns four times and only the one at [20,14] is the
    // forward section -- the other three stay on the wall (see the comment
    // above).
    const forward = ids('inf_squad').filter(
      (i) =>
        Math.round(fx.toNumber(sim.state.posX[i])) === 20 && Math.round(fx.toNumber(sim.state.posY[i])) === 14
    );
    sim.queueCommand({ kind: 'move', ids: forward, ...M(21, 18) });
  });
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

// III — Clearance: combined arms, with the armour held off the clinic.
//
// The clinic zone is [29,23,6,6] — tiles x29-34, y23-28 — and three things
// about this map put it directly in the way of the primary objective:
// `town_center` is the marker at [31,22], right on its northern edge, and the
// `bs_cell_centre` militia sit at (29.5,25.5), which is INSIDE the zone and in
// the open. Clearing the town means killing something standing in the clinic.
//
// A unit does not choose which of its weapons it fires — only where it stands.
// The zone penalty arms at collateral_risk >= 0.3, which catches the Namer's
// cannon_30 (0.35) and the Lavi's gun_120 (0.55) but not rifles (0.1), the
// Lavi's coax_mg (0.2) or the Eitan's rws_50 (0.25). So the whole mission is
// decided by which units are given a line into that box.
//
// The previous plan attack-moved everything alive to (38,22) at t=140, which
// walked both Namers into range of the cell in the clinic: 107 rounds of 30mm
// landed inside the zone, plus 7 of 120mm and 6 Spike. The 10s cooldown
// compressed those into 11 deductions of 5 — a 55-point loss, on top of 6 for
// one house — and the mission ended at ROE 39 against its own fail_below of 40.
// It lost to its own supporting fire, not to the Ashwar Front (#121).
//
// So: the centre is taken by rifles and the Eitan's RWS, both under the
// threshold, while the armour works the north block and swings east along
// y=16 to the ATGM rather than across the clinic. Same objectives, and it
// finishes faster and with more of the roster alive than the shelling did.
const led3 = run(
  'beit_sahwan_3_clearance',
  (sim, _rt, ids, at) => {
    at(1, () => {
      sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(32, 18) });
      // North block only. Nothing above the collateral threshold is given a
      // reason to look south into the clinic.
      const armor = [...ids('mbt_lavi'), ...ids('ifv_namer')];
      sim.queueCommand({ kind: 'attackMove', ids: armor, ...M(30, 12) });
      // The Eitan goes with the infantry rather than with the armour: its RWS
      // is under the threshold, so it is the one vehicle that can support a
      // fight inside the zone without being charged for it.
      sim.queueCommand({
        kind: 'attackMove',
        ids: [...ids('inf_squad'), ...ids('apc_eitan')],
        ...M(28, 26),
      });
      // Engineers follow the infantry: held houses come down by charge, which
      // costs the house and nothing else — shelling them scatters rounds into
      // the clinic block next door.
      sim.queueCommand({ kind: 'attackMove', ids: ids('demo_squad'), ...M(27, 25) });
      // The AT team stays north with the armour. Spike also arms the zone
      // penalty, and its business is the technical and the gun truck anyway.
      sim.queueCommand({ kind: 'attackMove', ids: ids('at_team'), ...M(30, 14) });
    });
    // Armour's own move east was retimed from t=140 to t=85 for the
    // map-variants slice (docs/campaign/map-variants-design.md,
    // `beit_sahwan_3` -- the clinic wall). The wall's own north face (y=23)
    // is 10 tiles from the armour's north-block waypoint (30,12ish, snapped
    // off the blocked house tile) -- inside both mbt_lavi's 12-tile gun_120
    // range and ifv_namer's 10-tile cannon_30 range. Once bs_cell_north_block
    // dies the armour has nothing else to shoot at that range and, still
    // under attackMove, fixates on the wall itself: `wall`'s own roe_penalty
    // is 0, so destroying it is free, but `roe.flagged_zones` charges every
    // STRAY heavy round that scatters into the zone regardless of intended
    // target, and at 10-12 tiles those stray rounds land squarely on it.
    // Measured (isolating the wall alone via a scratch run): six such
    // deductions, ROE 94 -> 61. Moving this order earlier -- before the
    // fixation has time to compound -- cuts it to one, ROE 94 -> 89.
    at(85, () => {
      const armor = [...ids('mbt_lavi'), ...ids('ifv_namer')];
      // East along the northern edge to the ATGM at (38.5,22.5) — approaching
      // on y=16 keeps the gun line clear of the clinic the whole way.
      sim.queueCommand({ kind: 'attackMove', ids: armor, ...M(38, 16) });
    });
    at(140, () => {
      sim.queueCommand({
        kind: 'attackMove',
        ids: [...ids('inf_squad'), ...ids('apc_eitan')],
        ...M(31, 22),
      });
    });
    at(260, () => {
      const armor = [...ids('mbt_lavi'), ...ids('ifv_namer')];
      sim.queueCommand({ kind: 'attackMove', ids: armor, ...M(38, 22) });
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
//
// Option C detour (script.md §9.1): `get_the_carriers_out` runs a 300s clock
// from t=0 regardless of contact, so the jeep alone is diverted to shepherd
// both carrier groups off the south ford before rejoining the ford-watch
// anchor -- a three-leg detour that costs the plan 0 survivors and about
// 0.6 minutes. The drone's own tour gains one extra leg to mark
// `wh_hide_south`, which is the carry-over III spends (script.md §2.3).
const wh1 = run('wadi_halam_1_fords', (sim, rt, ids, at) => {
  const drone = ids('recon_drone');
  const screen = [...ids('apc_eitan'), ...ids('inf_squad'), ...ids('at_team')];
  const jeep = ids('jeep_shoded');
  at(0, () => {
    // North first: the near gallery ambush is 4 tiles off the axis, and
    // going in under attackMove springs and kills it instead of walking past.
    sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 15) });
    // Detour, not the shipped [9,20]: closes on carrier group A ([13.5,30.5])
    // first, within SHEPHERD_RADIUS_SQ (4 tiles).
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(15, 31) });
    sim.queueCommand({ kind: 'move', ids: drone, ...M(20, 17) });
  });
  at(45, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(20, 30) }));
  // South gallery next -- the second identified contact the picture needs
  // beyond the bank/bund pair the drone is already turning up.
  at(60, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 31) }));
  // Jeep's second leg: closes on carrier group B ([16.5,33.5]).
  at(60, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(17, 34) }));
  // Drone marks wh_hide_south while its tour is already this far south --
  // the identification III's carry-over spends (script.md §2.3, 5.9 -> 5.2 min).
  at(90, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(21, 35) }));
  // Jeep rejoins the ford-watch anchor loop the screen re-issues every 45s
  // from t=130.
  at(120, () => sim.queueCommand({ kind: 'attackMove', ids: jeep, ...M(10, 24) }));
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
run('wadi_halam_1_fords', () => {}, {}, 'defeat', 'wadi_halam_1_fords (no orders)');

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
//
// `burn_store` (script.md's `structures[]` shed at [16,19], Option C): a
// masonry structure with nobody garrisoned inside is not a valid target for
// ordinary weapons fire at all -- `selectStructureTarget` only ever picks a
// building that holds an IDENTIFIED HOSTILE occupant (mission.ts / sim.ts:
// "Nothing in the open to shoot? Then the enemy is inside a building"), and
// script.md's own fragment for the shed's defender cannot be authored as
// `stance: garrison` -- `validate_data.mjs`'s garrison-building check reads
// only the map's own static grid, never a mission's own `structures[]` (see
// script.md's correction to §2.2/§8a). So the anchor's firing line alone
// cannot bring the shed down, contrary to script.md's own measurement
// ("brings the new shed's HP down over the course of the mission with no
// amendment"), which was not run against this validator. The mission's own
// briefing already promises engineers ("...while the engineers lay the
// crossing behind you"), so `demo_squad` fields that promise: one combat
// engineer team, added to starting_force, explicitly demolishes the shed --
// the same idiom V already uses for its own seven structures. It is kept
// out of the periodic anchor sweep so a later `attackMove` never cancels its
// charge.
const wh2 = run(
  'wadi_halam_2_laager',
  (sim, rt, ids, at) => {
    const engineers = new Set(ids('demo_squad'));
    const anchor = (): void => {
      const all: number[] = [];
      for (let i = 0; i < sim.entityCount; i++)
        if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !engineers.has(i)) all.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: all, ...M(18, 21) });
    };
    at(0, () => {
      const shed = sim.structureAt(16, 19);
      if (shed >= 0) sim.queueCommand({ kind: 'demolish', ids: [...engineers], structure: shed });
    });
    at(1, anchor);
    for (let when = 45; when <= 700; when += 45) at(when, anchor);
    for (let when = 90; when <= 700; when += 60) {
      at(when, () => void rt.requestBuild('inf_squad'));
    }
  },
  wh1
);
// `burn_store` reaches `failed` at 300s, and `hold_pasture` never even
// starts (the force spawns at x2-4, `pasture` begins at x13) -- nothing else
// on the map can end a passive run.
run('wadi_halam_2_laager', () => {}, wh1, 'defeat', 'wadi_halam_2_laager (no orders)');

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
// `get_the_herders_out` reaches `failed` at 300s. `hold_bunds` never starts
// for the same structural reason as II; `kill_amir` cannot fail on its own.
run('wadi_halam_3_counterraid', () => {}, wh2, 'defeat', 'wadi_halam_3_counterraid (no orders)');

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
// `evac_families` already reaches `failed` at 300s today -- the only change
// Option C makes is that it is now a primary, so `checkEnd` finally reads it.
run('wadi_halam_4_village', () => {}, wh3, 'defeat', 'wadi_halam_4_village (no orders)');

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
//
// Second regression: Beit Sahwan I gained a companion placement -- militia_cell
// tagged bs_track_north at [26.5,16.5], IV's own tag too, with a secondary
// (find_the_column) the I plan above now completes. intel.marked_positions
// accumulates by tag and led4In merges led1..led3, so bs_track_north now
// spawns PRE-IDENTIFIED here: spawnPlacement's preMarked branch (mission.ts)
// skips setAmbush, and it stands revealed from tick zero at its full 7-tile
// rifle range instead of holding fire to the 3 tiles its stance authors.
//
// That is not what actually broke this plan. A scratch instrumented run
// (walk_world.ts's makeWorld, this same led1/led2/led3 chain, full per-tick
// dumps of every unit's position/hp/mobilityKilled/chargeTicks) shows the fix
// below returns the identical VICTORY in 2.1 min, ROE 98, roster out 6 even
// with bs_track_north stripped back out of intel.marked_positions -- so it
// spawns as a genuine hidden ambush again. The weaker militia cell it replaces
// was never the threat; the ledger change shifted how many combat ticks other
// entities spend fighting before this point, which shifts their own
// per-entity RNG draws (sim.ts's `rng(shooterId)`, read on every
// targeting/penetration/component roll) far enough to expose two pre-existing
// structural faults this plan already had:
//
// 1. The Namer sat parked at the crossroads (27,25) -- one tile from
//    bs_ambush_market_lane at (27.5,24.5) -- as part of `escort`, for the 45+
//    seconds that group needs to clear bs4_cell_souk and bs4_charge_crossroads
//    regardless of when a LATER order is queued (attack-move will not abandon
//    a live fight). That ambush's rpg7 (penetration 550) overmatches the
//    Namer's 420 front armor; the hit landed and rollComponent (sim.ts) drew
//    mobility_kill. A mobility-killed hull is skipped by every later
//    stepMovement tick FOREVER (sim.ts:4628) -- no order, however late, ever
//    moves it again. It was already carrying the two civilians it picks up
//    for free near its own spawn, so those two were stranded at (27,25) and
//    get_them_out came up two short of 5 inside the 240s clock.
// 2. East's solo run at bs_tn_north started the moment its own tunnel:1 order
//    fired at t=45, with escort still 25-30s of travel away and unable to
//    leave its own fight early. Two buried rpg_team occupants (300 damage,
//    penetration 550 each) surfaced on approach and killed the 380 HP team
//    before its charge finished, permanently blocking bs_tn_north -- only two
//    Yahalom teams exist in the whole mission, so bring_it_down could never
//    complete once one of them was dead.
//
// Fix: the Namer is no longer part of `escort` -- it peels off to the
// collection point immediately instead, so it never stands next to either
// ambush again -- and east's own north charge is held until t=68 instead of
// t=45, so escort (now inf_squad + apc_eitan) is already drawing fire nearby
// when the two buried teams surface, rather than east taking both alone.
// Nothing else moved: a scratch run proved escort's own push orders were
// never the lever -- it cannot leave its own gauntlet near spawn early no
// matter when a later order is queued, so retiming those changed nothing.
// Even fixed, escort's north fight stays close: one inf_squad is measured
// dropping to ~8 of its 400 HP there before the buried pair dies -- exactly
// the trade the design already intends (a replaceable rifle squad drawing
// fire meant for an irreplaceable charge team), now actually landing on the
// right unit.
run('beit_sahwan_4_subterranean', (sim, _rt, ids, at) => {
  const teams = ids('yahalom_squad');
  const west = teams.slice(0, 1);
  const east = teams.slice(1, 2);
  const drone = ids('recon_drone');
  const rescueVehicle = ids('ifv_namer');
  const holdForce = [...ids('inf_squad'), ...ids('apc_eitan')];
  // The Namer never joins this group -- see above. It has nothing to gain at
  // the crossroads and an irreplaceable rescue vehicle to lose there.
  const escort = [...ids('inf_squad'), ...ids('apc_eitan')];

  // The escort goes out FIRST and alone. bs4_charge_crossroads -- a kamikaze
  // charge_squad, not one of the two tags this mission inherits pre-revealed
  // -- sits directly on the ground south of the district and rushes whoever
  // reaches it first. Sending the escort ahead means an inf_squad trades with
  // it instead of a Yahalom team: a rifle squad is replaceable, a charge team
  // eaten by one kamikaze hit (420 damage against 380 HP) is not. The same
  // attackMove clears bs_ambush_market_lane (already identified from the
  // inherited ledger) on the same pass.
  at(0, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(27, 25) }));

  // The Namer peels off immediately instead of following. It spawns at
  // [28,34], already within CivilianFlight's four-tile shepherd radius of the
  // two southern civilians at (24.5,33.5), so they flee and board within the
  // first couple of ticks purely from it EXISTING there -- no detour needed.
  // Sending it straight to collection_point banks those two evacuees inside
  // 20 seconds and keeps this 2200 HP hull out of range of every ambush in
  // the district for the rest of the mission.
  at(1, () => sim.queueCommand({ kind: 'move', ids: rescueVehicle, ...M(29, 33) }));

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
  // mouth. East HOLDS at the clinic vent -- safe, and far from bs_tn_north's
  // stocked occupants -- rather than soloing north the moment clinic is down.
  // t=68 was reached by re-running the scratch harness until east's approach
  // and escort's arrival at the vent overlap, so the two buried teams split
  // their fire against a group already there instead of concentrating both
  // rounds on one 380 HP team alone.
  at(68, () => sim.queueCommand({ kind: 'chargeTunnel', ids: east, tunnel: 1 }));
  at(50, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(30, 17) }));

  // Once the mouth fight at bs_tn_north is in hand, push the whole escort
  // further north-west into the shaft head itself. bs4_hvt_spade holds it
  // directly -- a `capture` cannot complete while he does, since contest
  // resets the whole ten-second clock rather than merely pausing it -- and
  // spade_guard's ambush and bs_track_north sit right against the same
  // ground. The four hostages and the two shipped civilians at [28.5,14.5]
  // stand within a couple of tiles of it too, so the same push that clears
  // the ground suppresses them into fleeing on foot toward civ_collection:
  // CivilianFlight walks anyone with no transport within four tiles, no extra
  // order needed, and the ~19-tile walk from here still lands well inside
  // get_them_out's 240s.
  at(80, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(26, 14) }));

  // Escort holds the shaft head rather than following anyone south.
  // `capture`'s contest check resets `holdTicks` to zero on ANY living enemy
  // inside the zone, so a unit left to chase a runner beyond it would restart
  // the whole ten-second count -- ordering it to a fixed interior point once
  // the ground is cleared is what keeps it held rather than merely visited.
  at(115, () => sim.queueCommand({ kind: 'move', ids: holdForce, ...M(26, 13) }));
}, led4In);

// --- Sur: Tel Marum -----------------------------------------------------------

// Tel Marum I — the picture, taken from dead ground.
//
// Round 1 shipped `picture` as an untargeted `locate` (count N of ANY
// identified hostile). That was the actual bug: it let the pursuit waves
// below feed the same objective they were meant to punish passivity for
// dodging, so a heavy wave produced a free VICTORY for a player who gave no
// orders, and a light one produced a stalemate no wave volume could break.
// The primary is now four separately TARGETED `locate`s -- one per named
// garrison tag (tm_pocket_east, tm_pocket_west, tm_spotter_west,
// tm_hvt_battery) -- exactly the shape `beit_sahwan_1_recon`'s `hvt_seen`
// already ships. A wave unit carries no such tag, so it is structurally
// unable to complete any of the four; only genuine recon of the wall and
// the battery can.
//
// The approach at (24,25) still gives three of the four for free (sight 16
// reaches both ATGM pockets and the spotter from there, ~9-10 tiles out).
// `find_battery` costs the sweep: the battery sits 18.6 tiles from the
// approach, past sight 16, and the straight route north runs through the
// wide pass at x=22-26 -- exactly what tm_picket_wide (sarim_rifles, weapon
// range 8) is posted to cover, which is what killed the drone at 44.5s in
// an earlier attempt that went straight up the middle. The shipped route
// goes around instead: south and west off the wall's engagement envelope
// entirely, up the narrow saddle at x=11 (nothing in this garrison reaches
// that column), then east to a standoff point that sees the battery at
// range 10.6 -- outside both rifle squads' weapon range and sight the whole
// way, checked leg by leg, not just at the endpoints.
//
// Control: a player who gives no orders never moves the drone, so none of
// the four primaries can complete on their own -- and now, unlike round 1,
// nothing a wave carries can complete them either (a wave unit has no
// tm_pocket_east/tm_pocket_west/tm_spotter_west/tm_hvt_battery tag, so it is
// structurally unable to satisfy a targeted `locate`). That closes the
// round-1 exploit: this control cannot WIN, which is a real assertion --
// round 1's untargeted `picture` could be won by a passive player for free.
//
// It used to be that this control could not LOSE either, on the reasoning
// that wiping the starting force takes more wave volume than a "bring back
// the picture, not casualties" recon should carry -- see git history for
// the retired bounded-fallback measurement (6-vs-7-wave wipe thresholds).
// That reasoning no longer applies: per
// `docs/campaign/tel_marum/script-losable.md` (design decision O-C), this
// mission now carries `clear_the_valley_floor`, an `evacuate_before`
// primary with its own 300s deadline (herders placed on the valley floor,
// at [21,24]), so a passive player loses on that clock regardless of wave
// volume -- `checkEnd` fails the mission the instant the count never
// reaches 2 by t=300s. Measured (this session): DEFEAT at 5.00 min. See
// that document's §1/§2 for the new primary's shape and the shipped plan's
// unchanged victory.
run('tel_marum_1_recon', () => {}, {}, 'defeat', 'tel_marum_1_recon (passive control)');

run(
  'tel_marum_1_recon',
  (sim, _rt, ids, at) => {
    const drone = ids('recon_drone');
    const screen = ids('apc_eitan');
    const foot = ids('inf_squad');
    at(4, () => {
      // Screen forward to the hollow and stop there — out of the envelope.
      sim.queueCommand({ kind: 'move', ids: screen, ...M(24, 30) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(23, 31) });
      // The drone alone goes into the envelope. From the approach alone,
      // sight 16 already reaches both ATGM pockets and the spotter (all
      // three complete by ~t=16s, well before the next order below fires).
      sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 25) });
    });
    // find_battery is the one the approach cannot give for free: the battery
    // sits 18.6 tiles out from there, past sight 16. The straight route north
    // runs through the wide pass at x=22-26, which is exactly what
    // tm_picket_wide (sarim_rifles, weapon range 8) is posted to cover --
    // closing on it is what killed the drone at 44.5s in the round-2 replay.
    // So the drone goes around: south and west off the wall's engagement
    // envelope entirely, up the UNGUARDED narrow saddle at x=11 (nothing in
    // this garrison can reach that column), then east to a standoff point
    // north of the wall that sees the battery at range 10.6 -- outside both
    // rifle squads' weapon range (8) and sight (9) throughout, by margins of
    // 1-7.5 tiles at every leg (checked against both tm_picket_wide and
    // tm_spotter_west along the full path, not just the endpoints).
    at(20, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(16, 27) }));
    at(28, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(11, 22) }));
    at(35, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(11, 12) }));
    at(44, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(15, 8) }));
  },
  {},
  'victory',
  'tel_marum_1_recon'
);

// Tel Marum II — the start line, and the man who calls the fire.
//
// The approach is 35 tiles. The design doc's 18-of-35 figure came from the
// doctrine test's 48-sight OBSERVER, walking terrain, not from the garrison
// unit actually posted there: `tm_spotter_west` is sarim_rifles, sight 9. At
// that sight the real count is smaller, roughly 15 — approximate, not
// re-measured through the real Sim here. The plan takes the southern edge of
// the zone, which counts for the hold and is the cheapest ground in it, then
// sends infantry up the west side of the bay to kill the observer. Killing
// him removes one contact feeding the battery, but `sim.ts:2073` identifies
// per side, not per unit — other garrison Sarim can still hand the Grad eyes
// on the zone, so the hold is not proven uncontested by this kill alone (see
// mission II's own briefing, which already carries this caveat).
//
// Control: a player who gives no orders never enters the approach, so
// hold_for never starts and kill_spotter never fires, and `hold_for`/
// `eliminate_hvt` are still not among the three objective types `checkEnd`
// can ever fail on their own (only `raze`, `collapse`, both seconds-gated,
// and `evacuate_before` -- mission.ts:1361/1372/1423). But per
// `docs/campaign/tel_marum/script-losable.md` (design decision O-C), this
// mission now also carries `burn_the_ammo_point`, a `raze` primary with its
// own 300s deadline against a mission-raised `shanty` in the new
// `ammo_draw` zone -- a passive player never orders a demolition (the
// structure cannot be destroyed by ordinary weapon fire; see that
// document's Mission II write-up), so it stands at 300s and the primary
// fails. `checkEnd` returns DEFEAT on that clock regardless of the
// hold/HVT pair. Measured (this session): DEFEAT at 5.00 min.
run('tel_marum_2_foothold', () => {}, {}, 'defeat', 'tel_marum_2_foothold (passive control)');

run(
  'tel_marum_2_foothold',
  (sim, _rt, ids, at) => {
    const armour = ids('apc_eitan');
    const tank = ids('mbt_lavi');
    const foot = ids('inf_squad');
    const at_ = ids('at_team');
    const mortar = ids('mortar_team');
    const demo = ids('demo_squad');
    // `at(3)` moved to `at(1)` -- map-variants-design.md §3.1's `tel_marum_2`
    // write-up: the ditch/crossing terrain costs the vehicle route at most
    // 1 tile (measured: start_line -> approach still 20, -> hollow 15 -> 16),
    // and this mission runs 0.87 of target with only 1.1 minutes above its
    // 240s floor -- no reason to spend that margin on travel.
    at(1, () => {
      // Into the southern edge of the approach zone — inside it for the hold,
      // furthest from the battery.
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 26) });
      sim.queueCommand({ kind: 'move', ids: tank, ...M(26, 26) });
      sim.queueCommand({ kind: 'move', ids: at_, ...M(25, 26) });
      // Mortar stays in the hollow: 18 tiles of reach covers the bay lip from
      // ground the Grad cannot touch.
      sim.queueCommand({ kind: 'move', ids: mortar, ...M(24, 29) });
      // The demo squad moves on the ammo cache in the draw. Within 2 tiles
      // of the shanty's footprint it self-targets and burns it with no
      // explicit `demolish` order needed (`stepDemolition`'s automatic
      // branch, sim.ts:4335) -- script-losable.md §1/§2.
      sim.queueCommand({ kind: 'move', ids: demo, ...M(23, 28) });
    });
    at(20, () => {
      // Infantry up the west side toward the pocket.
      sim.queueCommand({ kind: 'move', ids: foot, ...M(20, 22) });
    });
    at(70, () => {
      sim.queueCommand({ kind: 'move', ids: foot, ...M(20, 17) });
    });
    at(110, () => {
      sim.queueCommand({ kind: 'attackMove', ids: foot, ...M(20, 16) });
    });
  },
  {},
  'victory',
  'tel_marum_2_foothold'
);

// Tel Marum III — the pass, taken the expensive way on purpose.
//
// The plan takes the WIDE saddle. That is the costly route and it is chosen
// deliberately: the narrow saddle is nine tiles longer, and while the Grad
// reaches it at 17 tiles, measurement showed the observer at [12,4] does not
// change that price -- narrow-with-spotter-alive (5.2 min) and
// narrow-with-spotter-dead (5.1 min) are the same run (see the Tel Marum
// saddle bullet in CLAUDE.md). The narrow route's real cost is
// force-splitting, not this observer. A scripted proof should demonstrate
// the mission is winnable by the obvious line, not by the clever one.
//
// Mortars kill the west pocket's observer from the hollow first, because every
// tile of the wide saddle is inside the Grad's reach and being seen there is
// what makes it lethal rather than merely defended.
//
// Control: primaries `capture` (take_pass) and `eliminate_hvt`
// (kill_battery) are still not among the three objective types `checkEnd`
// can ever fail on their own (only `raze`, `collapse`, both seconds-gated,
// and `evacuate_before` -- mission.ts:1361/1372/1423). But per
// `docs/campaign/tel_marum/script-losable.md` (design decision O-C), this
// mission now also carries `get_the_block_out`, an `evacuate_before`
// primary reusing the `approach` zone/marker with its own 300s deadline
// (three families placed east of `town_block` at [27.5,5.5]) -- a passive
// player never shepherds them, so the count never reaches 2 by t=300s and
// `checkEnd` returns DEFEAT on that clock regardless of the pass/HVT pair.
// Measured (this session): DEFEAT at 5.00 min.
run('tel_marum_3_clearance', () => {}, {}, 'defeat', 'tel_marum_3_clearance (passive control)');

// Captured (not part of the shipped Tel Marum patch) so Umm Zeitoun -- the
// next town in the same region -- can thread the ledger the way the app
// actually does: one persistent campaign ledger, not a per-mission `{}`. Only
// the `run` call's return value changes here; the plan, its ledgerIn (`{}`),
// and its expectation are byte-identical to the shipped Tel Marum III patch.
const ledTelMarum3 = run(
  'tel_marum_3_clearance',
  (sim, _rt, ids, at) => {
    const tanks = ids('mbt_lavi');
    const namer = ids('ifv_namer');
    const armour = ids('apc_eitan');
    const foot = ids('inf_squad');
    const at_ = ids('at_team');
    const mortar = ids('mortar_team');
    at(3, () => {
      // Mortar into the hollow — 18 tiles of reach onto the wall, out of the
      // Grad's 20-tile circle at 23.
      sim.queueCommand({ kind: 'move', ids: mortar, ...M(24, 29) });
      sim.queueCommand({ kind: 'move', ids: at_, ...M(25, 28) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(23, 27) });
    });
    at(30, () => {
      // Kill the west observer before anything crosses the approach.
      sim.queueCommand({ kind: 'attackMove', ids: mortar, ...M(20, 16) });
    });
    at(85, () => {
      // Armour forward through the approach to the wide saddle mouth.
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 22) });
      sim.queueCommand({ kind: 'move', ids: tanks, ...M(25, 22) });
      sim.queueCommand({ kind: 'move', ids: namer, ...M(24, 23) });
    });
    // Split into east/west arms -- map-variants-design.md §3.1's
    // `tel_marum_3` write-up: the crater belt (rows 20-21) now gates the
    // approach to x<=19 (west) and x>=29 (east), so a single attackMove to
    // each of [28,16]/[20,16] would have both arms converge on the SAME gate
    // before diverging, arriving as a column instead of abreast. Waypoint
    // each arm through its own gate first, then the attackMove target
    // `append`ed onto the same order -- queued behind the first leg
    // (`sim.ts`'s "appending to a unit already under way queues the point
    // instead of overriding it"), not timed by guesswork the way a second
    // `at()` call would be. A guessed 15s gap here (tried first) delayed the
    // advance enough to fail `get_the_block_out`'s 300s evacuation clock --
    // the append fast-path costs no extra wall-clock at all, since both
    // commands land in the same tick's queue and the second only ever
    // widens the unit's own path.
    at(130, () => {
      sim.queueCommand({ kind: 'move', ids: tanks, ...M(30, 20) });
      sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(28, 16), append: true });
      sim.queueCommand({ kind: 'move', ids: namer, ...M(18, 20) });
      sim.queueCommand({ kind: 'attackMove', ids: namer, ...M(20, 16), append: true });
    });
    at(190, () => {
      sim.queueCommand({ kind: 'move', ids: tanks, ...M(24, 13) });
      sim.queueCommand({ kind: 'move', ids: armour, ...M(24, 14) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(24, 15) });
    });
    at(240, () => {
      // Into the pass zone, then the battery beyond it.
      sim.queueCommand({ kind: 'move', ids: foot, ...M(24, 12) });
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 12) });
      sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(25, 6) });
    });
  },
  {},
  'victory',
  'tel_marum_3_clearance'
);

// --- Sur: Umm Zeitoun ---------------------------------------------------------

// Umm Zeitoun I -- Cold Ground: the drone builds the picture, the jeep buys
// the wadi its two families.
//
// Control: no order ever brings a player unit within CivilianFlight's 4-tile
// shepherd radius of the wells, so nobody flees, the count never reaches 2,
// and `get_the_wells_clear` -- the mission's only evacuate_before -- fails at
// the 240s deadline. `checkEnd` returns DEFEAT on the failed primary. None of
// the four `locate`s can complete on a passive run either (the nearest is 9+
// tiles from a sight-8 rifle squad sitting at the start line), but the
// evacuation is what actually ends the mission.
run('umm_zeitoun_1_recon', () => {}, {}, 'defeat', 'umm_zeitoun_1_recon (no orders)');

// Falsified against the design draft's own station point (24,30): that tile
// is 3.5 from `uz_eye_knoll`, and `sarim_rifles`' `rifles` weapon carries
// `can_target: ["ground","air"]` -- not a MANPAD-only threat as the design
// prose implies. A scratch trace (this session) shows the knoll garrison
// killing the drone there at t=8.15s, decades before west/east ever reach
// IDENTIFIED_AT (0.70) at 15 tiles. Every waypoint below is instead a
// *stand-off* measured at >8.5 tiles from all three `sarim_rifles` posts
// (their weapon range) -- outside rifle range, detection alone still climbs
// to identified in ~20s at that distance, confirmed against the real
// `Sim.contact` ladder. The route also detours through the map's south
// corridor and up its western edge specifically to stay outside both
// MANPADs' 13-tile envelope while transiting -- a direct cross-basin line
// clips `manpad_basin` and gets the drone killed before it ever turns north.
const ledUZ1 = run(
  'umm_zeitoun_1_recon',
  (sim, _rt, ids, at) => {
    const drone = ids('recon_drone');
    const jeep = ids('jeep_shoded');
    at(2, () => {
      // West stand-off, 8.6 tiles from `uz_eye_west` -- outside its rifle's
      // 8-tile reach. The knoll is banked for free during the transit itself
      // (it sits close enough to the direct path that a few seconds of
      // passing sight is already enough).
      sim.queueCommand({ kind: 'move', ids: drone, ...M(15.5, 30.5) });
      // The jeep runs straight to the wells: within 4 tiles of all three
      // families, which is all CivilianFlight needs to start them fleeing
      // and boarding the jeep's two free seats.
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(15, 35) });
    });
    at(12, () => {
      // Two families are aboard by now; drive them into the wadi. The third
      // stays at the wells -- "nothing else out there is worth the jeep."
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(23, 37) });
    });
    // Loop south of the knoll's own 8.5-tile bubble, then east along the
    // bottom of the basin, to the east stand-off -- 8.5 tiles from
    // `uz_eye_east` and, measured, outside both MANPADs' envelopes the
    // whole way there.
    at(30, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(30, 42) }));
    at(45, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(40.5, 31.5) }));
    // Only the crest is left. Loop back through the same southern corridor
    // and up the far-western column (x~5), which measures outside
    // `manpad_north`'s 13-tile envelope for its entire length -- the reverse
    // of the design draft's own approach (straight through the envelope, at
    // a station 4-9 tiles from it), which is what cost the drone its life in
    // every earlier attempt this session. The overlook at (4,6) sees the
    // crest at ~11 tiles and sits ~18 tiles from `manpad_north` -- safe
    // rather than sacrificial, and identification is permanent once banked
    // either way.
    at(70, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(30, 42) }));
    at(90, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(10, 40) }));
    at(105, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(5, 25) }));
    at(120, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(4, 6) }));
  },
  ledTelMarum3,
  'victory',
  'umm_zeitoun_1_recon'
);

// Umm Zeitoun II -- The Long Look: hold the crest line while a demolition
// party levels the post above the knoll.
//
// Control: a passive player never occupies `crest_line`, so `hold_for` never
// starts accumulating (it cannot itself fail); nobody fires on the shed or
// orders a demolition, so `level_the_stone_post` -- the mission's only
// failable primary -- reaches `failed` at the 300s deadline. `checkEnd`
// returns DEFEAT. The force is never wiped: Sarim doctrine here is standoff
// and nothing in the light 90s/180s/210s/300s cadence closes on the empty
// start line on its own.
run('umm_zeitoun_2_buildup', () => {}, {}, 'defeat', 'umm_zeitoun_2_buildup (no orders)');

// The whole force clears the knoll TOGETHER before anything splits off to
// hold. A first version sent the demo squad in with only two rifle squads as
// escort while the rest dug in on the crest line immediately -- it survived,
// but the two escorting `inf_squad` did not, and UZ III's own `from_ledger`
// draw for `inf_squad` (a fresh mission's own precondition per the design
// draft) came up empty against that roster, spawning one fresh body where
// three were expected. `hold_for` has no deadline of its own and does not
// reset on a contest (only pauses), so nothing is lost by holding off the
// crest line until the ground that can see it is cleared first -- only the
// 300s `raze` deadline is a hard clock, and it is reached with room to
// spare either way.
const ledUZ2 = run(
  'umm_zeitoun_2_buildup',
  (sim, _rt, ids, at) => {
    const demo = ids('demo_squad');
    const strike = [...ids('apc_eitan'), ...ids('mbt_lavi'), ...ids('mortar_team'), ...ids('at_team'), ...ids('inf_squad')];
    at(1, () => {
      // Everyone but the demo squad clears the ground around the shed first.
      sim.queueCommand({ kind: 'attackMove', ids: strike, ...M(23, 33) });
      // The demo squad follows under its own orders and starts charges the
      // moment it is within 2 tiles and the ground around it is unshaken --
      // it does not need the knoll clear to begin walking there.
      sim.queueCommand({ kind: 'demolish', ids: demo, structure: sim.structureAt(21, 33) });
    });
    // Once the knoll is down, the whole strike force pulls back onto the
    // crest line and digs in for the hold. Re-anchored periodically after
    // that: attackMove does not mean "stand here", and the 180s/300s waves
    // both march straight into the zone (`rim_crest` sits inside
    // `crest_line`).
    at(70, () => sim.queueCommand({ kind: 'attackMove', ids: strike, ...M(24, 41) }));
    for (let when = 110; when <= 350; when += 40) {
      at(when, () => {
        const cur: number[] = [];
        for (let i = 0; i < sim.entityCount; i++) {
          if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !demo.includes(i)) cur.push(i);
        }
        sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(24, 41) });
      });
    }
  },
  ledUZ1,
  'victory',
  'umm_zeitoun_2_buildup'
);

// UZ II does not declare `intel.marked_positions` in its own `produces`, so
// its own `run()` return has already dropped it -- merge back to UZ I's
// output rather than lose the recon carry-over, the same shape as Beit
// Sahwan's `led4In = {...led1, ...led2, ...led3}`.
const ledUZ2In = { ...ledUZ1, ...ledUZ2 };

// Umm Zeitoun III -- Blinding: split the force (the western horn has no
// vehicle route at all), clear the hamlet with weapons under the ROE
// threshold, evacuate four of the six families.
//
// Control: a passive player never comes within 4 tiles of either hamlet
// group, so `get_the_hamlet_out` -- the only failable primary -- fails at
// 300s. `checkEnd` returns DEFEAT. Both `eliminate_hvt` primaries can only
// stay incomplete on a passive run; neither can reach `failed` (not one of
// the three failable objective types).
run('umm_zeitoun_3_clearance', () => {}, {}, 'defeat', 'umm_zeitoun_3_clearance (no orders)');

const ledUZ3 = run(
  'umm_zeitoun_3_clearance',
  (sim, _rt, ids, at) => {
    // `inf_squad` is `from_ledger`, so this may be 1-3 bodies depending on
    // what UZ II's fight left in the roster -- never hard-indexed. The
    // hamlet group is the one that actually loses the mission if it is
    // short a body (it is what triggers the evacuation and clears the
    // garrison the ROE-safe way), so it is filled first; west and east take
    // whatever is left, and the apc/mbt/namer/at_team/mortar/sniper carry
    // both flanks regardless.
    const infantry = ids('inf_squad');
    const hamletInfantry = infantry.slice(0, 1);
    const westInfantry = infantry.slice(1, 2);
    const eastInfantry = infantry.slice(2);
    const apcs = ids('apc_eitan');
    const west = [...westInfantry, ...ids('at_team'), ...ids('mortar_team'), ...ids('sniper_team')];
    const east = [...eastInfantry, ...ids('mbt_lavi'), ...ids('ifv_namer'), ...apcs.slice(0, 1)];
    // Rifles and the Eitan's rws_50 only -- both under the 0.3 structural
    // threshold that arms the flagged hamlet's penalty (§6.5's measured
    // finding: cannon_30/gun_120/spike_atgm/mortar_60 all arm it; rifles and
    // rws_50 do not).
    const hamlet = [...hamletInfantry, ...apcs.slice(1)];
    at(1, () => {
      sim.queueCommand({ kind: 'attackMove', ids: west, ...M(12, 24) });
      sim.queueCommand({ kind: 'attackMove', ids: east, ...M(35, 24) });
      // Straight into the hamlet: `zone_entered` fires `the_house_was_the_section`
      // the moment either body crosses in, walking both garrisoned riflemen
      // out of their houses and into the open street at `hamlet_square`.
      sim.queueCommand({ kind: 'attackMove', ids: hamlet, ...M(24, 26) });
    });
    // Re-press both flanks once the first contact clears -- attackMove halts
    // on a live fight rather than closing the last few tiles to the post
    // itself.
    at(60, () => {
      sim.queueCommand({ kind: 'attackMove', ids: west, ...M(10, 23) });
      sim.queueCommand({ kind: 'attackMove', ids: east, ...M(37, 23) });
    });
    at(120, () => {
      sim.queueCommand({ kind: 'attackMove', ids: west, ...M(10, 23) });
      sim.queueCommand({ kind: 'attackMove', ids: east, ...M(37, 23) });
    });
  },
  ledUZ2In,
  'victory',
  'umm_zeitoun_3_clearance'
);

// Umm Zeitoun IV -- The Stockpile: raze three structures on a 300s clock
// while a second party climbs 16 tiles the other way for Adhal.
//
// Control: a passive player never orders a demolition, so all three
// structures inside `stockpile` still stand at 300s and `raze_the_stockpile`
// -- the only failable primary -- reaches `failed`. `checkEnd` returns
// DEFEAT. `kill_adhal` has no deadline of its own and can only stay
// incomplete.
run('umm_zeitoun_4_clearance', () => {}, {}, 'defeat', 'umm_zeitoun_4_clearance (no orders)');

// A first version sent both demo squads and their escort into one combined
// `attackMove`. Two things falsified it, both about `attackMove` and neither
// about `demolish`: merged with the escort, the demo squads inherited the
// escort's own chase (an `attackMove` group does not stop at its destination
// while a live contact is still ahead of it) and both walked, unescorted by
// nothing left behind to peel off, straight into Adhal's rifle guard 16
// tiles further on and died there; sent alone via a bare `demolish` order
// while the depot's own garrison was still standing, they closed to within a
// few tiles and stalled -- `demolish`'s own pathing has no re-route-around-a-
// live-fight behaviour the way `attackMove` does, and it never got back on
// its feet. The fix is sequencing, not a different order type: the escort
// goes in FIRST and alone to clear `uz_eye_depot`/`uz_rcl_depot`/
// `uz_atgm_north`/the warehouse garrison (and, chasing on past them, Adhal's
// guard too -- a bonus, not something this plan depends on), and only once
// that fight is in hand do the demo squads get their own direct `demolish`
// orders, which they can now walk to the letter.
run(
  'umm_zeitoun_4_clearance',
  (sim, _rt, ids, at) => {
    const demo = ids('demo_squad');
    const drone = ids('recon_drone');
    // The three structures inside `stockpile` (the `w` block, the `#` block
    // and the `s` block, flood-filled from the map's own grid) are each
    // exactly 5s of standing charges once a demolisher is within 2 tiles --
    // `demolish` is a hold-station timer, not a damage race, so 7,500 hp
    // comes down as fast as two squads can walk to three doors.
    const depotEscort = [...ids('mbt_lavi'), ...ids('apc_eitan')];
    at(1, () => {
      // The drone's own presence is enough to start the porters fleeing
      // (CivilianFlight does not filter by domain) well before any charge is
      // set near their ground.
      sim.queueCommand({ kind: 'move', ids: drone, ...M(29.5, 9.5) });
      sim.queueCommand({ kind: 'attackMove', ids: depotEscort, ...M(32, 8) });
    });
    at(45, () => {
      sim.queueCommand({ kind: 'demolish', ids: [demo[0]], structure: sim.structureAt(29, 5) });
      sim.queueCommand({ kind: 'demolish', ids: [demo[1]], structure: sim.structureAt(33, 5) });
    });
    // The shanty is the last of the three. Nothing has to name it: once a
    // squad's own explicit order is fulfilled, `demolishOrder` clears and
    // `stepDemolition`'s automatic search picks the nearest unprotected,
    // non-fenced structure on its own initiative -- measured this session,
    // both `w` and `#` finish first (~t=98s, well inside the 45s head start
    // this plan gives the escort plus the ~48s walk from the player's own
    // start line) and the freed squad retargets the shanty unordered. This
    // is a backstop only, timed comfortably past that: if a future ledger
    // ever leaves both squads still working their first door this late,
    // it re-points BOTH at the shanty rather than let the mission stall.
    at(180, () => sim.queueCommand({ kind: 'demolish', ids: demo, structure: sim.structureAt(33, 8) }));
    // Adhal carries no deadline of his own, so a second, dedicated push for
    // him only needs to exist at all -- it does not need to race the depot.
    // Held back this long on purpose: sent at t=1 alongside the escort, it
    // walks straight through the depot's own live fire on the way north.
    at(90, () => {
      sim.queueCommand({
        kind: 'attackMove',
        ids: [...ids('at_team'), ...ids('mortar_team'), ...ids('sniper_team'), ...ids('inf_squad'), ...ids('ifv_namer')],
        ...M(14, 7),
      });
    });
  },
  ledUZ3,
  'victory',
  'umm_zeitoun_4_clearance'
);
