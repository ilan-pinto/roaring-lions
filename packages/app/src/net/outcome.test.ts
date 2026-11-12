import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, fx, type MissionContext, type MissionJson, type UnitTypeJson } from '@lions/sim';
import { WsTransport, type Frame, type MatchConfig, type MatchTransport, type SocketLike, type TransportStatus } from '@lions/net';
import { versusAnchors } from './versus-seats';
import { runFrames, seatWorldFor } from './frame-step';
import { versusSpawns } from './versus-force';
import { buildWorld } from './versus-world.test-helper';
import { MATCH_CAP_TICKS, decideOnHashTick, forcesOf, goalsOf, hashTickOutcome, matchResult, outcomeOf, productionOf, reportOver, roomEndingOutcome, seatResultOf, unitCost, type LocalDecision, type OutcomeGoals, type OutcomeSim } from './outcome';

/** Type 0 is armed, type 1 is not (a drone, a truck), type 2 is armed and
 *  has no movement at all (speed 0), type 3 is an armed aircraft. All but
 *  type 2 can move. */
const TYPES = [
  { id: 'armed', weapons: [1], stepPerTick: 3000, isAir: false },
  { id: 'unarmed', weapons: [], stepPerTick: 3000, isAir: false },
  { id: 'fixed', weapons: [1], stepPerTick: 0, isAir: false },
  { id: 'heli', weapons: [1], stepPerTick: 3000, isAir: true },
  // Type 4 is a medic team: carbines, and a `rescue` block (GH-707).
  { id: 'medic', weapons: [1], stepPerTick: 3000, isAir: false, rescue: { radius_tiles: 8 } },
] as const;
/** What each test type is worth. */
const COST: Record<string, number> = { armed: 300, unarmed: 100, fixed: 200, heli: 300, medic: 295 };
const costOf = (id: string): number => COST[id] ?? 0;

/** One row per unit: [side, alive, typeIdx, firepowerKilled?, mobilityKilled?]. */
function world(units: ([number, number, number] | [number, number, number, number] | [number, number, number, number, number])[]): OutcomeSim {
  return {
    entityCount: units.length,
    state: {
      side: Uint8Array.from(units.map((u) => u[0])),
      alive: Uint8Array.from(units.map((u) => u[1])),
      typeIdx: Uint16Array.from(units.map((u) => u[2])),
      firepowerKilled: Uint8Array.from(units.map((u) => u[3] ?? 0)),
      mobilityKilled: Uint8Array.from(units.map((u) => u[4] ?? 0)),
    },
    unitTypes: TYPES,
  };
}

