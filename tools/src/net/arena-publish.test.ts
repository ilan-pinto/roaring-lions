// GH-954 public-arena P2: the publisher's gates G1-G8, G13, G14 (design §5). Fixtures only: no model, no arena match, no
// key, and never the real ~/.roaring-lions/arena-players.json (every call names its own private file).
import AjvModule from 'ajv/dist/2020.js';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { arenaResultsFailures, denyHits, digestOf } from '../../validate_arena_results.mjs';
import { runArena } from './arena';
import { MIN_AHEAD, MIN_SCORED, keep, modelPinOf, parsePublicPlayers, parsePublishArgs, publish, runPublish, wilson, type ArenaResults, type PublishArgs } from './arena-publish';
import { renderPreview } from './arena-results-render';
import { binomialP } from './arena-score';

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'arena-publish-')); dirs.push(d); return d; };

const DIGEST = 'a'.repeat(64);
const BUILD = '1.2.3+abcdef0';
const ALLOW = {
  version: 1,
  players: {
    opus: { label: 'Claude Opus 5.5', vendor: 'Anthropic', modelId: 'claude-opus-5-5' },
    sonnet: { label: 'Claude Sonnet 5.5', vendor: 'Anthropic', modelId: 'claude-sonnet-5-5' },
  },
  scripted: { passive: { label: 'Scripted: passive' }, rush: { label: 'Scripted: rush' } },
};
const PRIVATE = {
  players: {
    opus: { label: 'my opus', template: 'cmd:claude -p --model claude-opus-5-5 --mcp-config {mcp} < {prompt}', judgeTemplate: 'cmd:claude -p --model claude-opus-5-5 --output-format json < {prompt}' },
    sonnet: { label: 'my sonnet', template: 'cmd:claude -p --model claude-sonnet-5-5 --mcp-config {mcp} < {prompt}' },
  },
};

type Over = Record<string, unknown>;
const crit = (s: number): Record<string, { score: number; reason: string }> => Object.fromEntries(['fewer_deaths', 'wounded_care', 'force_preservation', 'tempo_initiative', 'adaptation'].map((id) => [id, { score: s, reason: 'REASON-http://leak' }]));
const scoredJudge = (a: number, b: number): Over => ({ status: 'scored', tokens: 1, scores: { seat0: { criteria: crit(a), overall: { score: a, reason: 'x' } }, seat1: { criteria: crit(b), overall: { score: b, reason: 'x' } } } });
const rec = (over: Over = {}): Over => ({
  seed: 1000, map: 'tel_marum', matchup: 'mirror', mode: 'annihilation', players: ['opus', 'sonnet'], factions: ['kdf', 'sarim'], outcome: 'seat0', by: 'annihilation', ticks: 900,
  build: BUILD, pace: 60, roundWallMs: 120000, capTicks: 12000, promptDigest: DIGEST,
  score: [{}, {}], reports: [{ errors: ['sk-ant-SECRETSECRET /Users/x/y'], timeouts: 0 }, { errors: [], timeouts: 0 }], ...over,
});

interface Rig { root: string; dir: string; priv: string }
function rig(allow: unknown = ALLOW, priv: unknown = PRIVATE): Rig {
  const root = tmp();
  mkdirSync(join(root, 'data/arena'), { recursive: true });
  writeFileSync(join(root, 'data/arena/public-players.json'), JSON.stringify(allow));
  const dir = join(root, 'arena-results');
  mkdirSync(dir);
  const pf = join(root, 'arena-players.json');
  writeFileSync(pf, JSON.stringify(priv));
  chmodSync(pf, 0o600);
  return { root, dir, priv: pf };
}
const writeRun = (r: Rig, id: string, recs: Over[]): void => { writeFileSync(join(r.dir, `${id}.jsonl`), recs.map((x) => JSON.stringify(x)).join('\n') + '\n'); };
const ARGS = (over: Partial<PublishArgs> = {}): PublishArgs => ({ runs: ['r1'], mergeBuilds: false, judge: null, resultsDir: null, privateFile: null, ...over });
const go = (r: Rig, over: Partial<PublishArgs> = {}) => publish(ARGS(over), { root: r.root, resultsDir: r.dir, privateFile: r.priv, today: '2026-11-04', print: () => {} });
const outText = (r: Rig): string => readFileSync(join(r.root, 'data/arena/results.json'), 'utf8');

