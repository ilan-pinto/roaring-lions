/**
 * `pnpm arena:publish -- --runs <id,...>` (GH-954 public-arena P2, decisions D-P1..D-P10).
 *
 * Reads ONLY the named run files under the results directory (`<id>.jsonl`), and writes two files in the working tree:
 * `data/arena/results.json` (what the Worker page will render, P3) and `arena-results/preview.html` (what the lead reads
 * before he opens the PR and merges it himself, D-P2). It never runs git, never opens a socket and is never called by
 * `pnpm arena` (G13): a source-level spec holds all three.
 *
 * The output is CONSTRUCTED from allow-listed fields, never copied and then redacted: every value in it is a number, a
 * member of a fixed enum, a pattern-checked id, a label from the committed allow-list (`data/arena/public-players.json`)
 * or a digest this file computed. Of a stored record it reads `seed`, `map`, `matchup`, `mode`, `players`, `factions`,
 * `outcome`, `by`, `ticks`, the five run fields and, from a `scored` judge, the integer scores. It never reads
 * `reports` (errors, usage, cost), a judge's reasons, a frames file, a log or a report.
 *
 * A game with a seat that is not on the allow-list (a `cmd:` player is `Player A`, an unknown preset is its id) is
 * withheld WHOLE and counted. A game of one model against itself (`#a` / `#b`) is withheld the same way: its two seats
 * would share one tally row.
 *
 * Sections are keyed by (pace, roundWallMs, capTicks, mode, promptDigest) and by build: results at different terms are
 * never added together. `--merge-builds` folds the builds of one key into a section labelled as mixed.
 *
 * The pinned model id (D-P4, G4): for every model on the page the private presets file's template is read to compare its
 * `--model` with the allow-list's `modelId`, and a mismatch refuses the run. The template is read here only to compare
 * and is never emitted. The caller passes the file; only `main` names the default, so a spec never reads the real one.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { WIN_MODES } from '@lions/net';
import { arenaResultsFailures, canonicalJson, denyHits, digestOf } from '../../validate_arena_results.mjs';
import { runFieldsOf, type RunFields } from './arena-record';
import { defaultPresetsFile, loadPresets, PresetsError, type Presets } from './arena-presets';
import { decidedBy, GATE_ALPHA, headToHead, tally, type GameRecord, type HeadToHead } from './arena-score';
import { CRITERION_IDS } from './match-score';
import { renderPreview } from './arena-results-render';

// ---------------------------------------------------------------------------------------------------------------
// The thresholds (D-P5)
// ---------------------------------------------------------------------------------------------------------------

/** Under this many non-void games a row shows counts only. */
export const MIN_SCORED = 10;
/** "A ahead of B" needs at least this many non-void games between them, with the sides swapped... */
export const MIN_AHEAD = 20;
/** ...and each seat order must hold at least a quarter of them. */
export const SWAP_SHARE = 0.25;
/** The 95% interval's z. */
const Z95 = 1.96;

export const NOTE = "These are results of this game's prompt, tools and build, not a general benchmark.";
export const DISCLAIMER = 'Model and vendor names only identify the software tested. No vendor reviewed, sponsored or endorsed these results. The game is developed with AI coding tools, and the judge is a model.';

/** The room's and the arena's `by` words the page may carry; anything else is `other`. */
const BY_WORDS = ['annihilation', 'stalemate', 'time', 'cap', 'forfeit', 'surrender', 'left', 'mutual', 'objective', 'desync', 'disagree', 'timeout', 'expired', 'unfinished'] as const;
type By = (typeof BY_WORDS)[number] | 'other';
const MODES = ['annihilation', ...WIN_MODES] as const;
type Mode = (typeof MODES)[number];
const MATCHUPS = ['mirror', 'kdf', 'sarim'] as const;
const FACTIONS = ['kdf', 'sarim'] as const;
const OUTCOMES = ['seat0', 'seat1', 'draw', 'void'] as const;

// ---------------------------------------------------------------------------------------------------------------
// The allow-list
// ---------------------------------------------------------------------------------------------------------------

