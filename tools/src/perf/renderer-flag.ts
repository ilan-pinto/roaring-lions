/** `load-profile.ts --renderer=`: the app's `&gpu=` request. A typo refuses rather than loading the default renderer under a webgpu label. */
export const RENDERER_FLAGS = ['webgpu', 'webgl2', 'legacy'] as const;
export type RendererFlag = (typeof RENDERER_FLAGS)[number];

export function parseRendererFlag(raw: string | undefined): RendererFlag | null {
  if (raw === undefined) return null;
  const hit = RENDERER_FLAGS.find((r) => r === raw);
  if (hit === undefined) throw new Error(`--renderer must be one of ${RENDERER_FLAGS.join(', ')}, got "${raw}"`);
  return hit;
}