/** n games opus v sonnet: pairs with the seats swapped; `aWins` of them won by opus, `draws` drawn, the rest lost. */
function games(n: number, aWins: number, draws = 0, extra: Over = {}): Over[] {
  const out: Over[] = [];
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    const outcome = i < aWins ? 'A' : i < aWins + draws ? 'draw' : 'B';
    const o = outcome === 'draw' ? 'draw' : (outcome === 'A') !== swap ? 'seat0' : 'seat1';
    out.push(rec({ seed: 1000 + i, players: swap ? ['sonnet', 'opus'] : ['opus', 'sonnet'], outcome: o, ...extra }));
  }
  return out;
}

describe('G1 constructed: nothing private reaches the output, and a game with an unlisted seat is withheld whole', () => {
  it('a cmd: seat, an unlisted preset, a token-shaped error and a judge reason leave no trace, and are counted', () => {
    const r = rig();
    writeRun(r, 'r1', [
      ...games(10, 5),
      rec({ seed: 7, players: ['cmd:/Users/x/w', 'sonnet'] }),
      rec({ seed: 8, players: ['opus', 'stranger'] }),
      rec({ seed: 9, players: ['Player A', 'sonnet'] }),
      rec({ seed: 10, players: ['opus#a', 'opus#b'] }),
      rec({ seed: 11, judge: scoredJudge(7, 3) }),
    ]);
    const res = go(r);
    expect(res.code).toBe(0);
    const text = outText(r);
    expect(res.results?.withheld).toBe(4);
    for (const s of ['stranger', 'cmd:', '/Users/', 'sk-ant', 'SECRET', 'REASON', 'http', 'Player A', 'x/w']) expect(text).not.toContain(s);
    expect(readFileSync(join(r.dir, 'preview.html'), 'utf8')).not.toContain('REASON');
    expect(res.results?.sections[0].games).toBe(11);
  });

  it('keep() builds from named fields: errors, usage, and a judge reason are never read', () => {
    const trap = (name: string) => ({ get: () => { throw new Error(`read ${name}`); }, enumerable: true });
    const line = rec({ judge: scoredJudge(5, 5) });
    Object.defineProperty(line, 'reports', trap('reports'));
    Object.defineProperty(line, 'usage', trap('usage'));
    const scores = (line.judge as { scores: Record<string, { criteria: Record<string, object>; overall: object }> }).scores;
    for (const seat of ['seat0', 'seat1']) {
      Object.defineProperty(scores[seat].overall, 'reason', trap('reason'));
      for (const c of Object.values(scores[seat].criteria)) Object.defineProperty(c, 'reason', trap('reason'));
    }
    expect(keep(line, 'r1').ok).toBe(true);
  });
});

describe('G2 closed schema', () => {
  const schema = JSON.parse(readFileSync(join(__dirname, '../../../data/schemas/arena-results.schema.json'), 'utf8')) as object;
  const Ajv = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
  const validate = new (Ajv as unknown as new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) })({ allErrors: true, strict: false }).compile(schema);

  it('the publisher\'s output passes, and an added field at the top, in a section or in a game does not', () => {
    const r = rig();
    writeRun(r, 'r1', [...games(12, 6), rec({ seed: 99, judge: scoredJudge(6, 4) })]);
    go(r, { judge: 'opus' });
    const doc = JSON.parse(outText(r)) as ArenaResults & Record<string, unknown>;
    expect(validate(doc)).toBe(true);
    expect(validate({ ...doc, note2: 'x' })).toBe(false);
    expect(validate({ ...doc, sections: [{ ...doc.sections[0], extra: 1 }] })).toBe(false);
    expect(validate({ ...doc, sections: [{ ...doc.sections[0], gameList: [{ ...doc.sections[0].gameList[0], reason: 'x' }] }] })).toBe(false);
  });
});

