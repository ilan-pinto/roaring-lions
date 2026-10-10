/**
 * The graphics card's own name, for a feedback note's context (GH-464):
 * `WEBGL_debug_renderer_info`'s unmasked renderer, e.g. `ANGLE (Apple, ANGLE
 * Metal Renderer: Apple M3 Pro, Unspecified Version)`. Asked once a session,
 * only when a note is being sent, from a throwaway context that is released
 * straight away -- the game's own context is never touched for it.
 */
let cached: string | null | undefined;

export function gpuName(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      cached = typeof name === 'string' ? name : null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    cached = null;
  }
  return cached;
}
