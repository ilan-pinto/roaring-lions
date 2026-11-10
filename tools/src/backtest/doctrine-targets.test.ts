import { describe, expect, it } from 'vitest';
import { unitsAtMaxTier, withRoster } from './harness';
import {
  ambush,
  ambushPasses,
  ambushReading,
  raidCaught,
  raidCaughtPasses,
  raidEscape,
  raidEscapePasses,
  raidReading,
} from './targets';

/**
 * The two GDD §5.7 doctrine targets that landed with GH-26 (Ambush/Ashwar and
 * Raid/Rif). Standoff/Sarim is gated separately by GH-865 (`standoff-gate.test.ts`).
 *
 * Every literal below is a reading re-run on this branch, not imagined:
 *
 *   Ambush (200 seeds, MBT-led non-recon column, RPG in ambush(3), cover 2):
 *     base 100% volley-first (held fire ≤3.5 tiles AND before identified) ·
 *     max tier 100%. Red arm WITHOUT the stance (fires at ~4.1 tiles): 0% at
 *     both tiers — removing `setAmbush` turns the test red. A second red arm
 *     (signature 3.0 ≈ 6.7× shipped 0.45) reads 0%: the column identifies the
 *     team before the held volley, so the "before identified" bar is also live.
 *
 *   Raid escape (200 seeds × 3 technicals, engage + disengage vs 2 rifles + APC):
 *     base 98% survive · max tier 99% (gate ≥60%)
 *     red arm (no disengage): base 42% · max tier 31% survive
 *
 *   Raid caught (200 seeds × 1 caught technical):
 *     base 6.1 s median time-to-die · max tier 6.1 s (gate ≤10 s)
 *     red arm (2× hp = 1200): base 12.0 s · max tier 11.3 s — a durability buff,
 *     not a mobility one, which is exactly what "mobility is their armour" forbids.
 *
 * The one-line falsifications (invert the identification test; count every
 * technical as escaped) are recorded in the commit message, as CLAUDE.md requires.
 */
const SEEDS = 200;
const TICKS_PER_SECOND = 20;

describe('Ambush (Ashwar) gate (GH-26)', () => {
  it('passes at both tiers with margin', () => {
    const base = ambushReading({}, SEEDS);
    const max = withRoster(unitsAtMaxTier, () => ambushReading({}, SEEDS));
    expect(base.volleyFirstPct).toBeGreaterThanOrEqual(90); // 100 read
    expect(base.heldPct).toBeGreaterThanOrEqual(90); // 100 read — the stance held fire
    expect(base.firedPct).toBeGreaterThanOrEqual(90); // 100 read
    expect(base.identifiedPct).toBeGreaterThanOrEqual(90); // 100 read
    expect(max.volleyFirstPct).toBeGreaterThanOrEqual(90); // 100 read
    expect(max.heldPct).toBeGreaterThanOrEqual(90); // 100 read
    expect(ambushPasses(base)).toBe(true);
    expect(ambushPasses(max)).toBe(true);
  }, 60_000);

  it('the shipped target row reads PASS at both tiers', () => {
    expect(ambush(SEEDS).pass).toBe(true);
    expect(withRoster(unitsAtMaxTier, () => ambush(SEEDS)).pass).toBe(true);
  }, 60_000);

  it('goes red without the ambush stance (the RPG fires at max range), both tiers', () => {
    const base = ambushReading({ stance: false }, SEEDS);
    const max = withRoster(unitsAtMaxTier, () => ambushReading({ stance: false }, SEEDS));
    expect(base.heldPct).toBeLessThanOrEqual(10); // 0 read: the volley goes out at ~4.1 tiles
    expect(base.volleyFirstPct).toBeLessThan(80); // 0 read
    expect(max.volleyFirstPct).toBeLessThan(80); // 0 read
    expect(ambushPasses(base)).toBe(false);
    expect(ambushPasses(max)).toBe(false);
  }, 60_000);

  it('goes red when the team is too visible (signature 3.0), both tiers', () => {
    const base = ambushReading({ signature: 3.0 }, SEEDS);
    const max = withRoster(unitsAtMaxTier, () => ambushReading({ signature: 3.0 }, SEEDS));
    expect(base.volleyFirstPct).toBeLessThan(80); // 0 read
    expect(max.volleyFirstPct).toBeLessThan(80); // 0 read
    expect(ambushPasses(base)).toBe(false);
    expect(ambushPasses(max)).toBe(false);
  }, 60_000);
});

describe('Raid (Rif) gate (GH-26)', () => {
  it('escape passes at both tiers with margin', () => {
    const base = raidReading({ techCount: 3, disengage: true }, SEEDS);
    const max = withRoster(unitsAtMaxTier, () => raidReading({ techCount: 3, disengage: true }, SEEDS));
    expect(base.survivedPct).toBeGreaterThanOrEqual(80); // 98 read
    expect(base.firedPct).toBeGreaterThanOrEqual(90); // 100 read
    expect(max.survivedPct).toBeGreaterThanOrEqual(80); // 99 read
    expect(raidEscapePasses(base)).toBe(true);
    expect(raidEscapePasses(max)).toBe(true);
  }, 60_000);

  it('a caught technical dies fast at both tiers', () => {
    const base = raidReading({ techCount: 1, disengage: false }, SEEDS);
    const max = withRoster(unitsAtMaxTier, () => raidReading({ techCount: 1, disengage: false }, SEEDS));
    expect(base.caughtPct).toBeGreaterThanOrEqual(90); // 100 read
    expect(base.medianTtdTicks).toBeLessThanOrEqual(8 * TICKS_PER_SECOND); // 6.1 s read
    expect(max.medianTtdTicks).toBeLessThanOrEqual(8 * TICKS_PER_SECOND); // 6.1 s read
    expect(raidCaughtPasses(base)).toBe(true);
    expect(raidCaughtPasses(max)).toBe(true);
  }, 60_000);

  it('the shipped target rows read PASS at both tiers', () => {
    expect(raidEscape(SEEDS).pass).toBe(true);
    expect(raidCaught(SEEDS).pass).toBe(true);
    expect(withRoster(unitsAtMaxTier, () => raidEscape(SEEDS)).pass).toBe(true);
    expect(withRoster(unitsAtMaxTier, () => raidCaught(SEEDS)).pass).toBe(true);
  }, 60_000);

  it('goes red when the technicals cannot disengage (caught raid), both tiers', () => {
    const base = raidReading({ techCount: 3, disengage: false }, SEEDS);
    const max = withRoster(unitsAtMaxTier, () => raidReading({ techCount: 3, disengage: false }, SEEDS));
    expect(base.survivedPct).toBeLessThan(60); // 42 read
    expect(max.survivedPct).toBeLessThan(60); // 31 read
    expect(raidEscapePasses(base)).toBe(false);
    expect(raidEscapePasses(max)).toBe(false);
  }, 60_000);

  it('goes red when a caught technical is tankier (2× hp), both tiers', () => {
    const base = raidReading({ techCount: 1, disengage: false, techHp: 1200 }, SEEDS);
    const max = withRoster(unitsAtMaxTier, () => raidReading({ techCount: 1, disengage: false, techHp: 1200 }, SEEDS));
    expect(base.medianTtdTicks).toBeGreaterThan(10 * TICKS_PER_SECOND); // 12.0 s read
    expect(raidCaughtPasses(base)).toBe(false);
    expect(raidCaughtPasses(max)).toBe(false);
  }, 60_000);
});
