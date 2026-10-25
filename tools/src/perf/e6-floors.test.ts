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
    expect(f.basis).toEqual({ minDiffPixels: 900, minMeanAbsChannelDelta: 2.4001, runs: 3, distinct: 3 });
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

  it('names the run, mode and load of every stored reading, and counts the distinct ones', () => {
    for (const [key, runs] of Object.entries(E6_RUNS)) {
      for (const r of runs) {
        expect(r.label, key).toMatch(/^run \d$/);
        expect(['full', '--toggles-only'], key).toContain(r.mode);
        expect(r.load, key).toMatch(/^\d+\.\d+\/\d+\.\d+\/\d+\.\d+$/);
      }
    }
    // S6 and S8 are deterministic: three runs, ONE reading, and the floor line says so.
    expect(E6_FLOORS['S6/beam-lit']?.basis).toMatchObject({ runs: 3, distinct: 1 });
    expect(E6_FLOORS['S8/swarm']?.basis).toMatchObject({ runs: 3, distinct: 1 });
    expect(E6_FLOORS['S3/beam']?.basis).toMatchObject({ runs: 3, distinct: 2 });
    expect(E6_FLOORS['S4/beam']?.basis).toMatchObject({ runs: 3, distinct: 3 });
  });

  it('counts a repeated reading once', () => {
    expect(deriveFloor([R(5, 1), R(5, 1), R(5, 1)]).basis.distinct).toBe(1);
    expect(deriveFloor([R(5, 1), R(6, 1), R(5, 1)]).basis.distinct).toBe(2);
    expect(floorLine('S1/swarm', deriveFloor([R(900, 3), R(900, 3), R(901, 3)]))).toMatch(/3 runs, 2 distinct/);
  });

  it('derives from the stored runs exactly what the floors in force are', () => {
    const recomputed = floorsFor({ 'S1/swarm': [R(300, 3), R(600, 4)] });
    expect(recomputed['S1/swarm']).toMatchObject({ minDiffPixels: 100, minMeanAbsChannelDelta: 1 });
    expect(E6_FLOORS['S1/swarm']?.minDiffPixels).toBe(1120);
    expect(E6_FLOORS['S3/beam-shimmer']?.minMeanAbsChannelDelta).toBe(0.0047);
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

  it('FAILS a zero key whose hide call resolved 0 objects: a layer that hid nothing measures nothing', () => {
    const v = checkVerdict('S5/beam@0', R(0, 0), toy, 0);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/resolved 0 objects/);
    expect(checkVerdict('S5/beam@0', R(0, 0), toy, 1).ok).toBe(true);
    expect(checkVerdict('S5/beam@0', R(0, 0), toy).ok).toBe(true); // no count given: unchanged behaviour
  });

  it('never judges a report-only key, in either direction (it cannot go red, so it must not read as green)', () => {
    expect(E6_KEYS['S8/missiles@50ms'].kind).toBe('info');
    expect(checkVerdict('S8/missiles@50ms', R(0, 0), toy, 3)).toMatchObject({ ok: true, reasons: [] });
    expect(checkVerdict('S8/missiles@50ms', R(9999, 9), toy, 0).ok).toBe(true);
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

describe('the falsification table is stamped as data', () => {
  /** The readings the eight falsification runs produced, written out here so the table cannot drift from them. */
  const STAMPED: Record<string, { key: string; reading?: Reading }> = {
    'F1 draw count, not swarmMembers': { key: 'readback' },
    'F2 drop the lowest slot, not the highest': { key: 'relation' },
    'F3 a beam with no forced shutdown (ignores locked and the lockout event)': { key: 'S5/beam@0', reading: R(4894, 3.7363) },
    'F4 a beam that keeps its last target through a break': { key: 'S6/beam', reading: R(247, 0.3201) },
    'F5 the shimmer not fed': { key: 'S3/beam-shimmer', reading: R(0, 0) },
    'F6 the swarm layer not consulted per frame': { key: 'S1/swarm', reading: R(0, 0) },
    'F7 wrecks not spawned': { key: 'S7/swarm-wrecks', reading: R(0, 0) },
    'F8 a swarm dive routed through missile': { key: 'S8/bloom@50ms', reading: R(9860, 4.4517) },
  };

  it('records exactly the eight, with the keys and readings the runs produced', () => {
    expect(E6_FALSIFICATIONS.map((f) => f.id).sort()).toEqual(Object.keys(STAMPED).sort());
    for (const f of E6_FALSIFICATIONS) {
      const want = STAMPED[f.id];
      expect(f.key, f.id).toBe(want.key);
      if (want.reading !== undefined) expect(f.reading, f.id).toEqual(want.reading);
      else expect(typeof f.reading, f.id).toBe('string');
    }
  });

  it('would have gone red: each stamped floor or zero reading is refused by its key, against the floors in force', () => {
    for (const [id, want] of Object.entries(STAMPED)) {
      if (want.reading === undefined) continue;
      expect(checkVerdict(want.key, want.reading).ok, `${id} would have passed`).toBe(false);
    }
  });

  it('and the same keys PASS on the readings of the unmutated build', () => {
    expect(checkVerdict('S5/beam@0', R(0, 0), E6_FLOORS, 1).ok).toBe(true);
    expect(checkVerdict('S6/beam', R(0, 0), E6_FLOORS, 1).ok).toBe(true);
    expect(checkVerdict('S8/bloom@50ms', R(0, 0), E6_FLOORS, 1).ok).toBe(true);
    expect(checkVerdict('S3/beam-shimmer', R(25, 0.0141)).ok).toBe(true);
    expect(checkVerdict('S1/swarm', R(3433, 1.357)).ok).toBe(true);
    expect(checkVerdict('S7/swarm-wrecks', R(227, 0.0973)).ok).toBe(true);
  });
});