describe('outcomeOf (spec §2.3, version one)', () => {
  it('both sides with an armed unit alive: ongoing', () => {
    expect(outcomeOf(world([[0, 1, 0], [1, 1, 0]]), 100)).toEqual({ kind: 'ongoing' });
  });

  it("side 1's only armed unit dead, an unarmed one alive: side 0 wins by annihilation", () => {
    const sim = world([[0, 1, 0], [1, 0, 0], [1, 1, 1]]);
    expect(outcomeOf(sim, 100)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('a medic team does not keep its side standing: carbines and a rescue block are a support unit (GH-707, 30 Oct 2026)', () => {
    // Side 1 has one living medic and nothing else; side 0 has a rifle squad. The medic's carbines must not count.
    const sim = world([[0, 1, 0], [1, 1, 4]]);
    expect(outcomeOf(sim, 100)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    // Control: the same medic beside a living armed unit leaves the match on.
    expect(outcomeOf(world([[0, 1, 0], [1, 1, 4], [1, 1, 0]]), 100)).toEqual({ kind: 'ongoing' });
    // Both sides down to medics: a draw, not a stalemate or a cap decision.
    expect(outcomeOf(world([[0, 1, 4], [1, 1, 4]]), 100)).toEqual({ kind: 'draw', by: 'mutual' });
  });

  it("side 0's armed units dead: side 1 wins by annihilation", () => {
    const sim = world([[0, 0, 0], [0, 1, 1], [1, 1, 0]]);
    expect(outcomeOf(sim, 100)).toEqual({ kind: 'won', side: 1, by: 'annihilation' });
  });

  it('only a firepower-killed armed unit left: that side has lost by annihilation (R-B20)', () => {
    const sim = world([[0, 1, 0], [1, 1, 0, 1], [1, 1, 1]]);
    expect(outcomeOf(sim, 100)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('the real sim exposes the knocked-out flag the rule reads', () => {
    const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
    const force = versusSpawns(sim, typeOf, versusAnchors(map));
    const armed = force.bySide[1].filter((id) => sim.unitTypes[sim.state.typeIdx[id]].weapons.length > 0);
    for (const id of armed) sim.debugDisableFirepower(id);
    expect(outcomeOf(sim, sim.tickCount)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it("both sides' armed units dead on the same tick: a mutual draw", () => {
    const sim = world([[0, 0, 0], [0, 1, 1], [1, 0, 0], [1, 1, 1]]);
    expect(outcomeOf(sim, 100)).toEqual({ kind: 'draw', by: 'mutual' });
  });

  it('the cap with both standing and equal forces: a draw on time, naming the totals', () => {
    const sim = world([[0, 1, 0], [1, 1, 0]]);
    expect(outcomeOf(sim, MATCH_CAP_TICKS, costOf)).toEqual({ kind: 'draw', by: 'time', forces: [300, 300] });
    expect(outcomeOf(sim, MATCH_CAP_TICKS - 1, costOf)).toEqual({ kind: 'ongoing' });
  });

  it('a third side (civilians) neither keeps a side standing nor wins', () => {
    const sim = world([[0, 1, 0], [2, 1, 0]]);
    expect(outcomeOf(sim, 100)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('is 25 minutes of 20 Hz ticks', () => {
    expect(MATCH_CAP_TICKS).toBe(30_000);
  });

  it('GH-913 L8: takes the cap as an argument, defaulting to 25 minutes', () => {
    const sim = world([[0, 1, 0], [1, 1, 0]]);
    expect(outcomeOf(sim, 42_000, costOf, undefined, 42_000)).toEqual({ kind: 'draw', by: 'time', forces: [300, 300] });
    expect(outcomeOf(sim, 41_999, costOf, undefined, 42_000)).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(sim, 30_000, costOf, undefined, 42_000)).toEqual({ kind: 'ongoing' });
  });
});

// The lead's ruling (2026-10-13): a stalemate, and the time limit, are
// decided by surviving unit value -- each living unit's logistics cost.
describe('stalemate and the time limit, by surviving unit value', () => {
  it('every unit on both sides immobile: the higher value wins at once, with both totals', () => {
    // Side 0: a forced-landed helicopter (300) and a fixed gun (200). Side 1: two landed helicopters... one of them dead.
    const sim = world([[0, 1, 3, 0, 1], [0, 1, 2], [1, 1, 3, 0, 1], [1, 0, 0]]);
    expect(outcomeOf(sim, 100, costOf)).toEqual({ kind: 'won', side: 0, by: 'stalemate', forces: [500, 300] });
    const flipped = world([[0, 1, 3, 0, 1], [1, 1, 3, 0, 1], [1, 1, 2]]);
    expect(outcomeOf(flipped, 100, costOf)).toEqual({ kind: 'won', side: 1, by: 'stalemate', forces: [300, 500] });
  });
  it('every unit immobile and equal value: a draw', () => {
    const sim = world([[0, 1, 3, 0, 1], [1, 1, 3, 0, 1]]);
    expect(outcomeOf(sim, 100, costOf)).toEqual({ kind: 'draw', by: 'stalemate', forces: [300, 300] });
  });
  // GH-706: a stuck GROUND hull field-fixes to slowed after 90 s of quiet, so
  // it is no longer immobile; a forced-landed aircraft still is.
  it('a stuck ground hull is not immobile (its crew fixes it); a forced-landed aircraft is', () => {
    expect(outcomeOf(world([[0, 1, 0, 0, 1], [1, 1, 0, 0, 1]]), 100, costOf)).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(world([[0, 1, 3, 0, 1], [1, 1, 0, 0, 1]]), 100, costOf)).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(world([[0, 1, 3, 0, 1], [1, 1, 3, 0, 1]]), 100, costOf)).toEqual({ kind: 'draw', by: 'stalemate', forces: [300, 300] });
    // A sound aircraft is not immobile either.
    expect(outcomeOf(world([[0, 1, 3, 0, 1], [1, 1, 3]]), 100, costOf)).toEqual({ kind: 'ongoing' });
  });
  it('one unit that can still move -- on either side, armed or not, knocked-out guns or not -- is no stalemate', () => {
    expect(outcomeOf(world([[0, 1, 3, 0, 1], [1, 1, 3, 0, 1], [1, 1, 0]]), 100, costOf)).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(world([[0, 1, 3, 0, 1], [0, 1, 1], [1, 1, 3, 0, 1]]), 100, costOf)).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(world([[0, 1, 3, 0, 1], [1, 1, 3, 0, 1], [1, 1, 0, 1]]), 100, costOf)).toEqual({ kind: 'ongoing' });
  });
  it('a dead unit and a third side (civilians) neither block a stalemate nor count', () => {
    const sim = world([[0, 1, 2], [0, 0, 0], [1, 1, 3, 0, 1], [2, 1, 0]]);
    expect(outcomeOf(sim, 100, costOf)).toEqual({ kind: 'won', side: 1, by: 'stalemate', forces: [200, 300] });
  });
  it('annihilation still comes first: a side with no armed unit has lost, however much it is worth', () => {
    const sim = world([[0, 1, 0, 0, 1], [1, 1, 1, 0, 1], [1, 1, 1, 0, 1]]);
    expect(outcomeOf(sim, 100, costOf)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });
  it('at 25:00 the value decides: higher wins on time, every unit counted, armed or not', () => {
    const sim = world([[0, 1, 0], [1, 1, 0], [1, 1, 1]]);
    expect(outcomeOf(sim, MATCH_CAP_TICKS - 1, costOf)).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(sim, MATCH_CAP_TICKS, costOf)).toEqual({ kind: 'won', side: 1, by: 'time', forces: [300, 400] });
  });
  it('the value is the unit data\'s logistics cost, the number the cost curve prices', () => {
    expect(unitCost('mbt_lavi')).toBe(906);
    expect(unitCost('no_such_unit')).toBe(0);
    const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
    versusSpawns(sim, typeOf, versusAnchors(map));
    const [a, b] = forcesOf(sim);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(a);   // the mirror match: the same force on each side
  });
  it('the real sim exposes the flag, the speed and isAir the rule reads: stuck hulls are no stalemate, landed aircraft are', () => {
    const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
    const force = versusSpawns(sim, typeOf, versusAnchors(map));
    expect(outcomeOf(sim, sim.tickCount)).toEqual({ kind: 'ongoing' });
    expect(force.bySide.flat().every((id) => sim.unitTypes[sim.state.typeIdx[id]].stepPerTick > 0)).toBe(true);
    // Test-only: the hit table is random, so the flag the sim sets on a `mobility_kill` is set here directly.
    for (const id of force.bySide.flat()) sim.state.mobilityKilled[id] = 1;
    // GH-706: every ground hull stuck still field-fixes -- the fight is not over.
    expect(outcomeOf(sim, sim.tickCount)).toEqual({ kind: 'ongoing' });
    // Leave only the aircraft, every one forced down: nothing can close the distance.
    const air = force.bySide.flat().filter((id) => sim.unitTypes[sim.state.typeIdx[id]].isAir);
    expect(air.length).toBeGreaterThan(0);
    for (const id of force.bySide.flat()) if (!air.includes(id)) sim.debugKill(id);
    const o = outcomeOf(sim, sim.tickCount);
    expect(o).toMatchObject({ kind: 'draw', by: 'stalemate' });
  });
});

describe('roomEndingOutcome: the player who drops loses (2026-10-13)', () => {
  const sideOfSeat = (s: 0 | 1): 0 | 1 => s;
  it('a forfeit names the seat that dropped: the other side wins, read the same by both seats', () => {
    for (const viewer of [0, 1] as const) {
      expect(roomEndingOutcome('forfeit', 1, viewer, sideOfSeat)).toEqual({ kind: 'won', side: 0, by: 'forfeit' });
      expect(roomEndingOutcome('forfeit', 0, viewer, sideOfSeat)).toEqual({ kind: 'won', side: 1, by: 'forfeit' });
    }
  });
  it('a leave that names its seat is a surrender by that seat, whoever reads it', () => {
    for (const viewer of [0, 1] as const) expect(roomEndingOutcome('left', 0, viewer, sideOfSeat)).toEqual({ kind: 'won', side: 1, by: 'left' });
  });
});

describe('roomEndingOutcome', () => {
  const sideOfSeat = (seat: 0 | 1): 0 | 1 => (seat === 0 ? 1 : 0); // seat 0 plays side 1
  it('a surrender loses for the side of the seat that surrendered', () => {
    expect(roomEndingOutcome('surrender', 0, 0, sideOfSeat)).toEqual({ kind: 'won', side: 0, by: 'surrender' });
    expect(roomEndingOutcome('surrender', 1, 0, sideOfSeat)).toEqual({ kind: 'won', side: 1, by: 'surrender' });
  });
  it('a left wins for the seat that stayed: only it hears the ended', () => {
    expect(roomEndingOutcome('left', undefined, 1, sideOfSeat)).toEqual({ kind: 'won', side: 1, by: 'left' });
  });
  it('void and expired are no result', () => {
    expect(roomEndingOutcome('void', undefined, 0, sideOfSeat)).toBeNull();
    expect(roomEndingOutcome('expired', undefined, 0, sideOfSeat)).toBeNull();
    expect(roomEndingOutcome('surrender', undefined, 0, sideOfSeat)).toBeNull();
  });
  it('the room closing itself after the result (over, L-1) is no result: never "They left"', () => {
    expect(roomEndingOutcome('over', undefined, 0, sideOfSeat)).toBeNull();
    expect(roomEndingOutcome('over', undefined, 1, sideOfSeat)).toBeNull();
    expect(matchResult(null, roomEndingOutcome('over', undefined, 0, sideOfSeat), true)).toBeNull();
  });
});

describe('matchResult (R-B11)', () => {
  const local = { kind: 'won', side: 0, by: 'annihilation' } as const;
  const left = { kind: 'won', side: 1, by: 'left' } as const;
  it('nothing decided, nothing ended: keep going', () => {
    expect(matchResult(null, null, true)).toBeNull();
  });
  it("a room's ending waits while the drain still yields frames", () => {
    expect(matchResult(null, left, false)).toBeNull();
  });
  it("a room's ending shows once the drain is exhausted and the sim is still undecided", () => {
    expect(matchResult(null, left, true)).toEqual(left);
  });
  it('a local outcome reached while draining wins over the ending', () => {
    expect(matchResult(local, left, false)).toEqual(local);
    expect(matchResult(local, left, true)).toEqual(local);
  });
});

describe('hashTickOutcome: decided on hash ticks only, so both seats stop on the same tick', () => {
  const cfg = { hashEveryTicks: 20 } as MatchConfig;
  const over = { ...world([[0, 1, 0], [1, 0, 0]]), tickCount: 20 };
  it('a decided sim is not read off a frame that does not close a hash window', () => {
    expect(hashTickOutcome(18, cfg, over)).toBeNull();
    expect(hashTickOutcome(20, cfg, over)).toBeNull();
  });
  it('on a hash tick it is the rule, at the sim\'s own tick count', () => {
    expect(hashTickOutcome(19, cfg, over)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    const standing = { ...world([[0, 1, 0], [1, 1, 0]]), tickCount: MATCH_CAP_TICKS };
    // Equal mirror forces at the cap: a draw on time (the unit data knows neither test type, so both read 0).
    expect(hashTickOutcome(MATCH_CAP_TICKS - 1, cfg, standing)).toEqual({ kind: 'draw', by: 'time', forces: [0, 0] });
  });
  it('GH-913 L8: the cap is the MAP\'s: 25 minutes anywhere, 35 on Rujm Sawda (a draw on time only at 42,000 ticks)', () => {
    const rujm = { hashEveryTicks: 20, map: 'rujm_sawda' } as MatchConfig;
    const wadi = { hashEveryTicks: 20, map: 'wadi_tarfan' } as MatchConfig;
    const atOld = { ...world([[0, 1, 0], [1, 1, 0]]), tickCount: MATCH_CAP_TICKS };
    // At the old cap Wadi Tarfan ends on time and Rujm Sawda plays on.
    expect(hashTickOutcome(MATCH_CAP_TICKS - 1, wadi, atOld)).toEqual({ kind: 'draw', by: 'time', forces: [0, 0] });
    expect(hashTickOutcome(MATCH_CAP_TICKS - 1, rujm, atOld)).toBeNull();
    // ...one frame before the Rujm cap, still going; on it, a draw on time.
    expect(hashTickOutcome(41_979, rujm, { ...atOld, tickCount: 41_999 })).toBeNull();
    expect(hashTickOutcome(41_999, rujm, { ...atOld, tickCount: 42_000 })).toEqual({ kind: 'draw', by: 'time', forces: [0, 0] });
  });
  it('an ongoing match and a room with no config are null', () => {
    expect(hashTickOutcome(19, cfg, { ...world([[0, 1, 0], [1, 1, 0]]), tickCount: 20 })).toBeNull();
    expect(hashTickOutcome(19, null, over)).toBeNull();
  });
});

/** A seat's transport: the room's frames, handed out however many at a time it is asked. */
class Frames implements MatchTransport {
  readonly local = false;
  private queue: Frame[];
  constructor(n: number) { this.queue = Array.from({ length: n }, (_, tick) => ({ tick, cmds: [] })); }
  queueCommand(): void {}
  take(max: number): Frame[] { return this.queue.splice(0, max); }
  reportTick(): void {}
  status(): TransportStatus { return { kind: 'live', behind: this.queue.length }; }
  close(): void {}
}

describe('both seats show the same result (N1b task 10)', () => {
  it('two seats on the real mirror world, batched 3 and 8 a frame, stop on the same tick with the same result', () => {
    const cfg = { hashEveryTicks: 20, dataDigest: 0, seats: [{ side: 0 }, { side: 1 }] } as unknown as MatchConfig;
    const seat = (batch: number) => {
      const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
      const force = versusSpawns(sim, typeOf, versusAnchors(map));
      // The same battle on both machines: at tick 7 side 1 loses every armed unit.
      const runTick = (): void => {
        sim.tick();
        if (sim.tickCount === 7) {
          for (const id of force.bySide[1]) if (sim.unitTypes[sim.state.typeIdx[id]].weapons.length > 0) sim.debugKill(id);
        }
      };
      let decided: ReturnType<typeof hashTickOutcome> = null;
      const step = {
        transport: new Frames(100), sim, seatWorld: seatWorldFor(cfg, sim), runTick, config: cfg,
        stopAfter: (tick: number) => (decided ??= hashTickOutcome(tick, cfg, sim)) !== null,
      };
      // The frame loop: step until decided, as main.ts does.
      for (let i = 0; i < 100 && decided === null; i++) runFrames(step, batch);
      return { decided, tick: sim.tickCount, hash: sim.hash() };
    };
    const a = seat(3);
    const b = seat(8);
    expect(a.decided).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    expect(b.decided).toEqual(a.decided);
    // The first hash tick after the kill closes the window ending at frame 19.
    expect([a.tick, b.tick]).toEqual([20, 20]);
    expect(b.hash).toBe(a.hash);
  });

  it('a stalemate: two seats, batched 3 and 8, stop on the same tick with the same value result (2026-10-13)', () => {
    const cfg = { hashEveryTicks: 20, dataDigest: 0, seats: [{ side: 0 }, { side: 1 }] } as unknown as MatchConfig;
    const seat = (batch: number) => {
      const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
      const force = versusSpawns(sim, typeOf, versusAnchors(map));
      // The same battle on both machines: at tick 7 every ground unit dies, side 1 also loses
      // its first aircraft, and every aircraft left on both sides is forced down (test-only: the
      // flag a `mobility_kill` sets). A stuck ground hull would field-fix (GH-706), so only
      // aircraft make a stalemate.
      const isAir = (id: number): boolean => sim.unitTypes[sim.state.typeIdx[id]].isAir;
      const runTick = (): void => {
        sim.tick();
        if (sim.tickCount === 7) {
          for (const id of force.bySide.flat()) if (!isAir(id)) sim.debugKill(id);
          const air1 = force.bySide[1].filter(isAir);
          sim.debugKill(air1[0]);
          for (const id of force.bySide.flat()) sim.state.mobilityKilled[id] = 1;
        }
      };
      let decided: ReturnType<typeof hashTickOutcome> = null;
      const step = {
        transport: new Frames(100), sim, seatWorld: seatWorldFor(cfg, sim), runTick, config: cfg,
        stopAfter: (tick: number) => (decided ??= hashTickOutcome(tick, cfg, sim)) !== null,
      };
      for (let i = 0; i < 100 && decided === null; i++) runFrames(step, batch);
      return { decided, tick: sim.tickCount, hash: sim.hash() };
    };
    const a = seat(3);
    const b = seat(8);
    expect(a.decided).toMatchObject({ kind: 'won', side: 0, by: 'stalemate' });
    const forces = (a.decided as unknown as { forces: readonly [number, number] }).forces;
    expect(forces[0]).toBeGreaterThan(forces[1]);
    expect(b.decided).toEqual(a.decided);
    expect([a.tick, b.tick]).toEqual([20, 20]);
    expect(b.hash).toBe(a.hash);
  });
});

describe('the result reported to the room (L-1, R-B26)', () => {
  const cfg = { hashEveryTicks: 20 } as MatchConfig;
  const decidedSim = { ...world([[0, 1, 0], [1, 0, 0]]), tickCount: 400 };
  const ongoingSim = { ...world([[0, 1, 0], [1, 1, 0]]), tickCount: 400 };
  it('decideOnHashTick keeps the first decision and the FRAME tick it was read on', () => {
    expect(decideOnHashTick(null, 398, cfg, decidedSim)).toBeNull();   // not a hash tick
    expect(decideOnHashTick(null, 399, cfg, ongoingSim)).toBeNull();
    const d = decideOnHashTick(null, 399, cfg, decidedSim);
    expect(d).toEqual({ result: { kind: 'won', side: 0, by: 'annihilation' }, tick: 399 });
    expect(decideOnHashTick(d, 419, cfg, decidedSim)).toBe(d);
  });

  /** A real transport over a fake socket: what reaches the wire. */
  function wired(): { t: WsTransport; overs: () => unknown[]; recv: (m: unknown) => void } {
    const sent: string[] = [];
    const sock: SocketLike = { onopen: null, onmessage: null, onclose: null, send: (d) => { sent.push(d); }, close: () => {} };
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    const recv = (m: unknown): void => { sock.onmessage?.({ data: JSON.stringify(m) }); };
    sock.onopen?.({});
    return { t, recv, overs: () => sent.map((x) => JSON.parse(x) as { t: string }).filter((m) => m.t === 'over') };
  }
  const local: LocalDecision = { result: { kind: 'won', side: 1, by: 'annihilation' }, tick: 399 };

  it('a panel showing the sim\'s own result sends one over with its tick, however often it is shown', () => {
    const { t, overs } = wired();
    reportOver(t, local.result, local, CONFIG_FOR_WIRE);
    reportOver(t, local.result, local, CONFIG_FOR_WIRE);
    expect(overs()).toEqual([{ t: 'over', tick: 399, result: { winner: 1, by: 'annihilation' } }]);
  });
  it('a panel showing a room\'s ending (a surrender, a leave) sends nothing, decided sim or not', () => {
    const { t, overs, recv } = wired();
    recv({ t: 'start', config: CONFIG_FOR_WIRE });
    const surrendered = roomEndingOutcome('surrender', 1, 0, (s) => s);
    const left = roomEndingOutcome('left', undefined, 0, (s) => s);
    for (const shown of [surrendered, left]) {
      if (shown === null) throw new Error('a room ending with no result');
      reportOver(t, shown, null, CONFIG_FOR_WIRE);
      reportOver(t, shown, { result: { ...local.result }, tick: 399 }, CONFIG_FOR_WIRE);   // an equal result is not the sim's own
    }
    expect(overs()).toEqual([]);
  });
  it('no room (single-player) is never asked', () => {
    expect(() => reportOver(null, local.result, local, CONFIG_FOR_WIRE)).not.toThrow();
  });
});

describe('the result as the wire names it (GH-1075 A3)', () => {
  const seatsOf = (sides: [0 | 1, 0 | 1]): MatchConfig => ({
    ...CONFIG_FOR_WIRE,
    seats: [{ ...CONFIG_FOR_WIRE.seats[0], side: sides[0] }, { ...CONFIG_FOR_WIRE.seats[1], side: sides[1] }],
  });
  it('the_result_names_a_seat', () => {
    // KDF v Sarim: seat 0 is Sarim (side 1), seat 1 is KDF (side 0). A win for side 0 is seat 1's.
    expect(seatResultOf({ kind: 'won', side: 0, by: 'annihilation' }, seatsOf([1, 0]))).toEqual({ winner: 1, by: 'annihilation' });
    // A mirror: side and seat agree.
    expect(seatResultOf({ kind: 'won', side: 0, by: 'annihilation' }, seatsOf([0, 1]))).toEqual({ winner: 0, by: 'annihilation' });
  });
  it('a_draw_has_no_winner', () => {
    expect(seatResultOf({ kind: 'draw', by: 'mutual' }, seatsOf([0, 1]))).toEqual({ winner: null, by: 'mutual' });
  });
  it('the room\'s own endings are no sim result', () => {
    for (const by of ['surrender', 'left', 'forfeit'] as const) expect(seatResultOf({ kind: 'won', side: 0, by }, seatsOf([0, 1]))).toBeNull();
  });
});

const CONFIG_FOR_WIRE: MatchConfig = {
  matchId: 'm', code: 'ABCDEF', seed: 1, map: 'x', mode: 'versus',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'A', kind: 'human' },
    { seat: 1, side: 1, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'B', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
};

describe('outcomeOf with goals (GH-976, a win-mode room)', () => {
  // `ticks` is the sim tick each side completed on; the default is one tick for a side that won (the old reading).
  const goals = (won: readonly boolean[], units: readonly number[] = [0, 0], mode: 'camp' | 'points' | 'flag' = 'camp', ticks: readonly number[] = [won[0] ? 100 : -1, won[1] ? 100 : -1]): OutcomeGoals => ({
    mode,
    sideWon: (side) => won[side],
    scoreUnitsOf: (side) => units[side],
    scoreOf: (side) => Math.floor(units[side] / 1200),
    completeTickOf: (side) => ticks[side],
  });
  const both = world([[0, 1, 0], [1, 1, 0]]);

  it('no goal done is the plain rule: ongoing with both standing, and absent goals change nothing', () => {
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([false, false]))).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, undefined)).toEqual({ kind: 'ongoing' });
  });

  it('a completed goal wins by objective and names the mode, for either side', () => {
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, false]))).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'camp' });
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([false, true], [0, 0], 'points'))).toEqual({ kind: 'won', side: 1, by: 'objective', mode: 'points' });
  });

  it('a goal beats annihilation: the side that razed the camp as its last unit fell has won, and the wiped side does not', () => {
    const wiped = world([[0, 0, 0], [1, 1, 0]]); // side 0 has no unit; side 1 has one
    expect(outcomeOf(wiped, 100, costOf, undefined, MATCH_CAP_TICKS)).toEqual({ kind: 'won', side: 1, by: 'annihilation' });
    expect(outcomeOf(wiped, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, false]))).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'camp' });
  });

  it('a goal beats the cap and a stalemate', () => {
    expect(outcomeOf(both, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, goals([false, true]))).toEqual({ kind: 'won', side: 1, by: 'objective', mode: 'camp' });
    expect(outcomeOf(world([[0, 1, 2], [1, 1, 2]]), 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, false]))).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'camp' });
  });

  it('both goals on one tick: the higher score wins a points race, level scores are a mutual end', () => {
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true], [720100, 720000], 'points'))).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'points' });
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true], [720000, 720400], 'points'))).toEqual({ kind: 'won', side: 1, by: 'objective', mode: 'points' });
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true], [720000, 720000], 'points'))).toEqual({ kind: 'draw', by: 'mutual', mode: 'points' });
    // Two camps razed on one tick: nothing separates them. The draw names its mode (GH-976 P3), so the panel does not say
    // "both forces destroyed" of two forces that are standing.
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true]))).toEqual({ kind: 'draw', by: 'mutual', mode: 'camp' });
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true], [0, 0], 'flag'))).toEqual({ kind: 'draw', by: 'mutual', mode: 'flag' });
    // Both sides WIPED in a mode room is still the plain mutual end, with no mode to name.
    expect(outcomeOf(world([[0, 0, 0], [1, 0, 0]]), 100, costOf, undefined, MATCH_CAP_TICKS, goals([false, false], [0, 0], 'flag'))).toEqual({ kind: 'draw', by: 'mutual' });
  });

  it('both goals inside one hash window: the side that finished FIRST wins, whatever it scored by then (GH-976 P2)', () => {
    // Side 0 reached the target on tick 95, side 1 on tick 100; side 1 overshot by a lot (a kill bonus). The earlier wins.
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true], [720100, 725000], 'points', [95, 100]))).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'points' });
    // And the other way round, five ticks apart: the earlier is side 1, the larger score is side 0's.
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true], [725000, 720100], 'points', [100, 95]))).toEqual({ kind: 'won', side: 1, by: 'objective', mode: 'points' });
    // The earlier camp razed wins a camp race too, with level scores.
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true], [0, 0], 'camp', [99, 94]))).toEqual({ kind: 'won', side: 1, by: 'objective', mode: 'camp' });
    // The same tick still falls to the score, then to a draw.
    expect(outcomeOf(both, 100, costOf, undefined, MATCH_CAP_TICKS, goals([true, true], [725000, 720100], 'points', [97, 97]))).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'points' });
  });

  it('on a real runtime, the side that completes a few ticks first wins although the LATER finisher has the far larger score', () => {
    const squad: UnitTypeJson = {
      id: 'ft_squad', role: 'infantry', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
      mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 }, weapons: [],
    };
    const sim = new Sim({ seed: 9, width: 40, height: 20, capacity: 16 });
    const t = sim.addUnitType(squad);
    const race = (side: 0 | 1, over: object): MissionJson['objectives'][number] => ({
      id: `score_${side}`, type: 'score', primary: true, side, score: { zones: [], per_value_destroyed: 0, target: 60, ...over },
    });
    const mission: MissionJson = {
      id: 'ft', map: { file: 'none' }, ledger: { requires: [], produces: [] },
      objectives: [race(0, { zones: [{ zone: 'west', per_min: 60 }], per_value_destroyed: 100 }), race(1, { per_value_destroyed: 6 })],
    };
    const ctx: MissionContext = { typeIdOf: () => t, markers: {}, zones: { west: [4, 4, 6, 6] }, goalsOnly: true, unitValueOf: () => 1000 };
    const rt = new MissionRuntime(sim, mission, ctx);
    rt.start();
    const put = (side: 0 | 1, x: number, y: number): number => sim.spawn(t, side, fx.from(x) + 32768, fx.from(y) + 32768);
    const step = (n: number): void => { for (let i = 0; i < n; i++) rt.step(sim.tick()); };
    put(0, 6, 6); // side 0 holds the west zone: 60 points at 60 a minute is exactly 1200 ticks
    const victim = put(0, 30, 10);
    const spare = put(1, 30, 12);
    step(1195);
    expect(rt.sideWon(0)).toBe(false);
    sim.debugKill(victim); // side 1 banks 1000 x 6 / 100 = exactly its 60-point target, on this step
    step(1);
    expect(rt.sideWon(1)).toBe(true);
    expect(rt.scoreOf(1)).toBe(60);
    step(3);
    sim.debugKill(spare); // 4 ticks later side 0 banks 1000 x 100 / 100 = 1000 points and finishes with the far larger score
    step(2);
    expect(rt.sideWon(0)).toBe(true);
    expect(rt.completeTickOf(1)).toBeLessThan(rt.completeTickOf(0));
    expect(rt.completeTickOf(0) - rt.completeTickOf(1)).toBeLessThan(20); // inside one hash window
    expect(rt.scoreUnitsOf(0)).toBeGreaterThan(rt.scoreUnitsOf(1)); // the LATER finisher is the larger scorer: only the first-to-finish rule picks side 1
    const goals = goalsOf({ runtime: rt, winMode: 'points' })!;
    expect(outcomeOf(sim, sim.tickCount, costOf, undefined, MATCH_CAP_TICKS, goals)).toEqual({ kind: 'won', side: 1, by: 'objective', mode: 'points' });
  });

  it('asked only on a hash tick, like the rest of the rule', () => {
    const config = { hashEveryTicks: 20 } as MatchConfig;
    const sim = { ...both, tickCount: 40 };
    expect(hashTickOutcome(19, config, sim, undefined, goals([true, false]))).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'camp' });
    expect(hashTickOutcome(18, config, sim, undefined, goals([true, false]))).toBeNull();
  });

  it('goalsOf: none for an annihilation world, the runtime\'s sideWon and score for a mode world', () => {
    const rt = { sideWon: (s: 0 | 1) => s === 1, scoreUnitsOf: (s: 0 | 1) => 5 + s, scoreOf: (s: 0 | 1) => 2 + s, completeTickOf: (s: 0 | 1) => 40 + s, productionLines: () => [], logisticsOf: () => 0, popCapped: () => false };
    expect(goalsOf({ runtime: null, winMode: null })).toBeUndefined();
    expect(goalsOf({ runtime: rt, winMode: null })).toBeUndefined(); // an economy room has a runtime and no mode
    const g = goalsOf({ runtime: rt, winMode: 'points' })!;
    expect([g.mode, g.sideWon(0), g.sideWon(1), g.scoreUnitsOf(1), g.completeTickOf(1)]).toEqual(['points', false, true, 6, 41]);
  });

  it('a mode room has no production to ask about, whatever its runtime', () => {
    const rt = { sideWon: () => false, scoreUnitsOf: () => 0, scoreOf: () => 0, completeTickOf: () => -1, productionLines: () => [{ alive: true, current: 'inf_squad', items: [] as string[] }], logisticsOf: () => 9999, popCapped: () => false };
    const world2 = { runtime: rt, factions: ['kdf', 'kdf'] as ['kdf', 'kdf'] };
    expect(productionOf({ ...world2, winMode: null })).toBeDefined(); // the control: an economy room with a line that can field
    expect(productionOf({ ...world2, winMode: 'camp' })).toBeUndefined();
  });
});

