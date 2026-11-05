/**
 * GH-943 L5, option (b): the WebGPU trial's decisions that need no GPU.
 *
 * Presentation only, sandbox only, and OFF unless `RendererOptions.gpuTrial` is set. This file holds the
 * two things a unit test can falsify without a browser:
 *
 *  - `probeWebGpu`: is a real WebGPU adapter there? A page without `navigator.gpu`, with no adapter,
 *    or whose adapter request throws, gets a reason string and the renderer stays on WebGL2. WebGPURenderer
 *    would otherwise fall back to ITS OWN WebGL2 backend without saying so, which is a different renderer
 *    from the shipping one and would make the trial measure the wrong thing.
 *  - `censusUnported`: the trial does not port GLSL. A material carrying an `onBeforeCompile` splice would
 *    simply draw without it, and a `ShaderMaterial` would draw as an empty node material. Neither may happen
 *    silently, so every one is counted, named and (for the ShaderMaterial) hidden, and the caller warns.
 */
import * as THREE from 'three';

/** The slice of `navigator` the probe reads. Structural, so a test passes a literal. */
export interface GpuNavigatorLike {
  readonly gpu?: {
    requestAdapter(): Promise<GpuAdapterLike | null>;
  };
}

export interface GpuAdapterLike {
  readonly info?: { readonly vendor?: string; readonly architecture?: string; readonly device?: string; readonly description?: string };
  readonly isFallbackAdapter?: boolean;
}

export type WebGpuProbe =
  | { readonly ok: true; readonly adapter: string; readonly fallbackAdapter: boolean }
  | { readonly ok: false; readonly reason: string };

/** Asks the browser for a WebGPU adapter. Never throws. */
export async function probeWebGpu(nav: GpuNavigatorLike | undefined): Promise<WebGpuProbe> {
  if (!nav || !nav.gpu) return { ok: false, reason: 'navigator.gpu is absent (this browser or context has no WebGPU)' };
  let adapter: GpuAdapterLike | null;
  try {
    adapter = await nav.gpu.requestAdapter();
  } catch (e) {
    return { ok: false, reason: `requestAdapter() threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!adapter) return { ok: false, reason: 'requestAdapter() returned no adapter' };
  const i = adapter.info;
  const name = i ? [i.vendor, i.architecture, i.device, i.description].filter((s) => s !== undefined && s !== '').join(' / ') : 'unknown';
  return { ok: true, adapter: name || 'unknown', fallbackAdapter: adapter.isFallbackAdapter === true };
}

export type UnportedKind = 'shader-material' | 'on-before-compile' | 'env-map';

export interface UnportedHook {
  readonly kind: UnportedKind;
  /** A name a reader can grep: the material's `name`, its `customProgramCacheKey()`, else the first object's name. */
  readonly key: string;
  /** How many scene objects carry it. */
  objects: number;
}

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
  return m.name || cache || o.name || m.type;
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
      if (m.onBeforeCompile !== STOCK_ON_BEFORE_COMPILE) note('on-before-compile', materialKey(m, o));
      const env = (m as THREE.MeshStandardMaterial).envMap;
      if (env && (env as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true) {
        note('env-map', materialKey(m, o));
        (m as THREE.MeshStandardMaterial).envMap = null;
      }
    }
  });
  return [...found.values()].sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : 1));
}

/** One warning line per hook, in the shape a log reader greps for: `[webgpu-trial] UNPORTED ...`. */
export function unportedWarnings(hooks: readonly UnportedHook[], seen: Set<string>): string[] {
  const out: string[] = [];
  for (const h of hooks) {
    const id = `${h.kind}|${h.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const what =
      h.kind === 'shader-material'
        ? 'ShaderMaterial has no TSL port in the trial: the object is HIDDEN'
        : h.kind === 'on-before-compile'
          ? 'onBeforeCompile GLSL has no TSL port in the trial: it draws as the stock material WITHOUT the hook'
          : 'render-target envMap belongs to the WebGL context: DROPPED';
    out.push(`[webgpu-trial] UNPORTED ${h.kind} "${h.key}" (${h.objects} object${h.objects === 1 ? '' : 's'}): ${what}`);
  }
  return out;
}
