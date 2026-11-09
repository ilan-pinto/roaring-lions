import { describe, expect, it } from 'vitest';
import { emptyAccount } from '@lions/economy';
import type { CampaignBody } from '@lions/economy';
import { appendOp, coalesce, heartbeatKey, orphanedOutboxes, outboxKey, readOutbox, type OutboxOp } from './outbox';
import { memStorage, slotOf } from './fixtures';

const body = (n: number): CampaignBody => ({ ledger: { 'campaign.slots_issued': n }, brigade: emptyAccount(), tutorialDone: false });
const camp = (n: number): OutboxOp => ({ kind: 'campaign', opId: `c${n}`, campaign: body(n) });
const boom = (): never => {
  throw new Error('blocked');
};

describe('outbox', () => {
  it('adjacent_campaign_ops_coalesce: thirty appends leave the last', () => {
    const s = memStorage();
    for (let i = 0; i < 30; i++) appendOp(s, 'tabA', camp(i));
    const q = readOutbox(s, 'tabA');
    expect(q).toHaveLength(1);
    expect(q[0]).toEqual(camp(29));
  });

  it('a victory between two campaign ops stops the coalescing', () => {
    const s = memStorage();
    const victory: OutboxOp = { kind: 'victory', opId: 'v', missionId: 'm', stars: 1, start: null, campaign: null };
    appendOp(s, 'tabA', camp(1));
    appendOp(s, 'tabA', victory);
    appendOp(s, 'tabA', camp(2));
    expect(readOutbox(s, 'tabA').map((o) => o.opId)).toEqual(['c1', 'v', 'c2']);
  });

  it('a campaign op already sent is never replaced', () => {
    expect(coalesce([camp(1)], camp(2), new Set(['c1'])).map((o) => o.opId)).toEqual(['c1', 'c2']);
  });

  it('a slot.put replaces a queued slot.put of the same id only; a delete in between keeps order', () => {
    const put = (id: string, name: string, opId: string): OutboxOp => ({ kind: 'slot.put', opId, slotId: id, slot: slotOf(id, name), origin: 'player' });
    const del: OutboxOp = { kind: 'slot.delete', opId: 'd', slotId: 'a' };
    expect(coalesce([put('a', 'one', 'p1'), put('b', 'x', 'p2')], put('a', 'two', 'p3')).map((o) => o.opId)).toEqual(['p3', 'p2']);
    expect(coalesce([put('a', 'one', 'p1'), del], put('a', 'two', 'p3')).map((o) => o.opId)).toEqual(['p1', 'd', 'p3']);
  });

  it('writes only this tab\'s key (§0.38)', () => {
    const s = memStorage();
    appendOp(s, 'tabA', camp(1));
    appendOp(s, 'tabB', camp(2));
    expect([...s.map.keys()].sort()).toEqual([outboxKey('tabA'), outboxKey('tabB')]);
    expect(readOutbox(s, 'tabA')[0]?.opId).toBe('c1');
  });

  it('is guarded: blocked storage reads empty, a refused write still returns the queue', () => {
    const blocked = { getItem: boom, setItem: boom, removeItem: boom };
    expect(readOutbox(blocked, 't')).toEqual([]);
    expect(appendOp(blocked, 't', camp(1))).toEqual([camp(1)]);
    expect(appendOp(null, 't', camp(1))).toEqual([camp(1)]);
  });

  it('orphanedOutboxes: heartbeat over 60 s old or missing, empty outboxes skipped', () => {
    const s = memStorage();
    appendOp(s, 'live', camp(1));
    appendOp(s, 'dead', camp(2));
    appendOp(s, 'none', camp(3));
    s.setItem(heartbeatKey('live'), '990000');
    s.setItem(heartbeatKey('dead'), '900000');
    s.setItem(outboxKey('empty'), '[]');
    s.setItem(heartbeatKey('empty'), '0');
    expect(orphanedOutboxes(s, 1_000_000).sort()).toEqual(['dead', 'none']);
    expect(orphanedOutboxes({ getItem: boom, setItem: boom, removeItem: boom }, 0)).toEqual([]);
    expect(orphanedOutboxes(null, 0)).toEqual([]);
  });
});
