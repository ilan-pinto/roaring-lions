import { fx } from './fixed';
import { MissionRuntime, type MissionJson } from './mission';
import { Sim, type UnitTypeJson } from './sim';

// The golden determinism worlds, importable (net sim snapshot, stage 1, Task 1).
//
// Everything here was moved VERBATIM out of determinism.test.ts: the unit and
// structure fixtures, and the builders of the replays that pin the sim. Each
// builder is split in two so a caller can fork a world mid-run: `*Setup` does
// everything up to the first tick (types, spawns, structures, tunnels) and
// returns the world at tick 0 with the ids, and `*Drive(sim, t, ids)` applies
// tick t's inputs without calling sim.tick(): the commands the loop queues, plus
// the direct calls it makes -- `ordersDrive`'s `sim.identifyTo` (tick 20) and
// `economyDrive`'s `sim.debugKill` (raider out) and runtime `requestBuild` /
// `setRally` / `cancelBuild` (which in 'direct' mode bypass the command queue).
// determinism.test.ts keeps thin wrappers with the old signatures, so its
// pinned numbers are read off the same code as before. The file name is not
// matched by vitest's `*.test.ts` glob on purpose: it holds no spec.

export const RIFLES: UnitTypeJson = {
  id: 'd_rifles',
  // `role: 'infantry'` makes these HALT TO FIRE (spec
  // 2026-10-05-infantry-halt-to-fire): armed and on foot. Added 2026-10-05,
  // because without a role the type derives as wheeled, and the replay held no
  // unit at all that kneels -- the brace columns were all zero and the pinned
  // number guarded nothing of that mechanic. See the pin below.
  role: 'infantry',
  // `garrison` is required for the garrison order below to be accepted at all;
  // without it the order is silently refused and the shed stays empty, which is
  // how a first pass at this ended up hashing structure columns that no
  // building ever travelled through.
  abilities: ['garrison'],
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 8,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      suppression: 50,
      rof_per_min: 300,
    },
  ],
};

export const TANK: UnitTypeJson = {
  id: 'd_tank',
  hull: {
    hp: 3000,
    armor: { front: 700, side: 300, rear: 150 },
    aps: { base_pk: 0.75, magazine: 3, reload_s: 8, ineffective_vs: ['apfsds', 'kinetic'] },
  },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1.0, sight_tiles: 12, signature: 1.0 },
  weapons: [
    {
      id: 'gun',
      type: 'apfsds',
      range_tiles: 12,
      accuracy: 0.85,
      penetration: 1300,
      damage: 520,
      rof_per_min: 9,
    },
  ],
};

/** Carries `demolish`, so the replay exercises the structure paths at all. */
export const SAPPER: UnitTypeJson = {
  id: 'd_sapper',
  role: 'engineer',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.4 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.5 },
  abilities: ['demolish'],
  demolition_time_s: 2.0,
  weapons: [],
};

export const SHED = { id: 'd_shed', name: 'Shed', hp_per_tile: 100, garrison_slots: 2, rubble_cover: 1 };

// --- the tunnel front -------------------------------------------------------
// A third front in the south-west corner, far enough from the corridor
// (x=24) and the shed (34,30) that neither existing fight changes: the
// nearest tunnel-front unit is ~9 tiles outside the sight of anything that
// passes, and per-entity PRNG streams keep everyone else's rolls untouched.

/** Six straight tiles, mouth to vent. At 1 tile/s the vent opens at tick
 *  120, leaving ~880 ticks for surfacing cycles and the collapse. */
export const ROUTE = { id: 'd_route', points: [[3, 45], [9, 45]] as const, dig_tiles_per_s: 1 };

/** Digs, unarmed — digger_crew's numbers. Spawned twice: once assigned to
 *  the route on the surface, once put below with no weapon, so stepSurfacing
 *  never brings it up and the collapse kill loop has someone to catch. */
export const DIGGER: UnitTypeJson = {
  id: 'd_digger',
  hull: { hp: 330, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.5 },
  sensors: { optics: 0.85, sight_tiles: 6, signature: 0.5 },
  abilities: ['dig_tunnel'],
  weapons: [],
};

/** The fighter below. Deep hull so ~8 surfacing windows of guard fire do
 *  not kill it mid-cycle; a slow rifle so each 2-shot volley spans most of
 *  its window; NO suppression stat, so its return fire never pins the
 *  charge team into resetting the collapse clock (tunnels.test.ts's
 *  RIFLE_TYPE makes the same choice for the same reason). */
export const MOLE: UnitTypeJson = {
  id: 'd_mole',
  hull: { hp: 6000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'd_mole_w',
      type: 'small_arms',
      range_tiles: 5,
      effective_range_tiles: 4,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      rof_per_min: 30,
    },
  ],
};

