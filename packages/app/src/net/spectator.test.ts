import { describe, expect, it } from 'vitest';
import type { MatchConfig } from '@lions/net';
import type { Command } from '@lions/sim';
import { HUD_ELEMENTS } from '../ui/hud-elements';
import type { MatchScore } from './scoreboard';
import { SPECTATOR_SHOWN, VIEW_CHOICES, WAIT_MS, roundOf, spectatorSink, stripText, viewerFor, waitingOnPlayers, type StripInput } from './spectator';

const seats = (s0: 0 | 1, s1: 0 | 1): MatchConfig['seats'] => [
  { seat: 0, side: s0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'A', kind: 'bot' },
  { seat: 1, side: s1, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'B', kind: 'bot' },
];
const SCORE: MatchScore = [
  { lost: 2, lostValue: 20, destroyed: 5, destroyedValue: 50, remaining: 800 },
  { lost: 5, lostValue: 50, destroyed: 2, destroyedValue: 20, remaining: 650 },
];
const BASE: StripInput = { phase: 'playing', n: 3, of: 4, labels: ['rush', 'passive'], score: SCORE, sides: [0, 1], tick: 560, roundTicks: 40, waiting: false, verdict: null, view: 'all' };

describe('a spectator has no command path (invariant 4)', () => {
  it('the sink takes any command and does nothing: it has no state to put one in', () => {
    const cmds: Command[] = [{ kind: 'halt', ids: [1] }, { kind: 'move', ids: [1], x: 0, y: 0 } as Command, { kind: 'attack', ids: [1], target: 2 } as Command];
    for (const c of cmds) expect(spectatorSink.queueCommand(c)).toBeUndefined();
    expect(Object.keys(spectatorSink)).toEqual(['queueCommand']);
  });
  it('the HUD it is given has no orders, dock, groups, speed, radio, hint, conduct, logistics, intel or objectives', () => {
    for (const el of ['orders', 'dock', 'groups', 'speed', 'radio', 'hint', 'conduct', 'logistics', 'intel', 'objective', 'objectives'] as const) {
      expect(SPECTATOR_SHOWN.has(el), el).toBe(false);
    }
    // Only real HUD elements, and the map and the unit card are kept.
    for (const el of SPECTATOR_SHOWN) expect(HUD_ELEMENTS).toContain(el);
    expect(SPECTATOR_SHOWN.has('minimap')).toBe(true);
    expect(SPECTATOR_SHOWN.has('card')).toBe(true);
  });
});

describe('the view toggle', () => {
  it('Both sides is the default and the first choice; A and B are seat 0\'s and seat 1\'s SIDES', () => {
    expect(VIEW_CHOICES).toEqual(['all', 'a', 'b']);
    expect(viewerFor('all', seats(0, 1))).toBe('all');
    expect(viewerFor('a', seats(0, 1))).toBe(0);
    expect(viewerFor('b', seats(0, 1))).toBe(1);
    // A Sarim host is seat 0 on side 1 (LD1): Side A is that seat's side.
    expect(viewerFor('a', seats(1, 0))).toBe(1);
    expect(viewerFor('b', seats(1, 0))).toBe(0);
  });
});

describe('the round and the wait', () => {
  it('rounds are 1-based and change on the round tick', () => {
    expect(roundOf(0, 40)).toBe(1);
    expect(roundOf(39, 40)).toBe(1);
    expect(roundOf(40, 40)).toBe(2);
    expect(roundOf(560, 40)).toBe(15);
  });
  it('waiting on the players: only on a round tick, caught up, after 300 ms with no frame, and not over', () => {
    const at = { tick: 560, roundTicks: 40, behind: 0, sinceMovedMs: WAIT_MS, over: false };
    expect(waitingOnPlayers(at)).toBe(true);
    expect(waitingOnPlayers({ ...at, sinceMovedMs: WAIT_MS - 1 })).toBe(false);
    expect(waitingOnPlayers({ ...at, tick: 561 })).toBe(false);     // mid-round: the room is simply between frames
    expect(waitingOnPlayers({ ...at, behind: 3 })).toBe(false);     // still catching up, not waiting
    expect(waitingOnPlayers({ ...at, over: true })).toBe(false);
    expect(waitingOnPlayers({ ...at, roundTicks: 0 })).toBe(false);
  });
});

describe('stripText', () => {
  it('reads game n of m, the players, the score by SEAT, the round and the tick', () => {
    const s = stripText(BASE);
    expect(s.game).toBe('Game 3 of 4');
    expect(s.players).toBe('rush vs passive');
    expect(s.score).toBe('Destroyed 5 : 2');
    expect(s.force).toBe('Force left 800 : 650');
    expect(s.clock).toBe('Round 15 · 0:28 · tick 560');
    expect(s.status).toBeNull();
    expect(s.views.map((v) => [v.choice, v.on])).toEqual([['all', true], ['a', false], ['b', false]]);
  });
  it('seat 1 on side 0 reads side 0\'s line: the board is by side, the strip by seat', () => {
    const s = stripText({ ...BASE, sides: [1, 0] });
    expect(s.score).toBe('Destroyed 2 : 5');
    expect(s.force).toBe('Force left 650 : 800');
  });
  it('says "Round N: waiting on the players" only while playing and waiting', () => {
    expect(stripText({ ...BASE, waiting: true }).status).toBe('Round 15: waiting on the players');
    expect(stripText({ ...BASE, phase: 'finished', waiting: true }).status).toBeNull();
    expect(stripText({ ...BASE, waiting: false }).status).toBeNull();
  });
  it('the phases between games say what is awaited, and the verdict names the winner by seat', () => {
    expect(stripText({ ...BASE, phase: 'between', score: null, verdict: { outcome: 'seat1', by: 'cap' } })).toMatchObject({ status: 'Waiting for the next game', verdict: 'Game 3: passive won', score: null, clock: null });
    expect(stripText({ ...BASE, phase: 'done', verdict: { outcome: 'draw', by: 'cap' } })).toMatchObject({ status: 'The run is complete', verdict: 'Game 3: a draw' });
    expect(stripText({ ...BASE, phase: 'finished', verdict: { outcome: 'void', by: 'desync' } }).verdict).toBe('Game 3: no result');
    expect(stripText({ ...BASE, phase: 'no-run' }).status).toContain('pnpm arena --watch');
    expect(stripText({ ...BASE, phase: 'refused' }).status).toContain('link');
    expect(stripText({ ...BASE, phase: 'connecting' }).status).toBe('Joining the game');
  });
});
