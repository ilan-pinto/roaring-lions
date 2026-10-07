import { describe, expect, it } from 'vitest';
import {
  FLINCH_DEG,
  FLINCH_SECONDS,
  flinchPitch,
  flinches,
  LEAN_FROM,
  LEAN_FULL,
  LEAN_RATE_RAD_S,
  leanTarget,
  ROUT_LEAN,
  stepLean,
  SUPPRESSED_LEAN,
  approachAngle,
  cadenceMultiplier,
  CADENCE_VARIANCE,
  clipPhase,
  kneelClipFor,
  kneelHeading,
  lerpFacingTurns,
  recoilAt,
  recoilSeconds,
  RECOIL_MULTIPLIER,
  shotJitterS,
  SLOT_LAG_MAX_M,
  slotDrift,
  DRIFT_ALONG_M,
  DRIFT_ACROSS_M,
  stepDepth,
  stepFollower,
  KNEEL_TRANSITION_S,
  wrapAngle,
  type Follower,
} from './squad-motion';

const DEG = Math.PI / 180;

describe('the yaw is interpolated the short way round (finding #4)', () => {
  it('halfway between two ticks is halfway', () => {
    expect(lerpFacingTurns(0.1, 0.2, 0.5)).toBeCloseTo(0.15, 9);
  });
  it('across the 0/1 wrap it does not swing the long way', () => {
    // 0.95 -> 0.05 turns is 36 deg of turn, not 324.
    const mid = lerpFacingTurns(0.95, 0.05, 0.5);
    expect(((mid % 1) + 1) % 1).toBeCloseTo(0, 9);
  });
  it('approachAngle turns the short way and never overshoots', () => {
    expect(approachAngle(170 * DEG, -170 * DEG, 5 * DEG)).toBeCloseTo(175 * DEG, 9);
    expect(approachAngle(0, 0.01, 1)).toBe(0.01);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
  });
});

describe('the follower: start/stop ramp and the approved 0.25 m lag cap', () => {
  it('a standing start at 2.7 m/s never trails its slot by more than the cap', () => {
    const f: Follower = { x: 0, z: 0, vx: 0, vz: 0 };
    let worst = 0;
    for (let k = 1; k <= 120; k++) {
      const t = k / 60;
      stepFollower(f, 2.7 * t, 0, 2.7, 0, 1 / 60);
      worst = Math.max(worst, 2.7 * t - f.x);
    }
    expect(worst).toBeLessThanOrEqual(SLOT_LAG_MAX_M + 1e-9);
    // ...and it is a RAMP, not a teleport: the first frame does not reach speed.
    const g: Follower = { x: 0, z: 0, vx: 0, vz: 0 };
    stepFollower(g, 2.7 / 60, 0, 2.7, 0, 1 / 60);
    expect(g.vx).toBeLessThan(1);
  });
  it('the cap holds even when the acceleration cannot: a slot that jumps', () => {
    // At a run the ramp alone keeps the lag under the cap (above), so that
    // check cannot see the cap. A slot that jumps 2 m in a frame -- a unit
    // dismounting or surfacing -- can only be held by the cap itself.
    const f: Follower = { x: 0, z: 0, vx: 0, vz: 0 };
    stepFollower(f, 2, 0, 0, 0, 1 / 60);
    expect(2 - f.x).toBeLessThanOrEqual(SLOT_LAG_MAX_M + 1e-9);
  });

  it('settles onto its slot when the slot stops', () => {
    const f: Follower = { x: 0, z: 0, vx: 2.7, vz: 0 };
    for (let k = 0; k < 120; k++) stepFollower(f, 1, 0, 0, 0, 1 / 60);
    expect(Math.abs(f.x - 1)).toBeLessThan(0.01);
    expect(Math.hypot(f.vx, f.vz)).toBeLessThan(0.05);
  });
});

