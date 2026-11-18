// GH-1381 review notes 1 and 2: the boot's side and extras, through the function `main.ts` calls (it cannot be booted
// by a unit test; `content-wiring.test.ts` pins that it calls this and nothing else).
import { describe, expect, it } from 'vitest';
import { bootFlags } from './boot-flags';

const q = (s: string): URLSearchParams => new URLSearchParams(s);
const on = (flags: Record<string, boolean>): string[] => Object.entries(flags).filter(([, v]) => v).map(([k]) => k);
const FREE = { missionId: null, inRoom: false } as const;

describe('bootFlags', () => {
  it('a Sarim Free play drops the field-works dock and the synthesised tunnel the URL asked for, and says so', () => {
    const lines: string[] = [];
    const got = bootFlags(q('works&tunnel&civ&side=sarim'), FREE, (l) => lines.push(l));
    expect(got.side).toBe('sarim');
    expect(on(got.flags)).toEqual(['civ']);
    expect(lines).toEqual([
      '[lions] sandbox flag &tunnel is ignored on the Sarim side: it adds KDF kit or Sarim opposition',
      '[lions] sandbox flag &works is ignored on the Sarim side: it adds KDF kit or Sarim opposition',
    ]);
  });

  it('a KDF Free play keeps them, silently: every link without a side is today\'s', () => {
    const lines: string[] = [];
    const got = bootFlags(q('works&tunnel&civ'), FREE, (l) => lines.push(l));
    expect(got.side).toBe('kdf');
    expect(on(got.flags)).toEqual(['tunnel', 'civ', 'works']);
    expect(lines).toEqual([]);
  });

  it('a mission plays the KDF whatever &side says, and prints that the side was ignored', () => {
    const lines: string[] = [];
    const got = bootFlags(q('side=sarim'), { missionId: 'tel_marum_1', inRoom: false }, (l) => lines.push(l));
    expect(got.side).toBe('kdf');
    expect(lines).toEqual(['[lions] &side=sarim is ignored: only Free play picks a side']);
  });

  it('a room plays the KDF, says the side was ignored, and drops every extra', () => {
    const lines: string[] = [];
    const got = bootFlags(q('side=sarim&civ'), { missionId: null, inRoom: true }, (l) => lines.push(l));
    expect(got.side).toBe('kdf');
    expect(on(got.flags)).toEqual([]);
    expect(lines).toEqual(['[lions] &side=sarim is ignored: only Free play picks a side', '[net] sandbox flag &civ is ignored in a room']);
  });

  it('the lead, 18 Nov 2026: a KDF Free play has field works without being asked, silently', () => {
    const lines: string[] = [];
    const got = bootFlags(q(''), FREE, (l) => lines.push(l));
    expect([got.side, on(got.flags)]).toEqual(['kdf', ['works']]);
    expect(lines).toEqual([]);
  });

  it('&works on a KDF Free play is an alias: the same boot with it and without it', () => {
    expect(bootFlags(q('works&civ'), FREE, () => undefined)).toEqual(bootFlags(q('civ'), FREE, () => undefined));
  });

  it('a Sarim Free play that did not ask for field works gets none, and nothing is said', () => {
    const lines: string[] = [];
    const got = bootFlags(q('side=sarim'), FREE, (l) => lines.push(l));
    expect([got.side, on(got.flags)]).toEqual(['sarim', []]);
    expect(lines).toEqual([]);
  });

  it('a mission takes no field works default, with or without &works', () => {
    const mission = { missionId: 'tel_marum_1', inRoom: false } as const;
    expect(on(bootFlags(q(''), mission, () => undefined).flags)).toEqual([]);
    expect(on(bootFlags(q('works'), mission, () => undefined).flags)).toEqual(['works']);
  });

  it('a room takes no field works default, and says nothing about one it was not asked for', () => {
    const lines: string[] = [];
    const got = bootFlags(q(''), { missionId: null, inRoom: true }, (l) => lines.push(l));
    expect(on(got.flags)).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('an unknown side warns and plays the KDF, keeping its extras', () => {
    const lines: string[] = [];
    const got = bootFlags(q('side=rif&works'), FREE, (l) => lines.push(l));
    expect([got.side, on(got.flags)]).toEqual(['kdf', ['works']]);
    expect(lines).toEqual(['[lions] &side=rif is not a side (kdf | sarim); playing the KDF']);
  });
});
