import { describe, expect, it } from 'vitest';
import { opIdsOf, requestMissionStart, victoryCoinLine, victoryOpSince } from './mission-flow';
import type { OutboxOp } from './outbox';
import type { AccountClient } from './client';

const victory = (opId: string): OutboxOp => ({ kind: 'victory', opId, missionId: 'm', stars: 3, start: 'n', campaign: null });
const slot = (opId: string): OutboxOp => ({ kind: 'slot.delete', opId, slotId: 's' });
const clientAnswering = (r: unknown, calls: string[] = []): Pick<AccountClient, 'missionStart'> => ({
  missionStart: (id) => {
    calls.push(id);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r as never);
  },
});
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('requestMissionStart (§0.10)', () => {
  it('a signed-in campaign mission asks once and keeps the nonce', async () => {
    const calls: string[] = [];
    const h = requestMissionStart({ campaign: true, missionId: 'm1', client: clientAnswering({ ok: true, status: 200, body: { start: 'N1', missionId: 'm1', at: 1 } }, calls), onFailed: () => {} });
    await flush();
    expect(calls).toEqual(['m1']);
    expect(h).toMatchObject({ start: 'N1', failed: false });
  });
  it('the tutorial/sandbox (not a campaign mission) and a guest (no client) never ask', async () => {
    const calls: string[] = [];
    const c = clientAnswering({ ok: true, status: 200, body: { start: 'N', missionId: 'm', at: 1 } }, calls);
    const a = requestMissionStart({ campaign: false, missionId: 'm', client: c, onFailed: () => {} });
    const b = requestMissionStart({ campaign: true, missionId: 'm', client: null, onFailed: () => {} });
    await flush();
    expect(calls).toEqual([]);
    expect([a.start, b.start, a.failed, b.failed]).toEqual([null, null, false, false]);
  });
  it('a refusal and a thrown request both leave start null and raise the offline note once each', async () => {
    let notes = 0;
    const refused = requestMissionStart({ campaign: true, missionId: 'm', client: clientAnswering({ ok: false, status: 503, body: null }), onFailed: () => notes++ });
    const thrown = requestMissionStart({ campaign: true, missionId: 'm', client: clientAnswering(new Error('net')), onFailed: () => notes++ });
    await flush();
    expect([refused.start, thrown.start, refused.failed, thrown.failed, notes]).toEqual([null, null, true, true, 2]);
  });
});

describe('a signed-in device with no account client (2.12 review carry)', () => {
  it('a campaign mission says coins are not promised, asks nobody, and leaves start null', async () => {
    let notes = 0;
    const h = requestMissionStart({ campaign: true, signedIn: true, missionId: 'm', client: null, onFailed: () => notes++ });
    await flush();
    expect([h.start, h.failed, notes]).toEqual([null, true, 1]);
  });
  it('the tutorial/sandbox and a guest still say nothing', () => {
    let notes = 0;
    const a = requestMissionStart({ campaign: false, signedIn: true, missionId: 'm', client: null, onFailed: () => notes++ });
    const b = requestMissionStart({ campaign: true, signedIn: false, missionId: 'm', client: null, onFailed: () => notes++ });
    expect([a.failed, b.failed, notes]).toEqual([false, false, 0]);
  });
});

describe('victoryOpSince (R21)', () => {
  it('finds the settle\'s own victory by id, not by position: a later op does not hide it', () => {
    const before = opIdsOf([victory('old')]);
    const ops = [victory('old'), victory('new'), slot('later')];
    expect(victoryOpSince(before, ops)).toBe('new');
    // The by-position lookup the glue used (last victory) would also read 'new' here; a victory queued after it separates them.
    expect(victoryOpSince(before, [victory('old'), victory('new'), victory('after')])).toBe('new');
  });
  it('is undefined when the settle queued no victory', () => {
    expect(victoryOpSince(opIdsOf([victory('old')]), [victory('old'), slot('s')])).toBeUndefined();
  });
});

describe('victoryCoinLine', () => {
  const flow = { coinLine: (id: string, s: unknown) => ({ id, s }) as never };
  const base = { flow, eligible: true, before: new Set<string>(), ops: [victory('v1')], start: 'N', total: 120, balance: 5120 };
  it('feeds the queued victory the provisional award', () => {
    expect(victoryCoinLine(base)).toEqual({ id: 'v1', s: { coins: 120, balance: 5120, phase: 'provisional' } });
  });
  it('no nonce, no flow, not eligible or no queued victory: no line', () => {
    expect(victoryCoinLine({ ...base, start: null })).toBeUndefined();
    expect(victoryCoinLine({ ...base, eligible: false })).toBeUndefined();
    expect(victoryCoinLine({ ...base, ops: [slot('x')] })).toBeUndefined();
    expect(victoryCoinLine({ ...base, flow: null, start: null })).toBeUndefined();
    expect(victoryCoinLine({ ...base, flow: null, eligible: false })).toBeUndefined();
  });
  it('a signed-in win with no flow (offline from the cache) is the static willSync line, never a final award', () => {
    const line = victoryCoinLine({ ...base, flow: null });
    expect(line?.initial).toEqual({ coins: 120, balance: 5120, phase: 'willSync' });
    expect(line?.subscribe(() => {})()).toBeUndefined();
  });
});
