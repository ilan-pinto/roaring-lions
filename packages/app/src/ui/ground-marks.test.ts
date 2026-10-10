import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { groundMarks, type GroundMarkInputs } from './ground-marks';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const json = (p: string): Record<string, unknown> => JSON.parse(readFileSync(ROOT + p, 'utf8'));

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
    // Both clocks: the raze limit AND the hold after it (review: the second was lost).
    expect(obj[0]).toMatchObject({ zone: 'depot', rect: { x: 29, y: 5, w: 12, h: 12 }, numbers: [1, 3], clocks: ['5:00 limit', 'hold 4:00'], refuge: false });
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

  it('draws an evacuation-only zone as a refuge, once, with its numbers', () => {
    const marks = groundMarks({
      zones: { refuge: [1, 2, 3, 4] },
      objectives: [
        { type: 'evacuate_before', primary: true, target: 'refuge', text: 'Get them out', seconds: 120 },
        { type: 'evacuate_before', primary: false, target: 'refuge', text: 'Again' },
      ],
    });
    expect(marks).toEqual([
      { kind: 'objective', zone: 'refuge', rect: { x: 1, y: 2, w: 3, h: 4 }, numbers: [1, 2], clocks: ['2:00 limit'], primary: true, refuge: true },
    ]);
  });

  // Review: Khan Rafid II holds the ward AND evacuates to it -- one mark, not
  // two stacked rects with colliding labels, and it is ground to hold.
  it('merges a refuge into an objective on the same zone', () => {
    const marks = groundMarks({
      zones: { ward: [0, 0, 2, 2] },
      objectives: [
        { type: 'hold_for', primary: true, target: 'ward', seconds: 120 },
        { type: 'evacuate_before', primary: true, target: 'ward', seconds: 300 },
      ],
    });
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ numbers: [1, 2], clocks: ['hold 2:00', '5:00 limit'], refuge: false });
  });

  // Every shipped mission: each mark is a zone its own map declares (so no
  // tag -- an HVT, a watch post -- can ever become a pin), and every mission
  // whose objectives name ground gets at least one mark.
  it('every shipped mission marks only zones on its own map', () => {
    const files = readdirSync(ROOT + 'data/missions').filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const m = json(`data/missions/${f}`) as { map: { file: string; player_start?: number[] }; objectives: GroundMarkInputs['objectives']; roe?: { flagged_zones?: string[] } };
      const map = json(`data/maps/${m.map.file}.json`) as { zones?: Record<string, number[]> };
      const zones = map.zones ?? {};
      const marks = groundMarks({ playerStart: m.map.player_start, zones, objectives: m.objectives, flaggedZones: m.roe?.flagged_zones });
      for (const k of marks) if (k.kind !== 'start') expect(Object.keys(zones), `${f}: ${k.zone}`).toContain(k.zone);
      const namesGround = m.objectives.some((o) => o.target !== undefined && zones[o.target] !== undefined);
      expect(marks.some((k) => k.kind === 'objective'), f).toBe(namesGround);
    }
  });
});
