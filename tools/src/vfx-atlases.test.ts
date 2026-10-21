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
// 8 px at mip level 0 is 1 px at level 3: levels 0-3 never mix two frames.
const BORDER_PX = 8;
const BORDER_MAX_R = 2;
const NEUTRAL = 128; // 0.5 in the G/B gradient encoding

interface Atlas {
  readonly bytes: Buffer;
  readonly png: PNG;
}

function load(name: string): Atlas {
  const bytes = readFileSync(root(`assets/textures/vfx/flipbook_${name}.png`));
  return { bytes, png: PNG.sync.read(bytes) };
}

/** One channel of frame `k` as a FRAME x FRAME array, row-major. */
function frameChannel(png: PNG, k: number, ch: number): Uint8Array {
  const out = new Uint8Array(FRAME * FRAME);
  const ox = (k % GRID) * FRAME;
  const oy = Math.floor(k / GRID) * FRAME;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      out[y * FRAME + x] = png.data[((oy + y) * png.width + ox + x) * 4 + ch];
    }
  }
  return out;
}

const frameR = (png: PNG, k: number): Uint8Array => frameChannel(png, k, 0);

const mass = (r: Uint8Array): number => r.reduce((s, v) => s + v, 0);

/** Largest |value - centre| inside the BORDER_PX band of a frame. */
function maxOnBorder(r: Uint8Array, centre = 0): number {
  let m = 0;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const edge = Math.min(x, y, FRAME - 1 - x, FRAME - 1 - y);
      if (edge < BORDER_PX) m = Math.max(m, Math.abs(r[y * FRAME + x] - centre));
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

  it(`every frame's outermost ${BORDER_PX} px are empty (R, A < ${BORDER_MAX_R}/255; G/B neutral)`, () => {
    const offenders: string[] = [];
    for (let k = 0; k < GRID * GRID; k++) {
      const r = maxOnBorder(frameChannel(atlas.png, k, 0));
      const a = maxOnBorder(frameChannel(atlas.png, k, 3));
      const g = maxOnBorder(frameChannel(atlas.png, k, 1), NEUTRAL);
      const b = maxOnBorder(frameChannel(atlas.png, k, 2), NEUTRAL);
      if (r >= BORDER_MAX_R) offenders.push(`frame ${k}: R ${r}`);
      if (a >= BORDER_MAX_R) offenders.push(`frame ${k}: A ${a}`);
      if (g >= BORDER_MAX_R) offenders.push(`frame ${k}: G off-neutral by ${g}`);
      if (b >= BORDER_MAX_R) offenders.push(`frame ${k}: B off-neutral by ${b}`);
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
