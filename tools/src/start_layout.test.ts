// GH-1360 S3b: every shipped mission's starting force, as `MissionRuntime.start()` lays it out (design
// docs/superpowers/specs/2026-11-15-unit-spacing-design.md, section 3.2 and the S3b row of section 7).
//
// Each mission is started twice from the same stage: once as shipped, once with `start_layout` removed (today's SPREAD,
// the "before"). The two are compared index by index, so a body's move is measured against where the author put it,
// and the ids, types and sides are proven unchanged. Bodies are the S0 census's (`spacing-census.ts`): hulls are their
// GH-421 capsules, foot teams the spec's circles (r 0.25 to 0.45 per type), a pair counts past 0.02 tile, same side.
//
// What every shipped mission must show:
// - 0 overlapping side-0 pairs (one named exemption, below, with its demotion check);
// - 0 bodies off their own mask (a wheeled body on a boulder, anyone on a wall);
// - 0 ground bodies at the authored fallback in an assembly (the "no spot within 12 tiles" step, an authoring error at
//   the start); an aircraft has no body (spec 3.1), so its fallback is not a body's;
// - no body moved more than 11 tiles (the measured 10.1, plus one: a ratchet a scattering layout change fails);
// - every body of an assembly facing its front, and the front seeded from the enemy-centroid derivation (D2).
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data/content';
import { MissionRuntime, startFaceOf, startFrontDerivations, type MissionJson, type StartFront, type StartPlacement } from '@lions/sim';
import { missionStage } from './mission-harness';
import { entriesOf, overlaps, type Entry } from './backtest/spacing-census';

/** The 11-tile move ratchet (spec 3.2). */
const MAX_MOVE_TILES = 11;
/** The mean-move ratchet: the measured 3.37 tiles plus 0.11. Was 3.5 (measured 3.39 over the 30 older missions; the five Qasr Liwan
 *  missions, 46 more laid bodies, bring the mean to 3.368, and the same 0.11 of headroom is 3.48). */
const MAX_MEAN_MOVE_TILES = 3.48;

/**
 * The one mission that keeps an overlapping pair, and why. `umm_zeitoun_1_recon`'s force stands against the map's
 * southern ridge (rows 46 and 47 are `^`), so the assembly's rear rank (depth 4 behind the click at y 42) falls on
 * the ridge and the medic team overflows to the free spot. The free spot is `Sim.freeSpotNear`, and no foot type
 * declares a footprint until S5c, so to it the medic is a POINT: it is put 0.71 tile from the jeep's centre, clear of
 * the jeep's capsule but inside the census's r 0.45 circle (0.33 deep). When S5c gives foot their circles, the free
 * spot keeps the medic clear and this pair goes: the demotion check below then fails, and this entry is deleted.
 * Measured instead and not shipped: moving the force's `at`s one row north clears it (0 pairs, 0 fallbacks), but the
 * shipped plan then loses `get_the_wells_clear` on sweep seeds 424242 and 6; a content change is the mission author's.
 */
const OVERLAP_EXEMPT: Readonly<Record<string, readonly [string, string]>> = {
  umm_zeitoun_1_recon: ['jeep_shoded', 'inf_medic_squad'],
};

/** The exempt pair's measured depth, tiles. */
const OVERLAP_EXEMPT_DEPTH: Readonly<Record<string, number>> = { umm_zeitoun_1_recon: 0.332 };

interface Reading {
  id: string;
  mission: MissionJson;
  /** Side-0 ground bodies, layout off and on. */
  before: Entry[];
  after: Entry[];
  placements: readonly StartPlacement[];
  /** Tiles each laid body moved, by entity id. */
  moved: Map<number, number>;
  airIds: Set<number>;
  facings: Map<number, number>;
  /** Laid bodies with no other within the 6-tile single link at their authored positions: one-body assemblies, which
   *  keep their authored position by design (spec 3.2), so their `authored` is not a fallback. */
  lone: Set<number>;
  derived: ReturnType<typeof startFrontDerivations>;
}