describe('camp mode, wipe: after_camp (GH-976, the lead 5 Nov: wipe, then raze)', () => {
  const g = (won: readonly boolean[], campWipe: 'ends' | 'after_camp' | undefined, mode: 'camp' | 'points' | 'flag' = 'camp'): OutcomeGoals => ({
    mode, sideWon: (side) => won[side], scoreUnitsOf: () => 0, scoreOf: () => 0, completeTickOf: (side) => (won[side] ? 100 : -1),
    ...(campWipe === undefined ? {} : { campWipe }),
  });
  // Side 0 keeps one armed unit; side 1 is wiped of armed units but holds 500 of unarmed value (five trucks): the
  // surviving-value rule would hand the cap to the WIPED side.
  const wiped = world([[0, 1, 0], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  const none = world([[0, 1, 0], [1, 0, 0]]);
  const run = (sim: OutcomeSim, tick: number, goals: OutcomeGoals | undefined) => outcomeOf(sim, tick, costOf, undefined, MATCH_CAP_TICKS, goals);

  it('ends (and absent) is the existing rule: a wiped side loses at once, byte for byte', () => {
    for (const goals of [g([false, false], 'ends'), g([false, false], undefined), undefined]) {
      expect(run(none, 100, goals)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
      expect(run(wiped, 100, goals)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    }
  });

  it('after_camp: a lone survivor has not won while the wiped side camp stands, and the match runs on', () => {
    expect(run(none, 100, g([false, false], 'after_camp'))).toEqual({ kind: 'ongoing' });
    expect(run(wiped, MATCH_CAP_TICKS - 1, g([false, false], 'after_camp'))).toEqual({ kind: 'ongoing' });
  });

  it('after_camp: the survivor razing the camp wins by objective; the wiped side goal done as it fell wins for IT', () => {
    expect(run(none, 100, g([true, false], 'after_camp'))).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'camp' });
    expect(run(none, 100, g([false, true], 'after_camp'))).toEqual({ kind: 'won', side: 1, by: 'objective', mode: 'camp' });
  });

  it('after_camp, the cap: the side with an armed unit wins although the wiped side holds more unarmed value', () => {
    expect(run(wiped, MATCH_CAP_TICKS, g([false, false], 'after_camp'))).toEqual({ kind: 'won', side: 0, by: 'time', forces: [300, 500] });
    // The control: with both sides armed the cap still reads surviving value, whichever rule the room has.
    const both = world([[0, 1, 0], [1, 1, 0], [1, 1, 0]]);
    expect(run(both, MATCH_CAP_TICKS, g([false, false], 'after_camp'))).toEqual({ kind: 'won', side: 1, by: 'time', forces: [300, 600] });
  });

  it('after_camp, a stalemate: the armed side wins by the stalemate, not the larger unarmed value', () => {
    // Side 0: one fixed gun (immobile, armed). Side 1: two forced-landed helicopters with their firepower killed: unarmed, immobile.
    const sim = world([[0, 1, 2], [1, 1, 3, 1, 1], [1, 1, 3, 1, 1]]);
    expect(run(sim, 100, g([false, false], 'after_camp'))).toEqual({ kind: 'won', side: 0, by: 'stalemate', forces: [200, 600] });
    expect(run(sim, 100, g([false, false], 'ends'))).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('a mutual wipe stays a draw, and both sides standing is unchanged', () => {
    expect(run(world([[0, 0, 0], [1, 0, 0]]), 100, g([false, false], 'after_camp'))).toEqual({ kind: 'draw', by: 'mutual' });
    expect(run(world([[0, 1, 0], [1, 1, 0]]), 100, g([false, false], 'after_camp'))).toEqual({ kind: 'ongoing' });
    expect(run(world([[0, 1, 0], [1, 1, 0]]), 100, g([true, true], 'after_camp'))).toEqual({ kind: 'draw', by: 'mutual', mode: 'camp' });
  });

  it('only the camp mode reads the rule: a points or flag goals object with the field set still ends on a wipe', () => {
    expect(run(none, 100, g([false, false], 'after_camp', 'points'))).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    expect(run(none, 100, g([false, false], 'after_camp', 'flag'))).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('surrender and forfeit are the room endings and the rule does not touch them', () => {
    expect(roomEndingOutcome('surrender', 1, 0, (s) => s)).toEqual({ kind: 'won', side: 0, by: 'surrender' });
    expect(roomEndingOutcome('forfeit', 0, 0, (s) => s)).toEqual({ kind: 'won', side: 1, by: 'forfeit' });
  });

  it('goalsOf carries the rule from the world: after_camp only when the world says so, ends otherwise', () => {
    const rt = { sideWon: () => false, scoreUnitsOf: () => 0, scoreOf: () => 0, completeTickOf: () => -1 };
    expect(goalsOf({ runtime: rt, winMode: 'camp', campWipe: 'after_camp' })!.campWipe).toBe('after_camp');
    expect(goalsOf({ runtime: rt, winMode: 'camp', campWipe: 'ends' })!.campWipe).toBe('ends');
    expect(goalsOf({ runtime: rt, winMode: 'camp' })!.campWipe).toBe('ends');
  });
});

describe('the cap of a points room is decided on the points (GH-976 P3)', () => {
  const goals = (units: readonly [number, number], mode: 'points' | 'camp' | 'flag' = 'points'): OutcomeGoals => ({
    mode, sideWon: () => false, scoreUnitsOf: (side) => units[side], scoreOf: (side) => Math.floor(units[side] / 1200), completeTickOf: () => -1,
  });
  // Side 0 has three armed units (900), side 1 one (300): surviving value says side 0, by a long way.
  const lopsided = world([[0, 1, 0], [0, 1, 0], [0, 1, 0], [1, 1, 0]]);

  it('the higher score wins at the cap although the other side has the larger force, and the result carries both totals', () => {
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, goals([1200 * 100, 1200 * 140]))).toEqual({ kind: 'won', side: 1, by: 'time', forces: [900, 300], points: [100, 140] });
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, goals([1200 * 140, 1200 * 100]))).toEqual({ kind: 'won', side: 0, by: 'time', forces: [900, 300], points: [140, 100] });
  });

  it('a level score is a draw, whatever the forces; one score unit settles it (the race runs on 1/1200ths of a point)', () => {
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, goals([1200 * 80, 1200 * 80]))).toEqual({ kind: 'draw', by: 'time', forces: [900, 300], points: [80, 80] });
    // 80 points and one unit against 80 points: the same whole points, and side 0 leads.
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, goals([1200 * 80 + 1, 1200 * 80]))).toEqual({ kind: 'won', side: 0, by: 'time', forces: [900, 300], points: [80, 80] });
  });

  it('only at the cap: before it the room goes on, and the other rules stand ahead of the points', () => {
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS - 1, costOf, undefined, MATCH_CAP_TICKS, goals([0, 1200 * 140]))).toEqual({ kind: 'ongoing' });
    // A side with no armed unit left has lost (annihilation) whatever it has banked.
    expect(outcomeOf(world([[0, 1, 0], [1, 0, 0]]), MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, goals([0, 1200 * 140]))).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    // Every unit immobile ends it at once on surviving value, as before: a stalemate is no cap.
    expect(outcomeOf(world([[0, 1, 2], [0, 1, 2], [1, 1, 2]]), 100, costOf, undefined, MATCH_CAP_TICKS, goals([0, 1200 * 140]))).toEqual({ kind: 'won', side: 0, by: 'stalemate', forces: [400, 200] });
  });

  it('a camp room, a flag room and an annihilation room still read surviving value at the cap, byte for byte', () => {
    const forces = { kind: 'won', side: 0, by: 'time', forces: [900, 300] };
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, undefined)).toEqual(forces);
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, goals([0, 1200 * 140], 'camp'))).toEqual(forces);
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, goals([0, 1200 * 140], 'flag'))).toEqual(forces);
    expect(Object.keys(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf))).toEqual(['kind', 'side', 'by', 'forces']); // no `points` key where there is no race
  });

  it('a goal completed by the cap still beats it', () => {
    const done: OutcomeGoals = { ...goals([1200 * 100, 1200 * 140]), sideWon: (s) => s === 0, completeTickOf: (s) => (s === 0 ? 500 : -1) };
    expect(outcomeOf(lopsided, MATCH_CAP_TICKS, costOf, undefined, MATCH_CAP_TICKS, done)).toEqual({ kind: 'won', side: 0, by: 'objective', mode: 'points' });
  });

  it('goalsOf carries the whole-point score the panel shows', () => {
    const rt = { sideWon: () => false, scoreUnitsOf: (s: 0 | 1) => 1200 * 7 + s, scoreOf: (s: 0 | 1) => 7 + s * 10, completeTickOf: () => -1 };
    const g = goalsOf({ runtime: rt, winMode: 'points' })!;
    expect([g.scoreOf(0), g.scoreOf(1)]).toEqual([7, 17]);
  });
});

