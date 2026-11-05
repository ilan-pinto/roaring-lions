/**
 * GH-943 WebGPU-primary P1 (T3): the output stage's shared maths as one value, for `ThreeRenderer` (and the tests) to hand to the node
 * backend through `RenderBackend.setOutputMaths`. The node twins (`output-grade.node.ts`, `vignette-pass.node.ts`) import these as
 * TYPES only: `grade-maths.ts` and `vignette-spec.ts` are also imported by the legacy passes, so a value import in a twin would make the
 * node-backend chunk statically load the ThreeRenderer chunk (the bundle census fails on that). Only the app side imports this file.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import { bakeLutFloats, GRADE_LUT_SIZE, gradeDitherOffset, isIdentity, lutCoord } from './grade-maths';
import { VIGNETTE_RADIUS, VIGNETTE_SOFTNESS, VIGNETTE_STRENGTH, vignetteFactor, vignetteScale } from './vignette-spec';
import type { OutputMaths } from './post-chain.node';

export const OUTPUT_MATHS: OutputMaths = {
  grade: { bakeLutFloats, lutSize: GRADE_LUT_SIZE, gradeDitherOffset, isIdentity, lutCoord },
  vignette: { radius: VIGNETTE_RADIUS, softness: VIGNETTE_SOFTNESS, strength: VIGNETTE_STRENGTH, factor: vignetteFactor, scale: vignetteScale },
};
