// packages/app/src/shell/clock.ts
/**
 * The mission's accumulator, pulled out of the rAF loop so "paused" can be
 * tested without a browser. The rules are main.ts's own: speed feeds the
 * ACCUMULATOR, never the tick (invariant 1 — a tick is 50 ms of sim time at
 * every setting); a gap over MAX_ACC_MS is cut, not replayed; and a pause
 * accumulates nothing, so resuming runs the next frame's ticks and not the
 * pause's worth.
 */
export const MAX_ACC_MS = 250;

export interface Clock {
  acc: number;
  last: number;
}

export function advance(c: Clock, now: number, speed: number, paused: boolean, msPerTick: number): { ticks: number; frameMs: number } {
  const frameMs = now - c.last;
  c.last = now;
  if (paused) return { ticks: 0, frameMs };
  c.acc += frameMs * speed;
  if (c.acc > MAX_ACC_MS) c.acc = MAX_ACC_MS;
  let ticks = 0;
  while (c.acc >= msPerTick) {
    ticks++;
    c.acc -= msPerTick;
  }
  return { ticks, frameMs };
}
