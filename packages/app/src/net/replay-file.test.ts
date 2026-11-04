// GH-954 W3: the frames file's format. The arena's own round trip (a real game) is in tools/src/net/arena-replay.test.ts.
import { describe, expect, it } from 'vitest';
import { validateConfig, type Frame } from '@lions/net';
import { denseFrames, parseReplay, ReplayRefused, serializeReplay, sparseFrames, type ReplayFile } from './replay-file';

const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'bot' });
const config = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'paced', roundTicks: 40, roundWallMs: 1000 }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
if (config === null) throw new Error('fixture');
const stamp = (seq: number) => ({ seat: 0 as const, seq, cmd: { kind: 'halt', ids: [1] } as never });
const FILE: ReplayFile = {
  header: { kind: 'header', v: 1, build: 'B', game: { n: 1, of: 2, seed: 1, map: 'tel_marum', matchup: 'mirror', capTicks: 100, pace: 40, roundWallMs: 1000 }, labels: ['rush', 'passive'], config },
  frames: [{ t: 3, c: [stamp(0)] }, { t: 7, c: [stamp(1), stamp(2)] }],
  end: { kind: 'end', ticks: 10, referee: { tick: 10, hash: -12345 }, watcher: { tick: 10, hash: -12345 }, outcome: 'seat0', by: 'cap' },
};

describe('the frames file', () => {
  it('round-trips, with a negative hash and no watcher', () => {
    expect(parseReplay(serializeReplay(FILE), { build: 'B' })).toEqual(FILE);
    const noWatcher: ReplayFile = { ...FILE, end: { ...FILE.end, watcher: null } };
    expect(parseReplay(serializeReplay(noWatcher), { build: 'B' })).toEqual(noWatcher);
  });

  it('keeps no empty tick, and rebuilds every one of them', () => {
    const text = serializeReplay(FILE);
    expect(text.trimEnd().split('\n')).toHaveLength(4);   // header, two frames, end
    const dense = denseFrames(FILE);
    expect(dense).toHaveLength(10);
    expect(dense.map((f) => f.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(dense.filter((f) => f.cmds.length > 0).map((f) => f.tick)).toEqual([3, 7]);
    expect(sparseFrames(dense)).toEqual(FILE.frames);
    expect(() => sparseFrames([{ tick: 1, cmds: [] } as Frame])).toThrow();
  });

  it('refuses another build before it reads anything else, naming the file\'s', () => {
    const text = serializeReplay(FILE);
    const first = text.split('\n')[0];
    // Only the header is valid: a mismatch is reported even when the rest is garbage.
    try { parseReplay(`${first}\nnot json`, { build: 'OTHER' }); throw new Error('read'); } catch (e) {
      expect(e).toBeInstanceOf(ReplayRefused);
      expect(e).toMatchObject({ code: 'build_mismatch', detail: { fileBuild: 'B' } });
    }
    expect(() => parseReplay(text, { build: 'OTHER' })).toThrow(/recorded on build "B", this is "OTHER"/);
  });

  it('refuses what is not a file of this format', () => {
    const lines = serializeReplay(FILE).trimEnd().split('\n');
    const code = (t: string): string => { try { parseReplay(t, { build: 'B' }); return 'ok'; } catch (e) { return e instanceof ReplayRefused ? e.code : 'other'; } };
    expect(code(lines.join('\n'))).toBe('ok');
    expect(code(lines.slice(0, -1).join('\n'))).toBe('incomplete');
    expect(code([lines[0], lines[2], lines[1], lines[3]].join('\n'))).toBe('bad_file');            // descending ticks
    expect(code([lines[0], JSON.stringify({ t: 10, c: [stamp(0)] }), lines[3]].join('\n'))).toBe('bad_file');   // past the end
    expect(code([lines[0], JSON.stringify({ t: 4, c: [] }), lines[3]].join('\n'))).toBe('bad_file');
    expect(code([lines[0], JSON.stringify({ t: 4, c: [{ seat: 2, seq: 0, cmd: { kind: 'x' } }] }), lines[3]].join('\n'))).toBe('bad_file');
    expect(code(['{"kind":"header","v":2,"build":"B"}', lines[3]].join('\n'))).toBe('bad_file');
    expect(code([lines[0].replace('"tel_marum","mode"', '"tel_marum","mode"').replace('"hashEveryTicks":20', '"hashEveryTicks":0'), lines[3]].join('\n'))).toBe('bad_file');   // not a valid config
    expect(code(['', ''].join('\n'))).toBe('bad_file');
  });

  it('will not write frames that are out of order, empty or past the end', () => {
    expect(() => serializeReplay({ ...FILE, frames: [FILE.frames[1], FILE.frames[0]] })).toThrow();
    expect(() => serializeReplay({ ...FILE, frames: [{ t: 3, c: [] }] })).toThrow();
    expect(() => serializeReplay({ ...FILE, frames: [{ t: 10, c: [stamp(0)] }] })).toThrow();
  });
});
