/**
 * E6 (GH-274) chunk C: the beam's heat shimmer, as numbers (spec 6.3). `fog-pass.test.ts` pins
 * that the shader carries the same constants; this pins the maths and the spec's literals
 * (radius 10 px at zoom 1, at most 1.5 px of offset, at most 8 sites). The oracle is literals,
 * not imports, so a constant that drifts in `shimmer.ts` cannot drag its own check along.
 */
import { describe, expect, it } from 'vitest';
import {
  SHIMMER_MAX_OFFSET_PX,
  SHIMMER_MAX_SITES,
  SHIMMER_RADIUS_PX,
  shimmerOffsetPx,
  shimmerSite,
  shimmerSiteInto,
  shimmerSiteOnScreen,
  shimmerWeight,
} from './shimmer';

describe('the spec literals', () => {
  it('is 10 px at zoom 1, 1.5 px at most, 8 sites at most', () => {
    expect(SHIMMER_RADIUS_PX).toBe(10);
    expect(SHIMMER_MAX_OFFSET_PX).toBe(1.5);
    expect(SHIMMER_MAX_SITES).toBe(8);
  });
});

describe('shimmerWeight: the disc', () => {
  it('is 1 at the centre, 0 at and past the rim, and falls monotonically between', () => {
    expect(shimmerWeight(0)).toBe(1);
    expect(shimmerWeight(1)).toBe(0);
    expect(shimmerWeight(3)).toBe(0);
    let last = 1;
    for (let d = 0.05; d <= 1; d += 0.05) {
      const w = shimmerWeight(d);
      expect(w).toBeLessThanOrEqual(last);
      last = w;
    }
  });
});

describe('shimmerOffsetPx: the two-octave field', () => {
  it('never exceeds 1.5 px at full amplitude anywhere, at any time', () => {
    let worst = 0;
    for (let t = 0; t < 12; t += 0.37) {
      for (let dx = -1; dx <= 1; dx += 0.05) {
        for (let dy = -1; dy <= 1; dy += 0.05) {
          const [ox, oy] = shimmerOffsetPx(dx, dy, 1, t);
          worst = Math.max(worst, Math.hypot(ox, oy));
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1.5);
    // ...and it is a real distortion, not a dead field: it gets within a fifth of the cap.
    expect(worst).toBeGreaterThan(1.2);
  });

  it('is exactly nothing outside the disc and at zero amplitude', () => {
    for (const o of [shimmerOffsetPx(1.2, 0, 1, 3), shimmerOffsetPx(0.8, 0.8, 1, 3), shimmerOffsetPx(0.1, 0.2, 0, 3)]) {
      expect(Math.abs(o[0])).toBe(0);
      expect(Math.abs(o[1])).toBe(0);
    }
  });

  it('scales linearly with the site amplitude', () => {
    const full = shimmerOffsetPx(0.2, -0.3, 1, 1.5);
    const half = shimmerOffsetPx(0.2, -0.3, 0.5, 1.5);
    expect(half[0]).toBeCloseTo(full[0] / 2, 12);
    expect(half[1]).toBeCloseTo(full[1] / 2, 12);
  });

  it('is a function of the SIM clock: the same time gives the same distortion, another time another', () => {
    expect(shimmerOffsetPx(0.2, 0.1, 1, 2.5)).toEqual(shimmerOffsetPx(0.2, 0.1, 1, 2.5));
    expect(shimmerOffsetPx(0.2, 0.1, 1, 2.5)).not.toEqual(shimmerOffsetPx(0.2, 0.1, 1, 2.6));
  });

  it('is mostly sideways: the vertical component is the smaller', () => {
    let sx = 0;
    let sy = 0;
    for (let t = 0; t < 6; t += 0.11) {
      const [ox, oy] = shimmerOffsetPx(0.1, 0.1, 1, t);
      sx += Math.abs(ox);
      sy += Math.abs(oy);
    }
    expect(sy).toBeLessThan(sx);
  });
});

describe('shimmerSite: a projected point', () => {
  it('maps NDC to UV and carries the radius in UV-y units, scaled with zoom', () => {
    const [u, v, r, a] = shimmerSite(0, 0, 0.7, 1, 900);
    expect([u, v, a]).toEqual([0.5, 0.5, 0.7]);
    expect(r).toBeCloseTo(10 / 900, 12);
    expect(shimmerSite(1, -1, 1, 2, 900).slice(0, 2)).toEqual([1, 0]);
    expect(shimmerSite(0, 0, 1, 2, 900)[2]).toBeCloseTo(20 / 900, 12);
    expect(shimmerSite(0, 0, 1, 0.35, 900)[2]).toBeCloseTo(3.5 / 900, 12);
  });
});

describe('shimmerSiteInto: the allocation-free twin of shimmerSite', () => {
  it('writes the same four numbers into the slot it is given, and returns it', () => {
    const slot: [number, number, number, number] = [9, 9, 9, 9];
    expect(shimmerSiteInto(slot, -0.4, 0.7, 0.55, 1.8, 900)).toBe(slot);
    expect(slot).toEqual(shimmerSite(-0.4, 0.7, 0.55, 1.8, 900));
  });
});

describe('shimmerSiteOnScreen: a disc that cannot be seen takes no slot', () => {
  // 900 px high at zoom 1: radius 10/900 UV-y is 0.0222 NDC-y; on a 1400 px wide frame 0.0143 NDC-x.
  const r = 10 / 900;
  const aspect = 1400 / 900;
  it('keeps a centre inside the frame and one whose disc just overlaps the edge', () => {
    expect(shimmerSiteOnScreen(0, 0, r, aspect)).toBe(true);
    expect(shimmerSiteOnScreen(1, 1, r, aspect)).toBe(true);
    expect(shimmerSiteOnScreen(1.014, 0, r, aspect)).toBe(true);
    expect(shimmerSiteOnScreen(0, 1.02, r, aspect)).toBe(true);
  });
  it('drops a centre further out than its disc reaches, on either axis and either side', () => {
    expect(shimmerSiteOnScreen(1.02, 0, r, aspect)).toBe(false);
    expect(shimmerSiteOnScreen(-1.02, 0, r, aspect)).toBe(false);
    expect(shimmerSiteOnScreen(0, 1.025, r, aspect)).toBe(false);
    expect(shimmerSiteOnScreen(0, -1.025, r, aspect)).toBe(false);
    expect(shimmerSiteOnScreen(5, 5, r, aspect)).toBe(false);
  });
  it('a bigger disc (a zoomed-in frame) reaches further out', () => {
    expect(shimmerSiteOnScreen(0, 1.1, r, aspect)).toBe(false);
    expect(shimmerSiteOnScreen(0, 1.1, r * 5, aspect)).toBe(true); // 2 * 5r = 0.111
  });
});
