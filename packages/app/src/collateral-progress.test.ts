import { describe, expect, it } from 'vitest';
import { withCollateralProgress } from './collateral-progress';

const row = (over: Partial<{ id: string; text: string; status: string; collateral: { lost: number; limit: number } }> = {}) => ({
  id: 'clean',
  text: 'Keep the civilians out of it',
  status: 'active',
  collateral: { lost: 15, limit: 30 },
  ...over,
});

describe('withCollateralProgress (GH-4)', () => {
  it('words an active ceiling with what has been lost against what is allowed', () => {
    expect(withCollateralProgress([row()])[0].text).toBe('Keep the civilians out of it (Conduct lost 15 of 30)');
  });
  it('follows the live numbers, row by row', () => {
    const out = withCollateralProgress([row({ collateral: { lost: 0, limit: 10 } }), row({ id: 'b', collateral: { lost: 10, limit: 10 } })]);
    expect(out.map((r) => r.text)).toEqual([
      'Keep the civilians out of it (Conduct lost 0 of 10)',
      'Keep the civilians out of it (Conduct lost 10 of 10)',
    ]);
  });
  it('keeps the authored text once the objective is decided: the tally is progress, and none is left', () => {
    for (const status of ['complete', 'failed']) {
      expect(withCollateralProgress([row({ status })])[0].text).toBe('Keep the civilians out of it');
    }
  });
  it('passes every other row through untouched, as the same object', () => {
    const other = { id: 'hold', text: 'Hold the ridge', status: 'active' };
    expect(withCollateralProgress([other])[0]).toBe(other);
  });
  it('keeps the row\'s other fields', () => {
    expect(withCollateralProgress([{ ...row(), primary: true }])[0]).toMatchObject({ id: 'clean', primary: true, status: 'active' });
  });
});
