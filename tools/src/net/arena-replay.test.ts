// GH-954 W3: recording a game and replaying it. Real games on the local relay (rush against passive, in process;
// NO model runs and no key is read or set). The gates, each with the one-line mutation that turned it red (the list is
// in the commit message):
//   - replay equals referee: the sim a replay ends in has the referee's `sim.hash()`;
//   - speed does not change the outcome: 0.5x and 8x, and other frame lengths, end in one state;
//   - a build mismatch is refused;
//   - a file name is validated: `../` and an absolute path are refused (and, over a real socket, behind the guards);
//   - no token and no template in any results or frames file.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { denseFrames, parseReplay, ReplayRefused, serializeReplay, type ReplayFile } from '../../../packages/app/src/net/replay-file';
import { REPLAY_SPEEDS } from '../../../packages/app/src/net/replay-transport';
import { runArena, type RefereeDigest } from './arena';
import { replayToEnd } from './arena-replay';
import { displayName, displayNames, recordGame } from './arena-frames';
import { parsePresets } from './arena-presets';
import { FRAMES_NAME, listResults, resolveFramesFile, resultsRoutes } from './arena-results';
import { startArenaServe, type ArenaServe } from './arena-serve';
import { buildId } from './build-id';
import { inProcess, passive, rush, type ArenaPlayer } from './players';
import type { JudgeRecord } from './judge';
import { playerScore } from './score-fixture';

const dirs: string[] = [];
const serves: ArenaServe[] = [];
afterEach(async () => {
  while (serves.length > 0) await serves.pop()?.close({ now: true });
  while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true });
});
const outDir = (): string => { const d = mkdtempSync(join(tmpdir(), 'arena-replay-')); dirs.push(d); return d; };
const quiet = { log: () => {}, print: () => {} };
/** One seed, two games, short enough to replay five times over, long enough for rush to give orders. */
const ARGV = ['--a', 'rush', '--b', 'passive', '--seeds', '1', '--first-seed', '7', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '900'];
const BUILD = buildId();

const framesFiles = (out: string): string[] => readdirSync(out).filter((f) => f.endsWith('.frames.jsonl')).sort();
const read = (out: string, f: string): ReplayFile => parseReplay(readFileSync(join(out, f), 'utf8'), { build: BUILD });

/** Plays the short run once and shares it: every gate below reads the same two games. */
interface Played { out: string; referees: Map<number, RefereeDigest>; files: string[] }
let played: Played | null = null;
async function play(): Promise<Played> {
  if (played !== null) return played;
  const out = mkdtempSync(join(tmpdir(), 'arena-replay-shared-'));
  const referees = new Map<number, RefereeDigest>();
  const r = await runArena([...ARGV, '--out', out], { ...quiet, onGameEnd: (e) => { referees.set(e.n, e.referee); } });
  expect(r.code).toBe(0);
  played = { out, referees, files: framesFiles(out) };
  return played;
}

describe('a game is recorded', () => {
  it('writes one frames file a game, named for the game, holding the build, the config and the commands, and ending with both digests', async () => {
    const p = await play();
    expect(p.files).toHaveLength(2);
    expect(p.files.every((f) => FRAMES_NAME.test(f) && /-game[12]\.frames\.jsonl$/.test(f))).toBe(true);
    for (const [i, f] of p.files.entries()) {
      const file = read(p.out, f);
      const referee = p.referees.get(i + 1);
      expect(referee).toBeDefined();
      expect(file.header.build).toBe(BUILD);
      expect(file.header.config.map).toBe('tel_marum');
      expect(file.header.game).toMatchObject({ n: i + 1, of: 2, seed: 56433, capTicks: 900, pace: 40 });
      // Not vacuous: a real game (the cap), with orders in it, and the end line is the referee's own numbers.
      expect(file.end.ticks).toBe(900);
      expect(file.frames.length).toBeGreaterThanOrEqual(1);
      expect(file.end.referee).toEqual(referee);
      expect(file.end.watcher).toEqual(referee);
    }
  }, 120_000);
});