/** Charge team — yahalom_squad's hull, `tunnel_charge` AND `mark_tunnel`
 *  (production parity), minus the carbines: it stands 3 tiles from a digger
 *  it must not shoot (a dead digger means no vent and no surfacing). Under
 *  live visibility the mark is load-bearing: its own sight line to the
 *  route is what holds the route identified for side 0 from first sight to
 *  collapse — the hold half of the live rule, inside the pin. (Side 1 still
 *  identifies the same route through ordinary trail accrual — the digger
 *  watches its own spoil — so the ladder path stays covered too.) */
export const YAHALOM: UnitTypeJson = {
  id: 'd_yahalom',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.85 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.55 },
  abilities: ['tunnel_charge', 'mark_tunnel'],
  tunnel_charge_time_s: 8,
  weapons: [],
};

/** The second route: pre_dug in the south-east corner, unoccupied, no digger
 *  — it exists to put live visibility's OTHER half inside the pin. The
 *  walk-by scout below marks it in passing and keeps walking; the identified
 *  contact, unwatched once the scout is out of sight (~tick 250), decays
 *  through `lost` (~tick 570) and keeps decaying to the end of the replay.
 *  Under the old latched rule this contact froze at full confidence forever,
 *  so this corner is what moves the golden hash for the live-visibility
 *  change — and what fails first if the decay is ever quietly re-frozen. */
export const ROUTE_SE = {
  id: 'd_route_se',
  points: [[38, 45], [44, 45]] as const,
  dig_tiles_per_s: 1,
  pre_dug: true,
};

/** The walk-by scout: `mark_tunnel`, no weapons, no other job. Far enough
 *  south that nothing from the corridor, shed or first tunnel front ever
 *  sees it or is seen by it — its entire contribution is the mark-and-leave. */
export const SCOUT: UnitTypeJson = {
  id: 'd_scout',
  hull: { hp: 330, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.5 },
  abilities: ['mark_tunnel'],
  weapons: [],
};

/** The mole's reason to surface: parked 3 tiles east of the vent, inside
 *  hasTargetFrom's effective-range test, returning fire at whatever comes
 *  up. Its rifle carries no suppression stat so the mole is never pinned
 *  into stalling its volley on the surface — the cycle must actually cycle. */
export const VENT_GUARD: UnitTypeJson = {
  id: 'd_vent_guard',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'd_vg_rifle',
      type: 'small_arms',
      range_tiles: 8,
      effective_range_tiles: 6.4,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      rof_per_min: 300,
    },
  ],
};

/** What `runSetup` returns beside the sim: the ids `runDrive` addresses. */
/** The golden 1000-tick replay's own seed (determinism.test.ts pins its hash). */
export const RUN_SEED = 0x1310_0001;
/** The golden economy replay's own seed (determinism.test.ts pins its economy hash and runtime digest). */
export const ECONOMY_SEED = 0x0e_c0_0001;

export interface RunIds {
  west: number[];
  east: number[];
  holder: number;
  sapper: number;
  yahalom: number;
  scout: number;
  tunnel: number;
  shed: number;
}

