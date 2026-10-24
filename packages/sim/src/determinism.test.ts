import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { MissionRuntime, type MissionJson } from './mission';
import { enqueue } from './production';
import {
  ECO_CAMP,
  ECO_CAMP_S1,
  ECO_MILITIA,
  ECO_SQUAD,
  ECONOMY_POP_CAP,
  ECONOMY_RALLY_TILE_X,
  ECONOMY_TICKS,
  HILL_CORE,
  ORDERS_SEED,
  RELIEF_SEED,
  RELIEF_TICKS,
  RELIEF_W,
  RIFLES,
  WW_SEED,
  WW_SQUAD,
  economyAdvance,
  economyDrive,
  economySetup,
  noteHeldGround,
  ordersDrive,
  ordersSetup,
  reliefDrive,
  reliefSetup,
  runDrive,
  runSetup,
  woundedSetup,
  type EconomyRun,
  type HeldGroundSeen,
} from './golden-worlds.test-helper';
import { BRACE_DROPPING, BRACE_KNEELING, BRACE_RISING, Sim, type SimEvent, type UnitTypeJson } from './sim';

// The canary for invariants 2 and 3 (CLAUDE.md): replay 1000 ticks from a
// fixed seed and assert the state hash is stable. Must pass before any
// commit touching @lions/sim. A failure here is never cosmetic.