describe('gate: replay equals referee', () => {
  it('a fresh sim fed the recorded file ends in the referee\'s tick and sim.hash()', async () => {
    const p = await play();
    for (const [i, f] of p.files.entries()) {
      const referee = p.referees.get(i + 1);
      const end = replayToEnd(read(p.out, f));
      expect(end.tick).toBe(referee?.tick);
      expect(end.hash).toBe(referee?.hash);
    }
  }, 120_000);

  it('is not vacuous: a file with one command dropped ends somewhere else', async () => {
    const p = await play();
    const file = read(p.out, p.files[0]);
    const dropped: ReplayFile = { ...file, frames: file.frames.slice(1) };
    expect(file.frames.length).toBeGreaterThanOrEqual(1);
    expect(replayToEnd(dropped).hash).not.toBe(file.end.referee.hash);
  }, 120_000);
});

describe('gate: speed does not change the outcome', () => {
  it('every speed from 0.5x to 8x, at several frame lengths, ends in one state: the referee\'s', async () => {
    const p = await play();
    const file = read(p.out, p.files[0]);
    const runs: { speed: number; frameMs: number; perFrame: number; frames: number }[] = [];
    for (const speed of REPLAY_SPEEDS) {
      for (const [frameMs, perFrame] of [[16, 4], [7, 2], [33, 40]] as const) {
        let frames = 0;
        const end = replayToEnd(file, { speed, frameMs, perFrame, onFrame: () => { frames++; } });
        expect(end, `${speed}x at ${frameMs} ms`).toEqual(file.end.referee);
        runs.push({ speed, frameMs, perFrame, frames });
      }
    }
    // And the schedule did differ: 8x needed far fewer animation frames than 0.5x for the same game.
    const at = (speed: number): number => runs.find((r) => r.speed === speed && r.frameMs === 16)?.frames ?? 0;
    expect(at(0.5)).toBeGreaterThan(at(8) * 4);
    expect(denseFrames(file)).toHaveLength(900);
  }, 240_000);
});

describe('gate: a build mismatch is refused', () => {
  it('a file recorded on another build is not read, and the refusal names that build', async () => {
    const p = await play();
    const text = readFileSync(join(p.out, p.files[0]), 'utf8');
    expect(() => parseReplay(text, { build: '0.0.1+deadbeef' })).toThrow(ReplayRefused);
    try {
      parseReplay(text, { build: '0.0.1+deadbeef' });
    } catch (e) {
      expect(e).toMatchObject({ code: 'build_mismatch', detail: { fileBuild: BUILD } });
    }
    // The same text with its header's build changed is refused by the build the server runs.
    const lines = text.split('\n');
    const header = JSON.parse(lines[0]) as { build: string };
    lines[0] = JSON.stringify({ ...header, build: '0.0.1+deadbeef' });
    expect(() => parseReplay(lines.join('\n'), { build: BUILD })).toThrow(/recorded on build "0\.0\.1\+deadbeef"/);
  }, 120_000);

  it('the replay route answers 409 with both builds, and reads the file when they agree', async () => {
    const p = await play();
    const other = resultsRoutes({ dir: p.out, build: () => '0.0.1+deadbeef' }).replay;
    const refused = await other.handle({ url: `/arena/api/replay?game=${p.files[0]}` } as never, {});
    expect(refused).toEqual({ status: 409, body: { error: 'build_mismatch', fileBuild: BUILD, build: '0.0.1+deadbeef' } });
    const same = resultsRoutes({ dir: p.out, build: () => BUILD }).replay;
    const ok = await same.handle({ url: `/arena/api/replay?game=${p.files[0]}` } as never, {});
    expect(ok.status).toBe(200);
    expect((ok.body as { replay: ReplayFile }).replay.end.ticks).toBe(900);
  }, 120_000);

  it('the results list says which files were recorded on this build', async () => {
    const p = await play();
    const list = listResults({ dir: p.out, build: () => BUILD });
    expect(list.runs[0].games.map((g) => g.buildMatches)).toEqual([true, true]);
    const other = listResults({ dir: p.out, build: () => '0.0.1+deadbeef' });
    expect(other.runs[0].games.map((g) => g.buildMatches)).toEqual([false, false]);
  }, 120_000);
});

