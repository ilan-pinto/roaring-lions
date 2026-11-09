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
import {
  RELIEF_CONTOUR_STRENGTH,
  RELIEF_CONTOUR_WIDTH_PX,
  RELIEF_SLOPE_MAX_TILT_RAD,
  RELIEF_TINT_HIGH,
  RELIEF_TINT_LOW,
  contourFactorOps,
  reliefTiltOps,
  reliefTintRampOps,
} from './terrain/relief-read';
import { groundBlend, heightBiased, macroDecode, macroFactor, rescaleWeights, roadBands } from './terrain/ground-maths';
import { NATURE_ATTRIBUTE } from './terrain/decor-mesh';
import { foliageLeanOps } from './terrain/wind';
import { DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS } from './decal-pool';
import { SELECTION_RING } from './units/readability';
import { ringFragmentOps, ringOutputOps } from './units/selection-ring';

export const MATERIAL_MATHS: MaterialMaths = {
  marker: 'rl-material-maths',
  // T3: the node ground (`terrain/mesh.node.ts`).
  ground: { slots: GROUND_SLOTS, slotUniforms, roadDistanceRangeTiles: ROAD_DISTANCE_RANGE_TILES, roadBands, heightBiased, rescaleWeights, macroDecode, macroFactor, groundBlend,
    // T4: the relief read.
    relief: {
      tilt: reliefTiltOps,
      contour: contourFactorOps,
      tintRamp: reliefTintRampOps,
      maxTiltRad: RELIEF_SLOPE_MAX_TILT_RAD,
      contourStrength: RELIEF_CONTOUR_STRENGTH,
      contourWidthPx: RELIEF_CONTOUR_WIDTH_PX,
      tintLow: RELIEF_TINT_LOW,
      tintHigh: RELIEF_TINT_HIGH,
    },
  },
  // T6: the wind's lean (mode 1) and the reduced-motion sway (mode 0), one body (`wind.ts`), and the attribute it reads.
  foliage: { foliageLeanOps, natureAttribute: NATURE_ATTRIBUTE },
  ring: {
    fragmentOps: ringFragmentOps,
    outputOps: ringOutputOps,
    polygonOffsetFactor: DECAL_POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: DECAL_POLYGON_OFFSET_UNITS,
    halfExtraTiles: SELECTION_RING.haloTiles + SELECTION_RING.featherTiles,
  },
  // GH-943 P3 (T1): every P3 slot, null until its task fills it.
  unit: null,
  outline: null,
  banner: null,
  backdrop: null,
  decal: null,
  overlay: null,
  zoneBand: null,
  supplyRoute: null,
  trail: null,
  xray: null,
  particle: null,
  tracer: null,
  vfxMesh: null,
  rimFade: null,
  beam: null,
  rotor: null,
  flipbook: null,
  smokeScreen: null,
};
