import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W } from '@lions/render';
import {
  EDGE_MARGIN_PX,
  ZOOM_MAX,
  ZOOM_MIN,
  clampCamera,
  clampZoom,
  edgeVector,
  panDelta,
  panning,
  stepPan,
  wheelZoomFactor,
  zoomAnchor,
} from './camera-input';

describe('edgeVector', () => {
  const v = (x: number, y: number) => edgeVector(x, y, 1000, 800, EDGE_MARGIN_PX);
  it('is zero in the middle', () => expect(v(500, 400)).toEqual({ right: 0, down: 0 }));
  it('is full strength at an edge and ramps across the margin', () => {
    expect(v(0, 400)).toEqual({ right: -1, down: 0 });
    expect(v(1000, 400)).toEqual({ right: 1, down: 0 });
    expect(v(500, 0)).toEqual({ right: 0, down: -1 });
    expect(v(992, 400).right).toBeCloseTo(0.5);
  });
  it('a corner pushes both ways', () => expect(v(0, 0)).toEqual({ right: -1, down: -1 }));
  // A pointer that has left the window must not pan forever.
  it('is zero outside the surface entirely', () => {
    expect(v(-40, 400)).toEqual({ right: 0, down: 0 });
    expect(v(500, 900)).toEqual({ right: 0, down: 0 });
  });
});

describe('panDelta', () => {
  // The WASD pan (main.ts:3679-3694) IS the reference. Screen-up is (-s,-s),
  // screen-right is (+s,-s) -- if this function disagrees, edge pan and the
  // keys move the camera differently and the player feels it immediately.
  it('reproduces each WASD direction exactly', () => {
    expect(panDelta(0, -1, 2)).toEqual({ dx: -2, dy: -2 });  // up
    expect(panDelta(0, 1, 2)).toEqual({ dx: 2, dy: 2 });     // down
    expect(panDelta(-1, 0, 2)).toEqual({ dx: -2, dy: 2 });   // left
    expect(panDelta(1, 0, 2)).toEqual({ dx: 2, dy: -2 });    // right
  });
  it('a corner is the sum of its two edges', () => {
    expect(panDelta(1, 1, 2)).toEqual({ dx: 4, dy: 0 });
  });
});

describe('zoomAnchor', () => {
  it('shifts the camera so the world point under the cursor does not move', () => {
    expect(zoomAnchor({ x: 10, y: 10 }, { x: 14, y: 6 }, { x: 12, y: 8 })).toEqual({ x: 12, y: 8 });
  });
  it('is a no-op when the point did not move', () => {
    expect(zoomAnchor({ x: 10, y: 10 }, { x: 14, y: 6 }, { x: 14, y: 6 })).toEqual({ x: 10, y: 10 });
  });
});

describe('clampZoom', () => {
  it('holds the range main.ts has always clamped to', () => {
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(1)).toBe(1);
  });
});

// --- WP-P1: time-based, eased pan ------------------------------------------

/** Hold `intent` for `holdMs` at a fixed frame time, then release for
 *  `releaseMs`; return the summed camera delta and the velocity trace. */
function hold(
  frameMs: number,
  holdMs: number,
  intent: { right: number; down: number },
  opts: { releaseMs?: number; zoom?: number; speed?: number } = {}
): { dx: number; dy: number; trace: { t: number; right: number; down: number }[] } {
  const vel = { right: 0, down: 0 };
  let dx = 0;
  let dy = 0;
  let t = 0;
  const trace: { t: number; right: number; down: number }[] = [];
  const total = holdMs + (opts.releaseMs ?? 0);
  // Count frames rather than accumulate time, so 1000 ms at 144 Hz is
  // exactly 144 frames and not 143 or 145 from float drift.
  const frames = Math.round(total / frameMs);
  const holdFrames = Math.round(holdMs / frameMs);
  for (let f = 0; f < frames; f++) {
    const d = stepPan(vel, f < holdFrames ? intent : { right: 0, down: 0 }, frameMs, opts.speed ?? 1, opts.zoom ?? 1);
    dx += d.dx;
    dy += d.dy;
    t += frameMs;
    trace.push({ t, right: vel.right, down: vel.down });
  }
  return { dx, dy, trace };
}

