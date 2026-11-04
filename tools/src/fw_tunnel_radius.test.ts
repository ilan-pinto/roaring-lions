// GH-277 Task 14, probe `fw-tunnel-radius` (spec §9): no mission whose `field_works` lists a type with
// `aura.sensor.tunnel_radius > 0` has a flat 2x2 pad that puts a route a PRIMARY objective needs inside that radius.
//
// The radius is a sensor, not an eye (no line of sight): at 10 a centre built 5-9 tiles behind the start line
// identifies a route on its own, which would solve a mission whose point is to find it. validate:data rule 4 keeps the
// type out of a mission that AUTHORS a `digs` or `in_tunnel` placement; this walk is the other half, and it measures:
// every pad `placementReason` accepts, against every route a primary `collapse` snapshots (`collapseTargets`).
//
// It must not pass on nothing (the empty-array lesson). Three guards: the count of missions walked is pinned, a
// mission that really has a covering pad is walked as a positive control, and the walk is shown a type it can fail.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeWorld, read, ROOT } from './walk_world';

interface StructureJson { id: string; aura?: { sensor?: { tunnel_radius?: number } }; buildable?: { footprint: [number, number] } }
const catalogue = read(join(ROOT, 'data/structures.json')).types as Record<string, StructureJson>;
const radiusOf = (type: string): number => catalogue[type]?.aura?.sensor?.tunnel_radius ?? 0;

/** The seven allow lists of spec §5 / plan Task 15 that name a radius type: five missions list the intel centre. The
 *  two that author tunnels (beit_sahwan_2_foothold, deir_amun_2_foothold) list the medic, the outpost and the workshop. */
export const PLANNED_FIELD_WORKS: Record<string, string[]> = {
  beit_sahwan_2_foothold: ['kdf_medic_station', 'kdf_outpost', 'kdf_workshop'],
  deir_amun_2_foothold: ['kdf_medic_station', 'kdf_outpost', 'kdf_workshop'],
  khan_rafid_2_foothold: ['kdf_medic_station', 'kdf_outpost', 'kdf_workshop', 'kdf_intel_centre'],
  qarn_hadid_2_foothold: ['kdf_medic_station', 'kdf_outpost', 'kdf_workshop', 'kdf_intel_centre'],
  tel_marum_2_foothold: ['kdf_medic_station', 'kdf_outpost', 'kdf_workshop', 'kdf_intel_centre'],
  umm_zeitoun_2_buildup: ['kdf_medic_station', 'kdf_outpost', 'kdf_workshop', 'kdf_intel_centre'],
  wadi_halam_2_laager: ['kdf_medic_station', 'kdf_outpost', 'kdf_workshop', 'kdf_intel_centre'],
};

/** Mission id -> the types its `field_works` lists, as shipped in data/missions. */
export function shippedFieldWorks(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const dir = join(ROOT, 'data/missions');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const m = read(join(dir, f)) as { id: string; field_works?: Record<string, number> };
    if (m.field_works !== undefined) out[m.id] = Object.entries(m.field_works).filter(([, n]) => n > 0).map(([t]) => t);
  }
  return out;
}

export interface PadWalk { pads: number; needed: number; covering: number }

/** Walk every legal pad of `type` in `missionId`'s world; count those whose centroid has a tile of a needed route
 *  inside the type's tunnel radius. */
export function walkPads(missionId: string, type: string): PadWalk {
  const w = makeWorld(missionId);
  const sim = w.sim as unknown as {
    width: number; height: number;
    structureTypes: { id: string }[];
    placementReason(t: number, x: number, y: number, side: number): string | null;
    tnTiles: Set<number>[];
  };
  const typeIdx = sim.structureTypes.findIndex((t) => t.id === type);
  if (typeIdx < 0) throw new Error(`${missionId}: structure type ${type} is not registered`);
  const targets = (w.runtime as unknown as { collapseTargets: Map<string, readonly number[]> }).collapseTargets;
  const primaries = new Set((w.mission.objectives ?? []).filter((o) => (o as { primary?: boolean }).primary !== false).map((o) => o.id));
  const needed = new Set<number>();
  for (const [objective, routes] of targets) if (primaries.has(objective)) for (const r of routes) needed.add(r);
  const radius = radiusOf(type);
  const [fw, fh] = catalogue[type].buildable?.footprint ?? [2, 2];
  let pads = 0;
  let covering = 0;
  for (let ty = 0; ty < sim.height; ty++) {
    for (let tx = 0; tx < sim.width; tx++) {
      if (sim.placementReason(typeIdx, tx, ty, 0) !== null) continue;
      pads++;
      const cx = tx + fw / 2;
      const cy = ty + fh / 2;
      let hit = false;
      for (const r of needed) {
        for (const t of sim.tnTiles[r]) {
          const dx = (t % sim.width) + 0.5 - cx;
          const dy = Math.floor(t / sim.width) + 0.5 - cy;
          if (dx * dx + dy * dy <= radius * radius) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) covering++;
    }
  }
  return { pads, needed: needed.size, covering };
}

/** Every mission in `lists` that names a radius type, walked once per such type. */
export function walkAllowLists(lists: Record<string, string[]>): { checked: number; failures: string[] } {
  let checked = 0;
  const failures: string[] = [];
  for (const [mission, types] of Object.entries(lists)) {
    const radiusTypes = types.filter((t) => radiusOf(t) > 0);
    if (radiusTypes.length === 0) continue;
    checked++;
    for (const t of radiusTypes) {
      const r = walkPads(mission, t);
      if (r.pads === 0) failures.push(`${mission}: ${t} has no legal pad at all (the walk saw nothing)`);
      else if (r.covering > 0) failures.push(`${mission}: ${r.covering} of ${r.pads} ${t} pads cover one of the ${r.needed} route(s) a primary needs`);
    }
  }
  return { checked, failures };
}

describe('fw-tunnel-radius', () => {
  it('the planned allow lists (spec 5): five missions list the intel centre and none has a pad that covers a needed route', () => {
    const r = walkAllowLists(PLANNED_FIELD_WORKS);
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(5);
  }, 240000);

  it('control: the walk can fail. deir_amun_2_foothold with the intel centre has covering pads on its pump route', () => {
    const r = walkPads('deir_amun_2_foothold', 'kdf_intel_centre');
    expect(r.needed).toBeGreaterThan(0);
    expect(r.covering).toBeGreaterThan(0);
    expect(walkAllowLists({ deir_amun_2_foothold: ['kdf_intel_centre'] }).failures).toHaveLength(1);
  }, 240000);

  it('control: a type with no radius is never walked', () => {
    expect(walkAllowLists({ deir_amun_2_foothold: ['kdf_medic_station', 'kdf_outpost', 'kdf_workshop'] })).toEqual({ checked: 0, failures: [] });
  });
});
