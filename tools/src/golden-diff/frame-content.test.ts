// GH-943 P1: the node capture's content floor and validation refusal. Each verdict is driven red by a constructed frame.
import { describe, expect, it } from 'vitest';
import { CONTENT_REGION, MIN_MEAN_LUMA, MIN_STD_LUMA, frameContentRefusal, frameContentStats, validationErrorRefusal } from './frame-content';

const W = 100;
const H = 60;

function frame(px: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = px(x, y);
      const i = (y * W + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** In the content region? (the HUD lives outside it) */
const inside = (x: number, y: number): boolean => x >= W * CONTENT_REGION.x0 && x < W * CONTENT_REGION.x1 && y >= H * CONTENT_REGION.y0 && y < H * CONTENT_REGION.y1;

/** A stand-in scene: a ramp with some texture, about what a real frame reads (mean ~ 100, std ~ 40). */
const scene = (x: number, y: number): [number, number, number] => {
  const v = 40 + ((x * 7 + y * 13) % 120);
  return [v, v, v];
};

describe('frameContentRefusal', () => {
  it('a real-looking frame passes', () => {
    const s = frameContentStats(frame(scene), W, H);
    expect(s.meanLuma).toBeGreaterThan(MIN_MEAN_LUMA);
    expect(s.stdLuma).toBeGreaterThan(MIN_STD_LUMA);
    expect(frameContentRefusal(s)).toBeNull();
  });
  it('a pure black frame is refused (what G drew on 2026-11-06)', () => {
    const s = frameContentStats(frame(() => [0, 0, 0]), W, H);
    expect(s.meanLuma).toBe(0);
    expect(s.stdLuma).toBe(0);
    expect(frameContentRefusal(s)).toMatch(/black/);
  });
  it('a black world under a bright HUD is refused: the HUD and minimap lie outside the content region', () => {
    // The CI SwiftShader capture: whole-clip mean 7.3, std 31.9 from the top bar and the minimap, the world itself black.
    const s = frameContentStats(frame((x, y) => (inside(x, y) ? [0, 0, 0] : [230, 220, 200])), W, H);
    expect(frameContentRefusal(s)).toMatch(/black/);
    // ...and the same HUD over the whole clip would have passed: the region is what makes this check able to fail.
    const whole = frameContentStats(frame((x, y) => (inside(x, y) ? [0, 0, 0] : [230, 220, 200])), W, H, { x0: 0, x1: 1, y0: 0, y1: 1 });
    expect(frameContentRefusal(whole)).toBeNull();
  });
  it('a flat, non-black frame is refused as near-constant', () => {
    const s = frameContentStats(frame(() => [120, 110, 90]), W, H);
    expect(s.stdLuma).toBe(0);
    expect(frameContentRefusal(s)).toMatch(/near-constant/);
  });
  it('a near-black frame with a little noise is still refused', () => {
    const s = frameContentStats(frame((x, y) => ((x + y) % 2 === 0 ? [0, 0, 0] : [3, 3, 3])), W, H);
    expect(frameContentRefusal(s)).toMatch(/black/);
  });
  it('an empty or short buffer is refused, never read as a pass', () => {
    expect(frameContentRefusal(frameContentStats(new Uint8Array(0), W, H))).toMatch(/no pixels/);
    expect(frameContentRefusal(frameContentStats(new Uint8Array(4), W, H))).toMatch(/no pixels/);
  });
});

describe('validationErrorRefusal', () => {
  it('clean console lines pass, an unrelated error passes', () => {
    expect(validationErrorRefusal([])).toBeNull();
    expect(validationErrorRefusal(['console.error: [lions] something else'])).toBeNull();
  });
  it('the T9 lines are refused', () => {
    const lines = [
      'console.error: THREE.WebGPURenderer: Uncaptured WebGPU GPUValidationError: Multiple aspects (Depth|Stencil) selected in [TextureView of Texture "depth"].',
      'console.error: THREE.WebGPURenderer: Uncaptured WebGPU GPUValidationError: [Invalid BindGroup "bindGroup_object"] is invalid due to a previous error.',
    ];
    expect(validationErrorRefusal(lines)).toMatch(/2 GPU validation error\(s\).*Multiple aspects/);
  });
});
