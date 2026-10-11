import { describe, it, expect } from 'vitest';
import { netStatusText } from './net-status';

const nameOf = (seat: 0 | 1 | null): string => (seat === null ? 'me' : `seat-${seat}`);

describe('netStatusText', () => {
  it('says nothing in single-player, while live, or once closed', () => {
    expect(netStatusText({ kind: 'local' }, nameOf)).toBeNull();
    expect(netStatusText({ kind: 'live', behind: 3 }, nameOf)).toBeNull();
    expect(netStatusText({ kind: 'closed', reason: 'left' }, nameOf)).toBeNull();
  });
  it('names who a stall waits on, and our own seat for our own reconnect', () => {
    expect(netStatusText({ kind: 'waiting' }, nameOf)).toBe('Waiting for the other seat');
    expect(netStatusText({ kind: 'stalled', reason: 'behind', seat: 1 }, nameOf)).toBe('Waiting for seat-1: behind');
    expect(netStatusText({ kind: 'stalled', reason: 'gone', seat: 0 }, nameOf)).toBe('Waiting for seat-0: connection lost');
    expect(netStatusText({ kind: 'stalled', reason: 'connecting', seat: null }, nameOf)).toBe('Waiting for me: connection lost');
  });
  it('a desync names the match time its window closed at', () => {
    expect(netStatusText({ kind: 'desync', tick: 39 }, nameOf)).toBe('Desync at 0:02. Both logs saved; report it.');
    expect(netStatusText({ kind: 'desync', tick: 1219 }, nameOf)).toBe('Desync at 1:01. Both logs saved; report it.');
  });
});