describe('gate: path traversal is refused', () => {
  it('only the name of a frames file in the directory is read: ../ and an absolute path are refused at the name check', async () => {
    const p = await play();
    const secret = join(outDir(), 'secret.frames.jsonl');
    writeFileSync(secret, 'outside');
    const refuse = (name: unknown, why: 'name' | 'not_listed'): void => { expect(resolveFramesFile(p.out, name), String(name)).toEqual({ ok: false, why }); };
    for (const name of [
      '../x.frames.jsonl', '../../etc/passwd', '..', '../', '/etc/passwd', secret, `${p.out}/${p.files[0]}`, 'sub/x.frames.jsonl',
      '..\\x.frames.jsonl', '.hidden.frames.jsonl', `${p.files[0]}\0.md`, `${p.files[0]}/`, 'a:b.frames.jsonl', '', 42, null, undefined,
    ]) refuse(name, 'name');
    // A real file of the directory that is not a frames file: refused by shape.
    refuse(readdirSync(p.out).find((f) => f.endsWith('.md')), 'name');
    refuse(readdirSync(p.out).find((f) => f.endsWith('.jsonl') && !f.endsWith('.frames.jsonl')), 'name');
    // A well-formed name nothing in the directory has: not listed.
    refuse('nothing.frames.jsonl', 'not_listed');
    expect(resolveFramesFile(p.out, p.files[0])).toMatchObject({ ok: true, name: p.files[0] });
  }, 120_000);

  it('a link in the directory is not followed, even if its name is a frames file\'s', async () => {
    const out = outDir();
    const outside = join(outDir(), 'real.frames.jsonl');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(out, 'link.frames.jsonl'));
    expect(resolveFramesFile(out, 'link.frames.jsonl')).toEqual({ ok: false, why: 'not_listed' });
  });

  it('over a real socket, behind Host, Origin and the key: ../, an encoded ../ and an absolute path all fail, and nothing outside is sent', async () => {
    const p = await play();
    const outside = join(outDir(), 'secret.frames.jsonl');
    writeFileSync(outside, 'TOPSECRET-OUTSIDE');
    const s = await startArenaServe({ app: false, token: 'a-long-random-run-token', log: () => {}, finishedGraceMs: 0, resultsDir: p.out, build: () => BUILD });
    serves.push(s);
    const get = (path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: s.port, method: 'GET', path, headers: { host: `127.0.0.1:${s.port}`, 'x-arena-token': 'a-long-random-run-token', ...headers } }, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') }); });
      });
      req.on('error', reject);
      req.end();
    });
    const q = (v: string): string => `/arena/api/replay?game=${v}`;
    for (const bad of ['../x.frames.jsonl', '%2e%2e%2fx.frames.jsonl', '..%2F..%2Fetc%2Fpasswd', '%2Fetc%2Fpasswd', '/etc/passwd', encodeURIComponent(outside), '']) {
      const r = await get(q(bad));
      expect(r.status, bad).toBe(400);
      expect(r.text).not.toContain('TOPSECRET');
    }
    expect((await get('/arena/api/replay')).status).toBe(400);
    expect((await get(q('nothing.frames.jsonl'))).status).toBe(404);
    // The guards come first.
    expect((await get(q(p.files[0]), { 'x-arena-token': 'wrong' })).status).toBe(403);
    expect((await get(q(p.files[0]), { host: 'evil.example' })).status).toBe(421);
    expect((await get(q(p.files[0]), { origin: 'https://evil.example' })).status).toBe(403);
    const ok = await get(q(p.files[0]));
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toMatchObject({ build: BUILD, file: p.files[0] });
  }, 120_000);
});

