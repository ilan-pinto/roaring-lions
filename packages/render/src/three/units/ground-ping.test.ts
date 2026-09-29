/**
 * GH-279: the refuge ring's envelope -- a second at full strength, a linear
 * fade to nothing at three, restarted by a second ping.
 */
import { describe, expect, it } from 'vitest';
import { GroundPing, PING_END_MS, PING_HOLD_MS, pingEnvelope } from './ground-ping';

describe('pingEnvelope', () => {
  it('holds at full strength for the first second', () => {
    expect(PING_HOLD_MS).toBe(1000);
    for (const t of [0, 1, 500, 999, 1000]) expect(pingEnvelope(t)).toBe(1);
  });

  it('fades linearly from the end of the hold to zero at three seconds', () => {
    expect(PING_END_MS).toBe(3000);
    expect(pingEnvelope(1500)).toBeCloseTo(0.75, 10);
    expect(pingEnvelope(2000)).toBeCloseTo(0.5, 10);
    expect(pingEnvelope(2500)).toBeCloseTo(0.25, 10);
    // Linear: equal steps of time take equal steps of strength.
    const a = pingEnvelope(1200) - pingEnvelope(1400);
    const b = pingEnvelope(2600) - pingEnvelope(2800);
    expect(a).toBeCloseTo(b, 10);
  });

  it('is zero from three seconds on', () => {
    expect(pingEnvelope(3000)).toBe(0);
    expect(pingEnvelope(60_000)).toBe(0);
  });
});

describe('GroundPing', () => {
  it('draws nothing until pinged -- it is never a standing mark', () => {
    const p = new GroundPing();
    expect(p.view()).toBeNull();
    p.step(16);
    expect(p.view()).toBeNull();
  });

  it('shows at the pinged point, ages by the frame clock, and is gone at three seconds', () => {
    const p = new GroundPing();
    p.restart(24.5, 22.5);
    expect(p.view()).toEqual({ x: 24.5, y: 22.5, strength: 1 });
    p.step(1000);
    expect(p.view()?.strength).toBe(1);
    p.step(1000);
    expect(p.view()?.strength).toBeCloseTo(0.5, 10);
    p.step(999);
    expect(p.view()?.strength).toBeGreaterThan(0);
    p.step(1);
    expect(p.view()).toBeNull();
  });

  it('adds up many small frames the same as one big one', () => {
    const p = new GroundPing();
    p.restart(0, 0);
    for (let i = 0; i < 120; i++) p.step(1000 / 60);
    expect(p.view()?.strength).toBeCloseTo(pingEnvelope(2000), 6);
  });

  it('a zero-length frame (a presentation freeze) holds the ring where it is', () => {
    const p = new GroundPing();
    p.restart(0, 0);
    p.step(1500);
    const before = p.view()?.strength;
    p.step(0);
    expect(p.view()?.strength).toBe(before);
  });

  it('a re-trigger restarts the whole envelope, at the new point', () => {
    const p = new GroundPing();
    p.restart(1, 1);
    p.step(2500);
    expect(p.view()?.strength).toBeCloseTo(0.25, 10);
    p.restart(5, 6);
    expect(p.view()).toEqual({ x: 5, y: 6, strength: 1 });
    // A full hold again from the restart, not from the first ping.
    p.step(1000);
    expect(p.view()?.strength).toBe(1);
  });

  it('a re-trigger after it has gone brings it back', () => {
    const p = new GroundPing();
    p.restart(1, 1);
    p.step(5000);
    expect(p.view()).toBeNull();
    p.restart(1, 1);
    expect(p.view()?.strength).toBe(1);
  });
});
