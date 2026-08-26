/**
 * One contract, asserted against every implementation of it.
 *
 * This runs headless with no WebGL: three.js's camera projection, world
 * matrices and Raycaster are all pure maths and work in environment: 'node'.
 * Only rasterization needs a browser, and that is the golden-image diff, which
 * is a separate check outside `pnpm test`.
 *
 * The value here is asymmetric. Running it against PixiRenderer's projection
 * proves the suite describes something real; running it against ThreeRenderer's
 * proves the second backend has not drifted. A suite written against only one
 * implementation would pass forever while the two diverged.
 */
import { runProjectionConformance } from './conformance';
import { worldToScreen, screenToWorldFlat } from './project';
import { worldToScreenThree, screenToWorldThree } from './three/camera';

runProjectionConformance('PixiRenderer (project.ts)', {
  worldToScreen,
  screenToWorld: screenToWorldFlat,
});

runProjectionConformance('ThreeRenderer (three/camera.ts)', {
  worldToScreen: worldToScreenThree,
  screenToWorld: screenToWorldThree,
});
