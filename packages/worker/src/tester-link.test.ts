import { describe, it, expect } from 'vitest';
import { TESTER_PATTERN } from '@lions/data/telemetry';
import { testerLink, TESTER_NAME_REFUSAL } from './tester-link';

describe('testerLink', () => {
  it('builds <origin>/?tester=<name> for a valid name', () => {
    const r = testerLink('https://g.dev', 'dani');
    expect(r).toEqual({ ok: true, url: 'https://g.dev/?tester=dani' });
  });

  it('strips a trailing slash from the origin', () => {
    const r = testerLink('https://g.dev/', 'dani');
    expect(r).toEqual({ ok: true, url: 'https://g.dev/?tester=dani' });
  });

  it('strips more than one trailing slash', () => {
    const r = testerLink('https://g.dev//', 'dani');
    expect(r).toEqual({ ok: true, url: 'https://g.dev/?tester=dani' });
  });

  it('never adds ?telemetry', () => {
    const r = testerLink('https://g.dev', 'dani');
    expect(r.ok && r.url).not.toContain('telemetry');
  });

  it('the built URL parses and carries the name back out under ?tester=', () => {
    const r = testerLink('https://g.dev', 'dani_02.beta-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(new URL(r.url).searchParams.get('tester')).toBe('dani_02.beta-1');
  });

  it('accepts the boundary case: exactly 32 characters', () => {
    const name = 'a'.repeat(32);
    const r = testerLink('https://g.dev', name);
    expect(r.ok).toBe(true);
  });

  it('refuses a name with a space, naming the allowed characters', () => {
    const r = testerLink('https://g.dev', 'dani two');
    expect(r).toEqual({ ok: false, reason: TESTER_NAME_REFUSAL });
  });

  it('refuses a name over 32 characters', () => {
    const r = testerLink('https://g.dev', 'a'.repeat(33));
    expect(r).toEqual({ ok: false, reason: TESTER_NAME_REFUSAL });
  });

  it('refuses an empty name', () => {
    const r = testerLink('https://g.dev', '');
    expect(r).toEqual({ ok: false, reason: TESTER_NAME_REFUSAL });
  });

  it('refuses a name with a unicode letter', () => {
    const r = testerLink('https://g.dev', 'dàni');
    expect(r).toEqual({ ok: false, reason: TESTER_NAME_REFUSAL });
  });

  it('the refusal text names the allowed characters and the limit', () => {
    expect(TESTER_NAME_REFUSAL).toMatch(/letters/i);
    expect(TESTER_NAME_REFUSAL).toContain('32');
  });

  it('the refusal literal inside testerLink matches the exported TESTER_NAME_REFUSAL constant', () => {
    // testerLink carries its own copy of this string (it must, to stay a
    // self-contained function -- see the comment in tester-link.ts), so pin
    // the two together rather than trust them to stay in sync by hand.
    expect(testerLink.toString()).toContain(TESTER_NAME_REFUSAL);
  });

  it('the mirrored pattern inside testerLink is character-for-character the same as @lions/data/telemetry TESTER_PATTERN', () => {
    // testerLink does NOT import TESTER_PATTERN (see tester-link.ts for why:
    // an imported binding does not survive `.toString()` serialisation into
    // the /stats page script). This is the guard against the mirror drifting:
    // if someone edits `packages/data/src/telemetry.ts`'s TESTER_PATTERN
    // without updating the literal below, this fails.
    expect(testerLink.toString()).toContain(TESTER_PATTERN.source);
  });

  it('the mirrored pattern behaves identically to TESTER_PATTERN across a spread of inputs', () => {
    const samples = ['dani', 'DANI_02.beta-1', '', ' ', 'a'.repeat(32), 'a'.repeat(33), 'dàni', 'a b', 'a/b', 'a\\b', '..', '___', '-.-'];
    for (const s of samples) {
      expect(testerLink('https://g.dev', s).ok).toBe(TESTER_PATTERN.test(s));
    }
  });

  it('references nothing outside its own parameters and literals, so it survives being lifted whole out of this module', () => {
    const rebuilt = new Function(`return (${testerLink.toString()});`)() as typeof testerLink;
    expect(rebuilt('https://g.dev/', 'dani')).toEqual({ ok: true, url: 'https://g.dev/?tester=dani' });
    expect(rebuilt('https://g.dev', 'bad name')).toEqual({ ok: false, reason: TESTER_NAME_REFUSAL });
  });
});

// wrangler bundles with esbuild's keepNames, which wraps every NESTED named
// function in `__name(fn, "fn")` INSIDE its parent's body. `stats-page.ts`
// ships `testerLink.toString()` to the browser, where `__name` does not exist,
// so one inner helper would throw on /stats while every test here stays green.
// Measured on 6062d465 with `wrangler deploy --dry-run`: the call sits after the
// function today, which is why the body must stay flat.
describe('testerLink stays flat for the page copy', () => {
  it('declares no inner function or arrow', () => {
    const body = testerLink.toString().replace(/^function\s+\w+\s*\([^)]*\)\s*\{/, '');
    expect(body).not.toMatch(/=>|\bfunction\b/);
  });
});
