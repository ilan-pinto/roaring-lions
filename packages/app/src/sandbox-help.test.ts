// The sandbox's self-documentation.
//
// The failure this exists to prevent is a silent one: `&tunel` (typo) does
// nothing, reads as a broken feature, and costs a debugging session. So the
// cases worth pinning are about DRIFT — a flag that is parsed but not
// listed, or listed but not parsed — and about the typo actually being
// caught.
import { describe, expect, it } from 'vitest';
import {
  KNOWN_PARAMS,
  SANDBOX_FLAGS,
  readFlags,
  sandboxHelp,
  unknownParams,
} from './sandbox-help';

const MAPS = ['beit_sahwan_outskirts', 'tel_marum', 'wadi_halam_basin'];

describe('readFlags', () => {
  it('reads every flag SANDBOX_FLAGS declares, and only those', () => {
    // The one assertion that makes the banner honest: readFlags builds its
    // record BY iterating SANDBOX_FLAGS, so a flag added to the table is
    // parsed and listed in the same edit or neither.
    expect(Object.keys(readFlags(new URLSearchParams()))).toEqual(
      SANDBOX_FLAGS.map((f) => f.name)
    );
  });

  it('is false for every flag when none are given', () => {
    expect(Object.values(readFlags(new URLSearchParams('?sandbox=tel_marum')))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('treats a bare flag as on, the way the URL bar is actually typed', () => {
    const f = readFlags(new URLSearchParams('?sandbox=tel_marum&tunnel&sur'));
    expect([f.tunnel, f.sur, f.roe]).toEqual([true, true, false]);
  });

  it('treats an explicit value as on too, since &roe=1 means the same thing', () => {
    expect(readFlags(new URLSearchParams('?roe=1')).roe).toBe(true);
  });
});

describe('unknownParams', () => {
  it('catches a misspelled flag', () => {
    expect(unknownParams(new URLSearchParams('?sandbox=tel_marum&tunel'))).toEqual(['tunel']);
  });

  it('passes every parameter main.ts actually reads', () => {
    const every = KNOWN_PARAMS.map((p) => p.name).join('&');
    expect(unknownParams(new URLSearchParams(`?${every}`))).toEqual([]);
  });

  it('lists the three sandbox flags among the known parameters', () => {
    // KNOWN_PARAMS is what unknownParams checks against; if the flags fell
    // out of it, every real flag would warn as unknown.
    const known = KNOWN_PARAMS.map((p) => p.name);
    for (const f of SANDBOX_FLAGS) expect(known).toContain(f.name);
  });

  it('says nothing about an empty query', () => {
    expect(unknownParams(new URLSearchParams(''))).toEqual([]);
  });
});

describe('sandboxHelp', () => {
  const ctx = { mapId: 'tel_marum', mapIds: MAPS, on: ['tunnel', 'sur'] };

  it('names the map that actually loaded', () => {
    expect(sandboxHelp(ctx)).toContain('tel_marum');
  });

  it('separates the flags that are on from the ones available', () => {
    const text = sandboxHelp(ctx);
    expect(text).toMatch(/on:\s*tunnel, sur/);
    expect(text).toContain('&roe');
  });

  it('says so plainly when no flags are on, rather than printing an empty list', () => {
    expect(sandboxHelp({ ...ctx, on: [] })).toMatch(/on:\s*\(none\)/);
  });

  it('lists every shipped map, so a wrong id is not the only way to find them', () => {
    const text = sandboxHelp(ctx);
    for (const m of MAPS) expect(text).toContain(m);
  });

  it('mentions every sandbox flag, so the table cannot document less than it parses', () => {
    const text = sandboxHelp({ ...ctx, on: [] });
    for (const f of SANDBOX_FLAGS) expect(text).toContain(`&${f.name}`);
  });

  it('points at the console API', () => {
    expect(sandboxHelp(ctx)).toContain('__lions.help()');
  });
});
