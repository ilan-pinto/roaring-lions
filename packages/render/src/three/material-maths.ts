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
import { disturbBendOps, disturbSlotPushOps, DISTURB_MAX } from './terrain/disturb';
import { foliageLeanOps } from './terrain/wind';
import { DECAL_LIGHTS_KEY, DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS, DECAL_WET_DEFINE } from './decal-pool';
import {
  craterGradOps,
  DECAL_PALETTE_ORDER,
  decalAlphaOps,
  decalGroundToneOps,
  decalKindOps,
  decalMultiplierOps,
  decalOutRatioOps,
  decalRimRatioOps,
} from './decal-maths';
import { SELECTION_RING } from './units/readability';
import { ringFragmentOps, ringOutputOps } from './units/selection-ring';
import { teamHookOf, teamMarkOps } from './units/team-mask';
import { RG_MAX_WHEELS, rgBarOps, rgNormalOps, rgPhaseOps, rgVertexOps } from './units/running-gear';
import { RG_TRACK_GEOMETRY_ATTR, RG_WHEEL_GEOMETRY_ATTR, runningGearUniformsOf } from './units/running-gear-material';
import { sootOps } from './world-materials';
import { rimOps, rimUniforms } from './units/rain-rim';
import { floorOps, woundedUniforms } from './units/wounded-read';
import { outlineExpandOps, SILHOUETTE_DEPTH_BIAS_UNIFORM_KEY, SILHOUETTE_EXPAND_ATTRIBUTE, SILHOUETTE_OUTLINE_UNIFORM_KEY } from './units/silhouette';
import { zoneHatchOps } from './units/zone-band';
import { dashOps } from './supply-route-maths';
import { SUPPLY_ROUTE_ALPHA } from './supply-route';
import { xrayBeamOps, xrayCollarOps, xrayFigureOps, xrayRevealOps, xrayScanOps, xrayTubeOps } from './tunnel-xray';

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
  // T6, T7: the wind's lean (mode 1) and the reduced-motion sway (mode 0), one body (`wind.ts`), and the attribute it reads.
  foliage: { foliageLeanOps, natureAttribute: NATURE_ATTRIBUTE, disturbSlotPushOps, disturbBendOps, disturbMax: DISTURB_MAX },
  ring: {
    fragmentOps: ringFragmentOps,
    outputOps: ringOutputOps,
    polygonOffsetFactor: DECAL_POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: DECAL_POLYGON_OFFSET_UNITS,
    halfExtraTiles: SELECTION_RING.haloTiles + SELECTION_RING.featherTiles,
  },
  // GH-943 P3 (T3): the vehicle hooks of the unit twin (`units/unit-material.node.ts`): the team mark, the running gear and the soot.
  // T4: the rain rim (exposure, contrast, rim) and the wounded floor.
  unit: {
    team: { teamMarkOps, teamHookOf },
    rg: {
      rgVertexOps,
      rgNormalOps,
      rgPhaseOps,
      rgBarOps,
      uniformsOf: runningGearUniformsOf,
      maxWheels: RG_MAX_WHEELS,
      wheelAttribute: RG_WHEEL_GEOMETRY_ATTR,
      trackAttribute: RG_TRACK_GEOMETRY_ATTR,
    },
    soot: { sootOps },
    rim: { rimOps, rimUniforms },
    floor: { floorOps, woundedUniforms },
  },
  // GH-943 P3 (T1): every other P3 slot, null until its task fills it.
  // GH-943 P3 (T5): the outline's expansion (rigid and skinned), and the names of its attribute and uniform records.
  outline: { expandOps: outlineExpandOps, expandAttribute: SILHOUETTE_EXPAND_ATTRIBUTE, widthKey: SILHOUETTE_OUTLINE_UNIFORM_KEY, biasKey: SILHOUETTE_DEPTH_BIAS_UNIFORM_KEY },
  banner: null,
  backdrop: null,
  // T7: the decal kinds, the road under them, the albedo ratio and the crater rim (`decal-pool.node.ts`).
  decal: {
    kindOps: decalKindOps,
    alphaOps: decalAlphaOps,
    groundToneOps: decalGroundToneOps,
    multiplierOps: decalMultiplierOps,
    craterGradOps,
    rimRatioOps: decalRimRatioOps,
    outRatioOps: decalOutRatioOps,
    roadRangeTiles: ROAD_DISTANCE_RANGE_TILES,
    paletteSize: DECAL_PALETTE_ORDER.length,
    wetDefine: DECAL_WET_DEFINE,
    lightsKey: DECAL_LIGHTS_KEY,
  },
  overlay: null,
  // T8: the zone band's hatch (`units/zone-band.node.ts`) and the supply route's dash and alpha (`supply-route.node.ts`).
  zoneBand: { hatchOps: zoneHatchOps },
  supplyRoute: { dashOps, alpha: SUPPLY_ROUTE_ALPHA },
  trail: null,
  // T9: the tunnel x-ray's tube, collar, figure and beam (`tunnel-xray.node.ts`).
  xray: { revealOps: xrayRevealOps, scanOps: xrayScanOps, tubeOps: xrayTubeOps, collarOps: xrayCollarOps, figureOps: xrayFigureOps, beamOps: xrayBeamOps },
  particle: null,
  tracer: null,
  vfxMesh: null,
  rimFade: null,
  beam: null,
  rotor: null,
  flipbook: null,
  smokeScreen: null,
};
