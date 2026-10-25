/**
 * E6 (GH-274) chunk C: the beam's state-to-look table (spec 6.2), pinned as numbers. The oracle is
 * LITERALS from the spec and the lead's sentence, never constants imported from `beam-look.ts`
 * (an "independent" oracle that imports its arguments from the code under test shifts with it).
 *
 * Every assertion here was verified by mutating the line it pins and watching it go red; the list
 * is in the commit message.
 */
import { describe, expect, it } from 'vitest';
import { TILE_W } from '../../project';
import { SILHOUETTE_PX_PER_WORLD_UNIT } from './silhouette';
import {
  BEAM_PX_PER_WORLD_UNIT,
  beamFocus,
  beamPxToWorld,
  newBeamLook,
  newBeamLookState,
  stepBeamLook,
  type BeamLookInput,
  type BeamLookState,
} from './beam-look';

const DWELL_TICKS = 30;

function input(over: Partial<BeamLookInput> = {}): BeamLookInput {
  return {
    target: 7, dwell: 1, locked: false, dwellTicks: DWELL_TICKS, alpha: 0, nowMs: 1000,
    struckAtMs: null, lockout: false, ...over,
  };
}

/** A beam that has been lasing for a while at full envelope, last stepped at `nowMs`. */
function lit(nowMs = 1000, dwell = 15): BeamLookState {
  const s = newBeamLookState();
  stepBeamLook(s, input({ nowMs, dwell: 10 }), newBeamLook());
  stepBeamLook(s, input({ nowMs: nowMs + 200, dwell }), newBeamLook());
  return s;
}

describe('the pure maths', () => {
  it('a screen-pixel width is a fixed number of pixels at any zoom (0.35 to 2.5)', () => {
    for (const zoom of [0.35, 0.5, 1, 1.7, 2.5]) {
      const world = beamPxToWorld(6, zoom);
      // Back to pixels through the dimetric camera's own scale: TILE_W * zoom * sqrt 2 / 2 px per tile.
      expect(world * ((TILE_W * zoom * Math.SQRT2) / 2)).toBeCloseTo(6, 9);
    }
  });

  it('shares the silhouette outline\'s px-per-world-unit derivation', () => {
    expect(BEAM_PX_PER_WORLD_UNIT).toBe(SILHOUETTE_PX_PER_WORLD_UNIT);
  });

  it('the dwell is read one tick behind what the sim reports, and a zero dwell is zero focus', () => {
    // beamState reads "as the next tick will see it": a frame at alpha 0 presents dwell - 1.
    expect(beamFocus(1, 0, 30)).toBe(0);
    expect(beamFocus(16, 0, 30)).toBeCloseTo(0.5, 12);
    expect(beamFocus(16, 1, 30)).toBeCloseTo(16 / 30, 12);
    expect(beamFocus(31, 1, 30)).toBe(1);
    expect(beamFocus(0, 0.9, 30)).toBe(0);
    expect(beamFocus(-3, 0.9, 30)).toBe(0);
    expect(beamFocus(10, 0, 0)).toBe(0);
  });
});

