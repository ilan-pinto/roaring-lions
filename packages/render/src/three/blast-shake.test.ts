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

describe('the null decision', () => {
  // C1: `blastShake` returns `null` when the emitter never declared a
  // `screen_shake.amplitude_px`. `pushShake` must treat that as a silent
  // no-op, contributing nothing -- so Task 7 can call
  // `pushShake(state, blastShake(em, power), wx, wy)` with no null check.
  it('a null shake is a silent no-op', () => {
    const s = pushShake(initShakeState(), null, 0, 0);
    expect(s.live).toHaveLength(0);
    expect(shakeOffsetPx(s, 0, 0)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('a non-positive falloff_tiles', () => {
  // Minor: a source whose falloff_tiles is 0 (or negative) never contributes,
  // even sampled at its own origin -- there is no "always full strength, no
  // falloff" reading of a zero radius, so it is inert rather than infinite.
  it('makes the source permanently inert, even at its own origin', () => {
    const s = pushShake(initShakeState(), { ...SHAKE, falloffTiles: 0 }, 0, 0);
    expect(shakeOffsetPx(s, 0, 0)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('a negative dtMs never rewinds presentation time', () => {
  // I2: without clamping dtMs to >= 0, `remainingMs - dtMs` with a negative
  // dtMs ADDS -- a drained hit-stop would come back frozen.
  it('a negative hit-stop step leaves an already-drained state drained', () => {
    const r = stepHitStop({ remainingMs: 0 }, -500);
    expect(r).toEqual({ state: { remainingMs: 0 }, frozen: false });
  });

  // I2: without the clamp, `ageMs + dtMs` with a negative dtMs REDUCES age,
  // which (via shakeOffsetPx's unbounded-above decay) makes the shake read
  // LOUDER than authored rather than merely younger.
  it('a negative shake step does not reduce a shake\'s age', () => {
    let s = pushShake(initShakeState(), SHAKE, 0, 0);
    s = stepShake(s, 100);
    const before = shakeOffsetPx(s, 0, 0);
    s = stepShake(s, -500);
    const after = shakeOffsetPx(s, 0, 0);
    expect(after).toEqual(before);
  });
});

describe('MAX falls through to the next source when the loudest retires', () => {
  // I3: source A (amplitude 9, duration 420ms) pushed at global t=0; source B
  // (amplitude 3, duration 1000ms) pushed at global t=300ms. Stepping 120ms
  // more lands at global t=420ms, exactly A's own durationMs -- A retires
  // this step (stepShake drops ageMs >= durationMs) while B, now aged 120ms,
  // is still live. The offset must be B's OWN decayed value, not zero (A
  // retiring must not blank the whole state) and not A+B (retired sources
  // never come back, and MAX never sums in the first place -- R-R).
  //
  // B's own curve, both sources sharing falloffTiles=14 and sampled at their
  // shared origin (distance 0, falloff=1): decay = 1 - 120/1000 = 0.88;
  // oscillation = sin(2*pi*26*0.12) = 0.6845471059286876; value =
  // 3 * 1 * 0.88 * 0.6845471059286876 = 1.8072043596517353.
  it('gives the survivor\'s own decayed amplitude, not zero and not the sum', () => {
    let s = pushShake(initShakeState(), SHAKE, 0, 0); // A, at global t=0
    s = stepShake(s, 300); // global t=300
    s = pushShake(s, { amplitudePx: 3, durationMs: 1000, falloffTiles: 14 }, 0, 0); // B
    s = stepShake(s, 120); // global t=420 -- A retires this step, B is 120ms old
    expect(s.live).toHaveLength(1); // A is gone; only B remains
    expect(mag(shakeOffsetPx(s, 0, 0))).toBeCloseTo(1.8072043596517353, 9);
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
