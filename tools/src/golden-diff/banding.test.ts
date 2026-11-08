// GH-943 WebGPU P2 T2: the banding index, two-sided on synthetic ramps, and SEEING the defect the lead reported on the P1 v2 sheet.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { bandingIndex, ign, type BandingResult, type Crop } from './banding';

/** A grey frame `w` x `h` whose level at (x, y) is `round(f(x, y))`: the 8-bit write of a float colour. */
function frame(w: number, h: number, f: (x: number, y: number) => number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = Math.max(0, Math.min(255, Math.round(f(x, y))));
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = q;
      px[i + 3] = 255;
    }
  }
  return px;
}

function index(r: BandingResult): number {
  if (r.kind !== 'index') throw new Error(`expected an index, got a refusal: ${r.reason}`);
  return r.index;
}

const W = 512;
const H = 128;
const ALL: Crop = { x: 0, y: 0, w: W, h: H };
/** 16 levels over 512 px: one level every 32 px, the shallow gradient the mask exists for. */
const ramp = (x: number): number => 100 + (16 * x) / W;
/** The output grade's dither as the shader draws it: one IGN sample on gl_FragCoord (bottom-left origin), +-0.5 LSB. */
const rpdf = (x: number, y: number): number => ign(x + 0.5, H - y - 0.5) - 0.5;

