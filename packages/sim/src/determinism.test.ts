import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';

// The canary for invariants 2 and 3 (CLAUDE.md): replay 1000 ticks from a
// fixed seed and assert the state hash is stable. Must pass before any
// commit touching @lions/sim. A failure here is never cosmetic.

const RIFLES: UnitTypeJson = {
  id: 'd_rifles',
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

const TANK: UnitTypeJson = {
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
const SAPPER: UnitTypeJson = {
  id: 'd_sapper',
  role: 'engineer',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.4 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.5 },
  abilities: ['demolish'],
  demolition_time_s: 2.0,
  weapons: [],
};

const SHED = { id: 'd_shed', name: 'Shed', hp_per_tile: 100, garrison_slots: 2, rubble_cover: 1 };

// --- the tunnel front -------------------------------------------------------
// A third front in the south-west corner, far enough from the corridor
// (x=24) and the shed (34,30) that neither existing fight changes: the
// nearest tunnel-front unit is ~9 tiles outside the sight of anything that
// passes, and per-entity PRNG streams keep everyone else's rolls untouched.

/** Six straight tiles, mouth to vent. At 1 tile/s the vent opens at tick
 *  120, leaving ~880 ticks for surfacing cycles and the collapse. */
const ROUTE = { id: 'd_route', points: [[3, 45], [9, 45]] as const, dig_tiles_per_s: 1 };

/** Digs, unarmed — digger_crew's numbers. Spawned twice: once assigned to
 *  the route on the surface, once put below with no weapon, so stepSurfacing
 *  never brings it up and the collapse kill loop has someone to catch. */
const DIGGER: UnitTypeJson = {
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
const MOLE: UnitTypeJson = {
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

/** Charge team — yahalom_squad's hull and `tunnel_charge`, minus the
 *  carbines: it stands 3 tiles from a digger it must not shoot (a dead
 *  digger means no vent and no surfacing). Sighted, so it identifies the
 *  route through ordinary trail detection — the same ladder a player's
 *  units use — rather than a debug hand-over. */
const YAHALOM: UnitTypeJson = {
  id: 'd_yahalom',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.85 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.55 },
  abilities: ['tunnel_charge'],
  tunnel_charge_time_s: 8,
  weapons: [],
};

/** The mole's reason to surface: parked 3 tiles east of the vent, inside
 *  hasTargetFrom's effective-range test, returning fire at whatever comes
 *  up. Its rifle carries no suppression stat so the mole is never pinned
 *  into stalling its volley on the surface — the cycle must actually cycle. */
const VENT_GUARD: UnitTypeJson = {
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

/** A full little battle: walls, mixed forces, mid-run orders both sides. */
function run(seed: number, ticks: number, extraIdleUnit = false, onEvent?: (e: SimEvent) => void): Sim {
  const sim = new Sim({ seed, width: 48, height: 48, capacity: 128 });
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
  // weapons has to survive the approach to reach the wall.
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

  if (extraIdleUnit) sim.spawn(rifles, 0, fx.fromInt(1), fx.fromInt(1));

  for (let t = 0; t < ticks; t++) {
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
    const events = sim.tick();
    if (onEvent) for (const e of events) onEvent(e);
  }
  return sim;
}

describe('determinism (1000-tick replay)', () => {
  it('two independent replays from the same seed produce an identical state hash', () => {
    const a = run(0x1310_0001, 1000);
    const b = run(0x1310_0001, 1000);
    expect(a.hash()).toBe(b.hash());
    // Golden pin. This value must be identical on every machine and engine —
    // that is the whole claim of invariants 2 and 3. It changes ONLY when the
    // model deliberately changes (sim code or tuning constants); update it by
    // reading the new value from this failure, in the same commit, on purpose.
    // Updated for carriers: passenger, boarding and seat columns are state.
    // Updated for the `demolish` order: the designated structure is per-entity
    // state and joins the hash. No unit's *behaviour* moved here — every entry
    // is -1 across this replay, which has no demolisher — but the column is
    // hashed, so the pin does.
    //
    // Updated again to put buildings in the replay at all. That earlier note is
    // the admission: the pin covered the demolish *column* while the replay had
    // nothing to demolish, so `addStructure`, `destroyStructure`,
    // `recomputeFields`, `stepGarrison`, `stepDemolition`,
    // `selectStructureTarget` and the blocked-goal snap in `applyCommands` were
    // all outside it. Two separate structure-path changes were made without this
    // number moving, and neither was wrong — but neither was measured here
    // either. The shed, its garrison and its demolition close that.
    //
    // Updated to put a tunnel in the replay, the same move a subsystem later.
    // Sixteen tasks of tunnel work each proved this number UNCHANGED — correct,
    // because the replay had no tunnels, and also the admission: the entire
    // subsystem (stepDigging, trail stamping and detection, stepSurfacing,
    // stepTunnelCharge, collapseTunnel) sat outside the canary. The south-west
    // corner now digs a route to an open vent, cycles a fighter up and down
    // through its volleys, and brings the route down on the occupant still
    // below; hash() gained the tunnel columns in the same change. The hash
    // covers the tunnel subsystem for the first time, so it moves.
    //
    // Updated once more, two reasons in one deliberate move. First, hash()
    // now folds EVERY mutable tunnel column — homeTunnel, surfaceTicks,
    // volleyLeft, chargeOrder, chargeTicks, tnContact, tnContactState joined
    // the original five — because the contact pair gates chargeTunnel and
    // freezes once identified, so a sub-threshold divergence could sit
    // dormant past the pin. Second, stepTunnelCharge's in-range stop moved
    // above its displaced gate (stepDemolition's ordering, and its wall-grind
    // reasoning), which starts this replay's charge 23 ticks sooner: the
    // collapse lands at tick 660 instead of 683. Behaviour and coverage both
    // changed on purpose; the pin moves with them.
    expect(a.hash()).toBe(3003042083);
  });

  it('the replay actually exercises the structure paths', () => {
    // A hash that covers the structure columns but never puts a building
    // through them is coverage in name only. This asserts the replay really
    // does garrison a defender and then bring the shed down on him, so nobody
    // can quietly delete the shed and leave the pin looking healthy.
    // Mid-replay: the defender is inside, so `stepGarrison` ran and the shed
    // is occupied. Aggregate rather than an entity id, so spawn order can move
    // without silently turning this into a no-op.
    const mid = run(0x1310_0001, 90);
    expect(mid.structureCount).toBe(1);
    expect(mid.structures.occupants[0]).toBe(1);
    expect(mid.structures.alive[0]).toBe(1);

    // End of replay: the shed came down on him, so the damage, collapse and
    // flow-field recompute ran too.
    const end = run(0x1310_0001, 1000);
    expect(end.structures.alive[0]).toBe(0);
    expect(end.structures.hp[0]).toBeLessThanOrEqual(0);
  });

  it('the replay actually exercises the tunnel paths', () => {
    // Same contract as the structure test above: a hash that covers the
    // tunnel columns while no route ever advances, vents, surfaces anyone or
    // collapses is coverage in name only. A later refactor that quietly
    // stopped exercising these paths would leave the pin looking healthy —
    // this is the test that refuses that. Aggregates and event flags rather
    // than entity ids, so spawn order can move without a silent no-op.
    let ventOpened = false;
    let surfacedCount = 0;
    let submergedCount = 0;
    const collapses: { tick: number; by: number }[] = [];
    const destroyed: { tick: number; by: number }[] = [];
    const end = run(0x1310_0001, 1000, false, (e) => {
      if (e.kind === 'ventOpened') ventOpened = true;
      if (e.kind === 'surfaced') surfacedCount++;
      if (e.kind === 'submerged') submergedCount++;
      if (e.kind === 'tunnelCollapsed') collapses.push({ tick: e.tick, by: e.by });
      if (e.kind === 'destroyed') destroyed.push({ tick: e.tick, by: e.by });
    });
    // The collapse's kill loop pushes its `destroyed` events BEFORE the
    // `tunnelCollapsed` event on the same tick, so this is matched after the
    // run, keyed on the collapse's own kill credit: the charge team is
    // unarmed and twenty tiles from the other fronts, so a death credited to
    // it on the collapse tick can only be the kill loop.
    const killedByCollapse = collapses.length === 0
      ? 0
      : destroyed.filter((d) => d.tick === collapses[0].tick && d.by === collapses[0].by).length;

    // Mid-run: the route is genuinely being dug — progress has climbed off
    // zero but not reached the end, the vent is still shut, and both
    // occupants are below. Present-but-idle (or pre_dug) would fail here.
    const mid = run(0x1310_0001, 60);
    expect(mid.tunnelCount).toBe(1);
    expect(mid.tnProgress[0]).toBeGreaterThan(0);
    expect(mid.tnProgress[0]).toBeLessThan(mid.tnLength[0]);
    expect(mid.tnVentOpen[0]).toBe(0);
    expect(mid.tnOccupants[0]).toBe(2);

    // Across the full run: the head reached the end and the vent opened, the
    // mole came up at it, spent its volley and went back down — the whole
    // stepSurfacing threshold cycle — and the charge team brought the route
    // down on the unarmed occupant still below (the collapse kill loop
    // killed someone on the collapse tick).
    expect(ventOpened).toBe(true);
    expect(surfacedCount).toBeGreaterThan(1); // cycles, not one pop-up
    expect(submergedCount).toBeGreaterThan(0);
    expect(collapses).toHaveLength(1);
    // The surfaced-survivor branch, pinned: exactly ONE death in the collapse
    // (the unarmed occupant below — were the mole below too, this would be
    // 2), and one more surfacing than submerging (the mole was up when the
    // route came down and never went back — collapseTunnel cleared its
    // homeTunnel). If timing drift ever puts the mole below at the collapse
    // instead, these fail loudly rather than silently dropping the branch.
    expect(killedByCollapse).toBe(1);
    expect(surfacedCount).toBe(submergedCount + 1);
    expect(end.tnProgress[0]).toBe(end.tnLength[0]);
    expect(end.tnAlive[0]).toBe(0);
    expect(end.tnOccupants[0]).toBe(0);
  });

  it('a different seed produces a different hash', () => {
    const a = run(1, 1000);
    const b = run(2, 1000);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('hash evolves over time (the replay actually simulates)', () => {
    const a = run(7, 250);
    const b = run(7, 1000);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('an extra idle entity does not perturb other units (per-entity PRNG streams)', () => {
    const a = run(0xbeef, 1000);
    const b = run(0xbeef, 1000, true);
    for (let i = 0; i < 18; i++) {
      expect(b.state.posX[i], `posX of entity ${i}`).toBe(a.state.posX[i]);
      expect(b.state.posY[i], `posY of entity ${i}`).toBe(a.state.posY[i]);
      expect(b.state.hp[i], `hp of entity ${i}`).toBe(a.state.hp[i]);
      expect(b.state.suppression[i], `suppression of entity ${i}`).toBe(a.state.suppression[i]);
    }
  });
});