/** A full little battle: walls, mixed forces, mid-run orders both sides. The world at tick 0. */
export function runSetup(
  seed: number,
  extraIdleUnit = false,
  humanHeld?: readonly [boolean, boolean]
): { sim: Sim; ids: RunIds } {
  const sim = new Sim({ seed, width: 48, height: 48, capacity: 128, ...(humanHeld ? { humanHeld } : {}) });
  const rifles = sim.addUnitType(RIFLES);
  const tank = sim.addUnitType(TANK);

  for (let y = 10; y < 38; y++) sim.setBlocked(24, y, true);
  for (let x = 20; x < 29; x++) sim.setCover(x, 20, 2);

  const west: number[] = [];
  for (let n = 0; n < 8; n++) west.push(sim.spawn(rifles, 0, fx.fromInt(4), fx.fromInt(8 + n * 3)));
  west.push(sim.spawn(tank, 0, fx.fromInt(2), fx.fromInt(24)));
  const east: number[] = [];
  for (let n = 0; n < 8; n++) east.push(sim.spawn(rifles, 1, fx.fromInt(44), fx.fromInt(8 + n * 3)));
  east.push(sim.spawn(tank, 1, fx.fromInt(46), fx.fromInt(24)));

  // Buildings, a garrison, and a demolition. None of this was in the replay
  // before: `addStructure`, `destroyStructure`, `recomputeFields`,
  // `stepGarrison`, `stepDemolition`, `selectStructureTarget` and the blocked-
  // goal snap in `applyCommands` were all outside the golden hash, which is how
  // two separate structure-path changes could be made without it moving. The
  // shed is off the y=24 corridor so it is a second front rather than a
  // rewrite of the first.
  const shedType = sim.addStructureType(SHED);
  const shed = sim.addStructure(shedType, [
    30 * sim.width + 34,
    30 * sim.width + 35,
    31 * sim.width + 34,
    31 * sim.width + 35,
  ]);
  const holder = sim.spawn(rifles, 1, fx.fromInt(33), fx.fromInt(30));
  // Close in: the man inside shoots out of the windows, and a sapper with no
  // weapons has to survive the approach to reach the wall. The tile it sets
  // its charges from is heavy cover, the foot of the wall: since a hit
  // suppresses (BOUNCE_SUPP_MULT, 2026-10-13) the window's rifle pinned it in
  // the open at tick 95, twenty ticks short of the charge, and a pinned sapper
  // sets nothing -- the shed stood and the structure paths below went unrun.
  sim.setCover(33, 32, 3);
  const sapper = sim.spawn(sim.addUnitType(SAPPER), 0, fx.fromInt(32), fx.fromInt(33));

  // The tunnel front. Nothing tunnel-shaped was in the replay before: every
  // subsystem task proved the golden hash UNCHANGED, which showed tunnel work
  // disturbed nothing else and said nothing about whether the tunnel code
  // itself replays deterministically. This corner puts stepDigging (progress,
  // trail stamping, the vent), trail detection up the tnContact ladder,
  // stepSurfacing's full up-volley-down cycle, stepTunnelCharge's held
  // station, and collapseTunnel's kill loop + splash inside the pin.
  const tunnel = sim.addTunnel(ROUTE);
  const diggerType = sim.addUnitType(DIGGER);
  const digger = sim.spawn(diggerType, 1, fx.from(3.5), fx.from(45.5));
  sim.assignDigger(tunnel, digger);
  const mole = sim.spawn(sim.addUnitType(MOLE), 1, fx.from(3.5), fx.from(45.5));
  sim.putInTunnel(mole, tunnel);
  const silent = sim.spawn(diggerType, 1, fx.from(3.5), fx.from(45.5));
  sim.putInTunnel(silent, tunnel);
  const yahalom = sim.spawn(sim.addUnitType(YAHALOM), 0, fx.from(6.5), fx.from(44.5));
  sim.spawn(sim.addUnitType(VENT_GUARD), 0, fx.from(12.5), fx.from(45.5));

  // The south-east corner: live visibility's decay half (see ROUTE_SE). The
  // scout spawns standing on the pre_dug route, marks it on the first tick,
  // and is ordered away below.
  sim.addTunnel(ROUTE_SE);
  const scout = sim.spawn(sim.addUnitType(SCOUT), 0, fx.from(41.5), fx.from(45.5));

  if (extraIdleUnit) sim.spawn(rifles, 0, fx.fromInt(1), fx.fromInt(1));
  return { sim, ids: { west, east, holder, sapper, yahalom, scout, tunnel, shed } };
}

/** The commands the flat replay queues at tick `t`; the caller ticks. */
export function runDrive(sim: Sim, t: number, ids: RunIds): void {
  const { west, east, holder, sapper, yahalom, scout, tunnel, shed } = ids;
  if (t === 10) sim.queueCommand({ kind: 'attackMove', ids: west, x: fx.fromInt(40), y: fx.fromInt(24) });
  if (t === 200) sim.queueCommand({ kind: 'attackMove', ids: east, x: fx.fromInt(8), y: fx.fromInt(24) });
  if (t === 600) sim.queueCommand({ kind: 'halt', ids: [west[0]] });
  // The defender goes inside, then the shed is brought down on top of him:
  // garrison entry, structure HP drain, collapse, and the flow-field
  // recompute a falling building triggers all land inside the replay.
  if (t === 30) sim.queueCommand({ kind: 'garrison', ids: [holder], structure: shed });
  if (t === 60) sim.queueCommand({ kind: 'demolish', ids: [sapper], structure: shed });
  // Ordered long after trail detection has identified the route (~tick 80;
  // the order would simply hold the clock at zero if it hadn't), and early
  // enough that the 160-tick charge brings the route down mid-run with
  // hundreds of ticks of post-collapse state still ahead of the pin.
  if (t === 500) sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel });
  // The scout walks west along the map's bottom edge, out of sight of the
  // route it just marked (beyond sight 8 of tile (38,45) once x < 30.5):
  // from there the identified contact is unwatched and decays live.
  if (t === 5) sim.queueCommand({ kind: 'move', ids: [scout], x: fx.from(27.5), y: fx.from(45.5) });
}

// A hill rather than a step, deliberately. A climb to a fixed height
// TELESCOPES — every monotone route from 0 up to 3 pays three levels wherever
// it crosses — so a plain escarpment prices every crossing alike and would
// prove nothing about routing. Ground that rises above its destination and
// comes back down does not telescope: over the top is eighty units of climb
// bought and all eighty thrown away again, and round the flank is none. The
// flank is 32 units of extra walking, so the hill is worth going round, and
// going round is a decision the sign has to be right to make.
export const RELIEF_W = 40;
export const RELIEF_H = 40;
export const RELIEF_SEED = 0x510_9e5;
export const RELIEF_TICKS = 900;

