/**
 * @vitest-environment jsdom
 *
 * GH-943 P1 (T4) gates for `fog-pass.node.ts`. The graph is compiled to GLSL by three's own `GLSLNodeBuilder` (no GPU needed), so
 * these read the real generated shader, not a mock. Each has a one-line falsification, run by hand and listed in the commit message.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FogUniforms, FOG_NEVER_SEEN, FOG_EXPLORED } from './fog-spec';
import { NUMBER_OPS, fogDim } from './fog-ops';
import { HAZE_LOW, HAZE_RAMP_TILES, HAZE_LOW_LEVELS, hazeAmount, hazeAmountOps } from './haze';
import { shimmerOffsetPx, shimmerOffsetOps, shimmerWeight, SHIMMER_MAX_SITES, SHIMMER_MAX_OFFSET_PX } from './shimmer';
import { buildFogStage, type FogStage, type N } from './fog-pass.node';

interface Built {
  readonly glsl: string;
  readonly stage: FogStage;
  readonly fog: FogUniforms;
  readonly used: ReadonlySet<unknown>;
}

/** Compiles the fog stage to GLSL through three's own builder. `webgpuDepth` makes the renderer report the 0..1 depth convention. */
async function build(opts: { hazeLow?: number; webgpuDepth?: boolean } = {}): Promise<Built> {
  const W = await import('three/webgpu');
  const T = await import('three/tsl');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  Object.defineProperty(r, 'coordinateSystem', { get: () => (opts.webgpuDepth === false ? THREE.WebGLCoordinateSystem : THREE.WebGPUCoordinateSystem) });
  const shroud = new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat);
  const fog = new FogUniforms(shroud, 8, 8);
  const input = T.texture(new THREE.Texture());
  const depth = T.texture(new THREE.DepthTexture(4, 4));
  const scenePass = { getTextureNode: (n: string) => (n === 'depth' ? depth : input) };
  const camera = new THREE.OrthographicCamera();
  const stage = buildFogStage({ input, scenePass, TSL: T, scene: new THREE.Scene(), camera } as never, fog.uniforms, opts.hazeLow ?? HAZE_LOW);
  const mat = new W.NodeMaterial();
  mat.fragmentNode = stage.node as never;
  // The typings hide the builder's working members; this is the slice the test reads.
  const builder = new W.GLSLNodeBuilder(new W.QuadMesh(mat), r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    uniforms: { fragment: Array<{ node: unknown }> };
    fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mat;
  builder.build();
  const used = new Set<unknown>(builder.uniforms.fragment.map((u) => u.node));
  return { glsl: builder.fragmentShader, stage, fog, used };
}

describe('the maths, written once against Ops', () => {
  it('hazeAmountOps on numbers is the closed form (far ramp + low-lying term)', () => {
    for (const [ahead, below, far, low] of [[0, 0, 0.12, 0.06], [10, 1, 0.12, 0.06], [40, 5, 0.2, 0.1], [-3, -2, 0.12, 0.06]] as const) {
      const want = far * Math.min(1, Math.max(0, ahead / HAZE_RAMP_TILES)) + low * Math.min(1, Math.max(0, below / HAZE_LOW_LEVELS));
      expect(hazeAmountOps(NUMBER_OPS, ahead, below, far, low)).toBe(want);
      expect(hazeAmount(ahead, below, far, low)).toBe(want);
    }
    // The shipped two-argument shape still means HAZE_LOW.
    expect(hazeAmount(20, 2, 0.12)).toBeCloseTo(0.12 + HAZE_LOW, 12);
  });
  it('fogDim hits the three tiers and is continuous at the explored knee', () => {
    expect(fogDim(NUMBER_OPS, 0, FOG_NEVER_SEEN, FOG_EXPLORED)).toBe(FOG_NEVER_SEEN);
    expect(fogDim(NUMBER_OPS, 0.5, FOG_NEVER_SEEN, FOG_EXPLORED)).toBe(FOG_EXPLORED);
    expect(fogDim(NUMBER_OPS, 1, FOG_NEVER_SEEN, FOG_EXPLORED)).toBe(0);
    expect(fogDim(NUMBER_OPS, 0.25, FOG_NEVER_SEEN, FOG_EXPLORED)).toBeCloseTo((FOG_NEVER_SEEN + FOG_EXPLORED) / 2, 12);
    expect(fogDim(NUMBER_OPS, 0.75, FOG_NEVER_SEEN, FOG_EXPLORED)).toBeCloseTo(FOG_EXPLORED / 2, 12);
  });
  it('shimmerOffsetPx is zero at and beyond the rim, bounded by the maximum offset, and is shimmerOffsetOps', () => {
    expect(shimmerWeight(1)).toBe(0);
    expect(shimmerOffsetPx(1, 0, 1, 3.7)).toEqual([0, 0]);
    let max = 0;
    for (let i = 0; i < 400; i++) {
      const [x, y] = shimmerOffsetPx(Math.sin(i) * 0.7, Math.cos(i * 1.3) * 0.7, 1, i * 0.07);
      expect(shimmerOffsetOps(NUMBER_OPS, Math.sin(i) * 0.7, Math.cos(i * 1.3) * 0.7, 1, i * 0.07)).toEqual([x, y]);
      max = Math.max(max, Math.hypot(x, y));
    }
    expect(max).toBeLessThanOrEqual(SHIMMER_MAX_OFFSET_PX + 1e-9);
    expect(max).toBeGreaterThan(0.5 * SHIMMER_MAX_OFFSET_PX);
  });
});

