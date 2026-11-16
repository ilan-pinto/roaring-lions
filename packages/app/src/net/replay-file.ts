/**
 * The arena's frames file (GH-954 W3, decision D-W9): what one game's referee ran, kept so the game can be run
 * again. `<game>.frames.jsonl`, one JSON value a line:
 *
 *     {"kind":"header","v":1|2,"build":"0.129.30+<sha>","game":{...},"labels":["rush","passive"],"config":{...}}
 *     {"t":0,"c":[{"seat":0,"seq":0,"cmd":{...}}]}      one line for each tick that carried a command, ascending
 *     {"kind":"end","ticks":1200,"referee":{"tick":1200,"hash":123},"watcher":{...}|null,"outcome":"seat0","by":"annihilation"[,"checks":{"every":20,"hashes":[...]}]}
 *
 * A tick with no command has no line: the `end` line's `ticks` is how many frames there were, so a replay
 * rebuilds the empty ones. The whole file is what the REFEREE's sim ran (the frames it applied, in order, up to the
 * one that decided the game or the cap), so a fresh sim fed the same frames ends in the referee's state:
 * `referee.hash` is that state's `sim.hash()`, and a replay is correct exactly when its own `sim.hash()` at the end
 * equals it. `watcher` is a second, independent sim's digest taken from THIS FILE at the moment it was written
 * (null when it was not taken).
 *
 * It holds NO secret and no template. `labels` are display names (a preset id or a scripted name, never a `cmd:`
 * line), the seats' callsigns in `config` are those labels, and the writer (`tools/src/net/arena-frames.ts`) also
 * runs the whole text through the run's redactor. The reader does not trust the file either: every field is
 * checked, and a file whose `build` is not the build asked for is REFUSED before anything else is read
 * (`ReplayRefused`, `build_mismatch`): a frame stream means what the code that wrote it means.
 *
 * Pure: strings in, values out. Shared by the arena server (which reads the file) and the replay page (which
 * re-checks what the server sent).
 */
import { validateConfig, type Frame, type MatchConfig, type Stamped } from '@lions/net';

/** The version this build WRITES (the match recorder). v2 adds `end.checks`, the sim's hash every N ticks (GH-1398 slice 2). */
export const REPLAY_FILE_VERSION = 2;
/** The oldest version this build still READS: the arena writes v1 and its files have no `checks`. */
export const REPLAY_FILE_MIN_VERSION = 1;
/** The longest game a file may claim: the longest cap (35 minutes at 20 Hz) is 42,000. */
export const REPLAY_MAX_TICKS = 100_000;

/** A sim's state at a tick: `sim.hash()`. */
export interface ReplayDigest { tick: number; hash: number }

export interface ReplayHeader {
  kind: 'header';
  /** 1: the arena's files; 2: the recorder's, which may carry `end.checks`. */
  v: 1 | 2;
  /** The arena's `buildId()` when the game was played. */
  build: string;
  game: { n: number; of: number; seed: number; map: string; matchup: string; capTicks: number; pace: number; roundWallMs: number };
  /** The two players, by seat: display names only. */
  labels: [string, string];
  config: MatchConfig;
}

/**
 * Periodic hashes of the recorded sim (v2): `hashes[i]` is `sim.hash()` after `(i + 1) * every` ticks have run, for every multiple of
 * `every` strictly before `end.ticks` (the last state is `end.referee`). A verifier that finds the first that differs knows the replay
 * left the recording somewhere in the `every` ticks before it.
 */
export interface ReplayChecks { every: number; hashes: number[] }

export interface ReplayEnd {
  kind: 'end';
  /** How many frames the referee ran (so also the sim's `tickCount` at the end). */
  ticks: number;
  referee: ReplayDigest;
  watcher: ReplayDigest | null;
  outcome: string;
  by: string;
  /** v2 only; absent in every v1 file and in a recording made with no sim to hash. */
  checks?: ReplayChecks;
}

