// The versus replay verifier (GH-1398 slice 2): a recorded match is re-simmed headlessly and compared with the recording at the end AND at every
// checkpoint (version 2 files carry the sim's hash every 20 ticks). The fixture is recorded fresh in each run, not committed: a recording is
// stamped with the build, which changes with every commit, so a committed file would be refused by the very check under test.
// Every check here was seen red under the one-line mutations listed in the commit that landed it.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { economyStreamConfig, economyStreamFrames, runEconomyClient, ECONOMY_STREAM_TICKS } from '../../../packages/app/src/net/economy-stream.test-helper';
import { CHECK_EVERY_TICKS, MatchRecorder, RecorderError } from '../../../packages/app/src/net/match-recorder';
import { checkCount, parseReplay, ReplayRefused, serializeReplay, type ReplayFile } from '../../../packages/app/src/net/replay-file';
import type { MatchWorld } from '../../../packages/app/src/net/match-world';
import { replayToEnd } from './arena-replay';
import { buildId } from './build-id';
import { describeVerdict, runVerifyCli } from './replay-verify-cli';
import { verifyFile, verifyRecording } from './replay-verify';

const BUILD = '0.133.10+0123456789abcdef';

function record(build = BUILD, checkEvery?: number): { text: string; file: ReplayFile } {
  let world: MatchWorld | null = null;
  const rec = new MatchRecorder({ build, config: economyStreamConfig(), sim: { hash: () => { if (world === null) throw new Error('no world'); return world.sim.hash(); } }, ...(checkEvery === undefined ? {} : { checkEvery }) });
  const r = runEconomyClient(economyStreamFrames(), { onFrame: rec.record, afterFrame: rec.afterFrame, onWorld: (w) => { world = w; } });
  const file = rec.finish({ digest: { tick: r.ticks, hash: r.simHash }, outcome: 'unfinished', by: 'cap' });
  return { text: serializeReplay(file), file };
}

/** The sim's hash after EVERY tick of `file`, from a replay one tick a step: an oracle that does not read the checkpoints. */
function perTickHashes(file: ReplayFile): number[] {
  const out: number[] = [];
  replayToEnd(file, { perFrame: 1, onFrame: (tick, hash) => { if (tick > 0 && out.length < tick) out[tick - 1] = hash(); } });
  return out;
}

describe('a recording carries the sim hash every 20 ticks (format version 2)', () => {
  const { text, file } = record();

  it('writes v2 with one hash per multiple of 20 before the end', () => {
    expect(file.header.v).toBe(2);
    expect(file.end.checks?.every).toBe(CHECK_EVERY_TICKS);
    expect(file.end.checks?.hashes).toHaveLength(checkCount(ECONOMY_STREAM_TICKS, 20));
    expect(file.end.checks?.hashes).toHaveLength(59);
    // A moving world: the checkpoints are states, not one repeated number.
    expect(new Set(file.end.checks?.hashes).size).toBeGreaterThan(30);
    expect(parseReplay(text, { build: BUILD })).toEqual(file);
  });

  it('each recorded checkpoint is the sim\'s hash after that many ticks (an oracle that replays one tick a step)', () => {
    const per = perTickHashes(file);
    expect(per).toHaveLength(ECONOMY_STREAM_TICKS);
    file.end.checks?.hashes.forEach((h, i) => expect(per[(i + 1) * 20 - 1], `checkpoint ${i + 1}`).toBe(h));
    expect(per[ECONOMY_STREAM_TICKS - 1]).toBe(file.end.referee.hash);
  }, 60_000);

  it('the file stays small: the 59 checkpoints add a few hundred bytes', () => {
    expect(text.length).toBeLessThan(5_000 + 59 * 14);
  });
});

