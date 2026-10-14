import { describe, expect, it } from 'vitest';
import { MAX_CMDS_PER_SEAT_PER_FRAME } from '@lions/net';
import { CMD_BUDGET, MAX_PENDING_CMDS_PER_SEAT, STALL_BEHIND_TICKS } from '../../../packages/worker/src/match/room-core';
import { DESK_FLUSH_TICKS, DESK_LOST_AFTER_TICKS, DESK_MAX_QUEUE, OrderDesk } from './order-desk';
import type { Command } from '@lions/sim';

const halt = (id: number): Command => ({ kind: 'halt', ids: [id] });

describe('OrderDesk', () => {
  it('matches the room it feeds (constants pinned against room-core, not copied)', () => {
    expect(DESK_MAX_QUEUE).toBe(MAX_PENDING_CMDS_PER_SEAT);
    expect(DESK_LOST_AFTER_TICKS).toBe(STALL_BEHIND_TICKS);
    expect(MAX_CMDS_PER_SEAT_PER_FRAME * (20 / DESK_FLUSH_TICKS)).toBeLessThanOrEqual(CMD_BUDGET.perSecond);
  });
  it('100 orders in one second: 12 queued, the rest refused, 4 sent per flush, one flush per 20 ticks', () => {
    const sent: Command[] = [];
    let now = 0;
    const perTick = new Map<number, number>();
    const desk = new OrderDesk((c) => {
      sent.push(c);
      perTick.set(now, (perTick.get(now) ?? 0) + 1);
    });
    const results = Array.from({ length: 100 }, (_, i) => desk.submit(halt(i), 0));
    expect(results.filter((r) => 'error' in r).length).toBe(88);
    for (let t = 0; t < 60; t++) {
      now = t;
      desk.onTick(t);
    }
    expect(sent.length).toBe(12);
    expect([...perTick.entries()]).toEqual([[0, MAX_CMDS_PER_SEAT_PER_FRAME], [20, MAX_CMDS_PER_SEAT_PER_FRAME], [40, MAX_CMDS_PER_SEAT_PER_FRAME]]);
    const flushTicks = desk.records(12).map((r) => r.sentTick);
    expect(new Set(flushTicks)).toEqual(new Set([0, 20, 40]));
  });
  it('reports applied, dropped and lost', () => {
    const desk = new OrderDesk(() => {});
    const a = desk.submit(halt(1), 0) as { ref: number };
    const b = desk.submit(halt(2), 0) as { ref: number };
    const c = desk.submit(halt(3), 0) as { ref: number };
    desk.onTick(0);
    desk.onOwnCommands([{ cmd: halt(1), valid: true }, { cmd: halt(2), valid: false }], 3);
    for (let t = 1; t <= 41; t++) desk.onTick(t);
    const byRef = new Map(desk.records(10).map((r) => [r.ref, r.status]));
    expect([byRef.get(a.ref), byRef.get(b.ref), byRef.get(c.ref)]).toEqual(['applied', 'dropped', 'lost']);
  });
  it('two identical orders settle oldest first', () => {
    const desk = new OrderDesk(() => {});
    const a = desk.submit(halt(1), 0) as { ref: number };
    desk.onTick(0);
    const b = desk.submit(halt(1), 5) as { ref: number };
    desk.onTick(20);
    desk.onOwnCommands([{ cmd: halt(1), valid: true }], 21);
    const byRef = new Map(desk.records(10).map((r) => [r.ref, r.status]));
    expect([byRef.get(a.ref), byRef.get(b.ref)]).toEqual(['applied', 'sent']);
  });
});
