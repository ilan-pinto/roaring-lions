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

/** Charge team — yahalom_squad's hull, `tunnel_charge` AND `mark_tunnel`
 *  (production parity), minus the carbines: it stands 3 tiles from a digger
 *  it must not shoot (a dead digger means no vent and no surfacing). Under
 *  live visibility the mark is load-bearing: its own sight line to the
 *  route is what holds the route identified for side 0 from first sight to
 *  collapse — the hold half of the live rule, inside the pin. (Side 1 still
 *  identifies the same route through ordinary trail accrual — the digger
 *  watches its own spoil — so the ladder path stays covered too.) */
const YAHALOM: UnitTypeJson = {
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
const ROUTE_SE = {
  id: 'd_route_se',
  points: [[38, 45], [44, 45]] as const,
  dig_tiles_per_s: 1,
  pre_dug: true,
};

/** The walk-by scout: `mark_tunnel`, no weapons, no other job. Far enough
 *  south that nothing from the corridor, shed or first tunnel front ever
 *  sees it or is seen by it — its entire contribution is the mark-and-leave. */
const SCOUT: UnitTypeJson = {
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

  // The south-east corner: live visibility's decay half (see ROUTE_SE). The
  // scout spawns standing on the pre_dug route, marks it on the first tick,
  // and is ordered away below.
  sim.addTunnel(ROUTE_SE);
  const scout = sim.spawn(sim.addUnitType(SCOUT), 0, fx.from(41.5), fx.from(45.5));

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
    // The scout walks west along the map's bottom edge, out of sight of the
    // route it just marked (beyond sight 8 of tile (38,45) once x < 30.5):
    // from there the identified contact is unwatched and decays live.
    if (t === 5) sim.queueCommand({ kind: 'move', ids: [scout], x: fx.from(27.5), y: fx.from(45.5) });
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
    //
    // Updated for live-gated tunnel visibility (playtest reversal of the
    // identified-persistence rule): an identified route now stays identified
    // only while something is currently sensing it — a `mark_tunnel` sight
    // line, or spoil in view — and decays down the ladder once nothing is.
    // The old replay never ran the changed write (its one route was watched
    // continuously until its collapse), so the front grew: the charge team
    // carries mark_tunnel (production parity) and holds its own route to
    // collapse, and a walk-by scout marks a new pre_dug south-east route and
    // abandons it, leaving that contact to decay through `lost` inside the
    // pin. tnContact now moves every unwatched tick where the latch froze
    // it; the pin moves with the rule.
    // Moved for the elevation milestone (E1): Sim.elevation joined the hash.
    // Every shipped map is flat, so no OUTCOME changed -- the hash covers one
    // more array whose every value is zero. `pnpm balance` and `pnpm playtest`
    // are NOT the evidence for that: `pnpm balance` builds its scenarios
    // directly and never calls parseMap or applyTerrain, and while `pnpm
    // playtest` does call applyTerrain, every shipped map is flat, so
    // `elevation[t] !== 0` is false everywhere and setElevation is never
    // invoked either way -- neither run can falsify an elevation leak. The
    // actual evidence is a static check -- `elevation` appears in sim.ts
    // exactly four times (the field, its two constructor/hash sites, and
    // setElevation) and nothing reads it for behaviour -- plus, now, the
    // differential test in `elevation.test.ts`, which runs one short replay
    // flat and once with every tile raised and asserts every observable but
    // the hash (positions, HP, alive counts, the event stream) is identical.
    //
    // Moved for body-aimed hulls: a unit whose facing cannot change an outcome
    // now turns onto what it is shooting at while MOVING, instead of keeping
    // its facing on the line of march (`UnitType.bodyAimed`, `Sim.aimHullAt`).
    // Infantry were firing sideways and backwards on the move, because they
    // have no turret and the hull was the only thing pointing anywhere.
    // Vehicles are untouched — an asymmetric front plate is exactly what the
    // licence tests for, so the hull still drives where it points and the gun
    // traverses.
    //
    // No OUTCOME changed, and that is measured rather than argued. Running this
    // replay before and after and diffing EVERY observable — all 21 state
    // columns, all 11 structure columns, and all 2036 events serialised in
    // order — leaves exactly one difference: `facing`, on 3 of the 26 entities
    // (6: 0 -> 13, 12: 32768 -> 32800, 14: 40960 -> 34515), all three of them
    // riflemen. posX, posY, hp, suppression, alive, curTarget, the structures
    // and the whole event stream are byte-identical, and the event stream
    // carries `arc`, `effectiveArmor`, `pPen` and the penetration `roll` on
    // every impact, so an identical stream IS the statement that no armour arc
    // moved. `pnpm balance` agrees: all five §5.7 targets land on the same
    // numbers, urban 1:1=0% 2:1=15% 3:1=95% 4:1=100% included.
    //
    // The reason it is outcome-neutral is structural, not lucky. `resolveHit`
    // returns for soft targets BEFORE it ever reads facing to pick the
    // arc, and `bodyAimed` requires `isSoft` — so a unit that gained the
    // licence is a unit whose facing is never read. Isotropy alone would not
    // have been enough: the obliquity bonus scales armour inside the front arc,
    // so an isotropic-but-armoured hull would still trade damage for its angle.
    // The hash covers a facing column that now records where infantry are
    // actually looking; it moves, and nothing else does.
    //
    // NOT moved, deliberately, by the bound that followed: a hull that is
    // actually walking may now point at most AIM_OFF_HEADING_MAX (45°) off its
    // direction of travel, because there is one movement clip and it is a
    // forward walk — turning the whole way onto a target abeam made infantry
    // moonwalk. The bound is live in this replay (it engages on four ticks, and
    // entity 18's facing differs from the unbounded build on ticks 30-37), and
    // it leaves NO trace at tick 1000: the same full observable diff as above —
    // 21 state columns, 11 structure columns, all 2036 events — is byte-
    // identical, hash included, because facing re-converges once the hull stops
    // or its heading catches up, and nothing reads a soft unit's facing on the
    // way. So this number is unchanged on purpose. It is also the admission
    // that this replay does not pin the bound: `facing.test.ts` does.
    expect(a.hash()).toBe(3160666129);
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
    const surfacers = new Set<number>();
    const collapses: { tick: number; by: number }[] = [];
    const destroyed: { tick: number; by: number }[] = [];
    const contacts: { side: number; tunnel: number; level: string }[] = [];
    const end = run(0x1310_0001, 1000, false, (e) => {
      if (e.kind === 'ventOpened') ventOpened = true;
      if (e.kind === 'surfaced') {
        surfacedCount++;
        surfacers.add(e.entity);
      }
      if (e.kind === 'submerged') submergedCount++;
      if (e.kind === 'tunnelCollapsed') collapses.push({ tick: e.tick, by: e.by });
      if (e.kind === 'destroyed') destroyed.push({ tick: e.tick, by: e.by });
      if (e.kind === 'tunnelContact') contacts.push({ side: e.side, tunnel: e.tunnel, level: e.level });
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
    expect(mid.tunnelCount).toBe(2);
    expect(mid.tnProgress[0]).toBeGreaterThan(0);
    expect(mid.tnProgress[0]).toBeLessThan(mid.tnLength[0]);
    expect(mid.tnVentOpen[0]).toBe(0);
    expect(mid.tnOccupants[0]).toBe(2);
    // The south-east route really is pre_dug and empty: vent open from load,
    // nothing below, nothing digging — its only job is the visibility decay.
    expect(mid.tnVentOpen[1]).toBe(1);
    expect(mid.tnOccupants[1]).toBe(0);

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
    // ...and the surfacer itself is alive at the end. Without this, a mole
    // shot dead ON the surface before the collapse would satisfy both checks
    // above by accident (surfaced still leads by one, the collapse still
    // kills exactly the one below). Ids come from the events, not spawn order.
    expect(surfacers.size).toBeGreaterThan(0);
    for (const s of surfacers) expect(end.state.alive[s], `surfacer ${s} alive at end`).toBe(1);
    expect(end.tnProgress[0]).toBe(end.tnLength[0]);
    expect(end.tnAlive[0]).toBe(0);
    expect(end.tnOccupants[0]).toBe(0);

    // Live visibility, both halves, genuinely inside the pin. The walk-by
    // scout marked the pre_dug south-east route and its contact then decayed
    // to `lost` once the scout walked on — the write the old latched rule
    // suppressed. Meanwhile the charge team's own mark held the first route
    // identified from first sight to collapse, so side 0 never lost it:
    // the reversal must not cost a lone team its charge.
    expect(contacts.some((c) => c.side === 0 && c.tunnel === 1 && c.level === 'identified')).toBe(true);
    expect(contacts.some((c) => c.side === 0 && c.tunnel === 1 && c.level === 'lost')).toBe(true);
    expect(contacts.some((c) => c.side === 0 && c.tunnel === 0 && c.level === 'lost')).toBe(false);
    expect(end.tunnelContactLevel(0, 1)).toBe(0); // unknown again by the end
    expect(end.tnAlive[1]).toBe(1); // and never charged — decay is why it faded
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

// --------------------------------------------------------------- relief ----
//
// A SECOND pinned replay, over ground that is not flat.
//
// The replay above is flat, and since T1-A that is a hole rather than a
// nuisance. `setElevation` is never called there, so every climb is 0, the
// slope term collapses to exactly the arithmetic it replaced, and the golden
// hash would stay green through a completely broken slope implementation — an
// inverted sign included. It DID stay green through T1-A, which is evidence
// that flat ground is untouched and no evidence whatever about slope. This
// block is the other half.
//
// The ground: a nine-by-nine hill, eight levels up, sitting squarely between an
// assault in the south and its objective in the north. Everything else is flat.
//
// A hill rather than a step, deliberately. A climb to a fixed height
// TELESCOPES — every monotone route from 0 up to 3 pays three levels wherever
// it crosses — so a plain escarpment prices every crossing alike and would
// prove nothing about routing. Ground that rises above its destination and
// comes back down does not telescope: over the top is eighty units of climb
// bought and all eighty thrown away again, and round the flank is none. The
// flank is 32 units of extra walking, so the hill is worth going round, and
// going round is a decision the sign has to be right to make.
const RELIEF_W = 40;
const RELIEF_H = 40;
const RELIEF_SEED = 0x510_9e5;
const RELIEF_TICKS = 900;

/** Every tile of the hill, x 16-24 by y 14-22. */
const HILL: number[] = [];
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
const HILL_CORE: number[] = [];
for (let y = 14; y <= 22; y++) {
  for (let x = 16; x <= 24; x++) {
    HILL.push(y * RELIEF_W + x);
    if (x >= 17 && x <= 23 && y >= 15 && y <= 21) HILL_CORE.push(y * RELIEF_W + x);
  }
}

/**
 * The same little battle twice over: an assault north into a held position,
 * once with the hill in the way and once on ground left flat. Same seed, same
 * forces, same spawn tiles, same orders — the elevation grid is the only
 * difference between the two runs.
 *
 * `tiles0` is every tile a living attacker stood on, which is what turns "the
 * hash moved" into "the route moved". The hash alone cannot say that, because
 * `elevation` is itself hashed.
 */
function relief(seed: number, ticks: number, raised: boolean): { sim: Sim; tiles0: Set<number> } {
  const sim = new Sim({ seed, width: RELIEF_W, height: RELIEF_H, capacity: 32 });
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

  const tiles0 = new Set<number>();
  for (let t = 0; t < ticks; t++) {
    if (t === 10) sim.queueCommand({ kind: 'attackMove', ids: up, x: fx.fromInt(20), y: fx.fromInt(6) });
    sim.tick();
    for (const id of up) {
      if (sim.state.alive[id] === 0) continue;
      tiles0.add((sim.state.posY[id] >> 16) * RELIEF_W + (sim.state.posX[id] >> 16));
    }
  }
  return { sim, tiles0 };
}

describe('determinism over relief (900-tick replay round a hill)', () => {
  it('two independent replays from the same seed produce an identical state hash', () => {
    const a = relief(RELIEF_SEED, RELIEF_TICKS, true);
    const b = relief(RELIEF_SEED, RELIEF_TICKS, true);
    expect(a.sim.hash()).toBe(b.sim.hash());
  });

  it('the pinned hash', () => {
    // Pinned for the same reason the flat number above is, and NOT
    // interchangeable with it: this is the only replay in the repo whose flow
    // fields carry a non-zero climb, so it is the only one that can catch a
    // change to UPHILL_PER_LEVEL, to the sign of the climb, or to the slope
    // term's arithmetic. Move it deliberately, in the commit that moves the
    // behaviour, and say why.
    //
    // Set when T1-A gave the flow field a slope term (UPHILL_PER_LEVEL = 10,
    // descent free). There is no earlier value: before T1-A this replay would
    // have been identical to its own flat control.
    expect(relief(RELIEF_SEED, RELIEF_TICKS, true).sim.hash()).toBe(2641065416);
  });

  it('the relief changes the route, not merely the hash', () => {
    // `elevation` is part of hash(), so "the hash differs" is true of any
    // raised map whatever the pathing does, and is worth nothing on its own.
    // This is the assertion that says the slope term is live in this replay:
    // the same units, from the same tiles, under the same order, stand
    // somewhere else at the end. Delete the cost term and this fails.
    const raised = relief(RELIEF_SEED, RELIEF_TICKS, true);
    const flat = relief(RELIEF_SEED, RELIEF_TICKS, false);
    expect(raised.sim.hash()).not.toBe(flat.sim.hash());
    let moved = 0;
    for (let i = 0; i < flat.sim.entityCount; i++) {
      if (
        raised.sim.state.posX[i] !== flat.sim.state.posX[i] ||
        raised.sim.state.posY[i] !== flat.sim.state.posY[i]
      ) {
        moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('the assault goes round the hill rather than over it', () => {
    // What this does NOT test, measured rather than assumed: the SIGN. Flip
    // `elevation[tile] - elevation[n]` in flowfield.ts and every assertion in
    // this describe block still passes, the pinned hash above included, byte
    // for byte. An inverted sign shifts every cost by a term that depends only
    // on the tile and the goal, so it cannot reorder the routes from a tile —
    // see the note at the top of flowfield.test.ts, which is where the sign
    // actually is pinned. What this DOES test is that a rim costs what a rim
    // should: eighty units of climb bought and thrown away, against 32 units of
    // extra walking. Deleting the cost term, or zeroing UPHILL_PER_LEVEL, fails
    // here loudly.
    const raised = relief(RELIEF_SEED, RELIEF_TICKS, true);
    expect(HILL_CORE.filter((t) => raised.tiles0.has(t))).toEqual([]);
  });

  it('and on the identical ground flat it walks straight over the top — the control', () => {
    // Without this, the test above passes on a map whose geometry, spawn
    // tiles or order would have sent them round whatever the elevation said.
    const flat = relief(RELIEF_SEED, RELIEF_TICKS, false);
    expect(HILL_CORE.some((t) => flat.tiles0.has(t))).toBe(true);
  });
});
