/**
 * GH-943 P0: the zero-unported census on the node backend.
 *
 * The node backend (WebGPURenderer) cannot run GLSL. A material carrying an `onBeforeCompile` splice draws as its stock self,
 * and a `ShaderMaterial` draws as an empty node material. Neither may happen silently, so every one is counted and named, and
 * the harness reads the full list (`Renderer.unportedHooks()`). In P0 the gate that wants the list EMPTY is report-only; each of
 * P1-P5 shrinks it, and the eslint ratchet (`lint/glsl-ratchet.ts`) keeps ported files from growing it back.
 *
 * Mutates the scene in exactly three ways, all only meaningful because the node backend cannot draw the thing: a `ShaderMaterial`
 * object is hidden, a `HIDE_WITHOUT_HOOK` object is hidden, and a render-target `envMap` (the L1 PMREM, which belongs to the
 * WebGLRenderer's context) is dropped. Copied from the L5 spike (`spike/webgpu-trial-gate.ts`).
 */
import * as THREE from 'three';
import { NODE_PMREM_TAG } from '../environment.node';

export type UnportedKind = 'shader-material' | 'on-before-compile' | 'env-map' | 'image-release' | 'partial';

export interface UnportedHook {
  readonly kind: UnportedKind;
  /** A name a reader can grep: the material's `name`, its `customProgramCacheKey()`, else the first object's name. A `partial`
   *  hook's key is the term itself, as its twin declares it (`rl-ground: wet terms`). */
  readonly key: string;
  /** How many scene objects carry it. */
  objects: number;
}

/** Hooked materials that draw WRONG (not just plainer) without their hook, so the node backend hides them. */
export const HIDE_WITHOUT_HOOK: ReadonlySet<string> = new Set(['rl-silhouette-outline']);

/**
 * GH-943 P2 (T1): the legacy material keys (as `censusUnported` names them) that have a node twin. Each port task APPENDS its key
 * in the PR that lands the twin (T3 the ground, T5 the ring, T6 the foliage). Read ONLY through the explicit `portedKeys` option
 * of `censusUnported`, which only `matchNodeStatements` (`tools/src/golden-diff/capture-protocol.ts`) passes, on the LEGACY
 * scene: there a listed key is drawn by legacy because node now draws it too, so it is neither hidden nor reported, and the parity
 * ratio of a ported layer measures something. The node backend's own census never passes it, so on node a legacy material that
 * escaped adoption is still hidden and named whatever list it is on: an adoption bug stays loud.
 */
export const PORTED_MATERIAL_KEYS: ReadonlySet<string> = new Set<string>([
  // T3: the ground (`terrain/mesh.node.ts`). The wet keys (`rl-ground-wet*`) stay off the list: node draws them dry (P4).
  'rl-ground',
  // GH-943 P2 (T5): the selection, team and wound rings (all three styles share the one material name).
  'rl-selection-ring',
]);

/** `userData` key on a node twin: the terms of its legacy material it does NOT draw (`['rl-ground: wet terms']`). */
export const UNPORTED_TERMS_KEY = 'rlUnportedTerms';

export interface CensusOptions {
  /** Legacy keys to leave visible and unreported (the L-matched arm only; see `PORTED_MATERIAL_KEYS`). Absent: none. */
  readonly portedKeys?: ReadonlySet<string>;
}

const STOCK_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile;
/** `Material.customProgramCacheKey()` of a material with no hook: the stock callback's own text, the same for every one of them. */
const STOCK_PROGRAM_KEY = String(STOCK_ON_BEFORE_COMPILE);

interface DrawLike extends THREE.Object3D {
  material?: THREE.Material | THREE.Material[];
}

function materialKey(m: THREE.Material, o: THREE.Object3D): string {
  let cache: string;
  try {
    cache = m.customProgramCacheKey();
  } catch {
    cache = '';
  }
  // `ShaderMaterial.customProgramCacheKey()` is the hook's own source text: never a usable name. Nor is the STOCK text (every
  // unnamed ShaderMaterial shares it, so a key list naming it would cover all of them): those fall through to the object's name.
  return m.name || (cache.length <= 60 && cache !== STOCK_PROGRAM_KEY ? cache : '') || o.name || o.parent?.name || m.type;
}

