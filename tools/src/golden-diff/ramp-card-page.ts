// GH-943 WebGPU-primary P1 (T3): the in-page half of the RAMP CARD (`ramp-card.ts` drives it).
//
// Dynamically imported by a page from the app's own Vite dev server through `/@fs/`. It draws ONE card -- a strip of flat linear-light
// patches, 0..16 in log steps, in three tints -- straight through the real output stage of ONE backend:
//   `legacy`  the shipping `createPostChain` (EffectComposer: RenderPass -> OutputPass with the grade and the vignette folded in)
//   `webgl2`  the node post chain on three's own WebGL2 backend (`createNodeBackend`, forceWebGL)
//   `webgpu`  the node post chain on WebGPU
// with SMAA off (the `low` preset), so a patch centre is the stage's own output and nothing else. The card has no fog, AO or bloom:
// it exists to compare ACES + sRGB + grade + roundTripHalf x vignette + dither, and nothing upstream of them.
//
// The driver photographs the canvas element it makes (`#ramp-card`): the drawing buffer is not preserved (by design), so a readback
// from inside would be black, and the compositor's presented frame is what a player sees.
import { createPostChain } from '../../../packages/render/src/three/post-chain';
import { createNodeBackend } from '../../../packages/render/src/three/backend/node-backend';
import { AO_MATHS, BLOOM_MATHS, OUTPUT_MATHS, READBACK_MATHS } from '../../../packages/render/src/three/output-maths';
import { QUALITY_PRESETS } from '../../../packages/render/src/quality';
import { resolveGrade, type GradeJson } from '../../../packages/render/src/three/grade-maths';
import dusk from '../../../data/grades/dusk.json';
import { buildRampScene, makeLegacyRampRenderer } from '../../../packages/render/src/three/ramp-card-scene';
import { RAMP_LAYOUT, rampPatches } from './ramp-card-layout';

export type RampArm = 'legacy' | 'webgl2' | 'webgpu';

export interface RampRun {
  readonly kind: string;
  readonly adapter: string;
  /** Whether a (dusk) grade was installed. */
  readonly graded: boolean;
}

const rAF = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => res()));

/** Draws the card on `arm` into a fresh `<canvas id="ramp-card">` in the document and resolves once it has been presented. */
export async function drawRampCard(arm: RampArm, graded: boolean): Promise<RampRun> {
  document.body.style.margin = '0';
  document.body.style.background = 'black';
  const { width, height } = RAMP_LAYOUT;
  const { scene, camera } = buildRampScene(width, height, RAMP_LAYOUT.patchW, RAMP_LAYOUT.patchH, rampPatches());
  const grade = graded ? resolveGrade(dusk as GradeJson, 1) : null;
  if (arm === 'legacy') {
    const canvas = document.createElement('canvas');
    canvas.id = 'ramp-card';
    canvas.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
    document.body.appendChild(canvas);
    const r = makeLegacyRampRenderer(canvas, width, height);
    const post = createPostChain(r, scene, camera, width, height, 1, QUALITY_PRESETS.low);
    post.vignette.enabled = true;
    post.grade.apply(grade);
    post.render();
    await rAF();
    post.render();
    await rAF();
    return { kind: 'legacy-gl', adapter: 'webgl2', graded };
  }
  const made = await createNodeBackend({ background: '#000000', forceWebGL: arm === 'webgl2', adapter: 'ramp-card', bloomMaths: BLOOM_MATHS, aoMaths: AO_MATHS, readbackMaths: READBACK_MATHS });
  if ('reason' in made) throw new Error(`ramp card: node backend refused: ${made.reason}`);
  const be = made.backend;
  be.setPixelRatio(1);
  be.setSize(width, height);
  be.domElement.id = 'ramp-card';
  be.domElement.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(be.domElement);
  be.setOutputMaths(OUTPUT_MATHS);
  be.configure({ scene, camera, quality: QUALITY_PRESETS.low });
  const post = be.post;
  if (post === null) throw new Error('ramp card: the node backend built no post chain');
  post.vignette.enabled = true;
  post.grade.apply(grade);
  // A PassNode redraws its scene once per frameId, and frameId advances on the renderer's own frame (webgpu-page.ts): pump across rAFs.
  for (let i = 0; i < 4; i++) {
    be.render(scene, camera);
    await rAF();
  }
  await be.whenSubmitted();
  await rAF();
  return { kind: be.kind, adapter: be.adapter, graded };
}
