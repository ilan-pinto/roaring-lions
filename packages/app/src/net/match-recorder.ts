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
 * WHAT IT DOES NOT HOLD. No player id, callsign, room code or match id: `scrubbedConfig` replaces them (none of them reaches the
 * sim, and the test proves the replay's hash is the same with and without them), and the two labels are the factions.
 */
import { matchCapTicksOf, type Frame, type MatchConfig, type Stamped } from '@lions/net';
import { REPLAY_FILE_VERSION, REPLAY_MAX_TICKS, serializeReplay, sparseFrames, type ReplayDigest, type ReplayFile, type ReplayHeader } from './replay-file';

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

export interface RecorderOptions {
  /** The build the match ran on (`buildId()`); a replay is refused by any other. */
  build: string;
  /** The config the room ran with. Scrubbed on the way in. */
  config: MatchConfig;
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
  private done = false;

  constructor(o: RecorderOptions) {
    this.header = recordingHeader(o);
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

  /** Close the recording. The sim must have run exactly the frames recorded. Once only. */
  finish(end: MatchEnd): ReplayFile {
    if (this.done) throw new RecorderError('finish twice');
    if (end.digest.tick !== this.frames.length) {
      throw new RecorderError(`the sim stopped at tick ${end.digest.tick} but ${this.frames.length} frames were recorded`);
    }
    this.done = true;
    return {
      header: this.header,
      frames: sparseFrames(this.frames),
      end: { kind: 'end', ticks: this.frames.length, referee: { tick: end.digest.tick, hash: end.digest.hash }, watcher: null, outcome: end.outcome, by: end.by },
    };
  }

  /** `finish`, as the text a file holds (`parseReplay` reads it back). */
  finishText(end: MatchEnd): string {
    return serializeReplay(this.finish(end));
  }
}