describe('the node graph, compiled to GLSL by three\'s own builder', () => {
  it('shimmer: exactly one guarded block per site, each gated on the live count, so uShimmerCount == 0 is the shimmer-free graph', async () => {
    const { glsl, used, stage } = await build();
    const guards = [...glsl.matchAll(/if \( \( nodeUniform\d+ > (\d+)\.0 \) \) \{([^]*?)\n\t\}/g)];
    expect(guards.map((g) => Number(g[1]))).toEqual(Array.from({ length: SHIMMER_MAX_SITES }, (_, i) => i));
    // The ONLY place the sample uv is accumulated is inside those guards: nothing outside can move it when the count is 0.
    const accumulations = [...glsl.matchAll(/nodeVar\d+ = \( nodeVar\d+ \+ \( vec2\(/g)];
    expect(accumulations.length).toBe(SHIMMER_MAX_SITES);
    for (const g of guards) expect(g[2]).toMatch(/nodeVar\d+ = \( nodeVar\d+ \+ \( vec2\(/);
    // ...and the count the guards read is the bound uniform.
    expect(used.has(stage.bound.uShimmerCount)).toBe(true);
  });

  it('every number in the table the call sites write reaches the graph', async () => {
    const { used, stage } = await build();
    for (const [name, node] of Object.entries(stage.bound)) expect(used.has(node), `${name} is bound but the graph never reads it`).toBe(true);
  });

  it('a number written into the table reaches the bound node on the next render update (uRevealAll.value = 1 replaces the number)', async () => {
    const { stage, fog } = await build();
    const node = stage.bound.uRevealAll as N & { update(): void };
    expect(node.value).toBe(0);
    fog.uniforms.uRevealAll.value = 1;
    node.update();
    expect(node.value).toBe(1);
    const haze = stage.bound.uHazeAmp as N & { update(): void };
    fog.uniforms.uHazeAmp.value = 0;
    haze.update();
    expect(haze.value).toBe(0);
  });

  it('hazeLow is compiled in: a raining map\'s 0.10 is in the source and 0.06 is not', async () => {
    const shipped = (await build()).glsl;
    const rain = (await build({ hazeLow: 0.1 })).glsl;
    expect(shipped).toContain('( 0.06 * clamp(');
    expect(rain).toContain('( 0.1 * clamp(');
    expect(rain).not.toContain('( 0.06 * clamp(');
  });

  it('depth goes through getViewPosition: on WebGPU the raw 0..1 depth is clip z, never remapped by depth * 2 - 1', async () => {
    const gpu = (await build({ webgpuDepth: true })).glsl;
    const gl = (await build({ webgpuDepth: false })).glsl;
    const depthVar = gpu.match(/(nodeVar\d+) = texture\( nodeUniform\d+, nodeVar\d+ \)\.x;/)?.[1];
    expect(depthVar).toBeDefined();
    // clip = vec4( vec3( xy, depth ), 1 ): the depth variable is the third component, untouched.
    expect(gpu).toContain(`, ${depthVar} ), 1.0 )`);
    expect(gpu).not.toMatch(new RegExp(`${depthVar} \\* 2\\.0`));
    // The stock node remaps all three components on the -1..1 convention, so the two sources really do differ there.
    expect(gl).not.toContain(`, ${depthVar} ), 1.0 )`);
  });

  it('the early-out leaves a depth >= 1 pixel as sampled: haze and shroud are inside the depth < 1 branch', async () => {
    const { glsl } = await build();
    const branch = glsl.match(/if \( \( nodeVar\d+ < 1\.0 \) \) \{([^]*)\n\t\}\n/);
    expect(branch).not.toBeNull();
    expect(branch?.[1]).toContain('mix(');
    expect(glsl.slice(0, branch?.index)).not.toContain('mix(');
  });
});
