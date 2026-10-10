// The garage's upgrade emblems (GH-238 item 3, approved 5 Oct: Option B,
// docs/art/garage-upgrade-images.md). Three track heads and nine tier
// emblems, hand-drawn SVG in `assets/ui/kit/`, every one a 24-unit viewBox
// painted with `currentColor` alone -- so colour is CSS's (`--kit`, steel)
// and no hex lives in this file or those. The mesh never changes with a tier,
// so the emblem says WHAT kind of gain and how far up the ladder, not what
// the unit looks like.
//
// Resolved by import.meta.glob (eager, raw) rather than a hand-kept table: a
// file that ships is found, and `kit-emblems.test.ts` fails on a track or
// tier the roster uses that has no file.
const RAW = import.meta.glob('../../../../assets/ui/kit/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const EMBLEMS = new Map<string, string>();
for (const [path, svg] of Object.entries(RAW)) {
  EMBLEMS.set(path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), svg);
}

/** Names of every emblem present, for the test's completeness sweep. */
export function emblemNames(): string[] {
  return [...EMBLEMS.keys()].sort();
}

/** The emblem for a track head (`tier` omitted) or one rung. Null when no
 *  file exists, so a content author's own track draws the hatch alone. */
export function emblemSvg(track: string, tier?: number): string | null {
  return EMBLEMS.get(tier === undefined ? track : `${track}-t${tier}`) ?? null;
}
