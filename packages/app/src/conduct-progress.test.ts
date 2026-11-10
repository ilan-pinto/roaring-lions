import { describe, expect, it } from 'vitest';
import { withConductProgress } from './conduct-progress';

const row = (over: Partial<{ id: string; type: string; text: string; status: string; threshold: number }> = {}) => ({
  id: 'g',
  type: 'no_collateral_above',
  text: 'Keep Conduct up',
  status: 'active',
  threshold: 70,
  primary: true,
  ...over,
});

describe('withConductProgress (GH-4)', () => {
  it('stamps an active guard with the live Conduct against its threshold', () => {
    const out = withConductProgress([row()], 82);
    expect(out[0].text).toBe('Keep Conduct up (Conduct 82/70)');
  });

  it('leaves a non-guard objective untouched', () => {
    const hold = { id: 'h', type: 'survive_until', text: 'Hold', status: 'active', primary: true };
    expect(withConductProgress([hold], 82)[0]).toEqual(hold);
  });

  it('leaves a decided guard as authored', () => {
    const out = withConductProgress([row({ status: 'failed' }), row({ status: 'complete' })], 50);
    expect(out[0].text).toBe('Keep Conduct up');
    expect(out[1].text).toBe('Keep Conduct up');
  });

  it('passes a mission with no guard straight through', () => {
    const rows = [{ id: 'h', type: 'survive_until', text: 'Hold', status: 'active', primary: true }];
    expect(withConductProgress(rows, 82)).toEqual(rows);
  });
});
