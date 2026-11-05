/**
 * GH-943 WebGPU-primary P1 (T4): the NODE twin of `fog-pass.ts`. The same stage as a TSL graph, built by the `fog` factory of the
 * node backend's `PostKit` and slotted by `post-chain.node.ts` straight after the scene pass.
 *
 * What it mirrors, in the order the GLSL fragment runs:
 *   1. the beam's heat shimmer: the scene-colour SAMPLE is offset inside each site's disc (`uShimmerCount == 0` leaves the uv
 *      untouched, so a frame without a beam is the shimmer-free graph, bit for bit);
 *   2. `depth >= 1` early-out: the clear colour beyond the map is returned as sampled;
 *   3. the dust haze, a mix toward `uHazeTint`, before the shroud so the shroud dims hazed ground like any other;
 *   4. the shroud mix (`fogDim`), with 5. `uRevealAll`, 6. the off-map fade and 7. `uOffMapSeen`.
 *
 * **The uniforms stay a record.** `fog-spec.ts`'s `FogUniformTable` is the same `uniforms.X.value` table the legacy pass exposes, so
 * the `fogPass` call sites in `ThreeRenderer` are unchanged on this backend. Vectors and matrices are bound BY REFERENCE (the setters
 * mutate them in place); numbers are re-read from the table every render (`onRenderUpdate`), because `uRevealAll.value = 1` replaces
 * the number rather than mutating it.
 *
 * **Depth comes through `getViewPosition`, never `depth * 2 - 1`.** WebGPU depth runs 0..1 and the uv's Y is flipped; the stock node
 * knows both. The camera matrices are bound from the CAMERA the chain was built with (the persistent `viewCamera`), by reference.
 *
 * ADDON-FREE: `three` and types only; TSL arrives on the stage context.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { Ops } from './fog-ops';
import { fogDim } from './fog-ops';
import type { PostStageContext, PostStage, PostStageFactory } from './backend/backend';
import { FOG_OFFMAP_FADE_TILES, type FogUniformTable } from './fog-spec';
import { HAZE_FORWARD, hazeAmountOps } from './haze';
import { SHIMMER_MAX_SITES, shimmerOffsetOps } from './shimmer';
import { WORLD_PER_LEVEL } from './terrain/shared';

/**
 * The slice of a TSL node this file uses, as a structural handle. The stock typings make every swizzle and operator overload-specific
 * (a `Node` cannot be `.add`ed until it is `Node<'float'>`), and a shader graph built generically over `Ops<T>` cannot satisfy them
 * statically, so the TSL module is cast ONCE, at the stage context, to this shape. `fog-pass.node.test.ts` evaluates the graph.
 */
export interface N {
  add(b: N | number): N;
  sub(b: N | number): N;
  mul(b: N | number): N;
  div(b: N | number): N;
  lessThan(b: N | number): N;
  greaterThan(b: N | number): N;
  negate(): N;
  toVar(): N;
  assign(v: N): void;
  addAssign(v: N): void;
  sample(uv: N): N;
  element(i: number): N;
  onRenderUpdate(cb: () => void): N;
  value: unknown;
  readonly x: N;
  readonly y: N;
  readonly z: N;
  readonly w: N;
  readonly r: N;
  readonly a: N;
  readonly rgb: N;
  readonly xyz: N;
}
export interface Tsl {
  float(n: number): N;
  vec2(...a: Array<N | number>): N;
  vec3(...a: Array<N | number>): N;
  vec4(...a: Array<N | number>): N;
  sin(a: N): N;
  clamp(a: N, lo: number, hi: number): N;
  length(a: N): N;
  dot(a: N, b: N): N;
  max(a: N, b: N): N;
  mix(a: N, b: N, t: N): N;
  select(c: N, a: N, b: N): N;
  uniform(v: unknown): N;
  uniformArray(v: unknown, type: string): N;
  texture(t: unknown): N;
  getViewPosition(uv: N, depth: N, projInv: N): N;
  If(cond: N, body: () => void): void;
  Fn(body: () => N): () => N;
  readonly screenUV: N;
}

/** `Ops<N>` over the TSL a stage context carries. Exported so the maths test can run the SAME bodies on nodes. */
export function tslOps(TSL: Tsl): Ops<N> {
  return {
    lit: (n) => TSL.float(n),
    add: (a, b) => a.add(b),
    sub: (a, b) => a.sub(b),
    mul: (a, b) => a.mul(b),
    div: (a, b) => a.div(b),
    sin: (a) => TSL.sin(a),
    clamp01: (a) => TSL.clamp(a, 0, 1),
    length2: (x, y) => TSL.length(TSL.vec2(x, y)),
    mix: (a, b, t) => TSL.mix(a, b, t),
    selectLt: (a, b, x, y) => TSL.select(a.lessThan(b), x, y),
  };
}

/** The fog stage for `table`. `hazeLow` is the compile-time low-lying strength (a raining map's 0.10). */
export function createFogStageFactory(table: FogUniformTable, hazeLow: number): PostStageFactory {
  return (ctx: PostStageContext): PostStage => buildFogStage(ctx, table, hazeLow);
}

/** The stage plus the bound number uniforms, by table key, so a test can run their per-render sync and see which the graph uses. */
export interface FogStage extends PostStage {
  readonly bound: Readonly<Record<string, N>>;
}

