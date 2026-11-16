/**
 * The match recorder (GH-1398, slice 1): a library that keeps what a versus or skirmish match RAN, so the match can be run again
 * and has to end in the same state. No UI: nothing here draws, saves or plays; a later slice puts a button on it.
 *
 * WHAT IT RECORDS, AND WHERE IT LIVES. A replay is a command log plus a seed, never a state dump per tick (GH-1398's constraint).
 * It is the arena's frames file, not a second format (`replay-file.ts`, GH-954 W3, `ReplayFile` v1): the build, the match config
 * (which holds the seed, the map, the seats' sides and factions, kits and tiers, the mode and every option that changes the sim:
 * win mode, flag set-up, the economy room), the frames that carried a command, and an `end` line with the tick count and the
 * sim's `hash()`. So the arena's parser (`parseReplay`) refuses a recording from another build or version before it reads
 * anything else (`ReplayRefused`, `build_mismatch`), the arena's replay transport and `replayToEnd` play it, and nothing was forked.
 * The sim imports nothing from here; this file imports types from `@lions/net` and the file helpers from `replay-file.ts`.
 *
 * HOW IT HOOKS IN. `MatchRecorder.record` has the shape of `FrameStep.beforeFrame` (`frame-step.ts`): the frame the client is
 * about to apply, BEFORE the ownership check drops anything, exactly as the lockstep room hands it over. A replay therefore
 * drops the same forged orders the match did, through the same `applyFrame`. Wire it as `beforeFrame: recorder.record`.
 *
 * CHECKPOINTS (version 2). Given the sim, it also takes `sim.hash()` every `CHECK_EVERY_TICKS` ticks (`afterFrame`) and writes them in the
 * `end` line, so a verifier can say where a replay left the recording and not only that it did.
 *
 * WHAT IT DOES NOT HOLD. No player id, callsign, room code or match id: `scrubbedConfig` replaces them (none of them reaches the
 * sim, and the test proves the replay's hash is the same with and without them), and the two labels are the factions.
 */
import { matchCapTicksOf, type Frame, type MatchConfig, type Stamped } from '@lions/net';
import { REPLAY_FILE_VERSION, REPLAY_MAX_TICKS, checkCount, serializeReplay, sparseFrames, type ReplayChecks, type ReplayDigest, type ReplayFile, type ReplayHeader } from './replay-file';

export class RecorderError extends Error {
  constructor(why: string) {
    super(why);
    this.name = 'RecorderError';
  }
}

/** The config with every field that names a person or a room replaced by a fixed word. None of them is read by the sim. */
export function scrubbedConfig(config: MatchConfig): MatchConfig {
  const c = structuredClone(config);
  c.matchId = 'replay';
  c.code = 'REPLAY';
  c.seats[0] = { ...c.seats[0], player: 'seat-0', callsign: 'Seat 0' };
  c.seats[1] = { ...c.seats[1], player: 'seat-1', callsign: 'Seat 1' };
  return c;
}

/** What `finish` needs from the match: where it stopped, the sim's hash there, and how it was decided. */
export interface MatchEnd {
  /** The sim after its last tick: `tick` is `sim.tickCount`, `hash` is `sim.hash()`. */
  digest: ReplayDigest;
  outcome: string;
  by: string;
}

/** One checkpoint per second of play (20 Hz): a divergence is located to within a second, and a 20-minute match adds 24 numbers. */
export const CHECK_EVERY_TICKS = 20;

export interface RecorderOptions {
  /** The build the match ran on (`buildId()`); a replay is refused by any other. */
  build: string;
  /** The config the room ran with. Scrubbed on the way in. */
  config: MatchConfig;
  /**
   * The sim the match is running, to be hashed every `checkEvery` ticks (version 2 checkpoints, slice 2). Absent: no checkpoints, and a
   * verifier can say THAT a replay diverged but not WHERE.
   */
  sim?: { hash(): number };
  /** Default `CHECK_EVERY_TICKS`. */
  checkEvery?: number;
}

/** The header of a recording of `config` on `build`: the arena's header with the fields a one-game series fills in. */
export function recordingHeader(o: RecorderOptions): ReplayHeader {
  const config = scrubbedConfig(o.config);
  const [a, b] = config.seats;
  return {
    kind: 'header',
    v: REPLAY_FILE_VERSION,
    build: o.build,
    game: { n: 1, of: 1, seed: config.seed, map: config.map, matchup: `${a.faction} v ${b.faction}`, capTicks: matchCapTicksOf(config), pace: 1, roundWallMs: 0 },
    labels: [a.faction, b.faction],
    config,
  };
}

