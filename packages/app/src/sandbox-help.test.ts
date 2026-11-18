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
  SANDBOX_SIDES,
  freePlayDefaults,
  readFlags,
  sandboxHelp,
  sandboxSideOf,
  sandboxUrl,
  sideFlags,
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

  it('reads &decals, off by default', () => {
    expect(readFlags(new URLSearchParams('?sandbox=qarn_hadid&decals')).decals).toBe(true);
    expect(readFlags(new URLSearchParams('?sandbox=qarn_hadid')).decals).toBe(false);
  });

  it('lists &works in the one table all four callers read', () => {
    expect(SANDBOX_FLAGS.map((f) => f.name)).toContain('works');
    expect(readFlags(new URLSearchParams('?sandbox=beit_sahwan_outskirts&works')).works).toBe(true);
    expect(readFlags(new URLSearchParams('?sandbox=beit_sahwan_outskirts')).works).toBe(false);
    expect(unknownParams(new URLSearchParams('?sandbox=beit_sahwan_outskirts&works'))).toEqual([]);
    expect(sandboxUrl('beit_sahwan_outskirts', { works: true })).toBe('?sandbox=beit_sahwan_outskirts&works');
    expect(sandboxHelp({ mapId: 'beit_sahwan_outskirts', mapIds: [], on: [] })).toContain('&works');
  });

  it('reads &kit, off by default, and does not warn about it', () => {
    expect(readFlags(new URLSearchParams('?sandbox=beit_sahwan_outskirts&kit')).kit).toBe(true);
    expect(readFlags(new URLSearchParams('?sandbox=beit_sahwan_outskirts')).kit).toBe(false);
    expect(unknownParams(new URLSearchParams('?sandbox=beit_sahwan_outskirts&kit'))).toEqual([]);
    expect(sandboxUrl('beit_sahwan_outskirts', { kit: true })).toBe('?sandbox=beit_sahwan_outskirts&kit');
  });
});