/** A full little battle: walls, mixed forces, mid-run orders both sides. */
function run(
  seed: number,
  ticks: number,
  extraIdleUnit = false,
  onEvent?: (e: SimEvent) => void,
  onTick?: (sim: Sim, events: SimEvent[]) => void,
  humanHeld?: readonly [boolean, boolean]
): Sim {
  const { sim, ids } = runSetup(seed, extraIdleUnit, humanHeld);
  for (let t = 0; t < ticks; t++) {
    runDrive(sim, t, ids);
    const events = sim.tick();
    if (onEvent) for (const e of events) onEvent(e);
    if (onTick) onTick(sim, events);
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
    // numbers, urban 1:1=0% 2:1=15% 3:1=95% 4:1=100% included (that curve is
    // from before group formations, 2026-09-15; the same backtest now reads
    // 0 / ~65 / 100 / 100, and the old 2:1 was a stacking artifact — see the
    // comment above `urbanRatio` in tools/src/backtest/targets.ts).
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
    //
    // 2026-09-15: group formations (formation.ts). A multi-unit move now
    // gives every unit its own slot tile — the vehicles on the clicked row,
    // infantry behind — instead of one shared point, so goalX/goalY, posX/
    // posY and everything downstream of where units stand moved. The
    // determinism PROPERTY is untouched: two runs from the same seed still
    // agree (the test above this one), and the slot function draws no
    // random number. Re-pinned in the commit that wired formation.ts into
    // the move branch, and the relief replay below moved for the same reason.
    // Was 3160666129.
    //
    // 2026-10-05: infantry halt and kneel to fire (spec
    // 2026-10-05-infantry-halt-to-fire). Two reasons, one deliberate move.
    // First, hash() gained the three brace columns (brace, braceTicks,
    // braceClock). Measured on their own they moved this number with NO
    // behaviour behind it: this replay's riflemen had no `role`, derived as
    // wheeled, and not one of them ever left BRACE_NONE -- with the three
    // lines removed from hash() the old 2109596329 came back exactly. That is
    // the same admission the demolish column made above. So, second, d_rifles
    // now carries `role: 'infantry'`: they halt to fire, and the replay walks
    // them through the drop, the knee, the bound and the rise (asserted by
    // "the replay actually exercises halt to fire" below). Was 2109596329.
    //
    // Moved again in the same PR, on the lead's ruling of 6 Oct (fix the
    // sight-upgrade quirk): the kneel is 0.2 s (KNEEL_DROP_TICKS and
    // KNEEL_RISE_TICKS 4), an attack-mover bounds through the band only
    // against a target in the open and closes on one in cover, and an
    // arrived attack-mover closes on a target out in the band. This replay's
    // riflemen kneel to fire, so the shorter drop alone moves their first
    // shots. Was 2118781669.
    //
    // 2026-10-11: hash() gained two order columns, `sweepOrder` and
    // `wpSweep` (an attack-move sweeps on from its goal only when the order
    // says `sweep`; the lead's ruling). That is the WHOLE of this move, and it
    // was measured: with the halt fix and the arrival hold both in place and
    // the two columns left out of hash(), 922714084 came back exactly. This
    // replay never halts an unpinned attack-mover with a contact remembered
    // (west[0] is pinned at t=600, and stepSweep skipped a pinned unit
    // anyway) and nobody in it arrives before t=1000 -- so it cannot see
    // either fix. The orders replay at the bottom of this file is what pins
    // them. Was 922714084.
    //
    // 2026-10-13: NOT moved by the anti-armour targeting fix (lead exception;
    // `weaponHurts`/`presentedArmor` in sim.ts), and measured rather than
    // assumed: this replay's fire stream is identical before and after, all
    // 1108 `fire` events, the tank guns' 11 included. The wall at x=24 keeps
    // the two d_tanks out of each other's sight for all 1000 ticks, so every
    // gun only ever had soft candidates -- where the rule is unchanged and the
    // anti-armour rank scales every candidate alike -- and no small arm ever
    // had an armoured one in view. The relief replay below is the one that
    // sees the rule.
    //
    // 2026-10-13: GH-291: three per-unit columns (suppFromX, suppFromY,
    // suppFromSet) join the hash -- where the last HOSTILE suppression came
    // from, which a routed unit with no known threat now runs away from
    // instead of running -x. No behaviour moved: with their hashArray lines
    // removed, this replay reproduces the old value exactly. All 7 golden
    // routs in it take the known-threat branch; none takes the fallback.
    // Was 1202444260.
    //
    // 2026-10-13: hits, bounces and splash suppress. BOUNCE_SUPP_MULT was a
    // plain 2 handed to fx.mul, i.e. 2/65536, so a hit on a soft target, a
    // round bouncing off armour and every blast's splash added nothing; it is
    // 131072 (x2.0) now. That alone moved this number to 1148007277 and broke
    // the structure-path test below: the window's rifle now pins the sapper at
    // tick 95, twenty ticks short of its charge, and the shed stood. So the
    // tile the sapper charges from, (33,32), is heavy cover (`setCover` in
    // run()); the shed comes down on the holder at tick 117. Measured both
    // ways: the cover tile alone, on the old multiplier, reads 4114445845;
    // the old multiplier without it reads 1783401971 exactly. Event counts
    // against the old pin: pinned 11 -> 12, destroyed 6 -> 5, fire 1108 ->
    // 1102, impact 1 -> 4; routs unchanged at 7. Was 1783401971.
    //
    // 2026-10-13: a bounce off armour the round could never have penetrated
    // takes HARMLESS_SUPP (x0.1), as its near miss does (lead ruling). This
    // replay's riflemen ring the d_tanks' hulls, so it moves; with the
    // discount removed it reads 1851687100 exactly. Was 1851687100.
    //
    // 2026-10-13: SUPP_STAT_DIVISOR 700 -> 730 (lead ruling, the max-tier
    // smoke step): every weapon's suppression per near miss is 700/730 of
    // what it was. At 700 this replay reads 562186734 exactly. Was 562186734.
    //
    // 2026-10-14: Targeted fire (GH-420, lead 6 Oct): two per-unit columns,
    // focusTarget and focusLost, join the hash. No behaviour moved: with their
    // hashArray lines removed, all three replays (flat, relief, orders)
    // reproduce the old value exactly. Was 916087385.
    //
    // 2026-10-14: a garrisoned unit ranges, sees and fires from its window --
    // the footprint tile nearest its target -- not from the centroid (lead
    // ruling G1, garrison overhaul Task 4). This replay's shed holder fires
    // from the window. With eyePoint returning the centroid it reads
    // 4215479769 exactly. Was 4215479769.
    //
    // 2026-10-21: `demolish` and `garrison` approach a building from the open
    // tile cheapest for the ORDERED unit to reach, not the first one a
    // row-major scan meets (Qarn Hadid II's revetment was approached from its
    // far face, through the other gate). The shed's holder at (33,30) and the
    // sapper at (32,33) both used to be sent round to (36,30), its east side;
    // now each takes the ring-1 tile cheapest from where it stands (the south
    // face, the near one). With fieldToward
    // back on the plain snap it reads 935671699 exactly. Was 935671699.
    expect(a.hash()).toBe(3719067886);
  });

  it('the replay actually exercises halt to fire', () => {
    // Same admission as the structure and tunnel fronts: until 2026-10-05 the
    // replay's riflemen had no `role`, derived as wheeled, and nobody in it
    // ever knelt -- the brace columns were zero for all 1000 ticks and the pin
    // moved only because they were folded in. This asserts the riflemen now
    // really go down, fire from the knee, and get up again inside the pin.
    const seen = new Set<number>();
    let kneelingShots = 0;
    let standingShots = 0;
    run(0x1310_0001, 1000, false, undefined, (sim, events) => {
      for (let i = 0; i < sim.entityCount; i++) seen.add(sim.state.brace[i]);
      for (const e of events) {
        if (e.kind !== 'fire' || e.shooter < 0) continue;
        if (sim.unitTypes[sim.state.typeIdx[e.shooter]].id !== 'd_rifles') continue;
        if (sim.state.garrisonedIn[e.shooter] >= 0) continue; // fights from a window
        // Read after the tick: the shed's holder fires from its window and dies
        // in the collapse on the same tick (117), which clears its garrison.
        if (sim.state.alive[e.shooter] === 0) continue;
        if (sim.state.brace[e.shooter] === BRACE_KNEELING) kneelingShots++;
        else standingShots++;
      }
    });
    expect(seen.has(BRACE_DROPPING)).toBe(true);
    expect(seen.has(BRACE_KNEELING)).toBe(true);
    expect(seen.has(BRACE_RISING)).toBe(true);
    expect(kneelingShots).toBeGreaterThan(100);
    expect(standingShots).toBe(0);
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

  // GH-291: hash() folds the three suppFrom columns. Each test flips one
  // element through the state view, which a hash that skipped the column
  // would not notice. The replay is short: nothing has to have happened yet.
  it('hash covers suppFromX', () => {
    const sim = run(0x1310_0001, 20);
    const before = sim.hash();
    sim.state.suppFromX[0] += 1;
    expect(sim.hash()).not.toBe(before);
  });

  it('hash covers suppFromY', () => {
    const sim = run(0x1310_0001, 20);
    const before = sim.hash();
    sim.state.suppFromY[0] += 1;
    expect(sim.hash()).not.toBe(before);
  });

  it('hash covers suppFromSet', () => {
    const sim = run(0x1310_0001, 20);
    const before = sim.hash();
    sim.state.suppFromSet[0] ^= 1;
    expect(sim.hash()).not.toBe(before);
  });

  // GH-420: hash() folds the two targeted-fire columns. Same shape as the
  // suppFrom tests: flip one element through the state view.
  it('hash covers focusTarget', () => {
    const sim = run(0x4200_0001, 20);
    const before = sim.hash();
    sim.state.focusTarget[0] += 1;
    expect(sim.hash()).not.toBe(before);
  });

  it('hash covers focusLost', () => {
    const sim = run(0x4200_0001, 20);
    const before = sim.hash();
    sim.state.focusLost[0] += 1;
    expect(sim.hash()).not.toBe(before);
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
function relief(seed: number, ticks: number, raised: boolean, humanHeld?: readonly [boolean, boolean]): { sim: Sim; tiles0: Set<number> } {
  const { sim, up } = reliefSetup(seed, raised, humanHeld);
  const tiles0 = new Set<number>();
  for (let t = 0; t < ticks; t++) {
    reliefDrive(sim, t, up);
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
    //
    // 2026-09-15: moved by group formations, for the reason given in full at
    // the flat replay's pin above — a move order now hands every unit its own
    // slot tile instead of one shared point. Was 2641065416.
    //
    // Measured while re-pinning, and worth knowing: this number moved a
    // SECOND time when a unit whose slot is the clicked tile was allowed to
    // keep the exact point clicked, and the flat replay's did not. Both
    // replays order whole tiles, so the two builds differ only in the final
    // half-tile of a lead unit's approach — which is visible here and not
    // there, because the flow field is keyed on the slot TILE and is
    // identical either way, so only a unit that actually closes the last
    // tile can tell them apart.
    //
    // 2026-10-05: moved by halt to fire, for both reasons given at the flat
    // replay's pin -- the brace columns joined hash(), and d_rifles (which this
    // replay fields too) now kneels to fire. Was 1425295494. Moved again for
    // the 6 Oct revision, as at the flat pin. Was 3739556491.
    //
    // 2026-10-11: moved by the two order columns joining hash(), and by
    // nothing else -- measured as at the flat pin (columns out, fixes in:
    // 3200430224 exactly). Was 3200430224.
    //
    // 2026-10-13: moved by the anti-armour targeting fix (lead exception):
    // a weapon now counts an armoured target as one it can hurt only by its
    // real P(penetration) against the face shown (PEN_HURTS_MIN), and an
    // anti-armour gun ranks soft or unarmed targets at twice their distance
    // (ANTI_ARMOR_SOFT_RANK_SQ). Measured, the whole move is ONE choice: the
    // assaulting d_tank's 4th main-gun shot, at tick 593, goes to the
    // defending d_tank (id 9) instead of the rifleman (id 6) it shot at tick
    // 460. The other five gun shots are unchanged, tick for tick. Was
    // 3354895120.
    //
    // 2026-10-13: GH-291: three per-unit columns (suppFromX, suppFromY,
    // suppFromSet) join the hash, as at the flat pin. No behaviour moved: with
    // their hashArray lines removed, this replay reproduces the old value
    // exactly. Both of its 2 golden routs take the known-threat branch; none
    // takes the fallback. Was 2051106457.
    //
    // 2026-10-13: hits, bounces and splash suppress (BOUNCE_SUPP_MULT is x2.0,
    // not 2/65536), as at the flat pin. That is the whole move: on the old
    // multiplier this replay reads 3208037602 exactly. Was 3208037602.
    //
    // 2026-10-13: the harmless-bounce discount, as at the flat pin; without it
    // this replay reads 4276961824 exactly. Was 4276961824.
    //
    // 2026-10-13: SUPP_STAT_DIVISOR 700 -> 730, as at the flat pin; at 700
    // this replay reads 4031491985 exactly. Was 4031491985.
    //
    // 2026-10-14: Targeted fire (GH-420, lead 6 Oct): two per-unit columns,
    // focusTarget and focusLost, join the hash. No behaviour moved: with their
    // hashArray lines removed, all three replays (flat, relief, orders)
    // reproduce the old value exactly. Was 373999871.
    expect(relief(RELIEF_SEED, RELIEF_TICKS, true).sim.hash()).toBe(2842924511);
  });

  it("N2: the explicit single-player table is today's rule on all three golden replays", () => {
    // LITERALS, as the pins above: an oracle that imports its expectation cannot fail.
    expect(run(0x1310_0001, 1000, false, undefined, undefined, [true, false]).hash()).toBe(3719067886);
    expect(relief(RELIEF_SEED, RELIEF_TICKS, true, [true, false]).sim.hash()).toBe(2842924511);
    expect(orders(ORDERS_SEED, [true, false]).sim.hash()).toBe(3272041047);
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

// --- the orders replay ------------------------------------------------------
// Neither replay above can see whether an order is OBEYED once it is done:
// measured 2026-10-11, with the halt and arrival fixes in place and the two new
// order columns left out of hash(), both pins came back byte-identical
// (922714084, 3200430224). The flat replay's halt at t=600 lands on a pinned
// rifleman, which stepSweep skipped anyway, and no attack-mover in either one
// arrives with a contact still remembered. So the two holes the lead ruled on
// (a halted unit restarted next tick; an arrived attack-mover walking off to
// hunt) could reopen with every pin green. This replay is their pin: three
// riflemen, one halted mid-move, one sent with a plain attack-move, one with a
// sweeping one, and an enemy far off that their side has identified and lost.


function orders(seed: number, humanHeld?: readonly [boolean, boolean]): { sim: Sim; halted: number; plain: number; sweeper: number; haltAt: [number, number] } {
  const { sim, ids } = ordersSetup(seed, humanHeld);
  const { halted, plain, sweeper } = ids;
  let haltAt: [number, number] = [0, 0];
  for (let t = 0; t < 900; t++) {
    ordersDrive(sim, t, ids);
    sim.tick();
    if (t === 130) haltAt = [sim.state.posX[halted], sim.state.posY[halted]];
  }
  return { sim, halted, plain, sweeper, haltAt };
}

describe('determinism of an order once it is done (900-tick replay)', () => {
  it('two independent replays from the same seed produce an identical state hash', () => {
    expect(orders(ORDERS_SEED).sim.hash()).toBe(orders(ORDERS_SEED).sim.hash());
  });

  it('the replay actually exercises the halt, the hold and the sweep', () => {
    const { sim, halted, plain, sweeper, haltAt } = orders(ORDERS_SEED);
    // Halted for good, where it stopped -- not walked on at the memory.
    expect(sim.state.posX[halted]).toBe(haltAt[0]);
    expect(sim.state.posY[halted]).toBe(haltAt[1]);
    expect(haltAt[0]).toBeGreaterThan(fx.fromInt(5)); // and it WAS under way
    // A plain attack-move stops where it was sent.
    expect(sim.state.posX[plain]).toBe(fx.fromInt(14));
    expect(sim.state.posY[plain]).toBe(fx.fromInt(24));
    // A sweeping one went on, toward the memory at x=44.
    expect(sim.state.posX[sweeper]).toBeGreaterThan(fx.fromInt(20));
  });

  it('the pinned hash', () => {
    // Set 2026-10-11 with the fixes it guards (halt clears the attack-move
    // latch; an attack-move sweeps on from its goal only when the order says
    // `sweep`). There is no earlier value. Move it deliberately and say why.
    // Falsified when set: reverting both fixes reads 2325908329, reverting
    // the arrival hold alone 629252188, and leaving the halt's attackMove
    // latch set (sweepOrder still cleared) moves it too, with the behaviour
    // assertions above still green -- the one mutation only this pin sees.
    //
    // 2026-10-13: GH-291: three per-unit columns (suppFromX, suppFromY,
    // suppFromSet) join the hash, as at the flat pin. No behaviour moved: with
    // their hashArray lines removed, this replay reproduces the old value
    // exactly. It has 0 golden routs, so it cannot see the rout rule at all;
    // it moved for the columns alone. Was 2737216487.
    //
    // 2026-10-14: Targeted fire (GH-420, lead 6 Oct): two per-unit columns,
    // focusTarget and focusLost, join the hash. No behaviour moved: with their
    // hashArray lines removed, all three replays (flat, relief, orders)
    // reproduce the old value exactly. Was 1736634855.
    expect(orders(ORDERS_SEED).sim.hash()).toBe(3272041047);
  });
});

// --- the economy replay -----------------------------------------------------
// No other replay in this file constructs a MissionRuntime, so the mission
// economy -- the purse, the build queue -- was the one piece of runtime state
// with no canary for invariants 2 and 3. It lives in JS number arithmetic
// (`rate / 1200`, mission.ts' income block), which is legal there only because
// nothing hashed it. `economyHash()` hashes its FLOOR, plus the queue; this
// replay pins it BEFORE the Stage 4 economy plans (F1 first) change it, so the
// first thing the pin has to explain is a deliberate change.
//
// The types mirror the shipped data (data/units/kdf/inf_squad.json, recon_drone,
// data/units/enemy/militia_cell.json) in the fields that decide behaviour: an
// in-test type with no `role` derives wheeled and never braces (halt to fire,
// 6 Oct), so the squads carry `role: 'infantry'`.


const ECONOMY_SEED = 0x0e_c0_0001;
// ECONOMY_PIN: born 2026-10-14 at da74f887 (F1 Task 1, before any economy
// change). There is no earlier value. Move it deliberately, in the commit that
// moves the economy, and say why; each Stage 4 economy plan (F1, F2, F4) that
// adds a column to economyHash() moves it once, with a comment here.
// re-pinned 2026-10-15, F1 Task 3: intel now accrues from first identification
// (10 each) and objective completion (30 each) instead of per minute (G3 Q1,
// lead 4 Oct), and economyHash() folds the settled first identifications
// (size, then ids ascending); was 3286554442.
// re-pinned 2026-10-15, F3 Task 4: population and the cap are economy state (G3 Q4,
// lead 4 Oct); economyHash() folds population(0), population(1), popCap(0), popCap(1)
// (null as -1) after every earlier fold, and the fixture gained a cap of 5 and one
// refused build (and a population-0 drone, as shipped); was 331788258.
// re-pinned 2026-10-15, F1 follow-up: lead ruling 15 Oct: 8/40/30, smoke 100 (a first
// identification pays 8, an objective 40); was 537142626.
// re-pinned 2026-10-15, F2 Task 7: held-ground income and corridors (G3 Q2, lead 4 Oct);
// economyHash() appends side 1's floored purse, each income zone's state and cut code and
// the convoy's cut code, and the fixture gained two zones and a convoy route; was 3794140228.
// re-pinned 2026-10-16, F4 Task 6: serial production lines per camp, the contested pause and
// rally points (G3 Q3, lead 4 Oct); economyHash() folds every line (side, anchor, current,
// ticksLeft, queue, rally) in place of the interim R-F4-8 fold, and the fixture gained a second
// camp, a rally point, a cancel and a raider contest (about 200 contested ticks); was 275731552.
const ECONOMY_PIN = 904873885;

/** `extraBuild` buys one `supply_truck` at ECONOMY_EXTRA_BUILD_TICK: delivered
 *  (15 s) long before the end, so it differs from the base run in the purse
 *  alone. */
function economyReplay(
  seed: number,
  extraBuild = false,
  popCap: number | null = ECONOMY_POP_CAP,
  via: 'direct' | 'command' = 'direct',
  rallyTileX: number = ECONOMY_RALLY_TILE_X,
  ticks: number = ECONOMY_TICKS,
): EconomyRun {
  const w = economySetup(seed, extraBuild, popCap, via, rallyTileX);
  for (let t = 0; t < ticks; t++) {
    economyDrive(w, t);
    economyAdvance(w, t);
  }
  w.run.secondaryDone = w.rt.objectiveList.find((o) => o.id === 'clear')?.status === 'complete';
  return w.run;
}

describe('economy replay (2400 ticks of MissionRuntime on a flat map)', () => {
  it('two runs of the economy replay agree', () => {
    expect(economyReplay(ECONOMY_SEED).rt.economyHash()).toBe(economyReplay(ECONOMY_SEED).rt.economyHash());
  });

  it('the economy hash covers the purse', () => {
    const base = economyReplay(ECONOMY_SEED);
    const spent = economyReplay(ECONOMY_SEED, true);
    // Both queues hold the same late truck at the end, so the purse is the
    // whole difference.
    expect(spent.built).toBe(base.built + 1);
    expect(spent.rt.logistics).toBeLessThan(base.rt.logistics);
    expect(spent.rt.intel).toBe(base.rt.intel);
    expect(spent.rt.economyHash()).not.toBe(base.rt.economyHash());
  });

  it('reaches the states the hash claims to cover', () => {
    const r = economyReplay(ECONOMY_SEED);
    expect(r.rt.intel).toBeGreaterThan(0);
    expect(r.built).toBeGreaterThanOrEqual(1);
    expect(r.identified).toBeGreaterThanOrEqual(1);
    expect(r.secondaryDone).toBe(true);
    // The queue the hash walks is not empty at the end: one truck in flight.
    expect(r.rt.production.map((p) => p.unit)).toEqual(['supply_truck']);
    // And the run did not end: the fixture is not allowed to withdraw or win.
    expect(r.rt.result).toBe('ongoing');
  });

  // F2 Task 7: the pin is over held ground that was really held, contested and cut.
  it('passes through a held, a contested and a cut state', () => {
    const r = economyReplay(ECONOMY_SEED);
    expect([...r.seen.states].some((s) => s === 0 || s === 1)).toBe(true);
    expect(r.seen.states.has(-2)).toBe(true);
    expect(r.seen.cuts.size).toBeGreaterThan(0);
    // Side 1 held ground, so its purse (hashed) is not zero.
    expect(r.rt.logisticsOf(1)).toBeGreaterThan(0);
  });

  // F4 Task 6: the pin is over production that really paused, refunded and walked to a rally point.
  it('passes through a frozen line, a refund and a rally arrival', () => {
    const r = economyReplay(ECONOMY_SEED);
    // The raider stood at the second camp's door for 10 s: 200 ticks (to within the 1-tick
    // edges of the radius), every one of them with the item in progress not advancing.
    expect(r.contestedTicks).toBeGreaterThanOrEqual(195);
    expect(r.contestedTicks).toBeLessThanOrEqual(205);
    expect(r.frozenTicks).toBe(r.contestedTicks);
    // The truck was cancelled in progress: accepted, and its 100 came back.
    expect(r.cancelAnswer).toBe(true);
    expect(r.refund).toBe(100);
    // The first squad walked from the first camp to the rally point and stood on it.
    expect(r.rallyArrivedTick).toBeGreaterThan(700);
    expect(r.rallyArrivedTick).toBeLessThan(1150);
    const lines = r.rt.productionLines(0);
    expect(lines).toHaveLength(2);
    expect(lines[0].rally).toEqual([fx.fromInt(ECONOMY_RALLY_TILE_X), fx.fromInt(30)]);
    expect(lines[1].current).toBeNull();
  });

  // F4 Task 6, pair (a): the rally point is hashed. Two runs identical but for (14, 30) / (15, 30),
  // stopped at tick 600 (before the first delivery at 700, so no unit has walked to either point
  // and the point is the whole difference: a longer run differs through the squad's path).
  it('the economy hash covers the rally point', () => {
    const a = economyReplay(ECONOMY_SEED, false, ECONOMY_POP_CAP, 'direct', 14, 600);
    const b = economyReplay(ECONOMY_SEED, false, ECONOMY_POP_CAP, 'direct', 15, 600);
    expect(a.rt.economyHash()).not.toBe(b.rt.economyHash());
  });

  // F4 Task 6, pair (b): a line's side is hashed. A camp of side 0 and a camp of side 1, each
  // with one item in progress (population 0, so the sides' population words agree), are the same
  // words in the same order but for the side.
  it('the economy hash covers the side of a line', () => {
    const lineHash = (camp: typeof ECO_CAMP | typeof ECO_CAMP_S1, side: 0 | 1): number => {
      const sim = new Sim({ seed: ECONOMY_SEED, width: 16, height: 16, capacity: 8 });
      const squad = sim.addUnitType(ECO_SQUAD);
      sim.addStructureType(camp);
      const rt = new MissionRuntime(
        sim,
        {
          id: 'line_side',
          map: { file: 'beit_sahwan_outskirts' },
          ledger: { requires: [], produces: [] },
          structures: [{ type: camp.id, at: [6, 6], size: [2, 2] }],
          objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
          starting_force: [{ unit: 'inf_squad', count: 1, at: [2, 2] }],
          enemy: { faction: 'ashwar', garrison: [] },
        },
        { typeIdOf: () => squad, markers: {}, zones: {} },
      );
      rt.start();
      // The item goes onto the line directly, not through the side-1 buyer (Task 9), so the two
      // hashes differ in the side word alone.
      const line = rt['lines'][side][0];
      expect(enqueue(line, { unit: 'inf_squad', logistics: 100, intel: 0, population: 0, buildTicks: 300 })).toBe(true);
      expect(line.current?.unit).toBe('inf_squad');
      return rt.economyHash();
    };
    expect(lineHash(ECO_CAMP_S1, 1)).not.toBe(lineHash(ECO_CAMP, 0));
  });

  // F3 Task 4: the pin is over a cap that BINDS. Without this, a fixture whose cap
  // never refuses anything would pin population and the cap while testing neither.
  it('the cap really refuses a build, and the refusal costs nothing', () => {
    const r = economyReplay(ECONOMY_SEED);
    expect(r.refusal).toMatch(/^population cap reached \(\d+\/5\)$/);
    expect(r.refusedByCap).toBe(true);
    expect(r.refusedAnswer).toBe(false);
    expect(r.purseAfterRefusal).toBe(r.purseBeforeRefusal);
    // And it refused exactly that one: a cap of 7 admits nothing more than 5 does
    // (the convoy needs 10), so the same builds went through under both.
    expect(r.built).toBe(economyReplay(ECONOMY_SEED, false, 7).built);
    expect(r.built).toBe(2); // the two squads; the late truck is still in flight
    expect(r.rt.popCap(0)).toBe(5);
    expect(r.rt.popCapped('supply_truck')).toBe(false);
  });

  it('the economy hash covers the cap', () => {
    // 5, 6 and 7 all refuse the convoy and admit every other build, so the runs
    // are identical in every respect but the cap.
    const at5 = economyReplay(ECONOMY_SEED, false, 5);
    const at6 = economyReplay(ECONOMY_SEED, false, 6);
    const at7 = economyReplay(ECONOMY_SEED, false, 7);
    for (const r of [at5, at6, at7]) expect(r.refusedByCap).toBe(true);
    expect(at6.built).toBe(at5.built);
    expect(at6.rt.population(0)).toBe(at5.rt.population(0));
    expect(at6.rt.logistics).toBe(at5.rt.logistics);
    expect(at6.rt.economyHash()).not.toBe(at5.rt.economyHash());
    expect(at7.rt.economyHash()).not.toBe(at6.rt.economyHash());
  });

  it('the economy replay pins its hash', () => {
    expect(economyReplay(ECONOMY_SEED).rt.economyHash()).toBe(ECONOMY_PIN);
  });

  it('N2: the command path reproduces both economy pins byte for byte', () => {
    expect(economyReplay(ECONOMY_SEED, false, ECONOMY_POP_CAP, 'command').rt.economyHash()).toBe(ECONOMY_PIN);
    expect(reliefEconomyReplay(RELIEF_ECO_SEED, {}, 'command').rt.economyHash()).toBe(ECONOMY_PIN_RELIEF);
  });

  // RUNTIME_DIGEST_PIN: born 2026-10-15 in a5c0deab (N2 Task 6), read from the first run. Move it deliberately, in the
  // commit that moves runtime state, and say why; economyHash() is its first word, so
  // every ECONOMY_PIN move moves it too -- name both in that commit.
  // re-pinned 2026-10-16, F4 Task 6: digest() folds economyHash() first, so both move with it;
  // were 2984314042 and 3060732596.
  const RUNTIME_DIGEST_PIN = 2037118941;
  const RUNTIME_DIGEST_PIN_RELIEF = 1884258391;
  it('the economy replay pins its runtime digest', () => {
    expect(economyReplay(ECONOMY_SEED).rt.digest()).toBe(RUNTIME_DIGEST_PIN);
  });
  it('the relief economy replay pins its runtime digest', () => {
    expect(reliefEconomyReplay(RELIEF_ECO_SEED).rt.digest()).toBe(RUNTIME_DIGEST_PIN_RELIEF);
  });
  it('two runs agree on the runtime digest, and it is not the economy hash', () => {
    const a = economyReplay(ECONOMY_SEED).rt;
    expect(a.digest()).toBe(economyReplay(ECONOMY_SEED).rt.digest());
    expect(a.digest()).not.toBe(a.economyHash());
  });
});

/** `data/maps/tel_marum.json` at 2026-10-15 (F1 Task 5), as a snapshot: 1 = a tile the sim
 *  blocks (`^` rock ridge and `#` building), 0 = open on foot (`b` boulders included).
 *  A copy on purpose: sim imports nothing, and a pin must not move when the map is edited. */
const RELIEF_ECO_BLOCKED: readonly string[] = [
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000111000000000000000111111',
  '111111000000000000000000111000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000011111000000000000000000000000111111',
  '111111000000011111000000000000000000000000111111',
  '111111111100111111111100000111111111111111111111',
  '111111111100111111111100000111111111111111111111',
  '111111111100111111111100000111111111111111111111',
  '111111111100111111100000000000111111111111111111',
  '111111111100111111100000000000111111111111111111',
  '111111111100111111100000000000111111111111111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000001110000000000000000111111',
  '111111000000000000000001110000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
  '111111000000000000000000000000000000000000111111',
];

/** The same map's `elevation` grid, one digit per tile (0-4). */
const RELIEF_ECO_ELEVATION: readonly string[] = [
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111111111111111111111111111111111333333',
  '333333111111144444111111111111111111111111333333',
  '333333111111144444111111111111111111111111333333',
  '333333444433444444444422222444444444444444333333',
  '333333444433444444444422222444444444444444333333',
  '333333444433444444444422222444444444444444333333',
  '333333444433444444433322222333444444444444333333',
  '333333444433444444433322222333444444444444333333',
  '333333444433444444433322222333444444444444333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000001110000000000000000333333',
  '333333000000000000000001110000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000222222222222200000000000333333',
  '333333000000000000222222222222200000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
  '333333000000000000000000000000000000000000333333',
];

// --- the economy replay over relief ---------------------------------------------
// The flat economy replay above has no high ground (`count` 0 rises), so the
// rise state `economyHash()` folds in at F1 Task 5 -- the per-rise hold counters,
// the paid flags, the per-unit spawn rise -- is arithmetically absent from
// ECONOMY_PIN. That is correct and it is a blind spot: this is the other half,
// the way the relief replay is the other half of the flat sim replay.
//
// The ground is `tel_marum` (snapshotted below; the map has three rises: the
// boulder corridor, the pass, the bench). Three squads, all given a PLAIN move
// (a plain order stops where it was sent, #402/#537):
//   A  walks from the start line onto the bench (rise 2) and holds it: pays once.
//   B  is sent late up to the pass (rise 1) and is still counting when the run
//      ends, so the hash carries a live hold counter and not only a paid flag.
//   C  STARTS on the bench and never leaves it: the spawn rule means it earns
//      nothing, and the hash carries its spawn rise.
const RELIEF_ECO_SEED = 0x0e_c0_0005;
const RELIEF_ECO_TICKS = 2400;
const RELIEF_ECO_B_ORDER_TICK = 1700;
// F3 Task 4 (GH-183, C-R5): the relief fixture gets the flat one's coverage. Its three
// squads are side 0's whole starting population, so a cap of 3 is full on the first
// tick and the one build asked at tick 100 is refused. (Caps 2 and 3 both refuse it:
// the cap is the only difference between those runs.)
const RELIEF_ECO_POP_CAP = 3;
const RELIEF_ECO_REFUSED_BUILD_TICK = 100;
// ECONOMY_PIN_RELIEF: born 2026-10-15 at F1 Task 5 (the rise state joined
// economyHash; there is no earlier value, so this is a birth, not a re-pin).
// ECONOMY_PIN above did not move for the same change: the flat map has no
// rise, and the fold is a loop over `count` with no length word (F-R2).
// re-pinned 2026-10-15, F3 Task 4: the same fold (population and both caps joined
// economyHash()), and the relief fixture gained a unitInfo catalogue, a cap of 3 (its
// three starting squads) and one refused build; was 2992706492.
// re-pinned 2026-10-15, F2 Task 7: held-ground income and corridors (G3 Q2, lead 4 Oct);
// the same fold, and the relief fixture gained two zones, a convoy route and the militia
// that cuts it; was 2682592505.
// re-pinned 2026-10-16, F4 Task 6: the same line fold (the fixture's one `player_start` line folds
// empty; the fixture is unchanged); was 145368021.
const ECONOMY_PIN_RELIEF = 2771311510;

const RELIEF_ECO_MISSION: MissionJson = {
  id: 'economy_replay_relief',
  map: { file: 'tel_marum', player_start: [24, 44] },
  ledger: { requires: [], produces: [] },
  // F2 Task 7: two income zones and a live convoy. `bench` is held by C from the first tick;
  // `basin` holds A and B and the one militia far to the east (out of everyone's sight), so it
  // is contested until B leaves for the pass, and then side 1 holds it. The convoy enters one
  // tile from that militia: cut from the start. tel_marum has no roads (D5's flow route).
  resources: {
    logistics_start: 400,
    logistics_rate_per_min: 120,
    intel_start: 0,
    income_zones: [
      { zone: 'bench', rate_per_min: 30 },
      { zone: 'basin', rate_per_min: 45 },
    ],
    supply_corridor: true,
    supply_entry: 'convoy_entry',
  },
  enemy: {
    garrison: [{ unit: 'militia_cell', count: 1, at: [39, 42], stance: { kind: 'hold_position' } }],
  },
  // No time_limit_s, and one objective nothing here can complete: the fixture must not end.
  objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
  starting_force: [
    { unit: 'inf_squad', count: 1, at: [24, 40] },
    { unit: 'inf_squad', count: 1, at: [26, 41] },
    { unit: 'inf_squad', count: 1, at: [20, 25.5] },
  ],
};

interface ReliefEconomyRun {
  rt: MissionRuntime;
  /** What `buildBlockedReason('inf_squad')` read the tick the refused build was asked. */
  refusal: string | null;
  refusedByCap: boolean;
  refusedAnswer: boolean;
  purseBeforeRefusal: number;
  purseAfterRefusal: number;
  /** Every `intelEarned` the runtime emitted for a rise: tick, rise id, tile. */
  paid: { tick: number; ref: number | string; x: number; y: number }[];
  seen: HeldGroundSeen;
}

/** `bAt` is the tick B is ordered up to the pass; null leaves it where it stands. */
function reliefEconomyReplay(
  seed: number,
  opts: { aOrdered?: boolean; bAt?: number | null; popCap?: number } = {},
  via: 'direct' | 'command' = 'direct',
): ReliefEconomyRun {
  const popCap = opts.popCap ?? RELIEF_ECO_POP_CAP;
  const aOrdered = opts.aOrdered ?? true;
  const bAt = opts.bAt === undefined ? RELIEF_ECO_B_ORDER_TICK : opts.bAt;
  const sim = new Sim({ seed, width: 48, height: 48, capacity: 32 });
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      if (RELIEF_ECO_BLOCKED[y][x] === '1') sim.setBlocked(x, y, true);
      const level = RELIEF_ECO_ELEVATION[y].charCodeAt(x) - 48;
      if (level !== 0) sim.setElevation(x, y, level);
    }
  }
  const ids = new Map<string, number>();
  ids.set(ECO_SQUAD.id, sim.addUnitType(ECO_SQUAD));
  ids.set(ECO_MILITIA.id, sim.addUnitType(ECO_MILITIA));
  const rt = new MissionRuntime(sim, RELIEF_ECO_MISSION, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: { convoy_entry: [40, 42] },
    zones: { bench: [18, 25, 13, 2], basin: [6, 36, 36, 12] },
    unitInfo: (u) => (u === 'inf_squad' ? { logistics: 180, buildTimeS: 15, population: 1 } : null),
    popCaps: [popCap, null],
  });
  rt.start();
  const paid: ReliefEconomyRun['paid'] = [];
  const seen: HeldGroundSeen = { states: new Set(), cuts: new Set() };
  let refusal: string | null = null;
  let refusedByCap = false;
  let refusedAnswer = true;
  let purseBefore = 0;
  let purseAfter = 0;
  for (let t = 0; t < RELIEF_ECO_TICKS; t++) {
    if (t === RELIEF_ECO_REFUSED_BUILD_TICK) {
      refusal = rt.buildBlockedReason('inf_squad');
      refusedByCap = rt.popCapped('inf_squad');
      purseBefore = rt.logistics;
      if (via === 'direct') {
        refusedAnswer = rt.requestBuild('inf_squad');
      } else {
        sim.queueCommand({ kind: 'build', side: 0, unit: 'inf_squad' });
        refusedAnswer = rt.applyQueued() === 1;
      }
      purseAfter = rt.logistics;
    }
    // A: up to the middle of the bench (tiles y 25-26), at tick 5.
    if (aOrdered && t === 5) sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(24.5), y: fx.from(25.5) });
    // B: up the valley to the pass (tiles x 19-29, y 12-17), late.
    if (bAt !== null && t === bAt) sim.queueCommand({ kind: 'move', ids: [1], x: fx.from(24.5), y: fx.from(15.5) });
    const simEvents = sim.tick();
    for (const e of rt.step(simEvents)) {
      if (e.kind === 'intelEarned' && e.cause === 'highGround') {
        paid.push({ tick: e.tick, ref: e.ref, x: e.at.x, y: e.at.y });
      }
    }
    noteHeldGround(rt, seen);
  }
  return {
    rt,
    refusal,
    refusedByCap,
    refusedAnswer,
    purseBeforeRefusal: purseBefore,
    purseAfterRefusal: purseAfter,
    paid,
    seen,
  };
}

describe('economy replay over relief (2400 ticks of MissionRuntime on tel_marum)', () => {
  it('two runs of the relief economy replay agree', () => {
    const a = reliefEconomyReplay(RELIEF_ECO_SEED);
    const b = reliefEconomyReplay(RELIEF_ECO_SEED);
    expect(a.rt.economyHash()).toBe(b.rt.economyHash());
    expect(a.paid).toEqual(b.paid);
  });

  it('reaches the states the hash claims to cover', () => {
    const r = reliefEconomyReplay(RELIEF_ECO_SEED);
    // At least one rise paid, and exactly the one A held: the bench, rise 2 in
    // row-major order, on A's tile (x 24), and not C, which started on it.
    expect(r.paid.length).toBeGreaterThanOrEqual(1);
    expect(r.paid).toHaveLength(1);
    expect(r.paid[0].ref).toBe(2);
    expect(r.paid[0].x).toBe(24);
    expect(r.rt.intel).toBe(30);
    // And the run did not end.
    expect(r.rt.result).toBe('ongoing');
  });

  // F2 Task 7: the pin is over held ground that was really held, contested and cut.
  it('passes through a held, a contested and a cut state', () => {
    const r = reliefEconomyReplay(RELIEF_ECO_SEED);
    expect([...r.seen.states].some((s) => s === 0 || s === 1)).toBe(true);
    expect(r.seen.states.has(-2)).toBe(true);
    expect(r.seen.cuts.size).toBeGreaterThan(0);
  });

  it('the economy hash covers the rise state', () => {
    const base = reliefEconomyReplay(RELIEF_ECO_SEED).rt.economyHash();
    // A never sent: the bench is never paid (a paid flag and the purse differ).
    const noA = reliefEconomyReplay(RELIEF_ECO_SEED, { aOrdered: false });
    expect(noA.paid).toHaveLength(0);
    expect(noA.rt.economyHash()).not.toBe(base);
    // B sent 60 ticks later: nothing is paid in either run, so the whole
    // difference is B's live hold counter at the end of the run.
    const late = reliefEconomyReplay(RELIEF_ECO_SEED, { bAt: RELIEF_ECO_B_ORDER_TICK + 60 });
    expect(late.paid).toEqual(reliefEconomyReplay(RELIEF_ECO_SEED).paid);
    expect(late.rt.economyHash()).not.toBe(base);
  });

  it('the cap really refuses a build on relief, and the refusal costs nothing', () => {
    const r = reliefEconomyReplay(RELIEF_ECO_SEED);
    expect(r.refusal).toBe('population cap reached (3/3)');
    expect(r.refusedByCap).toBe(true);
    expect(r.refusedAnswer).toBe(false);
    expect(r.purseAfterRefusal).toBe(r.purseBeforeRefusal);
    expect(r.rt.production).toHaveLength(0);
    expect(r.rt.population(0)).toBe(3);
  });

  it('the economy hash covers the cap on relief', () => {
    const at3 = reliefEconomyReplay(RELIEF_ECO_SEED, { popCap: 3 });
    const at2 = reliefEconomyReplay(RELIEF_ECO_SEED, { popCap: 2 });
    expect(at2.refusedByCap).toBe(true);
    expect(at2.rt.logistics).toBe(at3.rt.logistics);
    expect(at2.rt.economyHash()).not.toBe(at3.rt.economyHash());
  });

  it('the relief economy replay pins its hash', () => {
    expect(reliefEconomyReplay(RELIEF_ECO_SEED).rt.economyHash()).toBe(ECONOMY_PIN_RELIEF);
  });
});

// Field works (#277), Task 2: the FW state block. D1 (pre-flight): hash()
// folds the block only once `fwLive` is set, so no existing pin moved when the
// fourteen arrays arrived -- every golden, versus and net replay raises only
// neutral, complete structures. These tests therefore run on an FW-LIVE sim
// (one owned structure raised), and flip one element of each array through
// its read-only view: a hash that skipped the array would not notice.
describe('field works state block (D1)', () => {
  const OWNED = { id: 'fw_op', hp_per_tile: 300, owner: 1 };
  const NEUTRAL = { id: 'fw_house', hp_per_tile: 260, garrison_slots: 2 };

  function fwWorld(owned: boolean): { sim: Sim; s: number } {
    const sim = new Sim({ seed: 0x277, width: 24, height: 12, capacity: 8 });
    const t = sim.addUnitType(RIFLES);
    const ti = sim.addStructureType(owned ? OWNED : NEUTRAL);
    const s = sim.addStructure(ti, [5 * 24 + 16, 5 * 24 + 17]);
    sim.spawn(t, 0, fx.fromInt(3), fx.fromInt(3));
    for (let i = 0; i < 5; i++) sim.tick();
    return { sim, s };
  }

  type Flip = (sim: Sim, s: number) => void;
  const flips: readonly (readonly [string, Flip])[] = [
    ['stOwner', (sim, s) => { sim.structures.owner[s] = 0; }],
    ['stKnown', (sim, s) => { sim.structures.known[s] ^= 1; }],
    ['stProgress', (sim, s) => { sim.structures.progress[s] -= 1; }],
    ['siteAlive', (sim) => { sim.works.alive[0] ^= 1; }],
    ['siteType', (sim) => { sim.works.type[0] += 1; }],
    ['siteX', (sim) => { sim.works.x[0] += 1; }],
    ['siteY', (sim) => { sim.works.y[0] += 1; }],
    ['siteSide', (sim) => { sim.works.side[0] += 1; }],
    ['siteStructure', (sim) => { sim.works.structure[0] += 1; }],
    ['buildSite', (sim) => { sim.state.buildSite[0] += 1; }],
    ['auraHealRate', (sim) => { sim.state.auraHealRate[0] += 1; }],
    ['auraHealCap', (sim) => { sim.state.auraHealCap[0] += 1; }],
    ['auraCompAt', (sim) => { sim.state.auraCompAt[0] += 1; }],
    ['auraRepairTicks', (sim) => { sim.state.auraRepairTicks[0] += 1; }],
    ['auraAccMult', (sim) => { sim.state.auraAccMult[0] -= 1; }],
  ];

  for (const [name, flip] of flips) {
    it(`hash covers ${name}`, () => {
      const { sim, s } = fwWorld(true);
      expect(sim.fieldWorksLive).toBe(true);
      const before = sim.hash();
      flip(sim, s);
      expect(sim.hash()).not.toBe(before);
    });
  }

  it('a world with only neutral, complete structures is not FW-live, and folds no FW word', () => {
    const { sim, s } = fwWorld(false);
    expect(sim.fieldWorksLive).toBe(false);
    const before = sim.hash();
    // Touch every array in the block: none of it is folded, so nothing moves.
    for (const [, flip] of flips) flip(sim, s);
    expect(sim.hash()).toBe(before);
  });

  it('spawn initialises the per-unit FW columns: buildSite -1, aura 0, accuracy multiplier ONE', () => {
    const { sim } = fwWorld(true);
    expect(sim.state.buildSite[0]).toBe(-1);
    expect(sim.state.auraHealRate[0]).toBe(0);
    expect(sim.state.auraHealCap[0]).toBe(0);
    expect(sim.state.auraCompAt[0]).toBe(0);
    expect(sim.state.auraRepairTicks[0]).toBe(0);
    expect(sim.state.auraAccMult[0]).toBe(65536); // ONE
    expect(sim.works.structure[0]).toBe(-1);
  });

  it('every raised structure has progress ONE', () => {
    const { sim, s } = fwWorld(false);
    expect(sim.structures.progress[s]).toBe(65536);
    expect(sim.structures.owner[s]).toBe(-1);
  });

  it('each FW writer sets fwLive: an owned addStructure, a sub-ONE progress, setStructureOwner', () => {
    const mk = (): { sim: Sim; ti: number } => {
      const sim = new Sim({ seed: 1, width: 24, height: 12, capacity: 4 });
      return { sim, ti: sim.addStructureType(NEUTRAL) };
    };
    const a = mk();
    a.sim.addStructure(a.ti, [30]);
    expect(a.sim.fieldWorksLive).toBe(false);
    a.sim.addStructure(a.ti, [40], { owner: 0 });
    expect(a.sim.fieldWorksLive).toBe(true);

    const b = mk();
    b.sim.addStructure(b.ti, [30], { progress: 65535 });
    expect(b.sim.fieldWorksLive).toBe(true);

    const c = mk();
    const cs = c.sim.addStructure(c.ti, [30]);
    c.sim.setStructureOwner(cs, -1);
    expect(c.sim.fieldWorksLive).toBe(false);
    c.sim.setStructureOwner(cs, 1);
    expect(c.sim.fieldWorksLive).toBe(true);
    expect(c.sim.structures.owner[cs]).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// WOUNDED_WORLD_PIN (GH-707 Task 7): a NEW pin, not a moved one. Every other replay in this file
// registers no wound type, so the deferred `woundLive` block (and `removed`, folded inside it)
// is outside all of them; this is the replay that sees it. A 600-tick fight with test-only
// types: two side-0 squads that shed wounded (chance 0.6, bleed 8 s), a two-man stretcher medic,
// an aid post of side 0 (admit 2 tiles, treat 5 s); against them an enemy squad that also sheds
// and two heavy rifle sections (damage 45).
// The scenario must reach a fall, a bleed-out, a treatment, a carry, an admission and a rejoin;
// the test asserts each happened, so a change that quietly stops one of them fails here and not
// only on the number.


function woundedWorld(seed: number, squad: UnitTypeJson = WW_SQUAD): { hash: number; seen: Record<string, number> } {
  const sim = woundedSetup(seed, squad);
  const seen: Record<string, number> = {};
  for (let i = 0; i < 600; i++) {
    for (const e of sim.tick()) {
      if (e.kind.startsWith('wound') || e.kind === 'bledOut') seen[e.kind] = (seen[e.kind] ?? 0) + 1;
    }
  }
  return { hash: sim.hash(), seen };
}

// WOUNDED_WORLD_PIN: born 2026-10-22 (GH-707 Task 7), read from the first run. It moves when a
// wound rule or a wound column's fold changes; say why in the commit that moves it.
const WOUNDED_WORLD_PIN = 1774950105;

describe('determinism of a wounded world (600-tick replay, GH-707)', () => {
  it('two runs from the seed agree, and the run falls, bleeds, treats, carries, admits and rejoins', () => {
    const a = woundedWorld(WW_SEED);
    const b = woundedWorld(WW_SEED);
    expect(b.hash).toBe(a.hash);
    expect(b.seen).toEqual(a.seen);
    // Read off the first run: 6 falls, 4 bled out, 2 treated, 2 carried in and admitted,
    // one rejoined his squad, one discharged as evacuated (his squad was gone).
    expect(a.seen).toEqual({ woundedDown: 6, bledOut: 4, woundStabilised: 2, woundAdmitted: 2, woundRejoined: 1, woundEvacuated: 1 });
  });

  it('the pinned hash', () => {
    expect(woundedWorld(WW_SEED).hash).toBe(WOUNDED_WORLD_PIN);
  });
});
