// The `kitted` flake (CI run 38092145339): a sandbox capture whose frame loop
// froze anywhere but tick 0 draws its squads from a different pre-freeze frame
// and must be refused (`lateFreezeRefusal`, `capture-protocol.ts`).
import { describe, expect, it } from 'vitest';
import { REQUIRED_FREEZE_TICK, lateFreezeRefusal } from './capture-protocol';

describe('lateFreezeRefusal', () => {
  it('lets a capture frozen at tick 0 through', () => {
    expect(REQUIRED_FREEZE_TICK).toBe(0);
    expect(lateFreezeRefusal(0)).toBeNull();
  });

  it('refuses every later freeze, naming the tick it landed on', () => {
    // 1 and 3 are the two late freezes read back on the running game; one
    // tick is already 8857 px on `kitted`.
    for (const tick of [1, 2, 3, 20]) {
      const why = lateFreezeRefusal(tick);
      expect(why).not.toBeNull();
      expect(why).toContain(`froze at tick ${tick}`);
    }
  });
});
