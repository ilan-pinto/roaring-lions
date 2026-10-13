import { describe, it, expect, vi, afterEach } from 'vitest';
import { WsTransport, type MatchConfig } from '@lions/net';
import { handOver, takeHanded, dropHanded, type Handed } from './handoff';

const fakeSocket = () => ({
  sent: [] as string[],
  closed: 0,
  send(d: string) { this.sent.push(d); },
  close() { this.closed++; },
  onopen: null as null | ((e: unknown) => void),
  onmessage: null as null | ((e: { data: unknown }) => void),
  onclose: null,
});

const CONFIG = { code: 'ABCDEF' } as unknown as MatchConfig;

/** A real transport on a fake socket, with `detach` and `close` watched. */
function handed(): { h: Handed; sock: ReturnType<typeof fakeSocket>; detach: ReturnType<typeof vi.spyOn>; close: ReturnType<typeof vi.spyOn> } {
  const sock = fakeSocket();
  const transport = new WsTransport(() => sock, 'tk', 'b', { onStart: () => {} });
  const detach = vi.spyOn(transport, 'detach');
  const close = vi.spyOn(transport, 'close');
  return { h: { transport, seat: 1, config: CONFIG }, sock, detach, close };
}

/** A schedule that runs nothing until the test says so. */
function manualSchedule(): { schedule: (fn: () => void, ms: number) => unknown; due: { fn: () => void; ms: number }[] } {
  const due: { fn: () => void; ms: number }[] = [];
  return { schedule: (fn, ms) => { due.push({ fn, ms }); return due.length; }, due };
}

afterEach(() => { for (const c of ['ABCDEF', 'GHIJKL']) dropHanded(c); });

describe('handoff', () => {
  it('takeHanded returns the handed value once, and null the second time', () => {
    const { h } = handed();
    handOver('ABCDEF', h, { schedule: manualSchedule().schedule });
    expect(takeHanded('ABCDEF')).toBe(h);
    expect(takeHanded('ABCDEF')).toBeNull();
  });
  it('another code takes nothing', () => {
    const { h } = handed();
    handOver('ABCDEF', h, { schedule: manualSchedule().schedule });
    expect(takeHanded('GHIJKL')).toBeNull();
    expect(takeHanded('abcdef')).toBe(h);
  });
  it('dropHanded detaches the transport once (no bye) and forgets it', () => {
    const { h, sock, detach, close } = handed();
    sock.onopen?.({});
    handOver('ABCDEF', h, { schedule: manualSchedule().schedule });
    dropHanded('ABCDEF');
    dropHanded('ABCDEF');
    expect(detach).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello']);
    expect(sock.closed).toBe(1);
    expect(takeHanded('ABCDEF')).toBeNull();
  });
  it('an untaken handoff is dropped when its expiry runs, after 10 s by default', () => {
    const { h, detach } = handed();
    const clock = manualSchedule();
    handOver('ABCDEF', h, { schedule: clock.schedule });
    expect(clock.due.map((d) => d.ms)).toEqual([10_000]);
    expect(detach).not.toHaveBeenCalled();
    clock.due[0].fn();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(takeHanded('ABCDEF')).toBeNull();
  });
  it('a taken handoff is not dropped when its expiry runs', () => {
    const { h, detach } = handed();
    const clock = manualSchedule();
    handOver('ABCDEF', h, { expireMs: 500, schedule: clock.schedule });
    expect(clock.due.map((d) => d.ms)).toEqual([500]);
    expect(takeHanded('ABCDEF')).toBe(h);
    clock.due[0].fn();
    expect(detach).not.toHaveBeenCalled();
  });
  it('an older expiry does not drop a newer handoff for the same code', () => {
    const first = handed();
    const second = handed();
    const clock = manualSchedule();
    handOver('ABCDEF', first.h, { schedule: clock.schedule });
    handOver('ABCDEF', second.h, { schedule: clock.schedule });
    // The one it replaced is let go, not leaked.
    expect(first.detach).toHaveBeenCalledTimes(1);
    clock.due[0].fn();
    expect(second.detach).not.toHaveBeenCalled();
    expect(takeHanded('ABCDEF')).toBe(second.h);
  });
  it('the default schedule is a real timer, cancelled by the take', () => {
    vi.useFakeTimers();
    try {
      const a = handed();
      handOver('ABCDEF', a.h);
      expect(vi.getTimerCount()).toBe(1);
      expect(takeHanded('ABCDEF')).toBe(a.h);
      expect(vi.getTimerCount()).toBe(0);
      const b = handed();
      handOver('GHIJKL', b.h);
      vi.advanceTimersByTime(10_000);
      expect(b.detach).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
