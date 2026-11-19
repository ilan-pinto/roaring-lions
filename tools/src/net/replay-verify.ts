/**
 * Verify a recording (GH-1398, slices 1 and 2): read a frames file's text, REFUSE it if it is another build's or another format's, run its
 * frames through a fresh sim with `replayToEnd` (the arena's own headless replay: the same `ReplayTransport`, `runFrames`,
 * `buildMatchWorld` and `matchTick` the replay page and the lockstep clients use), and compare the sim's tick and `hash()` with the
 * `end` line the recorder wrote. Nothing is re-implemented here; this is the existing calls in a row and the sentence that says which failed.
 *
 * A version 2 file also carries the sim's hash every N ticks (`end.checks`). The replay then runs one tick per step and compares at each
 * checkpoint, so a desync names the FIRST checkpoint that differs and the window before it, not only that the final hashes disagree.
 *
 * It never "desyncs silently": a recording from a build that is not this one is `refused` before a frame is read (the build string
 * is the first thing the parser checks after the format), and a recording that this build does run but that ends or passes elsewhere is
 * `desync`, with both hashes.
 */
import { parseReplay, ReplayRefused, type ReplayDigest, type ReplayFile, type ReplayRefusal } from '../../../packages/app/src/net/replay-file';
import { replayToEnd, type ReplayRunOptions } from './arena-replay';

/** Where a replay first left its recording. `atTick` is the checkpoint (ticks run) whose hash differs; the departure is in `(afterTick, atTick]`. */
export interface Divergence {
  atTick: number;
  /** The last checkpoint that matched (0 before the first). */
  afterTick: number;
  recorded: number;
  replayed: number;
  /** True when the departure is at the final state (the end line), not at a periodic checkpoint. */
  atEnd: boolean;
}

export type RecordingVerdict =
  | { kind: 'ok'; file: ReplayFile; digest: ReplayDigest; checked: number }
  | { kind: 'refused'; code: ReplayRefusal; why: string }
  | { kind: 'desync'; file: ReplayFile; recorded: ReplayDigest; replayed: ReplayDigest; checked: number; divergence: Divergence | null };

export function verifyRecording(text: string, o: { build: string } & ReplayRunOptions): RecordingVerdict {
  let file: ReplayFile;
  try {
    file = parseReplay(text, { build: o.build });
  } catch (e) {
    if (e instanceof ReplayRefused) return { kind: 'refused', code: e.code, why: e.message };
    throw e;
  }
  return verifyFile(file, o);
}

/** The same check on a file already parsed (a caller that holds the value). */
export function verifyFile(file: ReplayFile, o: ReplayRunOptions = {}): RecordingVerdict {
  const checks = file.end.checks;
  // Held in one object: the callback below writes it, and a bare `let` would be narrowed to its initial value after the call.
  const st: { divergence: Divergence | null; checked: number; last: number; seen: number } = { divergence: null, checked: 0, last: 0, seen: -1 };
  const run: ReplayRunOptions = { ...o };
  if (checks !== undefined) {
    // One tick a step, so every checkpoint is read at exactly its tick.
    run.perFrame = 1;
    run.onFrame = (tick, hash) => {
      o.onFrame?.(tick, hash);
      // An animation frame can run no tick (the transport's budget); a checkpoint is read once.
      if (tick === st.seen) return;
      st.seen = tick;
      if (tick === 0 || tick % checks.every !== 0 || tick >= file.end.ticks) return;
      const recorded = checks.hashes[tick / checks.every - 1];
      if (recorded === undefined) return;
      st.checked++;
      if (st.divergence !== null) return;
      const replayed = hash();
      if (replayed !== recorded) st.divergence = { atTick: tick, afterTick: st.last, recorded, replayed, atEnd: false };
      else st.last = tick;
    };
  }
  const replayed = replayToEnd(file, run);
  const recorded = file.end.referee;
  const ends = replayed.tick === recorded.tick && replayed.hash === recorded.hash;
  // Every checkpoint matched and the end does not: the departure is in the last window.
  if (!ends && checks !== undefined && st.divergence === null) st.divergence = { atTick: recorded.tick, afterTick: st.last, recorded: recorded.hash, replayed: replayed.hash, atEnd: true };
  if (!ends || st.divergence !== null) return { kind: 'desync', file, recorded, replayed, checked: st.checked, divergence: st.divergence };
  return { kind: 'ok', file, digest: replayed, checked: st.checked };
}
