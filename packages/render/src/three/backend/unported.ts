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

export type UnportedKind = 'shader-material' | 'on-before-compile' | 'env-map' | 'image-release';

export interface UnportedHook {
  readonly kind: UnportedKind;
  /** A name a reader can grep: the material's `name`, its `customProgramCacheKey()`, else the first object's name. */
  readonly key: string;
  /** How many scene objects carry it. */
  objects: number;
}

/** Hooked materials that draw WRONG (not just plainer) without their hook, so the node backend hides them. */
export const HIDE_WITHOUT_HOOK: ReadonlySet<string> = new Set(['rl-silhouette-outline']);

const STOCK_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile;

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
  // `ShaderMaterial.customProgramCacheKey()` is the hook's own source text: never a usable name.
  return m.name || (cache.length <= 60 ? cache : '') || o.name || o.parent?.name || m.type;
}

/**
 * Walks `root` and reports every GLSL-only feature the WebGPU path cannot honour. Mutates the scene in
 * exactly two ways, both only meaningful because the WebGL path has stopped drawing it: a `ShaderMaterial`
 * object is hidden (`visible = false`: an unconvertible material would otherwise draw as an empty node
 * material), and a render-target `envMap` (the L1 PMREM, which belongs to the WebGL context) is dropped.
 * An `onBeforeCompile` hook is left in place: the material draws as its stock self, and the report names it.
 */
export function censusUnported(root: THREE.Object3D): UnportedHook[] {
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
      if ((m as THREE.ShaderMaterial).isShaderMaterial === true) {
        note('shader-material', materialKey(m, o));
        o.visible = false;
        continue;
      }
      if (m.onBeforeCompile !== STOCK_ON_BEFORE_COMPILE) {
        note('on-before-compile', materialKey(m, o));
        // The occlusion outline is a depth-fail trick in GLSL; as a stock material it would paint every unit a flat colour.
        if (HIDE_WITHOUT_HOOK.has(materialKey(m, o))) o.visible = false;
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
      if (env && (env as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true) {
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
            : 'render-target envMap belongs to the WebGL context: DROPPED';
    out.push(`[lions] UNPORTED ${h.kind} "${h.key}" (${h.objects} object${h.objects === 1 ? '' : 's'}): ${what}`);
  }
  return out;
}
