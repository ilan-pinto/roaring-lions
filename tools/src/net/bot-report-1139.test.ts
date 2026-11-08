// GH-1139, the lead's flag bot match of 8 Nov: three `observe` findings, each held by a case that was watched going red.
//   1. `flags`: both lines read `raiding` with a `held` count, and the bot could not tell whose raid was whose.
//   2. The win condition was never stated to the bot (the prompt names a mode only when `pnpm bot` is given `--mode`).
//   3. A destroyed unit was not in `observe`, only a `died` fate on an order.
// Real worlds and, for 3, the real `MatchRoom` (`test-room.ts`). No model, no key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fx } from '@lions/sim';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';
import type { FlagView } from '../../../packages/app/src/net/flag-view';
import { modeConfig } from '../backtest/versus-modes';
import { AgentClient } from './agent-client';
import { botPrompt } from './bot';
import { FogTracker } from './fog-tracker';
import { createContext, LOST_LISTED, TOOLS, type ToolContext, type ToolResult } from './mcp-tools';
import { ROOM_BUILD, ROOM_CODE, ROOM_NOW, newRoom, play, type Loop } from './test-room';
import { flagBoardOf, sideView } from './view';

describe('GH-1139 item 1: each flag line names whose raid it is and whose count runs', () => {
  const line = (state: FlagView['mine']['state'], held: number): FlagView['mine'] => ({ at: [1, 2, 5, 5], state, held });
  it('from the line alone: raider is fixed by the line, holder follows the count, secondsLeft counts down (literals)', () => {
    const b = flagBoardOf({ holdSeconds: 30, mine: line('raiding', 16), theirs: line('raiding', 22) });
    expect(b.mine).toEqual({ at: [1, 2, 5, 5], state: 'raiding', held: 16, raider: 'enemy', holder: 'enemy', secondsLeft: 14 });
    expect(b.theirs).toEqual({ at: [1, 2, 5, 5], state: 'raiding', held: 22, raider: 'you', holder: 'you', secondsLeft: 8 });
    const quiet = flagBoardOf({ holdSeconds: 45, mine: line('open', 0), theirs: line('contested', 0) });
    expect([quiet.mine.holder, quiet.mine.secondsLeft, quiet.theirs.holder, quiet.theirs.secondsLeft]).toEqual([null, null, null, null]);
    expect([quiet.mine.raider, quiet.theirs.raider]).toEqual(['enemy', 'you']);
    const won = flagBoardOf({ holdSeconds: 45, mine: line('open', 0), theirs: line('captured', 45) });
    expect([won.theirs.holder, won.theirs.secondsLeft]).toEqual(['you', 0]);
  });

  it('the lead\'s board: on wadi_tarfan_l both sides raid at once, and each seat reads its own count as `you` and the other as `enemy`', () => {
    const w = buildMatchWorld(modeConfig('wadi_tarfan_l', 'flag', 4000));
    const living = (side: 0 | 1): number[] => w.bySide[side].filter((id) => w.sim.state.alive[id] === 1);
    // Both seats attack-move everything on the other's flag at the opening, as the bot did (the probe's flag ground, from the view).
    const v0 = sideView(w, 0, new FogTracker(w.sim, 0), null).flags!;
    const v1 = sideView(w, 1, new FogTracker(w.sim, 1), null).flags!;
    const centre = (r: readonly number[]): [number, number] => [fx.from(r[0] + r[2] / 2), fx.from(r[1] + r[3] / 2)];
    let both: { a: ReturnType<typeof flagBoardOf>; b: ReturnType<typeof flagBoardOf> } | null = null;
    for (let t = 0; t < 1000 && both === null; t++) {
      if (t % 400 === 0) {
        for (const [side, target] of [[0, v0.theirs.at], [1, v1.theirs.at]] as const) {
          const [x, y] = centre(target);
          w.sim.queueCommand({ kind: 'attackMove', ids: living(side), x, y });
        }
      }
      matchTick(w);
      const a = sideView(w, 0, new FogTracker(w.sim, 0), null).flags!;
      const b = sideView(w, 1, new FogTracker(w.sim, 1), null).flags!;
      if (a.mine.state === 'raiding' && a.theirs.state === 'raiding' && a.theirs.held >= 1) both = { a, b };
    }
    expect(both, 'both raids ran at once (the board the bot misread)').not.toBeNull();
    const { a, b } = both!;
    // Premise: both lines read `raiding`, exactly the report.
    expect([a.mine.state, a.theirs.state]).toEqual(['raiding', 'raiding']);
    expect([a.mine.holder, a.theirs.holder]).toEqual(['enemy', 'you']);
    expect([b.mine.holder, b.theirs.holder]).toEqual(['enemy', 'you']);
    // One raid read from two chairs: side 0's own count is side 1's enemy count.
    expect(a.theirs.secondsLeft).toBe(b.mine.secondsLeft);
    expect(a.theirs.secondsLeft).toBe(a.holdSeconds - a.theirs.held);
  });
});