describe('bandingIndex on synthetic ramps', () => {
  it('reads a 16-level ramp over 512 px, quantised to bytes, as banded (>= 0.8)', () => {
    expect(index(bandingIndex(frame(W, H, (x) => ramp(x)), W, H, ALL))).toBeGreaterThanOrEqual(0.8);
  });

  it('reads the same ramp vertically as banded too (the run is read along the gradient, whichever axis that is)', () => {
    expect(index(bandingIndex(frame(H, W, (_x, y) => ramp(y)), H, W, { x: 0, y: 0, w: H, h: W }))).toBeGreaterThanOrEqual(0.8);
  });

  // MEASURED, and a disclosed deviation from the brief's "<= 0.1" for this arm: a +-0.5 LSB (rectangular, one IGN sample) dither
  // cannot move a pixel whose true value is an exact level, so every level crossing keeps an 11-13 px plateau whatever the noise
  // (0.177 on this ramp; 0.28 with uniform random noise of the same width). That is the dither the output grade ships, so the number
  // is a finding for T8, not a reason to tune the metric. The two-sided claim is held as quantised >= 5x dithered, and the brief's
  // <= 0.1 is held on a dither that removes the plateaus (the triangular arm below).
  it('reads the ramp with the shipped +-0.5 LSB IGN dither far below the quantised one (<= 0.2, and 5x under it)', () => {
    const d = index(bandingIndex(frame(W, H, (x, y) => ramp(x) + rpdf(x, y)), W, H, ALL));
    const q = index(bandingIndex(frame(W, H, (x) => ramp(x)), W, H, ALL));
    expect(d).toBeLessThanOrEqual(0.2);
    expect(q / d).toBeGreaterThanOrEqual(5);
  });

  it('reads the ramp with a triangular +-1 LSB dither (two IGN samples) as unbanded (<= 0.1)', () => {
    const tpdf = (x: number, y: number): number => ign(x + 0.5, y + 0.5) + ign(x + 47.5, y + 113.5) - 1;
    expect(index(bandingIndex(frame(W, H, (x, y) => ramp(x) + tpdf(x, y)), W, H, ALL))).toBeLessThanOrEqual(0.1);
  });

  // The 1-level step test. A staircase of 3-level terraces is on a shallow gradient (3 levels per 32 px) and its runs are long, but
  // its steps are authored edges, not the canvas's least significant bit. Falsified by dropping the `=== 1` test (reads 1.0, red).
  it('does not read a staircase of 3-level terraces as 8-bit banding (its runs end in steps of 3)', () => {
    expect(index(bandingIndex(frame(W, H, (x) => 100 + 3 * Math.floor(x / 32)), W, H, ALL))).toBeLessThanOrEqual(0.1);
  });

  // The empty mask. Falsified by dropping the refusal (a flat frame then reads index 0/0 = NaN as a result, not a refusal: red).
  it('REFUSES a flat frame: an empty mask measures nothing', () => {
    const r = bandingIndex(frame(256, 256, () => 120), 256, 256, { x: 0, y: 0, w: 256, h: 256 });
    expect(r.kind).toBe('refused');
  });

  it('REFUSES a hard edge with nothing shallow in it', () => {
    const r = bandingIndex(frame(256, 256, (x) => (x < 128 ? 40 : 200)), 256, 256, { x: 0, y: 0, w: 256, h: 256 });
    expect(r.kind).toBe('refused');
  });

  it('reads a crop of a frame exactly as the same rectangle cut out (masks never look outside the crop)', () => {
    const big = frame(800, 400, (x, y) => ramp(x) + (y > 200 ? 30 : 0) + (x > 700 ? 50 : 0));
    const crop: Crop = { x: 100, y: 220, w: W, h: H };
    const cut = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) cut.set(big.subarray(((crop.y + y) * 800 + crop.x) * 4, ((crop.y + y) * 800 + crop.x + W) * 4), y * W * 4);
    expect(bandingIndex(big, 800, 400, crop)).toEqual(bandingIndex(cut, W, H, ALL));
  });

  it('throws on a crop outside the frame', () => {
    expect(() => bandingIndex(new Uint8Array(64 * 64 * 4), 64, 64, { x: 10, y: 10, w: 60, h: 10 })).toThrow(/not inside/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The metric SEES the reported defect: the P1 v2 sheet's G crops read above L-shipped's. The crops are committed fixtures (the sheet's
// directory is untracked and gets cleaned), and the test REFUSES, never skips, on a missing or hash-mismatched one.
// ---------------------------------------------------------------------------------------------------------------------------------

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'banding');

interface ManifestFile {
  readonly file: string;
  readonly arm: 'G' | 'LS';
  readonly crop: 'penumbra' | 'lit';
  readonly sha256: string;
}
interface Manifest {
  readonly crops: Record<'penumbra' | 'lit', Crop>;
  readonly files: readonly ManifestFile[];
}

/** Reads one manifest entry's crop, or throws a REFUSAL naming the file. */
function readFixture(dir: string, entry: ManifestFile, crop: Crop): PNG {
  const f = path.join(dir, entry.file);
  if (!existsSync(f)) throw new Error(`banding fixture REFUSED: ${entry.file} (${entry.arm} ${entry.crop}) is missing from ${dir}`);
  const bytes = readFileSync(f);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== entry.sha256) throw new Error(`banding fixture REFUSED: ${entry.file} hashes ${sha}, the manifest says ${entry.sha256}`);
  const png = PNG.sync.read(bytes);
  if (png.width !== crop.w || png.height !== crop.h) throw new Error(`banding fixture REFUSED: ${entry.file} is ${png.width}x${png.height}, its crop is ${crop.w}x${crop.h}`);
  return png;
}

describe('bandingIndex SEES the P1 v2 defect (committed crops)', () => {
  const manifest = JSON.parse(readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8')) as Manifest;

  it('names exactly the four crops: G and L-shipped, penumbra and lit ground', () => {
    expect(manifest.files.map((f) => `${f.arm}-${f.crop}`).sort()).toEqual(['G-lit', 'G-penumbra', 'LS-lit', 'LS-penumbra']);
  });

  for (const crop of ['penumbra', 'lit'] as const) {
    it(`reads G's ${crop} crop above L-shipped's`, () => {
      const read = (arm: 'G' | 'LS'): number => {
        const entry = manifest.files.find((f) => f.arm === arm && f.crop === crop);
        if (entry === undefined) throw new Error(`banding fixture REFUSED: the manifest has no ${arm} ${crop} entry`);
        const rect = manifest.crops[crop];
        const png = readFixture(FIXTURES, entry, rect);
        return index(bandingIndex(png.data, png.width, png.height, { x: 0, y: 0, w: png.width, h: png.height }));
      };
      const g = read('G');
      const l = read('LS');
      expect(g).toBeGreaterThan(l);
    });
  }

  it('every fixture is small (cropped to its rectangle, under 100 KB)', () => {
    expect(manifest.files.length, 'there are fixtures to measure').toBe(4);
    for (const f of manifest.files) expect(readFileSync(path.join(FIXTURES, f.file)).length).toBeLessThan(100 * 1024);
  });
});
