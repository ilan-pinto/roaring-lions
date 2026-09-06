import type { ObjectiveZoneView } from '@lions/render';

/** The shape `MissionRuntime.objectiveList` yields, narrowed to what this needs. */
export interface ZoneObjective {
  id: string;
  type: string;
  status: string;
  zone?: string;
  paused?: 'contested' | 'unheld';
}

const TARGET_TYPES: ReadonlySet<string> = new Set(['raze', 'collapse']);

/**
 * Every active objective that is about a piece of ground, as the renderer
 * draws it. Until 2026-09-06 the map outlined only the FIRST such objective:
 * Tel Marum II showed the approach to hold and never the draw with the cache
 * the mission is lost on. A hold or capture zone carries its hold state; a
 * raze or collapse zone is a `target`, drawn in the hostile colour without a
 * pulse -- ground to bring down, not to stand on. A zone the map does not
 * declare is skipped rather than drawn at the origin.
 */
export function objectiveZonesFor(
  objectives: readonly ZoneObjective[],
  zones: Readonly<Record<string, readonly number[]>>
): ObjectiveZoneView[] {
  const out: ObjectiveZoneView[] = [];
  for (const o of objectives) {
    if (o.status !== 'active' || o.zone === undefined) continue;
    const rect = zones[o.zone];
    if (rect === undefined) continue;
    const state: ObjectiveZoneView['state'] = TARGET_TYPES.has(o.type)
      ? 'target'
      : o.paused === 'contested'
        ? 'contested'
        : o.paused === 'unheld'
          ? 'unheld'
          : 'held';
    out.push({ id: o.id, rect, state });
  }
  return out;
}
