import { describe, expect, it } from 'vitest';
import { MAX_SUPPORT_FLIGHTS, SupportAircraftManager } from './support-aircraft';

type Plan = { anchorMs: number; anchored: boolean };
const plans = (m: SupportAircraftManager): Plan[] =>
  (m as unknown as { flights: { plan: Plan }[] }).flights.map((f) => f.plan);
const flat = (): number => 0;

describe('SupportAircraftManager', () => {
  it('re-anchors a plan on its own first round only', () => {
    const m = new SupportAircraftManager(0xffffff);
    m.call('barrage', 100, 20, 20, 10, 20);
    // A strike 10 ticks early is no round of this call.
    m.onStrike(1, 100 + 110, 20, 20);
    expect(plans(m)[0].anchored).toBe(false);
    // The first round, one tick late (the click-to-apply gap).
    m.onStrike(1, 100 + 121, 20.5, 19.5);
    expect(plans(m)[0]).toEqual(expect.objectContaining({ anchored: true, anchorMs: 101 * 50 }));
    m.dispose();
  });

  it('call() returns the plan it keeps, and a strike re-anchors that very object (the audio holds it, GH-782)', () => {
    const m = new SupportAircraftManager(0xffffff);
    const plan = m.call('barrage', 100, 20, 20, 10, 20);
    expect(plan).toBe(plans(m)[0]);
    expect(plan).toEqual(expect.objectContaining({ kind: 'barrage', anchorMs: 100 * 50, anchored: false, ax: 20, ay: 20 }));
    m.onStrike(1, 100 + 121, 20.5, 19.5);
    expect(plan.anchored).toBe(true);
    expect(plan.anchorMs).toBe(101 * 50);
    m.dispose();
  });

  it('does not let an earlier barrage re-anchor a later one over the same ground', () => {
    const m = new SupportAircraftManager(0xffffff);
    m.call('barrage', 0, 20, 20, 10, 20);
    m.call('barrage', 200, 20, 20, 10, 20); // called 10 s later
    // The first call's round 4 lands at 120 + 3 * 36 = 228: inside the second's
    // aim reach, and nowhere near its first round at 200 + 120.
    m.onStrike(1, 0 + 120, 20, 20);
    m.onStrike(1, 228, 20, 20);
    expect(plans(m).map((p) => p.anchored)).toEqual([true, false]);
    expect(plans(m)[1].anchorMs).toBe(200 * 50);
    m.onStrike(1, 320, 20, 20);
    expect(plans(m)[1].anchored).toBe(true);
    m.dispose();
  });

  it('ignores a strike of the other kind and one far from the aim point', () => {
    const m = new SupportAircraftManager(0xffffff);
    m.call('strike', 0, 5, 5, 0, 5);
    m.onStrike(1, 60, 5, 5); // a barrage profile
    m.onStrike(0, 60, 15, 5); // 10 tiles off
    expect(plans(m)[0].anchored).toBe(false);
    m.onStrike(0, 60, 5.2, 5);
    expect(plans(m)[0].anchored).toBe(true);
    m.dispose();
  });

  it('caps the flights and retires each one after its span, with no meshes loaded', () => {
    const m = new SupportAircraftManager(0xffffff);
    for (let i = 0; i < MAX_SUPPORT_FLIGHTS + 2; i++) m.call('strike', i, 5, 5, null, null);
    expect(m.flightCount).toBe(MAX_SUPPORT_FLIGHTS);
    m.update(1500, flat); // inside every span: nothing to draw, nothing retired
    expect(m.flightCount).toBe(MAX_SUPPORT_FLIGHTS);
    expect(m.group.children).toHaveLength(0);
    m.update(60_000, flat);
    expect(m.flightCount).toBe(0);
    m.dispose();
  });

  it('hides its group under the support-air flag, and keeps it hidden across update', () => {
    const m = new SupportAircraftManager(0xffffff);
    m.setDebugHidden(true);
    m.update(0, flat);
    expect(m.group.visible).toBe(false);
    m.setDebugHidden(false);
    m.update(0, flat);
    expect(m.group.visible).toBe(true);
    m.dispose();
  });
});
