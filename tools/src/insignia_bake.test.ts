/**
 * GH-1096 S0: the Roaring Lion insignia's distance field (spec section 9, gate 6).
 *
 * `tools/insignia/bake_sdf.py` bakes the hand-authored `art/src/insignia/roaring_lion.svg` into
 * `assets/textures/insignia/roaring_lion_sdf.png`:
 *   - 256 x 256 RGBA. R is the silhouette's signed distance, G the cut-outs', B = 0, A = 255.
 *   - Each distance is stored as `128 + 16 * texels`, so 128 is the edge, inside is above it and the spread is +/-8.
 *   - The 200-unit viewBox spans texels 8..248.
 *
 * What these tests hold:
 *   - The bake is reproducible. Two fresh bakes are byte-identical.
 *   - The committed PNG is the bake of the committed SVG. This compares DECODED PIXELS, because the compressed
 *     bytes depend on the zlib build (CI's Python and a Mac's differ).
 *   - The texture has the layout the shader will read, and it is not empty. Each layer has inside and outside
 *     texels, the disc spans the 240 texels it should, and every cut-out lies inside the silhouette.
 *   - The emblem is symmetric. Mirrored left to right, R and G are equal texel for texel. The bake mirrors the
 *     right half, so this is exact.
 *   - The SVG is authored as right halves. Every vertex in the two layers has x >= 100, and the bake refuses one
 *     that does not.
 *
 * The SVG is read here with its own small parser, never the bake's, so a bug in the bake's reader cannot also
 * pass this check. The bake runs in a child `python3` (numpy and the standard library, as the backdrop gate and
 * the hand generator do).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const BAKE = path.join(REPO, 'tools', 'insignia', 'bake_sdf.py');
const SVG = path.join(REPO, 'art', 'src', 'insignia', 'roaring_lion.svg');
const PNG_PATH = path.join(REPO, 'assets', 'textures', 'insignia', 'roaring_lion_sdf.png');

const SIZE = 256;
const EDGE = 128;
// The viewBox spans texels 8..248, and the roundel is r = 98 of 100 units, so its inside texels run from about
// 10 to 245. These literals are the spec's numbers, not the bake's constants.
const DISC_FIRST_MIN = 8;
const DISC_FIRST_MAX = 12;
const DISC_LAST_MIN = 243;
const DISC_LAST_MAX = 247;

const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-insignia-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function bake(out: string, svg = SVG): { status: number | null; output: string } {
  const r = spawnSync('python3', [BAKE, '--svg', svg, '--out', out], { cwd: REPO, encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

const lowest = (c: Uint8Array): number => c.reduce((m, v) => Math.min(m, v), 255);
const highest = (c: Uint8Array): number => c.reduce((m, v) => Math.max(m, v), 0);

function channel(png: PNG, ch: number): Uint8Array {
  const out = new Uint8Array(png.width * png.height);
  for (let i = 0; i < out.length; i++) out[i] = png.data[i * 4 + ch];
  return out;
}

/** Every `d` in `<g id="<layer>">`, as vertex lists. Only absolute M, L and Z are expected. */
function layerPolygons(svg: string, layer: string): Array<Array<[number, number]>> {
  const open = svg.indexOf(`<g id="${layer}">`);
  if (open < 0) throw new Error(`no <g id="${layer}">`);
  const body = svg.slice(open, svg.indexOf('</g>', open));
  return [...body.matchAll(/\sd="([^"]*)"/g)].map(([, d]) => {
    if (/[^MLZ0-9.,\s-]/.test(d)) throw new Error(`${layer}: unexpected path data in ${d.slice(0, 40)}`);
    return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(([, x, y]) => [Number(x), Number(y)] as [number, number]);
  });
}

