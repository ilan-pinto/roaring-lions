import type { ObjectiveZoneView } from '@lions/render';
import type { IncomeView } from './ui/income-view';

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
 * The hold state of one zone objective -- THE rule, read by the renderer's
 * zone outline (through `objectiveZonesFor`) and by the minimap's own zone
 * mark (VR-36), so the two can never tint one objective differently.
 */
export function zoneStateOf(o: Pick<ZoneObjective, 'type' | 'paused'>): ObjectiveZoneView['state'] {
  if (TARGET_TYPES.has(o.type)) return 'target';
  if (o.paused === 'contested') return 'contested';
  if (o.paused === 'unheld') return 'unheld';
  return 'held';
}

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
    out.push({ id: o.id, rect, state: zoneStateOf(o) });
  }
  return out;
}

/** The zones the ACTIVE objectives are about. An income zone one of them already
 *  draws is drawn once, by the objective (P2-1), on the map and the minimap alike. */
export function activeObjectiveZoneNames(objectives: readonly Pick<ZoneObjective, 'status' | 'zone'>[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const o of objectives) if (o.status === 'active' && o.zone !== undefined) names.add(o.zone);
  return names;
}

/**
 * Held income ground (S-F F2, Z-B), as the renderer draws it: the objective
 * zone's own outline and ground band with NO new world mark. Held is `held`
 * (solid), unheld `unheld` (dashed -- an enemy-held and an empty zone read
 * alike), contested `contested`; never `target`, which is ground to bring
 * down. What a zone pays is told by the minimap mark's glyph and the logistics
 * tip, not here. Ids are `income:<zone>`; a zone an active objective already
 * draws is skipped. Reads the IncomeView, never the runtime.
 */
export function incomeZonesFor(
  view: IncomeView | null,
  activeObjectiveZones: ReadonlySet<string>
): ObjectiveZoneView[] {
  const out: ObjectiveZoneView[] = [];
  if (view === null) return out;
  for (const z of view.zoneViews) {
    if (activeObjectiveZones.has(z.id)) continue;
    out.push({ id: `income:${z.id}`, rect: z.rect, state: z.state });
  }
  return out;
}