describe('lasing: the dwell focuses the beam', () => {
  it('narrows the sheath 6 -> 3 px and raises its alpha 0.35 -> 0.85 as the dwell builds', () => {
    const at = (dwell: number) => {
      const s = lit(1000, dwell);
      return stepBeamLook(s, input({ nowMs: 1300, dwell }), newBeamLook());
    };
    const none = at(1); // focus 0
    const half = at(16); // focus 0.5
    const full = at(31); // focus 1
    expect([none.sheathPx, half.sheathPx, full.sheathPx]).toEqual([6, 4.5, 3]);
    expect(none.sheathAlpha).toBeCloseTo(0.35, 12);
    expect(half.sheathAlpha).toBeCloseTo(0.6, 12);
    expect(full.sheathAlpha).toBeCloseTo(0.85, 12);
    expect(none.targetGlowTiles).toBeCloseTo(0.06, 12);
    expect(half.targetGlowTiles).toBeCloseTo(0.09, 12);
    expect(full.targetGlowTiles).toBeCloseTo(0.12, 12);
  });

  it('keeps the core at 1.2 px and the lens glow at 0.18 tile whatever the dwell', () => {
    const a = stepBeamLook(lit(1000, 3), input({ nowMs: 1300, dwell: 3 }), newBeamLook());
    const b = stepBeamLook(lit(1000, 29), input({ nowMs: 1300, dwell: 29 }), newBeamLook());
    expect(a.corePx).toBe(1.2);
    expect(b.corePx).toBe(1.2);
    expect(a.lensGlowTiles).toBe(0.18);
    expect(b.lensGlowTiles).toBe(0.18);
  });

  it('drives the shimmer amplitude 0.4 + 0.6 d at the target', () => {
    const lo = stepBeamLook(lit(1000, 1), input({ nowMs: 1300, dwell: 1 }), newBeamLook());
    const hi = stepBeamLook(lit(1000, 31), input({ nowMs: 1300, dwell: 31 }), newBeamLook());
    expect(lo.shimmerAmp).toBeCloseTo(0.4, 12);
    expect(hi.shimmerAmp).toBeCloseTo(1.0, 12);
  });

  it('interpolates the dwell with the frame\'s alpha, never past the next tick', () => {
    const s = lit(1000, 16);
    const a0 = stepBeamLook(s, input({ nowMs: 1300, dwell: 16, alpha: 0 }), newBeamLook()).focus;
    const a1 = stepBeamLook(s, input({ nowMs: 1300, dwell: 16, alpha: 1 }), newBeamLook()).focus;
    expect(a1 - a0).toBeCloseTo(1 / 30, 12);
  });

  it('fades in over 80 ms from the first frame the sim says the dwell began', () => {
    const s = newBeamLookState();
    // The very first tick of a dwell, at the start of the frame: nothing yet.
    expect(stepBeamLook(s, input({ nowMs: 0, dwell: 1, alpha: 0 }), newBeamLook()).ribbon).toBe(false);
    const half = stepBeamLook(s, input({ nowMs: 40, dwell: 1, alpha: 0 }), newBeamLook());
    expect(half.coreAlpha).toBeCloseTo(0.5, 12);
    const full = stepBeamLook(s, input({ nowMs: 80, dwell: 2, alpha: 0 }), newBeamLook());
    expect(full.coreAlpha).toBe(1);
  });

  it('a capture some ticks into a lock sees a beam that has already faded in', () => {
    const look = stepBeamLook(newBeamLookState(), input({ nowMs: 5000, dwell: 12, alpha: 0 }), newBeamLook());
    expect(look.coreAlpha).toBe(1);
    expect(look.ribbon).toBe(true);
  });

  it('a zero-time repaint changes nothing', () => {
    const s = lit(1000, 20);
    const a = { ...stepBeamLook(s, input({ nowMs: 1500, dwell: 20 }), newBeamLook()) };
    const b = { ...stepBeamLook(s, input({ nowMs: 1500, dwell: 20 }), newBeamLook()) };
    expect(b).toEqual(a);
  });
});

describe('a strike: a 120 ms pulse', () => {
  it('doubles the core, scales the sheath 1.6x and the target glow 1.8x, and spikes the shimmer to 1', () => {
    const s = lit(1000, 4);
    const calm = stepBeamLook(s, input({ nowMs: 1100, dwell: 4 }), newBeamLook());
    const hit = stepBeamLook(s, input({ nowMs: 1100, dwell: 0, struckAtMs: 1100 }), newBeamLook());
    expect(hit.pulse).toBe(1);
    expect(hit.corePx).toBeCloseTo(2.4, 12);
    // After the strike the dwell reset to 0, so the unpulsed sheath is the unfocused 6 px.
    expect(hit.sheathPx).toBeCloseTo(6 * 1.6, 12);
    expect(hit.targetGlowTiles).toBeCloseTo(0.06 * 1.8, 12);
    expect(hit.shimmerAmp).toBeCloseTo(1, 12);
    expect(calm.corePx).toBe(1.2);
    expect(calm.pulse).toBe(0);
  });

  it('decays to nothing after 120 ms, and is stamped by the event\'s own time', () => {
    const s = lit(1000, 4);
    stepBeamLook(s, input({ nowMs: 1100, dwell: 0, struckAtMs: 1100 }), newBeamLook());
    const mid = stepBeamLook(s, input({ nowMs: 1160, dwell: 3 }), newBeamLook());
    expect(mid.pulse).toBeCloseTo(0.5, 12);
    expect(mid.corePx).toBeCloseTo(1.2 * 1.5, 12);
    const over = stepBeamLook(s, input({ nowMs: 1220, dwell: 4 }), newBeamLook());
    expect(over.pulse).toBe(0);
    expect(over.corePx).toBe(1.2);
  });

  it('a strike on the very last tick before a paint is still a full pulse (a harness steps then paints once)', () => {
    const s = lit(1000, 4);
    // 100 ticks pass between paints; the strike was on the last of them.
    const look = stepBeamLook(s, input({ nowMs: 6000, dwell: 0, struckAtMs: 6000 }), newBeamLook());
    expect(look.pulse).toBe(1);
  });
});

