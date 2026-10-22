import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAUSES_PER_SEAT, WsTransport, type MatchConfig, type SocketLike } from '@lions/net';
import { applyIntent, type PlayerIntent } from '../input/intents';
import type { TransportStatus } from '@lions/net';
import { t } from '../i18n/t';
import { leaveCopy } from '../ui/leave-copy';
import { routes } from '../shell/links';
import { BLOCKED_CUE_GAP_MS, blockedOrderNotes, dockHeld, escapeOpensPause, hudExit, matchLeaveCopy, ordersWait, pauseEndClosesMenu, quitHref, roomExitCopy, roomOrderSink, roomPauseCall, surrenderOffered } from './room-pause';

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

// L-3 (lead ruling): what a room's exit SAYS. Mid-match it is the surrender
// copy, once the match is over it is the leave-the-match copy, and no status of
// a room ever yields the free-play sandbox's wording. The tooltip and the
// dialog come from the one decision, so they cannot disagree (R-B24).
describe('roomExitCopy', () => {
  const RUNNING: TransportStatus[] = [
    { kind: 'live', behind: 0 },
    { kind: 'stalled', reason: 'gone', seat: 0 },
    { kind: 'paused', seat: 1, untilMs: 5 },
  ];
  const OVER: TransportStatus[] = [
    { kind: 'closed', reason: 'surrender' },
    { kind: 'desync', tick: 40 },
  ];
  const ALL: TransportStatus[] = [...RUNNING, ...OVER, { kind: 'waiting' }, { kind: 'local' }];

  it('a running match: the surrender wording, tooltip and dialog together', () => {
    for (const s of RUNNING) {
      expect(roomExitCopy(s), s.kind).toEqual({
        tip: 'surrender the match',
        title: 'Surrender the match?',
        body: 'Leaving now counts as a loss: your friend wins.',
        confirm: 'Surrender',
      });
    }
  });

  // The lead's ruling (2026-10-13): leaving a running match is a surrender, and
  // every dialog that leaves one says so BEFORE the player confirms -- the
  // HUD's leave and the menu's Surrender (`surrenderCopy`) and the Quit dialog
  // (`matchLeaveCopy`), should one ever be reached while the match runs.
  it('every dialog that can leave a running match says it counts as a loss', () => {
    for (const s of RUNNING) {
      expect(roomExitCopy(s).body, s.kind).toBe('Leaving now counts as a loss: your friend wins.');
      expect(matchLeaveCopy(s).body, s.kind).toBe('Leaving now counts as a loss: your friend wins.');
    }
    for (const s of [...OVER, { kind: 'waiting' } as const]) {
      expect(matchLeaveCopy(s).body, s.kind).not.toMatch(/loss/);
    }
  });

  it('a match that is over: leave the match, tooltip and dialog together', () => {
    for (const s of OVER) {
      expect(roomExitCopy(s), s.kind).toEqual({
        tip: 'leave the match',
        title: 'Leave the match?',
        body: 'The match is over.',
        confirm: 'Leave',
      });
    }
  });

  it('a room not yet started does not claim the match is over', () => {
    expect(roomExitCopy({ kind: 'waiting' })).toEqual({
      tip: 'leave the match',
      title: 'Leave the match?',
      body: 'You will leave this room.',
      confirm: 'Leave',
    });
  });

  it('the copy follows hudExit: surrender exactly when the HUD exit surrenders', () => {
    for (const s of ALL) {
      const surrenders = hudExit(true, s) === 'surrender';
      expect(roomExitCopy(s).title === 'Surrender the match?', s.kind).toBe(surrenders);
    }
  });

  it('no room state ever says free play, mission or campaign', () => {
    for (const s of ALL) {
      const c = roomExitCopy(s);
      const said = [c.tip, c.title, c.body, c.confirm].join(' | ');
      expect(said, s.kind).not.toMatch(/free play|mission|campaign/i);
    }
  });

  // L-3 fix: where a confirmed Leave lands. A room's players go to Play with a
  // friend, as the match-end panel's own button does -- not the free-play picker.
  it('quitHref: a room leaves to Play with a friend; single-player is leaveHref as before', () => {
    expect(quitHref(true, false)).toBe(routes.versus());
    expect(quitHref(true, true)).toBe(routes.versus());
    expect(quitHref(false, true)).toBe(routes.freePlay());
    expect(quitHref(false, false)).toBe(routes.campaign());
  });

  it('single-player copy is untouched', () => {
    expect(leaveCopy(true).title).toBe('Leave free play?');
    expect(leaveCopy(true).tip).toBe('leave free play');
    expect(leaveCopy(false).title).toBe('Leave the mission?');
    expect(t('hud.leave.link')).toBe('leave');
  });
});

