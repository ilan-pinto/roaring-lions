import { describe, expect, it } from 'vitest';
import { WsTransport, type Frame, type MatchConfig, type MatchTransport, type SocketLike, type TransportStatus } from '@lions/net';
import { sandboxAnchors } from '../sandbox-anchors';
import { runFrames, seatWorldFor } from './frame-step';
import { versusSpawns } from './versus-force';
import { buildWorld } from './versus-world.test-helper';
import { MATCH_CAP_TICKS, decideOnHashTick, forcesOf, hashTickOutcome, matchResult, outcomeOf, reportOver, roomEndingOutcome, unitCost, type LocalDecision, type OutcomeSim } from './outcome';

/** Type 0 is armed, type 1 is not (a drone, a truck), type 2 is armed and
 *  has no movement at all (speed 0). All but type 2 can move. */
const TYPES = [
  { id: 'armed', weapons: [1], stepPerTick: 3000 },
  { id: 'unarmed', weapons: [], stepPerTick: 3000 },
  { id: 'fixed', weapons: [1], stepPerTick: 0 },
] as const;
/** What each test type is worth. */
const COST: Record<string, number> = { armed: 300, unarmed: 100, fixed: 200 };
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
    const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
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
});

// The lead's ruling (2026-10-13): a stalemate, and the time limit, are
// decided by surviving unit value -- each living unit's logistics cost.
describe('stalemate and the time limit, by surviving unit value', () => {
  it('every unit on both sides immobile: the higher value wins at once, with both totals', () => {
    // Side 0: an immobilised tank (300) and a fixed gun (200). Side 1: two immobilised tanks... one of them dead.
    const sim = world([[0, 1, 0, 0, 1], [0, 1, 2], [1, 1, 0, 0, 1], [1, 0, 0]]);
    expect(outcomeOf(sim, 100, costOf)).toEqual({ kind: 'won', side: 0, by: 'stalemate', forces: [500, 300] });
    const flipped = world([[0, 1, 0, 0, 1], [1, 1, 0, 0, 1], [1, 1, 2]]);
    expect(outcomeOf(flipped, 100, costOf)).toEqual({ kind: 'won', side: 1, by: 'stalemate', forces: [300, 500] });
  });
  it('every unit immobile and equal value: a draw', () => {
    const sim = world([[0, 1, 0, 0, 1], [1, 1, 0, 0, 1]]);
    expect(outcomeOf(sim, 100, costOf)).toEqual({ kind: 'draw', by: 'stalemate', forces: [300, 300] });
  });
  it('one unit that can still move -- on either side, armed or not, knocked-out guns or not -- is no stalemate', () => {
    expect(outcomeOf(world([[0, 1, 0, 0, 1], [1, 1, 0, 0, 1], [1, 1, 0]]), 100, costOf)).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(world([[0, 1, 0, 0, 1], [0, 1, 1], [1, 1, 0, 0, 1]]), 100, costOf)).toEqual({ kind: 'ongoing' });
    expect(outcomeOf(world([[0, 1, 0, 0, 1], [1, 1, 0, 0, 1], [1, 1, 0, 1]]), 100, costOf)).toEqual({ kind: 'ongoing' });
  });
  it('a dead unit and a third side (civilians) neither block a stalemate nor count', () => {
    const sim = world([[0, 1, 2], [0, 0, 0], [1, 1, 0, 0, 1], [2, 1, 0]]);
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
    versusSpawns(sim, typeOf, sandboxAnchors(map));
    const [a, b] = forcesOf(sim);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(a);   // the mirror match: the same force on each side
  });
  it('the real sim exposes the flag and the speed the rule reads: every unit mobility-killed is a stalemate', () => {
    const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
    const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
    expect(outcomeOf(sim, sim.tickCount)).toEqual({ kind: 'ongoing' });
    expect(force.bySide.flat().every((id) => sim.unitTypes[sim.state.typeIdx[id]].stepPerTick > 0)).toBe(true);
    // Test-only: the hit table is random, so the flag the sim sets on a `mobility_kill` is set here directly.
    for (const id of force.bySide.flat()) sim.state.mobilityKilled[id] = 1;
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
      const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
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
      const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
      // The same battle on both machines: at tick 7 side 1 loses its first unit, and every unit
      // left on both sides is immobilised (test-only: the flag a `mobility_kill` sets).
      const runTick = (): void => {
        sim.tick();
        if (sim.tickCount === 7) {
          sim.debugKill(force.bySide[1][0]);
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
    reportOver(t, local.result, local);
    reportOver(t, local.result, local);
    expect(overs()).toEqual([{ t: 'over', tick: 399 }]);
  });
  it('a panel showing a room\'s ending (a surrender, a leave) sends nothing, decided sim or not', () => {
    const { t, overs, recv } = wired();
    recv({ t: 'start', config: CONFIG_FOR_WIRE });
    const surrendered = roomEndingOutcome('surrender', 1, 0, (s) => s);
    const left = roomEndingOutcome('left', undefined, 0, (s) => s);
    for (const shown of [surrendered, left]) {
      if (shown === null) throw new Error('a room ending with no result');
      reportOver(t, shown, null);
      reportOver(t, shown, { result: { ...local.result }, tick: 399 });   // an equal result is not the sim's own
    }
    expect(overs()).toEqual([]);
  });
  it('no room (single-player) is never asked', () => {
    expect(() => reportOver(null, local.result, local)).not.toThrow();
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
