// `two-engine.ts` drives three real browsers and is run only by CI's `visual`
// job; what it DECIDES is `verdict`, tested here on hand-written readings.
import { describe, it, expect } from 'vitest';
import { verdict, type EngineReading } from './two-engine-verdict';

const TARGET = 600;
const FIRST_ORDER = 10;
const at = (hash: number, over: Partial<EngineReading> = {}): EngineReading => ({
  bootTick: 0,
  bootUnits: 14,
  bootHostiles: 9,
  tick: TARGET,
  hash,
  ...over,
});

describe('two-engine verdict', () => {
  it('passes three engines that agree, naming the hash', () => {
    const v = verdict({ chromium: at(41717), firefox: at(41717), webkit: at(41717) }, TARGET, FIRST_ORDER);
    expect(v.ok).toBe(true);
    expect(v.message).toBe('PASS: 3 engines, tick 600, hash 41717');
  });

  it('fails when one engine of three reports a different hash', () => {
    const v = verdict({ chromium: at(9001), firefox: at(9002), webkit: at(9001) }, TARGET, FIRST_ORDER);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: engines disagree/);
  });

  it('fails when an engine stopped short of the target tick, even with equal hashes', () => {
    const v = verdict({ chromium: at(7), firefox: at(7, { tick: TARGET - 1 }), webkit: at(7) }, TARGET, FIRST_ORDER);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: an engine missed the target tick 600/);
  });

  it('fails when an engine had run past the first order before the script started', () => {
    const v = verdict({ chromium: at(7), firefox: at(7, { bootTick: FIRST_ORDER + 1 }), webkit: at(7) }, TARGET, FIRST_ORDER);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: boot not comparable: firefox had already passed tick 10/);
  });

  it('fails when the engines spawned different forces', () => {
    const v = verdict({ chromium: at(7), firefox: at(7), webkit: at(7, { bootHostiles: 8 }) }, TARGET, FIRST_ORDER);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: boot not comparable: the engines spawned different forces/);
  });

  it('fails a lone engine: one reading agrees with itself whatever it computed', () => {
    expect(verdict({ chromium: at(7) }, TARGET, FIRST_ORDER).ok).toBe(false);
    expect(verdict({}, TARGET, FIRST_ORDER).ok).toBe(false);
  });
});
