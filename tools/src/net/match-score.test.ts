// GH-973: match scoring. The rubric, the strict validator, the referee's stats
// (read from a real sim), the judge prompt and the score file. No model runs
// here: every scorer is a literal.
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WOUND_GONE, WOUND_STABILISED } from '../../../packages/sim/src/tuning';
import { matchTick, buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { scoreOf } from '../../../packages/app/src/net/scoreboard';
import {
  CRITERIA, CRITERION_IDS, MAX_REASON_CHARS, RefereeTally, SCORE_MAX, SCORE_MIN, checkReferee, clientReply, leaveStatsIfAbsent, extractJson, judgePrompt, parseScoreReply,
  readScoreFile, refereeMarkdown, replyFormat, resultText, rubricText, scan, scoresMarkdown, validateScores, writeScoreFile, type RefereeStats,
} from './match-score';
import { delPath, loose, setPath, validScores } from './score-fixture';
import { versusConfig } from './test-config';

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'match-score-')); dirs.push(d); return d; };

const good = validScores;
/** A deep copy the spec can break one field of. */
const copy = () => loose(good());
const problemsOf = (v: unknown): string[] => {
  const r = validateScores(v);
  if (r.ok) throw new Error('expected the scores to be refused');
  return r.problems;
};

describe('the rubric', () => {
  it('is the lead\'s five criteria, in order, scored 1-10 with a one-line reason', () => {
    expect(CRITERION_IDS).toEqual(['fewer_deaths', 'wounded_care', 'force_preservation', 'tempo_initiative', 'adaptation']);
    expect(CRITERIA.map((c) => c.label)).toEqual(['Fewer deaths', 'Wounded treatment and evacuation', 'Force preservation', 'Tempo and initiative', 'Adaptation']);
    expect([SCORE_MIN, SCORE_MAX]).toEqual([1, 10]);
    const text = rubricText();
    for (const c of CRITERIA) expect(text).toContain(`\`${c.id}\``);
    expect(text).toContain('ONE line');
  });
});

describe('the strict validator', () => {
  it('accepts a complete score and returns it trimmed', () => {
    const v = setPath(copy(), 'seat0.criteria.fewer_deaths.reason', '  padded  ');
    const r = validateScores(v);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scores.seat0.criteria.fewer_deaths.reason).toBe('padded');
  });
  it('accepts the scores under one `scores` key, and nothing else beside it', () => {
    expect(validateScores({ scores: good() }).ok).toBe(true);
    expect(problemsOf({ scores: good(), extra: 1 })).toContain('with a "scores" key the reply has nothing else');
  });
  it('refuses a score above 10 or below 1 (the bound check)', () => {
    const hi = setPath(copy(), 'seat0.criteria.adaptation.score', 11);
    expect(problemsOf(hi)).toContain('seat0.criteria.adaptation.score is 11, outside 1-10');
    const lo = setPath(copy(), 'seat1.overall.score', 0);
    expect(problemsOf(lo)).toContain('seat1.overall.score is 0, outside 1-10');
    const edge = setPath(setPath(copy(), 'seat0.overall.score', 10), 'seat1.overall.score', 1);
    expect(validateScores(edge).ok).toBe(true);
  });
  it('refuses a fractional, string, NaN or missing score', () => {
    for (const bad of [6.5, '6', Number.NaN, null, undefined, true]) {
      const v = setPath(copy(), 'seat0.criteria.fewer_deaths.score', bad);
      expect(problemsOf(v).join('|'), String(bad)).toContain('seat0.criteria.fewer_deaths.score must be a whole number 1-10');
    }
  });
  it('refuses a missing criterion, a missing overall and a missing seat', () => {
    const c = delPath(copy(), 'seat1.criteria.tempo_initiative');
    expect(problemsOf(c)).toContain('seat1.criteria.tempo_initiative is missing');
    const o = delPath(copy(), 'seat0.overall');
    expect(problemsOf(o)).toContain('seat0.overall is missing');
    const s = delPath(copy(), 'seat1');
    expect(problemsOf(s)).toContain('seat1 is missing');
  });
  it('refuses an unknown criterion, an unknown key and a third seat', () => {
    const c = setPath(copy(), 'seat0.criteria.bravery', { score: 5, reason: 'x' });
    expect(problemsOf(c)).toContain('seat0.criteria has unknown key(s): bravery');
    const k = setPath(copy(), 'seat0.criteria.adaptation.confidence', 0.9);
    expect(problemsOf(k)).toContain('seat0.criteria.adaptation has unknown key(s): confidence');
    const t = setPath(copy(), 'seat2', loose(good().seat0));
    expect(problemsOf(t)).toContain('unknown key(s): seat2 (only seat0 and seat1)');
  });
  it('refuses a reason that is not one line: empty, blank, with a line break of any kind, or too long', () => {
    const cases: [string, string][] = [
      ['', 'is empty'], ['   ', 'is empty'],
      ['first\nsecond', 'must be one line'], ['first\r\nsecond', 'must be one line'], ['a b', 'must be one line'], ['a\u0085b', 'must be one line'],
      ['x'.repeat(MAX_REASON_CHARS + 1), `at most ${MAX_REASON_CHARS}`],
    ];
    for (const [reason, why] of cases) {
      const v = setPath(copy(), 'seat1.criteria.wounded_care.reason', reason);
      expect(problemsOf(v).join('|'), JSON.stringify(reason)).toContain(why);
    }
    const ok = setPath(copy(), 'seat1.criteria.wounded_care.reason', 'x'.repeat(MAX_REASON_CHARS));
    expect(validateScores(ok).ok).toBe(true);
    const notString = setPath(copy(), 'seat0.overall.reason', 7);
    expect(problemsOf(notString)).toContain('seat0.overall.reason must be a string');
  });
  it('refuses anything that is not an object, and lists every problem it finds', () => {
    for (const v of [null, 3, 'scores', [], undefined]) expect(validateScores(v).ok, String(v)).toBe(false);
    const v = delPath(setPath(setPath(copy(), 'seat0.criteria.adaptation.score', 12), 'seat1.overall.reason', 'two\nlines'), 'seat0.criteria.fewer_deaths');
    expect(problemsOf(v)).toHaveLength(3);
  });
});

