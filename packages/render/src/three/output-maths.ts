/**
 * GH-943 WebGPU-primary P1 (T3): the output stage's (and the bloom's) shared maths as values, for `ThreeRenderer` (and the tests) to hand to the node
 * backend through `RenderBackend.setOutputMaths`. The node twins (`output-grade.node.ts`, `vignette-pass.node.ts`) import these as
 * TYPES only: `grade-maths.ts` and `vignette-spec.ts` are also imported by the legacy passes, so a value import in a twin would make the
 * node-backend chunk statically load the ThreeRenderer chunk (the bundle census fails on that). Only the app side imports this file.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import { bakeLutFloats, GRADE_LUT_SIZE, gradeDitherOffset, isIdentity, lutCoord } from './grade-maths';
import { VIGNETTE_RADIUS, VIGNETTE_SOFTNESS, VIGNETTE_STRENGTH, vignetteFactor, vignetteScale } from './vignette-spec';
import { BLOOM_RADIUS, BLOOM_RESOLUTION_SCALE, BLOOM_SMOOTH_WIDTH, BLOOM_STRENGTH, BLOOM_THRESHOLD, bloomStrengthFor, tightHalfRgba } from './bloom-spec';
import type { OutputMaths } from './post-chain.node';
import type { BloomMaths } from './bloom.node';

export const OUTPUT_MATHS: OutputMaths = {
  grade: { bakeLutFloats, lutSize: GRADE_LUT_SIZE, gradeDitherOffset, isIdentity, lutCoord },
  vignette: { radius: VIGNETTE_RADIUS, softness: VIGNETTE_SOFTNESS, strength: VIGNETTE_STRENGTH, factor: vignetteFactor, scale: vignetteScale },
};

/** T5: the bloom's constants and helpers (`bloom-spec.ts`), passed to `createNodeBackend` for the same reason. */
export const BLOOM_MATHS: BloomMaths = {
  strength: BLOOM_STRENGTH,
  radius: BLOOM_RADIUS,
  threshold: BLOOM_THRESHOLD,
  resolutionScale: BLOOM_RESOLUTION_SCALE,
  smoothWidth: BLOOM_SMOOTH_WIDTH,
  strengthFor: bloomStrengthFor,
  tightHalfRgba,
};
