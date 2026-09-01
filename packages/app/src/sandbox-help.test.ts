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
    // Asserted as a PROPERTY rather than against a literal `[false, false,
    // false]`. That literal broke when a fourth flag was added, with nothing
    // actually wrong -- a brittle guard rather than a strict one, and the
    // kind that pressures whoever hits it into editing the test without
    // reading it. Key coverage is not re-checked here: the test above
    // ("reads every flag SANDBOX_FLAGS declares, and only those") already
    // owns that, and duplicating it would mean two tests failing for one
    // cause.
    const f = readFlags(new URLSearchParams('?sandbox=tel_marum'));
    expect(Object.values(f)).not.toHaveLength(0);
    expect(Object.values(f).every((v) => v === false)).toBe(true);
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

describe('KNOWN_PARAMS renderer blurb', () => {
  // Twice now this blurb has hardcoded a phase name and a capability list
  // for the three.js backend ("terrain only, Phase B2; no units/fog yet"),
  // and gone stale the moment the next phase shipped -- SANDBOX_FLAGS being
  // "the single source" only proves a flag is parsed and listed, not that
  // prose about a DIFFERENT package (packages/render) still describes that
  // package's current state. Nothing under packages/app runs when
  // packages/render changes, so a capability claim here has no way to be
  // kept honest. The fix is to not make one: point at CLAUDE.md, which
  // backend work actually does keep current, instead of restating facts
  // that live there.
  const renderer = KNOWN_PARAMS.find((p) => p.name === 'renderer');

  it('exists', () => {
    expect(renderer).toBeDefined();
  });

  it('does not name a phase or restate a capability list that will outlive it', () => {
    const text = renderer?.blurb ?? '';
    for (const stale of ['Phase B', 'Phase C', 'Phase D', 'no units', 'no fog', 'terrain only']) {
      expect(text).not.toContain(stale);
    }
  });

  it('points at the doc that is actually kept current instead', () => {
    expect(renderer?.blurb ?? '').toContain('CLAUDE.md');
  });
});

describe('the mesh flip', () => {
  // Same drift, smaller instance: the old opt-in blurb named exactly one team
  // ('inf_squad') when the mesh path only had one, and stayed pinned to that
  // name after eleven more teams loaded (MESH_TEAMS in main.ts). Asserted as
  // an absence rather than a fixed team count, since main.ts's team list --
  // not this file -- is the thing that actually changes.
  it('does not hardcode a specific team id', () => {
    for (const f of SANDBOX_FLAGS) expect(f.blurb).not.toContain('inf_squad');
  });

  // Meshes became the default, so the live flag is the opt-OUT. These three
  // pin the whole flip: absent means on, `&nomesh` means off, and the old
  // opt-in spelling is still ACCEPTED so that every bookmark, CLAUDE.md line
  // and finger-habit carrying `&mesh` is not reported as a typo by
  // `unknownParams` -- which is the one thing that would make a silent no-op
  // look like a broken feature.
  it('draws meshes when nothing is asked for', () => {
    expect(readFlags(new URLSearchParams('?sandbox')).nomesh).toBe(false);
  });

  it('turns them off for &nomesh', () => {
    expect(readFlags(new URLSearchParams('?sandbox&nomesh')).nomesh).toBe(true);
  });

  it('still accepts a stale &mesh without calling it unknown', () => {
    expect(unknownParams(new URLSearchParams('?sandbox&mesh'))).toEqual([]);
    // ...and it is no longer a flag that changes anything, so the banner,
    // which lists only SANDBOX_FLAGS, must not offer it.
    expect(SANDBOX_FLAGS.map((f) => f.name)).not.toContain('mesh');
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
