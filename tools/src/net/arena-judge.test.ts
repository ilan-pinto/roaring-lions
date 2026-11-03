// GH-973: `pnpm arena --judge`. Real games on the local relay (rush against
// passive, in process); the judge is a stub function or a tiny node script,
// never a model. The point of the file: the referee's stats are in every
// record, the judge's scores reach the table and the .md, and NOTHING the judge
// says changes a result (D7).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, resolvePlayer, runArena } from './arena';
import type { GameRecord } from './arena-score';
import { markdownReport, scoreSections } from './arena-score';
import type { JudgeJob, JudgeRecord } from './judge';
import type { ScoreSet } from './match-score';
import { playerScore } from './score-fixture';
import { inProcess, rush, type ArenaPlayer } from './players';

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true }); });
function outDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'arena-judge-'));
  dirs.push(d);
  return d;
}
const quiet = { log: () => {}, print: () => {} };
/** One seed, two games, short: 1,200 ticks, decided at the cap. */
const ARGV = ['--a', 'rush', '--b', 'passive', '--seeds', '1', '--first-seed', '7', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '1200'];

const scores = (a: number, b: number): ScoreSet => ({ seat0: playerScore(a, 'seat 0'), seat1: playerScore(b, 'seat 1') });
const readRecords = (out: string): GameRecord[] => {
  const f = readdirSync(out).find((n) => n.endsWith('.jsonl')) ?? '';
  return readFileSync(join(out, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as GameRecord);
};
const readMd = (out: string): string => readFileSync(join(out, readdirSync(out).find((n) => n.endsWith('.md')) ?? ''), 'utf8');

describe('the referee\'s stats are in every record', () => {
  it('without --judge: both seats\' numbers, an idle share, orders and a timeline, consistent with the scoreboard; the report says "Not judged"', async () => {
    const out = outDir();
    const r = await runArena([...ARGV, '--out', out], quiet);
    expect(r.code).toBe(0);
    const records = readRecords(out);
    expect(records).toHaveLength(2);
    for (const g of records) {
      expect(g.judge).toBeUndefined();
      const ref = g.referee;
      expect(ref).toBeDefined();
      if (ref === undefined) continue;
      expect(ref.tick).toBe(g.ticks);
      expect(ref.map).toBe('tel_marum');
      expect(ref.timeline).toHaveLength(Math.floor(g.ticks / 600));
      expect(ref.result).toMatch(/^(seat [01] \((rush|passive)\) won|draw) \(/);
      for (const seat of [0, 1] as const) {
        const s = ref.seats[seat];
        // The referee's deaths are the scoreboard's losses (a dead wounded man is a loss there).
        expect(s.unitsLost + s.woundedDied, `seat ${seat}`).toBe(g.score[seat].lost);
        expect(s.destroyed).toBe(g.score[seat === 0 ? 1 : 0].lost - ref.seats[seat === 0 ? 1 : 0].woundedDied);
        if (s.woundedOnField === 0) expect(s.remainingValue).toBe(g.score[seat].remaining);
      }
      // Rush sends orders; passive never does, and its units sit idle more.
      const rushSeat = g.players[0] === 'rush' ? 0 : 1;
      const passiveSeat = rushSeat === 0 ? 1 : 0;
      expect(ref.seats[rushSeat].ordersSent).toBeGreaterThan(0);
      expect(ref.seats[rushSeat].firstOrderTick).not.toBeNull();
      expect(ref.seats[passiveSeat].ordersSent).toBe(0);
      expect(ref.seats[passiveSeat].firstOrderTick).toBeNull();
      expect(ref.seats[passiveSeat].idlePct ?? 0).toBeGreaterThan(ref.seats[rushSeat].idlePct ?? 100);
    }
    const md = readMd(out);
    expect(md).toContain('## Scores');
    expect(md).toContain('Not judged.');
    expect(md).toContain("### Referee's stats");
  }, 120_000);
});

describe('--judge', () => {
  it('scores each finished game: the table, the reasons and the referee\'s numbers reach the .md and the record; the judge is told the stats and the outcome', async () => {
    const out = outDir();
    const jobs: JudgeJob[] = [];
    const printed: string[] = [];
    const r = await runArena([...ARGV, '--judge', 'cmd:judge-cli < {prompt}', '--out', out], {
      log: () => {}, print: (l) => { printed.push(l); },
      runJudge: (job): Promise<JudgeRecord> => { jobs.push(job); return Promise.resolve({ status: 'scored', scores: scores(8, 2), tokens: 321 }); },
    });
    expect(r.code).toBe(0);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].template).toBe('cmd:judge-cli < {prompt}');
    expect(jobs[0].timeoutMs).toBe(180_000);
    expect(jobs[0].players).toEqual(['rush', 'passive']);
    expect(jobs[1].players).toEqual(['passive', 'rush']);
    expect(jobs[0].stats).toEqual(r.games[0].referee);
    expect(jobs[0].outcome).toMatch(/won \(cap\)|draw \(cap\)/);
    expect(jobs[0].logFile).toMatch(/-game1-judge\.log$/);
    expect(printed).toContain('arena: judge: 2 scored, 0 invalid, 0 failed, 0 skipped');
    const records = readRecords(out);
    expect(records.map((g) => g.judge?.status)).toEqual(['scored', 'scored']);
    const md = readMd(out);
    expect(md).toContain('| game | seed | seat | player | Fewer deaths | Wounded treatment and evacuation | Force preservation | Tempo and initiative | Adaptation | Overall |');
    expect(md).toContain('| 1 | 56433 | 0 | rush | 8 | 8 | 8 | 8 | 8 | 8 |');
    expect(md).toContain('| 2 | 56433 | 1 | rush | 2 | 2 | 2 | 2 | 2 | 2 |');
    expect(md).toContain('### Mean scores by player');
    expect(md).toContain('| rush | 2 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |');
    expect(md).toContain('- Fewer deaths: 8. fewer_deaths: 3 lost against 5 (seat 0)');
    expect(md).toContain('### Game 1: seed 56433, rush (seat 0) vs passive (seat 1)');
    expect(md).not.toContain('Not judged');
  }, 120_000);

  it('NEVER changes a result (D7): the same games with a judge that favours the loser are record for record the same', async () => {
    // Seed 6 (48514) at cap 2400: rush wins game 1 from seat 0 and game 2 from seat 1, so a judge that pushes an outcome
    // in EITHER direction (toward seat 0, toward seat 1) changes a record here. (Was seed 7: the Spike's faster
    // reload, GH-982, made seat 0 win both games there; then seed 3, until tel_marum's friendly seat moved to (26,45), GH-990.)
    const argv = ARGV.map((v, i) => (ARGV[i - 1] === '--first-seed' ? '6' : ARGV[i - 1] === '--cap-ticks' ? '2400' : v));
    const plain = outDir();
    const judged = outDir();
    const a = await runArena([...argv, '--out', plain], quiet);
    expect(readRecords(plain).map((g) => g.outcome)).toEqual(['seat0', 'seat1']);
    // A judge that gives the LOSER 10 and the winner 1, whoever that is.
    const contrarian = (job: JudgeJob): Promise<JudgeRecord> => {
      const seat0Won = job.outcome.startsWith('seat 0');
      return Promise.resolve({ status: 'scored', scores: seat0Won ? scores(1, 10) : scores(10, 1), tokens: null });
    };
    const b = await runArena([...argv, '--judge', 'cmd:judge-cli < {prompt}', '--out', judged], { ...quiet, runJudge: contrarian });
    expect(b.code).toBe(a.code);
    const strip = (g: GameRecord): Omit<GameRecord, 'judge'> => { const { judge, ...rest } = g; void judge; return rest; };
    expect(readRecords(judged).map(strip)).toEqual(readRecords(plain).map(strip));
    expect(readRecords(judged).every((g) => g.judge?.status === 'scored')).toBe(true);
    expect([...(b.tally ?? new Map()).values()]).toEqual([...(a.tally ?? new Map()).values()]);
    expect(b.gate).toEqual(a.gate);
  }, 300_000);

  it('tells the judge neutral labels, never a cmd: template (local paths, model ids); the results files keep the real names', async () => {
    const out = outDir();
    const jobs: JudgeJob[] = [];
    const secret = 'cmd:/Users/someone/bin/claude-wrapper --model claude-secret-9 {mcp} < {prompt}';
    const make = (spec: string, log: (line: string) => void): ArenaPlayer => (spec === secret ? inProcess(spec, rush, { log }) : resolvePlayer(spec, log));
    await runArena(['--a', secret, '--b', 'passive', '--seeds', '1', '--first-seed', '7', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '400', '--judge', 'cmd:judge-cli < {prompt}', '--out', out], {
      ...quiet, resolvePlayer: make,
      runJudge: (job): Promise<JudgeRecord> => { jobs.push(job); return Promise.resolve({ status: 'scored', scores: scores(5, 5), tokens: null }); },
    });
    expect(jobs.map((j) => j.players)).toEqual([['Player A', 'passive'], ['passive', 'Player A']]);
    for (const j of jobs) {
      expect(j.outcome).not.toContain('cmd:');
      expect(j.outcome).not.toContain('claude-secret');
    }
    // The real name is in the results (it is the tally's key), not in what the judge is told.
    expect(readMd(out)).toContain('claude-secret-9');
  }, 120_000);

  it('a judge that fails or answers badly is recorded as such; the games, the tally and the exit code stand', async () => {
    const out = outDir();
    let n = 0;
    const flaky = (): Promise<JudgeRecord> => {
      n++;
      return Promise.resolve(n === 1
        ? { status: 'failed', reason: 'the judge did not finish in 180 s', tokens: null }
        : { status: 'invalid', problems: ['seat0.criteria.adaptation.score is 11, outside 1-10'], tokens: 10 });
    };
    const r = await runArena([...ARGV, '--judge', 'cmd:judge-cli < {prompt}', '--out', out], { ...quiet, runJudge: flaky });
    expect(r.code).toBe(0);
    expect(r.games.map((g) => g.judge?.status)).toEqual(['failed', 'invalid']);
    const md = readMd(out);
    expect(md).toContain('Not scored: the judge failed: the judge did not finish in 180 s.');
    expect(md).toContain("Not scored: the judge's reply was not a valid score (1 problem(s)).");
    expect(md).toContain('- seat0.criteria.adaptation.score is 11, outside 1-10');
    expect(md).not.toContain('### Mean scores by player');
  }, 120_000);

  it('does not ask the judge about a void game', async () => {
    const corrupting = (spec: string, log: (line: string) => void): ArenaPlayer => {
      const inner = resolvePlayer(spec, log);
      if (spec !== 'rush') return inner;
      return {
        name: inner.name,
        start: async (s) => {
          const r = await inner.start(s);
          const t = r.client?.transport;
          if (t !== undefined) {
            const report = t.reportTick.bind(t);
            let corrupted = false;
            t.reportTick = (tick, digest) => {
              if (digest !== null && !corrupted) { corrupted = true; report(tick, digest ^ 1); return; }
              report(tick, digest);
            };
          }
          return r;
        },
      };
    };
    const quietError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = outDir();
      let asked = 0;
      const r = await runArena([...ARGV, '--cap-ticks', '400', '--judge', 'cmd:judge-cli < {prompt}', '--out', out], {
        ...quiet, resolvePlayer: corrupting, runJudge: () => { asked++; return Promise.resolve({ status: 'scored', scores: scores(5, 5), tokens: null }); },
      });
      expect(r.code).toBe(0);
      expect(asked).toBe(0);
      expect(r.games.map((g) => g.outcome)).toEqual(['void', 'void']);
      expect(r.games.map((g) => g.judge)).toEqual([{ status: 'skipped', reason: 'the game was void (desync)' }, { status: 'skipped', reason: 'the game was void (desync)' }]);
      expect(readMd(out)).toContain('Not scored: skipped: the game was void (desync).');
    } finally {
      quietError.mockRestore();
    }
  }, 60_000);

  it('end to end with a real judge process (a node script): the prompt arrives on stdin and its reply is scored', async () => {
    const out = outDir();
    const stub = join(out, 'stub-judge.cjs');
    writeFileSync(stub, [
      "let s = ''; process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (d) => { s += d; });",
      "process.stdin.on('end', () => {",
      "  const m = /```json\\n(\\{\\n  \"version\"[\\s\\S]*?\\n\\})\\n```/.exec(s);",
      "  const st = JSON.parse(m[1]);",
      "  const ids = ['fewer_deaths','wounded_care','force_preservation','tempo_initiative','adaptation'];",
      "  const p = (seat) => ({ criteria: Object.fromEntries(ids.map((k) => [k, { score: 5 + Math.min(4, st.seats[seat].ordersSent), reason: k + ' with ' + st.seats[seat].ordersSent + ' orders and ' + st.seats[seat].deaths + ' deaths' }])), overall: { score: 5, reason: 'stub judge, no model' } });",
      "  process.stdout.write(JSON.stringify({ seat0: p(0), seat1: p(1) }) + '\\n');",
      "});",
    ].join('\n'));
    const r = await runArena([...ARGV, '--judge', `cmd:${process.execPath} ${stub} < {prompt}`, '--out', out], quiet);
    expect(r.code).toBe(0);
    expect(r.games.map((g) => g.judge?.status)).toEqual(['scored', 'scored']);
    const g1 = r.games[0].judge;
    if (g1?.status === 'scored') {
      const refSeat0 = r.games[0].referee?.seats[0];
      expect(g1.scores.seat0.criteria.fewer_deaths.reason).toBe(`fewer_deaths with ${refSeat0?.ordersSent} orders and ${refSeat0?.deaths} deaths`);
    }
    // The judge's log is beside the players' logs.
    expect(readdirSync(out).filter((f) => f.endsWith('-judge.log'))).toHaveLength(2);
    expect(readMd(out)).toContain('stub judge, no model');
  }, 120_000);
});

