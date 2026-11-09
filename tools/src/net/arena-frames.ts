/**
 * Recording a game (GH-954 W3, decision D-W9): the referee's frames, the match config and the build go to
 * `<out>/<game>.frames.jsonl` (the file's format, and why a reader can trust it, are in
 * `packages/app/src/net/replay-file.ts`).
 *
 * What is NOT in the file, by construction:
 * - a template or a command line: a player is written as a DISPLAY NAME (`displayName`: a scripted name, a preset's
 *   label, or an id-shaped name; anything else is `Player A` / `Player B`), and the config's seat callsigns are
 *   replaced by those names, because a callsign is the first 16 characters of whatever the player was called;
 * - the run's private token: no part of this module reads one, and the finished text also passes `redactText` with
 *   the run's secrets (the token and its JSON-escaped form), as every other file the run writes does.
 *
 * The watcher digest: right after serialising, the arena parses the TEXT it is about to write (so a bug in the
 * writer or the format shows up) and runs it through a fresh sim (`replayToEnd`, the replay page's own transport).
 * The result goes into the `end` line beside the referee's, and a disagreement is logged by the caller.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Frame, MatchConfig } from '@lions/net';
import { parseReplay, serializeReplay, sparseFrames, type ReplayDigest, type ReplayFile } from '../../../packages/app/src/net/replay-file';
import { replayToEnd } from './arena-replay';
import { redactText } from './redact';

/** A name a file may carry as it stands: short, no space, no `:` or `/`. A `cmd:` line is none of those. */
const ID_SHAPED = /^[A-Za-z0-9][A-Za-z0-9._#-]{0,47}$/;
const SUFFIX = /#[ab]$/;

/**
 * The name to show for a player, from the name the arena keys its tally on. Null when it is not safe to show (a
 * `cmd:` template, a path, anything with a space): the caller shows its own word for "an external player".
 * `labelOf` maps a preset id to the preset's label (the presets file's own words, never its template).
 */
export function displayName(name: string, labelOf?: (id: string) => string | null): string | null {
  const base = name.replace(SUFFIX, '');
  const suffix = name.slice(base.length);
  const label = labelOf?.(base) ?? null;
  if (label !== null) return `${label}${suffix}`;
  return ID_SHAPED.test(name) ? name : null;
}

/** The two names a file carries, by seat. `unnamed` is what a player with no safe name is called, by seat. */
export function displayNames(names: readonly [string, string], labelOf?: (id: string) => string | null, unnamed: readonly [string, string] = ['Player A', 'Player B']): [string, string] {
  return [displayName(names[0], labelOf) ?? unnamed[0], displayName(names[1], labelOf) ?? unnamed[1]];
}

export interface GameFrames {
  config: MatchConfig;
  /** Every frame the referee ran, tick 0 upward, empty ones included. */
  frames: readonly Frame[];
}

export interface RecordInput {
  build: string;
  game: { n: number; of: number; seed: number; map: string; matchup: string; capTicks: number; pace: number; roundWallMs: number };
  /** The names the arena keys on, by seat. */
  names: readonly [string, string];
  frames: GameFrames;
  referee: ReplayDigest;
  outcome: string;
  by: string;
  labelOf?: (id: string) => string | null;
  /** What a player with no safe name is called, by seat: `Player A` is the run's first player in both games of a seed. */
  unnamed?: readonly [string, string];
  /** The run's secrets (the token and its JSON-escaped form). */
  secrets?: readonly string[];
}

export interface Recorded {
  /** The text written. */
  text: string;
  /** The independent sim's digest, from the file's own text. */
  watcher: ReplayDigest;
  /** The watcher reached the referee's tick and state. */
  agrees: boolean;
}

/** The file for one game, with the watcher digest in its `end` line. Throws if the frames are not the referee's
 *  (their count is not the referee's tick): a file that could not replay is not written. */
export function recordGame(i: RecordInput): Recorded {
  const { frames, config } = i.frames;
  if (frames.length !== i.referee.tick) throw new Error(`the recorded frames (${frames.length}) are not the referee's ${i.referee.tick} ticks`);
  const labels = displayNames(i.names, i.labelOf, i.unnamed);
  const seats: MatchConfig['seats'] = [{ ...config.seats[0], callsign: labels[0] }, { ...config.seats[1], callsign: labels[1] }];
  const file: ReplayFile = {
    header: { kind: 'header', v: 1, build: i.build, game: i.game, labels, config: { ...config, seats } },
    frames: sparseFrames(frames),
    end: { kind: 'end', ticks: frames.length, referee: i.referee, watcher: null, outcome: i.outcome, by: i.by },
  };
  // The watcher runs the file as written, not the objects it came from.
  const watcher = replayToEnd(parseReplay(serializeReplay(file), { build: i.build }));
  const withWatcher: ReplayFile = { ...file, end: { ...file.end, watcher } };
  const text = redactText(serializeReplay(withWatcher), i.secrets ?? []);
  return { text, watcher, agrees: watcher.tick === i.referee.tick && watcher.hash === i.referee.hash };
}

/** Writes `text` to `path`, creating its directory. */
export function writeFrames(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
