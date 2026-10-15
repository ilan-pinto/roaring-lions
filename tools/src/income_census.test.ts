// F2 Task 8 (GH-183): the t=0 census. Every income zone a shipped mission authors, and every
// supply convoy it declares, must have a wheeled route to its rear the moment the mission
// starts. The schema cannot say it, `validate:data` only checks that the zone and the marker
// EXIST, and the runtime reads an unreachable line as `cut: 'unreachable'` with no error: a
// zone sealed behind boulders would pay half forever and look like a mission working.
//
// How it reads the runtime. A zone nobody holds has no line (C-R19: `route` null, `cut` null),
// so the zone's own route is read off a runtime in which a side-0 fixture rifle squad stands
// in it and the zone's enemy ground units are removed (`debugKill`, a test hook). One step
// then runs the first recheck (the runtime computes every route on its first step), and the
// census reads `route` and `cut` off `runtime.incomeZones` / `runtime.convoyRoute` -- the real
// runtime's own answers, not a restatement of its rear or its start rule. The world is built
// by `missionStage` (terrain, structures, tunnels, units, roads: what `playtest-run.ts`'s
// `run()` builds, without the upgrade/ledger layer, which touches no terrain).
//
// C-R22 -- `umm_zeitoun_3_clearance`'s `horn_west` (a knoll inside a boulder field, foot-only
// by design) is vehicle-UNREACHABLE from the rear. It pays nothing and is authored as nobody's
// income zone, so no map edit: this census is what guards it. Do NOT author `horn_west` as an
// income zone without first opening the boulders around it (which moves UZ III's pathing and
// every playtest line). The second block below shows the census naming it.
import { describe, expect, it } from 'vitest';
import { maps, missions } from '@lions/data';
import type { MissionJson } from '@lions/sim';
import { MissionRuntime } from '@lions/sim';
import { fx } from '../../packages/sim/src/fixed';
import { missionStage } from './mission-harness';

type Res = { income_zones?: { zone: string; rate_per_min: number }[]; supply_corridor?: boolean; supply_entry?: string };
type Rect = readonly [number, number, number, number];
const all = missions as unknown as Record<string, MissionJson & { resources?: Res }>;
const mapZones = (file: string): Record<string, Rect> => (maps as unknown as Record<string, { zones?: Record<string, Rect> }>)[file].zones ?? {};

/** Every shipped mission that authors income zones or a corridor with an entry. */
const censused = Object.values(all)
  .filter((m) => (m.resources?.income_zones?.length ?? 0) > 0 || (m.resources?.supply_corridor === true && m.resources.supply_entry !== undefined))
  .map((m) => m.id)
  .sort();

interface Reading {
  zones: number;
  convoys: number;
  failures: string[];
}

/**
 * Builds `mission` (registered under a scratch id so `missionStage` can find it), puts a side-0
 * fixture squad in each authored zone ONE AT A TIME on a fresh world, steps to the first
 * recheck and returns what is unreachable, by mission and zone name.
 */
function census(mission: MissionJson & { resources?: Res }): Reading {
  const scratch = `__census_${mission.id}`;
  all[scratch] = mission;
  const out: Reading = { zones: 0, convoys: 0, failures: [] };
  try {
    const authored = mission.resources?.income_zones ?? [];
    // Convoy first (it needs no holder), on a world of its own; then one world per zone.
    const probes: (string | null)[] = [...authored.map((e) => e.zone)];
    if (mission.resources?.supply_corridor === true && mission.resources.supply_entry !== undefined) probes.push(null);
    for (const zone of probes) {
      const stage = missionStage(scratch);
      const { sim } = stage;
      const rt = new MissionRuntime(sim, stage.mission, stage.context({}));
      rt.start();
      if (zone !== null) {
        const rect = mapZones(mission.map.file)[zone];
        for (let i = 0; i < sim.entityCount; i++) {
          if (sim.state.alive[i] !== 1 || sim.state.side[i] !== 1) continue;
          const x = fx.toInt(sim.state.posX[i]);
          const y = fx.toInt(sim.state.posY[i]);
          if (x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]) sim.debugKill(i);
        }
        const cx = rect[0] + (rect[2] >> 1);
        const cy = rect[1] + (rect[3] >> 1);
        sim.spawn(stage.context({}).typeIdOf('inf_squad'), 0, fx.from(cx + 0.5), fx.from(cy + 0.5));
      }
      rt.step(sim.tick());
      if (zone !== null) {
        out.zones++;
        const z = rt.incomeZones.find((e) => e.zone === zone);
        if (z === undefined) out.failures.push(`${mission.id}: zone "${zone}" is not in the runtime's income zones`);
        else if (z.holder !== 0) out.failures.push(`${mission.id}: zone "${zone}" is not held by the fixture (state ${z.state})`);
        else if (z.route === null || z.cut === 'unreachable')
          out.failures.push(`${mission.id}: zone "${zone}" has no wheeled route to the rear at t=0 (cut ${String(z.cut)})`);
      } else {
        out.convoys++;
        const c = rt.convoyRoute;
        if (c === null) out.failures.push(`${mission.id}: the supply convoy is not in the runtime`);
        else if (c.route === null || c.cut === 'unreachable')
          out.failures.push(`${mission.id}: the supply convoy from "${mission.resources?.supply_entry}" has no wheeled route to the rear at t=0 (cut ${String(c.cut)})`);
      }
    }
  } finally {
    delete all[scratch];
  }
  return out;
}

describe('the t=0 census: every authored income zone and convoy has a wheeled route', () => {
  it('finds the four D7 missions (the loop below is not vacuous)', () => {
    expect(censused).toEqual(['deir_amun_2_foothold', 'umm_zeitoun_2_buildup', 'umm_zeitoun_4_clearance', 'wadi_halam_2_laager']);
  });
  it('reads 9 zones and 2 convoys across them', () => {
    let zones = 0;
    let convoys = 0;
    for (const id of censused) {
      const r = census(all[id]);
      zones += r.zones;
      convoys += r.convoys;
    }
    expect([zones, convoys]).toEqual([9, 2]);
  });
  for (const id of censused) {
    it(`${id}: no zone and no convoy is unreachable at t=0`, () => {
      expect(census(all[id]).failures).toEqual([]);
    });
  }
});

describe('the census sees what it guards: umm_zeitoun_3_clearance horn_west (C-R22)', () => {
  const uz3 = all.umm_zeitoun_3_clearance;
  const withZone = (zone: string): MissionJson & { resources?: Res } => ({
    ...structuredClone(uz3),
    resources: { ...(uz3.resources as Res), income_zones: [{ zone, rate_per_min: 10 }] },
  });
  it('horn_west is a zone of the map and is not authored as an income zone today', () => {
    expect(Object.keys(mapZones(uz3.map.file))).toContain('horn_west');
    expect((uz3.resources as Res | undefined)?.income_zones ?? []).toEqual([]);
  });
  it('authored on a copy of UZ III, the census names it', () => {
    const r = census(withZone('horn_west'));
    expect(r.zones).toBe(1);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('umm_zeitoun_3_clearance');
    expect(r.failures[0]).toContain('"horn_west"');
  });
  it('control: the sibling horn, reachable by vehicle, passes the same census', () => {
    const r = census(withZone('horn_east'));
    expect(r.zones).toBe(1);
    expect(r.failures).toEqual([]);
  });
});
