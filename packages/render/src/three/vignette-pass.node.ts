/**
 * GH-943 WebGPU-primary P1 (T3): the NODE twin of `vignette-pass.ts`. The corner vignette as a TSL fragment of the output stage,
 * display-referred, AFTER the sRGB encode and the grade lookup, exactly where the legacy fold puts it:
 *
 *   `rgb = roundTripHalf(rgb) * (1 - strength * smoothstep(radius, radius + softness, length(uv - 0.5) / 0.7071))`
 *
 * The falloff and the scale are `vignette-spec.ts`'s `vignetteFactor` / `vignetteScale`, written once against injected operators
 * (`ScalarOps`): this file only hands them TSL nodes. `roundTripHalf` is the legacy `HALF_GLSL` as nodes (see `roundTripHalf`).
 * Starts OFF, like the legacy handle, and `enabled` zeroes the strength uniform: `1 - 0 * v` is exactly 1.
 *
 * ADDON-FREE. TSL arrives injected; nothing here imports `three/webgpu` or `three/tsl` at runtime.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { Node as TslNode } from 'three/webgpu';
import type { OutputVignetteLike } from './post-chain-shared';
import { tslOps, type Tsl as FogTsl } from './fog-pass.node';
import type { Ops } from './fog-ops';
import type { VIGNETTE_RADIUS, VIGNETTE_SOFTNESS, VIGNETTE_STRENGTH, vignetteFactor, vignetteScale } from './vignette-spec';

/** `vignette-spec.ts`'s maths, INJECTED for the reason `GradeMaths` (output-grade.node.ts) gives: a static import would hoist it into the ThreeRenderer chunk. */
export interface VignetteMaths {
  readonly radius: typeof VIGNETTE_RADIUS;
  readonly softness: typeof VIGNETTE_SOFTNESS;
  readonly strength: typeof VIGNETTE_STRENGTH;
  readonly factor: typeof vignetteFactor;
  readonly scale: typeof vignetteScale;
}

type Tsl = typeof import('three/tsl');
interface UniformLike {
  value: number;
}

/**
 * The legacy output rounds the colour through half float where the old separate pass read it back out of the composer's HalfFloat
 * target (`HALF_GLSL`): `.xy` as one packed pair and `.z` as the first half of a second. Same packing, same order, as nodes.
 */
export function roundTripHalf(TSL: Tsl, rgb: TslNode): TslNode {
  const v = rgb as unknown as { x: TslNode; y: TslNode; z: TslNode };
  const a = TSL.unpackHalf2x16(TSL.packHalf2x16(TSL.vec2(v.x as never, v.y as never))) as unknown as TslNode;
  const b = (TSL.unpackHalf2x16(TSL.packHalf2x16(TSL.vec2(v.z as never, 0))) as unknown as { x: TslNode }).x;
  return TSL.vec3(a as never, b as never) as unknown as TslNode;
}

export class NodeOutputVignette implements OutputVignetteLike {
  readonly uniforms: { uVigStrength: UniformLike; uVigRadius: UniformLike; uVigSoftness: UniformLike };
  private readonly nodes: { strength: TslNode; radius: TslNode; softness: TslNode };
  private on = false;

  constructor(
    private readonly TSL: Tsl,
    private readonly maths: VignetteMaths
  ) {
    const s = TSL.uniform(0);
    const r = TSL.uniform(maths.radius);
    const f = TSL.uniform(maths.softness);
    this.uniforms = { uVigStrength: s as unknown as UniformLike, uVigRadius: r as unknown as UniformLike, uVigSoftness: f as unknown as UniformLike };
    this.nodes = { strength: s as unknown as TslNode, radius: r as unknown as TslNode, softness: f as unknown as TslNode };
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    this.on = value;
    this.uniforms.uVigStrength.value = value ? this.maths.strength : 0;
  }

  /** The fragment: half-float round trip, then the scale. `rgb` is the display-referred (post-encode, post-grade) colour. */
  apply(rgb: TslNode): TslNode {
    const TSL = this.TSL;
    const ops = (tslOps(TSL as unknown as FogTsl) as unknown as Ops<TslNode>);
    const uv = TSL.screenUV as unknown as { x: TslNode; y: TslNode };
    const factor = this.maths.factor(ops, uv.x, uv.y, this.nodes.radius, this.nodes.softness);
    const scale = this.maths.scale(ops, this.nodes.strength, factor);
    return (roundTripHalf(TSL, rgb) as unknown as { mul(o: unknown): TslNode }).mul(scale);
  }
}