export function buildFogStage(ctx: PostStageContext, table: FogUniformTable, hazeLow: number): FogStage {
  const TSL = ctx.TSL as unknown as Tsl;
  const { scenePass, camera } = ctx;
  const o = tslOps(TSL);
  const lit = o.lit;

  // Numbers are re-read from the table each render; vectors and matrices are shared by reference.
  const num = (rec: { value: number }): N => {
    const n = TSL.uniform(rec.value);
    n.onRenderUpdate(() => {
      n.value = rec.value;
    });
    return n;
  };
  const uNeverSeen = num(table.uNeverSeen);
  const uExplored = num(table.uExplored);
  const uTintGain = num(table.uTintGain);
  const uRevealAll = num(table.uRevealAll);
  const uOffMapSeen = num(table.uOffMapSeen);
  const uHazeFar = num(table.uHazeFar);
  const uHazeRef = num(table.uHazeRef);
  const uHazeAmp = num(table.uHazeAmp);
  const uShimmerCount = num(table.uShimmerCount);
  const uShimmerAmp = num(table.uShimmerAmp);
  const uShimmerAspect = num(table.uShimmerAspect);
  const uShimmerTime = num(table.uShimmerTime);
  const uMapSize = TSL.uniform(table.uMapSize.value);
  const uTint = TSL.uniform(table.uTint.value);
  const uFocus = TSL.uniform(table.uFocus.value);
  const uHazeTint = TSL.uniform(table.uHazeTint.value);
  const uShimmerPx = TSL.uniform(table.uShimmerPx.value);
  const uShimmer = TSL.uniformArray(table.uShimmer.value, 'vec4');
  const shroud = TSL.texture(table.uShroud.value);
  // The camera the chain was built with, by reference: `viewCamera` is reconfigured in place every frame.
  const projInv = TSL.uniform(camera.projectionMatrixInverse);
  const camWorld = TSL.uniform(camera.matrixWorld);

  const colourIn = ctx.input as unknown as N;
  const sampleColour = (uv: N): N => colourIn.sample(uv);
  const depthNode = scenePass.getTextureNode('depth') as unknown as N;

  // The legacy shader's `vUv` is Y-UP (origin bottom-left); TSL's `screenUV` is Y-down. Everything below works in the shader's
  // convention and flips once on the way into a texture sample.
  const toTex = (uv: N): N => TSL.vec2(uv.x, lit(1).sub(uv.y));
  const vUv = TSL.vec2(TSL.screenUV.x, lit(1).sub(TSL.screenUV.y));

  const stage = TSL.Fn(() => {
    // 1. Shimmer. Each site is guarded by the live count, so with `uShimmerCount == 0` no offset is ever added and `rlUv` is `vUv`.
    const rlUv = vUv.toVar();
    for (let i = 0; i < SHIMMER_MAX_SITES; i++) {
      TSL.If(uShimmerCount.greaterThan(i), () => {
        const s = uShimmer.element(i);
        const d = TSL.vec2(vUv.x.sub(s.x).mul(uShimmerAspect), vUv.y.sub(s.y)).div(s.z);
        const [ox, oy] = shimmerOffsetOps(o, d.x, d.y, uShimmerAmp.mul(s.w), uShimmerTime);
        rlUv.addAssign(TSL.vec2(ox, oy).mul(uShimmerPx));
      });
    }
    const color = sampleColour(toTex(rlUv)).toVar();
    const out = color.toVar();
    // 2. depth >= 1: nothing drawn here, the clear colour is returned as sampled.
    const depth = depthNode.sample(TSL.screenUV).r;
    TSL.If(depth.lessThan(1), () => {
      // World position through the STOCK unprojection (WebGPU depth is 0..1; the uv's Y is flipped inside it).
      const view = TSL.getViewPosition(TSL.screenUV, depth, projInv).toVar();
      const world = camWorld.mul(TSL.vec4(view, 1)).xyz.toVar();
      // 3. Haze, before the shroud.
      const ahead = TSL.dot(TSL.vec2(world.x, world.z).sub(uFocus), TSL.vec2(HAZE_FORWARD[0], HAZE_FORWARD[1]));
      const below = uHazeRef.sub(world.y.div(WORLD_PER_LEVEL));
      const haze = uHazeAmp.mul(hazeAmountOps(o, ahead, below, uHazeFar, lit(hazeLow)));
      const hazed = TSL.mix(color.rgb, uHazeTint, haze);
      // 4-7. Shroud, reveal, off-map fade, backdrop-seen.
      const tex = TSL.vec2(world.x.div(uMapSize.x), world.z.div(uMapSize.y));
      let v: N = shroud.sample(tex).r;
      v = TSL.mix(v, lit(1), uRevealAll);
      const outUv = TSL.max(TSL.vec2(0), TSL.max(tex.negate(), tex.sub(TSL.vec2(1))));
      const fade = TSL.clamp(TSL.length(outUv.mul(uMapSize)).div(FOG_OFFMAP_FADE_TILES), 0, 1);
      v = v.mul(lit(1).sub(fade));
      v = v.add(uOffMapSeen.mul(fade));
      const dim = fogDim(o, v, uNeverSeen, uExplored);
      const lum = TSL.dot(hazed, TSL.vec3(0.2126, 0.7152, 0.0722));
      const shrouded = uTint.mul(lum).mul(uTintGain);
      out.assign(TSL.vec4(TSL.mix(hazed, shrouded, dim), color.a));
    });
    return out;
  })();

  const bound = {
    uNeverSeen, uExplored, uTintGain, uRevealAll, uOffMapSeen, uHazeFar, uHazeRef, uHazeAmp,
    uShimmerCount, uShimmerAmp, uShimmerAspect, uShimmerTime,
  };
  return { node: stage as unknown as PostStage['node'], bound };
}
