import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { briefingGlance, objectiveClock, type GlanceInputs } from './briefing-glance';
import { briefingBeats } from './loading';

const json = (p: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8'));

/** Wadi Halam V straight from the shipped data, the mission in the lead's screenshot. */
function wh5(): GlanceInputs {
  const m = json('data/missions/wadi_halam_5_depot.json') as {
    briefing: string;
    target_minutes: number;
    map: { time_of_day: string };
    objectives: GlanceInputs['objectives'];
    roe: GlanceInputs['roe'];
  };
  const map = json('data/maps/wadi_halam_5.json') as { name: string };
  return {
    mapName: map.name,
    timeOfDay: m.map.time_of_day,
    targetMinutes: m.target_minutes,
    beats: briefingBeats(m.briefing),
    objectives: m.objectives,
    roe: m.roe,
    zoneName: (z) => (z === 'hall_block' ? 'civic hall' : null),
  };
}

const row = (rows: ReturnType<typeof briefingGlance>, key: string): string | undefined => rows.find((r) => r.key === key)?.text;

describe('briefingGlance (GH-417, derived, never authored)', () => {
  it('answers all five questions for Wadi Halam V from its own data', () => {
    const rows = briefingGlance(wh5());
    expect(rows.map((r) => r.key)).toEqual(['where', 'happened', 'objective', 'matters', 'avoid']);
    expect(row(rows, 'where')).toMatch(/^Wadi Halam .+ · dawn · about 7 minutes$/);
    expect(row(rows, 'happened')).toMatch(/^Seven structures inside Hallaq's depot/);
    expect(row(rows, 'objective')).toBe('Raze the depot inside five minutes, then 2 more');
    // fail_below 40 -> the second star's floor is 60 (grade.ts: + STAR_ROE_MARGIN).
    expect(row(rows, 'matters')).toContain('Conduct 60 or better earns the second star');
    expect(row(rows, 'avoid')).toContain('No fire on the civic hall');
    expect(row(rows, 'avoid')).toContain('Conduct below 40 ends the mission');
    expect(row(rows, 'avoid')).toContain('5:00 limit on “Raze the depot inside five minutes”');
  });

  it('prefers the Situation section to the first beat when the briefing is sectioned', () => {
    const rows = briefingGlance({
      ...wh5(),
      sections: [
        { id: 'mission', beats: ['Not this.'] },
        { id: 'situation', beats: ['This one.', 'Not the second.'] },
      ],
    });
    expect(row(rows, 'happened')).toBe('This one.');
  });

  it('names the third star only when a secondary carries', () => {
    const base = wh5();
    expect(row(briefingGlance(base), 'matters')).not.toContain('third star');
    const carrying = {
      ...base,
      objectives: [...base.objectives, { type: 'locate', primary: false, carries: true, text: 'Mark the cache' }],
    };
    expect(row(briefingGlance(carrying), 'matters')).toContain('The third star needs Mark the cache');
  });

  // Falsified: pushing an empty "Avoid" row anyway turns this red.
  it('omits a row with nothing true to say instead of padding it', () => {
    const rows = briefingGlance({ objectives: [{ type: 'hold_for', primary: true, text: 'Hold', seconds: 60 }] });
    expect(rows.map((r) => r.key)).toEqual(['objective', 'matters']);
  });

  it('a clock to endure is not a deadline, and not something to avoid', () => {
    expect(objectiveClock({ type: 'hold_for', primary: true, seconds: 240 })).toBe('hold 4:00');
    expect(objectiveClock({ type: 'raze', primary: true, seconds: 300 })).toBe('5:00 limit');
    expect(objectiveClock({ type: 'raze', primary: true })).toBeNull();
    const rows = briefingGlance({ objectives: [{ type: 'hold_for', primary: true, text: 'Hold', seconds: 240 }] });
    expect(row(rows, 'avoid')).toBeUndefined();
  });
});
