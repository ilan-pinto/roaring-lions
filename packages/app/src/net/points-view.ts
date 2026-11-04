/**
 * A points race as one seat reads it (GH-976 P2): both sides' points, the target, what each side's held zones
 * pay it a minute, and who holds each zone. ONE function, read by the browser's points HUD (`ui/net-points.ts`) and by
 * the AI harness's `observe` (`tools/src/net/view.ts`), so a model is shown the board a human is shown.
 *
 * Fog: zone holders and both scores are PUBLIC by design. They are read from the runtime, not from what the seat can
 * see, so a seat sees an enemy's points bank and a zone go "contested" while the unit that contests it is still in
 * the fog. The race is only a race if both sides can read it; the units in it stay hidden (`sideView` lists
 * contacts only in sight).
 *
 * Import-free on purpose, like `zone-rate.ts`: the harness's stdout-purity walk follows every import.
 */

/** The slice of `MissionRuntime` the board reads. */
export interface PointsRuntime {
  scoreOf(side: 0 | 1): number;
  readonly incomeZones: readonly { readonly zone: string; readonly rect: readonly number[]; readonly state: number; readonly holder: number }[];
}

/** The slice of the mode file's `points` block the board reads. */
export interface PointsRules {
  readonly zones: readonly { readonly zone: string; readonly per_min: number }[];
  readonly target: number;
}

/** Who holds a zone, from the viewer's side: `none` for ground nobody stands on, `contested` for both. */
export type ZoneHolder = 'mine' | 'theirs' | 'contested' | 'none';

export interface PointsZone {
  zone: string;
  /** x, y, width, height, in tiles. */
  at: [number, number, number, number];
  /** What holding it pays a minute. */
  perMin: number;
  holder: ZoneHolder;
}

export interface PointsView {
  target: number;
  /** Whole points. */
  mine: number;
  theirs: number;
  /** What the zones each side holds pay it a minute (kills pay on top, when they happen). */
  mineRate: number;
  theirsRate: number;
  zones: PointsZone[];
}

/** `ZONE_CONTESTED` (`@lions/sim`'s income.ts), restated: the board imports nothing. A test pins the copy. */
export const ZONE_STATE_CONTESTED = -2;

export function pointsViewOf(rt: PointsRuntime, rules: PointsRules, viewer: 0 | 1): PointsView {
  const theirsSide: 0 | 1 = viewer === 0 ? 1 : 0;
  const zones: PointsZone[] = [];
  let mineRate = 0;
  let theirsRate = 0;
  for (const z of rules.zones) {
    const live = rt.incomeZones.find((x) => x.zone === z.zone);
    if (live === undefined) continue;
    const holder: ZoneHolder = live.state === ZONE_STATE_CONTESTED ? 'contested' : live.holder === viewer ? 'mine' : live.holder === theirsSide ? 'theirs' : 'none';
    if (holder === 'mine') mineRate += z.per_min;
    else if (holder === 'theirs') theirsRate += z.per_min;
    zones.push({ zone: z.zone, at: [live.rect[0], live.rect[1], live.rect[2], live.rect[3]], perMin: z.per_min, holder });
  }
  return { target: rules.target, mine: rt.scoreOf(viewer), theirs: rt.scoreOf(theirsSide), mineRate, theirsRate, zones };
}
