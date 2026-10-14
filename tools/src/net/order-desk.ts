import { MAX_CMDS_PER_SEAT_PER_FRAME } from '@lions/net';
import type { Command } from '@lions/sim';

/**
 * The order desk: a model may call `order` as fast as it likes, the room takes
 * 4 commands per seat per frame, 12 pending and 20 a second, and each command
 * frame costs one billed row. The desk turns orders into at most one flush of
 * at most 4 commands every 20 ticks (decision D4), and reports what became of
 * each order so a model learns its boundaries.
 *
 * The two limits below are copies of the room's own (`MAX_PENDING_CMDS_PER_SEAT`,
 * `STALL_BEHIND_TICKS`); the desk imports nothing from the worker, and
 * `order-desk.test.ts` pins each copy equal to the room's constant.
 */
export const DESK_FLUSH_TICKS = 20;
export const DESK_MAX_QUEUE = 12;
export const DESK_LOST_AFTER_TICKS = 40;
const RING_SIZE = 64;

export type OrderStatus = 'queued' | 'sent' | 'applied' | 'dropped' | 'lost';

export interface OrderRecord {
  ref: number;
  cmd: Command;
  status: OrderStatus;
  queuedTick: number;
  sentTick: number | null;
  settledTick: number | null;
}

export class OrderDesk {
  private ring: OrderRecord[] = []; // oldest first
  private nextRef = 1;
  private lastFlush = -Infinity;

  constructor(private readonly send: (cmd: Command) => void) {}

  submit(cmd: Command, tick: number): OrderRecord | { error: 'queue_full' } {
    const queued = this.ring.filter((r) => r.status === 'queued').length;
    if (queued >= DESK_MAX_QUEUE) return { error: 'queue_full' };
    const rec: OrderRecord = { ref: this.nextRef++, cmd, status: 'queued', queuedTick: tick, sentTick: null, settledTick: null };
    this.ring.push(rec);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    return rec;
  }

  /** After each frame has run: age out unsettled sends, then flush when due. */
  onTick(tick: number): void {
    for (const r of this.ring) {
      if (r.status === 'sent' && r.sentTick !== null && tick - r.sentTick >= DESK_LOST_AFTER_TICKS) {
        r.status = 'lost';
        r.settledTick = tick;
      }
    }
    if (tick - this.lastFlush < DESK_FLUSH_TICKS) return;
    let n = 0;
    for (const r of this.ring) {
      if (r.status !== 'queued') continue;
      if (n >= MAX_CMDS_PER_SEAT_PER_FRAME) break;
      r.status = 'sent';
      r.sentTick = tick;
      this.send(r.cmd);
      n++;
    }
    if (n > 0) this.lastFlush = tick;
  }

  /** This seat's commands in a frame, in canonical order, with ownership's verdict on each. */
  onOwnCommands(cmds: readonly { cmd: Command; valid: boolean }[], tick: number): void {
    for (const { cmd, valid } of cmds) {
      const key = JSON.stringify(cmd);
      const rec = this.ring.find((r) => r.status === 'sent' && JSON.stringify(r.cmd) === key);
      if (!rec) continue;
      rec.status = valid ? 'applied' : 'dropped';
      rec.settledTick = tick;
    }
  }

  /** Newest first. */
  records(limit: number): OrderRecord[] {
    return this.ring.slice(Math.max(0, this.ring.length - limit)).reverse();
  }
}
