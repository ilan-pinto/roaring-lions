// GH-943 WebGPU-primary migration, P0: the visual gate's backend vocabulary.
//
// The gate captures one scene through one of three renderers (`--gpu=`): the shipping `legacy` WebGLRenderer, the node backend on
// its own WebGL2 (`webgl2`, key term `wgl2`), or the node backend on WebGPU (`webgpu`, key term `wgpu`). Dependency-free, so
// `baseline.ts` (and `baseline.test.ts`, which runs without playwright) can import it.
//
// THE BACKEND COMES FROM THE PAGE, never from the URL we asked for: `backendInfo()` is read in the capture script, and a page that
// drew through a different backend than the arm asked for is REFUSED (exit 2). A fallback is evidence about the fallback.

export type GpuArm = 'legacy' | 'webgl2' | 'webgpu';
export const GPU_ARMS: readonly GpuArm[] = ['legacy', 'webgl2', 'webgpu'];

/** The kinds `ThreeRenderer.backendInfo()` reports (`packages/render/src/gpu.ts`; tools may not import @lions/render, a test pins the copy). */
export type BackendKind = 'legacy-gl' | 'node-webgl2' | 'node-webgpu';

/** What `backendInfo()` returned in the page, as the capture script serialises it. */
export interface PageBackend {
  readonly kind: string;
  readonly adapter: string;
}

export function parseGpuArm(raw: string | undefined): GpuArm | null {
  if (raw === undefined) return 'legacy';
  const hit = GPU_ARMS.find((a) => a === raw);
  return hit ?? null;
}

export function expectedKind(arm: GpuArm): BackendKind {
  return arm === 'legacy' ? 'legacy-gl' : arm === 'webgl2' ? 'node-webgl2' : 'node-webgpu';
}

/** The envKey suffix. EMPTY for legacy: its keys, and so every committed baseline directory, never move. */
export function backendTerm(kind: BackendKind): string {
  return kind === 'node-webgl2' ? 'wgl2' : kind === 'node-webgpu' ? 'wgpu' : '';
}

/** The `&gpu=` query token for an arm. Legacy adds NOTHING, so a legacy URL is byte-identical to today's. */
export function urlGpuParam(arm: GpuArm): string {
  return arm === 'legacy' ? '' : `&gpu=${arm}`;
}

/** Chromium launch arguments per arm. Only `webgpu` adds any: Dawn on SwiftShader/Vulkan (the fallback adapter is allowed in CI only). */
export function chromiumArgsFor(arm: GpuArm): string[] {
  if (arm !== 'webgpu') return [];
  return [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    // MEASURED on the ubuntu-latest runner (`ci/webgpu-smoke.ts`, 5 launch-argument variants, PR 1041): only the variant WITH
    // `--use-angle=swiftshader` kept a WebGPU device alive for 60 frames; the other four lost the Dawn instance ("A valid external
    // Instance reference no longer exists") before the first frame.
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ];
}

/** Why this page's backend is not the arm's, or null. Used on EVERY capture; a non-null answer is exit 2. */
export function backendRefusal(arm: GpuArm, got: PageBackend | undefined): string | null {
  if (got === undefined) {
    return `the page did not report backendInfo() (arm ${arm}): the capture script predates the backend term or the renderer is not ThreeRenderer`;
  }
  const want = expectedKind(arm);
  if (got.kind !== want) {
    return `arm ${arm} expects backend ${want} but the page drew through ${got.kind} (${got.adapter}); a fallback is evidence about the fallback, not about ${arm}`;
  }
  return null;
}

/** A run that mixes backends (or adapters) is refused: one key, one backend, one adapter. */
export function mixedBackendRefusal(records: readonly { readonly id: string; readonly backend: PageBackend }[]): string | null {
  const first = records[0];
  if (first === undefined) return null;
  for (const r of records) {
    if (r.backend.kind !== first.backend.kind || r.backend.adapter !== first.backend.adapter) {
      return `mixed backends in one run: "${first.id}" drew through ${first.backend.kind} (${first.backend.adapter}) but "${r.id}" through ${r.backend.kind} (${r.backend.adapter})`;
    }
  }
  return null;
}