function read(id: string): Reading {
  const start = (strip: boolean) => {
    const { mission, sim, context, map } = missionStage(id);
    const m: MissionJson = strip ? { ...mission, start_layout: undefined, start_front: undefined } : mission;
    let placements: readonly StartPlacement[] = [];
    new MissionRuntime(sim, m, context({})).start((p) => {
      placements = p;
    });
    return { mission, sim, map, placements };
  };
  const off = start(true);
  const on = start(false);
  const a = off.sim.state;
  const b = on.sim.state;
  // Ids, types, sides and spawn order: the layout writes positions and facings only.
  expect(on.sim.entityCount, `${id}: entity count`).toBe(off.sim.entityCount);
  for (let i = 0; i < on.sim.entityCount; i++) {
    expect([b.typeIdx[i], b.side[i]], `${id}: entity ${i}`).toEqual([a.typeIdx[i], a.side[i]]);
  }
  const moved = new Map<number, number>();
  const airIds = new Set<number>();
  const facings = new Map<number, number>();
  const force: [number, number][] = [];
  for (const p of on.placements) {
    const dx = (b.posX[p.id] - a.posX[p.id]) / 65536;
    const dy = (b.posY[p.id] - a.posY[p.id]) / 65536;
    moved.set(p.id, Math.hypot(dx, dy));
    if (on.sim.unitTypes[b.typeIdx[p.id]].isAir) airIds.add(p.id);
    facings.set(p.id, b.facing[p.id]);
    force.push([a.posX[p.id], a.posY[p.id]]);
  }
  const lone = new Set<number>();
  for (const p of on.placements) {
    const near = on.placements.some((q) => q.id !== p.id && Math.hypot((a.posX[q.id] - a.posX[p.id]) / 65536, (a.posY[q.id] - a.posY[p.id]) / 65536) <= 6);
    if (!near) lone.add(p.id);
  }
  const derived = startFrontDerivations(off.mission, { markers: off.map.markers, zones: off.map.zones }, off.sim.width, off.sim.height, force);
  const side0 = (es: Entry[]) => es.filter((e) => e.side === 0);
  return {
    id,
    mission: on.mission,
    before: side0(entriesOf(off.sim)),
    after: side0(entriesOf(on.sim)),
    placements: on.placements,
    moved,
    airIds,
    facings,
    lone,
    derived,
  };
}

const IDS = Object.keys(missions);
const READINGS = IDS.map(read);
const byId = new Map(READINGS.map((r) => [r.id, r]));