/** How many checkpoints a game of `ticks` ticks holds at one per `every`: the multiples of `every` strictly before the end. */
export const checkCount = (ticks: number, every: number): number => (ticks <= 0 ? 0 : Math.floor((ticks - 1) / every));

/** A tick that carried commands. */
export interface SparseFrame { t: number; c: Stamped[] }
export interface ReplayFile { header: ReplayHeader; frames: SparseFrame[]; end: ReplayEnd }

export type ReplayRefusal = 'bad_file' | 'build_mismatch' | 'incomplete';

export class ReplayRefused extends Error {
  constructor(readonly code: ReplayRefusal, why: string, readonly detail: { fileBuild?: string } = {}) {
    super(why);
    this.name = 'ReplayRefused';
  }
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isTick = (v: unknown): v is number => isInt(v) && v >= 0 && v <= REPLAY_MAX_TICKS;
const bad = (why: string): ReplayRefused => new ReplayRefused('bad_file', why);

function digestOf(v: unknown, where: string): ReplayDigest {
  if (!isRec(v) || !isTick(v.tick) || !isInt(v.hash)) throw bad(`${where} is not a digest`);
  return { tick: v.tick, hash: v.hash };
}

function stampedOf(v: unknown, at: number): Stamped {
  if (!isRec(v) || (v.seat !== 0 && v.seat !== 1) || !isInt(v.seq) || v.seq < 0 || !isRec(v.cmd) || !isStr(v.cmd.kind)) throw bad(`line ${at}: a command is malformed`);
  return v as unknown as Stamped;
}

function parseLine(line: string, at: number): unknown {
  try { return JSON.parse(line); } catch { throw bad(`line ${at} is not JSON`); }
}

/** The header alone: enough to refuse a file for its build without reading the rest. */
function headerOf(v: unknown, build: string): ReplayHeader {
  if (!isRec(v) || v.kind !== 'header' || !isInt(v.v) || !isStr(v.build)) throw bad('the first line is not a frames header');
  const version = v.v;
  // Another format is refused BEFORE the build is compared: a v3 file is not read as if it were v2 even when the build matches.
  if (version < REPLAY_FILE_MIN_VERSION || version > REPLAY_FILE_VERSION) throw bad(`the file is format version ${version}, this build reads ${REPLAY_FILE_MIN_VERSION} to ${REPLAY_FILE_VERSION}`);
  // The build comes before everything else: a file written by other code is not read as if it were this code's.
  if (v.build !== build) throw new ReplayRefused('build_mismatch', `the file was recorded on build "${v.build}", this is "${build}"`, { fileBuild: v.build });
  const g = v.game;
  if (!isRec(g) || !isInt(g.n) || !isInt(g.of) || !isInt(g.seed) || !isStr(g.map) || !isStr(g.matchup) || !isTick(g.capTicks) || !isInt(g.pace) || !isInt(g.roundWallMs)) throw bad('the header names no game');
  const labels = v.labels;
  if (!Array.isArray(labels) || labels.length !== 2 || !isStr(labels[0]) || !isStr(labels[1])) throw bad('the header names no players');
  const config = validateConfig(v.config);
  if (config === null) throw bad('the header holds no match config');
  return { kind: 'header', v: version === 1 ? 1 : 2, build: v.build, game: { n: g.n, of: g.of, seed: g.seed, map: g.map, matchup: g.matchup, capTicks: g.capTicks, pace: g.pace, roundWallMs: g.roundWallMs }, labels: [labels[0], labels[1]], config };
}

/** A frames file's text as a value. Throws `ReplayRefused`: `build_mismatch` when its build is not `build`,
 *  `incomplete` when it has no `end` line (a game still being written, or one that was cut off), else `bad_file`. */
export function parseReplay(text: string, o: { build: string }): ReplayFile {
  const lines = text.split('\n').filter((l) => l !== '');
  if (lines.length === 0) throw bad('the file is empty');
  const header = headerOf(parseLine(lines[0], 1), o.build);
  const last = parseLine(lines[lines.length - 1], lines.length);
  if (lines.length < 2 || !isRec(last) || last.kind !== 'end') throw new ReplayRefused('incomplete', 'the file has no end line');
  if (!isTick(last.ticks) || !isStr(last.outcome) || !isStr(last.by)) throw bad('the end line is malformed');
  const end: ReplayEnd = {
    kind: 'end', ticks: last.ticks, referee: digestOf(last.referee, 'the referee digest'),
    watcher: last.watcher === null || last.watcher === undefined ? null : digestOf(last.watcher, 'the watcher digest'),
    outcome: last.outcome, by: last.by,
  };
  if (last.checks !== undefined) {
    const c = last.checks;
    if (header.v < 2) throw bad('a version 1 file cannot carry checks');
    if (!isRec(c) || !isInt(c.every) || c.every < 1 || c.every > REPLAY_MAX_TICKS || !Array.isArray(c.hashes) || !c.hashes.every(isInt)) throw bad('the checks are malformed');
    if (c.hashes.length !== checkCount(end.ticks, c.every)) throw bad(`the checks hold ${c.hashes.length} hashes, ${checkCount(end.ticks, c.every)} expected for ${end.ticks} ticks every ${c.every}`);
    end.checks = { every: c.every, hashes: c.hashes as number[] };
  }
  const frames: SparseFrame[] = [];
  let prev = -1;
  for (let i = 1; i < lines.length - 1; i++) {
    const v = parseLine(lines[i], i + 1);
    if (!isRec(v) || !isTick(v.t) || !Array.isArray(v.c) || v.c.length === 0) throw bad(`line ${i + 1} is not a frame`);
    if (v.t <= prev) throw bad(`line ${i + 1}: ticks must ascend`);
    if (v.t >= end.ticks) throw bad(`line ${i + 1}: a frame past the end`);
    prev = v.t;
    frames.push({ t: v.t, c: v.c.map((s) => stampedOf(s, i + 1)) });
  }
  return { header, frames, end };
}

/** The file as text. Frames must ascend, carry commands, and lie inside `end.ticks`; anything else throws. */
export function serializeReplay(file: ReplayFile): string {
  let prev = -1;
  for (const f of file.frames) {
    if (!isTick(f.t) || f.t <= prev || f.t >= file.end.ticks || f.c.length === 0) throw new Error(`serializeReplay: a frame out of order or empty at tick ${f.t}`);
    prev = f.t;
  }
  const c = file.end.checks;
  if (c !== undefined && (file.header.v < 2 || c.every < 1 || c.hashes.length !== checkCount(file.end.ticks, c.every))) throw new Error('serializeReplay: the checks do not fit a version 2 file of this length');
  return [file.header, ...file.frames, file.end].map((v) => JSON.stringify(v)).join('\n') + '\n';
}

/** The dense frame list a transport runs: one frame per tick 0..ticks-1, the empty ones rebuilt. */
export function denseFrames(file: ReplayFile): Frame[] {
  const out: Frame[] = new Array<Frame>(file.end.ticks);
  let k = 0;
  for (let tick = 0; tick < file.end.ticks; tick++) {
    const sparse = file.frames[k];
    if (sparse !== undefined && sparse.t === tick) { out[tick] = { tick, cmds: sparse.c }; k++; } else out[tick] = { tick, cmds: [] };
  }
  return out;
}

/** The sparse form of frames the referee ran (a dense list, empty ticks included), for the writer. */
export function sparseFrames(frames: readonly Frame[]): SparseFrame[] {
  const out: SparseFrame[] = [];
  frames.forEach((f, i) => {
    if (f.tick !== i) throw new Error(`sparseFrames: frame ${i} is tick ${f.tick}`);
    if (f.cmds.length > 0) out.push({ t: f.tick, c: f.cmds });
  });
  return out;
}
