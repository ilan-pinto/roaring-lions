// GH-1438 E13 rule (b): no ground side-0 unit starts within 4.5 tiles of a civilian body, a muster marker or a gate
// centre (docs/campaign/civilian-drama.md §10.2 E13; the lead relaxed 5 to 4.5 on 18 Nov). The pure rule is
// tools/validate_force_to_gate.mjs; validate_data.mjs runs it on the AUTHORED spread. This file runs it where the
// bodies stand after `MissionRuntime.start()` (the start layout applied), on every shipped mission: the doc's reading.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { structures as structureTypes, units } from '@lions/data';
import { maps, missions } from '@lions/data/content';
import { MissionRuntime, type MissionJson } from '@lions/sim';
import {
  FORCE_CLEARANCE_TILES,
  authoredBodies,
  authoredForceToGateFailures,
  forceToGateFailures,
  gateCentres,
  musterPoints,
} from '../validate_force_to_gate.mjs';
import { missionStage } from './mission-harness';

const ROOT = join(__dirname, '..', '..');
const unitsById = new Map(Object.values(units).map((u) => [(u as { id: string }).id, u]));

/** E1's proposed row (§2.2), as a FIXTURE: data/structures.json has no gate type until E1 lands. */
const COMPOUND_GATE = {
  id: 'compound_gate', name: 'Compound Gate', symbol: 'G', hp_per_tile: 600, garrison_slots: 0, rubble_cover: 1,
  height_px: 14, color: 'limestone.5', roe_penalty: 0, per_tile: false, low_profile: true, standing_cover: 2,
  gate: { open_radius_tiles: 4, hold_open_s: 3, swing_s: 2 },
};
const TYPES_WITH_GATE = { ...(structureTypes as Record<string, unknown>), compound_gate: COMPOUND_GATE };

const pt = (label: string, x: number, y: number) => ({ label, x, y });

describe('forceToGateFailures (positions in, failures out)', () => {
  it('is 4.5 tiles, inclusive: 4.5 fails, 4.51 passes, for each kind of point', () => {
    expect(FORCE_CLEARANCE_TILES).toBe(4.5);
    for (const kind of ['civilians', 'musters', 'gates'] as const) {
      const at = (d: number) => forceToGateFailures({ force: [pt('u', 10 + d, 10)], [kind]: [pt('p', 10, 10)] }, 'm');
      expect(at(4.5), kind).toHaveLength(1);
      expect(at(4.51), kind).toEqual([]);
    }
  });
  it('names the unit, the point and the distance', () => {
    expect(forceToGateFailures({ force: [pt('at_team#0', 21.8, 23)], gates: [pt('gate compound_gate at (17.5, 22)', 17.5, 22)] }, 'm')).toEqual([
      'm: ground side-0 at_team#0 at (21.8, 23) starts 4.41 tiles from gate compound_gate at (17.5, 22), inside 4.5 ' +
        '(GH-1438 E13 b) -- a passive player would have people walked out, or a gate opened, for free',
    ]);
  });
  it('reads nothing as clear', () => {
    expect(forceToGateFailures({}, 'm')).toEqual([]);
  });
});