describe('gate: no token and no template in any results or frames file', () => {
  /** A preset player whose id is the token and whose label carries it; id-shaped, so only the redactor can catch it. */
  const TOKEN = 'sk-test-0123456789abcdefXYZ';
  const TRICKY = 'sk-fake-"quote\\back-0123456789';

  it('the token and its JSON-escaped form are in no file of the run, though a player\'s name and label carry it', async () => {
    const escaped = JSON.stringify(TRICKY).slice(1, -1);
    expect(escaped).not.toBe(TRICKY);
    for (const secret of [TOKEN, TRICKY]) {
      const out = outDir();
      const presets = parsePresets(JSON.stringify({ players: { [TOKEN]: { label: `Model ${secret}`, template: 'cmd:node /x/wrapper {mcp} < {prompt}' } } }), 'test');
      const r = await runArena(['--a', `preset:${TOKEN}`, '--b', 'passive', '--seeds', '1', '--first-seed', '7', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '300', '--out', out], {
        ...quiet, presets, env: { ANTHROPIC_API_KEY: secret },
        resolvePlayer: (spec) => inProcess(spec, spec === 'passive' ? passive : rush),
      });
      expect(r.code).toBe(0);
      const files = readdirSync(out);
      expect(files.filter((f) => f.endsWith('.frames.jsonl'))).toHaveLength(2);
      let sawLabel = false;
      for (const f of files) {
        const text = readFileSync(join(out, f), 'utf8');
        expect(text.includes(secret), `${f} has the token`).toBe(false);
        expect(text.includes(JSON.stringify(secret).slice(1, -1)), `${f} has the escaped token`).toBe(false);
        // Nor the preset's template: a preset names a model's command line, and no file of the run carries it.
        expect(text.includes('/x/wrapper'), `${f} has the template`).toBe(false);
        if (f.endsWith('.frames.jsonl') && text.includes('[redacted]')) sawLabel = true;
      }
      // Not vacuous: the token DID reach the frames text (as the id-shaped player name), and was redacted there.
      if (secret === TOKEN) expect(sawLabel).toBe(true);
    }
  }, 120_000);

  it('a cmd: template, as a player\'s name, is in no file: the config, the labels and the results list say Player A / an external player', async () => {
    const out = outDir();
    const TEMPLATE = 'cmd:node /private/wrapper --secret-flag-xyz {mcp} < {prompt}';
    const r = await runArena(['--a', TEMPLATE, '--b', 'passive', '--seeds', '1', '--first-seed', '7', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '300', '--out', out], {
      ...quiet, resolvePlayer: (spec) => inProcess(spec, spec === 'passive' ? passive : rush),
    });
    expect(r.code).toBe(0);
    const frames = framesFiles(out);
    expect(frames).toHaveLength(2);
    for (const f of frames) {
      const text = readFileSync(join(out, f), 'utf8');
      for (const needle of ['secret-flag-xyz', '/private/wrapper', 'cmd:', '{mcp}', '{prompt}']) expect(text.includes(needle), `${f} has ${needle}`).toBe(false);
      const file = read(out, f);
      // By PLAYER, not by seat: the cmd player is Player A in both games, wherever it sat.
      expect(file.header.labels).toEqual(file.header.game.n === 1 ? ['Player A', 'passive'] : ['passive', 'Player A']);
      expect(file.header.config.seats.map((s) => s.callsign)).toEqual(file.header.labels);
    }
    // The results list, which is built from the (unredacted, pre-existing) .jsonl, shows no template either.
    const body = JSON.stringify(listResults({ dir: out, build: () => BUILD }));
    for (const needle of ['secret-flag-xyz', '/private/wrapper', 'cmd:']) expect(body.includes(needle), `the list has ${needle}`).toBe(false);
    expect(listResults({ dir: out, build: () => BUILD }).runs[0].games[0].players).toEqual([null, 'passive']);
  }, 120_000);

  it('displayName: scripted names and ids pass, a preset id becomes its label, anything template-shaped is null', () => {
    expect(displayName('rush')).toBe('rush');
    expect(displayName('opus-5.5', (id) => (id === 'opus-5.5' ? 'Claude Opus 5.5' : null))).toBe('Claude Opus 5.5');
    expect(displayName('opus-5.5#a', (id) => (id === 'opus-5.5' ? 'Claude Opus 5.5' : null))).toBe('Claude Opus 5.5#a');
    for (const bad of ['cmd:claude -p', 'cmd:/abs/wrapper', 'a b', 'x/y', '../x', 'sk-"q', '']) expect(displayName(bad), bad).toBeNull();
    expect(displayNames(['cmd:x y', 'rush'])).toEqual(['Player A', 'rush']);
  });
});

