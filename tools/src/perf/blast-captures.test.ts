import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLAST_SUBJECTS,
  JOLT_LADDER_MS,
  LAYER_FLOORS,
  SAMPLE_MS,
  SHORT_LADDER_MS,
  layerVerdict,
  readingAccepted,
  subjectVotesOn,
  sampleLadder,
  sheetIndex,
} from './blast-captures';

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
  it('gives every subject a distinct id', () => {
    // `--only=<id>` selects on it and every file name carries it, so two
    // subjects sharing one would overwrite each other's ladder silently.
    const ids = BLAST_SUBJECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
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

describe('the subject list, after the relief and &nomesh subjects landed', () => {
  // The three comparison subjects parade on rows 0-7 of
  // beit_sahwan_outskirts, which are open ground end to end -- the same band
  // wreck-captures.ts parades on, and the reason it does. The four the AFTER
  // set added are deliberately NOT on it: two of them exist precisely to stand
  // on relief, and scoping this check to the parade is what keeps it meaning
  // something rather than being deleted.
  it('keeps every parade subject on the open northern band', () => {
    const parade = BLAST_SUBJECTS.filter((s) => s.map === undefined);
    expect(parade.length).toBeGreaterThanOrEqual(3);
    for (const s of parade) expect(s.y).toBeLessThanOrEqual(7);
  });

  it('puts the relief subjects on the two maps that have any', () => {
    const maps = BLAST_SUBJECTS.filter((s) => s.map !== undefined).map((s) => s.map);
    expect(maps).toContain('qarn_hadid');
    expect(maps).toContain('tel_marum');
  });

  it('spawns a real unit type for every subject whose id is not one', () => {
    // `id` is the subject's own name and doubles as the unit type only where
    // `typeId` is absent. Every after-set subject is named for what it
    // photographs rather than for what it spawns -- and carries its own
    // `ladderMs`, which is what tells the two groups apart -- so it MUST
    // declare one, or `spawnSubjects` looks up a type that does not exist and
    // the whole run dies at the first page.
    for (const s of BLAST_SUBJECTS) {
      if (s.ladderMs !== undefined) expect(s.typeId, `subject "${s.id}"`).toBeDefined();
    }
  });

  it('hand-ticks only a kill, because only a kill has a freeze to preserve', () => {
    // `triggerImpact` pumps its own 16 ms frames to the landing and starts its
    // ladder at a true zero, so it never went through `step(1)`'s latched frame
    // in the first place -- `handTick` there would claim a fix for a problem
    // that path does not have.
    for (const s of BLAST_SUBJECTS) {
      if (s.handTick === true) expect(s.mode, `subject "${s.id}"`).toBe('kill');
    }
  });
});

describe('the ladders the after-set added', () => {
  // 70 ms is `catastrophic_kill.json`'s own `hit_stop_ms` at full power, and
  // the whole complaint the jolt ladder answers is that the freeze runs FIRST
  // with the shake at exactly zero. A ladder whose rungs straddled that window
  // in one step would photograph a held frame and a shaken one and nothing in
  // between, which is the picture that reads as broken.
  it('resolves the 70 ms freeze at better than one frame per rung', () => {
    const inside = JOLT_LADDER_MS.filter((ms) => ms <= 70);
    expect(inside.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < inside.length; i++) expect(inside[i] - inside[i - 1]).toBeLessThanOrEqual(16);
  });

  it('runs past the authored shake duration, so the jolt is seen ending', () => {
    // `screen_shake.duration_ms` is 420.
    expect(JOLT_LADDER_MS[JOLT_LADDER_MS.length - 1]).toBeGreaterThan(420);
  });

  it('keeps the short ladder short enough to be worth taking', () => {
    expect(SHORT_LADDER_MS.length).toBeLessThan(SAMPLE_MS.length / 4);
    expect(SHORT_LADDER_MS[0]).toBe(0);
  });
});

describe('the toggle A/B votes now (R-M)', () => {
  // A floor is a third of a measured signal, never a guess -- and the reason
  // a zero must FAIL is the whole argument debug-layers.ts makes: a layer
  // that resolves to no objects produces a zero delta, and a check that
  // passed on zero would read a deleted layer as a healthy one.
  it('fails a zero delta rather than passing it', () => {
    expect(layerVerdict('scorch', { diffPixels: 0, meanAbsChannelDelta: 0 }).ok).toBe(false);
    expect(layerVerdict('blast-light', { diffPixels: 0, meanAbsChannelDelta: 0 }).ok).toBe(false);
  });

  it('passes a delta comfortably over the measured floor', () => {
    const floor = LAYER_FLOORS.scorch;
    expect(
      layerVerdict('scorch', {
        diffPixels: floor.minDiffPixels * 3,
        meanAbsChannelDelta: floor.minMeanAbsChannelDelta * 3,
      }).ok
    ).toBe(true);
  });

  it('fails on EITHER metric, not only their conjunction', () => {
    const f = LAYER_FLOORS.scorch;
    expect(layerVerdict('scorch', { diffPixels: f.minDiffPixels * 3, meanAbsChannelDelta: 0 }).ok).toBe(false);
    expect(layerVerdict('scorch', { diffPixels: 0, meanAbsChannelDelta: f.minMeanAbsChannelDelta * 3 }).ok).toBe(false);
  });

  it('records a sample size beside every floor, because a range with no n is an anecdote', () => {
    for (const f of Object.values(LAYER_FLOORS)) expect(f.rationale).toMatch(/\b\d+ runs?\b/);
  });

  it('keeps every floor at or above a third of the signal it was derived from', () => {
    // The standard `baseline.ts`'s own `layerChecks` are held to, asserted
    // rather than claimed: lowering a floor below that third weakens the check
    // silently, and nothing else in this file would notice.
    for (const [layer, f] of Object.entries(LAYER_FLOORS)) {
      expect(f.measured.runs, `${layer}: sample size`).toBeGreaterThanOrEqual(3);
      expect(f.minDiffPixels, `${layer}: px floor vs a third of ${f.measured.minDiffPixels}`).toBeGreaterThanOrEqual(
        f.measured.minDiffPixels / 3
      );
      expect(
        f.minMeanAbsChannelDelta,
        `${layer}: magnitude floor vs a third of ${f.measured.minMeanAbsChannelDelta}`
      ).toBeGreaterThanOrEqual(f.measured.minMeanAbsChannelDelta / 3);
      // And never AT the signal: a floor that rides its own measurement goes
      // red on the first quiet run rather than on the first regression.
      expect(f.minDiffPixels, `${layer}: px floor is not the signal itself`).toBeLessThan(
        f.measured.minDiffPixels
      );
      expect(f.minMeanAbsChannelDelta).toBeLessThan(f.measured.minMeanAbsChannelDelta);
    }
  });

  it('names only layers the renderer can actually toggle', () => {
    // The same technique `baseline.test.ts` uses, for the same reason:
    // `@lions/tools` does not depend on `@lions/render` and should not start,
    // so the declaration is READ. A name the renderer does not know throws in
    // the page, which surfaces only once somebody runs the browser half --
    // this catches it in `pnpm test`.
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/render/src/three/debug-layers.ts'),
      'utf8'
    );
    const m = /export const DEBUG_LAYERS = \[([^\]]*)\] as const;/.exec(src);
    if (!m) throw new Error('could not find DEBUG_LAYERS in packages/render/src/three/debug-layers.ts');
    const known = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(known.length).toBeGreaterThan(0);
    for (const layer of Object.keys(LAYER_FLOORS)) expect(known, `floor for layer "${layer}"`).toContain(layer);
  });

  it('refuses a layer it has no floor for, rather than passing it', () => {
    const v = layerVerdict('ground-albedo', { diffPixels: 999_999, meanAbsChannelDelta: 99 });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/no floor/);
  });
});

