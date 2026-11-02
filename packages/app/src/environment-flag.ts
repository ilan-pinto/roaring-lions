/**
 * `&envlight` -- look uplift L1 (GH-943): the switch for the environment
 * lighting the renderer builds behind `RendererOptions.environmentLight`
 * (`three/environment.ts`). OFF by default: absent, the renderer draws today's
 * frame to the bit and this returns `false`. A bare `&envlight` and `&envlight=1`
 * are on; `=0` and `=off` are off, spelled out so a bookmark can be A/B'd.
 *
 * Like `&fitbuildings` it applies to a mission as well as the sandbox: it exists
 * so the lead can judge the look on the campaign's own maps, and it is
 * presentation only (no sim code reads it), so no score or outcome can depend on it.
 */
export function environmentLightOf(params: URLSearchParams): boolean {
  const raw = params.get('envlight');
  if (raw === null) return false;
  return raw !== '0' && raw !== 'off' && raw !== 'false';
}