export interface PublicPlayer { id: string; label: string; scripted: boolean; modelId: string | null; vendor: string | null }
export type PublicPlayers = ReadonlyMap<string, PublicPlayer>;

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const LABEL_PART = /^[A-Za-z0-9][A-Za-z0-9 .+_-]{0,47}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** The committed allow-list (`arena-public-players.schema.json` is the full contract; this reads what it needs, strictly). */
export function parsePublicPlayers(text: string): PublicPlayers {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new PublishError('the allow-list is not JSON'); }
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.players) || !isRecord(raw.scripted)) throw new PublishError('the allow-list must be {version: 1, players, scripted}');
  const out = new Map<string, PublicPlayer>();
  for (const id of ['passive', 'rush']) {
    const s = raw.scripted[id];
    if (!isRecord(s) || typeof s.label !== 'string' || !/^Scripted: [a-z]{3,16}$/.test(s.label)) throw new PublishError(`the allow-list's scripted "${id}" needs a label "Scripted: ..."`);
    out.set(id, { id, label: s.label, scripted: true, modelId: null, vendor: null });
  }
  for (const [id, p] of Object.entries(raw.players)) {
    if (!ID.test(id) || ['passive', 'rush', 'draw', 'void'].includes(id)) throw new PublishError(`the allow-list names "${id}", which is not a usable id`);
    if (!isRecord(p) || typeof p.label !== 'string' || typeof p.vendor !== 'string' || typeof p.modelId !== 'string') throw new PublishError(`the allow-list entry "${id}" needs a label, a vendor and a modelId`);
    if (!LABEL_PART.test(p.label) || !LABEL_PART.test(p.vendor) || !MODEL_ID.test(p.modelId)) throw new PublishError(`the allow-list entry "${id}" has a label, vendor or modelId outside the allowed characters`);
    out.set(id, { id, label: `${p.label} (${p.vendor})`, scripted: false, modelId: p.modelId, vendor: p.vendor });
  }
  return out;
}

/** The `--model` a command template pins: exactly one, else null (none, or two that could disagree). Pure over a string. */
export function modelPinOf(template: string): string | null {
  const found = [...template.matchAll(/(?:^|\s)--model(?:=|\s+)(\S+)/g)].map((m) => m[1]);
  return found.length === 1 ? found[0] : null;
}

/**
 * G4: every model the page names carries, in the PRIVATE template that played it (and the judge's, in its judge
 * template), the `--model` the allow-list publishes. Returns the failures as words that never contain a template.
 */
