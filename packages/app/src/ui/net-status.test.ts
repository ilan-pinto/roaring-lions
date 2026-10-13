// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
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
  it('a room that closed itself after the result is neutral: no error, nobody left (L-1)', () => {
    expect(netStatusText({ kind: 'closed', reason: 'over' }, nameOf)).toBe('The match has ended');
  });
  it('names who a stall waits on, and our own seat for our own reconnect', () => {
    expect(netStatusText({ kind: 'waiting' }, nameOf)).toBe('Waiting for the other seat');
    expect(netStatusText({ kind: 'stalled', reason: 'behind', seat: 1 }, nameOf)).toBe('Waiting for seat-1: behind');
    expect(netStatusText({ kind: 'stalled', reason: 'gone', seat: 0 }, nameOf)).toBe('Waiting for seat-0: connection lost');
    expect(netStatusText({ kind: 'stalled', reason: 'connecting', seat: null }, nameOf)).toBe('Waiting for me: connection lost');
  });
  it('a desync names the match time its window closed at, and the room as the reference (N1b task 11)', () => {
    expect(netStatusText({ kind: 'desync', tick: 39 }, nameOf, 0, 'TESTAB')).toBe('Desync at 0:02 in room TESTAB. The match is void.');
    expect(netStatusText({ kind: 'desync', tick: 1219 }, nameOf, 0, 'QX7K2M')).toBe('Desync at 1:01 in room QX7K2M. The match is void.');
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
    expect(lineOverMatchEnd({ kind: 'closed', reason: 'over' })).toBe(false);   // L-1: the panel is up; nothing new
    expect(lineOverMatchEnd({ kind: 'live', behind: 0 })).toBe(false);
    expect(lineOverMatchEnd({ kind: 'paused', seat: 0, untilMs: 5 })).toBe(false);
  });
  it('a hidden line comes back for a desync painted after it', () => {
    const line = new NetStatusLine(document.body, () => 'B', { code: 'TESTAB' });
    const el = document.querySelector('.rl-net-status') as HTMLElement;
    line.paint({ kind: 'stalled', reason: 'behind', seat: 1 });
    expect(el.hidden).toBe(false);
    line.hide();
    expect(el.hidden).toBe(true);
    line.paint({ kind: 'desync', tick: 19 });
    expect(el.hidden).toBe(false);
    expect(el.dataset.net).toBe('desync');
    expect(el.textContent).toBe('Desync at 0:01 in room TESTAB. The match is void.');
    // hide() forgets what was shown: the same line painted again comes back.
    line.hide();
    line.paint({ kind: 'desync', tick: 19 });
    expect(el.hidden).toBe(false);
  });
});

// N1b task 11: a desync is reported by its room code -- the room has already
// written the evidence to D1 (\`match_desync\`) under that code -- and the line
// offers Report, which the battlefield turns into the pause menu's Feedback
// tab, prefilled. The text stays the aria-live line; the button sits beside it.
describe('the desync line reports', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });
  const root = (): HTMLElement => document.querySelector('.rl-net-status') as HTMLElement;
  const text = (): HTMLElement => document.querySelector('.rl-net-status__text') as HTMLElement;
  const report = (): HTMLButtonElement | null => document.querySelector('.rl-net-status button[data-act="report"]');

  it('names the room code and offers Report, which calls onReport once with the desync tick', () => {
    const onReport = vi.fn();
    const line = new NetStatusLine(document.body, () => 'B', { code: 'TESTAB', onReport });
    line.paint({ kind: 'desync', tick: 39 });
    expect(root().hidden).toBe(false);
    expect(text().textContent).toBe('Desync at 0:02 in room TESTAB. The match is void.');
    expect(text().getAttribute('role')).toBe('status');
    expect(text().getAttribute('aria-live')).toBe('polite');
    const b = report();
    expect(b).not.toBeNull();
    expect(b?.hidden).toBe(false);
    expect(b?.textContent).toBe('Report');
    expect(text().contains(b)).toBe(false);
    b?.click();
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith(39);
  });

  it('shows Report on a desync only, never on a stall or a closed room', () => {
    const line = new NetStatusLine(document.body, () => 'B', { code: 'TESTAB', onReport: vi.fn() });
    line.paint({ kind: 'stalled', reason: 'behind', seat: 1 });
    expect(report()?.hidden).toBe(true);
    line.paint({ kind: 'desync', tick: 19 });
    expect(report()?.hidden).toBe(false);
    line.paint({ kind: 'closed', reason: 'void' });
    expect(report()?.hidden).toBe(true);
  });

  it('has no Report button without onReport (feedback not offered)', () => {
    const line = new NetStatusLine(document.body, () => 'B', { code: 'TESTAB' });
    line.paint({ kind: 'desync', tick: 19 });
    expect(report()).toBeNull();
  });
});
