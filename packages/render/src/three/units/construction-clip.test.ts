import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachConstructionClip, constructionClipY, disposeConstructionClip } from './construction-clip';

describe('constructionClipY', () => {
  it('clips at 0.3 x height at progress 0.3, above the ground it stands on', () => {
    expect(constructionClipY(0.3, 4, 0)).toBeCloseTo(1.2, 10);
    expect(constructionClipY(0.5, 4, 2)).toBeCloseTo(4, 10);
  });
  it('is no clip at all once complete', () => {
    expect(constructionClipY(1, 4, 0)).toBeNull();
    expect(constructionClipY(1.2, 4, 0)).toBeNull();
  });
  it('clamps a negative progress to the ground', () => {
    expect(constructionClipY(-0.2, 4, 1)).toBe(1);
  });
});

describe('attachConstructionClip', () => {
  function site(): THREE.Object3D {
    const root = new THREE.Group();
    const shared = new THREE.MeshStandardMaterial();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
    return root;
  }
  it('keeps a point below the plane and drops one above it', () => {
    const clip = attachConstructionClip(site(), 1.2);
    // three discards a fragment whose signed distance is negative.
    expect(clip.plane.distanceToPoint(new THREE.Vector3(0, 1.0, 0))).toBeGreaterThan(0);
    expect(clip.plane.distanceToPoint(new THREE.Vector3(0, 1.5, 0))).toBeLessThan(0);
  });
  it('gives each instance its own clones, and leaves the shared material unclipped', () => {
    const a = site();
    const b = site();
    const ca = attachConstructionClip(a, 1);
    const cb = attachConstructionClip(b, 2);
    const mats = (r: THREE.Object3D) => {
      const out: THREE.Material[] = [];
      r.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) out.push((o as THREE.Mesh).material as THREE.Material);
      });
      return out;
    };
    expect(mats(a)[0]).not.toBe(mats(b)[0]);
    expect(mats(a)[0].clippingPlanes).toEqual([ca.plane]);
    expect(mats(b)[0].clippingPlanes).toEqual([cb.plane]);
    expect(ca.plane.constant).toBe(1);
    expect(cb.plane.constant).toBe(2);
    expect(mats(a)[0].clipShadows).toBe(true);
  });
  it('disposes every clone it made', () => {
    const clip = attachConstructionClip(site(), 1);
    let n = 0;
    for (const m of clip.materials) m.addEventListener('dispose', () => n++);
    disposeConstructionClip(clip);
    expect(n).toBe(2);
  });
});
