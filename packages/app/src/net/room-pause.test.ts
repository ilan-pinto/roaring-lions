import { describe, expect, it } from 'vitest';
import { PAUSES_PER_SEAT } from '@lions/net';
import { escapeOpensPause, pauseEndClosesMenu, roomPauseCall, surrenderOffered } from './room-pause';

// N1b task 8, R-B17: the room silently ignores a pause it refuses, so the
// client decides from its own count (the last `paused` it saw) whether to ask
// at all, and whether to say there is nothing left to ask for.
describe('roomPauseCall', () => {
  it('a running room with pauses left: ask for one, no note', () => {
    expect(roomPauseCall({ kind: 'live', behind: 0 }, PAUSES_PER_SEAT)).toEqual({ send: true, note: false });
    expect(roomPauseCall({ kind: 'stalled', reason: 'behind', seat: 1 }, 1)).toEqual({ send: true, note: false });
  });
  it('a running room with none left: do not ask, and say the match keeps running', () => {
    expect(roomPauseCall({ kind: 'live', behind: 0 }, 0)).toEqual({ send: false, note: true });
  });
  it('a room already paused (either seat): just the menu, no pause spent, no note', () => {
    expect(roomPauseCall({ kind: 'paused', seat: 1, untilMs: 5 }, 2)).toEqual({ send: false, note: false });
    expect(roomPauseCall({ kind: 'paused', seat: 0, untilMs: 5 }, 0)).toEqual({ send: false, note: false });
  });
  it('a room that is not running (waiting, closed, desync): nothing to pause, nothing to say', () => {
    expect(roomPauseCall({ kind: 'waiting' }, 3)).toEqual({ send: false, note: false });
    expect(roomPauseCall({ kind: 'closed', reason: 'surrender' }, 0)).toEqual({ send: false, note: false });
    expect(roomPauseCall({ kind: 'desync', tick: 9 }, 3)).toEqual({ send: false, note: false });
  });
});

// N1b task 10 (R-B11): once a match is over, nothing offers to pause it or to
// give it up.
describe('surrenderOffered', () => {
  it('a running or paused match can be surrendered', () => {
    expect(surrenderOffered({ kind: 'live', behind: 0 })).toBe(true);
    expect(surrenderOffered({ kind: 'stalled', reason: 'gone', seat: 1 })).toBe(true);
    expect(surrenderOffered({ kind: 'paused', seat: 0, untilMs: 5 })).toBe(true);
  });
  it('an ended room (left, surrender, void, expired) or a desync offers Quit instead', () => {
    expect(surrenderOffered({ kind: 'closed', reason: 'surrender' })).toBe(false);
    expect(surrenderOffered({ kind: 'closed', reason: 'left' })).toBe(false);
    expect(surrenderOffered({ kind: 'desync', tick: 9 })).toBe(false);
    expect(surrenderOffered({ kind: 'waiting' })).toBe(false);
  });
});

describe('escapeOpensPause', () => {
  const s = { paused: false, missionEnded: false, matchOver: false };
  it('opens the menu while nothing has ended and it is not already open', () => {
    expect(escapeOpensPause(s)).toBe(true);
  });
  it('not over the match-over panel, nor the mission end screen, nor an open menu', () => {
    expect(escapeOpensPause({ ...s, matchOver: true })).toBe(false);
    expect(escapeOpensPause({ ...s, missionEnded: true })).toBe(false);
    expect(escapeOpensPause({ ...s, paused: true })).toBe(false);
  });
});

// N1b final fix wave (T8 follow-up): the pauser's menu stayed open after the
// room's 90 s auto-resume, and the match ran on under the modal.
describe('pauseEndClosesMenu', () => {
  const mine = { kind: 'paused' as const, seat: 1 as const, untilMs: 90000 };
  const theirs = { kind: 'paused' as const, seat: 0 as const, untilMs: 90000 };
  it('this seat\'s own pause ended by itself and the match runs again: the open menu closes', () => {
    expect(pauseEndClosesMenu(mine, { kind: 'live', behind: 2 }, 1, true)).toBe(true);
    expect(pauseEndClosesMenu(mine, { kind: 'stalled', reason: 'behind', seat: 0 }, 1, true)).toBe(true);
  });
  it('the other seat\'s pause ending leaves a menu this seat opened for itself (its settings) open', () => {
    expect(pauseEndClosesMenu(theirs, { kind: 'live', behind: 2 }, 1, true)).toBe(false);
  });
  it('no menu open, or the pause still in force, or no pause to end: nothing to close', () => {
    expect(pauseEndClosesMenu(mine, { kind: 'live', behind: 2 }, 1, false)).toBe(false);
    expect(pauseEndClosesMenu(mine, mine, 1, true)).toBe(false);
    expect(pauseEndClosesMenu({ kind: 'live', behind: 0 }, { kind: 'live', behind: 0 }, 1, true)).toBe(false);
    expect(pauseEndClosesMenu({ kind: 'stalled', reason: 'behind', seat: 1 }, { kind: 'live', behind: 0 }, 1, true)).toBe(false);
  });
  it('a pause that ends in the match ending is not "running again": the end panel or the desync line takes over', () => {
    expect(pauseEndClosesMenu(mine, { kind: 'closed', reason: 'left' }, 1, true)).toBe(false);
    expect(pauseEndClosesMenu(mine, { kind: 'desync', tick: 40 }, 1, true)).toBe(false);
  });
});
