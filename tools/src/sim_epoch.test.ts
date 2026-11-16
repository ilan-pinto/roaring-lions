/**
 * G9 of the mid-mission save design (GH-1393): a golden pin that moves must move the sim epoch with it.
 *
 * A save records `SIM_EPOCH`, and a resume refuses a save from another epoch (`mission-save.ts`). The epoch is bumped by hand, so something
 * has to notice the day a sim change was made and the epoch was forgotten. The golden pins in `determinism.test.ts` are the sim's own
 * statement of "the behaviour changed deliberately" (CLAUDE.md: the golden hash changes only when sim code or tuning changes deliberately),
 * so this test reads them from that file's TEXT, folds them into one number, and holds it against `SIM_EPOCH_RECORD.fingerprint`, which lives
 * in the same literal as the epoch. Moving a pin turns this red; the fix is to bump the epoch and the fingerprint in one edit
 * (`packages/sim/src/sim-epoch.ts`), which is exactly the moment saves made before it should be refused.
 *
 * It reads text rather than importing the pins because they are file-local constants inside a test file; importing that file would run it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fnv1a32 } from '@lions/net';
import { SIM_EPOCH, SIM_EPOCH_RECORD } from '@lions/sim';

const SOURCE = readFileSync(join(__dirname, '../../packages/sim/src/determinism.test.ts'), 'utf8');

/** Every named pin (`const X_PIN = 123;`) and every unnamed golden (`.hash()).toBe(123456789)`), as sorted `name=value` pairs. */
function goldenPins(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^const ([A-Z][A-Z0-9_]*PIN[A-Z0-9_]*) = (\d+);/gm)) out.push(`${m[1]}=${m[2]}`);
  for (const m of source.matchAll(/\.hash\(\)\)\.toBe\((\d{8,})\)/g)) out.push(`hash=${m[1]}`);
  return [...new Set(out)].sort();
}
const fingerprintOf = (pins: readonly string[]): number => fnv1a32(pins.join(';')) >>> 0;

describe('the sim epoch follows the golden pins (GH-1393 G9)', () => {
  it('finds the pins it is meant to guard: a broken pattern would pass for any sim change', () => {
    const pins = goldenPins(SOURCE);
    const names = pins.map((p) => p.split('=')[0]);
    for (const n of ['ECONOMY_PIN', 'ECONOMY_PIN_RELIEF', 'WOUNDED_WORLD_PIN', 'FORMATION_WORLD_PIN']) expect(names, n).toContain(n);
    expect(pins.filter((p) => p.startsWith('hash=')).length).toBeGreaterThanOrEqual(3);
  });

  it('the fingerprint recorded beside the epoch is the one the pins hash to; if this fails, bump SIM_EPOCH_RECORD.epoch and its fingerprint in one edit', () => {
    expect(fingerprintOf(goldenPins(SOURCE))).toBe(SIM_EPOCH_RECORD.fingerprint);
  });

  it('the epoch is a positive integer and is the one the record holds', () => {
    expect(Number.isInteger(SIM_EPOCH) && SIM_EPOCH >= 1).toBe(true);
    expect(SIM_EPOCH).toBe(SIM_EPOCH_RECORD.epoch);
  });
});