describe('the verifier reports the final hash and finds the first divergent checkpoint', () => {
  const { text, file } = record();
  const clone = (): ReplayFile => parseReplay(text, { build: BUILD });
  const first = (a: readonly number[], b: readonly number[]): number => a.findIndex((h, i) => h !== b[i]) + 1; // 1-based tick count, 0 = none
  const clean = perTickHashes(file);

  it('control: the untouched recording verifies, all 59 checkpoints and the end', () => {
    const v = verifyRecording(text, { build: BUILD });
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') {
      expect(v.checked).toBe(59);
      expect(v.digest).toEqual(file.end.referee);
    }
  }, 60_000);

  it('one command tampered (a rally point moved a tile): desync, located at the first checkpoint at or after the tick the states first differ', () => {
    const f = clone();
    const cmd = f.frames.flatMap((fr) => fr.c).find((s) => s.cmd.kind === 'setRally');
    if (cmd === undefined || cmd.cmd.kind !== 'setRally') throw new Error('the stream has no setRally');
    cmd.cmd.x += 65536;
    const tampered = perTickHashes(f);
    const t = first(clean, tampered); // the first tick whose hash differs, found with no checkpoint
    expect(t).toBeGreaterThan(0);
    const v = verifyFile(f);
    expect(v.kind).toBe('desync');
    if (v.kind !== 'desync') return;
    expect(v.divergence).not.toBeNull();
    expect(v.divergence?.atEnd).toBe(false);
    expect(v.divergence?.atTick).toBe(Math.ceil(t / 20) * 20);
    expect(v.divergence?.afterTick).toBe((v.divergence?.atTick ?? 0) - 20);
    expect(v.divergence?.recorded).not.toBe(v.divergence?.replayed);
    // the same tamper is found at the same place whatever the replay speed and batch a caller asks for
    expect(verifyFile(f, { speed: 8, frameMs: 200, perFrame: 16 })).toMatchObject({ kind: 'desync', divergence: { atTick: Math.ceil(t / 20) * 20 } });
  }, 120_000);

  it('a command dropped from an early frame diverges at the first checkpoint that sees it', () => {
    const f = clone();
    f.frames = f.frames.filter((fr) => fr.t !== 5); // the opening builds of both seats
    expect(f.frames.length).toBe(file.frames.length - 1);
    const t = first(clean, perTickHashes(f));
    const v = verifyFile(f);
    expect(v).toMatchObject({ kind: 'desync', divergence: { atTick: Math.ceil(t / 20) * 20, atEnd: false } });
  }, 120_000);

  it('a doctored checkpoint is found at that checkpoint, though the frames and the end line are honest', () => {
    const f = clone();
    const checks = f.end.checks;
    if (checks === undefined) throw new Error('no checks');
    checks.hashes[29] = (checks.hashes[29] ?? 0) ^ 1; // the checkpoint at tick 600
    const v = verifyFile(f);
    expect(v).toMatchObject({ kind: 'desync', divergence: { atTick: 600, afterTick: 580, atEnd: false } });
    if (v.kind === 'desync') {
      expect(v.recorded).toEqual(file.end.referee); // the end still matches: only the checkpoint says so
      expect(v.replayed).toEqual(file.end.referee);
      expect(v.checked).toBe(59); // it goes on to read the rest
    }
  }, 60_000);

  it('every checkpoint matches and the end line is doctored: the divergence is the last window, at the end', () => {
    const f = clone();
    f.end.referee = { tick: f.end.referee.tick, hash: f.end.referee.hash ^ 1 };
    const v = verifyFile(f);
    expect(v).toMatchObject({ kind: 'desync', divergence: { atTick: ECONOMY_STREAM_TICKS, afterTick: 1180, atEnd: true } });
  }, 60_000);

  it('a file with no checkpoints (the arena\'s version 1) still verifies on the end hash, and says it cannot locate a divergence', () => {
    const f = clone();
    const v1: ReplayFile = { ...f, header: { ...f.header, v: 1 }, end: { ...f.end, checks: undefined } };
    delete v1.end.checks;
    const ok = verifyRecording(serializeReplay(v1), { build: BUILD });
    expect(ok).toMatchObject({ kind: 'ok', checked: 0 });
    v1.end.referee = { tick: v1.end.referee.tick, hash: v1.end.referee.hash ^ 1 };
    const bad = verifyFile(v1);
    expect(bad).toMatchObject({ kind: 'desync', divergence: null });
    expect(describeVerdict(bad, 'x', BUILD)).toMatch(/not located \(the file has no checkpoints\)/);
  }, 120_000);
});

