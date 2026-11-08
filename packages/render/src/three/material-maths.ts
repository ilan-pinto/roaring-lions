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
import { GROUND_SLOTS, slotUniforms } from './terrain/mesh';
import { ROAD_DISTANCE_RANGE_TILES } from './terrain/control-map';
import { groundBlend, heightBiased, macroDecode, macroFactor, rescaleWeights, roadBands } from './terrain/ground-maths';

export const MATERIAL_MATHS: MaterialMaths = {
  marker: 'rl-material-maths',
  // T3: the node ground (`terrain/mesh.node.ts`).
  ground: { slots: GROUND_SLOTS, slotUniforms, roadDistanceRangeTiles: ROAD_DISTANCE_RANGE_TILES, roadBands, heightBiased, rescaleWeights, macroDecode, macroFactor, groundBlend },
  foliage: null,
  ring: null,
};
