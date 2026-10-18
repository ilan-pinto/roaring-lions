// The F2 income read model (S-F): the held-ground income state of a MissionRuntime, as plain
// presentation data. The minimap, the strip, its tip, the world zones and the world route read
// ONLY this; none of them touches the runtime's income getters. The alerts do NOT: they read the
// runtime at alert time, per tick (`alert-world.ts`'s `zoneHolder`, `supplyCut`, `supplyCutAt`),
// because this view may be a HUD beat stale. It copies, it never derives: the totals are the
// runtime's own `incomePerMin`, and `route`/`cutSpan` are copied because the runtime reuses
// that storage in place at a recheck.
//
// Whose lines: only side 0's. The convoy, and the routes of zones whose holder is 0. An
// enemy-held zone has a route to the ENEMY's rear and a cut on the enemy's line; neither is the
// player's supply, so neither is carried (controller ruling, S-F F2).
import { ZONE_CONTESTED, type ConvoyRoute, type CutCause, type ZoneIncome } from '@lions/sim';

export type IncomeZoneState = 'held' | 'unheld' | 'contested';

export interface IncomeZoneView {
  /** `ZoneIncome.zone`. */
  readonly id: string;
  readonly rect: readonly [number, number, number, number];
  readonly ratePerMin: number;
  /** `ZoneIncome.paysPerMin` when side 0 holds it, else 0. */
  readonly paysPerMin: number;
  /** State 0 is held; 1 or empty is unheld; contested is contested. */
  readonly state: IncomeZoneState;
  /** The cut on side 0's line from this zone; null when not side 0's. */
  readonly cut: CutCause;
  /** A COPY of the tiles from the zone to side 0's rear; null when not side 0's. */
  readonly route: readonly number[] | null;
  /** A COPY of the cut stretch (indices into `route`); null when not side 0's. */
  readonly cutSpan: readonly [number, number] | null;
}

export interface IncomeView {
  readonly base: number;
  readonly zones: number;
  /** `base + zones`, the strip's purse figure. */
  readonly total: number;
  /** The convoy is cut OR any zone side 0 holds is cut: the strip's half mark. */
  readonly halved: boolean;
  /** The CONVOY's cut (`incomePerMin.halvedBy`); a zone's own cause is on its view. */
  readonly halvedBy: CutCause;
  readonly zoneViews: readonly IncomeZoneView[];
  readonly convoy: {
    readonly route: readonly number[] | null;
    readonly cut: CutCause;
    readonly cutSpan: readonly [number, number] | null;
  } | null;
}

/** What the model reads. A real `MissionRuntime` satisfies it structurally. */
export interface IncomeRuntime {
  readonly incomeZones: readonly Readonly<ZoneIncome>[];
  readonly convoyRoute: Readonly<ConvoyRoute> | null;
  readonly incomePerMin: Readonly<{ base: number; zones: number; halvedBy: CutCause }>;
}

function copyRoute(route: ArrayLike<number> | null): readonly number[] | null {
  return route === null ? null : Array.from(route);
}

function copySpan(span: readonly [number, number] | null): readonly [number, number] | null {
  return span === null ? null : [span[0], span[1]];
}

function zoneView(z: Readonly<ZoneIncome>): IncomeZoneView {
  const state: IncomeZoneState = z.state === ZONE_CONTESTED ? 'contested' : z.state === 0 ? 'held' : 'unheld';
  const ours = z.holder === 0;
  return {
    id: z.zone,
    rect: [z.rect[0], z.rect[1], z.rect[2], z.rect[3]],
    ratePerMin: z.ratePerMin,
    paysPerMin: ours ? z.paysPerMin : 0,
    state,
    cut: ours ? z.cut : null,
    route: ours ? copyRoute(z.route) : null,
    cutSpan: ours ? copySpan(z.cutSpan) : null,
  };
}

/** Null when the mission has no income zones and no convoy (every shipped mission today). */
export function incomeViewOf(rt: IncomeRuntime): IncomeView | null {
  const zones = rt.incomeZones;
  const convoy = rt.convoyRoute;
  if (zones.length === 0 && convoy === null) return null;
  const per = rt.incomePerMin;
  const zoneViews = zones.map(zoneView);
  return {
    base: per.base,
    zones: per.zones,
    total: per.base + per.zones,
    halved: per.halvedBy !== null || zoneViews.some((z) => z.cut !== null),
    halvedBy: per.halvedBy,
    zoneViews,
    convoy:
      convoy === null
        ? null
        : { route: copyRoute(convoy.route), cut: convoy.cut, cutSpan: copySpan(convoy.cutSpan) },
  };
}
