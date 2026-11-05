/**
 * `&gpu=webgpu` -- the WebGPU trial (GH-943 L5, option (b)). A SPIKE, sandbox only, never the default.
 *
 * Only the exact value `webgpu` turns it on, and only in the sandbox: a mission never reads it (N-23), so no
 * mission, score or outcome can depend on it. It is presentation only. Any other value is reported and
 * ignored, so a typo (`&gpu=webgp`) is not mistaken for a trial that is running. The renderer does the
 * rest: no adapter, no trial, a `console.warn`, and the unchanged WebGL2 path.
 */
export interface GpuTrialChoice {
  readonly value: 'webgpu' | undefined;
  readonly warning?: string;
}

export function gpuTrialOf(params: URLSearchParams, inSandbox: boolean): GpuTrialChoice {
  const raw = params.get('gpu');
  if (raw === null) return { value: undefined };
  if (!inSandbox) return { value: undefined, warning: '&gpu=' + raw + ' is sandbox-only; a mission always draws through WebGL2' };
  if (raw === 'webgpu') return { value: 'webgpu' };
  return { value: undefined, warning: '&gpu=' + raw + ' is not a known value (webgpu); drawing through WebGL2' };
}
