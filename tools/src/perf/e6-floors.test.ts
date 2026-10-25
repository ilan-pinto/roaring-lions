import { describe, expect, it } from 'vitest';
import {
  E6_CALIBRATION,
  E6_FALSIFICATIONS,
  E6_FLOORS,
  E6_KEYS,
  E6_KEY_LIST,
  E6_RUNS,
  checkVerdict,
  deriveFloor,
  floorLine,
  floorsFor,
  type FloorKey,
  type Reading,
} from './e6-floors';

const R = (diffPixels: number, meanAbsChannelDelta: number): Reading => ({ diffPixels, meanAbsChannelDelta });

describe('a floor is a third of the smallest measured run (R-M)', () => {
  it('takes the third of the smallest per metric, independently, rounded DOWN', () => {
    const f = deriveFloor([R(900, 3.3), R(1200, 2.4001), R(1000, 5)]);
    expect(f.minDiffPixels).toBe(300);
    expect(f.minMeanAbsChannelDelta).toBe(0.8);
    expect(f.basis).toEqual({ minDiffPixels: 900, minMeanAbsChannelDelta: 2.4001, runs: 3 });
    // 7 / 3 = 2.33 rounds down to 2, never up to 3.
    expect(deriveFloor([R(7, 0.7)]).minDiffPixels).toBe(2);
  });

  it('refuses to derive a floor from nothing', () => {
    expect(() => deriveFloor([])).toThrow(/no runs/);
  });

  it('records the sample size beside every floor, because a range with no n is an anecdote', () => {
    for (const key of E6_KEY_LIST) {
      const floor = E6_FLOORS[key];
      if (floor !== undefined) expect(floor.basis.runs, key).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every floor at or under a third of its smallest run, and never above the run', () => {
    for (const [key, floor] of Object.entries(E6_FLOORS)) {
      expect(floor.minDiffPixels * 3, key).toBeLessThanOrEqual(floor.basis.minDiffPixels);
      expect(floor.minMeanAbsChannelDelta * 3, key).toBeLessThanOrEqual(floor.basis.minMeanAbsChannelDelta + 1e-9);
      for (const run of E6_RUNS[key] ?? []) {
        expect(run.diffPixels, key).toBeGreaterThanOrEqual(floor.minDiffPixels);
        expect(run.meanAbsChannelDelta, key).toBeGreaterThanOrEqual(floor.minMeanAbsChannelDelta);
      }
    }
  });

  it('derives the floors from the runs, so neither can be edited without the other', () => {
    expect(floorsFor(E6_RUNS)).toEqual(E6_FLOORS);
  });

  it('calibrates every floor key, with the conditions written down', () => {
    const floorKeys = E6_KEY_LIST.filter((k) => E6_KEYS[k].kind === 'floor');
    for (const key of floorKeys) expect(E6_FLOORS[key], `${key} has no floor`).toBeDefined();
    expect(E6_CALIBRATION).toMatch(/ANGLE/);
    expect(E6_CALIBRATION).toMatch(/Metal/);
  });
});

describe('a zero must fail a floor key, and only a zero passes a zero key', () => {
  const toy: Partial<Record<FloorKey, ReturnType<typeof deriveFloor>>> = { 'S3/beam': deriveFloor([R(900, 3), R(900, 3), R(900, 3)]) };

  it('fails 0 px / 0.0000 against a floor', () => {
    const v = checkVerdict('S3/beam', R(0, 0), toy);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/diffPixels 0 < floor 300/);
  });

  it('fails on EITHER metric, not only their conjunction', () => {
    expect(checkVerdict('S3/beam', R(5000, 0.5), toy).ok).toBe(false);
    expect(checkVerdict('S3/beam', R(10, 9), toy).ok).toBe(false);
    expect(checkVerdict('S3/beam', R(5000, 9), toy).ok).toBe(true);
  });

  it('fails an uncalibrated floor key outright', () => {
    const v = checkVerdict('S1/swarm', R(99999, 99), {});
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/uncalibrated/);
  });

  it('passes a zero key on exactly 0 / 0 and refuses any movement at all', () => {
    expect(checkVerdict('S5/beam@0', R(0, 0), toy).ok).toBe(true);
    expect(checkVerdict('S5/beam@0', R(1, 0), toy).ok).toBe(false);
    expect(checkVerdict('S5/beam@0', R(0, 0.0001), toy).ok).toBe(false);
  });

  it('fails an unknown key rather than throwing or passing', () => {
    const v = checkVerdict('S9/nothing', R(0, 0), toy);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/no key/);
  });
});

describe('the key table', () => {
  it('names every spec 8 subject S1 to S8', () => {
    const subjects = new Set<string>(E6_KEY_LIST.map((k) => E6_KEYS[k].subject));
    for (const s of ['S1', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) expect(subjects.has(s), s).toBe(true);
  });

  it('pairs every zero key with a floor key that proves its toggle works (S5, S6, S8)', () => {
    for (const key of E6_KEY_LIST) {
      const spec = E6_KEYS[key] as { kind: string; controlOf?: string };
      if (spec.kind !== 'zero') continue;
      expect(spec.controlOf, `${key} has no positive control`).toBeDefined();
      const control = E6_KEYS[spec.controlOf as FloorKey];
      expect(control.kind, `${key}'s control ${spec.controlOf} must be a floor key`).toBe('floor');
      // The control toggles the same layer, so a zero cannot come from a layer that never works. The two S8
      // keys that watch for what a routed dive would throw (`missiles`, `bloom`) are controlled by the swarm
      // toggle in the same frame, and by their falsification run (which reads them nonzero).
      const sameLayer = E6_KEYS[key].subject === 'S8' ? control.subject === 'S8' : control.layer === E6_KEYS[key].layer;
      expect(sameLayer, key).toBe(true);
    }
  });

  it('toggles only layers the renderer registers', async () => {
    const { DEBUG_LAYERS } = await import('../../../packages/render/src/three/debug-layers');
    for (const key of E6_KEY_LIST) expect(DEBUG_LAYERS as readonly string[], key).toContain(E6_KEYS[key].layer);
  });

  it('prints a floor line that says which column votes when pixels do not', () => {
    const f = deriveFloor([R(0, 0.6), R(0, 0.6), R(0, 0.6)]);
    expect(floorLine('S3/beam-shimmer', f)).toMatch(/pixel count does not gate this key/);
    expect(floorLine('S1/swarm', deriveFloor([R(900, 3)]))).toMatch(/300 px/);
  });
});

describe('every recorded falsification is refused by the floors in force', () => {
  it('records at least one falsification for each of the eight spec mutations', () => {
    expect(E6_FALSIFICATIONS.length).toBeGreaterThanOrEqual(8);
    const ids = E6_FALSIFICATIONS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('would have gone red: each recorded floor or zero reading fails its key', () => {
    for (const f of E6_FALSIFICATIONS) {
      if (typeof f.reading === 'string') continue; // a readback or a relation: prose, asserted by the run
      expect(checkVerdict(f.key, f.reading).ok, `${f.id} (${f.key}) would have passed`).toBe(false);
    }
  });
});
