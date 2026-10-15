// `nodeSocket` over a stand-in `ws`: no real socket is opened.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const made: FakeWs[] = [];
class FakeWs extends EventEmitter {
  readonly sent: string[] = [];
  closed = 0;
  constructor(readonly url: string, readonly opts: { origin?: string }) {
    super();
    made.push(this);
  }
  send(d: string): void { this.sent.push(d); }
  close(): void { this.closed++; }
}
vi.mock('ws', () => ({ default: FakeWs }));

const { nodeSocket } = await import('./node-socket');

describe('nodeSocket', () => {
  it('sends the given Origin, hands text on as a string, and forwards the close code', () => {
    const s = nodeSocket('wss://game.test/api/match/ABC123/ws', 'https://game.test');
    const ws = made.at(-1) as FakeWs;
    expect(ws.url).toBe('wss://game.test/api/match/ABC123/ws');
    expect(ws.opts).toEqual({ origin: 'https://game.test' });
    const heard: unknown[] = [];
    const codes: (number | undefined)[] = [];
    let opened = 0;
    s.onopen = () => { opened++; };
    s.onmessage = (ev) => { heard.push(ev.data); };
    s.onclose = (ev) => { codes.push(ev.code); };
    ws.emit('open');
    ws.emit('message', Buffer.from('{"t":"hashOk","tick":19}', 'utf8'), false);
    ws.emit('message', [Buffer.from('{"t":"res', 'utf8'), Buffer.from('ume"}', 'utf8')], false);
    // An error is followed by a close; it must not throw on its own.
    expect(() => ws.emit('error', new Error('refused'))).not.toThrow();
    ws.emit('close', 4002, Buffer.from('build'));
    expect(opened).toBe(1);
    expect(heard).toEqual(['{"t":"hashOk","tick":19}', '{"t":"resume"}']);
    expect(codes).toEqual([4002]);
    s.send('{"t":"ready"}');
    s.close();
    expect(ws.sent).toEqual(['{"t":"ready"}']);
    expect(ws.closed).toBe(1);
  });
});
