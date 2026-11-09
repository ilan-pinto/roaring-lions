/**
 * GH-943 WebGPU-primary P1 (T3): the NODE twin of `output-grade.ts`. The 32^3 grade LUT and the dither, as TSL fragments of the
 * output stage, display-referred: they run on the colour AFTER `renderOutput` (ACES 1.0, sRGB encode), in the legacy order
 *
 *   1. `lookup`    LUT at `clamp(c,0,1) * (N-1)/N + 0.5/N`
 *   2. (roundTripHalf and the vignette multiply: `vignette-pass.node.ts`)
 *   3. `dither`    one LSB of interleaved-gradient noise on the pixel position
 *
 * (Design section 3 puts the grade before the sRGB encode; the code, which this follows, does not.)
 *
 * **One graph, uniforms.** Legacy compiles the lookup in or out of the shader (`foldGradeShader`); a node graph is fixed once the
 * pipeline is built, so grade-on and the dither amount are UNIFORMS (`uGradeOn`, `uGradeDither`) and the LUT is ONE texture whose
 * texels are rewritten by `apply`. Off, or an identity grade, selects the input colour unchanged at the lookup -- legacy's
 * "builds no lookup" frame, as values. The dither is NOT part of that: it runs on every frame (GH-943 P2 T8), so a day map with no
 * grade no longer bands a smooth gradient in 8 bits; only `uGradeDither` 0 (the measurement arm) turns it off.
 *
 * **Dither origin.** `gl_FragCoord` has its origin bottom-left. `screenCoordinate` is top-left on every node backend (the WebGL
 * backend flips it to follow WebGPU), so the node dither takes `screenSize.y - y`, which is `gl_FragCoord.y` of the same pixel
 * exactly (`(H - 1 - row) + 0.5 == H - (row + 0.5)`), and the noise matches legacy pixel for pixel on both node backends.
 *
 * The LUT bake is `grade-maths.ts`'s `bakeLutFloats`, shared with legacy; the coordinate and the noise are `lutCoord` / `gradeNoise`
 * there, written once against `ScalarOps`. ADDON-FREE: TSL arrives injected.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import * as THREE from 'three';
import type { Node as TslNode } from 'three/webgpu';
import type { bakeLutFloats, GRADE_LUT_SIZE, gradeDitherOffset, isIdentity, lutCoord, ResolvedGrade } from './grade-maths';
import type { GradeApplyOptionsLike, OutputGradeLike } from './post-chain-shared';
import { tslOps, type Tsl as FogTsl } from './fog-pass.node';
import type { Ops } from './fog-ops';

type Tsl = typeof import('three/tsl');
interface UniformLike {
  value: number;
}

/**
 * The Ops-parameterised grade maths shared with the legacy pass (`grade-maths.ts`), INJECTED rather than imported: legacy `output-grade.ts`
 * imports the same module, so the bundler hoists it into the ThreeRenderer chunk, and a static import here would make the node-backend
 * chunk load that chunk and the legacy composer in it (the bundle census, `pnpm --filter @lions/tools webgpu:bundle`, fails on that).
 * `ThreeRenderer` hands it over through `RenderBackend.setOutputMaths`; type-only imports here, so nothing loads at runtime.
 */
export interface GradeMaths {
  readonly bakeLutFloats: typeof bakeLutFloats;
  readonly lutSize: typeof GRADE_LUT_SIZE;
  readonly gradeDitherOffset: typeof gradeDitherOffset;
  readonly isIdentity: typeof isIdentity;
  readonly lutCoord: typeof lutCoord;
}

export class NodeOutputGrade implements OutputGradeLike {
  readonly uniforms: { uGradeOn: UniformLike; uGradeDither: UniformLike };
  /** The one LUT texture: zeros until a grade is applied (never read while `uGradeOn` is 0), then rewritten in place. */
  readonly lut: THREE.Data3DTexture;
  private readonly half: Uint16Array;
  private readonly nodes: { on: TslNode; dither: TslNode };
  private folded = false;
  private on = true;

  constructor(
    private readonly TSL: Tsl,
    private readonly maths: GradeMaths
  ) {
    const N = maths.lutSize;
    this.half = new Uint16Array(N * N * N * 4);
    const on = TSL.uniform(0);
    const dither = TSL.uniform(1);
    this.uniforms = { uGradeOn: on as unknown as UniformLike, uGradeDither: dither as unknown as UniformLike };
    this.nodes = { on: on as unknown as TslNode, dither: dither as unknown as TslNode };
    const tex = new THREE.Data3DTexture(this.half, N, N, N);
    tex.type = THREE.HalfFloatType;
    tex.format = THREE.RGBAFormat;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.lut = tex;
  }

  get active(): boolean {
    return this.folded;
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    this.on = value;
    this.uniforms.uGradeOn.value = value && this.folded ? 1 : 0;
  }

  apply(grade: ResolvedGrade | null, options: GradeApplyOptionsLike = {}): boolean {
    if (grade === null || this.maths.isIdentity(grade)) {
      this.folded = false;
      this.uniforms.uGradeOn.value = 0;
      this.uniforms.uGradeDither.value = options.dither === false ? 0 : 1;
      return false;
    }
    const floats = this.maths.bakeLutFloats(grade);
    for (let i = 0; i < floats.length; i++) this.half[i] = THREE.DataUtils.toHalfFloat(floats[i] as number);
    this.lut.needsUpdate = true;
    this.uniforms.uGradeDither.value = options.dither === false ? 0 : 1;
    this.folded = true;
    this.uniforms.uGradeOn.value = this.on ? 1 : 0;
    return true;
  }

  /** Stage 1: the LUT lookup on the display-referred `rgb`; the input itself while the grade is off. */
  lookup(rgb: TslNode): TslNode {
    const TSL = this.TSL;
    const coord = this.maths.lutCoord((tslOps(TSL as unknown as FogTsl) as unknown as Ops<TslNode>), rgb);
    const sampled = (TSL.texture3D(this.lut, coord as never) as unknown as { rgb: TslNode }).rgb;
    return TSL.select((this.nodes.on as unknown as { greaterThan(o: number): TslNode }).greaterThan(0.5) as never, sampled as never, rgb as never) as unknown as TslNode;
  }

  /** Stage 3: one LSB of noise on the pixel position, on EVERY frame (T8: not guarded by `uGradeOn`; `uGradeDither` 0 is the measurement arm). */
  dither(rgb: TslNode): TslNode {
    const TSL = this.TSL;
    const frag = TSL.screenCoordinate as unknown as { x: TslNode; y: TslNode };
    const size = TSL.screenSize as unknown as { y: TslNode };
    const y = (size.y as unknown as { sub(o: unknown): TslNode }).sub(frag.y);
    const offset = this.maths.gradeDitherOffset((tslOps(TSL as unknown as FogTsl) as unknown as Ops<TslNode>), frag.x, y, this.nodes.dither);
    return (rgb as unknown as { add(o: unknown): TslNode }).add(offset);
  }

  dispose(): void {
    this.lut.dispose();
  }
}