// L-3: the wiring, read from main.ts's source like L-2's below (the battlefield
// is not mounted in a unit test): the HUD's tooltip is the SAME decision as its
// dialog, read live; a room's Quit wears the match wording; the surrender
// dialog takes its words from the one copy.
describe('main.ts wires a room\'s exit copy', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  it('the HUD exit tooltip is read from roomExitCopy(room.status()) per hover, not frozen at build', () => {
    const exit = main.slice(main.indexOf('exit: {', main.indexOf('A room\'s exit is the pause menu\'s')), main.indexOf('openObjectives,'));
    expect(exit).toContain('tip: () => roomExitCopy(room.status()).tip,');
    expect(exit).not.toContain("t('versus.exit.tip')");
  });
  it('confirmQuit says matchLeaveCopy in a room and leaveCopy only outside one', () => {
    const quit = main.slice(main.indexOf('const confirmQuit = (): void => {'), main.indexOf('const confirmSurrender'));
    expect(quit).toContain('const leaveText = room !== null ? matchLeaveCopy(room.status()) : leaveCopy(!mission);');
  });
  it('confirmQuit navigates through quitHref, so a room lands on Play with a friend', () => {
    const quit = main.slice(main.indexOf('const confirmQuit = (): void => {'), main.indexOf('const confirmSurrender'));
    expect(quit).toContain('req.navigate(quitHref(room !== null, !mission))');
    expect(quit).not.toContain('leaveHref');
  });
  it('the pause menu\'s Quit is labelled for the match in a room, and only there', () => {
    const deps = main.slice(main.indexOf('const pauseMenuDeps = (): PauseDeps'), main.indexOf('onQuit: () => confirmQuit(),'));
    expect(deps).toContain("...(room !== null ? { quitLabel: t('pause.quit.match') } : {}),");
  });
  it('confirmSurrender takes its words from surrenderCopy', () => {
    const sur = main.slice(main.indexOf('const confirmSurrender'), main.indexOf('const pauseMenuDeps'));
    expect(sur).toContain('const copy = surrenderCopy();');
    expect(sur).not.toContain("t('versus.surrender.confirm");
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
    expect(dispatch).toContain('blockedNotes?.blocked()');
    expect(dispatch).toContain('if (refused)');
    expect(dispatch).toContain('for (const fn of intentListeners)');
    expect(dispatch.indexOf('if (refused)')).toBeLessThan(dispatch.indexOf('for (const fn of intentListeners)'));
    expect(main).toContain('marker: orderMarker,');
    expect(main).toContain('if (room === null || !ordersWait(room.status())) renderer.addOrderMarker(x, y);');
  });
});