/** Every tile of the hill, x 16-24 by y 14-22. */
export const HILL: number[] = [];
/**
 * Its interior, one tile in on every side. Standing on one of these is the only
 * thing that means "went over the hill".
 *
 * The rim is excluded, and the reason is worth stating rather than quietly
 * dropping: the flanking routes hug the hill and then turn inward toward the
 * goal, and a diagonal step crosses one tile boundary a tick before the other,
 * so the assault clips the two northern corners — (16,14) and (24,14) — in
 * passing. Slope is a COST, not a wall. Nothing clamps a unit off high ground
 * the way the boulder mask clamps a vehicle, and nothing should: a unit may
 * stand on a hill, it simply will not route over one to save distance.
 */
export const HILL_CORE: number[] = [];
for (let y = 14; y <= 22; y++) {
  for (let x = 16; x <= 24; x++) {
    HILL.push(y * RELIEF_W + x);
    if (x >= 17 && x <= 23 && y >= 15 && y <= 21) HILL_CORE.push(y * RELIEF_W + x);
  }
}

/** The same little battle twice over: see `relief` in determinism.test.ts. The world at tick 0. */
export function reliefSetup(seed: number, raised: boolean, humanHeld?: readonly [boolean, boolean]): { sim: Sim; up: number[] } {
  const sim = new Sim({ seed, width: RELIEF_W, height: RELIEF_H, capacity: 32, ...(humanHeld ? { humanHeld } : {}) });
  if (raised) {
    for (const t of HILL) sim.setElevation(t % RELIEF_W, (t - (t % RELIEF_W)) / RELIEF_W, 8);
  }
  const rifles = sim.addUnitType(RIFLES);
  const tank = sim.addUnitType(TANK);

  // The assault, in the southern flat, on the hill's own centre line so that
  // going round is a detour for every one of them rather than the way they
  // were already walking.
  const up: number[] = [];
  for (const [x, y] of [[18, 34], [20, 34], [22, 34], [19, 36], [21, 36]] as const) {
    up.push(sim.spawn(rifles, 0, fx.fromInt(x), fx.fromInt(y)));
  }
  up.push(sim.spawn(tank, 0, fx.fromInt(20), fx.fromInt(37)));
  // The position they are sent at, held rather than manoeuvring: it is far
  // enough north that the crossing happens out of its sight, so the route is
  // chosen by the terrain and the fight starts once the hill is behind them.
  for (const x of [18, 20, 22]) sim.spawn(rifles, 1, fx.fromInt(x), fx.fromInt(8));
  sim.spawn(tank, 1, fx.fromInt(20), fx.fromInt(5));
  return { sim, up };
}

/** The command the relief replay queues at tick `t`; the caller ticks. */
export function reliefDrive(sim: Sim, t: number, up: number[]): void {
  if (t === 10) sim.queueCommand({ kind: 'attackMove', ids: up, x: fx.fromInt(20), y: fx.fromInt(6) });
}

export const ORDERS_SEED = 0x0b_e7_0011;

export interface OrdersIds {
  halted: number;
  plain: number;
  sweeper: number;
  far: number;
}

export function ordersSetup(seed: number, humanHeld?: readonly [boolean, boolean]): { sim: Sim; ids: OrdersIds } {
  const sim = new Sim({ seed, width: 48, height: 48, capacity: 16, ...(humanHeld ? { humanHeld } : {}) });
  const rifles = sim.addUnitType(RIFLES);
  const halted = sim.spawn(rifles, 0, fx.fromInt(4), fx.fromInt(10));
  const plain = sim.spawn(rifles, 0, fx.fromInt(4), fx.fromInt(24));
  const sweeper = sim.spawn(rifles, 0, fx.fromInt(4), fx.fromInt(38));
  const far = sim.spawn(rifles, 1, fx.fromInt(44), fx.fromInt(24));
  return { sim, ids: { halted, plain, sweeper, far } };
}

/** The commands the orders replay queues at tick `t`; the caller ticks. */
export function ordersDrive(sim: Sim, t: number, ids: OrdersIds): void {
  const { halted, plain, sweeper, far } = ids;
  if (t === 20) sim.identifyTo(0, far);
  if (t === 30) {
    sim.queueCommand({ kind: 'attackMove', ids: [halted], x: fx.fromInt(30), y: fx.fromInt(10), sweep: true });
    sim.queueCommand({ kind: 'attackMove', ids: [plain], x: fx.fromInt(14), y: fx.fromInt(24) });
    sim.queueCommand({ kind: 'attackMove', ids: [sweeper], x: fx.fromInt(14), y: fx.fromInt(38), sweep: true });
  }
  if (t === 130) sim.queueCommand({ kind: 'halt', ids: [halted] });
}

