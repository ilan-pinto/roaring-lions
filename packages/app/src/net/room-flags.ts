/**
 * In a room no sandbox flag reaches the sim (spec §3.3): the two machines
 * must boot the same world, and a flag one player typed and the other did not
 * would desync them at tick 0. Every flag is forced off, and each one the URL
 * asked for is named so a `&tunnel` that "did nothing" reads as a rule rather
 * than a broken feature.
 */
export function roomFlags<K extends string>(
  flags: Readonly<Record<K, boolean>>,
  inRoom: boolean,
  warn: (flag: K) => void,
): Record<K, boolean> {
  const out = { ...flags } as Record<K, boolean>;
  if (!inRoom) return out;
  for (const k of Object.keys(out) as K[]) {
    if (out[k]) warn(k);
    out[k] = false;
  }
  return out;
}