describe('a recording of another build or format is refused before a frame is replayed', () => {
  const { text } = record();

  it('the build stamp flipped: refused as build_mismatch, naming both builds', () => {
    const v = verifyRecording(text, { build: '0.134.0+fedcba9876543210' });
    expect(v).toMatchObject({ kind: 'refused', code: 'build_mismatch' });
    if (v.kind === 'refused') expect(v.why).toMatch(/recorded on build "0\.133\.10\+0123456789abcdef", this is "0\.134\.0\+fedcba9876543210"/);
    // and the same through the file's own text: change the stamp in the header, verify on the original build
    const flipped = text.replace('"build":"0.133.10+0123456789abcdef"', '"build":"0.133.10+ffffffffffffffff"');
    expect(flipped).not.toBe(text);
    expect(verifyRecording(flipped, { build: BUILD })).toMatchObject({ kind: 'refused', code: 'build_mismatch' });
  });

  it('a format version this build does not read is refused, even on the right build', () => {
    for (const v of [0, 3]) {
      const r = verifyRecording(text.replace('"v":2', `"v":${v}`), { build: BUILD });
      expect(r, `v${v}`).toMatchObject({ kind: 'refused', code: 'bad_file' });
      if (r.kind === 'refused') expect(r.why).toMatch(new RegExp(`format version ${v}, this build reads 1 to 2`));
    }
  });

  it('checks in a version 1 file, or a checkpoint count that does not fit the length, are bad files', () => {
    const lines = text.trimEnd().split('\n');
    const end = JSON.parse(lines[lines.length - 1] ?? '{}') as { checks: { every: number; hashes: number[] } };
    const code = (head: string, e: unknown): string => {
      try { parseReplay([head, ...lines.slice(1, -1), JSON.stringify(e)].join('\n'), { build: BUILD }); return 'ok'; } catch (x) { return x instanceof ReplayRefused ? x.code : 'other'; }
    };
    expect(code(lines[0] ?? '', end)).toBe('ok');
    expect(code((lines[0] ?? '').replace('"v":2', '"v":1'), end)).toBe('bad_file');
    expect(code(lines[0] ?? '', { ...end, checks: { every: 20, hashes: end.checks.hashes.slice(1) } })).toBe('bad_file');
    expect(code(lines[0] ?? '', { ...end, checks: { every: 0, hashes: [] } })).toBe('bad_file');
    expect(code(lines[0] ?? '', { ...end, checks: { every: 20, hashes: end.checks.hashes.map(String) } })).toBe('bad_file');
  });
});

describe('MatchRecorder checkpoints', () => {
  const config = economyStreamConfig();
  const sim = { hash: () => 7 };
  const frame = (tick: number) => ({ tick, cmds: [] });

  it('refuses to close a recording whose afterFrame was never called, or was called past a gap', () => {
    const never = new MatchRecorder({ build: BUILD, config, sim, checkEvery: 2 });
    for (let t = 0; t < 6; t++) never.record(frame(t));
    expect(() => never.finish({ digest: { tick: 6, hash: 7 }, outcome: 'x', by: 'y' })).toThrow(/2 expected for 6 ticks/);
    const gap = new MatchRecorder({ build: BUILD, config, sim, checkEvery: 2 });
    gap.record(frame(0));
    gap.afterFrame(0);
    gap.record(frame(1)); // afterFrame(1) skipped
    gap.record(frame(2));
    expect(() => gap.afterFrame(2)).toThrow(/afterFrame\(2\) came when 1 was next/);
  });

  it('refuses an afterFrame for a frame that was not the last recorded', () => {
    const rec = new MatchRecorder({ build: BUILD, config, sim });
    rec.record(frame(0));
    rec.record(frame(1));
    expect(() => rec.afterFrame(0)).toThrow(RecorderError);
  });

  it('a caller that also reports the deciding frame has its extra checkpoint dropped when it is the end hash, and refused when it is not', () => {
    const run = (hashAtEnd: number) => {
      const rec = new MatchRecorder({ build: BUILD, config, sim: { hash: () => hashAtEnd }, checkEvery: 2 });
      for (let t = 0; t < 4; t++) { rec.record(frame(t)); rec.afterFrame(t); }
      return rec.finish({ digest: { tick: 4, hash: 7 }, outcome: 'x', by: 'y' });
    };
    expect(run(7).end.checks).toEqual({ every: 2, hashes: [7] });
    expect(() => run(8)).toThrow(/not the end hash/);
  });

  it('with no sim there are no checkpoints, and it says so in the file', () => {
    const rec = new MatchRecorder({ build: BUILD, config });
    for (let t = 0; t < 5; t++) { rec.record(frame(t)); rec.afterFrame(t); }
    const f = rec.finish({ digest: { tick: 5, hash: 1 }, outcome: 'x', by: 'y' });
    expect(f.end.checks).toBeUndefined();
    expect(f.header.v).toBe(2);
  });

  it('a checkpoint interval that is not a positive integer is refused at construction', () => {
    for (const bad of [0, -1, 1.5]) expect(() => new MatchRecorder({ build: BUILD, config, sim, checkEvery: bad })).toThrow(RecorderError);
  });
});