export class MatchRecorder {
  private readonly header: ReplayHeader;
  private readonly frames: Frame[] = [];
  private readonly hashes: number[] = [];
  private reported = 0;
  private readonly every: number;
  private done = false;

  constructor(private readonly o: RecorderOptions) {
    this.header = recordingHeader(o);
    this.every = o.checkEvery ?? CHECK_EVERY_TICKS;
    if (!Number.isInteger(this.every) || this.every < 1) throw new RecorderError(`checkEvery ${this.every} is not a positive integer`);
  }

  /** How many frames have been recorded (so the tick the next one must carry). */
  get ticks(): number {
    return this.frames.length;
  }

  /**
   * Keep one frame. Frames must come in tick order from 0 with none missing: the sim's tick count is the number of frames it ran,
   * and a gap or a repeat is a recording that cannot replay. The frame is copied, so a transport that reuses its objects cannot
   * change the log afterwards.
   */
  readonly record = (frame: Frame): void => {
    if (this.done) throw new RecorderError('record after finish');
    if (frame.tick !== this.frames.length) throw new RecorderError(`frame ${frame.tick} came when ${this.frames.length} was next`);
    if (this.frames.length >= REPLAY_MAX_TICKS) throw new RecorderError(`a recording holds at most ${REPLAY_MAX_TICKS} ticks`);
    this.frames.push({ tick: frame.tick, cmds: structuredClone(frame.cmds) as Stamped[] });
  };

  /**
   * Called after frame `tick` has RUN (the shape of `FrameStep.afterFrame`, whose second argument is ignored): on every multiple of
   * `checkEvery` ticks, takes `sim.hash()`. It must come after `record(tick)` and after the tick ran; anything else throws, because a
   * checkpoint taken at the wrong moment would make an honest replay read as a divergence.
   */
  readonly afterFrame = (tick: number): void => {
    if (this.done || this.o.sim === undefined) return;
    if (tick + 1 !== this.frames.length) throw new RecorderError(`afterFrame(${tick}) with ${this.frames.length} frames recorded`);
    // Every frame, in order: a skipped one would leave a checkpoint missing or misplaced, and an honest replay would read as a divergence.
    if (tick !== this.reported) throw new RecorderError(`afterFrame(${tick}) came when ${this.reported} was next`);
    this.reported = tick + 1;
    if ((tick + 1) % this.every === 0) this.hashes.push(this.o.sim.hash());
  };

  /** Close the recording. The sim must have run exactly the frames recorded. Once only. */
  finish(end: MatchEnd): ReplayFile {
    if (this.done) throw new RecorderError('finish twice');
    if (end.digest.tick !== this.frames.length) {
      throw new RecorderError(`the sim stopped at tick ${end.digest.tick} but ${this.frames.length} frames were recorded`);
    }
    let checks: ReplayChecks | undefined;
    if (this.o.sim !== undefined) {
      const want = checkCount(this.frames.length, this.every);
      const hashes = [...this.hashes];
      // A caller that also reports the last frame has one checkpoint too many: it is the end state, which the end line holds.
      if (hashes.length === want + 1 && (want + 1) * this.every === this.frames.length) {
        if (hashes[want] !== end.digest.hash) throw new RecorderError('the last checkpoint is not the end hash');
        hashes.pop();
      }
      if (hashes.length !== want) throw new RecorderError(`${hashes.length} checkpoints taken, ${want} expected for ${this.frames.length} ticks every ${this.every}: afterFrame was not called on every frame`);
      checks = { every: this.every, hashes };
    }
    this.done = true;
    return {
      header: this.header,
      frames: sparseFrames(this.frames),
      end: { kind: 'end', ticks: this.frames.length, referee: { tick: end.digest.tick, hash: end.digest.hash }, watcher: null, outcome: end.outcome, by: end.by, ...(checks === undefined ? {} : { checks }) },
    };
  }

  /** `finish`, as the text a file holds (`parseReplay` reads it back). */
  finishText(end: MatchEnd): string {
    return serializeReplay(this.finish(end));
  }
}
