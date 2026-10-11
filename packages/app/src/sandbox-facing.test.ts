import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ONE } from '@lions/sim';
import { hostileFacing } from './sandbox-facing';

describe('hostileFacing', () => {
  it('matches the old Math.atan2 conversion within 2 Q16.16 units on a sweep of offsets', () => {
    for (let dx = -40; dx <= 40; dx += 7) {
      for (let dy = -40; dy <= 40; dy += 5) {
        if (dx === 0 && dy === 0) continue;
        const turns = Math.atan2(dy, dx) / (Math.PI * 2);
        const old = Math.round((turns - Math.floor(turns)) * ONE) % ONE;
        const now = hostileFacing(0, 0, -dx, -dy); // friendly - hostile = (dx, dy)
        const diff = Math.min(Math.abs(now - old), ONE - Math.abs(now - old));
        expect(diff, `offset (${dx}, ${dy})`).toBeLessThanOrEqual(2);
      }
    }
  });
  it('uses no transcendental Math', () => {
    // Read the source: the point is the engine-independence of the BOOT.
    const src = readFileSync(new URL('./sandbox-facing.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.(atan2|sin|cos|hypot|PI)/);
  });
});
