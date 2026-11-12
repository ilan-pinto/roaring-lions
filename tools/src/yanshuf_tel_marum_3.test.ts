// GH-698 (the lead's ruling of 12 Nov 2026): the Yanshuf joins a campaign mission, authored through the mission pipeline. Tel Marum III
// is the one: its briefing says the narrow corridor is "passable on foot and to nothing on wheels or tracks", and the relay and the
// battery lie behind the wall, so a helicopter-borne squad changes an objective the mission already has. This pins the data that does it.
// The playtest proves the mission stays winnable with it (credit ladder 6955 and star ladder 68 unchanged); this proves it is there.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;

interface Trigger {
  id: string;
  label?: string;
  on: { kind: string; value?: number };
  do: { kind: string; units?: { unit: string; count: number; marker?: string }[] };
}
interface Mission {
  id: string;
  map: { file: string };
  starting_force: { unit: string; count: number }[];
  triggers: Trigger[];
}

const MISSION = 'data/missions/tel_marum_3_clearance.json';

describe('the Yanshuf in Tel Marum III (GH-698)', () => {
  const m = read<Mission>(MISSION);
  const yanshufs = m.triggers.filter((t) => t.do.units?.some((u) => u.unit === 'heli_yanshuf'));

  it('arrives by exactly one reinforce trigger: one helicopter, at the start line, 45 seconds in', () => {
    expect(yanshufs).toHaveLength(1);
    const t = yanshufs[0];
    expect(t.on).toEqual({ kind: 'timer_s', value: 45 });
    expect(t.do.kind).toBe('reinforce');
    expect(t.do.units).toEqual([{ unit: 'heli_yanshuf', count: 1, marker: 'start_line' }]);
  });

  it('is a reinforcement and not a starting force: a starting unit would shift every enemy unit\'s id and random stream', () => {
    expect(m.starting_force.some((p) => p.unit === 'heli_yanshuf')).toBe(false);
  });

  it('is labelled in the mission\'s voice: at most 48 characters and no full stop (the feed shows nothing for an unlabelled trigger)', () => {
    const label = yanshufs[0].label ?? '';
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(48);
    expect(label.endsWith('.')).toBe(false);
  });

  it('names a marker the map has, and a unit that is a six-seat air carrier gated behind Conduct and a price (so it arrives on loan)', () => {
    const map = read<{ markers: Record<string, number[]> }>(`data/maps/${m.map.file}.json`);
    expect(map.markers.start_line).toEqual([24, 44]);
    const unit = read<{ mobility: { domain: string }; hull: { transport_slots: number }; unlock: { roe_rating_min: number; price: number } }>(
      'data/units/kdf/heli_yanshuf.json',
    );
    expect(unit.mobility.domain).toBe('air');
    expect(unit.hull.transport_slots).toBe(6);
    expect(unit.unlock).toEqual({ roe_rating_min: 84, price: 500 });
  });

  it('is the only shipped mission that fields one yet', () => {
    const dir = join(ROOT, 'data', 'missions');
    const fielding = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('"heli_yanshuf"'));
    expect(fielding).toEqual(['tel_marum_3_clearance.json']);
  });
});
