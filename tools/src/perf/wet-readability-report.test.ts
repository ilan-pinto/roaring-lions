/**
 * `wet-readability-report.ts` on synthetic captures: PNGs written to a temp dir in the names `ground:capture --read`
 * writes, a figure rectangle on a flat ground, and the numbers read back against `wet-readability.ts`'s literals.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { formatStop, readStop, summarise } from './wet-readability-report';
import { readability, figureMask, type Frame } from './wet-readability';

function write(dir: string, name: string, w: number, h: number, ground: readonly [number, number, number], fig?: readonly [number, number, number]): void {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = fig !== undefined && x >= 90 && x < 104 && y >= 70 && y < 110;
      const c = inside ? (fig as readonly number[]) : ground;
      const i = (y * w + x) * 4;
      png.data[i] = c[0] as number;
      png.data[i + 1] = c[1] as number;
      png.data[i + 2] = c[2] as number;
      png.data[i + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(dir, `${name}.png`), PNG.sync.write(png));
}

describe('readStop', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wet-read-'));
  const ground: [number, number, number] = [41, 37, 29];
  write(dir, 'm-squad-road-read-g', 200, 180, ground);
  // `dark` is the control (a near-black figure); `pale` a cool grey-blue one. Three samples each.
  for (let j = 0; j < 3; j++) {
    write(dir, `m-squad-road-read-m-dark-s${j}`, 200, 180, ground, [15, 10, 5]);
    write(dir, `m-squad-road-read-m-pale-s${j}`, 200, 180, ground, [60, 70, 90]);
  }
  const stop = readStop(dir, 'm', 'road', [97, 90], ['dark', 'pale'], 3);

  it('reads each treatment against the stop\'s ground frame: the dE2000 of its colour, 560 figure pixels, no spread over identical samples', () => {
    const [dark, pale] = stop.rows;
    expect(dark?.treatment).toBe('dark');
    expect(dark?.pixels).toBe(14 * 40);
    expect(dark?.mean).toBeCloseTo(8.035, 2);
    expect(dark?.darkest).toBeCloseTo(8.035, 2);
    expect(dark?.meanSd).toBeCloseTo(0, 9);
    expect(pale?.mean).toBeCloseTo(19.017, 2);
    expect(dark?.samples).toBe(3);
  });

  it('throws on a missing frame and on a frame the figure is absent from', () => {
    expect(() => readStop(dir, 'm', 'road', [97, 90], ['nope'], 3)).toThrow(/missing frame/);
    write(dir, 'm-squad-road-read-m-ghost-s0', 200, 180, ground);
    expect(() => readStop(dir, 'm', 'road', [97, 90], ['ghost'], 1)).toThrow(/mask is empty/);
  });

  it('prints the floor verdict per number', () => {
    const text = formatStop(stop);
    expect(text).toMatch(/dark\s+mean\s+8\.0\+-0\.0 LOW\s+darkest15%\s+8\.0\+-0\.0 LOW/);
    expect(text).toMatch(/pale\s+mean\s+19\.0\+-0\.0 ok\s+darkest15%\s+19\.0\+-0\.0 ok/);
  });

  it('summarise averages samples and reports their spread', () => {
    const frame = (rgb: readonly [number, number, number]): Frame => {
      const data = new Uint8Array(100 * 100 * 4);
      for (let i = 0; i < 100 * 100; i++) data.set([...rgb, 255], i * 4);
      for (let y = 30; y < 60; y++) for (let x = 40; x < 60; x++) data.set([15, 10, 5, 255], (y * 100 + x) * 4);
      return { width: 100, height: 100, data };
    };
    const g: Frame = { width: 100, height: 100, data: frame([41, 37, 29]).data.map((v, i) => (i % 4 === 3 ? v : [41, 37, 29][i % 4] as number)) };
    const m = frame([41, 37, 29]);
    const r = readability(m, g, figureMask(m, g, 50, 45, 40));
    const s = summarise('t', [r, { ...r, mean: r.mean + 2 }]);
    expect(s.mean).toBeCloseTo(r.mean + 1, 9);
    expect(s.meanSd).toBeCloseTo(1, 9);
    expect(s.samples).toBe(2);
  });
});
