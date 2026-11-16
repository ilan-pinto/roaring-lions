/**
 * Verify a recording (GH-1398, slice 1): read a frames file's text, REFUSE it if it is another build's or another version's, run its
 * frames through a fresh sim with `replayToEnd` (the arena's own headless replay: the same `ReplayTransport`, `runFrames`,
 * `buildMatchWorld` and `matchTick` the replay page and the lockstep clients use), and compare the sim's tick and `hash()` with the
 * `end` line the recorder wrote. Nothing is re-implemented here; this is the three existing calls in a row and the sentence that
 * says which of them failed.
 *
 * It never "desyncs silently": a recording from a build that is not this one is `refused` before a frame is read (the build string
 * is the first thing the parser checks), and a recording that this build does run but that ends elsewhere is `desync`, with both
 * ticks and both hashes.
 */
import { parseReplay, ReplayRefused, type ReplayDigest, type ReplayFile, type ReplayRefusal } from '../../../packages/app/src/net/replay-file';
import { replayToEnd, type ReplayRunOptions } from './arena-replay';

export type RecordingVerdict =
  | { kind: 'ok'; file: ReplayFile; digest: ReplayDigest }
  | { kind: 'refused'; code: ReplayRefusal; why: string }
  | { kind: 'desync'; file: ReplayFile; recorded: ReplayDigest; replayed: ReplayDigest };

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
  const replayed = replayToEnd(file, o);
  const recorded = file.end.referee;
  if (replayed.tick !== recorded.tick || replayed.hash !== recorded.hash) return { kind: 'desync', file, recorded, replayed };
  return { kind: 'ok', file, digest: replayed };
}
