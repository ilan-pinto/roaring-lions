import { describe, it, expect } from 'vitest';
import type { TelemetryEvent } from '@lions/data/telemetry';
import { Sender, type Transport } from './sender';

const e = (tick: number): TelemetryEvent => ({
  v: 1, player: '0f8fad5b-d9cb-469f-a165-70867728950e', session: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  build: '0.78.0', t: 1, type: 'heartbeat', mission: 'm', tick,
});
function fake(beaconOk = true) {
  const posts: string[] = [];
  const beacons: string[] = [];
  const t: Transport = { post: (b) => void posts.push(b), beacon: (b) => { beacons.push(b); return beaconOk; } };
  return { t, posts, beacons };
}

describe('Sender', () => {
  it('sends nothing until flushed', () => {
    const f = fake();
    const s = new Sender(f.t);
    s.push(e(1));
    expect(f.posts).toEqual([]);
    expect(s.pending).toBe(1);
  });

  it('flushes in batches of at most maxBatch as {events: [...]}', () => {
    const f = fake();
    const s = new Sender(f.t, 2);
    [1, 2, 3].forEach((n) => s.push(e(n)));
    s.flush();
    expect(f.posts.map((b) => (JSON.parse(b) as { events: unknown[] }).events.length)).toEqual([2, 1]);
    expect(s.pending).toBe(0);
  });

  it('uses the beacon when asked, and falls back to post if the beacon refuses', () => {
    const ok = fake(true);
    const a = new Sender(ok.t);
    a.push(e(1));
    a.flush(true);
    expect(ok.beacons).toHaveLength(1);
    expect(ok.posts).toHaveLength(0);

    const no = fake(false);
    const b = new Sender(no.t);
    b.push(e(1));
    b.flush(true);
    expect(no.posts).toHaveLength(1);
  });

  it('drops the oldest events past maxQueue rather than growing without bound', () => {
    const f = fake();
    const s = new Sender(f.t, 50, 3);
    [1, 2, 3, 4].forEach((n) => s.push(e(n)));
    expect(s.pending).toBe(3);
    s.flush();
    expect((JSON.parse(f.posts[0]) as { events: { tick: number }[] }).events.map((x) => x.tick)).toEqual([2, 3, 4]);
  });

  it('never throws out of flush, even if the transport does', () => {
    const s = new Sender({ post: () => { throw new Error('offline'); }, beacon: () => { throw new Error('x'); } });
    s.push(e(1));
    expect(() => s.flush()).not.toThrow();
    expect(() => s.flush(true)).not.toThrow();
    expect(s.pending).toBe(0); // dropped, never retried in a loop
  });
});
