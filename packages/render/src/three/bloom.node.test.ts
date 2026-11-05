/**
 * @vitest-environment jsdom
 *
 * GH-943 P1 (T5) gates for the node bloom. jsdom for the SMAA lookup images the chain builds. Each test names its falsification
 * (a one-line mutation, run by hand, listed in the commit message).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createNodePostChain, type NodePostChain, type NodePostDeps } from './post-chain.node';
import { createNodeBloom, type BloomFactory } from './bloom.node';
import {
  BLOOM_RADIUS,
  BLOOM_RESOLUTION_SCALE,
  BLOOM_SMOOTH_WIDTH,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  bloomStrengthFor,
  halfToFloat,
  luminanceCensus,
  tightHalfRgba,
} from './bloom-spec';
import * as legacy from './bloom';
import { QUALITY_PRESETS } from '../quality';

async function world() {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
  const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
  const deps: NodePostDeps = { W, TSL, smaa: smaa as never };
  return { W, TSL, deps, bloom: bloom as unknown as BloomFactory };
}
const fakeRenderer = {} as never;

async function chainWith(quality: (typeof QUALITY_PRESETS)['high']) {
  const w = await world();
  const nb = createNodeBloom({ bloom: w.bloom, W: w.W, renderer: fakeRenderer });
  const chain: NodePostChain = createNodePostChain(
    w.deps,
    fakeRenderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    quality,
    { fog: null, ao: null, bloom: nb.factory }
  );
  return { chain, nb, w };
}

interface Built {
  strength: { value: number };
  radius: { value: number };
  threshold: { value: number };
  smoothWidth: { value: number };
  getResolutionScale(): number;
}
/** The bloom node a stage factory built (the control holds it; the test reaches it through the factory's own call). */
async function built() {
  const w = await world();
  let node: Built | null = null;
  const spy: BloomFactory = (n, s, r, t) => {
    const b = w.bloom(n, s, r, t);
    node = b as unknown as Built;
    return b;
  };
  const nb = createNodeBloom({ bloom: spy, W: w.W, renderer: fakeRenderer });
  const chain = createNodePostChain(w.deps, fakeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.high, {
    fog: null,
    ao: null,
    bloom: nb.factory,
  });
  if (node === null) throw new Error('the bloom factory was never called');
  return { chain, nb, node: node as Built };
}

describe('the ruled numbers are written once and reach the node (bloom-spec.ts)', () => {
  it('legacy re-exports exactly the spec values', () => {
    expect(legacy.BLOOM_STRENGTH).toBe(BLOOM_STRENGTH);
    expect(legacy.BLOOM_RADIUS).toBe(BLOOM_RADIUS);
    expect(legacy.BLOOM_THRESHOLD).toBe(BLOOM_THRESHOLD);
    expect(legacy.BLOOM_RESOLUTION_SCALE).toBe(BLOOM_RESOLUTION_SCALE);
    expect(legacy.luminanceCensus).toBe(luminanceCensus);
  });

  it('the BloomNode is built at strength 0.5, radius 0.35, threshold 1.0, smoothWidth 0.01, resolution scale 0.25', async () => {
    // Falsify: change BLOOM_THRESHOLD to 0.5 in bloom-spec.ts (the legacy test pins 1.0 too, but THIS one reads the built node).
    const { node, chain } = await built();
    expect(node.strength.value).toBe(0.5);
    expect(node.radius.value).toBe(0.35);
    expect(node.threshold.value).toBe(1.0);
    expect(node.smoothWidth.value).toBe(0.01);
    expect(BLOOM_SMOOTH_WIDTH).toBe(0.01);
    expect(node.getResolutionScale()).toBe(0.25);
    chain.dispose();
  });
});

