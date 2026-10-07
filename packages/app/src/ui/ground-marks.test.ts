import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { groundMarks, type GroundMarkInputs } from './ground-marks';

const json = (p: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8'));

function wh5(): GroundMarkInputs {
  const m = json('data/missions/wadi_halam_5_depot.json') as {
    map: { player_start: number[] };
    objectives: GroundMarkInputs['objectives'];
    roe: { flagged_zones: string[] };
  };
  const map = json('data/maps/wadi_halam_5.json') as { zones: Record<string, number[]> };
  return { playerStart: m.map.player_start, zones: map.zones, objectives: m.objectives, flaggedZones: m.roe.flagged_zones, zoneName: () => 'civic hall' };
}

describe('groundMarks (GH-417)', () => {
  it('marks the depot once for both objectives on it, the civic hall, and the start', () => {
    const marks = groundMarks(wh5());
    const obj = marks.filter((k) => k.kind === 'objective');
    expect(obj).toHaveLength(1);
    expect(obj[0]).toMatchObject({ zone: 'depot', rect: { x: 29, y: 5, w: 12, h: 12 }, numbers: [1, 3], clock: '5:00 limit' });
    expect(marks.find((k) => k.kind === 'nofire')).toMatchObject({ zone: 'hall_block', label: 'civic hall' });
    expect(marks.find((k) => k.kind === 'start')).toEqual({ kind: 'start', x: 7, y: 41 });
  });

  // The rule the header states: an objective whose target is a TAG (an HVT, a
  // watch post) is never pinned. Falsified: dropping the `rect === null`
  // return turns the HVT into a mark at a missing rect and this goes red.
  it('never pins a hostile tag: wh_gate_rpg is not ground', () => {
    const marks = groundMarks(wh5());
    expect(JSON.stringify(marks)).not.toContain('wh_gate_rpg');
    expect(marks).toHaveLength(3);
  });

  it('draws an evacuation target as a refuge, once', () => {
    const marks = groundMarks({
      zones: { refuge: [1, 2, 3, 4] },
      objectives: [
        { type: 'evacuate_before', primary: true, target: 'refuge', text: 'Get them out' },
        { type: 'evacuate_before', primary: false, target: 'refuge', text: 'Again' },
      ],
    });
    expect(marks).toEqual([{ kind: 'refuge', zone: 'refuge', rect: { x: 1, y: 2, w: 3, h: 4 }, label: 'Get them out' }]);
  });

  it('every shipped mission yields only zones that exist on its own map', () => {
    for (const f of ['beit_sahwan_2_foothold', 'qarn_hadid_2_foothold', 'umm_zeitoun_4_clearance', 'khan_rafid_2_foothold']) {
      const m = json(`data/missions/${f}.json`) as { map: { file: string; player_start: number[] }; objectives: GroundMarkInputs['objectives']; roe?: { flagged_zones?: string[] } };
      const map = json(`data/maps/${m.map.file}.json`) as { zones: Record<string, number[]> };
      const marks = groundMarks({ playerStart: m.map.player_start, zones: map.zones, objectives: m.objectives, flaggedZones: m.roe?.flagged_zones });
      for (const k of marks) if (k.kind !== 'start') expect(map.zones[k.zone], `${f}: ${k.zone}`).toBeDefined();
      expect(marks.some((k) => k.kind === 'objective'), f).toBe(true);
    }
  });
});