describe('G3 deny scan', () => {
  it('each denied string is found, in a value and in a key', () => {
    for (const bad of ['cmd:x', '/Users/ilpinto', '~/x', 'a\\b', 'sk-abc', 'a@b', 'https://x', 'ANTHROPIC_API_KEY']) {
      expect(denyHits(JSON.stringify({ k: bad })).length, bad).toBeGreaterThan(0);
      expect(denyHits(JSON.stringify({ [bad]: 1 })).length, bad).toBeGreaterThan(0);
    }
    expect(denyHits('Claude Opus 5.5 (Anthropic) tel_marum')).toEqual([]);
  });

  it('the tool\'s belt refuses a label that passes the character rule but holds a denied string, and writes nothing', () => {
    const allow = { ...ALLOW, players: { ...ALLOW.players, opus: { ...ALLOW.players.opus, label: 'Mask-sk-1' } } };
    const r = rig(allow);
    writeRun(r, 'r1', games(10, 5));
    const res = go(r);
    expect(res.code).toBe(1);
    expect(res.message).toContain('sk-');
    expect(existsSync(join(r.root, 'data/arena/results.json'))).toBe(false);
  });

  it('the allow-list parser refuses characters a path or address needs', () => {
    for (const label of ['/Users/ilpinto', 'a@b.c', 'https://x.y', 'C:\\x']) {
      expect(() => parsePublicPlayers(JSON.stringify({ ...ALLOW, players: { opus: { ...ALLOW.players.opus, label } } })), label).toThrow();
    }
  });
});

describe('G4 the template\'s --model pin', () => {
  it('reads a single --model and nothing else', () => {
    expect(modelPinOf('cmd:claude -p --model claude-opus-5-5 --x')).toBe('claude-opus-5-5');
    expect(modelPinOf('cmd:claude --model=a-b')).toBe('a-b');
    expect(modelPinOf('cmd:claude -p')).toBeNull();
    expect(modelPinOf('cmd:claude --model a --model b')).toBeNull();
  });

  it('refuses a run whose template pins another model, naming the preset and never the template', () => {
    const other = { players: { ...PRIVATE.players, opus: { ...PRIVATE.players.opus, template: 'cmd:claude -p --model claude-haiku-9 --mcp-config {mcp} < {prompt}' } } };
    const r = rig(ALLOW, other);
    writeRun(r, 'r1', games(10, 5));
    const res = go(r);
    expect(res.code).toBe(1);
    expect(res.message).toContain('"opus"');
    expect(res.message).not.toContain('haiku');
    expect(res.message).not.toContain('cmd:');
    expect(existsSync(join(r.root, 'data/arena/results.json'))).toBe(false);
  });

  it('refuses when there is no private file to check against, and a judge pinned to another model', () => {
    const r = rig();
    writeRun(r, 'r1', games(10, 5));
    expect(publish(ARGS(), { root: r.root, resultsDir: r.dir, privateFile: null, today: '2026-11-04', print: () => {} }).code).toBe(1);
    const sonnetJudge = rig(ALLOW, { players: { ...PRIVATE.players, sonnet: { ...PRIVATE.players.sonnet, judgeTemplate: 'cmd:claude -p --model claude-opus-5-5 < {prompt}' } } });
    writeRun(sonnetJudge, 'r1', games(10, 5));
    expect(go(sonnetJudge, { judge: 'sonnet' }).code).toBe(1);
  });

  it('a scripted-only run needs no private file; the real one is never read by a test (the default path is main\'s)', () => {
    const r = rig();
    writeRun(r, 'r1', games(10, 5).map((g) => ({ ...g, players: ['passive', 'rush'] })));
    expect(publish(ARGS(), { root: r.root, resultsDir: r.dir, privateFile: null, today: '2026-11-04', print: () => {} }).code).toBe(0);
    const src = readFileSync(join(__dirname, 'arena-publish.ts'), 'utf8');
    expect(src.match(/defaultPresetsFile\(\)/g)?.length).toBe(1); // runPublish's default, nowhere else
  });
});