describe('the command line', () => {
  const { text } = record();
  const deps = (t: string = text, build = BUILD) => ({ read: (p: string) => { if (p === 'missing') throw new Error('ENOENT'); return t; }, build: () => build });

  it('a verified recording: exit 0, both final hashes, the checkpoints and OK', () => {
    const r = runVerifyCli(['rec.jsonl'], deps());
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/final state hash: recorded -?\d+, replayed -?\d+ at tick 1200/);
    expect(r.out).toMatch(/checkpoints: 59 checked, every 20 ticks, all match/);
    expect(r.out).toMatch(/OK: the recording re-sims/);
  }, 60_000);

  it('a tampered recording: exit 1, the first divergent checkpoint and its window', () => {
    const f = parseReplay(text, { build: BUILD });
    const checks = f.end.checks;
    if (checks === undefined) throw new Error('no checks');
    checks.hashes[9] = (checks.hashes[9] ?? 0) ^ 1;
    const r = runVerifyCli(['rec.jsonl'], deps(serializeReplay(f)));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/first divergence: checkpoint at tick 200, so between ticks 180 and 200: recorded -?\d+, replayed -?\d+/);
    expect(r.out).toMatch(/DESYNC/);
  }, 60_000);

  it('another build: exit 2, REFUSED, both builds named, nothing replayed', () => {
    const r = runVerifyCli(['rec.jsonl', '--build', '0.134.0+fedcba9876543210'], deps());
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/REFUSED \(build_mismatch\).*0\.133\.10\+0123456789abcdef.*0\.134\.0\+fedcba9876543210/);
    expect(r.out).toMatch(/nothing was replayed/);
  });

  it('an unreadable file, a missing argument and an unknown option are exit 2 with the usage', () => {
    expect(runVerifyCli(['missing'], deps())).toMatchObject({ code: 2 });
    expect(runVerifyCli([], deps()).out).toMatch(/usage: pnpm replay:verify/);
    expect(runVerifyCli(['a', 'b'], deps())).toMatchObject({ code: 2 });
    expect(runVerifyCli(['a', '--nope'], deps())).toMatchObject({ code: 2 });
    expect(runVerifyCli(['a', '--build'], deps())).toMatchObject({ code: 2 });
    expect(runVerifyCli(['not a recording'], deps('not json')).code).toBe(2);
  });

  it('--json is one line a program can read', () => {
    const r = runVerifyCli(['rec.jsonl', '--json'], deps());
    expect(JSON.parse(r.out)).toMatchObject({ verdict: 'ok', ticks: 1200, checked: 59 });
    expect(JSON.parse(runVerifyCli(['rec.jsonl', '--json', '--build', 'other'], deps()).out)).toMatchObject({ verdict: 'refused', code: 'build_mismatch' });
  });

  it('as a real process: exit codes 0 (verified), 1 (desync) and 2 (refused), reading a path relative to where it was typed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-replay-'));
    const build = buildId();
    const real = record(build);
    writeFileSync(join(dir, 'ok.frames.jsonl'), real.text);
    const bad = parseReplay(real.text, { build });
    bad.end.referee = { tick: bad.end.referee.tick, hash: bad.end.referee.hash ^ 1 };
    writeFileSync(join(dir, 'bad.frames.jsonl'), serializeReplay(bad));
    writeFileSync(join(dir, 'old.frames.jsonl'), real.text.replace(`"build":"${build}"`, '"build":"0.1.0+0000000"'));
    const run = (name: string) => spawnSync('pnpm', ['exec', 'tsx', join(__dirname, 'replay-verify-cli.ts'), name], { cwd: join(__dirname, '../..'), env: { ...process.env, INIT_CWD: dir }, encoding: 'utf8' });
    const ok = run('ok.frames.jsonl');
    expect([ok.status, ok.stdout]).toEqual([0, expect.stringMatching(/OK: the recording re-sims/)]);
    const ds = run('bad.frames.jsonl');
    expect([ds.status, ds.stderr]).toEqual([1, expect.stringMatching(/DESYNC/)]);
    const old = run('old.frames.jsonl');
    expect([old.status, old.stderr]).toEqual([2, expect.stringMatching(/REFUSED \(build_mismatch\)/)]);
  }, 240_000);
});
