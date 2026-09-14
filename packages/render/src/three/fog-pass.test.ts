/**
 * Task 10, spec 5-6: the depth-reading half of fog of war. Constructing the
 * pass builds a `ShaderMaterial` and a `FullScreenQuad` -- both plain JS
 * objects until something renders them -- so the constants, the uniform
 * plumbing and the shader SOURCE are all reachable headless. What the shader
 * actually paints is the browser check in this task's own report; what this
 * file pins is that the source still does the two things the whole design
 * rests on: reconstruct world XZ from depth, and leave the clear colour
 * alone.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FogOfWarPass, FOG_NEVER_SEEN, FOG_EXPLORED, FOG_TINT_HEX } from './fog-pass';
import { hexToLinear } from './terrain/shared';

describe('FogOfWarPass', () => {
  it('carries the spec constants as uniforms and the tint as a LINEAR colour', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 48, 48);
    expect(FOG_NEVER_SEEN).toBe(0.85);
    expect(FOG_EXPLORED).toBe(0.4);
    expect(pass.uniforms.uNeverSeen.value).toBe(FOG_NEVER_SEEN);
    expect(pass.uniforms.uExplored.value).toBe(FOG_EXPLORED);
    expect(pass.uniforms.uMapSize.value.toArray()).toEqual([48, 48]);
    const [r] = hexToLinear(FOG_TINT_HEX);
    expect((pass.uniforms.uTint.value as THREE.Vector3).x).toBeCloseTo(r, 6);
    expect(pass.needsSwap).toBe(true);
  });

  it('updateCamera copies the inverse projection and world matrix', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    const cam = new THREE.OrthographicCamera(-2, 2, 1, -1, 1, 10);
    cam.position.set(3, 4, 5);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    pass.updateCamera(cam);
    expect((pass.uniforms.uInvProjection.value as THREE.Matrix4).toArray()).toEqual(
      cam.projectionMatrixInverse.toArray()
    );
    expect((pass.uniforms.uCameraWorld.value as THREE.Matrix4).toArray()).toEqual(cam.matrixWorld.toArray());
  });

  it('shader reconstructs world XZ from depth and skips the clear colour', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    const frag = pass.material.fragmentShader;
    expect(frag).toContain('if (depth >= 1.0)');
    expect(frag).toContain('uInvProjection * clip');
    expect(frag).toContain('uCameraWorld * view');
    expect(frag).toContain('world.x / uMapSize.x, world.z / uMapSize.y');
  });
});