// N1b follow-up: an order already in flight when a pause starts reaches the
// room after it began and is refused there. The room says so (`cmdRefused`);
// the client says why, once per pause and not once per order.
describe('blockedOrderNotes', () => {
  const PAUSE_A: TransportStatus = { kind: 'paused', seat: 0, untilMs: 91_000 };
  const PAUSE_B: TransportStatus = { kind: 'paused', seat: 1, untilMs: 300_000 };
  function make(initial: TransportStatus) {
    let status = initial;
    let notes = 0;
    let cues = 0;
    let at = 0;
    const n = blockedOrderNotes(() => status, () => { notes++; }, () => { cues++; }, () => at);
    return { n, notes: () => notes, cues: () => cues, set: (s: TransportStatus) => { status = s; }, advance: (ms: number) => { at += ms; } };
  }

  it('a burst of refusals inside one pause notes once', () => {
    const m = make(PAUSE_A);
    m.n.refused(); m.n.refused(); m.n.refused();
    expect(m.notes()).toBe(1);
  });
  it('the next pause notes again, once', () => {
    const m = make(PAUSE_A);
    m.n.refused(); m.n.refused();
    m.set({ kind: 'live', behind: 0 });
    m.set(PAUSE_B);
    m.n.refused(); m.n.refused();
    expect(m.notes()).toBe(2);
  });
  it('a note already made for this pause by a withheld order covers the refusals that follow it', () => {
    const m = make(PAUSE_A);
    m.n.blocked();
    m.n.refused();
    expect(m.notes()).toBe(1);
  });
  it('a withheld order always notes (the feed merges identical lines)', () => {
    const m = make(PAUSE_A);
    m.n.blocked(); m.n.blocked();
    expect(m.notes()).toBe(2);
  });
  it('a refusal that lands after the resume still says it, once', () => {
    const m = make({ kind: 'live', behind: 0 });
    m.n.refused(); m.n.refused();
    expect(m.notes()).toBe(1);
  });

  it('a blocked order sounds the deny cue, and a burst of them sounds it once a second at most', () => {
    const m = make(PAUSE_A);
    m.n.blocked(); m.n.blocked(); m.n.blocked();
    expect(m.cues()).toBe(1);
    m.advance(BLOCKED_CUE_GAP_MS - 1);
    m.n.blocked();
    expect(m.cues()).toBe(1);
    m.advance(1);
    m.n.blocked();
    expect(m.cues()).toBe(2);
  });
  it('a refused order sounds it too, once per second across both paths, even when its note is the pause\'s second', () => {
    const m = make(PAUSE_A);
    m.n.blocked();
    m.advance(300);
    m.n.refused();   // within the second of the cue above
    expect(m.cues()).toBe(1);
    expect(m.notes()).toBe(1);
    m.advance(BLOCKED_CUE_GAP_MS);
    m.n.refused();   // no new note for this pause, but a new second
    expect(m.cues()).toBe(2);
    expect(m.notes()).toBe(1);
  });

  it('wired: the room\'s cmdRefused reaches onCmdRefused, and main.ts hooks it to the notes', () => {
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    expect(main).toContain('room.setHooks({ onCmdRefused: () => blockedNotes.refused() })');
    // ... and the cue it sounds is the one a refused ground order plays.
    const wired = main.slice(main.indexOf('? blockedOrderNotes('), main.indexOf('if (room !== null && blockedNotes !== null)'));
    expect(wired).toContain('audio.playCue(CRITICAL_CUES.uiDeny)');
  });
});

// N3 Task 4 (spec §11b.4 follow-up): a room now runs a runtime, so its dock buys -- and in a
// paused room the dock's pre-check holds the buy before `canBuild`, saying why, rather than
// noting "building" for a command the order sink then drops.
describe('dockHeld', () => {
  it('holds (and notes the pause) only while orders wait; the status is read per click', () => {
    let status: TransportStatus = { kind: 'live', behind: 0 };
    let blocked = 0;
    const held = dockHeld(() => status, () => { blocked++; });
    expect([held(), blocked]).toEqual([false, 0]);
    status = { kind: 'paused', seat: 1, untilMs: 5 };
    expect([held(), blocked]).toEqual([true, 1]);
    status = { kind: 'paused', seat: 0, untilMs: 5 };
    expect([held(), blocked]).toEqual([true, 2]);
    for (const s of [{ kind: 'stalled', reason: 'behind', seat: 1 }, { kind: 'waiting' }] as TransportStatus[]) {
      status = s;
      expect([held(), blocked]).toEqual([false, 2]);
    }
  });
});