describe('stepPan: the same distance a second at every refresh rate', () => {
  // PA-03. The old loop moved 0.5 tiles a FRAME, so this ratio was 144/60 =
  // 2.4 -- the falsification: restoring that formula inside stepPan reads
  // 60 Hz 30.0 vs 144 Hz 72.0 tiles and fails both assertions below.
  it('a 1 s hold of D covers the same ground at 60 Hz and 144 Hz, within 2%', () => {
    const a = hold(1000 / 60, 1000, { right: 1, down: 0 });
    const b = hold(1000 / 144, 1000, { right: 1, down: 0 });
    expect(Math.abs(b.dx / a.dx - 1)).toBeLessThan(0.02);
    expect(Math.abs(b.dy / a.dy - 1)).toBeLessThan(0.02);
  });
  it('and covers 18 tiles a second on each world axis once at speed, less the 120 ms ramp', () => {
    // Literal: 18 tiles/s for 1 s, minus the ramp's lost half (0.12 s * 18 / 2
    // = 1.08 tiles) -> 16.92. Screen-right is +x, -y.
    const a = hold(1000 / 60, 1000, { right: 1, down: 0 });
    expect(a.dx).toBeCloseTo(16.92, 2);
    expect(a.dy).toBeCloseTo(-16.92, 2);
  });
  it('the same holds at 30 Hz and 240 Hz, and over a hold and release', () => {
    const ref = hold(1000 / 60, 1000, { right: 0, down: -1 }, { releaseMs: 400 });
    for (const hz of [30, 120, 144, 240]) {
      const r = hold(1000 / hz, 1000, { right: 0, down: -1 }, { releaseMs: 400 });
      expect(Math.abs(r.dy / ref.dy - 1)).toBeLessThan(0.02);
    }
  });
  it('screen speed does not change with zoom: tiles scale by 1/zoom', () => {
    const z1 = hold(1000 / 60, 1000, { right: 1, down: 0 });
    const z2 = hold(1000 / 60, 1000, { right: 1, down: 0 }, { zoom: 2 });
    expect(z2.dx).toBeCloseTo(z1.dx / 2, 6);
  });
  it('a long frame (a tab back from the background) pans at most 100 ms of it', () => {
    const vel = { right: 1, down: 0 };
    const d = stepPan(vel, { right: 1, down: 0 }, 5000, 1, 1);
    expect(d.dx).toBeCloseTo(1.8, 6); // 18 tiles/s * 0.1 s
  });
  it('a diagonal is no faster than a straight pan once at speed', () => {
    // The second half-second of a 1 s hold, past both ramps: each diagonal
    // axis ramps to 0.707 in 85 ms rather than to 1 in 120, so whole-hold
    // distances differ by the ramp alone (1.9%). Unnormalised, this read 1.41.
    const span = (intent: { right: number; down: number }): number => {
      const a = hold(1000 / 60, 500, intent);
      const b = hold(1000 / 60, 1000, intent);
      return Math.hypot(b.dx - a.dx, b.dy - a.dy);
    };
    expect(span({ right: 1, down: -1 }) / span({ right: 1, down: 0 })).toBeCloseTo(1, 6);
  });
});

describe('stepPan: easing', () => {
  // Falsified by making the ramp instant (PAN_ACCEL_MS/PAN_DECEL_MS -> ~0,
  // today's on/off behaviour): the first-frame and release assertions fail.
  for (const hz of [60, 144]) {
    const frame = 1000 / hz;
    // Velocity is sampled at frame ends, so "within" is the first frame
    // ending at or after the ramp: 133.3 ms at 60 Hz, 125.0 at 144.
    it(`at ${hz} Hz it reaches full speed within 137 ms, and not in the first frame`, () => {
      const { trace } = hold(frame, 500, { right: 1, down: 0 });
      expect(trace[0].right).toBeLessThan(0.2);
      const full = trace.find((s) => s.right === 1);
      expect(full).toBeDefined();
      expect(full!.t).toBeLessThanOrEqual(137);
      expect(full!.t).toBeGreaterThanOrEqual(115);
    });
    it(`at ${hz} Hz it stops within 107 ms of release, and not in the first frame`, () => {
      const { trace } = hold(frame, 500, { right: 1, down: 0 }, { releaseMs: 300 });
      const released = trace.filter((s) => s.t > 500 + 1e-6);
      expect(released[0].right).toBeGreaterThan(0.5);
      const stop = released.find((s) => s.right === 0);
      expect(stop).toBeDefined();
      expect(stop!.t - 500).toBeLessThanOrEqual(107);
    });
  }
  it('a release coasts under a tile (not floaty)', () => {
    const held = hold(1000 / 60, 500, { right: 1, down: 0 });
    const coasted = hold(1000 / 60, 500, { right: 1, down: 0 }, { releaseMs: 500 });
    expect(coasted.dx - held.dx).toBeCloseTo(0.81, 2); // 18 * 0.09 / 2
  });
  it('a reversal brakes through zero and then accelerates the other way', () => {
    const vel = { right: 1, down: 0 };
    stepPan(vel, { right: -1, down: 0 }, 45, 1, 1);
    expect(vel.right).toBeCloseTo(0.5, 6);
    // 45 ms to brake from 0.5 to rest, then 45 of the 120 ms ramp the other way.
    stepPan(vel, { right: -1, down: 0 }, 90, 1, 1);
    expect(vel.right).toBeCloseTo(-0.375, 6);
  });
  it('panning() is false only once the camera has come to rest', () => {
    const vel = { right: 0, down: 0 };
    expect(panning(vel)).toBe(false);
    stepPan(vel, { right: 0, down: 1 }, 16, 1, 1);
    expect(panning(vel)).toBe(true);
    stepPan(vel, { right: 0, down: 0 }, 100, 1, 1);
    expect(panning(vel)).toBe(false);
  });
});

// --- WP-P1: bounds -----------------------------------------------------------

