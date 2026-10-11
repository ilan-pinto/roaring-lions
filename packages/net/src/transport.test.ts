import { describe, it, expect } from 'vitest';
import { LocalTransport } from './transport';

describe('LocalTransport', () => {
  it('yields exactly the ticks asked for, with pending commands in the first frame, stamped as seat 0', () => {
    const t = new LocalTransport();
    t.queueCommand({ kind: 'halt', ids: [1] });
    t.queueCommand({ kind: 'halt', ids: [2] });
    const frames = t.take(3);
    expect(frames.map((f) => f.tick)).toEqual([0, 1, 2]);
    expect(frames[0].cmds).toEqual([
      { seat: 0, seq: 0, cmd: { kind: 'halt', ids: [1] } },
      { seat: 0, seq: 1, cmd: { kind: 'halt', ids: [2] } },
    ]);
    expect(frames[1].cmds).toEqual([]);
    expect(t.take(1)[0].tick).toBe(3);
    expect(t.status()).toEqual({ kind: 'local' });
    expect(t.local).toBe(true);
  });
});
