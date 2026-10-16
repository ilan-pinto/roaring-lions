// The production line as a pure state machine (F4 Task 2). One line builds one item at a time:
// an integer tick clock, no rng, no allocation on the idle path. The runtime owns purse,
// population and the contest test; this module owns only the queue and the clock.
import type { Fx } from './fixed';
import type { HoldView } from './income';
import { CONTEST_RADIUS_SQ, MAX_LINE_QUEUE } from './tuning';

export interface LineItem {
  unit: string;
  logistics: number;
  intel: number;
  population: number;
  buildTicks: number;
}

export interface ProductionLine {
  readonly side: 0 | 1;
  /** Structure index, or -1 = player_start (D2, side 0 only). */
  readonly anchor: number;
  queue: LineItem[];
  current: LineItem | null;
  ticksLeft: number;
  rally: { x: Fx; y: Fx } | null;
}

/** Start `item` as the line's current item with its full build time. */
function begin(line: ProductionLine, item: LineItem | undefined): void {
  if (item === undefined) {
    line.current = null;
    line.ticksLeft = 0;
  } else {
    line.current = item;
    line.ticksLeft = item.buildTicks;
  }
}

/**
 * One tick. Returns the item that finished this tick, or null. A contested line does not
 * count down and does not finish (G3 Q3). When an item finishes, the next queued item becomes
 * current with its full `buildTicks`, counted from the next tick.
 */
export function advance(line: ProductionLine, contested: boolean): LineItem | null {
  const cur = line.current;
  if (cur === null || contested) return null;
  line.ticksLeft--;
  if (line.ticksLeft > 0) return null;
  begin(line, line.queue.shift());
  return cur;
}

/**
 * R-F4-6. False (and no change) when MAX_LINE_QUEUE items already wait. On an idle line the
 * item becomes current at once, ticksLeft = buildTicks.
 */
export function enqueue(line: ProductionLine, item: LineItem): boolean {
  if (line.current === null) {
    begin(line, item);
    return true;
  }
  if (line.queue.length >= MAX_LINE_QUEUE) return false;
  line.queue.push(item);
  return true;
}

/**
 * D3. Removes queue index i (-1 = the item in progress) and returns it for the refund; null
 * for an index with nothing there. Cancelling the item in progress promotes the next with its
 * own full time, never the cancelled item's remainder.
 */
export function cancel(line: ProductionLine, i: number): LineItem | null {
  if (!Number.isInteger(i)) return null;
  if (i === -1) {
    const cur = line.current;
    if (cur === null) return null;
    begin(line, line.queue.shift());
    return cur;
  }
  if (i < 0 || i >= line.queue.length) return null;
  return line.queue.splice(i, 1)[0] ?? null;
}

/**
 * D1, LD6 ask 9. A line is contested when a living, surface (tunnelIn < 0), ground (!isAir)
 * unit of side `1 - side` stands within CONTEST_RADIUS_SQ of (x, y), compared on `>> 8` deltas
 * as the hold rule does. Civilians (side 2) contest nothing. No allocation.
 */
export function lineContested(view: HoldView, x: Fx, y: Fx, side: 0 | 1): boolean {
  const foe = 1 - side;
  const n = view.entityCount;
  for (let e = 0; e < n; e++) {
    if (view.alive[e] === 0 || view.side[e] !== foe) continue;
    if (view.tunnelIn[e] >= 0) continue;
    if (view.isAir(e)) continue;
    const dx = ((view.posX[e] - x) >> 8) | 0;
    const dy = ((view.posY[e] - y) >> 8) | 0;
    if (dx * dx + dy * dy <= CONTEST_RADIUS_SQ) return true;
  }
  return false;
}