describe('G5 the numbers are the arena\'s own', () => {
  it('score, interval, head to head and p equal hand-computed literals; a draw is half a point, not a loss', () => {
    const r = rig();
    // 10 games, opus: 5 wins, 2 draws, 3 losses. score (5 + 1) / 10 = 0.6; p = P(X >= 6 | n=10) = 386 / 1024.
    writeRun(r, 'r1', games(10, 5, 2));
    const res = go(r).results as ArenaResults;
    const s = res.sections[0];
    const opus = s.models.find((m) => m.id === 'opus');
    expect(opus).toMatchObject({ wins: 5, draws: 2, losses: 3, score: 0.6, games: 10, tooFew: false });
    expect(s.models.find((m) => m.id === 'sonnet')).toMatchObject({ wins: 3, draws: 2, losses: 5, score: 0.4 });
    expect(s.headToHead[0]).toMatchObject({ a: 'opus', b: 'sonnet', n: 10, aWins: 5, draws: 2, bWins: 3, aScore: 0.6, p: 0.377 });
    expect(binomialP(6, 10)).toBeCloseTo(386 / 1024, 12);
    // Wilson 95% for 6/10: 0.3127 to 0.8318.
    expect(opus?.interval).toEqual([0.3127, 0.8318]);
    expect(wilson(6, 10)).toEqual([0.3127, 0.8318]);
    expect(s.models.find((m) => m.id === 'opus')?.bySeat).toEqual([0.7, 0.5]);
  });

  it('groups by map and matchup and counts how games ended in the room\'s words', () => {
    const r = rig();
    writeRun(r, 'r1', [...games(10, 5), ...games(10, 5).map((g) => ({ ...g, map: 'wadi_halam', matchup: 'kdf', by: 'cap', seed: Number(g.seed) + 100 }))]);
    const s = (go(r).results as ArenaResults).sections[0];
    expect(s.byMap.map((c) => c.value)).toEqual(['tel_marum', 'tel_marum', 'wadi_halam', 'wadi_halam']);
    expect(s.byMatchup.map((c) => c.value)).toContain('kdf');
    expect(s.endings).toEqual([{ by: 'annihilation', words: 'annihilation', count: 10 }, { by: 'cap', words: 'surviving force', count: 10 }]);
  });

  it('voids are counted apart and never score', () => {
    const r = rig();
    writeRun(r, 'r1', [...games(10, 10), rec({ seed: 77, outcome: 'void', by: 'timeout' })]);
    const s = (go(r).results as ArenaResults).sections[0];
    expect(s.models.find((m) => m.id === 'opus')).toMatchObject({ games: 11, voids: 1, wins: 10, score: 1 });
    expect(s.voids).toBe(1);
  });
});

describe('G6 small n', () => {
  it('9 non-void games show counts and no score, interval or seat split', () => {
    const r = rig();
    writeRun(r, 'r1', games(MIN_SCORED - 1, 9));
    const s = (go(r).results as ArenaResults).sections[0];
    const m = s.models.find((x) => x.id === 'opus');
    expect(m).toMatchObject({ wins: 9, tooFew: true, score: null, interval: null, bySeat: [null, null], byFaction: { kdf: null, sarim: null } });
    expect(s.headToHead[0]).toMatchObject({ verdict: 'too_few', aScore: null, p: null });
    expect(s.byMap.every((c) => c.score === null)).toBe(true);
  });

  it('19 games at p < 0.05 are not "ahead"; 20 swapped are; 20 with the sides never swapped are not', () => {
    const run = (n: number, wins: number, _tag: string, recs?: Over[]) => {
      const r = rig();
      writeRun(r, 'r1', recs ?? games(n, wins));
      return (go(r).results as ArenaResults).sections[0].headToHead[0];
    };
    expect(binomialP(15, 19)).toBeLessThan(0.05);
    expect(run(MIN_AHEAD - 1, 15, 'a')).toMatchObject({ n: 19, verdict: 'not_distinguishable' });
    expect(run(MIN_AHEAD, 16, 'b')).toMatchObject({ n: 20, sidesSwapped: true, verdict: 'a_ahead' });
    expect(run(MIN_AHEAD, 4, 'c')).toMatchObject({ verdict: 'b_ahead' });
    const oneSided = games(20, 16).map((g) => ({ ...g, players: ['opus', 'sonnet'], outcome: Number(g.seed) - 1000 < 16 ? 'seat0' : 'seat1' }));
    expect(run(20, 16, 'd', oneSided)).toMatchObject({ n: 20, sidesSwapped: false, verdict: 'not_distinguishable' });
    expect(run(MIN_AHEAD, 10, 'e')).toMatchObject({ verdict: 'not_distinguishable' });
  });

  it('lists models alphabetically by label and writes no rank or "best"', () => {
    const r = rig();
    writeRun(r, 'r1', games(12, 12));
    const res = go(r);
    expect(res.results?.sections[0].models.map((m) => m.label)).toEqual(['Claude Opus 5.5 (Anthropic)', 'Claude Sonnet 5.5 (Anthropic)']);
    const html = readFileSync(join(r.dir, 'preview.html'), 'utf8').toLowerCase();
    for (const w of ['official', 'certified', 'best', 'rank']) expect(html, w).not.toContain(w);
    expect(html).toContain('no vendor reviewed, sponsored or endorsed these results');
  });
});

