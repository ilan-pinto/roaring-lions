import { describe, expect, it } from 'vitest';
import {
  initShakeState,
  pushShake,
  requestHitStop,
  shakeOffsetPx,
  stepHitStop,
  stepShake,
} from './blast-shake';

const SHAKE = { amplitudePx: 9, durationMs: 420, falloffTiles: 14 };
const mag = (o: { dx: number; dy: number }) => Math.hypot(o.dx, o.dy);

describe('the shake falls off with distance', () => {
  it('is at full amplitude under the camera and exactly zero at falloff_tiles', () => {
    const s = pushShake(initShakeState(), SHAKE, 10, 10);
    expect(mag(shakeOffsetPx(s, 10, 10))).toBeLessThanOrEqual(9);
    expect(mag(shakeOffsetPx(s, 10 + 14, 10))).toBe(0);
    expect(mag(shakeOffsetPx(s, 10 + 40, 10))).toBe(0);
  });

  it('is weaker halfway out than at the source', () => {
    const s = pushShake(initShakeState(), SHAKE, 0, 0);
    // stepped off zero so the sine is not at a node for either sample
    const t = stepShake(s, 8);
    expect(mag(shakeOffsetPx(t, 7, 0))).toBeLessThan(mag(shakeOffsetPx(t, 0, 0)));
  });
});

describe('the shake decays and retires', () => {
  it('is gone at duration_ms and the state does not keep it', () => {
    let s = pushShake(initShakeState(), SHAKE, 0, 0);
    s = stepShake(s, 420);
    expect(s.live).toHaveLength(0);
    expect(shakeOffsetPx(s, 0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  // R-R: MAX, never sum. Summing would let two blasts exceed the schema's own
  // amplitude_px ceiling of 24 with no second clamp anywhere to catch it.
  it('two live shakes give the stronger one, not their sum', () => {
    let s = pushShake(initShakeState(), SHAKE, 0, 0);
    s = pushShake(s, { ...SHAKE, amplitudePx: 4 }, 0, 0);
    s = stepShake(s, 8);
    expect(mag(shakeOffsetPx(s, 0, 0))).toBeLessThanOrEqual(9);
  });

  // Determinism of presentation: the same age gives the same offset, always.
  // The oscillation is a function of the shake's own age -- never a PRNG draw,
  // which would touch the seeded streams the sim owns.
  it('is a pure function of age, so two identical replays shake identically', () => {
    const run = () => {
      let s = pushShake(initShakeState(), SHAKE, 0, 0);
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        s = stepShake(s, 16);
        out.push(shakeOffsetPx(s, 0, 0).dx);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('the hit-stop', () => {
  it('freezes for the requested window and then releases', () => {
    let st = requestHitStop({ remainingMs: 0 }, 70);
    let r = stepHitStop(st, 16);
    expect(r.frozen).toBe(true);
    st = r.state;
    for (let i = 0; i < 3; i++) st = stepHitStop(st, 16).state;
    r = stepHitStop(st, 16);
    expect(r.frozen).toBe(false);
    expect(r.state.remainingMs).toBe(0);
  });

  // R-R: a salvo must not stack. Twenty rounds asking for 40 ms each is the
  // whole engagement in slow motion if they queue.
  it('a request made while one runs takes the max and never extends past it', () => {
    let st = requestHitStop({ remainingMs: 0 }, 70);
    st = stepHitStop(st, 30).state;      // 40 left
    st = requestHitStop(st, 40);          // same length, already running
    expect(st.remainingMs).toBe(40);
    st = requestHitStop(st, 100);         // longer: allowed to win
    expect(st.remainingMs).toBe(100);
  });

  it('never freezes on a zero or negative request', () => {
    expect(stepHitStop(requestHitStop({ remainingMs: 0 }, 0), 16).frozen).toBe(false);
    expect(stepHitStop(requestHitStop({ remainingMs: 0 }, -5), 16).frozen).toBe(false);
  });
});