describe('no lockstep: every figure its own phase, cadence and drift, by entity hash', () => {
  it('is deterministic for the same entity and figure', () => {
    expect(clipPhase(42, 1)).toBe(clipPhase(42, 1));
    expect(cadenceMultiplier(42, 2)).toBe(cadenceMultiplier(42, 2));
    expect(slotDrift(42, 0, 3.3)).toEqual(slotDrift(42, 0, 3.3));
  });
  it('separates the figures of one unit, and two units ordered together', () => {
    const phases = [0, 1, 2].map((f) => clipPhase(7, f));
    expect(new Set(phases.map((p) => p.toFixed(3))).size).toBe(3);
    expect(clipPhase(7, 0)).not.toBe(clipPhase(8, 0));
  });
  it('keeps cadence inside +-6% and drift inside its approved amplitudes', () => {
    for (let id = 0; id < 200; id++) {
      for (let f = 0; f < 3; f++) {
        const c = cadenceMultiplier(id, f);
        expect(Math.abs(c - 1)).toBeLessThanOrEqual(CADENCE_VARIANCE + 1e-12);
        const [a, b] = slotDrift(id, f, id * 0.37);
        expect(Math.abs(a)).toBeLessThanOrEqual(DRIFT_ALONG_M + 1e-12);
        expect(Math.abs(b)).toBeLessThanOrEqual(DRIFT_ACROSS_M + 1e-12);
      }
    }
  });
  it('lands a shot 0-120 ms after it is fired', () => {
    for (let s = 0; s < 100; s++) {
      const j = shotJitterS(3, s);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(0.12);
    }
  });
});

describe('recoil: the approved kick per weapon, at its shipped multiplier', () => {
  const peak = (kind: 'rifle' | 'mg' | 'launcher', rounds = 3): { max: number; min: number } => {
    let max = -Infinity;
    let min = Infinity;
    for (let t = 0; t <= recoilSeconds(kind, rounds); t += 0.002) {
      const p = recoilAt(kind, t, rounds).pitch;
      max = Math.max(max, p);
      min = Math.min(min, p);
    }
    return { max, min };
  };
  it('a rifle kicks back and up: at least 4 deg x2.5 at its peak, down to rest after', () => {
    expect(peak('rifle').max).toBeGreaterThan(4 * DEG * RECOIL_MULTIPLIER.rifle * 0.99);
    expect(recoilAt('rifle', recoilSeconds('rifle', 3), 3).pitch).toBeCloseTo(0, 9);
  });
  it('an MG climbs over its burst and shudders sideways; a launcher flinches DOWN, not back', () => {
    const mg = peak('mg', 8);
    expect(mg.max).toBeGreaterThan(5 * DEG * RECOIL_MULTIPLIER.mg);
    let shudder = 0;
    for (let t = 0; t < 0.6; t += 0.005) shudder = Math.max(shudder, Math.abs(recoilAt('mg', t, 8).yaw));
    expect(shudder).toBeGreaterThan(0.5 * DEG);
    const l = peak('launcher');
    expect(l.max).toBeLessThanOrEqual(0);
    expect(l.min).toBeLessThan(-2 * DEG * RECOIL_MULTIPLIER.launcher);
  });
  it('is exactly zero before the shot', () => {
    expect(Math.abs(recoilAt('rifle', -0.01, 3).pitch)).toBe(0);
    expect(Math.abs(recoilAt('launcher', -0.01, 3).pitch)).toBe(0);
  });
});