/**
 * Walks `root` and reports every GLSL-only feature the WebGPU path cannot honour. Mutates the scene in
 * exactly two ways, both only meaningful because the WebGL path has stopped drawing it: a `ShaderMaterial`
 * object is hidden (`visible = false`: an unconvertible material would otherwise draw as an empty node
 * material), and a render-target `envMap` (the L1 PMREM, which belongs to the WebGL context) is dropped.
 * An `onBeforeCompile` hook is left in place: the material draws as its stock self, and the report names it.
 *
 * GH-943 P2 (T1): a node twin that draws only part of its legacy material lists the rest in `userData.rlUnportedTerms`, and each
 * term is reported as a `partial` hook. `opts.portedKeys` (OFF by default; see `PORTED_MATERIAL_KEYS`) exempts listed legacy keys.
 */
export function censusUnported(root: THREE.Object3D, opts: CensusOptions = {}): UnportedHook[] {
  const ported = opts.portedKeys;
  const found = new Map<string, UnportedHook>();
  const note = (kind: UnportedKind, key: string): void => {
    const id = `${kind}|${key}`;
    const hit = found.get(id);
    if (hit) hit.objects++;
    else found.set(id, { kind, key, objects: 1 });
  };
  root.traverse((o) => {
    const mat = (o as DrawLike).material;
    if (!mat) return;
    const list = Array.isArray(mat) ? mat : [mat];
    for (const m of list) {
      const terms = (m.userData as Record<string, unknown>)[UNPORTED_TERMS_KEY];
      if (Array.isArray(terms)) for (const t of terms) if (typeof t === 'string') note('partial', t);
      if ((m as THREE.ShaderMaterial).isShaderMaterial === true) {
        const key = materialKey(m, o);
        if (ported?.has(key) === true) continue;
        note('shader-material', key);
        o.visible = false;
        continue;
      }
      if (m.onBeforeCompile !== STOCK_ON_BEFORE_COMPILE) {
        const key = materialKey(m, o);
        if (ported?.has(key) !== true) {
          note('on-before-compile', key);
          // The occlusion outline is a depth-fail trick in GLSL; as a stock material it would paint every unit a flat colour.
          if (HIDE_WITHOUT_HOOK.has(key)) o.visible = false;
        }
      }
      // GLB bitmaps are closed after their first upload (`units/gltf-loader.ts`); WebGPU uploads more than once and would
      // draw them black. Already-armed textures are disarmed here while their bitmap is still open.
      for (const v of Object.values(m)) {
        const t = v as THREE.Texture | null;
        const img = t && t.isTexture === true ? (t.image as { close?: unknown; width?: number } | null) : null;
        if (t && img && typeof img.close === 'function' && (img.width ?? 0) > 0 && t.onUpdate !== null) {
          t.onUpdate = null;
          note('image-release', materialKey(m, o));
        }
      }
      const env = (m as THREE.MeshStandardMaterial).envMap;
      // A PMREM baked BY the node renderer (`environment.node.ts`, tagged) is valid here; only the WebGLRenderer's is dropped.
      if (
        env &&
        (env as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true &&
        (env.userData as Record<string, unknown>)[NODE_PMREM_TAG] !== true
      ) {
        note('env-map', materialKey(m, o));
        (m as THREE.MeshStandardMaterial).envMap = null;
      }
    }
  });
  return [...found.values()].sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : 1));
}

/** One warning line per hook, in the shape a log reader greps for: `[lions] UNPORTED ...`. */
export function unportedWarnings(hooks: readonly UnportedHook[], seen: Set<string>): string[] {
  const out: string[] = [];
  for (const h of hooks) {
    const id = `${h.kind}|${h.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const what =
      h.kind === 'shader-material'
        ? 'ShaderMaterial has no TSL port on the node backend: the object is HIDDEN'
        : h.kind === 'on-before-compile'
          ? 'onBeforeCompile GLSL has no TSL port on the node backend: it draws as the stock material WITHOUT the hook'
          : h.kind === 'image-release'
            ? 'the load-time bitmap release after first upload is WebGL-only (WebGPU uploads twice): DISARMED'
            : h.kind === 'partial'
              ? 'the node twin draws its material WITHOUT this term'
              : 'render-target envMap belongs to the WebGL context: DROPPED';
    out.push(`[lions] UNPORTED ${h.kind} "${h.key}" (${h.objects} object${h.objects === 1 ? '' : 's'}): ${what}`);
  }
  return out;
}
