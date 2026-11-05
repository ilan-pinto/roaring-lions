/**
 * `&gpu=auto|webgpu|webgl2|legacy` -- which renderer draws (GH-943 WebGPU-primary migration, P0).
 *
 * Sandbox only until P7, like `&tod=`: a mission never reads it (N-23), so no mission, score or outcome can depend on it.
 * Presentation only. ABSENT is `legacy` -- today's WebGLRenderer plus EffectComposer, to the bit -- and `legacy` is also what a
 * mission always gets in P0. A typo is reported and ignored, so `&gpu=webgp` is never mistaken for a WebGPU run.
 * The renderer does the rest: no adapter, no WebGPU, a logged reason, and the next backend down.
 */
import { GPU_REQUESTS, type GpuRequest } from '@lions/render';

export interface GpuChoice {
  /** Undefined for "not asked" (and for a refused or unknown value): the renderer default, legacy. */
  readonly value: GpuRequest | undefined;
  readonly warning?: string;
}

export function gpuOf(params: URLSearchParams, inSandbox: boolean): GpuChoice {
  const raw = params.get('gpu');
  if (raw === null) return { value: undefined };
  if (!inSandbox) return { value: undefined, warning: `&gpu=${raw} is sandbox-only until the cutover; a mission draws through the legacy renderer` };
  const known = GPU_REQUESTS.find((r) => r === raw);
  if (known === undefined) return { value: undefined, warning: `&gpu=${raw} is not a known value (${GPU_REQUESTS.join(' | ')}); drawing through the legacy renderer` };
  return { value: known };
}
