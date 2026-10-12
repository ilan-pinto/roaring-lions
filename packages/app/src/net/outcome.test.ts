import { describe, expect, it } from 'vitest';
import type { Frame, MatchConfig, MatchTransport, TransportStatus } from '@lions/net';
import { sandboxAnchors } from '../sandbox-anchors';
import { runFrames, seatWorldFor } from './frame-step';
import { versusSpawns } from './versus-force';
import { buildWorld } from './versus-world.test-helper';
import { MATCH_CAP_TICKS, hashTickOutcome, matchResult, outcomeOf, roomEndingOutcome, type OutcomeSim } from './outcome';

/** Type 0 is armed, type 1 is not (a drone, a truck). */
const TYPES = [{ weapons: [1] }, { weapons: [] }] as const;

/** One row per unit: [side, alive, typeIdx]. */
function world(units: [number, number, number][]): OutcomeSim {
  return {
    entityCount: units.length,
    state: {
      side: Uint8Array.from(units.map((u) => u[0])),
      alive: Uint8Array.from(units.map((u) => u[1])),
      typeIdx: Uint16Array.from(units.map((u) => u[2])),
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

  it("both sides' armed units dead on the same tick: a mutual draw", () => {
    const sim = world([[0, 0, 0], [0, 1, 1], [1, 0, 0], [1, 1, 1]]);
    expect(outcomeOf(sim, 100)).toEqual({ kind: 'draw', by: 'mutual' });
  });

  it('the cap with both standing: a draw on time', () => {
    const sim = world([[0, 1, 0], [1, 1, 0]]);
    expect(outcomeOf(sim, MATCH_CAP_TICKS)).toEqual({ kind: 'draw', by: 'time' });
    expect(outcomeOf(sim, MATCH_CAP_TICKS - 1)).toEqual({ kind: 'ongoing' });
  });

  it('a third side (civilians) neither keeps a side standing nor wins', () => {
    const sim = world([[0, 1, 0], [2, 1, 0]]);
    expect(outcomeOf(sim, 100)).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('is 25 minutes of 20 Hz ticks', () => {
    expect(MATCH_CAP_TICKS).toBe(30_000);
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
    expect(hashTickOutcome(MATCH_CAP_TICKS - 1, cfg, standing)).toEqual({ kind: 'draw', by: 'time' });
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
});
