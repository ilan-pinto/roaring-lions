/**
 * GH-943 WebGPU-primary migration, P0: the backend vocabulary and the decisions that need no GPU.
 *
 * Three-free on purpose (no `three` import), so `api.ts`, the app's probe and the harness can all name the same
 * types, and so a vitest can falsify every decision here with a literal `navigator`.
 *
 * Presentation only. Nothing here is read by the sim.
 */

/** What the caller asks for. `legacy` is the WebGLRenderer + EffectComposer path (the default until P7). */
export type GpuRequest = 'auto' | 'webgpu' | 'webgl2' | 'legacy';

export const GPU_REQUESTS: readonly GpuRequest[] = ['auto', 'webgpu', 'webgl2', 'legacy'];

/** What actually draws. `node-*` is three's WebGPURenderer: on its WebGPU backend, or on its own WebGL2 backend. */
export type BackendKind = 'legacy-gl' | 'node-webgpu' | 'node-webgl2';

/** `renderer.backendInfo()`: read by the harness, the log line, feedback and settings. */
export interface BackendInfo {
  readonly kind: BackendKind;
  /** The adapter description for `node-webgpu`, `webgl2` for the others, `none` before init. */
  readonly adapter: string;
  /** Why this is not what was asked for (a fallback), or absent. */
  readonly reason?: string;
  /** What the caller asked for. */
  readonly requested: GpuRequest;
}

/** The short backend term the visual gate puts in a capture environment key. `legacy-gl` has none: its keys never move. */
export function backendKeyTerm(kind: BackendKind): string {
  return kind === 'node-webgl2' ? 'wgl2' : kind === 'node-webgpu' ? 'wgpu' : '';
}

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
  // `isFallbackAdapter` is absent on some Chromium builds (the CI runner's reads `undefined` on SwiftShader), so a software
  // rasteriser is also recognised by name.
  const software = /swiftshader|llvmpipe|softpipe|software/i.test(name);
  return { ok: true, adapter: name || 'unknown', fallbackAdapter: adapter.isFallbackAdapter === true || software };
}

/** What `ThreeRenderer` builds. A `node-webgl2` plan carries the reason it is not WebGPU (`''` when it was asked for). */
export type BackendPlan =
  | { readonly kind: 'legacy-gl' }
  | { readonly kind: 'node-webgpu'; readonly adapter: string }
  | { readonly kind: 'node-webgl2'; readonly reason: string };

/**
 * The choice, in the order the design (section 7) lists, as far as P0 builds it: an explicit request wins (`legacy`, `webgl2`,
 * `webgpu`), `auto` takes WebGPU when an adapter answers and is not a fallback adapter. An EXPLICIT `webgpu` accepts a fallback
 * adapter (SwiftShader in CI, a dev's own request); `auto` never does. Steps 2-4 (the player's setting, the denylist, the crash
 * flag) arrive at P7 with the cutover.
 *
 * Never silent: a plan that is not what was asked for carries a reason, and `ThreeRenderer` logs it.
 */
export function planBackend(request: GpuRequest, probe: WebGpuProbe): BackendPlan {
  if (request === 'legacy') return { kind: 'legacy-gl' };
  if (request === 'webgl2') return { kind: 'node-webgl2', reason: '' };
  if (!probe.ok) return { kind: 'node-webgl2', reason: probe.reason };
  if (probe.fallbackAdapter && request === 'auto') return { kind: 'node-webgl2', reason: `adapter "${probe.adapter}" is a software fallback adapter` };
  return { kind: 'node-webgpu', adapter: probe.adapter };
}

/** The one log line (design section 7): `renderer: webgpu (<adapter>)`, or `renderer: webgl2 fallback: <reason>`. */
export function backendLogLine(info: BackendInfo): string {
  if (info.kind === 'node-webgpu') return `[lions] renderer: webgpu (${info.adapter})`;
  if (info.kind === 'node-webgl2') {
    return info.reason !== undefined && info.reason !== '' ? `[lions] renderer: webgl2 fallback: ${info.reason}` : '[lions] renderer: webgl2 (node backend, requested)';
  }
  return info.reason !== undefined && info.reason !== '' ? `[lions] renderer: legacy webgl2 fallback: ${info.reason}` : '[lions] renderer: legacy webgl2';
}

/** True when the request needs the node backend (a second dynamic import). `undefined` is today's legacy path. */
export function wantsNodeBackend(request: GpuRequest | undefined): boolean {
  return request === 'auto' || request === 'webgpu' || request === 'webgl2';
}