describe('the Roaring Lion insignia bake (GH-1096 S0)', () => {
  const committed = readFileSync(PNG_PATH);
  const png = PNG.sync.read(committed);

  it('is reproducible to the byte, and matches the committed texture pixel for pixel', () => {
    const a = path.join(scratch, 'a.png');
    const b = path.join(scratch, 'b.png');
    const ra = bake(a);
    const rb = bake(b);
    expect(ra.status, ra.output).toBe(0);
    expect(rb.status, rb.output).toBe(0);
    const bytesA = readFileSync(a);
    expect(bytesA.length).toBeGreaterThan(1000);
    expect(bytesA.equals(readFileSync(b)), 'two bakes of one SVG wrote different bytes').toBe(true);
    const fresh = PNG.sync.read(bytesA);
    expect([fresh.width, fresh.height]).toEqual([png.width, png.height]);
    expect(
      Buffer.from(fresh.data).equals(Buffer.from(png.data)),
      'assets/textures/insignia/roaring_lion_sdf.png is stale: run python3 tools/insignia/bake_sdf.py',
    ).toBe(true);
  }, 60_000);

  it('has the layout the shader reads, and is not empty', () => {
    expect([png.width, png.height]).toEqual([SIZE, SIZE]);
    const r = channel(png, 0);
    const g = channel(png, 1);
    const b = channel(png, 2);
    const a = channel(png, 3);
    expect(highest(b), 'B must be 0').toBe(0);
    expect(lowest(a), 'A must be 255').toBe(255);
    const inside = (c: Uint8Array): number => c.reduce((n, v) => n + (v >= EDGE ? 1 : 0), 0) / c.length;
    // the roundel: pi * (98 * 1.2)^2 / 256^2 = 0.663 of the texture
    expect(inside(r)).toBeGreaterThan(0.6);
    expect(inside(r)).toBeLessThan(0.72);
    // the cut-outs: a real share of the disc, never none and never all of it
    expect(inside(g)).toBeGreaterThan(0.1);
    expect(inside(g)).toBeLessThan(0.45);
    // both channels reach both ends of the spread: real distances, not a flat image
    for (const c of [r, g]) {
      expect(lowest(c)).toBe(0);
      expect(highest(c)).toBe(255);
    }
    // the disc spans texels 8..248, on both axes
    let first = SIZE;
    let last = -1;
    let top = SIZE;
    let bottom = -1;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (r[y * SIZE + x] < EDGE) continue;
        first = Math.min(first, x);
        last = Math.max(last, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    for (const [lo, hi] of [
      [first, last],
      [top, bottom],
    ]) {
      expect(lo).toBeGreaterThanOrEqual(DISC_FIRST_MIN);
      expect(lo).toBeLessThanOrEqual(DISC_FIRST_MAX);
      expect(hi).toBeGreaterThanOrEqual(DISC_LAST_MIN);
      expect(hi).toBeLessThanOrEqual(DISC_LAST_MAX);
    }
    // every cut-out lies inside the roundel: paint = R minus G needs nothing of G outside R
    let strays = 0;
    for (let i = 0; i < r.length; i++) if (g[i] >= EDGE && r[i] < EDGE) strays++;
    expect(strays).toBe(0);
  });

  it('is symmetric: mirrored left to right, R and G are equal texel for texel', () => {
    let compared = 0;
    for (const ch of [0, 1]) {
      const c = channel(png, ch);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE / 2; x++) {
          const left = c[y * SIZE + x];
          const right = c[y * SIZE + (SIZE - 1 - x)];
          if (left !== right) {
            expect.fail(`channel ${'RG'[ch]} differs at row ${y}: x ${x} = ${left}, x ${SIZE - 1 - x} = ${right}`);
          }
          compared++;
        }
      }
    }
    expect(compared).toBe(SIZE * SIZE);
  });

  it('is authored as right halves, and the bake refuses a vertex left of the centreline', () => {
    const svg = readFileSync(SVG, 'utf8');
    for (const layer of ['silhouette', 'cutouts']) {
      const polys = layerPolygons(svg, layer);
      expect(polys.length, `${layer}: polygons`).toBeGreaterThan(0);
      const xs = polys.flat().map(([x]) => x);
      expect(xs.length).toBeGreaterThan(polys.length * 3 - 1);
      expect(Math.min(...xs), `${layer}: a vertex left of x = 100`).toBeGreaterThanOrEqual(100);
      // a layer whose shapes cross the axis closes them along it
      expect(xs.filter((x) => x === 100).length, `${layer}: nothing closes along the centreline`).toBeGreaterThan(0);
    }
    expect(layerPolygons(svg, 'cutouts').length).toBeGreaterThanOrEqual(10);

    // the bake's own guard: one vertex moved left of the axis is refused, not mirrored into a seam
    const eye = svg.match(/<path id="cut-eye" d="M (\d+\.\d+),/);
    const eyeX = eye?.[1] ?? '';
    expect(eyeX, 'the cut-eye path').not.toBe('');
    const broken = svg.replace(`<path id="cut-eye" d="M ${eyeX},`, '<path id="cut-eye" d="M 99.00,');
    expect(broken).not.toBe(svg);
    const file = path.join(scratch, 'left.svg');
    writeFileSync(file, broken);
    const r = bake(path.join(scratch, 'left.png'), file);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/left of the centreline/);
  }, 60_000);
});
