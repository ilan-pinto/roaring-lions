/**
 * GH-943 WebGPU P3 (T11, T12): the kit slots for the FX families (T12: the flipbook and the smoke screen), in ONE place. `backend/node-backend.ts` spreads this into its
 * `MaterialKit`, and the specs build the same factories, so the wiring (which twin a slot makes, from which maths, and the `markTwin`
 * record) is pinned once. A factory receives the LEGACY material (the object that keeps the uniform record) and returns its twin.
 *
 * ADDON-FREE. TSL arrives injected.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import type { MaterialKit, MaterialMaths } from '../backend/backend';
import { markTwin } from '../twin-identity';
import { createNodeParticleMaterial, createNodeTracerMaterial, type FxTsl, type HasUniforms } from './fx.node';
import { createNodeVfxMeshMaterial } from './vfx-mesh-material.node';
import { createNodeRimFadeMaterial, rimFadeOptionsFor } from './rim-fade.node';
import { createNodeBeamMaterial } from './beam-batch.node';
import { createNodeRotorMaterial } from './swarm-batch.node';
import { createNodeFlipbookMaterial, FLIPBOOK_FIRE_LEGACY_NAME } from './flipbook-fx.node';
import { createNodeSmokeScreenMaterial } from '../smoke-mesh.node';
import type { VfxDetail } from './vfx-noise';

export type FxKitSlots = Pick<MaterialKit, 'particle' | 'tracer' | 'vfxMesh' | 'rimFade' | 'beam' | 'rotor' | 'flipbook' | 'smokeScreen'>;

/** The smoke screen's `FX_DETAIL` define (the quality preset's `fxDetail`, compiled into the legacy program), 2 when absent. */
export function fxDetailOf(legacy: THREE.Material): VfxDetail {
  const d = (legacy as THREE.Material & { defines?: Record<string, unknown> }).defines?.FX_DETAIL;
  return d === 0 || d === 1 ? d : 2;
}

export function fxTwinFactories(deps: { readonly W: typeof WEBGPU; readonly TSL: FxTsl; readonly maths: MaterialMaths }): FxKitSlots {
  const { W, TSL, maths } = deps;
  const base = { W, TSL };
  const named = <T extends THREE.Material>(twin: T, legacy: THREE.Material): T => {
    markTwin(twin, legacy);
    return twin;
  };
  // Every twin names its legacy material (`markTwin`); adoption copies the legacy pipeline state onto it (`copyRenderState`).
  return {
    particle: (legacy) => named(createNodeParticleMaterial({ ...base, maths: maths.particle }, legacy), legacy),
    tracer: (legacy) => named(createNodeTracerMaterial({ ...base, maths: null }, legacy as HasUniforms), legacy),
    vfxMesh: (legacy) => named(createNodeVfxMeshMaterial({ ...base, maths: null }, legacy as HasUniforms), legacy),
    rimFade: (legacy) =>
      named(createNodeRimFadeMaterial({ ...base, maths: maths.rimFade }, legacy as HasUniforms, rimFadeOptionsFor(W, legacy.name)), legacy),
    beam: (legacy) => named(createNodeBeamMaterial({ ...base, maths: maths.beam }), legacy),
    rotor: (legacy) => named(createNodeRotorMaterial({ ...base, maths: maths.rotor }, legacy as HasUniforms), legacy),
    // GH-943 P3 (T12): the flipbook's two passes (one recipe, the pass by the legacy name) and the smoke screen at its own detail.
    flipbook: (legacy) =>
      named(createNodeFlipbookMaterial({ ...base, maths: maths.flipbook }, legacy as HasUniforms, legacy.name === FLIPBOOK_FIRE_LEGACY_NAME ? 'fire' : 'smoke'), legacy),
    smokeScreen: (legacy) => named(createNodeSmokeScreenMaterial({ ...base, maths: maths.smokeScreen }, legacy as HasUniforms, fxDetailOf(legacy)), legacy),
  };
}
