/**
 * The refuge, shown while an evacuation is being scored (GH-279).
 *
 * `MissionRuntime.objectiveList` reports an `evacuate_before` with its
 * authored text and its deadline and nothing else: no count, and no `zone`
 * (that field is filled only for hold, capture, raze and collapse). So the
 * player was told "Get four families into the ward" with no way to see how
 * many were in, and the one place the families actually walk to -- the
 * mission's `civilians.refuge` marker -- appeared on no surface at all.
 *
 * Both answers are derived here from what the app already holds, never from
 * the runtime's private flight state (the sim is frozen, and invariant 4):
 *
 *  - the COUNT from `evacuated` MissionEvents, which `main.ts` already sees
 *    one per civilian (the runtime emits exactly one, from the same branch
 *    that latches her -- `mission.ts`'s `evacuate_before` case). Every
 *    evacuation objective in a mission reads the same count: the runtime
 *    completes each on `civFlight.evacuatedCount >= count`, one shared tally.
 *  - the REFUGE from the mission's own `civilians.refuge` marker, resolved on
 *    the map exactly as `MissionRuntime.markerPos` resolves it (tile + 0.5).
 *
 * This decorates rows for the HUD strip, the tracker, the pause list and the
 * minimap. It is deliberately NOT fed to `objectiveZonesFor`: the lead ruled
 * out a permanent mark in the 3D world, so the refuge lives on the minimap
 * and in the tracker only.
 */
import { t } from './i18n/t';

export interface EvacMissionShape {
  civilians?: { refuge?: string };
  objectives: readonly { id: string; type: string; count?: number }[];
}

export interface TilePoint {
  x: number;
  y: number;
}

/** Where the families walk to, in tiles (tile centre), or null when the
 *  mission names no refuge or the map has no such marker. */
export function refugePoint(
  mission: Pick<EvacMissionShape, 'civilians'> | undefined,
  markers: Readonly<Record<string, readonly [number, number]>>
): TilePoint | null {
  const name = mission?.civilians?.refuge;
  if (name === undefined) return null;
  const m = markers[name];
  return m ? { x: m[0] + 0.5, y: m[1] + 0.5 } : null;
}

/** Objective id -> how many must get out, for every `evacuate_before`. The
 *  default of 1 is the runtime's own (`d.count ?? 1`). */
export function evacuationTargets(mission: EvacMissionShape | undefined): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const o of mission?.objectives ?? []) {
    if (o.type === 'evacuate_before') out.set(o.id, o.count ?? 1);
  }
  return out;
}

interface RowShape {
  id: string;
  text: string;
  status: string;
}

/**
 * The same rows, with every ACTIVE evacuation's text carrying its tally --
 * "Get four families into the ward inside five minutes (1/4)" -- and a
 * `jumpTo` pointing at the refuge. A completed or failed evacuation keeps its
 * authored text: the tally is progress, and there is none left to make.
 *
 * A fresh array either way (the strip's `MissionView` wants a mutable one),
 * but a row that needed nothing is passed through untouched.
 */
export function withEvacuationProgress<R extends RowShape>(
  rows: readonly R[],
  targets: ReadonlyMap<string, number>,
  evacuated: number,
  refuge: TilePoint | null
): (R & { jumpTo?: TilePoint })[] {
  if (targets.size === 0) return rows.slice();
  return rows.map((r) => {
    const of = targets.get(r.id);
    if (of === undefined || r.status !== 'active') return r;
    const text = t('objectives.evacProgress', { text: r.text, n: Math.min(evacuated, of), of });
    return refuge ? { ...r, text, jumpTo: refuge } : { ...r, text };
  });
}

/** The refuge while an evacuation objective is still active, else null --
 *  what the minimap draws. Hidden once the evacuation is decided, so the mark
 *  means "this is still being scored" and never goes stale. */
export function activeRefuge(
  rows: readonly { id: string; status: string }[],
  targets: ReadonlyMap<string, number>,
  refuge: TilePoint | null
): TilePoint | null {
  if (refuge === null) return null;
  return rows.some((r) => r.status === 'active' && targets.has(r.id)) ? refuge : null;
}
