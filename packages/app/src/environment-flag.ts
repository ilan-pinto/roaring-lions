/**
 * `&envlight=0` -- the debug switch for look uplift L1 (GH-943): the scene's sky
 * environment, handed per material class by the renderer
 * (`RendererOptions.environmentLight`, `three/environment.ts`).
 *
 * The environment is ON by default since the lead judged the mock (2 Nov) and
 * shipped it. This flag survives only as an A/B tool: `=0`, `=off` and `=false`
 * draw the pre-L1 frame (the shipped hemisphere, no environment, the 0.45 metal
 * cap); absent, bare, or any other value leaves it on. It applies to a mission as
 * well as the sandbox, and it is presentation only (no sim code reads it), so no
 * score or outcome can depend on it.
 */
export function environmentLightOf(params: URLSearchParams): boolean {
  const raw = params.get('envlight');
  if (raw === null) return true;
  return raw !== '0' && raw !== 'off' && raw !== 'false';
}
