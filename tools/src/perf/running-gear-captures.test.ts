import { describe, expect, it } from 'vitest';
import { laneFailure, RG_CAPTURE_SUBJECTS, type LaneReading } from './running-gear-captures';

const lane = (over: Partial<LaneReading> = {}): LaneReading => ({
  lane: 'jeep_shoded|start|z1',
  controlBound: 0,
  controlChangedPixels: 0,
  movingBound: 1,
  frames: [
    { frame: 0, changedPixels: 120, diffPixels: 10, meanAbsDelta: 0.5 },
    { frame: 1, changedPixels: 300, diffPixels: 20, meanAbsDelta: 0.9 },
  ],
  ...over,
});
const FLOORS = { 'jeep_shoded|start|z1': 200 };

describe('laneFailure', () => {
  it('passes a moving lane whose A/B peak clears its floor', () => {
    expect(laneFailure(lane(), FLOORS)).toBeNull();
  });

  it('fails a lane whose wheels never moved the picture', () => {
    expect(laneFailure(lane({ frames: [{ frame: 0, changedPixels: 0, diffPixels: 0, meanAbsDelta: 0 }] }), FLOORS)).toMatch(/under its floor/);
  });

  it('fails a parked control that is bound or moves a single pixel', () => {
    expect(laneFailure(lane({ controlChangedPixels: 1 }), FLOORS)).toMatch(/never moved/);
    expect(laneFailure(lane({ controlBound: 1 }), FLOORS)).toMatch(/never moved/);
  });

  it('fails a lane with no floor, unless calibrating', () => {
    expect(laneFailure(lane({ lane: 'x|start|z1' }), FLOORS)).toMatch(/no floor/);
    expect(laneFailure(lane({ lane: 'x|start|z1' }), FLOORS, true)).toBeNull();
    // Calibrating still holds the control.
    expect(laneFailure(lane({ controlChangedPixels: 3 }), FLOORS, true)).toMatch(/never moved/);
  });

  it('photographs the four vehicles the lead asked for', () => {
    expect(RG_CAPTURE_SUBJECTS.map((s) => s.id)).toEqual(['jeep_shoded', 'ifv_namer', 'mbt_lavi', 'dozer_d9']);
  });
});
