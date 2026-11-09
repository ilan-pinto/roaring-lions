import { describe, expect, it } from 'vitest';
import { amplifiedDiff, gateRows, legacyFalls, stretchedTile, stretchRange } from './webgpu-banding-sheet-lib';
import type { Frame } from './webgpu-banding-probe-lib';

const frame = (w: number, h: number, v: (x: number, y: number) => number): Frame => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([v(x, y), v(x, y), v(x, y), 255], (y * w + x) * 4);
  return { w, h, data };
};

describe('gateRows', () => {
  it('passes at or under L-matched, fails above it, refuses a missing reading', () => {
    expect(gateRows({ penumbra: 0.05, lit: 0.04 }, { penumbra: 0.05, lit: 0.06 }).map((r) => r.verdict)).toEqual(['PASS', 'PASS']);
    expect(gateRows({ penumbra: 0.07, lit: 0.04 }, { penumbra: 0.05, lit: 0.06 }).map((r) => r.verdict)).toEqual(['FAIL', 'PASS']);
    expect(gateRows({ penumbra: null, lit: 0.04 }, { penumbra: 0.05, lit: 0.06 })[0]?.verdict).toBe('REFUSED');
  });
});

describe('legacyFalls', () => {
  it('needs the after index strictly under the before: an unchanged legacy half reads FAIL', () => {
    expect(legacyFalls({ penumbra: 0.56, lit: 0.63 }, { penumbra: 0.02, lit: 0.01 }).map((r) => r.verdict)).toEqual(['PASS', 'PASS']);
    expect(legacyFalls({ penumbra: 0.56, lit: 0.63 }, { penumbra: 0.56, lit: 0.63 }).map((r) => r.verdict)).toEqual(['FAIL', 'FAIL']);
  });
});

describe('the stretch and the difference', () => {
  it('maps the pair-shared range to 0..255 and reads a one-level step as a wide one', () => {
    const f = frame(40, 4, (x) => 100 + Math.floor(x / 10));
    const r = stretchRange(f, { x: 0, y: 0, w: 40, h: 4 });
    expect(r.hi - r.lo).toBeLessThan(10);
    const t = stretchedTile(f, { x: 0, y: 0, w: 40, h: 4 }, r);
    expect((t[(0 * 40 + 39) * 4] as number) - (t[0] as number)).toBeGreaterThan(90);
  });
  it('amplifies a one-level difference by the gain and counts it', () => {
    const a = frame(4, 1, () => 10);
    const b = frame(4, 1, (x) => (x === 2 ? 11 : 10));
    const d = amplifiedDiff(a, b, 8);
    expect(d.changed).toBe(1);
    expect(d.data[2 * 4]).toBe(8);
    expect(d.data[0]).toBe(0);
  });
});
