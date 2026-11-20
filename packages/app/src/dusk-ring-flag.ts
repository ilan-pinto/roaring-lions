/**
 * `&duskring=0` -- the A/B switch for the dusk team ring (GH-1403, the lead's ruling of 20 Nov 2026, option B;
 * `RendererOptions.duskTeamRing`, `three/units/hdr-gains.ts`'s `duskTeamRing`): at dusk the faint team ring under every
 * unselected unit is drawn brighter, in its own team colour.
 *
 * ON by default at dusk. `=0`, `=off` and `=false` draw today's ring; absent, bare, or any other value leaves it on. It
 * applies to a mission as well as the sandbox, it does nothing on a day or dawn map (the renderer applies the gain only at
 * dusk), and it is presentation only: no sim code reads it, so no score or outcome can depend on it.
 */
export function duskTeamRingOf(params: URLSearchParams): boolean {
  const raw = params.get('duskring');
  if (raw === null) return true;
  return raw !== '0' && raw !== 'off' && raw !== 'false';
}
