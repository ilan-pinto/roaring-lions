/**
 * GH-943 WebGPU P2 (T1): the material twins' shared maths as VALUES, for `ThreeRenderer` (and the tests) to hand to the node backend
 * through `NodeBackendOptions.materialMaths` (the `output-maths.ts` pattern). The twins (T3 ground, T5 ring, T6 foliage) import
 * this file's types only, never its values: the maths it gathers (`terrain/mesh.ts`, `terrain/wind.ts`, `units/selection-ring.ts`,
 * ...) is also imported by the legacy materials, so a value import in a twin would make the node-backend chunk statically load the
 * ThreeRenderer chunk, and the bundle census fails on exactly that (`MATERIAL_MATHS_MARKER`). Only the app side imports this file.
 *
 * Every slot is `null` until its task fills it.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { MaterialMaths } from './backend/backend';
import { NATURE_ATTRIBUTE } from './terrain/decor-mesh';
import { disturbBendOps, disturbSlotPushOps, DISTURB_MAX } from './terrain/disturb';
import { foliageLeanOps } from './terrain/wind';

export const MATERIAL_MATHS: MaterialMaths = {
  marker: 'rl-material-maths',
  ground: null,
  // T6, T7: the wind's lean (mode 1) and the reduced-motion sway (mode 0), one body (`wind.ts`), and the attribute it reads.
  foliage: { foliageLeanOps, natureAttribute: NATURE_ATTRIBUTE, disturbSlotPushOps, disturbBendOps, disturbMax: DISTURB_MAX },
  ring: null,
};
