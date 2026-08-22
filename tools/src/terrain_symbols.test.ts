// The terrain legend against the data gate's copy of it.
//
// TERRAIN_LEGEND lives in packages/data/src/map.ts. tools/validate_data.mjs is a
// Node script that cannot load TypeScript, so it hardcodes the same set. Two
// lists, one truth.
//
// The old guard was a hardcoded array in map.test.ts plus a comment asking the
// next author to update the validator -- a tripwire, not a check. An author who
// updated the test and forgot the .mjs got green tests and a map the data gate
// rejects. This reads the validator's actual source instead, so the drift is
// impossible rather than merely rude.
//
// Reading source and regexing a literal is ugly. It is worth it: the last time
// two copies of one idea drifted in this repo, tunnel registration went missing
// from playtest.ts and the harness was dead for two days with every test green.
//
// tools/ is the only place that may look at both, which is why this lives here
// alongside protected_sites.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TERRAIN_LEGEND } from '@lions/data';

const ROOT = join(import.meta.dirname, '..', '..');

/** The TERRAIN_SYMBOLS set literal, read out of the validator's source. */
function validatorSymbols(): string[] {
  const src = readFileSync(join(ROOT, 'tools/validate_data.mjs'), 'utf8');
  const decl = /const TERRAIN_SYMBOLS = new Set\(\[([^\]]*)\]\)/.exec(src);
  if (decl === null) {
    throw new Error(
      'could not find `const TERRAIN_SYMBOLS = new Set([...])` in tools/validate_data.mjs — ' +
        'if it was renamed or reformatted, update this regex, do not delete this test'
    );
  }
  return [...decl[1].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((m) => m[1]);
}

describe('the terrain legend and the data gate agree', () => {
  it('finds the validator declaration at all', () => {
    // Guards the regex itself: a silently-empty match would make every other
    // assertion here vacuously interesting rather than false.
    expect(validatorSymbols().length).toBeGreaterThan(0);
  });

  it('declares exactly the same symbols in both places', () => {
    expect(validatorSymbols().sort()).toEqual(Object.keys(TERRAIN_LEGEND).sort());
  });
});
