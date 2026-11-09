/**
 * Look uplift L2 (GH-943): the colour grade's GL half -- a 32^3 LUT lookup FOLDED into
 * `OutputPass`'s fragment shader, between the sRGB encode and the vignette.
 *
 * Spec section 3 says "one pass after OutputPass, before the vignette and SMAA". The vignette is
 * folded INTO `OutputPass` (GH-829, `vignette-pass.ts`), after a measurement of 0.4-0.8 ms for the
 * separate pass it replaced, so a pass AFTER OutputPass would land after the vignette, and would
 * cost the same full-frame HalfFloat read and write that fold removed. Folding the lookup in
 * keeps the spec's ORDER (display-referred, after tone map and encode, before the vignette) and
 * pays only a 3D texture fetch. The maths is `grade-maths.ts`.
 *
 * **Identity builds nothing.** `apply(null)` and `apply(identity)` leave the material on the
 * vignette-folded source it had, byte for byte, so day, and a map with no grade, draw the frame
 * they draw today. `apply(grade)` swaps in a source with the lookup, and `needsUpdate` recompiles
 * once; a later `apply` with another grade only rewrites the LUT's texels.
 *
 * **Banding.** A 32^3 LUT cannot band by itself (a half-float LUT, trilinear), but the canvas is
 * 8-bit, and a graded dark gradient covers fewer 8-bit levels than the same gradient ungraded.
 * `dither` adds one LSB of interleaved-gradient noise at the very end of the shader. See the
 * mock README for the measurement that chose the default.
 *
 * Presentation only: nothing here is read by the sim.
 */
import * as THREE from 'three';
import type { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { bakeLutFloats, GRADE_LUT_SIZE, isIdentity, type ResolvedGrade } from './grade-maths';

/** Where the lookup hooks in: right before the vignette folds its multiply. Asserted: a reworded fold would otherwise leave a grade that silently never draws. */
const GRADE_ANCHOR = 'fragColor.rgb = roundTripHalf(fragColor.rgb)';
const MAIN_ANCHOR = 'void main()';
const END_ANCHOR = /\}\s*$/;

const UNIFORMS_GLSL = `
precision highp sampler3D;
uniform sampler3D uGradeLut;
uniform float uGradeOn;
uniform float uGradeDither;
float gradeNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

const N = GRADE_LUT_SIZE;
const LOOKUP_GLSL = `  if (uGradeOn > 0.5) {
    vec3 gc = clamp(fragColor.rgb, 0.0, 1.0);
    fragColor.rgb = texture(uGradeLut, gc * ${((N - 1) / N).toFixed(8)} + ${(0.5 / N).toFixed(8)}).rgb;
  }
  `;

const DITHER_GLSL = `  if (uGradeOn > 0.5) fragColor.rgb += (gradeNoise(gl_FragCoord.xy) - 0.5) * (uGradeDither / 255.0);\n}`;

/** Rewrites a vignette-folded `OutputPass` fragment source to carry the grade. Pure string work, exported for a GL-free test. */
export function foldGradeShader(fragment: string): string {
  if (!fragment.includes(GRADE_ANCHOR) || !fragment.includes(MAIN_ANCHOR) || !END_ANCHOR.test(fragment)) {
    throw new Error(
      "output-grade: OutputPass's fragment source no longer has the anchors the grade folds into " +
        "('fragColor.rgb = roundTripHalf(...)', 'void main()' and the closing brace) -- the vignette fold or three changed; re-anchor."
    );
  }
  return fragment
    .replace(MAIN_ANCHOR, `${UNIFORMS_GLSL}${MAIN_ANCHOR}`)
    .replace(GRADE_ANCHOR, `${LOOKUP_GLSL}${GRADE_ANCHOR}`)
    .replace(END_ANCHOR, DITHER_GLSL);
}

/** `half`: the shipped LUT (RGBA16F). `byte`: an RGBA8 LUT, a measurement arm only (banding mock). */
export type LutPrecision = 'half' | 'byte';

export interface ApplyOptions {
  /** One LSB of noise before the 8-bit write. Default true. */
  readonly dither?: boolean;
  readonly lut?: LutPrecision;
}

function lutTexture(floats: Float32Array, precision: LutPrecision): THREE.Data3DTexture {
  let tex: THREE.Data3DTexture;
  if (precision === 'half') {
    const half = new Uint16Array(floats.length);
    for (let i = 0; i < floats.length; i++) half[i] = THREE.DataUtils.toHalfFloat(floats[i]);
    tex = new THREE.Data3DTexture(half, N, N, N);
    tex.type = THREE.HalfFloatType;
  } else {
    const bytes = new Uint8Array(floats.length);
    for (let i = 0; i < floats.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, floats[i])) * 255);
    tex = new THREE.Data3DTexture(bytes, N, N, N);
    tex.type = THREE.UnsignedByteType;
  }
  tex.format = THREE.RGBAFormat;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The grade, living inside `OutputPass`. Starts as no grade at all: the stock (vignette-folded) shader. */
export class OutputGrade {
  readonly uniforms: {
    uGradeLut: THREE.IUniform<THREE.Data3DTexture | null>;
    uGradeOn: THREE.IUniform<number>;
    uGradeDither: THREE.IUniform<number>;
  };
  private readonly material: THREE.ShaderMaterial;
  private readonly baseFragment: string;
  private folded = false;
  private on = true;
  private lut: THREE.Data3DTexture | null = null;

  constructor(outputPass: OutputPass) {
    this.material = outputPass.material;
    this.baseFragment = this.material.fragmentShader;
    this.uniforms = { uGradeLut: { value: null }, uGradeOn: { value: 0 }, uGradeDither: { value: 1 } };
    // Held on the table from the start so a later fold only has to switch the source.
    Object.assign(outputPass.uniforms, this.uniforms);
  }

  /** True when a lookup is compiled into the output shader. False for day, a map with no grade, and any identity. */
  get active(): boolean {
    return this.folded;
  }

  /** The debug layer's switch. Off is the lookup and the dither skipped: the ungraded output, bit for bit. */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    this.on = value;
    this.uniforms.uGradeOn.value = value && this.folded ? 1 : 0;
  }

  /** Installs `grade` (null or an identity removes any grade). Returns whether a lookup is now compiled in. */
  apply(grade: ResolvedGrade | null, options: ApplyOptions = {}): boolean {
    if (grade === null || isIdentity(grade)) {
      if (this.folded) {
        this.material.fragmentShader = this.baseFragment;
        this.material.needsUpdate = true;
        this.folded = false;
      }
      this.uniforms.uGradeOn.value = 0;
      return false;
    }
    // A fresh texture each time: a LUT is 256 KB, a grade changes at boot or on a mock-sheet flag, and replacing
    // the object (rather than rewriting its data) lets the precision change too.
    this.lut?.dispose();
    this.lut = lutTexture(bakeLutFloats(grade), options.lut ?? 'half');
    this.uniforms.uGradeLut.value = this.lut;
    this.uniforms.uGradeDither.value = options.dither === false ? 0 : 1;
    if (!this.folded) {
      this.material.fragmentShader = foldGradeShader(this.baseFragment);
      this.material.needsUpdate = true;
      this.folded = true;
    }
    this.uniforms.uGradeOn.value = this.on ? 1 : 0;
    return true;
  }

  dispose(): void {
    this.lut?.dispose();
    this.lut = null;
    this.uniforms.uGradeLut.value = null;
  }
}
