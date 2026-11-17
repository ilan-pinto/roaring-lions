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
 *
 * TUNING JOINS THE FINGERPRINT, BY VALUE (slice 2, the sim-guard review of PR 1457, note 1). A tuning edit changes what a match does, so a
 * save made before it would resume into other rules; and a constant that no pin world happens to exercise would move no pin. So the
 * fingerprint also folds every non-function export of `packages/sim/src/tuning.ts`, serialised by VALUE: a comment, a rename of an unexported
 * local or a reformat changes nothing, a changed number does. The price is deliberate: every tuning edit now touches `sim-epoch.ts` (the
 * epoch, if the change matters to a save, and always the fingerprint), exactly as a moved golden hash already does. Balance is parked, so
 * the first such edit is some time off; when it comes this test is what makes it ask the question.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fnv1a32 } from '@lions/net';
import { SIM_EPOCH, SIM_EPOCH_RECORD } from '@lions/sim';
import * as tuning from '../../packages/sim/src/tuning';

const SOURCE = readFileSync(join(__dirname, '../../packages/sim/src/determinism.test.ts'), 'utf8');

/** Every named pin (`const X_PIN = 123;`) and every unnamed golden (`.hash()).toBe(123456789)`), as sorted `name=value` pairs. */
function goldenPins(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^const ([A-Z][A-Z0-9_]*PIN[A-Z0-9_]*) = (\d+);/gm)) out.push(`${m[1]}=${m[2]}`);
  for (const m of source.matchAll(/\.hash\(\)\)\.toBe\((\d{8,})\)/g)) out.push(`hash=${m[1]}`);
  return [...new Set(out)].sort();
}
/** The tuning module's values, as one pin: every non-function export, by name, serialised by value (Map and Set included). */
function tuningPin(mod: Readonly<Record<string, unknown>>): string {
  const plain = (_k: string, v: unknown): unknown => (v instanceof Map ? ['Map', [...v]] : v instanceof Set ? ['Set', [...v]] : typeof v === 'bigint' ? `${v}n` : v);
  const parts = Object.keys(mod)
    .sort()
    .filter((k) => typeof mod[k] !== 'function')
    .map((k) => `${k}:${JSON.stringify(mod[k], plain)}`);
  return `tuning=${fnv1a32(parts.join('|')) >>> 0}/${parts.length}`;
}
const fingerprintOf = (pins: readonly string[]): number => fnv1a32(pins.join(';')) >>> 0;
const allPins = (): string[] => [...goldenPins(SOURCE), tuningPin(tuning)].sort();

describe('the sim epoch follows the golden pins (GH-1393 G9)', () => {
  it('finds the pins it is meant to guard: a broken pattern would pass for any sim change', () => {
    const pins = goldenPins(SOURCE);
    const names = pins.map((p) => p.split('=')[0]);
    for (const n of ['ECONOMY_PIN', 'ECONOMY_PIN_RELIEF', 'WOUNDED_WORLD_PIN', 'FORMATION_WORLD_PIN']) expect(names, n).toContain(n);
    expect(pins.filter((p) => p.startsWith('hash=')).length).toBeGreaterThanOrEqual(3);
  });

  it('the fingerprint recorded beside the epoch is the one the pins hash to; if this fails, bump SIM_EPOCH_RECORD.epoch and its fingerprint in one edit', () => {
    expect(fingerprintOf(allPins())).toBe(SIM_EPOCH_RECORD.fingerprint);
  });

  it('the tuning pin reads values: a changed number moves it, a comment-only or unrelated change does not, and it covers the whole module', () => {
    const base = tuningPin(tuning);
    const count = Number(base.split('/')[1]);
    expect(count).toBeGreaterThan(100); // 168 exports today, most of them values
    // a changed value moves it (the constructed input that makes the check fail)
    const edited = { ...tuning, [Object.keys(tuning).find((k) => typeof (tuning as Record<string, unknown>)[k] === 'number') ?? '']: 12345.5 };
    expect(tuningPin(edited)).not.toBe(base);
    // a function export, or the same values in another key order, is not a change
    expect(tuningPin({ ...tuning, someFunction: () => 1 })).toBe(base);
    expect(tuningPin(Object.fromEntries(Object.entries(tuning).reverse()))).toBe(base);
    // an object value is read inside, not by reference
    expect(tuningPin({ a: { x: 1 } })).not.toBe(tuningPin({ a: { x: 2 } }));
    expect(tuningPin({ a: new Map([[1, 2]]) })).not.toBe(tuningPin({ a: new Map([[1, 3]]) }));
  });

  it('the epoch is a positive integer and is the one the record holds', () => {
    expect(Number.isInteger(SIM_EPOCH) && SIM_EPOCH >= 1).toBe(true);
    expect(SIM_EPOCH).toBe(SIM_EPOCH_RECORD.epoch);
  });
});
