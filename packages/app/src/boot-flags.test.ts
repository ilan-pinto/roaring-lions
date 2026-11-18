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

  it('an unknown side warns and plays the KDF, keeping its extras', () => {
    const lines: string[] = [];
    const got = bootFlags(q('side=rif&works'), FREE, (l) => lines.push(l));
    expect([got.side, on(got.flags)]).toEqual(['kdf', ['works']]);
    expect(lines).toEqual(['[lions] &side=rif is not a side (kdf | sarim); playing the KDF']);
  });
});
