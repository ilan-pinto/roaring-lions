/**
 * GH-1225 x GH-1197 P4: the ONE discard mask a clone-drawn building's shadow and AO G-buffer draw through.
 *
 * A building's colour clone discards on its holes (`rl-holes`) and on the roof cut (`rl-cut`). The sun's shadow map reads the
 * mesh's `customDepthMaterial`, and the AO pre-pass draws its G-buffer through `scene.overrideMaterial` (so it reads neither):
 * both must discard on exactly the same fragments as the colour, or a hole draws open in colour and shut in depth. A mask is
 * the colour hook's DISCARD terms alone, spliced in the same order (holes, then cut) with the same pars text, over the same
 * uniforms by reference, and no colour splice.
 *
 * Anchored on `void main() {` and `#include <project_vertex>` alone, because r186's `ShaderLib.normal` fragment (the AO's
 * G-buffer material) holds no `#include <common>`. One term reproduces slice 2's `cutMaskHook` byte for byte.
 */
import * as THREE from 'three';

/** One discard term: the world-position varying it reads, its declarations (the colour hook's own pars text), and its call. */
export interface MaskTerm {
  readonly varying: string;
  readonly pars: string;
  readonly call: string;
}

/** The mask hook as a pure function of a program's text: every term's varying, pars and call, in order, at the top of main. */
export function maskHook(vertex: string, fragment: string, terms: readonly MaskTerm[]): { vertex: string; fragment: string } {
  const main = /void main\(\)\s*\{/;
  if (!vertex.includes('#include <project_vertex>')) throw new Error('mask hook: program no longer holds "#include <project_vertex>"');
  if (!main.test(vertex) || !main.test(fragment)) throw new Error('mask hook: program no longer holds "void main() {"');
  const decl = terms.map((t) => `varying vec3 ${t.varying};\n`).join('');
  const write = terms.map((t) => `\n  ${t.varying} = (modelMatrix * vec4(transformed, 1.0)).xyz;`).join('');
  const pars = terms.map((t) => `${t.pars}\n`).join('');
  const calls = terms.map((t) => `\n  ${t.call}`).join('');
  return {
    vertex: vertex.replace(main, (m) => `${decl}${m}`).replace('#include <project_vertex>', `#include <project_vertex>${write}`),
    fragment: fragment.replace(main, (m) => `${pars}${m}${calls}`),
  };
}

/**
 * A mask pair over `uniforms` (bound BY REFERENCE, so one write moves the colour clone and its mask together):
 *
 * - `depth`: the shadow caster, built exactly as r186's stock `_depthMaterial` (`new MeshDepthMaterial()`, basic packing),
 *   so the uncut walls cast the shadow they did. The shadow map writes its `side` from the mesh's material.
 * - `ao`: the AO G-buffer's normal material, built as `GTAOPass`'s own (`MeshNormalMaterial`, `NoBlending`), double-sided like
 *   the clone, and `allowOverride = false` so the pre-pass's `scene.overrideMaterial` leaves it in place.
 */
export interface MaskMaterials {
  readonly depth: THREE.MeshDepthMaterial;
  readonly ao: THREE.MeshNormalMaterial;
}

function hooked<M extends THREE.Material>(material: M, uniforms: Readonly<Record<string, { value: unknown }>>, terms: readonly MaskTerm[], key: string): M {
  material.userData = { ...material.userData, rlCutMask: true };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const out = maskHook(shader.vertexShader, shader.fragmentShader, terms);
    shader.vertexShader = out.vertex;
    shader.fragmentShader = out.fragment;
  };
  material.customProgramCacheKey = () => key;
  return material;
}

export function createMaskMaterials(uniforms: Readonly<Record<string, { value: unknown }>>, terms: readonly MaskTerm[], key: string): MaskMaterials {
  const depth = hooked(new THREE.MeshDepthMaterial(), uniforms, terms, key);
  const ao = hooked(new THREE.MeshNormalMaterial(), uniforms, terms, key);
  ao.blending = THREE.NoBlending;
  ao.side = THREE.DoubleSide;
  ao.allowOverride = false;
  return { depth, ao };
}
