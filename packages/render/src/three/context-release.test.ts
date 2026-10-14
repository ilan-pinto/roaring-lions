import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  disposeAndReleaseContext,
  forgetSharedTexturesForTest,
  noteSharedTextures,
  sharedDfgLutForTest,
} from './context-release';

/**
 * A stand-in renderer with the four members the release touches, plus the
 * `properties` map three keeps per material -- whose `uniforms.dfgLUT` is
 * where three r181+ puts its shared DFG lookup texture once a physical
 * material has been drawn.
 */
function fakeRenderer(lut: THREE.Texture | null, drawn: THREE.Material[], calls: string[]) {
  const context = { lost: false, isContextLost: () => context.lost };
  return {
    properties: {
      get: (object: object) => (drawn.includes(object as THREE.Material) && lut ? { uniforms: { dfgLUT: { value: lut } } } : {}),
    },
    dispose: () => calls.push('dispose'),
    getContext: () => context,
    forceContextLoss: () => {
      calls.push('forceContextLoss');
      context.lost = true;
    },
  };
}

/** The listener three's `WebGLTextures` hangs on every texture it uploads --
 *  the closure that kept a released renderer reachable from the shared LUT. */
function hangRendererListener(lut: THREE.Texture, calls: string[]): () => void {
  const onTextureDispose = (): void => {
    calls.push('lut listener');
    lut.removeEventListener('dispose', onTextureDispose);
  };
  lut.addEventListener('dispose', onTextureDispose);
  return onTextureDispose;
}

afterEach(() => forgetSharedTexturesForTest());

describe('disposeAndReleaseContext and three r186 shared DFG LUT', () => {
  it('takes a released renderer off the shared DFG LUT, while its context is still live', () => {
    const lut = new THREE.DataTexture(new Uint16Array(16 * 16 * 2), 16, 16, THREE.RGFormat, THREE.HalfFloatType);
    lut.name = 'DFG_LUT';
    const material = new THREE.MeshStandardMaterial();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    const calls: string[] = [];
    const renderer = fakeRenderer(lut, [material], calls);
    const listener = hangRendererListener(lut, calls);

    noteSharedTextures(renderer, scene);
    expect(sharedDfgLutForTest()).toBe(lut);
    expect(disposeAndReleaseContext(renderer as never)).toBe(true);

    // The listener ran (so it is off the texture), and before the renderer
    // let go of its context -- a GL delete needs a live one.
    expect(calls).toEqual(['lut listener', 'dispose', 'forceContextLoss']);
    expect(lut.hasEventListener('dispose', listener)).toBe(false);
  });

  it('finds nothing on a renderer with no properties, or a scene with no drawn physical material', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    noteSharedTextures({}, scene);
    noteSharedTextures(fakeRenderer(null, [], []), scene);
    noteSharedTextures(fakeRenderer(null, [], []), null);
    expect(sharedDfgLutForTest()).toBeNull();
    const calls: string[] = [];
    expect(disposeAndReleaseContext(fakeRenderer(null, [], calls) as never)).toBe(true);
    expect(calls).toEqual(['dispose', 'forceContextLoss']);
  });
});