describe('flag backstop: 12 minutes after the bell a set-up room is decided on standing-force value (GH-976 WP6a, lead ruling 9 Nov 2026)', () => {
  // Real unit ids, so `unitCost` reads the shipped data: type 0 is the Lavi (906), type 1 a rifle squad (292). Literals, not the data module.
  const REAL = [
    { id: 'mbt_lavi', weapons: [1], stepPerTick: 3000, isAir: false },
    { id: 'inf_squad', weapons: [1], stepPerTick: 3000, isAir: false },
  ];
  const room = { hashEveryTicks: 20, map: 'milh_flats_l', winMode: 'flag', flagSetup: true } as MatchConfig;
  const BELL = 500;
  const STOP = BELL + 14_400; // 12 minutes of 20 Hz ticks after the bell
  /** A sim at `tick` with the bell at BELL, rung. */
  const at = (tick: number, units: [number, number, number][], extra: { setupActive?: boolean; setupBellTick?: number } = {}) =>
    ({ ...world(units), unitTypes: REAL, tickCount: tick, setupActive: false, setupBellTick: BELL, ...extra });
  // Side 0 holds a Lavi and a squad (1198); side 1 holds two squads (584). Both sides stay armed, so only the clock can end it.
  const ahead0: [number, number, number][] = [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 1]];

  it('one tick short of the twelfth minute it plays on; on the tick the side ahead on value wins by time', () => {
    expect(hashTickOutcome(19, room, at(STOP - 1, ahead0))).toBeNull();
    expect(hashTickOutcome(19, room, at(STOP, ahead0))).toEqual({ kind: 'won', side: 0, by: 'time', forces: [1198, 584] });
  });

  it('the other side ahead wins for it (the comparison is not hard-wired to side 0)', () => {
    const ahead1: [number, number, number][] = [[0, 1, 1], [0, 1, 1], [1, 1, 0], [1, 1, 1]];
    expect(hashTickOutcome(19, room, at(STOP, ahead1))).toEqual({ kind: 'won', side: 1, by: 'time', forces: [584, 1198] });
  });

  it('level value draws', () => {
    const level: [number, number, number][] = [[0, 1, 1], [1, 1, 1]];
    expect(hashTickOutcome(19, room, at(STOP, level))).toEqual({ kind: 'draw', by: 'time', forces: [292, 292] });
  });

  it('the clock starts at the BELL, not the match start: an early bell moves the stop with it', () => {
    expect(hashTickOutcome(19, room, at(STOP, ahead0, { setupBellTick: BELL + 100 }))).toBeNull();
    expect(hashTickOutcome(19, room, at(STOP + 100, ahead0, { setupBellTick: BELL + 100 }))).toEqual({ kind: 'won', side: 0, by: 'time', forces: [1198, 584] });
  });

  it('only a flag set-up room: the same sim in any other room plays on (the map cap is 25 minutes)', () => {
    for (const other of [{ hashEveryTicks: 20, map: 'milh_flats_l', winMode: 'flag' }, { hashEveryTicks: 20, map: 'milh_flats_l' }, { hashEveryTicks: 20, map: 'milh_flats_l', winMode: 'points' }, { hashEveryTicks: 20, map: 'milh_flats_l', winMode: 'points', flagSetup: true }, { hashEveryTicks: 20, map: 'milh_flats_l', flagSetup: true }]) {
      expect(hashTickOutcome(19, other as MatchConfig, at(STOP, ahead0))).toBeNull();
    }
  });

  it('never before the bell, and never in a world with no set-up (an old test double reads as no backstop)', () => {
    expect(hashTickOutcome(19, room, at(STOP, ahead0, { setupActive: true }))).toBeNull();
    expect(hashTickOutcome(19, room, at(STOP, ahead0, { setupBellTick: -1 }))).toBeNull();
    expect(hashTickOutcome(19, room, { ...world(ahead0), unitTypes: REAL, tickCount: STOP })).toBeNull();
    // A bell but no `setupActive` at all (a double that cannot say whether the set-up is over) is not a rung bell.
    expect(hashTickOutcome(19, room, { ...at(STOP, ahead0), setupActive: undefined })).toBeNull();
  });

  it('a goal completed by then still wins by the objective, ahead of the value rule', () => {
    const goals: OutcomeGoals = { mode: 'flag', sideWon: (s) => s === 1, scoreUnitsOf: () => 0, scoreOf: () => 0, completeTickOf: (s) => (s === 1 ? 100 : -1) };
    expect(hashTickOutcome(19, room, at(STOP, ahead0), undefined, goals)).toEqual({ kind: 'won', side: 1, by: 'objective', mode: 'flag' });
  });

  it('annihilation still ends it first, and the 30-minute cap is never reached', () => {
    expect(hashTickOutcome(19, room, at(STOP - 400, [[0, 1, 0], [1, 0, 1]]))).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    // Past the stop the rule has decided already: there is no ongoing sim at the cap tick to find.
    expect(hashTickOutcome(19, room, at(30 * 60 * 20, ahead0))).toEqual({ kind: 'won', side: 0, by: 'time', forces: [1198, 584] });
  });
});