describe('the points', () => {
  const markers = { home: [4, 4] as [number, number], apron: [15, 22] as [number, number], ridge: [40, 40] as [number, number] };
  it('spreads bodies as spawnPlacement does: a marker from its tile centre, an `at` exactly, 1.25 east and south', () => {
    const b = authoredBodies([{ unit: 'civilians', count: 4, marker: 'home' }, { unit: 'x', count: 1, at: [2, 3] }], markers, undefined);
    expect(b.map((p: { x: number; y: number }) => [p.x, p.y])).toEqual([[4.5, 4.5], [5.75, 4.5], [7, 4.5], [4.5, 5.75], [2, 3]]);
  });
  it('a muster is the `to` of a withdraw_to on an ALL-civilian group, and nothing else', () => {
    const mission = {
      civilians: { groups: [{ unit: 'civilians', count: 3, marker: 'home', group: 'road' }, { unit: 'civilians', count: 1, marker: 'home', group: 'mixed' }] },
      enemy: { garrison: [{ unit: 'militia_cell', count: 1, at: [1, 1], group: 'mixed' }] },
      triggers: [
        { id: 'run', on: { kind: 'timer_s', seconds: 2 }, do: { kind: 'withdraw_to', group: 'road', to: 'apron' } },
        { id: 'mix', on: { kind: 'timer_s', seconds: 2 }, do: { kind: 'withdraw_to', group: 'mixed', to: 'ridge' } },
        { id: 'go', on: { kind: 'timer_s', seconds: 2 }, do: { kind: 'commit', group: 'road', to: 'ridge' } },
      ],
    };
    expect(musterPoints(mission, markers)).toEqual([{ label: 'muster "apron"', x: 15.5, y: 22.5 }]);
  });
  it('a gate centre comes from a type with a `gate` block, in structures[] (at + size / 2) or in the grid', () => {
    // The breach pilot's two gates (§11.1.2, V23): 1x2 at (17,21) and (31,24), centres (17.5, 22.0) and (31.5, 25.0).
    const mission = { structures: [{ type: 'compound_gate', at: [17, 21], size: [1, 2] }, { type: 'compound_gate', at: [31, 24], size: [1, 2] }, { type: 'wall', at: [0, 0], size: [1, 1] }] };
    expect(gateCentres(mission, undefined, TYPES_WITH_GATE).map((g: { x: number; y: number }) => [g.x, g.y])).toEqual([[17.5, 22], [31.5, 25]]);
    // A grid gate: one 2x1 run of `G` is ONE structure (parseMap's fill), centre (3.0, 1.5).
    const map = { width: 6, height: 3, rows: ['......', '..GG..', '......'] };
    expect(gateCentres({}, map, TYPES_WITH_GATE).map((g: { x: number; y: number }) => [g.x, g.y])).toEqual([[3, 1.5]]);
    // E1 not landed: no shipped type carries `gate`, so the same data reads no gate at all.
    expect(gateCentres(mission, map, structureTypes)).toEqual([]);
  });
  it('a muster marker inside the clearance fails the authored reading; a mixed group has no muster', () => {
    const map = { width: 48, height: 48, rows: [], markers: { apron: [10, 10] } };
    const m = (group: string) => ({
      id: 'fixture',
      map: { file: 'x' },
      starting_force: [{ unit: 'inf_squad', count: 1, at: [14, 12] }], // (14, 12) to the apron's (10.5, 10.5): 3.81
      civilians: { groups: [{ unit: 'civilians', count: 1, at: [40, 40], group: 'road' }] },
      enemy: { garrison: [{ unit: 'militia_cell', count: 1, at: [44, 44], group: 'cell' }] },
      triggers: [{ id: 'run', on: { kind: 'timer_s', seconds: 2 }, do: { kind: 'withdraw_to', group, to: 'apron' } }],
    });
    const out = authoredForceToGateFailures(m('road'), map, structureTypes, unitsById, 'm');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('starts 3.81 tiles from muster "apron"');
    expect(authoredForceToGateFailures(m('cell'), map, structureTypes, unitsById, 'm')).toEqual([]);
  });
  it('an aircraft and a buried civilian are not on the count (authored reading)', () => {
    const map = { width: 48, height: 48, rows: [], markers: {} };
    const close = {
      id: 'fixture',
      map: { file: 'x' },
      starting_force: [{ unit: 'recon_drone', count: 1, at: [10, 10] }],
      civilians: { groups: [{ unit: 'civilians', count: 1, at: [11, 10] }, { unit: 'civilians', count: 1, at: [30, 30], in_tunnel: 'r' }] },
    };
    expect((unitsById.get('recon_drone') as { mobility: { domain: string } }).mobility.domain).toBe('air');
    expect(authoredForceToGateFailures(close, map, structureTypes, unitsById, 'm')).toEqual([]);
    const ground = { ...close, starting_force: [{ unit: 'inf_squad', count: 1, at: [10, 10] }, { unit: 'inf_squad', count: 1, at: [30, 31] }] };
    expect(authoredForceToGateFailures(ground, map, structureTypes, unitsById, 'm')).toHaveLength(1); // the buried one is still skipped
  });
});

