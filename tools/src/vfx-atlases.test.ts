/**
 * The flipbook atlases (Defilade T4, D7), checked from the shipped bytes.
 *
 * `tools/vfx/bake_flipbook_atlases.py` bakes `assets/textures/vfx/flipbook_*.png`:
 * 8x8 frames of 128 px, frame k row-major from the top-left at life k/63,
 * R = projected density, G/B = its screen gradient (0.5-centred), A = heat
 * (fire) or a soft interior term (smoke). A shader samples one frame by UV
 * offset, so the three things that silently break it are a wrong size, a
 * frame whose billow reaches its own border (it bleeds into the neighbour
 * under bilinear filtering), and a fire that does not burn down.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const root = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));

const FRAME = 128;
const GRID = 8;
const SIZE = FRAME * GRID;
const BORDER_PX = 2;
const BORDER_MAX_R = 8;

interface Atlas {
  readonly bytes: Buffer;
  readonly png: PNG;
}

function load(name: string): Atlas {
  const bytes = readFileSync(root(`assets/textures/vfx/flipbook_${name}.png`));
  return { bytes, png: PNG.sync.read(bytes) };
}

/** Red channel of frame `k` as a FRAME x FRAME array, row-major. */
function frameR(png: PNG, k: number): Uint8Array {
  const out = new Uint8Array(FRAME * FRAME);
  const ox = (k % GRID) * FRAME;
  const oy = Math.floor(k / GRID) * FRAME;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      out[y * FRAME + x] = png.data[((oy + y) * png.width + ox + x) * 4];
    }
  }
  return out;
}

const mass = (r: Uint8Array): number => r.reduce((s, v) => s + v, 0);

function maxOnBorder(r: Uint8Array): number {
  let m = 0;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const edge = Math.min(x, y, FRAME - 1 - x, FRAME - 1 - y);
      if (edge < BORDER_PX) m = Math.max(m, r[y * FRAME + x]);
    }
  }
  return m;
}

function meanIn(r: Uint8Array, x0: number, x1: number): number {
  let s = 0;
  for (let y = x0; y < x1; y++) for (let x = x0; x < x1; x++) s += r[y * FRAME + x];
  return s / ((x1 - x0) * (x1 - x0));
}

describe.each(['fire', 'smoke'])('flipbook_%s.png', (name) => {
  const atlas = load(name);

  it('is a 1024x1024, 8-bit RGBA PNG', () => {
    expect(atlas.png.width).toBe(SIZE);
    expect(atlas.png.height).toBe(SIZE);
    // IHDR: bit depth at byte 24, colour type at byte 25 (6 = RGBA).
    expect(atlas.bytes[24]).toBe(8);
    expect(atlas.bytes[25]).toBe(6);
  });

  it('frame 0 has its density mass in the centre and none at the frame edge', () => {
    const r = frameR(atlas.png, 0);
    expect(meanIn(r, 56, 72)).toBeGreaterThan(64);
    expect(meanIn(r, 56, 72)).toBeGreaterThan(20 * (maxOnBorder(r) + 1));
  });

  it(`no frame reaches its outermost ${BORDER_PX} px (R < ${BORDER_MAX_R}/255)`, () => {
    const offenders: string[] = [];
    for (let k = 0; k < GRID * GRID; k++) {
      const m = maxOnBorder(frameR(atlas.png, k));
      if (m >= BORDER_MAX_R) offenders.push(`frame ${k}: R ${m}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('flipbook_fire.png', () => {
  it('burns down: the last frame carries less density than frame 8', () => {
    const { png } = load('fire');
    const last = mass(frameR(png, GRID * GRID - 1));
    const early = mass(frameR(png, 8));
    expect(last).toBeLessThan(early);
  });
});
