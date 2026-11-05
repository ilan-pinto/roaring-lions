/**
 * Which GPU API this browser can draw with: `webgpu`, `webgl2` or `none` (GH-943 P0, design sections 1 and 7).
 *
 * ASYNC (an adapter request is a promise) and MEMOISED (one answer per page: the adapter does not change under us, and the
 * WebGL2 leg's throwaway context is released inside `webgl2Available`). It replaces the SYNC `webgl2Available` as the thing a
 * screen asks "can I draw?", with one P0 caveat that is the reason this file exists beside `webgl-probe.ts`:
 *
 * LEGACY IS STILL THE DEFAULT in P0, and the legacy renderer needs WebGL2. A WebGPU-only machine must therefore still get the
 * plate from the sync screens (`worldmap3d.ts`, `scene-host.ts`, `garage-viewer.ts`, main.ts's boot card), which keep calling
 * `webgl2Available`. At P7, when auto becomes the default and node-WebGL2 is the fallback, those four sites switch to
 * `drawableNow()` here: the plate is then shown only for `none`, and a probe still pending at the menu deadline counts as
 * `webgl2` and is logged. TODO(P7): flip the four call sites.
 */
import { probeWebGpu, type GpuNavigatorLike } from '@lions/render';
import { webgl2Available } from './webgl-probe';

export type GpuApi = 'webgpu' | 'webgl2' | 'none';

export interface GpuProbeResult {
  readonly api: GpuApi;
  /** The adapter description when `webgpu`; the reason WebGPU is absent otherwise. */
  readonly detail: string;
}

export interface GpuProbeDeps {
  readonly navigator?: GpuNavigatorLike;
  readonly webgl2?: () => boolean;
}

/** The decision, with no memo: tested directly. A real adapter wins, even over a missing WebGL2 (node-WebGPU needs none). */
export async function probeGpuApi(deps: GpuProbeDeps = {}): Promise<GpuProbeResult> {
  const nav = deps.navigator ?? (globalThis.navigator as unknown as GpuNavigatorLike | undefined);
  const gpu = await probeWebGpu(nav);
  if (gpu.ok && !gpu.fallbackAdapter) return { api: 'webgpu', detail: gpu.adapter };
  const gl = (deps.webgl2 ?? webgl2Available)();
  const why = gpu.ok ? `adapter "${gpu.adapter}" is a software fallback adapter` : gpu.reason;
  if (gl) return { api: 'webgl2', detail: why };
  // A software WebGPU adapter and no WebGL2 is still something to draw with.
  if (gpu.ok) return { api: 'webgpu', detail: gpu.adapter };
  return { api: 'none', detail: `${why}; and no WebGL2 context` };
}

let memo: Promise<GpuProbeResult> | null = null;
let settled: GpuProbeResult | null = null;

/** The memoised probe. */
export function probeGpu(): Promise<GpuProbeResult> {
  memo ??= probeGpuApi().then((r) => (settled = r));
  return memo;
}

/** The settled answer, or null while the probe is pending (or was never started). */
export function settledGpu(): GpuProbeResult | null {
  return settled;
}

/**
 * What a synchronous screen decides on: the settled answer, and `webgl2` (logged) when the probe is still pending at its
 * deadline. Only `none` shows the plate.
 */
export function drawableNow(): boolean {
  if (settled === null) {
    console.warn('[lions] gpu probe still pending at the deadline: counting it as webgl2');
    return true;
  }
  return settled.api !== 'none';
}

/** Test seam only: forget the memo. */
export function resetGpuProbeForTest(): void {
  memo = null;
  settled = null;
}