describe('the breach pilot shape (§11.1.2, V23): the shipped breach with the pilot two gates and a muster', () => {
  const breach = JSON.parse(readFileSync(join(ROOT, 'data/missions/beit_sahwan_breach.json'), 'utf8'));
  const mapJson = JSON.parse(readFileSync(join(ROOT, 'data/maps/marj_perimeter.json'), 'utf8'));
  const pilot = (force = breach.starting_force) => ({
    ...breach,
    starting_force: force,
    structures: [{ type: 'compound_gate', at: [17, 21], size: [1, 2] }, { type: 'compound_gate', at: [31, 24], size: [1, 2] }],
    civilians: { ...breach.civilians, groups: [...breach.civilians.groups, { unit: 'civilians', count: 3, at: [3.5, 20.5], group: 'road_w' }] },
    triggers: [...breach.triggers, { id: 'run_w', on: { kind: 'timer_s', seconds: 2 }, do: { kind: 'withdraw_to', group: 'road_w', to: 'gate_apron_w' } }],
  });
  const map = { ...mapJson, markers: { ...mapJson.markers, gate_apron_w: [15, 22] } };
  it('passes at 4.5, the at_team 4.61 from the west gate, and would have failed the old 5 twice (4.61 and 4.92)', () => {
    expect(breach.start_layout).toBe('authored');
    const pts = (m: unknown) => ({
      force: authoredBodies((m as typeof breach).starting_force, map.markers, undefined, (p: { unit: string }) => (unitsById.get(p.unit) as { mobility: { domain: string } }).mobility.domain !== 'air'),
      gates: gateCentres(m, map, TYPES_WITH_GATE),
      musters: musterPoints(m, map.markers),
    });
    expect(authoredForceToGateFailures(pilot(), map, TYPES_WITH_GATE, unitsById, 'b')).toEqual([]);
    const old = forceToGateFailures(pts(pilot()), 'b', 5);
    expect(old.map((f: string) => f.match(/starts ([\d.]+) tiles/)?.[1])).toEqual(['4.61', '4.92']);
  });
  it('fails when the west at_team moves 0.2 tile toward the gate (4.41)', () => {
    const force = breach.starting_force.map((p: { unit: string; at: number[] }) => (p.unit === 'at_team' && p.at[0] === 22 ? { ...p, at: [21.8, 23] } : p));
    const out = authoredForceToGateFailures(pilot(force), map, TYPES_WITH_GATE, unitsById, 'b');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('starts 4.41 tiles from gate compound_gate at (17.5, 22)');
  });
});

/** Where every ground side-0 body and every surface civilian stands after `start()`, the start layout applied. */
function laidOut(id: string) {
  const { mission, sim, context } = missionStage(id);
  new MissionRuntime(sim, mission, context({})).start();
  const st = sim.state;
  const force = [];
  const civilians = [];
  for (let i = 0; i < sim.entityCount; i++) {
    if (st.alive[i] !== 1) continue;
    const p = pt(`entity ${i}`, st.posX[i] / 65536, st.posY[i] / 65536);
    if (st.side[i] === 0 && !sim.unitTypes[st.typeIdx[i]].isAir) force.push(p);
    if (st.side[i] === 2 && st.tunnelIn[i] < 0) civilians.push(p);
  }
  const mapJson = (maps as Record<string, { markers?: Record<string, readonly number[]> }>)[(mission as MissionJson).map.file];
  const failures = forceToGateFailures(
    { force, civilians, musters: musterPoints(mission, mapJson.markers), gates: gateCentres(mission, mapJson, structureTypes) },
    id
  );
  let min = Infinity;
  for (const u of force) for (const c of civilians) min = Math.min(min, Math.hypot(u.x - c.x, u.y - c.y));
  return { force: force.length, civilians: civilians.length, failures, min };
}

describe('every shipped mission, after the start layout', () => {
  const ids = Object.keys(missions);
  // A world that will not build (an authored spawn on a blocked tile throws in `start()`) fails its own row, not the file.
  const readings = new Map(
    ids.map((id) => {
      try {
        return [id, laidOut(id)];
      } catch (e) {
        return [id, { force: 0, civilians: 0, failures: [`${id}: the world did not build: ${(e as Error).message}`], min: NaN }];
      }
    })
  );

  it('walks all 40 missions, 362 ground side-0 bodies and 148 surface civilians', () => {
    // Literals, so a walk that silently lost a mission or a body cannot pass. 362 is start_layout.test.ts's census;
    // 148 is the sum of every shipped `civilians.groups` count (none is buried), summed straight from the JSON, not by this walk
    // (141, plus Beit Sahwan IV's 8 grown to 15 in PR 1610; Bir Tarsha IV fields none).
    expect(ids.length).toBe(40);
    expect([...readings.values()].reduce((n, r) => n + r.force, 0)).toBe(362);
    expect([...readings.values()].reduce((n, r) => n + r.civilians, 0)).toBe(148);
  });
  // No exemption (the lead ruled Beit Sahwan IV moves its civilians, PR 1610): every shipped id is a row.
  it.each(ids)('%s keeps its force 4.5 tiles clear', (id) => {
    expect(readings.get(id)?.failures).toEqual([]);
  });
  it.each(ids)('%s passes the authored reading validate_data.mjs runs', (id) => {
    const m = missions[id as keyof typeof missions] as MissionJson;
    const mapJson = (maps as Record<string, unknown>)[m.map.file];
    expect(authoredForceToGateFailures(m, mapJson, structureTypes, unitsById, id)).toEqual([]);
  });
});
