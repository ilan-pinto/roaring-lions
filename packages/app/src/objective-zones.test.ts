import { describe, expect, it } from 'vitest';
import { objectiveZonesFor } from './objective-zones';

const ZONES = { approach: [21, 22, 7, 5], ammo_draw: [30, 12, 3, 3] } as const;

describe('objectiveZonesFor', () => {
  it('outlines every active zone objective, not only the first -- Tel Marum II', () => {
    const out = objectiveZonesFor(
      [
        { id: 'hold_approach', type: 'hold_for', status: 'active', zone: 'approach', paused: 'unheld' },
        { id: 'kill_spotter', type: 'eliminate_hvt', status: 'active' },
        { id: 'burn_the_ammo_point', type: 'raze', status: 'active', zone: 'ammo_draw' },
      ],
      ZONES
    );
    expect(out.map((z) => z.id)).toEqual(['hold_approach', 'burn_the_ammo_point']);
    expect(out[0]).toEqual({ id: 'hold_approach', rect: ZONES.approach, state: 'unheld' });
    expect(out[1]).toEqual({ id: 'burn_the_ammo_point', rect: ZONES.ammo_draw, state: 'target' });
  });

  it('carries the hold state through: held when the clock runs, contested when it is fought over', () => {
    const [held] = objectiveZonesFor([{ id: 'h', type: 'hold_for', status: 'active', zone: 'approach' }], ZONES);
    expect(held.state).toBe('held');
    const [contested] = objectiveZonesFor(
      [{ id: 'h', type: 'capture', status: 'active', zone: 'approach', paused: 'contested' }],
      ZONES
    );
    expect(contested.state).toBe('contested');
  });

  it('drops a completed or failed objective, and one whose zone the map does not declare', () => {
    const out = objectiveZonesFor(
      [
        { id: 'done', type: 'hold_for', status: 'complete', zone: 'approach' },
        { id: 'lost', type: 'raze', status: 'failed', zone: 'ammo_draw' },
        { id: 'ghost', type: 'raze', status: 'active', zone: 'nowhere' },
      ],
      ZONES
    );
    expect(out).toEqual([]);
  });
});
