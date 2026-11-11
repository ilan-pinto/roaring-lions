/**
 * GH-943 P3 (T14b, GH-1152) G2d: one world-matrix walk per node frame (F8, `matrix-walk.ts`), on a fake renderer shaped like three's
 * (`render` walks the scene when `matrixWorldAutoUpdate` is set, and the scene pass renders the shadow map NESTED inside itself), over
 * a real `THREE.Scene`.
 *
 * Falsification (run by hand, in the commit message): in the wrapper, drop the `walked.has(scene)` guard (`if (!once || true)`): the
 * scene is walked twice a frame and the first spec goes red.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { installMatrixWalk, type WalkRendererLike } from './matrix-walk';

interface Rig {
  r: WalkRendererLike;
  scene: THREE.Scene;
  shadowCam: THREE.Camera;
  mainCam: THREE.Camera;
  walks: () => number;
  /** The matrix each shadow render read for `probe`. */
  shadowRead: number[];
  probe: THREE.Mesh;
}

function rig(): Rig {
  const scene = new THREE.Scene();
  const probe = new THREE.Mesh();
  scene.add(probe);
  const mainCam = new THREE.OrthographicCamera();
  const shadowCam = new THREE.OrthographicCamera();
  const walk = vi.spyOn(scene, 'updateMatrixWorld');
  const shadowRead: number[] = [];
  const r: WalkRendererLike = {
    render(object, camera) {
      const s = object as THREE.Scene;
      if (s.matrixWorldAutoUpdate === true) s.updateMatrixWorld();
      if (camera === mainCam) {
        // The outer pass: the objects' own onBeforeRender, then the shadow map nested inside (`ShadowNode.renderShadow`).
        probe.onBeforeRender(undefined as never, s, camera as THREE.Camera, probe.geometry, probe.material as THREE.Material, null as never);
        r.render(s, shadowCam);
      } else {
        shadowRead.push(probe.matrixWorld.elements[12] as number);
      }
      return undefined;
    },
  };
  return { r, scene, shadowCam, mainCam, walks: () => walk.mock.calls.length, shadowRead, probe };
}

describe('G2d: one world-matrix walk per frame', () => {
  it("'once': the nested shadow render does not walk the scene again, and the flag is restored", () => {
    const g = rig();
    const w = installMatrixWalk(g.r, true);
    w.run(() => g.r.render(g.scene, g.mainCam));
    expect(g.walks()).toBe(1);
    expect(g.scene.matrixWorldAutoUpdate).toBe(true);
    expect(w.takeSkipped()).toBe(1);
    // A second frame walks again (once per FRAME, not once ever).
    w.run(() => g.r.render(g.scene, g.mainCam));
    expect(g.walks()).toBe(2);
  });

  it("'every-pass' is three's own: two walks a frame", () => {
    const g = rig();
    const w = installMatrixWalk(g.r, false);
    w.run(() => g.r.render(g.scene, g.mainCam));
    expect(g.walks()).toBe(2);
    expect(w.takeSkipped()).toBe(0);
  });

  it('a render outside a frame (a photograph, a capture) is never touched', () => {
    const g = rig();
    installMatrixWalk(g.r, true);
    g.r.render(g.scene, g.mainCam);
    expect(g.walks()).toBe(2);
  });

  it('an onBeforeRender that moves its object and updates its own matrix reaches the shadow pass with the new matrix', () => {
    const g = rig();
    let x = 0;
    g.probe.onBeforeRender = () => {
      x += 2;
      g.probe.position.x = x;
      g.probe.updateMatrixWorld();
    };
    const w = installMatrixWalk(g.r, true);
    w.run(() => g.r.render(g.scene, g.mainCam));
    w.run(() => g.r.render(g.scene, g.mainCam));
    expect(g.shadowRead).toEqual([2, 4]);
  });

  it('dispose puts render back', () => {
    const g = rig();
    const orig = g.r.render;
    const w = installMatrixWalk(g.r, true);
    expect(g.r.render).not.toBe(orig);
    w.dispose();
    expect(g.r.render).toBe(orig);
  });
});