describe('recordGame refuses a file that could not replay', () => {
  it('frames that are not the referee\'s ticks are not written', async () => {
    const p = await play();
    const file = read(p.out, p.files[0]);
    const frames = denseFrames(file);
    const input = { build: BUILD, game: file.header.game, names: ['rush', 'passive'] as [string, string], frames: { config: file.header.config, frames }, referee: file.end.referee, outcome: file.end.outcome, by: file.end.by };
    expect(recordGame(input).agrees).toBe(true);
    expect(() => recordGame({ ...input, frames: { config: file.header.config, frames: frames.slice(1) } })).toThrow(/not the referee's/);
    // A wrong referee hash is recorded as a disagreement, not hidden.
    expect(recordGame({ ...input, referee: { ...file.end.referee, hash: file.end.referee.hash ^ 1 } }).agrees).toBe(false);
  }, 120_000);

  it('the reader refuses what is cut off, reordered or not a frame', async () => {
    const p = await play();
    const text = readFileSync(join(p.out, p.files[0]), 'utf8');
    const lines = text.trimEnd().split('\n');
    const code = (t: string): string | undefined => { try { parseReplay(t, { build: BUILD }); return undefined; } catch (e) { return e instanceof ReplayRefused ? e.code : 'other'; } };
    expect(code(text)).toBeUndefined();
    expect(code(lines.slice(0, -1).join('\n'))).toBe('incomplete');          // no end line
    expect(code([lines[0], lines[2], lines[1], lines[lines.length - 1]].join('\n'))).toBe('bad_file');   // ticks must ascend
    expect(code([lines[0], '{"t":1,"c":[]}', lines[lines.length - 1]].join('\n'))).toBe('bad_file');
    expect(code('')).toBe('bad_file');
    expect(code('not json')).toBe('bad_file');
    expect(code(serializeReplay(read(p.out, p.files[0])))).toBeUndefined();
  }, 120_000);
});

describe('the results list', () => {
  it('shows players by preset label, map, mode, outcome and by, the judge\'s scores, cost per game and per run, the digests and a replay file', async () => {
    const out = outDir();
    const presets = parsePresets(JSON.stringify({ players: { 'opus-x': { label: 'Claude Opus X', template: 'cmd:node /x/wrapper {mcp} < {prompt}', usage: 'claude-json' } } }), 'test');
    const spent = { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 3000, cacheReadInputTokens: 45000, costUsd: 0.25 };
    const wrap = (p: ArenaPlayer): ArenaPlayer => ({ name: p.name, start: async (s) => { const r = await p.start(s); return { ...r, done: r.done.then((rep) => ({ ...rep, tokens: 120, usage: spent })) }; } });
    const judged: JudgeRecord = { status: 'scored', scores: { seat0: playerScore(8), seat1: playerScore(3) }, tokens: 5, usage: { ...spent, costUsd: 0.1 } };
    const r = await runArena(['--a', 'preset:opus-x', '--b', 'passive', '--seeds', '1', '--first-seed', '7', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '300', '--judge', 'cmd:judge-cli < {prompt}', '--out', out], {
      ...quiet, presets, runJudge: () => Promise.resolve(judged),
      resolvePlayer: (spec) => (spec.startsWith('preset:') ? wrap(inProcess(spec, rush)) : inProcess(spec, passive)),
    });
    expect(r.code).toBe(0);
    const body = listResults({ dir: out, build: () => BUILD, labelOf: (id) => presets.byId.get(id)?.label ?? null });
    expect(body.build).toBe(BUILD);
    expect(body.criteria.map((c) => c.id)).toEqual(['fewer_deaths', 'wounded_care', 'force_preservation', 'tempo_initiative', 'adaptation']);
    expect(body.runs).toHaveLength(1);
    const run = body.runs[0];
    expect(run.games).toHaveLength(2);
    const [g1, g2] = run.games;
    expect(g1).toMatchObject({ n: 1, map: 'tel_marum', matchup: 'mirror', players: ['Claude Opus X', 'passive'], ticks: 300 });
    expect(g2.players).toEqual(['passive', 'Claude Opus X']);
    expect(g1.file).toMatch(/-game1\.frames\.jsonl$/);
    expect(g1.outcome).toBe(r.games[0].outcome);
    expect(g1.by).toBe(r.games[0].by);
    // The judge's numbers, per criterion and overall; its reasons are not sent.
    expect(g1.judge).toMatchObject({ status: 'scored', scores: { overall: [8, 3] } });
    expect(JSON.stringify(body)).not.toContain('decided by the 5 to 3 trade');
    // Cost: what the model said it spent (0.25, one seat) and the judge (0.10) in the game; twice that in the run.
    expect(g1.usage.filter((u) => u !== null)).toHaveLength(1);
    expect(g1.costUsd).toBeCloseTo(0.35, 10);
    expect(run.costUsd).toBeCloseTo(0.7, 10);
    expect(run.totals.players).toHaveLength(1);
    expect(run.totals.players[0].player).toBe('Claude Opus X');
    expect(run.totals.players[0].usage.costUsd).toBeCloseTo(0.5, 10);
    expect(run.totals.judge?.costUsd).toBeCloseTo(0.2, 10);
    // The watcher digest, compared with the referee's.
    expect(g1.digest?.agree).toBe(true);
    expect(g1.digest?.watcher).toEqual(g1.digest?.referee);
    expect(g1.digest?.referee.tick).toBe(300);
  }, 120_000);

  it('a watcher digest that is not the referee\'s is shown as a disagreement', async () => {
    const p = await play();
    const out = outDir();
    const f = p.files[0];
    const lines = readFileSync(join(p.out, f), 'utf8').trimEnd().split('\n');
    const end = JSON.parse(lines[lines.length - 1]) as { watcher: { hash: number } };
    end.watcher.hash ^= 1;
    lines[lines.length - 1] = JSON.stringify(end);
    writeFileSync(join(out, f), `${lines.join('\n')}\n`);
    const base = f.replace(/-game\d\.frames\.jsonl$/, '');
    writeFileSync(join(out, `${base}.jsonl`), readFileSync(join(p.out, `${base}.jsonl`), 'utf8'));
    const body = listResults({ dir: out, build: () => BUILD });
    expect(body.runs[0].games[0].digest?.agree).toBe(false);
    expect(body.runs[0].games[1].file).toBeNull();
    expect(body.runs[0].games[1].digest).toBeNull();
  }, 120_000);

  it('an empty or missing directory lists no runs, and a half-written line is skipped', () => {
    const out = outDir();
    expect(listResults({ dir: join(out, 'nope'), build: () => BUILD }).runs).toEqual([]);
    mkdirSync(join(out, 'x'));
    expect(listResults({ dir: out, build: () => BUILD }).runs).toEqual([]);
    writeFileSync(join(out, '2026-01-01-a-vs-b.jsonl'), '{"players":["a","b"],"outcome"');
    expect(listResults({ dir: out, build: () => BUILD }).runs).toEqual([]);
  });
});
