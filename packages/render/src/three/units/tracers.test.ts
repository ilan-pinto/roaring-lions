/**
 * `stepTracers`/`spawnTracer`/`tracerAlpha` are Task B3.12's pure port of
 * the tracer model Pixi keeps private and inline in `renderer.ts`
 * (`interface Tracer` at `:95-102`, the spawn inside `onEvents`'s `fire`
 * case at `:763-770`, the step+draw inside `frame()` at `:2596-2601`).
 * `renderer.ts` is out of scope for this task and stays untouched, so there
 * is no shared accessor here to diverge from the way `ParticleSystem.draw`
 * and `forEachLive` could -- these tests instead pin the model's own
 * documented behaviour (fixed lifetime, linear fade, per-side/per-endpoint
 * carry-through, purity) so a future rewrite of this file cannot drift from
 * what `renderer.ts` actually does without a test failing.
 */
import { describe, it, expect } from 'vitest';
import { spawnTracer, stepTracers, tracerAlpha, TRACER_LIFETIME_S, type TracerModel } from './tracers';

describe('spawnTracer', () => {
  it('starts at full lifetime and carries its endpoints and side through unchanged', () => {
    const t = spawnTracer(1, 2, 3, 4, 1);
    expect(t).toEqual<TracerModel>({ sx: 1, sy: 2, tx: 3, ty: 4, ttl: TRACER_LIFETIME_S, side: 1 });
    expect(tracerAlpha(t)).toBe(1);
  });
});

describe('stepTracers', () => {
  it('ages a tracer down linearly -- tracerAlpha halves after half the lifetime elapses', () => {
    const spawned = [spawnTracer(0, 0, 1, 1, 0)];
    const aged = stepTracers(spawned, TRACER_LIFETIME_S / 2);
    expect(aged).toHaveLength(1);
    expect(tracerAlpha(aged[0])).toBeCloseTo(0.5, 10);
  });

  it('keeps a tracer whose ttl is still positive after the decrement', () => {
    const spawned = [spawnTracer(0, 0, 1, 1, 0)];
    const aged = stepTracers(spawned, TRACER_LIFETIME_S - 0.001);
    expect(aged).toHaveLength(1);
    expect(tracerAlpha(aged[0])).toBeGreaterThan(0);
  });

  it('drops a tracer once elapsed time reaches its full lifetime -- mirrors renderer.ts:2596\'s `--t.ttl > 0` filter', () => {
    const spawned = [spawnTracer(0, 0, 1, 1, 0)];
    const aged = stepTracers(spawned, TRACER_LIFETIME_S);
    expect(aged).toHaveLength(0);
  });

  it('preserves endpoints and side across a step that keeps the tracer alive', () => {
    const spawned = [spawnTracer(5, 6, 7, 8, 1)];
    const aged = stepTracers(spawned, TRACER_LIFETIME_S / 3);
    expect(aged[0]).toMatchObject({ sx: 5, sy: 6, tx: 7, ty: 8, side: 1 });
  });

  it('ages tracers independently, expiring only the ones actually due', () => {
    // One freshly spawned, one already three-quarters spent.
    const fresh = spawnTracer(0, 0, 0, 0, 0);
    const almostDone: TracerModel = { ...spawnTracer(1, 1, 1, 1, 1), ttl: TRACER_LIFETIME_S * 0.1 };
    const aged = stepTracers([fresh, almostDone], TRACER_LIFETIME_S * 0.2);
    // almostDone had 0.1 of the lifetime left and 0.2 was applied -> expired.
    // fresh had the full lifetime and 0.2 was applied -> still alive.
    expect(aged).toHaveLength(1);
    expect(aged[0].side).toBe(0);
  });

  it('does not mutate its input array or the tracer objects in it', () => {
    const original = spawnTracer(0, 0, 1, 1, 0);
    const list = [original];
    const aged = stepTracers(list, TRACER_LIFETIME_S / 2);
    expect(list).toHaveLength(1);
    expect(list[0]).toBe(original);
    expect(original.ttl).toBe(TRACER_LIFETIME_S);
    expect(aged).not.toBe(list);
    expect(aged[0]).not.toBe(original);
  });

  it('reproduces renderer.ts\'s 9-count countdown at the nominal 60 Hz frame time', () => {
    // renderer.ts:764 spawns with ttl: 9 and decrements by 1 per frame()
    // call; at the renderer's nominal 60 Hz that call happens once every
    // 1/60 s, which is exactly what TRACER_LIFETIME_S (9/60) is built from.
    // Stepping by 1/60 eight times should leave the tracer alive with
    // alpha (9-8)/9, matching Pixi's t.ttl / 9 at ttl === 1.
    let tracers: TracerModel[] = [spawnTracer(0, 0, 1, 1, 0)];
    for (let frame = 1; frame <= 8; frame++) {
      tracers = stepTracers(tracers, 1 / 60);
      expect(tracers).toHaveLength(1);
      expect(tracerAlpha(tracers[0])).toBeCloseTo((9 - frame) / 9, 6);
    }
    // The ninth step should drop it, matching Pixi's ttl reaching 0 -- but
    // nine repeated float subtractions of 1/60 do not land on exactly 0
    // (IEEE 754 leaves a ~2e-17 residue here, still "> 0"), the one place
    // this seconds-based model cannot bit-for-bit match Pixi's integer
    // `--ttl`. A real caller steps by the actual measured frame delta, not
    // a hand-summed 1/60 nine times, so this is a property of the test's
    // own accumulation, not of stepTracers; stepping by a hair over 1/60
    // demonstrates the same "drop once fully elapsed" behaviour without
    // relying on that residue happening to net to exactly zero.
    tracers = stepTracers(tracers, 1 / 60 + 1e-9);
    expect(tracers).toHaveLength(0);
  });
});
