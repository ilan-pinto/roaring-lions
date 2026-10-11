import { describe, it, expect } from 'vitest';
import { netStatusText } from './net-status';

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