describe('clampCamera', () => {
  const MAP = { width: 48, height: 48 };
  const VP = { width: 1400, height: 900 };

  it('restates project.ts tile size', () => {
    expect([TILE_W, TILE_H]).toEqual([64, 32]);
  });

  // An oracle with literals, worked by hand from the dimetric projection
  // (u = (x - y) * 32, v = (x + y) * 16, unzoomed px) and NOT from the code:
  // at zoom 2.5 the view is 560 x 360 unzoomed px, the void margin 96/2.5 =
  // 38.4. Panning right from the centre at v = 768 stops where the view's
  // right edge meets the map's right corner plus the margin:
  // u = 1536 + 38.4 - 280 = 1294.4 -> x - y = 40.45, x + y = 48.
  it('stops a zoom-2.5 pan to the right where the view meets the map corner', () => {
    expect(clampCamera({ x: 80, y: -32, zoom: 2.5 }, MAP, VP).x).toBeCloseTo(44.225, 6);
    expect(clampCamera({ x: 80, y: -32, zoom: 2.5 }, MAP, VP).y).toBeCloseTo(3.775, 6);
  });
  // Fully zoomed out the 48-tile map's box (3072 x 1536 + 2 * 274 margin) is
  // smaller than the 4000 x 2571 px view on both axes, so it is centred:
  // the focus is the map's own centre, (24, 24), wherever it was asked to be.
  it('centres a map smaller than the view at the 0.35 floor', () => {
    for (const at of [{ x: -50, y: 10 }, { x: 24, y: 24 }, { x: 200, y: -157 }]) {
      const c = clampCamera({ ...at, zoom: 0.35 }, MAP, VP);
      expect(c.x).toBeCloseTo(24, 6);
      expect(c.y).toBeCloseTo(24, 6);
    }
  });
  it('leaves a camera well inside the map alone', () => {
    expect(clampCamera({ x: 20, y: 26, zoom: 1 }, MAP, VP)).toEqual({ x: 20, y: 26 });
  });

  // PA-04. 10 s of panning into each of the eight screen directions, at the
  // zoom floor and ceiling, through the same stepPan + clamp main.ts runs. The
  // falsification: clampCamera returning its input unchanged (today's "no
  // clamp anywhere") ends 180 tiles off the map and fails every case.
  const DIRS = [
    { right: 1, down: 0 },
    { right: -1, down: 0 },
    { right: 0, down: 1 },
    { right: 0, down: -1 },
    { right: 1, down: 1 },
    { right: 1, down: -1 },
    { right: -1, down: 1 },
    { right: -1, down: -1 },
  ];
  for (const zoom of [ZOOM_MIN, 1, ZOOM_MAX]) {
    for (const dir of DIRS) {
      it(`zoom ${zoom}: 10 s panning (${dir.right}, ${dir.down}) stays on the map`, () => {
        const cam = { x: 24, y: 24, zoom };
        const vel = { right: 0, down: 0 };
        for (let f = 0; f < 600; f++) {
          const d = stepPan(vel, dir, 1000 / 60, 2, zoom);
          cam.x += d.dx;
          cam.y += d.dy;
          Object.assign(cam, clampCamera(cam, MAP, VP));
        }
        // The look-at point is on the map...
        expect(cam.x).toBeGreaterThanOrEqual(0);
        expect(cam.x).toBeLessThanOrEqual(48);
        expect(cam.y).toBeGreaterThanOrEqual(0);
        expect(cam.y).toBeLessThanOrEqual(48);
        // ...and the view shows at most 96 screen px of ground past the
        // map's box on any side (literal box: u -1536..1536, v 0..1536).
        const u = (cam.x - cam.y) * 32;
        const v = (cam.x + cam.y) * 16;
        const hw = VP.width / (2 * zoom);
        const hh = VP.height / (2 * zoom);
        if (2 * hw <= 3072 + 192 / zoom) {
          expect(u - hw).toBeGreaterThanOrEqual(-1536 - 96 / zoom - 1e-6);
          expect(u + hw).toBeLessThanOrEqual(1536 + 96 / zoom + 1e-6);
        }
        if (2 * hh <= 1536 + 192 / zoom) {
          expect(v - hh).toBeGreaterThanOrEqual(-96 / zoom - 1e-6);
          expect(v + hh).toBeLessThanOrEqual(1536 + 96 / zoom + 1e-6);
        }
      });
    }
  }
});

describe('wheelZoomFactor', () => {
  it('one mouse notch is the 1.1x it has always been', () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.1, 9);
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / 1.1, 9);
  });
  it('a trackpad delta zooms by its share of a notch, not a whole step', () => {
    expect(wheelZoomFactor(-4)).toBeCloseTo(Math.pow(1.1, 0.04), 9);
    // Twenty-five 4 px events are one notch, not twenty-five.
    expect(Math.pow(wheelZoomFactor(-4), 25)).toBeCloseTo(1.1, 9);
  });
  it('reads line and page deltas, and caps one event at two notches', () => {
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(1.1, 9);
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(1.21, 9);
    expect(wheelZoomFactor(-5000)).toBeCloseTo(1.21, 9);
  });
});