describe('locked: nothing in the world', () => {
  it('a locked carrier draws no beam and no lens glow, at once', () => {
    const s = lit(1000, 20);
    const look = stepBeamLook(s, input({ nowMs: 1010, target: -1, dwell: 0, locked: true }), newBeamLook());
    expect(look.ribbon).toBe(false);
    expect(look.lens).toBe(false);
    expect(look.lensGlowAlpha).toBe(0);
    expect(look.coreAlpha).toBe(0);
    expect(look.shimmerAmp).toBe(0);
  });

  it('a locked carrier draws nothing even if a stale target is still reported', () => {
    // The sim reports target -1 inside a lockout, so this cannot happen; the look does not depend on it.
    const s = lit(1000, 20);
    const look = stepBeamLook(s, input({ nowMs: 1010, target: 7, dwell: 20, locked: true }), newBeamLook());
    expect(look.ribbon || look.lens).toBe(false);
  });

  it('stays dark for the whole lockout, however long the frames are', () => {
    const s = lit(1000, 20);
    for (let t = 1010; t < 8000; t += 700) {
      const look = stepBeamLook(s, input({ nowMs: t, target: -1, dwell: 0, locked: true }), newBeamLook());
      expect(look.ribbon || look.lens).toBe(false);
    }
  });

  it('heat drives nothing: the look has no heat input at all', () => {
    // The input type carries no heat; an extra field the caller smuggled in changes nothing.
    const base = stepBeamLook(lit(1000, 20), input({ nowMs: 1300, dwell: 20 }), newBeamLook());
    const smuggled = stepBeamLook(lit(1000, 20), { ...input({ nowMs: 1300, dwell: 20 }), heat: 239 } as BeamLookInput, newBeamLook());
    expect(smuggled).toEqual(base);
  });
});

describe('a break fades, a lockout snaps - they are different roads', () => {
  it('a break (target lost, not locked) fades the beam over 80 ms and holds its last focus', () => {
    const s = lit(1000, 25);
    const before = stepBeamLook(s, input({ nowMs: 1300, dwell: 25 }), newBeamLook());
    const t40 = stepBeamLook(s, input({ nowMs: 1340, target: -1, dwell: 0 }), newBeamLook());
    expect(t40.ribbon).toBe(true);
    expect(t40.coreAlpha).toBeCloseTo(0.5, 12);
    expect(t40.focus).toBeCloseTo(before.focus, 12);
    expect(t40.sheathPx).toBeCloseTo(before.sheathPx, 12);
    const t80 = stepBeamLook(s, input({ nowMs: 1380, target: -1, dwell: 0 }), newBeamLook());
    expect(t80.ribbon).toBe(false);
    expect(t80.coreAlpha).toBe(0);
  });

  it('a break leaves the lens glow for 150 ms', () => {
    const s = lit(1000, 25); // last frame at 1200
    const a = stepBeamLook(s, input({ nowMs: 1240, target: -1, dwell: 0 }), newBeamLook());
    const b = stepBeamLook(s, input({ nowMs: 1320, target: -1, dwell: 0 }), newBeamLook());
    expect(a.lens).toBe(true);
    expect(b.ribbon).toBe(false); // 120 ms: the ribbons were gone at 80
    expect(b.lens).toBe(true);
    expect(b.lensGlowAlpha).toBeCloseTo(1 - 120 / 150, 12);
    const c = stepBeamLook(s, input({ nowMs: 1380, target: -1, dwell: 0 }), newBeamLook());
    expect(c.lens).toBe(false);
  });

  it('a lockout snaps the same beam to nothing in ONE frame, where the break had 80 ms', () => {
    const fade = lit(1000, 25);
    const snap = lit(1000, 25);
    const faded = stepBeamLook(fade, input({ nowMs: 1240, target: -1, dwell: 0 }), newBeamLook());
    const snapped = stepBeamLook(snap, input({ nowMs: 1240, target: -1, dwell: 0, lockout: true }), newBeamLook());
    expect(faded.ribbon).toBe(true);
    expect(faded.lens).toBe(true);
    expect(snapped.ribbon).toBe(false);
    expect(snapped.lens).toBe(false);
  });

  it('a lockout event wins over a strike that arrived with it, pulse and all', () => {
    const s = lit(1000, 29);
    const look = stepBeamLook(s, input({ nowMs: 1300, target: -1, dwell: 0, struckAtMs: 1300, lockout: true }), newBeamLook());
    expect(look.ribbon).toBe(false);
    expect(look.pulse).toBe(0);
    // ...and it does not leak into the next lasing: the pulse is gone.
    const later = stepBeamLook(s, input({ nowMs: 1310, dwell: 1 }), newBeamLook());
    expect(later.pulse).toBe(0);
  });

  it('a beam that comes back after a lockout fades in again from nothing', () => {
    const s = lit(1000, 29);
    stepBeamLook(s, input({ nowMs: 1300, target: -1, dwell: 0, lockout: true }), newBeamLook());
    for (let t = 1350; t <= 7300; t += 50) stepBeamLook(s, input({ nowMs: t, target: -1, dwell: 0, locked: true }), newBeamLook());
    const back = stepBeamLook(s, input({ nowMs: 7350, dwell: 1 }), newBeamLook());
    expect(back.coreAlpha).toBeCloseTo(50 / 80, 12);
    const next = stepBeamLook(s, input({ nowMs: 7430, dwell: 3 }), newBeamLook());
    expect(next.coreAlpha).toBe(1);
  });
});