describe('the kneel: depth and clip', () => {
  it('a drop takes the sim transition time, whatever the frame rate', () => {
    let d = 0;
    let t = 0;
    while (d < 1) {
      d = stepDepth(d, 1, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(KNEEL_TRANSITION_S, 1);
  });
  it('plays kneelIn going down, kneelOut coming up, kneel when down, and never over a forced posture', () => {
    expect(kneelClipFor('fire', 0.5, 'down', true)).toEqual({ clip: 'kneelIn', scrub: 0.5 });
    expect(kneelClipFor('idle', 0.25, 'up', true)).toEqual({ clip: 'kneelOut', scrub: 0.75 });
    expect(kneelClipFor('fire', 1, 'down', true)).toEqual({ clip: 'kneel', scrub: null });
    expect(kneelClipFor('down', 1, 'down', true)).toEqual({ clip: 'down', scrub: null });
    expect(kneelClipFor('fire', 1, 'down', false)).toEqual({ clip: 'fire', scrub: null });
  });
  it('heads up only while the sim says rising, whatever the depth and target read', () => {
    // The sim case: the renderer sets depth FROM target, so they tie.
    expect(kneelHeading('rising', true, 0.5, 0.5, 'down')).toBe('up');
    expect(kneelHeading('dropping', true, 0.5, 0.5, 'up')).toBe('down');
    expect(kneelHeading('kneeling', true, 1, 1, 'up')).toBe('up');
    // The fallback: the way the depth is moving, a tie keeping the last.
    expect(kneelHeading('rising', false, 0.6, 0, 'down')).toBe('up');
    expect(kneelHeading('dropping', false, 0.4, 1, 'up')).toBe('down');
    expect(kneelHeading('none', false, 0.4, 0.4, 'up')).toBe('up');
  });
});

describe('the suppression lean (pass C2/C4, P2)', () => {
  const none = { spine: 0, neck: 0, head: 0 };
  it('is zero below 0.15 and full from 0.70, smooth between', () => {
    expect(leanTarget(0, false, false, false)).toEqual(none);
    expect(leanTarget(LEAN_FROM, false, false, false)).toEqual(none);
    expect(leanTarget(LEAN_FULL, false, false, false)).toEqual({ ...SUPPRESSED_LEAN });
    expect(leanTarget(1.7, false, false, false)).toEqual({ ...SUPPRESSED_LEAN });
    const mid = leanTarget((LEAN_FROM + LEAN_FULL) / 2, false, false, false).spine;
    expect(mid).toBeCloseTo(SUPPRESSED_LEAN.spine / 2, 9);
    // Monotone: more suppression never leans a man less.
    let prev = -1;
    for (let s = 0; s <= 1; s += 0.01) {
      const v = leanTarget(s, false, false, false).spine;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it('adds nothing while pinned (the huddle is the fold), and pitches a broken man running', () => {
    expect(leanTarget(1.7, true, false, false)).toEqual(none);
    expect(leanTarget(1.7, true, true, false)).toEqual(none);
    expect(leanTarget(1.7, true, true, true)).toEqual({ ...ROUT_LEAN });
  });
  it('follows its target at a bounded rate', () => {
    const full = { ...SUPPRESSED_LEAN };
    const a = stepLean(none, full, 0.05);
    expect(a.spine).toBeCloseTo(LEAN_RATE_RAD_S * 0.05, 9);
    expect(stepLean(a, full, 10)).toEqual(full);
    expect(stepLean(full, none, 0)).toEqual(full);
  });
});

describe('the near-miss flinch (pass C2/C4, P5)', () => {
  it('dips and recovers inside 0.3 s, and is exactly zero outside it', () => {
    expect(flinchPitch(-0.01)).toBe(0);
    expect(flinchPitch(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(flinchPitch(FLINCH_SECONDS)).toBe(0);
    expect(flinchPitch(0.06)).toBeCloseTo((FLINCH_DEG * Math.PI) / 180, 9);
    expect(flinchPitch(0.2)).toBeGreaterThan(0);
    expect(flinchPitch(0.2)).toBeLessThan(flinchPitch(0.06));
  });
  it('takes a man already under fire or pinned, never a broken one, and never under reduced motion', () => {
    expect(flinches(0.1, false, false, false)).toBe(false);
    expect(flinches(LEAN_FROM, false, false, false)).toBe(true);
    expect(flinches(0, true, false, false)).toBe(true);
    expect(flinches(1.7, true, true, false)).toBe(false);
    expect(flinches(1.7, true, false, true)).toBe(false);
  });
});