export function pinFailures(used: readonly PublicPlayer[], presets: Presets | null, judge: PublicPlayer | null): string[] {
  const out: string[] = [];
  const check = (p: PublicPlayer, field: 'template' | 'judgeTemplate'): void => {
    if (p.scripted || p.modelId === null) return;
    const preset = presets?.byId.get(p.id);
    const template = preset?.[field] ?? null;
    if (template === null) { out.push(`"${p.id}": no ${field === 'template' ? 'player' : 'judge'} template in the presets file to check its model against`); return; }
    const pin = modelPinOf(template);
    if (pin === null) out.push(`"${p.id}": its ${field === 'template' ? 'player' : 'judge'} template pins no single --model`);
    else if (pin !== p.modelId) out.push(`"${p.id}": its ${field === 'template' ? 'player' : 'judge'} template pins a model other than the allow-list's modelId`);
  };
  for (const p of used) check(p, 'template');
  if (judge !== null) check(judge, 'judgeTemplate');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a record: only the allow-listed fields, validated
// ---------------------------------------------------------------------------------------------------------------

/** What this file keeps of a stored record. Built field by field: nothing is spread. */
export interface Kept {
  run: string;
  seed: number;
  map: string;
  matchup: GameRecord['matchup'];
  mode: Mode;
  /** Allow-list ids by seat (a `#a`/`#b` suffix already refused). */
  players: [string, string];
  factions: [GameRecord['factions'][0], GameRecord['factions'][1]];
  outcome: GameRecord['outcome'];
  by: By;
  ticks: number;
  fields: RunFields;
  /** Integer 1-10 scores by seat, only when the judge's status was `scored` and the scores are well-formed. */
  rubric: [Rubric, Rubric] | null;
}
interface Rubric { overall: number; criteria: Record<string, number> }

const MAP_ID = /^[a-z0-9_]{1,48}$/;
const SCORE_OK = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10;

function rubricOf(judge: unknown): [Rubric, Rubric] | null {
  if (!isRecord(judge) || judge.status !== 'scored' || !isRecord(judge.scores)) return null;
  const seats: Rubric[] = [];
  for (const key of ['seat0', 'seat1']) {
    const s = judge.scores[key];
    if (!isRecord(s) || !isRecord(s.criteria) || !isRecord(s.overall) || !SCORE_OK(s.overall.score)) return null;
    const criteria: Record<string, number> = {};
    for (const id of CRITERION_IDS) {
      const c = s.criteria[id];
      if (!isRecord(c) || !SCORE_OK(c.score)) return null;
      criteria[id] = c.score;
    }
    seats.push({ overall: s.overall.score, criteria });
  }
  return [seats[0], seats[1]];
}

/** A run's public name: the first 8 hex of the sha256 of its file name. The name is free text and stays on this machine (the preview maps it back). */
export const runHash = (run: string): string => createHash('sha256').update(run).digest('hex').slice(0, 8);

/** One stored line, or why it cannot be kept. A record without the five run fields is REFUSED (an older record), never guessed. */
export function keep(line: unknown, run: string): { ok: true; kept: Kept } | { ok: false; why: string } {
  if (!isRecord(line)) return { ok: false, why: 'not an object' };
  const fields = runFieldsOf(line);
  if (fields === null) return { ok: false, why: 'lacks the run fields (build, pace, roundWallMs, capTicks, promptDigest): an older record: remove or exclude this run from --runs and publish again' };
  const { seed, map, matchup, players, factions, outcome, by, ticks } = line;
  const mode = line.mode === undefined ? 'annihilation' : line.mode;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0) return { ok: false, why: 'bad seed' };
  if (typeof map !== 'string' || !MAP_ID.test(map)) return { ok: false, why: 'bad map' };
  if (!(MATCHUPS as readonly unknown[]).includes(matchup)) return { ok: false, why: 'bad matchup' };
  if (!(MODES as readonly unknown[]).includes(mode)) return { ok: false, why: 'bad mode' };
  if (!Array.isArray(players) || players.length !== 2 || players.some((p) => typeof p !== 'string' || p.length > 64)) return { ok: false, why: 'bad players' };
  if (!Array.isArray(factions) || factions.length !== 2 || factions.some((f) => !(FACTIONS as readonly unknown[]).includes(f))) return { ok: false, why: 'bad factions' };
  if (!(OUTCOMES as readonly unknown[]).includes(outcome)) return { ok: false, why: 'bad outcome' };
  if (typeof by !== 'string') return { ok: false, why: 'bad by' };
  if (typeof ticks !== 'number' || !Number.isInteger(ticks) || ticks < 0) return { ok: false, why: 'bad ticks' };
  return {
    ok: true,
    kept: {
      run, seed, map, matchup: matchup as Kept['matchup'], mode: mode as Mode,
      players: [players[0] as string, players[1] as string], factions: [factions[0] as Kept['factions'][0], factions[1] as Kept['factions'][1]],
      outcome: outcome as Kept['outcome'],
      by: (BY_WORDS as readonly string[]).includes(by) ? by as By : 'other',
      ticks, fields, rubric: rubricOf(line.judge),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------------------------

export interface ModelRow {
  id: string; label: string; scripted: boolean; modelId: string | null;
  games: number; wins: number; draws: number; losses: number; voids: number; tooFew: boolean;
  score: number | null; interval: [number, number] | null; bySeat: [number | null, number | null]; byFaction: { kdf: number | null; sarim: number | null };
}
export interface PairRow {
  a: string; b: string; n: number; aWins: number; draws: number; bWins: number; aScore: number | null; p: number | null;
  sidesSwapped: boolean; verdict: 'a_ahead' | 'b_ahead' | 'not_distinguishable' | 'too_few';
}
export interface CutRow { value: string; model: string; n: number; score: number | null }
export interface RubricRow { model: string; judge: string | null; selfJudged: boolean | null; judgedK: number; ofN: number; overall: number | null; criteria: Record<string, number | null> }
export interface GameRow { run: string; seed: number; map: string; matchup: string; mode: Mode; seat0: string; seat1: string; winner: string; by: By; ticks: number; build: string }
export interface Section {
  key: { pace: number; roundWallMs: number; capTicks: number; mode: Mode; promptDigest: string };
  builds: string[]; mixedBuilds: boolean; games: number; voids: number;
  models: ModelRow[]; headToHead: PairRow[]; byMap: CutRow[]; byMatchup: CutRow[];
  endings: { by: By; words: string; count: number }[]; rubric: RubricRow[]; gameList: GameRow[];
}
export interface ArenaResults {
  version: 1; generated: string; note: string; disclaimer: string; withheld: number; sections: Section[]; digest: string;
}

/** The comparability key (G7): every field here must match for two games to share a section. */
export function sectionKey(f: RunFields, mode: Mode, mergeBuilds: boolean): string {
  return canonicalJson({ pace: f.pace, roundWallMs: f.roundWallMs, capTicks: f.capTicks, mode, promptDigest: f.promptDigest, ...(mergeBuilds ? {} : { build: f.build }) });
}

const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const orNull = (v: number): number | null => (Number.isNaN(v) ? null : r4(v));

/** The 95% Wilson interval for a score of `points` over `n` games (a draw is half a point, D7). */
export function wilson(points: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const p = points / n;
  const z2 = Z95 * Z95;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [r4(Math.max(0, centre - half)), r4(Math.min(1, centre + half))];
}

/** tally()/headToHead() read GameRecord; the page needs only these fields of it. */
function asRecords(games: readonly Kept[]): GameRecord[] {
  return games.map((g) => ({ seed: g.seed, map: g.map, matchup: g.matchup, mode: g.mode, players: g.players, factions: g.factions, outcome: g.outcome, by: g.by, ticks: g.ticks, ...g.fields } as unknown as GameRecord));
}

function modelRows(games: readonly Kept[], who: PublicPlayers): ModelRow[] {
  const t = tally(asRecords(games));
  return [...t.values()].map((x): ModelRow => {
    const p = who.get(x.player) as PublicPlayer;
    const n = x.wins + x.draws + x.losses;
    const tooFew = n < MIN_SCORED;
    const shown = (v: number): number | null => (tooFew ? null : orNull(v));
    return {
      id: p.id, label: p.label, scripted: p.scripted, modelId: p.modelId,
      games: x.games, wins: x.wins, draws: x.draws, losses: x.losses, voids: x.voids, tooFew,
      score: shown(x.score), interval: tooFew ? null : wilson(x.wins + x.draws / 2, n),
      bySeat: [shown(x.bySeat[0]), shown(x.bySeat[1])], byFaction: { kdf: shown(x.byFaction.kdf), sarim: shown(x.byFaction.sarim) },
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

function pairRows(games: readonly Kept[], ids: readonly string[]): PairRow[] {
  const recs = asRecords(games);
  const out: PairRow[] = [];
  const sorted = [...ids].sort();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [a, b] = [sorted[i], sorted[j]];
      const ab: HeadToHead = headToHead(recs, a, b);
      if (ab.n === 0) continue;
      const ba: HeadToHead = headToHead(recs, b, a);
      // Sides swapped: each seat order holds a fair share of the non-void games.
      const asA = games.filter((g) => g.outcome !== 'void' && g.players[0] === a && g.players[1] === b).length;
      const asB = ab.n - asA;
      const swapped = Math.min(asA, asB) >= Math.ceil(ab.n * SWAP_SHARE);
      const enough = ab.n >= MIN_AHEAD && swapped;
      const verdict: PairRow['verdict'] = ab.n < MIN_SCORED ? 'too_few'
        : enough && ab.p < GATE_ALPHA ? 'a_ahead'
          : enough && ba.p < GATE_ALPHA ? 'b_ahead'
            : 'not_distinguishable';
      out.push({
        a, b, n: ab.n, aWins: ab.wins, draws: ab.draws, bWins: ab.losses,
        aScore: ab.n < MIN_SCORED ? null : orNull(ab.score), p: ab.n < MIN_SCORED ? null : r4(ab.p),
        sidesSwapped: swapped, verdict,
      });
    }
  }
  return out;
}

function cutRows(games: readonly Kept[], value: (g: Kept) => string, ids: readonly string[]): CutRow[] {
  const out: CutRow[] = [];
  const values = [...new Set(games.map(value))].sort();
  for (const v of values) {
    const sub = games.filter((g) => value(g) === v);
    const t = tally(asRecords(sub));
    for (const id of [...ids].sort()) {
      const x = t.get(id);
      if (x === undefined) continue;
      const n = x.wins + x.draws + x.losses;
      out.push({ value: v, model: id, n, score: n < MIN_SCORED ? null : orNull(x.score) });
    }
  }
  return out;
}

function rubricRows(games: readonly Kept[], ids: readonly string[], who: PublicPlayers, judge: PublicPlayer | null): RubricRow[] {
  const out: RubricRow[] = [];
  for (const id of [...ids].sort()) {
    let ofN = 0;
    let k = 0;
    let overall = 0;
    const sums: Record<string, number> = Object.fromEntries(CRITERION_IDS.map((c) => [c, 0]));
    for (const g of games) {
      if (g.outcome === 'void') continue;
      for (const seat of [0, 1] as const) {
        if (g.players[seat] !== id) continue;
        ofN++;
        // Only a `scored` verdict reaches a mean: an invalid, failed or skipped one left `rubric` null.
        const r = g.rubric?.[seat];
        if (r === undefined) continue;
        k++;
        overall += r.overall;
        for (const c of CRITERION_IDS) sums[c] += r.criteria[c];
      }
    }
    if (k === 0) continue;
    const shown = k >= MIN_SCORED;
    const me = who.get(id) as PublicPlayer;
    out.push({
      model: id, judge: judge?.label ?? null,
      selfJudged: judge === null ? null : judge.modelId !== null && judge.modelId === me.modelId,
      judgedK: k, ofN, overall: shown ? r2(overall / k) : null,
      criteria: Object.fromEntries(CRITERION_IDS.map((c) => [c, shown ? r2(sums[c] / k) : null])),
    });
  }
  return out;
}

function section(games: readonly Kept[], who: PublicPlayers, judge: PublicPlayer | null): Section {
  const first = games[0];
  const ids = [...new Set(games.flatMap((g) => g.players))];
  const builds = [...new Set(games.map((g) => g.fields.build))].sort();
  const endings = new Map<By, number>();
  for (const g of games) endings.set(g.by, (endings.get(g.by) ?? 0) + 1);
  return {
    key: { pace: first.fields.pace, roundWallMs: first.fields.roundWallMs, capTicks: first.fields.capTicks, mode: first.mode, promptDigest: first.fields.promptDigest },
    builds, mixedBuilds: builds.length > 1,
    games: games.length, voids: games.filter((g) => g.outcome === 'void').length,
    models: modelRows(games, who),
    headToHead: pairRows(games, ids),
    byMap: cutRows(games, (g) => g.map, ids),
    byMatchup: cutRows(games, (g) => g.matchup, ids),
    endings: [...endings.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([by, count]) => ({ by, words: decidedBy({ by, mode: first.mode }), count })),
    rubric: rubricRows(games, ids, who, judge),
    gameList: [...games].sort((a, b) => a.run.localeCompare(b.run) || a.seed - b.seed || a.players[0].localeCompare(b.players[0])).map((g): GameRow => ({
      run: runHash(g.run), seed: g.seed, map: g.map, matchup: g.matchup, mode: g.mode, seat0: g.players[0], seat1: g.players[1],
      winner: g.outcome === 'draw' ? 'draw' : g.outcome === 'void' ? 'void' : g.players[g.outcome === 'seat0' ? 0 : 1], by: g.by, ticks: g.ticks, build: g.fields.build,
    })),
  };
}

/** `decidedBy` may name words with characters outside the page's pattern; keep it to lowercase words and spaces. */
const safeWords = (s: string): string => (/^[a-z ]{1,24}$/.test(s) ? s : 'other');

export interface BuildOptions { mergeBuilds: boolean; judge: PublicPlayer | null; generated: string }

/** The document from kept games (every seat already known to `who`). Pure. */
export function buildResults(kept: readonly Kept[], withheld: number, who: PublicPlayers, o: BuildOptions): ArenaResults {
  const groups = new Map<string, Kept[]>();
  for (const g of kept) {
    const k = sectionKey(g.fields, g.mode, o.mergeBuilds);
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const sections = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, games]) => {
    const s = section(games, who, o.judge);
    return { ...s, endings: s.endings.map((e) => ({ ...e, words: safeWords(e.words) })) };
  });
  const body = { version: 1 as const, generated: o.generated, note: NOTE, disclaimer: DISCLAIMER, withheld, sections };
  return { ...body, digest: digestOf(body) };
}

// ---------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------

export interface PublishArgs { runs: string[]; mergeBuilds: boolean; judge: string | null; resultsDir: string | null; privateFile: string | null }

const RUN_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;
const USAGE = 'usage: pnpm arena:publish -- --runs <id,...> [--merge-builds] [--judge <preset id>] [--results-dir <dir>] [--private-file <path>]\n  <id> is a results file name without .jsonl; writes data/arena/results.json and arena-results/preview.html in the working tree, and nothing else\n  one judge per publish: every named run is read as judged by the --judge given (none: not named). The --model pin check compares against the preset in the presets file as it stands today, not the template that played the games.\n  a run with an old-format line (no build, pace, round time, cap or prompt digest) aborts the publish: remove or exclude that run';

export function parsePublishArgs(argv: readonly string[]): PublishArgs | { error: string } {
  const got = new Map<string, string>();
  let merge = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (!a.startsWith('--')) return { error: `unexpected argument "${a}"\n${USAGE}` };
    const name = a.slice(2);
    if (name === 'merge-builds') { merge = true; continue; }
    if (!['runs', 'judge', 'results-dir', 'private-file'].includes(name)) return { error: `unknown option --${name}\n${USAGE}` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `--${name} needs a value\n${USAGE}` };
    got.set(name, v);
    i++;
  }
  const runs = [...new Set((got.get('runs') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''))];
  if (runs.length === 0) return { error: `--runs names at least one run\n${USAGE}` };
  for (const r of runs) if (!RUN_ID.test(r) || r.endsWith('.frames')) return { error: `"${r}" is not a run id (a results file name without .jsonl)\n${USAGE}` };
  return { runs, mergeBuilds: merge, judge: got.get('judge') ?? null, resultsDir: got.get('results-dir') ?? null, privateFile: got.get('private-file') ?? null };
}

export interface PublishDeps {
  /** The repository root (data/arena/ is under it). */
  root: string;
  /** Where the named runs are read from, and the preview written. */
  resultsDir: string;
  /** The private presets file, or null: none (a model on the page then fails the pin check). The default path is `main`'s, never this function's. */
  privateFile: string | null;
  /** YYYY-MM-DD. */
  today: string;
  print?: (s: string) => void;
}

export interface PublishOutcome { code: number; results?: ArenaResults; message?: string }

/** Reads, builds, checks, then writes both files; nothing is written unless everything passed. */
export function publish(args: PublishArgs, deps: PublishDeps): PublishOutcome {
  const print = deps.print ?? ((s: string): void => { process.stdout.write(`${s}\n`); });
  try {
    const allowFile = join(deps.root, 'data/arena/public-players.json');
    const who = parsePublicPlayers(readFileSync(allowFile, 'utf8'));
    let judge: PublicPlayer | null = null;
    if (args.judge !== null) {
      judge = who.get(args.judge) ?? null;
      if (judge === null || judge.scripted) throw new PublishError(`--judge "${args.judge}" is not a model on the allow-list`);
    }
    const kept: Kept[] = [];
    let withheld = 0;
    for (const run of args.runs) {
      const file = join(deps.resultsDir, `${run}.jsonl`);
      if (!existsSync(file)) throw new PublishError(`run "${run}": no ${run}.jsonl in the results directory`);
      const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
      if (lines.length === 0) throw new PublishError(`run "${run}" has no games`);
      lines.forEach((text, i) => {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { throw new PublishError(`run "${run}" line ${i + 1}: not JSON`); }
        const k = keep(parsed, run);
        if (!k.ok) throw new PublishError(`run "${run}" line ${i + 1}: ${k.why}`);
        // Every seat on the allow-list, and not the same entry twice (a `#a`/`#b` self-play shares a tally row).
        const [s0, s1] = k.kept.players;
        if (!who.has(s0) || !who.has(s1) || s0 === s1) { withheld++; return; }
        kept.push(k.kept);
      });
    }
    const used = [...new Set(kept.flatMap((g) => g.players))].map((id) => who.get(id) as PublicPlayer);
    let presets: Presets | null = null;
    if (deps.privateFile !== null && (used.some((p) => !p.scripted) || (judge !== null))) {
      try { presets = loadPresets(deps.privateFile); } catch (e) { if (e instanceof PresetsError) throw new PublishError('the private presets file cannot be used to check the model pins'); throw e; }
    }
    const pins = pinFailures(used, presets, judge);
    if (pins.length > 0) throw new PublishError(`the model pin check failed:\n  ${pins.join('\n  ')}`);
    const results = buildResults(kept, withheld, who, { mergeBuilds: args.mergeBuilds, judge, generated: deps.today });
    const text = `${JSON.stringify(sortKeys(results), null, 2)}\n`;
    // The belt (G3): the text as it will be committed, and the preview, must not hold a denied string.
    const html = renderPreview(results);
    for (const [what, body] of [['results', text], ['preview', html]] as const) {
      const hits = denyHits(body);
      if (hits.length > 0) throw new PublishError(`the ${what} contains ${hits.join(', ')}: nothing was written`);
    }
    const fails = arenaResultsFailures(JSON.parse(text) as ArenaResults);
    if (fails.length > 0) throw new PublishError(fails.join('\n'));
    mkdirSync(join(deps.root, 'data/arena'), { recursive: true });
    mkdirSync(deps.resultsDir, { recursive: true });
    writeFileSync(join(deps.root, 'data/arena/results.json'), text);
    // The run names stay local: the committed file carries their hashes, the preview alone maps them back (added after the scan).
    writeFileSync(join(deps.resultsDir, 'preview.html'), renderPreview(results, new Map(args.runs.map((r) => [runHash(r), r]))));
    print(`arena:publish: ${results.sections.reduce((n, s) => n + s.games, 0)} game(s) in ${results.sections.length} section(s), ${withheld} withheld -> data/arena/results.json and ${join(deps.resultsDir, 'preview.html')}`);
    print('arena:publish: read the preview, then open the PR; the lead merges it (D-P2). Nothing was committed or sent.');
    return { code: 0, results };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    print(`arena:publish: ${message}`);
    return { code: e instanceof PublishError ? 1 : 2, message };
  }
}

/** An object with its keys in sorted order at every depth, so the committed file is byte-stable. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isRecord(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

export function runPublish(argv: readonly string[], deps?: Partial<PublishDeps>): PublishOutcome {
  const args = parsePublishArgs(argv);
  if ('error' in args) { (deps?.print ?? ((s: string) => { process.stderr.write(`${s}\n`); }))(args.error); return { code: 2, message: args.error }; }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = deps?.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const resultsDir = deps?.resultsDir ?? resolve(cwd, args.resultsDir ?? 'arena-results');
  const privateFile = deps !== undefined && 'privateFile' in deps ? (deps.privateFile ?? null) : (args.privateFile !== null ? resolve(cwd, args.privateFile) : defaultPresetsFile());
  return publish(args, { root, resultsDir, privateFile, today: deps?.today ?? new Date().toISOString().slice(0, 10), ...(deps?.print === undefined ? {} : { print: deps.print }) });
}

function isEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(entry)).href; } catch { return false; }
}
if (isEntry()) process.exit(runPublish(process.argv.slice(2)).code);