/** What the held-ground state passed through during a replay (F2 Task 7): every zone state
 *  and every cut cause seen on any tick, read through the runtime's own getters. The coverage
 *  assertions need a held, a contested and a cut state at least once each, so the pin is over
 *  states that actually occurred. */
export interface HeldGroundSeen {
  states: Set<number>;
  cuts: Set<string>;
}
export function noteHeldGround(rt: MissionRuntime, seen: HeldGroundSeen): void {
  for (const z of rt.incomeZones) {
    seen.states.add(z.state);
    if (z.cut !== null) seen.cuts.add(`${z.zone}:${z.cut}`);
  }
  const c = rt.convoyRoute;
  if (c !== null && c.cut !== null) seen.cuts.add(`convoy:${c.cut}`);
}

export const ECONOMY_TICKS = 2400; // two minutes

export const ECONOMY_EXTRA_BUILD_TICK = 1000;
// F3 Task 4 (GH-183): side 0's cap, and the one build it refuses. The force is the
// drone (population 0) and one squad (1); the builds at 400 and 800 bring it to 3,
// the extra truck at 1000 to 4 and the late truck at 2300 to 5 -- so 5 is the
// SMALLEST cap that refuses nothing the F1 replay already did, and the plan's 12
// would never bind. The refused build is a 10-population `heavy_convoy` asked at
// 1200 (it would fit under no cap that leaves the rest standing), so a cap of 5, 6
// or 7 all refuse it and the cap is the ONLY difference between those runs.
export const ECONOMY_POP_CAP = 5;
export const ECONOMY_REFUSED_BUILD_TICK = 1200;
// Still building when the replay ends (15 s = 300 ticks to deliver), so the
// pinned hash carries a non-empty queue and not just a purse.
export const ECONOMY_LATE_BUILD_TICK = 2300;
// F4 Task 6 (GH-183, G3 Q3): the second camp's line (line 1) builds one truck at 1500, a raider
// contests the camp's door from RAIDER_IN to RAIDER_OUT (ticks 1510 to 1750; it needs time to
// walk in, so the line freezes for about 200 contested ticks), and the truck is cancelled at 1800 still in progress (a refund of its 100). Line 0
// carries a rally point at (14, 30) from tick 100: the first squad (ready 700) walks to it.
export const ECONOMY_LINE_TRUCK_TICK = 1500;
export const ECONOMY_RAIDER_IN_TICK = 1510;
export const ECONOMY_RAIDER_OUT_TICK = 1750;
export const ECONOMY_CANCEL_TICK = 1800;
export const ECONOMY_RALLY_TILE_X = 14;

// The economy types mirror the shipped data (data/units/kdf/inf_squad.json, recon_drone,
// data/units/enemy/militia_cell.json) in the fields that decide behaviour: an
// in-test type with no `role` derives wheeled and never braces (halt to fire,
// 6 Oct), so the squads carry `role: 'infantry'`.
export const ECO_SQUAD: UnitTypeJson = {
  id: 'inf_squad',
  role: 'infantry',
  abilities: ['garrison', 'mark_target'],
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, crew: 8, suppression_resistance: 0.5 },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6, firing_signature_mult: 3.0 },
  weapons: [
    {
      id: 'rifles',
      type: 'small_arms',
      range_tiles: 8,
      effective_range_tiles: 6.4,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      suppression: 50,
      rof_per_min: 300,
    },
  ],
};

export const ECO_DRONE: UnitTypeJson = {
  id: 'recon_drone',
  role: 'drone',
  abilities: ['mark_target', 'mark_tunnel'],
  hull: { hp: 120, armor: { front: 0, side: 0, rear: 0 }, crew: 0, suppression_resistance: 1.0 },
  mobility: { speed_tiles_s: 2.2, turn_rate_deg_s: 180, domain: 'air' },
  sensors: { optics: 2.0, sight_tiles: 16, signature: 0.3, firing_signature_mult: 1.0 },
  // The shipped drone takes no population (F3 Task 4: population now decides behaviour).
  cost: { population: 0 },
};

export const ECO_MILITIA: UnitTypeJson = {
  id: 'militia_cell',
  role: 'infantry',
  abilities: ['garrison'],
  hull: { hp: 360, armor: { front: 10, side: 10, rear: 10 }, crew: 6, suppression_resistance: 0.4 },
  mobility: { speed_tiles_s: 0.95 },
  sensors: { optics: 0.85, sight_tiles: 7, signature: 0.45, firing_signature_mult: 3.5 },
  weapons: [
    {
      id: 'rifles',
      type: 'small_arms',
      range_tiles: 7,
      effective_range_tiles: 5.5,
      accuracy: 0.5,
      penetration: 8,
      damage: 14,
      suppression: 45,
      rof_per_min: 320,
    },
  ],
};