describe('abstaining from a layer is a named, self-cleaning exemption', () => {
  it('lets a voting subject fail and an abstaining one record the same zero', () => {
    expect(readingAccepted(true, false)).toBe(false);
    expect(readingAccepted(false, false)).toBe(true);
  });

  it('FAILS an abstaining subject that clears its floor anyway', () => {
    // The demotion half. Without it an exemption is a permanent hole: the day
    // somebody fixes whatever made the subject a poor witness, nothing would
    // notice and the abstention would outlive its reason by years.
    expect(readingAccepted(false, true)).toBe(false);
    expect(readingAccepted(true, true)).toBe(true);
  });

  it('defaults to voting on every layer', () => {
    expect(subjectVotesOn({}, 'scorch')).toBe(true);
    expect(subjectVotesOn({ abstains: ['blast-light'] }, 'scorch')).toBe(true);
    expect(subjectVotesOn({ abstains: ['blast-light'] }, 'blast-light')).toBe(false);
  });

  it('makes every abstaining subject say so, with its numbers, on the subject itself', () => {
    // A `why` that did not name the exemption would leave the reason in
    // somebody's memory of a run rather than in the file the next person reads.
    for (const s of BLAST_SUBJECTS) {
      if ((s.abstains ?? []).length === 0) continue;
      expect(s.why, `subject "${s.id}"`).toMatch(/ABSTAINS/);
      for (const layer of s.abstains ?? []) expect(s.why, `subject "${s.id}" / ${layer}`).toContain(layer);
      // ... and a measurement, not an adjective.
      expect(s.why, `subject "${s.id}" names no measured number`).toMatch(/\d/);
    }
  });

  it('abstains from no layer it has no floor for', () => {
    for (const s of BLAST_SUBJECTS) {
      for (const layer of s.abstains ?? []) expect(Object.keys(LAYER_FLOORS)).toContain(layer);
    }
  });

  it('keeps at least one voting witness for every floored layer', () => {
    // The failure this catches is an exemption sweep: abstain everywhere and
    // the layer is floored, reported, and judged by nobody.
    for (const layer of Object.keys(LAYER_FLOORS)) {
      const voters = BLAST_SUBJECTS.filter((s) => subjectVotesOn(s, layer));
      expect(voters.length, `layer "${layer}" has no voting subject`).toBeGreaterThan(0);
    }
  });
});
