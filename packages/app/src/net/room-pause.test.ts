import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAUSES_PER_SEAT, WsTransport, type MatchConfig, type SocketLike } from '@lions/net';
import { applyIntent, type PlayerIntent } from '../input/intents';
import { escapeOpensPause, hudExit, ordersWait, pauseEndClosesMenu, roomOrderSink, roomPauseCall, surrenderOffered } from './room-pause';

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

// N1b final fix wave (M-1): in a room the HUD's exit was the sandbox's
// unconfirmed-by-the-room "leave free play". It now asks what the pause menu
// asks.
describe('hudExit', () => {
  it('single-player keeps the HUD\'s own leave confirm, whatever the status', () => {
    expect(hudExit(false, { kind: 'local' })).toBe('hud');
    expect(hudExit(false, { kind: 'live', behind: 0 })).toBe('hud');
  });
  it('a room whose match can still be given up: the confirmed Surrender', () => {
    expect(hudExit(true, { kind: 'live', behind: 0 })).toBe('surrender');
    expect(hudExit(true, { kind: 'stalled', reason: 'gone', seat: 0 })).toBe('surrender');
    expect(hudExit(true, { kind: 'paused', seat: 1, untilMs: 5 })).toBe('surrender');
  });
  it('a room already over (ended, voided, waiting): the pause menu\'s Quit, never the HUD\'s free-play leave', () => {
    expect(hudExit(true, { kind: 'closed', reason: 'surrender' })).toBe('quit');
    expect(hudExit(true, { kind: 'desync', tick: 40 })).toBe('quit');
    expect(hudExit(true, { kind: 'waiting' })).toBe('quit');
  });
});

// L-2 (lead ruling M-4, R-B27): the room refuses a cmd under a pause, for both
// seats; the client does not send one either, and says why. Driven through a
// real WsTransport on a fake socket, so "does not reach send" is the wire.
describe('orders wait while the room is paused', () => {
  const CONFIG: MatchConfig = {
    matchId: 'm', code: 'ABCDEF', seed: 1, map: 'x', mode: 'sandbox',
    seats: [
      { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'A', kind: 'human' },
      { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'B', kind: 'human' },
    ],
    pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
  };
  const MAP = { width: 48, height: 48 };
  function room(): { t: WsTransport; cmds: () => unknown[]; recv(msg: unknown): void } {
    const sent: string[] = [];
    const sock: SocketLike & { open(): void } = {
      onopen: null, onmessage: null, onclose: null,
      send: (d) => { sent.push(d); },
      close: () => {},
      open: () => { sock.onopen?.({}); },
    };
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    const recv = (msg: unknown): void => { sock.onmessage?.({ data: JSON.stringify(msg) }); };
    recv({ t: 'start', config: CONFIG });
    return { t, cmds: () => sent.map((x) => JSON.parse(x) as { t: string }).filter((m) => m.t === 'cmd'), recv };
  }

  it('ordersWait is true for a paused room (either seat\'s pause) and for nothing else', () => {
    expect(ordersWait({ kind: 'paused', seat: 0, untilMs: 5 })).toBe(true);
    expect(ordersWait({ kind: 'paused', seat: 1, untilMs: 5 })).toBe(true);
    expect(ordersWait({ kind: 'live', behind: 0 })).toBe(false);
    expect(ordersWait({ kind: 'stalled', reason: 'gone', seat: 1 })).toBe(false);
    expect(ordersWait({ kind: 'waiting' })).toBe(false);
    expect(ordersWait({ kind: 'local' })).toBe(false);
  });

  it('a command attempt under a pause never reaches transport.send, and notes the reason; after the resume commands flow', () => {
    const { t, cmds, recv } = room();
    let blocked = 0;
    const sink = roomOrderSink(() => t.status(), t, () => { blocked++; });
    const order: PlayerIntent = { kind: 'order', verb: 'move', ids: [3], x: 5, y: 6, append: false };

    applyIntent(sink, order, MAP);
    expect(cmds()).toHaveLength(1);
    expect(blocked).toBe(0);

    // The other seat pauses: this seat's orders wait too.
    recv({ t: 'paused', seat: 0, remainingMs: 90000, pausesLeft: [2, 3] });
    expect(t.status().kind).toBe('paused');
    applyIntent(sink, order, MAP);
    applyIntent(sink, { kind: 'halt', ids: [3] }, MAP);
    expect(cmds()).toHaveLength(1);
    expect(blocked).toBe(2);

    // Nothing was buffered to go out at the resume.
    recv({ t: 'resume' });
    expect(t.status().kind).toBe('live');
    expect(cmds()).toHaveLength(1);
    applyIntent(sink, { kind: 'halt', ids: [3] }, MAP);
    expect(cmds()).toHaveLength(2);
    expect(blocked).toBe(2);
  });

  it('an intent that makes no command (a selection) is not an order, and says nothing', () => {
    const { t, recv } = room();
    recv({ t: 'paused', seat: 1, remainingMs: 90000, pausesLeft: [3, 2] });
    let blocked = 0;
    applyIntent(roomOrderSink(() => t.status(), t, () => { blocked++; }), { kind: 'select', ids: [1], via: 'click' }, MAP);
    expect(blocked).toBe(0);
  });

  it('main.ts routes every room intent through it: the dispatch applies to roomOrderSink, and the field marker waits too', () => {
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const dispatch = main.slice(main.indexOf('const dispatch = (intent: PlayerIntent)'), main.indexOf('intentListeners.push((intent) => voice.observe'));
    expect(dispatch).toContain('roomOrderSink(() => room.status(), transport');
    expect(dispatch).toContain("t('net.pause.ordersBlocked')");
    expect(dispatch.indexOf('if (refused)')).toBeLessThan(dispatch.indexOf('for (const fn of intentListeners)'));
    expect(main).toContain('marker: orderMarker,');
    expect(main).toContain('if (room === null || !ordersWait(room.status())) renderer.addOrderMarker(x, y);');
  });
});
