import { describe, expect, it } from 'vitest';
import type { Frame, MatchConfig, MatchTransport, TransportStatus } from '@lions/net';
import { sandboxAnchors } from '../sandbox-anchors';
import { runFrames, seatWorldFor } from './frame-step';
import { forcesOf, hashTickOutcome, unitCost, type OutcomeSim } from './outcome';
import { scoreFor, scoreOf, showsScoreboard, type MatchScore, type ScoreSim } from './scoreboard';
import { versusSpawns } from './versus-force';
import { buildWorld } from './versus-world.test-helper';

const TYPES = [
  { id: 'tank', weapons: [1], stepPerTick: 3000, isAir: false },
  { id: 'rifles', weapons: [1], stepPerTick: 3000, isAir: false },
] as const;
const COST: Record<string, number> = { tank: 500, rifles: 100 };
const costOf = (id: string): number => COST[id] ?? 0;

/** One row per unit: [side, alive, typeIdx, removed?]. */
function world(rows: ([number, number, number] | [number, number, number, number])[]): ScoreSim {
  return {
    entityCount: rows.length,
    state: {
      side: Uint8Array.from(rows.map((u) => u[0])),
      alive: Uint8Array.from(rows.map((u) => u[1])),
      typeIdx: Uint16Array.from(rows.map((u) => u[2])),
      mobilityKilled: new Uint8Array(rows.length),
      removed: Uint8Array.from(rows.map((u) => u[3] ?? 0)),
    },
    unitTypes: TYPES,
  };
}

describe('scoreOf: the board, from sim state alone', () => {
  it('counts each side\'s dead as its losses and the other side\'s kills, with their value', () => {
    // Side 0 lost a rifle squad; side 1 lost a tank and a rifle squad.
    const sim = world([[0, 1, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [1, 1, 1]]);
    expect(scoreOf(sim, costOf)).toEqual([
      { lost: 1, lostValue: 100, destroyed: 2, destroyedValue: 600, remaining: 500 },
      { lost: 2, lostValue: 600, destroyed: 1, destroyedValue: 100, remaining: 100 },
    ]);
  });

  it('remaining is forcesOf, the number a stalemate or the time limit is decided on', () => {
    const sim = world([[0, 1, 0], [0, 1, 1], [0, 0, 0], [1, 1, 1], [1, 0, 0]]);
    const score = scoreOf(sim, costOf);
    expect([score[0].remaining, score[1].remaining]).toEqual(forcesOf(sim as OutcomeSim, costOf));
  });

  it('a third side (civilians) is nobody\'s loss and nobody\'s kill', () => {
    const sim = world([[0, 1, 0], [1, 1, 0], [2, 0, 1]]);
    const [a, b] = scoreOf(sim, costOf);
    expect([a.lost, a.destroyed, b.lost, b.destroyed]).toEqual([0, 0, 0, 0]);
  });

  it('a unit taken off the board without a fight (removed) is no loss', () => {
    const sim = world([[0, 1, 0], [1, 0, 1, 1], [1, 1, 0]]);
    expect(scoreOf(sim, costOf)[1]).toMatchObject({ lost: 0, lostValue: 0 });
    expect(scoreOf(sim, costOf)[0]).toMatchObject({ destroyed: 0, destroyedValue: 0 });
  });

  it('prices by the unit data\'s logistics cost by default', () => {
    const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
    const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
    const victim = force.bySide[1][0];
    sim.debugKill(victim);
    const cost = unitCost(sim.unitTypes[sim.state.typeIdx[victim]].id);
    expect(cost).toBeGreaterThan(0);
    expect(scoreOf(sim)[0]).toMatchObject({ destroyed: 1, destroyedValue: cost });
    expect(scoreOf(sim)[1]).toMatchObject({ lost: 1, lostValue: cost });
  });
});

describe('scoreFor: each seat reads its own line first', () => {
  const score: MatchScore = [
    { lost: 1, lostValue: 100, destroyed: 2, destroyedValue: 600, remaining: 500 },
    { lost: 2, lostValue: 600, destroyed: 1, destroyedValue: 100, remaining: 100 },
  ];
  it('side 1 reads side 1 as its own', () => {
    expect(scoreFor(score, 1)).toEqual({ mine: score[1], theirs: score[0] });
    expect(scoreFor(score, 0)).toEqual({ mine: score[0], theirs: score[1] });
  });
});

describe('showsScoreboard: versus rooms only', () => {
  it('a versus room shows it; a sandbox room and single-player do not', () => {
    expect(showsScoreboard({ mode: 'versus' })).toBe(true);
    expect(showsScoreboard({ mode: 'sandbox' })).toBe(false);
    expect(showsScoreboard(null)).toBe(false);
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

describe('both seats show the same board (2026-10-14)', () => {
  it('two seats on the real mirror world, batched 3 and 8, read the same board on every tick they share, and at the end', () => {
    const cfg = { hashEveryTicks: 20, dataDigest: 0, seats: [{ side: 0 }, { side: 1 }] } as unknown as MatchConfig;
    const seat = (batch: number) => {
      const { sim, typeOf, map } = buildWorld('beit_sahwan_outskirts');
      const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
      // The same battle on both machines: losses on both sides over the
      // match, then side 1's last armed unit at tick 50.
      const runTick = (): void => {
        sim.tick();
        if (sim.tickCount === 5) sim.debugKill(force.bySide[0][0]);
        if (sim.tickCount === 13) { sim.debugKill(force.bySide[1][0]); sim.debugKill(force.bySide[1][1]); }
        if (sim.tickCount === 31) sim.debugKill(force.bySide[0][2]);
        if (sim.tickCount === 50) {
          for (const id of force.bySide[1]) if (sim.unitTypes[sim.state.typeIdx[id]].weapons.length > 0) sim.debugKill(id);
        }
      };
      let decided: ReturnType<typeof hashTickOutcome> = null;
      const step = {
        transport: new Frames(200), sim, seatWorld: seatWorldFor(cfg, sim), runTick, config: cfg,
        stopAfter: (tick: number) => (decided ??= hashTickOutcome(tick, cfg, sim)) !== null,
      };
      // The frame loop, as main.ts runs it: step, then read the board.
      const boards = new Map<number, MatchScore>();
      for (let i = 0; i < 200 && decided === null; i++) {
        runFrames(step, batch);
        boards.set(sim.tickCount, scoreOf(sim));
      }
      return { decided, boards, final: scoreOf(sim) };
    };
    const a = seat(3);
    const b = seat(8);
    expect(a.decided).toEqual(b.decided);
    // Ticks both frame loops happened to read the board on: 24 and 48 at least.
    const shared = [...a.boards.keys()].filter((tick) => b.boards.has(tick));
    expect(shared.length).toBeGreaterThan(1);
    for (const tick of shared) expect(b.boards.get(tick)).toEqual(a.boards.get(tick));
    expect(b.final).toEqual(a.final);
    // The board is from both sides' view at once: seat 0's own line is
    // seat 1's "theirs", number for number.
    expect(scoreFor(a.final, 0).mine).toEqual(scoreFor(b.final, 1).theirs);
    expect(scoreFor(a.final, 0).theirs).toEqual(scoreFor(b.final, 1).mine);
    expect(a.final[0].lost).toBe(2);
    expect(a.final[0].destroyed).toBe(a.final[1].lost);
  });
});

