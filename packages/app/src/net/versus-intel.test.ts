/**
 * #559 F1: in a versus room nothing charges for intel. `callStrike` and
 * `reveal` are priced, cooled down and ranged only by the MissionRuntime
 * (`mission.ts`), and a room runs none -- so before this fix a modded client
 * could call a precision strike every frame, from any unit, anywhere on the
 * map, and both clients would run it. The ownership check now drops both
 * kinds in versus, on both machines alike. Driven the way a room's frame
 * reaches the sim: `runFrames` -> `applyFrame` -> `validateCommand` -> `Sim`.
 */
import { describe, expect, it } from 'vitest';
import type { Frame, MatchConfig, MatchTransport, TransportStatus } from '@lions/net';
import type { Command } from '@lions/sim';
import { versusAnchors } from './versus-seats';
import { runFrames, seatWorldFor } from './frame-step';
import { versusSpawns } from './versus-force';
import { buildWorld } from './versus-world.test-helper';

const config = (mode: MatchConfig['mode']): MatchConfig => ({
  matchId: 'ABCDEF', code: 'ABCDEF', seed: 5, map: 'tel_marum', mode,
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'a', kind: 'human' },
    { seat: 1, side: mode === 'versus' ? 1 : 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'b', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
});

class Frames implements MatchTransport {
  readonly local = false;
  constructor(private readonly frames: Frame[]) {}
  queueCommand(): void {}
  take(max: number): Frame[] { return this.frames.splice(0, max); }
  reportTick(): void {}
  status(): TransportStatus { return { kind: 'live', behind: this.frames.length }; }
  close(): void {}
}

/** Seat 0 calls a strike on every enemy unit, every frame for 20 frames, and
 *  reveals the enemy camp; then the world runs on long enough for every
 *  strike to land. Returns side 1's total hp before and after, and what the
 *  ownership check dropped. */
function strikeEverything(mode: MatchConfig['mode']): { before: number; after: number; dropped: number; revealed: number; enemies: number } {
  const { sim, typeOf, map } = buildWorld('tel_marum');
  const force = versusSpawns(sim, typeOf, versusAnchors(map));
  const caller = force.bySide[0][0];
  const enemies = force.bySide[1];
  const hpOf = (ids: number[]): number => ids.reduce((a, i) => a + (sim.state.alive[i] ? sim.state.hp[i] : 0), 0);
  const frames: Frame[] = [];
  let seq = 0;
  for (let tick = 0; tick < 20; tick++) {
    const cmds = enemies.map((e) => ({ seat: 0 as const, seq: seq++, cmd: { kind: 'callStrike', caller, x: sim.state.posX[e], y: sim.state.posY[e] } as Command }));
    if (tick === 0) cmds.push({ seat: 0, seq: seq++, cmd: { kind: 'reveal', side: 0, x: sim.state.posX[enemies[0]], y: sim.state.posY[enemies[0]] } });
    frames.push({ tick, cmds });
  }
  for (let tick = 20; tick < 140; tick++) frames.push({ tick, cmds: [] });
  const cfg = config(mode);
  const before = hpOf(enemies);
  let revealed = 0;
  const { dropped } = runFrames({
    transport: new Frames(frames), sim, seatWorld: seatWorldFor(cfg, sim), config: cfg,
    runTick: () => { for (const e of sim.tick()) if (e.kind === 'revealed') revealed += e.count; },
  }, 1000);
  return { before, after: hpOf(enemies), dropped, revealed, enemies: enemies.length };
}

describe('versus: intel is not free (#559 F1)', () => {
  it('a strike or reveal a modded client sends in versus is dropped on both machines, and the enemy is untouched', () => {
    const r = strikeEverything('versus');
    expect(r.dropped).toBe(20 * r.enemies + 1);
    expect(r.revealed).toBe(0);
    expect(r.after).toBe(r.before);
  });

  it('the control: the same frames in a sandbox room still reach the sim (the check names versus only)', () => {
    const r = strikeEverything('sandbox');
    expect(r.after).toBeLessThan(r.before);
  });
});