describe('G7 comparability', () => {
  it('different pace, round time, cap, mode or prompt digest never share a section; a different build does not either', () => {
    const r = rig();
    const g = games(10, 5);
    writeRun(r, 'r1', [
      ...g, ...g.map((x) => ({ ...x, pace: 30 })), ...g.map((x) => ({ ...x, roundWallMs: 1 + 120000 })), ...g.map((x) => ({ ...x, capTicks: 600 })),
      ...g.map((x) => ({ ...x, mode: 'points' })), ...g.map((x) => ({ ...x, promptDigest: 'b'.repeat(64) })), ...g.map((x) => ({ ...x, build: '1.2.4+abcdef1' })),
    ]);
    const res = go(r).results as ArenaResults;
    expect(res.sections.length).toBe(7);
    for (const s of res.sections) { expect(s.games).toBe(10); expect(s.mixedBuilds).toBe(false); }
  });

  it('--merge-builds folds the builds of one key into a section labelled mixed, and still not across a pace', () => {
    const r = rig();
    const g = games(10, 5);
    writeRun(r, 'r1', [...g, ...g.map((x) => ({ ...x, build: '1.2.4+abcdef1' })), ...g.map((x) => ({ ...x, pace: 30 }))]);
    const res = go(r, { mergeBuilds: true }).results as ArenaResults;
    expect(res.sections.map((s) => [s.games, s.mixedBuilds, s.builds.length])).toEqual(expect.arrayContaining([[20, true, 2], [10, false, 1]]));
  });

  it('a record without the five fields (or with a malformed one) is refused, naming the run and line, never guessed', () => {
    for (const drop of ['build', 'pace', 'roundWallMs', 'capTicks', 'promptDigest']) {
      const r = rig();
      const bad = rec();
      delete bad[drop];
      writeRun(r, 'r1', [rec(), bad]);
      const res = go(r);
      expect(res.code, drop).toBe(1);
      expect(res.message).toContain('line 2');
    }
    const r = rig();
    writeRun(r, 'r1', [rec({ build: 'sk-ant-abc' })]);
    expect(go(r).code).toBe(1);
  });
});

describe('G8 the judge', () => {
  it('only scored verdicts reach a mean, with judged k of n, the judge\'s label and a self-judged flag', () => {
    const r = rig();
    const g = games(12, 6);
    // 10 scored (opus 8 / sonnet 4), 1 invalid carrying scores that must not count, 1 with no judge.
    const recs = g.map((x, i) => (i < 10 ? { ...x, judge: scoredJudge(i % 2 === 0 ? 8 : 4, i % 2 === 0 ? 4 : 8) } : i === 10 ? { ...x, judge: { ...scoredJudge(10, 10), status: 'invalid', problems: ['p'] } } : x));
    writeRun(r, 'r1', recs);
    const s = (go(r, { judge: 'opus' }).results as ArenaResults).sections[0];
    const opus = s.rubric.find((x) => x.model === 'opus');
    const sonnet = s.rubric.find((x) => x.model === 'sonnet');
    expect(opus).toMatchObject({ judgedK: 10, ofN: 12, judge: 'Claude Opus 5.5 (Anthropic)', selfJudged: true });
    expect(sonnet).toMatchObject({ judgedK: 10, ofN: 12, selfJudged: false });
    // the means are of the ten scored games alone: opus always got 8 and sonnet 4; the invalid verdict's 10s are not counted
    expect(opus?.overall).toBe(8);
    expect(sonnet?.overall).toBe(4);
    expect(opus?.criteria.adaptation).toBe(8);
  });

  it('fewer than 10 scored games show counts only; no judge named means selfJudged is unknown', () => {
    const r = rig();
    writeRun(r, 'r1', games(12, 6).map((x, i) => (i < 9 ? { ...x, judge: scoredJudge(8, 4) } : x)));
    const s = (go(r).results as ArenaResults).sections[0];
    expect(s.rubric[0]).toMatchObject({ judgedK: 9, overall: null, judge: null, selfJudged: null });
  });

  it('an out-of-range or missing score makes the verdict unscored', () => {
    const j = scoredJudge(8, 4) as { scores: { seat0: { overall: { score: number } } } };
    j.scores.seat0.overall.score = 11;
    expect((keep(rec({ judge: j }), 'r1') as { kept: { rubric: unknown } }).kept.rubric).toBeNull();
  });
});