/** The extra build of the "covers the purse" property: a wheeled, unarmed hull
 *  that earns no intel (neither a drone nor a marker), so buying one moves the
 *  LOGISTICS purse and nothing else once its queue entry has been delivered. */
export const ECO_TRUCK: UnitTypeJson = {
  id: 'supply_truck',
  hull: { hp: 300, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 6, signature: 0.7 },
};

export const ECO_CAMP = {
  id: 'camp',
  name: 'Field Camp',
  hp_per_tile: 300,
  garrison_slots: 3,
  rubble_cover: 2,
  produces_for: 0,
};

export const ECO_CAMP_S1 = { ...ECO_CAMP, id: 'camp_s1', name: 'Enemy Camp', produces_for: 1 };

export const ECO_MISSION: MissionJson = {
  id: 'economy_replay',
  map: { file: 'beit_sahwan_outskirts', player_start: [6, 23] },
  ledger: { requires: [], produces: [] },
  // F4 Task 6: a second camp, so there are two production lines. It sits at the south-west
  // corner, clear of `depot` (y 21-25), `crossroads` (x 10-23, y 18-29) and the convoy's route
  // (from (21, 26) to the first camp), so F2's zone and cut words are not moved for a second reason.
  structures: [
    { type: 'camp', at: [6, 30], size: [2, 2] },
    { type: 'camp', at: [2, 40], size: [2, 2] },
  ],
  // F2 Task 7: two income zones and a live convoy. `depot` is held by the starting squad from
  // the first tick; `crossroads` holds both militia (side 1's) until the attack-move at 1150
  // contests it; the convoy enters beside the south militia, so it is cut from the start.
  resources: {
    logistics_start: 400,
    logistics_rate_per_min: 120,
    intel_start: 0,
    income_zones: [
      { zone: 'depot', rate_per_min: 30 },
      { zone: 'crossroads', rate_per_min: 45 },
    ],
    supply_corridor: true,
    supply_entry: 'convoy_entry',
  },
  // No time_limit_s: the fixture must not withdraw.
  objectives: [
    { id: 'hold_assembly', type: 'hold_for', primary: true, target: 'assembly', seconds: 600 },
    { id: 'clear', type: 'destroy_all', primary: false },
  ],
  starting_force: [
    { unit: 'recon_drone', count: 1, at: [8, 22] },
    { unit: 'inf_squad', count: 1, at: [4, 23] },
  ],
  enemy: {
    faction: 'ashwar',
    garrison: [
      { unit: 'militia_cell', count: 1, at: [20, 22], group: 'north', stance: { kind: 'hold_position' } },
      { unit: 'militia_cell', count: 1, at: [20, 26], group: 'south', stance: { kind: 'hold_position' } },
      // F4 Task 6: the raider. Last, so the others keep their entity ids. It walks to the second
      // camp's door from ECONOMY_RAIDER_IN_TICK until ECONOMY_RAIDER_OUT_TICK and is then removed (debugKill), which keeps the
      // secondary `clear` completable by the force alone.
      { unit: 'militia_cell', count: 1, at: [9, 41], group: 'raider', stance: { kind: 'hold_position' } },
    ],
  },
};

export interface EconomyRun {
  sim: Sim;
  rt: MissionRuntime;
  built: number;
  identified: number;
  secondaryDone: boolean;
  /** What `buildBlockedReason('heavy_convoy')` read the tick the refused build was asked. */
  refusal: string | null;
  refusedByCap: boolean;
  /** `requestBuild('heavy_convoy')`'s answer, and the purse either side of it. */
  refusedAnswer: boolean;
  purseBeforeRefusal: number;
  purseAfterRefusal: number;
  seen: HeldGroundSeen;
  /** F4 Task 6: ticks line 1 was contested, ticks it was contested AND made no progress, the tick
   *  the first squad came within a tile of the rally point (-1 never), and what the cancel paid back. */
  contestedTicks: number;
  frozenTicks: number;
  rallyArrivedTick: number;
  cancelAnswer: boolean;
  refund: number;
}

/** The economy replay's world: the sim, the `MissionRuntime` as the replay builds them, the
 *  record `economyReplay` returns, and the closures its driver needs. */
export interface EconomyWorld {
  sim: Sim;
  rt: MissionRuntime;
  run: EconomyRun;
  extraBuild: boolean;
  rallyTileX: number;
  raider: number;
  /** Line 1's progress on the previous tick (-1 before the first). */
  prevProgress: number;
  build: (u: string, line?: number) => boolean;
  setRally: (line: number, x: number, y: number) => boolean;
  cancelBuild: (line: number, index: number) => boolean;
  living: (type: string) => number[];
}

/** `extraBuild` buys one `supply_truck` at ECONOMY_EXTRA_BUILD_TICK: delivered
 *  (15 s) long before the end, so it differs from the base run in the purse
 *  alone. The world at tick 0, runtime started. */
