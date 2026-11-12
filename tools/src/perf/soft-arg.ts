/**
 * `--soft=on|off` for `render-frame-cost.ts` (GH-1227 slice 2): the G-cost read in one command per side.
 * `on` adds the sandbox's `&soft` flag to the query; `off` removes it, so both halves of the A/B are the same URL
 * bar the one flag. Absent leaves the query as typed (and a typed `&soft` stays).
 */
export type SoftArg = 'on' | 'off' | undefined;

export function parseSoftArg(raw: string | undefined): SoftArg {
  if (raw === undefined) return undefined;
  if (raw === 'on' || raw === 'off') return raw;
  throw new Error(`--soft=${raw} is not on or off`);
}

export function withSoftQuery(query: string, soft: SoftArg): string {
  if (soft === undefined) return query;
  const bare = query.replace(/^\?/, '');
  const parts = bare.split('&').filter((p) => p.length > 0 && p !== 'soft' && !p.startsWith('soft='));
  if (soft === 'on') parts.push('soft');
  return `?${parts.join('&')}`;
}