describe('G13 never auto-published', () => {
  const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
  it('pnpm arena\'s sources never name the publisher or data/arena', () => {
    for (const f of ['arena.ts', 'arena-serve.ts', 'arena-control.ts', 'arena-record.ts', 'arena-frames.ts', 'arena-results.ts']) {
      expect(read(f), f).not.toMatch(/arena-publish|arena-results-render|data\/arena|arena:publish/);
    }
  });

  it('the publisher runs no process, opens no socket and names no network', () => {
    const src = [read('arena-publish.ts'), read('arena-results-render.ts')].join('\n');
    for (const bad of ['child_process', 'spawn(', 'exec(', 'execSync', 'fetch(', "from 'node:http", "from 'node:https", "from 'node:net'", 'WebSocket', 'XMLHttpRequest', 'git ']) {
      expect(src, bad).not.toContain(bad);
    }
  });

  it('a real arena run leaves data/arena/ as it was', async () => {
    const real = join(__dirname, '../../../data/arena/results.json');
    const before = existsSync(real) ? statSync(real).mtimeMs : null;
    const out = tmp();
    const { inProcess, passive, rush } = await import('./players');
    const r = await runArena(['--a', 'passive', '--b', 'rush', '--seeds', '1', '--map', 'tel_marum', '--pace', '40', '--round-wall-ms', '2500', '--tick-ms', '1', '--cap-ticks', '200', '--out', out], {
      log: () => {}, print: () => {}, resolvePlayer: (spec: string) => inProcess(spec, spec === 'passive' ? passive : rush),
    } as never);
    expect(r.code).toBe(0);
    expect(existsSync(real) ? statSync(real).mtimeMs : null).toBe(before);
  }, 240000);
});

describe('G14 untampered', () => {
  it('the digest is the sha256 of the canonical body, recomputed here from the file', () => {
    const r = rig();
    writeRun(r, 'r1', games(12, 6));
    go(r);
    const doc = JSON.parse(outText(r)) as ArenaResults;
    expect(doc.digest).toBe(digestOf(doc));
    expect(arenaResultsFailures(doc)).toEqual([]);
    expect(arenaResultsFailures({ ...doc, withheld: doc.withheld + 1 })[0]).toContain('edited by hand');
    const edited = JSON.parse(JSON.stringify(doc)) as ArenaResults;
    edited.sections[0].models[0].wins += 1;
    expect(arenaResultsFailures(edited).length).toBe(1);
  });

  it('is byte-stable: the same runs give the same file and digest', () => {
    const r = rig();
    writeRun(r, 'r1', games(12, 6));
    go(r);
    const a = outText(r);
    go(r);
    expect(outText(r)).toBe(a);
  });

  it('the committed data/arena/results.json, when there is one, passes', () => {
    const file = join(__dirname, '../../../data/arena/results.json');
    if (!existsSync(file)) return;
    expect(arenaResultsFailures(JSON.parse(readFileSync(file, 'utf8')))).toEqual([]);
  });
});

describe('the command line and the preview', () => {
  it('parses its options and refuses an unknown one, a path as a run id and no runs', () => {
    expect(parsePublishArgs(['--', '--runs', 'a,b,a', '--merge-builds', '--judge', 'opus'])).toMatchObject({ runs: ['a', 'b'], mergeBuilds: true, judge: 'opus' });
    for (const bad of [[], ['--runs', '../x'], ['--runs', 'a/b'], ['--runs', 'x.frames'], ['--runs', 'a', '--out', 'x'], ['--runs']]) expect('error' in parsePublishArgs(bad), bad.join(' ')).toBe(true);
  });

  it('reads only the named runs: another file in the directory is never opened', () => {
    const r = rig();
    writeRun(r, 'r1', games(10, 5));
    writeFileSync(join(r.dir, 'other.jsonl'), 'this is not json\n');
    expect(go(r).code).toBe(0);
    expect(go(r, { runs: ['missing'] }).code).toBe(1);
  });

  it('escapes a label: a script tag cannot reach the preview unescaped', () => {
    const r = rig();
    writeRun(r, 'r1', games(10, 5));
    const doc = go(r).results as ArenaResults;
    doc.sections[0].models[0].label = '<script>alert(1)</script>';
    const html = renderPreview(doc);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('runPublish with no deps never names the real home file when a private file is passed', () => {
    const r = rig();
    writeRun(r, 'r1', games(10, 5));
    const out = runPublish(['--runs', 'r1', '--results-dir', r.dir, '--private-file', r.priv], { root: r.root, print: () => {}, today: '2026-11-04' });
    expect(out.code).toBe(0);
  });
});
