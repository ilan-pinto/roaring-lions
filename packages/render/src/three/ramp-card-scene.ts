/**
 * GH-943 WebGPU-primary P1 (T3): the three.js half of the RAMP CARD instrument (`tools/src/golden-diff/ramp-card-page.ts`). It lives
 * here and not in `tools/` because `three` may be imported only under `packages/render/src/three/**` (and `tools/` has no `three`
 * dependency of its own to resolve). Imported by nothing in the shipping bundle; the page imports it through Vite's `/@fs/`.
 *
 * A flat strip of linear-light patches on an orthographic camera, and the legacy renderer set up as `ThreeRenderer.makeGlRenderer`
 * sets it. Presentation only.
 */
import * as THREE from 'three';

export interface RampPatchSpec {
  /** Linear-light RGB. */
  readonly linear: readonly [number, number, number];
  /** Centre in card pixels, y down. */
  readonly x: number;
  readonly y: number;
}

export function buildRampScene(width: number, height: number, patchW: number, patchH: number, patches: readonly RampPatchSpec[]): { scene: THREE.Scene; camera: THREE.OrthographicCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  // y up, origin bottom-left: the card's row 0 is at the TOP.
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -10, 10);
  const geo = new THREE.PlaneGeometry(patchW, patchH);
  for (const p of patches) {
    // Stored linear: `setRGB(..., LinearSRGBColorSpace)` is not converted again by ColorManagement.
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(p.linear[0], p.linear[1], p.linear[2], THREE.LinearSRGBColorSpace) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, height - p.y, 0);
    scene.add(mesh);
  }
  return { scene, camera };
}

/** The shipping legacy renderer's settings (`ThreeRenderer.makeGlRenderer`): sRGB out, ACES at exposure 1.0, DPR 1, `width` x `height`. */
export function makeLegacyRampRenderer(canvas: HTMLCanvasElement, width: number, height: number): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.setPixelRatio(1);
  r.setSize(width, height, false);
  return r;
}
