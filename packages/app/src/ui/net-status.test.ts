// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { NetStatusLine, lineOverMatchEnd, netStatusText } from './net-status';

const nameOf = (seat: 0 | 1 | null): string => (seat === null ? 'me' : `seat-${seat}`);

describe('netStatusText', () => {
  it('says nothing in single-player or while live', () => {
    expect(netStatusText({ kind: 'local' }, nameOf)).toBeNull();
    expect(netStatusText({ kind: 'live', behind: 3 }, nameOf)).toBeNull();
  });
  it('a closed room says why (R35)', () => {
    expect(netStatusText({ kind: 'closed', reason: 'left' }, nameOf)).toBe('The other seat left the match');
    expect(netStatusText({ kind: 'closed', reason: 'void' }, nameOf)).toBe('Match void');
    expect(netStatusText({ kind: 'closed', reason: 'expired' }, nameOf)).toBe('The room expired');
    expect(netStatusText({ kind: 'closed', reason: 'replaced' }, nameOf)).toBe('This seat was opened in another tab');
    expect(netStatusText({ kind: 'closed', reason: 'build_mismatch' }, nameOf)).toBe('Match closed');
  });
  it('names who a stall waits on, and our own seat for our own reconnect', () => {
    expect(netStatusText({ kind: 'waiting' }, nameOf)).toBe('Waiting for the other seat');
    expect(netStatusText({ kind: 'stalled', reason: 'behind', seat: 1 }, nameOf)).toBe('Waiting for seat-1: behind');
    expect(netStatusText({ kind: 'stalled', reason: 'gone', seat: 0 }, nameOf)).toBe('Waiting for seat-0: connection lost');
    expect(netStatusText({ kind: 'stalled', reason: 'connecting', seat: null }, nameOf)).toBe('Waiting for me: connection lost');
  });
  it('a desync names the match time its window closed at', () => {
    expect(netStatusText({ kind: 'desync', tick: 39 }, nameOf)).toBe('Desync at 0:02. The match is void; report it.');
    expect(netStatusText({ kind: 'desync', tick: 1219 }, nameOf)).toBe('Desync at 1:01. The match is void; report it.');
  });
});

// N1b task 8: a room pause is the room's own clock (3 x 90 s a seat), so the
// line says who holds it and how long the room will go on holding it.
describe('a room pause', () => {
  const now = 1_000_000;
  const ab = (seat: 0 | 1 | null): string => (seat === 1 ? 'B' : 'A');
  it('names who paused and the time left as m:ss', () => {
    expect(netStatusText({ kind: 'paused', seat: 1, untilMs: now + 61_000 }, ab, now)).toBe('Paused by B: 1:01');
    expect(netStatusText({ kind: 'paused', seat: 0, untilMs: now + 90_000 }, ab, now)).toBe('Paused by A: 1:30');
  });
  it('counts down to 0:00 and no further, rounding a part second up', () => {
    const s = { kind: 'paused', seat: 1, untilMs: now + 61_000 } as const;
    expect(netStatusText(s, ab, now + 500)).toBe('Paused by B: 1:01');
    expect(netStatusText(s, ab, now + 1_000)).toBe('Paused by B: 1:00');
    expect(netStatusText(s, ab, now + 60_001)).toBe('Paused by B: 0:01');
    expect(netStatusText(s, ab, now + 61_000)).toBe('Paused by B: 0:00');
    expect(netStatusText(s, ab, now + 70_000)).toBe('Paused by B: 0:00');
  });
});

describe('NetStatusLine', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });
  it('repaints a pause as its clock runs down, and hides when the room resumes', () => {
    const line = new NetStatusLine(document.body, (seat) => (seat === 1 ? 'B' : 'A'));
    const el = document.querySelector('.rl-net-status') as HTMLElement;
    const paused = { kind: 'paused', seat: 1, untilMs: 2_000_000 + 90_000 } as const;
    line.paint(paused, 2_000_000);
    expect(el.hidden).toBe(false);
    expect(el.dataset.net).toBe('paused');
    expect(el.textContent).toBe('Paused by B: 1:30');
    line.paint(paused, 2_000_000 + 29_000);
    expect(el.textContent).toBe('Paused by B: 1:01');
    line.paint({ kind: 'live', behind: 0 }, 2_000_000 + 30_000);
    expect(el.hidden).toBe(true);
  });
});

// N1b task 10 fix round 1: once the match-over panel is up, the line goes
// quiet -- except for a desync, which voids the result on the panel. The
// room's verdict on the decision window can arrive after the seat stopped.
describe('the line over a match result', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });
  it('only a desync is said over the match-over panel', () => {
    expect(lineOverMatchEnd({ kind: 'desync', tick: 19 })).toBe(true);
    expect(lineOverMatchEnd({ kind: 'stalled', reason: 'behind', seat: 1 })).toBe(false);
    expect(lineOverMatchEnd({ kind: 'closed', reason: 'left' })).toBe(false);
    expect(lineOverMatchEnd({ kind: 'live', behind: 0 })).toBe(false);
    expect(lineOverMatchEnd({ kind: 'paused', seat: 0, untilMs: 5 })).toBe(false);
  });
  it('a hidden line comes back for a desync painted after it', () => {
    const line = new NetStatusLine(document.body, () => 'B');
    const el = document.querySelector('.rl-net-status') as HTMLElement;
    line.paint({ kind: 'stalled', reason: 'behind', seat: 1 });
    expect(el.hidden).toBe(false);
    line.hide();
    expect(el.hidden).toBe(true);
    line.paint({ kind: 'desync', tick: 19 });
    expect(el.hidden).toBe(false);
    expect(el.dataset.net).toBe('desync');
    expect(el.textContent).toBe('Desync at 0:01. The match is void; report it.');
    // hide() forgets what was shown: the same line painted again comes back.
    line.hide();
    line.paint({ kind: 'desync', tick: 19 });
    expect(el.hidden).toBe(false);
  });
});
