// applyMissionLocale — the mission-text locale overlay. See index.ts's own
// header comment on this section for the shape and why it lives beside the
// mission text rather than inside it.

import { describe, expect, it } from 'vitest';
import { applyMissionLocale, type MissionJson, type MissionLocaleOverlay } from './index';

function mission(): MissionJson {
  return {
    id: 'm1',
    name: 'Foothold',
    briefing: 'Take the ridge before dawn.',
    objectives: [
      { id: 'o1', text: 'Hold the crossing' },
      { id: 'o2', text: 'Clear the yard' },
    ],
    triggers: [
      { id: 't1', label: 'Enemy reinforcements arrive' },
      { id: 't2', label: 'Convoy departs' },
    ],
  };
}

describe('applyMissionLocale', () => {
  it('renames one objective and one trigger label, and leaves the rest identical', () => {
    const overlay: MissionLocaleOverlay = {
      m1: {
        objectives: { o1: 'Hold the ford' },
        triggers: { t1: 'Enemy reinforcements' },
      },
    };
    const out = applyMissionLocale(mission(), overlay);
    expect(out.objectives[0]).toEqual({ id: 'o1', text: 'Hold the ford' });
    expect(out.objectives[1]).toEqual(mission().objectives[1]);
    expect(out.triggers?.[0]).toEqual({ id: 't1', label: 'Enemy reinforcements' });
    expect(out.triggers?.[1]).toEqual(mission().triggers?.[1]);
    // Untouched fields carry the source text through unchanged.
    expect(out.name).toBe('Foothold');
    expect(out.briefing).toBe('Take the ridge before dawn.');
  });

  it('overlays name and briefing independently of objectives/triggers', () => {
    const overlay: MissionLocaleOverlay = {
      m1: { name: 'Point d’appui', briefing: 'Prenez la crête avant l’aube.' },
    };
    const out = applyMissionLocale(mission(), overlay);
    expect(out.name).toBe('Point d’appui');
    expect(out.briefing).toBe('Prenez la crête avant l’aube.');
    expect(out.objectives).toEqual(mission().objectives);
    expect(out.triggers).toEqual(mission().triggers);
  });

  it('is a no-op for a mission id the overlay does not name', () => {
    const overlay: MissionLocaleOverlay = { some_other_mission: { name: 'X' } };
    const m = mission();
    expect(applyMissionLocale(m, overlay)).toBe(m);
  });

  it('is a no-op for a null overlay -- the `en` case', () => {
    const m = mission();
    expect(applyMissionLocale(m, null)).toBe(m);
  });

  it('returns a new object, not the mission by reference, once it does overlay something', () => {
    const m = mission();
    const out = applyMissionLocale(m, { m1: { name: 'X' } });
    expect(out).not.toBe(m);
  });
});
