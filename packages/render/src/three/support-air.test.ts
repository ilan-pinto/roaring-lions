import { describe, expect, it } from 'vitest';
import {
  HELI_STATION_TILES,
  JET_LEAD_MS,
  STRIKE_SCORCH_FLAT_TILES,
  STRIKE_SCORCH_RELIEF_TILES,
  bombFallFraction,
  impactWindowMs,
  makeSupportAirPlan,
  planSpanMs,
  reanchor,
  strikeScorchRadius,
  supportAirKind,
  supportAirPose,
} from './support-air';

// The oracle takes LITERALS from tuning.ts's FIRE_SUPPORT rows, not the table
// itself: barrage delay 120 ticks, 6 rounds 36 apart; air strike delay 60.
const BARRAGE_FIRST_MS = 6000;
const BARRAGE_LAST_MS = 15000;
const STRIKE_IMPACT_MS = 3000;

describe('supportAirKind', () => {
  it('flies an aircraft for the barrage and the air strike only', () => {
    expect(supportAirKind('mortar_barrage')).toBe('barrage');
    expect(supportAirKind('air_strike')).toBe('strike');
    expect(supportAirKind('smoke_screen')).toBeNull();
    expect(supportAirKind('drone_sweep')).toBeNull();
  });
});

describe('impactWindowMs', () => {
  it('reads the sim table', () => {
    expect(impactWindowMs('barrage')).toEqual({ first: BARRAGE_FIRST_MS, last: BARRAGE_LAST_MS });
    expect(impactWindowMs('strike')).toEqual({ first: STRIKE_IMPACT_MS, last: STRIKE_IMPACT_MS });
  });
});

describe('the barrage helicopter', () => {
  const plan = makeSupportAirPlan('barrage', 100, 20, 20, 10, 20); // friendly side is -x
  const at = (ms: number) => supportAirPose(plan, 100 * 50 + ms);

  it('is on station, 4 tiles out on the friendly side, through every round', () => {
    for (const ms of [BARRAGE_FIRST_MS, 9600, BARRAGE_LAST_MS]) {
      const p = at(ms);
      expect(p).not.toBeNull();
      if (!p) continue;
      expect(Math.hypot(p.x - 20, p.y - 20)).toBeCloseTo(HELI_STATION_TILES, 6);
    }
    const first = at(BARRAGE_FIRST_MS);
    expect(first && first.x).toBeLessThan(20);
  });

  it('keeps its nose on the target while on station', () => {
    const p = at(9600);
    if (!p) throw new Error('no pose');
    const toTarget = Math.atan2(20 - p.y, 20 - p.x) / (2 * Math.PI);
    expect(p.facingTurns).toBeCloseTo(toTarget, 6);
  });

  it('comes in from far away and leaves after the last round', () => {
    const span = planSpanMs('barrage');
    const enter = at(span.start);
    if (!enter) throw new Error('no pose');
    expect(Math.hypot(enter.x - 20, enter.y - 20)).toBeGreaterThan(15);
    expect(at(span.start - 1)).toBeNull();
    expect(at(span.end + 1)).toBeNull();
    expect(span.end).toBeGreaterThan(BARRAGE_LAST_MS);
  });
});

describe('the strike jet', () => {
  const plan = makeSupportAirPlan('strike', 0, 30, 30, 20, 30); // comes from -x, flies +x
  it('crosses the aim point JET_LEAD_MS before the round lands', () => {
    const p = supportAirPose(plan, STRIKE_IMPACT_MS - JET_LEAD_MS);
    if (!p) throw new Error('no pose');
    expect(p.x).toBeCloseTo(30, 6);
    expect(p.y).toBeCloseTo(30, 6);
    expect(p.facingTurns).toBeCloseTo(0, 6); // heading +x
  });
  it('approaches from the friendly side and climbs out after the pass', () => {
    const before = supportAirPose(plan, 1500);
    const after = supportAirPose(plan, 4000);
    if (!before || !after) throw new Error('no pose');
    expect(before.x).toBeLessThan(30);
    expect(after.x).toBeGreaterThan(30);
    expect(after.liftWu).toBeGreaterThan(before.liftWu);
    expect(after.pitchRad).toBeGreaterThan(0);
    expect(supportAirPose(plan, planSpanMs('strike').end + 1)).toBeNull();
  });
  it('drops the bomb over the last JET_LEAD_MS only', () => {
    expect(bombFallFraction(plan, STRIKE_IMPACT_MS - JET_LEAD_MS - 1)).toBeNull();
    expect(bombFallFraction(plan, STRIKE_IMPACT_MS - JET_LEAD_MS)).toBe(0);
    expect(bombFallFraction(plan, STRIKE_IMPACT_MS - 200)).toBeCloseTo(0.5, 6);
    expect(bombFallFraction(plan, STRIKE_IMPACT_MS)).toBeNull();
  });
  it('defaults its heading when the friendly centroid is missing', () => {
    const p = makeSupportAirPlan('strike', 0, 5, 5, null, null);
    expect(Math.hypot(p.fx, p.fy)).toBeCloseTo(1, 9);
  });
});

describe('reanchor', () => {
  it('moves the plan so its first impact is the strike tick, once', () => {
    const plan = makeSupportAirPlan('barrage', 100, 0, 0, -1, 0);
    reanchor(plan, 100 + 121); // the command applied one tick late
    expect(plan.anchorMs).toBe(101 * 50);
    reanchor(plan, 100 + 157); // round two changes nothing
    expect(plan.anchorMs).toBe(101 * 50);
  });
});

describe('strikeScorchRadius', () => {
  const w = 10;
  const h = 10;
  const flat = new Uint8Array(w * h);
  it('is the full size on flat ground and on a map with no relief', () => {
    expect(strikeScorchRadius(flat, w, h, 5.5, 5.5)).toBe(STRIKE_SCORCH_FLAT_TILES);
    expect(strikeScorchRadius(null, w, h, 5.5, 5.5)).toBe(STRIKE_SCORCH_FLAT_TILES);
  });
  it('is capped where any tile under the disc stands at another level', () => {
    const hill = new Uint8Array(w * h);
    hill[5 * w + 7] = 1; // 1.5 tiles east of the centre: inside a 2.4 disc
    expect(strikeScorchRadius(hill, w, h, 5.5, 5.5)).toBe(STRIKE_SCORCH_RELIEF_TILES);
  });
  it('ignores relief outside the disc', () => {
    const far = new Uint8Array(w * h);
    far[9 * w + 9] = 3; // corner tile, ~4.9 tiles away
    expect(strikeScorchRadius(far, w, h, 5.5, 5.5)).toBe(STRIKE_SCORCH_FLAT_TILES);
  });
});