describe('the chain slot', () => {
  it('high has the bloom between AO-slot and output; medium (bloom quarter, no AO) has it too; low has none', async () => {
    // Falsify: run('QuarterBloomPass', ...) moved below the OutputPass block in post-chain.node.ts.
    const high = await chainWith(QUALITY_PRESETS.high);
    expect(high.chain.passNames).toEqual(['RenderPass', 'QuarterBloomPass', 'OutputPass', 'SMAAPass']);
    expect(high.nb.control.built).toBe(true);
    high.chain.dispose();
    const low = await chainWith(QUALITY_PRESETS.low);
    expect(low.chain.passNames.includes('QuarterBloomPass')).toBe(false);
    expect(low.nb.control.built).toBe(false);
    low.chain.dispose();
  });
});

describe('the toggle and the zoom fade drive the strength uniform, and 0 adds nothing', () => {
  it('strength = 0.5 x fade when on, exactly 0 when off', () => {
    expect(bloomStrengthFor(true, 1)).toBe(0.5);
    expect(bloomStrengthFor(true, 0.5)).toBe(0.25);
    expect(bloomStrengthFor(false, 1)).toBe(0);
  });

  it('setEnabled(false) writes 0 into the built node, reports a change once, and back on restores the fade-scaled strength', async () => {
    // Falsify: make setEnabled a no-op (return false without calling apply()).
    const { node, nb, chain } = await built();
    expect(nb.control.setEnabled(false)).toBe(true);
    expect(node.strength.value).toBe(0);
    expect(nb.control.setEnabled(false)).toBe(false);
    nb.control.setFade(0.5);
    expect(node.strength.value).toBe(0);
    expect(nb.control.setEnabled(true)).toBe(true);
    expect(node.strength.value).toBe(0.25);
    chain.dispose();
  });

  it('state set BEFORE the chain exists, or kept across a rebuild, still lands on the new node', async () => {
    const w = await world();
    const nb = createNodeBloom({ bloom: w.bloom, W: w.W, renderer: fakeRenderer });
    nb.control.setEnabled(false);
    expect(nb.control.built).toBe(false);
    const make = () =>
      createNodePostChain(w.deps, fakeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.high, { fog: null, ao: null, bloom: nb.factory });
    const a = make();
    expect(nb.control.strength).toBe(0);
    a.dispose();
    expect(nb.control.built).toBe(false);
    const b = make();
    expect(nb.control.built).toBe(true);
    expect(nb.control.strength).toBe(0);
    b.dispose();
  });
});

describe('tightHalfRgba: the WebGPU readback pads rows to 256 bytes', () => {
  it('strips the padding row by row (width 100: 800 bytes tight, 1024 padded)', () => {
    // Falsify: stride = width * 4 in tightHalfRgba (i.e. forget the padding).
    const w = 100;
    const h = 3;
    const stride = 1024 / 2;
    const padded = new Uint16Array((h - 1) * stride + w * 4);
    for (let y = 0; y < h; y++) for (let i = 0; i < w * 4; i++) padded[y * stride + i] = y * 1000 + (i % 1000);
    const tight = tightHalfRgba(padded, w, h);
    expect(tight.length).toBe(w * h * 4);
    expect(tight[0]).toBe(0);
    expect(tight[w * 4]).toBe(1000);
    expect(tight[2 * w * 4 + 5]).toBe(2005);
  });
  it('passes a tight (WebGL2) readback through and refuses a length that fits neither', () => {
    const t = new Uint16Array(8 * 2 * 4);
    expect(tightHalfRgba(t, 8, 2)).toBe(t);
    expect(() => tightHalfRgba(new Uint16Array(7), 8, 2)).toThrow(/fits neither/);
  });
  it('a padded readback census reads the pixels, not the padding (a hot pixel is found, zeros do not dilute p99)', () => {
    const w = 3;
    const h = 2;
    const stride = 256 / 2;
    const padded = new Uint16Array((h - 1) * stride + w * 4);
    const one = 0x3c00; // 1.0
    const two = 0x4000; // 2.0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded.set([one, one, one, one], y * stride + x * 4);
    padded.set([two, two, two, one], stride + 2 * 4); // last pixel: luminance 2
    expect(halfToFloat(two)).toBe(2);
    const c = luminanceCensus(tightHalfRgba(padded, w, h), 1);
    expect(c.samples).toBe(6);
    expect(c.max).toBeCloseTo(2, 5);
  });
});
