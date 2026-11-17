import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND_DIR, BRAND_MARKS, brandMarkFailures } from '../validate_ui_palette.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('BRAND_MARKS (GH-1075 U4)', () => {
  it('is pinned to the one Google G file', () => {
    expect(BRAND_MARKS).toEqual(['assets/brand/google-g.svg']);
  });

  it('the real directory holds exactly the named marks', () => {
    const present = readdirSync(`${ROOT}${BRAND_DIR}`).map((f) => `${BRAND_DIR}/${f}`);
    expect(brandMarkFailures(present)).toEqual([]);
  });

  it('a file added to assets/brand/ without being named fails', () => {
    const f = brandMarkFailures(['assets/brand/google-g.svg', 'assets/brand/other.svg']);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('assets/brand/other.svg');
  });

  it('a named mark that is missing fails', () => {
    expect(brandMarkFailures([])).toHaveLength(1);
  });
});