describe('reading a scorer\'s reply', () => {
  const json = JSON.stringify(good());
  it('takes a bare object or exactly one fenced block, nothing hunted from prose', () => {
    expect(parseScoreReply(json).ok).toBe(true);
    expect(parseScoreReply(`\n${json}\n`).ok).toBe(true);
    expect(parseScoreReply(`\`\`\`json\n${json}\n\`\`\``).ok).toBe(true);
    expect(parseScoreReply(`\`\`\`\n${json}\n\`\`\``).ok).toBe(true);
    // Prose that quotes an object is not a score.
    expect(parseScoreReply(`Here is my verdict: ${json}`).ok).toBe(false);
    expect(parseScoreReply(`\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``)).toEqual({ ok: false, problems: ['the reply has more than one fenced block'] });
    expect(parseScoreReply('')).toEqual({ ok: false, problems: ['the reply is empty'] });
    expect(parseScoreReply('{"seat0":').ok).toBe(false);
  });
  it('a reply with an out-of-range score is invalid, not repaired', () => {
    const v = setPath(copy(), 'seat0.overall.score', 11);
    const r = parseScoreReply(JSON.stringify(v));
    expect(r.ok).toBe(false);
  });
  it('clientReply unwraps a client\'s json result, and passes plain output through', () => {
    const line = JSON.stringify({ type: 'result', is_error: false, result: json, usage: { input_tokens: 1, output_tokens: 2 } });
    expect(clientReply(`progress\n${line}\n`)).toEqual({ text: json, isError: false });
    expect(clientReply(JSON.stringify({ type: 'result', is_error: true, result: 'boom' }))).toEqual({ text: 'boom', isError: true });
    // An object that is the SCORES (no `result`) is the plain reply itself.
    expect(clientReply(`${json}\n`)).toEqual({ text: `${json}\n`, isError: false });
    expect(extractJson('{}').ok).toBe(true);
  });
});

/** A tel_marum room's world, KDF against KDF. */
function world() {
  const w = buildMatchWorld(versusConfig('tel_marum'));
  const side = (s: 0 | 1): number[] => {
    const out: number[] = [];
    for (let i = 0; i < w.sim.entityCount; i++) if (w.sim.state.side[i] === s && w.sim.state.alive[i] === 1) out.push(i);
    return out;
  };
  return { w, sim: w.sim, side };
}

describe('the referee\'s stats, read from a real sim', () => {
  it('start of the match: everyone alive and idle, nothing lost, no wounded', () => {
    const { sim, side } = world();
    const [a, b] = scan(sim);
    expect(a.alive).toBe(side(0).length);
    expect(b.alive).toBe(side(1).length);
    expect(a.unitsLost + a.woundedFell + b.unitsLost + b.woundedFell).toBe(0);
    expect(a.idle).toBe(a.alive);
    expect(a.value).toBeGreaterThan(0);
  });

  it('counts units lost with their value, and the other side\'s loss as destroyed', () => {
    const { w, sim, side } = world();
    const victims = side(1).slice(0, 2);
    const priced = victims.map((i) => sim.unitTypes[sim.state.typeIdx[i]].id);
    for (const v of victims) sim.debugKill(v);
    const t = new RefereeTally();
    const s = t.stats(sim, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: null });
    expect(s.seats[1].unitsLost).toBe(2);
    expect(s.seats[1].lostValue).toBeGreaterThan(0);
    expect(s.seats[0].destroyed).toBe(2);
    expect(s.seats[0].destroyedValue).toBe(s.seats[1].lostValue);
    expect(s.seats[1].deaths).toBe(2);
    expect(s.seats[0].deaths).toBe(0);
    expect(s.seats[1].remainingUnits).toBe(side(1).length);
    expect(priced.length).toBe(2);
    void w;
  });

  it('a unit taken off the board without a fight (removeFromPlay) is neither alive nor lost', () => {
    const { sim, side } = world();
    const before = scan(sim)[0];
    sim.removeFromPlay(side(0)[0]);
    const after = scan(sim)[0];
    expect(after.alive).toBe(before.alive - 1);
    expect(after.unitsLost).toBe(0);
    expect(after.lostValue).toBe(0);
  });

  it('counts a wounded man apart: down, stabilised, rescued (removed alive) or died, never as a unit', () => {
    const { w, sim, side } = world();
    const wt = w.typeOf.get('wounded_kdf');
    expect(wt).toBeDefined();
    const at = (i: number) => [sim.state.posX[i], sim.state.posY[i]] as const;
    const home = side(0)[0];
    const mk = (): number => sim.spawn(wt as number, 0, ...at(home));
    const down = mk();
    const stabilised = mk();
    const rescued = mk();
    const dead = mk();
    sim.state.woundState[stabilised] = WOUND_STABILISED;
    sim.state.alive[rescued] = 0; sim.state.removed[rescued] = 1; sim.state.woundState[rescued] = WOUND_GONE;
    sim.debugKill(dead);
    const before = scan(sim)[0];
    expect(before.woundedFell).toBe(4);
    expect(before.woundedOnField).toBe(2);
    expect(before.woundedStabilised).toBe(1);
    expect(before.woundedRescued).toBe(1);
    expect(before.woundedDied).toBe(1);
    // The wounded are not units: not alive, not lost.
    expect(before.alive).toBe(side(0).length - 2);
    expect(before.unitsLost).toBe(0);
    // The scoreboard counts the dead wounded as lost; the referee's deaths agree with it.
    const board = scoreOf(sim);
    const t = new RefereeTally().stats(sim, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: null });
    expect(t.seats[0].deaths).toBe(board[0].lost);
    expect(t.seats[0].woundedRescued).toBe(1);
    void down;
  });

  it('idle time is the idle finder\'s own rule: a unit with a target or an order is not idle', () => {
    const { sim, side } = world();
    const mine = side(0);
    const before = scan(sim)[0].idle;
    sim.state.curTarget[mine[0]] = 5;
    sim.state.moving[mine[1]] = 1;
    expect(scan(sim)[0].idle).toBe(before - 2);
    expect(scan(sim)[1].idle).toBe(side(1).length);
  });

  it('the tally samples a game second at a time: idle share, orders, first order, first loss and a 30 s timeline', () => {
    const { w, sim, side } = world();
    const t = new RefereeTally();
    const sides: [0 | 1, 0 | 1] = [0, 1];
    t.onFrame(3, [{ seat: 1, cmd: { kind: 'move' } }, { seat: 1, cmd: { kind: 'attackMove' } }, { seat: 0, cmd: { kind: 'move' } }]);
    t.onFrame(4, [{ seat: 1, cmd: { kind: 'move' } }]);
    for (let n = 0; n < 650; n++) {
      if (n === 100) sim.debugKill(side(0)[0]);
      matchTick(w);
      t.onTick(sim, sides);
    }
    const s = t.stats(sim, { map: 'tel_marum', sides, factions: ['kdf', 'kdf'], result: resultText({ kind: 'draw', by: 'time', forces: [1, 1] }, sides) });
    expect(s.tick).toBe(650);
    expect(s.clock).toBe('00:32');
    expect(s.result).toBe('draw (time)');
    expect(s.seats[1].ordersSent).toBe(3);
    expect(s.seats[1].ordersByKind).toEqual({ move: 2, attackMove: 1 });
    expect(s.seats[0].ordersSent).toBe(1);
    expect(s.seats[1].firstOrderTick).toBe(3);
    // The kill was at tick ~101; the next sample (tick 120) sees it.
    expect(s.seats[0].firstLossTick).toBe(120);
    expect(s.seats[1].firstLossTick).toBeNull();
    // 32 samples (ticks 20..640) of every unit idle: nobody was ordered to do anything in the sim.
    expect(s.seats[1].unitSeconds).toBe(32 * side(1).length);
    expect(s.seats[1].idlePct).toBeGreaterThan(90);
    // One timeline point, at tick 600, with the 4 orders sent so far split by seat.
    expect(s.timeline).toHaveLength(1);
    expect(s.timeline[0].tick).toBe(600);
    expect(s.timeline[0].orders).toEqual([1, 3]);
    expect(s.timeline[0].units[0]).toBe(side(0).length);
    expect(s.observedFromTick).toBe(3);
  });

  it('men killed inside a squad come from the event stream, by the side of the squad, and count as deaths', () => {
    const { sim, side } = world();
    const t = new RefereeTally();
    const mine = side(0)[0];
    const theirs = side(1)[0];
    t.onEvents(sim, [
      { kind: 'manKilled', tick: 5, entity: mine, by: theirs },
      { kind: 'manKilled', tick: 5, entity: mine, by: theirs },
      { kind: 'manKilled', tick: 6, entity: theirs, by: mine },
      { kind: 'removed', tick: 6, entity: theirs, side: 1 },
    ]);
    const s = t.stats(sim, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: null });
    expect(s.seats.map((x) => x.menKilled)).toEqual([2, 1]);
    expect(s.seats.map((x) => x.deaths)).toEqual([2, 1]);
    // Seat 1 on side 0 reads the same event the other way round.
    const swapped = t.stats(sim, { map: 'tel_marum', sides: [1, 0], factions: ['kdf', 'kdf'], result: null });
    expect(swapped.seats.map((x) => x.menKilled)).toEqual([1, 2]);
  });

  it('resultText names the winning SEAT, not the side', () => {
    expect(resultText({ kind: 'won', side: 1, by: 'annihilation' }, [0, 1])).toBe('seat 1 won (annihilation)');
    expect(resultText({ kind: 'won', side: 1, by: 'surrender' }, [1, 0])).toBe('seat 0 won (surrender)');
    expect(resultText(null, [0, 1])).toBeNull();
  });
});

function sampleStats(): RefereeStats {
  const { sim } = world();
  return new RefereeTally().stats(sim, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: 'seat 1 (rush) won (annihilation)' });
}

describe('the judge\'s prompt', () => {
  it('holds the rubric, the glossary, the stats for BOTH seats, the outcome and the exact reply format', () => {
    const stats = sampleStats();
    const p = judgePrompt(stats, ['rush', 'passive'], 'seat 0 (rush) won (cap)');
    for (const c of CRITERIA) expect(p).toContain(`\`${c.id}\``);
    expect(p).toContain('- seat 0: rush');
    expect(p).toContain('- seat 1: passive');
    expect(p).toContain('Outcome: seat 0 (rush) won (cap)');
    expect(p).toContain(JSON.stringify(stats, null, 2));
    expect(p).toContain(replyFormat());
    expect(p).toContain('`woundedRescued`');
    // The reply format in the prompt is itself something the validator accepts once its placeholders are scored.
    const example = JSON.parse(replyFormat()) as unknown;
    expect(validateScores(example).ok).toBe(true);
  });
});

describe('the score file the harness leaves for `pnpm bot`', () => {
  it('round-trips a valid score and the referee\'s stats, atomically and 0600', () => {
    const d = tmp();
    const f = join(d, 's.json');
    const referee = sampleStats();
    writeScoreFile(f, { version: 1, seat: 1, referee, scores: good(), submittedTick: 812 });
    expect(statSync(f).mode & 0o777).toBe(0o600);
    const r = readScoreFile(f);
    expect(r.status).toBe('scored');
    if (r.status === 'scored') { expect(r.scores).toEqual(good()); expect(r.submittedTick).toBe(812); expect(r.referee).toEqual(referee); }
  });
  it('stats left at the result never replace a file that is there: a respawned harness must not wipe accepted scores', () => {
    const f = join(tmp(), 's.json');
    expect(leaveStatsIfAbsent(f, 1, sampleStats())).toBe(true);
    expect(readScoreFile(f).status).toBe('missing');   // stats, no scores yet
    writeScoreFile(f, { version: 1, seat: 1, referee: sampleStats(), scores: good(), submittedTick: 812 });
    // The replay of the end (a second harness) leaves the accepted scores alone.
    expect(leaveStatsIfAbsent(f, 1, sampleStats())).toBe(false);
    const r = readScoreFile(f);
    expect(r.status).toBe('scored');
    if (r.status === 'scored') expect(r.scores).toEqual(good());
  });
  it('a file with stats and no scores is MISSING, with the stats kept', () => {
    const f = join(tmp(), 's.json');
    writeScoreFile(f, { version: 1, seat: 1, referee: sampleStats(), scores: null, submittedTick: null });
    const r = readScoreFile(f);
    expect(r.status).toBe('missing');
    expect(r.referee).not.toBeNull();
  });
  it('no file is missing; a file that does not validate is invalid, whatever wrote it', () => {
    const d = tmp();
    expect(readScoreFile(join(d, 'none.json')).status).toBe('missing');
    const bad = setPath(copy(), 'seat0.criteria.adaptation.score', 11);
    const f = join(d, 'bad.json');
    writeFileSync(f, JSON.stringify({ version: 1, seat: 1, referee: sampleStats(), scores: bad, submittedTick: 1 }));
    const r = readScoreFile(f);
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.problems).toContain('seat0.criteria.adaptation.score is 11, outside 1-10');
    writeFileSync(f, 'not json');
    expect(readScoreFile(f)).toEqual({ status: 'invalid', problems: ['the score file is not valid JSON'], referee: null });
    writeFileSync(f, '[]');
    expect(readScoreFile(f).status).toBe('invalid');
    writeFileSync(f, ' '.repeat(300 * 1024));
    expect(readScoreFile(f).status).toBe('invalid');
    const unreadable = join(d, 'locked.json');
    writeFileSync(unreadable, '{}');
    chmodSync(unreadable, 0o000);
    // uid 0 reads through mode 000, so the file is not unreadable there; the
    // assertion is only meaningful for an unprivileged user.
    if (process.getuid?.() !== 0) expect(readScoreFile(unreadable).status).toBe('invalid');
    chmodSync(unreadable, 0o600);
  });
  it('referee stats from a file are shape-checked before anything prints them', () => {
    type Obj = ReturnType<typeof loose>;
    const fresh = (): Obj => loose(sampleStats());
    const seats = (v: Obj): Obj[] => v.seats as Obj[];
    expect(checkReferee(fresh())).not.toBeNull();
    const mutations: ((v: Obj) => void)[] = [
      (v) => { seats(v)[0].deaths = 'many'; },
      (v) => { seats(v).pop(); },
      (v) => { seats(v)[1].seat = 0; },
      (v) => { v.timeline = [{ tick: 1 }]; },
      (v) => { v.version = 2; },
      (v) => { seats(v)[0].ordersByKind = { move: 'x' }; },
    ];
    for (const mutate of mutations) {
      const v = fresh();
      mutate(v);
      expect(checkReferee(v)).toBeNull();
    }
    expect(checkReferee(null)).toBeNull();
  });
});

describe('the markdown', () => {
  it('names both players, one row each, and puts every reason on its own line', () => {
    const md = scoresMarkdown(good(), ['Sonnet Bot (you)', 'opponent']).join('\n');
    expect(md).toContain('| seat | player | Fewer deaths | Wounded treatment and evacuation | Force preservation | Tempo and initiative | Adaptation | Overall |');
    expect(md).toContain('| 0 | Sonnet Bot (you) | 7 | 7 | 7 | 7 | 7 | 7 |');
    expect(md).toContain('| 1 | opponent | 4 | 4 | 4 | 4 | 4 | 4 |');
    expect(md).toContain('- Fewer deaths: 7. fewer_deaths: 3 lost against 5 (seat 0)');
    expect(md).toContain('- Overall: 4. overall: decided by the 5 to 3 trade (seat 1)');
    expect(refereeMarkdown(sampleStats(), ['a', 'b']).join('\n')).toContain('| 0 | a | 0 | 0 | 0 (0) |');
  });
  it('a pipe in a name cannot break a table', () => {
    expect(scoresMarkdown(good(), ['a|b', 'c']).join('\n')).toContain('a\\|b');
  });
});