export function economySetup(
  seed: number,
  extraBuild = false,
  popCap: number | null = ECONOMY_POP_CAP,
  via: 'direct' | 'command' = 'direct',
  rallyTileX: number = ECONOMY_RALLY_TILE_X,
): EconomyWorld {
  const sim = new Sim({ seed, width: 48, height: 48, capacity: 32 });
  const ids = new Map<string, number>();
  for (const t of [ECO_SQUAD, ECO_DRONE, ECO_MILITIA, ECO_TRUCK]) ids.set(t.id, sim.addUnitType(t));
  sim.addStructureType(ECO_CAMP);
  const info: Record<string, { logistics: number; buildTimeS: number; population: number }> = {
    // The shipped squad costs 292; at 120/min a second one is out of reach at
    // tick 800 (see the note in the commit), so the fixture prices it at 180.
    inf_squad: { logistics: 180, buildTimeS: 15, population: 1 },
    supply_truck: { logistics: 100, buildTimeS: 15, population: 1 },
    // Never fielded: the cap refuses it (it needs no unit type, nothing spawns).
    heavy_convoy: { logistics: 100, buildTimeS: 15, population: 10 },
  };
  const rt = new MissionRuntime(sim, ECO_MISSION, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: { convoy_entry: [21, 26] },
    zones: { assembly: [2, 20, 10, 26], depot: [2, 21, 5, 5], crossroads: [10, 18, 14, 12] },
    unitInfo: (u) => info[u] ?? null,
    popCaps: [popCap, null],
  });
  rt.start();
  const run: EconomyRun = {
    sim,
    rt,
    built: 0,
    identified: 0,
    secondaryDone: false,
    refusal: null,
    refusedByCap: false,
    refusedAnswer: true,
    purseBeforeRefusal: 0,
    purseAfterRefusal: 0,
    seen: { states: new Set(), cuts: new Set() },
    contestedTicks: 0,
    frozenTicks: 0,
    rallyArrivedTick: -1,
    cancelAnswer: false,
    refund: 0,
  };
  // N2: `command` routes every purchase through `queueCommand` and drains it at
  // the call site, so the order of commands inside the sim queue is the direct
  // path's own.
  const build = (u: string, line?: number): boolean => {
    if (via === 'direct') return rt.requestBuild(u, line);
    sim.queueCommand({ kind: 'build', side: 0, unit: u, line });
    return rt.applyQueued() === 1;
  };
  const setRally = (line: number, x: number, y: number): boolean => {
    if (via === 'direct') return rt.setRally(line, fx.fromInt(x), fx.fromInt(y));
    sim.queueCommand({ kind: 'setRally', side: 0, line, x: fx.fromInt(x), y: fx.fromInt(y) });
    return rt.applyQueued() === 1;
  };
  const cancelBuild = (line: number, index: number): boolean => {
    if (via === 'direct') return rt.cancelBuild(line, index);
    sim.queueCommand({ kind: 'cancelBuild', side: 0, line, index });
    return rt.applyQueued() === 1;
  };
  // The raider is the last enemy placed.
  let raider = -1;
  for (let id = 0; id < sim.entityCount; id++) if (sim.state.side[id] === 1) raider = id;
  const living = (type: string): number[] => {
    const out: number[] = [];
    for (let id = 0; id < sim.entityCount; id++) {
      if (sim.state.side[id] === 0 && sim.state.alive[id] === 1 && sim.unitTypes[sim.state.typeIdx[id]].id === type) {
        out.push(id);
      }
    }
    return out;
  };
  return { sim, rt, run, extraBuild, rallyTileX, raider, prevProgress: -1, build, setRally, cancelBuild, living };
}

/** The commands the economy replay queues at tick `t`, before the sim ticks. */
export function economyDrive(w: EconomyWorld, t: number): void {
  const { sim, rt, run, extraBuild, rallyTileX, raider, build, setRally, cancelBuild, living } = w;
  if (t === 100) setRally(0, rallyTileX, 30);
  if (t === 400 || t === 800) build('inf_squad', 0);
  if (t === ECONOMY_LINE_TRUCK_TICK) build('supply_truck', 1);
  if (t === ECONOMY_RAIDER_IN_TICK) sim.queueCommand({ kind: 'move', ids: [raider], x: fx.fromInt(6), y: fx.fromInt(40) });
  if (t === ECONOMY_RAIDER_OUT_TICK) sim.debugKill(raider);
  if (t === ECONOMY_CANCEL_TICK) {
    const before = rt.logistics;
    run.cancelAnswer = cancelBuild(1, -1);
    run.refund = rt.logistics - before;
  }
  if (extraBuild && t === ECONOMY_EXTRA_BUILD_TICK) build('supply_truck', 0);
  if (t === ECONOMY_LATE_BUILD_TICK) build('supply_truck');
  if (t === ECONOMY_REFUSED_BUILD_TICK) {
    run.refusal = rt.buildBlockedReason('heavy_convoy');
    run.refusedByCap = rt.popCapped('heavy_convoy');
    run.purseBeforeRefusal = rt.logistics;
    run.refusedAnswer = build('heavy_convoy');
    run.purseAfterRefusal = rt.logistics;
  }
  // The lead unit goes forward to a post that sees both garrison groups (a
  // drone's sight is 16), and the starting squad stays where it stands, a
  // marker at rest. A plain move: it holds fire on the way (6 Oct).
  if (t === 5) sim.queueCommand({ kind: 'move', ids: living('recon_drone'), x: fx.fromInt(12), y: fx.fromInt(24) });
  // Once both reinforcements have landed (ready at ticks 700 and 1100) the
  // whole force attack-moves in together. `sweep` so that a squad which
  // arrives with a contact still remembered walks on to it (6 Oct, #402).
  if (t === 1150) {
    sim.queueCommand({ kind: 'attackMove', ids: living('inf_squad'), x: fx.fromInt(19), y: fx.fromInt(24), sweep: true });
  }
}

