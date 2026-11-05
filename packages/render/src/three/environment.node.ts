/**
 * GH-943 WebGPU-primary P1 (T6): the NODE twin of `environment.ts`. The same sky (`skyEquirectFloats`, the same CPU gradient),
 * baked by `three/webgpu`'s `PMREMGenerator` instead of `WebGLRenderer`'s, and handed to the same `EnvironmentRegistry`
 * (`NodePmremHost`). The class table (`environment-classes.ts`) stays the one table: nothing here names an intensity.
 *
 * What differs from the legacy bake, and why:
 *  - the generator belongs to the node renderer, so a PMREM made by the WebGL one cannot be used there. The texture is tagged
 *    (`NODE_PMREM_TAG`) so `censusUnported` stops dropping it;
 *  - the registry's toggle is an intensity (0), never `envMap = null`, so no program rebuilds (`EnvironmentRegistry.setEnabled`);
 *  - `scene.environment` is still never set. Per-class `material.envMap` only (see `environment-classes.ts` for why).
 *
 * ADDON-FREE and `three/webgpu`-free at runtime: the generator class is INJECTED by `backend/node-backend.ts`, which loads
 * `three/webgpu` in its own lazy chunk. Presentation only.
 */
import * as THREE from 'three';
import {
  NODE_PMREM_TAG,
  SKY_HEIGHT,
  SKY_WIDTH,
  skyEquirectFloats,
  type EnvironmentBake,
  type NodePmremHost,
  type SkyColors,
} from './environment';

/** The slice of `three/webgpu`'s `PMREMGenerator` this file uses. */
export interface NodePmremGenerator {
  fromEquirectangular(source: THREE.Texture, target: THREE.RenderTarget | null): THREE.RenderTarget;
  dispose(): void;
}
export type NodePmremGeneratorCtor = new (renderer: never) => NodePmremGenerator;

/** CPU sky -> half-float equirect DataTexture, exactly as the legacy bake builds it. */
function skySource(colors: SkyColors): THREE.DataTexture {
  const floats = skyEquirectFloats(colors, SKY_WIDTH, SKY_HEIGHT);
  const half = new Uint16Array(floats.length);
  for (let i = 0; i < floats.length; i++) half[i] = THREE.DataUtils.toHalfFloat(floats[i]);
  const source = new THREE.DataTexture(half, SKY_WIDTH, SKY_HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.NoColorSpace;
  source.magFilter = THREE.LinearFilter;
  source.minFilter = THREE.LinearFilter;
  source.generateMipmaps = false;
  source.needsUpdate = true;
  return source;
}

interface NodeBake extends EnvironmentBake {
  readonly target: THREE.RenderTarget;
  readonly pmrem: NodePmremGenerator;
}

/** The node bake: repaints `previous`'s target when there is one, so the texture's identity never changes (as on legacy). */
export function nodePmremBake(
  Generator: NodePmremGeneratorCtor,
  renderer: unknown,
  colors: SkyColors,
  previous: EnvironmentBake | null
): EnvironmentBake {
  const source = skySource(colors);
  const reuse = previous as NodeBake | null;
  const pmrem = reuse?.pmrem ?? new Generator(renderer as never);
  const target = pmrem.fromEquirectangular(source, reuse?.target ?? null);
  source.dispose();
  (target.texture.userData as Record<string, unknown>)[NODE_PMREM_TAG] = true;
  const bake: NodeBake = {
    texture: target.texture,
    target,
    pmrem,
    dispose() {
      target.dispose();
      pmrem.dispose();
    },
  };
  return bake;
}

/** The host the node backend gives `EnvironmentRegistry.attach`. */
export function createNodePmremHost(Generator: NodePmremGeneratorCtor, renderer: unknown): NodePmremHost {
  return { isNodePmremHost: true, bake: (colors, previous) => nodePmremBake(Generator, renderer, colors, previous) };
}