describe('sandboxUrl', () => {
  // The fourth caller of SANDBOX_FLAGS, and the inverse of readFlags. The
  // menu's picker builds every one of its links with it, so a spelling this
  // produces that readFlags does not accept is a screen that looks like it
  // works and launches something else.
  it('is the bare map when no flag is on', () => {
    expect(sandboxUrl('tel_marum')).toBe('?sandbox=tel_marum');
  });

  it('appends flags bare, the way the banner prints them and a hand types them', () => {
    expect(sandboxUrl('tel_marum', { tunnel: true, sur: true })).toBe(
      '?sandbox=tel_marum&tunnel&sur'
    );
  });

  it('omits a false flag rather than writing &sur=0, which readFlags reads as ON', () => {
    expect(sandboxUrl('tel_marum', { sur: false })).toBe('?sandbox=tel_marum');
  });

  it('orders flags by the table, not by the order they were asked for', () => {
    // Two pickers ticking the same boxes in a different order must produce
    // the same URL, or the same build gets two links and two bookmarks.
    expect(sandboxUrl('tel_marum', { sur: true, roe: true })).toBe(
      sandboxUrl('tel_marum', { roe: true, sur: true })
    );
  });

  it('round-trips through readFlags for every flag the table declares', () => {
    const all = Object.fromEntries(SANDBOX_FLAGS.map((f) => [f.name, true]));
    const params = new URLSearchParams(sandboxUrl('wadi_halam_basin', all));
    expect(params.get('sandbox')).toBe('wadi_halam_basin');
    expect(readFlags(params)).toEqual(all);
  });

  it('never produces a URL that unknownParams reports as a typo', () => {
    const all = Object.fromEntries(SANDBOX_FLAGS.map((f) => [f.name, true]));
    expect(unknownParams(new URLSearchParams(sandboxUrl('tel_marum', all)))).toEqual([]);
  });

  it("builds and accepts the aftermath scenario's URL", () => {
    expect(sandboxUrl('qarn_hadid', { decals: true })).toBe('?sandbox=qarn_hadid&decals');
    expect(
      unknownParams(new URLSearchParams('?sandbox=qarn_hadid&decals&renderer=three'))
    ).toEqual([]);
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

  it('knows the picker route, so landing on it does not warn about itself', () => {
    expect(unknownParams(new URLSearchParams('?sandboxes'))).toEqual([]);
    // ...and it is deliberately NOT the bare `?sandbox`, which has always
    // meant "boot beit_sahwan_outskirts" and must keep meaning it.
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('sandbox');
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

describe('?renderer= after the Pixi retirement (WP-A3.3)', () => {
  // Accepted and ignored, like `&mesh`: old bookmarks and doc links carrying
  // `?renderer=pixi` must not be reported as a typo, and nothing may claim the
  // choice still exists.
  const renderer = KNOWN_PARAMS.find((p) => p.name === 'renderer');

  it('is still a known parameter, so old links do not warn', () => {
    expect(renderer).toBeDefined();
    expect(unknownParams(new URLSearchParams('?mission=beit_sahwan_1_recon&renderer=pixi'))).toEqual([]);
    expect(unknownParams(new URLSearchParams('?sandbox=tel_marum&renderer=three'))).toEqual([]);
  });

  it('says it has no effect, and offers no pixi value', () => {
    const text = renderer?.blurb ?? '';
    expect(text).toMatch(/no effect/);
    expect(text).not.toMatch(/\|\s*pixi/);
    expect(text).not.toMatch(/persists/);
  });

  it('is not a sandbox flag (nothing to tick on /free-play)', () => {
    expect(SANDBOX_FLAGS.map((f) => f.name as string)).not.toContain('renderer');
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

  // Meshes became the default, and since WP-A3.3 the only path: `&nomesh`
  // (the billboard opt-out) is accepted and does nothing, exactly like the old
  // opt-in `&mesh`, so neither is reported as a typo by `unknownParams` --
  // which is what would make a silent no-op look like a broken feature.
  it('accepts a stale &nomesh without calling it unknown, and offers no checkbox for it', () => {
    expect(unknownParams(new URLSearchParams('?sandbox&nomesh'))).toEqual([]);
    expect(SANDBOX_FLAGS.map((f) => f.name as string)).not.toContain('nomesh');
    expect('nomesh' in readFlags(new URLSearchParams('?sandbox&nomesh'))).toBe(false);
    const blurb = KNOWN_PARAMS.find((p) => p.name === 'nomesh')?.blurb ?? '';
    expect(blurb).toMatch(/no effect/);
  });

  it('still accepts a stale &mesh without calling it unknown', () => {
    expect(unknownParams(new URLSearchParams('?sandbox&mesh'))).toEqual([]);
    // ...and it is no longer a flag that changes anything, so the banner,
    // which lists only SANDBOX_FLAGS, must not offer it.
    expect(SANDBOX_FLAGS.map((f) => f.name)).not.toContain('mesh');
  });
});

// I4 (shell-upgrade Phase 0 final review): SANDBOX_FLAGS's blurbs are
// rendered as visible DOM text on the Free play screen (`showSandbox` in
// menu.ts), not just printed to the console like KNOWN_PARAMS's -- the
// `tunnel` flag's blurb named `yahalom_squad` verbatim, the exact
// "enemy reacts (<id>)" shape the whole phase exists to remove, right next
// to the (since retired) `nomesh` blurb that was deliberately written to
// avoid it.
describe('I4: no raw snake_case id in a rendered blurb', () => {
  // A generic shape check, not just the one instance that was found: any
  // future flag whose blurb names a unit/map/mission id by its JSON key
  // (lower_snake_case, at least two words) reproduces the same defect.
  const SNAKE_CASE_ID = /\b[a-z]+(?:_[a-z]+)+\b/;

  it('SANDBOX_FLAGS carries no lower_snake_case id in any blurb', () => {
    for (const f of SANDBOX_FLAGS) {
      expect(f.blurb, `${f.name}: "${f.blurb}"`).not.toMatch(SNAKE_CASE_ID);
    }
  });

  it('the tunnel blurb names the unit in English, not by its id', () => {
    const tunnel = SANDBOX_FLAGS.find((f) => f.name === 'tunnel');
    expect(tunnel?.blurb).not.toContain('yahalom_squad');
    expect(tunnel?.blurb).toContain('Yahalom');
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

describe('voicetick (WP-AU1 R-10)', () => {
  it('is a known URL parameter, never a Free play flag, and no typo warning', () => {
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('voicetick');
    expect(SANDBOX_FLAGS.map((f) => f.name as string)).not.toContain('voicetick');
    expect(unknownParams(new URLSearchParams('voicetick'))).toEqual([]);
  });
});

describe('tod (R-12, N-23)', () => {
  it('is a known URL parameter, never a Free play flag, and no typo warning', () => {
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('tod');
    expect(SANDBOX_FLAGS.map((f) => f.name as string)).not.toContain('tod');
    expect(unknownParams(new URLSearchParams('?sandbox=beit_sahwan_outskirts&tod=dusk'))).toEqual([]);
  });

  it('sandboxHelp prints its blurb', () => {
    const ctx = { mapId: 'tel_marum', mapIds: MAPS, on: [] };
    expect(sandboxHelp(ctx)).toContain('dawn | day | dusk | night');
  });
});

describe('engines (GH-35)', () => {
  it('is a known URL parameter, never a Free play flag, and no typo warning', () => {
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('engines');
    expect(SANDBOX_FLAGS.map((f) => f.name as string)).not.toContain('engines');
    expect(unknownParams(new URLSearchParams('?sandbox=tel_marum&engines=b'))).toEqual([]);
  });

  it('__lions.help() lists it, with its two values', () => {
    const ctx = { mapId: 'tel_marum', mapIds: MAPS, on: [] };
    expect(sandboxHelp(ctx)).toMatch(/&engines=<a\|b>\s+a \| b/);
  });
});

describe('console API line', () => {
  it('names contentDigest(), the L4 digest the engines check reads', () => {
    const ctx = { mapId: 'tel_marum', mapIds: MAPS, on: [] };
    expect(sandboxHelp(ctx)).toMatch(/console: .*contentDigest\(\)/);
  });
});

describe('GH-1381: the side a Free play commands', () => {
  const q = (s: string): URLSearchParams => new URLSearchParams(s);

  it('is the KDF with no `side`, silently: every existing link is the KDF\'s', () => {
    expect(sandboxSideOf(q(''), true)).toEqual({ value: 'kdf' });
    expect(sandboxSideOf(q('tunnel&sur'), true)).toEqual({ value: 'kdf' });
  });

  it('reads kdf and sarim in Free play', () => {
    expect(sandboxSideOf(q('side=kdf'), true)).toEqual({ value: 'kdf' });
    expect(sandboxSideOf(q('side=sarim'), true)).toEqual({ value: 'sarim' });
  });

  it('warns on a value that is not a side, and plays the KDF', () => {
    const got = sandboxSideOf(q('side=Sarim'), true);
    expect(got.value).toBe('kdf');
    expect(got.warning).toMatch(/not a side/);
  });

  it('is the KDF outside Free play (a mission, a room), whatever the URL says, and says so', () => {
    const got = sandboxSideOf(q('side=sarim'), false);
    expect(got.value).toBe('kdf');
    expect(got.warning).toMatch(/ignored/);
  });

  it('is a known parameter, so `&side=` never warns as a typo', () => {
    expect(unknownParams(q('sandbox=tel_marum&side=sarim'))).toEqual([]);
    expect(KNOWN_PARAMS.some((p) => p.name === 'side')).toBe(true);
    // And not a boolean flag: the picker draws it as a radio group, never a checkbox.
    expect(SANDBOX_FLAGS.some((f) => (f.name as string) === 'side')).toBe(false);
    expect(SANDBOX_SIDES).toEqual(['kdf', 'sarim']);
  });

  it('prints in the banner: the side this boot commands, and the parameter', () => {
    const ctx = { mapId: 'tel_marum', mapIds: MAPS, on: [] };
    expect(sandboxHelp(ctx)).toMatch(/\n {2}side: kdf\n/);
    expect(sandboxHelp({ ...ctx, side: 'sarim' })).toMatch(/\n {2}side: sarim\n/);
    expect(sandboxHelp(ctx)).toMatch(/&side=<kdf\|sarim>\s+kdf \| sarim/);
  });
});

describe('GH-1381: sideFlags', () => {
  const all = (): ReturnType<typeof readFlags> => readFlags(new URLSearchParams(SANDBOX_FLAGS.map((f) => f.name).join('&')));

  it('marks exactly the four extras that add KDF kit or Sarim opposition as KDF-only (literals)', () => {
    expect(SANDBOX_FLAGS.filter((f) => f.kdfOnly === true).map((f) => f.name)).toEqual(['tunnel', 'sur', 'kit', 'works']);
  });

  it('keeps every flag for the KDF, and warns about none', () => {
    const warned: string[] = [];
    expect(sideFlags(all(), 'kdf', (k) => warned.push(k))).toEqual(all());
    expect(warned).toEqual([]);
  });

  it('drops the KDF-only ones for Sarim, naming each the URL asked for, and keeps the rest', () => {
    const warned: string[] = [];
    const got = sideFlags(all(), 'sarim', (k) => warned.push(k));
    expect(warned).toEqual(['tunnel', 'sur', 'kit', 'works']);
    expect(Object.entries(got).filter(([, on]) => on).map(([k]) => k)).toEqual(['roe', 'civ', 'ditch', 'decals', 'rubble', 'ragdoll', 'soft']);
  });

  it('names nothing for Sarim when no KDF-only flag was asked for', () => {
    const warned: string[] = [];
    sideFlags(readFlags(new URLSearchParams('civ&roe')), 'sarim', (k) => warned.push(k));
    expect(warned).toEqual([]);
  });
});

describe('field works in Free play (the lead, 18 Nov 2026): freePlayDefaults', () => {
  const none = (): ReturnType<typeof readFlags> => readFlags(new URLSearchParams(''));
  const onOf = (f: Record<string, boolean>): string[] => Object.entries(f).filter(([, v]) => v).map(([k]) => k);

  it('marks field works, and only field works, as on in every Free play (literals)', () => {
    expect(SANDBOX_FLAGS.filter((f) => f.freePlayDefault === true).map((f) => f.name)).toEqual(['works']);
  });

  it('turns field works on for the KDF and leaves everything else as the URL said', () => {
    expect(onOf(freePlayDefaults(none(), 'kdf'))).toEqual(['works']);
    expect(onOf(freePlayDefaults(readFlags(new URLSearchParams('civ&roe')), 'kdf'))).toEqual(['roe', 'civ', 'works']);
  });

  it('&works is an alias on the KDF side: the same flags with it and without it', () => {
    expect(freePlayDefaults(readFlags(new URLSearchParams('works&civ')), 'kdf')).toEqual(
      freePlayDefaults(readFlags(new URLSearchParams('civ')), 'kdf'),
    );
  });

  it('gives the Sarim side no field works: a KDF-only default stays off there', () => {
    expect(onOf(freePlayDefaults(none(), 'sarim'))).toEqual([]);
    expect(onOf(freePlayDefaults(readFlags(new URLSearchParams('civ')), 'sarim'))).toEqual(['civ']);
  });

  it('still parses &works, so an old link is not reported as a typo', () => {
    expect(unknownParams(new URLSearchParams('?sandbox=tel_marum&works'))).toEqual([]);
  });
});