/** One tick of the economy replay: the sim, the runtime step and the replay's observers. Call after `economyDrive`. */
export function economyAdvance(w: EconomyWorld, t: number): void {
  const { sim, rt, run, rallyTileX, living } = w;
  const simEvents = sim.tick();
  for (const e of simEvents) {
    if (e.kind === 'contact' && e.side === 0 && e.level === 'identified') run.identified++;
  }
  for (const e of rt.step(simEvents)) {
    if (e.kind === 'built') run.built++;
  }
  noteHeldGround(rt, run.seen);
  const l1 = rt.productionLines(0)[1];
  if (l1.contested) {
    run.contestedTicks++;
    if (l1.progress === w.prevProgress) run.frozenTicks++;
  }
  w.prevProgress = l1.progress;
  if (run.rallyArrivedTick < 0 && t < 1150) {
    for (const id of living('inf_squad')) {
      const dx = sim.state.posX[id] - fx.fromInt(rallyTileX);
      const dy = sim.state.posY[id] - fx.fromInt(30);
      if (id !== 1 && fx.mul(dx, dx) + fx.mul(dy, dy) <= fx.fromInt(1)) run.rallyArrivedTick = t;
    }
  }
}

export const WW_SQUAD: UnitTypeJson = {
  ...RIFLES,
  id: 'ww_squad',
  abilities: [],
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, figures: 4, wounds: { wound_chance: 0.6, bleed_s: 8, type: 'ww_wounded' } },
};
export const WW_WOUNDED: UnitTypeJson = {
  id: 'ww_wounded',
  role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12 },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};
export const WW_MEDIC: UnitTypeJson = {
  id: 'ww_medic',
  role: 'infantry',
  abilities: ['rescue'],
  hull: { hp: 200, armor: { front: 10, side: 10, rear: 10 }, figures: 2, transport_slots: 1, can_carry: ['wounded'] },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  rescue: { radius_tiles: 10, treat_s: 3, drag_speed_mult: 0.5, carry_speed_mult: 0.75 },
};
/** The enemy's heavy section: a rifle squad hitting hard enough to drop men quickly. */
export const WW_SHOOTER: UnitTypeJson = {
  ...RIFLES,
  id: 'ww_shooter',
  abilities: [],
  weapons: [{ id: 'ww_mg', type: 'small_arms', range_tiles: 8, accuracy: 0.6, penetration: 8, damage: 45, suppression: 20, rof_per_min: 300 }],
};
export const WW_POST = { id: 'ww_aid', hp_per_tile: 200, aid: { admit_radius: 2, treat_s: 5, dispatch_radius: 12 } };
export const WW_SEED = 0x7070_0707;

export function woundedSetup(seed: number, squad: UnitTypeJson = WW_SQUAD): Sim {
  const W = 24;
  const sim = new Sim({ seed, width: W, height: 12, capacity: 64 });
  const sq = sim.addUnitType(squad);
  sim.addUnitType(WW_WOUNDED);
  const med = sim.addUnitType(WW_MEDIC);
  const shooter = sim.addUnitType(WW_SHOOTER);
  sim.addStructure(sim.addStructureType(WW_POST), [5 * W + 2, 5 * W + 3, 6 * W + 2, 6 * W + 3], { owner: 0 });
  sim.spawn(sq, 0, fx.from(7.5), fx.from(4.5));
  sim.spawn(sq, 0, fx.from(7.5), fx.from(7.5));
  sim.spawn(med, 0, fx.from(4.5), fx.from(6.5));
  sim.spawn(sq, 1, fx.from(13.5), fx.from(5.5));
  sim.spawn(shooter, 1, fx.from(13.5), fx.from(6.5));
  sim.spawn(shooter, 1, fx.from(13.5), fx.from(4.5));
  return sim;
}
