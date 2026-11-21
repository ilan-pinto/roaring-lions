/**
 * `&duskread` -- the switch for the dusk figure read (GH-1403, `RendererOptions.duskRead`,
 * `three/dusk-read.ts`): at dusk, every infantry figure's albedo is lifted before lighting so a
 * pinned squad's huddle and a side's uniform read at gameplay zoom.
 *
 * OFF, and staying off: the lead chose option B on 20 Nov 2026 (the brighter dusk TEAM ring,
 * `dusk-ring-flag.ts`) instead of lifting the figures. The read is kept as an opt-in look for
 * comparison. On by default it would move the gated `graded` frame (a dusk sandbox);
 * `DUSK_READ_DEFAULT` is the one line that would ship it. A bare `&duskread`, `=1`, `=on` and
 * `=true` turn it on; `=0`, `=off` and `=false` turn it off; absent or any other value is the
 * default. It applies to a mission as well as the sandbox (a dusk mission is where it matters),
 * it does nothing on a day or dawn map (the renderer applies it only at dusk), and it is
 * presentation only: no sim code reads it, so no score or outcome can depend on it.
 */
export const DUSK_READ_DEFAULT = false;

export function duskReadOf(params: URLSearchParams): boolean {
  const raw = params.get('duskread');
  if (raw === null) return DUSK_READ_DEFAULT;
  if (raw === '' || raw === '1' || raw === 'on' || raw === 'true') return true;
  if (raw === '0' || raw === 'off' || raw === 'false') return false;
  return DUSK_READ_DEFAULT;
}
