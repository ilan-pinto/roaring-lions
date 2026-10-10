/**
 * One contract, asserted against every implementation of it.
 *
 * This runs headless with no WebGL: three.js's camera projection, world
 * matrices and Raycaster are all pure maths and work in environment: 'node'.
 * Only rasterization needs a browser, and that is the golden-image diff, which
 * is a separate check outside `pnpm test`.
 *
 * It runs against `three/camera.ts` (what `Renderer.worldToScreen` answers
 * with) and against `project.ts`'s flat formulas, which three still reads for
 * picking and layout. Those were Pixi's projection until that backend was
 * retired (WP-A3.3); the run stays because the formulas are still live.
 */
import { runProjectionConformance } from './conformance';
import { worldToScreen, screenToWorldFlat } from './project';
import { worldToScreenThree, screenToWorldThree } from './three/camera';

runProjectionConformance('project.ts (the flat formulas three/camera.ts reads)', {
  worldToScreen,
  screenToWorld: screenToWorldFlat,
});

runProjectionConformance('ThreeRenderer (three/camera.ts)', {
  worldToScreen: worldToScreenThree,
  screenToWorld: screenToWorldThree,
});
