import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VET_ACC_BONUS, VET_SUPP_BONUS, veteranEffect } from './veteran-effect';

const tuning = readFileSync(resolve(process.cwd(), 'packages/sim/src/tuning.ts'), 'utf8');
const declared = (name: string): number => {
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(tuning);
  if (!m) throw new Error(`${name} not found in tuning.ts`);
  return Number(m[1]);
};

describe('veteranEffect', () => {
  // The copy is pinned against the sim's own source, as text. Falsified:
  // changing either copy here by one turns this red.
  it('copies the sim tuning exactly', () => {
    expect(VET_ACC_BONUS).toBe(declared('VET_ACC_BONUS'));
    expect(VET_SUPP_BONUS).toBe(declared('VET_SUPP_BONUS'));
  });
  it('words one, two and three stripes, and nothing for none', () => {
    expect(veteranEffect(0)).toBeNull();
    expect(veteranEffect(1)).toBe('+6% aim · −8% suppression');
    expect(veteranEffect(2)).toBe('+12% aim · −16% suppression');
    expect(veteranEffect(3)).toBe('+18% aim · −24% suppression');
  });
});
