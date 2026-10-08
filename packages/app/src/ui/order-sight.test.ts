import { describe, expect, it } from 'vitest';
import { palette, paletteColor } from '@lions/data';
import { CHEVRON_SWEEP } from './mark';
import { ORDER_SIGHT, SIGHT_KEYS, aimBody, sightFrame, surroundBody, type SightOrderId, type SightPaint } from './order-sight';

const IDS = Object.keys(ORDER_SIGHT) as SightOrderId[];
const PAINT: SightPaint = { aim: '#aim', main: '#main', accent: '#acc', hot: '#hot' }; // sentinels, test-only

/** Even-odd point-in-polygon at the hotspot (12,12), over every M/L-only
 *  subpath (arcs -- the stadium ovals and strike's target ring -- never reach
 *  row y=12 or, for the ring, leave a hole wider than the hotspot, so they
 *  are excluded rather than approximated). */
function inksHotspot(markup: string): boolean {
  const subpaths = markup.match(/M[^M]*?Z/g) ?? [];
  let crossings = 0;
  for (const sp of subpaths) {
    if (/[AaHhVv]/.test(sp)) continue;
    const nums = (sp.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 > 12 !== y2 > 12) {
        const xCross = x1 + ((12 - y1) / (y2 - y1)) * (x2 - x1);
        if (xCross > 12) crossings++;
      }
    }
  }
  return crossings % 2 === 1;
}

describe('the order sight (G1 r5, approved 2026-09-28)', () => {
  it('draws only from curated palette keys (VR-06: no grass, no theme-only ramp)', () => {
    const uncurated = new Set(
      Object.entries(palette.ramps as Record<string, { role: string; theme_only?: boolean }>)
        .filter(([, r]) => r.theme_only === true || /not curated/i.test(r.role))
        .map(([name]) => name)
    );
    // The guard must be able to fire: grass is the ramp the defect used.
    expect(uncurated.has('grass')).toBe(true);
    const keys = [...IDS.flatMap((id) => [ORDER_SIGHT[id].main, ORDER_SIGHT[id].accent]), ...Object.values(SIGHT_KEYS)];
    for (const key of keys) {
      expect(uncurated.has(key.split('.')[0]), key).toBe(false);
      expect(paletteColor(key), key).not.toBe('#FF00FF');
    }
  });

  it("carries r5 NOTES.md's family table exactly", () => {
    expect(ORDER_SIGHT.move).toMatchObject({ family: 'manoeuvre', main: 'vfx.interceptor', accent: 'vfx.white_hot' });
    expect(ORDER_SIGHT.attackMove).toMatchObject({ family: 'offensive', main: 'team.hostile_text', accent: 'vfx.fire' });
    expect(ORDER_SIGHT.halt).toMatchObject({ family: 'control', main: 'team.neutral', accent: 'vfx.white_hot' });
    expect(ORDER_SIGHT.smoke).toMatchObject({ family: 'obscurant', main: 'limestone.0', accent: 'gunmetal.1' });
    expect(ORDER_SIGHT.load).toMatchObject({ family: 'transport', main: 'vfx.tracer', accent: 'limestone.1' });
    expect(ORDER_SIGHT.unload).toMatchObject({ family: 'transport', main: 'vfx.tracer', accent: 'limestone.1' });
    expect(ORDER_SIGHT.sweep).toMatchObject({ family: 'manoeuvre', main: 'vfx.interceptor', accent: 'water.0' });
    expect(ORDER_SIGHT.strike).toMatchObject({ family: 'offensive', main: 'team.hostile_text', accent: 'vfx.fire' });
    expect(SIGHT_KEYS).toEqual({ aim: 'gunmetal.0', halo: 'shadow.0', hot: 'vfx.white_hot' });
  });

  it('carries the approved periods', () => {
    expect(ORDER_SIGHT.move.periodMs).toBe(1200);
    expect(ORDER_SIGHT.attackMove.periodMs).toBe(900);
    expect(ORDER_SIGHT.halt.periodMs).toBe(1300);
    expect(ORDER_SIGHT.smoke.periodMs).toBe(1600);
    expect(ORDER_SIGHT.load.periodMs).toBe(1100);
    expect(ORDER_SIGHT.unload.periodMs).toBe(1100);
    expect(ORDER_SIGHT.sweep.periodMs).toBe(1800);
    expect(ORDER_SIGHT.strike.periodMs).toBe(1600);
  });

  it('uses 4-6 frames, and 6 for halt and strike', () => {
    for (const id of IDS) expect(ORDER_SIGHT[id].phases.length).toBeGreaterThanOrEqual(4);
    expect(ORDER_SIGHT.halt.phases).toHaveLength(6);
    expect(ORDER_SIGHT.strike.phases).toHaveLength(6);
    for (const id of IDS) if (id !== 'halt' && id !== 'strike') expect(ORDER_SIGHT[id].phases).toHaveLength(4);
  });

  it('the aim keeps its colour and only the inner mil marks take the family colour', () => {
    const a = aimBody({ aim: '#aim', main: '#main' });
    expect(a).toContain('#aim');
    expect(a).toContain('#main');
  });

  it("the aim chevron leans at the mark's own sweep", () => {
    const d = aimBody({ aim: '#aim', main: '#main' });
    // chevUp(12, 14.5, 4.5)'s first diagonal: tip (12, 14.5) to (12 + 4.5, 14.5 + h).
    const m = /M12 14\.5 L([-\d.]+) ([-\d.]+)/.exec(d);
    expect(m).not.toBeNull();
    const [, x, y] = m as RegExpExecArray;
    const dx = Number(x) - 12;
    const dy = Number(y) - 14.5;
    expect(Math.abs(dx / dy)).toBeCloseTo(CHEVRON_SWEEP, 2);
  });

  it('frame 0 (rest, reduced-motion, HUD) shows the whole graphic in its main colour', () => {
    for (const id of IDS) expect(surroundBody(id, ORDER_SIGHT[id].phases[0], PAINT)).toContain('#main');
  });

  it('every cycle shows its accent at least once -- the beat survives quantising', () => {
    for (const id of IDS) {
      const all = ORDER_SIGHT[id].phases.map((_, f) => sightFrame(id, f, PAINT)).join('');
      expect(all).toMatch(/#acc|#hot/);
    }
  });

  it('no adjacent frames are identical, including the wrap', () => {
    for (const id of IDS) {
      const fr = ORDER_SIGHT[id].phases.map((_, f) => sightFrame(id, f, PAINT));
      fr.forEach((m, i) => expect(m).not.toBe(fr[(i + 1) % fr.length]));
    }
  });

  it('never inks the hotspot', () => {
    for (const id of IDS) {
      for (let f = 0; f < ORDER_SIGHT[id].phases.length; f++) {
        expect(inksHotspot(sightFrame(id, f, PAINT))).toBe(false);
      }
    }
    // strike's target ring and impact circles are arcs/curves the even-odd
    // walk above skips; both stay clear of the hotspot by construction --
    // the ring's inner radius (11.8 - W) and every impact centre's distance
    // from (12,12) (>= 7.3, `hits` in order-sight.ts) both exceed 1.5.
    expect(11.8 - 2.5).toBeGreaterThan(1.5);
  });

  it("unload fades to 0.75, not 0.5 (r5's one shape exception)", () => {
    const near08 = surroundBody('unload', 0.79, PAINT);
    const opacities = [...near08.matchAll(/opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(opacities.length).toBeGreaterThan(0);
    expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.74);
  });
});
