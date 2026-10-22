import { describe, expect, it } from 'vitest';
import { woundRecordText } from './service-record';
import { deployRosterView } from './deploy-roster';

describe('woundRecordText (GH-707 P2)', () => {
  it('is empty until a count is above zero, so every earlier save reads unchanged', () => {
    expect(woundRecordText(undefined)).toBe('');
    expect(woundRecordText({})).toBe('');
    expect(woundRecordText({ wounded_in_action: 0, rescued: 0 })).toBe('');
  });

  it('words both counts, with an absent one as zero', () => {
    expect(woundRecordText({ wounded_in_action: 3, rescued: 2 })).toBe('3 men wounded · 2 rescued');
    expect(woundRecordText({ wounded_in_action: 1 })).toBe('1 man wounded · 0 rescued');
    expect(woundRecordText({ rescued: 4 })).toBe('0 men wounded · 4 rescued');
  });
});

describe('the deploy row carries the wound counts only when they are non-zero (GH-707 P2)', () => {
  const mission = { ledger: { requires: ['roster.surviving_units'] }, starting_force: [{ unit: 'inf_squad', count: 2, from_ledger: true }] };
  it('a scarred squad keeps its counts; a clean one gains no keys', () => {
    const v = deployRosterView(
      mission,
      {
        'roster.surviving_units': [
          { type: 'inf_squad', veterancy: 1, missions: 3, kills: 2, wounded_in_action: 3, rescued: 2 },
          { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0 },
        ],
      },
      (id) => id
    );
    expect(v?.eligible[0]).toMatchObject({ wounded_in_action: 3, rescued: 2 });
    expect(Object.keys(v?.eligible[1] ?? {})).not.toContain('wounded_in_action');
    expect(Object.keys(v?.eligible[1] ?? {})).not.toContain('rescued');
  });
});