describe('the starting layout on every shipped mission (GH-1360 S3b)', () => {
  it('walks all 39 missions and the same 344 side-0 ground bodies as the S0 census, with 74 pairs before', () => {
    // Literals, so a walk that silently lost a mission or a body cannot pass: S0's census (GH-1360, 15 Nov) read 271
    // ground bodies and 70 overlapping pairs for side 0 across the first 30 starts. Was 30 missions / 271 / 70 / 292 laid. The five Qasr Liwan
    // missions (GH-1438) add 44 ground bodies (315), 4 overlapping pairs before (74: II 2, III 1, IV 1) and 46 laid bodies with their aircraft (338). Bir Tarsha I, II, III and V (GH-1438) add 29 ground bodies (344), no overlapping pair before (74) and 29 laid bodies (367).
    expect(IDS.length).toBe(39);
    expect(READINGS.reduce((n, r) => n + r.after.length, 0)).toBe(344);
    expect(READINGS.reduce((n, r) => n + r.before.length, 0)).toBe(344);
    expect(READINGS.reduce((n, r) => n + overlaps(r.before).length, 0)).toBe(74);
    // Every laid body: the census's ground bodies plus the force's aircraft.
    expect(READINGS.reduce((n, r) => n + r.placements.length, 0)).toBe(367);
  });

  it('every mission declares start_layout, and every assembly a start_front', () => {
    for (const r of READINGS) {
      expect(['assembly', 'authored'], r.id).toContain(r.mission.start_layout);
      if (r.mission.start_layout === 'assembly') expect(['N', 'E', 'S', 'W'], r.id).toContain(r.mission.start_front);
    }
  });

  it('no overlapping side-0 pair, but for the named exemption', () => {
    const found: string[] = [];
    for (const r of READINGS) {
      for (const o of overlaps(r.after)) {
        const pair = [r.after[o.a].unit, r.after[o.b].unit].sort().join('+');
        const ex = OVERLAP_EXEMPT[r.id];
        if (ex !== undefined && [...ex].sort().join('+') === pair) continue;
        found.push(`${r.id}: ${pair} ${o.depth.toFixed(2)} deep`);
      }
    }
    expect(found).toEqual([]);
  });

  it('the exemption still holds (demotion check: when this fails, delete the OVERLAP_EXEMPT entry)', () => {
    for (const [id, ex] of Object.entries(OVERLAP_EXEMPT)) {
      const r = byId.get(id);
      if (r === undefined) throw new Error(`exempt mission ${id} is not shipped`);
      const os = overlaps(r.after);
      const pairs = os.map((o) => [r.after[o.a].unit, r.after[o.b].unit].sort().join('+'));
      expect(pairs, id).toEqual([[...ex].sort().join('+')]);
      // And it may not deepen unnoticed: measured 0.33 tile (the medic 0.71 from the jeep's centre, r 0.45 against the
      // jeep's capsule). Any change to the free spot or the layout that moves this pair moves this number.
      expect(os[0].depth, `${id}: depth`).toBeCloseTo(OVERLAP_EXEMPT_DEPTH[id], 3);
    }
  });

  it('no body off its own mask', () => {
    const off: string[] = [];
    for (const r of READINGS) for (const e of r.after) if (e.onBlocked) off.push(`${r.id}: ${e.unit}#${e.id} at (${e.tx}, ${e.ty})`);
    expect(off).toEqual([]);
  });

  it('no ground body at the authored fallback in an assembly', () => {
    const fell: string[] = [];
    for (const r of READINGS) {
      if (r.mission.start_layout !== 'assembly') continue;
      for (const p of r.placements) if (p.how === 'authored' && !r.airIds.has(p.id) && !r.lone.has(p.id)) fell.push(`${r.id}: entity ${p.id}`);
    }
    expect(fell).toEqual([]);
    // The two exclusions are exactly the tutorial's two lone bodies and umm_zeitoun_1_recon's drone (see OVERLAP_EXEMPT).
    const excused = READINGS.flatMap((r) => r.placements.filter((p) => p.how === 'authored' && r.mission.start_layout === 'assembly').map((p) => `${r.id}#${p.id}`));
    expect(excused).toEqual(['beit_sahwan_0_tutorial#0', 'beit_sahwan_0_tutorial#1', 'umm_zeitoun_1_recon#0']);
  });

  it(`no body moved more than ${MAX_MOVE_TILES} tiles`, () => {
    const far: string[] = [];
    let largest = 0;
    for (const r of READINGS) {
      for (const [id, d] of r.moved) {
        largest = Math.max(largest, d);
        if (d > MAX_MOVE_TILES) far.push(`${r.id}: entity ${id} moved ${d.toFixed(2)}`);
      }
    }
    expect(far).toEqual([]);
    // The measured largest (deir_amun_3_subterranean's apc_eitan): a move bound nobody approaches proves nothing.
    expect(largest).toBeGreaterThan(10);
  });

  it(`the mean body move stays under ${MAX_MEAN_MOVE_TILES} tiles`, () => {
    // A second ratchet, because the 11-tile one cannot see a layout that shifts every body: doubling the anchor's
    // half-depth shift (the spec's S3b mutation 4) moves the largest body only 10.07 -> 10.36 (the edge pull-back clamps
    // most starts), but the mean 3.39 -> 3.90 tiles. Measured 3.39 over the 292 laid bodies; the bound is that plus 0.11.
    let sum = 0;
    let n = 0;
    for (const r of READINGS) for (const d of r.moved.values()) {
      sum += d;
      n++;
    }
    expect(n).toBe(367);
    expect(sum / n).toBeLessThan(MAX_MEAN_MOVE_TILES);
  });

  it('every body of an assembly faces its front', () => {
    for (const r of READINGS) {
      if (r.mission.start_layout !== 'assembly') continue;
      const face = startFaceOf(r.mission.start_front as StartFront);
      for (const [id, f] of r.facings) expect(f, `${r.id}: entity ${id}`).toBe(face);
    }
  });

  it('every authored front is the enemy-centroid derivation (D2), and eleven missions\' derivations disagree', () => {
    for (const r of READINGS) {
      if (r.mission.start_front === undefined) continue;
      expect(r.mission.start_front, r.id).toBe(r.derived.chosen);
    }
    // The missions a mission-author reviews (spec 3.2): enemy, objectives and map centre do not all agree.
    const disagree = READINGS.filter((r) => !(r.derived.enemy === r.derived.objectives && r.derived.objectives === r.derived.centre)).map((r) => r.id);
    expect(disagree.sort()).toEqual([
      'beit_sahwan_0_tutorial',
      'beit_sahwan_1_recon',
      'beit_sahwan_breach',
      'bir_tarsha_1_recon',
      'bir_tarsha_3_clearance',
      'ein_qasab_1_recon',
      'qasr_liwan_1_recon',
      'qasr_liwan_3_buildup',
      'qasr_liwan_5_subterranean',
      'tel_marum_1_recon',
      'wadi_halam_5_depot',
    ]);
  });

  it('the authored missions keep every body where the author put it (none overlapped before)', () => {
    const authored = READINGS.filter((r) => r.mission.start_layout === 'authored');
    expect(authored.map((r) => r.id)).toEqual(['beit_sahwan_breach']);
    for (const r of authored) {
      expect(overlaps(r.before).length, r.id).toBe(0);
      for (const [id, d] of r.moved) expect(d, `${r.id}: entity ${id}`).toBe(0);
    }
  });
});
