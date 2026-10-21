import { describe, expect, it } from 'vitest';
import { sandboxWorksMission } from './sandbox-works';

describe('sandboxWorksMission', () => {
  it('offers every buildable KDF type twice and nothing else', () => {
    const m = sandboxWorksMission(
      [
        { id: 'kdf_medic_station', buildable: {} },
        { id: 'kdf_workshop', buildable: {} },
        { id: 'militia_field_clinic', buildable: {} },
        { id: 'house', buildable: null },
        { id: 'kdf_unbuildable', buildable: null },
      ],
      []
    );
    expect(m.field_works).toEqual({ kdf_medic_station: 2, kdf_workshop: 2 });
  });

  it('carries a purse, and a primary no session reaches', () => {
    const m = sandboxWorksMission([], [{ unit: 'demo_squad', at: [7, 25] }]);
    expect(m.starting_force).toEqual([{ unit: 'demo_squad', count: 1, at: [7, 25] }]);
    expect(m.resources?.logistics_start).toBe(5000);
    expect(m.objectives).toHaveLength(1);
    expect(m.objectives[0].seconds).toBe(86400);
  });
});