describe('the command line', () => {
  it('--judge is a cmd: template with {prompt} and {stats} only; --judge-timeout-ms is a bounded whole number', () => {
    expect(parseArgs(['--a', 'rush', '--b', 'passive'])).toMatchObject({ judge: null, judgeTimeoutMs: 180_000 });
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--judge', 'cmd:j < {prompt}', '--judge-timeout-ms', '5000'])).toMatchObject({ judge: 'cmd:j < {prompt}', judgeTimeoutMs: 5000 });
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--judge', 'cmd:j --s {stats}'])).toMatchObject({ judge: 'cmd:j --s {stats}' });
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--judge', 'claude -p'])).toHaveProperty('error');
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--judge', 'cmd:j {mcp}'])).toHaveProperty('error');
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--judge', 'cmd:j {seat}'])).toHaveProperty('error');
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--judge', 'cmd:j "open'])).toHaveProperty('error');
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--judge-timeout-ms', '10'])).toHaveProperty('error');
  });
  it('a bad --judge is refused before any room (exit 1)', async () => {
    let relays = 0;
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--judge', 'cmd:j {mcp}', '--out', outDir()], { ...quiet, startRelay: () => { relays++; throw new Error('no'); } });
    expect(r.code).toBe(1);
    expect(relays).toBe(0);
  });
});

describe('the report', () => {
  it('a game with no judge says "Not judged" even when the other games were judged', () => {
    const g = (judge?: JudgeRecord): GameRecord => ({
      seed: 1, map: 'm', matchup: 'mirror', players: ['a', 'b'], factions: ['kdf', 'kdf'], outcome: 'seat0', by: 'cap', ticks: 100,
      score: [{ lost: 0, lostValue: 0, destroyed: 0, destroyedValue: 0, remaining: 1 }, { lost: 0, lostValue: 0, destroyed: 0, destroyedValue: 0, remaining: 1 }],
      reports: [{ tokens: null, timeouts: 0, errors: [] }, { tokens: null, timeouts: 0, errors: [] }],
      ...(judge === undefined ? {} : { judge }),
    });
    const text = scoreSections([g({ status: 'scored', scores: scores(6, 4), tokens: null }), g()]).join('\n');
    expect(text).toContain('| 1 | 1 | 0 | a | 6 | 6 | 6 | 6 | 6 | 6 |');
    expect(text).toContain('| 2 | 1 | — | — | not judged |');
    expect(markdownReport([g()])).toContain('Not judged.');
  });
});