describe('GH-1139 item 2: observe states how THIS match is won, from the room\'s own rules', () => {
  const winOf = (c: Parameters<typeof buildMatchWorld>[0]): string => { const w = buildMatchWorld(c); return sideView(w, 0, new FogTracker(w.sim, 0), null).win; };
  it('a v1 flag room: the hold, both flags, and that aircraft count', () => {
    const win = winOf(modeConfig('wadi_tarfan_l', 'flag', 4000));
    expect(win).toMatch(/^CAPTURE THE FLAG\./);
    expect(win).toContain('for 30 s in one go');
    expect(win).toContain('`flags.theirs.at`');
    expect(win).toContain('You LOSE the same way');
    expect(win).toContain('aircraft included');
  });
  it('a set-up flag room: the staged 45 s hold, ground units only, and the 30-minute cap', () => {
    const win = winOf({ ...modeConfig('wadi_tarfan', 'flag', 4000), flagSetup: true });
    expect(win).toContain('for 45 s in one go');
    expect(win).toContain('aircraft do not');
    expect(win).toContain('(30 minutes;');
  });
  it('the other rooms say their own rule', () => {
    expect(winOf(modeConfig('wadi_tarfan', 'points', 4000))).toMatch(/^POINTS RACE\. The first side to bank 600 points/);
    expect(winOf(modeConfig('wadi_tarfan', 'camp', 4000))).toMatch(/^DESTROY THE ENEMY CAMP\./);
    expect(winOf({ ...modeConfig('wadi_tarfan', 'flag', 4000), winMode: undefined })).toMatch(/^ANNIHILATION\./);
  });
  it('the bot is told to read it whatever --mode it was given, and how to read the flag board', () => {
    for (const p of [botPrompt({ room: 'ABCDEF', seat: 1 }), botPrompt({ room: 'ABCDEF', seat: 1, winMode: 'flag' })]) {
      expect(p).toContain('`win` states how THIS match is won');
      expect(p).toContain('`flags.mine.holder` is `enemy`');
      expect(p).toContain('under `lost`');
    }
  });
  it('the observe tool says so', () => {
    const d = TOOLS.find((t) => t.name === 'observe')?.description ?? '';
    expect(d).toContain('`win`: how THIS match is won');
    expect(d).toContain('`holder`: whose count runs now');
    expect(d).toContain(`\`lost\`: your units no longer in play, newest first, at most ${LOST_LISTED}`);
  });
});

// ---- item 3: the real room, as `bot-report-fixes.test.ts` drives it ----

beforeEach(() => { vi.useFakeTimers({ now: ROOM_NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

function join(loop: Loop, ticket: string, seat: 0 | 1): AgentClient {
  return new AgentClient({ server: 'https://room.test', code: ROOM_CODE, ticket, build: ROOM_BUILD, role: 'seat', seat, log: () => {}, open: () => loop.open() });
}
async function call(ctx: ToolContext, name: string): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool.run(ctx, {});
}
const body = (r: ToolResult): Record<string, any> => JSON.parse(r.text) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('GH-1139 item 3: observe lists the seat\'s own lost units', () => {
  it('a unit that dies is listed under `lost` with its type, fate and tick, newest first; before, `lost` is empty', async () => {
    const room = await newRoom({});
    const a = join(room.loop, await room.ticket(0), 0);
    const c = join(room.loop, await room.ticket(1), 1);
    await room.loop.flush();
    await Promise.all([a.ready, c.ready]);
    await play(room.loop, 10, [a, c], () => a.tick() >= 5 && c.tick() >= 5);
    const ctx = createContext(a, 'command');
    expect(body(await call(ctx, 'observe')).lost).toEqual([]);
    const w = a.world() as MatchWorld;
    const sims = [a, c].map((cl) => (cl.world() as MatchWorld).sim);
    const [first, second] = a.view().units.map((u) => u.id);
    const typeOf = (id: number): string => w.sim.unitTypes[w.sim.state.typeIdx[id]].id;
    for (const sim of sims) sim.debugKill(first);
    const at = a.tick();
    await play(room.loop, 10, [a, c], () => a.tick() >= at + 3 && c.tick() >= at + 3);
    for (const sim of sims) sim.debugKill(second);
    const at2 = a.tick();
    await play(room.loop, 10, [a, c], () => a.tick() >= at2 + 3 && c.tick() >= at2 + 3);
    const o = body(await call(ctx, 'observe'));
    expect(o.lost).toEqual([
      { id: second, type: typeOf(second), fate: 'died', tick: expect.any(Number) },
      { id: first, type: typeOf(first), fate: 'died', tick: expect.any(Number) },
    ]);
    expect(o.lost[0].tick).toBeGreaterThan(o.lost[1].tick);
    expect(o.units.map((u: { id: number }) => u.id)).not.toContain(first);
  });
});
