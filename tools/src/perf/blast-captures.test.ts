import { describe, expect, it } from 'vitest';
import { BLAST_SUBJECTS, SAMPLE_MS, sampleLadder, sheetIndex } from './blast-captures';

describe('the ten-second ladder', () => {
  // G0 #14: "judge on 10 s of motion". 200 ms is the coarsest step at which a
  // 450 ms fireball still lands on more than one frame -- a ladder that can
  // miss the fireball entirely would photograph the smoke and call it a blast.
  it('covers ten seconds inclusive of both ends, every 200 ms', () => {
    const ladder = sampleLadder(10_000, 200);
    expect(ladder[0]).toBe(0);
    expect(ladder[ladder.length - 1]).toBe(10_000);
    expect(ladder).toHaveLength(51);
    expect(SAMPLE_MS).toEqual(ladder);
  });

  it('samples the fireball at least three times before it is over', () => {
    // EXPLOSION_BURST_DEFAULT_DURATION_MS is 450.
    expect(SAMPLE_MS.filter((ms) => ms < 450).length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a step that does not divide the window, rather than silently truncating', () => {
    expect(() => sampleLadder(10_000, 300)).toThrow(/divide/);
  });
});

describe('the subject list', () => {
  // Both halves of the package, because a sheet that photographs only the
  // vehicle proves nothing about the mortar sharing at its own power.
  it('carries a vehicle kill and an indirect impact', () => {
    expect(BLAST_SUBJECTS.map((s) => s.mode)).toContain('kill');
    expect(BLAST_SUBJECTS.map((s) => s.mode)).toContain('impact');
  });
  it('gives every subject a distinct id and a tile on the open northern band', () => {
    const ids = BLAST_SUBJECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // rows 0-7 of beit_sahwan_outskirts are open ground end to end -- the same
    // band wreck-captures.ts parades on, and the reason it does.
    for (const s of BLAST_SUBJECTS) expect(s.y).toBeLessThanOrEqual(7);
  });
});

describe('sheetIndex', () => {
  // The index is the half of the evidence that survives R-E's git-ignored
  // storage: the PNGs live under .superpowers/ and the NUMBERS get quoted.
  it('names every capture condition, not just the file', () => {
    const md = sheetIndex('before', [
      { subject: 'mbt_lavi', mode: 'kill', ms: 200, zoom: 2.5, tick: 140, file: 'a.png' },
    ]);
    expect(md).toContain('before');
    expect(md).toContain('mbt_lavi');
    expect(md).toContain('200');
    expect(md).toContain('2.5');
    expect(md).toContain('140');
  });
});
